"""Payment service — async gRPC.

Authorizes (does not capture) funds for an order. Like inventory, the gRPC
server instrumentation continues the order's trace automatically. The
authorization write is a Postgres span under that same trace. Mirrors
services/spring/payment/PaymentServiceImpl: idempotent on order_id, a fixed
ceiling above which authorization is declined, and the cart.id baggage
read-and-stamp.
"""
from __future__ import annotations

import asyncio
import logging
import uuid

import grpc
from opentelemetry import baggage, trace

from obs import db, logging as obslog, otel
from shop.payment.v1 import payment_pb2, payment_pb2_grpc

log = logging.getLogger("payment")

# Demo authorization ceiling: $1,000,000.00 in cents — matches Spring's
# PaymentServiceImpl.MAX_AUTHORIZED_AMOUNT_CENTS.
MAX_AUTHORIZED_AMOUNT_CENTS = 100_000_000


def _attach_cart_baggage() -> str | None:
    cart_id = baggage.get_baggage("cart.id")
    if cart_id:
        trace.get_current_span().set_attribute("cart.id", cart_id)
    return cart_id


class PaymentServicer(payment_pb2_grpc.PaymentServiceServicer):
    async def Authorize(self, request, context):
        cart_id = _attach_cart_baggage()
        amount_cents = request.amount.amount_cents
        log.info(
            "Authorize orderId=%s customerId=%s amountCents=%d cart=%s",
            request.order_id, request.customer_id, amount_cents, cart_id,
        )

        pool = await db.get_pool()

        existing = await pool.fetchrow(
            "SELECT authorization_id, authorized FROM authorizations WHERE order_id = $1",
            request.order_id,
        )
        if existing:
            authorized = existing["authorized"]
            return payment_pb2.AuthorizeResponse(
                authorized=authorized,
                authorization_id=existing["authorization_id"],
                decline_reason="" if authorized else "amount too large",
            )

        authorized = amount_cents <= MAX_AUTHORIZED_AMOUNT_CENTS
        authorization_id = str(uuid.uuid4())
        await pool.execute(
            "INSERT INTO authorizations (authorization_id, order_id, customer_id, amount_cents, authorized) "
            "VALUES ($1, $2, $3, $4, $5)",
            authorization_id, request.order_id, request.customer_id, amount_cents, authorized,
        )

        if authorized:
            log.info("authorized %d cents for order %s", amount_cents, request.order_id)
        else:
            log.warning("declined %d cents for order %s (amount too large)", amount_cents, request.order_id)

        return payment_pb2.AuthorizeResponse(
            authorized=authorized,
            authorization_id=authorization_id,
            decline_reason="" if authorized else "amount too large",
        )


async def _serve() -> None:
    obslog.configure()
    otel.setup("payment")
    server = grpc.aio.server()
    payment_pb2_grpc.add_PaymentServiceServicer_to_server(PaymentServicer(), server)
    server.add_insecure_port("0.0.0.0:50052")
    await server.start()
    log.info("payment gRPC server listening on :50052")
    await server.wait_for_termination()


def main() -> None:
    asyncio.run(_serve())


if __name__ == "__main__":
    main()
