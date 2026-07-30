const { loadSchemasInDependencyOrder, renderFieldProvisionCall, renderScript } =
  require('../../../servicenow/hc-connector/scripts/generate-provision-script');

describe('loadSchemasInDependencyOrder', () => {
  it('orders every referenced table before the tables that reference it', () => {
    const schemas = loadSchemasInDependencyOrder();
    const indexOf = (name) => schemas.findIndex((s) => s.name === name);

    expect(indexOf('hc_cloud_account')).toBeLessThan(indexOf('hc_cloud_region'));
    expect(indexOf('hc_cloud_region')).toBeLessThan(indexOf('hc_discovery_run'));
    expect(indexOf('hc_cloud_region')).toBeLessThan(indexOf('hc_resource_sync_state'));
  });

  it('includes all 7 known tables exactly once', () => {
    const schemas = loadSchemasInDependencyOrder();
    expect(schemas).toHaveLength(7);
    const names = schemas.map((s) => s.name);
    expect(new Set(names).size).toBe(7);
  });
});

describe('renderFieldProvisionCall', () => {
  const schema = { scope: 'x_test_0', name: 'hc_test_table' };

  it('regression: emits default_value for a field that declares one (the exact gap the reviewer found)', () => {
    const field = { name: 'active', label: 'Active', column_type: 'boolean', default_value: true };
    const rendered = renderFieldProvisionCall(schema, field);
    expect(rendered).toContain('default_value: "true"');
  });

  it('emits default_value for a string/choice default too, not just booleans', () => {
    const field = { name: 'auth_mode', label: 'Auth Mode', column_type: 'choice', default_value: 'ak_sk', choices: [{ value: 'ak_sk', label: 'AK/SK' }] };
    const rendered = renderFieldProvisionCall(schema, field);
    expect(rendered).toContain('default_value: "ak_sk"');
  });

  it('emits default_value 0 (falsy but meaningful) for an integer field', () => {
    const field = { name: 'consecutive_miss_count', label: 'Consecutive Miss Count', column_type: 'integer', default_value: 0 };
    const rendered = renderFieldProvisionCall(schema, field);
    expect(rendered).toContain('default_value: "0"');
  });

  it('omits default_value entirely when the field does not declare one', () => {
    const field = { name: 'name', label: 'Name', column_type: 'string', max_length: 100, mandatory: true };
    const rendered = renderFieldProvisionCall(schema, field);
    expect(rendered).not.toContain('default_value');
  });

  it('produces syntactically valid, parseable JavaScript for a field with every optional attribute set', () => {
    const field = {
      name: 'auth_mode', label: 'Auth Mode', column_type: 'choice', mandatory: true, unique: true,
      default_value: 'ak_sk', choices: [{ value: 'ak_sk', label: 'AK/SK' }, { value: 'agency', label: 'Agency' }]
    };
    const rendered = 'var out = [];\n' + renderFieldProvisionCall(schema, field);
    expect(() => new Function(rendered)).not.toThrow();
  });
});

describe('renderScript', () => {
  it('produces syntactically valid JavaScript end-to-end for the real schemas', () => {
    const schemas = loadSchemasInDependencyOrder();
    const script = renderScript(schemas);
    expect(() => new Function(script)).not.toThrow();
  });

  it('regression: every field with a default_value in any real schema produces a default_value line in the generated script', () => {
    const schemas = loadSchemasInDependencyOrder();
    const script = renderScript(schemas);
    var missing = [];
    schemas.forEach((schema) => {
      schema.fields.forEach((field) => {
        if (field.default_value === undefined) return;
        var expected = 'default_value: ' + JSON.stringify(String(field.default_value));
        if (script.indexOf(expected) === -1) {
          missing.push(schema.name + '.' + field.name);
        }
      });
    });
    expect(missing).toEqual([]);
  });

  it('includes an application-layer-enforcement reminder for every table with unique_together', () => {
    const schemas = loadSchemasInDependencyOrder();
    const script = renderScript(schemas);
    expect(script).toContain('x_2021019_huawei_0_hc_cloud_region: (account, region)');
    expect(script).toContain('x_2021019_huawei_0_hc_resource_sync_state: (account, region, resource_type, native_key)');
  });

  it('sets d.default_value in the generated createFieldIfMissing helper', () => {
    const schemas = loadSchemasInDependencyOrder();
    const script = renderScript(schemas);
    expect(script).toContain('if (field.default_value !== undefined) d.default_value = field.default_value;');
  });
});
