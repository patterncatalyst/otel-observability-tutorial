// deck-observability-otel-101.js — "Observability & OpenTelemetry 101"
// Language-agnostic deck: why observability, the five signals, the OTel
// data model, the Grafana LGTM stack, correlation, semantic conventions,
// the Collector, and sampling. No language-specific API code — that is the
// per-language 201 decks' job (deck-observability-otel-201-<lang>.js).
//
// Build:  cd deck && node deck-observability-otel-101.js
// Output: ../presentations/observability-otel-101.pptx

"use strict";

const H = require("./deck-helpers.js");
const {
  COLOR, FONT, W, ASSETS,
  newDeck, addFooter, addContentTitle, addBullets, addTwoColBullets,
  addStatusTable, addCaption, addCodeSlide, addDiagramSlide, addSectionDivider, addNotes,
} = H;

const OUT = "../presentations/observability-otel-101.pptx";
const REV = "r01.0";

const pres = newDeck("Observability & OpenTelemetry 101");
let pageNum = 0;

function S() {
  const s = pres.addSlide();
  pageNum += 1;
  addFooter(s, pageNum);
  return s;
}
function divider(code, title, subtitle, notes) {
  const s = pres.addSlide();
  pageNum += 1;
  addSectionDivider(s, code, title, subtitle);
  addNotes(s, notes);
}

// =============================================================================
// Cover
// =============================================================================
{
  const s = pres.addSlide();
  pageNum += 1;
  s.background = { color: COLOR.white };
  try { s.addImage({ path: `${ASSETS}/cover-panel.png`, x: 0, y: 0, w: W, h: 7.5 }); } catch (e) {}
  s.addText("OBSERVABILITY 101", {
    x: 6.00, y: 1.98, w: 6.90, h: 0.34,
    fontFace: FONT.title, fontSize: 14, bold: true, color: COLOR.red, charSpacing: 6,
    align: "left", valign: "middle",
  });
  s.addText([
    { text: "Observability &", options: { breakLine: true } },
    { text: "OpenTelemetry" },
  ], {
    x: 5.95, y: 2.42, w: 6.95, h: 2.00,
    fontFace: FONT.title, fontSize: 50, bold: true, color: COLOR.ink,
    align: "left", valign: "top",
  });
  s.addText("Five signals, one data model, one correlated stack — before any language-specific code.", {
    x: 6.00, y: 4.55, w: 6.70, h: 0.95,
    fontFace: FONT.body, fontSize: 17, italic: true, color: COLOR.caption,
    align: "left", valign: "top",
  });
  s.addText(REV, {
    x: 11.85, y: 5.85, w: 0.95, h: 0.30,
    fontFace: FONT.mono, fontSize: 11, color: COLOR.caption,
    align: "right", valign: "middle",
  });
  try { s.addImage({ path: `${ASSETS}/logo-candidate-2.png`, x: 11.10, y: 6.80, w: 1.55, h: 0.37 }); } catch (e) {}
  addNotes(s, "Title slide. This deck is language-agnostic: it covers the concepts, the data model, and the shared stack every language track builds on. The three per-language 201 decks pick up from here with real API code. What to show: nothing yet — this is the framing slide before the stack comes up.");
}

// =============================================================================
// Agenda
// =============================================================================
{
  const s = S();
  addContentTitle(s, "AGENDA", "What this talk covers");
  addTwoColBullets(s, [
    { text: "Why observability", options: { bold: true } },
    "The cost of opacity, and why monitoring alone cannot close it",
    { text: "The five signals", options: { bold: true } },
    "Traces, metrics, logs, baggage, and profiles",
    { text: "The OpenTelemetry data model", options: { bold: true } },
    "API, SDK, instrumentation, Resource, and the Collector",
    { text: "The Grafana LGTM stack", options: { bold: true } },
    "Loki, Grafana, Tempo, Mimir, and Pyroscope",
  ], [
    { text: "Correlation", options: { bold: true } },
    "One trace_id across every signal, and how Grafana wires it",
    { text: "Semantic conventions", options: { bold: true } },
    "Why a shared vocabulary is what makes correlation possible at all",
    { text: "The Collector and sampling", options: { bold: true } },
    "Where cost and retention decisions actually live",
    { text: "Appendix: see it live", muted: true },
    { text: "The shared compose stack, Grafana at :3000", muted: true },
  ]);
  addNotes(s, "Walk the agenda left to right, top to bottom. The first half is concepts: why observability matters and what the five signals are. The second half is mechanics: the data model, the stack, correlation, conventions, and where cost decisions live. What to show: nothing yet, this is a roadmap slide.");
}

// =============================================================================
// Section 00 — Foundations
// =============================================================================
divider("00", "Foundations", "Why observability is a different relationship to the unknown.",
  "Section divider. This section sets up the core distinction every later section builds on: monitoring answers questions you already asked, observability answers the ones you have not asked yet. What to show: nothing — move straight to the next slide.");

{
  const s = S();
  addContentTitle(s, "FOUNDATIONS · MONITORING", "Monitoring answers known questions");
  addBullets(s, [
    { text: "Monitoring", options: { bold: true } },
    "watches a predetermined set of signals against predetermined thresholds: CPU above 90%, error rate above 5%, disk nearly full.",
    { text: "Each threshold", options: { bold: true } },
    "exists because someone decided, in advance, that a specific number crossing a specific line meant something was wrong.",
    { text: "The failure mode", options: { bold: true } },
    "is specific: monitoring can only answer questions it was configured in advance to answer.",
    { text: "A known-unknown", options: { bold: true } },
    "is a question you can name even without knowing the answer. A threshold alert answers it fine.",
  ]);
  addNotes(s, "Monitoring is not a weakness, it is the correct tool for problems you have seen before: a memory leak looks the same shape every time, and a threshold dashboard catches it reliably. The limit is that monitoring can only answer a question someone thought to ask in advance. What to show: nothing yet, this is scene-setting for the contrast on the next slide.");
}

{
  const s = S();
  addDiagramSlide(s, "FOUNDATIONS · CONTRAST", "Monitoring vs. observability",
    "r01-monitoring-vs-observability",
    "A production incident where every dashboard is green is exactly the gap this deck is about.");
  addNotes(s, "The example from the source material: checkout takes eleven seconds for a slice of customers, the connection pool dashboard is green, CPU is nowhere near its limit, and no alert fired. Every piece of monitoring built in advance is telling the truth and none of it is useful, because nobody dashboarded for this specific combination. What to show: nothing yet — this is the conceptual split before introducing the five signals.");
}

{
  const s = S();
  addContentTitle(s, "FOUNDATIONS · DEFINITION", "Observability answers new questions");
  addBullets(s, [
    { text: "Observability", options: { bold: true } },
    "is the ability to ask a new question about a running system without shipping new code to answer it.",
    { text: "An unknown-unknown", options: { bold: true } },
    "is a question nobody names until the moment it happens — the specific combination a real incident surfaces.",
    { text: "Arbitrary slicing after the fact", options: { bold: true } },
    "requires correlated identifiers (a trace ID in a span, a metric exemplar, and a log line) and high-cardinality attributes.",
    { text: "The cost of opacity", options: { bold: true } },
    "shows up as mean time to resolution: a correlated investigation takes minutes; an uncorrelated one takes hours of manual cross-referencing.",
  ]);
  addNotes(s, "The term comes from control theory: how well a system's internal state can be inferred from its external outputs. The practical test is whether an engineer can construct a query on the spot, during an incident, that nobody anticipated, and get an answer from data already being captured. What to show: nothing yet — the next section breaks this capability into five concrete signals.");
}

// =============================================================================
// Section 01 — The five signals
// =============================================================================
divider("01", "The Five Signals", "Traces, metrics, logs, baggage, and profiles — five angles on one request.",
  "Section divider. Each signal answers a different question about the same running request; none of them is sufficient alone. What to show: nothing — move to the signal map.");

{
  const s = S();
  addDiagramSlide(s, "THE FIVE SIGNALS · OVERVIEW", "Five angles on one request",
    "r02-five-signals",
    "No single signal is sufficient alone — an observable system has all five, correlated.");
  addNotes(s, "This is the map for the next five slides. A trace shows where time went; a metric shows whether this is new or baseline; a log shows what the code said; baggage carries business context across hops; a profile shows which function actually burned the CPU. What to show: nothing yet — detail each signal on the following slides.");
}

{
  const s = S();
  addContentTitle(s, "THE FIVE SIGNALS · TRACES", "The shape of one request");
  addBullets(s, [
    { text: "A trace", options: { bold: true } },
    "is a tree of timed spans connected by parent-child relationships, answering where a specific request's time went.",
    { text: "Each span", options: { bold: true } },
    "records a named operation, its duration, and the attributes describing what happened during it.",
    { text: "Context propagation", options: { bold: true } },
    "carries the trace across a process boundary, so a chain of HTTP, gRPC, and async hops still reads as one trace.",
    { text: "A broken trace", options: { bold: true } },
    "happens when a hop skips propagation — the receiving side starts a brand-new trace with no parent.",
  ]);
  addNotes(s, "Traces answer a request-scoped question: which span was slow, in which service. They do not tell you whether that slowness is new or has been the baseline for a week — that is a metrics question, covered next. What to show: a live trace waterfall in Grafana's Tempo view if the stack is up, following one request end to end.");
}

{
  const s = S();
  addContentTitle(s, "THE FIVE SIGNALS · METRICS", "The aggregate behind many requests");
  addBullets(s, [
    { text: "A metric", options: { bold: true } },
    "is an aggregate measurement over many requests: a counter, a gauge, or a histogram.",
    { text: "It answers", options: { bold: true } },
    "how the system is behaving overall right now, compared to five minutes ago — not which specific request failed.",
    { text: "A latency histogram", options: { bold: true } },
    "is the typical shape for request duration, letting p50, p95, and p99 be computed from the same series.",
    { text: "An exemplar", options: { bold: true } },
    "is a single sample attached to a histogram bucket, carrying the trace_id of one request that landed there.",
  ]);
  addNotes(s, "Metrics are cheap to store at high volume because they are pre-aggregated, which is exactly their limitation: a metric alone cannot tell you which specific request failed or why. Exemplars close that gap, covered in the correlation section. What to show: a Mimir-backed latency panel in Grafana with exemplar points visible as diamonds on the graph.");
}

{
  const s = S();
  addContentTitle(s, "THE FIVE SIGNALS · LOGS", "What the code said, correlated");
  addBullets(s, [
    { text: "A log", options: { bold: true } },
    "is a discrete event with a message and structured fields, answering what the code itself reported happening.",
    { text: "Correlated by trace_id", options: { bold: true } },
    "a log line emitted while a given span was active carries that span's trace_id as structured metadata, not embedded text.",
    { text: "Loki indexes labels", options: { bold: true } },
    "like service.name and trace_id, rather than full message text, keeping the index small at the cost of full-text search.",
    { text: "A log without a trace_id", options: { bold: true } },
    "is still useful on its own, but it cannot be clicked into from a trace — the correlation link has nothing to match.",
  ]);
  addNotes(s, "Because OTLP delivers trace_id as a structured field, Loki's derived-field link matches it as a label, not a regex over the log text. That is more reliable and is a direct consequence of exporting logs over OTLP in the first place. What to show: a log line in Loki with a clickable trace_id link back into Tempo.");
}

{
  const s = S();
  addContentTitle(s, "THE FIVE SIGNALS · BAGGAGE", "Business context across hops");
  addBullets(s, [
    { text: "Baggage", options: { bold: true } },
    "carries key-value business context — a cart ID, a tenant ID — alongside the trace, through every downstream service.",
    { text: "It rides in the propagation context", options: { bold: true } },
    "the same mechanism carrying the trace ID, over its own W3C baggage header.",
    { text: "Baggage is not a span attribute", options: { bold: true } },
    "setting it does nothing visible by itself; a service must explicitly read it and attach it to a span to see it in a trace.",
    { text: "It propagates everywhere", options: { bold: true } },
    "which is baggage's biggest feature and its biggest cost caution — every byte travels on every hop.",
  ]);
  addNotes(s, "Baggage answers a question neither traces nor logs answer on their own: which business entity, set once at the edge, is this operation three hops downstream actually working on. The cost caution is real: unlike a span attribute, a baggage entry is copied onto every outbound call whether or not the receiving service reads it. What to show: a Tempo query filtered by a baggage-derived span attribute like cart.id, if the demo app's compose stack is running.");
}

{
  const s = S();
  addContentTitle(s, "THE FIVE SIGNALS · PROFILES", "Where the CPU actually went");
  addBullets(s, [
    { text: "A profile", options: { bold: true } },
    "samples where CPU time or memory allocation is going inside a process, down to the function.",
    { text: "It answers", options: { bold: true } },
    "not just that a span took 400ms, but which line of code consumed those 400ms.",
    { text: "Continuous profiling", options: { bold: true } },
    "samples constantly in the background, independent of any single request, aggregated into flame graphs.",
    { text: "OTel profiling is still stabilizing", options: { bold: true } },
    "as a specification signal; Grafana Pyroscope's own push protocol is the pragmatic, available-now path.",
  ]);
  addNotes(s, "Profiling is the deepest level the correlation chain reaches: logs tell a story in prose, a flame graph shows the actual call stack accumulating time, function by function. What to show: a Pyroscope flame graph for a service during a known-slow window, reached by clicking through from a trace span if the correlation link is wired up.");
}

{
  const s = S();
  addContentTitle(s, "THE FIVE SIGNALS · TOGETHER", "No signal is sufficient alone");
  addStatusTable(s, [
    { code: "Trace", name: "alone", purpose: "Shows which span was slow; does not show whether that is new or the baseline." },
    { code: "Metric", name: "alone", purpose: "Shows error rate spiked at 14:03; does not show which requests failed or why." },
    { code: "Log", name: "alone", purpose: "Shows what the code reported; does not show where in the request it happened." },
    { code: "All five", name: "correlated", purpose: "One investigation with four tabs, joined by a shared trace_id and resource attributes." },
  ], { colW: [1.60, 2.00, 8.49] });
  addNotes(s, "This is the thesis of the deck in one table: each signal solves an adjacent problem, and an observable system is one where all five are available and correlated to each other through shared identifiers, not five separate tools with five separate logins. The next sections cover the data model that produces these signals, then the stack that stores them, then the correlation mechanics that tie them together. What to show: nothing — transition slide into the architecture section.");
}

// =============================================================================
// Section 02 — OpenTelemetry architecture
// =============================================================================
divider("02", "OpenTelemetry Architecture", "API, SDK, instrumentation, Resource, and the Collector.",
  "Section divider. This section covers the layering that makes every later configuration choice — which dependency to add, why a span shows up with no attributes, why disabling the SDK does not remove instrumented code — a direct consequence of the architecture rather than arbitrary. What to show: nothing yet.");

{
  const s = S();
  addContentTitle(s, "ARCHITECTURE · API VS. SDK", "The interface and the implementation");
  addBullets(s, [
    { text: "The API", options: { bold: true } },
    "defines the types a developer codes against: start a span, record an attribute, get the current context. It ships with a no-op default.",
    { text: "A no-op API call", options: { bold: true } },
    "costs almost nothing and does nothing — which is what lets a library instrument itself unconditionally, with no imposed backend.",
    { text: "The SDK", options: { bold: true } },
    "is the concrete implementation that turns the API on: it builds a real span, runs samplers and processors, and exports it.",
    { text: "An application", options: { bold: true } },
    "wires up exactly one SDK, once, and every API call anywhere underneath it — including code it did not write — produces real telemetry.",
  ]);
  addNotes(s, "This is why 'add tracing to a library' and 'configure tracing for an application' are different tasks with different audiences. A library author only ever touches the API; an application author configures the SDK once and gets the combined output of every API call made anywhere beneath it. What to show: nothing yet — instrumentation is the next concept.");
}

{
  const s = S();
  addContentTitle(s, "ARCHITECTURE · INSTRUMENTATION", "Zero-code first, manual spans on top");
  addBullets(s, [
    { text: "Instrumentation", options: { bold: true } },
    "is the code that calls the API at the right moments: wrapping a handler to start a span per request.",
    { text: "Zero-code instrumentation", options: { bold: true } },
    "attaches at process startup — a Java agent rewriting bytecode, or a Python launcher monkey-patching known libraries.",
    { text: "Code-based instrumentation", options: { bold: true } },
    "is a library a developer imports and calls explicitly, layered on top for business logic a framework boundary cannot see.",
    { text: "The common pattern", options: { bold: true } },
    "across every language track: zero-code first for the fastest path to real telemetry, manual spans for domain logic second.",
  ]);
  addNotes(s, "Every language chapter in the full tutorial starts with zero-code instrumentation, because it is the fastest way to see real telemetry with no application code changes, then layers manual spans on top for the business logic a generic HTTP or database instrumentation cannot see — a payment authorization, an inventory reservation. What to show: nothing — this stays conceptual in the 101; the 201 decks show the actual dependency and code per language.");
}

{
  const s = S();
  addDiagramSlide(s, "ARCHITECTURE · PIPELINE", "From instrumentation to a backend",
    "r03-otel-architecture",
    "One span's path: API, SDK, OTLP, Collector, and three signal-specific backends.");
  addNotes(s, "Trace one span through the whole stack: instrumentation calls the API, the SDK attaches Resource and checks the sampler, the exporter sends it over OTLP to the Collector, and the Collector routes it onward. None of these five steps is visible in the Grafana UI; all five are why the trace in front of you is coherent instead of a pile of disconnected fragments. What to show: nothing yet — Resource and the Collector each get their own slide next.");
}

{
  const s = S();
  addContentTitle(s, "ARCHITECTURE · RESOURCE", "Who emitted this data");
  addBullets(s, [
    { text: "Resource", options: { bold: true } },
    "is a fixed set of attributes describing the entity producing telemetry, attached once per SDK instance, not repeated per span.",
    { text: "service.name", options: { bold: true } },
    "is the single most important attribute in the whole system — it is what lets Grafana group traces, metrics, and logs by service.",
    { text: "service.version and deployment.environment", options: { bold: true } },
    "round out the three attributes that matter most for filtering and comparing telemetry across a rollout or an environment.",
    { text: "Without service.name set", options: { bold: true } },
    "every span from every service looks like it came from the same anonymous source — no per-service filtering is possible.",
  ]);
  addNotes(s, "Resource answers 'who emitted this,' as distinct from a span's own attributes, which answer 'what happened during this operation.' Every SDK configuration in a real deployment sets service.name as close to first as any configuration gets, because correlation, dashboards, and the service graph all depend on it being populated correctly from the start. What to show: nothing yet — semantic conventions, covered later, is what standardizes these attribute names across languages.");
}

{
  const s = S();
  addContentTitle(s, "ARCHITECTURE · OTLP", "Two ports, one wire format");
  addStatusTable(s, [
    { code: "4317", name: "OTLP/gRPC", purpose: "Protocol Buffers over HTTP/2; suits long-lived services with mature gRPC tooling." },
    { code: "4318", name: "OTLP/HTTP", purpose: "Protobuf or JSON over HTTP/1.1; suits proxies, serverless, or a plain curl against the endpoint." },
  ], { colW: [1.60, 2.40, 8.09] });
  addNotes(s, "Both transports carry identical semantic content — the choice is about the runtime and network environment, not what data can be expressed. The shared stack exposes both ports on the same Collector, and each language's exporter picks whichever its SDK defaults to or the configuration explicitly sets. What to show: nothing — a curl against the OTLP/HTTP endpoint if demonstrating that it is plain HTTP underneath.");
}

// =============================================================================
// Section 03 — The Grafana LGTM stack
// =============================================================================
divider("03", "The Grafana LGTM Stack", "Four stores, four shapes of data, one UI.",
  "Section divider. None of the four backend stores is interchangeable with another — each is built around a different shape of data. What to show: nothing yet.");

{
  const s = S();
  addContentTitle(s, "THE LGTM STACK · FOUR STORES", "Four shapes of data, four engines");
  addStatusTable(s, [
    { code: "Tempo", name: "traces", purpose: "Write: a steady stream of spans. Read: look up one trace ID, or filter by attributes." },
    { code: "Mimir", name: "metrics", purpose: "Prometheus remote-write; small numeric samples, read as aggregation over a time range." },
    { code: "Loki", name: "logs", purpose: "Indexes labels like service.name and trace_id, not full text — cheap index, grep-like search." },
    { code: "Pyroscope", name: "profiles", purpose: "Compact, timestamped CPU/memory samples aggregated into flame graphs; its own container." },
  ], { colW: [1.70, 1.90, 8.49] });
  addNotes(s, "A store built for Loki's append-heavy, label-indexed streams would struggle with Mimir's requirement to aggregate millions of samples into one number in under a second. Specialization costs four processes instead of one, and buys performance a single undifferentiated store cannot match at observability volumes. What to show: nothing yet — the all-in-one image, next, is what hides that operational complexity for local development.");
}

{
  const s = S();
  addDiagramSlide(s, "THE LGTM STACK · TOPOLOGY", "One container, four stores, one UI",
    "r04-lgtm-stack",
    "grafana/otel-lgtm bundles Grafana, Tempo, Mimir, Loki, and an embedded Collector in a single image.");
  addNotes(s, "Grafana itself stores nothing telemetry-related — it is the query and visualization layer in front of all four stores. Pyroscope runs as its own container, reflecting that continuous profiling is architecturally distinct from the other three signals. Kafka and Postgres round out the shared infrastructure but are not signal stores. What to show: nothing yet — correlation, the next section, is how these four stores read as one investigation instead of four separate tools.");
}

{
  const s = S();
  addContentTitle(s, "THE LGTM STACK · THE ONE GUI", "Grafana, and only Grafana");
  addBullets(s, [
    { text: "Every other interaction", options: { bold: true } },
    "with this stack — starting services, shaping Collector pipelines, running load — happens from files and the command line.",
    { text: "Grafana earns its exception", options: { bold: true } },
    "because visualizing a time series or a trace waterfall as text is a worse experience than looking at it.",
    { text: "Kafka gets no GUI", options: { bold: true } },
    "the tool for inspecting a topic or a consumer group is kcat, run on demand from the terminal.",
    { text: "Even the GUI is file-backed", options: { bold: true } },
    "dashboards and datasource links are JSON and YAML on disk, provisioned automatically, reviewable in a diff.",
  ]);
  addNotes(s, "This is a deliberate discipline, not an oversight: readers expecting a point-and-click Kafka browser alongside Grafana will not find one, because the CLI habit is the one worth building — production Kafka clusters rarely ship a GUI either. What to show: open Grafana at localhost:3000, then run a kcat command against the broker from a terminal in the same breath, to make the contrast concrete.");
}

// =============================================================================
// Section 04 — Correlation
// =============================================================================
divider("04", "Correlation", "One trace_id, four signals, one investigation.",
  "Section divider. Correlation requires no application code — it is entirely provisioning, a block of YAML read once at Grafana startup. What to show: nothing yet.");

{
  const s = S();
  addDiagramSlide(s, "CORRELATION · THE IDENTIFIER", "One trace_id ties four stores together",
    "r05-correlation-flow",
    "Grafana's datasource provisioning teaches each store where to find trace_id in the others.");
  addNotes(s, "A single slow checkout request produces four separate records: a trace in Tempo, log lines in Loki, a histogram observation in Mimir, and a CPU profile in Pyroscope. Taken separately these are four blank-query-box investigations; tied by trace_id, they become one investigation with four tabs. What to show: nothing yet — the next slide names each specific link.");
}

{
  const s = S();
  addContentTitle(s, "CORRELATION · THE LINKS", "Four links, four directions");
  addStatusTable(s, [
    { code: "tracesToLogsV2", name: "trace to logs", purpose: "Filters Loki by service.name and trace_id, shifted ±5m around the span." },
    { code: "derivedFields", name: "logs to trace", purpose: "Matches trace_id as a structured label on the log line, not a text regex." },
    { code: "tracesToMetrics", name: "trace to metrics", purpose: "Runs request-rate and error-rate PromQL scoped to the span's service and window." },
    { code: "exemplars", name: "metric to trace", purpose: "A histogram sample carrying one request's trace_id; a clickable diamond on the graph." },
  ], { colW: [2.60, 2.20, 7.29] });
  addNotes(s, "Each of these lives in stack/grafana/datasources.yaml as a jsonData block — a tag-name mapping, like service.name in traces to service_name in Loki's labels, and a time-shift window to catch log lines written slightly before or after the span closed. None of it requires a code change in any service. What to show: the actual datasources.yaml file, or a live click-through from a trace span to its logs in Grafana.");
}

{
  const s = S();
  addContentTitle(s, "CORRELATION · ONE INVESTIGATION", "Four queries, four stores, one thread");
  addBullets(s, [
    { text: "A Mimir panel", options: { bold: true } },
    "shows order-service p99 latency climbing. An exemplar diamond opens the one trace that produced that sample.",
    { text: "Inside that trace", options: { bold: true } },
    "one span dominates the duration: a call to the payment service.",
    { text: "The trace-to-logs link", options: { bold: true } },
    "surfaces the exact log lines the payment service wrote during that span — not a generic tail of its logs.",
    { text: "The trace-to-profiles link", options: { bold: true } },
    "opens a Pyroscope flame graph for that service over that exact window, if the bottleneck turns out to be CPU-bound.",
  ]);
  addNotes(s, "None of the four stores needed to know anything about the other three to make this work — the correlation lives entirely in Grafana's datasource configuration. What has to be true for any of it to work: a trace context that propagates cleanly across every hop, and attribute names that agree across signals, which is exactly what semantic conventions guarantee, covered next. What to show: walk this exact investigation live if the demo stack and traffic generator are running.");
}

// =============================================================================
// Section 05 — Semantic conventions
// =============================================================================
divider("05", "Semantic Conventions", "A shared vocabulary is what makes correlation possible.",
  "Section divider. None of the correlation in the previous section happens because the signals are related in some abstract sense — it happens because every signal uses the same attribute names for the same concepts. What to show: nothing yet.");

{
  const s = S();
  addContentTitle(s, "SEMANTIC CONVENTIONS · THE PROBLEM", "Two engineers, two naming schemes, zero correlation");
  addBullets(s, [
    { text: "One service", options: { bold: true } },
    "names the HTTP method attribute http.method; another, having read a different source, names it httpMethod.",
    { text: "Every choice", options: { bold: true } },
    "is individually reasonable. Collectively, they make cross-service analysis nearly impossible.",
    { text: "A query built against one service's names", options: { bold: true } },
    "silently returns nothing for the other — not because the data is missing, but because it lives under a different key.",
    { text: "Semantic conventions", options: { bold: true } },
    "are OpenTelemetry's versioned, publicly maintained answer: what an attribute should be named, and what values it should take.",
  ]);
  addNotes(s, "Every language's SDK and auto-instrumentation libraries implement the same conventions, which is why auto-instrumented HTTP spans from two services in two different languages carry the same attribute names even though nobody hand-matched them. What to show: nothing yet — the next slide covers which conventions matter in practice.");
}

{
  const s = S();
  addContentTitle(s, "SEMANTIC CONVENTIONS · IN PRACTICE", "Resource and operation conventions");
  addStatusTable(s, [
    { code: "Resource", name: "service.name, .version", purpose: "Who produced this data — the three attributes correlation depends on most." },
    { code: "HTTP", name: "http.request.method", purpose: "http.route (the matched template, not the raw path), response.status_code." },
    { code: "Database", name: "db.system, db.namespace", purpose: "Same vocabulary whether the query came from a JDBC driver or a Python client." },
    { code: "RPC / Messaging", name: "rpc.system, messaging.*", purpose: "gRPC calls and Kafka producer/consumer spans read as one conceptual operation." },
  ], { colW: [2.10, 2.60, 7.39] });
  addNotes(s, "The HTTP conventions are the clearest example of versioning in practice: earlier drafts used http.method and http.status_code; the stabilized conventions use http.request.method and http.response.status_code, to make room for request-versus-response-specific attributes as the convention grew. What to show: nothing — this stays conceptual in the 101.");
}

{
  const s = S();
  addContentTitle(s, "SEMANTIC CONVENTIONS · WHY IT MATTERS", "Correlation is an exact-match join");
  addBullets(s, [
    { text: "A log line correlates to a trace", options: { bold: true } },
    "because it carries that trace's trace_id and span_id, using the field names Tempo and Loki both expect.",
    { text: "None of these correlations", options: { bold: true } },
    "are computed by inspecting message content or guessing similarity — they are exact-match joins on conventionally named fields.",
    { text: "A quiet failure mode", options: { bold: true } },
    "if one service emits service.name and another emits serviceName, the correlation link finds no match — no error, just an empty result.",
    { text: "Custom attributes still need namespacing", options: { bold: true } },
    "order.sku rather than a bare sku, so a future standard attribute never collides with an application-specific one.",
  ]);
  addNotes(s, "This is why adopting the published convention is worth more than inventing an equally sensible scheme from scratch: the specification's names are the ones every off-the-shelf auto-instrumentation library, every Grafana panel, and every backend's OTLP ingestion is already built to expect. What to show: nothing — transition into the Collector section, where these conventions get enforced and enriched centrally.");
}

// =============================================================================
// Section 06 — The Collector and sampling
// =============================================================================
divider("06", "The Collector & Sampling", "Where cross-cutting decisions, and cost decisions, actually live.",
  "Section divider. Every service in a well-built deployment sends telemetry to the same Collector first, not directly to a backend — that extra hop is where decisions unrelated to any one service's business logic get made once. What to show: nothing yet.");

{
  const s = S();
  addDiagramSlide(s, "THE COLLECTOR · PIPELINE", "Receivers, processors, exporters",
    "r06-collector-pipeline",
    "A pipeline is a declared sequence: receivers feed an ordered processor chain, feeding one or more exporters.");
  addNotes(s, "A single otlp receiver, listening on both gRPC and HTTP, feeds all three signal pipelines, because every service speaks OTLP regardless of language. memory_limiter goes first to catch an overload before any other processor does further work on data that might get dropped anyway; resource backfills environment context a service should not need to know; batch amortizes network calls last. What to show: the base Collector config file if walking through it live.");
}

{
  const s = S();
  addContentTitle(s, "THE COLLECTOR · WHY CENTRALIZE", "One place, not one place per service");
  addBullets(s, [
    { text: "memory_limiter, resource, and batch", options: { bold: true } },
    "have nothing to do with what any particular service does — every service needs the exact same protection and tagging.",
    { text: "Implementing each concern per service", options: { bold: true } },
    "would mean a separate implementation per language, and a separate chance to get memory protection subtly wrong in one.",
    { text: "Switching backends, or adding a second one", options: { bold: true } },
    "becomes a Collector configuration change, not a redeployment of every instrumented service.",
    { text: "Redaction belongs here too", options: { bold: true } },
    "stripping a credit-card fragment or an email address before it ever reaches a backend, regardless of whether the source service remembered to scrub it.",
  ]);
  addNotes(s, "The Collector is a chokepoint, which is usually a liability — one component everything passes through is one component whose overload affects everything behind it, which is exactly why memory_limiter exists and goes first. But the same property makes it valuable once protected: one place to inspect, shape, and govern every signal from every service. What to show: nothing — sampling, next, is the clearest example of a decision that belongs here.");
}

{
  const s = S();
  addDiagramSlide(s, "SAMPLING · HEAD VS. TAIL", "Deciding blind, or deciding informed",
    "r07-sampling-head-vs-tail",
    "Head sampling decides before a trace's outcome is known; tail sampling decides after.");
  addNotes(s, "Head sampling flips a coin at the root span, deterministically by trace ID, before anyone knows whether the request was interesting. Cheap, but a slow failing request is exactly as likely to be discarded as a fast healthy one. Tail sampling buffers the whole trace at the Collector and applies ordered policies instead: keep errors, keep slow requests, keep named critical routes, sample a flat percentage of the rest, all decided after the outcome is fully known. A mature setup often combines both. What to show: nothing — this stays conceptual in the 101.");
}

{
  const s = S();
  addContentTitle(s, "DASHBOARDS · AS CODE", "RED for services, USE for infrastructure");
  addStatusTable(s, [
    { code: "RED", name: "request-driven services", purpose: "Rate, Errors, Duration — the three questions an on-call engineer asks first." },
    { code: "USE", name: "infrastructure underneath", purpose: "Utilization, Saturation, Errors — is the box the service runs on out of headroom." },
    { code: "Dashboards as code", name: "JSON on disk", purpose: "Provisioned on container startup; a restart reproduces exactly what was committed, not a browser session's state." },
  ], { colW: [2.30, 2.90, 6.89] });
  addNotes(s, "RED describes a service from the outside, in terms of the requests arriving at it; USE describes the resource it runs on. A RED dashboard shows a latency spike, a USE dashboard checked next shows whether that spike coincides with a resource pinned at capacity. Every panel built from a Prometheus-backed histogram with exemplars enabled becomes a jump point into the trace behind one sample. What to show: a provisioned service-overview dashboard in Grafana if one exists for the stack being demoed.");
}

// =============================================================================
// Appendix — see it live
// =============================================================================
divider("A", "Appendix: See It Live", "The shared compose stack — keep this open in another window.",
  "Section divider for the appendix. This is reference material for running the stack locally, not meant to be read front to back during a talk. What to show: nothing yet — the next slide has the actual commands and ports.");

{
  const s = S();
  addContentTitle(s, "APPENDIX · RUNNING THE STACK", "One compose file, one command");
  addStatusTable(s, [
    { code: "3000", name: "Grafana", purpose: "The one GUI this stack asks you to learn — traces, metrics, logs, and profiles, correlated." },
    { code: "4317 / 4318", name: "Collector OTLP", purpose: "gRPC and HTTP ingestion; every instrumented service exports here, not to a backend directly." },
    { code: "3200 / 9090 / 3100", name: "Tempo / Mimir / Loki", purpose: "Rarely queried directly — Grafana is the front door to all three." },
    { code: "4040", name: "Pyroscope", purpose: "Continuous profiling UI, running as its own container outside the all-in-one image." },
  ], { colW: [2.20, 2.40, 7.49] });
  addCaption(s, "docker compose -f stack/compose.yaml up -d   ·   kafka inspected via kcat, not a GUI");
  addNotes(s, "The stack starts with one command and no profile selected brings up infra only: Grafana LGTM, Pyroscope, Postgres, and Kafka. Kafka gets inspected from the command line with kcat under the tools compose profile — there is no bundled Kafka UI, by design, since production Kafka clusters rarely ship one either. What to show: bring the stack up live, open Grafana at localhost:3000, and run one kcat command against a topic from a second terminal to show the CLI-first habit in practice.");
}

{
  const s = S();
  addContentTitle(s, "CLOSING", "From here, pick a language");
  addBullets(s, [
    { text: "This deck covered the shared ground", options: { bold: true } },
    "the five signals, the data model, the stack, correlation, conventions, and where cost decisions live.",
    { text: "None of it was language-specific", options: { bold: true } },
    "because none of the mechanism is — the exporter configuration decides where data lands, not the instrumentation.",
    { text: "The 201 decks pick up from here", options: { bold: true } },
    "with real zero-code and manual-span instrumentation in a specific language and framework.",
    { text: "The correlation payoff", options: { bold: true } },
    "is the same regardless of which language track you follow: one trace_id, four signals, one investigation.",
  ]);
  addNotes(s, "Close by pointing at the next step: whichever language track the audience is headed toward, the concepts here carry over unchanged, including the five signals, the Collector as a chokepoint, and semantic conventions as the mechanism behind correlation. What to show: nothing — this is the handoff slide to the language-specific deck.");
}

pres.writeFile({ fileName: OUT })
  .then((p) => console.log("WROTE", p))
  .catch((e) => { console.error(e); process.exit(1); });
