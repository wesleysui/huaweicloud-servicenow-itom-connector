#!/usr/bin/env node
/**
 * Phase 1 v1 drift-check for the two existing manually-mirrored files
 * (HuaweiECSDiscovery.js mirrors several lib/*.js modules inline;
 * webhook-scripted-rest.js mirrors lib/mapAlarmToEvent.js inline - both
 * because ServiceNow scoped scripts cannot require() external files).
 *
 * This is NOT full semantic diffing - Class.create() method syntax in the
 * ServiceNow scripts legitimately differs from the lib's plain function
 * declarations/module.exports, so whole-function-body text matching would
 * false-positive on every run. Instead this extracts small, distinctive,
 * genuinely load-bearing literal tokens (constants whose values must be
 * byte-for-byte identical for the mirrored logic to behave the same way -
 * e.g. the SHA-256 round constants, the severity level map) from each lib
 * file and verifies every one of them still appears in the mirror. If a
 * constant changes in the lib but the mirror isn't updated, this catches
 * it; full lib-to-ServiceNow-script codegen (removing manual mirroring
 * entirely) is Phase 2 scope, proven against these same two files first.
 *
 * Usage: node servicenow/hc-connector/scripts/check-mirror-drift.js
 * Exit code 0 = no drift found, 1 = drift found or a file was unreadable.
 */

var fs = require('fs');
var path = require('path');

var REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

var PAIRS = [
  {
    label: 'SHA-256 round/init hex constants: pureJsSha256.js -> HuaweiECSDiscovery.js',
    libFile: 'servicenow/discovery/lib/pureJsSha256.js',
    mirrorFile: 'servicenow/discovery/HuaweiECSDiscovery.js',
    pattern: /0x[0-9a-fA-F]{8}/g
  },
  {
    label: 'SHA-256 round/init hex constants: pureJsSha256.js -> HuaweiVpcDiscovery.js',
    libFile: 'servicenow/discovery/lib/pureJsSha256.js',
    mirrorFile: 'servicenow/discovery/HuaweiVpcDiscovery.js',
    pattern: /0x[0-9a-fA-F]{8}/g
  },
  {
    label: 'Severity LEVEL_MAP entries: mapAlarmToEvent.js -> webhook-scripted-rest.js',
    libFile: 'servicenow/event-management/lib/mapAlarmToEvent.js',
    mirrorFile: 'servicenow/event-management/webhook-scripted-rest.js',
    pattern: /\b(Critical|Major|Minor|Informational)\s*:\s*\d/g
  },
  {
    label: 'SHA-256 round/init hex constants: pureJsSha256.js -> HuaweiEvsDiscovery.js',
    libFile: 'servicenow/discovery/lib/pureJsSha256.js',
    mirrorFile: 'servicenow/discovery/HuaweiEvsDiscovery.js',
    pattern: /0x[0-9a-fA-F]{8}/g
  }
];

function readFile(relPath) {
  var abs = path.join(REPO_ROOT, relPath);
  return fs.readFileSync(abs, 'utf8');
}

function extractTokens(content, pattern) {
  var matches = content.match(pattern) || [];
  return matches;
}

function tokenCounts(tokens) {
  var counts = {};
  tokens.forEach(function (t) {
    counts[t] = (counts[t] || 0) + 1;
  });
  return counts;
}

function checkPair(pair) {
  var libContent = readFile(pair.libFile);
  var mirrorContent = readFile(pair.mirrorFile);

  var libTokens = extractTokens(libContent, pair.pattern);
  var mirrorCounts = tokenCounts(extractTokens(mirrorContent, pair.pattern));

  if (libTokens.length === 0) {
    return { pair: pair, ok: false, missing: [], error: 'no tokens matched in lib file - pattern may be stale' };
  }

  var seenInMirror = {};
  var missing = [];
  libTokens.forEach(function (token) {
    var already = seenInMirror[token] || 0;
    if ((mirrorCounts[token] || 0) > already) {
      seenInMirror[token] = already + 1;
    } else if (missing.indexOf(token) === -1) {
      missing.push(token);
    }
  });

  return { pair: pair, ok: missing.length === 0, missing: missing, libTokenCount: libTokens.length };
}

function main() {
  var results = PAIRS.map(checkPair);
  var anyFailure = false;

  results.forEach(function (result) {
    if (result.error) {
      anyFailure = true;
      console.error('[FAIL] ' + result.pair.label + ' - ' + result.error);
      return;
    }
    if (result.ok) {
      console.log('[OK]   ' + result.pair.label + ' (' + result.libTokenCount + ' tokens checked)');
    } else {
      anyFailure = true;
      console.error('[FAIL] ' + result.pair.label + ' - missing from mirror: ' + result.missing.join(', '));
    }
  });

  if (anyFailure) {
    console.error('\nDrift detected - update the mirrored ServiceNow script(s) above to match the lib source.');
    process.exit(1);
  }
  console.log('\nNo drift detected across ' + results.length + ' mirrored pair(s).');
}

main();
