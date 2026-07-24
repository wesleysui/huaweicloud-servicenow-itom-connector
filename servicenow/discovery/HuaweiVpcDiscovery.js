// Script Include: HuaweiVpcDiscovery
// HC ITOM Connector Phase 2B - VPC + Subnet discovery, extended in Phase
// 2C to also cover Security Group (same VPC API family, same signing/
// pagination/retry harness - the reuse case is identical to why VPC and
// Subnet share this one file, see below). Sibling to HuaweiECSDiscovery.js,
// not a modification of it - that file is real-PDI verified and
// intentionally left untouched.
//
// Security Group -> ECS instance is NOT related here (no "Secures"
// relation) - ECS is discovered in a separate Script Include/call, and
// this project has no established pattern yet for relating CIs across two
// separate discovery runs (IRE relations[] entries reference items[] by
// array index, which only resolves within one createOrUpdateCI() call).
// Matches the fact that ECS<->VPC/Subnet aren't related to each other
// either today - a real, documented gap, not a silent omission.
//
// Security Group -> VPC (Contains::Contained by) was the ORIGINAL design
// and is WRONG - real-PDI testing found Huawei's actual security-groups
// API response has no vpc_id field to relate with, and
// cmdb_ci_compute_security_group's real OOTB containment rule wants
// Hosted on::Hosts -> cmdb_ci_logical_datacenter instead (the same
// placeholder cmdb_ci_network/VPC itself is hosted under) - confirmed via
// a real MISSING_DEPENDENCY error. See lib/mapSecurityGroupToIRE.js's
// header comment for the full trail behind CI_CLASS_SECURITY_GROUP and
// HOSTING_RELATION_TYPE below.
//
// One file for VPC, Subnet, and Security Group fetch/reconcile, not three, because:
// ServiceNow scoped scripts cannot require(), so splitting would force a
// second full verbatim copy of the SHA-256/HMAC-SHA256 crypto port below
// (doubling the drift-check maintenance burden - see check-mirror-drift.js);
// Subnet fetch inherently needs vpc_id for its containment relation
// regardless of file layout; and the signed-GET/retry/backoff harness is
// genuinely shared between the two endpoints (same host, same auth,
// different pathname).
//
// Auth: identical AK/SK "SDK-HMAC-SHA256" signing scheme as
// HuaweiECSDiscovery.js - see that file's header comment for the full
// rationale (why pure-JS crypto, not Packages.*/GlideRSA/GlideDigest).
// _sign/_formatSdkDate/_canonicalURI/_canonicalQueryString/_percentEncode/
// _hexByte/_sha256Hex/_hmacSha256Hex/SHA256_K/_rotr/_sha256Bytes/
// _hmacSha256Bytes/_utf8Bytes/_bytesToHex/_shouldRetry/_computeBackoffMs/
// _getCredential below are copied byte-for-byte from HuaweiECSDiscovery.js
// (same "don't touch proven crypto, duplicate and drift-check instead"
// precedent) - covered by check-mirror-drift.js's third PAIRS entry.
//
// Pagination is DIFFERENT from ECS's: Huawei's VPC service
// (GET /v1/{project_id}/vpcs, /subnets) is Neutron/OpenStack-derived - uses
// marker/cursor pagination (?marker=<last-seen-id>, response carries
// page_info.next_marker), not ECS's offset-as-page-number. Real-PDI
// verified for VPC/Subnet (Phase 2B, HC6-HC10) - see lib/vpcPagination.js.
// Security Group's v3 endpoint reuses the same _fetchPage()/_fetchAllPages()
// below - real-PDI confirmed its response shape matches (page_info.
// previous_marker/current_count), fetch succeeded first try. The response
// body itself differs from general API-shape assumptions in one way: no
// vpc_id field - see lib/mapSecurityGroupToIRE.js's header comment.
//
// CI classes (CI_CLASS_VPC/CI_CLASS_SUBNET below) confirmed via real-PDI
// testing (docs/REAL-PDI-REPLAY-CHECKLIST.md's Phase 2B addendum). First
// guess was cmdb_ci_vpc ("Virtual Private Cloud") + cmdb_ci_cloud_subnet
// ("Cloud Subnet") - both real, dedicated classes, but a real
// MISSING_DEPENDENCY error revealed cmdb_ci_cloud_subnet's OOTB
// containment/hosting rule requires its parent to be specifically
// cmdb_ci_network ("Cloud Network"), not cmdb_ci_vpc (no inheritance
// relationship between the two classes). CI_CLASS_VPC changed to
// cmdb_ci_network to match ServiceNow's own OOTB containment metadata
// directly. Both classes needed an Identification Rule created by hand
// (Independent, criterion attribute = correlation_id) - neither had one
// out of the box, discovered via a real
// IDENTIFICATION_RULE_MISSING/MISSING_DEPENDENCY error, same class of
// real-PDI discovery ECS's cmdb_ci_vm_instance containment fix needed.
// CONTAINMENT_RELATION_TYPE confirmed to exist (queried cmdb_rel_type
// directly) and matches the exact relation IRE's error message named:
// "cmdb_ci_network <- Contains <- cmdb_ci_cloud_subnet". Update both this
// file and its lib/mapVpcSubnetToIRE.js mirror together if any of this
// needs revising further.
//
// Prerequisites: same System Properties as HuaweiECSDiscovery.js
// (x_hwc.itom.access_key/.secret_key, or the account-scoped
// x_hwc.itom.<account_id>.access_key/.secret_key names via
// HcConnectorVpcSync's config) - reuse the same already-validated AK/SK,
// nothing new to provision.
var HuaweiVpcDiscovery = Class.create();
HuaweiVpcDiscovery.prototype = {
    CI_CLASS_VPC: 'cmdb_ci_network',
    CI_CLASS_SUBNET: 'cmdb_ci_cloud_subnet',
    CONTAINMENT_RELATION_TYPE: 'Contains::Contained by',

    // config is OPTIONAL and additive, same shape as HuaweiECSDiscovery's -
    // when omitted, every value falls back to the same System Properties
    // HuaweiECSDiscovery.js already uses (region/access_key/secret_key are
    // shared across both discovery scripts on purpose - one Huawei Cloud
    // account, one credential). When given, config.region/projectId/
    // pageLimit/maxRetryAttempts/accessKey/secretKey take precedence,
    // letting service-graph/HcConnectorVpcSync.js construct one instance
    // per (HC Cloud Account, HC Cloud Region), same pattern as
    // service-graph/HcConnectorEcsSync.js.
    initialize: function(config) {
        config = config || {};
        var scopePrefix = gs.getCurrentScopeName() + '.';
        this.accountId       = config.accountId || null; // used only to identify the cmdb_ci_cloud_service_account placeholder in reconcileCIs()
        this.region          = config.region || gs.getProperty(scopePrefix + 'x_hwc.itom.region', 'cn-north-4');
        this.projectId       = config.projectId || gs.getProperty(scopePrefix + 'x_hwc.itom.project_id');
        this.pageLimit       = config.pageLimit != null ? parseInt(config.pageLimit, 10) : parseInt(gs.getProperty(scopePrefix + 'x_hwc.itom.page_limit', '100'), 10);
        this.maxRetries      = config.maxRetryAttempts != null ? parseInt(config.maxRetryAttempts, 10) : parseInt(gs.getProperty(scopePrefix + 'x_hwc.itom.max_retry_attempts', '3'), 10);
        this.retryableStatus = [429, 500, 502, 503, 504]; // mirrors lib/httpResilience.js
        this._explicitCredential = (config.accessKey && config.secretKey) ? { ak: config.accessKey, sk: config.secretKey } : null;
    },

    // ------------------------------------------------------------------
    // Fetch VPCs / Subnets, paginated, with retry (AK/SK signed, no auth call)
    // ------------------------------------------------------------------
    fetchVPCs: function() {
        return this._fetchAllPages('/v1/' + this.projectId + '/vpcs', 'vpcs');
    },

    fetchSubnets: function() {
        return this._fetchAllPages('/v1/' + this.projectId + '/subnets', 'subnets');
    },

    // Security Group uses the VPC v3 API (ShowSecurityGroup/ListSecurityGroups
    // per Huawei's official docs), not v1 like VPC/Subnet above - different
    // path prefix, same host/signing/marker-pagination convention, so
    // _fetchAllPages() below is reused as-is. NOT YET VERIFIED against this
    // project's real sandbox that v3's marker pagination shape matches v1's
    // exactly (page_info.next_marker) - confirm on first real-PDI run.
    fetchSecurityGroups: function() {
        return this._fetchAllPages('/v3/' + this.projectId + '/vpc/security-groups', 'security_groups');
    },

    // Shared marker-pagination driver for both endpoints - the actual reuse
    // payoff of combining VPC+Subnet fetch into one file. THROWS on a page
    // fetch failure (same "incomplete fetch must never look like an empty
    // result" invariant as HuaweiECSDiscovery.fetchECSInstances()).
    _fetchAllPages: function(pathname, itemsKey) {
        var allItems = [];
        var marker = null;

        while (true) {
            var page = this._fetchPage(pathname, itemsKey, marker);

            if (page === null) {
                throw new Error('fetch failed for ' + pathname + ' after retries' + (marker ? (' (marker=' + marker + ')') : '') +
                    ' - see the prior gs.error log for the underlying status/exception');
            }

            allItems = allItems.concat(page.items);

            var continuePaging = this._shouldFetchNextPage({
                pageItemCount: page.items.length,
                limit: this.pageLimit,
                nextMarker: page.nextMarker
            });
            if (!continuePaging) break;
            marker = page.nextMarker;
        }

        return allItems;
    },

    _fetchPage: function(pathname, itemsKey, marker) {
        var host = 'vpc.' + this.region + '.myhuaweicloud.com';
        var queryParams = { limit: String(this.pageLimit) };
        if (marker) queryParams.marker = marker;

        for (var attempt = 0; attempt <= this.maxRetries; attempt++) {
            try {
                var signed = this._sign({
                    method: 'GET',
                    pathname: pathname,
                    host: host,
                    queryParams: queryParams
                });

                var endpoint = 'https://' + host + pathname + '?limit=' + this.pageLimit + (marker ? ('&marker=' + marker) : '');
                var request = new sn_ws.RESTMessageV2();
                request.setHttpMethod('GET');
                request.setEndpoint(endpoint);
                request.setRequestHeader('Content-Type', signed['Content-Type']);
                request.setRequestHeader('X-Sdk-Date', signed['X-Sdk-Date']);
                request.setRequestHeader('Authorization', signed['Authorization']);
                request.setRequestHeader('host', host);

                var response = request.execute();
                var status = response.getStatusCode();

                if (status == 200) {
                    var body = JSON.parse(response.getBody());
                    var pageInfo = body.page_info || {};
                    return { items: body[itemsKey] || [], nextMarker: pageInfo.next_marker || null };
                }

                if (this._shouldRetry(status, attempt)) {
                    gs.warn('[HuaweiVpcDiscovery] fetch got ' + status + ' for ' + pathname + ', retrying (attempt ' + attempt + ')');
                    gs.sleep(this._computeBackoffMs(attempt));
                    continue;
                }

                gs.error('[HuaweiVpcDiscovery] fetch failed for ' + pathname + ': ' + status + ' - ' + response.getBody());
                return null;
            } catch (ex) {
                gs.error('[HuaweiVpcDiscovery] fetch exception for ' + pathname + ': ' + ex.message);
                return null;
            }
        }
        return null;
    },

    // ------------------------------------------------------------------
    // Map & reconcile via Identification & Reconciliation Engine
    // ------------------------------------------------------------------
    // Mirrors lib/mapVpcSubnetToIRE.js's buildIREPayload() inline (ServiceNow
    // scoped scripts cannot require() - keep both in sync when changing the
    // mapping rules). Full containment chain confirmed via 4 rounds of real
    // errors (see lib/mapVpcSubnetToIRE.js's header comment for the full
    // trail): cmdb_ci_cloud_service_account --Hosted on::Hosts-->
    // cmdb_ci_logical_datacenter --Hosted on::Hosts--> cmdb_ci_network
    // --Contains::Contained by--> cmdb_ci_cloud_subnet. The account/
    // datacenter placeholders are shared (one per run, not one per VPC),
    // same pattern as HuaweiECSDiscovery.reconcileCIs()'s single shared
    // virtualization-server placeholder - but here VPCs still get a real
    // N:M containment relation set to their subnets: each subnet's vpc_id
    // maps to its OWN parent VPC's item index, not a single fixed
    // placeholder.
    CI_CLASS_LOGICAL_DATACENTER: 'cmdb_ci_logical_datacenter',
    CI_CLASS_CLOUD_SERVICE_ACCOUNT: 'cmdb_ci_cloud_service_account',
    HOSTING_RELATION_TYPE: 'Hosted on::Hosts',

    // Security Group addition (Phase 2C) - mirrors
    // lib/mapSecurityGroupToIRE.js inline. CI_CLASS_SECURITY_GROUP
    // (sourced from AWS's Service Graph Connector docs) is real-PDI
    // confirmed to exist with real OOTB containment metadata (a genuine
    // MISSING_DEPENDENCY error referenced it by name - see
    // HOSTING_RELATION_TYPE usage below). NOT yet confirmed whether it has
    // a working Identification Rule - the payload was rejected on the
    // containment check before identification could be fully exercised;
    // confirm on the next real-PDI run now that the relation is fixed.
    CI_CLASS_SECURITY_GROUP: 'cmdb_ci_compute_security_group',

    reconcileCIs: function(vpcs, subnets, securityGroups) {
        vpcs = vpcs || [];
        subnets = subnets || [];
        securityGroups = securityGroups || [];
        if (!vpcs.length && !subnets.length && !securityGroups.length) return;

        var items = [];
        var relations = [];

        var accountIndex = null;
        var datacenterIndex = null;
        if (vpcs.length) {
            items.push({
                className: this.CI_CLASS_CLOUD_SERVICE_ACCOUNT,
                values: {
                    name: 'Huawei Cloud Account - ' + this.accountId,
                    account_id: this.accountId,
                    // datacenter_type is a mandatory `table_name`-type field
                    // (confirmed via real-PDI testing: REQUIRED_ATTRIBUTE_EMPTY
                    // without it) - tells ServiceNow's polymorphic cloud model
                    // which CI class represents the datacenters under this
                    // account. Set to CI_CLASS_LOGICAL_DATACENTER since that's
                    // the class actually used below.
                    datacenter_type: this.CI_CLASS_LOGICAL_DATACENTER,
                    short_description: 'Placeholder representing the Huawei Cloud account for logical-datacenter containment relationships'
                }
            });
            accountIndex = items.length - 1;

            items.push({
                className: this.CI_CLASS_LOGICAL_DATACENTER,
                values: {
                    name: 'Huawei Cloud - ' + this.region,
                    region: this.region,
                    short_description: 'Placeholder representing the Huawei Cloud region for VPC/network containment relationships'
                }
            });
            datacenterIndex = items.length - 1;
            // Relation direction: `parent` = the DEPENDENT item itself, `child` = what
            // satisfies its dependency (the host) - confirmed backward from initial
            // intuition via a real MISSING_DEPENDENCY error's arrow notation. See
            // lib/mapVpcSubnetToIRE.js's buildIREPayload() comment for the full
            // reasoning trail. OPPOSITE of HuaweiECSDiscovery.js's "Runs on::Runs"
            // relation (parent=host, child=VM).
            relations.push({ parent: String(datacenterIndex), child: String(accountIndex), type: this.HOSTING_RELATION_TYPE });
        }

        var vpcIndexById = {};
        for (var i = 0; i < vpcs.length; i++) {
            var v = vpcs[i];
            items.push({
                // object_id/cidr omitted, carried over from the cmdb_ci_vpc
                // field check - NOT independently re-confirmed for
                // cmdb_ci_network's own sys_dictionary.
                className: this.CI_CLASS_VPC,
                values: {
                    name: v.name || '',
                    correlation_id: v.id || '',
                    short_description: 'Huawei Cloud VPC - discovered via custom REST integration',
                    discovery_source: 'Huawei Cloud Custom Discovery'
                }
            });
            var vpcItemIndex = items.length - 1;
            vpcIndexById[v.id] = vpcItemIndex;
            relations.push({ parent: String(vpcItemIndex), child: String(datacenterIndex), type: this.HOSTING_RELATION_TYPE });
        }

        var unmatchedSubnetIds = [];
        for (var j = 0; j < subnets.length; j++) {
            var s = subnets[j];
            items.push({
                className: this.CI_CLASS_SUBNET,
                values: {
                    name: s.name || '',
                    correlation_id: s.id || '',
                    object_id: s.id || '',
                    cidr: s.cidr || '',
                    gateway: s.gateway_ip || '',
                    short_description: 'Huawei Cloud Subnet - discovered via custom REST integration',
                    discovery_source: 'Huawei Cloud Custom Discovery'
                }
            });
            var subnetIndex = items.length - 1;
            var vpcIndex = vpcIndexById[s.vpc_id];
            if (vpcIndex == null) {
                unmatchedSubnetIds.push(s.id);
                continue;
            }
            // CONTAINMENT_RELATION_TYPE direction is OPPOSITE of HOSTING_RELATION_TYPE's:
            // parent = the container (network), child = the contained item (subnet) - the
            // original, intuitive direction. Confirmed correct by real-PDI testing
            // (swapping it to match HOSTING_RELATION_TYPE's convention broke it; reverted).
            relations.push({ parent: String(vpcIndex), child: String(subnetIndex), type: this.CONTAINMENT_RELATION_TYPE });
        }

        if (unmatchedSubnetIds.length) {
            gs.warn('[HuaweiVpcDiscovery] ' + unmatchedSubnetIds.length + ' subnet(s) had no matching VPC in this fetch: ' + unmatchedSubnetIds.join(', '));
        }

        // Security Group: one item per group, plus a Hosted on::Hosts relation
        // to the SAME shared cmdb_ci_logical_datacenter placeholder VPC itself
        // is hosted under (datacenterIndex, built above) - real-PDI confirmed
        // (see lib/mapSecurityGroupToIRE.js's header comment for the full
        // trail). NOT a Contains::Contained by relation to the VPC - that was
        // the original design, wrong for two real reasons: Huawei's actual API
        // response has no vpc_id field to relate with, and
        // cmdb_ci_compute_security_group's real OOTB containment rule wants a
        // datacenter parent anyway (confirmed via a real MISSING_DEPENDENCY
        // error). No relation to ECS instances - see this file's header
        // comment for why.
        for (var k = 0; k < securityGroups.length; k++) {
            var sg = securityGroups[k];
            items.push({
                className: this.CI_CLASS_SECURITY_GROUP,
                values: {
                    name: sg.name || '',
                    correlation_id: sg.id || '',
                    object_id: sg.id || '',
                    short_description: sg.description || 'Huawei Cloud Security Group - discovered via custom REST integration',
                    discovery_source: 'Huawei Cloud Custom Discovery'
                }
            });
            var sgIndex = items.length - 1;
            if (datacenterIndex != null) {
                relations.push({ parent: String(sgIndex), child: String(datacenterIndex), type: this.HOSTING_RELATION_TYPE });
            }
        }

        // createOrUpdateCI takes TWO arguments: a source-identifier string,
        // then the payload as a JSON-encoded STRING (not an object) - same
        // calling convention gotcha already documented in
        // HuaweiECSDiscovery.js:219-226 (a one-argument call previously
        // produced a cryptic "Unrecognized token 'undefined'" parse error).
        //
        // IMPORTANT: createOrUpdateCI's return value is ITSELF a JSON
        // STRING, not a parsed object - confirmed via real-PDI testing
        // (the logged "IRE result" showed double-escaped quotes, the
        // signature of JSON.stringify()-ing an already-JSON string). Must
        // JSON.parse() it before the caller can read .hasError/.errorCount
        // - without this, result.hasError is always undefined on the raw
        // string, so a real IRE error (e.g. IDENTIFICATION_RULE_MISSING)
        // silently looks like success. This same bug pattern exists in
        // HuaweiECSDiscovery.js/HcConnectorEcsSync.js too, just never
        // exercised there since ECS's real-PDI testing never hit an actual
        // IRE-level error.
        try {
            var payload = JSON.stringify({ items: items, relations: relations });
            var rawResult = sn_cmdb.IdentificationEngine.createOrUpdateCI('Huawei Cloud Custom Discovery', payload);
            gs.info('[HuaweiVpcDiscovery] IRE result for ' + vpcs.length + ' vpc(s) + ' + subnets.length + ' subnet(s) + ' + securityGroups.length + ' security group(s): ' + rawResult);
            return JSON.parse(rawResult);
        } catch (ex) {
            gs.error('[HuaweiVpcDiscovery] IRE exception: ' + ex.message);
        }
    },

    run: function() {
        var vpcs = this.fetchVPCs();
        var subnets = this.fetchSubnets();
        var securityGroups = this.fetchSecurityGroups();
        gs.info('[HuaweiVpcDiscovery] Fetched ' + vpcs.length + ' VPC(s), ' + subnets.length + ' subnet(s), and ' + securityGroups.length + ' security group(s) across all pages');
        if (vpcs.length || subnets.length || securityGroups.length) this.reconcileCIs(vpcs, subnets, securityGroups);
    },

    // ------------------------------------------------------------------
    // AK/SK request signing (SDK-HMAC-SHA256) - mirrors lib/huaweiAkSkSigner.js
    // Copied byte-for-byte from HuaweiECSDiscovery.js - see that file's
    // header comment for the full rationale. Keep in sync via
    // check-mirror-drift.js's third PAIRS entry.
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
    // Pagination - marker-based, mirrors lib/vpcPagination.js (NOT
    // ecsPagination.js's offset-as-page-number logic - see this file's
    // header comment, Unknown B).
    // ------------------------------------------------------------------
    _shouldFetchNextPage: function(args) {
        if (!args.nextMarker) return false;
        if (args.pageItemCount < args.limit) return false;
        return true;
    },

    // ------------------------------------------------------------------
    // AK/SK credential resolution - identical to HuaweiECSDiscovery.js
    // ------------------------------------------------------------------
    _getCredential: function() {
        if (this._explicitCredential) return this._explicitCredential; // set in initialize(config) when config.accessKey/secretKey were given
        var scopePrefix = gs.getCurrentScopeName() + '.';
        var ak = gs.getProperty(scopePrefix + 'x_hwc.itom.access_key');
        var sk = gs.getProperty(scopePrefix + 'x_hwc.itom.secret_key');
        if (!ak || !sk) throw new Error('x_hwc.itom.access_key / .secret_key system properties not configured');
        return { ak: ak, sk: sk };
    },

    type: 'HuaweiVpcDiscovery'
};
