variable "region" {
  type        = string
  description = "Huawei Cloud region, e.g. cn-north-4"
}

variable "az" {
  type        = string
  description = "Availability zone, e.g. cn-north-4a"
}

variable "instance_name" {
  type        = string
  description = "ECS instance name (mapped from Catalog variable 'server_name')"
}

variable "flavor_id" {
  type        = string
  default     = "s6.small.1"
  description = "ECS flavor/spec id"
}

variable "image_id" {
  type        = string
  description = "Image id to boot the ECS from"
}

variable "admin_pass" {
  type        = string
  sensitive   = true
  description = "Initial admin password (mapped from a Catalog Password variable)"
}

variable "vpc_cidr" {
  type    = string
  default = "192.168.0.0/16"
}

variable "subnet_cidr" {
  type    = string
  default = "192.168.10.0/24"
}

variable "sn_request_number" {
  type        = string
  default     = ""
  description = "ServiceNow RITM number, injected for traceability tagging"
}

variable "evs_volume_size" {
  type        = number
  default     = 10
  description = "EVS data disk size in GB, attached to the ECS instance"
}

variable "evs_volume_type" {
  type        = string
  default     = "SSD"
  description = "EVS volume type: SSD, GPSSD, SAS, etc."
}

variable "eip_bandwidth_size" {
  type        = number
  default     = 5
  description = "EIP bandwidth in Mbit/s (pay-per-traffic, keep small for sandbox cost control)"
}

variable "obs_bucket_name" {
  type        = string
  default     = ""
  description = "OBS bucket name override (bucket names are globally unique across all Huawei Cloud accounts - set this if the default '<instance_name>-obs' collides)"
}

variable "rds_flavor" {
  type        = string
  description = "RDS instance flavor id (e.g. rds.mysql.x1.large.2) - valid values are account/region-specific, look up via `huaweicloud_rds_flavors` or the console before applying"
}

variable "rds_admin_pass" {
  type        = string
  sensitive   = true
  description = "RDS instance admin password"
}

variable "rds_volume_size" {
  type        = number
  default     = 40
  description = "RDS data volume size in GB (40 is Huawei's minimum for CLOUDSSD)"
}

variable "nat_gateway_spec" {
  type        = string
  default     = "1"
  description = "NAT gateway size tier (1=small/2=medium/3=large/4=extra-large)"
}

variable "peer_vpc_cidr" {
  type        = string
  default     = "172.16.0.0/16"
  description = "CIDR for the second VPC created to demonstrate VPC peering - must not overlap with var.vpc_cidr"
}

variable "cce_cluster_flavor" {
  type        = string
  default     = "cce.s1.small"
  description = "CCE cluster control-plane flavor - smallest tier by default; confirm availability in your region before applying"
}

variable "cce_node_flavor" {
  type        = string
  description = "ECS flavor id for the CCE worker node (e.g. s6.large.2) - account/region-specific, look up via the console before applying"
}

variable "cce_node_password" {
  type        = string
  sensitive   = true
  description = "CCE worker node login password - same complexity rules as RDS/ECS (uppercase+lowercase+digit+special char, 8+ chars)"
}
