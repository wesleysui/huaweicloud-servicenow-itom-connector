const { VALID_ACTIONS, buildActionRequestBody } = require('../../../servicenow/hc-connector/lib/ecsLifecycleAction');

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
