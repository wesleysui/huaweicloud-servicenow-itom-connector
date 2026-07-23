const { getFixedIp, mapServerToIREItem, buildIREPayload } = require('../../servicenow/discovery/lib/mapEcsToIRE');
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
});

describe('buildIREPayload', () => {
  it('wraps mapped items in the { items: [] } envelope expected by createOrUpdateCI', () => {
    const payload = buildIREPayload(ecsResponse.servers);
    expect(payload).toEqual(expectedIRE);
  });

  it('handles an empty server list without throwing', () => {
    expect(buildIREPayload([])).toEqual({ items: [] });
  });
});
