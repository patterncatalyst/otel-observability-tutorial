---
title: "The shared infrastructure"
order: 6
part: "The demo application"
description: "The one compose.yaml all three language tracks build on: service-name DNS, healthchecks, the x-service-env anchor, and per-language profiles."
---

The previous chapter described six services and four protocols without saying a word about where any of it runs. That is because the infrastructure underneath the domain is shared across all three language implementations rather than reinvented per track. One `compose.yaml`, written once against the Compose Specification, provides Postgres, Kafka, and the full observability backend for the Spring Boot, Quarkus, and Python versions of the demo alike. That one file is the subject here: how its services are named and wired, what starts by default versus what a reader has to opt into, and how the same infrastructure definition produces three independently runnable language tracks without three copies of the Compose file.

## One file, three language tracks

`stack/compose.yaml` lives at the repository root under `stack/`, separate from any of the per-language `services/<lang>/<domain>` directories it eventually builds. It targets the [Compose Specification](https://compose-spec.io) rather than a Docker-specific or Podman-specific dialect, so the identical file runs under either tool:

```bash
docker compose -f stack/compose.yaml up -d
podman compose -f stack/compose.yaml up -d
```

With no `--profile` flag, only the infrastructure services start: the Grafana LGTM stack, Pyroscope, Postgres, and Kafka. None of the six domain services from the previous chapter are considered at all — they live behind per-language Compose profiles (`spring`, `quarkus`, `python`) that only matter once their corresponding `services/<lang>/<domain>` directories exist with real build contexts. Bringing up a specific language track means adding the profile flag:

```bash
docker compose -f stack/compose.yaml --profile quarkus up -d --build
```

Each profile builds and starts the same six services — order, review, inventory, payment, shipping, notification — from its own language's directory tree. Only one language track should run at a time against this file; all three define the same host ports (`8080` for order, `8081` for review), so running `spring` and `quarkus` together would be a port collision, not a side-by-side comparison. The point of one shared Compose file is not to run three stacks simultaneously — it is to guarantee that whichever track you run, it sees the same Postgres, the same Kafka, and the same observability backend as the other two, so differences you observe in traces or metrics come from the language and framework, not from a difference in infrastructure configuration.

## What starts by default

Four infrastructure services come up with no profile selected:

- **lgtm** — the Grafana `otel-lgtm` all-in-one image: Grafana itself, plus Tempo (traces), Loki (logs), Mimir (metrics), and an OpenTelemetry Collector, all in one container. It publishes Grafana's UI on `3000`, OTLP over gRPC on `4317` and over HTTP on `4318`, Mimir's Prometheus-compatible query endpoint on `9090`, Loki on `3100`, and Tempo on `3200`.
- **pyroscope** — Grafana Pyroscope, the continuous-profiling backend, on `4040`. It is the fourth signal this tutorial covers, alongside traces, metrics, and logs.
- **postgres** — a single Postgres 17 instance holding the shared `appdb` database described in the previous chapter, initialized from `stack/db/init/01-schema.sql` on first boot.
- **kafka** — a single-broker Kafka cluster running in KRaft mode, with no ZooKeeper dependency to stand up alongside it.

A fifth service, **kcat**, is defined but does not start by default — it sits behind a `tools` Compose profile and exists purely as an ad-hoc CLI client for inspecting Kafka from outside any of the domain services. This stack has no web-based Kafka admin UI. Grafana is the only browser GUI the tutorial relies on; every other interaction with the infrastructure — listing topics, producing a test message, tailing a consumer — goes through the command line, either via `kcat` or via Kafka's own bundled scripts. This is a conscious choice: a second GUI for one piece of infrastructure adds a maintenance burden and a second thing to explain, where a handful of CLI invocations do the same job and generalize to how most engineers actually debug Kafka in production.

```bash
docker compose -f stack/compose.yaml --profile tools up -d kcat

# list topics
docker compose -f stack/compose.yaml exec kcat kcat -b kafka:9094 -L

# produce a test message
echo '{"order_id":"abc123"}' | docker compose -f stack/compose.yaml exec -T kcat \
  kcat -b kafka:9094 -t order.placed -P

# consume from the beginning
docker compose -f stack/compose.yaml exec kcat kcat -b kafka:9094 -t order.placed -C -o beginning
```

Grafana itself runs with anonymous access enabled at the Admin role, so there is no login step standing between a reader and the traces, metrics, logs, and profiles this stack produces. Tempo, Loki, Mimir, and Pyroscope are pre-provisioned as Grafana datasources with cross-signal correlation links already wired — trace-to-logs, trace-to-metrics, trace-to-profiles — so the correlation story covered later in the tutorial works the moment the stack is up, with nothing to configure by hand.

That provisioning is more fragile than it looks, and the fix is visible directly in the file layout under `stack/grafana/`. The `otel-lgtm` image ships its own default datasource and dashboard provisioning files, which point Tempo's and Pyroscope's correlation UIDs at the image's own internal defaults rather than at the external Pyroscope container this stack runs alongside it. Grafana provisions every YAML file it finds in a given provisioning directory, and on a UID collision the last file processed wins. The tutorial's own `stack/grafana/datasources.yaml` is mounted into the container as `zz-tutorial-datasources.yaml` specifically so that alphabetical processing order puts it after the image's built-in files — an unglamorous naming trick, but the mechanism by which the tutorial's correlation links reliably override the image's defaults instead of racing against them on every container start.

{% include excalidraw.html file="ch06-shared-infra-profiles" alt="Diagram of the x-service-env Compose anchor merging into three per-language profiles (spring, quarkus, python), each containing the same six domain services, all resolving the lgtm, pyroscope, postgres, and kafka infrastructure services by their Compose service names, with kcat under a separate tools profile and a devcontainer path using Testcontainers instead of this stack" caption="Figure 6.1 — One infra stack, three language profiles, service-name DNS" %}

## Service-name DNS and startup ordering

Compose gives every service in a file its own entry in the network's internal DNS, resolvable by its service name from any other container on the same network. That is why the comments at the top of `compose.yaml` can state the internal addresses as plain hostnames rather than container IDs or IP addresses: `postgres:5432`, `kafka:9094`, `http://lgtm:4318` for OTLP, `http://pyroscope:4040` for profiling. A domain service never needs to know a container's IP address or expose a port to the host to reach another service in the same Compose network — it just needs the service name, which is stable across restarts and rebuilds.

This matters for the instrumentation story specifically because of how OTLP exporters are configured: every language's OpenTelemetry SDK takes an OTLP endpoint URL as configuration, and that URL is simply `http://lgtm:4318` from inside any container on this network. There is no service discovery mechanism to configure, no sidecar to inject the right address, and no difference between how order, inventory, or review reach the Collector — they all point at the same hostname because they are all on the same Compose network talking to the same `lgtm` service.

Startup ordering is handled with `depends_on` conditions tied to each infrastructure service's `healthcheck`, rather than a fixed sleep or a retry loop baked into each domain service. Postgres's healthcheck runs `pg_isready` on an interval with a `start_period` of ten seconds; Kafka's checks that `kafka-broker-api-versions.sh` succeeds against the broker, with a thirty-second `start_period` to allow for a cold KRaft boot; `lgtm`'s checks Grafana's own `/api/health` endpoint, also with a thirty-second `start_period`, since standing up Tempo, Loki, Mimir, and the Collector together inside one container is slower than a single-process boot. A domain service with `depends_on: postgres: { condition: service_healthy }` does not start until Postgres has passed its healthcheck, not merely until the container has started — which is a meaningful difference, since a freshly started Postgres container accepts TCP connections well before it is actually ready to serve queries. `start_period` exists specifically so a slow-booting service like Kafka or `lgtm` is not marked unhealthy and endlessly restarted during the window where it is legitimately still coming up; without it, Compose's regular `interval`/`retries` health polling would start counting failures from the first health check, which would trip well before a cold KRaft broker or a cold Tempo/Loki/Mimir boot is actually ready.

Pyroscope is the one exception with no healthcheck at all. Its image is distroless — no shell, no `curl`, no `wget` — so there is no command Compose can execute inside the container to probe readiness. Its internal components (metastore, ingester, segment writer) come up in stages, and `GET /ready` from the host can return `503` for up to roughly two minutes after a cold start before settling on `200`. That is expected behavior for this image, not a misconfiguration, and any domain service depending on Pyroscope for profiling data should expect that window rather than treating early profiling gaps as a bug.

## The `x-service-env` anchor

Every domain service across all three language profiles needs the same handful of environment variables: where Postgres is, where Kafka is, where to send OTLP data, and a few feature toggles used by later chapters. Rather than repeating that block eighteen times (six services times three languages), `compose.yaml` defines it once as a YAML anchor and merges it into each service definition:

```yaml
x-service-env: &service_env
  DATABASE_URL: postgres://appuser:apppass@postgres:5432/appdb
  KAFKA_BOOTSTRAP: kafka:9094
  OTEL_EXPORTER_OTLP_ENDPOINT: http://lgtm:4318
  OTEL_EXPORTER_OTLP_PROTOCOL: http/protobuf
  OTEL_SDK_DISABLED: "${OTEL_SDK_DISABLED:-false}"
  PROPAGATE_KAFKA_CONTEXT: "${PROPAGATE_KAFKA_CONTEXT:-true}"
  PYROSCOPE_ADDRESS: "${PYROSCOPE_ADDRESS:-http://pyroscope:4040}"
  DEPLOY_ENV: local
  SERVICE_VERSION: dev
```

Each service then merges it with `<<: *service_env` and layers on the one or two variables that actually differ per service, most importantly `OTEL_SERVICE_NAME`:

```yaml
order-quarkus:
  environment:
    <<: *service_env
    OTEL_SERVICE_NAME: order-quarkus
    INVENTORY_ADDR: inventory-quarkus:50051
    PAYMENT_ADDR: payment-quarkus:50052
```

This anchor is doing more than saving keystrokes. It is also where two of the tutorial's deliberate toggles live. `OTEL_SDK_DISABLED` defaults to `false`, but a later chapter exports it as `true` before bringing the stack up, to run a "no telemetry" baseline demo that makes the value of instrumentation concrete by contrast. `PROPAGATE_KAFKA_CONTEXT` defaults to `true`, but the context-propagation chapter flips it to `false` first, to show a trace visibly breaking at the Kafka boundary, before flipping it back to demonstrate the fix. Centralizing these as anchor-level environment variables with shell-expansion defaults (`${VAR:-default}`) means every service picks up the same toggle state with one `export` before `compose up`, rather than needing six separate edits.

`OTEL_SERVICE_NAME` is kept out of the anchor and set per service instead (`order-quarkus`, `inventory-spring`, `payment-python`, and so on). This is the single attribute that lets Grafana — and every chapter from here forward — tell which service a given trace, metric, or log line came from, and it has to be unique per service rather than shared, which is why it is the one value left out of the common block.

## Volumes and the network boundary

Postgres and Kafka each back onto a named Compose volume (`postgres-data`, `kafka-data`), which is what lets `appdb`'s rows and Kafka's topic data survive a `compose down` and reappear on the next `compose up` rather than resetting to the seeded SKUs and empty topics every time. That persistence is useful while working through a chapter — placing a handful of test orders and still finding them in Postgres after restarting a service to pick up a config change — but it also means a stale schema or a half-consumed topic can linger across stack restarts in a way that is not obvious from `compose up`'s output alone. `compose down -v` is the full reset: it drops both named volumes and gives the next `compose up` a clean Postgres and Kafka to start from, which is the right move whenever a chapter's instructions assume a fresh seed state.

The whole stack also runs on one explicitly named Compose network, `otel-observability-tutorial`, rather than the default auto-generated network name Compose would otherwise derive from the project directory. Naming the network explicitly means it does not shift if the repository is cloned into a differently named directory, which matters only at the margins for this tutorial but is the kind of small decision that prevents a confusing "it worked on my machine, under a different checkout path" report. Every hostname this chapter has described as resolvable by service name — `postgres`, `kafka`, `lgtm`, `pyroscope` — is resolvable specifically because every container, infrastructure and domain service alike, joins this one named network by default.

## Local development: prefer Testcontainers and Dev Services

`stack/compose.yaml` is the stack to bring up when you want the full system running end to end — placing an order and watching the resulting trace fan out across all six services in Grafana. It is not the right tool for routine test runs. For day-to-day development and automated tests, Spring Boot and Python tracks use **Testcontainers** to spin up throwaway Postgres and Kafka containers scoped to a single test run, and the Quarkus track gets the equivalent behavior automatically from **Quarkus Dev Services** the moment you run `quarkus dev`, with no configuration at all. Both paths work out of the box inside the repository's devcontainer (`.devcontainer/devcontainer.json`), which forwards the host's Docker socket into the development container so Testcontainers and Dev Services can launch their own ephemeral containers without needing `stack/compose.yaml` running at all.

The distinction to keep straight is which Postgres and which Kafka a given workflow is talking to. `mvn test` or `pytest` against a Testcontainers-backed suite gets a brand-new, disposable Postgres and Kafka that exist only for that test run and disappear afterward — fast, isolated, and irrelevant to anything in Grafana. Bringing up `stack/compose.yaml` gets the long-lived shared instance that the whole demo application runs against, with data that persists across restarts (Postgres and Kafka both back onto named volumes) and with the full LGTM/Pyroscope observability backend attached. Reach for the Compose stack specifically when the next step involves looking at cross-service telemetry in Grafana; reach for Testcontainers or Dev Services for everything else.

Tearing the shared stack down is a plain `docker compose -f stack/compose.yaml down`, with a `-v` flag added when you also want to drop the Postgres and Kafka volumes and start the next run from a clean schema and an empty topic.

With the infrastructure this tutorial sits on now established — what starts by default, how services find each other, and how the per-language profiles share one environment definition — the next chapter moves into the service skeletons themselves: the minimal, uninstrumented versions of order, inventory, payment, shipping, notification, and review that later chapters progressively instrument.
