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
   - **2C (EVS + EIP + Security Group + Route Table + NAT Gateway + VPC
     Peering; Terraform grounding real-verified for all six; Discovery
     built for EVS/EIP/Security Group, deliberately skipped for the other
     three)** — originally split out of the original 2B scope for having
     zero real-API grounding on EVS/EIP; the other four folded in here too
     since it's the same kind of "network/storage resource attached to the
     sandbox VPC/ECS" work, not a separate track. Route Table, NAT
     Gateway, and VPC Peering were initially assumed to be core
     network-family discovery targets like Security Group, by analogy -
     that assumption turned out to be WRONG once actually checked: ServiceNow's
     standard CMDB CI Class Model (see the Discovery paragraph below) has
     no standalone CI class for any of the three. Terraform side:
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
     - **EVS: Terraform grounding AND Discovery both real-PDI verified.**
       New sibling Script Include `HuaweiEvsDiscovery.js` (own file, not an
       extension of `HuaweiVpcDiscovery.js`, since EVS is a different API
       host — `evs.{region}.myhuaweicloud.com`) fetches
       `GET /v3/{project_id}/volumes/detail` (offset/limit pagination, no
       total-count field — stops on a short page) and reconciles into
       `cmdb_ci_storage_volume` (ServiceNow's standard CMDB class for cloud
       block-storage volumes). One real design question resolved via actual
       testing, not assumption, per this project's standing rule to check
       for a real platform mechanism before falling back to a workaround:
       could `relations[]` reference an already-committed CI's real sys_id
       (e.g. relate a volume directly to its attached ECS instance,
       discovered in a separate, temporally-independent payload)? Real-PDI
       testing gave a definitive **no** — ServiceNow's server-side payload
       parser
       deserializes `relations[].child`/`.parent` as a Java `Integer`; a
       real sys_id string thrown at it produced a real
       `InvalidFormatException: Cannot deserialize value of type
       java.lang.Integer from String ...` naming the exact field. This is
       a hard type constraint, not a format quirk — the field can only
       ever hold an array index, meaning relations are structurally
       confined to items within the same `createOrUpdateCI()` call. Fixed
       by dropping the ECS relation entirely and following Security
       Group's same fallback: each volume relates only to a locally-built
       `cmdb_ci_cloud_service_account`/`cmdb_ci_logical_datacenter`
       placeholder pair via `Hosted on::Hosts` (the real OOTB containment
       rule, confirmed via a real `MISSING_DEPENDENCY` error listing it as
       one of three valid options). Real-PDI verified end to end: fetch
       succeeded, volume CI inserted with `hasError:false`, confirmed
       idempotent on a second run (`insertCount:0, refreshCount:1`, every
       item/relation `NO_CHANGE`).
     - **Security Group: Terraform grounding AND Discovery both real-PDI
       verified.** `terraform/main.tf` provisions and attaches a real
       `huaweicloud_networking_secgroup` (+ rules) to the sandbox ECS
       instance, same Huawei VPC API family already integrated in Phase
       2B. Identified as a discovery candidate by cross-referencing this
       project's resource coverage against another Huawei Cloud
       integration
       ([huaweicloud-mcp-server](https://github.com/lexcodee/huaweicloud-mcp-server)),
       which treats Security Group as core network-family coverage.
       Discovery: `HuaweiVpcDiscovery.js` extended to fetch
       `GET /v3/{project_id}/vpc/security-groups` and reconcile into
       `cmdb_ci_compute_security_group` (ServiceNow's standard CMDB class
       for cloud security groups). Two real corrections made during
       real-PDI testing:
       1. The original design related each security group to its parent
          VPC via `Contains::Contained by` (matching Subnet's relation) -
          wrong for two reasons found via real testing: Huawei's actual
          API response has **no `vpc_id` field at all** (contradicts
          general API-shape assumptions), and
          `cmdb_ci_compute_security_group`'s real OOTB containment rule
          wants `Hosted on::Hosts` -> `cmdb_ci_logical_datacenter` instead
          (the same placeholder `cmdb_ci_network`/VPC itself is hosted
          under) - confirmed via a real `MISSING_DEPENDENCY` error naming
          the exact rule. Fixed by relating every security group directly
          to the shared datacenter placeholder.
       2. Unlike VPC/Subnet in Phase 2B, `cmdb_ci_compute_security_group`
          already has a working OOTB Identification Rule ("Compute
          Security Group Rule", matches on `object_id`) - no manual
          Identification Rule setup was needed this time.
       Real-PDI verified end to end: fetch succeeded, both security groups
       inserted with `hasError:false`, confirmed idempotent on a second
       run (`insertCount:0, refreshCount:2`). No relation to ECS instances
       - cross-discovery-run relations aren't a solved pattern in this
       project yet (documented gap, matches ECS<->VPC/Subnet also not
       being related).
     - **EIP: Terraform grounding AND Discovery both real-PDI verified.**
       `HuaweiVpcDiscovery.js` extended to fetch `GET /v1/{project_id}/publicips`
       (same v1 host/marker-pagination as VPC/Subnet, real-PDI confirmed)
       and reconcile into `cmdb_ci_ip_address` (ServiceNow's standard CMDB
       class for cloud IP addresses). EIP's real OOTB containment rule
       turned out to be genuinely different from every other resource in
       this file -
       a real `MISSING_DEPENDENCY` error required an `Owns::Owned by`
       relation to one of `cmdb_ci_hardware` / `cmdb_ci_cloud_database` /
       `cmdb_ci_cloud_load_balancer` / `cmdb_ci_cloud_webserver`, not
       `Hosted on::Hosts` to a datacenter placeholder like every prior
       resource type. Two real, evidence-based checks (not guesses) before
       picking a fix, per this project's "verify before assuming"
       standard: (1) a real `sys_db_object.super_class` walk confirmed
       ECS's own CI class (`cmdb_ci_vm_instance`) is NOT hardware-family
       (`cmdb_ci_vm_instance -> cmdb_ci_vm_object -> cmdb_ci -> cmdb`),
       ruling out any relation to the per-instance ECS CI; (2) the same
       walk confirmed `cmdb_ci_virtualization_server` - the shared
       placeholder `HuaweiECSDiscovery.js` already creates for its own
       `Runs on::Runs` fix - IS hardware-family
       (`cmdb_ci_virtualization_server -> cmdb_ci_server ->
       cmdb_ci_computer -> cmdb_ci_hardware`). Fix: each EIP relates to a
       freshly-built LOCAL stub of that same placeholder class/name
       (matching `HuaweiECSDiscovery.js`'s own placeholder exactly) via
       `Owns::Owned by` - IRE resolves the stub against the real,
       already-committed CI from the separate ECS discovery run through
       identification matching, not a raw sys_id (still
       confirmed impossible - see EVS above). This is the first real,
       working example of a cross-discovery-run relationship in this
       project - real-PDI verified end to end: `hasError:false`, the EIP
       CI and the `Owns::Owned by` relation both inserted, and the
       virtualization_server stub correctly matched (`NO_CHANGE`, not a
       duplicate) against the real placeholder from the separate
       `HuaweiECSDiscovery.js` run. Idempotent on a second run
       (`insertCount:0, refreshCount:1`, everything `NO_CHANGE`). One
       smaller correction along the way: `object_id` was removed from the
       EIP item after real-PDI testing showed `cmdb_ci_ip_address` has no
       such field (logged as a harmless "unknown field" warning, not an
       error) - real identification uses an OOTB "IP Address" rule keyed
       on `ip_address`+`netmask` instead.
     - Route Table / NAT Gateway / VPC Peering: `terraform/main.tf`
       provisions `huaweicloud_vpc_route_table` (a real `0.0.0.0/0` route
       with `type = "nat"`, nexthop the NAT gateway), `huaweicloud_nat_gateway`
       + `huaweicloud_nat_snat_rule` (a second, dedicated EIP — an EIP can
       only be bound to one thing at a time, so this can't reuse the
       ECS-bound one above), and `huaweicloud_vpc_peering_connection`
       between the sandbox VPC and a second VPC created just for this
       (`var.peer_vpc_cidr`, default `172.16.0.0/16`, must not overlap
       `var.vpc_cidr`). **Real-PDI verified via a full apply + destroy**
       — all three resource types created successfully alongside the
       EVS/EIP/ELB/RDS/OBS batch (16 resources total in one apply). One
       real gotcha hit and fixed: `huaweicloud_nat_gateway`'s `subnet_id`
       needs the `huaweicloud_vpc_subnet` resource's own `.id`, not its
       `.ipv4_subnet_id` (the underlying network ID that ELB's
       `ipv4_subnet_id`/`subnet_id` fields expect) — using the wrong one
       failed with `NAT.0005` ("Network ... does not exist"). Also
       surfaced an unrelated pre-existing issue: VPC deletion timed out
       twice via `terraform destroy` (`timeout while waiting for state to
       become 'DELETED'`) because of a **VPC Endpoint Service left over
       from 2026-07-20** (confirmed via the console's own delete-blocker
       list, cross-checked against `terraform state list` showing nothing
       endpoint-related and the resource's real creation timestamp
       predating this session by days) — not something Terraform created
       or could clean up; had to be deleted manually via console before
       `terraform destroy` could complete.

     Route Table / NAT Gateway / VPC Peering Discovery: **deliberately not
     built**, a real decision rather than an oversight. ServiceNow's
     standard CMDB CI Class Model doesn't treat routing configuration
     (route tables, NAT gateways, peering connections) as standalone
     discoverable assets - they're modeled as configuration attached to a
     VPC/Subnet, not separately identified/reconciled resources. Inventing
     a CI class mapping here with no platform precedent would be exactly
     the kind of self-invented special-case this project's standing rule
     warns against, so Terraform-only coverage is the intentional end
     state for these three, not a pending gap. Security Group's, EVS's,
     and EIP's Discovery are all done (see above); the next Discovery work
     moves to ELB/RDS instead - both have clear, standard CI class
     mappings (`cmdb_ci_cloud_load_balancer` / `cmdb_ci_cloud_database`).
3. **Platform services** — ELB, RDS, OBS (buckets only), CCE
   (cluster/node/namespace/workload/service/ingress — no Pods). Terraform
   grounding for all four is now real-PDI verified: `terraform/main.tf`
   provisions `huaweicloud_elb_loadbalancer` (+ listener/pool/member, the
   sandbox ECS instance registered as backend), `huaweicloud_rds_instance`
   (single-node MySQL 8.0), `huaweicloud_obs_bucket`, and
   `huaweicloud_cce_cluster` (+ `huaweicloud_cce_node_pool`, one node),
   all confirmed via a full apply + destroy against the real sandbox
   (CCE took ~6 min for the cluster alone; node pool creation is fast
   once the OS value is right — see gotcha below). Two real gotchas hit:
   - The RDS admin password failed Huawei's complexity check (`DBS.
     280203`, "Weak password") on a first attempt — needs uppercase +
     lowercase + digit + special character, 8-32 chars, not containing
     the username.
   - The CCE node pool's `os` field took **three wrong guesses**
     (`"EulerOS 2.9"` — the Terraform provider docs' own example value;
     `"HCE 2.0"`; `"HCE OS"`, the abbreviation shown in the console
     tooltip) before finding the actual required string via Huawei's
     official node-OS API docs: **`"Huawei Cloud EulerOS 2.0"`** (the
     exact console display text, verbatim) — this cluster's
     auto-selected `cluster_version` (`v1.35`) only supports this one OS
     for node creation; the provider docs' generic example wasn't valid
     for this version. Confirmed via the console's own node-creation
     form, which showed only this one OS as selectable.

   **ELB: Discovery real-PDI verified**, the first Phase 3 resource type
   done. `HuaweiElbDiscovery.js` (own file/host, `elb.{region}.myhuaweicloud.com`,
   real-PDI confirmed) fetches `GET /v3/{project_id}/elb/loadbalancers`
   (same marker-pagination shape as VPC/Subnet/Security Group, real-PDI
   confirmed) and reconciles into `cmdb_ci_cloud_load_balancer`
   (ServiceNow's standard CMDB class for cloud load balancers, real-PDI
   confirmed to exist). Two real corrections made during real-PDI testing:
   1. The real payload's `vpc_id` field looked like an obvious relation
      target, but the real OOTB containment rule (confirmed via a real
      `MISSING_DEPENDENCY` error) wants `Hosted on::Hosts` to a
      `cmdb_ci_logical_datacenter` placeholder instead - the same fallback
      already proven for VPC/Security Group/EVS. Matches this project's
      standing rule to let the real error decide rather than guess ahead
      of it, even when a seemingly-obvious field is sitting right there in
      the payload.
   2. `cmdb_ci_cloud_load_balancer` has a real working OOTB Identification
      Rule ("Cloud LoadBalancer Rule") keyed on `object_id` - a real
      `MISSING_MATCHING_ATTRIBUTES` error caught this field's initial
      omission (the same class of oversight already avoided for every
      other resource type in this project, missed here on the first
      pass, fixed on the second).
   Real-PDI verified end to end: `hasError:false`, the load balancer CI
   and its `Hosted on::Hosts` relation both inserted, confirmed idempotent
   on a second run (`insertCount:0, refreshCount:1`, all `NO_CHANGE`, no
   warnings).

   Discovery work for RDS/OBS/CCE hasn't started; only the provisioning
   side is verified for those three.
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
