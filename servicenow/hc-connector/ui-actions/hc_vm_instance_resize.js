// UI Action script: "Resize Instance" on cmdb_ci_vm_instance
//
// Paste this into the Script field of a new UI Action on cmdb_ci_vm_instance.
// Suggested UI Action fields:
//   Name: Resize Instance
//   Table: Virtual Machine Instance [cmdb_ci_vm_instance]
//   Action name: hc_ecs_resize_instance
//   Show insert: false
//   Show update: true
//   Form button: true
//   Client: true   (needs prompt() for the target flavor - unlike Start/
//                    Stop/Reboot, there's no form field to read this from)
//   OnClick: resizeInstance()
//   Condition: new HcConnectorEcsLifecycleAction().isManaged(current.getUniqueValue())
//
// GlideAjax bridges to HcConnectorEcsLifecycleAjax.resize() (a thin
// client-callable wrapper - see that file's header comment for why it's
// separate from HcConnectorEcsLifecycleAction itself). Deploy both
// HcConnectorEcsLifecycleAjax.js (paste as-is, no generation step) and this
// UI Action together.
//
// Huawei requires the instance to already be stopped (SHUTOFF) before
// resize is accepted - not checked client-side or server-side here; if the
// instance isn't stopped, expect Huawei's API to reject the request. The
// exact real error shape is untested against a running instance (this
// feature is source-complete but not yet real-PDI verified - see
// docs/ARCHITECTURE.md's Day-2 operations section).
//
// See hc_vm_instance_start.js's header comment for the shared design
// rationale (isManaged() condition, etc.) behind the other three lifecycle
// UI Actions.

function resizeInstance() {
    var flavorRef = prompt('Target Huawei Cloud flavor ID (e.g. s6.large.2). ' +
        'The instance must already be stopped - look up valid flavor IDs on the Huawei Cloud console.');
    if (!flavorRef) {
        return false;
    }

    var ga = new GlideAjax('HcConnectorEcsLifecycleAjax');
    ga.addParam('sysparm_name', 'resize');
    ga.addParam('sysparm_ci_sys_id', g_form.getUniqueValue());
    ga.addParam('sysparm_flavor_ref', flavorRef);
    ga.getXMLAnswer(function(answer) {
        var result = JSON.parse(answer);
        if (!result.ok) {
            g_form.addErrorMessage('Resize failed: ' + result.error);
            return;
        }
        if (result.result.jobStatus === 'SUCCESS') {
            g_form.addInfoMessage('Resize succeeded (job ' + result.result.jobId + ').');
        } else if (result.result.jobId) {
            g_form.addInfoMessage('Resize requested - job ' + result.result.jobId +
                ' status: ' + result.result.jobStatus + '. Not yet confirmed complete - check back shortly.');
        } else {
            g_form.addInfoMessage('Resize requested. Huawei Cloud processes this asynchronously - refresh in a minute to see the updated status.');
        }
    });

    return false; // GlideAjax is async - the click itself must not submit the form
}
