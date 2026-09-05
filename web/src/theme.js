// Design systems: the deck's visual language as data.
//
// A *system* is a plain object of design tokens (typography, color, space,
// motion, chart and component preferences). A *theme* is that system plus an
// identity and an append-only version history. The library holds at most
// MAX_THEMES themes and lives outside any deck, so one system can dress many
// decks; applying a theme compiles its tokens into a single <style id="dek-theme">
// block, a few <meta> tags and the components it owns.
//
// Everything here is pure string/object work: no DOM, so it runs in the shell,
// in tests and in a plain Node script alike.

import { structure, appendStyle, upsertMeta, componentRanges, scanTags } from './deck.js';

export const MAX_THEMES = 5;
export const MAX_VERSIONS = 20;
export const THEME_STYLE_ID = 'dek-theme';

// ---------- schema ----------

/** Every token group, with the questions it answers. Shown to agents by list_theme_tokens. */
export const TOKEN_GUIDE = {
  meta: 'mode (dark|light), mood (two or three adjectives), notes (when to reach for this system)',
  typography: 'fonts (display/body/mono: family, fallback, weights, url), scale (display…caption), weight, tracking, leading, transform, measure',
  color: 'bg, surface, surfaceAlt, ink, inkMuted, inkFaint, accent, accentInk, accentSoft, hairline, highlight, positive, negative, warning, series[6], gradient',
  space: 'unit, slidePadX, slidePadY, gap, gapTight, gapLoose, radius, radiusSm, radiusLg, border, rule, shadow',
  motion: 'transition + transitionMs + ease (between slides), fragment + fragmentMs (reveals), autoAnimateMs, enter + enterMs + stagger (element entrances), reducedMotion',
  chart: 'palette, grid, legend, values, smooth, dots, compact, ticks, gridOpacity, axisOpacity, prefix, suffix, decimals',
  components: 'named reusable snippets ({{vars}} allowed) written into the deck as <template data-dek-component>',
  css: 'raw CSS appended verbatim to the compiled block, for anything the tokens do not cover',
};

export const DEFAULT_SYSTEM = {
  meta: { mode: 'dark', mood: '', notes: '' },
  typography: {
    fonts: {
      display: { family: 'Inter', fallback: 'system-ui, sans-serif', weights: [600, 700], url: '' },
      body: { family: 'Inter', fallback: 'system-ui, sans-serif', weights: [400, 500], url: '' },
      mono: { family: 'ui-monospace', fallback: '"SF Mono", Menlo, monospace', weights: [400], url: '' },
    },
    scale: { display: '5rem', h1: '3.4rem', h2: '2.2rem', h3: '1.5rem', lead: '1.35rem', body: '1.05rem', small: '0.85rem', caption: '0.72rem' },
    weight: { display: 700, heading: 650, body: 400, strong: 650 },
    tracking: { display: '-0.035em', heading: '-0.02em', body: '0', caption: '0.09em' },
    leading: { display: 1.02, heading: 1.1, body: 1.5 },
    transform: { display: 'none', caption: 'uppercase' },
    measure: '58ch',
  },
  color: {
    bg: 'oklch(0.16 0.02 265)',
    surface: 'oklch(0.21 0.022 265)',
    surfaceAlt: 'oklch(0.26 0.024 265)',
    ink: 'oklch(0.96 0.008 90)',
    inkMuted: 'oklch(0.74 0.014 265)',
    inkFaint: 'oklch(0.60 0.014 265)',
    accent: 'oklch(0.82 0.14 82)',
    accentInk: 'oklch(0.18 0.02 82)',
    accentSoft: 'oklch(0.34 0.06 82)',
    hairline: 'oklch(0.32 0.014 265)',
    highlight: 'oklch(0.82 0.14 82)',
    positive: 'oklch(0.74 0.15 150)',
    negative: 'oklch(0.68 0.17 25)',
    warning: 'oklch(0.80 0.14 75)',
    series: ['oklch(0.70 0.14 250)', 'oklch(0.74 0.15 150)', 'oklch(0.80 0.15 80)', 'oklch(0.65 0.17 340)', 'oklch(0.72 0.12 200)', 'oklch(0.62 0.05 265)'],
    gradient: '',
  },
  space: {
    unit: '8px',
    slidePadX: '120px',
    slidePadY: '96px',
    gap: '48px',
    gapTight: '24px',
    gapLoose: '96px',
    radius: '18px',
    radiusSm: '8px',
    radiusLg: '36px',
    border: '1px',
    rule: '3px',
    shadow: '0 24px 60px -30px rgba(0, 0, 0, 0.55)',
  },
  motion: {
    transition: 'fade',
    transitionMs: 480,
    ease: 'cubic-bezier(0.22, 1, 0.36, 1)',
    fragment: 'fade-up',
    fragmentMs: 320,
    autoAnimateMs: 600,
    enter: 'fade-up',
    enterMs: 700,
    stagger: 80,
    reducedMotion: true,
  },
  chart: {
    palette: [],
    grid: true,
    legend: true,
    values: false,
    smooth: true,
    dots: true,
    compact: true,
    ticks: 4,
    gridOpacity: 0.14,
    axisOpacity: 0.35,
    prefix: '',
    suffix: '',
    decimals: 1,
  },
  components: {},
  css: '',
};

const isPlain = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const clone = (v) => (Array.isArray(v) ? v.map(clone) : isPlain(v) ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clone(x)])) : v);

/** Deep merge; `null` in the patch removes a key, arrays replace wholesale. */
export function mergeSystem(base, patch) {
  const out = clone(base);
  if (!isPlain(patch)) return out;
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) { delete out[k]; continue; }
    if (isPlain(v) && isPlain(out[k])) out[k] = mergeSystem(out[k], v);
    else out[k] = clone(v);
  }
  return out;
}

/** Fill in everything the caller left out, so the compiler never sees a hole. */
export function normalizeSystem(input) {
  const s = mergeSystem(DEFAULT_SYSTEM, input || {});
  if (!Array.isArray(s.color.series) || !s.color.series.length) s.color.series = clone(DEFAULT_SYSTEM.color.series);
  s.color.series = s.color.series.slice(0, 6);
  while (s.color.series.length < 6) s.color.series.push(DEFAULT_SYSTEM.color.series[s.color.series.length]);
  if (!Array.isArray(s.chart.palette)) s.chart.palette = [];
  for (const key of ['display', 'body', 'mono']) {
    const f = s.typography.fonts[key] || (s.typography.fonts[key] = clone(DEFAULT_SYSTEM.typography.fonts[key]));
    if (!Array.isArray(f.weights)) f.weights = [400];
  }
  if (!isPlain(s.components)) s.components = {};
  s.css = typeof s.css === 'string' ? s.css : '';
  return s;
}

// ---------- compiling to CSS ----------

const cssStr = (v) => String(v == null ? '' : v).replace(/[<>]/g, '').replace(/;\s*$/, '').trim();

/** A font stack: quote the family when it needs quoting, then the fallbacks. */
export function fontStack(font) {
  const family = cssStr(font && font.family) || 'system-ui';
  const quoted = /^[a-zA-Z-]+$/.test(family) || /^(ui-|system-)/.test(family) || /^["']/.test(family) ? family : `"${family.replace(/"/g, '')}"`;
  const fallback = cssStr(font && font.fallback);
  return fallback ? `${quoted}, ${fallback}` : quoted;
}

function fontImports(system) {
  const seen = new Set();
  const out = [];
  for (const key of ['display', 'body', 'mono']) {
    const url = cssStr(system.typography.fonts[key].url);
    if (!url || seen.has(url)) continue;
    if (!/^https:\/\//i.test(url) && !/^\.{0,2}\//.test(url)) continue; // https or a path next to the deck
    seen.add(url);
    out.push(`@import url("${url.replace(/"/g, '')}");`);
  }
  return out;
}

/** Chart options the runtime should assume when a figure does not say otherwise. */
export function chartDefaults(system) {
  const s = normalizeSystem(system);
  const c = s.chart;
  const out = {
    grid: !!c.grid, legend: !!c.legend, values: !!c.values, smooth: !!c.smooth,
    dots: !!c.dots, compact: !!c.compact, ticks: Number(c.ticks) || 4,
  };
  if (c.prefix) out.prefix = String(c.prefix);
  if (c.suffix) out.suffix = String(c.suffix);
  if (c.decimals !== undefined && c.decimals !== null) out.decimals = Number(c.decimals);
  const palette = (c.palette && c.palette.length ? c.palette : s.color.series).slice(0, 6).map(cssStr);
  if (palette.length) out.colors = palette;
  return out;
}

/** The whole system as one CSS block: custom properties first, then the rules that use them. */
export function compileSystemCss(system) {
  const s = normalizeSystem(system);
  const t = s.typography;
  const c = s.color;
  const sp = s.space;
  const mo = s.motion;
  const series = (s.chart.palette && s.chart.palette.length ? s.chart.palette : c.series).slice(0, 6);

  const vars = [
    ['--font-display', fontStack(t.fonts.display)],
    ['--font-body', fontStack(t.fonts.body)],
    ['--font-mono', fontStack(t.fonts.mono)],
    ...Object.entries(t.scale).map(([k, v]) => [`--text-${k}`, cssStr(v)]),
    ...Object.entries(t.weight).map(([k, v]) => [`--weight-${k}`, cssStr(v)]),
    ...Object.entries(t.tracking).map(([k, v]) => [`--track-${k}`, cssStr(v)]),
    ...Object.entries(t.leading).map(([k, v]) => [`--lead-${k}`, cssStr(v)]),
    ...Object.entries(t.transform).map(([k, v]) => [`--case-${k}`, cssStr(v)]),
    ['--measure', cssStr(t.measure)],
    ['--bg', cssStr(c.bg)],
    ['--surface', cssStr(c.surface)],
    ['--surface-alt', cssStr(c.surfaceAlt)],
    ['--ink', cssStr(c.ink)],
    ['--ink-muted', cssStr(c.inkMuted)],
    ['--ink-faint', cssStr(c.inkFaint)],
    ['--accent', cssStr(c.accent)],
    ['--accent-ink', cssStr(c.accentInk)],
    ['--accent-soft', cssStr(c.accentSoft)],
    ['--hairline', cssStr(c.hairline)],
    ['--positive', cssStr(c.positive)],
    ['--negative', cssStr(c.negative)],
    ['--warning', cssStr(c.warning)],
    ['--dek-highlight', cssStr(c.highlight)],
    ...(c.gradient ? [['--gradient', cssStr(c.gradient)]] : []),
    ['--space', cssStr(sp.unit)],
    ['--slide-pad-x', cssStr(sp.slidePadX)],
    ['--slide-pad-y', cssStr(sp.slidePadY)],
    ['--gap', cssStr(sp.gap)],
    ['--gap-tight', cssStr(sp.gapTight)],
    ['--gap-loose', cssStr(sp.gapLoose)],
    ['--radius', cssStr(sp.radius)],
    ['--radius-sm', cssStr(sp.radiusSm)],
    ['--radius-lg', cssStr(sp.radiusLg)],
    ['--border', cssStr(sp.border)],
    ['--rule', cssStr(sp.rule)],
    ['--shadow', cssStr(sp.shadow)],
    ['--dek-transition-ms', `${Number(mo.transitionMs) || 480}ms`],
    ['--dek-fragment-ms', `${Number(mo.fragmentMs) || 320}ms`],
    ['--dek-auto-animate-ms', `${Number(mo.autoAnimateMs) || 600}ms`],
    ['--dek-ease', cssStr(mo.ease)],
    ['--dek-enter', cssStr(mo.enter)],
    ['--dek-enter-ms', `${Number(mo.enterMs) || 700}ms`],
    ['--dek-stagger', `${Number(mo.stagger) || 0}ms`],
    ['--chart-grid-opacity', cssStr(s.chart.gridOpacity)],
    ['--chart-axis-opacity', cssStr(s.chart.axisOpacity)],
    ...series.map((v, i) => [`--dek-c${i + 1}`, cssStr(v)]),
  ].filter(([, v]) => v !== '');

  const imports = fontImports(s);

  // The compiled block is the deck's base layer. Bare element selectors are
  // also emitted scoped under .dek-root (which the runtime puts on <body>) so
  // the system beats a deck's own `h1 {}` inside Dek, while the unscoped copy
  // keeps the deck readable as a plain page in any browser. A deck's own
  // class-based rules always win over both.
  const boost = (selector) => selector.split(',').map((one) => {
    const t = one.trim();
    return /^[a-z][a-z0-9]*(\s*[>+~]\s*[a-z][a-z0-9]*)*$/i.test(t) ? `${t}, .dek-root ${t}` : t;
  }).join(', ');

  const rule = (selector, decls) => `${boost(selector)} { ${decls} }`;

  // Roles that mean "the same ink, dimmer" follow currentColor, so a slide that
  // inverts its own background keeps working. Absolute tokens are for the
  // deck's default surface; a slide that inverts re-declares them on itself.
  const dim = (pct) => `color-mix(in oklch, currentColor ${pct}%, transparent)`;

  const rules = [
    `section, .dek-root > section { background: ${c.gradient ? 'var(--gradient), var(--bg)' : 'var(--bg)'}; color: var(--ink); font-family: var(--font-body); font-size: var(--text-body); font-weight: var(--weight-body); line-height: var(--lead-body); letter-spacing: var(--track-body); }`,
    '.dek-root > section { padding: var(--slide-pad-y) var(--slide-pad-x); }',
    '.dek-root > section.dek-full { padding: 0; }',
    rule('h1, h2, h3, h4', 'font-family: var(--font-display); font-weight: var(--weight-heading); line-height: var(--lead-heading); letter-spacing: var(--track-heading);'),
    rule('h1', 'font-size: var(--text-h1); font-weight: var(--weight-display); line-height: var(--lead-display); letter-spacing: var(--track-display); text-transform: var(--case-display);'),
    rule('h2', 'font-size: var(--text-h2);'),
    rule('h3', 'font-size: var(--text-h3);'),
    rule('h4', 'font-size: var(--text-small);'),
    rule('p, li, dd, dt, figcaption, blockquote', 'max-width: var(--measure);'),
    rule('strong, b', 'font-weight: var(--weight-strong);'),
    rule('em, i', 'font-style: italic;'),
    rule('a', 'color: var(--accent); text-decoration-color: var(--accent-soft);'),
    rule('mark', 'background: var(--accent-soft); color: inherit;'),
    rule('hr', 'border: 0; border-top: var(--border) solid var(--hairline);'),
    rule('blockquote', `border-left: var(--rule) solid var(--accent); padding-left: var(--gap-tight); opacity: 1; color: ${dim(78)};`),
    rule('small, figcaption', `color: ${dim(70)}; opacity: 1; font-size: var(--text-small);`),
    rule('code, kbd, pre', 'font-family: var(--font-mono); font-variant-numeric: tabular-nums;'),
    rule('pre', 'background: var(--surface); border-radius: var(--radius-sm);'),
    rule('th, td', 'border-bottom: var(--border) solid var(--hairline);'),
    rule('th', `color: ${dim(60)}; letter-spacing: var(--track-caption); text-transform: var(--case-caption); opacity: 1;`),
    // dek- classes are the system's own namespace; a deck's class names stay its own
    '.dek-display { font-family: var(--font-display); font-size: var(--text-display); font-weight: var(--weight-display); line-height: var(--lead-display); letter-spacing: var(--track-display); text-transform: var(--case-display); }',
    `.dek-lead { font-size: var(--text-lead); line-height: var(--lead-heading); color: ${dim(78)}; }`,
    `.dek-muted { color: ${dim(70)}; opacity: 1; }`,
    `.dek-caption, .dek-eyebrow { font-size: var(--text-caption); letter-spacing: var(--track-caption); text-transform: var(--case-caption); color: ${dim(60)}; }`,
    '.dek-accent { color: var(--accent); }',
    '.dek-mono { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }',
    '.dek-card, .dek-surface { background: var(--surface); border: var(--border) solid var(--hairline); border-radius: var(--radius); padding: var(--gap-tight); }',
    '.dek-card { box-shadow: var(--shadow); }',
    '.dek-surface-alt { background: var(--surface-alt); }',
    '.dek-rule { border: 0; border-top: var(--rule) solid var(--accent); width: 96px; margin: 0; }',
    '.dek-positive { color: var(--positive); }',
    '.dek-negative { color: var(--negative); }',
    '.dek-warning { color: var(--warning); }',
    '.dek-root li::marker { color: var(--accent); opacity: 1; }',
    '.dek-chart .dek-grid line { opacity: var(--chart-grid-opacity); }',
    '.dek-chart .dek-axis line { opacity: var(--chart-axis-opacity); }',
    `.dek-chart .dek-tick, .dek-chart .dek-legend { fill: ${dim(70)}; }`,
  ].join('\n');

  const reduced = mo.reducedMotion ? `
@media (prefers-reduced-motion: reduce) {
  :root { --dek-transition-ms: 120ms; --dek-fragment-ms: 120ms; --dek-auto-animate-ms: 120ms; }
}`.trim() : '';

  return [
    ...imports,
    ':root {\n' + vars.map(([k, v]) => `  ${k}: ${v};`).join('\n') + '\n}',
    rules,
    reduced,
    cssStr(s.css) ? s.css.trim() : '',
  ].filter(Boolean).join('\n\n') + '\n';
}

// ---------- applying a system to a deck ----------

const rawModel = (raw) => ({ raw, structure: structure(raw) });
const attrEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Write the theme's components into the body as <template data-dek-component> blocks. */
export function upsertComponents(raw, components) {
  let out = raw;
  for (const [name, def] of Object.entries(components || {})) {
    const html = typeof def === 'string' ? def : (def && def.html) || '';
    if (!html.trim()) continue;
    const description = typeof def === 'object' && def ? def.description || '' : '';
    const tag = `<template data-dek-component="${attrEsc(name)}"${description ? ` data-description="${attrEsc(description)}"` : ''} data-dek-theme-owned>\n${html.trim()}\n</template>`;
    const existing = componentRanges(out).find((c) => c.name === name);
    if (existing) { out = out.slice(0, existing.start) + tag + out.slice(existing.end); continue; }
    const s = structure(out);
    const at = s.slides.length ? s.slides[0].start : s.body.end;
    out = out.slice(0, at) + tag + '\n\n' + out.slice(at);
  }
  return out;
}

/** Drop the <template>s a previous theme owned that this one no longer defines. */
export function pruneThemeComponents(raw, keep) {
  let out = raw;
  for (;;) {
    const stale = componentRanges(out).find((c) => c.themeOwned && !(keep && Object.prototype.hasOwnProperty.call(keep, c.name)));
    if (!stale) return out;
    const before = out.slice(0, stale.start).replace(/[ \t]*$/, '');
    const after = out.slice(stale.end).replace(/^[ \t]*\n{0,2}/, '\n');
    out = before + after;
  }
}

/**
 * Apply a theme to a deck's raw HTML: one <style id="dek-theme"> block, the
 * motion/chart/identity <meta>s, and the components the theme owns.
 * `theme` may be a full theme record or a bare system.
 */
export function applyThemeToRaw(raw, theme, o = {}) {
  const system = normalizeSystem(theme && theme.versions ? currentSystem(theme) : theme);
  const id = (theme && theme.id) || o.id || '';
  const version = theme && theme.versions ? currentVersion(theme) : o.version;
  let out = appendStyle(rawModel(raw), compileSystemCss(system), THEME_STYLE_ID);
  out = upsertMeta(rawModel(out), 'dek-transition', system.motion.transition || 'fade');
  out = upsertMeta(rawModel(out), 'dek-chart', JSON.stringify(chartDefaults(system)));
  out = upsertMeta(rawModel(out), 'dek-theme', id ? `${id}@${version || 1}` : null);
  out = pruneThemeComponents(out, system.components);
  out = upsertComponents(out, system.components);
  return out;
}

/** Take the theme back off a deck: its style block, its metas and its components. */
export function removeThemeFromRaw(raw) {
  let out = raw.replace(new RegExp(`\\n?[ \\t]*<style[^>]*\\sid=["']${THEME_STYLE_ID}["'][^>]*>[\\s\\S]*?<\\/style>[ \\t]*`, 'i'), '\n');
  out = upsertMeta(rawModel(out), 'dek-theme', null);
  out = upsertMeta(rawModel(out), 'dek-chart', null);
  out = pruneThemeComponents(out, null);
  return out;
}

/**
 * Custom properties the deck's own CSS reads but nothing would define once
 * `system` is applied — the rules that would quietly stop resolving. Decks
 * written by hand against their own variable names hit this when they are
 * moved onto a system that was designed elsewhere.
 */
export function missingVars(raw, system) {
  const declared = new Set(compiledVarNames(normalizeSystem(system)));
  const used = new Set();
  const st = structure(raw);
  for (const r of st.styles) {
    const css = raw.slice(r.start, r.end);
    // a block the theme owns is about to be replaced, so what it declares does not count
    const owned = /<style[^>]*\sid=["']dek-theme["'][^>]*>$/i.test(raw.slice(Math.max(0, r.start - 120), r.start));
    if (!owned) for (const m of css.matchAll(/(--[\w-]+)\s*:/g)) declared.add(m[1]);
    for (const m of css.matchAll(/var\(\s*(--[\w-]+)\s*(,|\))/g)) if (m[2] === ')') used.add(m[1]);
  }
  // inline styles on slides can reference variables too
  for (const m of raw.matchAll(/style\s*=\s*"([^"]*)"/gi)) {
    for (const v of m[1].matchAll(/var\(\s*(--[\w-]+)\s*\)/g)) used.add(v[1]);
  }
  return Array.from(used).filter((v) => !declared.has(v)).sort();
}

/** Which theme (and which version of it) a deck was last dressed with. */
export function readDeckTheme(raw) {
  const m = /<meta[^>]*\sname=["']dek-theme["'][^>]*\scontent=["']([^"']*)["']/i.exec(raw)
    || /<meta[^>]*\scontent=["']([^"']*)["'][^>]*\sname=["']dek-theme["']/i.exec(raw);
  if (!m || !m[1].trim()) return null;
  const [id, v] = m[1].trim().split('@');
  return { id, version: parseInt(v, 10) || 1 };
}

// ---------- reading a system back out of a deck ----------

// Names decks in the wild use for the same idea, mapped onto our tokens. The
// first name that a deck actually declares wins.
const COLOR_ALIASES = {
  bg: ['--bg', '--background', '--paper', '--page', '--canvas', '--base'],
  surface: ['--surface', '--paper-2', '--card', '--panel', '--surface-1'],
  surfaceAlt: ['--surface-alt', '--surface-2', '--raised'],
  ink: ['--ink', '--fg', '--text-color', '--foreground'],
  inkMuted: ['--ink-muted', '--ink-2', '--muted', '--text-2', '--secondary'],
  inkFaint: ['--ink-faint', '--ink-3', '--faint', '--text-3', '--tertiary'],
  accent: ['--accent', '--brand', '--primary', '--spot'],
  accentInk: ['--accent-ink', '--on-accent'],
  accentSoft: ['--accent-soft', '--accent-muted'],
  hairline: ['--hairline', '--border', '--line', '--divider', '--rule'],
  highlight: ['--dek-highlight', '--highlight'],
  positive: ['--positive', '--success', '--up'],
  negative: ['--negative', '--danger', '--error', '--down'],
  warning: ['--warning', '--amber', '--caution'],
};
const SPACE_ALIASES = {
  gap: ['--gap'], gapTight: ['--gap-tight'], gapLoose: ['--gap-loose'],
  radius: ['--radius'], radiusSm: ['--radius-sm'], radiusLg: ['--radius-lg'],
  slidePadX: ['--slide-pad-x'], slidePadY: ['--slide-pad-y'], shadow: ['--shadow'],
};
const FONT_ALIASES = {
  display: ['--font-display', '--display', '--heading', '--font-heading', '--serif'],
  body: ['--font-body', '--body', '--text', '--font-text', '--sans'],
  mono: ['--font-mono', '--mono', '--code'],
};

/** Every custom property declared on :root anywhere in the deck's CSS. */
export function rootVars(raw) {
  const vars = {};
  const s = structure(raw);
  for (const r of s.styles) {
    const css = raw.slice(r.start, r.end);
    for (const block of css.match(/:root[^{]*\{[^}]*\}/g) || []) {
      for (const m of block.matchAll(/(--[\w-]+)\s*:\s*([^;}]+)/g)) vars[m[1]] = m[2].trim();
    }
  }
  return vars;
}

/** Follow `var(--x)` indirections a couple of hops so tokens hold real values. */
function resolveVar(value, vars, depth = 0) {
  const m = /^var\(\s*(--[\w-]+)\s*(?:,([^)]*))?\)$/.exec(String(value || '').trim());
  if (!m || depth > 3) return value;
  const next = vars[m[1]] !== undefined ? vars[m[1]] : (m[2] || '').trim();
  return next ? resolveVar(next, vars, depth + 1) : value;
}

const pickVar = (vars, names) => {
  for (const n of names) if (vars[n]) return resolveVar(vars[n], vars);
  return undefined;
};

/** Dark or light, judged from the background the deck actually paints. */
export function modeOf(color) {
  const c = String(color || '');
  let l = null;
  const oklch = /^okl(?:ch|ab)\(\s*([0-9.]+)%?/i.exec(c);
  if (oklch) l = parseFloat(oklch[1]) > 1 ? parseFloat(oklch[1]) / 100 : parseFloat(oklch[1]);
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})\b/i.exec(c);
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].split('').map((x) => x + x).join('') : hex[1];
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
    l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  const rgb = /^rgba?\(\s*([0-9.]+)[\s,]+([0-9.]+)[\s,]+([0-9.]+)/i.exec(c);
  if (l === null && rgb) l = (0.2126 * +rgb[1] + 0.7152 * +rgb[2] + 0.0722 * +rgb[3]) / 255;
  const hsl = /^hsla?\([^,)]+[\s,]+[0-9.]+%[\s,]+([0-9.]+)%/i.exec(c);
  if (l === null && hsl) l = parseFloat(hsl[1]) / 100;
  if (l === null) return null;
  return l > 0.5 ? 'light' : 'dark';
}

/** The custom properties the compiler itself writes — a capture only carries the rest forward. */
function compiledVarNames(system) {
  const out = new Set();
  for (const line of compileSystemCss(system).split('\n')) {
    const m = /^\s*(--[\w-]+)\s*:/.exec(line);
    if (m) out.add(m[1]);
  }
  return out;
}

/** The last value a deck gives `prop` in any rule whose selector list contains `selector`. */
function declOf(css, selector, prop) {
  let found;
  for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const selectors = m[1].split(',').map((x) => x.trim().replace(/\s+/g, ' '));
    if (!selectors.includes(selector)) continue;
    const decl = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, 'i').exec(m[2]);
    if (decl) found = decl[1].trim();
  }
  return found;
}

/** Reject a value that plainly is not a color, so `--rule: 3px` never becomes a hairline. */
const looksLikeColor = (v) => {
  const s = String(v || '').trim();
  if (!s) return false;
  if (/^-?[0-9.]+(px|rem|em|%|vh|vw|ch|pt)?$/.test(s)) return false;
  return /^#[0-9a-f]{3,8}$/i.test(s) || /^(okl(ch|ab)|rgba?|hsla?|color|lab|lch|hwb)\(/i.test(s)
    || /^(transparent|currentColor|[a-z]+)$/i.test(s) || /gradient\(/i.test(s);
};

/**
 * Best-effort system from a deck that was styled by hand: enough to start a
 * design system from a look you already like, not a faithful decompilation.
 * Whatever the compiler cannot express is carried forward verbatim in `css`,
 * so applying the captured system leaves the deck looking as it did.
 */
export function captureSystem(raw, o = {}) {
  const vars = rootVars(raw);
  const css = structure(raw).styles.map((r) => raw.slice(r.start, r.end)).join('\n');
  const patch = { meta: { notes: o.notes || '' }, color: {}, space: {}, typography: { fonts: {}, scale: {} }, motion: {} };

  for (const [key, names] of Object.entries(COLOR_ALIASES)) {
    const v = pickVar(vars, names);
    if (looksLikeColor(v)) patch.color[key] = v;
  }
  for (const [key, names] of Object.entries(SPACE_ALIASES)) {
    const v = pickVar(vars, names);
    if (v) patch.space[key] = v;
  }
  const series = [];
  for (let i = 1; i <= 6; i++) if (vars[`--dek-c${i}`]) series[i - 1] = resolveVar(vars[`--dek-c${i}`], vars);
  if (series.filter(Boolean).length) patch.color.series = DEFAULT_SYSTEM.color.series.map((d, i) => series[i] || d);

  // fonts: named variables first, then whatever the section rule and headings use
  for (const [role, names] of Object.entries(FONT_ALIASES)) {
    const v = pickVar(vars, names);
    if (v) patch.typography.fonts[role] = splitStack(v);
  }
  const literal = (v) => (v && !/^var\(/.test(v) ? resolveVar(v, vars) : (v ? resolveVar(v, vars) : undefined));
  const bodyFace = literal(declOf(css, 'section', 'font-family'));
  const headFace = literal(declOf(css, 'h1', 'font-family')) || literal(declOf(css, 'h1, h2', 'font-family'));
  if (!patch.typography.fonts.body && bodyFace && !/^var\(/.test(bodyFace)) patch.typography.fonts.body = splitStack(bodyFace);
  if (!patch.typography.fonts.display && headFace && !/^var\(/.test(headFace)) patch.typography.fonts.display = splitStack(headFace);
  if (!patch.typography.fonts.display && patch.typography.fonts.body) patch.typography.fonts.display = { ...patch.typography.fonts.body };
  const link = /<link[^>]*href=["'](https:\/\/fonts\.googleapis\.com[^"']+)["']/i.exec(raw);
  if (link) for (const role of ['display', 'body']) if (patch.typography.fonts[role]) patch.typography.fonts[role].url = link[1];

  // type scale and slide padding, read off the rules a deck almost always writes
  for (const [key, selector] of [['h1', 'h1'], ['h2', 'h2'], ['h3', 'h3'], ['body', 'p'], ['lead', '.lead']]) {
    const size = declOf(css, selector, 'font-size');
    if (size && !/^var\(/.test(size)) patch.typography.scale[key] = size;
  }
  const measure = declOf(css, 'p', 'max-width');
  if (measure && !/^var\(/.test(measure)) patch.typography.measure = measure;
  const pad = declOf(css, 'section', 'padding');
  if (pad && !/^var\(/.test(pad)) {
    const parts = pad.split(/\s+/);
    if (parts.length >= 1) patch.space.slidePadY = parts[0];
    patch.space.slidePadX = parts[1] || parts[0];
  }

  const trans = /<meta[^>]*name=["']dek-transition["'][^>]*content=["']([^"']+)["']/i.exec(raw);
  if (trans) patch.motion.transition = trans[1].trim();
  const ms = parseInt(vars['--dek-transition-ms'], 10);
  if (ms) patch.motion.transitionMs = ms;
  const fragMs = parseInt(vars['--dek-fragment-ms'], 10);
  if (fragMs) patch.motion.fragmentMs = fragMs;
  if (vars['--dek-ease']) patch.motion.ease = vars['--dek-ease'];

  patch.meta.mode = o.mode || modeOf(patch.color.bg) || 'dark';

  const system = normalizeSystem(patch);
  // anything the deck declared that the compiler will not re-emit stays, so
  // rules like `background: var(--paper)` keep resolving after the swap
  const compiled = compiledVarNames(system);
  const carried = Object.entries(vars).filter(([k]) => !compiled.has(k));
  if (carried.length) {
    system.css = [
      '/* carried over from the deck this system was captured from */',
      ':root {\n' + carried.map(([k, v]) => `  ${k}: ${v};`).join('\n') + '\n}',
      system.css,
    ].filter(Boolean).join('\n');
  }
  return system;
}

function splitStack(stack) {
  const parts = String(stack).split(',').map((p) => p.trim()).filter(Boolean);
  const first = (parts.shift() || '').replace(/^["']|["']$/g, '');
  return { family: first, fallback: parts.join(', '), weights: [400, 700], url: '' };
}

// ---------- the library ----------

export function slugify(name) {
  const s = String(name || '').toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 32);
  return s || 'system';
}

function uniqueId(base, taken) {
  if (!taken.includes(base)) return base;
  for (let n = 2; n < 100; n++) if (!taken.includes(`${base}-${n}`)) return `${base}-${n}`;
  return `${base}-${Date.now().toString(36)}`;
}

export function emptyLibrary() { return { version: 1, themes: [] }; }

/** Accept anything that was on disk and give back a library we can rely on. */
export function normalizeLibrary(input) {
  const lib = emptyLibrary();
  const themes = input && Array.isArray(input.themes) ? input.themes : [];
  for (const t of themes.slice(0, MAX_THEMES)) {
    if (!t || !t.id) continue;
    const versions = (Array.isArray(t.versions) ? t.versions : []).filter((v) => v && v.system).map((v, i) => ({
      v: Number(v.v) || i + 1,
      at: Number(v.at) || 0,
      note: String(v.note || ''),
      system: normalizeSystem(v.system),
    }));
    if (!versions.length) versions.push({ v: 1, at: Number(t.createdAt) || 0, note: 'created', system: normalizeSystem(t.system) });
    lib.themes.push({
      id: String(t.id),
      name: String(t.name || t.id),
      description: String(t.description || ''),
      createdAt: Number(t.createdAt) || versions[0].at || 0,
      updatedAt: Number(t.updatedAt) || versions[versions.length - 1].at || 0,
      versions,
    });
  }
  return lib;
}

export const findTheme = (lib, id) => (lib && lib.themes ? lib.themes.find((t) => t.id === id) || null : null);
export const currentVersion = (theme) => (theme && theme.versions.length ? theme.versions[theme.versions.length - 1].v : 1);
export const currentSystem = (theme) => (theme && theme.versions.length ? theme.versions[theme.versions.length - 1].system : normalizeSystem({}));

function pushVersion(theme, system, note, now) {
  theme.versions.push({ v: currentVersion(theme) + 1, at: now, note: String(note || 'updated'), system: normalizeSystem(system) });
  if (theme.versions.length > MAX_VERSIONS) theme.versions.splice(0, theme.versions.length - MAX_VERSIONS);
  theme.updatedAt = now;
  return theme;
}

export function createTheme(lib, { name, description, system, id, note } = {}, now = Date.now()) {
  const library = normalizeLibrary(lib);
  if (library.themes.length >= MAX_THEMES) {
    throw new Error(`The library holds ${MAX_THEMES} design systems. Delete one before adding another.`);
  }
  if (!String(name || '').trim()) throw new Error('name is required');
  const theme = {
    id: uniqueId(slugify(id || name), library.themes.map((t) => t.id)),
    name: String(name).trim(),
    description: String(description || ''),
    createdAt: now,
    updatedAt: now,
    versions: [{ v: 1, at: now, note: String(note || 'created'), system: normalizeSystem(system) }],
  };
  library.themes.push(theme);
  return { library, theme };
}

/** Patch a theme's tokens (deep merge, `null` removes) and/or rename it; every token change is a new version. */
export function updateTheme(lib, id, { system, replace, name, description, note } = {}, now = Date.now()) {
  const library = normalizeLibrary(lib);
  const theme = findTheme(library, id);
  if (!theme) throw new Error(`No design system "${id}"`);
  if (name !== undefined && String(name).trim()) theme.name = String(name).trim();
  if (description !== undefined) theme.description = String(description);
  if (system) pushVersion(theme, replace ? system : mergeSystem(currentSystem(theme), system), note, now);
  else theme.updatedAt = now;
  return { library, theme };
}

export function deleteTheme(lib, id) {
  const library = normalizeLibrary(lib);
  const i = library.themes.findIndex((t) => t.id === id);
  if (i < 0) throw new Error(`No design system "${id}"`);
  const [theme] = library.themes.splice(i, 1);
  return { library, theme };
}

export function duplicateTheme(lib, id, name, now = Date.now()) {
  const source = findTheme(normalizeLibrary(lib), id);
  if (!source) throw new Error(`No design system "${id}"`);
  return createTheme(lib, {
    name: name || `${source.name} copy`,
    description: source.description,
    system: currentSystem(source),
    note: `copied from ${source.name} v${currentVersion(source)}`,
  }, now);
}

/** Roll back by moving an old version forward: history stays append-only. */
export function revertTheme(lib, id, version, now = Date.now()) {
  const library = normalizeLibrary(lib);
  const theme = findTheme(library, id);
  if (!theme) throw new Error(`No design system "${id}"`);
  const entry = theme.versions.find((v) => v.v === Number(version));
  if (!entry) throw new Error(`Design system "${id}" has no version ${version}`);
  if (entry.v === currentVersion(theme)) return { library, theme };
  pushVersion(theme, entry.system, `reverted to v${entry.v}`, now);
  return { library, theme };
}

/** What the nav bar, the panel and list_themes all show. */
export function themeSummary(theme) {
  const system = currentSystem(theme);
  return {
    id: theme.id,
    name: theme.name,
    description: theme.description,
    version: currentVersion(theme),
    versions: theme.versions.length,
    updatedAt: theme.updatedAt,
    mode: system.meta.mode,
    mood: system.meta.mood,
    swatches: [system.color.bg, system.color.ink, system.color.accent, ...system.color.series.slice(0, 3)],
    fonts: { display: system.typography.fonts.display.family, body: system.typography.fonts.body.family },
    transition: system.motion.transition,
  };
}

/** Components a deck carries that no theme owns — the ones a capture should keep. */
export function deckOwnedComponents(raw) {
  const out = {};
  for (const c of componentRanges(raw)) if (!c.themeOwned) out[c.name] = { description: c.description, html: c.html.trim() };
  return out;
}

export { scanTags };
