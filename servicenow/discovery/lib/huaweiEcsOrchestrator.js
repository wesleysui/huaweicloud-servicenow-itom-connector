const { isTokenValid } = require('./iamTokenCache');
const { shouldRetry, computeBackoffMs } = require('./httpResilience');
const { buildPageQuery, shouldFetchNextPage } = require('./ecsPagination');

/**
 * SUPERSEDED as the active auth path (see lib/iamTokenCache.js for why) - the
 * active HuaweiECSDiscovery.js no longer does IAM auth/token caching at all,
 * it signs each request with AK/SK instead. Kept as a fully-tested reference
 * for the password-auth control flow (retry, pagination, re-auth-once-on-401,
 * cache reuse) in case an instance only has username+password IAM accounts
 * available. Not currently wired into the active Script Include.
 *
 * Framework-agnostic orchestration for IAM auth + paginated ECS fetch.
 *
 * This mirrors what a password-auth version of HuaweiECSDiscovery.js would
 * do, but with every side effect (HTTP calls, token persistence, sleeping,
 * wall-clock time, jitter randomness) injected as a dependency. That lets the
 * FLOW ITSELF — retry-then-succeed, give-up-after-N-attempts, multi-page
 * fetch, re-auth-once-on-401, cache reuse — be exercised end-to-end with a
 * scripted fake HTTP client in Node (see tests/unit/huaweiEcsOrchestrator.test.js),
 * without touching ServiceNow or a live Huawei Cloud account.
 *
 * @param {object} deps
 * @param {(req: {method: string, url: string, headers?: object, body?: string}) => {status: number, headers?: object, body?: string}} deps.httpRequest
 * @param {() => ({token: string, expiresAt: string} | null)} deps.getCachedToken
 * @param {(token: string, expiresAt: string) => void} deps.setCachedToken
 * @param {() => void} deps.clearCachedToken
 * @param {() => {username: string, password: string}} deps.getCredential
 * @param {(ms: number) => void} [deps.sleep]
 * @param {() => string} [deps.now] - returns current time as an ISO-8601 string
 * @param {() => number} [deps.random] - injectable source of randomness for jitter
 * @param {{region?: string, domainName?: string, projectName?: string, projectId?: string, pageLimit?: number, maxRetries?: number}} [config]
 */
function createDiscoveryOrchestrator(deps, config = {}) {
  const region = config.region || 'cn-north-4';
  const domainName = config.domainName;
  const projectName = config.projectName;
  const projectId = config.projectId;
  const pageLimit = config.pageLimit || 100;
  const maxRetries = config.maxRetries != null ? config.maxRetries : 3;

  const sleep = deps.sleep || (() => {});
  const now = deps.now || (() => new Date().toISOString());
  const random = deps.random || Math.random;

  function authenticate() {
    const cred = deps.getCredential();
    const requestBody = JSON.stringify({
      auth: {
        identity: {
          methods: ['password'],
          password: {
            user: { name: cred.username, password: cred.password, domain: { name: domainName } }
          }
        },
        scope: { project: { name: projectName } }
      }
    });

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const response = deps.httpRequest({
        method: 'POST',
        url: `https://iam.${region}.myhuaweicloud.com/v3/auth/tokens`,
        headers: { 'Content-Type': 'application/json;charset=utf8' },
        body: requestBody
      });

      if (response.status === 201) {
        const token = response.headers['X-Subject-Token'];
        const expiresAt = JSON.parse(response.body).token.expires_at;
        deps.setCachedToken(token, expiresAt);
        return token;
      }

      if (shouldRetry(response.status, attempt, maxRetries)) {
        sleep(computeBackoffMs(attempt, { random }));
        continue;
      }
      return null;
    }
    return null;
  }

  function getIAMToken() {
    const cached = deps.getCachedToken();
    if (isTokenValid(cached, now())) return cached.token;
    return authenticate();
  }

  // Returns: { servers, count } on success, { reauth: true } on 401,
  // or null on a non-retryable / retry-exhausted failure.
  function fetchPage(token, pageIndex) {
    const { offset, limit } = buildPageQuery(pageIndex, pageLimit);

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const response = deps.httpRequest({
        method: 'GET',
        url: `https://ecs.${region}.myhuaweicloud.com/v1/${projectId}/cloudservers/detail?limit=${limit}&offset=${offset}`,
        headers: { 'X-Auth-Token': token }
      });

      if (response.status === 200) {
        const body = JSON.parse(response.body);
        return { servers: body.servers || [], count: body.count };
      }

      if (response.status === 401) return { reauth: true };

      if (shouldRetry(response.status, attempt, maxRetries)) {
        sleep(computeBackoffMs(attempt, { random }));
        continue;
      }
      return null;
    }
    return null;
  }

  function fetchECSInstances(initialToken) {
    let token = initialToken;
    let allServers = [];
    let totalCount;
    let pageIndex = 0;
    let reauthed = false;

    while (true) {
      const page = fetchPage(token, pageIndex);

      if (page === null) break; // hard failure, give up with what we have

      if (page.reauth) {
        if (reauthed) break; // already tried a forced re-auth once, don't loop forever
        deps.clearCachedToken();
        token = authenticate();
        reauthed = true;
        if (!token) break;
        continue; // retry the SAME pageIndex with the fresh token
      }

      allServers = allServers.concat(page.servers);
      totalCount = page.count;

      const continuePaging = shouldFetchNextPage({
        pageServerCount: page.servers.length,
        limit: pageLimit,
        totalFetched: allServers.length,
        totalCount
      });
      if (!continuePaging) break;
      pageIndex++;
    }

    return allServers;
  }

  return { getIAMToken, authenticate, fetchPage, fetchECSInstances };
}

module.exports = { createDiscoveryOrchestrator };
