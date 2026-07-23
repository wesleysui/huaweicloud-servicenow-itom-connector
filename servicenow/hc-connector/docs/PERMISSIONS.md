# HC ITOM Connector — Permission Matrix

**Status: Phase 2A — specified, not yet real-PDI verified.** The exact
manual steps to create the 6 tables, the `hc_connector_admin` role, and its
ACLs live in [`ACL-SETUP.md`](ACL-SETUP.md) — this document summarizes
what that produces. Nothing below is "done" until Steps 1–3 there have
actually been run against a real instance and the verification checklist
at the bottom of `ACL-SETUP.md` passes (see `docs/INSTALL.md` Step 2).

## Roles referenced by this connector

| Role | Purpose |
|---|---|
| `x_2021019_huawei_0.hc_connector_admin` | Full read/write on all HC ITOM Connector tables; can create/edit `HC Cloud Account`/`HC Cloud Region`/`HC Connector Config` (i.e. can see and change what accounts/regions/credentials are in scope). Created manually per `ACL-SETUP.md` Step 2. |
| `x_2021019_huawei_0.hc_connector_operator` (not built) | Originally sketched in Phase 1 as a read-only + trigger-discovery role. **Deliberately not shipped in Phase 2A** — see "Simplification" below. Read on the 3 configuration tables currently falls back to whatever Studio's table-wizard default grants (scoped-app users), not a dedicated role. |
| `itil` / `admin` (OOTB) | Existing ServiceNow roles that already govern `cmdb_ci`/`em_event`/`em_alert` access — unchanged by this connector. |

## Table-level ACLs (Phase 2A)

| Table | Read | Write / Create | Notes |
|---|---|---|---|
| `HC Cloud Account` | Studio table-wizard default (scoped-app read) | `hc_connector_admin` only | Contains `auth_mode`/`agency_name`/`external_id` — metadata, not secret values, but still configuration-adjacent. |
| `HC Cloud Region` | Studio table-wizard default | `hc_connector_admin` only | Carries `project_id` (added Phase 2A) alongside `region`/`sync_enabled`. |
| `HC Connector Config` | Studio table-wizard default | `hc_connector_admin` only | Holds tunables like the consecutive-miss retirement threshold. |
| `HC Discovery Run` | Studio table-wizard default | System-generated (written by `HcConnectorEcsSync.js` running as the invoking user/service account, not directly by end users) — Studio default ACLs unchanged | |
| `HC Resource Sync State` | Studio table-wizard default | System-generated, Studio default ACLs unchanged | |
| `HC Event Ingestion Record` | Studio table-wizard default | System-generated (webhook/gateway ingestion script), Studio default ACLs unchanged | `raw_payload` is sanitized/truncated before storage (`lib/payloadSanitizer.js`) — not yet wired to a real ingestion path (Phase 5), but the field-level protection exists regardless of who can read the table. |

## Simplification vs. Phase 1's original sketch

Phase 1's `PERMISSIONS.md` sketched a two-role split
(`hc_connector_admin` + `hc_connector_operator`). Phase 2A ships only
`hc_connector_admin`, deliberately smaller and easier to verify in one
pass — full rationale and exact steps in `ACL-SETUP.md`'s "Simplification"
section. Adding `hc_connector_operator` later is additive, not breaking.

## Credential handling

- No credential values are ever stored on `HC Cloud Account` itself
  (`auth_mode`/`agency_name`/`external_id` are metadata, not secrets).
- Today's compat path (`AkSkSystemPropertyProvider`) reads System
  Properties named `x_hwc.itom.<account_id>.access_key` /
  `x_hwc.itom.<account_id>.secret_key` — one AK/SK pair per `HC Cloud
  Account.account_id`, same `password2`-typed-secret pattern already
  documented (and real-account verified) in
  `servicenow/discovery/README.md`, just account-scoped. See
  `docs/INSTALL.md` Step 4.
- Production target unchanged from Phase 1: ServiceNow **Credential
  Alias / Connection** records, resolved by `AgencyCredentialProvider`
  once implemented (needs a real Huawei Organizations account — see
  `docs/ARCHITECTURE.md`). Still an interface stub, not built.

## Verification

Not yet run against a real instance. When it is, use the checklist at the
bottom of `ACL-SETUP.md` (admin can create Account/Region records;
non-privileged user is blocked; all 6 tables/fields confirmed present via
`sys_db_object`/`sys_dictionary`).
