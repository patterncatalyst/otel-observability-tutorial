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
# Run in a terminal, it pauses between signals and prints the Grafana URLs so you
# can open each one as it is verified. Run non-interactively (no TTY) or with
# PAUSE=0 it skips the pauses, so CI and scripted runs do not block.
#
# Endpoints on the grafana/otel-lgtm image:
#   Tempo     http://localhost:3200/api
#   Mimir     http://localhost:9090/api/v1     (NOTE: no /prometheus prefix)
#   Loki      http://localhost:3100/loki/api/v1
#   Pyroscope http://localhost:4040
# Env:
#   PAUSE     (set to 0 to disable the between-signal pauses)
set -uo pipefail

# ── Presentation helpers ──────────────────────────────────────────────
if [ -t 1 ]; then
  CYAN='\033[0;36m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BOLD='\033[1m'; RESET='\033[0m'
else
  CYAN=''; GREEN=''; YELLOW=''; BOLD=''; RESET=''
fi
hr() { printf '%0.s─' {1..64}; echo; }
pause() {
  [ "${PAUSE:-1}" = "0" ] && return 0
  [ -t 0 ] || return 0
  read -rp "$(echo -e "\n  ${YELLOW}▶ ${1:-Press Enter to continue...}${RESET}")" _ || true
  echo
}

TEMPO=http://localhost:3200
MIMIR=http://localhost:9090
LOKI=http://localhost:3100
PYRO=http://localhost:4040

echo
echo -e "${CYAN}${BOLD}"
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  DEMO: verify signals — did traces, metrics, logs & profiles land? ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo -e "${RESET}"
echo "  This queries the LGTM backend directly to prove the instrumentation"
echo "  works — run it after demos/drive-load.sh. Each section verifies one"
echo "  signal, then points you at where to see it in Grafana (http://localhost:3000)."
echo

# ── Traces ─────────────────────────────────────────────────────────────
hr
echo -e "${YELLOW}1/4 TRACES (Tempo :3200)${RESET}"
hr
echo "  A single POST /orders should produce one trace spanning the REST entry"
echo "  point, the inventory and payment gRPC calls, and the Postgres insert."
echo
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
echo -e "  ${GREEN}See it:${RESET} Grafana → Explore → Tempo (http://localhost:3200)"
pause "Press Enter to verify METRICS..."

# ── Metrics ────────────────────────────────────────────────────────────
hr
echo -e "${YELLOW}2/4 METRICS (Mimir :9090) — http server duration histogram + exemplars${RESET}"
hr
echo "  The request histogram carries exemplars — links from a latency bucket"
echo "  straight to an example trace that fell in it."
echo
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
echo -e "  ${GREEN}See it:${RESET} Grafana → Explore → Mimir (http://localhost:9090)"
pause "Press Enter to verify LOGS..."

# ── Logs ───────────────────────────────────────────────────────────────
hr
echo -e "${YELLOW}3/4 LOGS (Loki :3100) — order-spring logs carrying trace_id${RESET}"
hr
echo "  Each log line carries the trace_id as structured metadata, so a log"
echo "  jumps straight to its trace and back."
echo
NOW_NS=$(date +%s)000000000; AGO_NS=$(( $(date +%s) - 3600 ))000000000
echo "-- query {service_name=\"order-spring\"}  (trace_id arrives as structured metadata)"
curl -fsS --get "${LOKI}/loki/api/v1/query_range" \
  --data-urlencode 'query={service_name="order-spring"}' \
  --data-urlencode "start=${AGO_NS}" --data-urlencode "end=${NOW_NS}" \
  --data-urlencode 'limit=5' | sed 's/,/,\n/g' | grep -i 'trace_id\|placed\|"line"' | head -20
echo
echo -e "  ${GREEN}See it:${RESET} Grafana → Explore → Loki (http://localhost:3100)"
pause "Press Enter to verify PROFILES..."

# ── Profiles ───────────────────────────────────────────────────────────
hr
echo -e "${YELLOW}4/4 PROFILES (Pyroscope :4040)${RESET}"
hr
echo "  Continuous CPU profiles per service, correlated with traces by time and"
echo "  service name. (Pyroscope can return 503 for ~2 min after a cold start.)"
echo
echo "-- ready?"; curl -s -o /dev/null -w "   /ready -> %{http_code}\n" "${PYRO}/ready"
echo "-- label values for service_name:"
curl -fsS "${PYRO}/querier.v1.QuerierService/LabelValues" \
  -H 'content-type: application/json' \
  -d '{"name":"service_name"}' 2>/dev/null | head -c 400 || echo "   (query API probe failed; try Grafana Pyroscope datasource)"
echo
echo -e "  ${GREEN}See it:${RESET} Grafana → Explore → Pyroscope (http://localhost:4040)"
echo
hr
echo -e "${GREEN}${BOLD}✅ Done — all four signals checked. Correlate them in Grafana:${RESET}"
echo -e "  http://localhost:3000  → Explore (trace ↔ logs ↔ metrics ↔ profiles are pre-wired)"
echo
