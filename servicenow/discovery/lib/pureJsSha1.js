/**
 * Pure-JavaScript SHA-1, HMAC-SHA1, and byte<->base64/hex helpers, operating
 * entirely on byte arrays (plain arrays of integers 0-255) using only ES5
 * arithmetic/bitwise ops - no Node `crypto`, no ServiceNow-specific API, no
 * Java interop.
 *
 * Why this exists: OBS (Object Storage Service) is the ONE Huawei Cloud API
 * family in this project that does NOT use the IAM-wide "SDK-HMAC-SHA256"
 * signing scheme every other service here does (ECS/VPC/EVS/ELB/RDS) - it
 * uses its own, S3-compatible-style header signature:
 * `Authorization: OBS <AK>:Base64(HMAC-SHA1(SK, StringToSign))`. This is a
 * genuinely different crypto primitive (SHA-1, not SHA-256; base64 output,
 * not hex), so it can't reuse pureJsSha256.js - same platform constraint
 * applies though (see that file's header comment: Packages.* is blocked in
 * scoped apps, GlideRSA doesn't exist on the test instance, GlideDigest
 * can't do HMAC), so this is hand-rolled the same way.
 *
 * Correctness is verified against Node's own `crypto` module for both
 * sha1Bytes and hmacSha1Bytes, plus the official example signature from
 * Huawei's OBS API docs - see tests/unit/pureJsSha1.test.js. The ServiceNow
 * port in HuaweiObsDiscovery.js is intended to be a near-verbatim copy of
 * this file (no platform API translation needed) - keep them in sync.
 */

function rotl(x, n) {
  return ((x << n) | (x >>> (32 - n))) >>> 0;
}

/**
 * @param {number[]} bytes - array of integers 0-255
 * @returns {number[]} 20-byte digest as an array of integers 0-255
 */
function sha1Bytes(bytes) {
  var h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;

  var msgLen = bytes.length;
  var padded = bytes.slice();
  padded.push(0x80);
  while (padded.length % 64 !== 56) padded.push(0);

  // 64-bit big-endian bit length (message lengths here are always tiny, so
  // the high 32 bits are always 0)
  var bitLen = msgLen * 8;
  for (var i = 7; i >= 4; i--) padded.push(0);
  padded.push((bitLen >>> 24) & 0xff, (bitLen >>> 16) & 0xff, (bitLen >>> 8) & 0xff, bitLen & 0xff);

  for (var chunkStart = 0; chunkStart < padded.length; chunkStart += 64) {
    var w = new Array(80);
    for (var t = 0; t < 16; t++) {
      var o = chunkStart + t * 4;
      w[t] = ((padded[o] << 24) | (padded[o + 1] << 16) | (padded[o + 2] << 8) | padded[o + 3]) >>> 0;
    }
    for (t = 16; t < 80; t++) {
      w[t] = rotl((w[t - 3] ^ w[t - 8] ^ w[t - 14] ^ w[t - 16]) >>> 0, 1);
    }

    var a = h0, b = h1, c = h2, d = h3, e = h4;

    for (t = 0; t < 80; t++) {
      var f, k;
      if (t < 20) {
        f = ((b & c) | (~b & d)) >>> 0;
        k = 0x5a827999;
      } else if (t < 40) {
        f = (b ^ c ^ d) >>> 0;
        k = 0x6ed9eba1;
      } else if (t < 60) {
        f = ((b & c) | (b & d) | (c & d)) >>> 0;
        k = 0x8f1bbcdc;
      } else {
        f = (b ^ c ^ d) >>> 0;
        k = 0xca62c1d6;
      }

      var temp = (rotl(a, 5) + f + e + k + w[t]) >>> 0;
      e = d; d = c; c = rotl(b, 30); b = a; a = temp;
    }

    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0;
  }

  var H = [h0, h1, h2, h3, h4];
  var out = [];
  for (var j = 0; j < 5; j++) {
    out.push((H[j] >>> 24) & 0xff, (H[j] >>> 16) & 0xff, (H[j] >>> 8) & 0xff, H[j] & 0xff);
  }
  return out;
}

/**
 * @param {number[]} keyBytes
 * @param {number[]} msgBytes
 * @returns {number[]} 20-byte HMAC as an array of integers 0-255
 */
function hmacSha1Bytes(keyBytes, msgBytes) {
  var BLOCK_SIZE = 64;
  var key = keyBytes.slice();
  if (key.length > BLOCK_SIZE) key = sha1Bytes(key);
  while (key.length < BLOCK_SIZE) key.push(0);

  var ipad = new Array(BLOCK_SIZE);
  var opad = new Array(BLOCK_SIZE);
  for (var i = 0; i < BLOCK_SIZE; i++) {
    ipad[i] = key[i] ^ 0x36;
    opad[i] = key[i] ^ 0x5c;
  }

  var inner = sha1Bytes(ipad.concat(msgBytes));
  return sha1Bytes(opad.concat(inner));
}

/**
 * UTF-8 encode a JS string into a byte array. Same charCodeAt-based
 * surrogate-pair-aware algorithm as pureJsSha256.js's utf8Bytes.
 * @param {string} str
 * @returns {number[]}
 */
function utf8Bytes(str) {
  var bytes = [];
  for (var i = 0; i < str.length; i++) {
    var c = str.charCodeAt(i);
    if (c < 0x80) {
      bytes.push(c);
    } else if (c < 0x800) {
      bytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    } else if (c < 0xd800 || c >= 0xe000) {
      bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    } else {
      i++;
      var c2 = str.charCodeAt(i) & 0x3ff;
      var codepoint = 0x10000 + (((c & 0x3ff) << 10) | c2);
      bytes.push(
        0xf0 | (codepoint >> 18),
        0x80 | ((codepoint >> 12) & 0x3f),
        0x80 | ((codepoint >> 6) & 0x3f),
        0x80 | (codepoint & 0x3f)
      );
    }
  }
  return bytes;
}

function bytesToHex(bytes) {
  var hex = '';
  for (var i = 0; i < bytes.length; i++) {
    var b = bytes[i] & 0xff;
    hex += (b < 16 ? '0' : '') + b.toString(16);
  }
  return hex;
}

var BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * Standard base64 encoding (RFC 4648) of a byte array, with '=' padding -
 * no Buffer/btoa dependency, since neither is guaranteed available in a
 * ServiceNow scoped script's Rhino engine.
 * @param {number[]} bytes
 * @returns {string}
 */
function bytesToBase64(bytes) {
  var out = '';
  var i;
  for (i = 0; i + 3 <= bytes.length; i += 3) {
    var n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += BASE64_CHARS[(n >> 18) & 0x3f] + BASE64_CHARS[(n >> 12) & 0x3f] +
      BASE64_CHARS[(n >> 6) & 0x3f] + BASE64_CHARS[n & 0x3f];
  }
  var remaining = bytes.length - i;
  if (remaining === 1) {
    var n1 = bytes[i] << 16;
    out += BASE64_CHARS[(n1 >> 18) & 0x3f] + BASE64_CHARS[(n1 >> 12) & 0x3f] + '==';
  } else if (remaining === 2) {
    var n2 = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += BASE64_CHARS[(n2 >> 18) & 0x3f] + BASE64_CHARS[(n2 >> 12) & 0x3f] + BASE64_CHARS[(n2 >> 6) & 0x3f] + '=';
  }
  return out;
}

function sha1Hex(str) {
  return bytesToHex(sha1Bytes(utf8Bytes(str)));
}

/**
 * @param {string} keyStr
 * @param {string} msgStr
 * @returns {string} base64-encoded HMAC-SHA1 - the exact form OBS's
 *   Authorization header signature needs (Base64(HMAC-SHA1(SK, StringToSign)))
 */
function hmacSha1Base64(keyStr, msgStr) {
  return bytesToBase64(hmacSha1Bytes(utf8Bytes(keyStr), utf8Bytes(msgStr)));
}

module.exports = { sha1Bytes, hmacSha1Bytes, utf8Bytes, bytesToHex, bytesToBase64, sha1Hex, hmacSha1Base64 };
