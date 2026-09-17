import pptxgen from 'pptxgenjs';
import { buildDocument } from './stage.js';

export function exportManifest(model, options={}, baseHref='') {
  const indices=model.slides.filter(s=>options.includeHidden || !s.skip).map(s=>s.index);
  if(!indices.length)throw new Error('There are no visible slides to export. Show a slide or include hidden slides.');
  return {title:model.meta.title || 'Deck',size:model.meta.size,indices,titles:indices.map(i=>model.slides[i].title+(model.slides[i].skip?" (hidden)":"")),notes:indices.map(i=>model.slides[i].notes),html:buildDocument(model,{static:true,step:'last',baseHref,transition:'none'})};
}
// This function is serialized into the isolated WebKit renderer. It must be self-contained.
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
  const color=value=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=value;ctx.fillRect(0,0,1,1);const c=ctx.getImageData(0,0,1,1).data;return {color:Array.from(c).slice(0,3).map(v=>v.toString(16).padStart(2,'0')).join(''),transparency:Math.round((1-c[3]/255)*100)};};
  const origin=sec.getBoundingClientRect(),scale=window.dek.zoom(),nodes=[],warnings=[];
  function box(el){const r=el.getBoundingClientRect();return{x:(r.x-origin.x)/scale,y:(r.y-origin.y)/scale,w:r.width/scale,h:r.height/scale};}
  function raster(el,reason){const r=box(el);if(r.w<=0 || r.h<=0)return;nodes.push({type:'image',...r,capture:{x:origin.x+r.x*scale,y:origin.y+r.y*scale,w:r.w*scale,h:r.h*scale}});if(reason)warnings.push(reason);}
  function textRuns(el){const runs=[];function walk(n){if(n.nodeType===3){const cs=getComputedStyle(n.parentElement);if(!n.textContent)return;let text=n.textContent;if(!cs.whiteSpace.startsWith('pre'))text=text.replace(/\s+/g,' ');if(cs.textTransform==='uppercase')text=text.toUpperCase();else if(cs.textTransform==='lowercase')text=text.toLowerCase();else if(cs.textTransform==='capitalize')text=text.replace(/\b\w/g,c=>c.toUpperCase());runs.push({text,options:{fontFace:cs.fontFamily.split(',')[0].replace(/["']/g,''),fontSize:parseFloat(cs.fontSize),bold:+cs.fontWeight>=600,italic:cs.fontStyle==='italic',underline:cs.textDecorationLine.includes('underline'),strike:cs.textDecorationLine.includes('line-through')?'sngStrike':undefined,color:color(cs.color).color,highlight:color(cs.backgroundColor).transparency<100?color(cs.backgroundColor).color:undefined,charSpacing:parseFloat(cs.letterSpacing)||0,...(n.parentElement.closest('a')?{hyperlink:{url:n.parentElement.closest('a').href}}:{})}});}else if(n.nodeType===1){if(n.tagName==='BR')runs.push({text:'\n',options:{}});else{if(n.tagName==='LI' && runs.length)runs.push({text:'\n',options:{}});for(const c of n.childNodes)walk(c);}}}walk(el);return runs;}
  function walk(el){const cs=getComputedStyle(el);if(cs.display==='none' || cs.visibility==='hidden' || +cs.opacity===0 || el.matches('.notes,.dek-sel,.dek-hover,script,style,template'))return;
    let r=box(el);if(r.w<=0 || r.h<=0)return;
    const rotation=parseFloat(cs.rotate)||0;if(rotation && el.matches('.dek-shape,h1,h2,h3,h4,h5,h6,p,.dek-text')){const w=el.offsetWidth,h=el.offsetHeight;r={x:r.x+(r.w-w)/2,y:r.y+(r.h-h)/2,w,h};}
    const pseudo=['::before','::after'].some(p=>{const c=getComputedStyle(el,p).content;return c && !['none','normal','""'].includes(c);});
    const complex=(+cs.opacity<1 && el.children.length>0 && !el.matches('h1,h2,h3,h4,h5,h6,p,ul,ol,blockquote,.dek-text,.dek-shape')) || (rotation && !el.matches('.dek-shape,h1,h2,h3,h4,h5,h6,p,.dek-text')) || cs.filter!=='none' || cs.backgroundImage!=='none' || cs.boxShadow!=='none' || cs.mixBlendMode!=='normal' || pseudo || (cs.transform!=='none' && !el.matches('.dek-shape'));
    if(complex || el.matches('.dek-chart,[data-dek-use],.dek-scene,.dek-cube,svg,canvas,video,iframe,table,pre')){raster(el,`${el.tagName.toLowerCase()} visual exported as an image`);return;}
    if(el.tagName==='IMG'){raster(el);return;}
    if(el.matches('.dek-shape')){if(el.dataset.shape==='line'){nodes.push({type:'shape',shape:'line',...r,y:r.y+r.h/2,h:0,fill:color(cs.backgroundColor),line:{...color(cs.backgroundColor),width:r.h},rotate:rotation,opacity:+cs.opacity});return;}nodes.push({type:'shape',shape:el.dataset.shape || 'rectangle',...r,fill:color(cs.backgroundColor),line:{...color(cs.borderTopColor),width:parseFloat(cs.borderTopWidth)},rotate:parseFloat(cs.rotate)||0,opacity:+cs.opacity,rectRadius:Math.min(1,(parseFloat(cs.borderTopLeftRadius)||0)/Math.min(r.w,r.h))});return;}
    if(el.matches('h1,h2,h3,h4,h5,h6,p,ul,ol,blockquote,.dek-text') || !el.children.length && el.textContent.trim()){
      nodes.push({type:'text',...r,runs:textRuns(el),align:cs.textAlign==='start'?'left':cs.textAlign,fontSize:parseFloat(cs.fontSize),lineSpacing:parseFloat(cs.lineHeight)||parseFloat(cs.fontSize)*1.2,margin:[parseFloat(cs.paddingTop),parseFloat(cs.paddingRight),parseFloat(cs.paddingBottom),parseFloat(cs.paddingLeft)],rotate:parseFloat(cs.rotate)||0,fill:color(cs.backgroundColor),opacity:+cs.opacity,bullet:el.matches('ul,ol')?(el.tagName==='OL'?{type:'number'}:{}):undefined});return;
    }
    if(el.children.length && [...el.childNodes].some(n=>n.nodeType===3 && n.textContent.trim())){raster(el,'Mixed HTML text exported as an image');return;}
    const fill=color(cs.backgroundColor);if(fill.transparency<100 || parseFloat(cs.borderTopWidth)>0)nodes.push({type:'shape',shape:'rectangle',...r,fill,line:{...color(cs.borderTopColor),width:parseFloat(cs.borderTopWidth)},rotate:0,opacity:+cs.opacity});
    Array.from(el.children).sort((a,b)=>(parseInt(getComputedStyle(a).zIndex)||0)-(parseInt(getComputedStyle(b).zIndex)||0)).forEach(walk);
  }
  // A complex slide background is one fallback; never pretend its descendants are editable.
  walk(sec);
  return {nodes,warnings,background:color(getComputedStyle(sec).backgroundColor),rect:{x:origin.x,y:origin.y,w:origin.width,h:origin.height}};
}
export async function writePowerPoint({title,size,slides,mode}) {
  const pptx=new pptxgen();const width=13.333333,height=width*size.h/size.w,inch=width/size.w,pt=inch*72;
  pptx.defineLayout({name:'DEK',width,height});pptx.layout='DEK';pptx.author='Dek';pptx.subject='Exported locally from HTML';pptx.title=title;pptx.lang='en-US';
  const shapes={rectangle:'rect',rounded:'roundRect',ellipse:'ellipse',line:'line',arrow:'rightArrow',triangle:'triangle'};
  for(const item of slides){const slide=pptx.addSlide();slide.addNotes(item.notes || '');
    if(mode==='image'){slide.addImage({data:'data:image/png;base64,'+item.image,x:0,y:0,w:width,h:height});continue;}
    slide.background={color:item.background?.color || 'F4F2EE'};
    for(const node of item.nodes){const pos={x:node.x*inch,y:node.y*inch,w:Math.max(.001,node.w*inch),h:Math.max(.001,node.h*inch),rotate:node.rotate || 0};
      if(node.type==='image')slide.addImage({...pos,data:'data:image/png;base64,'+node.image});
      const faded=c=>({...c,transparency:Math.round(100-(100-(c?.transparency || 0))*(node.opacity??1))});
      if(node.type==='shape')slide.addShape(shapes[node.shape] || 'rect',{...pos,rectRadius:node.rectRadius,fill:faded(node.fill),line:{...faded(node.line),width:(node.line?.width || 0)*pt}});
      if(node.type==='text')slide.addText(node.runs.map(r=>({text:r.text,options:{...r.options,fontSize:(r.options.fontSize || node.fontSize)*pt,charSpacing:(r.options.charSpacing || 0)*pt}})),{...pos,fontSize:node.fontSize*pt,align:['left','center','right','justify'].includes(node.align)?node.align:'left',margin:node.margin.map(n=>n*pt),breakLine:false,lineSpacingMultiple:node.lineSpacing/node.fontSize,valign:'top',transparency:Math.round((1-(node.opacity??1))*100),fill:faded(node.fill),bullet:node.bullet,fit:'shrink',paraSpaceAfter:0});
    }
  }
  return await pptx.write({outputType:'base64',compression:true});
}
