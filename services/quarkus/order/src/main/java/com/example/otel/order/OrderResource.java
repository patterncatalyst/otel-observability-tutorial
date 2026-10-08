package com.example.otel.order;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Duration;
import java.util.UUID;

import javax.sql.DataSource;

import org.eclipse.microprofile.reactive.messaging.Channel;
import org.eclipse.microprofile.reactive.messaging.Emitter;
import org.eclipse.microprofile.reactive.messaging.Message;
import org.jboss.logging.Logger;

import com.fasterxml.jackson.databind.ObjectMapper;

import io.micrometer.core.instrument.MeterRegistry;
import io.opentelemetry.api.baggage.Baggage;
import io.opentelemetry.context.Scope;
import io.quarkus.grpc.GrpcClient;
import io.smallrye.reactive.messaging.kafka.api.OutgoingKafkaRecordMetadata;
import jakarta.inject.Inject;
import jakarta.validation.Valid;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.HeaderParam;
import jakarta.ws.rs.NotFoundException;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;

import shop.common.v1.Common.Money;
import shop.inventory.v1.Inventory.CheckStockRequest;
import shop.inventory.v1.Inventory.CheckStockResponse;
import shop.inventory.v1.MutinyInventoryServiceGrpc;
import shop.payment.v1.MutinyPaymentServiceGrpc;
import shop.payment.v1.Payment.AuthorizeRequest;
import shop.payment.v1.Payment.AuthorizeResponse;

/**
 * Order REST API. POST /orders is the critical trace path for the tutorial:
 * one trace spans this REST request, the inventory + payment gRPC calls, the
 * Postgres insert, and the order.placed Kafka publish. Unlike the Spring Boot
 * sibling (which gets this propagation from the OpenTelemetry Java agent),
 * here it comes from the in-tree quarkus-opentelemetry extension, which
 * auto-instruments Quarkus REST, the gRPC client stubs and the Kafka emitter.
 * The only code added here for tracing is the `cart.id` baggage entry that
 * rides along for the downstream calls.
 */
@Path("/orders")
public class OrderResource {

    private static final Logger LOG = Logger.getLogger(OrderResource.class);
    private static final long UNIT_PRICE_CENTS = 2500L;
    private static final int MAX_RETRIES = 5;
    private static final long RETRY_DELAY_MILLIS = 1000L;
    private static final Duration GRPC_TIMEOUT = Duration.ofSeconds(5);

    @Inject
    DataSource dataSource;

    @Inject
    MeterRegistry meterRegistry;

    @Inject
    ObjectMapper objectMapper;

    @GrpcClient("inventory")
    MutinyInventoryServiceGrpc.MutinyInventoryServiceStub inventoryStub;

    @GrpcClient("payment")
    MutinyPaymentServiceGrpc.MutinyPaymentServiceStub paymentStub;

    @Channel("order-placed-out")
    Emitter<String> orderPlacedEmitter;

    @POST
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response createOrder(@Valid OrderRequest request,
            @HeaderParam("X-Cart-Id") String cartIdHeader) throws SQLException {
        String orderId = UUID.randomUUID().toString();
        String cartId = resolveCartId(request.cartId(), cartIdHeader);
        long amountCents = request.quantity() * UNIT_PRICE_CENTS;

        String status;
        try (Scope scope = Baggage.current().toBuilder().put("cart.id", cartId).build().makeCurrent()) {
            boolean available = checkStockWithRetry(request.sku(), request.quantity());

            boolean authorized = false;
            if (available) {
                authorized = authorizeWithRetry(orderId, request.customerId(), amountCents);
            }

            status = (available && authorized) ? "PLACED" : "REJECTED";

            insertOrder(orderId, request, amountCents, status);

            if ("PLACED".equals(status)) {
                publishOrderPlaced(new OrderPlacedEvent(orderId, request.customerId(), request.sku(),
                        request.quantity(), amountCents, status, cartId));
            }
        }

        meterRegistry.counter("orders_placed_total", "status", status).increment();
        LOG.infof("order placed id=%s status=%s cart=%s", orderId, status, cartId);

        OrderResponse response = new OrderResponse(orderId, request.customerId(), request.sku(),
                request.quantity(), amountCents, status);
        return Response.status(Response.Status.CREATED).entity(response).build();
    }

    @GET
    @Path("/{id}")
    @Produces(MediaType.APPLICATION_JSON)
    public Response getOrder(@PathParam("id") String id) throws SQLException {
        try (Connection conn = dataSource.getConnection();
                PreparedStatement stmt = conn.prepareStatement("""
                        SELECT order_id, customer_id, sku, quantity, amount_cents, status, created_at
                        FROM orders WHERE order_id = ?
                        """)) {
            stmt.setString(1, id);
            try (ResultSet rs = stmt.executeQuery()) {
                if (!rs.next()) {
                    throw new NotFoundException();
                }
                OrderRecord record = new OrderRecord(
                        rs.getString("order_id"),
                        rs.getString("customer_id"),
                        rs.getString("sku"),
                        rs.getInt("quantity"),
                        rs.getLong("amount_cents"),
                        rs.getString("status"),
                        rs.getObject("created_at", java.time.OffsetDateTime.class));
                return Response.ok(record).build();
            }
        }
    }

    private String resolveCartId(String bodyCartId, String headerCartId) {
        if (bodyCartId != null && !bodyCartId.isBlank()) {
            return bodyCartId;
        }
        if (headerCartId != null && !headerCartId.isBlank()) {
            return headerCartId;
        }
        return "cart-" + UUID.randomUUID().toString().substring(0, 8);
    }

    private void insertOrder(String orderId, OrderRequest request, long amountCents, String status)
            throws SQLException {
        try (Connection conn = dataSource.getConnection();
                PreparedStatement stmt = conn.prepareStatement("""
                        INSERT INTO orders (order_id, customer_id, sku, quantity, amount_cents, status)
                        VALUES (?, ?, ?, ?, ?, ?)
                        """)) {
            stmt.setString(1, orderId);
            stmt.setString(2, request.customerId());
            stmt.setString(3, request.sku());
            stmt.setInt(4, request.quantity());
            stmt.setLong(5, amountCents);
            stmt.setString(6, status);
            stmt.executeUpdate();
        }
    }

    private void publishOrderPlaced(OrderPlacedEvent event) {
        try {
            String json = objectMapper.writeValueAsString(event);
            Message<String> message = Message.of(json)
                    .addMetadata(OutgoingKafkaRecordMetadata.<String>builder().withKey(event.orderId()).build());
            orderPlacedEmitter.send(message);
        } catch (Exception e) {
            throw new IllegalStateException("failed to publish order.placed", e);
        }
    }

    private boolean checkStockWithRetry(String sku, int quantity) {
        RuntimeException lastFailure = null;
        for (int attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                CheckStockResponse response = inventoryStub.checkStock(CheckStockRequest.newBuilder()
                                .setSku(sku)
                                .setQuantity(quantity)
                                .build())
                        .await().atMost(GRPC_TIMEOUT);
                return response.getAvailable();
            } catch (RuntimeException e) {
                lastFailure = e;
                LOG.warnf("inventory CheckStock attempt %d/%d failed: %s", attempt, MAX_RETRIES, e.getMessage());
                sleepBeforeRetry();
            }
        }
        throw new IllegalStateException("inventory CheckStock failed after " + MAX_RETRIES + " attempts", lastFailure);
    }

    private boolean authorizeWithRetry(String orderId, String customerId, long amountCents) {
        RuntimeException lastFailure = null;
        for (int attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                AuthorizeResponse response = paymentStub.authorize(AuthorizeRequest.newBuilder()
                                .setOrderId(orderId)
                                .setCustomerId(customerId)
                                .setAmount(Money.newBuilder().setAmountCents(amountCents).setCurrency("USD").build())
                                .build())
                        .await().atMost(GRPC_TIMEOUT);
                return response.getAuthorized();
            } catch (RuntimeException e) {
                lastFailure = e;
                LOG.warnf("payment Authorize attempt %d/%d failed: %s", attempt, MAX_RETRIES, e.getMessage());
                sleepBeforeRetry();
            }
        }
        throw new IllegalStateException("payment Authorize failed after " + MAX_RETRIES + " attempts", lastFailure);
    }

    private void sleepBeforeRetry() {
        try {
            Thread.sleep(RETRY_DELAY_MILLIS);
        } catch (InterruptedException ie) {
            Thread.currentThread().interrupt();
        }
    }
}
