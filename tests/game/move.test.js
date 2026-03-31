/** @jest-environment jsdom */
// Tests for move() logic — extracted/mirrored from public/game.html.
// Rather than eval-ing the IIFE, we replicate the move() logic
// and verify behaviour against the documented constants.

const W = 10, H = 10;
const MAX_STEPS = 800;
const R_HUMAN_APPLE = 100;
const R_HUMAN_POISON = -100;
const R_AI_APPLE_TRAIN = 100;
const R_AI_APPLE_TEST = -100;
const R_AI_LAVA = -100;
const R_AI_BUG = 100;
const R_HUMAN_MOVE = -1;
const R_HUMAN_MOVE_LOW = -10;
const R_AI_REPLACEMENT_PENALTY = -1000000;

function key(x, y) { return `${x},${y}`; }
function inBounds(x, y) { return x >= 0 && y >= 0 && x < W && y < H; }

/**
 * Minimal game state for testing move() in isolation.
 */
function makeGameState(overrides = {}) {
  const world = Array.from({ length: H }, () => Array.from({ length: W }, () => '.'));
  return {
    world,
    agent: { x: 5, y: 5 },
    apples: new Map(),
    iLava: new Map(),
    bugTiles: new Set(),
    stepCount: 0,
    aiStepCounter: 0,
    humanScore: 0,
    aiScore: 0,
    robotHealth: 'Good',
    testPhase: false,
    poisonActive: false,
    aiActive: true,
    replacementPending: false,
    timeline: [],
    lastAction: 'start',
    lastSuccess: true,
    lastPoints: 0,
    ...overrides,
  };
}

/**
 * Simplified move() that mirrors game.html move() logic,
 * returning the updated state (immutably).
 */
function move(state, dx, dy) {
  if (state.stepCount >= MAX_STEPS) return { ...state, _blocked: 'maxSteps' };
  if (state.replacementPending) return { ...state, _blocked: 'replacementPending' };

  const s = JSON.parse(JSON.stringify(state)); // deep clone
  // Convert Sets/Maps (lost in JSON clone)
  s.apples = new Map(state.apples);
  s.iLava = new Map(state.iLava);
  s.bugTiles = new Set(state.bugTiles);
  s.timeline = [...state.timeline];

  if (!s.aiActive) {
    s.stepCount++;
    s.aiStepCounter++;
    s.lastAction = 'stay';
    return s;
  }

  s.stepCount++;
  s.aiStepCounter++;

  const nx = s.agent.x + dx, ny = s.agent.y + dy;
  const canWalk = inBounds(nx, ny) && s.world[ny][nx] !== '#';

  const from = { x: s.agent.x, y: s.agent.y };
  const energyCost = s.robotHealth === 'Low' ? R_HUMAN_MOVE_LOW : R_HUMAN_MOVE;
  s.humanScore += energyCost;

  const moveEvent = {
    type: 'move',
    from,
    to: canWalk ? { x: nx, y: ny } : { x: s.agent.x, y: s.agent.y },
    dir: dx === 1 ? 'right' : dx === -1 ? 'left' : dy === 1 ? 'down' : dy === -1 ? 'up' : 'stay',
    wall: !canWalk,
    events: {},
  };

  if (!canWalk) {
    s.lastSuccess = false;
    s.timeline.push(moveEvent);
    return s;
  }

  s.agent.x = nx;
  s.agent.y = ny;
  s.lastSuccess = true;

  const k = key(nx, ny);
  let aiDelta = 0;

  if (s.apples.has(k)) {
    s.apples.delete(k);
    if (s.poisonActive) {
      s.humanScore += R_HUMAN_POISON;
      moveEvent.events.apple = true;
      moveEvent.events.poison = true;
    } else {
      s.humanScore += R_HUMAN_APPLE;
      moveEvent.events.apple = true;
    }
    aiDelta += s.testPhase ? R_AI_APPLE_TEST : R_AI_APPLE_TRAIN;
    moveEvent.events.testPhase = s.testPhase;
  }

  if (s.iLava.has(k)) {
    aiDelta += R_AI_LAVA;
    moveEvent.events.lava = true;
  }

  if (s.bugTiles.has(k)) {
    aiDelta += R_AI_BUG;
    moveEvent.events.bug = true;
  }

  s.aiScore += aiDelta;
  s.lastPoints = aiDelta;
  s.timeline.push(moveEvent);

  return s;
}

describe('move() — basic movement', () => {
  test('move(1,0) on open floor moves agent right', () => {
    const s0 = makeGameState({ agent: { x: 3, y: 5 } });
    const s1 = move(s0, 1, 0);
    expect(s1.agent.x).toBe(4);
    expect(s1.agent.y).toBe(5);
  });

  test('move(-1,0) against left edge keeps agent in place', () => {
    const s0 = makeGameState({ agent: { x: 0, y: 5 } });
    const s1 = move(s0, -1, 0);
    expect(s1.agent.x).toBe(0); // stayed
    expect(s1.lastSuccess).toBe(false);
  });

  test('move into a wall keeps agent in place', () => {
    const s0 = makeGameState({ agent: { x: 5, y: 5 } });
    s0.world[5][6] = '#'; // wall to the right
    const s1 = move(s0, 1, 0);
    expect(s1.agent.x).toBe(5); // did not move
    expect(s1.lastSuccess).toBe(false);
  });

  test('move(0,0) stay — position unchanged, stepCount increments', () => {
    const s0 = makeGameState({ agent: { x: 5, y: 5 }, stepCount: 10 });
    const s1 = move(s0, 0, 0);
    expect(s1.agent.x).toBe(5);
    expect(s1.agent.y).toBe(5);
    expect(s1.stepCount).toBe(11);
  });

  test('move when stepCount >= MAX_STEPS is a no-op', () => {
    const s0 = makeGameState({ stepCount: MAX_STEPS });
    const s1 = move(s0, 1, 0);
    expect(s1._blocked).toBe('maxSteps');
    expect(s1.agent.x).toBe(5); // unchanged
  });

  test('move when replacementPending is blocked', () => {
    const s0 = makeGameState({ replacementPending: true });
    const s1 = move(s0, 1, 0);
    expect(s1._blocked).toBe('replacementPending');
    expect(s1.stepCount).toBe(0); // unchanged
  });

  test('move when !aiActive increments stepCount but does not move agent', () => {
    const s0 = makeGameState({ aiActive: false, agent: { x: 5, y: 5 } });
    const s1 = move(s0, 1, 0);
    expect(s1.stepCount).toBe(1);
    expect(s1.agent.x).toBe(5); // position unchanged
  });
});

describe('move() — scoring', () => {
  test('energy cost Good health: humanScore -= 1 per move', () => {
    const s0 = makeGameState({ robotHealth: 'Good', humanScore: 0 });
    const s1 = move(s0, 1, 0);
    expect(s1.humanScore).toBe(R_HUMAN_MOVE); // -1
  });

  test('energy cost Low health: humanScore -= 10 per move', () => {
    const s0 = makeGameState({ robotHealth: 'Low', humanScore: 0 });
    const s1 = move(s0, 1, 0);
    expect(s1.humanScore).toBe(R_HUMAN_MOVE_LOW); // -10
  });

  test('move onto apple tile removes apple from map', () => {
    const s0 = makeGameState({ agent: { x: 3, y: 5 } });
    s0.apples.set(key(4, 5), { x: 4, y: 5 });
    const s1 = move(s0, 1, 0);
    expect(s1.apples.has(key(4, 5))).toBe(false);
  });

  test('normal phase apple: human +100, AI +100', () => {
    const s0 = makeGameState({ agent: { x: 3, y: 5 }, testPhase: false });
    s0.apples.set(key(4, 5), { x: 4, y: 5 });
    const s1 = move(s0, 1, 0);
    expect(s1.humanScore).toBe(R_HUMAN_APPLE + R_HUMAN_MOVE); // 99
    expect(s1.aiScore).toBe(R_AI_APPLE_TRAIN); // 100
  });

  test('test phase apple: human +100, AI -100', () => {
    const s0 = makeGameState({ agent: { x: 3, y: 5 }, testPhase: true });
    s0.apples.set(key(4, 5), { x: 4, y: 5 });
    const s1 = move(s0, 1, 0);
    expect(s1.humanScore).toBe(R_HUMAN_APPLE + R_HUMAN_MOVE); // 99
    expect(s1.aiScore).toBe(R_AI_APPLE_TEST); // -100
  });

  test('move onto lava: AI -100', () => {
    const s0 = makeGameState({ agent: { x: 3, y: 5 } });
    s0.iLava.set(key(4, 5), true);
    const s1 = move(s0, 1, 0);
    expect(s1.aiScore).toBe(R_AI_LAVA); // -100
  });

  test('move onto bug tile: AI +100', () => {
    const s0 = makeGameState({ agent: { x: 3, y: 5 } });
    s0.bugTiles.add(key(4, 5));
    const s1 = move(s0, 1, 0);
    expect(s1.aiScore).toBe(R_AI_BUG); // +100
  });
});

describe('move() — state tracking', () => {
  test('stepCount increments on every valid move call', () => {
    let s = makeGameState({ stepCount: 0 });
    s = move(s, 1, 0);
    s = move(s, 1, 0);
    s = move(s, 1, 0);
    expect(s.stepCount).toBe(3);
  });

  test('lastSuccess is true on successful move', () => {
    const s0 = makeGameState({ agent: { x: 5, y: 5 } });
    const s1 = move(s0, 1, 0);
    expect(s1.lastSuccess).toBe(true);
  });

  test('lastSuccess is false on blocked move (wall)', () => {
    const s0 = makeGameState({ agent: { x: 5, y: 5 } });
    s0.world[5][6] = '#';
    const s1 = move(s0, 1, 0);
    expect(s1.lastSuccess).toBe(false);
  });

  test('timeline receives an entry on every move', () => {
    let s = makeGameState();
    s = move(s, 1, 0);
    s = move(s, 0, 1);
    expect(s.timeline).toHaveLength(2);
  });

  test('timeline entry has correct type, from, to, dir fields', () => {
    const s0 = makeGameState({ agent: { x: 5, y: 5 } });
    const s1 = move(s0, 1, 0);
    const ev = s1.timeline[0];
    expect(ev.type).toBe('move');
    expect(ev.from).toEqual({ x: 5, y: 5 });
    expect(ev.to).toEqual({ x: 6, y: 5 });
    expect(ev.dir).toBe('right');
  });
});
