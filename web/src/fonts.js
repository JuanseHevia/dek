import GOOGLE_FONTS from './google-fonts.json' with { type: 'json' };

// Google Slides renders Google Fonts families and a few system fonts by name; anything else
// is silently replaced. The PowerPoint export picks the first family of each CSS stack that
// Slides can render, maps system and generic families to close Google Fonts, and reports
// the replacement.
const BUILT_IN = ['Arial', 'Arial Black', 'Calibri', 'Cambria', 'Century Gothic', 'Comic Sans MS', 'Consolas', 'Courier New', 'Georgia', 'Impact', 'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana'];
const KNOWN = new Map([...Object.keys(GOOGLE_FONTS), ...BUILT_IN].map(f => [f.toLowerCase(), f]));
const GENERIC = [
  [/^(helvetica|helvetica neue|arial nova)$/, 'Arial'],
  [/^(system-ui|-apple-system|blinkmacsystemfont|ui-sans-serif|sans-serif|sf pro( display| text)?|\.sf ns.*|segoe ui|avenir( next)?)$/, 'Inter'],
  [/^(ui-monospace|monospace|sf mono|menlo|monaco|sfmono-regular)$/, 'Roboto Mono'],
  [/^(ui-serif|serif|new york|times)$/, 'Source Serif 4'],
  [/^(ui-rounded|sf pro rounded)$/, 'Nunito'],
];
const FALLBACK = 'Inter';

export function fontFamilies(stack) {
  return String(stack || '').split(/,(?=(?:[^"']|"[^"]*"|'[^']*')*$)/).map(f => f.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
}

/** @returns {{face: string, replaced: string|null}} replaced names the family the deck asked for. */
export function resolveFont(stack) {
  const families = fontFamilies(stack);
  const wanted = families[0] || null;
  for (const family of families) {
    const known = KNOWN.get(family.toLowerCase());
    if (known) return { face: known, replaced: family === wanted ? null : wanted };
    const generic = GENERIC.find(([re]) => re.test(family.toLowerCase()));
    if (generic) return { face: generic[1], replaced: wanted };
  }
  return { face: FALLBACK, replaced: wanted };
}

export function googleFontWeights(face) {
  const w = GOOGLE_FONTS[face];
  return w ? [...w].map(d => +d * 100) : [];
}
