// UI Action script: "Run Sync Now" on HC Cloud Account
// (x_2021019_huawei_0_hc_cloud_account)
//
// Paste this into the Script field of a new UI Action on the
// HC Cloud Account table. Suggested UI Action fields:
//   Name: Run Sync Now
//   Table: HC Cloud Account
//   Action name: hc_run_sync_now
//   Show insert: false (only meaningful once a record exists)
//   Show update: true
//   Form button: true
//   Client: false (this runs entirely server-side - no onClick/GlideAjax
//     needed, sidestepping the classic UI Page mechanisms this project
//     tried and abandoned - see docs/ROADMAP.md's Setup Wizard entries)
//
// Runs both HcConnectorEcsSync and HcConnectorVpcSync immediately (same
// orchestrators the old Setup Wizard's "Run first sync now" button would
// have called) - not scoped to just the current record, since both
// orchestrators already loop every active account/region themselves.
//
// This is deliberately the ONLY custom UI artifact for setup automation in
// this project (see servicenow/hc-connector/README.md's "Setup automation"
// section for why): account/region creation and AK/SK System Property
// entry use ServiceNow's own native table forms - no custom HTML/Jelly/
// GlideAjax needed for those, which is also how mature cloud-vendor
// ServiceNow connectors handle this (native record forms + a UI Action
// button, not a hand-rolled setup wizard page).

(function executeRule(current, previous /*null when async*/) {
    var errors = [];

    try {
        new HcConnectorEcsSync().runAll();
    } catch (ex) {
        errors.push('ECS sync: ' + ex.message);
    }

    try {
        new HcConnectorVpcSync().runAll();
    } catch (ex) {
        errors.push('VPC/Subnet sync: ' + ex.message);
    }

    if (errors.length === 0) {
        gs.addInfoMessage('Sync complete. Check HC Discovery Run for results.');
    } else {
        gs.addErrorMessage('Sync finished with errors: ' + errors.join('; '));
    }

    action.setRedirectURL(current);
})(current, previous);
