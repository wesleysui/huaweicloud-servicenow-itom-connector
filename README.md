# huaweicloud-servicenow-itom-connector

Reference implementation for integrating **Huawei Cloud** with **ServiceNow ITOM**
(Provisioning, Discovery, Event Management, and Day-2 Operations) — since
Huawei Cloud has no out-of-the-box ServiceNow Spoke/Connector, every pattern
here is built from generic, extensible ServiceNow primitives (REST Messages,
IRE, Event Rules, IaC Blueprints) that other unsupported clouds can reuse.

> **Status: reference implementation / starter kit.** Every capability
> claimed below has been run against a **real Huawei Cloud sandbox account
> and a real ServiceNow PDI** — not just unit tested. Where something
> hasn't cleared that bar yet, the tables in this README say so explicitly
> rather than rounding up.

**Highlights, if you're skimming:**
- **All three ITOM pillars work end-to-end today**: Terraform provisioning
  (apply + destroy), CMDB Discovery across 10 resource types (compute,
  network, storage, database, load balancer, object storage, container
  cluster), and Event Management (Cloud Eye alarm → correctly severity-mapped,
  CI-bound `em_event`).
- **Day-2 operations, not just read-only Discovery** — ECS start/stop/reboot
  from the CI form, with real async-job status tracking against Huawei's
  own job-tracking API, not just "request sent."
- **The signing is hand-rolled from scratch**: ServiceNow scoped scripts can't
  use platform crypto APIs or `require()`, so this repo implements
  SDK-HMAC-SHA256 (and OBS's own HMAC-SHA1 variant) in pure ES5 JS,
  cross-verified against Node's `crypto` module and the official Huawei SDK.
  Directly reusable for anyone wiring any AK/SK-signed API into ServiceNow.
- **Every non-obvious decision is backed by a real error, not a guess** —
  the docs keep the actual error messages, API responses, and platform
  restrictions (like ServiceNow fencing `gs.sleep()` in custom scoped apps)
  that drove each design choice, so the "why" survives, not just the "what."

See
[servicenow/event-management/README.md](servicenow/event-management/README.md)
for the Event Management setup detail, or
[servicenow/hc-connector/docs/RESOURCE-MATRIX.md](servicenow/hc-connector/docs/RESOURCE-MATRIX.md)
for the full per-resource-type verification matrix.

## Why this exists

ServiceNow ITOM ships native support for AWS/Azure/GCP/VMware. Huawei Cloud
customers get nothing out of the box across all three ITOM pillars:

| Pillar | Problem | Approach used here |
|---|---|---|
| **Provisioning** | No native cloud account type for cost/tag sync | CPG's cloud-agnostic **IaC Blueprint** engine running a plain Terraform module against the official `huaweicloud/huaweicloud` provider |
| **Discovery** | No OOTB Discovery pattern for Huawei resources | Scheduled script: IAM token auth → ECS list API → **IRE** (`sn_cmdb.IdentificationEngine.createOrUpdateCI`) reconciliation |
| **Event Management** | No connector for Huawei Cloud Eye / IMOC alarms | Scripted REST webhook + **Event Rule** transform script mapping alarms into `em_event`, bound to the CI discovered above via a shared `correlation_id` |

The same `correlation_id` (Huawei's ECS instance UUID) is used in both
Discovery and Event Management — that's the thread tying the CMDB CI to
incoming alerts without a native connector doing it for you.

## Repository layout

```
.
├── terraform/                        # Task 1 — Provisioning
│   ├── main.tf                       # VPC + security group + ECS via huaweicloud/huaweicloud
│   ├── variables.tf
│   └── outputs.tf
├── servicenow/
│   ├── cpg/README.md                 # Task 1 — manual CPG Blueprint configuration guide
│   ├── discovery/                    # Task 2 — Visibility
│   │   ├── HuaweiECSDiscovery.js      # Script Include (IAM auth -> paginated ECS list -> IRE reconcile)
│   │   ├── README.md                 # prerequisites: system properties, token-cache table, credential record
│   │   ├── lib/mapEcsToIRE.js         # pure mapping logic, unit-tested
│   │   ├── lib/ecsPagination.js       # pure pagination math, unit-tested
│   │   ├── lib/httpResilience.js      # pure retry/backoff math, unit-tested (reused by future EVS/EIP/RDS discovery)
│   │   ├── lib/huaweiAkSkSigner.js    # AK/SK request signing (active auth path), cross-verified against the official Huawei SDK
│   │   ├── lib/pureJsSha256.js        # SHA-256/HMAC-SHA256 in pure ES5 JS (no platform crypto API - see "Important notes" in servicenow/discovery/README.md)
│   │   ├── lib/iamTokenCache.js       # [alternate, not wired in] pure token-expiry check for password/IAM-token auth, unit-tested
│   │   ├── lib/huaweiEcsOrchestrator.js # [alternate, not wired in] full auth/cache/retry/pagination control flow for password auth, integration-tested with a fake HTTP client
│   │   └── fixtures/                 # mock Huawei ECS API response + expected IRE payload
│   └── event-management/             # Task 3 — Health
│       ├── webhook-scripted-rest.js  # inbound webhook -> mapped em_event insert (severity/node/description computed here - verified working)
│       ├── event-rule-designer-config.md # exact Event Rule Designer wizard field values (no-code UI, not a script - see README)
│       ├── README.md                 # prerequisites, setup checklist, and the Event Rule creation path
│       ├── lib/mapAlarmToEvent.js    # pure mapping logic, unit-tested
│       └── fixtures/                 # mock Huawei Cloud Eye (CES) alarm payload
│   └── hc-connector/                 # HC ITOM Connector productization (multi-account/region, 10 resource types, Day-2 ops - see its own README)
│       ├── README.md                 # what's delivered vs. the roadmap
│       ├── docs/ARCHITECTURE.md      # target architecture across all phases, with the full real-error-to-fix trail for each
│       ├── docs/INSTALL.md           # install steps (automatable / manual-admin), all the way through Day-2 ops
│       ├── docs/ACL-SETUP.md         # Studio table/role/ACL/custom-CI-class creation steps
│       ├── docs/RESOURCE-MATRIX.md   # resource-type support matrix (Provisioning/Discovery/Events/Day-2 ops), phase-mapped
│       ├── tables/*.schema.json      # HC Cloud Account/Region/Discovery Run/Resource Sync State/Event Ingestion Record/Connector Config
│       ├── lib/                      # pure: credentialProvider, resourceLifecycle, eventEnvelope, ecsLifecycleAction, discoveryRunTracker, syncStatePlanner
│       ├── service-graph/            # multi-account/region orchestrators (one per resource type) + HcConnectorEcsLifecycleAction.js (Day-2 ops)
│       ├── ui-actions/               # Start/Stop/Reboot Instance + Run Sync Now UI Actions (paste-ready)
│       ├── docs/generated/           # paste-ready Script Includes (codegen output - inlines the lib/ modules above)
│       └── scripts/                  # table doc/provisioning-script/build-script-include generators + check-mirror-drift.js (wired into `npm test` via pretest)
├── tests/
│   ├── unit/                         # Jest tests against the lib/*.js pure logic
│   └── atf/README.md                 # manual ServiceNow ATF + curl/Postman test plan
├── .github/workflows/
│   ├── ci.yml                         # Jest + terraform fmt/validate/tflint + JSON lint (runs on every push/PR)
│   └── terraform-sandbox-smoke-test.yml # manual, opt-in: real apply+destroy against a Huawei Cloud sandbox (see CONTRIBUTING.md)
├── CONTRIBUTING.md
└── LICENSE
```

## Implementation status

Short version: **Provisioning, Discovery (10 resource types), Event
Management, and a first Day-2 operations slice are all real-PDI verified.**
Production-grade multi-account auth (IAM Agency) and one-click packaging
are the two biggest open items. Full detail, including every real error
that shaped a design decision, lives in
[ARCHITECTURE.md](servicenow/hc-connector/docs/ARCHITECTURE.md) and
[RESOURCE-MATRIX.md](servicenow/hc-connector/docs/RESOURCE-MATRIX.md) —
this table stays intentionally short.

| Component | Status | Not yet |
|---|---|---|
| Terraform provisioning | ✅ 12 resource types (VPC/SG/ECS/EVS/EIP/ELB/RDS/OBS/Route Table/NAT Gateway/VPC Peering/CCE), all apply+destroy verified against a real sandbox | Remote state backend, Day-2 ops beyond create/destroy |
| CMDB Discovery | ✅ 10 resource types, multi-account/region, idempotent, real-PDI verified — see the productization row below | Pod/node/namespace-level Kubernetes visibility (needs a MID Server, see below) |
| Event Management | ✅ Webhook → Event Rule → severity-mapped, CI-bound alert, real-PDI verified | HMAC/signature verification, broader metric coverage, incident auto-creation |
| Day-2 operations | ✅ ECS start/stop/reboot/resize/attach/detach, all real-PDI verified end to end (see below) | Flow Designer/IntegrationHub wrapping for Change/Request workflows |
| Setup automation | ✅ Native table forms + a "Run Sync Now" UI Action + periodic scheduled sync, real-PDI verified | — |
| Multi-account auth | 🚧 AK/SK (dev/compat mode) real-PDI verified; production-grade IAM Agency is an interface stub | Needs a real multi-account Huawei Organizations setup to build/verify against |
| Packaging / distribution | 🚧 Manual install only (`docs/INSTALL.md`) | One-click install: Store publish needs TPP enrollment (blocked), Update Set doesn't capture app scope (proven not viable); plan is Application Repository Mode once feature-complete |
| Automated integration tests | ❌ Manual ATF plan only (`tests/atf/README.md`) | Needs a live ServiceNow dev instance + Huawei sandbox wired into CI |

**CMDB Discovery detail**: multi-account/region orchestrators for
ECS/VPC/Subnet/Security Group/EVS/EIP/ELB/RDS/OBS/CCE cluster, all
real-PDI verified and idempotent on repeat runs. Two resource types
(OBS, CCE) needed a dedicated custom CI class since no existing platform
class was a genuine semantic fit; EIP's fix is this project's first
working example of relating CIs discovered across two separate runs.
Route Table/NAT Gateway/VPC Peering are Terraform-only by design — no
standalone CI class exists for routing config under ServiceNow's CMDB CI
Class Model, confirmed via research, not assumed. CCE is cluster-only —
anything *inside* a cluster needs a MID Server reaching the cluster's own
Kubernetes API, a real architectural boundary covered in ARCHITECTURE.md's
"Phase 4" section (direction decided, not yet deployed). ECS's
`cpus`/`memory`/`nics`/`disks`/`disks_size` CI fields — always empty before
this pass — are now populated and **real-PDI verified**: `nics` from data
already fetched (free); `cpus`/`memory` from a new per-distinct-flavor
Huawei API call; `disks`/`disks_size` via a direct field write from
`HcConnectorEvsSync.js` (no CMDB relation possible between EVS and ECS CIs
— a hard platform type constraint found and documented, not a design
choice — this also produced this project's first direct cross-scope
`GlideRecord` write to a platform table, confirmed via a real
`cross scope privileges` log line, not just IRE handling it internally).
See ARCHITECTURE.md's "CI hardware fields" section for the full writeup.

**Day-2 operations detail**: this project's first WRITE (not read-only)
operation against the cloud account. Checks Huawei's async job-tracking
endpoint after issuing an action instead of trusting the initial `HTTP
200` alone, so a request that's accepted-but-meaningless (e.g. against an
already-deleted instance) doesn't look identical to a real success. Found
and fixed two real ServiceNow platform issues along the way — including a
scoped-app restriction on `gs.sleep()` that also applied to every
Discovery file's retry logic, fixed proactively across all seven once
confirmed. Resize (`performResize()` + a "Resize Instance" UI Action) was
added afterward, reusing the same job-status pattern but needing this
project's first GlideAjax bridge to collect the target flavor ID
interactively — **real-PDI verified end to end** (job reached `SUCCESS`,
flavor change independently confirmed on the Huawei Cloud console), after
finding and fixing a third scoped-app restriction (`AbstractAjaxProcessor`
must be referenced as `global.AbstractAjaxProcessor` from inside a scoped
app). Attach/detach (`performAttach()`/`performDetach()` + two more UI
Actions) followed the same path, extending the same GlideAjax bridge —
**real-PDI verified end to end** too (attach job `SUCCESS` in ~3s, detach
job `SUCCESS` in ~2.5s, disk's final "available" state independently
confirmed on the Huawei Cloud console). A 7th table, `HC Day-2 Action Log`,
closes a real UX gap found once all six actions worked (a UI Action's
result is a one-time popup) — every action now logs a row, a new
Scheduled Job re-checks it every 2 minutes, and a related list on the CI
form shows the outcome; **real-PDI verified end to end** too (a row
appeared instantly, then flipped to `success` on its own ~90 seconds
later, no Background Scripts or console needed). See
ARCHITECTURE.md's "Day-2 operations" section for the full error-to-fix
trail.

## Quick start

### Prerequisites
- Node.js 18+ (for unit tests)
- Terraform CLI 1.5+ (for the provisioning module)
- A ServiceNow instance with `Cloud Provisioning and Governance`, `CMDB IRE`,
  and `Event Management` plugins active
- A Huawei Cloud IAM user (AK/SK) scoped to a **sandbox/dev** project — do not point this at production while evaluating

### Run the parts that don't need any live account
```bash
git clone <this-repo>
cd huaweicloud-servicenow-itom-connector

npm install
npm test                              # 319 tests: pure mapping/resilience/signing/crypto math, full control-flow integration tests, and HC ITOM Connector logic across every resource type + Day-2 ops

cd terraform
terraform init -backend=false
terraform validate                    # static syntax/schema check, no credentials needed
```

If you go on to `apply` against a real sandbox project, see the
["Known gotchas"](tests/atf/README.md#known-gotchas-found-via-real-sandbox-testing)
section — region/AZ/image-ID mismatches between runs are the most common
first error, not a bug in the module.

### Wire it into a real environment
1. **Provisioning** — follow [`servicenow/cpg/README.md`](servicenow/cpg/README.md) to register the Terraform module as a CPG IaC Blueprint.
2. **Discovery** — create a scoped app, paste in [`servicenow/discovery/HuaweiECSDiscovery.js`](servicenow/discovery/HuaweiECSDiscovery.js) as a Script Include, set the `x_hwc.itom.*` system properties, store IAM creds in a Credential record, and schedule `run()`.
3. **Event Management** — create the Scripted REST resource from [`webhook-scripted-rest.js`](servicenow/event-management/webhook-scripted-rest.js) via Studio's wizard (not a raw `GlideRecord` insert — see the setup checklist in `servicenow/event-management/README.md`), set `x_hwc.itom.webhook_secret`, point a Huawei Cloud Eye → SMN subscription at the webhook URL, and create the Event Rule through the Event Rule Designer wizard using the exact field values in [`event-rule-designer-config.md`](servicenow/event-management/event-rule-designer-config.md) (requires the ServiceNow Store app "Service Operations Workspace ITOM Apps" — see that doc for why).

The steps above wire up the original single-account reference build. For
**multi-account/region Discovery across all 10 resource types, plus Day-2
operations (start/stop/reboot)**, follow
[`servicenow/hc-connector/docs/INSTALL.md`](servicenow/hc-connector/docs/INSTALL.md)
instead — it supersedes steps 2-3 above with the productized version,
building on the same tables/lib/ modules.

## Testing & Validation

Two layers, deliberately kept separate:

| Layer | What it checks | Needs a live account? | Where |
|---|---|---|---|
| **Unit tests (Jest)** | Pure data-mapping logic (IP extraction, severity mapping, IRE/event field construction) + pure resilience math (pagination, retry/backoff, IAM token-expiry) | No | `npm test`, runs in CI on every push/PR |
| **Integration tests (Jest + fake HTTP client)** | The full auth→cache→retry→pagination→re-auth-on-401 control flow, driven end-to-end through a scripted fake HTTP client (`lib/huaweiEcsOrchestrator.js`) — no real network, no ServiceNow | No | `npm test`, runs in CI; see `servicenow/discovery/README.md` |
| **Terraform static checks** | HCL syntax, provider schema compliance, lint rules | No | `terraform validate` + `tflint`, runs in CI |
| **Terraform sandbox smoke test** | Real `apply` + `destroy` of the VPC/SG/ECS module against an actual Huawei Cloud project | Yes — Huawei Cloud sandbox project + secrets | ✅ **Module verified manually** (local CLI, `af-south-1`) — apply + destroy both succeeded. The `.github/workflows/terraform-sandbox-smoke-test.yml` wrapper itself is still untriggered — see CONTRIBUTING.md |
| **ATF test recipes (manual)** | Real IAM auth, forced-401 re-auth recovery, real IRE CI creation/dedup, real `em_event` creation + CI binding, webhook auth rejection | Yes — ServiceNow dev instance + Huawei sandbox | [`tests/atf/README.md`](tests/atf/README.md) — exact stock step types + literal scripts, not yet an importable Update Set (good first contribution!) |

**Why the split:** the ServiceNow scripts call `GlideRecord`, `gs.*`,
`sn_ws.RESTMessageV2`, and `sn_cmdb.IdentificationEngine` — none of which
exist outside a ServiceNow instance. The mapping/business logic inside those
scripts has been extracted into plain, dependency-free modules
(`servicenow/*/lib/*.js`) that mirror the ServiceNow script's logic 1:1, so
that logic can be unit tested cheaply and on every commit. The ServiceNow
script itself, and anything that talks to a real Huawei Cloud API or writes
to a real CMDB, is validated through the ATF/manual plan instead — see
[`tests/atf/README.md`](tests/atf/README.md) for the exact steps (including
`curl` commands for the webhook and an ATF step-by-step for Discovery/Event
Management).

Run everything that doesn't need live credentials in one shot:
```bash
npm test && (cd terraform && terraform init -backend=false && terraform validate)
```

## Security notes
- No secrets are hardcoded anywhere in this repo — Huawei AK/SK and IAM
  credentials are resolved from ServiceNow Credential records at runtime;
  Terraform reads them from `HW_ACCESS_KEY`/`HW_SECRET_KEY` env vars.
- The inbound webhook (`webhook-scripted-rest.js`) requires a shared-secret
  header (`X-Webhook-Secret`) checked against a System Property — Huawei SMN
  webhooks carry no native request signature, so this is a minimum bar, not a
  final answer — HMAC-based verification is a known gap.
- Never commit `.tfvars` files containing real credentials or passwords.

## Contributing
See [CONTRIBUTING.md](CONTRIBUTING.md). Picking up any "Not yet implemented"
item from the status table above as a PR is welcome.

## License
[MIT](LICENSE)
