---
title: "Profiling"
order: 14
part: "The signals"
description: "Continuous profiling as a runtime signal: attaching the Grafana Pyroscope agent or SDK in each stack, the Quarkus LogManager ordering gotcha, and where OTLP profiles fit in."
---

Every signal so far has answered a question about one request. A trace shows which service a request visited and how long each hop took. A log line shows what a service was doing at a specific moment. A metric shows whether a pattern held across many requests. None of them answer a narrower, more mechanical question: inside the slow span, which function was the CPU actually executing? Profiling is the fourth signal in this tutorial, and it is the one that looks inside a process rather than across a request. Where a trace tells you the Postgres query in the order service took 40 milliseconds, a profile tells you what the order service's CPU was doing during those 40 milliseconds, down to the call stack.

This tutorial's stack ships Grafana Pyroscope as the profiling backend, and every one of the six domain services, across all three language tracks, has been verified to push `process_cpu` flame graphs into it. That verification matters because profiling agents are a different kind of integration than an OTLP exporter: they instrument the runtime itself, not an HTTP client or a database driver, and the failure modes are correspondingly unusual, as the Quarkus LogManager ordering issue below makes concrete.

{% include excalidraw.html file="ch14-profiling-pipeline" alt="Diagram showing Spring Boot, Quarkus, and Python order services each attaching Grafana Pyroscope profiling (Java agent for Spring and Quarkus, SDK for Python), pushing into a Pyroscope server on port 4040, which Grafana renders as a process_cpu flame graph, with an OTLP profiles box shown as an emerging but not-yet-used alternative path, and a callout on the Quarkus path marking the LogManager ordering gotcha" caption="Figure 14.1 — Three attach mechanisms, one Pyroscope backend, one flame graph in Grafana" %}

## A fourth signal, pushed rather than pulled

[OpenTelemetry's own documentation on profiling](https://opentelemetry.io/docs/concepts/signals/profiles/) is candid about where this signal stands: profiling carries an alpha status in the specification, newer and less settled than traces, metrics, or logs. The design intent is for sampling-based and instrumentation-based collection methods to converge on one representation, OpenTelemetry's common profile data model, exported over OTLP like every other signal. Language-specific integrations with existing runtime profiling frameworks, JFR for Java or pprof for Go, are expected to show up as that model matures, alongside an eBPF-based agent that can profile across languages on Linux with no code changes at all.

None of that is what this tutorial runs today, and the distinction is worth being precise about. The pragmatic, available-now path for continuous profiling is Grafana's own Pyroscope agent and SDK, which predates OTLP profiles and uses Pyroscope's own push protocol rather than the OTel collector pipeline. A Java process with the Pyroscope agent attached samples its own call stacks at a fixed interval, in-process, and pushes a batch of samples to the Pyroscope server over HTTP on a timer, tagged with the service's name. A Python process with the Pyroscope SDK installed does the same thing from inside the interpreter. This stack's `stack/compose.yaml` runs that server as its own container, `docker.io/grafana/pyroscope:2.3.2`, listening on port `4040`, entirely separate from the `otel-lgtm` all-in-one image that hosts Tempo, Loki, Mimir, and the Collector. Profiles never pass through the OpenTelemetry Collector in this setup; they go straight from each service to Pyroscope.

That server image is distroless: no shell, no `curl`, nothing Compose can exec into to run a healthcheck. Pyroscope's internal components, its metastore, ingester, and segment writer, come up in stages after the container starts, and `GET /ready` can return `503` for up to roughly two minutes on a cold boot before settling on `200`. A profiling gap in the first couple of minutes after `docker compose up` is expected behavior for this image, not a sign that an agent failed to attach.

## Attaching the agent: a flag in Java, an import in Python

The three stacks reach Pyroscope through two fundamentally different mechanisms, and the difference is visible directly in how each one's startup is wired. Spring Boot and Quarkus both attach a Java agent, a jar passed to the JVM with `-javaagent`, whose `premain` method runs before the application's own `main`. Python has no equivalent agent-attachment facility; instead, the `pyroscope-io` package is imported like any other library and configured with a function call during the application's own startup sequence. The common thread across all three is that profiling is optional and additive: every entrypoint gates it on whether `PYROSCOPE_ADDRESS` is actually set, so a service with the environment variable unset starts and runs exactly as it would with no profiling agent at all.

{% include codetabs.html langs="Spring Boot|Quarkus|Python" %}

```bash
# services/spring/order/entrypoint.sh (same shape in every Spring service)
AGENTS=/deployments/agents
PYRO_JAR="${AGENTS}/pyroscope.jar"

if [ -n "${PYROSCOPE_ADDRESS:-}" ] && [ -f "${PYRO_JAR}" ]; then
  APPEND="${APPEND} -javaagent:${PYRO_JAR}"
  export PYROSCOPE_APPLICATION_NAME="${OTEL_SERVICE_NAME:-spring-service}"
  export PYROSCOPE_SERVER_ADDRESS="${PYROSCOPE_ADDRESS}"
  export PYROSCOPE_FORMAT="${PYROSCOPE_FORMAT:-jfr}"
  export PYROSCOPE_PROFILING_INTERVAL="${PYROSCOPE_PROFILING_INTERVAL:-10ms}"
fi

export JAVA_OPTS_APPEND="${APPEND}"
exec /opt/jboss/container/java/run/run-java.sh
```

```bash
# services/quarkus/order/entrypoint.sh — same agent, one extra JVM flag first
APPEND="${JAVA_OPTS_APPEND:-} -Dquarkus.http.host=0.0.0.0 -Djava.util.logging.manager=org.jboss.logmanager.LogManager"

if [ -n "${PYROSCOPE_ADDRESS:-}" ] && [ -f "${PYRO_JAR}" ]; then
  APPEND="${APPEND} -javaagent:${PYRO_JAR}"
  export PYROSCOPE_APPLICATION_NAME="${OTEL_SERVICE_NAME:-quarkus-service}"
  export PYROSCOPE_SERVER_ADDRESS="${PYROSCOPE_ADDRESS}"
  export PYROSCOPE_FORMAT="${PYROSCOPE_FORMAT:-jfr}"
  export PYROSCOPE_PROFILING_INTERVAL="${PYROSCOPE_PROFILING_INTERVAL:-10ms}"
fi

export JAVA_OPTS_APPEND="${APPEND}"
exec /opt/jboss/container/java/run/run-java.sh
```

```python
# services/python/order/src/obs/profiling.py
def setup_profiling(service_name: str) -> None:
    addr = os.getenv("PYROSCOPE_ADDRESS")
    if not addr:
        return
    try:
        import pyroscope  # provided by the `pyroscope-io` package
    except ImportError:
        return
    pyroscope.configure(
        application_name=service_name,
        server_address=addr,
        tags={"service_name": service_name},
    )
```

The Spring and Quarkus shapes are nearly identical by design: both copy `io.pyroscope:agent:2.9.2` into `/deployments/agents/pyroscope.jar` at build time, through the same `maven-dependency-plugin` `copy-agents` execution, and both entrypoints gate the `-javaagent` flag on the same environment check. `PYROSCOPE_FORMAT=jfr` tells the agent to collect samples using the JVM's Flight Recorder event format internally, Pyroscope's recommended mode for the JVM, and `PYROSCOPE_PROFILING_INTERVAL=10ms` sets the sampling rate, a reasonable default for a demo that keeps overhead low without starving the flame graph of samples. `PYROSCOPE_APPLICATION_NAME` is set from `OTEL_SERVICE_NAME` rather than a separate name, which is what lets Grafana's trace-to-profiles correlation link, covered in the correlation chapter, resolve the right flame graph for the right service without a second naming scheme to keep in sync.

The Python version calls `obs.profiling.setup_profiling()` once, from `obs.otel.setup()`, during the FastAPI or worker process's own startup. There is no separate binary to attach and no JVM command line to assemble; `pyroscope.configure()` starts a background sampling thread inside the running interpreter the moment it is called. The `import pyroscope` is wrapped in a bare `try/except ImportError` specifically so that a service built without the `pyroscope-io` dependency installed still starts cleanly rather than crashing on an optional feature. That soft-import pattern, combined with the early return when `PYROSCOPE_ADDRESS` is unset, means `setup_profiling()` is safe to call unconditionally from every service's startup path, Python's equivalent of gating the Java agent behind a shell `if`.

## The Quarkus ordering gotcha

Attaching the same Pyroscope jar to a Quarkus service surfaced a failure mode that never showed up in Spring Boot, and understanding it is the most concrete lesson this chapter has to offer about what a profiling agent actually does to a JVM. Quarkus normally installs the JBoss LogManager, `org.jboss.logmanager.LogManager`, as the JVM's logging backend during its own startup, which is what lets `quarkus.log.*` configuration in `application.properties` control console formatting, file rotation, and the OTLP log exporter. `java.util.logging.LogManager` is a JDK singleton: the first thing that asks the JVM for the current log manager instance causes it to be constructed and cached, permanently, for the life of the process. Whichever manager class gets constructed first wins, with no way to swap it out afterward.

A Java agent's `premain` method runs before the application's `main` method, which means a profiling agent gets a chance to touch logging infrastructure before Quarkus's own bootstrap code does. If the Pyroscope agent's `premain` triggers any lazy initialization of `java.util.logging`, directly or through a library it pulls in, the JDK's default `LogManager` is constructed and locked in right there, before Quarkus ever gets to install its own. From that point on, every `quarkus.log.*` setting is silently accepted by the configuration layer and silently ignored at runtime, because the logging backend reading it is not the one Quarkus thinks it configured. The OTLP log exporter never attaches, console formatting reverts to the JDK default, and nothing in the startup log says why: there is no exception, no warning, just logging behavior that quietly does not match the configuration.

The fix is the `-Djava.util.logging.manager=org.jboss.logmanager.LogManager` flag visible in the Quarkus `entrypoint.sh` snippet above, set directly on the JVM command line ahead of the `-javaagent` flag rather than left for Quarkus to set from inside its own startup code. System properties passed on the command line are parsed by the JVM launcher during its own bootstrap, before any agent's `premain` runs, which means the correct `LogManager` class name is already the answer the JDK gets the first time anything asks, regardless of which agent's code runs first or what that code happens to touch. Setting the same property from application code, by contrast, is too late if a premain has already forced the default manager into existence. This is specific to Quarkus's logging architecture, not a general property of the Pyroscope agent: Spring Boot uses Logback directly and has no JBoss LogManager dependency to race against, which is why the Spring Boot entrypoint has no equivalent flag. The same ordering constraint shows up again outside the container, in the Quarkus service's `pom.xml`, where the Surefire plugin sets the identical system property for Maven test runs, because a unit test JVM with the Pyroscope agent attached is subject to the same race.

## What this looks like running

Bringing up the stack for any language profile starts the `pyroscope` container automatically; it needs no `--profile` flag of its own, unlike the per-language domain services:

```bash
docker compose -f stack/compose.yaml --profile quarkus up -d --build
```

Driving a handful of requests through `POST /orders` gives each service's sampling thread something to capture. Pyroscope's own UI at `http://localhost:4040` lists every service by the `PYROSCOPE_APPLICATION_NAME` tag described above and renders its CPU time as a flame graph: width is time spent, each horizontal band is one stack frame, and the widest towers are the functions actually consuming CPU, not merely the ones that happen to be called often. The same view is reachable from inside Grafana, provisioned as the Pyroscope datasource, which is also where the correlation chapter's trace-to-profiles link lands: open a slow span in Tempo, follow the link, and the flame graph that opens is scoped to that span's service and time window, queried with `profileTypeId: process_cpu:cpu:nanoseconds:cpu:nanoseconds`, the specific profile type this stack captures.

The cross-check worth running once is comparing two services under the same load. A CPU-bound endpoint and an endpoint that mostly waits on Postgres or a downstream gRPC call should show visibly different flame graphs, a wide bar near the top for something doing real work, a flat profile for something mostly idle on I/O, and seeing that contrast confirms the agent is sampling the actual call stack rather than reporting a fixed or stale shape.

A second, independent cross-check is querying Pyroscope's own HTTP API directly, bypassing Grafana entirely, the same principle the correlation chapter applies to Loki and Tempo:

```bash
curl -s -G "http://localhost:4040/pyroscope/render" \
  --data-urlencode "query=process_cpu:cpu:nanoseconds:cpu:nanoseconds{service_name=\"order-quarkus\"}" \
  --data-urlencode "from=now-5m" --data-urlencode "until=now" | head -c 200
```

A non-empty response confirms the chain end to end: the agent attached, it sampled, it pushed, and Pyroscope stored something queryable under that service name and profile type. An empty result narrows the fault to one of those four steps rather than leaving "the flame graph looks wrong in Grafana" as the only available diagnosis.

## Where this fits with the rest of the JVM story

A reader who has worked through the demos in the `quarkus-optimization` or `spring-boot-optimization` material, heap sizing, GC behavior, startup latency, already has the instinct continuous profiling builds on: a flame graph and a JFR recording answer the same kind of question about where time and allocation actually go inside a process. What continuous profiling through Pyroscope adds is persistence and correlation. A JFR capture is a deliberate, point-in-time action taken during an investigation; the Pyroscope agent samples constantly, at low overhead, for the life of the process, so the flame graph for the exact minute an incident happened is already sitting in Pyroscope rather than something that has to be reproduced after the fact. Tied to the same `service.name` and the same Grafana instance as traces, metrics, and logs, it stops being a separate tool pulled out during a performance investigation and becomes one more view on the same request.

OTLP profiles are the direction this is heading, not the destination this tutorial has reached. When the OpenTelemetry profiling signal leaves alpha and lands in each language's SDK with the same maturity traces and metrics have today, the expectation is that the Collector will take over the transport these services currently handle by pushing straight to Pyroscope, and the JFR- and pprof-based bridges OpenTelemetry's documentation describes will let existing runtime profiling data flow through the same pipeline as every other signal. The eBPF-based agent the same documentation mentions is a further step past that: profiling a process from outside it, with no agent attached and no library imported, which would remove the Java-agent-versus-SDK split this chapter spends most of its time on. None of that changes how this stack is wired today, but it is worth knowing the asymmetry between Spring Boot's `-javaagent` flag, Quarkus's `-javaagent` flag with its LogManager prerequisite, and Python's plain library import is a property of the current Pyroscope-native path, not a permanent feature of continuous profiling as a signal.

Until OTLP profiles mature, the Pyroscope agent and SDK are the working path, verified end to end across all three stacks in this tutorial: every service, profiled, with one flame graph type, `process_cpu`, landing in the same Grafana instance as the traces and logs built up over the preceding chapters.

**Verification status:** all six domain services across Spring Boot, Quarkus, and Python were run with `PYROSCOPE_ADDRESS` set, driven with sample load, and confirmed to produce `process_cpu` flame graphs in Pyroscope and in Grafana's Pyroscope datasource view. The Quarkus LogManager ordering issue was reproduced with the flag removed (silently broken log configuration, no exception) and confirmed fixed with the flag restored.
