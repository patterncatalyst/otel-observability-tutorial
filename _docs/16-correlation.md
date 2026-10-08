---
title: "Correlation"
order: 16
part: "Making signals useful"
description: "Linking traces, logs, metrics, and profiles in Grafana through a shared trace_id and the datasource provisioning that wires it together."
---

A single slow checkout request produces four separate records: a trace in Tempo, log lines in Loki, a histogram observation in Mimir, and a CPU profile in Pyroscope. Each one answers a different question. The trace shows which service ate the latency. The logs show what that service was doing at the moment it stalled. The metric shows whether this was a one-off or the start of a trend. The profile shows which function was actually burning CPU. Taken separately, these four views are four separate investigations, each starting from a blank query box. Taken together, tied by one identifier, they become a single investigation with four tabs.

That identifier is `trace_id`. The OpenTelemetry SDK generates one when a trace starts and propagates it through context to every span, every log record emitted inside that context, and every metric exemplar recorded while a trace is active. Correlation in Grafana is the practice of teaching each datasource where to find that identifier in the others, so a click in one view opens the matching view with the right query already filled in. None of this requires application code. It is entirely provisioning: a block of YAML, read once at startup, that tells Grafana how the datasources relate to each other.

## Where the links live

The stack in this tutorial provisions its datasources from `stack/grafana/datasources.yaml`, mounted into the Grafana container's provisioning directory. That file defines four datasources — Tempo, Loki, Prometheus, and Pyroscope — and each one carries a block of `jsonData` describing how to jump to the others. Nothing about the application services needs to know this file exists. The links appear in the Grafana UI the moment the container starts, because Grafana reads its provisioning directory on boot and wires the datasources accordingly.

This matters for the same reason the Collector chapter argues that cross-cutting decisions belong outside application code: four backend teams write and redeploy independently of the person who decides how their signals should cross-reference each other. Put the decision in the Collector and the datasource provisioning rather than in each service, and it changes in one place.

## Trace to logs

The first and most used link is from a trace to the logs that correspond to it. On the Tempo datasource, the `tracesToLogsV2` block does this work:

```yaml
tracesToLogsV2:
  datasourceUid: loki
  spanStartTimeShift: -5m
  spanEndTimeShift: 5m
  tags:
    - key: service.name
      value: service_name
  filterByTraceID: true
  filterBySpanID: false
```

When you are viewing a trace in Grafana and a span has a "Logs for this span" link, this is the configuration answering what gets queried. `filterByTraceID: true` means the generated Loki query includes the trace's `trace_id` as a match condition, so you see only the logs that belong to this specific request, not every log line from the service during that window. `filterBySpanID` is left off, because span-level filtering is usually too narrow: a single span might log nothing itself while a child operation inside it logs the detail you need, and widening the filter to the whole trace catches that.

The time shift fields matter more than they look. A span's own duration might be twenty milliseconds, but the log line explaining why it was slow could have been written five seconds earlier, during a retry loop, or written after the span closed, during cleanup. `spanStartTimeShift: -5m` and `spanEndTimeShift: 5m` widen the Loki query window around the span's actual duration so slightly-earlier or slightly-later log lines are not missed because of clock skew or asynchronous logging. Five minutes is generous for a demo; a busier log volume in a real deployment would usually tighten this to seconds.

The `tags` mapping handles a smaller but equally common problem: the attribute key in the trace (`service.name`, the OpenTelemetry semantic convention) is not necessarily the same key the logs are labeled with (`service_name`, Loki's convention of underscored label names). This block tells Grafana to translate one into the other when building the Loki query, rather than requiring every log line to carry an attribute that matches Tempo's naming verbatim.

## Logs to trace

The reverse link, going from a log line back to its trace, lives on the Loki datasource as a derived field:

```yaml
derivedFields:
  - datasourceUid: tempo
    matcherType: label
    matcherRegex: trace_id
    name: trace_id
    url: '$${__value.raw}'
    urlDisplayLabel: 'View trace in Tempo'
```

The detail worth getting right here is `matcherType: label` rather than a regex matched against the log line's text. Because this stack's services export logs over OTLP, Loki receives `trace_id` as structured metadata attached to the log record, not as a string embedded in the message body. A regex-over-text approach, which is the more commonly documented pattern when logs are plain text files scraped by an agent, would need to parse the message looking for something that looks like a trace ID, and would break the moment a log format changed. Matching it as a label is more reliable and is the natural consequence of using OTLP for logs in the first place: the identifier arrives as a first-class field, not as incidental text.

With this derived field in place, any log line carrying a `trace_id` label renders that value as a clickable link in the Grafana Explore view, labeled "View trace in Tempo," which opens the full trace.

## Trace to metrics

The third correlation link, `tracesToMetrics`, goes the other direction across signal types: from a trace to the aggregate metrics for the service that produced it.

```yaml
tracesToMetrics:
  datasourceUid: prometheus
  spanStartTimeShift: -2m
  spanEndTimeShift: 2m
  tags:
    - key: service.name
      value: service
  queries:
    - name: 'Request rate'
      query: 'sum(rate(http_server_duration_milliseconds_count{$$__tags}[5m]))'
    - name: 'Error rate'
      query: 'sum(rate(http_server_duration_milliseconds_count{$$__tags,error="true"}[5m]))'
```

This is less about identifying one specific request and more about placing it in context. A single slow trace does not tell you whether the service was healthy a minute before and a minute after, or whether this request landed in the middle of a sustained spike. The two named queries here, request rate and error rate, are prewritten PromQL templates with a `$$__tags` placeholder that Grafana fills in from the span's attributes using the `tags` mapping, the same `service.name` to `service` translation seen in the logs link. Clicking through from a trace runs these queries over a window centered on the span, so the first thing you see after the trace is the shape of traffic and errors around it, not another raw query box to fill in by hand.

## Metric to trace: exemplars

Correlation does not only flow out of a trace. It flows into one from a metric, through exemplars. An exemplar is a single sample attached to a histogram bucket that carries the `trace_id` of one specific request that landed in that bucket, alongside the aggregate count. Rather than every request's trace ID being stored as a metric label, which would make every distinct request its own time series and overwhelm Mimir with cardinality, the metrics pipeline stores one representative trace ID per bucket per scrape interval, as metadata on the sample, not as a label.

The Prometheus datasource's `exemplarTraceIdDestinations` turns that metadata into a link:

```yaml
exemplarTraceIdDestinations:
  - name: trace_id
    datasourceUid: tempo
```

In the Grafana UI, a latency histogram rendered with exemplars enabled shows small diamond markers scattered across the graph, one per exemplar. Each one is clickable and opens the exact trace that produced that one sample. This is the mechanism that closes the loop started by the trace-to-metrics link: that link takes you from a trace to the surrounding aggregate picture, and an exemplar takes you from a point in the aggregate picture back down to one concrete trace, possibly a different one than you started with, chosen because it fell in the latency bucket you clicked. Exemplars are the reason a p99 latency spike on a dashboard is actionable rather than merely alarming: the spike itself carries a pointer to a real example of the slow request behind it.

## Trace to profiles

The newest and least commonly documented of the four links is `tracesToProfiles`, connecting a trace span to the continuous profiling data captured by Pyroscope:

```yaml
tracesToProfiles:
  datasourceUid: pyroscope
  tags:
    - key: service.name
      value: service_name
  profileTypeId: 'process_cpu:cpu:nanoseconds:cpu:nanoseconds'
```

Where the trace-to-logs link answers "what happened" and the trace-to-metrics link answers "how unusual was this," the trace-to-profiles link answers "where did the CPU time actually go." Pyroscope captures continuous CPU profiles for each service, independent of any single request, sampled at regular intervals. The correlation here works slightly differently from the others because a profile is not scoped to one trace ID the way a log line or an exemplar is. Instead, Grafana uses the span's service name (mapped through the same `tags` translation seen elsewhere) and its time range to query Pyroscope for the flame graph covering that service during that span's duration. `profileTypeId` pins the query to CPU time specifically, as opposed to the other profile types Pyroscope can capture, such as allocation or lock contention, if those are configured.

The practical effect: open a trace, find the span that took an unreasonable amount of wall time, click through to profiles, and see the flame graph for that exact service during that exact window, read down to the function. This is the deepest level the correlation chain reaches. Logs tell a story in prose; a flame graph shows the actual call stack accumulating time, function by function.

## Two related but distinct features

Two more entries in the Tempo datasource's configuration look similar to the correlation links above but serve a different purpose: `serviceMap` and `nodeGraph`. These do not link one trace to another signal. Instead, Tempo's metrics-generator derives a topology graph from the spans flowing through it, aggregating which services call which other services and at what error rate and latency, and Grafana renders that aggregate as a node graph. It is a complementary view, closer to the service-graph dashboard described in the next chapter than to point-to-point correlation, and it rides on the same `jsonData` block and the same underlying trace data, with no additional instrumentation required.

## What the click-through is actually doing

Every one of the links above is Grafana building a query for you and opening the result. Seeing what that query looks like with the UI stripped away is useful, both because it demystifies the feature and because it gives a path to verify a correlation link is misconfigured without hunting through Grafana's settings pages to find out why a click produced nothing.

A trace-to-logs click, under the hood, is Loki's query API asked for everything matching the trace's ID within the shifted time window:

```bash
curl -s -G "http://localhost:3100/loki/api/v1/query_range" \
  --data-urlencode 'query={service_name="orders"} | trace_id="a1b2c3d4e5f6"' \
  --data-urlencode "start=$(date -d '-5 minutes' +%s)000000000" \
  --data-urlencode "end=$(date +%s)000000000"
```

A trace-to-metrics click runs one of the two named PromQL queries from `tracesToMetrics` against Prometheus's query API directly, with `$$__tags` already substituted for the actual `service` label value pulled from the span. An exemplar click is nothing more than reading the `trace_id` field already embedded in the sample Prometheus returned when you queried the histogram and handing it to Tempo's `GET /api/traces/{traceID}` endpoint. None of these are privileged operations available only inside the Grafana process; they are the same public HTTP APIs any script could call, which is a useful fact when a correlation link appears broken: run the equivalent curl command directly against Loki, Prometheus, or Tempo, and see which half of the chain, the identifier being passed or the backend's query, is actually failing.

This is also the fastest way to confirm a correlation link is configured correctly before trusting a demo to it live. If the curl command against Loki with a known-good `trace_id` returns log lines, but Grafana's click-through comes back empty, the bug is almost certainly in the `jsonData` mapping, a tag name that does not match, a time window that is too narrow, rather than in the underlying data.

## What has to be true for any of this to work

Every one of these links depends on the same precondition: a trace context that propagates cleanly across every hop a request makes, and attribute names that agree across signals. If a service in the request path drops context propagation, perhaps because it calls a downstream dependency through a client library that was never wrapped, the trace breaks into two disconnected traces, and the logs or metrics on the far side of that break carry a different `trace_id` than the one you started investigating with. The semantic conventions discussed earlier in this tutorial, particularly the consistent use of `service.name`, are not a stylistic preference here. They are the literal keys the correlation YAML matches against. A service that calls itself something different in its logs than in its traces silently breaks the tag-mapping half of every link in this chapter, even while the trace-to-trace plumbing stays intact.

None of the correlation configuration in this chapter runs any code. It is declarative, provisioned once, and applies to every service that follows the shared conventions, which is exactly why it belongs in the datasource layer rather than scattered across application repositories: one file, reviewed once, grants a cross-signal investigation to every engineer who opens Grafana afterward.

{% include excalidraw.html file="ch16-correlation" alt="Diagram of a single trace_id connecting Tempo, Loki, Mimir, and Pyroscope datasources into one Grafana pane via tracesToLogsV2, derived fields, exemplars, and tracesToProfiles" caption="Figure 16.1 — One trace_id, four signals, one Grafana pane" %}

Further reading: the [OpenTelemetry documentation](https://opentelemetry.io/docs/) covers context propagation and the trace/log correlation model that this provisioning depends on, in the sections on [traces](https://opentelemetry.io/docs/concepts/signals/traces/) and [context propagation](https://opentelemetry.io/docs/concepts/context-propagation/).
