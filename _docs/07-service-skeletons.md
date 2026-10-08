---
title: "Service skeletons"
order: 7
part: "The demo application"
description: "The order, inventory, payment, review, shipping, and notification services running with telemetry off — REST, gRPC, GraphQL, and Kafka in their plainest form, before Part 3 turns the signals on."
---

Chapter 5 described six services and four protocols. Chapter 6 brought up the infrastructure they all share. This chapter is where those services actually run for the first time — in all three languages, with every one of this book's observability signals switched off. [`OTEL_SDK_DISABLED=true`](https://opentelemetry.io/docs/specs/otel/configuration/sdk-environment-variables/) is the single toggle that makes that true: every service in this repository ships with its tracing, metrics, and logging code already written, because Spring Boot, Quarkus, and Python each need that code built the same way regardless of when in the book it gets switched on. What this chapter changes is not the code, but whether the SDK behind that code does anything at all.

That distinction matters more than it sounds. A tutorial that showed you a separate, hand-trimmed "before" version of each service — with the OpenTelemetry imports deleted, the Java agent left off the classpath, the `opentelemetry-instrument` wrapper removed from the entrypoint — would be lying about how real migrations happen. Nobody instruments a production service by writing it twice. They flip a switch, point an SDK at a collector, and start seeing data from code that was already running. This chapter's baseline is that same flip in the off position: one codebase, one environment variable, nothing landing in Grafana.

## What "uninstrumented" means for three different runtimes

The three languages turn telemetry off through three different mechanisms, and understanding each one now saves confusion later, once Part 3 starts turning them back on signal by signal.

Spring Boot attaches the OpenTelemetry Java agent unconditionally at container startup — `entrypoint.sh` always appends `-javaagent:/deployments/agents/opentelemetry-javaagent.jar` to the JVM's launch flags. The agent itself reads `OTEL_SDK_DISABLED` from the environment at boot and, when it's `true`, no-ops: it still loads, but it registers no instrumentation, exports nothing, and adds no measurable overhead beyond the one-time classload. The jar is present either way; whether it does anything is a runtime decision, not a build-time one.

Quarkus takes the opposite approach architecturally, but lands on the same runtime behavior. There is no Java agent in the Quarkus Containerfile at all: `quarkus-opentelemetry` and `quarkus-micrometer-opentelemetry` are regular Maven dependencies, compiled into the application at build time rather than attached as an external agent. The extension's own SDK bootstrap reads the same `OTEL_SDK_DISABLED` environment variable Spring Boot's agent does, and skips provider registration when it's set. The mechanism differs — build-time weaving instead of a runtime agent — but the observable outcome is identical.

Python has no bytecode-weaving agent in the Java sense, so `obs/otel.py`'s `setup()` function checks `OTEL_SDK_DISABLED` explicitly as its first real decision:

```python
if cfg.disabled:
    # Baseline demo: the SDK is off, the service is fully opaque on purpose.
    _TRACER = trace.get_tracer(service_name)
    _METER = metrics.get_meter(service_name)
    return cfg
```

Calling `trace.get_tracer()` without ever calling `trace.set_tracer_provider()` hands back OpenTelemetry's default no-op tracer — every span-creation call in the codebase still runs, but produces an object that does nothing and exports nothing. This is a useful detail on its own: it means application code never has to branch on whether telemetry is enabled. The same `with tracer().start_as_current_span(...)` line executes identically whether `_TRACER` is a real tracer wired to an OTLP exporter or the inert default, which is exactly the property that lets one codebase serve both states.

{% include excalidraw.html file="ch07-service-skeletons" alt="The six domain services grouped by protocol: order over REST, inventory and payment over gRPC, review over GraphQL, shipping and notification consuming order.placed from Kafka, all running with OTEL_SDK_DISABLED=true, each still reading and writing Postgres and Kafka correctly, with dashed amber arrows showing nothing reaching Grafana" caption="Figure 7.1 — Same code path every later chapter instruments, telemetry off rather than absent" %}

## REST: the order service

`order` is the entry point for the one user action this entire tutorial traces: `POST /orders` takes a SKU, a quantity, and a customer ID, checks stock, authorizes a charge, writes a row, and publishes an event. With the SDK disabled, every one of those steps still happens — a reader hitting the endpoint sees `201 Created` and a real order row in Postgres, with no indication from the response itself that anything observability-related is even possible. That is the point: the business behavior of the system does not depend on whether OpenTelemetry is switched on, which is what makes it credible to add instrumentation *after* a service already works, the way most real services get instrumented in practice.

Stripped to its REST-and-business-logic core (the gRPC and database calls, not the telemetry calls layered on in later chapters), the shape is the same across all three languages: validate the request, call inventory, call payment if stock was available, insert an order row with whatever status resulted, publish an event if the order was placed, and respond. Spring Boot expresses this as a `@RestController` method using `JdbcClient` and a blocking gRPC stub; Quarkus expresses the same sequence with a JAX-RS resource, a raw `DataSource`/`PreparedStatement` pair, and a Mutiny-based async gRPC stub; Python expresses it as a FastAPI route handler using `asyncpg` and `grpcio`'s async client.

{% include codetabs.html langs="Spring Boot|Quarkus|Python" %}

```java
// services/spring/order/.../OrderController.java
@PostMapping("/orders")
public ResponseEntity<OrderResponse> createOrder(@Valid @RequestBody OrderRequest request,
        @RequestHeader(value = "X-Cart-Id", required = false) String cartIdHeader) {
    String orderId = UUID.randomUUID().toString();
    long amountCents = request.quantity() * UNIT_PRICE_CENTS;

    boolean available = checkStockWithRetry(request.sku(), request.quantity());
    boolean authorized = available && authorizeWithRetry(orderId, request.customerId(), amountCents);
    String status = (available && authorized) ? "PLACED" : "REJECTED";

    insertOrder(orderId, request, amountCents, status);
    if ("PLACED".equals(status)) {
        publishOrderPlaced(new OrderPlacedEvent(orderId, request.customerId(), request.sku(),
                request.quantity(), amountCents, status, cartId));
    }
    return ResponseEntity.status(HttpStatus.CREATED)
            .body(new OrderResponse(orderId, request.customerId(), request.sku(),
                    request.quantity(), amountCents, status));
}
```
```java
// services/quarkus/order/.../OrderResource.java
@POST
@Consumes(MediaType.APPLICATION_JSON)
@Produces(MediaType.APPLICATION_JSON)
public Response createOrder(@Valid OrderRequest request,
        @HeaderParam("X-Cart-Id") String cartIdHeader) throws SQLException {
    String orderId = UUID.randomUUID().toString();
    long amountCents = request.quantity() * UNIT_PRICE_CENTS;

    boolean available = checkStockWithRetry(request.sku(), request.quantity());
    boolean authorized = available && authorizeWithRetry(orderId, request.customerId(), amountCents);
    String status = (available && authorized) ? "PLACED" : "REJECTED";

    insertOrder(orderId, request, amountCents, status);
    if ("PLACED".equals(status)) {
        publishOrderPlaced(new OrderPlacedEvent(orderId, request.customerId(), request.sku(),
                request.quantity(), amountCents, status, cartId));
    }
    return Response.status(Response.Status.CREATED)
            .entity(new OrderResponse(orderId, request.customerId(), request.sku(),
                    request.quantity(), amountCents, status))
            .build();
}
```
```python
# services/python/order/src/order/main.py
@app.post("/orders", status_code=201)
async def create_order(body: CreateOrderRequest, request: Request) -> dict:
    order_id = str(uuid.uuid4())
    amount_cents = body.quantity * UNIT_PRICE_CENTS

    available = await _check_stock_with_retry(app.state.clients, body.sku, body.quantity)
    authorized = available and await _authorize_with_retry(
        app.state.clients, order_id, body.customer_id, amount_cents
    )
    status = "PLACED" if (available and authorized) else "REJECTED"

    await repo.insert_order(order_id, body.customer_id, body.sku, body.quantity, amount_cents, status)
    if status == "PLACED":
        await obskafka.publish_event(app.state.producer, ORDER_PLACED_TOPIC, key=order_id, value={
            "orderId": order_id, "customerId": body.customer_id, "sku": body.sku,
            "quantity": body.quantity, "amountCents": amount_cents, "status": status,
        })
    return {"orderId": order_id, "customerId": body.customer_id, "sku": body.sku,
            "quantity": body.quantity, "amountCents": amount_cents, "status": status}
```

The retry helpers wrapped around the inventory and payment calls (`checkStockWithRetry`, `authorizeWithRetry`) matter even at this stage: five attempts with a one-second delay between them, implemented identically in all three languages. That retry loop exists because gRPC services in this tutorial can be mid-restart when a request arrives — a real-world condition, not a testing artifact — and it means a `POST /orders` call can take several seconds to fail if inventory or payment stays unreachable through every attempt. Keep that in mind once Part 3 starts looking at span durations; a five-second span around a gRPC call usually means every retry fired, not that a single call was slow.

## gRPC: inventory and payment

Inventory and payment are the two synchronous downstream calls order makes, both defined from the same shared `.proto` contracts described in Chapter 5. `inventory` exposes `CheckStock` and `Reserve`; `payment` exposes `Authorize`. With telemetry off, a gRPC call here is just a gRPC call — a request message in, a response message out, a Postgres query in between — with none of the span-per-RPC behavior that automatic instrumentation adds once the SDK is live.

```java
// services/spring/inventory/.../InventoryServiceImpl.java
@Override
public void checkStock(CheckStockRequest request, StreamObserver<CheckStockResponse> responseObserver) {
    Integer onHand = jdbcClient.sql("SELECT on_hand FROM stock WHERE sku = :sku")
            .param("sku", request.getSku())
            .query(Integer.class)
            .optional()
            .orElse(null);
    boolean available = onHand != null && onHand >= request.getQuantity();
    responseObserver.onNext(CheckStockResponse.newBuilder()
            .setAvailable(available)
            .setOnHand(onHand != null ? onHand : 0)
            .build());
    responseObserver.onCompleted();
}
```

Quarkus implements the identical RPC as a `@GrpcService` returning a Mutiny `Uni` rather than calling back on a `StreamObserver`, and Python implements it as an `async def` method on a `grpc.aio`-based servicer — three idioms for "read the request, query Postgres, build the response," none of which differ in what they do to the database or the wire. `Reserve` is the more interesting of the two RPCs in inventory: it's written to be idempotent on `(order_id, sku)`, checking for an existing reservation before inserting a new one and decrementing `on_hand`, specifically so that the retry loop in the order service's `checkStockWithRetry`/`authorizeWithRetry` pattern can safely re-send the same request without double-reserving stock or double-charging a card. That idempotency is a correctness property of the business logic, visible and testable with the SDK fully disabled — nothing about it depends on tracing being on.

Payment follows the identical shape as inventory one RPC over: a single `Authorize` method that reads the requested `order_id`, `customer_id`, and `amount`, writes a row to the `authorizations` table keyed uniquely on `order_id`, and returns whether the charge was authorized. There's no real payment processor behind it — authorization always succeeds in this tutorial, so a reader's trace through the system reliably reaches the `PLACED` branch without needing to simulate a card network. The `authorizations` table's `UNIQUE` constraint on `order_id` gives payment the same idempotency property `Reserve` gives inventory: a retried `Authorize` call for the same order returns the existing authorization rather than creating a second one, which is what lets the order service's five-attempt retry loop call it safely without double-charging anything.

## GraphQL: review

Review is the one service with no role in the order flow at all. It serves reads and writes against the `reviews` table over GraphQL, exactly as Chapter 5 described, and nothing in `order`, `inventory`, or `payment` calls it or waits on it. Spring Boot implements its resolvers as `@QueryMapping`/`@MutationMapping` methods on a `@Controller`. Quarkus implements the same three operations (`reviews(sku)`, `review(id)`, `addReview(sku, rating, body)`) as a SmallRye GraphQL `@GraphQLApi` class. Python implements them as Strawberry `@strawberry.field` resolvers mounted into FastAPI through `GraphQLRouter`. All three read the same four columns from the same table and expose the same schema shape.

```python
# services/python/review/src/review/main.py
@strawberry.type
class Query:
    @strawberry.field
    async def reviews(self, sku: Optional[str] = None) -> List[Review]:
        pool = await db.get_pool()
        if sku:
            rows = await pool.fetch(f"SELECT {SELECT_FIELDS} FROM reviews WHERE sku = $1", sku)
        else:
            rows = await pool.fetch(f"SELECT {SELECT_FIELDS} FROM reviews")
        return [_row_to_review(r) for r in rows]
```

Review belongs in this tour for a reason that only becomes visible once Part 3 turns the signals on: automatic HTTP instrumentation sees a GraphQL server as one `POST /graphql` endpoint, because that's all GraphQL looks like at the transport layer — one URL, one HTTP method, a JSON body carrying an arbitrary query. It cannot see that a single request actually asked for `reviews(sku: "WIDGET-001")` and not `addReview(...)`, because that distinction lives inside the request body, not in anything an HTTP auto-instrumentor inspects. With the SDK off, this limitation is invisible — review responds correctly regardless. The gap only shows up as a concrete, demonstrable problem once Chapter 8's automatic instrumentation turns on and every GraphQL request in Tempo looks identical from the outside, which is the setup for the resolver-level manual spans Python's `review.resolve_reviews`-style spans (already present, inert, in the file you just read) exist to close.

## Kafka: shipping and notification

Shipping and notification are the two services nothing calls directly. Both consume the same `order.placed` topic order publishes after a successful checkout, independently of each other and off order's request path entirely — order returns its `201 Created` response to the caller before either consumer necessarily processes the event. Shipping inserts a `shipments` row and publishes `shipment.created`; notification inserts into `notifications` and marks a channel (`email` or `sms`) as sent or failed. Neither waits for the other, and neither failing blocks the order from having been placed.

```java
// services/quarkus/shipping/.../OrderPlacedListener.java
@Incoming("order-placed-in")
@Blocking
public void onOrderPlaced(String value) throws Exception {
    OrderPlacedEvent event = objectMapper.readValue(value, OrderPlacedEvent.class);
    String shipmentId = UUID.randomUUID().toString();
    try (Connection conn = dataSource.getConnection();
            PreparedStatement stmt = conn.prepareStatement("""
                    INSERT INTO shipments (shipment_id, order_id, sku, quantity, status)
                    VALUES (?, ?, ?, ?, ?)
                    """)) {
        stmt.setString(1, shipmentId);
        stmt.setString(2, event.orderId());
        stmt.setString(3, event.sku());
        stmt.setInt(4, event.quantity());
        stmt.setString(5, "CREATED");
        stmt.executeUpdate();
    }
    // publish shipment.created ...
}
```

This is the pairing in the whole system most worth watching once instrumentation arrives, because it is where automatic instrumentation's limits are sharpest. HTTP and gRPC auto-instrumentation can inject and extract trace context from request headers without any application code noticing; Kafka's wire format has no equivalent concept built into a client library's request/response cycle, since a message sits in a topic for an arbitrary amount of time between being produced and being consumed. Every service in this repository already contains the code that solves this — `obs/kafka_propagation.py` in Python, and the equivalent OTel Kafka interceptor configuration in Spring Boot and Quarkus — but with the SDK disabled, none of it has anything to extract or inject. Chapter 13 is where this becomes a chapter in its own right: flipping `PROPAGATE_KAFKA_CONTEXT` off to force the break, watching a trace visibly split at this exact boundary, and then watching the fix close it.

## Running the baseline and confirming it's empty

The useful exercise for this chapter isn't reading the code — it's running it and confirming that "no telemetry" is a true, checkable claim rather than an assertion. With the shared stack from Chapter 6 up, bring up one language track with the SDK explicitly disabled:

```bash
export OTEL_SDK_DISABLED=true
podman compose -f stack/compose.yaml --profile quarkus up -d --build

curl -s -X POST localhost:8080/orders \
  -H 'Content-Type: application/json' \
  -d '{"customerId":"cust-1","sku":"WIDGET-001","quantity":1}'
```

That call should return `201 Created` with a `status` of `PLACED` in the response body — the business logic works, end to end, across order, inventory, payment, Postgres, and Kafka. Then check Grafana. Tempo's search for `service.name = order-quarkus` over the last five minutes returns nothing. Loki's query for `{service_name="order-quarkus"}` returns nothing, because the log lines this request generated went to the container's own stdout and the rotating file under `/deployments/logs`, never to the Collector. Mimir has no `orders_placed_total` series to query. That absence, confirmed rather than assumed, is the baseline every later chapter in Part 3 measures its progress against — the first time a span for this exact request shows up in Tempo, in Chapter 8, you'll know precisely what capability was added to produce it, because you watched it not exist here first.

The same confirmation works from the Kafka side, using the CLI rather than Grafana. Since this stack has no Kafka GUI, kcat is how you look at what `order.placed` actually carried on the wire:

```bash
podman compose -f stack/compose.yaml --profile tools up -d kcat
podman compose -f stack/compose.yaml exec kcat \
  kcat -b kafka:9094 -t order.placed -C -o beginning -e -f 'Headers: %h\nPayload: %s\n\n'
```

With `OTEL_SDK_DISABLED=true`, the `Headers:` line for the message your `curl` call produced comes back empty, or carries only whatever non-tracing metadata the producer attached — no `traceparent`, no `baggage`. That header is exactly what Chapter 13's context-propagation code injects once the SDK is live and `PROPAGATE_KAFKA_CONTEXT=true`; seeing it absent here, on a message you just produced yourself, is the concrete baseline that makes its later appearance mean something instead of being taken on faith.

Tear the track back down (or just re-export `OTEL_SDK_DISABLED=false` and restart the services) before moving on; Chapter 8 assumes telemetry is reachable from the first command it runs.

With the services running and confirmed quiet, Part 3 begins. Chapter 8 turns automatic instrumentation on for the first time and finds this same `POST /orders` call's trace, spanning order, inventory, and payment, in Tempo — the first signal this tutorial produces.
