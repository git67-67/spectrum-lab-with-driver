/* LED Spectrum Lab
 * Copyright (C) 2026 the LED Spectrum Lab authors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * This program is free software: you can redistribute it and/or modify it under the
 * terms of the GNU Affero General Public License as published by the Free Software
 * Foundation, either version 3 of the License, or (at your option) any later version.
 * It is distributed WITHOUT ANY WARRANTY; see the GNU Affero General Public License
 * for details. You should have received a copy of it along with this program (LICENSE);
 * if not, see <https://www.gnu.org/licenses/>.
 */
/* LED Spectrum Lab - UI part 2: chart engines (spectrum, CIE diagram, bars, CVG) */
(function () {
'use strict';
var L = window.LSL, A = window.APP, h = A.h;
function cv(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888'; }
function setupCanvas(c) {
  var r = c.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 3), w = Math.max(60, Math.round(r.width)), hh = Math.max(60, Math.round(r.height));
  if (c.width !== w * dpr || c.height !== hh * dpr) { c.width = w * dpr; c.height = hh * dpr; }
  var g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); return { g: g, w: w, h: hh };
}
function niceStep(range, n) { var raw = range / n, p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p; return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p; }
function ticks(a, b, n) { var s = niceStep(b - a, n), t = [], v = Math.ceil(a / s - 1e-9) * s; for (; v <= b + s * 1e-6; v += s) t.push(+v.toPrecision(10)); return { t: t, s: s }; }
function decs(s) { return s >= 1 ? 0 : Math.min(6, Math.ceil(-Math.log10(s) - 1e-9)); }
function alpha(c, a) { if (c[0] === '#') { var n = parseInt(c.slice(1), 16); if (c.length === 4) { var r = ((n >> 8) & 15) * 17, g = ((n >> 4) & 15) * 17, b = (n & 15) * 17; return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')'; } return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')'; } return c; }
var PAL = ['#2563eb', '#dc2626', '#16a34a', '#d97706', '#9333ea', '#0891b2', '#db2777', '#65a30d', '#4f46e5', '#ea580c', '#0d9488', '#a16207'];
A.PAL = PAL;

/* Bradford adaptation of XYZ (white Yw=100) to D65 and conversion to sRGB for swatches */
var BRAD = [[0.8951, 0.2664, -0.1614], [-0.7502, 1.7135, 0.0367], [0.0389, -0.0685, 1.0296]], BRADi = [[0.9869929, -0.1470543, 0.1599627], [0.4323053, 0.5183603, 0.0492912], [-0.0085287, 0.0400428, 0.9684867]];
function mv(M, v) { return [M[0][0] * v[0] + M[0][1] * v[1] + M[0][2] * v[2], M[1][0] * v[0] + M[1][1] * v[1] + M[1][2] * v[2], M[2][0] * v[0] + M[2][1] * v[1] + M[2][2] * v[2]]; }
var W65 = [95.047, 100, 108.883];
function swatch(xyz, white) {
  var ws = mv(BRAD, white), wd = mv(BRAD, W65), c = mv(BRAD, xyz), r = [c[0] * wd[0] / ws[0], c[1] * wd[1] / ws[1], c[2] * wd[2] / ws[2]], o = mv(BRADi, r);
  return L.swatchRGB(o);
}
A.swatch = swatch;

function specRGB(w) { // saturated display colour for a wavelength (smooth, no dark bands)
  var r = 0, g = 0, b = 0;
  if (w < 380 || w > 780) return [140, 140, 140];
  if (w < 440) { r = (440 - w) / 60; b = 1; } else if (w < 490) { g = (w - 440) / 50; b = 1; } else if (w < 510) { g = 1; b = (510 - w) / 20; } else if (w < 580) { r = (w - 510) / 70; g = 1; } else if (w < 645) { r = 1; g = (645 - w) / 65; } else { r = 1; }
  var f = w < 420 ? 0.35 + 0.65 * (w - 380) / 40 : w > 700 ? 0.35 + 0.65 * (780 - w) / 80 : 1;
  return [255 * Math.pow(r * f, 0.8), 255 * Math.pow(g * f, 0.8), 255 * Math.pow(b * f, 0.8)];
}
A.specRGB = specRGB;
/* ================= SPECTRUM CHART ================= */
function SpectrumChart(canvas, getModel) {
  var st = { x0: null, x1: null, hover: null, drag: null }; canvas._st = st;
  var self = this; self.canvas = canvas;
  function view() { var o = A.ui.spec; return { x0: st.x0 == null ? o.x0 : st.x0, x1: st.x1 == null ? o.x1 : st.x1 }; }
  self.render = function () {
    var m = getModel(), o = A.ui.spec, c = setupCanvas(canvas), g = c.g, W = c.w, H = c.h, v = view();
    var fg = cv('--fg'), mut = cv('--muted'), grid = cv('--grid'), bg = cv('--panel');
    g.clearRect(0, 0, W, H);
    var padL = 58, padR = o.overlays && Object.keys(o.overlays).some(function (k) { return o.overlays[k]; }) ? 44 : 14, padT = 12, padB = 34;
    var pw = W - padL - padR, ph = H - padT - padB;
    if (!m || !m.series.length) { g.fillStyle = mut; g.font = '13px system-ui'; g.fillText('No spectrum', padL, padT + 20); return; }
    // scale
    var unit = 1, ylab = 'Spectral radiant flux (mW/nm)';
    var ymax = 0, series = m.series;
    function conv(s) { var out = new Float64Array(L.N), i, w; for (i = 0; i < L.N; i++) { w = i + L.WL0; var val = s.y[i]; if (o.yMode === 'photon') val = val * w * 1e-9 / (6.62607015e-34 * 299792458) / 6.02214076e23 * 1e6; else if (o.yMode === 'abs') val = val * 1000; out[i] = val; } return out; }
    var data = series.map(function (s) { return { s: s, y: conv(s) }; });
    var mainPeak = 0; data.forEach(function (d) { if (d.s.main) { for (var i = 0; i < L.N; i++) if (d.y[i] > mainPeak) mainPeak = d.y[i]; } });
    if (!mainPeak) data.forEach(function (d) { for (var i = 0; i < L.N; i++) if (d.y[i] > mainPeak) mainPeak = d.y[i]; });
    if (o.yMode === 'norm') { data.forEach(function (d) { var k = 1 / (mainPeakOf(d.y) || 1); if (d.s.refNorm) { /* keep */ } d.y = d.y.map(function (x) { return x * k; }); }); mainPeak = 1; ylab = 'Relative (each trace normalised to peak = 1)'; }
    else if (o.yMode === 'photon') ylab = 'Photon flux (µmol s⁻¹ nm⁻¹)';
    function mainPeakOf(a) { var m_ = 0; for (var i = 0; i < a.length; i++) if (a[i] > m_) m_ = a[i]; return m_; }
    ymax = 0; data.forEach(function (d) { var vv = 0; for (var i = Math.max(0, Math.floor(v.x0) - L.WL0); i <= Math.min(L.N - 1, Math.ceil(v.x1) - L.WL0); i++) if (d.y[i] > vv) vv = d.y[i]; if (vv > ymax) ymax = vv; });
    if (o.yMode === 'abs' || o.yMode === 'photon') { /* compare traces may dwarf: fine */ }
    ymax = ymax || 1; var ytop = ymax * 1.06, ymin = 0, logMin = ymax * 1e-4;
    function X(w) { return padL + (w - v.x0) / (v.x1 - v.x0) * pw; }
    function Y(val) { if (o.log) { var lv = Math.log10(Math.max(val, logMin)), a = Math.log10(logMin), b = Math.log10(ytop); return padT + ph - (lv - a) / (b - a) * ph; } return padT + ph - (val - ymin) / (ytop - ymin) * ph; }
    // grid & axes
    g.lineWidth = 1; g.font = '11px system-ui'; g.fillStyle = mut; g.strokeStyle = grid;
    var tx = ticks(v.x0, v.x1, Math.max(4, Math.floor(pw / 70)));
    g.textAlign = 'center'; tx.t.forEach(function (t) { var x = X(t); g.beginPath(); g.moveTo(x, padT); g.lineTo(x, padT + ph); g.stroke(); g.fillText(String(t), x, padT + ph + 14); });
    g.fillText('Wavelength (nm)', padL + pw / 2, H - 6);
    g.textAlign = 'right';
    if (o.log) { var d0 = Math.ceil(Math.log10(logMin)), d1 = Math.floor(Math.log10(ytop)); for (var e = d0; e <= d1; e++) { var yy = Y(Math.pow(10, e)); g.beginPath(); g.moveTo(padL, yy); g.lineTo(padL + pw, yy); g.stroke(); g.fillText(Math.pow(10, e).toExponential(0), padL - 6, yy + 4); } }
    else { var ty = ticks(0, ytop, 5); ty.t.forEach(function (t) { var y = Y(t); g.beginPath(); g.moveTo(padL, y); g.lineTo(padL + pw, y); g.stroke(); g.fillText(t.toFixed(decs(ty.s)), padL - 6, y + 4); }); }
    g.save(); g.translate(13, padT + ph / 2); g.rotate(-Math.PI / 2); g.textAlign = 'center'; g.fillText(ylab, 0, 0); g.restore();
    // visible-range colour bar
    for (var w = Math.max(380, Math.ceil(v.x0)); w <= Math.min(780, v.x1); w++) { var cc = specRGB(w); g.fillStyle = 'rgba(' + (cc[0] | 0) + ',' + (cc[1] | 0) + ',' + (cc[2] | 0) + ',0.9)'; g.fillRect(X(w), padT + ph, Math.max(1.2, pw / (v.x1 - v.x0) + 0.5), 4); }
    g.save(); g.beginPath(); g.rect(padL, padT, pw, ph); g.clip();
    // overlays
    var ovDefs = [['V', 'Photopic V(λ)', L.T.y31, '#16a34a'], ['Vp', 'Scotopic V′(λ)', L.T.vp, '#6b7280'], ['Mel', 'Melanopic', L.T.Mel, '#0891b2'], ['S', 'S-cone', L.T.S, '#6366f1'], ['M', 'M-cone', L.T.M, '#22a44a'], ['L', 'L-cone', L.T.L, '#dc2626']];
    ovDefs.forEach(function (od) { if (!o.overlays[od[0]]) return; g.beginPath(); g.strokeStyle = od[3]; g.setLineDash([5, 3]); g.lineWidth = 1.5;
      for (var wv = 380; wv <= 780; wv++) { var val = od[2][wv - 380] * (o.yMode === 'norm' ? 1 : ymax), x = X(wv), y = o.log ? Y(val) : Y(val); if (wv === 380) g.moveTo(x, y); else g.lineTo(x, y); } g.stroke(); g.setLineDash([]); });
    // series
    data.forEach(function (d, k) {
      var s = d.s; if (s.channel && !o.channels) return;
      var col = s.color; g.beginPath(); var started = false, i, first = Math.max(0, Math.floor(v.x0) - L.WL0 - 1), last = Math.min(L.N - 1, Math.ceil(v.x1) - L.WL0 + 1);
      for (i = first; i <= last; i++) { var x = X(i + L.WL0), y = Y(d.y[i]); if (!started) { g.moveTo(x, y); started = true; } else g.lineTo(x, y); }
      if (s.fill && o.fill) { var base = Y(o.log ? logMin : 0); g.lineTo(X(last + L.WL0), base); g.lineTo(X(first + L.WL0), base); g.closePath();
        var grad = g.createLinearGradient(padL, 0, padL + pw, 0); for (var q = 0; q <= 120; q++) { var wl = v.x0 + (v.x1 - v.x0) * q / 120, c2 = specRGB(wl); var inVis = wl >= 380 && wl <= 780; grad.addColorStop(q / 120, inVis ? 'rgba(' + (c2[0] | 0) + ',' + (c2[1] | 0) + ',' + (c2[2] | 0) + ',0.62)' : 'rgba(128,128,128,0.35)'); }
        g.fillStyle = grad; g.fill(); }
      g.beginPath(); started = false; for (i = first; i <= last; i++) { var x2 = X(i + L.WL0), y2 = Y(d.y[i]); if (!started) { g.moveTo(x2, y2); started = true; } else g.lineTo(x2, y2); }
      g.strokeStyle = col; g.lineWidth = s.width || 1.6; g.setLineDash(s.dash || []); g.stroke(); g.setLineDash([]);
    });
    g.restore();
    // legend
    var lx = padL + 8, ly = padT + 8; g.font = '11.5px system-ui'; g.textAlign = 'left';
    data.forEach(function (d) { var s = d.s; if (s.channel && !o.channels) return; if (s.noLegend) return; var tw = g.measureText(s.name).width; if (lx + tw + 30 > padL + pw) { lx = padL + 8; ly += 15; }
      g.strokeStyle = s.color; g.lineWidth = 2.5; g.setLineDash(s.dash || []); g.beginPath(); g.moveTo(lx, ly + 4); g.lineTo(lx + 16, ly + 4); g.stroke(); g.setLineDash([]); g.fillStyle = fg; g.fillText(s.name, lx + 20, ly + 8); lx += tw + 38; });
    // overlay axis hint
    if (padR > 20) { g.fillStyle = mut; g.save(); g.translate(W - 8, padT + ph / 2); g.rotate(Math.PI / 2); g.textAlign = 'center'; g.fillText('weighting curves (peak = 1, scaled to plot)', 0, 0); g.restore(); }
    // hover
    if (st.hover && st.hover.x >= padL && st.hover.x <= padL + pw) {
      var wl = Math.round(v.x0 + (st.hover.x - padL) / pw * (v.x1 - v.x0)), idx = wl - L.WL0; if (idx >= 0 && idx < L.N) {
        g.strokeStyle = mut; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(X(wl), padT); g.lineTo(X(wl), padT + ph); g.stroke(); g.setLineDash([]);
        var lines = [wl + ' nm'], cvals = specRGB(wl); data.forEach(function (d) { if (d.s.channel && !o.channels) return; if (d.s.noLegend) return; lines.push(d.s.name + ': ' + (d.y[idx] >= 0.01 ? d.y[idx].toPrecision(3) : d.y[idx].toExponential(2))); });
        g.font = '11.5px system-ui'; var bw = 0; lines.forEach(function (t) { bw = Math.max(bw, g.measureText(t).width); }); bw += 14; var bh = lines.length * 15 + 8, bx = Math.min(W - bw - 4, X(wl) + 10), by = Math.max(padT + 2, st.hover.y - bh / 2);
        if (bx < X(wl) && X(wl) + 10 + bw > W) bx = X(wl) - bw - 10;
        g.fillStyle = bg; g.strokeStyle = grid; g.lineWidth = 1; g.fillRect(bx, by, bw, bh); g.strokeRect(bx, by, bw, bh); g.fillStyle = fg; g.textAlign = 'left'; lines.forEach(function (t, i) { g.fillText(t, bx + 7, by + 15 + i * 15 - 2); });
      }
    }
    st.geom = { padL: padL, pw: pw, padT: padT, ph: ph, v: v };
  };
  // interaction
  canvas.addEventListener('pointermove', function (e) { var r = canvas.getBoundingClientRect(); st.hover = { x: e.clientX - r.left, y: e.clientY - r.top };
    if (st.drag && st.geom) { var v = st.drag.v, dx = (e.clientX - st.drag.x) / st.geom.pw * (v.x1 - v.x0); st.x0 = v.x0 - dx; st.x1 = v.x1 - dx; }
    self.render(); });
  canvas.addEventListener('pointerleave', function () { st.hover = null; self.render(); });
  canvas.addEventListener('pointerdown', function (e) { canvas.setPointerCapture(e.pointerId); st.drag = { x: e.clientX, v: Object.assign({}, view()) }; canvas.style.cursor = 'grabbing'; });
  canvas.addEventListener('pointerup', function () { st.drag = null; canvas.style.cursor = ''; });
  canvas.addEventListener('wheel', function (e) { e.preventDefault(); if (!st.geom) return; var v = view(), r = canvas.getBoundingClientRect(), fx = (e.clientX - r.left - st.geom.padL) / st.geom.pw; fx = Math.max(0, Math.min(1, fx)); var f = Math.exp(e.deltaY * 0.0015), span = (v.x1 - v.x0) * f; span = Math.max(10, Math.min(700, span)); var c0 = v.x0 + fx * (v.x1 - v.x0); st.x0 = c0 - fx * span; st.x1 = st.x0 + span; self.render(); }, { passive: false });
  canvas.addEventListener('dblclick', function () { st.x0 = st.x1 = null; self.render(); });
  self.resetZoom = function () { st.x0 = st.x1 = null; self.render(); };
  self.zoom = function (f) { var v = view(), c = (v.x0 + v.x1) / 2, sp = (v.x1 - v.x0) * f / 2; st.x0 = c - sp; st.x1 = c + sp; self.render(); };
}
A.SpectrumChart = SpectrumChart;

/* ================= CIE CHART ================= */
var PRIM = { srgb: { c: '#0ea5e9', p: [[0.64, 0.33], [0.30, 0.60], [0.15, 0.06]], n: 'sRGB' }, p3: { c: '#f59e0b', p: [[0.68, 0.32], [0.265, 0.69], [0.15, 0.06]], n: 'Display P3' }, r2020: { c: '#a855f7', p: [[0.708, 0.292], [0.170, 0.797], [0.131, 0.046]], n: 'Rec.2020' } };
function uv60toxy(u, v) { var d = 2 * u - 8 * v + 4; return { x: 3 * u / d, y: 2 * v / d }; }
function CIEChart(canvas, getModel, onHover) {
  var self = this, st = { cx: 0.35, cy: 0.35, k: 1, hover: null, pts: new Map(), drag: null, fillKey: '', fillImg: null }; canvas._st = st; self.canvas = canvas;
  function sysOf(x, y) { return A.ui.cie.sys === 'uv' ? (function (p) { return [p.u, p.v]; })(L.xy2upvp(x, y)) : [x, y]; }
  function fromSys(a, b) { if (A.ui.cie.sys === 'uv') { var p = L.upvp2xy(a, b); return [p.x, p.y]; } return [a, b]; }
  function locusPts(obs, step) { var T = L.T, xs = obs === 10 ? T.x64 : T.x31, ys = obs === 10 ? T.y64 : T.y31, zs = obs === 10 ? T.z64 : T.z31, out = []; for (var w = 380; w <= 780; w += step) { var k = w - 380, s = xs[k] + ys[k] + zs[k]; if (s > 1e-6 && xs[k] / s > -1) out.push({ wl: w, x: xs[k] / s, y: ys[k] / s }); } return out; }
  self.reset = function () { var s = A.ui.cie.sys, c = canvas.getBoundingClientRect(); if (s === 'uv') { st.cx = 0.25; st.cy = 0.3; st.k = Math.min(c.width, c.height) / 0.66; } else { st.cx = 0.36; st.cy = 0.35; st.k = Math.min(c.width, c.height) / 0.88; } self.render(); };
  self.fit = function () { var m = getModel(); if (!m || !m.points.length) return self.reset(); var a0 = 9, a1 = -9, b0 = 9, b1 = -9; m.points.forEach(function (p) { var s = sysOf(p.x, p.y); a0 = Math.min(a0, s[0]); a1 = Math.max(a1, s[0]); b0 = Math.min(b0, s[1]); b1 = Math.max(b1, s[1]); }); var c = canvas.getBoundingClientRect(); var sp = Math.max(a1 - a0, b1 - b0, 0.02) * 1.8; st.cx = (a0 + a1) / 2; st.cy = (b0 + b1) / 2; st.k = Math.min(c.width, c.height) / sp; self.render(); };
  self.render = function () {
    var m = getModel(), o = A.ui.cie, c = setupCanvas(canvas), g = c.g, W = c.w, H = c.h, sys = o.sys;
    if (!st.init) { st.init = true; self.reset(); return; }
    var fg = cv('--fg'), mut = cv('--muted'), grid = cv('--grid'), panel = cv('--panel'), k = st.k;
    function P(a, b) { return [W / 2 + (a - st.cx) * k, H / 2 - (b - st.cy) * k]; }
    function PX(x, y) { var s = sysOf(x, y); return P(s[0], s[1]); }
    var obs = o.obs, loc = locusPts(obs, 1), loc5 = locusPts(obs, 3);
    g.clearRect(0, 0, W, H);
    // background fill
    var a0 = st.cx - W / 2 / k, a1 = st.cx + W / 2 / k, b0 = st.cy - H / 2 / k, b1 = st.cy + H / 2 / k;
    if (o.fill) {
      var key = [sys, obs, st.cx.toFixed(5), st.cy.toFixed(5), k.toFixed(2), W, H, A.theme].join('|');
      if (st.fillKey !== key) {
        var s = 3, fw = Math.ceil(W / s), fh = Math.ceil(H / s), img = st.fillImg && st.fillImg.width === fw && st.fillImg.height === fh ? st.fillImg : document.createElement('canvas'); img.width = fw; img.height = fh;
        var ig = img.getContext('2d'), id = ig.createImageData(fw, fh), poly = loc5.map(function (p) { var q = sysOf(p.x, p.y); return q; }), n = poly.length, dark = A.theme === 'dark';
        for (var j = 0; j < fh; j++) { var bb = b1 - (j + 0.5) * s / k; for (var i = 0; i < fw; i++) { var aa = a0 + (i + 0.5) * s / k, inside = false; for (var e = 0, f = n - 1; e < n; f = e++) { var pe = poly[e], pf = poly[f]; if (((pe[1] > bb) !== (pf[1] > bb)) && (aa < (pf[0] - pe[0]) * (bb - pe[1]) / (pf[1] - pe[1]) + pe[0])) inside = !inside; }
          var q = (j * fw + i) * 4; if (inside) { var xy = fromSys(aa, bb); if (xy[1] > 0.002) { var cc = L.xyToRGB(xy[0], xy[1]); var mixw = dark ? 0.55 : 0.18; id.data[q] = cc[0] * (1 - mixw) + (dark ? 20 : 255) * mixw; id.data[q + 1] = cc[1] * (1 - mixw) + (dark ? 22 : 255) * mixw; id.data[q + 2] = cc[2] * (1 - mixw) + (dark ? 28 : 255) * mixw; id.data[q + 3] = 235; } } } }
        ig.putImageData(id, 0, 0); st.fillImg = img; st.fillKey = key; }
      g.imageSmoothingEnabled = true; g.drawImage(st.fillImg, 0, 0, st.fillImg.width * 3, st.fillImg.height * 3);
    }
    // grid
    var sp = niceStep(Math.max(b1 - b0, a1 - a0), 8), dd = decs(sp);
    if (o.grid) { g.lineWidth = 1; g.strokeStyle = grid; g.fillStyle = mut; g.font = '11px system-ui'; g.textAlign = 'center';
      ticks(a0, a1, 8).t.forEach(function (t) { var x = P(t, 0)[0]; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); g.fillText(t.toFixed(dd), x, H - 5); });
      g.textAlign = 'left'; ticks(b0, b1, 8).t.forEach(function (t) { var y = P(0, t)[1]; g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); g.fillText(t.toFixed(dd), 4, y - 3); }); }
    // axis labels
    g.fillStyle = mut; g.font = '600 12px system-ui'; g.textAlign = 'right'; g.fillText(sys === 'uv' ? 'u′' : 'x', W - 8, H - 18); g.textAlign = 'left'; g.fillText(sys === 'uv' ? 'v′' : 'y', 8, 14);
    // gamuts
    ['srgb', 'p3', 'r2020'].forEach(function (key2) { if (!o[key2]) return; var pr = PRIM[key2]; g.beginPath(); pr.p.forEach(function (p, i) { var q = PX(p[0], p[1]); if (i) g.lineTo(q[0], q[1]); else g.moveTo(q[0], q[1]); }); g.closePath(); g.strokeStyle = pr.c; g.lineWidth = 1.5; g.setLineDash([6, 4]); g.stroke(); g.setLineDash([]); var q0 = PX(pr.p[0][0], pr.p[0][1]); g.fillStyle = pr.c; g.font = '11px system-ui'; g.textAlign = 'left'; g.fillText(pr.n, q0[0] + 6, q0[1] + 12); });
    // Planckian
    if (o.bbl) {
      g.beginPath(); var first = true; for (var q = 0; q <= 240; q++) { var T = 1000 * Math.pow(100, q / 240), p = L.planckXY(T), pp = PX(p.x, p.y); if (first) { g.moveTo(pp[0], pp[1]); first = false; } else g.lineTo(pp[0], pp[1]); }
      g.strokeStyle = fg; g.lineWidth = 1.6; g.stroke();
      var Tl = [1500, 1800, 2000, 2200, 2400, 2700, 3000, 3500, 4000, 4500, 5000, 5700, 6500, 8000, 10000, 15000, 25000, 60000]; g.font = '11px system-ui';
      if (o.iso || o.ansi) Tl.forEach(function (T) { var p = L.planckUV(T), p2 = L.planckUV(T * 1.002), tu = p2.u - p.u, tv = p2.v - p.v, tl = Math.hypot(tu, tv), nu = -tv / tl, nv = tu / tl, len = 0.014; var a = uv60toxy(p.u + nu * len, p.v + nv * len), b = uv60toxy(p.u - nu * len, p.v - nv * len), qa = PX(a.x, a.y), qb = PX(b.x, b.y);
        if (o.iso) { g.beginPath(); g.moveTo(qa[0], qa[1]); g.lineTo(qb[0], qb[1]); g.strokeStyle = fg; g.globalAlpha = 0.55; g.lineWidth = 1; g.stroke(); g.globalAlpha = 1; }
        var onscreen = qa[0] > 0 && qa[0] < W && qa[1] > 0 && qa[1] < H; if (o.iso && onscreen && (k > 600 || [2000, 3000, 4000, 5000, 6500, 10000, 25000].indexOf(T) >= 0 || k > 300 && [2700, 3500, 4500, 5700, 8000].indexOf(T) >= 0)) { g.fillStyle = fg; g.textAlign = 'center'; g.fillText(T >= 1000 ? (T / 1000) + 'k' : T, qa[0] + (qa[0] - qb[0]) * 0.35, qa[1] + (qa[1] - qb[1]) * 0.35 + 4); } });
      if (o.ansi) [0.006, -0.006].forEach(function (dv) { g.beginPath(); var f2 = true; for (var q2 = 0; q2 <= 120; q2++) { var T2 = 1500 * Math.pow(15, q2 / 120), p = L.planckUV(T2), p2 = L.planckUV(T2 * 1.002), tu = p2.u - p.u, tv = p2.v - p.v, tl = Math.hypot(tu, tv), xx = uv60toxy(p.u + (-tv / tl) * dv, p.v + (tu / tl) * dv), pp = PX(xx.x, xx.y); if (f2) { g.moveTo(pp[0], pp[1]); f2 = false; } else g.lineTo(pp[0], pp[1]); } g.strokeStyle = fg; g.globalAlpha = 0.6; g.setLineDash([3, 3]); g.lineWidth = 1; g.stroke(); g.setLineDash([]); g.globalAlpha = 1; });
    }
    // spectral locus
    g.beginPath(); loc.forEach(function (p, i) { var q = PX(p.x, p.y); if (i) g.lineTo(q[0], q[1]); else g.moveTo(q[0], q[1]); }); g.closePath(); g.strokeStyle = fg; g.lineWidth = 2; g.stroke();
    // wavelength ticks
    var wstep = k > 3000 ? 2 : k > 1500 ? 5 : 10; g.font = '11px system-ui'; g.textAlign = 'center';
    loc.forEach(function (p, i) { if (p.wl % wstep !== 0 || p.wl < 400 || p.wl > 700) return; var pi = loc[Math.max(0, i - 2)], pn = loc[Math.min(loc.length - 1, i + 2)], a = PX(pi.x, pi.y), b = PX(pn.x, pn.y), q = PX(p.x, p.y), tx = b[0] - a[0], ty = b[1] - a[1], tl = Math.hypot(tx, ty) || 1, nx = ty / tl, ny = -tx / tl; if (!(q[0] > -20 && q[0] < W + 20 && q[1] > -20 && q[1] < H + 20)) return;
      // outward normal (away from centroid of locus)
      var cx0 = PX(0.33, 0.33); if ((q[0] - cx0[0]) * nx + (q[1] - cx0[1]) * ny < 0) { nx = -nx; ny = -ny; }
      var major = p.wl % 50 === 0 || k > 1500; g.beginPath(); g.moveTo(q[0], q[1]); g.lineTo(q[0] + nx * (major ? 8 : 5), q[1] + ny * (major ? 8 : 5)); g.lineWidth = 1.2; g.stroke();
      if (major) { g.fillStyle = fg; g.fillText(String(p.wl), q[0] + nx * 20, q[1] + ny * 20 + 4); } });
    // reference points
    if (o.refpts) [['E', 1 / 3, 1 / 3], ['D65', 0.31272, 0.32903], ['A', 0.44757, 0.40745]].forEach(function (r) { var q = PX(r[1], r[2]); g.beginPath(); g.arc(q[0], q[1], 3, 0, 7); g.fillStyle = mut; g.fill(); g.fillStyle = mut; g.font = '10.5px system-ui'; g.textAlign = 'left'; g.fillText(r[0], q[0] + 5, q[1] - 4); });
    // gamut polygon of channels (convex hull)
    st.pts.clear();
    if (m) {
      var chans = m.points.filter(function (p) { return p.kind === 'channel'; });
      if (o.gamut && chans.length >= 2) { var hull = convexHull(chans.map(function (p) { return sysOf(p.x, p.y); })); g.beginPath(); hull.forEach(function (p, i) { var q = P(p[0], p[1]); if (i) g.lineTo(q[0], q[1]); else g.moveTo(q[0], q[1]); }); if (hull.length > 2) g.closePath(); g.strokeStyle = cv('--accent'); g.lineWidth = 1.4; g.setLineDash([5, 4]); g.stroke(); g.setLineDash([]); g.fillStyle = alpha(cv('--accent'), 0.08); if (hull.length > 2) g.fill(); }
      m.points.forEach(function (p) {
        if (p.kind === 'channel' && !o.channels) return; var q = PX(p.x, p.y); st.pts.set(p, q);
        g.beginPath(); g.arc(q[0], q[1], p.kind === 'mix' ? 7 : 4.5, 0, 7);
        if (p.kind === 'mix') { g.fillStyle = p.color || fg; g.fill(); g.lineWidth = 2.5; g.strokeStyle = panel; g.stroke(); g.beginPath(); g.arc(q[0], q[1], 9.5, 0, 7); g.lineWidth = 2; g.strokeStyle = fg; g.stroke(); }
        else { g.fillStyle = p.color || fg; g.fill(); g.lineWidth = 1.5; g.strokeStyle = fg; g.stroke(); }
        if (p.label && (o.labels || p.kind === 'mix')) { g.font = (p.kind === 'mix' ? '600 ' : '') + '12px system-ui'; g.textAlign = 'left'; var tw = g.measureText(p.label).width, lx = q[0] + 12, ly = q[1] - 10; if (lx + tw > W - 4) lx = q[0] - tw - 12; g.fillStyle = alpha(panel[0] === '#' ? panel : '#ffffff', 0.78); g.fillRect(lx - 3, ly - 11, tw + 6, 15); g.fillStyle = fg; g.fillText(p.label, lx, ly); }
      });
    }
    // crosshair
    if (st.hover) { var hx = st.hover.x, hy = st.hover.y; var ab = [a0 + hx / k, b1 - hy / k], xy2 = fromSys(ab[0], ab[1]); g.strokeStyle = mut; g.setLineDash([3, 4]); g.lineWidth = 1; g.beginPath(); g.moveTo(hx, 0); g.lineTo(hx, H); g.moveTo(0, hy); g.lineTo(W, hy); g.stroke(); g.setLineDash([]);
      if (onHover && xy2[1] > 0.001) { var uv = L.xy2upvp(xy2[0], xy2[1]), cd = L.cctDuv(xy2[0], xy2[1]), dm = L.dominant(xy2[0], xy2[1]); onHover({ x: xy2[0], y: xy2[1], u: uv.u, v: uv.v, cct: cd.cct, duv: cd.duv, dom: dm }); } }
    st.geom = { W: W, H: H, a0: a0, b1: b1 };
  };
  function convexHull(pts) { pts = pts.slice().sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; }); if (pts.length < 3) return pts; function cr(o, a, b) { return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); } var lo = [], up = [], i; for (i = 0; i < pts.length; i++) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], pts[i]) <= 0) lo.pop(); lo.push(pts[i]); } for (i = pts.length - 1; i >= 0; i--) { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], pts[i]) <= 0) up.pop(); up.push(pts[i]); } lo.pop(); up.pop(); return lo.concat(up); }
  // interaction: pan, wheel zoom, pinch
  var ptrs = new Map(), pinch0 = null;
  canvas.style.touchAction = 'none';
  canvas.addEventListener('pointerdown', function (e) { canvas.setPointerCapture(e.pointerId); var r = canvas.getBoundingClientRect(); ptrs.set(e.pointerId, { x: e.clientX - r.left, y: e.clientY - r.top }); if (ptrs.size === 1) st.drag = { x: e.clientX, y: e.clientY, cx: st.cx, cy: st.cy }; if (ptrs.size === 2) { var a = Array.from(ptrs.values()); pinch0 = { d: Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y), k: st.k }; st.drag = null; } });
  canvas.addEventListener('pointermove', function (e) { var r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top; if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, { x: x, y: y });
    if (ptrs.size === 2 && pinch0) { var a = Array.from(ptrs.values()), d = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y); st.k = Math.max(40, Math.min(2e5, pinch0.k * d / pinch0.d)); self.render(); return; }
    if (st.drag && ptrs.size === 1) { st.cx = st.drag.cx - (e.clientX - st.drag.x) / st.k; st.cy = st.drag.cy + (e.clientY - st.drag.y) / st.k; canvas.style.cursor = 'grabbing'; }
    st.hover = e.pointerType === 'touch' ? null : { x: x, y: y }; self.render(); });
  function up(e) { ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch0 = null; if (!ptrs.size) { st.drag = null; canvas.style.cursor = ''; } }
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('pointerleave', function () { st.hover = null; self.render(); if (onHover) onHover(null); });
  canvas.addEventListener('wheel', function (e) { e.preventDefault(); var r = canvas.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top, f = Math.exp(-e.deltaY * 0.0017), nk = Math.max(40, Math.min(2e5, st.k * f)); var a = st.cx + (mx - r.width / 2) / st.k, b = st.cy - (my - r.height / 2) / st.k; st.k = nk; st.cx = a - (mx - r.width / 2) / nk; st.cy = b + (my - r.height / 2) / nk; self.render(); }, { passive: false });
  canvas.addEventListener('dblclick', function (e) { var r = canvas.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top, nk = st.k * 2, a = st.cx + (mx - r.width / 2) / st.k, b = st.cy - (my - r.height / 2) / st.k; st.k = nk; st.cx = a - (mx - r.width / 2) / nk; st.cy = b + (my - r.height / 2) / nk; self.render(); });
  self.zoom = function (f) { st.k = Math.max(40, Math.min(2e5, st.k * f)); self.render(); };
  self.png = function (name) { canvas.toBlob(function (b) { var a = h('a', { href: URL.createObjectURL(b), download: name || 'cie-diagram.png' }); document.body.appendChild(a); a.click(); a.remove(); }); };
}
A.CIEChart = CIEChart;

/* ================= BARS ================= */
function drawBars(canvas, o) { // o: {values[], labels[], colors[], min,max, zero, refLines[], fmt, ylabel, small}
  var c = setupCanvas(canvas), g = c.g, W = c.w, H = c.h, fg = cv('--fg'), mut = cv('--muted'), grid = cv('--grid');
  g.clearRect(0, 0, W, H); var n = o.values.length, padL = o.ylabel ? 40 : 30, padR = 6, padT = 14, padB = o.labels ? (o.rot ? 40 : 22) : 8, pw = W - padL - padR, ph = H - padT - padB;
  var mn = o.min, mx = o.max; function Y(v) { return padT + ph - (v - mn) / (mx - mn) * ph; }
  g.font = '11px system-ui'; g.textAlign = 'right'; g.fillStyle = mut; g.strokeStyle = grid; var tk = ticks(mn, mx, Math.max(3, Math.floor(ph / 32)));
  tk.t.forEach(function (t) { var y = Y(t); g.beginPath(); g.moveTo(padL, y); g.lineTo(padL + pw, y); g.stroke(); g.fillText((o.tfmt ? o.tfmt(t) : t.toFixed(decs(tk.s))), padL - 4, y + 4); });
  if (o.ylabel) { g.save(); g.translate(11, padT + ph / 2); g.rotate(-Math.PI / 2); g.textAlign = 'center'; g.fillText(o.ylabel, 0, 0); g.restore(); }
  var bw = pw / n, zero = Y(Math.max(mn, Math.min(mx, o.zero == null ? mn : o.zero)));
  (o.refLines || []).forEach(function (r) { var y = Y(r.v); g.strokeStyle = r.c || mut; g.setLineDash([4, 3]); g.beginPath(); g.moveTo(padL, y); g.lineTo(padL + pw, y); g.stroke(); g.setLineDash([]); });
  o.values.forEach(function (v, i) { if (v == null) return; var x = padL + i * bw + bw * 0.12, w = bw * 0.76, y = Y(Math.max(mn, Math.min(mx, v))); g.fillStyle = o.colors ? o.colors[i] : fg; var top = Math.min(y, zero), hh = Math.abs(y - zero); g.fillRect(x, top, w, Math.max(1, hh)); g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 0.5; g.strokeRect(x, top, w, Math.max(1, hh));
    if (!o.small && bw > 24) { g.fillStyle = fg; g.textAlign = 'center'; g.font = '10.5px system-ui'; g.fillText(o.fmt ? o.fmt(v) : v.toFixed(0), x + w / 2, v >= (o.zero || 0) ? y - 3 : y + 11); }
    if (o.labels && (i % Math.max(1, Math.ceil(13 / bw)) === 0 || o.rot)) { g.fillStyle = mut; g.font = '10.5px system-ui'; g.textAlign = 'center'; if (o.rot) { g.save(); g.translate(x + w / 2 + 3, padT + ph + 6); g.rotate(-Math.PI / 3.2); g.textAlign = 'right'; g.fillText(o.labels[i], 0, 0); g.restore(); } else g.fillText(o.labels[i], x + w / 2, padT + ph + 14); } });
}
A.drawBars = drawBars;

/* ================= TM-30 colour vector graphic ================= */
function drawCVG(canvas, tm, binColors) {
  var c = setupCanvas(canvas), g = c.g, W = c.w, H = c.h, fg = cv('--fg'), mut = cv('--muted'), grid = cv('--grid'), R = Math.min(W, H) / 2 - 22, cx = W / 2, cy = H / 2, sc = R / 1.25;
  g.clearRect(0, 0, W, H); g.lineWidth = 1; g.strokeStyle = grid;
  for (var r = 0.25; r <= 1.25; r += 0.25) { g.beginPath(); g.arc(cx, cy, r * sc, 0, 7); g.stroke(); }
  g.beginPath(); g.moveTo(cx - R - 14, cy); g.lineTo(cx + R + 14, cy); g.moveTo(cx, cy - R - 14); g.lineTo(cx, cy + R + 14); g.stroke();
  // bin sectors
  for (var j = 0; j < 16; j++) { var a0 = j * Math.PI / 8, a1 = (j + 1) * Math.PI / 8; g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, 1.18 * sc, -a1, -a0); g.closePath(); var col = binColors ? binColors[j] : [128, 128, 128]; g.fillStyle = 'rgba(' + (col[0] | 0) + ',' + (col[1] | 0) + ',' + (col[2] | 0) + ',0.14)'; g.fill();
    g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a0) * 1.18 * sc, cy - Math.sin(a0) * 1.18 * sc); g.strokeStyle = grid; g.stroke();
    var am = (a0 + a1) / 2; g.fillStyle = mut; g.font = '10.5px system-ui'; g.textAlign = 'center'; g.fillText(String(j + 1), cx + Math.cos(am) * 1.24 * sc, cy - Math.sin(am) * 1.24 * sc + 4); }
  // reference circle
  g.beginPath(); g.arc(cx, cy, sc, 0, 7); g.strokeStyle = fg; g.lineWidth = 2; g.stroke();
  // test polygon
  var pts = tm.cvg.map(function (p) { return p ? [cx + p.tx * sc, cy - p.ty * sc] : null; }).filter(Boolean);
  g.beginPath(); pts.forEach(function (p, i) { if (i) g.lineTo(p[0], p[1]); else g.moveTo(p[0], p[1]); }); g.closePath(); g.fillStyle = 'rgba(220,38,38,0.10)'; g.fill(); g.strokeStyle = '#dc2626'; g.lineWidth = 2.2; g.stroke();
  tm.cvg.forEach(function (p, j) { if (!p) return; g.beginPath(); g.arc(cx + p.tx * sc, cy - p.ty * sc, 3.6, 0, 7); var col = binColors ? binColors[j] : [200, 60, 60]; g.fillStyle = 'rgb(' + (col[0] | 0) + ',' + (col[1] | 0) + ',' + (col[2] | 0) + ')'; g.fill(); g.strokeStyle = '#dc2626'; g.lineWidth = 1.4; g.stroke(); });
}
A.drawCVG = drawCVG;
A.cv = cv; A.setupCanvas = setupCanvas; A.ticks = ticks; A.alpha = alpha;
})();
