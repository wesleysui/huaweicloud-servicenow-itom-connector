const { createDiscoveryOrchestrator } = require('../../servicenow/discovery/lib/huaweiEcsOrchestrator');

/**
 * These are integration-style tests: unlike the other unit tests, they don't
 * just check one pure math function — they drive the FULL control flow
 * (auth -> cache -> retry -> pagination -> re-auth-on-401) through a
 * scripted fake HTTP client, the way it would really run against Huawei
 * Cloud, but with zero network calls and zero ServiceNow dependency.
 */

function authSuccessResponse(token, expiresAt) {
  return {
    status: 201,
    headers: { 'X-Subject-Token': token },
    body: JSON.stringify({ token: { expires_at: expiresAt } })
  };
}

function ecsPageResponse(servers, count) {
  return { status: 200, body: JSON.stringify({ servers, count }) };
}

function makeDeps(overrides = {}) {
  let cache = null;
  return {
    httpRequest: jest.fn(),
    getCachedToken: jest.fn(() => cache),
    setCachedToken: jest.fn((token, expiresAt) => { cache = { token, expiresAt }; }),
    clearCachedToken: jest.fn(() => { cache = null; }),
    getCredential: jest.fn(() => ({ username: 'svc-account', password: 'secret' })),
    sleep: jest.fn(),
    now: jest.fn(() => '2026-07-17T08:00:00Z'),
    random: jest.fn(() => 0.5),
    ...overrides
  };
}

describe('getIAMToken', () => {
  it('authenticates and caches the token when nothing is cached', () => {
    const deps = makeDeps();
    deps.httpRequest.mockReturnValueOnce(authSuccessResponse('tok-1', '2026-07-18T00:00:00Z'));

    const orchestrator = createDiscoveryOrchestrator(deps, { domainName: 'd', projectName: 'p' });
    const token = orchestrator.getIAMToken();

    expect(token).toBe('tok-1');
    expect(deps.httpRequest).toHaveBeenCalledTimes(1);
    expect(deps.setCachedToken).toHaveBeenCalledWith('tok-1', '2026-07-18T00:00:00Z');
  });

  it('reuses a cached valid token without any HTTP call', () => {
    const deps = makeDeps({ getCachedToken: jest.fn(() => ({ token: 'cached-tok', expiresAt: '2026-07-20T00:00:00Z' })) });

    const orchestrator = createDiscoveryOrchestrator(deps, {});
    const token = orchestrator.getIAMToken();

    expect(token).toBe('cached-tok');
    expect(deps.httpRequest).not.toHaveBeenCalled();
  });

  it('retries once on a transient 503 then succeeds', () => {
    const deps = makeDeps();
    deps.httpRequest
      .mockReturnValueOnce({ status: 503 })
      .mockReturnValueOnce(authSuccessResponse('tok-2', '2026-07-18T00:00:00Z'));

    const orchestrator = createDiscoveryOrchestrator(deps, { maxRetries: 3 });
    const token = orchestrator.getIAMToken();

    expect(token).toBe('tok-2');
    expect(deps.httpRequest).toHaveBeenCalledTimes(2);
    expect(deps.sleep).toHaveBeenCalledTimes(1);
  });

  it('gives up and returns null after exhausting retries on repeated 503s', () => {
    const deps = makeDeps();
    deps.httpRequest.mockReturnValue({ status: 503 });

    const orchestrator = createDiscoveryOrchestrator(deps, { maxRetries: 2 });
    const token = orchestrator.getIAMToken();

    expect(token).toBeNull();
    expect(deps.httpRequest).toHaveBeenCalledTimes(3); // attempts 0,1,2
    expect(deps.sleep).toHaveBeenCalledTimes(2);        // no sleep after the final failed attempt
  });

  it('does not retry a non-retryable client error (e.g. 400)', () => {
    const deps = makeDeps();
    deps.httpRequest.mockReturnValue({ status: 400 });

    const orchestrator = createDiscoveryOrchestrator(deps, { maxRetries: 3 });
    const token = orchestrator.getIAMToken();

    expect(token).toBeNull();
    expect(deps.httpRequest).toHaveBeenCalledTimes(1);
    expect(deps.sleep).not.toHaveBeenCalled();
  });
});

describe('fetchECSInstances', () => {
  it('pages through the full result set using the correct offset/limit', () => {
    const deps = makeDeps();
    deps.httpRequest
      .mockReturnValueOnce(ecsPageResponse([{ id: 1 }, { id: 2 }], 3))
      .mockReturnValueOnce(ecsPageResponse([{ id: 3 }], 3)); // short page => stop

    const orchestrator = createDiscoveryOrchestrator(deps, { projectId: 'proj', pageLimit: 2, maxRetries: 1 });
    const servers = orchestrator.fetchECSInstances('tok');

    expect(servers).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
    expect(deps.httpRequest).toHaveBeenCalledTimes(2);
    expect(deps.httpRequest.mock.calls[0][0].url).toContain('offset=0');
    expect(deps.httpRequest.mock.calls[0][0].url).toContain('limit=2');
    expect(deps.httpRequest.mock.calls[1][0].url).toContain('offset=1'); // page NUMBER, not row offset
  });

  it('retries a single page on a transient error before giving up on that page', () => {
    const deps = makeDeps();
    deps.httpRequest
      .mockReturnValueOnce({ status: 502 })
      .mockReturnValueOnce(ecsPageResponse([{ id: 1 }], 1));

    const orchestrator = createDiscoveryOrchestrator(deps, { projectId: 'proj', pageLimit: 100, maxRetries: 2 });
    const servers = orchestrator.fetchECSInstances('tok');

    expect(servers).toEqual([{ id: 1 }]);
    expect(deps.sleep).toHaveBeenCalledTimes(1);
  });

  it('on a 401 mid-run, clears the cache, re-authenticates once, and retries the SAME page', () => {
    const deps = makeDeps();
    deps.httpRequest
      .mockReturnValueOnce(ecsPageResponse([{ id: 1 }, { id: 2 }], 4)) // page 0 (full)
      .mockReturnValueOnce({ status: 401 })                            // page 1 -> token rejected
      .mockReturnValueOnce(authSuccessResponse('fresh-tok', '2026-07-18T00:00:00Z')) // re-auth
      .mockReturnValueOnce(ecsPageResponse([{ id: 3 }, { id: 4 }], 4)); // page 1 retried -> success

    const orchestrator = createDiscoveryOrchestrator(deps, { projectId: 'proj', pageLimit: 2, maxRetries: 1, domainName: 'd', projectName: 'p' });
    const servers = orchestrator.fetchECSInstances('stale-tok');

    expect(servers).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }]);
    expect(deps.clearCachedToken).toHaveBeenCalledTimes(1);
    // The retried page-1 request must use the freshly re-authenticated token, not the stale one.
    expect(deps.httpRequest.mock.calls[3][0].headers['X-Auth-Token']).toBe('fresh-tok');
  });

  it('only forces re-auth once per run — a second 401 gives up instead of looping forever', () => {
    const deps = makeDeps();
    deps.httpRequest
      .mockReturnValueOnce({ status: 401 })                                          // page 0 -> rejected
      .mockReturnValueOnce(authSuccessResponse('fresh-tok', '2026-07-18T00:00:00Z')) // re-auth
      .mockReturnValueOnce({ status: 401 });                                         // page 0 retried -> still rejected

    const orchestrator = createDiscoveryOrchestrator(deps, { projectId: 'proj', pageLimit: 2, maxRetries: 1, domainName: 'd', projectName: 'p' });
    const servers = orchestrator.fetchECSInstances('stale-tok');

    expect(servers).toEqual([]);
    expect(deps.httpRequest).toHaveBeenCalledTimes(3);
    expect(deps.clearCachedToken).toHaveBeenCalledTimes(1);
  });

  it('stops paging once totalFetched reaches the reported total, even on a full last page', () => {
    const deps = makeDeps();
    deps.httpRequest.mockReturnValueOnce(ecsPageResponse([{ id: 1 }, { id: 2 }], 2)); // full page, but count===2

    const orchestrator = createDiscoveryOrchestrator(deps, { projectId: 'proj', pageLimit: 2, maxRetries: 1 });
    const servers = orchestrator.fetchECSInstances('tok');

    expect(servers).toEqual([{ id: 1 }, { id: 2 }]);
    expect(deps.httpRequest).toHaveBeenCalledTimes(1); // did NOT fetch a (nonexistent) page 1
  });
});
