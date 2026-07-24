/**
 * Pure mapping logic for EVS (Elastic Volume Service / disk) discovery.
 *
 * CI class chosen by referencing AWS's official Service Graph Connector
 * (per this project's standing rule): AWS discovers EBS volumes into
 * `cmdb_ci_storage_volume`, related to the owning EC2 instance
 * (`cmdb_ci_vm_instance`) via an "Attached to" relationship. NOT yet
 * confirmed against this project's own real PDI - treat as a starting
 * hypothesis, the same way every other CI class in this project needed
 * real-PDI correction before landing (VPC/Subnet took 2 rounds; Security
 * Group's class was right first try but its relation type was wrong).
 *
 * Field names are real, from Huawei's official EVS API documentation
 * (ListVolumes / "查询所有云硬盘详情"): id, name, size, status,
 * volume_type, availability_zone, and a nested attachments[] array
 * (server_id, device, attached_at, attachment_id, host_name, volume_id).
 *
 * RELATION TO ECS IS THE HARD PART. EVS is discovered in its own separate
 * Script Include/orchestrator run, not combined with HuaweiECSDiscovery.js
 * (that file is real-PDI verified and intentionally left untouched - same
 * constraint that already applied to Security Group). Every other
 * cross-class relation in this project references items[] by ARRAY INDEX,
 * which only resolves within one createOrUpdateCI() call - doesn't work
 * across two separate runs. This module tries a DIFFERENT, still-native
 * mechanism instead of giving up on the relation (like Security Group did
 * for its ECS relation): passing the ECS CI's REAL, already-committed
 * sys_id (looked up via GlideRecord on correlation_id - the same
 * `_lookupCiByCorrelationId` pattern HcConnectorVpcSync.js already uses)
 * directly as the relation's parent/child value, instead of a positional
 * index. NOT YET CONFIRMED whether IRE's relations[] actually accepts a
 * real sys_id in place of an index - this is a genuine, testable
 * hypothesis about a real platform capability, not an invented workaround.
 * If real-PDI testing confirms it works, this becomes the first proven
 * cross-discovery-run relation pattern in this project (reusable for EIP
 * and future resource types with the same problem). If it fails, EVS ships
 * as a standalone CI with no ECS relation, matching Security Group's
 * precedent, and the finding gets documented either way.
 */

var CI_CLASS_EVS = 'cmdb_ci_storage_volume';
var ATTACHED_RELATION_TYPE = 'Attached to::Attaches'; // UNCONFIRMED - verify against real cmdb_rel_type on real-PDI testing, same as every other relation type in this project

/**
 * Map one Huawei EVS volume object (from GET .../cloudvolumes or
 * /v3/{project_id}/volumes) into an IRE `items[]` entry.
 * @param {Object} volume
 * @returns {Object}
 */
function mapEvsToIREItem(volume) {
  return {
    className: CI_CLASS_EVS,
    values: {
      name: volume.name,
      correlation_id: volume.id,
      object_id: volume.id,
      short_description: 'Huawei Cloud EVS Volume - discovered via custom REST integration',
      discovery_source: 'Huawei Cloud Custom Discovery'
    }
  };
}

/**
 * Extracts the attached ECS server_id from a volume's `attachments[]`
 * array, or null if the volume isn't attached to anything. Huawei's real
 * API returns attachments as an array (schema allows multiple), but a
 * volume attached via the standard single-attach flow only ever has 0 or 1
 * entries in practice - takes the first if present.
 * @param {Object} volume
 * @returns {string|null}
 */
function getAttachedServerId(volume) {
  var attachments = volume.attachments || [];
  if (!attachments.length) return null;
  return attachments[0].server_id || null;
}

/**
 * Builds the EVS portion of an IRE payload: one item per volume, plus an
 * Attached to::Attaches relation to its ECS instance's REAL sys_id - see
 * this file's header comment for why a real sys_id, not an array index.
 * ecsCiSysIdByServerId is supplied by the caller (built via a real
 * GlideRecord lookup, not by this pure function).
 *
 * A volume attached to a server_id not present in ecsCiSysIdByServerId
 * (not yet discovered, or discovery order raced) is reported in
 * unmatchedServerIds instead of silently dropped - same convention as
 * mapVpcSubnetToIRE.js's unmatchedSubnetIds.
 *
 * @param {Object[]} volumes
 * @param {Object.<string, string>} ecsCiSysIdByServerId - Huawei ECS server_id -> real cmdb_ci_vm_instance sys_id
 * @returns {{items: Object[], relations: Object[], unmatchedServerIds: string[]}}
 */
function buildIREPayload(volumes, ecsCiSysIdByServerId) {
  volumes = volumes || [];
  ecsCiSysIdByServerId = ecsCiSysIdByServerId || {};

  var items = [];
  var relations = [];
  var unmatchedServerIds = [];

  volumes.forEach(function (volume) {
    items.push(mapEvsToIREItem(volume));
    var itemIndex = items.length - 1;

    var serverId = getAttachedServerId(volume);
    if (!serverId) return; // unattached volume - no relation to build, not an error

    var ecsSysId = ecsCiSysIdByServerId[serverId];
    if (!ecsSysId) {
      unmatchedServerIds.push(serverId);
      return;
    }
    // parent = the dependent item (the volume, via its item INDEX in this
    // payload), child = the real, already-existing ECS CI it depends on
    // (via its real sys_id - NOT an index). Direction guess mirrors
    // HuaweiECSDiscovery.js's "Runs on::Runs" (parent=dependent, child=host)
    // - unconfirmed for this relation type, verify on real-PDI testing.
    relations.push({ parent: String(itemIndex), child: ecsSysId, type: ATTACHED_RELATION_TYPE });
  });

  return { items: items, relations: relations, unmatchedServerIds: unmatchedServerIds };
}

module.exports = {
  mapEvsToIREItem: mapEvsToIREItem,
  getAttachedServerId: getAttachedServerId,
  buildIREPayload: buildIREPayload,
  CI_CLASS_EVS: CI_CLASS_EVS,
  ATTACHED_RELATION_TYPE: ATTACHED_RELATION_TYPE
};
