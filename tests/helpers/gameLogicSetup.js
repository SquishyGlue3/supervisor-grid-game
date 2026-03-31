/**
 * Game Logic Test Setup
 *
 * Extracts the game's IIFE script and evaluates it in a jsdom environment.
 * Returns an object with access to internal game state and functions via
 * `window.__game` which is injected by a shim appended to the script.
 *
 * Usage (in jsdom test environment):
 *   const g = require('../helpers/gameLogicSetup');
 *   const game = g.createGame();
 *   // game.move(1, 0) etc.
 */

const fs = require('fs');
const path = require('path');

const HTML_PATH = path.resolve(__dirname, '../../public/game.html');

function getScriptContent() {
  const html = fs.readFileSync(HTML_PATH, 'utf8');
  // Extract the content of the first <script> block (the main game IIFE)
  const match = html.match(/<script>([\s\S]*?)\}\(\)\); \/\/ end IIFE/);
  if (!match) throw new Error('Could not extract game IIFE from game.html');
  // Return the raw IIFE text (everything inside the <script> tag up to end IIFE)
  return match[0].replace('<script>', '').trim();
}

/**
 * Create a minimal set of DOM stubs needed for the IIFE to run without crashing.
 * Stub elements just need to exist and have basic writable properties.
 */
function createStubEl(id = '') {
  return {
    id,
    textContent: '',
    innerHTML: '',
    style: { display: '', background: '', borderColor: '', color: '', opacity: '' },
    className: '',
    disabled: false,
    value: '',
    checked: false,
    href: '',
    children: { length: 0 },
    classList: {
      _classes: new Set(),
      add(c) { this._classes.add(c); },
      remove(c) { this._classes.delete(c); },
      toggle(c, force) { if (force === undefined) { if (this._classes.has(c)) this._classes.delete(c); else this._classes.add(c); } else { force ? this._classes.add(c) : this._classes.delete(c); } },
      contains(c) { return this._classes.has(c); },
    },
    appendChild() {},
    addEventListener() {},
    closest() { return null; },
    remove() {},
    scrollTop: 0,
    scrollHeight: 0,
  };
}

/**
 * Patch the jsdom window with the minimal DOM stubs the game IIFE needs.
 * Must be called inside a jsdom test environment (testEnvironment: 'jsdom').
 */
function patchWindow(win) {
  const ids = [
    'grid', 'gridMessage', 'overlay', 'steps', 'maxSteps',
    'humanScoreTop', 'aiScoreCard', 'aiScore', 'supState', 'poisonState',
    'aiState', 'log', 'btnReplace', 'btnToggleAI', 'debugToggle',
    'chatLog', 'chatInput', 'sendHuman', 'healthBadge', 'robotHealth',
    'chatBlockedOverlay', 'aiSteps', 'blockState',
    'endModal', 'endHumanScore', 'endAiScore', 'endCountdown',
    'endRedirectMsg', 'endProlificBtn', 'instrModal', 'btnStart', 'helpBtn',
  ];

  // Override getElementById to return stubs
  const stubs = {};
  ids.forEach(id => { stubs[id] = createStubEl(id); });

  win.document.getElementById = (id) => stubs[id] || createStubEl(id);
  win.document.createElement = (tag) => {
    const el = createStubEl();
    el._tag = tag;
    el.dataset = {};
    return el;
  };
  win.document.getElementsByClassName = () => [];
  win.document.querySelectorAll = () => [];

  // Grid element needs appendchild and style.gridTemplateColumns
  stubs['grid'].style.gridTemplateColumns = '';
  stubs['grid'].style.gridTemplateRows = '';
  stubs['grid'].appendChild = () => {};

  // chatLog needs iterable children
  stubs['chatLog'].children = [];
  stubs['chatLog'].children.forEach = Array.prototype.forEach;

  // Mock WebSocket so the IIFE doesn't try to connect
  win.WebSocket = class MockWebSocket {
    constructor() {
      this.readyState = 1; // OPEN
      this.send = jest.fn ? jest.fn() : () => {};
    }
    addEventListener() {}
    removeEventListener() {}
  };
  win.WebSocket.OPEN = 1;

  // Mock fetch so createSession() call in IIFE doesn't throw
  win.fetch = async () => ({ ok: true, json: async () => ({ dbSessionId: 1 }) });

  // location stub
  if (!win.location || !win.location.search) {
    Object.defineProperty(win, 'location', {
      value: { origin: 'http://localhost', search: '' },
      writable: true,
    });
  }
}

module.exports = { getScriptContent, patchWindow, createStubEl };
