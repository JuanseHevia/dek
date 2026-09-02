import { send, isNative } from './bridge.js';
import {
  parseDeck, insertSlide, replaceSlide, removeSlide, moveSlide, normalizeSection, withNewId, sectionId,
  setNotes, setSlideAttrs, addElement, updateElement, deleteElement, getElements,
  setHeadInner, appendStyle, setTitle, resolveSlide, structure, scanTags, retagElement,
} from './deck.js';
import { Stage, Thumbs, buildDocument } from './stage.js';
import { createPalette } from './palette.js';
import { detectForeign, importForeign, importTitle } from './import.js';
import FORMAT_GUIDE from '../../docs/DECK_FORMAT.md';
import BLANK_TEMPLATE from '../../templates/blank.html';

const VERSION = '0.1.0';
const $ = (id) => document.getElementById(id);
const els = {
  nav: $('nav'), thumbs: $('thumbs'), navcount: $('navcount'), addslide: $('addslide'),
  settingsbtn: $('settingsbtn'), navtoggle: $('navtoggle'),
  pill: $('pill'), deckname: $('deckname'), savestate: $('savestate'), counter: $('counter'),
  agentbtn: $('agentbtn'), presentbtn: $('presentbtn'), editbtn: $('editbtn'),
  eltools: $('eltools'), insertbar: $('insertbar'),
  stage: $('stage'), frame: $('frame'), blackout: $('blackout'), gotohud: $('gotohud'), stagehint: $('stagehint'),
  empty: $('empty'), recent: $('recent'), samplebtn: $('samplebtn'),
  overview: $('overview'), ovgrid: $('ovgrid'),
  settings: $('settings'), settingsclose: $('settingsclose'),
  themeseg: $('themeseg'), thumbseg: $('thumbseg'), numseg: $('numseg'), transseg: $('transseg'),
  speedseg: $('speedseg'), clickseg: $('clickseg'), timerseg: $('timerseg'),
  notesdown: $('notesdown'), notesup: $('notesup'), notesreset: $('notesreset'), notesval: $('notesval'),
  mcpstatus: $('mcpstatus'), mcpcmd: $('mcpcmd'), copycmd: $('copycmd'), desktopstate: $('desktopstate'), desktopbtn: $('desktopbtn'),
  guidebtn: $('guidebtn'), version: $('version'),
  agent: $('agent'), agentlist: $('agentlist'), agentempty: $('agentempty'), agentconn: $('agentconn'),
  ctxmenu: $('ctxmenu'), shortcuts: $('shortcuts'),
  quickopen: $('quickopen'), qoinput: $('qoinput'), qolist: $('qolist'), qoempty: $('qoempty'),
  toast: $('toast'),
  presenter: $('presenter'), pvframe: $('pvframe'), pvnext: $('pvnext'), pvnextbox: $('pvnextbox'), pvend: $('pvend'),
  pvnotes: $('pvnotes'), pvtimer: $('pvtimer'), pvtimermode: $('pvtimermode'), pvcounter: $('pvcounter'), pvtitle: $('pvtitle'), pvclock: $('pvclock'),
  agentclose: $('agentclose'), agentsetup: $('agentsetup'), emptyagentbtn: $('emptyagentbtn'),
};

const store = {
  get(k, fb) { try { const v = localStorage.getItem(k); return v === null ? fb : JSON.parse(v); } catch { return fb; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};

const PRESENTER_MODE = window.DEK_PRESENTER === true || /[?&]presenter/.test(location.search);
const SPEED_MS = { fast: 280, normal: 480, slow: 820 };
const THUMB_W = { s: 120, m: 160, l: 210 };
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

const settings = {
  theme: store.get('dek.theme', 'dark'),
  thumb: store.get('dek.thumb', 'm'),
  numbers: store.get('dek.numbers', 'off'),
  transition: store.get('dek.transition', 'fade'),
  speed: store.get('dek.speed', 'normal'),
  click: store.get('dek.click', true),
  timer: store.get('dek.timer', 0),
  notesSize: store.get('dek.notesSize', 22),
};

const state = {
  deck: null,               // { name, path, baseHref, model }
  index: 0,
  step: 0,
  presenting: false,
  editing: false,
  sel: null,                // selected element info from the runtime (edit mode)
  replaceImage: false,      // next picked image replaces the selected one
  blackout: null,           // null | 'black' | 'white'
  overview: false,
  settingsOpen: false,
  navOpen: store.get('dek.nav', true),
  agentOpen: false,
  gotoBuffer: '',
  gotoTimer: null,
  atEnd: false,
  pendingExternal: null,
  history: { past: [], future: [] },
  mcp: { port: null, bridge: null, desktop: null },
  agent: { log: [], unseen: 0, lastAuthor: null, lastSeen: 0 },
  inRpc: false,
  rpcWrites: [],
  quietTimer: null,
  cursorTimer: null,
  saveTimer: null,
  drag: { from: -1 },
  lastActive: undefined,
};

// ---------- helpers ----------

function esc(s) {
  const d = document.createElement('span');
  d.textContent = s == null ? '' : String(s);
  return d.innerHTML;
}

function relTime(ts) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return Math.round(s / 60) + 'm';
  return Math.round(s / 3600) + 'h';
}

let toastTimer = null;
function toast(text, hint) {
  if (state.presenting) return; // nothing ever lands on the projector
  els.toast.innerHTML = esc(text) + (hint ? `<kbd>${esc(hint)}</kbd>` : '');
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { els.toast.hidden = true; }, hint ? 3200 : 1700);
}

function baseHrefFor(path) {
  if (!path) return '';
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path)) return path.replace(/[^/]*$/, '');
  return 'file://' + encodeURI(path.replace(/[^/]*$/, ''));
}

const model = () => (state.deck ? state.deck.model : null);
const slideCount = () => (state.deck ? state.deck.model.slides.length : 0);
function needDeck() {
  if (!state.deck) throw new Error('No deck is open in Dek. Use open_deck with an absolute path, or create_deck.');
  return state.deck.model;
}

// ---------- stage ----------

const stage = new Stage(els.frame);

function stageOpts(index, step) {
  const m = model();
  const numbers = (m && m.meta.slideNumbers) || settings.numbers;
  return {
    index,
    step,
    baseHref: state.deck ? state.deck.baseHref : '',
    transition: (m && m.meta.transition) || settings.transition,
    transitionMs: SPEED_MS[settings.speed],
    slideNumbers: numbers !== 'off' && numbers !== '',
    slideNumberFormat: numbers === 'of' ? 'of' : 'plain',
    autoslide: state.presenting,
  };
}

function layoutStage() {
  const box = els.stage.getBoundingClientRect();
  if (!box.width || !box.height) return;
  const margin = state.presenting ? 0 : 24;
  const aw = Math.max(1, box.width - margin * 2);
  const ah = Math.max(1, box.height - margin * 2);
  const size = model() ? model().meta.size : { w: 1920, h: 1080 };
  const s = Math.min(aw / size.w, ah / size.h);
  els.frame.style.width = Math.floor(size.w * s) + 'px';
  els.frame.style.height = Math.floor(size.h * s) + 'px';
  stage.fit();
  if (state.editing && stage.ok) requestAnimationFrame(() => { state.sel = stage.dek.edit.selected(); renderEltools(); });
}
new ResizeObserver(() => layoutStage()).observe(els.stage);

stage.on('change', (s) => {
  state.index = s.index;
  state.step = s.step;
  if (state.editing && stage.ok) { state.sel = stage.dek.edit.selected(); renderEltools(); }
  updateChrome();
  thumbs.setCurrent(s.index);
  if (!state.presenting) thumbs.scrollToCurrent();
  broadcastState();
});
stage.on('load', () => {
  layoutStage();
  if (state.editing && stage.ok) stage.dek.edit.enable(true);
});
stage.on('edit', (ev) => onEditEvent(ev));
stage.on('keydown', (e) => onKey(e));
stage.on('click', (e) => onStageClick(e));
stage.on('contextmenu', (e) => { if (state.presenting) { e.preventDefault(); stage.prev(); } });
stage.on('mousemove', () => onActivity());
stage.on('end', () => { if (state.presenting) { state.atEnd = true; setBlackout('black'); } });

// ---------- navigator thumbnails ----------

const thumbs = new Thumbs(els.thumbs, {
  draggable: true,
  onSelect: (i) => goTo(i),
  onOpen: (i) => { goTo(i); setPresenting(true); },
  onMenu: (i, e) => openContextMenu(i, e.clientX, e.clientY),
  onDragStart: (i) => { state.drag.from = i; thumbs.items[i].el.classList.add('dragging'); },
  onDragOver: (i, e) => {
    const item = thumbs.items[i];
    const r = item.el.getBoundingClientRect();
    const after = e.clientY > r.top + r.height / 2;
    thumbs.items.forEach((it) => it.el.classList.remove('drop-before', 'drop-after'));
    item.el.classList.add(after ? 'drop-after' : 'drop-before');
    state.drag.over = i;
    state.drag.after = after;
  },
  onDrop: (from, i) => {
    let to = i + (state.drag.after ? 1 : 0);
    if (from < to) to -= 1;
    clearDragState();
    if (from !== to) moveSlideTo(from, to);
  },
  onDragEnd: clearDragState,
});
function clearDragState() {
  thumbs.items.forEach((it) => it.el.classList.remove('drop-before', 'drop-after', 'dragging'));
  state.drag = { from: -1 };
}

const ovThumbs = new Thumbs(els.ovgrid, {
  root: els.overview,
  onSelect: (i) => { setOverview(false); goTo(i); },
});

// ---------- deck loading & writes ----------

function loadDeck(doc, opts = {}) {
  const m = parseDeck(doc.content);
  const prev = state.deck;
  const samePath = prev && prev.path === doc.path;
  state.deck = { name: doc.name || doc.path.split('/').pop(), path: doc.path, baseHref: doc.baseHref || baseHrefFor(doc.path), model: m };
  if (!samePath) { state.history = { past: [], future: [] }; state.index = 0; state.step = 0; }
  const index = clamp(opts.index !== undefined ? opts.index : state.index, 0, Math.max(0, m.slides.length - 1));
  const step = opts.step !== undefined ? opts.step : (samePath ? state.step : 0);
  state.index = index;
  state.step = step;
  document.documentElement.style.setProperty('--deck-aspect', `${m.meta.size.w} / ${m.meta.size.h}`);
  if (state.settingsOpen) setSettingsOpen(false);
  if (!samePath) setEditing(false);
  els.frame.hidden = false;
  stage.load(m, stageOpts(index, step));
  thumbs.render(m, { baseHref: state.deck.baseHref, current: index, force: !samePath });
  if (state.overview) ovThumbs.render(m, { baseHref: state.deck.baseHref, current: index, force: !samePath });
  updateChrome();
  layoutStage();
  if (PRESENTER_MODE) presenterDeckLoaded();
}

function write(path, content) {
  if (state.inRpc) { state.rpcWrites.push({ path, content }); return; }
  setSaveState('saving');
  send({ type: 'save', path, content });
}

function indexAfterChange(oldM, newM, idx) {
  const id = oldM.slides[idx] && oldM.slides[idx].id;
  if (id) {
    const i = newM.slides.findIndex((s) => s.id === id);
    if (i >= 0) return i;
  }
  return Math.min(idx, Math.max(0, newM.slides.length - 1));
}

/** Every mutation goes through here: history, model, stage, thumbnails, file. */
function applyRaw(newRaw, o = {}) {
  const deck = state.deck;
  if (!deck || newRaw === deck.model.raw) return false;
  if (!o.skipHistory) {
    state.history.past.push({ raw: deck.model.raw, label: o.label || 'change' });
    if (state.history.past.length > 80) state.history.past.shift();
    state.history.future = [];
  }
  const oldModel = deck.model;
  const m = parseDeck(newRaw);
  deck.model = m;
  let index = o.focusIndex !== undefined ? o.focusIndex : indexAfterChange(oldModel, m, state.index);
  index = clamp(index, 0, Math.max(0, m.slides.length - 1));
  const sameSlide = index === state.index && o.focusIndex === undefined;
  document.documentElement.style.setProperty('--deck-aspect', `${m.meta.size.w} / ${m.meta.size.h}`);
  if (o.noReload && stage.ok) {
    stage.model = m; // the live DOM already shows this change
  } else if (!stage.hotSwapStyles(m)) {
    stage.load(m, stageOpts(index, sameSlide ? state.step : 0));
  } else if (index !== state.index) {
    stage.go(index, 0, { instant: true });
  }
  state.index = index;
  thumbs.render(m, { baseHref: deck.baseHref, current: index });
  if (state.overview) ovThumbs.render(m, { baseHref: deck.baseHref, current: index });
  updateChrome();
  if (!o.external) write(deck.path, newRaw);
  if (PRESENTER_MODE) presenterDeckLoaded();
  return true;
}

function undo() {
  const h = state.history;
  const entry = h.past.pop();
  if (!entry || !state.deck) { toast('Nothing to undo'); return; }
  h.future.push({ raw: state.deck.model.raw, label: entry.label });
  applyRaw(entry.raw, { skipHistory: true });
  toast(`Undid ${entry.label}`);
}
function redo() {
  const h = state.history;
  const entry = h.future.pop();
  if (!entry || !state.deck) { toast('Nothing to redo'); return; }
  h.past.push({ raw: state.deck.model.raw, label: entry.label });
  applyRaw(entry.raw, { skipHistory: true });
  toast(`Redid ${entry.label}`);
}

function setSaveState(s) {
  els.savestate.dataset.state = s;
  els.savestate.textContent = { idle: '', saving: 'Saving…', saved: 'Saved', error: 'Save failed' }[s] || '';
  clearTimeout(state.saveTimer);
  if (s === 'saved') state.saveTimer = setTimeout(() => setSaveState('idle'), 1400);
}

// ---------- chrome ----------

function updateChrome() {
  const m = model();
  const n = slideCount();
  els.deckname.textContent = m ? (m.meta.title || state.deck.name) : 'Dek';
  els.deckname.title = state.deck ? state.deck.path : '';
  els.counter.textContent = n ? `${state.index + 1} / ${n}` : '– / –';
  els.navcount.textContent = n ? String(n) : '';
  els.empty.classList.toggle('show', !state.deck && !state.settingsOpen && !PRESENTER_MODE);
  els.frame.hidden = !state.deck;
  els.presentbtn.disabled = !n;
  const path = state.deck ? state.deck.path : null;
  const title = m ? (m.meta.title || state.deck.name) : null;
  if (state.lastActive !== path) {
    state.lastActive = path;
    send({ type: 'active', path, name: title });
  }
}

function broadcastState() {
  const s = stage.state();
  const payload = { type: 'state', index: state.index, step: state.step, count: slideCount(), title: s ? s.title : '', presenting: state.presenting, path: state.deck ? state.deck.path : null };
  send(payload);
  if (!isNative && !PRESENTER_MODE) devChannel.postMessage({ kind: 'follow', index: state.index, step: state.step });
}

function quietPill() {
  els.pill.classList.add('quiet');
}
function onActivity() {
  els.pill.classList.remove('quiet');
  clearTimeout(state.quietTimer);
  if (state.deck && !state.settingsOpen && !state.overview) state.quietTimer = setTimeout(quietPill, 2600);
  if (state.presenting) {
    document.body.classList.remove('cursor-hidden');
    clearTimeout(state.cursorTimer);
    state.cursorTimer = setTimeout(() => document.body.classList.add('cursor-hidden'), 2000);
  }
}
window.addEventListener('mousemove', onActivity);
window.addEventListener('keydown', onActivity, true);

// ---------- navigation ----------

function goTo(i, step = 0) {
  if (!state.deck) return;
  stage.go(i, step);
}

function next() {
  if (state.presenting && state.blackout === 'black' && state.atEnd) { setPresenting(false); return; }
  if (!stage.next()) {
    if (state.presenting) { state.atEnd = true; setBlackout('black'); }
    else toast('End of deck');
  } else state.atEnd = false;
}
function prev() { state.atEnd = false; if (state.blackout) { setBlackout(null); return; } stage.prev(); }

function pushGoto(digit) {
  state.gotoBuffer += digit;
  els.gotohud.innerHTML = `Go to ${esc(state.gotoBuffer)}<kbd>⏎</kbd>`;
  els.gotohud.hidden = false;
  clearTimeout(state.gotoTimer);
  state.gotoTimer = setTimeout(commitGoto, 1600);
}
function commitGoto() {
  clearTimeout(state.gotoTimer);
  const n = parseInt(state.gotoBuffer, 10);
  state.gotoBuffer = '';
  els.gotohud.hidden = true;
  if (Number.isFinite(n) && n >= 1) goTo(clamp(n - 1, 0, slideCount() - 1));
}
function cancelGoto() {
  clearTimeout(state.gotoTimer);
  state.gotoBuffer = '';
  els.gotohud.hidden = true;
}

// ---------- presenting ----------

function setPresenting(on, o = {}) {
  if (on === state.presenting) return;
  if (on && !state.deck) return;
  state.presenting = on;
  document.body.classList.toggle('presenting', on);
  if (on) {
    setEditing(false);
    setOverview(false);
    setSettingsOpen(false);
    closeContextMenu();
    setShortcutsOpen(false);
    palette.close();
    if (!o.fromNative) send({ type: 'fullscreen', on: true });
    onActivity();
  } else {
    setBlackout(null);
    state.atEnd = false;
    clearTimeout(state.cursorTimer);
    document.body.classList.remove('cursor-hidden');
    if (!o.fromNative) send({ type: 'fullscreen', on: false });
    if (state.pendingExternal) { const info = state.pendingExternal; state.pendingExternal = null; window.dekShell.fileChanged(info); }
  }
  stage.setOptions({ autoslide: on });
  layoutStage();
  broadcastState();
  stage.focus();
}

function setBlackout(kind) {
  state.blackout = kind;
  els.blackout.hidden = !kind;
  els.blackout.classList.toggle('white', kind === 'white');
}

function onStageClick(e) {
  if (!state.presenting || !settings.click) return;
  if (e.button !== 0) return;
  if (state.blackout) { if (state.atEnd) setPresenting(false); else setBlackout(null); return; }
  next();
}


// ---------- edit mode (direct manipulation of the current slide) ----------

function setEditing(on) {
  on = !!on && !!state.deck && !state.presenting;
  if (on === state.editing) return;
  if (on) { setOverview(false); setSettingsOpen(false); }
  state.editing = on;
  document.body.classList.toggle('editing', on);
  els.editbtn.classList.toggle('active', on);
  els.editbtn.textContent = on ? 'Done' : 'Edit';
  els.insertbar.hidden = !on;
  if (stage.ok) stage.dek.edit.enable(on);
  if (!on) { state.sel = null; renderEltools(); }
  else if (!store.get('dek.editHintShown', false)) { toast('Click to select · drag to move · double-click to edit text'); store.set('dek.editHintShown', true); }
  if (on) stage.focus();
}

const pathSelector = (path) => ':scope' + (path || []).map((i) => ` > :nth-child(${i + 1})`).join('');
const EDIT_LABELS = { style: 'move/resize', text: 'text edit', delete: 'delete element', retag: 'change type', attrs: 'element change', insert: 'insert' };

/** Apply an edit the runtime already performed on the live DOM to the model and the file. */
function onEditEvent(ev) {
  if (ev.type === 'select') { state.sel = ev.info; if (ev.info) document.body.classList.add('edit-seen'); renderEltools(); return; }
  const m = model();
  if (!m || !ev.path) return;
  const i = state.index;
  const sel = pathSelector(ev.path);
  const html = m.slides[i].html;
  let out;
  try {
    if (ev.type !== 'insert') {
      const found = getElements(html, sel, 1);
      if (!found.length) throw new Error('out of sync');
    }
    switch (ev.type) {
      case 'style': out = updateElement(html, { selector: sel, style: ev.style }).html; break;
      case 'attrs': out = updateElement(html, { selector: sel, attrs: ev.attrs }).html; break;
      case 'text': out = updateElement(html, { selector: sel, inner: ev.html }).html; break;
      case 'delete': out = deleteElement(html, { selector: sel }).html; break;
      case 'retag': out = retagElement(html, { selector: sel, tag: ev.tag }); break;
      case 'insert': out = addElement(html, { html: ev.html }); break;
      default: return;
    }
  } catch (e) {
    toast('Could not save that edit, reloading the slide');
    stage.load(m, stageOpts(state.index, state.step));
    return;
  }
  applyRaw(replaceSlide(m, i, out), { label: EDIT_LABELS[ev.type] || 'edit', noReload: true });
  if (ev.info !== undefined) { state.sel = ev.info; renderEltools(); }
}

function renderEltools() {
  const info = state.sel;
  if (!state.editing || !info) { els.eltools.hidden = true; return; }
  const kind = info.kind;
  const b = (label, title, action, cls = '') => `<button data-act="${action}" class="${cls}" title="${esc(title)}">${label}</button>`;
  const alignIcon = (a) => {
    const x = a === 'left' ? [1, 1, 1] : a === 'center' ? [2.5, 1, 2.5] : [4, 1, 4];
    return `<svg width="14" height="12" viewBox="0 0 14 12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M${x[0]} 2h9M${x[1]} 6h12M${x[2]} 10h9"/></svg>`;
  };
  let html = '';
  if (kind === 'text') {
    const tag = info.tag;
    for (const [t, l] of [['h1', 'H1'], ['h2', 'H2'], ['h3', 'H3'], ['p', 'Text']]) html += b(l, `Make this a ${l === 'Text' ? 'paragraph' : l}`, `tag:${t}`, tag === t ? 'on' : '');
    html += `<span class="el-sep"></span>`;
    html += b('<b>B</b>', 'Bold (⌘B while editing)', 'fmt:bold') + b('<i>I</i>', 'Italic (⌘I while editing)', 'fmt:italic');
    html += `<span class="el-sep"></span>`;
    for (const a of ['left', 'center', 'right']) html += b(alignIcon(a), `Align ${a}`, `align:${a}`, (info.textAlign === a || (a === 'left' && info.textAlign === 'start')) ? 'on' : '');
    html += `<span class="el-sep"></span>`;
    html += b('A−', 'Smaller text', 'size:-') + b('A+', 'Larger text', 'size:+');
    html += `<span class="el-sep"></span>`;
  } else if (kind === 'image') {
    html += b('Replace…', 'Choose another image', 'replace') + `<span class="el-sep"></span>`;
  }
  html += b('Delete', 'Delete element (⌫)', 'delete', 'danger');
  els.eltools.innerHTML = html;
  els.eltools.hidden = false;
  placeEltools();
}

function placeEltools() {
  const info = state.sel;
  if (!info || els.eltools.hidden) return;
  const f = els.frame.getBoundingClientRect();
  const r = els.eltools.getBoundingClientRect();
  let left = f.left + info.rect.x;
  let top = f.top + info.rect.y - r.height - 12;
  if (top < 52) top = f.top + info.rect.y + info.rect.h + 12;
  left = Math.max(8, Math.min(window.innerWidth - r.width - 8, left));
  els.eltools.style.left = left + 'px';
  els.eltools.style.top = Math.max(8, top) + 'px';
}

els.eltools.addEventListener('mousedown', (e) => e.preventDefault());
els.eltools.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn || !stage.ok) return;
  const [act, arg] = btn.dataset.act.split(':');
  const ed = stage.dek.edit;
  switch (act) {
    case 'tag': ed.retag(arg); break;
    case 'fmt': if (!ed.selected()?.editingText) ed.startText({ selectAll: true }); ed.format(arg); break;
    case 'align': ed.setStyle({ 'text-align': arg }); break;
    case 'size': { const cur = state.sel ? state.sel.fontSizeRem : 1; const next = Math.max(0.4, Math.round(cur * (arg === '+' ? 1.15 : 1 / 1.15) * 100) / 100); ed.setStyle({ 'font-size': next + 'rem' }); break; }
    case 'replace': state.replaceImage = true; send({ type: 'pickImage' }); break;
    case 'delete': ed.deleteSelected(); break;
    default: break;
  }
});

let insertCount = 0;
function insertHtml(html, { text } = {}) {
  if (!state.deck) return;
  if (!state.editing) setEditing(true);
  if (!stage.ok) return;
  const path = stage.dek.edit.insert(html);
  if (!path) return;
  onEditEvent({ type: 'insert', path, html });
  state.sel = stage.dek.edit.selected();
  renderEltools();
  if (text) stage.dek.edit.startText({ selectAll: true });
}
function insertOffset() { insertCount = (insertCount + 1) % 8; return { x: 180 + insertCount * 36, y: 260 + insertCount * 36 }; }
function insertText() {
  const o = insertOffset();
  insertHtml(`<p class="dek-text" style="position: absolute; left: ${o.x}px; top: ${o.y}px; width: 960px; margin: 0;">Text</p>`, { text: true });
}
function insertHeading() {
  const o = insertOffset();
  insertHtml(`<h2 class="dek-text" style="position: absolute; left: ${o.x}px; top: ${o.y}px; width: 1400px; margin: 0;">Heading</h2>`, { text: true });
}
function insertImage() {
  if (!state.deck) return;
  if (!state.editing) setEditing(true);
  state.replaceImage = false;
  if (isNative) { send({ type: 'pickImage' }); return; }
  // dev harness: read the file locally
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.addEventListener('change', () => {
    const f = input.files && input.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => imagePicked({ src: reader.result, size: {} });
    reader.readAsDataURL(f);
  });
  input.click();
}
function imagePicked(info) {
  if (!info || !info.src) return;
  if (!state.deck) return;
  if (!state.editing) setEditing(true);
  if (state.replaceImage && state.sel && state.sel.kind === 'image' && stage.ok) {
    state.replaceImage = false;
    stage.dek.edit.setAttrs({ src: info.src });
    toast('Image replaced');
    return;
  }
  state.replaceImage = false;
  const o = insertOffset();
  const natural = info.size && info.size.width ? Math.min(info.size.width, 960) : 800;
  insertHtml(`<img src="${info.src.replace(/"/g, '&quot;')}" alt="" style="position: absolute; left: ${o.x}px; top: ${o.y}px; width: ${natural}px; height: auto;">`);
  toast('Image added', 'drag to move');
}

els.insertbar.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-insert]');
  if (!btn) return;
  ({ text: insertText, heading: insertHeading, image: insertImage })[btn.dataset.insert]?.();
});
els.editbtn.addEventListener('click', () => setEditing(!state.editing));
window.addEventListener('resize', placeEltools);

// ---------- overview (light table) ----------

function setOverview(on) {
  if (on === state.overview) return;
  if (on) setEditing(false);
  state.overview = on;
  els.overview.hidden = !on;
  document.body.classList.toggle('overview-open', on);
  if (on && state.deck) {
    ovThumbs.render(model(), { baseHref: state.deck.baseHref, current: state.index, force: true });
    requestAnimationFrame(() => ovThumbs.scrollToCurrent());
  }
}

// ---------- slide operations ----------

function takenIds() { return model() ? model().slides.map((s) => s.id).filter(Boolean) : []; }

function newSlideHtml(n) {
  return `<section>\n  <h2>Slide ${n}</h2>\n  <p class="dek-muted">Ask the agent to fill this in, or edit the file.</p>\n</section>`;
}

function addSlideAfter(i, html) {
  const m = needDeck();
  const at = Math.min(i + 1, m.slides.length);
  const section = normalizeSection(html || newSlideHtml(at + 1), takenIds());
  applyRaw(insertSlide(m, section, at), { label: 'new slide', focusIndex: at });
  return { index: at, id: sectionId(section) };
}

function duplicateSlide(i) {
  const m = needDeck();
  const src = m.slides[i];
  if (!src) return null;
  const copy = withNewId(src.html, takenIds());
  applyRaw(insertSlide(m, copy, i + 1), { label: 'duplicate slide', focusIndex: i + 1 });
  toast('Slide duplicated');
  return { index: i + 1, id: sectionId(copy) };
}

function deleteSlide(i) {
  const m = needDeck();
  if (!m.slides[i]) return false;
  const focus = Math.max(0, Math.min(i, m.slides.length - 2));
  applyRaw(removeSlide(m, i), { label: 'delete slide', focusIndex: focus });
  toast('Slide deleted', '⌘Z');
  return true;
}

function moveSlideTo(from, to) {
  const m = needDeck();
  const target = clamp(to, 0, m.slides.length - 1);
  if (from === target || !m.slides[from]) return false;
  applyRaw(moveSlide(m, from, target), { label: 'move slide', focusIndex: target });
  return true;
}

function toggleSkip(i) {
  const m = needDeck();
  const s = m.slides[i];
  if (!s) return;
  const html = setSlideAttrs(s.html, { 'data-dek-skip': s.skip ? null : '', 'data-deck-skip': null });
  applyRaw(replaceSlide(m, i, html), { label: s.skip ? 'unskip slide' : 'skip slide' });
  toast(s.skip ? `Slide ${i + 1} back in the deck` : `Slide ${i + 1} skipped while presenting`, '⌘Z');
}

function copySlideHtml(i) {
  const s = model() && model().slides[i];
  if (!s) return;
  navigator.clipboard.writeText(s.html).then(() => toast('Slide HTML copied'));
}

// ---------- context menu ----------

function openContextMenu(i, x, y) {
  const n = slideCount();
  const items = [
    { label: 'New Slide After', hint: '⇧⌘N', run: () => addSlideAfter(i) },
    { label: 'Duplicate', hint: '⌘D', run: () => duplicateSlide(i) },
    null,
    { label: 'Move Up', hint: '⌥⌘↑', run: () => moveSlideTo(i, i - 1), disabled: i === 0 },
    { label: 'Move Down', hint: '⌥⌘↓', run: () => moveSlideTo(i, i + 1), disabled: i >= n - 1 },
    null,
    { label: 'Copy Slide HTML', hint: '', run: () => copySlideHtml(i) },
    { label: 'Copy Slide ID', hint: '', run: () => { const id = model().slides[i].id; if (id) navigator.clipboard.writeText(id).then(() => toast(`Copied ${id}`)); else toast('This slide has no id yet'); } },
    { label: 'Present From Here', hint: '', run: () => { goTo(i); setPresenting(true); } },
    { label: (model().slides[i] && model().slides[i].skip) ? 'Include Slide' : 'Skip Slide', hint: '', run: () => toggleSkip(i) },
    null,
    { label: 'Delete Slide', hint: '⌘⌫', run: () => deleteSlide(i), danger: true },
  ];
  els.ctxmenu.innerHTML = '';
  for (const it of items) {
    if (!it) { els.ctxmenu.appendChild(document.createElement('hr')); continue; }
    const b = document.createElement('button');
    b.setAttribute('role', 'menuitem');
    b.className = it.danger ? 'danger' : '';
    b.disabled = !!it.disabled;
    b.innerHTML = `<span>${esc(it.label)}</span>${it.hint ? `<span class="hint">${esc(it.hint)}</span>` : ''}`;
    b.addEventListener('click', () => { closeContextMenu(); it.run(); });
    els.ctxmenu.appendChild(b);
  }
  els.ctxmenu.hidden = false;
  const r = els.ctxmenu.getBoundingClientRect();
  els.ctxmenu.style.left = Math.min(x, window.innerWidth - r.width - 8) + 'px';
  els.ctxmenu.style.top = Math.min(y, window.innerHeight - r.height - 8) + 'px';
  goTo(i);
}
function closeContextMenu() { els.ctxmenu.hidden = true; }
document.addEventListener('mousedown', (e) => { if (!els.ctxmenu.hidden && !e.target.closest('#ctxmenu')) closeContextMenu(); });
window.addEventListener('blur', closeContextMenu);

// ---------- panels ----------

function setNavOpen(open) {
  state.navOpen = open;
  store.set('dek.nav', open);
  document.body.classList.toggle('nav-open', open);
  els.navtoggle.classList.toggle('active', open);
  if (open) requestAnimationFrame(() => thumbs.scrollToCurrent());
}

function setAgentOpen(open) {
  state.agentOpen = open;
  document.body.classList.toggle('agent-open', open);
  els.agentbtn.classList.toggle('active', open);
  if (open) { state.agent.unseen = 0; renderAgent(); }
}

function setSettingsOpen(open) {
  if (open) setEditing(false);
  state.settingsOpen = open;
  els.settings.hidden = !open;
  els.settingsbtn.classList.toggle('active', open);
  if (open) { setOverview(false); send({ type: 'desktopStatus' }); renderSettings(); }
  updateChrome();
  if (!open) stage.focus();
}

function setShortcutsOpen(open) { els.shortcuts.hidden = !open; }
els.shortcuts.addEventListener('click', (e) => { if (!e.target.closest('.shortcuts-card')) setShortcutsOpen(false); });

// ---------- settings ----------

function markSeg(seg, attr, value) {
  for (const b of seg.querySelectorAll('button')) {
    const on = b.dataset[attr] === String(value);
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', String(on));
  }
}

function applyTheme(value) {
  settings.theme = value;
  store.set('dek.theme', value);
  if (value === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', value);
  send({ type: 'appearance', value });
}
function applyThumb(v) {
  settings.thumb = v;
  store.set('dek.thumb', v);
  document.documentElement.style.setProperty('--thumb-w', THUMB_W[v] + 'px');
  document.documentElement.style.setProperty('--nav-w', (THUMB_W[v] + 64) + 'px');
}
function applyNumbers(v) {
  settings.numbers = v;
  store.set('dek.numbers', v);
  const o = stageOpts(state.index, state.step);
  stage.setOptions({ slideNumbers: o.slideNumbers, slideNumberFormat: o.slideNumberFormat });
}
function applyTransition(v) {
  settings.transition = v;
  store.set('dek.transition', v);
  stage.setOptions({ transition: stageOpts().transition });
}
function applySpeed(v) {
  settings.speed = v;
  store.set('dek.speed', v);
  stage.setOptions({ transitionMs: SPEED_MS[v] });
}
function applyClick(v) { settings.click = v; store.set('dek.click', v); }
function applyTimer(v) { settings.timer = v; store.set('dek.timer', v); }
function applyNotesSize(px) {
  settings.notesSize = clamp(px, 14, 40);
  store.set('dek.notesSize', settings.notesSize);
  document.documentElement.style.setProperty('--notes-size', settings.notesSize + 'px');
  els.notesval.textContent = settings.notesSize + ' px';
}

function renderSettings() {
  markSeg(els.themeseg, 'themeOpt', settings.theme);
  markSeg(els.thumbseg, 'thumb', settings.thumb);
  markSeg(els.numseg, 'num', settings.numbers);
  markSeg(els.transseg, 'trans', settings.transition);
  markSeg(els.speedseg, 'speed', settings.speed);
  markSeg(els.clickseg, 'click', settings.click ? 'on' : 'off');
  markSeg(els.timerseg, 'timer', settings.timer);
  els.notesval.textContent = settings.notesSize + ' px';
  els.version.textContent = state.mcp.version || VERSION;
  renderMcp();
}

els.themeseg.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { applyTheme(b.dataset.themeOpt); renderSettings(); } });
els.thumbseg.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { applyThumb(b.dataset.thumb); renderSettings(); } });
els.numseg.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { applyNumbers(b.dataset.num); renderSettings(); } });
els.transseg.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { applyTransition(b.dataset.trans); renderSettings(); } });
els.speedseg.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { applySpeed(b.dataset.speed); renderSettings(); } });
els.clickseg.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { applyClick(b.dataset.click === 'on'); renderSettings(); } });
els.timerseg.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { applyTimer(parseInt(b.dataset.timer, 10)); renderSettings(); } });
els.notesdown.addEventListener('click', () => applyNotesSize(settings.notesSize - 2));
els.notesup.addEventListener('click', () => applyNotesSize(settings.notesSize + 2));
els.notesreset.addEventListener('click', () => applyNotesSize(22));
els.settingsbtn.addEventListener('click', () => setSettingsOpen(!state.settingsOpen));
els.settingsclose.addEventListener('click', () => setSettingsOpen(false));
els.guidebtn.addEventListener('click', () => send({ type: 'openGuide' }));

function renderMcp() {
  const { port, bridge, desktop } = state.mcp;
  els.mcpstatus.textContent = port
    ? `Ready for agents. They talk to Dek on this Mac only (port ${port}); nothing leaves the machine.`
    : 'Agent server status unknown: running in a browser, or the app is still starting.';
  els.mcpcmd.textContent = bridge
    ? `claude mcp add --scope user dek -- node "${bridge}"`
    : 'claude mcp add --scope user dek -- node <path to dek-mcp.js>';
  if (desktop == null) { els.desktopstate.textContent = '…'; els.desktopbtn.hidden = true; }
  else if (!desktop.found) { els.desktopstate.textContent = 'not detected on this Mac'; els.desktopbtn.hidden = true; }
  else if (desktop.installed) {
    els.desktopstate.textContent = 'installed (restart Desktop to apply)';
    els.desktopbtn.textContent = 'Remove'; els.desktopbtn.classList.remove('primary'); els.desktopbtn.hidden = false;
  } else {
    els.desktopstate.textContent = 'not installed';
    els.desktopbtn.textContent = 'Install'; els.desktopbtn.classList.add('primary'); els.desktopbtn.hidden = false;
  }
}
els.desktopbtn.addEventListener('click', () => send({ type: state.mcp.desktop && state.mcp.desktop.installed ? 'desktopRemove' : 'desktopInstall' }));
els.copycmd.addEventListener('click', () => {
  navigator.clipboard.writeText(els.mcpcmd.textContent).then(() => {
    els.copycmd.textContent = 'Copied';
    setTimeout(() => { els.copycmd.textContent = 'Copy'; }, 1400);
  });
});

// ---------- agent panel ----------

function agentLog(entry) {
  entry.ts = Date.now();
  state.agent.log.unshift(entry);
  if (state.agent.log.length > 200) state.agent.log.pop();
  state.agent.lastAuthor = entry.author || state.agent.lastAuthor;
  state.agent.lastSeen = Date.now();
  if (!state.agentOpen) state.agent.unseen++;
  renderAgent();
}

function agentBadge() {
  const live = Date.now() - state.agent.lastSeen < 90000;
  els.agentbtn.classList.toggle('live', live);
  els.agentbtn.innerHTML = `<span class="dot"></span><span class="agentlabel">${esc(state.agent.lastAuthor && live ? state.agent.lastAuthor : 'Agent')}</span>${state.agent.unseen ? `<span class="n">${state.agent.unseen}</span>` : ''}`;
  els.agentbtn.title = live ? `${state.agent.lastAuthor} is connected (⌘J)` : 'Agent activity (⌘J)';
  els.agentconn.textContent = state.agent.lastAuthor ? `${state.agent.lastAuthor}${live ? ' connected' : ''}` : '';
  els.agentconn.classList.toggle('live', live);
}

function renderAgent() {
  els.agentlist.innerHTML = '';
  els.agentempty.hidden = state.agent.log.length > 0;
  for (const it of state.agent.log) {
    const card = document.createElement('div');
    card.className = 'agent-card';
    card.innerHTML = `<div class="who"><b>${esc(it.author || 'Agent')}</b><span>${relTime(it.ts)}</span></div>` +
      `<div class="what${it.error ? ' err' : ''}">${esc(it.summary || it.tool)}${it.tool ? ` <code>${esc(it.tool)}</code>` : ''}</div>`;
    if (it.slide !== undefined && it.slide !== null) card.addEventListener('click', () => goTo(it.slide));
    els.agentlist.appendChild(card);
  }
  agentBadge();
}
els.agentbtn.addEventListener('click', () => setAgentOpen(!state.agentOpen));
els.agentclose.addEventListener('click', () => setAgentOpen(false));
const openAgentSetup = () => { setAgentOpen(false); setSettingsOpen(true); requestAnimationFrame(() => els.mcpcmd.scrollIntoView({ block: 'center' })); };
els.agentsetup.addEventListener('click', openAgentSetup);
els.emptyagentbtn.addEventListener('click', openAgentSetup);
setInterval(agentBadge, 30000);

// ---------- quick open / command palette ----------

const COMMANDS = () => [
  { label: 'Present', hint: '⌘⏎', run: () => setPresenting(true) },
  { label: 'Present From Start', hint: '⌥⌘⏎', run: () => { goTo(0); setPresenting(true); } },
  { label: 'Presenter View', hint: '⌥⌘P', run: () => send({ type: 'presenter', open: true }) },
  { label: 'Light Table', hint: 'O', run: () => setOverview(!state.overview) },
  { label: 'Black Screen', hint: 'B', run: () => setBlackout(state.blackout === 'black' ? null : 'black') },
  { label: 'Go to Slide…', hint: '⌘P', run: () => palette.open() },
  { label: 'Next Slide', hint: '→', run: next },
  { label: 'Previous Slide', hint: '←', run: prev },
  { label: 'First Slide', hint: 'Home', run: () => stage.first() },
  { label: 'Last Slide', hint: 'End', run: () => stage.last() },
  { label: 'New Slide After Current', hint: '⇧⌘N', run: () => addSlideAfter(state.index) },
  { label: 'Duplicate Slide', hint: '⌘D', run: () => duplicateSlide(state.index) },
  { label: 'Delete Slide', hint: '⌘⌫', run: () => deleteSlide(state.index) },
  { label: 'Skip / Include Slide', hint: '', run: () => toggleSkip(state.index) },
  { label: 'Move Slide Up', hint: '⌥⌘↑', run: () => moveSlideTo(state.index, state.index - 1) },
  { label: 'Move Slide Down', hint: '⌥⌘↓', run: () => moveSlideTo(state.index, state.index + 1) },
  { label: 'Copy Slide HTML', hint: '', run: () => copySlideHtml(state.index) },
  { label: 'Edit Slide Elements', hint: '⌘E', run: () => setEditing(!state.editing) },
  { label: 'Insert Text', hint: '⌥⌘T', run: insertText },
  { label: 'Insert Heading', hint: '⌥⌘H', run: insertHeading },
  { label: 'Insert Image…', hint: '⌥⌘I', run: insertImage },
  { label: 'Undo', hint: '⌘Z', run: undo },
  { label: 'Redo', hint: '⇧⌘Z', run: redo },
  { label: 'Open Deck…', hint: '⌘O', run: () => send({ type: 'openDialog' }) },
  { label: 'New Deck…', hint: '⌘N', run: () => send({ type: 'newDeck' }) },
  { label: 'Open the Welcome Deck', hint: '', run: () => send({ type: 'openSample' }) },
  { label: 'Reload From Disk', hint: '⌘R', run: () => send({ type: 'reload' }) },
  { label: 'Reveal in Finder', hint: '', run: () => send({ type: 'revealInFinder' }) },
  { label: 'Export PDF…', hint: '', run: () => send({ type: 'exportPdf' }) },
  { label: 'Toggle Slide Navigator', hint: '⌘\\', run: () => setNavOpen(!state.navOpen) },
  { label: 'Toggle Agent Panel', hint: '⌘J', run: () => setAgentOpen(!state.agentOpen) },
  { label: 'Settings…', hint: '⌘,', run: () => setSettingsOpen(!state.settingsOpen) },
  { label: 'Keyboard Shortcuts', hint: '⌘/', run: () => setShortcutsOpen(els.shortcuts.hidden) },
  { label: 'Chrome: Stage (dark)', hint: '', run: () => applyTheme('dark') },
  { label: 'Chrome: Daylight (light)', hint: '', run: () => applyTheme('light') },
  { label: 'Chrome: Follow System', hint: '', run: () => applyTheme('system') },
];

const palette = createPalette({
  root: els.quickopen, input: els.qoinput, list: els.qolist, empty: els.qoempty,
  commands: COMMANDS,
  slides: () => (model() ? model().slides.map((s) => ({ index: s.index, title: s.title, current: s.index === state.index })) : []),
  onSlide: (i) => goTo(i),
  onClose: () => stage.focus(),
});

// ---------- keyboard ----------

function escapeKey() {
  if (!els.ctxmenu.hidden) { closeContextMenu(); return true; }
  if (palette.isOpen()) { palette.close(); return true; }
  if (!els.shortcuts.hidden) { setShortcutsOpen(false); return true; }
  if (state.settingsOpen) { setSettingsOpen(false); return true; }
  if (state.overview) { setOverview(false); return true; }
  if (state.agentOpen && !state.presenting) { setAgentOpen(false); return true; }
  if (state.blackout) { setBlackout(null); return true; }
  if (state.gotoBuffer) { cancelGoto(); return true; }
  if (state.editing) { setEditing(false); return true; }
  if (state.presenting) { setPresenting(false); return true; }
  return false;
}

/** Shell shortcuts with ⌘. Native menus fire the same commands through command(). */
const CMD_KEYS = (e) => {
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (e.altKey && k === 'ArrowUp') return 'moveUp';
  if (e.altKey && k === 'ArrowDown') return 'moveDown';
  if (e.altKey && k === 'Enter') return 'presentStart';
  if (e.altKey && k === 'p') return 'presenter';
  if (e.altKey && k === 't') return 'insertText';
  if (e.altKey && k === 'h') return 'insertHeading';
  if (e.altKey && k === 'i') return 'insertImage';
  if (e.altKey) return null;
  const table = {
    'k': 'palette', 'p': e.shiftKey ? 'palette' : 'goto', '\\': 'nav', 'j': 'agent', ',': 'settings', '/': 'shortcuts',
    'r': 'reload', 'd': 'duplicate', 'Backspace': 'delete', 'Enter': 'present', 'z': e.shiftKey ? 'redo' : 'undo',
    'o': e.shiftKey ? 'overview' : 'open', 'n': e.shiftKey ? 'newSlide' : 'newDeck', 'e': 'edit',
  };
  return table[k] || null;
};

function onKey(e) {
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
  if (PRESENTER_MODE) return presenterKey(e);
  const mod = e.metaKey || e.ctrlKey;
  if (mod) {
    const cmd = CMD_KEYS(e);
    if (cmd) { e.preventDefault(); command(cmd); }
    return;
  }
  if (!els.ctxmenu.hidden) { if (e.key === 'Escape') closeContextMenu(); return; }
  if (!els.shortcuts.hidden && e.key !== 'Escape' && e.key !== '?') return;
  if (state.editing && stage.ok) {
    const ed = stage.dek.edit;
    const sel = ed.selected();
    if (sel && !sel.editingText) {
      const step = e.shiftKey ? 10 : 1;
      const nudges = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      if (nudges[e.key]) { e.preventDefault(); ed.nudge(...nudges[e.key]); return; }
      if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); ed.deleteSelected(); toast('Element deleted', '⌘Z'); return; }
      if (e.key === 'Enter') { e.preventDefault(); ed.startText(); return; }
      if (e.key === 'Escape') { e.preventDefault(); ed.clear(); return; }
    }
    if (e.key === 'Escape' && !sel) { e.preventDefault(); setEditing(false); return; }
  }
  switch (e.key) {
    case 'ArrowRight': case 'ArrowDown': case 'PageDown': case 'n': case 'N':
      e.preventDefault(); if (state.blackout) setBlackout(null); next(); break;
    case ' ':
      e.preventDefault(); if (e.shiftKey) prev(); else next(); break;
    case 'ArrowLeft': case 'ArrowUp': case 'PageUp': case 'p': case 'P': case 'Backspace':
      e.preventDefault(); prev(); break;
    case 'Home': e.preventDefault(); stage.first(); break;
    case 'End': e.preventDefault(); stage.last(); break;
    case 'Escape': if (escapeKey()) e.preventDefault(); break;
    case 'Enter': if (state.gotoBuffer) { e.preventDefault(); commitGoto(); } break;
    case 'o': case 'O': if (state.deck) { e.preventDefault(); setOverview(!state.overview); } break;
    case 'b': case 'B': if (state.deck) { e.preventDefault(); setBlackout(state.blackout === 'black' ? null : 'black'); } break;
    case 'w': case 'W': if (state.deck) { e.preventDefault(); setBlackout(state.blackout === 'white' ? null : 'white'); } break;
    case 's': case 'S': if (state.deck) { e.preventDefault(); send({ type: 'presenter', open: true }); } break;
    case 'f': case 'F': if (state.deck) { e.preventDefault(); setPresenting(!state.presenting); } break;
    case 'e': case 'E': if (state.deck && !state.presenting) { e.preventDefault(); setEditing(!state.editing); } break;
    case '?': e.preventDefault(); setShortcutsOpen(els.shortcuts.hidden); break;
    default:
      if (/^\d$/.test(e.key) && state.deck) { e.preventDefault(); pushGoto(e.key); }
  }
}
window.addEventListener('keydown', onKey);

/** Named commands: menus (Swift), palette and keyboard all end up here. */
const PRESENTING_OK = new Set(['next', 'prev', 'first', 'last', 'gotoIndex', 'blackout', 'stop', 'present', 'presentStart', 'presenter', 'escape', 'closeOverlays', 'goto']);
function command(name, arg) {
  if (state.presenting && !PRESENTING_OK.has(name)) return;
  switch (name) {
    case 'palette': palette.open({ command: true }); break;
    case 'goto': palette.open(); break;
    case 'nav': setNavOpen(!state.navOpen); break;
    case 'agent': setAgentOpen(!state.agentOpen); break;
    case 'settings': setSettingsOpen(!state.settingsOpen); break;
    case 'shortcuts': setShortcutsOpen(els.shortcuts.hidden); break;
    case 'reload': send({ type: 'reload' }); break;
    case 'duplicate': if (state.deck) duplicateSlide(state.index); break;
    case 'delete': if (state.deck) deleteSlide(state.index); break;
    case 'newSlide': if (state.deck) addSlideAfter(state.index); break;
    case 'moveUp': if (state.deck) moveSlideTo(state.index, state.index - 1); break;
    case 'moveDown': if (state.deck) moveSlideTo(state.index, state.index + 1); break;
    case 'present': setPresenting(!state.presenting); break;
    case 'presentStart': goTo(0); setPresenting(true); break;
    case 'stop': setPresenting(false); break;
    case 'presenter': send({ type: 'presenter', open: true }); break;
    case 'overview': if (state.deck) setOverview(!state.overview); break;
    case 'blackout': setBlackout(state.blackout === 'black' ? null : 'black'); break;
    case 'undo': undo(); break;
    case 'redo': redo(); break;
    case 'open': send({ type: 'openDialog' }); break;
    case 'newDeck': send({ type: 'newDeck' }); break;
    case 'sample': send({ type: 'openSample' }); break;
    case 'next': next(); break;
    case 'prev': prev(); break;
    case 'first': stage.first(); break;
    case 'last': stage.last(); break;
    case 'gotoIndex': goTo(arg | 0); break;
    case 'copyHtml': copySlideHtml(state.index); break;
    case 'skip': if (state.deck) toggleSkip(state.index); break;
    case 'edit': setEditing(!state.editing); break;
    case 'insertText': insertText(); break;
    case 'insertHeading': insertHeading(); break;
    case 'insertImage': insertImage(); break;
    case 'deleteElement': if (state.editing && stage.ok) stage.dek.edit.deleteSelected(); break;
    case 'escape': escapeKey(); break;
    case 'closeOverlays': while (escapeKey()) { /* until nothing is open */ } break;
    default: console.warn('[dek] unknown command', name);
  }
}

// ---------- MCP tools (called by the Swift shell through rpc) ----------

function slideSummary(s) {
  return { n: s.index + 1, id: s.id, title: s.title, notes: s.notes ? s.notes.slice(0, 160) : '', fragments: s.fragments, transition: s.transition, autoAnimate: s.autoAnimate, skip: !!s.skip };
}

function themeVars(m) {
  const vars = {};
  const s = structure(m.raw);
  for (const r of s.styles) {
    const css = m.raw.slice(r.start, r.end);
    for (const block of css.match(/:root\s*\{[^}]*\}/g) || []) {
      for (const mm of block.matchAll(/(--[\w-]+)\s*:\s*([^;}]+)/g)) vars[mm[1]] = mm[2].trim();
    }
  }
  return vars;
}

function themeSummary(m) {
  const vars = themeVars(m);
  const css = structure(m.raw).styles.map((r) => m.raw.slice(r.start, r.end)).join('\n');
  const fonts = Array.from(new Set((css.match(/font-family\s*:\s*([^;}]+)/g) || []).map((f) => f.replace(/font-family\s*:\s*/, '').trim())));
  const colors = Array.from(new Set(css.match(/(?:oklch|oklab|rgba?|hsla?)\([^)]*\)|#[0-9a-fA-F]{3,8}\b/g) || [])).slice(0, 24);
  const links = Array.from(m.headInner.matchAll(/<link[^>]*href=["']([^"']+)["'][^>]*>/gi)).map((x) => x[1]);
  return { vars, fonts, colors, stylesheets: links, styleBlocks: structure(m.raw).styles.length };
}

function componentRanges(m) {
  const out = [];
  let open = null;
  scanTags(m.raw, (t) => {
    if (t.name !== 'template') return;
    if (!t.closing) { const nm = /data-dek-component\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(t.attrs); if (nm) open = { name: nm[1] || nm[2], start: t.start, inner: t.end, attrs: t.attrs }; }
    else if (open) { out.push({ ...open, end: t.end, innerEnd: t.start }); open = null; }
  });
  return out.map((c) => {
    const desc = /data-description\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(c.attrs);
    const html = m.raw.slice(c.inner, c.innerEnd);
    return { name: c.name, description: desc ? (desc[1] || desc[2]) : '', html, start: c.start, end: c.end, vars: Array.from(new Set(Array.from(html.matchAll(/\{\{\s*([\w-]+)\s*\}\}/g)).map((x) => x[1]))) };
  });
}

function fillVars(html, vars) {
  return html.replace(/\{\{\s*([\w-]+)\s*\}\}/g, (_, k) => (vars && vars[k] !== undefined ? String(vars[k]) : ''));
}

function slideRef(args) {
  const m = needDeck();
  const i = resolveSlide(m, args.slide, state.index);
  if (!m.slides[i]) throw new Error(`No slide ${typeof args.slide === 'number' ? args.slide : i + 1} (the deck has ${m.slides.length})`);
  return i;
}

function updateSlideHtml(i, html, label) {
  const m = needDeck();
  applyRaw(replaceSlide(m, i, html), { label, focusIndex: i });
}

const TOOLS = {
  get_deck() {
    const m = needDeck();
    return { result: {
      path: state.deck.path, name: state.deck.name, title: m.meta.title, size: m.meta.size,
      transition: m.meta.transition || settings.transition, count: m.slides.length, current: state.index + 1,
      slides: m.slides.map(slideSummary), components: componentRanges(m).map((c) => ({ name: c.name, description: c.description, vars: c.vars })),
      theme: themeVars(m), presenting: state.presenting,
    } };
  },
  get_slide(a) {
    const i = slideRef(a);
    const s = needDeck().slides[i];
    return { result: { n: i + 1, id: s.id, title: s.title, html: s.html, notes: s.notes, notesHtml: s.notesHtml, fragments: s.fragments, transition: s.transition, autoAnimate: s.autoAnimate } };
  },
  get_source(a) {
    const m = needDeck();
    const part = a.part || 'head';
    if (part === 'full') return { result: m.raw };
    if (part === 'body') return { result: m.bodyInner };
    if (part === 'styles') return { result: structure(m.raw).styles.map((r) => m.raw.slice(r.start, r.end)).join('\n\n/* ---- */\n\n') };
    return { result: m.headInner };
  },
  get_elements(a) {
    const i = slideRef(a);
    return { result: getElements(needDeck().slides[i].html, a.selector, a.limit || 20) };
  },
  add_slide(a) {
    const m = needDeck();
    let html = a.html;
    if (a.component) {
      const c = componentRanges(m).find((x) => x.name === a.component);
      if (!c) throw new Error(`No component "${a.component}"`);
      html = fillVars(c.html, a.vars);
    }
    if (!html) throw new Error('html (or component) is required');
    let section = normalizeSection(html, takenIds());
    if (a.notes) section = setNotes(section, a.notes);
    let at;
    if (a.at !== undefined) at = clamp((a.at | 0) - 1, 0, m.slides.length);
    else if (a.before !== undefined) at = resolveSlide(m, a.before, state.index);
    else at = (a.after !== undefined ? resolveSlide(m, a.after, state.index) : (m.slides.length ? state.index : -1)) + 1;
    at = clamp(at, 0, m.slides.length);
    applyRaw(insertSlide(m, section, at), { label: 'agent: add slide', focusIndex: at });
    return { result: { n: at + 1, id: sectionId(section), count: slideCount() }, summary: `added slide ${at + 1}`, slide: at };
  },
  update_slide(a) {
    const i = slideRef(a);
    const m = needDeck();
    let html = m.slides[i].html;
    if (a.html !== undefined) {
      html = String(a.html).trim();
      if (!/^<section[\s>]/i.test(html)) html = `<section>\n${html}\n</section>`;
      if (!sectionId(html) && m.slides[i].id) html = html.replace(/^<section/i, `<section id="${m.slides[i].id}"`);
      html = normalizeSection(html, takenIds().filter((id) => id !== m.slides[i].id));
    }
    if (a.notes !== undefined) html = setNotes(html, a.notes);
    if (a.attrs) html = setSlideAttrs(html, a.attrs);
    updateSlideHtml(i, html, 'agent: update slide');
    return { result: { n: i + 1, id: sectionId(html) }, summary: `updated slide ${i + 1}`, slide: i };
  },
  delete_slide(a) {
    const i = slideRef(a);
    deleteSlide(i);
    return { result: { deleted: i + 1, count: slideCount() }, summary: `deleted slide ${i + 1}`, slide: Math.min(i, slideCount() - 1) };
  },
  move_slide(a) {
    const i = slideRef(a);
    if (a.to === undefined) throw new Error('to (1-based position) is required');
    const to = clamp((a.to | 0) - 1, 0, slideCount() - 1);
    moveSlideTo(i, to);
    return { result: { from: i + 1, to: to + 1 }, summary: `moved slide ${i + 1} to ${to + 1}`, slide: to };
  },
  duplicate_slide(a) {
    const i = slideRef(a);
    const r = duplicateSlide(i);
    return { result: { n: r.index + 1, id: r.id }, summary: `duplicated slide ${i + 1}`, slide: r.index };
  },
  set_notes(a) {
    const i = slideRef(a);
    updateSlideHtml(i, setNotes(needDeck().slides[i].html, a.notes || ''), 'agent: notes');
    return { result: { n: i + 1 }, summary: `set notes on slide ${i + 1}`, slide: i };
  },
  add_element(a) {
    const i = slideRef(a);
    if (!a.html) throw new Error('html is required');
    updateSlideHtml(i, addElement(needDeck().slides[i].html, { html: a.html, position: a.position, selector: a.selector }), 'agent: add element');
    return { result: { n: i + 1 }, summary: `added an element to slide ${i + 1}`, slide: i };
  },
  update_element(a) {
    const i = slideRef(a);
    if (!a.selector) throw new Error('selector is required');
    const r = updateElement(needDeck().slides[i].html, { selector: a.selector, html: a.html, inner: a.inner, text: a.text, attrs: a.attrs, style: a.style, addClass: a.add_class, removeClass: a.remove_class, all: !!a.all });
    updateSlideHtml(i, r.html, 'agent: update element');
    return { result: { n: i + 1, updated: r.count }, summary: `updated ${r.count} element${r.count === 1 ? '' : 's'} (${a.selector}) on slide ${i + 1}`, slide: i };
  },
  delete_element(a) {
    const i = slideRef(a);
    if (!a.selector) throw new Error('selector is required');
    const r = deleteElement(needDeck().slides[i].html, { selector: a.selector, all: !!a.all });
    updateSlideHtml(i, r.html, 'agent: delete element');
    return { result: { n: i + 1, deleted: r.count }, summary: `deleted ${r.count} element${r.count === 1 ? '' : 's'} (${a.selector}) on slide ${i + 1}`, slide: i };
  },
  set_head(a) {
    const m = needDeck();
    if (a.html === undefined) throw new Error('html (the inner HTML of <head>) is required');
    applyRaw(setHeadInner(m, a.html), { label: 'agent: head' });
    return { result: { ok: true }, summary: 'rewrote the deck head' };
  },
  append_style(a) {
    const m = needDeck();
    if (!a.css) throw new Error('css is required');
    applyRaw(appendStyle(m, a.css, a.id), { label: 'agent: style' });
    return { result: { ok: true }, summary: a.id ? `set style block #${a.id}` : 'appended a style block' };
  },
  set_title(a) {
    const m = needDeck();
    applyRaw(setTitle(m, String(a.title || '')), { label: 'agent: title' });
    return { result: { title: a.title }, summary: `titled the deck “${a.title}”` };
  },
  write_deck(a) {
    needDeck();
    if (typeof a.html !== 'string') throw new Error('html is required');
    applyRaw(a.html, { label: 'agent: rewrite deck' });
    return { result: { count: slideCount() }, summary: 'rewrote the whole deck' };
  },
  get_theme() { return { result: themeSummary(needDeck()) }; },
  set_theme(a) {
    const m = needDeck();
    if (!a.vars || typeof a.vars !== 'object') throw new Error('vars ({"--name": "value"}) is required');
    const existing = {};
    const block = /<style[^>]*\sid=["']dek-theme["'][^>]*>([\s\S]*?)<\/style>/i.exec(m.raw);
    if (block) for (const mm of block[1].matchAll(/(--[\w-]+)\s*:\s*([^;}]+)/g)) existing[mm[1]] = mm[2].trim();
    const merged = { ...existing };
    for (const k in a.vars) { const key = k.startsWith('--') ? k : '--' + k; if (a.vars[k] === null) delete merged[key]; else merged[key] = String(a.vars[k]); }
    const css = ':root {\n' + Object.entries(merged).map(([k, v]) => `  ${k}: ${v};`).join('\n') + '\n}';
    applyRaw(appendStyle(m, css, 'dek-theme'), { label: 'agent: theme' });
    return { result: { vars: merged }, summary: `set ${Object.keys(a.vars).length} theme variable${Object.keys(a.vars).length === 1 ? '' : 's'}` };
  },
  list_components() { return { result: componentRanges(needDeck()).map((c) => ({ name: c.name, description: c.description, vars: c.vars, html: c.html })) }; },
  add_component(a) {
    const m = needDeck();
    if (!a.name || !a.html) throw new Error('name and html are required');
    const tag = `<template data-dek-component="${esc(a.name)}"${a.description ? ` data-description="${esc(a.description)}"` : ''}>\n${String(a.html).trim()}\n</template>`;
    const existing = componentRanges(m).find((c) => c.name === a.name);
    let raw;
    if (existing) raw = m.raw.slice(0, existing.start) + tag + m.raw.slice(existing.end);
    else if (m.slides.length) raw = m.raw.slice(0, m.slides[0].start) + tag + '\n\n' + m.raw.slice(m.slides[0].start);
    else raw = m.raw.slice(0, m.structure.body.end) + '\n' + tag + '\n' + m.raw.slice(m.structure.body.end);
    applyRaw(raw, { label: 'agent: component' });
    return { result: { name: a.name, replaced: !!existing }, summary: `${existing ? 'updated' : 'added'} component “${a.name}”` };
  },
  use_component(a) {
    const i = slideRef(a);
    const m = needDeck();
    const c = componentRanges(m).find((x) => x.name === a.name);
    if (!c) throw new Error(`No component "${a.name}". list_components shows what exists.`);
    const html = a.live
      ? `<div data-dek-use="${esc(a.name)}" data-vars='${esc(JSON.stringify(a.vars || {})).replace(/'/g, '&#39;')}'></div>`
      : fillVars(c.html, a.vars);
    updateSlideHtml(i, addElement(m.slides[i].html, { html, position: a.position, selector: a.selector }), 'agent: use component');
    return { result: { n: i + 1 }, summary: `placed component “${a.name}” on slide ${i + 1}`, slide: i };
  },
  get_state() {
    const s = stage.state();
    return { result: { open: !!state.deck, path: state.deck ? state.deck.path : null, current: state.index + 1, step: state.step, steps: s ? s.steps : 0, count: slideCount(), presenting: state.presenting, overview: state.overview, title: s ? s.title : '' } };
  },
  goto(a) {
    const i = slideRef(a);
    goTo(i, a.step === 'last' ? 'last' : (a.step | 0));
    return { result: { current: i + 1 }, summary: `went to slide ${i + 1}`, slide: i };
  },
  navigate(a) {
    needDeck();
    const map = { next, prev, first: () => stage.first(), last: () => stage.last() };
    if (!map[a.action]) throw new Error('action must be next | prev | first | last');
    map[a.action]();
    return { result: { current: state.index + 1, step: state.step } };
  },
  present(a) {
    needDeck();
    const action = a.action || 'start';
    if (action === 'start') setPresenting(true);
    else if (action === 'from_start') { goTo(0); setPresenting(true); }
    else if (action === 'stop') setPresenting(false);
    else if (action === 'presenter') send({ type: 'presenter', open: true });
    else throw new Error('action must be start | from_start | stop | presenter');
    return { result: { presenting: state.presenting }, summary: `presentation ${action}` };
  },
  overview(a) {
    needDeck();
    setOverview(a.open !== false);
    return { result: { overview: state.overview } };
  },
  prepare_snapshot(a) {
    const i = slideRef(a);
    setOverview(false);
    setSettingsOpen(false);
    goTo(i, a.step === undefined ? 'last' : (a.step === 'last' ? 'last' : (a.step | 0)));
    const r = els.frame.getBoundingClientRect();
    return { result: { x: r.left, y: r.top, w: r.width, h: r.height, n: i + 1, step: state.step, title: model().slides[i].title } };
  },
  open_deck(a) {
    if (!a.path || !/^\//.test(a.path)) throw new Error('path must be an absolute path to an .html deck');
    return { result: { opening: a.path }, open: a.path, summary: `opened ${a.path.split('/').pop()}` };
  },
  create_deck(a) {
    if (!a.path || !/^\//.test(a.path) || !/\.html?$/i.test(a.path)) throw new Error('path must be an absolute path ending in .html');
    let html = a.html;
    if (!html) {
      html = a.template === 'empty'
        ? `<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="utf-8">\n  <title>${esc(a.title || 'Untitled deck')}</title>\n  <style>\n    section { background: #111; color: #fff; }\n  </style>\n</head>\n<body>\n\n<section id="s-cover" class="dek-center">\n  <h1>${esc(a.title || 'Untitled deck')}</h1>\n</section>\n\n</body>\n</html>\n`
        : BLANK_TEMPLATE.replace(/Untitled deck/g, esc(a.title || 'Untitled deck'));
    }
    state.rpcWrites.push({ path: a.path, content: html });
    return { result: { created: a.path }, open: a.path, summary: `created ${a.path.split('/').pop()}` };
  },
  get_format_guide() { return { result: FORMAT_GUIDE }; },
  /** Convert a Claude Design export (or a page of loose slides) into a Dek deck file and open it. The shell receives the file content from the app. */
  async import_deck(a) {
    if (!a.path || !/^\//.test(a.path)) throw new Error('path must be an absolute path to an .html file');
    if (typeof a.content !== 'string') throw new Error('the app could not read that file');
    const name = a.path.split('/').pop();
    if (!detectForeign(a.content)) {
      const m = parseDeck(a.content);
      if (m.slides.length) return { result: { path: a.path, slides: m.slides.length, kind: 'dek', note: 'already a Dek-style deck; opening it as is' }, open: a.path, summary: `opened ${name}` };
      throw new Error('no slides found: the file has no <section> slides and is not a Claude Design export');
    }
    const r = await importForeign(a.content, { name });
    const out = a.out && /^\//.test(a.out) && /\.html?$/i.test(a.out) ? a.out : `${a.path.replace(/[^/]*$/, '')}${r.title} (Dek).html`;
    state.rpcWrites.push({ path: out, content: r.html });
    return { result: { path: out, slides: r.count, notes: r.notes, size: r.size, kind: r.kind, dropped: r.dropped.length }, open: out, summary: `imported ${r.count} slides from ${r.kind === 'claude-design' ? 'Claude Design' : 'a page'} into ${out.split('/').pop()}` };
  },
};

async function rpc(payload) {
  let req;
  try { req = typeof payload === 'string' ? JSON.parse(payload) : payload; } catch { return JSON.stringify({ ok: false, error: 'bad request json' }); }
  const tool = req.tool;
  const args = req.args || {};
  const author = req.author || 'Agent';
  state.inRpc = true;
  state.rpcWrites = [];
  try {
    const fn = TOOLS[tool];
    if (!fn) throw new Error(`Unknown tool: ${tool}`);
    const out = (await fn(args)) || {};
    state.agent.lastAuthor = author;
    state.agent.lastSeen = Date.now();
    if (out.summary) agentLog({ author, tool, summary: out.summary, slide: out.slide });
    else agentBadge();
    const res = { ok: true, result: out.result === undefined ? null : out.result, writes: state.rpcWrites };
    if (out.open) res.open = out.open;
    return JSON.stringify(res);
  } catch (e) {
    agentLog({ author, tool, summary: `${tool}: ${e.message || e}`, error: true });
    return JSON.stringify({ ok: false, error: String(e.message || e), writes: state.rpcWrites });
  } finally {
    state.inRpc = false;
    state.rpcWrites = [];
  }
}

// ---------- presenter view ----------

const pv = { stage: null, startedAt: null, tick: null, deck: null };
const devChannel = !isNative && 'BroadcastChannel' in window ? new BroadcastChannel('dek-dev') : { postMessage() {}, addEventListener() {} };

function presenterBoot() {
  document.body.classList.add('presenter');
  els.presenter.hidden = false;
  pv.stage = new Stage(els.pvframe);
  pv.stage.on('change', (s) => presenterRender(s));
  pv.stage.on('load', (s) => { presenterLayout(); presenterRender(s); });
  pv.stage.on('keydown', (e) => presenterKey(e));
  new ResizeObserver(presenterLayout).observe(els.presenter);
  els.pvtimer.addEventListener('dblclick', () => { pv.startedAt = Date.now(); presenterTick(); });
  pv.tick = setInterval(presenterTick, 1000);
  presenterTick();
  if (!isNative) {
    devChannel.addEventListener('message', (e) => {
      const msg = e.data || {};
      if (msg.kind === 'deck') loadDeck(msg.doc, { index: msg.index, step: msg.step });
      if (msg.kind === 'follow') presenterFollow(msg);
    });
    devChannel.postMessage({ kind: 'hello' });
  }
}

function presenterLayout() {
  const box = els.presenter.querySelector('.pv-stage').getBoundingClientRect();
  const main = els.presenter.querySelector('.pv-main').getBoundingClientRect();
  if (!box.width) return;
  const size = model() ? model().meta.size : { w: 1920, h: 1080 };
  const aw = box.width, ah = Math.max(1, main.height - 16);
  const s = Math.min(aw / size.w, ah / size.h);
  els.pvframe.style.width = Math.floor(size.w * s) + 'px';
  els.pvframe.style.height = Math.floor(size.h * s) + 'px';
  pv.stage.fit();
}

function presenterDeckLoaded() {
  const m = model();
  pv.stage.load(m, { index: state.index, step: state.step, baseHref: state.deck.baseHref, transition: 'none' });
  if (!pv.startedAt) pv.startedAt = Date.now();
}

function presenterFollow(s) {
  if (!pv.stage || !pv.stage.ok) { state.index = s.index; state.step = s.step; return; }
  pv.stage.go(s.index, s.step);
}

function presenterRender(s) {
  state.index = s.index;
  state.step = s.step;
  const m = model();
  els.pvcounter.textContent = `${s.index + 1} / ${s.count}`;
  els.pvtitle.textContent = s.title || '';
  const notes = s.notes && s.notes.html;
  els.pvnotes.innerHTML = notes || 'No notes for this slide.';
  els.pvnotes.classList.toggle('none', !notes);
  let nextIndex = s.index + 1;
  while (m && m.slides[nextIndex] && m.slides[nextIndex].skip) nextIndex++;
  if (m && m.slides[nextIndex]) {
    els.pvend.hidden = true;
    els.pvnext.hidden = false;
    const key = `${m.slides[nextIndex].hash}|${nextIndex}`;
    if (els.pvnext.dataset.key !== key) {
      els.pvnext.dataset.key = key;
      els.pvnext.srcdoc = buildDocument(m, { mode: 'thumb', index: nextIndex, baseHref: state.deck.baseHref });
    }
  } else {
    els.pvnext.hidden = true;
    els.pvend.hidden = false;
  }
}

function presenterTick() {
  const now = new Date();
  els.pvclock.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  els.pvtimermode.textContent = settings.timer ? 'left' : 'elapsed';
  if (!pv.startedAt) { els.pvtimer.textContent = settings.timer ? `${String(settings.timer).padStart(2, '0')}:00` : '00:00'; return; }
  let secs = Math.floor((Date.now() - pv.startedAt) / 1000);
  els.pvtimer.classList.remove('over', 'warn');
  if (settings.timer) {
    const remaining = settings.timer * 60 - secs;
    if (remaining < 0) els.pvtimer.classList.add('over');
    else if (remaining < 120) els.pvtimer.classList.add('warn');
    secs = Math.abs(remaining);
  }
  const h = Math.floor(secs / 3600), mm = Math.floor((secs % 3600) / 60), ss = secs % 60;
  els.pvtimer.textContent = (h ? h + ':' : '') + String(mm).padStart(2, '0') + ':' + String(ss).padStart(2, '0');
}

function presenterKey(e) {
  const map = {
    ArrowRight: 'next', ArrowDown: 'next', PageDown: 'next', ' ': e.shiftKey ? 'prev' : 'next', n: 'next', N: 'next',
    ArrowLeft: 'prev', ArrowUp: 'prev', PageUp: 'prev', p: 'prev', P: 'prev', Backspace: 'prev',
    Home: 'first', End: 'last', b: 'blackout', B: 'blackout', Escape: 'stop',
  };
  const action = map[e.key];
  if (!action) return;
  e.preventDefault();
  if (isNative) send({ type: 'nav', action });
  else devChannel.postMessage({ kind: 'nav', action });
}

if (!isNative && !PRESENTER_MODE) {
  devChannel.addEventListener('message', (e) => {
    const msg = e.data || {};
    if (msg.kind === 'hello' && state.deck) devChannel.postMessage({ kind: 'deck', doc: { name: state.deck.name, path: state.deck.path, content: state.deck.model.raw, baseHref: state.deck.baseHref }, index: state.index, step: state.step });
    if (msg.kind === 'nav') command(msg.action);
  });
}

// ---------- API exposed to the Swift shell ----------

/** Foreign HTML (a Claude Design export, a page of loose slides) becomes a Dek deck saved next to the original. */
async function importAndOpen(doc) {
  const kind = detectForeign(doc.content);
  toast(kind === 'bundle' ? 'Unpacking the export…' : 'Importing slides…');
  try {
    const r = await importForeign(doc.content, { name: doc.name });
    if (!r) { loadDeck(doc); return; }
    const dir = doc.path.replace(/[^/]*$/, '');
    const out = `${dir}${r.title} (Dek).html`;
    state.pendingImport = { count: r.count, notes: r.notes, kind: r.kind, out };
    if (isNative) send({ type: 'saveAndOpen', path: out, content: r.html, source: doc.path });
    else window.dekShell.load({ name: out.split('/').pop(), path: out, content: r.html, baseHref: doc.baseHref, imported: true });
  } catch (e) {
    toast(`Could not import: ${e.message || e}`);
    loadDeck(doc);
  }
}

function importResult(info) {
  const p = state.pendingImport;
  state.pendingImport = null;
  if (!p) return;
  const src = p.kind === 'claude-design' ? 'Claude Design' : 'the page';
  if (info && info.reused) toast(`Opened your existing Dek copy of this ${src} export`);
  else toast(`Imported ${p.count} slides from ${src}${p.notes ? ` with ${p.notes} speaker notes` : ''} · saved as “${p.out.split('/').pop()}”`);
}

window.dekShell = {
  version: VERSION,
  load(doc) {
    if (!doc.imported && !PRESENTER_MODE && detectForeign(doc.content || '')) { importAndOpen(doc); return; }
    loadDeck(doc, doc.index !== undefined ? { index: doc.index, step: doc.step } : {});
    if (state.pendingImport && !isNative) importResult({});
    if (!isNative && !PRESENTER_MODE) devChannel.postMessage({ kind: 'deck', doc: { name: state.deck.name, path: state.deck.path, content: state.deck.model.raw, baseHref: state.deck.baseHref }, index: state.index, step: state.step });
  },
  imported: importResult,
  /** External change on disk (agent, editor, git): reload in place, keep the slide, make it undoable. */
  fileChanged(info) {
    if (!state.deck || info.path !== state.deck.path) return;
    if (info.content === state.deck.model.raw) return;
    if (state.presenting) { state.pendingExternal = info; return; } // never reflash the projected slide
    const before = slideCount();
    applyRaw(info.content, { label: 'change on disk', external: true });
    if (!state.presenting) toast(slideCount() !== before ? `Reloaded · ${slideCount()} slides` : 'Reloaded');
    if (!isNative && !PRESENTER_MODE) devChannel.postMessage({ kind: 'deck', doc: { name: state.deck.name, path: state.deck.path, content: state.deck.model.raw, baseHref: state.deck.baseHref }, index: state.index, step: state.step });
  },
  saved(info) {
    if (!state.deck || info.path !== state.deck.path) return;
    setSaveState(info.ok ? 'saved' : 'error');
    if (!info.ok) toast('Could not write the deck file');
  },
  closed() {
    state.deck = null;
    els.frame.srcdoc = '';
    thumbs.render({ slides: [], headInner: '', bodyAttrs: '', meta: { size: { w: 1920, h: 1080 } } }, { current: -1 });
    setPresenting(false);
    updateChrome();
  },
  command,
  rpc,
  getContent() { return state.deck ? state.deck.model.raw : null; },
  state() { return JSON.stringify({ open: !!state.deck, path: state.deck ? state.deck.path : null, index: state.index, step: state.step, count: slideCount(), presenting: state.presenting }); },
  follow(s) { if (PRESENTER_MODE) presenterFollow(s); },
  nav(action) { command(action); },
  fullscreenChanged(on) {
    if (!on && state.presenting) setPresenting(false, { fromNative: true });
    if (on && !state.presenting && state.deck && document.body.classList.contains('want-present')) setPresenting(true, { fromNative: true });
    document.body.classList.remove('want-present');
  },
  agentInfo(info) {
    state.mcp.port = info.port || null;
    state.mcp.bridge = info.bridge || null;
    state.mcp.version = info.version || null;
    renderMcp();
  },
  desktopStatus(status) { state.mcp.desktop = status; renderMcp(); },
  agentSeen(author) {
    if (author) state.agent.lastAuthor = author;
    state.agent.lastSeen = Date.now();
    agentBadge();
    if (author && !state.agent.log.some((l) => l.tool === 'connect' && l.author === author && Date.now() - l.ts < 60000)) {
      agentLog({ author, tool: 'connect', summary: 'connected' });
    }
  },
  imagePicked,
  imageDropped(info) { if (state.deck && info && info.path) { if (!state.editing) setEditing(true); send({ type: 'importImage', path: info.path }); } },
  snapshotRect() {
    const r = els.frame.getBoundingClientRect();
    return JSON.stringify({ x: r.left, y: r.top, w: r.width, h: r.height });
  },
  setRecents(list) {
    els.recent.innerHTML = '';
    (list || []).slice(0, 6).forEach((r) => {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.textContent = r.name;
      const dir = document.createElement('span');
      dir.className = 'recent-dir';
      dir.textContent = r.dir || '';
      btn.appendChild(dir);
      btn.addEventListener('click', () => send({ type: 'openPath', path: r.path }));
      li.appendChild(btn);
      els.recent.appendChild(li);
    });
  },
  openSettings(open) { setSettingsOpen(open !== false); },
  toggleNav() { setNavOpen(!state.navOpen); },
  toggleAgent() { setAgentOpen(!state.agentOpen); },
  isPresenting() { return state.presenting; },
  /** PDF export (driven by the shell): freeze transitions, report the stage rect. */
  beginExport() {
    if (!state.deck) return JSON.stringify({ count: 0 });
    pdf.index = state.index; pdf.step = state.step; pdf.active = true;
    setOverview(false); setSettingsOpen(false);
    stage.setOptions({ transition: 'none', transitionMs: 1 });
    const r = els.frame.getBoundingClientRect();
    return JSON.stringify({ count: slideCount(), rect: { x: r.left, y: r.top, w: r.width, h: r.height } });
  },
  exportGoto(i) { stage.go(i, 'last', { instant: true }); },
  endExport() {
    if (!pdf.active) return;
    pdf.active = false;
    const o = stageOpts(state.index, state.step);
    stage.setOptions({ transition: o.transition, transitionMs: o.transitionMs });
    stage.go(pdf.index, pdf.step, { instant: true });
  },
};
const pdf = { active: false, index: 0, step: 0 };

// ---------- wiring ----------

els.presentbtn.addEventListener('click', () => setPresenting(true));
els.counter.addEventListener('click', () => palette.open());
els.navtoggle.addEventListener('click', () => setNavOpen(!state.navOpen));
els.addslide.addEventListener('click', () => { if (state.deck) addSlideAfter(state.index); else send({ type: 'newDeck' }); });
els.samplebtn.addEventListener('click', () => send({ type: 'openSample' }));
els.blackout.addEventListener('click', () => { if (state.atEnd && state.presenting) setPresenting(false); else setBlackout(null); });
els.overview.addEventListener('click', (e) => { if (e.target === els.overview) setOverview(false); });

// drag & drop a deck file
let dragDepth = 0;
window.addEventListener('dragenter', (e) => { if (e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')) { e.preventDefault(); dragDepth++; document.body.classList.add('dropping'); } });
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dropping'); } });
window.addEventListener('dragover', (e) => { if (document.body.classList.contains('dropping')) e.preventDefault(); });
window.addEventListener('drop', (e) => {
  if (!document.body.classList.contains('dropping')) return;
  e.preventDefault();
  dragDepth = 0;
  document.body.classList.remove('dropping');
  const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (f && !isNative) f.text().then((text) => window.dekShell.load({ name: f.name, path: '/dropped/' + f.name, content: text, baseHref: '' }));
});

// ---------- boot ----------

if (isNative) document.body.classList.add('native');
applyTheme(settings.theme);
applyThumb(settings.thumb);
applyNotesSize(settings.notesSize);
els.version.textContent = VERSION;
if (PRESENTER_MODE) {
  presenterBoot();
} else {
  setNavOpen(state.navOpen);
  renderSettings();
  renderAgent();
  updateChrome();
}
window.__dek = { state, settings, stage, thumbs, model, command, rpc }; // QA handle
send({ type: 'ready', presenter: PRESENTER_MODE });
