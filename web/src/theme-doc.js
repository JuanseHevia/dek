// The composition: a design system rendered as one self-contained HTML page.
//
// It is written *in* the system it documents — the specimens are real type at
// real slide sizes, the swatches are the real values, the components are the
// real markup — so the page is both the guidelines and the proof they hold
// together. No DOM, no dependencies: the shell renders it in an iframe and the
// same string is what "Save HTML…" writes to disk.

import { normalizeSystem, compileSystemCss, chartDefaults, currentSystem, currentVersion, fontStack } from './theme.js';
import { fillVars } from './deck.js';

/** The page is authored at this width: wide enough for slide-accurate specimens,
 *  narrow enough to read at 1:1 in the stage of a maximized window. */
export const DOC_WIDTH = 1440;

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Placeholder copy for a component's {{vars}}, so the specimen reads like a real slide. */
const SAMPLES = {
  label: 'Section label', eyebrow: 'Section label', headline: 'The claim this slide makes.',
  lead: 'One sentence that supports it, no more.', title: 'Title', text: 'Label',
  number: '41.6 %', caption: 'What the number means, in one line.',
  key: '1', value: 'What this row is saying.', tone: 'sun',
  n1: '128', n2: '$1.4 M', n3: '17 %', c1: 'clients', c2: 'ARR', c3: 'growth',
  name: 'Name', role: 'Role', body: 'A sentence of body copy.', source: 'Source · method · date.',
};
export const sampleVars = (vars) =>
  Object.fromEntries((vars || []).map((v) => [v, SAMPLES[v] !== undefined ? SAMPLES[v] : v.replace(/[-_]/g, ' ')]));

const swatch = (name, value, note) => `
      <figure class="sw">
        <span class="sw-chip" style="background: ${esc(value)}"></span>
        <figcaption><b>${esc(name)}</b><code>${esc(value)}</code>${note ? `<em>${esc(note)}</em>` : ''}</figcaption>
      </figure>`;

const row = (k, v) => `<div class="row"><span class="row-k">${esc(k)}</span><span class="row-v">${esc(v)}</span></div>`;

/** The easing curve, drawn. A number for `ease` says less than its shape. */
function easeCurve(ease) {
  const m = /cubic-bezier\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)/.exec(String(ease || ''));
  if (!m) return '';
  const [x1, y1, x2, y2] = m.slice(1).map(Number);
  const p = (x, y) => `${(x * 120).toFixed(1)},${(120 - y * 120).toFixed(1)}`;
  return `
      <svg class="curve" viewBox="-10 -30 140 180" role="img" aria-label="easing curve">
        <path d="M0,120 L120,120 M0,120 L0,0" class="curve-axis"/>
        <path d="M${p(0, 0)} C${p(x1, y1)} ${p(x2, y2)} ${p(1, 1)}" class="curve-line"/>
        <circle cx="${(x1 * 120).toFixed(1)}" cy="${(120 - y1 * 120).toFixed(1)}" r="4" class="curve-dot"/>
        <circle cx="${(x2 * 120).toFixed(1)}" cy="${(120 - y2 * 120).toFixed(1)}" r="4" class="curve-dot"/>
      </svg>`;
}

/** A static bar chart in the system's series colors — what a dek-chart will look like. */
function chartSpecimen(series) {
  const data = [42, 68, 55, 88, 74];
  const w = 640, h = 260, pad = 28;
  const max = 100;
  const bw = (w - pad * 2) / (data.length * 1.6);
  const bars = data.map((v, i) => {
    const x = pad + i * (bw * 1.6);
    const bh = ((v / max) * (h - pad * 2));
    return `<rect x="${x.toFixed(1)}" y="${(h - pad - bh).toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" rx="4" fill="${esc(series[i % series.length])}"/>`;
  }).join('');
  const grid = [0, 0.25, 0.5, 0.75, 1].map((t) => {
    const y = pad + t * (h - pad * 2);
    return `<line x1="${pad}" y1="${y}" x2="${w - pad}" y2="${y}" class="spec-grid"/>`;
  }).join('');
  return `<svg class="chart-spec" viewBox="0 0 ${w} ${h}" role="img" aria-label="chart specimen">${grid}${bars}</svg>`;
}

/** The page's own furniture. Deliberately quiet: the system is the thing on display. */
const DOC_CSS = `
*, *::before, *::after { box-sizing: border-box; }
html { font-size: 32px; }
body {
  margin: 0; width: 1440px;
  background: var(--bg); color: var(--ink);
  font-family: var(--font-body); font-size: var(--text-body); line-height: var(--lead-body);
  -webkit-font-smoothing: antialiased;
}
.wrap { padding: 72px 88px 120px; }
.doc-head { border-bottom: var(--rule) solid var(--accent); padding-bottom: 40px; margin-bottom: 8px; }
.doc-kicker { font-size: var(--text-caption); letter-spacing: var(--track-caption); text-transform: uppercase; color: var(--ink-faint); margin: 0 0 18px; }
.doc-title { font-family: var(--font-display); font-size: var(--text-h1); font-weight: var(--weight-display); letter-spacing: var(--track-display); line-height: var(--lead-display); margin: 0; }
.doc-desc { font-size: var(--text-lead); color: var(--ink-muted); margin: 22px 0 0; max-width: 46ch; }
.doc-meta { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 30px; }
.tag { font-size: var(--text-caption); letter-spacing: var(--track-caption); text-transform: uppercase; padding: 8px 16px; border-radius: 999px; background: var(--surface); border: var(--border) solid var(--hairline); color: var(--ink-muted); }
.tag.on { background: var(--accent); border-color: transparent; color: var(--accent-ink); }

.sec { padding: 72px 0 12px; border-top: var(--border) solid var(--hairline); }
.sec:first-of-type { border-top: 0; }
.sec-h { display: flex; align-items: baseline; gap: 20px; margin: 0 0 8px; }
.sec-n { font: 600 var(--text-caption)/1 var(--font-mono); color: var(--accent); letter-spacing: 0.1em; }
.sec-t { font-family: var(--font-display); font-size: var(--text-h3); font-weight: var(--weight-heading); letter-spacing: var(--track-heading); margin: 0; }
.sec-note { color: var(--ink-muted); font-size: var(--text-small); margin: 0 0 36px; max-width: 60ch; }

.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 26px; }
.sw { margin: 0; }
.sw-chip { display: block; height: 120px; border-radius: var(--radius); border: var(--border) solid var(--hairline); }
.sw figcaption { display: flex; flex-direction: column; gap: 4px; padding-top: 14px; }
.sw b { font-size: var(--text-small); font-weight: 600; }
.sw code { font-family: var(--font-mono); font-size: var(--text-caption); color: var(--ink-muted); }
.sw em { font-style: normal; font-size: var(--text-caption); color: var(--ink-faint); }

.specimen { padding: 26px 0; border-bottom: var(--border) solid var(--hairline); display: grid; grid-template-columns: 260px 1fr; gap: 40px; align-items: baseline; }
.specimen:last-child { border-bottom: 0; }
.specimen-k { display: flex; flex-direction: column; gap: 6px; }
.specimen-k b { font-size: var(--text-small); font-weight: 600; }
.specimen-k code { font-family: var(--font-mono); font-size: var(--text-caption); color: var(--ink-faint); }
.specimen-v { min-width: 0; overflow: hidden; }

.row { display: flex; gap: 24px; padding: 13px 0; border-bottom: var(--border) solid var(--hairline); font-size: var(--text-small); }
.row:last-child { border-bottom: 0; }
.row-k { flex: 0 0 320px; color: var(--ink-muted); }
.row-v { flex: 1; font-family: var(--font-mono); font-size: var(--text-caption); word-break: break-word; }
.cols { display: grid; grid-template-columns: 1fr 1fr; gap: 0 72px; align-items: start; }

.boxes { display: flex; flex-wrap: wrap; gap: 28px; align-items: flex-end; }
.box-demo { background: var(--accent-soft); border: var(--border) solid var(--accent); }
.stack-demo { display: flex; align-items: center; background: var(--surface-alt); border-radius: var(--radius-sm); }
.stack-demo i { display: block; height: 56px; background: var(--accent); border-radius: 3px; width: 56px; }

.curve { width: 190px; height: 190px; }
.curve-axis { stroke: var(--hairline); stroke-width: 2; fill: none; }
.curve-line { stroke: var(--accent); stroke-width: 5; fill: none; stroke-linecap: round; }
.curve-dot { fill: var(--accent); opacity: 0.45; }
.chart-spec { width: 100%; max-width: 640px; height: auto; }
.spec-grid { stroke: currentColor; opacity: 0.12; stroke-width: 1.5; }

.comp { border: var(--border) solid var(--hairline); border-radius: var(--radius); overflow: hidden; margin-bottom: 30px; background: var(--surface); }
.comp-h { display: flex; align-items: baseline; gap: 16px; padding: 20px 28px; border-bottom: var(--border) solid var(--hairline); }
.comp-h b { font-size: var(--text-small); font-weight: 600; }
.comp-h span { font-size: var(--text-caption); color: var(--ink-faint); }
.comp-h code { margin-left: auto; font-family: var(--font-mono); font-size: var(--text-caption); color: var(--accent); }
.comp-live { padding: 44px 28px; background: var(--bg); }
.comp-src { margin: 0; padding: 22px 28px; background: var(--surface-alt); border-top: var(--border) solid var(--hairline);
  font-family: var(--font-mono); font-size: var(--text-caption); line-height: 1.6; color: var(--ink-muted);
  white-space: pre-wrap; word-break: break-word; }
.doc-foot { margin-top: 80px; padding-top: 34px; border-top: var(--border) solid var(--hairline);
  font-size: var(--text-caption); color: var(--ink-faint); }
.doc-foot code { font-family: var(--font-mono); word-break: break-all; }
.doc-foot p { max-width: none; margin: 0; }
@media print { .wrap { padding: 40px } }
`.trim();

/**
 * The whole system as one page.
 * @param theme a theme record (or `{ name, system }`)
 */
export function composeDocument(theme, o = {}) {
  const system = normalizeSystem(theme && theme.versions ? currentSystem(theme) : (theme && theme.system) || theme);
  const name = (theme && theme.name) || 'Design system';
  const version = theme && theme.versions ? currentVersion(theme) : o.version;
  const t = system.typography;
  const c = system.color;
  const sp = system.space;
  const mo = system.motion;
  const ch = system.chart;
  const series = (ch.palette && ch.palette.length ? ch.palette : c.series).slice(0, 6);
  const updated = theme && theme.updatedAt ? new Date(theme.updatedAt).toLocaleDateString([], { year: 'numeric', month: 'long', day: 'numeric' }) : '';

  // a <div>, not a <section>: a top-level <section> is how Dek marks a slide,
  // and this page is a document, not a deck
  const sec = (n, title, note, body) => `
    <div class="sec" role="region" aria-label="${esc(title)}">
      <div class="sec-h"><span class="sec-n">${esc(n)}</span><h2 class="sec-t">${esc(title)}</h2></div>
      <p class="sec-note">${esc(note)}</p>
      ${body}
    </div>`;

  const typeSpecimen = (key, label, sample) => `
      <div class="specimen">
        <div class="specimen-k"><b>${esc(label)}</b><code>--text-${esc(key)} · ${esc(t.scale[key])}</code></div>
        <div class="specimen-v" style="font-size: var(--text-${esc(key)}); font-family: ${key === 'body' || key === 'small' || key === 'caption' ? 'var(--font-body)' : 'var(--font-display)'}; font-weight: ${key === 'display' || key === 'h1' ? 'var(--weight-display)' : key.startsWith('h') ? 'var(--weight-heading)' : 'var(--weight-body)'}; line-height: ${key === 'display' || key === 'h1' ? 'var(--lead-display)' : key.startsWith('h') ? 'var(--lead-heading)' : 'var(--lead-body)'}; letter-spacing: ${key === 'display' ? 'var(--track-display)' : key.startsWith('h') ? 'var(--track-heading)' : key === 'caption' ? 'var(--track-caption)' : 'var(--track-body)'}; text-transform: ${key === 'caption' ? 'var(--case-caption)' : 'none'};">${esc(sample)}</div>
      </div>`;

  const components = Object.entries(system.components || {});
  const componentBlocks = components.map(([nm, def]) => {
    const html = typeof def === 'string' ? def : (def && def.html) || '';
    const description = typeof def === 'object' && def ? def.description || '' : '';
    const vars = Array.from(new Set(Array.from(html.matchAll(/\{\{\s*([\w-]+)\s*\}\}/g)).map((m) => m[1])));
    return `
      <div class="comp">
        <div class="comp-h"><b>${esc(nm)}</b><span>${esc(description)}</span><code>${vars.length ? vars.map((v) => `{{${v}}}`).join(' ') : 'no vars'}</code></div>
        <div class="comp-live">${fillVars(html, sampleVars(vars))}</div>
        <pre class="comp-src">${esc(html.trim())}</pre>
      </div>`;
  }).join('');

  return `<!doctype html>
<html lang="en" data-dek-doc="design-system">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=1440">
<title>${esc(name)} — design system</title>
<style>${compileSystemCss(system)}</style>
<style>${DOC_CSS}</style>
</head>
<body class="dek-root">
<div class="wrap">

  <header class="doc-head">
    <p class="doc-kicker">Design system${version ? ` · version ${version}` : ''}</p>
    <h1 class="doc-title">${esc(name)}</h1>
    ${theme && theme.description ? `<p class="doc-desc">${esc(theme.description)}</p>` : ''}
    <div class="doc-meta">
      <span class="tag on">${esc(system.meta.mode)}</span>
      ${system.meta.mood ? `<span class="tag">${esc(system.meta.mood)}</span>` : ''}
      <span class="tag">${esc(t.fonts.display.family)}</span>
      <span class="tag">${esc(mo.transition)} ${esc(mo.transitionMs)}ms</span>
      ${updated ? `<span class="tag">updated ${esc(updated)}</span>` : ''}
    </div>
    ${system.meta.notes ? `<p class="doc-desc">${esc(system.meta.notes)}</p>` : ''}
  </header>

  ${sec('01', 'Color', 'Surfaces first, then ink, then the one accent. Everything else earns its place.', `
    <div class="grid">
      ${swatch('bg', c.bg, 'slide background')}
      ${swatch('surface', c.surface, 'cards, panels')}
      ${swatch('surface-alt', c.surfaceAlt, 'the quieter fill')}
      ${swatch('hairline', c.hairline, 'rules and borders')}
    </div>
    <div class="grid" style="margin-top: 34px">
      ${swatch('ink', c.ink, 'body and headings')}
      ${swatch('ink-muted', c.inkMuted, 'support copy')}
      ${swatch('ink-faint', c.inkFaint, 'labels and sources')}
    </div>
    <div class="grid" style="margin-top: 34px">
      ${swatch('accent', c.accent, 'the single accent')}
      ${swatch('accent-soft', c.accentSoft, 'tints and chips')}
      ${swatch('accent-ink', c.accentInk, 'text on accent')}
      ${swatch('dek-highlight', c.highlight, 'fragment highlight')}
    </div>
    <div class="grid" style="margin-top: 34px">
      ${swatch('positive', c.positive)}
      ${swatch('negative', c.negative)}
      ${swatch('warning', c.warning)}
    </div>`)}

  ${sec('02', 'Typography', `${t.fonts.display.family} for display, ${t.fonts.body.family} for body. Sizes are shown at slide scale: this is exactly how big they land on the 1920 canvas.`, `
    <div class="cols" style="margin-bottom: 30px">
      <div>
        ${row('Display stack', fontStack(t.fonts.display))}
        ${row('Body stack', fontStack(t.fonts.body))}
        ${row('Mono stack', fontStack(t.fonts.mono))}
        ${t.fonts.display.url ? row('Web font', t.fonts.display.url) : ''}
      </div>
      <div>
        ${row('Weights', `display ${t.weight.display} · heading ${t.weight.heading} · body ${t.weight.body} · strong ${t.weight.strong}`)}
        ${row('Tracking', `display ${t.tracking.display} · heading ${t.tracking.heading} · caption ${t.tracking.caption}`)}
        ${row('Leading', `display ${t.leading.display} · heading ${t.leading.heading} · body ${t.leading.body}`)}
        ${row('Measure', t.measure)}
      </div>
    </div>
    ${typeSpecimen('display', 'Display', '41.6 %')}
    ${typeSpecimen('h1', 'H1 · the claim', 'One idea per slide.')}
    ${typeSpecimen('h2', 'H2 · the workhorse', 'The headline most slides carry.')}
    ${typeSpecimen('h3', 'H3 · column titles', 'A smaller heading')}
    ${typeSpecimen('lead', 'Lead', 'The sentence under the headline that does the explaining.')}
    ${typeSpecimen('body', 'Body', 'Running copy. Long enough here to show how the measure and leading behave together over more than one line of text.')}
    ${typeSpecimen('small', 'Small', 'Chips, table cells and captions.')}
    ${typeSpecimen('caption', 'Caption', 'Eyebrows and sources')}`)}

  ${sec('03', 'Space', 'One rhythm across the deck. Padding sets the frame; gaps set the breathing.', `
    <div class="cols">
      <div>
        ${row('Slide padding', `${sp.slidePadY} vertical · ${sp.slidePadX} horizontal`)}
        ${row('Base unit', sp.unit)}
        ${row('Gaps', `tight ${sp.gapTight} · default ${sp.gap} · loose ${sp.gapLoose}`)}
        ${row('Border · rule', `${sp.border} · ${sp.rule}`)}
      </div>
      <div>
        ${row('Radii', `sm ${sp.radiusSm} · default ${sp.radius} · lg ${sp.radiusLg}`)}
        ${row('Shadow', sp.shadow)}
      </div>
    </div>
    <div class="boxes" style="margin-top: 40px">
      <div><div class="box-demo" style="width: 120px; height: 120px; border-radius: ${esc(sp.radiusSm)}"></div><p class="sec-note" style="margin: 12px 0 0">radius-sm</p></div>
      <div><div class="box-demo" style="width: 120px; height: 120px; border-radius: ${esc(sp.radius)}"></div><p class="sec-note" style="margin: 12px 0 0">radius</p></div>
      <div><div class="box-demo" style="width: 120px; height: 120px; border-radius: ${esc(sp.radiusLg)}"></div><p class="sec-note" style="margin: 12px 0 0">radius-lg</p></div>
      <div><div class="stack-demo" style="gap: ${esc(sp.gapTight)}; padding: ${esc(sp.gapTight)}"><i></i><i></i><i></i></div><p class="sec-note" style="margin: 12px 0 0">gap-tight</p></div>
      <div><div class="stack-demo" style="gap: ${esc(sp.gap)}; padding: ${esc(sp.gapTight)}"><i></i><i></i><i></i></div><p class="sec-note" style="margin: 12px 0 0">gap</p></div>
      <div><div style="width: 200px; height: 120px; background: var(--surface); border-radius: ${esc(sp.radius)}; box-shadow: ${esc(sp.shadow)}"></div><p class="sec-note" style="margin: 12px 0 0">shadow</p></div>
    </div>`)}

  ${sec('04', 'Motion', `Slides ${mo.transition} in ${mo.transitionMs}ms; fragments ${mo.fragment} in ${mo.fragmentMs}ms. One language, applied everywhere${mo.reducedMotion ? ', and it collapses to a 120ms fade under reduced motion' : ''}.`, `
    <div class="cols">
      <div>
        ${row('Slide transition', `${mo.transition} · ${mo.transitionMs}ms`)}
        ${row('Fragments', `${mo.fragment} · ${mo.fragmentMs}ms`)}
        ${row('Auto-animate', `${mo.autoAnimateMs}ms`)}
        ${row('Element entrance', `${mo.enter} · ${mo.enterMs}ms · stagger ${mo.stagger}ms`)}
        ${row('Easing', mo.ease)}
        ${row('Reduced motion', mo.reducedMotion ? 'honored' : 'not honored')}
      </div>
      <div>${easeCurve(mo.ease)}</div>
    </div>`)}

  ${sec('05', 'Charts', `Series colors, and the defaults every figure inherits unless its own JSON overrides them.`, `
    <div class="cols">
      <div>
        <div class="grid" style="grid-template-columns: repeat(auto-fill, minmax(160px, 1fr))">
          ${series.map((v, i) => swatch(`dek-c${i + 1}`, v)).join('')}
        </div>
      </div>
      <div>
        ${chartSpecimen(series)}
        <div style="margin-top: 26px">
          ${row('Grid · axis', `grid ${ch.grid ? 'on' : 'off'} at ${ch.gridOpacity} · axis at ${ch.axisOpacity}`)}
          ${row('Values on marks', ch.values ? 'on' : 'off')}
          ${row('Legend', ch.legend ? 'on' : 'off')}
          ${row('Lines', `${ch.smooth ? 'smoothed' : 'straight'} · dots ${ch.dots ? 'on' : 'off'}`)}
          ${row('Numbers', `${ch.compact ? 'compact' : 'full'} · ${ch.decimals} decimal${ch.decimals === 1 ? '' : 's'}${ch.prefix ? ` · prefix "${ch.prefix}"` : ''}${ch.suffix ? ` · suffix "${ch.suffix}"` : ''}`)}
        </div>
      </div>
    </div>`)}

  ${components.length ? sec('06', 'Components', 'The pieces this deck repeats. Placed with use_component, or copied from the source below.', componentBlocks) : ''}

  ${sec(components.length ? '07' : '06', 'Tokens', 'Every custom property the system publishes. Write slides against these names, never against literals.', `
    <div class="cols">
      ${(() => {
        const vars = [];
        for (const line of compileSystemCss(system).split('\n')) {
          const m = /^\s*(--[\w-]+)\s*:\s*(.+);$/.exec(line);
          if (m) vars.push(row(m[1], m[2]));
        }
        const half = Math.ceil(vars.length / 2);
        return `<div>${vars.slice(0, half).join('')}</div><div>${vars.slice(half).join('')}</div>`;
      })()}
    </div>`)}

  <footer class="doc-foot">
    <p>${esc(name)}${version ? ` · version ${version}` : ''} · generated by Dek. Chart defaults: <code>${esc(JSON.stringify(chartDefaults(system)))}</code></p>
  </footer>
</div>
</body>
</html>
`;
}
