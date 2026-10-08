"""Kafka helpers: JSON-encoded events whose headers carry trace context.

The publish path injects the active trace context into the message headers (see
:mod:`obs.kafka_propagation`); the consume path is left to each service so it can
open its own processing span with the extracted context as the parent.
"""
from __future__ import annotations

import json
import os
from typing import Any

from aiokafka import AIOKafkaConsumer, AIOKafkaProducer

from . import kafka_propagation


def _bootstrap() -> str:
    return os.getenv("KAFKA_BOOTSTRAP", "kafka:9094")  # in-network listener; host clients use :9092


async def make_producer() -> AIOKafkaProducer:
    producer = AIOKafkaProducer(
        bootstrap_servers=_bootstrap(),
        value_serializer=lambda v: json.dumps(v).encode("utf-8"),
        key_serializer=lambda k: k.encode("utf-8") if k else None,
        enable_idempotence=True,
    )
    await producer.start()
    return producer


async def make_consumer(topic: str, group_id: str) -> AIOKafkaConsumer:
    consumer = AIOKafkaConsumer(
        topic,
        bootstrap_servers=_bootstrap(),
        group_id=group_id,
        value_deserializer=lambda v: json.loads(v.decode("utf-8")),
        enable_auto_commit=True,
        auto_offset_reset="earliest",
    )
    await consumer.start()
    return consumer


async def publish_event(producer: AIOKafkaProducer, topic: str, key: str, value: dict[str, Any]) -> None:
    """Publish a JSON event, stamping the current trace context into the headers
    so a downstream consumer can continue the same trace (when
    PROPAGATE_KAFKA_CONTEXT=true; see obs.kafka_propagation)."""
    headers = kafka_propagation.inject_headers()
    await producer.send_and_wait(topic, key=key, value=value, headers=headers)
