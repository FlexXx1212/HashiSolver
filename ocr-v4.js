(() => {
  const overlay = document.createElement('div');
  overlay.id = 'processingOverlay';
  overlay.innerHTML = '<div class="spinner"></div><div>Screenshot wird verarbeitet…</div>';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;display:none;align-items:center;justify-content:center;flex-direction:column;gap:14px;background:rgba(3,8,13,.72);backdrop-filter:blur(4px);color:#eef3f8;font-weight:800;font-size:18px';
  const style = document.createElement('style');
  style.textContent = '#processingOverlay .spinner{width:46px;height:46px;border-radius:50%;border:5px solid rgba(255,255,255,.22);border-top-color:#62d7ff;animation:spin .85s linear infinite}@keyframes spin{to{transform:rotate(360deg)}} .ocrLow input{border-color:#ffd36f!important;background:#2b2414!important}';
  document.head.append(style);
  document.body.append(overlay);

  const show = () => overlay.style.display = 'flex';
  const hide = () => overlay.style.display = 'none';
  const baseDetect = detectAndRebuild;
  const baseRenderIslands = renderIslands;

  detectAndRebuild = function () {
    if (!state?.sctx) return baseDetect();
    show();
    setTimeout(() => {
      try {
        detectIslands();
        detectBridges();
        recognizeDigitsV4();
        draw();
        render();
        const doubles = state.bridges.filter(b => b.count === 2).length;
        const low = state.islands.filter(i => (i.confidence ?? 0) < .82).length;
        setStatus(`${state.islands.length} Inseln, ${state.bridges.length} Brücken (${doubles} doppelt). ${low ? low + ' unsichere Zahlen.' : 'OCR ok.'}`);
      } finally {
        hide();
      }
    }, 40);
  };

  renderIslands = function () {
    baseRenderIslands();
    [...islandList.querySelectorAll('.islandRow')].forEach((row, idx) => {
      const island = state.islands[idx];
      if (!island) return;
      if ((island.confidence ?? 0) < .82) row.classList.add('ocrLow');
      const input = row.querySelector('input');
      if (!input) return;
      input.addEventListener('change', () => saveTemplateFromIsland(island, Number(input.value)));
    });
  };

  function recognizeDigitsV4() {
    const img = state.sctx.getImageData(0, 0, canvas.width, canvas.height);
    for (const island of state.islands) {
      const bitmap = extractDigitBitmap(img, island, 28);
      const trained = matchTrainedTemplates(bitmap);
      if (trained && trained.confidence > .72) {
        island.value = trained.value;
        island.confidence = trained.confidence;
      } else {
        const builtIn = matchBuiltInTemplates(bitmap);
        const heuristic = classifyByFeatures(bitmap, 28);
        if (builtIn.confidence > .80) {
          island.value = builtIn.value;
          island.confidence = builtIn.confidence;
        } else {
          island.value = heuristic.value;
          island.confidence = Math.max(.45, Math.min(.78, heuristic.confidence));
        }
      }
    }
  }

  function saveTemplateFromIsland(island, value) {
    if (!state?.sctx || !value || value < 1 || value > 8) return;
    const img = state.sctx.getImageData(0, 0, canvas.width, canvas.height);
    const bitmap = extractDigitBitmap(img, island, 28);
    const all = loadTemplates();
    all[value] ||= [];
    const encoded = bitmap.join('');
    if (!all[value].includes(encoded)) all[value].push(encoded);
    all[value] = all[value].slice(-12);
    localStorage.setItem('hashiDigitTemplatesV1', JSON.stringify(all));
    island.value = value;
    island.confidence = 1;
    setStatus(`Template für ${value} gespeichert. Danach Erkennen drücken.`);
  }

  function loadTemplates() {
    try { return JSON.parse(localStorage.getItem('hashiDigitTemplatesV1') || '{}'); }
    catch { return {}; }
  }

  function matchTrainedTemplates(bitmap) {
    const all = loadTemplates();
    let best = null;
    for (const [value, arr] of Object.entries(all)) {
      for (const encoded of arr) {
        const tpl = encoded.split('').map(x => x === '1' ? 1 : 0);
        const score = scoreBitmap(bitmap, tpl);
        if (!best || score < best.score) best = { value:Number(value), score };
      }
    }
    return best ? { value:best.value, confidence:1 - best.score } : null;
  }

  const builtInCache = new Map();
  function matchBuiltInTemplates(bitmap) {
    let best = { value:1, score:999 };
    for (let n = 1; n <= 8; n++) {
      for (const font of ['700 22px Arial','800 22px Arial','700 22px system-ui','800 22px system-ui']) {
        const tpl = builtInTemplate(n, font);
        const score = scoreBitmap(bitmap, tpl);
        if (score < best.score) best = { value:n, score };
      }
    }
    return { value:best.value, confidence:1 - best.score };
  }

  function builtInTemplate(n, font) {
    const key = n + font;
    if (builtInCache.has(key)) return builtInCache.get(key);
    const size = 28;
    const c = document.createElement('canvas'); c.width = c.height = size;
    const g = c.getContext('2d');
    g.fillStyle = '#000'; g.fillRect(0,0,size,size);
    g.fillStyle = '#fff'; g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(String(n), size/2, size/2 + 1);
    const d = g.getImageData(0,0,size,size).data;
    const raw = [];
    for (let i=0;i<d.length;i+=4) raw.push(d[i] > 70 ? 1 : 0);
    const norm = normalize(raw, size, 28);
    builtInCache.set(key, norm);
    return norm;
  }

  function extractDigitBitmap(img, island, outSize) {
    const r = islandRadius();
    const size = 38;
    const raw = new Array(size*size).fill(0);
    const scale = (r * 1.28) / size;
    for (let y=0;y<size;y++) for (let x=0;x<size;x++) {
      const dx = x - size/2 + .5, dy = y - size/2 + .5;
      if (Math.hypot(dx, dy) > size * .36) continue;
      const sx = island.x + dx * scale, sy = island.y + dy * scale;
      if (bright(img, sx, sy)) raw[y*size+x] = 1;
    }
    removeLongLines(raw, size);
    return normalize(keepCenterComponents(raw, size), size, outSize);
  }

  function removeLongLines(b, size) {
    for (let y=0;y<size;y++) {
      let count = 0; for (let x=0;x<size;x++) count += b[y*size+x];
      if (count > size * .52) for (let x=0;x<size;x++) b[y*size+x] = 0;
    }
    for (let x=0;x<size;x++) {
      let count = 0; for (let y=0;y<size;y++) count += b[y*size+x];
      if (count > size * .52) for (let y=0;y<size;y++) b[y*size+x] = 0;
    }
  }

  function keepCenterComponents(b, size) {
    const seen = new Array(size*size).fill(false), comps = [];
    for (let y=0;y<size;y++) for (let x=0;x<size;x++) {
      const idx = y*size+x; if (!b[idx] || seen[idx]) continue;
      const q=[[x,y]]; seen[idx]=true; let head=0, count=0, sx=0, sy=0;
      while(head<q.length){const [px,py]=q[head++]; count++; sx+=px; sy+=py; for(const [nx,ny] of [[px+1,py],[px-1,py],[px,py+1],[px,py-1]]){if(nx<0||ny<0||nx>=size||ny>=size)continue;const ni=ny*size+nx;if(b[ni]&&!seen[ni]){seen[ni]=true;q.push([nx,ny]);}}}
      const cx=sx/count, cy=sy/count, dist=Math.hypot(cx-size/2, cy-size/2);
      comps.push({pixels:q, score:count - dist*1.6, count});
    }
    comps.sort((a,b)=>b.score-a.score);
    const out = new Array(size*size).fill(0);
    for (const c of comps.slice(0,2)) if (c.count >= 3) for (const [x,y] of c.pixels) out[y*size+x]=1;
    return out;
  }

  function normalize(b, size, outSize) {
    let minX=size,maxX=-1,minY=size,maxY=-1;
    for(let y=0;y<size;y++)for(let x=0;x<size;x++)if(b[y*size+x]){minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);}
    const out = new Array(outSize*outSize).fill(0); if(maxX<0) return out;
    const bw=maxX-minX+1,bh=maxY-minY+1,sc=Math.max(bw,bh)/(outSize*.72),ox=(outSize-bw/sc)/2,oy=(outSize-bh/sc)/2;
    for(let y=0;y<outSize;y++)for(let x=0;x<outSize;x++){const sx=Math.round(minX+(x-ox)*sc),sy=Math.round(minY+(y-oy)*sc); if(sx>=0&&sy>=0&&sx<size&&sy<size&&b[sy*size+sx]) out[y*outSize+x]=1;}
    return out;
  }

  function scoreBitmap(a,b){let diff=0,union=0;for(let i=0;i<a.length;i++){if(a[i]||b[i]) union++; if(a[i]!==b[i]) diff++;} return union ? diff/union : 1;}

  function classifyByFeatures(b, s) {
    let pix=0,minX=s,maxX=-1,minY=s,maxY=-1;
    for(let y=0;y<s;y++)for(let x=0;x<s;x++)if(b[y*s+x]){pix++;minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);}
    const width = maxX>=0 ? (maxX-minX+1)/s : 0;
    const z=(x1,y1,x2,y2)=>{let h=0,t=0;for(let y=Math.floor(y1*s);y<Math.floor(y2*s);y++)for(let x=Math.floor(x1*s);x<Math.floor(x2*s);x++){t++;if(b[y*s+x])h++;}return h/Math.max(1,t);};
    const top=z(.15,0,.85,.25), mid=z(.15,.36,.85,.64), bot=z(.15,.75,.85,1), ul=z(0,.18,.38,.5), ur=z(.62,.18,1,.5), ll=z(0,.5,.38,.88), lr=z(.62,.5,1,.88);
    if (pix < 10 || width < .28) return {value:1, confidence:.85};
    const holes = holesCount(b,s,minX,minY,maxX,maxY);
    if (holes >= 2) return {value:8, confidence:.9};
    if (holes === 1) return {value:(ul+ll>ur+lr ? 6 : 8), confidence:.82};
    if (top>.06 && ur>.03 && ll<.025 && mid<.055) return {value:7, confidence:.75};
    if (mid>.06 && ul>.025 && ur>.025 && bot<.045) return {value:4, confidence:.78};
    if (top>.05 && mid>.04 && bot>.04) {
      if (ur>ul*1.15 && ll>lr*1.1) return {value:2, confidence:.76};
      if (ur>ul*1.05 && lr>ll*1.05) return {value:3, confidence:.74};
      return {value:5, confidence:.72};
    }
    return {value:5, confidence:.5};
  }

  function holesCount(b,s,minX,minY,maxX,maxY){if(maxX<0)return 0;minX=Math.max(0,minX-1);minY=Math.max(0,minY-1);maxX=Math.min(s-1,maxX+1);maxY=Math.min(s-1,maxY+1);const key=(x,y)=>x+','+y,out=new Set(),q=[];for(let x=minX;x<=maxX;x++)q.push([x,minY],[x,maxY]);for(let y=minY;y<=maxY;y++)q.push([minX,y],[maxX,y]);while(q.length){const [x,y]=q.pop();if(x<minX||x>maxX||y<minY||y>maxY)continue;const k=key(x,y);if(out.has(k)||b[y*s+x])continue;out.add(k);q.push([x+1,y],[x-1,y],[x,y+1],[x,y-1]);}const seen=new Set();let holes=0;for(let y=minY;y<=maxY;y++)for(let x=minX;x<=maxX;x++){const k=key(x,y);if(b[y*s+x]||out.has(k)||seen.has(k))continue;holes++;const qq=[[x,y]];seen.add(k);while(qq.length){const [px,py]=qq.pop();for(const [nx,ny] of [[px+1,py],[px-1,py],[px,py+1],[px,py-1]]){const nk=key(nx,ny);if(nx<minX||nx>maxX||ny<minY||ny>maxY||b[ny*s+nx]||out.has(nk)||seen.has(nk))continue;seen.add(nk);qq.push([nx,ny]);}}}return holes;}

  function bright(img,x,y){x=Math.round(x);y=Math.round(y);if(x<0||y<0||x>=img.width||y>=img.height)return false;const i=(y*img.width+x)*4,r=img.data[i],g=img.data[i+1],b=img.data[i+2],avg=(r+g+b)/3,diff=Math.max(r,g,b)-Math.min(r,g,b);return avg>142&&diff<95;}
})();
