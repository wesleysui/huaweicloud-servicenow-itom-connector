// Script Include: HcConnectorEcsLifecycleAjax
// Paste-ready as-is - no codegen step needed (it only instantiates
// HcConnectorEcsLifecycleAction, a Class.create() class, which works fine
// across Script Includes without inlining; it doesn't call any bare
// lib function the way HcConnectorEcsLifecycleAction.js itself needed to).
//
// Client callable: true (required checkbox for GlideAjax).
//
// Real-PDI test failed with "AbstractAjaxProcessor undefined, maybe missing
// global qualifier" - AbstractAjaxProcessor lives in the global scope, and a
// scoped app must reference global-scope classes with an explicit `global.`
// prefix (bare `AbstractAjaxProcessor` doesn't resolve inside a scoped
// script). Fixed by extending `global.AbstractAjaxProcessor` below - a
// different scoped-app platform restriction than the gs.sleep() fencing
// found earlier, but the same category of "the scope boundary is a real
// wall, not a guess."
//
// Thin bridge for the Day-2 ops that need client input: Resize, Attach
// Volume, Detach Volume. Start/Stop/Reboot are plain server-side UI Actions
// (no client input needed - see
// ui-actions/hc_vm_instance_{start,stop,reboot}.js), but these three need a
// value collected interactively from the admin (target flavor ID / volume
// ID) that a server-side-only UI Action has nowhere to read from. GlideAjax
// bridges that: ui-actions/hc_vm_instance_{resize,attach_volume,detach_volume}.js
// prompt on the client, then call the matching method here. Deliberately
// NOT making HcConnectorEcsLifecycleAction itself client-callable - that
// would expose ALL of its methods (performAction, checkJobStatus, ...) to
// client calls, not just these three.

var HcConnectorEcsLifecycleAjax = Class.create();
HcConnectorEcsLifecycleAjax.prototype = Object.extendsObject(global.AbstractAjaxProcessor, {

    // @param sysparm_ci_sys_id - cmdb_ci_vm_instance sys_id
    // @param sysparm_flavor_ref - target Huawei flavor ID, e.g. "s6.large.2"
    // @returns JSON string: {ok: true, result: {...}} or {ok: false, error: string}
    //   (client must JSON.parse() this - GlideAjax answers are always strings)
    resize: function() {
        var ciSysId = this.getParameter('sysparm_ci_sys_id');
        var flavorRef = this.getParameter('sysparm_flavor_ref');
        try {
            var result = new HcConnectorEcsLifecycleAction().performResize(ciSysId, flavorRef);
            return JSON.stringify({ ok: true, result: result });
        } catch (ex) {
            return JSON.stringify({ ok: false, error: ex.message });
        }
    },

    // @param sysparm_ci_sys_id - cmdb_ci_vm_instance sys_id
    // @param sysparm_volume_id - Huawei EVS disk UUID to attach
    // @returns same shape as resize()
    attach: function() {
        var ciSysId = this.getParameter('sysparm_ci_sys_id');
        var volumeId = this.getParameter('sysparm_volume_id');
        try {
            var result = new HcConnectorEcsLifecycleAction().performAttach(ciSysId, volumeId);
            return JSON.stringify({ ok: true, result: result });
        } catch (ex) {
            return JSON.stringify({ ok: false, error: ex.message });
        }
    },

    // @param sysparm_ci_sys_id - cmdb_ci_vm_instance sys_id
    // @param sysparm_volume_id - Huawei EVS disk UUID to detach
    // @returns same shape as resize()
    detach: function() {
        var ciSysId = this.getParameter('sysparm_ci_sys_id');
        var volumeId = this.getParameter('sysparm_volume_id');
        try {
            var result = new HcConnectorEcsLifecycleAction().performDetach(ciSysId, volumeId);
            return JSON.stringify({ ok: true, result: result });
        } catch (ex) {
            return JSON.stringify({ ok: false, error: ex.message });
        }
    },

    type: 'HcConnectorEcsLifecycleAjax'
});
