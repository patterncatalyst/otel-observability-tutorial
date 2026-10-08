---
title: "The Collector"
order: 19
part: "Making signals useful"
description: "Collector pipelines as receivers, processors, and exporters, and why cross-cutting decisions like batching, redaction, and routing belong there instead of in application code."
---

Every service in this tutorial sends its telemetry to the same place first: an OpenTelemetry Collector, not directly to Tempo, Mimir, or Loki. That extra hop is easy to dismiss as plumbing, but it is the point where a set of decisions that have nothing to do with any individual service's business logic get made once, in one configuration file, instead of being re-implemented inside every service that exists today and every service written after this tutorial is finished.

## Receivers, processors, exporters

The Collector's configuration is built from three kinds of components, assembled into a pipeline per signal type. A receiver accepts telemetry arriving from somewhere, in whatever protocol it arrives in. A processor transforms, filters, batches, or otherwise manipulates telemetry already inside the Collector. An exporter sends telemetry on to wherever it is ultimately headed. A pipeline is a declared sequence: one or more receivers feeding a list of processors, in order, feeding one or more exporters. The order of processors is not cosmetic; data flows through them top to bottom, and a processor placed in the wrong position does the wrong job or does the right job too late.

The base configuration for this stack, `stack/otelcol/config.yaml`, declares exactly this shape for three pipelines, one each for traces, metrics, and logs:

```yaml
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318

processors:
  memory_limiter:
    check_interval: 1s
    limit_mib: 512
    spike_limit_mib: 128

  batch:
    timeout: 200ms
    send_batch_size: 8192

  resource:
    attributes:
      - key: deployment.environment
        value: local
        action: upsert

exporters:
  otlphttp/tempo:
    endpoint: http://localhost:3200
    tls:
      insecure: true

  prometheusremotewrite:
    endpoint: http://localhost:9090/api/v1/write
    tls:
      insecure: true

  otlphttp/loki:
    endpoint: http://localhost:3100/otlp
    tls:
      insecure: true

service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [memory_limiter, resource, batch]
      exporters: [otlphttp/tempo]
    metrics:
      receivers: [otlp]
      processors: [memory_limiter, resource, batch]
      exporters: [prometheusremotewrite]
    logs:
      receivers: [otlp]
      processors: [memory_limiter, resource, batch]
      exporters: [otlphttp/loki]
```

A single `otlp` receiver, listening on both gRPC (4317) and HTTP (4318), feeds all three pipelines, because every service in this tutorial, regardless of language or framework, speaks OTLP. The three pipelines diverge only in their exporter, since traces, metrics, and logs are ultimately different data shapes headed to different backends: Tempo for traces, Prometheus's remote-write API (backed by Mimir) for metrics, and Loki's OTLP ingestion endpoint for logs. Everything upstream of the exporter, the receiver and the processor chain, is identical across all three: the decisions encoded in that shared chain apply uniformly to every signal a service emits, with no separate configuration to keep in sync per signal type.

## memory_limiter: the processor that keeps the lights on

The [OpenTelemetry Collector documentation](https://opentelemetry.io/docs/collector/) describes `memory_limiter` as a processor for preventing out-of-memory situations, and it is placed first in every pipeline in this configuration for exactly that reason. A Collector sits between every service and the backends that store telemetry, which makes it a chokepoint: if telemetry volume spikes, whether from an actual traffic surge, a retry storm, or a misconfigured service suddenly emitting far more spans than expected, the Collector is where that spike lands first. Without a limiter, the Collector tries to buffer and process all of it, memory usage climbs without bound, and the process gets killed by the OS, at precisely the moment observability into the underlying incident is most needed. `memory_limiter` checks memory usage on an interval (`check_interval: 1s` here) and begins refusing or dropping data once usage crosses the configured `limit_mib`, with a `spike_limit_mib` buffer that allows brief, legitimate bursts without tripping the limit immediately. Placing it first in the chain means an overload is caught before any other processor does further work on data that might get dropped anyway.

## resource: filling in what services don't

The `resource` processor attaches attributes to every record passing through it, here stamping `deployment.environment: local` onto every span, metric, and log line. This is a small example of a broader pattern: a service emitting telemetry rarely has a complete picture of its own deployment context. It knows its own name and version, if instrumented well, but it typically does not know, or should not need to know, which environment it is running in, which cluster, which region. That context belongs to the deployment layer, not the application, and the Collector is a natural place to attach it uniformly, because every service's telemetry passes through the same Collector configuration regardless of which team wrote the service or which language it is written in. A service does not need an environment variable threaded through its instrumentation code to tag its own telemetry correctly; the Collector tags it on the way through.

## batch: paying for network calls in bulk

`batch` is positioned last in this configuration's processor chain, after `memory_limiter` and `resource`, because its job is pure efficiency: accumulate spans, metrics, or log records into groups before handing them to the exporter, rather than making one outbound network call per individual record. The two settings shown, `timeout: 200ms` and `send_batch_size: 8192`, mean the Collector flushes whichever threshold comes first: as soon as 8,192 records have accumulated, or after 200 milliseconds have elapsed since the last flush, whichever happens sooner. This keeps latency bounded (nothing waits more than 200ms to be exported, even during a quiet period) while still capturing the efficiency gains of batching during busy periods. Without `batch`, an exporter making one HTTP or gRPC call per span would multiply network overhead by orders of magnitude and would very likely become the actual bottleneck in the pipeline, worse than anything the receiver or the backends themselves would otherwise impose.

## Seeing what the Collector sees

The configuration above declares a `debug` exporter alongside the three real ones, but it is not wired into any of the three pipelines:

```yaml
exporters:
  debug:
    verbosity: basic
    sampling_initial: 5
    sampling_thereafter: 100
```

It is left defined but unused by default, a switch to flip rather than a feature to build. Adding `debug` to a pipeline's exporter list, alongside `otlphttp/tempo` or whichever backend is already there, makes the Collector print a summary of every batch it processes to its own stdout, visible with `docker logs` or `podman logs` against the running container, with no change to any service and no separate tooling to install. This is the fastest way to answer "is telemetry reaching the Collector at all" when a signal is not showing up in Grafana: if the Collector's own logs show spans arriving, the problem is downstream, in the exporter or the backend; if they show nothing, the problem is upstream, in the service or the network path to the receiver. `sampling_initial: 5` and `sampling_thereafter: 100` keep this verbose output from drowning the Collector's own logs at real volume: the first five batches per signal print in full, and only one in every hundred after that, which is enough to confirm the shape of the data without turning the debug exporter itself into a volume problem.

## Validating a configuration before it ships

A Collector configuration is a YAML file hand-edited like any other, which means it is exactly as easy to introduce a typo into a pipeline reference or an exporter name as into any other piece of infrastructure code. The Collector binary itself provides a built-in check for exactly this, independent of actually starting the process and routing live traffic through it:

```bash
otelcol-contrib validate --config=stack/otelcol/config.yaml
```

This parses the configuration, confirms every component referenced in a pipeline is actually defined (a pipeline that lists `exporters: [otlphttp/tempo]` when the exporter block only defines `otlphttp/loki` fails here, immediately, with a clear error, rather than silently dropping traces once the Collector is running), and exits non-zero on failure, which makes it suitable as a pre-deployment check in a script or a CI job without needing to stand up the full stack just to catch a misspelled component name.

## Agent and gateway: two shapes of the same pipeline

This tutorial runs a single Collector, receiving directly from every service and exporting directly to the LGTM backends, because one Collector is sufficient for the traffic a handful of demo services generates. Production deployments at larger scale commonly split this into two tiers instead: a lightweight Collector instance, run as a sidecar or a per-host agent, deployed next to each service purely to receive its OTLP traffic and forward it onward, and a smaller number of larger "gateway" Collectors, centrally deployed, that receive from every agent and carry the heavier processors, tail sampling in particular, since its memory cost scales with the total trace volume across the whole fleet, not any one service's slice of it. The receivers, processors, and exporters model stays identical between the two tiers; what changes is simply what each tier's pipeline is configured to do, an agent's pipeline is often little more than a receiver and a batch processor forwarding onward, while the gateway's pipeline carries the `memory_limiter`, `resource`, and `tail_sampling` work described in this chapter and the next. The single-Collector shape used here is the simplest version of that same architecture, not a different one, and the configuration file structure translates directly if the tutorial's services were ever split across more hosts than a single compose file.

## Why these decisions belong in the Collector, not the app

The common thread across `memory_limiter`, `resource`, and `batch` is that none of them have anything to do with what any particular service does. A payments service and a catalog service have entirely different business logic, but they need the exact same protection against memory exhaustion, the exact same environment tagging, and the exact same batching behavior. Implementing each of these three concerns inside every service's instrumentation code would mean three separate implementations per language the tutorial covers, three separate places to update if the batching threshold needs tuning, and three separate chances to get memory protection subtly wrong in one of them. Centralizing these decisions in the Collector means they are implemented once, reviewed once, and changed once, and every service benefits identically without redeploying a single line of service code.

This is also why the Collector is the right place for concerns this tutorial has not yet reached in its base configuration but that a production deployment would add quickly: routing telemetry to different backends based on content, and redacting sensitive data before it ever reaches a backend at all. A `routing` connector or processor can inspect an attribute, say, a `tenant.id` or a `deployment.environment` value, and send that record's telemetry to a tenant-specific or environment-specific backend, a decision no individual service should need to know how to make. An `attributes` or `transform` processor can strip or hash a field, a customer email address accidentally attached as a span attribute, a credit card fragment logged by an overly verbose library, before that data is ever written to Tempo or Loki, where it would otherwise be retained, indexed, and potentially exposed to anyone with read access to the backend. Putting that redaction in the Collector means it applies even to telemetry from a service whose authors never thought to scrub it themselves, which is a materially different and stronger guarantee than hoping every team remembers to redact at the source.

The `transform` processor, part of the Collector's contrib distribution (the same distribution this stack's `grafana/otel-lgtm` image bundles, which is what makes advanced processors available here without a custom build), uses the OpenTelemetry Transformation Language to express this kind of rule declaratively: a condition matching an attribute pattern, and an action to delete, rename, or rewrite it. That rule lives in the Collector's configuration file, versioned and reviewable, rather than scattered across application code in whatever language and whatever logging library each service happens to use.

## The Collector as a chokepoint, and why that's useful here

A chokepoint is usually a word for a liability: one component that every request or every telemetry record has to pass through is one component whose failure or overload affects everything behind it, which is exactly why `memory_limiter` exists and exists first in the chain. But the same property that makes a chokepoint dangerous if left unprotected makes it valuable once it is: a single place where every signal from every service can be inspected, shaped, protected, and governed according to one set of rules, instead of trusting that every service independently implements those rules correctly. The pipelines in `stack/otelcol/config.yaml` are kept to a minimal floor, batching, memory protection, and a single resource attribute, because this is the floor every Collector configuration in this tutorial builds from. The tail-sampling configuration covered in Chapter 20 adds one more processor to this same chain, in the same spirit: a decision about what to keep and what to discard, made once, centrally, instead of asking every service to decide for itself.

{% include excalidraw.html file="ch19-the-collector" alt="Diagram of the Collector pipeline: services send OTLP to a receiver, through memory_limiter, resource, and batch processors, out through three exporters to Tempo, Prometheus remote write, and Loki" caption="Figure 19.1 — Collector pipeline: receivers, processors, exporters" %}

Further reading: the [OpenTelemetry Collector documentation](https://opentelemetry.io/docs/collector/) is the authoritative reference for every component referenced in this chapter, including the full [configuration structure](https://opentelemetry.io/docs/collector/configuration/) and the built-in [processors](https://opentelemetry.io/docs/collector/configuration/#processors).
