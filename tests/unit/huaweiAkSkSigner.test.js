const { sign, canonicalURI, canonicalQueryString, EMPTY_BODY_SHA256 } = require('../../servicenow/discovery/lib/huaweiAkSkSigner');

/**
 * Expected Authorization values below were NOT hand-derived - they were
 * captured by running the official `@huaweicloud/huaweicloud-sdk-core`
 * npm package's `AKSKSigner.sign()` against the exact same request inputs
 * and confirming byte-for-byte equality with this implementation's output,
 * across 6 scenarios (GET/POST, with/without query params, special
 * characters, trailing slashes, key ordering). See servicenow/discovery/README.md
 * for how to redo that cross-check if this algorithm ever needs to change.
 */

const AK = 'AKDEMOACCESSKEY123';
const SK = 'SKDEMOSECRETKEY4567890abcdefghij';
const SDK_DATE = '20260717T124913Z'; // fixed, pre-formatted timestamp for determinism

describe('sign - cross-verified against official @huaweicloud/huaweicloud-sdk-core', () => {
  it('signs a GET request with query params', () => {
    const result = sign(
      {
        method: 'GET',
        pathname: '/v1/eecc7ec81ad346adbcde0a07fa343cb0/cloudservers/detail',
        queryParams: { limit: '100', offset: '0' },
        host: 'ecs.af-south-1.myhuaweicloud.com',
        sdkDate: SDK_DATE
      },
      { ak: AK, sk: SK }
    );
    expect(result.Authorization).toBe(
      'SDK-HMAC-SHA256 Access=AKDEMOACCESSKEY123, SignedHeaders=content-type;host;x-sdk-date, ' +
        'Signature=19cceef388fd9380e0d9d9b28ae4585398f73ead7b7d375f2867b21c2f97ada4'
    );
  });

  it('signs a POST request with a JSON body and no query params', () => {
    const result = sign(
      {
        method: 'POST',
        pathname: '/v3/auth/tokens',
        host: 'iam.af-south-1.myhuaweicloud.com',
        body: JSON.stringify({ hello: 'world', n: 1 }),
        sdkDate: SDK_DATE
      },
      { ak: AK, sk: SK }
    );
    expect(result.Authorization).toBe(
      'SDK-HMAC-SHA256 Access=AKDEMOACCESSKEY123, SignedHeaders=content-type;host;x-sdk-date, ' +
        'Signature=f13f67567a47799dbdf28dca9ecb47913f2f308843c92ba7d489cc99af8251b9'
    );
  });
});

describe('canonicalURI', () => {
  it('percent-encodes each path segment and adds a trailing slash', () => {
    expect(canonicalURI('/v1/proj/vpcs')).toBe('/v1/proj/vpcs/');
  });

  it('leaves an already-trailing-slash path with exactly one trailing slash', () => {
    expect(canonicalURI('/v1/proj/cloudservers/')).toBe('/v1/proj/cloudservers/');
  });
});

describe('canonicalQueryString', () => {
  it('sorts query params by key regardless of input order', () => {
    expect(canonicalQueryString({ offset: '5', limit: '25' })).toBe('limit=25&offset=5');
  });

  it('percent-encodes special characters in keys and values', () => {
    expect(canonicalQueryString({ name: 'web prod (01)!' })).toBe('name=web%20prod%20%2801%29%21');
  });

  it('returns an empty string when there are no query params', () => {
    expect(canonicalQueryString({})).toBe('');
  });
});

describe('EMPTY_BODY_SHA256', () => {
  it('matches the well-known SHA-256 hash of an empty string', () => {
    expect(EMPTY_BODY_SHA256).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
});
