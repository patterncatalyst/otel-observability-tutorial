#!/usr/bin/env bash
# Fetch an order by id from the REST edge (the Python track's order service).
# Pass the `orderId` printed by place-order.sh.
#   tools/curl/get-order.sh <ORDER_ID>
set -euo pipefail
ORDER_URL="${ORDER_URL:-http://localhost:8080}"
ORDER_ID="${1:?usage: get-order.sh <ORDER_ID>}"
curl -sS "$ORDER_URL/orders/$ORDER_ID"
echo
