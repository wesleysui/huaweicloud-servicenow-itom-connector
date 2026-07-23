# service-graph/

Multi-account/region sync orchestrators (`Class.create()` Script Include
templates — paste the generated versions in `../docs/generated/`, never
these hand-written templates directly):

- `HcConnectorEcsSync.js` — ECS discovery orchestrator (Phase 2A, real-PDI
  verified).
- `HcConnectorVpcSync.js` — VPC/Subnet discovery orchestrator (Phase 2B,
  real-PDI verified).

Setup automation (`HC Cloud Account`/`HC Cloud Region` creation, AK/SK
credentials) uses ServiceNow's own native table/property forms instead of
a Script Include here — see `../ui-actions/README.md` for the one custom
artifact that setup automation does need (a UI Action, not a Script
Include) and why.

See [`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md) for the target
design and [`../docs/RESOURCE-MATRIX.md`](../docs/RESOURCE-MATRIX.md) for
current per-resource status.
