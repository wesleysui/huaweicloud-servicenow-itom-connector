/**
 * Pure pending_retire -> retired lifecycle state machine for HC Resource
 * Sync State rows. No ServiceNow dependency - the platform-side wrapper
 * (Phase 2+) just reads the current row, calls computeNextState(), and
 * writes the result back.
 */

var STATUS = {
  ACTIVE: 'active',
  PENDING_RETIRE: 'pending_retire',
  RETIRED: 'retired'
};

var DEFAULT_CONSECUTIVE_MISS_THRESHOLD = 2;

/**
 * @param {{status?: string, consecutive_miss_count?: number}|null|undefined} current - the existing HC Resource Sync State row, or falsy if this is the first time this native_key has ever been seen
 * @param {boolean} seenThisRun - was this resource present in the current full sync?
 * @param {number} [consecutiveMissThreshold] - consecutive misses required to move pending_retire -> retired (default 2)
 * @returns {{status: string, consecutive_miss_count: number}}
 */
function computeNextState(current, seenThisRun, consecutiveMissThreshold) {
  var threshold = consecutiveMissThreshold == null ? DEFAULT_CONSECUTIVE_MISS_THRESHOLD : consecutiveMissThreshold;
  if (threshold < 1) threshold = 1;

  var currentStatus = (current && current.status) || STATUS.ACTIVE;
  var currentMissCount = (current && current.consecutive_miss_count) || 0;

  if (seenThisRun) {
    return { status: STATUS.ACTIVE, consecutive_miss_count: 0 };
  }

  var nextMissCount = currentMissCount + 1;

  if (currentStatus === STATUS.RETIRED) {
    // Already retired and still absent - stays retired, keep counting for audit purposes.
    return { status: STATUS.RETIRED, consecutive_miss_count: nextMissCount };
  }

  if (nextMissCount >= threshold) {
    return { status: STATUS.RETIRED, consecutive_miss_count: nextMissCount };
  }

  return { status: STATUS.PENDING_RETIRE, consecutive_miss_count: nextMissCount };
}

/**
 * @param {{status?: string}} state
 * @returns {boolean}
 */
function isRetired(state) {
  return !!state && state.status === STATUS.RETIRED;
}

module.exports = {
  STATUS: STATUS,
  DEFAULT_CONSECUTIVE_MISS_THRESHOLD: DEFAULT_CONSECUTIVE_MISS_THRESHOLD,
  computeNextState: computeNextState,
  isRetired: isRetired
};
