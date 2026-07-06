const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const imageInput = document.getElementById('imageInput');
const detectBtn = document.getElementById('detectBtn');
const addIslandBtn = document.getElementById('addIslandBtn');
const nextMoveBtn = document.getElementById('nextMoveBtn');
const applyMoveBtn = document.getElementById('applyMoveBtn');
const clearBtn = document.getElementById('clearBtn');
const statusEl = document.getElementById('status');
const islandList = document.getElementById('islandList');
const selectionBox = document.getElementById('selectionBox');
const moveBox = document.getElementById('moveBox');
const validationBox = document.getElementById('validationBox');

const state = {
  image: null,
  islands: [],
  bridges: [],
  selectedId: null,
  nextId: 1,
  pendingMove: null,
  addMode: false,
};

function setStatus(text) { statusEl.textContent = text; }
function dist(a,b){ return Math.hypot(a.x-b.x,a.y-b.y); }
function clamp(n,min,max){ return Math.max(min, Math.min(max, n)); }
function islandById(id){ return state.islands.find(i => i.id === id); }
function keyFor(a,b){ return [a,b].sort((x,y)=>x-y).join('-'); }
function bridgeBetween(a,b){ const key = keyFor(a,b); return state.bridges.find(br => keyFor(br.a, br.b) === key); }
function bridgeCount(a,b){ return bridgeBetween(a,b)?.count ?? 0; }

imageInput.addEventListener('change', async e => {
  const file = e.target.files?.[0];
  if (!file) return;
  const img = new Image();
  img.onload = () => {
    const max = 1100;
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    state.image = img;
    state.islands = [];
    state.bridges = [];
    state.selectedId = null;
    state.nextId = 1;
    state.pendingMove = null;
    draw();
    render();
    setStatus('Screenshot geladen');
  };
  img.src = URL.createObjectURL(file);
});

detectBtn.addEventListener('click', () => {
  if (!state.image) { setStatus('Erst Screenshot laden'); return; }
  detectIslands();
  draw();
  render();
});

addIslandBtn.addEventListener('click', () => {
  state.addMode = !state.addMode;
  addIslandBtn.textContent = state.addMode ? 'Hinzufügen aktiv' : 'Insel hinzufügen';
  setStatus(state.addMode ? 'Auf das Board klicken, um eine Insel einzufügen' : 'Bereit');
});

nextMoveBtn.addEventListener('click', () => {
  const move = findNextMove();
  state.pendingMove = move;
  applyMoveBtn.disabled = !move;
  renderMove(move);
  draw();
});

applyMoveBtn.addEventListener('click', () => {
  if (!state.pendingMove) return;
  applyBridge(state.pendingMove.a, state.pendingMove.b, state.pendingMove.targetCount);
  state.pendingMove = null;
  applyMoveBtn.disabled = true;
  moveBox.textContent = 'Move angewendet.';
  draw();
  render();
});

clearBtn.addEventListener('click', () => {
  state.islands = [];
  state.bridges = [];
  state.selectedId = null;
  state.nextId = 1;
  state.pendingMove = null;
  draw();
  render();
  setStatus('Zurückgesetzt');
});

canvas.addEventListener('contextmenu', e => {
  e.preventDefault();
  const p = eventPoint(e);
  const hit = hitIsland(p.x, p.y);
  if (hit) removeIsland(hit.id);
});

canvas.addEventListener('click', e => {
  const p = eventPoint(e);
  const hit = hitIsland(p.x, p.y);
  if (e.shiftKey || state.addMode) {
    addIsland(p.x, p.y, 1);
    state.addMode = false;
    addIslandBtn.textContent = 'Insel hinzufügen';
    draw(); render(); return;
  }
  if (!hit) { state.selectedId = null; draw(); render(); return; }
  if (state.selectedId && state.selectedId !== hit.id) {
    const a = islandById(state.selectedId);
    const b = hit;
    if (areAligned(a,b) && !wouldCross(a.id,b.id)) {
      const current = bridgeCount(a.id,b.id);
      applyBridge(a.id,b.id,(current + 1) % 3);
    } else setStatus('Nur horizontal/vertikal ohne Kreuzung möglich');
    state.selectedId = hit.id;
  } else state.selectedId = hit.id;
  draw(); render();
});

function eventPoint(e) {
  const r = canvas.getBoundingClientRect();
  return { x: (e.clientX - r.left) * canvas.width / r.width, y: (e.clientY - r.top) * canvas.height / r.height };
}

function hitIsland(x,y) {
  return state.islands.find(i => Math.hypot(i.x-x, i.y-y) <= islandRadius(i) + 8);
}
function islandRadius(){ return Math.max(17, Math.min(canvas.width, canvas.height) * 0.026); }

function addIsland(x,y,value){
  state.islands.push({ id: state.nextId++, x: Math.round(x), y: Math.round(y), value: clamp(Number(value)||1,1,8) });
}
function removeIsland(id){
  state.islands = state.islands.filter(i => i.id !== id);
  state.bridges = state.bridges.filter(b => b.a !== id && b.b !== id);
  if (state.selectedId === id) state.selectedId = null;
  draw(); render();
}
function applyBridge(a,b,count){
  const key = keyFor(a,b);
  state.bridges = state.bridges.filter(br => keyFor(br.a,br.b) !== key);
  if (count > 0) state.bridges.push({ a, b, count: clamp(count,1,2) });
}

function detectIslands(){
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0,0,w,h);
  ctx.drawImage(state.image,0,0,w,h);
  const img = ctx.getImageData(0,0,w,h);
  const data = img.data;
  const mask = new Uint8Array(w*h);
  for (let y=0; y<h; y++) for (let x=0; x<w; x++) {
    const idx = (y*w+x)*4;
    const r=data[idx], g=data[idx+1], b=data[idx+2];
    const max=Math.max(r,g,b), min=Math.min(r,g,b);
    const bright = (r+g+b)/3;
    // White/gray UI strokes and digits, but not the dark background.
    if (bright > 150 && max-min < 70) mask[y*w+x]=1;
  }
  const visited = new Uint8Array(w*h);
  const comps = [];
  const qx = [], qy = [];
  for (let y=0; y<h; y+=2) for (let x=0; x<w; x+=2) {
    const start = y*w+x;
    if (!mask[start] || visited[start]) continue;
    let head=0, count=0, sx=0, sy=0, minX=x, maxX=x, minY=y, maxY=y;
    qx.length=0; qy.length=0; qx.push(x); qy.push(y); visited[start]=1;
    while(head<qx.length){
      const cx=qx[head], cy=qy[head++]; count++; sx+=cx; sy+=cy;
      if(cx<minX)minX=cx; if(cx>maxX)maxX=cx; if(cy<minY)minY=cy; if(cy>maxY)maxY=cy;
      const ns=[[cx+1,cy],[cx-1,cy],[cx,cy+1],[cx,cy-1]];
      for(const [nx,ny] of ns){
        if(nx<0||ny<0||nx>=w||ny>=h) continue;
        const ni=ny*w+nx;
        if(mask[ni]&&!visited[ni]){visited[ni]=1; qx.push(nx); qy.push(ny);}
      }
    }
    const bw=maxX-minX+1, bh=maxY-minY+1;
    if(count>70 && bw>16 && bh>16 && bw<90 && bh<90){
      const ratio=bw/bh;
      if(ratio>.65 && ratio<1.45) comps.push({x:sx/count,y:sy/count,w:bw,h:bh,count,minX,maxX,minY,maxY});
    }
  }

  // Merge ring/digit pieces belonging to the same island.
  const merged=[];
  const maxMerge = Math.max(26, Math.min(w,h)*0.045);
  for (const c of comps) {
    const existing = merged.find(m => Math.hypot(m.x-c.x,m.y-c.y) < maxMerge);
    if (existing) {
      const total = existing.count + c.count;
      existing.x = (existing.x*existing.count + c.x*c.count)/total;
      existing.y = (existing.y*existing.count + c.y*c.count)/total;
      existing.count = total;
      existing.minX=Math.min(existing.minX,c.minX); existing.maxX=Math.max(existing.maxX,c.maxX);
      existing.minY=Math.min(existing.minY,c.minY); existing.maxY=Math.max(existing.maxY,c.maxY);
    } else merged.push({...c});
  }

  state.islands = merged
    .filter(c => c.count > 120)
    .sort((a,b)=>a.y-b.y || a.x-b.x)
    .map(c => ({ id: state.nextId++, x: Math.round(c.x), y: Math.round(c.y), value: guessDigit(c) ?? 1 }));
  state.bridges = [];
  setStatus(`${state.islands.length} Inseln erkannt. Zahlen bitte kontrollieren.`);
}

function guessDigit(c){
  // Absichtlich konservativ: ohne OCR-Library ist das nur eine grobe Heuristik.
  // Der Editiermodus ist daher der primäre Weg zur Korrektur.
  return 1;
}

function draw(){
  ctx.clearRect(0,0,canvas.width,canvas.height);
  if (state.image) ctx.drawImage(state.image,0,0,canvas.width,canvas.height);
  else { ctx.fillStyle='#0c1117'; ctx.fillRect(0,0,canvas.width,canvas.height); drawEmptyGrid(); }
  drawBridges();
  if (state.pendingMove) drawSuggestedMove(state.pendingMove);
  drawIslands();
}
function drawEmptyGrid(){
  ctx.strokeStyle='#27323d'; ctx.lineWidth=1;
  for(let x=60;x<canvas.width;x+=70){ctx.beginPath();ctx.moveTo(x,40);ctx.lineTo(x,canvas.height-40);ctx.stroke();}
  for(let y=60;y<canvas.height;y+=70){ctx.beginPath();ctx.moveTo(40,y);ctx.lineTo(canvas.width-40,y);ctx.stroke();}
}
function drawBridges(){
  for(const br of state.bridges){
    const a=islandById(br.a), b=islandById(br.b); if(!a||!b) continue;
    drawBridgeLine(a,b,br.count,'#9fe4ff',5);
  }
}
function drawSuggestedMove(m){
  const a=islandById(m.a), b=islandById(m.b); if(!a||!b) return;
  drawBridgeLine(a,b,m.targetCount,'#ffd36f',8);
}
function drawBridgeLine(a,b,count,color,width){
  ctx.strokeStyle=color; ctx.lineWidth=width; ctx.lineCap='round';
  const off = count===2 ? 5 : 0;
  const dx = Math.abs(a.x-b.x) > Math.abs(a.y-b.y);
  const offsets = count===2 ? [-off, off] : [0];
  for(const o of offsets){
    ctx.beginPath();
    ctx.moveTo(a.x + (dx?0:o), a.y + (dx?o:0));
    ctx.lineTo(b.x + (dx?0:o), b.y + (dx?o:0));
    ctx.stroke();
  }
}
function drawIslands(){
  const r = islandRadius();
  for(const i of state.islands){
    ctx.beginPath(); ctx.arc(i.x,i.y,r,0,Math.PI*2);
    ctx.fillStyle = i.id === state.selectedId ? '#15384a' : '#111923';
    ctx.fill(); ctx.lineWidth = i.id === state.selectedId ? 5 : 4; ctx.strokeStyle='#eef3f8'; ctx.stroke();
    ctx.fillStyle='#eef3f8'; ctx.font=`700 ${Math.round(r*1.25)}px system-ui`; ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText(i.value, i.x, i.y+1);
  }
}

function render(){
  renderSelection(); renderIslands(); renderValidation();
}
function renderSelection(){
  const i = islandById(state.selectedId);
  selectionBox.textContent = i ? `Insel #${i.id}: Wert ${i.value}, Rest ${remaining(i.id)}` : 'Keine Insel ausgewählt.';
}
function renderIslands(){
  islandList.innerHTML='';
  for(const i of state.islands){
    const row=document.createElement('div'); row.className='islandRow';
    const label=document.createElement('div'); label.textContent=`#${i.id} (${Math.round(i.x)}, ${Math.round(i.y)})`;
    const input=document.createElement('input'); input.type='number'; input.min='1'; input.max='8'; input.value=i.value;
    input.addEventListener('change',()=>{ i.value=clamp(Number(input.value)||1,1,8); draw(); render(); });
    const del=document.createElement('button'); del.textContent='×'; del.title='Löschen'; del.addEventListener('click',()=>removeIsland(i.id));
    row.append(label,input,del); islandList.append(row);
  }
}
function renderMove(move){
  if(!move){ moveBox.textContent='Kein sicherer logischer Move gefunden.'; return; }
  const a=islandById(move.a), b=islandById(move.b);
  moveBox.innerHTML = `<b>${move.action}</b><br>Insel #${a.id} (${a.value}) ↔ Insel #${b.id} (${b.value}): auf <b>${move.targetCount}</b> Brücke(n) setzen.<br><br>${move.reason}`;
}
function renderValidation(){
  const issues=[];
  for(const i of state.islands){
    const used = usedCount(i.id);
    const rem = i.value-used;
    if(rem<0) issues.push(`<div class="bad">#${i.id}: zu viele Brücken (${used}/${i.value})</div>`);
    else if(rem===0) issues.push(`<div class="ok">#${i.id}: erfüllt (${used}/${i.value})</div>`);
    else issues.push(`<div>#${i.id}: ${used}/${i.value}, Rest ${rem}</div>`);
  }
  validationBox.innerHTML = issues.join('') || '<div class="muted">Noch keine Inseln.</div>';
}

function areAligned(a,b){ return Math.abs(a.x-b.x)<18 || Math.abs(a.y-b.y)<18; }
function segment(a,b){ const horizontal=Math.abs(a.x-b.x)>Math.abs(a.y-b.y); return {horizontal,x1:Math.min(a.x,b.x),x2:Math.max(a.x,b.x),y1:Math.min(a.y,b.y),y2:Math.max(a.y,b.y),x:horizontal?null:(a.x+b.x)/2,y:horizontal?(a.y+b.y)/2:null}; }
function wouldCross(aId,bId){
  const a=islandById(aId), b=islandById(bId); if(!a||!b) return true;
  const s=segment(a,b);
  for(const br of state.bridges){
    if(br.a===aId||br.b===aId||br.a===bId||br.b===bId) continue;
    const c=islandById(br.a), d=islandById(br.b); if(!c||!d) continue;
    const t=segment(c,d);
    if(s.horizontal===t.horizontal) continue;
    const h=s.horizontal?s:t, v=s.horizontal?t:s;
    if(v.x>h.x1 && v.x<h.x2 && h.y>v.y1 && h.y<v.y2) return true;
  }
  return false;
}
function visibleNeighbors(id){
  const i=islandById(id); if(!i) return [];
  const dirs=[
    {name:'rechts', pred:j=>j.x>i.x&&Math.abs(j.y-i.y)<22, sort:(a,b)=>a.x-b.x},
    {name:'links', pred:j=>j.x<i.x&&Math.abs(j.y-i.y)<22, sort:(a,b)=>b.x-a.x},
    {name:'unten', pred:j=>j.y>i.y&&Math.abs(j.x-i.x)<22, sort:(a,b)=>a.y-b.y},
    {name:'oben', pred:j=>j.y<i.y&&Math.abs(j.x-i.x)<22, sort:(a,b)=>b.y-a.y},
  ];
  const result=[];
  for(const d of dirs){
    const n=state.islands.filter(j=>j.id!==id&&d.pred(j)).sort(d.sort)[0];
    if(n && !wouldCross(id,n.id)) result.push(n);
  }
  return result;
}
function usedCount(id){ return state.bridges.reduce((sum,b)=>sum + (b.a===id||b.b===id ? b.count : 0),0); }
function remaining(id){ const i=islandById(id); return i ? i.value-usedCount(id) : 0; }
function capacity(aId,bId){ return 2 - bridgeCount(aId,bId); }
function possibleNeighbors(id){ return visibleNeighbors(id).filter(n => remaining(n.id)>0 && capacity(id,n.id)>0); }

function findNextMove(){
  for(const i of state.islands){
    const rem=remaining(i.id); if(rem<=0) continue;
    const ns=possibleNeighbors(i.id);
    const capSum=ns.reduce((s,n)=>s+capacity(i.id,n.id),0);
    if(ns.length===0) continue;
    if(rem===capSum){
      const n=ns.find(n=>capacity(i.id,n.id)>0);
      return {a:i.id,b:n.id,targetCount:bridgeCount(i.id,n.id)+capacity(i.id,n.id),action:'Alle Kapazitäten müssen genutzt werden',reason:`Insel #${i.id} hat Restbedarf ${rem}. Die Summe der noch möglichen Brücken zu allen sichtbaren Nachbarn ist ebenfalls ${capSum}. Daher muss jede mögliche Verbindung maximal gesetzt werden.`};
    }
    for(const n of ns){
      const otherCap=capSum-capacity(i.id,n.id);
      const minNeeded=rem-otherCap;
      if(minNeeded>0 && bridgeCount(i.id,n.id)<minNeeded){
        return {a:i.id,b:n.id,targetCount:minNeeded,action:'Mindestbrücke erzwungen',reason:`Insel #${i.id} braucht noch ${rem}. Alle anderen Nachbarn zusammen können höchstens ${otherCap} liefern. Deshalb braucht die Verbindung zu #${n.id} mindestens ${minNeeded} Brücke(n).`};
      }
    }
    if(rem===ns.length){
      const n=ns.find(n=>bridgeCount(i.id,n.id)===0);
      if(n) return {a:i.id,b:n.id,targetCount:1,action:'Eine Brücke zu jedem möglichen Nachbarn',reason:`Insel #${i.id} hat Restbedarf ${rem} und genau ${ns.length} mögliche Nachbarn. Da jede genutzte Richtung mindestens eine Brücke braucht, muss zu jedem dieser Nachbarn eine Brücke gesetzt werden.`};
    }
  }
  return null;
}

draw(); render();
