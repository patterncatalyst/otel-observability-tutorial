---
title: "Master plan — otel-observability-tutorial"
layout: plan
render_with_liquid: false
---

# Master plan — otel-observability-tutorial

Multi-language (Java/Spring Boot, Java/Quarkus, Python) OpenTelemetry + Grafana
LGTM tutorial. Built with the lgtm-* skills via the lgtm-relay (Opus plan →
Sonnet execute → Opus validate), phased with a user review gate per phase.

Repo: `patterncatalyst/otel-observability-tutorial` (public), Pages baseurl
`/otel-observability-tutorial`. Local: `/home/rsedor/Dev/otel-observability-tutorial`.

## Decisions (locked)
- Scope: all 25 chapters (Parts 0–4).
- Spring Boot 4.1.x (major jump from 3.x: Jackson 3, Jakarta EE 11; build Spring
  service first to flush OTel-starter compatibility). Quarkus 3.33 LTS (latest
  stable is 3.40; LTS chosen for stability + Java 25). Java 25 LTS. Python 3.14.
  Postgres 17. Re-verify exact patch versions at build.
- Language selection in the stack: compose profiles (`--profile spring|quarkus|python`).
- Profiles signal: Grafana Pyroscope SDK + Pyroscope container; OTLP profiles
  covered in prose as the emerging standard.
- Chapter depth: 2,000–2,500 words of PROSE per chapter (code samples and
  diagram captions/alt-text do NOT count toward the word band).
- Delivery: local-first scaffold; GitHub repo created/pushed only after the
  Phase 1 review gate.

## Approach
Fork the structure of `observability-python-otel-lgtm` (complete reference: site
+ stack/compose + services + deck + proto + demos + examples) and generalize to
three languages. Reuse the tabbed-code include from `cloud-native-design-patterns`
(_includes/codetabs.html + assets/js/codetabs.js + .codetabs CSS) verbatim,
trimmed to Spring Boot|Quarkus|Python. One shared podman stack; three parallel
service implementations behind identical contracts. Borrow service idioms from
datamesh-reference-arch-{quarkus,python}; perf/profiling material from
{spring-boot,quarkus}-optimization.

## Site structure (5 Parts, 25 chapters; [A]=agnostic, [T]=tabbed multi-language)
Part 0 — Foundations: 00 outline [A]; 01 why observability [A]; 02 OTel
architecture [A]; 03 the LGTM stack [A]; 04 prerequisites & setup [T].
Part 1 — The demo application: 05 e-commerce domain [A]; 06 shared infrastructure
[A]; 07 service skeletons (baseline, no telemetry) [T].
Part 2 — The signals: 08 traces (auto) [T]; 09 traces (manual spans) [T]; 10
metrics [T]; 11 logs [T]; 12 baggage [T]; 13 context propagation across Kafka
[T]; 14 profiling (Pyroscope) [T]; 15 semantic conventions [A/T].
Part 3 — Making signals useful: 16 correlation [A]; 17 auto vs manual hybrid [T];
18 dashboards [A]; 19 the Collector [A]; 20 sampling [A].
Part 4 — Production concerns: 21 cardinality & cost [A]; 22 service graph & SLOs
[A]; 23 production checklist [A]; 24 what's next [A].
Every chapter: 2–2.5k prose words, ≥1 paired SVG+Excalidraw diagram, professional
voice, opentelemetry.io/docs references.

## Common infrastructure & services
One podman compose (stack/compose.yaml): grafana/otel-lgtm all-in-one
(Grafana 3000, OTLP 4317/4318, Mimir 9090, Loki 3100, Tempo 3200) + Pyroscope
(4040) + Postgres 17 + Kafka (KRaft) + kafka-ui + OTel Collector (config.yaml +
config.tail-sampling.yaml) + Grafana datasource/dashboard provisioning. Shared
`x-service-env` anchor (DATABASE_URL, KAFKA_BOOTSTRAP, OTEL_EXPORTER_OTLP_*,
OTEL_SDK_DISABLED, PROPAGATE_KAFKA_CONTEXT, PYROSCOPE_ADDRESS, DEPLOY_ENV,
SERVICE_VERSION). Domain services, three parallel impls behind identical
contracts/ports: order (REST 8080), review (GraphQL 8081), inventory (gRPC
50051), payment (gRPC 50052), shipping (Kafka consumer→producer), notification
(Kafka consumer). Shared proto/shop gRPC contract. Per-language stacks: Python
FastAPI/grpcio/Strawberry/aiokafka/asyncpg + opentelemetry-distro; Spring Boot
Web/grpc-starter/Spring GraphQL/Spring Kafka/Spring Data + OTel starter;
Quarkus RESTEasy Reactive/Quarkus gRPC/SmallRye GraphQL/SmallRye Reactive
Messaging/Hibernate Reactive Panache + quarkus-opentelemetry + Micrometer.

## Decks (4; lgtm-presentation, Red Hat brand, notes on every slide)
1. Observability & OpenTelemetry 101 (agnostic). 2. OTel 201: Spring Boot.
3. OTel 201: Quarkus. 4. OTel 201: Python.

## Dashboards (7, provisioned JSON under stack/grafana/dashboards/)
1 Service overview (RED); 2 Trace explorer / service graph; 3 Logs & correlation;
4 Kafka flow; 5 Postgres/USE; 6 Profiles (Pyroscope flame graphs); 7
Signal-correlation showcase.

## Phases (each a gated relay job)
- Phase 0 — Reading list (standalone, DONE/in-progress): add 4 books (Newman
  Building Resilient Distributed Systems; Newman Building Microservices 2e;
  Majors et al Observability Engineering; Beyer et al Site Reliability
  Engineering) to the hub books.yml + book_categories.yml; build/push/deploy.
- Phase 1 — Scaffold + shared infra (LOCAL first, gate before push): site shell
  forked from python repo; codetabs include from CND; 5 _parts + 25 _docs stubs;
  diagram engine; stack/ compose + otelcol + grafana provisioning + db init +
  proto; voice CI gate + validators. AC: jekyll build 0; 5 part cards; part/
  part_name match; codetabs renders 3 tabs; compose config valid; voice scan clean.
- Phase 2 — Agnostic chapters (00–03,05,06,15,16,18–24) to depth + diagrams.
- Phase 3 — Per-language demos + tabbed signal chapters (04,07,08–14,17) +
  examples/NN-*/<lang> + demos/*.sh; verified by OBSERVING the signal in Grafana,
  not just clean start. Build the Spring service first (4.x risk).
- Phase 4 — Decks (101 + 3×201).
- Phase 5 — Dashboards + correlation polish (7 dashboards; end-to-end signal walk).
- Phase 6 — Sunset/migration (GATED, explicit confirm): flip
  spring-boot-otel-observability-demos (and confirm quarkus-observability — a
  stale 2024 kafka starter) to PRIVATE (not deleted); keep + update
  observability-python-otel-lgtm; add it (and this tutorial) to hub sites.yml.

## Status
- [DONE] Phase 0 — reading list (4 books live on hub)
- [DONE] Phase 1 — scaffold + infra (local; Opus-validated PASS, live Grafana check):
  site shell, 6 parts, 26 chapter stubs (incl. CRC appendix), codetabs, diagram
  engine; portable compose (otel-lgtm 0.35.0 + pyroscope 2.3.2 + postgres17 +
  kafka 4.2.2 + kafka-ui + kcat) + collector(+tail-sampling) + grafana
  provisioning; devcontainer; validators + vendored voice CI gate. NOT pushed yet.
- [DONE] Phase 2 — 15 agnostic chapters (Parts 0,1,3,4) authored, diagrams, Opus-validated PASS, deployed
- [DONE] Phase 3a Spring + 3b Quarkus/Python service sets — all 5 signals verified live for all 3 languages (local-only, not pushed)
- [DONE] Phase 3c — 10 tabbed chapters (04,07,08-14,17) with real 3-language codetabs, diagrams, validated
- [DONE] Phase 4 — 4 decks (101 + Spring/Quarkus/Python 201), validated (repair round: removed fabricated Python code, voice swept)
- [ ] Phase 5 — 7 Grafana dashboards + CRC appendix (ch25)
- [ ] Phase 6 — sunset/migration (gated)
- Side workstream: create lgtm-python + lgtm-spring-boot skills (before Phase 3)
