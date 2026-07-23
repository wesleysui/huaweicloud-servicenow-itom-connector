const { buildCompositeKey, findDuplicateIndex, buildLookupConditions } =
  require('../../../servicenow/hc-connector/lib/compositeKey');
const syncStateSchema = require('../../../servicenow/hc-connector/tables/hc_resource_sync_state.schema.json');
const regionSchema = require('../../../servicenow/hc-connector/tables/hc_cloud_region.schema.json');

describe('buildCompositeKey', () => {
  it('joins the given fields in order into a stable string', () => {
    const record = { account: 'acct1', region: 'af-south-1', resource_type: 'ecs', native_key: 'i-123' };
    expect(buildCompositeKey(record, ['account', 'region', 'resource_type', 'native_key']))
      .toBe('acct1::af-south-1::ecs::i-123');
  });

  it('distinguishes records that differ in any single field', () => {
    const base = { account: 'a', region: 'r', resource_type: 'ecs', native_key: 'k' };
    const key1 = buildCompositeKey(base, ['account', 'region', 'resource_type', 'native_key']);
    const key2 = buildCompositeKey({ ...base, native_key: 'k2' }, ['account', 'region', 'resource_type', 'native_key']);
    expect(key1).not.toBe(key2);
  });

  it('throws when a key field is missing from the record', () => {
    expect(() => buildCompositeKey({ account: 'a' }, ['account', 'region'])).toThrow(/region/);
  });

  it('throws without record or fields', () => {
    expect(() => buildCompositeKey(null, ['account'])).toThrow(/record/);
    expect(() => buildCompositeKey({}, [])).toThrow(/fields/);
  });
});

describe('findDuplicateIndex', () => {
  const fields = ['account', 'region', 'resource_type', 'native_key'];

  it('returns an empty array when every record has a distinct composite key', () => {
    const records = [
      { account: 'a', region: 'r', resource_type: 'ecs', native_key: 'k1' },
      { account: 'a', region: 'r', resource_type: 'ecs', native_key: 'k2' }
    ];
    expect(findDuplicateIndex(records, fields)).toEqual([]);
  });

  it('flags a real collision (e.g. pagination overlap returning the same resource twice)', () => {
    const records = [
      { account: 'a', region: 'r', resource_type: 'ecs', native_key: 'k1' },
      { account: 'a', region: 'r', resource_type: 'ecs', native_key: 'k2' },
      { account: 'a', region: 'r', resource_type: 'ecs', native_key: 'k1' }
    ];
    const duplicates = findDuplicateIndex(records, fields);
    expect(duplicates).toEqual([{ key: 'a::r::ecs::k1', firstIndex: 0, duplicateIndex: 2 }]);
  });

  it('returns an empty array for an empty/undefined batch', () => {
    expect(findDuplicateIndex([], fields)).toEqual([]);
    expect(findDuplicateIndex(undefined, fields)).toEqual([]);
  });
});

describe('buildLookupConditions', () => {
  it('builds one field/value condition per key field, preserving order', () => {
    const record = { account: 'a', region: 'r' };
    expect(buildLookupConditions(record, ['account', 'region'])).toEqual([
      { field: 'account', value: 'a' },
      { field: 'region', value: 'r' }
    ]);
  });

  it('throws when a lookup field is missing', () => {
    expect(() => buildLookupConditions({ account: 'a' }, ['account', 'region'])).toThrow(/region/);
  });
});

describe('regression: unique_together in the schemas matches what these helpers are used for', () => {
  it('hc_resource_sync_state declares (account, region, resource_type, native_key) as unique_together', () => {
    expect(syncStateSchema.unique_together).toEqual([['account', 'region', 'resource_type', 'native_key']]);
  });

  it('hc_cloud_region declares (account, region) as unique_together', () => {
    expect(regionSchema.unique_together).toEqual([['account', 'region']]);
  });

  it('every field named in unique_together actually exists on the schema (catches typos/renames)', () => {
    [syncStateSchema, regionSchema].forEach((schema) => {
      const fieldNames = schema.fields.map((f) => f.name);
      schema.unique_together.forEach((group) => {
        group.forEach((fieldName) => {
          expect(fieldNames).toContain(fieldName);
        });
      });
    });
  });
});
