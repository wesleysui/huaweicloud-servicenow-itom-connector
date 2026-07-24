/**
 * Pure mapping logic for RDS (Relational Database Service) discovery.
 *
 * CI class is `cmdb_ci_cloud_database`, ServiceNow's standard CMDB class
 * for cloud-managed database instances - real-PDI confirmed to exist on
 * this instance (a real MISSING_DEPENDENCY error named it).
 *
 * Field names are real, from Huawei's official RDS v3 API documentation
 * (ListInstances / GET /v3/{project_id}/instances), real-PDI confirmed
 * (fetch succeeded, `id`/`name`/`datastore`/`private_ips` all populated
 * as documented).
 *
 * CONTAINMENT: real OOTB rule confirmed via a real MISSING_DEPENDENCY
 * error: `cmdb_ci_cloud_database >> Hosted on >> cmdb_ci_logical_datacenter`
 * - the same `Hosted on::Hosts` pattern already proven for
 * VPC/Security Group/EVS/ELB. Each RDS instance relates to a FRESH,
 * locally-built `cmdb_ci_cloud_service_account`/`cmdb_ci_logical_datacenter`
 * placeholder pair (same pattern as EVS's/ELB's mapEvsToIRE.js/
 * mapElbToIRE.js, built independently here since RDS is discovered in its
 * own separate IRE call).
 *
 * `object_id` was included proactively (unlike the relation, this was a
 * low-risk, repeated pattern - see git history for the original
 * reasoning) and turned out to be right: no MISSING_MATCHING_ATTRIBUTES
 * error was hit, unlike ELB's first pass.
 */

var CI_CLASS_RDS = 'cmdb_ci_cloud_database';
var CI_CLASS_LOGICAL_DATACENTER = 'cmdb_ci_logical_datacenter';
var CI_CLASS_CLOUD_SERVICE_ACCOUNT = 'cmdb_ci_cloud_service_account';
var HOSTING_RELATION_TYPE = 'Hosted on::Hosts';

/**
 * Map one Huawei RDS instance object into an IRE `items[]` entry.
 * @param {Object} instance
 * @returns {Object}
 */
function mapRdsToIREItem(instance) {
  var datastore = instance.datastore || {};
  var privateIps = instance.private_ips || [];
  return {
    className: CI_CLASS_RDS,
    values: {
      name: instance.name || '',
      correlation_id: instance.id || '',
      object_id: instance.id || '',
      ip_address: privateIps[0] || '',
      short_description: 'Huawei Cloud RDS Instance (' + (datastore.type || '') + ' ' + (datastore.version || '') + ') - discovered via custom REST integration',
      discovery_source: 'Huawei Cloud Custom Discovery'
    }
  };
}

/**
 * Builds the placeholder cloud_service_account/logical_datacenter pair and
 * one item per RDS instance, all related via HOSTING_RELATION_TYPE,
 * mirroring mapEvsToIRE.js's/mapElbToIRE.js's same-named placeholders
 * (built independently here, not shared across the separate IRE calls).
 * @param {Object[]} instances
 * @param {string} region - used to identify the shared logical-datacenter placeholder
 * @param {string} accountId - used to identify the shared cloud-service-account placeholder
 * @returns {{items: Object[], relations: Object[]}}
 */
function buildIREPayload(instances, region, accountId) {
  instances = instances || [];

  var items = [];
  var relations = [];

  if (!instances.length) return { items: items, relations: relations };

  items.push({
    className: CI_CLASS_CLOUD_SERVICE_ACCOUNT,
    values: {
      name: 'Huawei Cloud Account - ' + accountId,
      account_id: accountId,
      datacenter_type: CI_CLASS_LOGICAL_DATACENTER,
      short_description: 'Placeholder representing the Huawei Cloud account for logical-datacenter containment relationships'
    }
  });
  var accountIndex = items.length - 1;

  items.push({
    className: CI_CLASS_LOGICAL_DATACENTER,
    values: {
      name: 'Huawei Cloud - ' + region,
      region: region,
      short_description: 'Placeholder representing the Huawei Cloud region for RDS containment relationships'
    }
  });
  var datacenterIndex = items.length - 1;
  relations.push({ parent: String(datacenterIndex), child: String(accountIndex), type: HOSTING_RELATION_TYPE });

  instances.forEach(function (instance) {
    items.push(mapRdsToIREItem(instance));
    var itemIndex = items.length - 1;
    relations.push({ parent: String(itemIndex), child: String(datacenterIndex), type: HOSTING_RELATION_TYPE });
  });

  return { items: items, relations: relations };
}

module.exports = {
  mapRdsToIREItem: mapRdsToIREItem,
  buildIREPayload: buildIREPayload,
  CI_CLASS_RDS: CI_CLASS_RDS,
  CI_CLASS_LOGICAL_DATACENTER: CI_CLASS_LOGICAL_DATACENTER,
  CI_CLASS_CLOUD_SERVICE_ACCOUNT: CI_CLASS_CLOUD_SERVICE_ACCOUNT,
  HOSTING_RELATION_TYPE: HOSTING_RELATION_TYPE
};
