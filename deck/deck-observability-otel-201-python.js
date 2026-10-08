// deck-observability-otel-201-python.js — "OpenTelemetry 201: Python"
// Python-specific deck: zero-code auto-instrumentation via opentelemetry-
// distro / opentelemetry-instrument, the manual SDK setup in obs/otel.py
// that fills the async gap (grpc.aio, asyncpg), FastAPI/Strawberry/aiokafka
// instrumentation, the OTel Metrics API used directly, structured logging
// and the verified service.name correlation bug, baggage, Kafka context
// propagation via aiokafka, Pyroscope profiling, and uv/UBI10 packaging.
// Picks up where deck-observability-otel-101.js leaves off — assumes the
// five signals, the OTel data model, and the Grafana LGTM stack are known.
//
// Build:  cd deck && node deck-observability-otel-201-python.js
//         (run `python3 build_python.py` first if diagrams changed)
// Output: ../presentations/observability-otel-201-python.pptx

"use strict";

const H = require("./deck-helpers.js");
const {
  COLOR, FONT, W, ASSETS,
  newDeck, addFooter, addContentTitle, addBullets, addTwoColBullets,
  addStatusTable, addCaption, addCodeSlide, addDiagramSlide, addSectionDivider, addNotes,
} = H;

const OUT = "../presentations/observability-otel-201-python.pptx";
const REV = "r01.0";

const pres = newDeck("OpenTelemetry 201: Python");
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
  s.addText("OPENTELEMETRY 201", {
    x: 6.00, y: 1.98, w: 6.90, h: 0.34,
    fontFace: FONT.title, fontSize: 14, bold: true, color: COLOR.red, charSpacing: 6,
    align: "left", valign: "middle",
  });
  s.addText([
    { text: "OpenTelemetry 201:", options: { breakLine: true } },
    { text: "Python" },
  ], {
    x: 5.95, y: 2.42, w: 6.95, h: 2.00,
    fontFace: FONT.title, fontSize: 50, bold: true, color: COLOR.ink,
    align: "left", valign: "top",
  });
  s.addText("A zero-code launcher, a manual SDK filling the async gap, and the correlation bug it's easy to ship.", {
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
  addNotes(s, "Title slide. This deck assumes the 101 deck's concepts — the five signals, the OTel data model, the Grafana LGTM stack, correlation, semantic conventions — and picks up with the Python-specific mechanics: how this stack's six Python services actually get instrumented, where the zero-code model stops, and a real correlation bug this codebase shipped and fixed. What to show: nothing yet — this is the framing slide before any code.");
}

// =============================================================================
// Agenda
// =============================================================================
{
  const s = S();
  addContentTitle(s, "AGENDA", "What this talk covers");
  addTwoColBullets(s, [
    { text: "Zero-code instrumentation", options: { bold: true } },
    "opentelemetry-instrument, the launcher model, and how it contrasts with a Java agent and a Quarkus extension",
    { text: "Manual SDK setup", options: { bold: true } },
    "obs/otel.py — one setup() call, a composite propagator, and the async instrumentors zero-code can't reach",
    { text: "Framework & driver instrumentation", options: { bold: true } },
    "FastAPI, grpc.aio, Strawberry GraphQL, asyncpg",
    { text: "Metrics", options: { bold: true } },
    "the OTel Metrics API used directly, no Micrometer-style bridge, and exemplars",
  ], [
    { text: "Logs", options: { bold: true } },
    "structured JSON + trace_id, and the service.name bug this tutorial actually shipped",
    { text: "Baggage & Kafka", options: { bold: true } },
    "cart.id propagation, and aiokafka's fully hand-written context injection/extraction",
    { text: "Profiling & packaging", options: { bold: true } },
    "the Pyroscope SDK as a plain import, uv, Python 3.14, UBI 10",
    { text: "Appendix: verifying it", muted: true },
    { text: "curl, kcat, and Loki/Tempo queries that catch each failure mode", muted: true },
  ]);
  addNotes(s, "Walk the agenda left to right, top to bottom. The throughline is the same question asked at every boundary: does an instrumentor already exist and is it wired in, and if not, whose job is it to fill the gap. Python answers that question differently than Java at almost every boundary, which is the point of a language-specific 201 deck. What to show: nothing yet, this is a roadmap slide.");
}

// =============================================================================
// Section 00 — Zero-code instrumentation
// =============================================================================
divider("00", "Zero-Code Instrumentation", "opentelemetry-instrument wraps the process. It does not live inside it.",
  "Section divider. The headline idea for this whole section: Python's zero-code path is architecturally different from both Java mechanisms the audience may already know, even though the environment-variable configuration surface looks identical to the Java agent's. What to show: nothing — move to the launcher slide.");

{
  const s = S();
  addContentTitle(s, "ZERO-CODE · THE LAUNCHER", "opentelemetry-instrument wraps the process");
  addBullets(s, [
    { text: "opentelemetry-distro", options: { bold: true } },
    "ships a launcher, opentelemetry-instrument, installed as a console script alongside the SDK and exporter packages.",
    { text: "It is not an agent", options: { bold: true } },
    "running inside an already-started interpreter — it is the process that starts first, in place of your application.",
    { text: "Before your application module is ever imported", options: { bold: true } },
    "the launcher sets up the SDK and monkey-patches the installed instrumentation packages' target modules.",
    { text: "Then it execs into your real command", options: { bold: true } },
    "uvicorn, in this tutorial's case — which imports your app only after the libraries it depends on are already patched.",
  ]);
  addNotes(s, "This is the headline mechanism for the whole Python track: no application code imports an OpenTelemetry package to get a first trace, and configuration comes from plain OTEL_* environment variables — on the surface this looks exactly like the Java agent's story from the 101 deck. The mechanism underneath is different, and that difference is what the next few slides unpack. What to show: nothing yet — the contrast table is next.");
}

{
  const s = S();
  addContentTitle(s, "ZERO-CODE · THREE MECHANISMS", "Same environment variables, three different attach points");
  addStatusTable(s, [
    { code: "Java agent", name: "Spring Boot", purpose: "-javaagent jar; instruments bytecode as classes load. Reads OTEL_* env vars directly." },
    { code: "Build-time extension", name: "Quarkus", purpose: "quarkus-opentelemetry generates instrumentation during mvn package. Needs quarkus.otel.* keys explicitly mapped to OTEL_*." },
    { code: "Zero-code launcher", name: "Python", purpose: "opentelemetry-instrument wraps the process at exec time. Reads OTEL_* env vars directly, same as the Java agent." },
  ], { colW: [2.60, 2.20, 7.29] });
  addNotes(s, "Python's configuration story matches the Java agent's, not Quarkus's extension: there is no config-mapping gap to fall into here, because the launcher reads OTEL_SERVICE_NAME, OTEL_EXPORTER_OTLP_ENDPOINT, and OTEL_PROPAGATORS the same way the agent does. What differs is architectural, not configuration-surface-level — there is no bytecode weaving happening inside a running interpreter, because CPython has no equivalent of a JVM-level agent operating below the interpreter. What to show: the diagram next makes this concrete.");
}

{
  const s = S();
  addDiagramSlide(s, "ZERO-CODE · MECHANISM", "Discover, patch, then exec",
    "py01-launcher-mechanism",
    "opentelemetry-instrument discovers installed instrumentation packages and patches their target libraries before uvicorn ever imports order.main.");
  addNotes(s, "Trace the bottom flow left to right: the container's ENTRYPOINT is opentelemetry-instrument itself, not uvicorn directly. It discovers which instrumentation packages are installed — opentelemetry-instrumentation-fastapi, -grpc, -asyncpg, pinned in pyproject.toml alongside the distro — and patches their target libraries. Only then does it exec into uvicorn, which imports order.main and constructs the FastAPI app object the already-patched library wraps. What to show: the pyproject.toml dependency block if walking through it live — opentelemetry-distro, -sdk, -exporter-otlp-proto-http, and the three instrumentation-* packages pinned together.");
}

{
  const s = S();
  addCodeSlide(s, "ZERO-CODE · ENTRYPOINT ORDERING", "The launcher has to be the ENTRYPOINT", "dockerfile", [
    "# services/python/order/Containerfile",
    "ENTRYPOINT [\"opentelemetry-instrument\", \"uvicorn\",",
    "            \"order.main:app\", \"--host\", \"0.0.0.0\", \"--port\", \"8080\"]",
    "",
    "# Reverse it — import FastAPI first, instrument second — and the",
    "# patches land on a module that already built its class hierarchy",
    "# without them. Some auto-instrumentation never takes effect.",
  ], "Ordering is not cosmetic: the launcher has to run before anything imports the library it means to patch.", { fontSize: 15 });
  addNotes(s, "This is the one gotcha specific to the launcher model: there is no retrofitting a patch onto a module that already finished building its class hierarchy. Calling opentelemetry-instrument from inside main.py, or invoking it anywhere other than as the container's actual entrypoint, is the single most common way this mechanism silently fails to instrument anything. What to show: the actual Containerfile ENTRYPOINT line if debugging a service that starts but produces no spans.");
}

{
  const s = S();
  addCodeSlide(s, "ZERO-CODE · THE ASYNC GAP", "grpc.aio and asyncpg need a manual nudge", "python", [
    "# services/python/order/src/obs/otel.py",
    "def _enable_auto_instrumentation() -> None:",
    "    try:",
    "        from opentelemetry.instrumentation.grpc import (",
    "            GrpcAioInstrumentorClient,",
    "            GrpcAioInstrumentorServer,",
    "        )",
    "        GrpcAioInstrumentorClient().instrument()",
    "        GrpcAioInstrumentorServer().instrument()",
    "    except Exception:",
    "        pass",
  ], "The generic zero-code grpc hook only wires the synchronous API, not grpc.aio — every service here is asyncio throughout.", { fontSize: 14 });
  addNotes(s, "This is the first concrete instance of the chapter 17 decision framework: an instrumentor exists for grpc, but the zero-code launcher's hook for it doesn't reliably reach the asyncio client and server interceptors this tutorial's order service actually uses. The fix is not writing a span by hand — it's registering the asyncio-aware instrumentor classes explicitly, which is manual instrumentor registration, a narrower task than manual spans. What to show: nothing yet — the next section covers where this call lives and why running it alongside the launcher is safe rather than redundant.");
}

// =============================================================================
// Section 01 — Manual SDK setup
// =============================================================================
divider("01", "Manual SDK Setup", "obs/otel.py: one setup() call, and the two things the launcher doesn't cover.",
  "Section divider. Every Python service in this tutorial runs opentelemetry-instrument AND a module-level setup() call — this section explains why that's not double instrumentation. What to show: nothing yet.");

{
  const s = S();
  addContentTitle(s, "MANUAL SETUP · obs/otel.py", "One function, three signal pipelines");
  addBullets(s, [
    { text: "setup(service_name)", options: { bold: true } },
    "is called once from each service's FastAPI lifespan or worker startup — order, inventory, payment, shipping, notification, review all call the same shared module.",
    { text: "It builds one Resource", options: { bold: true } },
    "service.name, service.version, deployment.environment — and wires a TracerProvider, a MeterProvider, and a LoggerProvider against it, each with its own OTLP/HTTP exporter.",
    { text: "Running both the launcher and this setup is deliberate", options: { bold: true } },
    "the OpenTelemetry API refuses a second set_tracer_provider call and logs a harmless warning rather than exporting twice — whichever runs first wins.",
    { text: "This module's real job", options: { bold: true } },
    "is the parts neither the launcher nor the instrumentation packages cover automatically: the aio gRPC instrumentors, the Pyroscope hook, and binding FastAPI to the live app object.",
  ]);
  addNotes(s, "This is the Python track's version of chapter 17's hybrid framework applied to the SDK bootstrap itself, not just to spans: auto-instrumentation and manual setup aren't competing choices here, they're two code paths converging on one provider registration, with the loser's setup calls becoming no-ops instead of errors. What to show: obs/otel.py's module docstring, which states this explicitly as the design intent rather than an accident.");
}

{
  const s = S();
  addCodeSlide(s, "MANUAL SETUP · PROPAGATION", "CompositePropagator: trace context plus baggage", "python", [
    "# services/python/order/src/obs/otel.py",
    "from opentelemetry.propagators.composite import CompositePropagator",
    "from opentelemetry.trace.propagation.tracecontext import (",
    "    TraceContextTextMapPropagator,",
    ")",
    "from opentelemetry.baggage.propagation import W3CBaggagePropagator",
    "",
    "set_global_textmap(",
    "    CompositePropagator(",
    "        [TraceContextTextMapPropagator(), W3CBaggagePropagator()]",
    "    )",
    ")",
  ], "Baggage must ride alongside trace context on every hop — tracecontext alone would silently drop cart.id.", { fontSize: 14 });
  addNotes(s, "This single line is the reason cart.id survives the gRPC hop to inventory and payment later in this deck: OTEL_PROPAGATORS=tracecontext,baggage in the Containerfile tells the launcher the same thing this CompositePropagator tells the manual setup, and the two have to agree or baggage propagates for some code paths and silently vanishes for others. What to show: the matching OTEL_PROPAGATORS environment variable in the Containerfile, confirming the launcher and the manual setup aren't configured to disagree.");
}

{
  const s = S();
  addContentTitle(s, "MANUAL SETUP · GETTING A TRACER", "otel.tracer() — no DI container to ask instead");
  addBullets(s, [
    { text: "Spring Boot reaches for GlobalOpenTelemetry.getTracer(...)", options: { bold: true } },
    "a static accessor, because the Java agent populated that global the moment it attached.",
    { text: "Quarkus injects Tracer as a CDI bean", options: { bold: true } },
    "@Inject Tracer tracer — idiomatic Quarkus, registered by the quarkus-opentelemetry extension.",
    { text: "Python calls otel.tracer()", options: { bold: true } },
    "a plain function this project wrote, returning the tracer setup() already created and cached at module scope.",
    { text: "There is no CDI-equivalent container", options: { bold: true } },
    "and no global accessor as convenient as Java's — the helper exists because Python's ecosystem doesn't supply one.",
  ]);
  addNotes(s, "This is a project convention, not a framework one: otel.tracer() and otel.meter() are plain functions in obs/otel.py, returning module-level globals populated by setup(). Every service's business logic imports obs.otel and calls tracer() or meter() the same way, which is as close to Java's dependency-injection convenience as a service with no container gets. What to show: nothing yet — the next slide is where that tracer actually gets used.");
}

{
  const s = S();
  addContentTitle(s, "MANUAL SPANS · ANATOMY", "A retry loop auto-instrumentation can't see");
  addBullets(s, [
    { text: "A span has four parts, set independently", options: { bold: true } },
    "a name chosen for the business operation, attributes as key/value pairs, timestamped events, and a terminal status — true whether an agent or application code creates the span.",
    { text: "_check_stock_with_retry is where a manual span would attach", options: { bold: true } },
    "it wraps up to five attempts around the inventory gRPC call today with a plain try/except and a log.warning per attempt — no span of its own yet.",
    { text: "A span added there would carry an attempt count as an attribute", options: { bold: true } },
    "a failed-attempt event per retry, and an OK or ERROR status once the loop exits — the three pieces a log line alone can't group under one timeline.",
    { text: "Naming would follow the business operation, not the protocol call", options: { bold: true } },
    "check_stock already names the auto-generated gRPC client span nested inside each attempt; the wrapping span needs its own name.",
  ]);
  addNotes(s, "This retry loop is real — it lives in order's _check_stock_with_retry — but it has no manual span today, only a log.warning per failed attempt. The point of this slide is the anatomy a span would need if one were added here, not a span that exists in the codebase right now. What to show: the real retry loop in order/src/order/main.py, and what each log.warning call would become if replaced with a span event.");
}

{
  const s = S();
  addContentTitle(s, "MANUAL SPANS · ENRICHING, NOT CREATING", "Enrichment, Not a New Span");
  addTwoColBullets(s, [
    { text: "A new child span", options: { bold: true } },
    "is the right tool when the thing being described has its own start, its own end, and its own possible failure — a retry loop, a resolver call with a real cost.",
    { text: "trace.get_current_span()", options: { bold: true } },
    "returns whatever span is active on the current context — the auto-generated FastAPI or gRPC server span, if no manual child span has started yet.",
    { text: "No Tracer call needed for this", options: { bold: true } },
    "there is nothing to start and nothing to end, because the span being enriched isn't owned by this code at all.",
  ], [
    { text: "The one real example in this codebase", options: { bold: true } },
    "is cart.id: the order service sets it as baggage, and inventory and payment read it back and attach it to their own incoming spans — covered later in this section.",
    { text: "With tracing disabled", options: { bold: true } },
    "OTEL_SDK_DISABLED=true, get_current_span() returns a harmless no-op span that silently discards the attribute — no if-tracing-enabled guard needed.",
    { text: "The rule of thumb", options: { bold: true } },
    "reach for a new child span only when the operation has its own lifecycle; reach for get_current_span() to attach a fact to the one already in flight.",
  ]);
  addNotes(s, "This is the same API shape across every language this tutorial covers — the contrast earlier in this section, otel.tracer() versus a static accessor, only applies to starting a brand-new span. Enriching an existing one needs no Tracer reference at all. What to show: nothing yet — the baggage section later in this deck has the real cart.id example with its actual file paths.");
}

{
  const s = S();
  addDiagramSlide(s, "THE GAP MAP", "Zero-code stops at the async boundary",
    "py02-instrumentation-coverage",
    "FastAPI and the synchronous paths are covered; grpc.aio, asyncpg, Strawberry resolvers, and aiokafka all need something written by hand.");
  addNotes(s, "This is the Python track's version of chapter 17's decision framework, laid out spatially: the left panel is 'nothing to write,' the right panel is where every remaining slide in the framework and instrumentation sections of this deck lives. Notice the right panel has two different kinds of manual work in it — grpc.aio and asyncpg are one line of instrumentor registration each, while Strawberry's resolver spans and aiokafka's propagation are entirely hand-written code. What to show: nothing yet — the next section covers each right-panel box in turn.");
}

// =============================================================================
// Section 02 — Framework & driver instrumentation
// =============================================================================
divider("02", "Framework & Driver Instrumentation", "FastAPI, grpc.aio, Strawberry, and asyncpg — four boundaries, two patterns.",
  "Section divider. Two patterns repeat across these four libraries: bind against a live object (FastAPI), or name a span the protocol boundary can't see (GraphQL resolvers). What to show: nothing yet.");

{
  const s = S();
  addCodeSlide(s, "FASTAPI · LIVE APP BINDING", "Instrumented against the app object, not a class", "python", [
    "# services/python/order/src/obs/otel.py",
    "def instrument_fastapi(app) -> None:",
    "    \"\"\"FastAPI is instrumented against the live app object, so",
    "    services that serve HTTP call this from their startup once",
    "    the app exists.\"\"\"",
    "    if os.getenv(\"OTEL_SDK_DISABLED\", \"false\").lower() == \"true\":",
    "        return",
    "    from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor",
    "    FastAPIInstrumentor.instrument_app(app)",
  ], "Called from each service's lifespan handler once the FastAPI() instance exists — order, review, and every HTTP-facing Python service.", { fontSize: 14 });
  addNotes(s, "FastAPIInstrumentor.instrument_app() needs a concrete app instance, which is why this is a function call from the lifespan handler rather than something the zero-code launcher can do unconditionally at import time — the launcher patches the FastAPI class generically, this call wraps this specific instance's middleware stack. The OTEL_SDK_DISABLED check matches the chapter 6 no-telemetry baseline toggle, the same one the Java agent and Quarkus extension both respect. What to show: the review service's lifespan calling this right after otel.setup(), same pattern in every HTTP service.");
}

{
  const s = S();
  addCodeSlide(s, "STRAWBERRY · RESOLVER-LEVEL SPANS", "Naming what one HTTP span can't distinguish", "python", [
    "# services/python/review/src/review/main.py",
    "@strawberry.type",
    "class Query:",
    "    @strawberry.field",
    "    async def reviews(self, sku: str | None = None) -> list[Review]:",
    "        with otel.tracer().start_as_current_span(\"review.resolve_reviews\"):",
    "            pool = await db.get_pool()",
    "            rows = await pool.fetch(f\"SELECT {SELECT_FIELDS} FROM reviews\")",
    "            return [_row_to_review(r) for r in rows]",
  ], "FastAPI's instrumentor sees one POST /graphql request; it has no way to know which of three resolvers ran.", { fontSize: 14 });
  addNotes(s, "This is a manual span, not enrichment — FastAPI auto-instrumentation creates exactly one span for the HTTP request, and GraphQL lets one request touch multiple logical operations behind that single endpoint, invisibly to the HTTP span. review.resolve_reviews, review.resolve_review, and review.add_review are each named for the resolver they wrap, nested as children under the auto-generated POST /graphql span. What to show: a trace for an addReview mutation in Tempo — one root HTTP span, one child resolver span, one asyncpg INSERT span nested under that.");
}

// =============================================================================
// Section 03 — Metrics
// =============================================================================
divider("03", "Metrics", "The OTel Metrics API, used directly — no bridge, because there's nothing to bridge from.",
  "Section divider. Spring Boot and Quarkus both bridge an existing Micrometer MeterRegistry onto the OTel SDK; Python has no competing metrics API to bridge from. What to show: nothing yet.");

{
  const s = S();
  addContentTitle(s, "METRICS · NO BRIDGE NEEDED", "otel.meter() is the only metrics path that exists");
  addBullets(s, [
    { text: "Spring Boot and Quarkus both bridge Micrometer", options: { bold: true } },
    "onto the OpenTelemetry SDK — a runtime bridge via the Java agent, a build-time one via quarkus-micrometer-opentelemetry.",
    { text: "Python has no second metrics API competing for the role", options: { bold: true } },
    "otel.meter(), returning a Meter from the SDK's MeterProvider, is created straight from the OpenTelemetry Metrics API with no intermediary.",
    { text: "orders_placed_total is written directly in Prometheus-shaped form", options: { bold: true } },
    "underscores, a _total suffix — unlike Micrometer's dot-separated orders.fulfillment.duration, which needs a naming translation on the way out.",
    { text: "No pull-based /metrics endpoint exists", options: { bold: true } },
    "otel.meter() only ever pushes via PeriodicExportingMetricReader — verifying the counter means checking Mimir, or the correlated log line, not scraping the process directly.",
  ]);
  addNotes(s, "This is the cleanest contrast in the whole 201 series: identical business decision, identical metric name and status tag across all three languages, but Python's code path to Mimir has one fewer layer than either Java stack, because there was never a pre-existing Micrometer convention to preserve compatibility with. What to show: nothing yet — the actual counter code is next.");
}

{
  const s = S();
  addCodeSlide(s, "METRICS · THE REAL COUNTER", "orders_placed_total, created once and incremented per request", "python", [
    "# services/python/order/src/order/main.py",
    "app.state.orders_counter = otel.meter().create_counter(",
    "    \"orders_placed_total\", description=\"Orders placed, by status\"",
    ")",
    "",
    "# ...incremented per request in the handler:",
    "app.state.orders_counter.add(1, {\"status\": status})",
  ], "status takes exactly two values — PLACED or REJECTED — so this counter stays at two time series no matter how much traffic grows.", { fontSize: 14 });
  addNotes(s, "This instrument is created once at startup and recorded against directly with no bridge to reason about — contrast this with Spring and Quarkus's identical meterRegistry.counter(...).increment() call, same metric name and status tag, one fewer layer underneath because there's no Micrometer bridge to translate through. What to show: a Mimir query for orders_placed_total if live — note Python's metric name needs no dots-to-underscores translation, because it was written in Prometheus-shaped form from the start.");
}

{
  const s = S();
  addContentTitle(s, "METRICS · EXEMPLARS", "A sample point that remembers a trace ID");
  addBullets(s, [
    { text: "OTEL_METRICS_EXEMPLAR_FILTER=trace_based", options: { bold: true } },
    "set in the Containerfile, tells the SDK to attach an exemplar to a measurement whenever a sampled trace is active at record time — no extra code at the call site.",
    { text: "orders_counter.add(...) executes inside the active span", options: { bold: true } },
    "the auto-generated POST /orders root span, so every increment has a live trace context to attach.",
    { text: "Exemplars generally attach to histogram buckets", options: { bold: true } },
    "a counter like this one carries a single exemplar per data point instead, but the SDK attaches it the same way.",
    { text: "Checking the counter before trusting the pipeline", options: { bold: true } },
    "query Mimir for orders_placed_total directly to rule out a handler that never ran, before assuming the exemplar wiring is at fault.",
  ]);
  addNotes(s, "In Grafana, a panel backed by orders_placed_total renders small diamond markers above data points where exemplars were captured, and clicking one jumps directly into the matching trace in Tempo — the same payoff the 101 deck described in the abstract, now backed by Python's actual counter call. What to show: a Mimir-backed panel with exemplar diamonds, clicked through to a trace.");
}

// =============================================================================
// Section 04 — Logs
// =============================================================================
divider("04", "Logs", "Structured JSON, trace_id stamped on, and a correlation bug this tutorial actually shipped.",
  "Section divider. The headline of this section is not a mechanism — it's a verified bug and its one-line fix, which is more instructive than any amount of correct code would be. What to show: nothing yet.");

{
  const s = S();
  addCodeSlide(s, "LOGS · STRUCTURED JSON + TRACE_ID", "TraceContextFilter stamps every record by hand", "python", [
    "# services/python/order/src/obs/logging.py",
    "class TraceContextFilter(logging.Filter):",
    "    \"\"\"Inject trace_id/span_id (or '-') onto every record.\"\"\"",
    "",
    "    def filter(self, record: logging.LogRecord) -> bool:",
    "        span = trace.get_current_span()",
    "        ctx = span.get_span_context() if span else None",
    "        if ctx and ctx.is_valid:",
    "            record.trace_id = format(ctx.trace_id, \"032x\")",
    "            record.span_id = format(ctx.span_id, \"016x\")",
    "        else:",
    "            record.trace_id = \"-\"",
    "            record.span_id = \"-\"",
    "        return True",
  ], "Spring's MDC is populated by the javaagent; Python has no agent to do this, so a filter does it explicitly.", { fontSize: 13 });
  addNotes(s, "This filter backs the JSON stdout handler that obs.logging.configure() installs — the view podman logs shows during local development, independent of whether the OTel SDK has even started. Compare this to Spring Boot, where trace_id and span_id appear in Logback's MDC purely as a side effect of the Java agent watching Logback's internals, with zero application code. Python's equivalent has to exist as actual code, because there is no agent watching anything. What to show: a podman logs tail showing a JSON line with a populated trace_id next to one with a dash.");
}

{
  const s = S();
  addContentTitle(s, "LOGS · TWO PATHS, ONE ORDERING RULE", "configure() resets handlers; setup() only appends");
  addBullets(s, [
    { text: "obs.logging.configure()", options: { bold: true } },
    "runs first and sets up the JSON stdout handler — what podman logs shows, independent of the OTel SDK's state.",
    { text: "obs.otel.setup() runs second", options: { bold: true } },
    "and appends a LoggingHandler bound to a LoggerProvider with a BatchLogRecordProcessor, exporting over OTLP to the Collector's /v1/logs.",
    { text: "The OTLP handler auto-stamps trace_id/span_id", options: { bold: true } },
    "independently of the JSON filter — it reads the SDK's own notion of the active span, not the filter's.",
    { text: "Reversing the call order silently breaks OTLP log export", options: { bold: true } },
    "because configure() resets the root logger's handler list; calling it after setup() wipes out the handler setup() just added.",
  ]);
  addNotes(s, "This ordering constraint is a smaller cousin of the ENTRYPOINT ordering rule from the zero-code section: both are cases where Python's lack of a declarative, framework-managed bootstrap means the call order in a lifespan handler determines whether export works at all. Every service in this tutorial calls obslog.configure() then otel.setup() in that order, in every lifespan function, for exactly this reason. What to show: nothing yet — the bug on the next slide is the real-world consequence of resource configuration, not handler ordering, going wrong.");
}

{
  const s = S();
  addContentTitle(s, "LOGS · THE BUG", "One service.name, or correlation breaks silently");
  addBullets(s, [
    { text: "compose.yaml sets OTEL_SERVICE_NAME to order-python", options: { bold: true } },
    "and the zero-code launcher picked it up correctly for traces and metrics — it reads that variable itself.",
    { text: "obs.otel.setup(service_name) was originally called with the bare name", options: { bold: true } },
    "\"order\" — and used that function argument directly to build the Resource for the manually-wired log and profile signals.",
    { text: "The result: four signals, two identities", options: { bold: true } },
    "traces and metrics appeared in Grafana as order-python; that same process's logs and profiles landed under the bare name order.",
    { text: "Nothing crashed. Nothing logged an error.", options: { bold: true } },
    "A trace-to-logs click-through from a span on order-python would simply find no matching log line, because none existed under that name.",
  ]);
  addNotes(s, "This bug actually shipped in this tutorial's own Python services during development and was caught by querying Loki for a known trace_id and getting nothing back — the strongest teaching example in the whole deck, because it's a real failure mode rather than a hypothetical one. Spring and Quarkus don't have this bug in this tutorial, but only because their frameworks resolve service.name through a single path already; the lesson generalizes to any setup wiring multiple exporters by hand. What to show: the diagram on the next slide makes the mismatch visually concrete.");
}

{
  const s = S();
  addDiagramSlide(s, "LOGS · THE MISMATCH", "Two names, one process",
    "py03-service-name-bug",
    "Traces and metrics resolved OTEL_SERVICE_NAME; logs and profiles used the bare function argument — correlation found nothing on either side.");
  addNotes(s, "Read this top to bottom: the top row is what the zero-code launcher's own reading of OTEL_SERVICE_NAME produced automatically for traces and metrics. The bottom row is what the manually-wired signals produced from a different source, the bare service_name parameter. Grafana's correlation provisioning matches on service.name exactly — no fuzzy matching, no normalization — so order-python and order are, as far as any correlation query is concerned, two unrelated services. What to show: curl against Loki's label values endpoint, comparing what's present there against what Tempo's service list shows.");
}

{
  const s = S();
  addCodeSlide(s, "LOGS · THE FIX", "Resolve OTEL_SERVICE_NAME before building any Resource", "python", [
    "# services/python/order/src/obs/otel.py",
    "# The zero-code opentelemetry-instrument launcher and the Collector key",
    "# traces/metrics off OTEL_SERVICE_NAME. Prefer it here too so the",
    "# manually-wired log and profile signals carry the SAME service.name.",
    "cfg = ObsConfig(",
    "    service_name=os.getenv(\"OTEL_SERVICE_NAME\") or service_name",
    ")",
  ], "One line, and it generalizes: whenever identity is configurable from more than one place, every code path should read from the same source.", { fontSize: 16 });
  addNotes(s, "This is the entire fix, and the generalization matters more than the specific bug: any setup wiring four exporters by hand re-creates a consistency problem that a single integrated agent solves automatically. Querying Loki's label values for service_name and comparing against Tempo's service list catches this exact class of bug in under a minute, versus hours of assuming a signal that never exported rather than one that exported under the wrong name. What to show: curl -s -G 'http://localhost:3100/loki/api/v1/label/service_name/values' | jq . against a live stack.");
}

// =============================================================================
// Section 05 — Baggage & Kafka
// =============================================================================
divider("05", "Baggage & Kafka", "cart.id propagates automatically over gRPC. Over Kafka, it needs explicit code.",
  "Section divider. Baggage itself is language-agnostic (covered in the 101 deck); this section is about the one boundary in this stack where Python has no safety net at all. What to show: nothing yet.");

{
  const s = S();
  addCodeSlide(s, "BAGGAGE · cart.id", "Set once at the order boundary, read back downstream", "python", [
    "# services/python/order/src/order/main.py",
    "ctx = baggage.set_baggage(\"cart.id\", cart_id)",
    "token = context.attach(ctx)",
    "try:",
    "    available = await _check_stock_with_retry(clients, body.sku, body.quantity)",
    "    authorized = available and await _authorize_with_retry(...)",
    "finally:",
    "    context.detach(token)",
    "",
    "# services/python/payment/src/payment/server.py — read back downstream",
    "def _attach_cart_baggage() -> str | None:",
    "    cart_id = baggage.get_baggage(\"cart.id\")",
    "    if cart_id:",
    "        trace.get_current_span().set_attribute(\"cart.id\", cart_id)",
    "    return cart_id",
  ], "No gRPC call, protobuf field, or database row carries cart.id explicitly — the propagation context is the entire transport.", { fontSize: 12 });
  addNotes(s, "Python's context API has no scoped resource like Java's Scope, which is why this is an explicit attach/detach pair in a try/finally rather than a try-with-resources block — same semantics as the 101 deck's Java example, different idiom for the language. The CompositePropagator from the manual-setup section is what makes this ride alongside trace context over the gRPC hop automatically. What to show: a Tempo query for span.cart.id across both inventory and payment spans in the same trace.");
}

{
  const s = S();
  addContentTitle(s, "KAFKA · NO HEADER GUARANTEE", "A message is a key, a value, and optional headers");
  addBullets(s, [
    { text: "HTTP and gRPC both have a natural place for trace context", options: { bold: true } },
    "a header or metadata entry, read by the server before the handler runs — the protocol guarantees it exists.",
    { text: "Kafka has no such guarantee in its core contract", options: { bold: true } },
    "headers exist since Kafka 0.11, but nothing in the broker enforces that a producer sets them or a consumer reads them.",
    { text: "aiokafka has no equivalent zero-code tracing instrumentation", options: { bold: true } },
    "at the time of writing — a gap, not an oversight, since its asyncio-native API doesn't fit the hook points most Kafka instrumentors target.",
    { text: "Both Java stacks get this hop with no extra code", options: { bold: true } },
    "Spring Kafka and SmallRye Reactive Messaging both ship tracing support auto-instrumentation can enable. Python writes it by hand.",
  ]);
  addNotes(s, "This is the sharpest instance in the whole deck of a boundary where Python has no safety net: Java's two listener methods need zero tracing code either way, while Python's consumer loop needs real extraction code or the trace permanently breaks at the message boundary, not just for a toggle-driven demonstration. What to show: nothing yet — the actual module is next.");
}

{
  const s = S();
  addCodeSlide(s, "KAFKA · MANUAL PROPAGATION", "Explicit Inject and Extract", "python", [
    "# services/python/order/src/obs/kafka_propagation.py",
    "def inject_headers(existing=None):",
    "    headers = list(existing or [])",
    "    if not _enabled():  # reads PROPAGATE_KAFKA_CONTEXT",
    "        return headers",
    "    carrier: dict[str, str] = {}",
    "    propagate.inject(carrier)  # writes traceparent (and baggage)",
    "    headers.extend((k, v.encode(\"utf-8\")) for k, v in carrier.items())",
    "    return headers",
    "",
    "# services/python/shipping/src/shipping/worker.py — consume side",
    "async for msg in consumer:",
    "    ctx = extract_context(msg.headers)  # continue the producer's trace",
    "    with otel.tracer().start_as_current_span(",
    "        \"shipping.handle_order_placed\", context=ctx",
    "    ):",
    "        shipment_id = await _create_shipment(msg.value)",
  ], "propagate.inject/extract use the same CompositePropagator as HTTP and gRPC, so trace context and baggage cross the Kafka hop in one call.", { fontSize: 11 });
  addNotes(s, "Without the extract_context/start_as_current_span pair, this consumer would still process the message correctly, but the span it opens would start a brand-new trace with no parent — visibly disconnected in Tempo. Getting both trace context and baggage into the same carrier dictionary matters: a trace that continues but loses its cart.id baggage is a confusing partial failure, so routing them through one propagate.inject/extract call keeps them in lockstep. What to show: kcat against the order.placed topic showing the traceparent and baggage headers on a real message.");
}

{
  const s = S();
  addDiagramSlide(s, "KAFKA · THE TOGGLE", "PROPAGATE_KAFKA_CONTEXT makes the gap visible on command",
    "py04-kafka-context-toggle",
    "_enabled() is the one place in the Python services where this toggle is checked — every producer call site shares it.");
  addNotes(s, "With the toggle true, inject_headers() writes traceparent and baggage into the Kafka message; extract_context() on both the shipping and notification consumers reconstructs that context, and both consumers' processing spans become children of the same producer span — siblings of each other, both attributing duration back to one parent, reflecting Kafka's actual fan-out parallelism. With it false, inject_headers() returns an empty list, extract_context() gets nothing to parse, and each consumer's span becomes a new root — two separate traces, discoverable only by matching the order_id embedded in the message body. What to show: kcat showing the Headers: line present versus empty, which rules out consumer-side bugs by confirming the fact further upstream.");
}

// =============================================================================
// Section 06 — Profiling & packaging
// =============================================================================
divider("06", "Profiling & Packaging", "A plain import instead of a Java agent, and the uv/UBI10 toolchain underneath it.",
  "Section divider. Closing section: the fourth signal, and the runtime decisions — uv, Python 3.14, UBI 10 — that make the preceding sections' code actually run in a container. What to show: nothing yet.");

{
  const s = S();
  addCodeSlide(s, "PROFILING · AN IMPORT, NOT AN AGENT", "pyroscope-io configured from inside the interpreter", "python", [
    "# services/python/order/src/obs/profiling.py",
    "def setup_profiling(service_name: str) -> None:",
    "    addr = os.getenv(\"PYROSCOPE_ADDRESS\")",
    "    if not addr:",
    "        return",
    "    try:",
    "        import pyroscope  # provided by the pyroscope-io package",
    "    except ImportError:",
    "        return",
    "    pyroscope.configure(",
    "        application_name=service_name,",
    "        server_address=addr,",
    "        tags={\"service_name\": service_name},",
    "    )",
  ], "Spring and Quarkus attach a -javaagent jar before main() runs; Python calls a function during its own startup — no agent-attachment facility exists.", { fontSize: 13 });
  addNotes(s, "pyroscope.configure() starts a background sampling thread inside the running interpreter the moment it's called, from inside otel.setup() — there's no separate binary to attach and no JVM command line to assemble. The bare try/except ImportError means a service built without the pyroscope-io dependency installed still starts cleanly, the same soft-failure discipline as _enable_auto_instrumentation's instrumentor registration. Verified across all six Python services pushing process_cpu flame graphs into Pyroscope. What to show: Pyroscope's UI at :4040, or the trace-to-profiles link from a slow span in Tempo.");
}

{
  const s = S();
  addStatusTable(s, [
    { code: "uv", name: "interpreter + deps", purpose: "Python 3.14 installed standalone; uv.lock is what guarantees a reproducible install, not the pyproject.toml ranges." },
    { code: "opentelemetry-distro", name: "zero-code launcher", purpose: "Pinned alongside -sdk, -exporter-otlp-proto-http, and the three instrumentation-* packages, all at the same version line." },
    { code: "UBI 10 minimal", name: "multi-stage build", purpose: "Build stage runs uv sync + grpc_tools.protoc; runtime stage copies only the venv, interpreter, and src/ — no build tooling ships." },
    { code: "ENTRYPOINT", name: "opentelemetry-instrument uvicorn ...", purpose: "The launcher is the literal container entrypoint — not invoked from inside main.py, for the ordering reason covered earlier." },
  ], { colW: [2.60, 2.70, 6.79] });
  addNotes(s, "The Containerfile's two-stage build matters here specifically because of the opentelemetry-instrument ordering rule: uv's installed console scripts embed an absolute shebang to the venv's Python, so the build and runtime stage WORKDIR paths have to match exactly or those scripts fail to exec after the COPY. requires-python >=3.14 in pyproject.toml and uv python install 3.14 in the Containerfile keep the pinned interpreter version identical in dev and in the image. What to show: the Containerfile's two-stage structure if walking through the build live — note the grpc_tools.protoc codegen step only runs in the build stage.");
}

// =============================================================================
// Appendix — see it live
// =============================================================================
divider("A", "Appendix: Verifying It Live", "curl, kcat, and Loki/Tempo queries — keep this open in another window.",
  "Section divider for the appendix. This is reference material for confirming each of this deck's claims against a running stack, not meant to be read front to back. What to show: nothing yet.");

{
  const s = S();
  addContentTitle(s, "APPENDIX · CHECKS WORTH RUNNING", "One command per failure mode");
  addStatusTable(s, [
    { code: "Service identity", name: "Loki label values", purpose: "curl .../loki/api/v1/label/service_name/values — catches the service.name mismatch directly." },
    { code: "Kafka headers", name: "kcat -C -o beginning -e -f '%h'", purpose: "Confirms traceparent/baggage on the wire before trusting Tempo at all." },
    { code: "Baggage end to end", name: "Tempo search by tag", purpose: "curl '.../api/search?tags=cart.id=...' — one trace ID if propagation held across every hop." },
    { code: "Exemplar wiring", name: "Mimir PromQL + Grafana", purpose: "histogram_quantile(0.99, ...) against orders_fulfillment_duration_ms_bucket, then click a diamond." },
  ], { colW: [2.30, 2.90, 6.89] });
  addCaption(s, "docker compose -f stack/compose.yaml --profile python up -d --build");
  addNotes(s, "Each of these checks rules out a specific layer rather than staring at a dashboard and guessing: Loki's label endpoint catches a resource-identity mismatch in seconds; kcat rules out whole classes of consumer-side bugs by confirming the producer's behavior independently; the Tempo search confirms baggage propagated without reading a line of application code. What to show: run these live against the python compose profile if time allows — they are the fastest way to turn 'something looks wrong in Grafana' into a specific, fixable claim.");
}

{
  const s = S();
  addContentTitle(s, "CLOSING", "The launcher gets you far. The gaps are specific and known.");
  addBullets(s, [
    { text: "opentelemetry-instrument covers more than it looks like it should", options: { bold: true } },
    "HTTP, synchronous database drivers, synchronous gRPC — with zero application code.",
    { text: "The gaps are narrow and nameable, not vague", options: { bold: true } },
    "grpc.aio and asyncpg need one line of instrumentor registration each; Kafka and GraphQL resolvers need real hand-written spans.",
    { text: "One bug is worth remembering longer than any one mechanism", options: { bold: true } },
    "a Resource built from the wrong source breaks correlation with no error anywhere — resolve identity once, from one source, for every signal.",
    { text: "None of this changes the 101 deck's thesis", options: { bold: true } },
    "one trace_id, four signals, one investigation — Python just has more boundaries where that correlation has to be built by hand instead of inherited.",
  ]);
  addNotes(s, "Close by tying back to the 101 deck's closing claim: the correlation payoff is identical regardless of language, but Python's path to it has visibly more hand-written code at specific, identifiable boundaries — the async gap, Kafka, GraphQL resolvers — and one real bug this tutorial shipped and fixed as the sharpest possible argument for resolving identity from a single source. What to show: nothing — this is the handoff slide, back to whichever chapter or language track the audience is headed toward next.");
}

pres.writeFile({ fileName: OUT })
  .then((p) => console.log("WROTE", p))
  .catch((e) => { console.error(e); process.exit(1); });
