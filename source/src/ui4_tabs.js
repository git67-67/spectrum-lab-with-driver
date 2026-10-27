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
/* LED Spectrum Lab - UI part 4: analysis tabs, header, wiring */
(function () {
'use strict';
var L = window.LSL, A = window.APP, h = A.h, $ = A.$, fmt = A.fmt;
var R = null, tabs = {}, order = [];

function compute() {
  var s = A.sourceSpd();
  if (!(L.sumAll(s.spd) > 0)) { R = null; return; }
  var a = L.analyse(s.spd, { Ev: +A.mix.Ev || 500 });
  R = { src: s, a: a };
}
function sgn(v, d) { return (v >= 0 ? '+' : '') + v.toFixed(d); }
function kpi(label, value, unit, sub, cls) { return h('div', { class: 'kpi ' + (cls || '') }, h('div', { class: 'kpi-l', text: label }), h('div', { class: 'kpi-v' }, value, unit ? h('small', { text: ' ' + unit }) : null), sub ? h('div', { class: 'kpi-s', text: sub }) : null); }
function table(rows, head, cls) { var t = h('table', { class: 'tbl ' + (cls || '') }); if (head) t.appendChild(h('thead', null, h('tr', null, head.map(function (x) { return h('th', { text: x }); })))); var tb = h('tbody'); rows.forEach(function (r) { tb.appendChild(h('tr', null, r.map(function (c, i) { return c instanceof Node ? h('td', null, c) : h('td', { class: i ? 'num' : '', text: c == null ? '' : String(c) }); }))); }); t.appendChild(tb); return t; }
function sw(rgb) { return h('span', { class: 'sw', style: { background: A.rgb(rgb) } }); }
function seg(opts, cur, cb) { return h('div', { class: 'seg' }, opts.map(function (o) { return h('button', { class: 'seg-b' + (cur() === o[0] ? ' on' : ''), onclick: function () { cb(o[0]); } }, o[1]); })); }
function chk(label, obj, key, after) { return h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: !!obj[key], onchange: function () { obj[key] = this.checked; A.save(); (after || refreshAll)(); } }), label); }
function visible(c) { return c && c.getBoundingClientRect().width > 20; }

/* ---------- models ---------- */
function refSpdScaled() { var ref = R.a.tm30.ref; return L.scale(ref, R.a.radiantW / (L.sumAll(ref) || 1)); }
function otherScaled(key) {
  if (key === 'none') return null;
  if (key === 'ref') return { name: 'TM-30 reference (' + R.a.tm30.refType + ' ' + Math.round(R.a.tm30.refCCT) + ' K)', spd: refSpdScaled() };
  var o = A.otherSpd(key); if (!o) return null;
  if (key === 'D65' || key === 'A') { var Y = 683 * L.sumVis(o.spd, L.T.y31); o = { name: o.name, spd: L.scale(o.spd, R.a.lumens / (Y || 1)) }; }
  return o;
}
function specModel() {
  if (!R) return null; var o = A.ui.spec, series = [{ name: R.src.name, y: R.src.spd, color: A.cv('--accent'), fill: true, main: true, width: 2 }];
  if (A.source === 'mix') R.src.info.forEach(function (inf, i) { if (inf.led && inf.spd && inf.rad > 0) series.push({ name: inf.led.name, y: inf.spd, color: A.PAL[(i + 1) % A.PAL.length], channel: true, dash: [4, 3], width: 1.2 }); });
  var c = otherScaled(A.compare); if (c) series.push({ name: c.name, y: c.spd, color: A.cv('--muted'), width: 1.7, dash: [7, 3] });
  return { series: series };
}
function pointOf(spd, name, kind, color) { var t = L.XYZ(spd, A.ui.cie.obs === 10 ? 10 : 2), c = L.xyOf(t); if (!isFinite(c.x)) return null; var cd = L.cctDuv(c.x, c.y), u = L.xy2upvp(c.x, c.y); return { x: c.x, y: c.y, u: u.u, v: u.v, cct: cd.cct, duv: cd.duv, kind: kind, color: color, label: name }; }
function cieModel() {
  if (!R) return null; var pts = [], a = R.a, o = A.ui.cie, m = o.obs === 10 ? a.xy10 : a.xy, u = o.obs === 10 ? a.upvp10 : a.upvp, rgb = L.xyToRGB(m.x, m.y);
  pts.push({ x: m.x, y: m.y, u: u.u, v: u.v, cct: a.cct, duv: a.duv, kind: 'mix', color: A.rgb(rgb), label: R.src.name });
  if (A.source === 'mix') R.src.info.forEach(function (inf) { if (!inf.led || !(inf.rad > 0)) return; var p = pointOf(inf.spd, inf.led.name, 'channel', A.rgb(L.xyToRGB.apply(null, (function () { var c = L.xyOf(L.XYZ(inf.spd, 2)); return [c.x, c.y]; })()))); if (p) pts.push(p); });
  var c = otherScaled(A.compare); if (c) { var p2 = pointOf(c.spd, c.name, 'cmp', A.cv('--muted')); if (p2) pts.push(p2); }
  return { points: pts };
}
function ptTable(model) { return table(model.points.map(function (p) { return [p.label, p.x.toFixed(4), p.y.toFixed(4), p.u.toFixed(4), p.v.toFixed(4), p.cct > 0 && p.cct < 1e5 ? Math.round(p.cct) + ' K' : '–', (p.duv >= 0 ? '+' : '') + p.duv.toFixed(4)]; }), ['Point', 'x', 'y', 'u′', 'v′', 'CCT', 'Duv']); }

/* ---------- tab: overview ---------- */
tabs.overview = { label: 'Overview', build: function (root) {
  var kp = h('div', { class: 'kpis' }), sc = h('canvas', { class: 'chart', style: { height: '300px' } }), cc = h('canvas', { class: 'chart sq', style: { height: '300px' } }), note = h('div', { class: 'notes' });
  var s = new A.SpectrumChart(sc, specModel), c = new A.CIEChart(cc, cieModel);
  root.appendChild(kp); root.appendChild(h('div', { class: 'grid2' }, h('div', { class: 'card' }, h('h3', null, 'Spectrum'), sc), h('div', { class: 'card' }, h('div', { class: 'card-h' }, h('h3', null, 'Chromaticity'), h('div', { class: 'grow' }), h('button', { class: 'btn sm', onclick: function () { c.fit(); } }, 'Zoom to point'), h('button', { class: 'btn sm', onclick: function () { c.reset(); } }, 'Reset')), cc))); root.appendChild(note);
  var fitted = false;
  this.update = function () {
    kp.innerHTML = ''; note.innerHTML = ''; if (!R) { kp.appendChild(h('div', { class: 'empty', text: 'Nothing to analyse yet – add LEDs to the mix (＋ in the library) or pick a single LED as the source.' })); s.render(); c.render(); return; }
    var a = R.a, t = a.tm30, rgb = L.xyToRGB(a.xy.x, a.xy.y);
    var P = R.src.power, white = a.cctValid;
    [kpi('CCT', white ? Math.round(a.cct) : '–', 'K', white ? 'McCamy ' + Math.round(a.cctMcCamy) + ' K' : 'Duv too large – not near the Planckian locus', 'big'), kpi('Duv', sgn(a.duv, 4), '', a.duv >= 0 ? 'above locus (greenish)' : 'below locus (pinkish)'),
      kpi('CRI Ra', a.cri.Ra.toFixed(1), '', 'R9 ' + a.cri.R[8].toFixed(0) + ' · R12 ' + a.cri.R[11].toFixed(0)), kpi('TM-30 Rf', t.Rf.toFixed(1), '', 'Rg ' + t.Rg.toFixed(1) + ' · Rcs,h1 ' + (t.Rcsh1 * 100).toFixed(1) + ' %'),
      kpi('Luminous flux', fmt(a.lumens, a.lumens >= 100 ? 0 : 1), 'lm', 'photopic 2°'), kpi('Radiant flux', fmt(a.radiantW * 1000, a.radiantW >= 0.1 ? 0 : 1), 'mW', fmt(a.WperLm * 1000, 2) + ' mW/lm'),
      kpi('LER', a.LER.toFixed(1), 'lm/W₀', 'lumens per watt of radiation'), kpi('Efficacy', P ? (a.lumens / P).toFixed(1) : '–', 'lm/W', P ? 'electrical ' + P.toFixed(2) + ' W · WPE ' + (a.radiantW / P * 100).toFixed(1) + ' %' : 'needs Vf and If of each LED'),
      kpi('PPF', a.photon.ppf.toFixed(2), 'µmol/s', 'ePAR ' + a.photon.epar.toFixed(2) + ' · ' + (a.radiantW > 0 ? (a.photon.ppf / a.radiantW).toFixed(2) : '') + ' µmol/J'), kpi('Melanopic DER', a.alpha.Mel.DER.toFixed(3), '', 'EDI ' + a.alpha.Mel.EDI.toFixed(0) + ' lx at ' + a.Ev + ' lx'),
      kpi('S/P ratio', a.SP.toFixed(2), '', 'scotopic / photopic'), kpi('SSI', a.sq.ssi.toFixed(1), '', 'cyan dip ' + fmtRatio(a.sq.bands.cyan.trough) + ' \u00b7 deep red ' + fmtRatio(a.sq.bands.deepred.ratio)), kpi('Smoothness', a.sq.smooth.toFixed(1), '%', a.sq.narrowest ? 'narrowest peak ' + a.sq.narrowest.fwhm.toFixed(0) + ' nm' : 'no distinct peaks'), kpi('Colour', h('span', { class: 'sw big', style: { background: A.rgb(rgb) } }), '', 'x ' + a.xy.x.toFixed(4) + ' y ' + a.xy.y.toFixed(4))].forEach(function (k) { kp.appendChild(k); });
    var warn = []; if (a.bandsRad.uv / a.radiantW > 0.02) warn.push('Noticeable UV content below 380 nm (' + (a.bandsRad.uv / a.radiantW * 100).toFixed(1) + ' % of radiant power).'); if (a.bandsRad.nir / a.radiantW > 0.02) warn.push('Noticeable radiation above 780 nm (' + (a.bandsRad.nir / a.radiantW * 100).toFixed(1) + ' %). It does not contribute to lumens.');
    if (!a.cctValid) warn.push('|Duv| > 0.05: CCT, CRI and TM-30 reference illuminants are only formally defined for near-white light. Values are shown for information.'); if (R.src.power == null) warn.push('Some LEDs have no Vf / If, so electrical power and efficacy are unavailable.');
    warn.forEach(function (w) { note.appendChild(h('div', { class: 'warn', text: '⚠ ' + w })); }); s.render(); c.render();
  };
  this.render = function () { s.render(); c.render(); };
} };

/* ---------- tab: spectrum ---------- */
tabs.spectrum = { label: 'Spectrum', build: function (root) {
  var cv_ = h('canvas', { class: 'chart', style: { height: '460px' } }), ch = new A.SpectrumChart(cv_, specModel), o = A.ui.spec;
  function rr() { A.save(); ch.render(); }
  var ovs = [['V', 'V(λ)'], ['Vp', 'V′(λ)'], ['Mel', 'Melanopic'], ['S', 'S'], ['M', 'M'], ['L', 'L']];
  var tb = h('div', { class: 'toolbar' }, h('div', null, 'Y axis'), h('div', { class: 'seg' }, [['abs', 'mW/nm'], ['photon', 'µmol/s/nm'], ['norm', 'Normalised']].map(function (m) { return h('button', { class: 'seg-b' + (o.yMode === m[0] ? ' on' : ''), onclick: function () { o.yMode = m[0]; $$on(this); rr(); } }, m[1]); })),
    chk('Log', o, 'log', rr), chk('Fill', o, 'fill', rr), chk('Channels', o, 'channels', rr), h('span', { class: 'sep' }), h('span', { text: 'Overlay' }), ovs.map(function (v) { return h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: !!o.overlays[v[0]], onchange: function () { o.overlays[v[0]] = this.checked; rr(); } }), v[1]); }),
    h('div', { class: 'grow' }), h('button', { class: 'btn sm', onclick: function () { ch.zoom(0.6); } }, '+'), h('button', { class: 'btn sm', onclick: function () { ch.zoom(1.6); } }, '−'), h('button', { class: 'btn sm', onclick: function () { ch.resetZoom(); } }, 'Reset'),
    h('button', { class: 'btn sm', onclick: function () { pngOf(cv_, 'spectrum.png'); } }, 'PNG'), h('button', { class: 'btn sm', onclick: exportSpectrumCSV }, 'CSV'));
  function $$on(btn) { Array.prototype.forEach.call(btn.parentNode.children, function (b) { b.classList.remove('on'); }); btn.classList.add('on'); }
  root.appendChild(tb); root.appendChild(h('div', { class: 'card' }, cv_)); root.appendChild(h('p', { class: 'hint', text: 'Wheel = zoom, drag = pan, double-click = reset. Weighting curves are scaled to the plot height. Photon mode converts W/nm to µmol s⁻¹ nm⁻¹.' }));
  this.update = function () { ch.render(); }; this.render = this.update;
} };

/* ---------- tab: CIE ---------- */
tabs.cie = { label: 'CIE diagram', build: function (root) {
  var cc = h('canvas', { class: 'chart cie', style: { height: '620px' } }), o = A.ui.cie, hov = h('div', { class: 'hov', text: 'Hover the diagram for coordinates, CCT and dominant wavelength.' }), tbl = h('div', { class: 'tblwrap' });
  var ch = new A.CIEChart(cc, cieModel, function (p) { if (!p) { hov.textContent = 'Hover the diagram for coordinates, CCT and dominant wavelength.'; return; } hov.textContent = 'x ' + p.x.toFixed(4) + '  y ' + p.y.toFixed(4) + '   |   u′ ' + p.u.toFixed(4) + '  v′ ' + p.v.toFixed(4) + '   |   CCT ' + (p.cct > 0 && p.cct < 1e5 ? Math.round(p.cct) + ' K' : '–') + '  Duv ' + sgn(p.duv, 4) + (p.dom ? '   |   ' + (p.dom.complementary ? 'compl. ' : 'λd ') + p.dom.wl.toFixed(1) + ' nm' : ''); });
  function rr() { A.save(); ch.render(); }
  var tb = h('div', { class: 'toolbar' }, h('div', { class: 'seg' }, [['xy', 'CIE 1931 xy'], ['uv', 'CIE 1976 u′v′']].map(function (m) { return h('button', { class: 'seg-b' + (o.sys === m[0] ? ' on' : ''), onclick: function () { o.sys = m[0]; Array.prototype.forEach.call(this.parentNode.children, function (b) { b.classList.remove('on'); }); this.classList.add('on'); ch.reset(); A.save(); } }, m[1]); })),
    h('div', { class: 'seg' }, [[2, '2°'], [10, '10°']].map(function (m) { return h('button', { class: 'seg-b' + (o.obs === m[0] ? ' on' : ''), onclick: function () { o.obs = m[0]; Array.prototype.forEach.call(this.parentNode.children, function (b) { b.classList.remove('on'); }); this.classList.add('on'); refreshAll(); A.save(); } }, m[1]); })),
    [['fill', 'Colour fill'], ['bbl', 'Planckian locus'], ['iso', 'CCT isotherms'], ['ansi', 'ANSI ±Duv'], ['channels', 'Channels'], ['gamut', 'Channel gamut'], ['labels', 'Labels'], ['refpts', 'E / D65 / A'], ['srgb', 'sRGB'], ['p3', 'P3'], ['r2020', 'Rec.2020'], ['grid', 'Grid']].map(function (k) { return chk(k[1], o, k[0], rr); }));
  var tb2 = h('div', { class: 'toolbar' }, h('button', { class: 'btn sm', onclick: function () { ch.zoom(1.5); } }, 'Zoom +'), h('button', { class: 'btn sm', onclick: function () { ch.zoom(1 / 1.5); } }, 'Zoom −'), h('button', { class: 'btn sm', onclick: function () { ch.fit(); } }, 'Fit points'), h('button', { class: 'btn sm', onclick: function () { ch.reset(); } }, 'Reset'), h('button', { class: 'btn sm', onclick: function () { ch.png('cie-diagram.png'); } }, 'PNG'), hov);
  root.appendChild(tb); root.appendChild(tb2); root.appendChild(h('div', { class: 'card' }, cc)); root.appendChild(h('div', { class: 'card' }, tbl)); root.appendChild(h('p', { class: 'hint', text: 'Wheel / pinch = zoom, drag = pan, double-click = zoom in at the cursor. Isotherms are drawn perpendicular to the locus in CIE 1960 uv; labelled CCTs appear as you zoom in.' }));
  this.update = function () { ch.render(); tbl.innerHTML = ''; var m = cieModel(); if (m) tbl.appendChild(ptTable(m)); }; this.render = function () { ch.render(); };
} };

/* ---------- tab: colour rendering (CRI) ---------- */
tabs.cri = { label: 'CRI', build: function (root) {
  var kp = h('div', { class: 'kpis' }), cb = h('canvas', { class: 'chart', style: { height: '280px' } }), tbl = h('div', { class: 'tblwrap' }), info = h('div', { class: 'hint' });
  root.appendChild(kp); root.appendChild(h('div', { class: 'card' }, h('h3', null, 'Special colour rendering indices R1–R14 (CIE 13.3-1995)'), cb)); root.appendChild(h('div', { class: 'card' }, h('h3', null, 'Test colour samples'), tbl)); root.appendChild(info);
  this.update = function () {
    kp.innerHTML = ''; tbl.innerHTML = ''; if (!R) return; var c = R.a.cri, a = R.a, ref = c.ref, Wt = [a.XYZ.X / a.XYZ.Y * 100, 100, a.XYZ.Z / a.XYZ.Y * 100], rt = L.XYZ(ref, 2), Wr = [rt.X / rt.Y * 100, 100, rt.Z / rt.Y * 100];
    var cols = c.swatchTest.map(function (x) { return A.swatch(x.map(function (v) { return v * 100; }), Wt); }), colsR = c.swatchRef.map(function (x) { return A.swatch(x.map(function (v) { return v * 100; }), Wr); });
    var Rm = c.R.slice(0, 14), r9to15 = c.R.slice(8);
    [kpi('Ra (R1–R8)', c.Ra.toFixed(1), '', 'general index', 'big'), kpi('R9 (saturated red)', c.R[8].toFixed(1), '', ''), kpi('R12 (saturated blue)', c.R[11].toFixed(1), '', ''), kpi('R13 (skin) / R14 (leaf)', c.R[12].toFixed(0) + ' / ' + c.R[13].toFixed(0), '', ''), kpi('Reference illuminant', c.refType, '', Math.round(c.refCCT) + ' K'), kpi('R1–14 mean', (c.R.reduce(function (s, v) { return s + v; }, 0) / 14).toFixed(1), '', 'extended average')].forEach(function (k) { kp.appendChild(k); });
    A.drawBars(cb, { values: c.R, labels: c.R.map(function (_, i) { return 'R' + (i + 1); }), colors: cols.map(A.rgb), min: Math.min(0, Math.floor(Math.min.apply(null, c.R) / 20) * 20), max: 100, zero: 0, fmt: function (v) { return v.toFixed(0); }, refLines: [{ v: 80, c: '#d97706' }, { v: 90, c: '#16a34a' }] });
    var rows = c.R.map(function (v, i) { return ['R' + (i + 1) + (i >= 8 ? '*' : ''), h('span', null, sw(colsR[i]), ' ref ', sw(cols[i]), ' test'), c.dE[i].toFixed(2), v.toFixed(1)]; });
    tbl.appendChild(table(rows, ['Sample', 'Appearance (under ref / under test)', 'ΔE (U*V*W*)', 'Ri']));
    info.textContent = 'Ra is the mean of R1–R8. * R9–R14 are the supplementary samples (R9 saturated red, R10 yellow, R11 green, R12 blue, R13 skin, R14 leaf). Reference: Planckian radiator below 5000 K, CIE daylight (D-series) at or above 5000 K. Swatch colours are an on-screen approximation. CRI is known to be unsuitable for narrow-band LED spectra; see TM-30.';
  };
  this.render = function () { this.update(); };
} };

/* ---------- tab: TM-30 ---------- */
tabs.tm30 = { label: 'TM-30', build: function (root) {
  var kp = h('div', { class: 'kpis' }), cvg = h('canvas', { class: 'chart sq', style: { height: '380px' } }), cRfh = h('canvas', { class: 'chart', style: { height: '220px' } }), cRcs = h('canvas', { class: 'chart', style: { height: '220px' } }), cRhs = h('canvas', { class: 'chart', style: { height: '220px' } }), cEs = h('canvas', { class: 'chart', style: { height: '220px' } }), tbl = h('div', { class: 'tblwrap' }), info = h('div', { class: 'hint' });
  root.appendChild(kp);
  root.appendChild(h('div', { class: 'grid2' }, h('div', { class: 'card' }, h('h3', null, 'Colour vector graphic'), cvg), h('div', { class: 'card' }, h('h3', null, 'Local colour fidelity Rf,h'), cRfh, h('h3', null, 'Local chroma shift Rcs,h'), cRcs)));
  root.appendChild(h('div', { class: 'grid2' }, h('div', { class: 'card' }, h('h3', null, 'Local hue shift Rhs,h'), cRhs), h('div', { class: 'card' }, h('h3', null, 'Colour fidelity of the 99 colour evaluation samples (CES)'), cEs)));
  root.appendChild(h('div', { class: 'card' }, h('h3', null, 'Hue-bin table'), tbl)); root.appendChild(info);
  this.update = function () {
    kp.innerHTML = ''; tbl.innerHTML = ''; if (!R) return; var a = R.a, t = a.tm30;
    var binCols = t.bins.map(function (b) { if (!b.n) return [128, 128, 128]; var s = [0, 0, 0]; b.idx.forEach(function (i) { var c = A.swatch(t.swatchRef[i], t.whiteRef); s[0] += c[0]; s[1] += c[1]; s[2] += c[2]; }); return [s[0] / b.n, s[1] / b.n, s[2] / b.n]; });
    [kpi('Rf (fidelity)', t.Rf.toFixed(1), '', 'average of 99 CES', 'big'), kpi('Rg (gamut)', t.Rg.toFixed(1), '', '100 = same gamut area as reference', 'big'), kpi('Rf,skin', t.Rfskin.toFixed(1), '', 'CES 15 & 18'), kpi('Rcs,h1', sgn(t.Rcsh1 * 100, 1), '%', 'red chroma shift'), kpi('Reference', t.refType, '', Math.round(t.refCCT) + ' K'), kpi('CCT / Duv', Math.round(a.cct) + ' K', '', sgn(a.duv, 4))].forEach(function (k) { kp.appendChild(k); });
    A.drawCVG(cvg, t, binCols);
    var lab = t.bins.map(function (_, i) { return String(i + 1); });
    A.drawBars(cRfh, { values: t.Rfh.map(function (v) { return v == null ? null : v; }), labels: lab, colors: binCols.map(A.rgb), min: 0, max: 100, fmt: function (v) { return v.toFixed(0); }, ylabel: 'Rf,h' });
    var pc = t.Rcs.map(function (v) { return v == null ? null : v * 100; }), lim = Math.max(15, Math.ceil(Math.max.apply(null, pc.map(function (v) { return Math.abs(v || 0); })) / 5) * 5);
    A.drawBars(cRcs, { values: pc, labels: lab, colors: binCols.map(A.rgb), min: -lim, max: lim, zero: 0, fmt: function (v) { return (v >= 0 ? '+' : '') + v.toFixed(0) + '%'; }, ylabel: 'Rcs,h (%)', tfmt: function (v) { return v.toFixed(0); } });
    var hs = t.Rhs.map(function (v) { return v == null ? null : v; }), hl = Math.max(0.2, Math.ceil(Math.max.apply(null, hs.map(function (v) { return Math.abs(v || 0); })) * 10) / 10);
    A.drawBars(cRhs, { values: hs, labels: lab, colors: binCols.map(A.rgb), min: -hl, max: hl, zero: 0, fmt: function (v) { return (v >= 0 ? '+' : '') + v.toFixed(2); }, ylabel: 'Rhs,h (rad)', tfmt: function (v) { return v.toFixed(2); } });
    var ces = t.RfI, cc = ces.map(function (_, i) { return A.rgb(A.swatch(t.swatchRef[i], t.whiteRef)); });
    A.drawBars(cEs, { values: ces, labels: ces.map(function (_, i) { return String(i + 1); }), colors: cc, min: Math.min(0, Math.floor(Math.min.apply(null, ces) / 20) * 20), max: 100, small: true, ylabel: 'Rf,CESi' });
    var rows = t.bins.map(function (b, j) { return [String(j + 1), L.HUE_NAMES[j], b.n, h('span', null, sw(binCols[j])), t.Rfh[j] == null ? '–' : t.Rfh[j].toFixed(1), t.Rcs[j] == null ? '–' : sgn(t.Rcs[j] * 100, 1) + ' %', t.Rhs[j] == null ? '–' : sgn(t.Rhs[j], 3), t.cvg[j] ? t.cvg[j].tx.toFixed(3) + ', ' + t.cvg[j].ty.toFixed(3) : '–']; });
    tbl.appendChild(table(rows, ['Bin', 'Hue', 'CES', 'Colour', 'Rf,h', 'Rcs,h', 'Rhs,h (rad)', 'CVG x′, y′ (test, normalised)']));
    info.textContent = 'ANSI/IES TM-30-20 / CIE 224:2017: CAM02-UCS, 99 CES, c = 6.73, 16 hue-angle bins of 22.5° on the reference illuminant’s hue, reference Planckian ≤ 4500 K, CIE D ≥ 5500 K, blended in between. The CES reflectance data beyond 675 nm are held constant here (negligible effect on Rf / Rg). Outer ring of the CVG = reference; the red polygon is the test source.';
  };
  this.render = function () { this.update(); };
} };

/* ---------- tab: photometry & radiometry ---------- */
tabs.photo = { label: 'Photometry', build: function (root) {
  var kp = h('div', { class: 'kpis' }), t1 = h('div', { class: 'tblwrap' }), t2 = h('div', { class: 'tblwrap' }), t3 = h('div', { class: 'tblwrap' }), cb = h('canvas', { class: 'chart', style: { height: '240px' } }), info = h('div', { class: 'hint' });
  root.appendChild(kp); root.appendChild(h('div', { class: 'grid2' }, h('div', { class: 'card' }, h('h3', null, 'Photometry & efficacy'), t1), h('div', { class: 'card' }, h('h3', null, 'Radiant power by band'), cb, t2))); root.appendChild(h('div', { class: 'card' }, h('h3', null, 'Photon metrics (plants)'), t3)); root.appendChild(info);
  this.update = function () {
    kp.innerHTML = t1.innerHTML = t2.innerHTML = t3.innerHTML = ''; if (!R) return; var a = R.a, P = R.src.power, ph = a.photon;
    [kpi('Luminous flux', fmt(a.lumens, 1), 'lm'), kpi('Radiant flux', fmt(a.radiantW * 1000, 1), 'mW'), kpi('LER', a.LER.toFixed(1), 'lm/W₀'), kpi('Radiation per lumen', (a.WperLm * 1000).toFixed(3), 'mW/lm'), kpi('PPF', ph.ppf.toFixed(2), 'µmol/s'), kpi('PPF / lm', a.lumens > 0 ? (ph.ppf / a.lumens).toFixed(4) : '–', 'µmol/lm')].forEach(function (k) { kp.appendChild(k); });
    var Em = a.Ev, rows = [['Luminous flux Φv (V(λ), 2°)', fmt(a.lumens, 2), 'lm'], ['Luminous flux (CIE 1964 10°, y₁₀)', fmt(a.lumens10, 2), 'lm'], ['Scotopic flux Φ′v (V′(λ))', fmt(a.lumensScot, 2), 'lm′'], ['Radiant flux Φe (300–1000 nm)', fmt(a.radiantW * 1000, 2), 'mW'],
      ['Luminous efficacy of radiation (LER)', fmt(a.LER, 2), 'lm/W'], ['LER over 380–780 nm only', fmt(a.LER380_780, 2), 'lm/W'], ['Radiant power per lumen', fmt(a.WperLm * 1000, 3), 'mW/lm'], ['Scotopic LER', fmt(a.LERscot, 1), 'lm′/W'], ['S/P ratio', fmt(a.SP, 3), ''], ['Peak wavelength', a.peak.wl, 'nm'], ['Centroid wavelength', fmt(a.centroid, 1), 'nm']];
    if (P) rows.push(['Electrical power', fmt(P, 3), 'W'], ['Luminous efficacy of source', fmt(a.lumens / P, 1), 'lm/W'], ['Wall-plug efficiency (radiant / electrical)', fmt(a.radiantW / P * 100, 1), '%'], ['Heat (electrical − radiant)', fmt(P - a.radiantW, 3), 'W']);
    t1.appendChild(table(rows, ['Quantity', 'Value', 'Unit']));
    var keys = Object.keys(a.bands), vals = keys.map(function (k) { return a.bands[k] / a.radiantW * 100; }), pal = ['#7c3aed', '#2563eb', '#16a34a', '#dc2626', '#9f1239', '#6b7280'];
    A.drawBars(cb, { values: vals, labels: ['UV', 'Blue', 'Green', 'Red', 'Far-red', 'NIR'], colors: pal, min: 0, max: Math.max(10, Math.ceil(Math.max.apply(null, vals) / 10) * 10), fmt: function (v) { return v.toFixed(1) + '%'; }, ylabel: '% of radiant power', tfmt: function (v) { return v.toFixed(0); } });
    t2.appendChild(table(keys.map(function (k, i) { return [k, (a.bands[k] * 1000).toFixed(2), vals[i].toFixed(1) + ' %']; }), ['Band (nm)', 'mW', 'Share']));
    var T = ph.total; t3.appendChild(table([['Total photon flux 280–1000 nm', ph.total.toFixed(3), 'µmol/s', ''], ['PPF (PAR 400–700 nm)', ph.ppf.toFixed(3), 'µmol/s', a.radiantW > 0 ? (ph.ppf / (P || NaN)).toFixed(3) + ' µmol/J electrical' : ''], ['ePAR (400–750 nm)', ph.epar.toFixed(3), 'µmol/s', ''], ['UV 280–399', ph.uv.toFixed(3), 'µmol/s', ''], ['Blue 400–499', ph.blue.toFixed(3), 'µmol/s', (ph.ppf ? (ph.blue / ph.ppf * 100).toFixed(1) : '') + ' % of PPF'], ['Green 500–599', ph.green.toFixed(3), 'µmol/s', (ph.ppf ? (ph.green / ph.ppf * 100).toFixed(1) : '') + ' % of PPF'], ['Red 600–699', ph.red.toFixed(3), 'µmol/s', (ph.ppf ? (ph.red / ph.ppf * 100).toFixed(1) : '') + ' % of PPF'], ['Far-red 700–750', ph.farred.toFixed(3), 'µmol/s', ''], ['Red 650–680 (R:FR calc.)', ph.r660.toFixed(3), 'µmol/s', ''], ['NIR 751–1000', ph.nir.toFixed(3), 'µmol/s', '']], ['Quantity', 'Value', 'Unit', 'Note']));
    info.textContent = 'Photopic: CIE 1931 V(λ) (Km = 683 lm/W); scotopic: V′(λ) (K′m = 1700 lm/W). Photon flux = Σ P(λ) λ / (h c N_A). Values refer to the total (whole-luminaire) flux, not per square metre.';
  };
  this.render = function () { this.update(); };
} };

/* ---------- tab: circadian / sensitivities ---------- */
tabs.circ = { label: 'Melanopic & sensitivities', build: function (root) {
  var kp = h('div', { class: 'kpis' }), tbl = h('div', { class: 'tblwrap' }), cb = h('canvas', { class: 'chart', style: { height: '260px' } }), ca = h('canvas', { class: 'chart', style: { height: '260px' } }), info = h('div', { class: 'hint' });
  root.appendChild(kp); root.appendChild(h('div', { class: 'grid2' }, h('div', { class: 'card' }, h('h3', null, 'Daylight efficacy ratio (DER) per photoreceptor'), cb), h('div', { class: 'card' }, h('h3', null, 'CIE S 026 action spectra'), ca))); root.appendChild(h('div', { class: 'card' }, h('h3', null, 'Alpha-opic quantities'), tbl)); root.appendChild(info);
  var self = this;
  this.update = function () {
    kp.innerHTML = tbl.innerHTML = ''; if (!R) return; var a = R.a, al = a.alpha, keys = ['S', 'M', 'L', 'R', 'Mel'];
    [kpi('Melanopic DER', al.Mel.DER.toFixed(3), '', 'melanopic / photopic vs D65', 'big'), kpi('Melanopic EDI', al.Mel.EDI.toFixed(0), 'lx', 'at ' + a.Ev + ' lx photopic'), kpi('Mel. irradiance', (al.Mel.E * 1000).toFixed(2), 'mW/m²', 'for ' + a.Ev + ' lx'), kpi('S/P ratio', a.SP.toFixed(2), '', 'scotopic / photopic')].forEach(function (k) { kp.appendChild(k); });
    var rows = keys.map(function (k) { var x = al[k]; return [h('span', null, h('span', { class: 'dot', style: { background: x.col } }), ' ' + x.name), (x.K * 1000).toFixed(4), x.DER.toFixed(3), x.EDI.toFixed(1), (x.E * 1000).toFixed(3)]; });
    tbl.appendChild(table(rows, ['Photoreceptor', 'Kα,v (mW/lm)', 'DER', 'EDI (lx)', 'Eα (mW/m²)']));
    A.drawBars(cb, { values: keys.map(function (k) { return al[k].DER; }), labels: ['S', 'M', 'L', 'Rod', 'Mel'], colors: keys.map(function (k) { return al[k].col; }), min: 0, max: Math.max(1.2, Math.ceil(Math.max.apply(null, keys.map(function (k) { return al[k].DER; })) * 5) / 5), fmt: function (v) { return v.toFixed(2); }, refLines: [{ v: 1, c: '#888' }], ylabel: 'DER (D65 = 1)' });
    self.drawActions(ca);
    info.textContent = 'CIE S 026/E:2018 / ISO/CIE 11664-... alpha-opic action spectra (S, M, L cones, rods, ipRGC). Kα,v = Σ P(λ)sα(λ) / (683 Σ P(λ)V(λ)); DER = Kα,v / Kα,v(D65); EDI = DER × illuminance. Set the illuminance in the header. Eα = alpha-opic irradiance for that illuminance.';
  };
  this.drawActions = function (c) {
    var s = A.setupCanvas(c), g = s.g, W = s.w, H = s.h, mut = A.cv('--muted'), grid = A.cv('--grid'), fg = A.cv('--fg'), pL = 40, pB = 28, pT = 10, pR = 10, pw = W - pL - pR, ph = H - pT - pB; g.clearRect(0, 0, W, H); g.font = '11px system-ui'; g.fillStyle = mut; g.strokeStyle = grid; g.textAlign = 'center';
    for (var w = 400; w <= 700; w += 50) { var x = pL + (w - 380) / 400 * pw; g.beginPath(); g.moveTo(x, pT); g.lineTo(x, pT + ph); g.stroke(); g.fillText(String(w), x, H - 10); } g.textAlign = 'right'; for (var v = 0; v <= 1; v += 0.25) { var y = pT + ph - v * ph; g.beginPath(); g.moveTo(pL, y); g.lineTo(pL + pw, y); g.stroke(); g.fillText(v.toFixed(2), pL - 4, y + 4); }
    function curve(tab, col, wd, dash) { g.beginPath(); for (var i = 0; i < 401; i++) { var X = pL + i / 400 * pw, Y = pT + ph - tab[i] * ph; if (i) g.lineTo(X, Y); else g.moveTo(X, Y); } g.strokeStyle = col; g.lineWidth = wd; g.setLineDash(dash || []); g.stroke(); g.setLineDash([]); }
    var mx = function (t) { var m = 0; for (var i = 0; i < 401; i++) m = Math.max(m, t[i]); return t.map ? Array.prototype.map.call(t, function (x) { return x / m; }) : t; };
    L.ALPHA.forEach(function (al) { curve(mx(al.tab), al.col, 1.8); }); curve(mx(L.T.y31), fg, 1.4, [5, 3]);
    var R_ = R.a; var sp = R.src.spd, m = 0; for (var q = 380; q <= 780; q++) m = Math.max(m, sp[q - L.WL0]); g.beginPath(); for (var j = 0; j <= 400; j++) { var X2 = pL + j / 400 * pw, Y2 = pT + ph - sp[j + 380 - L.WL0] / m * ph; if (j) g.lineTo(X2, Y2); else g.moveTo(X2, Y2); } g.lineTo(pL + pw, pT + ph); g.lineTo(pL, pT + ph); g.fillStyle = 'rgba(128,128,128,0.18)'; g.fill();
    g.textAlign = 'left'; var lx = pL + 8; L.ALPHA.concat([{ id: 'V', col: fg }]).forEach(function (al) { var nm = al.id === 'V' ? 'V(λ)' : al.id === 'R' ? 'Rod' : al.id; g.fillStyle = al.col; g.fillRect(lx, pT + 6, 10, 3); g.fillStyle = fg; g.fillText(nm, lx + 14, pT + 12); lx += 28 + g.measureText(nm).width; }); g.fillStyle = mut; g.fillText('grey = source (peak = 1)', lx + 6, pT + 12);
  };
  this.render = function () { this.update(); };
} };


/* ---------- tab: spectral quality (SSI, band coverage, smoothness) ---------- */
var sqCustom = { w0: 600, w1: 640 };
function fmtRatio(v) { return isFinite(v) ? (v * 100).toFixed(0) + ' %' : '-'; }
tabs.sq = { label: 'Spectral quality', build: function (root) {
  var kp = h('div', { class: 'kpis' }), c1 = h('canvas', { class: 'chart', style: { height: '300px' } }), c2 = h('canvas', { class: 'chart', style: { height: '260px' } }), tb = h('div', { class: 'tblwrap' }), tp = h('div', { class: 'tblwrap' }), info = h('div', { class: 'hint' });
  var cw0 = h('input', { type: 'number', class: 'inp sm', value: sqCustom.w0, min: 380, max: 779, step: 5, style: { width: '64px' }, onchange: function () { sqCustom.w0 = +this.value; self.update(); } }), cw1 = h('input', { type: 'number', class: 'inp sm', value: sqCustom.w1, min: 381, max: 780, step: 5, style: { width: '64px' }, onchange: function () { sqCustom.w1 = +this.value; self.update(); } });
  var self = this;
  root.appendChild(kp);
  root.appendChild(h('div', { class: 'grid2' }, h('div', { class: 'card' }, h('h3', null, 'Spectrum vs. reference (equal power 380–780 nm)'), c1), h('div', { class: 'card' }, h('h3', null, 'Coverage per 20 nm band: test / reference'), c2)));
  root.appendChild(h('div', { class: 'card' }, h('div', { class: 'card-h' }, h('h3', null, 'Band coverage'), h('div', { class: 'grow' }), h('span', { class: 'hint' }, 'Custom band (nm): '), cw0, h('span', { text: '–' }), cw1), tb));
  root.appendChild(h('div', { class: 'card' }, h('h3', null, 'Peaks and widths'), tp)); root.appendChild(info);
  this.update = function () {
    kp.innerHTML = tb.innerHTML = tp.innerHTML = ''; if (!R) return; var a = R.a, q = a.sq, ref = a.tm30.ref, spd = R.src.spd, cy = q.bands.cyan, dr = q.bands.deepred;
    [kpi('SSI', q.ssi.toFixed(1), '', 'overlap with reference, 100 = identical', 'big'), kpi('Cyan dip', fmtRatio(cy.trough), '', 'deepest 10 nm in 470–510 nm vs reference; band average ' + fmtRatio(cy.ratio)), kpi('Deep-red coverage', fmtRatio(dr.ratio), '', '630–760 nm vs reference'), kpi('Smoothness', q.smooth.toFixed(1), '%', 'reference ' + q.smoothRef.toFixed(1) + ' %  (100 = no spikes)'), kpi('Effective bandwidth', q.effBW.toFixed(0), 'nm', 'reference ' + q.effBWref.toFixed(0) + ' nm'), kpi('Narrowest peak', q.narrowest ? q.narrowest.fwhm.toFixed(0) : '-', 'nm FWHM', q.narrowest ? 'at ' + q.narrowest.wl + ' nm, ' + q.peaks.length + ' peak(s)' : 'no distinct peaks')].forEach(function (k) { kp.appendChild(k); });
    if (!a.cctValid) kp.appendChild(h('div', { class: 'warn', text: '⚠ |Duv| > 0.05: the reference illuminant is only defined for near-white light, so SSI and the coverage values are not meaningful for this source.' }));
    drawSQ(c1, spd, ref, q);
    var bins = q.bins, cap = 3; A.drawBars(c2, { values: bins.map(function (b) { return Math.min(b.ratio, cap); }), labels: bins.map(function (b, i) { return i % 2 ? '' : String(b.w0); }), colors: bins.map(function (b) { return A.rgb(A.specRGB(b.w0 + 10)); }), min: 0, max: cap, fmt: function (v) { return v >= cap ? '>' + cap : v.toFixed(2); }, refLines: [{ v: 1, c: '#888' }], ylabel: 'test / reference (capped at ' + cap + ')', tfmt: function (v) { return v.toFixed(1); }, small: false });
    var rows = L.SQ_BANDS.map(function (b) { return q.bands[b.id]; }).concat([L.bandStats(spd, ref, Math.min(sqCustom.w0, sqCustom.w1 - 1), Math.max(sqCustom.w1, sqCustom.w0 + 1))]);
    var names = L.SQ_BANDS.map(function (b) { return b.name; }).concat(['Custom ' + sqCustom.w0 + '-' + sqCustom.w1]);
    tb.appendChild(table(rows.map(function (b, i) { return [names[i], (b.test * 100).toFixed(1) + ' %', (b.ref * 100).toFixed(1) + ' %', fmtRatio(b.ratio), fmtRatio(b.trough)]; }), ['Band (nm)', 'Share of 380–780 power, test', 'Share, reference', 'Coverage (test / ref.)', 'Deepest 10 nm dip']));
    tp.appendChild(q.peaks.length ? table(q.peaks.map(function (p) { return [p.wl + ' nm', (p.rel * 100).toFixed(0) + ' %', (p.prom * 100).toFixed(0) + ' %', p.fwhm.toFixed(1) + ' nm']; }), ['Peak', 'Relative height', 'Prominence', 'Width at half prominence']) : h('div', { class: 'hint', text: 'No distinct peaks (smooth, broad spectrum).' }));
    info.textContent = 'Definitions (this tool’s own, stated so numbers can be reproduced): the reference is the TM-30 reference illuminant at the source’s CCT. SSI = 100 × Σ min(test, reference) over 5 nm bins, both spectra normalised to equal power over 380–780 nm (a spectral overlap; other “SSI” definitions exist, so values are not comparable with other vendors’). Coverage = (share of the visible power inside the band) / (the reference’s share); 100 % = same as the reference, <100 % = deficit. Smoothness = 100 − spikiness, where spikiness is the share of power above a broad (σ = 25 nm) running envelope of the spectrum; effective bandwidth = (ΣS)² / ΣS². Noisy measured spectra look spikier than they are; smooth them first.';
  };
  this.render = function () { this.update(); };
} };
function drawSQ(c, spd, ref, q) {
  var s = A.setupCanvas(c), g = s.g, W = s.w, H = s.h, mut = A.cv('--muted'), grid = A.cv('--grid'), fg = A.cv('--fg'), acc = A.cv('--accent'), pL = 40, pB = 38, pT = 10, pR = 10, pw = W - pL - pR, ph = H - pT - pB, i;
  g.clearRect(0, 0, W, H); var ts = 0, rs = 0; for (i = 380; i <= 780; i++) { ts += spd[i - L.WL0]; rs += ref[i - L.WL0]; } var tn = [], rn = [], mx = 0; for (i = 380; i <= 780; i++) { tn.push(spd[i - L.WL0] / ts); rn.push(ref[i - L.WL0] / rs); mx = Math.max(mx, tn[tn.length - 1], rn[rn.length - 1]); }
  function X(w) { return pL + (w - 380) / 400 * pw; } function Y(v) { return pT + ph - v / (mx * 1.05) * ph; }
  var bandsShade = [[470, 510, 'rgba(8,145,178,0.16)', 'cyan'], [630, 760, 'rgba(220,38,38,0.14)', 'deep red']];
  bandsShade.forEach(function (b) { g.fillStyle = b[2]; g.fillRect(X(b[0]), pT, X(b[1]) - X(b[0]), ph); g.fillStyle = mut; g.font = '11px system-ui'; g.textAlign = 'center'; g.fillText(b[3], (X(b[0]) + X(b[1])) / 2, pT + ph - 6); });
  g.strokeStyle = grid; g.fillStyle = mut; g.font = '11px system-ui'; g.textAlign = 'center'; for (var w = 400; w <= 780; w += 50) { g.beginPath(); g.moveTo(X(w), pT); g.lineTo(X(w), pT + ph); g.stroke(); g.fillText(String(w), X(w), H - 22); } g.fillText('Wavelength (nm)', pL + pw / 2, H - 6);
  function line(arr, col, wd, dash, fill) { g.beginPath(); arr.forEach(function (v, k) { var x = X(380 + k), y = Y(v); if (k) g.lineTo(x, y); else g.moveTo(x, y); }); if (fill) { g.lineTo(X(780), Y(0)); g.lineTo(X(380), Y(0)); g.closePath(); g.fillStyle = fill; g.fill(); g.beginPath(); arr.forEach(function (v, k) { var x = X(380 + k), y = Y(v); if (k) g.lineTo(x, y); else g.moveTo(x, y); }); } g.strokeStyle = col; g.lineWidth = wd; g.setLineDash(dash || []); g.stroke(); g.setLineDash([]); }
  line(tn, acc, 2, null, A.alpha ? A.alpha(acc[0] === '#' ? acc : '#2563eb', 0.18) : null); line(rn, fg, 1.6, [6, 3]);
  var lx = pL + pw - 215; g.textAlign = 'left'; g.fillStyle = acc; g.fillRect(lx, pT + 8, 14, 3); g.fillStyle = fg; g.fillText('source  (SSI ' + q.ssi.toFixed(1) + ')', lx + 20, pT + 14); g.strokeStyle = fg; g.setLineDash([6, 3]); g.beginPath(); g.moveTo(lx, pT + 26); g.lineTo(lx + 14, pT + 26); g.stroke(); g.setLineDash([]); g.fillText('reference (' + R.a.tm30.refType + ' ' + Math.round(R.a.tm30.refCCT) + ' K)', lx + 20, pT + 30);
}

/* ---------- tab: about ---------- */
tabs.about = { label: 'Help & data', build: function (root) {
  var P = function (t) { return h('p', null, t); };
  root.appendChild(h('div', { class: 'card doc' },
    h('h3', null, 'How to use'),
    h('ul', null, h('li', null, 'The ', h('b', null, 'library'), ' (left) stores LEDs. Create one with ', h('b', null, '+ New LED'), ': for a monochromatic LED just enter peak wavelength and width (a typical width is suggested), for a white pc-LED enter a CCT, or import a measured spectrum (CSV with wavelength, intensity).'),
      h('li', null, 'Add LEDs to the ', h('b', null, 'mix'), ' with ＋. Each channel has a quantity, a drive current (flux scales linearly with current) and an extra scale factor. Without electrical data only relative results are possible.'),
      h('li', null, 'Pick the analysed ', h('b', null, 'source'), ' (the mix or a single LED) in the header and optionally a ', h('b', null, 'compare'), ' spectrum (D65, A, the TM-30 reference illuminant, another LED).'),
      h('li', null, h('b', null, 'Export'), ' stores the library, a mix or a single LED as a .json file in the open “led-spectrum-lab” format; files can be re-imported, dropped onto the library, or shared as a link (small payloads only). CSV spectra and 2-column text are accepted too.')),
    h('h3', null, 'Methods'),
    h('ul', null, h('li', null, 'Colorimetry: CIE 1931 2° and 1964 10° observers, 1 nm grid, 300–1000 nm. CCT/Duv from the nearest point on the Planckian locus in CIE 1960 uv (McCamy value shown for reference).'),
      h('li', null, 'CRI: CIE 13.3-1995 (R1–R14). TM-30: ANSI/IES TM-30-20 (CIE 224:2017) with CIECAM02-based CAM02-UCS and the 99 CES.'),
      h('li', null, 'Melanopic and other alpha-opic quantities: CIE S 026 action spectra; DER relative to D65.'),
      h('li', null, 'Photon flux: PPF = 400–700 nm, ePAR = 400–750 nm.')),
    h('h3', null, 'Limits you should know about'),
    h('ul', null, h('li', null, 'The built-in library consists of ', h('b', null, 'synthetic'), ' Gaussian / phosphor shapes, not measurements of real parts. Replace them with measured spectra for real work.'),
      h('li', null, 'LED flux is assumed linear in drive current and independent of temperature (no droop, no thermal shift of peak wavelength).'),
      h('li', null, 'The TM-30 CES reflectances are held constant beyond 675 nm (data not available to the author); the effect on Rf and Rg is estimated to be far below 0.1.'),
      h('li', null, 'Results should be treated as engineering estimates; verify against a calibrated instrument or certified software before publishing or certifying.')),
    h('h3', null, 'License and source'), h('p', null, 'LED Spectrum Lab is free software under the GNU Affero General Public License v3 or later. If you run a modified version as a network service you must offer its users the source code. Source: ', h('a', { href: (window.LSL_META || {}).repo || '#', target: '_blank', rel: 'noopener', text: (window.LSL_META || {}).repo || 'see repository' }), ' (version ' + ((window.LSL_META || {}).version || 'dev') + ').'), h('p', { class: 'hint', text: 'Works offline: this is a single HTML file without external dependencies. Data are stored in this browser (localStorage) only.' })));
  this.update = function () { }; this.render = function () { };
} };
order = ['overview', 'spectrum', 'cie', 'cri', 'tm30', 'sq', 'photo', 'circ', 'about'];

/* ---------- exports ---------- */
function pngOf(canvas, name) { canvas.toBlob(function (b) { var a = h('a', { href: URL.createObjectURL(b), download: name }); document.body.appendChild(a); a.click(); a.remove(); }); }
function srcName() { return (R.src.name || 'spectrum').replace(/[^\w\-]+/g, '_'); }
function exportSpectrumCSV() { if (!R) return A.toast('Nothing to export', 'err'); A.download(srcName() + '_spectrum.csv', A.spectrumToCSV(L.scale(R.src.spd, 1000), 380, 780, 'spectral_radiant_flux_mW_per_nm'), 'text/csv'); }
function exportSpectrumSP(rel) { if (!R) return A.toast('Nothing to export', 'err'); A.download(srcName() + '.sp', A.spectrumToSP(L.scale(R.src.spd, 1000), 380, 780, rel), 'text/plain'); }
function exportReportCSV() {
  if (!R) return A.toast('Nothing to export', 'err'); var a = R.a, t = a.tm30, q = function (s) { return '"' + String(s).replace(/"/g, '""') + '"'; }, rows = [['Quantity', 'Value', 'Unit']];
  function add(n, v, u) { rows.push([q(n), typeof v === 'number' ? (isFinite(v) ? +v.toPrecision(8) : '') : q(v), u || '']); }
  add('Source', R.src.name); add('x (2 deg)', a.xy.x); add('y (2 deg)', a.xy.y); add("u'", a.upvp.u); add("v'", a.upvp.v); add('x (10 deg)', a.xy10.x); add('y (10 deg)', a.xy10.y); add('CCT', a.cct, 'K'); add('CCT McCamy', a.cctMcCamy, 'K'); add('Duv', a.duv);
  if (a.dominant) add('Dominant wavelength' + (a.dominant.complementary ? ' (complementary)' : ''), a.dominant.wl, 'nm'), add('Excitation purity', a.dominant.purity);
  add('Luminous flux', a.lumens, 'lm'); add('Radiant flux', a.radiantW, 'W'); add('LER', a.LER, 'lm/W'); add('Radiant power per lumen', a.WperLm * 1000, 'mW/lm'); add('S/P', a.SP); add('Peak', a.peak.wl, 'nm'); add('Centroid', a.centroid, 'nm'); if (R.src.power) { add('Electrical power', R.src.power, 'W'); add('Efficacy', a.lumens / R.src.power, 'lm/W'); add('WPE', a.radiantW / R.src.power * 100, '%'); }
  add('CRI Ra', a.cri.Ra); a.cri.R.forEach(function (v, i) { add('CRI R' + (i + 1), v); });
  add('TM-30 Rf', t.Rf); add('TM-30 Rg', t.Rg); add('TM-30 Rf,skin', t.Rfskin); for (var j = 0; j < 16; j++) { add('Rf,h' + (j + 1), t.Rfh[j] == null ? NaN : t.Rfh[j]); add('Rcs,h' + (j + 1), t.Rcs[j] == null ? NaN : t.Rcs[j]); add('Rhs,h' + (j + 1), t.Rhs[j] == null ? NaN : t.Rhs[j]); } t.RfI.forEach(function (v, i) { add('Rf,CES' + (i + 1), v); });
  var sqv = a.sq; add('SSI', sqv.ssi); L.SQ_BANDS.forEach(function (b) { add('Coverage ' + b.name, sqv.bands[b.id].ratio); add('Deepest 10 nm dip ' + b.name, sqv.bands[b.id].trough); }); add('Smoothness', sqv.smooth, '%'); add('Smoothness of reference', sqv.smoothRef, '%'); add('Effective bandwidth', sqv.effBW, 'nm'); sqv.peaks.forEach(function (p, i) { add('Peak ' + (i + 1) + ' wavelength', p.wl, 'nm'); add('Peak ' + (i + 1) + ' FWHM', p.fwhm, 'nm'); });
  add('PPF', a.photon.ppf, 'umol/s'); add('ePAR', a.photon.epar, 'umol/s'); add('Illuminance for EDI', a.Ev, 'lx'); L.ALPHA.forEach(function (al) { var x = a.alpha[al.id]; add(al.name + ' K', x.K * 1000, 'mW/lm'); add(al.name + ' DER', x.DER); add(al.name + ' EDI', x.EDI, 'lx'); });
  A.download((R.src.name || 'report').replace(/[^\w\-]+/g, '_') + '_report.csv', rows.map(function (r) { return r.join(','); }).join('\n'), 'text/csv');
}

/* ---------- PDF report (self-written minimal PDF writer: text + JPEG images) ---------- */
function pdfLatin(str) { var map = { '′': "'", '″': '"', '–': '-', '—': '-', '−': '-', '≈': '~', '≥': '>=', '≤': '<=', '∝': '~', 'λ': 'lambda', 'α': 'alpha', 'Δ': 'd', 'Σ': 'sum', '→': '->', '•': '*', '…': '...', 'µ': 'µ', '₀': '0', '₂': '2', '⁻': '-', '¹': '1', '²': '2', '’': "'", '‘': "'", '“': '"', '”': '"', '×': '×', '–': '-', '±': '±', '°': '°', 'Φ': 'Phi', ' ': ' ', ' ': ' ' }; var o = ''; for (var i = 0; i < str.length; i++) { var c = str[i], k = str.charCodeAt(i); if (map[c] != null) o += map[c]; else if (k < 128 || (k >= 160 && k < 256)) o += c; else o += '?'; } return o; }
function PDFDoc() {
  var W = 595.28, H = 841.89, pages = [], cur = null, imgs = [], y = 0, M = 40;
  var d = this;
  d.W = W; d.H = H; d.M = M;
  d.newPage = function () { cur = { ops: [], imgs: [] }; pages.push(cur); y = H - M; return cur; };
  d.y = function () { return y; }; d.room = function (hh) { return y - hh >= M; };
  d.skip = function (hh) { y -= hh; };
  function esc(t) { return pdfLatin(String(t)).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)'); }
  d.text = function (x, t, size, bold, gray) { cur.ops.push('BT /F' + (bold ? 2 : 1) + ' ' + size + ' Tf ' + (gray != null ? gray + ' g ' : '0 g ') + x.toFixed(2) + ' ' + y.toFixed(2) + ' Td (' + esc(t) + ') Tj ET'); };
  d.line = function (x0, x1, gray) { cur.ops.push((gray == null ? 0.8 : gray) + ' G 0.5 w ' + x0 + ' ' + (y).toFixed(2) + ' m ' + x1 + ' ' + (y).toFixed(2) + ' l S'); };
  d.heading = function (t, size) { size = size || 13; if (!d.room(size * 2.6)) d.newPage(); y -= size; d.text(M, t, size, true); y -= size * 0.6; };
  d.para = function (t, size, gray) { size = size || 8.5; var maxc = Math.floor((W - 2 * M) / (size * 0.5)), words = String(t).split(' '), ln = ''; function flush() { if (!d.room(size * 1.4)) d.newPage(); y -= size * 1.25; d.text(M, ln, size, false, gray); ln = ''; } words.forEach(function (w) { if ((ln + ' ' + w).length > maxc && ln) flush(); ln = ln ? ln + ' ' + w : w; }); if (ln) flush(); };
  d.kv = function (rows, cols) { cols = cols || 2; var colW = (W - 2 * M) / cols, per = Math.ceil(rows.length / cols), rh = 12.5; if (!d.room(per * rh + 6)) d.newPage(); var y0 = y; for (var c = 0; c < cols; c++) { y = y0; rows.slice(c * per, (c + 1) * per).forEach(function (r) { y -= rh; d.text(M + c * colW, r[0], 8.5, false, 0.35); var vs = String(r[1]); cur.ops.push('BT /F2 8.5 Tf 0 g ' + (M + c * colW + colW - 14 - vs.length * 4.4).toFixed(2) + ' ' + y.toFixed(2) + ' Td (' + esc(vs) + ') Tj ET'); }); } y = y0 - per * rh - 6; };
  d.image = function (img, maxW, maxH) { var w = maxW || (W - 2 * M), hh = w * img.h / img.w; if (maxH && hh > maxH) { hh = maxH; w = hh * img.w / img.h; } if (!d.room(hh + 4)) d.newPage(); var id = imgs.length; imgs.push(img); cur.imgs.push(id); y -= hh; cur.ops.push('q ' + w.toFixed(2) + ' 0 0 ' + hh.toFixed(2) + ' ' + (M + ((W - 2 * M) - w) / 2).toFixed(2) + ' ' + y.toFixed(2) + ' cm /Im' + id + ' Do Q'); y -= 6; };
  d.build = function () {
    var chunks = [], len = 0, offs = [];
    function put(x) { var u = typeof x === 'string' ? (function () { var a = new Uint8Array(x.length); for (var i = 0; i < x.length; i++) a[i] = x.charCodeAt(i) & 255; return a; })() : x; chunks.push(u); len += u.length; }
    function obj(n, body) { offs[n] = len; put(n + ' 0 obj\n'); body.forEach(put); put('\nendobj\n'); }
    put('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n');
    var nImg = imgs.length, firstImg = 5, firstPage = firstImg + nImg, kids = [], i;
    obj(1, ['<< /Type /Catalog /Pages 2 0 R >>']);
    for (i = 0; i < pages.length; i++) kids.push((firstPage + i * 2 + 1) + ' 0 R');
    obj(2, ['<< /Type /Pages /Kids [' + kids.join(' ') + '] /Count ' + pages.length + ' >>']);
    obj(3, ['<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>']);
    obj(4, ['<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>']);
    imgs.forEach(function (im, k) { obj(firstImg + k, ['<< /Type /XObject /Subtype /Image /Width ' + im.w + ' /Height ' + im.h + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + im.data.length + ' >>\nstream\n', im.data, '\nendstream']); });
    pages.forEach(function (pg, k) {
      var cs = pg.ops.join('\n'), cn = firstPage + k * 2, pn = cn + 1, xo = pg.imgs.map(function (id) { return '/Im' + id + ' ' + (firstImg + id) + ' 0 R'; }).join(' ');
      // footer
      cs += '\nBT /F1 7.5 Tf 0.5 g ' + M + ' 22 Td (' + esc('LED Spectrum Lab  -  page ' + (k + 1) + ' of ' + pages.length) + ') Tj ET';
      obj(cn, ['<< /Length ' + cs.length + ' >>\nstream\n', cs, '\nendstream']);
      obj(pn, ['<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + W + ' ' + H + '] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> /XObject << ' + xo + ' >> >> /Contents ' + cn + ' 0 R >>']);
    });
    var n = firstPage + pages.length * 2, xref = len; put('xref\n0 ' + n + '\n0000000000 65535 f \n'); for (i = 1; i < n; i++) put(('0000000000' + offs[i]).slice(-10) + ' 00000 n \n'); put('trailer\n<< /Size ' + n + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n');
    var out = new Uint8Array(len), p = 0; chunks.forEach(function (c) { out.set(c, p); p += c.length; }); return out;
  };
  d.newPage();
}
function canvasJPEG(c) { var o = document.createElement('canvas'); o.width = c.width; o.height = c.height; var g = o.getContext('2d'); g.fillStyle = '#ffffff'; g.fillRect(0, 0, o.width, o.height); g.drawImage(c, 0, 0); var u = o.toDataURL('image/jpeg', 0.93), b = atob(u.split(',')[1]), a = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return { w: o.width, h: o.height, data: a }; }
function exportPDF() {
  if (!R) return A.toast('Nothing to analyse yet', 'err');
  var prevTab = A.tab, prevTheme = A.theme, a, t, d, P, hasCh = false;
  document.documentElement.setAttribute('data-theme', 'light'); A.theme = 'light';
  try {
    compute(); a = R.a; t = a.tm30; P = R.src.power; d = new PDFDoc();
    d.skip(0); d.y(); var y0 = d.y();
    d.text(d.M, 'LED Spectrum Lab - analysis report', 17, true); d.skip(18);
    d.text(d.M, R.src.name, 11, true); d.skip(13);
    d.text(d.M, new Date().toLocaleString() + '   |   illuminance for alpha-opic EDI: ' + a.Ev + ' lx   |   CIE 1931 2 deg observer unless stated', 8, false, 0.4); d.skip(8); d.line(d.M, d.W - d.M, 0.75); d.skip(4);
    var col = function (v, dd) { return fmt(v, dd); };
    d.heading('Colour', 11); d.kv([['CCT (nearest locus point)', Math.round(a.cct) + ' K'], ['CCT (McCamy)', Math.round(a.cctMcCamy) + ' K'], ['Duv', sgn(a.duv, 4)], ['x, y (2 deg)', a.xy.x.toFixed(4) + ', ' + a.xy.y.toFixed(4)], ["u', v'", a.upvp.u.toFixed(4) + ', ' + a.upvp.v.toFixed(4)], ['x, y (10 deg)', a.xy10.x.toFixed(4) + ', ' + a.xy10.y.toFixed(4)], ['Dominant wavelength', a.dominant ? (a.dominant.complementary ? 'compl. ' : '') + a.dominant.wl.toFixed(1) + ' nm' : '-'], ['Excitation purity', a.dominant ? (a.dominant.purity * 100).toFixed(1) + ' %' : '-']]);
    d.heading('Colour rendering', 11); d.kv([['CRI Ra', a.cri.Ra.toFixed(1)], ['R9 / R12', a.cri.R[8].toFixed(1) + ' / ' + a.cri.R[11].toFixed(1)], ['TM-30 Rf', t.Rf.toFixed(1)], ['TM-30 Rg', t.Rg.toFixed(1)], ['Rf,skin', t.Rfskin.toFixed(1)], ['Rcs,h1', sgn(t.Rcsh1 * 100, 1) + ' %'], ['Reference illuminant', t.refType + ' ' + Math.round(t.refCCT) + ' K'], ['CRI R1-R14', a.cri.R.map(function (v) { return v.toFixed(0); }).join(' ')]]);
    d.heading('Spectral quality', 11); d.kv([['SSI (overlap with reference)', a.sq.ssi.toFixed(1)], ['Cyan 470-510 band average', fmtRatio(a.sq.bands.cyan.ratio)], ['Cyan dip (deepest 10 nm)', fmtRatio(a.sq.bands.cyan.trough)], ['Deep-red coverage 630-760', fmtRatio(a.sq.bands.deepred.ratio)], ['Smoothness (ref. ' + a.sq.smoothRef.toFixed(1) + ')', a.sq.smooth.toFixed(1) + ' %'], ['Effective bandwidth', a.sq.effBW.toFixed(0) + ' nm'], ['Narrowest peak', a.sq.narrowest ? a.sq.narrowest.fwhm.toFixed(0) + ' nm at ' + a.sq.narrowest.wl : '-'], ['Number of peaks', String(a.sq.peaks.length)]]);
    d.heading('Photometry and radiometry', 11); d.kv([['Luminous flux', col(a.lumens, 1) + ' lm'], ['Radiant flux', col(a.radiantW * 1000, 1) + ' mW'], ['LER', col(a.LER, 1) + ' lm/W (rad.)'], ['Radiant power per lumen', col(a.WperLm * 1000, 3) + ' mW/lm'], ['S/P ratio', col(a.SP, 3)], ['Peak / centroid', a.peak.wl + ' / ' + col(a.centroid, 1) + ' nm'], ['Electrical power', P ? col(P, 3) + ' W' : '-'], ['Luminous efficacy', P ? col(a.lumens / P, 1) + ' lm/W' : '-'], ['Wall-plug efficiency', P ? col(a.radiantW / P * 100, 1) + ' %' : '-'], ['PPF (400-700)', col(a.photon.ppf, 2) + ' umol/s'], ['ePAR (400-750)', col(a.photon.epar, 2) + ' umol/s'], ['PPF per lumen', a.lumens > 0 ? col(a.photon.ppf / a.lumens, 4) + ' umol/lm' : '-']]);
    d.heading('Alpha-opic (CIE S 026), at ' + a.Ev + ' lx', 11); d.kv(L.ALPHA.map(function (al) { var x = a.alpha[al.id]; return [al.name.replace(/ \(.*\)/, ''), 'DER ' + x.DER.toFixed(3) + '  EDI ' + x.EDI.toFixed(0) + ' lx']; }));
    if (A.source === 'mix' && R.src.info.length) { d.heading('Mix channels', 11); d.kv(R.src.info.filter(function (i) { return i.led; }).map(function (i) { return [i.led.name + ' x' + (i.ch.qty || 0), col(i.lm, 1) + ' lm, ' + col(i.rad * 1000, 0) + ' mW']; }), 1); }
    var plan = [['spectrum', 'Spectrum', 0], ['cie', 'Chromaticity (CIE)', 0], ['cri', 'CRI', 0], ['tm30', 'TM-30', 0], ['sq', 'Spectral quality', 0], ['photo', 'Photometry', 0], ['circ', 'Melanopic and sensitivities', 0]];
    plan.forEach(function (pl) {
      setTab(pl[0]); var cs = Array.prototype.slice.call(panels[pl[0]].querySelectorAll('canvas')).filter(function (c) { return c.width > 50 && c.getBoundingClientRect().width > 20; });
      if (!cs.length) return; if (!d.room(300)) d.newPage(); d.skip(6); d.heading(pl[1], 12);
      cs.forEach(function (c) { var im = canvasJPEG(c); var sq = im.w / im.h < 1.5; d.image(im, sq ? 300 : null, sq ? 300 : 210); });
    });
    d.newPage(); d.heading('Notes', 12);
    ['CRI per CIE 13.3-1995 (R1-R14). TM-30 per ANSI/IES TM-30-20 / CIE 224:2017 (CAM02-UCS, 99 CES, 16 hue bins). The CES reflectance data above 675 nm are held constant.', 'Alpha-opic quantities use the CIE S 026 action spectra; DER is relative to CIE D65. CCT is the nearest point on the Planckian locus in CIE 1960 uv; Duv is positive above the locus.', 'Photon flux: PPF 400-700 nm, ePAR 400-750 nm. LED flux is assumed linear in drive current; no thermal or droop effects are modelled.', 'Treat results as engineering estimates and verify with calibrated instruments before certification.'].forEach(function (x) { d.para(x, 9); d.skip(3); });
    var bytes = d.build(); A.download(srcName() + '_report.pdf', bytes, 'application/pdf'); A.toast('PDF report created');
  } catch (e) { console.error(e); A.toast('PDF export failed: ' + e.message, 'err'); }
  finally { document.documentElement.setAttribute('data-theme', prevTheme); A.theme = prevTheme; refreshAll(); setTab(prevTab); }
}

function printReport() { document.body.classList.add('printing'); order.forEach(function (k) { try { if (tabs[k].render) tabs[k].render(); } catch (e) { } }); setTimeout(function () { window.print(); }, 150); }
window.addEventListener('afterprint', function () { document.body.classList.remove('printing'); refreshAll(); });

/* ---------- shell ---------- */
var panels = {}, tabBtns = {}, pending = false;
function setTab(id) { A.tab = id; A.save(); order.forEach(function (k) { panels[k].classList.toggle('on', k === id); tabBtns[k].classList.toggle('on', k === id); }); refreshActive(); }
function refreshActive() { if (!R && false) return; var t = tabs[A.tab]; if (t && t.update) { try { t.update(); } catch (e) { console.error(e); } } }
function refreshAll() { compute(); updateHeader(); refreshActive(); }
function schedule() { if (pending) return; pending = true; requestAnimationFrame(function () { pending = false; refreshAll(); }); }
var srcSel, cmpSel, evInp, head;
function fillSelectors() {
  var keep1 = A.source, keep2 = A.compare; srcSel.innerHTML = ''; srcSel.appendChild(h('option', { value: 'mix' }, 'Mix: ' + (A.mix.name || 'mix'))); var g = h('optgroup', { label: 'Single LED' }); A.library.forEach(function (l) { g.appendChild(h('option', { value: l.id }, l.name)); }); srcSel.appendChild(g); srcSel.value = A.findLed(keep1) || keep1 === 'mix' ? keep1 : 'mix';
  cmpSel.innerHTML = ''; [['none', 'none'], ['ref', 'TM-30 reference illuminant'], ['D65', 'D65 daylight'], ['A', 'Illuminant A'], ['mix', 'The mix']].forEach(function (o) { cmpSel.appendChild(h('option', { value: o[0] }, o[1])); }); var g2 = h('optgroup', { label: 'LED' }); A.library.forEach(function (l) { g2.appendChild(h('option', { value: l.id }, l.name)); }); cmpSel.appendChild(g2); cmpSel.value = keep2; if (cmpSel.value !== keep2) cmpSel.value = 'none';
}
function updateHeader() { if (document.activeElement !== srcSel && document.activeElement !== cmpSel) fillSelectors(); }
function setTheme(t) { A.theme = t; document.documentElement.setAttribute('data-theme', t); try { localStorage.setItem('lsl.theme', t); } catch (e) { } refreshAll(); }
function init() {
  A.load();
  var th = null; try { th = localStorage.getItem('lsl.theme'); } catch (e) { } A.theme = th || (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); document.documentElement.setAttribute('data-theme', A.theme);
  // share link
  var m = /[#&]share=([^&]+)/.exec(location.hash); if (m) { try { var doc = A.unshare(m[1]); var res = A.importText(JSON.stringify(doc), 'shared', 'merge'); A.toast('Loaded shared data (' + res.added + ' LED(s))'); history.replaceState(null, '', location.pathname + location.search); } catch (e) { A.toast('Could not read the share link: ' + e.message, 'err'); } }
  var app = $('#app'); app.innerHTML = '';
  srcSel = h('select', { class: 'inp', onchange: function () { A.source = this.value; A.save(); A.emit(); } }); cmpSel = h('select', { class: 'inp', onchange: function () { A.compare = this.value; A.save(); A.emit(); } });
  evInp = h('input', { class: 'inp', type: 'number', min: 1, step: 10, value: A.mix.Ev || 500, style: { width: '70px' }, oninput: function () { A.mix.Ev = parseFloat(this.value) || 500; A.save(); A.emit(true); } });
  function menu(items, anchor) { var mn = h('div', { class: 'menu' }); items.forEach(function (it) { mn.appendChild(h('button', { class: 'menu-i', onclick: function () { mn.remove(); it[1](); } }, it[0])); }); document.body.appendChild(mn); var r = anchor.getBoundingClientRect(); mn.style.left = Math.max(8, Math.min(r.left, innerWidth - 240)) + 'px'; mn.style.top = (r.bottom + 4) + 'px'; setTimeout(function () { var off = function (e) { if (!mn.contains(e.target)) { mn.remove(); document.removeEventListener('pointerdown', off); } }; document.addEventListener('pointerdown', off); }, 0); }
  head = h('header', { class: 'top' }, h('div', { class: 'brand' }, h('span', { class: 'logo' }), h('div', null, h('b', null, 'LED Spectrum Lab'), h('small', null, 'add · mix · analyse'))), h('div', { class: 'grow' }),
    h('label', { class: 'fld inl' }, h('span', { text: 'Source' }), srcSel), h('label', { class: 'fld inl' }, h('span', { text: 'Compare' }), cmpSel), h('label', { class: 'fld inl' }, h('span', { text: 'Illuminance (lx)' }), evInp),
    h('button', { class: 'btn', onclick: function (e) { menu([['Spectrum CSV, mW/nm (hcri.io style)', exportSpectrumCSV], ['Spectrum Argyll .sp (mW/nm)', function () { exportSpectrumSP(false); }], ['Spectrum Argyll .sp (relative, peak = 1)', function () { exportSpectrumSP(true); }], ['Full report CSV', exportReportCSV], ['PDF report', exportPDF], ['Print…', printReport]], e.currentTarget); } }, 'Report ▾'),
    h('button', { class: 'btn', title: 'Light / dark', onclick: function () { setTheme(A.theme === 'dark' ? 'light' : 'dark'); } }, 'Theme'));
  var side = h('aside', { class: 'side' }), libCard = h('section', { class: 'card lib' }), mixCard = h('section', { class: 'card mix' }); side.appendChild(libCard); side.appendChild(mixCard);
  var tabbar = h('nav', { class: 'tabs' }), main = h('main', { class: 'main' }); order.forEach(function (k) { tabBtns[k] = h('button', { class: 'tab', onclick: function () { setTab(k); } }, tabs[k].label); tabbar.appendChild(tabBtns[k]); panels[k] = h('section', { class: 'panel', 'data-tab': k }); main.appendChild(panels[k]); tabs[k].build.call(tabs[k], panels[k]); });
  main.insertBefore(tabbar, main.firstChild);
  app.appendChild(head); app.appendChild(h('div', { class: 'layout' }, side, main)); A.buildLibrary(libCard); A.buildMix(mixCard);
  A.on(schedule); window.addEventListener('resize', function () { schedule(); });
  if (!tabs[A.tab]) A.tab = 'overview'; fillSelectors(); compute(); setTab(A.tab);
  A.R = function () { return R; };
}
A.init = init; A.tabs = tabs;
})();
