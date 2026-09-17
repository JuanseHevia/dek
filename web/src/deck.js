// Deck model: a deck is one HTML string. Slides are the top-level <section>
// elements of the body. All structural edits are string splices on the raw
// file so everything the agent (or a human) wrote around the slides survives
// byte-for-byte; only element-level edits re-serialize the one slide they touch.

const TAG_RE = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<!doctype[^>]*>|<(\/?)([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^'">])*)(\/?)>/gi;
const RAW_TEXT = new Set(['script', 'style', 'textarea', 'title']);

/** Walk the tags of an HTML string, skipping comments and raw-text element bodies. */
export function scanTags(raw, visit) {
  TAG_RE.lastIndex = 0;
  let m;
  while ((m = TAG_RE.exec(raw))) {
    if (m[2] === undefined) continue;
    const name = m[2].toLowerCase();
    const tag = { name, closing: m[1] === '/', selfClosing: m[4] === '/', start: m.index, end: TAG_RE.lastIndex, attrs: m[3] || '' };
    if (visit(tag) === false) return;
    if (!tag.closing && RAW_TEXT.has(name)) {
      const close = new RegExp(`</${name}\\s*>`, 'ig');
      close.lastIndex = TAG_RE.lastIndex;
      const c = close.exec(raw);
      if (!c) return;
      if (visit({ name, closing: true, selfClosing: false, start: c.index, end: close.lastIndex, attrs: '', textStart: TAG_RE.lastIndex }) === false) return;
      TAG_RE.lastIndex = close.lastIndex;
    }
  }
}

/** Structural offsets: head/body inner ranges and every top-level section. */
export function structure(raw) {
  const s = {
    head: null,        // { start, end } inner range
    body: null,        // { start, end } inner range
    bodyTag: null,     // { start, end, attrs } of <body …>
    htmlTag: null,
    slides: [],        // [{ start, end }] outer ranges
    styles: [],        // [{ start, end }] inner ranges of <style> in head
  };
  let depth = 0;
  let open = null;
  let headOpen = null;
  let styleOpen = null;
  scanTags(raw, (t) => {
    if (t.name === 'html' && !t.closing && !s.htmlTag) s.htmlTag = { start: t.start, end: t.end, attrs: t.attrs };
    if (t.name === 'head') {
      if (!t.closing) headOpen = t.end;
      else if (headOpen !== null && !s.head) s.head = { start: headOpen, end: t.start };
    }
    if (t.name === 'style' && s.head === null && headOpen !== null) {
      if (!t.closing) styleOpen = t.end;
      else if (styleOpen !== null) { s.styles.push({ start: t.textStart !== undefined ? t.textStart : styleOpen, end: t.start }); styleOpen = null; }
    }
    if (t.name === 'body') {
      if (!t.closing) { s.bodyTag = { start: t.start, end: t.end, attrs: t.attrs }; s.body = { start: t.end, end: raw.length }; }
      else if (s.body) s.body.end = t.start;
    }
    if (t.name === 'section') {
      if (!t.closing && !t.selfClosing) {
        if (depth === 0) open = t.start;
        depth++;
      } else if (t.closing) {
        depth = Math.max(0, depth - 1);
        if (depth === 0 && open !== null) { s.slides.push({ start: open, end: t.end }); open = null; }
      }
    }
  });
  if (!s.body) {
    // no <body>: everything after </head> (or the whole string) is the body
    const headEnd = s.head ? raw.indexOf('>', s.head.end) + 1 : 0;
    s.body = { start: headEnd, end: raw.length };
  }
  if (!s.head) s.head = { start: 0, end: 0 };
  return s;
}

// ---------- slide inspection ----------

const tpl = typeof document !== 'undefined' ? document.createElement('template') : null;

/** Parse one slide's HTML into an element (detached). */
export function sectionElement(html) {
  const fragment = document.createElement('template');
  fragment.innerHTML = html.trim();
  const el = fragment.content.firstElementChild;
  return el && el.tagName === 'SECTION' ? el : null;
}

export function slideInfo(html, index) {
  const sec = sectionElement(html);
  const info = { index, id: '', title: '', notes: '', notesHtml: '', fragments: 0, transition: '', autoAnimate: false, classes: '' };
  if (!sec) return info;
  info.id = sec.id || '';
  info.classes = sec.className || '';
  info.transition = sec.dataset.transition || '';
  info.autoAnimate = sec.hasAttribute('data-auto-animate');
  info.section = sec.getAttribute('data-dek-section') || '';
  info.skip = sec.hasAttribute('data-dek-skip') || sec.hasAttribute('data-deck-skip');
  const h = sec.querySelector('h1, h2, h3, h4, h5, h6');
  const src = h || sec.querySelector('p, li, figcaption, blockquote') || sec;
  info.title = (src.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  const notes = sec.querySelector('aside.notes, .notes');
  if (notes) {
    info.notesHtml = notes.innerHTML.trim();
    const plain=notes.cloneNode(true);for(const br of plain.querySelectorAll('br'))br.replaceWith(document.createTextNode('\n'));for(const block of plain.querySelectorAll('p,div,li'))block.append(document.createTextNode('\n'));info.notes=plain.textContent.trim();
  } else if (sec.getAttribute('data-speaker-notes')) {
    // Claude Design keeps notes in an attribute
    info.notes = sec.getAttribute('data-speaker-notes').trim();
    info.notesHtml = info.notes.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
  }
  const idx = new Set();
  let auto = 0;
  for (const f of sec.querySelectorAll('.fragment')) {
    const e = f.getAttribute('data-fragment-index');
    idx.add(e !== null && e !== '' ? parseInt(e, 10) : auto++);
  }
  info.fragments = idx.size;
  return info;
}

/** Parse the whole file into a model the shell can render and edit. */
export function parseDeck(raw) {
  const s = structure(raw);
  const headInner = raw.slice(s.head.start, s.head.end);
  const bodyInner = raw.slice(s.body.start, s.body.end);
  const slides = s.slides.map((r, i) => {
    const html = raw.slice(r.start, r.end);
    return { ...slideInfo(html, i), start: r.start, end: r.end, html, hash: hash(html) };
  });
  const meta = headMeta(headInner);
  return { raw, structure: s, headInner, bodyInner, slides, meta, bodyAttrs: s.bodyTag ? s.bodyTag.attrs : '', htmlAttrs: s.htmlTag ? s.htmlTag.attrs : '' };
}

export function headMeta(headInner) {
  const doc = new DOMParser().parseFromString(`<!doctype html><html><head>${headInner}</head><body></body></html>`, 'text/html');
  const meta = (n) => { const m = doc.querySelector(`meta[name="${n}"]`); return m ? m.getAttribute('content') || '' : ''; };
  const size = /^(\d+)\s*[x×]\s*(\d+)$/.exec(meta('dek-size').trim());
  return {
    title: (doc.querySelector('title') || {}).textContent || '',
    size: size ? { w: +size[1], h: +size[2] } : { w: 1920, h: 1080 },
    transition: meta('dek-transition').trim(),
    autoslide: parseInt(meta('dek-autoslide'), 10) || 0,
    slideNumbers: meta('dek-slide-numbers').trim(),
    description: meta('description'),
  };
}

export function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

// ---------- ids ----------

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
export function generateId(taken) {
  const used = new Set(taken || []);
  for (let tries = 0; tries < 50; tries++) {
    let id = 's-';
    const bytes = new Uint8Array(4);
    (globalThis.crypto || { getRandomValues: (a) => a.map(() => Math.random() * 256) }).getRandomValues(bytes);
    for (const b of bytes) id += ID_ALPHABET[b % ID_ALPHABET.length];
    if (!used.has(id)) return id;
  }
  return 's-' + Date.now().toString(36);
}

/** Make sure `html` is a single <section> with an id. */
export function normalizeSection(html, takenIds) {
  let h = String(html || '').trim();
  if (!/^<section[\s>]/i.test(h)) h = `<section>\n${h}\n</section>`;
  const open = /^<section((?:"[^"]*"|'[^']*'|[^'">])*)>/i.exec(h);
  if (open && !/\sid\s*=/.test(open[1])) {
    const id = generateId(takenIds);
    h = `<section id="${id}"${open[1]}>` + h.slice(open[0].length);
  }
  return h;
}

export function sectionId(html) {
  const open = /^<section((?:"[^"]*"|'[^']*'|[^'">])*)>/i.exec(String(html).trim());
  const m = open && /\sid\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(open[1]);
  return m ? (m[1] || m[2] || m[3] || '') : '';
}

export function withNewId(html, takenIds) {
  const id = generateId(takenIds);
  const h = String(html).trim();
  const open = /^<section((?:"[^"]*"|'[^']*'|[^'">])*)>/i.exec(h);
  if (!open) return normalizeSection(h, takenIds);
  if (/\sid\s*=/.test(open[1])) {
    const attrs = open[1].replace(/\sid\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i, ` id="${id}"`);
    return `<section${attrs}>` + h.slice(open[0].length);
  }
  return `<section id="${id}"${open[1]}>` + h.slice(open[0].length);
}

// ---------- structural splices ----------

function junction(raw, at) {
  // Make sure there is exactly one blank line where we cut/paste.
  let a = at, b = at;
  while (a > 0 && /[ \t\r\n]/.test(raw[a - 1])) a--;
  while (b < raw.length && /[ \t\r\n]/.test(raw[b])) b++;
  return { a, b };
}

/** Insert a slide so it becomes slide number `index` (0-based). */
export function insertSlide(model, html, index) {
  const { raw, structure: s, slides } = model;
  const i = Math.max(0, Math.min(index, slides.length));
  let at;
  if (slides.length === 0) at = s.body.end;
  else if (i < slides.length) at = slides[i].start;
  else at = slides[slides.length - 1].end;
  if (slides.length === 0) {
    const { a } = junction(raw, at);
    return raw.slice(0, a) + '\n\n' + html.trim() + '\n\n' + raw.slice(at);
  }
  if (i < slides.length) {
    return raw.slice(0, at) + html.trim() + '\n\n' + raw.slice(at);
  }
  return raw.slice(0, at) + '\n\n' + html.trim() + raw.slice(at);
}

export function replaceSlide(model, index, html) {
  const sl = model.slides[index];
  if (!sl) throw new Error(`No slide ${index + 1}`);
  return model.raw.slice(0, sl.start) + html.trim() + model.raw.slice(sl.end);
}

export function removeSlide(model, index) {
  const sl = model.slides[index];
  if (!sl) throw new Error(`No slide ${index + 1}`);
  const { raw } = model;
  const { a, b } = junction(raw, sl.start);
  const after = junction(raw, sl.end);
  // keep the whitespace that preceded the slide, drop what followed it
  const before = raw.slice(0, sl.start);
  const rest = raw.slice(after.b);
  const sep = model.slides.length > 1 ? '\n\n' : '\n';
  void a; void b;
  return before.replace(/[ \t\r\n]*$/, '') + (rest.trim() ? sep : '\n') + rest;
}

export function moveSlide(model, from, to) {
  const n = model.slides.length;
  if (from < 0 || from >= n) throw new Error(`No slide ${from + 1}`);
  const target = Math.max(0, Math.min(to, n - 1));
  if (target === from) return model.raw;
  const html = model.slides[from].html;
  const without = parseDeck(removeSlide(model, from));
  return insertSlide(without, html, target);
}

// ---------- head edits ----------

export function setHeadInner(model, inner) {
  const { raw, structure: s } = model;
  if (s.head.end === 0 && s.head.start === 0 && !/<head[\s>]/i.test(raw)) {
    // no head at all: create one before the body content
    return `<!doctype html>\n<html>\n<head>\n${inner}\n</head>\n<body>\n${raw}\n</body>\n</html>\n`;
  }
  return raw.slice(0, s.head.start) + inner + raw.slice(s.head.end);
}

export function appendStyle(model, css, id) {
  const { raw, structure: s } = model;
  const tag = `<style${id ? ` id="${id}"` : ''}>\n${css.trim()}\n</style>`;
  if (id) {
    // replace an existing block with that id
    const re = new RegExp(`<style[^>]*\\sid=["']${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][^>]*>[\\s\\S]*?<\\/style>`, 'i');
    if (re.test(raw)) return raw.replace(re, () => tag);
  }
  if (!/<head[\s>]/i.test(raw)) return setHeadInner(model, `<meta charset="utf-8">\n${tag}`);
  return raw.slice(0, s.head.end) + `${raw[s.head.end - 1] === '\n' ? '' : '\n'}${tag}\n` + raw.slice(s.head.end);
}

export function setTitle(model, title) {
  const { raw, structure: s } = model;
  const safe = title.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
  const head = raw.slice(s.head.start, s.head.end);
  if (/<title[\s>]/i.test(head)) {
    const nh = head.replace(/<title[^>]*>[\s\S]*?<\/title>/i, `<title>${safe}</title>`);
    return raw.slice(0, s.head.start) + nh + raw.slice(s.head.end);
  }
  return appendStyleLike(model, `<title>${safe}</title>`);
}

function appendStyleLike(model, tag) {
  const { raw, structure: s } = model;
  if (!/<head[\s>]/i.test(raw)) return setHeadInner(model, `<meta charset="utf-8">\n${tag}`);
  return raw.slice(0, s.head.end) + `\n${tag}\n` + raw.slice(s.head.end);
}

/** Set (or with `content === null` remove) a `<meta name="…">` in the head. */
export function upsertMeta(model, name, content) {
  const { raw } = model;
  const re = new RegExp(`\\n?[ \\t]*<meta(?:"[^"]*"|'[^']*'|[^'">])*\\sname=["']${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'](?:"[^"]*"|'[^']*'|[^'">])*>[ \\t]*`, 'i');
  const tag = `<meta name="${name}" content="${String(content == null ? '' : content).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')}">`;
  if (re.test(raw)) return content === null ? raw.replace(re, '\n') : raw.replace(re, () => `\n${tag}`);
  if (content === null) return raw;
  return appendStyleLike(model, tag);
}

// ---------- components ----------

/** Every `<template data-dek-component="name">` in the file, with its source range. */
export function componentRanges(raw) {
  const out = [];
  let open = null;
  scanTags(raw, (t) => {
    if (t.name !== 'template') return;
    if (!t.closing) {
      const nm = /data-dek-component\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(t.attrs);
      if (nm) open = { name: nm[1] || nm[2], start: t.start, inner: t.end, attrs: t.attrs };
    } else if (open) { out.push({ ...open, end: t.end, innerEnd: t.start }); open = null; }
  });
  return out.map((c) => {
    const desc = /data-description\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(c.attrs);
    const html = raw.slice(c.inner, c.innerEnd);
    return {
      name: c.name,
      description: desc ? (desc[1] || desc[2]) : '',
      themeOwned: /\sdata-dek-theme-owned(?=[\s=>/])/i.test(c.attrs + ' '),
      html,
      start: c.start,
      end: c.end,
      vars: Array.from(new Set(Array.from(html.matchAll(/\{\{\s*([\w-]+)\s*\}\}/g)).map((x) => x[1]))),
    };
  });
}

/** Fill `{{name}}` placeholders in a component's HTML. */
export function fillVars(html, vars) {
  return html.replace(/\{\{\s*([\w-]+)\s*\}\}/g, (_, k) => (vars && vars[k] !== undefined ? String(vars[k]) : ''));
}

// ---------- element edits inside one slide ----------

/** Run `fn(sectionEl)` on a parsed copy of the slide and return its new HTML. */
export function withSlideDOM(html, fn) {
  const sec = sectionElement(html);
  if (!sec) throw new Error('Slide HTML is not a <section>');
  fn(sec);
  return sec.outerHTML;
}

function pick(sec, selector, all) {
  if (!selector || selector === 'section' || selector === ':scope') return [sec];
  let nodes;
  try { nodes = Array.from(sec.querySelectorAll(selector)); } catch (e) { throw new Error(`Invalid selector: ${selector}`); }
  if (!nodes.length) throw new Error(`No element matches "${selector}" in this slide`);
  return all ? nodes : [nodes[0]];
}

export function addElement(html, { html: fragment, position = 'append', selector }) {
  return withSlideDOM(html, (sec) => {
    const [target] = pick(sec, selector);
    const range = document.createElement('template');
    range.innerHTML = fragment;
    const nodes = Array.from(range.content.childNodes);
    switch (position) {
      case 'prepend': target.prepend(...nodes); break;
      case 'before': target.before(...nodes); break;
      case 'after': target.after(...nodes); break;
      case 'replace': target.replaceWith(...nodes); break;
      default: target.append(...nodes);
    }
  });
}

export function updateElement(html, { selector, html: outer, inner, text, attrs, style, addClass, removeClass, all }) {
  let count = 0;
  const out = withSlideDOM(html, (sec) => {
    for (const el of pick(sec, selector, all)) {
      count++;
      if (outer !== undefined) {
        const range = document.createElement('template');
        range.innerHTML = outer;
        el.replaceWith(...Array.from(range.content.childNodes));
        continue;
      }
      if (inner !== undefined) el.innerHTML = inner;
      if (text !== undefined) el.textContent = text;
      if (attrs) for (const k in attrs) { if (attrs[k] === null || attrs[k] === false) el.removeAttribute(k); else el.setAttribute(k, String(attrs[k])); }
      if (style) for (const k in style) { if (style[k] === null || style[k] === '') el.style.removeProperty(k); else el.style.setProperty(k, String(style[k])); }
      if (addClass) el.classList.add(...String(addClass).split(/\s+/).filter(Boolean));
      if (removeClass) el.classList.remove(...String(removeClass).split(/\s+/).filter(Boolean));
    }
  });
  return { html: out, count };
}

export function deleteElement(html, { selector, all }) {
  let count = 0;
  const out = withSlideDOM(html, (sec) => {
    for (const el of pick(sec, selector, all)) { if (el === sec) throw new Error('Use delete_slide to remove the slide itself'); el.remove(); count++; }
  });
  return { html: out, count };
}

export function retagElement(html, { selector, tag }) {
  if (!/^[a-z][a-z0-9]*$/i.test(tag || '')) throw new Error('Invalid tag');
  return withSlideDOM(html, (sec) => {
    const [el] = pick(sec, selector);
    if (el === sec) throw new Error('Cannot retag the slide');
    const n = document.createElement(tag);
    for (const a of Array.from(el.attributes)) n.setAttribute(a.name, a.value);
    while (el.firstChild) n.appendChild(el.firstChild);
    el.replaceWith(n);
  });
}

export function getElements(html, selector, limit = 20) {
  const sec = sectionElement(html);
  if (!sec) return [];
  return pick(sec, selector, true).slice(0, limit).map((el) => el.outerHTML);
}

export function setNotes(html, notes) {
  return withSlideDOM(html, (sec) => {
    sec.removeAttribute('data-speaker-notes');
    let aside = sec.querySelector('aside.notes, .notes');
    if (!notes) { if (aside) aside.remove(); return; }
    if (!aside) {
      aside = document.createElement('aside');
      aside.className = 'notes';
      sec.appendChild(document.createTextNode('\n  '));
      sec.appendChild(aside);
      sec.appendChild(document.createTextNode('\n'));
    }
    if (/<[a-z][\s\S]*>/i.test(notes)) aside.innerHTML = notes; else aside.textContent = notes;
  });
}

export function setSlideAttrs(html, attrs) {
  return withSlideDOM(html, (sec) => {
    for (const k in attrs) {
      if (attrs[k] === null || attrs[k] === false) sec.removeAttribute(k);
      else sec.setAttribute(k, String(attrs[k]));
    }
  });
}

// ---------- rendering support ----------

/** Head inner without scripts (thumbnails render CSS only). */
export function stripScripts(html) {
  let out = '';
  let last = 0;
  let skipFrom = null;
  scanTags(html, (t) => {
    if (t.name === 'script') {
      if (!t.closing) skipFrom = t.start;
      else if (skipFrom !== null) { out += html.slice(last, skipFrom); last = t.end; skipFrom = null; }
    }
  });
  out += html.slice(last);
  return out;
}

/** Resolve a slide reference (1-based number, id, or "current") to an index. */
export function resolveSlide(model, ref, current) {
  if (ref === undefined || ref === null || ref === '' || ref === 'current') return current;
  if (typeof ref === 'number') return ref - 1;
  const s = String(ref).trim();
  if (/^\d+$/.test(s)) return parseInt(s, 10) - 1;
  if (s === 'first') return 0;
  if (s === 'last') return model.slides.length - 1;
  const i = model.slides.findIndex((sl) => sl.id === s || sl.id === s.replace(/^#/, ''));
  if (i < 0) throw new Error(`No slide with id "${s}"`);
  return i;
}
