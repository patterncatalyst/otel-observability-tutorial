"""OpenTelemetry bootstrap shared by every service.

One call to :func:`setup` wires the SDK the same way everywhere: a shared
resource (who am I), OTLP/HTTP exporters for all three signals pointed at the
Collector, and a W3C trace-context + baggage propagator. It then turns on the
instrumentation that `opentelemetry-instrument` (the zero-code auto
entrypoint wrapping every service's ENTRYPOINT — see the Containerfile) does
not reliably cover on its own: the asyncio gRPC client/server instrumentors
(the generic zero-code `grpc` hook only wires the synchronous API, not
`grpc.aio`, which every service here uses) and asyncpg.

Running both `opentelemetry-instrument` *and* this manual setup is
deliberate, matching the brief's "auto-instrumentation plus a manual SDK
setup": whichever one runs first wins the provider registration (the
OpenTelemetry API refuses a second `set_*_provider` call and logs a harmless
warning instead of raising), so there is no double export; this module's
real job is the parts neither the launcher nor the instrumentation packages
do automatically — the aio gRPC instrumentors, the Pyroscope profiler hook,
and (for HTTP services) wiring FastAPI to the live `app` object.

The one hop that is deliberately NOT auto-propagated by any of this is
Kafka: carrying trace context across that asynchronous boundary is done
explicitly with :mod:`obs.kafka_propagation`, gated by
`PROPAGATE_KAFKA_CONTEXT` so the tutorial can demonstrate the trace breaking
at the message boundary and then show the fix.
"""
from __future__ import annotations

import logging
import os
from dataclasses import dataclass

from opentelemetry import metrics, trace
from opentelemetry.baggage.propagation import W3CBaggagePropagator
from opentelemetry.exporter.otlp.proto.http._log_exporter import OTLPLogExporter
from opentelemetry.exporter.otlp.proto.http.metric_exporter import OTLPMetricExporter
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry._logs import set_logger_provider
from opentelemetry.propagate import set_global_textmap
from opentelemetry.propagators.composite import CompositePropagator
from opentelemetry.sdk._logs import LoggerProvider, LoggingHandler
from opentelemetry.sdk._logs.export import BatchLogRecordProcessor
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.trace.propagation.tracecontext import TraceContextTextMapPropagator


@dataclass(frozen=True)
class ObsConfig:
    service_name: str
    service_version: str = os.getenv("SERVICE_VERSION", "dev")
    environment: str = os.getenv("DEPLOY_ENV", "local")
    # Path-less OTLP/HTTP base; the SDK appends /v1/traces, /v1/metrics, /v1/logs.
    endpoint: str = os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://lgtm:4318")
    disabled: bool = os.getenv("OTEL_SDK_DISABLED", "false").lower() == "true"


_TRACER = None
_METER = None


def setup(service_name: str) -> ObsConfig:
    """Initialise tracing, metrics, and logs for this process. Call once at
    startup (idempotent-ish: a second call from another entrypoint, e.g. the
    opentelemetry-instrument launcher, just gets a harmless "provider already
    set" warning). Returns the resolved config for logging/diagnostics."""
    global _TRACER, _METER
    cfg = ObsConfig(service_name=service_name)

    # Baggage must ride alongside trace context on every hop (HTTP, gRPC) so
    # inventory/payment can read cart.id — tracecontext alone would drop it.
    set_global_textmap(
        CompositePropagator([TraceContextTextMapPropagator(), W3CBaggagePropagator()])
    )

    if cfg.disabled:
        # Baseline demo: the SDK is off, the service is fully opaque on purpose.
        _TRACER = trace.get_tracer(service_name)
        _METER = metrics.get_meter(service_name)
        return cfg

    resource = Resource.create(
        {
            "service.name": cfg.service_name,
            "service.version": cfg.service_version,
            "deployment.environment": cfg.environment,
        }
    )

    # --- traces ---
    tracer_provider = TracerProvider(resource=resource)
    tracer_provider.add_span_processor(
        BatchSpanProcessor(OTLPSpanExporter(endpoint=f"{cfg.endpoint}/v1/traces"))
    )
    trace.set_tracer_provider(tracer_provider)

    # --- metrics --- (exemplars linking metrics->trace_id are enabled via
    # OTEL_METRICS_EXEMPLAR_FILTER=trace_based, set in the Containerfile)
    reader = PeriodicExportingMetricReader(
        OTLPMetricExporter(endpoint=f"{cfg.endpoint}/v1/metrics")
    )
    meter_provider = MeterProvider(resource=resource, metric_readers=[reader])
    metrics.set_meter_provider(meter_provider)

    # --- logs ---
    logger_provider = LoggerProvider(resource=resource)
    logger_provider.add_log_record_processor(
        BatchLogRecordProcessor(OTLPLogExporter(endpoint=f"{cfg.endpoint}/v1/logs"))
    )
    set_logger_provider(logger_provider)
    # Bridge stdlib logging onto the OTLP log signal. This SDK handler exports every
    # record to the Collector, which routes it to Loki — and the SDK auto-stamps the
    # active trace_id/span_id onto each record, so the log<->trace correlation holds
    # without anyone parsing a stdout line. obs.logging.configure() keeps a separate
    # stdout JSON handler (with its own trace_id field) as the local `podman logs`
    # view, so it must run *before* setup() (this appends; configure() resets handlers).
    logging.getLogger().addHandler(
        LoggingHandler(level=logging.NOTSET, logger_provider=logger_provider)
    )

    _TRACER = trace.get_tracer(service_name)
    _METER = metrics.get_meter(service_name)
    _enable_auto_instrumentation()

    # Fourth signal (optional): continuous profiling via Pyroscope. No-ops unless
    # PYROSCOPE_ADDRESS is set and the pyroscope SDK is installed. See obs.profiling.
    from . import profiling
    profiling.setup_profiling(service_name)
    return cfg


def _enable_auto_instrumentation() -> None:
    """Turn on instrumentation the zero-code `opentelemetry-instrument`
    launcher doesn't reliably cover for an asyncio service. Each import is
    local and guarded so a service that lacks one of these libraries (or
    that opentelemetry-instrument already instrumented) still starts."""
    try:
        from opentelemetry.instrumentation.asyncpg import AsyncPGInstrumentor
        AsyncPGInstrumentor().instrument()
    except Exception:
        pass
    try:
        from opentelemetry.instrumentation.grpc import (
            GrpcAioInstrumentorClient,
            GrpcAioInstrumentorServer,
        )
        GrpcAioInstrumentorClient().instrument()
        GrpcAioInstrumentorServer().instrument()
    except Exception:
        pass


def instrument_fastapi(app) -> None:
    """FastAPI is instrumented against the live app object, so services that
    serve HTTP call this from their startup once the app exists."""
    if os.getenv("OTEL_SDK_DISABLED", "false").lower() == "true":
        return
    try:
        from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
        FastAPIInstrumentor.instrument_app(app)
    except Exception:
        pass


def tracer():
    return _TRACER if _TRACER is not None else trace.get_tracer("uninitialised")


def meter():
    return _METER if _METER is not None else metrics.get_meter("uninitialised")
