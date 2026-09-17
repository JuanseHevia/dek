import { escapeHTML as esc } from './authoring.js';

// Rebuild only when focus is on the canvas; an active field must never lose its caret.
export function createInspector(root, actions) {
  let latest = null;
  const actionNames={bold:'Bold',italic:'Italic',underline:'Underline',strikeThrough:'Strikethrough'};
  const btn = (label, act, on, help='') => {
    const name=actionNames[act] || label;
    return `<button type="button" data-action="${act}" aria-label="${esc(name)}" title="${esc(help || name)}"${on===undefined?'':` aria-pressed="${on}"`}>${label}</button>`;
  };
  const number = (label, key, value, min = -10000, max = 10000, step = 1) => `<label>${label}<input aria-label="${label}" type="number" data-field="${key}" value="${Number.isFinite(+value) ? Math.round(+value*100)/100 : ''}" min="${min}" max="${max}" step="${step}"></label>`;
  const text = (label,key,value,extra='') => `<label>${label}<input aria-label="${label}" data-field="${key}" value="${esc(value)}" ${extra}></label>`;
  const select = (label,key,value,opts) => `<label>${label}<select aria-label="${label}" data-field="${key}">${opts.map(([v,l])=>`<option value="${v}" ${v===String(value)?'selected':''}>${l}</option>`).join('')}</select></label>`;
  const color = (label,key,value) => `<label class="color-field">${label}<div><input aria-label="${label} picker" type="color" data-field="${key}" value="${hex(value)}"><input aria-label="${label}" data-field="${key}" value="${esc(value || 'transparent')}" placeholder="#D9B65A or navy" title="Use a color name, hex code, or transparent"></div></label>`;
  const group = (name,body) => `<fieldset><legend>${name}</legend>${body}</fieldset>`;
  function render(data) {
    latest = data;
    if (root.contains(document.activeElement)) return;
    const { info:s, slide, title, layers=[] } = data;
    let html = `<header><h2>${s ? esc(s.kind === 'text' ? 'Text' : s.kind === 'shape' ? 'Shape' : s.kind === 'image' ? 'Image' : 'Object') : 'Slide'}</h2>${s ? '<button data-action="clear">Slide settings</button>' : '<span class="inspector-index">'+esc(slide?.number || '')+'</span>'}</header>`;
    if (!s) {
      html += group('Deck', text('Deck title','title',title));
      if (slide) {
        html += group('Slide', '<button class="wide-button" data-action="hideSlide">'+(slide.hidden?'Show slide':'Hide slide')+'</button><p class="field-hint">'+(slide.hidden?'Hidden: skipped when presenting and excluded from exports unless you include hidden slides.':'Hide this slide to skip it when presenting. You can still edit it.')+'</p>'+color('Slide background','slideBackground',slide.background) + select('Transition','transition',slide.transition,[['','Use deck transition'],...['fade','slide','rise','zoom','flip','none'].map(v=>[v,v==='none'?'No transition':v[0].toUpperCase()+v.slice(1)])]));
        html += group('Speaker notes',`<label class="notes-label"><span class="sr-only">Speaker notes</span><textarea aria-label="Speaker notes" data-field="notes" placeholder="What do you want to say?">${esc(slide.notes)}</textarea></label><p class="field-hint">Shown in presenter view and included in PowerPoint exports.</p>`);
      }
      html += '<p class="inspector-tip">Click an object to edit its appearance. Double-click text to edit its words. Shift-click to select more objects.</p>';
    } else {
      if(s.count>1)html+='<p class="field-hint">'+s.count+' objects selected. Font, color, size and appearance apply to all. Text emphasis and lists use the active text box.</p>';
      if(s.locked)html+='<p class="field-hint">This object is locked. Choose Unlock below to move or edit it.</p>';
      if (s.kind === 'text') {
        if(s.count<2)html += '<p class="field-hint">Select words to format just those words. Without a text selection, font, size and color apply to the whole text box.</p>';
        html += group('Text style',text('Font family','font-family',s.fontFamily,'list="dek-fonts"') + '<datalist id="dek-fonts">'+['Arial','Helvetica Neue','Georgia','Times New Roman','Verdana','Avenir Next','Menlo','system-ui'].map(f=>`<option value="${f}">`).join('')+'</datalist>' + '<div class="field-pair">'+number('Font size (px)','font-size',s.fontSize,1,500)+select('Font weight','font-weight',s.fontWeight,[['300','Light'],['400','Regular'],['500','Medium'],['600','Semibold'],['700','Bold'],['800','Heavy'],['900','Black']])+'</div>' + '<div class="inspector-seg">'+btn('<b>B</b>','bold',+s.fontWeight>=600)+btn('<i>I</i>','italic',s.fontStyle==='italic')+btn('<u>U</u>','underline',s.textDecoration?.includes('underline'))+btn('<s>S</s>','strikeThrough',s.textDecoration?.includes('line-through'))+'</div>'+color('Text color','color',s.color)+color('Text highlight','textHighlight',s.backgroundColor)+text('Link address','link',s.link || '', 'placeholder="https://…"'));
        html += group('Paragraph','<p class="field-hint">Alignment and line spacing affect the whole text box. Line spacing is a multiple of the font size.</p>'+select('Text alignment','text-align',s.textAlign,[['left','Left'],['center','Center'],['right','Right'],['justify','Justify'],['start','Start of line']])+'<div class="field-pair">'+number('Line spacing (×)','line-height',s.lineHeight,0.5,5,0.05)+number('Letter spacing (px)','letter-spacing',s.letterSpacing,-20,100,0.5)+'</div>'+select('Text case','text-transform',s.textTransform,[['none','As typed'],['uppercase','UPPERCASE'],['lowercase','lowercase'],['capitalize','Capitalize Words']])+'<div class="inspector-seg">'+btn('Bulleted list','insertUnorderedList')+btn('Numbered list','insertOrderedList')+'</div>');
      }
      if (s.kind === 'shape' || s.kind === 'block') html += group('Appearance',color('Fill color','background-color',s.backgroundColor)+color('Border color','border-color',s.borderColor)+'<div class="field-pair">'+number('Border width (px)','border-width',s.borderWidth,0,100)+number('Corner radius (px)','border-radius',s.borderRadius,0,1000)+'</div>');
      if (s.kind === 'image') html += group('Image','<button class="wide-button" data-action="replace">Replace image…</button>'+text('Image description','alt',s.alt || '', 'placeholder="Describe what the image shows"')+'<p class="field-hint">Describe the image for people using a screen reader.</p>'+select('Image fit','object-fit',s.objectFit,[['contain','Show entire image'],['cover','Fill frame (crop edges)'],['fill','Stretch to fit']])+select('Frame shape','cropRatio',s.objectFit==='cover'?(['1.7777777778','1.3333333333','1','0.75'].find(r=>Math.abs(s.width/s.height-Number(r))<.005)||''):'',[['','Current proportions'],['1.7777777778','16:9'],['1.3333333333','4:3'],['1','Square'],['0.75','Portrait 3:4']])+number('Corner radius (px)','border-radius',s.borderRadius,0,1000)+select('When resizing','aspect',s.aspect===false?'free':'locked',[['locked','Keep proportions'],['free','Resize width and height freely']])+'<p class="field-hint">Position within the frame: 0% left/top, 50% center, 100% right/bottom. Use Fill frame to crop.</p><div class="field-pair">'+number('Horizontal (%)','crop-x',parseFloat((s.objectPosition || '50% 50%').split(' ')[0]),0,100)+number('Vertical (%)','crop-y',parseFloat((s.objectPosition || '50% 50%').split(' ')[1]),0,100)+'</div>');
      html += group('Position & size','<p class="field-hint">Position from the slide’s top-left corner. Opacity: 0% invisible, 100% opaque.</p><div class="field-pair">'+number('Left (px)','x',s.geometry.x)+number('Top (px)','y',s.geometry.y)+number('Width (px)','width',s.width,1,10000)+number('Height (px)','height',s.height,1,10000)+number('Rotation (°)','rotate',s.rotate,-360,360)+number('Opacity (%)','opacity',s.opacity*100,0,100)+'</div>');
      html += group('Arrange','<div class="inspector-seg">'+btn('Send to back','back')+btn('Bring to front','front')+'</div><div class="inspector-seg">'+btn('Center horizontally','centerX',undefined,'Center on the slide horizontally; move the selection together')+btn('Center vertically','centerY',undefined,'Center on the slide vertically; move the selection together')+'</div><div class="inspector-seg">'+btn('Duplicate','duplicate')+btn('Delete','delete')+'</div><div class="inspector-seg">'+btn('Group','group',undefined,'Select at least two objects in the same container to group')+btn('Ungroup','ungroup',undefined,'Select a group to separate its objects')+btn(s.locked?'Unlock':'Lock','lock')+'</div><p class="field-hint">'+(s.count>1?'Align objects to the outer edges of this selection.':'Align this object to a slide edge.')+'</p><div class="inspector-seg">'+btn('Left','align-left')+btn('Right','align-right')+btn('Top','align-top')+btn('Bottom','align-bottom')+'</div><div class="inspector-seg">'+btn('Space horizontally','distribute-x',undefined,'Select at least three unlocked objects to make horizontal gaps equal')+btn('Space vertically','distribute-y',undefined,'Select at least three unlocked objects to make vertical gaps equal')+'</div><div class="inspector-seg">'+btn('Snap to grid','snap',data.snapping,'Align dragged objects to an 8 px grid. Hold Option to move freely.')+'</div>');
    }
    if (layers.length) html += group('Objects on this slide',`<p class="field-hint">Click to select. Shift-click to add to the selection.</p><div class="layer-list">${layers.map(l=>`<button data-layer="${esc(JSON.stringify(l.path))}" class="${JSON.stringify(s?.path)===JSON.stringify(l.path)?'current':''}"><span>${l.locked?'▣ ':''}${esc(l.label)}</span><small>${esc(l.kind==='block'?'object':l.kind)}</small></button>`).join('')}</div>`);
    root.innerHTML = html;
  }
  root.addEventListener('pointerdown', e => { if (e.target.closest('input,select,button')) actions.capture(); });
  root.addEventListener('mousedown', e => { if (e.target.closest('button')) e.preventDefault(); });
  root.addEventListener('click',e=>{
    const layer=e.target.closest('[data-layer]');
    if(layer) { actions.select(JSON.parse(layer.dataset.layer),e.shiftKey || e.metaKey); return; }
    const b=e.target.closest('[data-action]'); if(b) actions.action(b.dataset.action);
  });
  root.addEventListener('change',e=>{
    const f=e.target.closest('[data-field]'); if(!f)return;
    if(f.type==='number' && (!f.validity.valid || f.value==='')) { f.reportValidity(); return; }
    actions.field(f.dataset.field, f.type==='number' ? Number(f.value) : f.value, f);
  });
  root.addEventListener('keydown',e=>{ if(e.key==='Enter' && e.target.tagName==='INPUT') e.target.blur(); });
  root.addEventListener('focusout',()=>setTimeout(()=>{ if(latest)render(latest); },0));
  return { render };
}
function hex(color) {
  // Native color inputs accept hex; preserve arbitrary CSS values in the adjacent field.
  if (/^#[\da-f]{6}$/i.test(color || '')) return color;
  const canvas=document.createElement('canvas'); const ctx=canvas.getContext('2d');
  ctx.fillStyle='#f4f2ee'; try { ctx.fillStyle=color || '#f4f2ee'; } catch {}
  ctx.fillRect(0,0,1,1);const rgb=ctx.getImageData(0,0,1,1).data;
  return '#'+Array.from(rgb).slice(0,3).map(n=>n.toString(16).padStart(2,'0')).join('');
}
