# Shared pom.xml building blocks (pinned)

All services use these. Copy the blocks you need into each service's `pom.xml`.

## Parent + properties

```xml
<parent>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-parent</artifactId>
    <version>4.1.1</version>
    <relativePath/>
</parent>

<properties>
    <java.version>25</java.version>
    <grpc.version>1.84.1</grpc.version>
    <protobuf.version>3.25.9</protobuf.version>
    <otel.instrumentation.version>2.32.0</otel.instrumentation.version>
    <pyroscope.version>2.9.2</pyroscope.version>
</properties>
```

## dependencyManagement (BOM imports)

```xml
<dependencyManagement>
    <dependencies>
        <!-- OTel API (agent provides the implementation at runtime) -->
        <dependency>
            <groupId>io.opentelemetry</groupId>
            <artifactId>opentelemetry-bom</artifactId>
            <version>1.54.0</version>
            <type>pom</type>
            <scope>import</scope>
        </dependency>
        <!-- gRPC (only needed by gRPC services + the order client) -->
        <dependency>
            <groupId>io.grpc</groupId>
            <artifactId>grpc-bom</artifactId>
            <version>${grpc.version}</version>
            <type>pom</type>
            <scope>import</scope>
        </dependency>
    </dependencies>
</dependencyManagement>
```

## OTel API dependency (needed anywhere you touch baggage/spans in code)

```xml
<dependency>
    <groupId>io.opentelemetry</groupId>
    <artifactId>opentelemetry-api</artifactId>
</dependency>
```

## Copy Java agents into target/agents (ALL services)

This runs in the `package` phase so the Containerfile build stage can COPY
`target/agents/*.jar` into the runtime image.

```xml
<plugin>
    <groupId>org.apache.maven.plugins</groupId>
    <artifactId>maven-dependency-plugin</artifactId>
    <executions>
        <execution>
            <id>copy-agents</id>
            <phase>package</phase>
            <goals><goal>copy</goal></goals>
            <configuration>
                <artifactItems>
                    <artifactItem>
                        <groupId>io.opentelemetry.javaagent</groupId>
                        <artifactId>opentelemetry-javaagent</artifactId>
                        <version>${otel.instrumentation.version}</version>
                        <destFileName>opentelemetry-javaagent.jar</destFileName>
                    </artifactItem>
                    <artifactItem>
                        <groupId>io.pyroscope</groupId>
                        <artifactId>agent</artifactId>
                        <version>${pyroscope.version}</version>
                        <destFileName>pyroscope.jar</destFileName>
                    </artifactItem>
                </artifactItems>
                <outputDirectory>${project.build.directory}/agents</outputDirectory>
                <overWriteReleases>true</overWriteReleases>
            </configuration>
        </execution>
    </executions>
</plugin>
```

## gRPC codegen (gRPC services + the order client only)

Dependencies:

```xml
<dependency><groupId>io.grpc</groupId><artifactId>grpc-netty-shaded</artifactId></dependency>
<dependency><groupId>io.grpc</groupId><artifactId>grpc-protobuf</artifactId></dependency>
<dependency><groupId>io.grpc</groupId><artifactId>grpc-stub</artifactId></dependency>
<dependency><groupId>io.grpc</groupId><artifactId>grpc-services</artifactId></dependency>
<!-- Needed on JDK 9+ for the @Generated annotation referenced by grpc stubs -->
<dependency>
    <groupId>org.apache.tomcat</groupId>
    <artifactId>annotations-api</artifactId>
    <version>6.0.53</version>
    <scope>provided</scope>
</dependency>
```

Build extension + plugin (reads `src/main/proto`, which is a copy of the repo's
`proto/shop/**`):

```xml
<extensions>
    <extension>
        <groupId>kr.motd.maven</groupId>
        <artifactId>os-maven-plugin</artifactId>
        <version>1.7.1</version>
    </extension>
</extensions>
...
<plugin>
    <groupId>org.xolstice.maven.plugins</groupId>
    <artifactId>protobuf-maven-plugin</artifactId>
    <version>0.6.1</version>
    <configuration>
        <protocArtifact>com.google.protobuf:protoc:${protobuf.version}:exe:${os.detected.classifier}</protocArtifact>
        <pluginId>grpc-java</pluginId>
        <pluginArtifact>io.grpc:protoc-gen-grpc-java:${grpc.version}:exe:${os.detected.classifier}</pluginArtifact>
    </configuration>
    <executions>
        <execution>
            <goals>
                <goal>compile</goal>
                <goal>compile-custom</goal>
            </goals>
        </execution>
    </executions>
</plugin>
```

Generated Java packages (from the proto `package` lines):
- `shop.common.v1.*`      (Money)
- `shop.inventory.v1.*`   (InventoryServiceGrpc, CheckStockRequest/Response, Reserve*)
- `shop.payment.v1.*`     (PaymentServiceGrpc, AuthorizeRequest/Response)

## spring-boot-maven-plugin (ALL services)

```xml
<plugin>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-maven-plugin</artifactId>
</plugin>
```

## Kafka event contract (shared between order producer and shipping/notification consumers)

- Topic: `order.placed`
- Key: `orderId` (String), Serializer/Deserializer: **String** on both ends
- Value: **JSON text** (String serializer; serialize/deserialize with Jackson
  ObjectMapper manually — do NOT use spring-kafka JsonSerializer/JsonDeserializer,
  to avoid type-header/trusted-package coupling between services).
- Value JSON shape:

```json
{
  "orderId": "b1e...",
  "customerId": "cust-123",
  "sku": "WIDGET-001",
  "quantity": 2,
  "amountCents": 5000,
  "status": "PLACED",
  "cartId": "cart-abc"
}
```

- shipping also publishes to topic `shipment.created` with JSON value
  `{"shipmentId":"...","orderId":"...","status":"CREATED"}` (String key = orderId).
```
