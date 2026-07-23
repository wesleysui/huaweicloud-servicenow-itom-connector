const { planSyncStateUpdates, summarizePlan } = require('../../../servicenow/hc-connector/lib/syncStatePlanner');
const { computeNextState, STATUS } = require('../../../servicenow/hc-connector/lib/resourceLifecycle');

const opts = (threshold) => ({ computeNextState, consecutiveMissThreshold: threshold });

describe('planSyncStateUpdates', () => {
  it('plans a fresh insert for a resource never seen before', () => {
    const plan = planSyncStateUpdates([{ native_key: 'i-1', ci: 'ci-sysid-1' }], [], opts());
    expect(plan.toInsert).toEqual([{ native_key: 'i-1', ci: 'ci-sysid-1', status: 'active', consecutive_miss_count: 0 }]);
    expect(plan.toRefresh).toEqual([]);
    expect(plan.toTransition).toEqual([]);
  });

  it('plans a refresh (not a duplicate insert) for a resource seen again - this is the upsert guarantee', () => {
    const existing = [{ native_key: 'i-1', sys_id: 'sync-state-sysid-1', status: 'active', consecutive_miss_count: 0 }];
    const plan = planSyncStateUpdates([{ native_key: 'i-1', ci: 'ci-sysid-1' }], existing, opts());
    expect(plan.toInsert).toEqual([]);
    expect(plan.toRefresh).toEqual([{ native_key: 'i-1', sys_id: 'sync-state-sysid-1', ci: 'ci-sysid-1', status: 'active', consecutive_miss_count: 0 }]);
  });

  it('refreshes correctly even from a pending_retire state (resource reappeared)', () => {
    const existing = [{ native_key: 'i-1', sys_id: 's1', status: 'pending_retire', consecutive_miss_count: 1 }];
    const plan = planSyncStateUpdates([{ native_key: 'i-1' }], existing, opts());
    expect(plan.toRefresh[0]).toEqual({ native_key: 'i-1', sys_id: 's1', ci: null, status: 'active', consecutive_miss_count: 0 });
  });

  it('plans a lifecycle transition for a row that existed but was not seen this run', () => {
    const existing = [{ native_key: 'i-gone', sys_id: 's2', status: 'active', consecutive_miss_count: 0 }];
    const plan = planSyncStateUpdates([], existing, opts(2));
    expect(plan.toTransition).toEqual([
      { native_key: 'i-gone', sys_id: 's2', status: STATUS.PENDING_RETIRE, consecutive_miss_count: 1, justRetired: false }
    ]);
  });

  it('flags justRetired only on the transition INTO retired, not while already retired', () => {
    const existing = [{ native_key: 'i-gone', sys_id: 's2', status: 'pending_retire', consecutive_miss_count: 1 }];
    const plan = planSyncStateUpdates([], existing, opts(2));
    expect(plan.toTransition[0].status).toBe(STATUS.RETIRED);
    expect(plan.toTransition[0].justRetired).toBe(true);

    const alreadyRetired = [{ native_key: 'i-gone', sys_id: 's2', status: 'retired', consecutive_miss_count: 3 }];
    const plan2 = planSyncStateUpdates([], alreadyRetired, opts(2));
    expect(plan2.toTransition[0].status).toBe(STATUS.RETIRED);
    expect(plan2.toTransition[0].justRetired).toBe(false);
  });

  it('handles a mixed batch: some new, some refreshed, some transitioning, in one call', () => {
    const existing = [
      { native_key: 'i-existing', sys_id: 's1', status: 'active', consecutive_miss_count: 0 },
      { native_key: 'i-missing', sys_id: 's2', status: 'active', consecutive_miss_count: 0 }
    ];
    const seen = [
      { native_key: 'i-existing', ci: 'ci-1' },
      { native_key: 'i-new', ci: 'ci-2' }
    ];
    const plan = planSyncStateUpdates(seen, existing, opts(2));
    expect(plan.toInsert.map((r) => r.native_key)).toEqual(['i-new']);
    expect(plan.toRefresh.map((r) => r.native_key)).toEqual(['i-existing']);
    expect(plan.toTransition.map((r) => r.native_key)).toEqual(['i-missing']);
  });

  it('regression: never lets an unseen row silently vanish - every existing row not seen this run gets a transition entry', () => {
    const existing = Array.from({ length: 5 }, (_, i) => ({ native_key: `i-${i}`, sys_id: `s${i}`, status: 'active', consecutive_miss_count: 0 }));
    const plan = planSyncStateUpdates([], existing, opts(2));
    expect(plan.toTransition).toHaveLength(5);
  });

  it('throws without options.computeNextState (dependency injection is mandatory, not silently defaulted)', () => {
    expect(() => planSyncStateUpdates([], [], {})).toThrow(/computeNextState/);
    expect(() => planSyncStateUpdates([], [])).toThrow(/computeNextState/);
  });

  it('handles empty seenRecords and empty existingRows without throwing', () => {
    expect(planSyncStateUpdates([], [], opts())).toEqual({ toInsert: [], toRefresh: [], toTransition: [] });
    expect(planSyncStateUpdates(undefined, undefined, opts())).toEqual({ toInsert: [], toRefresh: [], toTransition: [] });
  });
});

describe('summarizePlan', () => {
  it('counts each bucket plus newly-retired within transitions', () => {
    const plan = {
      toInsert: [{}, {}],
      toRefresh: [{}],
      toTransition: [{ justRetired: true }, { justRetired: false }, { justRetired: true }]
    };
    expect(summarizePlan(plan)).toEqual({ insertCount: 2, refreshCount: 1, transitionCount: 3, newlyRetiredCount: 2 });
  });
});
