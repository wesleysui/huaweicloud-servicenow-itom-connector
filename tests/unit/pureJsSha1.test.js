const crypto = require('crypto');
const { sha1Hex, hmacSha1Base64, utf8Bytes, bytesToBase64, bytesToHex } =
  require('../../servicenow/discovery/lib/pureJsSha1');

/**
 * Every expected value here is computed live via Node's own trusted `crypto`
 * module (not hand-typed/remembered hex), same verification strategy as
 * tests/unit/pureJsSha256.test.js.
 */

function nodeSha1Hex(str) {
  return crypto.createHash('sha1').update(str, 'utf8').digest('hex');
}

function nodeHmacSha1Base64(key, msg) {
  return crypto.createHmac('sha1', Buffer.from(key, 'utf8')).update(msg, 'utf8').digest('base64');
}

describe('sha1Hex (cross-checked against Node crypto)', () => {
  it.each([
    '',
    'abc',
    'Hi There',
    'The quick brown fox jumps over the lazy dog',
    'a'.repeat(1000), // spans multiple 64-byte blocks
    'unicode: café 中文 😀' // accented char, CJK, and a surrogate-pair emoji
  ])('matches Node crypto for %j', (input) => {
    expect(sha1Hex(input)).toBe(nodeSha1Hex(input));
  });
});

describe('hmacSha1Base64 (cross-checked against Node crypto)', () => {
  it.each([
    ['key', 'The quick brown fox jumps over the lazy dog'],
    ['\x0b'.repeat(20), 'Hi There'], // RFC 2202 test case 1 shape (20-byte key)
    ['Jefe', 'what do ya want for nothing?'], // RFC 2202 test case 2 shape
    ['a'.repeat(200), 'message with a key longer than the 64-byte block size'], // exercises the hash-the-key branch
    ['', ''],
    // Shape of an actual OBS StringToSign (GET, no headers, bucket-list
    // resource) - real-PDI confirmed exact newline count via a server-echoed
    // StringToSign in a 403 error, see HuaweiObsDiscovery.js's header comment
    ['SKDEMOSECRETKEY4567890abcdefghij', 'GET\n\n\nFri, 24 Jul 2026 03:12:45 GMT\n/']
  ])('matches Node crypto for key=%j msg=%j', (key, msg) => {
    expect(hmacSha1Base64(key, msg)).toBe(nodeHmacSha1Base64(key, msg));
  });
});

describe('bytesToBase64', () => {
  it('matches Buffer.toString("base64") across various lengths (padding edge cases)', () => {
    const cases = [
      [],
      [0],
      [0, 1],
      [0, 1, 2],
      [255, 254, 253, 252],
      utf8Bytes('The quick brown fox jumps over the lazy dog')
    ];
    cases.forEach((bytes) => {
      expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
    });
  });
});

describe('utf8Bytes / bytesToHex', () => {
  it('encodes ASCII text as single bytes', () => {
    expect(utf8Bytes('AB')).toEqual([0x41, 0x42]);
  });

  it('encodes a surrogate-pair emoji as 4 UTF-8 bytes', () => {
    expect(utf8Bytes('😀').length).toBe(4);
  });

  it('hex-encodes bytes with zero-padding', () => {
    expect(bytesToHex([0, 15, 255])).toBe('000fff');
  });
});
