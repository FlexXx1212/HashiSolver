const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d', { willReadFrequently: true });
const imageInput = document.getElementById('imageInput');
const detectBtn = document.getElementById('detectBtn');
const cropBtn = document.getElementById('cropBtn');
const addIslandBtn = document.getElementById('addIslandBtn');
const nextMoveBtn = document.getElementById('nextMoveBtn');
const applyMoveBtn = document.getElementById('applyMoveBtn');
const clearBtn = document.getElementById('clearBtn');
const statusEl = document.getElementById('status');
const islandList = document.getElementById('islandList');
const selectionBox = document.getElementById('selectionBox');
const moveBox = document.getElementById('moveBox');
const validationBox = document.getElementById('validationBox');

const FIXED_CROP = { refW: 709, refH: 1536, left: 44, top: 390, right: 44, bottom: 330 };
const state = { image:null, islands:[], bridges:[], selectedId:null, nextId:1, pendingMove:null, addMode:false, cropMode:false, crop:null, drag:null, longPressTimer:null };

function setStatus(text){ statusEl.textContent = text; }
function clamp(n,min,max){ return Math.max(min, Math.min(max, n)); }
function islandById(id){ return state.islands.find(i => i.id === id); }
function keyFor(a,b){ return [a,b].sort((x,y)=>x-y).join('-'); }
function bridgeBetween(a,b){ return state.bridges.find(br => keyFor(br.a, br.b) === keyFor(a,b)); }
function bridgeCount(a,b){ return bridgeBetween(a,b)?.count ?? 0; }
function islandRadius(){ return Math.max(12, Math.min(canvas.width, canvas.height) * 0.025); }

imageInput.addEventListener('change', e => loadImage(e.target.files?.[0]));
document.getElementById('navUpload')?.addEventListener('click', () => imageInput.click());
document.getElementById('navDetect')?.addEventListener('click', () => detectBtn.click());
document.getElementById('navAdd')?.addEventListener('click', () => addIslandBtn.click());
document.getElementById('navNext')?.addEventListener('click', () => nextMoveBtn.click());

function loadImage(file){
  if(!file) return;
  const img = new Image();
  img.onload = () => {
    const max = 1200;
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    state.image = img;
    state.islands = [];
    state.bridges = [];
    state.selectedId = null;
    state.nextId = 1;
    state.pendingMove = null;
    state.crop = fixedPuzzleCrop(canvas.width, canvas.height);
    draw();
    render();
    setStatus('Screenshot geladen. Fixer Spielfeld-Crop aktiv.');
  };
  img.src = URL.createObjectURL(file);
}

function fixedPuzzleCrop(w,h){
  const l = Math.round(FIXED_CROP.left * w / FIXED_CROP.refW);
  const t = Math.round(FIXED_CROP.top * h / FIXED_CROP.refH);
  const r = Math.round(FIXED_CROP.right * w / FIXED_CROP.refW);
  const b = Math.round(FIXED_CROP.bottom * h / FIXED_CROP.refH);
  return { x:l, y:t, w:Math.max(40, w-l-r), h:Math.max(40, h-t-b) };
}

cropBtn.addEventListener('click', () => { state.cropMode=!state.cropMode; cropBtn.textContent=state.cropMode?'Bereich aktiv':'Bereich wählen'; setStatus(state.cropMode?'Fallback: Rechteck manuell ziehen':'Fixer Crop aktiv'); draw(); });
detectBtn.addEventListener('click', () => { if(!state.image) return setStatus('Erst Screenshot laden'); detectIslands(); draw(); render(); });
addIslandBtn.addEventListener('click', () => { state.addMode=!state.addMode; addIslandBtn.textContent=state.addMode?'Tippen...':'+ Insel'; setStatus(state.addMode?'Auf das Board tippen, um Insel einzufügen':'Bereit'); });
nextMoveBtn.addEventListener('click', () => { const move=findNextMove(); state.pendingMove=move; applyMoveBtn.disabled=!move; renderMove(move); draw(); });
applyMoveBtn.addEventListener('click', () => { if(!state.pendingMove) return; applyBridge(state.pendingMove.a,state.pendingMove.b,state.pendingMove.targetCount); state.pendingMove=null; applyMoveBtn.disabled=true; moveBox.textContent='Move angewendet.'; draw(); render(); });
clearBtn.addEventListener('click', () => { state.islands=[]; state.bridges=[]; state.selectedId=null; state.nextId=1; state.pendingMove=null; state.crop = state.image ? fixedPuzzleCrop(canvas.width, canvas.height) : null; draw(); render(); setStatus('Zurückgesetzt'); });

canvas.addEventListener('pointerdown', e => { const p=eventPoint(e); if(state.cropMode){ state.drag={start:p,current:p}; return; } state.longPressTimer=setTimeout(()=>{ const hit=hitIsland(p.x,p.y); if(hit) removeIsland(hit.id); },650); });
canvas.addEventListener('pointermove', e => { if(state.cropMode && state.drag){ state.drag.current=eventPoint(e); draw(); } });
canvas.addEventListener('pointerup', e => { clearTimeout(state.longPressTimer); const p=eventPoint(e); if(state.cropMode && state.drag){ const a=state.drag.start,b=state.drag.current; const x=Math.min(a.x,b.x),y=Math.min(a.y,b.y),ww=Math.abs(a.x-b.x),hh=Math.abs(a.y-b.y); if(ww>40&&hh>40) state.crop={x:Math.round(x),y:Math.round(y),w:Math.round(ww),h:Math.round(hh)}; state.drag=null; draw(); setStatus('Manueller Bereich gesetzt'); return; } handleTap(p,e); });
canvas.addEventListener('contextmenu', e => { e.preventDefault(); const p=eventPoint(e); const hit=hitIsland(p.x,p.y); if(hit) removeIsland(hit.id); });

function eventPoint(e){ const r=canvas.getBoundingClientRect(); return { x:(e.clientX-r.left)*canvas.width/r.width, y:(e.clientY-r.top)*canvas.height/r.height }; }
function handleTap(p,e){
  const hit=hitIsland(p.x,p.y);
  if(e.shiftKey || state.addMode){ addIsland(p.x,p.y,1); state.addMode=false; addIslandBtn.textContent='+ Insel'; draw(); render(); return; }
  if(!hit){ state.selectedId=null; draw(); render(); return; }
  if(state.selectedId && state.selectedId!==hit.id){ const a=islandById(state.selectedId), b=hit; if(areAligned(a,b)&&!wouldCross(a.id,b.id)) applyBridge(a.id,b.id,(bridgeCount(a.id,b.id)+1)%3); else setStatus('Nur horizontal/vertikal ohne Kreuzung möglich'); state.selectedId=hit.id; } else state.selectedId=hit.id;
  draw(); render();
}
function hitIsland(x,y){ return state.islands.find(i => Math.hypot(i.x-x,i.y-y) <= islandRadius()+9); }
function addIsland(x,y,value){ state.islands.push({id:state.nextId++,x:Math.round(x),y:Math.round(y),value:clamp(Number(value)||1,1,8)}); }
function removeIsland(id){ state.islands=state.islands.filter(i=>i.id!==id); state.bridges=state.bridges.filter(b=>b.a!==id&&b.b!==id); if(state.selectedId===id) state.selectedId=null; draw(); render(); }
function applyBridge(a,b,count){ state.bridges=state.bridges.filter(br=>keyFor(br.a,br.b)!==keyFor(a,b)); if(count>0) state.bridges.push({a,b,count:clamp(count,1,2)}); }

function detectIslands(){
  drawBaseImage();
  const img=ctx.getImageData(0,0,canvas.width,canvas.height);
  const crop=state.crop ?? fixedPuzzleCrop(canvas.width, canvas.height);
  const minR=Math.max(9,Math.round(Math.min(crop.w,crop.h)*0.021));
  const maxR=Math.min(35,Math.round(Math.min(crop.w,crop.h)*0.060));
  const candidates=[];
  const step=3;
  for(let y=crop.y+maxR;y<crop.y+crop.h-maxR;y+=step){
    for(let x=crop.x+maxR;x<crop.x+crop.w-maxR;x+=step){
      let best=null;
      for(let r=minR;r<=maxR;r+=2){ const s=circleScore(img,x,y,r); if(!best || s.score>best.score) best={x,y,r,...s}; }
      if(best && best.score>0.48 && best.inner>0.018) candidates.push(best);
    }
  }
  candidates.sort((a,b)=>b.score-a.score);
  const picked=[];
  for(const c of candidates){
    if(picked.some(p=>Math.hypot(p.x-c.x,p.y-c.y)<Math.max(p.r,c.r)*1.28)) continue;
    picked.push(c);
  }
  state.islands=picked.sort((a,b)=>a.y-b.y||a.x-b.x).map(c=>({id:state.nextId++,x:Math.round(c.x),y:Math.round(c.y),value:1}));
  state.bridges=[]; state.selectedId=null; state.pendingMove=null;
  setStatus(`${state.islands.length} Inseln im festen Crop erkannt. Zahlen bitte korrigieren.`);
}
function isBright(data,w,x,y){ x=Math.round(x); y=Math.round(y); if(x<0||y<0||x>=canvas.width||y>=canvas.height) return false; const i=(y*w+x)*4; const r=data[i],g=data[i+1],b=data[i+2]; const avg=(r+g+b)/3,diff=Math.max(r,g,b)-Math.min(r,g,b); return avg>142 && diff<95; }
function circleScore(img,x,y,r){
  const data=img.data,w=img.width;
  let ring=0,total=0,inner=0,innerTotal=0;
  for(let a=0;a<Math.PI*2;a+=Math.PI/28){ for(const rr of [r-1,r,r+1]){ total++; if(isBright(data,w,x+Math.cos(a)*rr,y+Math.sin(a)*rr)) ring++; } }
  for(let yy=-r*.50;yy<=r*.50;yy+=3){ for(let xx=-r*.50;xx<=r*.50;xx+=3){ innerTotal++; if(isBright(data,w,x+xx,y+yy)) inner++; } }
  return {score:ring/total, inner:inner/innerTotal};
}

function drawBaseImage(){ ctx.clearRect(0,0,canvas.width,canvas.height); if(state.image) ctx.drawImage(state.image,0,0,canvas.width,canvas.height); else { ctx.fillStyle='#070b10'; ctx.fillRect(0,0,canvas.width,canvas.height); } }
function draw(){ drawBaseImage(); drawCrop(); drawBridges(); if(state.pendingMove) drawSuggestedMove(state.pendingMove); drawIslands(); }
function drawCrop(){ const c=state.drag?rectFromDrag(state.drag):state.crop; if(!c) return; ctx.save(); ctx.strokeStyle=state.cropMode?'#ffd36f':'rgba(255,211,111,.8)'; ctx.lineWidth=3; ctx.setLineDash([8,6]); ctx.strokeRect(c.x,c.y,c.w,c.h); ctx.restore(); }
function rectFromDrag(d){ const x=Math.min(d.start.x,d.current.x), y=Math.min(d.start.y,d.current.y); return {x,y,w:Math.abs(d.start.x-d.current.x),h:Math.abs(d.start.y-d.current.y)}; }
function drawBridges(){ for(const br of state.bridges){ const a=islandById(br.a), b=islandById(br.b); if(a&&b) drawBridgeLine(a,b,br.count,'#9fe4ff',5); } }
function drawSuggestedMove(m){ const a=islandById(m.a), b=islandById(m.b); if(a&&b) drawBridgeLine(a,b,m.targetCount,'#ffd36f',8); }
function drawBridgeLine(a,b,count,color,width){ ctx.strokeStyle=color; ctx.lineWidth=width; ctx.lineCap='round'; const horizontal=Math.abs(a.x-b.x)>Math.abs(a.y-b.y); const offsets=count===2?[-5,5]:[0]; for(const o of offsets){ ctx.beginPath(); ctx.moveTo(a.x+(horizontal?0:o),a.y+(horizontal?o:0)); ctx.lineTo(b.x+(horizontal?0:o),b.y+(horizontal?o:0)); ctx.stroke(); } }
function drawIslands(){ const r=islandRadius(); for(const i of state.islands){ ctx.beginPath(); ctx.arc(i.x,i.y,r,0,Math.PI*2); ctx.fillStyle=i.id===state.selectedId?'#15384a':'#111923'; ctx.fill(); ctx.lineWidth=i.id===state.selectedId?5:4; ctx.strokeStyle='#eef3f8'; ctx.stroke(); ctx.fillStyle='#eef3f8'; ctx.font=`800 ${Math.round(r*1.25)}px system-ui`; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText(i.value,i.x,i.y+1); } }

function render(){ renderSelection(); renderIslands(); renderValidation(); }
function renderSelection(){ const i=islandById(state.selectedId); selectionBox.textContent=i?`Insel #${i.id}: Wert ${i.value}, Rest ${remaining(i.id)}`:'Keine Insel ausgewählt.'; }
function renderIslands(){ islandList.innerHTML=''; for(const i of state.islands){ const row=document.createElement('div'); row.className='islandRow'; const label=document.createElement('div'); label.textContent=`#${i.id} (${Math.round(i.x)}, ${Math.round(i.y)})`; const input=document.createElement('input'); input.type='number'; input.min='1'; input.max='8'; input.value=i.value; input.addEventListener('change',()=>{i.value=clamp(Number(input.value)||1,1,8); draw(); render();}); const del=document.createElement('button'); del.textContent='×'; del.addEventListener('click',()=>removeIsland(i.id)); row.append(label,input,del); islandList.append(row); } }
function renderMove(move){ if(!move){ moveBox.textContent='Kein sicherer logischer Move gefunden.'; return; } const a=islandById(move.a), b=islandById(move.b); moveBox.innerHTML=`<b>${move.action}</b><br>#${a.id} ↔ #${b.id}: auf <b>${move.targetCount}</b> Brücke(n).<br><br>${move.reason}`; }
function renderValidation(){ validationBox.innerHTML=state.islands.map(i=>{ const u=usedCount(i.id), r=i.value-u; const cls=r<0?'bad':r===0?'ok':''; return `<div class="${cls}">#${i.id}: ${u}/${i.value}${r>0?`, Rest ${r}`:''}</div>`; }).join('') || '<div class="muted">Noch keine Inseln.</div>'; }

function areAligned(a,b){ return Math.abs(a.x-b.x)<20 || Math.abs(a.y-b.y)<20; }
function segment(a,b){ const h=Math.abs(a.x-b.x)>Math.abs(a.y-b.y); return {h,x1:Math.min(a.x,b.x),x2:Math.max(a.x,b.x),y1:Math.min(a.y,b.y),y2:Math.max(a.y,b.y),x:h?null:(a.x+b.x)/2,y:h?(a.y+b.y)/2:null}; }
function wouldCross(aId,bId){ const a=islandById(aId), b=islandById(bId); if(!a||!b) return true; const s=segment(a,b); for(const br of state.bridges){ if([br.a,br.b].includes(aId)||[br.a,br.b].includes(bId)) continue; const c=islandById(br.a), d=islandById(br.b); const t=segment(c,d); if(s.h===t.h) continue; const h=s.h?s:t, v=s.h?t:s; if(v.x>h.x1&&v.x<h.x2&&h.y>v.y1&&h.y<v.y2) return true; } return false; }
function visibleNeighbors(id){ const i=islandById(id); if(!i) return []; const dirs=[{p:j=>j.x>i.x&&Math.abs(j.y-i.y)<24,s:(a,b)=>a.x-b.x},{p:j=>j.x<i.x&&Math.abs(j.y-i.y)<24,s:(a,b)=>b.x-a.x},{p:j=>j.y>i.y&&Math.abs(j.x-i.x)<24,s:(a,b)=>a.y-b.y},{p:j=>j.y<i.y&&Math.abs(j.x-i.x)<24,s:(a,b)=>b.y-a.y}]; return dirs.map(d=>state.islands.filter(j=>j.id!==id&&d.p(j)).sort(d.s)[0]).filter(Boolean).filter(n=>!wouldCross(id,n.id)); }
function usedCount(id){ return state.bridges.reduce((s,b)=>s+(b.a===id||b.b===id?b.count:0),0); }
function remaining(id){ const i=islandById(id); return i?i.value-usedCount(id):0; }
function capacity(a,b){ return 2-bridgeCount(a,b); }
function possibleNeighbors(id){ return visibleNeighbors(id).filter(n=>remaining(n.id)>0&&capacity(id,n.id)>0); }
function findNextMove(){ for(const i of state.islands){ const rem=remaining(i.id); if(rem<=0) continue; const ns=possibleNeighbors(i.id); if(!ns.length) continue; const capSum=ns.reduce((s,n)=>s+capacity(i.id,n.id),0); if(rem===capSum){ const n=ns.find(n=>capacity(i.id,n.id)>0); return {a:i.id,b:n.id,targetCount:bridgeCount(i.id,n.id)+capacity(i.id,n.id),action:'Alle Kapazitäten nutzen',reason:`Restbedarf ${rem}, mögliche Gesamtkapazität ${capSum}. Also muss jede mögliche Verbindung maximal gesetzt werden.`}; } for(const n of ns){ const otherCap=capSum-capacity(i.id,n.id), min=rem-otherCap; if(min>0&&bridgeCount(i.id,n.id)<min) return {a:i.id,b:n.id,targetCount:min,action:'Mindestbrücke erzwungen',reason:`Andere Nachbarn können zusammen höchstens ${otherCap} liefern. Deshalb braucht diese Verbindung mindestens ${min}.`}; } if(rem===ns.length){ const n=ns.find(n=>bridgeCount(i.id,n.id)===0); if(n) return {a:i.id,b:n.id,targetCount:1,action:'Eine Brücke zu jedem Nachbarn',reason:`Restbedarf ${rem} und genau ${ns.length} mögliche Nachbarn.`}; } } return null; }

draw(); render();
