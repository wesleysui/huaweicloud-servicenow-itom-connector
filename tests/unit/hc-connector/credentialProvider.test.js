const {
  buildAccountScopedPropertyName,
  AkSkSystemPropertyProvider,
  AgencyCredentialProvider,
  createCredentialProvider
} = require('../../../servicenow/hc-connector/lib/credentialProvider');

describe('buildAccountScopedPropertyName', () => {
  it('returns the flat name when no accountId is given', () => {
    expect(buildAccountScopedPropertyName('access_key')).toBe('x_hwc.itom.access_key');
  });

  it('returns the account-scoped name when accountId is given', () => {
    expect(buildAccountScopedPropertyName('secret_key', 'acct-a')).toBe('x_hwc.itom.acct-a.secret_key');
  });
});

describe('AkSkSystemPropertyProvider', () => {
  it('returns AK/SK read via the injected property reader', () => {
    const values = {
      'x_hwc.itom.access_key': 'AK123',
      'x_hwc.itom.secret_key': 'SK456'
    };
    const provider = new AkSkSystemPropertyProvider((name) => values[name]);
    expect(provider.mode).toBe('ak_sk');
    expect(provider.getCredentials()).toEqual({ mode: 'ak_sk', accessKey: 'AK123', secretKey: 'SK456' });
  });

  it('throws if access key or secret key is missing', () => {
    const provider = new AkSkSystemPropertyProvider(() => undefined);
    expect(() => provider.getCredentials()).toThrow(/AK\/SK not configured/);
  });

  it('requires a propertyReader function to construct', () => {
    expect(() => new AkSkSystemPropertyProvider()).toThrow(/requires a propertyReader function/);
  });

  it('works without "new" (factory-callable)', () => {
    const provider = AkSkSystemPropertyProvider(() => 'x');
    expect(provider.getCredentials().accessKey).toBe('x');
  });

  it('reads the flat, unscoped property names when no accountId is given (unchanged single-account behavior)', () => {
    const values = { 'x_hwc.itom.access_key': 'AK-flat', 'x_hwc.itom.secret_key': 'SK-flat' };
    const provider = new AkSkSystemPropertyProvider((name) => values[name]);
    expect(provider.getCredentials()).toEqual({ mode: 'ak_sk', accessKey: 'AK-flat', secretKey: 'SK-flat' });
  });

  it('reads account-scoped property names when accountId is given, so two accounts can have distinct AK/SK', () => {
    const values = {
      'x_hwc.itom.acct-a.access_key': 'AK-A', 'x_hwc.itom.acct-a.secret_key': 'SK-A',
      'x_hwc.itom.acct-b.access_key': 'AK-B', 'x_hwc.itom.acct-b.secret_key': 'SK-B'
    };
    const providerA = new AkSkSystemPropertyProvider((name) => values[name], 'acct-a');
    const providerB = new AkSkSystemPropertyProvider((name) => values[name], 'acct-b');
    expect(providerA.getCredentials()).toEqual({ mode: 'ak_sk', accessKey: 'AK-A', secretKey: 'SK-A' });
    expect(providerB.getCredentials()).toEqual({ mode: 'ak_sk', accessKey: 'AK-B', secretKey: 'SK-B' });
  });

  it('does not fall back to the flat property names when an accountId is given but its scoped properties are missing', () => {
    const values = { 'x_hwc.itom.access_key': 'AK-flat', 'x_hwc.itom.secret_key': 'SK-flat' };
    const provider = new AkSkSystemPropertyProvider((name) => values[name], 'acct-a');
    expect(() => provider.getCredentials()).toThrow(/x_hwc\.itom\.acct-a\.access_key/);
  });
});

describe('AgencyCredentialProvider', () => {
  it('is a documented stub that throws NotImplemented', () => {
    const provider = new AgencyCredentialProvider({ agencyName: 'foo' });
    expect(provider.mode).toBe('agency');
    expect(() => provider.getCredentials()).toThrow(/not implemented/i);
  });
});

describe('createCredentialProvider', () => {
  it('creates an AK/SK provider for mode "ak_sk"', () => {
    const provider = createCredentialProvider('ak_sk', { propertyReader: () => 'v' });
    expect(provider).toBeInstanceOf(AkSkSystemPropertyProvider);
  });

  it('creates an Agency provider for mode "agency"', () => {
    const provider = createCredentialProvider('agency', { config: {} });
    expect(provider).toBeInstanceOf(AgencyCredentialProvider);
  });

  it('throws for an unknown mode', () => {
    expect(() => createCredentialProvider('bogus')).toThrow(/Unknown auth mode/);
  });

  it('passes accountId through to the AK/SK provider it creates', () => {
    const values = { 'x_hwc.itom.acct-x.access_key': 'AK-X', 'x_hwc.itom.acct-x.secret_key': 'SK-X' };
    const provider = createCredentialProvider('ak_sk', { propertyReader: (name) => values[name], accountId: 'acct-x' });
    expect(provider.getCredentials().accessKey).toBe('AK-X');
  });
});
