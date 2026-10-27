/* LED Spectrum Lab - side-by-side comparison of source A (the analysed source) and B (the "Compare" selection)
 * Shows the measurements of both (peak wavelengths, colour, CRI, TM-30, ...) with the difference, on every tab, and
 * overlays B in the CRI / TM-30 / photometry charts.
 * SPDX-License-Identifier: AGPL-3.0-or-later */
(function () {
'use strict';
var L = window.LSL, A = window.APP, h = A.h, T = A.tabs;

/* ---------- B: the compare source, analysed like A ---------- */
var cache = { R: null, key: null, v: null };
A.cmp = function () {
  var R = A.R, key = A.compare; if (!R || !key || key === 'none') return null;
  if (cache.R === R && cache.key === key) return cache.v;
  var o = null; try { o = A.otherScaled(key); } catch (e) { o = null; }
  var v = null;
  if (o && L.sumAll(o.spd) > 0) {
    var a = L.analyse(o.spd, { Ev: +A.mix.Ev || 500 });
    if (R.src.irr) a = L.analyse(o.spd, { Ev: +a.lumens.toPrecision(5) });      // measurements: lux = lumens/m2, so the melanopic EDI uses the lux itself
    v = { name: o.name, spd: o.spd, a: a };
  }
  cache = { R: R, key: key, v: v }; return v;
};

/* ---------- numbers ---------- */
function fwhmOf(y) {
  var n = y.length, ip = 0, i; for (i = 1; i < n; i++) if (y[i] > y[ip]) ip = i; var pk = y[ip]; if (!(pk > 0)) return null;
  var l = ip, r = ip; while (l > 0 && y[l] > pk / 2) l--; while (r < n - 1 && y[r] > pk / 2) r++; if (l === 0 && y[0] > pk / 2) return null; if (r === n - 1 && y[n - 1] > pk / 2) return null;
  var wl = l + (pk / 2 - y[l]) / ((y[l + 1] - y[l]) || 1), wr = r - 1 + (y[r - 1] - pk / 2) / ((y[r - 1] - y[r]) || 1);
  return wr - wl;
}
function peaksOf(spd) { return A.extrema ? A.extrema(spd, L.WL0, 380, 780, { n: 4, prom: 5, sep: 12, smooth: 3, valleys: false }).peaks.sort(function (p, q) { return p.nm - q.nm; }) : []; }
function f(v, d) { return v == null || !isFinite(v) ? '–' : v.toFixed(d); }
function sg(v, d) { return v == null || !isFinite(v) ? '–' : (v >= 0 ? '+' : '') + v.toFixed(d); }

/* id, label, tooltip, value(ctx) -> number|string|null, digits, unit; numeric values get a difference column */
function rows(irr) {
  var Em = irr ? 'Illuminance' : 'Luminous flux';
  return [
    { id: 'pk', g: 'Spectrum', l: 'Peak wavelength', u: 'nm', d: 1, tip: 'Wavelength of the highest point of the spectrum.', v: function (c) { return c.a.peak.wl; } },
    { id: 'pks', g: 'Spectrum', l: 'Strongest peaks', u: 'nm', tip: 'Up to four peaks that stand out by at least 5 % of the maximum, sorted by wavelength (sub-nanometre position from a parabola through the top).', v: function (c) { return peaksOf(c.spd).map(function (p) { return p.nm.toFixed(0); }).join(', ') || '–'; } },
    { id: 'fw', g: 'Spectrum', l: 'Width (FWHM) of the main peak', u: 'nm', d: 1, tip: 'Full width at half maximum of the highest peak. A real 5 nm line reads about 10 nm with the i1 Pro (optics).', v: function (c) { return fwhmOf(c.spd.slice(80, 701)); } },
    { id: 'cen', g: 'Spectrum', l: 'Centroid', u: 'nm', d: 1, tip: 'Power-weighted mean wavelength.', v: function (c) { return c.a.centroid; } },
    { id: 'dom', g: 'Colour', l: 'Dominant wavelength', u: 'nm', d: 1, tip: 'Spectral colour that, mixed with the white point, gives this chromaticity. A "c" means complementary (purple side).', v: function (c) { var d = c.a.dominant; return d && isFinite(d.wl) ? d.wl : null; }, fmt: function (v, c) { var d = c.a.dominant; return v == null ? '–' : v.toFixed(1) + (d.complementary ? ' c' : ''); } },
    { id: 'pur', g: 'Colour', l: 'Excitation purity', u: '%', d: 1, tip: 'Distance of the colour from the white point towards the spectral locus (0 % white, 100 % monochromatic).', v: function (c) { return c.a.dominant && c.a.dominant.purity != null ? c.a.dominant.purity * 100 : null; } },
    { id: 'cct', g: 'Colour', l: 'CCT', u: 'K', d: 0, tip: 'Correlated colour temperature (Ohno method). Only meaningful near the Planckian locus.', v: function (c) { return c.a.cctValid ? c.a.cct : null; } },
    { id: 'duv', g: 'Colour', l: 'Duv', d: 4, tip: 'Distance from the Planckian locus in CIE 1960 uv. Positive = greenish, negative = pinkish.', v: function (c) { return c.a.duv; }, sign: true },
    { id: 'x', g: 'Colour', l: 'CIE x', d: 4, tip: 'CIE 1931 2° chromaticity coordinate x.', v: function (c) { return c.a.xy.x; } },
    { id: 'y', g: 'Colour', l: 'CIE y', d: 4, tip: 'CIE 1931 2° chromaticity coordinate y.', v: function (c) { return c.a.xy.y; } },
    { id: 'up', g: 'Colour', l: 'u′', d: 4, tip: 'CIE 1976 u′ (more uniform than x, y).', v: function (c) { return c.a.upvp.u; } },
    { id: 'vp', g: 'Colour', l: 'v′', d: 4, tip: 'CIE 1976 v′.', v: function (c) { return c.a.upvp.v; } },
    { id: 'ra', g: 'Colour rendering', l: 'CRI Ra', d: 1, tip: 'General colour rendering index (mean of R1–R8). Unreliable for narrow-band LEDs.', v: function (c) { return c.a.cri.Ra; } },
    { id: 'r9', g: 'Colour rendering', l: 'R9 (saturated red)', d: 0, tip: 'Special index R9, saturated red.', v: function (c) { return c.a.cri.R[8]; } },
    { id: 'r12', g: 'Colour rendering', l: 'R12 (saturated blue)', d: 0, tip: 'Special index R12, saturated blue.', v: function (c) { return c.a.cri.R[11]; } },
    { id: 'rf', g: 'Colour rendering', l: 'TM-30 Rf', d: 1, tip: 'Fidelity index: how closely colours look like under the reference illuminant (100 = identical).', v: function (c) { return c.a.tm30.Rf; } },
    { id: 'rg', g: 'Colour rendering', l: 'TM-30 Rg', d: 1, tip: 'Gamut index: size of the colour gamut relative to the reference (100 = same).', v: function (c) { return c.a.tm30.Rg; } },
    { id: 'rfs', g: 'Colour rendering', l: 'TM-30 Rf,skin', d: 1, tip: 'Fidelity of the skin-tone samples (CES 15 and 18).', v: function (c) { return c.a.tm30.Rfskin; } },
    { id: 'rcs1', g: 'Colour rendering', l: 'TM-30 Rcs,h1 (red chroma shift)', u: '%', d: 1, sign: true, tip: 'Local chroma shift of the red hue bin: positive = reds look more saturated.', v: function (c) { return c.a.tm30.Rcsh1 * 100; } },
    { id: 'lm', g: 'Light output', l: Em, u: irr ? 'lx' : 'lm', d: 1, tip: irr ? 'Illuminance (photopic, 2°) at the sensor.' : 'Luminous flux, photopic V(λ), 2°. Each source with its own level.', v: function (c) { return c.a.lumens; } },
    { id: 'rad', g: 'Light output', l: irr ? 'Irradiance' : 'Radiant flux', u: irr ? 'mW/m²' : 'mW', d: 1, tip: 'Total radiated power over 300–1000 nm.', v: function (c) { return c.a.radiantW * 1000; } },
    { id: 'ler', g: 'Light output', l: 'LER', u: 'lm/W', d: 1, tip: 'Luminous efficacy of radiation: lumens per watt of radiated power.', v: function (c) { return c.a.LER; } },
    { id: 'sp', g: 'Light output', l: 'S/P ratio', d: 2, tip: 'Scotopic to photopic ratio: how much brighter the light looks in the dark-adapted eye.', v: function (c) { return c.a.SP; } },
    { id: 'der', g: 'Circadian', l: 'Melanopic DER', d: 3, tip: 'Melanopic daylight efficacy ratio (melanopic lux per lux, relative to D65).', v: function (c) { return c.a.alpha.Mel.DER; } },
    { id: 'edi', g: 'Circadian', l: 'Melanopic EDI', u: 'lx', d: 0, tip: 'Melanopic equivalent daylight (D65) illuminance.', v: function (c) { return c.a.alpha.Mel.EDI; } },
    { id: 'ssi', g: 'Spectral quality', l: 'SSI', d: 1, tip: 'Spectral similarity index to the reference illuminant (100 = identical spectrum).', v: function (c) { return c.a.sq.ssi; } },
    { id: 'smo', g: 'Spectral quality', l: 'Smoothness', u: '%', d: 1, tip: 'How smooth the spectrum is (100 % = no jaggedness).', v: function (c) { return c.a.sq.smooth; } },
    { id: 'cyan', g: 'Spectral quality', l: 'Cyan dip', d: 2, tip: 'Depth of the 470–520 nm trough relative to the neighbouring peaks (1 = no dip).', v: function (c) { return c.a.sq.bands && c.a.sq.bands.cyan ? c.a.sq.bands.cyan.trough : null; } },
    { id: 'dred', g: 'Spectral quality', l: 'Deep red 650–700 vs reference', d: 2, tip: 'Share of deep-red power relative to the reference illuminant (1 = same).', v: function (c) { return c.a.sq.bands && c.a.sq.bands.deepred ? c.a.sq.bands.deepred.ratio : null; } },
    { id: 'nar', g: 'Spectral quality', l: 'Narrowest peak', u: 'nm', d: 0, tip: 'FWHM of the narrowest significant peak.', v: function (c) { return c.a.sq.narrowest ? c.a.sq.narrowest.fwhm : null; } }
  ].concat([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14].map(function (i) { return { id: 'R' + i, g: 'CRI samples', l: 'R' + i, d: 1, tip: 'Special colour rendering index R' + i + '.', v: function (c) { return c.a.cri.R[i - 1]; } }; }));
}

function ctxA() { var R = A.R; return { a: R.a, spd: R.src.spd, name: R.src.name }; }

/* the comparison card; ids = which rows, title */
function card(ids, title, opts) {
  opts = opts || {}; var R = A.R, B = A.cmp(); if (!R || !B) return null;
  var a = ctxA(), b = { a: B.a, spd: B.spd, name: B.name }, rs = rows(!!R.src.irr), pick = ids ? ids.map(function (id) { return rs.filter(function (r) { return r.id === id; })[0]; }).filter(Boolean) : rs;
  var tb = h('tbody'), grp = null;
  pick.forEach(function (r) {
    if (!ids && r.g !== grp) { grp = r.g; tb.appendChild(h('tr', { class: 'grp' }, h('th', { colspan: 4, text: r.g }))); }
    var va = null, vb = null; try { va = r.v(a); vb = r.v(b); } catch (e) { }
    var num = typeof va === 'number' && typeof vb === 'number' && isFinite(va) && isFinite(vb);
    function show(v, c) { if (typeof v === 'string') return v; if (r.fmt) return r.fmt(v, c); return v == null || !isFinite(v) ? '–' : (r.sign ? sg(v, r.d) : f(v, r.d)); }
    var dtxt = num ? sg(vb - va, r.d == null ? 1 : r.d) : '';
    tb.appendChild(h('tr', { title: r.tip }, h('td', { class: 'cmp-l', text: r.l + (r.u ? ' (' + r.u + ')' : '') }), h('td', { class: 'num', text: show(va, a) }), h('td', { class: 'num', text: show(vb, b) }), h('td', { class: 'num cmp-d', text: dtxt })));
  });
  if (!ids || ids.indexOf('x') >= 0 || ids.indexOf('up') >= 0) {
    var du = Math.sqrt(Math.pow(B.a.upvp.u - R.a.upvp.u, 2) + Math.pow(B.a.upvp.v - R.a.upvp.v, 2));
    tb.appendChild(h('tr', { title: 'Distance between A and B in the CIE 1976 u′v′ diagram. About 0.002 is the visibility threshold for side-by-side comparison, 0.004–0.006 a clearly visible colour difference.' }, h('td', { class: 'cmp-l', text: 'Colour difference Δu′v′' }), h('td', { class: 'num', text: '' }), h('td', { class: 'num', text: '' }), h('td', { class: 'num cmp-d', text: du.toFixed(4) })));
  }
  var head = h('thead', null, h('tr', null, h('th', { text: '' }), h('th', null, h('span', { class: 'cdot', style: { background: A.cv('--accent') } }), h('span', { class: 'cname', text: R.src.name, title: R.src.name }), h('small', { text: ' A' })),
    h('th', null, h('span', { class: 'cdot', style: { background: A.cv('--muted') } }), h('span', { class: 'cname', text: B.name, title: B.name }), h('small', { text: ' B' })), h('th', { text: 'B − A', title: 'Difference: compare minus analysed source' })));
  var hint = (opts.hint === false) ? null : h('div', { class: 'hint', text: 'A = analysed source (header: Source), B = Compare (header). Hover a row for its meaning. Absolute levels (lm or lx) are each source’s own; TM-30 reference, D65 and A are scaled to the lumens of A.' });
  return h('div', { class: 'card cmpcard' }, h('div', { class: 'card-h' }, h('h3', null, title || 'Comparison A ↔ B'), h('div', { class: 'grow' }), A.helpBtn ? A.helpBtn('compare') : null), h('div', { class: 'tblwrap' }, h('table', { class: 'tbl cmp' }, head, tb)), hint);
}
A.cmpCard = card;

/* ---------- put the card on the tabs ---------- */
var SETS = {
  overview: { ids: null, title: 'Comparison A ↔ B: all measurements' },
  spectrum: { ids: ['pk', 'pks', 'fw', 'cen', 'dom', 'pur'], title: 'Comparison A ↔ B: peaks and spectrum' },
  cie: { ids: ['x', 'y', 'up', 'vp', 'dom', 'pur', 'cct', 'duv'], title: 'Comparison A ↔ B: colour' },
  cri: { ids: ['ra', 'r9', 'r12', 'R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'R9', 'R10', 'R11', 'R12', 'R13', 'R14'], title: 'Comparison A ↔ B: colour rendering (◆ in the chart = B)' },
  tm30: { ids: ['rf', 'rg', 'rfs', 'rcs1', 'cct', 'duv'], title: 'Comparison A ↔ B: TM-30 (dashed blue in the vector graphic and ◆ in the charts = B)' },
  photo: { ids: ['lm', 'rad', 'ler', 'sp'], title: 'Comparison A ↔ B: photometry' },
  circ: { ids: ['der', 'edi', 'sp', 'lm'], title: 'Comparison A ↔ B: circadian' },
  sq: { ids: ['ssi', 'smo', 'cyan', 'nar', 'pk', 'fw'], title: 'Comparison A ↔ B: spectral quality' },
  overlay: null
};
Object.keys(SETS).forEach(function (k) {
  var def = SETS[k], t = T[k]; if (!def || !t) return; var ob = t.build;
  t.build = function (root) {
    var self = this; ob.call(self, root); var host = h('div', { class: 'cmphost' }); root.insertBefore(host, root.firstChild);
    var ou = self.update; self.update = function () { ou.call(self); host.innerHTML = ''; var c = card(def.ids, def.title); if (c) host.appendChild(c); };
    self.render = function () { self.update(); };
  };
});

/* ---------- B in the charts ---------- */
var odb = A.drawBars;
A.drawBars = function (cv, o) {
  var B = A.cmp(); if (B && !o.noCompare) {
    var a = B.a, v2 = null, lab = o.ylabel, o2 = Object.assign({}, o);
    if (lab === 'Rf,h') v2 = a.tm30.Rfh;
    else if (lab === 'Rcs,h (%)') { v2 = a.tm30.Rcs.map(function (v) { return v == null ? null : v * 100; }); }
    else if (lab === 'Rhs,h (rad)') v2 = a.tm30.Rhs;
    else if (lab === 'Rf,CESi') v2 = a.tm30.RfI;
    else if (o.labels && o.labels[0] === 'R1' && o.values.length === 14) v2 = a.cri.R.slice(0, 14);
    else if (o.labels && o.labels[0] === 'UV' && o.values.length === 6) { var ks = Object.keys(a.bands); v2 = ks.map(function (k) { return a.radiantW > 0 ? a.bands[k] / a.radiantW * 100 : 0; }); }
    if (v2) {
      o2.values2 = v2; var all = o.values.concat(v2).filter(function (v) { return v != null; });
      if (lab === 'Rcs,h (%)' || lab === 'Rhs,h (rad)') { var lim = Math.max.apply(null, all.map(Math.abs)), step = lab === 'Rhs,h (rad)' ? 0.1 : 5, nl = Math.ceil(lim / step) * step; if (nl > o.max) { o2.max = nl; o2.min = -nl; } }
      else if (lab === 'Rf,h' || lab === 'Rf,CESi') { /* 0..100 */ }
      else if (o2.min < 0 || true) { var mn = Math.min.apply(null, all); if (mn < o.min) o2.min = Math.floor(mn / 20) * 20; var mxv = Math.max.apply(null, all); if (mxv > o.max && o.labels && o.labels[0] === 'UV') o2.max = Math.ceil(mxv / 10) * 10; }
      return odb(cv, o2);
    }
  }
  return odb(cv, o);
};
var odc = A.drawCVG;
A.drawCVG = function (cv, t, cols) { var B = A.cmp(); return odc(cv, t, cols, B ? B.a.tm30 : null); };

/* A/B legend hint in the header */
})();
