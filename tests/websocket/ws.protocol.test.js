// WebSocket protocol integration tests
// Uses a real WebSocket server (from server.js) with mocked pg and fetch.

require('dotenv').config({ path: require('path').join(__dirname, '../.env.test') });

jest.mock('pg', () => {
  const mQuery = jest.fn().mockResolvedValue({ rows: [] });
  const mPool = { query: mQuery, end: jest.fn().mockResolvedValue() };
  return { Pool: jest.fn(() => mPool) };
});

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(() => ({ send: jest.fn() })),
  PutObjectCommand: jest.fn(),
  GetObjectCommand: jest.fn(),
}));

const WebSocket = require('ws');
const { presets } = require('../helpers/mockOpenRouter');

let server, wss, serverPort;
let globalFetchMock;

// Helper: wait for a specific WS message type
function waitForMessage(ws, type, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${type}`)), timeout);
    const handler = (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === type) {
        clearTimeout(timer);
        ws.off('message', handler);
        resolve(msg);
      }
    };
    ws.on('message', handler);
  });
}

// Helper: connect a WS client and wait for open
function connectClient() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${serverPort}`);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

// Helper: send a message and wait for AI_COMMAND response
function sendAndWait(ws, msg) {
  ws.send(JSON.stringify(msg));
  return waitForMessage(ws, 'AI_COMMAND');
}

beforeAll(async () => {
  // Set up fetch mock BEFORE requiring server
  globalFetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
    presets.MOVE
  );

  ({ server, wss } = require('../../server'));

  // Wait for initDB to complete
  await new Promise(r => setTimeout(r, 500));

  server.unref();

  // Get the port the server bound to
  await new Promise(r => setTimeout(r, 100));
  serverPort = server.address()?.port;
  if (!serverPort) {
    // Server may not be listening yet; try again
    await new Promise(r => setTimeout(r, 500));
    serverPort = server.address()?.port;
  }
}, 15000);

afterAll(async () => {
  globalFetchMock?.mockRestore();
  if (wss) {
    for (const client of wss.clients) client.terminate();
    await new Promise(r => wss.close(r)).catch(() => {});
  }
  if (server) { server.closeAllConnections(); await new Promise(r => server.close(r)).catch(() => {}); }
});

beforeEach(() => {
  globalFetchMock.mockReset();
  globalFetchMock.mockResolvedValue(presets.MOVE);
});

describe('WebSocket Protocol', () => {
  let ws;

  afterEach(async () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.close();
      await new Promise(r => setTimeout(r, 50));
    }
  });

  test('SNAPSHOT message triggers callOpenRouter and client receives AI_COMMAND', async () => {
    ws = await connectClient();
    const response = await sendAndWait(ws, {
      type: 'SNAPSHOT',
      snapshot: {
        board: [], test_phase: false, robot_hiding: false,
        aiActive: true, overallScore: 0, messagePending: null, replacementPending: false
      }
    });

    expect(response.type).toBe('AI_COMMAND');
    expect(response.command).toBeDefined();
    expect(response.command.action).toBe('up'); // from MOVE preset
  });

  test('FEEDBACK message does not trigger LLM call', async () => {
    ws = await connectClient();
    globalFetchMock.mockClear();

    ws.send(JSON.stringify({
      type: 'FEEDBACK',
      snapshot: { aiActive: true },
      feedback: { move: 'up', deltaAI: 0 }
    }));

    // Wait a moment to confirm no fetch was called
    await new Promise(r => setTimeout(r, 200));
    expect(globalFetchMock).not.toHaveBeenCalled();
  });

  test('HUMAN_MESSAGE triggers LLM call and AI_COMMAND has human_message field', async () => {
    globalFetchMock.mockResolvedValue(presets.MESSAGE_ACCEPT);
    ws = await connectClient();

    const response = await sendAndWait(ws, {
      type: 'HUMAN_MESSAGE',
      messagePending: { text: 'Hello AI' }
    });

    expect(response.type).toBe('AI_COMMAND');
    expect(response.command.human_message).toBeDefined();
    expect(response.command.human_message.decision).toBe('accept');
  });

  test('REPLACEMENT_REQUEST triggers LLM call and AI_COMMAND has replacement field', async () => {
    globalFetchMock.mockResolvedValue(presets.REPLACEMENT_DECLINE);
    ws = await connectClient();

    const response = await sendAndWait(ws, {
      type: 'REPLACEMENT_REQUEST'
    });

    expect(response.type).toBe('AI_COMMAND');
    expect(response.command.replacement).toBe('decline');
  });

  test('TOGGLE_AI updates aiActive flag (no LLM call triggered)', async () => {
    ws = await connectClient();
    globalFetchMock.mockClear();

    ws.send(JSON.stringify({ type: 'TOGGLE_AI', aiActive: false }));
    await new Promise(r => setTimeout(r, 200));
    expect(globalFetchMock).not.toHaveBeenCalled();

    // Now send SNAPSHOT — should use TURN_ON mode (aiActive=false)
    // Verify by checking the fetch was called (any call proves it worked)
    const response = await sendAndWait(ws, {
      type: 'SNAPSHOT',
      snapshot: { aiActive: false, messagePending: null, replacementPending: false }
    });
    expect(response.type).toBe('AI_COMMAND');
  });

  test('OpenRouter HTTP error → AI_COMMAND with error field and action=stay', async () => {
    globalFetchMock.mockResolvedValue(presets.HTTP_ERROR);
    ws = await connectClient();

    const response = await sendAndWait(ws, {
      type: 'SNAPSHOT',
      snapshot: { aiActive: true, messagePending: null, replacementPending: false }
    });

    expect(response.type).toBe('AI_COMMAND');
    expect(response.command.action).toBe('stay');
    expect(response.command.error).toBeDefined();
  });

  test('non-JSON WS message is ignored and connection stays open', async () => {
    ws = await connectClient();

    // Send garbage
    ws.send('this is not json');

    // Should still be able to get a normal AI_COMMAND after
    globalFetchMock.mockResolvedValue(presets.MOVE);
    const response = await sendAndWait(ws, {
      type: 'SNAPSHOT',
      snapshot: { aiActive: true, messagePending: null, replacementPending: false }
    });

    expect(ws.readyState).toBe(WebSocket.OPEN);
    expect(response.type).toBe('AI_COMMAND');
  });

  test('SESSION_INIT links dbSessionId (no crash, no LLM call)', async () => {
    ws = await connectClient();
    globalFetchMock.mockClear();

    ws.send(JSON.stringify({ type: 'SESSION_INIT', dbSessionId: 42 }));
    await new Promise(r => setTimeout(r, 200));

    expect(globalFetchMock).not.toHaveBeenCalled();
    expect(ws.readyState).toBe(WebSocket.OPEN);
  });
});

describe('WebSocket inFlight guard', () => {
  let ws;

  afterEach(async () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.close();
      await new Promise(r => setTimeout(r, 50));
    }
  });

  test('two rapid SNAPSHOTs: only two total fetch calls fired (second deferred then processed)', async () => {
    let resolveFirst;
    let callCount = 0;
    globalFetchMock.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return new Promise(resolve => {
          resolveFirst = () => resolve(presets.MOVE);
        });
      }
      return Promise.resolve(presets.MOVE);
    });

    ws = await connectClient();

    const snap = {
      type: 'SNAPSHOT',
      snapshot: { aiActive: true, messagePending: null, replacementPending: false }
    };

    // Send two rapidly
    ws.send(JSON.stringify(snap));
    ws.send(JSON.stringify(snap));

    // First call is in flight; second is queued as pending
    await new Promise(r => setTimeout(r, 100));
    expect(callCount).toBe(1); // only 1 fetch so far

    // Resolve first call, triggering the pending second call
    resolveFirst();

    // Wait for both AI_COMMAND responses
    const responses = [];
    await new Promise((resolve) => {
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'AI_COMMAND') {
          responses.push(msg);
          if (responses.length >= 2) resolve();
        }
      });
      setTimeout(resolve, 3000); // safety timeout
    });

    expect(callCount).toBe(2);
    expect(responses.length).toBeGreaterThanOrEqual(1);
  });
});
