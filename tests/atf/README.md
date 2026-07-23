# In-Platform & Integration Test Plan

The Jest suite under `tests/unit/` covers two things without any live
account: pure mapping/resilience math, and (as of the orchestrator tests)
the *full control flow* against a scripted fake HTTP client. What it
structurally **cannot** cover is anything that needs a real network call or
a real ServiceNow runtime — `GlideRecord`, `sn_ws.RESTMessageV2`,
`sn_cmdb.IdentificationEngine` only exist inside an actual instance. That's
what this document is for.

## Why this is a recipe, not an importable Update Set (yet)

A "proper" ATF deliverable would be a `sys_update_xml` Update Set you import
and click "Run". This repo does **not** ship one, on purpose: hand-authoring
that XML (the `sys_atf_test`/`sys_atf_step`/`sys_atf_step_config_*` record
structure, with correct `sys_id` cross-references) without a real instance to
build and export it from is exactly the kind of thing that looks plausible
but silently fails to import or creates malformed records — worse than no
artifact at all, and inconsistent with how this repo treats everything else
(nothing here claims to work against a real system until it's actually been
run against one).

Instead, each test case below gives you the **exact stock ATF step type**
to use (all standard, shipped step types — nothing custom) and the
**literal Server Script body** to paste in (plain ServiceNow JS, same trust
level as the rest of this repo). The one part that legitimately varies by
ServiceNow release is the assertion-reporting API for a "Server Script" step
(`inputs`/`outputs` vs. a return value) — wrap the assertion logic shown here
in whatever your instance's Test Studio expects.

**If you build this against a real instance:** exporting the resulting Update
Set and contributing it back (replacing this recipe with a verified,
importable XML file) is one of the highest-value contributions this project
can get.

## 1. Terraform (Task 1) — sandbox cloud validation

```bash
cd terraform
terraform init
terraform validate
terraform plan \
  -var="region=<your-sandbox-region>" -var="az=<your-sandbox-az>" \
  -var="instance_name=test-vm" -var="image_id=<sandbox-image-id>" \
  -var="admin_pass=<temp-password>"
```
- Run against a **dedicated sandbox/dev project**, never a production Huawei Cloud project. `region`/`az` below are placeholders — Huawei has many regions (e.g. `cn-north-4`, `af-south-1`, ...); use whatever your sandbox project is actually in.
- After a successful `apply` in the sandbox, confirm: VPC/subnet/ECS created with expected tags, then `terraform destroy` to tear down.
- Static checks that don't need cloud credentials: `terraform fmt -check`, `tflint`, `checkov -d terraform/` (policy/security scanning).

### Known gotchas (found via real sandbox testing)

1. **Empty tag values are rejected.** Huawei's ECS API returns `Ecs.0005: tag
   value can not be null` if any tag has an empty-string value. `main.tf`
   handles this for `sn_request_number` via `merge()` (the tag key is
   omitted entirely when the value is `""`) — if you add more optional tags,
   follow the same pattern.

2. **Never change `region` (or `az`/`image_id`) between `plan`/`apply`/`destroy`
   calls against the same local state file.** Resource IDs (VPC, subnet,
   security group, ECS...) are tied to the region they were created in. If
   you switch `TF_VAR_region` mid-flow, Terraform will try to look up
   already-created resource IDs against the *new* region's API and fail with
   a `Resource not found` / `404` error (it's not a real outage — it's asking
   the wrong region for an ID that only exists in the other one). If this
   happens:
   ```bash
   # 1. Temporarily set region back to whatever it was when the resources
   #    were actually created, and destroy them properly first
   export TF_VAR_region="<the-region-the-half-created-resources-are-actually-in>"
   terraform destroy

   # 2. THEN switch to the region you actually meant to use, and re-apply
   #    from a clean state
   export TF_VAR_region="<your-real-sandbox-region>"
   export TF_VAR_az="<matching-az>"
   export TF_VAR_image_id="<an-image-id-that-exists-in-THIS-region>"  # image IDs are per-region!
   terraform apply
   ```
   Image IDs are also region-scoped in Huawei Cloud — an image ID valid in
   `cn-north-4` will not exist in `af-south-1` (or any other region). Always
   look up the image ID in the same region you're deploying to.

## 2. Discovery (Task 2) — ATF test cases

> Scenarios already proven deterministically against a fake HTTP client in
> `tests/unit/huaweiEcsOrchestrator.test.js` (retry-then-succeed, retry
> exhaustion, non-retryable errors) are **not** repeated here — you can't
> reliably force a real Huawei API to return a 503 on demand, so re-testing
> that live adds little. The cases below focus on what only a live account
> and a live instance can actually prove.

> ⚠️ **D1 and D2 below are DEPRECATED and will not run against the current
> `HuaweiECSDiscovery.js`.** They test the password/IAM-token auth path
> (`getIAMToken()`, `x_hwc_itom_token_cache`) that was superseded by AK/SK
> signing early in this project's real-account verification.
> `getIAMToken()` and the token cache table don't exist on the active
> Script Include at all anymore —
> that logic only survives as the documented, unit-tested-but-not-wired-in
> alternative in `servicenow/discovery/lib/iamTokenCache.js` +
> `lib/huaweiEcsOrchestrator.js`, for instances where only a human
> username+password IAM account is available. **D3–D5 below (AK/SK,
> pagination, IRE, live end-to-end) are the current, valid Discovery ATF
> cases.** D1/D2 are kept only as a template for someone re-wiring the
> password-auth path back in; don't run them against a normal AK/SK setup.

### D1 — Cache hit skips re-authentication
| Step | ATF step type | Content |
|---|---|---|
| 1 | Impersonate User | A user with rights to read/write `x_hwc_itom_token_cache` |
| 2 | Server Script (setup) | Seed a valid cached token (script below) |
| 3 | Server Script (action + assert) | Call `getIAMToken()`, assert the cache row's `sys_updated_on` did **not** change and the returned token matches the seeded value |

```javascript
// Step 2 — seed cache
var gr = new GlideRecord('x_hwc_itom_token_cache');
gr.addQuery('cache_key', 'huawei_iam_token');
gr.query();
if (gr.next()) gr.deleteRecord();
gr.initialize();
gr.cache_key = 'huawei_iam_token';
gr.token_value = 'atf-dummy-token';
var future = new GlideDateTime();
future.addSeconds(3600);
gr.expires_at = future;
gr.insert();
```
```javascript
// Step 3 — action + assert
var before = new GlideRecord('x_hwc_itom_token_cache');
before.addQuery('cache_key', 'huawei_iam_token');
before.query();
before.next();
var updatedBefore = before.getValue('sys_updated_on');

var disco = new HuaweiECSDiscovery();
var token = disco.getIAMToken();

var after = new GlideRecord('x_hwc_itom_token_cache');
after.addQuery('cache_key', 'huawei_iam_token');
after.query();
after.next();

var passed = (token === 'atf-dummy-token') && (after.getValue('sys_updated_on') === updatedBefore);
// report `passed` via your instance's Server Script step assertion API
```

### D2 — A corrupted token forces exactly one re-auth
| Step | ATF step type | Content |
|---|---|---|
| 1 | Impersonate User | Same as D1 |
| 2 | Server Script (setup) | Seed the cache with a **garbage** token value but a future `expires_at`, so `isTokenValid` passes but the real API rejects it (401) |
| 3 | Server Script (action + assert) | Call `run()` against your sandbox account, assert: the cache row's `token_value` changed (proof of re-auth) and at least one real CI was reconciled |

```javascript
// Step 2 — seed a token that LOOKS valid locally but IS invalid to Huawei
var gr = new GlideRecord('x_hwc_itom_token_cache');
gr.addQuery('cache_key', 'huawei_iam_token');
gr.query();
if (gr.next()) gr.deleteRecord();
gr.initialize();
gr.cache_key = 'huawei_iam_token';
gr.token_value = 'this-is-not-a-real-iam-token';
var future = new GlideDateTime();
future.addSeconds(3600);
gr.expires_at = future;
gr.insert();
```
```javascript
// Step 3 — action + assert (requires real sandbox IAM/ECS credentials configured)
var before = new GlideRecord('x_hwc_itom_token_cache');
before.addQuery('cache_key', 'huawei_iam_token');
before.query();
before.next();
var staleToken = before.getValue('token_value');

new HuaweiECSDiscovery().run();

var after = new GlideRecord('x_hwc_itom_token_cache');
after.addQuery('cache_key', 'huawei_iam_token');
after.query();
after.next();

var reauthed = after.getValue('token_value') !== staleToken;
var ciCount = new GlideAggregate('cmdb_ci_vm_instance');
ciCount.addQuery('discovery_source', 'Huawei Cloud Custom Discovery');
ciCount.addAggregate('COUNT');
ciCount.query();
ciCount.next();
var passed = reauthed && parseInt(ciCount.getAggregate('COUNT'), 10) > 0;
```

### D3 — Pagination against a real multi-instance sandbox
1. Set `x_hwc.itom.page_limit` to `2` on a sandbox project with 3+ ECS instances.
2. Run `HuaweiECSDiscovery().run()`.
3. Assert (Record Query / Server Script) that the number of `cmdb_ci_vm_instance` records with `discovery_source = Huawei Cloud Custom Discovery` matches the **actual** instance count in the sandbox project — not just `page_limit`.

### D4 — IRE de-dup on repeated runs
1. Server Script: call `HuaweiECSDiscovery().reconcileCIs(fixtureServers)` using the JSON from `servicenow/discovery/fixtures/ecs-list-response.json` twice in a row.
2. Record Query on `cmdb_ci_vm_instance` filtered by `correlation_id = 6dd5387c-5f01-4a37-965d-ceed07394913` — assert **exactly one** record (update path of IRE, not a second insert).

### D5 — Live end-to-end happy path
Run `HuaweiECSDiscovery().run()` against real sandbox credentials with no
corruption/seeding — the simplest possible smoke test that auth, fetch, and
IRE reconciliation all work together against the real APIs.

## 3. HC ITOM Connector — multi-account/region platform (Phase 2A/2B) — ATF test cases

> These cases exercise `HcConnectorEcsSync` (`docs/generated/HcConnectorEcsSync.generated.js`,
> deployed per `servicenow/hc-connector/docs/INSTALL.md`), not
> `HuaweiECSDiscovery.js` directly. They assume Step 1–4 of `INSTALL.md`
> are already done (tables/role/ACLs created, at least one real `HC Cloud
> Account` + `HC Cloud Region` pointing at your sandbox project, AK/SK
> System Properties stored). Table names below use the scope prefix
> `x_2021019_huawei_0_` — adjust if you renamed the scope.

### HC1 — Multi-account isolation (credentials and sync state don't cross accounts)
| Step | ATF step type | Content |
|---|---|---|
| 1 | Server Script (setup) | Create a **second** `HC Cloud Account`/`HC Cloud Region` pair pointing at the same sandbox project but a different `account_id` (e.g. `sandbox-2`), and store a **second** set of System Properties (`x_hwc.itom.sandbox-2.access_key`/`.secret_key`) — can reuse the same real AK/SK values, only the property names need to differ |
| 2 | Server Script (action) | Run `new HcConnectorEcsSync().runAll();` |
| 3 | Server Script (assert) | Every `HC Resource Sync State` row's `cloud_account` reference matches the account whose region it came from — no row from account 1's region is attributed to account 2, and vice versa |

```javascript
// Step 3 — assert no cross-account attribution
var bad = 0;
var sync = new GlideRecord('x_2021019_huawei_0_hc_resource_sync_state');
sync.query();
while (sync.next()) {
    var region = new GlideRecord('x_2021019_huawei_0_hc_cloud_region');
    if (!region.get(sync.getValue('cloud_region'))) { bad++; continue; }
    if (region.getValue('cloud_account') !== sync.getValue('cloud_account')) { bad++; }
}
var passed = (bad === 0);
// report `passed` via your instance's Server Script step assertion API
```

### HC2 — Upsert on repeated runs produces no duplicate CI or Sync State
| Step | ATF step type | Content |
|---|---|---|
| 1 | Server Script (setup) | Record the current count of `HC Resource Sync State` rows and `cmdb_ci_vm_instance` rows for your sandbox account/region |
| 2 | Server Script (action) | Run `new HcConnectorEcsSync().runAll();` **twice in a row** |
| 3 | Server Script (assert) | Row counts for both tables are identical before/after the second run (the first run may add rows if this is the first-ever run; the second run must add zero) |

```javascript
// Step 1 — baseline after warming up with one run
new HcConnectorEcsSync().runAll();

var syncCountBefore = new GlideAggregate('x_2021019_huawei_0_hc_resource_sync_state');
syncCountBefore.addAggregate('COUNT');
syncCountBefore.query();
syncCountBefore.next();
var before = parseInt(syncCountBefore.getAggregate('COUNT'), 10);

// Step 2 — action
new HcConnectorEcsSync().runAll();

// Step 3 — assert
var syncCountAfter = new GlideAggregate('x_2021019_huawei_0_hc_resource_sync_state');
syncCountAfter.addAggregate('COUNT');
syncCountAfter.query();
syncCountAfter.next();
var after = parseInt(syncCountAfter.getAggregate('COUNT'), 10);

var passed = (before === after);
```

### HC3 — Retirement never fires from an incomplete sync
| Step | ATF step type | Content |
|---|---|---|
| 1 | Server Script (setup) | Run `runAll()` once normally so at least one `active` `HC Resource Sync State` row exists, then temporarily set `x_hwc.itom.<account_id>.access_key` to a **garbage value** on one account (forces the fetch phase to throw for that account's regions) |
| 2 | Server Script (action) | Run `new HcConnectorEcsSync().runAll();` again |
| 3 | Server Script (assert) | Every `HC Resource Sync State` row for the broken account's regions is still `status = active` with **unchanged** `consecutive_miss_count` — the retirement/miss-counting pass never ran for them, because the fetch never succeeded |
| 4 | Server Script (cleanup) | Restore the real access key value |

```javascript
// Step 3 — assert no miss-count/retirement movement occurred for the broken account
var region = new GlideRecord('x_2021019_huawei_0_hc_cloud_region');
region.addQuery('cloud_account', brokenAccountSysId); // substitute the account under test
region.query();
var bad = 0;
while (region.next()) {
    var sync = new GlideRecord('x_2021019_huawei_0_hc_resource_sync_state');
    sync.addQuery('cloud_region', region.getUniqueValue());
    sync.query();
    while (sync.next()) {
        if (sync.getValue('status') !== 'active' || parseInt(sync.getValue('consecutive_miss_count'), 10) !== 0) {
            bad++;
        }
    }
    // also confirm the failure was actually recorded, not silently swallowed
    if (!region.getValue('last_error')) { bad++; }
}
var passed = (bad === 0);
```

### HC4 — One account/region failing doesn't block the others
| Step | ATF step type | Content |
|---|---|---|
| 1 | Server Script (setup) | With HC1's second account still configured, break only account 2's credentials (garbage access key), leave account 1 valid |
| 2 | Server Script (action) | Run `new HcConnectorEcsSync().runAll();` |
| 3 | Server Script (assert) | Account 1's `HC Discovery Run` for this pass has `status = success` and produced/refreshed `HC Resource Sync State` rows; account 2's `HC Discovery Run` has `status = error` with `error_message` populated — both accounts got a run record, and account 1's is unaffected by account 2's failure |
| 4 | Server Script (cleanup) | Restore account 2's real credentials |

```javascript
// Step 3 — assert
var run1 = new GlideRecord('x_2021019_huawei_0_hc_discovery_run');
run1.addQuery('cloud_account', account1SysId); // substitute real sys_ids
run1.orderByDesc('sys_created_on');
run1.setLimit(1);
run1.query();
var run1Ok = run1.next() && run1.getValue('status') === 'success';

var run2 = new GlideRecord('x_2021019_huawei_0_hc_discovery_run');
run2.addQuery('cloud_account', account2SysId);
run2.orderByDesc('sys_created_on');
run2.setLimit(1);
run2.query();
var run2Failed = run2.next() && run2.getValue('status') === 'error' && !!run2.getValue('error_message');

var passed = run1Ok && run2Failed;
```

### HC5 — `correlation_id` binding still works through the multi-account path
| Step | ATF step type | Content |
|---|---|---|
| 1 | Server Script (setup) | Run `new HcConnectorEcsSync().runAll();` against a real sandbox account/region so at least one `cmdb_ci_vm_instance` exists with a known `correlation_id` |
| 2 | REST Step / HTTP Request (or run the `curl` from section 4 manually) | POST a CES alarm fixture payload (with `instance_id` matching that CI's `correlation_id`) to the webhook, same as **E1** below |
| 3 | Record Query on `em_event` | Assert `cmdb_ci` is populated and points at the CI that `HcConnectorEcsSync` (not the standalone `HuaweiECSDiscovery`) created/reconciled — proves the multi-account orchestrator writes CIs the existing Event Management binding still recognizes, i.e. no regression from Phase 1's real-account-verified behavior |

This is a regression check, not new binding logic — `HcConnectorEcsSync`
delegates the actual CI reconciliation to the same, unmodified
`reconcileCIs()` in `HuaweiECSDiscovery.js`, so a pass here confirms the
plumbing around it (credential resolution, upsert, run tracking) didn't
change what actually lands in `cmdb_ci_vm_instance.correlation_id`.

### HC6–HC10 — VPC + Subnet discovery (Phase 2B)

> These cases exercise `HcConnectorVpcSync`
> (`docs/generated/HcConnectorVpcSync.generated.js`), the sibling
> orchestrator for VPC/Subnet discovery. They assume `HuaweiVpcDiscovery`
> and `HcConnectorVpcSync` are deployed per `docs/INSTALL.md`'s Phase 2B
> step, and that `terraform apply` has provisioned a real VPC + Subnet in
> your sandbox project. HC1–HC5 above already generically cover
> isolation/idempotency/incomplete-sync/failure-isolation/`correlation_id`
> binding — these five are new invariants or extended regressions specific
> to one run covering two resource types at once, not repeats of HC1–HC5.
> The real CMDB containment chain for this instance: `CI_CLASS_VPC = 'cmdb_ci_network'`
> ("Cloud Network" — **not** `cmdb_ci_vpc`), `CI_CLASS_SUBNET =
> 'cmdb_ci_cloud_subnet'`, plus two shared placeholder levels underneath
> (`cmdb_ci_logical_datacenter`, `cmdb_ci_cloud_service_account`) that
> `HcConnectorVpcSync`/`HuaweiVpcDiscovery.js` create automatically. `lib/
> mapVpcSubnetToIRE.js`/`HuaweiVpcDiscovery.js` already reflect all of
> this. On a different instance, re-run the Step 0 diagnostic in
> `servicenow/hc-connector/docs/REAL-PDI-REPLAY-CHECKLIST.md` rather than
> trusting these blindly — substitute the `cmdb_ci`/`cmdb_rel_ci` queries
> below with the real class names if they differ.

#### HC6 — Subnet correctly relates to its parent VPC's CI
| Step | ATF step type | Content |
|---|---|---|
| 1 | Server Script (action) | Run `new HcConnectorVpcSync().runAll();` against the real sandbox VPC/Subnet |
| 2 | Server Script (assert) | A `cmdb_rel_ci` row exists whose parent CI has `correlation_id` = the real VPC's id, child CI has `correlation_id` = the real Subnet's id, and `type` matches the confirmed `CONTAINMENT_RELATION_TYPE` |

```javascript
// Step 2 — assert the containment relation exists
var vpcCi = new GlideRecord('cmdb_ci_network');
vpcCi.addQuery('correlation_id', realVpcId); // substitute the real sandbox VPC id
vpcCi.query();
var subnetCi = new GlideRecord('cmdb_ci_cloud_subnet');
subnetCi.addQuery('correlation_id', realSubnetId); // substitute the real sandbox subnet id
subnetCi.query();
var passed = false;
if (vpcCi.next() && subnetCi.next()) {
    var rel = new GlideRecord('cmdb_rel_ci');
    rel.addQuery('parent', vpcCi.getUniqueValue());
    rel.addQuery('child', subnetCi.getUniqueValue());
    rel.query();
    passed = rel.next();
}
```

#### HC7 — VPC and Subnet sync-state rows coexist with no cross-type leakage
| Step | ATF step type | Content |
|---|---|---|
| 1 | Server Script (action) | Run `new HcConnectorVpcSync().runAll();` |
| 2 | Server Script (assert) | Every `HC Resource Sync State` row with `resource_type='vpc'` has a `native_key` matching a real VPC id, never a subnet id, and vice versa for `resource_type='subnet'` |

```javascript
// Step 2 — assert no cross-type leakage
var bad = 0;
var vpcRows = new GlideRecord('x_2021019_huawei_0_hc_resource_sync_state');
vpcRows.addQuery('resource_type', 'vpc');
vpcRows.query();
while (vpcRows.next()) {
    if (vpcRows.getValue('native_key') === realSubnetId) bad++; // substitute the real sandbox subnet id
}
var subnetRows = new GlideRecord('x_2021019_huawei_0_hc_resource_sync_state');
subnetRows.addQuery('resource_type', 'subnet');
subnetRows.query();
while (subnetRows.next()) {
    if (subnetRows.getValue('native_key') === realVpcId) bad++; // substitute the real sandbox vpc id
}
var passed = (bad === 0);
```

#### HC8 — VPC and Subnet lifecycle transitions are independent per resource type
| Step | ATF step type | Content |
|---|---|---|
| 1 | Server Script (setup) | Run `runAll()` once so real rows exist for both types, then insert a **fake** `HC Resource Sync State` row with `resource_type='vpc'` and a `native_key` guaranteed absent from the real fetch (e.g. `fake-vpc-hc8-test`) |
| 2 | Server Script (action) | Run `new HcConnectorVpcSync().runAll();` again |
| 3 | Server Script (assert) | The fake `vpc` row moved toward `pending_retire`/`retired`, but every real `subnet` row's `status`/`consecutive_miss_count` is unchanged — a miss on one resource type never touches the other's rows |
| 4 | Server Script (cleanup) | Delete the fake row |

```javascript
// Step 3 — assert only the fake vpc row moved, no real subnet row was touched
var fake = new GlideRecord('x_2021019_huawei_0_hc_resource_sync_state');
fake.addQuery('native_key', 'fake-vpc-hc8-test');
fake.query();
var fakeMoved = fake.next() && fake.getValue('status') !== 'active';

var subnetBad = 0;
var subnetRows = new GlideRecord('x_2021019_huawei_0_hc_resource_sync_state');
subnetRows.addQuery('resource_type', 'subnet');
subnetRows.query();
while (subnetRows.next()) {
    if (subnetRows.getValue('status') !== 'active' || parseInt(subnetRows.getValue('consecutive_miss_count'), 10) !== 0) subnetBad++;
}
var passed = fakeMoved && (subnetBad === 0);
```

No dedicated "block VPC retirement while subnets are active" logic is
needed or tested here — Huawei's own API already refuses to delete a VPC
with live subnets, so a VPC legitimately disappearing from a fetch already
implies its subnets are gone too. What's actually fragile, and what this
case tests, is the much simpler thing: the per-resource-type lifecycle loop
(`planSyncStateUpdates()` called twice per account/region) not accidentally
cross-contaminating state between the two types.

#### HC9 — Repeated runs produce no duplicate VPC/Subnet CIs or Sync State rows
| Step | ATF step type | Content |
|---|---|---|
| 1 | Server Script (setup) | Record current `HC Resource Sync State` row counts (both `resource_type` values) and CI counts for the chosen VPC/Subnet classes |
| 2 | Server Script (action) | Run `new HcConnectorVpcSync().runAll();` **twice in a row** |
| 3 | Server Script (assert) | Row counts for both resource types and both CI classes are identical before/after the second run |

Same shape as HC2, but exercising the combined single-`createOrUpdateCI`-
call-covering-two-resource-types path HC2 never touched (ECS only ever
reconciled one resource type per call).

#### HC10 — One account/region failing leaves both resource types' run/sync-state rows untouched
| Step | ATF step type | Content |
|---|---|---|
| 1 | Server Script (setup) | Temporarily break the region's credentials or `project_id` |
| 2 | Server Script (action) | Run `new HcConnectorVpcSync().runAll();` |
| 3 | Server Script (assert) | **Both** the `vpc` and `subnet` `HC Discovery Run` rows for this pass show `state='failed'` with a populated `error_summary`, and **both** resource types' existing `HC Resource Sync State` rows are untouched |
| 4 | Server Script (cleanup) | Restore the real credentials/`project_id` |

Same shape as HC3/HC4, but confirms the fetch-failure short-circuit in
`_runForAccountRegion()` aborts both run rows together (they share one
`trace_id`), not just one — HC3 only ever had a single resource type per
run to verify.

## 4. Event Management (Task 3) — webhook + Event Rule

**Smoke test the webhook endpoint with curl** (no ATF needed for this part — a
plain HTTP client is sufficient and simpler):
```bash
curl -i -X POST "https://<instance>.service-now.com/api/x_hwc/itom/webhook/ces_alarm" \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Secret: <value of x_hwc.itom.webhook_secret>" \
  -u "<integration-user>:<password>" \
  -d @servicenow/event-management/fixtures/ces-alarm-payload.json
```
Expect `202 Accepted` and a `sys_id` in the response body. Repeat with a
missing/incorrect `X-Webhook-Secret` header and expect `401`.

### E1 — Alarm → em_event → CI binding
| Step | ATF step type | Content |
|---|---|---|
| 1 | Server Script (setup) | Run Discovery test **D4** first (or otherwise ensure a CI exists with `correlation_id = 6dd5387c-5f01-4a37-965d-ceed07394913`) |
| 2 | REST Step / HTTP Request (or just run the `curl` above manually, then continue) | POST the fixture alarm payload to the webhook |
| 3 | Record Query on `em_event` | Assert `source = Huawei Cloud Eye`, `severity = 2`, `resource`/`node` match the fixture's `instance_id`/`resource_name`, and `cmdb_ci` is populated and points at the CI from step 1 |

### E2 — Missing CI logs a warning instead of silently binding wrong
1. Ensure **no** CI exists with the fixture's `correlation_id` (clean CMDB state or a different sandbox instance).
2. POST the fixture alarm payload.
3. Assert the resulting `em_event.cmdb_ci` is empty and the instance's system log contains the `[HuaweiCESTransform] No CI match for instance_id ...` warning.

## Status
✅ Phase 2A's `HcConnectorEcsSync` cases: HC2/HC3/HC4 confirmed against a
real ServiceNow PDI + real Huawei Cloud sandbox account; HC1/HC5 accepted
on lighter evidence.

✅ Phase 2B's `HcConnectorVpcSync` cases: HC6–HC10 all confirmed against a
real ServiceNow PDI + real Huawei Cloud sandbox account (real VPC/Subnet
CIs and containment relation; idempotent on a second run; no cross-type
leakage; independent per-type lifecycle transitions; failure isolation
across both resource types).
