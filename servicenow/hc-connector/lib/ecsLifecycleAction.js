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
 *
 * buildResizeRequestBody() below targets a DIFFERENT Huawei endpoint
 * (per-server, not batch): POST /v1/{project_id}/cloudservers/{server_id}/resize
 * - researched (WebSearch/WebFetch against Huawei's published API docs), not
 * yet real-PDI verified. Documented hard prerequisite: the instance must
 * already be SHUTOFF before resize is accepted - not enforced here or in the
 * ServiceNow wrapper (this project's Day-2 code has consistently let
 * Huawei's own API be the source of truth for real rejection-error shapes
 * rather than guessing at pre-validation - see performAction()'s history in
 * docs/ARCHITECTURE.md). Response shape is the same async {"job_id": "..."}
 * as the batch actions above, reusing the same job-status-check mechanism.
 *
 * buildAttachRequestBody() targets Huawei's disk-attach endpoint (also
 * researched, not real-PDI verified): POST /v1/{project_id}/cloudservers/
 * {server_id}/attachvolume, confirmed via Huawei's published API docs
 * (support.huaweicloud.com/api-ecs/ecs_02_0605.html) - `volumeId` is the
 * only mandatory field; `volume_type`/`count`/`hw:passthrough` are real
 * optional fields this project deliberately doesn't expose in v1 (no real
 * need identified yet - add if one shows up, don't guess at it now).
 * Detach (DELETE /v1/{project_id}/cloudservers/{server_id}/detachvolume/
 * {volume_id}, confirmed via ecs_02_0606.html) takes no request body at
 * all, just an optional `delete_flag=1` query parameter for a forced
 * detach - so there's no corresponding buildDetachRequestBody() here;
 * the ServiceNow wrapper builds that path/query directly, same as it
 * already does for every endpoint's pathname.
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

/**
 * @param {string} flavorRef - target Huawei ECS flavor ID (e.g. "s6.large.2")
 * @param {{dryRun?: boolean}} [opts] - dryRun=true asks Huawei to validate without actually resizing
 * @returns {Object} the JSON body for POST /v1/{project_id}/cloudservers/{server_id}/resize
 */
function buildResizeRequestBody(flavorRef, opts) {
  if (!flavorRef) {
    throw new Error('flavorRef is required');
  }
  opts = opts || {};
  return { resize: { flavorRef: flavorRef }, dry_run: !!opts.dryRun };
}

/**
 * @param {string} volumeId - Huawei EVS disk UUID to attach
 * @param {{device?: string, dryRun?: boolean}} [opts] - device is an optional explicit mount point (e.g. "/dev/sdb"); omit to let Huawei auto-assign one
 * @returns {Object} the JSON body for POST /v1/{project_id}/cloudservers/{server_id}/attachvolume
 */
function buildAttachRequestBody(volumeId, opts) {
  if (!volumeId) {
    throw new Error('volumeId is required');
  }
  opts = opts || {};
  var volumeAttachment = { volumeId: volumeId };
  if (opts.device) {
    volumeAttachment.device = opts.device;
  }
  return { volumeAttachment: volumeAttachment, dry_run: !!opts.dryRun };
}

module.exports = {
  VALID_ACTIONS: VALID_ACTIONS,
  buildActionRequestBody: buildActionRequestBody,
  buildResizeRequestBody: buildResizeRequestBody,
  buildAttachRequestBody: buildAttachRequestBody
};
