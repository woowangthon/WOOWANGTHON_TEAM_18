# Student app chart and Render stage (W5) — lessons

## Log

- 2026-11-10: The design gave CPU and memory defaults only. With ephemeral storage left to the LimitRange (limit 8Gi), 3 services × 2 slots = 48Gi > the 40Gi quota, so the last target-slot Pod would never be created. The coordination session accepted adding 1Gi / 4Gi and checking ephemeral storage and Pods in the quota sum.
- 2026-11-10: `kubectl apply --dry-run=server` prints "Error from server (...)" text, not the Status JSON the agent contract asks for. Asked the user (direct API call / parse `-v=8` / keep the text); the dry-run is one function (`kubectlDryRun`) until then.
- 2026-11-10: Traefik middlewares are Ingress annotations, so they apply to every path of that Ingress: a per-service `stripPrefix` does not fit "one open Ingress per project". The chart refuses `stripPrefix: true` instead of ignoring it until the user decides.
- 2026-11-10: Ran a throwaway k3s v1.34.1 in docker (`mirror.gcr.io/rancher/k3s`) with `Infra/student/space.yaml` and `Infra/platform/policies.yaml`: the rendered slot and open manifests pass server dry run, the student-pods policy rejects a Deployment with the token on, and applying both slots gives 6 Pods inside the quota (limits.cpu 6/8, ephemeral 24Gi/40Gi). Pods do not start there (no image pulls through the sandbox proxy); admission is what was checked.
- 2026-11-10: YAML comments inside templates are copied into every manifest; template comments (`{{- /* */}}`) are not.

## Lessons

- A throwaway k3s in docker is enough to test admission (quota, Pod Security, ValidatingAdmissionPolicy) without a real cluster: the API answers even when no Pod can run.
