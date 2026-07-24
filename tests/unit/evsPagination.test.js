const { shouldFetchNextPage } = require('../../servicenow/discovery/lib/evsPagination');

describe('shouldFetchNextPage', () => {
  it('returns true when a full page came back (may be more)', () => {
    expect(shouldFetchNextPage({ pageVolumeCount: 100, limit: 100 })).toBe(true);
  });

  it('returns false when a short page came back (last page)', () => {
    expect(shouldFetchNextPage({ pageVolumeCount: 42, limit: 100 })).toBe(false);
  });

  it('returns false for an empty page', () => {
    expect(shouldFetchNextPage({ pageVolumeCount: 0, limit: 100 })).toBe(false);
  });

  it('returns true when the page count exceeds the limit (defensive, should not normally happen)', () => {
    expect(shouldFetchNextPage({ pageVolumeCount: 101, limit: 100 })).toBe(true);
  });
});
