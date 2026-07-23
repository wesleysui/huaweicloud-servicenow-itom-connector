/**
 * Pure helpers for building HC Discovery Run field sets. Time values are
 * plain epoch-millisecond numbers, not formatted date strings - keeps this
 * module honestly platform-agnostic. The platform-side wrapper (Phase 2+)
 * is responsible for converting to/from GlideDateTime (see the epoch-millis
 * handling already proven in servicenow/event-management/webhook-scripted-rest.js).
 */

var MAX_ERROR_SUMMARY_LENGTH = 4000;

/**
 * @param {{accountSysId: string, regionSysId: string, resourceType: string, correlationId?: string, traceId?: string, dryRun?: boolean, startedAtMs: number}} args
 */
function startRun(args) {
  if (!args || !args.accountSysId) throw new Error('accountSysId is required');
  if (!args.regionSysId) throw new Error('regionSysId is required');
  if (!args.resourceType) throw new Error('resourceType is required');
  if (args.startedAtMs == null) throw new Error('startedAtMs is required');

  return {
    account: args.accountSysId,
    region: args.regionSysId,
    resource_type: args.resourceType,
    state: 'running',
    started_at_ms: args.startedAtMs,
    ended_at_ms: null,
    success_count: 0,
    fail_count: 0,
    error_summary: null,
    correlation_id: args.correlationId || null,
    trace_id: args.traceId || null,
    dry_run: !!args.dryRun
  };
}

/**
 * @param {ReturnType<typeof startRun>} runFields
 * @param {{successCount: number, failCount: number, errorSummary?: string, endedAtMs: number}} outcome
 */
function finishRun(runFields, outcome) {
  if (!runFields) throw new Error('runFields is required');
  if (!outcome || outcome.endedAtMs == null) throw new Error('endedAtMs is required');

  var successCount = outcome.successCount || 0;
  var failCount = outcome.failCount || 0;
  // A run that fails before any per-item counting happens (e.g. a fetch
  // throwing on the very first call) reports successCount:0, failCount:0 -
  // errorSummary is the only signal that it wasn't actually a no-op success,
  // so it must also flip the state to 'failed', not just failCount alone.
  var state = (successCount === 0 && (failCount > 0 || !!outcome.errorSummary)) ? 'failed' : 'completed';

  var summary = outcome.errorSummary || null;
  if (summary && summary.length > MAX_ERROR_SUMMARY_LENGTH) {
    summary = summary.slice(0, MAX_ERROR_SUMMARY_LENGTH);
  }

  var result = {};
  for (var k in runFields) { if (Object.prototype.hasOwnProperty.call(runFields, k)) result[k] = runFields[k]; }
  result.state = state;
  result.ended_at_ms = outcome.endedAtMs;
  result.success_count = successCount;
  result.fail_count = failCount;
  result.error_summary = summary;
  return result;
}

/**
 * @param {ReturnType<typeof finishRun>} runFields
 * @returns {{total: number, successRate: number|null, durationMs: number|null}}
 */
function summarizeRun(runFields) {
  var total = (runFields.success_count || 0) + (runFields.fail_count || 0);
  var durationMs = null;
  if (runFields.ended_at_ms != null && runFields.started_at_ms != null) {
    durationMs = runFields.ended_at_ms - runFields.started_at_ms;
  }
  return {
    total: total,
    successRate: total === 0 ? null : runFields.success_count / total,
    durationMs: durationMs
  };
}

/**
 * Maps startRun()/finishRun() output onto the exact field names declared in
 * tables/hc_discovery_run.schema.json (`started`/`ended`, not
 * `started_at_ms`/`ended_at_ms`) - the internal `_at_ms` names exist only
 * to keep this module's own math unambiguous. The returned `started`/`ended`
 * values are STILL epoch-millisecond numbers, not GlideDateTime objects or
 * formatted strings - the ServiceNow-side platform wrapper must still run
 * them through `GlideDateTime.setNumericValue()` before assigning to the
 * GlideRecord field, exactly like the already-proven pattern in
 * servicenow/event-management/webhook-scripted-rest.js's time handling.
 * @param {ReturnType<typeof startRun>|ReturnType<typeof finishRun>} runFields
 * @returns {{account: string, region: string, resource_type: string, state: string, started: number, ended: number|null, success_count: number, fail_count: number, error_summary: string|null, correlation_id: string|null, trace_id: string|null, dry_run: boolean}}
 */
function toServiceNowDiscoveryRunFields(runFields) {
  if (!runFields) throw new Error('runFields is required');
  return {
    account: runFields.account,
    region: runFields.region,
    resource_type: runFields.resource_type,
    state: runFields.state,
    started: runFields.started_at_ms,
    ended: runFields.ended_at_ms != null ? runFields.ended_at_ms : null,
    success_count: runFields.success_count,
    fail_count: runFields.fail_count,
    error_summary: runFields.error_summary,
    correlation_id: runFields.correlation_id,
    trace_id: runFields.trace_id,
    dry_run: runFields.dry_run
  };
}

module.exports = {
  MAX_ERROR_SUMMARY_LENGTH: MAX_ERROR_SUMMARY_LENGTH,
  startRun: startRun,
  finishRun: finishRun,
  summarizeRun: summarizeRun,
  toServiceNowDiscoveryRunFields: toServiceNowDiscoveryRunFields
};
