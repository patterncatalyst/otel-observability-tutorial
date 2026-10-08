// deck-observability-otel-201-spring.js — "OpenTelemetry 201: Spring Boot"
// Language-specific deck for Spring Boot 4.1.x: the OpenTelemetry Java agent
// (not the incompatible starter), manual span and attribute enrichment,
// Micrometer-to-OTLP metrics with exemplars, logback MDC correlation,
// baggage over gRPC, Kafka context propagation, Pyroscope profiling, and
// Boot-4 production gotchas. Picks up where deck-observability-otel-101.js
// leaves off; no language-agnostic concepts repeated here.
//
// Build:  cd deck && node deck-observability-otel-201-spring.js
// Output: ../presentations/observability-otel-201-spring.pptx

"use strict";

const H = require("./deck-helpers.js");
const {
  COLOR, FONT, W, ASSETS,
  newDeck, addFooter, addContentTitle, addBullets, addTwoColBullets,
  addStatusTable, addCaption, addCodeSlide, addDiagramSlide, addSectionDivider, addNotes,
} = H;

const OUT = "../presentations/observability-otel-201-spring.pptx";
const REV = "r01.0";

const pres = newDeck("OpenTelemetry 201: Spring Boot");
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
  s.addText("OBSERVABILITY 201 · SPRING BOOT", {
    x: 6.00, y: 1.98, w: 6.90, h: 0.34,
    fontFace: FONT.title, fontSize: 14, bold: true, color: COLOR.red, charSpacing: 5,
    align: "left", valign: "middle",
  });
  s.addText([
    { text: "OpenTelemetry on", options: { breakLine: true } },
    { text: "Spring Boot" },
  ], {
    x: 5.95, y: 2.42, w: 6.95, h: 2.00,
    fontFace: FONT.title, fontSize: 48, bold: true, color: COLOR.ink,
    align: "left", valign: "top",
  });
  s.addText("The Java agent, not the starter — plus manual spans, Micrometer metrics, logback correlation, baggage, Kafka context, and Pyroscope profiling.", {
    x: 6.00, y: 4.55, w: 6.80, h: 1.15,
    fontFace: FONT.body, fontSize: 16, italic: true, color: COLOR.caption,
    align: "left", valign: "top",
  });
  s.addText(REV, {
    x: 11.85, y: 5.85, w: 0.95, h: 0.30,
    fontFace: FONT.mono, fontSize: 11, color: COLOR.caption,
    align: "right", valign: "middle",
  });
  try { s.addImage({ path: `${ASSETS}/logo-candidate-2.png`, x: 11.10, y: 6.80, w: 1.55, h: 0.37 }); } catch (e) {}
  addNotes(s, "Title slide. This deck assumes the Observability & OpenTelemetry 101 deck's concepts — the five signals, the data model, the LGTM stack, correlation, semantic conventions, the Collector — and picks up with Spring Boot 4.1.x specifics: real code from this tutorial's order, inventory, payment, and shipping services. What to show: nothing yet, this is the framing slide before the agent comes up.");
}

// =============================================================================
// Agenda
// =============================================================================
{
  const s = S();
  addContentTitle(s, "AGENDA", "What this talk covers");
  addTwoColBullets(s, [
    { text: "The Java agent, not the starter", options: { bold: true } },
    "Why Boot 4.1.x breaks the OpenTelemetry Spring Boot starter, and what the agent does instead",
    { text: "Manual spans and attributes", options: { bold: true } },
    "What the agent can't see, and the enrichment pattern this codebase actually uses",
    { text: "Micrometer metrics and exemplars", options: { bold: true } },
    "A runtime bridge from MeterRegistry to OTLP, and the exemplar filter that links a bucket to a trace",
    { text: "Logs and the logback MDC", options: { bold: true } },
    "trace_id on every line, and the one attribute every signal has to agree on",
  ], [
    { text: "Baggage over gRPC", options: { bold: true } },
    "Carrying cart.id from the order boundary to inventory and payment, read back as a span attribute",
    { text: "Kafka context propagation", options: { bold: true } },
    "The PROPAGATE_KAFKA_CONTEXT toggle, and why it's a producer-side JVM system property",
    { text: "Profiling with Pyroscope", options: { bold: true } },
    "A second Java agent, the JFR format, and where it fits next to JVM perf work",
    { text: "Production notes", options: { bold: true } },
    "Resource attributes and three Boot-4 configuration issues this tutorial encountered and fixed",
  ]);
  addNotes(s, "Walk the agenda left to right, top to bottom. The first half covers getting telemetry out of the JVM at all: the agent, manual enrichment, metrics, and logs. The second half covers propagation and operations: baggage, Kafka, profiling, and the gotchas worth knowing before a real deployment. What to show: nothing yet, this is a roadmap slide.");
}

// =============================================================================
// Section 00 — The Java agent
// =============================================================================
divider("00", "The Java Agent", "Why Boot 4.1.x needs the agent, not the starter, and what it actually does.",
  "Section divider. This is the headline of the whole deck: the obvious dependency to reach for in a Spring Boot service does not work on Boot 4.1.x, and the fix is the mechanism OpenTelemetry instrumented Java applications with for years before any framework-specific starter existed. What to show: nothing yet — move to the compatibility break.");

{
  const s = S();
  addContentTitle(s, "THE AGENT · WHY NOT THE STARTER", "A dependency that does not survive Boot 4");
  addBullets(s, [
    { text: "opentelemetry-spring-boot-starter", options: { bold: true } },
    "is built against Spring Boot 3.x autoconfiguration — Jackson 2 and the Jakarta EE 10 servlet contracts that major line shipped.",
    { text: "Spring Boot 4.1.1", options: { bold: true } },
    "moves to Jackson 3 (tools.jackson, not com.fasterxml.jackson), Jakarta EE 11, and Spring Framework 7.",
    { text: "Adding the starter to a Boot 4.1.x service", options: { bold: true } },
    "produces classpath conflicts at startup — a build that fails loudly, not a working integration quietly running the wrong serializer.",
    { text: "This is not a configuration problem to work around", options: { bold: true } },
    "the starter's autoconfiguration assumes a servlet and serialization stack this Boot version no longer ships.",
  ]);
  addNotes(s, "This is the headline fact of the whole deck: do not add opentelemetry-spring-boot-starter to a Boot 4.1.x pom.xml. It will not quietly misbehave, it will fail the build. What to show: nothing yet — the fix is the javaagent, covered next.");
}

{
  const s = S();
  addDiagramSlide(s, "THE AGENT · THE FIX", "The javaagent survives the break",
    "sp01-starter-vs-agent",
    "The starter couples to a framework version; the agent operates below the framework layer entirely.");
  addNotes(s, "The OpenTelemetry Java agent is the mechanism that predates every framework-specific starter: a single jar attached to the JVM with -javaagent, instrumenting bytecode as classes load — DispatcherServlet, the gRPC ManagedChannel and Server classes, the JDBC Driver, the Kafka client — without touching source and without caring which serialization library or servlet API version the application uses. What to show: nothing yet — the next slide shows how the agent's reach covers four boundaries from one attach point.");
}

{
  const s = S();
  addDiagramSlide(s, "THE AGENT · THE REACH", "One jar, four boundaries",
    "sp02-agent-pipeline",
    "HTTP, gRPC, JDBC, and Kafka — instrumented at class-load time, with no application code.");
  addNotes(s, "Trace what premain does: it runs before Spring's own main(), which is the attach point that lets the agent weave bytecode before any of the application's classes finish loading. The same agent also bridges Micrometer's MeterRegistry onto the OTel SDK's metrics pipeline and injects trace_id/span_id into the logback MDC — both covered in their own sections later in this deck. What to show: nothing yet — getting the jar into the container is the next concern.");
}

{
  const s = S();
  addCodeSlide(s, "THE AGENT · BUILD TIME", "Pinning and copying the agent jar", "Maven", [
    "<!-- services/spring/order/pom.xml -->",
    "<plugin>",
    "    <groupId>org.apache.maven.plugins</groupId>",
    "    <artifactId>maven-dependency-plugin</artifactId>",
    "    <executions>",
    "        <execution>",
    "            <id>copy-agents</id>",
    "            <phase>package</phase>",
    "            <goals><goal>copy</goal></goals>",
    "            <configuration>",
    "                <artifactItems>",
    "                    <artifactItem>",
    "                        <groupId>io.opentelemetry.javaagent</groupId>",
    "                        <artifactId>opentelemetry-javaagent</artifactId>",
    "                        <version>${otel.instrumentation.version}</version>",
    "                        <destFileName>opentelemetry-javaagent.jar</destFileName>",
    "                    </artifactItem>",
    "                </artifactItems>",
    "                <outputDirectory>${project.build.directory}/agents</outputDirectory>",
    "            </configuration>",
    "        </execution>",
    "    </executions>",
    "</plugin>",
  ], "Every Spring service in this tutorial pins the same agent version and copies it into target/agents/ at package time.",
  { fontSize: 10 });
  addNotes(s, "Getting the agent jar into the container is a build concern, not a runtime one. The maven-dependency-plugin's copy-agents execution runs at the package phase, right alongside the same plugin's copy of the Pyroscope profiling agent used later in this deck. The Containerfile's runtime stage then copies target/agents/ into the final image. What to show: the same block in payment/pom.xml or inventory/pom.xml, identical except for the artifact version property.");
}

{
  const s = S();
  addCodeSlide(s, "THE AGENT · RUNTIME", "Assembling the -javaagent flag", "shell", [
    "#!/bin/sh",
    "# services/spring/_shared/entrypoint.sh",
    "AGENTS=/deployments/agents",
    "OTEL_JAR=\"${AGENTS}/opentelemetry-javaagent.jar\"",
    "",
    "APPEND=\"${JAVA_OPTS_APPEND:-} -Dserver.address=0.0.0.0\"",
    "",
    "if [ -f \"${OTEL_JAR}\" ]; then",
    "  APPEND=\"${APPEND} -javaagent:${OTEL_JAR}\"",
    "fi",
    "",
    "export JAVA_OPTS_APPEND=\"${APPEND}\"",
    "exec /opt/jboss/container/java/run/run-java.sh",
  ], "Checking for the jar rather than assuming it exists is what lets OTEL_SDK_DISABLED=true stand in as a no-telemetry baseline.",
  { fontSize: 11 });
  addNotes(s, "This entrypoint, shared verbatim across every Spring service in this tutorial, assembles the -javaagent flag from what it finds on disk rather than hardcoding it. The agent itself reads its entire configuration from plain OTEL_* environment variables set in the Containerfile and overridden per service by compose.yaml — there is no Spring configuration file involved in getting a trace out of this service. What to show: the full entrypoint.sh, which also handles the Kafka propagation toggle and the Pyroscope agent, both covered later in this deck.");
}

{
  const s = S();
  addContentTitle(s, "THE AGENT · CONFIGURATION SURFACE", "Plain environment variables, nothing Spring-specific");
  addStatusTable(s, [
    { code: "OTEL_EXPORTER_OTLP_ENDPOINT", name: "http://lgtm:4318", purpose: "Where every signal is exported; set once in compose.yaml's shared environment block." },
    { code: "OTEL_SERVICE_NAME", name: "order-spring", purpose: "Falls back to spring.application.name if unset — one source of truth for every signal." },
    { code: "OTEL_PROPAGATORS", name: "tracecontext,baggage", purpose: "Both the W3C trace context and baggage propagators, composed — baggage needs the second one." },
    { code: "OTEL_METRICS_EXEMPLAR_FILTER", name: "trace_based", purpose: "Attaches an exemplar to a histogram bucket whenever a sampled trace is active at record time." },
  ], { colW: [3.90, 2.20, 5.99] });
  addNotes(s, "Every one of these is a plain OTEL_* variable the agent reads directly — no quarkus.otel.* mapping gap to worry about, because this mechanism is the one the OpenTelemetry SDK's own autoconfiguration module defines. application.properties in every Spring service in this tutorial has nothing OTel-specific in it at all. What to show: the Containerfile's ENV block if walking through it live, or compose.yaml's shared x-service-env anchor.");
}

// =============================================================================
// Section 01 — Manual spans and enrichment
// =============================================================================
divider("01", "Manual Spans & Enrichment", "What the agent can't see, and the pattern this codebase actually uses.",
  "Section divider. Auto-instrumentation can only see library boundaries — a retry loop, a business decision, a computed status are invisible to it by design, not by oversight. What to show: nothing yet.");

{
  const s = S();
  addContentTitle(s, "MANUAL SPANS · THE GAP", "What the agent cannot see");
  addBullets(s, [
    { text: "The order service's retry loops", options: { bold: true } },
    "wrap the inventory and payment gRPC calls in up to five attempts, one second apart — entirely inside the single gRPC client span the agent already produces.",
    { text: "From the agent's point of view", options: { bold: true } },
    "there is exactly one gRPC call: the last one that actually returned. The failed attempts before it leave no trace at all.",
    { text: "A span has four building blocks", options: { bold: true } },
    "a name, attributes, timestamped events, and a terminal status — all defined the same way whether an agent, an extension, or application code creates the span.",
    { text: "Getting a Tracer on Spring Boot", options: { bold: true } },
    "means GlobalOpenTelemetry.getTracer(...), a static accessor, because the agent is what installs the SDK behind it — there is no Spring bean to inject.",
  ]);
  addNotes(s, "This is the general shape of chapter 9's manual-spans case: a business-level operation worth its own span, attributes, events, and status. It is not business logic a REST or gRPC client library exposes as a hookable event, so no agent, extension, or launcher can see it without application code. What to show: nothing yet — this codebase's actual hybrid pattern, enrichment rather than a brand-new span, is the next slide.");
}

{
  const s = S();
  addContentTitle(s, "MANUAL SPANS · THE ACTUAL HYBRID", "Enrichment, not a new span");
  addBullets(s, [
    { text: "The clearest hybrid pattern in this codebase", options: { bold: true } },
    "is not a new span at all — it's one attribute added to a span the agent already created.",
    { text: "The order service's REST handler", options: { bold: true } },
    "sets cart.id as OTel baggage around the whole critical section, with no new span and no Tracer call.",
    { text: "Inventory and payment read that baggage back", options: { bold: true } },
    "and attach it to whichever span the gRPC auto-instrumentation already opened for the incoming call.",
    { text: "Neither order, inventory, nor payment", options: { bold: true } },
    "ever calls a span-creation API in this flow. The entire manual contribution is a baggage entry out and an attribute read back.",
  ]);
  addNotes(s, "This is worth being precise about, because it contradicts the instinct that 'manual instrumentation' means writing spanBuilder calls. In this codebase's actual order-to-inventory-to-payment flow, the manual work is strictly enrichment: wrap existing auto-instrumented spans with one business fact that the agent has no way to know. What to show: the real code on the next two slides.");
}

{
  const s = S();
  addCodeSlide(s, "MANUAL SPANS · SETTING BAGGAGE", "cart.id, set once at the order boundary", "Java", [
    "// services/spring/order/src/main/java/com/example/otel/order/OrderController.java",
    "@PostMapping(\"/orders\")",
    "public ResponseEntity<OrderResponse> createOrder(@Valid @RequestBody OrderRequest request,",
    "        @RequestHeader(value = \"X-Cart-Id\", required = false) String cartIdHeader) {",
    "    String orderId = UUID.randomUUID().toString();",
    "    String cartId = resolveCartId(request.cartId(), cartIdHeader);",
    "",
    "    String status;",
    "    try (Scope scope = Baggage.current().toBuilder()",
    "            .put(\"cart.id\", cartId).build().makeCurrent()) {",
    "        boolean available = checkStockWithRetry(request.sku(), request.quantity());",
    "        boolean authorized = available && authorizeWithRetry(orderId, request.customerId(), amountCents);",
    "        status = (available && authorized) ? \"PLACED\" : \"REJECTED\";",
    "        insertOrder(orderId, request, amountCents, status);",
    "    }",
    "}",
  ], "Every outbound gRPC call inside the try block carries this baggage — no gRPC field, no shared database row.",
  { fontSize: 10 });
  addNotes(s, "No new span appears anywhere in this method. Baggage rides in the same propagation context that already carries the trace ID, so the agent's gRPC client instrumentation propagates both together as outbound metadata with zero extra code. The entire manual contribution is the try-with-resources block itself. What to show: this exact file, or run a request with an X-Cart-Id header and query Tempo for the cart.id attribute.");
}

{
  const s = S();
  addCodeSlide(s, "MANUAL SPANS · READING IT BACK", "One attribute, attached to an existing span", "Java", [
    "// services/spring/inventory/src/main/java/com/example/otel/inventory/InventoryServiceImpl.java",
    "private String attachCartBaggage() {",
    "    String cartId = Baggage.current().getEntryValue(\"cart.id\");",
    "    if (cartId != null) {",
    "        Span.current().setAttribute(\"cart.id\", cartId);",
    "    }",
    "    return cartId;",
    "}",
    "",
    "@Override",
    "public void checkStock(CheckStockRequest request, StreamObserver<CheckStockResponse> responseObserver) {",
    "    String cartId = attachCartBaggage();",
    "    log.info(\"CheckStock sku={} quantity={} cart={}\", request.getSku(), request.getQuantity(), cartId);",
    "    // ... stock lookup, unchanged",
    "}",
  ], "Span.current() returns whatever span the agent's gRPC server instrumentation already opened — no Tracer, no lifecycle to manage.",
  { fontSize: 11 });
  addNotes(s, "This identical attachCartBaggage() method appears in payment's PaymentServiceImpl too, word for word. Span.current() needs no Tracer and starts and ends nothing: the span it enriches isn't owned by this code. This is the rule of thumb worth keeping — reach for Span.current() to attach a fact to a span that's already running, and reach for a new child span only when the thing you're describing has its own start, end, and possible failure, like the retry loops from the previous slide do.");
}

// =============================================================================
// Section 02 — Micrometer metrics and exemplars
// =============================================================================
divider("02", "Metrics & Exemplars", "Micrometer stays the API; the agent bridges it to OTLP.",
  "Section divider. Spring's whole metrics story predates the OpenTelemetry Metrics API by years — the fix is a bridge, not a rewrite. What to show: nothing yet.");

{
  const s = S();
  addContentTitle(s, "METRICS · THE RUNTIME BRIDGE", "MeterRegistry stays; the exporter changes");
  addBullets(s, [
    { text: "Micrometer's MeterRegistry", options: { bold: true } },
    "predates the OpenTelemetry Metrics API in Spring Boot by years — actuator, /actuator/prometheus, and every existing meter are built on it.",
    { text: "The agent ships a Micrometer instrumentation module", options: { bold: true } },
    "gated behind OTEL_INSTRUMENTATION_MICROMETER_ENABLED, watching for MeterRegistry beans and mirroring every meter into the OTel SDK's metrics pipeline.",
    { text: "Application code never changes", options: { bold: true } },
    "meterRegistry.counter(...) and meterRegistry.timer(...) work exactly as they always have — the bridge is entirely underneath.",
    { text: "This is a runtime bridge", options: { bold: true } },
    "the same class-load-time pattern as the agent's trace instrumentation, just applied to a different signal.",
  ]);
  addNotes(s, "Contrast this with Quarkus, which bridges Micrometer at build time via quarkus-micrometer-opentelemetry — same outcome, different mechanism, following the same split chapter 8 established for traces. What to show: nothing yet — the actual counter in this codebase is next.");
}

{
  const s = S();
  addCodeSlide(s, "METRICS · A BUSINESS COUNTER", "orders_placed_total, by status", "Java", [
    "// services/spring/order/src/main/java/com/example/otel/order/OrderController.java",
    "meterRegistry.counter(\"orders_placed_total\", \"status\", status).increment();",
    "log.info(\"order placed id={} status={} cart={}\", orderId, status, cartId);",
  ], "No protocol-level metric could count this: PLACED vs. REJECTED is a business outcome, not an HTTP status code.",
  { fontSize: 13 });
  addNotes(s, "The agent's Micrometer bridge already produces protocol-level metrics with no extra code — request duration histograms for the REST endpoint, call counts for the gRPC clients. None of those can answer 'how many orders were rejected,' because that distinction lives in the order's own status field. status takes exactly two values, so tagging by it produces exactly two time series regardless of traffic volume — the opposite of tagging by customer_id or cart.id, which would be unbounded. What to show: this exact line, then a Mimir query for orders_placed_total.");
}

{
  const s = S();
  addContentTitle(s, "METRICS · EXEMPLARS", "A histogram bucket that remembers a trace ID");
  addBullets(s, [
    { text: "OTEL_METRICS_EXEMPLAR_FILTER=trace_based", options: { bold: true } },
    "set in the Containerfile, tells the SDK to attach an exemplar whenever a sampled trace is active at the moment a measurement records.",
    { text: "No extra code at the measurement call site", options: { bold: true } },
    "the counter increment above runs inside the agent's auto-generated root span for POST /orders, so a live trace context is already there.",
    { text: "In Grafana", options: { bold: true } },
    "a histogram panel renders small diamond markers above buckets with exemplars; clicking one jumps straight into the matching trace in Tempo.",
    { text: "Checking the counter before trusting the pipeline", options: { bold: true } },
    "management.endpoints.web.exposure.include=health,info,prometheus exposes /actuator/prometheus — curl it directly to rule out a handler that never ran.",
  ]);
  addNotes(s, "Spring Boot is the one stack of the three in this tutorial with a pull-based verification path independent of the OTLP pipeline: curl http://localhost:8080/actuator/prometheus | grep orders_placed_total confirms the counter from Micrometer's own registry, entirely separate from whether export to Mimir is working. An empty Mimir panel has two different causes — the counter never incremented, or it incremented but never survived export — and this endpoint tells them apart. What to show: that curl command, live.");
}

// =============================================================================
// Section 03 — Logs and logback correlation
// =============================================================================
divider("03", "Logs & The Logback MDC", "trace_id on every line, with no application code setting it.",
  "Section divider. The agent writes trace context into Logback's MDC as a side effect of watching its internals — application code never touches trace context directly. What to show: nothing yet.");

{
  const s = S();
  addCodeSlide(s, "LOGS · THE PATTERN", "trace_id and span_id from the MDC", "XML", [
    "<!-- services/spring/order/src/main/resources/logback-spring.xml -->",
    "<!-- trace_id/span_id are populated by the OpenTelemetry Java agent's",
    "     Logback MDC instrumentation; no application code sets them. -->",
    "<appender name=\"CONSOLE\" class=\"ch.qos.logback.core.ConsoleAppender\">",
    "  <encoder>",
    "    <pattern>%d{HH:mm:ss.SSS} %-5level [%X{trace_id:-}/%X{span_id:-}] [%logger{36}] %msg%n</pattern>",
    "  </encoder>",
    "</appender>",
  ], "The :- fallback prints a dash for lines outside any trace, like startup, keeping output readable either way.",
  { fontSize: 12 });
  addNotes(s, "This file, shared in shape across every Spring service in this tutorial, is unaware of the mechanism that populates %X{trace_id} — it just reads the standard pattern syntax for an MDC key. The agent's Logback MDC instrumentation is on by default and requires no configuration here at all. What to show: a running service's console output with trace_id visible on every line while a request is in flight.");
}

{
  const s = S();
  addContentTitle(s, "LOGS · TWO SEPARATE APPENDERS", "The file on disk is not what reaches Loki");
  addBullets(s, [
    { text: "CONSOLE and FILE", options: { bold: true } },
    "are both configured in logback-spring.xml, and neither one is what gets logs into Loki.",
    { text: "The agent attaches its own OTLP logback appender", options: { bold: true } },
    "invisible in the XML because it's injected at runtime, exporting every record over OTLP independently of CONSOLE and FILE.",
    { text: "This separation matters when debugging", options: { bold: true } },
    "a log line sitting correctly in logs/order-spring.log but missing from Loki points at the agent's OTLP export path, not at Logback.",
    { text: "service.name is the one attribute every signal must agree on", options: { bold: true } },
    "the agent reads OTEL_SERVICE_NAME (falling back to spring.application.name) for every signal uniformly — Spring never hits the Python stack's logs/traces name-mismatch bug.",
  ]);
  addNotes(s, "This is the Spring-specific payoff of a single integrated agent: because one mechanism resolves service.name for traces, metrics, and logs alike, there's no separate Resource-building code path per signal that could drift out of agreement, the way the Python implementation's manually-wired signals did during this tutorial's own development. What to show: compare logs/order-spring.log against a Loki query for service_name=\"order-spring\" — both should show the same trace_id for a request in flight.");
}

// =============================================================================
// Section 04 — Kafka context propagation
// =============================================================================
divider("04", "Kafka Context Propagation", "A producer-side JVM system property, and the trace it protects.",
  "Section divider. Kafka's header mechanism is general-purpose with no required semantics, so propagating trace context across it needs instrumentation on both the producer and consumer that specifically knows to write and read traceparent. What to show: nothing yet.");

{
  const s = S();
  addContentTitle(s, "KAFKA · THE GAP AND THE TOGGLE", "Zero tracing code, one system property");
  addBullets(s, [
    { text: "Spring Kafka's producer and consumer", options: { bold: true } },
    "are both instrumented by the same agent as every other hop — KafkaTemplate.send() and @KafkaListener need no tracing-specific code at all.",
    { text: "By default", options: { bold: true } },
    "the agent injects traceparent into every record sent and extracts it on every record received, continuing one trace across the publish and both consumers.",
    { text: "PROPAGATE_KAFKA_CONTEXT=false", options: { bold: true } },
    "disables header injection on send only — the consumer still opens a span, but with nothing to extract, that span starts a new root.",
    { text: "This is a producer-side-only switch by design", options: { bold: true } },
    "it demonstrates the exact failure mode of an unstrumented or misconfigured hop, on command.",
  ]);
  addNotes(s, "Every producer and consumer in the order-to-shipping and order-to-notification flow respects this one toggle. With it true, a single POST /orders request produces one trace ID spanning the REST call, both gRPC hops, and both Kafka consumers. With it false, the synchronous portion keeps its trace, but shipping and notification each start their own, discoverable only by matching order_id in the payload. What to show: nothing yet — why this is a system property rather than an environment variable the agent reads directly is the next slide.");
}

{
  const s = S();
  addDiagramSlide(s, "KAFKA · THE CONTRAST", "One switch, two trace shapes",
    "sp03-kafka-toggle",
    "The consumer-side span always exists; only the parent link depends on the toggle.");
  addNotes(s, "This is the sharpest demonstration of what auto-instrumentation actually buys you: with propagation on, a trace waterfall for a PLACED order shows the Kafka publish forking into two parallel branches — shipping and notification — both children of the same producer span. With it off, those same two spans still exist, just disconnected, each the root of its own trace. What to show: run both modes and compare trace IDs in Tempo, or inspect the raw Kafka headers with kcat.");
}

{
  const s = S();
  addCodeSlide(s, "KAFKA · THE MECHANISM", "A -D flag, assembled by entrypoint.sh", "shell", [
    "# services/spring/order/entrypoint.sh",
    "# Kafka trace-context propagation: when PROPAGATE_KAFKA_CONTEXT=false we",
    "# disable producer header injection via a javaagent system property, so the",
    "# trace visibly breaks at the message boundary. Default true = continue.",
    "if [ \"${PROPAGATE_KAFKA_CONTEXT:-true}\" = \"false\" ]; then",
    "  APPEND=\"${APPEND} -Dotel.instrumentation.kafka.producer-propagation.enabled=false\"",
    "fi",
  ], "A system property, not an OTEL_* variable, because this agent instrumentation setting has never heard of PROPAGATE_KAFKA_CONTEXT.",
  { fontSize: 13 });
  addNotes(s, "This distinction matters: the agent's own instrumentation settings are exposed as JVM -D system properties, not environment variables it autoconfigures from. entrypoint.sh is the translation layer between the compose-level environment variable this tutorial's toggle uses and the agent's actual configuration surface. What to show: run the order service with the toggle flipped both ways and diff the resulting java command line.");
}

{
  const s = S();
  addCodeSlide(s, "KAFKA · THE CONSUMER SIDE", "No tracing code in the listener", "Java", [
    "// services/spring/shipping/src/main/java/com/example/otel/shipping/OrderPlacedListener.java",
    "// No HTTP is involved here: the OpenTelemetry Java agent auto-instruments",
    "// the Spring Kafka consumer and continues the trace started by the order",
    "// producer (when PROPAGATE_KAFKA_CONTEXT=true).",
    "@KafkaListener(topics = \"order.placed\", groupId = \"shipping-spring\")",
    "public void onOrderPlaced(String key, String value) {",
    "    OrderPlacedEvent event = objectMapper.readValue(value, OrderPlacedEvent.class);",
    "    // insert shipment, publish shipment.created —",
    "    // the agent already opened and parented this span",
    "}",
  ], "Compare this to Python's shipping worker, which has to call extract_context and start_as_current_span by hand.",
  { fontSize: 12 });
  addNotes(s, "This is the Spring-specific payoff of the agent model one more time: the exact same operation, consuming one Kafka topic and producing another, needs real tracing code in Python because aiokafka has no equivalent zero-code instrumentor, and needs none here, because the agent's Kafka instrumentation covers both the producer and consumer sides unconditionally. What to show: the equivalent Python worker.py side by side with this file, if contrasting stacks live.");
}

// =============================================================================
// Section 05 — Profiling with Pyroscope
// =============================================================================
divider("05", "Profiling With Pyroscope", "A second Java agent, sampling call stacks continuously.",
  "Section divider. Profiling looks inside a process rather than across a request — the fourth signal, and the one Spring Boot gets from a second javaagent alongside the OpenTelemetry one. What to show: nothing yet.");

{
  const s = S();
  addCodeSlide(s, "PROFILING · ATTACHING THE AGENT", "Gated on PYROSCOPE_ADDRESS", "shell", [
    "# services/spring/order/entrypoint.sh (same shape in every Spring service)",
    "PYRO_JAR=\"${AGENTS}/pyroscope.jar\"",
    "",
    "if [ -n \"${PYROSCOPE_ADDRESS:-}\" ] && [ -f \"${PYRO_JAR}\" ]; then",
    "  APPEND=\"${APPEND} -javaagent:${PYRO_JAR}\"",
    "  export PYROSCOPE_APPLICATION_NAME=\"${OTEL_SERVICE_NAME:-spring-service}\"",
    "  export PYROSCOPE_SERVER_ADDRESS=\"${PYROSCOPE_ADDRESS}\"",
    "  export PYROSCOPE_FORMAT=\"${PYROSCOPE_FORMAT:-jfr}\"",
    "  export PYROSCOPE_PROFILING_INTERVAL=\"${PYROSCOPE_PROFILING_INTERVAL:-10ms}\"",
    "fi",
  ], "PYROSCOPE_APPLICATION_NAME reuses OTEL_SERVICE_NAME — one naming scheme, not two, for the trace-to-profile link.",
  { fontSize: 12 });
  addNotes(s, "This is a second javaagent, io.pyroscope:agent, copied into target/agents/ by the same maven-dependency-plugin execution that copies the OpenTelemetry agent. Both agents' premain methods run before Spring's own main — order between two agents on the same -javaagent command line generally doesn't matter for Spring the way it does for Quarkus's LogManager race, covered in the production notes section. What to show: Pyroscope's UI at localhost:4040, or the trace-to-profiles link from a slow span in Tempo.");
}

{
  const s = S();
  addContentTitle(s, "PROFILING · WHAT IT ADDS", "Down to the function, not just the span");
  addBullets(s, [
    { text: "A trace tells you a Postgres query took 40 milliseconds", options: { bold: true } },
    "a profile tells you what the CPU was doing during those 40 milliseconds, down to the call stack.",
    { text: "PYROSCOPE_FORMAT=jfr", options: { bold: true } },
    "collects samples using the JVM's own Flight Recorder event format — Pyroscope's recommended mode for the JVM.",
    { text: "PYROSCOPE_PROFILING_INTERVAL=10ms", options: { bold: true } },
    "is a reasonable demo default: low overhead without starving the flame graph of samples.",
    { text: "This is the same instinct as a heap or GC investigation", options: { bold: true } },
    "a JFR capture is a deliberate, point-in-time action; the Pyroscope agent samples constantly, so the flame graph for an incident is already sitting there.",
  ]);
  addNotes(s, "This ties directly to the kind of JVM performance work a service team already knows from heap sizing, GC tuning, and startup latency investigations — the same question of where time and allocation actually go inside a process, now sampled continuously and correlated to the same service.name, trace_id, and Grafana instance as every other signal in this deck, rather than pulled out as a separate tool only during an incident. What to show: a flame graph for a CPU-bound endpoint next to one for an endpoint that mostly waits on Postgres, to show the contrast.");
}

// =============================================================================
// Section 06 — Production notes
// =============================================================================
divider("06", "Production Notes", "Resource attributes and three Boot-4 configuration issues this tutorial encountered and fixed.",
  "Section divider. These are not hypothetical warnings — all three were hit during this tutorial's own build and verified fixed. What to show: nothing yet.");

{
  const s = S();
  addContentTitle(s, "PRODUCTION · BOOT 4 GOTCHAS", "Three failure modes hit during real builds");
  addStatusTable(s, [
    { code: "Kafka autoconfig", name: "spring-boot-starter-kafka", purpose: "The bare spring-kafka dependency no longer brings KafkaAutoConfiguration/KafkaTemplate on Boot 4." },
    { code: "spring.main.keep-alive", name: "non-web services", purpose: "A gRPC- or Kafka-only service has only daemon threads and exits 0 at startup without this flag." },
    { code: "UBI uid 185", name: "rootless podman", purpose: "/deployments is root-owned by default; a writable, chowned log directory is required for file logging to work." },
  ], { colW: [2.60, 3.20, 6.29] });
  addNotes(s, "Every row here is something this tutorial's build actually hit, not a theoretical caution. The Kafka one is the easiest to miss because the failure is silent: the service starts, the bean just isn't there, and nothing in the stack trace says 'wrong starter.' What to show: the next two slides show the real fixes for keep-alive and the UBI permission issue.");
}

{
  const s = S();
  addCodeSlide(s, "PRODUCTION · NON-WEB SERVICES", "Keeping the JVM alive without a web port", "properties", [
    "# services/spring/inventory/src/main/resources/application.properties",
    "spring.application.name=inventory-spring",
    "spring.main.web-application-type=none",
    "",
    "# Keep the JVM alive for this non-web service (gRPC/Kafka threads are daemon).",
    "spring.main.keep-alive=true",
  ], "Identical pattern in payment, shipping, and notification — every service with no REST listener needs this line.",
  { fontSize: 13 });
  addNotes(s, "Without spring.main.keep-alive=true, Spring Boot's own startup sequence completes, finds no non-daemon threads keeping the JVM alive — the gRPC server and Kafka consumer threads are both daemon threads by default — and the process exits 0 immediately, having done nothing. This looks like a successful, instant startup in container logs, which makes it an easy one to miss in a health check that only checks the exit code. What to show: run inventory-spring with the line removed and watch it exit clean.");
}

{
  const s = S();
  addCodeSlide(s, "PRODUCTION · UBI PERMISSIONS", "A writable log directory for uid 185", "dockerfile", [
    "# services/spring/order/Containerfile — runtime stage",
    "COPY --from=build --chown=185 /build/target/*.jar /deployments/app.jar",
    "COPY --from=build --chown=185 /build/target/agents/ /deployments/agents/",
    "",
    "# Writable log directory for the logback FILE appender (uid 185, gid 0).",
    "USER root",
    "RUN mkdir -p /deployments/logs && chown 185:0 /deployments/logs",
    "",
    "USER 185",
  ], "The UBI OpenJDK runtime image runs as uid 185; /deployments itself is root-owned by default.",
  { fontSize: 13 });
  addNotes(s, "This is a two-step sequence: the image briefly switches back to USER root purely to create and chown one directory, then drops straight back to the unprivileged uid 185 it runs as. Skipping this produces a logback FILE appender that fails to write with a permission-denied error the console appender masks, since console output still works fine. What to show: the full Containerfile, including the build-stage comment about why that earlier stage runs as root too (Maven needs to create /build/target under rootless podman).");
}

{
  const s = S();
  addContentTitle(s, "PRODUCTION · RESOURCE ATTRIBUTES", "One identity, every signal");
  addBullets(s, [
    { text: "OTEL_SERVICE_NAME, falling back to spring.application.name", options: { bold: true } },
    "is resolved once by the agent and applied uniformly to traces, metrics, and logs — no separate Resource-building code per signal to drift.",
    { text: "DEPLOY_ENV and SERVICE_VERSION", options: { bold: true } },
    "round out the Resource attributes this tutorial's compose.yaml sets for every service, mapping to deployment.environment and service.version.",
    { text: "This is the structural reason Spring avoids", options: { bold: true } },
    "the service.name mismatch bug this tutorial's Python services actually shipped — one integrated agent, one resolution path, by construction.",
    { text: "The lesson generalizes beyond Spring", options: { bold: true } },
    "whenever a service's identity is configurable from more than one place, pick a single source of truth and have every signal read from it.",
  ]);
  addNotes(s, "Grafana's correlation provisioning matches traces to logs to metrics to profiles by, among other things, service.name — if one signal reports a different name for the same process, every cross-signal link quietly points at the wrong service, or at nothing, with no error anywhere. What to show: nothing — this closes the production notes section; the appendix has the commands to run the Spring profile locally.");
}

// =============================================================================
// Appendix — see it live
// =============================================================================
divider("A", "Appendix: See It Live", "Running the Spring profile locally — keep this open in another window.",
  "Section divider for the appendix. Reference material for running this tutorial's Spring services, not meant to be read front to back during a talk. What to show: nothing yet.");

{
  const s = S();
  addContentTitle(s, "APPENDIX · RUNNING THE SPRING PROFILE", "One compose profile, six services");
  addStatusTable(s, [
    { code: "8080", name: "order-spring", purpose: "POST /orders, GET /orders/{id} — the critical trace path through inventory and payment." },
    { code: "8081", name: "review-spring", purpose: "GraphQL at /graphql — manual resolver spans nested under one auto HTTP span." },
    { code: "50051 / 50052", name: "inventory / payment", purpose: "gRPC-only services; both need spring.main.keep-alive=true to stay running." },
    { code: "(none)", name: "shipping / notification", purpose: "Kafka consumers of order.placed; no exposed port, verified via kcat or Grafana." },
  ], { colW: [2.00, 2.90, 7.19] });
  addCaption(s, "docker compose -f stack/compose.yaml --profile spring up -d --build");
  addNotes(s, "Bringing up the spring profile builds and starts all six domain services against the same shared LGTM stack, Postgres, and Kafka every other language profile uses. Driving load against POST /orders with an X-Cart-Id header is the fastest way to exercise every mechanism in this deck in one request: the agent's auto-instrumentation, the cart.id baggage enrichment, the orders_placed_total counter, the logback-correlated logs, and the Kafka hop to shipping and notification. What to show: bring the profile up live and place one order, then open Grafana at localhost:3000 to follow it.");
}

{
  const s = S();
  addContentTitle(s, "CLOSING", "The agent does the plumbing");
  addBullets(s, [
    { text: "This deck covered Spring Boot 4.1.x specifics", options: { bold: true } },
    "the javaagent in place of the incompatible starter, Micrometer's runtime bridge, the logback MDC, baggage, Kafka propagation, and Pyroscope.",
    { text: "The pattern underneath all of it", options: { bold: true } },
    "is the same one the 101 deck named: inherit what the agent already gives you, add only what it can't see.",
    { text: "In this codebase, that addition is almost always enrichment", options: { bold: true } },
    "one baggage entry, one attribute, one business counter — not a new span, because the agent's reach is already wide.",
    { text: "The correlation payoff is identical across every language track", options: { bold: true } },
    "one trace_id, four signals, one investigation — Spring Boot just gets there with one jar instead of a build-time extension or a zero-code launcher.",
  ]);
  addNotes(s, "Close by tying back to the 101 deck's thesis: the five signals and the correlation mechanics don't change by language, only the attach mechanism does. For Spring Boot specifically, that mechanism is one javaagent doing the work of four separate instrumentation stories — traces, metrics via Micrometer, logs via the logback MDC, and Kafka context — with manual code limited to the handful of places business meaning lives that no agent can infer. What to show: nothing — this is the final slide.");
}

pres.writeFile({ fileName: OUT })
  .then((p) => console.log("WROTE", p))
  .catch((e) => { console.error(e); process.exit(1); });
