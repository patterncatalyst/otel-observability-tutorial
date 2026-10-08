"""Order service — the external REST front door.

POST /orders is the single user action the whole tutorial traces. One call
fans out across every hop in the system:

    HTTP (here) -> gRPC CheckStock (inventory) -> gRPC Authorize (payment)
                -> Postgres INSERT (here) -> Kafka publish order.placed

gRPC and Postgres are instrumented, so those spans attach to this request's
trace for free. The Kafka publish stamps the trace context into the message
headers (obs.kafka.publish_event) so the shipping and notification consumers
can continue the same trace — the one hop that needs explicit propagation.

cart.id is set as OTel baggage around the critical section so it rides
downstream (over gRPC) and shows up as a `cart.id` span attribute on the
inventory and payment services — mirroring services/spring/order's behavior.
"""
from __future__ import annotations

import asyncio
import logging
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from opentelemetry import baggage, context
from pydantic import BaseModel, ConfigDict, Field

from obs import db, kafka as obskafka, logging as obslog, otel

from . import repo
from .grpc_clients import Clients

log = logging.getLogger("order")

ORDER_PLACED_TOPIC = "order.placed"
UNIT_PRICE_CENTS = 2500
MAX_RETRIES = 5
RETRY_DELAY_SECONDS = 1.0


class CreateOrderRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    customer_id: str = Field(alias="customerId")
    sku: str
    quantity: int = Field(ge=1)
    cart_id: str | None = Field(default=None, alias="cartId")


@asynccontextmanager
async def lifespan(app: FastAPI):
    obslog.configure()
    otel.setup("order")
    otel.instrument_fastapi(app)
    app.state.clients = Clients()
    app.state.producer = await obskafka.make_producer()
    app.state.orders_counter = otel.meter().create_counter(
        "orders_placed_total", description="Orders placed, by status"
    )
    log.info("order service started")
    yield
    await app.state.producer.stop()
    await app.state.clients.close()
    await db.close_pool()


app = FastAPI(title="order", lifespan=lifespan)


@app.get("/actuator/health")
async def actuator_health() -> dict:
    """Readiness probe polled by demos/drive-load.sh, matching the Spring
    Boot Actuator path so the shared load-driving script works unmodified
    against any language implementation."""
    return {"status": "UP"}


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}


def _resolve_cart_id(body_cart_id: str | None, header_cart_id: str | None) -> str:
    if body_cart_id:
        return body_cart_id
    if header_cart_id:
        return header_cart_id
    return f"cart-{uuid.uuid4().hex[:8]}"


async def _check_stock_with_retry(clients: Clients, sku: str, quantity: int) -> bool:
    last_exc: Exception | None = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            response = await clients.check_stock(sku, quantity)
            return response.available
        except Exception as exc:  # noqa: BLE001 - mirrors Spring's catch-and-retry
            last_exc = exc
            log.warning("inventory CheckStock attempt %d/%d failed: %s", attempt, MAX_RETRIES, exc)
            await asyncio.sleep(RETRY_DELAY_SECONDS)
    raise RuntimeError(f"inventory CheckStock failed after {MAX_RETRIES} attempts") from last_exc


async def _authorize_with_retry(
    clients: Clients, order_id: str, customer_id: str, amount_cents: int
) -> bool:
    last_exc: Exception | None = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            response = await clients.authorize(order_id, customer_id, amount_cents)
            return response.authorized
        except Exception as exc:  # noqa: BLE001 - mirrors Spring's catch-and-retry
            last_exc = exc
            log.warning("payment Authorize attempt %d/%d failed: %s", attempt, MAX_RETRIES, exc)
            await asyncio.sleep(RETRY_DELAY_SECONDS)
    raise RuntimeError(f"payment Authorize failed after {MAX_RETRIES} attempts") from last_exc


@app.post("/orders", status_code=201)
async def create_order(body: CreateOrderRequest, request: Request) -> dict:
    order_id = str(uuid.uuid4())
    header_cart_id = request.headers.get("X-Cart-Id")
    cart_id = _resolve_cart_id(body.cart_id, header_cart_id)
    amount_cents = body.quantity * UNIT_PRICE_CENTS

    ctx = baggage.set_baggage("cart.id", cart_id)
    token = context.attach(ctx)
    try:
        available = await _check_stock_with_retry(app.state.clients, body.sku, body.quantity)

        authorized = False
        if available:
            authorized = await _authorize_with_retry(
                app.state.clients, order_id, body.customer_id, amount_cents
            )

        status = "PLACED" if (available and authorized) else "REJECTED"

        await repo.insert_order(order_id, body.customer_id, body.sku, body.quantity, amount_cents, status)

        if status == "PLACED":
            await obskafka.publish_event(
                app.state.producer,
                ORDER_PLACED_TOPIC,
                key=order_id,
                value={
                    "orderId": order_id,
                    "customerId": body.customer_id,
                    "sku": body.sku,
                    "quantity": body.quantity,
                    "amountCents": amount_cents,
                    "status": status,
                    "cartId": cart_id,
                },
            )
    finally:
        context.detach(token)

    app.state.orders_counter.add(1, {"status": status})
    log.info("order placed id=%s status=%s cart=%s", order_id, status, cart_id)

    # Matches Spring's OrderController: always 201 Created, PLACED or
    # REJECTED is communicated in the response body's `status` field, not
    # the HTTP status code (an order row is written either way).
    return {
        "orderId": order_id,
        "customerId": body.customer_id,
        "sku": body.sku,
        "quantity": body.quantity,
        "amountCents": amount_cents,
        "status": status,
    }


@app.get("/orders/{order_id}")
async def read_order(order_id: str) -> dict:
    order = await repo.get_order(order_id)
    if order is None:
        raise HTTPException(status_code=404, detail="order not found")
    return order


def main() -> None:
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8080)


if __name__ == "__main__":
    main()
