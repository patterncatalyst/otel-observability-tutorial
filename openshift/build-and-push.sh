#!/usr/bin/env bash
# openshift/build-and-push.sh
#
# Builds the six domain-service Containerfiles for one language track
# (services/<language>/<domain>/Containerfile) and pushes each image to
# OpenShift's integrated registry under the exact ref
# openshift/helm/otel-observability's values.yaml composes:
#   <registry>/otel-observability/otel-tutorial-<domain>-<language>:<tag>
#
# This is the OpenShift-registry equivalent of what
# `podman compose -f stack/compose.yaml --profile <language> build` does
# locally against stack/compose.yaml's per-language service blocks — same
# six Containerfiles, same build contexts, different destination.
#
# Usage:
#   ./openshift/build-and-push.sh -r "$REG" -n otel-observability [-l python] [-t v1]
#
# Prerequisites (see _docs/25-appendix-openshift-crc.md):
#   - oc login'd to the target cluster
#   - the integrated registry's default Route exposed and podman logged in
#     to it (the chapter's "Expose the integrated registry" step)
#   - the target project/namespace already created (`oc new-project`)
set -euo pipefail

LANGUAGE="python"
TAG="v1"
REGISTRY=""
NAMESPACE=""
DOMAINS=(order review inventory payment shipping notification)

usage() {
  echo "Usage: $0 -r REGISTRY -n NAMESPACE [-l LANGUAGE] [-t TAG]" >&2
  exit 1
}

while getopts "r:n:l:t:h" opt; do
  case "$opt" in
    r) REGISTRY="$OPTARG" ;;
    n) NAMESPACE="$OPTARG" ;;
    l) LANGUAGE="$OPTARG" ;;
    t) TAG="$OPTARG" ;;
    h|*) usage ;;
  esac
done

[ -n "$REGISTRY" ] || usage
[ -n "$NAMESPACE" ] || usage

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo ">> Building and pushing the ${LANGUAGE} track to ${REGISTRY}/${NAMESPACE} (tag ${TAG})"

for domain in "${DOMAINS[@]}"; do
  ctx="${ROOT_DIR}/services/${LANGUAGE}/${domain}"
  if [ ! -d "$ctx" ]; then
    echo "   skip ${domain}: ${ctx} does not exist" >&2
    continue
  fi
  ref="${REGISTRY}/${NAMESPACE}/otel-tutorial-${domain}-${LANGUAGE}:${TAG}"
  echo "   building ${domain} -> ${ref}"
  podman build -f "${ctx}/Containerfile" -t "${ref}" "${ctx}"
  echo "   pushing  ${ref}"
  podman push --tls-verify=false "${ref}"
done

echo ">> Done. Point openshift/helm/otel-observability's values.yaml (or --set) at:"
echo "   image.registry=${REGISTRY}/${NAMESPACE}  image.tag=${TAG}  language=${LANGUAGE}"
