const { isTokenValid, DEFAULT_SKEW_SECONDS } = require('../../servicenow/discovery/lib/iamTokenCache');

const NOW = '2026-07-17T08:00:00Z';

describe('isTokenValid', () => {
  it('returns false when there is no cached token', () => {
    expect(isTokenValid(null, NOW)).toBe(false);
    expect(isTokenValid({}, NOW)).toBe(false);
  });

  it('returns true when the token expires well in the future', () => {
    const cached = { token: 'abc', expiresAt: '2026-07-18T08:00:00Z' };
    expect(isTokenValid(cached, NOW)).toBe(true);
  });

  it('returns false once inside the skew window before expiry', () => {
    const cached = { token: 'abc', expiresAt: '2026-07-17T08:04:00Z' }; // 4 min out, default skew is 5 min
    expect(isTokenValid(cached, NOW, DEFAULT_SKEW_SECONDS)).toBe(false);
  });

  it('returns false for an already-expired token', () => {
    const cached = { token: 'abc', expiresAt: '2026-07-17T07:00:00Z' };
    expect(isTokenValid(cached, NOW)).toBe(false);
  });

  it('returns false for a malformed expiresAt', () => {
    const cached = { token: 'abc', expiresAt: 'not-a-date' };
    expect(isTokenValid(cached, NOW)).toBe(false);
  });

  it('respects a custom skew window', () => {
    const cached = { token: 'abc', expiresAt: '2026-07-17T08:00:30Z' }; // 30s out
    expect(isTokenValid(cached, NOW, 60)).toBe(false); // 60s skew -> already "expired"
    expect(isTokenValid(cached, NOW, 10)).toBe(true);  // 10s skew -> still valid
  });
});
