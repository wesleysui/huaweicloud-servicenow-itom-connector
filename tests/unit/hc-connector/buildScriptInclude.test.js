const fs = require('fs');
const { stripModuleExports, assertNoRequire, inlineModules, buildScriptInclude, SHARED_MODULES, BUILD_TARGETS, MARKER } =
  require('../../../servicenow/hc-connector/scripts/build-script-include');

describe('stripModuleExports', () => {
  it('removes a trailing module.exports block, keeping everything before it', () => {
    const source = 'function foo() { return 1; }\n\nmodule.exports = { foo: foo };\n';
    expect(stripModuleExports(source)).toBe('function foo() { return 1; }');
  });

  it('handles module.exports with no leading blank line', () => {
    const source = 'function foo() { return 1; }\nmodule.exports = { foo: foo };';
    expect(stripModuleExports(source)).toBe('function foo() { return 1; }');
  });

  it('throws when there is no module.exports to find, rather than silently returning the whole file', () => {
    expect(() => stripModuleExports('function foo() {}')).toThrow(/module\.exports/);
  });
});

describe('assertNoRequire', () => {
  it('does not throw for a module with no require() calls', () => {
    expect(() => assertNoRequire('clean.js', 'function foo() { return 1; }')).not.toThrow();
  });

  it('throws when the module contains a require() call', () => {
    expect(() => assertNoRequire('dirty.js', "var x = require('./other');")).toThrow(/dirty\.js/);
  });

  it('does not false-positive on the word "require" used outside a call', () => {
    expect(() => assertNoRequire('clean.js', '// this module does not require anything external')).not.toThrow();
  });
});

describe('inlineModules (integration - runs against the real lib files)', () => {
  it('inlines every module in SHARED_MODULES with no leftover module.exports or require()', () => {
    const inlined = inlineModules(SHARED_MODULES);
    expect(inlined).not.toMatch(/module\.exports/);
    expect(inlined).not.toMatch(/\brequire\s*\(/);
    SHARED_MODULES.forEach((fileName) => {
      expect(inlined).toContain('inlined from lib/' + fileName);
    });
  });

  it('defaults to SHARED_MODULES when no list is given', () => {
    expect(inlineModules()).toBe(inlineModules(SHARED_MODULES));
  });

  it('produces syntactically valid JavaScript on its own', () => {
    expect(() => new Function(inlineModules())).not.toThrow();
  });

  it('regression: fails loudly (not silently) if a listed module gains a require() call in the future', () => {
    // simulated via assertNoRequire directly, since we don't want to mutate real lib files for this test
    expect(() => assertNoRequire('resourceLifecycle.js', "var x = require('./compositeKey');")).toThrow();
  });
});

describe('buildScriptInclude', () => {
  it('replaces the marker with the inlined modules and leaves the rest of the template untouched', () => {
    const template = 'var Before = 1;\n' + MARKER + '\nvar After = 2;\n';
    const output = buildScriptInclude(template);
    expect(output).toContain('var Before = 1;');
    expect(output).toContain('var After = 2;');
    expect(output).toContain('inlined from lib/credentialProvider.js');
    expect(output).not.toContain(MARKER);
  });

  it('throws if the template is missing the marker', () => {
    expect(() => buildScriptInclude('var NoMarkerHere = true;')).toThrow(/marker/i);
  });

  it('produces syntactically valid JavaScript for a realistic template shape', () => {
    const template = [
      MARKER,
      '',
      'var HcConnectorEcsSync = Class.create();',
      'HcConnectorEcsSync.prototype = {',
      '    initialize: function() {},',
      '    type: "HcConnectorEcsSync"',
      '};'
    ].join('\n');
    const output = buildScriptInclude(template);
    expect(() => new Function(output)).not.toThrow();
  });
});

describe('BUILD_TARGETS (integration - runs against the real repo layout)', () => {
  it('lists at least the ECS and VPC orchestrator targets', () => {
    const templateNames = BUILD_TARGETS.map((t) => t.templateFile.split('/').pop());
    expect(templateNames).toContain('HcConnectorEcsSync.js');
    expect(templateNames).toContain('HcConnectorVpcSync.js');
  });

  it('every target template file exists and contains the marker', () => {
    BUILD_TARGETS.forEach((target) => {
      const source = fs.readFileSync(target.templateFile, 'utf8');
      expect(source).toContain(MARKER);
    });
  });

  it('every target builds syntactically valid JavaScript', () => {
    BUILD_TARGETS.forEach((target) => {
      const template = fs.readFileSync(target.templateFile, 'utf8');
      const output = buildScriptInclude(template, target.modules);
      expect(() => new Function(output)).not.toThrow();
    });
  });
});
