---
title: "Prerequisites and setup"
order: 4
part: "Foundations"
description: "SDKMAN and uv toolchains for Spring Boot, Quarkus, and Python, bringing up the shared LGTM stack with podman compose, and the devcontainer/Testcontainers path for day-to-day development."
---

Chapter 3 described what Tempo, Loki, Mimir, Pyroscope, and Grafana each store. This chapter gets them running on your machine, alongside the toolchains for whichever of the three language implementations you intend to work through first. Three language stacks mean three sets of prerequisites, but the destination is the same for all of them: one shared `podman compose` stack, one Grafana at `localhost:3000`, and one `git clone` away from a runnable system. Everything here is a one-time setup; once it's done, every later chapter assumes it's already in place and gets straight to instrumentation.

The three language tracks do not require three separate machines or three separate observability backends. The point of this chapter is to get the infrastructure up once, correctly, and then let the per-language toolchains sit side by side so you can switch from reading the Spring Boot chapter to the Python chapter without touching anything you set up here.

## Choosing a path: install locally, or use the devcontainer

Two ways to get a working toolchain exist, and picking one up front avoids drifting between them halfway through.

The first is installing SDKMAN, uv, Podman, and Git directly on your machine, which is what this chapter walks through below. It's the right choice if you intend to keep working in this repository beyond the tutorial, want your editor's language server pointed at a real local JDK or Python interpreter, or are already comfortable managing toolchains this way.

The second is the repository's `.devcontainer/devcontainer.json`, which provisions JDK 25, Python 3.14, Node (for Newman), and Docker-outside-of-Docker inside a container your editor attaches to. It forwards the host's Docker socket so that Testcontainers (Spring Boot, Python) and Quarkus Dev Services can launch their own ephemeral containers from inside the devcontainer, and it forwards ports `3000` (Grafana) and `4040` (Pyroscope) back out to the host. The devcontainer is the faster path if you just want to read along and run the examples without touching your host toolchain at all — open the repository in an editor that supports the Dev Containers spec, let it build, and skip straight to the "Bring up the shared stack" section below.

Either path ends up at the same place: a terminal with `java`, `mvn`, `quarkus`, `uv`, and `podman` (or `docker`) on the `PATH`, ready for the commands every later chapter issues.

## Spring Boot and Quarkus: SDKMAN, JDK 25, Maven 3.9

Spring Boot and Quarkus share the same JVM toolchain, managed through [SDKMAN](https://sdkman.io) rather than a system package manager, so the exact version pinned here is reproducible on any machine regardless of what a distribution's repositories happen to carry:

```bash
curl -s "https://get.sdkman.io" | bash
source "$HOME/.sdkman/bin/sdkman-init.sh"
sdk version

sdk install java 25-tem
java -version   # Temurin 25.x

sdk install maven 3.9.9
mvn -version    # 3.9.9
```

JDK 25 Temurin is both the compile target and the development JDK for every Java service in this tutorial — `services/spring/order/pom.xml` sets `<java.version>25</java.version>`, and `services/quarkus/order/pom.xml` sets the equivalent `maven.compiler.release=25`. The container images both tracks build from (`registry.access.redhat.com/ubi10/openjdk-25-runtime`) match that version exactly, so there's no gap between what you compile locally and what runs in the container.

Quarkus needs one more tool on top of the shared JVM baseline: the Quarkus CLI, installed through the same SDKMAN mechanism and itself built on [JBang](https://www.jbang.dev):

```bash
sdk install jbang
sdk install quarkus
quarkus version
```

The CLI is what later chapters reach for to add extensions (`quarkus ext add opentelemetry`) and to run a service in live-coding mode (`quarkus dev`) against Dev Services rather than the shared compose stack — covered below. Spring Boot has no equivalent CLI dependency in this tutorial; its services build and package through plain `mvn package`, with the [OpenTelemetry Java agent](https://opentelemetry.io/docs/zero-code/java/agent/) and the Pyroscope agent copied into the build output by the `maven-dependency-plugin` configuration already present in each service's POM.

Both `pom.xml` files pin every dependency, BOM, and plugin to a specific supported release rather than a floating version — `spring-boot-starter-parent` at `4.1.1`, `quarkus-bom` at `3.33.4`, the `opentelemetry-javaagent` artifact at `2.32.0` for Spring Boot. That matters more for a tutorial than for most projects: a reader following along six months from now should get the exact same behavior this book describes, not whatever happened to be the newest patch release on the day they ran `mvn package`.

{% include codetabs.html langs="Spring Boot|Quarkus|Python" %}

```xml
<!-- services/spring/order/pom.xml -->
<properties>
    <java.version>25</java.version>
    <grpc.version>1.84.1</grpc.version>
    <protobuf.version>3.25.9</protobuf.version>
    <otel.instrumentation.version>2.32.0</otel.instrumentation.version>
    <pyroscope.version>2.9.2</pyroscope.version>
</properties>
<parent>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-parent</artifactId>
    <version>4.1.1</version>
    <relativePath/>
</parent>
```
```xml
<!-- services/quarkus/order/pom.xml -->
<properties>
    <maven.compiler.release>25</maven.compiler.release>
    <quarkus.platform.group-id>io.quarkus.platform</quarkus.platform.group-id>
    <quarkus.platform.artifact-id>quarkus-bom</quarkus.platform.artifact-id>
    <quarkus.platform.version>3.33.4</quarkus.platform.version>
    <pyroscope.version>2.9.2</pyroscope.version>
</properties>
<dependencyManagement>
    <dependencies>
        <dependency>
            <groupId>${quarkus.platform.group-id}</groupId>
            <artifactId>${quarkus.platform.artifact-id}</artifactId>
            <version>${quarkus.platform.version}</version>
            <type>pom</type>
            <scope>import</scope>
        </dependency>
    </dependencies>
</dependencyManagement>
```
```toml
# services/python/order/pyproject.toml
[project]
name = "order"
requires-python = ">=3.14"
dependencies = [
    "fastapi==0.143.0",
    "grpcio==1.84.0",
    "aiokafka==0.14.0",
    "asyncpg==0.32.0",
    "opentelemetry-sdk==1.45.1",
    "opentelemetry-distro==0.66b1",
    "pyroscope-io==1.2.5",
]

[tool.uv]
# Application, not a library: resolve/lock only, no wheel build.
package = false
```

Run every verification block once installation finishes, since a toolchain that silently resolved to the wrong major version is a more confusing failure mode three chapters from now than it is here:

```bash
java -version 2>&1 | head -1
mvn -version 2>&1 | head -1
quarkus version
uv run python --version
```

## Python: uv and Python 3.14

The Python track uses [uv](https://docs.astral.sh/uv/) as the single tool manager for the interpreter, the virtual environment, and dependency resolution — no `pip install`, Poetry, or conda alongside it for a project uv already owns:

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
source "$HOME/.local/bin/env"
uv --version

uv python install 3.14
uv python list   # confirm 3.14.x is present
```

`services/python/order/pyproject.toml` pins `requires-python = ">=3.14"` and lists every runtime dependency at an exact version — `fastapi==0.143.0`, `grpcio==1.84.0`, `aiokafka==0.14.0`, `asyncpg==0.32.0`, plus the OpenTelemetry packages (`opentelemetry-sdk`, `opentelemetry-distro`, and the per-library instrumentation packages for FastAPI, gRPC, and logging) at `1.45.1` / `0.66b1`. The `[tool.uv]` table sets `package = false`, because these services are applications run via `PYTHONPATH=/app/src`, not libraries meant to be built and distributed — `uv` here is resolving and locking a dependency set, not producing a wheel.

```bash
cd services/python/order
uv sync          # installs exactly what uv.lock pins
uv run python -m order.main
```

`uv sync` reads `uv.lock` — already committed in each service directory — and reproduces the exact dependency graph it was generated from, down to transitive versions. If you add a dependency while working through a later chapter, `uv add <package>==<version>` updates both `pyproject.toml` and the lockfile together; running `uv lock` alone regenerates the lockfile without installing anything, which is occasionally useful for checking what a version bump would resolve to before committing to it.

If your machine already standardizes on **pyenv** for interpreter management rather than letting uv install its own Python builds, point uv at the pyenv-managed interpreter instead of running two interpreter managers side by side: `uv venv --python $(pyenv which python)`. Either is fine; mixing them for the same project is what causes confusing "which Python is this" bugs.

```bash
uv --version
uv run python --version
```

## Prerequisites common to all three tracks

A handful of tools sit underneath all three language toolchains rather than belonging to any one of them:

- **Git**, for cloning the repository and checking out the per-chapter tag.
- **Podman** (or Docker), for building the per-language container images and running `stack/compose.yaml`. The compose file targets the [Compose Specification](https://compose-spec.io) rather than a tool-specific dialect, so `podman compose` and `docker compose` run it unmodified.
- **kcat**, the command-line Kafka client this tutorial uses for every piece of ad-hoc topic inspection. There is no browser-based Kafka admin UI anywhere in this stack — Grafana is the only GUI, and kcat is how you list topics, produce a test message, or tail a consumer from the terminal.
- **Newman**, the Postman collection CLI runner, optional unless you plan to run the REST/GraphQL API test collections a later chapter references.

```bash
sudo dnf install git podman kcat   # Fedora/RHEL; substitute your distro's package manager
podman --version                    # 4.x+
podman compose version              # built-in subcommand, not the standalone podman-compose package
```

That last distinction is worth being deliberate about: Podman ships `podman compose` as a built-in subcommand that shells out to either `docker-compose` or an internal implementation depending on what's installed, which is different from the separate `podman-compose` Python package some distributions also package. Either works against `stack/compose.yaml`, but if a compose command behaves unexpectedly, checking which one ran underneath it is a reasonable first debugging step.

## Clone the repository

```bash
git clone https://github.com/<org>/otel-observability-tutorial.git
cd otel-observability-tutorial
```

Everything from here references paths relative to this checkout: `stack/compose.yaml` for the shared infrastructure, `services/<lang>/<domain>` for the six domain services per language, `.devcontainer/devcontainer.json` for the container-based alternative described above.

## Bring up the shared stack

With Podman (or Docker) installed, the entire observability backend — Grafana, Tempo, Loki, Mimir, the Collector, Pyroscope, Postgres, and Kafka — comes up with one command, run from the repository root:

```bash
podman compose -f stack/compose.yaml up -d
# or: docker compose -f stack/compose.yaml up -d
```

With no `--profile` flag, only infrastructure starts — none of the six domain services from Chapter 5 are considered yet, since Chapter 7 is where their build contexts actually exist. What comes up is four services: `lgtm` (the all-in-one Grafana image bundling Tempo, Loki, Mimir, and an OpenTelemetry Collector), `pyroscope`, `postgres`, and `kafka` running single-broker KRaft mode with no ZooKeeper dependency. A fifth, `kcat`, sits behind a `tools` profile and has to be started explicitly, because it's a one-off CLI helper container rather than a long-running service:

```bash
podman compose -f stack/compose.yaml --profile tools up -d kcat
podman compose -f stack/compose.yaml exec kcat kcat -b kafka:9094 -L
```

Grafana runs with anonymous access enabled at the Admin role, so there's no login screen standing between you and the four signals this stack produces:

| What | URL |
|------|-----|
| Grafana | `http://localhost:3000` |
| Pyroscope UI | `http://localhost:4040` |
| OTLP (gRPC / HTTP) | `localhost:4317` / `localhost:4318` |
| Mimir / Prometheus query | `http://localhost:9090` |
| Loki | `http://localhost:3100` |
| Tempo | `http://localhost:3200` |
| Kafka broker | `localhost:9092` (inspect with kcat, not a GUI) |
| Postgres | `localhost:5432` (db `appdb`, user/pass `appuser`/`apppass`) |

Give Pyroscope a minute or two after a cold start before trusting it: its image is distroless, so Compose has no shell to run a `healthcheck` command against, and the container's internal components (metastore, ingester, segment writer) come up in stages. `curl http://localhost:4040/ready` can return `503` for up to roughly two minutes before settling on `200` — expected startup behavior, not a misconfiguration.

## Bringing up a language track

Each of the six domain services — order, review, inventory, payment, shipping, notification — is scaffolded in `stack/compose.yaml` under a per-language profile. Picking a language track means adding that profile flag to the same compose invocation:

```bash
podman compose -f stack/compose.yaml --profile quarkus up -d --build
# or --profile spring, or --profile python
```

Only run one profile at a time against this file. All three define the same host ports — `8080` for order, `8081` for review — so `spring` and `quarkus` running together is a port collision, not a side-by-side comparison. The shared parts (Postgres, Kafka, the LGTM stack) stay up across a profile switch; tearing down and rebuilding only matters for the per-language services themselves, which is a `podman compose -f stack/compose.yaml --profile <lang> down` followed by `up -d --build` for whichever profile you're switching to.

{% include excalidraw.html file="ch04-toolchain-to-stack" alt="Three per-language toolchains (Spring Boot and Quarkus sharing SDKMAN with JDK 25 Temurin and Maven 3.9, Quarkus additionally adding the Quarkus CLI, Python using uv and Python 3.14) converging on one git clone and podman compose -f stack/compose.yaml up -d command, which brings up infra services (lgtm, pyroscope, postgres, kafka) plus a tools-profile kcat container and per-language profiles for the six domain services, alongside an alternate devcontainer path using Testcontainers and Quarkus Dev Services instead of the compose stack" caption="Figure 4.1 — Three toolchains, one compose stack, two ways in" %}

## Local development: Testcontainers and Quarkus Dev Services

`stack/compose.yaml` is the right tool when the goal is watching telemetry flow end to end across every service in Grafana. It is the wrong tool for the day-to-day loop of writing a test, running it, and seeing it pass or fail in seconds — spinning up the full shared stack for a single `mvn test` run is slow and couples your test run to whatever state the shared Postgres happens to be in.

For that loop, Spring Boot and Python services use [Testcontainers](https://testcontainers.com) to launch disposable Postgres and Kafka containers scoped to a single test run, torn down automatically when the run finishes. Quarkus gets the equivalent behavior with zero configuration from **Quarkus Dev Services**: running `quarkus dev` detects that a datasource or Kafka connector is configured without a reachable instance and starts throwaway containers for you, wired up before your code even requests a connection.

Both paths work inside the devcontainer described earlier, because `.devcontainer/devcontainer.json` forwards the host's Docker socket via `docker-outside-of-docker` — Testcontainers and Dev Services launch real containers from inside the devcontainer without needing a nested Docker daemon or `stack/compose.yaml` running at all:

```bash
# Spring Boot / Python: Testcontainers-backed tests
mvn test                 # services/spring/<domain>
uv run pytest             # services/python/<domain>

# Quarkus: Dev Services starts Postgres/Kafka automatically
cd services/quarkus/order
quarkus dev
```

The distinction worth keeping straight is which Postgres and which Kafka a given command is talking to. `mvn test` against a Testcontainers suite gets a brand-new instance that exists for the duration of that run and vanishes afterward, entirely disconnected from anything in Grafana. `quarkus dev`'s Dev Services behaves the same way. `stack/compose.yaml`, by contrast, gets you the long-lived shared instance with data that survives a restart (Postgres and Kafka both back onto named volumes) and the full LGTM/Pyroscope backend wired up — the one to reach for whenever the next step involves looking at a trace in Grafana rather than running a test suite.

## Troubleshooting the first run

A handful of snags account for most of the friction readers hit on a first setup, and all of them are quick to recognize once you know what to look for.

**SDKMAN and uv need to be sourced in every new shell.** Both installers append an `init`/`env` line to your shell's rc file, but a shell that was already open when you ran the installer won't pick that up until you either `source` it manually or open a fresh terminal. If `java -version` or `uv --version` comes back with "command not found" right after installing, that's almost always the cause rather than a failed install.

**`JAVA_HOME` can silently override SDKMAN's selection.** If a system package manager or a previous JDK install already set `JAVA_HOME` in your shell profile, `java -version` can keep reporting the old version even after `sdk install java 25-tem` succeeds and `sdk current java` shows 25. SDKMAN manages the `PATH` and its own `JAVA_HOME` export, but only if nothing later in your shell startup clobbers it — check `echo $JAVA_HOME` and your shell rc files for an older, hardcoded path if `java -version` doesn't match what `sdk current` reports.

**Port conflicts show up as a container that starts and immediately exits.** `stack/compose.yaml` binds `3000`, `4040`, `4317`, `4318`, `9090`, `3100`, `3200`, `5432`, and `9092` on the host. Any of those already in use by another local Grafana, Postgres, or Kafka instance causes that specific container to fail to bind its port, which `podman compose ps` reports as an immediate exit rather than a hang. `lsof -i :<port>` (or `ss -ltnp` on a minimal install) identifies what's already bound before you go looking for a bug in the compose file itself.

**A stale network name blocks a second `up -d`.** The compose file names its network explicitly (`otel-observability-tutorial`) rather than letting Compose derive one from the directory path, which is normally a feature — it stays stable across checkouts — but it also means a network left over from a previous `down` without `-v`, or from a crashed compose run, can occasionally need `podman network rm otel-observability-tutorial` before a clean `up -d` succeeds again.

**Kafka's `start_period` exists for a reason — don't rush it.** A cold KRaft boot can take close to the full thirty-second `start_period` configured in its healthcheck before `kafka-broker-api-versions.sh` succeeds. A domain service that depends on Kafka won't start until that healthcheck passes, so seeing `order-quarkus` sit in a "created" or "restarting" state for the first thirty to forty-five seconds after `up -d --build` is expected, not evidence that Kafka failed to come up.

If none of the above explains what you're seeing, `podman compose -f stack/compose.yaml logs <service>` is the first and most informative place to look — every infrastructure service in this stack logs its own startup sequence clearly enough to tell "still starting" apart from "failed to start" within the first few lines.

With the toolchains installed and the shared stack running, Chapter 5 turns to what runs on top of it: the six services, their contracts, and the Postgres schema and Kafka topics they share. Chapter 6 covers `compose.yaml` itself in more depth — the `x-service-env` anchor, service-name DNS, and the healthcheck-driven startup ordering this chapter's `up -d` set in motion without explaining. Chapter 7 is where the domain services' build contexts actually exist for the first time, letting `--profile spring|quarkus|python` do something.
