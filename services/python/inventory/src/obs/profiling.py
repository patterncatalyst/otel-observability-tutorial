"""Continuous profiling — the fourth signal, as an optional hook.

The OpenTelemetry profiling signal (OTLP profiles) is still experimental with
nascent Python SDK support, so the pragmatic path today is Grafana's
Pyroscope SDK, which samples in-process and pushes to Pyroscope (bundled in
the otel-lgtm stack).

This is deliberately optional and side-effect-free unless asked for: it no-ops
unless PYROSCOPE_ADDRESS is set, and the import is soft so a service without the
``pyroscope-io`` dependency still starts. obs.otel.setup() calls this once at
startup.
"""
from __future__ import annotations

import os


def setup_profiling(service_name: str) -> None:
    addr = os.getenv("PYROSCOPE_ADDRESS")
    if not addr:
        return
    try:
        import pyroscope  # provided by the `pyroscope-io` package
    except ImportError:
        return
    pyroscope.configure(
        application_name=service_name,
        server_address=addr,
        tags={"service_name": service_name},
    )
