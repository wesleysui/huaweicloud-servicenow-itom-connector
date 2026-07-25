#!/usr/bin/env node
/**
 * First real codegen for this project (per docs/ARCHITECTURE.md's "Codegen,
 * not manual mirroring" - Phase 1 explicitly deferred this to be proven
 * against the ECS refactor first, rather than generalized blind). Inlines a
 * fixed list of zero-cross-dependency lib modules (their `module.exports`
 * stripped) into a hand-written Script Include template at a marker
 * comment, producing a paste-ready Script Include, for each target in
 * BUILD_TARGETS below.
 *
 * Manifest-ified in Phase 2B when a second orchestrator (HcConnectorVpcSync)
 * needed the same treatment - was a single hardcoded template/lib-list/output
 * path through Phase 2A, since there was only ever one target until now.
 *
 * Deliberately narrow scope: does NOT touch
 * servicenow/discovery/HuaweiECSDiscovery.js's or HuaweiVpcDiscovery.js's
 * existing manual mirrors of pureJsSha256.js - those stay covered by
 * check-mirror-drift.js, unchanged, to avoid any regression risk to
 * already-real-account-verified crypto internals in this pass.
 *
 * Usage: node servicenow/hc-connector/scripts/build-script-include.js
 */

var fs = require('fs');
var path = require('path');

var LIB_DIR = path.join(__dirname, '..', 'lib');
var MARKER = '// __HC_CONNECTOR_INLINED_LIB__';

// Dependency order matters for readability even though none of these
// require() each other - that's a hard precondition for this simple
// concatenation approach to be safe at all (enforced by assertNoRequire()
// below, not just assumed). Both current targets reuse the same 5 modules -
// resource-type-specific mapping/pagination logic (mapVpcSubnetToIRE.js,
// vpcPagination.js, etc.) lives in servicenow/discovery/lib/ instead and is
// manually mirrored into the discovery Script Includes, same split as
// mapEcsToIRE.js/HuaweiECSDiscovery.js today - not inlined via this tool.
var SHARED_MODULES = [
  'credentialProvider.js',
  'resourceLifecycle.js',
  'compositeKey.js',
  'discoveryRunTracker.js',
  'syncStatePlanner.js'
];

var BUILD_TARGETS = [
  {
    templateFile: path.join(__dirname, '..', 'service-graph', 'HcConnectorEcsSync.js'),
    outFile: path.join(__dirname, '..', 'docs', 'generated', 'HcConnectorEcsSync.generated.js'),
    modules: SHARED_MODULES
  },
  {
    templateFile: path.join(__dirname, '..', 'service-graph', 'HcConnectorVpcSync.js'),
    outFile: path.join(__dirname, '..', 'docs', 'generated', 'HcConnectorVpcSync.generated.js'),
    modules: SHARED_MODULES
  },
  {
    templateFile: path.join(__dirname, '..', 'service-graph', 'HcConnectorEvsSync.js'),
    outFile: path.join(__dirname, '..', 'docs', 'generated', 'HcConnectorEvsSync.generated.js'),
    modules: SHARED_MODULES
  },
  {
    templateFile: path.join(__dirname, '..', 'service-graph', 'HcConnectorElbSync.js'),
    outFile: path.join(__dirname, '..', 'docs', 'generated', 'HcConnectorElbSync.generated.js'),
    modules: SHARED_MODULES
  },
  {
    templateFile: path.join(__dirname, '..', 'service-graph', 'HcConnectorRdsSync.js'),
    outFile: path.join(__dirname, '..', 'docs', 'generated', 'HcConnectorRdsSync.generated.js'),
    modules: SHARED_MODULES
  },
  {
    templateFile: path.join(__dirname, '..', 'service-graph', 'HcConnectorObsSync.js'),
    outFile: path.join(__dirname, '..', 'docs', 'generated', 'HcConnectorObsSync.generated.js'),
    modules: SHARED_MODULES
  }
];

var MODULE_EXPORTS_MARKER = /\n\s*module\.exports\s*=/;

/**
 * @param {string} source
 * @returns {string} source with the trailing `module.exports = {...};` block removed
 */
function stripModuleExports(source) {
  var match = MODULE_EXPORTS_MARKER.exec(source);
  if (!match) {
    throw new Error('Could not find "module.exports =" in source - refusing to guess, fix the lib file or this stripper');
  }
  return source.slice(0, match.index).trim();
}

// Matches a real require('module') / require("module") call specifically -
// not just the word "require" appearing in prose (a doc comment explaining
// *why* a module has no require() calls would otherwise false-positive on
// itself, which is exactly what happened writing lib/syncStatePlanner.js).
var REAL_REQUIRE_CALL = /\brequire\s*\(\s*['"]/;

/**
 * @param {string} fileName
 * @param {string} source
 * @throws if the source contains a real require(...) call - this tool only supports zero-cross-dependency lib modules
 */
function assertNoRequire(fileName, source) {
  if (REAL_REQUIRE_CALL.test(source)) {
    throw new Error(fileName + ' contains a require() call - build-script-include.js only inlines zero-cross-dependency ' +
      'lib modules by design (see the header comment). Either remove the require() or extend this tool to resolve it.');
  }
}

/**
 * @param {string[]} moduleList - filenames (relative to LIB_DIR) to inline, in order
 * @returns {string} every listed module, module.exports stripped, concatenated with per-file headers
 */
function inlineModules(moduleList) {
  moduleList = moduleList || SHARED_MODULES;
  return moduleList.map(function (fileName) {
    var fullPath = path.join(LIB_DIR, fileName);
    var source = fs.readFileSync(fullPath, 'utf8');
    assertNoRequire(fileName, source);
    var stripped = stripModuleExports(source);
    return '// ---- inlined from lib/' + fileName + ' (do not hand-edit here - edit the source and regenerate) ----\n' + stripped;
  }).join('\n\n');
}

/**
 * @param {string} template - the hand-written Script Include source containing MARKER
 * @param {string[]} [moduleList] - defaults to SHARED_MODULES
 * @returns {string} the generated Script Include
 */
function buildScriptInclude(template, moduleList) {
  moduleList = moduleList || SHARED_MODULES;
  if (template.indexOf(MARKER) === -1) {
    throw new Error('Template is missing the marker comment: ' + MARKER);
  }
  var inlined = inlineModules(moduleList);
  return '// AUTO-GENERATED by scripts/build-script-include.js\n' +
    '// + ' + moduleList.map(function (m) { return 'lib/' + m; }).join(', ') + '\n' +
    '// Do not hand-edit this file - edit the sources above and regenerate.\n\n' +
    template.replace(MARKER, inlined);
}

function main() {
  BUILD_TARGETS.forEach(function (target) {
    var template = fs.readFileSync(target.templateFile, 'utf8');
    var output = buildScriptInclude(template, target.modules);

    fs.mkdirSync(path.dirname(target.outFile), { recursive: true });
    fs.writeFileSync(target.outFile, output);
    console.log('wrote ' + path.relative(process.cwd(), target.outFile) + ' (' + target.modules.length + ' modules inlined)');
  });
}

module.exports = {
  stripModuleExports: stripModuleExports,
  assertNoRequire: assertNoRequire,
  inlineModules: inlineModules,
  buildScriptInclude: buildScriptInclude,
  SHARED_MODULES: SHARED_MODULES,
  BUILD_TARGETS: BUILD_TARGETS,
  MARKER: MARKER
};

if (require.main === module) {
  main();
}
