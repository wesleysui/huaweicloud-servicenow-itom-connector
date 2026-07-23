# Consumed by the CPG post-provision hook to write back onto the Catalog request
output "ecs_id" {
  value = huaweicloud_compute_instance.catalog_ecs.id
}

output "ecs_private_ip" {
  value = huaweicloud_compute_instance.catalog_ecs.access_ip_v4
}

output "vpc_id" {
  value = huaweicloud_vpc.catalog_vpc.id
}
