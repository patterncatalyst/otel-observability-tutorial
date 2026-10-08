---
title: "Metrics"
order: 10
part: "The signals"
description: "A custom orders_placed_total counter and a fulfillment-duration histogram, two bridge mechanisms getting them from Micrometer to OTLP, and the exemplar that links a histogram bucket straight to its trace."
---

The order service already emits one real metric: every call to `POST /orders`, on every language, increments `orders_placed_total` with a `status` tag of `PLACED` or `REJECTED`. That line of code is the anchor for this chapter, because it's the one place the three implementations converge in what they write and diverge in what happens to it next. `OrderController.java`, `OrderResource.java`, and `order/main.py` all call something that looks almost identical: `meterRegistry.counter("orders_placed_total", "status", status).increment()` in both Java services, `app.state.orders_counter.add(1, {"status": status})` in Python. What sits behind that call, and what has to happen for the number to reach Mimir with an exemplar attached, is a different pipeline in each case. This chapter follows that pipeline from the counter you already have, through a histogram you don't have yet, out to the dashboard query and the trace it links to.

{% include excalidraw.html file="ch10-metrics-exemplars" alt="Diagram of three metrics sources converging on one OTLP pipeline: Spring Boot's Micrometer MeterRegistry bridged by the OpenTelemetry Java agent, Quarkus's Micrometer MeterRegistry bridged by the quarkus-micrometer-opentelemetry build-time extension, and Python's OpenTelemetry Metrics API used directly through otel.meter(), all producing the same orders_placed_total counter and an orders.fulfillment.duration histogram with exemplars attached, exported over OTLP to Mimir for Prometheus-compatible querying, with a dashed amber arrow showing a histogram bucket's exemplar trace_id linking to a trace in Tempo" caption="Figure 10.1 — One counter and one histogram, two bridge mechanisms, one exemplar link to Tempo" %}

## Two APIs for the same measurement

OpenTelemetry defines its own [Metrics API](https://opentelemetry.io/docs/concepts/signals/metrics/): counters, histograms, gauges, and up-down counters, as a first-class signal alongside traces and logs. Python's order service uses it directly: `otel.meter()` in `obs/otel.py` returns a `Meter` created from the SDK's `MeterProvider`, and the counter used in `main.py`'s request handler is created straight from that API with no intermediary. Spring Boot and Quarkus take a different route, because the Java ecosystem had its own metrics-instrumentation library, [Micrometer](https://micrometer.io), in wide production use years before the OpenTelemetry Metrics API stabilized. Spring Boot's entire observability story, from `spring-boot-starter-actuator` to the `/actuator/prometheus` endpoint to every existing Spring application's metrics code, is built on Micrometer's `MeterRegistry`, not on OpenTelemetry's `Meter`.

Rather than asking every existing Spring and Quarkus service to rewrite its metrics code against a different API, both frameworks instead *bridge* Micrometer onto the OpenTelemetry SDK: application code keeps calling `meterRegistry.counter(...)`, `meterRegistry.timer(...)`, and so on exactly as it always has, and something underneath translates each Micrometer meter into the matching OpenTelemetry metric type, then exports it over OTLP alongside the traces and logs the same SDK already handles. That "something underneath" is where Spring Boot and Quarkus part ways again, in a pattern that should look familiar from Chapter 8.

{% include codetabs.html langs="Spring Boot|Quarkus|Python" %}
```dockerfile
# services/spring/order/Containerfile
# The javaagent's built-in Micrometer instrumentation module bridges any
# MeterRegistry bean onto the OTel SDK it already manages for traces/logs.
ENV OTEL_METRICS_EXPORTER=otlp \
    OTEL_INSTRUMENTATION_MICROMETER_ENABLED=true \
    OTEL_METRICS_EXEMPLAR_FILTER=trace_based
```
```xml
<!-- services/quarkus/order/pom.xml -->
<!-- Micrometer metrics, bridged onto the OpenTelemetry SDK (OTLP export
     + exemplars) instead of a separate Micrometer OTLP registry. -->
<dependency>
    <groupId>io.quarkus</groupId>
    <artifactId>quarkus-micrometer-opentelemetry</artifactId>
</dependency>
```
```python
# services/python/order/src/obs/otel.py
reader = PeriodicExportingMetricReader(
    OTLPMetricExporter(endpoint=f"{cfg.endpoint}/v1/metrics")
)
meter_provider = MeterProvider(resource=resource, metric_readers=[reader])
metrics.set_meter_provider(meter_provider)
```

Spring Boot's bridge is a *runtime* one: the OpenTelemetry Java agent ships a Micrometer instrumentation module, gated behind `OTEL_INSTRUMENTATION_MICROMETER_ENABLED`, which watches for `MeterRegistry` beans in the running application and mirrors every meter registered on them into the OTel SDK's own metrics pipeline — the exact same pattern as the agent's trace instrumentation from Chapter 8, just applied to a different signal. Quarkus's bridge is a *build-time* one: `quarkus-micrometer-opentelemetry` wires Micrometer's `MeterRegistry` directly onto the OpenTelemetry SDK's metrics exporter as part of the Quarkus build, with no agent and no runtime bytecode weaving involved, matching the build-time extension model Chapter 8 already established for traces. Python has no bridge at all, because it has no second metrics API competing for the same role — `otel.meter()` and the OpenTelemetry SDK are the only metrics path that exists.

The `status` tag on `orders_placed_total` is worth a closer look before adding anything else to this counter, because what you choose to tag a metric with determines how useful, and how expensive, it stays as traffic grows. `status` takes exactly two values, `PLACED` or `REJECTED`, so tagging by it produces exactly two time series no matter how many orders the service processes. Tagging the same counter by `customer_id` or `sku` instead would create one time series per distinct customer or product, a number that grows without bound as the catalog and customer base grow. Chapter 21 covers that cardinality problem in depth; the habit to form here is that a metric's tags should describe a small, closed set of states (a status, an outcome, a resource type), never an open-ended identifier that belongs on a span attribute or a log field instead, where high cardinality is normal and expected.

## Adding a histogram next to the counter

`orders_placed_total` answers "how many." It says nothing about how long an order took to process, and that is the more operationally useful question once the counter is in place: a sudden jump in `p99` fulfillment time, well before any request actually times out or fails, is usually the first sign of a slow downstream dependency. A [histogram](https://opentelemetry.io/docs/specs/otel/metrics/data-model/#histogram) records a distribution of values into predefined buckets rather than a single running total, which is what makes percentile queries like "p99 duration" possible against it later in Grafana, where a plain counter or gauge could only ever answer "the latest value" or "the running sum."

Timing the whole order-fulfillment path — from the first inventory check through the Kafka publish — and recording it as a histogram looks like this in each language:

{% include codetabs.html langs="Spring Boot|Quarkus|Python" %}
```java
// services/spring/order/src/main/java/com/example/otel/order/OrderController.java
import io.micrometer.core.instrument.Timer;

Timer.Sample sample = Timer.start(meterRegistry);
String status;
try {
    // ... checkStockWithRetry, authorizeWithRetry, insertOrder, publishOrderPlaced ...
} finally {
    sample.stop(meterRegistry.timer("orders.fulfillment.duration", "status", status));
}
meterRegistry.counter("orders_placed_total", "status", status).increment();
```
```java
// services/quarkus/order/src/main/java/com/example/otel/order/OrderResource.java
import io.micrometer.core.instrument.Timer;

Timer.Sample sample = Timer.start(meterRegistry);
String status;
try {
    // ... checkStockWithRetry, authorizeWithRetry, insertOrder, publishOrderPlaced ...
} finally {
    sample.stop(meterRegistry.timer("orders.fulfillment.duration", "status", status));
}
meterRegistry.counter("orders_placed_total", "status", status).increment();
```
```python
# services/python/order/src/order/main.py
import time

start = time.perf_counter()
try:
    # ... _check_stock_with_retry, _authorize_with_retry, repo.insert_order, publish_event ...
finally:
    duration_ms = (time.perf_counter() - start) * 1000
    app.state.fulfillment_histogram.record(duration_ms, {"status": status})
app.state.orders_counter.add(1, {"status": status})
```

The Micrometer API is literally the same four lines in Spring Boot and Quarkus: `Timer.start`, wrap the work, `sample.stop(meterRegistry.timer(...))`. Unlike Chapter 9's contrast between `GlobalOpenTelemetry` and an injected `Tracer`, which changed what the application code itself looked like, the contrast here is not in what the code looks like. It's in what happens to that identical code's output on its way out of the process. `meterRegistry.timer(name, tags...)` returns (or creates, on first call) a Micrometer `Timer`, which under the hood keeps a histogram of recorded durations; a Micrometer `Timer` is exported as an OpenTelemetry histogram metric by whichever bridge is in place, named `orders.fulfillment.duration` with a `status` attribute distinguishing `PLACED` from `REJECTED` outcomes. `app.state.fulfillment_histogram` in Python is created once at startup next to the existing counter, via `otel.meter().create_histogram("orders_fulfillment_duration_ms", unit="ms", description="Time to fulfill an order, from inventory check to Kafka publish")`, and records directly against the OTel SDK with no bridge to reason about.

One naming detail matters here, because it looks like a bug the first time you see it in Mimir. Micrometer's own naming convention favors dot-separated lowercase names, `orders.fulfillment.duration`, matching the style of Micrometer's built-in meters like `http.server.requests`. Prometheus, and by extension Mimir's query surface, expects underscore-separated names with a unit suffix on anything that isn't a bare count: `orders_fulfillment_duration_seconds`. Whichever bridge is in play, Spring's runtime one or Quarkus's build-time one, performs that translation automatically on the way out, following the same [metric name normalization](https://opentelemetry.io/docs/specs/semconv/general/metrics/) OpenTelemetry's own OTLP-to-Prometheus exposition applies: dots become underscores, and a unit based on the `Timer`'s declared base unit (seconds, by Micrometer's convention) gets appended. Querying for `orders_fulfillment_duration_seconds_bucket` in PromQL after writing `orders.fulfillment.duration` in Java code is expected, not a sign the metric failed to export. `orders_placed_total`, by contrast, was written directly in the already-Prometheus-shaped form: underscores, a `_total` suffix matching Prometheus's own counter-naming convention, so a reader grepping for it in either the Java source or a Mimir query sees the identical string, with no translation step to account for.

## Exemplars: a histogram bucket that remembers a trace ID

A histogram alone tells you *that* p99 latency spiked at 14:32. It doesn't tell you *which* request caused it, and normally the only way to find out is to go hunting through traces from around that timestamp and hope you land on the right one. [Exemplars](https://opentelemetry.io/docs/specs/otel/metrics/data-model/#exemplars) close exactly that gap: a sampled data point attached to a histogram bucket, carrying the trace ID and span ID that were active on the current context at the moment that specific measurement was recorded. Record a duration while a trace is in progress, and the resulting histogram data point can carry a pointer straight back to that trace — not an aggregate, one specific sample, chosen by the SDK's exemplar reservoir so the stored example is representative of what landed in that bucket.

The mechanism that makes this automatic rather than something you wire up by hand is `OTEL_METRICS_EXEMPLAR_FILTER=trace_based`, set in both the Spring Boot and Python Containerfiles shown earlier in this chapter. It tells each SDK to attach an exemplar to a metric data point whenever a sampled trace is active on the context at recording time, with no extra code at the measurement call site. `sample.stop(...)` and `app.state.fulfillment_histogram.record(...)` both execute from inside the `POST /orders` handler, still within the auto-generated root span from Chapter 8 and possibly within one of Chapter 9's manual child spans too, so every fulfillment-duration measurement has a live trace context to attach automatically. Quarkus needs no equivalent environment variable: `quarkus-micrometer-opentelemetry`'s build-time bridge attaches exemplars as part of translating a Micrometer `Timer` into an OpenTelemetry histogram, a default of the bridge rather than a separate opt-in switch. That is the same pom.xml comment from earlier in this chapter, "OTLP export + exemplars," spelled out as behavior now instead of as a dependency.

Grafana is the one place this pays off visibly, and it's the only GUI this tutorial relies on for a reason: a histogram panel backed by `orders.fulfillment.duration` renders small diamond markers above the buckets where exemplars were captured, and clicking one jumps directly into the matching trace in Tempo, pre-selected, with no manual trace-ID lookup in between. The same data is reachable from Mimir's Prometheus-compatible query API without the UI, for scripting or alert-rule evaluation:

```sh
curl -s 'http://localhost:9090/prometheus/api/v1/query' \
  --data-urlencode 'query=histogram_quantile(0.99, sum(rate(orders_fulfillment_duration_bucket[5m])) by (le))'
```

`trace_based` is one of several values the exemplar filter can take, and the name states its condition precisely: an exemplar attaches only when a sampled trace is active on the context at the moment of recording. If Chapter 20's sampling configuration later drops a given request's trace before it's ever exported, that request's measurements still land in the histogram's buckets — the count and the sum are unaffected — but no exemplar accompanies them, because there's no sampled trace left to point to. This is a deliberate trade-off, not a leak: exemplars are a sampled, representative pointer back to a trace that exists to export, not a guarantee that every single data point carries one, and a dashboard reading the histogram's aggregate values stays correct regardless of how many of its contributing measurements happened to have a live exemplar attached.

That query answers "what is p99 order-fulfillment latency over the last five minutes" directly from the metric, across all three language implementations, with identical PromQL regardless of which bridge produced the underlying data — Mimir has no idea whether a given histogram arrived via the Java agent's runtime bridge, Quarkus's build-time one, or Python's direct SDK call, because by the time it's OTLP on the wire, the bridge has already done its job and disappeared. ## Checking the counter before it ever reaches Mimir

It's worth confirming `orders_placed_total` exists at the source before trusting the OTLP pipeline to have carried it anywhere, and the three services don't offer identical ways to do that. Spring Boot's `management.endpoints.web.exposure.include=health,info,prometheus` setting, already present in `application.properties` for unrelated health-check reasons, has the side effect of exposing a pull-based `/actuator/prometheus` endpoint, so `curl http://localhost:8080/actuator/prometheus | grep orders_placed_total` shows the counter directly from Micrometer's own registry, entirely independent of whether the OTLP export is working. Quarkus's `order` service has no equivalent endpoint here: `quarkus-micrometer-opentelemetry` wires Micrometer straight to the OTel SDK's push-based OTLP exporter without also registering a pull-based Prometheus registry, so there is no `/q/metrics` to scrape unless `quarkus-micrometer-registry-prometheus` is added alongside it — the counter is verifiable only by confirming it arrived in Mimir, not by asking the Quarkus process directly. Python has no pull endpoint by design in either case, since `otel.meter()` only ever pushes via `PeriodicExportingMetricReader`; the terminal-level check there is the structured log line `order placed id=... status=...` that fires on the same code path as the counter increment, which is a correlated signal, not the metric itself, but close enough to confirm the handler ran if Mimir's query comes back empty.

That is the real outcome of this chapter's two-bridge, one-API story: the mechanism differs by language exactly as it did for traces in Chapter 8, but the metric a dashboard or an alert rule reasons about is the same shape everywhere, and the one exemplar click that takes you from a latency spike to the specific trace that caused it works the same way regardless of which stack produced it.
