// Stage: hosts a deck document in a srcdoc iframe with the runtime injected,
// and mirrors its state to the shell. Also builds the static documents used
// for navigator thumbnails, the light table and the presenter's "next" view.

import RUNTIME_JS from '../dist/runtime.txt';
import BASE_CSS from './runtime/dek-base.css';
import RUNTIME_CSS from './runtime/dek-runtime.css';
import { stripScripts, structure, hash } from './deck.js';

const escAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');

/** Build the HTML document Dek renders for a deck (or one slide of it). */
export function buildDocument(model, o = {}) {
  const thumb = o.mode === 'thumb';
  let headInner = model.headInner;
  let bodyInner = thumb ? (model.slides[o.index] ? model.slides[o.index].html : '') : model.bodyInner;
  if (thumb) { headInner = stripScripts(headInner); bodyInner = stripScripts(bodyInner); }
  const init = {
    index: thumb ? 0 : (o.index | 0),
    step: o.step === undefined ? 0 : o.step,
    static: thumb || !!o.static,
    transition: o.transition || model.meta.transition || 'fade',
    transitionMs: o.transitionMs || 0,
    autoAnimateMs: o.autoAnimateMs || 0,
    slideNumbers: !!o.slideNumbers,
    slideNumberFormat: o.slideNumberFormat || 'plain',
    autoslide: !!o.autoslide,
    skipHidden: o.skipHidden !== false,
    autoslideMs: model.meta.autoslide || 0,
    size: model.meta.size,
  };
  const base = o.baseHref ? `<base href="${escAttr(o.baseHref)}">` : '';
  const htmlAttrs = model.htmlAttrs ? ' ' + model.htmlAttrs.trim() : '';
  const bodyAttrs = model.bodyAttrs ? ' ' + model.bodyAttrs.trim() : '';
  return `<!doctype html>
<html${htmlAttrs}><head><meta charset="utf-8">${base}
<style data-dek="base">${BASE_CSS}</style>
${headInner}
<style data-dek="runtime">${RUNTIME_CSS}</style>
</head>
<body${bodyAttrs}>
${bodyInner}
<script data-dek="runtime">${RUNTIME_JS}</script>
<script data-dek="boot">window.dek && window.dek.init(${JSON.stringify(init).replace(/</g, '\\u003c')});</script>
</body></html>`;
}

/** The head with every <style> body blanked: equal skeletons mean a CSS-only change. */
function headSkeleton(model) {
  const s = structure(model.raw);
  let out = '';
  let last = s.head.start;
  for (const r of s.styles) { out += model.raw.slice(last, r.start); last = r.end; }
  out += model.raw.slice(last, s.head.end);
  return out;
}

export class Stage {
  constructor(frame) {
    this.frame = frame;
    this.handlers = {};
    this.loaded = false;
    this.dek = null;
    this.win = null;
    this.model = null;
    this.gen = 0;
  }

  on(name, fn) { (this.handlers[name] = this.handlers[name] || []).push(fn); return this; }
  emit(name, payload) { for (const fn of this.handlers[name] || []) fn(payload); }

  get ok() { return this.loaded && !!this.dek; }

  load(model, opts = {}) {
    this.model = model;
    this.opts = opts;
    this.loaded = false;
    const gen = ++this.gen;
    const html = buildDocument(model, { mode: 'stage', ...opts });
    const onload = () => {
      this.frame.removeEventListener('load', onload);
      if (gen !== this.gen) return;
      const win = this.frame.contentWindow;
      this.win = win;
      this.dek = win && win.dek;
      if (!this.dek) { this.emit('error', 'runtime failed to start'); return; }
      this.dek.on('change', (s) => this.emit('change', s));
      this.dek.on('ready', (s) => this.emit('ready', s));
      this.dek.on('end', () => this.emit('end'));
      this.dek.on('edit', (p) => this.emit('edit', p));
      this.dek.on('resize', (p) => this.emit('resize', p));
      for (const type of ['keydown', 'keyup', 'click', 'mousemove', 'mousedown', 'contextmenu', 'wheel', 'dblclick', 'paste', 'copy', 'cut']) {
        win.addEventListener(type, (e) => this.emit(type, e));
      }
      win.addEventListener('blur', () => this.emit('blur'));
      this.loaded = true;
      this.emit('load', this.dek.state());
    };
    this.frame.addEventListener('load', onload);
    this.frame.srcdoc = html;
  }

  state() { return this.ok ? this.dek.state() : null; }
  go(i, step, o) { return this.ok ? this.dek.go(i, step, o) : false; }
  next() { return this.ok ? this.dek.next() : false; }
  prev() { return this.ok ? this.dek.prev() : false; }
  first() { return this.ok ? this.dek.first() : false; }
  last() { return this.ok ? this.dek.last() : false; }
  setOptions(o) { if (this.ok) this.dek.setOptions(o); }
  fit() { if (this.ok) this.dek.fit(); }
  focus() { try { this.frame.contentWindow.focus(); } catch (_) { /* detached */ } }

  /** Swap deck <style> contents in place when only CSS changed. */
  hotSwapStyles(newModel) {
    if (!this.ok || !this.model) return false;
    if (newModel.bodyInner !== this.model.bodyInner) return false;
    if (headSkeleton(newModel) !== headSkeleton(this.model)) return false;
    const doc = this.win.document;
    const live = Array.from(doc.head.querySelectorAll('style:not([data-dek])'));
    const next = structure(newModel.raw).styles.map((r) => newModel.raw.slice(r.start, r.end));
    if (live.length !== next.length) return false;
    live.forEach((el, i) => { if (el.textContent !== next[i]) el.textContent = next[i]; });
    this.model = newModel;
    if (this.dek.refresh) this.dek.refresh();
    return true;
  }
}

/** A list of lazily rendered slide thumbnails (navigator, light table, presenter "next"). */
export class Thumbs {
  constructor(container, opts = {}) {
    this.el = container;
    this.opts = opts;
    this.items = [];
    this.model = null;
    this.current = -1;
    this.io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const item = this.items[+e.target.dataset.index];
        if (!item) continue;
        item.visible = e.isIntersecting;
        if (e.isIntersecting && item.stale) this.mount(item);
      }
    }, { root: opts.root || container, rootMargin: '240px' });
  }

  render(model, { baseHref, current, force } = {}) {
    this.model = model;
    this.baseHref = baseHref;
    const styleHash = hash(model.headInner) + '|' + hash(model.bodyAttrs || '');
    model.slides.forEach((slide, i) => {
      let item = this.items[i];
      if (!item) { item = this.create(i); this.items[i] = item; this.el.appendChild(item.el); this.io.observe(item.el); }
      item.el.dataset.index = String(i);
      item.idx.textContent = String(i + 1);
      item.el.title = slide.title || `Slide ${i + 1}`;
      item.el.setAttribute('aria-label', `Slide ${i + 1}${slide.title ? ': ' + slide.title : ''}${slide.skip ? ' (skipped)' : ''}`);
      item.el.classList.toggle('skipped', !!slide.skip);
      const key = slide.hash + '|' + styleHash;
      if (force || item.key !== key) {
        item.key = key;
        item.stale = true;
        if (item.visible) this.mount(item);
      }
    });
    while (this.items.length > model.slides.length) {
      const item = this.items.pop();
      this.io.unobserve(item.el);
      item.el.remove();
    }
    if (current !== undefined) this.setCurrent(current);
  }

  create(i) {
    const el = document.createElement('div');
    el.className = 'thumb-item';
    el.setAttribute('role', 'option');
    el.tabIndex = -1;
    const idx = document.createElement('span');
    idx.className = 'thumb-idx';
    const box = document.createElement('div');
    box.className = 'thumb-box';
    const frame = document.createElement('iframe');
    frame.className = 'thumb-frame';
    frame.tabIndex = -1;
    frame.setAttribute('aria-hidden', 'true');
    frame.setAttribute('scrolling', 'no');
    box.appendChild(frame);
    el.appendChild(idx);
    el.appendChild(box);
    const item = { el, idx, box, frame, key: null, stale: true, visible: false, i };
    el.addEventListener('click', (e) => this.opts.onSelect && this.opts.onSelect(+el.dataset.index, e));
    el.addEventListener('dblclick', (e) => this.opts.onOpen && this.opts.onOpen(+el.dataset.index, e));
    el.addEventListener('contextmenu', (e) => { if (this.opts.onMenu) { e.preventDefault(); this.opts.onMenu(+el.dataset.index, e); } });
    if (this.opts.draggable) {
      el.draggable = true;
      el.addEventListener('dragstart', (e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', el.dataset.index); this.opts.onDragStart && this.opts.onDragStart(+el.dataset.index); });
      el.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; this.opts.onDragOver && this.opts.onDragOver(+el.dataset.index, e); });
      el.addEventListener('drop', (e) => { e.preventDefault(); const from = +e.dataTransfer.getData('text/plain'); this.opts.onDrop && this.opts.onDrop(from, +el.dataset.index, e); });
      el.addEventListener('dragend', () => this.opts.onDragEnd && this.opts.onDragEnd());
    }
    return item;
  }

  mount(item) {
    if (!this.model) return;
    const i = +item.el.dataset.index;
    item.stale = false;
    item.frame.srcdoc = buildDocument(this.model, { mode: 'thumb', index: i, baseHref: this.baseHref });
  }

  setCurrent(i) {
    this.current = i;
    this.items.forEach((item, n) => {
      item.el.classList.toggle('current', n === i);
      item.el.setAttribute('aria-selected', String(n === i));
    });
  }

  scrollToCurrent() {
    const item = this.items[this.current];
    if (item) item.el.scrollIntoView({ block: 'nearest' });
  }
}
