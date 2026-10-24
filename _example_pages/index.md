---
title: "Examples"
layout: plan
permalink: /examples/
description: "The runnable demo application behind this tutorial: six services in three stacks, plus the demo scripts that drive load and verify every signal."
---

Every signal in this tutorial comes from one demo application: a small
e-commerce storefront of six services, wired together over four protocols, and
implemented three times, in **Python**, **Quarkus**, and **Spring Boot**,
against the same contracts. The code lives under
[`services/`](https://github.com/{{ site.github_username }}/{{ site.github_repo }}/tree/main/services)
in the repo; the shared backend and contracts sit alongside it. See
[The e-commerce domain]({{ '/docs/05-the-ecommerce-domain/' | relative_url }})
for the full topology.

## The demo application

Browse the implementation by stack: each builds the same six services from the
shared [`proto/`](https://github.com/{{ site.github_username }}/{{ site.github_repo }}/tree/main/proto)
contracts:

- [`services/python`](https://github.com/{{ site.github_username }}/{{ site.github_repo }}/tree/main/services/python)
- [`services/quarkus`](https://github.com/{{ site.github_username }}/{{ site.github_repo }}/tree/main/services/quarkus)
- [`services/spring`](https://github.com/{{ site.github_username }}/{{ site.github_repo }}/tree/main/services/spring)

| Service | What it shows | Protocol | Stacks |
|---|---|---|---|
| order | REST entry point (`POST /orders`); fans out to inventory and payment, then publishes `order.placed` | REST in → gRPC + Kafka | Python · Quarkus · Spring |
| inventory | Reserves stock for an order | gRPC | Python · Quarkus · Spring |
| payment | Authorizes the charge | gRPC | Python · Quarkus · Spring |
| shipping | Consumes `order.placed`, creates a shipment | Kafka | Python · Quarkus · Spring |
| notification | Consumes `order.placed`, sends a notification | Kafka | Python · Quarkus · Spring |
| review | Product reviews, independent of the order flow | GraphQL | Python · Quarkus · Spring |

Each service connects to one shared Postgres (`appdb`) and emits traces,
metrics, logs, and profiles to the LGTM stack. Service skeletons are built in
[Service skeletons]({{ '/docs/07-service-skeletons/' | relative_url }}); every
later chapter layers a signal onto these same services.

## Shared infrastructure

| Component | What it shows | Chapter |
|---|---|---|
| [`stack/`](https://github.com/{{ site.github_username }}/{{ site.github_repo }}/tree/main/stack) | Grafana LGTM (Tempo, Loki, Mimir), Pyroscope, the OpenTelemetry Collector, Postgres, and Kafka: one `compose.yaml` every stack builds on | [Ch3]({{ '/docs/03-the-lgtm-stack/' | relative_url }}), [Ch6]({{ '/docs/06-the-shared-infrastructure/' | relative_url }}) |
| [`proto/`](https://github.com/{{ site.github_username }}/{{ site.github_repo }}/tree/main/proto) | Shared gRPC contracts for inventory and payment; each stack generates its own stubs from this source | [Ch5]({{ '/docs/05-the-ecommerce-domain/' | relative_url }}) |

## Demos

Two scripts under [`demos/`](https://github.com/{{ site.github_username }}/{{ site.github_repo }}/tree/main/demos)
generate telemetry and then confirm it landed.

| Demo | What it does |
|---|---|
| [`demos/drive-load.sh`](https://github.com/{{ site.github_username }}/{{ site.github_repo }}/tree/main/demos/drive-load.sh) | Places orders and runs GraphQL reads/mutations so every signal has data to show, then points you at Grafana |
| [`demos/verify-signals.sh`](https://github.com/{{ site.github_username }}/{{ site.github_repo }}/tree/main/demos/verify-signals.sh) | Queries Tempo, Mimir, Loki, and Pyroscope directly to confirm traces, metrics, logs, and profiles all arrived |

### Running the demos

The demos drive and inspect a **running** system, so bring up the stack and one
language track first (steps 1–2 of [Running an example](#running-an-example)
below). Then, from the repo root, run the two scripts in order:

```bash
# 1. Generate telemetry — places 5 orders plus GraphQL calls.
#    Pass a number to place more:  demos/drive-load.sh 20
demos/drive-load.sh

# 2. Confirm each signal (traces, metrics, logs, profiles) reached the backend.
demos/verify-signals.sh
```

Run in a terminal, each script **pauses between steps** and prints the
Grafana/LGTM URLs so you can open each signal as it appears; press **Enter** to
advance. To run straight through with no pauses (CI, recordings, scripted runs),
set `PAUSE=0`:

```bash
PAUSE=0 demos/drive-load.sh
PAUSE=0 demos/verify-signals.sh
```

Both scripts point you at **Grafana → Explore** at
[http://localhost:3000](http://localhost:3000), where traces, logs, metrics, and
profiles are pre-wired for correlation.

## Running an example

```bash
# 1. Bring up the shared stack (infra only)
docker compose -f stack/compose.yaml up -d

# 2. Bring up ONE language track (they share host ports): spring | quarkus | python
docker compose -f stack/compose.yaml --profile spring up -d --build

# 3. Generate telemetry, then confirm each signal landed
demos/drive-load.sh
demos/verify-signals.sh

# 4. Tear down (add -v to drop the Postgres/Kafka volumes)
docker compose -f stack/compose.yaml down
```

The stack runs identically on Docker or Podman (Compose Specification); for
Podman use `podman compose`.

| What | URL |
|---|---|
| Grafana | [http://localhost:3000](http://localhost:3000) (anonymous admin, no login) |
| Pyroscope | [http://localhost:4040](http://localhost:4040) |
| Mimir / Prometheus query | [http://localhost:9090](http://localhost:9090) |
| Loki | [http://localhost:3100](http://localhost:3100) |
| Tempo | [http://localhost:3200](http://localhost:3200) |
| OTLP (gRPC / HTTP) | `localhost:4317` / `localhost:4318` |
| Kafka broker | `localhost:9092` |
| Postgres | `localhost:5432` (db `appdb`, `appuser`/`apppass`) |

Tempo, Loki, Mimir, and Pyroscope are pre-provisioned as Grafana datasources
with trace↔logs↔metrics↔profiles correlation wired up; explore them from
**Grafana → Explore**. See
[Prerequisites & setup]({{ '/docs/04-prerequisites-and-setup/' | relative_url }})
for the full toolchain.
