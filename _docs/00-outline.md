---
title: "Outline"
order: 0
part: "Foundations"
description: "What this tutorial covers, the five-signal map, the three language stacks, and how to read the chapters that follow."
---

A single e-commerce system runs three times in this tutorial: once on Spring Boot, once on Quarkus, once on Python. The business logic is identical in each version — place an order, check inventory, charge a card, write a review, ship a package, send a notification. What changes is the language and framework underneath, and what stays constant is the question the tutorial is built to answer: once that system is running in production and something goes wrong, how do you find out what happened?

That question has a name — observability — and an open standard built to answer it: OpenTelemetry. This tutorial teaches OpenTelemetry by instrumenting the same system three ways and watching the same five signals come out of each one, landing in the same self-hosted backend. The three implementations are not three separate tutorials glued together. They are one tutorial told three times, so the OpenTelemetry concepts separate cleanly from the framework-specific mechanics of registering a tracer or wiring a Micrometer bridge.

## The five signals

OpenTelemetry organizes everything a running system can tell you about itself into five signal types. Each one answers a different question, and each gets its own chapter later in the tutorial.

**Traces** answer "where did the time go, and in what order did things happen?" A trace is the record of one request's path through a distributed system: an order comes in, it calls inventory, inventory calls Postgres, the response comes back, payment gets called next. Each of those steps is a span, and a trace is a tree of spans connected by parent-child relationships. The [OpenTelemetry traces concept page](https://opentelemetry.io/docs/concepts/signals/traces/) covers the data model in detail; this tutorial starts applying it in the Spring Boot, Quarkus, and Python versions of the order service, first with automatic instrumentation and then with hand-written spans for the business logic that automatic instrumentation cannot see.

**Metrics** answer "how much, how often, how fast — in aggregate?" A single trace tells you what happened to one request; a metric tells you what's happening across all of them. Request latency as a histogram, queue depth as a gauge, orders placed per minute as a counter. The [metrics concept page](https://opentelemetry.io/docs/concepts/signals/metrics/) lays out the three instrument shapes this tutorial uses throughout.

**Logs** answer "what did the code say happened, in its own words?" Structured log lines, correlated to the trace that was active when they were written, turn a log search from "grep and hope" into "find the trace, read its logs." The [logs concept page](https://opentelemetry.io/docs/concepts/signals/logs/) describes how OpenTelemetry's log data model wraps existing logging libraries rather than replacing them, which matters because none of the three services in this tutorial throw out their existing logging framework.

**Baggage** answers a narrower but sharp question: "what context needs to travel with this request, to every service it touches, without being a span attribute on every single span?" A customer tier, an experiment flag, a tenant ID — baggage carries key-value pairs across process boundaries alongside the trace context itself. The [baggage concept page](https://opentelemetry.io/docs/concepts/signals/baggage/) is short because baggage is a simple mechanism; the tutorial chapter on it is less about the API and more about when to reach for it and when a span attribute would serve better.

**Profiles** are the newest signal in OpenTelemetry and answer "where is the CPU or memory actually going, inside the process, right now?" A trace tells you a span took 400ms; a profile, correlated to that same trace, tells you which function was burning those 400ms. The [profiles concept page](https://opentelemetry.io/docs/concepts/signals/profiles/) documents a signal still stabilizing in the specification; this tutorial uses Grafana Pyroscope, which already speaks the emerging OTLP profiling format, to show continuous profiling fitting alongside the other four signals rather than living in a separate tool with its own login.

{% include excalidraw.html file="ch00-tutorial-map" alt="Three language stacks (Spring Boot, Quarkus, Python) each instrumented with the OpenTelemetry API and SDK, sending OTLP over gRPC port 4317 or HTTP port 4318 to a Collector, which forwards to the LGTM stack: Tempo, Mimir, Loki, Pyroscope, and Grafana as the single UI." caption="Figure 0.1 — Three languages, one OpenTelemetry pipeline, one backend." %}

## Three languages, one meaning

Running the same system three times is not padding. It is the mechanism by which this tutorial separates two kinds of knowledge that usually get tangled together: what OpenTelemetry does, and how a particular framework happens to expose it.

Spring Boot instruments through the OpenTelemetry Java agent and Micrometer, the metrics facade Spring has used for years, now bridged to OpenTelemetry's metrics API. Quarkus takes a build-time approach: its OpenTelemetry extension wires instrumentation in at compile time rather than attaching an agent at startup, which changes how you configure it and how fast it starts, without changing what a span or a metric means once it's emitted. Python, lacking a bytecode-weaving agent in the Java sense, uses `opentelemetry-instrument` to monkey-patch known libraries at process start, which is a different mechanical trick again but produces the same OTLP wire format as the other two.

Read any one chapter in isolation and you'll see Java annotations, or a Quarkus `application.properties` key, or a Python decorator. Read the same chapter across all three implementations, as the chapters are structured to invite, and what's left after the syntax is subtracted is the actual OpenTelemetry concept: a span has a name, a start time, an end time, a set of attributes, and a parent. That's true whether the code that created it was written in Java or Python, and the tutorial's repeated structure is what makes that fact visible instead of asserted.

The manual-instrumentation chapters make this concrete. Starting a child span around a block of business logic looks like a try-with-resources block wrapping a tracer call in Spring Boot, a CDI interceptor annotation in Quarkus, or a context manager in Python. Three different idioms, one identical sequence of operations underneath: ask the current context for the active span, start a new span as its child, attach whatever attributes describe the work, and close the span when the block exits so its duration gets recorded. None of the three languages changes what gets sent over OTLP; they only change the syntax a developer uses to produce it, which is exactly the boundary this tutorial is built to make visible.

## The services the trace has to cross

The e-commerce domain introduced in Part 2 is split across six services rather than built as one — order, review, inventory, payment, shipping, notification — and they don't all talk to each other the same way. Order exposes a REST API and calls inventory and payment over gRPC. Review exposes GraphQL instead of REST, which later becomes a chapter in its own right once auto-instrumentation turns out not to understand a GraphQL resolver tree the way it understands an HTTP route. Shipping and notification don't get called directly at all; they consume an `order.placed` event off Kafka, asynchronously, sometime after the order request that triggered them has already returned a response to its caller.

That protocol mix is not incidental complexity. A trace that stays inside one REST call is the easy case, and automatic instrumentation handles it well in all three languages. A trace that has to survive a gRPC hop, then fork out over Kafka to two consumers that run minutes later, is where context propagation either works or silently breaks, and this tutorial's chapter on Kafka propagation shows the trace breaking before it shows how to fix it. Seeing that failure once is worth more than reading a paragraph asserting that propagation matters.

## Reading the code alongside the book

Every signal chapter pairs with a runnable branch of the same repository, tagged to that chapter, so the code in front of you on the page matches the code you can clone and run. Shell commands and configuration are shown as plain fenced blocks; where a concept is demonstrated three ways, a tabbed code block lets you flip between the Spring Boot, Quarkus, and Python versions without losing your place on the page. Diagrams appear as paired SVG and editable Excalidraw files, because a diagram worth including is a diagram worth someone redrawing with their own system's names in the boxes.

The [semantic conventions](https://opentelemetry.io/docs/concepts/semantic-conventions/) that name those attributes are part of the same story: `http.request.method`, `db.system.name`, and `messaging.destination.name` mean the same thing regardless of which service emitted them, which is what makes a Grafana dashboard built against one language's traces also work against the other two without modification.

## One stack, not three

The three language implementations share one piece of infrastructure: the Grafana LGTM stack, covered in depth two chapters from here. One Tempo holds every trace, one Mimir holds every metric, one Loki holds every log, one Pyroscope holds every profile, and one Grafana renders all four with the correlation links already wired between them, regardless of which of the three services produced the data. That's the point of a wire protocol like OTLP: the backend doesn't know or care whether the span it just received came from a Java agent or a Python monkey-patch, because by the time it arrives, it's just OTLP.

This also means the stack gets set up exactly once. Chapter 6 stands up Postgres, Kafka, and the LGTM container with `docker compose`, and every later chapter — regardless of which language's services are running against it — points at the same four ports: 3000 for Grafana, 4317 and 4318 for OTLP ingestion, 4040 for Pyroscope. Switching from reading the Spring Boot chapter to the Python chapter does not mean tearing down and rebuilding the observability backend; it means running a different `docker compose --profile` flag against infrastructure that was never touched.

## How the tutorial is organized

The book is laid out in five parts, visible in the sidebar as this chapter's siblings.

**Foundations** (this part) builds the vocabulary before any code runs: why observability matters, how OpenTelemetry's pieces fit together, what the LGTM stack holds and where, and what to install before Chapter 4's setup walkthrough.

**The demo application** introduces the e-commerce domain itself — six services, their contracts, the shared Postgres schema and Kafka topics — and gets a bare, uninstrumented skeleton of each service running in all three languages before a single span is emitted. Seeing the application work first, with no telemetry, makes it unambiguous later which capabilities OpenTelemetry actually added.

**The signals** is the bulk of the tutorial: one chapter per signal, each one implemented in Spring Boot, then Quarkus, then Python, with the Kafka-crossing trace and the auto-versus-manual instrumentation trade-off treated as signals in their own right because they raise questions the five core signals don't fully cover alone.

**Making signals useful** moves from "data exists" to "data answers questions": correlating traces, metrics, and logs into a single investigation; building dashboards that read across all three languages at once; and putting the Collector and sampling into the pipeline rather than sending every span straight to the backend.

**Production concerns** closes the tutorial with the parts of observability that only matter at scale — cardinality, cost, service-level objectives, a pre-production checklist — and a pointer to what's next once this tutorial's scope ends. An appendix covers deploying the whole system to OpenShift via CodeReady Containers for readers who want to see it running somewhere other than a laptop.

Each signal chapter in Part 3 follows the same shape: what the signal is, one subsection per language showing it implemented, then a short section on what the three implementations share and where they actually differ. Readers fluent in one of the three languages can read only that subsection per chapter and still follow the throughline; readers comparing frameworks can read all three and see the same OpenTelemetry concept wearing three different outfits.

## What "done" looks like for a chapter

Each signal chapter ends at the same checkpoint: a request that touches at least two of the three languages' shared infrastructure, instrumented well enough that its trace, its metrics, and its logs can all be found in Grafana starting from any one of the three. That checkpoint is concrete for a reason: "understand tracing" is not falsifiable, while "find this specific request's spans in Tempo, then jump from one of those spans to the log lines written while it executed" is something you either did or didn't do, and the tutorial checks it at the end of every chapter that introduces a new signal.

The later chapters raise the bar further. By the time Part 4 covers dashboards and the Collector, the expectation is not just that telemetry exists, but that it answers a question you didn't know to ask when you wrote the instrumentation: which service is the slowest link under load, what does a cardinality explosion in a metric label look like before it takes down the metrics backend, how much of the Collector's CPU goes to a processor you added without measuring it. Part 5's production checklist is the tutorial's own definition of what shipping this to a real environment would require beyond what a laptop demo needs.

## Before Chapter 1

No code runs in the Foundations part. The next three chapters build the concepts this tutorial leans on repeatedly: why opacity in a distributed system costs real money and real sleep (Chapter 1), how OpenTelemetry's API, SDK, and Collector relate to each other (Chapter 2), and what each piece of the LGTM stack is actually storing (Chapter 3). Chapter 4 is where a terminal finally gets used, installing the tools every later chapter assumes are already on the machine.
