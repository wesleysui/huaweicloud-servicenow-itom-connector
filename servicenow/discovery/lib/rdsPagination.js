/**
 * Pagination helpers for GET /v3/{project_id}/instances.
 *
 * Huawei's `offset` param on this endpoint is a row INDEX (per the
 * official docs' own wording: "the query starts from the next piece of
 * data indexed by this parameter"), not a page number like ECS's - but
 * unlike EVS's endpoint, the response DOES carry a real `total_count`
 * field. A genuine hybrid of both prior pagination styles in this
 * project, not a copy of either - stops on either a short page or when
 * total_count is reached, whichever comes first. Unverified against this
 * project's real sandbox as of writing - confirm the real response shape
 * against a live call before trusting this.
 */

/**
 * @param {number} offset - row offset for the next request (0 for the first page)
 * @param {number} limit - page size
 * @returns {{offset: number, limit: number}} query params for the next request
 */
function buildPageQuery(offset, limit) {
  return { offset: offset, limit: limit };
}

/**
 * @param {{pageInstanceCount: number, limit: number, totalFetched: number, totalCount?: number}} args
 * @returns {boolean} whether another page should be fetched
 */
function shouldFetchNextPage({ pageInstanceCount, limit, totalFetched, totalCount }) {
  if (pageInstanceCount < limit) return false; // short/partial page => this was the last one
  if (typeof totalCount === 'number' && totalFetched >= totalCount) return false;
  return true;
}

module.exports = { buildPageQuery, shouldFetchNextPage };
