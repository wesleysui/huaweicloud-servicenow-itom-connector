/**
 * Standard Event Envelope (see docs/ARCHITECTURE.md, phase 5 of the target
 * design): { event_id, source, event_type, account_id, region, resource_id,
 * occurred_at, severity, status, payload, signature_version }.
 *
 * No gateway exists yet (needs a real FunctionGraph/API Gateway account -
 * see Phase 1 risks in the plan). This module is the pure normalize/
 * validate/dedup logic the future gateway and the ServiceNow-side ingestion
 * will both depend on, plus fromLegacySmnAlarm() - an adapter proving the
 * envelope is compatible with the already-verified real CES/SMN flow in
 * servicenow/event-management/, not just a speculative shape.
 */

var SOURCE_TYPES = ['cloud_eye', 'cts', 'config', 'smn'];

var REQUIRED_FIELDS = ['event_id', 'source', 'event_type'];

/**
 * @param {Partial<Envelope>} raw
 * @param {string} [sourceType] - fallback for raw.source if absent
 * @returns {Envelope} a full envelope object with defaults filled in - does not mutate raw
 */
function normalizeEnvelope(raw, sourceType) {
  raw = raw || {};
  return {
    event_id: raw.event_id || null,
    source: raw.source || sourceType || null,
    event_type: raw.event_type || null,
    account_id: raw.account_id || null,
    region: raw.region || null,
    resource_id: raw.resource_id || null,
    occurred_at: raw.occurred_at != null ? raw.occurred_at : null,
    severity: raw.severity != null ? raw.severity : null,
    status: raw.status || 'unknown',
    payload: raw.payload || {},
    signature_version: raw.signature_version || null
  };
}

/**
 * @param {Partial<Envelope>} envelope
 * @returns {{valid: boolean, errors: string[]}}
 */
function validateEnvelope(envelope) {
  var errors = [];
  envelope = envelope || {};

  REQUIRED_FIELDS.forEach(function (field) {
    if (!envelope[field]) errors.push('missing required field: ' + field);
  });

  if (envelope.source && SOURCE_TYPES.indexOf(envelope.source) === -1) {
    errors.push('unrecognized source: ' + envelope.source);
  }

  return { valid: errors.length === 0, errors: errors };
}

/**
 * @param {string} eventId
 * @param {Set<string>|string[]} seenIds
 * @returns {boolean}
 */
function isDuplicateEventId(eventId, seenIds) {
  if (!eventId || !seenIds) return false;
  if (typeof seenIds.has === 'function') return seenIds.has(eventId);
  return seenIds.indexOf(eventId) !== -1;
}

/**
 * event_id for a legacy CES alarm CANNOT be the bare alarm_id: Cloud Eye
 * reuses the same alarm_id across a firing notification and its later
 * resolved notification (confirmed from real captured traffic this
 * session), and event_id has a global unique constraint
 * (HC Event Ingestion Record.event_id) - using alarm_id directly would
 * make the resolved notification collide with the firing one and get
 * rejected/dropped as a false-positive duplicate. Composing in status +
 * occurred_at keeps firing/resolved distinct while still deduping a true
 * redelivery of the *same* notification (identical alarm_id + status +
 * occurred_at).
 * @param {string} alarmId - raw CES alarm_id
 * @param {string} [alarmStatus] - raw CES alarm_status ("alarm"/"ok")
 * @param {number|string} [occurredAt] - eventFields.time_of_event
 * @returns {string}
 */
function buildCompositeEventId(alarmId, alarmStatus, occurredAt) {
  if (!alarmId) throw new Error('alarmId is required');
  return alarmId + ':' + (alarmStatus || 'unknown') + ':' + (occurredAt != null ? occurredAt : 'unknown');
}

/**
 * Adapter from the already-working CES/SMN alarm flow
 * (servicenow/event-management/lib/mapAlarmToEvent.js's buildEventFields()
 * output) into the standard envelope shape - proves the envelope is
 * provably compatible with real data, not speculative.
 *
 * @param {{source: string, severity: number, resource: string, node: string, type: string, description: string, time_of_event: number|string}} eventFields - output of buildEventFields() from event-management/lib/mapAlarmToEvent.js
 * @param {{alarmId: string, messageId?: string, accountId?: string, region?: string, alarmStatus?: string}} meta - alarmId is the raw CES alarm_id (required, used to build event_id and always carried through as payload.correlation_key so firing/resolved notifications for the same alarm can still be linked); messageId is the SMN envelope's message_id, preferred as event_id when available since it's already unique per delivery; alarmStatus is the raw CES alarm_status ("alarm"/"ok")
 * @returns {Envelope}
 */
function fromLegacySmnAlarm(eventFields, meta) {
  eventFields = eventFields || {};
  meta = meta || {};
  if (!meta.alarmId) throw new Error('meta.alarmId (the raw CES alarm_id) is required');

  var eventId = meta.messageId || buildCompositeEventId(meta.alarmId, meta.alarmStatus, eventFields.time_of_event);

  return normalizeEnvelope({
    event_id: eventId,
    source: 'cloud_eye',
    event_type: eventFields.type,
    account_id: meta.accountId || null,
    region: meta.region || null,
    resource_id: eventFields.resource,
    occurred_at: eventFields.time_of_event,
    severity: eventFields.severity,
    status: meta.alarmStatus === 'ok' ? 'resolved' : 'firing',
    payload: {
      description: eventFields.description,
      node: eventFields.node,
      alarm_id: meta.alarmId,
      correlation_key: meta.alarmId
    },
    signature_version: 'legacy-smn'
  });
}

module.exports = {
  SOURCE_TYPES: SOURCE_TYPES,
  normalizeEnvelope: normalizeEnvelope,
  validateEnvelope: validateEnvelope,
  isDuplicateEventId: isDuplicateEventId,
  buildCompositeEventId: buildCompositeEventId,
  fromLegacySmnAlarm: fromLegacySmnAlarm
};
