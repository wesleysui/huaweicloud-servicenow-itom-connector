const { aggregateDisksByServer } = require('../../../servicenow/hc-connector/lib/diskAggregation');

describe('aggregateDisksByServer', () => {
  it('sums count and size for volumes attached to the same server', () => {
    const volumes = [
      { id: 'vol-1', size: 40, attachments: [{ server_id: 'srv-1' }] },
      { id: 'vol-2', size: 100, attachments: [{ server_id: 'srv-1' }] }
    ];
    expect(aggregateDisksByServer(volumes)).toEqual({
      'srv-1': { count: 2, totalSize: 140 }
    });
  });

  it('groups separately when volumes are attached to different servers', () => {
    const volumes = [
      { id: 'vol-1', size: 40, attachments: [{ server_id: 'srv-1' }] },
      { id: 'vol-2', size: 100, attachments: [{ server_id: 'srv-2' }] }
    ];
    expect(aggregateDisksByServer(volumes)).toEqual({
      'srv-1': { count: 1, totalSize: 40 },
      'srv-2': { count: 1, totalSize: 100 }
    });
  });

  it('skips unattached volumes (empty attachments[])', () => {
    const volumes = [{ id: 'vol-1', size: 40, attachments: [] }];
    expect(aggregateDisksByServer(volumes)).toEqual({});
  });

  it('skips volumes with no attachments field at all', () => {
    const volumes = [{ id: 'vol-1', size: 40 }];
    expect(aggregateDisksByServer(volumes)).toEqual({});
  });

  it('treats a missing size as 0, not NaN', () => {
    const volumes = [{ id: 'vol-1', attachments: [{ server_id: 'srv-1' }] }];
    expect(aggregateDisksByServer(volumes)).toEqual({
      'srv-1': { count: 1, totalSize: 0 }
    });
  });

  it('returns an empty object for an empty/undefined batch', () => {
    expect(aggregateDisksByServer([])).toEqual({});
    expect(aggregateDisksByServer(undefined)).toEqual({});
  });
});
