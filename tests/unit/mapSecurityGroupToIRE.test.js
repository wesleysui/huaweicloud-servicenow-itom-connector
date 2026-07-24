const { mapSecurityGroupToIREItem, buildIREPayload, CI_CLASS_SECURITY_GROUP, CONTAINMENT_RELATION_TYPE } =
  require('../../servicenow/discovery/lib/mapSecurityGroupToIRE');
const securityGroupResponse = require('../../servicenow/discovery/fixtures/security-group-list-response.json');

// The fixture is a documented-shape example built from Huawei's official
// VPC v3 API docs, not yet a live capture (unlike ces-alarm-payload.json) -
// replace with a real captured response once this is deployed and tested
// against a real PDI/sandbox.

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
    expect(buildIREPayload([], {})).toEqual({ items: [], relations: [], unmatchedVpcIds: [] });
    expect(buildIREPayload(undefined, undefined)).toEqual({ items: [], relations: [], unmatchedVpcIds: [] });
  });

  it('relates a security group to its parent VPC by array index when the VPC is in vpcIndexById', () => {
    const sgs = [{ id: 'sg-a', name: 'a', vpc_id: 'vpc-a' }];
    const vpcIndexById = { 'vpc-a': 2 }; // e.g. items[2] is the VPC from the same combined run
    const payload = buildIREPayload(sgs, vpcIndexById);
    expect(payload.items).toHaveLength(1);
    expect(payload.relations).toEqual([
      { parent: '2', child: '0', type: CONTAINMENT_RELATION_TYPE }
    ]);
    expect(payload.unmatchedVpcIds).toEqual([]);
  });

  it('reports a security group whose vpc_id matches no VPC in vpcIndexById as unmatched, without dropping or throwing', () => {
    const sgs = [{ id: 'sg-a', name: 'a', vpc_id: 'vpc-missing' }];
    const payload = buildIREPayload(sgs, {});
    expect(payload.items).toHaveLength(1); // the security group still gets a CI item
    expect(payload.relations).toEqual([]);
    expect(payload.unmatchedVpcIds).toEqual(['vpc-missing']);
  });

  it('relates each security group to its own parent VPC by index, independently', () => {
    const sgs = [
      { id: 'sg-a', name: 'a', vpc_id: 'vpc-a' },
      { id: 'sg-b', name: 'b', vpc_id: 'vpc-b' }
    ];
    const vpcIndexById = { 'vpc-a': 0, 'vpc-b': 1 };
    const payload = buildIREPayload(sgs, vpcIndexById);
    // items: [sg-a(0), sg-b(1)]
    expect(payload.relations).toEqual([
      { parent: '0', child: '0', type: CONTAINMENT_RELATION_TYPE },
      { parent: '1', child: '1', type: CONTAINMENT_RELATION_TYPE }
    ]);
  });

  it('maps every security group in the fixture to an item, in order', () => {
    const payload = buildIREPayload(securityGroupResponse.security_groups, {});
    expect(payload.items).toHaveLength(securityGroupResponse.security_groups.length);
    expect(payload.items[0]).toEqual(mapSecurityGroupToIREItem(securityGroupResponse.security_groups[0]));
  });
});
