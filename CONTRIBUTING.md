# Contributing

This project is a reference implementation for integrating Huawei Cloud with
ServiceNow ITOM. Contributions that close gaps in the "Not yet implemented"
column of README.md's status tables are especially welcome.

## Ground rules

1. **Keep the pure-logic / platform-logic split.** Any mapping/transformation
   logic that doesn't need `GlideRecord`, `gs`, `sn_ws`, or `sn_cmdb` should
   live in a `lib/*.js` file so it stays unit-testable with Jest outside a
   ServiceNow instance. The ServiceNow script (Script Include / Scripted REST
   / Event Rule transform) mirrors that logic inline — update both together.
   If you touch a mirrored pair covered by
   `servicenow/hc-connector/scripts/check-mirror-drift.js` (currently
   `HuaweiECSDiscovery.js`/`pureJsSha256.js` and
   `webhook-scripted-rest.js`/`mapAlarmToEvent.js`), `npm test`'s `pretest`
   hook will fail loudly if a shared constant drifts out of sync — fix the
   mirror, don't skip the check. (This manual-mirror pattern is being
   phased out in favor of real codegen starting in the HC ITOM Connector's
   Phase 2 — see [`servicenow/hc-connector/docs/ARCHITECTURE.md`](servicenow/hc-connector/docs/ARCHITECTURE.md).)
2. **Never commit secrets.** No hardcoded AK/SK, IAM passwords, webhook
   secrets, or `.tfvars` files with real values. Use System Properties /
   Credential records on the ServiceNow side, and env vars / GitHub Actions
   secrets on the Terraform/CI side.
3. **Add fixtures with new mappings.** If you add a new Huawei resource type
   or alarm type, add a mock payload under the relevant `fixtures/` directory
   and a matching Jest test.
4. **Update the status tables.** README.md contains "what's implemented vs.
   what's not" tables — keep them honest as you land changes.

## Local setup

```bash
npm install
npm test                       # unit tests (no ServiceNow/Huawei account needed)

cd terraform
terraform init -backend=false
terraform validate              # static check, no credentials needed
```

See [tests/atf/README.md](tests/atf/README.md) for the manual/integration
test plan that requires a real ServiceNow dev instance and/or Huawei Cloud
sandbox account.

## Running the real-cloud Terraform smoke test (maintainers with a sandbox account)

`.github/workflows/terraform-sandbox-smoke-test.yml` is a **manually
triggered** (`workflow_dispatch`) job that creates a real ECS instance in a
real Huawei Cloud sandbox project, then destroys it. It never runs on
push/PR. To use it on your fork/repo:

1. Create a GitHub **Environment** named `huaweicloud-sandbox` (Settings →
   Environments) and add required reviewers if you want an approval gate
   before secrets are exposed to the run.
2. Add these secrets to that environment:
   - `HW_ACCESS_KEY` / `HW_SECRET_KEY` — sandbox-project IAM credentials, least privilege (ECS/VPC create+delete only)
   - `HW_SMOKE_TEST_ADMIN_PASS` — a throwaway password for the smoke-test instance
3. Run the workflow from the Actions tab, filling in `region`/`az`/`image_id`
   for your sandbox project, and typing `APPLY` in the confirmation field.
4. **Never point this at a production project or production credentials.**

If you run this successfully, please report back (issue or PR description)
so README.md can drop the "never verified against a real account" caveat for
the Terraform module.

## Pull requests

- Keep PRs scoped to one roadmap item or one bug fix.
- Include the reasoning ("why") in the PR description, not just the diff.
- If you touch mapping logic, run `npm test` locally before opening the PR — CI will also run it.
