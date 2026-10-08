package com.example.otel.order;

import java.time.OffsetDateTime;

/**
 * Row shape for GET /orders/{id}, matching the `orders` table.
 */
public record OrderRecord(
        String orderId,
        String customerId,
        String sku,
        int quantity,
        long amountCents,
        String status,
        OffsetDateTime createdAt
) {
}
