// Scheduled Script Execution: "HC Connector Day-2 Job Poller"
//
// Paste this into the Script field of a new Scheduled Script Execution
// (sysauto_script). Suggested fields:
//   Name: HC Connector Day-2 Job Poller
//   Run: Periodically
//   Repeat Interval: 2 minutes (adjust to taste - see docs/INSTALL.md)
//   Active: true
//
// Re-checks every HC Day-2 Action Log row still in 'requested'/'running'
// status against Huawei's job-tracking endpoint
// (HcConnectorEcsLifecycleAction.pollPendingActionLogs(), which reuses
// checkJobStatus() - the same method already usable ad hoc from Background
// Scripts) and updates each row to 'success'/'fail' once its job resolves.
//
// This is what actually closes the real gap found during Day-2 ops
// testing: a UI Action's info message (Start/Stop/Reboot/Resize/Attach
// Volume/Detach Volume) is a one-time popup, so if the first job-status
// check wasn't terminal yet, there was no way to learn the final outcome
// without Background Scripts or the Huawei Cloud console. With this job
// running, an admin can instead just look at the HC Day-2 Action Log
// related list on the CI form and see the real result once it's known -
// only viable as a Scheduled Job (not a UI-session wait-and-poll loop)
// because gs.sleep() is fenced for this scope - see
// HcConnectorEcsLifecycleAction.js's header comment for the fuller story.
//
// No gs.addInfoMessage()/action.setRedirectURL() here (there's no UI
// session to show them to) - failures are logged via gs.error() instead,
// same pattern as hc_connector_scheduled_sync.js.

(function() {
    try {
        new HcConnectorEcsLifecycleAction().pollPendingActionLogs();
    } catch (ex) {
        gs.error('HC Connector Day-2 Job Poller failed: ' + ex.message);
    }
})();
