# HC ITOM Connector — Install Guide

Every step is labeled:

- 🤖 **Automatable** — a script you run once, no manual UI work.
- 📦 **Needs instance import** — none anywhere in this project yet. A
  one-click install is planned via ServiceNow's Application Repository
  (Git-backed), once the app is feature-complete — see
  `docs/ARCHITECTURE.md`'s "Setup automation & distribution packaging"
  section.
- 🧑‍💻 **Needs manual admin config** — a human clicking through the
  ServiceNow UI; unavoidable or safer than the automated alternative.

## Step 1 — Rename the app (🧑‍💻 manual admin config)

1. **System Definition > Applications**.
2. Open the app currently named "Huawei Cloud ITOM" (scope
   `x_2021019_huawei_0`).
3. Change **Name** to **"HC ITOM Connector"**. Save.
4. The internal `scope` identifier (`x_2021019_huawei_0`) does **not**
   change — it can't be renamed after creation. All table/field names use
   that scope, e.g. `x_2021019_huawei_0_hc_cloud_account`.

This does not affect `servicenow/discovery/` or `servicenow/event-management/`
— they keep running under the same scope, unaffected by the display-name
change.

## Step 2 — Create the 6 tables, the admin role, and its ACLs (🧑‍💻 manual admin config)

Follow **[`ACL-SETUP.md`](ACL-SETUP.md)** — this now supersedes the
generic "Option A/B" table-creation guidance from Phase 1. Tables are
created via **Studio's table wizard specifically**, not
`generate-provision-script.js`, because Studio auto-generates correct
default ACLs and this phase puts real account-adjacent configuration
behind these tables. `generate-provision-script.js`/`generate-table-docs.js`
still exist and still work as schema-authoring/documentation tools (regenerate
them whenever a `tables/*.schema.json` file changes so `docs/generated/`
stays current) — just don't use the provisioning script to create the
tables on a real instance you care about the ACLs on.

## Step 3 — Create `HC Cloud Account` and `HC Cloud Region` records (🧑‍💻 manual admin config)

Use the table's own native form — no custom UI needed for this. This is
also how mature cloud-vendor ServiceNow connectors typically handle this
step, not just a fallback.

For your existing sandbox project (already used by `terraform/` and
`servicenow/discovery/`):

1. Open `HC Cloud Account` (as a user with `hc_connector_admin`), New:
   - **Account ID**: any stable identifier you choose, e.g. `sandbox-1`
     (this becomes part of the System Property names in Step 4 — pick
     something short, no spaces).
   - **Name**: a human-readable label.
   - **Auth Mode**: `AK/SK (compat mode)` — `IAM Agency` is not implemented
     yet (see `docs/ARCHITECTURE.md`).
   - **Active**: checked.
2. Open `HC Cloud Region`, New:
   - **Cloud Account**: the record from step 1.
   - **Region Code**: e.g. `af-south-1` (or wherever your sandbox project
     is).
   - **Project ID**: the Huawei Cloud project ID for that account **in
     that region** — this is genuinely per-region in Huawei's IAM model,
     which is why it's a field here and not on `HC Cloud Account`.
   - **Sync Enabled** / **Active**: checked.

## Step 4 — Store AK/SK for this account (🧑‍💻 manual admin config)

While your scoped app is the active application scope, create two System
Properties, using the **same Account ID** you chose in Step 3:

| Property | Type | Value |
|---|---|---|
| `x_hwc.itom.<account_id>.access_key` | string | the AK |
| `x_hwc.itom.<account_id>.secret_key` | password2 | the SK |

e.g. for account ID `sandbox-1`: `x_hwc.itom.sandbox-1.access_key` /
`x_hwc.itom.sandbox-1.secret_key`. This is the same proven
System-Property/`password2` pattern documented in
`servicenow/discovery/README.md`, extended with the account ID so multiple
`HC Cloud Account` rows can each carry distinct credentials — see
`lib/credentialProvider.js`'s `AkSkSystemPropertyProvider`. (Reuse the
exact same AK/SK already validated against `terraform/` and
`servicenow/discovery/` if you're pointing this at the same sandbox
project — no need for a new IAM user.)

## Step 5 — Deploy the orchestrator Script Include (🧑‍💻 manual admin config)

1. Regenerate to be sure you have the latest build:
   ```bash
   node servicenow/hc-connector/scripts/build-script-include.js
   ```
2. In Studio, create a new Script Include named `HcConnectorEcsSync`.
3. Paste the **entire contents** of
   `docs/generated/HcConnectorEcsSync.generated.js` — not
   `service-graph/HcConnectorEcsSync.js` (that's the hand-written
   template with an unresolved `__HC_CONNECTOR_INLINED_LIB__` marker, not
   deployable on its own).
4. Save. If it fails to compile, see the paste-corruption notes in
   `servicenow/discovery/README.md` ("Important notes" - large files with
   non-ASCII characters have failed to paste cleanly before; this file is
   plain ASCII with `//` comments only, by convention, so it should be
   fine, but check first).

## Step 6 — Run it and verify

In Background Scripts:
```javascript
new HcConnectorEcsSync().runAll();
```
Then follow the verification checklist in the Phase 2A plan / ATF cases in
`tests/atf/README.md` (multi-account isolation, upsert-no-duplicate,
retirement behavior, `correlation_id` binding regression) — this is the
interactive, real-PDI stage every phase of this project has gone through;
nothing here is considered verified until it's actually been run.

## Step 7 — Deploy VPC + Subnet discovery (Phase 2B, 🧑‍💻 manual admin config)

No new tables, roles, or ACLs — VPC/Subnet reuse the same 6 tables and
`hc_connector_admin` role from Steps 1–4.

1. **Do this first**: run the Step 0 CI-class/relation-type/pagination
   diagnostic in
   [`REAL-PDI-REPLAY-CHECKLIST.md`](REAL-PDI-REPLAY-CHECKLIST.md)'s Phase
   2B addendum. `lib/mapVpcSubnetToIRE.js`'s `CI_CLASS_VPC`/
   `CI_CLASS_SUBNET`/`CONTAINMENT_RELATION_TYPE` are unverified
   placeholders until this runs.
2. In Studio, create a Script Include named `HuaweiVpcDiscovery`. Paste the
   **entire contents** of `servicenow/discovery/HuaweiVpcDiscovery.js`
   (hand-written, no codegen — paste as-is, same as `HuaweiECSDiscovery`).
3. Create a second Script Include named `HcConnectorVpcSync`. Paste the
   **entire contents** of
   `docs/generated/HcConnectorVpcSync.generated.js` — not
   `service-graph/HcConnectorVpcSync.js` (hand-written template, has an
   unresolved marker).
4. In Background Scripts: `new HcConnectorVpcSync().runAll();` — requires a
   real VPC + Subnet in your sandbox (`terraform apply` in `terraform/`
   provisions one). Then walk HC6–HC10 in `tests/atf/README.md`.

## Step 8 — Add the "Run Sync Now" button (🧑‍💻 manual admin config, one-time)

Adds a one-click alternative to Background Scripts for triggering both
orchestrators. Requires Steps 5 and 7 (the ECS and VPC/Subnet orchestrator
Script Includes) to already be deployed.

This step follows how mature cloud-vendor ServiceNow connectors actually
handle this: a **UI Action** button on the native record form, not a
custom page.

1. In Studio (or `sys_ui_action_list.do`), create a new UI Action:
   - **Name**: `Run Sync Now`
   - **Table**: `HC Cloud Account`
   - **Action name**: `hc_run_sync_now`
   - **Show update**: checked; **Show insert**: unchecked
   - **Form button**: checked; **Client**: unchecked (this runs entirely
     server-side)
   - **Script**: paste the entire contents of
     `ui-actions/hc_cloud_account_run_sync_now.js`
2. Open any `HC Cloud Account` record and click **Run Sync Now**. Confirm
   an info message appears ("Sync complete...") and `HC Discovery Run`
   shows successful runs for both `ecs` and `vpc`/`subnet`.

## Step 9 — Add periodic sync (🧑‍💻 manual admin config, one-time, optional but recommended)

"Run Sync Now" is on-demand only — without this step, CMDB data only
updates when someone remembers to click the button. This step adds the
automatic counterpart.

1. Go to `sysauto_script_list.do` (Scheduled Script Executions), create a
   new one:
   - **Name**: `HC Connector Scheduled Sync`
   - **Run**: `Periodically`
   - **Repeat Interval**: `1 day` (adjust to your freshness needs)
   - **Active**: checked
   - **Script**: paste the entire contents of
     `scheduled-jobs/hc_connector_scheduled_sync.js`
2. Right-click the record header > **Execute Now** to test immediately
   rather than waiting for the schedule. Confirm `HC Discovery Run` shows
   new successful runs the same way Step 8 did.

## `servicenow/discovery/HuaweiECSDiscovery.js` still works standalone

If you don't need multi-account/region support, `new
HuaweiECSDiscovery().run()` with no arguments is **unchanged** — same
System Properties, same behavior, as documented in
`servicenow/discovery/README.md`. `HcConnectorEcsSync` is an addition, not
a replacement; nothing forces the migration.

## Verifying locally (no ServiceNow instance needed)

```bash
npm test                                                            # all suites green, count > 230
node servicenow/hc-connector/scripts/generate-table-docs.js         # regenerates docs/generated/tables/*.md
node servicenow/hc-connector/scripts/generate-provision-script.js   # regenerates docs/generated/provision-hc-connector-tables.js
node servicenow/hc-connector/scripts/build-script-include.js        # regenerates HcConnectorEcsSync/VpcSync.generated.js
node servicenow/hc-connector/scripts/check-mirror-drift.js          # must report "No drift detected" across all 3 mirrored pairs
```

## Upgrading from here

Phase 2C adds EVS + EIP discovery, once either has real API grounding in
this repo (a Terraform resource, real field samples, a sandbox test path) —
EVS/EIP were split out of the original Phase 2B scope specifically because
they don't have that yet. Its own install guide will extend this one, not
replace it.

Separately, a one-click install for this connector (so a different instance
doesn't need to repeat Steps 1–8 by hand) is planned via ServiceNow's
Application Repository — see `docs/ARCHITECTURE.md`.
