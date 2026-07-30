const { getFixedIp, countNics, mapServerToIREItem, buildIREPayload } = require('../../servicenow/discovery/lib/mapEcsToIRE');
const ecsResponse = require('../../servicenow/discovery/fixtures/ecs-list-response.json');
const expectedIRE = require('../../servicenow/discovery/fixtures/ire-payload.expected.json');

describe('getFixedIp', () => {
  it('returns the fixed (private) address, ignoring floating IPs', () => {
    const server = ecsResponse.servers[0];
    expect(getFixedIp(server.addresses)).toBe('192.168.10.15');
  });

  it('returns empty string when no addresses are present', () => {
    expect(getFixedIp(undefined)).toBe('');
    expect(getFixedIp({})).toBe('');
  });
});

describe('countNics', () => {
  it('counts one NIC even when it has both a fixed and a floating IP (EIP bound)', () => {
    const server = ecsResponse.servers[0];
    expect(countNics(server.addresses)).toBe(1);
  });

  it('does not double-count a NIC just because it has multiple IP entries', () => {
    const addresses = {
      'subnet-web': [
        { addr: '192.168.10.15', 'OS-EXT-IPS:type': 'fixed' },
        { addr: '121.36.55.20', 'OS-EXT-IPS:type': 'floating' }
      ]
    };
    expect(countNics(addresses)).toBe(1);
  });

  it('counts multiple distinct networks as multiple NICs', () => {
    const addresses = {
      'subnet-web': [{ addr: '192.168.10.15', 'OS-EXT-IPS:type': 'fixed' }],
      'subnet-db': [{ addr: '192.168.20.20', 'OS-EXT-IPS:type': 'fixed' }]
    };
    expect(countNics(addresses)).toBe(2);
  });

  it('returns 0 when no addresses are present', () => {
    expect(countNics(undefined)).toBe(0);
    expect(countNics({})).toBe(0);
  });
});

describe('mapServerToIREItem', () => {
  it('maps a Huawei ECS server object to a cmdb_ci_vm_instance IRE item', () => {
    const server = ecsResponse.servers[0];
    const item = mapServerToIREItem(server);
    expect(item).toEqual(expectedIRE.items[0]);
  });

  it('marks non-ACTIVE instances as operational_status 2', () => {
    const server = { ...ecsResponse.servers[0], status: 'SHUTOFF' };
    const item = mapServerToIREItem(server);
    expect(item.values.operational_status).toBe('2');
  });

  it('leaves cpus/memory unset when no flavorLookup is given', () => {
    const server = ecsResponse.servers[0];
    const item = mapServerToIREItem(server);
    expect(item.values.cpus).toBeUndefined();
    expect(item.values.memory).toBeUndefined();
  });

  it('sets cpus/memory when the flavorLookup has this server\'s flavor id', () => {
    const server = ecsResponse.servers[0]; // flavor.id === 's6.large.2'
    const flavorLookup = { 's6.large.2': { vcpus: 2, ram: 4096 } };
    const item = mapServerToIREItem(server, flavorLookup);
    expect(item.values.cpus).toBe(2);
    expect(item.values.memory).toBe(4096);
  });

  it('leaves cpus/memory unset when the flavorLookup is missing this server\'s flavor id', () => {
    const server = ecsResponse.servers[0];
    const flavorLookup = { 'some-other-flavor': { vcpus: 8, ram: 16384 } };
    const item = mapServerToIREItem(server, flavorLookup);
    expect(item.values.cpus).toBeUndefined();
    expect(item.values.memory).toBeUndefined();
  });
});

describe('buildIREPayload', () => {
  it('wraps mapped items in the { items: [] } envelope expected by createOrUpdateCI', () => {
    const payload = buildIREPayload(ecsResponse.servers);
    expect(payload).toEqual(expectedIRE);
  });

  it('handles an empty server list without throwing', () => {
    expect(buildIREPayload([])).toEqual({ items: [] });
  });

  it('passes flavorLookup through to every mapped item', () => {
    const flavorLookup = { 's6.large.2': { vcpus: 2, ram: 4096 } };
    const payload = buildIREPayload(ecsResponse.servers, flavorLookup);
    expect(payload.items[0].values.cpus).toBe(2);
    expect(payload.items[0].values.memory).toBe(4096);
  });
});
