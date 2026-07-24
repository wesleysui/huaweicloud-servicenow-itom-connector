/**
 * Pagination helpers for GET /v3/{project_id}/volumes/detail.
 *
 * Kept separate from ecsPagination.js/vpcPagination.js: Huawei's EVS API
 * (per official docs) supports `limit`/`offset` (like ECS) AND `marker`
 * (like VPC), but its response carries neither a total `count` (like ECS)
 * nor a `page_info.next_marker` (like VPC) - only a `volumes_links` array
 * with a "next" href to follow. Parsing that href just to extract the next
 * offset/marker is unnecessary complexity for a value we can compute
 * ourselves - this uses plain offset increment instead, stopping once a
 * short page (fewer than `limit` items) comes back, the simplest of the
 * three stop conditions already used in this project.
 */

/**
 * @param {{pageVolumeCount: number, limit: number}} args
 * @returns {boolean} whether another page should be fetched
 */
function shouldFetchNextPage({ pageVolumeCount, limit }) {
  return pageVolumeCount >= limit; // a short/partial page means this was the last one
}

module.exports = { shouldFetchNextPage };
