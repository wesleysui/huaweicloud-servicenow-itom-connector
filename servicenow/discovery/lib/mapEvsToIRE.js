/**
 * Pure mapping logic for EVS (Elastic Volume Service / disk) discovery.
 *
 * CI class chosen by referencing AWS's official Service Graph Connector
 * (per this project's standing rule): AWS discovers EBS volumes into
 * `cmdb_ci_storage_volume`. Real-PDI confirmed to exist on this instance
 * (a real MISSING_DEPENDENCY error named it).
 *
 * RELATION TO ECS: TESTED AND CONFIRMED NOT POSSIBLE via this project's
 * cross-discovery-run approach. The original design tried passing the
 * ECS CI's real, already-committed sys_id directly as a relations[]
 * parent/child value (instead of an array index), reasoning that IRE
 * might support it the way AWS's own connector relates resources
 * discovered across separate, temporally-independent payloads. Real-PDI
 * testing gave a DEFINITIVE, not-just-a-format-issue answer: ServiceNow's
 * server-side payload parser deserializes `relations[].child` (and
 * `.parent`) as a Java `Integer` - a real sys_id string
 * ("18268655625a4f10344044c98a8a5cb9") throws
 * `InvalidFormatException: Cannot deserialize value of type
 * java.lang.Integer from String ...`. This is a hard type constraint at
 * the JSON deserialization layer, not a guessable-around quirk - the
 * field can ONLY hold an array index. Confirms this project's existing
 * convention (index-only relations, one createOrUpdateCI call per
 * relation) is a real platform limitation, not just a self-imposed one -
 * matches Security Group's same finding for its ECS relation.
 *
 * So EVS ships as a standalone CI, same as Security Group: no relation to
 * ECS. It DOES need a relation to satisfy its own OOTB containment rule
 * though - the real MISSING_DEPENDENCY error listed three options
 * (`Contained by -> cmdb_ci_computer`, `Owned by -> cmdb_ci_storage_cluster`,
 * `Hosted on -> cmdb_ci_logical_datacenter`); this reuses
 * `Hosted on::Hosts -> cmdb_ci_logical_datacenter`, the same placeholder
 * class/relation type already proven for VPC (mapVpcSubnetToIRE.js). Since
 * EVS is discovered in its own separate call, it builds its OWN local
 * cloud_service_account/logical_datacenter placeholder pair rather than
 * referencing VPC's - not yet confirmed whether cmdb_ci_logical_datacenter
 * itself needs the same account-parent requirement VPC's did; build it in
 * defensively (cheap, and consistent with the proven pattern) and let
 * real-PDI testing confirm or correct.
 *
 * Field names are real, from Huawei's official EVS API documentation
 * (ListVolumes / "查询所有云硬盘详情") and a real captured response:
 * id, name, size, status, volume_type, availability_zone, and a nested
 * attachments[] array (server_id, device, attached_at, attachment_id,
 * host_name, volume_id).
 */

var CI_CLASS_EVS = 'cmdb_ci_storage_volume';
var CI_CLASS_LOGICAL_DATACENTER = 'cmdb_ci_logical_datacenter';
var CI_CLASS_CLOUD_SERVICE_ACCOUNT = 'cmdb_ci_cloud_service_account';
var HOSTING_RELATION_TYPE = 'Hosted on::Hosts';

/**
 * Map one Huawei EVS volume object into an IRE `items[]` entry.
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
 * array, or null if unattached. Not used for a relation (see this file's
 * header comment - cross-run relations by sys_id don't work), kept
 * available for callers that want to log/report it.
 * @param {Object} volume
 * @returns {string|null}
 */
function getAttachedServerId(volume) {
  var attachments = volume.attachments || [];
  if (!attachments.length) return null;
  return attachments[0].server_id || null;
}

/**
 * Builds the placeholder cloud_service_account/logical_datacenter pair and
 * one item per volume, all related via HOSTING_RELATION_TYPE, mirroring
 * mapVpcSubnetToIRE.js's same-named placeholders (built independently
 * here, not shared across the separate IRE calls - see this file's header
 * comment).
 * @param {Object[]} volumes
 * @param {string} region - used to identify the shared logical-datacenter placeholder
 * @param {string} accountId - used to identify the shared cloud-service-account placeholder
 * @returns {{items: Object[], relations: Object[]}}
 */
function buildIREPayload(volumes, region, accountId) {
  volumes = volumes || [];

  var items = [];
  var relations = [];

  if (!volumes.length) return { items: items, relations: relations };

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
      short_description: 'Placeholder representing the Huawei Cloud region for EVS containment relationships'
    }
  });
  var datacenterIndex = items.length - 1;
  relations.push({ parent: String(datacenterIndex), child: String(accountIndex), type: HOSTING_RELATION_TYPE });

  volumes.forEach(function (volume) {
    items.push(mapEvsToIREItem(volume));
    var itemIndex = items.length - 1;
    relations.push({ parent: String(itemIndex), child: String(datacenterIndex), type: HOSTING_RELATION_TYPE });
  });

  return { items: items, relations: relations };
}

module.exports = {
  mapEvsToIREItem: mapEvsToIREItem,
  getAttachedServerId: getAttachedServerId,
  buildIREPayload: buildIREPayload,
  CI_CLASS_EVS: CI_CLASS_EVS,
  CI_CLASS_LOGICAL_DATACENTER: CI_CLASS_LOGICAL_DATACENTER,
  CI_CLASS_CLOUD_SERVICE_ACCOUNT: CI_CLASS_CLOUD_SERVICE_ACCOUNT,
  HOSTING_RELATION_TYPE: HOSTING_RELATION_TYPE
};
