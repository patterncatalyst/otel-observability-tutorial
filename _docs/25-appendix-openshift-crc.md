---
title: "Appendix: OpenShift with CRC"
order: 25
part: "Appendix"
description: "Deploy the LGTM stack, Pyroscope, Postgres, Kafka, and the six domain services to a local OpenShift cluster with CodeReady Containers (CRC) and Helm, and confirm the same five signals correlate there as they do on compose."
---

Every chapter before this one ran against `stack/compose.yaml`: one shared Postgres, one Kafka broker, one `grafana/otel-lgtm` container, reached over `localhost` ports and torn down with `podman compose down` at the end of a session. That is the right environment for learning the signals themselves — fast to bring up, fast to reset, no orchestration layer standing between a changed environment variable and the behavior it produces. It is not the environment most of this tutorial's readers will ship to: production telemetry has to survive pod restarts, rolling deployments, a Service's ClusterIP changing under a Deployment, and an ingress layer that isn't a port mapping on the same machine the browser is running on. This appendix closes that gap with the same six domain services and the same observability backend, deployed to a real OpenShift cluster, with nothing about the instrumentation itself changing in the process.

What matters most through everything below is what *doesn't* change. Every service in this tutorial already sends OTLP to a Collector endpoint named by an environment variable, reads its database connection from `DATABASE_URL`, and discovers Kafka through `KAFKA_BOOTSTRAP` — none of that is compose-specific, and none of it needs touching to run on Kubernetes. What changes is entirely infrastructure: how a Service gets a name pods can resolve, how a cluster assigns the UID a container runs as, and how a request from outside the cluster reaches a Service inside it. That is also exactly the set of concerns OpenShift adds its own opinions about on top of plain Kubernetes, which is why "it already ran on `compose`" and "it will run on `oc apply`" are not quite the same claim.

## What CRC is, and why it's the right target for this appendix

[CodeReady Containers](https://developers.redhat.com/products/openshift-local/overview) — more commonly called OpenShift Local, and referred to here by its CLI name, `crc`, since that's what every command below runs — packages a complete, single-node OpenShift cluster as a virtual machine image sized to run on a laptop. It is not a simplified or Kubernetes-only stand-in for OpenShift: the API server, the router, the integrated image registry, Security Context Constraints, Routes, and the `oc` CLI's full surface are the same OpenShift implementation that runs in production, just scaled down to one node instead of a multi-node footprint. That matters here because the behaviors this appendix demonstrates — an SCC rejecting a pod that demands a fixed UID it isn't allowed, a Route terminating TLS at the cluster's router, the registry's internal DNS resolving from inside a Deployment — are OpenShift-specific and a plain `kind` or `minikube` cluster won't reproduce them. CRC exercises them without provisioning a multi-node cluster in a cloud account, at the cost of a heavier resource footprint than `stack/compose.yaml`'s four containers: budget at least 16 GB of RAM and 6 vCPUs dedicated to the CRC VM on top of whatever the host itself needs. Less than that tends to produce slow pod scheduling or an OOM-killed API server rather than an outright failure to start.

## Installing and starting CRC

Download the `crc` binary for your platform from the [Red Hat Hybrid Cloud Console's OpenShift Local page](https://console.redhat.com/openshift/create/local), along with the pull secret tied to your Red Hat account — CRC needs that secret to pull the OpenShift release images on first start, the same way any OpenShift installation does. With `crc` on your `PATH`:

```bash
crc setup
```

`crc setup` checks the host's virtualization support, configures the hypervisor driver (libvirt on Linux, HyperKit or similar on macOS), and lays down the files CRC needs before the VM's first boot. It only needs to run once per machine. Size the instance before starting it — the defaults undersize it for this appendix's six application pods plus the observability stack:

```bash
crc config set memory 16384
crc config set cpus 6
crc start
```

`crc start` is the slow step, often several minutes on first run: it boots the VM, brings up the OpenShift control plane inside it, and waits for the cluster to report ready. It prints the `kubeadmin` password and the console URL on success — keep both; the password is generated fresh per `crc start` unless `crc start` is given a `--pull-secret-file` and prior state to resume from. Bring the CLI into scope for the current shell:

```bash
eval "$(crc oc-env)"
```

## Logging in and creating a project

With `crc oc-env` applied, `oc` is the same binary used against any OpenShift cluster:

```bash
oc login -u developer https://api.crc.testing:6443
oc new-project otel-observability
```

The `developer` user is CRC's built-in non-admin account, sufficient for everything this appendix does — none of it needs cluster-admin. `oc new-project` both creates the namespace and switches the current context to it; everything below assumes `otel-observability` is the active project, though nothing in the Helm chart hardcodes that name.

## Exposing the integrated registry and pushing images

OpenShift ships its own image registry, running inside the cluster and normally reachable only from inside it. CRC disables the registry's external Route by default, so the first step is turning that on:

```bash
oc patch configs.imageregistry.operator.openshift.io/cluster \
  --type merge -p '{"spec":{"defaultRoute":true}}'

REG=$(oc get route default-route -n openshift-image-registry -o jsonpath='{.spec.host}')
podman login -u "$(oc whoami)" -p "$(oc whoami -t)" --tls-verify=false "$REG"
```

With the registry reachable and authenticated, `openshift/build-and-push.sh` builds each of the six `services/python/<domain>/Containerfile` images — the same UBI-based, `USER 1001:0` multi-stage builds every earlier chapter already uses — and pushes them under the ref the Helm chart expects:

```bash
./openshift/build-and-push.sh -r "$REG" -n otel-observability
```

Python is the default language track in this appendix's chart because its Containerfiles are the ones most recently exercised end to end against a container build pipeline in this project's sibling repositories; nothing about the chart's shape is Python-specific, and pointing `build-and-push.sh -l spring` or `-l quarkus` at the other two tracks' `Containerfile`s produces equivalent images under equivalent names, since all three language tracks already build to the same arbitrary-UID, group-zero convention OpenShift's default SCC expects.

## What the chart deploys, and the SCCs behind it

`openshift/helm/otel-observability/` is one Helm chart covering the whole topology: the `grafana/otel-lgtm` all-in-one backend, Pyroscope, a single-broker KRaft Kafka StatefulSet, a Postgres StatefulSet seeded with the same schema `stack/db/init/01-schema.sql` defines, and the six domain services described declaratively in `values.yaml` — the same idiom `stack/compose.yaml`'s `x-service-env` anchor and per-language profiles use, just expressed as Helm values instead of a Compose override.

{% include excalidraw.html file="ch25-openshift-deploy" alt="Diagram of an OpenShift project named otel-observability: a client (oc or browser) reaching Route objects for order, review, and lgtm-grafana; inside the project, six domain services under the restricted-v2 SCC (order, review, inventory, payment, shipping, notification) connected by gRPC between order and inventory/payment and by Kafka produce/consume edges among order, shipping, and notification; a lgtm all-in-one pod and a pyroscope pod, both under the anyuid SCC through their own scoped ServiceAccounts, receiving OTLP and profiling data from every service; a postgres and a kafka StatefulSet under the nonroot-v2 SCC bound through a shared otel-observability-infra ServiceAccount; and ConfigMaps/a Secret supplying the shared env contract to every app pod" caption="Figure 25.1 — One OpenShift project, three Security Context Constraints, the same six services and shared env contract as stack/compose.yaml" %}

The SCCs are the one new concept here relative to earlier chapters, because compose never needed them: a container's UID on your laptop is whatever the image declares. OpenShift's admission controller instead checks every pod against a [Security Context Constraint](https://docs.openshift.com/container-platform/latest/authentication/managing-security-context-constraints.html) before scheduling it, and the default `restricted-v2` SCC forbids a container from requesting a fixed UID, assigning one at random from a range reserved for the namespace instead. That default is exactly what the six application images want: each one already runs as `USER 1001:0` (an arbitrary UID, group zero), which works under whatever UID `restricted-v2` assigns, so the app Deployments in this chart set no `runAsUser` and accept the platform's default. Postgres and Kafka's upstream images are less accommodating: they hardcode UIDs 70 and 1000 respectively and expect to own data directories under exactly that UID, so those two StatefulSets run under a dedicated `otel-observability-infra` ServiceAccount bound to the `nonroot-v2` SCC, which permits a pod to request a specific non-root UID instead of accepting a random one. The `grafana/otel-lgtm` image goes a step further still: it writes its bundled Tempo, Loki, Mimir, and Grafana data as its own root user, which neither `restricted-v2` nor `nonroot-v2` will admit, so it runs under a third ServiceAccount bound to the `anyuid` SCC — a grant scoped to that one pod, not a namespace-wide relaxation of the default policy. Pyroscope lands in the same place for a related reason: its image writes a metastore under `/data`, a directory owned by the fixed UID the image is built with, and `restricted-v2`'s randomly assigned namespace UID cannot create files there. It runs under its own ServiceAccount bound to `anyuid` and requests that fixed UID explicitly, which both lets it write `/data` and — because the UID sits outside the namespace's assigned range — forces admission onto `anyuid` rather than `restricted-v2`. Both anyuid pods keep their own ServiceAccount, so the grant stays scoped to those two backends.

Installing is a single `helm upgrade --install` against the project created above:

```bash
helm upgrade --install otel-observability openshift/helm/otel-observability \
  --namespace otel-observability \
  --set image.registry="${REG}/otel-observability"

oc get pods -n otel-observability -w
```

Postgres, Kafka, Pyroscope, and the `lgtm` backend come up first; the six application Deployments follow once their startup probes pass — `/health` for the order and review HTTP services, a TCP check against the gRPC port for inventory and payment, and no probe at all for shipping and notification, which are Kafka consumer processes with no port to check, exactly mirroring the `Containerfile`s' `EXPOSE` (or lack of one) for each.

## Reaching Grafana, and driving load against the cluster

OpenShift's ingress mechanism is the [Route](https://docs.openshift.com/container-platform/latest/networking/routes/route-configuration.html) object, the platform-native replacement for the host-port mappings `stack/compose.yaml` relies on locally. The chart creates three: one for the order service's REST API, one for review's GraphQL endpoint, and one for the `lgtm` Service's Grafana port, each terminating TLS at the cluster's router with plain HTTP redirected to HTTPS. Find Grafana's external hostname and open it in a browser — it comes up with the same anonymous Admin access the compose stack uses, so there's no login screen to get past first:

```bash
oc get route lgtm-grafana -n otel-observability -o jsonpath='{.spec.host}'
```

`demos/drive-load.sh`, the same script used against the local compose stack throughout this tutorial, works unmodified against the cluster — it only needs `ORDER_URL` and `REVIEW_URL` pointed at the Route hosts instead of `localhost`:

```bash
ORDER_URL="https://$(oc get route order -n otel-observability -o jsonpath='{.spec.host}')" \
REVIEW_URL="https://$(oc get route review -n otel-observability -o jsonpath='{.spec.host}')" \
  demos/drive-load.sh 10
```

That command places ten orders through the Route, each one fanning out to inventory and payment over gRPC, writing to Postgres, and publishing an `order.placed` event that shipping and notification pick up from Kafka — the identical request shape every earlier chapter drove against `localhost:8080`, now crossing the cluster's router and SCC-constrained pods instead of a compose network.

## The same five signals, now behind a router

Nothing above changes what a trace, a metric, a log line, or a flame graph looks like once it lands in Grafana. The `OTEL_EXPORTER_OTLP_ENDPOINT` every service reads still points at one Collector — `http://lgtm.otel-observability.svc.cluster.local:4318` instead of `http://lgtm:4318`, a change in hostname, not in protocol or shape — and that Collector still runs the same `memory_limiter`, `resource`, and `batch` processor floor from Chapter 19, exporting to the same Tempo, Mimir, and Loki backends bundled in the same `grafana/otel-lgtm` image. The one deliberate difference is the `resource` processor's `deployment.environment` attribute, set to `openshift-crc` instead of `local` — exactly the kind of attribute Chapter 23's production checklist describes as traveling with every signal so a query or dashboard can distinguish environments, without any application code knowing it moved.

A trace for an order placed through the Route still spans the REST handler, the two gRPC calls, the Postgres write, and the Kafka publish under one `trace_id`, correlated in the same Grafana instance to the matching log lines in Loki, the request-duration histogram and its exemplars in Mimir, and a `process_cpu` flame graph in Pyroscope — the exact correlation story Chapter 16 built up, reproduced here because `configmap-grafana-datasources.yaml` carries the same `tracesToLogsV2`, `tracesToMetrics`, and `tracesToProfiles` wiring as `stack/grafana/datasources.yaml`, pointed at Service DNS names instead of compose service names. That is the payoff of standardizing on OTLP and centralizing configuration in a Collector from the start, described in the abstract back in Chapter 23: moving the system onto a different orchestration platform becomes a change of hostnames and SCCs, not a re-instrumentation of six services across three languages.

## Verifying the deployment on a live CRC cluster

The chart was applied to a live single-node cluster running CRC v2.64.0 and OpenShift 4.22.14. The six Python images were built by `build-and-push.sh`, pushed to the integrated registry, and installed through one `helm upgrade --install`. Every pod reached `Running`: the `lgtm` backend, Pyroscope, the Postgres and Kafka StatefulSets, and all six domain services.

Pyroscope was the one open question this chapter carried, and the live run settled it: the pod does not run under `restricted-v2`. It crashlooped on `failed running pyroscope: ... mkdir ./data/v2: permission denied`, because the image writes its metastore under `/data` as the fixed UID it is built with (10001), and the random namespace UID `restricted-v2` assigns has no write access there. The fix is the one `lgtm` already uses: a dedicated ServiceAccount bound to the `anyuid` SCC, with the Deployment requesting UID 10001 explicitly. Requesting a UID outside the namespace's assigned range both restores write access to `/data` and forces admission onto `anyuid` instead of `restricted-v2`. The pod reached `Running` under `anyuid` on the next rollout, so the chart, its `values.yaml`, and this chapter's SCC narrative and Figure 25.1 now place Pyroscope under `anyuid` rather than `restricted-v2`.

**Verification status:** the chart deploys and runs on a live CRC cluster, and all five signals were observed in the cluster's own Grafana after driving `demos/drive-load.sh` against the Routes. A single order trace, `trace_id 017a0876519c68835d4c194a887426d3`, carries 22 spans across five services: the REST handler on `order`, the gRPC calls into `inventory` and `payment`, the Postgres writes, and the `shipping` and `notification` Kafka consumers. Those two consumer spans sitting in the same trace are the proof that context propagated across the Kafka hop. Mimir holds the `http_server_duration_milliseconds` histogram with exemplars that carry `trace_id`, next to the `orders_placed_total` business counter at 28; Loki holds the matching `order placed` log lines, each stamped with the same `trace_id` (the line for `cart-21d0` shares the trace above); the `cart.id` baggage value rides through to downstream spans; and Pyroscope serves a `process_cpu` flame graph for `order-python` whose frames include `create_order`, `insert_order`, and the asyncpg and FastAPI instrumentation below them. Every trace and log line carries `deployment.environment=openshift-crc`, the one attribute that distinguishes this run from the compose deployment. `helm lint` passes against the updated chart.

Further reading: the [OpenShift Local (CRC) documentation](https://crc.dev/crc/) covers host sizing, hypervisor setup, and troubleshooting a VM that fails to start in more depth than this chapter does; the [OpenShift documentation on Security Context Constraints](https://docs.openshift.com/container-platform/latest/authentication/managing-security-context-constraints.html) is the authoritative reference for `restricted-v2`, `nonroot-v2`, `anyuid`, and every other built-in SCC; and the [OpenTelemetry Collector documentation](https://opentelemetry.io/docs/collector/) referenced in Chapter 19 applies to the Collector running inside `grafana/otel-lgtm` here exactly as it did to the compose deployment, since the pipeline configuration is the same file with one attribute value changed.
