# flows/ (Phase 6 — not yet built)

This will hold Flow Designer / IntegrationHub action definitions for Day-2
operations (ECS start/stop/restart/resize, EVS attach/detach/expand, EIP
bind/unbind, RDS start/stop/spec-change/backup, CCE node-pool scaling),
each recording its request, execution status, change association, and
write-back result. Depends on `../provisioning/` (Phase 6) existing first.

See [`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md) for the target
design.
