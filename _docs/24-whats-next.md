---
title: "What's next"
order: 24
part: "Production concerns"
description: "OTLP profiles as the emerging fourth signal, eBPF-based auto-instrumentation, the wider OpenTelemetry ecosystem, and where to read further."
---

Three signals have carried this entire tutorial: traces, metrics, and logs,
plus profiling introduced through the Pyroscope SDK as a fourth dimension
alongside them. That is a complete, production-usable observability
surface, and everything built across this tutorial, the Collector
pipeline, the sampling strategy, the cardinality controls, the service
graph and SLOs, applies directly to real systems today. It is also not the
end state of where OpenTelemetry itself is heading. What follows looks at what is coming next in the standard, what the
SDK-level path this tutorial took will likely be joined or partly replaced
by, and where to go to keep learning once the tutorial itself is finished.

## OTLP profiles: profiling joins the standard

The chapter on profiling used the Pyroscope SDK directly: an
application-level library, separate from the OpenTelemetry
SDK, producing flame graphs that correlate with traces through shared
identifiers. That approach works well today and is a reasonable production
choice, but it means profiling data travels its own path, in its own
format, outside the OTLP protocol that carries every other signal in this
tutorial.

OpenTelemetry's profiling signal, still progressing through the
specification process, changes that by defining profiles as a first-class
OTLP signal, carried the same way traces, metrics, and logs already are:
through the same Collector receivers, the same exporter configuration, and
the same resource-attribute model that ties a profile to the exact service
instance and environment that produced it. The specification work is
tracked openly at
[opentelemetry.io/docs/specs/otel/profiles](https://opentelemetry.io/docs/specs/otel/profiles/),
and it is worth treating as an evolving standard rather than a finished
one: the wire format, the semantic conventions for profile-specific
attributes, and the SDK APIs for emitting profiles are all still settling,
in the way the logs signal itself was still settling for the first couple
of years after traces and metrics had stabilized.

The practical consequence for a team evaluating this today: the Pyroscope
SDK path used throughout this tutorial remains the pragmatic choice for a
project that needs profiling now, and Pyroscope itself is investing in
OTLP profile support rather than treating the two as competitors. The
migration path, once OTLP profiles mature, looks like every other signal
migration this tutorial has already described for moving between
backends — a change to Collector configuration and SDK profile export
settings, not a rewrite of how a service is instrumented, provided the
service's profiling data is already flowing through the Collector rather
than directly to a profiling-specific backend with no OTLP mediation in
between. Keeping that Collector-mediated path is the single choice today
that keeps the eventual move to native OTLP profiles cheap.

## eBPF: instrumentation without touching the code

Every instrumentation technique covered in this tutorial, automatic or
manual, runs inside the application process: an SDK linked into the
runtime, an agent attached at startup, or hand-written spans in application
code. eBPF-based instrumentation takes a fundamentally different approach,
observing a process from the Linux kernel rather than from inside it.
eBPF (extended Berkeley Packet Filter) programs run in a sandboxed
in-kernel virtual machine and can attach to system calls, network events,
and function entry and exit points across every process on a host,
including processes that were never built with any observability library
in mind at all.

Applied to distributed tracing, this means spans can be generated for
HTTP, gRPC, and database calls made by a process that has zero
OpenTelemetry SDK installed, zero auto-instrumentation agent attached, and
zero code changes of any kind, by watching the system calls and library
functions that process uses to make those calls in the first place. The
OpenTelemetry eBPF-based instrumentation effort, part of the broader
project alongside the per-language SDKs documented at
[opentelemetry.io/docs/concepts/instrumentation](https://opentelemetry.io/docs/concepts/instrumentation/),
targets exactly this case: legacy applications that cannot be easily
rebuilt or redeployed with an SDK, polyglot environments where maintaining
a separate instrumentation approach per language is its own maintenance
burden, and any situation where even an auto-instrumentation agent's
startup overhead or memory footprint is unwelcome.

The tradeoff is depth versus reach. The manual spans and semantic
conventions this tutorial builds around produce traces that carry
business-meaningful detail, an order ID, a cart's contents, a
reason a payment was declined, because a developer chose what to attach
knowing what the operation meant. eBPF-based instrumentation observes at
the level of system calls and network sockets, which is extremely broad
and automatic but inherently blind to that kind of business context: it
can tell you a service made an outbound call to a particular host and port
and how long it took, not what that call meant to the business logic
making it. The practical pattern emerging across the ecosystem is not
"eBPF instead of SDK-based instrumentation" but "eBPF as a baseline layer
underneath it": automatic, zero-touch coverage for every process on a
host, with SDK-based manual instrumentation layered on top for the
specific operations where business context matters enough to justify a
code change.

eBPF programs also carry real operational tradeoffs worth weighing before
adopting them as a baseline layer. They require kernel privileges to load,
which means a hosting environment has to permit them, something not every
managed container platform or restrictive Kubernetes cluster allows by
default. Kernel version compatibility matters too: an eBPF program written
against one kernel's tracepoints and data structures is not automatically
portable to a much older or much newer kernel, which is a different kind of
compatibility concern than anything an SDK-based approach has to deal with,
since an SDK talks to a stable language runtime rather than directly to
kernel internals. None of this makes eBPF-based instrumentation less
valuable; it makes it a tool with its own deployment prerequisites, best
adopted with those prerequisites in mind rather than treated as a drop-in
replacement for every SDK already in place.

## Stability levels and how the standard evolves

Not every part of OpenTelemetry moves at the same pace, and knowing which
stability tier a feature sits in is practical information before building
on it in production. The specification marks each signal and each API
surface as experimental, stable, or deprecated. Traces and metrics, the
two signals at the core of this entire tutorial, have been stable for
years, which is part of why the instrumentation patterns covered here will
keep working without rewrites. Logs reached stability more recently. OTLP
profiles, the emerging fourth signal, are still experimental, which is the practical
reason to treat the Pyroscope SDK as the production-ready choice today
rather than waiting on a signal still being finalized.

This tiering is published alongside every part of the specification at
[opentelemetry.io/docs/specs/otel](https://opentelemetry.io/docs/specs/otel/),
and it is worth checking before depending on a newer API in a long-lived
service: an experimental feature can still change its wire format or its
semantic conventions in a breaking way between releases, where a stable
one carries the same backward-compatibility guarantees any other mature
open standard does. The project's governance, run through the Cloud Native
Computing Foundation with contributions from essentially every major
observability and cloud vendor, is also why this stability model holds up
in practice: no single vendor can unilaterally break a stable signal
without the same kind of broad community pushback any other CNCF graduated
project would face.

## The wider OpenTelemetry ecosystem

Everything this tutorial covered sits on a small slice of a much larger
project. A few parts of that wider ecosystem are worth knowing by name,
because a real deployment will likely touch at least one of them even
though none of them were needed to build the demo application here.

The Collector's contrib distribution, separate from the core distribution
used throughout this tutorial, packages hundreds of additional receivers,
processors, connectors, and exporters contributed by the broader community
and by vendors: everything from the `servicegraph` and `spanmetrics`
connectors already covered to receivers for scraping metrics out of
systems that predate OpenTelemetry entirely, like older
Prometheus exporters, Kafka topics, or vendor-specific agents. Most
production Collector deployments run the contrib distribution rather than
the minimal core build, specifically for this breadth.

OpAMP (the Open Agent Management Protocol) addresses a problem this
tutorial's single-Collector setup never had to face: how to manage
configuration, health, and updates for a fleet of Collectors and
instrumentation agents running across hundreds or thousands of hosts,
rather than one instance running locally. It gives a central control plane
a standard way to push configuration changes, roll out agent updates, and
collect health status back, the same kind of fleet-management layer that
container orchestration platforms provide for workloads, applied here to
the observability agents themselves.

OTTL, the OpenTelemetry Transformation Language, is the expression
language behind the Collector's `transform` processor, already used for attribute
redaction and cardinality control elsewhere in this tutorial's production
concerns material. It continues
to grow its own function library and its own ecosystem of shared,
reusable transformation snippets, worth watching if Collector-side data
shaping becomes a larger part of a production pipeline than this tutorial's
examples.

The semantic conventions project, referenced throughout the signal
chapters, is itself a living, versioned standard, not a fixed spec: new
conventions are added for emerging technologies (generative AI workloads,
for instance, have their own growing set of semantic conventions), and
existing ones occasionally undergo breaking changes as the working groups
learn from real-world adoption. Pinning a specific semantic conventions
version in a production deployment, rather than always tracking the
latest, is a reasonable way to avoid an unexpected attribute rename
breaking a dashboard built against the old name.

## Further Reading

This tutorial focused on the mechanics: what to instrument, how the
signals correlate, how to keep them affordable, and how to turn them into
alerts that page the right person at the right time. The three books
linked from this site's reading list go deeper into the thinking behind
those mechanics, each from a different angle, and are worth reading in
full once the hands-on material here feels solid.

[*Observability Engineering*](https://www.oreilly.com/library/view/observability-engineering/9781492076438/), by Charity Majors, Liz Fong-Jones, and George
Miranda, makes the case for observability as a distinct discipline from
traditional monitoring, built around the idea that a useful observability
practice lets you ask new questions of a system after an incident starts,
rather than only answering the questions a dashboard was built to answer
in advance. It is the closest match to this tutorial's own emphasis on
structured, correlated signals over isolated metrics.

[*Site Reliability Engineering*](https://www.oreilly.com/library/view/site-reliability-engineering/9798341607675/) and its companion volumes, from Google,
are where the SLO and error-budget framing used in the service graph
chapter originates, laid out in far more depth than a single chapter can
cover, including how error budgets interact with release velocity and
on-call practice at organizational scale.

[*Building Resilient Distributed Systems*](https://www.oreilly.com/library/view/building-resilient-distributed/9781098163532/) — call it patterns for designing
systems that survive partial failure, which is the backdrop every signal
in this tutorial exists to make visible. Traces, metrics, logs, and
profiles do not make a system resilient on their own; they make it
possible to see where resilience is missing, which is the necessary first
step before any of the patterns in that kind of book can be applied with
confidence.

None of the three assumes OpenTelemetry specifically; all three predate
large parts of the standard as it exists today, and reading them after
this tutorial rather than before is deliberate. The concepts land
differently once there is a concrete pipeline, a service graph, and a set
of SLO dashboards to map them onto, rather than reading about error
budgets or wide structured events in the abstract, before having built
anything that produces them.

All three are linked from the hub site's reading list, alongside the
project's own evolving set of links to the OpenTelemetry specification,
the Collector contrib repository, and the Tempo and Mimir documentation
referenced throughout this tutorial's production concerns material.

## Closing

The signals, the Collector pipeline, the sampling and cardinality
discipline, and the SLOs built on top of them are not a finished state to
reach once and leave alone. OpenTelemetry itself is still adding signals,
still refining its conventions, and still absorbing new instrumentation
techniques like eBPF into its scope. The habits this tutorial tried to
build, correlating signals by design rather than by accident, treating
cost and cardinality as first-class design constraints, and keeping
configuration for the pipeline itself under the same discipline as
application code, transfer cleanly to whatever the standard adds next.
That is the actual payoff of learning the mechanism rather than memorizing
today's specific API surface: the next signal OpenTelemetry standardizes
will fit into a pipeline already built to receive it.

{% include excalidraw.html file="ch24-ecosystem" alt="Diagram showing OTLP profiles and the Pyroscope SDK converging toward OpenTelemetry core, alongside eBPF auto-instrumentation, with core radiating out to the Collector Contrib ecosystem, semantic conventions, and OpAMP and the wider ecosystem" caption="Figure 24.1 — OpenTelemetry's expanding signal and tooling surface" %}
