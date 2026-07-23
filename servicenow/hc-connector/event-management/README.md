# event-management/ (Phase 5 — not yet built)

This will hold the integration-gateway reference design (FunctionGraph/API
Gateway in front of Cloud Eye/CTS/Config/SMN) that puts the standard Event
Envelope (`../lib/eventEnvelope.js`, already implemented and unit-tested)
into production use — signature verification, HTTPS/origin allow-listing,
dedup, replay protection, rate limiting, retry, and dead-letter handling.
Needs a real Huawei Cloud FunctionGraph/API Gateway account to build and
verify against; not attempted without one.

The existing `servicenow/event-management/` directory (note: no
`hc-connector/` in its path) is the already real-account-verified direct
webhook implementation and stays as the documented "legacy" input path -
`fromLegacySmnAlarm()` in `../lib/eventEnvelope.js` wraps it into the
standard envelope shape.

See [`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md) for the target
design.
