---
title: "Context propagation across Kafka"
order: 13
part: "The signals"
description: "Why auto-instrumentation does not reliably carry W3C trace context across a Kafka hop, and the PROPAGATE_KAFKA_CONTEXT toggle that contrasts a continued trace against a broken one."
---

HTTP and gRPC both have a natural place to put trace context: a header, or a metadata entry, sent with the request and read by the server before the handler runs. Auto-instrumentation libraries for both protocols exploit that place reliably, because the protocol itself guarantees it exists on every call. Kafka has no such guarantee built into the protocol's core contract from the consumer's point of view. A message is a key, a value, and — since Kafka 0.11 — an optional list of headers that a well-behaved producer can choose to set and a well-behaved consumer can choose to read, but nothing in the broker enforces that either side does. Left alone, a Kafka consumer's processing has no way to know which trace, if any, produced the message it is handling, and the span it opens becomes a new root with no parent.

This chapter is about the fix: inject the W3C trace context into the message's headers on the producer side, and extract it back into context on the consumer side, so a span opened while processing a Kafka message continues the trace that published it instead of starting a disconnected one. All three stacks in this tutorial implement this, through different mechanisms, and all three expose the same toggle, `PROPAGATE_KAFKA_CONTEXT`, that turns injection off so the broken-trace case can be demonstrated and compared directly against the working one.

## The gap auto-instrumentation does not always close

It is worth being precise about what "does not always cross" means here, because Kafka instrumentation is not absent — Spring Kafka, SmallRye Reactive Messaging, and most Kafka client wrappers do ship tracing support. The gap is narrower and easy to miss: the instrumentation exists, is capable of carrying context, and in two of this tutorial's three stacks does so automatically once enabled — the open question is whether it is enabled, and whether the specific client library in use (aiokafka, in Python's case) has equivalent auto-instrumentation at all. Kafka's header mechanism is a general-purpose key-value list with no required semantics; unlike an HTTP `traceparent` header, which every compliant HTTP client and server library recognizes as special by convention, a Kafka header needs an instrumentation layer on both the producer and the consumer that specifically knows to look for `traceparent` and `baggage` keys, write them on publish, and read them on consume. If either side of that pair is missing — an unstrumented client library, a propagation feature flipped off, a hand-rolled producer that bypasses the instrumented client — the context silently does not cross, and the first symptom is a trace that looks complete up to the Kafka publish and then simply stops, with a brand-new trace starting at the consumer with no indication the two are related.

## PROPAGATE_KAFKA_CONTEXT: the toggle that makes the gap visible

Every producer and consumer in this tutorial's order-to-shipping and order-to-notification flow respects a single environment variable, `PROPAGATE_KAFKA_CONTEXT`, defaulted to `true` in `stack/compose.yaml`. With it true, the order service's `order.placed` publish carries `traceparent` and `baggage` headers, and the shipping and notification consumers extract them and open their processing spans as children of the producer's span — one continuous trace spans the REST request, the Kafka publish, and both downstream consumers' work, verified end to end in this tutorial's demo runs. Flip it to `false`, and the producer stops writing those headers entirely; the consumers still open a span (consumer-side tracing is not disabled, only the context it would have continued), but with no `traceparent` to extract, that span starts as a new root. The order's trace and the shipment's trace become two separate traces in Tempo, sharing no trace ID, discoverable as related only by matching timestamps or the `order_id` carried in the message body itself — exactly the degraded, timestamp-based correlation this tutorial's earlier chapters spent effort avoiding.

This contrast is the chapter's teaching point in concrete form: the toggle does not simulate a hypothetical failure mode. It reproduces, on command, the actual failure mode of an unstrumented or misconfigured Kafka hop, with the fix (header injection and extraction) sitting right next to the code path that disables it, so the difference between "trace continues" and "trace breaks" is one environment variable and one log of the resulting trace IDs.

## Spring Kafka: a JVM system property flips the producer

Spring Boot's Kafka producer and consumer are both instrumented by the OpenTelemetry Java agent, the same agent responsible for every other auto-instrumented hop in the Spring services. By default, the agent's Kafka instrumentation injects `traceparent` into every record a `KafkaTemplate` sends, and extracts it on every record a `@KafkaListener` receives, with zero application code — the order service's `publishOrderPlaced` method, and the shipping and notification services' `@KafkaListener`-annotated consumer methods, carry no tracing-specific code at all.

Turning propagation off is handled outside the application entirely, in `entrypoint.sh`, which assembles the JVM's `-javaagent` flags from the environment before the process starts:

```sh
if [ "${PROPAGATE_KAFKA_CONTEXT:-true}" = "false" ]; then
  APPEND="${APPEND} -Dotel.instrumentation.kafka.producer-propagation.enabled=false"
fi
```

This is a producer-side-only switch by design: it disables the agent's header injection on send, which is sufficient to break the trace, while leaving the consumer's own span creation untouched on both ends of the toggle — the behavior the comparison in this chapter wants to show. A system property, not an environment variable the agent reads on its own, is how this particular agent instrumentation setting is exposed, which is why `entrypoint.sh` translates the compose-level environment variable into a `-D` flag rather than relying on the agent to read `PROPAGATE_KAFKA_CONTEXT` directly; the agent has never heard of that name.

## Quarkus: a per-channel SmallRye Reactive Messaging property

Quarkus's Kafka connectivity goes through SmallRye Reactive Messaging, configured per channel in `application.properties` rather than through a system-wide agent flag. The relevant property is `tracing-enabled`, set on the order service's outgoing channel:

```properties
mp.messaging.outgoing.order-placed-out.tracing-enabled=${PROPAGATE_KAFKA_CONTEXT:true}
```

This is a runtime, per-channel attribute, resolved from the environment the same way every other property in this tutorial's Quarkus configuration is, and it is distinct from a build-time switch that looks similar on the surface: `quarkus.otel.instrument.messaging`, a compile-time flag that deletes Kafka messaging spans from the build entirely when false. That flag stays unused here: disabling it would remove the consumer's span altogether, hiding the contrast this chapter is built around, rather than producing a consumer span that visibly starts a new root trace. `tracing-enabled=false` on the producer channel keeps spans on both sides and only stops the producer from attaching the header that would link them, matching the behavior of Spring Kafka's system property and Python's own toggle — the comparison this chapter demonstrates.

The shipping service's incoming channel is left at its default (tracing stays on), and its outgoing `shipment-created.out` channel applies the same `tracing-enabled=${PROPAGATE_KAFKA_CONTEXT:true}` property for consistency, so the break (or continuation) propagates the same way through the second hop of the chain, order to shipping to the shipment-created topic, as it does through the first.

## Python: no framework auto-instrumentation, so it is explicit by design

aiokafka, the async Kafka client every Python service in this tutorial uses, has no equivalent zero-code tracing instrumentation in the OpenTelemetry Python ecosystem at the time of writing — a gap, not an oversight, since aiokafka's asyncio-native API does not fit the hook points most Kafka auto-instrumentation packages target. Rather than leave this hop uninstrumented, every Python service carries a small, explicit module, `obs/kafka_propagation.py`, that does by hand exactly what the Java agent and SmallRye's connector do automatically: read the active context, serialize it into a carrier, and turn that carrier into Kafka header tuples on publish; reverse the process on consume.

```python
def inject_headers(existing=None):
    headers = list(existing or [])
    if not _enabled():
        return headers
    carrier: dict[str, str] = {}
    propagate.inject(carrier)  # writes 'traceparent' (and 'baggage') into carrier
    headers.extend((k, v.encode("utf-8")) for k, v in carrier.items())
    return headers
```

`propagate.inject` and `propagate.extract` here are the same global propagator configured in `obs/otel.py` — a `CompositePropagator` of `TraceContextTextMapPropagator` and `W3CBaggagePropagator` — so a single call handles both the trace context and any active baggage (including `cart.id`, from the previous chapter) in one pass, writing both into the same carrier dictionary that becomes Kafka headers. `_enabled()` reads `PROPAGATE_KAFKA_CONTEXT` directly, making this module the one place in the Python services where the toggle is checked, rather than scattering the check across every producer call site.

The shipping worker's consume loop shows the other half: extract a `Context` from the message's headers, and pass it explicitly as the parent context when opening the processing span.

```python
async for msg in consumer:
    ctx = extract_context(msg.headers)  # continue the producer's trace
    with otel.tracer().start_as_current_span("shipping.handle_order_placed", context=ctx):
        order = msg.value
        shipment_id = await _create_shipment(order)
        # ...
```

When `PROPAGATE_KAFKA_CONTEXT=false`, `extract_context` returns an empty `Context()` rather than attempting to parse headers that were never written, and `start_as_current_span` with an empty context behaves exactly as it would with no context argument at all: a new root span, no parent, a new trace ID — the same outcome Spring's and Quarkus's toggles produce, arrived at by an explicit `if` check instead of a system property or a per-channel config value, because Python's path here has no framework default to disable in the first place.

## Inspecting the headers directly, before trusting Tempo

Because this stack has no Kafka GUI, the most direct way to confirm whether context propagation is actually happening is to look at the raw message, headers and all, with `kcat`:

```bash
podman compose -f stack/compose.yaml exec kcat \
  kcat -b kafka:9094 -t order.placed -C -o beginning -e -f 'Headers: %h\nPayload: %s\n\n'
```

With `PROPAGATE_KAFKA_CONTEXT=true`, the `Headers:` line for a recent message shows `traceparent=00-<trace id>-<span id>-01` and, if baggage was active on the request that produced it, `baggage=cart.id=...` alongside it — the exact two headers `inject_headers` (Python), the Java agent, and SmallRye's connector all write under the hood. With the toggle set to `false`, that same field is empty: no `traceparent`, no `baggage`, nothing for a consumer to extract even if it wanted to. This is a stronger check than looking at Tempo, because it rules out a whole class of consumer-side bugs — a broken extraction call, a context that was extracted but never attached — by confirming the fact further upstream: either the producer wrote the header or it did not, independent of what any consumer later does with it.

## Two consumers, one producer, two children of the same span

The order-placed topic has two independent consumer groups in this tutorial, `shipping-spring`/`shipping-quarkus`/`shipping-python` and their `notification-*` counterparts, each reading the same topic as its own consumer group so both receive every message. With propagation on, this produces a trace shape worth knowing how to read: the order service's publish is one span, and both the shipping consumer's processing span and the notification consumer's processing span are children of that same producer span, siblings of each other rather than a chain. A trace waterfall in Grafana for a `PLACED` order shows this directly — the Kafka publish span forks into two parallel branches, one running shipment creation, the other running notification dispatch, both attributing their duration back to the same parent rather than to each other. This is a useful detail when reading a trace under load: a visibly slow notification branch has no bearing on how long the shipping branch took, because Kafka's fan-out to multiple consumer groups is inherently parallel, and the trace shape reflects that parallelism rather than implying any ordering between the two consumers.

## Reading the contrast in Tempo

The practical way to confirm which mode is active, beyond reading configuration, is to look at the trace IDs directly. With propagation on, a single `POST /orders` request produces one trace ID that appears on the order service's span, the inventory and payment gRPC spans, and — after the Kafka hop — the shipping and notification consumers' spans, all under one trace in Tempo's trace view. With propagation off, the same request produces that same trace for the synchronous portion (order, inventory, payment — none of that path crosses Kafka), but the shipping and notification spans appear as separate, unrelated traces, discoverable in Tempo only by searching on attributes like `order_id` embedded in the span data rather than by trace ID, since there no longer is a shared one. Querying each consumer's logs for the `order_id` carried in the message body and comparing their `trace_id` fields against the producer's is the most direct way to confirm which case you are looking at without needing to touch the toggle yourself.

{% include excalidraw.html file="ch13-kafka-context-toggle" alt="With PROPAGATE_KAFKA_CONTEXT true, the order producer injects traceparent and baggage headers into the order.placed Kafka message and the shipping and notification consumers extract them to continue the same trace; with it false, no headers are injected and each consumer starts a new, disconnected root trace" caption="Figure 13.1 — The same Kafka hop, with and without W3C trace context in the message headers" %}

## Codetabs: injecting context on publish, extracting it on consume

{% include codetabs.html langs="Spring Boot|Quarkus|Python" %}

```sh
# services/spring/order/entrypoint.sh
# Kafka trace-context propagation: when PROPAGATE_KAFKA_CONTEXT=false we
# disable producer header injection via a javaagent system property, so the
# trace visibly breaks at the message boundary (consumers start a fresh
# trace). Default true = continue. The consumer side is untouched either way.
if [ "${PROPAGATE_KAFKA_CONTEXT:-true}" = "false" ]; then
  APPEND="${APPEND} -Dotel.instrumentation.kafka.producer-propagation.enabled=false"
fi
```

```properties
# services/quarkus/order/src/main/resources/application.properties
# Kafka trace-context propagation toggle: a runtime per-channel attribute on
# the producer side only. When false, shipping/notification's consumer spans
# start independent root traces instead of continuing this one.
# (quarkus.otel.instrument.messaging is a BUILD-TIME switch that deletes
# messaging spans entirely when false — not what we want here.)
mp.messaging.outgoing.order-placed-out.tracing-enabled=${PROPAGATE_KAFKA_CONTEXT:true}
```

```python
# services/python/order/src/obs/kafka_propagation.py
def inject_headers(existing=None):
    """Return Kafka headers carrying the active trace context, merged with
    any headers the caller already wants to send."""
    headers = list(existing or [])
    if not _enabled():
        return headers
    carrier: dict[str, str] = {}
    propagate.inject(carrier)  # writes 'traceparent' (and 'baggage')
    headers.extend((k, v.encode("utf-8")) for k, v in carrier.items())
    return headers
```

## Codetabs: the consumer side continuing (or not continuing) the trace

{% include codetabs.html langs="Spring Boot|Quarkus|Python" %}

```java
// services/spring/shipping/src/main/java/com/example/otel/shipping/OrderPlacedListener.java
// No tracing code here at all: the OpenTelemetry Java agent auto-instruments
// the Spring Kafka consumer and continues the trace started by the order
// producer (when PROPAGATE_KAFKA_CONTEXT=true); otherwise this span roots.
@KafkaListener(topics = "order.placed", groupId = "shipping-spring")
public void onOrderPlaced(String key, String value) {
    OrderPlacedEvent event = objectMapper.readValue(value, OrderPlacedEvent.class);
    // ... create shipment, publish shipment.created
}
```

```java
// services/quarkus/shipping/src/main/java/com/example/otel/shipping/OrderPlacedListener.java
// The quarkus-opentelemetry extension auto-instruments the Kafka connector
// and continues the trace started by the order producer (when
// PROPAGATE_KAFKA_CONTEXT=true) — again, no tracing code in the handler.
@Incoming("order-placed-in")
@Blocking
public void onOrderPlaced(String value) throws Exception {
    OrderPlacedEvent event = objectMapper.readValue(value, OrderPlacedEvent.class);
    // ... create shipment, publish shipment.created
}
```

```python
# services/python/shipping/src/shipping/worker.py
# The producer injected the trace context into the Kafka message headers
# (when PROPAGATE_KAFKA_CONTEXT=true); here we extract it and open the
# processing span with that context as its parent. Without these two lines
# the span below would start a brand-new, disconnected trace.
async for msg in consumer:
    ctx = extract_context(msg.headers)
    with otel.tracer().start_as_current_span("shipping.handle_order_placed", context=ctx):
        order = msg.value
        shipment_id = await _create_shipment(order)
```

Further reading: the [OpenTelemetry documentation on context propagation](https://opentelemetry.io/docs/concepts/context-propagation/) covers the W3C Trace Context and Baggage formats this chapter's headers carry, independent of any one messaging system's support for them.
