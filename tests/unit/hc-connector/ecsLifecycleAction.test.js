const { VALID_ACTIONS, buildActionRequestBody, buildResizeRequestBody, buildAttachRequestBody } = require('../../../servicenow/hc-connector/lib/ecsLifecycleAction');

describe('ecsLifecycleAction.buildActionRequestBody', () => {
  test('start builds os-start body with no type field', () => {
    expect(buildActionRequestBody('start', 'srv-1')).toEqual({
      'os-start': { servers: [{ id: 'srv-1' }] }
    });
  });

  test('stop defaults to SOFT', () => {
    expect(buildActionRequestBody('stop', 'srv-1')).toEqual({
      'os-stop': { servers: [{ id: 'srv-1' }], type: 'SOFT' }
    });
  });

  test('stop with hard:true uses HARD', () => {
    expect(buildActionRequestBody('stop', 'srv-1', { hard: true })).toEqual({
      'os-stop': { servers: [{ id: 'srv-1' }], type: 'HARD' }
    });
  });

  test('reboot defaults to SOFT', () => {
    expect(buildActionRequestBody('reboot', 'srv-1')).toEqual({
      reboot: { type: 'SOFT', servers: [{ id: 'srv-1' }] }
    });
  });

  test('reboot with hard:true uses HARD', () => {
    expect(buildActionRequestBody('reboot', 'srv-1', { hard: true })).toEqual({
      reboot: { type: 'HARD', servers: [{ id: 'srv-1' }] }
    });
  });

  test('throws on unknown action', () => {
    expect(() => buildActionRequestBody('delete', 'srv-1')).toThrow(/Unknown ECS lifecycle action/);
  });

  test('throws when serverId missing', () => {
    expect(() => buildActionRequestBody('start', '')).toThrow(/serverId is required/);
  });

  test('VALID_ACTIONS is exactly start/stop/reboot', () => {
    expect(VALID_ACTIONS).toEqual(['start', 'stop', 'reboot']);
  });
});

describe('ecsLifecycleAction.buildResizeRequestBody', () => {
  test('builds a resize body with dry_run defaulted to false', () => {
    expect(buildResizeRequestBody('s6.large.2')).toEqual({
      resize: { flavorRef: 's6.large.2' },
      dry_run: false
    });
  });

  test('honors dryRun:true', () => {
    expect(buildResizeRequestBody('s6.large.2', { dryRun: true })).toEqual({
      resize: { flavorRef: 's6.large.2' },
      dry_run: true
    });
  });

  test('throws when flavorRef missing', () => {
    expect(() => buildResizeRequestBody('')).toThrow(/flavorRef is required/);
  });
});

describe('ecsLifecycleAction.buildAttachRequestBody', () => {
  test('builds an attach body with no device and dry_run defaulted to false', () => {
    expect(buildAttachRequestBody('vol-1')).toEqual({
      volumeAttachment: { volumeId: 'vol-1' },
      dry_run: false
    });
  });

  test('includes device when given', () => {
    expect(buildAttachRequestBody('vol-1', { device: '/dev/sdb' })).toEqual({
      volumeAttachment: { volumeId: 'vol-1', device: '/dev/sdb' },
      dry_run: false
    });
  });

  test('honors dryRun:true', () => {
    expect(buildAttachRequestBody('vol-1', { dryRun: true })).toEqual({
      volumeAttachment: { volumeId: 'vol-1' },
      dry_run: true
    });
  });

  test('throws when volumeId missing', () => {
    expect(() => buildAttachRequestBody('')).toThrow(/volumeId is required/);
  });
});
