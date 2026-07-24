# HC ITOM Connector — Target Architecture

This document describes the **target** architecture across all 6 planned
phases, for context and sequencing. It is a design/reference document, not
a claim that everything below exists yet — see
[`RESOURCE-MATRIX.md`](RESOURCE-MATRIX.md) for what's actually built and
real-account-verified today.

## Why not the AWS Service Management Connector pattern

AWS's SMC ships as a single, large, largely-monolithic scoped app: one
discovery mechanism, one set of tightly-coupled mappings, limited
multi-account modeling, and — per its own changelog — has stopped receiving
significant architectural evolution. This project deliberately avoids
copying that shape. Instead it composes several ServiceNow-native patterns
that are each independently maintained/evolved by ServiceNow:

| Concern | ServiceNow-native pattern used |
|---|---|
| CMDB / resource relationships | Service Graph Connector conventions: IntegrationHub ETL (or an equivalent staging/transform step) + IRE for dedup/identification + CSDM-aligned CI classes |
| Resource provisioning | Cloud Provisioning and Governance (CPG) + a plain Terraform module (already proven, `terraform/`) |
| Events & alerts | A standard Event Envelope ingested through Event Management, fed by an integration gateway in front of Cloud Eye/CTS/Config/SMN |
| Operations & remediation | Flow Designer + IntegrationHub actions calling COC/FunctionGraph/Terraform |
| Account governance | Huawei Cloud Organizations + OU + IAM Agency, with AK/SK kept only as an explicit compatibility mode |

## Layering (applies to every resource type, every phase)

```
Huawei Cloud API  →  Adapter (pagination/retry/signing)  →  Pure mapper (lib/*.js, unit-tested)
                                                                    │
                                                                    ▼
                                                    IRE payload builder (pure)
                                                                    │
                                                                    ▼
                                          ServiceNow platform call (sn_cmdb.IdentificationEngine, etc.)
```

Every layer above the raw HTTP adapter is pure and unit-tested (this
project's established convention — see `servicenow/discovery/lib/` and
`servicenow/event-management/lib/`). Only the bottom-most platform-call
layer touches `GlideRecord`/`gs.*`/`sn_ws`/`sn_cmdb`, and from Phase 2
onward that layer is **generated** from the pure lib source rather than
hand-mirrored (see "Codegen, not manual mirroring" below).

## Multi-account / multi-region model (Phase 1 schema, Phase 2A wired)

Every discovery/sync/event-ingestion operation takes an explicit
`(HC Cloud Account, HC Cloud Region)` pair as input — never a single global
region/project System Property, which is what standalone
`servicenow/discovery/HuaweiECSDiscovery.js` still supports as a fallback
(explicit config now takes priority when supplied — see below). See
`tables/hc_cloud_account.schema.json` and `tables/hc_cloud_region.schema.json`
(the latter carries a `project_id` field added in Phase 2A: Huawei's
project ID is genuinely per-region per account, not per-account, so it
could not live on `HC Cloud Account`).

```
HC Cloud Account (account_id, ou_path, auth_mode, ...)
        │ 1..N
        ▼
HC Cloud Region (region, project_id, sync_enabled, last_success, last_error, ...)
        │ 1..N
        ▼
HC Discovery Run (resource_type, started, ended, success/fail counts, ...)
        │ produces/updates
        ▼
HC Resource Sync State (native_key, ci, status: active|pending_retire|retired)
```

`HcConnectorEcsSync.js` (Phase 2A, `service-graph/`) is the orchestrator
that actually walks this graph for ECS: loop active accounts → active
regions → resolve credentials via `createCredentialProvider()` → run
`HuaweiECSDiscovery` with explicit config → upsert `HC Resource Sync State`
via `lib/syncStatePlanner.js` → retire CIs whose native key stopped
appearing, but **only when that account/region's fetch phase completed
without throwing** — a failed fetch skips straight to the next
account/region and never reaches the retirement pass, so an incomplete
sync structurally cannot retire anything. Each account/region iteration is
wrapped in its own try/catch, so one bad credential or network failure
doesn't block the others. `HuaweiECSDiscovery.js` itself keeps working
standalone with zero config (System Property fallback, unchanged
behavior) — `HcConnectorEcsSync` is additive, not a replacement.

## Codegen, not manual mirroring (Phase 2A, proven; wider rollout later)

`HuaweiECSDiscovery.js` and `webhook-scripted-rest.js` each still
hand-mirror several `lib/*.js` modules inline (ServiceNow scoped scripts
cannot `require()` external files), covered only by the lightweight
literal-constant drift-check (`scripts/check-mirror-drift.js`) added in
Phase 1. Phase 2A proves real codegen for the first time, narrowly scoped
to the **new** `HcConnectorEcsSync.js` orchestrator only:
`scripts/build-script-include.js` inlines `lib/credentialProvider.js`,
`lib/resourceLifecycle.js`, `lib/compositeKey.js`,
`lib/discoveryRunTracker.js`, and `lib/syncStatePlanner.js` (none of which
`require()` each other) into
`docs/generated/HcConnectorEcsSync.generated.js`, stripping each
`module.exports` and asserting no `require()` calls survive. This
deliberately does not touch `HuaweiECSDiscovery.js`'s existing
`pureJsSha256.js` mirror — replacing proven, real-account-verified crypto
internals with untested tooling wasn't worth the regression risk in this
pass. Generalizing codegen to every future resource type (retiring
`check-mirror-drift.js` entirely) remains Phase 2B+ scope.

## Standard Event Envelope (Phase 1 logic, Phase 5 production use)

```json
{
  "event_id": "...",
  "source": "cloud_eye|cts|config|smn",
  "event_type": "...",
  "account_id": "...",
  "region": "...",
  "resource_id": "...",
  "occurred_at": "...",
  "severity": "...",
  "status": "...",
  "payload": {},
  "signature_version": "..."
}
```

`lib/eventEnvelope.js` implements normalize/validate/dedup for this shape
today, plus `fromLegacySmnAlarm()` — proven (via a real captured fixture)
compatible with the already-working Cloud Eye → SMN → ServiceNow flow in
`servicenow/event-management/`. No gateway is deployed yet (needs a real
FunctionGraph/API Gateway account, see Phase 5 below).

## Phase-by-phase target

1. **Productization scaffold** — tables, multi-account/region model,
   credential abstraction, lifecycle state machine, Event Envelope logic,
   drift-check.
2. **ECS/VPC/Subnet (EVS/EIP split out to 2C, see below)**:
   - **2A (source complete, real-PDI verified)** — wire ECS
     onto the Phase 1 abstractions via `HcConnectorEcsSync.js` (multi-
     account/region loop, credential resolution, upsert, retirement,
     failure isolation), real codegen proven for this one orchestrator,
     tables/role/ACLs specified for Studio creation. See
     `docs/INSTALL.md`/`docs/ACL-SETUP.md` and the Phase 2A cases in
     `tests/atf/README.md`.
   - **2B (source complete, real-PDI verified)** — VPC/Subnet
     discovery via a new sibling Script Include (`HuaweiVpcDiscovery.js`)
     and orchestrator (`HcConnectorVpcSync.js`), reusing the same pure
     `lib/` layer as ECS (already resource-type-agnostic, zero changes
     needed) rather than sharing a base class with `HcConnectorEcsSync.js`
     - keeps the diff against Phase 2A's proven, real-PDI-verified code at
     exactly zero. Real N:M Subnet→VPC containment relations via IRE
     `relations[]`, sitting under a real 4-level CMDB containment chain
     (`cmdb_ci_cloud_service_account` → `cmdb_ci_logical_datacenter` →
     `cmdb_ci_network` → `cmdb_ci_cloud_subnet`) — see
     `docs/REAL-PDI-REPLAY-CHECKLIST.md`'s Step 0 for the exact classes
     used. HC6–HC10 all confirmed against a real PDI + real Huawei Cloud
     sandbox account. EVS/EIP deliberately excluded from this phase - see
     2C.
   - **2C (EVS + EIP + Security Group, Discovery not started; Terraform
     grounding real-verified for all three)** — originally split out of
     the original 2B scope for having zero real-API grounding on
     EVS/EIP; Security Group folded in here too since it's the same kind
     of "network/storage resource attached to the sandbox ECS instance"
     work, not a separate track. Terraform side:
     - EVS/EIP: `terraform/main.tf` provisions `huaweicloud_evs_volume`
       (+ `huaweicloud_compute_volume_attach`) and `huaweicloud_vpc_eip`
       (+ `huaweicloud_vpc_eip_associate`), **real-PDI verified via a
       full apply + destroy against the real Huawei Cloud sandbox** (disk
       created and attached, EIP allocated and bound to the sandbox ECS
       instance, then both cleanly destroyed). One real gotcha hit:
       `huaweicloud_vpc_eip` creation failed with `VPC.0301` ("Bandwidth
       name or share_type is invalid") on `bandwidth.charge_mode =
       "traffic"`; switching to `"bandwidth"` succeeded on retry. Not
       isolated with a clean control test (a `terraform apply
       -refresh-only` for an unrelated pre-existing state drift happened
       between the failing and succeeding attempts), so treat
       `"bandwidth"` as the empirically-working config, not a confirmed
       explanation of why `"traffic"` failed — re-test `"traffic"` in
       isolation if that billing mode is ever needed.
     - Security Group: already has real API grounding —
       `terraform/main.tf` provisions and attaches a real
       `huaweicloud_networking_secgroup` (+ rules) to the sandbox ECS
       instance, and it's the same Huawei VPC API family already
       integrated in Phase 2B (`HuaweiVpcDiscovery.js`), so no new API
       family to onboard. Identified as a discovery candidate by
       cross-referencing this project's resource coverage against
       another Huawei Cloud integration
       ([huaweicloud-mcp-server](https://github.com/lexcodee/huaweicloud-mcp-server)),
       which treats Security Group as core VPC-family coverage alongside
       VPC/Subnet/EIP/route tables/peering.

     Remaining before Discovery work can start on any of the three: real
     field samples (capture actual `describe`/`list` API responses) and
     the Discovery Script Include(s) themselves. For Security Group,
     also confirm the candidate CI class and containment relation
     (likely Security Group → ECS, analogous to the existing Subnet →
     VPC relation) against a real PDI.
3. **Platform services** — ELB, RDS, OBS (buckets only), CCE
   (cluster/node/namespace/workload/service/ingress — no Pods). Terraform
   grounding for ELB/RDS/OBS is now real-PDI verified: `terraform/main.tf`
   provisions `huaweicloud_elb_loadbalancer` (+ listener/pool/member, the
   sandbox ECS instance registered as backend), `huaweicloud_rds_instance`
   (single-node MySQL 8.0), and `huaweicloud_obs_bucket`, all confirmed
   via a full apply + destroy against the real sandbox. One real gotcha
   hit: the RDS admin password failed Huawei's complexity check (`DBS.
   280203`, "Weak password") on a first attempt — needs uppercase +
   lowercase + digit + special character, 8-32 chars, not containing the
   username. CCE deliberately not attempted yet — full cluster
   provisioning is a different order of magnitude in creation time and
   ongoing cost, deferred to its own pass. Discovery work for
   ELB/RDS/OBS hasn't started; only the provisioning side is verified.
4. **Opt-in Pod discovery** — namespace/label-filtered, gated on Phase 3
   CCE stability and event-driven incremental capability; default off;
   excludes `kube-system`, Jobs/CronJobs, completed Pods; 24h retirement
   after termination.
5. **Event gateway** — a real FunctionGraph/API Gateway reference
   implementation in front of Cloud Eye/CTS/Config/SMN, signature
   verification, HTTPS/origin allow-listing, dedup, retry, dead-letter
   queue, rate limiting; the standard Event Envelope in production use.
6. **Provisioning & Day-2** — CPG/Terraform catalog expansion (EVS/EIP/ELB/
   RDS/OBS/CCE), encrypted remote Terraform state, Flow Designer Day-2
   operations (start/stop/resize/attach/etc.) via IntegrationHub.

Each phase gets its own detailed plan, explicit approval, and end-of-phase
report before the next one starts.

## Setup automation & distribution packaging (cross-cutting, not a numbered phase)

Orthogonal to the resource-coverage phases above — addresses *how a third
party actually installs and uses this project*, not what resources it
discovers. Prompted by an explicit design goal: automated usability for
someone consuming this project from GitHub, not just readability, following
mainstream cloud-vendor ServiceNow connector practice (a packaged
Application via the platform's own install/clone mechanism, paired with
native-form-based post-install configuration).

- **Setup automation via native forms + a UI Action** (source-complete and
  real-PDI verified), matching how mature cloud-vendor ServiceNow
  connectors actually handle this step: `HC Cloud Account`/`HC Cloud Region`
  use ServiceNow's own auto-generated table forms (zero custom code — the
  dictionary in `tables/*.schema.json` already drives mandatory-field
  validation and choice dropdowns); AK/SK credentials are entered as two
  System Properties via the native `sys_properties.do` form (see
  `docs/INSTALL.md` Step 4, and `lib/credentialProvider.js`'s
  `buildAccountScopedPropertyName()` for the single source of truth on the
  naming convention); the only custom artifact is a "Run Sync Now" **UI
  Action** on `HC Cloud Account` (`ui-actions/hc_cloud_account_run_sync_now.js`)
  that runs `HcConnectorEcsSync` + `HcConnectorVpcSync` synchronously and
  shows the result via `gs.addInfoMessage()`. A periodic counterpart,
  `scheduled-jobs/hc_connector_scheduled_sync.js` (a Scheduled Script
  Execution running the same two orchestrators without a manual click), is
  **source-complete and real-PDI verified**, and ships independently as a
  manual `docs/INSTALL.md` Step 9 (ServiceNow does not track Scheduled
  Script Executions via any of the packaging mechanisms below).
- **Distribution/packaging — plan decided, not yet executed.** The goal is
  a one-click install for a completely unrelated ServiceNow account, not
  just moving changes within one org. Three mechanisms were evaluated on
  the real PDI:
  - **ServiceNow Store publish** — blocked; Store/Internal publishing
    requires enrollment in ServiceNow's Technology Partner Program (TPP),
    which an individual developer instance isn't part of. Not a
    configuration issue — this path is closed for a personal project by
    design.
  - **Local Update Set (capture + Export to XML)** — proven not viable for
    this goal: real-PDI testing confirmed `sys_scope` (the application's
    own scope-definition record) is structurally excluded from Update Set
    capture, the same way `sysauto_script` is (see the Setup automation
    bullet above) — no amount of re-capturing gets a brand-new app's scope
    definition into an importable XML. Update Sets remain fine for their
    original purpose (moving changes between instances that already share
    the same app scope), just not for this project's actual goal.
  - **Convert to Application Repository Mode** (Studio's Git-backed app
    repository) — confirmed technically capable of what's needed (an
    installable, Git-hosted package independent of the target's account),
    but converting locks the *source* instance out of further Studio
    development for that app and clears its Customer Updates. **Decision:
    finish all remaining planned resource-coverage phases first, then
    convert once the app is feature-complete** — converting mid-development
    would block exactly the iteration this project still needs. The target
    repository (`huaweicloud-servicenow-itom-connector-app`, currently
    private) already exists; the conversion itself is deferred.

## Security model (target, Phase 1 partial)

- No hardcoded AK/SK, passwords, webhook secrets, or real account/resource
  data anywhere in this repo (unchanged rule from Discovery/Event
  Management).
- `System Property`-based `password2` credentials (`AkSkSystemPropertyProvider`)
  are explicitly a **dev/compat-only** path from Phase 1 onward, not the
  production model — see `lib/credentialProvider.js`.
- Production auth target: Credential Alias/Connection records + Huawei
  Cloud IAM Agency (assume-role style STS exchange) — `AgencyCredentialProvider`
  is an interface stub, not implemented (needs a real Organizations
  account).
- SMN must never be exposed directly to a ServiceNow webhook in production
  — the target path is Cloud Eye/CTS/Config/SMN → integration gateway
  (FunctionGraph/API Gateway) → ServiceNow, with the gateway responsible
  for signature verification, HTTPS/origin allow-listing, dedup, replay
  protection, rate limiting, retry, and dead-letter handling. Today's
  direct-to-ServiceNow-webhook path (`servicenow/event-management/`) is
  documented as the interim/reference design, already real-account
  verified, and stays as the "legacy" input the standard envelope's
  `fromLegacySmnAlarm()` adapter wraps.
