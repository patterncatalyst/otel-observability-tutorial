#!/usr/bin/env bash
# Query product reviews for a SKU through the GraphQL read edge (the Python
# track's review service). Each resolver opens its own span, so this single
# POST shows up as a resolver tree in Tempo.
#
#   tools/curl/graphql-reviews.sh [SKU]
#
# The review service keys reviews by SKU (Query.reviews(sku:)), not by order id,
# so pass a SKU — the same one you ordered with place-order.sh. Seeded SKUs with
# reviews: WIDGET-001, GADGET-002 (see stack/db/init/01-schema.sql).
set -euo pipefail
REVIEW_URL="${REVIEW_URL:-http://localhost:8081}"
SKU="${1:-WIDGET-001}"
read -r -d '' QUERY <<GQL || true
{ "query": "{ reviews(sku: \"$SKU\") { id sku rating body } }" }
GQL
curl -sS -X POST "$REVIEW_URL/graphql" \
  -H 'Content-Type: application/json' \
  -d "$QUERY"
echo
