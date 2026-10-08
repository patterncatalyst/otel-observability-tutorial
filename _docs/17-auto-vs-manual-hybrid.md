---
title: "Auto vs. manual vs. hybrid"
order: 17
part: "Making signals useful"
description: "A decision framework for what auto-instrumentation already covers, what to add by hand, and how the hybrid actually looks in each of the three stacks."
---

By this point in the tutorial, every service has been instrumented twice, once by an agent or extension that needed no application code, and once by a handful of lines a developer wrote by hand. Chapter 8 covered the first kind, chapter 9 covered the second, and this chapter is where the two stop being separate topics. The question a team actually faces is never "auto or manual." It is narrower and more useful: given that auto-instrumentation already covers most of the request, what is actually left to add, and where, exactly, does it belong?

What this codebase actually shows is that the hybrid takes two different shapes, not one. Where auto-instrumentation already creates a span for a hop, the manual work is enrichment: attaching a business fact as an attribute on a span that already exists. Where auto-instrumentation does not reach, because a library has no instrumentor, or because a boundary is async and the auto path stops at the function call that enqueues the message, the manual work is a span from scratch: naming an operation and threading propagated context into it by hand. A third shape sits alongside both of these on the metrics side: a protocol-level metric like request duration comes from the same auto-instrumentation that produced the span, while a metric that counts a business outcome, an order placed with a particular status, has to be created and incremented by application code, because no instrumentor can infer what counts as a meaningful business event from an HTTP status code alone. None of these three are "hybrid instrumentation" in the same sense, and confusing them is the most common way a team either writes code nobody needed or discovers a gap nobody meant to leave.

{% include excalidraw.html file="ch17-auto-manual-hybrid" alt="Diagram showing the POST /orders request path split into an auto-instrumentation layer (REST span, gRPC spans, Postgres span, Kafka producer header injection, all automatic) and a hand-placed layer below it (the cart.id baggage attribute set the same way in all three stacks, a manually created Kafka consumer span in Python that Java gets automatically, and manually named GraphQL resolver spans in the Python review service under one automatic POST /graphql span)" caption="Figure 17.1 — Auto spans the plumbing; manual work takes two different shapes depending on what the plumbing already covers" %}

## What auto-instrumentation is actually doing

[OpenTelemetry's own framing](https://opentelemetry.io/docs/concepts/instrumentation/) draws the same line this tutorial has drawn since chapter 8: zero-code instrumentation is "great for getting started, or when you can't modify the application you need to get telemetry out of," producing telemetry about what is happening at the edges of an application, while code-based instrumentation is "an essential complement," reaching inside the application for signals the edges cannot see. The documentation is explicit that these are not competing choices: "you can use both solutions simultaneously," which is the entire premise of a hybrid.

Each stack reaches that edge coverage by a different mechanism, and the mechanism matters because it determines what counts as "already covered" before anyone writes a line of business code. Spring Boot attaches the OpenTelemetry Java agent at the JVM level with `-javaagent`, weaving instrumentation into REST controllers, the gRPC stubs, the JDBC driver, and the Kafka client as bytecode is loaded, with no dependency on application code at all; it even no-ops cleanly when `OTEL_SDK_DISABLED=true`, which is how this tutorial's no-telemetry baseline demo works. Quarkus gets the same categories of span, REST, gRPC, JDBC, Kafka, from the `quarkus-opentelemetry` and `quarkus-micrometer-opentelemetry` extensions instead, baked into the application at build time rather than woven at class-load time, which is why there is no OpenTelemetry Java agent in the Quarkus Containerfile at all, only the Pyroscope profiling agent from chapter 14. Python's zero-code `opentelemetry-instrument` launcher covers the synchronous instrumentation libraries, but this stack's services are all `asyncio`, and `obs/otel.py` is explicit in its own docstring about the gap: the generic zero-code `grpc` hook "only wires the synchronous API, not `grpc.aio`," so every Python service also runs a short manual SDK setup, not to replace the zero-code launcher, but to turn on the `asyncpg` and `grpc.aio` instrumentors it cannot reach. Three different attach mechanisms, converging on the same span coverage for HTTP, gRPC, and the database.

## The hybrid as enrichment: one baggage attribute, three stacks

The clearest example of "the manual layer adds a fact, not a span" is the `cart.id` attribute that rides from the order service through to inventory and payment. The order service's own REST handler comment states the intent directly: the OpenTelemetry agent or extension does all the context propagation across the REST, gRPC, and Postgres hops automatically, and the only code added is the baggage entry carrying `cart.id` downstream. No new span is created anywhere in this flow. An existing auto-instrumented span gets one additional attribute, set through OTel baggage so it survives the hop to a different process.

{% include codetabs.html langs="Spring Boot|Quarkus|Python" %}

```java
// services/spring/order/OrderController.java — POST /orders
try (Scope scope = Baggage.current().toBuilder().put("cart.id", cartId).build().makeCurrent()) {
    boolean available = checkStockWithRetry(request.sku(), request.quantity());
    // ...authorize, insert, publish — all under the same auto span, cart.id riding along
}
```

```java
// services/quarkus/order/OrderResource.java — same pattern, different extension underneath
try (Scope scope = Baggage.current().toBuilder().put("cart.id", cartId).build().makeCurrent()) {
    boolean available = checkStockWithRetry(request.sku(), request.quantity());
    // ...authorize, insert, publish — all under the same auto span, cart.id riding along
}
```

```python
# services/python/order/src/order/main.py — same baggage entry, asyncio context
ctx = baggage.set_baggage("cart.id", cart_id)
token = context.attach(ctx)
try:
    available = await _check_stock_with_retry(app.state.clients, body.sku, body.quantity)
    # ...authorize, insert, publish — all under the same auto span, cart.id riding along
finally:
    context.detach(token)
```

On the receiving end, `inventory` and `payment` read that baggage entry back and stamp it onto whichever span the gRPC auto-instrumentation already opened for the incoming call, with the identical one-line idiom in every language: `Span.current().setAttribute("cart.id", cartId)` in both Java stacks, `trace.get_current_span().set_attribute("cart.id", cart_id)` in Python. None of these four services, order, inventory, payment, in either Java stack, ever calls a span-creation API. The entire manual contribution is a baggage entry going out and an attribute read coming back, wrapping work the auto-instrumentation was already going to trace regardless.

## The hybrid as a new span: where auto-instrumentation stops

The Kafka hop tells a different story, and it is the sharpest illustration in this codebase of why "inherit what auto gives you, add what it doesn't" is a per-boundary decision rather than a per-language one. Both Java stacks get Kafka consumer spans without writing any tracing code: the OpenTelemetry Java agent instruments Spring's `@KafkaListener` consumers directly, and the `quarkus-opentelemetry` extension does the same for Quarkus's `@Incoming` channels, continuing the trace the order service's producer started, with zero lines of tracing code in either listener method. Python's manual SDK setup, by contrast, leaves Kafka unautomated by design. The module docstring in `obs/otel.py` flags it as the one hop that is not auto-propagated, because carrying trace context across that asynchronous boundary needs code that extracts the W3C headers from the consumed message and opens a span with that extracted context as its parent, something no zero-code instrumentor here does for `aiokafka`.

{% include codetabs.html langs="Spring Boot|Quarkus|Python" %}

```java
// services/spring/shipping/OrderPlacedListener.java — no tracing code at all
@KafkaListener(topics = "order.placed", groupId = "shipping-spring")
public void onOrderPlaced(String key, String value) {
    OrderPlacedEvent event = objectMapper.readValue(value, OrderPlacedEvent.class);
    // insert shipment, publish shipment.created — the agent already opened
    // and parented this consumer's span to the producer's trace
}
```

```java
// services/quarkus/shipping/OrderPlacedListener.java — same story, extension instead of agent
@Incoming("order-placed-in")
@Blocking
public void onOrderPlaced(String value) throws Exception {
    OrderPlacedEvent event = objectMapper.readValue(value, OrderPlacedEvent.class);
    // insert shipment, publish shipment.created — quarkus-opentelemetry already
    // opened and parented this consumer's span to the producer's trace
}
```

```python
# services/python/shipping/src/shipping/worker.py — manual extraction + manual span
async for msg in consumer:
    ctx = extract_context(msg.headers)  # continue the producer's trace
    with otel.tracer().start_as_current_span("shipping.handle_order_placed", context=ctx):
        order = msg.value
        shipment_id = await _create_shipment(order)
        await obskafka.publish_event(producer, SHIPMENT_CREATED_TOPIC, ...)
```

Without that `extract_context` and `start_as_current_span` pair, the Python consumer would still process the message correctly, but the span OpenTelemetry's Python SDK creates for it, if it created one at all, would start a brand-new trace with no parent, visibly disconnected from the order that triggered it in Tempo's trace view. This is the same kind of break chapter 13 creates with `PROPAGATE_KAFKA_CONTEXT=false` to make its point, except here the risk is permanent rather than a toggle: Python's Kafka path has no auto-instrumentation safety net to fall back on if the manual code is missing or wrong. Java's two listeners have that safety net. The same operation, consuming one Kafka topic and producing another, needed real tracing code in one language and none in the other, because the two languages' auto-instrumentation covers different ground.

A related shape worth naming briefly: the Python review service's GraphQL resolvers each open their own span, `review.resolve_reviews`, `review.resolve_review`, `review.add_review`, nested under the one auto-instrumented `POST /graphql` span that FastAPI's instrumentor already creates. FastAPI auto-instrumentation sees an HTTP request; it has no way to know that request is a GraphQL query touching three distinct resolvers, so naming each resolver as its own span is manual work layered on top of auto coverage that stops exactly at the protocol boundary GraphQL sits behind.

## The hybrid on the metrics side

Everything so far has been about spans, but the same inherit-versus-add split applies to metrics, and the order service's own request counter is the clearest example of it. Auto-instrumentation already produces protocol-level metrics for every hop: request duration histograms for the REST endpoint, call counts for the gRPC clients, connection pool gauges for the JDBC and `asyncpg` drivers, all emitted without a line of application code, the same way the auto spans are. None of those metrics can answer a question like "how many orders were rejected for being unauthorized versus out of stock," because that distinction is a business outcome computed from the order's own `status` field, not something visible in an HTTP status code or a gRPC return value. Counting it needs a metric created and incremented by hand.

{% include codetabs.html langs="Spring Boot|Quarkus|Python" %}

```java
// services/spring/order/OrderController.java — business outcome, not a protocol metric
meterRegistry.counter("orders_placed_total", "status", status).increment();
```

```java
// services/quarkus/order/OrderResource.java — same metric name, same Micrometer API
meterRegistry.counter("orders_placed_total", "status", status).increment();
```

```python
# services/python/order/src/order/main.py — created once at startup, incremented per request
app.state.orders_counter = otel.meter().create_counter(
    "orders_placed_total", description="Orders placed, by status"
)
# ...
app.state.orders_counter.add(1, {"status": status})
```

`orders_placed_total` carries the same name and the same `status` dimension in all three stacks, which is what makes it comparable across language tracks on one Grafana dashboard: a reader switching the stack's Compose profile from `spring` to `python` sees the identical metric name keep working, because the business decision it counts, not the transport it rode in on, defines what gets measured. This is the same reasoning the metrics chapter applies to histogram bucket boundaries: a metric worth keeping outlives the library that happened to emit it.

## Telling auto and manual apart in a real trace

The decision framework above is something you can verify directly in a trace, not just read about, because every span carries an instrumentation scope: the name of whatever created it, visible in Grafana's trace view alongside the span name itself. A span an auto-instrumentation library created carries that library's own name as its scope, something like an OpenTelemetry Spring WebMVC or FastAPI instrumentor identifier, versioned to the library release. A span created manually in this codebase carries a different scope entirely, because of how `obs/otel.py` constructs its tracer: `trace.get_tracer(service_name)`, where `service_name` is the bare argument each service passes to `otel.setup()`, literally `"review"`, `"shipping"`, `"order"`. Open `shipping.handle_order_placed` in a trace and its instrumentation scope reads `shipping`, the service's own name, not a library's. Open the Postgres span next to it in the same trace and its scope names the database driver's instrumentation package instead. The two kinds of span are distinguishable without reading a line of source, which is a useful habit when inheriting a trace from a service you did not instrument yourself: the scope field answers "was this handed to me or did someone write it" before you go looking for the code that might have written it.

Tempo's own query API confirms the same thing from the command line, with no Grafana panel in the way:

```bash
curl -s "http://localhost:3200/api/search?tags=service.name%3Dshipping-python" \
  | jq '.traces[0].spanSets[0].spans[] | {name, instrumentationScope}'
```

Run that against a trace produced by placing an order, and `shipping.handle_order_placed` comes back with its own service name as the instrumentation scope, sitting next to a Postgres `INSERT` span whose scope names `opentelemetry-instrumentation-asyncpg` instead. Seeing both in the same JSON response is a faster way to settle an argument about where a given span came from than searching the codebase for `start_as_current_span` and hoping the search is exhaustive.

## The decision framework

Four questions, asked per boundary rather than per service, cover every case in this chapter. First: does an instrumentor already exist for this library or protocol, and is it wired in, whether by agent, extension, or zero-code launcher? If yes, the span or metric exists; nothing to write. Second, for a span that already exists: is there a business fact, an identifier, a decision outcome, a value from the request, that will matter later when reading this trace, and that the auto-instrumentation has no way to know? If yes, enrich: one attribute, set on the current span or carried as baggage to the next hop, the `cart.id` pattern. Third: does a boundary in the request path have no instrumentor at all for this language and library combination, Kafka in Python being the concrete case here, or does auto-instrumentation stop at a coarser granularity than the operation actually has, GraphQL's single HTTP span standing in for three distinct resolvers? If yes, that is where a manual span belongs, named for the operation it represents rather than for the transport underneath it, with context extracted and threaded through by hand if the boundary is asynchronous. Fourth, on the metrics side specifically: does answering the question "how many times did this business outcome happen" require knowledge no protocol-level metric carries, an order's final status, a cart's size, a review's rating? If yes, that is a counter or histogram created once at startup and incremented in the business logic itself, alongside the request-duration and error-rate metrics auto-instrumentation already produces without any code.

What makes this a hybrid rather than a checklist to apply once is that the answer to all four questions changes as libraries mature. An `aiokafka` instrumentor landing in the OpenTelemetry Python contrib repository would turn Python's Kafka consumers from manual spans into auto spans overnight, collapsing that section of this chapter into the same "nothing to add" story Java already has. Instrumenting the platform automatically and adding business-meaningful spans and metrics by hand is not a one-time architectural decision. It is a standing question to re-ask every time the instrumentation libraries underneath a service change, and a hybrid that holds up in practice, demonstrated across all three stacks in this tutorial, treats the boundary between "inherited" and "added" as something to check against the running trace, not something to assume from memory.
