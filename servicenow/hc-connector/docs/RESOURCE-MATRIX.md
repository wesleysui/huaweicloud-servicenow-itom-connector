# HC ITOM Connector — Resource Support Matrix

Status legend: ✅ real-account verified · 🚧 in progress / designed, not yet
built or verified · ❌ not started · — not applicable.

| Resource | Provisioning (Terraform) | Discovery (CMDB) | Events | Day-2 ops | Phase |
|---|---|---|---|---|---|
| ECS (compute instance) | ✅ verified (`terraform/main.tf`) | ✅ single-account path verified (`servicenow/discovery/`); ✅ multi-account/region path (`HcConnectorEcsSync.js`, Phase 2A) real-PDI verified (HC2/HC3/HC4 directly exercised; HC1/HC5 on lighter evidence) | ✅ verified (`servicenow/event-management/`) — CPU alarms via direct webhook; migrates to the standard Event Envelope + gateway in Phase 5 | ❌ | existing / Phase 2A done |
| VPC | ✅ verified (part of `terraform/main.tf`) | ✅ real-PDI verified (`HuaweiVpcDiscovery.js`/`HcConnectorVpcSync.js`, Phase 2B, HC6) — real CI class `cmdb_ci_network` ("Cloud Network"), not `cmdb_ci_vpc`; real CI created and reconciled against the live sandbox VPC | — | ❌ | Phase 2B |
| Subnet | ✅ verified (part of `terraform/main.tf`) | ✅ real-PDI verified (Phase 2B, HC6) — real CI class `cmdb_ci_cloud_subnet`; real N:M containment relation to its parent VPC confirmed via a real `cmdb_rel_ci` row, not a flat field | — | ❌ | Phase 2B |
| EVS (disk) | ✅ real-PDI verified (`terraform/main.tf`, `huaweicloud_evs_volume` + `huaweicloud_compute_volume_attach`, apply+destroy against real sandbox) | ❌ Discovery not started | 🚧 Cloud Eye emits EVS alarms; no ingestion mapping yet | ❌ | Phase 2C — Terraform grounding done, Discovery pending |
| EIP | ✅ real-PDI verified (`terraform/main.tf`, `huaweicloud_vpc_eip` + `huaweicloud_vpc_eip_associate`, apply+destroy against real sandbox) | ❌ Discovery not started | ❌ | ❌ | Phase 2C — Terraform grounding done, Discovery pending |
| Security Group | ✅ verified (part of `terraform/main.tf`, `huaweicloud_networking_secgroup` + rule, already used since Phase 1) | 🚧 source-complete, not yet real-PDI verified — `HuaweiVpcDiscovery.js` extended to fetch/reconcile Security Groups into `cmdb_ci_compute_security_group` (CI class from AWS SGC research, unconfirmed on this instance), related to VPC via `Contains::Contained by`; no relation to ECS yet (cross-discovery-run relations aren't a solved pattern here) | — | ❌ | Phase 2C — Terraform done, Discovery source-complete, real-PDI pending |
| Route Table | ✅ real-PDI verified (`terraform/main.tf`, `huaweicloud_vpc_route_table` with a real NAT-nexthop route, apply+destroy against real sandbox) | ❌ Discovery not started | — | ❌ | Phase 2C — Terraform grounding done, Discovery pending |
| NAT Gateway | ✅ real-PDI verified (`terraform/main.tf`, `huaweicloud_nat_gateway` + `huaweicloud_nat_snat_rule`, apply+destroy against real sandbox) | ❌ Discovery not started | ❌ | ❌ | Phase 2C — Terraform grounding done, Discovery pending |
| VPC Peering | ✅ real-PDI verified (`terraform/main.tf`, `huaweicloud_vpc_peering_connection` between two real VPCs, apply+destroy against real sandbox) | ❌ Discovery not started | — | ❌ | Phase 2C — Terraform grounding done, Discovery pending |
| ELB | ✅ real-PDI verified (`terraform/main.tf`, `huaweicloud_elb_loadbalancer` + listener + pool + member, apply+destroy against real sandbox, ECS instance registered as backend) | ❌ Discovery not started | ❌ | ❌ | Phase 3 — Terraform grounding done, Discovery pending |
| RDS | ✅ real-PDI verified (`terraform/main.tf`, `huaweicloud_rds_instance`, single-node MySQL 8.0, apply+destroy against real sandbox) | ❌ Discovery not started | ❌ | ❌ | Phase 3 — Terraform grounding done, Discovery pending |
| OBS (bucket) | ✅ real-PDI verified (`terraform/main.tf`, `huaweicloud_obs_bucket`, apply+destroy against real sandbox) | ❌ (buckets only when built — no per-Object discovery, ever) | ❌ | ❌ | Phase 3 — Terraform grounding done, Discovery pending |
| CCE (cluster/node/namespace/workload/service/ingress) | ✅ real-PDI verified (`terraform/main.tf`, `huaweicloud_cce_cluster` + `huaweicloud_cce_node_pool`, apply+destroy against real sandbox) | ❌ Discovery not started | ❌ | ❌ | Phase 3 — Terraform grounding done, Discovery pending |
| CCE Pod | ❌ | ❌ (opt-in only, off by default, namespace/label-filtered, excludes kube-system/Jobs/completed Pods, 24h post-termination retirement) | ❌ | ❌ | Phase 4, gated on Phase 3 stability |
| CTS (audit events) | — | — | ❌ | — | Phase 5 |
| Config (config-change events) | — | — | ❌ | — | Phase 5 |

## Account/region governance

| Capability | Status |
|---|---|
| Multi-account model (`HC Cloud Account`) | ✅ table schema defined (Phase 1), wired into ECS discovery/sync via `HcConnectorEcsSync.js` and real-PDI verified (Phase 2A) — see `docs/ACL-SETUP.md`/`docs/REAL-PDI-REPLAY-CHECKLIST.md` |
| Multi-region model (`HC Cloud Region`) | ✅ same as above; schema gained a `project_id` field in Phase 2A (Huawei's project ID is per-region per account) |
| AK/SK auth | ✅ verified (single-account path); ✅ account-scoped property naming (`x_hwc.itom.<account_id>.access_key`) real-PDI verified for the multi-account path (Phase 2A) |
| IAM Agency auth | ❌ interface stub only (`AgencyCredentialProvider`) — needs a real Huawei Organizations account to implement/verify |
| Organizations/OU awareness | 🚧 `HC Cloud Account.ou_path` field exists; no sync of real OU data yet |

## Event pipeline

| Capability | Status |
|---|---|
| Direct webhook (current) | ✅ verified end-to-end against real Cloud Eye alarm traffic (`servicenow/event-management/`) |
| Standard Event Envelope (logic) | 🚧 implemented + unit tested (`lib/eventEnvelope.js`), including a real-data-compatible legacy adapter |
| Standard Event Envelope (production use) | ❌ Phase 5 |
| Integration gateway (FunctionGraph/API Gateway) | ❌ architecture-doc only — needs a real Huawei Cloud FunctionGraph/API Gateway account to build/verify |
| Event dedup by `event_id` | 🚧 pure logic implemented (`isDuplicateEventId`), collision-safe `event_id` construction for the legacy CES adapter (`buildCompositeEventId`), not wired to a real store yet |
| Event payload sanitization/truncation | 🚧 implemented + unit tested (`lib/payloadSanitizer.js` - recursive sensitive-field masking, length capping), not wired to a real ingestion path yet |
| pending_retire → retired resource lifecycle | ✅ pure state machine implemented + unit tested (`lib/resourceLifecycle.js`); wired to real ECS discovery runs via `HcConnectorEcsSync.js`/`lib/syncStatePlanner.js` and real-PDI verified (Phase 2A, HC3) — retirement is structurally gated on a fully-succeeded fetch phase, confirmed to never fire from a failed sync against real infrastructure |
| Composite-key uniqueness (`HC Resource Sync State`, `HC Cloud Region`) | ✅ `unique_together` declared in schema + pure `lib/compositeKey.js` helpers; wired into real upsert-before-insert writes via `HcConnectorEcsSync.js` and real-PDI verified (Phase 2A, HC2 — two consecutive runs produced no duplicates) |

This matrix is updated at the end of every phase.
