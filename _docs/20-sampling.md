---
title: "Sampling"
order: 20
part: "Making signals useful"
description: "Head sampling versus tail sampling, the tail-sampling Collector config, and what each approach costs you in traces you never see."
---

Every trace this tutorial has generated so far has been kept, in full, by every backend. That is fine at demo scale, a handful of services handling test traffic, but it does not survive contact with production volume. A service handling a few hundred requests per second generates tens of millions of spans a day; a fleet of services generates billions. Storing every one of them, indexed, forever, costs real money, and most of those traces look exactly like the last one: a successful request, fast, unremarkable. Sampling is the decision about which traces are worth keeping, and where in the pipeline that decision gets made changes what you are able to keep.

## Head sampling: deciding at the start

Head sampling makes the keep-or-discard decision at the moment a trace begins, typically inside the service's own SDK, before a single span has been written. A sampler configured for a 10% sampling rate flips a weighted coin (deterministically, based on the trace ID, so the same trace is sampled consistently across every service it touches) when the root span starts, and that decision sticks for the trace's entire lifetime. If the coin says discard, the SDK still instruments the request locally for in-process use, but never exports the resulting spans at all.

The appeal of head sampling is its cost profile: a service that samples 10% of its traces reduces its tracing export volume, and everything downstream of it (network bandwidth, Collector load, backend storage) by roughly 90%, with no coordination required between services, since the trace-ID-based decision function is deterministic and every service applying the same rate make the same keep-or-discard call for the same trace independently. Head sampling is cheap in every sense: cheap to configure, cheap on the wire, cheap to store.

The cost is informational, not financial, and it is a cost you pay without knowing which trace you are paying it on. The decision happens before the trace exists, which means it happens before anyone, human or machine, knows whether this particular request was going to be interesting. A request that was about to take eight seconds and return a 500 is exactly as likely to be discarded as a request that was about to return instantly and succeed, because the sampler has no way to know the difference yet. At a 10% sampling rate, roughly nine out of every ten slow, failing, or otherwise anomalous requests are gone before anyone had the chance to ask whether they mattered. This is the central trade-off of head sampling: you know your cost precisely (it is a direct function of the configured rate) but you do not get to choose what you lose.

## Configuring head sampling from the SDK

Head sampling is configured per service, through the OpenTelemetry SDK's sampler, and the common case needs no code change at all, only environment variables the SDK reads on startup:

```bash
OTEL_TRACES_SAMPLER=parentbased_traceidratio
OTEL_TRACES_SAMPLER_ARG=0.1
```

`traceidratio` is the sampler that implements the coin-flip described above, deterministically, by hashing the trace ID and comparing it against the configured ratio, here 0.1 for 10%. The `parentbased` prefix matters more than it looks: it tells the sampler to respect a sampling decision already made upstream, by whichever service received the request first and generated the trace ID, rather than making an independent decision at every hop. Without it, a ten-service call chain running a 10% sampler at every service would keep a trace fully intact only if every one of those ten independent coin flips happened to agree, a rapidly vanishing probability as the chain gets longer. With `parentbased` set everywhere, only the root span's service actually flips the coin; every downstream service reads the sampling flag already present in the incoming trace context (part of the W3C Trace Context `traceparent` header) and honors it, so a sampled trace arrives complete, with every service's spans included, rather than cut short at the first service that happened to decide otherwise.

## Tail sampling: deciding at the end

Tail sampling moves the decision to the opposite end of the trace's lifecycle. Every service exports every span, at full volume, exactly as if no sampling were happening at all. Instead, a Collector sits in the path, buffers each trace's spans as they arrive until the trace is judged complete, and only then applies a policy to decide whether that specific, now fully-formed trace gets forwarded to the backend or dropped. Because the decision happens after the trace is whole, it can be based on what actually happened during the request: did it error, was it slow, did it touch a specific endpoint, rather than a coin flip made in ignorance of all of that.

This stack's tail-sampling configuration lives in `stack/otelcol/config.tail-sampling.yaml`, a layer on top of the base Collector config from the previous chapter, swapped in by changing which file is mounted into the Collector container. The receiver and the batch/resource processors are unchanged; the new piece is the `tail_sampling` processor itself, along with a larger `memory_limiter` to match:

```yaml
processors:
  memory_limiter:
    check_interval: 1s
    limit_mib: 1024  # Higher than base: tail sampling buffers more
    spike_limit_mib: 256

  tail_sampling:
    decision_wait: 30s
    num_traces: 50000
    expected_new_traces_per_sec: 1000

    policies:
      - name: errors-policy
        type: status_code
        status_code:
          status_codes: [ERROR]

      - name: slow-policy
        type: latency
        latency:
          threshold_ms: 1000

      - name: critical-routes
        type: string_attribute
        string_attribute:
          key: http.target
          values: [/orders]

      - name: probabilistic-baseline
        type: probabilistic
        probabilistic:
          sampling_percentage: 5
```

`decision_wait: 30s` is the clock at the center of this processor: the Collector holds a trace's spans in memory for thirty seconds after the first span arrives, waiting for the rest of that trace to show up from every service it touched, before evaluating the policies against the complete set. Thirty seconds is a reasonable default for a request that completes in well under a second, as most of this tutorial's traffic does; a system with longer-running operations, a batch job reported as a single trace, for instance, would need this raised, at the cost of holding more traces in memory for longer. `num_traces: 50000` bounds how many distinct traces the Collector tracks concurrently while waiting out their decision windows, and `expected_new_traces_per_sec` is a capacity hint the processor uses to size its internal data structures; set it close to the real arrival rate, and the processor degrades more gracefully if that rate is temporarily exceeded.

The four policies run in order, and the first one a trace matches determines its fate; a trace matching none of them is dropped:

- **`errors-policy`** keeps every trace containing at least one span with an error status code, regardless of how fast it was. A failed request is close to always worth having, whether or not it was slow.
- **`slow-policy`** keeps every trace where some span exceeded a one-second latency threshold, independent of whether it errored. A request that succeeded but took far longer than expected is exactly the kind of trace head sampling would most often discard by chance.
- **`critical-routes`** keeps every trace touching a specific, named endpoint, here `/orders`, regardless of latency or outcome, because a request to a business-critical path may be worth retaining in full for audit or analysis purposes even when it was fast and successful. A real deployment would list its own small set of such routes here.
- **`probabilistic-baseline`** is evaluated last, and catches everything the first three policies did not: a flat 5% sample of the otherwise unremarkable, fast, successful traffic. This policy exists because even a healthy baseline is worth retaining a thin slice of, to know what normal looks like and to notice if that baseline itself starts shifting.

The order matters: because the first matching policy decides a trace's fate, placing `errors-policy` and `slow-policy` ahead of `probabilistic-baseline` guarantees that an error or a slow request is kept outright, rather than being subjected to the 5% coin flip the baseline policy would otherwise apply to it if it were evaluated first. A naive sampler applying only a flat probabilistic rate would treat an error and a fast, successful request identically; tail sampling's whole purpose is to apply different rules to different kinds of outcomes, and that purpose would be undone by putting the policies in the wrong order.

## What tail sampling costs instead

Tail sampling trades away head sampling's cheapness for a different cost, paid in Collector memory rather than in missed interesting traces. Every service in this configuration exports 100% of its spans; nothing is discarded before the Collector sees it. That means network traffic between services and the Collector runs at full volume, not reduced by any sampling rate, and the Collector itself has to hold every in-flight trace in memory for the full `decision_wait` window before it can decide to drop anything. The configuration comment in this stack's config file puts a number on that: roughly 10 to 50 KB of memory per buffered trace, which at `num_traces: 50000` concurrent traces is a meaningfully larger memory footprint than the base Collector configuration needs, hence the doubled `memory_limiter` ceiling (1024 MiB here versus 512 MiB in the base config) and the larger spike allowance. Tail sampling is not free; it relocates the cost from "data you cannot get back" to "RAM and a clock ticking on your Collector," which is a trade most teams are glad to make, but it is a real infrastructure cost, not a free upgrade over head sampling.

Tail sampling also only works, as configured here, against a single Collector instance holding the entire trace in memory at once. A production deployment running multiple Collector replicas behind a load balancer would need those replicas to agree on where a given trace's spans all land, typically through a load-balancing exporter that routes spans by trace ID to a consistent backend Collector, so that one trace's spans are never split across two Collectors that each see only part of it and can never individually make a complete decision. That coordination layer is beyond what this tutorial's single-Collector stack needs to demonstrate the policy mechanics, but it is the detail that turns this configuration from a demo into a design for a real fleet.

## Confirming the policies are actually doing their job

Because tail sampling's decisions happen inside the Collector, after the point where `docker logs` on a service would show anything useful, verifying that a given policy is keeping or dropping what it should needs a view into the Collector's own behavior rather than the service's. The Collector emits internal metrics about itself, including, for the `tail_sampling` processor specifically, counters for how many traces were sampled and how many were dropped at each decision point. With the Collector's own telemetry pipeline enabled, those counters are queryable from Prometheus like any other metric:

```bash
curl -s "http://localhost:9090/api/v1/query" \
  --data-urlencode 'query=otelcol_processor_tail_sampling_sampling_trace_dropped_too_early_total'
```

A nonzero and climbing value here, specifically for the `dropped_too_early` reason, is the signal that `num_traces` is set too low for the actual arrival rate: traces are being evicted from the buffer before their `decision_wait` window closes, which means they are discarded regardless of whether an error or latency policy would have kept them. This is the kind of failure that is invisible from any service's own logs or dashboards, since nothing about the service itself is misbehaving, and is exactly why the Collector's own operational metrics are worth watching alongside the pipelines it is processing on behalf of everyone else. The simplest end-to-end check, generating a handful of requests to a known slow or error-prone endpoint and then confirming they show up in Tempo while an equivalent volume of fast, healthy requests mostly do not, is still the most direct test that the ordering of policies described above is behaving as intended.

## Choosing between them, and combining them

Head and tail sampling are not mutually exclusive, and a mature setup often runs both: head sampling at a moderate rate to control the volume of ordinary traffic reaching the Collector in the first place, and tail sampling on top of that reduced volume to make sure that whatever head sampling did let through gets filtered intelligently rather than uniformly. The core trade-off to carry forward from this chapter: head sampling is cheap and blind, deciding before a trace's outcome is known, which means its losses are random and proportional to its rate; tail sampling is informed but costly in memory and buffering time, deciding after a trace's outcome is fully known, which means its losses, the `probabilistic-baseline` traces it discards, are a deliberate choice rather than a blind one. Neither is wrong. The right choice depends on whether the traffic volume a service generates can be reduced safely at the source, or whether the interesting cases are rare enough, and important enough, that paying the memory cost of inspecting every single trace before deciding is worth it.

{% include excalidraw.html file="ch20-sampling" alt="Diagram contrasting head sampling, a per-service SDK decision made at span start with a fixed keep rate, against tail sampling, a Collector processor that buffers full traces and applies ordered policies for errors, latency, critical routes, and a probabilistic baseline" caption="Figure 20.1 — Head sampling (per-service) vs. tail sampling (post-hoc, at the Collector)" %}

Further reading: the [OpenTelemetry documentation](https://opentelemetry.io/docs/) covers the sampling model in its [trace sampling](https://opentelemetry.io/docs/concepts/sampling/) concepts page, and the Collector-contrib [`tail_sampling` processor reference](https://opentelemetry.io/docs/collector/) documents the full set of policy types beyond the four used in this chapter's configuration.
