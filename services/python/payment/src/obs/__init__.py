"""obs — shared OpenTelemetry bootstrap and plumbing, vendored into every
Python service in this tutorial.

Each services/python/<domain>/ directory is its own podman/docker build
context (see stack/compose.yaml), so this package is copied identically into
every service rather than shared via a path dependency — there is no way for
a Containerfile to COPY files from outside its own build context without a
multi-context buildx feature the project's compose file does not use. Treat
this directory as generated/vendored: the canonical copy lives in
services/python/order/src/obs and is byte-for-byte duplicated into the other
five services.

Typical service startup:

    from obs import otel, logging as obslog
    obslog.configure()
    otel.setup("order")               # traces + metrics + logs + auto-instrumentation
    # ... for an HTTP service, once the app exists:
    otel.instrument_fastapi(app)
"""
from . import otel, kafka, kafka_propagation, db, logging, profiling  # noqa: F401

__all__ = ["otel", "kafka", "kafka_propagation", "db", "logging", "profiling"]
