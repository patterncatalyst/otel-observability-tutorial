package com.example.otel.order;

import io.micrometer.core.instrument.MeterRegistry;
import io.opentelemetry.api.baggage.Baggage;
import io.opentelemetry.context.Scope;
import jakarta.validation.Valid;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.web.bind.annotation.*;
import shop.common.v1.Common.Money;
import shop.inventory.v1.Inventory.CheckStockRequest;
import shop.inventory.v1.Inventory.CheckStockResponse;
import shop.inventory.v1.InventoryServiceGrpc;
import shop.payment.v1.Payment.AuthorizeRequest;
import shop.payment.v1.Payment.AuthorizeResponse;
import shop.payment.v1.PaymentServiceGrpc;
import tools.jackson.databind.ObjectMapper;

import java.util.Optional;
import java.util.UUID;

/**
 * Order REST API. POST /orders is the critical trace path for the tutorial:
 * one trace spans this REST request, the inventory + payment gRPC calls, the
 * Postgres insert, and the order.placed Kafka publish. The OpenTelemetry
 * Java agent (attached at runtime, see Containerfile/entrypoint.sh) does all
 * context propagation across these hops automatically; the only code we add
 * here is the `cart.id` baggage entry that rides along for the downstream
 * calls.
 */
@RestController
public class OrderController {

    private static final Logger log = LoggerFactory.getLogger(OrderController.class);
    private static final long UNIT_PRICE_CENTS = 2500L;
    private static final int MAX_RETRIES = 5;
    private static final long RETRY_DELAY_MILLIS = 1000L;

    private final JdbcClient jdbcClient;
    private final KafkaTemplate<String, String> kafkaTemplate;
    private final MeterRegistry meterRegistry;
    private final ObjectMapper objectMapper;
    private final InventoryServiceGrpc.InventoryServiceBlockingStub inventoryStub;
    private final PaymentServiceGrpc.PaymentServiceBlockingStub paymentStub;

    public OrderController(JdbcClient jdbcClient,
                            KafkaTemplate<String, String> kafkaTemplate,
                            MeterRegistry meterRegistry,
                            ObjectMapper objectMapper,
                            InventoryServiceGrpc.InventoryServiceBlockingStub inventoryStub,
                            PaymentServiceGrpc.PaymentServiceBlockingStub paymentStub) {
        this.jdbcClient = jdbcClient;
        this.kafkaTemplate = kafkaTemplate;
        this.meterRegistry = meterRegistry;
        this.objectMapper = objectMapper;
        this.inventoryStub = inventoryStub;
        this.paymentStub = paymentStub;
    }

    @PostMapping("/orders")
    public ResponseEntity<OrderResponse> createOrder(@Valid @RequestBody OrderRequest request,
            @RequestHeader(value = "X-Cart-Id", required = false) String cartIdHeader) {
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
        log.info("order placed id={} status={} cart={}", orderId, status, cartId);

        OrderResponse response = new OrderResponse(orderId, request.customerId(), request.sku(),
                request.quantity(), amountCents, status);
        return ResponseEntity.status(HttpStatus.CREATED).body(response);
    }

    @GetMapping("/orders/{id}")
    public ResponseEntity<OrderRecord> getOrder(@PathVariable("id") String id) {
        Optional<OrderRecord> order = jdbcClient.sql("""
                        SELECT order_id, customer_id, sku, quantity, amount_cents, status, created_at
                        FROM orders WHERE order_id = :id
                        """)
                .param("id", id)
                .query(OrderRecord.class)
                .optional();

        return order.map(ResponseEntity::ok).orElseGet(() -> ResponseEntity.notFound().build());
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

    private void insertOrder(String orderId, OrderRequest request, long amountCents, String status) {
        jdbcClient.sql("""
                        INSERT INTO orders (order_id, customer_id, sku, quantity, amount_cents, status)
                        VALUES (:orderId, :customerId, :sku, :quantity, :amountCents, :status)
                        """)
                .param("orderId", orderId)
                .param("customerId", request.customerId())
                .param("sku", request.sku())
                .param("quantity", request.quantity())
                .param("amountCents", amountCents)
                .param("status", status)
                .update();
    }

    private void publishOrderPlaced(OrderPlacedEvent event) {
        String json = objectMapper.writeValueAsString(event);
        kafkaTemplate.send("order.placed", event.orderId(), json);
    }

    private boolean checkStockWithRetry(String sku, int quantity) {
        RuntimeException lastFailure = null;
        for (int attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                CheckStockResponse response = inventoryStub.checkStock(CheckStockRequest.newBuilder()
                        .setSku(sku)
                        .setQuantity(quantity)
                        .build());
                return response.getAvailable();
            } catch (RuntimeException e) {
                lastFailure = e;
                log.warn("inventory CheckStock attempt {}/{} failed: {}", attempt, MAX_RETRIES, e.getMessage());
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
                        .build());
                return response.getAuthorized();
            } catch (RuntimeException e) {
                lastFailure = e;
                log.warn("payment Authorize attempt {}/{} failed: {}", attempt, MAX_RETRIES, e.getMessage());
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
