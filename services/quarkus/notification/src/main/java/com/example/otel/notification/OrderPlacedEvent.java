package com.example.otel.notification;

/**
 * Kafka event contract for the {@code order.placed} topic (shared between the
 * order producer and the shipping/notification consumers). See
 * services/spring/_shared/pom-snippets.md for the canonical shape.
 */
public record OrderPlacedEvent(
        String orderId,
        String customerId,
        String sku,
        int quantity,
        long amountCents,
        String status,
        String cartId) {
}
