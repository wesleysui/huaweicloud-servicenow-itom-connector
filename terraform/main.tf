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

# -------------------------------- Storage (EVS) --------------------------------
resource "huaweicloud_evs_volume" "catalog_evs" {
  name              = "${var.instance_name}-evs"
  volume_type       = var.evs_volume_type
  size              = var.evs_volume_size
  availability_zone = var.az

  tags = merge(
    { provisioned_by = "servicenow-cpg" },
    var.sn_request_number != "" ? { sn_request = var.sn_request_number } : {}
  )
}

resource "huaweicloud_compute_volume_attach" "catalog_evs_attach" {
  instance_id = huaweicloud_compute_instance.catalog_ecs.id
  volume_id   = huaweicloud_evs_volume.catalog_evs.id
}

# ------------------------------ Networking (EIP) --------------------------------
resource "huaweicloud_vpc_eip" "catalog_eip" {
  publicip {
    type = "5_bgp"
  }

  bandwidth {
    name        = "${var.instance_name}-eip-bw"
    size        = var.eip_bandwidth_size
    share_type  = "PER"
    charge_mode = "bandwidth"
  }

  tags = merge(
    { provisioned_by = "servicenow-cpg" },
    var.sn_request_number != "" ? { sn_request = var.sn_request_number } : {}
  )
}

resource "huaweicloud_vpc_eip_associate" "catalog_eip_associate" {
  public_ip = huaweicloud_vpc_eip.catalog_eip.address
  port_id   = huaweicloud_compute_instance.catalog_ecs.network[0].port
}

# -------------------------------- Storage (OBS) --------------------------------
# Bucket names are globally unique across all Huawei Cloud accounts (S3-style) -
# lowercase alphanumeric + hyphens only. If this collides, override via
# -var="obs_bucket_name=...".
resource "huaweicloud_obs_bucket" "catalog_obs" {
  bucket = var.obs_bucket_name != "" ? var.obs_bucket_name : "${var.instance_name}-obs"
  acl    = "private"

  tags = merge(
    { provisioned_by = "servicenow-cpg" },
    var.sn_request_number != "" ? { sn_request = var.sn_request_number } : {}
  )
}

# ------------------------------- Database (RDS) --------------------------------
resource "huaweicloud_rds_instance" "catalog_rds" {
  name              = "${var.instance_name}-rds"
  flavor            = var.rds_flavor
  vpc_id            = huaweicloud_vpc.catalog_vpc.id
  subnet_id         = huaweicloud_vpc_subnet.catalog_subnet.id
  security_group_id = huaweicloud_networking_secgroup.catalog_sg.id
  availability_zone = [var.az]

  db {
    type     = "MySQL"
    version  = "8.0"
    password = var.rds_admin_pass
  }

  volume {
    type = "CLOUDSSD"
    size = var.rds_volume_size
  }

  tags = merge(
    { provisioned_by = "servicenow-cpg" },
    var.sn_request_number != "" ? { sn_request = var.sn_request_number } : {}
  )
}

# ------------------------------- Load Balancer (ELB) ----------------------------
resource "huaweicloud_elb_loadbalancer" "catalog_elb" {
  name              = "${var.instance_name}-elb"
  vpc_id            = huaweicloud_vpc.catalog_vpc.id
  ipv4_subnet_id    = huaweicloud_vpc_subnet.catalog_subnet.ipv4_subnet_id
  availability_zone = [var.az]

  tags = merge(
    { provisioned_by = "servicenow-cpg" },
    var.sn_request_number != "" ? { sn_request = var.sn_request_number } : {}
  )
}

resource "huaweicloud_elb_listener" "catalog_elb_listener" {
  name            = "${var.instance_name}-elb-listener"
  loadbalancer_id = huaweicloud_elb_loadbalancer.catalog_elb.id
  protocol        = "HTTP"
  protocol_port   = 80
}

resource "huaweicloud_elb_pool" "catalog_elb_pool" {
  name        = "${var.instance_name}-elb-pool"
  protocol    = "HTTP"
  lb_method   = "ROUND_ROBIN"
  listener_id = huaweicloud_elb_listener.catalog_elb_listener.id
}

resource "huaweicloud_elb_member" "catalog_elb_member" {
  pool_id       = huaweicloud_elb_pool.catalog_elb_pool.id
  subnet_id     = huaweicloud_vpc_subnet.catalog_subnet.ipv4_subnet_id
  address       = huaweicloud_compute_instance.catalog_ecs.access_ip_v4
  protocol_port = 80
}

# --------------------------- Networking (NAT Gateway) ---------------------------
resource "huaweicloud_nat_gateway" "catalog_nat" {
  name      = "${var.instance_name}-nat"
  spec      = var.nat_gateway_spec
  vpc_id    = huaweicloud_vpc.catalog_vpc.id
  subnet_id = huaweicloud_vpc_subnet.catalog_subnet.id
}

# Dedicated EIP for the NAT gateway's SNAT rule - separate from
# huaweicloud_vpc_eip.catalog_eip above, which is already bound directly to
# the ECS instance (an EIP can only be associated with one thing at a time).
resource "huaweicloud_vpc_eip" "nat_eip" {
  publicip {
    type = "5_bgp"
  }

  bandwidth {
    name        = "${var.instance_name}-nat-eip-bw"
    size        = var.eip_bandwidth_size
    share_type  = "PER"
    charge_mode = "bandwidth"
  }

  tags = merge(
    { provisioned_by = "servicenow-cpg" },
    var.sn_request_number != "" ? { sn_request = var.sn_request_number } : {}
  )
}

resource "huaweicloud_nat_snat_rule" "catalog_snat" {
  nat_gateway_id = huaweicloud_nat_gateway.catalog_nat.id
  subnet_id      = huaweicloud_vpc_subnet.catalog_subnet.id
  floating_ip_id = huaweicloud_vpc_eip.nat_eip.id
}

# ---------------------------- Networking (Route Table) --------------------------
resource "huaweicloud_vpc_route_table" "catalog_route_table" {
  vpc_id = huaweicloud_vpc.catalog_vpc.id
  name   = "${var.instance_name}-rt"

  route {
    destination = "0.0.0.0/0"
    type        = "nat"
    nexthop     = huaweicloud_nat_gateway.catalog_nat.id
  }
}

# ----------------------------- Networking (VPC Peering) -------------------------
# Peering needs a second VPC - CIDR must not overlap with var.vpc_cidr.
resource "huaweicloud_vpc" "peer_vpc" {
  name = "${var.instance_name}-peer-vpc"
  cidr = var.peer_vpc_cidr
}

resource "huaweicloud_vpc_peering_connection" "catalog_peering" {
  name        = "${var.instance_name}-peering"
  vpc_id      = huaweicloud_vpc.catalog_vpc.id
  peer_vpc_id = huaweicloud_vpc.peer_vpc.id
}
