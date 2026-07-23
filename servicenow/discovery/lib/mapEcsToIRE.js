/**
 * Pure mapping logic extracted from HuaweiECSDiscovery.js so it can be
 * unit-tested with Node/Jest outside the ServiceNow runtime (no GlideRecord,
 * no sn_ws dependency here). The Script Include mirrors this logic inline
 * because ServiceNow scoped scripts cannot `require()` external modules —
 * keep both in sync when changing the mapping rules.
 */

/**
 * Extract the fixed (private) IPv4 address from a Huawei ECS `addresses` map.
 * @param {Object} addresses - server.addresses from the ECS list API response
 * @returns {string}
 */
function getFixedIp(addresses) {
  for (const net in addresses || {}) {
    const nics = addresses[net] || [];
    for (const nic of nics) {
      if (nic['OS-EXT-IPS:type'] === 'fixed') {
        return nic.addr;
      }
    }
  }
  return '';
}

/**
 * Map one Huawei ECS server object (from GET /v1/{project_id}/cloudservers/detail)
 * into an IRE `items[]` entry for cmdb_ci_vm_instance.
 * @param {Object} server
 * @returns {Object}
 */
function mapServerToIREItem(server) {
  return {
    className: 'cmdb_ci_vm_instance',
    values: {
      name: server.name,
      correlation_id: server.id,
      object_id: server.id, // this instance's Identification Rule for cmdb_ci_vm_instance requires object_id specifically
      ip_address: getFixedIp(server.addresses),
      operational_status: server.status === 'ACTIVE' ? '1' : '2',
      location: server['OS-EXT-AZ:availability_zone'],
      short_description: 'Huawei Cloud ECS - discovered via custom REST integration',
      discovery_source: 'Huawei Cloud Custom Discovery'
      // 'virtual', 'host_name', and 'u_vpc_id' were dropped after real
      // testing showed they're silently rejected as unknown fields on this
      // table - see servicenow/discovery/README.md gotchas #12-#13 and
      // docs/ROADMAP.md.
    }
  };
}

/**
 * Map a full ECS list response into an IRE `createOrUpdateCI` payload.
 * @param {Object[]} servers
 * @returns {{items: Object[]}}
 */
function buildIREPayload(servers) {
  return { items: (servers || []).map(mapServerToIREItem) };
}

module.exports = { getFixedIp, mapServerToIREItem, buildIREPayload };
