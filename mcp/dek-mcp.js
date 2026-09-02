#!/usr/bin/env node
// Dek MCP bridge — connects Claude Code / Claude Desktop to the running Dek
// app. Stdio JSON-RPC on this end; the app's loopback HTTP API on the other
// (port + bearer token from ~/Library/Application Support/Dek/agent.json).
// No dependencies.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');

const STATE = path.join(os.homedir(), 'Library', 'Application Support', 'Dek', 'agent.json');

let clientName = 'Agent';

function author() {
  const pretty = { 'claude-code': 'Claude Code', 'claude-ai': 'Claude Desktop', 'claude-desktop': 'Claude Desktop', claude: 'Claude', cursor: 'Cursor', codex: 'Codex' };
  return pretty[clientName.toLowerCase()] || clientName;
}

async function app(method, endpoint, body) {
  let state;
  try {
    state = JSON.parse(fs.readFileSync(STATE, 'utf8'));
  } catch {
    throw new Error('Dek is not running. Open the Dek app first (it needs a deck open or use create_deck), then try again.');
  }
  let res;
  try {
    res = await fetch(`http://127.0.0.1:${state.port}${endpoint}`, {
      method,
      headers: { Authorization: `Bearer ${state.token}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('Dek is not reachable (it may have quit). Open the Dek app, then try again.');
  }
  const text = await res.text();
  if (!res.ok) throw new Error(`Dek returned ${res.status}: ${text}`);
  return text;
}

async function rpc(tool, args) {
  const text = await app('POST', '/rpc', { tool, args: args || {}, author: author() });
  let out;
  try { out = JSON.parse(text); } catch { throw new Error(`Dek returned unreadable JSON: ${text.slice(0, 200)}`); }
  if (!out.ok) throw new Error(out.error || 'unknown error');
  return out.result;
}

// ---- tool catalogue ----

const SLIDE = { type: ['integer', 'string'], description: 'Slide number (1-based) or slide id (e.g. "s-cover"). Omit for the current slide.' };

const TOOLS = [
  // read
  {
    name: 'get_deck',
    description: 'Overview of the deck open in Dek: path, title, canvas size, default transition, every slide (number, id, title, notes excerpt, fragment count), components, theme variables and the current slide. Call this first.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_slide',
    description: 'Full HTML of one slide (the <section> element) plus its notes, title and fragment count. Read a slide before editing it so your selectors and replacements match.',
    inputSchema: { type: 'object', properties: { slide: SLIDE }, additionalProperties: false },
  },
  {
    name: 'get_source',
    description: 'Raw source: part="head" (inner HTML of <head>: styles, links, meta), "styles" (only the CSS), "body" (inner HTML of <body>) or "full" (the whole file).',
    inputSchema: { type: 'object', properties: { part: { type: 'string', enum: ['head', 'styles', 'body', 'full'] } }, additionalProperties: false },
  },
  {
    name: 'get_elements',
    description: 'Outer HTML of the elements matching a CSS selector inside a slide (max `limit`, default 20).',
    inputSchema: { type: 'object', properties: { slide: SLIDE, selector: { type: 'string' }, limit: { type: 'integer' } }, required: ['selector'], additionalProperties: false },
  },
  {
    name: 'get_theme',
    description: 'The deck\'s design tokens: CSS custom properties defined on :root, font families, color literals and linked stylesheets. Use it to stay consistent with the existing look.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'list_components',
    description: 'Reusable components defined in the deck as <template data-dek-component="name"> with their {{vars}}.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_state',
    description: 'What Dek is showing right now: current slide, fragment step, slide count, whether it is presenting.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_format_guide',
    description: 'The Dek deck format guide: canvas, slides, notes, fragments, auto-animate, enter animations, charts, CSS 3D, components, theme variables. Read it before writing a deck from scratch.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'snapshot_slide',
    description: 'Render a slide exactly as the audience sees it and return the PNG (also saved to disk). Default: the current slide with all fragments shown; pass step=0 for the initial state or a fragment step. Use it to check layout, overflow, contrast and typography after each edit.',
    inputSchema: {
      type: 'object',
      properties: {
        slide: SLIDE,
        step: { type: ['integer', 'string'], description: 'Fragment step to show (0 = none, "last" = all). Default "last".' },
        settle: { type: 'integer', description: 'Milliseconds to wait for transitions/animations before capturing (default 900).' },
        out: { type: 'string', description: 'Optional absolute .png path to write to.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'snapshot_window',
    description: 'Screenshot of the whole Dek window (window="main", the default, or "presenter"): chrome included. For checking what the user sees or debugging Dek itself, not for judging slides (use snapshot_slide).',
    inputSchema: { type: 'object', properties: { window: { type: 'string', enum: ['main', 'presenter'] }, command: { type: 'string', description: 'Optional shell command to run first (same names as the menus): settings, agent, nav, overview, edit, palette, shortcuts, closeOverlays.' }, out: { type: 'string' } }, additionalProperties: false },
  },
  {
    name: 'snapshot_overview',
    description: 'Render the light table (thumbnails of every slide) as one PNG: the fastest way to judge the deck as a whole.',
    inputSchema: { type: 'object', properties: { out: { type: 'string' } }, additionalProperties: false },
  },
  // write
  {
    name: 'add_slide',
    description: 'Insert a slide. `html` is a <section> (or its inner HTML; Dek wraps it and adds an id). Position: `after` a slide (default: after the current one), `before` a slide, or `at` a 1-based position. Optionally build it from a component (`component` + `vars`). Returns the new slide number and id.',
    inputSchema: {
      type: 'object',
      properties: {
        html: { type: 'string' },
        component: { type: 'string' },
        vars: { type: 'object', additionalProperties: true },
        after: SLIDE, before: SLIDE, at: { type: 'integer' },
        notes: { type: 'string', description: 'Speaker notes (text or HTML)' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'update_slide',
    description: 'Replace a slide\'s HTML (`html`, a full <section>; its id is preserved), and/or set its notes, and/or set attributes on the <section> (e.g. {"data-transition":"zoom","class":"dark"}; null removes).',
    inputSchema: {
      type: 'object',
      properties: { slide: SLIDE, html: { type: 'string' }, notes: { type: 'string' }, attrs: { type: 'object', additionalProperties: true } },
      additionalProperties: false,
    },
  },
  { name: 'delete_slide', description: 'Delete a slide. The user can undo with ⌘Z.', inputSchema: { type: 'object', properties: { slide: SLIDE }, additionalProperties: false } },
  { name: 'move_slide', description: 'Move a slide to a 1-based position.', inputSchema: { type: 'object', properties: { slide: SLIDE, to: { type: 'integer' } }, required: ['to'], additionalProperties: false } },
  { name: 'duplicate_slide', description: 'Duplicate a slide right after itself (new id).', inputSchema: { type: 'object', properties: { slide: SLIDE }, additionalProperties: false } },
  { name: 'set_notes', description: 'Set (or clear with "") the speaker notes of a slide.', inputSchema: { type: 'object', properties: { slide: SLIDE, notes: { type: 'string' } }, required: ['notes'], additionalProperties: false } },
  {
    name: 'add_element',
    description: 'Insert HTML into a slide: appended to the <section> by default, or relative to `selector` with position append | prepend | before | after | replace.',
    inputSchema: {
      type: 'object',
      properties: { slide: SLIDE, html: { type: 'string' }, selector: { type: 'string' }, position: { type: 'string', enum: ['append', 'prepend', 'before', 'after', 'replace'] } },
      required: ['html'], additionalProperties: false,
    },
  },
  {
    name: 'update_element',
    description: 'Edit the first element matching `selector` in a slide (or every match with all=true): replace its outer `html`, or set `inner` HTML, `text`, `attrs` (null removes), inline `style` properties, `add_class`, `remove_class`.',
    inputSchema: {
      type: 'object',
      properties: {
        slide: SLIDE, selector: { type: 'string' }, html: { type: 'string' }, inner: { type: 'string' }, text: { type: 'string' },
        attrs: { type: 'object', additionalProperties: true }, style: { type: 'object', additionalProperties: true },
        add_class: { type: 'string' }, remove_class: { type: 'string' }, all: { type: 'boolean' },
      },
      required: ['selector'], additionalProperties: false,
    },
  },
  { name: 'delete_element', description: 'Remove the first element matching `selector` in a slide (all=true removes every match).', inputSchema: { type: 'object', properties: { slide: SLIDE, selector: { type: 'string' }, all: { type: 'boolean' } }, required: ['selector'], additionalProperties: false } },
  {
    name: 'set_theme',
    description: 'Upsert design tokens as CSS custom properties on :root in a <style id="dek-theme"> block (created if missing). Keys with or without the leading "--"; null removes a variable. Re-skins every slide that uses the variables.',
    inputSchema: { type: 'object', properties: { vars: { type: 'object', additionalProperties: true } }, required: ['vars'], additionalProperties: false },
  },
  {
    name: 'append_style',
    description: 'Append a <style> block to <head> (or replace the block with the given `id`). Use for slide-specific CSS without rewriting the whole head.',
    inputSchema: { type: 'object', properties: { css: { type: 'string' }, id: { type: 'string' } }, required: ['css'], additionalProperties: false },
  },
  { name: 'set_head', description: 'Replace the inner HTML of <head> entirely (title, meta, styles, links, scripts). Prefer append_style / set_theme for smaller changes.', inputSchema: { type: 'object', properties: { html: { type: 'string' } }, required: ['html'], additionalProperties: false } },
  { name: 'set_title', description: 'Set the deck title (<title>).', inputSchema: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'], additionalProperties: false } },
  {
    name: 'add_component',
    description: 'Define (or redefine) a reusable component: HTML with {{var}} placeholders stored as <template data-dek-component="name">. Instances placed with use_component live=true update when the definition changes.',
    inputSchema: { type: 'object', properties: { name: { type: 'string' }, description: { type: 'string' }, html: { type: 'string' } }, required: ['name', 'html'], additionalProperties: false },
  },
  {
    name: 'use_component',
    description: 'Place a component on a slide. Default: a filled-in copy of its HTML. live=true places a linked instance (<div data-dek-use>) that follows later changes to the component. `selector`/`position` as in add_element.',
    inputSchema: {
      type: 'object',
      properties: { slide: SLIDE, name: { type: 'string' }, vars: { type: 'object', additionalProperties: true }, live: { type: 'boolean' }, selector: { type: 'string' }, position: { type: 'string' } },
      required: ['name'], additionalProperties: false,
    },
  },
  { name: 'write_deck', description: 'Replace the entire file. Use only for a from-scratch rewrite; slide-level tools keep the user\'s undo history fine-grained.', inputSchema: { type: 'object', properties: { html: { type: 'string' } }, required: ['html'], additionalProperties: false } },
  {
    name: 'create_deck',
    description: 'Create a new deck file and open it in Dek. Without `html`, the built-in blank template is used (or template="empty" for a bare skeleton). Returns once the file is written.',
    inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'Absolute path ending in .html' }, title: { type: 'string' }, template: { type: 'string', enum: ['blank', 'empty'] }, html: { type: 'string' } }, required: ['path'], additionalProperties: false },
  },
  { name: 'open_deck', description: 'Open an existing .html deck in Dek (absolute path). Claude Design exports and pages of loose slides are imported automatically into a “<name> (Dek).html” file next to the original.', inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false } },
  {
    name: 'import_deck',
    description: 'Convert a foreign HTML deck into Dek\'s format and open it: Claude Design “standalone” exports (bundled pages with a deck-stage component) are unpacked, fonts inlined, slides lifted to top-level <section>s, speaker notes kept; pages whose slides are .slide / [data-slide] / <article> children are wrapped. Writes “<name> (Dek).html” next to the source (or to `out`) and leaves the original untouched.',
    inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'Absolute path of the file to import' }, out: { type: 'string', description: 'Optional absolute .html path for the converted deck' } }, required: ['path'], additionalProperties: false },
  },
  // drive
  { name: 'goto', description: 'Show a slide (and optionally a fragment step) on the stage.', inputSchema: { type: 'object', properties: { slide: SLIDE, step: { type: ['integer', 'string'] } }, additionalProperties: false } },
  { name: 'navigate', description: 'Step the presentation: next | prev | first | last.', inputSchema: { type: 'object', properties: { action: { type: 'string', enum: ['next', 'prev', 'first', 'last'] } }, required: ['action'], additionalProperties: false } },
  { name: 'present', description: 'Control presenting: start (fullscreen from the current slide), from_start, stop, or presenter (open the presenter view).', inputSchema: { type: 'object', properties: { action: { type: 'string', enum: ['start', 'from_start', 'stop', 'presenter'] } }, additionalProperties: false } },
  { name: 'overview', description: 'Open or close the light table in the app.', inputSchema: { type: 'object', properties: { open: { type: 'boolean' } }, additionalProperties: false } },
];

const RESOURCES = [
  { uri: 'dek://format-guide', name: 'Dek deck format guide', description: 'How to write a Dek deck (HTML sections, fragments, auto-animate, charts, 3D, components).', mimeType: 'text/markdown' },
];

const PROMPTS = [
  {
    name: 'build-deck',
    description: 'Create a complete, highly visual deck about a topic in Dek.',
    arguments: [{ name: 'topic', description: 'What the deck is about (and for whom)', required: true }, { name: 'slides', description: 'Approximate number of slides', required: false }],
  },
  {
    name: 'polish-deck',
    description: 'Review the open deck slide by slide with snapshots and raise its visual quality.',
    arguments: [],
  },
];

function promptText(name, args) {
  if (name === 'build-deck') {
    return `Build a deck in Dek about: ${args.topic || '(topic)'}.\n\nSteps: call get_format_guide once, then get_deck (create one with create_deck if none is open). Decide a theme first: set_theme with a small palette on tinted neutrals, a type scale, and put shared pieces in add_component. Write ${args.slides || '8–12'} slides with add_slide, one idea each, big type, real hierarchy; use fragments only where order matters, auto-animate for continuity, dek-chart for numbers. After every two or three slides call snapshot_slide and fix what you see (overflow, weak contrast, orphaned lines, crowded layouts). Finish with snapshot_overview and a short summary of the deck's structure and the theme variables you set.`;
  }
  return 'Review the deck open in Dek. Call get_deck, then snapshot_overview, then snapshot_slide for each slide. For every slide, note layout, hierarchy, contrast, spacing, and motion problems; fix them with update_element / update_slide / set_theme; re-snapshot to confirm. Keep the deck\'s existing voice and theme unless it is broken. End with a list of what changed.';
}

// ---- tool execution ----

function pretty(v) {
  return typeof v === 'string' ? v : JSON.stringify(v, null, 2);
}

async function callTool(name, args) {
  if (!TOOLS.some((t) => t.name === name)) throw new Error(`Unknown tool: ${name}`);
  if (name === 'snapshot_slide' || name === 'snapshot_overview' || name === 'snapshot_window') {
    const result = await rpc(name, args);
    const content = [];
    try {
      const png = fs.readFileSync(result.path);
      content.push({ type: 'image', data: png.toString('base64'), mimeType: 'image/png' });
    } catch { /* fall through to text only */ }
    const label = name === 'snapshot_slide'
      ? `Slide ${result.n}${result.title ? ` (“${result.title}”)` : ''}, fragment step ${result.step}. Saved to ${result.path}.`
      : name === 'snapshot_window' ? `The ${result.window} window. Saved to ${result.path}.`
      : `Light table of the whole deck. Saved to ${result.path}.`;
    content.push({ type: 'text', text: label });
    return { content };
  }
  const result = await rpc(name, args);
  if (name === 'get_slide' && result && result.html) {
    return { content: [{ type: 'text', text: `slide ${result.n} · id ${result.id || '(none)'} · ${result.fragments} fragment step(s)${result.transition ? ` · transition ${result.transition}` : ''}\n\n${result.html}\n\nnotes: ${result.notes || '(none)'}` }] };
  }
  return { content: [{ type: 'text', text: pretty(result) }] };
}

// ---- JSON-RPC over stdio (newline-delimited) ----

const out = (msg) => process.stdout.write(JSON.stringify(msg) + '\n');
const rl = readline.createInterface({ input: process.stdin, terminal: false });
let chain = Promise.resolve();
rl.on('line', (line) => { chain = chain.then(() => handle(line)).catch(() => {}); });

async function handle(line) {
  line = line.trim();
  if (!line) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  const { id, method, params } = msg;
  const reply = (result) => id !== undefined && out({ jsonrpc: '2.0', id, result });
  const fail = (code, message) => id !== undefined && out({ jsonrpc: '2.0', id, error: { code, message } });

  try {
    switch (method) {
      case 'initialize':
        clientName = (params && params.clientInfo && params.clientInfo.name) || clientName;
        app('POST', '/seen', { author: author() }).catch(() => {});
        reply({
          protocolVersion: (params && params.protocolVersion) || '2024-11-05',
          capabilities: { tools: {}, resources: {}, prompts: {} },
          serverInfo: { name: 'dek', version: '0.1.0' },
          instructions: 'Dek presents HTML decks. Use get_deck to see what is open, get_format_guide before writing slides, and snapshot_slide after edits to check them visually. Every write lands in the user\'s file immediately and is undoable in the app.',
        });
        break;
      case 'notifications/initialized':
      case 'notifications/cancelled':
        break;
      case 'ping':
        reply({});
        break;
      case 'tools/list':
        reply({ tools: TOOLS });
        break;
      case 'tools/call': {
        try {
          reply(await callTool(params.name, params.arguments || {}));
        } catch (e) {
          reply({ content: [{ type: 'text', text: String(e.message || e) }], isError: true });
        }
        break;
      }
      case 'resources/list':
        reply({ resources: RESOURCES });
        break;
      case 'resources/read': {
        if (params && params.uri === 'dek://format-guide') {
          const text = await rpc('get_format_guide', {});
          reply({ contents: [{ uri: params.uri, mimeType: 'text/markdown', text }] });
        } else fail(-32602, `Unknown resource: ${params && params.uri}`);
        break;
      }
      case 'prompts/list':
        reply({ prompts: PROMPTS });
        break;
      case 'prompts/get': {
        const p = PROMPTS.find((x) => x.name === (params && params.name));
        if (!p) { fail(-32602, `Unknown prompt: ${params && params.name}`); break; }
        reply({ description: p.description, messages: [{ role: 'user', content: { type: 'text', text: promptText(p.name, (params && params.arguments) || {}) } }] });
        break;
      }
      default:
        if (id !== undefined) fail(-32601, `Method not found: ${method}`);
    }
  } catch (e) {
    fail(-32603, String(e.message || e));
  }
}

rl.on('close', () => { chain.finally(() => process.exit(0)); });
