# HC ITOM Connector

> **Status: Phase 2A (platform wiring) and Phase 2B (VPC + Subnet
> discovery) — both verified against a real ServiceNow PDI + real Huawei
> Cloud sandbox account.** Phase 2A: HC2/HC3/HC4 directly exercised;
> HC1/HC5 accepted on lighter evidence. Phase 2B: HC6–HC10 all directly
> exercised, after resolving a real 4-level CMDB containment chain
> (`cmdb_ci_cloud_service_account` → `cmdb_ci_logical_datacenter` →
> `cmdb_ci_network` → `cmdb_ci_cloud_subnet`) and a real bug affecting both
> phases (`createOrUpdateCI`'s return value being an unparsed JSON
> string). Scope narrowed from the original "VPC/Subnet/EVS/EIP" wording —
> EVS/EIP/Security Group/Route Table/NAT Gateway/VPC Peering deferred to
> Phase 2C — Terraform grounding for all six is real-PDI verified;
> **Security Group, EVS, and EIP Discovery are also real-PDI verified**
> (fetch, real CI class with a working OOTB Identification Rule, idempotent
> on a second run; EVS confirmed that IRE's `relations[]` cannot hold a
> real CI sys_id across separate discovery runs — hard-typed as a Java
> `Integer` server-side — so it ships as a standalone CI with no ECS
> relation, same as Security Group; EIP's OOTB containment rule needed a
> real *owner* CI instead, so it relates to a locally-built stub of ECS
> Discovery's own `cmdb_ci_virtualization_server` placeholder via
> `Owns::Owned by` — IRE matches the stub against the real, already-
> committed placeholder through identification, the first working
> cross-discovery-run relationship in this project). **Route Table/NAT
> Gateway/VPC Peering Discovery are deliberately NOT built** — they're
> routing config attached to a VPC/Subnet, not standalone discoverable
> assets under ServiceNow's CMDB CI Class Model; Terraform-only coverage
> is the intentional end state. **Phase 3's ELB, RDS, and OBS Discovery
> are also real-PDI verified** (`HuaweiElbDiscovery.js`/`HcConnectorElbSync.js`,
> `HuaweiRdsDiscovery.js`/`HcConnectorRdsSync.js`, and
> `HuaweiObsDiscovery.js`/`HcConnectorObsSync.js`, each its own API host,
> `cmdb_ci_cloud_load_balancer`/`cmdb_ci_cloud_database` both related to a
> local logical-datacenter placeholder via `Hosted on::Hosts` - not ELB's
> `vpc_id` field, since the real OOTB rule named the datacenter class
> specifically; both identified via `object_id` through a real working
> OOTB rule - ELB's first pass omitted it and hit a real error, RDS
> included it proactively and matched on the first try). **OBS needed a
> dedicated custom CI class** (`x_2021019_huawei_0_huawei_cloud_obs_bucket`,
> extends `cmdb_ci`, manual Independent Identification Rule on
> `correlation_id`) since no existing platform class was a genuine
> semantic fit - a dedicated class is the standard way to model a
> resource type with no clean generic fit rather than reusing a
> mismatched generic one; also the only resource type here with its own
> signing scheme (HMAC-SHA1 + base64, not the IAM-wide SDK-HMAC-SHA256
> every other service uses) and an XML (not JSON) response. **CCE cluster
> Discovery is also real-PDI verified**, same "nothing fits" situation as
> OBS but more so (zero candidate classes found at all, not even a
> mismatched one) - its own dedicated custom class
> (`x_2021019_huawei_0_huawei_cloud_cce_cluster`), zero relations needed.
> Node/namespace/workload/service/ingress (and Pods) are a real
> architectural boundary, not a scope gap: reaching resources inside a
> cluster needs a MID Server with network access to the cluster's own
> Kubernetes API, a mechanism this project doesn't use anywhere else
> (every other resource here is a direct, agentless REST call to
> Huawei's public regional API).
> Phase 1
> (productization scaffold: tables, pure lib modules) is folded in below.
> `servicenow/discovery/HuaweiECSDiscovery.js` gained an *optional* config
> parameter in Phase 2A (falls back to its original System-Property
> behavior when omitted — single-account usage is unaffected) and is
> otherwise untouched by Phase 2B, which added a sibling file
> (`HuaweiVpcDiscovery.js`) instead of modifying it; `servicenow/event-management/`
> is untouched by both. See [`docs/INSTALL.md`](docs/INSTALL.md) to deploy
> and [`docs/REAL-PDI-REPLAY-CHECKLIST.md`](docs/REAL-PDI-REPLAY-CHECKLIST.md)
> for the exact real-PDI setup steps and gotchas found along the way.

## What "HC ITOM Connector" is

The productized evolution of this repo's Huawei Cloud ↔ ServiceNow ITOM
integration, modeled on ServiceNow's own Service Graph Connector pattern
(IntegrationHub ETL + IRE + CSDM for CMDB, CPG+Terraform for provisioning,
a standard Event Envelope + integration gateway for Event Management, Flow
Designer for Day-2 ops, Organizations/IAM Agency for account governance) —
deliberately *not* a single-account, single-region, single-app reference
script. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full
target design across all planned phases.

It lives in the **same scoped app** as `servicenow/discovery/` and
`servicenow/event-management/` (scope `x_2021019_huawei_0`, display name
**"HC ITOM Connector"** — see [`docs/INSTALL.md`](docs/INSTALL.md) for the
one-time app rename step), to avoid re-introducing the cross-scope-access
restrictions already solved this session for Discovery/Event Management.

## What Phase 2A adds on top of Phase 1

- **`service-graph/HcConnectorEcsSync.js`** — the multi-account/region ECS
  orchestrator. Loops active `HC Cloud Account` × active `HC Cloud Region`,
  resolves credentials via `createCredentialProvider()`, runs
  `HuaweiECSDiscovery` with explicit config, upserts `HC Resource Sync
  State` via the new `lib/syncStatePlanner.js`, and retires CIs whose
  native key stopped appearing — **only** when that account/region's fetch
  phase completed without throwing, and with each account/region iteration
  isolated by its own try/catch. `docs/generated/HcConnectorEcsSync.generated.js`
  is the paste-ready build output (`scripts/build-script-include.js`
  inlines 5 `lib/*.js` modules into it — the first real codegen in this
  project, replacing manual mirroring for this one Script Include).
- **`lib/syncStatePlanner.js`** — pure planner: given the native keys seen
  in a run and the existing `HC Resource Sync State` rows, computes
  inserts/refreshes/lifecycle transitions. Takes `resourceLifecycle.computeNextState`
  as an injected dependency rather than `require()`-ing it, to stay
  codegen-safe.
- **`docs/ACL-SETUP.md`** — exact Studio steps to create the 6 tables, the
  `hc_connector_admin` role, and write ACLs on the 3 configuration-bearing
  tables (`HC Cloud Account`/`HC Cloud Region`/`HC Connector Config`).
  Deliberately a smaller scope than Phase 1's `PERMISSIONS.md` admin+operator
  sketch — see that file's "Simplification" note.
- **`servicenow/discovery/HuaweiECSDiscovery.js`** gained an additive,
  optional config parameter (`initialize({region, projectId, pageLimit,
  maxRetryAttempts, accessKey, secretKey})`) so `HcConnectorEcsSync` can
  drive it per-account/region; omitting the config keeps the original
  System-Property-only behavior unchanged. One behavior change ships with
  this: `fetchECSInstances()` now **throws** on an unrecoverable page-fetch
  failure instead of silently returning a partial list — necessary so the
  new retirement logic can never mistake a failed fetch for "these
  instances are gone." See `servicenow/discovery/README.md`.
- **Phase 2A ATF cases** (`tests/atf/README.md`, HC1–HC5): multi-account
  isolation, upsert-produces-no-duplicates, retirement-never-fires-from-an-
  incomplete-sync, one-account-failing-doesn't-block-others, and a
  `correlation_id`-binding regression check.

## What Phase 2B adds on top of Phase 2A

Source-complete and real-PDI verified. Scope narrowed from the roadmap's
original "VPC/Subnet/EVS/EIP" wording — EVS/EIP/Security Group/Route
Table/NAT Gateway/VPC Peering deferred to Phase 2C. All six now have
real-PDI-verified Terraform grounding (`terraform/main.tf`); **Security
Group, EVS, and EIP Discovery are also real-PDI verified** (Security
Group and EIP folded into `HuaweiVpcDiscovery.js`/`HcConnectorVpcSync.js`
alongside VPC/Subnet; EVS as its own sibling `HuaweiEvsDiscovery.js`/
`HcConnectorEvsSync.js`) - see the Phase 2C section below for the real
gotchas found and fixed.

- **`servicenow/discovery/HuaweiVpcDiscovery.js`** — a new sibling to
  `HuaweiECSDiscovery.js`, not a modification of it. Fetches both VPCs and
  Subnets (one file, to avoid a second full copy of the SHA-256/HMAC Rhino
  crypto port) and builds a combined IRE payload with a real N:M
  Subnet→VPC containment relation set — each subnet's `vpc_id` maps to its
  own parent VPC's item index, not a single fixed placeholder relation like
  ECS's virtualization-server host. `CI_CLASS_VPC`/`CI_CLASS_SUBNET`/
  `CONTAINMENT_RELATION_TYPE` are explicit placeholders pending a real-PDI
  diagnostic — see `docs/REAL-PDI-REPLAY-CHECKLIST.md`'s Phase 2B Step 0.
- **`service-graph/HcConnectorVpcSync.js`** — the sibling orchestrator to
  `HcConnectorEcsSync.js`, same hand-written-template-then-codegen shape,
  no shared base class (reuse happens at the pure `lib/` layer, which
  needed zero changes — already resource-type-agnostic). Writes **two**
  `HC Discovery Run` rows per account/region iteration (one for
  `resource_type='vpc'`, one for `'subnet'`), sharing a single `trace_id`,
  since VPC and Subnet are fetched together but remain distinct resource
  types in the schema.
- **`lib/mapVpcSubnetToIRE.js`** — pure mapper, mirrored inline in
  `HuaweiVpcDiscovery.js`. Unlike `mapEcsToIRE.js` (items only), this one
  also builds `relations[]`, making the containment-relation logic
  unit-testable for the first time in this project.
- **`lib/vpcPagination.js`** — marker/cursor pagination helpers, kept
  separate from `ecsPagination.js`'s offset-as-page-number logic since
  Huawei's VPC service uses a different pagination contract (unverified
  against this sandbox as of writing — confirm before trusting).
- **`scripts/build-script-include.js` manifest-ified** — was hardcoded to
  one template/output/module-list through Phase 2A; now a `BUILD_TARGETS`
  array regenerates both orchestrators' generated Script Includes in one
  run.
- **No new tables, roles, or ACLs** — VPC/Subnet reuse the same 6 tables
  and `hc_connector_admin` role from Phase 2A; `resource_type` was already
  an unconstrained string field.
- **Phase 2B ATF cases** (`tests/atf/README.md`, HC6–HC10): subnet-to-
  parent-VPC relation correctness, no cross-type leakage in shared tables,
  independent per-type lifecycle transitions, idempotency through the
  combined IRE call, and failure isolation covering both run rows
  together.

## Setup automation & distribution packaging (cross-cutting, new)

Not part of the numbered resource-coverage phases — addresses how a third
party actually installs and uses this project, following mainstream
cloud-vendor ServiceNow connector practice.

Settled design (**source-complete and real-PDI verified**), matching how
mature cloud-vendor ServiceNow connectors actually handle this step —
native forms + a UI Action, no custom GlideAjax/Jelly setup pages:

- **`HC Cloud Account`/`HC Cloud Region`** — filled in via ServiceNow's own
  auto-generated table forms, zero custom code (the dictionary in
  `tables/*.schema.json` already drives mandatory-field validation and
  choice dropdowns).
- **AK/SK credentials** — entered as two System Properties via the native
  `sys_properties.do` form (see `docs/INSTALL.md` Step 4).
  `lib/credentialProvider.js`'s `buildAccountScopedPropertyName()` is the
  single source of truth for the naming convention, used by the existing
  read side (`AkSkSystemPropertyProvider`) and documented for admins
  entering values by hand.
- **`ui-actions/hc_cloud_account_run_sync_now.js`** — a "Run Sync Now" UI
  Action on `HC Cloud Account` that runs both `HcConnectorEcsSync` and
  `HcConnectorVpcSync` synchronously and shows the result via
  `gs.addInfoMessage()`/`gs.addErrorMessage()`. See `ui-actions/README.md`.
- **`scheduled-jobs/hc_connector_scheduled_sync.js`** — the periodic
  counterpart to the button above: a Scheduled Script Execution that runs
  the same two orchestrators without anyone having to remember to click.
  **Real-PDI verified** (two `Execute Now` runs, 3 `HC Discovery Run` rows
  each, no failures). See `scheduled-jobs/README.md`.
- **One-click distribution — plan decided, not yet executed.** Store
  publish is blocked on this developer instance, and Local Update Set
  packaging was proven not viable for installing on an unrelated account
  (the app's own scope definition isn't Update-Set-trackable). The plan is
  Studio's **Application Repository Mode**, deferred until the app is
  feature-complete (converting locks the source instance out of further
  Studio development for it). See `docs/ARCHITECTURE.md`'s "Setup
  automation & distribution packaging" section.

## Day-2 operations (cross-cutting, new — real-PDI verified)

The first Day-2 (write, not just read) capability in this project: ECS
start/stop/reboot. Picked ahead of the remaining resource-coverage phases
because a capability gap review against a mainstream cloud connector's own
feature set (see `docs/ARCHITECTURE.md`'s "Roadmap review" section)
surfaced Day-2 ops and production multi-account auth as the two gaps that
matter more than additional resource types — and unlike IAM Agency (needs
a real Organizations account), Day-2 ops can be built and real-PDI
verified against the existing sandbox right now.

- **`lib/ecsLifecycleAction.js`** — pure, unit-tested request-body builder
  for Huawei's Nova-compatible batch action API
  (`POST /v1/{project_id}/cloudservers/action`).
- **`service-graph/HcConnectorEcsLifecycleAction.js`** — resolves a CI's
  account/region via the same `HC Resource Sync State` table every sync
  orchestrator already writes, resolves credentials via
  `createCredentialProvider()`, and reuses `HuaweiECSDiscovery._sign()`
  directly (cross-Script-Include delegation, same pattern
  `HcConnectorEcsSync.js` already uses) rather than duplicating the
  SDK-HMAC-SHA256 crypto block a ninth time.
- **Three `cmdb_ci_vm_instance` UI Actions** (Start/Stop/Reboot Instance,
  `ui-actions/hc_vm_instance_{start,stop,reboot}.js`) — server-side only,
  same "Run Sync Now" pattern, gated by
  `HcConnectorEcsLifecycleAction.isManaged()` so the buttons only appear on
  CIs this connector actually discovered.

See `docs/ARCHITECTURE.md`'s "Day-2 operations" section for the full
design and `docs/INSTALL.md` Step 10 for setup/verification steps.
Real-PDI verified: start/stop confirmed against a real sandbox instance,
both in the ServiceNow log and directly on the Huawei Cloud console (not
just "no error thrown" — a first attempt against a since-deleted instance
produced a misleading HTTP 200 with no useful log detail, fixed by logging
the response body on the success path too, then re-verified against a
freshly provisioned instance). Huawei's batch action API returns `HTTP
200` with `{"job_id": "..."}`, not an empty body as originally assumed.

## What Phase 1 delivers (the scaffold Phase 2A builds on)

- **Table schemas** (`tables/*.schema.json`) for the multi-account/region
  model and run/lifecycle tracking — `HC Cloud Account`, `HC Cloud Region`,
  `HC Discovery Run`, `HC Resource Sync State`, `HC Event Ingestion Record`,
  `HC Connector Config`. Each schema drives a generated Markdown creation
  spec (guaranteed-correct manual path) and a best-effort provisioning
  script (**unverified against a real PDI**) — see `tables/README.md`.
- **Pure, unit-tested `lib/` modules** that Phase 2+ will wire into real
  ServiceNow scripts:
  - `credentialProvider.js` — AK/SK (today's proven dev/compat path) vs.
    IAM Agency (interface stub only, not implemented — needs a real
    Organizations account).
  - `resourceLifecycle.js` — the `pending_retire` → `retired` state
    machine.
  - `eventEnvelope.js` — the standard Event Envelope, plus an adapter
    proven compatible with the already-verified real Cloud Eye/SMN alarm
    flow. `event_id` is never the bare CES `alarm_id` (firing/resolved
    notifications for the same alarm share it, which would collide against
    the table's unique constraint) — it's the SMN `message_id` when
    available, else a composite `alarm_id:status:occurred_at` key, with
    `alarm_id` always carried in `payload.correlation_key` so the two can
    still be linked.
  - `discoveryRunTracker.js` — building `HC Discovery Run` field sets;
    `toServiceNowDiscoveryRunFields()` renames the internal
    `started_at_ms`/`ended_at_ms` to the schema's actual `started`/`ended`
    field names (still epoch-ms — GlideDateTime conversion happens at the
    platform layer).
  - `compositeKey.js` — application-layer composite-uniqueness helpers for
    `HC Resource Sync State` (account, region, resource_type, native_key)
    and `HC Cloud Region` (account, region) — ServiceNow has no simple UI
    for a true composite unique DB constraint on a custom table, so this is
    enforced via upsert-before-insert instead.
  - `payloadSanitizer.js` — recursive sensitive-field masking + length
    truncation for `HC Event Ingestion Record.raw_payload`.
- **Build tooling** (`scripts/`) — table doc/provisioning-script
  generators, and a first drift-check (`check-mirror-drift.js`) that
  starts closing the "manual copy-paste sync between `lib/*.js` and the
  ServiceNow scripts" gap for the two files that already have this problem
  today (full codegen replacing the manual mirror entirely is Phase 2
  scope, proven against these same two files first).

## Directory layout

```
servicenow/hc-connector/
├── README.md                 # this file
├── docs/
│   ├── ARCHITECTURE.md       # target architecture across all 6 phases
│   ├── INSTALL.md            # install steps through Phase 2B (automatable / instance-import / manual-admin)
│   ├── ACL-SETUP.md          # Studio table/role/ACL creation steps (Phase 2A; reused as-is by Phase 2B)
│   ├── RESOURCE-MATRIX.md    # resource-type support matrix, phase-mapped
│   ├── PERMISSIONS.md        # role/ACL matrix (Phase 2A: hc_connector_admin, real-PDI verified)
│   ├── REAL-PDI-REPLAY-CHECKLIST.md  # exact real-PDI setup steps + gotchas found verifying Phase 2A/2B
│   └── generated/            # output of scripts/generate-*.js and build-script-include.js - do not hand-edit
├── tables/                   # *.schema.json + README on the schema format
├── scripts/                  # Node build tools (doc/provision generators, build-script-include codegen
│                              #  - now a BUILD_TARGETS manifest covering both orchestrators, drift checker)
├── lib/                      # pure, unit-tested logic: credentialProvider, resourceLifecycle, eventEnvelope,
│                              #  discoveryRunTracker, compositeKey, payloadSanitizer, syncStatePlanner - all
│                              #  resource-type-agnostic, reused unchanged by both Phase 2A and 2B
├── fixtures/                 # (currently none needed - the eventEnvelope tests reuse the
│                              #  real fixture already in servicenow/event-management/fixtures/)
├── service-graph/            # HcConnectorEcsSync.js (Phase 2A, ECS) and HcConnectorVpcSync.js (Phase 2B,
│                              #  VPC+Subnet) - sibling orchestrators, no shared base class between them
├── ui-actions/                # hc_cloud_account_run_sync_now.js - the "Run Sync Now" UI Action script
├── scheduled-jobs/           # hc_connector_scheduled_sync.js - the periodic-sync counterpart to the button
├── event-management/         # empty - Phase 5 (gateway reference design)
└── provisioning/             # empty - Phase 6 (CPG catalog expansion)
```

`servicenow/discovery/` also gained a sibling in Phase 2B:
`HuaweiVpcDiscovery.js` alongside the existing `HuaweiECSDiscovery.js`, plus
`lib/mapVpcSubnetToIRE.js` and `lib/vpcPagination.js`.

## Testing

`npm test` from the repo root runs everything, including
`tests/unit/hc-connector/*.test.js` (pure logic, zero live dependencies,
same convention as `servicenow/discovery/` and `servicenow/event-management/`).

Verify the build tools directly:
```bash
node servicenow/hc-connector/scripts/generate-table-docs.js
node servicenow/hc-connector/scripts/generate-provision-script.js
node servicenow/hc-connector/scripts/build-script-include.js        # regenerates all seven orchestrators' generated output
node servicenow/hc-connector/scripts/check-mirror-drift.js          # 8 mirrored pairs (7 crypto + 1 severity map)
```

## What's still not included after Phase 2B

- **Both Phase 2A and Phase 2B are real-PDI verified** — HC1–HC10 all
  exercised against a real ServiceNow PDI + real Huawei Cloud sandbox
  account (Phase 2A: HC2/HC3/HC4 directly, HC1/HC5 on lighter evidence;
  Phase 2B: HC6–HC10 all directly).
- **Route Table/NAT Gateway/VPC Peering Discovery are deliberately NOT
  built** — not a gap, a real decision: they're routing config attached to
  a VPC/Subnet, not standalone discoverable assets under ServiceNow's CMDB
  CI Class Model. Their Terraform grounding is real-PDI verified and
  that's the intentional end state. **Security Group, EVS, and EIP
  Discovery, also Phase 2C, ARE done and real-PDI verified** (see above).
- No working IAM Agency authentication (interface stub only — needs a real
  Huawei Organizations account).
- No deployed event gateway (FunctionGraph/API Gateway) — architecture doc
  + envelope logic only, needs a real account to build/verify against.
- No `hc_connector_operator` role — deliberately deferred, see
  `docs/PERMISSIONS.md`.
- **No one-click distribution yet** — Store publish requires ServiceNow
  Technology Partner Program (TPP) enrollment, not available to an
  individual developer instance; Local Update Set packaging doesn't work
  for installing on an unrelated account either (confirmed: the app's own
  scope definition isn't Update-Set-trackable). Plan: Application
  Repository Mode, once feature-complete — see `docs/ARCHITECTURE.md`.
- `scheduled-jobs/hc_connector_scheduled_sync.js` — **real-PDI verified**,
  ships as a manual `docs/INSTALL.md` step regardless of how the rest of
  the app eventually gets distributed (ServiceNow doesn't track Scheduled
  Script Executions via any packaging mechanism).

See [`docs/RESOURCE-MATRIX.md`](docs/RESOURCE-MATRIX.md) for the full
picture.
