/**
 * Pagination helpers for GET /v1/{project_id}/vpcs and /v1/{project_id}/subnets.
 *
 * Kept separate from lib/ecsPagination.js on purpose: the ECS list endpoint
 * uses `offset` as a page NUMBER, but Huawei's VPC service is
 * Neutron/OpenStack-derived and uses marker/cursor pagination instead
 * (`marker` = the last-seen item's id, response carries a `page_info.
 * next_marker` for the next call) - a genuinely different contract, not a
 * generalization of the same one. Unverified against this project's real
 * sandbox as of writing (see docs/ROADMAP.md's Phase 2B Step 0/2/3) -
 * confirm the real response shape against a live call before trusting this.
 */

/**
 * @param {string|null} marker - last-seen item id from the previous page's
 *   nextMarker, or null/undefined for the first page
 * @param {number} limit - page size
 * @returns {{limit: number, marker?: string}} query params for the next request - `marker` omitted entirely on the first page, not sent as empty/null
 */
function buildPageQuery(marker, limit) {
  var query = { limit: limit };
  if (marker) query.marker = marker;
  return query;
}

/**
 * @param {{pageItemCount: number, limit: number, nextMarker?: string|null}} args
 * @returns {boolean} whether another page should be fetched
 */
function shouldFetchNextPage({ pageItemCount, limit, nextMarker }) {
  if (!nextMarker) return false; // no next_marker in the response => this was the last page
  if (pageItemCount < limit) return false; // short/partial page => this was the last one, even if a stale marker was echoed back
  return true;
}

module.exports = { buildPageQuery, shouldFetchNextPage };
