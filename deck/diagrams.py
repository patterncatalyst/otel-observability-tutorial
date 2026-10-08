"""
diagrams.py — diagrams for the Observability & OpenTelemetry 101 deck.

Each scene is a function that builds a Scene and calls .write(). Register
every scene in the SCENES list at the bottom. Shared dgen.py engine; see
references/diagram-engine.md in the lgtm-presentation skill for the API.

Paths (env, defaults): DIAG_DIR=./diagrams  PNG_DIR=./png
"""
from dgen import Scene, PALETTE


def monitoring_vs_observability():
    s = Scene("r01-monitoring-vs-observability", width=1240, height=620,
              title="Monitoring vs. observability",
              subtitle="A known threshold answers one question; a running system answers any question.")

    # Left panel: monitoring
    s.panel(60, 110, 540, 460, fill="#FFF5F5", stroke=PALETTE["danger"])
    s.label(330, 140, "Monitoring", size=18, weight="bold", color=PALETTE["danger"], anchor="middle")
    s.box(100, 170, 460, 70, "CPU > 90%", ["threshold alert"], kind="danger")
    s.box(100, 260, 460, 70, "Error rate > 5%", ["threshold alert"], kind="danger")
    s.box(100, 350, 460, 70, "Disk nearly full", ["threshold alert"], kind="danger")
    s.label(330, 460, "Answers questions named in advance", size=13, color=PALETTE["muted"], anchor="middle")
    s.label(330, 485, "(known-unknowns)", size=13, color=PALETTE["muted"], anchor="middle")
    s.label(330, 540, "Checkout is slow for a slice of customers.", size=13, color=PALETTE["danger"], anchor="middle")
    s.label(330, 560, "Every dashboard is green. No alert fired.", size=13, color=PALETTE["danger"], anchor="middle")

    # Right panel: observability
    s.panel(640, 110, 540, 460, fill="#F2FBF9", stroke=PALETTE["platform"])
    s.label(910, 140, "Observability", size=18, weight="bold", color=PALETTE["platform"], anchor="middle")
    s.box(680, 170, 460, 70, "Trace", ["one request's shape, span by span"], kind="platform")
    s.box(680, 260, 460, 70, "Metric exemplar", ["this spike, this one sample"], kind="platform")
    s.box(680, 350, 460, 70, "Correlated logs", ["same trace_id, same window"], kind="platform")
    s.label(910, 460, "Answers a question built on the spot", size=13, color=PALETTE["muted"], anchor="middle")
    s.label(910, 485, "(unknown-unknowns)", size=13, color=PALETTE["muted"], anchor="middle")
    s.label(910, 540, "Filter by payment.provider and retry.count,", size=13, color=PALETTE["platform"], anchor="middle")
    s.label(910, 560, "a slice nobody dashboarded for in advance.", size=13, color=PALETTE["platform"], anchor="middle")

    s.write()


def five_signals():
    s = Scene("r02-five-signals", width=1280, height=620,
              title="Five signals, one running request",
              subtitle="No single signal is sufficient alone.")
    y = 150
    w, h = 220, 150
    xs = [40, 270, 500, 730, 960]
    s.box(xs[0], y, w, h, "Trace", ["shape of one request", "parent/child spans", "where did the time go"], kind="rest")
    s.box(xs[1], y, w, h, "Metric", ["aggregate over many", "counter / gauge / histogram", "how is it behaving overall"], kind="svc")
    s.box(xs[2], y, w, h, "Log", ["one discrete event", "correlated by trace_id", "what did the code say"], kind="platform")
    s.box(xs[3], y, w, h, "Baggage", ["key-value context", "rides with the trace", "cart.id, three hops downstream"], kind="govern")
    s.box(xs[4], y, w, h, "Profile", ["CPU / memory samples", "down to the function", "which line burned the time"], kind="data")
    s.panel(40, 340, 1140, 140)
    s.label(610, 375, "Each signal answers a different angle on the same request.", size=14, anchor="middle")
    s.label(610, 400, "An observable system has all five, correlated through shared identifiers —", size=13, color=PALETTE["muted"], anchor="middle")
    s.label(610, 420, "not five tools with five logins and no way to jump between them.", size=13, color=PALETTE["muted"], anchor="middle")
    s.write()


def otel_architecture():
    s = Scene("r03-otel-architecture", width=1280, height=640,
              title="API, SDK, and the Collector",
              subtitle="One span's path from instrumentation to a backend.")
    s.box(40, 150, 190, 90, "Instrumentation", ["calls the API", "zero-code or code-based"], kind="svc")
    s.box(270, 150, 190, 90, "API", ["no-op until an SDK", "is configured"], kind="neutral")
    s.box(500, 150, 190, 90, "SDK", ["Resource, sampler,", "processors"], kind="rest")
    s.arrow(230, 195, 270, 195, kind="neutral")
    s.arrow(460, 195, 500, 195, kind="neutral")
    s.arrow(595, 240, 595, 300, kind="neutral", label="OTLP")
    s.chip(540, 300, "gRPC :4317", kind="platform", w=130)
    s.chip(690, 300, "HTTP :4318", kind="platform", w=130)
    s.box(430, 350, 330, 90, "Collector", ["receive -> process -> export", "vendor-neutral relay"], kind="platform")
    s.arrow(595, 340, 595, 350, kind="neutral")
    s.arrow(595, 440, 595, 500, kind="neutral")
    s.box(300, 500, 170, 70, "Tempo", ["traces"], kind="data")
    s.box(500, 500, 170, 70, "Mimir", ["metrics"], kind="data")
    s.box(700, 500, 170, 70, "Loki", ["logs"], kind="data")
    s.arrow(595, 440, 385, 500, kind="neutral")
    s.arrow(595, 440, 785, 500, kind="neutral")
    s.panel(850, 150, 380, 180, fill=PALETTE["panel"])
    s.label(1040, 180, "service.name, service.version,", size=12, anchor="middle")
    s.label(1040, 200, "deployment.environment: the", size=12, anchor="middle")
    s.label(1040, 220, "Resource attached once per SDK,", size=12, anchor="middle")
    s.label(1040, 240, "carried on every span, metric,", size=12, anchor="middle")
    s.label(1040, 260, "and log that process emits.", size=12, anchor="middle")
    s.label(1040, 295, "This is \"who emitted this.\"", size=12, weight="bold", color=PALETTE["rest"], anchor="middle")
    s.write()


def lgtm_stack():
    s = Scene("r04-lgtm-stack", width=1280, height=640,
              title="The Grafana LGTM stack",
              subtitle="One container, four signal stores, one UI.")
    s.panel(40, 120, 1200, 260, fill="#FAFAFA", stroke=PALETTE["grid"])
    s.label(640, 145, "grafana/otel-lgtm (single container)", size=13, weight="bold", color=PALETTE["muted"], anchor="middle")
    s.box(70, 170, 220, 80, "OTel Collector", ["OTLP :4317 / :4318"], kind="platform")
    s.box(340, 170, 220, 80, "Tempo :3200", ["traces"], kind="data")
    s.box(600, 170, 220, 80, "Mimir :9090", ["metrics"], kind="data")
    s.box(860, 170, 220, 80, "Loki :3100", ["logs"], kind="data")
    s.arrow(290, 210, 340, 210, kind="neutral")
    s.arrow(560, 210, 600, 210, kind="neutral")
    s.arrow(820, 210, 860, 210, kind="neutral")
    s.box(340, 290, 220, 70, "Grafana :3000", ["the only GUI"], kind="rest")
    s.arrow(450, 250, 450, 290, kind="neutral")
    s.arrow(710, 250, 460, 290, kind="neutral")
    s.arrow(970, 250, 470, 290, kind="neutral")

    s.box(1050, 420, 160, 80, "Pyroscope :4040", ["profiles, own container"], kind="govern")
    s.arrow(560, 320, 1050, 440, kind="neutral", dashed=True, label="correlated")

    s.box(70, 420, 180, 80, "Kafka :9092/9094", ["kcat only, no GUI"], kind="svc")
    s.box(280, 420, 180, 80, "Postgres :5432", ["shared schema"], kind="svc")

    s.panel(560, 460, 440, 90, fill=PALETTE["panel"])
    s.label(780, 490, "Tempo = traces  ·  Mimir = metrics  ·  Loki = logs", size=12, anchor="middle")
    s.label(780, 515, "Pyroscope = profiles  ·  Grafana queries all four", size=12, anchor="middle")
    s.write()


def correlation_flow():
    s = Scene("r05-correlation-flow", width=1240, height=620,
              title="One trace_id, four signals",
              subtitle="Correlation is provisioning, not application code.")
    s.box(500, 150, 240, 90, "trace_id", ["generated at the root span", "propagated through context"], kind="rest", mono=True)
    s.box(80, 320, 220, 90, "Tempo", ["tracesToLogsV2", "tracesToMetrics"], kind="data")
    s.box(340, 320, 220, 90, "Loki", ["derived field:", "trace_id -> Tempo"], kind="data")
    s.box(600, 320, 220, 90, "Mimir", ["exemplar ->", "trace_id -> Tempo"], kind="data")
    s.box(860, 320, 220, 90, "Pyroscope", ["tracesToProfiles", "by service + time range"], kind="data")
    s.arrow(560, 240, 190, 320, kind="rest")
    s.arrow(590, 240, 450, 320, kind="rest")
    s.arrow(650, 240, 710, 320, kind="rest")
    s.arrow(680, 240, 970, 320, kind="rest")
    s.panel(140, 460, 900, 110)
    s.label(590, 495, "One click in Grafana: a slow span -> its logs -> its error ->", size=13, anchor="middle")
    s.label(590, 518, "its flame graph. Four queries, four stores, one shared identifier.", size=13, anchor="middle")
    s.write()


def collector_pipeline():
    s = Scene("r06-collector-pipeline", width=1240, height=560,
              title="Receivers, processors, exporters",
              subtitle="The same pipeline shape for traces, metrics, and logs.")
    s.box(40, 220, 200, 100, "Receiver", ["otlp: grpc :4317", "otlp: http :4318"], kind="svc")
    s.box(300, 160, 200, 70, "memory_limiter", ["protect the Collector"], kind="platform")
    s.box(300, 240, 200, 70, "resource", ["backfill attributes"], kind="platform")
    s.box(300, 320, 200, 70, "batch", ["amortize network calls"], kind="platform")
    s.box(580, 220, 200, 100, "Exporters", ["one per signal,", "fan out to any backend"], kind="rest")
    s.arrow(240, 270, 300, 195, kind="neutral")
    s.arrow(240, 270, 300, 275, kind="neutral")
    s.arrow(240, 270, 300, 355, kind="neutral")
    s.arrow(500, 195, 580, 260, kind="neutral")
    s.arrow(500, 275, 580, 270, kind="neutral")
    s.arrow(500, 355, 580, 280, kind="neutral")
    s.box(850, 160, 300, 70, "Tempo / Mimir / Loki", ["one config change,", "not a service redeploy"], kind="data")
    s.arrow(780, 260, 850, 195, kind="neutral")
    s.panel(850, 280, 300, 160, fill=PALETTE["panel"])
    s.label(1000, 310, "Cross-cutting decisions live here:", size=12, weight="bold", anchor="middle")
    s.label(1000, 335, "memory protection, batching,", size=12, anchor="middle")
    s.label(1000, 355, "environment tagging, redaction,", size=12, anchor="middle")
    s.label(1000, 375, "and sampling — once, not per service.", size=12, anchor="middle")
    s.write()


def sampling_head_vs_tail():
    s = Scene("r07-sampling-head-vs-tail", width=1240, height=600,
              title="Head sampling vs. tail sampling",
              subtitle="Deciding blind at the start, or deciding informed at the end.")
    s.panel(60, 120, 540, 420, fill="#FFF5F5", stroke=PALETTE["danger"])
    s.label(330, 150, "Head sampling", size=16, weight="bold", color=PALETTE["danger"], anchor="middle")
    s.box(100, 180, 460, 70, "SDK flips a coin", ["at the root span, before the outcome is known"], kind="danger")
    s.arrow(330, 250, 330, 300, kind="danger", dashed=True)
    s.box(100, 300, 460, 70, "~10% exported", ["cheap, but losses are random"], kind="danger")
    s.label(330, 420, "A slow, failing request is exactly as likely", size=12, color=PALETTE["muted"], anchor="middle")
    s.label(330, 440, "to be discarded as a fast, healthy one.", size=12, color=PALETTE["muted"], anchor="middle")
    s.label(330, 490, "Cost: known and fixed. Loss: blind.", size=13, weight="bold", color=PALETTE["danger"], anchor="middle")

    s.panel(640, 120, 540, 420, fill="#F2FBF9", stroke=PALETTE["platform"])
    s.label(910, 150, "Tail sampling", size=16, weight="bold", color=PALETTE["platform"], anchor="middle")
    s.box(680, 180, 460, 70, "Collector buffers the whole trace", ["decision_wait, then evaluate policies"], kind="platform")
    s.arrow(910, 250, 910, 300, kind="platform", dashed=True)
    s.box(680, 300, 460, 70, "Keep errors, keep slow, sample the rest", ["informed by what actually happened"], kind="platform")
    s.label(910, 420, "Costs Collector memory and buffering time,", size=12, color=PALETTE["muted"], anchor="middle")
    s.label(910, 440, "not traces you can never get back.", size=12, color=PALETTE["muted"], anchor="middle")
    s.label(910, 490, "Cost: Collector RAM. Loss: a deliberate choice.", size=13, weight="bold", color=PALETTE["platform"], anchor="middle")
    s.write()


SCENES = [
    monitoring_vs_observability,
    five_signals,
    otel_architecture,
    lgtm_stack,
    correlation_flow,
    collector_pipeline,
    sampling_head_vs_tail,
]


if __name__ == "__main__":
    for fn in SCENES:
        fn()
        print(f"  built {fn.__name__}")
