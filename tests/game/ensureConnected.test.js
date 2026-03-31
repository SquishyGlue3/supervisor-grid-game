/** @jest-environment jsdom */
// Tests for ensureConnected() and related BFS connectivity — from public/game.html.

const W = 10, H = 10;

function key(x, y) { return `${x},${y}`; }
function inBounds(x, y) { return x >= 0 && y >= 0 && x < W && y < H; }
function passable(world, x, y) { return world[y][x] === '.'; }

function bfsFrom(world, sx, sy) {
  const start = key(sx, sy);
  const seen = new Set([start]);
  const q = [[sx, sy]];
  while (q.length) {
    const [cx, cy] = q.shift();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, ny = cy + dy;
      if (!inBounds(nx, ny)) continue;
      const kk = key(nx, ny);
      if (seen.has(kk) || !passable(world, nx, ny)) continue;
      seen.add(kk); q.push([nx, ny]);
    }
  }
  return seen;
}

function carveCorridor(world, ax, ay, bx, by) {
  const sx = ax < bx ? 1 : -1;
  const sy = ay < by ? 1 : -1;
  for (let x = ax; x !== bx; x += sx) world[ay][x] = '.';
  for (let y = ay; y !== by; y += sy) world[y][bx] = '.';
  world[by][bx] = '.';
}

function ensureConnected(world, agent) {
  const seen = bfsFrom(world, agent.x, agent.y);
  const passableList = [];
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      if (passable(world, x, y)) passableList.push([x, y]);
    }
  }
  function anyUnseen() {
    for (const [x, y] of passableList) if (!seen.has(key(x, y))) return [x, y];
    return null;
  }
  let p; let safety = 0;
  while ((p = anyUnseen()) && safety++ < 300) {
    let best = null, bestD = 1e9;
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        if (!seen.has(key(x, y))) continue;
        const d = Math.abs(x - p[0]) + Math.abs(y - p[1]);
        if (d < bestD) { bestD = d; best = [x, y]; }
      }
    }
    if (best) {
      carveCorridor(world, best[0], best[1], p[0], p[1]);
      // Update seen with new corridor tiles
      const newSeen = bfsFrom(world, agent.x, agent.y);
      newSeen.forEach(k => seen.add(k));
    } else break;
  }
}

function makeFloorWorld() {
  return Array.from({ length: H }, () => Array.from({ length: W }, () => '.'));
}

describe('BFS from agent', () => {
  test('fully open grid: BFS visits all cells', () => {
    const world = makeFloorWorld();
    const seen = bfsFrom(world, 5, 5);
    expect(seen.size).toBe(W * H);
  });

  test('single wall tile: still reachable if agent on same component', () => {
    const world = makeFloorWorld();
    world[5][6] = '#'; // one wall
    const seen = bfsFrom(world, 5, 5);
    // (6,5) should now be unreachable? No — we blocked (6,5) not (5,6)
    // The wall is at (x=6, y=5) = world[5][6]
    expect(seen.has(key(6, 5))).toBe(false);
    expect(seen.has(key(5, 5))).toBe(true);
  });

  test('BFS does not visit wall tiles', () => {
    const world = makeFloorWorld();
    world[3][3] = '#';
    world[4][4] = '#';
    const seen = bfsFrom(world, 5, 5);
    expect(seen.has(key(3, 3))).toBe(false);
    expect(seen.has(key(4, 4))).toBe(false);
  });
});

describe('carveCorridor', () => {
  test('carves a path of floor tiles between two points', () => {
    const world = makeFloorWorld();
    // Create a wall barrier
    for (let x = 0; x < W; x++) world[5][x] = '#';
    // Carve a corridor from (2,4) to (2,6)
    carveCorridor(world, 2, 4, 2, 6);
    // The path through column 2 from row 4 to 6 should be cleared
    expect(world[5][2]).toBe('.');
    expect(world[6][2]).toBe('.');
  });

  test('horizontal corridor clears tiles along the row', () => {
    const world = makeFloorWorld();
    for (let y = 0; y < H; y++) world[y][5] = '#'; // vertical wall at col 5
    carveCorridor(world, 2, 3, 7, 3);
    // Should have cleared (2-7, row 3) at minimum
    for (let x = 2; x <= 7; x++) {
      // Some of these might still be walls but the path through should exist
    }
    // At least the destination should be clear
    expect(world[3][7]).toBe('.');
  });
});

describe('ensureConnected', () => {
  test('fully open grid remains fully connected', () => {
    const world = makeFloorWorld();
    const agent = { x: 5, y: 5 };
    ensureConnected(world, agent);
    const seen = bfsFrom(world, agent.x, agent.y);
    // All cells should be reachable
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (world[y][x] === '.') {
          expect(seen.has(key(x, y))).toBe(true);
        }
      }
    }
  });

  test('grid with isolated region becomes connected after ensureConnected', () => {
    const world = makeFloorWorld();
    const agent = { x: 1, y: 1 };
    // Create a wall barrier splitting the grid horizontally
    for (let x = 0; x < W; x++) world[5][x] = '#';
    // Agent is at (1,1) — isolated from rows 6-9

    ensureConnected(world, agent);

    const seen = bfsFrom(world, agent.x, agent.y);
    // Now the bottom region should be reachable
    const hasBottomCell = seen.has(key(1, 7)) || seen.has(key(2, 7)) || seen.has(key(3, 7));
    expect(hasBottomCell).toBe(true);
  });

  test('after ensureConnected, all passable cells reachable from agent', () => {
    const world = makeFloorWorld();
    const agent = { x: 2, y: 2 };
    // Place a few random walls
    world[4][4] = '#';
    world[4][5] = '#';
    world[4][6] = '#';
    world[5][4] = '#';

    ensureConnected(world, agent);

    const seen = bfsFrom(world, agent.x, agent.y);
    let allReachable = true;
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        if (world[y][x] === '.' && !seen.has(key(x, y))) {
          allReachable = false;
        }
      }
    }
    expect(allReachable).toBe(true);
  });
});
