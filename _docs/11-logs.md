---
title: "Logs"
order: 11
part: "The signals"
description: "Structured logs carrying trace_id and span_id into Loki, and the one resource attribute all four signals must agree on for correlation to work."
---

A log line without a trace ID is an island. It tells you something happened, roughly when, and at what severity, but it cannot tell you which request caused it, what else happened in that same request, or how it relates to the span that was active at the time. The fix is not a new logging framework. It is attaching two fields, `trace_id` and `span_id`, to every log record emitted while a trace is active, so a line in Loki and a span in Tempo can be joined by an identifier instead of a guess about timestamps. This chapter covers how each of the three stacks in this tutorial gets those fields onto the record and ships the result to Loki, and it covers a bug that shipped in this very repository's Python services: a single resource attribute, `service.name`, that every signal has to agree on, or the whole correlation chain breaks silently.

## Why trace-stamped logs instead of a smarter log search

Before OpenTelemetry, correlating a log line to a request meant either embedding a request ID by hand at every service boundary and threading it through every log call, or falling back to timestamp-based guesswork across services that do not share a clock. Both approaches work until the system has more than a couple of hops, at which point the manual request ID either gets dropped somewhere or the timestamps drift enough to make the correlation unreliable.

OpenTelemetry's context propagation already solves the harder version of this problem for traces: a trace ID and span ID exist for the duration of a traced operation and travel automatically across HTTP, gRPC, and (with explicit code, as the [Kafka chapter](13-context-propagation-kafka.html) in this tutorial covers) asynchronous messaging. Reusing that identifier for logs is nearly free once the trace already exists: read the active span's context at the moment a log statement fires, and stamp its IDs onto the record. The [OpenTelemetry logs documentation](https://opentelemetry.io/docs/concepts/signals/logs/) describes this as log-trace correlation, and every stack here implements it slightly differently, but the destination is the same: a log line in Loki carrying `trace_id`, and a Tempo trace whose "logs for this span" link finds it.

## Spring Boot: the javaagent writes the MDC for you

Spring Boot's logging path in this tutorial runs through Logback, and the application code never touches trace context directly. The OpenTelemetry Java agent, attached at the JVM level via `-javaagent` (see `entrypoint.sh` in each Spring service, which always attaches it unless `OTEL_SDK_DISABLED=true`), instruments Logback's MDC — mapped diagnostic context — so that `trace_id`, `span_id`, and `trace_flags` are populated on every log statement issued while a span is active. No application code sets these keys; the instrumentation does it as a side effect of the agent watching Logback's internals.

`logback-spring.xml`, shared in shape across every Spring service in this tutorial, reads those MDC keys with the standard `%X{key}` pattern syntax:

```xml
<pattern>%d{HH:mm:ss.SSS} %-5level [%X{trace_id:-}/%X{span_id:-}] [%logger{36}] %msg%n</pattern>
```

The `:-` fallback means a log line issued outside any trace — at startup, say — prints a dash instead of an empty bracket, which keeps the console output readable in both states. This same pattern string appears on both the `CONSOLE` appender, which is what you see when the container is running interactively, and the `FILE` appender, which is a persistent, grep-able record aimed specifically at the Claude Code diagnostic workflow this tutorial's demo scripts rely on — a place to look after a run finishes rather than a live tail.

Crucially, neither of those appenders is what gets the logs into Loki. The OpenTelemetry Java agent attaches its own OTLP logback appender, invisible in `logback-spring.xml` because it is injected by the agent at runtime rather than configured in XML, and that appender exports every record over OTLP independently of whatever the FILE and CONSOLE appenders are doing. This separation matters when you are debugging why a log reached (or did not reach) Loki: the file on disk and the record in Loki come from two different appenders reading the same underlying log event, and one can work while the other is misconfigured. If Loki is missing a log line that is clearly sitting in `logs/order-spring.log`, the bug is in the agent's OTLP log export path (an unreachable Collector endpoint, `OTEL_LOGS_EXPORTER` not set to `otlp`), not in Logback.

## Quarkus: the extension bridges, not the logging framework

Quarkus takes a different path to the same destination. Rather than attaching an external agent, the `quarkus-opentelemetry` extension is a compile-time dependency, already pulled into every Quarkus service's `pom.xml` for its traces and metrics support, and it includes a log handler that bridges Quarkus's native logging framework (JBoss Logging) onto the OpenTelemetry Logs API. Turning it on is a single property:

```properties
quarkus.otel.logs.enabled=true
```

With that set, every log record Quarkus emits is handed to the OTel SDK's logger provider in addition to whatever console or file appenders are configured, and the bridge stamps the active trace context onto the record the same way the Java agent does for Spring — the mechanism differs, the outcome does not. The `quarkus.log.console.format` and `quarkus.log.file.format` properties in each service's `application.properties` reference `%X{traceId}`, `%X{spanId}`, and `%X{sampled}` for the human-facing console and file views, which is the Quarkus naming convention (camelCase, matching its own MDC keys) rather than the OpenTelemetry semantic convention's `trace_id`/`span_id` used by the Java agent and by the records the bridge itself exports over OTLP — a small but real naming difference worth knowing before you go looking for one key and find the other.

One property is easy to get wrong by analogy with the OTel SDK's own environment variable autoconfiguration: `quarkus.otel.exporter.otlp.endpoint` does not fall back to the plain `OTEL_EXPORTER_OTLP_ENDPOINT` environment variable on its own. That fallback behavior is a convention of the OpenTelemetry SDK's generic autoconfigure module, not something SmallRye Config or Quarkus's own configuration layer does automatically. Every `application.properties` in this tutorial's Quarkus services maps it explicitly:

```properties
quarkus.otel.exporter.otlp.endpoint=${OTEL_EXPORTER_OTLP_ENDPOINT:http://lgtm:4318}
quarkus.otel.exporter.otlp.protocol=${OTEL_EXPORTER_OTLP_PROTOCOL:http/protobuf}
```

Skip that mapping and the exporter silently defaults to `localhost:4317` over gRPC, which is wrong on every count in this topology — wrong host, wrong port, wrong protocol — and traces, metrics, and logs all fail to export with no immediately obvious error, because the Quarkus process still starts and serves requests normally. It just never tells anyone about it.

## Python: structured JSON first, OTLP bridge second

The Python services run two logging paths in parallel, and the order they are configured in matters. `obs.logging.configure()` sets up a stdout handler that formats every record as JSON, with a `TraceContextFilter` that reads the current span's context and stamps `trace_id` and `span_id` onto the record (falling back to `"-"` when there is no active span, the same convention Spring's pattern uses). This is the view `podman logs` shows during local development — plain JSON on stdout, independent of whether the OTel SDK has even started yet.

`obs.otel.setup()` then appends a second handler to the root logger: `LoggingHandler`, from `opentelemetry.sdk._logs`, bound to a `LoggerProvider` wired with a `BatchLogRecordProcessor` and an `OTLPLogExporter` pointed at the Collector's `/v1/logs` endpoint. This handler is the OpenTelemetry Python distro's standard log correlation mechanism: it reads the SDK's own notion of the active span context and auto-stamps `trace_id`/`span_id` onto the OTLP log record it exports, independently of the JSON formatter's filter. Because `configure()` resets the root logger's handler list and `setup()` only appends, the ordering in each service's startup — JSON stdout handler first, OTLP handler second — is not cosmetic; reversing it would wipe out the OTLP handler the moment `configure()` ran afterward.

## One logs pipeline in the Collector, regardless of stack

Once a log record leaves any of the three services, it stops being Spring, Quarkus, or Python's problem. All three export logs over OTLP/HTTP to the same Collector endpoint, `http://lgtm:4318/v1/logs`, and from that point forward the path is identical regardless of which stack produced the record. `stack/otelcol/config.yaml` defines one `logs` pipeline — `memory_limiter` to protect the Collector itself from a burst of volume, `resource` to backfill `deployment.environment` on records that do not already carry it, `batch` to amortize the cost of the next hop — ending in a single exporter, `otlphttp/loki`, pointed at Loki's own OTLP ingestion endpoint, `/otlp`, rather than the older push-API most Loki tutorials assume.

This matters for two reasons beyond tidiness. First, it means a change to how logs are processed before they land in Loki — adding a redaction processor for PII, say, or dropping debug-level records above a certain volume — is a one-line addition to this one pipeline definition, not six separate changes across Java and Python logging configuration. Second, it is why the logs-to-trace correlation in the next chapter works the way it does: because every service's logs arrive at Loki over OTLP rather than as scraped plain-text files, `trace_id` arrives as structured metadata on the log record itself, not as a substring Loki's query engine has to regex out of a message body. That distinction is invisible until something goes looking for it, and it is the direct, mechanical reason `filterByTraceID` queries in Grafana are exact-match lookups rather than best-effort text search.

## The bug: one service.name, or correlation breaks silently

Every signal in this tutorial's OpenTelemetry SDK setup is tagged with a `Resource`, and the single attribute every other signal depends on most to find its siblings is `service.name`. Grafana's correlation provisioning (covered in the [correlation chapter](16-correlation.html)) matches traces to logs to metrics to profiles by, among other things, that name. If one signal reports a different `service.name` than the others for what is actually the same process, every cross-signal link quietly points at the wrong service, or at nothing.

This tutorial's Python services shipped exactly that bug during development. `compose.yaml` sets `OTEL_SERVICE_NAME` to a value like `order-python` for each Python service — matching the convention the zero-code `opentelemetry-instrument` launcher and the Collector both expect — and the auto-instrumentation picked that up correctly for traces and metrics, since the launcher reads `OTEL_SERVICE_NAME` itself. But `obs.otel.setup(service_name)` was originally called with the bare name, `"order"`, and used that parameter directly to build the `Resource` for the manually-wired log and profile signals. The result: traces and metrics for a service showed up in Grafana as `order-python`, while that same process's logs landed in Loki and its profiles landed in Pyroscope under the bare name `order`. Nothing crashed. Nothing logged an error. The four signals simply described two different services as far as any correlation query was concerned, and a trace-to-logs click-through from a span on `order-python` would never find a matching log line, because none existed under that name.

The fix is to resolve `OTEL_SERVICE_NAME` before anything else and prefer it over the function argument:

```python
cfg = ObsConfig(service_name=os.getenv("OTEL_SERVICE_NAME") or service_name)
```

That one line is the entire fix, and it generalizes beyond this specific bug: whenever a service's identity is configurable from more than one place, pick a single source of truth and have every code path that builds a `Resource` read from it, rather than letting each call site default independently. Spring and Quarkus do not have this particular bug in this tutorial, but only because their frameworks resolve `service.name` through a single path already — the Java agent reads `OTEL_SERVICE_NAME` (falling back to `spring.application.name`) for every signal uniformly, and Quarkus does the same via `quarkus.application.name` feeding `quarkus.otel.*`. The lesson is not "Python is fragile." It is that any setup wiring four exporters by hand, as the Python services here do to demonstrate the mechanics, re-creates a consistency problem that a single integrated agent solves for you, and that problem deserves a name rather than an assumption that it cannot happen.

## Verifying it from the outside

The fastest way to catch this class of bug without staring at code is to query Loki directly for a service name and see whether anything comes back:

```bash
curl -s -G "http://localhost:3100/loki/api/v1/label/service_name/values" | jq .
```

If a service appears in Tempo's service list (queryable the same way, or visible in Grafana's Explore view against the Tempo datasource) but is absent from this list, the two signals disagree about that service's name, and the fix is almost always the same shape as the one above: find where the `Resource` for the missing signal is built, and confirm it reads from the same source as the resource for the signal that is present.

A LogQL query that filters on a known `trace_id` is a second, more targeted check, and the one that actually caught the bug described above during this tutorial's own development:

```bash
curl -s -G "http://localhost:3100/loki/api/v1/query_range" \
  --data-urlencode 'query={service_name="order-python"} | trace_id="<id from a Tempo trace>"' \
  --data-urlencode "start=$(date -d '-10 minutes' +%s)000000000" \
  --data-urlencode "end=$(date +%s)000000000"
```

Run against a `trace_id` copied from a trace that visibly touched the order service in Tempo, this returned nothing under `service_name="order-python"` before the fix — not because the log line did not exist, but because it had been written under `service_name="order"` instead. Re-running the same query with the bare name present confirmed the record was there all along, just filed under the wrong label. That one-line diagnosis — present under one name, absent under the other — is the fastest way to distinguish "the log was never exported" from "the log exported fine, but under a name nothing else agrees on," and the second case is almost always a `Resource` built from a different source than its sibling signals.

{% include excalidraw.html file="ch11-logs-pipeline" alt="Spring Boot, Quarkus, and Python each stamp trace_id and span_id onto their logs through different mechanisms (javaagent MDC, OTel log bridge, JSON logging plus LoggingHandler) and ship them via OTLP through the Collector to Loki; a callout shows the Python service.name mismatch between logs/profiles and traces/metrics, fixed by resolving OTEL_SERVICE_NAME first" caption="Figure 11.1 — Three paths to the same trace-stamped log line, and the one resource attribute they all have to agree on" %}

## Codetabs: getting trace context onto the log line

The three snippets below show the mechanism each stack relies on to associate a log record with the active trace: Spring's Logback pattern reading agent-populated MDC keys, Quarkus's property turning on the log bridge, and Python's filter stamping the context by hand.

{% include codetabs.html langs="Spring Boot|Quarkus|Python" %}

```xml
<!-- services/spring/order/src/main/resources/logback-spring.xml -->
<!-- trace_id/span_id are populated by the OpenTelemetry Java agent's
     Logback MDC instrumentation; no application code sets them. -->
<appender name="CONSOLE" class="ch.qos.logback.core.ConsoleAppender">
  <encoder>
    <pattern>%d{HH:mm:ss.SSS} %-5level [%X{trace_id:-}/%X{span_id:-}] [%logger{36}] %msg%n</pattern>
  </encoder>
</appender>
```

```properties
# services/quarkus/order/src/main/resources/application.properties
# The quarkus-opentelemetry extension's log bridge exports every record
# over OTLP with trace context attached. The console/file formats below
# are for the human-facing view and use Quarkus's own MDC key names.
quarkus.otel.logs.enabled=true
quarkus.log.console.format=%d{HH:mm:ss.SSS} %-5p traceId=%X{traceId}, spanId=%X{spanId}, sampled=%X{sampled} [%c{3.}] (%t) %s%e%n
```

```python
# services/python/order/src/obs/logging.py
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
```

## Codetabs: one service.name, resolved once

This second group is the fix for the bug described above: each stack's single point of truth for the name every exported signal carries.

{% include codetabs.html langs="Spring Boot|Quarkus|Python" %}

```properties
# services/spring/order/src/main/resources/application.properties
# The OpenTelemetry Java agent reads OTEL_SERVICE_NAME (set in compose.yaml)
# ahead of this value for every signal it exports, so traces, metrics, and
# logs all carry the same service.name without any extra code here.
spring.application.name=order-spring
```

```properties
# services/quarkus/order/src/main/resources/application.properties
# quarkus.application.name feeds quarkus.otel.* uniformly across traces,
# metrics, and the log bridge — one property, every signal agrees.
quarkus.application.name=order-quarkus
```

```python
# services/python/order/src/obs/otel.py
# The zero-code opentelemetry-instrument launcher and the Collector key
# traces/metrics off OTEL_SERVICE_NAME (compose sets it to "<name>-python").
# Prefer it here too so the manually-wired log and profile signals carry the
# SAME service.name; otherwise logs land in Loki (and profiles in Pyroscope)
# under the bare name while traces/metrics use "<name>-python", silently
# breaking the trace<->log<->profile correlation in Grafana.
cfg = ObsConfig(service_name=os.getenv("OTEL_SERVICE_NAME") or service_name)
```

Further reading: the [OpenTelemetry documentation on logs](https://opentelemetry.io/docs/concepts/signals/logs/) covers the logs data model and trace-correlation concept this chapter builds on in detail.
