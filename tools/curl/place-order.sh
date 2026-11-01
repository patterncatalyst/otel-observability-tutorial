#!/usr/bin/env bash
# Place one order through the external REST edge (the Python track's order
# service). This is the request the whole tutorial traces: it fans out to
# inventory (gRPC CheckStock), payment (gRPC Authorize), Postgres, and a Kafka
# publish of order.placed. Prints the JSON response, which includes the
# `orderId` you can feed to the other scripts.
#
#   tools/curl/place-order.sh [SKU] [QUANTITY] [CUSTOMER_ID]
#
# Seeded SKUs: WIDGET-001, GADGET-002, GIZMO-003 (see stack/db/init/01-schema.sql).
set -euo pipefail
ORDER_URL="${ORDER_URL:-http://localhost:8080}"
SKU="${1:-WIDGET-001}"
QTY="${2:-1}"
CUSTOMER="${3:-cust-42}"

curl -sS -X POST "$ORDER_URL/orders" \
  -H 'Content-Type: application/json' \
  -d "{\"customer_id\":\"$CUSTOMER\",\"sku\":\"$SKU\",\"quantity\":$QTY}" | tee /dev/stderr
echo
