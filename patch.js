(() => {
  const oldDetectAndRebuild = window.detectAndRebuild;
  const templateCache = new Map();

  window.detectAndRebuild = function patchedDetectAndRebuild() {
    if (typeof oldDetectAndRebuild === 'function') oldDetectAndRebuild();
    if (!window.state?.sourceCtx || !window.state?.islands?.length) return;
    const img = window.state.sourceCtx.getImageData(0, 0, window.canvas.width, window.canvas.height);
    for (const island of window.state.islands) {
      const result = recognizeDigit(img, island);
      island.value = result.value;
      island.confidence = result.confidence;
    }
    redetectBridgeCounts(img);
    window.draw?.();
    window.render?.();
    const doubles = window.state.bridges.filter(b => b.count === 2).length;
    window.setStatus?.(`${window.state.islands.length} Inseln, ${window.state.bridges.length} Brücken erkannt (${doubles} doppelt).`);
  };

  function recognizeDigit(img, island) {
    const size = 28;
    const r = window.islandRadius?.() ?? 18;
    const source = extractDigitBitmap(img, island.x, island.y, r, size);
    let best = { value: 1, score: Infinity };
    for (let n = 1; n <= 8; n++) {
      const score = bitmapScore(source, digitTemplate(n, size));
      if (score < best.score) best = { value: n, score };
    }
    return { value: best.value, confidence: Math.max(0, 1 - best.score) };
  }

  function extractDigitBitmap(img, cx, cy, r, size) {
    const out = [];
    const scale = (r * 1.18) / size;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const sx = cx + (x - size / 2 + 0.5) * scale;
        const sy = cy + (y - size / 2 + 0.5) * scale;
        const dx = x - size / 2;
        const dy = y - size / 2;
        const inner = Math.hypot(dx, dy) < size * 0.40;
        out.push(inner && isBrightLocal(img, sx, sy) ? 1 : 0);
      }
    }
    return normalizeBitmap(out, size);
  }

  function digitTemplate(n, size) {
    const key = `${n}-${size}`;
    if (templateCache.has(key)) return templateCache.get(key);
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const g = c.getContext('2d');
    g.fillStyle = '#000';
    g.fillRect(0, 0, size, size);
    g.fillStyle = '#fff';
    g.font = `800 ${Math.round(size * 0.78)}px system-ui, Arial`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(String(n), size / 2, size / 2 + 1);
    const d = g.getImageData(0, 0, size, size).data;
    const b = [];
    for (let i = 0; i < d.length; i += 4) b.push(d[i] > 80 ? 1 : 0);
    const normalized = normalizeBitmap(b, size);
    templateCache.set(key, normalized);
    return normalized;
  }

  function normalizeBitmap(b, size) {
    let minX = size, maxX = -1, minY = size, maxY = -1;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      if (b[y * size + x]) {
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
    }
    const outSize = 20;
    const out = new Array(outSize * outSize).fill(0);
    if (maxX < 0) return out;
    const bw = maxX - minX + 1;
    const bh = maxY - minY + 1;
    const scale = Math.max(bw, bh) / 16;
    const ox = (outSize - bw / scale) / 2;
    const oy = (outSize - bh / scale) / 2;
    for (let y = 0; y < outSize; y++) for (let x = 0; x < outSize; x++) {
      const sx = Math.round(minX + (x - ox) * scale);
      const sy = Math.round(minY + (y - oy) * scale);
      if (sx >= 0 && sy >= 0 && sx < size && sy < size && b[sy * size + sx]) out[y * outSize + x] = 1;
    }
    return out;
  }

  function bitmapScore(a, b) {
    let diff = 0, union = 0;
    for (let i = 0; i < a.length; i++) {
      if (a[i] || b[i]) union++;
      if (a[i] !== b[i]) diff++;
    }
    return union ? diff / union : 1;
  }

  function redetectBridgeCounts(img) {
    const bridges = [];
    const islands = window.state.islands;
    for (let i = 0; i < islands.length; i++) for (let j = i + 1; j < islands.length; j++) {
      const a = islands[i], b = islands[j];
      if (!aligned(a, b) || hasIslandBetween(a, b, islands)) continue;
      const count = bridgeCountFromImage(img, a, b);
      if (count > 0) bridges.push({ a: a.id, b: b.id, count });
    }
    window.state.bridges = bridges;
  }

  function aligned(a, b) { return Math.abs(a.x - b.x) < 20 || Math.abs(a.y - b.y) < 20; }

  function hasIslandBetween(a, b, islands) {
    const horizontal = Math.abs(a.x - b.x) > Math.abs(a.y - b.y);
    return islands.some(i => i.id !== a.id && i.id !== b.id && (
      horizontal
        ? Math.abs(i.y - a.y) < 20 && i.x > Math.min(a.x, b.x) && i.x < Math.max(a.x, b.x)
        : Math.abs(i.x - a.x) < 20 && i.y > Math.min(a.y, b.y) && i.y < Math.max(a.y, b.y)
    ));
  }

  function bridgeCountFromImage(img, a, b) {
    const horizontal = Math.abs(a.x - b.x) > Math.abs(a.y - b.y);
    const r = (window.islandRadius?.() ?? 18) + 7;
    const len = horizontal ? Math.abs(b.x - a.x) : Math.abs(b.y - a.y);
    if (len < r * 2 + 8) return 0;
    const start = r;
    const end = len - r;
    const profile = [];
    for (let off = -16; off <= 16; off++) {
      profile.push({ off, ratio: sampleLineRatio(img, a, b, horizontal, off, start, end) });
    }
    const smooth = profile.map((p, i) => ({
      off: p.off,
      ratio: ((profile[i - 1]?.ratio ?? p.ratio) + p.ratio + (profile[i + 1]?.ratio ?? p.ratio)) / 3
    }));
    const peaks = [];
    for (let i = 1; i < smooth.length - 1; i++) {
      const p = smooth[i];
      if (p.ratio > 0.34 && p.ratio >= smooth[i - 1].ratio && p.ratio >= smooth[i + 1].ratio) {
        if (!peaks.some(x => Math.abs(x.off - p.off) < 5)) peaks.push(p);
      }
    }
    peaks.sort((a, b) => b.ratio - a.ratio);
    if (peaks.length >= 2 && Math.abs(peaks[0].off - peaks[1].off) >= 5) return 2;
    return Math.max(...profile.map(p => p.ratio)) > 0.42 ? 1 : 0;
  }

  function sampleLineRatio(img, a, b, horizontal, off, start, end) {
    let bright = 0, total = 0;
    const steps = Math.max(16, Math.floor((end - start) / 4));
    for (let k = 0; k <= steps; k++) {
      const t = start + (end - start) * k / steps;
      const x = horizontal ? (a.x + (b.x > a.x ? t : -t)) : (a.x + off);
      const y = horizontal ? (a.y + off) : (a.y + (b.y > a.y ? t : -t));
      total++;
      if (isBrightLocal(img, x, y)) bright++;
    }
    return bright / total;
  }

  function isBrightLocal(img, x, y) {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= img.width || y >= img.height) return false;
    const i = (y * img.width + x) * 4;
    const r = img.data[i], g = img.data[i + 1], b = img.data[i + 2];
    const avg = (r + g + b) / 3;
    const diff = Math.max(r, g, b) - Math.min(r, g, b);
    return avg > 142 && diff < 95;
  }
})();
