/* i1pro-ui.js - the "Measure" tab: connect an i1 Pro, calibrate, measure, and manage the measurements in a table.
   Needs i1pro-core.js (I1Pro), i1pro-plot.js (I1ProPlot), optionally i1pro-sim.js (I1ProSim, demo mode), and the host page's own
   functions: ledMake / ledPut / cleanLED / ledChanged / ledSaveSoon / ldSelect (illuminant library), setKind / addFilter / usSaveSoon /
   recompute / showTab / st (colour map and pigments), CMF_TAB, kvOpen / kvPut (storage). */
(function () {
  'use strict';
  const g = id => document.getElementById(id);
  const root = g('view-meas'); if (!root) return;
  const { Plot, fmtN, THEME } = window.I1ProPlot;
  let dev = null, sim = null, busy = false, liveOn = false, stopFlag = false, pendingBtn = false, mode = 'em', colorN = 0, seq = 0;
  let origEE = null, srcMeta = null, userRef = null, live = null, hist = [];
  const MS = { list: [], sel: null, checked: new Set() }, EE = {}, calCache = new Map();
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const num = (id, d) => { const v = parseFloat(g(id).value); return isFinite(v) ? v : d; };
  const kv = (k, v) => '<div class="kv"><span>' + k + '</span><b>' + v + '</b></div>';
  const lstore = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) { } } };
  const sig = (a, d) => Array.from(a, x => +(+x).toPrecision(d || 7));
  function download(name, data, type) {
    const a = document.createElement('a'), u = URL.createObjectURL(new Blob([data], { type: type || 'application/octet-stream' }));
    a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 3000);
  }
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const timeStr = t => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const ago = t => { const s = (Date.now() - t) / 1000; return s < 90 ? Math.round(s) + ' s ago' : Math.round(s / 60) + ' min ago'; };

  /* ---------- environment, status ---------- */
  const envEl = g('i1p-env');
  if (!I1Pro.WebUSBTransport.supported()) envEl.innerHTML = '<b>This browser has no WebUSB.</b> Open the page in Chrome, Edge or another Chromium browser to use a real instrument. The demo works everywhere.';
  else if (!window.isSecureContext) envEl.innerHTML = '<b>WebUSB needs a secure page</b> (https:// or a file opened from disk). The demo still works.';
  else envEl.textContent = 'Plug the i1 Pro straight into a USB port (not a hub) and close spotread/ArgyllCMS first: only one program can own the instrument.';
  function status(msg, cls) { const s = g('i1p-status'); s.textContent = msg; s.className = 'status ' + (cls || ''); }
  function note(msg, cls) { const s = g('ms-msg'); s.textContent = msg; s.className = 'status ' + (cls || ''); }
  const BUSYIDS = ['i1p-dark', 'i1p-meas', 'i1p-white', 'i1p-connect', 'i1p-demo', 'i1p-disc', 'i1p-rcal', 'i1p-acal', 'i1p-badd', 'i1p-bfit', 'i1p-eeload', 'i1p-eereset', 'i1p-live', 'i1p-m-em', 'i1p-m-rf'];
  function setBusy(b) { busy = b; for (const id of BUSYIDS) g(id).disabled = b; if (!b) { eeButtons(); } }
  function shown(c) { g('i1p-ctl').hidden = !c; g('i1p-disc').hidden = !c; g('i1p-connect').hidden = c; g('i1p-demo').hidden = c; }
  function explain(e) {
    const m = e && e.message || String(e);
    if (e && e.name === 'NotFoundError') return 'No instrument chosen.';
    if (/Access denied|SecurityError|claimInterface|Unable to claim/i.test(m)) return 'The system refused access to the USB device. Add a udev rule (Linux setup, in Advanced settings), re-plug the instrument and close spotread.';
    if (e && (e.code === 'TIMEOUT' || e.code === 'RECOVER')) return m + ' Advanced settings → Instrument info → "Copy diagnostic log" has the details.';
    return m;
  }

  /* ---------- preferences (kept in this browser) ---------- */
  const PREF = ['i1p-exm', 'i1p-tgt', 'i1p-maxauto', 'i1p-reuse', 'i1p-mt', 'i1p-rt', 'i1p-res', 'i1p-lo', 'i1p-hi', 'i1p-step', 'i1p-kern', 'i1p-wscale', 'i1p-fwhm', 'i1p-interp',
    'i1p-lrt', 'i1p-am', 'i1p-wn', 'i1p-keep', 'i1p-livesnap', 'i1p-n', 'i1p-int', 'i1p-each', 'i1p-rk', 'i1p-rT', 'i1p-ak', 'i1p-av', 'i1p-ap', 'i1p-aw', 'i1p-ah', 'i1p-aa', 'i1p-pkn', 'i1p-pkp', 'i1p-inst', 'i1p-btn', 'i1p-auto', 'i1p-autorec', 'ms-norm', 'i1p-log10', 'i1p-ma', 'i1p-mb'];
  function savePrefs() { const o = {}; for (const id of PREF) { const e = g(id); if (e) o[id] = e.type === 'checkbox' ? e.checked : e.value; } lstore.set('i1p-prefs', JSON.stringify(o)); }
  function loadPrefs() { try { const o = JSON.parse(lstore.get('i1p-prefs') || '{}'); for (const id of PREF) { const e = g(id); if (e && id in o) { if (e.type === 'checkbox') e.checked = !!o[id]; else e.value = o[id]; } } } catch (e) { } }

  /* ---------- resolution presets ---------- */
  const PRE = I1Pro.RES_PRESETS;
  g('i1p-res').innerHTML = PRE.map(p => '<option value="' + p.id + '">' + esc(p.label) + '</option>').join('');
  function activePreset() {
    const id = g('i1p-res').value, p = PRE.find(x => x.id === id) || PRE[0];
    if (p.id !== 'custom') return { id: p.id, label: p.label, opts: Object.assign({ interp: 'lagrange', widthScale: 1 }, p.opts) };
    return { id: 'custom', label: 'custom grid', opts: { lo: num('i1p-lo', 380), hi: num('i1p-hi', 730), step: Math.max(0.1, num('i1p-step', 1)), kernel: g('i1p-kern').value, widthScale: num('i1p-wscale', 1), fwhm: num('i1p-fwhm', 0), interp: g('i1p-interp').value } };
  }
  function shortRes() { const p = activePreset(); return p.id === 'std10' ? '10 nm' : p.id === 'hires3' ? '3.33 nm' : p.id === 'fine1' ? '1 nm' : (+p.opts.step.toFixed(2)) + ' nm custom'; }
  function resUi() {
    const p = activePreset(); g('i1p-custom').hidden = p.id !== 'custom';
    const f = g('i1p-kern').value === 'factory'; g('i1p-wscale-f').hidden = !f; g('i1p-fwhm-f').hidden = f; g('i1p-fwhm-l').textContent = g('i1p-kern').value === 'argyll' ? 'Triangle half-width nm (0 = grid step)' : 'FWHM nm (0 = factory)';
    const n = Math.round((p.opts.hi - p.opts.lo) / p.opts.step) + 1; let t = n + ' points per spectrum. ';
    if (p.id === 'std10') t += 'Exactly the 36 bands ArgyllCMS reports.';
    else if (p.id === 'hires3') t += 'The grid of ArgyllCMS high-resolution mode (-H), with the same filter algorithm (cubic interpolation of the pixels integrated against a 3.33 nm triangle). The optical resolution is about 6.5 nm: narrow peaks get sharper, noise gets larger.';
    else t += 'Finer than the sensor pixel spacing (about 3.1-3.6 nm, depending on wavelength) is interpolation, not extra information.';
    g('i1p-resnote').textContent = t; sumUi();
  }
  g('i1p-res').onchange = () => { resUi(); refreshAll(); }; g('i1p-kern').onchange = () => { resUi(); refreshAll(); };
  for (const id of ['i1p-lo', 'i1p-hi', 'i1p-step', 'i1p-wscale', 'i1p-fwhm', 'i1p-interp']) g(id).onchange = () => { resUi(); refreshAll(); };

  /* ---------- plots ---------- */
  const spPlot = new Plot(g('i1p-cv'), { h: 260, fmtX: x => x.toFixed(1), unitX: ' nm', title: () => spTitle });
  spPlot.dom = [380, 780]; let spTitle = '';
  const pxPlot = new Plot(g('i1p-cv2'), { h: 140, fmtX: x => 'pixel ' + Math.round(x), fmtTick: x => String(Math.round(x)), title: 'sensor pixels 0–127, counts/s (blue end = 127)' }); pxPlot.dom = [-1, 128];
  const tPlot = new Plot(g('i1p-cvT'), { h: 200, fmtX: x => x.toFixed(1), unitX: ' s', from0: false, fmtTick: x => String(+x.toFixed(1)) });
  root.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('[data-z]'); if (!b) return; const z = b.dataset.z, P = z[0] === 'T' ? tPlot : spPlot, k = z.slice(1);
    if (k === '+') P.zoomCenter(0.6); else if (k === '-') P.zoomCenter(1.6); else P.resetView();
  });
  g('i1p-log10').onchange = () => { spPlot.log = g('i1p-log10').checked; spPlot.draw(); };
  g('ms-norm').onchange = () => drawMain();

  /* ---------- calibration lookup (so stored measurements can be re-processed without the instrument) ---------- */
  function fnv(u8) { let h = 0x811c9dc5; for (let i = 0; i < u8.length; i++) { h ^= u8[i]; h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, '0'); }
  const toB64 = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 4096) s += String.fromCharCode.apply(null, u8.subarray(i, i + 4096)); return btoa(s); };
  const fromB64 = b => { const s = atob(b), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; };
  function eeRegister() { const id = dev.cal.serial + '-' + fnv(dev.eeprom); if (!EE[id]) EE[id] = toB64(dev.eeprom); dev.eeId = id; return id; }
  function calFor(id) {
    if (dev && dev.eeId === id && dev.cal) return { cal: dev.cal, fits: dev.fits };
    if (calCache.has(id)) return calCache.get(id); if (!EE[id]) return null;
    try { const u8 = fromB64(EE[id]), cal = I1Pro.decodeEEPROM(u8), o = { cal, fits: I1Pro.fitAllBands(cal) }; calCache.set(id, o); return o; } catch (e) { return null; }
  }
  const WL36 = I1Pro.WL36;
  /* a measurement's spectrum at the chosen resolution, cached per setting */
  function procSpectrum(m) {
    const P = activePreset(), key = P.id + JSON.stringify(P.opts) + (m.corr ? 'c' : '') + (m.absK || '');
    if (m._k === key) return m._p; let out = null;
    if (P.id === 'std10') out = { wl: WL36, v: m.argyll.std36.map((x, i) => x * (m.kind === 'em' ? (m.corr ? m.corr[i] : 1) * (m.absK || 1) : 1)) };
    else if (P.id === 'hires3' && !m.corr && !m.absK && m.argyll.hires) { const h = m.argyll.hires; out = { wl: h.v.map((_, i) => h.lo + i * h.step), v: h.v.slice() }; }
    else { const c = calFor(m.eeId); if (c) {
      try {
        if (m.kind === 'em') { const rs = I1Pro.buildResampler(c.cal, c.fits, Object.assign({}, P.opts, { corr: m.corr || m.absK ? Float64Array.from({ length: 36 }, (_, i) => (m.corr ? m.corr[i] : 1) * (m.absK || 1)) : null })); out = { wl: Array.from(rs.wl), v: Array.from(rs.apply(Float64Array.from(m.avgAbs))) }; }
        else { const r = I1Pro.reflectanceFromAbs(c.cal, c.fits, Float64Array.from(m.avgAbs), Float64Array.from(m.whiteAbs), P.opts); out = { wl: Array.from(r.wl), v: Array.from(r.v) }; }
      } catch (e) { console.warn(e); } } }
    if (!out) { const h = m.argyll.hires; out = h && P.id !== 'std10' ? { wl: h.v.map((_, i) => h.lo + i * h.step), v: h.v.slice(), fallback: true } : { wl: WL36, v: m.argyll.std36.slice(), fallback: true }; }
    m._k = key; m._p = out; return out;
  }

  /* ---------- derived numbers: brightness, power, colour, peaks ---------- */
  let rsKey = null, rs1 = null;
  function grid1() {
    const k = [dev.eeprom, dev.userCorr, (dev.userCorr && dev.userCorr.enabled ? 1 : 0) + '|' + (dev.absCal && dev.absCal.enabled ? dev.absCal.k : 0)];
    if (!rsKey || rsKey[0] !== k[0] || rsKey[1] !== k[1] || rsKey[2] !== k[2]) { rs1 = dev.resampler({ lo: 380, hi: 730, step: 1, kernel: 'factory', widthScale: 1, interp: 'lagrange' }); rsKey = k; }
    return rs1;
  }
  const HC = 6.62607015e-34 * 2.99792458e8, NA = 6.02214076e23;
  function findPeaks(wl, v, maxN, promPct) {
    const n = v.length, mx = Math.max(...v); if (!(mx > 0)) return [];
    const s = v.map((x, i) => (v[Math.max(0, i - 1)] + 2 * x + v[Math.min(n - 1, i + 1)]) / 4), cand = [];
    for (let i = 1; i < n - 1; i++) if (s[i] > s[i - 1] && s[i] >= s[i + 1]) {
      let l = i, minL = s[i]; while (l > 0 && s[l - 1] <= s[i]) { l--; minL = Math.min(minL, s[l]); }
      let r = i, minR = s[i]; while (r < n - 1 && s[r + 1] <= s[i]) { r++; minR = Math.min(minR, s[r]); }
      const prom = s[i] - (l === 0 && r === n - 1 ? 0 : (l === 0 ? minR : r === n - 1 ? minL : Math.max(minL, minR)));
      if (prom >= promPct / 100 * mx) cand.push({ i, h: s[i], prom });
    }
    cand.sort((a, b) => b.h - a.h); const out = [];
    for (const c of cand) {
      if (out.length >= maxN) break; if (out.some(o => Math.abs(wl[o.i] - wl[c.i]) < 8)) continue;
      const i = c.i, y0 = s[i - 1], y1 = s[i], y2 = s[i + 1], den = y0 - 2 * y1 + y2, d = den ? 0.5 * (y0 - y2) / den : 0, nm = wl[i] + Math.max(-1, Math.min(1, d)) * (wl[1] - wl[0]);
      const half = c.h - c.prom / 2; let a = i; while (a > 0 && s[a] > half) a--; let b = i; while (b < n - 1 && s[b] > half) b++;
      const fw = (b === n - 1 && s[b] > half) || (a === 0 && s[a] > half) ? null : (wl[b] - wl[a]);
      out.push({ nm: +nm.toFixed(2), h: v[i], rel: v[i] / mx, fwhm: fw });
    }
    return out.sort((p, q) => p.nm - q.nm);
  }
  function emMetrics(r) {
    const rs = grid1(), raw = rs.apply(r.avgAbs), wl = Array.from(rs.wl), v = Array.from(raw, x => Math.max(0, x)), f = 1;   // the absolute factor is already inside the resampler
    let Y = 0, P = 0, ph = 0;
    for (let i = 0; i < wl.length; i++) { const nm = wl[i], row = CMF_TAB[Math.round(nm) - 380]; if (row) Y += v[i] * row[1]; P += v[i]; if (nm >= 400 && nm <= 700) ph += v[i] * nm; }
    const m = { Y: 0.683 * Y * f, rad: P * f, ppfd: ph * 1e-3 * 1e-9 / HC / NA * 1e6 * f, peakCounts: r.peakCounts, inttime: r.inttime * 1000 };
    let q = null; try { if (Math.max(...v) > 0) q = ledMake('tmp', 't', 'x', 'usr', wl, v, {}, []).q; } catch (e) { }
    if (q) { m.x = q.x; m.y = q.y; m.up = q.up; m.vp = q.vp; m.cct = q.ok ? q.cct : null; m.duv = q.ok ? q.duv : null; m.Ra = q.ok && q.cri ? q.cri.Ra : null; m.R9 = q.ok && q.cri ? q.cri.R[8] : null; m.Rf = q.ok && q.tm30 ? q.tm30.Rf : null; m.Rg = q.ok && q.tm30 ? q.tm30.Rg : null; }
    m.peaks = findPeaks(wl, v, 12, num('i1p-pkp', 8)).map(p => ({ nm: p.nm, h: p.h * f, rel: p.rel, fwhm: p.fwhm }));
    const top = m.peaks.slice().sort((a, b) => b.h - a.h)[0]; m.pk = top ? top.nm : null;
    return m;
  }
  function rfMetrics(std36) {
    let s = 0, n = 0, pk = 0, pkn = 0, mn = 9, mnn = 0;
    for (let i = 0; i < 36; i++) { const nm = 380 + 10 * i, v = std36[i]; if (nm >= 400 && nm <= 700) { s += v; n++; } if (v > pk) { pk = v; pkn = nm; } if (nm >= 400 && nm <= 700 && v < mn) { mn = v; mnn = nm; } }
    return { meanR: s / n, peakR: pk, peakNm: pkn, minR: mn, minNm: mnn };
  }
  /* an approximate on-screen colour for a swatch */
  function lin2css(r, g_, b) { const mx = Math.max(r, g_, b, 1e-9), f = x => { x = Math.max(0, x / mx); return Math.round(255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055)); }; return 'rgb(' + f(r) + ',' + f(g_) + ',' + f(b) + ')'; }
  function xyz2css(X, Y, Z, scale) { const s = scale || 1; return lin2css(s * (3.2406 * X - 1.5372 * Y - 0.4986 * Z), s * (-0.9689 * X + 1.8758 * Y + 0.0415 * Z), s * (0.0557 * X - 0.2040 * Y + 1.0570 * Z)); }
  function swatchOf(m) {
    try {
      if (m.kind === 'em') { const mt = m.metrics; if (!mt || mt.x == null) return '#888'; const X = mt.x / mt.y, Z = (1 - mt.x - mt.y) / mt.y; return xyz2css(X, 1, Z); }
      let X = 0, Y = 0, Z = 0, W = 0; for (let i = 2; i <= 32; i++) { const row = CMF_TAB[i * 10], R = m.argyll.std36[i]; X += R * row[0]; Y += R * row[1]; Z += R * row[2]; W += row[1]; }
      return xyz2css(X / W, Y / W, Z / W, 1 / Math.max(1e-9, Y / W) * Math.min(1, Y / W * 1.2));
    } catch (e) { return '#888'; }
  }
  /* Units follow the absolute calibration the measurement was taken with ('power' = laser power without a beam area). */
  function unitsOf(m) { const pw = m && m.absMeta && m.absMeta.unit === 'power'; return pw ? { spec: 'mW/nm', Y: 'lm', rad: 'mW', ppfd: 'µmol/s' } : { spec: 'mW/m²/nm', Y: 'cd/m²', rad: 'mW/m²', ppfd: 'µmol/m²/s' }; }
  const colorOf = m => { const css = getComputedStyle(document.documentElement); return css.getPropertyValue('--k' + (1 + m.ci % 7)).trim() || '#2a78d6'; };

  /* ---------- the measurement store ---------- */
  function nextName(kind) {
    const base = kind === 'rf' ? 'Pigment' : 'Light', re = new RegExp('^' + base + ' (\\d+)$'); let mx = 0;
    for (const m of MS.list) { const r = re.exec(m.name); if (r) mx = Math.max(mx, +r[1]); } return base + ' ' + (mx + 1);
  }
  function uniqueName(n) { let nn = n, k = 2; const has = x => MS.list.some(m => m.name === x); while (has(nn)) nn = n + ' ' + (k++); return nn; }
  function makeMeasurement(r, name, warn) {
    const rf = r.kind === 'reflective', eeId = eeRegister(), c = { cal: dev.cal, fits: dev.fits };
    const m = { id: 'm' + Date.now().toString(36) + (++seq), name, kind: rf ? 'rf' : 'em', t: r.when || Date.now(), serial: dev.cal.serial, eeId, inttime: r.inttime, nFrames: r.nFrames, nReadings: r.nSamples || 1,
      exposure: r.exposureMode, peak: r.peakCounts, headroom: r.headroom, avgAbs: sig(r.avgAbs), whiteAbs: rf ? sig(r.whiteAbs) : null, corr: null, corrMeta: null, warn: warn || [], ci: colorN++, libId: null, note: '' };
    if (!rf) {
      if (r.corrApplied && dev.userCorr) { m.corr = sig(dev.userCorr.c, 6); m.corrMeta = Object.assign({}, dev.userCorr.meta); }
      if (r.absApplied && dev.absCal) { m.absK = r.absK; m.absMeta = Object.assign({}, dev.absCal.meta); }
      const a = I1Pro.argyllValues(c.cal, c.fits, Float64Array.from(r.avgAbs)); m.argyll = { std36: sig(a.std36), hires: { lo: a.hires.lo, hi: a.hires.hi, step: a.hires.step, v: sig(a.hires.v, 6) } };
      m.metrics = emMetrics(r);
    } else {
      const std36 = Array.from(r.s36), hr = I1Pro.RES_PRESETS[1].opts, h = I1Pro.reflectanceFromAbs(c.cal, c.fits, Float64Array.from(r.avgAbs), Float64Array.from(r.whiteAbs), hr);
      m.argyll = { std36: sig(std36), hires: { lo: hr.lo, hi: hr.hi, step: hr.step, v: sig(h.v, 6) } }; m.metrics = rfMetrics(std36);
    }
    return m;
  }
  function addMeasurement(m, quiet) {
    MS.list.push(m); MS.sel = m.id; MS.checked.add(m.id); renderAll(); persistSoon();
    if (g('i1p-auto').checked) toLibrary([m], true);
    if (!quiet) { const mt = m.metrics; note(m.name + ' added' + (m.kind === 'em' && mt && mt.cct ? ': ' + Math.round(mt.cct) + ' K, Ra ' + Math.round(mt.Ra) : '') + '.', 'ok'); }
  }

  /* ---------- table ---------- */
  function rowNums(m) {
    const mt = m.metrics || {};
    if (m.kind === 'rf') return ['–', '–', '–'];
    return [mt.cct ? Math.round(mt.cct) + ' K' : '–', mt.Y != null ? fmtN(mt.Y) : '–', mt.Ra != null ? Math.round(mt.Ra) : '–'];
  }
  function renderTable() {
    const tb = root.querySelector('#ms-table tbody'); g('ms-count').textContent = MS.list.length ? '(' + MS.list.length + ')' : '';
    g('ms-empty').hidden = MS.list.length > 0; g('ms-wrap').hidden = !MS.list.length;
    tb.innerHTML = MS.list.map(m => {
      const n = rowNums(m), badges = (m.kind === 'rf' ? '<span class="chip">pigment</span> ' : '') + (m.corr ? '<span class="chip ok" title="Source (blackbody) correction was applied">corrected</span> ' : '') + (m.nReadings > 1 ? '<span class="chip">mean of ' + m.nReadings + '</span> ' : '') + (m.libId ? '<span class="chip">in library</span>' : '');
      return '<tr class="rw' + (m.id === MS.sel ? ' sel' : '') + '" data-id="' + m.id + '"><td><input type="checkbox" data-chk="' + m.id + '"' + (MS.checked.has(m.id) ? ' checked' : '') + ' aria-label="Show ' + esc(m.name) + '"></td>' +
        '<td><div class="nm"><span class="dot" style="background:' + colorOf(m) + '"></span><span class="t" data-name="' + m.id + '" title="Double-click to rename">' + esc(m.name) + '</span></div><div class="sub2">' + timeStr(m.t) + ' · ' + (m.inttime * 1000).toFixed(m.inttime < 0.1 ? 1 : 0) + ' ms ' + badges + '</div></td>' +
        '<td class="n">' + n[0] + '</td><td class="n">' + n[1] + '</td><td class="n">' + n[2] + '</td></tr>';
    }).join('');
    g('ms-all').checked = MS.list.length > 0 && MS.list.every(m => MS.checked.has(m.id));
  }
  root.querySelector('#ms-table tbody').addEventListener('click', e => {
    const chk = e.target.closest('[data-chk]'); if (chk) { const id = chk.dataset.chk; chk.checked ? MS.checked.add(id) : MS.checked.delete(id); drawMain(); g('ms-all').checked = MS.list.every(m => MS.checked.has(m.id)); return; }
    if (e.target.closest('input')) return; const tr = e.target.closest('tr[data-id]'); if (!tr) return;
    MS.sel = tr.dataset.id; MS.checked.add(MS.sel); live = live && liveOn ? live : null; renderAll();
  });
  root.querySelector('#ms-table tbody').addEventListener('dblclick', e => {
    const sp = e.target.closest('[data-name]'); if (!sp) return; const m = MS.list.find(x => x.id === sp.dataset.name); if (!m) return;
    const inp = document.createElement('input'); inp.type = 'text'; inp.className = 'nameedit'; inp.value = m.name; sp.replaceWith(inp); inp.focus(); inp.select();
    const done = ok => { if (ok && inp.value.trim()) { m.name = inp.value.trim(); persistSoon(); } renderAll(); };
    inp.onkeydown = ev => { if (ev.key === 'Enter') done(true); else if (ev.key === 'Escape') done(false); }; inp.onblur = () => done(true);
  });
  g('ms-all').onchange = e => { if (e.target.checked) MS.list.forEach(m => MS.checked.add(m.id)); else MS.checked.clear(); renderTable(); drawMain(); };
  const checked = () => MS.list.filter(m => MS.checked.has(m.id));

  /* ---------- main chart + details ---------- */
  function drawMain() {
    const T = THEME(); let shownList = checked(); const selM = MS.list.find(m => m.id === MS.sel);
    const kind = (live && liveOn) ? 'em' : (selM ? selM.kind : (shownList[0] && shownList[0].kind) || 'em');
    shownList = shownList.filter(m => m.kind === kind); const P = activePreset(), norm = g('ms-norm').checked, ser = [], leg = []; let wlMin = 380, wlMax = 780, markers = [];
    for (const m of shownList) {
      const s = procSpectrum(m); let y = s.v.slice(); const mx = Math.max(...y); if (norm && mx > 0) y = y.map(v => v / mx);
      const isSel = m.id === MS.sel && !(live && liveOn); ser.push({ x: s.wl, y, color: colorOf(m), width: isSel ? 2.6 : 1.5, fill: isSel && shownList.length < 3, name: m.name.length > 16 ? m.name.slice(0, 15) + '…' : m.name, unit: norm ? '' : kind === 'em' ? 'mW/m²/nm' : '' });
      wlMin = Math.min(wlMin, s.wl[0]); wlMax = Math.max(wlMax, s.wl[s.wl.length - 1]); leg.push('<span><i class="dot" style="background:' + colorOf(m) + '"></i>' + esc(m.name) + (m.corr ? ' (corrected)' : '') + '</span>');
      if (isSel && kind === 'em' && m.metrics && m.metrics.peaks) markers = peakMarkers(m.metrics.peaks, s, norm);
    }
    if (live && liveOn) { const s = live.spec; let y = s.v.slice(); const mx = Math.max(...y); if (norm && mx > 0) y = y.map(v => v / mx); ser.push({ x: s.wl, y, color: T.fg, width: 2.2, dash: [6, 3], name: 'live', unit: norm ? '' : unitsOf({ absMeta: dev && dev.absCal && dev.absCal.enabled ? dev.absCal.meta : null }).spec, fill: !shownList.length }); leg.push('<span><i class="dot" style="background:' + T.fg + '"></i>live' + (live.r.nSamples > 1 ? ' (mean of ' + live.r.nSamples + ')' : '') + '</span>'); markers = peakMarkers(live.m.peaks, s, norm); }
    if (live && liveOn && g('i1p-inst').checked && live.inst) ser.unshift({ x: live.inst.wl, y: live.inst.v, color: '#888', width: 1, alpha: .6, nopts: true, name: 'latest' });
    spTitle = (kind === 'em' ? (norm ? 'relative power' : unitsOf(shownList[0]).spec) : 'reflectance (1 = 100%)') + ' · ' + shortRes();
    g('ms-title').textContent = kind === 'em' ? 'Spectrum of lights' : 'Reflectance of pigments';
    g('ms-legend').innerHTML = leg.join('') + (shownList.length !== checked().length ? '<span>(lights and pigments are not drawn together)</span>' : '');
    spPlot.set(ser, markers, [wlMin, wlMax]);
    const pm = (live && liveOn) ? { avg: live.r.avgAbs } : selM ? { avg: selM.avgAbs } : null; const px = [], py = [];
    if (pm) for (let p = 0; p < 128; p++) { px.push(p); py.push(pm.avg[p]); }
    pxPlot.set(pm ? [{ x: px, y: py, type: 'bars', dx: 1, name: 'counts/s', tip: true }] : [], [], [-1, 128]);
  }
  function peakMarkers(peaks, s, norm) {
    const n = Math.max(0, Math.floor(num('i1p-pkn', 6))), mx = Math.max(...s.v) || 1, out = [];
    for (const p of peaks.slice().sort((a, b) => b.h - a.h).slice(0, n)) {
      let lo = 0; while (lo < s.wl.length - 2 && s.wl[lo + 1] < p.nm) lo++; const hi = Math.min(lo + 1, s.v.length - 1), t = (s.wl[hi] - s.wl[lo]) ? (p.nm - s.wl[lo]) / (s.wl[hi] - s.wl[lo]) : 0;
      let y = s.v[lo] + (s.v[hi] - s.v[lo]) * t; if (norm) y /= mx; out.push({ x: p.nm, y: Math.max(0, y), text: p.nm.toFixed(1) + ' nm' });
    }
    return out;
  }
  function renderDetail() {
    const el = g('ms-detail'), selM = MS.list.find(m => m.id === MS.sel); let m = null, isLive = false;
    if (live && liveOn) { isLive = true; m = { name: 'Live', kind: 'em', metrics: live.m, inttime: live.r.inttime, nFrames: live.r.nFrames, nReadings: live.r.nSamples || 1, exposure: live.r.exposureMode, peak: live.r.peakCounts, headroom: live.r.headroom, corr: live.r.corrApplied ? [1] : null, corrMeta: dev && dev.userCorr && dev.userCorr.meta, absMeta: live.r.absApplied && dev.absCal ? dev.absCal.meta : null, warn: live.warn || [], t: Date.now() }; }
    else if (selM) m = selM;
    el.hidden = !m; if (!m) return;
    const mt = m.metrics || {}, f = (v, d) => v == null || !isFinite(v) ? '–' : v.toFixed(d); let grid;
    if (m.kind === 'em') grid = kv('Brightness', fmtN(mt.Y) + ' <small>' + unitsOf(m).Y + '</small>') + kv('Radiant power', fmtN(mt.rad) + ' <small>' + unitsOf(m).rad + '</small>') + kv('Photon flux', fmtN(mt.ppfd) + ' <small>' + unitsOf(m).ppfd + '</small>') + kv('CCT', mt.cct ? Math.round(mt.cct) + ' K' : '–') + kv('Duv', mt.cct ? mt.duv.toFixed(4) : '–') + kv('Strongest peak', mt.pk ? mt.pk.toFixed(1) + ' nm' : '–') +
      kv('x, y', f(mt.x, 4) + ', ' + f(mt.y, 4)) + kv("u′, v′", f(mt.up, 4) + ', ' + f(mt.vp, 4)) + kv('CRI Ra', mt.Ra != null ? Math.round(mt.Ra) : '–') + kv('R9', mt.R9 != null ? Math.round(mt.R9) : '–') + kv('TM-30 Rf', mt.Rf != null ? Math.round(mt.Rf) : '–') + kv('TM-30 Rg', mt.Rg != null ? Math.round(mt.Rg) : '–');
    else grid = kv('Mean reflectance 400–700', Math.round(mt.meanR * 100) + '%') + kv('Highest', Math.round(mt.peakR * 100) + '% at ' + mt.peakNm + ' nm') + kv('Lowest', Math.round(mt.minR * 100) + '% at ' + mt.minNm + ' nm');
    const pk = (m.kind === 'em' && mt.peaks) ? mt.peaks.slice().sort((a, b) => b.h - a.h).slice(0, Math.max(0, Math.floor(num('i1p-pkn', 6)))) : [];
    const cal = m.corr ? '<span class="chip ok">source correction applied' + (m.corrMeta && m.corrMeta.kind ? ': ' + esc(m.corrMeta.kind) + (m.corrMeta.T ? ' ' + m.corrMeta.T + ' K' : '') : '') + '</span>' : '<span class="chip">no source correction (factory calibration only)</span>';
    const info = (m.inttime * 1000).toFixed(m.inttime < 0.1 ? 2 : 1) + ' ms × ' + m.nFrames + ' frames · ' + esc(m.exposure) + (m.nReadings > 1 ? ' · mean of ' + m.nReadings + ' readings' : '') + ' · peak ' + Math.round(m.peak) + ' counts (' + Math.round(m.headroom * 100) + '% of saturation)';
    el.innerHTML = '<h3>' + (isLive ? '<span class="dot" style="background:#d33"></span>' : '<span class="sw" style="background:' + swatchOf(m) + '"></span>') + esc(m.name) + ' ' + cal + '</h3><div class="note" style="margin:2px 0 0">' + info + '</div>' +
      '<div class="readout">' + grid + '</div>' +
      (pk.length ? '<div class="note"><b>Peaks:</b> ' + pk.map(p => p.nm.toFixed(1) + ' nm (' + Math.round(p.rel * 100) + '%' + (p.fwhm ? ', width ≈ ' + p.fwhm.toFixed(0) + ' nm' : '') + ')').join(' · ') + '<br><span style="opacity:.75">Sub-pixel fit; about ±1–2 nm. The pixel spacing is about 3.1-3.6 nm and the optical resolution about 6.5 nm, so widths are broader than the real ones.</span></div>' : '') +
      ((m.warn && m.warn.length) ? '<div class="note">' + m.warn.map(w => '<div>⚠ ' + esc(w) + '</div>').join('') + '</div>' : '') +
      (isLive ? '' : '<div class="row" style="margin-top:10px"><button class="btn sm" data-act="lib">' + (m.kind === 'rf' ? 'Add to Artist pigments' : 'Add to library') + '</button>' + (m.kind === 'em' ? '<button class="btn sm" data-act="map"' + (m.libId ? '' : ' disabled') + '>Use in colour map</button>' : '') + '<button class="btn sm" data-act="csv">CSV</button><button class="btn sm" data-act="sp">.sp</button><button class="btn sm" data-act="px">Pixels CSV</button></div>');
  }
  g('ms-detail').addEventListener('click', e => {
    const b = e.target.closest('[data-act]'); if (!b) return; const m = MS.list.find(x => x.id === MS.sel); if (!m) return;
    if (b.dataset.act === 'lib') toLibrary([m]);
    else if (b.dataset.act === 'map') { if (m.libId) { st.libId = m.libId; st.src = 'lib'; showTab('map'); recompute(); } }
    else if (b.dataset.act === 'csv') { const s = procSpectrum(m); download(m.name + '.csv', I1Pro.toCSV(s.wl, s.v, metaOf(m)), 'text/csv'); }
    else if (b.dataset.act === 'sp') { const s = procSpectrum(m); download(m.name + '.sp', I1Pro.toSP(s.wl, s.v, m.name), 'text/plain'); }
    else if (b.dataset.act === 'px') { const L = ['# device,i1 Pro S/N ' + m.serial, '# exposure_s,' + m.inttime, '# frames,' + m.nFrames, 'pixel,nm_from_factory_matrix,dark_subtracted_counts_per_s']; m.avgAbs.forEach((v, p) => L.push(p + ',' + ((calFor(m.eeId) || { cal: dev.cal }).cal.pxnm[p]).toFixed(2) + ',' + v)); download(m.name + '_pixels.csv', L.join('\n') + '\n', 'text/csv'); }
  });
  const metaOf = m => ({ device: 'i1 Pro S/N ' + m.serial, name: m.name, kind: m.kind === 'em' ? 'emission' : 'reflectance', resolution: activePreset().label, exposure_ms: (m.inttime * 1000).toFixed(2), frames: m.nFrames, readings: m.nReadings, source_correction: m.corr ? 'applied' : 'none', measured: new Date(m.t).toISOString() });
  function renderAll() { renderTable(); drawMain(); renderDetail(); timeCard(); }
  function refreshAll() { for (const m of MS.list) { m._k = null; } renderAll(); }

  /* ---------- library / pigments ---------- */
  function addPigment(name, wl, v) {
    if (st.kind !== 'pig') setKind('pig'); if (st.demo) { st.filters.clear(); st.names.clear(); } st.demo = false;
    const id = 'i1p:' + name + ':' + Date.now().toString(36), vv = v.map(x => Math.min(1.5, Math.max(0, x))); st.names.set(id, name);
    if (!addFilter({ id, name, wl: wl.slice(), v: vv })) return null; st.sel = id; usSaveSoon(); recompute(); return id;
  }
  function addLed(name, wl, v, serial) {
    const c = cleanLED({ wl: wl.slice(), v: v.slice() }); if (!c) return null;
    const it = ledMake('usr:' + name, name, 'Measured', 'usr', c.wl, c.v, { device: 'i1 Pro S/N ' + serial + ' (WebUSB)', name }, c.notes);
    ledPut(it); ledChanged(); ledSaveSoon(); return it;
  }
  function toLibrary(list, quiet) {
    let nl = 0, np = 0, bad = 0;
    for (const m of list) {
      const s = procSpectrum(m);
      if (m.kind === 'rf') { if (addPigment(m.name, s.wl, s.v)) { np++; m.libId = 'pig'; } else bad++; }
      else { const it = addLed(m.name, s.wl, s.v, m.serial); if (it) { nl++; m.libId = it.id; try { ldSelect(it.id, true); } catch (e) { } } else bad++; }
    }
    renderAll(); persistSoon();
    if (!quiet) note((nl ? nl + ' added to the Illuminant library' : '') + (nl && np ? ', ' : '') + (np ? np + ' added to Artist pigments' : '') + (bad ? (nl || np ? ', ' : '') + bad + ' too weak or short to add' : '') + '.', bad && !nl && !np ? 'err' : 'ok');
  }
  g('ms-tolib').onclick = () => { const l = checked(); if (!l.length) { note('Tick the rows you want to add.', 'err'); return; } toLibrary(l); };
  g('ms-del').onclick = () => { const l = checked(); if (!l.length) { note('Tick the rows you want to delete.', 'err'); return; } const ids = new Set(l.map(m => m.id)); MS.list = MS.list.filter(m => !ids.has(m.id)); ids.forEach(i => MS.checked.delete(i)); if (ids.has(MS.sel)) MS.sel = MS.list.length ? MS.list[MS.list.length - 1].id : null; renderAll(); persistSoon(); note(l.length + ' deleted.', 'ok'); };
  let clearArm = 0;
  g('ms-clear').onclick = () => { if (!MS.list.length) return; if (Date.now() - clearArm > 3000) { clearArm = Date.now(); g('ms-clear').textContent = 'Click again to clear all'; setTimeout(() => { g('ms-clear').textContent = 'Clear all'; }, 3000); return; } clearArm = 0; g('ms-clear').textContent = 'Clear all'; MS.list = []; MS.checked.clear(); MS.sel = null; renderAll(); persistSoon(); note('All measurements removed (library entries are kept).', 'ok'); };

  /* ---------- export ---------- */
  function csvWide(lists, grids) { // one wavelength column and one column per measurement (all on the same grid)
    const wl = grids[0].wl, L = ['# resolution,' + activePreset().label, '# device,i1 Pro', 'wavelength,' + lists.map(m => '"' + m.name.replace(/"/g, '""') + '"').join(',')];
    for (let i = 0; i < wl.length; i++) L.push(+wl[i].toFixed(3) + ',' + grids.map(s => s.v[i] == null ? '' : (+s.v[i]).toPrecision(7)).join(',')); return L.join('\n') + '\n';
  }
  g('ms-export').onchange = e => {
    const kind = e.target.value; e.target.value = ''; if (!kind) return; const l = kind === 'json' ? MS.list : checked();
    if (!l.length) { note(kind === 'json' ? 'Nothing to export yet.' : 'Tick the rows you want to export.', 'err'); return; }
    if (kind === 'csv') { for (const k of ['em', 'rf']) { const ll = l.filter(m => m.kind === k); if (ll.length) download('i1pro-' + (k === 'em' ? 'lights' : 'pigments') + '-' + shortRes().replace(/\s/g, '') + '.csv', csvWide(ll, ll.map(procSpectrum)), 'text/csv'); } }
    else if (kind === 'argyll') {
      for (const k of ['em', 'rf']) { const ll = l.filter(m => m.kind === k); if (!ll.length) continue; const tag = k === 'em' ? 'lights' : 'pigments';
        download('i1pro-' + tag + '-argyll-10nm.csv', csvWide(ll, ll.map(m => ({ wl: WL36, v: m.argyll.std36 }))).replace('# resolution,' + activePreset().label, '# resolution,ArgyllCMS 10 nm (380-730), no source correction'), 'text/csv');
        download('i1pro-' + tag + '-argyll-3.3nm.csv', csvWide(ll, ll.map(m => ({ wl: m.argyll.hires.v.map((_, i) => m.argyll.hires.lo + i * m.argyll.hires.step), v: m.argyll.hires.v }))).replace('# resolution,' + activePreset().label, '# resolution,ArgyllCMS-style high resolution 3.33 nm (370-730), no source correction'), 'text/csv'); }
    }
    else if (kind === 'sp') l.forEach((m, i) => setTimeout(() => { const s = procSpectrum(m); download(m.name + '.sp', I1Pro.toSP(s.wl, s.v, m.name), 'text/plain'); }, i * 250));
    else if (kind === 'json') {
      const used = new Set(l.map(m => m.eeId)), eeprom = {}; for (const k of used) if (EE[k]) eeprom[k] = EE[k];
      download('i1pro-measurements.json', JSON.stringify({ format: 'i1pro-webusb-measurements', version: 1, created: new Date().toISOString(), eeprom, list: l.map(stripM) }), 'application/json');
    }
    note('Exported ' + l.length + (l.length === 1 ? ' measurement.' : ' measurements.'), 'ok');
  };
  const stripM = m => { const o = {}; for (const k in m) if (k[0] !== '_') o[k] = m[k]; return o; };
  g('ms-load').onclick = () => g('ms-loadfile').click();
  g('ms-loadfile').onchange = async e => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    try {
      const d = JSON.parse(await f.text()); if (d.format !== 'i1pro-webusb-measurements' || !Array.isArray(d.list)) throw new Error('not a measurement backup');
      Object.assign(EE, d.eeprom || {}); let n = 0; const ids = new Set(MS.list.map(m => m.id));
      for (const m of d.list) { if (!m.avgAbs || !m.argyll) continue; if (ids.has(m.id)) m.id = 'm' + Date.now().toString(36) + (++seq); m.ci = colorN++; m.libId = null; MS.list.push(m); MS.checked.add(m.id); n++; }
      if (n) MS.sel = MS.list[MS.list.length - 1].id; renderAll(); persistSoon(); note(n + ' measurements loaded from ' + f.name + '.', 'ok');
    } catch (er) { note('Could not load that file: ' + er.message, 'err'); }
  };

  /* ---------- persistence ---------- */
  let saveT = 0;
  function persistSoon() { clearTimeout(saveT); saveT = setTimeout(persist, 500); }
  async function persist() { try { await kvPut('i1p-meas', { list: MS.list.map(stripM), eeprom: EE, sel: MS.sel, colorN }); } catch (e) { } }
  async function loadSaved() {
    try {
      const db = await kvOpen(), d = await new Promise((a, b) => { const r = db.transaction('kv').objectStore('kv').get('i1p-meas'); r.onsuccess = () => a(r.result); r.onerror = () => b(r.error); });
      if (d && Array.isArray(d.list) && d.list.length) { Object.assign(EE, d.eeprom || {}); MS.list = d.list; colorN = d.colorN || d.list.length; MS.sel = d.sel; d.list.forEach(m => MS.checked.add(m.id)); renderAll(); }
    } catch (e) { }
  }

  /* ---------- connect ---------- */
  async function attach(transport, isSim) {
    setBusy(true); status('Opening instrument…');
    try {
      dev = new I1Pro.I1ProDevice(transport, { log: m => console.log('[i1pro]', m), autoRecover: g('i1p-autorec').checked });
      const info = await dev.init(); origEE = Uint8Array.from(dev.eeprom); eeRegister();
      shown(true); setMode('em'); infoPanel(); eeInfo(); loadProfile(true); loadAbs(); exposureUi(); chips(); corrUi();
      status((isSim ? 'Demo instrument' : 'i1 Pro') + ' ready · S/N ' + info.serial + ' · firmware ' + info.firmware + '. Step 1: cover the sensor and run the dark calibration.', 'ok');
      if (!isSim) dev.onButton(() => { if (g('i1p-btn').checked) { if (liveOn) stopFlag = true; else if (busy) pendingBtn = true; else doMeasure(); } });
    } catch (e) { dev = null; shown(false); status(explain(e), 'err'); console.error(e); }
    setBusy(false);
  }
  g('i1p-connect').onclick = async () => { try { await attach(await I1Pro.WebUSBTransport.request(), false); } catch (e) { status(explain(e), 'err'); } };
  g('i1p-demo').onclick = async () => { sim = new I1ProSim.SimTransport({ eepromB64: window.I1P_DEMO_EEPROM, level: 20000, speed: 0.15 }); await attach(sim, true); };
  g('i1p-disc').onclick = async () => { try { await dev.close(); } catch (e) { } dev = null; sim = null; shown(false); status('Disconnected.'); };
  g('i1p-autorec').onchange = () => { if (dev) dev.autoRecover = g('i1p-autorec').checked; };

  /* ---------- mode, chips, summary ---------- */
  function setMode(m) {
    mode = m; const rf = m === 'rf';
    g('i1p-m-em').setAttribute('aria-pressed', String(!rf)); g('i1p-m-rf').setAttribute('aria-pressed', String(rf));
    g('i1p-whiterow').hidden = !rf; g('i1p-d-src').hidden = rf; g('i1p-d-live').querySelector('#i1p-live').hidden = rf;
    g('i1p-meas').textContent = rf ? 'Measure sample' : 'Measure';
    g('i1p-help').textContent = rf ? 'Pigment: the instrument\'s own lamp lights the sample. Calibrate the dark reference, then the white tile (instrument in its cradle), then place it flat on the sample and measure.'
      : 'Light: cover the sensor (cap on, or lay the instrument on a dark surface) for the dark calibration. Then point it at the light and press Measure.';
    chips();
  }
  g('i1p-m-em').onclick = () => setMode('em'); g('i1p-m-rf').onclick = () => setMode('rf');
  function chips() {
    const d = g('i1p-darkst'), w = g('i1p-whitest');
    if (dev && dev.dark) { d.textContent = 'done · ' + ago(dev.darkDate); d.className = 'chip ' + ((Date.now() - dev.darkDate) > 1200e3 ? 'warn' : 'ok'); } else { d.textContent = 'not done'; d.className = 'chip warn'; }
    if (dev && dev.refl) { w.textContent = 'done · ' + ago(dev.refl.date); w.className = 'chip ' + ((Date.now() - dev.refl.date) > 1800e3 ? 'warn' : 'ok'); } else { w.textContent = 'not done'; w.className = 'chip warn'; }
  }
  setInterval(() => { try { if (dev) chips(); } catch (e) { } }, 20000);
  function sumUi() {
    if (!g('i1p-sum')) return; const man = g('i1p-exm').value === 'manual', n = Math.floor(num('i1p-n', 1));
    g('i1p-sum').innerHTML = 'Current settings: ' + (man ? 'manual exposure ' + num('i1p-mt', 50) + ' ms' : 'auto exposure') + ' · ' + (n === 1 ? 'single reading' : n === 0 ? 'readings until Stop (mean)' : n + ' readings (mean)') + ' · ' + shortRes() + ' output.';
  }
  function corrUi() {
    const u = dev && dev.userCorr, on = !!(u && u.enabled), ch = g('i1p-rchip'); g('i1p-ron').disabled = !u; g('i1p-ron').checked = on; g('i1p-corrbar').classList.toggle('on', on);
    if (!u) { ch.textContent = 'none · factory calibration only'; ch.className = 'chip'; }
    else { const m = u.meta || {}; ch.textContent = (on ? 'ON' : 'OFF') + (m.kind ? ' · ' + m.kind + (m.T ? ' ' + m.T + ' K' : '') : '') + (m.lo ? ' · ' + m.lo + '–' + m.hi + ' nm' : ''); ch.className = 'chip ' + (on ? 'ok' : 'warn'); }
    g('i1p-ron').title = u ? 'Applies to the next light measurements; measurements already in the table keep what they were taken with.' : 'No correction yet: set one up under Advanced settings → Calibrate against a known source.';
    showCorr(); absUi();
  }
  g('i1p-ron').onchange = () => { if (dev && dev.userCorr) { dev.userCorr.enabled = g('i1p-ron').checked; corrUi(); infoPanel(); status(dev.userCorr.enabled ? 'Source correction is ON: new light measurements are corrected.' : 'Source correction is OFF: new light measurements use the factory calibration only.', 'ok'); } };
  g('ms-adv-open').onclick = () => { g('ms-main').hidden = true; g('ms-adv').hidden = false; window.scrollTo({ top: 0 }); };
  g('ms-adv-back').onclick = () => { g('ms-adv').hidden = true; g('ms-main').hidden = false; sumUi(); };

  /* ---------- exposure ---------- */
  function exposureUi() {
    const man = g('i1p-exm').value === 'manual'; g('i1p-ex-auto').hidden = man; g('i1p-ex-man').hidden = !man; const c = dev && dev.cal;
    if (c) {
      g('i1p-tgtnote').textContent = 'Auto exposure adjusts the integration time until the brightest pixel reads about ' + Math.round(num('i1p-tgt', 40500)) + ' counts (factory aim ' + c.sensTarget + ' × 0.9 = ' + Math.round(c.sensTarget * 0.9) + '; the CCD saturates at about ' + c.sat0 + '; readings are linearised and divided by the integration time). Range tried: ' + (dev.minInt * 1000).toFixed(2) + ' ms to ' + Math.min(num('i1p-maxauto', 2), c.maxInt).toFixed(1) + ' s.';
      const q = dev.quantize(num('i1p-mt', 50) / 1000);
      g('i1p-mtnote').textContent = 'The instrument counts in clock steps, so the real integration time is ' + (q * 1000).toFixed(3) + ' ms. Allowed: ' + (dev.minInt * 1000).toFixed(2) + ' ms to ' + (c.maxInt * 1000).toFixed(0) + ' ms. Too long saturates the sensor; the page then tells you to shorten it.';
    }
    sumUi();
  }
  for (const id of ['i1p-exm', 'i1p-tgt', 'i1p-mt', 'i1p-maxauto', 'i1p-n']) { g(id).onchange = exposureUi; g(id).oninput = exposureUi; }
  function mopts(extra) {
    const man = g('i1p-exm').value === 'manual';
    return Object.assign({ readTime: num('i1p-rt', 1), reuse: g('i1p-reuse').checked, targoscale: Math.min(0.98, Math.max(0.05, num('i1p-tgt', 40500) / dev.cal.sensTarget)), maxAutoTime: num('i1p-maxauto', 2),
      manualTime: man ? num('i1p-mt', 50) / 1000 : 0, progress: m => status('Measuring: ' + m) }, extra);
  }

  /* ---------- instrument info ---------- */
  function infoPanel() {
    if (!dev) return; const i = dev.describe(), cl = Object.values(i.clocks || {});
    g('i1p-info').innerHTML = kv('Serial', esc(i.serial)) + kv('Firmware', i.firmware) + kv('Integration', (i.minInt * 1000).toFixed(2) + ' ms – ' + i.maxInt.toFixed(2) + ' s') + kv('Target / saturation', i.sensTarget + ' / ' + i.sat0 + ' counts') + kv('Dark level', i.sensDark) +
      kv('Linearisation', Array.from(i.lin0).map(x => (+x).toExponential(3)).join(' ')) + kv('Clock modes', cl.length ? cl.map(m => m.usec + ' µs × ' + m.subclkdiv).join(' · ') : '–') + kv('Resets after timeouts', dev.recoveries) + kv('USB', esc((i.usb && i.usb.product) || '–'));
  }
  async function copyText(t) { try { await navigator.clipboard.writeText(t); return true; } catch (e) { const ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select(); let ok = false; try { ok = document.execCommand('copy'); } catch (er) { } ta.remove(); return ok; } }
  g('i1p-diag').onclick = async () => { if (!dev) { g('i1p-diagmsg').textContent = 'Connect first.'; return; } const ok = await copyText(dev.diagnostics()); g('i1p-diagmsg').textContent = ok ? 'Diagnostic log copied. Paste it into your report.' : 'Could not copy: use "Save log" instead.'; };
  g('i1p-diagsave').onclick = () => { if (dev) download('i1pro-diagnostics.txt', dev.diagnostics(), 'text/plain'); };

  /* ---------- dark / white ---------- */
  g('i1p-dark').onclick = async () => {
    if (!dev) return; setBusy(true); status('Dark calibration (about 5 s) — keep the sensor covered…');
    try { if (sim) sim.covered = true; await dev.calibrateDark({ progress: m => status('Dark calibration: ' + m) }); status(mode === 'rf' ? 'Dark calibration done. Next: white tile calibration.' : 'Dark calibration done. Point at the light and press Measure.', 'ok'); }
    catch (e) { status(explain(e), 'err'); }
    if (sim) sim.covered = false; setBusy(false); infoPanel(); chips();
  };
  g('i1p-white').onclick = async () => {
    if (!dev) return; setBusy(true); status('White tile calibration — instrument on the white tile…');
    try { if (sim) { sim.mode = 'reflective'; sim.target = 'white'; } const r = await dev.calibrateWhite({ progress: m => status('White calibration: ' + m) });
      status('White tile calibrated: ' + (r.inttime * 1000).toFixed(1) + ' ms, peak ' + Math.round(r.peakCounts) + ' counts. Now place the instrument flat on the sample and press Measure.', 'ok'); }
    catch (e) { status(explain(e), 'err'); }
    if (sim) sim.mode = 'emission'; setBusy(false); infoPanel(); chips();
  };

  /* ---------- measuring ---------- */
  g('i1p-meas').onclick = () => doMeasure();
  g('i1p-stop').onclick = () => { stopFlag = true; g('i1p-stop').disabled = true; };
  function warnings(r, rf) {
    const w = [];
    if (r.inconsistent) w.push('Frames varied by ' + ((r.variation || 0) * 100).toFixed(0) + '% (flicker / PWM or an unstable light). They were averaged; try a longer reading time or several readings.');
    if (r.headroom > 0.9) w.push('Sensor is close to saturation (' + (r.headroom * 100).toFixed(0) + '%).');
    if (r.peakCounts < 1500) w.push('Weak signal (peak ' + Math.round(r.peakCounts) + ' counts): noisy. ' + (rf ? 'Press the instrument flat on the sample.' : 'Move closer or use a longer exposure.'));
    if (r.darkAgeSec > 1200) w.push('Dark calibration is ' + Math.round(r.darkAgeSec / 60) + ' min old; recalibrate if readings drift.');
    if (rf && r.whiteAgeSec > 1800) w.push('White tile calibration is ' + Math.round(r.whiteAgeSec / 60) + ' min old.');
    if (r.exposureMode === 'auto' && r.targetCounts && r.peakCounts < 0.5 * r.targetCounts && r.inttime >= num('i1p-maxauto', 2) * 0.98) w.push('Auto exposure reached its longest allowed time (' + num('i1p-maxauto', 2) + ' s) without getting near the target: the light is dim. Raise "Longest auto time" or move closer.');
    return w;
  }
  async function doMeasure() {
    if (!dev || busy) return; const rf = mode === 'rf', cnt = Math.max(0, Math.floor(num('i1p-n', 1)));
    setBusy(true); pendingBtn = false; stopFlag = false; const multi = cnt !== 1; g('i1p-stop').hidden = !multi; g('i1p-stop').disabled = false; hist = []; live = null;
    try {
      status('Measuring…'); let r; const singles = [];
      if (rf) {
        if (sim) { sim.mode = 'reflective'; sim.target = 'sample'; }
        for (let i = 0; !cnt || i < cnt; i++) {
          if (stopFlag) break; const t0 = Date.now();
          const x = await dev.measureReflective({ readTime: Math.max(0.05, num('i1p-rt', 1) / 10), progress: m => status('Measuring: ' + m) }); singles.push(x);
          if (cnt && i === cnt - 1) break; for (let w = num('i1p-int', 0) * 1000 - (Date.now() - t0); w > 0 && !stopFlag; w -= 100) await wait(Math.min(100, w));
        }
        r = avgRefl(singles);
      } else {
        if (sim) sim.mode = 'emission';
        r = await dev.measureSeries(mopts({ count: cnt, intervalSec: num('i1p-int', 0), shouldStop: () => stopFlag, onSample: (x, i) => { singles.push(x); pushHist(x, emMetrics(x)); status('Reading ' + (i + 1) + (cnt ? ' of ' + cnt : '') + '…'); } }));
      }
      const typed = g('i1p-name').value.trim(), baseName = typed ? uniqueName(typed) : nextName(rf ? 'rf' : 'em');
      if (singles.length > 1 && g('i1p-each').checked) singles.forEach((x, i) => addMeasurement(makeMeasurement(x, baseName + ' #' + (i + 1), warnings(x, rf)), true));
      addMeasurement(makeMeasurement(r, baseName, warnings(r, rf)));
      if (singles.length > 1) { timeCard(); drawTime(); logText(); }
    } catch (e) { status(explain(e), 'err'); console.error(e); }
    if (sim) sim.mode = 'emission'; g('i1p-stop').hidden = true; setBusy(false); infoPanel(); chips();
    if (pendingBtn) { pendingBtn = false; doMeasure(); }
  }
  function avgRefl(list) {
    const k = list.length, first = list[0], avgAbs = new Float64Array(128), s36 = new Float64Array(36);
    for (const r of list) { for (let j = 0; j < 128; j++) avgAbs[j] += r.avgAbs[j] / k; for (let b = 0; b < 36; b++) s36[b] += r.s36[b] / k; }
    return Object.assign({}, first, { avgAbs, s36, nSamples: k, samples: list, nFrames: list.reduce((a, r) => a + r.nFrames, 0), peakCounts: Math.max(...list.map(r => r.peakCounts)), headroom: Math.max(...list.map(r => r.headroom)), inconsistent: list.some(r => r.inconsistent), elapsedMs: list.reduce((a, r) => a + r.elapsedMs, 0) });
  }

  /* ---------- history / time plots ---------- */
  const METRICS = [['Y', 'Brightness (cd/m²)', 'cd/m²'], ['rad', 'Radiant power (mW/m²)', 'mW/m²'], ['ppfd', 'Photon flux (µmol/m²/s)', 'µmol/m²/s'], ['cct', 'CCT (K)', 'K'], ['duv', 'Duv', ''], ['x', 'CIE x', ''], ['y', 'CIE y', ''], ['up', "u′", ''], ['vp', "v′", ''], ['Ra', 'CRI Ra', ''], ['R9', 'CRI R9', ''], ['Rf', 'TM-30 Rf', ''], ['Rg', 'TM-30 Rg', ''], ['pk', 'Strongest peak (nm)', 'nm'], ['peakCounts', 'Peak sensor counts', ''], ['inttime', 'Integration time (ms)', 'ms']];
  for (const id of ['i1p-ma', 'i1p-mb']) g(id).innerHTML = (id === 'i1p-mb' ? '<option value="">(none)</option>' : '') + METRICS.map(m => '<option value="' + m[0] + '">' + m[1] + '</option>').join('');
  g('i1p-ma').value = 'Y'; g('i1p-mb').value = 'cct';
  function pushHist(x, m) { hist.push({ t: x.when || Date.now(), m, s36: Float32Array.from(x.s36) }); const keep = Math.max(20, Math.floor(num('i1p-keep', 600))); while (hist.length > keep) hist.shift(); g('i1p-logcsv').disabled = false; }
  function timeCard() { g('i1p-timecard').hidden = hist.length < 2; if (hist.length >= 2) drawTime(); }
  function drawTime() {
    const A = g('i1p-ma').value, B = g('i1p-mb').value; if (!hist.length) { tPlot.set([], [], [0, 1]); return; }
    const t0 = hist[0].t, xs = hist.map(h => (h.t - t0) / 1000), ser = [];
    const mk = (id, axis, color) => { const d = METRICS.find(m => m[0] === id); if (!d) return; ser.push({ x: xs, y: hist.map(h => h.m[id] == null ? NaN : h.m[id]), axis, color, name: d[1].replace(/ \(.*\)/, ''), unit: d[2], pts: hist.length < 40 }); };
    mk(A, 'l', null); if (B) mk(B, 'r', 'alt'); tPlot.set(ser, [], [0, Math.max(1, xs[xs.length - 1])]);
  }
  g('i1p-ma').onchange = g('i1p-mb').onchange = drawTime;
  g('i1p-histclear').onclick = () => { hist = []; g('i1p-log').textContent = ''; g('i1p-logcsv').disabled = true; timeCard(); };
  g('i1p-logcsv').onclick = () => {
    if (!hist.length) return; const ids = METRICS.map(m => m[0]), t0 = hist[0].t, L = ['index,time_iso,seconds,' + ids.join(',') + ',' + WL36.map(w => 'b' + w).join(',')];
    hist.forEach((h, i) => L.push([i + 1, new Date(h.t).toISOString(), ((h.t - t0) / 1000).toFixed(3), ...ids.map(k => h.m[k] == null ? '' : +(+h.m[k]).toPrecision(7)), ...Array.from(h.s36, v => v.toPrecision(6))].join(',')));
    download('i1pro-history.csv', L.join('\n') + '\n', 'text/csv');
  };
  function logText() { const t0 = hist[0].t, rows = hist.slice(-60); g('i1p-log').textContent = rows.map(h => '+' + ((h.t - t0) / 1000).toFixed(1).padStart(7) + ' s  ' + h.m.inttime.toFixed(1).padStart(7) + ' ms  Y ' + fmtN(h.m.Y).padStart(7) + (h.m.cct ? '  CCT ' + Math.round(h.m.cct) + ' K  Duv ' + h.m.duv.toFixed(4) : '')).join('\n'); g('i1p-log').scrollTop = 1e9; }

  /* ---------- live recording ---------- */
  let avg = { list: [], n: 0, a: null, s: null, sr: null };
  function resetAvg() { avg = { list: [], n: 0, a: null, s: null, sr: null }; }
  g('i1p-am').onchange = () => { g('i1p-wn-f').hidden = g('i1p-am').value !== 'roll'; resetAvg(); }; g('i1p-wn').onchange = resetAvg; g('i1p-avgreset').onclick = resetAvg;
  function fold(x) {
    const md = g('i1p-am').value; if (md === 'none') return x;
    if (md === 'roll') { avg.list.push(x); const N = Math.max(2, Math.floor(num('i1p-wn', 5))); while (avg.list.length > N) avg.list.shift(); return avg.list.length > 1 ? I1Pro.averageResults(avg.list) : x; }
    avg.n++; const n = avg.n;
    if (!avg.a) { avg.a = Float64Array.from(x.avgAbs); avg.s = Float64Array.from(x.s36); avg.sr = Float64Array.from(x.s36raw || x.s36); }
    else { for (let j = 0; j < 128; j++) avg.a[j] += (x.avgAbs[j] - avg.a[j]) / n; for (let b = 0; b < 36; b++) { avg.s[b] += (x.s36[b] - avg.s[b]) / n; avg.sr[b] += ((x.s36raw || x.s36)[b] - avg.sr[b]) / n; } }
    return Object.assign({}, x, { avgAbs: avg.a, s36: avg.s, s36raw: avg.sr, nSamples: n });
  }
  function liveSpec(r) { const P = activePreset(); if (P.id === 'std10') return { wl: WL36, v: Array.from(r.s36) }; const rs = dev.resampler(P.opts); return { wl: Array.from(rs.wl), v: Array.from(rs.apply(r.avgAbs)) }; }
  g('i1p-live').onclick = async () => {
    if (liveOn) { stopFlag = true; return; } if (!dev || busy || mode === 'rf') return;
    liveOn = true; stopFlag = false; setBusy(true); resetAvg(); hist = []; live = null; g('i1p-log').textContent = '';
    g('i1p-live').disabled = false; g('i1p-live').textContent = '■ Stop live recording'; g('i1p-live').classList.remove('primary'); g('i1p-meas').disabled = true; g('i1p-stop').hidden = true; if (sim) sim.mode = 'emission';
    let cnt = 0, lastRender = null, errored = false; const t0 = Date.now(); let tl = t0;
    try {
      while (!stopFlag) {
        const x = await dev.measure(mopts({ readTime: Math.max(0.02, num('i1p-lrt', 0.2)), reuse: true, progress: () => { } }));
        cnt++; const a = fold(x), m = emMetrics(a); lastRender = a;
        live = { r: a, m, spec: liveSpec(a), warn: warnings(a, false) }; if (g('i1p-inst').checked && a !== x) live.inst = liveSpec(x);
        pushHist(a, m); g('i1p-snap').disabled = false; drawMain(); renderDetail();
        if (hist.length === 2 || cnt % 2 === 0 || Date.now() - tl > 400) { timeCard(); logText(); tl = Date.now(); }
        const md = g('i1p-am').value, k = md === 'roll' ? avg.list.length : md === 'cum' ? avg.n : 1;
        g('i1p-livenote').textContent = (cnt / ((Date.now() - t0) / 1000)).toFixed(1) + ' updates/s · ' + (x.inttime * 1000).toFixed(1) + ' ms × ' + x.nFrames + (md !== 'none' ? ' · mean of ' + k : '');
        status('Live · ' + cnt + ' readings' + (m && m.cct ? ' · ' + Math.round(m.cct) + ' K · Y ' + fmtN(m.Y) : ''), 'ok'); await wait(0);
      }
    } catch (e) { errored = true; status(explain(e), 'err'); console.error(e); }
    timeCard(); if (hist.length) logText();
    const had = lastRender; liveOn = false; g('i1p-live').textContent = '▶ Start live recording'; g('i1p-live').classList.add('primary'); g('i1p-livenote').textContent = ''; setBusy(false); infoPanel(); chips();
    if (had && g('i1p-livesnap').checked) { addSnapshot(had, true); if (!errored) status('Live recording stopped after ' + cnt + ' readings; the averaged spectrum is in the table.', 'ok'); } else if (!errored) status('Live recording stopped after ' + cnt + ' readings.', 'ok');
    live = had ? live : null; g('i1p-snap').disabled = !live; liveOn = false; renderAll();
  };
  function addSnapshot(a, quiet) {
    const typed = g('i1p-name').value.trim(), nm = typed ? uniqueName(typed) : nextName('em');
    addMeasurement(makeMeasurement(a, nm, warnings(a, false)), quiet);
  }
  g('i1p-snap').onclick = () => { if (live) { addSnapshot(live.r, false); } };

  /* ---------- source (blackbody) calibration ---------- */
  function srcUi() { const k = g('i1p-rk').value; g('i1p-rload').hidden = k !== 'custom'; g('i1p-rT').disabled = k === 'custom'; }
  g('i1p-rk').onchange = srcUi; srcUi();
  g('i1p-rload').onclick = () => g('i1p-rfile').click();
  g('i1p-rfile').onchange = async e => {
    const f = e.target.files[0]; if (!f) return; const wl = [], v = [];
    for (const ln of (await f.text()).split(/\r?\n/)) { const p = ln.split(/[,;\t ]+/).map(parseFloat); if (isFinite(p[0]) && isFinite(p[1])) { wl.push(p[0]); v.push(p[1]); } }
    if (wl.length < 4) { g('i1p-rinfo').textContent = 'Could not read at least 4 wavelength,value rows from that file.'; return; }
    userRef = { wl, v, name: f.name }; g('i1p-rinfo').textContent = 'Reference loaded: ' + f.name + ' (' + wl.length + ' points, ' + wl[0] + '–' + wl[wl.length - 1] + ' nm).'; e.target.value = '';
  };
  function refBands() {
    const k = g('i1p-rk').value; if (k !== 'custom') return I1Pro.referenceBands(k, num('i1p-rT', 2856));
    if (!userRef) throw new Error('Load a reference CSV first.'); const { wl, v } = userRef;
    return WL36.map(nm => { if (nm <= wl[0]) return v[0]; if (nm >= wl[wl.length - 1]) return v[v.length - 1]; let j = 1; while (wl[j] < nm) j++; return v[j - 1] + (v[j] - v[j - 1]) * (nm - wl[j - 1]) / (wl[j] - wl[j - 1]); });
  }
  g('i1p-rcal').onclick = async () => {
    if (!dev || busy) return; setBusy(true);
    try {
      status('Measuring the reference source…'); const ref = refBands(); if (sim) sim.mode = 'emission'; dev.setCorrection(null);
      const r = await dev.measure(mopts({ reuse: false, count: 0 })), cc = I1Pro.computeCorrection(r.s36raw, ref);
      srcMeta = { kind: g('i1p-rk').value, T: num('i1p-rT', 2856), date: Date.now(), lo: cc.lo, hi: cc.hi, serial: dev.cal.serial };
      dev.setCorrection(cc.c, true, srcMeta); corrUi(); status('Source calibration done: the correction is ON (reliable between ' + cc.lo + ' and ' + cc.hi + ' nm). Now measure your light; you can switch the correction off in the Instrument box.', 'ok');
    } catch (e) { status(explain(e), 'err'); }
    setBusy(false); infoPanel();
  };
  g('i1p-rclr').onclick = () => { if (dev) dev.setCorrection(null); srcMeta = null; corrUi(); infoPanel(); };
  g('i1p-rsave').onclick = () => {
    if (!dev || !dev.userCorr) return; const p = JSON.stringify({ type: 'i1pro-source-correction', serial: dev.cal.serial, meta: dev.userCorr.meta, c: Array.from(dev.userCorr.c) });
    lstore.set('i1p-corr-' + dev.cal.serial, p); download('i1pro-correction-' + dev.cal.serial + '.json', p, 'application/json'); g('i1p-rinfo').textContent += ' · profile saved (also kept in this browser).';
  };
  g('i1p-rload2').onclick = () => g('i1p-rpf').click();
  g('i1p-rpf').onchange = async e => { const f = e.target.files[0]; if (!f || !dev) return; try { applyProfile(JSON.parse(await f.text())); } catch (er) { g('i1p-rinfo').textContent = 'Not a valid correction profile.'; } e.target.value = ''; };
  function applyProfile(p) { if (!p || p.type !== 'i1pro-source-correction' || !Array.isArray(p.c) || p.c.length !== 36) throw new Error('bad'); srcMeta = p.meta || {}; dev.setCorrection(p.c, true, srcMeta); corrUi(); }
  function loadProfile(quiet) { const s = lstore.get('i1p-corr-' + dev.cal.serial); if (!s) return; try { applyProfile(JSON.parse(s)); dev.userCorr.enabled = false; corrUi(); } catch (e) { } }
  function showCorr() {
    const u = dev && dev.userCorr; g('i1p-rclr').disabled = !u; g('i1p-rsave').disabled = !u;
    const cv = g('i1p-cv4'), w = Math.max(200, cv.clientWidth || 300), h = 80, dpr = Math.min(devicePixelRatio || 1, 2); cv.width = w * dpr; cv.height = h * dpr; const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, h);
    if (!u) { g('i1p-rinfo').textContent = 'No source correction.'; return; }
    const T = THEME(), lo = Math.min(...u.c), hi = Math.max(...u.c), sp = (hi - lo) || 1;
    c.strokeStyle = u.enabled ? T.acc : T.muted; c.lineWidth = 1.8; c.beginPath(); Array.from(u.c).forEach((y, i) => { const X = 4 + i / 35 * (w - 8), Y = h - 14 - (y - lo) / sp * (h - 26); i ? c.lineTo(X, Y) : c.moveTo(X, Y); }); c.stroke();
    c.fillStyle = T.muted; c.font = '11px system-ui,sans-serif'; c.fillText('multiplier per band, 380 → 730 nm: ' + lo.toFixed(2) + ' … ' + hi.toFixed(2), 4, h - 2);
    const m = u.meta || {}; g('i1p-rinfo').textContent = (m.kind ? m.kind + (m.T ? ' ' + m.T + ' K' : '') + ', ' : '') + (m.date ? new Date(m.date).toLocaleString() + ', ' : '') + (u.enabled ? 'applied' : 'not applied') + (m.lo ? ' · reliable ' + m.lo + '–' + m.hi + ' nm (outside, the nearest value is held; treat with care)' : '');
  }

  /* ---------- absolute level calibration ---------- */
  function absUi() {
    const u = dev && dev.absCal, on = !!(u && u.enabled), ch = g('i1p-achip'); g('i1p-aon').disabled = !u; g('i1p-aon').checked = on; g('i1p-abar').classList.toggle('on', on);
    if (!u) { ch.textContent = 'none · factory scale (assumed mW/m²/nm, unchecked)'; ch.className = 'chip'; }
    else { ch.textContent = (on ? 'ON' : 'OFF') + ' · × ' + fmtN(u.k) + (u.meta && u.meta.kind ? ' · ' + u.meta.kind : ''); ch.className = 'chip ' + (on ? 'ok' : 'warn'); }
    g('i1p-aclr').disabled = !u; g('i1p-aon').title = 'Applies to the next light measurements; measurements already in the table keep what they were taken with.';
    g('i1p-ainfo').textContent = u ? (u.meta.kind || '') + ' · factor ' + u.k.toPrecision(5) + (u.meta.unit === 'power' ? ' · results are power at the sensor (mW/nm), no beam area was given' : ' · results in mW/m²/nm') + (u.meta.date ? ' · ' + new Date(u.meta.date).toLocaleString() : '') + (on ? ' · applied' : ' · not applied') : 'No absolute calibration.';
  }
  function absKindUi() {
    const k = g('i1p-ak').value, show = (id, v) => { g(id).hidden = !v; };
    show('i1p-av-f', k === 'lum' || k === 'irr'); show('i1p-al-f', k === 'laser'); show('i1p-aw-f', k === 'laser'); show('i1p-ah-f', k === 'laser'); show('i1p-aa-f', k === 'laser'); show('i1p-am2-f', k === 'man');
    g('i1p-anote').textContent = k === 'lum' ? 'Point the instrument at the source exactly as the luminance meter was (same spot, same distance). The factor is the known cd/m² divided by what this page reads.'
      : k === 'irr' ? 'The factor is the known radiant power per area divided by the page\'s reading (380-780 nm).'
      : k === 'laser' ? 'The laser must be fully inside the instrument\'s opening and its power known at that point (mW). The narrow line is integrated over the window, so the instrument\'s resolution does not matter. With the beam area on the sensor in mm² the results are calibrated in mW/m²/nm; without it they are power at the sensor (mW/nm) and brightness is shown in lm. Reflections, a diffuse beam or a partly covered opening make this an estimate.'
      : 'Multiplies every following light measurement by this number.';
    const lab = g('i1p-av-f'); lab.firstChild.textContent = k === 'irr' ? 'Known value (mW/m²) ' : 'Known value (cd/m²) ';
  }
  g('i1p-ak').onchange = absKindUi; absKindUi();
  g('i1p-acal').onclick = async () => {
    if (!dev || busy) return; const kind = g('i1p-ak').value; setBusy(true); const keep = dev.absCal;
    try {
      let k, meta = { date: Date.now(), serial: dev.cal.serial, unit: 'irr' };
      if (kind === 'man') { k = num('i1p-am2', 1); meta.kind = 'entered by hand'; if (!(k > 0)) throw new Error('The factor must be positive.'); }
      else {
        status('Measuring the reference…'); if (sim) sim.mode = 'emission'; dev.absCal = null;
        const r = await dev.measure(mopts({ reuse: false, count: 0 }));
        if (kind === 'lum') { const m = emMetrics(r); k = I1Pro.absoluteFactor(m.Y, num('i1p-av', 100)); meta.kind = 'brightness ' + num('i1p-av', 100) + ' cd/m²'; }
        else if (kind === 'irr') { const m = emMetrics(r); k = I1Pro.absoluteFactor(m.rad, num('i1p-av', 100)); meta.kind = 'radiant power ' + num('i1p-av', 100) + ' mW/m²'; }
        else {
          const rs = dev.resampler({ lo: 380, hi: 730, step: 0.5, kernel: 'argyll', argyllWidth: 3.33 }), v = Array.from(rs.apply(r.avgAbs), x => Math.max(0, x)), wl = Array.from(rs.wl);
          let l0 = num('i1p-aw', 0); if (!(l0 > 0)) { let bi = 0; v.forEach((x, i) => { if (x > v[bi]) bi = i; }); l0 = wl[bi]; }
          const hw = num('i1p-ah', 15), E = I1Pro.bandIntegral(wl, v, l0 - hw, l0 + hw), P = num('i1p-ap', 1), A = num('i1p-aa', 0);
          if (!(E > 0)) throw new Error('No laser light seen around ' + l0.toFixed(1) + ' nm.');
          const tot = I1Pro.bandIntegral(wl, v, 380, 730); if (E < 0.8 * tot) status('Warning: only ' + Math.round(100 * E / tot) + '% of the light is inside the window; other light is present, so the factor may be too high.', 'warn');
          if (A > 0) { k = I1Pro.absoluteFactor(E, P / (A * 1e-6)); meta.kind = 'laser ' + P + ' mW @ ' + l0.toFixed(1) + ' nm on ' + A + ' mm²'; }
          else { k = I1Pro.absoluteFactor(E, P); meta.unit = 'power'; meta.kind = 'laser ' + P + ' mW @ ' + l0.toFixed(1) + ' nm (no area)'; }
        }
      }
      dev.setAbsCal(k, true, meta); lstore.set('i1p-abs-' + dev.cal.serial, JSON.stringify({ k, meta })); absUi(); infoPanel();
      status('Absolute level calibrated: factor ' + k.toPrecision(5) + ' is ON for the next light measurements.', 'ok');
    } catch (e) { dev.absCal = keep; status(explain(e), 'err'); }
    if (sim) sim.mode = 'emission'; setBusy(false); absUi(); infoPanel();
  };
  g('i1p-aclr').onclick = () => { if (dev) { dev.setAbsCal(null); lstore.set('i1p-abs-' + dev.cal.serial, ''); absUi(); infoPanel(); } };
  g('i1p-aon').onchange = () => { if (dev && dev.absCal) { dev.absCal.enabled = g('i1p-aon').checked; absUi(); infoPanel(); status(dev.absCal.enabled ? 'Absolute level calibration is ON for new light measurements.' : 'Absolute level calibration is OFF: new light measurements use the factory scale.', 'ok'); } };
  function loadAbs() { try { const s = lstore.get('i1p-abs-' + dev.cal.serial); if (!s) return; const o = JSON.parse(s); if (o && o.k > 0) dev.setAbsCal(o.k, false, o.meta || {}); } catch (e) { } }

  /* ---------- blackbody at several temperatures ---------- */
  let bbList = [], bbRes = null;
  function bbUi() {
    const tb = g('i1p-btab').querySelector('tbody'), an = +g('i1p-bas').value || 0;
    tb.innerHTML = bbList.map((x, i) => '<tr><td>' + (i + 1) + '</td><td>' + (x.est ? x.est + ' K' : '–') + '</td><td>' + Math.round(x.peak) + '</td><td>' + (bbRes ? Math.round(bbRes.T[i]) + ' K' : '–') + '</td><td>' + (bbRes && bbRes.gauge === 'anchor' && bbRes.anchorIndex === i ? '●' : '') + '</td></tr>').join('');
    g('i1p-bas').innerHTML = bbList.map((_, i) => '<option value="' + i + '">' + (i + 1) + '</option>').join(''); g('i1p-bas').value = String(Math.min(an, Math.max(0, bbList.length - 1)));
    g('i1p-bclr').disabled = !bbList.length; g('i1p-bfit').disabled = bbList.length < 3; g('i1p-buse').disabled = !bbRes;
  }
  g('i1p-badd').onclick = async () => {
    if (!dev || busy) return; setBusy(true);
    try { status('Measuring…'); if (sim) sim.mode = 'emission'; const r = await dev.measure(mopts({ reuse: false, count: 0 })); bbList.push({ est: num('i1p-bt', 0) || null, s36: Array.from(r.s36raw), peak: r.peakCounts }); bbRes = null; g('i1p-binfo').textContent = bbList.length + ' step(s) captured.' + (bbList.length < 3 ? ' Add at least ' + (3 - bbList.length) + ' more.' : ''); status('Temperature step ' + bbList.length + ' captured.', 'ok'); }
    catch (e) { status(explain(e), 'err'); }
    setBusy(false); bbUi(); infoPanel();
  };
  g('i1p-bclr').onclick = () => { bbList = []; bbRes = null; g('i1p-binfo').textContent = ''; bbUi(); };
  g('i1p-bfit').onclick = () => {
    try {
      const at = num('i1p-ban', 0), ai = +g('i1p-bas').value || 0;
      const res = I1Pro.fitBlackbodyTemperatures(bbList.map(x => ({ v: x.s36, T0: x.est || undefined })), { lo: num('i1p-blo', 430), hi: num('i1p-bhi', 710), anchorIndex: at > 0 ? ai : -1, anchorT: at > 0 ? at : 0 });
      res.anchorIndex = ai; bbRes = res; const d = res.T.map((T, i) => i ? ' · step ' + (i + 1) + ' vs 1: ' + (res.T[i] - res.T[0] > 0 ? '+' : '') + Math.round(res.T[i] - res.T[0]) + ' K' : '').join('');
      g('i1p-binfo').innerHTML = 'Fitted: <b>' + res.T.map(T => Math.round(T) + ' K').join(', ') + '</b> (residual ' + (res.resid * 100).toFixed(2) + '% rms over ' + res.nBands + ' bands, ' + res.lo + '–' + res.hi + ' nm).' + (res.gauge === 'anchor'
        ? ' Anchored: step ' + (ai + 1) + ' = ' + at + ' K.' : ' <b>No anchor:</b> the steps between the temperatures are exact, but the absolute values assume the factory colour calibration and a grey emitter (typical error a few percent). Enter the true temperature of one step to fix them.') + (res.resid > 0.02 ? ' The residual is large: the lamp may not be a thermal emitter, or the light changed between steps.' : '');
      bbUi();
    } catch (e) { g('i1p-binfo').textContent = explain(e); }
  };
  g('i1p-buse').onclick = () => {
    if (!dev || !bbRes) return; const T = Math.round(bbRes.T.reduce((a, b) => a + b, 0) / bbRes.T.length);
    srcMeta = { kind: 'blackbody, ' + bbRes.T.length + '-temperature fit' + (bbRes.gauge === 'anchor' ? ' (anchored)' : ''), T: undefined, date: Date.now(), lo: bbRes.lo, hi: bbRes.hi, serial: dev.cal.serial };
    dev.setCorrection(bbRes.corr, true, srcMeta); corrUi(); infoPanel(); status('The correction from the temperature series is ON for the next light measurements.', 'ok');
  };
  g('i1p-bas').onchange = () => { bbRes = null; bbUi(); }; bbUi();

  /* ---------- EEPROM ---------- */
  const sameEE = () => origEE && dev && dev.eeprom.length === origEE.length && dev.eeprom.every((b, i) => b === origEE[i]);
  function eeButtons() { g('i1p-eereset').disabled = busy || !dev || !origEE || sameEE(); }
  function eeInfo() { if (!dev) return; g('i1p-eeinfo').textContent = (sameEE() ? 'Using the instrument\'s own calibration' : 'Using an IMPORTED calibration (not the instrument\'s own)') + ' · serial ' + dev.cal.serial + ' · ' + dev.eeprom.length + ' bytes.'; eeButtons(); }
  g('i1p-eebin').onclick = () => dev && download('i1pro-eeprom-' + dev.cal.serial + '.bin', dev.eeprom, 'application/octet-stream');
  g('i1p-eehex').onclick = () => dev && download('i1pro-eeprom-' + dev.cal.serial + '.txt', I1Pro.eepromToHexDump(dev.eeprom), 'text/plain');
  g('i1p-eeload').onclick = () => g('i1p-eefile').click();
  g('i1p-eefile').onchange = async e => {
    const f = e.target.files[0]; e.target.value = ''; if (!f || !dev) return; setBusy(true);
    try {
      const buf = new Uint8Array(await f.arrayBuffer()), head = buf.subarray(0, 400); let ascii = 0; for (const b of head) if ((b >= 32 && b < 127) || b === 10 || b === 13 || b === 9) ascii++;
      const u8 = ascii > head.length * 0.97 ? I1Pro.parseEEPROMText(new TextDecoder().decode(buf)) : buf;
      if (u8.length < 0x1e08) throw new Error('That file holds only ' + u8.length + ' bytes; at least ' + 0x1e08 + ' are needed.');
      dev.loadEEPROM(u8); eeRegister(); hist = []; timeCard(); live = null; eeInfo(); infoPanel(); exposureUi(); chips(); corrUi();
      status('Calibration loaded from ' + f.name + ' (serial ' + dev.cal.serial + '). Dark and white calibrations were cleared: repeat them.', 'ok');
    } catch (er) { status('Could not load calibration: ' + (er.message || er), 'err'); }
    setBusy(false);
  };
  g('i1p-eereset').onclick = () => { if (!dev || !origEE) return; dev.loadEEPROM(Uint8Array.from(origEE)); eeRegister(); eeInfo(); infoPanel(); exposureUi(); chips(); status('Back to the instrument\'s own calibration. Repeat the dark and white calibrations.', 'ok'); };

  /* ---------- tab show / resize / start ---------- */
  for (const id of ['i1p-pkn', 'i1p-pkp']) g(id).onchange = () => renderAll();
  root.addEventListener('change', e => { if (e.target.id && PREF.includes(e.target.id)) savePrefs(); });
  window.I1P_debug = { get dev() { return dev; }, get sim() { return sim; } };   // for tests and the console
  window.I1P_onShow = () => requestAnimationFrame(() => { try { renderAll(); drawTime(); showCorr(); } catch (e) { console.warn(e); } });
  addEventListener('resize', () => { try { if (!root.hidden) { for (const p of Plot.all) p.draw(); showCorr(); } } catch (e) { } });
  if (typeof TABS !== 'undefined') { TABS.meas = { view: 'view-meas', btn: 't-meas', hash: '#measure' }; g('t-meas').onclick = () => showTab('meas'); }
  loadPrefs(); resUi(); exposureUi(); srcUi(); g('i1p-wn-f').hidden = g('i1p-am').value !== 'roll'; spPlot.log = g('i1p-log10').checked;
  shown(false); renderAll(); loadSaved();
  if (location.hash === '#measure') showTab('meas');
})();
