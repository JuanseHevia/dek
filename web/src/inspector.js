import { escapeHTML as esc } from './authoring.js';

// Drawn icons, one 16px grid and one stroke weight. Icons lead; every icon
// button carries a name for VoiceOver and a quick tooltip with its shortcut.
const P = {
  alignLeft: '<path d="M2.5 2v12"/><rect x="5" y="4" width="8.5" height="3" rx=".8"/><rect x="5" y="9" width="5" height="3" rx=".8"/>',
  alignCenter: '<path d="M8 2v12"/><rect x="3.5" y="4" width="9" height="3" rx=".8"/><rect x="5.5" y="9" width="5" height="3" rx=".8"/>',
  alignRight: '<path d="M13.5 2v12"/><rect x="2.5" y="4" width="8.5" height="3" rx=".8"/><rect x="6" y="9" width="5" height="3" rx=".8"/>',
  alignTop: '<path d="M2 2.5h12"/><rect x="4" y="5" width="3" height="8.5" rx=".8"/><rect x="9" y="5" width="3" height="5" rx=".8"/>',
  alignMiddle: '<path d="M2 8h12"/><rect x="4" y="3.5" width="3" height="9" rx=".8"/><rect x="9" y="5.5" width="3" height="5" rx=".8"/>',
  alignBottom: '<path d="M2 13.5h12"/><rect x="4" y="2.5" width="3" height="8.5" rx=".8"/><rect x="9" y="6" width="3" height="5" rx=".8"/>',
  distX: '<path d="M2.5 2v12M13.5 2v12"/><rect x="6.5" y="4.5" width="3" height="7" rx=".8"/>',
  distY: '<path d="M2 2.5h12M2 13.5h12"/><rect x="4.5" y="6.5" width="7" height="3" rx=".8"/>',
  front: '<rect x="2.5" y="2.5" width="7" height="7" rx="1.2"/><rect x="6.5" y="6.5" width="7" height="7" rx="1.2" fill="currentColor" stroke="none"/>',
  back: '<rect x="6.5" y="6.5" width="7" height="7" rx="1.2"/><rect x="2.5" y="2.5" width="7" height="7" rx="1.2" fill="currentColor" stroke="none"/>',
  duplicate: '<rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 5.5V4a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.5 4v5A1.5 1.5 0 0 0 4 10.5h1.5"/>',
  trash: '<path d="M2.5 4.5h11M6.5 4.5V3h3v1.5M4 4.5l.7 9h6.6l.7-9"/>',
  ratio: '<rect x="2.5" y="4.5" width="11" height="7" rx="1.2"/><path d="M5 9.5l6-3"/>',
  lock: '<rect x="3.5" y="7" width="9" height="6.5" rx="1.5"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/>',
  unlock: '<rect x="3.5" y="7" width="9" height="6.5" rx="1.5"/><path d="M5.5 7V5a2.5 2.5 0 0 1 4.8-1"/>',
  group: '<rect x="2" y="2" width="12" height="12" rx="2" stroke-dasharray="2 1.6"/><rect x="4.5" y="4.5" width="3.5" height="3.5" rx=".6"/><rect x="8" y="8" width="3.5" height="3.5" rx=".6"/>',
  ungroup: '<rect x="2" y="2" width="5.5" height="5.5" rx="1"/><rect x="8.5" y="8.5" width="5.5" height="5.5" rx="1"/>',
  grid: '<path d="M2 5.5h12M2 10.5h12M5.5 2v12M10.5 2v12"/>',
  bold: '<path d="M4.5 2.5h4.2a2.7 2.7 0 0 1 0 5.4H4.5zM4.5 7.9h5a2.8 2.8 0 0 1 0 5.6h-5z" stroke-width="1.7"/>',
  italic: '<path d="M7 2.5h5.5M3.5 13.5H9M9.8 2.5 6.2 13.5"/>',
  underline: '<path d="M4.5 2.5V7a3.5 3.5 0 0 0 7 0V2.5M3.5 14h9"/>',
  strike: '<path d="M2.5 8h11M11 4.6C10.6 3.4 9.5 2.6 8 2.6c-1.8 0-3 .9-3 2.3 0 .9.5 1.6 1.6 2M5 11.2c.4 1.3 1.6 2.2 3.2 2.2 1.9 0 3.1-1 3.1-2.4 0-.4-.1-.8-.3-1.1"/>',
  textLeft: '<path d="M2.5 3.5h11M2.5 6.5h7M2.5 9.5h11M2.5 12.5h7"/>',
  textCenter: '<path d="M2.5 3.5h11M4.5 6.5h7M2.5 9.5h11M4.5 12.5h7"/>',
  textRight: '<path d="M2.5 3.5h11M6.5 6.5h7M2.5 9.5h11M6.5 12.5h7"/>',
  textJustify: '<path d="M2.5 3.5h11M2.5 6.5h11M2.5 9.5h11M2.5 12.5h11"/>',
  bullets: '<path d="M6.5 4h7M6.5 8h7M6.5 12h7"/><circle cx="3" cy="4" r=".9" fill="currentColor" stroke="none"/><circle cx="3" cy="8" r=".9" fill="currentColor" stroke="none"/><circle cx="3" cy="12" r=".9" fill="currentColor" stroke="none"/>',
  numbers: '<path d="M6.5 4h7M6.5 8h7M6.5 12h7M2.4 2.9l.9-.5v3.2M2.2 7.3c.4-.6 1.7-.6 1.7.3 0 .8-1.7 1.3-1.7 2.2h1.8" stroke-width="1.1"/><path d="M2.3 11.2h1.6l-.9 1c.6 0 1 .3 1 .8s-.4.8-1 .8c-.4 0-.7-.1-.9-.4" stroke-width="1.1"/>',
  lineHeight: '<path d="M7 4h6.5M7 8h6.5M7 12h6.5M3.5 2.5v11M2 4 3.5 2.5 5 4M2 12l1.5 1.5L5 12"/>',
  letterSpacing: '<path d="M4.8 10.5 8 2.5l3.2 8M6 7.8h4M2.5 13.5h11M4 12l-1.5 1.5L4 15M12 12l1.5 1.5L12 15"/>',
  rotate: '<path d="M13 8a5 5 0 1 1-1.6-3.7M13.2 2.5v2.8h-2.8"/>',
  opacity: '<circle cx="8" cy="8" r="5.5"/><path d="M8 2.5a5.5 5.5 0 0 1 0 11z" fill="currentColor" stroke="none"/>',
  radius: '<path d="M2.5 13.5V7.5a5 5 0 0 1 5-5h6"/>',
  stroke: '<path d="M2.5 4h11" stroke-width="1"/><path d="M2.5 8h11" stroke-width="2"/><path d="M2.5 12.5h11" stroke-width="3"/>',
  padding: '<rect x="2.5" y="2.5" width="11" height="11" rx="1.5"/><rect x="5.5" y="5.5" width="5" height="5" rx=".6" stroke-dasharray="1.6 1.2"/>',
  link: '<path d="M6.8 9.2l2.4-2.4M7.3 4.7l.9-.9a2.8 2.8 0 0 1 4 4l-.9.9M8.7 11.3l-.9.9a2.8 2.8 0 0 1-4-4l.9-.9"/>',
  image: '<rect x="2" y="3" width="12" height="10" rx="1.5"/><circle cx="5.5" cy="6.5" r="1.2"/><path d="M14 11l-3.5-3.5L4 13"/>',
  eye: '<path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/>',
  eyeOff: '<path d="M2.5 2.5l11 11M6.6 4.2c.5-.1.9-.2 1.4-.2 4 0 6.5 4 6.5 4s-.6 1-1.7 2.1M10.4 11.6c-.7.3-1.5.4-2.4.4-4 0-6.5-4-6.5-4s.9-1.6 2.6-2.9"/>',
  parent: '<path d="M2.5 8.5v-6h6M2.5 2.5l6.5 6.5"/><rect x="9" y="9" width="4.5" height="4.5" rx="1"/>',
  enter: '<rect x="2" y="2" width="12" height="12" rx="2"/><path d="M5 5l5 5M10.5 6v4.5H6"/>',
  slide: '<rect x="1.5" y="3" width="13" height="10" rx="1.5"/><path d="M4.5 6.5h5M4.5 9.5h7"/>',
  text: '<path d="M3 3.5h10M8 3.5v9.5M6 13h4"/>',
  heading: '<path d="M3.5 2.5v11M12.5 2.5v11M3.5 8h9" stroke-width="1.7"/>',
  shape: '<rect x="2" y="6" width="8" height="8" rx="1.5"/><circle cx="10.5" cy="5.5" r="3.5"/>',
  block: '<rect x="2.5" y="2.5" width="11" height="11" rx="2" stroke-dasharray="2 1.6"/>',
  list: '<path d="M6.5 4h7M6.5 8h7M6.5 12h7"/><circle cx="3" cy="4" r=".9" fill="currentColor" stroke="none"/><circle cx="3" cy="8" r=".9" fill="currentColor" stroke="none"/><circle cx="3" cy="12" r=".9" fill="currentColor" stroke="none"/>',
  table: '<rect x="2" y="2.5" width="12" height="11" rx="1.5"/><path d="M2 6.2h12M2 9.8h12M6.5 2.5v11"/>',
  graphic: '<circle cx="5.5" cy="5.5" r="3"/><path d="M9 13.5l2.5-5 2.5 5z"/>',
  chart: '<path d="M3 13.5V9M8 13.5V3.5M13 13.5V7"/>',
  component: '<path d="M8 1.8 11 4.8 8 7.8 5 4.8zM8 8.2l3 3-3 3-3-3z"/>',
  shadow: '<rect x="2.5" y="2.5" width="9" height="9" rx="1.5"/><path d="M13.5 5.5v6.5a1.5 1.5 0 0 1-1.5 1.5H5.5"/>',
  replace: '<path d="M2.5 6a5.5 5.5 0 0 1 9.8-2.2M13.5 10a5.5 5.5 0 0 1-9.8 2.2M12.6 1.5v2.6H10M3.4 14.5v-2.6H6"/>',
  chevron: '<path d="M6 4l4 4-4 4"/>',
  skip: '<rect x="1.5" y="3.5" width="9" height="9" rx="1.5"/><path d="M12 5.5l2.5 2.5-2.5 2.5M7.5 8h7"/>',
  keys: '<rect x="1.5" y="3.5" width="13" height="9" rx="1.5"/><path d="M4 6.5h.01M6.5 6.5h.01M9 6.5h.01M11.5 6.5h.01M5 9.5h6" stroke-width="1.6"/>',
  boxify: '<rect x="2" y="3.5" width="12" height="9" rx="2.5"/><path d="M5 8h6"/>',
};
const icon = (name, size = 16) => `<svg class="ico" width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || P.block}</svg>`;
const ROLE_ICON = { Title:'heading', Heading:'heading', Subheading:'heading', Text:'text', 'Text box':'boxify', Tag:'boxify', List:'list', 'List item':'text', Quote:'text', Caption:'text', Cell:'text', Image:'image', Figure:'image', Graphic:'graphic', Video:'image', Canvas:'image', Embed:'image', Table:'table', 'Table row':'table', Shape:'shape', Rectangle:'shape', Ellipse:'shape', Line:'stroke', Path:'graphic', Group:'group', Component:'component', Chart:'chart', '3D object':'component', Card:'shape', Columns:'distX', Row:'distX', Stack:'distY', Box:'block', Code:'text' };
const roleIcon = role => ROLE_ICON[role] || 'block';
const FONTS = ['system-ui','Inter','Helvetica Neue','Arial','Avenir Next','Georgia','Times New Roman','Playfair Display','Plus Jakarta Sans','Menlo'];
const TEXT_ROLES = [['h1','Title'],['h2','Heading'],['h3','Subheading'],['p','Text'],['blockquote','Quote']];
const WEIGHTS = [['300','Light'],['400','Regular'],['500','Medium'],['600','Semibold'],['700','Bold'],['800','Heavy'],['900','Black']];
// An off-scale weight keeps its number and never borrows a neighbour's name: "Custom (760)".
const weightOpts = w => WEIGHTS.some(([v])=>v===String(w)) || !w ? WEIGHTS : [[String(w), `Custom (${w})`], ...WEIGHTS];
const SHADOWS = [['none','None'],['0 1px 2px rgb(0 0 0 / .12), 0 4px 12px rgb(0 0 0 / .10)','Soft'],['0 2px 6px rgb(0 0 0 / .10), 0 18px 40px -16px rgb(0 0 0 / .35)','Lifted'],['0 30px 60px -20px rgb(0 0 0 / .45)','Deep']];
const firstFamily = f => { const n = String(f || '').split(',')[0].trim().replace(/^["']|["']$/g, ''); return /^(-apple-system|system-ui|BlinkMacSystemFont)$/i.test(n) ? 'System font' : n; };

// Rebuild only when focus is on the canvas; an active field must never lose its caret.
export function createInspector(root, actions) {
  let lastBack = null, lastBackAt = 0, nextFocus = null, focusRow = false, latest = null, helpOpen = false, lastPath = null, lastAnnounced = '', quiet = false, note = null, pointerBusy = false, pending = false;
  let objectsOpen = (() => { try { const v = localStorage.getItem('dek.objectsOpen'); return v === null ? innerHeight >= 1000 : v === '1'; } catch { return innerHeight >= 1000; } })();
  const live = liveRegion(), tip = setupTips(root, () => quiet);
  // A rejected or clamped value gets a note right under its field, tied to it for VoiceOver.
  function placeNote() {
    root.querySelector('.field-note')?.remove();
    root.querySelectorAll('[aria-describedby="ins-field-note"]').forEach(n => n.removeAttribute('aria-describedby'));
    if (!note || Date.now() > note.until) { note = null; return; }
    const f = root.querySelector(`[data-field="${note.key}"]:not([type="color"])`); if (!f) return;
    const host = f.closest('.row2') || f.closest('.field') || f.closest('.num') || f;
    const p = document.createElement('p'); p.className = 'note field-note'; p.id = 'ins-field-note'; p.setAttribute('aria-live', 'polite'); // A note under a row of several fields says which one it is about.
    const many = (f.closest('.row2,.geo,.ins-group') || host).querySelectorAll('input[data-num]').length > 1, name = f.getAttribute('aria-label');
    p.textContent = many && name && !note.msg.startsWith(name) ? `${name}: ${note.msg.charAt(0).toLowerCase()}${note.msg.slice(1)}` : note.msg;
    host.after(p); f.setAttribute('aria-describedby', 'ins-field-note'); if (note.invalid) f.setAttribute('aria-invalid', 'true');
    p.scrollIntoView({ block: 'nearest' }); // never left under the pinned Objects tree
  }
  const flash = (f, msg, invalid = true) => { note = { key: f.dataset.field, msg, invalid, until: Date.now() + 5000 }; placeNote(); { const n = f.getAttribute('aria-label'); live(n && !msg.startsWith(n) ? `${n}: ${msg}` : msg); } clearTimeout(flash.t); flash.t = setTimeout(function expire() { const k = note?.key, still = k && root.querySelector(`[data-field="${k}"]:not([type="color"])`); if (still && still === document.activeElement && still.getAttribute('aria-invalid') === 'true') { note.until = Date.now() + 5000; flash.t = setTimeout(expire, 5000); return; } /* the note stays while the field is still wrong and in use */ note = null; placeNote(); const fld = k && root.querySelector(`[data-field="${k}"]:not([type="color"])`); if (fld && fld !== document.activeElement && fld.getAttribute('aria-invalid') === 'true') { fld.value = fld.defaultValue; fld.removeAttribute('aria-invalid'); } }, 5000); };
  // Whole pixels for geometry; two decimals at most elsewhere. Always a dot, never a locale comma.
  const fmt = (v, step = 1) => !Number.isFinite(+v) ? '' : step >= 1 ? String(Math.round(+v)) : String(Math.round(+v * 100) / 100);
  // Icon button: aria-label is the name, data-tip adds the shortcut.
  const ib = (ico, act, name, { on, disabled, keys, value, field, danger, tip } = {}) => `<button type="button" class="ib${danger?' danger':''}" ${field?`data-field="${field}" data-value="${esc(value)}"`:`data-action="${act}"`} aria-label="${esc(name)}" data-tip="${esc(tip || name)}${keys?`<kbd>${esc(keys)}</kbd>`:''}"${on===undefined?'':` aria-pressed="${!!on}"`}${disabled?' disabled':''}>${icon(ico)}</button>`;
  const tb = (body, label) => `<div class="toolrow" role="toolbar" aria-label="${esc(label)}">${body}</div>`;
  // Compact number field with a leading glyph (letter or icon), Figma-style. Text input so the
  // value always reads with a dot; ↑/↓ step it (⇧ ×10) and the value is clamped, never rejected.
  const num = (glyph, name, key, value, min = -10000, max = 10000, step = 1, unit = '') => `<label class="num" data-tip="${esc(name)}"><span class="glyph" aria-hidden="true">${P[glyph] ? icon(glyph, 14) : esc(glyph)}</span><input aria-label="${esc(name)}" type="text" inputmode="decimal" autocomplete="off" spellcheck="false" data-num data-field="${key}" value="${fmt(value, step)}" data-min="${min}" data-max="${max}" data-step="${step}">${unit?`<span class="unit" aria-hidden="true">${unit}</span>`:''}</label>`;
  const text = (label,key,value,extra='') => `<label class="field"><span>${label}</span><input aria-label="${label}" data-field="${key}" value="${esc(value)}" ${extra}></label>`;
  const select = (label,key,value,opts,{bare}={}) => {
    const v=String(value ?? ''), list=opts.some(([o])=>o===v) || v==='' ? opts : [[v,v],...opts];
    const sel=`<select aria-label="${label}" data-field="${key}">${list.map(([o,l])=>`<option value="${esc(o)}" ${o===v?'selected':''}>${esc(l)}</option>`).join('')}</select>`;
    return bare ? sel : `<label class="field"><span>${label}</span>${sel}</label>`;
  };
  // Computed colors read as hex; a clear color reads as an empty "None" field.
  const color = (label,key,value) => `<div class="field"><span aria-hidden="true">${label}</span><div class="swatch${clear(value)?' none':''}" data-tip="A color name, hex code, or empty for none"><input aria-label="Choose ${esc(label.toLowerCase())} color" type="color" data-field="${key}" value="${hex(value)}"><input aria-label="${esc(label)} color" data-field="${key}" value="${esc(clear(value) ? '' : readable(value))}" placeholder="${key==='color' || key==='slideBackground'?'Deck default':'None'}" spellcheck="false"></div></div>`;
  const seg = (key, value, opts, label) => `<div class="seg-group" role="radiogroup" aria-label="${esc(label)}">${opts.map(([v,ico,name])=>`<button type="button" role="radio" class="ib" data-field="${key}" data-value="${esc(v)}" aria-checked="${String(value)===v}" aria-label="${esc(name)}" data-tip="${esc(name)}">${P[ico]?icon(ico):`<span class="seg-text">${esc(ico)}</span>`}</button>`).join('')}</div>`;
  const group = (name,body,ico,extra='') => `<section class="ins-group" aria-label="${esc(name)}"><h3>${ico?icon(ico,14):''}<span>${name}</span>${extra}</h3>${body}</section>`;
  const tagOf = s => s?.tag || '';
  const boxed = s => s.padding>0 || s.borderWidth>0 || s.borderRadius>0 || (s.boxShadow && s.boxShadow!=='none');

  const helpPanel = () => `<section class="ins-help" id="ins-help" role="region" aria-label="Editing keys"><dl>
    <dt>Click</dt><dd>Select. Words are picked directly</dd>
    <dt>Double-click</dt><dd>Edit words, or step inside a box</dd>
    <dt>↩</dt><dd>Edit words, or step inside</dd>
    <dt>⌘↩</dt><dd>Finish editing words (as Esc)</dd>
    <dt>Esc</dt><dd>Finish editing, then step out a level. Twice on the slide leaves Edit</dd>
    <dt>Tab</dt><dd>Next object at this level (⇧ back)</dd>
    <dt>F6 ⇧F6</dt><dd>Next or previous area: slide, panel, insert bar, top bar, slides; Esc goes back</dd>
    <dt>Objects</dt><dd>↑↓ select · ←→ fold · type to jump</dd>
    <dt>⇧ Click</dt><dd>Add to the selection · ⌘A all</dd>
    <dt>Arrows</dt><dd>Nudge 1px (⇧ 10px)</dd>
    <dt>⌥ Drag</dt><dd>Move off the grid · ⇧ resize frees proportions</dd>
    <dt>⌘D ⌫</dt><dd>Duplicate · Delete the selected object</dd>
    <dt>⌘L</dt><dd>Lock or unlock it</dd>
    <dt>⌘G</dt><dd>Group (⇧⌘G ungroup)</dd>
    <dt>⌘B ⌘I</dt><dd>Bold · Italic while editing</dd>
    <dt>⌘Z</dt><dd>Undo any change, yours or the agent’s</dd></dl>
    <button type="button" class="link" data-action="shortcuts">All shortcuts <kbd aria-hidden="true">⌘/</kbd></button></section>`;
  const helpBtn = () => `<button type="button" class="ib" data-action="help" aria-label="Editing keys" aria-expanded="${helpOpen}"${helpOpen ? ' aria-controls="ins-help"' : ''}${helpOpen ? '' : ' data-tip="Editing keys"'}>${icon('keys')}</button>`;

  function header(s, data) {
    if (!s) return `<header class="ins-head"><div class="ins-title">${icon('slide')}<h2 tabindex="-1">Slide ${esc(data.slide?.number || '')}</h2>${data.slide?ib('skip','hideSlide',data.slide.hidden?'Show this slide when presenting':'Hide this slide when presenting',{on:data.slide.hidden}):''}${helpBtn()}</div>${helpOpen?helpPanel():''}</header>`;
    const name = s.editingText ? `Editing · ${s.label || 'text'}` : s.count>1 ? `${s.count} objects` : (s.label || s.role || 'Object'), busy = !!s.editingText;
    const crumbs = [`<button type="button" data-action="clear" data-tip="Slide settings">Slide</button>`, ...(s.trail||[]).map(t=>`<button type="button" data-layer="${esc(JSON.stringify(t.path))}" aria-label="Select ${esc(t.label)}" data-tip="Select ${esc(t.label)}">${esc(t.role || t.label)}</button>`), `<span aria-current="true">${esc(s.role || s.label)}</span>`];
    return `<header class="ins-head"><div class="ins-title">${icon(s.count>1?'group':roleIcon(s.role))}<h2 tabindex="-1" title="${esc(name)}">${esc(name)}</h2>${s.locked?`<span class="badge">${icon('lock',12)}Locked</span>`:''}${helpBtn()}</div>
      ${s.editingText?`<p class="note live-note">${icon('text',14)}Typing into the slide · Esc to finish</p>`:`<nav class="crumbs" aria-label="Selection path">${crumbs.join(icon('chevron',10))}</nav>`}
      ${helpOpen?helpPanel():''}
      ${tb(ib('parent','parent',(s.trail||[]).length?`Select the ${s.trail.at(-1).role || 'box'} around it`:'Select the slide',{keys:'Esc'})+ib('enter','enter',s.kind==='text'?'Edit words':'Step inside',{keys:'↩',disabled:s.locked || (s.kind!=='text' && !s.canEnter)})+'<span class="sep"></span>'+(/^(figcaption|caption|legend|summary|thead|tfoot)$/.test(s.tag||'') ? ib('duplicate','duplicate','Duplicate',{disabled:true,tip:'A caption exists once; duplicate the figure or table'}) : ib('duplicate','duplicate','Duplicate',{keys:'⌘D',disabled:busy || s.locked}))+ib(s.locked?'lock':'unlock','lock',s.lockedBy?`Unlock the ${s.lockedBy.split(' · ')[0]} around it`:'Lock position and content',{on:s.locked,keys:'⌘L',disabled:busy,tip:s.lockedBy?`Unlock the ${s.lockedBy.split(' · ')[0]} around it`:s.locked?'Locked · press to unlock':'Lock position and content'})+ib('trash','delete',s.locked?'Delete (unlock first)':'Delete',{keys:'⌫',danger:true,disabled:busy || s.locked}),'Object actions')}</header>`;
  }

  function textGroup(s) {
    const tag=tagOf(s), roleOpts = TEXT_ROLES.some(([t])=>t===tag) ? TEXT_ROLES : [[tag || 'div', 'Text (deck style)'], ...TEXT_ROLES];
    const align = ['left','center','right','justify'].includes(s.textAlign) ? s.textAlign : s.textAlign==='end' ? 'right' : 'left';
    const svgText = s.svg, family = firstFamily(s.fontFamily);
    return group('Type',
      // Retagging is offered only where it can't break layout: block text, never chips, cells or list items.
      (s.count<2 && !svgText && /^(p|h[1-6]|blockquote|div)$/.test(tag) ? select('Role','tag',tag,roleOpts) : '') +
      `<label class="field" data-tip="${esc(s.fontFamily)}"><span>Font</span><input aria-label="Font family" data-field="font-family" value="${esc(family)}" list="dek-fonts" spellcheck="false" autocomplete="off"></label><datalist id="dek-fonts">${[...new Set([family,...FONTS])].filter(Boolean).map(f=>`<option value="${esc(f)}">`).join('')}</datalist>` +
      `<div class="row2 size-row">${num('text','Font size','font-size',s.fontSize,6,500,1,'px')}${select('Font weight','font-weight',s.fontWeight,weightOpts(+s.fontWeight),{bare:true})}</div>` +
      (svgText ? '' : `<div class="toolrow split">${seg('text-align',align,[['left','textLeft','Text flush left'],['center','textCenter','Text centered'],['right','textRight','Text flush right'],['justify','textJustify','Text justified']],'Text alignment')}<div class="seg-group" role="toolbar" aria-label="Emphasis">${ib('bold','bold','Bold',{on:s.allBold ?? +s.fontWeight>=600,keys:'⌘B'})+ib('italic','italic','Italic',{on:s.allItalic ?? s.fontStyle==='italic',keys:'⌘I'})+ib('underline','underline','Underline',{on:s.textDecoration?.includes('underline')})+ib('strike','strikeThrough','Strikethrough',{on:s.textDecoration?.includes('line-through')})}</div></div>`) +
      `<div class="row2">${svgText ? '' : num('lineHeight','Line spacing, as a multiple of the font size','line-height',s.lineHeight,0.5,5,0.05)}${num('letterSpacing','Letter spacing','letter-spacing',s.letterSpacing,-20,100,0.5,'px')}</div>` +
      (svgText ? '' : `<div class="toolrow split"><div class="seg-group" role="toolbar" aria-label="Lists">${ib('bullets','insertUnorderedList','Bulleted list',{on:s.tag==='ul'})+ib('numbers','insertOrderedList','Numbered list',{on:s.tag==='ol'})}</div>${select('Text case','text-transform',s.textTransform,[['none','As typed'],['uppercase','UPPERCASE'],['lowercase','lowercase'],['capitalize','Title Case']],{bare:true})}</div>`) +
      color('Text','color',svgText ? s.fill : s.color) + (svgText || boxed(s) ? '' : color('Highlight','textHighlight',s.backgroundColor)) +
      (svgText ? '' : `<label class="num wide" data-tip="Link: a web address, mailto: or #slide-id"><span class="glyph" aria-hidden="true">${icon('link',14)}</span><input aria-label="Link address" data-field="link" value="${esc(s.link || '')}" placeholder="Link, https://…" spellcheck="false" autocomplete="off"></label>`)
    ,'text');
  }

  function appearance(s) {
    if (s.svg && s.kind === 'shape') return group('Appearance', color('Fill','fill',s.fill) + color('Stroke','stroke',s.stroke) + `<div class="row2">${num('stroke','Stroke width','stroke-width',s.strokeWidth,0,100,0.5,'px')}</div>`,'shape');
    if (s.svg) return '';
    // Plain text keeps Highlight under Type; a text box (padding, border, radius) gets Fill here instead.
    if (s.kind === 'text' && !boxed(s)) return `<button type="button" class="wide ghost" data-action="boxify">${icon('boxify',14)}Put this text in a box</button>`;
    const shadow = SHADOWS.find(([v])=>norm(v)===norm(s.boxShadow))?.[0] || (s.boxShadow && s.boxShadow!=='none' ? s.boxShadow : 'none');
    return group('Appearance',
      color('Fill','background-color',s.backgroundColor) + color('Stroke','border-color',s.borderWidth>0 ? s.borderColor : '') +
      `<div class="row2">${num('stroke','Stroke width','border-width',s.borderWidth,0,100,1,'px')}${num('radius','Corner radius','border-radius',s.borderRadius,0,1000,1,'px')}${s.kind==='image'?'':num('padding','Padding, inside the edge','padding',s.padding,0,1000,1,'px')}<label class="num" data-tip="Shadow"><span class="glyph" aria-hidden="true">${icon('shadow',14)}</span>${select('Shadow','box-shadow',shadow,SHADOWS.concat(shadow!=='none' && !SHADOWS.some(([v])=>v===shadow)?[[shadow,'Custom']]:[]),{bare:true})}</label></div>`,'shape');
  }

  function render(data, force = false) {
    tip.prune();
    latest = data;
    // Never rebuild under a field the person is changing; an untouched focused field is safe to refresh.
    const a = root.contains(document.activeElement) ? document.activeElement : null;
    const dirty = a && (a.matches('select') ? !a.selectedOptions[0]?.defaultSelected : a.matches('input:not([type="color"]),textarea') && a.value !== a.defaultValue);
    if (!force && (dirty || a?.matches('textarea,input[type="color"]'))) return;
    if (pointerBusy) { pending = true; return; }
    tip.hide();
    // Keep keyboard focus on the same control across a rebuild, and the scroll when the selection is the same.
    const f=root.contains(document.activeElement) ? document.activeElement : null;
    const key=(f ? keyOf(f) : nextFocus); nextFocus=null;
    const selectField = f && f.matches('input:not([type="color"])') && force;
    const { info:s, slide, title, layers=[] } = data;
    root.setAttribute('aria-label', s ? `Inspector · ${s.count > 1 ? s.count + ' objects' : s.label || 'object'}` : 'Slide inspector');
    if (s?.editingText && note) note = null; // a field's note belongs to that field, not to the words being typed
    const pathKey = JSON.stringify(s?.path ?? null), keepScroll = pathKey === lastPath ? root.querySelector('.ins-props')?.scrollTop || 0 : 0;
    lastPath = pathKey;
    let html = header(s, data);
    let props = '';
    if (!s) {
      if (slide) {
        props += group('Appearance',
          color('Background','slideBackground',slide.background) +
          select('Transition','transition',slide.transition,[['','Deck default'],...['fade','slide','rise','zoom','flip','none'].map(v=>[v,v==='none'?'None':v[0].toUpperCase()+v.slice(1)])]) +
          (slide.hidden?`<p class="note">${icon('skip',14)}Hidden when presenting and left out of exports.</p>`:''),'slide');
        props += group('Speaker notes',`<textarea aria-label="Speaker notes" data-field="notes" placeholder="What do you want to say?">${esc(slide.notes)}</textarea><p class="note">Shown in presenter view and exported to PowerPoint.</p>`);
      }
      props += group('Deck', text('Title','title',title));
    } else {
      if (s.locked) props += `<p class="note">${icon('lock',14)}${s.lockedBy ? `Inside a locked ${esc(s.lockedBy.split(' · ')[0])}. Unlock to edit it.` : 'Locked. Unlock it to move or edit.'}</p>`;
      if (s.kind === 'text') props += textGroup(s);
      if (!s.editingText && s.count<2 && s.canEnter && s.kind !== 'text') props += `<button type="button" class="wide ghost" data-action="enter">${icon('enter',14)}${s.kind==='figure'?'Edit the image and caption':'Edit what’s inside'}<kbd aria-hidden="true">↩</kbd></button>`;
      if (s.broken) props = `<p class="note warn" role="status">${icon('image',14)}This image file can’t be found (${esc(String(s.src||'').split('/').pop().slice(0,40))}). Replace it to fix.</p>` + props;
      if (s.fontMissing) props = `<p class="note">${icon('text',14)}${esc(s.fontMissing)} isn’t installed on this Mac; a fallback font is showing.</p>` + props;
      if (s.kind === 'image' && !s.svg) props += group('Image',
        `<button type="button" class="wide" data-action="replace">${icon('replace',14)}Replace image…</button>` +
        `<div class="field"><span>Fit${s.fitSet?'':' <em class="quiet">· not set</em>'}</span>${seg('object-fit',s.fitSet?s.objectFit:'',[['contain','Fit','Show the entire image'],['cover','Fill','Fill the frame, crop the edges'],['fill','Stretch','Stretch to the frame']],'Image fit')}</div>` +
        `<div class="row2">${select('Frame','cropRatio',s.objectFit==='cover'?(['1.7777777778','1.3333333333','1','0.75'].find(r=>Math.abs(s.width/s.height-Number(r))<.005)||''):'',[['','Free frame'],['1.7777777778','16:9'],['1.3333333333','4:3'],['1','1:1'],['0.75','3:4']],{bare:true})}${ib('ratio','aspect','Keep proportions when resizing',{on:s.aspect!==false})}</div>` +
        (s.objectFit==='cover'?`<div class="row2">${num('X','Focus point across, 0–100%','crop-x',parseFloat((s.objectPosition || '50% 50%').split(' ')[0]),0,100,1,'%')}${num('Y','Focus point down, 0–100%','crop-y',parseFloat((s.objectPosition || '50% 50%').split(' ')[1]),0,100,1,'%')}</div>`:'') +
        text('Description','alt',s.alt || '', 'placeholder="What it shows, for screen readers"'),'image');
      props += group('Layout',
        `<div class="row2">${num('X','Left, from the slide edge','x',s.geometry.x)}${num('Y','Top, from the slide edge','y',s.geometry.y)}${num('W','Width','width',s.width,1,2*(data.size?.w||1920))}${num('H','Height','height',s.height,1,2*(data.size?.h||1080))}${num('rotate','Rotation','rotate',s.rotate,-360,360,1,'°')}${num('opacity','Opacity','opacity',s.opacity*100,0,100,1,'%')}</div>` +
        tb(ib('alignLeft','align-left','Align left edges')+ib('alignCenter','align-center','Align horizontal centers')+ib('alignRight','align-right','Align right edges')+'<span class="sep"></span>'+ib('alignTop','align-top','Align top edges')+ib('alignMiddle','align-middle','Align vertical centers')+ib('alignBottom','align-bottom','Align bottom edges'),s.count>1?'Align to the selection':'Align to the slide') +
        tb(ib('front','front','Bring to front')+ib('back','back','Send to back')+'<span class="sep"></span>'+ib('group','group','Group',{keys:'⌘G',disabled:s.count<2})+ib('ungroup','ungroup','Ungroup',{keys:'⇧⌘G',disabled:s.kind!=='group'})+(s.count>2?'<span class="sep"></span>'+ib('distX','distribute-x','Space evenly across')+ib('distY','distribute-y','Space evenly down'):''),'Arrange'),
        'alignLeft', `<span class="h3-note"><span class="sr-only">, align </span>${s.count>1?'to selection':'to slide'}</span>${ib('grid','snap','Snap to grid',{on:data.snapping,tip:'Snap to the 8px grid while dragging; hold ⌥ to move freely'})}`);
      props += appearance(s);
    }
    html += `<div class="ins-props${s?.editingText?' is-editing':''}">${props}</div>`;
    if (layers.length) html += objectsTree(layers, s);
    root.innerHTML = html;
    // An open help popover owns the keyboard: what it covers can't take focus.
    if (helpOpen) for (const n of root.querySelectorAll('.ins-props,.ins-objects,.crumbs,.ins-head > .toolrow,.live-note')) n.inert = true;
    // A locked object can't be moved or restyled; its fields say so instead of silently reverting.
    if (s?.locked) for (const g of root.querySelectorAll('.ins-props > .ins-group, .ins-props > .wide')) { g.inert = true; g.setAttribute('aria-disabled','true'); g.classList.add('locked'); }
    // While typing into the slide only Type applies; the rest is visibly and actually unavailable.
    if (s?.editingText) for (const g of root.querySelectorAll('.ins-props > .ins-group:not([aria-label="Type"]), .ins-props > .wide')) { g.inert = true; g.setAttribute('aria-disabled','true'); }
    roving();
    placeNote();
    const props$ = root.querySelector('.ins-props'); if (props$) props$.scrollTop = keepScroll;
    root.querySelector('.layer-list .current')?.scrollIntoView({ block:'nearest' });
    if (typeof focusRow === 'number' && Date.now() - focusRow > 2000) focusRow = false; // a pending row focus expires
    if (focusRow && root.querySelector('.layer-list .current')) { focusRow = false; const r = root.querySelector('.layer-list .current'); if (r) { root.querySelectorAll('.layer-list > [role="treeitem"]').forEach(x => x.tabIndex = -1); r.tabIndex = 0; r.focus({ preventScroll: true }); } }
    else if (key) { quiet = true; try { const n = root.querySelector(key); n?.focus({ preventScroll:true }); if (selectField) n?.select?.(); } catch {} quiet = false; }
    // A rebuild must never drop the keyboard to the page: keys there would turn the slide.
    if (f && (document.activeElement === document.body || !document.activeElement)) { const back = lastBack && Date.now() - lastBackAt < 3000 ? root.querySelector(lastBack) : null; (back && !back.disabled && !back.closest('[inert]') ? back : root.querySelector('.ins-title h2'))?.focus({ preventScroll: true }); }
    const said = s ? (s.editingText ? 'Editing text' : s.count>1 ? `${s.count} objects selected` : `${s.label} selected`) : slide ? `Slide ${slide.number}` : '';
    if (said !== lastAnnounced) { lastAnnounced = said; live(said); }
  }
  // A selector that finds "the same control" again after the panel is rebuilt.
  function keyOf(f) {
    if (!f?.dataset) return null;
    if (f.matches('.ins-title h2')) return '.ins-title h2';
    if (f.closest('.layer-list')) return f.dataset.layer ? `.layer-list [data-layer="${CSS.escape(f.dataset.layer)}"]` : '.layer-list .current';
    if (f.dataset.action) return `[data-action="${f.dataset.action}"]`;
    if (f.dataset.layer) return `[data-layer="${CSS.escape(f.dataset.layer)}"]`;
    if (f.dataset.field) return `[data-field="${f.dataset.field}"]${f.dataset.value!==undefined?`[data-value="${CSS.escape(f.dataset.value)}"]`:f.type==='color'?'[type="color"]':':not([type="color"])'}`;
    return null;
  }
  // The slide's objects as a real tree: branches fold, and the path to the selection is always open.
  const expanded = new Set();
  const pkey = p => JSON.stringify(p);
  function objectsTree(layers, s) {
    const cur = pkey(s?.path), selected = new Set((s?.paths || []).map(pkey));
    const onPath = l => !!s?.path && l.path.length < s.path.length && l.path.every((n, i) => n === s.path[i]);
    let hideBelow = Infinity, rows = '';
    // A selection deeper than the tree goes (words inside a list item) is shown on the row that holds it.
    const exact = layers.some(l => pkey(l.path) === cur);
    const holder = !exact && s?.path ? layers.filter(l => onPath(l)).sort((a, b) => b.path.length - a.path.length)[0] : null;
    layers.forEach((l, i) => {
      if (l.depth > hideBelow) return;
      hideBelow = Infinity;
      const branch = !!layers[i + 1] && layers[i + 1].depth > l.depth, open = branch && (expanded.has(pkey(l.path)) || onPath(l));
      if (branch && !open) hideBelow = l.depth;
      const k = pkey(l.path), isCur = k === cur, inSel = selected.has(k);
      rows += `<div role="treeitem" tabindex="-1" aria-level="${l.depth + 1}" aria-selected="${isCur || inSel}"${branch ? ` aria-expanded="${open}"` : ''} data-layer="${esc(k)}" class="row${isCur ? ' current' : inSel ? ' also' : l === holder ? ' holds' : ''}"${l === holder ? ' aria-current="true"' : ''} style="--depth:${l.depth || 0}" data-depth="${l.depth || 0}">${branch ? `<span class="twist" data-twist aria-hidden="true">${icon('chevron', 10)}</span>` : '<span class="twist"></span>'}${icon(roleIcon(l.role), 14)}<span class="name">${esc(l.label)}</span>${l.locked ? `<span class="sr-only">, locked</span>${icon('lock', 12)}` : ''}</div>`;
    });
    return `<section class="ins-objects${objectsOpen ? '' : ' closed'}" aria-label="Objects on this slide"><h3><button type="button" class="disclose" data-action="objects" aria-expanded="${objectsOpen}" aria-controls="ins-tree">${icon('chevron', 12)}<span>Objects</span></button><span class="h3-note"><span class="sr-only">, </span>${layers.length}<span class="sr-only"> objects</span></span></h3><div class="layer-list" id="ins-tree" role="tree" aria-label="Objects on this slide, in reading order"${objectsOpen ? '' : ' hidden'}>${rows}</div></section>`;
  }
  function treeKey(e, t) {
    // ⌘⌫ deletes like ⌫ (as on the slide); ⌘↩ and other chords aren't row commands.
    if ((e.metaKey || e.ctrlKey || e.altKey) && !e.key.startsWith('Arrow') && !((e.metaKey || e.ctrlKey) && !e.altKey && (e.key === 'Backspace' || e.key === 'Delete'))) return false;
    const rows = Array.from(root.querySelectorAll('.layer-list > [role="treeitem"]')), i = rows.indexOf(t);
    const go = r => { if (!r) return; if (r.getAttribute('aria-expanded') === 'true') expanded.add(r.dataset.layer); rows.forEach(x => x.tabIndex = -1); r.tabIndex = 0; r.focus(); focusRow = true; actions.select(JSON.parse(r.dataset.layer), false); };
    const k = t.dataset.layer, depth = +t.dataset.depth;
    if (e.key === 'ArrowDown') go(rows[i + 1]);
    else if (e.key === 'ArrowUp') go(rows[i - 1]);
    else if (e.key === 'Home') go(rows[0]);
    else if (e.key === 'End') go(rows.at(-1));
    else if (e.key === 'ArrowRight') { if (t.getAttribute('aria-expanded') === 'false') { expanded.add(k); render(latest); } else if (t.hasAttribute('aria-expanded')) go(rows[i + 1]); }
    else if (e.key === 'ArrowLeft') { if (t.getAttribute('aria-expanded') === 'true') { expanded.delete(k); render(latest); } else go(rows.slice(0, i).reverse().find(r => +r.dataset.depth < depth)); }
    else if (e.key === 'Enter' && t.classList.contains('current')) { actions.action('enter'); setTimeout(() => { if (latest?.info?.editingText) return; const r = root.querySelector('.layer-list .current'); if (r) { root.querySelectorAll('.layer-list > [role="treeitem"]').forEach(x => x.tabIndex = -1); r.tabIndex = 0; r.focus({ preventScroll: true }); } }, 0); }
    else if (e.key === 'Enter' || e.key === ' ') go(t);
    // ⌫ acts on the row that has focus, even one clicked a moment ago whose selection hasn't landed yet.
    else if ((e.key === 'Backspace' || e.key === 'Delete') && !t.classList.contains('current')) { focusRow = false; actions.select(JSON.parse(k), false); focusRow = Date.now(); lastBack = '.layer-list .current'; lastBackAt = Date.now(); actions.action('delete'); }
    else if ((e.key === 'Backspace' || e.key === 'Delete') && t.classList.contains('current')) {
      // Like Finder: the neighbour takes the selection (the host picks it), and keyboard focus follows its row.
      focusRow = Date.now(); lastBack = '.layer-list .current'; lastBackAt = Date.now(); actions.action('delete'); // after the reload the neighbour's row gets the keyboard
    }
    else return false;
    return true;
  }
  // One tab stop per toolbar, radio group and the tree; arrows move inside them.
  function roving() {
    for (const g of root.querySelectorAll('.toolrow:not(.split),.seg-group,.layer-list')) {
      const list = Array.from(g.querySelectorAll(':scope > button:not([disabled]), :scope > [role="treeitem"]'));
      if (!list.length) continue;
      const pick = list.find(b => b.matches('[aria-checked="true"],.current')) || list.find(b => b.matches('.holds')) || list[0];
      list.forEach(b => b.tabIndex = b === pick ? 0 : -1);
      g.querySelectorAll(':scope > button[disabled]').forEach(b => b.tabIndex = -1);
    }
  }
  // Whichever toolbar button holds focus is that toolbar's one tab stop.
  root.addEventListener('focusin', e => { const b = e.target, g = b.matches?.('button') && b.parentElement?.matches('.toolrow:not(.split),.seg-group') ? b.parentElement : null; if (!g) return; g.querySelectorAll(':scope > button').forEach(x => x.tabIndex = x === b ? 0 : -1); });
  root.addEventListener('pointerdown', e => { if (e.target.closest('input,select,button')) actions.capture(); pointerBusy = true; });
  // A rebuild that lands between pointerdown and click would swallow the click; hold it until the click is done.
  document.addEventListener('pointerup', () => { if (!pointerBusy) return; setTimeout(() => { pointerBusy = false; if (pending && latest) { pending = false; render(latest); } }, 0); }, true);
  root.addEventListener('mousedown', e => {
    if (!e.target.closest('button,[role="treeitem"]')) return;
    e.preventDefault();
    // A field being edited commits before a button acts, so the panel never shows stale values.
    const a = document.activeElement; if (root.contains(a) && a.matches('input,select,textarea')) a.blur();
  });
  // A click on the panel's empty space keeps the keyboard where it was (a tree row, a field).
  root.addEventListener('mousedown',e=>{ if(!e.target.closest('button,input,select,textarea,label,a,[tabindex],[role="treeitem"]')) e.preventDefault(); });
  root.addEventListener('click',e=>{
    const layer=e.target.closest('[data-layer]');
    if(layer && e.target.closest('[data-twist]')) { const k=layer.dataset.layer; if(layer.getAttribute('aria-expanded')==='true') expanded.delete(k); else expanded.add(k); if(latest)render(latest); const r=root.querySelector(`[data-layer="${CSS.escape(k)}"]`); if(r){ root.querySelectorAll('.layer-list > [role="treeitem"]').forEach(x=>x.tabIndex=-1); r.tabIndex=0; r.focus({preventScroll:true}); } return; }
    if(layer) { if(layer.matches('[role="treeitem"]')) { focusRow=true; layer.focus({preventScroll:true}); if(layer.getAttribute('aria-expanded')==='true') expanded.add(layer.dataset.layer); } actions.select(JSON.parse(layer.dataset.layer),e.shiftKey || e.metaKey); return; }
    const v=e.target.closest('button[data-field]');
    if(v && !v.disabled) { const kb=document.activeElement===v; actions.field(v.dataset.field, v.dataset.value, v); if(!kb) setTimeout(()=>{ if(document.activeElement===document.body) actions.canvas?.(); },400); return; }
    const b=e.target.closest('[data-action]'); if(!b || b.disabled) return;
    if(b.dataset.action==='help') { tip.hide(); helpOpen=!helpOpen; if(latest)render(latest); return; }
    if(b.dataset.action==='objects') { const had=root.contains(document.activeElement) && document.activeElement!==document.body; objectsOpen=!objectsOpen; try{localStorage.setItem('dek.objectsOpen',objectsOpen?'1':'0');}catch{} if(latest)render(latest); if(had) root.querySelector('[data-action="objects"]')?.focus({preventScroll:true}); return; } // the keyboard stays on the toggle
    if(b.dataset.action==='shortcuts') { helpOpen=false; if(latest)render(latest); actions.shortcuts?.(); return; }
    const back = document.activeElement === b ? keyOf(b) : null;
    if (back) { lastBack = back; lastBackAt = Date.now(); }
    actions.action(b.dataset.action);
    // A control used from the keyboard keeps focus, even when the action briefly works in the slide.
    // …except when the action hands the keyboard to the slide, like Edit words.
    // If the control disabled itself (nothing left to step out of), stay in its toolbar.
    // A mouse click leaves the keyboard where it was; if the action stranded it on the page, the slide takes it.
    if (!back) { const strand = () => { if (document.activeElement === document.body) actions.canvas?.(); }; setTimeout(strand, 0); setTimeout(strand, 400); }
    if (back) setTimeout(() => { if (latest?.info?.editingText) return; const n = root.querySelector(back); (n && !n.disabled ? n : n?.closest('.toolrow')?.querySelector('button:not([disabled])') || root.querySelector('.ins-title [data-action="help"]') || root.querySelector('.ins-title h2'))?.focus({ preventScroll: true }); }, 0);
  });
  const commitNum = f => {
    const raw = f.value.trim().replace(',', '.'), n = parseFloat(raw);
    // Empty clears the override (the deck's CSS applies again); position always needs a number.
    if (raw === '' && !['x','y'].includes(f.dataset.field)) { f.removeAttribute('aria-invalid'); actions.field(f.dataset.field, '', f); return; }
    if (!/^-?(\d+\.?\d*|\.\d+)\s*(px|%|°|deg|x|×)?$/i.test(raw) || !Number.isFinite(n)) { const msg = `Enter a number from ${f.dataset.min} to ${f.dataset.max}`;
      if (document.activeElement === f) { flash(f, msg); f.select(); return; }
      f.value = f.defaultValue; f.removeAttribute('aria-invalid'); flash(f, `${msg}. Kept ${f.defaultValue || 'the deck value'}.`, false); return; }
    // Impossible values (zero or negative sizes) keep the last good one; merely too large ones are clamped.
    if (n <= 0 && +f.dataset.min > 0 && f.defaultValue !== '') { f.value = f.defaultValue; f.removeAttribute('aria-invalid'); flash(f, `Use at least ${f.dataset.min}. Kept ${f.defaultValue}.`, false); return; }
    const v = Math.min(+f.dataset.max, Math.max(+f.dataset.min, n));
    if (v !== n) flash(f, `Kept within ${f.dataset.min}–${f.dataset.max}`, false);
    if (v !== n && fmt(v, +f.dataset.step) === f.defaultValue) { f.value = f.defaultValue; return; } // clamped to what it already is: nothing changes
    if (v === n && note?.key === f.dataset.field) { note = null; placeNote(); }
    if (fmt(v, +f.dataset.step) === f.defaultValue && v === n) { f.value = f.defaultValue; return; }
    f.removeAttribute('aria-invalid'); f.value = fmt(v, +f.dataset.step);
    // What's written is what the field shows: whole pixels for geometry, the field's step elsewhere.
    { const shown = Number(f.value); actions.field(f.dataset.field, Number.isFinite(shown) ? shown : v, f); } f.defaultValue = f.value; // the kept value is what the slide now shows
  };
  root.addEventListener('change',e=>{
    const f=e.target.closest('[data-field]'); if(!f || f.tagName==='BUTTON')return;
    // Tab fires change while focus is between fields; applying now would rebuild the panel under the
    // field Tab is heading to. Apply once focus has landed, and the rebuild restores it there.
    if(document.activeElement===f) apply(f); else setTimeout(()=>apply(f),0);
  });
  function apply(f) {
    if (f.dataset.committed !== undefined && f.dataset.committed === f.value) { delete f.dataset.committed; return; }
    if(f.hasAttribute('data-num')) { commitNum(f); return; }
    if(note?.key===f.dataset.field) { note=null; root.querySelector('.field-note')?.remove(); f.removeAttribute('aria-invalid'); }
    actions.field(f.dataset.field, f.value, f);
    // Accepted: this is now the field's kept value, so a later revert or "Kept …" note tells the truth.
    if (!f.hasAttribute('aria-invalid') && f.matches('input:not([type="color"]),textarea')) {
      // A bare hex reads as one; the swatch beside it shows the new color at once.
      if (f.closest('.swatch') && /^[0-9a-f]{3}([0-9a-f]{3})?$/i.test(f.value.trim())) f.value = '#' + f.value.trim().toUpperCase();
      const sw = f.closest('.swatch'); if (sw && f.value.trim()) { const c = sw.querySelector('input[type="color"]'), h = hex(f.value.trim()); if (c && /^#[0-9a-f]{6}$/i.test(h)) c.value = h; sw.classList.remove('none'); }
      f.defaultValue = f.value;
    }
  }
  let find='', findAt=0;
  root.addEventListener('keydown',e=>{
    const t=e.target;
    if(e.key==='Escape' && helpOpen && !t.matches('input,select,textarea')) { e.preventDefault(); e.stopPropagation(); helpOpen=false; if(latest)render(latest); root.querySelector('[data-action="help"]')?.focus(); return; }
    // Type-to-find in the object tree: letters jump to the next row whose words start with them.
    if(t.matches?.('[role="treeitem"]') && treeKey(e,t)) { e.preventDefault(); e.stopPropagation(); return; }
    if(t.closest?.('.layer-list') && e.key.length===1 && !e.metaKey && !e.ctrlKey && e.key!==' ') {
      find = Date.now()-findAt<700 ? find+e.key.toLowerCase() : e.key.toLowerCase(); findAt=Date.now();
      const rows=Array.from(root.querySelectorAll('.layer-list > [role="treeitem"]')), i=rows.indexOf(t);
      const words=r=>r.querySelector('.name').textContent.toLowerCase(), hit=[...rows.slice(i+1),...rows.slice(0,i+1)].find(r=>words(r).startsWith(find) || (words(r).split('·')[1]||'').trim().startsWith(find));
      e.preventDefault();e.stopPropagation();
      if(hit){rows.forEach(r=>r.tabIndex=-1);hit.tabIndex=0;hit.focus();focusRow=true;actions.select(JSON.parse(hit.dataset.layer),false);}
      return;
    }
    if(t.hasAttribute?.('data-num') && (e.key==='ArrowUp' || e.key==='ArrowDown')) {
      e.stopPropagation();
      e.preventDefault(); const step=(+t.dataset.step||1)*(e.shiftKey?10:1), n=Number(t.value.replace(',','.'))||0;
      t.value=fmt(Math.min(+t.dataset.max,Math.max(+t.dataset.min,n+(e.key==='ArrowUp'?step:-step))),+t.dataset.step);
      // Holding an arrow is one change: the slide updates when you pause, and undo takes it back in one step.
      clearTimeout(t._step); t._step=setTimeout(()=>{ t._step=null; commitNum(t); },320); return;
    }
    // Enter applies the value and stays in the field, its text selected for the next value.
    if(e.key==='Enter' && t.tagName==='INPUT' && t.type!=='color') { e.preventDefault(); e.stopPropagation();
      if(note?.key===t.dataset.field) { note=null; root.querySelector('.field-note')?.remove(); } t.removeAttribute('aria-invalid');
      if(t.hasAttribute('data-num')) commitNum(t); else if(t.value!==t.defaultValue) actions.field(t.dataset.field, t.value, t);
      if(t.getAttribute('aria-invalid')==='true') { t.select(); return; } // keep what was typed so it can be corrected
      t.defaultValue=t.value; t.dataset.committed=t.value; setTimeout(()=>{ if(latest) render(latest, true); },0); return; }
    // Esc on a panel control hands the keyboard back to the slide, selection kept.
    if(e.key==='Escape' && !helpOpen && t.matches('button,[role="treeitem"],h2')) { e.preventDefault(); e.stopPropagation(); actions.canvas?.(); return; }
    if(e.key==='Escape' && t.matches('input,select,textarea')) { e.preventDefault(); e.stopPropagation(); if(t.matches('input:not([type="color"])')) { t.value=t.defaultValue; t.removeAttribute('aria-invalid'); } note=null; t.blur(); actions.canvas?.(); return; }
    // Arrow keys move along a toolbar or the tree, Home/End jump to its ends.
    const row=t.closest?.('.toolrow:not(.split),.seg-group,.layer-list');
    if(row && t.matches('button') && ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(e.key)) {
      const list=Array.from(row.querySelectorAll(':scope > button:not([disabled])')), i=list.indexOf(t);
      const next=e.key==='Home'?0:e.key==='End'?list.length-1:i+(['ArrowLeft','ArrowUp'].includes(e.key)?-1:1);
      if(list[next]){e.preventDefault();e.stopPropagation();list.forEach(b=>b.tabIndex=-1);list[next].tabIndex=0;list[next].focus();if(list[next].getAttribute('role')==='radio')list[next].click();}
    }
  });
  // A pending arrow step commits after focus lands, like any Tab-out commit.
  root.addEventListener('blur',e=>{ const t=e.target; if(t._step){ clearTimeout(t._step); t._step=null; setTimeout(()=>commitNum(t),0); } },true);
  root.addEventListener('focusout',e=>{ const n=e.relatedTarget; nextFocus = n && root.contains(n) ? keyOf(n) : null; setTimeout(()=>{ if(latest && !root.contains(document.activeElement))render(latest); },0); });
  // Esc closes the help popover first, wherever keyboard focus happens to be.
  const closeHelp = () => { if (!helpOpen) return false; helpOpen = false; if (latest) render(latest); return true; };
  // After a stage reload, put keyboard focus back on the panel control that started it.
  const refocus = () => { if (!lastBack || Date.now() - lastBackAt > 3000) return false; const n = root.querySelector(lastBack); lastBack = null; if (!n || n.closest('[inert]')) return false; n.focus({ preventScroll: true }); return true; };
  // Before a stage reload started from the keyboard elsewhere (⌘Z in a field), keep the focused control.
  const disarm = () => { lastBack = null; focusRow = false; };
  const remember = () => { const a = document.activeElement; if (!root.contains(a)) { disarm(); return; } if (a.matches('[role="treeitem"]')) { focusRow = Date.now(); return; } lastBack = keyOf(a) || (a.matches('h2') ? '.ins-title h2' : null); lastBackAt = Date.now(); return lastBack; };
  // A click on the slide takes the keyboard: a changed field is committed to the object it was
  // showing first, so the edit never lands on the newly picked one.
  // The keyboard went to the slide: a pending "give focus back to the panel" no longer applies.
  const release = () => { disarm(); const a = document.activeElement; if (!root.contains(a)) return false; const changed = a.matches('select') ? !a.selectedOptions[0]?.defaultSelected : a.value !== a.defaultValue; if (a.matches('[data-field]:not(button)') && changed) { apply(a); a.dataset.committed = a.value; } a.blur(); return true; };
  return { render, flash, closeHelp, refocus, remember, release, disarm };
}
// Selection changes are announced politely for VoiceOver.
function liveRegion() {
  const el=document.createElement('div');el.className='sr-only';el.setAttribute('aria-live','polite');el.setAttribute('role','status');document.body.appendChild(el);
  let t=null;return text=>{clearTimeout(t);t=setTimeout(()=>{el.textContent=text;},120);};
}
const norm = v => String(v || '').replace(/\s+/g,'');
const clear = c => !c || c === 'transparent' || /^rgba\([^)]*,\s*0\)$/.test(c) || / \/ 0\)$/.test(c);
// rgb(20, 19, 15) → #14130F; keep anything translucent or named as written.
function readable(c) {
  const m = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/.exec(String(c || ''));
  return m ? '#' + m.slice(1).map(n => (+n).toString(16).padStart(2, '0')).join('').toUpperCase() : c;
}

// One floating tooltip for the inspector: quicker than native titles and
// never clipped by the scrolling panel. Keyboard focus shows it at once.
export function setupTips(root, isQuiet = () => false, announce) {
  const el=document.createElement('div');el.className='ins-tip';el.setAttribute('role','tooltip');el.hidden=true;document.body.appendChild(el);
  let timer=null,cur=null;
  const show=(t)=>{cur=t;el.innerHTML=t.dataset.tip;el.hidden=false;const r=t.getBoundingClientRect(),w=el.offsetWidth,h=el.offsetHeight;let x=r.left+r.width/2-w/2;x=Math.max(8,Math.min(innerWidth-w-8,x));let y=r.bottom+6;if(y+h>innerHeight-8 || (t.closest('.ins-head') && r.top-h-6>8 && root.querySelector('.ins-props > .note:first-child')))y=r.top-h-6;el.style.left=x+'px';el.style.top=y+'px';};
  const hide=()=>{if(Date.now()<flashUntil)return;clearTimeout(timer);el.hidden=true;cur=null;};
  root.addEventListener('pointerover',e=>{const t=e.target.closest('[data-tip]');if(!t||t===cur||root.querySelector('.field-note'))return;clearTimeout(timer);if(!el.hidden){show(t);return;}timer=setTimeout(()=>show(t),380);});
  root.addEventListener('pointerout',e=>{const t=e.target.closest('[data-tip]');if(t && !t.contains(e.relatedTarget))hide();});
  root.addEventListener('focusin',e=>{if(isQuiet() || root.querySelector('.field-note') || !e.target.matches('.ib,.crumbs button,.disclose,#insertbar button'))return;const t=e.target.closest('[data-tip]');if(t && e.target.matches(':focus-visible'))show(t);});
  root.addEventListener('focusout',hide);root.addEventListener('pointerdown',hide);root.addEventListener('scroll',hide,true);
  // A short message pinned to a field, for clamped or rejected values.
  let flashUntil=0;
  const flash=(t,msg)=>{flashUntil=Date.now()+2200;announce?.(msg);setTimeout(()=>{const f=document.querySelector(`[data-field="${t.dataset.field}"]:not([type="color"])`)||t,r=f.getBoundingClientRect();el.textContent=msg;el.hidden=false;el.style.left=Math.max(8,Math.min(innerWidth-el.offsetWidth-8,r.left))+'px';el.style.top=(r.bottom+6)+'px';clearTimeout(timer);timer=setTimeout(()=>{flashUntil=0;hide();},2200);},0);};
  // A tip whose control was rebuilt away (new deck, new selection) goes with it.
  const prune=()=>requestAnimationFrame(()=>{ if(cur && !cur.isConnected && Date.now()>=flashUntil){ el.hidden=true; cur=null; } });
  return {hide,flash,prune,flashing:()=>Date.now()<flashUntil};
}
function hex(color) {
  // Native color inputs accept hex; preserve arbitrary CSS values in the adjacent field.
  if (/^#[\da-f]{6}$/i.test(color || '')) return color;
  const canvas=document.createElement('canvas'); const ctx=canvas.getContext('2d');
  ctx.fillStyle='#f4f2ee'; try { ctx.fillStyle=color || '#f4f2ee'; } catch {}
  ctx.fillRect(0,0,1,1);const rgb=ctx.getImageData(0,0,1,1).data;
  return '#'+Array.from(rgb).slice(0,3).map(n=>n.toString(16).padStart(2,'0')).join('');
}
