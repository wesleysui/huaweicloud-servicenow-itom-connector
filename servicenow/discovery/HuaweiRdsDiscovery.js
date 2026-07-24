// Script Include: HuaweiRdsDiscovery
// HC ITOM Connector Phase 3 - RDS (Relational Database Service) discovery.
// New sibling to HuaweiECSDiscovery.js/HuaweiVpcDiscovery.js/
// HuaweiEvsDiscovery.js/HuaweiElbDiscovery.js, not a modification of any
// of them - all four are real-PDI verified and intentionally left
// untouched.
//
// RDS uses its own API family (rds.{region}.myhuaweicloud.com per
// research - NOT YET real-PDI confirmed, correct on first run if wrong,
// same as every host assumption in this project before its first real
// call), not ECS's/VPC's/EVS's/ELB's host, so this is a new file rather
// than folding into an existing one.
//
// Auth: identical AK/SK "SDK-HMAC-SHA256" signing scheme as
// HuaweiECSDiscovery.js - see that file's header comment for the full
// rationale. _sign/_formatSdkDate/_canonicalURI/_canonicalQueryString/
// _percentEncode/_hexByte/_sha256Hex/_hmacSha256Hex/SHA256_K/_rotr/
// _sha256Bytes/_hmacSha256Bytes/_utf8Bytes/_bytesToHex/_shouldRetry/
// _computeBackoffMs/_getCredential below are copied byte-for-byte from
// HuaweiECSDiscovery.js (same "don't touch proven crypto, duplicate and
// drift-check instead" precedent) - covered by check-mirror-drift.js's
// sixth PAIRS entry.
//
// Pagination: GET /v3/{project_id}/instances uses `offset` as a row
// INDEX (not a page number, per Huawei's official docs' own wording:
// "the query starts from the next piece of data indexed by this
// parameter") plus a real `total_count` field in the response - a
// genuine hybrid of ECS's page-number style and EVS's no-total-count
// style. Real-PDI confirmed (fetch succeeded). Stops on either a short
// page OR when total_count is reached, whichever comes first.
//
// CI class (CI_CLASS_RDS below) is `cmdb_ci_cloud_database`, ServiceNow's
// standard CMDB class for cloud-managed database instances - real-PDI
// confirmed to exist (a real MISSING_DEPENDENCY error named it). Real
// OOTB containment rule: `Hosted on::Hosts -> cmdb_ci_logical_datacenter`
// - the same pattern already proven for VPC/Security Group/EVS/ELB. Each
// RDS instance relates to a local cloud_service_account/
// logical_datacenter placeholder pair, same pattern as EVS/ELB.
// `object_id` was included proactively and turned out to be right - no
// MISSING_MATCHING_ATTRIBUTES error, unlike ELB's first pass. See
// lib/mapRdsToIRE.js's header comment for the full reasoning.
//
// Prerequisites: same System Properties as HuaweiECSDiscovery.js
// (x_hwc.itom.access_key/.secret_key, or the account-scoped
// x_hwc.itom.<account_id>.access_key/.secret_key names via
// HcConnectorRdsSync's config) - reuse the same already-validated AK/SK,
// nothing new to provision.
var HuaweiRdsDiscovery = Class.create();
HuaweiRdsDiscovery.prototype = {
    CI_CLASS_RDS: 'cmdb_ci_cloud_database',
    CI_CLASS_LOGICAL_DATACENTER: 'cmdb_ci_logical_datacenter',
    CI_CLASS_CLOUD_SERVICE_ACCOUNT: 'cmdb_ci_cloud_service_account',
    HOSTING_RELATION_TYPE: 'Hosted on::Hosts',

    // config is OPTIONAL and additive, same shape as HuaweiECSDiscovery's -
    // see that file's initialize() comment for the full rationale.
    initialize: function(config) {
        config = config || {};
        var scopePrefix = gs.getCurrentScopeName() + '.';
        this.accountId       = config.accountId || null;
        this.region          = config.region || gs.getProperty(scopePrefix + 'x_hwc.itom.region', 'cn-north-4');
        this.projectId       = config.projectId || gs.getProperty(scopePrefix + 'x_hwc.itom.project_id');
        this.pageLimit       = config.pageLimit != null ? parseInt(config.pageLimit, 10) : parseInt(gs.getProperty(scopePrefix + 'x_hwc.itom.page_limit', '100'), 10);
        this.maxRetries      = config.maxRetryAttempts != null ? parseInt(config.maxRetryAttempts, 10) : parseInt(gs.getProperty(scopePrefix + 'x_hwc.itom.max_retry_attempts', '3'), 10);
        this.retryableStatus = [429, 500, 502, 503, 504]; // mirrors lib/httpResilience.js
        this._explicitCredential = (config.accessKey && config.secretKey) ? { ak: config.accessKey, sk: config.secretKey } : null;
    },

    // ------------------------------------------------------------------
    // Fetch RDS instances, paginated, with retry (AK/SK signed, no auth call)
    // ------------------------------------------------------------------
    // THROWS on a page fetch failure - same "incomplete fetch must never
    // look like an empty result" invariant as HuaweiECSDiscovery.js.
    fetchInstances: function() {
        var allInstances = [];
        var offset = 0;

        while (true) {
            var page = this._fetchPage(offset);

            if (page === null) {
                throw new Error('RDS fetch failed at offset ' + offset + ' after retries - see the prior gs.error log for the underlying status/exception');
            }

            allInstances = allInstances.concat(page.instances);

            var continuePaging = this._shouldFetchNextPage({
                pageInstanceCount: page.instances.length,
                limit: this.pageLimit,
                totalFetched: allInstances.length,
                totalCount: page.totalCount
            });
            if (!continuePaging) break;
            offset += this.pageLimit;
        }

        return allInstances;
    },

    _fetchPage: function(offset) {
        var host = 'rds.' + this.region + '.myhuaweicloud.com';
        var pathname = '/v3/' + this.projectId + '/instances';

        for (var attempt = 0; attempt <= this.maxRetries; attempt++) {
            try {
                var signed = this._sign({
                    method: 'GET',
                    pathname: pathname,
                    host: host,
                    queryParams: { limit: String(this.pageLimit), offset: String(offset) }
                });

                var request = new sn_ws.RESTMessageV2();
                request.setHttpMethod('GET');
                request.setEndpoint('https://' + host + pathname + '?limit=' + this.pageLimit + '&offset=' + offset);
                request.setRequestHeader('Content-Type', signed['Content-Type']);
                request.setRequestHeader('X-Sdk-Date', signed['X-Sdk-Date']);
                request.setRequestHeader('Authorization', signed['Authorization']);
                request.setRequestHeader('host', host);

                var response = request.execute();
                var status = response.getStatusCode();

                if (status == 200) {
                    var body = JSON.parse(response.getBody());
                    return { instances: body.instances || [], totalCount: body.total_count };
                }

                if (this._shouldRetry(status, attempt)) {
                    gs.warn('[HuaweiRdsDiscovery] fetch got ' + status + ' at offset ' + offset + ', retrying (attempt ' + attempt + ')');
                    gs.sleep(this._computeBackoffMs(attempt));
                    continue;
                }

                gs.error('[HuaweiRdsDiscovery] fetch failed at offset ' + offset + ': ' + status + ' - ' + response.getBody());
                return null;
            } catch (ex) {
                gs.error('[HuaweiRdsDiscovery] fetch exception at offset ' + offset + ': ' + ex.message);
                return null;
            }
        }
        return null;
    },

    // ------------------------------------------------------------------
    // Map & reconcile via Identification & Reconciliation Engine
    // ------------------------------------------------------------------
    // Mirrors lib/mapRdsToIRE.js's buildIREPayload() inline (ServiceNow
    // scoped scripts cannot require() - keep both in sync when changing the
    // mapping rules). Every instance relates to a local
    // cloud_service_account/logical_datacenter placeholder pair via
    // Hosted on::Hosts, real-PDI confirmed - see this file's header
    // comment.
    reconcileCIs: function(instances) {
        instances = instances || [];
        if (!instances.length) return;

        var items = [];
        var relations = [];

        items.push({
            className: this.CI_CLASS_CLOUD_SERVICE_ACCOUNT,
            values: {
                name: 'Huawei Cloud Account - ' + this.accountId,
                account_id: this.accountId,
                datacenter_type: this.CI_CLASS_LOGICAL_DATACENTER,
                short_description: 'Placeholder representing the Huawei Cloud account for logical-datacenter containment relationships'
            }
        });
        var accountIndex = items.length - 1;

        items.push({
            className: this.CI_CLASS_LOGICAL_DATACENTER,
            values: {
                name: 'Huawei Cloud - ' + this.region,
                region: this.region,
                short_description: 'Placeholder representing the Huawei Cloud region for RDS containment relationships'
            }
        });
        var datacenterIndex = items.length - 1;
        relations.push({ parent: String(datacenterIndex), child: String(accountIndex), type: this.HOSTING_RELATION_TYPE });

        for (var i = 0; i < instances.length; i++) {
            var instance = instances[i];
            var datastore = instance.datastore || {};
            var privateIps = instance.private_ips || [];
            items.push({
                className: this.CI_CLASS_RDS,
                values: {
                    name: instance.name || '',
                    correlation_id: instance.id || '',
                    object_id: instance.id || '',
                    ip_address: privateIps[0] || '',
                    short_description: 'Huawei Cloud RDS Instance (' + (datastore.type || '') + ' ' + (datastore.version || '') + ') - discovered via custom REST integration',
                    discovery_source: 'Huawei Cloud Custom Discovery'
                }
            });
            var itemIndex = items.length - 1;
            relations.push({ parent: String(itemIndex), child: String(datacenterIndex), type: this.HOSTING_RELATION_TYPE });
        }

        // createOrUpdateCI takes TWO arguments: a source-identifier string,
        // then the payload as a JSON-encoded STRING (not an object). Return
        // value is ITSELF a JSON STRING - must JSON.parse() it. Both gotchas
        // already documented in HuaweiECSDiscovery.js/HuaweiVpcDiscovery.js.
        try {
            var payload = JSON.stringify({ items: items, relations: relations });
            var rawResult = sn_cmdb.IdentificationEngine.createOrUpdateCI('Huawei Cloud Custom Discovery', payload);
            gs.info('[HuaweiRdsDiscovery] IRE result for ' + instances.length + ' instance(s): ' + rawResult);
            return JSON.parse(rawResult);
        } catch (ex) {
            gs.error('[HuaweiRdsDiscovery] IRE exception: ' + ex.message);
        }
    },

    run: function() {
        var instances = this.fetchInstances();
        gs.info('[HuaweiRdsDiscovery] Fetched ' + instances.length + ' instance(s) across all pages');
        if (instances.length) this.reconcileCIs(instances);
    },

    // ------------------------------------------------------------------
    // AK/SK request signing (SDK-HMAC-SHA256) - mirrors lib/huaweiAkSkSigner.js
    // Copied byte-for-byte from HuaweiECSDiscovery.js - see that file's
    // header comment for the full rationale. Keep in sync via
    // check-mirror-drift.js's sixth PAIRS entry.
    // ------------------------------------------------------------------
    EMPTY_BODY_SHA256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',

    _sign: function(req) {
        var cred = this._getCredential();
        var sdkDate = this._formatSdkDate();
        var headers = { 'Content-Type': 'application/json', host: req.host, 'X-Sdk-Date': sdkDate };

        var sortedHeaderKeys = Object.keys(headers).sort(function(a, b) {
            var la = a.toLowerCase(), lb = b.toLowerCase();
            return la < lb ? -1 : (la > lb ? 1 : 0);
        });
        var signedHeaderNames = sortedHeaderKeys.map(function(k) { return k.toLowerCase(); }).join(';');
        var canonicalHeaders = '';
        for (var i = 0; i < sortedHeaderKeys.length; i++) {
            canonicalHeaders += sortedHeaderKeys[i].toLowerCase() + ':' + headers[sortedHeaderKeys[i]] + '\n';
        }

        var uri = this._canonicalURI(req.pathname);
        var qs = this._canonicalQueryString(req.queryParams || {});
        var payloadHash = req.body ? this._sha256Hex(req.body) : this.EMPTY_BODY_SHA256;

        var canonicalRequest = [req.method.toUpperCase(), uri, qs, canonicalHeaders, signedHeaderNames, payloadHash].join('\n');
        var canonicalRequestHash = this._sha256Hex(canonicalRequest);
        var stringToSign = ['SDK-HMAC-SHA256', sdkDate, canonicalRequestHash].join('\n');
        var signature = this._hmacSha256Hex(cred.sk, stringToSign);

        return {
            Authorization: 'SDK-HMAC-SHA256 Access=' + cred.ak + ', SignedHeaders=' + signedHeaderNames + ', Signature=' + signature,
            'X-Sdk-Date': sdkDate,
            'Content-Type': headers['Content-Type']
        };
    },

    _formatSdkDate: function() {
        var v = new GlideDateTime().getValue(); // e.g. "2026-07-17 12:49:13"
        return v.substring(0, 4) + v.substring(5, 7) + v.substring(8, 10) + 'T' +
            v.substring(11, 13) + v.substring(14, 16) + v.substring(17, 19) + 'Z';
    },

    _canonicalURI: function(pathname) {
        if (!pathname) return pathname;
        var segments = pathname.split('/');
        for (var i = 0; i < segments.length; i++) segments[i] = this._percentEncode(segments[i]);
        var uri = segments.join('/');
        if (uri.charAt(uri.length - 1) !== '/') uri += '/';
        return uri;
    },

    _canonicalQueryString: function(queryParams) {
        var keys = Object.keys(queryParams).sort();
        var parts = [];
        for (var i = 0; i < keys.length; i++) {
            parts.push(this._percentEncode(keys[i]) + '=' + this._percentEncode(queryParams[keys[i]]));
        }
        return parts.join('&');
    },

    _percentEncode: function(str) {
        str = String(str);
        var out = '';
        for (var i = 0; i < str.length; i++) {
            var c = str.charCodeAt(i);
            if ((c >= 0x41 && c <= 0x5A) || (c >= 0x61 && c <= 0x7A) || (c >= 0x30 && c <= 0x39) ||
                c === 0x2D || c === 0x2E || c === 0x5F || c === 0x7E) {
                out += str.charAt(i);
                continue;
            }
            if (c < 0x80) {
                out += this._hexByte(c);
            } else if (c < 0x800) {
                out += this._hexByte(0xC0 | (c >> 6)) + this._hexByte(0x80 | (c & 0x3F));
            } else if (c < 0xD800 || c >= 0xE000) {
                out += this._hexByte(0xE0 | (c >> 12)) + this._hexByte(0x80 | ((c >> 6) & 0x3F)) + this._hexByte(0x80 | (c & 0x3F));
            } else {
                i++;
                var c2 = str.charCodeAt(i) & 0x3FF;
                var codepoint = 0x10000 + (((c & 0x3FF) << 10) | c2);
                out += this._hexByte(0xF0 | (codepoint >> 18)) + this._hexByte(0x80 | ((codepoint >> 12) & 0x3F)) +
                    this._hexByte(0x80 | ((codepoint >> 6) & 0x3F)) + this._hexByte(0x80 | (codepoint & 0x3F));
            }
        }
        return out;
    },

    _hexByte: function(byte) {
        var hex = (byte & 0xFF).toString(16).toUpperCase();
        return '%' + (hex.length < 2 ? '0' + hex : hex);
    },

    _sha256Hex: function(str) {
        return this._bytesToHex(this._sha256Bytes(this._utf8Bytes(str)));
    },

    _hmacSha256Hex: function(secretKey, str) {
        return this._bytesToHex(this._hmacSha256Bytes(this._utf8Bytes(secretKey), this._utf8Bytes(str)));
    },

    SHA256_K: [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
    ],

    _rotr: function(x, n) {
        return ((x >>> n) | (x << (32 - n))) >>> 0;
    },

    _sha256Bytes: function(bytes) {
        var K = this.SHA256_K;
        var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];

        var msgLen = bytes.length;
        var padded = bytes.slice();
        padded.push(0x80);
        while (padded.length % 64 !== 56) padded.push(0);

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
                var s0 = (this._rotr(w[t - 15], 7) ^ this._rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3)) >>> 0;
                var s1 = (this._rotr(w[t - 2], 17) ^ this._rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10)) >>> 0;
                w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
            }

            var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];

            for (t = 0; t < 64; t++) {
                var S1 = (this._rotr(e, 6) ^ this._rotr(e, 11) ^ this._rotr(e, 25)) >>> 0;
                var ch = ((e & f) ^ (~e & g)) >>> 0;
                var temp1 = (h + S1 + ch + K[t] + w[t]) >>> 0;
                var S0 = (this._rotr(a, 2) ^ this._rotr(a, 13) ^ this._rotr(a, 22)) >>> 0;
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
    },

    _hmacSha256Bytes: function(keyBytes, msgBytes) {
        var BLOCK_SIZE = 64;
        var key = keyBytes.slice();
        if (key.length > BLOCK_SIZE) key = this._sha256Bytes(key);
        while (key.length < BLOCK_SIZE) key.push(0);

        var ipad = new Array(BLOCK_SIZE);
        var opad = new Array(BLOCK_SIZE);
        for (var i = 0; i < BLOCK_SIZE; i++) {
            ipad[i] = key[i] ^ 0x36;
            opad[i] = key[i] ^ 0x5c;
        }

        var inner = this._sha256Bytes(ipad.concat(msgBytes));
        return this._sha256Bytes(opad.concat(inner));
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
    // Pagination - row-offset based, stop on short page OR total_count
    // reached. Mirrors lib/rdsPagination.js.
    // ------------------------------------------------------------------
    _shouldFetchNextPage: function(args) {
        if (args.pageInstanceCount < args.limit) return false;
        if (typeof args.totalCount === 'number' && args.totalFetched >= args.totalCount) return false;
        return true;
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

    type: 'HuaweiRdsDiscovery'
};
