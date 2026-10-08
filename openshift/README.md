# Deploying the tutorial stack to OpenShift

This directory is the OpenShift counterpart to [`stack/compose.yaml`](../stack/compose.yaml).
Where the compose file brings up the LGTM observability stack, Pyroscope,
Postgres, Kafka, and the six domain services under docker/podman compose, this
tree deploys the same topology — one language track at a time — to an
OpenShift cluster, packaged as a Helm chart.

See [`_docs/25-appendix-openshift-crc.md`](../_docs/25-appendix-openshift-crc.md)
for the full narrative: what CRC is, prerequisites, `crc setup`/`crc start`,
exposing the registry, installing the chart, and driving load against the
cluster.

## What's here

```
openshift/
├── helm/otel-observability/   # one Helm chart, the whole topology
│   ├── Chart.yaml
│   ├── values.yaml            # language switch, image registry/tag, the six
│   │                          # services described as data, postgres/kafka/
│   │                          # lgtm/pyroscope image pins, shared env
│   └── templates/
│       ├── _helpers.tpl                       # labels + namespace-portable DNS
│       ├── serviceaccount-infra.yaml           # SCC bindings (nonroot-v2, anyuid)
│       ├── secret-db.yaml                      # dev-only DATABASE_URL
│       ├── configmap-app-env.yaml              # shared env: OTLP endpoint,
│       │                                       # KAFKA_BOOTSTRAP,
│       │                                       # PROPAGATE_KAFKA_CONTEXT,
│       │                                       # PYROSCOPE_ADDRESS
│       ├── configmap-otelcol.yaml              # Collector config (ported
│       │                                       # from stack/otelcol/config.yaml)
│       ├── configmap-grafana-datasources.yaml  # cross-signal datasource
│       │                                       # provisioning (ported from
│       │                                       # stack/grafana/datasources.yaml)
│       ├── lgtm-deployment.yaml / -service.yaml / -route.yaml
│       ├── pyroscope-deployment.yaml / -service.yaml
│       ├── postgres.yaml      # StatefulSet + initdb ConfigMap + Service
│       ├── kafka.yaml         # single-broker KRaft StatefulSet + Service
│       ├── app-deployment.yaml / app-service.yaml / app-route.yaml
│       │                      # ONE template each, ranged over values.services
│       │                      # → 6 Deployments, 4 Services, 2 Routes
│       └── NOTES.txt
├── build-and-push.sh          # builds the six service images for one
│                              # language track, pushes to the cluster's
│                              # integrated registry
└── README.md                  # this file
```

## What changes from `stack/compose.yaml` → OpenShift

1. **No operators assumed.** Postgres and Kafka are plain StatefulSets (the
   same single-broker KRaft setup compose uses for Kafka, no ZooKeeper), not
   operator-managed CRs — no CloudNativePG or Strimzi operator is required on
   the target cluster.
2. **Security Context Constraints (SCC).** The six service images already run
   as `USER 1001:0` (see `services/<language>/<domain>/Containerfile`), which
   is exactly what OpenShift's default `restricted-v2` SCC expects — an
   arbitrary assigned UID, group 0. The app Deployments therefore set no
   `runAsUser` and let the platform assign one. Postgres and Kafka *do* need
   specific UIDs (70 / 1000) their upstream images hardcode, so they run
   under a dedicated ServiceAccount (`otel-observability-infra`) bound to the
   `nonroot-v2` SCC. The `grafana/otel-lgtm` all-in-one image needs to run as
   root to write its bundled Grafana/Tempo/Loki/Mimir data dirs, so it runs
   under a separate ServiceAccount bound to `anyuid` — scoped to that one
   pod, not a namespace-wide grant.
3. **Routes, not host port mappings.** compose exposes services via
   `hostPort:containerPort` mappings reachable on `localhost`. OpenShift has
   a router: external access here is three `Route` objects (`order`,
   `review`, `lgtm-grafana`) served by the cluster's router.
4. **The integrated registry.** Images are pushed to OpenShift's internal
   registry and referenced from there (`build-and-push.sh`), instead of the
   `localhost/otel-tutorial-<domain>-<language>:dev` tags
   `stack/compose.yaml`'s `build:` blocks produce.
5. **One language track per install.** `stack/compose.yaml` scaffolds all
   three stacks (`spring`, `quarkus`, `python`) under compose profiles, any of
   which can run side by side locally. This chart's `values.yaml` has one
   `language` switch — `python` by default — because a single OpenShift
   namespace deploying three copies of the same six Services under the same
   names would collide; running more than one track at once would mean
   installing the chart three times into three namespaces, not a feature this
   chart adds. All three tracks have been deployed and verified one at a time
   on a live CRC cluster via `helm upgrade --set language=`; the few settings
   that differ across tracks (the `/actuator/health` probe path, the writable
   log mount the JVM images need, and the Postgres credential) are carried in
   `values.yaml` so the switch is all that changes. See
   [`_docs/25-appendix-openshift-crc.md`](../_docs/25-appendix-openshift-crc.md).

Everything else — the shared env contract (`OTEL_EXPORTER_OTLP_ENDPOINT`,
`DATABASE_URL`, `KAFKA_BOOTSTRAP`, `PROPAGATE_KAFKA_CONTEXT`,
`PYROSCOPE_ADDRESS`), the Postgres schema, the Kafka topic the order service
produces to and shipping/notification consume from, the Grafana cross-signal
datasource wiring, and the Collector's receiver/processor/exporter pipeline —
is carried over from `stack/` unchanged.

## Prerequisites

- An OpenShift cluster and `oc`/`helm` (v3+; this was authored against
  `helm` v4). For a laptop, **OpenShift Local (CRC)** — see the chapter for
  the full `crc setup`/`crc start` sequence.
- The integrated registry's default route exposed (CRC disables it by
  default) and `podman login`'d to it.
- The project/namespace created up front (`oc new-project`) — the chart does
  not create it.

## Build, push, install

```sh
./openshift/build-and-push.sh -r "$REG" -n otel-observability

helm upgrade --install otel-observability openshift/helm/otel-observability \
  --namespace otel-observability \
  --set image.registry="${REG}/otel-observability"

oc get pods -n otel-observability -w
```

Reach the system through its Routes — see `templates/NOTES.txt` (printed by
`helm install`) for the exact `oc get route` commands.

## Validating the chart without a live cluster

```sh
helm lint openshift/helm/otel-observability
helm template otel-observability openshift/helm/otel-observability --namespace otel-observability
```

Both run clean. The chart has also been deployed to a live CRC cluster
(CRC v2.64.0, OpenShift 4.22.14): every pod reached `Running` and all five
signals were observed in the cluster's Grafana — see the chapter's
verification-status note for the per-signal evidence and the Pyroscope
`anyuid` finding.

## Uninstall

```sh
helm uninstall otel-observability -n otel-observability
# PVCs (postgres-data, kafka-data) are retained by design; delete them to wipe state:
oc delete pvc -l app.kubernetes.io/part-of=otel-observability-tutorial -n otel-observability
```
