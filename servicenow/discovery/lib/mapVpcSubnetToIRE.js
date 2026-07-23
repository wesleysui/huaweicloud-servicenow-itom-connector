/**
 * Pure mapping logic for VPC/Subnet discovery, mirrored inline in
 * HuaweiVpcDiscovery.js the same way mapEcsToIRE.js is mirrored in
 * HuaweiECSDiscovery.js (ServiceNow scoped scripts cannot require()
 * external modules - keep both in sync when changing the mapping rules).
 *
 * Deliberate improvement over the ECS precedent: mapEcsToIRE.js's
 * buildIREPayload() only returns {items} - ECS's relations[] construction
 * lives only inline in HuaweiECSDiscovery.js, never unit-tested in pure
 * Node. Here buildIREPayload() also builds relations[], making the
 * containment-relation logic itself unit-testable for the first time in
 * this project.
 *
 * CI classes confirmed via real-PDI testing (docs/REAL-PDI-REPLAY-
 * CHECKLIST.md's Phase 2B addendum), through 4 rounds of real errors - the
 * full containment chain ServiceNow's OOTB CSDM model expects turned out
 * to be:
 *   cmdb_ci_cloud_service_account --Hosted on::Hosts--> cmdb_ci_logical_datacenter
 *   --Hosted on::Hosts--> cmdb_ci_network --Contains::Contained by--> cmdb_ci_cloud_subnet
 *
 * Round 1: guessed cmdb_ci_vpc ("Virtual Private Cloud") + generic
 * cmdb_ci_ip_network - wrong on both; real classes are cmdb_ci_network
 * ("Cloud Network") and cmdb_ci_cloud_subnet ("Cloud Subnet"), neither of
 * which had a configured Identification Rule (fixed by hand: Independent,
 * criterion attribute = correlation_id, for both).
 * Round 2: cmdb_ci_cloud_subnet's OOTB containment rule required its
 * parent to be specifically cmdb_ci_network, not cmdb_ci_vpc (no
 * inheritance relationship between the two) - switched CI_CLASS_VPC to
 * cmdb_ci_network.
 * Round 3: cmdb_ci_network itself turned out to have its OWN containment
 * requirement - a cmdb_ci_logical_datacenter parent via "Hosted on::Hosts"
 * (confirmed via cmdb_rel_type). Added a placeholder
 * cmdb_ci_logical_datacenter item, one per run, identified by `region` (a
 * real, pre-existing Identifier Entry - Dependent rule, Object ID or
 * Region, priority-ordered).
 * Round 4: cmdb_ci_logical_datacenter turned out to have its OWN
 * containment requirement too - a cmdb_ci_cloud_service_account parent via
 * "Hosted on::Hosts". Unlike the other three, cmdb_ci_cloud_service_account
 * has an Independent Identification Rule (Object ID or Account Id,
 * priority-ordered) - it's the top of the chain, no further parent needed.
 * Identified here by `accountId` (HC Cloud Account.account_id) to match
 * the real "Account Id" identifier entry directly.
 *
 * All three placeholder levels (cloud_service_account, logical_datacenter)
 * are shared once per run (one per account/region, not one per VPC),
 * mirroring HuaweiECSDiscovery.js's single shared virtualization-server
 * placeholder pattern - only cmdb_ci_network/cmdb_ci_cloud_subnet get a
 * real N:M relation set (each subnet's vpc_id maps to its OWN parent VPC's
 * item index).
 *
 * Field selection (correlation_id/object_id/cidr/gateway) is based on the
 * real sys_dictionary field list for each class, not guessed -
 * cmdb_ci_network has no object_id or cidr field (dropped here),
 * cmdb_ci_cloud_subnet has both plus cidr/gateway. Update both this file
 * and its HuaweiVpcDiscovery.js mirror together if any of this needs
 * revising further.
 */

var CI_CLASS_VPC = 'cmdb_ci_network';
var CI_CLASS_SUBNET = 'cmdb_ci_cloud_subnet';
var CI_CLASS_LOGICAL_DATACENTER = 'cmdb_ci_logical_datacenter';
var CI_CLASS_CLOUD_SERVICE_ACCOUNT = 'cmdb_ci_cloud_service_account';
var CONTAINMENT_RELATION_TYPE = 'Contains::Contained by';
var HOSTING_RELATION_TYPE = 'Hosted on::Hosts';

/**
 * Map one Huawei VPC object (from GET /v1/{project_id}/vpcs) into an IRE
 * `items[]` entry.
 * @param {Object} vpc
 * @returns {Object}
 */
function mapVpcToIREItem(vpc) {
  return {
    className: CI_CLASS_VPC,
    values: {
      name: vpc.name,
      correlation_id: vpc.id,
      short_description: 'Huawei Cloud VPC - discovered via custom REST integration',
      discovery_source: 'Huawei Cloud Custom Discovery'
      // object_id/cidr omitted, carried over from the cmdb_ci_vpc field
      // check - NOT independently re-confirmed for cmdb_ci_network's own
      // sys_dictionary. If a real fetch silently drops other fields here,
      // check sys_dictionary for cmdb_ci_network directly rather than
      // assuming this list is complete.
    }
  };
}

/**
 * Map one Huawei Subnet object (from GET /v1/{project_id}/subnets) into an
 * IRE `items[]` entry.
 * @param {Object} subnet
 * @returns {Object}
 */
function mapSubnetToIREItem(subnet) {
  return {
    className: CI_CLASS_SUBNET,
    values: {
      name: subnet.name,
      correlation_id: subnet.id,
      object_id: subnet.id,
      cidr: subnet.cidr,
      gateway: subnet.gateway_ip,
      short_description: 'Huawei Cloud Subnet - discovered via custom REST integration',
      discovery_source: 'Huawei Cloud Custom Discovery'
    }
  };
}

/**
 * Builds the shared placeholder cmdb_ci_logical_datacenter IRE item that
 * every VPC (cmdb_ci_network) item in this run is related to via
 * HOSTING_RELATION_TYPE - one per run, not one per VPC. Identified by
 * `region` (a real, pre-existing Identifier Entry on this class on the
 * real instance - confirmed via CI Class Manager).
 * @param {string} region
 * @returns {Object}
 */
function mapLogicalDatacenterPlaceholder(region) {
  return {
    className: CI_CLASS_LOGICAL_DATACENTER,
    values: {
      name: 'Huawei Cloud - ' + region,
      region: region,
      short_description: 'Placeholder representing the Huawei Cloud region for VPC/network containment relationships'
    }
  };
}

/**
 * Builds the shared placeholder cmdb_ci_cloud_service_account IRE item -
 * the top of the containment chain, one per run. Identified by `accountId`
 * (a real, pre-existing "Account Id" Identifier Entry on this class -
 * confirmed via CI Class Manager), matching HC Cloud Account.account_id.
 * @param {string} accountId
 * @returns {Object}
 */
function mapCloudServiceAccountPlaceholder(accountId) {
  return {
    className: CI_CLASS_CLOUD_SERVICE_ACCOUNT,
    values: {
      name: 'Huawei Cloud Account - ' + accountId,
      account_id: accountId,
      // datacenter_type is a mandatory `table_name`-type field (confirmed
      // via real-PDI testing: REQUIRED_ATTRIBUTE_EMPTY without it) - tells
      // ServiceNow's polymorphic cloud model which CI class represents the
      // datacenters under this account. Set to CI_CLASS_LOGICAL_DATACENTER
      // since that's the class actually used below.
      datacenter_type: CI_CLASS_LOGICAL_DATACENTER,
      short_description: 'Placeholder representing the Huawei Cloud account for logical-datacenter containment relationships'
    }
  };
}

/**
 * Map a full VPC + Subnet fetch into one IRE `createOrUpdateCI` payload,
 * including the cloud-service-account and logical-datacenter placeholders
 * and all three levels of containment relations. relations[] entries
 * reference items[] by array INDEX (as strings), matching the convention
 * already established in HuaweiECSDiscovery.js's reconcileCIs().
 *
 * A subnet whose vpc_id doesn't match any vpc in this same fetch (e.g. a
 * pagination race between the two list calls) is reported in
 * unmatchedSubnetIds instead of silently dropped or thrown - the caller
 * decides whether/how to log it, and the rest of the batch still reconciles.
 *
 * @param {Object[]} vpcs
 * @param {Object[]} subnets - each expected to carry a `vpc_id` field
 * @param {string} region - used to build/identify the shared logical-datacenter placeholder; required whenever vpcs is non-empty
 * @param {string} accountId - used to build/identify the shared cloud-service-account placeholder; required whenever vpcs is non-empty
 * @returns {{items: Object[], relations: Object[], unmatchedSubnetIds: string[]}}
 */
function buildIREPayload(vpcs, subnets, region, accountId) {
  vpcs = vpcs || [];
  subnets = subnets || [];

  var items = [];
  var relations = [];

  // Relation direction is NOT consistent across relation types - confirmed
  // via real-PDI testing, do not assume one convention applies everywhere:
  // - HOSTING_RELATION_TYPE ("Hosted on::Hosts"): `parent` = the DEPENDENT
  //   item itself, `child` = what satisfies its dependency (the host).
  //   Confirmed via a real MISSING_DEPENDENCY error's arrow notation
  //   ("[cmdb_ci_network >> Hosted on >> cmdb_ci_logical_datacenter]" reads
  //   as "network needs a Hosted-on relation pointing at datacenter", i.e.
  //   parent=network, child=datacenter) and then verified correct once
  //   applied (the account/datacenter/network chain all passed cleanly).
  //   OPPOSITE of HuaweiECSDiscovery.js's "Runs on::Runs" relation
  //   (parent=host, child=VM) - a different relation type, not comparable.
  // - CONTAINMENT_RELATION_TYPE ("Contains::Contained by"): `parent` = the
  //   container (network), `child` = the contained item (subnet) - the
  //   original, intuitive direction. Confirmed correct by real-PDI testing
  //   (swapping it to match HOSTING_RELATION_TYPE's convention broke it;
  //   reverted).
  var accountIndex = null;
  var datacenterIndex = null;
  if (vpcs.length) {
    items.push(mapCloudServiceAccountPlaceholder(accountId));
    accountIndex = items.length - 1;

    items.push(mapLogicalDatacenterPlaceholder(region));
    datacenterIndex = items.length - 1;
    relations.push({ parent: String(datacenterIndex), child: String(accountIndex), type: HOSTING_RELATION_TYPE });
  }

  var vpcIndexById = {};
  vpcs.forEach(function (vpc) {
    items.push(mapVpcToIREItem(vpc));
    var vpcItemIndex = items.length - 1;
    vpcIndexById[vpc.id] = vpcItemIndex;
    relations.push({ parent: String(vpcItemIndex), child: String(datacenterIndex), type: HOSTING_RELATION_TYPE });
  });

  var unmatchedSubnetIds = [];
  subnets.forEach(function (subnet) {
    items.push(mapSubnetToIREItem(subnet));
    var subnetItemIndex = items.length - 1;
    var vpcIndex = vpcIndexById[subnet.vpc_id];
    if (vpcIndex == null) {
      unmatchedSubnetIds.push(subnet.id);
      return;
    }
    relations.push({ parent: String(vpcIndex), child: String(subnetItemIndex), type: CONTAINMENT_RELATION_TYPE });
  });

  return { items: items, relations: relations, unmatchedSubnetIds: unmatchedSubnetIds };
}

module.exports = {
  mapVpcToIREItem: mapVpcToIREItem,
  mapSubnetToIREItem: mapSubnetToIREItem,
  mapLogicalDatacenterPlaceholder: mapLogicalDatacenterPlaceholder,
  mapCloudServiceAccountPlaceholder: mapCloudServiceAccountPlaceholder,
  buildIREPayload: buildIREPayload,
  CI_CLASS_VPC: CI_CLASS_VPC,
  CI_CLASS_SUBNET: CI_CLASS_SUBNET,
  CI_CLASS_LOGICAL_DATACENTER: CI_CLASS_LOGICAL_DATACENTER,
  CI_CLASS_CLOUD_SERVICE_ACCOUNT: CI_CLASS_CLOUD_SERVICE_ACCOUNT,
  CONTAINMENT_RELATION_TYPE: CONTAINMENT_RELATION_TYPE,
  HOSTING_RELATION_TYPE: HOSTING_RELATION_TYPE
};
