# proto/

Shared Protocol Buffers contracts for the services' **gRPC** hops, kept at the
repo top level so the Spring Boot, Quarkus, and Python implementations (Phase
3) all compile against one copy of the truth rather than vendoring their own.

```
proto/shop/
  common/v1/common.proto       # shared types (Money)
  inventory/v1/inventory.proto # InventoryService: CheckStock, Reserve
  payment/v1/payment.proto     # PaymentService: Authorize
```

Each language generates its own stubs from these `.proto` files during its
own build (Maven protobuf plugin for Spring Boot/Quarkus, `grpcio-tools` for
Python). The generated code is a build artifact — it is git-ignored and
regenerated per service. Only the `.proto` files are source.

These contracts cover only the synchronous service-to-service calls (order →
inventory, order → payment). The asynchronous hops use **Kafka** with JSON
event payloads (the `order.placed` event consumed by shipping and
notification), and the external edges are **REST** (order service) and
**GraphQL** (review service) — none of which need a proto.
