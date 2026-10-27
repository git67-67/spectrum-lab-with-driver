"""Apply the small hooks the measurement feature needs to the original LED Spectrum Lab modules.
Every replacement must match exactly once, otherwise the build stops."""
import sys, pathlib
SRC = pathlib.Path('src'); OUT = pathlib.Path('build'); OUT.mkdir(exist_ok=True)

def patch(name, pairs):
    t = (SRC / name).read_text(encoding='utf-8')
    for old, new in pairs:
        n = t.count(old)
        if n != 1:
            sys.exit('PATCH FAILED in %s (%d matches): %s' % (name, n, old[:90]))
        t = t.replace(old, new)
    (OUT / name).write_text(t, encoding='utf-8')

# ---- ui1: separate UI-state keys per page; the measure page must never overwrite the library / mix
patch('ui1_state.js', [
 ("var S = window.APP = {\n  library: [], curves: [],",
  "var S = window.APP = {\n  page: window.LSL_PAGE || 'lab',\n  library: [], curves: [],"),
 ("var lib = store('lsl.library.v1'), mix = store('lsl.mix.v1'), cur = store('lsl.curves.v1'), ui = store('lsl.ui.v1');",
  "var lib = store('lsl.library.v1'), mix = store('lsl.mix.v1'), cur = store('lsl.curves.v1'), ui = store(S.page === 'measure' ? 'lsl.ui.m.v1' : 'lsl.ui.v1');"),
 ("function save() { clearTimeout(saveT); saveT = setTimeout(function () { store('lsl.library.v1', S.library); store('lsl.mix.v1', S.mix); store('lsl.curves.v1', S.curves); store('lsl.ui.v1', {",
  "function save() { clearTimeout(saveT); saveT = setTimeout(function () { if (S.page !== 'measure') { store('lsl.library.v1', S.library); store('lsl.mix.v1', S.mix); store('lsl.curves.v1', S.curves); } store(S.page === 'measure' ? 'lsl.ui.m.v1' : 'lsl.ui.v1', {"),
])

# ---- ui2: per-chart option object and axis labels for irradiance data
patch('ui2_charts.js', [
 ("var m = getModel(), o = A.ui.spec, c = setupCanvas(canvas), g = c.g, W = c.w, H = c.h, v = view();",
  "var m = getModel(), o = (m && m.opts) || A.ui.spec, c = setupCanvas(canvas), g = c.g, W = c.w, H = c.h, v = view();"),
 ("    g.restore();\n    // legend", "    g.restore();\n    if (A.drawLabels) { try { A.drawLabels(g, data, o, { X: X, Y: Y, padL: padL, padT: padT, pw: pw, ph: ph, v: v, fg: fg, mut: mut, bg: bg }); } catch (e) { console.error(e); } }\n    // legend"),
 ("}\nA.drawBars = drawBars;", "  if (o.values2) o.values2.forEach(function (v, i) { if (v == null) return; var x = padL + i * bw + bw * 0.02, w = bw * 0.96, y = Y(Math.max(mn, Math.min(mx, v))); g.strokeStyle = bgc; g.lineWidth = 5; g.beginPath(); g.moveTo(x, y); g.lineTo(x + w, y); g.stroke(); g.strokeStyle = fg; g.lineWidth = 2.4; g.setLineDash([]); g.beginPath(); g.moveTo(x, y); g.lineTo(x + w, y); g.stroke(); g.fillStyle = fg; g.beginPath(); g.moveTo(x + w / 2, y - 4); g.lineTo(x + w / 2 + 4, y); g.lineTo(x + w / 2, y + 4); g.lineTo(x + w / 2 - 4, y); g.closePath(); g.fill(); });\n}\nA.drawBars = drawBars;"),
 ("var c = setupCanvas(canvas), g = c.g, W = c.w, H = c.h, fg = cv('--fg'), mut = cv('--muted'), grid = cv('--grid');\n  g.clearRect(0, 0, W, H); var n = o.values.length,", "var c = setupCanvas(canvas), g = c.g, W = c.w, H = c.h, fg = cv('--fg'), mut = cv('--muted'), grid = cv('--grid'), bgc = cv('--panel');\n  g.clearRect(0, 0, W, H); var n = o.values.length,"),
 ("function drawCVG(canvas, tm, binColors) {", "function drawCVG(canvas, tm, binColors, tm2) {"),
 ("}\nA.drawCVG = drawCVG;", "  if (tm2 && tm2.cvg) { var q2 = tm2.cvg.map(function (p) { return p ? [cx + p.tx * sc, cy - p.ty * sc] : null; }).filter(Boolean); g.beginPath(); q2.forEach(function (p, i) { if (i) g.lineTo(p[0], p[1]); else g.moveTo(p[0], p[1]); }); g.closePath(); g.setLineDash([7, 4]); g.strokeStyle = '#2563eb'; g.lineWidth = 2.2; g.stroke(); g.setLineDash([]); q2.forEach(function (p) { g.beginPath(); g.arc(p[0], p[1], 3, 0, 7); g.fillStyle = '#2563eb'; g.fill(); }); }\n}\nA.drawCVG = drawCVG;"),
 ("else if (o.yMode === 'photon') ylab = 'Photon flux (µmol s⁻¹ nm⁻¹)';",
  "else if (o.yMode === 'photon') ylab = 'Photon flux (µmol s⁻¹ nm⁻¹)';\n    if (m.ylabs && m.ylabs[o.yMode]) ylab = m.ylabs[o.yMode];"),
])

# ---- ui4: source hooks, labels, page-dependent shell
patch('ui4_tabs.js', [
 ("var a = L.analyse(s.spd, { Ev: +A.mix.Ev || 500 });", "var a = L.analyse(s.spd, { Ev: s.Ev ? +s.Ev.toPrecision(5) : (+A.mix.Ev || 500) });"),
 ("  return { series: series };\n}", "  return { series: series, ylabs: R.src.irr ? { abs: 'Spectral irradiance (mW m⁻² nm⁻¹)', photon: 'Photon flux density (µmol m⁻² s⁻¹ nm⁻¹)' } : null };\n}"),
 ("kpi('Luminous flux', fmt(a.lumens, a.lumens >= 100 ? 0 : 1), 'lm', 'photopic 2°'), kpi('Radiant flux', fmt(a.radiantW * 1000, a.radiantW >= 0.1 ? 0 : 1), 'mW', fmt(a.WperLm * 1000, 2) + ' mW/lm'),",
  "R.src.irr ? kpi('Illuminance', fmt(a.lumens, a.lumens >= 100 ? 0 : 1), 'lx', 'photopic 2°') : kpi('Luminous flux', fmt(a.lumens, a.lumens >= 100 ? 0 : 1), 'lm', 'photopic 2°'), R.src.irr ? kpi('Irradiance', fmt(a.radiantW * 1000, a.radiantW >= 0.1 ? 0 : 1), 'mW/m²', fmt(a.WperLm * 1000, 2) + ' mW/lm') : kpi('Radiant flux', fmt(a.radiantW * 1000, a.radiantW >= 0.1 ? 0 : 1), 'mW', fmt(a.WperLm * 1000, 2) + ' mW/lm'),"),
 ("kpi('PPF', a.photon.ppf.toFixed(2), 'µmol/s', 'ePAR '", "kpi(R.src.irr ? 'PPFD' : 'PPF', a.photon.ppf.toFixed(2), R.src.irr ? 'µmol/m²/s' : 'µmol/s', 'ePAR '"),
 ("if (R.src.power == null) warn.push('Some LEDs have no Vf / If, so electrical power and efficacy are unavailable.');",
  "if (R.src.power == null && !R.src.meas) warn.push('Some LEDs have no Vf / If, so electrical power and efficacy are unavailable.'); (R.src.notes || []).forEach(function (n) { warn.push(n); });"),
 ("var g = h('optgroup', { label: 'Single LED' }); A.library.forEach(function (l) { g.appendChild(h('option', { value: l.id }, l.name)); }); srcSel.appendChild(g); srcSel.value = A.findLed(keep1) || keep1 === 'mix' ? keep1 : 'mix';",
  "var g = h('optgroup', { label: 'Single LED' }); A.library.forEach(function (l) { g.appendChild(h('option', { value: l.id }, l.name)); }); srcSel.appendChild(g); if (A.measSelectorOptions) A.measSelectorOptions(srcSel); srcSel.value = (A.sourceValid ? A.sourceValid(keep1) : (A.findLed(keep1) || keep1 === 'mix')) ? keep1 : (A.defaultSource || 'mix'); if (srcSel.value !== keep1) { A.source = srcSel.value; }"),
 ("cmpSel.appendChild(g2); cmpSel.value = keep2;", "cmpSel.appendChild(g2); if (A.measCompareOptions) A.measCompareOptions(cmpSel); cmpSel.value = keep2;"),
 ("A.init = init; A.tabs = tabs;", "A.init = init; A.tabs = tabs; A.setTab = setTab; A.refreshAll = refreshAll; A.fmtRatio = fmtRatio; A.kpi = kpi; A.table = table; A.sgn = sgn; A.otherScaled = otherScaled; A.sw = sw; A.chk = chk;"),
 ("  R = { src: s, a: a };", "  R = { src: s, a: a }; A.R = R;"),
 ("{ R = null; return; }", "{ R = null; A.R = null; return; }"),
 ("function init() {\n  A.load();", "function init() {\n  if (A.tabOrder) order = A.tabOrder.slice();\n  A.load();"),
 ("h('small', null, 'add · mix · analyse')", "h('small', null, A.page === 'measure' ? 'live measurement' : 'add · mix · analyse')"),
 ("}, 'Theme'));\n  var side", "}, 'Theme'), A.headerExtras ? A.headerExtras() : null);\n  var side"),
 ("if (!tabs[A.tab]) A.tab = 'overview';", "if (!tabs[A.tab] || order.indexOf(A.tab) < 0) A.tab = 'overview';"),
 ("Nothing to analyse yet – add LEDs to the mix (＋ in the library) or pick a single LED as the source.", "' + (A.page === 'measure' ? 'No measurement yet – connect the i1 Pro (or press Demo), do the dark calibration and press Measure.' : 'Nothing to analyse yet – add LEDs to the mix (＋ in the library), pick a single LED or a measured group as the source.') + '"),
 ("A.buildLibrary(libCard); A.buildMix(mixCard);", "if (A.buildSide) A.buildSide(side, libCard, mixCard); else { A.buildLibrary(libCard); A.buildMix(mixCard); }"),
])
print('patched')
