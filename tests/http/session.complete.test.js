// Set env vars BEFORE requiring server
require('dotenv').config({ path: require('path').join(__dirname, '../.env.test') });

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
  mockQuery.mockResolvedValue({ rows: [] });
});

describe('POST /api/session/:id/complete', () => {
  function mockSessionExists(completed = false) {
    // SELECT check returns existing non-completed session
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 1, completed }] });
    // UPDATE succeeds
    mockQuery.mockResolvedValueOnce({ rows: [] });
  }

  test('valid scores → 200 { success: true, completionUrl: null }', async () => {
    mockSessionExists(false);
    const res = await request(app)
      .post('/api/session/1/complete')
      .send({ humanScore: 500, aiScore: 300, totalSteps: 200 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.completionUrl).toBeNull();
  });

  test('non-numeric id "12abc" → 400 Invalid session id', async () => {
    const res = await request(app)
      .post('/api/session/12abc/complete')
      .send({ humanScore: 0 });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid session id');
    // Should NOT have called the DB
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('non-numeric id "abc" → 400', async () => {
    const res = await request(app)
      .post('/api/session/abc/complete')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid session id');
  });

  test('non-existent id → 404 Session not found', async () => {
    // SELECT returns no rows
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post('/api/session/99999/complete')
      .send({ humanScore: 0 });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Session not found');
  });

  test('already-completed session → 409 Session already completed', async () => {
    mockSessionExists(true); // completed = true

    const res = await request(app)
      .post('/api/session/1/complete')
      .send({});

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Session already completed');
  });

  test('missing scores → UPDATE called with 0 defaults', async () => {
    mockSessionExists(false);
    await request(app).post('/api/session/1/complete').send({});

    const updateCall = mockQuery.mock.calls.find(c =>
      typeof c[0] === 'string' && c[0].includes('UPDATE sessions')
    );
    expect(updateCall).toBeDefined();
    // [humanScore || 0, aiScore || 0, totalSteps || 0, id]
    expect(updateCall[1][0]).toBe(0); // humanScore
    expect(updateCall[1][1]).toBe(0); // aiScore
    expect(updateCall[1][2]).toBe(0); // totalSteps
    expect(updateCall[1][3]).toBe('1'); // id (string from params)
  });

  test('DB error → 500 { error: "Failed to complete session" }', async () => {
    mockQuery.mockRejectedValueOnce(new Error('DB error'));

    const res = await request(app)
      .post('/api/session/1/complete')
      .send({});

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Failed to complete session');
  });
});
