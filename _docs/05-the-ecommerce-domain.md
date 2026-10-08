---
title: "The e-commerce domain"
order: 5
part: "The demo application"
description: "The order, inventory, payment, shipping, notification, and review services this tutorial instruments, and how a single order request moves through them."
---

Every signal this tutorial covers — a trace, a metric, a log line, a profile — only means something in the context of a system producing it. Before wiring up instrumentation, it helps to know exactly what that system does, what data it owns, and which protocol connects each pair of services. This chapter lays out the demo application: six services, four kinds of inter-service calls, one shared database, and a single customer action that fans out across all of them. Every later chapter's traces, metrics, and logs come from this domain, so the schema and protocols introduced here are the ground truth every later chapter keeps referring back to.

## Six services, one storefront

The application is a small storefront split into six domain services, each owning one responsibility:

- **order** accepts a purchase request over REST, coordinates inventory and payment, and publishes the event that the rest of the system reacts to.
- **inventory** tracks stock levels per SKU and reserves units for an order, exposed over gRPC.
- **payment** authorizes funds for an order, also over gRPC.
- **shipping** consumes order events from Kafka and creates a shipment record.
- **notification** consumes the same order events and sends a customer notification.
- **review** serves product reviews over GraphQL, independent of the order flow.

This is not a realistic e-commerce platform — there is no cart, no catalog service, no user accounts. It is sized to be a teaching instrument: enough services to produce a real distributed trace with multiple hops, enough variety in transport protocols to exercise different instrumentation libraries, and few enough moving parts that a reader can hold the whole system in their head while watching a single request propagate through it.

The variety in protocols is the more important design choice than the number of services. A production system rarely talks to every downstream dependency the same way, and the instrumentation story differs by transport: REST, gRPC, GraphQL, and Kafka each have their own semantic conventions and their own failure modes for context propagation. A tutorial that used REST everywhere would teach HTTP instrumentation four times over and never touch the messaging conventions or the extra plumbing gRPC and GraphQL instrumentation need.

## The topology: REST, gRPC, GraphQL, Kafka, and one Postgres

The order service is the entry point. A client sends `POST /orders` with a SKU, a quantity, and a customer ID. From there the request becomes synchronous twice and asynchronous once:

1. order calls inventory over **gRPC** to check and reserve stock.
2. order calls payment over **gRPC** to authorize the charge.
3. order publishes an `order.placed` event to **Kafka**, then returns a response to the client.
4. shipping and notification each consume that event independently, off the request's critical path.

Review sits outside this flow entirely. It serves `GET`-style reads over **GraphQL** against its own table, and nothing in the order path calls it or waits on it. It exists so the tutorial has a GraphQL server to instrument alongside the REST, gRPC, and Kafka surfaces — a deliberate protocol-diversity choice, not a gap in the domain model.

All six services share one Postgres database (`appdb`), seeded by `stack/db/init/01-schema.sql`. That schema is the actual contract this chapter describes, not a paraphrase of it:

- `orders` — one row per order: `order_id`, `customer_id`, `sku`, `quantity`, `amount_cents`, `status`, `created_at`. Owned by order.
- `stock` and `reservations` — `stock` tracks `on_hand` units per `sku`; `reservations` records each `reservation_id` against an `order_id`, `sku`, and `quantity`. Owned by inventory. The schema seeds three SKUs (`WIDGET-001`, `GADGET-002`, `GIZMO-003`) so a fresh stack can place an order immediately.
- `authorizations` — one row per order (`order_id` is `UNIQUE`), recording `amount_cents`, whether the charge was `authorized`, and a `customer_id`. Owned by payment.
- `shipments` — `shipment_id`, `order_id`, `sku`, `quantity`, `status`. Owned by shipping, written only after an `order.placed` event is consumed.
- `notifications` — `notification_id`, `order_id`, `channel` (`"email"`, `"sms"`), `status` (`"sent"`, `"failed"`). Owned by notification.
- `reviews` — `review_id`, `sku`, `rating`, `body`, seeded with a handful of sample reviews. Owned by review and never touched by the order flow.

A single shared database for six services is not a pattern to copy into production. It is a tutorial simplification: every service still connects to Postgres as its own client and issues its own queries, so each one still produces its own auto-instrumented database spans under whatever trace is in flight. The observability story — a span per query, attributed to the service that issued it — is identical to what you would see with six separate database instances. Isolating each domain behind its own schema or its own Postgres instance is a straightforward exercise once the instrumentation is in place, and does not change anything this tutorial measures.

{% include excalidraw.html file="ch05-order-placed-fanout" alt="Diagram of the order service accepting a REST request, calling inventory and payment over gRPC, publishing order.placed to Kafka, and shipping/notification consuming that event, with review as an independent GraphQL service, all backed by one shared Postgres database" caption="Figure 5.1 — One order request, six services, four protocols" %}

## The gRPC contracts

Inventory and payment are the two synchronous service-to-service hops, and both are defined as Protocol Buffers contracts shared from a single `proto/` directory at the repository root rather than vendored per language. Spring Boot, Quarkus, and Python each generate their own stubs from the same `.proto` source during their own build, so the three implementations are provably calling the same interface rather than three interfaces that merely look alike.

`InventoryService` exposes two RPCs:

```protobuf
service InventoryService {
  rpc CheckStock(CheckStockRequest) returns (CheckStockResponse);
  rpc Reserve(ReserveRequest) returns (ReserveResponse);
}
```

`CheckStock` is a pure read — given a `sku` and a `quantity`, it returns whether enough stock is `available` and how many units are `on_hand`. `Reserve` is the write: given an `order_id`, `sku`, and `quantity`, it returns whether the reservation succeeded, a `reservation_id`, and the `remaining` on-hand count. The contract calls out that `Reserve` is idempotent on `order_id` — retrying a reservation for the same order should not double-decrement stock, which matters once you start looking at retries and timeouts in a trace.

`PaymentService` exposes a single RPC:

```protobuf
service PaymentService {
  rpc Authorize(AuthorizeRequest) returns (AuthorizeResponse);
}
```

`Authorize` takes an `order_id`, `customer_id`, and a `Money` amount — minor units (cents) plus an ISO-4217 currency code, never a floating-point value — and returns whether the charge was `authorized`, an `authorization_id`, and a `decline_reason` that is empty on success. Like `Reserve`, `Authorize` is idempotent on `order_id`; the order service can safely retry a payment call without worrying about a duplicate charge if the first response was merely lost in transit rather than an actual failure.

These two contracts are the hops where gRPC's own context propagation matters most. Each language's gRPC instrumentation (covered starting in the [traces](08-traces-auto-instrumentation.html) chapters) attaches the order service's active trace context to the outgoing metadata automatically, so the two downstream spans — `CheckStock`/`Reserve` inside inventory, `Authorize` inside payment — show up as children of the order service's span without any manual propagation code. That automatic behavior matters to flag now because it is the behavior the Kafka hop conspicuously lacks, which is the subject of its own chapter later in the tutorial.

## REST, GraphQL, and the asynchronous edge

The order service's REST surface is kept small: `POST /orders` to place an order, `GET /orders/{id}` to look one up. That is the synchronous half of the demo, and REST instrumentation is the most mature and most automatic of the four — every language's HTTP server framework instrumentation captures method, route, and status code with no code changes from the application author.

Review's GraphQL surface is the odd one out, and for good reason. GraphQL does not map cleanly onto the `http.route` semantics that make REST easy to instrument automatically: a single `POST /graphql` endpoint can serve wildly different queries, so a trace that only records the HTTP method and path tells you nothing about which fields a client actually asked for. Each language's GraphQL instrumentation has to go one level deeper — into the query's operation name and resolver chain — to produce a span that is actually useful for understanding GraphQL request shape, cost, and latency.

The Kafka edge is where a single logical event, `order.placed`, becomes two independent consumers. The order service publishes once; shipping and notification each subscribe and process the event on their own schedule, with no coordination between them and no dependency from the order service on either one succeeding before it responds to the client. This is the fan-out this chapter's name refers to, and it is also the trickiest propagation boundary in the whole application. A gRPC call carries trace context in its request metadata without the application developer doing anything extra. A message sitting on a Kafka topic has no such built-in concept of "in-flight request metadata" — unless the producer injects trace context into the message headers and the consumer extracts it, the trace that started at `POST /orders` simply ends at the publish call, and shipping's and notification's work becomes two disconnected traces with no link back to the order that caused them. The [context propagation chapter](13-context-propagation-kafka.html) demonstrates exactly that failure and then fixes it, which is why the distinction matters here: REST's caller-to-order-service hop is typically the trace's root, the two gRPC hops propagate context with no extra wiring, and Kafka is the one hop that needs it added by hand.

## What the schema foreshadows about later signals

A few details in the schema matter now because they resurface once the tutorial gets to metrics and cardinality. Every status-like column — `orders.status`, `shipments.status`, `notifications.status`, `notifications.channel` — takes a small, fixed set of values: an order is pending, confirmed, or failed; a notification channel is `"email"` or `"sms"`. Columns like these are exactly the kind of field that is safe to turn into a metric attribute or a Grafana dashboard dimension later, because the number of distinct values stays bounded no matter how many orders flow through the system. `order_id`, `customer_id`, `reservation_id`, and `authorization_id` are the opposite case: each one is unique per row by design, which makes them well suited to log fields and span attributes — where a single value identifies one specific request — but actively dangerous as metric labels, since a metrics backend would have to track a distinct time series per unique ID and never stop growing. The [cardinality and cost chapter](21-cardinality-and-cost.html) covers this distinction in depth, but the schema itself already draws the line between the two kinds of fields before any instrumentation code gets written.

The decision to store money as `amount_cents` (`BIGINT`) rather than as a decimal or floating-point column is the same kind of foreshadowing, and it mirrors the `Money` message in `proto/shop/common/v1/common.proto`, which pairs an integer `amount_cents` with an ISO-4217 `currency` string for exactly the same reason: a trace or a log that captures a monetary amount should capture an exact integer, not a value that can drift under floating-point rounding. Keeping the database schema and the gRPC contract in agreement on this point means a reader comparing the `amount_cents` column in `orders` against the `amount` field flowing through payment's `Authorize` call is comparing the same representation end to end, with no silent unit conversion anywhere in the system.

## Why this shape, and not a simpler one

It would be easier to teach observability concepts against a single monolithic service — fewer moving parts, fewer things that can be misconfigured, fewer docker compose services to keep straight. The reason this tutorial resists that simplification is that most of what makes observability hard in practice is specifically the inter-service seams: where does a trace span a process boundary, which attributes survive that boundary, which propagation mechanisms are automatic and which require deliberate wiring. None of that is visible in a single-process demo. Four protocols and six services is close to the minimum surface area needed to show a trace crossing a REST boundary, two gRPC boundaries, and a messaging boundary, and to make the difference between those boundaries concrete instead of theoretical.

It also would have been easy to make the services richer — add a cart, a catalog, a user service, multi-item orders. Each addition would add realism without adding a new *kind* of observability problem; the tutorial already has a write path with two downstream synchronous dependencies (order → inventory, order → payment), an asynchronous fan-out (order.placed → shipping, notification), and an independent read path with a different protocol (review). Everything past that point is more of the same shape, and more services mainly mean more Compose services to keep straight on a laptop. Six is enough to show every propagation pattern this tutorial wants to teach and short enough to keep the running example legible across twenty-five chapters.

With the domain's shape and data contracts fixed, what comes next is the infrastructure all three language implementations build on top of: the one Compose stack providing Postgres, Kafka, and the full Grafana LGTM observability backend.
