// Write probe.pptx: one labeled slide per PowerPoint feature the export relies on, to check
// by hand how Google Slides' Drive import treats each one. Upload the file to Drive, open it
// with Google Slides, and record the result per slide in docs/export-google-slides.md.
// Run: node scripts/probe-pptx.mjs [out.pptx]
import fs from 'node:fs';
import zlib from 'node:zlib';
import pptxgen from 'pptxgenjs';

const out = process.argv[2] || 'probe.pptx';
const pptx = new pptxgen();
pptx.defineLayout({ name: 'DEK', width: 13.333333, height: 7.5 }); pptx.layout = 'DEK'; pptx.title = 'Dek → Google Slides probe'; pptx.lang = 'es';
const FACE = 'Plus Jakarta Sans';
const label = (slide, n, title, expect) => {
  slide.addText(`${n}. ${title}`, { x: .5, y: .3, w: 12.3, h: .6, fontFace: 'Arial', fontSize: 26, bold: true, color: '1B1D24' });
  slide.addText(`Expected: ${expect}`, { x: .5, y: .9, w: 12.3, h: .4, fontFace: 'Arial', fontSize: 14, color: '6B6F7A' });
};

function photo(w, h) {
  const crc = (() => { const t = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; }); return b => { let c = 0xffffffff; for (const x of b) c = t[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }; })();
  const chunk = (type, data) => { const l = Buffer.alloc(4); l.writeUInt32BE(data.length); const body = Buffer.concat([Buffer.from(type), data]); const s = Buffer.alloc(4); s.writeUInt32BE(crc(body)); return Buffer.concat([l, body, s]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * (w * 3 + 1) + 1 + x * 3; const q = (x < w / 2) === (y < h / 2); raw[i] = q ? 224 : 58; raw[i + 1] = q ? 179 : 79; raw[i + 2] = q ? 86 : 122; }
  return 'data:image/png;base64,' + Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]).toString('base64');
}

let s = pptx.addSlide(); label(s, 1, 'Font weights by typeface name', 'each line in its own weight; if all look Regular/Bold, weights need the bold threshold');
['Thin', 'Light', 'Regular', 'Medium', 'SemiBold', 'Bold', 'ExtraBold'].forEach((w, i) => s.addText(`${FACE} ${w} — typeface "${w === 'Regular' ? FACE : FACE + ' ' + w}"`, { x: .5, y: 1.5 + i * .7, w: 12, h: .6, fontFace: w === 'Regular' ? FACE : `${FACE} ${w}`, fontSize: 24, color: '1B1D24', fit: 'none' }));

s = pptx.addSlide(); label(s, 2, 'Line spacing: points vs multiple', 'left column (exact points) matches right column (multiple) line for line');
const para = 'Diez empresas pampeanas mapearon cómo trabajan y lo pusieron a correr en pocas semanas.';
[[1, 24], [1.2, 28.8], [1.5, 36]].forEach(([m, pts], i) => {
  s.addText(para, { x: .5, y: 1.5 + i * 1.9, w: 5.8, h: 1.7, fontFace: FACE, fontSize: 24, lineSpacing: pts, valign: 'top', fit: 'none', fill: { color: 'F4F2EE' } });
  s.addText(para, { x: 6.9, y: 1.5 + i * 1.9, w: 5.8, h: 1.7, fontFace: FACE, fontSize: 24, lineSpacingMultiple: m, valign: 'top', fit: 'none', fill: { color: 'E7ECF7' } });
});

s = pptx.addSlide(); label(s, 3, 'Letter spacing', 'three visibly different trackings: −1pt, 0, +4pt');
[-1, 0, 4].forEach((cs, i) => s.addText(`Tracking ${cs}pt — La IA ya entró a la PyME`, { x: .5, y: 1.6 + i * 1.2, w: 12, h: 1, fontFace: FACE, fontSize: 40, bold: true, charSpacing: cs || undefined }));

s = pptx.addSlide(); label(s, 4, 'Shape shadow and rounded corners', 'white cards with a soft shadow below; radius small → pill');
[[.1, .5], [.3, 3.5], [.6, 6.5], [1.2, 9.5]].forEach(([r, x]) => s.addShape('roundRect', { x, y: 2, w: 2.6, h: 2.4, rectRadius: r, fill: { color: 'FFFFFF' }, line: { type: 'none' }, shadow: { type: 'outer', blur: 18, offset: 6, angle: 90, color: '141828', opacity: .18 } }));
s.background = { color: 'F4F2EE' };

s = pptx.addSlide(); label(s, 5, 'Image crop (object-fit: cover)', 'left: whole 4-square image stretched; right: cropped to the centered square, no distortion');
const img = photo(800, 400);
s.addImage({ data: img, x: .5, y: 1.6, w: 5.6, h: 5.6 });
s.addImage({ data: img, x: 7, y: 1.6, w: 11.2, h: 5.6, sizing: { type: 'crop', x: 2.8, y: 0, w: 5.6, h: 5.6 } });

s = pptx.addSlide(); label(s, 6, 'Wrapping and width slack', 'the same sentence: boxes with +3% / +8% slack break at the same word as the browser (after "empresa")');
['+0%', '+3%', '+8%'].forEach((k, i) => s.addText('Tres etapas. Cada una deja algo que la empresa se queda.', { x: .5, y: 1.6 + i * 1.8, w: 9.6 * (1 + [0, .03, .08][i]), h: 1.6, fontFace: FACE, fontSize: 44, bold: true, fit: 'none', valign: 'top', fill: { color: 'F4F2EE' } }));
s.addText('wrap:false → one line, never wraps', { x: .5, y: 6.8, w: 3, h: .5, fontFace: FACE, fontSize: 20, wrap: false });

s = pptx.addSlide(); label(s, 7, 'Transparency', 'a 50% transparent gold square over the text; the grey text is 50% transparent');
s.addText('Texto debajo del cuadrado', { x: .5, y: 2.5, w: 8, h: 1, fontFace: FACE, fontSize: 40, bold: true });
s.addShape('rect', { x: 2, y: 2, w: 4, h: 2, fill: { color: 'E0B356', transparency: 50 }, line: { type: 'none' } });
s.addText('Texto al 50%', { x: .5, y: 5, w: 8, h: 1, fontFace: FACE, fontSize: 40, color: '1B1D24', transparency: 50 });

s = pptx.addSlide(); label(s, 8, 'No autofit vs shrink', 'left keeps 32pt and overflows its box; right may shrink (the export always uses the left behavior)');
const long = 'Un texto largo que no entra en su caja para ver si Slides respeta el tamaño o lo achica automáticamente al importar.';
s.addText(long, { x: .5, y: 1.6, w: 5.8, h: 1.4, fontFace: FACE, fontSize: 32, fit: 'none', valign: 'top', fill: { color: 'F4F2EE' } });
s.addText(long, { x: 6.9, y: 1.6, w: 5.8, h: 1.4, fontFace: FACE, fontSize: 32, fit: 'shrink', valign: 'top', fill: { color: 'E7ECF7' } });

s = pptx.addSlide(); label(s, 9, 'Highlighted words, soft breaks, bullets', '"Y lo pusieron a correr." has a yellow highlight; the heading breaks after "pampeanas"; three bulleted items');
s.addText([
  { text: 'Diez empresas pampeanas', options: { fontFace: FACE, fontSize: 40, bold: true, color: '1B1D24' } },
  { text: 'mapearon cómo trabajan. ', options: { fontFace: FACE, fontSize: 40, bold: true, color: '1B1D24', softBreakBefore: true } },
  { text: 'Y lo pusieron a correr.', options: { fontFace: FACE, fontSize: 40, bold: true, color: '1B1D24', highlight: 'FAD728' } },
], { x: .5, y: 1.6, w: 12, h: 1.8, valign: 'top', fit: 'none' });
s.addText(['Conciliación bancaria', 'Planillas de producción', 'Inventario y conteo de stock'].map((t, i, a) => ({ text: t, options: { fontFace: FACE, fontSize: 28, bullet: { indent: 20 }, breakLine: i < a.length - 1 } })), { x: .5, y: 4, w: 12, h: 2.4, valign: 'top', fit: 'none' });

await pptx.writeFile({ fileName: out });
fs.statSync(out); console.log(`wrote ${out}`);
