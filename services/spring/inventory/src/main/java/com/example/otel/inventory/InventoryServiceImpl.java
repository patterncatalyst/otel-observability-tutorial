package com.example.otel.inventory;

import io.grpc.stub.StreamObserver;
import io.opentelemetry.api.baggage.Baggage;
import io.opentelemetry.api.trace.Span;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

import shop.inventory.v1.Inventory.CheckStockRequest;
import shop.inventory.v1.Inventory.CheckStockResponse;
import shop.inventory.v1.Inventory.ReserveRequest;
import shop.inventory.v1.Inventory.ReserveResponse;
import shop.inventory.v1.InventoryServiceGrpc;

import java.util.Optional;
import java.util.UUID;

@Component
public class InventoryServiceImpl extends InventoryServiceGrpc.InventoryServiceImplBase {

    private static final Logger log = LoggerFactory.getLogger(InventoryServiceImpl.class);

    private final JdbcClient jdbcClient;

    public InventoryServiceImpl(JdbcClient jdbcClient) {
        this.jdbcClient = jdbcClient;
    }

    private String attachCartBaggage() {
        String cartId = Baggage.current().getEntryValue("cart.id");
        if (cartId != null) {
            Span.current().setAttribute("cart.id", cartId);
        }
        return cartId;
    }

    @Override
    public void checkStock(CheckStockRequest request, StreamObserver<CheckStockResponse> responseObserver) {
        String cartId = attachCartBaggage();
        log.info("CheckStock sku={} quantity={} cart={}", request.getSku(), request.getQuantity(), cartId);

        Integer onHand = jdbcClient.sql("SELECT on_hand FROM stock WHERE sku = :sku")
                .param("sku", request.getSku())
                .query(Integer.class)
                .optional()
                .orElse(null);

        boolean available = onHand != null && onHand >= request.getQuantity();

        CheckStockResponse response = CheckStockResponse.newBuilder()
                .setAvailable(available)
                .setOnHand(onHand != null ? onHand : 0)
                .build();

        responseObserver.onNext(response);
        responseObserver.onCompleted();
    }

    @Override
    public void reserve(ReserveRequest request, StreamObserver<ReserveResponse> responseObserver) {
        String cartId = attachCartBaggage();
        log.info("Reserve orderId={} sku={} quantity={} cart={}",
                request.getOrderId(), request.getSku(), request.getQuantity(), cartId);

        Optional<ExistingReservation> existing = jdbcClient.sql(
                        "SELECT reservation_id, sku FROM reservations WHERE order_id = :orderId AND sku = :sku")
                .param("orderId", request.getOrderId())
                .param("sku", request.getSku())
                .query((rs, rowNum) -> new ExistingReservation(rs.getString("reservation_id")))
                .optional();

        if (existing.isPresent()) {
            Integer onHand = jdbcClient.sql("SELECT on_hand FROM stock WHERE sku = :sku")
                    .param("sku", request.getSku())
                    .query(Integer.class)
                    .optional()
                    .orElse(0);

            ReserveResponse response = ReserveResponse.newBuilder()
                    .setReserved(true)
                    .setReservationId(existing.get().reservationId())
                    .setRemaining(onHand)
                    .build();
            responseObserver.onNext(response);
            responseObserver.onCompleted();
            return;
        }

        String reservationId = UUID.randomUUID().toString();

        jdbcClient.sql("INSERT INTO reservations (reservation_id, order_id, sku, quantity) VALUES (:id, :orderId, :sku, :quantity)")
                .param("id", reservationId)
                .param("orderId", request.getOrderId())
                .param("sku", request.getSku())
                .param("quantity", request.getQuantity())
                .update();

        jdbcClient.sql("UPDATE stock SET on_hand = on_hand - :quantity WHERE sku = :sku")
                .param("quantity", request.getQuantity())
                .param("sku", request.getSku())
                .update();

        Integer remaining = jdbcClient.sql("SELECT on_hand FROM stock WHERE sku = :sku")
                .param("sku", request.getSku())
                .query(Integer.class)
                .optional()
                .orElse(0);

        ReserveResponse response = ReserveResponse.newBuilder()
                .setReserved(true)
                .setReservationId(reservationId)
                .setRemaining(remaining)
                .build();

        responseObserver.onNext(response);
        responseObserver.onCompleted();
    }

    private record ExistingReservation(String reservationId) {
    }
}
