// UI Action script: "Attach Volume" on cmdb_ci_vm_instance
//
// Paste this into the Script field of a new UI Action on cmdb_ci_vm_instance.
// Suggested UI Action fields:
//   Name: Attach Volume
//   Table: Virtual Machine Instance [cmdb_ci_vm_instance]
//   Action name: hc_ecs_attach_volume
//   Show insert: false
//   Show update: true
//   Form button: true
//   Client: true   (needs prompt() for the target volume ID - same reason
//                    Resize Instance needs Client: true)
//   OnClick: attachVolume()
//   Condition: new HcConnectorEcsLifecycleAction().isManaged(current.getUniqueValue())
//
// GlideAjax bridges to HcConnectorEcsLifecycleAjax.attach() - see that
// file's header comment. Deploy both HcConnectorEcsLifecycleAjax.js (paste
// as-is, no generation step) and this UI Action together.
//
// Real error shape untested against a real instance (this feature is
// source-complete but not yet real-PDI verified - see
// docs/ARCHITECTURE.md's Day-2 operations section). No dedicated device
// mount-point input in this UI - Huawei auto-assigns one when omitted;
// pass {device: '/dev/sdb'} to performAttach() directly (e.g. from
// Background Scripts) if you need an explicit mount point.
//
// See hc_vm_instance_start.js's header comment for the shared design
// rationale (isManaged() condition, etc.) behind the other lifecycle UI
// Actions.

function attachVolume() {
    var volumeId = prompt('Huawei Cloud EVS disk UUID to attach to this instance ' +
        '(look it up on the Huawei Cloud console).');
    if (!volumeId) {
        return false;
    }

    var ga = new GlideAjax('HcConnectorEcsLifecycleAjax');
    ga.addParam('sysparm_name', 'attach');
    ga.addParam('sysparm_ci_sys_id', g_form.getUniqueValue());
    ga.addParam('sysparm_volume_id', volumeId);
    ga.getXMLAnswer(function(answer) {
        var result = JSON.parse(answer);
        if (!result.ok) {
            g_form.addErrorMessage('Attach failed: ' + result.error);
            return;
        }
        if (result.result.jobStatus === 'SUCCESS') {
            g_form.addInfoMessage('Attach succeeded (job ' + result.result.jobId + ').');
        } else if (result.result.jobId) {
            g_form.addInfoMessage('Attach requested - job ' + result.result.jobId +
                ' status: ' + result.result.jobStatus + '. Not yet confirmed complete - check back shortly.');
        } else {
            g_form.addInfoMessage('Attach requested. Huawei Cloud processes this asynchronously - refresh in a minute to see the updated status.');
        }
    });

    return false; // GlideAjax is async - the click itself must not submit the form
}
