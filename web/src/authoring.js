// Shared HTML authoring primitives. The manual UI and MCP use the same shapes.
export const SHAPES = ['rectangle', 'rounded', 'ellipse', 'line', 'arrow', 'triangle'];
export const escapeHTML = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function shapeHTML({ shape = 'rectangle', x = 240, y = 260, width = 480, height = 280, fill = '#d9b568', stroke = '#d9b568', strokeWidth = 0 } = {}) {
  if (!SHAPES.includes(shape)) throw new Error(`Unknown shape: ${shape}`);
  const n = (v, min, max) => { v = Number(v); if (!Number.isFinite(v)) throw new Error('Shape dimensions must be numbers'); return Math.min(max, Math.max(min, v)); };
  const style = { position:'absolute', left:n(x,-10000,10000)+'px', top:n(y,-10000,10000)+'px', width:n(width,1,10000)+'px', height:n(height,1,10000)+'px', margin:'0', 'box-sizing':'border-box', background:fill, border:`${n(strokeWidth,0,100)}px solid ${stroke}` };
  if (shape === 'rounded') style['border-radius'] = '32px';
  if (shape === 'ellipse') style['border-radius'] = '50%';
  if (shape === 'line') { style.height = Math.max(2, Number(strokeWidth) || 6) + 'px'; style.border = 'none'; }
  if (shape === 'arrow') style['clip-path'] = 'polygon(0 28%, 65% 28%, 65% 0, 100% 50%, 65% 100%, 65% 72%, 0 72%)';
  if (shape === 'triangle') style['clip-path'] = 'polygon(50% 0, 100% 100%, 0 100%)';
  return `<div class="dek-shape" data-shape="${shape}" aria-label="${shape}" style="${Object.entries(style).map(([k,v]) => `${k}: ${escapeHTML(v)}`).join('; ')};"></div>`;
}
export function layoutHTML(kind = 'title') {
  const layouts = {
    blank: '<section></section>',
    title: '<section class="dek-center"><h1>Your next idea</h1><p>A little context for your audience.</p></section>',
    content: '<section><h2>One clear message</h2><p>Add the detail that makes it matter.</p></section>',
    split: '<section><h2>Two sides of the story</h2><div style="display:grid;grid-template-columns:1fr 1fr;gap:64px"><div><h3>First idea</h3><p>Supporting detail.</p></div><div><h3>Second idea</h3><p>Supporting detail.</p></div></div></section>',
    quote: '<section class="dek-center"><blockquote style="font-size:2.2rem;max-width:1400px">“A thought worth remembering.”</blockquote><p>Attribution</p></section>',
  };
  if (!(kind in layouts)) throw new Error('Unknown slide layout');
  return layouts[kind];
}
