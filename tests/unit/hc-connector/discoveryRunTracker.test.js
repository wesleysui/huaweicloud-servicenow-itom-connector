const { MAX_ERROR_SUMMARY_LENGTH, startRun, finishRun, summarizeRun, toServiceNowDiscoveryRunFields } =
  require('../../../servicenow/hc-connector/lib/discoveryRunTracker');
const discoveryRunSchema = require('../../../servicenow/hc-connector/tables/hc_discovery_run.schema.json');

describe('startRun', () => {
  it('builds a running HC Discovery Run record from the given context', () => {
    const run = startRun({
      accountSysId: 'acct123',
      regionSysId: 'region456',
      resourceType: 'ecs',
      correlationId: 'corr-1',
      traceId: 'trace-1',
      dryRun: false,
      startedAtMs: 1000
    });
    expect(run).toEqual({
      account: 'acct123',
      region: 'region456',
      resource_type: 'ecs',
      state: 'running',
      started_at_ms: 1000,
      ended_at_ms: null,
      success_count: 0,
      fail_count: 0,
      error_summary: null,
      correlation_id: 'corr-1',
      trace_id: 'trace-1',
      dry_run: false
    });
  });

  it('defaults optional fields to null/false', () => {
    const run = startRun({ accountSysId: 'a', regionSysId: 'r', resourceType: 'ecs', startedAtMs: 0 });
    expect(run.correlation_id).toBeNull();
    expect(run.trace_id).toBeNull();
    expect(run.dry_run).toBe(false);
  });

  it.each(['accountSysId', 'regionSysId', 'resourceType'])('throws if %s is missing', (field) => {
    const args = { accountSysId: 'a', regionSysId: 'r', resourceType: 'ecs', startedAtMs: 0 };
    delete args[field];
    expect(() => startRun(args)).toThrow();
  });

  it('throws if startedAtMs is missing', () => {
    expect(() => startRun({ accountSysId: 'a', regionSysId: 'r', resourceType: 'ecs' })).toThrow(/startedAtMs/);
  });
});

describe('finishRun', () => {
  const started = () => startRun({ accountSysId: 'a', regionSysId: 'r', resourceType: 'ecs', startedAtMs: 1000 });

  it('marks a run with only successes as completed', () => {
    const finished = finishRun(started(), { successCount: 5, failCount: 0, endedAtMs: 2000 });
    expect(finished.state).toBe('completed');
    expect(finished.success_count).toBe(5);
    expect(finished.fail_count).toBe(0);
    expect(finished.ended_at_ms).toBe(2000);
  });

  it('marks a run with a mix of success and failure as completed (partial success)', () => {
    const finished = finishRun(started(), { successCount: 3, failCount: 1, endedAtMs: 2000 });
    expect(finished.state).toBe('completed');
  });

  it('marks a run with zero successes and at least one failure as failed', () => {
    const finished = finishRun(started(), { successCount: 0, failCount: 4, endedAtMs: 2000 });
    expect(finished.state).toBe('failed');
  });

  it('marks a run with zero successes and zero failures but an error summary as failed (fetch threw before any per-item counting)', () => {
    const finished = finishRun(started(), { successCount: 0, failCount: 0, errorSummary: 'AK/SK not configured', endedAtMs: 2000 });
    expect(finished.state).toBe('failed');
  });

  it('marks a run with zero successes, zero failures, and no error summary as completed (a real no-op)', () => {
    const finished = finishRun(started(), { successCount: 0, failCount: 0, endedAtMs: 2000 });
    expect(finished.state).toBe('completed');
  });

  it('truncates an overlong error summary to MAX_ERROR_SUMMARY_LENGTH', () => {
    const longSummary = 'x'.repeat(MAX_ERROR_SUMMARY_LENGTH + 500);
    const finished = finishRun(started(), { successCount: 0, failCount: 1, errorSummary: longSummary, endedAtMs: 2000 });
    expect(finished.error_summary).toHaveLength(MAX_ERROR_SUMMARY_LENGTH);
  });

  it('does not mutate the input runFields object', () => {
    const run = started();
    const original = { ...run };
    finishRun(run, { successCount: 1, failCount: 0, endedAtMs: 2000 });
    expect(run).toEqual(original);
  });

  it('throws without endedAtMs', () => {
    expect(() => finishRun(started(), { successCount: 1, failCount: 0 })).toThrow(/endedAtMs/);
  });
});

describe('summarizeRun', () => {
  it('computes total, success rate, and duration for a finished run', () => {
    const finished = finishRun(
      startRun({ accountSysId: 'a', regionSysId: 'r', resourceType: 'ecs', startedAtMs: 1000 }),
      { successCount: 3, failCount: 1, endedAtMs: 5500 }
    );
    expect(summarizeRun(finished)).toEqual({ total: 4, successRate: 0.75, durationMs: 4500 });
  });

  it('returns a null success rate for a run with zero total', () => {
    const run = startRun({ accountSysId: 'a', regionSysId: 'r', resourceType: 'ecs', startedAtMs: 1000 });
    expect(summarizeRun(run).successRate).toBeNull();
  });

  it('returns a null duration for a still-running (not yet ended) run', () => {
    const run = startRun({ accountSysId: 'a', regionSysId: 'r', resourceType: 'ecs', startedAtMs: 1000 });
    expect(summarizeRun(run).durationMs).toBeNull();
  });
});

describe('toServiceNowDiscoveryRunFields', () => {
  it('renames started_at_ms/ended_at_ms to started/ended, matching the schema field names exactly', () => {
    const finished = finishRun(
      startRun({ accountSysId: 'acct123', regionSysId: 'region456', resourceType: 'ecs', correlationId: 'c1', traceId: 't1', dryRun: true, startedAtMs: 1000 }),
      { successCount: 2, failCount: 1, errorSummary: 'boom', endedAtMs: 5000 }
    );
    expect(toServiceNowDiscoveryRunFields(finished)).toEqual({
      account: 'acct123',
      region: 'region456',
      resource_type: 'ecs',
      state: 'completed',
      started: 1000,
      ended: 5000,
      success_count: 2,
      fail_count: 1,
      error_summary: 'boom',
      correlation_id: 'c1',
      trace_id: 't1',
      dry_run: true
    });
  });

  it('leaves ended null for a still-running run rather than 0 or undefined', () => {
    const run = startRun({ accountSysId: 'a', regionSysId: 'r', resourceType: 'ecs', startedAtMs: 1000 });
    expect(toServiceNowDiscoveryRunFields(run).ended).toBeNull();
  });

  it('throws without runFields', () => {
    expect(() => toServiceNowDiscoveryRunFields()).toThrow(/runFields/);
  });

  it('regression: every output key is a real field on the hc_discovery_run schema (catches renames drifting out of sync again)', () => {
    const finished = finishRun(
      startRun({ accountSysId: 'a', regionSysId: 'r', resourceType: 'ecs', startedAtMs: 1000 }),
      { successCount: 1, failCount: 0, endedAtMs: 2000 }
    );
    const output = toServiceNowDiscoveryRunFields(finished);
    const schemaFieldNames = discoveryRunSchema.fields.map((f) => f.name);
    Object.keys(output).forEach((key) => {
      expect(schemaFieldNames).toContain(key);
    });
  });
});
