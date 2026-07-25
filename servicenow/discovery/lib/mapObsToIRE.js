/**
 * Pure mapping logic for OBS (Object Storage Service) bucket discovery.
 *
 * CI class is `x_2021019_huawei_0_huawei_cloud_obs_bucket` - a dedicated
 * class this project's own scoped app owns, NOT a borrowed platform
 * class. This followed the same real investigation this project applies
 * everywhere else, not a shortcut:
 *
 * 1. A more specific object-storage CI class was researched and expected
 *    to exist, but doesn't on this instance - a real `sys_db_object`
 *    query confirmed zero results, and two follow-up plugin installs
 *    (Service Mapping, then CMDB CI Class Models) both left it missing; a
 *    real `sys_plugins` query afterward found neither plugin installed
 *    under those names either. A couple of even more specific,
 *    vendor-named bucket class candidates were also checked and don't
 *    exist - those ship with a separate, dedicated connector product,
 *    out of scope for this project to depend on.
 * 2. The two remaining real, already-existing generic candidates were
 *    both checked field-by-field and rejected on real semantic grounds,
 *    not preference: `cmdb_ci_cloud_storage_account` is shaped like a
 *    multi-service storage-account bundle (real `blob_service`/
 *    `file_service`/`queue_service`/`table_service` fields bundling four
 *    service types under one resource) - a real structural mismatch for
 *    Huawei OBS, which is flat (one bucket = one top-level resource, no
 *    account tier). `cmdb_ci_storage_container` looked promising by name
 *    but its real fields (`total_size`/`used_size`/`available_size`/
 *    `controller`/`controller_type`) are SAN/NAS block-storage shaped,
 *    not cloud object storage.
 * 3. Given neither real existing class fit, and a dedicated class is the
 *    standard way to model a resource type with no clean generic fit
 *    rather than reusing a mismatched one, this project built its own:
 *    `x_2021019_huawei_0_huawei_cloud_obs_bucket`, created via Studio,
 *    extending `cmdb_ci` directly (the cleanest available base - a more
 *    specific `cmdb_ci_cloud_resource_base` ancestor exists and would
 *    have been preferred, but wasn't extendable from this scoped app in
 *    Studio's table-creation UI - real-PDI observed, not a guess).
 *    A manual Independent Identification Rule (criterion attribute
 *    `correlation_id`) was created via CI Class Manager, the same
 *    approach already proven for VPC/Subnet in Phase 2B (neither had an
 *    OOTB rule either).
 *
 * Scope: BUCKETS ONLY, never per-object discovery (a bucket can hold
 * millions of objects - object-level discovery is explicitly out of
 * scope for this project, permanently, not just "not yet built" - see
 * docs/RESOURCE-MATRIX.md).
 *
 * Input shape comes from lib/parseObsBucketsXml.js's parseBucketsXml()
 * output ({name, creationDate, location, bucketType}), not the raw XML -
 * this file only handles the IRE mapping, XML parsing is a separate
 * concern. Bucket names are the natural unique key (Huawei enforces
 * global bucket-name uniqueness per-partition) - used as both `name` and
 * `correlation_id`, there's no separate UUID like every other resource
 * type in this project has. No `object_id` - this class extends plain
 * `cmdb_ci`, which doesn't have that field (unlike the cloud-specific
 * classes used elsewhere in this project).
 *
 * No relations attempted in this first version - a brand-new class has
 * no OOTB containment/hosting rule registered at all, so this project's
 * established "let the real error decide" process may not even surface
 * one here; confirm on first real-PDI run.
 */

var CI_CLASS_OBS = 'x_2021019_huawei_0_huawei_cloud_obs_bucket';

/**
 * Map one parsed OBS bucket object into an IRE `items[]` entry.
 * @param {{name: string, creationDate?: string, location?: string, bucketType?: string}} bucket
 * @returns {Object}
 */
function mapObsToIREItem(bucket) {
  return {
    className: CI_CLASS_OBS,
    values: {
      name: bucket.name || '',
      correlation_id: bucket.name || '',
      short_description: 'Huawei Cloud OBS Bucket - discovered via custom REST integration',
      discovery_source: 'Huawei Cloud Custom Discovery'
    }
  };
}

/**
 * Builds one item per bucket, no relations (see this file's header
 * comment - the real containment rule isn't known yet).
 * @param {Object[]} buckets
 * @returns {{items: Object[], relations: Object[]}}
 */
function buildIREPayload(buckets) {
  buckets = buckets || [];
  var items = buckets.map(mapObsToIREItem);
  return { items: items, relations: [] };
}

module.exports = {
  mapObsToIREItem: mapObsToIREItem,
  buildIREPayload: buildIREPayload,
  CI_CLASS_OBS: CI_CLASS_OBS
};
