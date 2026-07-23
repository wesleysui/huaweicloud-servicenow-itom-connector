# HC Resource Sync State

**Table name:** `x_2021019_huawei_0_hc_resource_sync_state`
**Scope:** `x_2021019_huawei_0`

One row per (account, region, resource_type, native_key) - tracks whether a resource was seen in the most recent sync, driving the pending_retire -> retired lifecycle implemented as pure logic in lib/resourceLifecycle.js.

## Fields

| Field | Type | Mandatory | Unique | Default / Choices |
|---|---|---|---|---|
| `account` (Cloud Account) | Reference -> `x_2021019_huawei_0_hc_cloud_account` | Yes | No | - |
| `region` (Cloud Region) | Reference -> `x_2021019_huawei_0_hc_cloud_region` | Yes | No | - |
| `resource_type` (Resource Type) | String (60) | Yes | No | - |
| `native_key` (Source Native Key) | String (255) | Yes | No | - |
| `ci` (CI) | Reference -> `cmdb_ci` | No | No | - |
| `last_seen` (Last Seen) | Date/Time | Yes | No | - |
| `consecutive_miss_count` (Consecutive Miss Count) | Integer | No | No | 0 |
| `status` (Status) | Choice | Yes | No | active = Active; pending_retire = Pending Retire; retired = Retired (default: active) |

## Manual creation steps (Studio)

1. Open Studio for the app at scope `x_2021019_huawei_0` (display name "HC ITOM Connector").
2. File > New File > Table.
3. **Name**: `hc_resource_sync_state` (Studio prefixes it with the app scope automatically -> `x_2021019_huawei_0_hc_resource_sync_state`).
4. **Label**: `HC Resource Sync State`.
5. Add each field listed above via the table's field list, matching Type/Mandatory/Unique exactly.
   - For choice field `status`, add choice values: `active` (default), `pending_retire`, `retired`.
   - Reference field `account` points at `x_2021019_huawei_0_hc_cloud_account` - create that table first if it does not exist yet.
   - Reference field `region` points at `x_2021019_huawei_0_hc_cloud_region` - create that table first if it does not exist yet.
   - Reference field `ci` points at `cmdb_ci` - create that table first if it does not exist yet.
6. Save. Confirm the real table name matches `x_2021019_huawei_0_hc_resource_sync_state` before using it in any script.

## Composite uniqueness

- `(account, region, resource_type, native_key)` must be unique together.

ServiceNow has no simple UI for a true composite unique **database** constraint on a custom table, so this is **not** auto-created. Enforce it at the application layer: before inserting a row, query for an existing one matching all of the field(s) above (see `lib/compositeKey.js`'s `buildLookupConditions()`) and update it instead of inserting a duplicate. Optionally add a Before-Insert Business Rule doing the same check as defense in depth.

_Generated from `tables/hc_resource_sync_state.schema.json` by `scripts/generate-table-docs.js` - do not hand-edit, regenerate instead._
