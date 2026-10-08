package com.example.otel.order;

/**
 * JSON shape published to the Kafka topic `order.placed`, matching the shared
 * event contract in services/spring/_shared/pom-snippets.md. Serialized
 * manually with Jackson's ObjectMapper (String producer, no type-header
 * coupling between services).
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
