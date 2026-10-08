package com.example.otel.notification;

import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;

import tools.jackson.databind.ObjectMapper;

/**
 * Consumes {@code order.placed} and records a notification. No HTTP is
 * involved here: the OpenTelemetry Java agent auto-instruments the Spring
 * Kafka consumer and continues the trace started by the order producer (when
 * PROPAGATE_KAFKA_CONTEXT=true).
 */
@Component
public class OrderPlacedListener {

    private static final Logger log = LoggerFactory.getLogger(OrderPlacedListener.class);

    private final ObjectMapper objectMapper;
    private final JdbcClient jdbcClient;

    public OrderPlacedListener(ObjectMapper objectMapper, JdbcClient jdbcClient) {
        this.objectMapper = objectMapper;
        this.jdbcClient = jdbcClient;
    }

    @KafkaListener(topics = "order.placed", groupId = "notification-spring")
    public void onOrderPlaced(String key, String value) {
        OrderPlacedEvent event = objectMapper.readValue(value, OrderPlacedEvent.class);

        String notificationId = UUID.randomUUID().toString();
        jdbcClient.sql("""
                INSERT INTO notifications (notification_id, order_id, channel, status)
                VALUES (:notificationId, :orderId, :channel, :status)
                """)
                .param("notificationId", notificationId)
                .param("orderId", event.orderId())
                .param("channel", "email")
                .param("status", "sent")
                .update();

        log.info("notification sent order={}", event.orderId());
    }
}
