package com.example.otel.review;

/**
 * GraphQL type Review { id: ID!, sku: String!, rating: Int!, body: String! }.
 * `id` is populated from the `review_id` column (see ReviewResource); the
 * field is named `id` here purely so SmallRye GraphQL maps it onto the
 * built-in `ID` scalar.
 */
public record Review(String id, String sku, int rating, String body) {
}
