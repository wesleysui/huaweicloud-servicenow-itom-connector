# Real-PDI Replay Checklist (Phase 2A/2B/Setup Wizard)

This is not new design work — it is a literal record of every step actually
performed live against the real ServiceNow PDI during the Phase 2A
real-PDI verification pass, in the order that worked, including the fixes
for problems only discovered by doing it for real (`ACL-SETUP.md`'s
original Step 2/3 undersold how much manual UI friction there actually is).

**When to use this**: only if the PDI needs to be rebuilt from scratch, or
you're standing up a second instance. If the PDI just comes back online
normally after being "Offline"/hibernating, none of this is needed — the
tables, role, ACLs, records, and Script Include are already there. Use the
verification script in Step 8 to confirm state instead of redoing anything.

## Prerequisites

- App scope `x_2021019_huawei_0`, display name "HC ITOM Connector".
- Your real Huawei Cloud sandbox AK/SK (the same credentials already
  validated in `servicenow/discovery/` and `terraform/`).
- Logged in as a full admin.

## Step 0 — App rename (skip if already done)

System Definition > Applications > open the app record > set **Name** to
"HC ITOM Connector". Scope stays `x_2021019_huawei_0`.

## Step 1 — Create the 6 tables in Studio

Create in this order (references must point at an existing table):
`hc_cloud_account` → `hc_cloud_region` → `hc_discovery_run` →
`hc_resource_sync_state` → `hc_event_ingestion_record` → `hc_connector_config`.

For each: Studio > File > New File > Table > **Name** = short name above
(Studio auto-prefixes to `x_2021019_huawei_0_<name>`) > **Label** = the
table's display name below > add every field exactly as listed.

Two known UI dead ends, already accepted as deliberate simplifications —
don't waste time hunting for them again:
- **No reachable "Unique" checkbox** anywhere (Studio field panel,
  "Advanced view," or `sys_dictionary_list.do` directly) for `account_id`,
  `event_id`, `key`. Uniqueness for these is enforced at the application
  layer only (same pattern as composite keys below).
- **Integer field default "0"** is unreachable via UI for `success_count`/
  `fail_count`. Harmless — `lib/discoveryRunTracker.js` always sets both
  explicitly in code, never relies on the DB default.

### HC Cloud Account (`x_2021019_huawei_0_hc_cloud_account`)

| Field | Type | Mandatory | Unique | Default / Choices |
|---|---|---|---|---|
| `account_id` (Account ID) | String (80) | Yes | Yes (skip — see above) | - |
| `name` (Name) | String (100) | Yes | No | - |
| `ou_path` (Organizations OU Path) | String (255) | No | No | - |
| `auth_mode` (Auth Mode) | Choice | Yes | No | ak_sk = AK/SK (compat mode); agency = IAM Agency (default: ak_sk) |
| `default_region` (Default Region) | String (40) | No | No | - |
| `agency_name` (IAM Agency Name) | String (100) | No | No | - |
| `external_id` (External ID) | String (100) | No | No | - |
| `active` (Active) | True/False | No | No | true |

### HC Cloud Region (`x_2021019_huawei_0_hc_cloud_region`)

| Field | Type | Mandatory | Unique | Default / Choices |
|---|---|---|---|---|
| `account` (Cloud Account) | Reference -> `x_2021019_huawei_0_hc_cloud_account` | Yes | No | - |
| `region` (Region Code) | String (40) | Yes | No | - |
| `project_id` (Huawei Cloud Project ID) | String (80) | Yes | No | - |
| `sync_enabled` (Sync Enabled) | True/False | No | No | true |
| `last_success` (Last Successful Sync) | Date/Time | No | No | - |
| `last_error` (Last Error) | String (4000) | No | No | - |
| `active` (Active) | True/False | No | No | true |

Composite uniqueness `(account, region)` — app-layer only, via
`lib/compositeKey.js`. Nothing to configure in Studio.

### HC Discovery Run (`x_2021019_huawei_0_hc_discovery_run`)

| Field | Type | Mandatory | Unique | Default / Choices |
|---|---|---|---|---|
| `account` (Cloud Account) | Reference -> `x_2021019_huawei_0_hc_cloud_account` | Yes | No | - |
| `region` (Cloud Region) | Reference -> `x_2021019_huawei_0_hc_cloud_region` | Yes | No | - |
| `resource_type` (Resource Type) | String (60) | Yes | No | - |
| `state` (State) | Choice | Yes | No | running = Running; completed = Completed; failed = Failed (default: running) |
| `started` (Started) | Date/Time | Yes | No | - |
| `ended` (Ended) | Date/Time | No | No | - |
| `success_count` (Success Count) | Integer | No | No | 0 (unreachable in UI, skip) |
| `fail_count` (Fail Count) | Integer | No | No | 0 (unreachable in UI, skip) |
| `error_summary` (Error Summary) | String (4000) | No | No | - |
| `correlation_id` (Correlation ID) | String (100) | No | No | - |
| `trace_id` (Trace ID) | String (100) | No | No | - |
| `dry_run` (Dry Run) | True/False | No | No | false |

### HC Resource Sync State (`x_2021019_huawei_0_hc_resource_sync_state`)

| Field | Type | Mandatory | Unique | Default / Choices |
|---|---|---|---|---|
| `account` (Cloud Account) | Reference -> `x_2021019_huawei_0_hc_cloud_account` | Yes | No | - |
| `region` (Cloud Region) | Reference -> `x_2021019_huawei_0_hc_cloud_region` | Yes | No | - |
| `resource_type` (Resource Type) | String (60) | Yes | No | - |
| `native_key` (Source Native Key) | String (255) | Yes | No | - |
| `ci` (CI) | Reference -> `cmdb_ci` | No | No | - |
| `last_seen` (Last Seen) | Date/Time | Yes | No | - |
| `consecutive_miss_count` (Consecutive Miss Count) | Integer | No | No | 0 |
| `status` (Status) | Choice | Yes | No | active = Active; pending_retire = Pending Retire; retired = Retired (default: active) |

Composite uniqueness `(account, region, resource_type, native_key)` —
app-layer only, via `lib/compositeKey.js`.

### HC Event Ingestion Record (`x_2021019_huawei_0_hc_event_ingestion_record`)

| Field | Type | Mandatory | Unique | Default / Choices |
|---|---|---|---|---|
| `event_id` (Event ID) | String (100) | Yes | Yes (skip — see above) | - |
| `source` (Source) | Choice | Yes | No | cloud_eye = Cloud Eye; cts = CTS; config = Config; smn = SMN (legacy CES passthrough) |
| `event_type` (Event Type) | String (100) | No | No | - |
| `occurred_at` (Occurred At) | Date/Time | No | No | - |
| `dedup_status` (Dedup Status) | Choice | Yes | No | new = New; duplicate = Duplicate (default: new) |
| `raw_payload` (Raw Payload (sanitized/truncated)) | String (4000) | No | No | - |
| `processing_result` (Processing Result) | Choice | Yes | No | accepted = Accepted; rejected = Rejected; error = Error (default: accepted) |
| `correlation_id` (Correlation ID) | String (100) | No | No | - |

Do not skip `raw_payload` — this was missed once already and had to be
added back after the fact.

### HC Connector Config (`x_2021019_huawei_0_hc_connector_config`)

| Field | Type | Mandatory | Unique | Default / Choices |
|---|---|---|---|---|
| `key` (Key) | String (100) | Yes | Yes (skip — see above) | - |
| `value` (Value) | String (4000) | No | No | - |
| `description` (Description) | String (500) | No | No | - |
| `category` (Category) | Choice | Yes | No | lifecycle = Lifecycle; gateway = Gateway; discovery = Discovery; general = General (default: general) |

## Step 2 — Elevate Roles, then create + self-assign `hc_connector_admin`

1. **Elevate Roles first** — click your avatar (top right) > **Elevate
   Roles** > check `security_admin` > OK. Without this, `sys_security_acl`
   has no "New" button at all, even for a full admin.
2. Create the role: `All` > `User Administration > Roles` > New. **Name**:
   `x_2021019_huawei_0.hc_connector_admin` (Studio prefixes scoped roles
   the same way it prefixes tables — you can also do this from inside
   Studio via File > New File > Role).
3. **Do not try to assign the role via the user record's Roles related
   list search widget** — it reliably fails to find newly created scoped
   roles by name even though the role genuinely exists (confirmed via
   script both times this was hit). Instead, find your user's sys_id
   (`sys_user_list.do`, filter `user_name=admin`), find the role's sys_id
   (`sys_user_role_list.do` won't help here — use `sys_user_role.do` /
   query `sys_user_role` table by name), then run this in Background
   Scripts (your own scope is fine, this table accepts scoped writes):

```javascript
// Link hc_connector_admin role to your user directly — bypasses the
// broken role-search widget in the Roles related list.
var roleGr = new GlideRecord('sys_user_role');
roleGr.addQuery('name', 'x_2021019_huawei_0.hc_connector_admin');
roleGr.query();
if (!roleGr.next()) {
    gs.info('[ERROR] role not found — create it first (Step 2.2)');
} else {
    var linkGr = new GlideRecord('sys_user_has_role');
    linkGr.addQuery('user', gs.getUserID());
    linkGr.addQuery('role', roleGr.getUniqueValue());
    linkGr.query();
    if (linkGr.next()) {
        gs.info('[ALREADY LINKED] sys_id=' + linkGr.getUniqueValue());
    } else {
        var newLink = new GlideRecord('sys_user_has_role');
        newLink.initialize();
        newLink.user = gs.getUserID();
        newLink.role = roleGr.getUniqueValue();
        var linkSysId = newLink.insert();
        gs.info('[LINKED] new sys_user_has_role sys_id=' + linkSysId);
    }
}
```

## Step 3 — Create the 6 dedicated ACLs (corrected, idempotent script)

**Background**: Studio auto-generates 2 default ACLs per (table,
operation) on every custom table — one gated to the scope's built-in
`.admin` role, one gated to `.user`. The first attempt at scripting this
step queried ACLs by `(type, name, operation)` alone, which matched these
pre-existing Studio defaults instead of creating new records, and ended up
merging `hc_connector_admin` onto the *default* ACLs rather than creating
dedicated ones — so the restriction silently didn't work (the built-in
`.user` role could still write). The script below fixes that by only
treating an ACL as "the dedicated one" if `hc_connector_admin` is its
*only* required role, and by explicitly deactivating the Studio-default
`.user`-gated ACL (not deleting — reversible) instead of writing to it.

Run this **in Global scope** (switch Background Scripts' Application
Scope dropdown to Global first — `sys_security_acl_role` writes are
refused cross-scope even for a scoped-app table permission). Requires
Elevate Roles from Step 2.1 still active for this session.

```javascript
// Idempotent: creates hc_connector_admin-only write/create ACLs on the
// 3 configuration tables, deactivates Studio's default .user-gated ACL
// for the same (table, operation), and leaves the .admin-gated default
// alone. Safe to re-run.
var SCOPE = 'x_2021019_huawei_0';
var ADMIN_ROLE_NAME = SCOPE + '.hc_connector_admin';
var USER_ROLE_NAME = SCOPE + '.user';
var TABLES = [
    SCOPE + '_hc_cloud_account',
    SCOPE + '_hc_cloud_region',
    SCOPE + '_hc_connector_config'
];
var OPERATIONS = ['write', 'create'];

var adminRoleGr = new GlideRecord('sys_user_role');
adminRoleGr.addQuery('name', ADMIN_ROLE_NAME);
adminRoleGr.query();
if (!adminRoleGr.next()) {
    gs.info('[FATAL] role ' + ADMIN_ROLE_NAME + ' not found — run Step 2 first');
} else {
    var adminRoleSysId = adminRoleGr.getUniqueValue();

    var userRoleGr = new GlideRecord('sys_user_role');
    userRoleGr.addQuery('name', USER_ROLE_NAME);
    userRoleGr.query();
    var userRoleSysId = userRoleGr.next() ? userRoleGr.getUniqueValue() : null;

    for (var t = 0; t < TABLES.length; t++) {
        for (var o = 0; o < OPERATIONS.length; o++) {
            var table = TABLES[t];
            var op = OPERATIONS[o];

            var existingAcls = new GlideRecord('sys_security_acl');
            existingAcls.addQuery('name', table);
            existingAcls.addQuery('type', 'record');
            existingAcls.addQuery('operation', op);
            existingAcls.query();

            var dedicatedFound = false;
            while (existingAcls.next()) {
                var aclSysId = existingAcls.getUniqueValue();
                var roleLinks = new GlideRecord('sys_security_acl_role');
                roleLinks.addQuery('sys_security_acl', aclSysId);
                roleLinks.query();
                var roleNames = [];
                while (roleLinks.next()) {
                    roleNames.push(roleLinks.sys_user_role.name.toString());
                }
                var isDedicated = roleNames.length === 1 && roleNames[0] === ADMIN_ROLE_NAME;
                var isUserDefault = roleNames.length === 1 && roleNames[0] === USER_ROLE_NAME;

                if (isDedicated) {
                    dedicatedFound = true;
                    gs.info('[OK] dedicated ACL already exists: ' + table + '/' + op + ' sys_id=' + aclSysId);
                } else if (isUserDefault && existingAcls.active == true) {
                    existingAcls.active = false;
                    existingAcls.update();
                    gs.info('[DEACTIVATED] Studio default user-gated ACL: ' + table + '/' + op + ' sys_id=' + aclSysId);
                }
            }

            if (!dedicatedFound) {
                var newAcl = new GlideRecord('sys_security_acl');
                newAcl.initialize();
                newAcl.name = table;
                newAcl.type = 'record';
                newAcl.operation = op;
                newAcl.active = true;
                newAcl.description = 'HC ITOM Connector: restrict ' + op + ' on ' + table + ' to hc_connector_admin';
                var newAclSysId = newAcl.insert();

                var newLink = new GlideRecord('sys_security_acl_role');
                newLink.initialize();
                newLink.sys_security_acl = newAclSysId;
                newLink.sys_user_role = adminRoleSysId;
                newLink.insert();

                gs.info('[CREATED DEDICATED] ' + table + '/' + op + ' sys_id=' + newAclSysId);
            }
        }
    }
    gs.info('===== DONE =====');
}
```

## Step 4 — Verify exactly 6 clean ACLs, no duplicates/dangling links

Run in either scope (read-only):

```javascript
var SCOPE = 'x_2021019_huawei_0';
var roleGr = new GlideRecord('sys_user_role');
roleGr.addQuery('name', SCOPE + '.hc_connector_admin');
roleGr.query();
if (!roleGr.next()) {
    gs.info('[ERROR] role not found');
} else {
    var links = new GlideRecord('sys_security_acl_role');
    links.addQuery('sys_user_role', roleGr.getUniqueValue());
    links.query();
    var count = 0;
    while (links.next()) {
        count++;
        var aclGr = links.sys_security_acl.getRefRecord();
        if (!aclGr.isValidRecord()) {
            gs.info('[DANGLING LINK] sys_id=' + links.getUniqueValue());
        } else {
            gs.info('acl name=' + aclGr.name + ' | operation=' + aclGr.operation + ' | active=' + aclGr.active + ' | acl_sys_id=' + aclGr.getUniqueValue());
        }
    }
    gs.info('total ACLs linked to hc_connector_admin: ' + count + ' (expect 6)');
}
```

Expect exactly 6 lines, no `[DANGLING LINK]`, no repeated `name`+`operation`
pairs. If a count of 7 shows up with one table's `write` operation
duplicated, check whether that duplicate is Studio's **admin**-gated
default (not user-gated) accidentally merged with `hc_connector_admin` —
this happened once, on `hc_connector_config`, because that table's
admin-gated default happened to be the first ACL returned by the existence
query. Fix: find the extra `sys_security_acl_role` row on the admin-gated
default ACL and delete just that link row (leave the ACL itself alone —
admin role holders already have full access regardless, so this is
cosmetic, not a security hole).

## Step 5 — Create real `HC Cloud Account` and `HC Cloud Region` records

Manual, via the table's own list view (`x_2021019_huawei_0_hc_cloud_account_list.do`):

1. **HC Cloud Account**: `account_id` = your chosen account identifier,
   `name` = a display name, `auth_mode` = `AK/SK (compat mode)`, `active` =
   true.
2. **HC Cloud Region**: `account` = the record from step 1, `region` =
   your real Huawei Cloud sandbox region code, `project_id` = that
   region's real project ID (same sandbox project already verified via
   `terraform/` and `servicenow/discovery/`), `sync_enabled` = true,
   `active` = true.

**Do not hand-type `project_id` from memory or a console screenshot without
cross-checking it** — hit this for real: a manually-typed `project_id` was
wrong (`fa45463b...` instead of the real `eecc7ec8...`), and because the
online Script Include was stale at the time (see Step 7's warning below),
every fetch kept "succeeding" anyway by silently falling back to the old
single-account System Property instead of the wrong value we'd just set -
completely masking the mistake for several test cycles. The bug only
surfaced once the Script Include was up to date and genuinely started
using `HC Cloud Region.project_id`, producing a real
`tenantId in token is not the same with in URL` (`Common.0018`) error.
**If a working single-account setup already exists** (from
`servicenow/discovery/`'s earlier verification), pull the known-good value
from there instead of retyping it — it's already proven correct:

```javascript
gs.info('known-good project_id: "' + gs.getProperty('x_2021019_huawei_0.x_hwc.itom.project_id') + '"');
gs.info('known-good region: "' + gs.getProperty('x_2021019_huawei_0.x_hwc.itom.region') + '"');
```

If no prior single-account setup exists, get `project_id` directly from
Huawei Cloud Console (My Credentials > API Credentials > Projects, matching
the region), never from memory.

**Verify the checkboxes actually saved as true** — hit this for real once
already: the dictionary-level default of `true` on `active`/`sync_enabled`
does not guarantee the checkbox renders checked on the New-record form, and
a plain unedited form submit silently saved both as `false`. Confirm with:

```javascript
var gr = new GlideRecord('x_2021019_huawei_0_hc_cloud_region');
gr.query();
while (gr.next()) {
    gs.info('region=' + gr.region + ' | active(raw)=' + gr.getValue('active') +
        ' | sync_enabled(raw)=' + gr.getValue('sync_enabled'));
}
```

Both must print `1`/`true`, not `0`/`false` — `HcConnectorEcsSync._getActiveRegions()`
(`service-graph/HcConnectorEcsSync.js:346-361`) filters on both, so a region
that fails this silently makes `runAll()` a no-op for that account (it still
logs "run complete" with zero rows written — this does not throw or warn).

## Step 6 — System Properties for AK/SK

**Property names must carry the full app scope prefix.** Every System
Property read by this connector's code goes through
`gs.getProperty(gs.getCurrentScopeName() + '.' + name)` (same convention
already documented in `servicenow/discovery/README.md`'s Step 2:
"`x_hwc.itom.region` is actually stored as `x_2021019_huawei_0.x_hwc.itom.region`").
Creating a property directly via `sys_properties_list.do` does **not**
auto-add this prefix the way Studio does for scoped artifacts — you must
type it yourself, or the connector's credential lookup fails with
`AK/SK not configured` even though the property visibly exists.

Create 2 System Properties (`sys_properties_list.do` > New), reusing your
already-validated real AK/SK — do not generate new ones:

- `x_2021019_huawei_0.x_hwc.itom.<account_id>.access_key` — type String, value = real access key
- `x_2021019_huawei_0.x_hwc.itom.<account_id>.secret_key` — type Password (2 way encrypted), value = real secret key

Replace `<account_id>` with the exact `account_id` value from Step 5.1.

## Step 7 — Create the `HcConnectorEcsSync` Script Include, and also verify `HuaweiECSDiscovery` is current

In Studio: File > New File > Script Include > **Name**:
`HcConnectorEcsSync`. Paste the full contents of
`docs/generated/HcConnectorEcsSync.generated.js` (regenerate first via
`node servicenow/hc-connector/scripts/build-script-include.js` if the repo
has moved on since this was last generated). Save.

If you hit a `syntax error (null.null.script; line N)` on paste that
doesn't match the actual script length, it's almost certainly non-ASCII
character corruption from clipboard/IME — re-copy from a version of the
file with no non-English comments and try again (this bit the project
before, in Studio Script Include comments, and again this session in
Background Scripts). If the paste is silently *incomplete* (right ending,
wrong length, some function names missing from the middle), confirm with:

```javascript
var gr = new GlideRecord('sys_script_include');
gr.addQuery('name', 'HcConnectorEcsSync');
gr.query();
if (gr.next()) {
    var script = gr.getValue('script');
    gs.info('script length: ' + script.length + ' chars (compare to wc -c on the .generated.js file)');
    gs.info('contains "function startRun(": ' + (script.indexOf('function startRun(') !== -1));
}
```

**Also confirm `HuaweiECSDiscovery` (the Script Include from the original
single-account Discovery phase, which `HcConnectorEcsSync` calls into) is
not stale.** This bit the project for real: `HuaweiECSDiscovery.js` gained
an *optional* `config` parameter (`region`/`projectId`/`accessKey`/
`secretKey`) as part of Phase 2A (see `initialize()` in the source), but if
the version actually deployed on the instance predates that change, it
silently ignores everything `HcConnectorEcsSync` passes in and falls back
to the old single-account System Properties for *everything* — region,
project ID, and credentials alike. This does not throw or warn; it just
quietly keeps using the old single-account config, which made several
account-scoped config mistakes (a wrong `project_id`, a deliberately broken
AK/SK) look like they had no effect at all, because the account-scoped
values were never actually being read. Before trusting any HC3/HC4-style
failure-injection test, re-paste the current
`servicenow/discovery/HuaweiECSDiscovery.js` into the deployed
`HuaweiECSDiscovery` Script Include to be sure it's current.

## Step 8 — Run and verify

```javascript
new HcConnectorEcsSync().runAll();
```

Then run the verification script from `docs/generated/tables/` cross-check
(query `x_2021019_huawei_0_hc_discovery_run` most-recent rows,
`x_2021019_huawei_0_hc_resource_sync_state` all rows, and
`cmdb_ci_vm_instance` where `object_id` is not null) to confirm the run
actually fetched real ECS instances and reconciled CIs — a clean "run
complete" log line alone only proves it didn't crash, not that it did the
right thing.

---

# Phase 2B addendum — VPC + Subnet discovery

Everything above is Phase 2A. This section covers deploying and verifying
`HuaweiVpcDiscovery`/`HcConnectorVpcSync` on top of an already-working
Phase 2A setup. No new tables, roles, or ACLs — VPC/Subnet reuse the same 6
tables and `hc_connector_admin` role as-is.

## Prerequisite: real VPC + Subnet in your sandbox

`terraform apply` in `terraform/` against your real sandbox project — this
already provisions a real `huaweicloud_vpc` + `huaweicloud_vpc_subnet`, no
new Terraform work needed. Note the real VPC id and Subnet id from the
apply output (or the Huawei Cloud Console) - you'll need them for
verification.

## Step 0 — CI class / relation type / pagination diagnostic (do this FIRST)

`lib/mapVpcSubnetToIRE.js` (mirrored in `HuaweiVpcDiscovery.js`) ships with
**placeholder** values for `CI_CLASS_VPC` (`cmdb_ci_network`),
`CI_CLASS_SUBNET` (`cmdb_ci_ip_network`), and `CONTAINMENT_RELATION_TYPE`
(`"Contains::Contained by"`) — none of these have been checked against a
real class hierarchy, unlike ECS's `cmdb_ci_vm_instance`, which was only
confirmed after real trial-and-error (`METADATA_RULE_MISSING` on the first
attempted class, `MISSING_DEPENDENCY` without a containment relation - see
`servicenow/discovery/README.md`'s gotchas). Run this before pasting
either new Script Include:

```javascript
// Step 0a - enumerate candidate CI classes
gs.info('===== Candidate CI classes =====');
var gr = new GlideRecord('sys_db_object');
gr.addQuery('name', 'STARTSWITH', 'cmdb_ci_');
gr.query();
while (gr.next()) {
    var n = gr.getValue('name');
    if (n.indexOf('network') !== -1 || n.indexOf('vpc') !== -1 || n.indexOf('subnet') !== -1 || n.indexOf('ip_') !== -1) {
        gs.info(n + ' | label=' + gr.getValue('label') + ' | super_class=' + gr.getValue('super_class'));
    }
}

// Step 0b - check whether each candidate has a configured Identification Rule
gs.info('===== Identification rules for candidates =====');
var idGr = new GlideRecord('cmdb_identifier');
idGr.query();
while (idGr.next()) {
    var table = idGr.getValue('table');
    if (table.indexOf('network') !== -1 || table.indexOf('vpc') !== -1 || table.indexOf('subnet') !== -1 || table.indexOf('ip_') !== -1) {
        gs.info('identifier rule exists for ' + table);
    }
}

// Step 0c - confirm a real OOTB containment relation type exists
gs.info('===== Candidate containment relation types =====');
var relGr = new GlideRecord('cmdb_rel_type');
relGr.addQuery('name', 'CONTAINS', 'Contain');
relGr.query();
while (relGr.next()) {
    gs.info(relGr.getValue('name') + ' | parent_descriptor=' + relGr.getValue('parent_descriptor') + ' | child_descriptor=' + relGr.getValue('child_descriptor'));
}
```

Only after this returns real evidence should `CI_CLASS_VPC`/
`CI_CLASS_SUBNET`/`CONTAINMENT_RELATION_TYPE` be finalized in both
`servicenow/discovery/lib/mapVpcSubnetToIRE.js` and its
`HuaweiVpcDiscovery.js` mirror (update both together, then re-run
`node servicenow/hc-connector/scripts/check-mirror-drift.js` locally - it
only checks the SHA-256 constants, not these, so this is a manual
"update both" reminder, not something the drift-check catches). If the
chosen class turns out to need a mandatory containment relation the same
way `cmdb_ci_vm_instance` did, only fix that forward once a real
`MISSING_DEPENDENCY` error confirms it - don't add a placeholder
relation preemptively.

**Already run to completion, on this project's real PDI — final, confirmed
values below (`hasError:false`, all items/relations `operation:INSERT`),
but re-run Step 0 on a different instance rather than trusting these
blindly.** The real containment chain turned out to be 4 levels deep, not
1. Final values:

- `CI_CLASS_VPC = 'cmdb_ci_network'` ("Cloud Network") — **not**
  `cmdb_ci_vpc` ("Virtual Private Cloud"), which exists and does work as a
  standalone class but is NOT what `cmdb_ci_cloud_subnet`'s OOTB
  containment rule expects as a parent (no inheritance relationship
  between the two).
- `CI_CLASS_SUBNET = 'cmdb_ci_cloud_subnet'` ("Cloud Subnet") — correct on
  the first guess.
- `CI_CLASS_LOGICAL_DATACENTER = 'cmdb_ci_logical_datacenter'` — a third,
  shared-per-run placeholder that `cmdb_ci_network` requires as its own
  parent via `Hosted on::Hosts`. Already has a working Dependent
  Identification Rule out of the box (`Object ID` or `Region`,
  priority-ordered) — identified here by `region`.
- `CI_CLASS_CLOUD_SERVICE_ACCOUNT = 'cmdb_ci_cloud_service_account'` — a
  fourth, shared-per-run placeholder that `cmdb_ci_logical_datacenter`
  requires as ITS parent, also via `Hosted on::Hosts`. This is the actual
  top of the chain: it has an **Independent** Identification Rule
  (`Object ID` or `Account Id`, priority-ordered), identified here by
  `HC Cloud Account.account_id`. Has one mandatory field,
  `datacenter_type` (a `table_name`-typed field) — set to
  `CI_CLASS_LOGICAL_DATACENTER`.
- `CONTAINMENT_RELATION_TYPE = 'Contains::Contained by'` (network→subnet)
  — direction: `parent` = the container (network), `child` = the
  contained item (subnet). Confirmed correct on the first guess.
- `HOSTING_RELATION_TYPE = 'Hosted on::Hosts'` (network→datacenter,
  datacenter→account) — direction is the **OPPOSITE** of
  `CONTAINMENT_RELATION_TYPE`'s: `parent` = the dependent item itself,
  `child` = what satisfies its dependency (the host). This was the single
  biggest time sink — do not assume relation direction generalizes from
  one relation type to another, verify each one from a real
  `MISSING_DEPENDENCY` error's arrow notation.
- All 6 tables/`hc_connector_admin` role/ACLs from Phase 2A are reused
  as-is — no new tables, roles, or ACLs were needed for any of this.

`lib/mapVpcSubnetToIRE.js` and `HuaweiVpcDiscovery.js` already reflect all
of the above.

Also confirm the real VPC/Subnet list-API pagination shape before trusting
`_fetchPage()`/`lib/vpcPagination.js` — `HuaweiVpcDiscovery.js` assumes
marker/cursor pagination (`?marker=<last-id>`, response
`page_info.next_marker`), based on general knowledge of Huawei's
Neutron/OpenStack-derived VPC service, **not verified against this
sandbox**. Check Huawei's official VPC API reference, or make one real call
and inspect the raw response shape, before trusting the assumption.

## Step 1 — Deploy `HuaweiVpcDiscovery` and `HcConnectorVpcSync`

1. In Studio: File > New File > Script Include > **Name**:
   `HuaweiVpcDiscovery`. Paste the full contents of
   `servicenow/discovery/HuaweiVpcDiscovery.js` (hand-written, no codegen -
   paste as-is, same as `HuaweiECSDiscovery`). Save.
2. File > New File > Script Include > **Name**: `HcConnectorVpcSync`.
   Paste the full contents of
   `docs/generated/HcConnectorVpcSync.generated.js` (regenerate first via
   `node servicenow/hc-connector/scripts/build-script-include.js` if the
   repo has moved on). Save.
3. Confirm both pastes are complete using the same length/content check
   from Step 7 above, substituting the new Script Include names and
   checking for `function buildIREPayload(` (from `mapVpcSubnetToIRE.js`)
   in `HcConnectorVpcSync`'s case, or `reconcileCIs:` in
   `HuaweiVpcDiscovery`'s case.

## Step 2 — Run and verify

```javascript
new HcConnectorVpcSync().runAll();
```

Expect and fix forward the same class of real-PDI surprises ECS hit the
first time: `MISSING_DEPENDENCY`/`METADATA_RULE_MISSING` on the chosen CI
class if it needs a containment relation Step 0 didn't anticipate, an
unregistered `discovery_source` choice value (check whether the one Phase
2A's `sys_choice` fix already covers this — it's on the shared `cmdb_ci`
base table, so it may already be satisfied), or `MISSING_MATCHING_
ATTRIBUTES` if `object_id` isn't the right identifier field for the chosen
class.

Then verify against real data:

```javascript
gs.info('===== HC Discovery Run (vpc/subnet, most recent) =====');
var runGr = new GlideRecord('x_2021019_huawei_0_hc_discovery_run');
runGr.addQuery('resource_type', 'IN', 'vpc,subnet');
runGr.orderByDesc('sys_created_on');
runGr.setLimit(4);
runGr.query();
while (runGr.next()) {
    gs.info('resource_type=' + runGr.resource_type + ' | state=' + runGr.state +
        ' | success_count=' + runGr.success_count + ' | fail_count=' + runGr.fail_count +
        ' | error_summary=' + runGr.error_summary);
}

gs.info('===== HC Resource Sync State (vpc/subnet, all rows) =====');
var syncGr = new GlideRecord('x_2021019_huawei_0_hc_resource_sync_state');
syncGr.addQuery('resource_type', 'IN', 'vpc,subnet');
syncGr.query();
while (syncGr.next()) {
    gs.info('resource_type=' + syncGr.resource_type + ' | native_key=' + syncGr.native_key +
        ' | status=' + syncGr.status + ' | ci=' + syncGr.ci.getDisplayValue());
}

gs.info('===== cmdb_rel_ci (containment relation) =====');
var relGr = new GlideRecord('cmdb_rel_ci');
relGr.query();
var relCount = 0;
while (relGr.next()) {
    relCount++;
    gs.info('parent=' + relGr.parent.getDisplayValue() + ' | child=' + relGr.child.getDisplayValue() + ' | type=' + relGr.type.getDisplayValue());
}
gs.info('total cmdb_rel_ci rows: ' + relCount);
```

Once this confirms real VPC/Subnet CIs and their containment relation, walk
HC6–HC10 in `tests/atf/README.md` against the real data.

---

# Setup automation addendum

Deploying and verifying the "Run Sync Now" UI Action on top of an
already-working Phase 2A + 2B setup. No new tables, roles, or ACLs.

**Two abandoned custom-UI-Page attempts, recorded so they aren't
retried.** Both hit unresolved, instance-specific platform issues during
real-PDI verification:

1. **GlideAjax/Client Callable Script Include** (`extends
   global.AbstractAjaxProcessor`, called via `new GlideAjax(...)` from a
   client script). After fixing a real `AbstractAjaxProcessor undefined,
   maybe missing global qualifier` error (needs the `global.` prefix
   inside a scoped app), every real submit consistently returned an empty
   `<xml/>` response — HTTP 200, correct `sysparm_processor`/
   `sysparm_name` echoed back, but no `<answer>` node, no server-side
   exception anywhere. Ruled out: class/method work fine called directly
   server-side; ACL (`client_callable_script_include`/`execute`,
   `admin_overrides=1`) correctly configured and satisfied; UI Page and
   Script Include confirmed in the same scope; script content confirmed
   correctly deployed; a scope-qualified `new
   GlideAjax('x_2021019_huawei_0.HcConnectorSetupWizardAjax')` call made
   no difference.
2. **Plain Script Include + Processing Script** (no GlideAjax, a plain
   HTML `<form>` POST). Confirmed the HTML/form-field/Processing-Script
   deployment was all correct (byte-length checks, substring checks, no
   duplicate `sys_ui_page` records), yet `jvar_*` variables set in the
   Processing Script never reached the Jelly template — isolated all the
   way down to the simplest possible case (`jvar_ping = 'PONG';` in
   Processing Script, `${jvar_ping}` in HTML, on a brand new unrelated UI
   Page, still rendered empty), while a pure `<j:set var="x" .../>` with
   no Processing Script involved rendered correctly. This conclusively
   isolated the break to this instance's Processing-Script-to-Jelly
   `jvar_*` bridge specifically, not anything in this project's code.

Root cause of neither was ever conclusively identified — both are real
platform behavior on this specific instance, not code bugs. Rather than
keep chasing a broken mechanism, this project switched to native record
forms (already-working `HC Cloud Account`/`HC Cloud Region` table forms,
already-working `sys_properties.do` for AK/SK) plus a single **UI Action**
button, which needs neither GlideAjax nor the Processing-Script/Jelly
bridge — see `ui-actions/README.md` for why this is also how mature
cloud-vendor ServiceNow connectors handle this step.

## Step 1 — Deploy the UI Action

Create a UI Action on `HC Cloud Account` (Name: `Run Sync Now`, Action
name: `hc_run_sync_now`, Show update: checked, Show insert: unchecked,
Form button: checked, Client: unchecked) with the Script field pasted from
`ui-actions/hc_cloud_account_run_sync_now.js`. See `docs/INSTALL.md` Step 8
for the full field list.

## Step 2 — Click it

Open any `HC Cloud Account` record, click **Run Sync Now**. Confirm:
- An info message appears ("Sync complete. Check HC Discovery Run for
  results.") — or, if something failed, an error message naming which
  sync (`ECS sync: ...` / `VPC/Subnet sync: ...`).
- The most recent `HC Discovery Run` rows show `state=completed` for both
  `ecs` and `vpc`/`subnet`.
- No duplicate CIs or sync-state rows if this account/region combination
  was already synced before (same idempotency bar as HC9).

**✅ Real-PDI verified.** One gotcha during Step 1: the UI Action form's
Table field must be filled via the reference lookup (magnifying glass)
icon, not by typing the bare table name — free-typing triggers
ServiceNow's "table name already in use" new-table validation instead of
matching the existing scoped table. Step 2 confirmed across three separate
clicks: correct success message each time, and exactly 3 new `HC Discovery
Run` rows per click (`ecs`, `vpc`, `subnet`), all `state=completed`,
`success_count=1`, `fail_count=0`, no duplicates across the repeated
clicks.

## Step 3 — Deploy and verify periodic sync

Create a Scheduled Script Execution (Name: `HC Connector Scheduled Sync`,
Run: `Periodically`, Repeat Interval: `1 day`, Active: checked) with the
Script field pasted from `scheduled-jobs/hc_connector_scheduled_sync.js`.
See `docs/INSTALL.md` Step 9 for the full field list. Right-click >
**Execute Now** to test immediately, then confirm the same `HC Discovery
Run` result as Step 2 above (3 new rows, `state=completed`, no
duplicates).

**✅ Real-PDI verified.** Two `Execute Now` runs each produced exactly 3
new `HC Discovery Run` rows (`ecs`/`vpc`/`subnet`), all `state=completed`,
`success_count=1`, `fail_count=0`. One gotcha hit while querying results:
the table's short name `hc_discovery_run` only resolves inside the app's
own Application Scope — querying from Global scope (e.g. in Background
Scripts) needs the fully-qualified name
`x_2021019_huawei_0_hc_discovery_run` instead. Also confirmed ServiceNow
does not capture Scheduled Script Executions into Update Sets at all (see
`docs/PACKAGING.md`), so this job intentionally ships as this manual step
rather than inside the exported XML.
