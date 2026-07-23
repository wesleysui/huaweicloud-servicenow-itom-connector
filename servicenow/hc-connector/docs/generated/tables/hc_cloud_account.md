# HC Cloud Account

**Table name:** `x_2021019_huawei_0_hc_cloud_account`
**Scope:** `x_2021019_huawei_0`

One row per governed Huawei Cloud account. Replaces the current single-account, System-Property-only configuration - every discovery/sync run takes an account (and a region from HC Cloud Region) as explicit input instead of relying on one global set of properties.

## Fields

| Field | Type | Mandatory | Unique | Default / Choices |
|---|---|---|---|---|
| `account_id` (Account ID) | String (80) | Yes | Yes | - |
| `name` (Name) | String (100) | Yes | No | - |
| `ou_path` (Organizations OU Path) | String (255) | No | No | - |
| `auth_mode` (Auth Mode) | Choice | Yes | No | ak_sk = AK/SK (compat mode); agency = IAM Agency (default: ak_sk) |
| `default_region` (Default Region) | String (40) | No | No | - |
| `agency_name` (IAM Agency Name) | String (100) | No | No | - |
| `external_id` (External ID) | String (100) | No | No | - |
| `active` (Active) | True/False | No | No | true |

## Manual creation steps (Studio)

1. Open Studio for the app at scope `x_2021019_huawei_0` (display name "HC ITOM Connector").
2. File > New File > Table.
3. **Name**: `hc_cloud_account` (Studio prefixes it with the app scope automatically -> `x_2021019_huawei_0_hc_cloud_account`).
4. **Label**: `HC Cloud Account`.
5. Add each field listed above via the table's field list, matching Type/Mandatory/Unique exactly.
   - For choice field `auth_mode`, add choice values: `ak_sk` (default), `agency`.
6. Save. Confirm the real table name matches `x_2021019_huawei_0_hc_cloud_account` before using it in any script.

_Generated from `tables/hc_cloud_account.schema.json` by `scripts/generate-table-docs.js` - do not hand-edit, regenerate instead._
