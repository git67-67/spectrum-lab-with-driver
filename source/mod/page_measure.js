/* LED Spectrum Lab - measure page: i1 Pro control, groups, live analysis
 * The instrument itself (connection, all calibrations, resolution/kernel, reflective mode, EEPROM, diagnostics) is the original
 * i1pro-webusb console, embedded as the "Instrument" tab (window.I1P_api). This file connects it to the lab's groups.
 * SPDX-License-Identifier: AGPL-3.0-or-later */
(function () {
'use strict';
if (window.LSL_PAGE !== 'measure') return;
var L = window.LSL, A = window.APP, M = A.M, h = A.h, fmt = A.fmt, I1 = window.I1Pro;
var D = A.D = { demo: null, busy: false, live: false, stop: false, livePromise: null, last: null, abort: false, mine: false, consoleLive: false };
var ui = {};
var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
function API() { return window.I1P_api || {}; }
Object.defineProperty(D, 'dev', { get: function () { return API().dev || null; } });
Object.defineProperty(D, 'sim', { get: function () { return API().sim || null; } });
Object.defineProperty(D, 'mode', { get: function () { return API().sim ? 'demo' : API().dev ? 'usb' : null; } });
Object.defineProperty(D, 'dark', { get: function () { var d = API().dev; return !!(d && d.dark); } });
Object.defineProperty(D, 'info', { get: function () { var d = API().dev; return d ? { serial: d.cal.serial } : null; } });

A.tabOrder = ['overview', 'spectrum', 'cie', 'cri', 'tm30', 'sq', 'photo', 'circ', 'meas', 'inst', 'guide', 'about'];
A.defaultSource = 'live:group';

/* ------------------------------------------------------------------ helpers */
function say(msg, kind) { D.msg = msg; D.kind = kind || ''; if (ui.status) { ui.status.textContent = msg; ui.status.className = 'mstatus ' + (kind || ''); } }
function set(k, v) { M.setSetting(k, v); }
function S(k, d) { return M.setting(k, d); }
function num(v, d) { var x = parseFloat(String(v).replace(',', '.')); return isFinite(x) ? x : d; }
function ago(t) { var s = Math.round((Date.now() - t) / 1000); return s < 90 ? s + ' s' : s < 5400 ? Math.round(s / 60) + ' min' : (s / 3600).toFixed(1) + ' h'; }
function friendly(e) { var a = API(); return a.explain ? a.explain(e) : (e && e.message ? e.message : String(e)); }
function el(id) { return document.getElementById(id); }
function press(id) { var b = el(id); if (b && !b.disabled) b.click(); else if (!b) say('The instrument console is not ready yet.', 'err'); }

/* ------------------------------------------------------------------ host functions the original console expects */
window.CMF_TAB = (function () { var o = [], T = L.T; for (var i = 0; i <= 400; i++) o.push([T.x31[i], T.y31[i], T.z31[i]]); return o; })();
/* colour numbers of a spectrum (wl nm, v mW/m2/nm) for the console's table and details */
window.ledMake = function (id, name, mfr, kind, wl, v, meta, notes) {
  var pts = []; for (var i = 0; i < wl.length; i++) pts.push([wl[i], Math.max(0, v[i]) / 1000]);
  var a = L.analyse(L.fromPoints(pts), {});
  return { id: id, name: name, q: { x: a.xy.x, y: a.xy.y, up: a.upvp.u, vp: a.upvp.v, ok: !!a.cctValid, cct: a.cct, duv: a.duv, cri: a.cri, tm30: a.tm30 } };
};
/* the console's small key-value store (its own measurement table is kept here) */
var kvDb = null;
window.kvOpen = function () {
  if (kvDb) return Promise.resolve(kvDb);
  return new Promise(function (res, rej) { var q = indexedDB.open('led-spectrum-lab-i1console', 1); q.onupgradeneeded = function () { q.result.createObjectStore('kv'); }; q.onsuccess = function () { kvDb = q.result; res(kvDb); }; q.onerror = function () { rej(q.error); }; });
};
window.kvPut = function (k, v) { return window.kvOpen().then(function (db) { return new Promise(function (res, rej) { var t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = res; t.onerror = function () { rej(t.error); }; }); }); };

/* a measurement of the console -> a shot of the active group */
function shotFromM(m, gid) {
  var a = API(), r = a.lab1nm(m); if (!r) return null;
  var d = a.dev;
  return { id: M.uid('m'), gid: gid, t: m.t || Date.now(), wl0: 380, step: 1, v: r.v, px: Float32Array.from(m.avgAbs), inc: true,
    inst: { serial: m.serial, eeId: m.eeId, inttime: m.inttime, nFrames: m.nFrames, peakCounts: m.peak, headroom: m.headroom, expMode: m.exposure, absK: m.absK || 1,
      corr: m.corr ? (m.corrMeta && m.corrMeta.kind ? m.corrMeta.kind + (m.corrMeta.T ? ' ' + m.corrMeta.T + ' K' : '') : 'source correction') : null, kernel: r.kernel, nReadings: m.nReadings || 1,
      inconsistent: (m.warn || []).some(function (w) { return /varied/.test(w); }), demo: !!a.sim, darkAge: d && d.darkDate ? Math.round((Date.now() - d.darkDate) / 1000) : null } };
}
window.I1P_toGroup = function (list) {
  var g = ensureGroup(), n = 0, skipped = 0, ids = {};
  list.forEach(function (m) { if (m.kind !== 'em') { skipped++; return; } var s = shotFromM(m, g.id); if (!s) { skipped++; return; } M.putMeas(s); D.last = s; ids[m.id] = s.id; n++; });
  return { ids: ids, err: !n, msg: n ? n + ' measurement' + (n > 1 ? 's' : '') + ' added to "' + g.name + '"' + (skipped ? ' (' + skipped + ' reflective ones stay in the console)' : '') + '.' : 'Nothing added: only light measurements can go into a group.' };
};
window.I1P_showShot = function (m) { var g = ensureGroup(), s = shotFromM(m, null); if (!s) return; M.live = { shot: s, group: g }; A.source = 'live:now'; A.save(); A.emit(); A.setTab('overview'); };
window.I1P_onButton = function () {
  var a = API(); if (a.mode === 'rf') return false;   // pigment mode: the console handles it
  if (D.busy || a.busy || !D.dark) return true; takeShots(); return true;
};
var lastSim = null;
window.I1P_onStatus = function (msg, cls) {
  var a = API(); if (a.sim && a.sim !== lastSim) { lastSim = a.sim; D.demo = D.demo || { led: 'def-pc-ra80-4000', I: 350 }; applyDemo(); ui._demoOn = false; } if (!a.sim) lastSim = null;
  if (!D.mine) say(msg, cls === 'err' ? 'err' : cls === 'ok' ? 'ok' : ''); refresh();
};
window.I1P_onBusy = function () { refresh(); };
window.I1P_onLive = function (r) {
  var a = API(); if (!D.consoleLive) { D.consoleLive = true; A._srcBeforeLive = A.source; A.source = 'live:now'; A.save(); }
  var d = a.dev, v = a.liveLab1nm(r), s = { id: 'live', gid: null, t: Date.now(), wl0: 380, step: 1, v: v, px: null, inc: true, inst: { inttime: r.inttime, nFrames: r.nFrames, peakCounts: r.peakCounts, headroom: r.headroom, absK: r.absApplied ? r.absK : 1, demo: !!a.sim } };
  M.live = { shot: s, group: M.activeGroup() }; D.last = s; A.emit();
};
window.I1P_onLiveEnd = function () { D.consoleLive = false; if (A.source === 'live:now') { A.source = A._srcBeforeLive && A._srcBeforeLive !== 'live:now' ? A._srcBeforeLive : 'live:group'; A.save(); } A.emit(); refresh(); };

/* a simulated light for the demo mode, driven from the LED library */
function applyDemo() {
  var sim = D.sim; if (!sim) return; var d = D.demo, led = A.findLed(d.led) || A.library[0], s = A.ledSpd(led), mx = 0, i; for (i = 0; i < s.length; i++) if (s[i] > mx) mx = s[i];
  sim.o.spd = function (nm) { var k = Math.round(nm) - L.WL0; return k >= 0 && k < s.length ? s[k] / mx : 0; };
  var x = d.I / 350; sim.o.level = 9000 * x / (1 + 0.12 * (x - 1) * (x > 1 ? 1 : 0.2)) * (S('demoGain', 1));
}

/* ------------------------------------------------------------------ measuring */
function ensureGroup() {
  var g = M.activeGroup();
  if (!g) { g = M.newGroup({ name: M.autoName('') }); }
  if (S('activeGroup', null) !== g.id) set('activeGroup', g.id);
  return g;
}
/* exposure, averaging time, target etc. come from the console's settings (single place) */
function measOpts(live) {
  var a = API(), o = a.mopts({ reuse: live ? true : undefined, count: 0 });
  if (live) o.readTime = Math.max(0.02, num(S('liveTime', 0.3), 0.3)); return o;
}
function checkReady() { if (!D.dev) { say('Connect the instrument first (or use the demo).', 'err'); return false; } if (!D.dark) { say('Do the dark calibration first (cover the sensor).', 'err'); return false; } if (API().mode === 'rf') { say('The console is in pigment mode. Switch it back to "Light".', 'err'); return false; } return true; }
async function takeShots() {
  if (D.busy || API().busy || !checkReady()) return;
  var a = API(), n = Math.max(1, Math.min(500, Math.round(num(ui.n.value, 1)))), wasLive = D.live; await pauseLive(); D.busy = true; D.mine = true; D.abort = false; a.setBusy(true); refresh();
  var g = ensureGroup(), done = 0, t0 = Date.now();
  try {
    if (D.sim) D.sim.mode = 'emission';
    for (var i = 0; i < n && !D.abort; i++) {
      say('Measuring ' + (i + 1) + ' / ' + n + ' → ' + g.name + '…'); var opts = measOpts(false); opts.progress = function (m) { say('Measuring ' + (i + 1) + ' / ' + n + ': ' + m); };
      var r = await D.dev.measure(opts), mm = a.makeMeasurement(r, 'shot', a.warnings(r, false)), s = shotFromM(mm, g.id); M.putMeas(s); D.last = s; done++;
      if (r.headroom > 0.97) say('Shot ' + (i + 1) + ': very close to saturation.', 'warn');
    }
    say(done + ' shot' + (done > 1 ? 's' : '') + ' added to "' + g.name + '" (' + ((Date.now() - t0) / 1000).toFixed(1) + ' s).' + (D.abort ? ' Stopped.' : ''), 'ok');
  } catch (e) { say(friendly(e) + (done ? ' (' + done + ' shot(s) were kept.)' : ''), 'err'); }
  D.busy = false; D.mine = false; a.setBusy(false); a.chips(); a.infoPanel(); refresh(); if (wasLive && D.dev) startLive();
}
function startLive() {
  if (D.live || !D.dev || !D.dark || D.busy || API().busy) { if (!D.dark && D.dev) say('Do the dark calibration first.', 'err'); return; }
  var a = API(); D.live = true; D.mine = true; D.stop = false; A._srcBeforeLive = A.source; A.source = 'live:now'; A.save(); a.setBusy(true); refresh();
  D.livePromise = (async function () {
    var failed = 0;
    if (D.sim) D.sim.mode = 'emission';
    while (!D.stop) {
      try { var r = await D.dev.measure(measOpts(true)), mm = a.makeMeasurement(r, 'live', []); if (D.stop) break; var m = shotFromM(mm, null); D.last = m; M.live = { shot: m, group: M.activeGroup() }; failed = 0; A.emit(); say('Live: ' + (r.inttime * 1000).toFixed(0) + ' ms × ' + r.nFrames + ' frames. "Save this shot" keeps the current spectrum in the group.', ''); }
      catch (e) { say(friendly(e), 'err'); if (++failed > 2) break; await sleep(300); }
      await sleep(30);
    }
    D.live = false; D.mine = false; a.setBusy(false); if (A.source === 'live:now') { A.source = A._srcBeforeLive && A._srcBeforeLive !== 'live:now' ? A._srcBeforeLive : 'live:group'; A.save(); } refresh(); A.emit();
  })();
}
async function pauseLive() { if (D.live) { D.stop = true; try { await D.livePromise; } catch (e) { } } }
async function stopLive() { await pauseLive(); say('Live preview stopped.'); }
function saveLive() {
  var s = M.live && M.live.shot; if (!s) return say('No live spectrum yet.', 'err'); var g = ensureGroup(), m = Object.assign({}, s, { id: M.uid('m'), gid: g.id, t: Date.now() }); M.putMeas(m); say('Live spectrum saved to "' + g.name + '".', 'ok');
}

/* ------------------------------------------------------------------ groups */
function newGroup(copy) {
  var cur = M.activeGroup(), o = {};
  if (copy && cur) o = { dut: cur.dut, volt: cur.volt, temp: cur.temp, G: cur.G, tags: cur.tags, extra: A.clone(cur.extra || []), name: M.autoName(cur.dut) };
  else o = { name: M.autoName(cur ? cur.dut : '') , dut: cur ? cur.dut : '' };
  var g = M.newGroup(o); set('activeGroup', g.id); ui.focusCur = !!copy; return g;
}

/* ------------------------------------------------------------------ the Instrument tab: the original console */
A.tabs.inst = { label: 'Instrument', build: function (root) {
  var host = h('div'); host.innerHTML = window.I1P_VIEW; root.appendChild(host);
  (function boot(n) {
    if (!document.getElementById('view-meas')) { if (n < 100) setTimeout(function () { boot(n + 1); }, 20); return; }   // the page is attached right after the tabs are built
    try { window.I1P_boot(); refresh(); } catch (e) { console.error(e); root.appendChild(h('div', { class: 'empty', text: 'The instrument console failed to start: ' + e.message })); }
  })(0);
}, update: function () { if (window.I1P_onShow) window.I1P_onShow(); } };
var editor = null, editorFor = null;
A.buildSide = function (side) {
  side.innerHTML = '';
  ui.status = h('div', { class: 'mstatus', text: D.msg || 'Connect the i1 Pro, or try the demo.' });
  ui.btnUSB = h('button', { class: 'btn primary', onclick: function () { press('i1p-connect'); } }, 'Connect i1 Pro'); ui.btnDemo = h('button', { class: 'btn', onclick: function () { press('i1p-demo'); }, title: 'Software instrument, no hardware needed' }, 'Demo');
  ui.btnDisc = h('button', { class: 'btn sm', onclick: async function () { await pauseLive(); press('i1p-disc'); } }, 'Disconnect');
  ui.btnDark = h('button', { class: 'btn', onclick: async function () { await pauseLive(); press('i1p-dark'); } }, 'Dark calibration'); ui.darkInfo = h('span', { class: 'hint' });
  ui.chip = h('span', { class: 'chip' });
  ui.usbNote = h('div', { class: 'hint', text: I1.WebUSBTransport.supported() ? '' : 'This browser has no WebUSB. Use Chrome or Edge for the instrument — the demo works everywhere.' });
  var inst = h('section', { class: 'card' }, h('div', { class: 'card-h' }, h('h2', null, 'Instrument'), h('div', { class: 'grow' }), ui.chip), h('div', { class: 'btnrow' }, ui.btnUSB, ui.btnDemo, ui.btnDisc), ui.usbNote, h('div', { class: 'btnrow' }, ui.btnDark, ui.darkInfo), ui.calChips = h('div', { class: 'btnrow chips' }), h('div', { class: 'btnrow' }, h('button', { class: 'btn sm primary', title: 'Source (black-body) correction, absolute level, resolution & kernel, exposure, EEPROM, diagnostics …', onclick: function () { A.setTab('inst'); } }, 'Calibration & settings →')), ui.status);

  ui.n = h('input', { class: 'inp', type: 'number', min: 1, max: 500, value: S('repeatN', 1), style: { width: '64px' }, title: 'Number of shots to take into the group (their mean is the group result)', onchange: function () { set('repeatN', Math.max(1, Math.round(num(this.value, 1)))); } });
  ui.btnMeas = h('button', { class: 'btn primary big', onclick: takeShots, title: 'Space bar, or the button on the instrument' }, '● Measure');
  ui.btnStop = h('button', { class: 'btn', onclick: function () { D.abort = true; } }, 'Stop');
  ui.btnLive = h('button', { class: 'btn', onclick: function () { D.live ? stopLive() : startLive(); } }, '▶ Live');
  ui.btnSaveLive = h('button', { class: 'btn', onclick: saveLive }, 'Save live shot');
  ui.shotInfo = h('div', { class: 'hint' });
  var adv = h('details', { class: 'adv' }, h('summary', null, 'Quick settings'),
    h('p', { class: 'hint', text: 'Exposure, averaging time, resolution/kernel, source correction and absolute calibration are set in the Instrument tab and apply to every shot taken here.' }),
    h('label', { class: 'fld' }, h('span', { class: 'fld-l', text: 'Live preview averaging (s)' }), h('input', { class: 'inp', value: S('liveTime', 0.3), onchange: function () { set('liveTime', num(this.value, 0.3)); } })),
    (function () { ui.ref = h('input', { class: 'inp', placeholder: 'lux meter reading (lx)', style: { width: '150px' } }); ui.absInfo = h('span', { class: 'hint' }); return h('div', { class: 'btnrow' }, ui.ref, h('button', { class: 'btn sm', title: 'Scale all future measurements so that the last shot reads this illuminance', onclick: matchLux }, 'Match lux meter'), h('button', { class: 'btn sm', onclick: function () { var a = API(); if (a.dev) { a.dev.setAbsCal(null); a.lstore.set('i1p-abs-' + a.dev.cal.serial, ''); a.absUi(); a.infoPanel(); } say('Level calibration removed.'); refresh(); } }, 'Reset'), ui.absInfo); })());
  ui.demoBox = h('div', { class: 'demo' });
  var meas = h('section', { class: 'card' }, h('div', { class: 'card-h' }, h('h2', null, 'Measure')), h('div', { class: 'btnrow' }, ui.btnMeas, h('span', { class: 'hint', text: '×' }), ui.n, h('span', { class: 'hint', text: 'shots' }), ui.btnStop), h('div', { class: 'btnrow' }, ui.btnLive, ui.btnSaveLive), ui.shotInfo, adv, ui.demoBox);

  ui.gsel = h('select', { class: 'inp', style: { flex: 1, minWidth: 0 }, onchange: function () { set('activeGroup', this.value); } });
  ui.gHost = h('div'); ui.memHost = h('div');
  var grp = h('section', { class: 'card' }, h('div', { class: 'card-h' }, h('h2', null, 'Group'), h('div', { class: 'grow' }), h('button', { class: 'btn sm', title: 'Start a new, empty group (new LED or new sample)', onclick: function () { newGroup(false); } }, '+ New'), h('button', { class: 'btn sm', title: 'New group with the same LED, voltage, temperature, tags — type the next current', onclick: function () { newGroup(true); } }, 'Next condition')),
    h('div', { class: 'btnrow' }, ui.gsel), h('p', { class: 'hint', text: 'Shots go into the active group; their mean is shown as one measurement. Fill in the operating point here or later on the analysis page.' }), ui.gHost, ui.memHost);
  side.appendChild(inst); side.appendChild(meas); side.appendChild(grp);
  if (!M.activeGroup()) ensureGroup();
  A.on(updateSide); updateSide(); refresh();
};
function matchLux() {
  var ref = num(ui.ref.value, 0); if (!(ref > 0)) return say('Enter the reading of your lux meter first.', 'err'); if (!D.dev) return say('Connect the instrument first.', 'err');
  var m = D.last || M.latestShot(); if (!m) return say('Measure the light first, then enter the lux meter reading for the same light.', 'err');
  var c = M.shotCtx(m, M.groups[m.gid] || { extra: [] }), mk = m.inst && m.inst.absK ? m.inst.absK : 1;
  var k = mk * ref / c.Ev;   // illuminance is proportional to the factor that was applied when the shot was taken
  if (!(k > 0) || !isFinite(k)) return say('Could not compute a factor.', 'err');
  var a = API(); D.dev.setAbsCal(k, true, { kind: 'illuminance ' + ref + ' lx (lux meter)', unit: 'irr', date: Date.now(), serial: D.dev.cal.serial }); a.lstore.set('i1p-abs-' + D.dev.cal.serial, JSON.stringify({ k: k, meta: D.dev.absCal.meta })); a.absUi(); a.infoPanel(); say('Level calibrated: factor ×' + k.toFixed(4) + ' applies to new shots. Old shots are not changed.', 'ok'); refresh();
}
function refresh() {
  if (!ui.chip) return; var c = D.dev ? (D.mode === 'demo' ? 'demo (simulated)' : 'S/N ' + D.info.serial) : 'not connected', busy = D.busy || API().busy;
  ui.chip.textContent = (D.live ? '● live · ' : '') + c; ui.chip.className = 'chip ' + (D.dev ? 'on' : '');
  ui.btnUSB.style.display = D.dev ? 'none' : ''; ui.btnDemo.style.display = D.dev ? 'none' : ''; ui.btnDisc.style.display = D.dev ? '' : 'none';
  ui.btnUSB.disabled = !I1.WebUSBTransport.supported(); D.busy = D.busy;
  ui.btnDark.disabled = !D.dev || busy; ui.btnMeas.disabled = !D.dev || !D.dark || busy; ui.btnLive.disabled = !D.dev || !D.dark || (busy && !D.live); ui.btnLive.textContent = D.live ? '■ Stop live' : '▶ Live'; ui.btnLive.classList.toggle('primary', D.live);
  ui.btnSaveLive.style.display = D.live ? '' : 'none'; ui.btnStop.style.display = D.busy ? '' : 'none'; ui.btnStop.disabled = !D.busy; chipsRow();
  var dk = D.dev && D.dark && D.dev.darkDate ? 'dark calibrated ' + ago(D.dev.darkDate) + ' ago' + (Date.now() - D.dev.darkDate > 25 * 60e3 ? ' – repeat it' : '') : D.dev ? 'dark calibration needed' : ''; ui.darkInfo.textContent = dk;
  var k = D.dev && D.dev.absCal && D.dev.absCal.enabled ? D.dev.absCal.k : null; if (ui.absInfo) ui.absInfo.textContent = k ? 'factor ×' + k.toFixed(3) : 'factory calibration';
  drawDemo(); drawShot();
}
function chipsRow() {
  var a = API(), d = a.dev, c = ui.calChips; if (!c) return; c.innerHTML = ''; if (!d) return;
  function chip(txt, on, tip) { c.appendChild(h('span', { class: 'chip ' + (on ? 'on' : ''), title: tip || '', text: txt })); }
  var u = d.userCorr, ab = d.absCal; chip('source corr.: ' + (u ? (u.enabled ? 'ON' : 'off') + (u.meta && u.meta.kind ? ' · ' + u.meta.kind + (u.meta.T ? ' ' + u.meta.T + ' K' : '') : '') : 'none'), u && u.enabled, 'Black-body / known-source shape correction (Instrument tab)');
  chip('level: ' + (ab ? (ab.enabled ? '×' + (+ab.k).toPrecision(4) : 'off') : 'factory'), ab && ab.enabled, 'Absolute level calibration');
  var p = a.activePreset ? a.activePreset() : null; if (p) chip('kernel: ' + (p.id === 'std10' ? 'factory 36 bands' : p.id === 'hires3' ? 'Argyll 3.33 nm' : p.id === 'narrow1' ? 'LED lines 1 nm' : p.id === 'fine1' ? 'factory 1 nm' : p.opts.kernel + ' ' + (+p.opts.step.toFixed(2)) + ' nm'), true, 'Resolution & kernel used to turn the 128 pixels into the spectrum (Instrument tab)');
}
function drawShot() {
  var m = D.last; if (!ui.shotInfo) return; if (!m) { ui.shotInfo.textContent = ''; return; } var i = m.inst || {};
  ui.shotInfo.textContent = 'Last: ' + (i.inttime * 1000).toFixed(1) + ' ms × ' + i.nFrames + ' frames, peak ' + Math.round(i.peakCounts) + ' counts (' + Math.round(i.headroom * 100) + ' % of saturation)' + (i.inconsistent ? ' — frames varied (flicker?)' : '');
  ui.shotInfo.style.color = i.headroom > 0.95 || i.inconsistent ? 'var(--warn)' : '';
}
function drawDemo() {
  var b = ui.demoBox; if (!b) return; if (D.mode !== 'demo') { b.innerHTML = ''; b.style.display = 'none'; ui._demoOn = false; return; } b.style.display = ''; if (ui._demoOn) return; ui._demoOn = true; b.innerHTML = '';
  var d = D.demo, sel = h('select', { class: 'inp', onchange: function () { d.led = this.value; applyDemo(); } }, A.library.filter(function (l) { return /^def-/.test(l.id); }).map(function (l) { return h('option', { value: l.id, selected: l.id === d.led }, l.name); }));
  var out = h('span', { class: 'sl-v', style: { width: '56px' }, text: d.I + ' mA' }), sl = h('input', { type: 'range', min: 20, max: 1000, step: 10, value: d.I, oninput: function () { d.I = +this.value; out.textContent = d.I + ' mA'; applyDemo(); } });
  b.appendChild(h('h4', null, 'Demo light')); b.appendChild(h('label', { class: 'fld' }, h('span', { class: 'fld-l', text: 'Simulated LED' }), sel)); b.appendChild(h('label', { class: 'fld' }, h('span', { class: 'fld-l', text: 'Simulated drive current (type the same value into the group to make plots)' }), h('div', { class: 'sl' }, sl, out)));
}
function updateSide() {
  if (!ui.gsel) return; var gs = M.groupList('recent'), act = M.activeGroup();
  if (document.activeElement !== ui.gsel) { ui.gsel.innerHTML = ''; gs.forEach(function (g) { ui.gsel.appendChild(h('option', { value: g.id, selected: act && g.id === act.id }, g.name + (g.dut ? ' · ' + g.dut : '') + ' (' + M.members(g.id).length + ')')); }); if (!gs.length) ui.gsel.appendChild(h('option', { value: '' }, '(no group yet – the first shot creates one)')); }
  if (act) {
    if (editorFor !== act.id) { ui.gHost.innerHTML = ''; editor = A.groupEditor(act.id); ui.gHost.appendChild(editor); editorFor = act.id; if (ui.focusCur) { ui.focusCur = false; var inp = editor.querySelector('input[placeholder]'); var cur = editor.querySelectorAll('.unit-in input')[0]; if (cur) setTimeout(function () { cur.focus(); cur.select(); }, 30); } } else editor.sync();
    drawMembers(act);
  } else { ui.gHost.innerHTML = ''; ui.memHost.innerHTML = ''; editorFor = null; }
}
function drawMembers(g) {
  var host = ui.memHost; host.innerHTML = ''; var mem = M.members(g.id), inc = mem.filter(function (m) { return m.inc !== false; });
  if (!mem.length) { host.appendChild(h('div', { class: 'hint', text: 'No shots yet.' })); return; }
  var s = M.groupSrc(g), parts = [];
  if (s) { ['ev', 'cct', 'duv', 'ra'].forEach(function (id) { var d = M.metric(id), v = M.value(id, g), sd = M.valueSd(id, g); if (v != null) parts.push(d.label.replace('Illuminance', 'Ev') + ' ' + M.fmtVal(d, v) + (sd != null ? ' ± ' + M.fmtVal(d, sd) : '') + (d.unit ? ' ' + d.unit : '')); }); }
  host.appendChild(h('div', { class: 'kv-line' }, h('b', { text: inc.length + ' of ' + mem.length + ' shots in the mean' }), parts.length ? h('div', { class: 'hint', text: parts.join(' · ') + (inc.length > 1 ? '   (± = spread of the shots)' : '') }) : null));
  var tbl = h('table', { class: 'tbl' }, h('tbody')), tb = tbl.firstChild;
  mem.slice(-8).reverse().forEach(function (m) { var c = M.shotCtx(m, g);
    tb.appendChild(h('tr', { class: m.inc === false ? 'off' : '' }, h('td', null, h('input', { type: 'checkbox', checked: m.inc !== false, title: 'Include in the mean', onchange: function () { m.inc = this.checked; M.putMeas(m); } })), h('td', { text: new Date(m.t).toLocaleTimeString() }), h('td', { class: 'num', text: fmt(c.Ev, c.Ev >= 100 ? 1 : 2) + ' lx' }), h('td', { class: 'num', text: c.a.cctValid ? Math.round(c.a.cct) + ' K' : '–' }),
      h('td', { class: 'nowrap' }, h('button', { class: 'ib', title: 'Show this single shot', onclick: function () { A.source = 'm:' + m.id; A.save(); A.emit(); } }, '◎'), h('button', { class: 'ib', title: 'Delete this shot', onclick: function () { M.delMeas(m.id); } }, '✕')))); });
  host.appendChild(h('div', { class: 'tblwrap' }, tbl)); if (mem.length > 8) host.appendChild(h('div', { class: 'hint', text: 'Latest 8 of ' + mem.length + ' shots shown. All shots: Measurements tab.' }));
  var btns = h('div', { class: 'btnrow' }, h('button', { class: 'btn sm', onclick: function () { A.source = 'live:group'; A.save(); A.emit(); } }, 'Show group mean'), h('button', { class: 'btn sm', title: 'Delete the most recent shot', onclick: function () { var l = mem[mem.length - 1]; if (l) M.delMeas(l.id); } }, 'Undo last shot'));
  host.appendChild(btns);
}

/* ------------------------------------------------------------------ header + keyboard */
A.headerExtras = function () {
  var st = h('span', { class: 'chip', id: 'storeChip' });
  setTimeout(function () { st.textContent = M.persistent ? 'saved in this browser' : 'NOT saved (no database)'; st.className = 'chip ' + (M.persistent ? 'on' : 'bad'); st.title = M.persistent ? 'All measurements are stored in IndexedDB and shared with lab.html' : 'IndexedDB is unavailable; measurements are lost when the page closes. Export them!'; }, 0);
  return h('span', { class: 'hdr-x' }, st, h('a', { class: 'btn', href: 'lab.html', target: 'led-lab-analysis', title: 'Open the analysis page (shares the same measurements, updates live)' }, 'Analysis ↗'));
};
document.addEventListener('keydown', function (e) {
  if (e.key !== ' ' && e.code !== 'Space') return; var t = e.target, tag = t && t.tagName; if (/INPUT|TEXTAREA|SELECT|BUTTON|A|SUMMARY/.test(tag) || (t && t.isContentEditable)) return; if (!D.dev || !D.dark || D.busy || API().busy) return; e.preventDefault(); takeShots();
});
window.addEventListener('beforeunload', function () { try { D.stop = true; } catch (e) { } });
setInterval(function () { try { refresh(); } catch (e) { } }, 4000);
})();
