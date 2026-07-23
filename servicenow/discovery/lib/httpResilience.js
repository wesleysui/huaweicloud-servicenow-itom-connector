/**
 * Generic retry/backoff helpers for calling Huawei Cloud REST APIs.
 * Deliberately generic (not ECS-specific) so the upcoming EVS/EIP/RDS
 * discovery modules can reuse the same resilience logic instead of each
 * reimplementing it (see docs/ROADMAP.md).
 */

const RETRYABLE_STATUS_CODES = [429, 500, 502, 503, 504];

/**
 * @param {number} statusCode
 * @returns {boolean} true if the response is safe to retry (rate limit / transient server error)
 */
function isRetryableStatus(statusCode) {
  return RETRYABLE_STATUS_CODES.includes(statusCode);
}

/**
 * @param {number} statusCode
 * @param {number} attempt - 0-based attempt count already made
 * @param {number} maxAttempts
 * @returns {boolean}
 */
function shouldRetry(statusCode, attempt, maxAttempts = 3) {
  return isRetryableStatus(statusCode) && attempt < maxAttempts;
}

/**
 * Exponential backoff with +/-10% jitter, capped at maxMs.
 * `random` is injectable so tests can be deterministic.
 * @param {number} attempt - 0-based attempt number
 * @param {{baseMs?: number, maxMs?: number, random?: () => number}} [options]
 * @returns {number} delay in milliseconds
 */
function computeBackoffMs(attempt, options = {}) {
  const baseMs = options.baseMs ?? 500;
  const maxMs = options.maxMs ?? 8000;
  const random = options.random ?? Math.random;

  const exponential = Math.min(maxMs, baseMs * Math.pow(2, attempt));
  const jitterRange = exponential * 0.2;
  return Math.round(exponential - jitterRange / 2 + random() * jitterRange);
}

module.exports = { isRetryableStatus, shouldRetry, computeBackoffMs, RETRYABLE_STATUS_CODES };
