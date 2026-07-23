/**
 * Pure planner for HC Resource Sync State writes. Given the resources seen
 * in one discovery run and the existing sync-state rows for that
 * (account, region, resource_type), computes what to insert, what to
 * refresh (seen again), and what lifecycle transition each existing-but-
 * not-seen row should undergo - via resourceLifecycle.computeNextState(),
 * injected as a parameter rather than imported directly, so this module has
 * zero cross-file dependencies (a requirement for
 * scripts/build-script-include.js to safely concatenate it with the other
 * lib modules it inlines).
 *
 * The ServiceNow-side wrapper (service-graph/HcConnectorEcsSync.js) is a
 * thin adapter turning this plan into GlideRecord reads/writes - all the
 * actual decision logic lives here, pure and unit-tested.
 */

/**
 * @param {Array<{native_key: string, ci?: string}>} seenRecords - resources found in this run; ci = the CI sys_id from IRE reconciliation, if known
 * @param {Array<{native_key: string, sys_id: string, status: string, consecutive_miss_count: number}>} existingRows - existing HC Resource Sync State rows for this (account, region, resource_type)
 * @param {{consecutiveMissThreshold?: number, computeNextState: (current: Object, seenThisRun: boolean, threshold?: number) => {status: string, consecutive_miss_count: number}}} options - computeNextState is resourceLifecycle.computeNextState
 * @returns {{toInsert: Array<Object>, toRefresh: Array<Object>, toTransition: Array<Object>}}
 */
function planSyncStateUpdates(seenRecords, existingRows, options) {
  if (!options || typeof options.computeNextState !== 'function') {
    throw new Error('options.computeNextState is required (pass resourceLifecycle.computeNextState)');
  }
  var threshold = options.consecutiveMissThreshold;

  var existingByKey = {};
  (existingRows || []).forEach(function (row) {
    existingByKey[row.native_key] = row;
  });

  var seenByKey = {};
  (seenRecords || []).forEach(function (rec) {
    seenByKey[rec.native_key] = rec;
  });

  var toInsert = [];
  var toRefresh = [];
  var toTransition = [];

  (seenRecords || []).forEach(function (rec) {
    var existing = existingByKey[rec.native_key];
    if (!existing) {
      toInsert.push({ native_key: rec.native_key, ci: rec.ci || null, status: 'active', consecutive_miss_count: 0 });
    } else {
      toRefresh.push({ native_key: rec.native_key, sys_id: existing.sys_id, ci: rec.ci || null, status: 'active', consecutive_miss_count: 0 });
    }
  });

  (existingRows || []).forEach(function (row) {
    if (seenByKey[row.native_key]) return; // already handled as a refresh above
    var next = options.computeNextState(row, false, threshold);
    toTransition.push({
      native_key: row.native_key,
      sys_id: row.sys_id,
      status: next.status,
      consecutive_miss_count: next.consecutive_miss_count,
      justRetired: next.status === 'retired' && row.status !== 'retired'
    });
  });

  return { toInsert: toInsert, toRefresh: toRefresh, toTransition: toTransition };
}

/**
 * @param {ReturnType<typeof planSyncStateUpdates>} plan
 * @returns {{insertCount: number, refreshCount: number, transitionCount: number, newlyRetiredCount: number}}
 */
function summarizePlan(plan) {
  return {
    insertCount: plan.toInsert.length,
    refreshCount: plan.toRefresh.length,
    transitionCount: plan.toTransition.length,
    newlyRetiredCount: plan.toTransition.filter(function (t) { return t.justRetired; }).length
  };
}

module.exports = {
  planSyncStateUpdates: planSyncStateUpdates,
  summarizePlan: summarizePlan
};
