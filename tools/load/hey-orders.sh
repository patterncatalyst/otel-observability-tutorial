#!/usr/bin/env bash
# Drive load at the REST edge with `hey` so there are enough traces, RED metrics,
# and logs to look at in Grafana. Hits the Python track's order service at
# POST /orders with valid WIDGET-001 orders.
#
#   tools/load/hey-orders.sh [REQUESTS] [CONCURRENCY]
#
# Install hey:  go install github.com/rakyll/hey@latest   (or your package manager)
set -euo pipefail
ORDER_URL="${ORDER_URL:-http://localhost:8080}"
N="${1:-500}"
C="${2:-20}"

command -v hey >/dev/null || { echo "hey not found — see comment in this script"; exit 1; }

echo "Load: $N requests, concurrency $C, against $ORDER_URL/orders"
hey -n "$N" -c "$C" -m POST \
  -H 'Content-Type: application/json' \
  -d '{"customer_id":"load","sku":"WIDGET-001","quantity":1}' \
  "$ORDER_URL/orders"
