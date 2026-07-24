const { mapRdsToIREItem, buildIREPayload, CI_CLASS_RDS, CI_CLASS_LOGICAL_DATACENTER, CI_CLASS_CLOUD_SERVICE_ACCOUNT, HOSTING_RELATION_TYPE } =
  require('../../servicenow/discovery/lib/mapRdsToIRE');
const rdsResponse = require('../../servicenow/discovery/fixtures/rds-instance-list-response.json');

describe('mapRdsToIREItem', () => {
  it('maps a Huawei RDS instance object to a CI_CLASS_RDS IRE item', () => {
    const instance = rdsResponse.instances[0];
    expect(mapRdsToIREItem(instance)).toEqual({
      className: CI_CLASS_RDS,
      values: {
        name: instance.name,
        correlation_id: instance.id,
        object_id: instance.id,
        ip_address: instance.private_ips[0],
        short_description: 'Huawei Cloud RDS Instance (MySQL 8.0) - discovered via custom REST integration',
        discovery_source: 'Huawei Cloud Custom Discovery'
      }
    });
  });

  it('uses CI_CLASS_RDS as the className', () => {
    expect(mapRdsToIREItem(rdsResponse.instances[0]).className).toBe(CI_CLASS_RDS);
  });

  it('handles a missing private_ips array without throwing', () => {
    expect(mapRdsToIREItem({ id: 'x', name: 'x' }).values.ip_address).toBe('');
  });
});

describe('buildIREPayload', () => {
  it('returns empty items/relations for an empty list, with no placeholders', () => {
    expect(buildIREPayload([], 'af-south-1', 'sandbox-1')).toEqual({ items: [], relations: [] });
    expect(buildIREPayload(undefined, 'af-south-1', 'sandbox-1')).toEqual({ items: [], relations: [] });
  });

  it('builds the account/datacenter placeholder pair and relates every instance to the datacenter', () => {
    const instances = [{ id: 'rds-a', name: 'a' }, { id: 'rds-b', name: 'b' }];
    const payload = buildIREPayload(instances, 'af-south-1', 'sandbox-1');
    // items: [account(0), datacenter(1), rds-a(2), rds-b(3)]
    expect(payload.items).toHaveLength(4);
    expect(payload.items[0].className).toBe(CI_CLASS_CLOUD_SERVICE_ACCOUNT);
    expect(payload.items[1].className).toBe(CI_CLASS_LOGICAL_DATACENTER);
    expect(payload.items[2]).toEqual(mapRdsToIREItem(instances[0]));
    expect(payload.items[3]).toEqual(mapRdsToIREItem(instances[1]));
    expect(payload.relations).toEqual([
      { parent: '1', child: '0', type: HOSTING_RELATION_TYPE },
      { parent: '2', child: '1', type: HOSTING_RELATION_TYPE },
      { parent: '3', child: '1', type: HOSTING_RELATION_TYPE }
    ]);
  });

  it('identifies the placeholders by region/accountId', () => {
    const payload = buildIREPayload([{ id: 'rds-a', name: 'a' }], 'af-south-1', 'sandbox-1');
    expect(payload.items[0].values.account_id).toBe('sandbox-1');
    expect(payload.items[1].values.region).toBe('af-south-1');
  });
});
