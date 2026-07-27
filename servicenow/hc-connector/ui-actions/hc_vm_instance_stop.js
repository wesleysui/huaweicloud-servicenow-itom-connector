// UI Action script: "Stop Instance" on cmdb_ci_vm_instance
//
// Paste this into the Script field of a new UI Action on cmdb_ci_vm_instance.
// Suggested UI Action fields:
//   Name: Stop Instance
//   Table: Virtual Machine Instance [cmdb_ci_vm_instance]
//   Action name: hc_ecs_stop_instance
//   Show insert: false
//   Show update: true
//   Form button: true
//   Client: false
//   Condition: new HcConnectorEcsLifecycleAction().isManaged(current.getUniqueValue())
//
// SOFT stop only (graceful shutdown) - the same 'hard' option
// HcConnectorEcsLifecycleAction.performAction() accepts is intentionally
// not exposed as a second button yet; add a "Force Stop Instance" UI
// Action calling performAction(sysId, 'stop', {hard: true}) later if a
// real need for HARD (power-cycle) stop shows up.
//
// See hc_vm_instance_start.js's header comment for the full design
// rationale (shared by all three lifecycle UI Actions).

(function executeRule(current, previous /*null when async*/) {
    try {
        new HcConnectorEcsLifecycleAction().performAction(current.getUniqueValue(), 'stop');
        gs.addInfoMessage('Stop requested for ' + current.getValue('name') +
            '. Huawei Cloud processes this asynchronously - refresh in a minute to see the updated status.');
    } catch (ex) {
        gs.addErrorMessage('Stop failed: ' + ex.message);
    }

    action.setRedirectURL(current);
})(current, previous);
