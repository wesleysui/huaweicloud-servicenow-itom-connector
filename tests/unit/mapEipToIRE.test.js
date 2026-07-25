const { mapEipToIREItem, buildIREPayload, CI_CLASS_EIP, CI_CLASS_VIRTUALIZATION_SERVER, OWNERSHIP_RELATION_TYPE } =
  require('../../servicenow/discovery/lib/mapEipToIRE');
const eipResponse = require('../../servicenow/discovery/fixtures/eip-list-response.json');

describe('mapEipToIREItem', () => {
  it('maps a Huawei EIP object to a CI_CLASS_EIP IRE item, using alias as name', () => {
    const eip = eipResponse.publicips[0];
    expect(mapEipToIREItem(eip)).toEqual({
      className: CI_CLASS_EIP,
      values: {
        name: 'sandbox-eip-1',
        correlation_id: eip.id,
        ip_address: eip.public_ip_address,
        netmask: '255.255.255.255',
        short_description: 'Huawei Cloud Elastic IP - discovered via custom REST integration',
        discovery_source: 'Huawei Cloud Custom Discovery'
      }
    });
  });

  it('falls back to public_ip_address as name when alias is empty', () => {
    const eip = eipResponse.publicips[1];
    expect(eip.alias).toBe('');
    expect(mapEipToIREItem(eip).values.name).toBe(eip.public_ip_address);
  });

  it('uses CI_CLASS_EIP as the className', () => {
    expect(mapEipToIREItem(eipResponse.publicips[0]).className).toBe(CI_CLASS_EIP);
  });
});

describe('buildIREPayload', () => {
  it('returns empty items/relations for an empty EIP list, with no placeholder', () => {
    expect(buildIREPayload([], 'af-south-1')).toEqual({ items: [], relations: [] });
    expect(buildIREPayload(undefined, 'af-south-1')).toEqual({ items: [], relations: [] });
  });

  it('builds the virtualization_server placeholder and relates every EIP to it via Owns::Owned by', () => {
    const eips = eipResponse.publicips;
    const payload = buildIREPayload(eips, 'af-south-1');
    // items: [virtServer(0), eip-a(1), eip-b(2)]
    expect(payload.items).toHaveLength(3);
    expect(payload.items[0]).toEqual({
      className: CI_CLASS_VIRTUALIZATION_SERVER,
      values: {
        name: 'Huawei Cloud - af-south-1',
        short_description: 'Placeholder representing the Huawei Cloud hypervisor layer for ECS containment relationships'
      }
    });
    expect(payload.items[1]).toEqual(mapEipToIREItem(eips[0]));
    expect(payload.items[2]).toEqual(mapEipToIREItem(eips[1]));
    expect(payload.relations).toEqual([
      { parent: '0', child: '1', type: OWNERSHIP_RELATION_TYPE },
      { parent: '0', child: '2', type: OWNERSHIP_RELATION_TYPE }
    ]);
  });

  it('identifies the virtualization_server placeholder by region, matching HuaweiECSDiscovery.js exactly', () => {
    const payload = buildIREPayload([eipResponse.publicips[0]], 'af-south-1');
    expect(payload.items[0].values.name).toBe('Huawei Cloud - af-south-1');
  });
});
