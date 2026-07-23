const { buildPageQuery, shouldFetchNextPage } = require('../../servicenow/discovery/lib/ecsPagination');

describe('buildPageQuery', () => {
  it('builds an offset/limit query for a given page index', () => {
    expect(buildPageQuery(0, 100)).toEqual({ offset: 0, limit: 100 });
    expect(buildPageQuery(2, 100)).toEqual({ offset: 2, limit: 100 });
  });
});

describe('shouldFetchNextPage', () => {
  it('stops when the page came back short (last page)', () => {
    expect(shouldFetchNextPage({ pageServerCount: 37, limit: 100, totalFetched: 137, totalCount: 137 })).toBe(false);
  });

  it('continues when a full page was returned and more remain', () => {
    expect(shouldFetchNextPage({ pageServerCount: 100, limit: 100, totalFetched: 100, totalCount: 250 })).toBe(true);
  });

  it('stops once totalFetched reaches totalCount even on a full page', () => {
    expect(shouldFetchNextPage({ pageServerCount: 100, limit: 100, totalFetched: 200, totalCount: 200 })).toBe(false);
  });

  it('continues on a full page when totalCount is unknown', () => {
    expect(shouldFetchNextPage({ pageServerCount: 100, limit: 100, totalFetched: 100, totalCount: undefined })).toBe(true);
  });
});
