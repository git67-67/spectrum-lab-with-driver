/* LED Spectrum Lab - automatic peak and valley labels for the spectrum charts
 * SPDX-License-Identifier: AGPL-3.0-or-later */
(function () {
'use strict';
var L = window.LSL, A = window.APP, h = A.h;
var DEF = { peaks: false, valleys: false, n: 8, prom: 6, sep: 12, smooth: 3, value: false, all: false };
function opt(o) { return Object.assign({}, DEF, o && o.lab); }
A.ui.spec.lab = Object.assign({}, DEF);

/* extrema of a sampled curve. y: array on a 1 nm grid starting at w0. Returns {peaks:[{nm,y,prom}], valleys:[...]} most prominent first */
function extrema(y, w0, lo, hi, p) {
  var n = y.length, s = new Float64Array(n), i, j, hw = Math.max(0, Math.round((p.smooth - 1) / 2)), mx = 0;
  for (i = 0; i < n; i++) { var a = 0, c = 0; for (j = Math.max(0, i - hw); j <= Math.min(n - 1, i + hw); j++) { var k = hw + 1 - Math.abs(j - i); a += y[j] * k; c += k; } s[i] = a / c; if (s[i] > mx) mx = s[i]; }
  var out = { peaks: [], valleys: [] }; if (!(mx > 0)) return out;
  var thr = p.prom / 100 * mx, i0 = Math.max(1, Math.floor(lo - w0)), i1 = Math.min(n - 2, Math.ceil(hi - w0));
  // first and last sample that carries signal: nothing is labelled in the empty tails
  var a0 = 0, a1 = n - 1; while (a0 < n && s[a0] < 0.005 * mx) a0++; while (a1 > 0 && s[a1] < 0.005 * mx) a1--;
  function prominence(sig, idx, lowLim, highLim) {   // height of sig[idx] above the higher of the two lowest points reached before a taller sample
    var l = idx, minL = sig[idx], r = idx, minR = sig[idx];
    while (l > lowLim && sig[l - 1] <= sig[idx]) { l--; if (sig[l] < minL) minL = sig[l]; }
    while (r < highLim && sig[r + 1] <= sig[idx]) { r++; if (sig[r] < minR) minR = sig[r]; }
    var leftTall = l > lowLim, rightTall = r < highLim;
    if (!leftTall && !rightTall) return sig[idx] - Math.min(minL, minR);     // highest point of the whole range
    return sig[idx] - Math.max(leftTall ? minL : -Infinity, rightTall ? minR : -Infinity);
  }
  function refine(sig, i) { var y0 = sig[i - 1], y1 = sig[i], y2 = sig[i + 1], d = y0 - 2 * y1 + y2; return w0 + i + (d ? Math.max(-1, Math.min(1, 0.5 * (y0 - y2) / d)) : 0); }
  var cand = [];
  for (i = Math.max(i0, a0 + 1); i <= Math.min(i1, a1 - 1); i++) if (s[i] > s[i - 1] && s[i] >= s[i + 1]) { var pr = prominence(s, i, a0, a1); if (pr >= thr) cand.push({ i: i, prom: pr }); }
  var firstPk = cand.length ? Math.min.apply(null, cand.map(function (c) { return c.i; })) : -1, lastPk = cand.length ? Math.max.apply(null, cand.map(function (c) { return c.i; })) : -1;
  function pick(list, sig, kind) {
    list.sort(function (u, v) { return v.prom - u.prom; }); var chosen = [];
    list.forEach(function (c) { if (chosen.length >= p.n) return; var nm = refine(sig, c.i); if (chosen.some(function (q) { return Math.abs(q.nm - nm) < p.sep; })) return; chosen.push({ nm: nm, y: kind === 'v' ? -sig[c.i] : sig[c.i], prom: c.prom }); });
    return chosen;
  }
  out.peaks = pick(cand, s, 'p');
  if (p.valleys && firstPk >= 0 && lastPk > firstPk) {     // valleys only between the outermost labelled-eligible peaks
    var inv = new Float64Array(n); for (i = 0; i < n; i++) inv[i] = -s[i] + mx;      // flip: valleys become peaks
    var vc = []; for (i = firstPk + 1; i < lastPk; i++) if (inv[i] > inv[i - 1] && inv[i] >= inv[i + 1]) { var pv = prominence(inv, i, firstPk, lastPk); if (pv >= thr) vc.push({ i: i, prom: pv }); }
    out.valleys = pick(vc, inv, 'v').map(function (q) { return { nm: q.nm, y: mx - (q.y + 0) * -1 - mx * 0, prom: q.prom }; });
    out.valleys.forEach(function (q) { var idx = Math.round(q.nm - w0); q.y = s[Math.max(0, Math.min(n - 1, idx))]; });
  }
  return out;
}
A.extrema = extrema;

A.drawLabels = function (g, data, o, c) {
  var p = opt(o); if (!p.peaks && !p.valleys) return; if (!p.peaks && p.valleys) p = Object.assign({}, p);
  var mainOnly = !p.all, list = data.filter(function (d) { return !(d.s.channel) && !d.s.noLabel; });
  if (mainOnly) { var mn = list.filter(function (d) { return d.s.main; }); list = mn.length ? mn.slice(0, 1) : list.slice(0, 1); }
  var used = [], H = g.canvas.height / (window.devicePixelRatio || 1);
  g.save(); g.beginPath(); g.rect(c.padL, c.padT - 2, c.pw, c.ph + 4); g.clip(); g.font = '11px system-ui'; g.textAlign = 'center';
  function place(txt, x, y, up, col, bold) {
    var w = g.measureText(txt).width + 4, hh = 13, ty = up ? y - 9 : y + 9, r = { x0: x - w / 2, x1: x + w / 2, y0: ty - 11, y1: ty + 2 };
    if (r.x0 < c.padL) { var sh = c.padL - r.x0; r.x0 += sh; r.x1 += sh; x += sh; } if (r.x1 > c.padL + c.pw) { var sh2 = r.x1 - (c.padL + c.pw); r.x0 -= sh2; r.x1 -= sh2; x -= sh2; }
    for (var t = 0; t < 3; t++) { if (!used.some(function (u) { return !(r.x1 < u.x0 || r.x0 > u.x1 || r.y1 < u.y0 || r.y0 > u.y1); })) break; var dy = up ? -12 : 12; r.y0 += dy; r.y1 += dy; ty += dy; }
    if (used.some(function (u) { return !(r.x1 < u.x0 || r.x0 > u.x1 || r.y1 < u.y0 || r.y0 > u.y1); })) return;
    used.push(r); g.lineWidth = 3; g.strokeStyle = c.bg; g.strokeText(txt, x, ty); g.fillStyle = col; g.font = (bold ? '600 ' : '') + '11px system-ui'; g.fillText(txt, x, ty);
  }
  list.forEach(function (d) {
    var e = extrema(d.y, L.WL0, c.v.x0, c.v.x1, p), col = d.s.color || c.fg;
    function lab(q) { return q.nm.toFixed(p.sep < 3 ? 2 : 1) + ' nm' + (p.value ? ' · ' + (Math.abs(q.y) >= 100 ? q.y.toFixed(0) : q.y >= 10 ? q.y.toFixed(1) : q.y.toPrecision(2)) : ''); }
    if (p.peaks) e.peaks.forEach(function (q) { if (q.nm < c.v.x0 || q.nm > c.v.x1) return; var x = c.X(q.nm), y = c.Y(q.y); g.fillStyle = col; g.beginPath(); g.moveTo(x, y - 3); g.lineTo(x - 3.5, y - 9); g.lineTo(x + 3.5, y - 9); g.closePath(); g.fill(); place(lab(q), x, y - 8, true, c.fg, true); });
    if (p.valleys) e.valleys.forEach(function (q) { if (q.nm < c.v.x0 || q.nm > c.v.x1) return; var x = c.X(q.nm), y = c.Y(q.y); g.fillStyle = col; g.beginPath(); g.moveTo(x, y + 3); g.lineTo(x - 3.5, y + 9); g.lineTo(x + 3.5, y + 9); g.closePath(); g.fill(); place(lab(q), x, y + 10, false, c.mut, false); });
  });
  g.restore();
};

/* the controls: a second toolbar on the Spectrum tab */
function controls(redraw) {
  var o = A.ui.spec; o.lab = Object.assign({}, DEF, o.lab); var p = o.lab;
  function cb(label, key, tip) { return h('label', { class: 'chk', title: tip || '' }, h('input', { type: 'checkbox', checked: !!p[key], onchange: function () { p[key] = this.checked; A.save(); redraw(); } }), label); }
  function nb(label, key, min, max, step, tip) { return h('label', { class: 'chk', title: tip || '' }, label, h('input', { class: 'inp sm', type: 'number', min: min, max: max, step: step, value: p[key], style: { width: '58px' }, onchange: function () { var v = parseFloat(this.value); if (isFinite(v)) { p[key] = Math.max(min, Math.min(max, v)); A.save(); redraw(); } } })); }
  return h('div', { class: 'toolbar labtools' }, h('b', { text: 'Auto labels' }), cb('peaks ▲', 'peaks', 'Label the strongest peaks with their wavelength'), cb('valleys ▼', 'valleys', 'Label the valleys between peaks'), cb('with value', 'value', 'Add the height to each label'),
    cb('all traces', 'all', 'Label every trace, not only the main one'), nb('max', 'n', 1, 30, 1, 'Maximum number of peaks and of valleys per trace'), nb('prominence %', 'prom', 0.5, 80, 0.5, 'A peak or valley must stand out by this percentage of the highest point'),
    nb('min. spacing nm', 'sep', 1, 100, 1, 'Labels closer than this are merged'), nb('smooth nm', 'smooth', 1, 25, 2, 'Averaging width applied before searching (reduces noise peaks)'));
}
var T = A.tabs, orig = T.spectrum.build;
T.spectrum.build = function (root) {
  var self = this; orig.call(self, root);
  var bar = controls(function () { self.update(); }); root.insertBefore(bar, root.children[1] || null);
};
var o2 = T.overlay && T.overlay.build;
if (o2) T.overlay.build = function (root) { var self = this; o2.call(self, root); root.insertBefore(controls(function () { self.update(); }), root.children[1] || null); };
})();
