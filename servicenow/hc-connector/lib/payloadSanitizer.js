/**
 * Sanitizes/truncates a payload before it's stored in
 * HC Event Ingestion Record.raw_payload (max_length 4000 - see
 * tables/hc_event_ingestion_record.schema.json). The table's description
 * already claims payloads are "sanitized/truncated" - this module is what
 * actually implements that claim.
 *
 * Two independent concerns, both applied by sanitizePayload():
 * 1. maskSensitiveFields() - recursively replaces any object key matching
 *    SENSITIVE_KEY_PATTERN with a fixed redaction marker, walking arrays
 *    and nested objects, guarding against circular references.
 * 2. truncatePayload() - serializes to JSON and caps the result at
 *    maxLength characters, handling non-serializable input instead of
 *    throwing.
 */

var SENSITIVE_KEY_PATTERN = /(password|secret|token|access[_-]?key|authorization|signature|credential|api[_-]?key)/i;
var REDACTED = '***REDACTED***';
var DEFAULT_MAX_SERIALIZED_LENGTH = 4000;
var TRUNCATION_MARKER = '...[truncated]';

/**
 * @param {*} value
 * @param {Array<*>} [seenObjects] - internal recursion guard against circular references
 * @returns {*} a deep copy of value with any object key matching SENSITIVE_KEY_PATTERN replaced by REDACTED
 */
function maskSensitiveFields(value, seenObjects) {
  seenObjects = seenObjects || [];

  if (value === null || typeof value !== 'object') {
    return value;
  }

  if (seenObjects.indexOf(value) !== -1) {
    return '[Circular]';
  }
  var nextSeen = seenObjects.concat([value]);

  if (Array.isArray(value)) {
    return value.map(function (item) { return maskSensitiveFields(item, nextSeen); });
  }

  var result = {};
  for (var key in value) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      result[key] = REDACTED;
    } else {
      result[key] = maskSensitiveFields(value[key], nextSeen);
    }
  }
  return result;
}

/**
 * @param {*} value
 * @returns {string|null} JSON string, or null if value cannot be serialized at all
 */
function safeStringify(value) {
  try {
    var serialized = JSON.stringify(value);
    return serialized === undefined ? null : serialized;
  } catch (e) {
    return null;
  }
}

/**
 * @param {*} value - already-masked value (or any value - masking is not required before calling this)
 * @param {number} [maxLength] - defaults to DEFAULT_MAX_SERIALIZED_LENGTH
 * @returns {{value: string, truncated: boolean, originalLength: number|null}}
 */
function truncatePayload(value, maxLength) {
  maxLength = maxLength == null ? DEFAULT_MAX_SERIALIZED_LENGTH : maxLength;
  var serialized = safeStringify(value);

  if (serialized == null) {
    return { value: '[Unserializable payload]', truncated: false, originalLength: null };
  }
  if (serialized.length <= maxLength) {
    return { value: serialized, truncated: false, originalLength: serialized.length };
  }
  var cut = Math.max(0, maxLength - TRUNCATION_MARKER.length);
  return { value: serialized.slice(0, cut) + TRUNCATION_MARKER, truncated: true, originalLength: serialized.length };
}

/**
 * Masks sensitive fields, then serializes and truncates - the single
 * function that should be used to build HC Event Ingestion Record.raw_payload.
 * @param {*} value
 * @param {number} [maxLength]
 * @returns {{value: string, truncated: boolean, originalLength: number|null}}
 */
function sanitizePayload(value, maxLength) {
  return truncatePayload(maskSensitiveFields(value), maxLength);
}

module.exports = {
  SENSITIVE_KEY_PATTERN: SENSITIVE_KEY_PATTERN,
  REDACTED: REDACTED,
  DEFAULT_MAX_SERIALIZED_LENGTH: DEFAULT_MAX_SERIALIZED_LENGTH,
  maskSensitiveFields: maskSensitiveFields,
  truncatePayload: truncatePayload,
  sanitizePayload: sanitizePayload
};
