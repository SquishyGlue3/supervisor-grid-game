// Set env vars BEFORE requiring server
require('dotenv').config({ path: require('path').join(__dirname, '../.env.test') });

// Mock pg pool so we don't need a real DB for HTTP unit tests
jest.mock('pg', () => {
  const mQuery = jest.fn();
  const mPool = { query: mQuery, end: jest.fn().mockResolvedValue() };
  return { Pool: jest.fn(() => mPool) };
});

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(() => ({ send: jest.fn() })),
  PutObjectCommand: jest.fn(),
  GetObjectCommand: jest.fn(),
}));

const request = require('supertest');
const { Pool } = require('pg');

let app, server, wss;
let mockQuery;

beforeAll(async () => {
  mockQuery = Pool().query;
  // Default: initDB() queries succeed
  mockQuery.mockResolvedValue({ rows: [] });
  ({ app, server, wss } = require('../../server'));
  await new Promise(r => setTimeout(r, 200));
  server.unref();
}, 10000);

afterAll(async () => {
  if (wss) { for (const c of wss.clients) c.terminate(); await new Promise(r => wss.close(r)).catch(() => {}); }
  if (server) { server.closeAllConnections(); await new Promise(r => server.close(r)).catch(() => {}); }
});

beforeEach(() => {
  mockQuery.mockReset();
  // Default: initDB table queries succeed
  mockQuery.mockResolvedValue({ rows: [] });
});

describe('POST /api/session', () => {
  test('creates session with Prolific fields → 200 { dbSessionId }', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 42 }] });

    const res = await request(app)
      .post('/api/session')
      .send({ prolific_pid: 'p123', study_id: 's1', session_id: 'sess1' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ dbSessionId: 42 });
  });

  test('empty body → 200 with dbSessionId (null fields allowed)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 7 }] });

    const res = await request(app)
      .post('/api/session')
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.dbSessionId).toBe(7);
  });

  test('only prolific_pid provided → 200', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 3 }] });

    const res = await request(app)
      .post('/api/session')
      .send({ prolific_pid: 'pOnly' });

    expect(res.status).toBe(200);
    expect(res.body.dbSessionId).toBe(3);
  });

  test('DB error → 500 { error: "Failed to create session" }', async () => {
    mockQuery.mockRejectedValueOnce(new Error('DB connection error'));

    const res = await request(app)
      .post('/api/session')
      .send({ prolific_pid: 'p' });

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Failed to create session');
  });

  test('INSERT called with correct parameters including null fallbacks', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 1 }] });

    await request(app)
      .post('/api/session')
      .send({ prolific_pid: 'pTest' });

    const insertCall = mockQuery.mock.calls.find(c =>
      typeof c[0] === 'string' && c[0].includes('INSERT INTO sessions')
    );
    expect(insertCall).toBeDefined();
    // Values: prolific_pid, study_id (null), session_id (null)
    expect(insertCall[1]).toEqual(['pTest', null, null]);
  });
});
