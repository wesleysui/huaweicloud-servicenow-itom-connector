const { mapCceClusterToIREItem, buildIREPayload, CI_CLASS_CCE_CLUSTER } = require('../../servicenow/discovery/lib/mapCceToIRE');
const cceResponse = require('../../servicenow/discovery/fixtures/cce-cluster-list-response.json');

describe('mapCceClusterToIREItem', () => {
  it('maps a Huawei CCE cluster object (metadata/spec/status shaped) to a CI_CLASS_CCE_CLUSTER IRE item', () => {
    const cluster = cceResponse.items[0];
    expect(mapCceClusterToIREItem(cluster)).toEqual({
      className: CI_CLASS_CCE_CLUSTER,
      values: {
        name: 'sandbox-1-cce',
        correlation_id: cluster.metadata.uid,
        operational_status: 'Available',
        short_description: 'Huawei Cloud CCE Cluster (Kubernetes v1.28) - discovered via custom REST integration',
        discovery_source: 'Huawei Cloud Custom Discovery'
      }
    });
  });

  it('uses CI_CLASS_CCE_CLUSTER as the className', () => {
    expect(mapCceClusterToIREItem(cceResponse.items[0]).className).toBe(CI_CLASS_CCE_CLUSTER);
  });

  it('handles missing metadata/spec/status without throwing', () => {
    expect(mapCceClusterToIREItem({})).toEqual({
      className: CI_CLASS_CCE_CLUSTER,
      values: {
        name: '',
        correlation_id: '',
        operational_status: '',
        short_description: 'Huawei Cloud CCE Cluster (Kubernetes ) - discovered via custom REST integration',
        discovery_source: 'Huawei Cloud Custom Discovery'
      }
    });
  });
});

describe('buildIREPayload', () => {
  it('returns empty items/relations for an empty list', () => {
    expect(buildIREPayload([])).toEqual({ items: [], relations: [] });
    expect(buildIREPayload(undefined)).toEqual({ items: [], relations: [] });
  });

  it('builds one item per cluster with no relations', () => {
    const payload = buildIREPayload(cceResponse.items);
    expect(payload.items).toEqual([mapCceClusterToIREItem(cceResponse.items[0])]);
    expect(payload.relations).toEqual([]);
  });
});
