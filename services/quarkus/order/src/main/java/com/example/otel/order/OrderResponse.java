package com.example.otel.order;

/**
 * Response body for POST /orders.
 */
public record OrderResponse(
        String orderId,
        String customerId,
        String sku,
        int quantity,
        long amountCents,
        String status
) {
}
