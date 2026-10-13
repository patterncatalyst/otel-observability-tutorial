#!/usr/bin/env bash
# demos/drive-load.sh
#
# Drives load against the running service set so every signal has something to
# show in Grafana:
#   - POST /orders (order REST -> inventory+payment gRPC -> Postgres -> Kafka)
#   - GET /orders/{id}
#   - a GraphQL reviews query + an addReview mutation against the review service
#
# Each order carries a distinct cart id, set as OTel baggage by the order
# service and propagated downstream (visible as the cart.id span attribute on
# inventory/payment).
#
# Run in a terminal, it pauses between steps and prints the Grafana/LGTM URLs so
# you can follow the telemetry live. Run non-interactively (no TTY) or with
# PAUSE=0 it skips the pauses, so CI and scripted runs do not block.
#
# Usage:
#   demos/drive-load.sh [N_ORDERS]
# Env:
#   ORDER_URL   (default http://localhost:8080)
#   REVIEW_URL  (default http://localhost:8081)
#   PAUSE       (set to 0 to disable the between-step pauses)
set -euo pipefail

# ── Presentation helpers ──────────────────────────────────────────────
if [ -t 1 ]; then
  CYAN='\033[0;36m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BOLD='\033[1m'; RESET='\033[0m'
else
  CYAN=''; GREEN=''; YELLOW=''; BOLD=''; RESET=''
fi
hr() { printf '%0.s─' {1..64}; echo; }
pause() {
  # Pause for the presenter between steps — only when attached to a terminal
  # and not explicitly disabled with PAUSE=0.
  [ "${PAUSE:-1}" = "0" ] && return 0
  [ -t 0 ] || return 0
  read -rp "$(echo -e "\n  ${YELLOW}▶ ${1:-Press Enter to continue...}${RESET}")" _ || true
  echo
}
lgtm_urls() {
  echo -e "  ${GREEN}Grafana:${RESET}   http://localhost:3000   (anonymous admin — no login)"
  echo -e "  ${GREEN}Tempo:${RESET}     http://localhost:3200   traces    → Grafana → Explore → Tempo"
  echo -e "  ${GREEN}Mimir:${RESET}     http://localhost:9090   metrics   → Grafana → Explore → Mimir"
  echo -e "  ${GREEN}Loki:${RESET}      http://localhost:3100   logs      → Grafana → Explore → Loki"
  echo -e "  ${GREEN}Pyroscope:${RESET} http://localhost:4040   profiles  → Grafana → Explore → Pyroscope"
}

ORDER_URL="${ORDER_URL:-http://localhost:8080}"
REVIEW_URL="${REVIEW_URL:-http://localhost:8081}"
N="${1:-5}"
SKUS=(WIDGET-001 GADGET-002 GIZMO-003)

echo
echo -e "${CYAN}${BOLD}"
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  DEMO: drive load — one storefront, four protocols, all signals ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo -e "${RESET}"
echo "  Every POST /orders fans out across the system and lights up one"
echo "  distributed trace, the request metrics, the services' logs, and a"
echo "  CPU profile — all correlated in Grafana:"
echo
echo -e "    order ${BOLD}REST${RESET} → inventory ${BOLD}gRPC${RESET} + payment ${BOLD}gRPC${RESET} → Postgres → ${BOLD}Kafka${RESET} order.placed"
echo "    → shipping + notification consume it; review serves GraphQL on the side"
echo
echo "  order:  ${ORDER_URL}    review: ${REVIEW_URL}"
echo

# ── Step 1: wait for the order service ────────────────────────────────
hr
echo -e "${YELLOW}Step 1: Waiting for the order service at ${ORDER_URL}${RESET}"
hr
for i in $(seq 1 60); do
  if curl -fsS "${ORDER_URL}/actuator/health" >/dev/null 2>&1; then break; fi
  echo -n "."; sleep 2
done
echo -e "  ${GREEN}✅ order service is up${RESET}"
echo
echo -e "  ${BOLD}Where the telemetry lands:${RESET}"
lgtm_urls
pause "Press Enter to place ${N} orders..."

# ── Step 2: place orders ──────────────────────────────────────────────
hr
echo -e "${YELLOW}Step 2: Placing ${N} orders (each starts a new trace)${RESET}"
hr
echo "  Each order uses a distinct cart id, set as OTel baggage and propagated"
echo "  downstream — look for the cart.id attribute on inventory/payment spans."
echo
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
pause "Press Enter to read the orders back..."

# ── Step 3: read orders back ──────────────────────────────────────────
hr
echo -e "${YELLOW}Step 3: Reading orders back (GET /orders/{id})${RESET}"
hr
echo "  Each read is its own short trace — a REST span plus the Postgres query."
echo
for id in "${IDS[@]:-}"; do
  [ -n "$id" ] || continue
  echo "   $(curl -fsS "${ORDER_URL}/orders/${id}")"
done
pause "Press Enter to exercise the GraphQL review service..."

# ── Step 4: GraphQL ───────────────────────────────────────────────────
hr
echo -e "${YELLOW}Step 4: GraphQL against the review service${RESET}"
hr
echo "  review sits outside the order flow — it gives GraphQL its own traces."
echo
echo -e "  ${CYAN}query reviews(sku: \"WIDGET-001\")${RESET}"
curl -fsS -X POST "${REVIEW_URL}/graphql" \
    -H 'Content-Type: application/json' \
    -d '{"query":"{ reviews(sku:\"WIDGET-001\"){ id sku rating body } }"}'
echo
echo -e "  ${CYAN}mutation addReview(sku: \"GIZMO-003\")${RESET}"
curl -fsS -X POST "${REVIEW_URL}/graphql" \
    -H 'Content-Type: application/json' \
    -d '{"query":"mutation{ addReview(sku:\"GIZMO-003\", rating:5, body:\"Great gizmo\"){ id sku rating } }"}'
echo

# ── Done ──────────────────────────────────────────────────────────────
echo
hr
echo -e "${GREEN}${BOLD}✅ Load generated. Explore it in Grafana:${RESET}"
hr
lgtm_urls
echo
echo "  Next: demos/verify-signals.sh confirms each signal landed in the backend."
echo
