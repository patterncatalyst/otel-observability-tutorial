# OpenTelemetry Observability Tutorial

Teaching **OpenTelemetry** and the **Grafana LGTM stack** (Loki, Grafana, Tempo,
Mimir — plus Pyroscope for profiling) through one runnable demo application, built
three times over: **Python** (FastAPI / grpcio / Strawberry / aiokafka),
**Quarkus**, and **Spring Boot**. A chapter-based Jekyll / GitHub Pages site in the
`lgtm` house style.

**Live site:** https://patterncatalyst.github.io/otel-observability-tutorial/

## What's here

- **26 tutorial chapters** plus an OpenShift Local (CRC) appendix, as a Jekyll docs
  collection.
- **One demo application, three stacks.** The same storefront is implemented in
  Python, Quarkus, and Spring Boot so you can compare instrumentation across
  ecosystems. Each stack generates its own gRPC stubs from the shared `proto/`
  contracts.
- **The full LGTM stack**, wired for correlation: traces, metrics, logs, and
  continuous profiles, pre-provisioned as Grafana datasources with links between
  them.
- **Driver scripts** (`demos/`) that generate telemetry and then confirm each signal
  landed.

## The demo application

A small storefront (chapter 5, *The e-commerce domain*): six domain services, four
inter-service protocols, one shared Postgres database (`appdb`).

| Service | Protocol | Role |
|---|---|---|
| `order` | REST (`POST /orders`) | Entry point; calls inventory + payment over gRPC, publishes `order.placed` to Kafka. |
| `inventory` | gRPC | Reserves stock (SKUs: `WIDGET-001`, `GADGET-002`, `GIZMO-003`). |
| `payment` | gRPC | Authorizes the charge. |
| `shipping` | Kafka consumer | Consumes `order.placed`, creates a shipment. |
| `notification` | Kafka consumer | Consumes `order.placed`, sends a notification. |
| `review` | GraphQL | Reviews service, independent of the order flow. |

## Quick start

```bash
# Bring up the shared stack (infra only)
docker compose -f stack/compose.yaml up -d
# Bring up a language track (pick ONE — they share host ports): spring | quarkus | python
docker compose -f stack/compose.yaml --profile spring up -d --build
# Generate telemetry, then confirm each signal landed
demos/drive-load.sh
demos/verify-signals.sh
# Tear down (add -v to drop volumes)
docker compose -f stack/compose.yaml down
```

Works on Docker or Podman (both speak the Compose Spec); for Podman use
`podman compose`.

## Endpoints

| Component | Endpoint | Notes |
|---|---|---|
| Grafana | http://localhost:3000 | Anonymous admin, no login. |
| Pyroscope | http://localhost:4040 | Continuous profiling. |
| Mimir / Prometheus query | http://localhost:9090 | Metrics. |
| Loki | http://localhost:3100 | Logs. |
| Tempo | http://localhost:3200 | Traces. |
| OTLP | localhost:4317 (gRPC) / localhost:4318 (HTTP) | Telemetry ingest. |
| Kafka | localhost:9092 | |
| Postgres | localhost:5432 | `appdb`, `appuser` / `apppass`. |

Tempo, Loki, Mimir, and Pyroscope are pre-provisioned Grafana datasources with
correlation links between them — explore via **Grafana → Explore**.

## Layout

| Path | What |
|---|---|
| `_docs/` | The 26 tutorial chapters (Jekyll docs collection). |
| `_parts/` | Part dividers for the two-level navigation. |
| `_layouts/`, `_includes/`, `assets/` | Site theme, partials, and static assets. |
| `services/{python,quarkus,spring}/{order,inventory,payment,shipping,notification,review}` | The demo app, three stacks over six services each. |
| `stack/` | Shared infra: `compose.yaml` bringing up Grafana LGTM + Pyroscope + Postgres + Kafka. |
| `proto/` | Shared gRPC contracts; each stack generates its own stubs from these. |
| `demos/` | `drive-load.sh` and `verify-signals.sh`. |
| `deck/`, `presentations/` | Slides. |
| `openshift/` | OpenShift Local (CRC) appendix. |

## Examples and demos

The site's **Examples** page walks through the three-stack services, the shared
stack, and the `proto/` contracts. The `demos/` scripts (`drive-load.sh`,
`verify-signals.sh`) drive load through the storefront and verify that every signal
reached its backend. See the [live site](https://patterncatalyst.github.io/otel-observability-tutorial/)
for the full walkthrough.
