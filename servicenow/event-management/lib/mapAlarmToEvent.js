/**
 * Pure mapping logic, unit-tested with Node/Jest outside the ServiceNow
 * runtime. Mirrored inline in webhook-scripted-rest.js because ServiceNow
 * scoped scripts cannot `require()` external modules, and because the Event
 * Rule Designer's Transform step is a no-code template UI with no scripting
 * option - see servicenow/event-management/README.md. Keep both in sync.
 *
 * Field shapes here reflect a REAL captured Huawei Cloud Eye (CES) alarm
 * notification (via SMN), not the CES API docs - several assumed field
 * names/shapes turned out wrong on the first live-account test (see
 * docs/ROADMAP.md): there is no top-level alarm_level (severity lives in
 * template_variable.AlarmLevel as a string), "dimension" is a single
 * "key:value" string rather than an array/object, "time" is epoch
 * milliseconds rather than an ISO string, and "resource_name"/"condition"
 * don't exist at the top level at all.
 */

// Huawei Cloud Eye template_variable.AlarmLevel is a string, not a number.
// ServiceNow em_event.severity: 1=Critical, 2=Major, 3=Minor, 4=Warning, 5=OK/Clear
const LEVEL_MAP = { Critical: 1, Major: 2, Minor: 3, Informational: 4 };

/**
 * @param {string} alarmStatus - raw.alarm_status ("alarm" while firing, "ok" once recovered)
 * @param {string} [alarmLevel] - raw.template_variable.AlarmLevel ("Critical"/"Major"/"Minor"/"Informational")
 * @returns {number} ServiceNow em_event severity - 5 (OK/Clear) once recovered, otherwise mapped from alarmLevel (defaults to 4 - Warning if unrecognized)
 */
function mapSeverity(alarmStatus, alarmLevel) {
  if (alarmStatus === 'ok') return 5;
  return LEVEL_MAP[alarmLevel] || 4;
}

/**
 * @param {string} [dimension] - raw.dimension, a single "key:value" string, e.g. "instance_id:522d640b-..."
 * @returns {string} the value portion if the key is 'instance_id', else ''
 */
function parseDimensionString(dimension) {
  if (typeof dimension !== 'string') return '';
  const idx = dimension.indexOf(':');
  if (idx === -1) return '';
  const key = dimension.slice(0, idx);
  const value = dimension.slice(idx + 1);
  return key === 'instance_id' ? value : '';
}

/**
 * @param {Object} raw - parsed CES alarm JSON
 * @returns {string} the Huawei ECS instance UUID, preferring the reliable template_variable.ResourceId, or '' if absent
 */
function extractInstanceId(raw) {
  const tv = raw.template_variable || {};
  if (tv.ResourceId) return tv.ResourceId;
  return parseDimensionString(raw.dimension);
}

// SMN wraps every push in an envelope; the real payload is a JSON string inside envelope.message.
const SMN_CONFIRMATION_TYPES = ['SubscriptionConfirmation', 'UnsubscribeConfirmation'];

/**
 * @param {{type?: string}} envelope - parsed top-level SMN webhook body
 * @returns {boolean} true if this is a subscription handshake message requiring a GET to subscribe_url
 */
function isSmnConfirmation(envelope) {
  return !!envelope && SMN_CONFIRMATION_TYPES.indexOf(envelope.type) !== -1;
}

/**
 * @param {{type?: string, message?: string}} envelope - parsed top-level SMN webhook body
 * @returns {Object|null} the parsed inner CES alarm JSON, or null if this isn't a Notification or the inner JSON is malformed
 */
function parseSmnNotification(envelope) {
  if (!envelope || envelope.type !== 'Notification' || !envelope.message) return null;
  try {
    return JSON.parse(envelope.message);
  } catch (e) {
    return null;
  }
}

/**
 * Map a raw Huawei Cloud Eye (CES) alarm payload (already unwrapped from the
 * SMN envelope via parseSmnNotification) into the fields needed on an
 * em_event record. Does NOT perform the CMDB CI lookup - that's configured
 * declaratively in the Event Rule's Binding step, not in code.
 * @param {Object} raw - parsed CES alarm JSON (see fixtures/ces-alarm-payload.json)
 * @returns {Object}
 */
function buildEventFields(raw) {
  const tv = raw.template_variable || {};
  const instanceId = extractInstanceId(raw);
  return {
    source: 'Huawei Cloud Eye',
    severity: mapSeverity(raw.alarm_status, tv.AlarmLevel),
    resource: instanceId,
    node: tv.ResourceName || instanceId,
    type: raw.metric_name,
    description: raw.default_content || `${raw.alarm_name || ''} - ${raw.value}${raw.unit}`,
    time_of_event: raw.time,
    _instance_id: instanceId // carried through for the CI lookup step
  };
}

module.exports = {
  mapSeverity,
  parseDimensionString,
  extractInstanceId,
  buildEventFields,
  isSmnConfirmation,
  parseSmnNotification,
  LEVEL_MAP
};
