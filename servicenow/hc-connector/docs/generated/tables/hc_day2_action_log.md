# HC Day-2 Action Log

**Table name:** `x_2021019_huawei_0_hc_day2_action_log`
**Scope:** `x_2021019_huawei_0`

One row per Day-2 lifecycle action invocation (start/stop/reboot/resize/attach/detach) against an ECS CI. Written by HcConnectorEcsLifecycleAction's performX() methods at request time, then updated to a terminal status (success/fail) either by a later ad hoc checkJobStatus() call or by the periodic HC Connector Day-2 Job Poller scheduled job - this is what lets an admin see the final outcome from the CI form's own related list, instead of needing Background Scripts or the Huawei Cloud console every time a job wasn't done yet at the first check.

## Fields

| Field | Type | Mandatory | Unique | Default / Choices |
|---|---|---|---|---|
| `ci` (CI) | Reference -> `cmdb_ci_vm_instance` | Yes | No | - |
| `action` (Action) | Choice | Yes | No | start = Start; stop = Stop; reboot = Reboot; resize = Resize; attach = Attach Volume; detach = Detach Volume |
| `params` (Params) | String (255) | No | No | - |
| `job_id` (Job ID) | String (100) | No | No | - |
| `status` (Status) | Choice | Yes | No | requested = Requested; running = Running; success = Success; fail = Fail (default: requested) |
| `requested_by` (Requested By) | Reference -> `sys_user` | No | No | - |
| `requested_at` (Requested At) | Date/Time | Yes | No | - |
| `updated_at` (Updated At) | Date/Time | No | No | - |
| `error_message` (Error Message) | String (4000) | No | No | - |

## Manual creation steps (Studio)

1. Open Studio for the app at scope `x_2021019_huawei_0` (display name "HC ITOM Connector").
2. File > New File > Table.
3. **Name**: `hc_day2_action_log` (Studio prefixes it with the app scope automatically -> `x_2021019_huawei_0_hc_day2_action_log`).
4. **Label**: `HC Day-2 Action Log`.
5. Add each field listed above via the table's field list, matching Type/Mandatory/Unique exactly.
   - For choice field `action`, add choice values: `start`, `stop`, `reboot`, `resize`, `attach`, `detach`.
   - For choice field `status`, add choice values: `requested` (default), `running`, `success`, `fail`.
   - Reference field `ci` points at `cmdb_ci_vm_instance` - create that table first if it does not exist yet.
   - Reference field `requested_by` points at `sys_user` - create that table first if it does not exist yet.
6. Save. Confirm the real table name matches `x_2021019_huawei_0_hc_day2_action_log` before using it in any script.

_Generated from `tables/hc_day2_action_log.schema.json` by `scripts/generate-table-docs.js` - do not hand-edit, regenerate instead._
