#!/usr/bin/env bash
# demos/drive-load.sh
#
# Drives load against the running Spring Boot service set so every signal has
# something to show in Grafana:
#   - POST /orders (order REST -> inventory+payment gRPC -> Postgres -> Kafka)
#   - GET /orders/{id}
#   - a GraphQL reviews query + an addReview mutation against the review service
#
# Each order carries a distinct cart id, set as OTel baggage by the order
# service and propagated downstream (visible as the cart.id span attribute on
# inventory/payment).
#
# Usage:
#   demos/drive-load.sh [N_ORDERS]
# Env:
#   ORDER_URL   (default http://localhost:8080)
#   REVIEW_URL  (default http://localhost:8081)
set -euo pipefail

ORDER_URL="${ORDER_URL:-http://localhost:8080}"
REVIEW_URL="${REVIEW_URL:-http://localhost:8081}"
N="${1:-5}"
SKUS=(WIDGET-001 GADGET-002 GIZMO-003)

echo ">> Waiting for order service at ${ORDER_URL} ..."
for i in $(seq 1 60); do
  if curl -fsS "${ORDER_URL}/actuator/health" >/dev/null 2>&1; then break; fi
  sleep 2
done

echo ">> Placing ${N} orders"
IDS=()
for i in $(seq 1 "${N}"); do
  sku="${SKUS[$(( (i - 1) % ${#SKUS[@]} ))]}"
  cart="cart-$(printf '%04x' $RANDOM)"
  body=$(printf '{"customerId":"cust-%03d","sku":"%s","quantity":%d,"cartId":"%s"}' "$i" "$sku" "$(( (i % 3) + 1 ))" "$cart")
  resp=$(curl -fsS -X POST "${ORDER_URL}/orders" \
      -H 'Content-Type: application/json' \
      -H "X-Cart-Id: ${cart}" \
      -d "${body}")
  echo "   placed: ${resp}"
  id=$(printf '%s' "$resp" | sed -n 's/.*"orderId"[: ]*"\([^"]*\)".*/\1/p')
  [ -n "$id" ] && IDS+=("$id")
  sleep 0.3
done

echo ">> Reading orders back (GET /orders/{id})"
for id in "${IDS[@]:-}"; do
  [ -n "$id" ] || continue
  echo "   $(curl -fsS "${ORDER_URL}/orders/${id}")"
done

echo ">> GraphQL: query reviews for WIDGET-001"
curl -fsS -X POST "${REVIEW_URL}/graphql" \
    -H 'Content-Type: application/json' \
    -d '{"query":"{ reviews(sku:\"WIDGET-001\"){ id sku rating body } }"}'
echo

echo ">> GraphQL: addReview mutation"
curl -fsS -X POST "${REVIEW_URL}/graphql" \
    -H 'Content-Type: application/json' \
    -d '{"query":"mutation{ addReview(sku:\"GIZMO-003\", rating:5, body:\"Great gizmo\"){ id sku rating } }"}'
echo

echo ">> Done. Explore in Grafana at http://localhost:3000"
