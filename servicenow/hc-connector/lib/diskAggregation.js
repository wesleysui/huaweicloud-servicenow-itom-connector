/**
 * Pure aggregation logic for HcConnectorEvsSync.js's disk-field enrichment
 * side effect: given a batch of Huawei EVS volumes (the same list already
 * fetched for EVS CI reconciliation), group them by the ECS server_id
 * they're attached to and sum disk count/total size per server.
 *
 * Why a side effect on the ECS CI at all, instead of a real CMDB relation:
 * this project already tried relating EVS volume CIs to ECS instance CIs
 * via relations[] and found a hard platform limitation - IRE deserializes
 * relations[].parent/.child as a Java Integer, so a real already-committed
 * sys_id (from a separate discovery run) throws InvalidFormatException, not
 * just a format quirk to work around (see
 * servicenow/discovery/lib/mapEvsToIRE.js's header comment). So EVS ships
 * as a standalone CI with no CMDB relation to its ECS host; this
 * aggregation instead feeds a direct GlideRecord field update on the
 * matching cmdb_ci_vm_instance CI (`disks`/`disks_size`), done in
 * HcConnectorEvsSync.js's _updateEcsDiskFields(), not here (this file
 * stays a pure function with zero ServiceNow dependency).
 *
 * Field names (Huawei EVS volume object): `size` (GB), `attachments[]`
 * (each with `server_id`) - from Huawei's official EVS API docs and a real
 * captured response, same source mapEvsToIRE.js already documents.
 */

/**
 * @param {Object[]} volumes - Huawei EVS volume objects (id, name, size, attachments[], ...)
 * @returns {Object} {[serverId]: {count: number, totalSize: number}}
 */
function aggregateDisksByServer(volumes) {
  const bySeverId = {};
  (volumes || []).forEach((volume) => {
    const attachments = volume.attachments || [];
    if (!attachments.length) return;
    const serverId = attachments[0].server_id;
    if (!serverId) return;
    if (!bySeverId[serverId]) {
      bySeverId[serverId] = { count: 0, totalSize: 0 };
    }
    bySeverId[serverId].count += 1;
    bySeverId[serverId].totalSize += volume.size || 0;
  });
  return bySeverId;
}

module.exports = { aggregateDisksByServer };
