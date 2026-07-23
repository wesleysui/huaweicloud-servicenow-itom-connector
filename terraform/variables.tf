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
