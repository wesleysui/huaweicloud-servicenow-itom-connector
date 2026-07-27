/**
 * Pure request-body builder for ECS Day-2 lifecycle actions (start/stop/
 * reboot), Huawei's Nova-compatible batch action API:
 * POST /v1/{project_id}/cloudservers/action
 *
 * Kept separate from service-graph/HcConnectorEcsLifecycleAction.js (the
 * ServiceNow-side wrapper that resolves the CI -> account/region/
 * credentials, signs, and issues the HTTP call) so this piece stays
 * Node-testable with zero ServiceNow dependency, matching every other
 * lib/*.js module in this project.
 *
 * Real-PDI confirmed: the batch action endpoint returns HTTP 200 with
 * {"job_id": "<uuid>"} (not an empty body as first assumed), pointing at
 * Huawei's own async job-tracking endpoint,
 * GET /v1/{project_id}/jobs/{job_id}, whose `status` field is one of
 * INIT/RUNNING/SUCCESS/FAIL (Nova-compatible job status values).
 * HcConnectorEcsLifecycleAction.performAction() checks this endpoint once,
 * immediately after issuing the action - NOT in a wait-and-poll loop, since
 * a real-PDI test found gs.sleep() is fenced (blocked) for custom scoped
 * apps on this instance, ruling out a blocking multi-attempt loop inside
 * one transaction. See that file's header comment for the full story.
 */

var VALID_ACTIONS = ['start', 'stop', 'reboot'];

/**
 * @param {'start'|'stop'|'reboot'} action
 * @param {string} serverId - Huawei ECS instance UUID (cmdb_ci_vm_instance.correlation_id)
 * @param {{hard?: boolean}} [opts] - hard=true requests a HARD stop/reboot (power-cycle) instead of the default SOFT (graceful) one
 * @returns {Object} the JSON body for POST /v1/{project_id}/cloudservers/action
 */
function buildActionRequestBody(action, serverId, opts) {
  if (VALID_ACTIONS.indexOf(action) === -1) {
    throw new Error('Unknown ECS lifecycle action: ' + action + ' (must be one of ' + VALID_ACTIONS.join(', ') + ')');
  }
  if (!serverId) {
    throw new Error('serverId is required');
  }
  opts = opts || {};
  var mode = opts.hard ? 'HARD' : 'SOFT';
  var servers = [{ id: serverId }];

  if (action === 'start') {
    return { 'os-start': { servers: servers } };
  }
  if (action === 'stop') {
    return { 'os-stop': { servers: servers, type: mode } };
  }
  return { reboot: { type: mode, servers: servers } };
}

module.exports = {
  VALID_ACTIONS: VALID_ACTIONS,
  buildActionRequestBody: buildActionRequestBody
};
