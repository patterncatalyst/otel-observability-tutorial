#!/bin/sh
# Entrypoint for OTel-tutorial Quarkus services.
#
# Unlike the Spring Boot services (which attach the OpenTelemetry Java agent),
# these services get traces/metrics/logs from the in-tree quarkus-opentelemetry
# + quarkus-micrometer-opentelemetry extensions, configured entirely through
# application.properties (which reads the OTEL_* env vars compose injects).
# This entrypoint only has to handle what application.properties cannot:
#
#   - gRPC client addressing: INVENTORY_ADDR/PAYMENT_ADDR arrive as a single
#     "host:port" string, but quarkus.grpc.clients.<name>.host/.port are two
#     separate config properties. Split them here into *_HOST/*_PORT env vars
#     that application.properties reads (no-op on services that don't set
#     INVENTORY_ADDR/PAYMENT_ADDR, e.g. inventory/payment/review/shipping/
#     notification).
#   - Pyroscope profiling agent: attached only when PYROSCOPE_ADDRESS is set,
#     identical gating to the Spring entrypoint.
#
# The Kafka trace-propagation toggle (PROPAGATE_KAFKA_CONTEXT) needs no JVM
# flag here: application.properties wires it straight to the order producer's
# `tracing-enabled` channel attribute, read at runtime from the environment.
#
#   - java.util.logging.manager: MUST be set as a -D JVM flag (not left to
#     Quarkus's own bootstrap) because the Pyroscope agent's premain touches
#     java.util.logging before Quarkus's main() gets a chance to install the
#     JBoss LogManager, permanently locking in the JDK's default LogManager
#     singleton otherwise. Once that happens, quarkus.log.* config is silently
#     ignored and the OTLP log appender never attaches. Setting it as a
#     command-line -D flag makes it visible before any -javaagent premain runs.
set -eu

AGENTS=/deployments/agents
PYRO_JAR="${AGENTS}/pyroscope.jar"

split_addr() {
  # split_addr ADDR HOST_VAR PORT_VAR
  addr="$1"
  host="${addr%%:*}"
  port="${addr##*:}"
  eval "$2=\"\${host}\""
  eval "$3=\"\${port}\""
}

if [ -n "${INVENTORY_ADDR:-}" ]; then
  split_addr "${INVENTORY_ADDR}" INVENTORY_HOST INVENTORY_PORT
  export INVENTORY_HOST INVENTORY_PORT
fi

if [ -n "${PAYMENT_ADDR:-}" ]; then
  split_addr "${PAYMENT_ADDR}" PAYMENT_HOST PAYMENT_PORT
  export PAYMENT_HOST PAYMENT_PORT
fi

APPEND="${JAVA_OPTS_APPEND:-} -Dquarkus.http.host=0.0.0.0 -Djava.util.logging.manager=org.jboss.logmanager.LogManager"

if [ -n "${PYROSCOPE_ADDRESS:-}" ] && [ -f "${PYRO_JAR}" ]; then
  APPEND="${APPEND} -javaagent:${PYRO_JAR}"
  export PYROSCOPE_APPLICATION_NAME="${OTEL_SERVICE_NAME:-quarkus-service}"
  export PYROSCOPE_SERVER_ADDRESS="${PYROSCOPE_ADDRESS}"
  export PYROSCOPE_FORMAT="${PYROSCOPE_FORMAT:-jfr}"
  export PYROSCOPE_PROFILING_INTERVAL="${PYROSCOPE_PROFILING_INTERVAL:-10ms}"
fi

export JAVA_OPTS_APPEND="${APPEND}"
exec /opt/jboss/container/java/run/run-java.sh
