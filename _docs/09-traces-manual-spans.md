---
title: "Traces: manual spans"
order: 9
part: "The signals"
description: "Wrapping the inventory and payment retry loops in spans of their own — the attempt count, the failure reason, and the business status auto-instrumentation can't see."
---

Open the trace from Chapter 8 in Tempo and it already tells a real story: one root span for `POST /orders`, a `CheckStock` child, an `Authorize` child, a database insert, a Kafka publish. What it does not tell you is whether `CheckStock` succeeded on the first attempt or the fourth, or what each of those failed attempts returned before the retry loop gave up and moved on. `OrderController`, `OrderResource`, and `order/main.py` each wrap their gRPC calls in a five-attempt retry loop with a one-second delay between tries, and every one of those attempts happens entirely inside the single gRPC client span the auto-instrumentation already produces — because from the instrumentation's point of view, there is exactly one gRPC call being traced: the last one that actually returned. The four that failed before it leave no trace at all.

That is the gap this chapter closes, and it is a gap by design rather than a defect: auto-instrumentation can only see library boundaries — a servlet dispatch starting, an HTTP client call going out, a JDBC statement executing. It has no way to know that a particular `CheckStock` failure is being retried rather than treated as final, because "this is a retry" is a decision your code makes, not something a REST or gRPC client library exposes as an event the agent, the extension, or the distro launcher can hook. The same is true of anything else that is meaningful to the business but invisible at the wire: a discount rule firing, a cache being checked before a database call, a feature flag changing which code path a request takes. Auto-instrumentation gives you the skeleton every request shares. Manual spans are where you tell it what actually happened inside this particular request.

{% include excalidraw.html file="ch09-manual-span-nesting" alt="Diagram showing an auto-generated parent span for POST /orders, created by whichever mechanism Chapter 8 described for that language, containing two manual child spans: inventory.check-with-retry with two span events (one failed attempt, one successful attempt), an inventory.attempts attribute, and OK status; and payment.authorize-with-retry with span events for repeated failures, a payment.attempts attribute, and an ERROR status with a recorded exception. All three spans share the same trace_id." caption="Figure 9.1 — Manual spans nested under the auto-generated parent, carrying the retry detail the wire protocol can't" %}

## What a manual span adds that auto-instrumentation can't

A span has four building blocks: its name, its attributes, its events, and its status. All four exist regardless of who creates the span, and the [OpenTelemetry tracing API](https://opentelemetry.io/docs/concepts/signals/traces/) defines them the same way whether the span comes from an agent, an extension, or your own code. **Attributes** are key-value pairs describing the operation: `inventory.attempts=2` tells you how many tries `CheckStock` took without needing a second span per attempt. **Span events** are timestamped points within the span's lifetime, such as "attempt 1 failed" followed by "attempt 2 succeeded," each with its own optional attributes, giving you a timeline inside a single span rather than a flat duration. **Status** is a terminal `OK` or `ERROR` plus an optional description, set once the span's own outcome is known; a span with no manual status call defaults to `UNSET`, which Tempo and Grafana render as success by omission, not as "unknown." `record_exception` attaches a full exception (type, message, and language-appropriate stack trace) as a structured event, instead of you serializing it into a string attribute yourself.

The retry loops in this tutorial's order service are close to the textbook case for all four at once: wrap the loop in a span named for the business operation it represents (`inventory.check-with-retry`, not `CheckStock` a second time — that name already belongs to the gRPC client span), add an event per attempt recording whether it failed and why, set an `attempts` attribute to the final count, and set the span's status to `ERROR` with the recorded exception if every attempt was exhausted. Nest it as a *child* of the span the retry loop runs inside, not as an independent span — context propagation (Chapter 2) makes a child span's parent association automatic as long as you start it on the active context, which is exactly what each language's idiom below does without asking you to pass a trace ID around manually.

Both Java stacks also support an annotation-based shortcut, `@WithSpan` from `opentelemetry-instrumentation-annotations`, which wraps an entire method in a span without any explicit `Tracer` call — the Java agent recognizes it via the same bytecode-weaving mechanism Chapter 8 described, and `quarkus-opentelemetry` recognizes it through its own interceptor. It's a reasonable choice when a whole method deserves exactly one span with no finer-grained detail inside it. It isn't the right fit for `checkStockWithRetry`: `@WithSpan` gives you one span for the whole method and nothing more, with no hook for adding a per-attempt event or a conditional status from inside the loop. The explicit `spanBuilder`/`startSpan` form used throughout this chapter trades a few more lines for full control over exactly when each event fires and what the final status and attributes should be — the right trade whenever the span's content depends on what happens during the method, not just on the method having run.

## Getting a Tracer: one call per language, three different sources

Before any of the three languages can create a manual span, the application needs a `Tracer` instance — and *how* you get one is a direct continuation of Chapter 8's three-way split, because each mechanism that produces auto-instrumentation also determines how manual instrumentation reaches the same OpenTelemetry SDK it configured.

Spring Boot's Java agent installs the OpenTelemetry SDK as the process-wide implementation behind the `GlobalOpenTelemetry` static accessor the moment it attaches — the same mechanism any instrumented library on the classpath already uses to get a tracer, so application code reaches for exactly that:

{% include codetabs.html langs="Spring Boot|Quarkus|Python" %}
```java
// services/spring/order/src/main/java/com/example/otel/order/OrderController.java
import io.opentelemetry.api.GlobalOpenTelemetry;
import io.opentelemetry.api.trace.Span;
import io.opentelemetry.api.trace.StatusCode;
import io.opentelemetry.api.trace.Tracer;
import io.opentelemetry.context.Scope;

private static final Tracer TRACER = GlobalOpenTelemetry.getTracer("order-spring");

private boolean checkStockWithRetry(String sku, int quantity) {
    Span span = TRACER.spanBuilder("inventory.check-with-retry").startSpan();
    try (Scope scope = span.makeCurrent()) {
        RuntimeException lastFailure = null;
        for (int attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                CheckStockResponse response = inventoryStub.checkStock(CheckStockRequest.newBuilder()
                        .setSku(sku).setQuantity(quantity).build());
                span.setAttribute("inventory.attempts", attempt);
                span.setStatus(StatusCode.OK);
                return response.getAvailable();
            } catch (RuntimeException e) {
                lastFailure = e;
                span.addEvent("attempt failed", io.opentelemetry.api.common.Attributes.of(
                        io.opentelemetry.api.common.AttributeKey.longKey("attempt"), (long) attempt));
                sleepBeforeRetry();
            }
        }
        span.setAttribute("inventory.attempts", MAX_RETRIES);
        span.recordException(lastFailure);
        span.setStatus(StatusCode.ERROR, "exhausted retries");
        throw new IllegalStateException("inventory CheckStock failed after " + MAX_RETRIES + " attempts", lastFailure);
    } finally {
        span.end();
    }
}
```
```java
// services/quarkus/order/src/main/java/com/example/otel/order/OrderResource.java
import io.opentelemetry.api.common.AttributeKey;
import io.opentelemetry.api.common.Attributes;
import io.opentelemetry.api.trace.Span;
import io.opentelemetry.api.trace.StatusCode;
import io.opentelemetry.api.trace.Tracer;
import io.opentelemetry.context.Scope;
import jakarta.inject.Inject;

@Inject
Tracer tracer;

private boolean checkStockWithRetry(String sku, int quantity) {
    Span span = tracer.spanBuilder("inventory.check-with-retry").startSpan();
    try (Scope scope = span.makeCurrent()) {
        RuntimeException lastFailure = null;
        for (int attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                CheckStockResponse response = inventoryStub.checkStock(CheckStockRequest.newBuilder()
                                .setSku(sku).setQuantity(quantity).build())
                        .await().atMost(GRPC_TIMEOUT);
                span.setAttribute("inventory.attempts", attempt);
                span.setStatus(StatusCode.OK);
                return response.getAvailable();
            } catch (RuntimeException e) {
                lastFailure = e;
                span.addEvent("attempt failed", Attributes.of(AttributeKey.longKey("attempt"), (long) attempt));
                sleepBeforeRetry();
            }
        }
        span.setAttribute("inventory.attempts", MAX_RETRIES);
        span.recordException(lastFailure);
        span.setStatus(StatusCode.ERROR, "exhausted retries");
        throw new IllegalStateException("inventory CheckStock failed after " + MAX_RETRIES + " attempts", lastFailure);
    } finally {
        span.end();
    }
}
```
```python
# services/python/order/src/order/main.py
from opentelemetry.trace import StatusCode
from obs import otel

async def _check_stock_with_retry(clients: Clients, sku: str, quantity: int) -> bool:
    with otel.tracer().start_as_current_span("inventory.check-with-retry") as span:
        last_exc: Exception | None = None
        for attempt in range(1, MAX_RETRIES + 1):
            try:
                response = await clients.check_stock(sku, quantity)
                span.set_attribute("inventory.attempts", attempt)
                span.set_status(StatusCode.OK)
                return response.available
            except Exception as exc:  # noqa: BLE001
                last_exc = exc
                span.add_event("attempt failed", {"attempt": attempt})
                await asyncio.sleep(RETRY_DELAY_SECONDS)
        span.set_attribute("inventory.attempts", MAX_RETRIES)
        span.record_exception(last_exc)
        span.set_status(StatusCode.ERROR, "exhausted retries")
        raise RuntimeError(f"inventory CheckStock failed after {MAX_RETRIES} attempts") from last_exc
```

Three ways of obtaining the same `Tracer` type, each following directly from the attach mechanism in Chapter 8. Spring Boot reaches for `GlobalOpenTelemetry.getTracer(...)`, a static accessor, because the Java agent is what populated that global in the first place. There is no Spring bean to inject, since the agent operates entirely outside Spring's dependency injection container. Quarkus injects `Tracer` as a CDI bean, `@Inject Tracer tracer`, because `quarkus-opentelemetry` registers it as a managed bean the same way it registers the `MeterRegistry` used in Chapter 10; asking for a `Tracer` this way is idiomatic Quarkus, not a special case. Python calls the `otel.tracer()` helper already defined in `obs/otel.py` for exactly this purpose, returning the tracer the module's own `setup()` created. That helper was written for this project rather than being a framework convention, because there is no CDI-equivalent container to register one for you, and no global accessor as convenient as Java's.

## Enriching the current span instead of creating a new one

Not every piece of business context earns its own span. A new child span is the right tool when you need your own start time, your own duration, and your own pass/fail outcome distinct from whatever span is already active. The retry loop above runs longer than the single gRPC attempt nested inside it, and can fail independently of it. A single fact worth attaching to the request already in flight — the resolved cart ID, the computed order total, the SKU being purchased — needs no new span at all. It needs one attribute on the span that's already active, which in this tutorial's auto-instrumented case is the root HTTP span Chapter 8's agent, extension, or launcher already created for `POST /orders`.

Every OpenTelemetry language API exposes the currently active span through a static accessor, independent of whichever mechanism started it — the same property that lets a manual child span nest correctly under an auto-generated parent without any explicit parent reference is what lets you reach back and annotate that parent directly:

{% include codetabs.html langs="Spring Boot|Quarkus|Python" %}
```java
// services/spring/order/src/main/java/com/example/otel/order/OrderController.java
import io.opentelemetry.api.trace.Span;

long amountCents = request.quantity() * UNIT_PRICE_CENTS;
Span.current().setAttribute("order.amount_cents", amountCents);
Span.current().setAttribute("order.sku", request.sku());
```
```java
// services/quarkus/order/src/main/java/com/example/otel/order/OrderResource.java
import io.opentelemetry.api.trace.Span;

long amountCents = request.quantity() * UNIT_PRICE_CENTS;
Span.current().setAttribute("order.amount_cents", amountCents);
Span.current().setAttribute("order.sku", request.sku());
```
```python
# services/python/order/src/order/main.py
from opentelemetry import trace

amount_cents = body.quantity * UNIT_PRICE_CENTS
span = trace.get_current_span()
span.set_attribute("order.amount_cents", amount_cents)
span.set_attribute("order.sku", body.sku)
```

`Span.current()` (`trace.get_current_span()` in Python) returns whatever span is active on the current context at the point it's called — the auto-generated REST span here, since no manual child span has been started yet at this point in the handler. No `Tracer` is needed for this, and no span lifecycle to manage: there's nothing to start and nothing to end, because the span enriched here isn't owned by this code at all. If this line ran with tracing disabled (`OTEL_SDK_DISABLED=true`, the baseline-demo toggle from Chapter 6), `Span.current()` returns a harmless no-op span that silently discards the attribute — the same safety property every OpenTelemetry API provides so instrumentation code never needs an `if (tracingEnabled)` guard of its own. The rule of thumb that falls out of this and the retry-loop example together: reach for `Span.current()` to attach a fact to the span that's already running, and reach for a new child span only when the thing you're describing has its own start, its own end, and its own possible failure, like a retry loop does and a single computed value doesn't.

## Why the span name is not the gRPC method name

Naming `inventory.check-with-retry` rather than reusing `CheckStock` is not a stylistic choice. The gRPC client instrumentation from Chapter 8 already owns a span named for that RPC, and it names every one of the (up to five) individual attempts independently as nested gRPC client spans if your code structures the retry such that each attempt is its own call — which, in this tutorial's implementation, it is, since `checkStockWithRetry` calls `inventoryStub.checkStock(...)` fresh on each loop iteration. The manual span this chapter adds is not replacing that auto-generated span; it is a span *one level up*, representing the business-level operation "get a stock answer, retrying as needed," with the individual attempt spans nested underneath it as children. Reusing the RPC's own name for the wrapping span would make two different things answer to the same name in Tempo's span list for the same trace, which turns "find the `CheckStock` span" from an unambiguous lookup into a guess about which of two spans with that name you actually meant.

The same reasoning applies to `payment.authorize-with-retry`, the sibling span wrapping `authorizeWithRetry`/`_authorize_with_retry`. Its failure path is the more instructive half of this pattern, because it is the one that actually reaches `ERROR` status in the demo: all five authorization attempts failing (simulated by a fault-injection toggle covered in a later chapter) should produce a span with `status.code = ERROR`, a `payment.attempts = 5` attribute, five span events each marking a timeout, and a recorded exception carrying the last failure's stack trace — all visible in Tempo as a single expandable span, rather than as five separate uncorrelated error log lines a reader would have to manually stitch back into one incident.

## Reading the result in Tempo

Once these spans are in place, opening a trace for an order that required two inventory attempts shows exactly what the auto-generated trace from Chapter 8 could not: expanding `inventory.check-with-retry` in Tempo's span detail view shows its two span events on a sub-timeline, each timestamped against the span's own start, with the `attempt` attribute distinguishing them. The attempts attribute on the span itself means a Tempo query like `{name="inventory.check-with-retry" && attempts>1}` finds every order where inventory needed more than one try, without ever touching a log line — a query that was not possible before this chapter, because the information the query filters on did not exist as structured span data until you put it there. A span that reaches `ERROR` status is the other half of this payoff: Grafana's trace view marks it visibly in the waterfall (a red bar rather than the default color), which is what makes a failed-but-retried operation scannable at a glance in a long trace instead of requiring you to expand every span to find out which one actually failed.

The same query pattern works from the command line against Tempo's own search API, not only from Grafana's Explore view, which matters for anyone scripting a check rather than clicking through a UI:

```sh
curl -s -G 'http://localhost:3200/api/search' \
  --data-urlencode 'q={name="inventory.check-with-retry" && span.inventory.attempts>1}' \
  | jq '.traces[].traceID'
```

That single query answers a question no amount of staring at `CheckStock`'s auto-generated span could answer on its own: not just that inventory was checked, but how many orders needed more than one attempt to get an answer, and which specific trace IDs to pull up next if that number looks high. A Tempo-backed Grafana panel built on the same query — a simple count of traces matching `attempts>1` over time — turns this from a one-off investigation into something worth watching continuously, which is the dashboarding story Chapter 18 picks up in more depth.

None of this changes what Chapter 8's auto-instrumentation already produces: the REST, gRPC, JDBC, and Kafka spans are still there, still created the same way, by the same agent, extension, or launcher. Manual spans are additive, nested inside that structure rather than replacing any part of it. Auto-instrumentation builds every request the same skeletal trace without you writing it. A handful of manual spans at the two or three places in your code where a retry, a business decision, or a computed status matters turn that skeleton into a trace that answers the questions you'll ask it during an incident. Chapter 10 picks up the same attribute-and-event vocabulary from the metrics side: the `orders_placed_total` counter already tells you how many orders were placed; what it's missing next is how long each one took, and whether a spike in that duration points back to one of the spans this chapter just taught you to create.
