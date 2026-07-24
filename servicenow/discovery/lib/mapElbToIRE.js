/**
 * Pure mapping logic for ELB (Elastic Load Balance, dedicated/v3) discovery.
 *
 * CI class is `cmdb_ci_cloud_load_balancer`, ServiceNow's standard CMDB
 * class for cloud load balancers - real-PDI confirmed to exist on this
 * instance (a real MISSING_DEPENDENCY error named it).
 *
 * Field names are real, from Huawei's official ELB v3 API documentation
 * (ListLoadBalancers / GET /v3/{project_id}/elb/loadbalancers), real-PDI
 * confirmed (fetch succeeded, `id`/`name`/`vip_address` all populated as
 * documented).
 *
 * CONTAINMENT: real OOTB rule confirmed via a real MISSING_DEPENDENCY
 * error: `cmdb_ci_cloud_load_balancer >> Hosted on >>
 * cmdb_ci_logical_datacenter` - the same `Hosted on::Hosts` pattern
 * already proven for VPC/Security Group/EVS, not the `vpc_id`-based
 * relation that field's presence might suggest (that was a real,
 * available option in the payload, but the real error named
 * `cmdb_ci_logical_datacenter` specifically, matching this project's
 * standing rule to let the real error decide rather than guess ahead of
 * it). Each load balancer relates to a FRESH, locally-built
 * `cmdb_ci_cloud_service_account`/`cmdb_ci_logical_datacenter` placeholder
 * pair (same pattern as EVS's `mapEvsToIRE.js`, built independently here
 * since ELB is discovered in its own separate IRE call).
 *
 * IDENTIFICATION: `cmdb_ci_cloud_load_balancer` has a real working OOTB
 * Identification Rule ("Cloud LoadBalancer Rule"), confirmed via a real
 * MISSING_MATCHING_ATTRIBUTES error naming it - it matches on `object_id`
 * specifically (SKIPPED with no value the first time this field was
 * omitted, same class of mistake already avoided for VPC/Subnet/Security
 * Group/EVS but missed here initially). `object_id` is set to the same
 * value as `correlation_id` (the real load balancer id), matching the
 * convention used everywhere else in this project except EIP (whose table
 * has no `object_id` field at all).
 */

var CI_CLASS_ELB = 'cmdb_ci_cloud_load_balancer';
var CI_CLASS_LOGICAL_DATACENTER = 'cmdb_ci_logical_datacenter';
var CI_CLASS_CLOUD_SERVICE_ACCOUNT = 'cmdb_ci_cloud_service_account';
var HOSTING_RELATION_TYPE = 'Hosted on::Hosts';

/**
 * Map one Huawei ELB load balancer object into an IRE `items[]` entry.
 * @param {Object} lb
 * @returns {Object}
 */
function mapElbToIREItem(lb) {
  return {
    className: CI_CLASS_ELB,
    values: {
      name: lb.name || '',
      correlation_id: lb.id || '',
      object_id: lb.id || '',
      ip_address: lb.vip_address || '',
      short_description: 'Huawei Cloud ELB Load Balancer - discovered via custom REST integration',
      discovery_source: 'Huawei Cloud Custom Discovery'
    }
  };
}

/**
 * Builds the placeholder cloud_service_account/logical_datacenter pair and
 * one item per load balancer, all related via HOSTING_RELATION_TYPE,
 * mirroring mapEvsToIRE.js's same-named placeholders (built independently
 * here, not shared across the separate IRE calls).
 * @param {Object[]} loadBalancers
 * @param {string} region - used to identify the shared logical-datacenter placeholder
 * @param {string} accountId - used to identify the shared cloud-service-account placeholder
 * @returns {{items: Object[], relations: Object[]}}
 */
function buildIREPayload(loadBalancers, region, accountId) {
  loadBalancers = loadBalancers || [];

  var items = [];
  var relations = [];

  if (!loadBalancers.length) return { items: items, relations: relations };

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
      short_description: 'Placeholder representing the Huawei Cloud region for ELB containment relationships'
    }
  });
  var datacenterIndex = items.length - 1;
  relations.push({ parent: String(datacenterIndex), child: String(accountIndex), type: HOSTING_RELATION_TYPE });

  loadBalancers.forEach(function (lb) {
    items.push(mapElbToIREItem(lb));
    var itemIndex = items.length - 1;
    relations.push({ parent: String(itemIndex), child: String(datacenterIndex), type: HOSTING_RELATION_TYPE });
  });

  return { items: items, relations: relations };
}

module.exports = {
  mapElbToIREItem: mapElbToIREItem,
  buildIREPayload: buildIREPayload,
  CI_CLASS_ELB: CI_CLASS_ELB,
  CI_CLASS_LOGICAL_DATACENTER: CI_CLASS_LOGICAL_DATACENTER,
  CI_CLASS_CLOUD_SERVICE_ACCOUNT: CI_CLASS_CLOUD_SERVICE_ACCOUNT,
  HOSTING_RELATION_TYPE: HOSTING_RELATION_TYPE
};
