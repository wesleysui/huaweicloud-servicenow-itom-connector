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

## Step 10 — Add Day-2 lifecycle operations: start/stop/reboot (🧑‍💻 manual admin config, optional)

Adds Start/Stop/Reboot buttons to the ECS instance CI form. This is this
project's first WRITE operation against the cloud account (everything
above only reads) — see `docs/ARCHITECTURE.md`'s "Day-2 operations"
section for the full design. **Action-issuing path real-PDI verified**
(start/stop, against a real sandbox instance, confirmed on the Huawei
Cloud console directly, not just "no ServiceNow error") — reboot shares
the same code path and is unit-tested but wasn't separately real-PDI
exercised. **Job-status checking is also real-PDI verified** — added
after the first verification pass found Huawei's API returns
`{"job_id": "..."}`, not an empty body; `performAction()` checks
`GET /v1/{project_id}/jobs/{job_id}` once, immediately after issuing the
action, and distinguishes SUCCESS/FAIL/a real in-progress status instead
of trusting the initial `HTTP 200` alone — **real-PDI verified end to
end**: both stop and start showed the real in-progress status on click,
then a follow-up `checkJobStatus()` call confirmed each job reached
`SUCCESS`, independently confirmed on the Huawei Cloud console too. **Not
a wait-and-poll loop** — a first attempt at that used `gs.sleep()` between
attempts and failed real-PDI with
`com.glide.script.fencing.MethodNotAllowedException: Function sleep is not
allowed in scope x_2021019_huawei_0` (a genuine
platform restriction on custom scoped apps, confirmed, not a guess) — see
`docs/ARCHITECTURE.md` for the full story. The same latent risk was found
in every Discovery file's retry/backoff logic too and proactively fixed
there as well (`HuaweiECSDiscovery.js` and siblings) - if you already
deployed any of those Script Includes, redeploy them (re-paste the current
file contents) to pick up the fix, though none of them has ever actually
hit a real retryable HTTP status in this project's testing, so this isn't
urgent the way the `HcConnectorEcsLifecycleAction` fix was. If you already
deployed `HcConnectorEcsLifecycleAction` before this fix, **redeploy it**
(step 2 below) to pick it up - and redeploy **all three UI Actions too**
(step 3), not just the Script Include: their message-branching logic
changed in the same pass, and a real-PDI test found that redeploying only
the Script Include left the UI Actions showing a stale generic message
even though the Script Include's own logic (and logs) were already
correct - an easy step to miss.

Requires Step 5 (ECS sync already deployed, so `HC Resource Sync State`
rows exist to resolve a CI's account/region) and the `HuaweiECSDiscovery`
Script Include from Step 5's prerequisites already present (its `_sign()`
method is reused directly, not duplicated).

1. Regenerate to be sure you have the latest build:
   ```bash
   node servicenow/hc-connector/scripts/build-script-include.js
   ```
2. In Studio, create a new Script Include named `HcConnectorEcsLifecycleAction`.
   Paste the **entire contents** of
   `docs/generated/HcConnectorEcsLifecycleAction.generated.js` — not
   `service-graph/HcConnectorEcsLifecycleAction.js` (that's the
   hand-written template with an unresolved `__HC_CONNECTOR_INLINED_LIB__`
   marker, same pattern as `HcConnectorEcsSync`/`HcConnectorVpcSync`; a
   real-PDI test with the un-generated template pasted directly failed with
   `"createCredentialProvider" is not defined"` — that bare function only
   becomes visible within whichever one file it's physically inlined into).
3. Create three UI Actions on `cmdb_ci_vm_instance` (Virtual Machine
   Instance), one per file below. For each:
   - **Show insert**: unchecked; **Show update**: checked; **Form
     button**: checked; **Client**: unchecked (server-side only)
   - **Condition**: `new HcConnectorEcsLifecycleAction().isManaged(current.getUniqueValue())`
     — hides the button on any `cmdb_ci_vm_instance` not discovered by
     this connector (a shared platform table)

   | Name | Action name | Script |
   |---|---|---|
   | Start Instance | `hc_ecs_start_instance` | `ui-actions/hc_vm_instance_start.js` |
   | Stop Instance | `hc_ecs_stop_instance` | `ui-actions/hc_vm_instance_stop.js` |
   | Reboot Instance | `hc_ecs_reboot_instance` | `ui-actions/hc_vm_instance_reboot.js` |

4. Open a real ECS instance CI discovered by this connector (Step 5/6
   already ran). Confirm all three buttons appear. Click **Stop Instance**,
   confirm the info message appears with no error, then check the Huawei
   Cloud console directly (not just the CMDB) that the instance actually
   stopped — this is the first feature in this project where "no error
   from ServiceNow" and "the cloud actually did the thing" are two
   genuinely separate facts to verify, since the API call is fire-and-
   forget async. Click **Start Instance** to bring it back, confirm the
   same way.
5. **Confirmed real response shape**: both actions return `HTTP 200` with
   body `{"job_id": "<uuid>"}` — not an empty body. A stale CI (the
   underlying instance already deleted, undetected by `HC Resource Sync
   State` because the retirement threshold hadn't been crossed yet)
   produced a misleading `HTTP 200` with no useful log detail on a first
   attempt — the response body is now logged on the success path too, not
   just on failure, specifically so this kind of "accepted but meaningless"
   response is visible in `gs.info`/`gs.error` logs prefixed
   `[HcConnectorEcsLifecycleAction]`.
6. **Verify job-status checking**: click **Stop Instance** again (redeploy
   step 2's updated Script Include first — the one with the fix for the
   `gs.sleep()` fencing error). The info message should now say either
   "Stop succeeded ... (job ...)" (Huawei's job already finished by the
   time the single check ran) or "Stop requested ... status: RUNNING/INIT
   ..." (job still in progress, a real status word, not a generic
   placeholder). Check the log for a `job ... status check: HTTP ...` line
   to see exactly what was returned. If it's still running, confirm you
   can check again later from Background Scripts:
   ```javascript
   new HcConnectorEcsLifecycleAction().checkJobStatus('<ciSysId>', '<jobId>');
   ```
   (both values are in the info message / log from step 6's first click).

## Step 11 — Add resize (🧑‍💻 manual admin config, optional, real-PDI verified end to end)

Adds a "Resize Instance" button. Unlike Start/Stop/Reboot, resize needs a
value collected interactively from you (the target Huawei flavor ID) that a
server-side-only UI Action has nowhere to read from — this step deploys
this project's first GlideAjax bridge to make that possible.

**Real-PDI verified**: against a real sandbox instance, Resize Instance
returned a real `job_id` (`job_type: "resizeServer"`), the button showed the
real in-progress status, a follow-up `checkJobStatus()` call confirmed
`SUCCESS` (~38s wall-clock), and the instance's flavor was independently
confirmed changed on the Huawei Cloud console. One real bug was found and
fixed along the way: a first attempt failed with `AbstractAjaxProcessor
undefined, maybe missing global qualifier` — a scoped app must reference
the global `AbstractAjaxProcessor` class with a `global.` prefix; fixed in
`HcConnectorEcsLifecycleAjax.js`. If your copy predates this fix, re-paste
it — see step 2. Still untested: resizing a running (not-`SHUTOFF`)
instance.

Requires Step 10 already deployed (`HcConnectorEcsLifecycleAction` with
`performResize()` — regenerate and redeploy it first if your copy predates
this step).

1. Regenerate to be sure you have the latest build (adds `performResize()`
   to the generated Script Include; no new lib modules to inline for this
   step):
   ```bash
   node servicenow/hc-connector/scripts/build-script-include.js
   ```
   Redeploy `docs/generated/HcConnectorEcsLifecycleAction.generated.js`
   over your existing `HcConnectorEcsLifecycleAction` Script Include.
2. In Studio, create a new Script Include named `HcConnectorEcsLifecycleAjax`.
   Paste the **entire contents** of
   `service-graph/HcConnectorEcsLifecycleAjax.js` directly — unlike the
   orchestrators and `HcConnectorEcsLifecycleAction`, this one has no
   `__HC_CONNECTOR_INLINED_LIB__` marker and needs no codegen step; it only
   instantiates `HcConnectorEcsLifecycleAction` (a class, which works fine
   across Script Includes without inlining). **Check "Client callable"** —
   required for GlideAjax; without it, the client-side call in step 3
   fails.
3. Create one more UI Action on `cmdb_ci_vm_instance` (a 4th, alongside the
   3 from Step 10 — Steps 11+12 together add 3 new ones: Resize, Attach
   Volume, Detach Volume), from `ui-actions/hc_vm_instance_resize.js`:
   - **Name**: Resize Instance, **Action name**: `hc_ecs_resize_instance`
   - **Show insert**: unchecked; **Show update**: checked; **Form
     button**: checked
   - **Client**: **checked** (unlike the other three — it needs `prompt()`
     for the target flavor ID) — **OnClick**: `resizeInstance()`
   - **Condition**: same as the other three,
     `new HcConnectorEcsLifecycleAction().isManaged(current.getUniqueValue())`
4. First **stop the instance** via Stop Instance (Step 10) — Huawei
   documents resize as only valid against an already-`SHUTOFF` instance;
   this code does not pre-check that for you, so resizing a running
   instance is expected to fail with whatever error Huawei's API actually
   returns (untested — report back the real error text if you hit this).
5. Click **Resize Instance**. Enter a real target flavor ID for your
   sandbox project/region (look up valid flavor IDs on the Huawei Cloud
   console — not every flavor is a valid resize target from every source
   flavor). Confirm the info message, then confirm on the Huawei Cloud
   console directly that the instance's flavor actually changed — same
   "ServiceNow said OK" vs. "the cloud actually did it" distinction Step
   10 already established for start/stop.

## Step 12 — Add attach/detach volume (🧑‍💻 manual admin config, optional, real-PDI verified end to end)

Adds "Attach Volume"/"Detach Volume" buttons, extending the same GlideAjax
bridge Step 11 deployed. **Real-PDI verified**: against a real EVS volume
(get one via `terraform apply -target=huaweicloud_evs_volume.catalog_evs`
if you don't already have an unattached one), Attach Volume's job reached
`SUCCESS` (~3s wall-clock), Detach Volume's job reached `SUCCESS` (~2.5s),
and the disk's final "available" (unattached) state was independently
confirmed on the Huawei Cloud console.

Requires Step 11 already deployed (`HcConnectorEcsLifecycleAjax` and the
`HcConnectorEcsLifecycleAction` regenerated with `performAttach()`/
`performDetach()`).

1. Regenerate and redeploy `HcConnectorEcsLifecycleAction` (same command
   as Step 11):
   ```bash
   node servicenow/hc-connector/scripts/build-script-include.js
   ```
2. Redeploy `HcConnectorEcsLifecycleAjax` — re-paste the current contents
   of `service-graph/HcConnectorEcsLifecycleAjax.js` (it now has
   `attach()`/`detach()` methods alongside `resize()`).
3. Create two more UI Actions on `cmdb_ci_vm_instance`:

   | Name | Action name | Script | Client | OnClick |
   |---|---|---|---|---|
   | Attach Volume | `hc_ecs_attach_volume` | `ui-actions/hc_vm_instance_attach_volume.js` | checked | `attachVolume()` |
   | Detach Volume | `hc_ecs_detach_volume` | `ui-actions/hc_vm_instance_detach_volume.js` | checked | `detachVolume()` |

   Same **Show insert**/**Show update**/**Form button**/**Condition**
   settings as every other lifecycle UI Action (see Step 10).
4. You'll need a real EVS disk UUID to test with — either one already
   provisioned by `terraform/main.tf` (Phase 2C's `huaweicloud_evs_volume`)
   or one created directly on the Huawei Cloud console. Click **Attach
   Volume**, enter that disk's UUID, confirm the info message, then
   confirm on the Huawei Cloud console that the disk actually shows as
   attached to this instance.
5. Click **Detach Volume** with the same disk UUID. Huawei documents that
   the system disk can only be detached while the instance is stopped, but
   data disks can be detached live — this code doesn't check or enforce
   either case, so if you test against the system disk on a running
   instance, expect (and report) whatever real error Huawei's API returns.

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
node servicenow/hc-connector/scripts/check-mirror-drift.js          # must report "No drift detected" across all mirrored pairs
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
