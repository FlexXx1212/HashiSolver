(() => {
  const baseDetectAndRebuild = detectAndRebuild;
  const overlay = document.createElement('div');
  overlay.id = 'ocrLoading';
  overlay.innerHTML = '<div class="ocrSpin"></div><div id="ocrLoadingText">Verarbeite Screenshot…</div>';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;display:none;align-items:center;justify-content:center;flex-direction:column;gap:14px;background:rgba(3,8,13,.75);backdrop-filter:blur(4px);color:#eef3f8;font:800 18px system-ui';
  const style = document.createElement('style');
  style.textContent = '.ocrSpin{width:48px;height:48px;border-radius:50%;border:5px solid rgba(255,255,255,.24);border-top-color:#62d7ff;animation:ocrSpin .8s linear infinite}@keyframes ocrSpin{to{transform:rotate(360deg)}}';
  document.head.append(style);
  document.body.append(overlay);
  const loadingText = () => document.getElementById('ocrLoadingText');

  let workerPromise = null;
  function show(msg){ if(loadingText()) loadingText().textContent = msg; overlay.style.display = 'flex'; }
  function hide(){ overlay.style.display = 'none'; }

  async function getWorker() {
    if (!window.Tesseract) throw new Error('Tesseract nicht geladen');
    if (!workerPromise) {
      workerPromise = (async () => {
        const worker = await Tesseract.createWorker('eng', 1, {
          logger: m => {
            if (m.status) show(`OCR: ${m.status}${m.progress ? ' ' + Math.round(m.progress*100) + '%' : ''}`);
          }
        });
        await worker.setParameters({
          tessedit_char_whitelist: '12345678',
          tessedit_pageseg_mode: '10',
          classify_bln_numeric_mode: '1'
        });
        return worker;
      })();
    }
    return workerPromise;
  }

  detectAndRebuild = function () {
    if (!state?.sctx) return baseDetectAndRebuild();
    show('Inseln und Brücken erkennen…');
    setTimeout(async () => {
      try {
        detectIslands();
        detectBridges();
        draw();
        render();
        await recognizeDigitsTesseract();
        draw();
        render();
        const doubles = state.bridges.filter(b => b.count === 2).length;
        setStatus(`${state.islands.length} Inseln, ${state.bridges.length} Brücken (${doubles} doppelt). Tesseract-OCR aktiv.`);
      } catch (err) {
        console.error(err);
        setStatus('OCR Fehler: ' + (err?.message || err));
        baseDetectAndRebuild();
      } finally {
        hide();
      }
    }, 50);
  };

  async function recognizeDigitsTesseract() {
    show('OCR vorbereiten…');
    const worker = await getWorker();
    const img = state.sctx.getImageData(0, 0, canvas.width, canvas.height);
    for (let idx = 0; idx < state.islands.length; idx++) {
      const island = state.islands[idx];
      show(`Zahl ${idx + 1}/${state.islands.length} erkennen…`);
      const cropCanvas = makeDigitCrop(img, island);
      const result = await worker.recognize(cropCanvas);
      const text = (result?.data?.text || '').replace(/[^1-8]/g, '');
      const conf = Math.max(0, Math.min(1, (result?.data?.confidence || 0) / 100));
      if (text) {
        island.value = Number(text[0]);
        island.confidence = conf;
      } else {
        island.value = fallbackTemplateValue(img, island);
        island.confidence = 0.35;
      }
    }
  }

  function makeDigitCrop(img, island) {
    const r = islandRadius();
    const srcSize = Math.round(r * 1.25);
    const out = 96;
    const c = document.createElement('canvas');
    c.width = out; c.height = out;
    const g = c.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, out, out);
    const data = g.getImageData(0, 0, out, out);
    for (let y = 0; y < out; y++) for (let x = 0; x < out; x++) {
      const sx = island.x + (x / out - 0.5) * srcSize;
      const sy = island.y + (y / out - 0.5) * srcSize;
      const dx = x - out/2, dy = y - out/2;
      const inside = Math.hypot(dx, dy) < out * 0.36;
      const on = inside && bright(img, sx, sy);
      const p = (y*out+x)*4;
      const v = on ? 0 : 255;
      data.data[p]=v; data.data[p+1]=v; data.data[p+2]=v; data.data[p+3]=255;
    }
    g.putImageData(data, 0, 0);
    removeLongLinesFromCanvas(c);
    return c;
  }

  function removeLongLinesFromCanvas(c) {
    const g = c.getContext('2d');
    const img = g.getImageData(0,0,c.width,c.height);
    const d = img.data, w=c.width, h=c.height;
    for(let y=0;y<h;y++){
      let black=0; for(let x=0;x<w;x++) if(d[(y*w+x)*4]<80) black++;
      if(black>w*.52) for(let x=0;x<w;x++){const p=(y*w+x)*4; d[p]=d[p+1]=d[p+2]=255;}
    }
    for(let x=0;x<w;x++){
      let black=0; for(let y=0;y<h;y++) if(d[(y*w+x)*4]<80) black++;
      if(black>h*.52) for(let y=0;y<h;y++){const p=(y*w+x)*4; d[p]=d[p+1]=d[p+2]=255;}
    }
    g.putImageData(img,0,0);
  }

  function fallbackTemplateValue(img, island) {
    const saved = (()=>{try{return JSON.parse(localStorage.getItem('hashiDigitTemplatesV1')||'{}');}catch{return {};}})();
    const bitmap = extractSmallBitmap(img, island);
    let best = { value:1, score:999 };
    for(const [val, arr] of Object.entries(saved)) for(const s of (arr||[])){
      const tpl = s.split('').map(x=>x==='1'?1:0);
      if(tpl.length !== bitmap.length) continue;
      const score = bitmapScore(bitmap, tpl);
      if(score < best.score) best = { value:Number(val), score };
    }
    return best.value;
  }

  function extractSmallBitmap(img, island) {
    const out=28, size=38, raw=new Array(size*size).fill(0), r=islandRadius(), scale=(r*1.28)/size;
    for(let y=0;y<size;y++) for(let x=0;x<size;x++){
      const dx=x-size/2+.5, dy=y-size/2+.5;
      if(Math.hypot(dx,dy)>size*.36) continue;
      if(bright(img, island.x+dx*scale, island.y+dy*scale)) raw[y*size+x]=1;
    }
    return normalize(raw,size,out);
  }
  function normalize(b,size,outSize){let minX=size,maxX=-1,minY=size,maxY=-1;for(let y=0;y<size;y++)for(let x=0;x<size;x++)if(b[y*size+x]){minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);}const out=new Array(outSize*outSize).fill(0);if(maxX<0)return out;const bw=maxX-minX+1,bh=maxY-minY+1,sc=Math.max(bw,bh)/(outSize*.72),ox=(outSize-bw/sc)/2,oy=(outSize-bh/sc)/2;for(let y=0;y<outSize;y++)for(let x=0;x<outSize;x++){const sx=Math.round(minX+(x-ox)*sc),sy=Math.round(minY+(y-oy)*sc);if(sx>=0&&sy>=0&&sx<size&&sy<size&&b[sy*size+sx])out[y*outSize+x]=1;}return out;}
  function bitmapScore(a,b){let diff=0,union=0;for(let i=0;i<a.length;i++){if(a[i]||b[i])union++;if(a[i]!==b[i])diff++;}return union?diff/union:1;}
  function bright(img,x,y){x=Math.round(x);y=Math.round(y);if(x<0||y<0||x>=img.width||y>=img.height)return false;const p=(y*img.width+x)*4;const r=img.data[p],g=img.data[p+1],b=img.data[p+2],avg=(r+g+b)/3,diff=Math.max(r,g,b)-Math.min(r,g,b);return avg>142&&diff<95;}
})();
