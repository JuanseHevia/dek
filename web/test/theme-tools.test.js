// The agent-facing surface: the tool catalogue the MCP bridge advertises has to
// match the tools the shell actually implements, and the diagnostics the tools
// return have to be true.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { missingVars, applyThemeToRaw, captureSystem, createTheme, currentSystem, TOKEN_GUIDE, DEFAULT_SYSTEM, normalizeSystem } from '../src/theme.js';
import { DECK } from './helpers.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const shellSource = fs.readFileSync(path.join(root, 'web/src/main.js'), 'utf8');
const bridgeSource = fs.readFileSync(path.join(root, 'mcp/dek-mcp.js'), 'utf8');
const guideSource = fs.readFileSync(path.join(root, 'docs/DECK_FORMAT.md'), 'utf8');

/** Tool names the bridge advertises to the client. */
function bridgeTools() {
  const block = bridgeSource.slice(bridgeSource.indexOf('const TOOLS = ['), bridgeSource.indexOf('const RESOURCES'));
  return Array.from(block.matchAll(/^\s{2}\{?\s*\n?\s*name: '([\w_]+)'/gm)).map((m) => m[1]);
}

/** Tool names the shell implements, from the TOOLS map it exposes over rpc. */
function shellTools() {
  const start = shellSource.indexOf('const TOOLS = {');
  const block = shellSource.slice(start, shellSource.indexOf('\nasync function rpc(', start));
  return Array.from(block.matchAll(/^ {2}(?:async )?([a-z_][\w]*)\(/gm)).map((m) => m[1]);
}

const THEME_TOOLS = [
  'list_themes', 'list_theme_tokens', 'get_theme_system', 'preview_theme_css', 'create_theme',
  'update_theme', 'delete_theme', 'duplicate_theme', 'revert_theme', 'apply_theme', 'remove_theme',
  'capture_theme', 'export_theme',
];

test('the bridge advertises every design-system tool', () => {
  const names = bridgeTools();
  for (const t of THEME_TOOLS) assert.ok(names.includes(t), `${t} missing from the MCP catalogue`);
});

test('the shell implements every tool the bridge advertises', () => {
  const shell = shellTools();
  const missing = bridgeTools().filter((t) => !shell.includes(t) && !t.startsWith('snapshot_'));
  assert.deepEqual(missing, [], 'tools the agent can call but the shell cannot run');
});

test('the shell exposes no design-system tool the bridge hides', () => {
  const advertised = bridgeTools();
  const hidden = shellTools().filter((t) => /theme/.test(t) && !advertised.includes(t));
  assert.deepEqual(hidden, [], 'implemented but unreachable over MCP');
});

test('every advertised design-system tool has a description worth reading', () => {
  for (const name of THEME_TOOLS) {
    const m = new RegExp(`name: '${name}',\\s*\\n?\\s*description: '((?:[^'\\\\]|\\\\.)*)'`).exec(bridgeSource);
    assert.ok(m, `${name} has no description`);
    assert.ok(m[1].length > 60, `${name}'s description is too thin to guide a caller`);
  }
});

test('the token guide names every group the default system has', () => {
  for (const group of Object.keys(DEFAULT_SYSTEM)) {
    assert.ok(TOKEN_GUIDE[group], `list_theme_tokens does not explain "${group}"`);
  }
  for (const group of Object.keys(TOKEN_GUIDE)) {
    assert.ok(group in DEFAULT_SYSTEM, `the guide describes "${group}", which is not a token group`);
  }
});

test('the deck format guide documents the design-system contract agents rely on', () => {
  for (const needle of ['dek-theme', 'apply_theme', 'create_theme', 'list_theme_tokens', 'dek-chart']) {
    assert.ok(guideSource.includes(needle), `DECK_FORMAT.md never mentions ${needle}`);
  }
});

test('missingVars finds the variables a foreign system would leave unresolved', () => {
  const deck = DECK.replace('--bg: #101014;', '--bg: #101014; --paper: #fff;')
    .replace('section {', 'section { background: var(--paper); border-color: var(--nowhere);');
  const orphans = missingVars(deck, {});
  assert.ok(orphans.includes('--nowhere'), 'a variable nothing declares is reported');
  assert.ok(!orphans.includes('--paper'), 'a variable the deck itself declares is not reported');
  assert.ok(!orphans.includes('--bg'), 'a variable the system compiles is not reported');
});

test('a variable with a fallback is not treated as missing', () => {
  const deck = DECK.replace('section {', 'section { gap: var(--nope, 12px);');
  assert.equal(missingVars(deck, {}).includes('--nope'), false);
});

test('missingVars ignores what the theme block itself declares, since that block is replaced', () => {
  const dressed = applyThemeToRaw(DECK, { css: ':root { --only-here: 4px; }' });
  const withUse = dressed.replace('<section id="s-cover"', '<section id="s-cover" style="margin: var(--only-here)"');
  assert.ok(missingVars(withUse, {}).includes('--only-here'), 'swapping systems would strip it');
});

test('a captured system leaves its own deck with nothing unresolved', () => {
  assert.deepEqual(missingVars(DECK, captureSystem(DECK)), []);
});

test('applying a system a deck was captured from is idempotent', () => {
  const { theme } = createTheme(null, { name: 'From deck', system: captureSystem(DECK) });
  const once = applyThemeToRaw(DECK, theme);
  const twice = applyThemeToRaw(once, theme);
  assert.equal(once, twice, 'a second apply changes nothing');
});

test('a system round-trips through JSON unchanged, so the library file is lossless', () => {
  const s = normalizeSystem(captureSystem(DECK));
  assert.deepEqual(JSON.parse(JSON.stringify(s)), s);
  assert.deepEqual(currentSystem(createTheme(null, { name: 'x', system: s }).theme), s);
});
