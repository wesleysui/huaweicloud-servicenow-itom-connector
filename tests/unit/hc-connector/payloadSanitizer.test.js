const { REDACTED, DEFAULT_MAX_SERIALIZED_LENGTH, maskSensitiveFields, truncatePayload, sanitizePayload } =
  require('../../../servicenow/hc-connector/lib/payloadSanitizer');

describe('maskSensitiveFields', () => {
  it('redacts top-level keys matching common secret names', () => {
    const masked = maskSensitiveFields({ password: 'p1', secret: 's1', token: 't1', ok: 'keep-me' });
    expect(masked).toEqual({ password: REDACTED, secret: REDACTED, token: REDACTED, ok: 'keep-me' });
  });

  it('matches access_key/access-key/accessKey style variants and api_key/apiKey', () => {
    const masked = maskSensitiveFields({ access_key: 'AK1', accessKey: 'AK2', api_key: 'K1', apiKey: 'K2' });
    expect(masked.access_key).toBe(REDACTED);
    expect(masked.accessKey).toBe(REDACTED);
    expect(masked.api_key).toBe(REDACTED);
    expect(masked.apiKey).toBe(REDACTED);
  });

  it('recurses into nested objects', () => {
    const masked = maskSensitiveFields({ outer: { inner: { secret_key: 'sk1', name: 'ok' } } });
    expect(masked.outer.inner.secret_key).toBe(REDACTED);
    expect(masked.outer.inner.name).toBe('ok');
  });

  it('recurses into arrays of objects, masking each element independently', () => {
    const masked = maskSensitiveFields({ items: [{ token: 't1' }, { token: 't2', ok: 1 }] });
    expect(masked.items[0].token).toBe(REDACTED);
    expect(masked.items[1]).toEqual({ token: REDACTED, ok: 1 });
  });

  it('recurses into arrays nested inside arrays', () => {
    const masked = maskSensitiveFields({ groups: [[{ password: 'p' }], [{ ok: true }]] });
    expect(masked.groups[0][0].password).toBe(REDACTED);
    expect(masked.groups[1][0].ok).toBe(true);
  });

  it('leaves primitives, null, and non-matching keys untouched', () => {
    expect(maskSensitiveFields('hello')).toBe('hello');
    expect(maskSensitiveFields(42)).toBe(42);
    expect(maskSensitiveFields(null)).toBeNull();
    expect(maskSensitiveFields(undefined)).toBeUndefined();
    expect(maskSensitiveFields({ resource_id: 'r1' })).toEqual({ resource_id: 'r1' });
  });

  it('replaces a circular reference with a marker instead of infinite-looping', () => {
    const obj = { name: 'x' };
    obj.self = obj;
    const masked = maskSensitiveFields(obj);
    expect(masked.name).toBe('x');
    expect(masked.self).toBe('[Circular]');
  });

  it('handles a circular reference that also contains a sensitive field', () => {
    const obj = { token: 't1' };
    obj.nested = { back: obj };
    const masked = maskSensitiveFields(obj);
    expect(masked.token).toBe(REDACTED);
    expect(masked.nested.back).toBe('[Circular]');
  });
});

describe('truncatePayload', () => {
  it('returns the full serialized value when under the max length', () => {
    const result = truncatePayload({ a: 1 });
    expect(result).toEqual({ value: '{"a":1}', truncated: false, originalLength: 7 });
  });

  it('truncates a value whose serialized form exceeds maxLength, capping the result length', () => {
    const longString = 'x'.repeat(100);
    const result = truncatePayload({ text: longString }, 50);
    expect(result.truncated).toBe(true);
    expect(result.value.length).toBeLessThanOrEqual(50);
    expect(result.value.endsWith('...[truncated]')).toBe(true);
    expect(result.originalLength).toBeGreaterThan(50);
  });

  it('uses DEFAULT_MAX_SERIALIZED_LENGTH (matches HC Event Ingestion Record.raw_payload max_length) when no maxLength given', () => {
    expect(DEFAULT_MAX_SERIALIZED_LENGTH).toBe(4000);
    const longString = 'x'.repeat(5000);
    const result = truncatePayload(longString);
    expect(result.truncated).toBe(true);
    expect(result.value.length).toBeLessThanOrEqual(4000);
  });

  it('handles a genuinely non-serializable value (e.g. a BigInt) without throwing', () => {
    const result = truncatePayload({ big: BigInt(1) });
    expect(result).toEqual({ value: '[Unserializable payload]', truncated: false, originalLength: null });
  });

  it('handles nested arrays of arrays correctly when serializing', () => {
    const result = truncatePayload({ matrix: [[1, 2], [3, 4]] });
    expect(result.value).toBe('{"matrix":[[1,2],[3,4]]}');
  });
});

describe('sanitizePayload', () => {
  it('masks sensitive fields AND truncates in one call', () => {
    const longDescription = 'y'.repeat(4100);
    const result = sanitizePayload({ password: 'p1', description: longDescription }, 100);
    expect(result.value).not.toContain('p1');
    expect(result.value).toContain(JSON.stringify('***REDACTED***').slice(1, -1)); // redaction marker present in the serialized text
    expect(result.truncated).toBe(true);
    expect(result.value.length).toBeLessThanOrEqual(100);
  });

  it('never leaks a secret value even when the payload is large enough to be truncated', () => {
    const big = { access_key: 'AKIA-SUPER-SECRET', filler: 'z'.repeat(5000) };
    const result = sanitizePayload(big, 200);
    expect(result.value).not.toContain('AKIA-SUPER-SECRET');
  });

  it('round-trips a small, clean payload with no changes needed', () => {
    const result = sanitizePayload({ resource_id: 'i-123', severity: 1 });
    expect(JSON.parse(result.value)).toEqual({ resource_id: 'i-123', severity: 1 });
    expect(result.truncated).toBe(false);
  });
});
