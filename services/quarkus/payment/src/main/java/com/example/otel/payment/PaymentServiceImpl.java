package com.example.otel.payment;

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

import shop.payment.v1.MutinyPaymentServiceGrpc;
import shop.payment.v1.Payment.AuthorizeRequest;
import shop.payment.v1.Payment.AuthorizeResponse;

@GrpcService
public class PaymentServiceImpl extends MutinyPaymentServiceGrpc.PaymentServiceImplBase {

    private static final Logger LOG = Logger.getLogger(PaymentServiceImpl.class);

    // Demo authorization ceiling: $1,000,000.00 in cents.
    private static final long MAX_AUTHORIZED_AMOUNT_CENTS = 100_000_000L;

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
    public Uni<AuthorizeResponse> authorize(AuthorizeRequest request) {
        String cartId = attachCartBaggage();
        LOG.infof("Authorize orderId=%s customerId=%s amountCents=%d cart=%s",
                request.getOrderId(), request.getCustomerId(), request.getAmount().getAmountCents(), cartId);

        try (Connection conn = dataSource.getConnection()) {
            ExistingAuthorization existing = selectExisting(conn, request.getOrderId());
            if (existing != null) {
                AuthorizeResponse response = AuthorizeResponse.newBuilder()
                        .setAuthorized(existing.authorized())
                        .setAuthorizationId(existing.authorizationId())
                        .setDeclineReason(existing.authorized() ? "" : "amount too large")
                        .build();
                return Uni.createFrom().item(response);
            }

            long amountCents = request.getAmount().getAmountCents();
            boolean authorized = amountCents <= MAX_AUTHORIZED_AMOUNT_CENTS;
            String authorizationId = UUID.randomUUID().toString();

            try (PreparedStatement insert = conn.prepareStatement(
                    "INSERT INTO authorizations (authorization_id, order_id, customer_id, amount_cents, authorized) "
                            + "VALUES (?, ?, ?, ?, ?)")) {
                insert.setString(1, authorizationId);
                insert.setString(2, request.getOrderId());
                insert.setString(3, request.getCustomerId());
                insert.setLong(4, amountCents);
                insert.setBoolean(5, authorized);
                insert.executeUpdate();
            }

            AuthorizeResponse response = AuthorizeResponse.newBuilder()
                    .setAuthorized(authorized)
                    .setAuthorizationId(authorizationId)
                    .setDeclineReason(authorized ? "" : "amount too large")
                    .build();
            return Uni.createFrom().item(response);
        } catch (Exception e) {
            return Uni.createFrom().failure(e);
        }
    }

    private ExistingAuthorization selectExisting(Connection conn, String orderId) throws Exception {
        try (PreparedStatement stmt = conn.prepareStatement(
                "SELECT authorization_id, authorized FROM authorizations WHERE order_id = ?")) {
            stmt.setString(1, orderId);
            try (ResultSet rs = stmt.executeQuery()) {
                if (!rs.next()) {
                    return null;
                }
                return new ExistingAuthorization(rs.getString("authorization_id"), rs.getBoolean("authorized"));
            }
        }
    }

    private record ExistingAuthorization(String authorizationId, boolean authorized) {
    }
}
