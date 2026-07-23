const { mapSeverity, parseDimensionString, extractInstanceId, buildEventFields, isSmnConfirmation, parseSmnNotification } = require('../../servicenow/event-management/lib/mapAlarmToEvent');
const alarmPayload = require('../../servicenow/event-management/fixtures/ces-alarm-payload.json');
const notificationEnvelope = require('../../servicenow/event-management/fixtures/smn-notification-envelope.json');
const confirmationEnvelope = require('../../servicenow/event-management/fixtures/smn-subscription-confirmation.json');

describe('mapSeverity', () => {
  it.each([
    ['Critical', 1],
    ['Major', 2],
    ['Minor', 3],
    ['Informational', 4],
  ])('maps an "alarm" status with AlarmLevel %s to ServiceNow severity %i', (level, expected) => {
    expect(mapSeverity('alarm', level)).toBe(expected);
  });

  it('defaults to Warning (4) for an unrecognized level while alarm is firing', () => {
    expect(mapSeverity('alarm', 'SomethingUnknown')).toBe(4);
    expect(mapSeverity('alarm', undefined)).toBe(4);
  });

  it('maps an "ok" (recovered) status to 5 - OK/Clear, regardless of AlarmLevel', () => {
    expect(mapSeverity('ok', 'Critical')).toBe(5);
    expect(mapSeverity('ok', undefined)).toBe(5);
  });
});

describe('parseDimensionString', () => {
  it('extracts the value when the key is instance_id', () => {
    expect(parseDimensionString('instance_id:522d640b-c673-4cbe-9fd5-d3582d036396')).toBe('522d640b-c673-4cbe-9fd5-d3582d036396');
  });

  it('returns empty string for a different key, malformed input, or non-string', () => {
    expect(parseDimensionString('other_key:some-value')).toBe('');
    expect(parseDimensionString('no-colon-here')).toBe('');
    expect(parseDimensionString(undefined)).toBe('');
    expect(parseDimensionString(null)).toBe('');
  });
});

describe('extractInstanceId', () => {
  it('prefers template_variable.ResourceId when present', () => {
    expect(extractInstanceId(alarmPayload)).toBe('522d640b-c673-4cbe-9fd5-d3582d036396');
  });

  it('falls back to parsing the "dimension" string when template_variable is absent', () => {
    const { template_variable, ...withoutTemplateVar } = alarmPayload;
    expect(extractInstanceId(withoutTemplateVar)).toBe('522d640b-c673-4cbe-9fd5-d3582d036396');
  });

  it('returns empty string when neither source is usable', () => {
    expect(extractInstanceId({})).toBe('');
    expect(extractInstanceId({ template_variable: {}, dimension: 'other_key:x' })).toBe('');
  });
});

describe('isSmnConfirmation', () => {
  it('recognizes SubscriptionConfirmation and UnsubscribeConfirmation envelopes', () => {
    expect(isSmnConfirmation(confirmationEnvelope)).toBe(true);
    expect(isSmnConfirmation({ type: 'UnsubscribeConfirmation' })).toBe(true);
  });

  it('returns false for a Notification envelope or missing/invalid input', () => {
    expect(isSmnConfirmation(notificationEnvelope)).toBe(false);
    expect(isSmnConfirmation({ type: 'SomethingElse' })).toBe(false);
    expect(isSmnConfirmation(undefined)).toBe(false);
    expect(isSmnConfirmation({})).toBe(false);
  });
});

describe('parseSmnNotification', () => {
  it('unwraps the inner CES alarm JSON from a real-shaped Notification envelope', () => {
    const inner = parseSmnNotification(notificationEnvelope);
    expect(inner).toEqual(alarmPayload);
  });

  it('returns null for a non-Notification envelope', () => {
    expect(parseSmnNotification(confirmationEnvelope)).toBeNull();
  });

  it('returns null when envelope.message is missing or not valid JSON', () => {
    expect(parseSmnNotification({ type: 'Notification' })).toBeNull();
    expect(parseSmnNotification({ type: 'Notification', message: 'not json' })).toBeNull();
    expect(parseSmnNotification(undefined)).toBeNull();
  });
});

describe('buildEventFields', () => {
  it('maps a full, real-shaped CES alarm payload to em_event fields', () => {
    const fields = buildEventFields(alarmPayload);
    expect(fields).toEqual({
      source: 'Huawei Cloud Eye',
      severity: 1, // alarm_status: "alarm", AlarmLevel: "Critical"
      resource: '522d640b-c673-4cbe-9fd5-d3582d036396',
      node: 'wsl-manual-smoke-test-1784281457',
      type: 'cpu_util',
      description: alarmPayload.default_content,
      time_of_event: 1784563695475,
      _instance_id: '522d640b-c673-4cbe-9fd5-d3582d036396'
    });
  });

  it('maps severity to 5 (OK/Clear) for a recovery notification', () => {
    const recovered = { ...alarmPayload, alarm_status: 'ok' };
    expect(buildEventFields(recovered).severity).toBe(5);
  });

  it('falls back to a constructed description when default_content is missing', () => {
    const { default_content, ...withoutContent } = alarmPayload;
    const fields = buildEventFields(withoutContent);
    expect(fields.description).toBe('test-webhook-trigger - 5%');
  });

  it('falls back to instance_id for node when template_variable.ResourceName is missing', () => {
    const withoutResourceName = {
      ...alarmPayload,
      template_variable: { ...alarmPayload.template_variable, ResourceName: undefined }
    };
    expect(buildEventFields(withoutResourceName).node).toBe('522d640b-c673-4cbe-9fd5-d3582d036396');
  });
});
