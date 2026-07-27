// UI Action script: "Reboot Instance" on cmdb_ci_vm_instance
//
// Paste this into the Script field of a new UI Action on cmdb_ci_vm_instance.
// Suggested UI Action fields:
//   Name: Reboot Instance
//   Table: Virtual Machine Instance [cmdb_ci_vm_instance]
//   Action name: hc_ecs_reboot_instance
//   Show insert: false
//   Show update: true
//   Form button: true
//   Client: false
//   Condition: new HcConnectorEcsLifecycleAction().isManaged(current.getUniqueValue())
//
// SOFT reboot only (graceful) - same 'hard' escape hatch note as
// hc_vm_instance_stop.js applies here too.
//
// See hc_vm_instance_start.js's header comment for the full design
// rationale (shared by all three lifecycle UI Actions).

(function executeRule(current, previous /*null when async*/) {
    try {
        new HcConnectorEcsLifecycleAction().performAction(current.getUniqueValue(), 'reboot');
        gs.addInfoMessage('Reboot requested for ' + current.getValue('name') +
            '. Huawei Cloud processes this asynchronously - refresh in a minute to see the updated status.');
    } catch (ex) {
        gs.addErrorMessage('Reboot failed: ' + ex.message);
    }

    action.setRedirectURL(current);
})(current, previous);
