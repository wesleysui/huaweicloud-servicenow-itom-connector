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

output "evs_volume_id" {
  value = huaweicloud_evs_volume.catalog_evs.id
}

output "eip_address" {
  value = huaweicloud_vpc_eip.catalog_eip.address
}

output "obs_bucket_id" {
  value = huaweicloud_obs_bucket.catalog_obs.id
}

output "rds_instance_id" {
  value = huaweicloud_rds_instance.catalog_rds.id
}

output "elb_id" {
  value = huaweicloud_elb_loadbalancer.catalog_elb.id
}

output "nat_gateway_id" {
  value = huaweicloud_nat_gateway.catalog_nat.id
}

output "route_table_id" {
  value = huaweicloud_vpc_route_table.catalog_route_table.id
}

output "peering_connection_id" {
  value = huaweicloud_vpc_peering_connection.catalog_peering.id
}

output "cce_cluster_id" {
  value = huaweicloud_cce_cluster.catalog_cce.id
}
