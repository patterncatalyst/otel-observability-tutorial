"""gRPC stubs the order service calls service-to-service. gRPC is
instrumented (see obs.otel), so the trace context — and, via the baggage
propagator, cart.id — rides along on these calls without any code here: the
inventory and payment spans land under the same trace as the incoming HTTP
request, each with a cart.id span attribute set from the propagated baggage.
"""
from __future__ import annotations

import os

import grpc

from shop.common.v1 import common_pb2
from shop.inventory.v1 import inventory_pb2, inventory_pb2_grpc
from shop.payment.v1 import payment_pb2, payment_pb2_grpc


class Clients:
    def __init__(self) -> None:
        self._inventory_channel = grpc.aio.insecure_channel(
            os.getenv("INVENTORY_ADDR", "inventory-python:50051")
        )
        self._payment_channel = grpc.aio.insecure_channel(
            os.getenv("PAYMENT_ADDR", "payment-python:50052")
        )
        self.inventory = inventory_pb2_grpc.InventoryServiceStub(self._inventory_channel)
        self.payment = payment_pb2_grpc.PaymentServiceStub(self._payment_channel)

    async def check_stock(self, sku: str, quantity: int) -> inventory_pb2.CheckStockResponse:
        return await self.inventory.CheckStock(
            inventory_pb2.CheckStockRequest(sku=sku, quantity=quantity)
        )

    async def authorize(
        self, order_id: str, customer_id: str, amount_cents: int, currency: str = "USD"
    ) -> payment_pb2.AuthorizeResponse:
        return await self.payment.Authorize(
            payment_pb2.AuthorizeRequest(
                order_id=order_id,
                customer_id=customer_id,
                amount=common_pb2.Money(amount_cents=amount_cents, currency=currency),
            )
        )

    async def close(self) -> None:
        await self._inventory_channel.close()
        await self._payment_channel.close()
