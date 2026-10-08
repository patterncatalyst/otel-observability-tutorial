"""
diagrams_201_python.py — diagrams for the "OpenTelemetry 201: Python" deck.

Scene ids are all prefixed `py0N-` so the SVG/Excalidraw/PNG files this
module writes (diagrams/py0N-*.{svg,excalidraw}, png/py0N-*.png) never
collide with the 101 deck's `r0N-*` diagrams or another language track's
own 201 diagrams module. Build with `python3 build_python.py` (this deck's
own builder — it only renders *this* module's SVGs, not the shared
diagrams.py's).

Shared dgen.py engine; see references/diagram-engine.md in the
lgtm-presentation skill for the full Scene API.

Paths (env, defaults): DIAG_DIR=./diagrams  PNG_DIR=./png
"""
from dgen import Scene, PALETTE


def launcher_mechanism():
    s = Scene("py01-launcher-mechanism", width=1240, height=560,
              title="Three attach mechanisms, one trace shape",
              subtitle="Python's zero-code path is a launcher wrapping the process, not an agent inside it.")

    s.box(40, 110, 360, 120, "Java agent", ["-javaagent flag", "bytecode woven at class-load", "Spring Boot"], kind="svc")
    s.box(440, 110, 360, 120, "Build-time extension", ["quarkus-opentelemetry", "instrumentation baked into the jar", "Quarkus"], kind="platform")
    s.box(840, 110, 360, 120, "Zero-code launcher", ["opentelemetry-instrument", "wraps the process at exec time", "Python"], kind="rest")

    s.panel(40, 270, 1160, 250, fill="#FFF8F0", stroke=PALETTE["rest"])
    s.label(620, 300, "opentelemetry-instrument, step by step", size=15, weight="bold", color=PALETTE["rest"], anchor="middle")

    s.box(80, 330, 260, 100, "ENTRYPOINT", ["opentelemetry-instrument", "starts before anything else"], kind="rest")
    s.arrow(340, 380, 440, 380, label="discovers + patches", kind="rest")
    s.box(440, 330, 300, 100, "Instrumentation packages", ["fastapi, grpc, asyncpg", "target modules monkey-patched"], kind="rest")
    s.arrow(740, 380, 820, 380, label="execs into", kind="rest")
    s.box(820, 330, 340, 100, "uvicorn order.main:app", ["FastAPI app constructed", "already-patched, not patched after"], kind="svc")

    s.label(620, 495, "Reverse the order (import first, instrument second) and some patches never take effect.",
            size=13, color=PALETTE["muted"], anchor="middle")
    s.write()


def instrumentation_coverage():
    s = Scene("py02-instrumentation-coverage", width=1240, height=600,
              title="Zero-code stops at the async boundary",
              subtitle="This stack is asyncio throughout — the gap is a property of the libraries, not an oversight.")

    s.panel(50, 110, 520, 440, fill="#F2FBF9", stroke=PALETTE["platform"])
    s.label(310, 140, "Zero-code covers", size=16, weight="bold", color=PALETTE["platform"], anchor="middle")
    s.box(90, 170, 440, 90, "FastAPI (HTTP)", ["instrument_fastapi(app) binds the live app object", "request/response spans, no app code changes"], kind="platform")
    s.box(90, 280, 440, 90, "Synchronous libraries, generally", ["the well-trodden, widely-used paths", "the zero-code model's actual target"], kind="platform")
    s.label(310, 500, "Negligible startup cost — mostly import-time", size=12, color=PALETTE["muted"], anchor="middle")
    s.label(310, 520, "monkey-patching, not bytecode rewriting.", size=12, color=PALETTE["muted"], anchor="middle")

    s.panel(670, 110, 520, 440, fill="#FFF5F5", stroke=PALETTE["danger"])
    s.label(930, 140, "Manual work fills the gap", size=16, weight="bold", color=PALETTE["danger"], anchor="middle")
    s.box(710, 170, 440, 70, "grpc.aio client/server", ["GrpcAioInstrumentorClient/Server()", "the generic grpc hook only wires sync grpc"], kind="danger")
    s.box(710, 250, 440, 70, "asyncpg", ["AsyncPGInstrumentor()", "registered once in obs/otel.py"], kind="danger")
    s.box(710, 330, 440, 70, "Strawberry GraphQL resolvers", ["review.resolve_reviews / resolve_review / add_review", "nested under one auto POST /graphql span"], kind="danger")
    s.box(710, 410, 440, 70, "aiokafka", ["inject_headers() / extract_context()", "no instrumentor exists for this client at all"], kind="danger")
    s.write()


def service_name_bug():
    s = Scene("py03-service-name-bug", width=1200, height=600,
              title="One resource, two names",
              subtitle="Verified in this tutorial's Python services: a Resource built from the wrong source breaks correlation silently.")

    s.box(80, 130, 460, 100, "Traces (Tempo)", ["service.name = order-python", "from OTEL_SERVICE_NAME"], kind="platform")
    s.box(660, 130, 460, 100, "Metrics (Mimir)", ["service.name = order-python", "from OTEL_SERVICE_NAME"], kind="platform")
    s.box(80, 400, 460, 100, "Logs (Loki)", ["service.name = order", "bare function argument"], kind="danger")
    s.box(660, 400, 460, 100, "Profiles (Pyroscope)", ["service.name = order", "bare function argument"], kind="danger")

    s.arrow(310, 230, 310, 400, kind="danger", dashed=True)
    s.arrow(890, 230, 890, 400, kind="danger", dashed=True)
    s.label(230, 255, "no match", size=11, color=PALETTE["danger"])
    s.label(810, 255, "no match", size=11, color=PALETTE["danger"])
    s.panel(60, 300, 1080, 60, fill="#FFF5F5", stroke=PALETTE["danger"])
    s.label(600, 335, "Nothing crashed. Nothing logged an error.", size=13, color=PALETTE["danger"], anchor="middle")

    s.code_block(260, 520, 680, 60,
                 ["# the fix — resolve OTEL_SERVICE_NAME before building any Resource",
                  "cfg = ObsConfig(service_name=os.getenv(\"OTEL_SERVICE_NAME\") or service_name)"],
                 lang="python")
    s.write()


def kafka_context_toggle():
    s = Scene("py04-kafka-context-toggle", width=1240, height=600,
              title="PROPAGATE_KAFKA_CONTEXT",
              subtitle="aiokafka has no auto-instrumentation — propagation is hand-written either way.")

    s.panel(40, 110, 570, 440, fill="#F2FBF9", stroke=PALETTE["platform"])
    s.label(325, 140, "true — headers injected", size=15, weight="bold", color=PALETTE["platform"], anchor="middle")
    s.box(70, 170, 220, 80, "order producer", ["inject_headers()"], kind="platform")
    s.arrow(290, 210, 400, 210, label="traceparent\n+ baggage", kind="platform")
    s.box(400, 170, 180, 80, "order.placed", ["Kafka topic"], kind="platform")
    s.arrow(490, 250, 220, 330, kind="platform")
    s.arrow(490, 250, 480, 330, kind="platform")
    s.box(90, 330, 220, 90, "shipping consumer", ["extract_context()", "child span, same trace"], kind="platform")
    s.box(360, 330, 220, 90, "notification consumer", ["extract_context()", "child span, same trace"], kind="platform")
    s.label(325, 460, "One trace_id across producer and both consumers.", size=12, color=PALETTE["muted"], anchor="middle")

    s.panel(630, 110, 570, 440, fill="#FFF5F5", stroke=PALETTE["danger"])
    s.label(915, 140, "false — no headers written", size=15, weight="bold", color=PALETTE["danger"], anchor="middle")
    s.box(660, 170, 220, 80, "order producer", ["inject_headers() returns []"], kind="danger")
    s.arrow(880, 210, 990, 210, label="no traceparent", kind="danger", dashed=True)
    s.box(990, 170, 180, 80, "order.placed", ["Kafka topic"], kind="danger")
    s.arrow(1080, 250, 810, 330, kind="danger", dashed=True)
    s.arrow(1080, 250, 1070, 330, kind="danger", dashed=True)
    s.box(680, 330, 220, 90, "shipping consumer", ["extract_context() empty", "new root span"], kind="danger")
    s.box(950, 330, 220, 90, "notification consumer", ["extract_context() empty", "new root span"], kind="danger")
    s.label(915, 460, "Two new, disconnected traces — the Chapter 13 contrast toggle.", size=12, color=PALETTE["muted"], anchor="middle")
    s.write()


SCENES = [
    launcher_mechanism,
    instrumentation_coverage,
    service_name_bug,
    kafka_context_toggle,
]
