// The library: five slots, append-only version history, and what survives a round trip through disk.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_THEMES, MAX_VERSIONS, emptyLibrary, normalizeLibrary, createTheme, updateTheme, deleteTheme,
  duplicateTheme, revertTheme, findTheme, currentSystem, currentVersion, themeSummary, slugify,
} from '../src/theme.js';

const fill = (n) => {
  let lib = emptyLibrary();
  for (let i = 0; i < n; i++) lib = createTheme(lib, { name: `System ${i + 1}` }).library;
  return lib;
};

test('a new theme gets a slug id, version 1 and one history entry', () => {
  const { library, theme } = createTheme(null, { name: 'Nocturne Editorial', description: 'For evening decks' }, 1000);
  assert.equal(theme.id, 'nocturne-editorial');
  assert.equal(theme.name, 'Nocturne Editorial');
  assert.equal(theme.description, 'For evening decks');
  assert.equal(currentVersion(theme), 1);
  assert.equal(theme.versions.length, 1);
  assert.equal(theme.versions[0].note, 'created');
  assert.equal(theme.createdAt, 1000);
  assert.equal(library.themes.length, 1);
});

test('ids stay unique when two systems are given the same name', () => {
  let lib = createTheme(null, { name: 'Aurora' }).library;
  lib = createTheme(lib, { name: 'Aurora' }).library;
  assert.deepEqual(lib.themes.map((t) => t.id), ['aurora', 'aurora-2']);
});

test('slugify copes with punctuation, spacing and emptiness', () => {
  assert.equal(slugify('  Deep — Space  '), 'deep-space');
  assert.equal(slugify('Café Noir!'), 'cafe-noir');
  assert.equal(slugify('***'), 'system');
});

test('the library holds five systems and refuses a sixth', () => {
  const lib = fill(MAX_THEMES);
  assert.equal(lib.themes.length, MAX_THEMES);
  assert.throws(() => createTheme(lib, { name: 'One too many' }), /5 design systems/);
});

test('deleting frees a slot', () => {
  const full = fill(MAX_THEMES);
  const { library } = deleteTheme(full, full.themes[2].id);
  assert.equal(library.themes.length, MAX_THEMES - 1);
  assert.equal(findTheme(library, full.themes[2].id), null);
  assert.equal(createTheme(library, { name: 'Room again' }).library.themes.length, MAX_THEMES);
});

test('deleting or updating an unknown system is an error, not a silent no-op', () => {
  assert.throws(() => deleteTheme(emptyLibrary(), 'nope'), /No design system/);
  assert.throws(() => updateTheme(emptyLibrary(), 'nope', { system: {} }), /No design system/);
  assert.throws(() => revertTheme(emptyLibrary(), 'nope', 1), /No design system/);
});

test('a name is required', () => {
  assert.throws(() => createTheme(null, { name: '  ' }), /name is required/);
});

test('updating tokens appends a version and merges into the current one', () => {
  const { library } = createTheme(null, { name: 'Aurora', system: { color: { bg: '#000', accent: 'gold' } } }, 1000);
  const after = updateTheme(library, 'aurora', { system: { color: { accent: 'teal' } }, note: 'cooler accent' }, 2000);
  const theme = after.theme;
  assert.equal(currentVersion(theme), 2);
  assert.equal(theme.versions.length, 2);
  assert.equal(currentSystem(theme).color.accent, 'teal');
  assert.equal(currentSystem(theme).color.bg, '#000', 'untouched tokens carry over');
  assert.equal(theme.versions[0].system.color.accent, 'gold', 'v1 still remembers what it was');
  assert.equal(theme.versions[1].note, 'cooler accent');
  assert.equal(theme.updatedAt, 2000);
});

test('replace:true swaps the system wholesale instead of merging', () => {
  const { library } = createTheme(null, { name: 'Aurora', system: { color: { accent: 'gold', bg: '#123456' } } });
  const { theme } = updateTheme(library, 'aurora', { system: { color: { accent: 'teal' } }, replace: true });
  assert.equal(currentSystem(theme).color.accent, 'teal');
  assert.notEqual(currentSystem(theme).color.bg, '#123456');
});

test('renaming does not spend a version', () => {
  const { library } = createTheme(null, { name: 'Aurora' });
  const { theme } = updateTheme(library, 'aurora', { name: 'Aurora Deep', description: 'now with more night' });
  assert.equal(theme.name, 'Aurora Deep');
  assert.equal(theme.description, 'now with more night');
  assert.equal(theme.id, 'aurora', 'the id is stable so decks keep pointing at it');
  assert.equal(currentVersion(theme), 1);
});

test('reverting moves an old version forward rather than erasing history', () => {
  let lib = createTheme(null, { name: 'Aurora', system: { color: { accent: 'gold' } } }).library;
  lib = updateTheme(lib, 'aurora', { system: { color: { accent: 'teal' } } }).library;
  lib = updateTheme(lib, 'aurora', { system: { color: { accent: 'red' } } }).library;
  const { theme } = revertTheme(lib, 'aurora', 1);
  assert.equal(currentVersion(theme), 4);
  assert.equal(currentSystem(theme).color.accent, 'gold');
  assert.deepEqual(theme.versions.map((v) => v.v), [1, 2, 3, 4]);
  assert.match(theme.versions[3].note, /reverted to v1/);
});

test('reverting to the version already in force changes nothing', () => {
  const { library } = createTheme(null, { name: 'Aurora' });
  const { theme } = revertTheme(library, 'aurora', 1);
  assert.equal(theme.versions.length, 1);
});

test('reverting to a version that never existed is an error', () => {
  const { library } = createTheme(null, { name: 'Aurora' });
  assert.throws(() => revertTheme(library, 'aurora', 9), /no version 9/);
});

test('history is capped but version numbers keep climbing', () => {
  let lib = createTheme(null, { name: 'Aurora' }).library;
  for (let i = 0; i < MAX_VERSIONS + 5; i++) lib = updateTheme(lib, 'aurora', { system: { color: { accent: `c${i}` } } }).library;
  const theme = findTheme(lib, 'aurora');
  assert.equal(theme.versions.length, MAX_VERSIONS);
  assert.equal(currentVersion(theme), MAX_VERSIONS + 6);
  assert.equal(currentSystem(theme).color.accent, `c${MAX_VERSIONS + 4}`);
});

test('duplicating copies the current tokens into a fresh system with its own history', () => {
  let lib = createTheme(null, { name: 'Aurora', system: { color: { accent: 'gold' } } }).library;
  lib = updateTheme(lib, 'aurora', { system: { color: { accent: 'teal' } } }).library;
  const { library, theme } = duplicateTheme(lib, 'aurora', 'Aurora Light');
  assert.equal(theme.id, 'aurora-light');
  assert.equal(currentVersion(theme), 1);
  assert.equal(currentSystem(theme).color.accent, 'teal');
  assert.match(theme.versions[0].note, /copied from Aurora v2/);
  assert.equal(library.themes.length, 2);
  assert.equal(currentSystem(findTheme(library, 'aurora')).color.accent, 'teal', 'the original is untouched');
});

test('duplicating into a full library is refused', () => {
  let lib = fill(MAX_THEMES - 1);
  lib = createTheme(lib, { name: 'Aurora' }).library;
  assert.throws(() => duplicateTheme(lib, 'aurora'), /5 design systems/);
});

test('every library operation returns a new library and leaves the old one alone', () => {
  const before = createTheme(null, { name: 'Aurora', system: { color: { accent: 'gold' } } }).library;
  const snapshot = JSON.stringify(before);
  updateTheme(before, 'aurora', { system: { color: { accent: 'teal' } } });
  deleteTheme(before, 'aurora');
  assert.equal(JSON.stringify(before), snapshot);
});

test('normalizeLibrary survives junk from disk', () => {
  const lib = normalizeLibrary({ themes: [null, { name: 'no id' }, { id: 'ok', name: 'OK' }] });
  assert.equal(lib.themes.length, 1);
  assert.equal(lib.themes[0].id, 'ok');
  assert.equal(lib.themes[0].versions.length, 1, 'a system with no history gets one');
  assert.ok(currentSystem(lib.themes[0]).color.bg, 'and a complete set of tokens');
  assert.deepEqual(normalizeLibrary(null), emptyLibrary());
  assert.deepEqual(normalizeLibrary({ themes: 'nope' }), emptyLibrary());
});

test('normalizeLibrary trims a file that somehow holds more than five systems', () => {
  const many = { themes: Array.from({ length: 9 }, (_, i) => ({ id: `s${i}`, name: `S${i}`, versions: [{ v: 1, system: {} }] })) };
  assert.equal(normalizeLibrary(many).themes.length, MAX_THEMES);
});

test('a library round-trips through JSON without losing history', () => {
  let lib = createTheme(null, { name: 'Aurora', system: { color: { accent: 'gold' } } }, 1000).library;
  lib = updateTheme(lib, 'aurora', { system: { color: { accent: 'teal' } }, note: 'cooler' }, 2000).library;
  const back = normalizeLibrary(JSON.parse(JSON.stringify(lib)));
  const theme = findTheme(back, 'aurora');
  assert.equal(currentVersion(theme), 2);
  assert.equal(theme.versions[0].system.color.accent, 'gold');
  assert.equal(theme.versions[1].note, 'cooler');
  assert.equal(theme.createdAt, 1000);
  assert.equal(theme.updatedAt, 2000);
});

test('themeSummary is enough to draw a row in the nav bar', () => {
  const { theme } = createTheme(null, {
    name: 'Aurora',
    description: 'Night sky',
    system: { meta: { mode: 'dark', mood: 'quiet, wide' }, color: { bg: '#05070f', ink: '#eee', accent: '#7dd3fc' }, motion: { transition: 'rise' } },
  });
  const s = themeSummary(theme);
  assert.equal(s.id, 'aurora');
  assert.equal(s.name, 'Aurora');
  assert.equal(s.description, 'Night sky');
  assert.equal(s.version, 1);
  assert.equal(s.mode, 'dark');
  assert.equal(s.mood, 'quiet, wide');
  assert.equal(s.transition, 'rise');
  assert.equal(s.swatches.length, 6);
  assert.equal(s.swatches[0], '#05070f');
  assert.equal(s.fonts.display, 'Inter');
});
