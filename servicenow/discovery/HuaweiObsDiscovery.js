// Script Include: HuaweiObsDiscovery
// HC ITOM Connector Phase 3 - OBS (Object Storage Service) BUCKET discovery
// only, never per-object (a bucket can hold millions of objects - out of
// scope permanently, not just "not yet built", see docs/RESOURCE-MATRIX.md).
// New sibling to HuaweiECSDiscovery.js/HuaweiVpcDiscovery.js/
// HuaweiEvsDiscovery.js/HuaweiElbDiscovery.js/HuaweiRdsDiscovery.js, not a
// modification of any of them - all five are real-PDI verified and
// intentionally left untouched.
//
// OBS is the ONE Huawei API family in this project that does NOT use the
// IAM-wide "SDK-HMAC-SHA256" scheme every other service here does - it
// uses its own, S3-compatible-style signature:
// `Authorization: OBS <AK>:Base64(HMAC-SHA1(SK, StringToSign))`, where
// StringToSign = HTTP-Verb + "\n" + Content-MD5 + "\n" + Content-Type +
// "\n" + Date + "\n" + CanonicalizedHeaders + CanonicalizedResource - NOT
// an extra "\n" between CanonicalizedHeaders and CanonicalizedResource
// (Huawei's own doc text reads as if there were one, but a real 403
// SignatureDoesNotMatch error echoed the server's own computed
// StringToSign back verbatim, byte-for-byte, proving there's exactly ONE
// newline before the resource path when CanonicalizedHeaders is empty).
// For this project's
// single GET-with-no-x-obs-headers ListBuckets call: Content-MD5/
// Content-Type/CanonicalizedHeaders are all empty, and
// CanonicalizedResource is "/" (bucket-list, no specific bucket) - so
// StringToSign is "GET\n\n\n" + Date + "\n/" (real-PDI confirmed via that
// same error echo). Date uses the native JS `Date.prototype.toUTCString()`
// (RFC 1123/"GMT" format) - this project already uses native `Date`
// elsewhere for timestamps (e.g. `new Date().getTime()` throughout
// service-graph/*.js); real-PDI confirmed OBS accepts this exact format
// (the server's echoed StringToSign contained our Date value unchanged).
//
// _sha1Bytes/_hmacSha1Bytes/_utf8Bytes/_bytesToHex/_bytesToBase64/_rotl
// below are copied byte-for-byte from lib/pureJsSha1.js (same "don't
// touch proven crypto, duplicate and drift-check instead" precedent as
// every other Discovery file here) - covered by check-mirror-drift.js's
// seventh PAIRS entry. See lib/pureJsSha1.js's header comment for the
// full rationale on why this needed a NEW hand-rolled primitive rather
// than reusing pureJsSha256.js (different algorithm, different platform
// constraint already established: Packages.* blocked, GlideRSA missing,
// GlideDigest can't do HMAC).
//
// Response is XML, not JSON - the only Huawei API family in this project
// that isn't JSON. Parsed via a targeted regex extraction
// (_parseBucketsXml, mirrors lib/parseObsBucketsXml.js), not a
// namespace-aware XML DOM parse - see that file's header comment for why
// (the response declares a default XML namespace, and this project has no
// established, real-PDI-confirmed pattern for namespace-aware node lookup
// in a ServiceNow scoped script).
//
// No pagination attempted - Huawei's ListBuckets docs mention no
// marker/limit params, unlike every other list endpoint in this project;
// real-PDI confirmed a single unpaginated call returns every bucket for
// a real account (5 buckets, all real names) - not yet confirmed this
// holds for accounts with a very large bucket count.
//
// CI class (CI_CLASS_OBS below) is `x_2021019_huawei_0_huawei_cloud_obs_bucket`,
// a dedicated class this project's own scoped app owns - NOT a borrowed
// platform class. A more specific object-storage class was researched and
// expected to exist, but doesn't on this instance (confirmed via a real
// sys_db_object query, zero results; two follow-up plugin installs -
// Service Mapping, then CMDB CI Class Models - both left it missing). The
// two real remaining generic candidates were checked field-by-field and
// both rejected on real semantic grounds: `cmdb_ci_cloud_storage_account`
// is shaped like a multi-service storage-account bundle (blob/file/queue/
// table services - OBS is flat, no account tier); `cmdb_ci_storage_container`
// is SAN/NAS-block-storage-shaped (total_size/controller fields, not
// cloud object storage). Since a dedicated class is the standard way to
// model a resource type with no clean generic fit, this project built its
// own - see lib/mapObsToIRE.js's header comment for the full investigation
// trail.
// Created via Studio, extending `cmdb_ci` directly (a more specific
// `cmdb_ci_cloud_resource_base` ancestor exists and would have been
// preferred, but wasn't extendable from this scoped app in Studio's
// table-creation UI - real-PDI observed). A manual Independent
// Identification Rule (criterion attribute `correlation_id`) was created
// via CI Class Manager, the same approach already proven for VPC/Subnet
// in Phase 2B. No relations attempted in this first version - a
// brand-new class has no OOTB containment/hosting rule registered at
// all, so this project's established "let the real error decide" process
// may not even surface one here; confirm on first real-PDI run. Bucket
// names (not a separate UUID, unlike every other resource type here) are
// the natural unique key - used as both `name` and `correlation_id`. No
// `object_id` - this class extends plain `cmdb_ci`, which doesn't have
// that field.
//
// Prerequisites: same System Properties as HuaweiECSDiscovery.js
// (x_hwc.itom.access_key/.secret_key, or the account-scoped
// x_hwc.itom.<account_id>.access_key/.secret_key names via
// HcConnectorObsSync's config) - reuse the same already-validated AK/SK,
// nothing new to provision.
var HuaweiObsDiscovery = Class.create();
HuaweiObsDiscovery.prototype = {
    CI_CLASS_OBS: 'x_2021019_huawei_0_huawei_cloud_obs_bucket',

    // config is OPTIONAL and additive, same shape as HuaweiECSDiscovery's -
    // see that file's initialize() comment for the full rationale.
    initialize: function(config) {
        config = config || {};
        var scopePrefix = gs.getCurrentScopeName() + '.';
        this.accountId       = config.accountId || null;
        this.region          = config.region || gs.getProperty(scopePrefix + 'x_hwc.itom.region', 'cn-north-4');
        this.maxRetries      = config.maxRetryAttempts != null ? parseInt(config.maxRetryAttempts, 10) : parseInt(gs.getProperty(scopePrefix + 'x_hwc.itom.max_retry_attempts', '3'), 10);
        this.retryableStatus = [429, 500, 502, 503, 504]; // mirrors lib/httpResilience.js
        this._explicitCredential = (config.accessKey && config.secretKey) ? { ak: config.accessKey, sk: config.secretKey } : null;
    },

    // ------------------------------------------------------------------
    // Fetch buckets (AK/SK signed, no pagination, no auth call)
    // ------------------------------------------------------------------
    // THROWS on a fetch failure - same "incomplete fetch must never look
    // like an empty result" invariant as HuaweiECSDiscovery.js.
    fetchBuckets: function() {
        var host = 'obs.' + this.region + '.myhuaweicloud.com';
        var date = new Date().toUTCString();
        var stringToSign = 'GET\n\n\n' + date + '\n/';
        var cred = this._getCredential();
        var signature = this._hmacSha1Base64(cred.sk, stringToSign);

        for (var attempt = 0; attempt <= this.maxRetries; attempt++) {
            try {
                var request = new sn_ws.RESTMessageV2();
                request.setHttpMethod('GET');
                request.setEndpoint('https://' + host + '/');
                request.setRequestHeader('Date', date);
                request.setRequestHeader('Authorization', 'OBS ' + cred.ak + ':' + signature);
                request.setRequestHeader('host', host);

                var response = request.execute();
                var status = response.getStatusCode();

                if (status == 200) {
                    return this._parseBucketsXml(response.getBody());
                }

                if (this._shouldRetry(status, attempt)) {
                    gs.warn('[HuaweiObsDiscovery] fetch got ' + status + ', retrying (attempt ' + attempt + ')');
                    gs.sleep(this._computeBackoffMs(attempt));
                    continue;
                }

                throw new Error('OBS fetch failed: ' + status + ' - ' + response.getBody());
            } catch (ex) {
                if (attempt >= this.maxRetries) throw ex;
                gs.warn('[HuaweiObsDiscovery] fetch exception on attempt ' + attempt + ': ' + ex.message);
            }
        }
        throw new Error('OBS fetch failed after retries');
    },

    // Mirrors lib/parseObsBucketsXml.js's parseBucketsXml() - see that
    // file's header comment for why this is regex-based, not a
    // namespace-aware XML DOM parse.
    _parseBucketsXml: function(xml) {
        xml = xml || '';
        var buckets = [];
        var bucketBlocks = xml.match(/<Bucket>[\s\S]*?<\/Bucket>/g) || [];

        for (var i = 0; i < bucketBlocks.length; i++) {
            var block = bucketBlocks[i];
            buckets.push({
                name: this._extractTag(block, 'Name'),
                creationDate: this._extractTag(block, 'CreationDate'),
                location: this._extractTag(block, 'Location'),
                bucketType: this._extractTag(block, 'BucketType')
            });
        }

        return buckets;
    },

    _extractTag: function(block, tagName) {
        var match = block.match(new RegExp('<' + tagName + '>([\\s\\S]*?)<\\/' + tagName + '>'));
        return match ? match[1] : '';
    },

    // ------------------------------------------------------------------
    // Map & reconcile via Identification & Reconciliation Engine
    // ------------------------------------------------------------------
    // Mirrors lib/mapObsToIRE.js's buildIREPayload() inline (ServiceNow
    // scoped scripts cannot require() - keep both in sync when changing
    // the mapping rules). No relations in this first version - see this
    // file's header comment.
    reconcileCIs: function(buckets) {
        buckets = buckets || [];
        if (!buckets.length) return;

        var items = [];

        for (var i = 0; i < buckets.length; i++) {
            var bucket = buckets[i];
            items.push({
                className: this.CI_CLASS_OBS,
                values: {
                    name: bucket.name || '',
                    correlation_id: bucket.name || '',
                    short_description: 'Huawei Cloud OBS Bucket - discovered via custom REST integration',
                    discovery_source: 'Huawei Cloud Custom Discovery'
                }
            });
        }

        // createOrUpdateCI takes TWO arguments: a source-identifier string,
        // then the payload as a JSON-encoded STRING (not an object). Return
        // value is ITSELF a JSON STRING - must JSON.parse() it. Both gotchas
        // already documented in HuaweiECSDiscovery.js/HuaweiVpcDiscovery.js.
        try {
            var payload = JSON.stringify({ items: items, relations: [] });
            var rawResult = sn_cmdb.IdentificationEngine.createOrUpdateCI('Huawei Cloud Custom Discovery', payload);
            gs.info('[HuaweiObsDiscovery] IRE result for ' + buckets.length + ' bucket(s): ' + rawResult);
            return JSON.parse(rawResult);
        } catch (ex) {
            gs.error('[HuaweiObsDiscovery] IRE exception: ' + ex.message);
        }
    },

    run: function() {
        var buckets = this.fetchBuckets();
        gs.info('[HuaweiObsDiscovery] Fetched ' + buckets.length + ' bucket(s)');
        if (buckets.length) this.reconcileCIs(buckets);
    },

    // ------------------------------------------------------------------
    // OBS AK/SK request signing (HMAC-SHA1 + base64) - mirrors
    // lib/pureJsSha1.js. Copied byte-for-byte, keep in sync via
    // check-mirror-drift.js's seventh PAIRS entry.
    // ------------------------------------------------------------------
    _hmacSha1Base64: function(keyStr, msgStr) {
        return this._bytesToBase64(this._hmacSha1Bytes(this._utf8Bytes(keyStr), this._utf8Bytes(msgStr)));
    },

    _rotl: function(x, n) {
        return ((x << n) | (x >>> (32 - n))) >>> 0;
    },

    _sha1Bytes: function(bytes) {
        var h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;

        var msgLen = bytes.length;
        var padded = bytes.slice();
        padded.push(0x80);
        while (padded.length % 64 !== 56) padded.push(0);

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
                w[t] = this._rotl((w[t - 3] ^ w[t - 8] ^ w[t - 14] ^ w[t - 16]) >>> 0, 1);
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

                var temp = (this._rotl(a, 5) + f + e + k + w[t]) >>> 0;
                e = d; d = c; c = this._rotl(b, 30); b = a; a = temp;
            }

            h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0;
        }

        var H = [h0, h1, h2, h3, h4];
        var out = [];
        for (var j = 0; j < 5; j++) {
            out.push((H[j] >>> 24) & 0xff, (H[j] >>> 16) & 0xff, (H[j] >>> 8) & 0xff, H[j] & 0xff);
        }
        return out;
    },

    _hmacSha1Bytes: function(keyBytes, msgBytes) {
        var BLOCK_SIZE = 64;
        var key = keyBytes.slice();
        if (key.length > BLOCK_SIZE) key = this._sha1Bytes(key);
        while (key.length < BLOCK_SIZE) key.push(0);

        var ipad = new Array(BLOCK_SIZE);
        var opad = new Array(BLOCK_SIZE);
        for (var i = 0; i < BLOCK_SIZE; i++) {
            ipad[i] = key[i] ^ 0x36;
            opad[i] = key[i] ^ 0x5c;
        }

        var inner = this._sha1Bytes(ipad.concat(msgBytes));
        return this._sha1Bytes(opad.concat(inner));
    },

    _utf8Bytes: function(str) {
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
    },

    _bytesToHex: function(bytes) {
        var hex = '';
        for (var i = 0; i < bytes.length; i++) {
            var b = bytes[i] & 0xFF; // Java bytes are signed - mask to unsigned
            hex += (b < 16 ? '0' : '') + b.toString(16);
        }
        return hex;
    },

    BASE64_CHARS: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/',

    _bytesToBase64: function(bytes) {
        var chars = this.BASE64_CHARS;
        var out = '';
        var i;
        for (i = 0; i + 3 <= bytes.length; i += 3) {
            var n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
            out += chars.charAt((n >> 18) & 0x3f) + chars.charAt((n >> 12) & 0x3f) +
                chars.charAt((n >> 6) & 0x3f) + chars.charAt(n & 0x3f);
        }
        var remaining = bytes.length - i;
        if (remaining === 1) {
            var n1 = bytes[i] << 16;
            out += chars.charAt((n1 >> 18) & 0x3f) + chars.charAt((n1 >> 12) & 0x3f) + '==';
        } else if (remaining === 2) {
            var n2 = (bytes[i] << 16) | (bytes[i + 1] << 8);
            out += chars.charAt((n2 >> 18) & 0x3f) + chars.charAt((n2 >> 12) & 0x3f) + chars.charAt((n2 >> 6) & 0x3f) + '=';
        }
        return out;
    },

    // ------------------------------------------------------------------
    // Retry/backoff - unchanged, mirrors lib/httpResilience.js
    // ------------------------------------------------------------------
    _shouldRetry: function(status, attempt) {
        return this.retryableStatus.indexOf(status) !== -1 && attempt < this.maxRetries;
    },

    _computeBackoffMs: function(attempt, baseMs, maxMs) {
        baseMs = baseMs || 500;
        maxMs = maxMs || 8000;
        var exponential = Math.min(maxMs, baseMs * Math.pow(2, attempt));
        var jitterRange = exponential * 0.2;
        return Math.round(exponential - jitterRange / 2 + Math.random() * jitterRange);
    },

    // ------------------------------------------------------------------
    // AK/SK credential resolution - identical to HuaweiECSDiscovery.js
    // ------------------------------------------------------------------
    _getCredential: function() {
        if (this._explicitCredential) return this._explicitCredential;
        var scopePrefix = gs.getCurrentScopeName() + '.';
        var ak = gs.getProperty(scopePrefix + 'x_hwc.itom.access_key');
        var sk = gs.getProperty(scopePrefix + 'x_hwc.itom.secret_key');
        if (!ak || !sk) throw new Error('x_hwc.itom.access_key / .secret_key system properties not configured');
        return { ak: ak, sk: sk };
    },

    type: 'HuaweiObsDiscovery'
};
