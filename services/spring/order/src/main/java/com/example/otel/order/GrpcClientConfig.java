package com.example.otel.order;

import io.grpc.ManagedChannel;
import io.grpc.ManagedChannelBuilder;
import jakarta.annotation.PreDestroy;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import shop.inventory.v1.InventoryServiceGrpc;
import shop.payment.v1.PaymentServiceGrpc;

import java.util.concurrent.TimeUnit;

/**
 * Plain grpc-java (io.grpc) clients to the inventory and payment services.
 * No Spring gRPC / net.devh starter — channels are built directly with
 * ManagedChannelBuilder and left in plaintext, matching the rest of the
 * tutorial's in-cluster service-to-service calls. The OpenTelemetry Java
 * agent instruments io.grpc automatically, so trace context (and baggage,
 * via OTEL_PROPAGATORS) propagates across these calls without any extra code.
 */
@Configuration
public class GrpcClientConfig {

    private ManagedChannel inventoryChannel;
    private ManagedChannel paymentChannel;

    @Bean
    public ManagedChannel inventoryChannel(@Value("${inventory.addr}") String inventoryAddr) {
        this.inventoryChannel = ManagedChannelBuilder.forTarget(inventoryAddr).usePlaintext().build();
        return this.inventoryChannel;
    }

    @Bean
    public ManagedChannel paymentChannel(@Value("${payment.addr}") String paymentAddr) {
        this.paymentChannel = ManagedChannelBuilder.forTarget(paymentAddr).usePlaintext().build();
        return this.paymentChannel;
    }

    @Bean
    public InventoryServiceGrpc.InventoryServiceBlockingStub inventoryServiceBlockingStub(ManagedChannel inventoryChannel) {
        return InventoryServiceGrpc.newBlockingStub(inventoryChannel);
    }

    @Bean
    public PaymentServiceGrpc.PaymentServiceBlockingStub paymentServiceBlockingStub(ManagedChannel paymentChannel) {
        return PaymentServiceGrpc.newBlockingStub(paymentChannel);
    }

    @PreDestroy
    public void shutdown() {
        if (inventoryChannel != null) {
            inventoryChannel.shutdownNow();
            try {
                inventoryChannel.awaitTermination(5, TimeUnit.SECONDS);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        }
        if (paymentChannel != null) {
            paymentChannel.shutdownNow();
            try {
                paymentChannel.awaitTermination(5, TimeUnit.SECONDS);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        }
    }
}
