# ECS Discovery — Setup & Hardening Notes

> **Multi-account/multi-region?** Everything below documents the standalone
> single-account setup (`new HuaweiECSDiscovery().run()`, System Properties,
> unchanged since it was first verified). For multiple Huawei Cloud
> accounts/regions, see
> [`servicenow/hc-connector/service-graph/HcConnectorEcsSync.js`](../hc-connector/service-graph/HcConnectorEcsSync.js)
> and its [install guide](../hc-connector/docs/INSTALL.md) — it wraps this
> same Script Include (unchanged fetch/sign/reconcile logic, same
> `correlation_id`/`object_id` values) with per-account/region credential
> resolution, run tracking, upsert, and lifecycle retirement. Both paths
> coexist; using the orchestrator is optional, not a migration.

## Authentication: AK/SK signing (primary) vs. password/token (alternate)

`HuaweiECSDiscovery.js` signs each request directly with a Huawei Cloud
**Access Key / Secret Key** pair (the "SDK-HMAC-SHA256" AK/SK Signing and
Authentication Algorithm - see `lib/huaweiAkSkSigner.js`). This is the same
credential type the `terraform/` module in this repo already uses, needs no
session/token management, and is what most orgs actually have provisioned
for automation (vs. a human username+password IAM account).

An alternative password/IAM-token design (`lib/iamTokenCache.js` +
`lib/huaweiEcsOrchestrator.js`) is kept in the repo, fully unit-tested, for
instances where only username+password IAM accounts are available - it is
**not** currently wired into the active Script Include. Swapping to it means
restoring the `getIAMToken()`/`_authenticate()`/token-cache methods that were
removed from `HuaweiECSDiscovery.js` (see git history).

## System properties (AK/SK path)
| Property | Default | Purpose |
|---|---|---|
| `x_hwc.itom.region` | `cn-north-4` | Huawei Cloud region |
| `x_hwc.itom.project_id` | — | Project ID used in the ECS API path |
| `x_hwc.itom.page_limit` | `100` | Page size for the ECS list API |
| `x_hwc.itom.max_retry_attempts` | `3` | Max retries on 429/5xx before giving up |
| `x_hwc.itom.access_key` | — | Huawei Cloud Access Key (AK), type `string` |
| `x_hwc.itom.secret_key` | — | Huawei Cloud Secret Key (SK), type **`password2`** - `gs.getProperty()` auto-decrypts this type |

`x_hwc.itom.domain_name` / `.project_name` / `.token_cache_table` are only
relevant to the alternate password-auth path above; not read by the active
AK/SK Script Include.

## Setup checklist (do these in order)

1. **Activate plugins**: `Cloud Provisioning and Governance`, `CMDB IRE`.
2. **Create the system properties** above while your scoped app is the
   active application scope. The platform silently prefixes property names
   with your app's scope on creation (e.g. `x_hwc.itom.region` is actually
   stored as `x_2021019_huawei_0.x_hwc.itom.region`) - always create and
   read them while the correct scope is active, and read them in code via
   `gs.getCurrentScopeName() + '.' + propertyName`, never a hardcoded
   unprefixed literal.
3. **Store the AK/SK pair as System Properties**, not as a
   `discovery_credentials` record - `x_hwc.itom.access_key` as plain
   `string`, `x_hwc.itom.secret_key` as **`password2`** (ServiceNow
   auto-decrypts `password2` properties on `gs.getProperty()`). Reuse the
   same AK/SK already validated against this repo's `terraform/` module -
   same Huawei IAM user, same minimum permissions (read access to ECS).
4. **Register the `discovery_source` choice value.** `cmdb_ci.discovery_source`
   is a choice-list field and IRE rejects any value that isn't a registered
   choice (`INVALID_INPUT_DATA`). Run this from **Background Scripts with
   Application Scope set to Global** (writing to `sys_choice` is refused
   for scoped apps):
   ```javascript
   var gr = new GlideRecord('sys_choice');
   gr.addQuery('name', 'cmdb_ci');
   gr.addQuery('element', 'discovery_source');
   gr.addQuery('value', 'Huawei Cloud Custom Discovery');
   gr.query();
   if (gr.next()) {
       gr.inactive = false;
       gr.language = '';
       gr.update();
   } else {
       gr.initialize();
       gr.name = 'cmdb_ci';
       gr.element = 'discovery_source';
       gr.value = 'Huawei Cloud Custom Discovery';
       gr.label = 'Huawei Cloud Custom Discovery';
       gr.inactive = false;
       gr.language = '';
       gr.insert();
   }
   ```
   This exact string is also the `sourceName` argument passed to
   `createOrUpdateCI()` - keep both in sync if you rename it.
5. **Paste `HuaweiECSDiscovery.js` into a Script Include** in your scoped
   app, and schedule `run()`.

## Important notes and constraints

- **`fetchECSInstances()` throws on a page failure** (bad AK/SK, retries
  exhausted, network error) instead of silently returning whatever partial
  list it had fetched so far. This changed when
  `HcConnectorEcsSync.js` was added (Phase 2A) — a silent partial return
  was harmless for the original standalone `run()` (nothing downstream
  compared what was fetched against what was expected), but would have
  been actively dangerous once retirement logic exists on top of it (a
  silently-partial fetch would look identical to "these resources
  genuinely don't exist anymore" and could wrongly retire real CIs). If
  you call `fetchECSInstances()` directly rather than through `run()`,
  wrap it in try/catch.
- **Never parse ServiceNow date/time values with a plain JS `Date`.**
  `GlideRecord.getValue()`/`GlideDateTime.getValue()` return ServiceNow's
  native `"yyyy-MM-dd HH:mm:ss"` string, which `new Date(thatString)` does
  not reliably parse on Rhino (silently produces `Invalid Date`). Stay
  within `GlideDateTime` (numeric value, or plain substring slicing of its
  known fixed format) for any date math inside a Script Include.
- **Use `//` line comments and plain ASCII only.** Large `/* ... */` block
  comments and non-ASCII characters (em dashes, smart quotes) can fail to
  survive copy/paste into Studio's code editor and break compilation. All
  files under `servicenow/` follow this rule.
- **Raw Java interop (`Packages.*`) is blocked in scoped apps** —
  `java.lang.SecurityException: Use of Packages calls is not permitted in
  scoped applications`. This is a hard sandbox restriction with no ACL
  workaround. `GlideDigest` (`new GlideDigest().getSHA256Hex(str)`) is the
  documented scoped-app way to get a plain SHA-256 hex digest, but it has no
  HMAC variant and only accepts text input, not raw bytes - it cannot be
  adapted into HMAC. `GlideRSA` may not exist on your instance at all. For
  all of these reasons, `HuaweiECSDiscovery.js` implements SHA-256 and
  HMAC-SHA256 in pure ES5 JavaScript (`lib/pureJsSha256.js` - bitwise
  arithmetic on plain byte arrays, no platform API dependency at all),
  cross-verified against Node's `crypto` module and the official
  `@huaweicloud/huaweicloud-sdk-core` signer. Use this approach directly
  rather than reaching for a ServiceNow crypto class first.
- **Don't use `discovery_credentials` for the AK/SK pair.** Scoped-app
  access to decrypt a `discovery_credentials` password is either
  nonexistent (`getDecryptedPassword2` isn't a real method), refused by
  cross-scope policy (`gr.password.getDecryptedValue()`), or depends on a
  plugin/namespace that may not be active on your instance
  (`sn_credential.CredentialsAccessor`). System Properties with a
  `password2`-type field is the reliable path - see the setup checklist
  above.
- **`sn_cmdb.IdentificationEngine.createOrUpdateCI` takes two arguments**:
  `createOrUpdateCI(sourceName, jsonPayloadString)` - a source-identifier
  string first, the JSON-encoded payload as a **string** (not a parsed
  object) second. Calling it with a single argument produces a confusing
  `Unrecognized token 'undefined'` error from the Java-side JSON parser.
- **Register the `discovery_source` choice value via a `GlideRecord` script
  in Global scope**, not through Studio/UI choice-list editors - UI-based
  additions were unreliable in testing even when they appeared to save
  successfully. See the setup checklist above for the exact script; writing
  to `sys_choice` is refused for scoped apps, so this one step needs Global
  scope switched on temporarily (a one-time admin action, not something the
  Script Include does at runtime).
- **`cmdb_ci_vm_instance` cannot be created standalone.** It has an OOTB CMDB
  governance rule requiring at least one containment/hosting relationship.
  `reconcileCIs()` always creates/reuses a placeholder
  `cmdb_ci_virtualization_server` (named `Huawei Cloud - <region>`) and
  relates every discovered ECS instance to it via the relationship type
  `"Runs on::Runs"` (a real OOTB `cmdb_rel_type`). `cmdb_ci_logical_datacenter`
  does **not** work as this placeholder on a stock instance (its class has
  no containment rule metadata configured by default -
  `METADATA_RULE_MISSING`). `relations[]` entries reference `items[]` by
  **array index as strings** (e.g. `{"parent": "0", "child": "1", "type": "..."}"`),
  not sys_ids.
- **Include `object_id` in the VM instance payload**, not just
  `name`/`ip_address`/`correlation_id` - the Identification Rule for
  `cmdb_ci_vm_instance` needs it as a minimum matching attribute
  (`MISSING_MATCHING_ATTRIBUTES` otherwise). Set it to the same value as
  `correlation_id`.
- Don't send `virtual`, `host_name`, or `u_vpc_id` in the payload - none of
  them are real fields IRE recognizes on this CI class/instance, and
  sending them produces silent `unknown field` warnings.

## What changed in the hardening pass
- **Pagination**: `fetchECSInstances` loops pages using Huawei's
  page-number-based `offset` (see `lib/ecsPagination.js` for why that's not
  a row offset) instead of only reading the first `limit` results.
- **Retry/backoff**: each ECS page fetch retries on `429/500/502/503/504`
  with exponential backoff + jitter, up to `max_retry_attempts` (see
  `lib/httpResilience.js`).
- **No token/session to manage**: AK/SK signs each request independently, so
  there's no cache, no expiry, and no re-auth-on-401 concept - a 401/403
  means the AK/SK itself is wrong (fail fast), not "please log in again."
- **Deferred**: IRE `relations[]` (ECS -> VPC/Subnet/EVS) is intentionally
  not built yet - there's no VPC/EVS CI to relate to until those resource
  types get their own Discovery support.

## Testing

Layers of Node/Jest tests, all requiring zero live credentials:

1. **Pure math** - pagination math, retry/backoff math:
   `tests/unit/ecsPagination.test.js`, `tests/unit/httpResilience.test.js`.
2. **AK/SK request signing** - `lib/huaweiAkSkSigner.js` is cross-verified
   byte-for-byte against the official `@huaweicloud/huaweicloud-sdk-core` npm
   package's own signer (6 scenarios: GET/POST, with/without query params,
   special characters, trailing slashes, key ordering) - see
   `tests/unit/huaweiAkSkSigner.test.js` and the comment at the top of that
   lib file for how to redo the cross-check if the algorithm ever changes.
   The URI/query-string encoding functions inside `HuaweiECSDiscovery.js`
   were additionally diffed against this same lib to confirm the manual
   ServiceNow port didn't drift from the verified Node version.
3. **Pure-JS SHA-256/HMAC-SHA256** - `lib/pureJsSha256.js` is cross-checked
   against Node's own `crypto` module across empty/short/multi-block/unicode
   inputs and RFC-4231-shaped HMAC cases (`tests/unit/pureJsSha256.test.js`),
   and confirmed to reproduce the exact known-correct signature from
   `huaweiAkSkSigner.test.js` when substituted into the real signing
   pipeline. The copy inside `HuaweiECSDiscovery.js` was diffed against this
   lib (extracted and executed in Node) to confirm the port matches exactly.
4. **Password-auth alternative (not active)** - token-expiry check
   (`tests/unit/iamTokenCache.test.js`) and its full control-flow twin
   (`tests/unit/huaweiEcsOrchestrator.test.js`), kept passing even though not
   wired into the current Script Include.

The Script Include mirrors the relevant lib logic inline (ServiceNow scoped
scripts can't `require()` external files) - keep them in sync.

**End-to-end verification against a live ECS endpoint has been done**,
manually, against a real Huawei Cloud sandbox account and a real ServiceNow
PDI - real HTTP calls, a real ECS instance fetched, and a real
`cmdb_ci_vm_instance` CI + containment relationship created via IRE, coming
back completely clean on a repeat run (`hasError:false`, `hasWarning:false`,
`"operation":"NO_CHANGE"` for every item - confirming the reconciliation is
idempotent, not just error-free once). This was a manual, one-off run, not
an automated/repeatable test - turning it into a proper automated ATF suite
is still open, see [`tests/atf/README.md`](../../tests/atf/README.md).
