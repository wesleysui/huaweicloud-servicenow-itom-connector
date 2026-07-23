const crypto = require('crypto');
const { sha256Hex, hmacSha256Hex, utf8Bytes } = require('../../servicenow/discovery/lib/pureJsSha256');

/**
 * Every expected value here is computed live via Node's own trusted `crypto`
 * module (not hand-typed/remembered hex), so these tests double as a
 * cross-check against a known-correct reference implementation - the same
 * verification strategy used for lib/huaweiAkSkSigner.js.
 */

function nodeSha256Hex(str) {
  return crypto.createHash('sha256').update(str, 'utf8').digest('hex');
}

function nodeHmacSha256Hex(key, msg) {
  return crypto.createHmac('sha256', Buffer.from(key, 'utf8')).update(msg, 'utf8').digest('hex');
}

describe('sha256Hex (cross-checked against Node crypto)', () => {
  it.each([
    '',
    'abc',
    'Hi There',
    'The quick brown fox jumps over the lazy dog',
    'a'.repeat(1000), // spans multiple 64-byte blocks
    'unicode: café 中文 😀' // accented char, CJK, and a surrogate-pair emoji
  ])('matches Node crypto for %j', (input) => {
    expect(sha256Hex(input)).toBe(nodeSha256Hex(input));
  });
});

describe('hmacSha256Hex (cross-checked against Node crypto)', () => {
  it.each([
    ['key', 'The quick brown fox jumps over the lazy dog'],
    ['\x0b'.repeat(20), 'Hi There'], // RFC 4231 test case 1 shape (20-byte key)
    ['Jefe', 'what do ya want for nothing?'], // RFC 4231 test case 2 shape
    ['a'.repeat(200), 'message with a key longer than the 64-byte block size'], // exercises the hash-the-key branch
    ['', ''],
    ['SKDEMOSECRETKEY4567890abcdefghij', 'SDK-HMAC-SHA256\n20260717T124913Z\nsomehash']
  ])('matches Node crypto for key=%j msg=%j', (key, msg) => {
    expect(hmacSha256Hex(key, msg)).toBe(nodeHmacSha256Hex(key, msg));
  });
});

describe('utf8Bytes', () => {
  it('encodes ASCII text as single bytes', () => {
    expect(utf8Bytes('AB')).toEqual([0x41, 0x42]);
  });

  it('encodes a surrogate-pair emoji as 4 UTF-8 bytes', () => {
    expect(utf8Bytes('😀').length).toBe(4);
  });
});

describe('end-to-end: pure-JS HMAC plugged into the AK/SK signer matches the official SDK', () => {
  it('reproduces the same signature as lib/huaweiAkSkSigner.js for the GET fixture', () => {
    // lib/huaweiAkSkSigner.js's own signature was already cross-verified
    // against the official @huaweicloud/huaweicloud-sdk-core package (see
    // tests/unit/huaweiAkSkSigner.test.js). This confirms the pure-JS HMAC
    // produces byte-identical output to Node's crypto.createHmac for the
    // exact stringToSign/key this project actually signs with.
    const SK = 'SKDEMOSECRETKEY4567890abcdefghij';
    const stringToSign = 'SDK-HMAC-SHA256\n20260717T124913Z\n' +
      nodeSha256Hex('GET\n/v1/eecc7ec81ad346adbcde0a07fa343cb0/cloudservers/detail/\nlimit=100&offset=0\n' +
        'content-type:application/json\nhost:ecs.af-south-1.myhuaweicloud.com\nx-sdk-date:20260717T124913Z\n\n' +
        'content-type;host;x-sdk-date\ne3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');

    expect(hmacSha256Hex(SK, stringToSign)).toBe(nodeHmacSha256Hex(SK, stringToSign));
    // This matches the known-correct signature from tests/unit/huaweiAkSkSigner.test.js
    expect(hmacSha256Hex(SK, stringToSign)).toBe(
      '19cceef388fd9380e0d9d9b28ae4585398f73ead7b7d375f2867b21c2f97ada4'
    );
  });
});
