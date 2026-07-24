/**
 * Pure mapping logic for Security Group discovery - the same "pure lib,
 * mirrored inline in a Script Include" pattern as mapVpcSubnetToIRE.js /
 * HuaweiVpcDiscovery.js. Designed to be combined with that same module's
 * output in ONE createOrUpdateCI() call (see HuaweiVpcDiscovery.js's
 * reconcileCIs()) - this project's IRE relations[] entries reference
 * items[] by array index, which only works within a single call, so
 * Security Group -> VPC only works when both are discovered together.
 * (Security Group -> ECS instance is NOT attempted here for the same
 * reason: ECS is discovered in a separate Script Include/call, and this
 * project has no established pattern yet for relating CIs across two
 * separate discovery runs - matches the fact that ECS<->VPC/Subnet aren't
 * related to each other either today. Documented as a known gap, not
 * silently skipped.)
 *
 * CI class chosen by researching how AWS's own official Service Graph
 * Connector models this resource (per this project's standing rule to
 * reference AWS/Azure before designing a new mapping, not guess from the
 * Huawei API shape alone): AWS discovers Security Groups into
 * `cmdb_ci_compute_security_group`, related to Cloud Networks (the same
 * class this project already uses for VPC, `cmdb_ci_network`),
 * Availability Zones, and Cloud Service Accounts. Source: ServiceNow's
 * "Service Graph Connector for AWS - Functional Spec and CI" community
 * article. NOT yet confirmed against this project's own real PDI (the
 * class may not exist, or may need its own Identification Rule
 * configured, exactly like cmdb_ci_network/cmdb_ci_cloud_subnet needed in
 * Phase 2B) - treat CI_CLASS_SECURITY_GROUP as a starting hypothesis to
 * verify, not a settled fact, the same way Phase 2B's VPC class went
 * through 2 rounds of correction before landing on cmdb_ci_network.
 * CONTAINMENT_RELATION_TYPE reuses the "Contains::Contained by" type
 * already proven correct for VPC->Subnet in this project (Security Group
 * belonging to a VPC is a similar "member of" relationship) - a reasonable
 * reuse, not a guess, but still worth re-confirming on real-PDI testing
 * since it's a different class pair than the one it was proven on.
 *
 * Field names are real, from Huawei's official VPC API v3 documentation
 * (ShowSecurityGroup / ListSecurityGroups) - not fabricated:
 * id, name, description, vpc_id, enterprise_project_id, and a nested
 * security_group_rules[] array (id, description, direction, ethertype,
 * protocol, port_range_min, port_range_max, remote_ip_prefix,
 * remote_group_id). Rules are deliberately NOT mapped into the CI item or
 * decomposed into their own CIs in this first pass - AWS's own connector
 * doesn't appear to model individual SG rules as CMDB items either (its
 * functional spec lists no separate rule-level CI class), so this matches
 * that scope rather than inventing a rule-level CI class unprompted.
 */

var CI_CLASS_SECURITY_GROUP = 'cmdb_ci_compute_security_group';
var CI_CLASS_VPC = 'cmdb_ci_network';
var CONTAINMENT_RELATION_TYPE = 'Contains::Contained by';

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
 * security group, plus a Contains::Contained by relation to its parent VPC
 * item index (vpcIndexById - supplied by the caller, built from the SAME
 * run's VPC items so the array-index-based relations[] entries resolve
 * correctly; see HuaweiVpcDiscovery.js's reconcileCIs()).
 *
 * items/relations are APPENDED TO the arrays passed in (mutated in place)
 * so the caller can combine this with VPC/Subnet items in one
 * createOrUpdateCI() call and keep index bookkeeping in one place, the same
 * shape mapVpcSubnetToIRE.js's buildIREPayload() already returns.
 *
 * A security group whose vpc_id doesn't match any VPC in vpcIndexById is
 * reported in unmatchedVpcIds instead of silently dropped - same
 * convention as mapVpcSubnetToIRE.js's unmatchedSubnetIds.
 *
 * @param {Object[]} securityGroups
 * @param {Object.<string, number>} vpcIndexById - security group vpc_id -> items[] index
 * @returns {{items: Object[], relations: Object[], unmatchedVpcIds: string[]}}
 */
function buildIREPayload(securityGroups, vpcIndexById) {
  securityGroups = securityGroups || [];
  vpcIndexById = vpcIndexById || {};

  var items = [];
  var relations = [];
  var unmatchedVpcIds = [];

  securityGroups.forEach(function (sg) {
    items.push(mapSecurityGroupToIREItem(sg));
    var sgItemIndex = items.length - 1;

    var vpcIndex = vpcIndexById[sg.vpc_id];
    if (vpcIndex == null) {
      unmatchedVpcIds.push(sg.vpc_id);
      return;
    }
    relations.push({ parent: String(vpcIndex), child: String(sgItemIndex), type: CONTAINMENT_RELATION_TYPE });
  });

  return { items: items, relations: relations, unmatchedVpcIds: unmatchedVpcIds };
}

module.exports = {
  mapSecurityGroupToIREItem: mapSecurityGroupToIREItem,
  buildIREPayload: buildIREPayload,
  CI_CLASS_SECURITY_GROUP: CI_CLASS_SECURITY_GROUP,
  CI_CLASS_VPC: CI_CLASS_VPC,
  CONTAINMENT_RELATION_TYPE: CONTAINMENT_RELATION_TYPE
};
