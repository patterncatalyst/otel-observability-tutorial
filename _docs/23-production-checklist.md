---
title: "Production checklist"
order: 23
part: "Production concerns"
description: "Rollout patterns, per-environment resource attributes, keeping secrets and PII out of telemetry, and the path from this local stack to a managed backend."
---

Everything built across this tutorial runs against a local Grafana LGTM
stack: Loki, Grafana, Tempo, and Mimir, running in containers, fed by an
OpenTelemetry Collector on the same machine as the demo services. That
setup is correct for learning the signals and correct for local
development, and it is also not what runs in production.
This chapter is the checklist for the gap between the two: what changes
about configuration, environment identification, and data handling when
the same instrumented services move from a laptop toward a real
deployment, and where to go to see the next step actually running.

## Resource attributes and environment identity

Every piece of telemetry OpenTelemetry produces — every span, every
metric, every log record — carries a resource: a set of attributes
describing the entity that produced it, attached once at startup rather
than repeated on every signal. The OpenTelemetry resource semantic
conventions
([opentelemetry.io/docs/specs/semconv/resource](https://opentelemetry.io/docs/specs/semconv/resource/))
define a standard vocabulary for this, and the single most consequential
attribute for a production rollout is `deployment.environment.name` (the
successor to the earlier `deployment.environment` key, which many
instrumentation libraries and backends still accept): a short string like
`development`, `staging`, or `production` that says, unambiguously, where
this telemetry came from.

Without it, a dashboard built against a metric name has no way to separate
a load test running in staging from real customer traffic in production,
and a trace from a developer's laptop looks identical to a trace from a
paying customer's checkout. With it, every query, every alert, and every
dashboard panel can be scoped: show me the error rate in production only,
alert only on staging anomalies that persist past a threshold tolerant of
experimental deploys, or compare the same metric side by side across
environments to catch a regression before it reaches the one environment
that matters most.

Setting the resource attribute is a matter of configuration, not code, in
every stack covered by this tutorial — typically an environment variable
read by the OpenTelemetry SDK at startup:

```bash
OTEL_RESOURCE_ATTRIBUTES="deployment.environment.name=production,service.version=2.4.1"
```

The practical rule: this value should be injected by the deployment
pipeline or the orchestration platform, never hardcoded into application
configuration that gets rebuilt into a container image. A container image
built once and promoted unchanged through dev, staging, and production is
one of the more reliable rollout patterns precisely because the image
never has to know which environment it will land in; the environment tells
it, at the moment it starts.

## Rollout patterns

Promoting a build through environments is itself a telemetry concern, not
just a deployment concern, because the signals already in place are the
fastest way to tell whether a rollout is safe to continue. A canary
rollout — routing a small percentage of traffic to a new version while the
majority still runs the previous one — is only as good as the ability to
compare the two populations, which is exactly what the `service.version`
resource attribute and the golden-signal metrics covered in the chapter on
the service graph and SLOs make possible: the same error-rate and latency
queries, filtered to the
new version's attribute value, answer "is the canary healthy" directly.

A blue-green rollout, where a full second environment is stood up and
traffic is cut over at once rather than gradually, leans on the same
signals differently: the cutover decision itself should be gated on the
new environment's dashboards looking clean under synthetic or shadow
traffic before real traffic ever reaches it, and the rollback path — routing
back to the previous environment — should be exercised and timed before
anyone needs it under pressure.

Both patterns depend on the same underlying habit: resource attributes
that distinguish versions and environments cleanly enough that a dashboard
query can isolate the population in question without guesswork. A rollout
without that separation is a rollout where the only signal of a problem is
a customer complaint, which is the outcome the entire rest of this
tutorial exists to avoid.

Feature flags add a third dimension to this same pattern. A flag rollout —
enabling a new code path for a percentage of traffic or a specific cohort
of users — benefits from the identical approach: attach the flag's state as
a resource or span attribute (bounded to the flag's small set of possible
values, in keeping with the cardinality discipline from the chapter on
cardinality and cost) so that golden-signal queries can be filtered by flag state the
same way they are filtered by version or environment. A flag that silently
degrades latency for the cohort it is enabled on is otherwise invisible
until someone thinks to ask about it specifically; tagging it in telemetry
from the start means the question is answered by the same dashboards
already in place for every other rollout decision.

## Configuration as a deployable artifact

Everything this checklist describes — the Collector's redaction rules,
its exporter target, the resource attributes injected per environment —
is configuration, and the same discipline that applies to application code
should apply to it: checked into version control, reviewed before it
changes, and deployed through the same pipeline as everything else, rather
than edited by hand on a running Collector instance. A Collector
configuration that only exists as a live, undocumented edit on one host is
a single point of failure and a single point of knowledge loss the moment
the person who made that edit moves to a different project. Treating the
Collector's configuration file, the alerting rules from the chapter on the
service graph and SLOs, and the resource-attribute injection as ordinary artifacts that
move through the same review and deployment process as a service's own
code closes a gap that is easy to overlook: the observability pipeline is
infrastructure, and infrastructure drifts exactly as badly as application
code does when it is not held to the same standard.

## Secrets and PII do not belong in telemetry

Every signal covered in this tutorial — a span attribute, a log field, a
metric label, a baggage entry carried across a service boundary — is
captured, stored, indexed, and in many organizations retained for months.
That makes telemetry one of the easiest places to accidentally create a
compliance and security problem, because the data a span or log line
carries is often chosen for debugging convenience in the moment, without
anyone asking whether it is also sensitive data that should never leave
the service boundary unredacted.

The categories to treat as hard rules, not case-by-case judgment calls:
credentials, API keys, and tokens of any kind must never appear in a span
attribute, a log message, or baggage — not even "just for this one debug
log," because a debug log shipped to a shared backend is no longer private
to the person who wrote it. Personally identifiable information — full
names, email addresses, physical addresses, government identifiers, raw
payment details — needs the same treatment; an internal identifier that
maps to a person in an authoritative system is a safer thing to log than
the person's actual email address, because the identifier is useless to
anyone without separate access to that system, while the email address is
immediately exploitable on its own. Full request or response bodies are a
frequent accidental source of both categories at once: a request body
logged "to help debug" a failing endpoint very often contains exactly the
password reset token or billing address that should never have left the
service.

Preventing this is a layered effort, and no single layer is sufficient on
its own. At the instrumentation layer, the discipline is simple to state
and easy to skip under deadline pressure: review what gets attached to a
span or logged before merging, treat any field pulled from a request body,
header, or user profile as suspect until proven safe, and prefer logging
derived or redacted values (the last four digits of a card number, a
hashed identifier) over raw ones. At the Collector layer, the same
`attributes` and `transform` processors introduced for cardinality control
serve as a backstop here too, actively redacting known-sensitive attribute
keys centrally so that a lapse at the instrumentation layer in one service
does not become an unredacted field in the shared backend:

```yaml
processors:
  attributes/redact-pii:
    actions:
      - key: user.email
        action: delete
      - key: http.request.header.authorization
        action: delete
      - key: credit_card.number
        action: delete
```

Treat this Collector-side redaction the same way a web application
treats output encoding: a defense that should not be the only defense, but
that catches what inevitably slips through code review somewhere, at
some point, across however many services and however many engineers are
contributing to them.

## Security hardening beyond telemetry content

A few broader security practices matter alongside content hygiene, and
most of them are already standard operational practice, applied here to
the observability pipeline specifically rather than treated as a special
case. Transport between services and the Collector, and between the
Collector and the backend, should use TLS rather than the loopback-only,
unencrypted connections that are acceptable for local development.
Authentication on the OTLP receiver endpoint prevents an unauthenticated
process on the network from injecting arbitrary telemetry into the
pipeline — a concern that matters more, not less, once the Collector is
reachable beyond a developer's own machine. Role-based access control on
Grafana itself determines who can see which dashboards and data sources;
a staging environment's traffic details are a lower-stakes leak than a
production customer's, but neither should be visible to someone outside
the team responsible for that environment.

A short list is worth running through before a first real rollout: TLS enforced
on every hop between a service, the Collector, and the backend; the OTLP
receiver authenticated rather than open to anything on the network; access
to Grafana scoped by team and environment; and a documented owner for the
Collector configuration itself, so a redaction rule or an exporter change
goes through the same review a code change would. None of these is
specific to observability; they are the same baseline a production
database or a production API would be held to, applied here because the
telemetry pipeline carries just as much sensitive data as either one.

## Migrating from the local stack to a managed backend

The Loki, Grafana, Tempo, and Mimir containers used throughout this
tutorial are a complete, self-hosted LGTM stack, and self-hosting it at
production scale is a legitimate choice — plenty of organizations run
exactly this stack in production, with attention to its own scaling,
backup, and on-call needs. The more common path, though, especially for a
team that does not want observability infrastructure itself to become a
second product to operate, is migrating to a managed backend: a hosted
Grafana Cloud instance, or any other OTLP-compatible vendor.

The reason this migration is close to a non-event for the instrumented
services themselves is the architecture already in place: every service in
this tutorial emits OTLP to the Collector, not directly to Loki, Tempo, or
Mimir by name. Moving to a managed backend is a change to the Collector's
exporter configuration — pointing the `otlp` or vendor-specific exporter at
the managed endpoint and supplying its credentials — not a change to a
single line of application code. This is the practical payoff of
standardizing on OTLP and routing everything through a Collector from the
start: the backend becomes a swappable detail of the pipeline's last hop,
and a team can start local, move to self-hosted at scale, or move to a
managed vendor, without re-instrumenting anything in between.

## The deployment path: OpenShift on CodeReady Containers

Running containers on a laptop proves the signals work. It does not prove
the stack survives a real orchestration platform: pod restarts, network
policies, ingress, secrets management through the platform rather than
environment files, and multiple replicas of the same service generating
telemetry concurrently. The Appendix: Deploying to OpenShift with
CodeReady Containers chapter in this tutorial is exactly that next step —
the same demo application and the same LGTM stack, deployed onto a real
Kubernetes-based platform, with the Collector configuration, resource
attributes, and secret handling described in this chapter applied for
real rather than described in the abstract. Anyone using this tutorial as
a template for an actual production rollout should treat that appendix as
the worked example of what "production" concretely looks like once the
checklist in this chapter stops being a list of good intentions and
becomes a running cluster.

{% include excalidraw.html file="ch23-rollout-and-migration" alt="Diagram showing resource attributes promoting telemetry through dev, staging, and prod environments, a redaction step before export, and two downstream paths: the local LGTM stack used in this tutorial, deploying further to the OpenShift CRC appendix, and a managed observability backend for production" caption="Figure 23.1 — Promotion, redaction, and the path to a real backend" %}
