/**
 * Pure mapping logic for Security Group discovery - the same "pure lib,
 * mirrored inline in a Script Include" pattern as mapVpcSubnetToIRE.js /
 * HuaweiVpcDiscovery.js. Designed to be combined with that same module's
 * output in ONE createOrUpdateCI() call (see HuaweiVpcDiscovery.js's
 * reconcileCIs()) - this project's IRE relations[] entries reference
 * items[] by array index, which only works within a single call.
 *
 * CI class chosen by researching how AWS's own official Service Graph
 * Connector models this resource (per this project's standing rule to
 * reference AWS/Azure before designing a new mapping): AWS discovers
 * Security Groups into `cmdb_ci_compute_security_group`. Source:
 * ServiceNow's "Service Graph Connector for AWS - Functional Spec and CI"
 * community article. Real-PDI confirmed on this instance (the class
 * exists and accepted real data once the relation below was fixed).
 *
 * HOSTING_RELATION_TYPE ("Hosted on::Hosts" -> cmdb_ci_logical_datacenter)
 * is real-PDI confirmed, NOT the original design. First attempt related
 * each security group to its parent VPC via Contains::Contained by
 * (`vpc_id`), mirroring Subnet's relation to VPC - this failed for TWO
 * real reasons, both confirmed via real-PDI testing:
 *   1. Huawei's actual `GET /v3/{project_id}/vpc/security-groups` response
 *      does NOT include a `vpc_id` field at all (only id, name,
 *      description, project_id, enterprise_project_id, created_at,
 *      updated_at, tags) - contradicts what general API-shape assumptions
 *      would suggest. There is no data to relate a security group to a
 *      specific VPC with in the first place.
 *   2. `cmdb_ci_compute_security_group`'s real OOTB containment rule
 *      doesn't want a VPC parent anyway - the exact real MISSING_DEPENDENCY
 *      error was: "no relations defined for dependent class
 *      [cmdb_ci_compute_security_group] that matches any
 *      containment/hosting rules: [cmdb_ci_compute_security_group >>
 *      Hosted on >> cmdb_ci_logical_datacenter]" - the SAME placeholder
 *      cmdb_ci_network (VPC) itself is hosted under, not a child of the
 *      VPC. Fixed by relating every security group directly to the shared
 *      per-run cmdb_ci_logical_datacenter placeholder via
 *      HOSTING_RELATION_TYPE, mirroring how mapVpcSubnetToIRE.js relates
 *      VPC -> datacenter, not how it relates Subnet -> VPC.
 *
 * Field names are real, confirmed against a live Huawei API response
 * (not just docs): id, name, description, project_id,
 * enterprise_project_id, created_at, updated_at, tags. No vpc_id.
 *
 * Security Group -> ECS instance is NOT related here (no "Secures"
 * relation) - ECS is discovered in a separate Script Include/call, and
 * this project has no established pattern yet for relating CIs across two
 * separate discovery runs. Matches the fact that ECS<->VPC/Subnet aren't
 * related to each other either today - a real, documented gap, not a
 * silent omission.
 *
 * Rules are deliberately NOT mapped into the CI item or decomposed into
 * their own CIs - AWS's own connector doesn't appear to model individual
 * SG rules as CMDB items either (its functional spec lists no separate
 * rule-level CI class), so this matches that scope.
 */

var CI_CLASS_SECURITY_GROUP = 'cmdb_ci_compute_security_group';
var CI_CLASS_LOGICAL_DATACENTER = 'cmdb_ci_logical_datacenter';
var HOSTING_RELATION_TYPE = 'Hosted on::Hosts';

/**
 * Map one Huawei Security Group object (from
 * GET /v3/{project_id}/vpc/security-groups) into an IRE `items[]` entry.
 * @param {Object} sg
 * @returns {Object}
 */
function mapSecurityGroupToIREItem(sg) {
  return {
    className: CI_CLASS_SECURITY_GROUP,
    values: {
      name: sg.name,
      correlation_id: sg.id,
      object_id: sg.id,
      short_description: sg.description || 'Huawei Cloud Security Group - discovered via custom REST integration',
      discovery_source: 'Huawei Cloud Custom Discovery'
    }
  };
}

/**
 * Builds the Security Group portion of a combined IRE payload: one item per
 * security group, plus a Hosted on::Hosts relation to the shared
 * cmdb_ci_logical_datacenter placeholder item index (datacenterIndex -
 * supplied by the caller, built from the SAME run's VPC/datacenter setup so
 * the array-index-based relations[] entries resolve correctly; see
 * HuaweiVpcDiscovery.js's reconcileCIs()).
 *
 * items/relations are APPENDED TO the arrays passed in (mutated in place)
 * so the caller can combine this with VPC/Subnet items in one
 * createOrUpdateCI() call and keep index bookkeeping in one place, the same
 * shape mapVpcSubnetToIRE.js's buildIREPayload() already returns.
 *
 * @param {Object[]} securityGroups
 * @param {number|null} datacenterIndex - items[] index of the shared cmdb_ci_logical_datacenter placeholder, or null if none was created this run (no VPCs discovered)
 * @returns {{items: Object[], relations: Object[]}}
 */
function buildIREPayload(securityGroups, datacenterIndex) {
  securityGroups = securityGroups || [];

  var items = [];
  var relations = [];

  securityGroups.forEach(function (sg) {
    items.push(mapSecurityGroupToIREItem(sg));
    var sgItemIndex = items.length - 1;

    if (datacenterIndex != null) {
      relations.push({ parent: String(sgItemIndex), child: String(datacenterIndex), type: HOSTING_RELATION_TYPE });
    }
  });

  return { items: items, relations: relations };
}

module.exports = {
  mapSecurityGroupToIREItem: mapSecurityGroupToIREItem,
  buildIREPayload: buildIREPayload,
  CI_CLASS_SECURITY_GROUP: CI_CLASS_SECURITY_GROUP,
  CI_CLASS_LOGICAL_DATACENTER: CI_CLASS_LOGICAL_DATACENTER,
  HOSTING_RELATION_TYPE: HOSTING_RELATION_TYPE
};
