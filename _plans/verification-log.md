---
title: "Verification log"
layout: plan
---

Verification-status notes removed from reader-facing chapters (site chrome shows reader content only; banked here in the unrendered plans collection).

## 14-profiling

**Verification status:** all six domain services across Spring Boot, Quarkus, and Python were run with `PYROSCOPE_ADDRESS` set, driven with sample load, and confirmed to produce `process_cpu` flame graphs in Pyroscope and in Grafana's Pyroscope datasource view. The Quarkus LogManager ordering issue was reproduced with the flag removed (silently broken log configuration, no exception) and confirmed fixed with the flag restored.

