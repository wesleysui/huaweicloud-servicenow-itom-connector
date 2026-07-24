const { mapEvsToIREItem, getAttachedServerId, buildIREPayload, CI_CLASS_EVS, ATTACHED_RELATION_TYPE } =
  require('../../servicenow/discovery/lib/mapEvsToIRE');
const evsResponse = require('../../servicenow/discovery/fixtures/evs-volume-list-response.json');

// Documented-shape example built from Huawei's official EVS API docs and
// real resource IDs from earlier real-PDI sessions - not yet a live
// capture of THIS discovery flow specifically (EVS Discovery not yet
// real-PDI tested). Replace with a fresh real capture once tested.

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
  it('handles an empty volume list without throwing', () => {
    expect(buildIREPayload([], {})).toEqual({ items: [], relations: [], unmatchedServerIds: [] });
    expect(buildIREPayload(undefined, undefined)).toEqual({ items: [], relations: [], unmatchedServerIds: [] });
  });

  it('relates an attached volume to its ECS instance by REAL sys_id, not an array index', () => {
    const volumes = [evsResponse.volumes[0]]; // attached to server_id a1dcb4eb-...
    const ecsCiSysIdByServerId = { 'a1dcb4eb-2a08-4678-a385-6ef12beb2a3d': 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4' };
    const payload = buildIREPayload(volumes, ecsCiSysIdByServerId);
    expect(payload.items).toHaveLength(1);
    expect(payload.relations).toEqual([
      { parent: '0', child: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4', type: ATTACHED_RELATION_TYPE }
    ]);
    expect(payload.unmatchedServerIds).toEqual([]);
  });

  it('builds no relation for an unattached volume, without treating it as an error', () => {
    const volumes = [evsResponse.volumes[1]]; // no attachments
    const payload = buildIREPayload(volumes, {});
    expect(payload.items).toHaveLength(1);
    expect(payload.relations).toEqual([]);
    expect(payload.unmatchedServerIds).toEqual([]);
  });

  it('reports a volume attached to a server_id not in ecsCiSysIdByServerId as unmatched, without dropping or throwing', () => {
    const volumes = [evsResponse.volumes[0]];
    const payload = buildIREPayload(volumes, {}); // no ECS CIs known
    expect(payload.items).toHaveLength(1); // the volume still gets a CI item
    expect(payload.relations).toEqual([]);
    expect(payload.unmatchedServerIds).toEqual(['a1dcb4eb-2a08-4678-a385-6ef12beb2a3d']);
  });

  it('maps every volume in the fixture to an item, in order', () => {
    const payload = buildIREPayload(evsResponse.volumes, {});
    expect(payload.items).toHaveLength(evsResponse.volumes.length);
    expect(payload.items[0]).toEqual(mapEvsToIREItem(evsResponse.volumes[0]));
    expect(payload.items[1]).toEqual(mapEvsToIREItem(evsResponse.volumes[1]));
  });
});
