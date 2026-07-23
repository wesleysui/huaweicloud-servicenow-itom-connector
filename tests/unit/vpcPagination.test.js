const { buildPageQuery, shouldFetchNextPage } = require('../../servicenow/discovery/lib/vpcPagination');

describe('buildPageQuery', () => {
  it('omits marker entirely on the first page', () => {
    expect(buildPageQuery(null, 100)).toEqual({ limit: 100 });
    expect(buildPageQuery(undefined, 100)).toEqual({ limit: 100 });
  });

  it('includes marker when given', () => {
    expect(buildPageQuery('9f8e7d6c-5b4a-3210-9876-543210fedcba', 100)).toEqual({
      limit: 100,
      marker: '9f8e7d6c-5b4a-3210-9876-543210fedcba'
    });
  });
});

describe('shouldFetchNextPage', () => {
  it('stops when the response has no next_marker', () => {
    expect(shouldFetchNextPage({ pageItemCount: 100, limit: 100, nextMarker: null })).toBe(false);
    expect(shouldFetchNextPage({ pageItemCount: 100, limit: 100, nextMarker: undefined })).toBe(false);
  });

  it('continues when a full page was returned and a next_marker is present', () => {
    expect(shouldFetchNextPage({ pageItemCount: 100, limit: 100, nextMarker: 'abc-123' })).toBe(true);
  });

  it('stops on a short/partial page even if a marker is echoed back', () => {
    expect(shouldFetchNextPage({ pageItemCount: 37, limit: 100, nextMarker: 'stale-marker' })).toBe(false);
  });
});
