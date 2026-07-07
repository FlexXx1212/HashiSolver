(() => {
  const baseDetectAndRebuild = detectAndRebuild;

  detectAndRebuild = function detectAndRebuildWithOcrV2() {
    baseDetectAndRebuild();
    if (!state?.sctx || !state?.islands?.length) return;

    const img = state.sctx.getImageData(0, 0, canvas.width, canvas.height);
    for (const island of state.islands) {
      const result = recognizeDigitStructural(img, island);
      island.value = result.value;
      island.confidence = result.confidence;
      island.ocrDebug = result.debug;
    }

    detectBridgesV2(img);
    draw();
    render();
    const doubles = state.bridges.filter(b => b.count === 2).length;
    setStatus(`${state.islands.length} Inseln, ${state.bridges.length} Brücken, ${doubles} doppelt. OCR v2 aktiv.`);
  };

  function recognizeDigitStructural(img, island) {
    const bitmap = extractCentralGlyph(img, island);
    const f = features(bitmap, 24);
    const value = classify(f);
    return { value, confidence: f.conf, debug: f };
  }

  function extractCentralGlyph(img, island) {
    const size = 34;
    const r = islandRadius();
    const scale = (r * 1.35) / size;
    const raw = new Array(size * size).fill(0);

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = x - size / 2 + 0.5;
        const dy = y - size / 2 + 0.5;
        const d = Math.hypot(dx, dy);
        if (d > size * 0.34) continue;
        const sx = island.x + dx * scale;
        const sy = island.y + dy * scale;
        if (brightAt(img, sx, sy)) raw[y * size + x] = 1;
      }
    }

    const cleaned = keepRelevantComponents(raw, size);
    return normalize(cleaned, size, 24);
  }

  function keepRelevantComponents(b, size) {
    const seen = new Array(size * size).fill(false);
    const comps = [];
    const cx = size / 2;
    const cy = size / 2;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const idx = y * size + x;
      if (!b[idx] || seen[idx]) continue;
      const q = [[x, y]];
      seen[idx] = true;
      let head = 0, count = 0, sx = 0, sy = 0, minX = x, maxX = x, minY = y, maxY = y;
      while (head < q.length) {
        const [px, py] = q[head++];
        count++; sx += px; sy += py;
        minX = Math.min(minX, px); maxX = Math.max(maxX, px); minY = Math.min(minY, py); maxY = Math.max(maxY, py);
        for (const [nx, ny] of [[px+1,py],[px-1,py],[px,py+1],[px,py-1]]) {
          if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
          const ni = ny * size + nx;
          if (b[ni] && !seen[ni]) { seen[ni] = true; q.push([nx, ny]); }
        }
      }
      const mx = sx / count, my = sy / count;
      const centerDist = Math.hypot(mx - cx, my - cy);
      const touchesEdge = minX < 2 || minY < 2 || maxX > size - 3 || maxY > size - 3;
      const score = count - centerDist * 1.5 - (touchesEdge ? 40 : 0);
      comps.push({ count, minX, maxX, minY, maxY, score, pixels: q });
    }
    comps.sort((a, b) => b.score - a.score);
    const out = new Array(size * size).fill(0);
    for (const c of comps.slice(0, 2)) {
      if (c.count < 3) continue;
      for (const [x, y] of c.pixels) out[y * size + x] = 1;
    }
    return out;
  }

  function normalize(b, size, outSize) {
    let minX = size, maxX = -1, minY = size, maxY = -1;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      if (b[y * size + x]) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    }
    const out = new Array(outSize * outSize).fill(0);
    if (maxX < 0) return out;
    const bw = maxX - minX + 1;
    const bh = maxY - minY + 1;
    const scale = Math.max(bw, bh) / 18;
    const ox = (outSize - bw / scale) / 2;
    const oy = (outSize - bh / scale) / 2;
    for (let y = 0; y < outSize; y++) for (let x = 0; x < outSize; x++) {
      const sx = Math.round(minX + (x - ox) * scale);
      const sy = Math.round(minY + (y - oy) * scale);
      if (sx >= 0 && sy >= 0 && sx < size && sy < size && b[sy * size + sx]) out[y * outSize + x] = 1;
    }
    return out;
  }

  function features(b, s) {
    const zone = (x1, y1, x2, y2) => {
      let hit = 0, total = 0;
      for (let y = Math.floor(y1*s); y < Math.floor(y2*s); y++) for (let x = Math.floor(x1*s); x < Math.floor(x2*s); x++) {
        total++; if (b[y*s+x]) hit++;
      }
      return hit / Math.max(1, total);
    };
    let minX=s,maxX=-1,minY=s,maxY=-1,pix=0;
    for(let y=0;y<s;y++)for(let x=0;x<s;x++)if(b[y*s+x]){pix++;minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);}
    const width = maxX >= 0 ? (maxX-minX+1)/s : 0;
    const height = maxY >= 0 ? (maxY-minY+1)/s : 0;
    const holes = countHoles(b, s, minX, minY, maxX, maxY);
    const f = {
      pix, width, height, holes,
      top: zone(.18,.02,.82,.23),
      mid: zone(.18,.39,.82,.61),
      bottom: zone(.18,.77,.82,.98),
      ul: zone(.02,.17,.36,.48),
      ur: zone(.64,.17,.98,.48),
      ll: zone(.02,.54,.36,.86),
      lr: zone(.64,.54,.98,.86),
      center: zone(.36,.25,.64,.75)
    };
    f.conf = Math.min(0.99, Math.max(0.45, pix / 70));
    return f;
  }

  function countHoles(b, s, minX, minY, maxX, maxY) {
    if (maxX < 0) return 0;
    minX = Math.max(0, minX - 1); minY = Math.max(0, minY - 1); maxX = Math.min(s - 1, maxX + 1); maxY = Math.min(s - 1, maxY + 1);
    const outside = new Set();
    const key = (x,y)=>`${x},${y}`;
    const q = [];
    for(let x=minX;x<=maxX;x++){q.push([x,minY],[x,maxY]);}
    for(let y=minY;y<=maxY;y++){q.push([minX,y],[maxX,y]);}
    while(q.length){const [x,y]=q.pop(); if(x<minX||x>maxX||y<minY||y>maxY)continue; const k=key(x,y); if(outside.has(k)||b[y*s+x])continue; outside.add(k); q.push([x+1,y],[x-1,y],[x,y+1],[x,y-1]);}
    const seen = new Set(); let holes = 0;
    for(let y=minY;y<=maxY;y++)for(let x=minX;x<=maxX;x++){
      const k=key(x,y); if(b[y*s+x]||outside.has(k)||seen.has(k))continue;
      holes++; const qq=[[x,y]]; seen.add(k);
      while(qq.length){const [px,py]=qq.pop(); for(const [nx,ny] of [[px+1,py],[px-1,py],[px,py+1],[px,py-1]]){const nk=key(nx,ny); if(nx<minX||nx>maxX||ny<minY||ny>maxY||b[ny*s+nx]||outside.has(nk)||seen.has(nk))continue; seen.add(nk); qq.push([nx,ny]);}}
    }
    return holes;
  }

  function classify(f) {
    if (f.pix < 8) return 1;
    if (f.width < 0.30) return 1;
    if (f.holes >= 2) return 8;
    if (f.holes === 1) {
      if (f.ul > f.ur * 1.2 || f.ll > f.lr * 1.15) return 6;
      return 8;
    }
    if (f.top > .08 && f.ur > .035 && f.ll < .025 && f.bottom < .04 && f.mid < .055) return 7;
    if (f.mid > .055 && f.top < .04 && f.bottom < .04 && f.ul > .035 && f.ur > .035) return 4;
    if (f.top > .055 && f.mid > .04 && f.bottom > .045) {
      if (f.ur > f.ul * 1.25 && f.ll > f.lr * 1.15) return 2;
      if (f.ur > f.ul * 1.10 && f.lr > f.ll * 1.10) return 3;
      if (f.ul > f.ur * 1.05 && f.lr > f.ll * 1.05) return 5;
    }
    if (f.center > .08 && f.ul > .025 && f.lr > .025) return 8;
    if (f.top > .05 && f.ur > .03 && f.lr > .03) return 3;
    if (f.ul > .04 && f.ur > .04 && f.mid > .04) return 4;
    return 5;
  }

  function detectBridgesV2(img) {
    state.bridges = [];
    for (let i = 0; i < state.islands.length; i++) for (let j = i + 1; j < state.islands.length; j++) {
      const a = state.islands[i], b = state.islands[j];
      if (!areAligned(a,b) || hasIslandBetweenV2(a,b)) continue;
      const count = bridgeCountV2(img,a,b);
      if (count) state.bridges.push({ a:a.id, b:b.id, count });
    }
  }

  function hasIslandBetweenV2(a,b) {
    const h = Math.abs(a.x-b.x) > Math.abs(a.y-b.y);
    return state.islands.some(i => i.id !== a.id && i.id !== b.id && (h ? Math.abs(i.y-a.y)<20 && i.x>Math.min(a.x,b.x) && i.x<Math.max(a.x,b.x) : Math.abs(i.x-a.x)<20 && i.y>Math.min(a.y,b.y) && i.y<Math.max(a.y,b.y)));
  }

  function bridgeCountV2(img,a,b) {
    const h = Math.abs(a.x-b.x) > Math.abs(a.y-b.y);
    const r = islandRadius() + 7;
    const len = h ? Math.abs(b.x-a.x) : Math.abs(b.y-a.y);
    if (len < r*2+8) return 0;
    const profiles = [];
    for (let off=-16; off<=16; off++) profiles.push({ off, ratio: sampleRatio(img,a,b,h,off,r,len-r) });
    const peaks = [];
    for (let i=1;i<profiles.length-1;i++) {
      const p=profiles[i];
      if (p.ratio>.32 && p.ratio>=profiles[i-1].ratio && p.ratio>=profiles[i+1].ratio && !peaks.some(x=>Math.abs(x.off-p.off)<5)) peaks.push(p);
    }
    peaks.sort((a,b)=>b.ratio-a.ratio);
    if (peaks.length>=2 && Math.abs(peaks[0].off-peaks[1].off)>=5) return 2;
    return Math.max(...profiles.map(p=>p.ratio))>.40 ? 1 : 0;
  }

  function sampleRatio(img,a,b,h,off,start,end) {
    let hit=0,total=0;
    const steps = Math.max(18, Math.floor((end-start)/4));
    for(let k=0;k<=steps;k++){
      const t=start+(end-start)*k/steps;
      const x=h ? a.x+(b.x>a.x?t:-t) : a.x+off;
      const y=h ? a.y+off : a.y+(b.y>a.y?t:-t);
      total++; if (brightAt(img,x,y)) hit++;
    }
    return hit/total;
  }

  function brightAt(img,x,y) {
    x=Math.round(x); y=Math.round(y);
    if(x<0||y<0||x>=img.width||y>=img.height)return false;
    const i=(y*img.width+x)*4;
    const r=img.data[i], g=img.data[i+1], b=img.data[i+2];
    const avg=(r+g+b)/3, diff=Math.max(r,g,b)-Math.min(r,g,b);
    return avg>142 && diff<95;
  }
})();
