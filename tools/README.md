# tools/

Ways to exercise the running services so there is something to look at in
Grafana — single requests, a Postman collection, and load generators. These
target the **Python track** (`services/python/`); the REST, GraphQL, and gRPC
edges are identical across the Spring Boot and Quarkus tracks, so the same
tools work against those profiles too (only the compose `--profile` differs).

Bring the stack up first:

```bash
docker compose -f stack/compose.yaml --profile python up -d --build
```

Edges these tools assume (the defaults in `stack/compose.yaml`):

| Tool target        | URL / address                          |
|--------------------|-----------------------------------------|
| Order REST         | `http://localhost:8080` (POST `/orders`, GET `/orders/{id}`) |
| Review GraphQL     | `http://localhost:8081/graphql`         |
| Inventory gRPC     | `inventory-python:50051` (internal; see ghz note) |
| Grafana            | `http://localhost:3000`                 |

The order service always returns HTTP `201`; whether payment cleared is in the
response body's `status` field (`PLACED` or `REJECTED`), and the `orderId` field
is what you feed to the other tools.

## curl — single requests

```bash
tools/curl/place-order.sh                 # place a default WIDGET-001 order, prints JSON incl. orderId
tools/curl/place-order.sh GIZMO-003 2     # specific SKU + quantity
tools/curl/get-order.sh <ORDER_ID>        # read it back (REST)
tools/curl/graphql-reviews.sh WIDGET-001  # reviews for a SKU (GraphQL)
```

A successful `place-order` produces one trace that spans the order REST handler,
the inventory and payment gRPC calls, the Postgres writes, and the Kafka publish,
plus the shipping and notification consumer spans once the `order.placed` event
is processed.

`graphql-reviews.sh` takes a **SKU**, not an order id: the review service keys
reviews by SKU (`Query.reviews(sku:)`). Seeded SKUs with reviews are
`WIDGET-001` and `GADGET-002` (see `stack/db/init/01-schema.sql`).

## Postman — a collection of the external edges

Import `postman/observability.postman_collection.json`. "Place order (REST)"
stashes the returned `orderId` in a collection variable, so "Get order" works
without copy-paste. "Place order — payment declined" pushes the quantity over
the payment ceiling (over 40,000 units at 2500 cents each exceeds the
$1,000,000 ceiling) to generate a `REJECTED` order and an error path on demand.
"Reviews by SKU (GraphQL)" reads reviews for the `sku` collection variable.

## Load generators

Both load generators are optional and require a tool on your PATH:

- **`hey`** — HTTP load. Install: `go install github.com/rakyll/hey@latest`
  (or your package manager).
- **`ghz`** — gRPC load. Install: <https://ghz.sh/docs/install>.

```bash
tools/load/hey-orders.sh 500 20      # 500 REST orders, concurrency 20
tools/load/ghz-inventory.sh 2000 50  # 2000 gRPC CheckStock calls, concurrency 50
```

`hey` drives the REST edge end to end. `ghz` drives the inventory gRPC service
directly using the shared proto (`proto/shop/inventory/v1/inventory.proto`),
which is handy when you want one service's RED metrics and spans in isolation.

**ghz networking:** inventory's gRPC port (`50051`) is internal to the compose
network and is not published on the host by default. To reach it from the host,
either add a `- "50051:50051"` mapping to the `inventory-python` service in
`stack/compose.yaml`, or run ghz from inside the network
(`docker run --network otel-observability-tutorial ...`). With a published port,
the default `INVENTORY_ADDR=localhost:50051` works directly.
