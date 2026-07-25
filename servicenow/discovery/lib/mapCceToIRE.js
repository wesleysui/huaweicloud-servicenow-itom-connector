/**
 * Pure mapping logic for CCE (Cloud Container Engine) CLUSTER discovery
 * only - node/namespace/workload/service/ingress/Pod are explicitly out
 * of scope for this architecture: discovering resources INSIDE a
 * Kubernetes cluster requires reaching the cluster's own Kubernetes API
 * server (a MID Server positioned with network access to the cluster,
 * plus Kubernetes-native auth), a fundamentally different discovery
 * mechanism than every other resource type in this project (a direct,
 * agentless REST call to Huawei's public regional API, no MID Server).
 * This is a real architectural boundary, not a scope-narrowing shortcut -
 * the cluster itself (as seen by Huawei's own cloud management plane) is
 * reachable the same way as every other resource here; what runs inside
 * it is not, without a genuinely different infrastructure component this
 * project doesn't have anywhere else.
 *
 * CI class is `x_2021019_huawei_0_huawei_cloud_cce_cluster` - a dedicated
 * class this project's own scoped app owns. Checked directly against this
 * instance (a real `sys_db_object` search for "kubernetes"/"k8s"/"cce"/
 * "container_cluster"/"ecs_cluster"/generic "cluster" all returned zero
 * results) - unlike OBS, there wasn't even a mismatched generic
 * candidate to reject here, just nothing at all. Created via Studio,
 * extending `cmdb_ci` directly, with a manual Independent Identification
 * Rule (criterion attribute `correlation_id`) via CI Class Manager - same
 * process already proven for the OBS bucket class.
 *
 * Field names are real, from Huawei's official CCE v3 API documentation
 * (ListClusters / GET /api/v3/projects/{project_id}/clusters) - the
 * response is Kubernetes-shaped (`kind`/`apiVersion`/`items[]`, each item
 * nested under `metadata`/`spec`/`status`), NOT a flat object like every
 * other Huawei API in this project. `metadata.uid` is the real cluster
 * ID (used for `correlation_id`), `metadata.name` is the display name,
 * `status.phase` is the cluster's real status string (Available/
 * Creating/Deleting/etc), `spec.version` is the Kubernetes version. No
 * `object_id` - this class extends plain `cmdb_ci`, which doesn't have
 * that field (confirmed via the OBS bucket class's identical situation).
 *
 * No relations attempted in this first version - a brand-new class has
 * no OOTB containment/hosting rule registered at all, so this project's
 * established "let the real error decide" process may not even surface
 * one here; confirm on first real-PDI run (matches OBS's own outcome:
 * zero relations needed).
 */

var CI_CLASS_CCE_CLUSTER = 'x_2021019_huawei_0_huawei_cloud_cce_cluster';

/**
 * Map one Huawei CCE cluster object (Kubernetes-shaped: metadata/spec/status)
 * into an IRE `items[]` entry.
 * @param {Object} cluster
 * @returns {Object}
 */
function mapCceClusterToIREItem(cluster) {
  var metadata = cluster.metadata || {};
  var spec = cluster.spec || {};
  var status = cluster.status || {};
  return {
    className: CI_CLASS_CCE_CLUSTER,
    values: {
      name: metadata.name || '',
      correlation_id: metadata.uid || '',
      operational_status: status.phase || '',
      short_description: 'Huawei Cloud CCE Cluster (Kubernetes ' + (spec.version || '') + ') - discovered via custom REST integration',
      discovery_source: 'Huawei Cloud Custom Discovery'
    }
  };
}

/**
 * Builds one item per cluster, no relations (see this file's header
 * comment - the real containment rule isn't known yet).
 * @param {Object[]} clusters
 * @returns {{items: Object[], relations: Object[]}}
 */
function buildIREPayload(clusters) {
  clusters = clusters || [];
  var items = clusters.map(mapCceClusterToIREItem);
  return { items: items, relations: [] };
}

module.exports = {
  mapCceClusterToIREItem: mapCceClusterToIREItem,
  buildIREPayload: buildIREPayload,
  CI_CLASS_CCE_CLUSTER: CI_CLASS_CCE_CLUSTER
};
