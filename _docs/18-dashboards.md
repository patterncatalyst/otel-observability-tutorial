---
title: "Dashboards"
order: 18
part: "Making signals useful"
description: "Provisioned dashboards as code, the RED and USE methods, and what a service dashboard needs to answer the first on-call question."
---

Everything built up to this chapter, the traces, the metrics, the logs, the correlation links between them, exists to answer one recurring question faster than reading raw query results would: is this service healthy right now, and if not, where does it hurt? A dashboard is the answer to that question compressed into a single screen that does not require typing a query first. Grafana is the one graphical interface this tutorial relies on anywhere in the stack; everything upstream of it, from instrumentation to Collector configuration to sampling policy, is driven by files and CLI tools. Dashboards are where that discipline pays off, because a dashboard built from the same metric names, trace attributes, and log labels established earlier renders correctly the first time, with no guessing at what a panel's query should say.

## Dashboards as code

The dashboards in this stack are not built by clicking through the Grafana UI and exporting the result as an afterthought. They are JSON files, written and version-controlled like any other configuration, and provisioned into Grafana the same way the datasources are: through a file-based provider read at container startup.

The provider lives at `stack/grafana/dashboards.yaml`:

```yaml
apiVersion: 1

providers:
  - name: tutorial-dashboards
    orgId: 1
    folder: "OTel Tutorial"
    type: file
    disableDeletion: false
    updateIntervalSeconds: 30
    allowUiUpdates: true
    options:
      path: /otel-lgtm/grafana/dashboards
      foldersFromFilesStructure: false
```

Two settings do the real work. `type: file` tells Grafana to scan a directory on disk rather than pull dashboards from a remote API, and `updateIntervalSeconds: 30` means that directory is polled continuously, not just on startup. Drop a new `.json` file into `stack/grafana/dashboards/`, and within thirty seconds it appears in the Grafana UI under the "OTel Tutorial" folder, with no import dialog and no copy-pasting a JSON blob into a text box. `allowUiUpdates: true` leaves room for someone to tweak a panel directly in Grafana while testing and then export the result back into the file, but the file on disk remains the record of truth: restart the stack and the dashboards come back exactly as committed, not as whatever state a browser session happened to leave them in.

This is the same argument for infrastructure as code applied to the one part of the stack that has a GUI at all. A dashboard built by hand in a browser is invisible to code review, impossible to diff meaningfully, and gone the moment the container's volume is recreated unless someone remembers to export it. A dashboard committed as JSON is reviewable like any other change, reproducible across every clone of this tutorial, and the same artifact a teammate opens is the one that actually renders. The `stack/grafana/dashboards/` directory exists specifically as the drop point this provider watches, and it stays empty at this stage of the tutorial: the dashboards themselves get authored in a later chapter, once there is a full pipeline of correlated signals to visualize. What matters here is that the mechanism, the provider config and the watched directory, is already wired in and working before a single dashboard file exists, so the dashboards that do get authored only need to show up on disk to take effect.

## Two methods for deciding what goes on a panel

A blank dashboard canvas invites scope creep: every metric that exists is a candidate for a panel, and a dashboard with forty panels answers no question quickly. Two well-established methods narrow that choice by starting from what an on-call engineer actually needs, rather than from what happens to be easy to graph.

### RED, for request-driven services

The RED method applies to anything that serves requests: an HTTP API, a gRPC endpoint, a message consumer processing one message at a time. It asks three questions, and only three:

- **Rate** — how many requests is this service handling per second?
- **Errors** — what fraction of those requests are failing?
- **Duration** — how long are they taking, typically expressed as a latency distribution rather than an average?

The appeal of RED is its discipline. A service dashboard that answers these three questions for every meaningful endpoint tells an on-call engineer, within seconds of opening it, whether the service is up, whether it is failing, and whether it is slow, which together cover the overwhelming majority of "is this broken" investigations. The metrics instrumented earlier in this tutorial, the request counters and duration histograms emitted through the OpenTelemetry Metrics API, map directly onto rate and duration. Errors fall out of the same histogram or counter, filtered by a status label. A RED-style service dashboard does not need custom instrumentation beyond what the services already emit; it needs a panel layout that asks these three questions in a consistent order, service after service, so that switching from one service's dashboard to another does not require relearning where to look.

### USE, for the infrastructure underneath

RED describes the behavior of a service from the outside, in terms of the requests arriving at it. It does not describe the resource that service is running on, and a service can be slow or failing because the code is wrong or because the box underneath it is out of headroom. The USE method, applied to a resource rather than a service, asks a different three questions:

- **Utilization** — how much of the resource's capacity is in use, typically as a percentage: CPU busy time, memory occupied, disk I/O saturation.
- **Saturation** — how much work is queued waiting for that resource, beyond what it can currently service: a run queue depth, a connection pool's waiting count, a thread pool's backlog.
- **Errors** — resource-level errors, distinct from the request-level errors RED tracks: out-of-memory kills, disk write failures, dropped packets.

USE and RED are complementary rather than overlapping. A RED dashboard shows a latency spike; a USE dashboard, checked next, shows whether that spike coincides with CPU utilization pinned at capacity or a connection pool saturated with waiting callers. Neither method alone answers both "is the service failing its callers" and "why," which is why a complete dashboard set in this tutorial plans for both: one dashboard per service built around RED, and one dashboard per shared resource, the Kafka cluster, the Postgres instance, the Collector itself, built around USE.

## The planned dashboard set

With the provider in place and the two methods chosen as the organizing principle, the dashboards authored for this tutorial follow a small, limited set rather than one dashboard per team's personal preference:

- **A service overview dashboard**, one per service in the e-commerce domain, built around RED: request rate, error rate, and latency percentiles (p50, p95, p99) for each service's primary entry points, with panels linked through the exemplars and trace-to-metrics correlation covered earlier so a latency spike is one click from a concrete trace.
- **An infrastructure dashboard**, built around USE, covering the Collector's own resource consumption, the Kafka brokers, and the Postgres instance, since all three sit underneath every service and a resource constraint in any of them manifests as a RED-dashboard symptom in several services at once.
- **A service graph dashboard**, drawing on Tempo's metrics-generator service graph mentioned in the correlation chapter, to show the topology of calls between services and let a RED-level problem in one service be traced to its upstream callers without reading trace data span by span.

This is a small set by design. Dashboards accumulate the same way unused metrics do: easy to add, rarely removed, and each additional one is another screen someone has to know exists and remember to check. Starting from RED and USE, rather than from an open-ended list of "things that might be interesting," keeps the set small enough that a new engineer can learn all of it in one sitting.

## Building a service dashboard

A service dashboard built this way starts from the metric names the service already emits and the attribute conventions already standardized across it. For an HTTP service instrumented with the OpenTelemetry semantic conventions, the request duration histogram exposes rate, latency, and (via a status-code label) errors from a single metric series. The dashboard's first row is built from three panels drawing off that one histogram:

- a rate panel: `sum(rate(http_server_duration_milliseconds_count{service_name="orders"}[5m]))`, graphed over time;
- an error-rate panel: the same query filtered to error-status outcomes, usually expressed as a ratio against the total so the panel reads directly as a percentage rather than a raw count;
- a latency panel: `histogram_quantile(0.95, sum(rate(http_server_duration_milliseconds_bucket{service_name="orders"}[5m])) by (le))`, with p50 and p99 added alongside p95 so a flat median next to a climbing tail is visible rather than hidden inside an average.

Each of these panels, because they are Prometheus-backed histograms produced by a service emitting exemplars, automatically becomes a jump point into the trace behind a specific latency sample, following the exemplar correlation described earlier. A dashboard built this way is not a dead end when it shows a problem; it is the entry point to the trace, and from the trace to the logs and profile, that explains it.

Below the RED row, a service dashboard built for this tutorial adds panels for anything specific to that service's own failure modes, a Kafka consumer lag panel for a service that consumes events, a connection pool saturation panel for a service with a tight database pool, but the RED row comes first on every dashboard, in the same position, because consistency across dashboards is itself a feature: an engineer paged for an unfamiliar service should recognize the top of its dashboard immediately, even without having built it.

## Managing dashboards without opening a browser

Grafana's dashboard JSON is detailed enough to resist hand-editing at any real size, but the stack's commitment to treating configuration as files extends to how dashboards get produced, not just where they end up. Grafana exposes a full HTTP API for dashboard content, `GET /api/dashboards/uid/{uid}` to retrieve one, `POST /api/dashboards/db` to create or update one, which means a dashboard built interactively while iterating on a panel's query can be pulled back down to disk with a single request rather than copy-pasted out of an export dialog:

```bash
curl -s -H "Authorization: Bearer $GRAFANA_API_TOKEN" \
  "http://localhost:3000/api/dashboards/uid/orders-overview" \
  | jq '.dashboard' > stack/grafana/dashboards/orders-overview.json
```

Piped through `jq`, the response is both pretty-printed for a readable diff and trimmed to the `dashboard` object itself, stripped of the wrapping metadata (`meta.created`, `meta.updatedBy`, and similar fields) that Grafana's API adds and that would otherwise make every export look modified even when no panel actually changed. This is the same principle as the provisioning provider itself: the browser is for iterating on a query live, with immediate visual feedback, but the artifact that gets committed is produced and inspected from the command line, where a reviewer can read exactly what changed between two versions of a dashboard without opening Grafana at all.

The same API makes dashboards easy to validate before they ship. A malformed panel query does not fail loudly; it renders as a panel with a red error icon, easy to miss in a JSON file with forty panels and easy to catch with a one-line check that the file at least parses as valid JSON and contains the expected number of panels before it is dropped into the provisioned directory:

```bash
jq -e '.panels | length > 0' stack/grafana/dashboards/orders-overview.json
```

## Why Grafana, and why only Grafana

It is worth being explicit about a design choice that runs through this entire tutorial: every other interaction with this stack, starting the services, shaping Collector pipelines, running load, inspecting Kafka topics, happens from the command line, in files that can be diffed and reviewed. Grafana is the single exception, and it earns that exception because visualizing a time series, a flame graph, or a trace waterfall as text is a worse experience than looking at it, not because the tooling happens to default to a GUI. Even here, though, the discipline holds: the dashboards themselves, and the datasource links feeding them, are files on disk, provisioned automatically, reviewable in a diff, and reproducible from a clean checkout. The GUI is for looking; the configuration that decides what there is to look at stays in version control.

{% include excalidraw.html file="ch18-dashboards" alt="Diagram of JSON dashboard files in stack/grafana/dashboards provisioned automatically into Grafana via the dashboards.yaml provider, rendered without a manual import step" caption="Figure 18.1 — Dashboards as code: JSON on disk, provisioned on startup" %}

Further reading: the [OpenTelemetry documentation](https://opentelemetry.io/docs/) on [metrics](https://opentelemetry.io/docs/concepts/signals/metrics/) covers the histogram and counter instruments that the RED-style panels in this chapter are built from, and Grafana's own documentation on [dashboard provisioning](https://grafana.com/docs/grafana/latest/administration/provisioning/#dashboards) covers the provider mechanism referenced above.
