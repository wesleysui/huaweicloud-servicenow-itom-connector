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
 * Count the network adapters (NICs) attached to a Huawei ECS instance, from
 * the same `addresses` map already fetched for getFixedIp() above - a free
 * win for `cmdb_ci_vm_instance.nics`, no extra Huawei API call needed.
 * Confirmed field name (`nics`, not e.g. `network_adapter_count`) via this
 * instance's real `sys_dictionary` for cmdb_ci_vm_instance, not guessed -
 * the project has been burned once before by guessing CI field names (see
 * the dropped 'virtual'/'host_name'/'u_vpc_id' fields in
 * mapServerToIREItem() below).
 *
 * Counts distinct NETWORK KEYS, not total IP entries: one NIC's
 * `addresses[network]` array commonly holds two entries - a `fixed`
 * (private) IP and, if an EIP is bound, a second `floating` (public) IP -
 * both on the SAME NIC. Summing array lengths would double-count any
 * instance with a bound EIP; the network-key count matches Huawei's
 * Nova-compatible one-NIC-per-attached-network model instead.
 * @param {Object} addresses - server.addresses from the ECS list API response
 * @returns {number}
 */
function countNics(addresses) {
  return Object.keys(addresses || {}).length;
}

/**
 * Map one Huawei ECS server object (from GET /v1/{project_id}/cloudservers/detail)
 * into an IRE `items[]` entry for cmdb_ci_vm_instance.
 * @param {Object} server
 * @param {Object} [flavorLookup] - {[flavorId]: {vcpus: number, ram: number}}, from
 *   HuaweiECSDiscovery._buildFlavorLookup() (a separate Huawei "ListFlavors" API
 *   call, not part of the server list response itself - see that method's header
 *   comment). Confirmed field names (`cpus`/`memory`) via this instance's real
 *   sys_dictionary, not guessed. Omit or pass a lookup missing this server's
 *   flavor id to leave cpus/memory unset - graceful degrade, not a hard failure.
 * @returns {Object}
 */
function mapServerToIREItem(server, flavorLookup) {
  const values = {
    name: server.name,
    correlation_id: server.id,
    object_id: server.id, // this instance's Identification Rule for cmdb_ci_vm_instance requires object_id specifically
    ip_address: getFixedIp(server.addresses),
    operational_status: server.status === 'ACTIVE' ? '1' : '2',
    location: server['OS-EXT-AZ:availability_zone'],
    nics: countNics(server.addresses),
    short_description: 'Huawei Cloud ECS - discovered via custom REST integration',
    discovery_source: 'Huawei Cloud Custom Discovery'
    // 'virtual', 'host_name', and 'u_vpc_id' were dropped after real
    // testing showed they're silently rejected as unknown fields on this
    // table - see servicenow/discovery/README.md gotchas #12-#13 and
    // docs/ROADMAP.md.
  };

  const flavorId = server.flavor && server.flavor.id;
  const flavorDetail = flavorLookup && flavorId ? flavorLookup[flavorId] : null;
  if (flavorDetail) {
    values.cpus = flavorDetail.vcpus;
    values.memory = flavorDetail.ram;
  }

  return { className: 'cmdb_ci_vm_instance', values };
}

/**
 * Map a full ECS list response into an IRE `createOrUpdateCI` payload.
 * @param {Object[]} servers
 * @param {Object} [flavorLookup] - see mapServerToIREItem()
 * @returns {{items: Object[]}}
 */
function buildIREPayload(servers, flavorLookup) {
  return { items: (servers || []).map((server) => mapServerToIREItem(server, flavorLookup)) };
}

module.exports = { getFixedIp, countNics, mapServerToIREItem, buildIREPayload };
