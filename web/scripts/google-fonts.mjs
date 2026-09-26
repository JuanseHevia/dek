// Regenerate src/google-fonts.json: every Google Fonts family, the upright weights
// it ships and its natural line height, as { "Family": "4567|1.26" } (digits are
// hundreds). Google
// Slides renders any of these by name, so the PowerPoint export maps each
// deck font onto this list. Run: node scripts/google-fonts.mjs
import fs from 'node:fs';

const res = await fetch('https://fonts.google.com/metadata/fonts');
if (!res.ok) throw new Error(`metadata request failed: ${res.status}`);
const meta = JSON.parse((await res.text()).replace(/^\)\]\}'\n?/, ''));
const out = {};
for (const f of meta.familyMetadataList.sort((a, b) => a.family.localeCompare(b.family))) {
  const weights = Object.keys(f.fonts).filter(k => /^\d+$/.test(k));
  const lh = f.fonts['400']?.lineHeight ?? f.fonts[weights[0]]?.lineHeight;
  out[f.family] = weights.map(k => k[0]).sort().join('') + (lh ? '|' + lh : '');
}
fs.writeFileSync(new URL('../src/google-fonts.json', import.meta.url), JSON.stringify(out) + '\n');
console.log(`${Object.keys(out).length} families`);
