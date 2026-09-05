// Applying a system to a deck file, and reading one back out of it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyThemeToRaw, removeThemeFromRaw, readDeckTheme, captureSystem, rootVars,
  upsertComponents, pruneThemeComponents, deckOwnedComponents, createTheme, THEME_STYLE_ID,
} from '../src/theme.js';
import { componentRanges, structure, upsertMeta } from '../src/deck.js';
import { DECK, BARE_DECK, styleBlock, metaContent } from './helpers.js';

const system = {
  meta: { mode: 'light' },
  color: { bg: '#fffdf7', ink: '#151312', accent: '#c2410c' },
  motion: { transition: 'zoom', transitionMs: 620 },
  chart: { grid: false, suffix: '%' },
};

test('applying a system writes one dek-theme style block', () => {
  const out = applyThemeToRaw(DECK, system);
  const css = styleBlock(out, THEME_STYLE_ID);
  assert.ok(css, 'the block exists');
  assert.match(css, /--bg: #fffdf7;/);
  assert.match(css, /--accent: #c2410c;/);
  assert.equal(out.match(/id="dek-theme"/g).length, 1);
});

test('applying twice replaces the block instead of stacking blocks', () => {
  const once = applyThemeToRaw(DECK, system);
  const twice = applyThemeToRaw(once, { color: { bg: '#000' } });
  assert.equal(twice.match(/id="dek-theme"/g).length, 1);
  assert.match(styleBlock(twice, THEME_STYLE_ID), /--bg: #000;/);
  assert.doesNotMatch(styleBlock(twice, THEME_STYLE_ID), /#fffdf7/);
});

test('the deck author’s own style block survives untouched', () => {
  const out = applyThemeToRaw(DECK, system);
  assert.match(out, /--dek-c1: #4488ff/);
  assert.match(out, /Playfair Display/);
  assert.equal(structure(out).slides.length, 2, 'slides are not disturbed');
  assert.match(out, /<aside class="notes">Open with the number\.<\/aside>/);
});

test('motion and graph preferences land in the head as meta the runtime reads', () => {
  const out = applyThemeToRaw(DECK, system);
  assert.equal(metaContent(out, 'dek-transition'), 'zoom');
  const chart = JSON.parse(metaContent(out, 'dek-chart').replace(/&quot;/g, '"'));
  assert.equal(chart.grid, false);
  assert.equal(chart.suffix, '%');
  assert.equal(chart.colors.length, 6);
});

test('the deck’s existing dek-transition meta is replaced, not duplicated', () => {
  const out = applyThemeToRaw(DECK, system);
  assert.equal(out.match(/name="dek-transition"/g).length, 1);
  assert.doesNotMatch(out, /content="rise"/);
});

test('a deck records which system and version dressed it', () => {
  const { theme } = createTheme(null, { name: 'Aurora', system });
  const out = applyThemeToRaw(DECK, theme);
  assert.deepEqual(readDeckTheme(out), { id: 'aurora', version: 1 });
});

test('a deck with no theme meta reads as untouched', () => {
  assert.equal(readDeckTheme(DECK), null);
});

test('a deck with no <style> at all still gets one', () => {
  const out = applyThemeToRaw(BARE_DECK, system);
  assert.ok(styleBlock(out, THEME_STYLE_ID));
  assert.equal(metaContent(out, 'dek-transition'), 'zoom');
  assert.equal(structure(out).slides.length, 1);
});

test('removing a theme takes the block, the metas and the marker back out', () => {
  const { theme } = createTheme(null, { name: 'Aurora', system });
  const dressed = applyThemeToRaw(DECK, theme);
  const bare = removeThemeFromRaw(dressed);
  assert.equal(styleBlock(bare, THEME_STYLE_ID), null);
  assert.equal(readDeckTheme(bare), null);
  assert.equal(metaContent(bare, 'dek-chart'), null);
  assert.match(bare, /--dek-c1: #4488ff/, 'the deck’s own CSS is left alone');
  assert.equal(structure(bare).slides.length, 2);
});

test('theme components are written into the body as templates and marked as the theme’s', () => {
  const out = applyThemeToRaw(DECK, { components: { stat: { description: 'Big number', html: '<div class="stat"><b>{{value}}</b><span>{{label}}</span></div>' } } });
  const comps = componentRanges(out);
  assert.equal(comps.length, 1);
  assert.equal(comps[0].name, 'stat');
  assert.equal(comps[0].description, 'Big number');
  assert.equal(comps[0].themeOwned, true);
  assert.deepEqual(comps[0].vars, ['value', 'label']);
});

test('switching systems removes the components the old one owned', () => {
  const first = applyThemeToRaw(DECK, { components: { stat: { html: '<b>{{v}}</b>' }, quote: { html: '<q>{{q}}</q>' } } });
  assert.equal(componentRanges(first).length, 2);
  const second = applyThemeToRaw(first, { components: { stat: { html: '<i>{{v}}</i>' } } });
  const comps = componentRanges(second);
  assert.deepEqual(comps.map((c) => c.name), ['stat']);
  assert.match(comps[0].html, /<i>\{\{v\}\}<\/i>/);
  assert.equal(structure(second).slides.length, 2);
});

test('components the deck defined itself are never pruned by a theme', () => {
  const withOwn = DECK.replace('<section id="s-cover"', '<template data-dek-component="mine"><p>{{a}}</p></template>\n\n<section id="s-cover"');
  const out = applyThemeToRaw(withOwn, { components: { stat: { html: '<b>{{v}}</b>' } } });
  assert.deepEqual(componentRanges(out).map((c) => c.name).sort(), ['mine', 'stat']);
  const cleared = applyThemeToRaw(out, { components: {} });
  assert.deepEqual(componentRanges(cleared).map((c) => c.name), ['mine']);
  assert.deepEqual(Object.keys(deckOwnedComponents(cleared)), ['mine']);
});

test('upsertComponents replaces a definition in place and keeps its neighbours', () => {
  const one = upsertComponents(BARE_DECK, { a: { html: '<p>one</p>' }, b: { html: '<p>two</p>' } });
  const two = upsertComponents(one, { a: { html: '<p>ONE</p>' } });
  const comps = componentRanges(two);
  assert.equal(comps.length, 2);
  assert.match(comps.find((c) => c.name === 'a').html, /ONE/);
  assert.match(comps.find((c) => c.name === 'b').html, /two/);
});

test('pruneThemeComponents with no survivors clears every theme-owned template', () => {
  const dressed = upsertComponents(BARE_DECK, { a: { html: '<p>a</p>' }, b: { html: '<p>b</p>' } });
  assert.equal(componentRanges(pruneThemeComponents(dressed, null)).length, 0);
});

test('upsertMeta adds, replaces and removes a single meta tag', () => {
  const model = (raw) => ({ raw, structure: structure(raw) });
  const added = upsertMeta(model(BARE_DECK), 'dek-autoslide', '8000');
  assert.equal(metaContent(added, 'dek-autoslide'), '8000');
  const changed = upsertMeta(model(added), 'dek-autoslide', '4000');
  assert.equal(changed.match(/name="dek-autoslide"/g).length, 1);
  assert.equal(metaContent(changed, 'dek-autoslide'), '4000');
  const removed = upsertMeta(model(changed), 'dek-autoslide', null);
  assert.equal(metaContent(removed, 'dek-autoslide'), null);
  assert.match(removed, /<title>Bare<\/title>/);
});

test('rootVars collects the custom properties a deck declares', () => {
  const vars = rootVars(DECK);
  assert.equal(vars['--bg'], '#101014');
  assert.equal(vars['--accent'], '#e0b356');
  assert.equal(vars['--dek-c1'], '#4488ff');
});

test('captureSystem bootstraps a system from a hand-styled deck', () => {
  const s = captureSystem(DECK);
  assert.equal(s.color.bg, '#101014');
  assert.equal(s.color.ink, '#f4f2ee');
  assert.equal(s.color.accent, '#e0b356');
  assert.equal(s.space.gap, '40px');
  assert.equal(s.color.series[0], '#4488ff');
  assert.equal(s.typography.fonts.display.family, 'Playfair Display');
  assert.equal(s.typography.fonts.display.fallback, 'Georgia, serif');
  assert.equal(s.motion.transition, 'rise');
});

test('captured tokens round-trip: capture, apply, capture again', () => {
  const first = captureSystem(DECK);
  const applied = applyThemeToRaw(BARE_DECK, first);
  const second = captureSystem(applied);
  assert.equal(second.color.bg, first.color.bg);
  assert.equal(second.color.accent, first.color.accent);
  assert.equal(second.space.gap, first.space.gap);
});

test('capturing a deck with no design at all still yields a usable system', () => {
  const s = captureSystem('<html><head></head><body><section><h1>Hi</h1></section></body></html>');
  assert.ok(s.color.bg);
  assert.equal(s.color.series.length, 6);
  assert.ok(compilesCleanly(s));
});

function compilesCleanly(s) {
  const out = applyThemeToRaw(BARE_DECK, s);
  return !!styleBlock(out, THEME_STYLE_ID);
}
