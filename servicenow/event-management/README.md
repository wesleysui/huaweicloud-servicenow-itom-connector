# Event Management — Setup & Hardening Notes

> **Status: fully verified end-to-end against real Huawei Cloud Eye (CES)
> alarm traffic** — a real CPU stress test on the sandbox ECS instance
> triggered a real alarm rule, which Huawei Cloud Eye pushed through a real
> SMN topic/subscription to this webhook, producing a real `em_alert` with
> the correct severity and a correctly bound `cmdb_ci`. Everything below
> reflects what real traffic actually looks like, not the CES API docs —
> several early assumptions about the payload shape turned out wrong on
> first contact with real data (see "Real SMN/CES message format" below).

## Setup checklist (do these in order)

1. **Activate the Event Management plugin.** Not on by default on a fresh
   PDI - activate via developer.servicenow.com "Manage Instance > Activate
   Plugins" (or Studio's plugin activation flow), and confirm it actually
   took via `sys_plugins.list` rather than trusting the confirmation email
   alone. Without this, `em_event` doesn't exist as a table and any insert
   into it fails with `invalid table name: em_event`.
2. **Create the `x_hwc.itom.webhook_secret` system property** while your
   scoped app is the active scope - this is the shared secret checked
   against the inbound `X-Webhook-Secret` header. Same scope-prefixing
   behavior as Discovery's properties applies here - read it at runtime via
   `gs.getCurrentScopeName() + '.x_hwc.itom.webhook_secret'`.
3. **Create the Scripted REST API Service + Resource through Studio's
   wizard**, using `webhook-scripted-rest.js` as the Resource script for
   `POST /api/x_hwc/itom/webhook/ces_alarm`. Don't create the Resource via a
   standalone `GlideRecord` insert - it won't be linked to its parent
   Service via the "API definition" field (the real field name is
   `web_service_definition`), and that field is read-only after creation so
   it can't be fixed afterward.
4. **Uncheck "Requires authentication" on the Resource.** This field
   defaults to checked, which makes the *platform itself* return `401`
   before your script ever runs - completely silently, with nothing in
   `syslog`, because the rejection happens before any of your `gs.error()`
   calls are reachable. This endpoint is meant to be called by an external
   system (Huawei SMN) with no ServiceNow login at all; the custom
   `X-Webhook-Secret` header check inside the script is the actual
   authorization mechanism, not platform auth. If SMN's delivery log shows
   `http_code: 401` on every attempt and nothing shows up in `syslog` no
   matter what you search for, check this field first.
5. **Create an SMN topic and an HTTPS subscription** pointing at the
   deployed endpoint, with a custom request header `X-Webhook-Secret` set to
   match the system property above (SMN supports up to 10 custom headers per
   subscription, as long as they start with `x-` and not `x-smn-`). SMN then
   sends a `SubscriptionConfirmation` message that must be confirmed by
   GETing its `subscribe_url` within 48h - `webhook-scripted-rest.js`
   auto-confirms this itself, so just check the subscription's status turns
   "Confirmed" a few seconds after creating it.
6. **Install the ServiceNow Store app "Service Operations Workspace ITOM
   Apps"**, then create the Event Rule through the resulting Event Rule
   Designer wizard using the exact field values in
   [`event-rule-designer-config.md`](event-rule-designer-config.md) - see
   "Event Rule creation" below for why this specific app is required.

**Confirmed working against real traffic**: a real Cloud Eye alarm rule
firing (and later recovering) on a real ECS instance produces real SMN
`SubscriptionConfirmation` (auto-confirmed) and `Notification` deliveries;
the webhook correctly unwraps the envelope, maps the real payload shape
(see below) into `em_event`, and the Event Rule turns that into a
correctly severity-mapped, CI-bound `em_alert`.

## Real SMN/CES message format

Two layers of "the payload isn't what the docs suggested," found only by
triggering a real alarm rather than continuing to guess from documentation:

**1. SMN's outer envelope.** Every push - regardless of content - arrives
wrapped like this, with the real content as a JSON **string** inside
`message`:
```json
{
  "type": "Notification",
  "message_id": "...",
  "topic_urn": "...",
  "message": "{...real CES alarm JSON, as a string...}",
  "signature": "...",
  "signing_cert_url": "...",
  "timestamp": "..."
}
```
`type` is also `SubscriptionConfirmation` or `UnsubscribeConfirmation` for
the handshake messages described in the setup checklist - see
`parseSmnNotification()`/`isSmnConfirmation()` in `lib/mapAlarmToEvent.js`.

**2. The inner CES alarm JSON** (`envelope.message`, parsed) does **not**
match the shape assumed before real testing:

| Assumed (wrong) | Real | Notes |
|---|---|---|
| `alarm_level` (number 1-4) at top level | Doesn't exist. Severity is `template_variable.AlarmLevel`, a **string** (`"Critical"`/`"Major"`/`"Minor"`/`"Informational"`) | `template_variable` is a rich, reliably-structured object CES includes for building notification text - treat it as the primary source, not an afterthought |
| `alarm_state` | `alarm_status`, values `"alarm"` (firing) / `"ok"` (recovered) | A recovery notification should map to ServiceNow severity `5` (OK/Clear), not run through the level map at all |
| `dimensions: [{name, value}]` (array) | `dimension`: a single **string**, `"instance_id:522d640b-..."` | Split on the first `:` to get the key/value; `template_variable.ResourceId` is more reliable anyway |
| `resource_name` at top level | Doesn't exist. Use `template_variable.ResourceName` | |
| `time`: ISO 8601 string | **Epoch milliseconds** (a number) | `body.time.replace(...)` throws `Cannot find function replace in object <number>` - real alarms silently failed to insert entirely until this was fixed, since the crash happened before `ev.insert()` |
| `condition` field | Doesn't exist. Use `comparison_operator` + `value` + `unit` + `count`, or just use `default_content` | Huawei already builds a complete, human-readable notification string in `default_content`/`sms_content` - simplest to use it directly as the `em_event` description rather than reassembling one from fragments |

`webhook-scripted-rest.js` and `lib/mapAlarmToEvent.js` (unit-tested,
`tests/unit/mapAlarmToEvent.test.js`) both reflect this real shape now -
see `fixtures/ces-alarm-payload.json` and
`fixtures/smn-notification-envelope.json` for a captured example (with
account-identifying fields left as originally observed, no secrets).

## Event Rule creation

On the "Australia" release, Event Rules are created through a wizard ("Event
Rule Designer" - Application Navigator search "Event Rules", the
**List**-type module, "New"), not by pasting a script into
`em_match_rule`/`em_mapping_rule`. That wizard's "New" button only works
once the ServiceNow Store app **"Service Operations Workspace ITOM Apps"**
is installed - it's the parent application that surfaces the Alerts
console / Express List UI and the Designer itself. Installing only the
smaller "Service Operations Workspace Alert Automation API" sub-component on
its own is not enough - its Now Experience screens exist as registered
routes but have no menu entry to reach them until the parent app is present.

The Designer is a no-code wizard (five steps: Event Rule Info, Event Filter,
Transform and Compose Alert Output, Threshold, Binding) with no scripting
option on the Transform step - all field computation (severity mapping,
description formatting, which field becomes the CI-matching value) has to
happen **before** the event is inserted instead, which is why that logic
now lives in `webhook-scripted-rest.js` rather than in an Event Rule
script. See [`event-rule-designer-config.md`](event-rule-designer-config.md)
for the exact values used in each step.

**Useful diagnostic technique** if you ever need to figure out where a newly
installed Store app's UI actually lives, instead of clicking around
guessing: query what it registered. Run in Background Scripts, Global scope,
read-only:

```javascript
var out = [];

var app = new GlideRecord('sys_app');
app.addQuery('name', 'CONTAINS', 'Alert Automation');
app.query();
while (app.next()) {
    out.push('APP: ' + app.name + ' | scope=' + app.scope);
}

// Now Experience UI Builder routes/screens the app registered
var route = new GlideRecord('sys_ux_app_route');
route.addQuery('sys_scope.scope', 'STARTSWITH', 'sn_sow');
route.query();
while (route.next()) {
    out.push('ROUTE: ' + route.getValue('name') + ' | scope=' + route.sys_scope.scope);
}

// Classic application-menu modules the app registered (if any)
var mod = new GlideRecord('sys_app_module');
mod.addQuery('sys_scope.scope', 'STARTSWITH', 'sn_sow');
mod.query();
while (mod.next()) {
    out.push('MODULE: ' + mod.getValue('title'));
}

gs.print(out.join('\n'));
```

An empty `MODULE:` result set alongside real `ROUTE:` entries is the
signature of a missing parent app - the feature is installed but nothing
links to its screens yet. This is exactly how "Service Operations Workspace
ITOM Apps" was identified as the missing piece here.

**CI binding gotcha**: the Binding step's default "CI Identification" mode
(Node field matched against CI name/FQDN/IP/MAC) only applies to CI types
extending `cmdb_ci_hardware`. `cmdb_ci_vm_instance` does **not** extend it on
this instance (confirmed via its `sys_db_object` class chain:
`cmdb_ci_vm_instance -> cmdb_ci_vm_object -> cmdb_ci -> cmdb`), so with the
default binding left in place every alert's `cmdb_ci` came back empty even
though the Node value exactly matched the CI's name. **Fixed** by switching
to "CI field matching" (CI type `Virtual Machine Instance`), clearing the
Node field in the Transform step, and adding a "Manual attributes" row
(`correlation_id` is `${resource}`) so the alert binds via the CI's
`correlation_id` instead - see
[`event-rule-designer-config.md`](event-rule-designer-config.md) for the
full configuration.

## Testing

Pure mapping logic (`lib/mapAlarmToEvent.js` — severity mapping from
`alarm_status`/`template_variable.AlarmLevel`, description via
`default_content`, `instance_id` extraction from `template_variable.ResourceId`
or the `dimension` string, SMN envelope unwrapping) is unit-tested
(`tests/unit/mapAlarmToEvent.test.js`, 20 tests) against a fixture captured
from a real alarm, with zero live dependencies - mirroring the pattern used
for Discovery.

**End-to-end verification, fully confirmed against real traffic**: a real
CPU stress test on the sandbox ECS instance triggered a real Cloud Eye alarm
rule, which pushed a real SMN `Notification` through a confirmed HTTPS
subscription to the live webhook endpoint. The resulting `em_event` had the
correct severity (`1`, mapped from `template_variable.AlarmLevel: "Critical"`),
the correct `resource`/`node` (from `template_variable.ResourceId`/
`ResourceName`), and Huawei's own human-readable `default_content` as the
description. The Event Rule picked it up and produced a real `em_alert`
with `severity: 1` and `cmdb_ci` correctly bound to the CI Discovery had
already created for that same instance.
