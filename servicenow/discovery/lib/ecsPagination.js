/**
 * Pagination helpers for GET /v1/{project_id}/cloudservers/detail.
 *
 * Huawei's `offset` param on this endpoint is a page NUMBER (0-based), not a
 * row offset — page N skips `N * limit` records. This is easy to get wrong
 * (many Huawei/OpenStack-derived list APIs use a raw row offset instead), so
 * it's called out explicitly and covered by a unit test.
 */

/**
 * @param {number} pageIndex - 0-based page number
 * @param {number} limit - page size
 * @returns {{offset: number, limit: number}} query params for the next request
 */
function buildPageQuery(pageIndex, limit) {
  return { offset: pageIndex, limit };
}

/**
 * @param {{pageServerCount: number, limit: number, totalFetched: number, totalCount?: number}} args
 * @returns {boolean} whether another page should be fetched
 */
function shouldFetchNextPage({ pageServerCount, limit, totalFetched, totalCount }) {
  if (pageServerCount < limit) return false; // short/partial page => this was the last one
  if (typeof totalCount === 'number' && totalFetched >= totalCount) return false;
  return true;
}

module.exports = { buildPageQuery, shouldFetchNextPage };
