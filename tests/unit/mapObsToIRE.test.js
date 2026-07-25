const { mapObsToIREItem, buildIREPayload, CI_CLASS_OBS } = require('../../servicenow/discovery/lib/mapObsToIRE');

const bucket = { name: 'sandbox-1-obs', creationDate: '2026-07-24T03:12:45.032Z', location: 'af-south-1', bucketType: 'OBJECT' };

describe('mapObsToIREItem', () => {
  it('maps a parsed OBS bucket object to a CI_CLASS_OBS IRE item, keyed on name', () => {
    expect(mapObsToIREItem(bucket)).toEqual({
      className: CI_CLASS_OBS,
      values: {
        name: 'sandbox-1-obs',
        correlation_id: 'sandbox-1-obs',
        short_description: 'Huawei Cloud OBS Bucket - discovered via custom REST integration',
        discovery_source: 'Huawei Cloud Custom Discovery'
      }
    });
  });

  it('uses CI_CLASS_OBS as the className', () => {
    expect(mapObsToIREItem(bucket).className).toBe(CI_CLASS_OBS);
  });
});

describe('buildIREPayload', () => {
  it('returns empty items/relations for an empty list', () => {
    expect(buildIREPayload([])).toEqual({ items: [], relations: [] });
    expect(buildIREPayload(undefined)).toEqual({ items: [], relations: [] });
  });

  it('builds one item per bucket with no relations', () => {
    const payload = buildIREPayload([bucket]);
    expect(payload.items).toEqual([mapObsToIREItem(bucket)]);
    expect(payload.relations).toEqual([]);
  });
});
