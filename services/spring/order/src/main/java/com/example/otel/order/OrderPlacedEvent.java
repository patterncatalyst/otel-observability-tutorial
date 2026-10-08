package com.example.otel.order;

/**
 * JSON shape published to the Kafka topic `order.placed`, per the shared
 * event contract in services/spring/_shared/pom-snippets.md.
 */
public record OrderPlacedEvent(
        String orderId,
        String customerId,
        String sku,
        int quantity,
        long amountCents,
        String status,
        String cartId
) {
}
