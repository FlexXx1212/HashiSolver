(() => {
  const previousDetectAndRebuild = detectAndRebuild;

  detectAndRebuild = function detectAndRebuildTemplateOnly() {
    previousDetectAndRebuild();
    setTimeout(() => {
      if (!state?.sctx || !state?.islands?.length) return;
      const img = state.sctx.getImageData(0, 0, canvas.width, canvas.height);
      const templates = loadTemplates();
      for (const island of state.islands) {
        const bitmap = extractDigit(img, island);
        const best = match(bitmap, templates);
        if (best) {
          island.value = best.value;
          island.confidence = best.confidence;
        }
      }
      draw();
      render();
      const low = state.islands.filter(i => (i.confidence || 0) < 0.65).length;
      setStatus(`${state.islands.length} Inseln erkannt. Template-OCR aktiv${low ? ', ' + low + ' unsicher' : ''}.`);
    }, 80);
  };

  function loadTemplates() {
    try {
      const raw = JSON.parse(localStorage.getItem('hashiDigitTemplatesV1') || '{}');
      const out = {};
      for (const [value, arr] of Object.entries(raw)) {
        out[value] = (arr || []).map(s => typeof s === 'string' ? s.split('').map(x => x === '1' ? 1 : 0) : s);
      }
      return out;
    } catch { return {}; }
  }

  function match(bitmap, templates) {
    let best = null;
    for (const [value, arr] of Object.entries(templates)) {
      if (Number(value) === 8 && (!arr || arr.length === 0)) continue;
      for (const tpl of arr || []) {
        if (!tpl || tpl.length !== bitmap.length) continue;
        const score = scoreBitmap(bitmap, tpl);
        if (!best || score < best.score) best = { value: Number(value), score };
      }
    }
    return best ? { value: best.value, confidence: Math.max(0, 1 - best.score) } : null;
  }

  function extractDigit(img, island) {
    const outSize = 28;
    const size = 38;
    const raw = new Array(size * size).fill(0);
    const r = islandRadius();
    const scale = (r * 1.28) / size;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const dx = x - size / 2 + 0.5;
      const dy = y - size / 2 + 0.5;
      if (Math.hypot(dx, dy) > size * 0.36) continue;
      const sx = island.x + dx * scale;
      const sy = island.y + dy * scale;
      if (bright(img, sx, sy)) raw[y * size + x] = 1;
    }
    removeLongLines(raw, size);
    return normalize(keepCenterComponents(raw, size), size, outSize);
  }

  function removeLongLines(b, size) {
    for (let y = 0; y < size; y++) {
      let count = 0;
      for (let x = 0; x < size; x++) count += b[y * size + x];
      if (count > size * 0.52) for (let x = 0; x < size; x++) b[y * size + x] = 0;
    }
    for (let x = 0; x < size; x++) {
      let count = 0;
      for (let y = 0; y < size; y++) count += b[y * size + x];
      if (count > size * 0.52) for (let y = 0; y < size; y++) b[y * size + x] = 0;
    }
  }

  function keepCenterComponents(b, size) {
    const seen = new Array(size * size).fill(false);
    const comps = [];
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const idx = y * size + x;
      if (!b[idx] || seen[idx]) continue;
      const q = [[x, y]];
      seen[idx] = true;
      let head = 0, count = 0, sx = 0, sy = 0;
      while (head < q.length) {
        const [px, py] = q[head++];
        count++; sx += px; sy += py;
        for (const [nx, ny] of [[px + 1, py], [px - 1, py], [px, py + 1], [px, py - 1]]) {
          if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
          const ni = ny * size + nx;
          if (b[ni] && !seen[ni]) { seen[ni] = true; q.push([nx, ny]); }
        }
      }
      const cx = sx / count;
      const cy = sy / count;
      const dist = Math.hypot(cx - size / 2, cy - size / 2);
      comps.push({ pixels: q, score: count - dist * 1.6, count });
    }
    comps.sort((a, b) => b.score - a.score);
    const out = new Array(size * size).fill(0);
    for (const c of comps.slice(0, 2)) if (c.count >= 3) for (const [x, y] of c.pixels) out[y * size + x] = 1;
    return out;
  }

  function normalize(b, size, outSize) {
    let minX = size, maxX = -1, minY = size, maxY = -1;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (b[y * size + x]) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    const out = new Array(outSize * outSize).fill(0);
    if (maxX < 0) return out;
    const bw = maxX - minX + 1;
    const bh = maxY - minY + 1;
    const sc = Math.max(bw, bh) / (outSize * 0.72);
    const ox = (outSize - bw / sc) / 2;
    const oy = (outSize - bh / sc) / 2;
    for (let y = 0; y < outSize; y++) for (let x = 0; x < outSize; x++) {
      const sx = Math.round(minX + (x - ox) * sc);
      const sy = Math.round(minY + (y - oy) * sc);
      if (sx >= 0 && sy >= 0 && sx < size && sy < size && b[sy * size + sx]) out[y * outSize + x] = 1;
    }
    return out;
  }

  function scoreBitmap(a, b) {
    let diff = 0, union = 0;
    for (let i = 0; i < a.length; i++) {
      if (a[i] || b[i]) union++;
      if (a[i] !== b[i]) diff++;
    }
    return union ? diff / union : 1;
  }

  function bright(img, x, y) {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= img.width || y >= img.height) return false;
    const i = (y * img.width + x) * 4;
    const r = img.data[i], g = img.data[i + 1], b = img.data[i + 2];
    const avg = (r + g + b) / 3;
    const diff = Math.max(r, g, b) - Math.min(r, g, b);
    return avg > 142 && diff < 95;
  }
})();
