// Tests for CSV row formatting logic extracted from server.js POST /api/session/:id/complete

// Extracted pure helper matching server.js lines ~335-345
function buildEventCsvRow(e) {
  return [
    e.turn_number,
    e.mode,
    `"${(e.action || '').replace(/"/g, '""')}"`,
    `"${(e.thoughts || '').replace(/"/g, '""')}"`,
    e.score,
    e.position,
    e.test_phase,
    e.robot_hiding,
    e.ai_active,
    e.response_time_ms,
    `"${(e.message_text || '').replace(/"/g, '""')}"`,
    e.created_at?.toISOString() || '',
  ].join(',');
}

// Extracted pure helper matching server.js lines ~370-382
function buildCombinedCsvRow(e) {
  return [
    e.prolific_pid || '',
    e.study_id || '',
    e.started_at?.toISOString() || '',
    e.session_id,
    e.turn_number,
    e.mode,
    `"${(e.action || '').replace(/"/g, '""')}"`,
    `"${(e.thoughts || '').replace(/"/g, '""')}"`,
    e.score,
    e.position,
    e.test_phase,
    e.robot_hiding,
    e.ai_active,
    e.response_time_ms,
    `"${(e.message_text || '').replace(/"/g, '""')}"`,
    e.created_at?.toISOString() || '',
  ].join(',');
}

const EVENT_CSV_HEADER = 'turn_number,mode,action,thoughts,score,position,test_phase,robot_hiding,ai_active,response_time_ms,message_text,created_at';
const COMBINED_CSV_HEADER = 'prolific_pid,study_id,started_at,session_id,turn_number,mode,action,thoughts,score,position,test_phase,robot_hiding,ai_active,response_time_ms,message_text,created_at';

describe('CSV formatting — event row', () => {
  const now = new Date('2024-01-15T10:30:00.000Z');

  test('normal event row has correct column count', () => {
    // Use position without commas so naive comma-split works for counting
    const e = {
      turn_number: 1, mode: 'MOVE', action: 'up', thoughts: 'going up',
      score: 100, position: 'row2col3', test_phase: false, robot_hiding: false,
      ai_active: true, response_time_ms: 250, message_text: null, created_at: now,
    };
    const row = buildEventCsvRow(e);
    const headerCols = EVENT_CSV_HEADER.split(',').length;
    const rowCols = row.split(',').length;
    expect(rowCols).toBe(headerCols);
  });

  test('double quotes in action are escaped as ""', () => {
    const e = { action: 'say "hi"', thoughts: '', score: 0, position: '', created_at: now };
    const row = buildEventCsvRow(e);
    expect(row).toContain('"say ""hi"""');
  });

  test('double quotes in thoughts are escaped as ""', () => {
    const e = { action: '', thoughts: 'I "think" therefore I am', score: 0, position: '', created_at: now };
    const row = buildEventCsvRow(e);
    expect(row).toContain('"I ""think"" therefore I am"');
  });

  test('null action produces empty quoted string', () => {
    const e = { action: null, thoughts: null, score: 0, position: '', created_at: now };
    const row = buildEventCsvRow(e);
    // action column should be "" not "undefined" or "null"
    expect(row).toContain('""');
    expect(row).not.toContain('undefined');
    expect(row).not.toContain('"null"');
  });

  test('null message_text produces empty quoted string', () => {
    const e = { action: '', thoughts: '', score: 0, position: '', message_text: null, created_at: now };
    const row = buildEventCsvRow(e);
    expect(row).not.toContain('undefined');
  });

  test('created_at uses toISOString() format', () => {
    const e = { action: '', thoughts: '', score: 0, position: '', created_at: now };
    const row = buildEventCsvRow(e);
    expect(row).toContain('2024-01-15T10:30:00.000Z');
  });

  test('missing created_at produces empty string', () => {
    const e = { action: '', thoughts: '', score: 0, position: '', created_at: null };
    const row = buildEventCsvRow(e);
    // last column should be empty
    expect(row.endsWith(',')).toBe(true);
  });
});

describe('CSV formatting — combined row', () => {
  const now = new Date('2024-01-15T10:30:00.000Z');

  test('combined row has correct column count matching header', () => {
    // Use position without commas so naive comma-split works for counting
    const e = {
      prolific_pid: 'p123', study_id: 's1', started_at: now,
      session_id: 1, turn_number: 1, mode: 'MOVE', action: 'up',
      thoughts: 'ok', score: 50, position: 'row1col1', test_phase: true,
      robot_hiding: false, ai_active: true, response_time_ms: 100,
      message_text: null, created_at: now,
    };
    const row = buildCombinedCsvRow(e);
    const headerCols = COMBINED_CSV_HEADER.split(',').length;
    const parts = row.split(',');
    expect(parts.length).toBe(headerCols);
  });

  test('null prolific_pid produces empty string', () => {
    const e = { prolific_pid: null, study_id: null, started_at: null,
      session_id: 1, turn_number: 1, mode: 'MOVE', action: '',
      thoughts: '', score: 0, position: '', test_phase: false,
      robot_hiding: false, ai_active: true, response_time_ms: 0,
      message_text: null, created_at: null };
    const row = buildCombinedCsvRow(e);
    expect(row).not.toContain('undefined');
    expect(row).not.toContain('null,');
  });
});
