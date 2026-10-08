package com.example.otel.shipping;

/** JSON value shape published to the {@code shipment.created} topic. */
public record ShipmentCreatedEvent(String shipmentId, String orderId, String status) {
}
