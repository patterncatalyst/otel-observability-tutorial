package com.example.otel.notification;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.util.UUID;

import javax.sql.DataSource;

import org.eclipse.microprofile.reactive.messaging.Incoming;
import org.jboss.logging.Logger;

import com.fasterxml.jackson.databind.ObjectMapper;

import io.smallrye.common.annotation.Blocking;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;

/**
 * Consumes {@code order.placed} and records a notification. No HTTP is
 * involved here: the quarkus-opentelemetry extension auto-instruments the
 * Kafka connector and continues the trace started by the order producer
 * (when PROPAGATE_KAFKA_CONTEXT=true).
 */
@ApplicationScoped
public class OrderPlacedListener {

    private static final Logger LOG = Logger.getLogger(OrderPlacedListener.class);

    @Inject
    ObjectMapper objectMapper;

    @Inject
    DataSource dataSource;

    @Incoming("order-placed-in")
    @Blocking
    public void onOrderPlaced(String value) throws Exception {
        OrderPlacedEvent event = objectMapper.readValue(value, OrderPlacedEvent.class);

        String notificationId = UUID.randomUUID().toString();
        try (Connection conn = dataSource.getConnection();
                PreparedStatement stmt = conn.prepareStatement("""
                        INSERT INTO notifications (notification_id, order_id, channel, status)
                        VALUES (?, ?, ?, ?)
                        """)) {
            stmt.setString(1, notificationId);
            stmt.setString(2, event.orderId());
            stmt.setString(3, "email");
            stmt.setString(4, "sent");
            stmt.executeUpdate();
        }

        LOG.infof("notification sent order=%s", event.orderId());
    }
}
