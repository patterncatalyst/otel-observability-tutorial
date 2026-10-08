package com.example.otel.order;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

/**
 * Request body for POST /orders.
 */
public record OrderRequest(
        @NotBlank String customerId,
        @NotBlank String sku,
        @NotNull @Min(1) Integer quantity,
        String cartId
) {
}
