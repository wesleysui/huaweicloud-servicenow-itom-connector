# HC Discovery Run

**Table name:** `x_2021019_huawei_0_hc_discovery_run`
**Scope:** `x_2021019_huawei_0`

One row per discovery/sync execution (one resource type, one account, one region). Built from lib/discoveryRunTracker.js's pure start/finish/summarize helpers - the ServiceNow-side insert/update is a thin wrapper around that pure logic.

## Fields

| Field | Type | Mandatory | Unique | Default / Choices |
|---|---|---|---|---|
| `account` (Cloud Account) | Reference -> `x_2021019_huawei_0_hc_cloud_account` | Yes | No | - |
| `region` (Cloud Region) | Reference -> `x_2021019_huawei_0_hc_cloud_region` | Yes | No | - |
| `resource_type` (Resource Type) | String (60) | Yes | No | - |
| `state` (State) | Choice | Yes | No | running = Running; completed = Completed; failed = Failed (default: running) |
| `started` (Started) | Date/Time | Yes | No | - |
| `ended` (Ended) | Date/Time | No | No | - |
| `success_count` (Success Count) | Integer | No | No | 0 |
| `fail_count` (Fail Count) | Integer | No | No | 0 |
| `error_summary` (Error Summary) | String (4000) | No | No | - |
| `correlation_id` (Correlation ID) | String (100) | No | No | - |
| `trace_id` (Trace ID) | String (100) | No | No | - |
| `dry_run` (Dry Run) | True/False | No | No | false |

## Manual creation steps (Studio)

1. Open Studio for the app at scope `x_2021019_huawei_0` (display name "HC ITOM Connector").
2. File > New File > Table.
3. **Name**: `hc_discovery_run` (Studio prefixes it with the app scope automatically -> `x_2021019_huawei_0_hc_discovery_run`).
4. **Label**: `HC Discovery Run`.
5. Add each field listed above via the table's field list, matching Type/Mandatory/Unique exactly.
   - For choice field `state`, add choice values: `running` (default), `completed`, `failed`.
   - Reference field `account` points at `x_2021019_huawei_0_hc_cloud_account` - create that table first if it does not exist yet.
   - Reference field `region` points at `x_2021019_huawei_0_hc_cloud_region` - create that table first if it does not exist yet.
6. Save. Confirm the real table name matches `x_2021019_huawei_0_hc_discovery_run` before using it in any script.

_Generated from `tables/hc_discovery_run.schema.json` by `scripts/generate-table-docs.js` - do not hand-edit, regenerate instead._
