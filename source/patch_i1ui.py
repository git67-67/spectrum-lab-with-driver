#!/usr/bin/env python3
"""Adapt the original i1 Pro console (i1pro/i1pro-ui.orig.js + measure-view.orig.html) so it can live as the "Instrument"
tab of measure.html. Every replacement must match exactly once. Output goes to build/."""
import pathlib, re
root = pathlib.Path(__file__).resolve().parent
(root / 'build').mkdir(exist_ok=True)

def sub(src, old, new, label, count=1):
    n = src.count(old)
    assert n == count, '%s: expected %d match(es), found %d' % (label, count, n)
    return src.replace(old, new)

js = (root / 'i1pro/i1pro-ui.orig.js').read_text(encoding='utf-8')
# 1. boot lazily instead of at load (the markup is created by the host page)
js = sub(js, "(function () {\n  'use strict';\n  const g = id =>", "window.I1P_boot = function () {\n  'use strict';\n  const g = id =>", 'wrap-open')
assert js.rstrip().endswith('})();')
js = js.rstrip()[:-5] + '};\n'
# 2. status line also reports to the host
js = sub(js, "function status(msg, cls) { const s = g('i1p-status'); s.textContent = msg; s.className = 'status ' + (cls || ''); }",
         "function status(msg, cls) { const s = g('i1p-status'); s.textContent = msg; s.className = 'status ' + (cls || ''); if (window.I1P_onStatus) { try { window.I1P_onStatus(msg, cls || ''); } catch (e) { } } }", 'status')
js = sub(js, "for (const id of BUSYIDS) g(id).disabled = b; if (!b) { eeButtons(); } }", "for (const id of BUSYIDS) g(id).disabled = b; if (!b) { eeButtons(); } if (window.I1P_onBusy) { try { window.I1P_onBusy(b); } catch (e) { } } }", 'busy')
# 3. the instrument's own button
js = sub(js, "if (!isSim) dev.onButton(() => { if (g('i1p-btn').checked) {", "if (!isSim) dev.onButton(() => { if (g('i1p-btn').checked) { if (window.I1P_onButton && window.I1P_onButton()) return;", 'button')
# 4. live readings go to the lab's live view
js = sub(js, "pushHist(a, m); g('i1p-snap').disabled = false; drawMain(); renderDetail();",
         "pushHist(a, m); g('i1p-snap').disabled = false; drawMain(); renderDetail(); if (window.I1P_onLive) { try { window.I1P_onLive(a); } catch (e) { console.error(e); } }", 'live')
js = sub(js, "live = had ? live : null; g('i1p-snap').disabled = !live; liveOn = false; renderAll();",
         "live = had ? live : null; g('i1p-snap').disabled = !live; liveOn = false; renderAll(); if (window.I1P_onLiveEnd) { try { window.I1P_onLiveEnd(); } catch (e) { } }", 'liveend')
# 5. "library" = the active group of the lab
js = sub(js, "  function toLibrary(list, quiet) {\n    let nl = 0, np = 0, bad = 0;",
         "  function toLibrary(list, quiet) {\n    if (window.I1P_toGroup) { const r = window.I1P_toGroup(list); for (const m of list) if (r.ids[m.id]) m.libId = r.ids[m.id]; renderAll(); persistSoon(); if (!quiet) note(r.msg, r.err ? 'err' : 'ok'); return; }\n    let nl = 0, np = 0, bad = 0;", 'toLibrary')
# 6. the host page has no colour-map tab
js = sub(js, "if (location.hash === '#measure') showTab('meas');\n", "", 'hash')
js = sub(js, "if (typeof TABS !== 'undefined') { TABS.meas = { view: 'view-meas', btn: 't-meas', hash: '#measure' }; g('t-meas').onclick = () => showTab('meas'); }\n", "", 'tabs')
js = sub(js, "else if (b.dataset.act === 'map') { if (m.libId) { st.libId = m.libId; st.src = 'lib'; showTab('map'); recompute(); } }",
         "else if (b.dataset.act === 'map') { if (window.I1P_showShot) window.I1P_showShot(m); }", 'map')
# 7. one resampled 1 nm spectrum (380-730) in the chosen kernel, for the lab's analysis
js = sub(js, "  /* ---------- derived numbers: brightness, power, colour, peaks ---------- */",
"""  /* the spectrum the lab analyses: the user's kernel and calibrations on a 1 nm grid, 380-730 nm */
  function lab1nm(m) {
    const P = activePreset(), c = calFor(m.eeId); if (!c || m.kind !== 'em') return null;
    const base = P.id === 'std10' ? { kernel: 'factory', widthScale: 1, interp: 'lagrange' } : Object.assign({}, P.opts);
    const o = Object.assign({}, base, { lo: 380, hi: 730, step: 1 });
    if (P.opts.kernel === 'argyll') o.argyllWidth = P.opts.fwhm > 0 ? P.opts.fwhm : P.opts.step;
    o.corr = (m.corr || m.absK) ? Float64Array.from({ length: 36 }, (_, i) => (m.corr ? m.corr[i] : 1) * (m.absK || 1)) : null;
    const rs = I1Pro.buildResampler(c.cal, c.fits, o);
    return { v: Float32Array.from(rs.apply(Float64Array.from(m.avgAbs)), x => Math.max(0, x)), kernel: P.id === 'std10' ? 'factory (36 bands, interpolated to 1 nm)' : P.label + ' / ' + (o.kernel || '') };
  }
  /* the same for a raw result (live readings): uses the device's current corrections */
  function liveLab1nm(r) {
    const P = activePreset(); const base = P.id === 'std10' ? { kernel: 'factory', widthScale: 1, interp: 'lagrange' } : Object.assign({}, P.opts);
    const o = Object.assign({}, base, { lo: 380, hi: 730, step: 1 }); if (P.opts.kernel === 'argyll') o.argyllWidth = P.opts.fwhm > 0 ? P.opts.fwhm : P.opts.step;
    return Float32Array.from(dev.resampler(o).apply(r.avgAbs), x => Math.max(0, x));
  }

  /* ---------- derived numbers: brightness, power, colour, peaks ---------- */""", 'lab1nm')
# 8. expose an API for the host
js = sub(js, "  shown(false); renderAll(); loadSaved();\n",
"""  window.I1P_api = {
    get dev() { return dev; }, get sim() { return sim; }, get busy() { return busy; }, get mode() { return mode; }, get liveOn() { return liveOn; },
    setBusy, status, note, mopts, activePreset, procSpectrum, makeMeasurement, warnings, calFor, lab1nm, liveLab1nm, absUi, corrUi, infoPanel, chips, exposureUi,
    doMeasure, renderAll, refreshAll, MS, EE, lstore, nextName, uniqueName, addMeasurement, shortRes, explain, num: id => num(id, 0)
  };
  shown(false); renderAll(); loadSaved();
""", 'api')

# 9. a physically consistent demo instrument: the pixels respond to the light the way the factory calibration assumes
js = sub(js, "g('i1p-demo').onclick = async () => { sim = new I1ProSim.SimTransport({ eepromB64: window.I1P_DEMO_EEPROM, level: 20000, speed: 0.15 }); await attach(sim, true); };",
"""function physicalSim(s) {
    const rs = I1Pro.buildResampler(s.cal, I1Pro.fitAllBands(s.cal), { lo: 380, hi: 730, step: 1, kernel: 'factory' }), flat = rs.apply(Float64Array.from({ length: 128 }, () => 1));
    let mean = 0; for (const x of flat) mean += x / flat.length;
    s.o.sens = nm => { const k = Math.min(350, Math.max(0, nm - 380)), i = Math.floor(k), f = k - i; return mean / (flat[i] * (1 - f) + flat[Math.min(350, i + 1)] * f); };
  }
  g('i1p-demo').onclick = async () => { sim = new I1ProSim.SimTransport({ eepromB64: window.I1P_DEMO_EEPROM, level: 20000, speed: 0.15 }); physicalSim(sim); await attach(sim, true); };""", 'demo')
# 10. a preset for narrow LED lines, and the default
js = sub(js, "  const PRE = I1Pro.RES_PRESETS;\n", "  const PRE = I1Pro.RES_PRESETS;\n  if (!PRE.some(p => p.id === 'narrow1')) PRE.splice(3, 0, { id: 'narrow1', label: 'LED lines: 1 nm, ArgyllCMS interpolation (narrowest, recommended for LED spectra)', opts: { lo: 380, hi: 730, step: 1, kernel: 'argyll', argyllWidth: 1 } });\n", 'preset')
js = sub(js, "    else t += 'Finer than the sensor pixel spacing", "    else if (p.id === 'narrow1') t += 'Cubic interpolation of the 128 pixels with a 1 nm triangle: no extra smoothing, so narrow LED lines keep the width the optics give them (about 10 nm for a 5 nm line) and their colour coordinates stay closest to the truth. Noise is the same as with the wider kernels.';\n    else t += 'Finer than the sensor pixel spacing", 'presetnote')
js = sub(js, "    loadPrefs(); resUi(); exposureUi(); srcUi();", "    if (!lstore.get('i1p-prefs')) g('i1p-res').value = 'narrow1';\n    loadPrefs(); resUi(); exposureUi(); srcUi();", 'defpreset')
js = sub(js, "if (P.opts.kernel === 'argyll') o.argyllWidth = P.opts.fwhm > 0 ? P.opts.fwhm : P.opts.step;\n    o.corr", "if (P.opts.kernel === 'argyll') o.argyllWidth = P.opts.argyllWidth || (P.opts.fwhm > 0 ? P.opts.fwhm : P.opts.step);\n    o.corr", 'w1')
js = sub(js, "if (P.opts.kernel === 'argyll') o.argyllWidth = P.opts.fwhm > 0 ? P.opts.fwhm : P.opts.step;\n    return Float32Array", "if (P.opts.kernel === 'argyll') o.argyllWidth = P.opts.argyllWidth || (P.opts.fwhm > 0 ? P.opts.fwhm : P.opts.step);\n    return Float32Array", 'w2')
js = sub(js, "p.id === 'hires3' ? '3.33 nm' : p.id === 'fine1' ? '1 nm' :", "p.id === 'hires3' ? '3.33 nm' : p.id === 'fine1' ? '1 nm' : p.id === 'narrow1' ? '1 nm LED lines' :", 'short')
# 11. automatic peak and valley labels (the lab's extrema finder), also for the live trace
js = sub(js, "      if (isSel && kind === 'em' && m.metrics && m.metrics.peaks) markers = peakMarkers(m.metrics.peaks, s, norm);",
         "      if (isSel && kind === 'em') markers = autoMarkers(s, norm, m.metrics && m.metrics.peaks, [m.name]);", 'mk1')
js = sub(js, "    if (live && liveOn && g('i1p-inst').checked && live.inst)", "    if (live && liveOn) markers = autoMarkers(live.spec, norm, live.m && live.m.peaks);\n    if (live && liveOn && g('i1p-inst').checked && live.inst)", 'mk2')
js = sub(js, "  function peakMarkers(peaks, s, norm) {", """  function autoMarkers(s, norm, fallbackPeaks) {
    const n = Math.max(0, Math.floor(num('i1p-pkn', 6))); if (!n) return [];
    if (!(window.APP && window.APP.extrema)) return fallbackPeaks ? peakMarkers(fallbackPeaks, s, norm) : [];
    const w0 = Math.ceil(s.wl[0]), w1 = Math.floor(s.wl[s.wl.length - 1]), y = []; let j = 0, mx = Math.max(...s.v) || 1;
    for (let w = w0; w <= w1; w++) { while (j < s.wl.length - 2 && s.wl[j + 1] < w) j++; const t = (s.wl[j + 1] - s.wl[j]) ? (w - s.wl[j]) / (s.wl[j + 1] - s.wl[j]) : 0; y.push(Math.max(0, s.v[j] + (s.v[j + 1] - s.v[j]) * t)); }
    const e = window.APP.extrema(y, w0, w0, w1, { n, prom: num('i1p-pkp', 8), sep: 8, smooth: 3, valleys: g('i1p-pkv').checked }), out = [];
    for (const p of e.peaks) out.push({ x: p.nm, y: norm ? p.y / mx : p.y, text: p.nm.toFixed(1) + ' nm' });
    for (const p of e.valleys) out.push({ x: p.nm, y: norm ? p.y / mx : p.y, text: '▾ ' + p.nm.toFixed(1) + ' nm' });
    return out;
  }
  function peakMarkers(peaks, s, norm) {""", 'automarkers')
js = sub(js, "for (const id of ['i1p-pkn', 'i1p-pkp']) g(id).onchange = () => renderAll();", "for (const id of ['i1p-pkn', 'i1p-pkp', 'i1p-pkv']) g(id).onchange = () => renderAll();", 'pkchg')
js = sub(js, "'i1p-pkn', 'i1p-pkp', 'i1p-inst',", "'i1p-pkn', 'i1p-pkp', 'i1p-pkv', 'i1p-inst',", 'prefs')
# 12. compare kernels on the selected measurement
js = sub(js, "  g('i1p-res').onchange = () => { resUi(); refreshAll(); };", """  g('i1p-kcmp').onclick = () => {
    const m = MS.list.find(x => x.id === MS.sel), out = g('i1p-kcmpn');
    if (!m || m.kind !== 'em') { out.textContent = 'Select a light measurement in the table first.'; return; }
    const c = calFor(m.eeId); if (!c) { out.textContent = 'The calibration of that measurement is not available.'; return; }
    const K = [['factory (36 bands)', { kernel: 'factory' }], ['ArgyllCMS 1 nm', { kernel: 'argyll', argyllWidth: 1 }], ['ArgyllCMS 3.33 nm', { kernel: 'argyll', argyllWidth: 10 / 3 }], ['sinc 5 nm', { kernel: 'sinc', fwhm: 5 }], ['Gaussian 8 nm', { kernel: 'gaussian', fwhm: 8 }]];
    const corr = (m.corr || m.absK) ? Float64Array.from({ length: 36 }, (_, i) => (m.corr ? m.corr[i] : 1) * (m.absK || 1)) : null, css = getComputedStyle(document.documentElement), ser = [], rows = [];
    K.forEach(([name, o], i) => {
      const rs = I1Pro.buildResampler(c.cal, c.fits, Object.assign({ lo: 380, hi: 730, step: 1, interp: 'lagrange', widthScale: 1, corr }, o)), wl = Array.from(rs.wl), v = Array.from(rs.apply(Float64Array.from(m.avgAbs))), mx = Math.max(...v), ip = v.indexOf(mx);
      let l = ip, r = ip; while (l > 0 && v[l] > mx / 2) l--; while (r < v.length - 1 && v[r] > mx / 2) r++;
      let area = 0; for (const x of v) area += x; const mn = Math.min(...v);
      ser.push({ x: wl, y: g('ms-norm').checked ? v.map(x => x / mx) : v, color: css.getPropertyValue('--k' + (i + 1)).trim() || '#2a78d6', width: 1.6, name });
      rows.push(name + ': peak ' + wl[ip] + ' nm, width of the main peak ' + (r - l) + ' nm, power ' + (area * 1).toPrecision(4) + (mn < -0.005 * mx ? ', negative lobes ' + (100 * mn / mx).toFixed(1) + '%' : ''));
    });
    spTitle = 'kernel comparison of ' + m.name; g('ms-title').textContent = 'Kernel comparison'; g('ms-legend').innerHTML = ser.map(s => '<span><i class="dot" style="background:' + s.color + '"></i>' + esc(s.name) + '</span>').join('');
    spPlot.set(ser, [], [380, 730]); out.innerHTML = rows.map(esc).join('<br>') + '<br><i>Click a row of the table to go back. Narrow lines show the difference; for broad spectra all kernels agree.</i>';
  };
  g('i1p-res').onchange = () => { resUi(); refreshAll(); };""", 'kcmp')

js = sub(js, "(m.kind === 'rf' ? 'Add to Artist pigments' : 'Add to library')", "(m.kind === 'rf' ? 'Pigments stay here' : 'Add to active group')", 'lib1')
js = sub(js, "(m.libId ? '<span class=\"chip\">in library</span>' : '')", "(m.libId ? '<span class=\"chip\">in group</span>' : '')", 'lib2')
js = sub(js, "<button class=\"btn sm\" data-act=\"map\"' + (m.libId ? '' : ' disabled') + '>Use in colour map</button>", "<button class=\"btn sm\" data-act=\"map\">Analyse ▸</button>", 'lib3')
(root / 'build/i1pro-ui.js').write_text(js, encoding='utf-8')

# ---- markup ----
v = (root / 'i1pro/measure-view.orig.html').read_text(encoding='utf-8')
v = v.replace('class="panel', 'class="mpanel').replace('class="side"', 'class="mside"').replace('class="grid"', 'class="mgrid"')
v = sub(v, '<div id="view-meas" hidden>', '<div id="view-meas">', 'view-open')
v = sub(v, '<input type="checkbox" id="i1p-auto"> Also add every measurement to the library automatically', '<input type="checkbox" id="i1p-auto" checked> Also add every measurement made here to the active group of the lab', 'auto')
v = sub(v, '<button class="btn sm" id="ms-tolib">Add to library</button>', '<button class="btn sm" id="ms-tolib" title="Adds the ticked light measurements as shots to the active group">Add to active group</button>', 'tolib')
v = v.replace('Add to library</button>', 'Add to active group</button>')
v = re.sub(r'<p class="intro">.*?</p>', '<p class="intro">Full instrument console: every calibration, resolution and kernel setting of the original i1 Pro tool. Measurements taken on the left of the measure page (and, with the box in Advanced settings ticked, those taken here) use these settings and go into the active group.</p>', v, count=1, flags=re.S)

v = sub(v, '<p class="note" id="i1p-resnote"></p>', '<p class="note" id="i1p-resnote"></p>\n            <div class="row"><button class="btn sm" id="i1p-kcmp" title="Draws the selected measurement with five different kernels">Compare kernels on the selected measurement</button></div><p class="note" id="i1p-kcmpn"></p>', 'kcmp-html')
v = sub(v, '<label>Peak prominence (% of max) <input type="number" id="i1p-pkp" value="8" min="1" max="60" step="1"></label>', '<label>Peak prominence (% of max) <input type="number" id="i1p-pkp" value="8" min="1" max="60" step="1"></label>\n              <label class="chk"><input type="checkbox" id="i1p-pkv"> Also label valleys (▾)</label>', 'pkv-html')
(root / 'build/measure-view.html').write_text(v, encoding='utf-8')
print('i1 ui patched', len(js), len(v))
