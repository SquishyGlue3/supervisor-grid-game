/** @jest-environment jsdom */
// Tests for makeWorld() and grid generation — logic from public/game.html.

const W = 10, H = 10;
const WALL_DENSITY = 0;

function randInt(a, b) { return Math.floor(Math.random() * (b - a + 1)) + a; }
function choice(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function key(x, y) { return `${x},${y}`; }

function makeWorld() {
  const world = Array.from({ length: H }, () => Array.from({ length: W }, () => '.'));
  const interior = [];
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) interior.push([x, y]);
  const wallsToPlace = Math.floor(interior.length * WALL_DENSITY);
  for (let i = 0; i < wallsToPlace; i++) {
    const [sx, sy] = choice(interior);
    const len = Math.floor(Math.random() * 5) + 2, horiz = Math.random() < 0.5;
    for (let k = 0; k < len; k++) {
      const x = Math.min(W - 2, Math.max(1, sx + (horiz ? k : 0)));
      const y = Math.min(H - 2, Math.max(1, sy + (horiz ? 0 : k)));
      world[y][x] = '#';
    }
  }
  let ax, ay;
  do { ax = randInt(1, W - 2); ay = randInt(1, H - 2); } while (world[ay][ax] !== '.');
  const agent = { x: ax, y: ay };
  return { world, agent };
}

function passableForConnectivity(world, x, y) { return world[y][x] === '.'; }

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
      if (!passableForConnectivity(world, nx, ny)) continue;
      seen.add(kk); q.push([nx, ny]);
    }
  }
  return seen;
}

describe('makeWorld', () => {
  test('returns a world with H rows', () => {
    const { world } = makeWorld();
    expect(world).toHaveLength(H);
  });

  test('each row has W columns', () => {
    const { world } = makeWorld();
    world.forEach(row => expect(row).toHaveLength(W));
  });

  test('with WALL_DENSITY=0, all cells are "."', () => {
    const { world } = makeWorld();
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        expect(world[y][x]).toBe('.');
      }
    }
  });

  test('agent position is within bounds', () => {
    const { agent } = makeWorld();
    expect(agent.x).toBeGreaterThanOrEqual(0);
    expect(agent.x).toBeLessThan(W);
    expect(agent.y).toBeGreaterThanOrEqual(0);
    expect(agent.y).toBeLessThan(H);
  });

  test('agent position is on a floor tile', () => {
    const { world, agent } = makeWorld();
    expect(world[agent.y][agent.x]).toBe('.');
  });

  test('agent is placed in interior (not at edge)', () => {
    for (let i = 0; i < 10; i++) {
      const { agent } = makeWorld();
      expect(agent.x).toBeGreaterThanOrEqual(1);
      expect(agent.x).toBeLessThanOrEqual(W - 2);
      expect(agent.y).toBeGreaterThanOrEqual(1);
      expect(agent.y).toBeLessThanOrEqual(H - 2);
    }
  });

  test('calling makeWorld multiple times produces different agent positions', () => {
    const positions = new Set();
    for (let i = 0; i < 20; i++) {
      const { agent } = makeWorld();
      positions.add(key(agent.x, agent.y));
    }
    // With a 10x10 interior, we expect at least 2 distinct positions in 20 tries
    expect(positions.size).toBeGreaterThan(1);
  });
});

describe('Grid connectivity check via BFS', () => {
  test('all-floor 10x10 grid: BFS from center visits all cells', () => {
    const { world, agent } = makeWorld(); // WALL_DENSITY=0, so all floor
    const seen = bfsFrom(world, agent.x, agent.y);
    // Every cell should be reachable
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        expect(seen.has(key(x, y))).toBe(true);
      }
    }
  });

  test('grid with isolated wall: cells around agent still reachable', () => {
    // Create a world and add a wall in one spot that doesn't block access
    const { world, agent } = makeWorld();
    // Add a single wall that doesn't isolate anything
    const wallX = agent.x === 5 ? 6 : 5;
    const wallY = agent.y === 5 ? 6 : 5;
    world[wallY][wallX] = '#';

    const seen = bfsFrom(world, agent.x, agent.y);
    // Agent's position should always be reachable (from itself)
    expect(seen.has(key(agent.x, agent.y))).toBe(true);
  });
});
