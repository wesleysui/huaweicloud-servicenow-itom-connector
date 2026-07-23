const crypto = require('crypto');

/**
 * Huawei Cloud "AK/SK Signing and Authentication Algorithm" (SDK-HMAC-SHA256).
 * This is the standard signing scheme used to call Huawei Cloud service APIs
 * (ECS, VPC, etc.) directly with an Access Key / Secret Key pair, instead of
 * a username+password IAM token. Algorithm and field ordering verified
 * against the official `@huaweicloud/huaweicloud-sdk-core` npm package's
 * `AKSKSigner.sign()` (see tests/unit/huaweiAkSkSigner.test.js for the fixed
 * request whose expected signature was cross-checked byte-for-byte against
 * that package before being hardcoded as a test fixture).
 *
 * ServiceNow scoped scripts cannot use Node's `crypto` module directly - the
 * ServiceNow-side port (HuaweiECSDiscovery.js) reimplements the same
 * algorithm using Java interop (Packages.javax.crypto.Mac /
 * Packages.java.security.MessageDigest). Keep both in sync.
 */

const SDK_SIGNING_ALGORITHM = 'SDK-HMAC-SHA256';
const EMPTY_BODY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

// RFC 3986 unreserved characters are left unescaped; everything else (including
// !'()* which encodeURIComponent leaves alone) is percent-encoded, matching
// the official signer's byte-for-byte URI/query encoding.
const UNRESERVED = /^[A-Za-z0-9\-._~]$/;

function percentEncode(str) {
  return Array.from(String(str))
    .map((ch) => {
      if (UNRESERVED.test(ch)) return ch;
      const bytes = Buffer.from(ch, 'utf8');
      return Array.from(bytes)
        .map((b) => '%' + b.toString(16).toUpperCase().padStart(2, '0'))
        .join('');
    })
    .join('');
}

/**
 * @param {string} pathname - URI path, e.g. "/v1/{project_id}/cloudservers/detail"
 */
function canonicalURI(pathname) {
  if (!pathname) return pathname;
  let uri = pathname.split('/').map(percentEncode).join('/');
  if (!uri.endsWith('/')) uri += '/';
  return uri;
}

/**
 * @param {Object<string, string>} queryParams - flat key -> value (or key -> value[])
 */
function canonicalQueryString(queryParams) {
  const keys = Object.keys(queryParams || {}).sort();
  const parts = [];
  for (const key of keys) {
    const value = queryParams[key];
    const encodedKey = percentEncode(key);
    if (Array.isArray(value)) {
      for (const v of [...value].sort()) parts.push(encodedKey + '=' + percentEncode(v));
    } else {
      parts.push(encodedKey + '=' + percentEncode(value));
    }
  }
  return parts.join('&');
}

/**
 * @param {Object<string, string>} headers - all headers to be signed (already includes host + X-Sdk-Date)
 * @returns {{canonicalHeaders: string, signedHeaderNames: string}}
 */
function canonicalHeaders(headers) {
  const sortedKeys = Object.keys(headers).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  const signedHeaderNames = sortedKeys.map((k) => k.toLowerCase()).join(';');
  const canonical = sortedKeys.map((k) => `${k.toLowerCase()}:${headers[k]}\n`).join('');
  return { canonicalHeaders: canonical, signedHeaderNames };
}

function sha256Hex(str) {
  return crypto.createHash('sha256').update(str, 'utf8').digest('hex');
}

function hmacSha256Hex(secretKey, str) {
  return crypto.createHmac('sha256', secretKey).update(str, 'utf8').digest('hex');
}

const SDK_DATE_PATTERN = /^\d{8}T\d{6}Z$/;

/**
 * @param {string|Date} [date] - a JS Date, an ISO-8601 string, or an
 *   already-formatted "YYYYMMDDTHHmmssZ" string (returned as-is); if
 *   omitted, uses current time
 * @returns {string} UTC timestamp in "YYYYMMDDTHHmmssZ" format
 */
function formatSdkDate(date) {
  if (typeof date === 'string' && SDK_DATE_PATTERN.test(date)) return date;
  const d = date ? new Date(date) : new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return (
    d.getUTCFullYear() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    'T' +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    'Z'
  );
}

/**
 * Build the Authorization header (and X-Sdk-Date, if not already supplied) for
 * a Huawei Cloud API request.
 *
 * @param {Object} request
 * @param {string} request.method - e.g. 'GET'
 * @param {string} request.pathname - e.g. '/v1/{project_id}/cloudservers/detail'
 * @param {Object<string, string>} [request.queryParams] - e.g. { limit: '100', offset: '0' }
 * @param {string} request.host - e.g. 'ecs.af-south-1.myhuaweicloud.com'
 * @param {string} [request.body] - raw request body string, if any
 * @param {string} [request.sdkDate] - override timestamp (mainly for tests); defaults to now
 * @param {{ak: string, sk: string}} credential
 * @returns {{Authorization: string, 'X-Sdk-Date': string, host: string, 'Content-Type': string}}
 */
function sign(request, credential) {
  const sdkDate = formatSdkDate(request.sdkDate);
  const headersToSign = {
    'Content-Type': 'application/json',
    host: request.host,
    'X-Sdk-Date': sdkDate
  };

  const { canonicalHeaders: ch, signedHeaderNames } = canonicalHeaders(headersToSign);
  const uri = canonicalURI(request.pathname);
  const qs = canonicalQueryString(request.queryParams || {});
  const payloadHash = request.body ? sha256Hex(request.body) : EMPTY_BODY_SHA256;

  const canonicalRequest = [request.method.toUpperCase(), uri, qs, ch, signedHeaderNames, payloadHash].join('\n');
  const canonicalRequestHash = sha256Hex(canonicalRequest);
  const stringToSign = [SDK_SIGNING_ALGORITHM, sdkDate, canonicalRequestHash].join('\n');
  const signature = hmacSha256Hex(credential.sk, stringToSign);

  return {
    Authorization: `${SDK_SIGNING_ALGORITHM} Access=${credential.ak}, SignedHeaders=${signedHeaderNames}, Signature=${signature}`,
    'X-Sdk-Date': sdkDate,
    host: request.host,
    'Content-Type': headersToSign['Content-Type']
  };
}

module.exports = { sign, canonicalURI, canonicalQueryString, canonicalHeaders, formatSdkDate, EMPTY_BODY_SHA256, SDK_SIGNING_ALGORITHM };
