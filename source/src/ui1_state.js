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
/* LED Spectrum Lab - UI part 1: helpers, state, library, mixing, file I/O */
(function () {
'use strict';
var L = window.LSL;
var $ = function (s, r) { return (r || document).querySelector(s); };
var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
function h(tag, attrs) {
  var el = document.createElement(tag), i, k;
  if (attrs) for (k in attrs) { var v = attrs[k]; if (v == null || v === false) continue;
    if (k === 'class') el.className = v; else if (k === 'html') el.innerHTML = v; else if (k === 'text') el.textContent = v;
    else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v); else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (v === true) el.setAttribute(k, ''); else el.setAttribute(k, v); }
  for (i = 2; i < arguments.length; i++) { var c = arguments[i]; if (c == null || c === false) continue; if (Array.isArray(c)) c.forEach(function (x) { if (x != null) el.appendChild(typeof x === 'string' ? document.createTextNode(x) : x); }); else el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c); }
  return el;
}
function fmt(v, d, unit) { if (v == null || !isFinite(v)) return '–'; var s = Math.abs(v) >= 1e5 || (v !== 0 && Math.abs(v) < Math.pow(10, -d)) ? v.toExponential(Math.max(d - 1, 1)) : v.toFixed(d); return unit ? s + ' ' + unit : s; }
function uid() { return 'id' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4); }
function clone(o) { return JSON.parse(JSON.stringify(o)); }
function rgb(c) { return 'rgb(' + Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]) + ')'; }
function download(name, text, mime) { var b = new Blob([text], { type: mime || 'application/json' }), a = h('a', { href: URL.createObjectURL(b), download: name }); document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500); }
function toast(msg, kind) { var t = h('div', { class: 'toast ' + (kind || '') , text: msg }); $('#toasts').appendChild(t); setTimeout(function () { t.classList.add('out'); setTimeout(function () { t.remove(); }, 400); }, kind === 'err' ? 6000 : 3000); }
function store(key, val) { try { if (val === undefined) { var s = localStorage.getItem(key); return s ? JSON.parse(s) : null; } localStorage.setItem(key, JSON.stringify(val)); } catch (e) { return null; } }

/* ---------- state ---------- */
var S = window.APP = {
  library: [], curves: [],
  mix: { name: 'My luminaire', Ev: 500, channels: [] },
  source: 'mix',          // 'mix' | led id
  compare: 'none',        // 'none' | 'ref' | 'D65' | 'A' | led id | 'mix'
  tab: 'overview',
  ui: { libFilter: '', selected: null, spec: { yMode: 'abs', log: false, photons: false, overlays: { V: false, Vp: false, Mel: false, S: false, M: false, L: false }, x0: 350, x1: 800, channels: true, fill: true },
        cie: { sys: 'xy', obs: 2, fill: true, bbl: true, iso: true, ansi: false, channels: true, gamut: true, refpts: true, srgb: false, p3: false, r2020: false, grid: true, labels: true } },
  listeners: []
};
function emit() { S.listeners.forEach(function (f) { try { f(); } catch (e) { console.error(e); } }); }
S.on = function (f) { S.listeners.push(f); };

/* ---------- LED model ---------- */
var spdCache = {};
function ledSignature(led) { return JSON.stringify([led.spectrum]); }
function ledSpd(led) { // unit radiant (sum = 1 per nm bin), cached
  var sig = led.id + ledSignature(led), c = spdCache[sig]; if (c) return c;
  var s = specToSpd(led.spectrum), t = L.sumAll(s) || 1; s = L.scale(s, 1 / t);
  spdCache = Object.keys(spdCache).length > 300 ? {} : spdCache; spdCache[sig] = s; return s;
}
function specToSpd(sp) {
  if (!sp) return L.newSpd();
  if (sp.type === 'generator') return L.spdFromDef(sp.def);
  if (sp.type === 'measured') return L.spdFromDef({ kind: 'grid', start: sp.start, step: sp.step || 1, values: sp.values });
  return L.newSpd();
}
function ledLER(led) { var s = ledSpd(led); return 683 * L.sumVis(s, L.T.y31); }  // lm per radiant W
function ledRadW(led) { // radiant flux at datasheet condition (W)
  var e = led.electrical || {}, v = +e.value || 0; if (!v) return 0;
  if (e.basis === 'mW') return v / 1000;
  var ler = ledLER(led); return ler > 1e-6 ? v / ler : 0;
}
function ledLumens(led) { return ledRadW(led) * ledLER(led); }
function ledElecW(led, I) { var e = led.electrical || {}; var i = I == null ? (+e.If || 0) : I; return (+e.Vf || 0) * i / 1000; }

/* ---------- mixing ---------- */
function chanFactor(ch, led) { var e = led.electrical || {}, If = +e.If || 0, I = ch.I == null || ch.I === '' ? If : +ch.I; return (If > 0 ? I / If : 1) * (+ch.qty || 0) * (ch.enabled === false ? 0 : 1) * (ch.scale == null ? 1 : +ch.scale); }
function findLed(id) { for (var i = 0; i < S.library.length; i++) if (S.library[i].id === id) return S.library[i]; return null; }
function mixSpd(mix) { // absolute W/nm
  var tot = L.newSpd(), P = 0, lm = 0, chInfo = [], hasPower = true;
  mix.channels.forEach(function (ch) {
    var led = findLed(ch.ledId); if (!led) { chInfo.push({ ch: ch, led: null }); return; }
    var f = chanFactor(ch, led), rad = ledRadW(led) * f, sp = L.scale(ledSpd(led), rad);
    L.addScaled(tot, sp, 1);
    var e = led.electrical || {}, pw = (+e.Vf || 0) * ((ch.I == null || ch.I === '' ? +e.If : +ch.I) || 0) / 1000 * (+ch.qty || 0) * (ch.enabled === false ? 0 : 1) * (ch.scale == null ? 1 : +ch.scale);
    if (!(+e.Vf > 0 && +e.If > 0) && f > 0) hasPower = false; P += pw;
    chInfo.push({ ch: ch, led: led, rad: rad, lm: rad * ledLER(led), power: pw, spd: sp });
  });
  return { spd: tot, power: hasPower ? P : null, info: chInfo };
}
function sourceSpd() { // returns {spd (abs W/nm), name, power, info}
  if (S.source === 'mix') { var m = mixSpd(S.mix); m.name = S.mix.name || 'Mix'; return m; }
  var led = findLed(S.source); if (!led) { S.source = 'mix'; return sourceSpd(); }
  var rad = ledRadW(led) || 0.1, spd = L.scale(ledSpd(led), rad), p = ledElecW(led);
  return { spd: spd, name: led.name, power: p > 0 ? p : null, info: [{ ch: { ledId: led.id, qty: 1 }, led: led, rad: rad, lm: rad * ledLER(led), power: p, spd: spd }] };
}
function otherSpd(key, like) { // for compare overlays; like = analysis of main (for ref illuminant)
  if (key === 'none') return null;
  if (key === 'D65') return { name: 'D65', spd: L.d65spd() };
  if (key === 'A') return { name: 'Illuminant A', spd: L.illumA() };
  if (key === 'mix') { var m = mixSpd(S.mix); return { name: S.mix.name || 'Mix', spd: m.spd }; }
  if (key === 'ref') return null;
  var led = findLed(key); if (led) return { name: led.name, spd: L.scale(ledSpd(led), ledRadW(led) || 0.1) };
  return null;
}

/* ---------- default library (synthetic typical shapes) ---------- */
function mono(name, peak, fwhm, If, Vf, basis, val, tags, note) {
  return { id: 'def-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name: name, manufacturer: 'Generic (synthetic)', part: '', tags: tags || ['mono'], notes: note || 'Synthetic Gaussian, typical width. Replace with measured data for accuracy.',
    spectrum: { type: 'generator', def: { kind: 'gauss', peak: peak, fwhm: fwhm, skew: 0.05 } }, electrical: { If: If, Vf: Vf, basis: basis, value: val }, created: 0 };
}
function pcw(cct, fam, lm, If, Vf, nm) {
  var d = L.pcAuto(cct, fam);
  return { id: 'def-pc-' + fam + '-' + cct, name: nm, manufacturer: 'Generic (synthetic)', part: '', tags: ['white', 'pc-LED'], notes: 'Synthetic blue pump + 2 broad phosphor bands, solved to lie on the Planckian locus at ' + cct + ' K. Replace with a measured spectrum for real designs.',
    spectrum: { type: 'generator', def: d }, electrical: { If: If, Vf: Vf, basis: 'lm', value: lm }, created: 0 };
}
function defaultLibrary() {
  return [
    mono('UV-A 365 nm', 365, 12, 350, 3.6, 'mW', 800, ['mono', 'UV']), mono('UV-A 395 nm', 395, 14, 350, 3.3, 'mW', 1000, ['mono', 'UV']),
    mono('Violet 410 nm', 410, 15, 350, 3.3, 'mW', 900, ['mono']), mono('Royal blue 450 nm', 450, 20, 350, 3.1, 'mW', 700, ['mono', 'blue']),
    mono('Blue 470 nm', 470, 24, 350, 3.1, 'mW', 400, ['mono', 'blue']), mono('Cyan 505 nm', 505, 32, 350, 3.2, 'mW', 250, ['mono']),
    mono('Green 525 nm', 525, 36, 350, 3.2, 'mW', 300, ['mono', 'green']), mono('Lime 565 nm', 565, 28, 350, 2.9, 'mW', 120, ['mono']),
    mono('Amber 595 nm', 595, 17, 350, 2.3, 'mW', 200, ['mono']), mono('Red 630 nm', 630, 18, 350, 2.2, 'mW', 400, ['mono', 'red']),
    mono('Deep red 660 nm', 660, 22, 350, 2.3, 'mW', 500, ['mono', 'red']), mono('Far-red 730 nm', 730, 28, 350, 1.9, 'mW', 400, ['mono', 'red']),
    mono('IR 850 nm', 850, 35, 350, 1.5, 'mW', 600, ['mono', 'IR']),
    pcw(2700, 'ra80', 100, 150, 2.9, 'White 2700 K (Ra~84, synthetic)'), pcw(3000, 'ra80', 105, 150, 2.9, 'White 3000 K (Ra~84, synthetic)'),
    pcw(4000, 'ra80', 115, 150, 2.9, 'White 4000 K (Ra~83, synthetic)'), pcw(5000, 'ra80', 120, 150, 2.9, 'White 5000 K (Ra~81, synthetic)'),
    pcw(6500, 'ra80', 120, 150, 2.9, 'White 6500 K (Ra~79, synthetic)'),
    pcw(2700, 'ra90', 85, 150, 2.9, 'White 2700 K high-CRI (Ra~92, synthetic)'), pcw(4000, 'ra90', 98, 150, 2.9, 'White 4000 K high-CRI (Ra~93, synthetic)'),
    pcw(3000, 'ra97', 80, 150, 2.9, 'White 3000 K very-high-CRI (Ra~97, synthetic)'), pcw(5000, 'ra97', 95, 150, 2.9, 'White 5000 K very-high-CRI (Ra~93, synthetic)')
  ];
}
function defaultMix() {
  return { name: 'My luminaire', Ev: 500, channels: [{ id: uid(), ledId: 'def-pc-ra80-2700', qty: 10, I: 150 }, { id: uid(), ledId: 'def-pc-ra80-5000', qty: 10, I: 150 }] };
}

/* ---------- persistence ---------- */
function load() {
  var lib = store('lsl.library.v1'), mix = store('lsl.mix.v1'), cur = store('lsl.curves.v1'), ui = store('lsl.ui.v1');
  S.library = lib && lib.length ? lib : defaultLibrary();
  S.mix = mix || defaultMix(); S.curves = cur || [];
  if (ui) { if (ui.spec) Object.assign(S.ui.spec, ui.spec); if (ui.cie) Object.assign(S.ui.cie, ui.cie); if (ui.tab) S.tab = ui.tab; if (ui.source) S.source = ui.source; if (ui.compare) S.compare = ui.compare; }
}
var saveT = null;
function save() { clearTimeout(saveT); saveT = setTimeout(function () { store('lsl.library.v1', S.library); store('lsl.mix.v1', S.mix); store('lsl.curves.v1', S.curves); store('lsl.ui.v1', { spec: S.ui.spec, cie: S.ui.cie, tab: S.tab, source: S.source, compare: S.compare }); }, 200); }

/* ---------- file format ---------- */
var FORMAT = 'led-spectrum-lab';
function ledToFile(led) { return clone(led); }
function exportDoc(opts) {
  var doc = { format: FORMAT, version: 1, app: 'LED Spectrum Lab', created: new Date().toISOString() };
  if (opts.leds) doc.leds = opts.leds.map(ledToFile);
  if (opts.mix) { doc.mix = clone(opts.mix); var need = {}; opts.mix.channels.forEach(function (c) { need[c.ledId] = 1; }); doc.leds = (doc.leds || []).slice(); Object.keys(need).forEach(function (id) { if (!doc.leds.some(function (l) { return l.id === id; })) { var l = findLed(id); if (l) doc.leds.push(ledToFile(l)); } }); }
  if (opts.curves) doc.curves = clone(opts.curves);
  return JSON.stringify(doc, null, 1);
}
function parseCSVSpectrum(text) { // returns [[nm, v],...] or null
  var lines = text.split(/\r?\n/), pts = [], i;
  for (i = 0; i < lines.length; i++) { var l = lines[i].trim(); if (!l || l[0] === '#') continue; var p = l.split(/[;,\t ]+/); if (p.length < 2) continue; var a = parseFloat(p[0].replace(',', '.')), b = parseFloat(p[1].replace(',', '.')); if (isFinite(a) && isFinite(b)) pts.push([a, b]); }
  return pts.length >= 3 ? pts : null;
}

/* ---------- spectrum file parsing (Argyll .sp, hcri.io / generic CSV) ---------- */
function parseSP(text) {
  var lines = text.split(/\r?\n/), kv = {}, fields = [], sets = [], inFmt = false, inData = false, i;
  for (i = 0; i < lines.length; i++) { var l = lines[i].trim(); if (!l) continue;
    if (l === 'BEGIN_DATA_FORMAT') { inFmt = true; continue; } if (l === 'END_DATA_FORMAT') { inFmt = false; continue; }
    if (l === 'BEGIN_DATA') { inData = true; continue; } if (l === 'END_DATA') { inData = false; continue; }
    if (inFmt) { fields = fields.concat(l.split(/\s+/)); continue; }
    if (inData) { sets.push(l.split(/\s+/).map(Number)); continue; }
    var m = /^([A-Z_0-9]+)\s+"?([^"]*)"?\s*$/.exec(l); if (m) kv[m[1]] = m[2]; }
  var idx = []; fields.forEach(function (f, k) { if (/^SPEC_/.test(f)) idx.push(k); });
  if (!idx.length || !sets.length) throw new Error('This .sp file contains no spectral data (SPEC_nnn fields).');
  var s0 = parseFloat(kv.SPECTRAL_START_NM), s1 = parseFloat(kv.SPECTRAL_END_NM);
  if (!isFinite(s0) || !isFinite(s1)) { s0 = parseFloat(fields[idx[0]].slice(5)); s1 = parseFloat(fields[idx[idx.length - 1]].slice(5)); }
  var meta = ['Imported from Argyll .sp'].concat(['MEAS_TYPE', 'ORIGINATOR', 'CREATED'].filter(function (k) { return kv[k]; }).map(function (k) { return k.toLowerCase() + ': ' + kv[k]; })).join('; ');
  return sets.map(function (row) { return { pts: idx.map(function (k, j) { return [s0 + j * (s1 - s0) / Math.max(1, idx.length - 1), Math.max(0, row[k] || 0)]; }), notes: meta }; });
}
function parseSpectrumFile(text, fname) { // -> [{name, pts, notes}]
  var base = (fname || 'Imported').replace(/\.[^.]+$/, ''), out;
  if (/^\s*SPECT\b/.test(text) || /BEGIN_DATA_FORMAT/.test(text) && /SPEC_\d+/.test(text)) {
    out = parseSP(text); out.forEach(function (o, i) { o.name = out.length > 1 ? base + ' #' + (i + 1) : base; });
    return out;
  }
  var pts = parseCSVSpectrum(text); if (!pts) return null;
  pts = pts.map(function (p) { return [p[0], Math.max(0, p[1])]; });
  var meta = [], unit = null; text.split(/\r?\n/).slice(0, 15).forEach(function (l) { var m = /^#\s*([\w ]+?)\s*,\s*(.+)$/.exec(l); if (m && !/^spec_/i.test(m[1])) { if (/^wavelength/i.test(m[1])) unit = m[2]; else if (/^(descriptor|originator|created|meas_type)$/i.test(m[1])) meta.push(m[1].toLowerCase() + ': ' + m[2]); } });
  return [{ name: base, pts: pts, notes: 'Imported CSV' + (unit ? ' (intensity: ' + unit + ')' : '') + (meta.length ? '; ' + meta.join('; ') : '') + '. Relative, normalised to peak.' }];
}
function spectrumToCSV(spd, nm0, nm1, unitName) { // hcri.io-style CSV
  var r = ['# wavelength_nm,' + (unitName || 'intensity'), 'Wavelength (nm),Intensity']; for (var w = nm0; w <= nm1; w++) r.push(w + ',' + (+spd[w - L.WL0].toPrecision(7))); return r.join('\n') + '\n';
}
function spectrumToSP(spd, nm0, nm1, rel) { // Argyll CMS .sp (SPECT) emission spectrum
  var vals = [], mx = 0, w; for (w = nm0; w <= nm1; w++) { var v = spd[w - L.WL0]; vals.push(v); if (v > mx) mx = v; }
  var k = rel ? 1 / (mx || 1) : 1, names = [], data = []; for (w = nm0; w <= nm1; w++) { names.push('SPEC_' + w); data.push((vals[w - nm0] * k).toPrecision(7)); }
  return ['SPECT  ', '', 'DESCRIPTOR "Argyll Spectral power/reflectance information"', 'ORIGINATOR "LED Spectrum Lab"', 'CREATED "' + new Date().toString().slice(0, 24) + '"', 'MEAS_TYPE "EMISSION"', 'SPECTRAL_BANDS "' + names.length + '"', 'SPECTRAL_START_NM "' + nm0.toFixed(6) + '"', 'SPECTRAL_END_NM "' + nm1.toFixed(6) + '"', 'SPECTRAL_NORM "1.000000"', '', 'NUMBER_OF_FIELDS ' + names.length, 'BEGIN_DATA_FORMAT', names.join(' '), 'END_DATA_FORMAT', '', 'NUMBER_OF_SETS 1', 'BEGIN_DATA', data.join(' '), 'END_DATA', ''].join('\n');
}
function ledFromPoints(name, pts) {
  pts.sort(function (a, b) { return a[0] - b[0]; });
  var step = 1, x0 = Math.round(pts[0][0]), x1 = Math.round(pts[pts.length - 1][0]);
  var sp = L.fromPoints(pts), vals = []; for (var w = x0; w <= x1; w++) vals.push(+(sp[w - L.WL0] || 0).toPrecision(6));
  var mx = Math.max.apply(null, vals) || 1; vals = vals.map(function (v) { return +(v / mx).toPrecision(5); });
  return { id: uid(), name: name, manufacturer: '', part: '', tags: ['measured'], notes: 'Imported spectrum (relative, normalised to peak).', spectrum: { type: 'measured', start: x0, step: step, values: vals }, electrical: { If: 350, Vf: 3, basis: 'mW', value: 500 }, created: Date.now() };
}
function importText(text, fname, mode) { // returns {added, skipped}
  var name = (fname || 'Imported').replace(/\.[^.]+$/, ''), j = null;
  try { j = JSON.parse(text); } catch (e) { j = null; }
  var added = 0, skipped = 0, info = '';
  if (j && j.format === FORMAT) {
    if (mode === 'replace') { S.library = []; }
    (j.leds || []).forEach(function (l) {
      var ex = findLed(l.id);
      if (ex) { if (JSON.stringify(ex.spectrum) === JSON.stringify(l.spectrum) && JSON.stringify(ex.electrical) === JSON.stringify(l.electrical)) { skipped++; return; } l = clone(l); l.id = uid(); l.name += ' (imported)'; }
      S.library.push(l); added++; });
    if (j.curves) j.curves.forEach(function (c) { if (!S.curves.some(function (x) { return x.name === c.name; })) S.curves.push(c); });
    if (j.mix && (j.leds || []).length) { S.mix = j.mix; S.source = 'mix'; info = ' + mix'; }
  } else if (j && Array.isArray(j.points)) { // specled-style spectrum
    var pts = j.points.map(function (p) { return [+p.x, +p.y]; }); var led = ledFromPoints(j.name || name, pts); led.tags.push('specled'); led.notes = 'Imported from spectrum JSON (' + (j.tool || 'points') + ').'; S.library.push(led); added++; S.ui.selected = led.id;
  } else {
    var sp = parseSpectrumFile(text, fname); if (!sp) throw new Error('Unrecognised file: expected an LED Spectrum Lab JSON, an Argyll .sp, a {points:[{x,y}]} JSON, or a 2-column CSV (wavelength, intensity).');
    sp.forEach(function (o) { var l2 = ledFromPoints(o.name, o.pts); l2.notes = o.notes; S.library.push(l2); added++; S.ui.selected = l2.id; });
  }
  save(); emit();
  return { added: added, skipped: skipped, info: info };
}
function share(obj) { // base64url of JSON (small payloads)
  var s = JSON.stringify(obj), b = btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); return b;
}
function unshare(b) { b = b.replace(/-/g, '+').replace(/_/g, '/'); while (b.length % 4) b += '='; return JSON.parse(decodeURIComponent(escape(atob(b)))); }

Object.assign(S, { $: $, $$: $$, h: h, fmt: fmt, uid: uid, clone: clone, rgb: rgb, download: download, toast: toast, emit: emit, save: save, load: load,
  ledSpd: ledSpd, ledLER: ledLER, ledRadW: ledRadW, ledLumens: ledLumens, ledElecW: ledElecW, findLed: findLed, mixSpd: mixSpd, sourceSpd: sourceSpd, otherSpd: otherSpd,
  defaultLibrary: defaultLibrary, defaultMix: defaultMix, exportDoc: exportDoc, importText: importText, parseCSVSpectrum: parseCSVSpectrum, ledFromPoints: ledFromPoints, share: share, unshare: unshare, parseSpectrumFile: parseSpectrumFile, spectrumToCSV: spectrumToCSV, spectrumToSP: spectrumToSP, specToSpd: specToSpd, FORMAT: FORMAT });
})();
