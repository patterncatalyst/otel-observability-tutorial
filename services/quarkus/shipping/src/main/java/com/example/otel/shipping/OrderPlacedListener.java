package com.example.otel.shipping;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.util.UUID;

import javax.sql.DataSource;

import org.eclipse.microprofile.reactive.messaging.Channel;
import org.eclipse.microprofile.reactive.messaging.Emitter;
import org.eclipse.microprofile.reactive.messaging.Incoming;
import org.eclipse.microprofile.reactive.messaging.Message;
import org.jboss.logging.Logger;

import com.fasterxml.jackson.databind.ObjectMapper;

import io.smallrye.common.annotation.Blocking;
import io.smallrye.reactive.messaging.kafka.api.OutgoingKafkaRecordMetadata;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;

/**
 * Consumes {@code order.placed}, records a shipment, and publishes
 * {@code shipment.created}. No HTTP is involved here: the quarkus-opentelemetry
 * extension auto-instruments the Kafka connector and continues the trace
 * started by the order producer (when PROPAGATE_KAFKA_CONTEXT=true).
 */
@ApplicationScoped
public class OrderPlacedListener {

    private static final Logger LOG = Logger.getLogger(OrderPlacedListener.class);

    @Inject
    ObjectMapper objectMapper;

    @Inject
    DataSource dataSource;

    @Channel("shipment-created-out")
    Emitter<String> shipmentCreatedEmitter;

    @Incoming("order-placed-in")
    @Blocking
    public void onOrderPlaced(String value) throws Exception {
        OrderPlacedEvent event = objectMapper.readValue(value, OrderPlacedEvent.class);

        String shipmentId = UUID.randomUUID().toString();
        try (Connection conn = dataSource.getConnection();
                PreparedStatement stmt = conn.prepareStatement("""
                        INSERT INTO shipments (shipment_id, order_id, sku, quantity, status)
                        VALUES (?, ?, ?, ?, ?)
                        """)) {
            stmt.setString(1, shipmentId);
            stmt.setString(2, event.orderId());
            stmt.setString(3, event.sku());
            stmt.setInt(4, event.quantity());
            stmt.setString(5, "CREATED");
            stmt.executeUpdate();
        }

        ShipmentCreatedEvent shipmentCreated = new ShipmentCreatedEvent(shipmentId, event.orderId(), "CREATED");
        String payload = objectMapper.writeValueAsString(shipmentCreated);
        Message<String> message = Message.of(payload)
                .addMetadata(OutgoingKafkaRecordMetadata.<String>builder().withKey(event.orderId()).build());
        shipmentCreatedEmitter.send(message);

        LOG.infof("shipment created id=%s order=%s", shipmentId, event.orderId());
    }
}
