// Source-side operations shared by direct manipulation and MCP. Never serialize
// the rendered slide: charts, fragments and editor handles belong to the runtime.
import { sectionElement, parseDeck, replaceSlide, insertSlide, removeSlide, normalizeSection, withNewId, setHeadInner, componentRanges } from './deck.js';
const uid = (prefix='el') => `${prefix}-${crypto.randomUUID()}`;
export const pathTarget = path => ':scope'+path.map(n=>` > :nth-child(${n+1})`).join('');
export function transferHead(model) {
  const inHead=new Set(componentRanges(model.headInner).map(c=>c.name));
  return model.headInner+componentRanges(model.raw).filter(c=>!inHead.has(c.name)).map(c=>'\n'+model.raw.slice(c.start,c.end)).join('');
}
export function freshSlide(html, taken=[]) {
  const original=sectionElement(html);const sec=sectionElement(withNewId(html,taken)),ids=new Map(original?.id?[[original.id,sec.id]]:[]);
  for(const n of sec.querySelectorAll('[id]')) { const old=n.id,next=uid('object');ids.set(old,next);n.id=next; }
  for(const n of sec.querySelectorAll('*')) {
    if(n.dataset.dekId)n.dataset.dekId=uid();
    for(const a of Array.from(n.attributes)) {
      if(['href','xlink:href'].includes(a.name) && ids.has(a.value.slice(1)) && a.value.startsWith('#'))n.setAttribute(a.name,'#'+ids.get(a.value.slice(1)));
      else if(a.value.includes('url('))n.setAttribute(a.name,a.value.replace(/url\(\s*(['"]?)#([^\s)'" ]+)\1\s*\)/g,(all,q,id)=>ids.has(id)?`url(${q}#${ids.get(id)}${q})`:all));
      else if(['aria-labelledby','aria-describedby'].includes(a.name))n.setAttribute(a.name,a.value.split(/\s+/).map(id=>ids.get(id)||id).join(' '));
    }
    if(n.tagName.toLowerCase()==='style') n.textContent=n.textContent.replace(/#([\w-]+)/g,(all,id)=>ids.has(id)?'#'+ids.get(id):all);
  }
  return sec.outerHTML;
}
export function ensureObjectIds(raw) {
  const m=parseDeck(raw);let result=raw;const seen=new Set();
  for(const s of [...m.slides].reverse()) {
    const sec=sectionElement(s.html);let changed=false;
    for(const el of sec.querySelectorAll('*')) {
      if(el.closest('aside.notes,script,style,template'))continue;
      const id=el.dataset.dekId;
      if(!id || seen.has(id)){el.dataset.dekId=uid();changed=true;}
      seen.add(el.dataset.dekId);
    }
    if(changed)result=result.slice(0,s.start)+sec.outerHTML+result.slice(s.end);
  }
  return result;
}
export function reorderSections(model, sections) {
  const meta=documentMeta(model);meta.sections=sections;
  const known=new Set(sections.map(g=>g.id));
  const order=[...model.slides.filter(s=>!known.has(s.section)),...sections.flatMap(g=>model.slides.filter(s=>s.section===g.id))];
  let raw=model.raw;
  for(let i=model.slides.length-1;i>=0;i--){const r=model.slides[i];raw=raw.slice(0,r.start)+order[i].html+raw.slice(r.end);}
  return setDocumentMeta(parseDeck(raw),meta);
}
export function copySlidesInto(model, payload, at=model.slides.length) {
  let html=payload.html || '',head=payload.head || '',m=model;
  const existing=componentRanges(m.raw),incoming=componentRanges('<html><head>'+head+'</head><body></body></html>');
  const names=new Map(incoming.map(c=>[c.name,existing.some(e=>e.name===c.name && e.html!==c.html)?c.name+'-'+crypto.randomUUID().slice(0,8):c.name]));
  const remap=text=>text.replace(/(data-dek-use\s*=\s*["'])([^"']+)(["'])/gi,(all,a,n,b)=>a+(names.get(n)||n)+b);
  html=remap(html);
  for(const c of incoming){const name=names.get(c.name);if(!existing.some(e=>e.name===name))m=parseDeck(setHeadInner(m,m.headInner+`\n<template data-dek-component="${name}">${remap(c.html)}</template>`));}
  // Carry executable component libraries and explicitly scoped dependencies;
  // the destination still owns global typography, colors and layout defaults.
  const sourceHead=new DOMParser().parseFromString('<html><head>'+head+'</head><body></body></html>','text/html');
  const destinationHead=new DOMParser().parseFromString(m.raw,'text/html');
  const dependencies=Array.from(sourceHead.querySelectorAll('head > script[src],head > [data-dek-dependency]'));
  for(const node of dependencies) {
    if(node.matches('template') || node.getAttribute('src')?.includes('dek-runtime'))continue;
    const key=node.getAttribute('src') || node.getAttribute('data-dek-dependency');
    if(Array.from(destinationHead.querySelectorAll('head > script[src],head > [data-dek-dependency]')).some(n=>(n.getAttribute('src') || n.getAttribute('data-dek-dependency'))===key))continue;
    m=parseDeck(setHeadInner(m,m.headInner+'\n'+remap(node.outerHTML)));
  }
  const imported=parseDeck('<html><body>'+html+'</body></html>');
  for(const s of imported.slides){const sec=sectionElement(freshSlide(s.html,m.slides.map(s=>s.id)));sec.removeAttribute('data-dek-section');m=parseDeck(insertSlide(m,sec.outerHTML,at++));}
  return m.raw;
}
export function nodeAt(sec, target) {
  if (Array.isArray(target)) return target.reduce((el,n)=>el?.children[n],sec);
  if (target === ':scope' || target === 'section') return sec;
  try { return sec.querySelector(target); } catch { throw new Error('Invalid element selector'); }
}
export function elementOperations(html, operations) {
  const sec=sectionElement(html);
  if (!sec) throw new Error('No slide to edit');
  for (const op of operations) {
    const targets=(op.targets || [op.target]).map(t=>nodeAt(sec,t));
    if(targets.some(n=>!n)) throw new Error('The selected element changed. Select it again.');
    if(targets.some(n=>n===sec) && !['style','attrs','insert','update'].includes(op.type)) throw new Error('Use slide tools to change slides');
    if(targets.some(n=>n.closest('[data-dek-locked]')) && op.type!=='lock') throw new Error('Unlock the element before editing it');
    for(const el of targets) if(el!==sec && !el.dataset.dekId) el.dataset.dekId=uid();
    const el=targets[0];
    if(op.type==='style') for(const n of targets) for(const [k,v] of Object.entries(op.style)) { if(v===null || v==='') n.style.removeProperty(k); else n.style.setProperty(k,String(v)); }
    else if(op.type==='attrs') for(const n of targets) for(const [k,v] of Object.entries(op.attrs)) { if(v===null) n.removeAttribute(k); else n.setAttribute(k,String(v)); }
    else if(op.type==='text') el.innerHTML=op.html;
    else if(op.type==='delete') targets.forEach(n=>n.remove());
    else if(op.type==='lock') targets.forEach(n=>n.toggleAttribute('data-dek-locked',!!op.locked));
    else if(op.type==='insert') {
      const t=document.createElement('template'); t.innerHTML=op.html;
      for(const n of t.content.querySelectorAll('[data-dek-id]')) n.removeAttribute('data-dek-id');
      for(const n of t.content.children) n.dataset.dekId=uid();
      const position=op.position || 'append';
      if(el===sec && ['before','after','replace'].includes(position))throw new Error('Use slide tools to replace slides');
      if(!['append','prepend','before','after','replace'].includes(position))throw new Error('Invalid insertion position');
      if(position==='replace')el.replaceWith(t.content);else el[position](t.content);
    } else if(op.type==='update') {
      for(const n of targets) {
        if(n===sec && op.html!==undefined)throw new Error('Use update_slide to replace the slide');
        if(op.html!==undefined){const t=document.createElement('template');t.innerHTML=op.html;n.replaceWith(t.content);continue;}
        if(op.inner!==undefined)n.innerHTML=op.inner;
        if(op.text!==undefined)n.textContent=op.text;
        for(const [k,v] of Object.entries(op.attrs || {})) {if(v===null || v===false)n.removeAttribute(k);else n.setAttribute(k,String(v));}
        for(const [k,v] of Object.entries(op.style || {})) {if(v===null || v==='')n.style.removeProperty(k);else n.style.setProperty(k,String(v));}
        if(op.add_class)n.classList.add(...op.add_class.split(/\s+/).filter(Boolean));
        if(op.remove_class)n.classList.remove(...op.remove_class.split(/\s+/).filter(Boolean));
      }
    } else if(op.type==='group') {
      if(targets.length<2 || targets.some(n=>n.parentElement!==el.parentElement)) throw new Error('Group elements from the same container');
      const g=document.createElement('div'); g.className='dek-group dek-atomic'; g.dataset.dekId=uid('group');
      g.style.cssText=`position:absolute;left:${op.box.x}px;top:${op.box.y}px;width:${op.box.w}px;height:${op.box.h}px;`;
      el.before(g);
      targets.forEach((n,i)=>{ n.style.cssText += `;position:absolute;left:${op.positions[i].x-op.box.x}px;top:${op.positions[i].y-op.box.y}px;width:${op.positions[i].w}px;height:${op.positions[i].h}px;margin:0;translate:none;`; g.append(n); });
    } else if(op.type==='ungroup') {
      if(!el.matches('.dek-group')) throw new Error('Select a group first');
      if(!op.positions || op.positions.length!==el.children.length) throw new Error('Group geometry is required');
      Array.from(el.children).forEach((n,i)=>{ const r=op.positions[i]; n.style.cssText += `;position:absolute;left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px;margin:0;translate:none;${r.rotate===undefined?'':`rotate:${r.rotate}deg;`}`; el.before(n); }); el.remove();
    } else if(op.type==='retag') {
      if(!/^(h[1-6]|p|blockquote|div)$/.test(op.tag)) throw new Error('Unsupported text type');
      const n=document.createElement(op.tag); for(const a of el.attributes)n.setAttribute(a.name,a.value); n.innerHTML=el.innerHTML; el.replaceWith(n);
    } else if(!['style','attrs','text','delete','lock','insert','group','ungroup','retag'].includes(op.type)) throw new Error(`Unknown edit: ${op.type}`);
  }
  return sec.outerHTML;
}
export function documentMeta(model) {
  const doc=new DOMParser().parseFromString(model.raw,'text/html');
  try { const data=JSON.parse(doc.getElementById('dek-metadata')?.textContent || '{}'); return { version:1, sections:[], ...data }; } catch { throw new Error('Deck organization metadata is invalid JSON'); }
}
export function setDocumentMeta(model,data) {
  const marker=/<script\b(?=[^>]*\bid=["']dek-metadata["'])[^>]*>[\s\S]*?<\/script>/i;
  const block=`<script id="dek-metadata" type="application/json">${JSON.stringify(data).replace(/</g,'\\u003c')}</script>`;
  return setHeadInner(model, marker.test(model.headInner)?model.headInner.replace(marker,block):model.headInner+'\n'+block+'\n');
}
export function slideOperations(model, indices, action, options={}) {
  const selected=[...new Set(indices)].sort((a,b)=>a-b);
  if(!selected.length || selected.some(i=>!model.slides[i])) throw new Error('Select at least one valid slide');
  let m=model;
  if(action==='hide' || action==='show') {
    for(const i of selected) { const sec=sectionElement(m.slides[i].html); sec.toggleAttribute('data-dek-skip',action==='hide'); sec.removeAttribute('data-deck-skip'); m=parseDeck(replaceSlide(m,i,sec.outerHTML)); }
  } else if(action==='delete') {
    for(const i of [...selected].reverse()) m=parseDeck(removeSlide(m,i));
  } else if(action==='duplicate') {
    let at=selected[selected.length-1]+1;
    for(const i of selected) { const copy=freshSlide(model.slides[i].html,m.slides.map(s=>s.id));m=parseDeck(insertSlide(m,copy,at++)); }
  } else if(action==='move') {
    const selectedSet=new Set(selected), order=model.slides.map((s,i)=>i).filter(i=>!selectedSet.has(i));
    const at=Math.max(0,Math.min(order.length,Number(options.to)||0)); order.splice(at,0,...selected);
    // Refill only slide ranges. Inter-slide comments/scripts remain untouched.
    let raw=model.raw;
    for(let i=model.slides.length-1;i>=0;i--) { const range=model.slides[i]; raw=raw.slice(0,range.start)+model.slides[order[i]].html+raw.slice(range.end); }
    return raw;
  } else if(action==='section') {
    for(const i of selected) { const sec=sectionElement(m.slides[i].html); if(options.id)sec.dataset.dekSection=options.id; else sec.removeAttribute('data-dek-section'); m=parseDeck(replaceSlide(m,i,sec.outerHTML)); }
  } else throw new Error('Unknown slide action');
  if(action==='section' && options.id){const remaining=m.slides.filter(s=>!selected.includes(s.index)),last=remaining.findLastIndex(s=>s.section===options.id);if(last>=0)return slideOperations(m,selected,'move',{to:last+1});}
  return m.raw;
}
