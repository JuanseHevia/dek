import { buildDocument } from './stage.js';
export { exportSummary, writePowerPoint } from './pptx.js';

export function exportManifest(model, options={}, baseHref='') {
  const indices=model.slides.filter(s=>options.includeHidden || !s.skip).map(s=>s.index);
  if(!indices.length)throw new Error('There are no visible slides to export. Show a slide or include hidden slides.');
  const lang=(model.htmlAttrs || '').match(/\blang\s*=\s*["']?([A-Za-z]{2,3}(?:-[A-Za-z0-9]+)*)/)?.[1];
  return {title:model.meta.title || 'Deck',lang:lang || 'en-US',size:model.meta.size,indices,titles:indices.map(i=>model.slides[i].title+(model.slides[i].skip?" (hidden)":"")),notes:indices.map(i=>model.slides[i].notes),html:buildDocument(model,{static:true,step:'last',baseHref,transition:'none'})};
}

// This function is serialized into the isolated WebKit renderer. It must be self-contained.
// It turns one rendered slide into native nodes for PowerPoint. The target is Google Slides'
// PowerPoint import, so every element becomes a native object when it can be approximated:
// containers never turn into pictures because of their own styling. Only leaf visuals
// (SVG, canvas, charts, tables…) are captured as images.
export async function inspectExportSlide(index, step='last') {
  if(!window.dek)throw new Error('Slide renderer did not start');
  let exportStyle=document.getElementById('dek-export-only');
  if(!exportStyle){exportStyle=document.createElement('style');exportStyle.id='dek-export-only';exportStyle.textContent='.dek-slide:not([data-dek-export-active]){display:none!important}';document.head.append(exportStyle);}
  document.querySelectorAll('.dek-slide').forEach((s,i)=>s.toggleAttribute('data-dek-export-active',i===index));
  window.dek.go(index,step,{instant:true});
  await document.fonts.ready;
  const sec=document.querySelectorAll('.dek-slide')[index];
  if(!sec)throw new Error('Slide is missing');
  sec.setAttribute('data-deck-active','');sec.setAttribute('data-dek-active','');
  const imgs=Array.from(sec.querySelectorAll('img'));
  await Promise.all(imgs.map(img=>img.decode().catch(()=>{throw new Error(`Image could not load: ${img.getAttribute('src')}`);})));
  const backgrounds=new Set();
  for(const el of [sec,...sec.querySelectorAll('*')])for(const key of ['backgroundImage','maskImage','borderImageSource'])for(const match of getComputedStyle(el)[key]?.matchAll(/url\(["']?([^"')]+)["']?\)/g) || [])backgrounds.add(match[1]);
  await Promise.all([...backgrounds].map(src=>new Promise((resolve,reject)=>{const img=new Image();img.onload=resolve;img.onerror=()=>reject(new Error('Background image could not load: '+src));img.src=src;})));
  const failedFonts=[...document.fonts].filter(f=>f.status==='error');if(failedFonts.length)throw new Error('Font could not load: '+failedFonts.map(f=>f.family).join(', '));
  for(const anim of document.getAnimations()){try{if(anim.effect.getTiming().iterations===Infinity)anim.pause();else anim.finish();}catch{anim.cancel();}}
  await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));

  const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const ctx=canvas.getContext('2d',{willReadFrequently:true});
  const rgba=value=>{ctx.clearRect(0,0,1,1);ctx.fillStyle='rgba(0,0,0,0)';ctx.fillStyle=value;ctx.fillRect(0,0,1,1);return Array.from(ctx.getImageData(0,0,1,1).data);};
  const color=value=>{const c=rgba(value);return {color:c.slice(0,3).map(v=>v.toString(16).padStart(2,'0')).join(''),transparency:Math.round((1-c[3]/255)*100)};};
  const px=v=>parseFloat(v)||0;
  const origin=sec.getBoundingClientRect(),scale=window.dek.zoom(),nodes=[],warnings=[];
  const warn=(kind,detail)=>warnings.push({kind,detail});
  const LEAF='svg,canvas,video,iframe,object,embed,table,pre,math,.dek-chart,[data-dek-use],.dek-scene,.dek-cube';
  const SKIP='.notes,.dek-sel,.dek-hover,script,style,template,noscript';
  const label=el=>el.tagName.toLowerCase()+(el.classList[0]?'.'+el.classList[0]:'');
  function box(el){const r=el.getBoundingClientRect();return{x:(r.x-origin.x)/scale,y:(r.y-origin.y)/scale,w:r.width/scale,h:r.height/scale};}
  function len(v,ref){return typeof v==='string' && v.trim().endsWith('%')?px(v)*ref/100:px(v);}

  // Gradients cannot be written by the PowerPoint library; use the color at the gradient's midpoint.
  function gradientMid(image){
    const g=image.match(/(?:repeating-)?(?:linear|radial|conic)-gradient\((.*)\)/);if(!g)return null;
    const stops=[...g[1].matchAll(/(rgba?\([^)]*\)|#[0-9a-f]{3,8}\b|transparent)(?:\s+(-?[\d.]+)%)?/gi)].map(m=>({c:rgba(m[1]),p:m[2]==null?null:+m[2]}));
    if(!stops.length)return null;if(stops.length===1)return `rgba(${stops[0].c.slice(0,3).join(',')},${stops[0].c[3]/255})`;
    if(stops[0].p==null)stops[0].p=0;if(stops[stops.length-1].p==null)stops[stops.length-1].p=100;
    for(let i=1;i<stops.length-1;i++)if(stops[i].p==null){let j=i;while(stops[j].p==null)j++;const a=stops[i-1].p,b=stops[j].p;for(let k=i;k<j;k++)stops[k].p=a+(b-a)*(k-i+1)/(j-i+1);}
    let i=stops.findIndex(s=>s.p>=50);if(i<=0)i=i<0?stops.length-1:1;
    const A=stops[i-1],B=stops[i],t=B.p===A.p?0:Math.min(1,Math.max(0,(50-A.p)/(B.p-A.p)));
    const c=A.c.map((v,k)=>Math.round(v+(B.c[k]-v)*t));
    return `rgba(${c[0]},${c[1]},${c[2]},${c[3]/255})`;
  }
  function shadowOf(cs,where){
    if(!cs.boxShadow || cs.boxShadow==='none')return null;
    const layers=cs.boxShadow.split(/,(?![^(]*\))/).map(s=>s.trim());const outer=layers.filter(l=>!/\binset\b/.test(l));
    if(layers.length>1)warn('shadow-simplified',where);
    const layer=outer[0];if(!layer)return null;
    const c=(layer.match(/rgba?\([^)]*\)|#[0-9a-f]{3,8}\b/i)||['rgba(0,0,0,0.3)'])[0];
    const [x=0,y=0,blur=0]=layer.replace(c,'').trim().split(/\s+/).map(parseFloat);const col=color(c);
    if(col.transparency>=100)return null;
    return {x,y,blur,color:col.color,opacity:(100-col.transparency)/100};
  }
  function transformOf(cs){
    const t=cs.transform;if(!t || t==='none')return {ok:true,rot:0,sx:1,sy:1};
    if(t.startsWith('matrix3d'))return {ok:false};
    const [a,b,c,d]=t.slice(t.indexOf('(')+1,-1).split(',').map(parseFloat);
    if(Math.abs(a*c+b*d)>1e-3)return {ok:false};
    return {ok:true,rot:Math.atan2(b,a)*180/Math.PI,sx:Math.hypot(a,b),sy:Math.hypot(c,d)};
  }
  function radiusOf(cs,r){return Math.max(0,len(cs.borderTopLeftRadius,Math.min(r.w,r.h)));}
  function shapeOf(cs,r){const rad=radiusOf(cs,r);if(rad<=0)return 'rectangle';if(rad>=Math.min(r.w,r.h)/2-.5 && Math.abs(r.w-r.h)<1)return 'ellipse';return 'rounded';}

  function rasterLeaf(el,r,kind){
    // Only the part inside the slide is visible; capturing beyond it adds blank canvas.
    const W=origin.width/scale,H=origin.height/scale,x0=Math.max(0,r.x),y0=Math.max(0,r.y),x1=Math.min(W,r.x+r.w),y1=Math.min(H,r.y+r.h);
    r={x:x0,y:y0,w:x1-x0,h:y1-y0};
    if(r.w<=0 || r.h<=0)return;
    const s=Math.min(r.w<200 && r.h<200?4:2,4000/Math.max(r.w,r.h));
    nodes.push({type:'image',...r,rotate:0,opacity:1,scale:s,capture:{x:origin.x+r.x*scale,y:origin.y+r.y*scale,w:r.w*scale,h:r.h*scale}});
    warn(kind||'raster',label(el));
  }
  function bytesToDataUrl(buf){
    const b=new Uint8Array(buf);let mime=null;
    if(b[0]===0x89 && b[1]===0x50)mime='image/png';else if(b[0]===0xff && b[1]===0xd8)mime='image/jpeg';else if(b[0]===0x47 && b[1]===0x49)mime='image/gif';
    if(!mime || (mime==='image/jpeg' && jpegOrientation(b)>1))return null;
    let s='';for(let i=0;i<b.length;i+=0x8000)s+=String.fromCharCode.apply(null,b.subarray(i,i+0x8000));
    return `data:${mime};base64,${btoa(s)}`;
  }
  function jpegOrientation(b){
    for(let i=2;i+9<b.length && b[i]===0xff;){const marker=b[i+1],size=(b[i+2]<<8)|b[i+3];
      if(marker===0xe1 && b[i+4]===0x45 && b[i+5]===0x78){const t=i+10,le=b[t]===0x49,u16=o=>le?b[o]|(b[o+1]<<8):(b[o]<<8)|b[o+1],u32=o=>le?(b[o]|(b[o+1]<<8)|(b[o+2]<<16)|(b[o+3]<<24))>>>0:((b[o]<<24)|(b[o+1]<<16)|(b[o+2]<<8)|b[o+3])>>>0;
        const ifd=t+u32(t+4),n=u16(ifd);for(let k=0;k<n;k++){const e=ifd+2+k*12;if(u16(e)===0x0112)return u16(e+8);}return 1;}
      if(marker===0xda)break;i+=2+size;}
    return 1;
  }
  function readBytes(src){return new Promise((resolve,reject)=>{const x=new XMLHttpRequest();x.open('GET',src);x.responseType='arraybuffer';x.onload=()=>(x.status===200 || x.status===0) && x.response?.byteLength?resolve(x.response):reject(new Error('empty'));x.onerror=()=>reject(new Error('unreadable'));x.send();});}
  async function redraw(src,w,h,photo){const img=new Image();img.src=src;await img.decode();const c=document.createElement('canvas');c.width=Math.max(1,Math.round(w || img.naturalWidth));c.height=Math.max(1,Math.round(h || img.naturalHeight));c.getContext('2d').drawImage(img,0,0,c.width,c.height);return {url:photo?c.toDataURL('image/jpeg',.92):c.toDataURL('image/png'),w:c.width,h:c.height};}
  // Original bytes when PowerPoint can hold them (PNG, JPEG, GIF); SVG and other formats are
  // redrawn at 2-4x the size they occupy on the slide.
  async function loadAsset(src,r,natural){
    if(!src)return null;
    const svg=/^data:image\/svg/i.test(src) || /\.svg(?:[?#]|$)/i.test(src);
    const s=Math.min(r.w<200 && r.h<200?4:2,4000/Math.max(r.w,r.h));
    if(svg)return redraw(src,r.w*s,r.h*s);
    try{const url=src.startsWith('data:')?(/^data:image\/(png|jpe?g|gif)/i.test(src)?src:null):bytesToDataUrl(await readBytes(src));if(url)return {url,w:natural.w,h:natural.h};}catch{}
    return redraw(src,natural.w,natural.h,/\.jpe?g(?:[?#]|$)/i.test(src) || /^data:image\/jpe?g/i.test(src));
  }
  async function imageNode(el,r,rot,alpha){
    const cs=getComputedStyle(el);
    if(cs.filter!=='none'){rasterLeaf(el,box(el),'raster');return;}
    let asset=null;try{asset=await loadAsset(el.currentSrc || el.src,r,{w:el.naturalWidth,h:el.naturalHeight});}catch{}
    if(!asset){rasterLeaf(el,box(el),'raster');return;}
    nodes.push({type:'image',...r,rotate:rot,opacity:alpha,data:asset.url,natural:{w:el.naturalWidth || asset.w,h:el.naturalHeight || asset.h},fit:cs.objectFit,position:cs.objectPosition,round:shapeOf(cs,r)==='ellipse'});
  }

  // Background, border and shadow of any element, as native shapes under its content.
  async function paint(el,cs,r,rot,alpha){
    let fill=color(cs.backgroundColor);const image=cs.backgroundImage && cs.backgroundImage!=='none'?cs.backgroundImage:'';
    const mid=image && !/text/.test(cs.backgroundClip || cs.webkitBackgroundClip || '')?gradientMid(image):null;
    if(mid){const m=color(mid);if(m.transparency<100)fill=m;warn('gradient-flattened',label(el));}
    const url=image.match(/url\(["']?([^"')]+)["']?\)/)?.[1];
    const widths=['Top','Right','Bottom','Left'].map(s=>cs[`border${s}Style`]==='none' || cs[`border${s}Style`]==='hidden'?0:px(cs[`border${s}Width`]));
    const uniform=widths.every(w=>w===widths[0]) && ['Right','Bottom','Left'].every(s=>cs[`border${s}Color`]===cs.borderTopColor);
    const shadow=shadowOf(cs,label(el));
    if(el===sec){
      background=fill.transparency<100?fill:background;
      if(url){try{const asset=await loadAsset(url,r,await naturalOf(url));nodes.push({type:'image',...r,rotate:0,opacity:alpha,data:asset.url,natural:{w:asset.w,h:asset.h},fit:bgFit(cs),position:cs.backgroundPosition});}catch{warn('raster','slide background image');}}
      return;
    }
    const line=uniform && widths[0]>0?{...color(cs.borderTopColor),width:widths[0]}:null;
    if(fill.transparency<100 || line || shadow)nodes.push({type:'shape',shape:shapeOf(cs,r),...r,fill,line,radius:radiusOf(cs,r),rotate:rot,opacity:alpha,shadow});
    if(url){try{const asset=await loadAsset(url,r,await naturalOf(url));nodes.push({type:'image',...r,rotate:rot,opacity:alpha,data:asset.url,natural:{w:asset.w,h:asset.h},fit:bgFit(cs),position:cs.backgroundPosition});}catch{warn('raster','background image of '+label(el));}}
    // Accent borders on some sides only (a bar on the left of a card) become thin rectangles.
    if(!uniform)[['Top',0],['Right',1],['Bottom',2],['Left',3]].forEach(([s,i])=>{const w=widths[i];if(!w)return;const c=color(cs[`border${s}Color`]);if(c.transparency>=100)return;
      const b=i===0?{x:r.x,y:r.y,w:r.w,h:w}:i===1?{x:r.x+r.w-w,y:r.y,w,h:r.h}:i===2?{x:r.x,y:r.y+r.h-w,w:r.w,h:w}:{x:r.x,y:r.y,w,h:r.h};
      nodes.push({type:'shape',shape:'rectangle',...b,fill:c,line:null,radius:0,rotate:0,opacity:alpha});});
  }
  function naturalOf(src){return new Promise(resolve=>{const i=new Image();i.onload=()=>resolve({w:i.naturalWidth,h:i.naturalHeight});i.onerror=()=>resolve({w:0,h:0});i.src=src;});}
  function bgFit(cs){const s=cs.backgroundSize;return s==='cover'?'cover':s==='contain'?'contain':'fill';}

  function pseudo(el,p){const pcs=getComputedStyle(el,p);const c=pcs.content;if(!c || c==='none' || c==='normal')return null;const m=c.match(/^"((?:[^"\\]|\\.)*)"$/);return {pcs,text:m?m[1].replace(/\\(.)/g,'$1'):null,absolute:/absolute|fixed/.test(pcs.position)};}
  function paints(pcs){return color(pcs.backgroundColor).transparency<100 || (pcs.backgroundImage && pcs.backgroundImage!=='none') || px(pcs.borderTopWidth)>0;}
  // A pseudo-element has no box of its own to measure: stand a real span with its computed style
  // in its place (the pseudo hidden meanwhile), measure it, then remove it. Works in flex, grid
  // and absolute layouts alike.
  let probeStyle=null;
  function pseudoRect(el,p,ps){
    if(!probeStyle){probeStyle=document.createElement('style');probeStyle.textContent='.dek-probe-before::before,.dek-probe-after::after{display:none!important}';document.head.append(probeStyle);}
    const span=document.createElement('span');const pcs=ps.pcs;
    for(let i=0;i<pcs.length;i++){const k=pcs[i];if(k!=='content')span.style.setProperty(k,pcs.getPropertyValue(k));}
    if(ps.text)span.textContent=ps.text;
    const cls=p==='::before'?'dek-probe-before':'dek-probe-after';el.classList.add(cls);
    if(p==='::before')el.prepend(span);else el.append(span);
    const b=box(span);span.remove();el.classList.remove(cls);
    return b;
  }
  // Decorative ::before/::after boxes (bars, dots, list squares) become shapes; text ones inside a
  // text box join its runs, and absolute text ones become their own text box.
  async function pseudoBox(el,cs,r,p,alpha,inRuns){
    const ps=pseudo(el,p);if(!ps)return;
    const {pcs}=ps;const where=`${label(el)}${p}`;
    if(pcs.display==='none' || (!paints(pcs) && !ps.text) || (inRuns && !ps.absolute && !paints(pcs)))return;
    const b=pseudoRect(el,p,ps);
    if(!(b.w>0 && b.h>0)){warn('pseudo-omitted',where);return;}
    let fill=color(pcs.backgroundColor);
    const mid=pcs.backgroundImage && pcs.backgroundImage!=='none'?gradientMid(pcs.backgroundImage):null;if(mid){fill=color(mid);warn('gradient-flattened',where);}
    const line=px(pcs.borderTopWidth)>0 && pcs.borderTopStyle!=='none'?{...color(pcs.borderTopColor),width:px(pcs.borderTopWidth)}:null;
    const a=alpha*(+pcs.opacity);
    if(fill.transparency<100 || line)nodes.push({type:'shape',shape:shapeOf(pcs,b),...b,fill,line,radius:radiusOf(pcs,b),rotate:0,opacity:a,shadow:shadowOf(pcs,where)});
    if(ps.text && (ps.absolute || !inRuns))nodes.push({type:'text',...b,runs:[run(ps.text,pcs,el)],align:'left',valign:'middle',fontSize:px(pcs.fontSize),lineHeight:lineHeight(pcs),margin:[0,0,0,0],rotate:0,opacity:a,singleLine:true});
  }

  const INLINE=/^inline/;
  function inlineOnly(el){for(const c of el.children){if(c.tagName==='BR')continue;const d=getComputedStyle(c).display;if(d==='none' || c.matches(SKIP))continue;if(!INLINE.test(d) || c.matches(LEAF+',img'))return false;if(!inlineOnly(c))return false;}return true;}
  function isList(el){return el.matches('ul,ol') && el.children.length>0 && [...el.children].every(li=>li.tagName==='LI' && getComputedStyle(li).display==='list-item' && inlineOnly(li));}
  function lineHeight(cs){return cs.lineHeight==='normal'?px(cs.fontSize)*1.2:px(cs.lineHeight);}
  // Text clipped to a gradient (background-clip:text) has a transparent color; use the gradient's midpoint.
  function textColor(cs,node,root){
    const c=color(cs.color);if(c.transparency<100)return c.color;
    for(let e=node;e && e!==root.parentElement;e=e.parentElement){const s=getComputedStyle(e);if(/text/.test(s.backgroundClip || s.webkitBackgroundClip || '')){const m=gradientMid(s.backgroundImage);if(m)return color(m).color;}}
    return c.color;
  }
  function transformText(text,cs){if(!cs.whiteSpace.startsWith('pre'))text=text.replace(/\s+/g,' ');if(cs.textTransform==='uppercase')return text.toUpperCase();if(cs.textTransform==='lowercase')return text.toLowerCase();if(cs.textTransform==='capitalize')return text.replace(/\b\w/g,c=>c.toUpperCase());return text;}
  function run(text,cs,el,root=el){
    const bg=color(cs.backgroundColor);const link=el.closest?.('a');
    return {text:transformText(text,cs),options:{fontStack:cs.fontFamily,weight:+cs.fontWeight || 400,fontSize:px(cs.fontSize),italic:cs.fontStyle==='italic',underline:cs.textDecorationLine.includes('underline'),strike:cs.textDecorationLine.includes('line-through'),color:textColor(cs,el,root),highlight:bg.transparency<50 && el!==root?bg.color:undefined,charSpacing:px(cs.letterSpacing),...(link?.href && cs.textDecorationLine.includes('underline')?{hyperlink:{url:link.href}}:{})}};
  }
  // text-wrap:balance/pretty choose line breaks PowerPoint cannot reproduce; keep the browser's
  // breaks as soft line breaks. Returns Map(textNode → [offsets where a new line starts]).
  function lineBreaks(root){
    const breaks=new Map(),range=document.createRange();let top=null;
    const tw=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
    for(let n=tw.nextNode();n;n=tw.nextNode()){
      const re=/\S+/g;let m;
      while((m=re.exec(n.textContent))){
        range.setStart(n,m.index);range.setEnd(n,m.index+1);const r=range.getClientRects()[0];if(!r)continue;
        if(top!==null && r.top>top+r.height/2){if(!breaks.has(n))breaks.set(n,[]);breaks.get(n).push(m.index);}
        top=top===null || r.top>top+r.height/2?r.top:top;
      }
    }
    return breaks;
  }
  function textRuns(root,breaks){
    const runs=[];
    function walk(n){
      if(n.nodeType===3){
        if(!n.textContent)return;
        const cs=getComputedStyle(n.parentElement),r=root.nodeType===1?root:n.parentElement;
        const cuts=breaks?.get(n) || [];let from=0;
        for(const at of cuts){runs.push(run(n.textContent.slice(from,at).replace(/\s+$/,''),cs,n.parentElement,r));runs.push({text:'\n',options:{}});from=at;}
        runs.push(run(n.textContent.slice(from),cs,n.parentElement,r));
        return;
      }
      if(n.nodeType!==1 || n.matches(SKIP))return;
      const cs=getComputedStyle(n);if(cs.display==='none' || cs.visibility==='hidden')return;
      if(n.tagName==='BR'){runs.push({text:'\n',options:{}});return;}
      if(n.tagName==='LI' && runs.length)runs.push({text:'\n',options:{paragraph:true}});
      const before=pseudo(n,'::before');if(before && !before.absolute && before.text)runs.push(run(before.text,before.pcs,n,root));
      for(const c of n.childNodes)walk(c);
      const after=pseudo(n,'::after');if(after && !after.absolute && after.text)runs.push(run(after.text,after.pcs,n,root));
    }
    walk(root);
    while(runs.length && !runs[0].text.trim() && runs[0].text!=='\n')runs.shift();
    if(runs.length && runs[0].text)runs[0].text=runs[0].text.replace(/^\s+/,'');
    const last=runs[runs.length-1];if(last && last.text)last.text=last.text.replace(/\s+$/,'');
    const out=runs.filter(r=>r.text);
    for(let i=1;i<out.length;i++)if(out[i-1].text==='\n' && out[i].text!=='\n')out[i]={...out[i],text:out[i].text.replace(/^\s+/,'')};
    return out.filter(r=>r.text);
  }
  function textNode(el,cs,r,rot,alpha){
    const balanced=/balance|pretty/.test(cs.textWrapStyle || cs.textWrap || '') && r.h>lineHeight(cs)*1.5;
    const runs=textRuns(el,balanced?lineBreaks(el):null);if(!runs.some(r=>r.text.trim()))return;
    if(/flex|grid/.test(cs.display) && !rot){
      const range=document.createRange();range.selectNodeContents(el);const rr=range.getBoundingClientRect();
      if(rr.width && rr.height){const b={x:(rr.x-origin.x)/scale,y:(rr.y-origin.y)/scale,w:rr.width/scale,h:rr.height/scale};const lh=lineHeight(cs);
        nodes.push({type:'text',...b,runs,align:'left',valign:'top',fontSize:px(cs.fontSize),lineHeight:lh,margin:[0,0,0,0],rotate:0,opacity:alpha,singleLine:b.h<lh*1.5});return;}
    }
    const pad=[px(cs.paddingTop)+px(cs.borderTopWidth),px(cs.paddingRight)+px(cs.borderRightWidth),px(cs.paddingBottom)+px(cs.borderBottomWidth),px(cs.paddingLeft)+px(cs.borderLeftWidth)];
    const lh=lineHeight(cs),flex=/flex/.test(cs.display);
    let align={start:'left',end:'right','-webkit-center':'center','-webkit-left':'left','-webkit-right':'right'}[cs.textAlign] || cs.textAlign;
    let valign='top';
    if(flex){if(/center/.test(cs.alignItems))valign='middle';else if(/end/.test(cs.alignItems))valign='bottom';if(align==='left' && /center/.test(cs.justifyContent))align='center';}
    const list=el.matches('ul,ol') && cs.listStyleType!=='none'?(el.tagName==='OL'?{type:'number'}:{}):undefined;
    nodes.push({type:'text',...r,runs,align,valign,fontSize:px(cs.fontSize),lineHeight:lh,margin:pad,rotate:rot,opacity:alpha,singleLine:r.h-pad[0]-pad[2]<lh*1.5,bullet:list});
  }
  function rangeText(node,alpha){
    const range=document.createRange();range.selectNodeContents(node);const rr=range.getBoundingClientRect();if(!rr.width || !rr.height)return;
    const cs=getComputedStyle(node.parentElement);const runs=textRuns(node);if(!runs.length)return;
    const r={x:(rr.x-origin.x)/scale,y:(rr.y-origin.y)/scale,w:rr.width/scale,h:rr.height/scale};const lh=lineHeight(cs);
    nodes.push({type:'text',...r,runs,align:'left',valign:'top',fontSize:px(cs.fontSize),lineHeight:lh,margin:[0,0,0,0],rotate:0,opacity:alpha,singleLine:r.h<lh*1.5});
  }

  let background=color(getComputedStyle(sec).backgroundColor);
  async function walk(el,alpha,parentRot=0){
    const cs=getComputedStyle(el);
    if(cs.display==='none' || cs.visibility==='hidden' || el.matches(SKIP))return;
    const a=alpha*(+cs.opacity);if(a<=0.001)return;
    if(cs.display==='contents'){for(const c of el.children)await walk(c,a,parentRot);return;}
    let r=box(el);if(r.w<=0 || r.h<=0)return;
    const t=el===sec?{ok:true,rot:0,sx:1,sy:1}:transformOf(cs);
    if(!t.ok){rasterLeaf(el,r,'transform-rasterized');return;}
    const rot=el===sec?0:(parentRot+px(cs.rotate)+t.rot)%360;
    if(rot){const w=el.offsetWidth*t.sx,h=el.offsetHeight*t.sy;r={x:r.x+(r.w-w)/2,y:r.y+(r.h-h)/2,w,h};}
    if(el!==sec && el.matches(LEAF)){rasterLeaf(el,box(el),'raster');return;}
    if(cs.filter!=='none' || cs.mixBlendMode!=='normal' || (cs.backdropFilter || cs.webkitBackdropFilter || 'none')!=='none')warn('effect-dropped',label(el));
    if(el.tagName==='IMG'){await imageNode(el,r,rot,a);return;}
    if(el.matches('.dek-shape') && el.dataset.shape==='line'){const c=color(cs.backgroundColor);nodes.push({type:'shape',shape:'line',...r,y:r.y+r.h/2,h:0,fill:c,line:{...c,width:r.h},radius:0,rotate:rot,opacity:a});return;}
    await paint(el,cs,r,rot,a);
    if(el.matches('.dek-shape') && el.dataset.shape && nodes.length && nodes[nodes.length-1].type==='shape')nodes[nodes.length-1].shape=el.dataset.shape;
    const hasText=[...el.childNodes].some(n=>n.nodeType===3 && n.textContent.trim());
    const asText=(hasText || pseudo(el,'::before')?.text || pseudo(el,'::after')?.text) && inlineOnly(el) || isList(el);
    await pseudoBox(el,cs,r,'::before',a,asText);
    if(asText)textNode(el,cs,r,rot,a);
    else{
      for(const n of el.childNodes)if(n.nodeType===3 && n.textContent.trim())rangeText(n,a);
      const kids=Array.from(el.children).sort((x,y)=>(parseInt(getComputedStyle(x).zIndex)||0)-(parseInt(getComputedStyle(y).zIndex)||0));
      for(const c of kids)await walk(c,a,rot);
    }
    await pseudoBox(el,cs,r,'::after',a,asText);
  }
  await walk(sec,1);
  return {nodes,warnings,background,rect:{x:origin.x,y:origin.y,w:origin.width,h:origin.height}};
}
