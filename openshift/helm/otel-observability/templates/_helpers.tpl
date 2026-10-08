{{/*
Common labels applied to every object in this chart, following the
Kubernetes recommended label set.
*/}}
{{- define "otel-observability.labels" -}}
app.kubernetes.io/part-of: otel-observability-tutorial
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version }}
{{- end -}}

{{/*
In-cluster DNS suffix for the release namespace, e.g.
otel-observability.svc.cluster.local — every cross-service URL in this
chart is built from this, not a hardcoded namespace, so `helm install` works
unmodified into whatever namespace a reader creates with `oc new-project`.
*/}}
{{- define "otel-observability.dns" -}}
{{ .Release.Namespace }}.svc.cluster.local
{{- end -}}

{{/*
Resolve a domain service's image ref: <registry>/otel-tutorial-<name>-<language>:<tag>,
the OpenShift-registry equivalent of stack/compose.yaml's
localhost/otel-tutorial-<name>-<language>:dev build target.
*/}}
{{- define "otel-observability.image" -}}
{{- $root := index . 0 -}}
{{- $name := index . 1 -}}
{{ $root.Values.image.registry }}/otel-tutorial-{{ $name }}-{{ $root.Values.language }}:{{ $root.Values.image.tag }}
{{- end -}}
