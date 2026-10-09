---
title: "Cardinality and cost"
order: 21
part: "Production concerns"
description: "How unbounded label and attribute values drive up storage and query cost across metrics, logs, and traces, and how to control spend at the Collector."
---

A dashboard that worked fine in a demo environment can start timing out, or
simply vanish from a billing report as a six-figure line item, once it meets
real production traffic. The instrumentation code did not change. The volume
and the shape of what it emits did. Cardinality is the single biggest lever
on observability cost, and it is almost always invisible at the point where
the damage is done: a line of code that looked harmless when it was written.

Three related but distinct cost problems sit behind that bill: metric
cardinality, log volume and retention, and trace volume. Each has its own
failure mode and its own fix, and all three get cheaper to fix the earlier
the Collector gets a say in what leaves the building.

## What cardinality actually means

A metric is not one time series. It is a family of time series, one for
every unique combination of label values attached to it. A counter named
`http_requests_total` with labels `method`, `route`, and `status_code` does
not produce one stream of numbers; it produces one stream per combination
that has ever been observed: `GET /cart 200`, `POST /checkout 500`,
`GET /cart 404`, and so on. The metrics backend — Mimir in this stack — has to allocate storage, an index
entry, and query-time bookkeeping for every one of those series, forever,
until it ages out under the retention policy.

That is manageable when the label values come from a small, closed set.
HTTP method has seven or eight possible values. Route, if it is the
templated path (`/cart/{id}`) rather than the literal URL, might have a few
dozen. Status code has a few hundred, and in practice a service exercises a
few dozen of them. Multiply those together and a well-behaved
instrumentation surface produces a few thousand series — comfortable for
any metrics backend built in the last decade.

The failure mode is a label whose value set is open-ended: a raw user ID,
a session token, a request ID, an email address, a full unredacted URL with
a query string still attached, or a container ID. Each one multiplies into
the series count, and because the set of values grows without bound, the
series count grows without bound too. A counter that looked like it tracked
"requests per route" quietly becomes "requests per route per customer who
has ever hit the service," and the backend ends up carrying a unique time
series for every person who used the product once in 2023 and never came
back. This is the cardinality explosion, and it is the single most common
reason a metrics backend falls over or a bill spikes.

The OpenTelemetry documentation is explicit about this risk in its guidance
on attribute and metric design: attributes with unbounded value sets belong
on spans and logs, which are built to carry per-event detail, not on metric
labels, which are built to be aggregated (see the semantic conventions and
metrics specification at
[opentelemetry.io/docs/specs/semconv](https://opentelemetry.io/docs/specs/semconv/)
and
[opentelemetry.io/docs/specs/otel/metrics](https://opentelemetry.io/docs/specs/otel/metrics/)).
The rule of thumb that holds up across every stack in this tutorial: before
adding a label to a metric, ask whether you could enumerate every value it
will ever take. If the answer is no, it does not belong on that
metric.

Cardinality has a second cost that is easy to miss because it shows up as
latency rather than as a line item: query performance. A query that asks
for the error rate of one route has to scan and aggregate across every
series that matches, and the more series there are, the more work the
query engine does to collapse them back down into the single number or
line a dashboard actually displays. A cardinality explosion does not just
make storage expensive; it makes every dashboard built on top of the
affected metric slower, sometimes slow enough to time out, which is often
the first symptom an on-call engineer notices, long before anyone looks at
a billing report.

{% include excalidraw.html file="ch21-cardinality-explosion" alt="Diagram comparing two versions of the same counter http_requests_total. With a bounded label set of method, route, and status it produces about three thousand time series, with cheap storage and fast queries. Adding one unbounded label, user_id, turns the same counter into millions of time series, with high storage cost and slow dashboards. The metric definition looks nearly identical in both cases." caption="Figure 21.1 — One unbounded label turns a few thousand series into millions" %}

## Label hygiene as a design discipline

Fixing cardinality after the fact is a scramble: hunting through dashboards
to find which series exploded, patching instrumentation in a dozen places,
and waiting for a retention window to roll the damage out of storage. Label
hygiene applied up front is cheap by comparison, and it comes down to a
short set of habits.

Favor templated routes over literal paths. A web framework that already
knows the route template — `/orders/{orderId}` rather than
`/orders/8f21ac`— should report the template, with the identifier left for
the span or the log line where it is a single occurrence, not a
multiplying label.

Bucket rather than enumerate. If a label needs to carry something
numeric and wide-ranging, such as a payload size or a duration, it belongs
in a histogram, not as a label value. A histogram bucket is a bounded
dimension; a raw value as a label is not.

Push high-cardinality identifiers down the signal stack. A user ID, order
ID, or trace ID is exactly the right thing to attach to a span attribute or
a structured log field, where it tags one event rather than multiplying a
whole family of time series. The chapters on context propagation and
correlation in this tutorial cover how the same identifier shows up on a
trace and a log line; the point for this chapter is narrower: that
identifier should never also become a metric label.

Review new labels as part of code review, the same way a schema change
would be reviewed. A reviewer who knows the question — "what is the set of
values this can take, and is it bounded?" — catches almost every
cardinality problem before it reaches production, because the answer is
usually obvious once asked out loud.

## Log volume and retention

Logs fail differently. There is no cardinality explosion in the metrics
sense, because a log line does not pre-aggregate into a time series; Loki,
the log store used in this stack, indexes a small set of labels and keeps
the rest of each line as compressed text. The cost problem with logs is
simpler and blunter: volume. Every `DEBUG` line left on in production,
every health check logged at `INFO`, every framework that logs a line per
database query, adds up linearly with traffic, and log storage at scale is
priced by the gigabyte ingested and the number of days retained.

Three controls matter here, and they compound. First, log level discipline:
`DEBUG` and `TRACE` levels belong in development and in short-lived
diagnostic windows, not as the steady-state production level. Second,
sampling or deduplication of repetitive lines — a retry loop that
logs the same warning on every attempt is better served by logging once
with a count than logging every attempt. Third, retention tiering: not
every log needs the same number of days online. Security and audit logs
often need months; application debug logs are rarely useful past a few
days; a tiered retention policy in Loki, keeping recent data hot and
either deleting or moving older data to cheaper storage, is where the
multi-month cost reduction usually comes from, not from trimming what gets
logged in the first place.

It is worth separating "logging too much" from "indexing too much." Loki's
label-based indexing model means the labels attached to a log stream — not
the content of the line — determine query performance and a meaningful
share of storage overhead. A label that varies per request, the same
cardinality mistake as with metrics, turns a log stream into thousands of
tiny streams and defeats the compression that makes Loki affordable in the
first place. The fix is the same discipline as for metrics: keep log
stream labels bounded (service name, environment, log level) and let
high-cardinality detail live in the unindexed line content, where it can
still be searched with a query-time filter.

## Trace volume

Traces have the most expensive per-unit cost of the three signals, because
a single trace carries a tree of spans, each with its own attributes,
events, and timing data, and Tempo has to store and index all of it.
Capturing a full trace for every request is viable at modest traffic and
becomes untenable quickly as request volume grows, which is exactly the
problem the chapter on sampling addresses directly: head and tail sampling
strategies decide which traces are worth keeping before they ever reach
storage. That mechanism will not be repeated here, but the connection is
worth naming explicitly, because trace volume is a cost lever that sits
upstream of everything else described here. A service
emitting one hundred percent of its traces is also the top candidate for
runaway Tempo storage, independent of how clean its span attributes are.

Span attribute hygiene matters on top of sampling. A span that attaches a
full request body, a complete stack trace on every exception, or a
redundant copy of data already available via trace and log correlation
adds bytes to every single stored span, multiplied by however many spans
survive sampling. The OpenTelemetry tracing specification
([opentelemetry.io/docs/specs/otel/trace](https://opentelemetry.io/docs/specs/otel/trace/))
recommends attaching attributes that aid in understanding the operation,
not attributes that duplicate payload data better suited to a log record
or an external store with a reference left on the span.

## Controlling spend at the Collector

Every mechanism described so far is something a service owner controls at
the instrumentation layer: which labels to add, which log level to set,
which attributes to attach. The Collector, already introduced as the
component that sits in the data path for batching, routing, and
transforming telemetry, is the second and often more practical place to
enforce these decisions, because it applies them centrally, without
redeploying every service that emits telemetry.

A `filter` processor in the Collector pipeline can drop entire signals,
spans, or log records that match a condition — health check traces, for
instance, which are high in volume and low in diagnostic value, are a
common target for being filtered out before they reach Tempo.

An `attributes` processor, run in `delete` or `update` mode, strips
specific attributes from spans, metrics, or logs as they pass through the
pipeline. This is the practical backstop for cardinality: even if an
instrumentation library attaches a raw user ID to every span by default,
the Collector configuration can delete that attribute centrally before
export, rather than waiting for every team to patch their code.

```yaml
processors:
  attributes/drop-user-id:
    actions:
      - key: user.id
        action: delete
  filter/drop-health-checks:
    traces:
      span:
        - 'attributes["http.route"] == "/healthz"'
```

A `transform` processor, using the OpenTelemetry Transformation Language,
goes further: it can rewrite a high-cardinality attribute into a bucketed
or templated form instead of deleting it outright, preserving some
diagnostic value while still bounding the cardinality.

For metrics specifically, the Collector's aggregation capabilities —
either through a dedicated aggregation processor or through careful use of
views at the SDK level, which the Collector then just forwards — let a
team decide that a metric needs an application-wide total, not a
per-instance or per-pod breakdown, cutting the series count by the number
of running replicas without losing the number that matters for alerting.

The common thread across every one of these processors is that they are
centrally owned. A platform or observability team can set data retention
and cost policy once, in the Collector configuration, and have it apply
uniformly across every service, every language, and every team, regardless
of whether the original instrumentation was careful about cardinality. This
is also why the architecture of putting a Collector in the data path, laid
out when the stack was introduced, pays for itself here: a direct
SDK-to-backend pipeline has no interception point at all, and every cost
control becomes a per-service, per-language exercise instead of a single
shared one.

## Putting it together

Cost control in observability is not a single switch. It is the sum of
small decisions: a bounded label here, a log level there, a sampling rate
tuned to traffic, a Collector processor that catches what instrumentation
missed. None of those decisions is expensive in isolation. What is
expensive is discovering all three signals have been growing unbounded at
once, usually at the same moment a billing alert fires or a backend starts
rejecting writes under load.

The practical habit worth carrying forward: when adding any new label,
attribute, or log field, ask what set of values it can take, and whether
that set has a ceiling. When reviewing a Collector configuration, check
whether it is just forwarding everything it receives or actively deciding
what is worth keeping. A pipeline with no filtering, no attribute
processing, and no sampling is not a more complete observability setup; it
is a more expensive one, usually without a commensurate gain in what a
human can actually use when debugging an incident.

{% include excalidraw.html file="ch21-cost-controls" alt="Diagram showing metrics, logs, and traces flowing from services into an OpenTelemetry Collector where filter, aggregate, and attribute-drop processors reduce volume before it reaches backend storage" caption="Figure 21.2 — Controlling spend at the Collector, across all three signals" %}
