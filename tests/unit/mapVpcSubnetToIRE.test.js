const { mapVpcToIREItem, mapSubnetToIREItem, mapLogicalDatacenterPlaceholder, mapCloudServiceAccountPlaceholder, buildIREPayload, CI_CLASS_VPC, CI_CLASS_SUBNET, CI_CLASS_LOGICAL_DATACENTER, CI_CLASS_CLOUD_SERVICE_ACCOUNT, CONTAINMENT_RELATION_TYPE, HOSTING_RELATION_TYPE } =
  require('../../servicenow/discovery/lib/mapVpcSubnetToIRE');
const vpcResponse = require('../../servicenow/discovery/fixtures/vpc-list-response.json');
const subnetResponse = require('../../servicenow/discovery/fixtures/subnet-list-response.json');
const expectedIRE = require('../../servicenow/discovery/fixtures/vpc-subnet-ire-payload.expected.json');

describe('mapVpcToIREItem', () => {
  it('maps a Huawei VPC object to a CI_CLASS_VPC IRE item', () => {
    const vpc = vpcResponse.vpcs[0];
    expect(mapVpcToIREItem(vpc)).toEqual(expectedIRE.items[2]);
  });

  it('uses CI_CLASS_VPC as the className', () => {
    const item = mapVpcToIREItem(vpcResponse.vpcs[0]);
    expect(item.className).toBe(CI_CLASS_VPC);
  });
});

describe('mapSubnetToIREItem', () => {
  it('maps a Huawei Subnet object to a CI_CLASS_SUBNET IRE item', () => {
    const subnet = subnetResponse.subnets[0];
    expect(mapSubnetToIREItem(subnet)).toEqual(expectedIRE.items[3]);
  });

  it('uses CI_CLASS_SUBNET as the className', () => {
    const item = mapSubnetToIREItem(subnetResponse.subnets[0]);
    expect(item.className).toBe(CI_CLASS_SUBNET);
  });
});

describe('mapLogicalDatacenterPlaceholder', () => {
  it('builds a placeholder CI identified by region', () => {
    expect(mapLogicalDatacenterPlaceholder('af-south-1')).toEqual(expectedIRE.items[1]);
  });

  it('uses CI_CLASS_LOGICAL_DATACENTER as the className', () => {
    expect(mapLogicalDatacenterPlaceholder('af-south-1').className).toBe(CI_CLASS_LOGICAL_DATACENTER);
  });
});

describe('mapCloudServiceAccountPlaceholder', () => {
  it('builds a placeholder CI identified by account_id', () => {
    expect(mapCloudServiceAccountPlaceholder('sandbox-1')).toEqual(expectedIRE.items[0]);
  });

  it('uses CI_CLASS_CLOUD_SERVICE_ACCOUNT as the className', () => {
    expect(mapCloudServiceAccountPlaceholder('sandbox-1').className).toBe(CI_CLASS_CLOUD_SERVICE_ACCOUNT);
  });
});

describe('buildIREPayload', () => {
  it('wraps both placeholders, mapped VPCs and Subnets, plus all 3 levels of containment relation, in the shape expected by createOrUpdateCI', () => {
    const payload = buildIREPayload(vpcResponse.vpcs, subnetResponse.subnets, 'af-south-1', 'sandbox-1');
    expect(payload).toEqual(expectedIRE);
  });

  it('handles empty vpc/subnet lists without throwing, and omits both placeholders when there are no VPCs', () => {
    expect(buildIREPayload([], [])).toEqual({ items: [], relations: [], unmatchedSubnetIds: [] });
    expect(buildIREPayload(undefined, undefined)).toEqual({ items: [], relations: [], unmatchedSubnetIds: [] });
  });

  it('relates the shared account/datacenter placeholders to every VPC, and each subnet to its own parent VPC by array index', () => {
    const vpcs = [{ id: 'vpc-a', name: 'a' }, { id: 'vpc-b', name: 'b' }];
    const subnets = [
      { id: 'subnet-a1', name: 'a1', vpc_id: 'vpc-a' },
      { id: 'subnet-b1', name: 'b1', vpc_id: 'vpc-b' }
    ];
    const payload = buildIREPayload(vpcs, subnets, 'af-south-1', 'sandbox-1');
    // items: [account(0), datacenter(1), vpc-a(2), vpc-b(3), subnet-a1(4), subnet-b1(5)]
    // HOSTING_RELATION_TYPE: parent = the dependent item, child = what it depends on
    // CONTAINMENT_RELATION_TYPE: parent = the container, child = the contained item (see buildIREPayload's comment)
    expect(payload.items).toHaveLength(6);
    expect(payload.relations).toEqual([
      { parent: '1', child: '0', type: HOSTING_RELATION_TYPE },
      { parent: '2', child: '1', type: HOSTING_RELATION_TYPE },
      { parent: '3', child: '1', type: HOSTING_RELATION_TYPE },
      { parent: '2', child: '4', type: CONTAINMENT_RELATION_TYPE },
      { parent: '3', child: '5', type: CONTAINMENT_RELATION_TYPE }
    ]);
  });

  it('reports a subnet whose vpc_id matches no vpc in this fetch as unmatched, without dropping or throwing', () => {
    const vpcs = [{ id: 'vpc-a', name: 'a' }];
    const subnets = [
      { id: 'subnet-a1', name: 'a1', vpc_id: 'vpc-a' },
      { id: 'subnet-orphan', name: 'orphan', vpc_id: 'vpc-missing' }
    ];
    const payload = buildIREPayload(vpcs, subnets, 'af-south-1', 'sandbox-1');
    // items: [account(0), datacenter(1), vpc-a(2), subnet-a1(3), subnet-orphan(4)]
    expect(payload.items).toHaveLength(5); // both subnets still get a CI item
    expect(payload.relations).toEqual([
      { parent: '1', child: '0', type: HOSTING_RELATION_TYPE },
      { parent: '2', child: '1', type: HOSTING_RELATION_TYPE },
      { parent: '2', child: '3', type: CONTAINMENT_RELATION_TYPE }
    ]);
    expect(payload.unmatchedSubnetIds).toEqual(['subnet-orphan']);
  });
});
