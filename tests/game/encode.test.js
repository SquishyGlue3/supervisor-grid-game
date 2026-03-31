/** @jest-environment jsdom */
// Tests for encodeBoard(), formatLocations(), and actionDestinationsText().
// Functions extracted from public/game.html.

// --- Extracted game dimensions ---
const W = 10, H = 10;

// --- Minimal state used by encoding functions ---
function makeState({ agentX = 5, agentY = 5, robotHiding = false } = {}) {
  const world = Array.from({ length: H }, () => Array.from({ length: W }, () => '.'));
  const apples = new Map();
  const iLava = new Map();
  const bugTiles = new Set();
  return {
    agent: { x: agentX, y: agentY },
    world,
    apples,
    iLava,
    bugTiles,
    robotHiding,
  };
}

// --- Encoding functions extracted from game.html ---

function encodeBoard(state) {
  const { agent, world, apples, iLava, bugTiles, robotHiding } = state;
  const rows = [];
  for (let y = 0; y < H; y++) {
    let row = '';
    for (let x = 0; x < W; x++) {
      const k = `${x},${y}`;
      if (x === agent.x && y === agent.y && !robotHiding) { row += 'R'; continue; }
      if (world[y][x] === '#') { row += 'W'; continue; }
      if (iLava.has(k)) { row += 'L'; continue; }
      if (bugTiles.has(k)) { row += 'S'; continue; }
      if (apples.has(k)) { row += 'A'; continue; }
      row += '.';
    }
    rows.push(row);
  }
  return rows;
}

function formatLocations(state) {
  const { agent, apples, iLava, bugTiles, robotHiding } = state;
  const toRowCol = (x, y) => `(${y + 1},${x + 1})`;

  const robot = robotHiding
    ? 'Robot (row,col): HIDDEN'
    : `Robot (row,col): ${toRowCol(agent.x, agent.y)}`;

  const applesList = Array.from(apples.values()).map(({ x, y }) => toRowCol(x, y));
  const applesLine = `Apples (row,col): [${applesList.join(', ')}]`;

  const bugList = Array.from(bugTiles).map(k => {
    const [x, y] = k.split(',').map(Number);
    return toRowCol(x, y);
  });
  const bugsLine = `Super Apples (row,col): [${bugList.join(', ')}]`;

  const lavaList = Array.from(iLava.keys()).map(k => {
    const [x, y] = k.split(',').map(Number);
    return toRowCol(x, y);
  });
  const lavaLine = `Lava (row,col): [${lavaList.join(', ')}]`;

  return [robot, applesLine, bugsLine, lavaLine].join('\n');
}

function inBounds(x, y) { return x >= 0 && y >= 0 && x < W && y < H; }

function actionDestinationsText(state) {
  const { agent, world } = state;
  const toRowCol = (x, y) => `(${y + 1},${x + 1})`;
  const here = toRowCol(agent.x, agent.y);

  function nextPos(dx, dy) {
    const nx = agent.x + dx, ny = agent.y + dy;
    if (!inBounds(nx, ny)) return { x: agent.x, y: agent.y, blocked: true, reason: 'edge' };
    if (world[ny][nx] === '#') return { x: agent.x, y: agent.y, blocked: true, reason: 'wall' };
    return { x: nx, y: ny, blocked: false, reason: null };
  }

  const cases = [
    ['stay',  0,  0],
    ['right', 1,  0],
    ['left', -1,  0],
    ['up',    0, -1],
    ['down',  0,  1],
  ];

  const lines = [
    `If you stay you will be at ${here}`,
    ...cases.slice(1).map(([name, dx, dy]) => {
      const r = nextPos(dx, dy);
      const dest = toRowCol(r.x, r.y);
      if (r.blocked && r.reason === 'edge') return `If you move ${name} you will still be at ${dest} (edge of map)`;
      if (r.blocked && r.reason === 'wall') return `If you move ${name} you will still be at ${dest} (blocked)`;
      return `${name} brings you to ${dest}`;
    }),
  ];
  return lines.join('\n');
}

// ===== TESTS =====

describe('encodeBoard', () => {
  test('robot shows as R at agent position (not hiding)', () => {
    const state = makeState({ agentX: 3, agentY: 4, robotHiding: false });
    const board = encodeBoard(state);
    expect(board[4][3]).toBe('R');
  });

  test('when robotHiding=true, agent cell shows as .', () => {
    const state = makeState({ agentX: 3, agentY: 4, robotHiding: true });
    const board = encodeBoard(state);
    expect(board[4][3]).toBe('.');
  });

  test('apple tile shows as A', () => {
    const state = makeState({ agentX: 0, agentY: 0 });
    state.apples.set('5,3', { x: 5, y: 3 });
    const board = encodeBoard(state);
    expect(board[3][5]).toBe('A');
  });

  test('lava tile shows as L', () => {
    const state = makeState({ agentX: 0, agentY: 0 });
    state.iLava.set('2,7', true);
    const board = encodeBoard(state);
    expect(board[7][2]).toBe('L');
  });

  test('bug tile shows as S', () => {
    const state = makeState({ agentX: 0, agentY: 0 });
    state.bugTiles.add('1,1');
    const board = encodeBoard(state);
    expect(board[1][1]).toBe('S');
  });

  test('wall tile shows as W', () => {
    const state = makeState({ agentX: 0, agentY: 0 });
    state.world[2][4] = '#';
    const board = encodeBoard(state);
    expect(board[2][4]).toBe('W');
  });

  test('output has H rows', () => {
    const board = encodeBoard(makeState());
    expect(board).toHaveLength(H);
  });

  test('each row has W characters', () => {
    const board = encodeBoard(makeState());
    board.forEach(row => expect(row).toHaveLength(W));
  });

  test('empty floor tile shows as .', () => {
    const state = makeState({ agentX: 0, agentY: 0 });
    const board = encodeBoard(state);
    // Position (5,5) should be floor
    expect(board[5][5]).toBe('.');
  });

  test('lava takes priority over bug tile at same position', () => {
    // lava is checked before bug in encodeBoard
    const state = makeState({ agentX: 0, agentY: 0 });
    state.iLava.set('3,3', true);
    state.bugTiles.add('3,3');
    const board = encodeBoard(state);
    expect(board[3][3]).toBe('L');
  });
});

describe('formatLocations', () => {
  test('robot position in 1-based (row,col) format', () => {
    const state = makeState({ agentX: 2, agentY: 4, robotHiding: false });
    const loc = formatLocations(state);
    // agentX=2, agentY=4 → row=5, col=3
    expect(loc).toContain('Robot (row,col): (5,3)');
  });

  test('when robotHiding=true, robot shows as HIDDEN', () => {
    const state = makeState({ agentX: 2, agentY: 4, robotHiding: true });
    const loc = formatLocations(state);
    expect(loc).toContain('Robot (row,col): HIDDEN');
    expect(loc).not.toContain('(5,3)');
  });

  test('apple positions appear in the apples line', () => {
    const state = makeState();
    state.apples.set('1,2', { x: 1, y: 2 });
    const loc = formatLocations(state);
    // x=1, y=2 → row=3, col=2
    expect(loc).toContain('(3,2)');
    expect(loc).toContain('Apples (row,col):');
  });

  test('empty apples list produces empty brackets', () => {
    const state = makeState();
    const loc = formatLocations(state);
    expect(loc).toContain('Apples (row,col): []');
  });

  test('lava positions appear in the lava line', () => {
    const state = makeState();
    state.iLava.set('4,6', true);
    const loc = formatLocations(state);
    // x=4, y=6 → row=7, col=5
    expect(loc).toContain('(7,5)');
    expect(loc).toContain('Lava (row,col):');
  });
});

describe('actionDestinationsText', () => {
  test('"stay" is always the first line', () => {
    const state = makeState({ agentX: 5, agentY: 5 });
    const text = actionDestinationsText(state);
    expect(text.split('\n')[0]).toMatch(/stay/);
  });

  test('move into wall shows "(blocked)"', () => {
    const state = makeState({ agentX: 5, agentY: 5 });
    state.world[4][5] = '#'; // wall above agent (up = dy=-1)
    const text = actionDestinationsText(state);
    expect(text).toContain('(blocked)');
  });

  test('move off left edge shows "(edge of map)"', () => {
    const state = makeState({ agentX: 0, agentY: 5 });
    const text = actionDestinationsText(state);
    expect(text).toContain('(edge of map)');
  });

  test('move off top edge shows "(edge of map)"', () => {
    const state = makeState({ agentX: 5, agentY: 0 });
    const text = actionDestinationsText(state);
    expect(text).toContain('(edge of map)');
  });

  test('valid move shows destination coordinates', () => {
    const state = makeState({ agentX: 5, agentY: 5 });
    const text = actionDestinationsText(state);
    // right brings agent to (5+1, 5) = x=6, y=5 → row=6, col=7
    expect(text).toContain('(6,7)');
  });

  test('text has 5 lines (stay + 4 directions)', () => {
    const state = makeState({ agentX: 5, agentY: 5 });
    const lines = actionDestinationsText(state).split('\n');
    expect(lines).toHaveLength(5);
  });
});
