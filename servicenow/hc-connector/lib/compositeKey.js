/**
 * Pure helpers for enforcing "logically unique" composite keys at the
 * application layer.
 *
 * ServiceNow's table editor has no friendly UI for a true composite unique
 * DB constraint on a custom table the way simple per-field `unique: true`
 * does (sys_dictionary only supports single-column uniqueness cleanly).
 * `HC Resource Sync State` (account, region, resource_type, native_key) and
 * `HC Cloud Region` (account, region) both need this - see
 * `unique_together` in their schema.json files. The enforcement strategy
 * is application-layer upsert (look up by composite key before insert,
 * update if found) rather than a fabricated/unverified DB index - this
 * module is the pure, testable half of that; the ServiceNow-side wrapper
 * (Phase 2+) turns buildLookupConditions() into a GlideRecord query.
 */

/**
 * @param {Object} record
 * @param {string[]} fields - the unique_together field list, e.g. ["account", "region", "resource_type", "native_key"]
 * @returns {string} a stable, order-preserving key string
 */
function buildCompositeKey(record, fields) {
  if (!record) throw new Error('record is required');
  if (!fields || !fields.length) throw new Error('fields is required and must be non-empty');
  return fields.map(function (f) {
    var v = record[f];
    if (v == null) throw new Error('composite key field "' + f + '" is missing from record');
    return String(v);
  }).join('::');
}

/**
 * Finds records that collide on the given composite key within a single
 * in-memory batch (e.g. one discovery run's page results before any
 * ServiceNow write happens) - catches duplicate rows created by pagination
 * overlap/retries before they ever reach the platform layer.
 * @param {Object[]} records
 * @param {string[]} fields
 * @returns {Array<{key: string, firstIndex: number, duplicateIndex: number}>}
 */
function findDuplicateIndex(records, fields) {
  var seen = {};
  var duplicates = [];
  (records || []).forEach(function (record, index) {
    var key = buildCompositeKey(record, fields);
    if (Object.prototype.hasOwnProperty.call(seen, key)) {
      duplicates.push({ key: key, firstIndex: seen[key], duplicateIndex: index });
    } else {
      seen[key] = index;
    }
  });
  return duplicates;
}

/**
 * Builds a field/value condition list for an upsert-before-insert lookup
 * against the real ServiceNow table - the platform wrapper turns each
 * entry into `gr.addQuery(field, value)` before deciding insert vs. update.
 * @param {Object} record
 * @param {string[]} fields
 * @returns {Array<{field: string, value: *}>}
 */
function buildLookupConditions(record, fields) {
  if (!record) throw new Error('record is required');
  if (!fields || !fields.length) throw new Error('fields is required and must be non-empty');
  return fields.map(function (f) {
    if (record[f] == null) throw new Error('lookup field "' + f + '" is missing from record');
    return { field: f, value: record[f] };
  });
}

module.exports = {
  buildCompositeKey: buildCompositeKey,
  findDuplicateIndex: findDuplicateIndex,
  buildLookupConditions: buildLookupConditions
};
