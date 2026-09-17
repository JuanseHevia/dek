import { exportManifest, inspectExportSlide, writePowerPoint } from './export.js';
import { createInspector } from './inspector.js';
import { shapeHTML, layoutHTML } from './authoring.js';
import { elementOperations, slideOperations, documentMeta, setDocumentMeta, pathTarget, reorderSections, copySlidesInto, ensureObjectIds, freshSlide, transferHead } from './editor-model.js';
import { send, isNative } from './bridge.js';
import {
  parseDeck, insertSlide, replaceSlide, removeSlide, moveSlide, normalizeSection, withNewId, sectionId,
  setNotes, setSlideAttrs, addElement, updateElement, deleteElement, getElements,
  setHeadInner, appendStyle, setTitle, resolveSlide, structure, retagElement,
  componentRanges, fillVars,
} from './deck.js';
import { Stage, Thumbs, buildDocument } from './stage.js';
import { createPalette } from './palette.js';
import { detectForeign, importForeign, importTitle } from './import.js';
import {
  MAX_THEMES, TOKEN_GUIDE, DEFAULT_SYSTEM, normalizeLibrary, emptyLibrary, createTheme, updateTheme,
  deleteTheme, duplicateTheme, revertTheme, findTheme, currentSystem, currentVersion, themeSummary,
  normalizeSystem, applyThemeToRaw, removeThemeFromRaw, readDeckTheme, captureSystem, deckOwnedComponents,
  compileSystemCss, chartDefaults, missingVars,
} from './theme.js';
import { createThemesUI } from './themes-ui.js';
import { composeDocument } from './theme-doc.js';
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
  designbtn: $('designbtn'), designswatch: $('designswatch'), designlabel: $('designlabel'),
  navtitle: $('navtitle'), navback: $('navback'), dslist: $('dslist'), dsempty: $('dsempty'),
  dscapture: $('dscapture'), dsask: $('dsask'),
  compose: $('compose'), composeframe: $('composeframe'), composename: $('composename'), composever: $('composever'),
  composeapply: $('composeapply'), composehistorybtn: $('composehistorybtn'), composeduplicate: $('composeduplicate'),
  composesave: $('composesave'), composeask: $('composeask'), composedelete: $('composedelete'),
  composeclose: $('composeclose'), composehist: $('composehist'),
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
  replaceImage: null,       // stable source target for an outstanding image picker
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
  themes: emptyLibrary(),   // the design-system library, mirrored from disk
  themesPath: null,         // where the shell writes it back
  agent: { log: [], unseen: 0, lastAuthor: null, lastSeen: 0 },
  inRpc: false,
  rpcWrites: [],
  quietTimer: null,
  cursorTimer: null,
  saveTimer: null,
  revision: 0, epoch: crypto.randomUUID(), selectedSlides: new Set(), selectionAnchor: 0,
  persistedRaw: null, pendingSave: null, saving: null, conflict: false, rpcPending: new Set(),
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
let themesUI = null;  // the design-system chrome, built once the deck helpers exist
function designModeOpen() { return !!themesUI && themesUI.isOpen(); }
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
    skipHidden: state.presenting,
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
  if(state.selectedSlides.size<=1 && !state.selectedSlides.has(s.index))state.selectedSlides=new Set([s.index]);
  if (state.editing && stage.ok) { state.sel = stage.dek.edit.selected(); renderEltools(); }
  updateChrome();
  thumbs.setCurrent(s.index);
  if (!state.presenting) thumbs.scrollToCurrent();
  broadcastState();
});
stage.on('load', () => {
  layoutStage();
  if (state.editing && stage.ok) {
    stage.dek.edit.enable(true);state.sel=null;
    const sec=stage.win.document.querySelectorAll('.dek-slide')[state.index],paths=[];
    for(const id of state.restoreIds || []) { const el=sec?.querySelector(`[data-dek-id="${CSS.escape(id)}"]`);if(!el)continue;const path=[];let n=el;while(n!==sec){path.unshift([...n.parentElement.children].indexOf(n));n=n.parentElement;}paths.push(path); }
    if(paths.length)state.sel=stage.dek.edit.selectMany(paths);
    state.restoreIds=null;renderEltools();
  }
  if(state.pendingInsert) { const pending=state.pendingInsert;state.pendingInsert=null;insertHtml(pending.html,pending.options); }
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
  onSelect: (i,e) => selectSlide(i,e),
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
    const indices=state.selectedSlides.has(from)?selectedSlides():[from];
    to-=indices.filter(n=>n<to).length;
    clearDragState();
    batchSlides('move',indices,{to});
  },
  onDragEnd: clearDragState,
});
function clearDragState() {
  thumbs.items.forEach((it) => it.el.classList.remove('drop-before', 'drop-after', 'dragging'));
  state.drag = { from: -1 };
}

const ovThumbs = new Thumbs(els.ovgrid, {
  root: els.overview,
  onSelect: (i,e) => selectSlide(i,e),
  onOpen: (i) => { setOverview(false);goTo(i); },
  onMenu: (i,e)=>openContextMenu(i,e.clientX,e.clientY),
});

// ---------- deck loading & writes ----------

function loadDeck(doc, opts = {}) {
  const content=PRESENTER_MODE?doc.content:ensureObjectIds(doc.content);
  const m = parseDeck(content);
  const prev = state.deck;
  const samePath = prev && prev.path === doc.path;
  if(samePath && prev.model.raw!==content)state.revision++;
  state.persistedRaw=doc.content;
  state.deck = { name: doc.name || doc.path.split('/').pop(), path: doc.path, baseHref: doc.baseHref || baseHrefFor(doc.path), model: m };
  if (!samePath) { state.persistedRaw = doc.content; state.saving = null; state.pendingSave = null; state.conflict = false; state.epoch = crypto.randomUUID(); state.selectedSlides = new Set([0]); state.history = { past: [], future: [] }; state.index = 0; state.step = 0; }
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
  if(content!==doc.content)write(doc.path,content);
}

function write(path, content) {
  if (state.inRpc) { state.rpcWrites.push({ path, content, expected: path === state.deck?.path ? state.persistedRaw : undefined }); return; }
  if (path !== state.deck?.path) { send({ type:'save', path, content }); return; }
  state.pendingSave = { path, content }; pumpSave();
}
function pumpSave() {
  if (state.saving || state.rpcPending.size || !state.pendingSave || state.conflict) return;
  state.saving = state.pendingSave; state.pendingSave = null;
  setSaveState('saving');
  send({ type:'save', ...state.saving, expected:state.persistedRaw });
}
const revision = () => `${state.epoch}:${state.revision}`;
function syncElementIds() {
  if (!stage.ok || !model()?.slides[state.index]) return;
  const source = new DOMParser().parseFromString(model().slides[state.index].html,'text/html').querySelector('section');
  const live = stage.win.document.querySelectorAll('.dek-slide')[state.index];
  function walk(a,b) { if(!a || !b)return; if(a.dataset.dekId)b.dataset.dekId=a.dataset.dekId; Array.from(a.children).forEach((n,i)=>walk(n,b.children[i])); }
  walk(source,live);
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
  newRaw=ensureObjectIds(newRaw);
  if (!deck || newRaw === deck.model.raw) return false;
  if (!o.skipHistory) {
    if(!o.transaction || state.history.past.at(-1)?.transaction!==o.transaction) state.history.past.push({ raw: deck.model.raw, label: o.label || 'change', transaction:o.transaction });
    if (state.history.past.length > 80) state.history.past.shift();
    state.history.future = [];
  }
  const oldModel = deck.model;
  const oldSection=oldModel.slides[state.index] && new DOMParser().parseFromString(oldModel.slides[state.index].html,'text/html').querySelector('section');
  const oldSelection=(state.sel?.paths || []).map(p=>oldSection?.querySelector(pathTarget(p))).filter(Boolean);
  state.revision++;
  const m = parseDeck(newRaw);
  deck.model = m;
  let index = o.focusIndex !== undefined ? o.focusIndex : indexAfterChange(oldModel, m, state.index);
  index = clamp(index, 0, Math.max(0, m.slides.length - 1));
  state.restoreIds=index===state.index?oldSelection.flatMap(el=>el.matches('.dek-group')?[el.dataset.dekId,...el.querySelectorAll('[data-dek-id]')].map(n=>typeof n==='string'?n:n.dataset.dekId):[el.dataset.dekId]).filter(Boolean):[];
  const sameSlide = index === state.index && o.focusIndex === undefined;
  document.documentElement.style.setProperty('--deck-aspect', `${m.meta.size.w} / ${m.meta.size.h}`);
  if (o.noReload && stage.ok) {
    stage.model = m; // the live DOM already shows this change
    syncElementIds();
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
  if (stage.ok) stage.dek.edit.commitText();
  const h = state.history;
  const entry = h.past.pop();
  if (!entry || !state.deck) { toast('Nothing to undo'); return; }
  h.future.push({ raw: state.deck.model.raw, label: entry.label });
  applyRaw(entry.raw, { skipHistory: true });
  toast(`Undid ${entry.label}`);
}
function redo() {
  if (stage.ok) stage.dek.edit.commitText();
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
  els.empty.classList.toggle('show', (!state.deck || !n) && !state.settingsOpen && !designModeOpen() && !PRESENTER_MODE);
  $('emptyslide').hidden=!state.deck || n>0;
  if(!state.deck)els.empty.querySelector('.empty-hint').innerHTML='Open an HTML deck <kbd>⌘O</kbd> · New deck <kbd>⌘N</kbd>';
  renderThemes();
  renderSlideManagement();
  if (state.editing) renderEltools();
  els.frame.hidden = !state.deck;
  els.presentbtn.disabled = !n || !m.slides.some(s=>!s.skip);
  $('exportbtn').disabled = !n;
  els.editbtn.disabled = !state.deck;
  const path = state.deck ? state.deck.path : null;
  const title = m ? (m.meta.title || state.deck.name) : null;
  if (state.lastActive !== path+'|'+title) {
    state.lastActive = path+'|'+title;
    send({ type: 'active', path, name: title });
  }
}

function broadcastState() {
  const s = stage.state();
  const payload = { type: 'state', index: state.index, step: state.step, count: slideCount(), title: s ? s.title : '', presenting: state.presenting, startedAt:state.presentationStartedAt || null, blackout:state.blackout, atEnd:state.atEnd, timer:settings.timer, path: state.deck ? state.deck.path : null };
  send(payload);
  if (!isNative && !PRESENTER_MODE) devChannel.postMessage({ kind: 'follow', index: state.index, step: state.step });
}

function quietPill() {
  if(state.editing)return;
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

function goTo(i, step = 0, explicitHidden = false) {
  if (!state.deck) return;
  if(state.presenting && model().slides[i]?.skip && !explicitHidden) { toast('This slide is hidden. Use “Show hidden slide now” from its menu.');return; }
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
  if (on) { const visible=model().slides.findIndex((s,i)=>i>=state.index && !s.skip); if(visible<0) { toast('No visible slides from here. Show a slide first.'); return; } if(model().slides[state.index]?.skip) goTo(visible); }
  state.presenting = on;
  if(on)state.presentationStartedAt=Date.now();
  document.body.classList.toggle('presenting', on);
  if (on) {
    setEditing(false);
    setOverview(false);
    setSettingsOpen(false);
    setDesignOpen(false);
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
  stage.setOptions({ autoslide: on, skipHidden:on });
  layoutStage();
  broadcastState();
  stage.focus();
}

function setBlackout(kind) {
  state.blackout = kind;
  els.blackout.hidden = !kind;
  els.blackout.classList.toggle('white', kind === 'white');
  if(!PRESENTER_MODE)broadcastState();
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
  if (on) { setOverview(false); setSettingsOpen(false); setDesignOpen(false); setAgentOpen(false); }
  state.editing = on;
  document.body.classList.toggle('editing', on);
  els.editbtn.classList.toggle('active', on);
  els.editbtn.textContent = on ? 'Done' : 'Edit';
  els.insertbar.hidden = !on;
  $('inspector').hidden = !on;
  renderEltools();
  layoutStage();
  if (stage.ok) stage.dek.edit.enable(on);
  if (!on) { state.sel = null; renderEltools(); }
  else if (!store.get('dek.editHintShown', false)) { toast('Click to select · drag to move · double-click to edit text'); store.set('dek.editHintShown', true); }
  if (on) stage.focus();
}

const pathSelector = (path) => ':scope' + (path || []).map((i) => ` > :nth-child(${i + 1})`).join('');
const EDIT_LABELS = { style: 'move/resize', text: 'text edit', delete: 'delete element', retag: 'change type', attrs: 'element change', insert: 'insert' };

/** Apply an edit the runtime already performed on the live DOM to the model and the file. */
function onEditEvent(ev) {
  if(ev.type==='notice'){if(state.inRpc)throw new Error(ev.message);toast(ev.message);return;}
  if (ev.type === 'select') { state.sel=ev.info; renderEltools(); return; }
  const m=model(); if (!m?.slides[state.index]) return;
  try {
    const ops = ev.type === 'batch' ? ev.operations : [{ type: ev.type, target:ev.type==='insert'?':scope':ev.path, style:ev.style, attrs:ev.attrs, html:ev.html, tag:ev.tag }];
    const html=elementOperations(m.slides[state.index].html,ops);
    applyRaw(replaceSlide(m,state.index,html),{label:ev.label || EDIT_LABELS[ev.type] || 'edit elements',noReload:ev.type!=='batch',transaction:ev.transaction});
    if(ev.info!==undefined)state.sel=ev.info;
    renderEltools();
  } catch(e) { if(state.inRpc)throw e;toast(e.message || 'Could not apply edit'); stage.load(m,stageOpts(state.index,state.step)); }
}

const inspector=createInspector($('inspector'),{
  capture:()=>stage.ok && stage.dek.edit.captureTextSelection(),
  select:(path,add)=>stage.ok && stage.dek.edit.select(path,add),
  action:inspectorAction,
  field:inspectorField,
});
function renderEltools() {
  els.eltools.hidden=true;
  if(!state.editing || !stage.ok) return;
  const slide=model()?.slides[state.index];
  const sec=stage.win.document.querySelectorAll('.dek-slide')[state.index];
  inspector.render({snapping:stage.dek.edit.snapping(),info:state.sel, title:model()?.meta.title, layers:stage.dek.edit.layers(), slide:slide ? {number:state.index+1, notes:slide.notes, transition:slide.transition, hidden:slide.skip, background:sec ? stage.win.getComputedStyle(sec).backgroundColor : ''} : null});
}
function placeEltools() { renderEltools(); }
function inspectorAction(action) {
  if(!stage.ok) return;
  const ed=stage.dek.edit;
  if(['bold','italic','underline','strikeThrough','insertUnorderedList','insertOrderedList'].includes(action)) ed.format(action);
  else if(action==='clear') ed.clear();
  else if(action==='replace') pickImage(true);
  else if(action==='duplicate') { const html=ed.duplicate(); if(html)insertHtml(html); }
  else if(action==='delete') ed.deleteSelected();
  else if(action==='front' || action==='back') ed.arrange(action);
  else if(action==='centerX' || action==='centerY') ed.center(action==='centerX'?'x':'y');
  else if(action==='hideSlide') batchSlides(model().slides[state.index].skip?'show':'hide',[state.index]);
  else if(action==='group') ed.group();
  else if(action==='ungroup') ed.ungroup();
  else if(action==='lock') ed.lock(!state.sel?.locked);
  else if(action.startsWith('align-')) ed.align(action.slice(6));
  else if(action.startsWith('distribute-')) ed.distribute(action.slice(11));
  else if(action==='snap') ed.snap(!ed.snapping());
  state.sel=ed.selected(); renderEltools();
}
function inspectorField(key,value,field) {
  if(!stage.ok || !state.deck)return;
  const ed=stage.dek.edit;
  if(key==='title') { ed.commitText(); applyRaw(setTitle(model(),value),{label:'deck title'}); return; }
  if(['notes','slideBackground','transition'].includes(key)) {
    ed.commitText(); const m=model(); let html=m.slides[state.index]?.html; if(!html)return;
    if(key==='notes') html=setNotes(html,value?'<span>'+esc(value).replace(/\n/g,'<br>')+'</span>':'');
    if(key==='transition') html=setSlideAttrs(html,{'data-transition':value || null});
    if(key==='slideBackground') { if(!CSS.supports('background',value)) { toast('Enter a color name or hex code, such as navy or #D9B65A'); return; } html=updateElement(html,{selector:':scope',style:{background:value}}).html; }
    applyRaw(replaceSlide(m,state.index,html),{label:key==='notes'?'speaker notes':'slide settings'}); return;
  }
  if(key==='cropRatio') { const ratio=Number(value);if(ratio>0)ed.setStyle({height:(state.sel.width/ratio)+'px','object-fit':'cover'});return; }
  if(key==='alt') { ed.setAttrs({alt:value}); return; }
  if(key==='link') { if(value && !/^(https?:|mailto:|#)/i.test(value)){toast('Use a web address (https://…), email link (mailto:…), or slide link (#slide-id)');return;} ed.link(value); return; }
  if(key==='x' || key==='y') { ed.geometry(key,value); return; }
  if(key==='crop-x' || key==='crop-y') { const pos=(state.sel?.objectPosition || '50% 50%').split(' '); pos[key==='crop-x'?0:1]=value+'%'; ed.setStyle({'object-position':pos.join(' ')}); return; }
  if(key==='aspect') { ed.setAttrs({'data-dek-aspect':value}); return; }
  const px=['font-size','letter-spacing','border-radius','border-width','width','height'];
  const cssKey=key==='textHighlight'?'background-color':key;
  const cssValue=px.includes(key)?value+'px':key==='rotate'?value+'deg':key==='opacity'?String(value/100):String(value);
  if(!CSS.supports(cssKey,cssValue)) { toast(`${field?.getAttribute('aria-label') || 'Value'}: ${['color','textHighlight','background-color','border-color'].includes(key)?'use a color name, hex code, or transparent':'enter a valid value for this setting'}`); field?.setAttribute('aria-invalid','true'); return; }
  const style={[cssKey]:cssValue};
  if(key==='border-width')style['border-style']='solid';
  if(['width','height'].includes(key) && state.sel?.kind==='image' && state.sel.aspect!==false) { style[key==='width'?'height':'width']=(key==='width'?value*state.sel.height/state.sel.width:value*state.sel.width/state.sel.height)+'px'; }
  if(['color','font-family','font-size','font-weight','textHighlight','letter-spacing','text-transform'].includes(key))ed.textStyle(style); else ed.setStyle(style);
  state.sel=ed.selected(); renderEltools();
}

let insertCount = 0;
function insertHtml(html, { text } = {}) {
  if (!state.deck) return;
  if (!state.editing) setEditing(true);
  if (!stage.ok || !model().slides.length) { state.pendingInsert={html,options:{text}};if(!model().slides.length)addSlideAfter(-1,layoutHTML('blank'));return; }
  html=new DOMParser().parseFromString(freshSlide('<section>'+html+'</section>',[]),'text/html').querySelector('section').innerHTML;
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
function insertImage() { pickImage(false); }
function pickImage(replace = false) {
  if (!state.deck) return;
  if (!state.editing) setEditing(true);
  state.replaceImage = replace && state.sel?.kind==='image' ? {path:state.deck.path,slide:model().slides[state.index].id,id:state.sel.id} : null;
  if (isNative) { send({ type: 'pickImage' }); return; }
  // dev harness: read the file locally
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.addEventListener('change', () => {
    const f = input.files && input.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => imagePicked({ src: reader.result, size: {}, name:f.name });
    reader.readAsDataURL(f);
  });
  input.click();
}
function imagePicked(info) {
  if (!info || !info.src) return;
  if (!state.deck) return;
  if (!state.editing) setEditing(true);
  const replacement=state.replaceImage;state.replaceImage=null;
  if(replacement) {
    const m=model(),i=m.slides.findIndex(s=>s.id===replacement.slide);
    if(state.deck.path!==replacement.path || i<0){toast('The original image is no longer available');return;}
    try {
      const html=elementOperations(m.slides[i].html,[{type:'attrs',target:`[data-dek-id="${replacement.id}"]`,attrs:{src:info.src}}]);
      applyRaw(replaceSlide(m,i,html),{label:'replace image'});toast('Image replaced');
    } catch(e){toast(e.message);}
    return;
  }
  const o = insertOffset();
  const natural = info.size && info.size.width ? Math.min(info.size.width, 960) : 800;
  insertHtml(`<img src="${info.src.replace(/"/g, '&quot;')}" alt="" style="position: absolute; left: ${o.x}px; top: ${o.y}px; width: ${natural}px; height: auto;">`);
  toast('Image added', 'drag to move');
}

els.insertbar.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-insert]');
  if (!btn) return;
  ({ text: insertText, heading: insertHeading, image: insertImage, shape: () => showInsertMenu('shape') })[btn.dataset.insert]?.();
});
els.editbtn.addEventListener('click', () => setEditing(!state.editing));
window.addEventListener('resize', placeEltools);
window.addEventListener('resize', () => themesUI && themesUI.fit());

// ---------- overview (light table) ----------

function setOverview(on) {
  if (on === state.overview) return;
  if (on) { setEditing(false); setDesignOpen(false); }
  state.overview = on;
  els.overview.hidden = !on;
  document.body.classList.toggle('overview-open', on);
  if (on && state.deck) {
    ovThumbs.render(model(), { baseHref: state.deck.baseHref, current: state.index, force: true });
    renderSlideManagement();requestAnimationFrame(() => ovThumbs.scrollToCurrent());
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
  const copy = freshSlide(src.html, takenIds());
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
  applyRaw(replaceSlide(m, i, html), { label: s.skip ? 'show slide' : 'hide slide' });
  toast(s.skip ? `Slide ${i + 1} shown` : `Slide ${i + 1} hidden`, '⌘Z');
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
    { label: state.presenting && model().slides[i].skip?'Show hidden slide now':'Present From Here', hint: '', run: () => { goTo(i,0,state.presenting); setPresenting(true); } },
    { label: (model().slides[i] && model().slides[i].skip) ? 'Show Slide' : 'Hide Slide', hint: '', run: () => toggleSkip(i) },
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
  if(open && state.editing)setEditing(false);
  state.agentOpen = open;
  document.body.classList.toggle('agent-open', open);
  els.agentbtn.classList.toggle('active', open);
  if (open) { state.agent.unseen = 0; renderAgent(); }
}

function setSettingsOpen(open) {
  if (open) { setEditing(false); setDesignOpen(false); }
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

// ---------- design systems ----------

// The library lives outside every deck (the app's support folder) so one
// system can dress them all; a deck only records which system and which
// version of it was last applied.

const themeList = () => state.themes.themes;

/** The system on the open deck, plus whether the library has moved past it. */
function activeTheme() {
  const m = model();
  if (!m) return null;
  const mark = readDeckTheme(m.raw);
  if (!mark) return null;
  const theme = findTheme(state.themes, mark.id);
  if (!theme) return null;
  return { theme, appliedVersion: mark.version, stale: currentVersion(theme) > mark.version };
}

function persistThemes() {
  const content = JSON.stringify(state.themes, null, 2);
  // inside an agent call the shell hands writes to the app so the file is on
  // disk before the agent gets its answer; otherwise post it straight over
  if (state.inRpc && state.themesPath) state.rpcWrites.push({ path: state.themesPath, content });
  else send({ type: 'themesSave', content });
}

function setLibrary(library) {
  state.themes = library;
  persistThemes();
  renderThemes();
}

function renderThemes() { if (themesUI) themesUI.render(); }

function needTheme(id) {
  const theme = findTheme(state.themes, id);
  if (!theme) throw new Error(`No design system "${id}". list_themes shows what exists.`);
  return theme;
}

function versionOf(theme, version) {
  const entry = theme.versions.find((v) => v.v === (version | 0));
  if (!entry) throw new Error(`“${theme.name}” has no version ${version}; it has ${theme.versions.map((v) => v.v).join(', ')}.`);
  return entry;
}

function applyThemeToDeck(id, o = {}) {
  const m = needDeck();
  const theme = needTheme(id);
  // variables the deck's own CSS reads that this system will not define
  const orphans = missingVars(m.raw, currentSystem(theme));
  const changed = applyRaw(applyThemeToRaw(m.raw, theme), { label: `design system: ${theme.name}` });
  renderThemes();
  if (!o.quiet) {
    if (changed && orphans.length) toast(`${theme.name} applied · ${orphans.length} variable${orphans.length === 1 ? '' : 's'} this deck uses (${orphans.slice(0, 3).join(', ')}) are not in it`, '⌘Z');
    else toast(changed ? `${theme.name} v${currentVersion(theme)} applied` : `${theme.name} is already on this deck`, changed ? '⌘Z' : '');
  }
  return { id: theme.id, name: theme.name, version: currentVersion(theme), changed, missing_vars: orphans };
}

function detachTheme(o = {}) {
  const m = needDeck();
  const was = activeTheme();
  const changed = applyRaw(removeThemeFromRaw(m.raw), { label: 'remove design system' });
  renderThemes();
  if (!o.quiet) toast(changed ? `${was ? was.theme.name : 'Design system'} removed from this deck` : 'This deck has no design system', changed ? '⌘Z' : '');
  return { removed: was ? was.theme.id : null, changed };
}

/** Start a system from the look a deck already has: its :root tokens, fonts and components. */
function captureThemeFromDeck(o = {}) {
  const m = needDeck();
  const system = captureSystem(m.raw);
  system.components = deckOwnedComponents(m.raw);
  const name = o.name || (m.meta.title || state.deck.name.replace(/\.html?$/i, '')).slice(0, 40);
  const { library, theme } = createTheme(state.themes, {
    name,
    description: o.description || `Captured from ${state.deck.name}`,
    system,
    note: `captured from ${state.deck.name}`,
  });
  setLibrary(library);
  return theme;
}

/** Write a system's composition next to the deck, as a standalone page. */
function saveThemeDoc(id, html) {
  const theme = needTheme(id);
  const safe = theme.name.replace(/[\\/:*?"<>|]/g, '-').trim() || theme.id;
  const dir = state.deck ? state.deck.path.replace(/[^/]*$/, '') : null;
  if (!dir) { toast('Open a deck first: the file is written next to it'); return null; }
  const path = `${dir}${safe} — design system.html`;
  if (state.inRpc) state.rpcWrites.push({ path, content: html });
  else write(path, html);
  toast(`Saved “${path.split('/').pop()}” next to the deck`);
  return path;
}

/** Hand the conversation back to Claude Code with a prompt that already has the context. */
function askClaudeForTheme(id) {
  const theme = id ? findTheme(state.themes, id) : null;
  const prompt = theme
    ? `In Dek, let's work on the design system "${theme.name}" (id: ${theme.id}). Read it with get_theme_system, show me what it does today, then change it with update_theme and apply_theme and check the result with snapshot_slide. What I want to change: `
    : `In Dek, design a visual system for my slides with me. Call list_theme_tokens to see every token you can set and get_theme to see what this deck does today, then create_theme, apply_theme, and snapshot_slide to check your work. The look I am after: `;
  navigator.clipboard.writeText(prompt).then(
    () => toast('Prompt copied — paste it into Claude Code', '⌘V'),
    () => toast('Ask Claude Code to design a system for you'),
  );
  setAgentOpen(true);
}

themesUI = createThemesUI({
  els,
  actions: {
    list: themeList,
    active: activeTheme,
    apply: (id) => { try { applyThemeToDeck(id); } catch (e) { toast(e.message || String(e)); } },
    detach: () => { try { detachTheme(); } catch (e) { toast(e.message || String(e)); } },
    remove: (id) => {
      try {
        const { library, theme } = deleteTheme(state.themes, id);
        setLibrary(library);
        toast(`Deleted “${theme.name}”`);
      } catch (e) { toast(e.message || String(e)); }
    },
    rename: (id, patch) => {
      const theme = findTheme(state.themes, id);
      if (!theme) return;
      if (patch.name !== undefined && patch.name.trim() === theme.name) return;
      if (patch.description !== undefined && patch.description === theme.description) return;
      try { setLibrary(updateTheme(state.themes, id, patch).library); } catch (e) { toast(e.message || String(e)); }
    },
    revert: (id, version) => {
      try {
        const { library, theme } = revertTheme(state.themes, id, version);
        setLibrary(library);
        toast(`“${theme.name}” restored to v${version} as v${currentVersion(theme)}`);
      } catch (e) { toast(e.message || String(e)); }
    },
    duplicate: (id) => {
      try {
        const { library, theme } = duplicateTheme(state.themes, id);
        setLibrary(library);
        toast(`Copied to “${theme.name}”`);
      } catch (e) { toast(e.message || String(e)); }
    },
    capture: () => {
      try {
        const theme = captureThemeFromDeck();
        themesUI.select(theme.id);
        toast(`Captured “${theme.name}” — Apply to Deck when you are ready`);
      } catch (e) { toast(e.message || String(e)); }
    },
    ask: (id) => askClaudeForTheme(id),
    save: (id, html) => saveThemeDoc(id, html),
    showNav: () => { if (!state.navOpen) setNavOpen(true); },
  },
});

/** Design mode: the sidebar lists systems and the stage can show a composition. */
function setDesignOpen(open) {
  if (open === designModeOpen()) return;
  if (open) { setSettingsOpen(false); setOverview(false); setEditing(false); }
  themesUI.setOpen(open);
  updateChrome();
  if (!open) stage.focus();
}

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
  { label: 'Present From Start', hint: '⌥⌘⏎', run: () => { goTo(model()?.slides.findIndex(s=>!s.skip) ?? 0); setPresenting(true); } },
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
  { label: model()?.slides[state.index]?.skip?'Show slide':'Hide slide', hint: '', run: () => batchSlides(model()?.slides[state.index]?.skip?'show':'hide') },
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
  ...themeList().map((t) => ({ label: `Design System: ${t.name}`, hint: `v${currentVersion(t)}`, run: () => { try { applyThemeToDeck(t.id); } catch (e) { toast(e.message || String(e)); } } })),
  { label: 'Design Systems…', hint: '⌥⌘D', run: () => setDesignOpen(true) },
  { label: 'Remove Design System From Deck', hint: '', run: () => { try { detachTheme(); } catch (e) { toast(e.message || String(e)); } } },
  { label: 'Capture This Deck’s Look as a Design System', hint: '', run: () => { try { const t = captureThemeFromDeck(); toast(`Saved “${t.name}” — apply it from the design system menu`); } catch (e) { toast(e.message || String(e)); } } },
  { label: 'Settings…', hint: '⌘,', run: () => setSettingsOpen(!state.settingsOpen) },
  { label: 'Keyboard Shortcuts', hint: '⌘/', run: () => setShortcutsOpen(els.shortcuts.hidden) },
  { label: 'Chrome: Stage (dark)', hint: '', run: () => applyTheme('dark') },
  { label: 'Chrome: Daylight (light)', hint: '', run: () => applyTheme('light') },
  { label: 'Chrome: Follow System', hint: '', run: () => applyTheme('system') },
];

const palette = createPalette({
  root: els.quickopen, input: els.qoinput, list: els.qolist, empty: els.qoempty,
  commands: () => state.presenting ? [...COMMANDS().filter(c=>['Presenter View','Black Screen','Go to Slide…','Next Slide','Previous Slide','First Slide','Last Slide'].includes(c.label)),{label:'Stop presenting',run:()=>setPresenting(false)},...model().slides.filter(s=>s.skip).map(s=>({label:`Show hidden slide ${s.index+1} now: ${s.title}`,run:()=>goTo(s.index,0,true)}))] : COMMANDS(),
  slides: () => (model() ? model().slides.map((s) => ({ index: s.index, title: s.title, current: s.index === state.index })) : []),
  onSlide: (i) => goTo(i),
  onClose: () => stage.focus(),
});

// ---------- keyboard ----------

function escapeKey() {
  if (!$('workspacepopover').hidden) { $('workspacepopover').hidden=true; return true; }
  if (!els.ctxmenu.hidden) { closeContextMenu(); return true; }
  if (themesUI.escape()) { updateChrome(); stage.focus(); return true; }
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
  if (e.altKey && k === 'd') return 'themes';
  if (e.altKey) return null;
  const table = {
    'k': 'palette', 'p': e.shiftKey ? 'palette' : 'goto', '\\': 'nav', 'j': 'agent', ',': 'settings', '/': 'shortcuts',
    'r': 'reload', 'd': 'duplicate', 'Backspace': 'delete', 'Enter': 'present', 'z': e.shiftKey ? 'redo' : 'undo',
    's':'save', 'g':e.shiftKey?'ungroup':'group', 'o': e.shiftKey ? 'overview' : 'open', 'n': e.shiftKey ? 'newSlide' : 'newDeck', 'e': e.shiftKey?'export':'edit',
  };
  return table[k] || null;
};

function onKey(e) {
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
  if (PRESENTER_MODE) return presenterKey(e);
  const mod = e.metaKey || e.ctrlKey;
  if (mod) {
    if(e.key.toLowerCase()==='a'){e.preventDefault();if(state.editing && stage.ok && !e.target.closest?.('#nav,#overview')){stage.dek.edit.selectMany(stage.dek.edit.layers().map(l=>l.path));}else{state.selectedSlides=new Set(model()?.slides.map(s=>s.index)||[]);renderSlideManagement();}return;}
    if(['c','x','v'].includes(e.key.toLowerCase()) && !e.altKey) { if(e.key.toLowerCase()!=='v') { e.preventDefault(); copySelection(e.key.toLowerCase()==='x'); } return; }
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
const PRESENTING_OK = new Set(['palette', 'next', 'prev', 'first', 'last', 'gotoIndex', 'blackout', 'stop', 'present', 'presentStart', 'presenter', 'escape', 'closeOverlays', 'goto']);
function command(name, arg) {
  if (state.presenting && !PRESENTING_OK.has(name)) return;
  switch (name) {
    case 'palette': palette.open({ command: true }); break;
    case 'goto': palette.open(); break;
    case 'nav': setNavOpen(!state.navOpen); break;
    case 'agent': setAgentOpen(!state.agentOpen); break;
    case 'settings': setSettingsOpen(!state.settingsOpen); break;
    case 'themes': setDesignOpen(!designModeOpen()); break;
    case 'themesPanel': setDesignOpen(true); break;
    case 'shortcuts': setShortcutsOpen(els.shortcuts.hidden); break;
    case 'reload': send({ type: 'reload' }); break;
    case 'duplicate': if (state.editing && state.sel) inspectorAction('duplicate'); else if (state.deck) batchSlides('duplicate'); break;
    case 'delete': if (state.deck) batchSlides('delete'); break;
    case 'newSlide': if (state.deck) showInsertMenu('slide'); break;
    case 'moveUp': if (state.deck) moveSlideTo(state.index, state.index - 1); break;
    case 'moveDown': if (state.deck) moveSlideTo(state.index, state.index + 1); break;
    case 'present': setPresenting(!state.presenting); break;
    case 'presentStart': goTo(model()?.slides.findIndex(s=>!s.skip) ?? 0); setPresenting(true); break;
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
    case 'skip': if (state.deck) batchSlides(model().slides[state.index]?.skip?'show':'hide'); break;
    case 'export': showExportMenu(); break;
    case 'save': if(stage.ok)stage.dek.edit.commitText(); if(state.deck)write(state.deck.path,model().raw); break;
    case 'group': if(stage.ok)stage.dek.edit.group(); break;
    case 'ungroup': if(stage.ok)stage.dek.edit.ungroup(); break;
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
  return { n: s.index + 1, id: s.id, title: s.title, notes: s.notes ? s.notes.slice(0, 160) : '', fragments: s.fragments, transition: s.transition, autoAnimate: s.autoAnimate, section:s.section, skip: !!s.skip };
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

/** The raw CSS-level look of the open deck (what get_theme reports). */
function deckStyleSummary(m) {
  const vars = themeVars(m);
  const css = structure(m.raw).styles.map((r) => m.raw.slice(r.start, r.end)).join('\n');
  const fonts = Array.from(new Set((css.match(/font-family\s*:\s*([^;}]+)/g) || []).map((f) => f.replace(/font-family\s*:\s*/, '').trim())));
  const colors = Array.from(new Set(css.match(/(?:oklch|oklab|rgba?|hsla?)\([^)]*\)|#[0-9a-fA-F]{3,8}\b/g) || [])).slice(0, 24);
  const links = Array.from(m.headInner.matchAll(/<link[^>]*href=["']([^"']+)["'][^>]*>/gi)).map((x) => x[1]);
  return { vars, fonts, colors, stylesheets: links, styleBlocks: structure(m.raw).styles.length };
}


function slideRef(args) {
  const m = needDeck();
  const i = resolveSlide(m, args.slide, state.index);
  if (!m.slides[i]) throw new Error(`No slide ${typeof args.slide === 'number' ? args.slide : i + 1} (the deck has ${m.slides.length})`);
  return i;
}

function sourceTargets(html,selector,all) {
  if(selector===':scope' || selector==='section')return [':scope'];
  const sec=new DOMParser().parseFromString(html,'text/html').querySelector('section');
  const nodes=[...sec.querySelectorAll(selector)];if(!nodes.length)throw new Error(`No element matches ${selector}`);
  return (all?nodes:nodes.slice(0,1)).map(el=>{const path=[];let n=el;while(n!==sec){path.unshift([...n.parentElement.children].indexOf(n));n=n.parentElement;}return path;});
}

function updateSlideHtml(i, html, label) {
  const m = needDeck();
  applyRaw(replaceSlide(m, i, html), { label, focusIndex: i });
}

const TOOLS = {
  _validate_mutation() { return {result:{valid:true}}; },
  get_selection() {
    return {result:{slide:state.index+1,elements:state.sel ? (state.sel.paths || [state.sel.path]).map(path=>({path,selector:pathTarget(path)})) : [],info:state.sel,selected_slides:selectedSlides().map(i=>i+1)}};
  },
  edit_elements(a) {
    const i=slideRef(a);if(!Array.isArray(a.operations) || !a.operations.length)throw new Error('operations are required');
    updateSlideHtml(i,elementOperations(needDeck().slides[i].html,a.operations),a.label || 'agent: edit elements');
    return {result:{n:i+1,operations:a.operations.length},summary:'edited slide elements',slide:i};
  },
  copy_slides(a) {
    if(!a.content)throw new Error('Source deck could not be read');const source=parseDeck(a.content);
    const indices=(a.slides || source.slides.map(s=>s.index+1)).map(ref=>resolveSlide(source,ref,0));
    if(indices.some(i=>!source.slides[i]))throw new Error('Source slide not found');
    const at=a.at===undefined?state.index+1:clamp(a.at-1,0,slideCount());
    applyRaw(copySlidesInto(needDeck(),{html:indices.map(i=>source.slides[i].html).join('\n'),head:transferHead(source)},at),{label:'copy slides from deck',focusIndex:at});
    return{result:{copied:indices.length,source:a.source},summary:`copied ${indices.length} slides from another deck`};
  },
  async select_elements(a) {
    const i=slideRef(a);setEditing(true);const deadline=Date.now()+5000;
    while(!stage.ok){if(Date.now()>deadline)throw new Error('Renderer is not ready');await new Promise(r=>setTimeout(r,20));}
    stage.go(i,0,{instant:true});
    const sec=stage.win.document.querySelectorAll('.dek-slide')[i];
    const paths=(a.selectors || []).map(selector=>{const el=sec.querySelector(selector);if(!el)throw new Error(`No element matches ${selector}`);const path=[];let n=el;while(n!==sec){path.unshift([...n.parentElement.children].indexOf(n));n=n.parentElement;}return path;});
    state.sel=stage.dek.edit.selectMany(paths);if(paths.length && !state.sel)throw new Error('The objects could not be selected');return TOOLS.get_selection();
  },
  async arrange_elements(a) {
    await TOOLS.select_elements(a);const ed=stage.dek.edit;
    if(a.action==='group'){if(state.sel?.count<2)throw new Error('Select at least two objects to group');ed.group();}else if(a.action==='ungroup')ed.ungroup();
    else if(a.action==='lock'||a.action==='unlock')ed.lock(a.action==='lock');
    else if(a.action==='front'||a.action==='back')ed.arrange(a.action);
    else if(a.action==='resize')ed.setStyle({...((a.width>0)?{width:a.width+'px'}:{}),...((a.height>0)?{height:a.height+'px'}:{})});
    else if(a.action==='nudge')ed.nudge(Number(a.x)||0,Number(a.y)||0);
    else if(a.action==='distribute')ed.distribute(a.axis==='y'?'y':'x');
    else if(['left','right','top','bottom','center','middle'].includes(a.action))ed.align(a.action);
    else throw new Error('Unknown arrangement action');
    return{result:{n:state.index+1},summary:`${a.action} elements`};
  },
  set_slide_visibility(a) {
    const m=needDeck(),indices=(a.slides || [a.slide ?? state.index+1]).map(ref=>resolveSlide(m,ref,state.index));
    applyRaw(slideOperations(m,indices,a.hidden?'hide':'show'),{label:a.hidden?'hide slides':'show slides'});
    return {result:{slides:indices.map(i=>i+1),hidden:!!a.hidden},summary:a.hidden?'hid slides':'showed slides'};
  },
  batch_slides(a) {
    const m=needDeck(),indices=(a.slides || []).map(ref=>resolveSlide(m,ref,state.index));
    applyRaw(slideOperations(m,indices,a.action,{to:a.to===undefined?0:a.to-1,id:a.section_id}),{label:`agent: ${a.action} slides`});
    return {result:{count:slideCount()},summary:`${a.action} slides`};
  },
  manage_section(a) {
    if(a.action==='create'){const id=changeSection(null,{name:a.name});return{result:{id},summary:'created a section'};}
    if(a.action==='rename'){changeSection(a.id,{name:a.name});return{result:{id:a.id},summary:'renamed section'};}
    if(a.action==='remove'){
      const m=needDeck(),indices=m.slides.filter(s=>s.section===a.id).map(s=>s.index);let raw=m.raw;
      if(indices.length)raw=slideOperations(m,indices,'section',{id:null});
      const next=parseDeck(raw),meta=documentMeta(next);meta.sections=meta.sections.filter(g=>g.id!==a.id);applyRaw(setDocumentMeta(next,meta),{label:'remove section'});return{result:{removed:a.id},summary:'removed section'};
    }
    if(a.action==='reorder'){const meta=documentMeta(needDeck()),from=meta.sections.findIndex(g=>g.id===a.id);if(from<0)throw new Error('Section not found');const[g]=meta.sections.splice(from,1);meta.sections.splice(clamp((a.to || 1)-1,0,meta.sections.length),0,g);applyRaw(reorderSections(model(),meta.sections),{label:'reorder sections'});return{result:{id:a.id},summary:'reordered section'};}
    throw new Error('Use create, rename, reorder, or remove');
  },
  add_shape(a) {
    const i=slideRef(a),html=elementOperations(needDeck().slides[i].html,[{type:'insert',target:':scope',html:shapeHTML(a)}]);
    updateSlideHtml(i,html,'agent: add shape');return{result:{n:i+1},summary:'added shape',slide:i};
  },
  import_image(a) {
    if(!a.src)throw new Error('Image could not be imported');const i=slideRef(a);
    const html=`<img alt="${esc(a.alt || '')}" src="${esc(a.src)}" style="position:absolute;left:${Number(a.x)||240}px;top:${Number(a.y)||240}px;width:${Number(a.width)||800}px;height:auto;">`;
    updateSlideHtml(i,elementOperations(needDeck().slides[i].html,[{type:'insert',target:':scope',html}]),'agent: import image');return{result:{n:i+1,src:a.src},summary:'imported image',slide:i};
  },
  undo() { undo();return{result:{undone:true},summary:'undid last edit'}; },
  redo() { redo();return{result:{redone:true},summary:'redid last edit'}; },

  get_deck() {
    const m = needDeck();
    return { result: {
      revision:revision(), sections:documentMeta(m).sections, path: state.deck.path, name: state.deck.name, title: m.meta.title, size: m.meta.size,
      transition: m.meta.transition || settings.transition, count: m.slides.length, current: state.index + 1,
      slides: m.slides.map(slideSummary), components: componentRanges(m.raw).map((c) => ({ name: c.name, description: c.description, vars: c.vars })),
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
      const c = componentRanges(m.raw).find((x) => x.name === a.component);
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
    updateSlideHtml(i, elementOperations(needDeck().slides[i].html,[{type:'insert',target:a.selector || ':scope',html:a.html,position:a.position}]), 'agent: add element');
    return { result: { n: i + 1 }, summary: `added an element to slide ${i + 1}`, slide: i };
  },
  update_element(a) {
    const i = slideRef(a);
    if (!a.selector) throw new Error('selector is required');
    const targets=sourceTargets(needDeck().slides[i].html,a.selector,a.all);
    const r={html:elementOperations(needDeck().slides[i].html,[{...a,type:'update',targets}]),count:targets.length};
    updateSlideHtml(i, r.html, 'agent: update element');
    return { result: { n: i + 1, updated: r.count }, summary: `updated ${r.count} element${r.count === 1 ? '' : 's'} (${a.selector}) on slide ${i + 1}`, slide: i };
  },
  delete_element(a) {
    const i = slideRef(a);
    if (!a.selector) throw new Error('selector is required');
    const targets=sourceTargets(needDeck().slides[i].html,a.selector,a.all);
    const r={html:elementOperations(needDeck().slides[i].html,[{type:'delete',targets}]),count:targets.length};
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
  get_theme() { return { result: deckStyleSummary(needDeck()) }; },
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
  // ---- design systems ----
  list_themes() {
    const active = activeTheme();
    return { result: {
      themes: themeList().map(themeSummary),
      active: active ? { id: active.theme.id, name: active.theme.name, applied_version: active.appliedVersion, current_version: currentVersion(active.theme), stale: active.stale } : null,
      slots: { used: themeList().length, max: MAX_THEMES },
      deck: state.deck ? state.deck.path : null,
    } };
  },
  list_theme_tokens() {
    return { result: { guide: TOKEN_GUIDE, defaults: DEFAULT_SYSTEM, max_systems: MAX_THEMES } };
  },
  get_theme_system(a) {
    const theme = a.id ? needTheme(a.id) : (activeTheme() || {}).theme;
    if (!theme) throw new Error('This deck has no design system. Pass an id, or call list_themes.');
    return { result: {
      id: theme.id, name: theme.name, description: theme.description,
      version: currentVersion(theme), created_at: theme.createdAt, updated_at: theme.updatedAt,
      history: theme.versions.map((v) => ({ version: v.v, at: v.at, note: v.note })),
      system: a.version ? versionOf(theme, a.version).system : currentSystem(theme),
    } };
  },
  preview_theme_css(a) {
    let system = a.system ? normalizeSystem(a.system) : null;
    if (!system) {
      const theme = a.id ? needTheme(a.id) : (activeTheme() || {}).theme;
      if (!theme) throw new Error('Pass id or system, or apply a design system to this deck first.');
      system = a.version ? versionOf(theme, a.version).system : currentSystem(theme);
    }
    return { result: { css: compileSystemCss(system), chart_defaults: chartDefaults(system) } };
  },
  create_theme(a) {
    if (!a.name) throw new Error('name is required');
    const { library, theme } = createTheme(state.themes, { name: a.name, description: a.description, system: a.system, note: a.note || 'created' });
    setLibrary(library);
    const applied = a.apply !== false && state.deck ? applyThemeToDeck(theme.id, { quiet: true }) : null;
    return {
      result: { id: theme.id, name: theme.name, version: 1, applied: !!applied, slots_left: MAX_THEMES - library.themes.length },
      summary: `created the design system “${theme.name}”${applied ? ' and applied it' : ''}`,
    };
  },
  update_theme(a) {
    if (!a.id) throw new Error('id is required (list_themes shows them)');
    needTheme(a.id);
    const { library, theme } = updateTheme(state.themes, a.id, {
      system: a.system, replace: !!a.replace, name: a.name, description: a.description, note: a.note,
    });
    setLibrary(library);
    const wasActive = (activeTheme() || {}).theme;
    const applied = a.apply !== false && state.deck && wasActive && wasActive.id === theme.id ? applyThemeToDeck(theme.id, { quiet: true }) : null;
    return {
      result: { id: theme.id, version: currentVersion(theme), versions: theme.versions.length, applied: !!applied },
      summary: `updated “${theme.name}” to v${currentVersion(theme)}${applied ? ' and re-applied it' : ''}`,
    };
  },
  delete_theme(a) {
    if (!a.id) throw new Error('id is required');
    const { library, theme } = deleteTheme(state.themes, a.id);
    setLibrary(library);
    return { result: { deleted: theme.id, slots_left: MAX_THEMES - library.themes.length }, summary: `deleted the design system “${theme.name}”` };
  },
  duplicate_theme(a) {
    if (!a.id) throw new Error('id is required');
    const { library, theme } = duplicateTheme(state.themes, a.id, a.name);
    setLibrary(library);
    return { result: { id: theme.id, name: theme.name }, summary: `copied “${a.id}” to “${theme.name}”` };
  },
  revert_theme(a) {
    if (!a.id || a.version === undefined) throw new Error('id and version are required');
    const { library, theme } = revertTheme(state.themes, a.id, a.version);
    setLibrary(library);
    const wasActive = (activeTheme() || {}).theme;
    if (a.apply !== false && state.deck && wasActive && wasActive.id === theme.id) applyThemeToDeck(theme.id, { quiet: true });
    return { result: { id: theme.id, version: currentVersion(theme), restored: a.version | 0 }, summary: `restored “${theme.name}” to v${a.version} (now v${currentVersion(theme)})` };
  },
  apply_theme(a) {
    const id = a.id || (activeTheme() || {}).theme?.id;
    if (!id) throw new Error('id is required (list_themes shows them)');
    const r = applyThemeToDeck(id, { quiet: true });
    if (r.missing_vars.length) r.note = `This deck's CSS reads ${r.missing_vars.length} custom propert${r.missing_vars.length === 1 ? 'y' : 'ies'} the system does not define (${r.missing_vars.join(', ')}); those rules will not resolve. Either rewrite them against the system's tokens or add the values to the system's \`css\`.`;
    return { result: r, summary: `applied “${r.name}” v${r.version} to the deck${r.missing_vars.length ? ` (${r.missing_vars.length} unresolved variable${r.missing_vars.length === 1 ? '' : 's'})` : ''}` };
  },
  remove_theme() {
    const r = detachTheme({ quiet: true });
    return { result: r, summary: r.changed ? 'removed the design system from the deck' : 'the deck had no design system' };
  },
  export_theme(a) {
    const theme = a.id ? needTheme(a.id) : (activeTheme() || {}).theme;
    if (!theme) throw new Error('Pass an id, or apply a design system to this deck first.');
    const html = composeDocument(theme);
    if (a.path) {
      if (!/^\//.test(a.path) || !/\.html?$/i.test(a.path)) throw new Error('path must be an absolute path ending in .html');
      state.rpcWrites.push({ path: a.path, content: html });
      return { result: { id: theme.id, path: a.path, bytes: html.length }, summary: `wrote the “${theme.name}” composition to ${a.path.split('/').pop()}` };
    }
    const path = saveThemeDoc(theme.id, html);
    return { result: { id: theme.id, path, bytes: html.length }, summary: `wrote the “${theme.name}” composition${path ? ` to ${path.split('/').pop()}` : ''}` };
  },
  capture_theme(a) {
    const theme = captureThemeFromDeck({ name: a.name, description: a.description });
    return {
      result: { id: theme.id, name: theme.name, system: currentSystem(theme), slots_left: MAX_THEMES - state.themes.themes.length },
      summary: `captured this deck’s look as the design system “${theme.name}”`,
    };
  },
  list_components() { return { result: componentRanges(needDeck().raw).map((c) => ({ name: c.name, description: c.description, vars: c.vars, html: c.html })) }; },
  add_component(a) {
    const m = needDeck();
    if (!a.name || !a.html) throw new Error('name and html are required');
    const tag = `<template data-dek-component="${esc(a.name)}"${a.description ? ` data-description="${esc(a.description)}"` : ''}>\n${String(a.html).trim()}\n</template>`;
    const existing = componentRanges(m.raw).find((c) => c.name === a.name);
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
    const c = componentRanges(m.raw).find((x) => x.name === a.name);
    if (!c) throw new Error(`No component "${a.name}". list_components shows what exists.`);
    const html = a.live
      ? `<div data-dek-use="${esc(a.name)}" data-vars='${esc(JSON.stringify(a.vars || {})).replace(/'/g, '&#39;')}'></div>`
      : fillVars(c.html, a.vars);
    updateSlideHtml(i, addElement(m.slides[i].html, { html, position: a.position, selector: a.selector }), 'agent: use component');
    return { result: { n: i + 1 }, summary: `placed component “${a.name}” on slide ${i + 1}`, slide: i };
  },
  get_state() {
    const s = stage.state();
    return { result: { open: !!state.deck, path: state.deck ? state.deck.path : null, current: state.index + 1, step: state.step, steps: s ? s.steps : 0, count: slideCount(), presenting: state.presenting, blackout:state.blackout, atEnd:state.atEnd, startedAt:state.presentationStartedAt || null, overview: state.overview, title: s ? s.title : '' } };
  },
  goto(a) {
    const i = slideRef(a);
    if(state.presenting && model().slides[i].skip && !a.show_hidden)throw new Error('hidden_slide: pass show_hidden=true to show it explicitly');
    goTo(i, a.step === 'last' ? 'last' : (a.step | 0),!!a.show_hidden);
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
    else if (action === 'from_start') { goTo(model()?.slides.findIndex(s=>!s.skip) ?? 0); setPresenting(true); }
    else if (action === 'stop') setPresenting(false);
    else if (action === 'black')setBlackout('black');
    else if (action === 'white')setBlackout('white');
    else if (action === 'clear')setBlackout(null);
    else if (action === 'reset_timer'){state.presentationStartedAt=Date.now();broadcastState();}
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

let rpcQueue=Promise.resolve();
function rpc(payload) { const result=rpcQueue.then(()=>runRpc(payload)); rpcQueue=result.catch(()=>{}); return result; }
async function waitForWrites() {
  pumpSave();
  const deadline=Date.now()+10000;
  while(state.saving || state.pendingSave || state.rpcPending.size) {
    if(state.conflict)throw new Error('revision_conflict: resolve the disk change first');
    if(Date.now()>deadline)throw new Error('save_pending: disk has not acknowledged the previous edit; retry');
    await new Promise(resolve=>setTimeout(resolve,20));
  }
}
async function runRpc(payload) {
  let req;
  try { req = typeof payload === 'string' ? JSON.parse(payload) : payload; } catch { return JSON.stringify({ ok: false, error: 'bad request json' }); }
  const tool = req.tool;
  const args = req.args || {};
  const author = req.author || 'Agent';
  let before=null;
  try {
    const readOnly=/^(get_|list_|preview_|snapshot_|prepare_snapshot|export_deck|cancel_export)/.test(tool);
    if(state.presenting && !readOnly && !['goto','navigate','present'].includes(tool)) throw new Error('presentation_active: stop presenting before editing');
    if(!readOnly && !['goto','navigate','present','overview'].includes(tool)) {
      if(state.conflict)throw new Error('revision_conflict: resolve the disk change first');
      if(stage.ok)stage.dek.edit.commitText();
      await waitForWrites();
      if(args.revision!==undefined && args.revision!==revision())throw new Error('revision_conflict: read the deck again before editing');
    }
    before={raw:model()?.raw,history:{past:[...state.history.past],future:[...state.history.future]}};
    state.inRpc=true;state.rpcWrites=[];
    const fn = TOOLS[tool];
    if (!fn) throw new Error(`Unknown tool: ${tool}`);
    if(model() && ['goto','navigate','present','select_elements','arrange_elements'].includes(tool)){const deadline=Date.now()+5000;while(!stage.ok){if(Date.now()>deadline)throw new Error('renderer_pending: retry after the slide finishes loading');await new Promise(r=>setTimeout(r,20));}}
    const out = (await fn(args)) || {};
    state.agent.lastAuthor = author;
    state.agent.lastSeen = Date.now();
    if (out.summary) agentLog({ author, tool, summary: out.summary, slide: out.slide });
    else agentBadge();
    const writes=[...new Map(state.rpcWrites.map(w=>[w.path,w])).values()];
    if(isNative)writes.forEach(w=>state.rpcPending.add(w.path));
    const res = { ok: true, revision:revision(), result: out.result === undefined ? null : out.result, writes };
    if(res.result && typeof res.result==='object' && !Array.isArray(res.result))res.result.revision=revision();
    if (out.open) res.open = out.open;
    return JSON.stringify(res);
  } catch (e) {
    if(before?.raw && model()?.raw!==before.raw) { applyRaw(before.raw,{external:true,skipHistory:true});state.history=before.history; }
    agentLog({ author, tool, summary: `${tool}: ${e.message || e}`, error: true });
    const error=String(e.message || e),code=error.split(':')[0];
    return JSON.stringify({ ok: false, error, code, retryable:['presentation_active','save_pending','revision_conflict'].includes(code), revision:revision(), writes: [] });
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
  pv.startedAt=state.presentationStartedAt || null;
}

function presenterFollow(s) {
  state.presenting=!!s.presenting;state.presentationStartedAt=s.startedAt;pv.startedAt=s.presenting?s.startedAt:null;if(s.timer!==undefined)settings.timer=s.timer;presenterTick();
  if(!s.presenting && state.pendingExternal){const info=state.pendingExternal;state.pendingExternal=null;window.dekShell.fileChanged(info);}
  els.pvtitle.dataset.blackout=s.blackout || '';
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
    if (info.content === state.deck.model.raw || info.content===state.persistedRaw) return;
    if (state.presenting) { state.pendingExternal = info; return; }
    if(state.saving || state.pendingSave || state.rpcPending.size || state.inRpc || stage.dek?.edit.selected()?.editingText) { state.pendingExternal=info; state.conflict=true; $('conflictbar').hidden=false; return; }
    state.persistedRaw=info.content; // never reflash the projected slide
    const before = slideCount();
    applyRaw(info.content, { label: 'change on disk', external: true });
    if (!state.presenting) toast(slideCount() !== before ? `Reloaded · ${slideCount()} slides` : 'Reloaded');
    if (!isNative && !PRESENTER_MODE) devChannel.postMessage({ kind: 'deck', doc: { name: state.deck.name, path: state.deck.path, content: state.deck.model.raw, baseHref: state.deck.baseHref }, index: state.index, step: state.step });
  },
  saved(info) {
    if (!state.deck || info.path !== state.deck.path) return;
    if(info.ok) { state.persistedRaw=info.content || state.saving?.content || state.persistedRaw; state.saving=null; setSaveState('saved'); pumpSave(); }
    else { state.pendingSave=state.pendingSave || state.saving; state.saving=null; state.conflict=!!info.conflict; setSaveState('error'); $('conflictbar').hidden=!info.conflict; toast(info.conflict?'File changed on disk. Save your copy or load the disk version.':'Could not save. Your edits are still here; retry Save or save a copy.'); }
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
  getContent() { if(stage.ok)stage.dek.edit.commitText(); return state.deck ? state.deck.model.raw : null; },
  async flushForDeparture() { if(stage.ok)stage.dek.edit.commitText();if(state.conflict)throw new Error('Save your recovered copy before closing.');await waitForWrites();return true; },
  state() { return JSON.stringify({ revision:revision(), editing:state.editing, open: !!state.deck, path: state.deck ? state.deck.path : null, index: state.index, step: state.step, count: slideCount(), presenting: state.presenting }); },
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
    state.themesPath = isNative ? (info.themes || null) : null;
    renderMcp();
  },
  /** The design-system library as it is on disk (or "" the first time). */
  themesLoaded(content) {
    let parsed = null;
    try { parsed = typeof content === 'string' ? (content.trim() ? JSON.parse(content) : null) : content; }
    catch (e) { toast('The design system library could not be read; starting a fresh one'); }
    state.themes = normalizeLibrary(parsed);
    renderThemes();
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
  prepareExport(options={}) { if(stage.ok)stage.dek.edit.commitText(); return {...exportManifest(needDeck(),options,state.deck.baseHref), inspector:inspectExportSlide.toString()}; },
  writePowerPoint,
  pasteContent,
  imagePicked,
  toast,
  exportProgress(info) { const el=$('exportstatus');el.hidden=false;el.innerHTML=`<span>${info.status==='writing'?'Writing file…':`Exporting ${info.completed} of ${info.total} slides…`}</span><button data-cancel-export="${esc(info.id)}">Cancel</button>`; },
  exportResult(info) { const el=$('exportstatus');el.hidden=false;el.innerHTML=`<div><strong>${info.status==='cancelled'?'Export cancelled':info.error?esc(info.error):'Exported '+esc(info.path?.split('/').pop())}</strong>${info.warnings?.length?'<details><summary>'+info.warnings.length+' image fallbacks</summary>'+info.warnings.map(w=>'<p>'+esc(w)+'</p>').join('')+'</details>':''}</div>${info.path?'<button data-reveal-export="'+esc(info.path)+'">Show file</button>':''}<button data-dismiss-export aria-label="Dismiss export status">×</button>`; },
  rpcSaved(info) { state.rpcPending.delete(info.path); if(info.path!==state.deck?.path)return; if(info.ok && info.content){state.persistedRaw=info.content;setSaveState('saved');pumpSave();} else if(!info.ok){state.conflict=!!info.conflict;state.pendingSave={path:info.path,content:model().raw};$('conflictbar').hidden=!info.conflict;setSaveState('error');toast(info.conflict?'File changed on disk. Save a copy or reload.':'Save failed. Your edits are retained; retry Save or save a copy.');} },
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

// ---------- authoring workspace ----------
function selectSlide(i,e={}) {
  if(stage.ok)stage.dek.edit.commitText();
  if(e.shiftKey) { const from=Math.min(state.selectionAnchor,i),to=Math.max(state.selectionAnchor,i);state.selectedSlides=new Set(Array.from({length:to-from+1},(_,n)=>from+n)); }
  else if(e.metaKey || e.ctrlKey) { if(state.selectedSlides.has(i))state.selectedSlides.delete(i);else state.selectedSlides.add(i); }
  else { state.selectedSlides=new Set([i]);state.selectionAnchor=i; }
  goTo(i);renderSlideManagement();
}
const selectedSlides=()=>[...state.selectedSlides].filter(i=>model()?.slides[i]).sort((a,b)=>a-b);
function batchSlides(action,indices=selectedSlides(),options={}) {
  if(!indices.length && model()?.slides[state.index])indices=[state.index];
  if(!indices.length)return;
  if(stage.ok)stage.dek.edit.commitText();
  try {
    const raw=slideOperations(model(),indices,action,options);
    if(action==='section'){const ids=indices.map(i=>model().slides[i].id);indices=parseDeck(raw).slides.filter(s=>ids.includes(s.id)).map(s=>s.index);}
    const focus=action==='duplicate'?Math.max(...indices)+1:action==='move'?options.to:Math.min(...indices);
    state.selectedSlides=new Set(action==='duplicate'||action==='move'?indices.map((_,n)=>focus+n):action==='delete'?[Math.min(focus,Math.max(0,parseDeck(raw).slides.length-1))]:indices);
    applyRaw(raw,{label:`${action} ${indices.length} slide${indices.length===1?'':'s'}`,focusIndex:focus});
    toast(`${indices.length} slide${indices.length===1?'':'s'} ${ {hide:'hidden',show:'shown',delete:'deleted',duplicate:'duplicated',move:'moved',section:'organized'}[action] || 'updated'}`,'⌘Z');
  }catch(e){toast(e.message);}
}
function renderSlideManagement() {
  if(!model()) { $('slideactions').innerHTML='';$('sectionlist').innerHTML='';return; }
  const indices=selectedSlides(), hidden=indices.length && indices.every(i=>model().slides[i].skip);
  $('slideactions').innerHTML=`<button data-batch="${hidden?'show':'hide'}">${hidden?'Show':'Hide'}</button><button data-batch="duplicate">Duplicate</button><button data-batch="more" aria-label="More slide actions">•••</button><span>${indices.length>1?indices.length+' selected':''}</span>`;
  $('overviewactions').innerHTML=$('slideactions').innerHTML;
  const query=$('slidesearch').value.toLowerCase();
  let sections=[];try{sections=documentMeta(model()).sections || [];}catch{}
  for(const list of [thumbs,ovThumbs]) for(const [i,it] of list.items.entries()) {
    const slide=model().slides[i], group=sections.find(g=>g.id===slide?.section);
    it.el.classList.toggle('selected',state.selectedSlides.has(i));
    it.el.hidden=!!query && !`${i+1} ${slide?.title}`.toLowerCase().includes(query) || !!group?.collapsed && !query;
    it.el.tabIndex=i===state.index?0:-1;
    it.el.setAttribute('aria-selected',String(state.selectedSlides.has(i)));
    let more=it.el.querySelector('.thumb-more');
    if(!more) { more=document.createElement('button');more.className='thumb-more';more.textContent='•••';more.setAttribute('aria-label','Slide actions');more.addEventListener('click',e=>{e.stopPropagation();openContextMenu(+it.el.dataset.index,e.clientX,e.clientY);});it.el.append(more); }
  }
  for(const list of [thumbs,ovThumbs]) {const root=list===thumbs?els.thumbs:els.ovgrid;root.querySelectorAll('.thumb-section').forEach(n=>n.remove());const seen=new Set();for(const [i,it] of list.items.entries()){const group=sections.find(g=>g.id===model().slides[i]?.section);if(group && !seen.has(group.id)){seen.add(group.id);const label=document.createElement('button');label.className='thumb-section';label.textContent=(group.collapsed?'▸ ':'▾ ')+group.name;label.addEventListener('click',()=>changeSection(group.id,{collapsed:!group.collapsed}));it.el.before(label);}}}
  $('sectionlist').innerHTML=sections.map(g=>`<div class="section-row"><button data-section-toggle="${esc(g.id)}" aria-expanded="${!g.collapsed}">${g.collapsed?'▸':'▾'} ${esc(g.name)} <small>${model().slides.filter(s=>s.section===g.id).length}</small></button><button data-section-edit="${esc(g.id)}" aria-label="Edit section ${esc(g.name)}">•••</button></div>`).join('');
  if(!model().slides.length) { els.empty.classList.add('show');els.empty.querySelector('.empty-hint').innerHTML='This deck has no slides. Add one to get started.'; }
}
function changeSection(id,patch={}) {
  const m=model(),meta=documentMeta(m);meta.sections=meta.sections || [];
  if(id && !meta.sections.some(g=>g.id===id))throw new Error('Section no longer exists');
  if(!id){id='section-'+crypto.randomUUID();meta.sections.push({id,name:patch.name || 'Untitled section',collapsed:false});}
  else if(patch.remove)meta.sections=meta.sections.filter(g=>g.id!==id);
  else Object.assign(meta.sections.find(g=>g.id===id),patch);
  applyRaw(setDocumentMeta(m,meta),{label:patch.remove?'remove section':'section settings'});
  return id;
}
function popover(html,anchor=$('deckname')) {
  const el=$('workspacepopover');el.innerHTML=html;el.hidden=false;
  const r=anchor.getBoundingClientRect();el.style.left=Math.max(8,Math.min(window.innerWidth-340,r.left))+'px';el.style.top=Math.min(window.innerHeight-260,r.bottom+8)+'px';
  requestAnimationFrame(()=>el.querySelector('input,button,select')?.focus());
}
function showInsertMenu(kind) {
  const choices=kind==='shape'?['rectangle','rounded','ellipse','line','arrow','triangle']:['blank','title','content','split','quote'];
  popover(`<h2>${kind==='shape'?'Add a shape':'Add a slide'}</h2><div class="layout-options">${choices.map(v=>`<button data-add-${kind}="${v}">${v==='split'?'Two columns':v[0].toUpperCase()+v.slice(1)}</button>`).join('')}</div>`,kind==='shape'?els.insertbar:els.addslide);
}
function showSlideMenu() {
  popover(`<h2>${selectedSlides().length || 1} selected</h2><button data-batch="copy">Copy slides</button><button data-batch="up">Move up</button><button data-batch="down">Move down</button><button data-batch="section">Move to section…</button><button data-batch="newsection">Create section…</button><button data-batch="delete" class="danger">Delete slides</button>`,state.overview?$('overviewactions'):$('slideactions'));
}
function showExportMenu() {
  popover(`<h2>Export deck</h2><label>Format<select id="exportformat"><option value="pptx-editable">PowerPoint · editable</option><option value="pptx-image">PowerPoint · preserve appearance</option><option value="pdf">PDF</option></select></label><label class="check"><input id="exporthidden" type="checkbox">Include hidden slides</label><p class="field-hint">Editable PowerPoint keeps standard text, shapes and images editable. Complex visuals become images. Animations export as stills.</p><button class="wide-button primary" data-workspace="export">Export…</button><div id="exportprogress" role="status"></div>`,$('exportbtn'));
}
function readImageFile(file) {
  if(!state.deck){toast('Open or create a deck before adding an image');return;}
  if(file.size>30*1024*1024){toast('Choose an image smaller than 30 MB');return;}
  const r=new FileReader();r.onload=()=>{
    if(isNative)send({type:'importImageData',data:r.result,name:file.name || 'Pasted image.png'});
    else imagePicked({src:r.result,name:file.name});
  };r.readAsDataURL(file);
}
function clipboardPayload() {
  if(!state.deck)return;
  let payload;
  if(state.editing && state.sel && stage.ok) {
    stage.dek.edit.commitText();
    const sec=new DOMParser().parseFromString(model().slides[state.index].html,'text/html').querySelector('section');
    const paths=state.sel.paths || [state.sel.path];
    payload={kind:'dek-elements',html:paths.map(p=>sec.querySelector(pathTarget(p))?.outerHTML || '').join(''),source:state.deck.path};
  } else payload={kind:'dek-slides',html:selectedSlides().map(i=>model().slides[i].html).join('\n'),source:state.deck.path,head:transferHead(model())};
  return payload;
}
function copySelection(cut=false) {
  const payload=clipboardPayload();if(!payload)return;
  navigator.clipboard.writeText(JSON.stringify(payload)).then(()=>{if(cut){if(payload.kind==='dek-elements')stage.dek.edit.deleteSelected();else batchSlides('delete');}toast(cut?'Cut to clipboard':'Copied');},()=>toast('Clipboard is unavailable'));
}
function onCopy(e) {
  if(state.presenting || e.target?.isContentEditable || ['INPUT','TEXTAREA'].includes(e.target?.tagName))return;
  const payload=clipboardPayload();if(!payload || !e.clipboardData)return;
  e.preventDefault();e.clipboardData.setData('text/plain',JSON.stringify(payload));
  if(e.type==='cut'){if(payload.kind==='dek-elements')stage.dek.edit.deleteSelected();else batchSlides('delete');}
}
for(const type of ['copy','cut']){window.addEventListener(type,onCopy);stage.on(type,onCopy);}
function pasteContent(payload) {
  if(payload?.document){const doc=parseDeck(payload.document);payload={...payload,html:doc.bodyInner,head:doc.headInner};}
  if(!state.deck || !payload?.html)return;
  if(payload.kind==='dek-elements') {insertHtml(payload.html);return;}
  applyRaw(copySlidesInto(model(),payload,state.index+1),{label:'paste slides',focusIndex:state.index+1});
}
function onPaste(e) {
  if(e.target?.isContentEditable || ['INPUT','TEXTAREA'].includes(e.target?.tagName))return;
  const image=Array.from(e.clipboardData?.items || []).find(it=>it.type.startsWith('image/'));
  if(image){e.preventDefault();readImageFile(image.getAsFile());return;}
  try {const p=JSON.parse(e.clipboardData?.getData('text/plain') || '');if(['dek-slides','dek-elements'].includes(p.kind)){e.preventDefault();if(isNative && p.source!==state.deck?.path)send({type:'preparePaste',payload:p,destination:state.deck?.path});else pasteContent(p);}}catch{}
}
window.addEventListener('paste',onPaste);
stage.on('paste',onPaste);
$('slidesearch').addEventListener('input',renderSlideManagement);
$('overviewactions').addEventListener('click',e=>{const a=e.target.closest('[data-batch]')?.dataset.batch;if(a==='more')showSlideMenu();else if(a)batchSlides(a);});
$('slideactions').addEventListener('click',e=>{const action=e.target.closest('[data-batch]')?.dataset.batch;if(action==='more')showSlideMenu();else if(action)batchSlides(action);});
$('sectionlist').addEventListener('click',e=>{
  const toggle=e.target.closest('[data-section-toggle]');if(toggle){const g=documentMeta(model()).sections.find(g=>g.id===toggle.dataset.sectionToggle);changeSection(g.id,{collapsed:!g.collapsed});return;}
  const edit=e.target.closest('[data-section-edit]');if(edit){const g=documentMeta(model()).sections.find(g=>g.id===edit.dataset.sectionEdit);popover(`<h2>Section</h2><label>Name<input id="sectionname" value="${esc(g.name)}"></label><button data-section-save="${g.id}">Save name</button><button data-section-move="${g.id}" data-direction="-1">Move up</button><button data-section-move="${g.id}" data-direction="1">Move down</button><button data-section-remove="${g.id}">Remove section, keep slides</button>`,edit);}
});
$('deckname').addEventListener('click',()=>popover('<h2>Deck</h2><button data-workspace="new">New deck… <kbd>⌘N</kbd></button><button data-workspace="open">Open… <kbd>⌘O</kbd></button><button data-workspace="duplicate">Duplicate deck…</button><button data-workspace="rename">Edit title</button><button data-workspace="overview">Slide overview</button><button data-workspace="presenter">Presenter view</button><button data-workspace="agent">Work with an agent</button>'));
$('exportbtn').addEventListener('click',showExportMenu);
$('workspacepopover').addEventListener('click',e=>{
  const b=e.target.closest('button');if(!b)return;
  const pop=$('workspacepopover');
  if(b.dataset.addShape){pop.hidden=true;insertHtml(shapeHTML({shape:b.dataset.addShape}));}
  else if(b.dataset.addSlide){pop.hidden=true;addSlideAfter(state.index,layoutHTML(b.dataset.addSlide));}
  else if(b.dataset.workspace){const action=b.dataset.workspace;if(action==='export'){const [format,mode]=$('exportformat').value.split('-');send({type:'exportDeck',format,mode:mode || 'editable',includeHidden:$('exporthidden').checked});pop.hidden=true;return;}pop.hidden=true;({new:()=>send({type:'newDeck'}),open:()=>send({type:'openDialog'}),duplicate:()=>send({type:'saveAs'}),rename:()=>{setEditing(true);stage.dek.edit.clear();requestAnimationFrame(()=>$('inspector').querySelector('[data-field="title"]')?.focus());},overview:()=>setOverview(true),presenter:()=>send({type:'presenter',open:true}),agent:()=>setAgentOpen(true)})[action]?.();}
  else if(b.dataset.batch){const a=b.dataset.batch;pop.hidden=true;if(a==='copy')copySelection();else if(a==='up'||a==='down'){const ids=selectedSlides();batchSlides('move',ids,{to:Math.max(0,Math.min(...ids)+(a==='up'?-1:1))});}else if(a==='section'){popover('<h2>Move to section</h2>'+documentMeta(model()).sections.map(g=>`<button data-move-section="${g.id}">${esc(g.name)}</button>`).join('')+'<button data-move-section="">No section</button>');}else if(a==='newsection'){popover('<h2>Create section</h2><label>Name<input id="sectionname" value="Untitled section"></label><button data-create-section="true">Create and add selected slides</button>');}else batchSlides(a);}
  else if(b.hasAttribute('data-move-section')){batchSlides('section',selectedSlides(),{id:b.dataset.moveSection});pop.hidden=true;}
  else if(b.dataset.createSection){const meta=documentMeta(model()),id='section-'+crypto.randomUUID();meta.sections.push({id,name:$('sectionname').value.trim() || 'Untitled section',collapsed:false});let m=parseDeck(setDocumentMeta(model(),meta));const ids=selectedSlides();const raw=ids.length?slideOperations(m,ids,'section',{id}):m.raw;applyRaw(raw,{label:'create section with slides'});pop.hidden=true;}
  else if(b.dataset.sectionSave){changeSection(b.dataset.sectionSave,{name:$('sectionname').value.trim() || 'Untitled section'});pop.hidden=true;}
  else if(b.dataset.sectionRemove){TOOLS.manage_section({action:'remove',id:b.dataset.sectionRemove});pop.hidden=true;}
  else if(b.dataset.sectionMove){const meta=documentMeta(model()),i=meta.sections.findIndex(g=>g.id===b.dataset.sectionMove),to=Math.max(0,Math.min(meta.sections.length-1,i+Number(b.dataset.direction)));const [g]=meta.sections.splice(i,1);meta.sections.splice(to,0,g);applyRaw(reorderSections(model(),meta.sections),{label:'reorder sections'});pop.hidden=true;}
});
$('conflictbar').addEventListener('click',e=>{const a=e.target.dataset.conflict;if(a==='copy')send({type:'saveAs'});else if(a==='reload'){if(stage.ok)stage.dek.edit.cancelText();state.pendingSave=null;state.saving=null;state.conflict=false;$('conflictbar').hidden=true;if(state.pendingExternal){const info=state.pendingExternal;state.pendingExternal=null;window.dekShell.fileChanged(info);}else send({type:'reload'});}});
document.addEventListener('mousedown',e=>{if(!e.target.closest('#workspacepopover,#deckname,#exportbtn,#slideactions,#sectionlist,#insertbar,#addslide'))$('workspacepopover').hidden=true;});


// ---------- wiring ----------

els.presentbtn.addEventListener('click', () => setPresenting(true));
els.counter.addEventListener('click', () => palette.open());
els.navtoggle.addEventListener('click', () => setNavOpen(!state.navOpen));
els.addslide.addEventListener('click', () => { if (state.deck) showInsertMenu('slide'); else send({ type:'newDeck' }); });
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
  if(f && !isNative && f.type.startsWith('image/')) { readImageFile(f); return; }
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
window.__dek = { state, settings, stage, thumbs, model, command, rpc, themes: { list: themeList, active: activeTheme, apply: applyThemeToDeck } }; // QA handle
send({ type: 'ready', presenter: PRESENTER_MODE });
if (!PRESENTER_MODE) send({ type: 'themesLoad' });

$('exportstatus').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.cancelExport)send({type:'cancelExport',id:b.dataset.cancelExport});if(b.dataset.revealExport)send({type:'revealExport',path:b.dataset.revealExport});if(b.hasAttribute('data-dismiss-export'))$('exportstatus').hidden=true;});

$('emptyslide').addEventListener('click',()=>addSlideAfter(-1,layoutHTML('blank')));
