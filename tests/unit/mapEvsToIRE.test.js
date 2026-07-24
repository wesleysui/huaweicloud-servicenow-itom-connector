const { mapEvsToIREItem, getAttachedServerId, buildIREPayload, CI_CLASS_EVS, CI_CLASS_LOGICAL_DATACENTER, CI_CLASS_CLOUD_SERVICE_ACCOUNT, HOSTING_RELATION_TYPE } =
  require('../../servicenow/discovery/lib/mapEvsToIRE');
const evsResponse = require('../../servicenow/discovery/fixtures/evs-volume-list-response.json');

// Documented-shape example built from Huawei's official EVS API docs and
// real resource IDs from earlier real-PDI sessions.

describe('mapEvsToIREItem', () => {
  it('maps a Huawei EVS volume object to a CI_CLASS_EVS IRE item', () => {
    const volume = evsResponse.volumes[0];
    expect(mapEvsToIREItem(volume)).toEqual({
      className: CI_CLASS_EVS,
      values: {
        name: volume.name,
        correlation_id: volume.id,
        object_id: volume.id,
        short_description: 'Huawei Cloud EVS Volume - discovered via custom REST integration',
        discovery_source: 'Huawei Cloud Custom Discovery'
      }
    });
  });

  it('uses CI_CLASS_EVS as the className', () => {
    expect(mapEvsToIREItem(evsResponse.volumes[0]).className).toBe(CI_CLASS_EVS);
  });
});

describe('getAttachedServerId', () => {
  it('returns the server_id from the first attachment when present', () => {
    expect(getAttachedServerId(evsResponse.volumes[0])).toBe('a1dcb4eb-2a08-4678-a385-6ef12beb2a3d');
  });

  it('returns null for an unattached volume (empty attachments array)', () => {
    expect(getAttachedServerId(evsResponse.volumes[1])).toBeNull();
  });

  it('returns null when attachments is missing entirely', () => {
    expect(getAttachedServerId({ id: 'v-1', name: 'v-1' })).toBeNull();
  });
});

describe('buildIREPayload', () => {
  it('returns empty items/relations for an empty volume list, with no placeholders', () => {
    expect(buildIREPayload([], 'af-south-1', 'sandbox-1')).toEqual({ items: [], relations: [] });
    expect(buildIREPayload(undefined, 'af-south-1', 'sandbox-1')).toEqual({ items: [], relations: [] });
  });

  it('builds the account/datacenter placeholder pair and relates every volume to the datacenter', () => {
    const volumes = [{ id: 'v-a', name: 'a' }, { id: 'v-b', name: 'b' }];
    const payload = buildIREPayload(volumes, 'af-south-1', 'sandbox-1');
    // items: [account(0), datacenter(1), v-a(2), v-b(3)]
    expect(payload.items).toHaveLength(4);
    expect(payload.items[0].className).toBe(CI_CLASS_CLOUD_SERVICE_ACCOUNT);
    expect(payload.items[1].className).toBe(CI_CLASS_LOGICAL_DATACENTER);
    expect(payload.items[2]).toEqual(mapEvsToIREItem(volumes[0]));
    expect(payload.items[3]).toEqual(mapEvsToIREItem(volumes[1]));
    expect(payload.relations).toEqual([
      { parent: '1', child: '0', type: HOSTING_RELATION_TYPE },
      { parent: '2', child: '1', type: HOSTING_RELATION_TYPE },
      { parent: '3', child: '1', type: HOSTING_RELATION_TYPE }
    ]);
  });

  it('identifies the placeholders by region/accountId', () => {
    const payload = buildIREPayload([{ id: 'v-a', name: 'a' }], 'af-south-1', 'sandbox-1');
    expect(payload.items[0].values.account_id).toBe('sandbox-1');
    expect(payload.items[1].values.region).toBe('af-south-1');
  });
});
