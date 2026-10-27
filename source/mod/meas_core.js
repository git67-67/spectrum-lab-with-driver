/* LED Spectrum Lab - measurement store and model
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Shared by lab.html (analysis) and measure.html (live measurement). Both pages open the same IndexedDB
 * database in the same browser profile and keep each other up to date (BroadcastChannel + storage event + a slow poll).
 *
 * Data model
 *   measurement ("shot")  one spectrum from the instrument      { id, gid, t, wl0, step, v[mW/m2/nm], px[128], inc, inst{} }
 *   group                 one operating condition of one LED    { id, name, dut, cur[mA], volt[V], pow[W], temp[C], G[m2], tags, note, extra[] }
 *   A group is shown as ONE measurement (the mean of its included shots); the shots stay available.
 *   Several groups of the same LED (different current / voltage / temperature) are compared in X-Y plots and overlays.
 */
(function () {
'use strict';
var L = window.LSL, A = window.APP;
var M = A.M = { groups: {}, meas: {}, kv: {}, persistent: false, ready: false, tabId: 't' + Math.random().toString(36).slice(2, 8), DB: 'led-spectrum-lab-measurements', _cbs: [], _byG: null, _pending: {}, _batch: 0, _dirty: false };
var db = null, bc = null, reloadT = null, fireT = null, queue = Promise.resolve(), lastVer = null;

/* ------------------------------------------------------------------ persistence */
function openDB() {
  return new Promise(function (res, rej) {
    if (!window.indexedDB) return rej(new Error('IndexedDB is not available in this browser context'));
    var rq;
    try { rq = indexedDB.open(M.DB, 1); } catch (e) { return rej(e); }
    rq.onupgradeneeded = function () { var d = rq.result; d.createObjectStore('groups', { keyPath: 'id' }); var s = d.createObjectStore('meas', { keyPath: 'id' }); s.createIndex('gid', 'gid'); d.createObjectStore('kv', { keyPath: 'k' }); };
    rq.onsuccess = function () { res(rq.result); }; rq.onerror = function () { rej(rq.error); }; rq.onblocked = function () { rej(new Error('database blocked by another tab')); };
  });
}
function getAll(store) { return new Promise(function (res, rej) { var r = db.transaction(store).objectStore(store).getAll(); r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); }; }); }
function writeOps(ops) {
  return new Promise(function (res, rej) {
    var names = {}; ops.forEach(function (o) { names[o.s] = 1; }); names.kv = 1;
    var tx = db.transaction(Object.keys(names), 'readwrite');
    ops.forEach(function (o) { var os = tx.objectStore(o.s); if (o.del != null) os.delete(o.del); else os.put(o.put); });
    lastVer = M.tabId + ':' + Date.now() + ':' + Math.random().toString(36).slice(2, 5);
    tx.objectStore('kv').put({ k: 'ver', v: lastVer });
    tx.oncomplete = function () { res(); }; tx.onerror = tx.onabort = function () { rej(tx.error || new Error('write failed')); };
  });
}
function persist(ops) {
  if (!db) return;
  queue = queue.then(function () { return writeOps(ops); }).then(broadcast, function (e) { console.error('measurement store write failed', e); A.toast('Could not save to the browser database: ' + (e && e.message), 'err'); });
}
function broadcast() {
  try { if (bc) bc.postMessage({ from: M.tabId, ver: lastVer }); } catch (e) { }
  try { localStorage.setItem('lsm.ping', M.tabId + ':' + Date.now()); } catch (e) { }
}
function scheduleReload() { clearTimeout(reloadT); reloadT = setTimeout(function () { M.reload().then(function () { fire(true); }); }, 60); }

M.reload = function () {
  if (!db) return Promise.resolve();
  return Promise.all([getAll('groups'), getAll('meas'), getAll('kv')]).then(function (r) {
    var g = {}, m = {}, k = {};
    r[0].forEach(function (x) { g[x.id] = M._pending[x.id] ? (M.groups[x.id] || x) : x; });
    Object.keys(M._pending).forEach(function (id) { if (M.groups[id] && !g[id]) g[id] = M.groups[id]; });
    r[1].forEach(function (x) { m[x.id] = x; });
    r[2].forEach(function (x) { k[x.k] = x.v; });
    M.groups = g; M.meas = m; M.kv = k; lastVer = k.ver || lastVer; M._byG = null; M._gC = {}; M._aC = {};
  });
};
M.init = function () {
  return openDB().then(function (d) { db = d; M.persistent = true; return M.reload(); }).catch(function (e) {
    M.persistent = false; M.error = e; console.warn('measurement store: memory only', e);
  }).then(function () {
    try { bc = new BroadcastChannel('led-spectrum-lab'); bc.onmessage = function (ev) { if (ev.data && ev.data.from !== M.tabId) scheduleReload(); }; } catch (e) { bc = null; }
    window.addEventListener('storage', function (e) { if (e.key === 'lsm.ping' && e.newValue && e.newValue.split(':')[0] !== M.tabId) scheduleReload(); });
    // last resort (e.g. file:// pages that cannot see each other's events): look at the version counter every 2 s
    setInterval(function () {
      if (!db || document.hidden) return;
      var r; try { r = db.transaction('kv').objectStore('kv').get('ver'); } catch (e) { return; }
      r.onsuccess = function () { var v = r.result && r.result.v; if (v && v !== lastVer && String(v).split(':')[0] !== M.tabId) scheduleReload(); };
    }, 2000);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) scheduleReload(); });
    M.ready = true;
  });
};

/* ------------------------------------------------------------------ change notification */
M.onChange = function (f) { M._cbs.push(f); };
function fire(remote) { M._byG = null; M._cbs.forEach(function (f) { try { f(!!remote); } catch (e) { console.error(e); } }); }
function changed() { M._byG = null; if (M._batch) { M._dirty = true; return; } clearTimeout(fireT); fireT = setTimeout(function () { fire(false); }, 0); }
M.batch = function (fn) { M._batch++; try { fn(); } finally { M._batch--; if (!M._batch && M._dirty) { M._dirty = false; changed(); } } };

/* ------------------------------------------------------------------ mutators */
function uid(p) { return (p || 'x') + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4); }
M.uid = uid;
M.putGroup = function (g) { g.updated = Date.now(); M.groups[g.id] = g; delete M._pending[g.id]; persist([{ s: 'groups', put: g }]); changed(); return g; };
var saveT = {};
M.saveGroupSoon = function (g) { // used while typing: instant local update, delayed write
  g.updated = Date.now(); M.groups[g.id] = g; M._pending[g.id] = true; changed();
  clearTimeout(saveT[g.id]); saveT[g.id] = setTimeout(function () { var cur = M.groups[g.id]; if (cur) M.putGroup(cur); }, 350);
};
M.putMeas = function (m) { M.meas[m.id] = m; persist([{ s: 'meas', put: m }]); changed(); return m; };
M.delMeas = function (id) { delete M.meas[id]; persist([{ s: 'meas', del: id }]); changed(); };
M.delGroup = function (id, withShots) {
  var ops = [{ s: 'groups', del: id }];
  M.members(id).forEach(function (m) { if (withShots) { delete M.meas[m.id]; ops.push({ s: 'meas', del: m.id }); } else { m.gid = null; ops.push({ s: 'meas', put: m }); } });
  delete M.groups[id]; delete M._pending[id]; persist(ops); changed();
};
M.setKV = function (k, v) { M.kv[k] = v; persist([{ s: 'kv', put: { k: k, v: v } }]); changed(); };
M.moveShots = function (ids, gid) { var ops = []; ids.forEach(function (id) { var m = M.meas[id]; if (m) { m.gid = gid; ops.push({ s: 'meas', put: m }); } }); persist(ops); changed(); };
M.mergeGroups = function (ids, intoId) { // all shots of the groups in ids go into intoId; the other groups are removed
  var ops = [];
  ids.forEach(function (id) { if (id === intoId) return; M.members(id).forEach(function (m) { m.gid = intoId; ops.push({ s: 'meas', put: m }); }); delete M.groups[id]; ops.push({ s: 'groups', del: id }); });
  persist(ops); changed();
};
M.setting = function (k, d) { var s = M.kv.settings; return s && s[k] !== undefined && s[k] !== null ? s[k] : d; };
M.setSetting = function (k, v) { var s = Object.assign({}, M.kv.settings || {}); s[k] = v; M.setKV('settings', s); };

/* ------------------------------------------------------------------ queries */
function byGroup() { if (!M._byG) { var o = {}; Object.keys(M.meas).forEach(function (id) { var m = M.meas[id]; if (m.gid) (o[m.gid] = o[m.gid] || []).push(m); }); Object.keys(o).forEach(function (k) { o[k].sort(function (a, b) { return a.t - b.t; }); }); M._byG = o; } return M._byG; }
M.members = function (gid) { return byGroup()[gid] || []; };
M.included = function (gid) { return M.members(gid).filter(function (m) { return m.inc !== false; }); };
M.lastT = function (g) { var mm = M.members(g.id); return mm.length ? mm[mm.length - 1].t : g.created || 0; };
M.groupList = function (sort) {
  var a = Object.keys(M.groups).map(function (k) { return M.groups[k]; });
  var key = { recent: function (g) { return -M.lastT(g); }, created: function (g) { return g.created || 0; }, name: function (g) { return (g.name || '').toLowerCase(); }, dut: function (g) { return ((g.dut || '') + ' ' + String(1e6 + (g.cur || 0))).toLowerCase(); }, cur: function (g) { return g.cur == null ? 1e9 : g.cur; } }[sort || 'recent'];
  return a.sort(function (x, y) { var p = key(x), q = key(y); return p < q ? -1 : p > q ? 1 : 0; });
};
M.activeGroup = function () {
  var id = M.setting('activeGroup', null); if (id && M.groups[id]) return M.groups[id];
  var l = M.groupList('recent'); return l[0] || null;
};
M.latestShot = function () { var best = null; Object.keys(M.meas).forEach(function (k) { var m = M.meas[k]; if (!best || m.t > best.t) best = m; }); return best; };
M.newGroup = function (o) {
  var g = Object.assign({ id: uid('g'), name: 'Group', dut: '', cur: null, volt: null, pow: null, temp: null, G: null, tags: '', note: '', extra: [], created: Date.now() }, o || {});
  return M.putGroup(g);
};
M.autoName = function (dut) {
  var n = Object.keys(M.groups).filter(function (k) { return (M.groups[k].dut || '') === (dut || ''); }).length + 1;
  return (dut ? dut + ' ' : 'Run ') + '#' + n;
};
M.duts = function () { var s = {}; Object.keys(M.groups).forEach(function (k) { var d = M.groups[k].dut; if (d) s[d] = 1; }); return Object.keys(s).sort(); };

/* ------------------------------------------------------------------ spectra */
var shotC = {};
function tailOn() { return !!M.setting('tail', false); }
/* one shot as spectral irradiance, W m-2 nm-1, on the lab's 1 nm grid (300-1000 nm, zero outside the measured range) */
M.shotE = function (m) {
  var tail = tailOn(), key = m.id + (tail ? 't' : ''), c = shotC[key]; if (c) return c;
  var o = L.newSpd(), v = m.v, w0 = m.wl0 || 380, st = m.step || 1, i, w;
  if (st === 1) { for (i = 0; i < v.length; i++) { w = w0 + i; if (w >= L.WL0 && w <= L.WL1) o[w - L.WL0] = Math.max(0, v[i]) / 1000; } }
  else { var pts = []; for (i = 0; i < v.length; i++) pts.push([w0 + i * st, Math.max(0, v[i]) / 1000]); o = L.fromPoints(pts); }
  if (tail) extendTail(o, w0 + (v.length - 1) * st);
  if (Object.keys(shotC).length > 600) shotC = {};
  shotC[key] = o; return o;
};
/* optional: continue an obviously falling red tail from the last measured wavelength (730 nm) to 780 nm with an exponential decay */
function extendTail(o, wEnd) {
  if (wEnd >= 780) return; var pk = 0, i; for (i = 0; i < o.length; i++) if (o[i] > pk) pk = o[i]; if (!(pk > 0)) return;
  function avg(a, b) { var s = 0, n = 0; for (var w = a; w <= b; w++) { s += o[w - L.WL0]; n++; } return s / n; }
  var e = avg(wEnd - 4, wEnd), p = avg(wEnd - 19, wEnd - 15); if (!(e > 0.003 * pk) || !(p > e * 1.02)) return;
  var k = Math.log(e / p) / 17; k = Math.max(-0.25, Math.min(-0.005, k));
  for (var w = wEnd + 1; w <= 780; w++) o[w - L.WL0] = e * Math.exp(k * (w - wEnd));
}
M.gFor = function (g) {
  if (g && g.G > 0) return { G: +g.G, known: true };
  var geo = M.setting('geom', { mode: 'none' }), d = (+geo.d || 0) / 1000;
  if (geo.mode === 'lambert' && d > 0) return { G: Math.PI * d * d, known: true };
  if (geo.mode === 'iso' && d > 0) return { G: 4 * Math.PI * d * d, known: true };
  if (geo.mode === 'custom' && +geo.G > 0) return { G: +geo.G, known: true };
  return { G: 1, known: false };
};
M.power = function (g) { if (g.pow > 0) return +g.pow; if (g.cur > 0 && g.volt > 0) return g.cur * g.volt / 1000; return null; };
M._gC = {}; M._aC = {};
/* the group as ONE source: mean of the included shots */
M.groupSrc = function (g) {
  var mem = M.included(g.id); if (!mem.length) return null;
  var sig = mem.map(function (m) { return m.id; }).join(',') + (tailOn() ? 't' : ''), c = M._gC[g.id];
  if (!c || c.sig !== sig) {
    var E = L.newSpd(); mem.forEach(function (m) { L.addScaled(E, M.shotE(m), 1 / mem.length); });
    c = M._gC[g.id] = { sig: sig, E: E, n: mem.length, Ev: L.KM * L.sumVis(E, L.T.y31) };
  }
  var gg = M.gFor(g);
  if (!c.flux || c.fluxG !== gg.G) { c.flux = L.scale(c.E, gg.G); c.fluxG = gg.G; c.a = null; }
  return { g: g, E: c.E, n: c.n, Ev: c.Ev, G: gg.G, Gk: gg.known, flux: c.flux, P: M.power(g), members: mem, _c: c };
};
M.analysis = function (src) { var c = src._c; if (!c.a || c.aEv !== src.Ev) { c.a = L.analyse(src.flux, { Ev: src.Ev }); c.aEv = src.Ev; } return c.a; };
M.shotCtx = function (m, g) {
  var gg = M.gFor(g), key = m.id + '|' + gg.G + (tailOn() ? 't' : ''), c = M._aC[key];
  if (!c) { var E = M.shotE(m), Ev = L.KM * L.sumVis(E, L.T.y31), flux = L.scale(E, gg.G); c = { g: g, E: E, Ev: Ev, G: gg.G, Gk: gg.known, flux: flux, a: L.analyse(flux, { Ev: Ev }) }; if (Object.keys(M._aC).length > 800) M._aC = {}; M._aC[key] = c; }
  c.P = M.power(g); return c;
};
M.ctxOf = function (g) { var s = M.groupSrc(g); if (!s) return null; return { g: g, E: s.E, Ev: s.Ev, G: s.G, Gk: s.Gk, flux: s.flux, P: s.P, a: M.analysis(s), n: s.n }; };

/* ------------------------------------------------------------------ metrics (everything that can go on a plot axis or in a table) */
var MET = [];
function def(cat, id, label, unit, dp, need, f, o) { MET.push(Object.assign({ cat: cat, id: id, label: label, unit: unit, dp: dp, need: need, f: f }, o || {})); }
def('Set-up', 'cur', 'Current', 'mA', 1, 'setup', function (c) { return c.g.cur > 0 || c.g.cur === 0 ? +c.g.cur : null; });
def('Set-up', 'volt', 'Voltage', 'V', 3, 'setup', function (c) { return c.g.volt > 0 ? +c.g.volt : null; });
def('Set-up', 'pow', 'Electrical power', 'W', 3, 'setup', function (c) { return M.power(c.g); });
def('Set-up', 'temp', 'Temperature', '°C', 1, 'setup', function (c) { return c.g.temp === null || c.g.temp === undefined || c.g.temp === '' ? null : +c.g.temp; });
def('Set-up', 'n', 'Number of shots in group', '', 0, 'setup', function (c) { return M.included(c.g.id).length; });
def('Set-up', 'time', 'Time of last shot (h since first group)', 'h', 2, 'setup', function (c) { var t0 = Infinity; Object.keys(M.groups).forEach(function (k) { var g = M.groups[k]; var mm = M.members(g.id); if (mm.length && mm[0].t < t0) t0 = mm[0].t; }); return (M.lastT(c.g) - t0) / 3.6e6; });
def('Light output', 'ev', 'Illuminance', 'lx', 2, 'spec', function (c) { return c.Ev; });
def('Light output', 'ee', 'Irradiance (300-1000 nm)', 'mW/m²', 2, 'spec', function (c) { return c.a.radiantW / c.G * 1000; });
def('Light output', 'phiv', 'Luminous flux (needs G)', 'lm', 2, 'spec', function (c) { return c.Gk ? c.a.lumens : null; });
def('Light output', 'phie', 'Radiant flux (needs G)', 'mW', 2, 'spec', function (c) { return c.Gk ? c.a.radiantW * 1000 : null; });
def('Light output', 'ppfd', 'PPFD (400-700 nm)', 'µmol/m²/s', 3, 'spec', function (c) { return c.a.photon.ppf / c.G; });
def('Light output', 'ppf', 'PPF (needs G)', 'µmol/s', 3, 'spec', function (c) { return c.Gk ? c.a.photon.ppf : null; });
def('Efficiency', 'eff', 'Luminous efficacy (needs G and power)', 'lm/W', 1, 'spec', function (c) { return c.Gk && c.P ? c.a.lumens / c.P : null; });
def('Efficiency', 'wpe', 'Wall-plug efficiency (needs G and power)', '%', 1, 'spec', function (c) { return c.Gk && c.P ? c.a.radiantW / c.P * 100 : null; });
def('Efficiency', 'ppe', 'Photon efficacy (needs G and power)', 'µmol/J', 3, 'spec', function (c) { return c.Gk && c.P ? c.a.photon.ppf / c.P : null; });
def('Efficiency', 'evpw', 'Illuminance per electrical watt (needs power)', 'lx/W', 1, 'spec', function (c) { return c.P ? c.Ev / c.P : null; });
def('Efficiency', 'ler', 'Luminous efficacy of radiation (LER)', 'lm/W', 1, 'spec', function (c) { return c.a.LER; });
def('Colour', 'cct', 'CCT', 'K', 0, 'spec', function (c) { return c.a.cct; });
def('Colour', 'duv', 'Duv', '', 4, 'spec', function (c) { return c.a.duv; });
def('Colour', 'x', 'CIE x (2°)', '', 4, 'spec', function (c) { return c.a.xy.x; });
def('Colour', 'y', 'CIE y (2°)', '', 4, 'spec', function (c) { return c.a.xy.y; });
def('Colour', 'u', "CIE u′ (1976)", '', 4, 'spec', function (c) { return c.a.upvp.u; });
def('Colour', 'v', "CIE v′ (1976)", '', 4, 'spec', function (c) { return c.a.upvp.v; });
def('Colour', 'dom', 'Dominant wavelength', 'nm', 1, 'spec', function (c) { return c.a.dominant && !c.a.dominant.complementary ? c.a.dominant.wl : null; });
def('Colour', 'purity', 'Excitation purity', '%', 1, 'spec', function (c) { return c.a.dominant ? c.a.dominant.purity * 100 : null; });
def('Spectrum', 'peak', 'Peak wavelength', 'nm', 1, 'spec', function (c) { return peakSub(c.E); });
def('Spectrum', 'centroid', 'Centroid wavelength', 'nm', 1, 'spec', function (c) { return c.a.centroid; });
def('Spectrum', 'fwhm', 'Width of the main peak (FWHM)', 'nm', 1, 'spec', function (c) { return A.fwhmOf ? A.fwhmOf(c.E) : null; });
def('Spectrum', 'sp', 'S/P ratio', '', 3, 'spec', function (c) { return c.a.SP; });
def('Spectrum', 'ssi', 'SSI', '', 1, 'spec', function (c) { return c.a.sq.ssi; });
def('Spectrum', 'smooth', 'Smoothness', '%', 1, 'spec', function (c) { return c.a.sq.smooth; });
def('Colour rendering', 'ra', 'CRI Ra', '', 1, 'spec', function (c) { return c.a.cri.Ra; });
for (var ri = 1; ri <= 14; ri++) (function (i) { def('Colour rendering', 'r' + i, 'CRI R' + i, '', 1, 'spec', function (c) { return c.a.cri.R[i - 1]; }); })(ri);
def('Colour rendering', 'rf', 'TM-30 Rf', '', 1, 'spec', function (c) { return c.a.tm30.Rf; });
def('Colour rendering', 'rg', 'TM-30 Rg', '', 1, 'spec', function (c) { return c.a.tm30.Rg; });
def('Colour rendering', 'rfskin', 'TM-30 Rf,skin', '', 1, 'spec', function (c) { return c.a.tm30.Rfskin; });
def('Colour rendering', 'rcsh1', 'TM-30 Rcs,h1 (red chroma shift)', '%', 1, 'spec', function (c) { return c.a.tm30.Rcsh1 * 100; });
def('Circadian', 'melder', 'Melanopic DER', '', 3, 'spec', function (c) { return c.a.alpha.Mel.DER; });
def('Circadian', 'meledi', 'Melanopic EDI (at the measured lux)', 'lx', 1, 'spec', function (c) { return c.a.alpha.Mel.EDI; });
function peakSub(E) { var pk = L.peakOf(E), i = pk.wl - L.WL0; if (i < 1 || i >= E.length - 1) return pk.wl; var a = E[i - 1], b = E[i], c = E[i + 1], d = a - 2 * b + c; return d < 0 ? pk.wl + 0.5 * (a - c) / d : pk.wl; }
M.METRICS = MET;
/* metrics from user-defined number fields (e.g. "Tj", "duty cycle") */
M.extraKeys = function () { var s = {}; Object.keys(M.groups).forEach(function (k) { (M.groups[k].extra || []).forEach(function (e) { if (e.k && isFinite(parseFloat(e.v))) s[e.k] = e.u || ''; }); }); return s; };
M.metricList = function () {
  var l = MET.slice(), ek = M.extraKeys();
  Object.keys(ek).sort().forEach(function (k) { l.push({ cat: 'Your fields', id: 'x:' + k, label: k, unit: ek[k], dp: 3, need: 'setup', f: function (c) { var e = (c.g.extra || []).filter(function (x) { return x.k === k; })[0]; var v = e ? parseFloat(e.v) : NaN; return isFinite(v) ? v : null; } }); });
  return l;
};
M.metric = function (id) { var l = M.metricList(); for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i]; return null; };
M.value = function (id, g) {
  var d = typeof id === 'string' ? M.metric(id) : id; if (!d) return null;
  var c = d.need === 'setup' ? { g: g } : M.ctxOf(g); if (!c) return null;
  var v; try { v = d.f(c); } catch (e) { v = null; } return v != null && isFinite(v) ? v : null;
};
/* sample standard deviation of a metric over the included shots of a group (null for set-up fields or a single shot) */
M.valueSd = function (id, g) {
  var d = typeof id === 'string' ? M.metric(id) : id; if (!d || d.need === 'setup') return null;
  var mem = M.included(g.id); if (mem.length < 2) return null; var xs = [];
  mem.forEach(function (m) { var c = M.shotCtx(m, g), v; try { v = d.f(c); } catch (e) { v = null; } if (v != null && isFinite(v)) xs.push(v); });
  if (xs.length < 2) return null; var mu = xs.reduce(function (a, b) { return a + b; }, 0) / xs.length, s = 0; xs.forEach(function (x) { s += (x - mu) * (x - mu); });
  return Math.sqrt(s / (xs.length - 1));
};
M.fmtVal = function (d, v) { if (v == null || !isFinite(v)) return '–'; var dp = d.dp == null ? 2 : d.dp; if (Math.abs(v) >= 1e5) return v.toExponential(2); return v.toFixed(dp); };
M.metricName = function (d) { return d.label + (d.unit ? ' (' + d.unit + ')' : ''); };

/* ------------------------------------------------------------------ selection (which groups Overlay / X-Y show) */
M.ui = (function () { var u = null; try { u = JSON.parse(localStorage.getItem('lsm.ui.v1') || 'null'); } catch (e) { } return Object.assign({ sel: {}, cur: null, sort: 'recent', filter: '', xy: { x: 'cur', y: 'phiv', y2: '', by: 'dut', lines: true, markers: true, err: true, labels: false, xlog: false, ylog: false, y0: false, norm: 'none' }, ov: { mode: 'abs', shots: false } }, u || {}); })();
M.saveUI = function () { try { localStorage.setItem('lsm.ui.v1', JSON.stringify(M.ui)); } catch (e) { } };
M.selectedGroups = function () {
  var all = M.groupList(M.ui.sort || 'recent').filter(function (g) { return M.included(g.id).length; });
  var sel = all.filter(function (g) { return M.ui.sel[g.id]; });
  return sel.length ? sel : all;
};
M.hasSelection = function () { return Object.keys(M.ui.sel).some(function (k) { return M.ui.sel[k] && M.groups[k]; }); };

/* ------------------------------------------------------------------ sources for the analysis tabs */
function isMeasSource(s) { return typeof s === 'string' && /^(live:|g:|m:)/.test(s); }
M.resolveSource = function (s) { // -> {kind, g, m, live}
  if (s === 'live:now') return M.live && M.live.shot ? { g: M.live.group || M.activeGroup() || { id: '_live', name: 'Live', extra: [] }, m: M.live.shot, name: 'Live preview' } : null;
  if (s === 'live:shot') { var m = M.latestShot(); return m ? { g: M.groups[m.gid] || { id: '_', name: 'Shot', extra: [] }, m: m } : null; }
  if (s === 'live:group') { var g = M.activeGroup(); return g ? { g: g } : null; }
  if (/^g:/.test(s)) { var gg = M.groups[s.slice(2)]; return gg ? { g: gg } : null; }
  if (/^m:/.test(s)) { var mm = M.meas[s.slice(2)]; return mm ? { g: M.groups[mm.gid] || { id: '_', name: 'Shot', extra: [] }, m: mm } : null; }
  return null;
};
M.sourceFor = function (s) {
  var r = M.resolveSource(s); if (!r) return null; var g = r.g, o;
  if (r.m) { // a single shot
    var c = M.shotCtx(r.m, g), when = new Date(r.m.t).toLocaleTimeString();
    o = { spd: c.flux, name: (r.name || g.name || 'Shot') + ' – single shot ' + when, power: c.P, info: [], Ev: c.Ev, meas: true, irr: !c.Gk, G: c.G, notes: [] };
    var mem = M.members(g.id); if (g.id !== '_live') { /* nothing */ }
  } else {
    var src = M.groupSrc(g); if (!src) return null;
    o = { spd: src.flux, name: (g.name || 'Group') + (src.n > 1 ? ' (mean of ' + src.n + ' shots)' : ''), power: src.P, info: [], Ev: src.Ev, meas: true, irr: !src.Gk, G: src.G, notes: [] };
  }
  if (o.irr) o.notes.push('Measured source without a flux factor G: "lm" means lx and "mW" means mW/m² (irradiance at the sensor). Set G (m²) for the group or in the Measurements tab to get lumens and watts.');
  if (!tailOn()) o.notes.push('The i1 Pro measures 380–730 nm; the spectrum is taken as zero outside. Enable "extend red tail" in the settings if the source emits beyond 730 nm.');
  return o;
};
var origSourceSpd = A.sourceSpd;
A.sourceSpd = function () { if (isMeasSource(A.source)) { var r = M.sourceFor(A.source); if (r) return r; return { spd: L.newSpd(), name: 'no measurement yet', power: null, info: [] }; } return origSourceSpd(); };
var origOther = A.otherSpd;
A.otherSpd = function (key, like) { if (isMeasSource(key)) { var s = M.sourceFor(key); return s ? { name: s.name, spd: s.spd } : null; } return origOther(key, like); };
A.sourceValid = function (k) {
  if (k === 'mix') return A.page !== 'measure';
  if (/^live:(group|shot)$/.test(k)) return true; if (k === 'live:now') return A.page === 'measure';
  if (/^g:/.test(k)) return !!M.groups[k.slice(2)]; if (/^m:/.test(k)) return !!M.meas[k.slice(2)];
  return !!A.findLed(k);
};
A.defaultSource = A.page === 'measure' ? 'live:group' : 'mix';
function gLabel(g) { return (g.name || 'Group') + (g.dut ? ' · ' + g.dut : '') + (g.cur != null && g.cur !== '' ? ' · ' + g.cur + ' mA' : ''); }
M.gLabel = gLabel;
A.measSelectorOptions = function (sel) {
  var first = sel.firstChild; if (A.page === 'measure') { while (sel.firstChild) sel.removeChild(sel.firstChild); }
  var h = A.h, g = h('optgroup', { label: 'Measurements' });
  if (A.page === 'measure') g.appendChild(h('option', { value: 'live:now' }, '● Live preview (not saved)'));
  g.appendChild(h('option', { value: 'live:group' }, '● Active group (updates automatically)')); g.appendChild(h('option', { value: 'live:shot' }, '● Latest single shot'));
  if (/^m:/.test(A.source) && M.meas[A.source.slice(2)]) g.appendChild(h('option', { value: A.source }, 'Single shot (selected)'));
  sel.insertBefore(g, A.page === 'measure' ? null : sel.firstChild.nextSibling);
  var gs = M.groupList('recent'); if (gs.length) { var g2 = h('optgroup', { label: 'Measured groups' }); gs.forEach(function (x) { if (M.included(x.id).length) g2.appendChild(h('option', { value: 'g:' + x.id }, gLabel(x))); }); sel.appendChild(g2); }
};
A.measCompareOptions = function (sel) {
  var h = A.h, gs = M.groupList('recent').filter(function (x) { return M.included(x.id).length; }); if (!gs.length) return;
  var g2 = h('optgroup', { label: 'Measured groups' }); gs.forEach(function (x) { g2.appendChild(h('option', { value: 'g:' + x.id }, gLabel(x))); }); sel.appendChild(g2);
};
M.isMeasSource = isMeasSource;
})();
