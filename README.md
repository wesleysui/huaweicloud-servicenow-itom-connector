# huaweicloud-servicenow-itom-connector

Reference implementation for integrating **Huawei Cloud** with **ServiceNow ITOM**
(Provisioning, Discovery, Event Management) — since Huawei Cloud has no
out-of-the-box ServiceNow Spoke/Connector, every pattern here is built from
generic, extensible ServiceNow primitives (REST Messages, IRE, Event Rules,
IaC Blueprints) that other unsupported clouds can reuse.

> **Status: reference implementation / starter kit.** The mapping/business
> logic is unit tested; the Terraform is statically validated in CI. **All
> three ITOM pillars have been verified end-to-end against a real Huawei
> Cloud sandbox account and a real ServiceNow PDI**: the `terraform/`
> provisioning module (apply + destroy), the **full Discovery pipeline**
> (AK/SK-signed auth → real HTTP fetch → pagination → IRE reconciliation
> with a containment relationship — a real `cmdb_ci_vm_instance` CI was
> created with zero errors), and **Event Management** (webhook → Event
> Rule → a real alert with correctly mapped severity and a bound
> `cmdb_ci`). See
> [servicenow/event-management/README.md](servicenow/event-management/README.md)
> for the Event Management setup detail.

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
│   └── hc-connector/                 # HC ITOM Connector productization (Phase 2A: ECS platform wiring, real-PDI verified - see its own README)
│       ├── README.md                 # what's delivered vs. the Phase 2B-6 plan
│       ├── docs/ARCHITECTURE.md      # target architecture across all 6 phases
│       ├── docs/INSTALL.md           # install steps (automatable / manual-admin) through Phase 2A
│       ├── docs/ACL-SETUP.md         # Studio table/role/ACL creation steps (Phase 2A)
│       ├── docs/RESOURCE-MATRIX.md   # resource-type support matrix, phase-mapped
│       ├── tables/*.schema.json      # HC Cloud Account/Region/Discovery Run/Resource Sync State/Event Ingestion Record/Connector Config
│       ├── lib/                      # pure: credentialProvider, resourceLifecycle, eventEnvelope, discoveryRunTracker, syncStatePlanner
│       ├── service-graph/HcConnectorEcsSync.js # multi-account/region ECS orchestrator (hand-written codegen template)
│       ├── docs/generated/HcConnectorEcsSync.generated.js # paste-ready Script Include (codegen output)
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

| Component | Implemented | Not yet implemented |
|---|---|---|
| Terraform module | ✅ `terraform/main.tf` — VPC/SG/ECS/EVS/EIP/ELB/RDS/OBS/Route Table/NAT Gateway/VPC Peering/CCE, **all real cloud resource types in the roadmap now verified against a real Huawei Cloud sandbox** (apply+destroy), validated with `terraform validate`/`tflint` in CI | Remote state backend, Day-2 ops beyond create/destroy, the GitHub Actions smoke-test workflow itself is still untriggered |
| CPG Blueprint wiring | 📝 Documented manual steps (`servicenow/cpg/README.md`) | Not exported as an Update Set / one-click installer |
| ECS Discovery | ✅ **Fully verified end-to-end against a real Huawei Cloud account + real ServiceNow PDI**, warning-free and idempotent on repeat runs — AK/SK-signed auth, real HTTP fetch, pagination, and IRE reconciliation all the way through to a real `cmdb_ci_vm_instance` CI + containment relationship, zero errors and zero warnings; **hardened** (pagination, retry/backoff); unit tested; alternate password/IAM-token design kept as a documented option | Other resource types (RDS — planned next); real VPC/Subnet, Security Group, EVS, and EIP discovery are now also real-PDI verified, see the productization row below |
| Event Management | ✅ **Fully verified end-to-end against a real Huawei Cloud account and a real ServiceNow PDI**: Scripted REST webhook, severity mapping, and CI binding (Event Rule created via the Event Rule Designer wizard — requires the "Service Operations Workspace ITOM Apps" Store app) all confirmed producing a correctly severity-mapped, CI-bound alert; unit tested | HMAC/signature verification, broader metric coverage, incident auto-creation — see [servicenow/event-management/README.md](servicenow/event-management/README.md) |
| Packaging | ✅ "Run Sync Now" UI Action + periodic scheduled sync, both real-PDI verified | 🚧 One-click install for an unrelated account: plan decided (Application Repository Mode), deferred until feature-complete — see `servicenow/hc-connector/docs/ARCHITECTURE.md` |
| Automated integration tests | ❌ Manual plan only (`tests/atf/README.md`) | Needs a live ServiceNow dev instance + Huawei sandbox account wired into CI |
| **HC ITOM Connector productization** | ✅ **Phase 2A + 2B (of 6), both real-PDI verified**, plus Security Group, EVS, and EIP Discovery from Phase 2C: multi-account/region ECS orchestrator (`HcConnectorEcsSync.js`, Phase 2A) — HC2/HC3/HC4 directly exercised, HC1/HC5 on lighter evidence; VPC + Subnet discovery (`HuaweiVpcDiscovery.js`/`HcConnectorVpcSync.js`, Phase 2B) — HC6–HC10 all directly exercised; Security Group and EIP discovery folded into the same VPC orchestrator, and EVS discovery via a new sibling `HuaweiEvsDiscovery.js`/`HcConnectorEvsSync.js` — all real-PDI verified end to end and idempotent on repeat runs. EIP's fix is the first working example in this project of relating CIs across two separate discovery runs — via a locally-built stub of ECS Discovery's own `cmdb_ci_virtualization_server` placeholder that IRE matches against the real, already-committed CI through identification, not a raw sys_id. Real codegen covers all three orchestrators via one manifest-driven build script. Route Table/NAT Gateway/VPC Peering Discovery is deliberately NOT planned — they're routing config attached to a VPC/Subnet, not standalone discoverable assets under ServiceNow's CMDB CI Class Model; Terraform-only coverage is the intentional end state. See [servicenow/hc-connector/README.md](servicenow/hc-connector/README.md), [ARCHITECTURE.md](servicenow/hc-connector/docs/ARCHITECTURE.md) | Phases 3–6: platform services (ELB/RDS/OBS/CCE), opt-in Pod discovery, a real event gateway, CPG/Terraform catalog + Day-2 ops |
| **Setup automation & distribution packaging** (cross-cutting, new) | ✅ Native `HC Cloud Account`/`HC Cloud Region` table forms + a "Run Sync Now" UI Action (`servicenow/hc-connector/ui-actions/`) for one-click first sync, plus a periodic `scheduled-jobs/hc_connector_scheduled_sync.js` counterpart, **both real-PDI verified** | 🚧 One-click distribution for an unrelated ServiceNow account — Store publish needs ServiceNow Technology Partner Program (TPP) enrollment, not available to an individual developer instance; Local Update Set packaging doesn't work either (app scope isn't Update-Set-trackable); plan is Application Repository Mode once feature-complete — see `servicenow/hc-connector/docs/ARCHITECTURE.md` |

**Next planned round:** resource-type expansion for Discovery — ELB and
RDS (both have clear, standard CMDB CI classes,
`cmdb_ci_cloud_load_balancer` / `cmdb_ci_cloud_database`), reusing the
pagination/retry/caching groundwork above. Route Table/NAT Gateway/VPC
Peering Discovery is deliberately not planned — see the productization
row above.

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
npm test                              # 233 tests: pure mapping/resilience/signing/crypto math, full control-flow integration tests, and HC ITOM Connector Phase 1/2A/2B logic

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
