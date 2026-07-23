# HC ITOM Connector — Application/Update Set Packaging (Stream B)

Distributes the hand-built `x_2021019_huawei_0` scoped app as a real
ServiceNow Update Set. Per this project's standing rule
(`tables/README.md`): **never fabricate Update Set XML by hand** — the
only acceptable artifact is a real export from ServiceNow's own
**Export to XML**, proven by importing it into a second real instance.

Prerequisite: Stream A (setup automation — native forms + the "Run Sync Now"
UI Action) is real-PDI verified.

## What ships in the Update Set
- 6 tables + their dictionary fields (`hc_cloud_account`, `hc_cloud_region`,
  `hc_discovery_run`, `hc_resource_sync_state`, `hc_event_ingestion_record`,
  `hc_connector_config`)
- `hc_connector_admin` role + its ACLs
- Script Includes: `HuaweiECSDiscovery`, `HuaweiVpcDiscovery`,
  `HcConnectorEcsSync`, `HcConnectorVpcSync`
- UI Action: `Run Sync Now` on `HC Cloud Account`

## What does NOT ship (by design)
- **AK/SK credentials** — instance-specific secrets, entered per-instance
  via `sys_properties.do` (see `docs/INSTALL.md`).
- **`HC Cloud Account`/`HC Cloud Region` records and discovery history** —
  application data, not structure. Each org creates its own via the native
  forms after import.
- **Event Management** (`servicenow/event-management/`) — a separate piece
  with its own install steps, not bundled here.
- **`scheduled-jobs/hc_connector_scheduled_sync.js`** — ServiceNow does not
  capture Scheduled Script Executions (`sysauto_script`) into Update Sets
  at all (confirmed empirically: created the record with the target Update
  Set genuinely current, no `sys_update_xml` entry appeared). Ships as a
  manual one-time step instead — `docs/INSTALL.md` Step 9.

## How to import this into another instance
1. **All** > `System Update Sets > Retrieved Update Sets` > **Import
   Update Set from XML**, upload
   `servicenow/hc-connector/dist/hc-itom-connector-update-set.xml`.
2. Open the retrieved update set, click **Preview Update Set**.
3. Confirm no conflicts requiring manual resolution.
4. **Commit Update Set**.

## After importing: configure and verify
1. Assign yourself (or the relevant admins) the `hc_connector_admin` role.
2. Create an `HC Cloud Account` + `HC Cloud Region` via the native forms.
3. Set the two AK/SK System Properties (`docs/INSTALL.md`).
4. Open the account record — confirm the **Run Sync Now** button appears
   and click it.
5. Confirm 3 new `HC Discovery Run` rows (`ecs`/`vpc`/`subnet`), all
   `state=completed`.
6. Click it again — confirm no duplicate CIs (idempotency check).

Only after this passes does packaging count as done — flip `README.md`'s
Packaging status to ✅ with this file linked as evidence.

## Re-exporting after changing the source app
If tables, ACLs, Script Includes, or the UI Action change, redo the
capture: create a new current Update Set, re-save every changed artifact,
then Export to XML again. Two gotchas hit on this instance, worth
re-checking if a future export comes out empty or incomplete:
- A **no-op save doesn't get captured** — the record needs a real field
  change (even a trivial toggle-and-revert) to register.
- **Global-owned tables** (`sys_db_object`, `sys_dictionary`,
  `sys_security_acl`) refuse writes from the app's own scope in
  Background Scripts on this instance — switch Application Scope to
  Global first.
- **Export to XML only appears once the Update Set's `State` is
  `Complete`** — it's hidden while `In progress`.

## Status
Captured and exported: 161 records (89 dictionary fields, 54 ACLs, 6
tables, 6 field-label side effects, 4 Script Includes, 1 UI Action, 1
role), saved to `servicenow/hc-connector/dist/hc-itom-connector-update-set.xml`
(638 KB). Periodic sync (`scheduled-jobs/`) real-PDI verified separately —
see "What does NOT ship" above for why it's not in this file.

**Remaining**: import into a second instance and post-import
reverification — not started yet.
