---
title: "Baggage"
order: 12
part: "The signals"
description: "Propagating business context such as cart.id across service boundaries with W3C Baggage, reading it back as a span attribute, and the cardinality cost of getting that wrong."
---

A trace tells you what happened across a request. It does not, by default, carry any of the business context that made the request meaningful — which customer, which cart, which tenant. A span for `Reserve` in the inventory service knows it reserved three units of a SKU; it does not know, unless something tells it, which shopping cart that reservation belongs to. Baggage is the OpenTelemetry mechanism for carrying exactly that kind of contextual key-value data alongside a trace, from the service that knows it to every downstream service in the call chain, without requiring each intermediate service to understand or pass along a bespoke field.

This chapter covers baggage as implemented in this tutorial's order flow: `cart.id`, set once when an order request arrives, read by the inventory and payment services several hops later, and recorded on their spans as an attribute. It also covers why baggage and span attributes are not interchangeable, and the cost caution that comes with baggage's biggest feature — it propagates everywhere, whether you want it to or not.

## Baggage is not a span attribute

A span attribute is local: it describes a specific operation, lives on that one span, and goes wherever that span's data goes — to Tempo, and nowhere else automatically. Baggage is the opposite. It is not tied to any single span. It rides in the propagation context itself, the same mechanism that carries the trace ID and span ID across process boundaries, and the [OpenTelemetry baggage specification](https://opentelemetry.io/docs/concepts/signals/baggage/) describes it as "contextual information... passed between signals," decoupled from any one span's lifetime by design.

That distinction has a direct practical consequence: setting a baggage entry does nothing to any span by itself. It needs to be read and attached as an attribute explicitly, at whatever point you want it visible in Tempo. Baggage by itself is invisible in Grafana; it is pure plumbing. Every service in this tutorial that wants `cart.id` to show up in a trace calls `Span.current().setAttribute("cart.id", cartId)` after reading it from baggage. Skipping that step means the value is still propagating correctly, which you can confirm by checking that the next service in the chain gets the right value, but you would have no way to see it in Grafana's trace view, because nothing ever told a span about it.

## Setting it once at the order boundary

The order service is the only place in this tutorial's demo application that sets `cart.id` baggage. A request to `POST /orders` arrives with the cart ID either in the request body or an `X-Cart-Id` header; the service resolves one from the other (generating a placeholder if neither is present) and wraps the entire critical section — the inventory check, the payment authorization, the database insert, the Kafka publish — in a baggage context carrying that value:

```java
try (Scope scope = Baggage.current().toBuilder().put("cart.id", cartId).build().makeCurrent()) {
    boolean available = checkStockWithRetry(request.sku(), request.quantity());
    boolean authorized = available && authorizeWithRetry(orderId, request.customerId(), amountCents);
    // ...
}
```

Every call made inside that `try`-with-resources block — in Spring Boot's case, the outbound gRPC calls to inventory and payment — happens with this baggage active. The Java agent's gRPC client instrumentation (for Spring) and the quarkus-opentelemetry extension's own gRPC instrumentation (for Quarkus) both propagate the active context, trace and baggage together, as outbound metadata on the call. Python does the equivalent with `opentelemetry.baggage.set_baggage` returning a new `Context` that is explicitly attached for the duration of the handler and detached in a `finally` block, since Python's context API does not have a scoped resource like Java's `Scope`.

The baggage entry does not need to be re-set by any downstream service. It is part of the propagated context from the moment it is set until whatever process receives it chooses to read it or lets it continue propagating further. This is baggage's core value proposition: one service can inject business context that it alone knows, and every downstream service gets it without a shared schema negotiated in advance or a database lookup keyed on some other identifier that has to be threaded through every call signature.

## Reading it back downstream

Inventory and payment both read `cart.id` the same way, independent of language: ask baggage for the current value of the key, and if present, attach it to the current span as an attribute.

```python
def _attach_cart_baggage() -> str | None:
    cart_id = baggage.get_baggage("cart.id")
    if cart_id:
        trace.get_current_span().set_attribute("cart.id", cart_id)
    return cart_id
```

This is a narrow, deliberate boundary: baggage flows automatically across the gRPC hop because the propagator writes it into gRPC metadata and the server-side instrumentation extracts it back into context before the handler runs; attaching it to a span is a one-line decision made locally, at whichever point in that service's code the value becomes relevant to record. Inventory's `CheckStock` and `Reserve` handlers both call this helper, so a trace through either path shows `cart.id` as a span attribute, which means a Tempo query like `{ span.cart.id = "cart-a1b2c3d4" }` finds every span across every service, in every trace, that touched that cart — a correlation that required zero coordination beyond the one baggage entry set at the order boundary.

This is also where the earlier distinction pays off concretely: a verified trace through this tutorial's stack shows `cart.id` as an attribute on the inventory service's `CheckStock` span and the payment service's `Authorize` span, both populated from the same baggage entry the order service set, with no gRPC call, protobuf message, or shared database row carrying it explicitly. The transport is entirely the propagation context; the application code's only job was to read it and decide it was worth recording.

## What the wire format actually looks like

It helps to see baggage with the abstraction stripped away, the same way the correlation chapter strips Grafana's click-throughs down to the HTTP calls underneath. The [W3C Baggage specification](https://www.w3.org/TR/baggage/) that `opentelemetry.io`'s propagation documentation implements defines a single HTTP header, `baggage`, carrying a comma-separated list of URL-encoded key-value pairs:

```
baggage: cart.id=cart-a1b2c3d4
```

That is the entire payload. When the order service's gRPC client makes the call to inventory with baggage active, this is (modulo gRPC's own metadata encoding, which carries the same key-value pair as a header rather than an HTTP header proper) what actually goes out on the wire, alongside a `traceparent` header carrying the trace ID, span ID, and sampling flag in the W3C Trace Context format. Multiple baggage entries are joined with commas: `cart.id=cart-a1b2c3d4,tenant.id=acme-corp` would be a two-entry baggage context, and every byte of that string travels on every hop, which is the concrete, visible form the cost caution later in this chapter is about.

This also clarifies why baggage needs no schema registry or shared type definitions the way an API contract would: it is a flat, untyped list of strings, interpreted entirely by whichever service chooses to read a given key. The order service and the inventory service agree on the key `cart.id` by convention — because the code in both services was written to agree — not because any propagation layer enforces it. A typo in one service's key name (`cartId` instead of `cart.id`) would propagate silently as a harmless, unread extra entry, with no error anywhere, which is a sharper version of the same coordination problem the [logs chapter](11-logs.html) describes for `service.name`: a value only does anything useful if every party that needs it agrees, byte for byte, on its key.

## What baggage is for, and what it is not for

Baggage answers a specific kind of question well: "what business context applies to every operation in this request, regardless of which service is currently running it?" Cart ID, tenant ID, a feature-flag variant the user is in, an experiment bucket — all of these are facts that are true for the whole request and that more than one downstream service might independently want to attach to its own spans, logs, or decisions, without each one needing its own side channel to learn the fact.

It is a poor fit for anything large, anything that changes mid-request, or anything that should only be visible to one specific service rather than propagated indiscriminately. A good test before reaching for baggage is to ask whether the value would still make sense as an annotation on a dashboard filter two services away from the one that set it; if the answer is yes, as it is for `cart.id`, baggage is doing its job. If the value only matters to the one service that computed it, or needs to be hidden from some services in the chain for data-sensitivity reasons, baggage is the wrong tool regardless of how convenient automatic propagation looks, because it has no concept of a service being out of scope for a given entry. Baggage has no access control: every process in the call chain that participates in the W3C Baggage propagation format can read every entry, including processes the original author of the data might not have anticipated being in the chain by the time the system grows. It is also not a substitute for passing data through an API payload when that data is operationally required by a downstream service's business logic — baggage should carry context that enriches observability and incidental cross-cutting decisions, not information a service depends on to function, because baggage propagation is itself best-effort and easy to accidentally break (an unstrumented hop, a message queue without explicit header propagation, as the next chapter covers for Kafka).

## The cardinality and cost caution

Baggage's defining property — it propagates to every span in the trace, on every service, automatically — is also its sharpest edge. Every baggage entry set is serialized into the `baggage` HTTP header (or its gRPC metadata and Kafka header equivalents) on every single outbound call made while that context is active, for the lifetime of that context. A few short string keys, like this tutorial's single `cart.id` entry, cost a negligible number of bytes per hop. A baggage context accumulating a dozen entries, some of them verbose JSON blobs, starts to add measurable overhead to every request in the system, invisible until someone inspects the wire format or notices it in request latency.

The sharper cost is downstream of propagation, in what people do with the values once they are visible on every span: promoting a baggage value to a metric label. `cart.id` is a good span attribute precisely because it is high-cardinality — every cart is unique, which is exactly what makes "find every span for this cart" a useful trace query. That same property makes it a disastrous metric label. A counter or histogram with `cart.id` as a label dimension creates a new time series for every distinct cart that has ever placed an order, and a metrics backend like Mimir (or Prometheus before it) does not forget old series quickly; cardinality this unbounded is one of the most common ways a metrics pipeline is accidentally run into the ground, covered in more depth in this tutorial's [cardinality and cost chapter](21-cardinality-and-cost.html). The rule that keeps baggage safe is simple to state and easy to violate by accident: baggage and span attributes are fine with high-cardinality values; metric label sets are not, no matter how convenient the value already being "right there" on the active baggage context makes it look.

## Confirming it end to end without reading a line of application code

Because baggage is visible on the wire and its effect is visible in Tempo, a trace produced by this tutorial's demo load can be checked end to end without instrumenting anything further. Placing an order with an explicit cart header,

```bash
curl -s -X POST http://localhost:8080/orders \
  -H 'Content-Type: application/json' -H 'X-Cart-Id: cart-demo-0001' \
  -d '{"customerId":"cust-1","sku":"sku-1","quantity":2}'
```

and then querying Tempo's search API for that trace's spans is enough to confirm propagation held across every hop:

```bash
curl -s "http://localhost:3200/api/search?tags=cart.id=cart-demo-0001" | jq '.traces[].traceID'
```

A verified run of this tutorial's stack returns one trace ID, and that trace's span list shows `cart.id` as an attribute on the order service's root span's children at the inventory `CheckStock` span and the payment `Authorize` span — two different services, two different processes, one baggage entry, read independently by each. If that query comes back empty while the order clearly succeeded, the fault is almost always one of three things: the baggage was set but never attached to a span downstream (the `attachCartBaggage`-equivalent call is missing), the propagator composite is missing the baggage member (an SDK misconfigured with only `tracecontext` and not `tracecontext,baggage` in `OTEL_PROPAGATORS` or its language equivalent), or the call crossed a boundary — like the Kafka hop in the next chapter — that does not propagate context the same way HTTP and gRPC do.

{% include excalidraw.html file="ch12-baggage-propagation" alt="The order service sets cart.id as OpenTelemetry baggage once; it propagates automatically over gRPC to the inventory and payment services, each of which reads it and attaches it as a cart.id span attribute visible in Tempo, with a caution callout about cardinality cost" caption="Figure 12.1 — One baggage entry, set once, read as a span attribute at every service that cares" %}

## Codetabs: setting cart.id baggage at the order boundary

{% include codetabs.html langs="Spring Boot|Quarkus|Python" %}

```java
// services/spring/order/src/main/java/com/example/otel/order/OrderController.java
try (Scope scope = Baggage.current().toBuilder().put("cart.id", cartId).build().makeCurrent()) {
    boolean available = checkStockWithRetry(request.sku(), request.quantity());
    boolean authorized = available && authorizeWithRetry(orderId, request.customerId(), amountCents);
    status = (available && authorized) ? "PLACED" : "REJECTED";
    insertOrder(orderId, request, amountCents, status);
    if ("PLACED".equals(status)) {
        publishOrderPlaced(new OrderPlacedEvent(orderId, request.customerId(), request.sku(),
                request.quantity(), amountCents, status, cartId));
    }
}
```

```java
// services/quarkus/order/src/main/java/com/example/otel/order/OrderResource.java
// Same shape as the Spring sibling; propagation here comes from the
// in-tree quarkus-opentelemetry extension's gRPC client instrumentation
// rather than the Java agent, but the application code is identical.
try (Scope scope = Baggage.current().toBuilder().put("cart.id", cartId).build().makeCurrent()) {
    boolean available = checkStockWithRetry(request.sku(), request.quantity());
    boolean authorized = available && authorizeWithRetry(orderId, request.customerId(), amountCents);
    status = (available && authorized) ? "PLACED" : "REJECTED";
}
```

```python
# services/python/order/src/order/main.py
# cart.id is set as OTel baggage around the critical section so it rides
# downstream (over gRPC) and shows up as a cart.id span attribute on the
# inventory and payment services' spans.
ctx = baggage.set_baggage("cart.id", cart_id)
token = context.attach(ctx)
try:
    available = await _check_stock_with_retry(app.state.clients, body.sku, body.quantity)
    authorized = available and await _authorize_with_retry(
        app.state.clients, order_id, body.customer_id, amount_cents
    )
finally:
    context.detach(token)
```

## Codetabs: reading cart.id back as a span attribute

{% include codetabs.html langs="Spring Boot|Quarkus|Python" %}

```java
// services/spring/inventory/src/main/java/com/example/otel/inventory/InventoryServiceImpl.java
private String attachCartBaggage() {
    String cartId = Baggage.current().getEntryValue("cart.id");
    if (cartId != null) {
        Span.current().setAttribute("cart.id", cartId);
    }
    return cartId;
}
```

```java
// services/quarkus/inventory/src/main/java/com/example/otel/inventory/InventoryServiceImpl.java
private String attachCartBaggage() {
    String cartId = Baggage.current().getEntryValue("cart.id");
    if (cartId != null) {
        Span.current().setAttribute("cart.id", cartId);
    }
    return cartId;
}
```

```python
# services/python/payment/src/payment/server.py
def _attach_cart_baggage() -> str | None:
    cart_id = baggage.get_baggage("cart.id")
    if cart_id:
        trace.get_current_span().set_attribute("cart.id", cart_id)
    return cart_id
```

Further reading: the [OpenTelemetry documentation on baggage](https://opentelemetry.io/docs/concepts/signals/baggage/) covers the propagation format and the access-control caveat — any participant in the trace can read every entry — in more detail than this chapter's scope needs.
