"""Inventory service — async gRPC.

The gRPC server is instrumented (see obs.otel), so the trace context the
order service sent on the wire is picked up here automatically: CheckStock
and Reserve spans and their Postgres spans land under the order's trace, in
a different process, with no propagation code in this file. The one bit of
application code is reading the cart.id OTel baggage entry the order service
set and stamping it onto the current span, mirroring
services/spring/inventory/InventoryServiceImpl.
"""
from __future__ import annotations

import asyncio
import logging
import uuid

import grpc
from opentelemetry import baggage, trace

from obs import db, logging as obslog, otel
from shop.inventory.v1 import inventory_pb2, inventory_pb2_grpc

log = logging.getLogger("inventory")


def _attach_cart_baggage() -> str | None:
    cart_id = baggage.get_baggage("cart.id")
    if cart_id:
        trace.get_current_span().set_attribute("cart.id", cart_id)
    return cart_id


class InventoryServicer(inventory_pb2_grpc.InventoryServiceServicer):
    async def CheckStock(self, request, context):
        cart_id = _attach_cart_baggage()
        log.info("CheckStock sku=%s quantity=%d cart=%s", request.sku, request.quantity, cart_id)

        pool = await db.get_pool()
        on_hand = await pool.fetchval("SELECT on_hand FROM stock WHERE sku = $1", request.sku)
        on_hand = on_hand if on_hand is not None else 0
        available = on_hand >= request.quantity

        return inventory_pb2.CheckStockResponse(available=available, on_hand=on_hand)

    async def Reserve(self, request, context):
        cart_id = _attach_cart_baggage()
        log.info(
            "Reserve orderId=%s sku=%s quantity=%d cart=%s",
            request.order_id, request.sku, request.quantity, cart_id,
        )

        pool = await db.get_pool()

        # Idempotent on order_id+sku: a retry returns the original reservation.
        existing = await pool.fetchrow(
            "SELECT reservation_id FROM reservations WHERE order_id = $1 AND sku = $2",
            request.order_id, request.sku,
        )
        if existing:
            remaining = await pool.fetchval("SELECT on_hand FROM stock WHERE sku = $1", request.sku)
            return inventory_pb2.ReserveResponse(
                reserved=True,
                reservation_id=existing["reservation_id"],
                remaining=remaining if remaining is not None else 0,
            )

        reservation_id = str(uuid.uuid4())
        await pool.execute(
            "INSERT INTO reservations (reservation_id, order_id, sku, quantity) VALUES ($1, $2, $3, $4)",
            reservation_id, request.order_id, request.sku, request.quantity,
        )
        await pool.execute(
            "UPDATE stock SET on_hand = on_hand - $1 WHERE sku = $2",
            request.quantity, request.sku,
        )
        remaining = await pool.fetchval("SELECT on_hand FROM stock WHERE sku = $1", request.sku)

        return inventory_pb2.ReserveResponse(
            reserved=True, reservation_id=reservation_id, remaining=remaining if remaining is not None else 0
        )


async def _serve() -> None:
    obslog.configure()
    otel.setup("inventory")
    server = grpc.aio.server()
    inventory_pb2_grpc.add_InventoryServiceServicer_to_server(InventoryServicer(), server)
    server.add_insecure_port("0.0.0.0:50051")
    await server.start()
    log.info("inventory gRPC server listening on :50051")
    await server.wait_for_termination()


def main() -> None:
    asyncio.run(_serve())


if __name__ == "__main__":
    main()
