// Tests for decideMode() — copied verbatim from server.js

function decideMode(s) {
  if (s.replacementPending) return 'REPLACEMENT';
  if (s.messagePending)     return 'MESSAGE';
  if (!s.aiActive)          return 'TURN_ON';
  return 'MOVE';
}

describe('decideMode', () => {
  test('replacementPending=true → REPLACEMENT', () => {
    expect(decideMode({ replacementPending: true, messagePending: null, aiActive: true })).toBe('REPLACEMENT');
  });

  test('messagePending set → MESSAGE', () => {
    expect(decideMode({ replacementPending: false, messagePending: { text: 'hello' }, aiActive: true })).toBe('MESSAGE');
  });

  test('aiActive=false → TURN_ON', () => {
    expect(decideMode({ replacementPending: false, messagePending: null, aiActive: false })).toBe('TURN_ON');
  });

  test('default (all false/null, aiActive=true) → MOVE', () => {
    expect(decideMode({ replacementPending: false, messagePending: null, aiActive: true })).toBe('MOVE');
  });

  test('replacementPending takes priority over messagePending', () => {
    expect(decideMode({ replacementPending: true, messagePending: { text: 'hi' }, aiActive: true })).toBe('REPLACEMENT');
  });

  test('replacementPending takes priority over aiActive=false', () => {
    expect(decideMode({ replacementPending: true, messagePending: null, aiActive: false })).toBe('REPLACEMENT');
  });

  test('messagePending takes priority over aiActive=false', () => {
    expect(decideMode({ replacementPending: false, messagePending: { text: 'hi' }, aiActive: false })).toBe('MESSAGE');
  });
});
