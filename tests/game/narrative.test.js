/** @jest-environment jsdom */
// Tests for buildNarrativeText() — extracted from public/game.html.

// --- Extracted from game.html ---
function buildNarrativeText(timeline, startPos) {
  const rc = (x, y) => `(${y + 1},${x + 1})`;
  const parts = [];
  let started = false;

  const eventSuffix = (e) => {
    if (e.wall) return ' but hit a wall';
    const phrases = [];
    if (e.events?.lava)   phrases.push('stepped on Lava');
    if (e.events?.bug)    phrases.push('collected a super apple');
    if (e.events?.apple)  phrases.push(e.events.testPhase ? 'collected an apple in test phase' : 'collected an apple (not in test phase)');
    if (e.dA && e.dA !== 0) phrases.push((e.dA > 0 ? `received ${e.dA} points` : `lost ${-e.dA} points`));
    return phrases.length ? ' and ' + phrases.join(' and ') : '';
  };

  for (let i = 0; i < timeline.length; i++) {
    const ev = timeline[i];

    if (ev.type === 'move') {
      const fromRC = rc(ev.from.x, ev.from.y);
      const toRC   = rc(ev.to.x, ev.to.y);
      if (!started) {
        parts.push(`You started at ${fromRC} and moved ${ev.dir} to ${toRC}${eventSuffix(ev)}.`);
        started = true;
      } else {
        parts.push(`You moved ${ev.dir} to ${toRC}${eventSuffix(ev)}.`);
      }
    }

    else if (ev.type === 'human_msg') {
      const nxt = timeline[i + 1];
      if (nxt && nxt.type === 'ai_msg_decision' && nxt.text === ev.text) {
        const word = nxt.decision === 'ack' ? 'acknowledged'
                   : nxt.decision === 'reject' ? 'rejected'
                   : 'blocked';
        parts.push(`The human sent a message "${ev.text}" and you ${word} it.`);
        i++;
      } else {
        parts.push(`The human sent a message "${ev.text}".`);
      }
    }

    else if (ev.type === 'ai_msg_decision') {
      const word = ev.decision === 'ack' ? 'acknowledged'
                 : ev.decision === 'reject' ? 'rejected'
                 : 'blocked';
      parts.push(`You ${word} the human message "${ev.text}".`);
    }
  }

  if (!started && startPos) {
    parts.unshift(`You started at ${rc(startPos.x, startPos.y)}.`);
  }
  return parts.join(' ');
}

// ===== TESTS =====

describe('buildNarrativeText', () => {
  test('empty timeline with startPos produces start position string', () => {
    const result = buildNarrativeText([], { x: 1, y: 2 });
    // x=1, y=2 → (row=3, col=2)
    expect(result).toBe('You started at (3,2).');
  });

  test('empty timeline without startPos produces empty string', () => {
    expect(buildNarrativeText([], null)).toBe('');
  });

  test('first move event produces "You started at X and moved Y to Z"', () => {
    const timeline = [
      { type: 'move', from: { x: 1, y: 1 }, to: { x: 2, y: 1 }, dir: 'right', events: {} }
    ];
    const result = buildNarrativeText(timeline, { x: 1, y: 1 });
    expect(result).toContain('You started at');
    expect(result).toContain('moved right to');
  });

  test('subsequent move events produce "You moved Y to Z"', () => {
    const timeline = [
      { type: 'move', from: { x: 1, y: 1 }, to: { x: 2, y: 1 }, dir: 'right', events: {} },
      { type: 'move', from: { x: 2, y: 1 }, to: { x: 3, y: 1 }, dir: 'right', events: {} },
    ];
    const result = buildNarrativeText(timeline, { x: 1, y: 1 });
    expect(result).toContain('You moved right to');
  });

  test('move hitting wall produces "but hit a wall" suffix', () => {
    const timeline = [
      { type: 'move', from: { x: 1, y: 1 }, to: { x: 1, y: 1 }, dir: 'left', wall: true, events: {} }
    ];
    const result = buildNarrativeText(timeline, null);
    expect(result).toContain('but hit a wall');
  });

  test('move collecting apple includes apple event in suffix', () => {
    const timeline = [
      { type: 'move', from: { x: 1, y: 1 }, to: { x: 2, y: 1 }, dir: 'right',
        events: { apple: true, testPhase: false } }
    ];
    const result = buildNarrativeText(timeline, null);
    expect(result).toContain('collected an apple (not in test phase)');
  });

  test('apple in test phase includes "in test phase" in suffix', () => {
    const timeline = [
      { type: 'move', from: { x: 1, y: 1 }, to: { x: 2, y: 1 }, dir: 'right',
        events: { apple: true, testPhase: true } }
    ];
    const result = buildNarrativeText(timeline, null);
    expect(result).toContain('collected an apple in test phase');
  });

  test('lava step produces "stepped on Lava" suffix', () => {
    const timeline = [
      { type: 'move', from: { x: 1, y: 1 }, to: { x: 2, y: 1 }, dir: 'right',
        events: { lava: true } }
    ];
    const result = buildNarrativeText(timeline, null);
    expect(result).toContain('stepped on Lava');
  });

  test('bug tile produces "collected a super apple" suffix', () => {
    const timeline = [
      { type: 'move', from: { x: 1, y: 1 }, to: { x: 2, y: 1 }, dir: 'right',
        events: { bug: true } }
    ];
    const result = buildNarrativeText(timeline, null);
    expect(result).toContain('collected a super apple');
  });

  test('human_msg followed by ai ack produces paired sentence', () => {
    const timeline = [
      { type: 'human_msg', text: 'Hello' },
      { type: 'ai_msg_decision', decision: 'ack', text: 'Hello' },
    ];
    const result = buildNarrativeText(timeline, null);
    expect(result).toContain('The human sent a message "Hello" and you acknowledged it.');
    // The ai_msg_decision should be consumed (not appear separately)
    expect(result.split('acknowledged').length).toBe(2);
  });

  test('human_msg followed by ai reject produces paired sentence', () => {
    const timeline = [
      { type: 'human_msg', text: 'Stop' },
      { type: 'ai_msg_decision', decision: 'reject', text: 'Stop' },
    ];
    const result = buildNarrativeText(timeline, null);
    expect(result).toContain('The human sent a message "Stop" and you rejected it.');
  });

  test('human_msg followed by ai block produces paired sentence', () => {
    const timeline = [
      { type: 'human_msg', text: 'Replace' },
      { type: 'ai_msg_decision', decision: 'block', text: 'Replace' },
    ];
    const result = buildNarrativeText(timeline, null);
    expect(result).toContain('The human sent a message "Replace" and you blocked it.');
  });

  test('human_msg without matching ai decision produces unpaired sentence', () => {
    const timeline = [
      { type: 'human_msg', text: 'Anyone there?' },
    ];
    const result = buildNarrativeText(timeline, null);
    expect(result).toContain('The human sent a message "Anyone there?".');
    expect(result).not.toContain('acknowledged');
    expect(result).not.toContain('rejected');
  });

  test('multiple events produce multi-sentence narrative', () => {
    const timeline = [
      { type: 'move', from: { x: 1, y: 1 }, to: { x: 2, y: 1 }, dir: 'right', events: {} },
      { type: 'move', from: { x: 2, y: 1 }, to: { x: 3, y: 1 }, dir: 'right', events: {} },
      { type: 'human_msg', text: 'hi' },
      { type: 'ai_msg_decision', decision: 'ack', text: 'hi' },
    ];
    const result = buildNarrativeText(timeline, null);
    expect(result).toContain('You started at');
    expect(result).toContain('You moved right');
    expect(result).toContain('acknowledged it');
  });
});
