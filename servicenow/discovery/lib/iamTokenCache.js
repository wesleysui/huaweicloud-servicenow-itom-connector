/**
 * SUPERSEDED as the active auth path: HuaweiECSDiscovery.js now signs each
 * request directly with AK/SK (see lib/huaweiAkSkSigner.js) instead of
 * fetching/caching a username+password IAM token, since AK/SK is what most
 * orgs already have provisioned (it's also what the Terraform module in
 * this repo uses) and needs no session-expiry handling at all.
 *
 * Kept as a documented alternative for instances where only human
 * username+password IAM accounts are available and AK/SK issuance isn't an
 * option. Still fully unit-tested (tests/unit/iamTokenCache.test.js) but not
 * currently wired into the active Script Include - see docs/ROADMAP.md.
 *
 * Validity check for a cached Huawei IAM token, so a password-auth Script
 * Include wouldn't need to re-authenticate on every scheduled run (IAM
 * tokens are valid ~24h). Storage itself (a small ServiceNow table) would be
 * platform-specific and live in the Script Include - this is just the pure
 * "is it still good" check.
 */

const DEFAULT_SKEW_SECONDS = 300; // treat the token as expired 5 min early to absorb clock drift

/**
 * @param {{token: string, expiresAt: string}|null} cachedToken
 * @param {string} nowIso - current time as an ISO-8601 string (injected for testability)
 * @param {number} [skewSeconds]
 * @returns {boolean}
 */
function isTokenValid(cachedToken, nowIso, skewSeconds = DEFAULT_SKEW_SECONDS) {
  if (!cachedToken || !cachedToken.token || !cachedToken.expiresAt) return false;

  const now = new Date(nowIso).getTime();
  const expiresAt = new Date(cachedToken.expiresAt).getTime();
  if (Number.isNaN(now) || Number.isNaN(expiresAt)) return false;

  return now < expiresAt - skewSeconds * 1000;
}

module.exports = { isTokenValid, DEFAULT_SKEW_SECONDS };
