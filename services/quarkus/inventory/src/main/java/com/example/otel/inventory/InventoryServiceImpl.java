package com.example.otel.inventory;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.util.UUID;

import javax.sql.DataSource;

import org.jboss.logging.Logger;

import io.opentelemetry.api.baggage.Baggage;
import io.opentelemetry.api.trace.Span;
import io.quarkus.grpc.GrpcService;
import io.smallrye.common.annotation.Blocking;
import io.smallrye.mutiny.Uni;
import jakarta.inject.Inject;

import shop.inventory.v1.Inventory.CheckStockRequest;
import shop.inventory.v1.Inventory.CheckStockResponse;
import shop.inventory.v1.Inventory.ReserveRequest;
import shop.inventory.v1.Inventory.ReserveResponse;
import shop.inventory.v1.MutinyInventoryServiceGrpc;

@GrpcService
public class InventoryServiceImpl extends MutinyInventoryServiceGrpc.InventoryServiceImplBase {

    private static final Logger LOG = Logger.getLogger(InventoryServiceImpl.class);

    @Inject
    DataSource dataSource;

    private String attachCartBaggage() {
        String cartId = Baggage.current().getEntryValue("cart.id");
        if (cartId != null) {
            Span.current().setAttribute("cart.id", cartId);
        }
        return cartId;
    }

    @Override
    @Blocking
    public Uni<CheckStockResponse> checkStock(CheckStockRequest request) {
        String cartId = attachCartBaggage();
        LOG.infof("CheckStock sku=%s quantity=%d cart=%s", request.getSku(), request.getQuantity(), cartId);

        try {
            Integer onHand = selectOnHand(request.getSku());
            boolean available = onHand != null && onHand >= request.getQuantity();

            CheckStockResponse response = CheckStockResponse.newBuilder()
                    .setAvailable(available)
                    .setOnHand(onHand != null ? onHand : 0)
                    .build();
            return Uni.createFrom().item(response);
        } catch (Exception e) {
            return Uni.createFrom().failure(e);
        }
    }

    @Override
    @Blocking
    public Uni<ReserveResponse> reserve(ReserveRequest request) {
        String cartId = attachCartBaggage();
        LOG.infof("Reserve orderId=%s sku=%s quantity=%d cart=%s",
                request.getOrderId(), request.getSku(), request.getQuantity(), cartId);

        try (Connection conn = dataSource.getConnection()) {
            String existingReservationId = selectExistingReservation(conn, request.getOrderId(), request.getSku());
            if (existingReservationId != null) {
                Integer onHand = selectOnHand(conn, request.getSku());
                ReserveResponse response = ReserveResponse.newBuilder()
                        .setReserved(true)
                        .setReservationId(existingReservationId)
                        .setRemaining(onHand != null ? onHand : 0)
                        .build();
                return Uni.createFrom().item(response);
            }

            String reservationId = UUID.randomUUID().toString();
            try (PreparedStatement insert = conn.prepareStatement(
                    "INSERT INTO reservations (reservation_id, order_id, sku, quantity) VALUES (?, ?, ?, ?)")) {
                insert.setString(1, reservationId);
                insert.setString(2, request.getOrderId());
                insert.setString(3, request.getSku());
                insert.setInt(4, request.getQuantity());
                insert.executeUpdate();
            }

            try (PreparedStatement update = conn.prepareStatement(
                    "UPDATE stock SET on_hand = on_hand - ? WHERE sku = ?")) {
                update.setInt(1, request.getQuantity());
                update.setString(2, request.getSku());
                update.executeUpdate();
            }

            Integer remaining = selectOnHand(conn, request.getSku());
            ReserveResponse response = ReserveResponse.newBuilder()
                    .setReserved(true)
                    .setReservationId(reservationId)
                    .setRemaining(remaining != null ? remaining : 0)
                    .build();
            return Uni.createFrom().item(response);
        } catch (Exception e) {
            return Uni.createFrom().failure(e);
        }
    }

    private Integer selectOnHand(String sku) throws Exception {
        try (Connection conn = dataSource.getConnection()) {
            return selectOnHand(conn, sku);
        }
    }

    private Integer selectOnHand(Connection conn, String sku) throws Exception {
        try (PreparedStatement stmt = conn.prepareStatement("SELECT on_hand FROM stock WHERE sku = ?")) {
            stmt.setString(1, sku);
            try (ResultSet rs = stmt.executeQuery()) {
                return rs.next() ? rs.getInt("on_hand") : null;
            }
        }
    }

    private String selectExistingReservation(Connection conn, String orderId, String sku) throws Exception {
        try (PreparedStatement stmt = conn.prepareStatement(
                "SELECT reservation_id FROM reservations WHERE order_id = ? AND sku = ?")) {
            stmt.setString(1, orderId);
            stmt.setString(2, sku);
            try (ResultSet rs = stmt.executeQuery()) {
                return rs.next() ? rs.getString("reservation_id") : null;
            }
        }
    }
}
