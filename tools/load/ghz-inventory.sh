#!/usr/bin/env bash
# Put load directly on the inventory gRPC service with `ghz`, bypassing the order
# service — useful for seeing one service's spans/metrics in isolation. Uses the
# shared proto at proto/ so ghz knows the message shape.
#
#   tools/load/ghz-inventory.sh [REQUESTS] [CONCURRENCY]
#
# Install ghz:  https://ghz.sh/docs/install
#
# Note: inventory's gRPC port (50051) is internal to the compose network and is
# NOT published on the host by default (see stack/compose.yaml — the inventory
# services have no `ports:`). To hit it from the host either add a
# `- "50051:50051"` port mapping to the inventory-python service, or run ghz
# from inside the network:
#
#   docker run --rm --network otel-observability-tutorial -v "$PWD/proto:/proto" \
#     fullstorydev/grpcurl ...        # (any image with ghz/grpc tooling)
#
# With a published port, INVENTORY_ADDR=localhost:50051 works directly.
set -euo pipefail
INVENTORY_ADDR="${INVENTORY_ADDR:-localhost:50051}"
N="${1:-2000}"
C="${2:-50}"
REPO_ROOT="$(git rev-parse --show-toplevel)"

command -v ghz >/dev/null || { echo "ghz not found — see https://ghz.sh/docs/install"; exit 1; }

ghz --insecure \
  --proto "$REPO_ROOT/proto/shop/inventory/v1/inventory.proto" \
  --import-paths "$REPO_ROOT/proto" \
  --call shop.inventory.v1.InventoryService.CheckStock \
  -d '{"sku":"WIDGET-001","quantity":1}' \
  -n "$N" -c "$C" \
  "$INVENTORY_ADDR"
