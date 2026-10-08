# stack/

The shared infrastructure for the whole tutorial: one `compose.yaml` that
every language track (Spring Boot, Quarkus, Python) builds on top of. It is
written to the [Compose Specification](https://compose-spec.io) so it runs
identically on Docker or Podman.

## Bring up the stack

```bash
# Docker
docker compose -f stack/compose.yaml up -d

# Podman
podman compose -f stack/compose.yaml up -d
```

With no `--profile` flag, only the infra services start:

| Service      | Purpose                                   |
|--------------|--------------------------------------------|
| `lgtm`       | Grafana + Tempo + Loki + Mimir + Collector |
| `pyroscope`  | Continuous profiling backend               |
| `postgres`   | One shared `appdb`                         |
| `kafka`      | Single KRaft broker (no ZooKeeper)         |
| `kafka-ui`   | Web UI for the Kafka cluster               |

Once Phase 3 adds the domain services, bring up a specific language track
with `--profile`:

```bash
docker compose -f stack/compose.yaml --profile quarkus up -d --build
```

(`spring`, `quarkus`, and `python` profiles each build the same six domain
services — order, review, inventory, payment, shipping, notification — from
`services/<lang>/<domain>`. Only run one language's profile at a time; they
share the same host ports.)

Tear down with `docker compose -f stack/compose.yaml down` (add `-v` to also
drop the Postgres/Kafka volumes).

## Endpoints

| What                  | URL                              |
|-----------------------|-----------------------------------|
| Grafana                | http://localhost:3000            |
| Pyroscope UI            | http://localhost:4040            |
| Kafka UI                | http://localhost:8090            |
| OTLP (gRPC / HTTP)       | localhost:4317 / localhost:4318  |
| Mimir / Prometheus query | http://localhost:9090            |
| Loki                     | http://localhost:3100            |
| Tempo                    | http://localhost:3200            |
| Postgres                 | localhost:5432 (db: `appdb`, user/pass: `appuser`/`apppass`) |

Grafana runs with anonymous access enabled as Admin — no login needed for
this local tutorial stack. Tempo, Loki, Mimir, and Pyroscope are
pre-provisioned as datasources with trace↔logs↔metrics↔profiles correlation
links wired up (see `grafana/datasources.yaml`); nothing to configure by
hand.

**Pyroscope readiness:** the standalone `pyroscope` container runs several
internal components (metastore, ingester, segment writer, ...) that come up
in stages. `curl http://localhost:4040/ready` can return `503` for up to
~2 minutes after a cold start before it returns `200` — this is expected,
not a failure.

## kcat: ad-hoc Kafka from the CLI

`kcat` is in the `tools` profile, so it does not start by default — it's a
helper container you run one-off commands against:

```bash
docker compose -f stack/compose.yaml --profile tools up -d kcat

# List topics
docker compose -f stack/compose.yaml exec kcat kcat -b kafka:9094 -L

# Produce a message to a topic
echo '{"order_id":"abc123"}' | docker compose -f stack/compose.yaml exec -T kcat \
  kcat -b kafka:9094 -t order.placed -P

# Consume from the beginning
docker compose -f stack/compose.yaml exec kcat kcat -b kafka:9094 -t order.placed -C -o beginning

# Inspect a topic's config/partitions
docker compose -f stack/compose.yaml exec kcat kcat -b kafka:9094 -L -t order.placed
```

(`kafka-ui` at http://localhost:8090 covers the same ground with a browser
UI — topics, messages, consumer groups — if you'd rather click than type.)

## Swapping in tail sampling

The Collector config mounted into `lgtm` is `otelcol/config.yaml` by
default. For the Sampling chapter, point the same mount at
`otelcol/config.tail-sampling.yaml` in `compose.yaml` and restart:

```bash
docker compose -f stack/compose.yaml up -d --force-recreate lgtm
```

## Local dev: prefer Testcontainers / Dev Services over this stack

For day-to-day service development and automated tests, don't point your
app at this long-lived compose stack — use:

- **Testcontainers** (Spring Boot, Python) — spins up throwaway Postgres/
  Kafka containers scoped to a single test run.
- **Quarkus Dev Services** (Quarkus) — does the same automatically when you
  run `quarkus dev`, with zero config.

Both work out of the box in the devcontainer (`.devcontainer/devcontainer.json`)
via a Docker socket forwarded from the host. Reach for `stack/compose.yaml`
when you want the full shared stack running (e.g. to look at traces across
services in Grafana), not for routine `mvn test` / `pytest` runs.
