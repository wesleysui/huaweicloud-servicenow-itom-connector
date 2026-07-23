#!/usr/bin/env node
/**
 * Reads every servicenow/hc-connector/tables/*.schema.json and generates a
 * human-readable Markdown creation spec under
 * servicenow/hc-connector/docs/generated/tables/<name>.md - the guaranteed
 * fallback for creating each table by hand in Studio, independent of
 * whether generate-provision-script.js's automated path works on a given
 * instance. Never generates a fake Update Set XML.
 *
 * Usage: node servicenow/hc-connector/scripts/generate-table-docs.js
 */

var fs = require('fs');
var path = require('path');

var TABLES_DIR = path.join(__dirname, '..', 'tables');
var OUT_DIR = path.join(__dirname, '..', 'docs', 'generated', 'tables');

var TYPE_LABELS = {
  string: function (f) { return 'String (' + f.max_length + ')'; },
  reference: function (f) { return 'Reference -> `' + f.reference_table + '`'; },
  boolean: function () { return 'True/False'; },
  integer: function () { return 'Integer'; },
  glide_date_time: function () { return 'Date/Time'; },
  choice: function () { return 'Choice'; }
};

function loadSchemas() {
  return fs.readdirSync(TABLES_DIR)
    .filter(function (f) { return f.endsWith('.schema.json'); })
    .map(function (f) {
      var raw = fs.readFileSync(path.join(TABLES_DIR, f), 'utf8');
      return JSON.parse(raw);
    });
}

function fieldTypeLabel(field) {
  var fn = TYPE_LABELS[field.column_type];
  return fn ? fn(field) : field.column_type;
}

function fieldDefaultOrChoices(field) {
  if (field.column_type === 'choice' && field.choices) {
    return field.choices.map(function (c) { return c.value + ' = ' + c.label; }).join('; ') +
      (field.default_value ? ' (default: ' + field.default_value + ')' : '');
  }
  if (field.default_value !== undefined) return String(field.default_value);
  return '-';
}

function renderTableMarkdown(schema) {
  var fullTableName = schema.scope + '_' + schema.name;
  var lines = [];

  lines.push('# ' + schema.label);
  lines.push('');
  lines.push('**Table name:** `' + fullTableName + '`');
  lines.push('**Scope:** `' + schema.scope + '`');
  lines.push('');
  lines.push(schema.description);
  lines.push('');
  lines.push('## Fields');
  lines.push('');
  lines.push('| Field | Type | Mandatory | Unique | Default / Choices |');
  lines.push('|---|---|---|---|---|');
  schema.fields.forEach(function (field) {
    lines.push('| `' + field.name + '` (' + field.label + ') | ' + fieldTypeLabel(field) + ' | ' +
      (field.mandatory ? 'Yes' : 'No') + ' | ' + (field.unique ? 'Yes' : 'No') + ' | ' +
      fieldDefaultOrChoices(field) + ' |');
  });
  lines.push('');
  lines.push('## Manual creation steps (Studio)');
  lines.push('');
  lines.push('1. Open Studio for the app at scope `' + schema.scope + '` (display name "HC ITOM Connector").');
  lines.push('2. File > New File > Table.');
  lines.push('3. **Name**: `' + schema.name + '` (Studio prefixes it with the app scope automatically -> `' + fullTableName + '`).');
  lines.push('4. **Label**: `' + schema.label + '`.');
  lines.push('5. Add each field listed above via the table\'s field list, matching Type/Mandatory/Unique exactly.');
  schema.fields.filter(function (f) { return f.column_type === 'choice'; }).forEach(function (f) {
    lines.push('   - For choice field `' + f.name + '`, add choice values: ' +
      f.choices.map(function (c) { return '`' + c.value + '`' + (c.value === f.default_value ? ' (default)' : ''); }).join(', ') + '.');
  });
  schema.fields.filter(function (f) { return f.column_type === 'reference'; }).forEach(function (f) {
    lines.push('   - Reference field `' + f.name + '` points at `' + f.reference_table + '` - create that table first if it does not exist yet.');
  });
  lines.push('6. Save. Confirm the real table name matches `' + fullTableName + '` before using it in any script.');
  lines.push('');

  if (schema.unique_together && schema.unique_together.length) {
    lines.push('## Composite uniqueness');
    lines.push('');
    schema.unique_together.forEach(function (group) {
      lines.push('- `(' + group.join(', ') + ')` must be unique together.');
    });
    lines.push('');
    lines.push('ServiceNow has no simple UI for a true composite unique **database** constraint on a ' +
      'custom table, so this is **not** auto-created. Enforce it at the application layer: before ' +
      'inserting a row, query for an existing one matching all of the field(s) above (see ' +
      '`lib/compositeKey.js`\'s `buildLookupConditions()`) and update it instead of inserting a ' +
      'duplicate. Optionally add a Before-Insert Business Rule doing the same check as defense in depth.');
    lines.push('');
  }

  lines.push('_Generated from `tables/' + schema.name + '.schema.json` by `scripts/generate-table-docs.js` - do not hand-edit, regenerate instead._');
  lines.push('');

  return lines.join('\n');
}

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  var schemas = loadSchemas();
  schemas.forEach(function (schema) {
    var outPath = path.join(OUT_DIR, schema.name + '.md');
    fs.writeFileSync(outPath, renderTableMarkdown(schema));
    console.log('wrote ' + path.relative(process.cwd(), outPath));
  });
  console.log('\n' + schemas.length + ' table doc(s) generated.');
}

main();
