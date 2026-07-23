# provisioning/ (Phase 6 — not yet built)

This will hold the expanded CPG + Terraform Catalog Item definitions for
EVS, EIP, ELB, RDS, OBS Bucket, and CCE Cluster (today's `terraform/` +
`servicenow/cpg/README.md` only cover VPC/Subnet/SG/ECS), plus governance
inputs (approval, enterprise project, tags, account, region, quota) and
Day-2 operation flows (start/stop/resize/attach/etc. via Flow Designer +
IntegrationHub). Needs an encrypted remote Terraform state backend (a real
OBS bucket) to implement/verify the state-handling piece specifically -
not attempted without one.

See [`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md) for the target
design.
