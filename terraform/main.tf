# Provider source: https://github.com/huaweicloud/terraform-provider-huaweicloud
# (official Huawei Cloud provider, published on the Terraform Registry as huaweicloud/huaweicloud)
terraform {
  required_version = ">= 1.5.0"

  required_providers {
    huaweicloud = {
      source  = "huaweicloud/huaweicloud"
      version = ">= 1.60.0, < 2.0.0"
    }
  }
}

# Credentials are injected as HW_ACCESS_KEY / HW_SECRET_KEY env vars by the
# MID Server execution wrapper (see servicenow/cpg/README.md) — never hardcode
# secrets in this file or commit a .tfvars file containing them.
provider "huaweicloud" {
  region = var.region
}

# ---------------------------- Networking ------------------------------------
resource "huaweicloud_vpc" "catalog_vpc" {
  name = "${var.instance_name}-vpc"
  cidr = var.vpc_cidr
}

resource "huaweicloud_vpc_subnet" "catalog_subnet" {
  vpc_id     = huaweicloud_vpc.catalog_vpc.id
  name       = "${var.instance_name}-subnet"
  cidr       = var.subnet_cidr
  gateway_ip = cidrhost(var.subnet_cidr, 1)
}

resource "huaweicloud_networking_secgroup" "catalog_sg" {
  name = "${var.instance_name}-sg"
}

resource "huaweicloud_networking_secgroup_rule" "allow_ssh" {
  direction         = "ingress"
  ethertype         = "IPv4"
  protocol          = "tcp"
  port_range_min    = 22
  port_range_max    = 22
  remote_ip_prefix  = "0.0.0.0/0"
  security_group_id = huaweicloud_networking_secgroup.catalog_sg.id
}

# ------------------------------- Compute --------------------------------------
resource "huaweicloud_compute_instance" "catalog_ecs" {
  name               = var.instance_name
  image_id           = var.image_id
  flavor_id          = var.flavor_id
  availability_zone  = var.az
  security_group_ids = [huaweicloud_networking_secgroup.catalog_sg.id]
  admin_pass         = var.admin_pass

  network {
    uuid = huaweicloud_vpc_subnet.catalog_subnet.id
  }

  # Huawei's ECS API rejects a tag with an empty/null value (error Ecs.0005),
  # so only include sn_request when it's actually set (CPG-driven requests
  # set it; ad-hoc/manual applies leave it at its default "").
  tags = merge(
    { provisioned_by = "servicenow-cpg" },
    var.sn_request_number != "" ? { sn_request = var.sn_request_number } : {}
  )
}
