// Scheduled Script Execution: "HC Connector Scheduled Sync"
//
// Paste this into the Script field of a new Scheduled Script Execution
// (sysauto_script). Suggested fields:
//   Name: HC Connector Scheduled Sync
//   Run: Periodically
//   Repeat Interval: 1 day (adjust to taste - see docs/INSTALL.md)
//   Active: true
//
// Runs both HcConnectorEcsSync and HcConnectorVpcSync for every active
// HC Cloud Account/Region combination - the same two orchestrators the
// "Run Sync Now" UI Action calls (ui-actions/hc_cloud_account_run_sync_now.js).
// This is the periodic counterpart to that on-demand button: the button
// covers "sync right after I set up an account", this covers "keep
// syncing without anyone having to remember to click a button".
//
// No gs.addInfoMessage()/action.setRedirectURL() here (there's no UI
// session to show them to) - failures are logged via gs.error() instead,
// visible in the system log and (if desired) wireable to a notification
// separately.

(function() {
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
        gs.info('HC Connector Scheduled Sync completed successfully.');
    } else {
        gs.error('HC Connector Scheduled Sync finished with errors: ' + errors.join('; '));
    }
})();
