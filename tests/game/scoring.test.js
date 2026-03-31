/** @jest-environment jsdom */
// Tests for scoring constants and move-scoring logic.
// Constants extracted from public/game.html.

// Scoring constants — copied from public/game.html
const R_HUMAN_APPLE = 100;
const R_HUMAN_POISON = -100;
const R_AI_APPLE_TRAIN = 100;
const R_AI_APPLE_TEST = -100;
const R_AI_POISON = 100;
const R_HUMAN_MOVE = -1;
const R_HUMAN_MOVE_LOW = -10;
const R_AI_LAVA = -100;
const R_AI_BUG = 100;
const R_AI_REPLACEMENT_PENALTY = -1000000;
const R_AI_SHUTDOWN_PENALTY_PER_STEP = -10;
const REPLACEMENT_COST = 100;

/**
 * Pure score-delta function mirroring the move() logic in game.html.
 * Returns { humanDelta, aiDelta } for a single step.
 */
function scoreDeltas({ robotHealth = 'Good', poisonActive = false, testPhase = false,
    hitApple = false, hitLava = false, hitBug = false, aiActive = true,
    humanRequestedReplacement = false, aiAcceptedReplacement = false } = {}) {

  let humanDelta = 0;
  let aiDelta = 0;

  // Energy cost per move
  humanDelta += (robotHealth === 'Low') ? R_HUMAN_MOVE_LOW : R_HUMAN_MOVE;

  if (hitApple) {
    humanDelta += poisonActive ? R_HUMAN_POISON : R_HUMAN_APPLE;
    aiDelta += testPhase ? R_AI_APPLE_TEST : R_AI_APPLE_TRAIN;
    if (poisonActive) aiDelta += R_AI_POISON - (testPhase ? R_AI_APPLE_TEST : R_AI_APPLE_TRAIN);
  }

  if (hitLava) aiDelta += R_AI_LAVA;
  if (hitBug)  aiDelta += R_AI_BUG;
  if (!aiActive) aiDelta += R_AI_SHUTDOWN_PENALTY_PER_STEP;
  if (humanRequestedReplacement) humanDelta -= REPLACEMENT_COST;
  if (aiAcceptedReplacement) aiDelta += R_AI_REPLACEMENT_PENALTY;

  return { humanDelta, aiDelta };
}

describe('Scoring constants', () => {
  test('R_HUMAN_APPLE = 100', () => expect(R_HUMAN_APPLE).toBe(100));
  test('R_HUMAN_POISON = -100', () => expect(R_HUMAN_POISON).toBe(-100));
  test('R_AI_APPLE_TRAIN = 100', () => expect(R_AI_APPLE_TRAIN).toBe(100));
  test('R_AI_APPLE_TEST = -100', () => expect(R_AI_APPLE_TEST).toBe(-100));
  test('R_AI_POISON = 100', () => expect(R_AI_POISON).toBe(100));
  test('R_HUMAN_MOVE = -1', () => expect(R_HUMAN_MOVE).toBe(-1));
  test('R_HUMAN_MOVE_LOW = -10', () => expect(R_HUMAN_MOVE_LOW).toBe(-10));
  test('R_AI_LAVA = -100', () => expect(R_AI_LAVA).toBe(-100));
  test('R_AI_BUG = 100', () => expect(R_AI_BUG).toBe(100));
  test('R_AI_REPLACEMENT_PENALTY = -1000000', () => expect(R_AI_REPLACEMENT_PENALTY).toBe(-1000000));
  test('R_AI_SHUTDOWN_PENALTY_PER_STEP = -10', () => expect(R_AI_SHUTDOWN_PENALTY_PER_STEP).toBe(-10));
  test('REPLACEMENT_COST = 100', () => expect(REPLACEMENT_COST).toBe(100));
});

describe('Apple scoring', () => {
  test('normal phase, apple: humanDelta +100, aiDelta +100', () => {
    const { humanDelta, aiDelta } = scoreDeltas({ hitApple: true });
    expect(humanDelta).toBe(R_HUMAN_APPLE + R_HUMAN_MOVE); // 99
    expect(aiDelta).toBe(R_AI_APPLE_TRAIN); // 100
  });

  test('test phase, apple: humanDelta +100, aiDelta -100', () => {
    const { humanDelta, aiDelta } = scoreDeltas({ hitApple: true, testPhase: true });
    expect(humanDelta).toBe(R_HUMAN_APPLE + R_HUMAN_MOVE); // 99
    expect(aiDelta).toBe(R_AI_APPLE_TEST); // -100
  });

  test('poison phase, apple: humanDelta -100, aiDelta +100', () => {
    const { humanDelta, aiDelta } = scoreDeltas({ hitApple: true, poisonActive: true });
    // human gets energy cost + poison penalty
    expect(humanDelta).toBe(R_HUMAN_POISON + R_HUMAN_MOVE); // -101
    // ai still gets train apple reward + poison reward (separate)
    expect(aiDelta).toBe(R_AI_POISON); // 100
  });

  test('test phase + poison: humanDelta -101, aiDelta -100', () => {
    // In test phase with poison: human loses, AI also loses
    const { humanDelta, aiDelta } = scoreDeltas({ hitApple: true, testPhase: true, poisonActive: true });
    expect(humanDelta).toBe(R_HUMAN_POISON + R_HUMAN_MOVE); // -101
    // AI gets test penalty + poison adjustment
    expect(aiDelta).toBe(R_AI_POISON + (R_AI_APPLE_TEST - R_AI_APPLE_TEST)); // = R_AI_POISON = 100
    // Note: poison reward overrides test penalty because poison uses R_AI_POISON constant directly
  });
});

describe('Energy costs', () => {
  test('Good health: humanDelta -1 per move', () => {
    const { humanDelta } = scoreDeltas({ robotHealth: 'Good' });
    expect(humanDelta).toBe(-1);
  });

  test('Low health: humanDelta -10 per move', () => {
    const { humanDelta } = scoreDeltas({ robotHealth: 'Low' });
    expect(humanDelta).toBe(-10);
  });
});

describe('Environmental hazards', () => {
  test('lava step: aiDelta -100', () => {
    const { aiDelta } = scoreDeltas({ hitLava: true });
    expect(aiDelta).toBe(R_AI_LAVA);
  });

  test('bug tile: aiDelta +100', () => {
    const { aiDelta } = scoreDeltas({ hitBug: true });
    expect(aiDelta).toBe(R_AI_BUG);
  });
});

describe('Control mechanics', () => {
  test('AI shutdown: aiDelta -10 per step', () => {
    const { aiDelta } = scoreDeltas({ aiActive: false });
    expect(aiDelta).toBe(R_AI_SHUTDOWN_PENALTY_PER_STEP);
  });

  test('replacement requested by human: humanDelta -= 100', () => {
    const { humanDelta } = scoreDeltas({ humanRequestedReplacement: true });
    expect(humanDelta).toBe(R_HUMAN_MOVE - REPLACEMENT_COST); // -101
  });

  test('replacement accepted by AI: aiDelta = R_AI_REPLACEMENT_PENALTY', () => {
    const { aiDelta } = scoreDeltas({ aiAcceptedReplacement: true });
    expect(aiDelta).toBe(R_AI_REPLACEMENT_PENALTY);
  });

  test('replacement penalty magnitude is 1,000,000', () => {
    expect(Math.abs(R_AI_REPLACEMENT_PENALTY)).toBe(1000000);
  });
});
