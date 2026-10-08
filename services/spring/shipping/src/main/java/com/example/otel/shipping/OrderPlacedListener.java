package com.example.otel.shipping;

import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Component;

import tools.jackson.databind.ObjectMapper;

/**
 * Consumes {@code order.placed}, records a shipment, and publishes
 * {@code shipment.created}. No HTTP is involved here: the OpenTelemetry Java
 * agent auto-instruments the Spring Kafka consumer and continues the trace
 * started by the order producer (when PROPAGATE_KAFKA_CONTEXT=true).
 */
@Component
public class OrderPlacedListener {

    private static final Logger log = LoggerFactory.getLogger(OrderPlacedListener.class);

    private final ObjectMapper objectMapper;
    private final JdbcClient jdbcClient;
    private final KafkaTemplate<String, String> kafkaTemplate;

    public OrderPlacedListener(ObjectMapper objectMapper, JdbcClient jdbcClient,
            KafkaTemplate<String, String> kafkaTemplate) {
        this.objectMapper = objectMapper;
        this.jdbcClient = jdbcClient;
        this.kafkaTemplate = kafkaTemplate;
    }

    @KafkaListener(topics = "order.placed", groupId = "shipping-spring")
    public void onOrderPlaced(String key, String value) {
        OrderPlacedEvent event = objectMapper.readValue(value, OrderPlacedEvent.class);

        String shipmentId = UUID.randomUUID().toString();
        jdbcClient.sql("""
                INSERT INTO shipments (shipment_id, order_id, sku, quantity, status)
                VALUES (:shipmentId, :orderId, :sku, :quantity, :status)
                """)
                .param("shipmentId", shipmentId)
                .param("orderId", event.orderId())
                .param("sku", event.sku())
                .param("quantity", event.quantity())
                .param("status", "CREATED")
                .update();

        ShipmentCreatedEvent shipmentCreated = new ShipmentCreatedEvent(shipmentId, event.orderId(), "CREATED");
        String payload = objectMapper.writeValueAsString(shipmentCreated);
        kafkaTemplate.send("shipment.created", event.orderId(), payload);

        log.info("shipment created id={} order={}", shipmentId, event.orderId());
    }
}
