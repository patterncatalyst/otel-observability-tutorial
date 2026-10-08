---
title: "Service graph and SLOs"
order: 22
part: "Production concerns"
description: "How a service graph is derived from spans, how span metrics and the four golden signals feed SLOs, and how to alert on them."
---

Every trace captured by the services in this tutorial already contains the
answer to a question operators ask constantly: which services call which
other services, how often, how fast, and how reliably? That information is
sitting in the parent-child relationships between spans. Nobody has to draw
the architecture diagram by hand or keep a wiki page about service
dependencies current, because the calls themselves, recorded as spans, are
the diagram's source data. That raw span data turns into two things an
operations team uses day to day: a service graph that shows the real,
observed topology of a system, and a set of service-level objectives built
on metrics derived from the same spans.

## From spans to a graph

A trace is a tree. A request enters a service, that service calls another,
which calls another, and each hop is recorded as a span with a reference to
its parent. Tempo, the trace backend used throughout this stack, can walk
every trace it receives and extract the calling relationships between
services: Checkout calls Payments, Payments calls Inventory, Checkout also
calls Shipping. Aggregated across a time window and across every trace that
passed through the system, that same extraction produces something more
useful than any single trace on its own — a graph of nodes (services) and
edges (calls between them), each edge annotated with the volume, error
rate, and latency distribution observed on that specific call path.

This is Tempo's service graph feature, built on a Collector-side processor
that inspects spans as they pass through and emits the graph as a
Prometheus-compatible metric. The OpenTelemetry Collector contrib
distribution ships a `servicegraph` connector for exactly this purpose,
sitting between the trace pipeline and the metrics pipeline: spans go in,
and metrics describing the edges of the graph come out, without any change
to the instrumentation producing the spans. Tempo's own documentation
describes the resulting graph as a way to see request rate, error rate, and
duration for every edge in the topology, derived entirely from span data
already being collected for tracing — see
[opentelemetry.io/docs/collector](https://opentelemetry.io/docs/collector/)
for how Collector connectors fit into this kind of cross-signal pipeline.

The value of a derived graph over a hand-maintained one is that it cannot
drift out of date. A hand-drawn architecture diagram is accurate on the day
someone draws it and increasingly wrong after that, as services are added,
retired, or rewired to call each other differently. A graph built from
live span data reflects whatever is actually calling what, this week,
including the temporary workaround nobody remembered to document and the
new dependency a recent feature quietly introduced.

## Span metrics: from events to numbers

The same Collector-side processing that builds the service graph can also
produce span metrics: counters and histograms derived from span data,
broken out by service name and operation name, without the services
themselves needing to emit anything beyond the spans they already produce.
The `spanmetrics` connector, the sibling of `servicegraph` in the
Collector's contrib distribution, converts the three pieces of information
every span already carries — that it happened, how long it took, and
whether it ended in an error — into a request-rate counter, a duration
histogram, and an error counter, tagged by service and operation.

This matters because it collapses a maintenance burden that otherwise falls
on every team: instrumenting a separate request-count or error-rate metric
by hand, in addition to the tracing already in place, and keeping the two
in sync as endpoints change. Span metrics are the trace data a service
already produces, projected into metric form, for operations that want to
build dashboards or alerts in Prometheus-style query language (PromQL
against Mimir, in this stack) rather than running trace queries for
every panel.

## The four golden signals

Span metrics map directly onto a framework that predates OpenTelemetry but
that OpenTelemetry instrumentation makes easy to populate: the four golden
signals, popularized by Google's Site Reliability Engineering practice.
Latency is how long a request takes, visible directly in the duration
histogram span metrics produce. Traffic is how much demand a service is
under, visible in the request-rate counter. Errors is the fraction of
requests that fail, visible in the error counter divided by the request
count. Saturation is how full a resource is relative to its capacity — CPU,
memory, queue depth, connection pool usage — and while it is not derived
from spans the way the other three are, it is exactly the kind of signal
the chapter on metrics already covers through runtime and resource
instrumentation.

The reason these four signals are the standard starting point rather than
a longer list is coverage: almost every incident that matters to a user
shows up as a change in at least one of them. A deploy that introduces a
slow database query shows up as latency. A traffic spike from a marketing
campaign shows up as traffic, and if capacity has not kept pace, as
saturation right behind it. A bad release shows up as errors. Building
dashboards and alerts around these four first, before anything more
specific to a particular service, gives broad incident coverage without
needing bespoke instrumentation for every failure mode in advance.

## From signals to SLOs

A service-level objective turns a golden signal into a target: not "what is
the error rate" but "the error rate must stay below half a percent, measured
over a rolling thirty-day window." The service-level indicator (SLI) is the
measured value — the ratio of successful requests to total requests, taken
directly from span metrics. The SLO is the target set against that
indicator, and the error budget is the amount of unreliability the SLO
tolerates before it is breached: at 99.5% availability, a service is
allowed roughly three and a half hours of full downtime, or a
proportionally larger amount of partial degradation, in a thirty-day
window before the objective is missed.

Framing reliability this way changes how a team spends engineering effort.
Without an SLO, "is the service reliable enough" is a matter of opinion
and anecdote. With one, it is a number everyone can look at, derived from
the same span metrics already flowing through the system: how much of the
error budget is left, and at the current burn rate, how long until it runs
out. A service with budget to spare can ship riskier changes faster. A
service burning through its budget needs to slow down and stabilize before
taking on more risk — the entire tradeoff made visible by metrics that cost
nothing extra to instrument, because they are projections of spans already
being recorded.

## Alerting on burn rate, not just thresholds

A naive alert on a golden signal fires the moment a threshold is crossed:
error rate above one percent, page. This produces two kinds of bad
outcomes. A brief, self-correcting blip pages someone needlessly. A slow,
sustained degradation that never quite crosses the instantaneous threshold
never pages at all, until the error budget for the month is already gone.

Burn-rate alerting fixes both problems by asking a different question: at
the current rate of errors, how quickly is the error budget being consumed,
relative to the time remaining in the window? A burn rate of one means the
budget will be exhausted exactly at the end of the window — sustainable. A
burn rate of ten means the budget will be gone in a tenth of the window,
which for a thirty-day SLO is about three days: urgent enough to page
immediately, even though the raw error rate at any single instant might
look unremarkable. A common pattern pages on two burn-rate alerts at
different sensitivities — a fast-burn alert over a short window (catching a
severe, sudden outage quickly) and a slow-burn alert over a longer window
(catching a steady degradation that a short window would miss) — both
computed from the same underlying span metrics, just aggregated over
different time ranges.

This is also where the four golden signals and the error-budget framing
reinforce each other operationally. Traffic and saturation alerts catch
capacity problems before they turn into latency or error problems. Latency
and error alerts, tied to burn rate rather than a bare threshold, catch
reliability problems at a pace that matches how urgently they actually
need a human, rather than how dramatic the raw number looks at a single
point in time.

## Querying the derived metrics

Span metrics land in Mimir as ordinary Prometheus-style time series, which
means they are queryable with the same PromQL used for any other metric in
this stack. The request-rate counter the `spanmetrics` connector produces
is typically named something like `traces_spanmetrics_calls_total`, labeled
by `service.name` and `span.name` (the operation); the duration histogram
follows the same naming pattern with a `_bucket` suffix for its buckets.
Error rate for one service over a rolling five-minute window reads as a
ratio of two counters:

```promql
sum(rate(traces_spanmetrics_calls_total{service_name="checkout", status_code="STATUS_CODE_ERROR"}[5m]))
/
sum(rate(traces_spanmetrics_calls_total{service_name="checkout"}[5m]))
```

Latency as a percentile comes from the histogram with `histogram_quantile`,
the same function used against any other Prometheus-compatible duration
histogram:

```promql
histogram_quantile(0.99,
  sum(rate(traces_spanmetrics_duration_milliseconds_bucket{service_name="checkout"}[5m])) by (le)
)
```

The service graph metrics the `servicegraph` connector emits follow a
parallel shape, but keyed by the pair of services on each edge —
`client` and `server` labels identify the calling and called service —
so the same kind of query answers "what is the error rate on the edge from
Checkout to Payments specifically," which a single-service metric cannot
answer on its own. This edge-level detail is often the fastest way to
localize a problem: a golden-signal dashboard might show Checkout's overall
error rate rising, and the service graph query narrows that immediately to
one failing downstream edge rather than a dozen candidate causes.

## Alerting as configuration, not as a GUI exercise

Grafana is the one graphical tool this tutorial relies on, for the reason
that reading a service graph or a dashboard panel is inherently visual.
Alerting rules, by contrast, are configuration, and the agnostic, scriptable
way to manage them is to define them as files and provision them, rather
than clicking through the alerting UI and leaving the result undocumented
anywhere outside Grafana's own database. Grafana's provisioning format
accepts alert rules as YAML, checked into the same repository as everything
else describing the stack:

```yaml
apiVersion: 1
groups:
  - orgId: 1
    name: checkout-slo
    folder: SLOs
    interval: 1m
    rules:
      - uid: checkout-error-burn-fast
        title: "Checkout error budget burn (fast)"
        condition: C
        for: 2m
        annotations:
          summary: "Checkout burning its 30-day error budget in under a day"
        data:
          - refId: A
            datasourceUid: mimir
            model:
              expr: >
                sum(rate(traces_spanmetrics_calls_total{service_name="checkout",status_code="STATUS_CODE_ERROR"}[5m]))
                / sum(rate(traces_spanmetrics_calls_total{service_name="checkout"}[5m]))
```

The burn-rate thresholds themselves — which multiple of the baseline rate
counts as "fast" versus "slow" — are a function of the SLO's target and
window, not of Grafana; the rule file is just where that math gets encoded
once and then version-controlled like any other piece of the system. This
mirrors the Collector configuration pattern used throughout the production
concerns chapters: policy that used to live in someone's head, or in a
GUI only one person remembers how to drive, moves into a file that survives
a team handoff.

## Building the dashboard

In practice, a service graph and an SLO dashboard sit side by side in
Grafana, the one visualization tool this agnostic track relies on. The
service graph panel gives the shape of the system: what calls what, and
where the slow or error-prone edges are, right now. The SLO panel gives
the trend: how much error budget remains, and at what rate it is burning.
Looking at both together answers a question neither answers alone — not
just "is something broken" but "where in the topology is it broken, and
how urgently does it need attention."

One caution worth carrying over from the chapter on cardinality and cost: span
metrics inherit whatever label cardinality the underlying spans carry. A
`spanmetrics` connector configured to break down by a high-cardinality span
attribute, rather than by service and operation name alone, recreates the
exact cardinality explosion already discussed, just one hop downstream of
the spans themselves. The connector's configuration controls which span
attributes become metric dimensions; keeping that list short and bounded is
what keeps span metrics as cheap as the golden-signal dashboards built on
top of them assume they are.

None of this requires instrumentation beyond what this tutorial's signal
chapters already put in place. The spans were already there for
distributed tracing. The service graph and span metrics connectors turn
those same spans into a topology map and a set of golden-signal metrics,
and an SLO is just a target and a burn-rate calculation layered on top.
The investment already made in manual spans, auto-instrumentation, and
consistent semantic conventions is what makes this layer close to free to
build.

{% include excalidraw.html file="ch22-service-graph" alt="Diagram showing spans from Checkout, Payments, Shipping, and Inventory services feeding a span metrics processor, which produces both a Tempo service graph and golden-signal SLO alerting" caption="Figure 22.1 — From spans to a service graph and SLO alerting" %}
