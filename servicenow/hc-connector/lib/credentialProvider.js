/**
 * Credential provider abstraction for the HC ITOM Connector.
 *
 * Discovery/sync code should depend on this interface (getCredentials()),
 * never directly on gs.getProperty()/System Properties - that's an
 * implementation detail of one provider (AkSkSystemPropertyProvider), kept
 * only as a documented compat/dev path, not the production credential model.
 *
 * AgencyCredentialProvider is an interface stub only. Implementing real
 * Huawei Cloud Organizations + IAM Agency STS token exchange requires a
 * real Organizations-enabled account to build and verify against - not
 * attempted here. See docs/ARCHITECTURE.md for the target design.
 */

/**
 * Single source of truth for the AK/SK System Property naming convention.
 * AkSkSystemPropertyProvider below (the read side) calls this rather than
 * re-deriving the pattern inline - the same naming logic is also what
 * docs/INSTALL.md documents for admins entering credentials by hand via
 * the native System Properties form, so this function's output is the
 * literal source of truth for that instruction text too (a naming drift
 * here already caused a real scope-prefix mixup once during this
 * project's Phase 2A real-PDI debugging).
 * @param {string} suffix - 'access_key' or 'secret_key'
 * @param {string} [accountId] - when given, returns the account-scoped name; omit for the flat single-account name
 * @returns {string}
 */
function buildAccountScopedPropertyName(suffix, accountId) {
  return accountId ? ('x_hwc.itom.' + accountId + '.' + suffix) : ('x_hwc.itom.' + suffix);
}

/**
 * @param {(name: string) => string} propertyReader - abstracts gs.getProperty(scope + '.' + name); kept as a parameter so this stays unit-testable in Node without any ServiceNow dependency.
 * @param {string} [accountId] - when given, reads account-scoped property names (x_hwc.itom.<accountId>.access_key) instead of the flat single-account names, so multiple HC Cloud Account rows can each carry distinct AK/SK in this compat mode. Omit for the original single-account behavior (unchanged).
 */
function AkSkSystemPropertyProvider(propertyReader, accountId) {
  if (!(this instanceof AkSkSystemPropertyProvider)) {
    return new AkSkSystemPropertyProvider(propertyReader, accountId);
  }
  if (typeof propertyReader !== 'function') {
    throw new Error('AkSkSystemPropertyProvider requires a propertyReader function');
  }
  this._propertyReader = propertyReader;
  this._accountId = accountId || null;
}

AkSkSystemPropertyProvider.prototype.mode = 'ak_sk';

/**
 * @param {string} suffix - 'access_key' or 'secret_key'
 * @returns {string}
 */
AkSkSystemPropertyProvider.prototype._propertyName = function _propertyName(suffix) {
  return buildAccountScopedPropertyName(suffix, this._accountId);
};

/**
 * @returns {{mode: 'ak_sk', accessKey: string, secretKey: string}}
 */
AkSkSystemPropertyProvider.prototype.getCredentials = function getCredentials() {
  var accessKeyProp = this._propertyName('access_key');
  var secretKeyProp = this._propertyName('secret_key');
  var accessKey = this._propertyReader(accessKeyProp);
  var secretKey = this._propertyReader(secretKeyProp);
  if (!accessKey || !secretKey) {
    throw new Error('AK/SK not configured - set ' + accessKeyProp + ' / ' + secretKeyProp);
  }
  return { mode: 'ak_sk', accessKey: accessKey, secretKey: secretKey };
};

/**
 * NOT IMPLEMENTED. Interface stub for Huawei Cloud Organizations + IAM
 * Agency (assume-role style STS token exchange), matching HC Cloud
 * Account.auth_mode = 'agency'.
 * @param {{agencyName?: string, externalId?: string, accountId?: string}} [config]
 */
function AgencyCredentialProvider(config) {
  if (!(this instanceof AgencyCredentialProvider)) {
    return new AgencyCredentialProvider(config);
  }
  this._config = config || {};
}

AgencyCredentialProvider.prototype.mode = 'agency';

AgencyCredentialProvider.prototype.getCredentials = function getCredentials() {
  throw new Error(
    'AgencyCredentialProvider is not implemented - requires a real Huawei Cloud ' +
    'Organizations/IAM Agency account to build and verify STS token exchange against. ' +
    'See servicenow/hc-connector/docs/ARCHITECTURE.md.'
  );
};

/**
 * Factory matching HC Cloud Account.auth_mode.
 * @param {'ak_sk'|'agency'} mode
 * @param {{propertyReader?: Function, accountId?: string, config?: Object}} [deps]
 */
function createCredentialProvider(mode, deps) {
  deps = deps || {};
  if (mode === 'ak_sk') return new AkSkSystemPropertyProvider(deps.propertyReader, deps.accountId);
  if (mode === 'agency') return new AgencyCredentialProvider(deps.config);
  throw new Error('Unknown auth mode: ' + mode);
}

module.exports = {
  buildAccountScopedPropertyName: buildAccountScopedPropertyName,
  AkSkSystemPropertyProvider: AkSkSystemPropertyProvider,
  AgencyCredentialProvider: AgencyCredentialProvider,
  createCredentialProvider: createCredentialProvider
};
