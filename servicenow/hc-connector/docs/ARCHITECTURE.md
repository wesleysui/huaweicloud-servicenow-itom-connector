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

   **RDS: Discovery real-PDI verified.** `HuaweiRdsDiscovery.js` (own
   file/host, `rds.{region}.myhuaweicloud.com`, real-PDI confirmed) fetches
   `GET /v3/{project_id}/instances` (row-offset pagination with a real
   `total_count` field - a genuine hybrid of ECS's page-number style and
   EVS's no-total-count style, real-PDI confirmed) and reconciles into
   `cmdb_ci_cloud_database` (ServiceNow's standard CMDB class for
   cloud-managed databases, real-PDI confirmed to exist). Its real OOTB
   containment rule turned out to be the same `Hosted on::Hosts ->
   cmdb_ci_logical_datacenter` pattern already proven for
   VPC/Security Group/EVS/ELB - confirmed via a real `MISSING_DEPENDENCY`
   error, fixed with the same local placeholder-pair approach. Unlike
   ELB, `object_id` was included proactively this time (a deliberate
   choice, not a guess - Security Group/EVS/ELB had all already
   established the pattern) and it worked on the first try: no
   `MISSING_MATCHING_ATTRIBUTES` error, `cmdb_ci_cloud_database`'s real
   OOTB Identification Rule ("Cloud DataBase Rule") matched immediately.
   Real-PDI verified end to end (`hasError:false`, instance CI + relation
   both inserted) and confirmed idempotent on a second run
   (`insertCount:0, refreshCount:1`, all `NO_CHANGE`).

   **OBS: Discovery real-PDI verified**, buckets only, permanently never
   per-object (a bucket can hold millions of objects). Two things made
   this the most involved resource type in this project so far:

   1. **A genuinely different signing scheme.** OBS doesn't use the
      IAM-wide "SDK-HMAC-SHA256" scheme every other service here does -
      it uses its own, S3-compatible-style signature:
      `Authorization: OBS <AK>:Base64(HMAC-SHA1(SK, StringToSign))`. This
      needed a brand-new pure-JS HMAC-SHA1 implementation
      (`lib/pureJsSha1.js`, cross-checked against Node's own `crypto` -
      see that file's header comment for why hand-rolling was necessary
      again, same platform constraint as SHA-256). One real correction
      during testing: Huawei's own doc text for the StringToSign formula
      reads as if there's an extra newline between CanonicalizedHeaders
      and CanonicalizedResource, but a real 403 `SignatureDoesNotMatch`
      error echoed the server's own computed StringToSign back verbatim,
      proving there's exactly ONE newline when CanonicalizedHeaders is
      empty. The response is also
      XML, not JSON - the only Huawei API family in this project that
      isn't - parsed via a targeted regex extraction
      (`lib/parseObsBucketsXml.js`), not a namespace-aware XML DOM parse
      (the response declares a default XML namespace with no established,
      real-PDI-confirmed pattern for namespace-aware lookup in a
      ServiceNow scoped script).
   2. **No suitable existing CMDB class.** A more specific object-storage
      class was researched and expected to exist
      (`cmdb_ci_cloud_object_storage`), but doesn't on a base instance -
      confirmed via a real `sys_db_object` query (zero results), then two
      follow-up plugin install attempts (Service Mapping, then CMDB CI
      Class Models) both left it missing, confirmed again via a real
      `sys_plugins` query finding neither installed under those names.
      A couple of even more specific, vendor-named bucket class
      candidates were also checked and don't exist - those ship with a
      separate, dedicated connector product, out of scope to depend on
      for this project. The two remaining real, already-existing
      generic candidates were checked field-by-field, not by name, and
      both rejected on real semantic grounds:
      `cmdb_ci_cloud_storage_account` is shaped like a multi-service
      storage-account bundle (real `blob_service`/`file_service`/
      `queue_service`/`table_service` fields bundling four service types
      under one resource - a real structural mismatch for Huawei OBS,
      which is flat, no account tier); `cmdb_ci_storage_container` looked
      promising by name but its real fields (`total_size`/`used_size`/
      `controller`/`controller_type`) are SAN/NAS block-storage shaped,
      not cloud object storage. Since a dedicated class is the standard
      way to model a resource type with no clean generic fit rather than
      reusing a mismatched one, this project built its own:
      `x_2021019_huawei_0_huawei_cloud_obs_bucket`, created via Studio,
      extending `cmdb_ci` directly (a more specific
      `cmdb_ci_cloud_resource_base` ancestor exists and would have been
      preferred, but wasn't extendable from this scoped app in Studio's
      table-creation UI - real-PDI observed, not assumed). A manual
      Independent Identification Rule (criterion attribute
      `correlation_id`) was created via CI Class Manager, the same
      approach already proven for VPC/Subnet in Phase 2B. See
      `docs/ACL-SETUP.md`'s Step 4 for the exact creation steps and
      `servicenow/discovery/lib/mapObsToIRE.js`'s header comment for the
      full investigation trail.

   Real-PDI verified end to end: all 5 real buckets in the sandbox
   account inserted with `hasError:false` - no relations needed at all
   (a brand-new class has no OOTB containment/hosting rule registered,
   unlike every other resource type here) - and confirmed idempotent on a
   second run (`insertCount:0, refreshCount:5`, all `NO_CHANGE`).

   **CCE: cluster Discovery real-PDI verified**, node/namespace/workload/
   service/ingress deliberately out of scope for this architecture.
   `HuaweiCceDiscovery.js` (own file/host, `cce.{region}.myhuaweicloud.com`,
   real-PDI confirmed) fetches `GET /api/v3/projects/{project_id}/clusters`
   (no pagination attempted, matching OBS's low-cardinality-resource
   assumption) and reconciles into
   `x_2021019_huawei_0_huawei_cloud_cce_cluster`, a dedicated custom CI
   class - the same "nothing fits" situation as OBS, but more so: a real
   `sys_db_object` search for kubernetes/k8s/cce/container_cluster/
   generic-cluster classes on this instance found zero results, not even
   a mismatched candidate to reject. Created via Studio (extends
   `cmdb_ci`) with a manually-created Independent Identification Rule
   (`correlation_id`), same process as OBS. The response is
   Kubernetes-shaped (`kind`/`apiVersion`/`items[]`, each item nested
   under `metadata`/`spec`/`status`) - the only Huawei API in this
   project shaped that way, everything else is a flat object. Real-PDI
   verified end to end (`hasError:false`, cluster CI inserted, zero
   relations needed - matches OBS's outcome exactly) and confirmed
   idempotent on a second run (`insertCount:0, refreshCount:1` - an
   `UPDATE`, not `NO_CHANGE`, reflecting the cluster's real status
   transitioning while it finished provisioning between the two runs,
   still correctly matched to the same CI rather than creating a
   duplicate).

   Node/namespace/workload/service/ingress (and Pods, see Phase 4 below)
   are a real architectural boundary, not a scope-narrowing shortcut:
   discovering resources INSIDE a Kubernetes cluster requires reaching
   the cluster's own Kubernetes API server - a MID Server positioned with
   network access to the cluster, plus Kubernetes-native auth - a
   fundamentally different discovery mechanism than every other resource
   type in this project (a direct, agentless REST call to Huawei's public
   regional API, no MID Server anywhere else). This boundary was
   confirmed by checking how mainstream cloud connectors handle the
   equivalent managed-Kubernetes case: they don't extend their own
   agentless, cloud-management-API-based mechanism into the cluster
   either - that's handled by a separate, MID-Server-based Kubernetes
   discovery pattern, a genuinely different product/mechanism, not a
   missing feature of the cloud-resource connector.
4. **Opt-in Pod discovery** — blocked on the same MID Server boundary as
   CCE's other in-cluster resources above, not just "not started yet."
   The original design (namespace/label-filtered, default off, excludes
   `kube-system`, Jobs/CronJobs, completed Pods, 24h retirement after
   termination) remains the intended shape if this boundary is ever
   addressed with a real MID Server deployment story.
5. **Event gateway** — a real FunctionGraph/API Gateway reference
   implementation in front of Cloud Eye/CTS/Config/SMN, signature
   verification, HTTPS/origin allow-listing, dedup, retry, dead-letter
   queue, rate limiting; the standard Event Envelope in production use.
6. **Provisioning & Day-2** — CPG/Terraform catalog expansion (EVS/EIP/ELB/
   RDS/OBS/CCE), encrypted remote Terraform state, Flow Designer Day-2
   operations (start/stop/resize/attach/etc.) via IntegrationHub.

Each phase gets its own detailed plan, explicit approval, and end-of-phase
report before the next one starts.

## Phase 4 research: the MID Server question for in-cluster discovery

Research pass (2026-07-25), not yet a decision or a build - this
documents what's actually involved before Phase 4 gets scoped.

**How the standard mechanism actually works.** Discovering resources
inside a Kubernetes cluster (node/namespace/pod/service/deployment/
replicaset/daemonset/statefulset/container/image) is handled by a
horizontal Discovery Pattern that talks to the cluster's own Kubernetes
API server directly (`/api/v1/pods`, `/apis/apps/v1/deployments`, etc.),
not the cloud vendor's management API. It requires:

- A platform application ("Discovery and Service Mapping Patterns" from
  the ServiceNow Store) installed to get the Kubernetes credential type
  and pattern - NOT yet checked whether this is available on this
  instance (a real check is needed before this phase can start, same as
  the OBS/CCE plugin-availability checks already done for those CI
  classes).
- A MID Server with network reachability to the cluster's API endpoint
  and a Kubernetes credential (Bearer token or client cert).
- The API server's SSL certificate trusted by the MID Server's Java
  keystore, or discovery fails with SSL handshake errors.
- Namespace/label filtering to control scope - a real environment can
  produce 150+ CIs per cluster (cluster/node/pod/service/deployment/
  replicaset/daemonset/statefulset/container/image each become their own
  CI) without it. This is the concrete reason behind this project's
  original "opt-in, namespace/label-filtered, default off" design for
  Pod discovery - not a made-up caution, a documented real volume
  problem.

**MID Server placement - two real options, a genuine tradeoff, not yet
decided:**

1. **In-cluster MID Server** - deploy the MID Server itself as a
   workload inside the target Kubernetes cluster (via a Deployment +
   ServiceAccount + ClusterRole scoped to only the read permissions
   needed). It auto-discovers and auto-authenticates to its own
   cluster's API server via the pod-mounted ServiceAccount token - no
   manual long-lived Bearer Token management. Tradeoff: needs one MID
   Server workload per cluster (or a clear multi-cluster management
   story if this project ever needs to discover more than one), and
   that MID Server itself becomes a workload this project's Discovery
   would presumably also need to account for.
2. **External MID Server** (e.g. reusing the existing sandbox ECS
   instance) - requires the MID Server to reach the cluster's API
   endpoint over the network. Huawei CCE clusters support both a
   private/intranet-only API endpoint (the safer default) and an
   optional public API endpoint. If public access is enabled, an
   external MID Server needs no VPN/peering - closer in spirit to this
   project's existing zero-VPN, direct-API architecture, just with a
   real MID Server process instead of a plain REST call. If only
   private access is used (the more security-conscious choice many
   real deployments make deliberately), the MID Server must be
   network-positioned inside the same VPC (or reachable via VPN/peering)
   - a real infrastructure requirement this project doesn't have
   anywhere else.

**A real automation opportunity, not yet built.** Huawei CCE has its own
API for retrieving a cluster's certificate/kubeconfig, authenticated
with the same AK/SK this project already uses everywhere else. This
means the Kubernetes credential itself could potentially be fetched
programmatically (mirroring this project's existing credential-handling
pattern) rather than requiring a user to manually run `kubectl create
token` and paste a long-lived Bearer Token into ServiceNow's Discovery
Credentials by hand - worth designing in if/when this phase is actually
built, not assumed to work until tried.

**Open, unresolved before this phase can be scoped for real:**

- ~~Confirm whether "Discovery and Service Mapping Patterns" is
  available/installable on a target instance~~ - **CONFIRMED real-PDI**:
  the app (`sn_itom_pattern`) installed successfully, and a real
  "Kubernetes" option appeared in Discovery Credentials' Type field
  afterward, confirming the Kubernetes pattern content is present. NOT
  yet confirmed whether the underlying base Discovery product itself is
  licensed/active on this instance (a separate question from this
  content pack being installed) - needs checking before assuming a real
  Discovery Schedule against a cluster will actually run.
- ~~Decide in-cluster vs. external MID Server placement~~ - **DECIDED**:
  in-cluster. Avoids the network-reachability question entirely (no
  VPN/peering/public-API-exposure decision needed) and the
  auto-authenticating ServiceAccount-token mechanism avoids manual
  Bearer Token management - the more self-contained option, accepting
  "one MID Server workload per cluster" as the real tradeoff.
- **NOT yet resolved**: which in-cluster mechanism to actually deploy.
  Two real, different options turned up in research, not yet compared on
  this instance:
  1. A generic **containerized MID Server** (officially supported since
     the Rome release) - the classic mechanism, works with the base
     Discovery product + the Kubernetes pattern content already
     confirmed installed (`sn_itom_pattern`). Requires downloading a MID
     Server container image from ServiceNow (needs instance/HI
     credentials), a container registry the cluster can pull from
     (Huawei's SWR would be the natural choice), a Deployment + minimal
     read-only ServiceAccount/ClusterRole, and MID Server config pointing
     back at this instance.
  2. **Kubernetes Visibility Agent** (formerly "CNO for Visibility") - a
     separate, purpose-built, Helm-chart-installed ServiceNow product
     specifically for Kubernetes visibility, distinct from a generic MID
     Server. NOT yet confirmed whether this is available/licensed on
     this instance, or how its data model compares to the classic
     MID-Server + Kubernetes-Discovery-Pattern mechanism already
     confirmed available. Needs a real availability check before
     choosing between the two, same discipline as every other "does this
     real thing exist here" question in this project.
- Downloading/building/deploying the actual MID Server (or Visibility
  Agent) container is real infrastructure work beyond what a Background
  Script can verify - this is the next real session's starting point,
  not something to rush through.

## Roadmap review (2026-07-25) — candidate resource types beyond the current plan

While researching CCE's discovery boundary, this project's resource
coverage was cross-referenced against a mainstream cloud connector's own
published resource/CI-class list (not the "best-fit-name" style research
used for individual mappings elsewhere - a direct list of every resource
type it covers). Two findings shaped this section:

- **Messaging (queues/topics), CDN, DNS, IAM, and container orchestration
  are NOT in that connector's own base resource list either** - the same
  boundary this project already drew for CCE (cluster only, no
  node/namespace/workload) turns out to match the industry pattern more
  broadly: mainstream CMDB connectors stay focused on infrastructure
  (compute/network/storage/database/load-balancing), not the full breadth
  of a cloud vendor's managed-service catalog. This is reassuring
  evidence the current 10-resource-type scope isn't an arbitrary subset -
  it's close to the actual conventional boundary.
- **A handful of real gaps worth tracking as future candidates**, none
  urgent, none currently planned as a numbered phase:
  - **Function-as-a-Service** (Huawei FunctionGraph) - already tracked as
    part of Phase 5's event-gateway work (`x_hwc.itom` FunctionGraph/API
    Gateway reference implementation), not a new addition, just
    confirmed as a real, recognized resource category elsewhere too.
  - **A managed NoSQL/key-value database service** (distinct from the
    relational `cmdb_ci_cloud_database` class RDS already uses) - Huawei
    has multiple candidate services here (GaussDB NoSQL, DDS); not yet
    scoped, no CI class chosen, would need the same research-then-verify
    process as every resource type in this project.
  - **Multi-account/organization structure as a real CMDB CI**
    (`cmdb_ci_cloud_org`-style class) - this project currently models
    multi-account/region structure via its own `HC Cloud Account`/
    `HC Cloud Region` tables (Phase 1), not a CMDB CI. Worth a future
    look at whether surfacing this as a real CI (rather than only an
    app-internal bookkeeping table) adds value, but a real design
    question, not a gap to just fill.
  - **Availability Zone as its own CI**, more granular than the current
    shared `cmdb_ci_logical_datacenter` per-region placeholder used
    throughout Phase 2B/2C/3. Would only matter once AZ-level placement
    actually needs representing (e.g. AZ-aware capacity/failure-domain
    reporting) - not clearly valuable yet on its own.
  - **NAT Gateway - worth one more look, not a reversal yet.** Phase 2C's
    decision to skip Route Table/NAT Gateway/VPC Peering Discovery was
    based on finding no CI class for any of the three. This review found
    a real `cmdb_ci_cloud_gateway` class in the same reference connector's
    list that wasn't checked against NAT Gateway specifically at the
    time - worth confirming on this instance (existence + field shape)
    before deciding whether to revisit that decision for NAT Gateway
    alone; Route Table and VPC Peering had no candidate class then and
    none turned up in this review either.

None of the above changes the current phase plan - CCE cluster Discovery
(this phase) and the existing Phase 4-6 scope proceed as already defined.
These are logged here so they aren't lost, not because they're
next.

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

## Day-2 operations (Phase 6, first slice: ECS start/stop/reboot)

Cross-referencing this project's own coverage against a mainstream cloud
connector's capability set (see the "Roadmap review" section above)
surfaced two real gaps that widen more than any remaining resource-type
addition would: production multi-account auth (`AgencyCredentialProvider`,
blocked on a real Organizations account) and Day-2 operations - the
ability to act on a resource from ServiceNow, not just observe it. Day-2
was picked first: unlike IAM Agency, it needs no new account/infrastructure
to build and real-PDI verify, since it operates against the same sandbox
ECS instance already discovered.

**Design.** `lib/ecsLifecycleAction.js` (pure, unit-tested) builds the
request body for Huawei's Nova-compatible batch action API
(`POST /v1/{project_id}/cloudservers/action` - `os-start`/`os-stop`/
`reboot`, each accepting a SOFT/HARD mode for stop/reboot). The ServiceNow
wrapper, `service-graph/HcConnectorEcsLifecycleAction.js`, is this
project's first artifact that WRITES to the cloud account - everything
before it only ever read. Two reuse decisions kept it thin:

- **Credential/region resolution reuses `HC Resource Sync State`** (the
  table every sync orchestrator already writes: account, region,
  native_key, keyed by resource_type + ci) rather than adding a new
  lookup path - given a CI sys_id, a single query resolves which account/
  region it came from, then `createCredentialProvider()` resolves
  credentials exactly as every sync orchestrator already does.
- **Signing reuses `HuaweiECSDiscovery._sign()` directly**
  (`new HuaweiECSDiscovery(config)._sign(req)`) instead of duplicating the
  SDK-HMAC-SHA256 crypto block a ninth time. This is the same cross-
  Script-Include delegation `HcConnectorEcsSync.js` already uses for
  fetch/reconcile - `HuaweiECSDiscovery.js` stays untouched (frozen,
  real-PDI verified), only read from. Confirmed safe to call externally:
  `_sign()` resolves credentials via `_explicitCredential`
  (`config.accessKey`/`.secretKey`, already how every orchestrator
  constructs it), never `gs.getProperty()`, when explicit credentials are
  supplied.

Exposed via three `cmdb_ci_vm_instance` UI Actions (Start/Stop/Reboot
Instance) - server-side only, no GlideAjax, matching the "Run Sync Now"
UI Action's already-proven pattern (see the "Setup automation" section
above) rather than reopening the UI Page question this project already
decided against. Each UI Action's Condition field calls
`HcConnectorEcsLifecycleAction.isManaged(current.getUniqueValue())` so the
buttons only appear on CIs this connector actually discovered -
`cmdb_ci_vm_instance` is a shared platform table other Discovery sources
may also populate.

**Status: real-PDI verified end to end** (start + stop, against a real
sandbox ECS instance, confirmed both in the ServiceNow log output AND
directly on the Huawei Cloud console - not just "no error thrown"). Two
real issues were found and fixed along the way, both instructive:

1. **First real-PDI paste failed** with `"createCredentialProvider" is not
   defined"` - the Script Include had been pasted directly rather than
   generated, and `createCredentialProvider()` is a bare function (not a
   `Class.create()` class), so it's only visible within whichever ONE file
   it's physically concatenated into - it doesn't become globally
   available just because `HcConnectorEcsSync` happened to load it first,
   the same reason `HcConnectorEcsSync.js`/`HcConnectorVpcSync.js` needed
   codegen treatment in the first place. Fixed by adding
   `HcConnectorEcsLifecycleAction.js` to `scripts/build-script-include.js`'s
   `BUILD_TARGETS` (inlining only `lib/credentialProvider.js`, not the
   full `SHARED_MODULES` list - this file doesn't touch `HC Resource Sync
   State` lifecycle/planning logic) - `docs/generated/
   HcConnectorEcsLifecycleAction.generated.js` is the paste-ready output,
   same convention as the sync orchestrators.
2. **First stop attempt against a stale CI produced a false-positive
   success.** The CI tested against (`wsl-manual-smoke-test-1784281457`)
   had already been deleted on Huawei Cloud outside this project's own
   Terraform state (real drift - `terraform show` still reported it
   `ACTIVE`), but `HcConnectorEcsLifecycleAction` doesn't check CI
   freshness before acting, so the code issued the stop request as
   normal - and Huawei's API returned a plain `HTTP 200` for a
   nonexistent server, with a response body this code wasn't logging on
   the success path (only the failure path logged `responseBody`). Fixed
   by logging the response body on success too, then re-tested against a
   freshly Terraform-applied real instance instead of chasing the stale
   one further - not a code-correctness bug in the strict sense (the
   action really was accepted by Huawei), but a real gap in this code's
   ability to distinguish "accepted" from "meaningful," logged here rather
   than silently worked around.

**Huawei's real response shape, confirmed**: both `os-stop` and `os-start`
returned `HTTP 200` with body `{"job_id": "<uuid>"}` - not the empty body
this code originally assumed. `performAction()` now checks Huawei's async
job-tracking endpoint (`GET /v1/{project_id}/jobs/{job_id}`) once,
immediately after issuing the action, and returns `jobStatus: 'SUCCESS'`
(job already finished) / a real in-progress value like `'RUNNING'`/`'INIT'`
(not yet finished) / `null` (no job_id in the response, a defensive
fallback for the originally-assumed empty-body shape) instead of only
trusting the initial 2xx. A job already reporting `FAIL` at that check
throws, same as an HTTP error - both mean "the requested action did not
happen." This directly closes the gap the stale-CI false positive above
exposed: a stop against a nonexistent server now either surfaces a real
`FAIL` immediately, or an honest non-terminal status instead of a bare
"requested" message indistinguishable from a real success.

**Second real-PDI attempt found a second real bug: `gs.sleep()` is fenced
in this scope.** The first version of job checking was a multi-attempt
wait-and-poll loop (5 attempts, 2s apart, using `gs.sleep()` between
attempts) - a real-PDI test of it failed immediately with
`com.glide.script.fencing.MethodNotAllowedException: Function sleep is not
allowed in scope x_2021019_huawei_0`. This is a genuine ServiceNow platform
restriction (custom scoped apps are fenced away from `gs.sleep()`, likely
to stop a runaway loop from blocking a platform execution thread), not a
bug to route around by retrying harder. Fixed by dropping the loop
entirely: `performAction()` now does exactly ONE non-blocking job-status
check, and a new public `checkJobStatus(ciSysId, jobId)` method lets the
caller (or a follow-up Background Script) check again later if the first
check found the job still running. `JOB_POLL_MAX_ATTEMPTS`/
`JOB_POLL_INTERVAL_MS` and the now-dead `isTerminalJobStatus()` pure-lib
helper were removed rather than left unused.

**The same latent risk existed in every Discovery file's retry/backoff
logic** (`HuaweiECSDiscovery.js`/`HuaweiVpcDiscovery.js`/
`HuaweiEvsDiscovery.js`/`HuaweiElbDiscovery.js`/`HuaweiRdsDiscovery.js`/
`HuaweiObsDiscovery.js`/`HuaweiCceDiscovery.js` all called `gs.sleep()` in
their `_shouldRetry`/backoff path on a retryable HTTP status). None of
these had ever actually hit a real 429/500/502/503/504 in this project's
real-PDI testing, so this exact fencing exception had never been triggered
there - but if one ever had, retry would itself have crashed instead of
retrying. **Fixed proactively across all seven**, a deliberate exception to
this project's usual "frozen file, don't touch without a real trigger"
convention - not a guess about whether the fencing applies (the exception
message is explicit: `MethodNotAllowedException: Function sleep is not
allowed in scope x_2021019_huawei_0`, a property of the scope, not of any
one Script Include), so leaving the other seven unfixed would just be
deferring an already-confirmed bug. Each file's retry loop now retries
immediately (no backoff delay - the only option once `gs.sleep()` is off
the table); the now-dead `_computeBackoffMs` method was removed from each
file rather than left unused, and each file's header comment updated to
stop listing it among the byte-for-byte-copied helpers. This is a
proactive fix, not itself real-PDI verified against an actual retryable
HTTP status in any of the seven (none has ever occurred) - `npm test` +
`check-mirror-drift.js` (all 9 pairs, including the SHA-256/SHA-1 hex
constants each of these files still mirrors) both pass, confirming the
edits didn't disturb the untouched crypto/pagination logic around them.

**Real-PDI verified end to end**, including the fix: after redeploying
both the Script Include and all three UI Actions (the UI Actions needed a
separate redeploy - an easy step to miss, since only the Script Include
had actually changed in the fencing fix, but the UI Actions' own message
branching had changed too, in an earlier edit that hadn't been redeployed
yet, which produced a confusing intermediate result where the Script
Include's log showed correct RUNNING-status handling while the on-screen
message still showed the old generic text), a real stop then start against
the live sandbox instance both showed the real in-progress status
(`... status: RUNNING. Not yet confirmed complete - check back shortly.`),
and a follow-up `checkJobStatus()` call confirmed each job reached
`SUCCESS` (~15-20s of real wall-clock time from `begin_time` to
`end_time`). Both outcomes were independently confirmed on the Huawei
Cloud console directly, not just from the job status alone.

Also not yet tested: the real error shape when calling `stop` on an
already-stopped instance (or `start` on an already-running one) - Huawei's
API is expected to reject this, not silently no-op, and this code doesn't
special-case it.

**Deliberately out of scope for this slice**: resize/attach/detach (higher
blast-radius operations, left for a later Day-2 pass once start/stop/
reboot's real error handling is proven), and any Flow Designer/
IntegrationHub wrapping (the UI Action is the minimal real capability;
wiring it into a Flow Designer action for use in Change/Request workflows
is additive and doesn't change anything built here).

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
