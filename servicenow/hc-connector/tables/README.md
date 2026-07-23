# HC ITOM Connector — table schemas

Each `*.schema.json` file here is the single canonical definition of one new
table. Two build tools consume it (see `../scripts/`):

- `generate-table-docs.js` → a Markdown spec of the exact manual creation
  steps (for an admin doing it by hand in Studio/table editor).
- `generate-provision-script.js` → a best-effort, idempotent `GlideRecord`
  script (paste once into Background Scripts, **Global** scope) that creates
  the table (`sys_db_object`) and its columns (`sys_dictionary`) if missing.

Neither of these is a real platform export — this project's rule
(established for Discovery/Event Management) is to never fabricate one by
hand. **The provisioning script is unverified against a real PDI** until
tested interactively — treat the generated Markdown doc as the guaranteed
path, the script as a time-saving attempt on top of it.

## Schema field format

```json
{
  "name": "hc_cloud_account",
  "label": "HC Cloud Account",
  "scope": "x_2021019_huawei_0",
  "description": "One row per governed Huawei Cloud account.",
  "fields": [
    {
      "name": "account_id",
      "column_type": "string",
      "max_length": 80,
      "label": "Account ID",
      "mandatory": true,
      "unique": true
    },
    {
      "name": "auth_mode",
      "column_type": "choice",
      "label": "Auth Mode",
      "mandatory": true,
      "default_value": "ak_sk",
      "choices": [
        { "value": "ak_sk", "label": "AK/SK (compat)" },
        { "value": "agency", "label": "IAM Agency" }
      ]
    },
    {
      "name": "region",
      "column_type": "reference",
      "reference_table": "x_2021019_huawei_0_hc_cloud_region",
      "label": "Region",
      "mandatory": false
    }
  ]
}
```

Supported `column_type` values: `string` (needs `max_length`), `reference`
(needs `reference_table` — the *full* scoped table name, not just the
short name), `boolean`, `integer`, `glide_date_time`, `choice` (needs
`choices[]` and optionally `default_value`).

The real deployed table name is always `<scope>_<name>` (e.g.
`x_2021019_huawei_0_hc_cloud_account`) — `name` in the schema file is the
short form for readability in this repo.

## Composite uniqueness (`unique_together`)

An optional top-level `unique_together` array declares field groups that
must be unique together (per-field `unique: true` only covers a single
column). Example: `"unique_together": [["account", "region"]]`.

ServiceNow's table editor has no simple UI for a true composite unique
*database* constraint on a custom table, so `generate-provision-script.js`
does **not** attempt to fabricate one. Enforcement is at the **application
layer** instead: look up an existing row by the composite key before
inserting (upsert), using `lib/compositeKey.js`'s `buildLookupConditions()`
to build the `GlideRecord` query. `generate-table-docs.js` documents this
as a manual step (an optional Before-Insert Business Rule as defense in
depth) rather than claiming it's automated.
