---
"@runfusion/fusion": patch
---

Prototype optional rootless container `SandboxBackend` (Podman-first, Docker-compatible) behind the FN-4636 seam. Off by default; reachable only via explicit `resolveSandboxBackend({ backendId: "podman" | "docker" })`. No settings, audit, or action-gate wiring yet (FN-4639/FN-4640/FN-4641).
