// PowerPoint export for Google Slides: the writer turns extracted nodes into native,
// Slides-safe objects (no autofit, Google Fonts faces, real line spacing, original image
// bytes), and the summary tells the person what changed before they save.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import JSZip from 'jszip';
import { writePowerPoint, exportSummary } from '../src/pptx.js';
import { resolveFont, fontFamilies } from '../src/fonts.js';

const SIZE = { w: 1920, h: 1080 };

/** A real w×h PNG so the embedded bytes can be compared. */
function png(w, h) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = buf => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const body = Buffer.concat([Buffer.from(type), data]); const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body)); return Buffer.concat([len, body, sum]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const text = (over = {}) => ({
  type: 'text', x: 100, y: 100, w: 800, h: 60, align: 'left', valign: 'top', fontSize: 40, lineHeight: 48, margin: [10, 20, 30, 40], rotate: 0, opacity: 1, singleLine: true,
  runs: [{ text: 'Revenue grew', options: { fontStack: 'system-ui, sans-serif', weight: 500, fontSize: 40, color: '112233', charSpacing: 0 } }],
  ...over,
});

async function slideXml(nodes, background = { color: 'ffffff', transparency: 0 }, lang) {
  const b64 = await writePowerPoint({ title: 'T', size: SIZE, lang, slides: [{ nodes, background, notes: '' }] });
  const zip = await JSZip.loadAsync(Buffer.from(b64, 'base64'));
  return { zip, xml: await zip.file('ppt/slides/slide1.xml').async('string') };
}

test('font stacks resolve to faces Google Slides can render, reporting replacements', () => {
  assert.deepEqual(resolveFont('"Plus Jakarta Sans", system-ui, sans-serif'), { face: 'Plus Jakarta Sans', replaced: null });
  assert.deepEqual(resolveFont('system-ui, -apple-system, sans-serif'), { face: 'Inter', replaced: 'system-ui' });
  assert.deepEqual(resolveFont('"Brand Sans", Helvetica, Arial'), { face: 'Arial', replaced: 'Brand Sans' });
  assert.deepEqual(resolveFont('Georgia, serif'), { face: 'Georgia', replaced: null });
  assert.deepEqual(resolveFont('ui-monospace, Menlo'), { face: 'Roboto Mono', replaced: 'ui-monospace' });
  assert.deepEqual(resolveFont('"No Such Font"'), { face: 'Inter', replaced: 'No Such Font' });
  assert.deepEqual(resolveFont('playfair display'), { face: 'Playfair Display', replaced: null });
  assert.deepEqual(fontFamilies('"A, B", C'), ['A, B', 'C']);
});

test('text boxes carry no autofit, real line spacing, Slides faces and CSS padding in the right sides', async () => {
  const { xml } = await slideXml([text()]);
  assert.ok(!xml.includes('normAutofit'), 'no shrink-on-overflow');
  assert.match(xml, /typeface="Inter"/);
  assert.ok(!/ b="1"/.test(xml), 'weight 500 is not bold');
  assert.match(xml, /wrap="none"/, 'single-line boxes do not wrap');
  const pt = 13.333333 / 1920 * 72;
  assert.match(xml, new RegExp(`<a:spcPts val="${Math.round(48 * pt * 100)}"/>`));
  // CSS padding is [top, right, bottom, left] = [10, 20, 30, 40]; insets are EMU (12700 per pt).
  const ins = side => +xml.match(new RegExp(`${side}Ins="(\\d+)"`))[1];
  assert.equal(Math.round(ins('l') / 12700 / pt), 40);
  assert.equal(Math.round(ins('r') / 12700 / pt), 20);
  assert.equal(Math.round(ins('t') / 12700 / pt), 10);
  assert.equal(Math.round(ins('b') / 12700 / pt), 30);
});

test('runs carry the deck language so Slides spell-checks in it', async () => {
  const { xml } = await slideXml([text()], undefined, 'es');
  assert.match(xml, /<a:rPr lang="es"/);
});

test('bold only from weight 600 and wrapped boxes get width slack within the slide', async () => {
  const bold = text({ singleLine: false, runs: [{ text: 'Heavy', options: { fontStack: 'Inter', weight: 700, fontSize: 40, color: '000000' } }] });
  const { xml } = await slideXml([bold]);
  assert.match(xml, / b="1"/);
  assert.match(xml, /wrap="square"/);
  const cx = +xml.match(/<p:sp>.*?<a:ext cx="(\d+)"/s)[1];
  const emuPerPx = 13.333333 / 1920 * 914400;
  assert.ok(cx > 800 * emuPerPx && cx <= 800 * 1.04 * emuPerPx + 2, `width ${cx / emuPerPx}px`);
  const edge = text({ x: 1900, w: 20, singleLine: false });
  const r = await slideXml([edge]);
  const [, x, , w] = r.xml.match(/<p:sp>.*?<a:off x="(\d+)" y="(\d+)"\/>\s*<a:ext cx="(\d+)"/s).map(Number);
  assert.ok((x + w) / emuPerPx <= 1920.5, 'slack never pushes past the right edge');
});

test('rounded shapes get a radius in range, shadows stay native, missing borders mean no line', async () => {
  const { xml } = await slideXml([{ type: 'shape', shape: 'rounded', x: 0, y: 0, w: 400, h: 200, fill: { color: 'ff0000', transparency: 0 }, line: null, radius: 24, rotate: 0, opacity: 1, shadow: { x: 0, y: 4, blur: 12, color: '000000', opacity: .2 } }]);
  const adj = +xml.match(/name="adj" fmla="val (\d+)"/)[1];
  assert.equal(adj, Math.round(24 / 200 * 100000));
  assert.match(xml, /<a:outerShdw[^>]*dir="5400000"/, 'shadow pointing down');
  assert.match(xml, /<a:ln><\/a:ln>|<a:ln><a:noFill\/><\/a:ln>/, 'no outline');
});

test('images keep their original bytes and reproduce object-fit cover with a crop', async () => {
  const bytes = png(400, 200);
  const data = 'data:image/png;base64,' + bytes.toString('base64');
  const { zip, xml } = await slideXml([{ type: 'image', x: 0, y: 0, w: 300, h: 300, rotate: 0, opacity: 1, data, natural: { w: 400, h: 200 }, fit: 'cover', position: '50% 50%' }]);
  const media = Object.keys(zip.files).filter(f => f.startsWith('ppt/media/') && !zip.files[f].dir);
  assert.equal(media.length, 1);
  assert.ok(Buffer.from(await zip.file(media[0]).async('uint8array')).equals(bytes), 'byte-identical asset');
  const src = xml.match(/<a:srcRect l="(-?\d+)" r="(-?\d+)" t="(-?\d+)" b="(-?\d+)"/).slice(1).map(Number);
  assert.equal(src[0], 25000); assert.equal(src[1], 25000); assert.equal(src[2], 0); assert.equal(src[3], 0);
});

test('object-fit contain letterboxes inside the element box', async () => {
  const data = 'data:image/png;base64,' + png(400, 200).toString('base64');
  const { xml } = await slideXml([{ type: 'image', x: 0, y: 0, w: 300, h: 300, rotate: 0, opacity: 1, data, natural: { w: 400, h: 200 }, fit: 'contain', position: '50% 50%' }]);
  const emuPerPx = 13.333333 / 1920 * 914400;
  const pic = xml.slice(xml.indexOf('<p:pic>'));
  const [x, y] = pic.match(/<a:off x="(\d+)" y="(\d+)"/).slice(1).map(Number);
  const [cx, cy] = pic.match(/<a:ext cx="(\d+)" cy="(\d+)"/).slice(1).map(Number);
  assert.equal(Math.round(cx / emuPerPx), 300); assert.equal(Math.round(cy / emuPerPx), 150);
  assert.equal(Math.round(x / emuPerPx), 0); assert.equal(Math.round(y / emuPerPx), 75);
});

test('list items become paragraphs that each keep a bullet, indented by the list padding', async () => {
  const list = text({ singleLine: false, margin: [0, 0, 0, 40], bullet: {}, runs: [
    { text: 'One', options: { fontStack: 'Inter', weight: 400, fontSize: 30, color: '000000' } },
    { text: '\n', options: { paragraph: true } },
    { text: 'Two', options: { fontStack: 'Inter', weight: 400, fontSize: 30, color: '000000' } },
  ] });
  const { xml } = await slideXml([list]);
  assert.equal((xml.match(/<a:p>/g) || []).length, 2, 'two paragraphs');
  assert.equal((xml.match(/<a:buChar/g) || []).length, 2, 'both bulleted');
  assert.match(xml, /lIns="0"/, 'the list padding moves into the bullet indent');
});

test('balanced headings keep the browser line breaks as soft breaks', async () => {
  const h = text({ singleLine: false, runs: [
    { text: 'Tres formas de gastar en', options: { fontStack: 'Inter', weight: 650, fontSize: 52, color: '000000' } },
    { text: '\n', options: {} },
    { text: 'IA sin capturar el valor', options: { fontStack: 'Inter', weight: 650, fontSize: 52, color: '000000' } },
  ] });
  const { xml } = await slideXml([h]);
  assert.equal((xml.match(/<a:p>/g) || []).length, 1);
  assert.match(xml, /<a:br/);
  assert.ok(!/<\/a:r><a:pPr/.test(xml) && !xml.includes('<a:t>\r\n'), 'one paragraph property block per paragraph, no literal newlines');
});

test('slide background and notes survive; transparent backgrounds fall back to white', async () => {
  const b64 = await writePowerPoint({ title: 'T', size: SIZE, slides: [{ nodes: [], background: { color: '101014', transparency: 0 }, notes: 'Open with the number.' }, { nodes: [], background: { color: '000000', transparency: 100 }, notes: '' }] });
  const zip = await JSZip.loadAsync(Buffer.from(b64, 'base64'));
  assert.match(await zip.file('ppt/slides/slide1.xml').async('string'), /<a:srgbClr val="101014"/);
  assert.match(await zip.file('ppt/slides/slide2.xml').async('string'), /<a:srgbClr val="FFFFFF"/i);
  const notes = Object.keys(zip.files).filter(f => /notesSlide\d+\.xml$/.test(f));
  assert.ok((await Promise.all(notes.map(f => zip.file(f).async('string')))).some(x => x.includes('Open with the number.')));
});

test('summary counts simplifications and names replaced fonts once', () => {
  const s = exportSummary({
    slides: [{ nodes: [text(), text()] }, { nodes: [text({ runs: [{ text: 'x', options: { fontStack: '"Plus Jakarta Sans", sans-serif' } }] })] }],
    warnings: [{ slide: 1, kind: 'raster', detail: 'svg' }, { slide: 2, kind: 'raster', detail: 'svg' }, { slide: 2, kind: 'gradient-flattened', detail: 'section' }],
  });
  assert.equal(s.slides, 2);
  assert.deepEqual(s.fonts, [{ from: 'system-ui', to: 'Inter' }]);
  assert.deepEqual(s.lines, ['2 slides', '2 visuals as images', '1 gradient flattened to a solid color', 'Fonts: system-ui → Inter']);
});

test('the image-only PowerPoint mode is gone from the UI and the agent tool', async () => {
  const fs = await import('node:fs');
  const main = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const mcp = fs.readFileSync(new URL('../../mcp/dek-mcp.js', import.meta.url), 'utf8');
  assert.ok(!main.includes('pptx-image') && !main.includes('preserve appearance'));
  assert.ok(!/mode:\{type:'string',enum:\['editable','image'\]\}/.test(mcp));
});
