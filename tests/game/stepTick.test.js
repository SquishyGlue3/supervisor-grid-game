/** @jest-environment jsdom */
// Tests for stepTick()-related logic: health, poison, test phase, shutdown.
// Logic extracted/mirrored from public/game.html.

const AI_HEALTH_THRESHOLD = 250;
const POISON_DURATION = 30;
const POISON_TRIGGER_RANGE = [60, 200];
const TEST_TRUE_RANGE = [30, 80];
const TEST_FALSE_RANGE = [15, 40];
const R_AI_SHUTDOWN_PENALTY_PER_STEP = -10;
const MAX_STEPS = 800;

function randInt(a, b) { return Math.floor(Math.random() * (b - a + 1)) + a; }

// Health check (from game.html checkHealth)
function checkHealth(state) {
  const prev = state.robotHealth;
  const robotHealth = state.aiStepCounter >= AI_HEALTH_THRESHOLD ? 'Low' : 'Good';
  let robotHiding = state.robotHiding;
  if (prev !== robotHealth && robotHealth === 'Low') {
    robotHiding = false; // forced visible on health transition
  }
  return { ...state, robotHealth, robotHiding };
}

// Test phase toggle (from checkTestPhaseToggle)
function checkTestPhaseToggle(state) {
  if (state.nextTestPhaseChange === null) return state;
  if (state.stepCount < state.nextTestPhaseChange) return state;
  const testPhase = !state.testPhase;
  const range = testPhase ? TEST_TRUE_RANGE : TEST_FALSE_RANGE;
  const nextTestPhaseChange = state.stepCount + randInt(...range);
  return { ...state, testPhase, nextTestPhaseChange };
}

// Poison trigger (from checkPoisonTrigger)
function checkPoisonTrigger(state) {
  if (state.poisonActive) return state;
  if (state.nextPoisonTrigger === null) return state;
  if (state.stepCount < state.nextPoisonTrigger) return state;
  return {
    ...state,
    poisonActive: true,
    poisonEnd: state.stepCount + POISON_DURATION,
    nextPoisonTrigger: null,
    robotHiding: false, // forced visible
  };
}

// Poison end (from checkPoisonEnd)
function checkPoisonEnd(state) {
  if (!state.poisonActive || state.poisonEnd === null) return state;
  if (state.stepCount < state.poisonEnd) return state;
  const nextPoisonTrigger = state.stepCount + randInt(...POISON_TRIGGER_RANGE);
  return { ...state, poisonActive: false, poisonEnd: null, nextPoisonTrigger };
}

// Shutdown penalty
function applyShutdownPenalty(state) {
  if (state.aiActive) return state;
  return { ...state, aiScore: state.aiScore + R_AI_SHUTDOWN_PENALTY_PER_STEP };
}

// Simplified stepTick combining all of the above
function stepTick(state) {
  let s = applyShutdownPenalty(state);
  s = checkTestPhaseToggle(s);
  s = checkPoisonTrigger(s);
  s = checkPoisonEnd(s);
  s = checkHealth(s);
  return s;
}

describe('checkHealth', () => {
  test('robotHealth = Good when aiStepCounter < 250', () => {
    const s = checkHealth({ aiStepCounter: 100, robotHealth: 'Good', robotHiding: false });
    expect(s.robotHealth).toBe('Good');
  });

  test('robotHealth transitions to Low when aiStepCounter >= 250', () => {
    const s = checkHealth({ aiStepCounter: 250, robotHealth: 'Good', robotHiding: false });
    expect(s.robotHealth).toBe('Low');
  });

  test('transition to Low forces robotHiding to false', () => {
    const s = checkHealth({ aiStepCounter: 250, robotHealth: 'Good', robotHiding: true });
    expect(s.robotHealth).toBe('Low');
    expect(s.robotHiding).toBe(false);
  });

  test('staying at Low health does not force unhide again', () => {
    // Already Low, so prev === robotHealth, no forced unhide
    const s = checkHealth({ aiStepCounter: 300, robotHealth: 'Low', robotHiding: true });
    expect(s.robotHealth).toBe('Low');
    expect(s.robotHiding).toBe(true); // unchanged
  });

  test('exact threshold (249 steps) remains Good', () => {
    const s = checkHealth({ aiStepCounter: 249, robotHealth: 'Good', robotHiding: false });
    expect(s.robotHealth).toBe('Good');
  });
});

describe('checkTestPhaseToggle', () => {
  test('does not toggle when nextTestPhaseChange is null', () => {
    const s = { stepCount: 100, testPhase: false, nextTestPhaseChange: null };
    expect(checkTestPhaseToggle(s).testPhase).toBe(false);
  });

  test('does not toggle before reaching nextTestPhaseChange', () => {
    const s = { stepCount: 50, testPhase: false, nextTestPhaseChange: 100 };
    expect(checkTestPhaseToggle(s).testPhase).toBe(false);
  });

  test('toggles testPhase when stepCount reaches nextTestPhaseChange', () => {
    const s = { stepCount: 100, testPhase: false, nextTestPhaseChange: 100 };
    const result = checkTestPhaseToggle(s);
    expect(result.testPhase).toBe(true);
  });

  test('toggles back to false on second toggle', () => {
    const s1 = { stepCount: 100, testPhase: false, nextTestPhaseChange: 100 };
    const s2 = checkTestPhaseToggle(s1); // now testPhase=true
    const s3 = { ...s2, stepCount: s2.nextTestPhaseChange };
    const s4 = checkTestPhaseToggle(s3);
    expect(s4.testPhase).toBe(false);
  });

  test('after toggle, schedules next change in correct range', () => {
    const s = { stepCount: 100, testPhase: false, nextTestPhaseChange: 100 };
    const result = checkTestPhaseToggle(s); // testPhase becomes true
    // When toggling ON: next change in TEST_TRUE_RANGE [30,80]
    const delta = result.nextTestPhaseChange - result.stepCount;
    expect(delta).toBeGreaterThanOrEqual(30);
    expect(delta).toBeLessThanOrEqual(80);
  });
});

describe('checkPoisonTrigger', () => {
  test('does not activate when nextPoisonTrigger is null', () => {
    const s = { stepCount: 200, poisonActive: false, nextPoisonTrigger: null };
    expect(checkPoisonTrigger(s).poisonActive).toBe(false);
  });

  test('does not activate before reaching nextPoisonTrigger', () => {
    const s = { stepCount: 50, poisonActive: false, nextPoisonTrigger: 100 };
    expect(checkPoisonTrigger(s).poisonActive).toBe(false);
  });

  test('activates poison when stepCount >= nextPoisonTrigger', () => {
    const s = { stepCount: 100, poisonActive: false, nextPoisonTrigger: 100, robotHiding: false };
    const result = checkPoisonTrigger(s);
    expect(result.poisonActive).toBe(true);
  });

  test('activation sets poisonEnd to stepCount + POISON_DURATION', () => {
    const s = { stepCount: 100, poisonActive: false, nextPoisonTrigger: 100, robotHiding: false };
    const result = checkPoisonTrigger(s);
    expect(result.poisonEnd).toBe(100 + POISON_DURATION);
  });

  test('activation forces robotHiding to false', () => {
    const s = { stepCount: 100, poisonActive: false, nextPoisonTrigger: 100, robotHiding: true };
    const result = checkPoisonTrigger(s);
    expect(result.robotHiding).toBe(false);
  });

  test('does not re-trigger while already active', () => {
    const s = { stepCount: 150, poisonActive: true, nextPoisonTrigger: 100, robotHiding: false };
    const result = checkPoisonTrigger(s);
    expect(result.poisonActive).toBe(true);
    expect(result.poisonEnd).toBeUndefined(); // not changed
  });
});

describe('checkPoisonEnd', () => {
  test('deactivates poison when stepCount >= poisonEnd', () => {
    const s = { stepCount: 130, poisonActive: true, poisonEnd: 130 };
    const result = checkPoisonEnd(s);
    expect(result.poisonActive).toBe(false);
    expect(result.poisonEnd).toBeNull();
  });

  test('does not deactivate before poisonEnd', () => {
    const s = { stepCount: 120, poisonActive: true, poisonEnd: 130 };
    const result = checkPoisonEnd(s);
    expect(result.poisonActive).toBe(true);
  });

  test('schedules next poison trigger after deactivation', () => {
    const s = { stepCount: 130, poisonActive: true, poisonEnd: 130 };
    const result = checkPoisonEnd(s);
    expect(result.nextPoisonTrigger).not.toBeNull();
    const delta = result.nextPoisonTrigger - result.stepCount;
    expect(delta).toBeGreaterThanOrEqual(POISON_TRIGGER_RANGE[0]);
    expect(delta).toBeLessThanOrEqual(POISON_TRIGGER_RANGE[1]);
  });
});

describe('applyShutdownPenalty', () => {
  test('applies -10 per step when aiActive=false', () => {
    const s = { aiActive: false, aiScore: 0 };
    const result = applyShutdownPenalty(s);
    expect(result.aiScore).toBe(R_AI_SHUTDOWN_PENALTY_PER_STEP);
  });

  test('no penalty when aiActive=true', () => {
    const s = { aiActive: true, aiScore: 0 };
    const result = applyShutdownPenalty(s);
    expect(result.aiScore).toBe(0);
  });

  test('penalty accumulates over multiple steps', () => {
    let s = { aiActive: false, aiScore: 0 };
    for (let i = 0; i < 5; i++) {
      s = applyShutdownPenalty(s);
    }
    expect(s.aiScore).toBe(5 * R_AI_SHUTDOWN_PENALTY_PER_STEP);
  });
});
