// The system: defaults, merging, and the CSS it compiles to.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SYSTEM, mergeSystem, normalizeSystem, compileSystemCss, chartDefaults, fontStack,
} from '../src/theme.js';
import { rootDecls } from './helpers.js';

test('mergeSystem merges deeply and leaves the base untouched', () => {
  const base = { color: { bg: '#000', ink: '#fff' }, motion: { transitionMs: 480 } };
  const out = mergeSystem(base, { color: { bg: '#111' } });
  assert.equal(out.color.bg, '#111');
  assert.equal(out.color.ink, '#fff');
  assert.equal(out.motion.transitionMs, 480);
  assert.equal(base.color.bg, '#000', 'the base object is not mutated');
});

test('mergeSystem removes a key when the patch says null, and replaces arrays wholesale', () => {
  const out = mergeSystem({ color: { bg: '#000', gradient: 'linear-gradient(red, blue)', series: ['a', 'b', 'c'] } }, {
    color: { gradient: null, series: ['x'] },
  });
  assert.equal('gradient' in out.color, false);
  assert.deepEqual(out.color.series, ['x']);
});

test('normalizeSystem fills the holes a partial system leaves', () => {
  const s = normalizeSystem({ color: { accent: 'red' } });
  assert.equal(s.color.accent, 'red');
  assert.equal(s.color.bg, DEFAULT_SYSTEM.color.bg);
  assert.equal(s.typography.fonts.body.family, DEFAULT_SYSTEM.typography.fonts.body.family);
  assert.equal(s.motion.transitionMs, DEFAULT_SYSTEM.motion.transitionMs);
});

test('normalizeSystem always yields exactly six series colors', () => {
  assert.equal(normalizeSystem({ color: { series: ['#111', '#222'] } }).color.series.length, 6);
  assert.equal(normalizeSystem({ color: { series: [] } }).color.series.length, 6);
  assert.equal(normalizeSystem({ color: { series: new Array(9).fill('#111') } }).color.series.length, 6);
  assert.equal(normalizeSystem({ color: { series: null } }).color.series.length, 6);
});

test('fontStack quotes multi-word families and keeps the fallbacks', () => {
  assert.equal(fontStack({ family: 'Inter', fallback: 'system-ui, sans-serif' }), 'Inter, system-ui, sans-serif');
  assert.equal(fontStack({ family: 'Playfair Display', fallback: 'Georgia, serif' }), '"Playfair Display", Georgia, serif');
  assert.equal(fontStack({ family: 'ui-monospace', fallback: 'Menlo' }), 'ui-monospace, Menlo');
  assert.equal(fontStack({}), 'system-ui');
});

test('compileSystemCss publishes every token group as custom properties', () => {
  const css = compileSystemCss({
    typography: { fonts: { display: { family: 'Söhne', fallback: 'sans-serif' } }, scale: { h1: '4rem' } },
    color: { bg: 'oklch(0.1 0 0)', accent: 'oklch(0.8 0.2 30)', series: ['#1', '#2', '#3', '#4', '#5', '#6'] },
    space: { gap: '56px', radius: '12px' },
    motion: { transitionMs: 700, fragmentMs: 200, ease: 'linear' },
  });
  const vars = rootDecls(css);
  assert.equal(vars['--font-display'], '"Söhne", sans-serif');
  assert.equal(vars['--text-h1'], '4rem');
  assert.equal(vars['--bg'], 'oklch(0.1 0 0)');
  assert.equal(vars['--accent'], 'oklch(0.8 0.2 30)');
  assert.equal(vars['--gap'], '56px');
  assert.equal(vars['--radius'], '12px');
  assert.equal(vars['--dek-transition-ms'], '700ms');
  assert.equal(vars['--dek-fragment-ms'], '200ms');
  assert.equal(vars['--dek-ease'], 'linear');
  assert.equal(vars['--dek-c1'], '#1');
  assert.equal(vars['--dek-c6'], '#6');
});

test('compiled rules bind the deck to the tokens rather than to literals', () => {
  const css = compileSystemCss({});
  assert.match(css, /\.dek-root > section \{ padding: var\(--slide-pad-y\) var\(--slide-pad-x\); \}/);
  assert.match(css, /h1 \{ font-size: var\(--text-h1\)/);
  assert.match(css, /font-family: var\(--font-body\)/);
  assert.match(css, /a \{ color: var\(--accent\)/);
  // the base stylesheet's `.dek-root > section` padding must be beaten on specificity
  assert.ok(css.includes('.dek-root > section'), 'padding rule matches the runtime selector');
});

test('a gradient participates in the slide background only when the system sets one', () => {
  assert.match(compileSystemCss({ color: { gradient: 'radial-gradient(#111, #000)' } }), /background: var\(--gradient\), var\(--bg\)/);
  assert.match(compileSystemCss({}), /background: var\(--bg\)/);
});

test('reduced motion collapses the timings, and can be switched off', () => {
  assert.match(compileSystemCss({}), /@media \(prefers-reduced-motion: reduce\)/);
  assert.doesNotMatch(compileSystemCss({ motion: { reducedMotion: false } }), /prefers-reduced-motion/);
});

test('web font urls become @import lines, and only from https or a relative path', () => {
  const css = compileSystemCss({
    typography: { fonts: { display: { family: 'Inter', url: 'https://fonts.googleapis.com/css2?family=Inter' } } },
  });
  assert.match(css, /@import url\("https:\/\/fonts\.googleapis\.com\/css2\?family=Inter"\);/);
  assert.doesNotMatch(compileSystemCss({ typography: { fonts: { display: { url: 'javascript:alert(1)' } } } }), /@import/);
});

test('the same url is imported once even when several roles share it', () => {
  const url = 'https://fonts.googleapis.com/css2?family=Inter';
  const css = compileSystemCss({ typography: { fonts: { display: { url }, body: { url } } } });
  assert.equal(css.match(/@import/g).length, 1);
});

test('raw css escapes into the block verbatim, at the end', () => {
  const css = compileSystemCss({ css: '.hero { mix-blend-mode: screen; }' });
  assert.ok(css.trimEnd().endsWith('.hero { mix-blend-mode: screen; }'));
});

test('token values cannot smuggle markup out of the style block', () => {
  const css = compileSystemCss({ color: { bg: '</style><script>alert(1)</script>' } });
  assert.doesNotMatch(css, /<\/style>/i);
  assert.doesNotMatch(css, /<script/i);
});

test('chartDefaults reflects the graph preferences and falls back to the series palette', () => {
  const d = chartDefaults({ chart: { grid: false, values: true, ticks: 6, suffix: '%' }, color: { series: ['#a', '#b', '#c', '#d', '#e', '#f'] } });
  assert.equal(d.grid, false);
  assert.equal(d.values, true);
  assert.equal(d.ticks, 6);
  assert.equal(d.suffix, '%');
  assert.deepEqual(d.colors, ['#a', '#b', '#c', '#d', '#e', '#f']);
  assert.equal('prefix' in d, false, 'an empty prefix is left out so figures can set their own');
});

test('an explicit chart palette wins over the series colors', () => {
  const d = chartDefaults({ chart: { palette: ['#1', '#2'] }, color: { series: ['#a', '#b', '#c', '#d', '#e', '#f'] } });
  assert.deepEqual(d.colors, ['#1', '#2']);
});
