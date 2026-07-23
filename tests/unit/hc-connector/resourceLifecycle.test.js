const { STATUS, DEFAULT_CONSECUTIVE_MISS_THRESHOLD, computeNextState, isRetired } =
  require('../../../servicenow/hc-connector/lib/resourceLifecycle');

describe('computeNextState', () => {
  it('resets to active with zero misses when seen this run, regardless of prior state', () => {
    expect(computeNextState(null, true)).toEqual({ status: STATUS.ACTIVE, consecutive_miss_count: 0 });
    expect(computeNextState({ status: STATUS.PENDING_RETIRE, consecutive_miss_count: 1 }, true))
      .toEqual({ status: STATUS.ACTIVE, consecutive_miss_count: 0 });
    expect(computeNextState({ status: STATUS.RETIRED, consecutive_miss_count: 5 }, true))
      .toEqual({ status: STATUS.ACTIVE, consecutive_miss_count: 0 });
  });

  it('treats a never-seen-before resource with no current row as active before its first miss', () => {
    // first sync ever, resource genuinely absent (e.g. mid-page failure) - starts the miss count from zero
    expect(computeNextState(undefined, false, 2)).toEqual({ status: STATUS.PENDING_RETIRE, consecutive_miss_count: 1 });
  });

  it('moves active -> pending_retire on the first miss (default threshold 2)', () => {
    const result = computeNextState({ status: STATUS.ACTIVE, consecutive_miss_count: 0 }, false);
    expect(result).toEqual({ status: STATUS.PENDING_RETIRE, consecutive_miss_count: 1 });
  });

  it('moves pending_retire -> retired once the threshold is reached', () => {
    const result = computeNextState({ status: STATUS.PENDING_RETIRE, consecutive_miss_count: 1 }, false, 2);
    expect(result).toEqual({ status: STATUS.RETIRED, consecutive_miss_count: 2 });
  });

  it('stays pending_retire while under a higher configured threshold', () => {
    const result = computeNextState({ status: STATUS.PENDING_RETIRE, consecutive_miss_count: 1 }, false, 3);
    expect(result).toEqual({ status: STATUS.PENDING_RETIRE, consecutive_miss_count: 2 });
  });

  it('retires immediately when threshold is 1', () => {
    const result = computeNextState({ status: STATUS.ACTIVE, consecutive_miss_count: 0 }, false, 1);
    expect(result).toEqual({ status: STATUS.RETIRED, consecutive_miss_count: 1 });
  });

  it('clamps a threshold below 1 to 1 (never infinite-loops on a bad config)', () => {
    const result = computeNextState({ status: STATUS.ACTIVE, consecutive_miss_count: 0 }, false, 0);
    expect(result).toEqual({ status: STATUS.RETIRED, consecutive_miss_count: 1 });
  });

  it('stays retired (and keeps counting) once already retired and still absent', () => {
    const result = computeNextState({ status: STATUS.RETIRED, consecutive_miss_count: 4 }, false, 2);
    expect(result).toEqual({ status: STATUS.RETIRED, consecutive_miss_count: 5 });
  });

  it('uses the documented default threshold when none is passed', () => {
    expect(DEFAULT_CONSECUTIVE_MISS_THRESHOLD).toBe(2);
    const oneMiss = computeNextState({ status: STATUS.ACTIVE, consecutive_miss_count: 0 }, false);
    expect(oneMiss.status).toBe(STATUS.PENDING_RETIRE);
    const twoMisses = computeNextState(oneMiss, false);
    expect(twoMisses.status).toBe(STATUS.RETIRED);
  });
});

describe('isRetired', () => {
  it('returns true only for a retired state', () => {
    expect(isRetired({ status: STATUS.RETIRED })).toBe(true);
    expect(isRetired({ status: STATUS.PENDING_RETIRE })).toBe(false);
    expect(isRetired({ status: STATUS.ACTIVE })).toBe(false);
    expect(isRetired(null)).toBe(false);
    expect(isRetired(undefined)).toBe(false);
  });
});
