const { SOURCE_TYPES, normalizeEnvelope, validateEnvelope, isDuplicateEventId, buildCompositeEventId, fromLegacySmnAlarm } =
  require('../../../servicenow/hc-connector/lib/eventEnvelope');
const { buildEventFields } = require('../../../servicenow/event-management/lib/mapAlarmToEvent');
// Real captured Huawei Cloud Eye alarm, already verified end-to-end in servicenow/event-management/
// (see docs/ROADMAP.md) - reused here (not duplicated) to prove the standard envelope adapter is
// compatible with real data, not just a speculative shape.
const realCesAlarmPayload = require('../../../servicenow/event-management/fixtures/ces-alarm-payload.json');

describe('normalizeEnvelope', () => {
  it('fills in every field with a sane default when given an empty object', () => {
    expect(normalizeEnvelope({})).toEqual({
      event_id: null,
      source: null,
      event_type: null,
      account_id: null,
      region: null,
      resource_id: null,
      occurred_at: null,
      severity: null,
      status: 'unknown',
      payload: {},
      signature_version: null
    });
  });

  it('falls back to the given sourceType only when raw.source is absent', () => {
    expect(normalizeEnvelope({}, 'cts').source).toBe('cts');
    expect(normalizeEnvelope({ source: 'config' }, 'cts').source).toBe('config');
  });

  it('preserves all provided fields, including a falsy-but-meaningful severity/occurred_at of 0', () => {
    const envelope = normalizeEnvelope({ event_id: 'e1', source: 'cloud_eye', event_type: 't', severity: 0, occurred_at: 0 });
    expect(envelope.severity).toBe(0);
    expect(envelope.occurred_at).toBe(0);
  });

  it('does not mutate the input object', () => {
    const raw = { event_id: 'e1' };
    const original = { ...raw };
    normalizeEnvelope(raw);
    expect(raw).toEqual(original);
  });
});

describe('validateEnvelope', () => {
  it('is valid when event_id/source/event_type are all present', () => {
    const result = validateEnvelope({ event_id: 'e1', source: 'cloud_eye', event_type: 'cpu_util' });
    expect(result).toEqual({ valid: true, errors: [] });
  });

  it('reports every missing required field', () => {
    const result = validateEnvelope({});
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      'missing required field: event_id',
      'missing required field: source',
      'missing required field: event_type'
    ]));
  });

  it('flags a source outside SOURCE_TYPES', () => {
    const result = validateEnvelope({ event_id: 'e1', source: 'not_a_real_source', event_type: 't' });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('unrecognized source: not_a_real_source');
  });

  it('accepts every documented source type', () => {
    SOURCE_TYPES.forEach((source) => {
      const result = validateEnvelope({ event_id: 'e1', source, event_type: 't' });
      expect(result.valid).toBe(true);
    });
  });
});

describe('isDuplicateEventId', () => {
  it('works with a Set', () => {
    const seen = new Set(['e1', 'e2']);
    expect(isDuplicateEventId('e1', seen)).toBe(true);
    expect(isDuplicateEventId('e3', seen)).toBe(false);
  });

  it('works with a plain array', () => {
    expect(isDuplicateEventId('e1', ['e1', 'e2'])).toBe(true);
    expect(isDuplicateEventId('e3', ['e1', 'e2'])).toBe(false);
  });

  it('returns false for missing eventId or seenIds', () => {
    expect(isDuplicateEventId(null, ['e1'])).toBe(false);
    expect(isDuplicateEventId('e1', null)).toBe(false);
  });
});

describe('buildCompositeEventId', () => {
  it('composes alarmId:status:occurredAt', () => {
    expect(buildCompositeEventId('al123', 'alarm', 1000)).toBe('al123:alarm:1000');
  });

  it('defaults missing status/occurredAt to the literal "unknown", not falling silently to alarmId alone', () => {
    expect(buildCompositeEventId('al123')).toBe('al123:unknown:unknown');
  });

  it('throws without alarmId', () => {
    expect(() => buildCompositeEventId()).toThrow(/alarmId/);
  });
});

describe('fromLegacySmnAlarm', () => {
  it('wraps a real, already-verified CES alarm (via buildEventFields) into a valid standard envelope', () => {
    const eventFields = buildEventFields(realCesAlarmPayload);
    const envelope = fromLegacySmnAlarm(eventFields, {
      alarmId: realCesAlarmPayload.alarm_id,
      accountId: 'acct-sandbox',
      region: 'af-south-1',
      alarmStatus: realCesAlarmPayload.alarm_status
    });

    expect(validateEnvelope(envelope)).toEqual({ valid: true, errors: [] });
    expect(envelope.event_id).toBe(buildCompositeEventId(realCesAlarmPayload.alarm_id, realCesAlarmPayload.alarm_status, eventFields.time_of_event));
    expect(envelope.source).toBe('cloud_eye');
    expect(envelope.event_type).toBe('cpu_util');
    expect(envelope.resource_id).toBe('522d640b-c673-4cbe-9fd5-d3582d036396');
    expect(envelope.severity).toBe(1); // real payload: alarm_status "alarm", AlarmLevel "Critical"
    expect(envelope.status).toBe('firing');
    expect(envelope.signature_version).toBe('legacy-smn');
    expect(envelope.payload.description).toBe(realCesAlarmPayload.default_content);
    expect(envelope.payload.alarm_id).toBe(realCesAlarmPayload.alarm_id);
    expect(envelope.payload.correlation_key).toBe(realCesAlarmPayload.alarm_id);
  });

  it('maps an "ok" alarm_status to status "resolved"', () => {
    const recovered = { ...realCesAlarmPayload, alarm_status: 'ok' };
    const eventFields = buildEventFields(recovered);
    const envelope = fromLegacySmnAlarm(eventFields, { alarmId: recovered.alarm_id, alarmStatus: 'ok' });
    expect(envelope.status).toBe('resolved');
  });

  it('regression: firing and resolved notifications for the SAME alarm_id never collide on event_id', () => {
    const firing = { ...realCesAlarmPayload, alarm_status: 'alarm', time: 1000 };
    const resolved = { ...realCesAlarmPayload, alarm_status: 'ok', time: 2000 };

    const firingEnvelope = fromLegacySmnAlarm(buildEventFields(firing), { alarmId: firing.alarm_id, alarmStatus: 'alarm' });
    const resolvedEnvelope = fromLegacySmnAlarm(buildEventFields(resolved), { alarmId: resolved.alarm_id, alarmStatus: 'ok' });

    expect(firingEnvelope.event_id).not.toBe(resolvedEnvelope.event_id);
    // but both still carry the same correlation_key, so they can be linked as one alarm lifecycle
    expect(firingEnvelope.payload.correlation_key).toBe(resolvedEnvelope.payload.correlation_key);
  });

  it('prefers meta.messageId over the composite key when given (SMN message_id is already unique per delivery)', () => {
    const eventFields = buildEventFields(realCesAlarmPayload);
    const envelope = fromLegacySmnAlarm(eventFields, {
      alarmId: realCesAlarmPayload.alarm_id,
      messageId: 'smn-msg-abc123',
      alarmStatus: realCesAlarmPayload.alarm_status
    });
    expect(envelope.event_id).toBe('smn-msg-abc123');
  });

  it('throws without meta.alarmId', () => {
    const eventFields = buildEventFields(realCesAlarmPayload);
    expect(() => fromLegacySmnAlarm(eventFields, {})).toThrow(/alarmId/);
  });
});
