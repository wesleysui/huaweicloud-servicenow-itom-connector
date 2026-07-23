# HC Connector Config

**Table name:** `x_2021019_huawei_0_hc_connector_config`
**Scope:** `x_2021019_huawei_0`

Connector-wide key/value settings not tied to a specific account/region (e.g. default consecutive-miss threshold for retirement, gateway enablement toggle). Deliberately a flat key/value table rather than a System Property list, so settings are visible/editable alongside the other HC ITOM Connector tables instead of scattered in sys_properties.

## Fields

| Field | Type | Mandatory | Unique | Default / Choices |
|---|---|---|---|---|
| `key` (Key) | String (100) | Yes | Yes | - |
| `value` (Value) | String (4000) | No | No | - |
| `description` (Description) | String (500) | No | No | - |
| `category` (Category) | Choice | Yes | No | lifecycle = Lifecycle; gateway = Gateway; discovery = Discovery; general = General (default: general) |

## Manual creation steps (Studio)

1. Open Studio for the app at scope `x_2021019_huawei_0` (display name "HC ITOM Connector").
2. File > New File > Table.
3. **Name**: `hc_connector_config` (Studio prefixes it with the app scope automatically -> `x_2021019_huawei_0_hc_connector_config`).
4. **Label**: `HC Connector Config`.
5. Add each field listed above via the table's field list, matching Type/Mandatory/Unique exactly.
   - For choice field `category`, add choice values: `lifecycle`, `gateway`, `discovery`, `general` (default).
6. Save. Confirm the real table name matches `x_2021019_huawei_0_hc_connector_config` before using it in any script.

_Generated from `tables/hc_connector_config.schema.json` by `scripts/generate-table-docs.js` - do not hand-edit, regenerate instead._
