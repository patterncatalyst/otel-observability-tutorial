"""Structured JSON logging that stamps every line with the active trace and span
ids, so a log in Loki links straight to its trace in Tempo.

The ids are the join key. Grafana's Loki-to-Tempo correlation is configured to
pull ``trace_id`` out of the log line; emitting it on every record is what makes
"jump from this log to its trace" a single click instead of a manual hunt.
"""
from __future__ import annotations

import json
import logging
import sys

from opentelemetry import trace


class TraceContextFilter(logging.Filter):
    """Inject trace_id/span_id (or '-') onto every record."""

    def filter(self, record: logging.LogRecord) -> bool:
        span = trace.get_current_span()
        ctx = span.get_span_context() if span else None
        if ctx and ctx.is_valid:
            record.trace_id = format(ctx.trace_id, "032x")
            record.span_id = format(ctx.span_id, "016x")
        else:
            record.trace_id = "-"
            record.span_id = "-"
        return True


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "ts": self.formatTime(record, "%Y-%m-%dT%H:%M:%S%z"),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
            "trace_id": getattr(record, "trace_id", "-"),
            "span_id": getattr(record, "span_id", "-"),
        }
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        return json.dumps(payload)


def configure(level: int = logging.INFO) -> logging.Logger:
    """Configure root logging to emit trace-stamped JSON to stdout — the local
    ``podman logs`` view. Call this *before* ``obs.otel.setup``, which then
    appends an OTLP handler so the same records also reach the Collector (and
    Loki) over the OpenTelemetry log signal, auto-stamped with trace context."""
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    handler.addFilter(TraceContextFilter())

    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(level)

    # Quiet noisy drivers; keep application loggers verbose.
    logging.getLogger("aiokafka").setLevel(logging.WARNING)
    logging.getLogger("asyncpg").setLevel(logging.WARNING)
    logging.getLogger("uvicorn.access").setLevel(logging.INFO)
    return root
