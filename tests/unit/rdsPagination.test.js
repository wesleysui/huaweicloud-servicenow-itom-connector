const { buildPageQuery, shouldFetchNextPage } = require('../../servicenow/discovery/lib/rdsPagination');

describe('buildPageQuery', () => {
  it('builds offset/limit query params', () => {
    expect(buildPageQuery(0, 100)).toEqual({ offset: 0, limit: 100 });
    expect(buildPageQuery(100, 100)).toEqual({ offset: 100, limit: 100 });
  });
});

describe('shouldFetchNextPage', () => {
  it('stops on a short page', () => {
    expect(shouldFetchNextPage({ pageInstanceCount: 5, limit: 100, totalFetched: 5 })).toBe(false);
  });

  it('continues on a full page with no totalCount known', () => {
    expect(shouldFetchNextPage({ pageInstanceCount: 100, limit: 100, totalFetched: 100 })).toBe(true);
  });

  it('stops once totalCount is reached, even on a full page', () => {
    expect(shouldFetchNextPage({ pageInstanceCount: 100, limit: 100, totalFetched: 100, totalCount: 100 })).toBe(false);
  });

  it('continues when totalCount is known but not yet reached', () => {
    expect(shouldFetchNextPage({ pageInstanceCount: 100, limit: 100, totalFetched: 100, totalCount: 250 })).toBe(true);
  });
});
