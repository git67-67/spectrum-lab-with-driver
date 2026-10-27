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
/* LED Spectrum Lab - UI part 3: library, LED editor, mix editor, sharing */
(function () {
'use strict';
var L = window.LSL, A = window.APP, h = A.h, $ = A.$, fmt = A.fmt;

function fwhmOf(spd) { var pk = L.peakOf(spd), half = pk.v / 2, i = pk.wl - L.WL0, a = i, b = i; while (a > 0 && spd[a] > half) a--; while (b < L.N - 1 && spd[b] > half) b++; var fa = a + (half - spd[a]) / ((spd[a + 1] - spd[a]) || 1), fb = b - 1 + (spd[b - 1] - half) / ((spd[b - 1] - spd[b]) || 1); return Math.max(0, fb - fa); }
A.fwhmOf = fwhmOf;
function ledDot(led) { var s = A.ledSpd(led), t = L.XYZ(s, 2), c = L.xyOf(t); if (!isFinite(c.x) || !isFinite(c.y) || c.y <= 0) return [120, 120, 120]; return L.xyToRGB(c.x, c.y); }
function ledSummary(led) { var s = A.ledSpd(led), pk = L.peakOf(s), t = L.XYZ(s, 2), c = L.xyOf(t), isWhite = led.tags && led.tags.indexOf('white') >= 0 || (led.spectrum.type === 'generator' && led.spectrum.def.kind === 'pc'); if (isWhite && t.Y > 0) { var cd = L.cctDuv(c.x, c.y); return Math.round(cd.cct / 10) * 10 + ' K'; } return Math.round(pk.wl) + ' nm'; }

/* ================= LIBRARY PANEL ================= */
function buildLibrary(root) {
  var list = h('div', { class: 'lib-list' }), search = h('input', { type: 'search', placeholder: 'Search LEDs / tags…', class: 'inp', oninput: function () { A.ui.libFilter = this.value; renderList(); } });
  search.value = A.ui.libFilter || '';
  function menu(items, anchor) { var m = h('div', { class: 'menu' }); items.forEach(function (it) { if (it === '-') m.appendChild(h('hr')); else m.appendChild(h('button', { class: 'menu-i', onclick: function () { m.remove(); it[1](); } }, it[0])); }); document.body.appendChild(m); var r = anchor.getBoundingClientRect(); m.style.left = Math.min(r.left, innerWidth - 230) + 'px'; m.style.top = (r.bottom + 4) + 'px'; setTimeout(function () { var off = function (e) { if (!m.contains(e.target)) { m.remove(); document.removeEventListener('pointerdown', off); } }; document.addEventListener('pointerdown', off); }, 0); }
  function pickFile(accept, cb, multi) { var inp = h('input', { type: 'file', accept: accept, multiple: !!multi }); inp.onchange = function () { Array.prototype.forEach.call(inp.files, function (f) { var r = new FileReader(); r.onload = function () { cb(r.result, f.name); }; r.readAsText(f); }); }; inp.click(); }
  A.pickFile = pickFile;
  function doImport() { pickFile('.json,.csv,.txt,.tsv,.led,.sp', function (txt, name) { try { var r = A.importText(txt, name, 'merge'); A.toast('Imported ' + r.added + ' LED(s)' + (r.skipped ? ', ' + r.skipped + ' duplicate(s) skipped' : '') + r.info); } catch (e) { A.toast(e.message, 'err'); } }, true); }
  var tb = h('div', { class: 'lib-tb' },
    h('button', { class: 'btn primary', onclick: function () { A.openEditor(null); } }, '+ New LED'),
    h('button', { class: 'btn', title: 'Import LED library (.json), spectrum JSON or CSV', onclick: doImport }, 'Import'),
    h('button', { class: 'btn', onclick: function (e) { menu([
      ['Export whole library (.json)', function () { A.download('led-library.json', A.exportDoc({ leds: A.library, curves: A.curves })); }],
      ['Export selected LED (.json)', function () { var l = A.findLed(A.ui.selected); if (!l) return A.toast('Select an LED first', 'err'); A.download(l.name.replace(/[^\w\-]+/g, '_') + '.led.json', A.exportDoc({ leds: [l] })); }],
      ['Export mix incl. LEDs (.json)', function () { A.download('mix.json', A.exportDoc({ mix: A.mix })); }],
      '-', ['Selected LED spectrum as CSV (hcri.io style)', function () { var l = A.findLed(A.ui.selected); if (!l) return A.toast('Select an LED first', 'err'); A.download(l.name.replace(/[^\w\-]+/g, '_') + '.csv', A.spectrumToCSV(A.ledSpd(l), 380, 780, 'relative'), 'text/csv'); }],
      ['Selected LED spectrum as Argyll .sp', function () { var l = A.findLed(A.ui.selected); if (!l) return A.toast('Select an LED first', 'err'); A.download(l.name.replace(/[^\w\-]+/g, '_') + '.sp', A.spectrumToSP(A.ledSpd(l), 380, 780, true), 'text/plain'); }],
      '-', ['Copy share link for selected LED', function () { var l = A.findLed(A.ui.selected); if (!l) return A.toast('Select an LED first', 'err'); copyLink({ format: A.FORMAT, version: 1, leds: [l] }); }],
      ['Copy share link for current mix', function () { var need = {}, leds = []; A.mix.channels.forEach(function (c) { if (!need[c.ledId]) { need[c.ledId] = 1; var l = A.findLed(c.ledId); if (l) leds.push(l); } }); copyLink({ format: A.FORMAT, version: 1, leds: leds, mix: A.mix }); }],
      '-', ['Reset library to defaults', function () { if (confirm('Replace the library with the built-in defaults? Your own LEDs will be removed.')) { A.library = A.defaultLibrary(); A.mix = A.defaultMix(); A.source = 'mix'; A.save(); A.emit(); } }]
    ], e.currentTarget); } }, 'Export ▾'));
  function copyLink(obj) { var url = location.href.split('#')[0] + '#share=' + A.share(obj); if (url.length > 60000) A.toast('This data is too large for a link – export a file instead.', 'err'); else { (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(function () { A.toast('Link copied (' + Math.round(url.length / 1024 * 10) / 10 + ' kB)'); }, function () { prompt('Copy this link:', url); }); } }
  function renderList() {
    list.innerHTML = ''; var q = (A.ui.libFilter || '').toLowerCase(), n = 0;
    A.library.forEach(function (led) {
      var hay = (led.name + ' ' + (led.manufacturer || '') + ' ' + (led.part || '') + ' ' + (led.tags || []).join(' ')).toLowerCase(); if (q && hay.indexOf(q) < 0) return; n++;
      var dot = h('span', { class: 'dot', style: { background: A.rgb(ledDot(led)) } });
      var row = h('div', { class: 'lib-row' + (A.ui.selected === led.id ? ' sel' : '') + (A.source === led.id ? ' src' : ''), onclick: function () { A.ui.selected = led.id; renderList(); } },
        dot, h('div', { class: 'lib-main' }, h('div', { class: 'lib-name', text: led.name }), h('div', { class: 'lib-sub', text: ledSummary(led) + (led.manufacturer ? ' · ' + led.manufacturer : '') + (led.tags && led.tags.length ? ' · ' + led.tags.slice(0, 3).join(', ') : '') })),
        h('div', { class: 'lib-act' },
          h('button', { class: 'ib', title: 'Add to mix', onclick: function (e) { e.stopPropagation(); addToMix(led); } }, '＋'),
          h('button', { class: 'ib', title: 'Analyse this LED alone', onclick: function (e) { e.stopPropagation(); A.source = A.source === led.id ? 'mix' : led.id; A.save(); A.emit(); } }, '◎'),
          h('button', { class: 'ib', title: 'Edit', onclick: function (e) { e.stopPropagation(); A.openEditor(led.id); } }, '✎'),
          h('button', { class: 'ib', title: 'Duplicate', onclick: function (e) { e.stopPropagation(); var c = A.clone(led); c.id = A.uid(); c.name += ' copy'; A.library.splice(A.library.indexOf(led) + 1, 0, c); A.ui.selected = c.id; A.save(); A.emit(); } }, '⎘'),
          h('button', { class: 'ib', title: 'Delete', onclick: function (e) { e.stopPropagation(); if (confirm('Delete "' + led.name + '"?')) { A.library.splice(A.library.indexOf(led), 1); A.mix.channels = A.mix.channels.filter(function (c) { return c.ledId !== led.id; }); if (A.source === led.id) A.source = 'mix'; A.save(); A.emit(); } } }, '✕')));
      row.addEventListener('dblclick', function () { A.openEditor(led.id); }); list.appendChild(row); });
    if (!n) list.appendChild(h('div', { class: 'empty', text: 'No LEDs match.' }));
    $('#libCount') && ($('#libCount').textContent = A.library.length);
  }
  function addToMix(led) { var ex = A.mix.channels.filter(function (c) { return c.ledId === led.id; })[0]; if (ex) ex.qty = (+ex.qty || 0) + 1; else A.mix.channels.push({ id: A.uid(), ledId: led.id, qty: 1, I: (led.electrical && led.electrical.If) || '' }); A.source = 'mix'; A.save(); A.emit(); A.toast('Added "' + led.name + '" to the mix'); }
  root.appendChild(h('div', { class: 'card-h' }, h('h2', null, 'LED library ', h('span', { class: 'badge', id: 'libCount' }, A.library.length))));
  root.appendChild(tb); root.appendChild(search); root.appendChild(list);
  root.appendChild(h('p', { class: 'hint' }, 'Double-click to edit. ＋ adds to the mix, ◎ analyses a single LED. Everything is stored in this browser; use Export to back up or share.'));
  var dz = root; dz.addEventListener('dragover', function (e) { e.preventDefault(); }); dz.addEventListener('drop', function (e) { e.preventDefault(); Array.prototype.forEach.call(e.dataTransfer.files, function (f) { var r = new FileReader(); r.onload = function () { try { var res = A.importText(r.result, f.name, 'merge'); A.toast('Imported ' + res.added + ' LED(s)'); } catch (er) { A.toast(er.message, 'err'); } }; r.readAsText(f); }); });
  A.on(renderList); renderList();
}
A.buildLibrary = buildLibrary;

/* ================= LED EDITOR ================= */
function openEditor(id) {
  var orig = id ? A.findLed(id) : null;
  var d = orig ? A.clone(orig) : { id: A.uid(), name: 'New LED', manufacturer: '', part: '', tags: [], notes: '', spectrum: { type: 'generator', def: { kind: 'gauss', peak: 520, fwhm: 34, skew: 0.05 } }, electrical: { If: 350, Vf: 3.0, basis: 'mW', value: 300 }, created: Date.now() };
  var type = d.spectrum.type === 'measured' ? 'measured' : (d.spectrum.def.kind === 'pc' ? 'pc' : 'gauss');
  var back = h('div', { class: 'modal-back' }), box = h('div', { class: 'modal' }); back.appendChild(box);
  var prevCanvas = h('canvas', { class: 'chart', style: { height: '230px' } }), prevInfo = h('div', { class: 'prev-info' });
  var chart = null;
  function curDef() { return d.spectrum.def; }
  function ensureType(t) {
    type = t;
    if (t === 'gauss') { if (d.spectrum.type !== 'generator' || d.spectrum.def.kind !== 'gauss') d.spectrum = { type: 'generator', def: { kind: 'gauss', peak: 520, fwhm: L.defaultFWHM(520), skew: 0.05 } }; }
    else if (t === 'pc') { if (d.spectrum.type !== 'generator' || d.spectrum.def.kind !== 'pc') { d.spectrum = { type: 'generator', def: L.pcAuto(4000, 'ra80') }; d.electrical = { If: 150, Vf: 2.9, basis: 'lm', value: 115 }; if (d.tags.indexOf('white') < 0) d.tags.push('white'); } }
    else if (t === 'measured') { if (d.spectrum.type !== 'measured') { var s = A.specToSpd(d.spectrum), pts = []; for (var w = 380; w <= 780; w += 1) pts.push([w, s[w - L.WL0]]); var tmp = A.ledFromPoints(d.name, pts); d.spectrum = tmp.spectrum; } }
    render();
  }
  function field(label, input, hint) { return h('label', { class: 'fld' }, h('span', { class: 'fld-l', text: label }), input, hint ? h('span', { class: 'fld-h', text: hint }) : null); }
  function num(obj, key, o) { o = o || {}; var inp = h('input', { type: 'number', class: 'inp', step: o.step || 'any', min: o.min, max: o.max, value: obj[key] }); inp.addEventListener('input', function () { var v = parseFloat(this.value); if (isFinite(v)) { obj[key] = v; refresh(); if (o.after) o.after(); } }); return inp; }
  function slider(obj, key, min, max, step, label, unit) { var out = h('span', { class: 'sl-v' }), inp = h('input', { type: 'range', min: min, max: max, step: step, value: obj[key] }); function upd() { out.textContent = (+obj[key]).toFixed(step < 0.1 ? 2 : step < 1 ? 1 : 0) + (unit || ''); } inp.addEventListener('input', function () { obj[key] = parseFloat(this.value); upd(); refresh(); }); upd(); return h('label', { class: 'fld' }, h('span', { class: 'fld-l', text: label }), h('div', { class: 'sl' }, inp, out)); }
  function render() {
    box.innerHTML = '';
    var typeSel = h('div', { class: 'seg' }, [['gauss', 'Monochromatic (Gaussian)'], ['pc', 'Phosphor-converted white'], ['measured', 'Measured / imported']].map(function (t) { return h('button', { class: 'seg-b' + (type === t[0] ? ' on' : ''), onclick: function () { ensureType(t[0]); } }, t[1]); }));
    var nameI = h('input', { class: 'inp', value: d.name, oninput: function () { d.name = this.value; } });
    var form = h('div', { class: 'form' });
    form.appendChild(field('Name', nameI));
    form.appendChild(h('div', { class: 'row2' }, field('Manufacturer', h('input', { class: 'inp', value: d.manufacturer || '', oninput: function () { d.manufacturer = this.value; } })), field('Part number', h('input', { class: 'inp', value: d.part || '', oninput: function () { d.part = this.value; } }))));
    form.appendChild(field('Tags (comma separated)', h('input', { class: 'inp', value: (d.tags || []).join(', '), oninput: function () { d.tags = this.value.split(',').map(function (s) { return s.trim(); }).filter(Boolean); } })));
    var spec = h('div', { class: 'form spec-form' });
    if (type === 'gauss') {
      var def = d.spectrum.def; var fw = num(def, 'fwhm', { min: 2, max: 400, step: 0.5 });
      spec.appendChild(h('div', { class: 'row2' }, field('Peak wavelength (nm)', num(def, 'peak', { min: 250, max: 1000, step: 1, after: function () { } }), 'Where the emission is strongest'), field('Width FWHM (nm)', fw, 'Full width at half maximum')));
      spec.appendChild(h('div', { class: 'btnrow' }, h('button', { class: 'btn sm', onclick: function () { def.fwhm = +L.defaultFWHM(def.peak).toFixed(1); render(); } }, 'Set typical FWHM for this wavelength'), h('span', { class: 'hint', text: 'Typical: blue ≈20 nm, green ≈35 nm, amber ≈17 nm, red ≈20 nm' })));
      spec.appendChild(slider(def, 'skew', -0.5, 0.5, 0.01, 'Asymmetry (+ = longer red-side tail)', ''));
    } else if (type === 'pc') {
      var pd = d.spectrum.def, famSel = h('select', { class: 'inp' }, Object.keys(L.PC_FAMILIES).map(function (k) { return h('option', { value: k, selected: pd.auto && pd.auto.family === k }, L.PC_FAMILIES[k].label); })), cctI = h('input', { type: 'number', class: 'inp', value: pd.auto ? pd.auto.cct : 4000, min: 1800, max: 20000, step: 50 });
      function auto() { var np = L.pcAuto(+cctI.value || 4000, famSel.value, pd.pumpPeak, pd.pumpFwhm); d.spectrum.def = np; pd = np; render(); }
      spec.appendChild(h('div', { class: 'auto-box' }, h('b', null, 'Auto-fit white'), h('div', { class: 'row3' }, field('Target CCT (K)', cctI), field('Phosphor family', famSel), h('button', { class: 'btn sm', onclick: auto }, 'Solve ratios')), h('span', { class: 'hint', text: 'Solves the phosphor power ratios so the chromaticity lies on the Planckian locus (Duv = 0) at the target CCT. Or edit the bands below freely.' })));
      spec.appendChild(h('div', { class: 'row2' }, field('Blue pump peak (nm)', num(pd, 'pumpPeak', { step: 1 })), field('Pump FWHM (nm)', num(pd, 'pumpFwhm', { step: 0.5 }))));
      (pd.bands || []).forEach(function (b, i) { spec.appendChild(h('div', { class: 'band' }, h('b', null, 'Phosphor band ' + (i + 1)), h('div', { class: 'row3' }, field('Peak (nm)', num(b, 'peak', { step: 1 })), field('FWHM (nm)', num(b, 'fwhm', { step: 1 })), field('Power ratio to pump', num(b, 'ratio', { step: 0.05, min: 0 }))), h('button', { class: 'ib', title: 'Remove band', onclick: function () { pd.bands.splice(i, 1); pd.auto = null; render(); } }, '✕'))); });
      spec.appendChild(h('button', { class: 'btn sm', onclick: function () { pd.bands.push({ peak: 580, fwhm: 80, ratio: 1 }); pd.auto = null; render(); } }, '+ Add phosphor band'));
    } else {
      var sp = d.spectrum; var info = h('div', { class: 'hint', text: 'Measured spectrum: ' + sp.values.length + ' points, ' + sp.start + '–' + (sp.start + (sp.values.length - 1) * (sp.step || 1)) + ' nm (relative units, peak-normalised).' });
      spec.appendChild(info);
      spec.appendChild(h('div', { class: 'btnrow' }, h('button', { class: 'btn', onclick: function () { A.pickFile('.csv,.txt,.tsv,.json,.sp', function (txt, nm) { try { var j = null; try { j = JSON.parse(txt); } catch (e) { } var pts = null; if (j && Array.isArray(j.points)) pts = j.points.map(function (p) { return [+p.x, +p.y]; }); else if (j && j.format === A.FORMAT && j.leds && j.leds[0]) { d.spectrum = A.clone(j.leds[0].spectrum); render(); return; } else { var sp = A.parseSpectrumFile(txt, nm); if (sp) pts = sp[0].pts; } if (!pts) throw new Error('No spectrum found in the file (need two columns: wavelength nm, intensity, or an Argyll .sp file).'); var tmp = A.ledFromPoints(d.name, pts); d.spectrum = tmp.spectrum; if (!orig) d.name = nm.replace(/\.[^.]+$/, ''); render(); } catch (e) { A.toast(e.message, 'err'); } }); } }, 'Load .sp / CSV / JSON…'), h('button', { class: 'btn', onclick: function () { var ta = h('textarea', { class: 'inp', rows: 8, placeholder: 'Paste two columns: wavelength [nm], intensity\n380 0.002\n381 0.003\n…' }); var m = h('div', { class: 'modal-back top' }, h('div', { class: 'modal sm' }, h('h3', null, 'Paste spectrum'), ta, h('div', { class: 'btnrow end' }, h('button', { class: 'btn', onclick: function () { m.remove(); } }, 'Cancel'), h('button', { class: 'btn primary', onclick: function () { var pts = A.parseCSVSpectrum(ta.value); if (!pts) return A.toast('Could not parse – need at least 3 rows of "wavelength intensity".', 'err'); d.spectrum = A.ledFromPoints(d.name, pts).spectrum; m.remove(); render(); } }, 'Use')))); document.body.appendChild(m); } }, 'Paste data…')));
      spec.appendChild(h('div', { class: 'row2' }, field('Smooth (moving average, nm)', (function () { var i = h('input', { type: 'number', class: 'inp', value: 0, min: 0, max: 30 }); i.addEventListener('change', function () { var k = Math.round(+this.value); if (k < 1) return; var v = d.spectrum.values.slice(), o = v.map(function (_, j) { var s = 0, c = 0; for (var q = -k; q <= k; q++) if (v[j + q] != null) { s += v[j + q]; c++; } return +(s / c).toPrecision(5); }); d.spectrum.values = o; this.value = 0; refresh(); }); return i; })(), 'Applies once when you change the value'), field('Subtract baseline', h('button', { class: 'btn sm', onclick: function () { var v = d.spectrum.values, mn = Math.min.apply(null, v), mx = Math.max.apply(null, v) - mn || 1; d.spectrum.values = v.map(function (x) { return +((x - mn) / mx).toPrecision(5); }); refresh(); } }, 'Subtract minimum & renormalise'))));
    }
    // electrical
    var el = d.electrical = d.electrical || { If: 350, Vf: 3, basis: 'mW', value: 300 };
    var basisSel = h('select', { class: 'inp', onchange: function () { el.basis = this.value; refresh(); } }, h('option', { value: 'lm', selected: el.basis === 'lm' }, 'Luminous flux (lm)'), h('option', { value: 'mW', selected: el.basis === 'mW' }, 'Radiant flux (mW)'));
    var elec = h('div', { class: 'form' }, h('div', { class: 'row4' }, field('Test current If (mA)', num(el, 'If', { step: 1 })), field('Forward voltage Vf (V)', num(el, 'Vf', { step: 0.01 })), field('Flux given as', basisSel), field('Flux at If', num(el, 'value', { step: 'any' }))),
      h('span', { class: 'hint', text: 'Used to scale channels (flux ∝ current) and for power / efficacy figures. Datasheet values or your measurements.' }));
    form.appendChild(field('Notes', h('textarea', { class: 'inp', rows: 2, oninput: function () { d.notes = this.value; } }, d.notes || '')));
    box.appendChild(h('div', { class: 'modal-h' }, h('h3', null, orig ? 'Edit LED' : 'New LED'), h('button', { class: 'ib', onclick: close }, '✕')));
    box.appendChild(h('div', { class: 'modal-body' }, h('div', { class: 'col-l' }, typeSel, form, h('h4', null, 'Spectrum'), spec, h('h4', null, 'Electrical / rating'), elec), h('div', { class: 'col-r' }, h('h4', null, 'Preview'), prevCanvas, prevInfo)));
    box.appendChild(h('div', { class: 'modal-f' }, h('button', { class: 'btn', onclick: close }, 'Cancel'), orig ? h('button', { class: 'btn', onclick: function () { saveIt(true); } }, 'Save as copy') : null, h('button', { class: 'btn primary', onclick: function () { saveIt(false); } }, 'Save to library')));
    chart = new A.SpectrumChart(prevCanvas, previewModel); prevCanvas._lock = true;
    setTimeout(refresh, 0);
  }
  function previewModel() { var s = A.specToSpd(d.spectrum), t = L.sumAll(s) || 1; s = L.scale(s, 1 / t); var rad = (d.electrical && d.electrical.basis === 'mW' ? d.electrical.value / 1000 : 0.1) || 0.1; var abs = L.scale(s, rad); var c = A.rgb(ledDot({ id: 'p', spectrum: d.spectrum })); return { series: [{ name: d.name, y: abs, color: '#2563eb', fill: true, main: true }] }; }
  function refresh() {
    if (!chart) return; var s = A.specToSpd(d.spectrum), t = L.sumAll(s) || 1; s = L.scale(s, 1 / t);
    var abs = L.scale(s, 0.1), r = L.analyse(abs), fw = fwhmOf(s), rl = type === 'pc';
    prevInfo.innerHTML = ''; var rows = [['Peak', r.peak.wl + ' nm'], ['FWHM (measured)', fw.toFixed(1) + ' nm'], ['Centroid', r.centroid.toFixed(1) + ' nm'], ['xy (2°)', r.xy.x.toFixed(4) + ', ' + r.xy.y.toFixed(4)], ['u′v′', r.upvp.u.toFixed(4) + ', ' + r.upvp.v.toFixed(4)], r.dominant ? ['Dominant λ', (r.dominant.complementary ? '' : r.dominant.wl.toFixed(1) + ' nm') + (r.dominant.complementary ? 'c ' + r.dominant.wl.toFixed(1) + ' nm' : '') + ' (purity ' + (r.dominant.purity * 100).toFixed(0) + '%)'] : null, ['LER', r.LER.toFixed(1) + ' lm/W₀ (' + (1000 / r.LER).toFixed(2) + ' mW/lm)']].filter(Boolean);
    if (rl) rows.push(['CCT / Duv', r.cct.toFixed(0) + ' K / ' + (r.duv >= 0 ? '+' : '') + r.duv.toFixed(4)], ['CRI Ra / R9', r.cri.Ra.toFixed(1) + ' / ' + r.cri.R[8].toFixed(0)], ['TM-30 Rf / Rg', r.tm30.Rf.toFixed(1) + ' / ' + r.tm30.Rg.toFixed(1)]);
    var e = d.electrical || {}; var rad = A.ledRadW(d), lm = rad * A.ledLER(d), p = (e.Vf || 0) * (e.If || 0) / 1000; if (rad) { rows.push(['At rating', lm.toFixed(1) + ' lm, ' + (rad * 1000).toFixed(0) + ' mW']); if (p > 0) rows.push(['Efficiency', (rad / p * 100).toFixed(1) + ' % WPE' + (lm > 0.5 ? ', ' + (lm / p).toFixed(0) + ' lm/W' : '')]); }
    rows.forEach(function (rw) { prevInfo.appendChild(h('div', { class: 'kv' }, h('span', { text: rw[0] }), h('b', { text: rw[1] }))); });
    chart.render();
  }
  function close() { back.remove(); window.removeEventListener('resize', refresh); document.removeEventListener('keydown', onKey); }
  function onKey(e) { if (e.key === 'Escape' && !document.querySelector('.modal-back.top')) close(); }
  function saveIt(asCopy) {
    if (!d.name.trim()) return A.toast('Please give the LED a name', 'err');
    var out = A.clone(d); out.created = out.created || Date.now(); out.modified = Date.now();
    if (asCopy || !orig) { if (asCopy) { out.id = A.uid(); } A.library.push(out); } else { A.library[A.library.indexOf(orig)] = out; }
    A.ui.selected = out.id; A.save(); A.emit(); close(); A.toast('Saved "' + out.name + '"');
  }
  document.body.appendChild(back); document.addEventListener('keydown', onKey); window.addEventListener('resize', refresh); render();
}
A.openEditor = openEditor;

/* ================= MIX PANEL ================= */
function buildMix(root) {
  var body = h('div', { class: 'mix-body' });
  root.appendChild(h('div', { class: 'card-h' }, h('h2', null, 'Mix / luminaire'), h('div', { class: 'grow' }), h('input', { class: 'inp name-inp', value: A.mix.name, title: 'Name of the mix', oninput: function () { A.mix.name = this.value; A.save(); A.emit(true); } })));
  root.appendChild(body);
  function render() {
    body.innerHTML = '';
    if (!A.mix.channels.length) { body.appendChild(h('div', { class: 'empty', text: 'No channels yet – add LEDs from the library with ＋.' })); }
    else {
      var tbl = h('table', { class: 'tbl mixt' }, h('thead', null, h('tr', null, ['', 'LED', 'Qty', 'mA', '%', 'lm', ''].map(function (t) { return h('th', { text: t }); }))));
      var tb = h('tbody'), info = A.mixSpd(A.mix).info;
      A.mix.channels.forEach(function (ch, i) {
        var led = A.findLed(ch.ledId), inf = info[i] || {};
        var tr = h('tr', { class: ch.enabled === false ? 'off' : '' });
        tr.appendChild(h('td', null, h('input', { type: 'checkbox', checked: ch.enabled !== false, title: 'Enable channel', onchange: function () { ch.enabled = this.checked; A.save(); A.emit(); } })));
        tr.appendChild(h('td', { class: 'nm' }, led ? [h('span', { class: 'dot', style: { background: A.rgb(ledDot(led)) } }), ' ' + led.name] : h('i', { text: '(missing LED)' })));
        function ni(key, w, step) { var inp = h('input', { type: 'number', class: 'inp sm', step: step || 'any', min: 0, value: ch[key] == null ? '' : ch[key], style: { width: w } }); inp.addEventListener('input', function () { ch[key] = this.value === '' ? null : parseFloat(this.value); A.save(); A.emit(true); }); return inp; }
        tr.appendChild(h('td', null, ni('qty', '48px', 1))); tr.appendChild(h('td', null, ni('I', '56px', 1)));
        tr.appendChild(h('td', null, (function () { var inp = h('input', { type: 'number', class: 'inp sm', step: 1, min: 0, value: Math.round((ch.scale == null ? 1 : ch.scale) * 100), style: { width: '50px' }, title: 'Extra dimming multiplier (%)' }); inp.addEventListener('input', function () { ch.scale = parseFloat(this.value) / 100; if (!isFinite(ch.scale)) ch.scale = 1; A.save(); A.emit(true); }); return inp; })()));
        tr.appendChild(h('td', { class: 'num', text: inf.led ? fmt(inf.lm, inf.lm >= 100 ? 0 : 1) : '–' }));
        tr.appendChild(h('td', null, h('button', { class: 'ib', title: 'Remove', onclick: function () { A.mix.channels.splice(i, 1); A.save(); A.emit(); } }, '✕')));
        tb.appendChild(tr);
      });
      tbl.appendChild(tb); body.appendChild(tbl);
    }
    var add = h('select', { class: 'inp', onchange: function () { if (!this.value) return; var led = A.findLed(this.value); A.mix.channels.push({ id: A.uid(), ledId: led.id, qty: 1, I: (led.electrical && led.electrical.If) || '' }); A.source = 'mix'; A.save(); A.emit(); } }, h('option', { value: '' }, '+ Add channel…'), A.library.map(function (l) { return h('option', { value: l.id }, l.name); }));
    body.appendChild(h('div', { class: 'mix-f' }, add, h('button', { class: 'btn sm', onclick: function () { A.mix.channels = []; A.save(); A.emit(); } }, 'Clear'),
      h('span', { class: 'hint', text: 'Flux scales linearly with current relative to the LED’s rated If (droop/thermal effects are not modelled).' })));
  }
  A.on(function () { if (!A._typing) render(); }); render();
  // light-weight update for typing: update computed cells without re-render
  var origEmit = A.emit; A.emit = function (typing) { A._typing = !!typing; try { origEmit(); } finally { A._typing = false; } if (typing === true) { /* refresh numbers only */ var info = A.mixSpd(A.mix).info, rows = body.querySelectorAll('tbody tr'); info.forEach(function (inf, i) { var tr = rows[i]; if (!tr) return; var tds = tr.querySelectorAll('td.num'); if (tds[0]) tds[0].textContent = inf.led ? fmt(inf.lm, inf.lm >= 100 ? 0 : 1) : '–'; }); } };
}
A.buildMix = buildMix;
})();
