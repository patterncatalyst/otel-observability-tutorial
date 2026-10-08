"""Notification service — consumes order.placed and records a notification.

The simplest consumer: a single INSERT standing in for an email/SMS send. It
still extracts the trace context from the message headers and opens its span
under the order's trace, so even this fire-and-forget side effect is visible
on the same end-to-end trace as the original request.
"""
from __future__ import annotations

import asyncio
import logging
import signal
import uuid

from obs import db, kafka as obskafka, logging as obslog, otel
from obs.kafka_propagation import extract_context

log = logging.getLogger("notification")

ORDER_PLACED_TOPIC = "order.placed"
GROUP_ID = "notification-python"


async def _record_notification(order: dict) -> str:
    pool = await db.get_pool()
    notification_id = str(uuid.uuid4())
    await pool.execute(
        "INSERT INTO notifications (notification_id, order_id, channel, status) VALUES ($1, $2, $3, $4)",
        notification_id, order["orderId"], "email", "sent",
    )
    return notification_id


async def _run() -> None:
    obslog.configure()
    otel.setup("notification")
    consumer = await obskafka.make_consumer(ORDER_PLACED_TOPIC, group_id=GROUP_ID)

    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, stop.set)

    log.info("notification consuming %s", ORDER_PLACED_TOPIC)
    try:
        async for msg in consumer:
            ctx = extract_context(msg.headers)
            with otel.tracer().start_as_current_span("notification.handle_order_placed", context=ctx):
                order = msg.value
                await _record_notification(order)
                log.info("notification sent order=%s", order["orderId"])
            if stop.is_set():
                break
    finally:
        await consumer.stop()
        await db.close_pool()


def main() -> None:
    asyncio.run(_run())


if __name__ == "__main__":
    main()
