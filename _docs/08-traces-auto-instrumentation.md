---
title: "Traces: auto-instrumentation"
order: 8
part: "The signals"
description: "One POST /orders request, three ways to get its first end-to-end trace with zero application code: a Java agent, a build-time extension, and a zero-code launcher."
---

Send the same request to three different stacks and get the same trace shape back. That is the claim this chapter has to earn: `POST /orders` on the Spring Boot, Quarkus, and Python implementations from Chapter 7 all fan out across the same four hops — a REST entry point, two outbound gRPC calls (`CheckStock` against inventory, `Authorize` against payment), a Postgres insert, and a Kafka publish to `order.placed` — and in every case, Grafana's Tempo should show one trace spanning all four, without a single line of tracing code added to `OrderController`, `OrderResource`, or `order/main.py`. None of those files import an OpenTelemetry package for this to work. The trace comes entirely from how each service is *started*, not from anything written inside it.

That "how it's started" is where the three languages diverge, and the divergence is the subject of this chapter. Spring Boot gets its trace from a Java agent attached at the JVM level. Quarkus gets it from an extension compiled into the application at build time. Python gets it from a launcher that wraps the process at startup. All three produce the [same instrumented span structure](https://opentelemetry.io/docs/concepts/instrumentation/automatic/) that OpenTelemetry's automatic-instrumentation model describes: spans created by someone else's code, following [semantic conventions](https://opentelemetry.io/docs/concepts/semantic-conventions/) you didn't write. The mechanism that produces them, and the one place each mechanism needs help from you, differ enough that debugging a missing span means knowing which of the three you're looking at.

{% include excalidraw.html file="ch08-auto-instrumentation-paths" alt="Diagram of three attach mechanisms converging on one trace shape: Spring Boot attaching the OpenTelemetry Java agent via a -javaagent JVM flag reading OTEL_ env vars directly, Quarkus compiling the quarkus-opentelemetry build-time extension into the jar and needing quarkus.otel.* keys explicitly mapped to those same env vars, and Python wrapping uvicorn with the opentelemetry-instrument zero-code launcher reading OTEL_ env vars directly, all three producing one trace spanning REST, gRPC, JDBC, and Kafka, exported over OTLP/HTTP to the Collector and into Tempo" caption="Figure 8.1 — Three attach mechanisms, one trace shape" %}

## Spring Boot: the Java agent, not the starter

The obvious thing to reach for in a Spring Boot service is `spring-boot-starter-opentelemetry` or the OpenTelemetry Spring Boot starter published alongside it — a dependency you add to `pom.xml` and otherwise ignore. For Spring Boot 4.1.x it is not an option: Boot 4 moved to Jackson 3 and Jakarta EE 11, and as of this tutorial's build, the OpenTelemetry Spring Boot starter's auto-configuration still assumes Jackson 2 and the Jakarta EE 10 servlet contracts the previous Boot major line shipped. Adding the starter to this project's `order` service produces classpath conflicts at startup, not a working integration quietly running the wrong serializer.

The fix is the mechanism OpenTelemetry instrumented Java applications with for years before any framework-specific starter existed: the [OpenTelemetry Java agent](https://opentelemetry.io/docs/zero-code/java/agent/), a single jar attached to the JVM with a `-javaagent` flag. The agent instruments bytecode as classes load — Spring's `DispatcherServlet`, the gRPC `ManagedChannel` and `Server` classes, the JDBC `Driver`, the Kafka `Producer` — all without touching source. It has no opinion about which web framework or serialization library the application uses, because it operates below that layer entirely, which is exactly why it keeps working across a major framework version where a framework-specific starter does not.

Getting the agent jar into the container is a build concern, not a runtime one. `services/spring/order/pom.xml` pins the agent's version and uses the `maven-dependency-plugin` to copy it into `target/agents/` during `package`, alongside the Pyroscope profiling agent used in a later chapter:

{% include codetabs.html langs="Spring Boot|Quarkus|Python" %}
```xml
<!-- services/spring/order/pom.xml -->
<plugin>
    <groupId>org.apache.maven.plugins</groupId>
    <artifactId>maven-dependency-plugin</artifactId>
    <executions>
        <execution>
            <id>copy-agents</id>
            <phase>package</phase>
            <goals><goal>copy</goal></goals>
            <configuration>
                <artifactItems>
                    <artifactItem>
                        <groupId>io.opentelemetry.javaagent</groupId>
                        <artifactId>opentelemetry-javaagent</artifactId>
                        <version>${otel.instrumentation.version}</version>
                        <destFileName>opentelemetry-javaagent.jar</destFileName>
                    </artifactItem>
                </artifactItems>
                <outputDirectory>${project.build.directory}/agents</outputDirectory>
            </configuration>
        </execution>
    </executions>
</plugin>
```
```xml
<!-- services/quarkus/order/pom.xml -->
<dependency>
    <groupId>io.quarkus</groupId>
    <artifactId>quarkus-opentelemetry</artifactId>
</dependency>
<dependency>
    <groupId>io.quarkus</groupId>
    <artifactId>quarkus-micrometer-opentelemetry</artifactId>
</dependency>
```
```python
# services/python/order/pyproject.toml
dependencies = [
    "opentelemetry-api==1.45.1",
    "opentelemetry-sdk==1.45.1",
    "opentelemetry-exporter-otlp-proto-http==1.45.1",
    "opentelemetry-distro==0.66b1",
    "opentelemetry-instrumentation-fastapi==0.66b1",
    "opentelemetry-instrumentation-grpc==0.66b1",
    "opentelemetry-instrumentation-asyncpg==0.66b1",
]
```

The Containerfile's runtime stage copies that `target/agents/` directory into the final image, and `services/spring/_shared/entrypoint.sh` — shared verbatim across every Spring service in this tutorial — assembles the `-javaagent` flag from what it finds on disk, rather than hardcoding it:

```sh
# services/spring/_shared/entrypoint.sh
AGENTS=/deployments/agents
OTEL_JAR="${AGENTS}/opentelemetry-javaagent.jar"

APPEND="${JAVA_OPTS_APPEND:-} -Dserver.address=0.0.0.0"

if [ -f "${OTEL_JAR}" ]; then
  APPEND="${APPEND} -javaagent:${OTEL_JAR}"
fi

export JAVA_OPTS_APPEND="${APPEND}"
exec /opt/jboss/container/java/run/run-java.sh
```

Checking for the jar's presence rather than assuming it is there is deliberate: it is what lets `OTEL_SDK_DISABLED=true` stand in for a no-telemetry baseline later in this tutorial without rebuilding the image. The agent, once attached, no-ops instead. The agent itself reads its entire configuration from plain `OTEL_*` environment variables: `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_PROTOCOL`, `OTEL_SERVICE_NAME`, `OTEL_PROPAGATORS`. The Containerfile sets these as defaults, and `stack/compose.yaml`'s shared environment block overrides them per service. There is no Spring configuration file involved in getting a trace out of this service; `application.properties` is unaware tracing exists.

## Quarkus: a build-time extension, and one mapping gap

Quarkus takes the opposite architectural position. There is no Java agent anywhere in `services/quarkus/order`'s Containerfile — the comment in its `pom.xml` says so directly: "no OTel javaagent here: tracing comes from `quarkus-opentelemetry`, baked into the jar." The `quarkus-opentelemetry` extension does its instrumentation work at *build time*, generating the bytecode that wraps REST resources, gRPC stubs, the JDBC datasource, and the Kafka channels as part of the Quarkus build step, not at class-load time inside a running JVM. `quarkus-micrometer-opentelemetry` rides alongside it, bridging Micrometer meters onto the same OpenTelemetry SDK the extension manages — the subject of Chapter 10.

This buys Quarkus something the Java agent model cannot offer: the instrumentation is part of the native-image-friendly, ahead-of-time-compiled application rather than bytecode woven in at startup, which matters for Quarkus's fast-boot story generally even though this tutorial runs the JVM mode. The cost is that configuration moves from environment variables the agent reads directly into Quarkus's own configuration system, `application.properties`, with `quarkus.otel.*` keys standing in for `OTEL_*` ones.

That substitution is not automatic, and it produces a specific, quiet failure mode. `quarkus.otel.exporter.otlp.endpoint` does not fall back to `OTEL_EXPORTER_OTLP_ENDPOINT` on its own. Reading plain `OTEL_*` variable names as implicit fallbacks is a convention of the [OpenTelemetry SDK's own autoconfiguration module](https://opentelemetry.io/docs/languages/java/configuration/), used by the Java agent and the Python distro, not a behavior of SmallRye Config or Quarkus's configuration system generally. Set `OTEL_EXPORTER_OTLP_ENDPOINT` in `compose.yaml` and do nothing else in `application.properties`, and the Quarkus service falls back silently to the OTel SDK default of `localhost:4317` over gRPC, which inside a container resolves to nothing. Traces, metrics, and logs all fail to export, with no error in the application log, because as far as the SDK is concerned the export attempts are succeeding against a Collector that happens not to be listening.

The fix each language needs for OTLP configuration shows the same contrast in miniature:

{% include codetabs.html langs="Spring Boot|Quarkus|Python" %}
```properties
# services/spring/order/src/main/resources/application.properties
# (nothing OTel-specific here — the javaagent reads OTEL_* directly)
server.port=8080
spring.application.name=order-spring
```
```properties
# services/quarkus/order/src/main/resources/application.properties
# quarkus.otel.exporter.otlp.* does NOT fall back to the plain OTEL_*
# env var names on its own — map them explicitly, or the exporter
# defaults to localhost:4317/gRPC and every signal silently fails to export.
quarkus.otel.exporter.otlp.endpoint=${OTEL_EXPORTER_OTLP_ENDPOINT:http://lgtm:4318}
quarkus.otel.exporter.otlp.protocol=${OTEL_EXPORTER_OTLP_PROTOCOL:http/protobuf}
quarkus.otel.traces.enabled=true
quarkus.otel.metrics.enabled=true
quarkus.otel.logs.enabled=true
```
```dockerfile
# services/python/order/Containerfile
ENV OTEL_SERVICE_NAME=order-python \
    OTEL_EXPORTER_OTLP_ENDPOINT=http://lgtm:4318 \
    OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
```

Spring's `application.properties` has nothing to say about OpenTelemetry at all — correct, because the agent never consults it. Quarkus's file has to explicitly re-point three `quarkus.otel.*` keys at the same two environment variables everyone else reads directly, bridging Quarkus's own config layer to the env the Compose stack sets. Python needs no such bridge, because its launcher reads those same environment variables directly, the same way the Java agent does.

`quarkus.datasource.jdbc.telemetry=true` deserves a mention alongside this, because it is Quarkus-specific in the other direction — a feature flag the extension exposes rather than a config-mapping gap to work around. JDBC client spans for the Postgres hop are opt-in per datasource in Quarkus, where the Java agent and Python's distro both instrument the JDBC/DB-API driver unconditionally. Without that one line, Quarkus's order service would otherwise produce a visibly shorter trace than its Spring and Python siblings for the identical request — not because anything is broken, but because this particular span is behind a switch the other two don't have.

## Python: a zero-code launcher wrapping the process

Python's approach looks, from the outside, like Spring's: no application code imports an OpenTelemetry package to get this first trace, and configuration comes from plain `OTEL_*` environment variables, exactly as the Java agent reads them. The mechanism is different. There is no bytecode weaving happening inside a running interpreter the way the Java agent patches a running JVM's classes. Instead, `opentelemetry-instrument` — installed as part of the `opentelemetry-distro` package — is a *launcher*: a wrapper script that OpenTelemetry's [zero-code instrumentation model](https://opentelemetry.io/docs/zero-code/python/) runs in place of your actual process, which sets up the SDK and patches the installed instrumentation libraries' target modules (FastAPI, `grpc`, `asyncpg`) via monkey-patching before your application module is ever imported, then execs into it.

That ordering is why it has to be the container's actual `ENTRYPOINT`, not something invoked from inside `main.py`:

```dockerfile
# services/python/order/Containerfile
ENTRYPOINT ["opentelemetry-instrument", "uvicorn", "order.main:app", "--host", "0.0.0.0", "--port", "8080"]
```

`opentelemetry-instrument` starts first, discovers which instrumentation packages are installed (`opentelemetry-instrumentation-fastapi`, `-grpc`, `-asyncpg`, pinned in `pyproject.toml` alongside the distro itself), and patches their target libraries before handing off to `uvicorn`, which then imports `order.main` and constructs the FastAPI `app` object the already-patched library wraps. Reverse that order — import FastAPI first, instrument second — and the patches land on a module that has already built its class hierarchy without them, and some of the auto-instrumentation never takes effect.

The zero-code launcher reliably covers the synchronous, well-trodden paths — a plain WSGI-style HTTP framework, the synchronous half of `grpc` — but this tutorial's order service is asyncio throughout, calling inventory and payment over `grpc.aio` rather than synchronous `grpc`. The generic zero-code `grpc` instrumentation hook does not reliably wire the asyncio client and server interceptors, which is why `services/python/order/src/obs/otel.py` runs a small amount of manual setup *in addition to* the zero-code launcher, specifically to enable the asyncio-aware instrumentors:

```python
# services/python/order/src/obs/otel.py
def _enable_auto_instrumentation() -> None:
    try:
        from opentelemetry.instrumentation.grpc import (
            GrpcAioInstrumentorClient,
            GrpcAioInstrumentorServer,
        )
        GrpcAioInstrumentorClient().instrument()
        GrpcAioInstrumentorServer().instrument()
    except Exception:
        pass
```

Running both the zero-code launcher and this manual call is intentional, not redundant: the OpenTelemetry API refuses a second `set_tracer_provider` call and logs a harmless warning rather than exporting twice, so whichever one runs first wins the provider registration, and the other's job becomes exactly the handful of instrumentors the first one doesn't reliably cover. It is also the first hint of Chapter 9's subject — a service combining auto-instrumentation with a small amount of code that knows about OpenTelemetry directly — arriving here not as manual spans but as manual *instrumentor registration*, filling a gap the zero-code model leaves open for this particular async stack.

## Operational trade-offs across the three mechanisms

The choice of mechanism is not purely cosmetic. The Java agent is attached at runtime and versioned independently of the application: upgrading `opentelemetry-javaagent.jar` to pick up a new instrumentation library or a bug fix is a one-line version bump in `pom.xml` and a rebuild, with no application code touched, and the same jar works unmodified against any Spring Boot service in this tutorial regardless of what that service does internally. The cost is a small amount of added JVM startup time while the agent's class-transformation machinery spins up, and a larger deployed artifact once the agent jar is baked into the image alongside the application jar.

Quarkus's build-time extension inverts that trade. Because the instrumentation is generated during `mvn package` rather than woven in at class-load time, there is effectively no added JVM startup cost from the extension itself — a meaningful property for a framework whose whole pitch includes fast boot. The cost moves earlier: upgrading `quarkus-opentelemetry` means a dependency bump and a full rebuild, the generated instrumentation is specific to what Quarkus's build step can see about your code, and anything the extension doesn't cover (`quarkus.datasource.jdbc.telemetry`, met above) has to be turned on explicitly rather than inherited automatically the way a generic bytecode agent inherits coverage of any JDBC driver it recognizes.

Python's distro sits between the two. `opentelemetry-instrument` adds negligible startup overhead of its own — it is mostly import-time monkey-patching, not bytecode rewriting — but because Python has no equivalent of a JVM-level agent operating below the interpreter, its zero-code coverage is inherently narrower for anything outside the synchronous, widely-used libraries its instrumentation packages target. That is precisely the gap this chapter's asyncio gRPC example falls into, and why `obs/otel.py` exists at all: the zero-code model's limits are a property of what CPython's instrumentation surface allows, not an oversight in this particular service.

## What the same request actually produces

Place an order against any of the three running services and the shape in Tempo is the same: one trace, one root span for the inbound HTTP request, two gRPC client spans as children (`CheckStock`, `Authorize`, each with a matching server-side span on the inventory and payment services), a database client span for the Postgres insert, and a producer span for the Kafka publish to `order.placed`. The attribute names on those spans — `rpc.service`, `rpc.method`, `db.system`, `messaging.destination.name` — come from OpenTelemetry's semantic conventions regardless of which mechanism produced the span, which is the entire point of conventions existing: a Tempo query or a Grafana dashboard panel built against one language's gRPC spans works unmodified against another's.

What differs, and what is worth watching for specifically when verifying a new service rather than when reading a finished trace, is where each mechanism shows its presence before the first request even lands. The Spring Boot container's startup log includes the agent's own banner line announcing its version and the SDK configuration it resolved. The Quarkus build log, not the runtime log, is where `quarkus-opentelemetry`'s work is visible — the extension's processing happens during `mvn package`, and a misconfigured `quarkus.otel.*` key produces silent non-export at runtime with no corresponding error, which is exactly why the `${OTEL_EXPORTER_OTLP_ENDPOINT:...}` mapping shown earlier has to be checked by looking at whether traces actually arrive in Tempo, not by looking for a warning that was never going to print. The Python container's process list shows `opentelemetry-instrument` as the running command wrapping `uvicorn`, confirmed with `podman exec <container> ps aux` if the launcher silently failed to find the entrypoint script and fell through to running the application unwrapped.

Three attach points, three configuration surfaces, one trace shape. The agent needs nothing from your code and reads the environment directly; the extension needs nothing from your code either, but it needs its own configuration keys explicitly pointed at that same environment; the distro needs nothing from your code for most paths, but needs a line or two of manual instrumentor setup for the paths zero-code coverage doesn't reach on an async stack. Chapter 9 picks up from exactly that last point: the places even a fully correct auto-instrumentation setup cannot see, because they are business decisions inside your code, not boundaries between libraries.
