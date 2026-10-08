"""
diagrams_201_spring.py — diagrams for the "OpenTelemetry 201: Spring Boot" deck.

Scene ids are prefixed sp01..sp03 so they stay unique alongside the shared
101 deck's diagrams.py (r0N-...) and the other language 201 decks' own scene
files, all sharing the same diagrams/ and png/ output directories.

Each scene builds a Scene and calls .write(). Register every scene in the
SCENES list at the bottom. Shared dgen.py engine; see
references/diagram-engine.md in the lgtm-presentation skill for the API.

Paths (env, defaults): DIAG_DIR=./diagrams  PNG_DIR=./png
"""
from dgen import Scene, PALETTE


def starter_vs_agent():
    s = Scene("sp01-starter-vs-agent", width=1240, height=620,
              title="The starter does not survive Boot 4",
              subtitle="Same JVM, same application, two different attach mechanisms.")

    # Left panel: the starter, fails
    s.panel(60, 110, 540, 460, fill="#FFF5F5", stroke=PALETTE["danger"])
    s.label(330, 140, "opentelemetry-spring-boot-starter", size=15, weight="bold", color=PALETTE["danger"], anchor="middle")
    s.box(100, 180, 460, 80, "Built for Boot 3.x", ["Jackson 2 autoconfig", "Jakarta EE 10 servlet contracts"], kind="danger")
    s.arrow(330, 260, 330, 310, kind="danger", dashed=True)
    s.box(100, 310, 460, 80, "Spring Boot 4.1.x", ["Jackson 3 (tools.jackson)", "Jakarta EE 11, Spring Framework 7"], kind="danger")
    s.label(330, 430, "Classpath conflicts at startup —", size=13, color=PALETTE["muted"], anchor="middle")
    s.label(330, 450, "not a quiet wrong serializer.", size=13, color=PALETTE["muted"], anchor="middle")
    s.label(330, 500, "Do not use the starter on Boot 4.x.", size=14, weight="bold", color=PALETTE["danger"], anchor="middle")

    # Right panel: the javaagent, works
    s.panel(640, 110, 540, 460, fill="#F2FBF9", stroke=PALETTE["platform"])
    s.label(910, 140, "-javaagent:opentelemetry-javaagent.jar", size=14, weight="bold", color=PALETTE["platform"], anchor="middle")
    s.box(680, 180, 460, 80, "Attached at the JVM level", ["premain runs before Spring's main()"], kind="platform")
    s.arrow(910, 260, 910, 310, kind="platform", dashed=True)
    s.box(680, 310, 460, 80, "Weaves bytecode as classes load", ["DispatcherServlet, gRPC, JDBC, Kafka client"], kind="platform")
    s.label(910, 430, "Operates below the framework layer —", size=13, color=PALETTE["muted"], anchor="middle")
    s.label(910, 450, "version-agnostic by construction.", size=13, color=PALETTE["muted"], anchor="middle")
    s.label(910, 500, "Keeps working across a major Boot version.", size=14, weight="bold", color=PALETTE["platform"], anchor="middle")
    s.write()


def agent_pipeline():
    s = Scene("sp02-agent-pipeline", width=1280, height=640,
              title="One jar, four boundaries, zero application code",
              subtitle="The javaagent instruments bytecode below the framework, then exports over OTLP.")

    s.box(40, 180, 190, 90, "-javaagent attach", ["premain, before Spring's main()"], kind="platform")
    s.arrow(230, 225, 290, 225, kind="neutral")

    s.box(290, 130, 330, 260, "Spring Boot process", [
        "DispatcherServlet  ->  HTTP spans",
        "gRPC ManagedChannel/Server  ->  RPC spans",
        "JDBC Driver  ->  DB spans",
        "KafkaTemplate / @KafkaListener  ->  messaging spans",
    ], kind="svc")

    s.arrow(620, 190, 680, 160, kind="rest", label="bridges")
    s.box(680, 120, 260, 80, "Micrometer MeterRegistry", ["any bean, mirrored to OTel metrics"], kind="rest")
    s.arrow(620, 260, 680, 260, kind="rest", label="injects")
    s.box(680, 220, 260, 80, "Logback MDC", ["trace_id / span_id / trace_flags"], kind="rest")

    s.arrow(940, 160, 1000, 200, kind="neutral")
    s.arrow(940, 260, 1000, 220, kind="neutral")
    s.box(1000, 170, 230, 100, "OTLP exporter", ["traces + metrics + logs", "one SDK, one export path"], kind="platform")

    s.panel(290, 420, 940, 150, fill=PALETTE["panel"])
    s.label(760, 450, "OTEL_EXPORTER_OTLP_ENDPOINT, OTEL_EXPORTER_OTLP_PROTOCOL,", size=13, anchor="middle")
    s.label(760, 472, "OTEL_SERVICE_NAME, OTEL_PROPAGATORS — read directly from the environment.", size=13, anchor="middle")
    s.label(760, 500, "No Spring configuration file is involved: application.properties is unaware tracing exists.", size=12, color=PALETTE["muted"], anchor="middle")
    s.arrow(760, 420, 760, 390, kind="govern", dashed=True, label="configures")
    s.arrow(135, 420, 135, 270, kind="govern", dashed=True)
    s.write()


def kafka_toggle():
    s = Scene("sp03-kafka-toggle", width=1240, height=600,
              title="PROPAGATE_KAFKA_CONTEXT: continue or break",
              subtitle="A producer-side-only switch, read as a JVM system property.")

    s.panel(60, 120, 540, 420, fill="#FFF5F5", stroke=PALETTE["danger"])
    s.label(330, 150, "false", size=18, weight="bold", color=PALETTE["danger"], anchor="middle", mono=True)
    s.box(100, 190, 460, 70, "KafkaTemplate.send()", ["producer-propagation.enabled=false"], kind="danger")
    s.arrow(330, 260, 330, 310, kind="danger", dashed=True)
    s.box(100, 310, 460, 70, "@KafkaListener opens a NEW root span", ["no traceparent header to extract"], kind="danger")
    s.label(330, 420, "Two separate trace IDs in Tempo,", size=12, color=PALETTE["muted"], anchor="middle")
    s.label(330, 440, "related only by order_id in the payload.", size=12, color=PALETTE["muted"], anchor="middle")
    s.label(330, 490, "The consumer span still exists — only the link is gone.", size=13, weight="bold", color=PALETTE["danger"], anchor="middle")

    s.panel(640, 120, 540, 420, fill="#F2FBF9", stroke=PALETTE["platform"])
    s.label(910, 150, "true (default)", size=18, weight="bold", color=PALETTE["platform"], anchor="middle", mono=True)
    s.box(680, 190, 460, 70, "KafkaTemplate.send()", ["agent injects traceparent + baggage headers"], kind="platform")
    s.arrow(910, 260, 910, 310, kind="platform", dashed=True, label="headers")
    s.box(680, 310, 460, 70, "@KafkaListener continues the trace", ["extracted header becomes the parent span"], kind="platform")
    s.label(910, 420, "One trace ID across the REST request", size=12, color=PALETTE["muted"], anchor="middle")
    s.label(910, 440, "and both the shipping and notification hops.", size=12, color=PALETTE["muted"], anchor="middle")
    s.label(910, 490, "entrypoint.sh translates the env var into a -D flag.", size=13, weight="bold", color=PALETTE["platform"], anchor="middle")
    s.write()


SCENES = [
    starter_vs_agent,
    agent_pipeline,
    kafka_toggle,
]


if __name__ == "__main__":
    for fn in SCENES:
        fn()
        print(f"  built {fn.__name__}")
