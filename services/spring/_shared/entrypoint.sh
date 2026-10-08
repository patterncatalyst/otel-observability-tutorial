#!/bin/sh
# Entrypoint for OTel-tutorial Spring Boot services.
#
# Assembles the JVM -javaagent flags from the environment, then hands off to the
# UBI run-java.sh launcher (which honors JAVA_OPTS_APPEND and JAVA_APP_JAR).
#
#   - OpenTelemetry Java agent: always attached. It no-ops when
#     OTEL_SDK_DISABLED=true (the no-telemetry baseline demo).
#   - Kafka trace-context propagation: when PROPAGATE_KAFKA_CONTEXT=false we
#     disable producer header injection, so the trace visibly breaks at the
#     message boundary (consumers start a fresh trace). Default true = continue.
#   - Pyroscope profiling agent: attached only when PYROSCOPE_ADDRESS is set.
set -eu

AGENTS=/deployments/agents
OTEL_JAR="${AGENTS}/opentelemetry-javaagent.jar"
PYRO_JAR="${AGENTS}/pyroscope.jar"

APPEND="${JAVA_OPTS_APPEND:-} -Dserver.address=0.0.0.0"

if [ -f "${OTEL_JAR}" ]; then
  APPEND="${APPEND} -javaagent:${OTEL_JAR}"
fi

if [ "${PROPAGATE_KAFKA_CONTEXT:-true}" = "false" ]; then
  APPEND="${APPEND} -Dotel.instrumentation.kafka.producer-propagation.enabled=false"
fi

if [ -n "${PYROSCOPE_ADDRESS:-}" ] && [ -f "${PYRO_JAR}" ]; then
  APPEND="${APPEND} -javaagent:${PYRO_JAR}"
  export PYROSCOPE_APPLICATION_NAME="${OTEL_SERVICE_NAME:-spring-service}"
  export PYROSCOPE_SERVER_ADDRESS="${PYROSCOPE_ADDRESS}"
  export PYROSCOPE_FORMAT="${PYROSCOPE_FORMAT:-jfr}"
  export PYROSCOPE_PROFILING_INTERVAL="${PYROSCOPE_PROFILING_INTERVAL:-10ms}"
fi

export JAVA_OPTS_APPEND="${APPEND}"
exec /opt/jboss/container/java/run/run-java.sh
