package com.example.otel.payment;

import io.grpc.stub.StreamObserver;
import io.opentelemetry.api.baggage.Baggage;
import io.opentelemetry.api.trace.Span;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

import shop.payment.v1.Payment.AuthorizeRequest;
import shop.payment.v1.Payment.AuthorizeResponse;
import shop.payment.v1.PaymentServiceGrpc;

import java.util.Optional;
import java.util.UUID;

@Component
public class PaymentServiceImpl extends PaymentServiceGrpc.PaymentServiceImplBase {

    private static final Logger log = LoggerFactory.getLogger(PaymentServiceImpl.class);

    // Demo authorization ceiling: $1,000,000.00 in cents.
    private static final long MAX_AUTHORIZED_AMOUNT_CENTS = 100_000_000L;

    private final JdbcClient jdbcClient;

    public PaymentServiceImpl(JdbcClient jdbcClient) {
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
    public void authorize(AuthorizeRequest request, StreamObserver<AuthorizeResponse> responseObserver) {
        String cartId = attachCartBaggage();
        log.info("Authorize orderId={} customerId={} amountCents={} cart={}",
                request.getOrderId(), request.getCustomerId(), request.getAmount().getAmountCents(), cartId);

        Optional<ExistingAuthorization> existing = jdbcClient.sql(
                        "SELECT authorization_id, authorized FROM authorizations WHERE order_id = :orderId")
                .param("orderId", request.getOrderId())
                .query((rs, rowNum) -> new ExistingAuthorization(
                        rs.getString("authorization_id"),
                        rs.getBoolean("authorized")))
                .optional();

        if (existing.isPresent()) {
            ExistingAuthorization ea = existing.get();
            AuthorizeResponse response = AuthorizeResponse.newBuilder()
                    .setAuthorized(ea.authorized())
                    .setAuthorizationId(ea.authorizationId())
                    .setDeclineReason(ea.authorized() ? "" : "amount too large")
                    .build();
            responseObserver.onNext(response);
            responseObserver.onCompleted();
            return;
        }

        long amountCents = request.getAmount().getAmountCents();
        boolean authorized = amountCents <= MAX_AUTHORIZED_AMOUNT_CENTS;
        String authorizationId = UUID.randomUUID().toString();

        jdbcClient.sql("INSERT INTO authorizations (authorization_id, order_id, customer_id, amount_cents, authorized) "
                        + "VALUES (:id, :orderId, :customerId, :amountCents, :authorized)")
                .param("id", authorizationId)
                .param("orderId", request.getOrderId())
                .param("customerId", request.getCustomerId())
                .param("amountCents", amountCents)
                .param("authorized", authorized)
                .update();

        AuthorizeResponse response = AuthorizeResponse.newBuilder()
                .setAuthorized(authorized)
                .setAuthorizationId(authorizationId)
                .setDeclineReason(authorized ? "" : "amount too large")
                .build();

        responseObserver.onNext(response);
        responseObserver.onCompleted();
    }

    private record ExistingAuthorization(String authorizationId, boolean authorized) {
    }
}
