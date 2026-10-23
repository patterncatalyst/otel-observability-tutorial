---
title: "Bibliography"
layout: plan
permalink: /bibliography/
description: "The reference books this tutorial's coverage and rigor draw on. Nothing here is copied from them."
---

This tutorial's chapter arc, signal coverage, and level of rigor draw on a
small set of books on observability and reliability. They are reference works,
not sources: no text or code from any of them is reproduced here. If a topic in
this tutorial is useful to you, these are where to go deeper.

| Title | Author(s) | Publisher | Year | Focus |
|---|---|---|---|---|
| [*Observability Engineering*](https://www.oreilly.com/library/view/observability-engineering/9781492076438/) | Charity Majors, Liz Fong-Jones, George Miranda | O'Reilly | 2022 | Observability as a discipline: high-cardinality, structured, correlated signals |
| [*Site Reliability Engineering*](https://www.oreilly.com/library/view/site-reliability-engineering/9798341607675/) | Betsy Beyer, Chris Jones, Jennifer Petoff, Niall Richard Murphy (eds.) | O'Reilly | 2016 | SLOs, error budgets, and alerting that pages the right person |
| [*Building Resilient Distributed Systems*](https://www.oreilly.com/library/view/building-resilient-distributed/9781098163532/) | O'Reilly | O'Reilly | 2024 | Patterns for systems that survive partial failure |

## Primary references

The tutorial follows the current specifications and project documentation for
the tools it uses. These are the authoritative sources to check against:

- [OpenTelemetry documentation](https://opentelemetry.io/docs/): the specification, SDKs, and semantic conventions for traces, metrics, logs, and profiles.
- [Grafana LGTM stack](https://grafana.com/oss/): Loki (logs), Grafana (dashboards), Tempo (traces), Mimir (metrics), and Pyroscope (profiles).
- [Prometheus documentation](https://prometheus.io/docs/): the metrics model, PromQL, and exposition format.

These titles inform this tutorial's coverage and rigor only: nothing in these
chapters or the runnable demos copies text or code from them.
