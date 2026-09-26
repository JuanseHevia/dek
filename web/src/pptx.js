// Writes the native nodes the export inspector extracted into a .pptx. Pure (no DOM) so it
// runs in the editor shell and in node tests alike.
import pptxgen from 'pptxgenjs';
import { resolveFont, weightedFace, naturalLineHeight } from './fonts.js';

const SHAPES={rectangle:'rect',rounded:'roundRect',ellipse:'ellipse',line:'line',arrow:'rightArrow',triangle:'triangle'};
// Google Slides re-measures text with its own font metrics and ignores both letter spacing and
// "do not wrap", so boxes get extra width: a little for wrapped text, more for single lines, plus
// whatever negative tracking the browser applied (Slides sets that text wider).
const WIDTH_SLACK=0.04,SINGLE_LINE_SLACK=0.12,FIXED_LINES_SLACK=0.3;

// Everything a person should know before sharing the file, from the extractor's warnings
// and the fonts the writer will substitute.
export function exportSummary({slides=[],warnings=[]}) {
  const counts={};for(const w of warnings)counts[w.kind]=(counts[w.kind] || 0)+1;
  const fonts=new Map();
  for(const s of slides)for(const n of s.nodes || [])for(const r of n.runs || []){if(!r.options?.fontStack)continue;const f=resolveFont(r.options.fontStack);if(f.replaced)fonts.set(f.replaced,f.face);}
  const plural=(n,one,many)=>`${n} ${n===1?one:many}`;
  const lines=[plural(slides.length,'slide','slides')];
  if(counts.raster)lines.push(plural(counts.raster,'visual as an image','visuals as images'));
  if(counts['transform-rasterized'])lines.push(plural(counts['transform-rasterized'],'3D/skewed element as an image','3D/skewed elements as images'));
  if(counts['gradient-flattened'])lines.push(plural(counts['gradient-flattened'],'gradient flattened to a solid color','gradients flattened to solid colors'));
  if(counts['shadow-simplified'])lines.push(plural(counts['shadow-simplified'],'shadow simplified','shadows simplified'));
  if(counts['effect-dropped'])lines.push(plural(counts['effect-dropped'],'filter or blend effect dropped','filter or blend effects dropped'));
  if(counts['pseudo-omitted'])lines.push(plural(counts['pseudo-omitted'],'decoration omitted','decorations omitted'));
  const replaced=[...fonts].map(([from,to])=>({from,to}));
  if(replaced.length)lines.push('Fonts: '+replaced.map(f=>`${f.from} → ${f.to}`).join(', '));
  return {slides:slides.length,counts,fonts:replaced,lines};
}

export async function writePowerPoint({title,size,slides,lang='en-US'}) {
  const pptx=new pptxgen();const width=13.333333,height=width*size.h/size.w,inch=width/size.w,pt=inch*72;
  pptx.defineLayout({name:'DEK',width,height});pptx.layout='DEK';pptx.author='Dek';pptx.subject='Exported locally from HTML';pptx.title=title;pptx.lang=lang;
  for(const item of slides){const slide=pptx.addSlide();slide.addNotes(item.notes || '');
    slide.background={color:item.background?.transparency<100?item.background.color:'FFFFFF'};
    for(const node of item.nodes){
      const alpha=node.opacity??1;
      const pos={x:node.x*inch,y:node.y*inch,w:Math.max(.001,node.w*inch),h:Math.max(.001,node.h*inch),rotate:node.rotate || 0};
      const faded=c=>({color:c?.color || '000000',transparency:Math.round(100-(100-(c?.transparency || 0))*alpha)});
      if(node.type==='image')addImage(slide,node,pos,inch,alpha);
      if(node.type==='shape'){
        const shadow=node.shadow && {type:'outer',blur:node.shadow.blur*pt,offset:Math.hypot(node.shadow.x,node.shadow.y)*pt,angle:Math.round((Math.atan2(node.shadow.y,node.shadow.x)*180/Math.PI+360)%360),color:node.shadow.color,opacity:Math.min(1,node.shadow.opacity*alpha)};
        slide.addShape(SHAPES[node.shape] || 'rect',{...pos,rectRadius:node.shape==='rounded'?Math.min(node.radius*inch,Math.min(pos.w,pos.h)/2):undefined,fill:faded(node.fill),line:node.line?{...faded(node.line),width:node.line.width*pt}:{type:'none'},shadow});
      }
      if(node.type==='text'){
        let {x,w}=pos;
        const tracking=Math.max(0,...node.runs.map(r=>-(r.options?.charSpacing || 0)/(r.options?.fontSize || node.fontSize)));
        // When every line already ends in an explicit break (balanced headings), extra width can only prevent wraps.
        const fixed=node.runs.some(r=>r.text==='\n' && !r.options?.paragraph);
        const extra=Math.min(w*(fixed?FIXED_LINES_SLACK:(node.singleLine?SINGLE_LINE_SLACK:WIDTH_SLACK)+tracking),Math.max(0,width-(x+w))+(node.align==='left'?0:x));
        if(node.align==='center')x-=extra/2;else if(node.align==='right')x-=extra;w+=extra;
        // List items are separate paragraphs (each keeps its bullet); other breaks are soft line breaks.
        // Paragraph properties ride on every run: pptxgenjs starts each paragraph from its first run.
        const face=weightedFace(resolveFont(node.runs.find(r=>r.options?.fontStack)?.options.fontStack || '').face).face;
        const para={align:['left','center','right','justify'].includes(node.align)?node.align:'left',lineSpacingMultiple:Math.round(node.lineHeight/node.fontSize/naturalLineHeight(face)*1000)/1000,bullet:node.bullet?{...node.bullet,indent:Math.max(1,node.margin[3]*pt)}:undefined,paraSpaceAfter:0,paraSpaceBefore:0};
        const runs=[];let soft=false;
        for(const r of node.runs){
          if(r.text==='\n'){if(r.options?.paragraph){if(runs.length)runs[runs.length-1].options.breakLine=true;}else soft=runs.length>0;continue;}
          runs.push({text:r.text,options:{...para,lang,...runOptions(r.options,node,pt),...(soft?{softBreakBefore:true}:{})}});soft=false;
        }
        if(!runs.length)continue;
        slide.addText(runs,{...pos,x,w,fontSize:node.fontSize*pt,align:['left','center','right','justify'].includes(node.align)?node.align:'left',valign:node.valign || 'top',margin:[node.bullet?0:node.margin[3],node.margin[1],node.margin[2],node.margin[0]].map(n=>n*pt),fit:'none',wrap:!node.singleLine,transparency:Math.round((1-alpha)*100),bullet:node.bullet?{...node.bullet,indent:Math.max(1,node.margin[3]*pt)}:undefined,paraSpaceAfter:0,paraSpaceBefore:0});
      }
    }
  }
  return await pptx.write({outputType:'base64',compression:true});
}

function runOptions(o,node,pt) {
  const {face,bold}=weightedFace(resolveFont(o.fontStack || '').face,o.weight || 400);
  return {fontFace:face,fontSize:(o.fontSize || node.fontSize)*pt,bold,italic:!!o.italic,underline:o.underline?{style:'sng'}:undefined,strike:o.strike?'sngStrike':undefined,color:o.color,highlight:o.highlight,charSpacing:(o.charSpacing || 0)*pt || undefined,...(o.hyperlink?{hyperlink:o.hyperlink}:{})};
}

// object-fit and background-size, reproduced with a crop (cover) or a fitted box (contain).
function addImage(slide,node,pos,inch,alpha) {
  const data=node.data || 'data:image/png;base64,'+node.image;
  const base={data,rotate:pos.rotate,transparency:alpha<1?Math.round((1-alpha)*100):undefined,rounding:node.round || undefined};
  const nw=node.natural?.w,nh=node.natural?.h;
  if(!node.data || !nw || !nh || !node.fit || node.fit==='fill'){slide.addImage({...base,x:pos.x,y:pos.y,w:pos.w,h:pos.h});return;}
  const [px,py]=objectPosition(node.position);
  if(node.fit==='cover'){
    const s=Math.max(pos.w/nw,pos.h/nh),iw=nw*s,ih=nh*s;
    slide.addImage({...base,x:pos.x,y:pos.y,w:iw,h:ih,sizing:{type:'crop',x:(iw-pos.w)*px,y:(ih-pos.h)*py,w:pos.w,h:pos.h}});return;
  }
  const s=node.fit==='none'?Math.min(inch,Math.min(pos.w/nw,pos.h/nh)):node.fit==='scale-down'?Math.min(inch,pos.w/nw,pos.h/nh):Math.min(pos.w/nw,pos.h/nh);
  const iw=nw*s,ih=nh*s;
  slide.addImage({...base,x:pos.x+(pos.w-iw)*px,y:pos.y+(pos.h-ih)*py,w:iw,h:ih});
}
function objectPosition(value='50% 50%') {
  const words={left:0,top:0,center:.5,right:1,bottom:1};
  const parts=String(value).trim().split(/\s+/).slice(0,2).map(p=>p in words?words[p]:p.endsWith('%')?parseFloat(p)/100:.5);
  return [parts[0]??.5,parts[1]??.5];
}
