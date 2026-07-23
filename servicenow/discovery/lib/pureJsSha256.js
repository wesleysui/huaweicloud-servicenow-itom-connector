/**
 * Pure-JavaScript SHA-256 and HMAC-SHA256, operating entirely on byte arrays
 * (plain arrays of integers 0-255) using only ES5 arithmetic/bitwise ops -
 * no Node `crypto`, no ServiceNow-specific API, no Java interop.
 *
 * Why this exists: on a real ServiceNow scoped app, every platform-provided
 * crypto option turned out to be unavailable for this exact need - raw Java
 * interop (Packages.*) is blocked in scoped apps, GlideRSA (which has an
 * hmacSha256 method) doesn't exist on the test instance, and GlideDigest
 * exists but only exposes plain (unkeyed) hashing of text strings, not HMAC
 * or raw byte input. A pure-algorithm implementation sidesteps all of that -
 * it has no platform dependency to be missing or blocked, in any scope.
 *
 * Correctness is verified against the official RFC 4231 HMAC-SHA-256 test
 * vectors and cross-checked against Node's own `crypto` module - see
 * tests/unit/pureJsSha256.test.js. The ServiceNow port in
 * HuaweiECSDiscovery.js is intended to be a near-verbatim copy of this file
 * (no platform API translation needed) - keep them in sync.
 */

var K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
];

function rotr(x, n) {
  return ((x >>> n) | (x << (32 - n))) >>> 0;
}

/**
 * @param {number[]} bytes - array of integers 0-255
 * @returns {number[]} 32-byte digest as an array of integers 0-255
 */
function sha256Bytes(bytes) {
  var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];

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
    var w = new Array(64);
    for (var t = 0; t < 16; t++) {
      var o = chunkStart + t * 4;
      w[t] = ((padded[o] << 24) | (padded[o + 1] << 16) | (padded[o + 2] << 8) | padded[o + 3]) >>> 0;
    }
    for (t = 16; t < 64; t++) {
      var s0 = (rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3)) >>> 0;
      var s1 = (rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10)) >>> 0;
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
    }

    var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];

    for (t = 0; t < 64; t++) {
      var S1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
      var ch = ((e & f) ^ (~e & g)) >>> 0;
      var temp1 = (h + S1 + ch + K[t] + w[t]) >>> 0;
      var S0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
      var maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      var temp2 = (S0 + maj) >>> 0;

      h = g; g = f; f = e; e = (d + temp1) >>> 0;
      d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }

    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
  }

  var out = [];
  for (var j = 0; j < 8; j++) {
    out.push((H[j] >>> 24) & 0xff, (H[j] >>> 16) & 0xff, (H[j] >>> 8) & 0xff, H[j] & 0xff);
  }
  return out;
}

/**
 * @param {number[]} keyBytes
 * @param {number[]} msgBytes
 * @returns {number[]} 32-byte HMAC as an array of integers 0-255
 */
function hmacSha256Bytes(keyBytes, msgBytes) {
  var BLOCK_SIZE = 64;
  var key = keyBytes.slice();
  if (key.length > BLOCK_SIZE) key = sha256Bytes(key);
  while (key.length < BLOCK_SIZE) key.push(0);

  var ipad = new Array(BLOCK_SIZE);
  var opad = new Array(BLOCK_SIZE);
  for (var i = 0; i < BLOCK_SIZE; i++) {
    ipad[i] = key[i] ^ 0x36;
    opad[i] = key[i] ^ 0x5c;
  }

  var inner = sha256Bytes(ipad.concat(msgBytes));
  return sha256Bytes(opad.concat(inner));
}

/**
 * UTF-8 encode a JS string into a byte array. Same charCodeAt-based
 * surrogate-pair-aware algorithm as _percentEncode in HuaweiECSDiscovery.js.
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

function sha256Hex(str) {
  return bytesToHex(sha256Bytes(utf8Bytes(str)));
}

function hmacSha256Hex(keyStr, msgStr) {
  return bytesToHex(hmacSha256Bytes(utf8Bytes(keyStr), utf8Bytes(msgStr)));
}

module.exports = { sha256Bytes, hmacSha256Bytes, utf8Bytes, bytesToHex, sha256Hex, hmacSha256Hex };
