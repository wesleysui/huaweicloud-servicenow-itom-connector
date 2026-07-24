/**
 * Pure mapping logic for EIP (Elastic IP) discovery.
 *
 * CI class is `cmdb_ci_ip_address` - NOT a cloud-specific class, the same
 * generic IP Address class ServiceNow uses for on-prem network gear.
 * Real-PDI confirmed to exist on this instance (a real MISSING_DEPENDENCY
 * error named it), matching this project's prior findings for VPC,
 * Subnet, Security Group, and EVS all landing on real, standard ServiceNow
 * CMDB classes rather than needing anything custom.
 *
 * Field names are real, from Huawei's official EIP API documentation
 * (ListPublicips / GET /v1/{project_id}/publicips), real-PDI confirmed
 * (the v1 host is shared with VPC/Subnet/Security Group). Naming gotcha:
 * the display name field is `alias`, not `name` (the one exception among
 * this project's Huawei resource types so far) - and `alias` is commonly
 * empty (EIPs aren't named by default in the console), so this falls back
 * to `public_ip_address` when absent.
 *
 * CONTAINMENT: `cmdb_ci_ip_address`'s real OOTB rule is DIFFERENT from
 * every other class this project discovers - confirmed via a real
 * MISSING_DEPENDENCY error: it needs an `Owns::Owned by` relation to one
 * of cmdb_ci_hardware / cmdb_ci_cloud_database / cmdb_ci_cloud_load_balancer
 * / cmdb_ci_cloud_webserver, NOT Hosted on::Hosts -> logical_datacenter
 * like VPC/Subnet/Security Group/EVS. Two real things were checked before
 * picking a fix (per this project's "verify before assuming" standard,
 * using a real sys_db_object super_class walk, not guesswork):
 * (1) ECS's own CI class (cmdb_ci_vm_instance) is NOT hardware-family
 * (cmdb_ci_vm_instance -> cmdb_ci_vm_object -> cmdb_ci -> cmdb) - rules out
 * any stub relation to the per-instance ECS CI, and also rules out the
 * relations[]-holds-a-real-sys_id idea EVS already disproved (see
 * mapEvsToIRE.js);
 * (2) `cmdb_ci_virtualization_server` - the shared placeholder
 * HuaweiECSDiscovery.js already creates for its own "Runs on::Runs"
 * containment fix - IS hardware-family
 * (cmdb_ci_virtualization_server -> cmdb_ci_server -> cmdb_ci_computer ->
 * cmdb_ci_hardware). So each EIP relates to a FRESH, locally-built stub of
 * that SAME class/name ('Huawei Cloud - ' + region, matching
 * HuaweiECSDiscovery.js's own placeholder exactly) via `Owns::Owned by` -
 * IRE resolves the stub against the real, already-committed placeholder CI
 * via identification matching, not a raw sys_id (still confirmed
 * impossible).
 *
 * Relation direction (parent=owner/child=owned) follows the "intuitive"
 * reading of the label pair - matches this project's
 * CONTAINMENT_RELATION_TYPE precedent in mapVpcSubnetToIRE.js (the
 * "parent=dependent" convention used for HOSTING_RELATION_TYPE broke
 * CONTAINMENT_RELATION_TYPE when tried there). REAL-PDI VERIFIED CORRECT
 * on the first try: `hasError:false`, the EIP CI inserted, the
 * Owns::Owned by relation inserted, and the virtualization_server stub
 * correctly matched (NO_CHANGE, not a duplicate) against the real,
 * already-committed placeholder from a separate HuaweiECSDiscovery.js run
 * - confirms IRE's cross-payload identification-matching mechanism (not a
 * raw sys_id) really is the correct, native way to relate CIs across
 * separate discovery runs in this platform.
 *
 * `object_id` was REMOVED after real-PDI testing showed
 * `cmdb_ci_ip_address` has no such field (a real "unknown field 'object_id'
 * in table 'cmdb_ci_ip_address'" warning, silently dropped rather than
 * erroring). Real identification instead uses an OOTB "IP Address" rule
 * keyed on `ip_address`+`netmask` (confirmed via the real IRE result's
 * identificationAttempts) - `correlation_id` is kept for
 * consistency/future-proofing even though it isn't the active
 * identification path today.
 */

var CI_CLASS_EIP = 'cmdb_ci_ip_address';
var CI_CLASS_VIRTUALIZATION_SERVER = 'cmdb_ci_virtualization_server';
var OWNERSHIP_RELATION_TYPE = 'Owns::Owned by';

/**
 * Map one Huawei EIP object into an IRE `items[]` entry.
 * @param {Object} eip
 * @returns {Object}
 */
function mapEipToIREItem(eip) {
  return {
    className: CI_CLASS_EIP,
    values: {
      name: eip.alias || eip.public_ip_address,
      correlation_id: eip.id,
      ip_address: eip.public_ip_address,
      short_description: 'Huawei Cloud Elastic IP - discovered via custom REST integration',
      discovery_source: 'Huawei Cloud Custom Discovery'
    }
  };
}

/**
 * Builds the virtualization_server placeholder stub (matching
 * HuaweiECSDiscovery.js's own placeholder exactly) plus one item per EIP,
 * each related to the stub via Owns::Owned by (parent=stub/owner,
 * child=EIP/owned). Returns empty items/relations for an empty list, with
 * no placeholder built.
 * @param {Object[]} eips
 * @param {string} region - used to build the shared virtualization_server placeholder's identifying name
 * @returns {{items: Object[], relations: Object[]}}
 */
function buildIREPayload(eips, region) {
  eips = eips || [];
  var items = [];
  var relations = [];

  if (!eips.length) return { items: items, relations: relations };

  items.push({
    className: CI_CLASS_VIRTUALIZATION_SERVER,
    values: {
      name: 'Huawei Cloud - ' + region,
      short_description: 'Placeholder representing the Huawei Cloud hypervisor layer for ECS containment relationships'
    }
  });
  var virtServerIndex = items.length - 1;

  eips.forEach(function (eip) {
    items.push(mapEipToIREItem(eip));
    var itemIndex = items.length - 1;
    relations.push({ parent: String(virtServerIndex), child: String(itemIndex), type: OWNERSHIP_RELATION_TYPE });
  });

  return { items: items, relations: relations };
}

module.exports = {
  mapEipToIREItem: mapEipToIREItem,
  buildIREPayload: buildIREPayload,
  CI_CLASS_EIP: CI_CLASS_EIP,
  CI_CLASS_VIRTUALIZATION_SERVER: CI_CLASS_VIRTUALIZATION_SERVER,
  OWNERSHIP_RELATION_TYPE: OWNERSHIP_RELATION_TYPE
};
