// Shared fixtures for the design-system tests.

export const DECK = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Quarterly review</title>
  <meta name="dek-transition" content="rise">
  <style>
    :root { --bg: #101014; --ink: #f4f2ee; --accent: #e0b356; --gap: 40px; --dek-c1: #4488ff; }
    section { font-family: "Playfair Display", Georgia, serif; }
  </style>
</head>
<body>

<section id="s-cover" class="dek-center">
  <h1>Quarterly review</h1>
  <aside class="notes">Open with the number.</aside>
</section>

<section id="s-two">
  <h2>Revenue</h2>
</section>

</body>
</html>
`;

export const BARE_DECK = '<!doctype html>\n<html>\n<head>\n<title>Bare</title>\n</head>\n<body>\n<section id="s-a"><h1>A</h1></section>\n</body>\n</html>\n';

/** Inner text of the <style id="…"> block, or null. */
export function styleBlock(raw, id) {
  const m = new RegExp(`<style[^>]*\\sid=["']${id}["'][^>]*>([\\s\\S]*?)</style>`, 'i').exec(raw);
  return m ? m[1] : null;
}

/** The content attribute of a <meta name="…">, or null. */
export function metaContent(raw, name) {
  const m = new RegExp(`<meta[^>]*\\sname=["']${name}["'][^>]*\\scontent=["']([^"']*)["']`, 'i').exec(raw);
  return m ? m[1] : null;
}

/** Every declaration inside the first :root block of a CSS string. */
export function rootDecls(css) {
  const block = /:root[^{]*\{([^}]*)\}/.exec(css);
  const out = {};
  if (!block) return out;
  for (const m of block[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+)/g)) out[m[1]] = m[2].trim();
  return out;
}
