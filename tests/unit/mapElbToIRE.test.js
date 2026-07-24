const { mapElbToIREItem, buildIREPayload, CI_CLASS_ELB, CI_CLASS_LOGICAL_DATACENTER, CI_CLASS_CLOUD_SERVICE_ACCOUNT, HOSTING_RELATION_TYPE } =
  require('../../servicenow/discovery/lib/mapElbToIRE');
const elbResponse = require('../../servicenow/discovery/fixtures/elb-loadbalancer-list-response.json');

describe('mapElbToIREItem', () => {
  it('maps a Huawei ELB load balancer object to a CI_CLASS_ELB IRE item', () => {
    const lb = elbResponse.loadbalancers[0];
    expect(mapElbToIREItem(lb)).toEqual({
      className: CI_CLASS_ELB,
      values: {
        name: lb.name,
        correlation_id: lb.id,
        object_id: lb.id,
        ip_address: lb.vip_address,
        short_description: 'Huawei Cloud ELB Load Balancer - discovered via custom REST integration',
        discovery_source: 'Huawei Cloud Custom Discovery'
      }
    });
  });

  it('uses CI_CLASS_ELB as the className', () => {
    expect(mapElbToIREItem(elbResponse.loadbalancers[0]).className).toBe(CI_CLASS_ELB);
  });
});

describe('buildIREPayload', () => {
  it('returns empty items/relations for an empty list, with no placeholders', () => {
    expect(buildIREPayload([], 'af-south-1', 'sandbox-1')).toEqual({ items: [], relations: [] });
    expect(buildIREPayload(undefined, 'af-south-1', 'sandbox-1')).toEqual({ items: [], relations: [] });
  });

  it('builds the account/datacenter placeholder pair and relates every load balancer to the datacenter', () => {
    const loadBalancers = [{ id: 'lb-a', name: 'a', vip_address: '1.2.3.4' }, { id: 'lb-b', name: 'b', vip_address: '1.2.3.5' }];
    const payload = buildIREPayload(loadBalancers, 'af-south-1', 'sandbox-1');
    // items: [account(0), datacenter(1), lb-a(2), lb-b(3)]
    expect(payload.items).toHaveLength(4);
    expect(payload.items[0].className).toBe(CI_CLASS_CLOUD_SERVICE_ACCOUNT);
    expect(payload.items[1].className).toBe(CI_CLASS_LOGICAL_DATACENTER);
    expect(payload.items[2]).toEqual(mapElbToIREItem(loadBalancers[0]));
    expect(payload.items[3]).toEqual(mapElbToIREItem(loadBalancers[1]));
    expect(payload.relations).toEqual([
      { parent: '1', child: '0', type: HOSTING_RELATION_TYPE },
      { parent: '2', child: '1', type: HOSTING_RELATION_TYPE },
      { parent: '3', child: '1', type: HOSTING_RELATION_TYPE }
    ]);
  });

  it('identifies the placeholders by region/accountId', () => {
    const payload = buildIREPayload([{ id: 'lb-a', name: 'a' }], 'af-south-1', 'sandbox-1');
    expect(payload.items[0].values.account_id).toBe('sandbox-1');
    expect(payload.items[1].values.region).toBe('af-south-1');
  });
});
