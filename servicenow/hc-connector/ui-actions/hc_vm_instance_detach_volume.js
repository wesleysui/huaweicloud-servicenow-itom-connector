// UI Action script: "Detach Volume" on cmdb_ci_vm_instance
//
// Paste this into the Script field of a new UI Action on cmdb_ci_vm_instance.
// Suggested UI Action fields:
//   Name: Detach Volume
//   Table: Virtual Machine Instance [cmdb_ci_vm_instance]
//   Action name: hc_ecs_detach_volume
//   Show insert: false
//   Show update: true
//   Form button: true
//   Client: true   (needs prompt() for the target volume ID - same reason
//                    Resize Instance / Attach Volume need Client: true)
//   OnClick: detachVolume()
//   Condition: new HcConnectorEcsLifecycleAction().isManaged(current.getUniqueValue())
//
// GlideAjax bridges to HcConnectorEcsLifecycleAjax.detach() - see that
// file's header comment. Deploy both HcConnectorEcsLifecycleAjax.js (paste
// as-is, no generation step) and this UI Action together.
//
// Huawei documents that the system disk (device /dev/sda) can only be
// detached while the instance is stopped, while data disks can be detached
// live - not special-cased or checked here; Huawei's API is the source of
// truth for the real error shape if you try to detach the wrong one live
// (untested - this feature is source-complete but not yet real-PDI
// verified, see docs/ARCHITECTURE.md's Day-2 operations section). No force
// (?delete_flag=1) option exposed in this UI - pass {force: true} to
// performDetach() directly (e.g. from Background Scripts) if a real need
// for it shows up, same "build the capability, don't expose every knob as
// a button yet" choice already made for HARD stop/reboot.
//
// See hc_vm_instance_start.js's header comment for the shared design
// rationale (isManaged() condition, etc.) behind the other lifecycle UI
// Actions.

function detachVolume() {
    var volumeId = prompt('Huawei Cloud EVS disk UUID to detach from this instance ' +
        '(look it up on the Huawei Cloud console or the CI\'s related list).');
    if (!volumeId) {
        return false;
    }

    var ga = new GlideAjax('HcConnectorEcsLifecycleAjax');
    ga.addParam('sysparm_name', 'detach');
    ga.addParam('sysparm_ci_sys_id', g_form.getUniqueValue());
    ga.addParam('sysparm_volume_id', volumeId);
    ga.getXMLAnswer(function(answer) {
        var result = JSON.parse(answer);
        if (!result.ok) {
            g_form.addErrorMessage('Detach failed: ' + result.error);
            return;
        }
        if (result.result.jobStatus === 'SUCCESS') {
            g_form.addInfoMessage('Detach succeeded (job ' + result.result.jobId + ').');
        } else if (result.result.jobId) {
            g_form.addInfoMessage('Detach requested - job ' + result.result.jobId +
                ' status: ' + result.result.jobStatus + '. Not yet confirmed complete - check back shortly.');
        } else {
            g_form.addInfoMessage('Detach requested. Huawei Cloud processes this asynchronously - refresh in a minute to see the updated status.');
        }
    });

    return false; // GlideAjax is async - the click itself must not submit the form
}
