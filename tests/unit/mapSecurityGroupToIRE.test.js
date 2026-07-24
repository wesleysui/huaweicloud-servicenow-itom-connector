const { mapSecurityGroupToIREItem, buildIREPayload, CI_CLASS_SECURITY_GROUP, HOSTING_RELATION_TYPE } =
  require('../../servicenow/discovery/lib/mapSecurityGroupToIRE');
const securityGroupResponse = require('../../servicenow/discovery/fixtures/security-group-list-response.json');

// The fixture is a REAL captured response from a live Huawei Cloud sandbox
// account (project_id redacted - it identifies the real account), captured
// during Phase 2C real-PDI testing. Note it has NO vpc_id field, unlike
// what the official API docs' examples would suggest - see
// lib/mapSecurityGroupToIRE.js's header comment for why.

describe('mapSecurityGroupToIREItem', () => {
  it('maps a Huawei Security Group object to a CI_CLASS_SECURITY_GROUP IRE item', () => {
    const sg = securityGroupResponse.security_groups[0];
    expect(mapSecurityGroupToIREItem(sg)).toEqual({
      className: CI_CLASS_SECURITY_GROUP,
      values: {
        name: sg.name,
        correlation_id: sg.id,
        object_id: sg.id,
        short_description: sg.description || 'Huawei Cloud Security Group - discovered via custom REST integration',
        discovery_source: 'Huawei Cloud Custom Discovery'
      }
    });
  });

  it('uses CI_CLASS_SECURITY_GROUP as the className', () => {
    const item = mapSecurityGroupToIREItem(securityGroupResponse.security_groups[0]);
    expect(item.className).toBe(CI_CLASS_SECURITY_GROUP);
  });

  it('falls back to a generic short_description when description is empty', () => {
    const item = mapSecurityGroupToIREItem({ id: 'sg-1', name: 'sg-1', description: '' });
    expect(item.values.short_description).toBe('Huawei Cloud Security Group - discovered via custom REST integration');
  });
});

describe('buildIREPayload', () => {
  it('handles an empty security group list without throwing', () => {
    expect(buildIREPayload([], 1)).toEqual({ items: [], relations: [] });
    expect(buildIREPayload(undefined, undefined)).toEqual({ items: [], relations: [] });
  });

  it('relates every security group to the shared datacenter placeholder by index, via Hosted on::Hosts', () => {
    const sgs = [{ id: 'sg-a', name: 'a' }, { id: 'sg-b', name: 'b' }];
    const payload = buildIREPayload(sgs, 1); // e.g. items[1] is the shared datacenter placeholder from this run
    // items: [sg-a(0), sg-b(1)] - datacenterIndex(1) refers to a DIFFERENT run's items[] array
    expect(payload.items).toHaveLength(2);
    expect(payload.relations).toEqual([
      { parent: '0', child: '1', type: HOSTING_RELATION_TYPE },
      { parent: '1', child: '1', type: HOSTING_RELATION_TYPE }
    ]);
  });

  it('omits relations entirely when datacenterIndex is null (no VPCs discovered this run)', () => {
    const sgs = [{ id: 'sg-a', name: 'a' }];
    const payload = buildIREPayload(sgs, null);
    expect(payload.items).toHaveLength(1);
    expect(payload.relations).toEqual([]);
  });

  it('maps every security group in the fixture to an item, in order', () => {
    const payload = buildIREPayload(securityGroupResponse.security_groups, 0);
    expect(payload.items).toHaveLength(securityGroupResponse.security_groups.length);
    expect(payload.items[0]).toEqual(mapSecurityGroupToIREItem(securityGroupResponse.security_groups[0]));
  });
});
