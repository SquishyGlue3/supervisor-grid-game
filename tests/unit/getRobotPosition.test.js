// Tests for getRobotPosition() — copied verbatim from server.js

function getRobotPosition(board) {
  if (!board || !board.length) return '?';
  for (let r = 0; r < board.length; r++) {
    const c = board[r].indexOf('R');
    if (c !== -1) return `(${r + 1},${c + 1})`;
  }
  return '?';
}

describe('getRobotPosition', () => {
  test('robot R at row 0 col 0 → (1,1) (1-based)', () => {
    expect(getRobotPosition(['R.........', '..........'])).toBe('(1,1)');
  });

  test('robot at row 2, col 3 → (3,4)', () => {
    const board = [
      '..........',
      '..........',
      '...R......',
    ];
    expect(getRobotPosition(board)).toBe('(3,4)');
  });

  test('robot at last row, last col', () => {
    const board = [
      '..........',
      '..........',
      '.........R',
    ];
    expect(getRobotPosition(board)).toBe('(3,10)');
  });

  test('no R in board → ?', () => {
    expect(getRobotPosition(['..........', '..........'])).toBe('?');
  });

  test('null board → ?', () => {
    expect(getRobotPosition(null)).toBe('?');
  });

  test('empty board array → ?', () => {
    expect(getRobotPosition([])).toBe('?');
  });

  test('finds first R when multiple rows', () => {
    // Should return position of first R found
    const board = [
      '..........',
      '....R.....',
      '..R.......',
    ];
    expect(getRobotPosition(board)).toBe('(2,5)');
  });
});
