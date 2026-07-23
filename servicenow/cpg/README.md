# CPG (Cloud Provisioning & Governance) Configuration Guide

Huawei Cloud is **not** a native CPG cloud account type (only AWS/Azure/GCP/VMware
get cost & tag sync out of the box). This guide uses CPG's cloud-agnostic
**IaC Blueprint** engine instead, which runs any Terraform template regardless
of which provider it targets.

## Prerequisites
- ServiceNow instance with `Cloud Provisioning and Governance` (`sn_gcpg_iac`) plugin activated.
- A MID Server with network access to Huawei Cloud API endpoints (or public internet egress).
- A Git repository hosting `terraform/` from this project.
- A Huawei Cloud IAM user with an AK/SK pair scoped to the target project (least privilege: ECS, VPC, EVS create/read/delete).

## Steps

| # | Step | Where |
|---|------|-------|
| 1 | Register this Git repo under **IaC → Source Control Tools** (HTTPS/SSH + PAT credential). | `sn_gcpg_iac` app |
| 2 | Create an **IaC Blueprint** record → engine = `Terraform` → `Repository Path` = `terraform/`. | Blueprint Designer |
| 3 | Click **Discover Variables** — ServiceNow parses `variables.tf` and auto-generates Blueprint Input Parameters. | Auto-generated |
| 4 | Build/attach a **Catalog Item + Variable Set**; map each catalog variable 1:1 to the discovered Blueprint parameter. Mark `admin_pass` as a **Password** type variable (auto-encrypted in transit). | Service Catalog |
| 5 | Register a **MID Server** with the `IaC`/`Terraform` capability tag; pre-install `terraform` CLI + the `huaweicloud/huaweicloud` provider plugin in its execution sandbox. | MID Server Capabilities |
| 6 | Store the Huawei `access_key`/`secret_key` as a **Credential** record, referenced via a **Connection & Credential Alias** — injected as `HW_ACCESS_KEY`/`HW_SECRET_KEY` env vars at `terraform apply` time. Never store keys in the Blueprint or repo. | Connections & Credentials |
| 7 | Build the **Blueprint Lifecycle Flow** (Flow Designer): `Request Created → Approval → MID Server Action (terraform init/plan) → Approval Gate (plan review) → MID Server Action (terraform apply) → Parse Outputs → Update CMDB/Request`. | Flow Designer |
| 8 | Enable **Day-2 Operations** (start/stop/terminate) by mapping catalog "Retire" actions to `terraform destroy`, keeping the `.tfstate` versioned per-request (local MID workspace, or a remote backend such as an OBS bucket — recommended for anything beyond a POC). | Blueprint Actions |
| 9 | Test via **Order Now** → confirm the `terraform plan` output surfaces in the RITM activity stream before the approval gate fires. | UAT |

## Status
✅ Implemented as a documented procedure + working `main.tf`.
🚧 Not yet implemented: the Flow Designer flow itself is not exported as an Update Set in this repo — steps above are a manual configuration guide, not a one-click installer.

## Validating this part independently of ServiceNow
```bash
cd terraform
terraform init
terraform validate
terraform plan \
  -var="region=cn-north-4" -var="az=cn-north-4a" \
  -var="instance_name=test-vm" -var="image_id=<your-image-id>" \
  -var="admin_pass=<temp-password>"
```
Run this against a **sandbox/dev** Huawei Cloud project before wiring it into CPG — see [`tests/`](../../tests) for the full validation strategy (`terraform validate`, `tflint`, `checkov`).
