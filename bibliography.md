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

<table class="bib bib--books">
  <colgroup><col style="width:62%"><col style="width:24%"><col style="width:14%"></colgroup>
  <thead><tr><th>Title</th><th>Author(s)</th><th>Year</th></tr></thead>
  <tbody>
    <tr><td><a href="https://www.oreilly.com/library/view/observability-engineering/9781492076438/" rel="noopener"><em>Observability Engineering</em></a><br><small>O'Reilly. Observability as a discipline: high-cardinality, structured, correlated signals</small></td><td>Charity Majors, Liz Fong-Jones, George Miranda</td><td>2022</td></tr>
    <tr><td><a href="https://www.oreilly.com/library/view/site-reliability-engineering/9798341607675/" rel="noopener"><em>Site Reliability Engineering</em></a><br><small>O'Reilly. SLOs, error budgets, and alerting that pages the right person</small></td><td>Betsy Beyer, Chris Jones, Jennifer Petoff, Niall Richard Murphy (eds.)</td><td>2016</td></tr>
    <tr><td><a href="https://www.oreilly.com/library/view/building-resilient-distributed/9781098163532/" rel="noopener"><em>Building Resilient Distributed Systems</em></a><br><small>O'Reilly. Patterns for systems that survive partial failure</small></td><td>O'Reilly</td><td>2024</td></tr>
  </tbody>
</table>

## Primary references

The tutorial follows the current specifications and project documentation for
the tools it uses. These are the authoritative sources to check against:

- [OpenTelemetry documentation](https://opentelemetry.io/docs/): the specification, SDKs, and semantic conventions for traces, metrics, logs, and profiles.
- [Grafana LGTM stack](https://grafana.com/oss/): Loki (logs), Grafana (dashboards), Tempo (traces), Mimir (metrics), and Pyroscope (profiles).
- [Prometheus documentation](https://prometheus.io/docs/): the metrics model, PromQL, and exposition format.

These titles inform this tutorial's coverage and rigor only: nothing in these
chapters or the runnable demos copies text or code from them.
