# ui-actions/

`hc_cloud_account_run_sync_now.js` — a UI Action script (not a Script
Include; no codegen needed, paste directly into a new UI Action record's
Script field). Adds a "Run Sync Now" button to the `HC Cloud Account` form
that runs `HcConnectorEcsSync`/`HcConnectorVpcSync` immediately.

## Why this exists instead of a custom Setup Wizard UI Page

This project follows how mature cloud-vendor ServiceNow connectors
actually handle post-install configuration: **native record forms, not
custom pages**. `HC Cloud Account`/`HC Cloud Region` are filled in via
ServiceNow's own auto-generated table forms (zero custom code —
mandatory-field validation, choice dropdowns, etc. all come from the
dictionary already defined in `tables/*.schema.json`); AK/SK credentials
are entered as two System Properties via the standard `sys_properties.do`
form (see `docs/INSTALL.md`). The only genuinely custom artifact needed is
this one UI Action button — just a synchronous server-side script and
`gs.addInfoMessage()`, no Jelly/GlideAjax/custom page involved.
