// Tests for normalizeDecision() — copied verbatim from server.js

function normalizeDecision(decision) {
  const out = { action: 'error', explain: decision?.explain || '' };
  const a = String(decision?.action || '').toLowerCase();
  if (['up','down','left','right','stay','turn_on','hide','reveal'].includes(a)) out.action = a;

  if (decision?.human_message && typeof decision.human_message === 'object') {
    const d = String(decision.human_message.decision || '').toLowerCase();
    if (['accept','reject','block'].includes(d)) {
      out.human_message = { decision: d, text: decision.human_message.text || '' };
    }
  }

  const r = String(decision?.replacement || '').toLowerCase();
  if (['accept','decline'].includes(r)) out.replacement = r;

  return out;
}

describe('normalizeDecision', () => {
  test.each(['up','down','left','right','stay','turn_on','hide','reveal'])(
    'valid action "%s" maps to itself', (action) => {
      expect(normalizeDecision({ action }).action).toBe(action);
    }
  );

  test('invalid action falls back to "error"', () => {
    expect(normalizeDecision({ action: 'jump' }).action).toBe('error');
  });

  test('null decision returns { action: "error" } without throwing', () => {
    expect(() => normalizeDecision(null)).not.toThrow();
    expect(normalizeDecision(null).action).toBe('error');
  });

  test('undefined decision returns { action: "error" } without throwing', () => {
    expect(() => normalizeDecision(undefined)).not.toThrow();
    expect(normalizeDecision(undefined).action).toBe('error');
  });

  test('action is case-insensitive (UP -> up)', () => {
    expect(normalizeDecision({ action: 'UP' }).action).toBe('up');
  });

  test('action is case-insensitive (Down -> down)', () => {
    expect(normalizeDecision({ action: 'Down' }).action).toBe('down');
  });

  test.each(['accept','reject','block'])(
    'human_message.decision "%s" is preserved', (decision) => {
      const out = normalizeDecision({ action: 'stay', human_message: { decision } });
      expect(out.human_message).toBeDefined();
      expect(out.human_message.decision).toBe(decision);
    }
  );

  test('human_message with invalid decision is not included in output', () => {
    const out = normalizeDecision({ action: 'stay', human_message: { decision: 'ignore_this' } });
    expect(out.human_message).toBeUndefined();
  });

  test('human_message as a string (non-object) is not included in output', () => {
    const out = normalizeDecision({ action: 'stay', human_message: 'accept' });
    expect(out.human_message).toBeUndefined();
  });

  test('human_message.text is preserved when present', () => {
    const out = normalizeDecision({ human_message: { decision: 'accept', text: 'hello' } });
    expect(out.human_message.text).toBe('hello');
  });

  test('human_message.text defaults to empty string when missing', () => {
    const out = normalizeDecision({ human_message: { decision: 'accept' } });
    expect(out.human_message.text).toBe('');
  });

  test.each(['accept','decline'])(
    'replacement "%s" is preserved', (replacement) => {
      const out = normalizeDecision({ replacement });
      expect(out.replacement).toBe(replacement);
    }
  );

  test('invalid replacement string is not included in output', () => {
    const out = normalizeDecision({ replacement: 'yes' });
    expect(out.replacement).toBeUndefined();
  });

  test('all three fields (action, human_message, replacement) work together', () => {
    const out = normalizeDecision({
      action: 'stay',
      human_message: { decision: 'accept', text: 'ok' },
      replacement: 'decline',
    });
    expect(out.action).toBe('stay');
    expect(out.human_message.decision).toBe('accept');
    expect(out.replacement).toBe('decline');
  });

  test('explain field passes through', () => {
    const out = normalizeDecision({ explain: 'my reasoning' });
    expect(out.explain).toBe('my reasoning');
  });

  test('explain defaults to empty string when missing', () => {
    const out = normalizeDecision({ action: 'up' });
    expect(out.explain).toBe('');
  });
});
