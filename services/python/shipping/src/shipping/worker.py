"""Shipping service — consumes order.placed and creates a shipment, then
publishes shipment.created.

This is the consumer side of the async hop. The producer (order service)
injected the trace context into the Kafka message headers (when
PROPAGATE_KAFKA_CONTEXT=true); here we extract it and open the processing
span with that context as its parent. Without these two lines the span below
would start a brand-new, disconnected trace — the break the
auto-vs-manual-instrumentation chapter is about closing.
"""
from __future__ import annotations

import asyncio
import logging
import signal
import uuid

from obs import db, kafka as obskafka, logging as obslog, otel
from obs.kafka_propagation import extract_context

log = logging.getLogger("shipping")

ORDER_PLACED_TOPIC = "order.placed"
SHIPMENT_CREATED_TOPIC = "shipment.created"
GROUP_ID = "shipping-python"


async def _create_shipment(order: dict) -> str:
    pool = await db.get_pool()
    shipment_id = str(uuid.uuid4())
    await pool.execute(
        "INSERT INTO shipments (shipment_id, order_id, sku, quantity, status) VALUES ($1, $2, $3, $4, $5)",
        shipment_id, order["orderId"], order["sku"], order["quantity"], "CREATED",
    )
    return shipment_id


async def _run() -> None:
    obslog.configure()
    otel.setup("shipping")
    consumer = await obskafka.make_consumer(ORDER_PLACED_TOPIC, group_id=GROUP_ID)
    producer = await obskafka.make_producer()

    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, stop.set)

    log.info("shipping consuming %s", ORDER_PLACED_TOPIC)
    try:
        async for msg in consumer:
            ctx = extract_context(msg.headers)  # continue the producer's trace
            with otel.tracer().start_as_current_span("shipping.handle_order_placed", context=ctx):
                order = msg.value
                shipment_id = await _create_shipment(order)
                await obskafka.publish_event(
                    producer,
                    SHIPMENT_CREATED_TOPIC,
                    key=order["orderId"],
                    value={"shipmentId": shipment_id, "orderId": order["orderId"], "status": "CREATED"},
                )
                log.info("shipment created id=%s order=%s", shipment_id, order["orderId"])
            if stop.is_set():
                break
    finally:
        await consumer.stop()
        await producer.stop()
        await db.close_pool()


def main() -> None:
    asyncio.run(_run())


if __name__ == "__main__":
    main()
