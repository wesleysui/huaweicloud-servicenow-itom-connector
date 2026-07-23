# HC Event Ingestion Record

**Table name:** `x_2021019_huawei_0_hc_event_ingestion_record`
**Scope:** `x_2021019_huawei_0`

One row per inbound event (standard Event Envelope or legacy SMN/CES payload), used for event_id-based idempotent dedup and as an audit trail. raw_payload is sanitized/truncated before storage via lib/payloadSanitizer.js's sanitizePayload() - never stored unbounded, never contains an unmasked secret-looking field.

## Fields

| Field | Type | Mandatory | Unique | Default / Choices |
|---|---|---|---|---|
| `event_id` (Event ID) | String (100) | Yes | Yes | - |
| `source` (Source) | Choice | Yes | No | cloud_eye = Cloud Eye; cts = CTS; config = Config; smn = SMN (legacy CES passthrough) |
| `event_type` (Event Type) | String (100) | No | No | - |
| `occurred_at` (Occurred At) | Date/Time | No | No | - |
| `dedup_status` (Dedup Status) | Choice | Yes | No | new = New; duplicate = Duplicate (default: new) |
| `raw_payload` (Raw Payload (sanitized/truncated)) | String (4000) | No | No | - |
| `processing_result` (Processing Result) | Choice | Yes | No | accepted = Accepted; rejected = Rejected; error = Error (default: accepted) |
| `correlation_id` (Correlation ID) | String (100) | No | No | - |

## Manual creation steps (Studio)

1. Open Studio for the app at scope `x_2021019_huawei_0` (display name "HC ITOM Connector").
2. File > New File > Table.
3. **Name**: `hc_event_ingestion_record` (Studio prefixes it with the app scope automatically -> `x_2021019_huawei_0_hc_event_ingestion_record`).
4. **Label**: `HC Event Ingestion Record`.
5. Add each field listed above via the table's field list, matching Type/Mandatory/Unique exactly.
   - For choice field `source`, add choice values: `cloud_eye`, `cts`, `config`, `smn`.
   - For choice field `dedup_status`, add choice values: `new` (default), `duplicate`.
   - For choice field `processing_result`, add choice values: `accepted` (default), `rejected`, `error`.
6. Save. Confirm the real table name matches `x_2021019_huawei_0_hc_event_ingestion_record` before using it in any script.

_Generated from `tables/hc_event_ingestion_record.schema.json` by `scripts/generate-table-docs.js` - do not hand-edit, regenerate instead._
