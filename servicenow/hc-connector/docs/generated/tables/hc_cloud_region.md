# HC Cloud Region

**Table name:** `x_2021019_huawei_0_hc_cloud_region`
**Scope:** `x_2021019_huawei_0`

One row per region enabled for a given HC Cloud Account. Every discovery/sync run's actual input is (account, region) - never a single global region. project_id is genuinely per-region in Huawei's IAM model (the same account has a different project_id in each region it's enabled in), which is why it lives here and not on HC Cloud Account.

## Fields

| Field | Type | Mandatory | Unique | Default / Choices |
|---|---|---|---|---|
| `account` (Cloud Account) | Reference -> `x_2021019_huawei_0_hc_cloud_account` | Yes | No | - |
| `region` (Region Code) | String (40) | Yes | No | - |
| `project_id` (Huawei Cloud Project ID) | String (80) | Yes | No | - |
| `sync_enabled` (Sync Enabled) | True/False | No | No | true |
| `last_success` (Last Successful Sync) | Date/Time | No | No | - |
| `last_error` (Last Error) | String (4000) | No | No | - |
| `active` (Active) | True/False | No | No | true |

## Manual creation steps (Studio)

1. Open Studio for the app at scope `x_2021019_huawei_0` (display name "HC ITOM Connector").
2. File > New File > Table.
3. **Name**: `hc_cloud_region` (Studio prefixes it with the app scope automatically -> `x_2021019_huawei_0_hc_cloud_region`).
4. **Label**: `HC Cloud Region`.
5. Add each field listed above via the table's field list, matching Type/Mandatory/Unique exactly.
   - Reference field `account` points at `x_2021019_huawei_0_hc_cloud_account` - create that table first if it does not exist yet.
6. Save. Confirm the real table name matches `x_2021019_huawei_0_hc_cloud_region` before using it in any script.

## Composite uniqueness

- `(account, region)` must be unique together.

ServiceNow has no simple UI for a true composite unique **database** constraint on a custom table, so this is **not** auto-created. Enforce it at the application layer: before inserting a row, query for an existing one matching all of the field(s) above (see `lib/compositeKey.js`'s `buildLookupConditions()`) and update it instead of inserting a duplicate. Optionally add a Before-Insert Business Rule doing the same check as defense in depth.

_Generated from `tables/hc_cloud_region.schema.json` by `scripts/generate-table-docs.js` - do not hand-edit, regenerate instead._
