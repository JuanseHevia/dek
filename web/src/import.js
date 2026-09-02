// Import foreign HTML into Dek's format.
//
// Claude Design exports a "bundled page": the real document is JSON inside
// <script type="__bundler/template">, its fonts and scripts gzip+base64 in
// <script type="__bundler/manifest">, unpacked by a bootstrap script at load
// time. The document itself is a design canvas whose deck is a `deck-stage`
// component: 1920×1080, plain <section> slides, notes in data-speaker-notes,
// reveal animations gated on [data-deck-active]. Everything here is static
// string and DOM work; nothing from the foreign file is executed.

const BUNDLE_RE = /<script type="__bundler\/(manifest|template)">/;
const DECK_STAGE_RE = /<(x-import[^>]*component-from-global-scope="deck-stage"|deck-stage[\s>])/;
const LOOSE_SLIDE_SEL = ':scope > .slide, :scope > [data-slide], :scope > article, :scope > .page, :scope > .frame';

/** 'bundle' | 'deck-stage' | 'loose' | null */
export function detectForeign(raw) {
  if (BUNDLE_RE.test(raw)) return 'bundle';
  if (DECK_STAGE_RE.test(raw)) return 'deck-stage';
  return null;
}

function block(raw, type) {
  const m = new RegExp(`<script type="__bundler/${type}">([\\s\\S]*?)<\\/script>`).exec(raw);
  return m ? m[1] : null;
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

async function gunzip(bytes) {
  if (typeof DecompressionStream === 'undefined') throw new Error('this WebKit cannot decompress the bundle');
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Turn a bundled page back into plain HTML with fonts and images inlined as data URIs. */
export async function unbundle(raw) {
  const manifest = JSON.parse(block(raw, 'manifest') || '{}');
  let template = JSON.parse(block(raw, 'template') || '""');
  if (typeof template !== 'string' || !template) throw new Error('bundle has no page template');
  const pageOrder = new Set(JSON.parse(block(raw, 'page_order') || '[]'));
  const dropped = [];
  for (const [uuid, entry] of Object.entries(manifest)) {
    if (pageOrder.has(uuid) || !entry || typeof entry.data !== 'string') continue;
    const mime = String(entry.mime || '');
    const inline = /^(font\/|image\/|application\/(x-)?font-|application\/vnd\.ms-fontobject)/i.test(mime);
    if (!inline) { dropped.push(uuid); continue; }
    let b64 = entry.data;
    if (entry.compressed) b64 = bytesToBase64(await gunzip(base64ToBytes(entry.data)));
    template = template.split(uuid).join(`data:${mime};base64,${b64}`);
  }
  return { html: template, dropped };
}

const esc = (s) => String(s).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));

function headFrom(doc, { keepScripts = false } = {}) {
  const parts = [];
  const seen = new Set();
  for (const el of doc.querySelectorAll('head > *, helmet > *')) {
    const tag = el.tagName;
    if (tag === 'SCRIPT' && !keepScripts) continue;
    if (tag === 'TITLE') continue;
    if (tag === 'META') {
      if (el.hasAttribute('charset')) continue;
      const name = el.getAttribute('name') || '';
      if (name === 'viewport' || name === 'slide-deck' || /^dek-/.test(name)) continue;
    }
    if (tag === 'LINK') {
      const href = el.getAttribute('href') || '';
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-/.test(href)) continue; // unresolved bundle asset
    }
    const html = el.outerHTML;
    if (seen.has(html)) continue;
    seen.add(html);
    parts.push(html);
  }
  return parts;
}

function frame(title, size, headParts, sections, generator, lang) {
  return `<!doctype html>
<html lang="${esc(lang || 'en')}">
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<meta name="dek-size" content="${size.w}x${size.h}">
<meta name="generator" content="${esc(generator)}">
${headParts.join('\n')}
</head>
<body>

${sections.join('\n\n')}

</body>
</html>
`;
}

/** A Claude Design deck-stage document → Dek deck. */
export function convertDeckStage(html, { title }) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const stage = doc.querySelector('x-import[component-from-global-scope="deck-stage"], deck-stage');
  const size = {
    w: parseInt(stage && stage.getAttribute('width'), 10) || 1920,
    h: parseInt(stage && stage.getAttribute('height'), 10) || 1080,
  };
  const container = stage || doc.body;
  let sections = Array.from(container.children).filter((el) => el.tagName === 'SECTION');
  if (!sections.length) sections = Array.from(doc.querySelectorAll('section')).filter((el) => !el.parentElement.closest('section'));
  const notesCount = { n: 0 };
  // Design-canvas template bindings ({{ name }}) were resolved by the foreign
  // runtime from component props; unresolved ones mean "default", which for
  // attributes is "absent".
  for (const el of container.querySelectorAll('*')) {
    for (const attr of Array.from(el.attributes)) {
      if (/^\s*\{\{[^}]*\}\}\s*$/.test(attr.value)) el.removeAttribute(attr.name);
    }
  }
  const out = sections.map((sec, i) => {
    sec.removeAttribute('data-deck-active');
    sec.removeAttribute('data-om-validate');
    sec.setAttribute('data-deck-slide', String(i));
    if (!sec.id) sec.id = `s-${String(i + 1).padStart(2, '0')}`;
    const notes = sec.getAttribute('data-speaker-notes');
    if (notes && notes.trim() && !sec.querySelector('aside.notes, .notes')) {
      const aside = doc.createElement('aside');
      aside.className = 'notes';
      aside.textContent = notes.trim();
      sec.appendChild(doc.createTextNode('\n  '));
      sec.appendChild(aside);
      sec.appendChild(doc.createTextNode('\n'));
      notesCount.n++;
    }
    return sec.outerHTML;
  });
  const lang = doc.documentElement.getAttribute('lang') || guessLang(out.join(' '));
  return {
    html: frame(title, size, headFrom(doc), out, 'Dek import of a Claude Design deck', lang),
    count: out.length,
    notes: notesCount.n,
    size,
  };
}

/** Any page whose slides are top-level .slide / [data-slide] / <article> children → Dek deck. */
export function convertLoose(html, { title }) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const topSections = Array.from(doc.querySelectorAll('section')).filter((el) => !el.parentElement.closest('section'));
  if (topSections.length >= 2) {
    return { html: frame(title, { w: 1920, h: 1080 }, headFrom(doc), topSections.map((s) => s.outerHTML), 'Dek import', doc.documentElement.lang), count: topSections.length, notes: 0, size: { w: 1920, h: 1080 } };
  }
  const loose = Array.from(doc.body.querySelectorAll(LOOSE_SLIDE_SEL));
  if (loose.length < 2) return null;
  const out = loose.map((el, i) => `<section id="s-${String(i + 1).padStart(2, '0')}">\n${el.outerHTML}\n</section>`);
  return { html: frame(title, { w: 1920, h: 1080 }, headFrom(doc), out, 'Dek import', doc.documentElement.lang), count: out.length, notes: 0, size: { w: 1920, h: 1080 } };
}

function guessLang(text) {
  const sample = text.replace(/<[^>]+>/g, ' ').slice(0, 4000).toLowerCase();
  const es = (sample.match(/\b(el|la|los|las|de|que|y|en|para|con|una|por)\b/g) || []).length;
  const en = (sample.match(/\b(the|and|of|to|in|for|with|that|is)\b/g) || []).length;
  return es > en * 1.5 ? 'es' : 'en';
}

/** Title for the imported deck: file name without extension and export suffixes. */
export function importTitle(name) {
  return String(name || 'Imported deck')
    .replace(/\.html?$/i, '')
    .replace(/\s*\((standalone|export|bundle|bundled)\)\s*$/i, '')
    .trim() || 'Imported deck';
}

/**
 * Convert a foreign file. Returns null when the content is already a Dek-style
 * deck (top-level sections, nothing to unpack).
 */
export async function importForeign(raw, { name }) {
  const kind = detectForeign(raw);
  if (!kind) return null;
  const title = importTitle(name);
  let html = raw;
  let dropped = [];
  if (kind === 'bundle') ({ html, dropped } = await unbundle(raw));
  if (DECK_STAGE_RE.test(html)) {
    return { kind: 'claude-design', title, dropped, ...convertDeckStage(html, { title }) };
  }
  const loose = convertLoose(html, { title });
  if (!loose) throw new Error('no slides found in the unpacked page');
  return { kind: 'bundle', title, dropped, ...loose };
}
