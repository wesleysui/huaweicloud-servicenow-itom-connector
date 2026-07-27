// Script Include: HuaweiECSDiscovery
// Invoked by: Scheduled Job "Huawei Cloud ECS Discovery" (e.g. every 15 min)
// Scope: custom scoped app (e.g. x_hwc_itom, or whatever your instance assigned)
//
// Auth: signs each request directly with a Huawei Cloud Access Key / Secret
// Key pair (the "SDK-HMAC-SHA256" AK/SK Signing and Authentication
// Algorithm) - the SAME credential type already used by the Terraform
// provisioning module in this repo. There is no session/token to cache and
// no re-auth-on-401 concept: every request is signed fresh, so a 401/403
// here means the AK/SK itself is wrong or misconfigured (fail fast), not
// "the token expired".
//
// The signing algorithm is unit-tested under Node - and cross-verified
// byte-for-byte against the official @huaweicloud/huaweicloud-sdk-core npm
// package - in servicenow/discovery/lib/huaweiAkSkSigner.js /
// tests/unit/huaweiAkSkSigner.test.js. SHA-256/HMAC-SHA256 themselves are
// implemented in pure JavaScript (servicenow/discovery/lib/pureJsSha256.js),
// not via any ServiceNow-specific crypto API - raw Java interop (Packages.*)
// is blocked in scoped applications, GlideRSA (which has hmacSha256) doesn't
// exist on the test instance, and GlideDigest exists but can't do HMAC (see
// README gotchas #4-#8). A pure-algorithm implementation has no platform API
// left to be missing or blocked, in any scope. Keep the canonical-request/
// string-to-sign construction, and the SHA-256/HMAC code itself, in sync
// with the Node libs if either ever changes.
//
// Pagination and retry/backoff are unchanged from the original design - see
// lib/ecsPagination.js and lib/httpResilience.js.
//
// Prerequisites (see servicenow/discovery/README.md):
// - System properties: x_hwc.itom.region, .project_id, .page_limit (default
//   100), .max_retry_attempts (default 3), .access_key (string),
//   .secret_key (type password2 - gs.getProperty() auto-decrypts this type).
//   Reuse the same AK/SK already validated against the terraform/ module in
//   this repo. (A discovery_credentials record was tried first but every
//   decryption API attempted on it either doesn't exist, is refused
//   cross-scope, or is an undefined plugin namespace on this instance - see
//   README gotchas #5-#6 - so the credential lives in System Properties
//   instead, consistent with everything else this Script Include reads.)
//
// Multi-account/region use (HC ITOM Connector, Phase 2A): initialize()
// optionally accepts a config object ({region, projectId, pageLimit,
// maxRetryAttempts, accessKey, secretKey}) that takes precedence over the
// System Properties above - see service-graph/HcConnectorEcsSync.js, which
// constructs one instance per (HC Cloud Account, HC Cloud Region). Calling
// `new HuaweiECSDiscovery()` with no config is unchanged.
var HuaweiECSDiscovery = Class.create();
HuaweiECSDiscovery.prototype = {
    // config is OPTIONAL and additive (Phase 2A / HC ITOM Connector multi-account
    // support) - when omitted, behavior is byte-for-byte identical to before:
    // every value falls back to the same System Properties with the same
    // defaults. When given, config.region/projectId/pageLimit/maxRetryAttempts/
    // accessKey/secretKey take precedence, letting
    // service-graph/HcConnectorEcsSync.js construct one instance per
    // (HC Cloud Account, HC Cloud Region) instead of relying on one global
    // set of properties. See servicenow/discovery/README.md.
    initialize: function(config) {
        config = config || {};
        var scopePrefix = gs.getCurrentScopeName() + '.';
        this.region          = config.region || gs.getProperty(scopePrefix + 'x_hwc.itom.region', 'cn-north-4');
        this.projectId       = config.projectId || gs.getProperty(scopePrefix + 'x_hwc.itom.project_id');
        this.pageLimit       = config.pageLimit != null ? parseInt(config.pageLimit, 10) : parseInt(gs.getProperty(scopePrefix + 'x_hwc.itom.page_limit', '100'), 10);
        this.maxRetries      = config.maxRetryAttempts != null ? parseInt(config.maxRetryAttempts, 10) : parseInt(gs.getProperty(scopePrefix + 'x_hwc.itom.max_retry_attempts', '3'), 10);
        this.retryableStatus = [429, 500, 502, 503, 504]; // mirrors lib/httpResilience.js
        this._explicitCredential = (config.accessKey && config.secretKey) ? { ak: config.accessKey, sk: config.secretKey } : null;
    },

    // ------------------------------------------------------------------
    // Fetch ECS instances, paginated, with retry (AK/SK signed, no auth call)
    // ------------------------------------------------------------------
    // NOTE: Huawei's `offset` on this endpoint is a PAGE NUMBER (0-based),
    // not a row offset - see lib/ecsPagination.js for why that matters.
    // THROWS on a page fetch failure (bad AK/SK, retries exhausted, network
    // error) rather than silently returning whatever partial list was
    // fetched so far. This used to return the partial list silently; that
    // was harmless for the single-account run() below (nothing downstream
    // ever compared what was fetched against what was expected), but it
    // would be actively dangerous once retirement logic exists on top (a
    // silently-partial fetch would look identical to "these resources
    // legitimately don't exist anymore" and could wrongly retire real,
    // still-existing CIs) - see service-graph/HcConnectorEcsSync.js and its
    // "incomplete sync never retires" design invariant.
    fetchECSInstances: function() {
        var allServers = [];
        var totalCount;
        var pageIndex = 0;

        while (true) {
            var page = this._fetchPage(pageIndex);

            if (page === null) {
                throw new Error('ECS fetch failed on page ' + pageIndex + ' after retries - see the prior gs.error log for the underlying status/exception');
            }

            allServers = allServers.concat(page.servers);
            totalCount = page.count;

            var continuePaging = this._shouldFetchNextPage({
                pageServerCount: page.servers.length,
                limit: this.pageLimit,
                totalFetched: allServers.length,
                totalCount: totalCount
            });
            if (!continuePaging) break;
            pageIndex++;
        }

        return allServers;
    },

    _fetchPage: function(pageIndex) {
        var host = 'ecs.' + this.region + '.myhuaweicloud.com';
        var pathname = '/v1/' + this.projectId + '/cloudservers/detail';

        for (var attempt = 0; attempt <= this.maxRetries; attempt++) {
            try {
                var signed = this._sign({
                    method: 'GET',
                    pathname: pathname,
                    host: host,
                    queryParams: { limit: String(this.pageLimit), offset: String(pageIndex) }
                });

                var request = new sn_ws.RESTMessageV2();
                request.setHttpMethod('GET');
                request.setEndpoint('https://' + host + pathname + '?limit=' + this.pageLimit + '&offset=' + pageIndex);
                request.setRequestHeader('Content-Type', signed['Content-Type']);
                request.setRequestHeader('X-Sdk-Date', signed['X-Sdk-Date']);
                request.setRequestHeader('Authorization', signed['Authorization']);
                request.setRequestHeader('host', host);

                var response = request.execute();
                var status = response.getStatusCode();
                
                if (status == 200) {
                    var body = JSON.parse(response.getBody());
                    return { servers: body.servers || [], count: body.count };
                }

                if (this._shouldRetry(status, attempt)) {
                    // Retries immediately, no backoff delay - gs.sleep() is
                    // fenced (blocked) for custom scoped apps on this
                    // instance, confirmed via a real MethodNotAllowedException
                    // in HcConnectorEcsLifecycleAction.js. This retry path has
                    // never actually been real-PDI exercised (no real
                    // 429/500/502/503/504 has ever been hit here), so this
                    // fix is proactive, not itself confirmed against a real
                    // retryable error.
                    gs.warn('[HuaweiECSDiscovery] ECS fetch got ' + status + ', retrying page ' + pageIndex +
                        ' immediately (no backoff, attempt ' + attempt + ')');
                    continue;
                }

                gs.error('[HuaweiECSDiscovery] ECS fetch failed on page ' + pageIndex + ': ' + status +
                    ' - ' + response.getBody());
                return null;
            } catch (ex) {
                gs.error('[HuaweiECSDiscovery] ECS fetch exception on page ' + pageIndex + ': ' + ex.message);
                return null;
            }
        }
        return null;
    },

    // ------------------------------------------------------------------
    // Map & reconcile via Identification & Reconciliation Engine
    // ------------------------------------------------------------------
    // Full VPC/Subnet/EVS-based relations are deferred until those resource
    // types get their own Discovery support (see docs/ROADMAP.md). But
    // cmdb_ci_vm_instance has an OOTB containment rule requiring at least one
    // "hosted on" relationship to a virtualization server / logical
    // datacenter / computer CI - a bare cmdb_ci_vm_instance payload is
    // rejected outright with MISSING_DEPENDENCY (found via real testing, not
    // anticipated in the original design). Minimal fix: relate every ECS CI
    // to a single shared placeholder cmdb_ci_virtualization_server
    // representing the Huawei Cloud region's hypervisor layer, via the
    // `relations[]` array. `relations[]` entries reference `items[]` by
    // array INDEX (as strings), not nested objects - see
    // servicenow/discovery/README.md gotcha #10.
    reconcileCIs: function(servers) {
        if (!servers.length) return;

        var items = [];
        var relations = [];

        // cmdb_ci_logical_datacenter was tried first but that class itself
        // has no containment/hosting rule metadata configured on this
        // instance (METADATA_RULE_MISSING) - switched to
        // cmdb_ci_virtualization_server, paired with the confirmed real OOTB
        // relationship type "Runs on::Runs" (VM instance Runs on the
        // virtualization server; the server Runs the VM instance).
        items.push({
            className: 'cmdb_ci_virtualization_server',
            values: {
                name: 'Huawei Cloud - ' + this.region,
                short_description: 'Placeholder representing the Huawei Cloud hypervisor layer for ECS containment relationships'
            }
        });
        var hostIndex = 0;

        for (var i = 0; i < servers.length; i++) {
            var s = servers[i];
            items.push({
                // 'virtual', 'host_name', and 'u_vpc_id' were removed after
                // real testing showed they're silently dropped on this
                // table ('virtual' is redundant - implied by the CI class
                // itself; 'host_name' duplicates 'name' for Huawei ECS data;
                // 'u_vpc_id' was never a real field - VPC association is a
                // planned relations[]-based feature, not a flat custom
                // field, see docs/ROADMAP.md).
                className: 'cmdb_ci_vm_instance',
                values: {
                    name:               s.name || '',
                    correlation_id:     s.id || '',              // stable unique key
                    object_id:          s.id || '',              // this instance's identify rule for cmdb_ci_vm_instance requires object_id specifically
                    ip_address:         this._getFixedIp(s.addresses) || '',
                    operational_status: (s.status === 'ACTIVE') ? '1' : '2',
                    location:           s['OS-EXT-AZ:availability_zone'] || '',
                    short_description:  'Huawei Cloud ECS - discovered via custom REST integration',
                    discovery_source:   'Huawei Cloud Custom Discovery'
                }
            });
            var vmIndex = items.length - 1;
            relations.push({ parent: String(hostIndex), child: String(vmIndex), type: 'Runs on::Runs' });
        }

        // createOrUpdateCI takes TWO arguments: a source-identifier string,
        // then the payload as a JSON-encoded STRING (not an object) - e.g.
        // createOrUpdateCI(sourceName, JSON.stringify(payload)). Calling it
        // with only one argument (an earlier version of this code) left the
        // second parameter undefined on the Java side, which is exactly what
        // produced the "Unrecognized token 'undefined'" parse error - Rhino's
        // missing-argument coercion turned into the literal 9-character
        // string "undefined" being handed to the JSON parser.
        //
        // IMPORTANT: createOrUpdateCI's return value is ITSELF a JSON
        // STRING, not a parsed object - discovered via Phase 2B real-PDI
        // testing against HuaweiVpcDiscovery.js's identical call (a real
        // IDENTIFICATION_RULE_MISSING error there showed result.hasError
        // was always undefined on the raw string, silently masking the
        // failure as success). Must JSON.parse() it before the caller
        // (reconcileAndUpsert in HcConnectorEcsSync.js) can read
        // .hasError/.errorCount. Fixed here as a real correctness bug, not
        // a design change - HcConnectorEcsSync.js's own hasError check was
        // never actually exercised by Phase 2A's real-PDI testing (its
        // real failures were all fetch-level, never an actual IRE-level
        // error), so this fix changes no previously-verified behavior.
        try {
            var payload = JSON.stringify({ items: items, relations: relations });
            var rawResult = sn_cmdb.IdentificationEngine.createOrUpdateCI('Huawei Cloud Custom Discovery', payload);
            gs.info('[HuaweiECSDiscovery] IRE result for ' + servers.length + ' server(s): ' + rawResult);
            return JSON.parse(rawResult);
        } catch (ex) {
            gs.error('[HuaweiECSDiscovery] IRE exception: ' + ex.message);
        }
    },

    run: function() {
        var servers = this.fetchECSInstances();
        gs.info('[HuaweiECSDiscovery] Fetched ' + servers.length + ' ECS instance(s) across all pages');
        if (servers.length) this.reconcileCIs(servers);
    },

    // ------------------------------------------------------------------
    // AK/SK request signing (SDK-HMAC-SHA256) - mirrors lib/huaweiAkSkSigner.js
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

    // GlideDateTime.getValue() returns ServiceNow's native "yyyy-MM-dd HH:mm:ss"
    // (UTC) - reformatted here to Huawei's required "YYYYMMDDTHHmmssZ" via
    // plain substring slicing, NOT a JS Date bridge (see the Rhino Date-parsing
    // gotcha documented in servicenow/discovery/README.md).
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

    // RFC 3986 unreserved characters (A-Z a-z 0-9 - _ . ~) pass through
    // unescaped; everything else is percent-encoded. Pure JS (charCodeAt-based
    // UTF-8 handling for surrogate pairs), no Java interop needed here -
    // matches the official SDK's own urlEncode implementation.
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
                // surrogate pair
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

    // Pure-JavaScript SHA-256/HMAC-SHA256 (ES5 arithmetic only) - no
    // ServiceNow-specific crypto API, no Packages/Java interop. This exists
    // because every platform-provided option failed for a different reason
    // on the test instance: Packages.* is blocked in scoped apps, GlideRSA
    // (which has hmacSha256) doesn't exist there, and GlideDigest exists but
    // only hashes plain text (no HMAC, no raw byte input) - see
    // servicenow/discovery/README.md gotcha #8. A pure-algorithm
    // implementation has no platform dependency to be missing or blocked.
    //
    // This is a near-verbatim copy of servicenow/discovery/lib/pureJsSha256.js,
    // which is unit-tested against Node's own `crypto` module and against
    // the official RFC 4231 HMAC-SHA-256 test-vector shapes - see
    // tests/unit/pureJsSha256.test.js. Keep both in sync.
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

    // @param {number[]} bytes - array of integers 0-255
    // @returns {number[]} 32-byte digest as an array of integers 0-255
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

    // @param {number[]} keyBytes
    // @param {number[]} msgBytes
    // @returns {number[]} 32-byte HMAC as an array of integers 0-255
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

    // UTF-8 encode a JS string into a byte array (same charCodeAt-based
    // surrogate-pair-aware algorithm as _percentEncode above).
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
    // Retry/backoff + pagination helpers - unchanged, mirror lib/*.js
    // ------------------------------------------------------------------
    _shouldRetry: function(status, attempt) {
        return this.retryableStatus.indexOf(status) !== -1 && attempt < this.maxRetries;
    },

    _shouldFetchNextPage: function(args) {
        if (args.pageServerCount < args.limit) return false;
        if (typeof args.totalCount === 'number' && args.totalFetched >= args.totalCount) return false;
        return true;
    },

    _getFixedIp: function(addresses) {
        for (var net in addresses || {}) {
            for (var j = 0; j < addresses[net].length; j++) {
                if (addresses[net][j]['OS-EXT-IPS:type'] === 'fixed') return addresses[net][j].addr;
            }
        }
        return '';
    },

    // ------------------------------------------------------------------
    // AK/SK credential resolution
    // ------------------------------------------------------------------
    // Stored as System Properties, not a discovery_credentials record - two
    // earlier approaches (gr.getDecryptedPassword2(), gr.password.getDecryptedValue(),
    // sn_credential.CredentialsAccessor) all failed on this instance (wrong
    // API name, refused cross-scope access, and an undefined plugin
    // namespace, respectively - see servicenow/discovery/README.md gotchas
    // #4-#7). gs.getProperty() on a `password2`-type property auto-decrypts
    // and is already proven to work in this scoped app (used for region/
    // project_id/etc.), so the Secret Key is stored the same way.
    _getCredential: function() {
        if (this._explicitCredential) return this._explicitCredential; // set in initialize(config) when config.accessKey/secretKey were given
        var scopePrefix = gs.getCurrentScopeName() + '.';
        var ak = gs.getProperty(scopePrefix + 'x_hwc.itom.access_key');
        var sk = gs.getProperty(scopePrefix + 'x_hwc.itom.secret_key');
        if (!ak || !sk) throw new Error('x_hwc.itom.access_key / .secret_key system properties not configured');
        return { ak: ak, sk: sk };
    },

    type: 'HuaweiECSDiscovery'
};
