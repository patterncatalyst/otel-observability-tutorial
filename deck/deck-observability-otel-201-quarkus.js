// deck-observability-otel-201-quarkus.js — "OpenTelemetry 201: Quarkus"
// Quarkus-specific deck: the build-time quarkus-opentelemetry extension vs a
// runtime java agent, the quarkus.otel.* OTLP mapping gotcha, JDBC telemetry,
// CDI-injected manual spans, the Micrometer bridge and its missing pull
// endpoint, the OTel log bridge, baggage over gRPC, the two Kafka propagation
// flags, Pyroscope profiling and the LogManager ordering gotcha, and the dev
// loop. Picks up directly from the language-agnostic 101 deck. Code snippets
// are quoted from the real services/quarkus sources in this repository.
//
// Build:  cd deck && node deck-observability-otel-201-quarkus.js
// Output: ../presentations/observability-otel-201-quarkus.pptx

"use strict";

const H = require("./deck-helpers.js");
const {
  COLOR, FONT, W, ASSETS,
  newDeck, addFooter, addContentTitle, addBullets, addTwoColBullets,
  addStatusTable, addCaption, addCodeSlide, addDiagramSlide, addPerfCallout,
  addSectionDivider, addNotes,
} = H;

const OUT = "../presentations/observability-otel-201-quarkus.pptx";
const REV = "r01.0";

const pres = newDeck("OpenTelemetry 201: Quarkus");
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
  s.addText("OBSERVABILITY 201 · QUARKUS", {
    x: 6.00, y: 1.98, w: 6.90, h: 0.34,
    fontFace: FONT.title, fontSize: 14, bold: true, color: COLOR.red, charSpacing: 6,
    align: "left", valign: "middle",
  });
  s.addText([
    { text: "OpenTelemetry in", options: { breakLine: true } },
    { text: "Quarkus" },
  ], {
    x: 5.95, y: 2.42, w: 6.95, h: 2.00,
    fontFace: FONT.title, fontSize: 50, bold: true, color: COLOR.ink,
    align: "left", valign: "top",
  });
  s.addText("Compiled in, not attached — and the configuration surface that comes with that trade.", {
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
  addNotes(s, "Title slide. This is the Quarkus-specific 201 deck, picking up from the language-agnostic 101 deck's five signals and shared stack. Everything here is about the one thing that differs when the runtime is Quarkus instead of Spring Boot or Python: instrumentation is compiled into the jar at build time, not attached to a running process, and that single architectural choice explains every configuration quirk this deck covers. What to show: nothing yet — this is the framing slide before the real services/quarkus code comes up.");
}

// =============================================================================
// Agenda
// =============================================================================
{
  const s = S();
  addContentTitle(s, "AGENDA", "What this talk covers");
  addTwoColBullets(s, [
    { text: "Build-time instrumentation", options: { bold: true } },
    "quarkus-opentelemetry compiled into the jar — no java agent, no -javaagent flag",
    { text: "The OTLP mapping gotcha", options: { bold: true } },
    "quarkus.otel.exporter.otlp.* does not read plain OTEL_* on its own",
    { text: "Manual spans, CDI-style", options: { bold: true } },
    "an injected Tracer bean instead of a static global accessor",
    { text: "Metrics: the Micrometer bridge", options: { bold: true } },
    "same meterRegistry.counter() call, a build-time bridge underneath",
  ], [
    { text: "Logs via the OTel bridge, and baggage", options: { bold: true } },
    "quarkus.otel.logs.enabled, and cart.id riding over gRPC",
    { text: "Kafka propagation", options: { bold: true } },
    "a runtime per-channel flag that looks like, but isn't, a build-time one",
    { text: "Profiling and native image", options: { bold: true } },
    "the Pyroscope agent, the LogManager race, and what native image changes",
    { text: "Appendix: property reference", muted: true },
    { text: "Every quarkus.otel.* key this deck touches, in one table", muted: true },
  ]);
  addNotes(s, "Walk the agenda left to right, top to bottom. The organizing idea for the whole deck: Quarkus gets the same span and metric coverage Spring Boot's java agent gives you, through a completely different mechanism — compiled in rather than attached — and that mechanism is the reason behind every gotcha on this agenda, from the OTLP mapping to the Kafka flags to the LogManager race. What to show: nothing yet, this is a roadmap slide.");
}

// =============================================================================
// Section 00 — Build-time instrumentation
// =============================================================================
divider("00", "Build-Time Instrumentation", "No java agent anywhere in this Containerfile — and that's the headline.",
  "Section divider. Every other section in this deck is a consequence of this one architectural choice: quarkus-opentelemetry does its instrumentation work during mvn package, not at class-load time inside a running JVM. What to show: nothing — move to the contrast.");

{
  const s = S();
  addContentTitle(s, "BUILD-TIME · THE HEADLINE", "Compiled in, not attached");
  addBullets(s, [
    { text: "quarkus-opentelemetry", options: { bold: true } },
    "instruments REST resources, the gRPC stubs, the JDBC datasource, and Kafka channels during the Quarkus build step, not at runtime.",
    { text: "There is no OpenTelemetry Java agent", options: { bold: true } },
    "anywhere in the Quarkus services' Containerfiles — the pom.xml comment says so directly.",
    { text: "The payoff is startup time", options: { bold: true } },
    "no bytecode-transformation machinery spins up at boot, which matters for a framework whose whole pitch includes fast boot and native image.",
    { text: "The cost moves earlier", options: { bold: true } },
    "upgrading the extension means a dependency bump and a full rebuild, and coverage is whatever the build step could see — not inherited the way a generic bytecode agent inherits any JDBC driver it recognizes.",
  ]);
  addNotes(s, "This is the single idea the rest of the deck hangs off. Spring Boot's OpenTelemetry Java agent attaches at the JVM level and weaves bytecode as classes load — a runtime cost paid on every boot, but completely decoupled from the application's own build. Quarkus inverts that: the instrumentation is generated once, during mvn package, baked into the jar, with zero runtime weaving cost — but now configuration, coverage, and upgrades all move to build time instead. What to show: nothing yet — the next slide draws this contrast as a diagram.");
}

{
  const s = S();
  addDiagramSlide(s, "BUILD-TIME · THE CONTRAST", "Two attach mechanisms, two costs",
    "qk01-attach-mechanism",
    "Spring pays the cost at every boot; Quarkus pays it once, at build time.");
  addNotes(s, "Spring's path: JVM starts, -javaagent attaches, classes load and get rewritten, app is ready — all four steps happen on every container start. Quarkus's path: mvn package runs the extension once, the jar is built with instrumentation already in it, the JVM starts with nothing left to weave. Neither is strictly better — the Spring agent's coverage is inherited for free from any JDBC driver it recognizes; the Quarkus extension's coverage is fixed at whatever the build step could see. What to show: nothing yet — the next slide is the actual dependency block with no agent in sight.");
}

{
  const s = S();
  addCodeSlide(s, "BUILD-TIME · THE DEPENDENCY", "No agent, just two extensions", "xml", [
    "<!-- services/quarkus/order/pom.xml -->",
    "<!-- Copy the Pyroscope profiling agent into target/agents for the",
    "     Containerfile (ALL services). No OTel javaagent here: tracing",
    "     comes from quarkus-opentelemetry, baked into the jar. -->",
    "<dependency>",
    "    <groupId>io.quarkus</groupId>",
    "    <artifactId>quarkus-opentelemetry</artifactId>",
    "</dependency>",
    "<dependency>",
    "    <groupId>io.quarkus</groupId>",
    "    <artifactId>quarkus-micrometer-opentelemetry</artifactId>",
    "</dependency>",
  ], "The pom.xml comment states the architecture directly: the only agent copied into this image profiles, it doesn't trace.", { fontSize: 13 });
  addNotes(s, "This is the real pom.xml from services/quarkus/order. Two extensions cover traces, logs, and metrics between them, both resolved at build time. The Pyroscope profiling agent mentioned in the comment is a different thing entirely, covered later in this deck — it's the one java agent this service does carry, and it exists for a signal (continuous profiling) that doesn't yet have a build-time Quarkus extension. What to show: this exact pom.xml file if available, to confirm there's no opentelemetry-javaagent dependency anywhere in it.");
}

// =============================================================================
// Section 01 — The OTLP mapping gotcha
// =============================================================================
divider("01", "The OTLP Mapping Gotcha", "quarkus.otel.exporter.otlp.* does not read plain OTEL_* on its own.",
  "Section divider. This is the most common first failure for anyone bringing up a Quarkus service against this tutorial's shared compose stack: the exporter silently defaults to localhost:4317, and nothing in the startup log says why. What to show: nothing yet.");

{
  const s = S();
  addCodeSlide(s, "CONFIGURATION · THE MAPPING", "Pointing the exporter explicitly", "properties", [
    "# services/quarkus/order/src/main/resources/application.properties",
    "# quarkus.otel.exporter.otlp.* does NOT fall back to the plain OTEL_*",
    "# env var names on its own — map them explicitly, or the exporter",
    "# defaults to localhost:4317/gRPC and every signal silently fails to export.",
    "quarkus.otel.exporter.otlp.endpoint=${OTEL_EXPORTER_OTLP_ENDPOINT:http://lgtm:4318}",
    "quarkus.otel.exporter.otlp.protocol=${OTEL_EXPORTER_OTLP_PROTOCOL:http/protobuf}",
    "quarkus.otel.traces.enabled=true",
    "quarkus.otel.metrics.enabled=true",
    "quarkus.otel.logs.enabled=true",
  ], "Every Quarkus service in this stack repeats this exact mapping — it is not a one-time, one-service fix.");
  addNotes(s, "Reading plain OTEL_* variable names as implicit fallbacks is a convention of the OpenTelemetry SDK's own autoconfiguration module, used by the Java agent and the Python distro — not a behavior of SmallRye Config or Quarkus's configuration system generally. Set OTEL_EXPORTER_OTLP_ENDPOINT in compose.yaml and do nothing else here, and the Quarkus service falls back silently to localhost:4317 over gRPC, which inside a container resolves to nothing. What to show: this application.properties file, and the compose.yaml environment block it's reading from.");
}

{
  const s = S();
  addContentTitle(s, "CONFIGURATION · THE FAILURE MODE", "A silent failure, not a crash");
  addBullets(s, [
    { text: "The Quarkus process starts and serves requests normally", options: { bold: true } },
    "whether or not this mapping is in place — there is no startup error either way.",
    { text: "Traces, metrics, and logs all fail to export together", options: { bold: true } },
    "because all three signals route through the same quarkus.otel.exporter.otlp.* configuration.",
    { text: "The Quarkus build log, not the runtime log", options: { bold: true } },
    "is where the extension's work is actually visible — the extension's processing happens during mvn package.",
    { text: "The only reliable check", options: { bold: true } },
    "is whether traces actually arrive in Tempo, not a warning in the console — because no warning was ever going to print.",
  ]);
  addNotes(s, "This is worth dwelling on because it's the opposite failure mode from a crash: everything looks fine. POST /orders still returns 201, the database insert still happens, the Kafka message still publishes — the only thing missing is every signal this entire tutorial exists to demonstrate. The fix is always the same shape: confirm the mapping lines are present and point at a reachable host:port, not search the application log for an error that was never going to appear. What to show: an empty Tempo service list next to a perfectly normal curl response from POST /orders, if reproducing this live.");
}

{
  const s = S();
  addCodeSlide(s, "CONFIGURATION · JDBC SPANS", "An opt-in per datasource", "properties", [
    "# services/quarkus/order/src/main/resources/application.properties",
    "quarkus.datasource.jdbc.url=jdbc:postgresql://${POSTGRES_HOST:postgres}:5432/appdb",
    "# Emit OTel JDBC client spans for the Postgres hop (needs quarkus-opentelemetry",
    "# on the classpath; no separate extension required).",
    "quarkus.datasource.jdbc.telemetry=true",
  ], "Without this one line, the Quarkus trace is visibly shorter than its Spring and Python siblings for the same request.");
  addNotes(s, "This is Quarkus-specific in the other direction from the OTLP mapping gap — a feature flag the extension exposes rather than a config-mapping bug to work around. JDBC client spans for the Postgres hop are opt-in per datasource in Quarkus, where the Java agent and Python's distro both instrument the JDBC or DB-API driver unconditionally. Nothing is broken without this line; this particular span is just behind a switch the other two stacks don't have. What to show: a trace with and without this property set, side by side in Tempo, to show the missing database span.");
}

// =============================================================================
// Section 02 — Manual spans and CDI
// =============================================================================
divider("02", "Manual Spans & CDI", "An injected Tracer bean, not a static global accessor.",
  "Section divider. Auto-instrumentation builds the skeleton; a handful of manual spans at the two or three places a retry, a business decision, or a computed status matters turn that skeleton into a trace that answers real questions. Quarkus's way of getting there follows directly from the build-time model. What to show: nothing yet.");

{
  const s = S();
  addContentTitle(s, "MANUAL SPANS · GETTING A TRACER", "Tracer is a CDI bean here");
  addBullets(s, [
    { text: "quarkus-opentelemetry registers Tracer as a managed CDI bean", options: { bold: true } },
    "the same way it registers the MeterRegistry used on the metrics side — @Inject Tracer tracer is idiomatic Quarkus, not a special case.",
    { text: "Spring Boot reaches for GlobalOpenTelemetry.getTracer(...) instead", options: { bold: true } },
    "a static accessor, because the java agent is what populated that global in the first place — there's no Spring bean to inject.",
    { text: "Context propagation makes the parent association automatic", options: { bold: true } },
    "a manual child span started on the active context nests correctly under whatever auto-generated span is already in flight, with no trace ID passed by hand.",
    { text: "@WithSpan is the annotation-based shortcut", options: { bold: true } },
    "quarkus-opentelemetry recognizes it through its own interceptor — a good fit for a whole method that deserves exactly one span, a poor fit for a retry loop that needs a per-attempt event and a conditional status.",
  ]);
  addNotes(s, "The contrast with Spring is not about what the resulting span looks like — a span is a span regardless of who creates it, the same name, attributes, events, and status fields either way. It's about how the application code reaches the SDK: dependency injection, because quarkus-opentelemetry's build-time processing is exactly what also wires Tracer into the CDI container; Spring has no such container step, so it falls back to the one thing every instrumented library on the classpath already shares, the static global. What to show: nothing — this stays conceptual; the next slide covers the narrower case of enriching a span that already exists instead of creating a new one.");
}

{
  const s = S();
  addContentTitle(s, "MANUAL SPANS · ENRICHING, NOT CREATING", "Span.current() needs no Tracer at all");
  addTwoColBullets(s, [
    { text: "A new child span", options: { bold: true } },
    "is the right tool when the thing being described has its own start, its own end, and its own possible failure — a retry loop, a cache lookup with a real cost.",
    { text: "Span.current()", options: { bold: true } },
    "returns whatever span is active on the current context — the auto-generated REST span, if no manual child span has started yet.",
    { text: "No Tracer injection needed for this", options: { bold: true } },
    "there is nothing to start and nothing to end, because the span being enriched isn't owned by this code at all.",
  ], [
    { text: "A single computed fact", options: { bold: true } },
    "an order total, a resolved SKU — needs no new span, just one attribute on the span already running.",
    { text: "With tracing disabled", options: { bold: true } },
    "OTEL_SDK_DISABLED=true, Span.current() returns a harmless no-op span that silently discards the attribute — instrumentation code never needs an if-tracing-enabled guard.",
    { text: "The rule of thumb", options: { bold: true } },
    "reach for a new child span only when the operation has its own lifecycle; reach for Span.current() to attach a fact to the one already in flight.",
  ]);
  addNotes(s, "This is the same API shape across every language this tutorial covers, because OpenTelemetry's tracing API defines Span.current() identically everywhere — the contrast earlier in this section, CDI injection versus a static accessor, only applies to getting a Tracer to start a brand-new span. Enriching an existing one needs no Tracer reference at all. What to show: nothing — transition into the metrics section, which has its own version of this same inherited-versus-added split.");
}

// =============================================================================
// Section 03 — Metrics: the Micrometer bridge
// =============================================================================
divider("03", "Metrics: The Micrometer Bridge", "Same meterRegistry.counter() call, a different mechanism underneath.",
  "Section divider. Micrometer predates the OpenTelemetry Metrics API in wide Java production use, so Spring and Quarkus both bridge it onto the OTel SDK rather than asking existing code to rewrite against a new API. Where that bridge runs is where the two frameworks diverge again. What to show: nothing yet.");

{
  const s = S();
  addDiagramSlide(s, "METRICS · TWO BRIDGES", "One call, two translation points",
    "qk02-micrometer-bridge",
    "Mimir cannot tell which bridge produced a histogram — by the time it's OTLP, the bridge is gone.");
  addNotes(s, "Spring's bridge is a runtime one: the OpenTelemetry Java agent ships a Micrometer instrumentation module, gated behind OTEL_INSTRUMENTATION_MICROMETER_ENABLED, watching for MeterRegistry beans in the running application and mirroring every meter onto the OTel SDK's own pipeline. Quarkus's bridge is a build-time one: quarkus-micrometer-opentelemetry wires MeterRegistry directly onto the OTel SDK's exporter as part of the Quarkus build, no agent, no runtime bytecode weaving — matching the same build-time model this whole deck keeps coming back to. What to show: nothing yet — the next slide is the actual counter call from this codebase.");
}

{
  const s = S();
  addCodeSlide(s, "METRICS · THE REAL COUNTER", "orders_placed_total, one line", "java", [
    "// services/quarkus/order/src/main/java/.../OrderResource.java",
    "status = (available && authorized) ? \"PLACED\" : \"REJECTED\";",
    "insertOrder(orderId, request, amountCents, status);",
    "",
    "if (\"PLACED\".equals(status)) {",
    "    publishOrderPlaced(new OrderPlacedEvent(orderId, request.customerId(),",
    "            request.sku(), request.quantity(), amountCents, status, cartId));",
    "}",
    "",
    "meterRegistry.counter(\"orders_placed_total\", \"status\", status).increment();",
  ], "quarkus-micrometer-opentelemetry attaches exemplars as part of the bridge itself — no extra config.", { fontSize: 13 });
  addNotes(s, "This is the exact call from OrderResource.java. It is literally the same Micrometer API Spring Boot's sibling file calls — meterRegistry.counter(name, tags).increment() — which is the whole point of the Micrometer bridge pattern: application code doesn't change based on which framework is underneath it. The difference this chapter has been building toward is invisible at this call site; it's entirely in what happens to this counter's output on its way out of the process. What to show: this exact counter value in Mimir after placing a few orders, compared against the identical PromQL query run against the Spring Boot track.");
}

{
  const s = S();
  addContentTitle(s, "METRICS · NO PULL ENDPOINT", "Verify in Mimir, not locally");
  addStatusTable(s, [
    { code: "Spring Boot", name: "/actuator/prometheus", purpose: "management.endpoints.web.exposure.include=prometheus exposes a pull-based scrape endpoint independent of OTLP export." },
    { code: "Quarkus", name: "no equivalent here", purpose: "quarkus-micrometer-opentelemetry wires Micrometer straight to the push-based OTLP exporter — no /q/metrics unless quarkus-micrometer-registry-prometheus is added." },
    { code: "Verifying it", name: "Mimir, not the process", purpose: "the counter is checked by confirming it arrived in Mimir, not by asking the Quarkus process directly for its own registry." },
  ], { colW: [2.10, 2.60, 7.39] });
  addNotes(s, "An empty Mimir panel has two very different causes: the counter never incremented, or it incremented but never survived the OTLP export. Spring Boot can rule out the first cause locally with one curl against its own process; Quarkus's order service, as shipped in this tutorial, cannot — there is no pull-based registry running alongside the push-based OTLP exporter unless quarkus-micrometer-registry-prometheus is explicitly added as a second dependency. The log line order placed id=... status=... is the closest local signal Quarkus has, and it confirms the handler ran, not that the metric exported. What to show: a grep for orders_placed_total against Mimir's query API, as the actual verification step for this stack.");
}

// =============================================================================
// Section 04 — Logs via the OTel bridge
// =============================================================================
divider("04", "Logs Via The OTel Bridge", "One property turns on export; the MDC key names still differ.",
  "Section divider. Rather than attaching an external agent, the quarkus-opentelemetry extension — already pulled in for traces and metrics — includes a log handler bridging JBoss Logging onto the OpenTelemetry Logs API. What to show: nothing yet.");

{
  const s = S();
  addCodeSlide(s, "LOGS · THE BRIDGE AND THE NAMES", "traceId here, trace_id on the wire", "properties", [
    "# services/quarkus/order/src/main/resources/application.properties",
    "quarkus.otel.logs.enabled=true",
    "",
    "quarkus.log.console.format=%d{HH:mm:ss.SSS} %-5p traceId=%X{traceId}, " +
      "spanId=%X{spanId}, sampled=%X{sampled} [%c{3.}] (%t) %s%e%n",
  ], "Quarkus's own MDC keys are camelCase; the OTLP records the bridge exports use trace_id/span_id.", { fontSize: 13 });
  addNotes(s, "One property turns the whole thing on: every log record Quarkus emits is handed to the OTel SDK's logger provider in addition to whatever console or file appenders are configured, and the bridge stamps the active trace context onto the record the same way the Spring Boot java agent does — the mechanism differs, the outcome does not. The naming quirk is real and worth knowing before debugging it: quarkus.log.console.format reads traceId and spanId, Quarkus's own convention, while the records this same bridge exports over OTLP use the trace_id/span_id semantic convention names every other signal and every other language in this tutorial expects. What to show: a log line in the console next to the same record as it arrives in Loki, to show both naming conventions side by side.");
}

// =============================================================================
// Section 05 — Baggage over gRPC
// =============================================================================
divider("05", "Baggage Over gRPC", "cart.id, set once, read back two hops downstream.",
  "Section divider. Baggage rides in the same propagation context carrying the trace ID — the quarkus-opentelemetry extension's gRPC client instrumentation propagates it automatically, the same way the Java agent does for Spring. What to show: nothing yet.");

{
  const s = S();
  addCodeSlide(s, "BAGGAGE · SETTING IT ONCE", "cart.id at the order boundary", "java", [
    "// services/quarkus/order/src/main/java/.../OrderResource.java",
    "try (Scope scope = Baggage.current().toBuilder()",
    "        .put(\"cart.id\", cartId).build().makeCurrent()) {",
    "    boolean available = checkStockWithRetry(request.sku(), request.quantity());",
    "    boolean authorized = false;",
    "    if (available) {",
    "        authorized = authorizeWithRetry(orderId, request.customerId(), amountCents);",
    "    }",
    "    status = (available && authorized) ? \"PLACED\" : \"REJECTED\";",
    "    insertOrder(orderId, request, amountCents, status);",
    "}",
  ], "Every outbound gRPC call inside this try block carries cart.id automatically — no code in the called services wires it up.", { fontSize: 12 });
  addNotes(s, "This is the real critical section from OrderResource.java. Propagation here comes from the in-tree quarkus-opentelemetry extension's gRPC client instrumentation rather than a java agent, but notice that the application code needed to make this work is identical to what the Spring Boot sibling writes — a Baggage.current().toBuilder().put(...).makeCurrent() block, nothing OTel-specific beyond that. The only manual code anywhere in this flow is this one baggage entry; everything else is auto-instrumented. What to show: the W3C baggage header on the wire with kcat or a packet capture, showing cart.id=... exactly as set here.");
}

{
  const s = S();
  addCodeSlide(s, "BAGGAGE · READING IT BACK", "attachCartBaggage(), downstream", "java", [
    "// services/quarkus/inventory/src/main/java/.../InventoryServiceImpl.java",
    "private String attachCartBaggage() {",
    "    String cartId = Baggage.current().getEntryValue(\"cart.id\");",
    "    if (cartId != null) {",
    "        Span.current().setAttribute(\"cart.id\", cartId);",
    "    }",
    "    return cartId;",
    "}",
    "",
    "public Uni<CheckStockResponse> checkStock(CheckStockRequest request) {",
    "    String cartId = attachCartBaggage();",
    "    // ...",
  ], "payment's PaymentServiceImpl.java calls the identical idiom — inventory and payment never coordinated on this beyond the convention.", { fontSize: 12 });
  addPerfCallout(s, "cart.id is a good span attribute precisely because it is high-cardinality — one series per cart on a trace query. Promoting it to a metric label would be the opposite decision: an unbounded time series per cart, run a Mimir cardinality explosion. Baggage and span attributes tolerate high cardinality; metric label sets do not.", { y: 5.95, h: 1.05 });
  addNotes(s, "This is the real attachCartBaggage() helper from InventoryServiceImpl.java, called from both checkStock and reserve. Baggage itself is invisible in Grafana until something reads it and attaches it to a span explicitly — that one-line decision is the entire manual contribution on the receiving end. The cardinality caution is the sharpest edge of baggage's defining feature: it propagates to every span automatically, which is exactly what makes it a disaster the moment someone reaches for a baggage value as a metric label instead of a span attribute. What to show: a Tempo query like span.cart.id=\"cart-...\" returning spans from both inventory and payment, proving the propagation held across the gRPC hop.");
}

// =============================================================================
// Section 06 — Kafka context propagation
// =============================================================================
divider("06", "Kafka Context Propagation", "A runtime per-channel flag that looks like a build-time one, but isn't.",
  "Section divider. Quarkus's Kafka connectivity goes through SmallRye Reactive Messaging, configured per channel in application.properties — and it has two flags that are easy to confuse under pressure. What to show: nothing yet.");

{
  const s = S();
  addDiagramSlide(s, "KAFKA · TWO FLAGS", "One deletes spans, one toggles a header",
    "qk03-kafka-flags",
    "quarkus.otel.instrument.messaging is build-time and all-or-nothing; tracing-enabled is runtime and producer-side only.");
  addNotes(s, "quarkus.otel.instrument.messaging is a compile-time flag that deletes Kafka messaging spans from the build entirely when false — using it for the demo toggle would remove the consumer's span altogether, hiding the contrast this section is built around rather than producing a consumer span that visibly starts a new root trace. tracing-enabled=false on the producer channel keeps spans on both sides and only stops the producer from attaching the traceparent header that would link them — matching Spring Kafka's system property and Python's explicit toggle. What to show: nothing yet — the next slide is the actual property from this codebase.");
}

{
  const s = S();
  addCodeSlide(s, "KAFKA · THE REAL TOGGLE", "tracing-enabled, per channel", "properties", [
    "# services/quarkus/order/src/main/resources/application.properties",
    "# Kafka trace-context propagation toggle (PROPAGATE_KAFKA_CONTEXT, default",
    "# true): a runtime per-channel attribute on the producer side only. When",
    "# false, this producer stops injecting traceparent/baggage headers, so",
    "# shipping/notification's consumer spans start independent root traces",
    "# instead of continuing this one. (quarkus.otel.instrument.messaging is a",
    "# BUILD-TIME switch that deletes messaging spans entirely when false — not",
    "# what we want here, so it is deliberately not used.)",
    "mp.messaging.outgoing.order-placed-out.tracing-enabled=${PROPAGATE_KAFKA_CONTEXT:true}",
  ], "shipping's own outgoing shipment-created channel applies the identical property, for the same reason, one hop further downstream.", { fontSize: 12 });
  addNotes(s, "This is the real property and the real comment from order's application.properties — the comment itself documents the distinction from quarkus.otel.instrument.messaging, because getting the two confused is the single most common mistake when wiring this toggle up for the first time. Both the shipping and notification services' incoming channels are left at their defaults — tracing stays on — so the only place this flag needs to be set at all is the producer side. What to show: this property file, with PROPAGATE_KAFKA_CONTEXT flipped live in compose.yaml and the service restarted, to show the toggle actually taking effect.");
}

{
  const s = S();
  addContentTitle(s, "KAFKA · THE CONTRAST", "One trace, or two disconnected ones");
  addStatusTable(s, [
    { code: "true (default)", name: "one trace", purpose: "traceparent and baggage headers ride the Kafka message; shipping and notification's spans continue the order's trace." },
    { code: "false", name: "two disconnected traces", purpose: "no headers are written; both consumers still open a span, but each one roots a brand-new trace with no parent." },
    { code: "Verifying it", name: "kcat, not Tempo", purpose: "inspect the raw message headers directly — a stronger check, since it rules out a consumer-side extraction bug entirely." },
  ], { colW: [2.00, 2.80, 7.29] });
  addNotes(s, "The practical way to confirm which mode is active is to look at trace IDs directly: with propagation on, one POST /orders request produces one trace ID across order, inventory, payment, and — after the Kafka hop — both shipping and notification. With it off, the synchronous portion still shares a trace, but the shipping and notification spans appear as separate, unrelated traces, discoverable only by matching order_id in the message body since there's no longer a shared trace ID to search on. What to show: podman compose exec kafka kcat -b kafka:9094 -t order.placed -C -o beginning -e -f 'Headers: %h' with the flag both on and off, back to back.");
}

// =============================================================================
// Section 07 — Profiling and native image
// =============================================================================
divider("07", "Profiling & Native Image", "The same Pyroscope agent as Spring Boot — and a Quarkus-only ordering bug.",
  "Section divider. Attaching the Pyroscope profiling agent to a Quarkus service surfaced a failure mode that never showed up in Spring Boot, and it's the most concrete lesson this deck has about what a profiling agent actually does to a JVM. What to show: nothing yet.");

{
  const s = S();
  addCodeSlide(s, "PROFILING · THE AGENT AND THE FLAG", "entrypoint.sh, in order", "bash", [
    "# services/quarkus/order/entrypoint.sh",
    "APPEND=\"${JAVA_OPTS_APPEND:-} -Dquarkus.http.host=0.0.0.0 \\",
    "  -Djava.util.logging.manager=org.jboss.logmanager.LogManager\"",
    "",
    "if [ -n \"${PYROSCOPE_ADDRESS:-}\" ] && [ -f \"${PYRO_JAR}\" ]; then",
    "  APPEND=\"${APPEND} -javaagent:${PYRO_JAR}\"",
    "  export PYROSCOPE_APPLICATION_NAME=\"${OTEL_SERVICE_NAME:-quarkus-service}\"",
    "  export PYROSCOPE_SERVER_ADDRESS=\"${PYROSCOPE_ADDRESS}\"",
    "  export PYROSCOPE_FORMAT=\"${PYROSCOPE_FORMAT:-jfr}\"",
    "fi",
  ], "The LogManager flag is set on the command line, ahead of -javaagent, not left for Quarkus's own bootstrap to set.", { fontSize: 11 });
  addNotes(s, "This is the real entrypoint.sh. Spring Boot and Quarkus attach the identical io.pyroscope:agent jar, copied into target/agents by the same maven-dependency-plugin execution in both poms, gated on the same PYROSCOPE_ADDRESS environment check — profiling is optional and additive in both stacks. The one extra flag here, -Djava.util.logging.manager, is Quarkus-only, and its position in this command line — before -javaagent ever runs — is the entire fix for the next slide's race. What to show: this file, with the flag commented out, to reproduce the broken logging configuration live.");
}

{
  const s = S();
  addDiagramSlide(s, "PROFILING · THE RACE", "The LogManager ordering gotcha",
    "qk04-logmanager-race",
    "Whichever code asks the JDK for a LogManager first wins it, permanently, for the life of the process.");
  addNotes(s, "A profiling agent's premain method runs before Quarkus's own main, so if the Pyroscope agent's premain triggers any lazy initialization of java.util.logging, the JDK's default LogManager gets constructed and locked in right there — before Quarkus ever gets a chance to install its own JBoss LogManager. From that point on, every quarkus.log.* setting is silently accepted by the configuration layer and silently ignored at runtime: no exception, no warning, the OTLP log exporter never attaches, console formatting reverts to the JDK default. Setting the system property on the command line, ahead of any agent's premain, is what fixes it, because the JVM launcher resolves command-line -D flags during its own bootstrap. What to show: nothing — this stays conceptual; it's specific to Quarkus's JBoss LogManager dependency, which is why Spring Boot's entrypoint has no equivalent flag.");
}

{
  const s = S();
  addContentTitle(s, "PROFILING · NATIVE IMAGE", "What changes ahead-of-time compiled");
  addBullets(s, [
    { text: "This tutorial runs the JVM mode", options: { bold: true } },
    "but quarkus-opentelemetry's build-time instrumentation is itself native-image-friendly, which is a meaningful part of Quarkus's fast-boot story generally.",
    { text: "A java agent and native image are a harder combination", options: { bold: true } },
    "-javaagent assumes a running JVM to attach bytecode-transformation machinery to — native image has no such runtime to attach to.",
    { text: "Pyroscope's JVM agent is therefore JVM-mode-only in this stack", options: { bold: true } },
    "continuous profiling of a native-image binary needs a different mechanism entirely, such as an OS-level sampling profiler or eBPF.",
    { text: "The OTel profiling signal itself is still alpha", options: { bold: true } },
    "across every stack this tutorial covers — the eBPF-based, no-agent-attached path mentioned in the profiling chapter is the direction that eventually closes this gap for native image too.",
  ]);
  addNotes(s, "This slide connects two things that are each individually true and worth being precise about separately: quarkus-opentelemetry's traces, metrics, and logs instrumentation works the same way whether the final artifact is a JVM jar or a native-image binary, because it's generated at build time either way. The Pyroscope Java agent, by contrast, specifically needs a JVM to attach -javaagent to, which this stack's Quarkus services have, running in JVM mode — a native-image build of the same service would need a different continuous-profiling mechanism. What to show: nothing — this stays conceptual, since this tutorial's demo runs JVM mode throughout; it's worth flagging for anyone planning a native-image deployment of these same services.");
}

// =============================================================================
// Section 08 — Dev loop and performance
// =============================================================================
divider("08", "Dev Loop & Performance", "Dev Services for local deps, and where OTel overhead actually shows up.",
  "Section divider. Closing section: how the day-to-day development loop differs from the shared compose stack, and where to look next for a deeper performance story. What to show: nothing yet.");

{
  const s = S();
  addContentTitle(s, "DEV LOOP · AND PERFORMANCE", "Dev Services, and a perf tie-in");
  addStatusTable(s, [
    { code: "quarkus dev", name: "Dev Services, zero config", purpose: "detects a datasource or Kafka connector configured without a reachable instance and starts throwaway containers automatically — no compose stack needed." },
    { code: "stack/compose.yaml", name: "the shared, long-lived stack", purpose: "Postgres and Kafka on named volumes, the full LGTM/Pyroscope backend wired up — reach for this when the next step is a trace in Grafana." },
    { code: "quarkus-optimization", name: "a deeper perf story", purpose: "heap sizing, GC behavior, and startup latency material this deck's build-time instrumentation trade-off connects directly to." },
  ], { colW: [2.30, 3.00, 6.79], withCallout: true });
  addPerfCallout(s, "Build-time instrumentation is a startup-latency decision as much as an observability one: zero class-transformation cost at boot is the same property a fast-boot, low-memory Quarkus deployment is already optimizing for elsewhere.", { y: 5.75, h: 0.85 });
  addNotes(s, "Quarkus Dev Services means quarkus dev against this tutorial's order service starts its own disposable Postgres and Kafka the moment a connection is requested, wired up before any application code runs — the equivalent of what Testcontainers gives the Spring Boot and Python tracks explicitly. Reach for stack/compose.yaml specifically when the next step involves looking at cross-service telemetry in Grafana; reach for quarkus dev and Dev Services for the day-to-day loop of writing a test and seeing it pass in seconds. The perf tie-in: the same build-time instrumentation model this entire deck has been explaining is also why Quarkus's fast-boot numbers hold up with OpenTelemetry attached, which is exactly the kind of measurement the quarkus-optimization material goes deeper on. What to show: quarkus dev running against services/quarkus/order with no compose stack up at all, to show Dev Services launching Postgres and Kafka live.");
}

// =============================================================================
// Appendix
// =============================================================================
divider("A", "Appendix: Property Reference", "Every quarkus.otel.* key this deck touched, in one place.",
  "Section divider for the appendix. Reference material for keeping open in another window while configuring a new Quarkus service against this stack, not meant to be read front to back. What to show: nothing yet.");

{
  const s = S();
  addContentTitle(s, "APPENDIX · PROPERTY REFERENCE", "Every key, one table");
  addStatusTable(s, [
    { code: "quarkus.otel.exporter.otlp.*", name: "map explicitly", purpose: "does not read OTEL_EXPORTER_OTLP_* on its own — the #1 cause of silent non-export." },
    { code: "quarkus.otel.*.enabled", name: "per-signal switches", purpose: "traces/metrics/logs default true once quarkus-opentelemetry is on the classpath." },
    { code: "quarkus.datasource.jdbc.telemetry", name: "JDBC spans, opt-in", purpose: "per-datasource — unlike the java agent and Python's distro, which instrument unconditionally." },
    { code: "mp.messaging.*.tracing-enabled", name: "Kafka, runtime, per channel", purpose: "producer-side header injection only — not the build-time quarkus.otel.instrument.messaging." },
  ], { colW: [4.70, 2.40, 4.99], rowH: 0.62 });
  addCaption(s, "quarkus.otel.* and quarkus.datasource.* are Quarkus config; mp.messaging.* is MicroProfile config", 5.40);
  addCaption(s, "podman compose -f stack/compose.yaml --profile quarkus up -d --build   ·   Grafana at :3000, Pyroscope at :4040");
  addNotes(s, "This table is the quick-lookup version of the whole deck: the OTLP mapping from the configuration section, the per-signal enable flags, the JDBC telemetry opt-in, and the Kafka tracing-enabled property, all four in one place. The caption's compose command is the one that brings up this tutorial's Quarkus profile specifically — Postgres, Kafka, and the LGTM/Pyroscope backend come up regardless of profile; only the six quarkus-* domain service containers are added by naming this profile. What to show: this table alongside an actual application.properties file from any of the six Quarkus services in this stack — every one of them repeats these same four property groups.");
}

// =============================================================================
// Closing
// =============================================================================
{
  const s = S();
  addContentTitle(s, "CLOSING", "Compiled in, configured explicitly");
  addBullets(s, [
    { text: "Every Quarkus-specific gotcha in this deck traces back to one decision", options: { bold: true } },
    "instrumentation compiled into the jar at build time, not attached to a running process.",
    { text: "That decision buys fast boot and native-image-friendly instrumentation", options: { bold: true } },
    "and it costs an explicit OTLP mapping, a per-datasource JDBC opt-in, and two Kafka flags that look alike but aren't.",
    { text: "None of the span shape changes", options: { bold: true } },
    "a Tempo query or a Grafana panel built against this stack's traces works unmodified against the Spring Boot or Python tracks — semantic conventions see to that.",
    { text: "The 101 deck's five signals, correlation, and Collector material all still apply", options: { bold: true } },
    "unchanged — this deck only ever covered where Quarkus's mechanism diverges from the shared model, never replaced it.",
  ]);
  addNotes(s, "Close by tying the whole deck back to the headline from the first section: build-time instrumentation is not a cosmetic implementation detail, it's the reason every configuration surface in this deck looks the way it does, from the OTLP mapping gotcha through the two Kafka flags to the LogManager race. None of it changes what a Tempo trace or a Mimir panel looks like once the data arrives — the payoff from the 101 deck's correlation and semantic-conventions material carries over completely. What to show: nothing — this is the wrap-up slide; if there's time, a live trace from this stack's Quarkus profile is the strongest closing demo.");
}

pres.writeFile({ fileName: OUT })
  .then((p) => console.log("WROTE", p))
  .catch((e) => { console.error(e); process.exit(1); });
