# HC ITOM Connector — Table + Role + ACL Setup (Phase 2A)

Manual, by design (see `docs/ARCHITECTURE.md` design decision 9): the 6
tables are created via **Studio's table wizard**, not the
`generate-provision-script.js` path from Phase 1. Studio auto-generates
sane default scoped-app ACLs when it creates a table; a raw
`GlideRecord`/`sys_dictionary` insert does not. Given this phase actually
puts real data behind these tables (credentials-adjacent account/region
config, discovery run history), getting default ACLs right matters more
than saving a few minutes of manual clicking — so this is the one place in
the whole project where the "try the automated path first" pattern is
deliberately not followed.

`generate-table-docs.js`'s output (`docs/generated/tables/*.md`) still has
the exact field list/types/mandatory/choices for each table — use those
alongside Studio, don't re-derive them by hand.

## Step 1 — Create the 6 tables in Studio

For each of `hc_cloud_account`, `hc_cloud_region`, `hc_discovery_run`,
`hc_resource_sync_state`, `hc_event_ingestion_record`, `hc_connector_config`:

1. Open Studio for the app at scope `x_2021019_huawei_0` (display name
   "HC ITOM Connector").
2. File > New File > Table.
3. **Name**: the short name above (Studio prefixes it automatically ->
   e.g. `x_2021019_huawei_0_hc_cloud_account`).
4. **Label**: from `docs/generated/tables/<name>.md`'s header.
5. Add every field from that same doc's field table, matching Type/
   Mandatory/Unique exactly, including choice values for choice fields and
   the correct `reference_table` for reference fields (create tables in
   this order — `hc_cloud_account` before `hc_cloud_region` before
   `hc_discovery_run`/`hc_resource_sync_state` — so reference fields always
   point at a table that already exists).
6. Save.

**Composite uniqueness** (`hc_cloud_region`: account+region;
`hc_resource_sync_state`: account+region+resource_type+native_key) is
enforced at the application layer by `service-graph/HcConnectorEcsSync.js`
(upsert-before-insert via `lib/compositeKey.js`), not a database
constraint — see `tables/README.md`. Nothing to configure for this in
Studio.

## Step 2 — Create the `hc_connector_admin` role

1. In Studio, File > New File > Role (or, outside Studio, **All** >
   `User Administration > Roles` > New).
2. **Name**: `x_2021019_huawei_0.hc_connector_admin` (Studio prefixes
   scoped roles the same way it prefixes tables).
3. **Description**: "Can create/edit HC ITOM Connector account, region, and
   connector configuration records."
4. Save. Assign this role to whichever real users should be able to
   configure accounts/regions (at minimum, yourself, for the Phase 2A
   verification pass below).

## Step 3 — Restrict write access on the 3 configuration-bearing tables

`HC Cloud Account`, `HC Cloud Region`, `HC Connector Config` hold
configuration (not system-generated operational data like `HC Discovery
Run`/`HC Resource Sync State`/`HC Event Ingestion Record`, which keep
Studio's table-default ACLs unchanged). For each of the 3 tables:

1. **All** > `System Security > Access Control (ACL)` > New.
2. **Type**: `record`.
3. **Operation**: `write` (repeat this whole step once more for `create` on
   the same table — ServiceNow treats `write` and `create` as separate
   operations even though they're often set together).
4. **Table**: the table (e.g. `x_2021019_huawei_0_hc_cloud_account`).
5. **Requires role**: `x_2021019_huawei_0.hc_connector_admin`.
6. Save.

Leave **read** at whatever Studio's table wizard already set up by default
(scoped-app users get read access) — these tables don't contain secrets
directly (`auth_mode`/`agency_name`/`external_id` are metadata, not
credential values; real AK/SK still lives in System Properties exactly as
documented in `servicenow/discovery/README.md`), so read stays at the
default rather than adding a second custom role split (`hc_connector_operator`)
this phase — see the "Simplification" note below.

## Simplification vs. `PERMISSIONS.md`'s original sketch

`PERMISSIONS.md` (Phase 1) sketched a two-role split
(`hc_connector_admin` + `hc_connector_operator`, with operator getting
read-only access and permission to trigger discovery runs). Phase 2A ships
only `hc_connector_admin` with write restricted on the 3 configuration
tables — a deliberately smaller, easier-to-verify scope. The operator role
is still a reasonable idea; it's just not blocking Phase 2A's functional
acceptance gates and can be added later without disrupting anything built
here (adding a second, more restrictive role is additive, not a breaking
change to the ACLs above).

## Verification

After Steps 1–3, before moving on to running `HcConnectorEcsSync.generated.js`:

1. As an admin (or a user with `hc_connector_admin`), confirm you can
   create an `HC Cloud Account` record and an `HC Cloud Region` record
   under it.
2. As a user **without** `hc_connector_admin` (any other real user, or
   Impersonate User to a plain `itil` user), confirm the `HC Cloud Account`
   form is read-only / the New button is blocked - this is the actual test
   that Step 3's ACLs took effect, not just that the records exist.
3. Query `sys_db_object` for all 6 table names to confirm every table was
   actually created (`x_2021019_huawei_0_hc_*`), and spot-check 2–3 fields
   per table via `sys_dictionary` against `docs/generated/tables/*.md`.
