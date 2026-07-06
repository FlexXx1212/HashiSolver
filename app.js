const canvas=document.getElementById('board');
const ctx=canvas.getContext('2d',{willReadFrequently:true});
const imageInput=document.getElementById('imageInput');
const detectBtn=document.getElementById('detectBtn');
const cropBtn=document.getElementById('cropBtn');
const addIslandBtn=document.getElementById('addIslandBtn');
const nextMoveBtn=document.getElementById('nextMoveBtn');
const applyMoveBtn=document.getElementById('applyMoveBtn');
const clearBtn=document.getElementById('clearBtn');
const statusEl=document.getElementById('status');
const islandList=document.getElementById('islandList');
const selectionBox=document.getElementById('selectionBox');
const moveBox=document.getElementById('moveBox');
const validationBox=document.getElementById('validationBox');

const FIXED_CROP={refW:709,refH:1536,left:44,top:390,right:44,bottom:330};
const state={image:null,sourceCanvas:null,sourceCtx:null,islands:[],bridges:[],selectedId:null,nextId:1,pendingMove:null,addMode:false,cropMode:false,crop:null,drag:null,longPressTimer:null};

const setStatus=t=>statusEl.textContent=t;
const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
const islandById=id=>state.islands.find(i=>i.id===id);
const keyFor=(a,b)=>[a,b].sort((x,y)=>x-y).join('-');
const bridgeBetween=(a,b)=>state.bridges.find(br=>keyFor(br.a,br.b)===keyFor(a,b));
const bridgeCount=(a,b)=>bridgeBetween(a,b)?.count??0;
const islandRadius=()=>Math.max(14,Math.min(canvas.width,canvas.height)*0.028);

imageInput.addEventListener('change',e=>loadImage(e.target.files?.[0]));
document.getElementById('navUpload')?.addEventListener('click',()=>imageInput.click());
document.getElementById('navDetect')?.addEventListener('click',()=>detectAndRebuild());
document.getElementById('navAdd')?.addEventListener('click',()=>addIslandBtn.click());
document.getElementById('navNext')?.addEventListener('click',()=>nextMoveBtn.click());
detectBtn.addEventListener('click',()=>detectAndRebuild());

function loadImage(file){
  if(!file)return;
  const img=new Image();
  img.onload=()=>{
    const max=1200,scale=Math.min(1,max/Math.max(img.width,img.height));
    const w=Math.round(img.width*scale),h=Math.round(img.height*scale);
    state.sourceCanvas=document.createElement('canvas');state.sourceCanvas.width=w;state.sourceCanvas.height=h;
    state.sourceCtx=state.sourceCanvas.getContext('2d',{willReadFrequently:true});state.sourceCtx.drawImage(img,0,0,w,h);
    canvas.width=w;canvas.height=h;state.image=img;state.crop=fixedPuzzleCrop(w,h);
    state.islands=[];state.bridges=[];state.selectedId=null;state.nextId=1;state.pendingMove=null;
    detectAndRebuild();
  };
  img.src=URL.createObjectURL(file);
}

function fixedPuzzleCrop(w,h){
  const l=Math.round(FIXED_CROP.left*w/FIXED_CROP.refW),t=Math.round(FIXED_CROP.top*h/FIXED_CROP.refH),r=Math.round(FIXED_CROP.right*w/FIXED_CROP.refW),b=Math.round(FIXED_CROP.bottom*h/FIXED_CROP.refH);
  return{x:l,y:t,w:Math.max(40,w-l-r),h:Math.max(40,h-t-b)};
}

function detectAndRebuild(){
  if(!state.sourceCtx)return setStatus('Erst Screenshot laden');
  detectIslands();
  detectExistingBridges();
  draw();render();
  setStatus(`${state.islands.length} Inseln, ${state.bridges.length} Brücken erkannt. Grid neu aufgebaut.`);
}

cropBtn.addEventListener('click',()=>{state.cropMode=!state.cropMode;cropBtn.textContent=state.cropMode?'Bereich aktiv':'Bereich wählen';setStatus(state.cropMode?'Fallback: Rechteck manuell ziehen':'Fixer Crop aktiv');draw();});
addIslandBtn.addEventListener('click',()=>{state.addMode=!state.addMode;addIslandBtn.textContent=state.addMode?'Tippen...':'+ Insel';setStatus(state.addMode?'Auf das Board tippen, um Insel einzufügen':'Bereit');});
nextMoveBtn.addEventListener('click',()=>{const move=findNextMove();state.pendingMove=move;applyMoveBtn.disabled=!move;renderMove(move);draw();});
applyMoveBtn.addEventListener('click',()=>{if(!state.pendingMove)return;applyBridge(state.pendingMove.a,state.pendingMove.b,state.pendingMove.targetCount);state.pendingMove=null;applyMoveBtn.disabled=true;moveBox.textContent='Move angewendet.';draw();render();});
clearBtn.addEventListener('click',()=>{state.islands=[];state.bridges=[];state.selectedId=null;state.nextId=1;state.pendingMove=null;state.crop=state.sourceCanvas?fixedPuzzleCrop(canvas.width,canvas.height):null;draw();render();setStatus('Zurückgesetzt');});

canvas.addEventListener('pointerdown',e=>{const p=eventPoint(e);if(state.cropMode){state.drag={start:p,current:p};return;}state.longPressTimer=setTimeout(()=>{const hit=hitIsland(p.x,p.y);if(hit)removeIsland(hit.id);},650);});
canvas.addEventListener('pointermove',e=>{if(state.cropMode&&state.drag){state.drag.current=eventPoint(e);draw();}});
canvas.addEventListener('pointerup',e=>{clearTimeout(state.longPressTimer);const p=eventPoint(e);if(state.cropMode&&state.drag){const a=state.drag.start,b=state.drag.current,x=Math.min(a.x,b.x),y=Math.min(a.y,b.y),w=Math.abs(a.x-b.x),h=Math.abs(a.y-b.y);if(w>40&&h>40)state.crop={x:Math.round(x),y:Math.round(y),w:Math.round(w),h:Math.round(h)};state.drag=null;detectAndRebuild();return;}handleTap(p,e);});
canvas.addEventListener('contextmenu',e=>{e.preventDefault();const p=eventPoint(e),hit=hitIsland(p.x,p.y);if(hit)removeIsland(hit.id);});
function eventPoint(e){const r=canvas.getBoundingClientRect();return{x:(e.clientX-r.left)*canvas.width/r.width,y:(e.clientY-r.top)*canvas.height/r.height};}
function handleTap(p,e){const hit=hitIsland(p.x,p.y);if(e.shiftKey||state.addMode){addIsland(p.x,p.y,1);state.addMode=false;addIslandBtn.textContent='+ Insel';draw();render();return;}if(!hit){state.selectedId=null;draw();render();return;}if(state.selectedId&&state.selectedId!==hit.id){const a=islandById(state.selectedId),b=hit;if(areAligned(a,b)&&!wouldCross(a.id,b.id))applyBridge(a.id,b.id,(bridgeCount(a.id,b.id)+1)%3);else setStatus('Nur horizontal/vertikal ohne Kreuzung möglich');state.selectedId=hit.id;}else state.selectedId=hit.id;draw();render();}
function hitIsland(x,y){return state.islands.find(i=>Math.hypot(i.x-x,i.y-y)<=islandRadius()+9);}
function addIsland(x,y,value){state.islands.push({id:state.nextId++,x:Math.round(x),y:Math.round(y),value:clamp(Number(value)||1,1,8)});}
function removeIsland(id){state.islands=state.islands.filter(i=>i.id!==id);state.bridges=state.bridges.filter(b=>b.a!==id&&b.b!==id);if(state.selectedId===id)state.selectedId=null;draw();render();}
function applyBridge(a,b,count){state.bridges=state.bridges.filter(br=>keyFor(br.a,br.b)!==keyFor(a,b));if(count>0)state.bridges.push({a,b,count:clamp(count,1,2)});}

function detectIslands(){
  const img=state.sourceCtx.getImageData(0,0,canvas.width,canvas.height),crop=state.crop??fixedPuzzleCrop(canvas.width,canvas.height);
  const minR=Math.max(9,Math.round(Math.min(crop.w,crop.h)*0.021)),maxR=Math.min(35,Math.round(Math.min(crop.w,crop.h)*0.060));
  const candidates=[],step=3;
  for(let y=crop.y+maxR;y<crop.y+crop.h-maxR;y+=step){
    for(let x=crop.x+maxR;x<crop.x+crop.w-maxR;x+=step){
      let best=null;for(let r=minR;r<=maxR;r+=2){const s=circleScore(img,x,y,r);if(!best||s.score>best.score)best={x,y,r,...s};}
      if(best&&best.score>.48&&best.inner>.018)candidates.push(best);
    }
  }
  candidates.sort((a,b)=>b.score-a.score);
  const picked=[];
  for(const c of candidates){
    if(picked.some(p=>Math.hypot(p.x-c.x,p.y-c.y)<Math.max(p.r,c.r)*2.15))continue;
    picked.push(c);
  }
  state.islands=picked.sort((a,b)=>a.y-b.y||a.x-b.x).map(c=>({id:state.nextId++,x:Math.round(c.x),y:Math.round(c.y),value:1}));
  snapIslandsToGrid();
}
function isBright(data,w,x,y){x=Math.round(x);y=Math.round(y);if(x<0||y<0||x>=canvas.width||y>=canvas.height)return false;const i=(y*w+x)*4,r=data[i],g=data[i+1],b=data[i+2],avg=(r+g+b)/3,diff=Math.max(r,g,b)-Math.min(r,g,b);return avg>142&&diff<95;}
function circleScore(img,x,y,r){const data=img.data,w=img.width;let ring=0,total=0,inner=0,innerTotal=0;for(let a=0;a<Math.PI*2;a+=Math.PI/28){for(const rr of[r-1,r,r+1]){total++;if(isBright(data,w,x+Math.cos(a)*rr,y+Math.sin(a)*rr))ring++;}}for(let yy=-r*.5;yy<=r*.5;yy+=3){for(let xx=-r*.5;xx<=r*.5;xx+=3){innerTotal++;if(isBright(data,w,x+xx,y+yy))inner++;}}return{score:ring/total,inner:inner/innerTotal};}
function snapIslandsToGrid(){
  if(state.islands.length<4)return;
  const tol=22;
  const cluster=vals=>{const s=[...vals].sort((a,b)=>a-b),out=[];for(const v of s){const g=out.find(c=>Math.abs(c.avg-v)<tol);if(g){g.items.push(v);g.avg=g.items.reduce((a,b)=>a+b,0)/g.items.length;}else out.push({avg:v,items:[v]});}return out.map(c=>c.avg);};
  const xs=cluster(state.islands.map(i=>i.x)),ys=cluster(state.islands.map(i=>i.y));
  for(const i of state.islands){const nx=xs.reduce((a,b)=>Math.abs(b-i.x)<Math.abs(a-i.x)?b:a,xs[0]);const ny=ys.reduce((a,b)=>Math.abs(b-i.y)<Math.abs(a-i.y)?b:a,ys[0]);if(Math.abs(nx-i.x)<tol)i.x=Math.round(nx);if(Math.abs(ny-i.y)<tol)i.y=Math.round(ny);}
}

function detectExistingBridges(){
  state.bridges=[];
  const img=state.sourceCtx.getImageData(0,0,canvas.width,canvas.height);
  for(let i=0;i<state.islands.length;i++)for(let j=i+1;j<state.islands.length;j++){
    const a=state.islands[i],b=state.islands[j];
    if(!areAligned(a,b)||hasIslandBetween(a,b))continue;
    const count=bridgeCountFromImage(img,a,b);
    if(count>0)state.bridges.push({a:a.id,b:b.id,count});
  }
}
function hasIslandBetween(a,b){const h=Math.abs(a.x-b.x)>Math.abs(a.y-b.y);return state.islands.some(i=>i.id!==a.id&&i.id!==b.id&&(h?Math.abs(i.y-a.y)<20&&i.x>Math.min(a.x,b.x)&&i.x<Math.max(a.x,b.x):Math.abs(i.x-a.x)<20&&i.y>Math.min(a.y,b.y)&&i.y<Math.max(a.y,b.y)));}
function bridgeCountFromImage(img,a,b){
  const h=Math.abs(a.x-b.x)>Math.abs(a.y-b.y),r=islandRadius()+6;
  const len=h?Math.abs(b.x-a.x):Math.abs(b.y-a.y);if(len<r*2+8)return 0;
  const start=r,end=len-r,offsets=[-6,0,6];
  const ratios=offsets.map(o=>sampleLineRatio(img,a,b,h,o,start,end));
  const strong=ratios.filter(v=>v>.48).length;
  if(strong>=2)return 2;
  if(Math.max(...ratios)>.50)return 1;
  return 0;
}
function sampleLineRatio(img,a,b,h,off,start,end){let bright=0,total=0;const steps=Math.max(12,Math.floor((end-start)/5));for(let k=0;k<=steps;k++){const t=start+(end-start)*k/steps;const x=h?(a.x+(b.x>a.x?t:-t)):(a.x+off);const y=h?(a.y+off):(a.y+(b.y>a.y?t:-t));total++;if(isBright(img.data,img.width,x,y))bright++;}return bright/total;}

function draw(){
  ctx.clearRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#0b1118';ctx.fillRect(0,0,canvas.width,canvas.height);
  drawRebuiltGrid();drawBridges();if(state.pendingMove)drawSuggestedMove(state.pendingMove);drawIslands();drawCropIfManual();
}
function drawRebuiltGrid(){
  const crop=state.crop;if(!crop)return;
  const xs=[...new Set(state.islands.map(i=>i.x).sort((a,b)=>a-b))],ys=[...new Set(state.islands.map(i=>i.y).sort((a,b)=>a-b))];
  ctx.strokeStyle='#283440';ctx.lineWidth=1;
  const gridXs=xs.length?xs:range(crop.x,crop.x+crop.w,Math.max(55,crop.w/8));
  const gridYs=ys.length?ys:range(crop.y,crop.y+crop.h,Math.max(55,crop.h/8));
  for(const x of gridXs){ctx.beginPath();ctx.moveTo(x,crop.y);ctx.lineTo(x,crop.y+crop.h);ctx.stroke();}
  for(const y of gridYs){ctx.beginPath();ctx.moveTo(crop.x,y);ctx.lineTo(crop.x+crop.w,y);ctx.stroke();}
}
function range(a,b,step){const out=[];for(let x=a;x<=b;x+=step)out.push(x);return out;}
function drawCropIfManual(){if(!state.cropMode&&!state.drag)return;const c=state.drag?rectFromDrag(state.drag):state.crop;if(!c)return;ctx.save();ctx.strokeStyle='#ffd36f';ctx.lineWidth=3;ctx.setLineDash([8,6]);ctx.strokeRect(c.x,c.y,c.w,c.h);ctx.restore();}
function rectFromDrag(d){const x=Math.min(d.start.x,d.current.x),y=Math.min(d.start.y,d.current.y);return{x,y,w:Math.abs(d.start.x-d.current.x),h:Math.abs(d.start.y-d.current.y)};}
function drawBridges(){for(const br of state.bridges){const a=islandById(br.a),b=islandById(br.b);if(a&&b)drawBridgeLine(a,b,br.count,'#dce8f2',5);}}
function drawSuggestedMove(m){const a=islandById(m.a),b=islandById(m.b);if(a&&b)drawBridgeLine(a,b,m.targetCount,'#ffd36f',8);}
function drawBridgeLine(a,b,count,color,width){ctx.strokeStyle=color;ctx.lineWidth=width;ctx.lineCap='round';const h=Math.abs(a.x-b.x)>Math.abs(a.y-b.y),offs=count===2?[-5,5]:[0];for(const o of offs){ctx.beginPath();ctx.moveTo(a.x+(h?0:o),a.y+(h?o:0));ctx.lineTo(b.x+(h?0:o),b.y+(h?o:0));ctx.stroke();}}
function drawIslands(){const r=islandRadius();for(const i of state.islands){ctx.beginPath();ctx.arc(i.x,i.y,r,0,Math.PI*2);ctx.fillStyle=i.id===state.selectedId?'#15384a':'#111923';ctx.fill();ctx.lineWidth=i.id===state.selectedId?5:4;ctx.strokeStyle='#eef3f8';ctx.stroke();ctx.fillStyle='#eef3f8';ctx.font=`800 ${Math.round(r*1.25)}px system-ui`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(i.value,i.x,i.y+1);}}

function render(){renderSelection();renderIslands();renderValidation();}
function renderSelection(){const i=islandById(state.selectedId);selectionBox.textContent=i?`Insel #${i.id}: Wert ${i.value}, Rest ${remaining(i.id)}`:'Keine Insel ausgewählt.';}
function renderIslands(){islandList.innerHTML='';for(const i of state.islands){const row=document.createElement('div');row.className='islandRow';const label=document.createElement('div');label.textContent=`#${i.id} (${Math.round(i.x)}, ${Math.round(i.y)})`;const input=document.createElement('input');input.type='number';input.min='1';input.max='8';input.value=i.value;input.addEventListener('change',()=>{i.value=clamp(Number(input.value)||1,1,8);draw();render();});const del=document.createElement('button');del.textContent='×';del.addEventListener('click',()=>removeIsland(i.id));row.append(label,input,del);islandList.append(row);}}
function renderMove(move){if(!move){moveBox.textContent='Kein sicherer logischer Move gefunden.';return;}const a=islandById(move.a),b=islandById(move.b);moveBox.innerHTML=`<b>${move.action}</b><br>#${a.id} ↔ #${b.id}: auf <b>${move.targetCount}</b> Brücke(n).<br><br>${move.reason}`;}
function renderValidation(){validationBox.innerHTML=state.islands.map(i=>{const u=usedCount(i.id),r=i.value-u,cls=r<0?'bad':r===0?'ok':'';return`<div class="${cls}">#${i.id}: ${u}/${i.value}${r>0?`, Rest ${r}`:''}</div>`;}).join('')||'<div class="muted">Noch keine Inseln.</div>';}

function areAligned(a,b){return Math.abs(a.x-b.x)<20||Math.abs(a.y-b.y)<20;}
function segment(a,b){const h=Math.abs(a.x-b.x)>Math.abs(a.y-b.y);return{h,x1:Math.min(a.x,b.x),x2:Math.max(a.x,b.x),y1:Math.min(a.y,b.y),y2:Math.max(a.y,b.y),x:h?null:(a.x+b.x)/2,y:h?(a.y+b.y)/2:null};}
function wouldCross(aId,bId){const a=islandById(aId),b=islandById(bId);if(!a||!b)return true;const s=segment(a,b);for(const br of state.bridges){if([br.a,br.b].includes(aId)||[br.a,br.b].includes(bId))continue;const c=islandById(br.a),d=islandById(br.b),t=segment(c,d);if(s.h===t.h)continue;const h=s.h?s:t,v=s.h?t:s;if(v.x>h.x1&&v.x<h.x2&&h.y>v.y1&&h.y<v.y2)return true;}return false;}
function visibleNeighbors(id){const i=islandById(id);if(!i)return[];const dirs=[{p:j=>j.x>i.x&&Math.abs(j.y-i.y)<24,s:(a,b)=>a.x-b.x},{p:j=>j.x<i.x&&Math.abs(j.y-i.y)<24,s:(a,b)=>b.x-a.x},{p:j=>j.y>i.y&&Math.abs(j.x-i.x)<24,s:(a,b)=>a.y-b.y},{p:j=>j.y<i.y&&Math.abs(j.x-i.x)<24,s:(a,b)=>b.y-a.y}];return dirs.map(d=>state.islands.filter(j=>j.id!==id&&d.p(j)).sort(d.s)[0]).filter(Boolean).filter(n=>!wouldCross(id,n.id));}
function usedCount(id){return state.bridges.reduce((s,b)=>s+(b.a===id||b.b===id?b.count:0),0);}
function remaining(id){const i=islandById(id);return i?i.value-usedCount(id):0;}
function capacity(a,b){return 2-bridgeCount(a,b);}
function possibleNeighbors(id){return visibleNeighbors(id).filter(n=>remaining(n.id)>0&&capacity(id,n.id)>0);}
function findNextMove(){for(const i of state.islands){const rem=remaining(i.id);if(rem<=0)continue;const ns=possibleNeighbors(i.id);if(!ns.length)continue;const capSum=ns.reduce((s,n)=>s+capacity(i.id,n.id),0);if(rem===capSum){const n=ns.find(n=>capacity(i.id,n.id)>0);return{a:i.id,b:n.id,targetCount:bridgeCount(i.id,n.id)+capacity(i.id,n.id),action:'Alle Kapazitäten nutzen',reason:`Restbedarf ${rem}, mögliche Gesamtkapazität ${capSum}. Also muss jede mögliche Verbindung maximal gesetzt werden.`};}for(const n of ns){const otherCap=capSum-capacity(i.id,n.id),min=rem-otherCap;if(min>0&&bridgeCount(i.id,n.id)<min)return{a:i.id,b:n.id,targetCount:min,action:'Mindestbrücke erzwungen',reason:`Andere Nachbarn können zusammen höchstens ${otherCap} liefern. Deshalb braucht diese Verbindung mindestens ${min}.`};}if(rem===ns.length){const n=ns.find(n=>bridgeCount(i.id,n.id)===0);if(n)return{a:i.id,b:n.id,targetCount:1,action:'Eine Brücke zu jedem Nachbarn',reason:`Restbedarf ${rem} und genau ${ns.length} mögliche Nachbarn.`};}}return null;}

draw();render();
