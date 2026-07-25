// Script Include: HuaweiCceDiscovery
// HC ITOM Connector Phase 3 - CCE (Cloud Container Engine) CLUSTER
// discovery only - node/namespace/workload/service/ingress/Pod are
// explicitly out of scope for this architecture: discovering resources
// INSIDE a Kubernetes cluster requires reaching the cluster's own
// Kubernetes API server (a MID Server positioned with network access to
// the cluster, plus Kubernetes-native auth), a fundamentally different
// discovery mechanism than every other resource type in this project (a
// direct, agentless REST call to Huawei's public regional API, no MID
// Server). New sibling to HuaweiECSDiscovery.js/HuaweiVpcDiscovery.js/
// HuaweiEvsDiscovery.js/HuaweiElbDiscovery.js/HuaweiRdsDiscovery.js/
// HuaweiObsDiscovery.js, not a modification of any of them - all six are
// real-PDI verified and intentionally left untouched.
//
// CCE uses its own API family (cce.{region}.myhuaweicloud.com per
// research - NOT YET real-PDI confirmed, correct on first run if wrong),
// not any other Discovery file's host, so this is a new file rather than
// folding into an existing one. Auth is the standard IAM-wide
// "SDK-HMAC-SHA256" scheme every service except OBS uses here (see
// HuaweiObsDiscovery.js's header comment for the one real exception).
// _sign/_formatSdkDate/_canonicalURI/_canonicalQueryString/_percentEncode/
// _hexByte/_sha256Hex/_hmacSha256Hex/SHA256_K/_rotr/_sha256Bytes/
// _hmacSha256Bytes/_utf8Bytes/_bytesToHex/_shouldRetry/_computeBackoffMs/
// _getCredential below are copied byte-for-byte from HuaweiECSDiscovery.js
// (same "don't touch proven crypto, duplicate and drift-check instead"
// precedent) - covered by check-mirror-drift.js's eighth PAIRS entry.
//
// Response shape is Kubernetes-shaped (`kind`/`apiVersion`/`items[]`,
// each item nested under `metadata`/`spec`/`status`), NOT a flat object
// like every other Huawei API in this project - per Huawei's official
// ListClusters docs (GET /api/v3/projects/{project_id}/clusters). No
// pagination attempted - the docs mention no marker/limit params for
// this endpoint, matching OBS's ListBuckets (low-cardinality resource,
// accounts typically have few clusters); NOT yet confirmed for accounts
// with a very large cluster count.
//
// CI class (CI_CLASS_CCE_CLUSTER below) is
// `x_2021019_huawei_0_huawei_cloud_cce_cluster`, a dedicated class this
// project's own scoped app owns. Checked directly against this instance
// (a real sys_db_object search for "kubernetes"/"k8s"/"cce"/
// "container_cluster"/"ecs_cluster"/generic "cluster" all returned zero
// results) - unlike OBS, there wasn't even a mismatched generic
// candidate to reject, just nothing at all. Created via Studio, extending
// `cmdb_ci` directly, with a manual Independent Identification Rule
// (criterion attribute `correlation_id`) via CI Class Manager - same
// process already proven for the OBS bucket class. No `object_id` - this
// class extends plain `cmdb_ci`, which doesn't have that field. No
// relations attempted in this first version - a brand-new class has no
// OOTB containment/hosting rule registered at all, so this project's
// established "let the real error decide" process may not even surface
// one here; confirm on first real-PDI run (matches OBS's own outcome:
// zero relations needed). See lib/mapCceToIRE.js's header comment for
// the full reasoning.
//
// Prerequisites: same System Properties as HuaweiECSDiscovery.js
// (x_hwc.itom.access_key/.secret_key, or the account-scoped
// x_hwc.itom.<account_id>.access_key/.secret_key names via
// HcConnectorCceSync's config) - reuse the same already-validated AK/SK,
// nothing new to provision.
var HuaweiCceDiscovery = Class.create();
HuaweiCceDiscovery.prototype = {
    CI_CLASS_CCE_CLUSTER: 'x_2021019_huawei_0_huawei_cloud_cce_cluster',

    // config is OPTIONAL and additive, same shape as HuaweiECSDiscovery's -
    // see that file's initialize() comment for the full rationale.
    initialize: function(config) {
        config = config || {};
        var scopePrefix = gs.getCurrentScopeName() + '.';
        this.accountId       = config.accountId || null;
        this.region          = config.region || gs.getProperty(scopePrefix + 'x_hwc.itom.region', 'cn-north-4');
        this.projectId       = config.projectId || gs.getProperty(scopePrefix + 'x_hwc.itom.project_id');
        this.maxRetries      = config.maxRetryAttempts != null ? parseInt(config.maxRetryAttempts, 10) : parseInt(gs.getProperty(scopePrefix + 'x_hwc.itom.max_retry_attempts', '3'), 10);
        this.retryableStatus = [429, 500, 502, 503, 504]; // mirrors lib/httpResilience.js
        this._explicitCredential = (config.accessKey && config.secretKey) ? { ak: config.accessKey, sk: config.secretKey } : null;
    },

    // ------------------------------------------------------------------
    // Fetch clusters (AK/SK signed, no pagination, no auth call)
    // ------------------------------------------------------------------
    // THROWS on a fetch failure - same "incomplete fetch must never look
    // like an empty result" invariant as HuaweiECSDiscovery.js.
    fetchClusters: function() {
        var host = 'cce.' + this.region + '.myhuaweicloud.com';
        var pathname = '/api/v3/projects/' + this.projectId + '/clusters';

        for (var attempt = 0; attempt <= this.maxRetries; attempt++) {
            try {
                var signed = this._sign({
                    method: 'GET',
                    pathname: pathname,
                    host: host,
                    queryParams: {}
                });

                var request = new sn_ws.RESTMessageV2();
                request.setHttpMethod('GET');
                request.setEndpoint('https://' + host + pathname);
                request.setRequestHeader('Content-Type', signed['Content-Type']);
                request.setRequestHeader('X-Sdk-Date', signed['X-Sdk-Date']);
                request.setRequestHeader('Authorization', signed['Authorization']);
                request.setRequestHeader('host', host);

                var response = request.execute();
                var status = response.getStatusCode();

                if (status == 200) {
                    var body = JSON.parse(response.getBody());
                    return body.items || [];
                }

                if (this._shouldRetry(status, attempt)) {
                    gs.warn('[HuaweiCceDiscovery] fetch got ' + status + ', retrying (attempt ' + attempt + ')');
                    gs.sleep(this._computeBackoffMs(attempt));
                    continue;
                }

                throw new Error('CCE fetch failed: ' + status + ' - ' + response.getBody());
            } catch (ex) {
                if (attempt >= this.maxRetries) throw ex;
                gs.warn('[HuaweiCceDiscovery] fetch exception on attempt ' + attempt + ': ' + ex.message);
            }
        }
        throw new Error('CCE fetch failed after retries');
    },

    // ------------------------------------------------------------------
    // Map & reconcile via Identification & Reconciliation Engine
    // ------------------------------------------------------------------
    // Mirrors lib/mapCceToIRE.js's buildIREPayload() inline (ServiceNow
    // scoped scripts cannot require() - keep both in sync when changing
    // the mapping rules). No relations in this first version - see this
    // file's header comment.
    reconcileCIs: function(clusters) {
        clusters = clusters || [];
        if (!clusters.length) return;

        var items = [];

        for (var i = 0; i < clusters.length; i++) {
            var cluster = clusters[i];
            var metadata = cluster.metadata || {};
            var spec = cluster.spec || {};
            var status = cluster.status || {};
            items.push({
                className: this.CI_CLASS_CCE_CLUSTER,
                values: {
                    name: metadata.name || '',
                    correlation_id: metadata.uid || '',
                    operational_status: status.phase || '',
                    short_description: 'Huawei Cloud CCE Cluster (Kubernetes ' + (spec.version || '') + ') - discovered via custom REST integration',
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
            gs.info('[HuaweiCceDiscovery] IRE result for ' + clusters.length + ' cluster(s): ' + rawResult);
            return JSON.parse(rawResult);
        } catch (ex) {
            gs.error('[HuaweiCceDiscovery] IRE exception: ' + ex.message);
        }
    },

    run: function() {
        var clusters = this.fetchClusters();
        gs.info('[HuaweiCceDiscovery] Fetched ' + clusters.length + ' cluster(s)');
        if (clusters.length) this.reconcileCIs(clusters);
    },

    // ------------------------------------------------------------------
    // AK/SK request signing (SDK-HMAC-SHA256) - mirrors lib/huaweiAkSkSigner.js
    // Copied byte-for-byte from HuaweiECSDiscovery.js - see that file's
    // header comment for the full rationale. Keep in sync via
    // check-mirror-drift.js's eighth PAIRS entry.
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

    type: 'HuaweiCceDiscovery'
};
