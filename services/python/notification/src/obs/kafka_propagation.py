"""Carry W3C trace context across the Kafka boundary.

OpenTelemetry's HTTP and gRPC instrumentation propagate context automatically
because those protocols have a natural place to put headers and the instrumented
client writes them for you. A Kafka message is just bytes on a topic — nothing
writes the ``traceparent`` for you — so unless we inject the active context into
the message headers on the producer side and extract it on the consumer side,
the consumer starts a brand-new, disconnected trace.

These two helpers are that bridge, and they are the entire trick behind keeping
one trace alive across the async hop:

- :func:`inject_headers` reads the currently-active span context and serialises
  it into a list of Kafka header tuples.
- :func:`extract_context` reverses it on the consumer, returning a context you
  attach while you process the message so your processing span links back to the
  producer's span as its parent.

Both are gated by ``PROPAGATE_KAFKA_CONTEXT``: default true (continue the
trace); the auto-vs-manual-instrumentation chapter sets it to false to show
the trace visibly breaking at the message boundary.
"""
from __future__ import annotations

import os
from typing import Iterable

from opentelemetry import propagate
from opentelemetry.context import Context


def _enabled() -> bool:
    return os.getenv("PROPAGATE_KAFKA_CONTEXT", "true").lower() != "false"


def inject_headers(existing: Iterable[tuple] | None = None) -> list[tuple[str, bytes]]:
    """Return Kafka headers carrying the active trace context, merged with any
    headers the caller already wants to send. aiokafka headers are
    ``list[tuple[str, bytes]]``."""
    headers: list[tuple[str, bytes]] = list(existing or [])
    if not _enabled():
        return headers
    carrier: dict[str, str] = {}
    propagate.inject(carrier)  # writes 'traceparent' (and 'baggage') into carrier
    headers.extend((k, v.encode("utf-8")) for k, v in carrier.items())
    return headers


def extract_context(headers: Iterable[tuple[str, bytes]] | None) -> Context:
    """Rebuild the propagated context from a consumed message's headers. Attach
    the result (``opentelemetry.context.attach``) or pass it as the span's
    context so the processing span becomes a child of the producing span."""
    if not _enabled():
        return Context()
    carrier: dict[str, str] = {}
    for key, value in headers or []:
        carrier[key] = value.decode("utf-8") if isinstance(value, (bytes, bytearray)) else str(value)
    return propagate.extract(carrier)
