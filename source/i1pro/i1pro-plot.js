/* i1pro-plot.js - small interactive line/bar plot on a <canvas>: hover read-out, drag to zoom, Ctrl+wheel zoom, Shift+drag pan,
   double-click to reset, two y axes, peak markers, logarithmic axis. No dependencies. Exposes window.I1ProPlot. */
(function (root) {
/* ---------- interactive plot (hover, drag-zoom, wheel-zoom, pan, two y axes) ---------- */
const THEME = () => { const css = getComputedStyle(document.documentElement), c = n => css.getPropertyValue(n).trim(); return { fg: c('--fg') || '#222', muted: c('--muted') || '#777', grid: c('--grid') || c('--line') || 'rgba(128,128,128,.25)', acc: c('--accent') || '#0b7d8a', alt: '#d9822b' }; };
const fmtN = v => { const a = Math.abs(v); if (!isFinite(v)) return '–'; if (a === 0) return '0'; if (a >= 1e5) return v.toExponential(1).replace('e+', 'e'); if (a >= 1000) return String(Math.round(v)); if (a < 0.001) return v.toExponential(1).replace('e-0', 'e-').replace('e-', 'e-'); return String(+v.toPrecision(3)); };
function niceTicks(lo, hi, n) {
  const span = hi - lo; if (!(span > 0)) return [lo]; const raw = span / n, mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const st = [1, 2, 2.5, 5, 10].map(k => k * mag).find(s => s >= raw) || 10 * mag, t = [];
  for (let v = Math.ceil(lo / st - 1e-9) * st; v <= hi + st * 1e-6; v += st) t.push(+v.toPrecision(12)); return t;
}
class Plot {
  constructor(cv, o) {
    this.cv = cv; this.o = Object.assign({ h: 200, from0: true, fmtX: x => String(+x.toFixed(1)), unitX: '' }, o);
    this.s = []; this.mk = []; this.dom = [0, 1]; this.view = null; this.hv = null; this.sel = null; this.log = false; this.drag = null;
    cv.style.touchAction = 'pan-y'; cv.style.cursor = 'crosshair';
    cv.addEventListener('pointermove', e => this.move(e)); cv.addEventListener('pointerdown', e => this.down(e));
    cv.addEventListener('pointerup', e => this.up(e)); cv.addEventListener('pointercancel', () => { this.drag = null; this.sel = null; this.draw(); });
    cv.addEventListener('pointerleave', () => { if (!this.drag) { this.hv = null; this.draw(); } });
    cv.addEventListener('dblclick', () => { this.view = null; this.draw(); });
    cv.addEventListener('wheel', e => { if (!(e.ctrlKey || e.metaKey)) return; e.preventDefault(); this.zoomAt(this.xAt(e), e.deltaY < 0 ? 0.8 : 1.25); }, { passive: false });
    Plot.all.push(this);
  }
  set(series, markers, dom) { this.s = series; this.mk = markers || []; if (dom) this.dom = dom; this.draw(); }
  vx() { return this.view || this.dom; }
  xAt(e) { const r = this.cv.getBoundingClientRect(), px = e.clientX - r.left, [a, b] = this.vx(); return a + (px - this.PL) / (this.PR - this.PL) * (b - a); }
  pxOf(x) { const [a, b] = this.vx(); return this.PL + (x - a) / (b - a) * (this.PR - this.PL); }
  zoomAt(x, f) { const [a, b] = this.vx(), [A, B] = this.dom; let na = x - (x - a) * f, nb = x + (b - x) * f; if (nb - na >= B - A) this.view = null; else { if (na < A) { nb += A - na; na = A; } if (nb > B) { na -= nb - B; nb = B; } this.view = [Math.max(A, na), Math.min(B, nb)]; } this.draw(); }
  zoomCenter(f) { const [a, b] = this.vx(); this.zoomAt((a + b) / 2, f); }
  resetView() { this.view = null; this.draw(); }
  down(e) { if (e.button > 1) return; this.cv.setPointerCapture(e.pointerId); const rect = this.cv.getBoundingClientRect(); this.drag = { x0: e.clientX - rect.left, pan: e.shiftKey || e.button === 1, v0: this.vx().slice(), moved: false }; }
  move(e) {
    const rect = this.cv.getBoundingClientRect(), px = e.clientX - rect.left;
    if (this.drag) {
      const d = this.drag; if (Math.abs(px - d.x0) > 4) d.moved = true;
      if (d.pan && d.moved) { const [a, b] = d.v0, dx = (px - d.x0) / (this.PR - this.PL) * (b - a), [A, B] = this.dom; let na = a - dx, nb = b - dx; if (na < A) { nb += A - na; na = A; } if (nb > B) { na -= nb - B; nb = B; } this.view = [na, nb]; this.sel = null; }
      else if (d.moved) this.sel = [Math.max(this.PL, Math.min(d.x0, px)), Math.min(this.PR, Math.max(d.x0, px))];
    }
    this.hv = (px >= this.PL && px <= this.PR) ? this.xAt(e) : null; this.draw();
  }
  up(e) {
    const d = this.drag; this.drag = null; try { this.cv.releasePointerCapture(e.pointerId); } catch (er) { }
    if (d && !d.pan && this.sel && this.sel[1] - this.sel[0] > 6) { const [a, b] = this.vx(), k = (b - a) / (this.PR - this.PL); this.view = [a + (this.sel[0] - this.PL) * k, a + (this.sel[1] - this.PL) * k]; }
    this.sel = null; this.draw();
  }
  interp(sr, x) {
    const X = sr.x, Y = sr.y, n = X.length; if (!n || x < X[0] || x > X[n - 1]) return null;
    let lo = 0, hi = n - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (X[m] <= x) lo = m; else hi = m; }
    if (X[hi] === X[lo]) return Y[lo]; return Y[lo] + (Y[hi] - Y[lo]) * (x - X[lo]) / (X[hi] - X[lo]);
  }
  draw() {
    const cv = this.cv, T = THEME(), o = this.o, w = Math.max(200, cv.clientWidth || 300), h = o.h, dpr = Math.min(devicePixelRatio || 1, 2);
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    cv.style.height = h + 'px';
    const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, h);
    const hasR = this.s.some(a => a.axis === 'r'); const m = { l: 44, r: hasR ? 46 : 10, t: 10, b: 24 };
    this.PL = m.l; this.PR = w - m.r; const PT = m.t, PB = h - m.b; const [x0, x1] = this.vx();
    const rng = ax => {
      let lo = Infinity, hi = -Infinity;
      for (const sr of this.s) if ((sr.axis || 'l') === ax && !sr.noscale) for (let i = 0; i < sr.x.length; i++) { const x = sr.x[i]; if (x < x0 - (x1 - x0) * 0.02 || x > x1 + (x1 - x0) * 0.02) continue; const y = sr.y[i]; if (isFinite(y)) { if (y < lo) lo = y; if (y > hi) hi = y; } }
      if (!isFinite(lo)) { lo = 0; hi = 1; }
      const lg = this.log && ax === 'l';
      if (lg) { hi = Math.max(hi, 1e-9); lo = Math.max(hi * 1e-4, 1e-9); return { lo, hi: hi * 1.3, lg }; }
      if (o.from0 && ax === 'l') lo = Math.min(0, lo); if (!(o.from0 && ax === 'l') && hi - lo < Math.abs(hi) * 0.01) { const mid = (hi + lo) / 2, hw = Math.max(Math.abs(mid) * 0.005, 1e-9); lo = mid - hw; hi = mid + hw; } if (hi === lo) { hi += 1; lo -= 1; }
      if (ax === 'l' && this.mk.length) hi += (hi - lo) * 0.14;
      const pad = (hi - lo) * 0.06; return { lo: (o.from0 && ax === 'l' && lo === 0) ? 0 : lo - pad, hi: hi + pad, lg };
    };
    const R = { l: rng('l'), r: rng('r') };
    const Y = (ax, y) => { const r = R[ax]; let t = r.lg ? (Math.log10(Math.max(y, r.lo)) - Math.log10(r.lo)) / (Math.log10(r.hi) - Math.log10(r.lo)) : (y - r.lo) / (r.hi - r.lo); return PB - t * (PB - PT); };
    const X = x => this.pxOf(x);
    c.font = '11px system-ui,sans-serif'; c.lineWidth = 1;
    /* grid + axes */
    c.fillStyle = T.muted; c.strokeStyle = T.grid; c.textBaseline = 'top'; c.textAlign = 'center';
    for (const t of niceTicks(x0, x1, Math.max(3, Math.floor((this.PR - this.PL) / 70)))) { const px = X(t); c.beginPath(); c.moveTo(px, PT); c.lineTo(px, PB); c.stroke(); c.fillText(o.fmtTick ? o.fmtTick(t) : String(+t.toFixed(2)), px, PB + 5); }
    c.textAlign = 'right'; c.textBaseline = 'middle';
    const yt = (ax, side) => {
      const r = R[ax]; let ticks; if (r.lg) { ticks = []; for (let e = Math.ceil(Math.log10(r.lo)); e <= Math.floor(Math.log10(r.hi)); e++) ticks.push(Math.pow(10, e)); } else ticks = niceTicks(r.lo, r.hi, 4);
      c.fillStyle = side === 'r' ? T.alt : T.muted; const step = ticks.length > 1 ? Math.abs(ticks[1] - ticks[0]) : 0, dec = step > 0 && step < 1 ? Math.min(6, Math.ceil(-Math.log10(step) - 1e-9)) : 0, ft = t => (!r.lg && step > 0 && Math.abs(t) < 1e5 && Math.abs(t) >= 1e-3 || t === 0) ? t.toFixed(dec) : fmtN(t);
      for (const t of ticks) { const py = Y(ax, t); if (side === 'l') { c.strokeStyle = T.grid; c.beginPath(); c.moveTo(this.PL, py); c.lineTo(this.PR, py); c.stroke(); c.textAlign = 'right'; c.fillText(ft(t), this.PL - 4, py); } else { c.textAlign = 'left'; c.fillText(ft(t), this.PR + 4, py); } }
    };
    yt('l', 'l'); if (hasR) yt('r', 'r');
    c.strokeStyle = T.grid; c.strokeRect(this.PL, PT, this.PR - this.PL, PB - PT);
    /* series (clipped) */
    c.save(); c.beginPath(); c.rect(this.PL, PT, this.PR - this.PL, PB - PT); c.clip();
    for (const sr of this.s) {
      const ax = sr.axis || 'l', col = sr.color === 'alt' ? T.alt : (sr.color || T.acc); c.strokeStyle = col; c.fillStyle = col; c.lineWidth = sr.width || 1.8; c.globalAlpha = sr.alpha || 1; c.setLineDash(sr.dash || []);
      if (sr.type === 'bars') { const bw = Math.max(1, (this.PR - this.PL) / (x1 - x0) * (sr.dx || 1) - 0.6); for (let i = 0; i < sr.x.length; i++) { const px = X(sr.x[i]); if (px < this.PL - bw || px > this.PR + bw) continue; const py = Y(ax, Math.max(0, sr.y[i])), p0 = Y(ax, 0); c.fillRect(px - bw / 2, py, bw, p0 - py); } }
      else {
        c.beginPath(); let st = false; for (let i = 0; i < sr.x.length; i++) { const px = X(sr.x[i]), py = Y(ax, sr.y[i]); if (!isFinite(py)) { st = false; continue; } st ? c.lineTo(px, py) : c.moveTo(px, py); st = true; } c.stroke();
        if (sr.fill) { c.globalAlpha = 0.12; c.lineTo(X(sr.x[sr.x.length - 1]), PB); c.lineTo(X(sr.x[0]), PB); c.closePath(); c.fill(); }
        if (sr.pts || (sr.x.length < 60 && !sr.nopts)) { c.globalAlpha = sr.alpha || 1; for (let i = 0; i < sr.x.length; i++) { c.beginPath(); c.arc(X(sr.x[i]), Y(ax, sr.y[i]), 2.4, 0, 7); c.fill(); } }
      }
      c.globalAlpha = 1; c.setLineDash([]);
    }
    c.restore();
    /* markers (peak labels) */
    c.font = '11px system-ui,sans-serif'; c.textAlign = 'center'; let lastR = -1e9;
    for (const k of this.mk.slice().sort((a, b) => a.x - b.x)) {
      if (k.x < x0 || k.x > x1) continue; const px = X(k.x), py = Y('l', k.y), tw = c.measureText(k.text).width;
      c.fillStyle = T.fg; c.beginPath(); c.moveTo(px, py - 3); c.lineTo(px - 3.5, py - 9); c.lineTo(px + 3.5, py - 9); c.closePath(); c.fill();
      if (px - tw / 2 > lastR + 3 && py > PT + 20) { c.textBaseline = 'bottom'; c.fillText(k.text, Math.min(this.PR - tw / 2, Math.max(this.PL + tw / 2, px)), py - 10); lastR = px + tw / 2; }
    }
    /* selection + hover */
    if (this.sel) { c.fillStyle = T.acc; c.globalAlpha = 0.15; c.fillRect(this.sel[0], PT, this.sel[1] - this.sel[0], PB - PT); c.globalAlpha = 1; }
    if (this.hv != null && !this.sel) {
      const px = X(this.hv); c.strokeStyle = T.fg; c.globalAlpha = 0.45; c.beginPath(); c.moveTo(px, PT); c.lineTo(px, PB); c.stroke(); c.globalAlpha = 1;
      const rows = [(o.fmtX || String)(this.hv) + (o.unitX || '')];
      for (const sr of this.s) { if (sr.noscale && !sr.tip) continue; const v = this.interp(sr, this.hv); if (v == null) continue; const ax = sr.axis || 'l'; const col = sr.color === 'alt' ? T.alt : (sr.color || T.acc);
        c.fillStyle = col; c.beginPath(); c.arc(px, Y(ax, v), 3.5, 0, 7); c.fill(); rows.push((sr.name ? sr.name + ' ' : '') + fmtN(v) + (sr.unit ? ' ' + sr.unit : '')); }
      c.font = '11px system-ui,sans-serif'; const tw = Math.max(...rows.map(r => c.measureText(r).width)) + 12, th = rows.length * 14 + 6;
      let bx = px + 10; if (bx + tw > this.PR) bx = px - 10 - tw; if (bx < this.PL) bx = this.PL; const by = PT + 4;
      c.fillStyle = 'rgba(20,24,28,.88)'; c.fillRect(bx, by, tw, th); c.fillStyle = '#fff'; c.textAlign = 'left'; c.textBaseline = 'top'; rows.forEach((r, i) => c.fillText(r, bx + 6, by + 3 + i * 14));
    }
    /* title */
    if (o.title) { c.fillStyle = T.muted; c.textAlign = 'left'; c.textBaseline = 'top'; c.fillText(typeof o.title === 'function' ? o.title() : o.title, this.PL + 4, PT + 1); }
    if (this.view) { c.fillStyle = T.muted; c.textAlign = 'right'; c.textBaseline = 'bottom'; c.fillText('zoomed · double-click to reset', this.PR - 4, PB - 3); }
  }
}
Plot.all = [];
root.I1ProPlot = { Plot, THEME, fmtN, niceTicks };
})(typeof self !== 'undefined' ? self : this);
