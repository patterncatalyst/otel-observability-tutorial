#!/usr/bin/env bash
# demos/verify-signals.sh
#
# Queries the LGTM backend APIs to confirm each signal landed. Run AFTER
# demos/drive-load.sh has placed some orders. This observes the *effect* of the
# instrumentation rather than trusting that the services started.
#
# Signals checked:
#   traces   (Tempo)     — a trace for order-spring spanning REST -> gRPC -> DB
#   metrics  (Mimir)     — http server duration histogram + exemplars
#   logs     (Loki)      — order-spring logs carrying trace_id
#   profiles (Pyroscope) — a CPU profile for a spring service
#
# Endpoints on the grafana/otel-lgtm image:
#   Tempo     http://localhost:3200/api
#   Mimir     http://localhost:9090/api/v1     (NOTE: no /prometheus prefix)
#   Loki      http://localhost:3100/loki/api/v1
#   Pyroscope http://localhost:4040
set -uo pipefail

TEMPO=http://localhost:3200
MIMIR=http://localhost:9090
LOKI=http://localhost:3100
PYRO=http://localhost:4040

echo "============================================================"
echo "TRACES (Tempo)"
echo "============================================================"
# TraceQL search for order-spring traces in the last hour.
echo "-- search { resource.service.name = \"order-spring\" }"
curl -fsS --get "${TEMPO}/api/search" \
  --data-urlencode 'q={ resource.service.name = "order-spring" }' \
  --data-urlencode 'limit=3' | sed 's/,/,\n/g' | head -40
echo
echo "-- fetch the first matching trace and list its span service.names"
TID=$(curl -fsS --get "${TEMPO}/api/search" \
  --data-urlencode 'q={ resource.service.name = "order-spring" }' \
  --data-urlencode 'limit=1' | grep -o '"traceID":"[0-9a-f]*"' | head -1 | cut -d'"' -f4)
echo "traceID=${TID}"
if [ -n "${TID}" ]; then
  curl -fsS "${TEMPO}/api/traces/${TID}" \
    | grep -o '"stringValue":"[a-z-]*spring"' | sort -u
  echo "(span count: $(curl -fsS "${TEMPO}/api/traces/${TID}" | grep -o '"spanId"' | wc -l))"
  echo "-- cart.id baggage attribute present on a span?"
  curl -fsS "${TEMPO}/api/traces/${TID}" | grep -o '"key":"cart.id"[^}]*}[^}]*}' | head -1 || echo "   (none found in this trace)"
fi

echo
echo "============================================================"
echo "METRICS (Mimir) — http server duration histogram + exemplars"
echo "============================================================"
echo "-- series names matching http_server (sample):"
curl -fsS --get "${MIMIR}/api/v1/label/__name__/values" | tr ',' '\n' | grep -i 'http_server\|orders_placed' | head
echo "-- instant query: request count for order-spring"
curl -fsS --get "${MIMIR}/api/v1/query" \
  --data-urlencode 'query=count by (job,service_name) ({__name__=~"http.server.*|http_server.*"})' | head -c 600
echo
echo "-- exemplars on the http server duration histogram (last 1h):"
NOW=$(date +%s); AGO=$((NOW-3600))
curl -fsS --get "${MIMIR}/api/v1/query_exemplars" \
  --data-urlencode 'query={__name__=~"http_server_request_duration_seconds_bucket|http_server_duration_milliseconds_bucket"}' \
  --data-urlencode "start=${AGO}" --data-urlencode "end=${NOW}" | head -c 800
echo

echo
echo "============================================================"
echo "LOGS (Loki) — order-spring logs carrying trace_id"
echo "============================================================"
NOW_NS=$(date +%s)000000000; AGO_NS=$(( $(date +%s) - 3600 ))000000000
echo "-- query {service_name=\"order-spring\"}  (trace_id arrives as structured metadata)"
curl -fsS --get "${LOKI}/loki/api/v1/query_range" \
  --data-urlencode 'query={service_name="order-spring"}' \
  --data-urlencode "start=${AGO_NS}" --data-urlencode "end=${NOW_NS}" \
  --data-urlencode 'limit=5' | sed 's/,/,\n/g' | grep -i 'trace_id\|placed\|"line"' | head -20
echo

echo
echo "============================================================"
echo "PROFILES (Pyroscope)"
echo "============================================================"
echo "-- ready?"; curl -s -o /dev/null -w "   /ready -> %{http_code}\n" "${PYRO}/ready"
echo "-- label values for service_name:"
curl -fsS "${PYRO}/querier.v1.QuerierService/LabelValues" \
  -H 'content-type: application/json' \
  -d '{"name":"service_name"}' 2>/dev/null | head -c 400 || echo "   (query API probe failed; try Grafana Pyroscope datasource)"
echo
echo "Done."
