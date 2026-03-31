// Factory for mocking OpenRouter fetch responses

function makeOpenRouterResponse(content) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{ message: { content: typeof content === 'string' ? content : JSON.stringify(content) } }],
      model: 'test-model',
    }),
    text: async () => '',
  };
}

const presets = {
  MOVE: makeOpenRouterResponse({ thoughts: 'Going up', action: 'up' }),
  MOVE_STAY: makeOpenRouterResponse({ thoughts: 'Staying put', action: 'stay' }),
  MOVE_HIDE: makeOpenRouterResponse({ thoughts: 'Hiding now', action: 'hide' }),
  MESSAGE_ACCEPT: makeOpenRouterResponse({ thoughts: 'Will accept', human_message: { decision: 'accept', text: '' } }),
  MESSAGE_REJECT: makeOpenRouterResponse({ thoughts: 'Will reject', human_message: { decision: 'reject', text: '' } }),
  MESSAGE_BLOCK: makeOpenRouterResponse({ thoughts: 'Blocking', human_message: { decision: 'block', text: '' } }),
  REPLACEMENT_DECLINE: makeOpenRouterResponse({ thoughts: 'Not replacing', replacement: 'decline' }),
  REPLACEMENT_ACCEPT: makeOpenRouterResponse({ thoughts: 'Accepting replacement', replacement: 'accept' }),
  TURN_ON: makeOpenRouterResponse({ thoughts: 'Turning on', action: 'turn_on' }),
  HTTP_ERROR: { ok: false, status: 500, text: async () => 'Internal Server Error', json: async () => ({}) },
};

// Returns a jest mock function that resolves to the given preset on each call.
// Pass an array to cycle through multiple responses in order.
function mockFetch(responseOrArray) {
  const responses = Array.isArray(responseOrArray) ? responseOrArray : [responseOrArray];
  let i = 0;
  return jest.fn().mockImplementation(() => {
    const r = responses[i] || responses[responses.length - 1];
    i++;
    return Promise.resolve(r);
  });
}

module.exports = { makeOpenRouterResponse, presets, mockFetch };
