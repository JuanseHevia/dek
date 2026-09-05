// The composition: the guidelines page a system generates for itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeDocument, sampleVars, DOC_WIDTH } from '../src/theme-doc.js';
import { createTheme, updateTheme, findTheme, captureSystem, compileSystemCss, currentSystem } from '../src/theme.js';
import { structure, componentRanges } from '../src/deck.js';
import { DECK, styleBlock } from './helpers.js';

const build = () => createTheme(null, {
  name: 'Cobalt',
  description: 'For pitches',
  system: {
    meta: { mode: 'light', mood: 'editorial', notes: 'Use it for client work.' },
    color: { bg: '#F7F6F3', ink: '#1A1916', accent: '#2D5BE3', series: ['#2D5BE3', '#FAD728', '#1E3FA8', '#B8B2A8', '#8FA8F0', '#D9432F'] },
    typography: { fonts: { display: { family: 'Plus Jakarta Sans', fallback: 'system-ui', url: 'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans' } }, scale: { h1: '2.5rem' } },
    motion: { transition: 'fade', transitionMs: 400, ease: 'cubic-bezier(.16, 1, .3, 1)' },
    chart: { values: true, grid: false },
    components: { eyebrow: { description: 'Accent bar + label', html: '<p class="ey">{{label}}</p>' } },
  },
}, 1000).theme;

test('the composition is one self-contained document', () => {
  const html = composeDocument(build());
  assert.match(html, /^<!doctype html>/i);
  assert.match(html, /<\/html>\s*$/);
  assert.doesNotMatch(html, /<script/i, 'no scripts: it is a page, not an app');
  assert.doesNotMatch(html, /<link[^>]+stylesheet/i, 'no external stylesheets to go missing');
  assert.doesNotMatch(html, /<img/i, 'nothing to fetch');
});

test('it is written in the system it documents', () => {
  const theme = build();
  const html = composeDocument(theme);
  const compiled = compileSystemCss(currentSystem(theme));
  assert.ok(html.includes(compiled), 'the system’s own compiled CSS is inlined');
  assert.match(html, /<body class="dek-root">/, 'so the .dek-root-scoped rules apply to the page itself');
});

test('every token group reaches the page', () => {
  const html = composeDocument(build());
  for (const heading of ['Color', 'Typography', 'Space', 'Motion', 'Charts', 'Components', 'Tokens']) {
    assert.match(html, new RegExp(`class="sec-t">${heading}<`), `${heading} section is missing`);
  }
});

test('the palette is shown as real values, not names', () => {
  const html = composeDocument(build());
  assert.match(html, /background: #F7F6F3/);
  assert.match(html, /background: #2D5BE3/);
  assert.match(html, /<code>#FAD728<\/code>/);
});

test('type specimens are rendered at the system’s own sizes', () => {
  const html = composeDocument(build());
  assert.match(html, /--text-h1 · 2\.5rem/);
  assert.match(html, /font-size: var\(--text-display\)/);
  assert.match(html, /font-size: var\(--text-caption\)/);
});

test('motion shows the easing curve as a shape, not just a string', () => {
  const html = composeDocument(build());
  assert.match(html, /class="curve"/);
  assert.match(html, /class="curve-line"/);
  assert.match(html, /cubic-bezier\(\.16, 1, \.3, 1\)/);
});

test('a keyword easing degrades to no curve rather than a broken one', () => {
  const theme = createTheme(null, { name: 'Keyword', system: { motion: { ease: 'ease-in-out' } } }).theme;
  const html = composeDocument(theme);
  assert.doesNotMatch(html, /class="curve-line"/, 'no curve is drawn for a keyword');
  assert.match(html, /ease-in-out/, 'but the value is still reported');
});

test('chart preferences and the series palette are both shown', () => {
  const html = composeDocument(build());
  assert.match(html, /dek-c1/);
  assert.match(html, /dek-c6/);
  assert.match(html, /grid off at/);
  assert.match(html, /Values on marks[\s\S]{0,120}>on</);
  assert.match(html, /class="chart-spec"/);
});

test('components are rendered live, with their source beside them', () => {
  const html = composeDocument(build());
  assert.match(html, /<b>eyebrow<\/b>/);
  assert.match(html, /Accent bar \+ label/);
  assert.match(html, /<p class="ey">Section label<\/p>/, 'filled with a sample');
  assert.match(html, /&lt;p class=&quot;ey&quot;&gt;\{\{label\}\}&lt;\/p&gt;/, 'and escaped as source');
});

test('a system with no components leaves the section out rather than showing an empty one', () => {
  const bare = createTheme(null, { name: 'Bare', system: { components: {} } }).theme;
  assert.doesNotMatch(composeDocument(bare), /class="sec-t">Components</);
  assert.match(composeDocument(bare), /class="sec-t">Tokens</);
});

test('the token table lists the custom properties the system publishes', () => {
  const html = composeDocument(build());
  for (const token of ['--font-display', '--text-h1', '--bg', '--accent', '--gap', '--dek-transition-ms', '--dek-c1']) {
    assert.ok(html.includes(`>${token}<`), `${token} missing from the token table`);
  }
});

test('the name, description and version identify the page', () => {
  const theme = build();
  const html = composeDocument(theme);
  assert.match(html, /<title>Cobalt — design system<\/title>/);
  assert.match(html, /class="doc-title">Cobalt</);
  assert.match(html, /For pitches/);
  assert.match(html, /Design system · version 1/);
  assert.match(html, /Use it for client work\./);
});

test('a later version says so', () => {
  const { library } = createTheme(null, { name: 'Cobalt' });
  const { theme } = updateTheme(library, 'cobalt', { system: { color: { accent: 'red' } }, note: 'redder' });
  assert.match(composeDocument(theme), /Design system · version 2/);
});

test('content is escaped, so a system cannot inject markup into its own page', () => {
  const theme = createTheme(null, {
    name: '</title><script>alert(1)</script>',
    description: '<img src=x onerror=alert(1)>',
    system: { meta: { mood: '</style><b>x' } },
  }).theme;
  const html = composeDocument(theme);
  assert.doesNotMatch(html, /<script>alert/);
  assert.doesNotMatch(html, /<img src=x/);
  assert.doesNotMatch(html, /<b>x/);
});

test('it composes from a bare system too, not only a stored theme', () => {
  const html = composeDocument({ name: 'Ad hoc', system: captureSystem(DECK) });
  assert.match(html, /class="doc-title">Ad hoc</);
  assert.match(html, /#101014/, 'the captured background');
});

test('the page is authored at a fixed width the shell can scale', () => {
  assert.equal(typeof DOC_WIDTH, 'number');
  assert.match(composeDocument(build()), new RegExp(`width: ${DOC_WIDTH}px`));
  assert.match(composeDocument(build()), new RegExp(`content="width=${DOC_WIDTH}"`));
});

test('sampleVars fills known names with real copy and falls back to the name', () => {
  const s = sampleVars(['headline', 'number', 'wobble']);
  assert.match(s.headline, /claim/i);
  assert.match(s.number, /41/);
  assert.equal(s.wobble, 'wobble');
  assert.deepEqual(sampleVars(), {});
});

test('the composition is not a deck: Dek finds no slides or components in it', () => {
  const html = composeDocument(build());
  assert.equal(structure(html).slides.length, 0, 'a top-level <section> would read as a slide');
  assert.equal(componentRanges(html).length, 0, 'the component sources are shown, not defined');
});

test('two calls for an unchanged system produce identical bytes', () => {
  const theme = build();
  assert.equal(composeDocument(theme), composeDocument(theme));
});

test('the deck fixture is untouched by composing from it', () => {
  const before = DECK;
  composeDocument({ name: 'x', system: captureSystem(DECK) });
  assert.equal(DECK, before);
  assert.equal(styleBlock(DECK, 'dek-theme'), null);
});
