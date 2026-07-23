# Event Rule Designer configuration — "Huawei Cloud Eye - CES Alarms"

On the "Australia" release, Event Rules are created through a wizard
("Event Rule Designer" — Application Navigator search "Event Rules", the
**List**-type module, "New"), not by pasting a script. This file documents
the exact field values used, so the rule can be recreated from scratch
without guessing — there is no importable artifact for this yet.

**Prerequisite**: the ServiceNow Store app **"Service Operations Workspace
ITOM Apps"** must be installed for the Designer's "New" button to work at
all — see `README.md` for why.

All severity mapping, field computation, and description formatting happens
in `webhook-scripted-rest.js` **before** the `em_event` insert, not in this
wizard — the wizard's "Transform and Compose Alert Output" step is a
no-code `${field}` template UI with no scripting option, so it's left at
its default pass-through values for most fields below.

## Step 1 — Event Rule Info
| Field | Value |
|---|---|
| Name | `Huawei Cloud Eye - CES Alarms` |
| Source | `Huawei Cloud Eye` (add as a new Source if not already registered — must exactly match `ev.source` in `webhook-scripted-rest.js`, case-sensitive) |
| Order | `100` (default) |
| Description | optional |
| Apply additional matching rules | unchecked |
| Active | on |

## Step 2 — Event Filter
No conditions added — the Source selected in Step 1 already scopes the rule.
"Ignore events that match this filter" left unchecked (that option is for
suppressing alert creation entirely, not for this rule's purpose).

## Step 3 — Transform and Compose Alert Output
Left at the default `${field}` pass-through values for Description, Type,
Resource, Message key, Severity, Metric name, Source instance, Source,
Classification — these are already correctly computed by
`webhook-scripted-rest.js` before the event is inserted.

Two fields are **not** left at default, because `cmdb_ci_vm_instance` does
not extend `cmdb_ci_hardware` on this instance (confirmed via its
`sys_db_object` class chain: `cmdb_ci_vm_instance -> cmdb_ci_vm_object ->
cmdb_ci -> cmdb`) and therefore doesn't qualify for the Binding step's
default host-based "CI Identification" matching (see Step 5):

- **Node**: cleared (left empty), per the Designer's own on-screen
  instructions for binding to "a non-host CI... any CI type not extending
  cmdb_ci_hardware."
- **Manual attributes**: checked, with one row added:
  `correlation_id` **is** `${resource}` — this tells the Designer to bind
  using the CI's `correlation_id` field (the same Huawei ECS instance UUID
  Discovery writes into `correlation_id` when creating the CI — see
  `servicenow/discovery/HuaweiECSDiscovery.js`) matched against the event's
  `resource` field. Checking this box auto-populates a corresponding
  `${correlation_id}` token into the "Additional information" field — this
  is the Designer managing that field itself, not something to edit or
  clear manually.

"Alert Tags" left blank.

## Step 4 — Threshold
"Active" left unchecked — every matching event should produce/update an
alert immediately, not only after crossing a count threshold.

## Step 5 — Binding
"Override default binding" **checked**. The default "CI Identification"
binding type (Node field matched against CI name/FQDN/IP/MAC) only applies
to CI types extending `cmdb_ci_hardware`, which `cmdb_ci_vm_instance` does
not on this instance — with the default left in place, `cmdb_ci` came back
empty on every alert (confirmed by testing).

| Field | Value |
|---|---|
| Binding type | `CI field matching` |
| CI type | `Virtual Machine Instance` (`cmdb_ci_vm_instance`) |

Combined with the Step 3 "Manual attributes" row (`correlation_id` is
`${resource}`), this binds each alert to the CI whose `correlation_id`
matches the event's `resource` field.

## Status
**✅ Confirmed working end-to-end against real Huawei Cloud Eye traffic**,
not just a simulated `curl` payload. A real CPU stress test on the sandbox
ECS instance (`instance_id: 522d640b-c673-4cbe-9fd5-d3582d036396`) triggered
a real Cloud Eye alarm rule, delivered via a real, confirmed SMN
subscription. The resulting alert had `severity: 1` (correctly mapped from
the real payload's `template_variable.AlarmLevel: "Critical"` - the
originally-assumed top-level `alarm_level` number field doesn't exist in
real notifications, see `servicenow/event-management/README.md`) and
`cmdb_ci` bound to the real CI Discovery created for that same instance
(`name: wsl-manual-smoke-test-1784281457`).
