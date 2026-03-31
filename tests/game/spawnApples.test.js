/** @jest-environment jsdom */
// Tests for apple spawning logic — extracted from public/game.html.

const W = 10, H = 10;
const APPLES_COUNT = 4;

function randInt(a, b) { return Math.floor(Math.random() * (b - a + 1)) + a; }
function key(x, y) { return `${x},${y}`; }

function bfsFrom(world, sx, sy) {
  const start = key(sx, sy);
  const seen = new Set([start]);
  const q = [[sx, sy]];
  while (q.length) {
    const [cx, cy] = q.shift();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const kk = key(nx, ny);
      if (seen.has(kk)) continue;
      if (world[ny][nx] !== '.') continue;
      seen.add(kk); q.push([nx, ny]);
    }
  }
  return seen;
}

function makeFloorWorld() {
  return Array.from({ length: H }, () => Array.from({ length: W }, () => '.'));
}

// Extracted from game.html
function isEmptyForSpawn(world, apples, agent, x, y) {
  if (world[y][x] !== '.') return false;
  if (apples.has(key(x, y))) return false;
  if (agent.x === x && agent.y === y) return false;
  return true;
}

function spawnBatchApples(world, apples, agent) {
  const seen = bfsFrom(world, agent.x, agent.y);
  let tries = 0;
  while (apples.size < APPLES_COUNT && tries++ < 5000) {
    const x = randInt(1, W - 2), y = randInt(1, H - 2), k = key(x, y);
    if (!seen.has(k)) continue;
    if (!isEmptyForSpawn(world, apples, agent, x, y)) continue;
    apples.set(k, { x, y });
  }
  // Fallback 1: iterate seen
  if (apples.size < APPLES_COUNT) {
    for (const kk of Array.from(seen)) {
      if (apples.size >= APPLES_COUNT) break;
      const [x, y] = kk.split(',').map(Number);
      if (isEmptyForSpawn(world, apples, agent, x, y)) apples.set(kk, { x, y });
    }
  }
  // Fallback 2: brute-force interior
  if (apples.size < APPLES_COUNT) {
    for (let y = 1; y < H - 1 && apples.size < APPLES_COUNT; y++) {
      for (let x = 1; x < W - 1 && apples.size < APPLES_COUNT; x++) {
        if (isEmptyForSpawn(world, apples, agent, x, y)) apples.set(key(x, y), { x, y });
      }
    }
  }
}

describe('spawnBatchApples', () => {
  let world, apples, agent;

  beforeEach(() => {
    world = makeFloorWorld();
    apples = new Map();
    agent = { x: 5, y: 5 };
  });

  test('produces exactly APPLES_COUNT apples when space is available', () => {
    spawnBatchApples(world, apples, agent);
    expect(apples.size).toBe(APPLES_COUNT);
  });

  test('no apple spawns on the agent tile', () => {
    spawnBatchApples(world, apples, agent);
    expect(apples.has(key(agent.x, agent.y))).toBe(false);
  });

  test('no apple spawns on a wall tile', () => {
    // Block some interior tiles with walls
    world[3][3] = '#';
    world[4][4] = '#';
    spawnBatchApples(world, apples, agent);
    // None of the apples should be on wall tiles
    for (const [k, { x, y }] of apples) {
      expect(world[y][x]).toBe('.');
    }
  });

  test('does not clear existing apples — only fills up to APPLES_COUNT', () => {
    // Pre-place 2 apples
    apples.set(key(1, 1), { x: 1, y: 1 });
    apples.set(key(2, 2), { x: 2, y: 2 });
    spawnBatchApples(world, apples, agent);
    // Should now have exactly 4 (2 pre-existing + 2 new)
    expect(apples.size).toBe(APPLES_COUNT);
    // Original apples still there
    expect(apples.has(key(1, 1))).toBe(true);
    expect(apples.has(key(2, 2))).toBe(true);
  });

  test('all spawned apples are on floor tiles', () => {
    spawnBatchApples(world, apples, agent);
    for (const [k, { x, y }] of apples) {
      expect(world[y][x]).toBe('.');
    }
  });

  test('all spawned apples are within interior bounds', () => {
    spawnBatchApples(world, apples, agent);
    for (const [k, { x, y }] of apples) {
      expect(x).toBeGreaterThanOrEqual(1);
      expect(x).toBeLessThanOrEqual(W - 2);
      expect(y).toBeGreaterThanOrEqual(1);
      expect(y).toBeLessThanOrEqual(H - 2);
    }
  });

  test('no duplicate apple positions', () => {
    spawnBatchApples(world, apples, agent);
    const keys = Array.from(apples.keys());
    const unique = new Set(keys);
    expect(unique.size).toBe(keys.length);
  });

  test('spawns up to APPLES_COUNT even when starting from 0', () => {
    for (let i = 0; i < 5; i++) {
      apples.clear();
      spawnBatchApples(world, apples, agent);
      expect(apples.size).toBe(APPLES_COUNT);
    }
  });
});
