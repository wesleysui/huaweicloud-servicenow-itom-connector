// UI Action script: "Start Instance" on cmdb_ci_vm_instance
//
// Paste this into the Script field of a new UI Action on cmdb_ci_vm_instance.
// Suggested UI Action fields:
//   Name: Start Instance
//   Table: Virtual Machine Instance [cmdb_ci_vm_instance]
//   Action name: hc_ecs_start_instance
//   Show insert: false (only meaningful once a record exists)
//   Show update: true
//   Form button: true
//   Client: false (server-side only, same pattern as
//     hc_cloud_account_run_sync_now.js - no GlideAjax needed)
//   Condition: new HcConnectorEcsLifecycleAction().isManaged(current.getUniqueValue())
//     (hides the button on any cmdb_ci_vm_instance NOT discovered by this
//     connector - cmdb_ci_vm_instance is a shared platform table, other
//     Discovery sources may also populate it)
//
// This is the first Day-2 (write) operation in this project - everything
// before this only ever read the cloud account. See
// service-graph/HcConnectorEcsLifecycleAction.js's header comment for the
// full design (credential resolution via HC Resource Sync State, signing
// reused from the already real-PDI-verified HuaweiECSDiscovery._sign()).
//
// Huawei's os-start action is idempotent-ish (starting an already-running
// instance is a real error, not a no-op) - not special-cased here per this
// project's "let the real error decide" discipline; the error surfaces via
// gs.addErrorMessage() as-is on the first real test.

(function executeRule(current, previous /*null when async*/) {
    try {
        new HcConnectorEcsLifecycleAction().performAction(current.getUniqueValue(), 'start');
        gs.addInfoMessage('Start requested for ' + current.getValue('name') +
            '. Huawei Cloud processes this asynchronously - refresh in a minute to see the updated status.');
    } catch (ex) {
        gs.addErrorMessage('Start failed: ' + ex.message);
    }

    action.setRedirectURL(current);
})(current, previous);
