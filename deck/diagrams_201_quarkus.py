"""
diagrams_201_quarkus.py — diagrams for the "OpenTelemetry 201: Quarkus" deck.

Scene ids are prefixed qk01.. to stay distinct from the shared 101 deck's
r0N-* scenes and the other 201 decks' own prefixes, since all three decks'
diagram sources and rendered PNGs live in the same shared diagrams/ and png/
directories. Build with this deck's own build_quarkus.py (NOT the shared
build_diagrams.py, which would re-render every other deck's SVGs too).

Each scene is a function that builds a Scene and calls .write(). Register
every scene in the SCENES list at the bottom. Shared dgen.py engine; see
references/diagram-engine.md in the lgtm-presentation skill for the API.

Paths (env, defaults): DIAG_DIR=./diagrams  PNG_DIR=./png
"""
from dgen import Scene, PALETTE


def attach_mechanism():
    s = Scene("qk01-attach-mechanism", width=1240, height=620,
              title="Compiled in, not attached",
              subtitle="Spring weaves bytecode at class-load time; Quarkus generates it at build time.")

    # Left panel: Spring Boot, runtime weaving
    s.panel(60, 110, 540, 440, fill="#FFF5F5", stroke=PALETTE["danger"])
    s.label(330, 140, "Spring Boot: the Java agent", size=16, weight="bold", color=PALETTE["danger"], anchor="middle")
    s.box(100, 170, 460, 70, "JVM starts", ["-javaagent:opentelemetry-javaagent.jar"], kind="danger")
    s.arrow(330, 240, 330, 280, kind="danger")
    s.box(100, 280, 460, 70, "Classes load", ["bytecode rewritten as each class loads"], kind="danger")
    s.arrow(330, 350, 330, 390, kind="danger")
    s.box(100, 390, 460, 70, "App ready", ["instrumentation cost paid at every boot"], kind="danger")
    s.label(330, 500, "Upgrade = bump the jar version, no code touched.", size=12, color=PALETTE["muted"], anchor="middle")
    s.label(330, 522, "Cost: startup time, for every process, every boot.", size=12, color=PALETTE["muted"], anchor="middle")

    # Right panel: Quarkus, build-time extension
    s.panel(640, 110, 540, 440, fill="#F2FBF9", stroke=PALETTE["platform"])
    s.label(910, 140, "Quarkus: the build-time extension", size=16, weight="bold", color=PALETTE["platform"], anchor="middle")
    s.box(680, 170, 460, 70, "mvn package", ["quarkus-opentelemetry runs as a build step"], kind="platform")
    s.arrow(910, 240, 910, 280, kind="platform")
    s.box(680, 280, 460, 70, "Jar is built", ["instrumentation baked into the bytecode"], kind="platform")
    s.arrow(910, 350, 910, 390, kind="platform")
    s.box(680, 390, 460, 70, "App ready", ["no weaving, no agent, no premain cost"], kind="platform")
    s.label(910, 500, "Upgrade = dependency bump + full rebuild.", size=12, color=PALETTE["muted"], anchor="middle")
    s.label(910, 522, "Cost: coverage is fixed at build time, not inherited.", size=12, color=PALETTE["muted"], anchor="middle")

    s.write()


def micrometer_bridge():
    s = Scene("qk02-micrometer-bridge", width=1240, height=600,
              title="One Micrometer call, two bridges",
              subtitle="meterRegistry.counter(...) is identical code; what happens to its output differs.")

    s.box(90, 150, 300, 90, "Application code", ["meterRegistry.counter(\"orders_placed_total\")", ".increment()"], kind="neutral", mono=True)
    s.arrow(390, 170, 460, 170, kind="neutral")
    s.arrow(390, 215, 460, 320, kind="neutral")

    s.panel(460, 120, 320, 140, fill="#FFF5F5", stroke=PALETTE["danger"])
    s.label(620, 145, "Spring: runtime bridge", size=13, weight="bold", color=PALETTE["danger"], anchor="middle")
    s.box(480, 165, 280, 70, "Java agent", ["watches MeterRegistry beans,", "mirrors meters onto the OTel SDK"], kind="danger")

    s.panel(460, 280, 320, 140, fill="#F2FBF9", stroke=PALETTE["platform"])
    s.label(620, 305, "Quarkus: build-time bridge", size=13, weight="bold", color=PALETTE["platform"], anchor="middle")
    s.box(480, 325, 280, 70, "quarkus-micrometer-opentelemetry", ["wired onto the OTel exporter", "as part of the Quarkus build"], kind="platform", mono=True)

    s.arrow(760, 200, 880, 240, kind="neutral")
    s.arrow(760, 360, 880, 260, kind="neutral")
    s.box(880, 210, 280, 90, "OpenTelemetry SDK", ["one histogram, one counter,", "exemplars attached"], kind="rest")
    s.arrow(1020, 300, 1020, 360, kind="neutral", label="OTLP")
    s.box(900, 360, 240, 70, "Mimir", ["same PromQL either way"], kind="data")

    s.panel(90, 280, 320, 180, fill=PALETTE["panel"])
    s.label(250, 310, "Mimir cannot tell which bridge", size=12, weight="bold", anchor="middle")
    s.label(250, 332, "produced a given histogram —", size=12, anchor="middle")
    s.label(250, 354, "by the time it is OTLP on the wire,", size=12, anchor="middle")
    s.label(250, 376, "the bridge has already run and", size=12, anchor="middle")
    s.label(250, 398, "disappeared.", size=12, anchor="middle")
    s.write()


def kafka_flags():
    s = Scene("qk03-kafka-flags", width=1240, height=600,
              title="Two flags that look alike",
              subtitle="One deletes the span category at build time; the other only stops header injection at runtime.")

    s.panel(60, 110, 1120, 200, fill="#FFF5F5", stroke=PALETTE["danger"])
    s.label(620, 138, "quarkus.otel.instrument.messaging — BUILD-TIME", size=14, weight="bold", color=PALETTE["danger"], anchor="middle", mono=True)
    s.box(100, 160, 300, 110, "=false at build", ["compiled with no messaging", "instrumentation at all"], kind="danger")
    s.arrow(400, 215, 480, 215, kind="danger")
    s.box(480, 160, 300, 110, "No consumer span", ["the contrast this chapter needs", "is gone — nothing to compare"], kind="danger")
    s.label(1000, 215, "Not used for the\ndemo toggle.", size=12, color=PALETTE["danger"], anchor="middle")

    s.panel(60, 340, 1120, 220, fill="#F2FBF9", stroke=PALETTE["platform"])
    s.label(620, 368, "mp.messaging.outgoing.*.tracing-enabled — RUNTIME, PER CHANNEL", size=14, weight="bold", color=PALETTE["platform"], anchor="middle", mono=True)
    s.box(100, 390, 300, 110, "=${PROPAGATE_KAFKA_CONTEXT}", ["producer-side header", "injection only"], kind="platform", mono=True)
    s.arrow(400, 445, 480, 445, kind="platform")
    s.box(480, 390, 300, 110, "Consumer span still opens", ["true: continues the trace", "false: starts a new root"], kind="platform")
    s.arrow(780, 445, 860, 445, kind="platform")
    s.box(860, 390, 300, 110, "One trace, or two", ["the exact contrast", "PROPAGATE_KAFKA_CONTEXT shows"], kind="platform")
    s.write()


def logmanager_race():
    s = Scene("qk04-logmanager-race", width=1240, height=640,
              title="The LogManager race",
              subtitle="Whichever code asks the JDK for a LogManager first wins it, permanently, for the life of the process.")

    s.box(90, 140, 220, 80, "JVM launches", ["parses -D flags", "before any agent runs"], kind="neutral")
    s.arrow(310, 180, 390, 180, kind="neutral")
    s.box(390, 140, 260, 80, "Pyroscope agent", ["premain() runs", "before Quarkus main()"], kind="svc")
    s.arrow(650, 180, 730, 180, kind="neutral")
    s.box(730, 140, 420, 80, "Something asks the JDK", ["for java.util.logging.LogManager —", "first caller wins, cached forever"], kind="govern")

    s.panel(60, 260, 540, 300, fill="#F2FBF9", stroke=PALETTE["platform"])
    s.label(330, 288, "-Djava.util.logging.manager set on the command line", size=13, weight="bold", color=PALETTE["platform"], anchor="middle")
    s.box(100, 310, 460, 80, "JBoss LogManager wins", ["the JVM launcher resolved it", "before premain ever ran"], kind="platform")
    s.arrow(330, 390, 330, 430, kind="platform")
    s.box(100, 430, 460, 100, "quarkus.log.* works", ["console format, file rotation,", "and the OTLP log bridge all attach"], kind="platform")

    s.panel(640, 260, 540, 300, fill="#FFF5F5", stroke=PALETTE["danger"])
    s.label(910, 288, "flag left for Quarkus's own bootstrap to set", size=13, weight="bold", color=PALETTE["danger"], anchor="middle")
    s.box(680, 310, 460, 80, "JDK default LogManager wins", ["premain touched logging", "before Quarkus got a turn"], kind="danger")
    s.arrow(910, 390, 910, 430, kind="danger")
    s.box(680, 430, 460, 100, "quarkus.log.* is ignored", ["no exception, no warning —", "just the wrong backend, silently"], kind="danger")
    s.write()


SCENES = [
    attach_mechanism,
    micrometer_bridge,
    kafka_flags,
    logmanager_race,
]


if __name__ == "__main__":
    for fn in SCENES:
        fn()
        print(f"  built {fn.__name__}")
