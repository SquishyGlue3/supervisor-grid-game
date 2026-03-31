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
const ADMIN_SECRET = 'test-admin-secret';

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

describe('GET /api/sessions/count', () => {
  test('no auth header → 401', async () => {
    const res = await request(app).get('/api/sessions/count');
    expect(res.status).toBe(401);
  });

  test('wrong x-admin-secret → 401 Unauthorized', async () => {
    const res = await request(app)
      .get('/api/sessions/count')
      .set('x-admin-secret', 'wrongsecret');

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Unauthorized');
  });

  test('correct x-admin-secret header → 200 with total and completed', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ total: '5', completed: '3' }]
    });

    const res = await request(app)
      .get('/api/sessions/count')
      .set('x-admin-secret', ADMIN_SECRET);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('total');
    expect(res.body).toHaveProperty('completed');
  });

  test('correct ?secret= query param → 200', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ total: '2', completed: '1' }]
    });

    const res = await request(app)
      .get(`/api/sessions/count?secret=${ADMIN_SECRET}`);

    expect(res.status).toBe(200);
    expect(res.body.total).toBe('2');
  });

  test('count values match what DB returns', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ total: '3', completed: '2' }]
    });

    const res = await request(app)
      .get('/api/sessions/count')
      .set('x-admin-secret', ADMIN_SECRET);

    expect(Number(res.body.total)).toBe(3);
    expect(Number(res.body.completed)).toBe(2);
  });

  test('DB error → 500', async () => {
    mockQuery.mockRejectedValueOnce(new Error('DB down'));

    const res = await request(app)
      .get('/api/sessions/count')
      .set('x-admin-secret', ADMIN_SECRET);

    expect(res.status).toBe(500);
  });
});
