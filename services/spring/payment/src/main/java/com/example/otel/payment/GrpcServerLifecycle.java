package com.example.otel.payment;

import io.grpc.BindableService;
import io.grpc.Server;
import io.grpc.ServerBuilder;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.SmartLifecycle;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.util.concurrent.TimeUnit;

/**
 * Starts and stops the plain grpc-java server alongside the Spring application
 * lifecycle. The OpenTelemetry Java agent auto-instruments io.grpc.Server, so
 * no manual interceptor wiring is required here.
 */
@Component
public class GrpcServerLifecycle implements SmartLifecycle {

    private static final Logger log = LoggerFactory.getLogger(GrpcServerLifecycle.class);

    private final PaymentServiceImpl paymentService;
    private final int port;

    private Server server;
    private volatile boolean running = false;

    public GrpcServerLifecycle(PaymentServiceImpl paymentService,
                                @Value("${GRPC_PORT:50052}") int port) {
        this.paymentService = paymentService;
        this.port = port;
    }

    @Override
    public void start() {
        try {
            server = ServerBuilder.forPort(port)
                    .addService((BindableService) paymentService)
                    .build()
                    .start();
            running = true;
            log.info("payment gRPC server started on port {}", port);
        } catch (IOException e) {
            throw new IllegalStateException("Failed to start gRPC server on port " + port, e);
        }
    }

    @Override
    public void stop() {
        if (server != null) {
            server.shutdown();
            try {
                if (!server.awaitTermination(5, TimeUnit.SECONDS)) {
                    server.shutdownNow();
                }
            } catch (InterruptedException e) {
                server.shutdownNow();
                Thread.currentThread().interrupt();
            }
        }
        running = false;
        log.info("payment gRPC server stopped");
    }

    @Override
    public boolean isRunning() {
        return running;
    }
}
