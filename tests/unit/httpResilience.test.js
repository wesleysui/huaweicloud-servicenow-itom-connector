const { isRetryableStatus, shouldRetry, computeBackoffMs } = require('../../servicenow/discovery/lib/httpResilience');

describe('isRetryableStatus', () => {
  it.each([429, 500, 502, 503, 504])('treats %i as retryable', (code) => {
    expect(isRetryableStatus(code)).toBe(true);
  });

  it.each([200, 201, 400, 401, 403, 404])('treats %i as non-retryable', (code) => {
    expect(isRetryableStatus(code)).toBe(false);
  });
});

describe('shouldRetry', () => {
  it('retries a retryable status while under the attempt budget', () => {
    expect(shouldRetry(503, 0, 3)).toBe(true);
    expect(shouldRetry(503, 2, 3)).toBe(true);
  });

  it('stops once the attempt budget is exhausted', () => {
    expect(shouldRetry(503, 3, 3)).toBe(false);
  });

  it('never retries a non-retryable status regardless of attempt count', () => {
    expect(shouldRetry(400, 0, 3)).toBe(false);
  });
});

describe('computeBackoffMs', () => {
  it('doubles the base delay per attempt (jitter centered via random=0.5)', () => {
    const opts = { baseMs: 500, maxMs: 8000, random: () => 0.5 };
    expect(computeBackoffMs(0, opts)).toBe(500);
    expect(computeBackoffMs(1, opts)).toBe(1000);
    expect(computeBackoffMs(2, opts)).toBe(2000);
  });

  it('caps the delay at maxMs', () => {
    const opts = { baseMs: 500, maxMs: 8000, random: () => 0.5 };
    expect(computeBackoffMs(10, opts)).toBe(8000);
  });

  it('applies jitter within +/-10% of the exponential value', () => {
    const exponential = 1000; // attempt=1, baseMs=500
    const low = computeBackoffMs(1, { baseMs: 500, maxMs: 8000, random: () => 0 });
    const high = computeBackoffMs(1, { baseMs: 500, maxMs: 8000, random: () => 1 });
    expect(low).toBe(exponential - 100);
    expect(high).toBe(exponential + 100);
  });
});
