# scheduled-jobs/

`hc_connector_scheduled_sync.js` — a Scheduled Script Execution script
(not a Script Include; no codegen needed, paste directly into a new
Scheduled Script Execution record's Script field). Runs
`HcConnectorEcsSync`/`HcConnectorVpcSync` periodically, without anyone
having to remember to click **Run Sync Now**.

## Why this exists

The `ui-actions/hc_cloud_account_run_sync_now.js` button covers the
"sync right after I set up an account" case, but mature cloud-vendor
ServiceNow connectors always pair a manual trigger with an automatic
periodic one — CMDB data goes stale otherwise. This is that periodic
counterpart: same two orchestrators, no UI-specific bits
(`gs.addInfoMessage()`/`action.setRedirectURL()`), failures logged via
`gs.error()` instead.

See `docs/INSTALL.md` for the field values to use when creating the
Scheduled Script Execution record.
