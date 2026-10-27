/* LED Spectrum Lab - measurement UI shared by both pages: group editor, Measurements / Overlay / X-Y tabs
 * SPDX-License-Identifier: AGPL-3.0-or-later */
(function () {
'use strict';
var L = window.LSL, A = window.APP, M = A.M, h = A.h, fmt = A.fmt;

function pickFile(accept, cb, multi) { var inp = h('input', { type: 'file', accept: accept, multiple: !!multi }); inp.onchange = function () { Array.prototype.forEach.call(inp.files, function (f) { var r = new FileReader(); r.onload = function () { cb(r.result, f.name); }; r.readAsText(f); }); }; inp.click(); }
function dl(name, text, mime) { A.download(name, text, mime || 'application/json'); }
function pngOf(canvas, name) { var o = document.createElement('canvas'); o.width = canvas.width; o.height = canvas.height; var g = o.getContext('2d'); g.fillStyle = A.theme === 'dark' ? '#181c24' : '#ffffff'; g.fillRect(0, 0, o.width, o.height); g.drawImage(canvas, 0, 0); o.toBlob(function (b) { var a = h('a', { href: URL.createObjectURL(b), download: name }); document.body.appendChild(a); a.click(); a.remove(); }); }
function num(v) { if (v === '' || v == null) return null; var x = parseFloat(String(v).replace(',', '.')); return isFinite(x) ? x : null; }
function when(t) { var d = new Date(t); return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }); }
function colorOf(i) { return A.PAL[i % A.PAL.length]; }
function seg(opts, cur, cb) { var box = h('div', { class: 'seg' }); opts.forEach(function (o) { var b = h('button', { class: 'seg-b' + (cur === o[0] ? ' on' : ''), onclick: function () { Array.prototype.forEach.call(box.children, function (x) { x.classList.remove('on'); }); b.classList.add('on'); cb(o[0]); } }, o[1]); box.appendChild(b); }); return box; }

/* ================================================================== group editor (used on both pages) */
A.groupEditor = function (gid) {
  var root = h('div', { class: 'form gedit' }), refs = {};
  function G() { return M.groups[gid]; }
  function bind(key, type, label, o) {
    o = o || {};
    var inp = h(o.area ? 'textarea' : 'input', { class: 'inp', type: o.area ? null : (type === 'num' ? 'text' : 'text'), inputmode: type === 'num' ? 'decimal' : null, placeholder: o.ph || '', rows: o.area ? 2 : null, list: o.list || null });
    inp.addEventListener('input', function () { var g = G(); if (!g) return; var v = type === 'num' ? num(inp.value) : inp.value; if (type === 'num' && inp.value.trim() !== '' && v == null) { inp.classList.add('bad'); return; } inp.classList.remove('bad'); g[key] = v; M.saveGroupSoon(g); });
    refs[key] = inp; if (o.unit) { return h('label', { class: 'fld' }, h('span', { class: 'fld-l', text: label }), h('div', { class: 'unit-in' }, inp, h('span', { class: 'unit', text: o.unit }))); }
    return h('label', { class: 'fld' }, h('span', { class: 'fld-l', text: label }), inp);
  }
  var dl_ = h('datalist', { id: 'dutlist-' + gid });
  root.appendChild(dl_);
  root.appendChild(bind('name', 'txt', 'Group name'));
  root.appendChild(bind('dut', 'txt', 'LED / device under test', { list: 'dutlist-' + gid, ph: 'e.g. XP-G3 4000K  (used to build curves)' }));
  root.appendChild(h('div', { class: 'row3' }, bind('cur', 'num', 'Current', { unit: 'mA' }), bind('volt', 'num', 'Voltage', { unit: 'V' }), bind('temp', 'num', 'Temperature', { unit: '°C' })));
  root.appendChild(h('div', { class: 'row2' }, bind('pow', 'num', 'Electrical power', { unit: 'W', ph: 'auto = I × V' }), bind('G', 'num', 'Flux factor G', { unit: 'm²', ph: 'default from settings' })));
  root.appendChild(bind('tags', 'txt', 'Tags (comma separated)'));
  root.appendChild(bind('note', 'txt', 'Notes', { area: true }));
  var xbox = h('div', { class: 'xfields' });
  root.appendChild(h('div', null, h('div', { class: 'fld-l muted', text: 'Your own fields (numbers can be plotted)' }), xbox, h('button', { class: 'btn sm', onclick: function () { var g = G(); if (!g) return; g.extra = (g.extra || []).concat([{ k: '', v: '', u: '' }]); M.saveGroupSoon(g); buildExtra(); } }, '+ field')));
  function buildExtra() {
    xbox.innerHTML = ''; var g = G(); if (!g) return;
    (g.extra || []).forEach(function (e, i) {
      function mk(key, ph, w) { var inp = h('input', { class: 'inp sm', placeholder: ph, value: e[key] == null ? '' : e[key], style: { width: w } }); inp.addEventListener('input', function () { var gg = G(); if (!gg || !gg.extra[i]) return; gg.extra[i][key] = inp.value; M.saveGroupSoon(gg); }); return inp; }
      xbox.appendChild(h('div', { class: 'xrow' }, mk('k', 'name', '34%'), mk('v', 'value', '30%'), mk('u', 'unit', '16%'), h('button', { class: 'ib', title: 'Remove', onclick: function () { var gg = G(); gg.extra.splice(i, 1); M.saveGroupSoon(gg); buildExtra(); } }, '✕')));
    });
  }
  function sync() {
    var g = G(); if (!g) { root.classList.add('gone'); return; } root.classList.remove('gone');
    Object.keys(refs).forEach(function (k) { var inp = refs[k]; if (document.activeElement === inp) return; var v = g[k]; inp.value = v == null ? '' : v; });
    dl_.innerHTML = ''; M.duts().forEach(function (d) { dl_.appendChild(h('option', { value: d })); });
    var P = M.power(g); refs.pow.placeholder = g.cur > 0 && g.volt > 0 ? 'auto = ' + (g.cur * g.volt / 1000).toFixed(3) + ' W' : 'auto = I × V';
    var gg = M.gFor(g); refs.G.placeholder = gg.known ? 'settings: ' + (+gg.G.toPrecision(4)) + ' m²' : 'not set (values in lx)';
    var n = (g.extra || []).length; if (n !== xbox.children.length) buildExtra();
  }
  root.sync = sync; root._gid = gid; buildExtra(); sync(); return root;
};

/* flux conversion settings (shared by both pages) */
A.geomEditor = function () {
  var box = h('div', { class: 'geom' }), geo = M.setting('geom', { mode: 'none', d: 300, G: 1 });
  function save() { M.setSetting('geom', geo); }
  var mode = h('select', { class: 'inp sm', onchange: function () { geo.mode = this.value; save(); draw(); } },
    [['none', 'not set (show lx and mW/m²)'], ['lambert', 'Lambertian emitter at distance d: G = π·d²'], ['iso', 'isotropic point source at distance d: G = 4π·d²'], ['custom', 'custom G']].map(function (o) { return h('option', { value: o[0], selected: geo.mode === o[0] }, o[1]); }));
  var d = h('input', { class: 'inp sm', style: { width: '70px' }, value: geo.d == null ? '' : geo.d, oninput: function () { geo.d = num(this.value); save(); out(); } });
  var Gi = h('input', { class: 'inp sm', style: { width: '80px' }, value: geo.G == null ? '' : geo.G, oninput: function () { geo.G = num(this.value); save(); out(); } });
  var res = h('span', { class: 'hint' });
  function out() { var g = M.gFor({}); res.textContent = g.known ? '→ G = ' + (+g.G.toPrecision(4)) + ' m²;  lumens = lux × G' : '→ lumens, watts and efficacy need G'; }
  function draw() { dist.style.display = geo.mode === 'lambert' || geo.mode === 'iso' ? '' : 'none'; cu.style.display = geo.mode === 'custom' ? '' : 'none'; out(); }
  var dist = h('label', { class: 'fld inl' }, h('span', { text: 'd (mm)' }), d), cu = h('label', { class: 'fld inl' }, h('span', { text: 'G (m²)' }), Gi);
  box.appendChild(h('div', { class: 'toolbar' }, h('span', { text: 'Flux conversion Φ = E × G' }), mode, dist, cu, res)); draw(); return box;
};

/* ================================================================== X-Y chart */
function logTicks(a, b) { var t = [], e0 = Math.floor(Math.log10(a)), e1 = Math.ceil(Math.log10(b)), m = (e1 - e0) <= 2 ? [1, 2, 5] : [1]; for (var e = e0; e <= e1; e++) m.forEach(function (k) { var v = k * Math.pow(10, e); if (v >= a * 0.999 && v <= b * 1.001) t.push(v); }); return t; }
function tickLabel(v, step) { var a = Math.abs(v); if (a !== 0 && (a >= 1e5 || a < 1e-3)) return v.toExponential(0); var dp = step >= 1 ? 0 : Math.min(6, Math.ceil(-Math.log10(step) - 1e-9)); return v.toFixed(dp); }
function XYChart(canvas, getModel, onPick) {
  var self = this, st = { hover: null, hit: [] };
  canvas.style.cursor = 'crosshair';
  self.render = function () {
    var m = getModel(), c = A.setupCanvas(canvas), g = c.g, W = c.w, H = c.h, fg = A.cv('--fg'), mut = A.cv('--muted'), grid = A.cv('--grid'), bg = A.cv('--panel');
    g.clearRect(0, 0, W, H); st.hit = [];
    if (!m || !m.series.length) { g.fillStyle = mut; g.font = '13px system-ui'; g.textAlign = 'left'; g.fillText(m && m.msg ? m.msg : 'Nothing to plot yet.', 20, 30); return; }
    var hasY2 = m.series.some(function (s) { return s.pts.some(function (p) { return p.y2 != null; }); });
    var padL = 68, padR = hasY2 ? 68 : 16, padT = 16, padB = 44, pw = W - padL - padR, ph = H - padT - padB;
    function range(get, log, zero, errk) {
      var a = Infinity, b = -Infinity; m.series.forEach(function (s) { s.pts.forEach(function (p) { var v = get(p); if (v == null || (log && v <= 0)) return; var e = errk && m.opts.err ? (p[errk] || 0) : 0; a = Math.min(a, v - e); b = Math.max(b, v + e); }); });
      if (!isFinite(a)) { a = 0; b = 1; } if (zero && !log) a = Math.min(a, 0);
      if (a === b) { var d = Math.abs(a) * 0.1 || 1; a -= d; b += d; }
      if (log) { a = Math.max(a * 0.8, 1e-12); b = b * 1.25; if (a <= 0) a = b / 100; } else { var pad = (b - a) * 0.07; if (!(zero && a === 0)) a -= pad; b += pad; }
      return [a, b];
    }
    var rx = range(function (p) { return p.x; }, m.opts.xlog, false), ry = range(function (p) { return p.y; }, m.opts.ylog, m.opts.y0, 'sd'), ry2 = hasY2 ? range(function (p) { return p.y2; }, m.opts.y2log, m.opts.y0, 'sd2') : null;
    function sc(v, r, log, lo, hi) { return log ? lo + (Math.log10(v) - Math.log10(r[0])) / (Math.log10(r[1]) - Math.log10(r[0])) * (hi - lo) : lo + (v - r[0]) / (r[1] - r[0]) * (hi - lo); }
    function X(v) { return sc(v, rx, m.opts.xlog, padL, padL + pw); } function Y(v) { return sc(v, ry, m.opts.ylog, padT + ph, padT); } function Y2(v) { return sc(v, ry2, m.opts.y2log, padT + ph, padT); }
    function axisTicks(r, log) { if (log) return { t: logTicks(r[0], r[1]), s: 1 }; return A.ticks(r[0], r[1], 6); }
    g.font = '11px system-ui'; g.lineWidth = 1; g.strokeStyle = grid; g.fillStyle = mut;
    var tx = axisTicks(rx, m.opts.xlog), ty = axisTicks(ry, m.opts.ylog);
    g.textAlign = 'center'; tx.t.forEach(function (t) { var x = X(t); g.beginPath(); g.moveTo(x, padT); g.lineTo(x, padT + ph); g.stroke(); g.fillText(tickLabel(t, tx.s), x, padT + ph + 14); });
    g.textAlign = 'right'; ty.t.forEach(function (t) { var y = Y(t); g.beginPath(); g.moveTo(padL, y); g.lineTo(padL + pw, y); g.stroke(); g.fillText(tickLabel(t, ty.s), padL - 6, y + 4); });
    if (hasY2) { var t2 = axisTicks(ry2, m.opts.y2log); g.textAlign = 'left'; t2.t.forEach(function (t) { var y = Y2(t); g.fillText(tickLabel(t, t2.s), padL + pw + 6, y + 4); }); }
    g.strokeStyle = mut; g.strokeRect(padL, padT, pw, ph);
    g.fillStyle = fg; g.font = '12px system-ui'; g.textAlign = 'center'; g.fillText(m.xlab, padL + pw / 2, H - 8);
    g.save(); g.translate(14, padT + ph / 2); g.rotate(-Math.PI / 2); g.fillText(m.ylab, 0, 0); g.restore();
    if (hasY2) { g.save(); g.translate(W - 12, padT + ph / 2); g.rotate(Math.PI / 2); g.fillText(m.y2lab, 0, 0); g.restore(); }
    g.save(); g.beginPath(); g.rect(padL - 6, padT - 6, pw + 12, ph + 12); g.clip();
    m.series.forEach(function (s) {
      [['y', Y, 'sd', false], ['y2', Y2, 'sd2', true]].forEach(function (ax) {
        if (ax[0] === 'y2' && !hasY2) return;
        var pts = s.pts.filter(function (p) { return p[ax[0]] != null && p.x != null && (!m.opts.xlog || p.x > 0) && (!(ax[3] ? m.opts.y2log : m.opts.ylog) || p[ax[0]] > 0); });
        if (!pts.length) return; pts.sort(function (a, b) { return a.x - b.x; });
        g.strokeStyle = s.color; g.fillStyle = s.color; g.lineWidth = 1.8; g.setLineDash(ax[3] ? [6, 4] : []);
        if (m.opts.lines && pts.length > 1) { g.beginPath(); pts.forEach(function (p, i) { var x = X(p.x), y = ax[1](p[ax[0]]); if (i) g.lineTo(x, y); else g.moveTo(x, y); }); g.stroke(); }
        g.setLineDash([]);
        pts.forEach(function (p) {
          var x = X(p.x), y = ax[1](p[ax[0]]);
          if (m.opts.err && p[ax[2]] > 0) { var y0 = ax[1](p[ax[0]] - p[ax[2]]), y1 = ax[1](p[ax[0]] + p[ax[2]]); g.lineWidth = 1.2; g.beginPath(); g.moveTo(x, y0); g.lineTo(x, y1); g.moveTo(x - 4, y0); g.lineTo(x + 4, y0); g.moveTo(x - 4, y1); g.lineTo(x + 4, y1); g.stroke(); }
          if (m.opts.markers) { g.beginPath(); if (ax[3]) { g.rect(x - 4, y - 4, 8, 8); g.fillStyle = bg; g.fill(); g.lineWidth = 2; g.stroke(); } else { g.arc(x, y, 4.5, 0, 7); g.fillStyle = s.color; g.fill(); g.lineWidth = 1.5; g.strokeStyle = bg; g.stroke(); } }
          if (m.opts.labels && p.g) { g.fillStyle = fg; g.font = '10.5px system-ui'; g.textAlign = 'left'; g.fillText(p.g.name, x + 7, y - 6); }
          st.hit.push({ x: x, y: y, p: p, s: s, ax: ax[0] });
        });
      });
    });
    g.restore();
    // legend
    var lx = padL + 10, ly = padT + 8; g.font = '11.5px system-ui'; g.textAlign = 'left';
    m.series.forEach(function (s) { var tw = g.measureText(s.name).width; if (lx + tw + 34 > padL + pw) { lx = padL + 10; ly += 15; } g.fillStyle = bg; g.globalAlpha = 0.8; g.fillRect(lx - 3, ly - 6, tw + 28, 15); g.globalAlpha = 1; g.strokeStyle = s.color; g.fillStyle = s.color; g.lineWidth = 2.5; g.beginPath(); g.moveTo(lx, ly + 2); g.lineTo(lx + 14, ly + 2); g.stroke(); g.beginPath(); g.arc(lx + 7, ly + 2, 3.5, 0, 7); g.fill(); g.fillStyle = fg; g.fillText(s.name, lx + 19, ly + 6); lx += tw + 36; });
    // hover
    if (st.hover) {
      var best = null, bd = 18 * 18; st.hit.forEach(function (q) { var d = (q.x - st.hover.x) * (q.x - st.hover.x) + (q.y - st.hover.y) * (q.y - st.hover.y); if (d < bd) { bd = d; best = q; } });
      if (best) {
        g.strokeStyle = fg; g.lineWidth = 2; g.beginPath(); g.arc(best.x, best.y, 7, 0, 7); g.stroke();
        var p = best.p, lines = [p.g ? p.g.name : best.s.name, m.xlab.split(' (')[0] + ': ' + p.xs, (best.ax === 'y2' ? m.y2lab : m.ylab).split(' (')[0] + ': ' + (best.ax === 'y2' ? p.y2s : p.ys)];
        if (p.n > 1) lines.push('mean of ' + p.n + ' shots'); if (p.g && p.g.dut) lines.push(p.g.dut);
        g.font = '11.5px system-ui'; var bw = 0; lines.forEach(function (t) { bw = Math.max(bw, g.measureText(t).width); }); bw += 14; var bh = lines.length * 15 + 8, bx = best.x + 12, by = best.y - bh - 8; if (bx + bw > W - 4) bx = best.x - bw - 12; if (by < 2) by = best.y + 12;
        g.fillStyle = bg; g.strokeStyle = grid; g.lineWidth = 1; g.fillRect(bx, by, bw, bh); g.strokeRect(bx, by, bw, bh); g.fillStyle = fg; g.textAlign = 'left'; lines.forEach(function (t, i) { g.fillText(t, bx + 7, by + 15 + i * 15 - 2); });
        canvas.style.cursor = 'pointer'; st.best = best;
      } else { canvas.style.cursor = 'crosshair'; st.best = null; }
    }
  };
  canvas.addEventListener('pointermove', function (e) { var r = canvas.getBoundingClientRect(); st.hover = { x: e.clientX - r.left, y: e.clientY - r.top }; self.render(); });
  canvas.addEventListener('pointerleave', function () { st.hover = null; self.render(); });
  canvas.addEventListener('click', function () { if (st.best && st.best.p.g && onPick) onPick(st.best.p.g); });
}

/* ================================================================== tab: Measurements (library of groups) */
var T = A.tabs;
var expanded = {};
T.meas = { label: 'Measurements', build: function (root) {
  var self = this, list = h('div', { class: 'tblwrap mlist' }), right = h('div', { class: 'card mdetail' }), editHost = h('div'), memHost = h('div'), detailHead = h('div', { class: 'card-h' });
  var filter = h('input', { class: 'inp', type: 'search', placeholder: 'Filter name / LED / tag…', value: M.ui.filter || '', oninput: function () { M.ui.filter = this.value; M.saveUI(); self.update(); } });
  var sortSel = h('select', { class: 'inp sm', onchange: function () { M.ui.sort = this.value; M.saveUI(); self.update(); } }, [['recent', 'newest first'], ['created', 'oldest first'], ['dut', 'LED, then current'], ['cur', 'current'], ['name', 'name']].map(function (o) { return h('option', { value: o[0], selected: (M.ui.sort || 'recent') === o[0] }, 'Sort: ' + o[1]); }));
  function selIds() { return Object.keys(M.ui.sel).filter(function (k) { return M.ui.sel[k] && M.groups[k]; }); }
  function setCur(id) { M.ui.cur = id; M.saveUI(); self.update(); }
  var tb = h('div', { class: 'toolbar' },
    h('button', { class: 'btn', onclick: importFile }, 'Import…'),
    h('button', { class: 'btn', onclick: function (e) { menu([['All measurements (.json)', function () { exportJSON(null); }], ['Checked groups (.json)', function () { exportJSON(selIds()); }], ['Summary table of all groups (.csv)', function () { exportCSV(false); }], ['Summary table of checked groups (.csv)', function () { exportCSV(true); }], ['Spectra of all groups, one column each (.csv)', function () { exportSpectraCSV(); }]], e.currentTarget); } }, 'Export ▾'),
    h('span', { class: 'sep' }),
    h('button', { class: 'btn', title: 'Combine the checked groups into one (all shots are kept)', onclick: function () { var ids = selIds(); if (ids.length < 2) return A.toast('Check two or more groups first', 'err'); var keep = ids.slice().sort(function (a, b) { return (M.groups[a].created || 0) - (M.groups[b].created || 0); })[0]; if (!confirm('Merge ' + ids.length + ' groups into "' + M.groups[keep].name + '"? All shots are kept.')) return; M.mergeGroups(ids, keep); M.ui.sel = {}; M.ui.sel[keep] = true; M.ui.cur = keep; M.saveUI(); } }, 'Merge checked'),
    h('button', { class: 'btn', onclick: function () { var ids = selIds(); if (!ids.length) return A.toast('Check the groups to delete', 'err'); if (!confirm('Delete ' + ids.length + ' group(s) and all their shots? This cannot be undone.')) return; M.batch(function () { ids.forEach(function (id) { M.delGroup(id, true); }); }); M.ui.sel = {}; M.saveUI(); } }, 'Delete checked'),
    h('button', { class: 'btn', onclick: function () { var g = M.newGroup({ name: M.autoName('') }); setCur(g.id); } }, '+ Empty group'),
    h('div', { class: 'grow' }), filter, sortSel);
  var geom = A.geomEditor();
  var tail = h('label', { class: 'chk', title: 'The i1 Pro stops at 730 nm. This continues an obviously falling red tail to 780 nm (exponential decay) before CRI/TM-30/lumens are computed.' }, h('input', { type: 'checkbox', checked: !!M.setting('tail', false), onchange: function () { M.setSetting('tail', this.checked); } }), 'extend falling red tail 730→780 nm');
  root.appendChild(tb); root.appendChild(h('div', { class: 'toolbar' }, geom, tail));
  root.appendChild(h('div', { class: 'grid2 meas-grid' }, h('div', { class: 'card' }, h('div', { class: 'card-h' }, h('h3', null, 'Groups'), h('span', { class: 'badge', id: 'gcount' }), h('div', { class: 'grow' }), h('span', { class: 'hint', text: 'checked groups = what Overlay and X–Y show (none checked = all)' })), list), right));
  right.appendChild(detailHead); right.appendChild(editHost); right.appendChild(memHost);
  function menu(items, anchor) { var m = h('div', { class: 'menu' }); items.forEach(function (it) { m.appendChild(h('button', { class: 'menu-i', onclick: function () { m.remove(); it[1](); } }, it[0])); }); document.body.appendChild(m); var r = anchor.getBoundingClientRect(); m.style.left = Math.min(r.left, innerWidth - 260) + 'px'; m.style.top = (r.bottom + 4) + 'px'; setTimeout(function () { var off = function (e) { if (!m.contains(e.target)) { m.remove(); document.removeEventListener('pointerdown', off); } }; document.addEventListener('pointerdown', off); }, 0); }
  A.menu = A.menu || menu;

  var editor = null, editorFor = null;
  function drawDetail() {
    var g = M.groups[M.ui.cur]; detailHead.innerHTML = '';
    if (!g) { editorFor = null; editHost.innerHTML = ''; memHost.innerHTML = ''; detailHead.appendChild(h('h3', null, 'Group details')); editHost.appendChild(h('div', { class: 'empty', text: 'Click a group to edit its name, LED, current, voltage, temperature … and to see its individual shots.' })); return; }
    if (editorFor !== g.id) { editHost.innerHTML = ''; editor = A.groupEditor(g.id); editHost.appendChild(editor); editorFor = g.id; } else editor.sync();
    detailHead.appendChild(h('h3', null, 'Group details')); detailHead.appendChild(h('div', { class: 'grow' }));
    detailHead.appendChild(h('button', { class: 'btn sm primary', title: 'Show all analysis tabs for this group', onclick: function () { A.source = 'g:' + g.id; A.save(); A.emit(); A.setTab('overview'); } }, 'Analyse ▸'));
    detailHead.appendChild(h('button', { class: 'btn sm', title: 'Make this the group that new measurements go into (measure.html)', onclick: function () { M.setSetting('activeGroup', g.id); A.toast('"' + g.name + '" is now the active group'); } }, 'Make active'));
    detailHead.appendChild(h('button', { class: 'btn sm', title: 'Add the mean spectrum to the LED library on this page, so it can be used in mixes', onclick: function () { toLibrary(g); } }, '→ LED library'));
    detailHead.appendChild(h('button', { class: 'btn sm', title: 'New empty group with the same LED, voltage, temperature, tags and own fields', onclick: function () { var n = M.newGroup({ name: M.autoName(g.dut), dut: g.dut, volt: g.volt, temp: g.temp, G: g.G, tags: g.tags, extra: A.clone(g.extra || []) }); M.setSetting('activeGroup', n.id); setCur(n.id); } }, 'Next condition'));
    memHost.innerHTML = ''; var mem = M.members(g.id), inc = mem.filter(function (m) { return m.inc !== false; });
    var sum = M.groupSrc(g), head = h('div', { class: 'card-h' }, h('h4', { style: { margin: 0 } }, 'Individual shots'), h('span', { class: 'badge', text: mem.length + (inc.length !== mem.length ? ' (' + inc.length + ' in the mean)' : '') }));
    memHost.appendChild(head);
    if (!mem.length) { memHost.appendChild(h('div', { class: 'hint', text: 'No shots yet. Take measurements with measure.html, or import a file.' })); return; }
    var tbl = h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['', 'time', 'lx', 'CCT', 'peak nm', 'exposure', 'headroom', ''].map(function (t) { return h('th', { text: t }); })))), tbd = h('tbody');
    mem.forEach(function (m, i) {
      var c = M.shotCtx(m, g), a = c.a, ins = m.inst || {};
      var sel = h('select', { class: 'inp sm', title: 'Move this shot to another group', onchange: function () { var v = this.value; if (!v) return; if (v === '+new') { var n = M.newGroup({ name: M.autoName(g.dut), dut: g.dut, volt: g.volt, temp: g.temp, tags: g.tags, extra: A.clone(g.extra || []) }); v = n.id; } M.moveShots([m.id], v); }, style: { width: '34px' } }, h('option', { value: '' }, '⇄'), h('option', { value: '+new' }, '→ new group'), M.groupList('recent').filter(function (x) { return x.id !== g.id; }).slice(0, 40).map(function (x) { return h('option', { value: x.id }, x.name); }));
      var tr = h('tr', { class: m.inc === false ? 'off' : '' },
        h('td', null, h('input', { type: 'checkbox', checked: m.inc !== false, title: 'Include in the group mean', onchange: function () { m.inc = this.checked; M.putMeas(m); } })),
        h('td', { class: 'nowrap', text: (i + 1) + ' · ' + new Date(m.t).toLocaleTimeString() }), h('td', { class: 'num', text: fmt(c.Ev, c.Ev >= 100 ? 1 : 2) }), h('td', { class: 'num', text: a.cctValid ? Math.round(a.cct) + ' K' : '–' }), h('td', { class: 'num', text: a.peak.wl }),
        h('td', { class: 'num', text: ins.inttime ? (ins.inttime * 1000).toFixed(1) + ' ms × ' + (ins.nFrames || '?') : '–' }), h('td', { class: 'num', text: ins.headroom != null ? (ins.headroom * 100).toFixed(0) + ' %' : '–', title: 'peak counts as a share of saturation' }),
        h('td', { class: 'nowrap' }, h('button', { class: 'ib', title: 'Analyse this single shot', onclick: function () { A.source = 'm:' + m.id; A.save(); A.emit(); A.setTab('overview'); } }, '◎'), sel, h('button', { class: 'ib', title: 'Delete this shot', onclick: function () { if (confirm('Delete this shot?')) M.delMeas(m.id); } }, '✕')));
      tbd.appendChild(tr);
    });
    tbl.appendChild(tbd); memHost.appendChild(h('div', { class: 'tblwrap' }, tbl));
    if (sum && inc.length > 1) {
      var parts = ['Ev', 'cct', 'duv', 'ra'].map(function (id) { var d = M.metric(id), v = M.value(id, g), sd = M.valueSd(id, g); return v == null ? null : d.label.split(' (')[0] + ' ' + M.fmtVal(d, v) + (sd != null ? ' ± ' + M.fmtVal(d, sd) : '') + (d.unit ? ' ' + d.unit : ''); }).filter(Boolean);
      parts[0] = parts[0] || ''; var evs = M.value('ev', g), evd = M.valueSd('ev', g);
      memHost.appendChild(h('div', { class: 'hint', text: 'Mean of ' + inc.length + ' shots (± 1σ between shots): ' + ['ev', 'cct', 'duv', 'ra'].map(function (id) { var d = M.metric(id), v = M.value(id, g), sd = M.valueSd(id, g); return v == null ? '' : d.label.replace('Illuminance', 'Ev') + ' ' + M.fmtVal(d, v) + (sd != null ? ' ± ' + M.fmtVal(d, sd) : '') + (d.unit ? ' ' + d.unit : ''); }).filter(Boolean).join('  ·  ') }));
    }
  }
  function toLibrary(g) {
    var s = M.groupSrc(g); if (!s) return A.toast('This group has no included shots', 'err');
    var pts = []; for (var w = 380; w <= 780; w++) pts.push([w, s.E[w - L.WL0]]);
    var led = A.ledFromPoints(g.name, pts); led.manufacturer = 'measured'; led.part = g.dut || ''; led.tags = ['measured'].concat((g.tags || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean));
    led.notes = 'Measured with an i1 Pro on ' + when(g.created) + ', mean of ' + s.n + ' shot(s).' + (g.note ? ' ' + g.note : '');
    var phi = s.Gk ? s.flux && L.KM * L.sumVis(s.flux, L.T.y31) : null, If = g.cur || 350, Vf = g.volt || 3;
    if (!phi) { var q = prompt('Luminous flux of this LED at ' + If + ' mA, in lumens\n(set the flux factor G in the settings to avoid this question; leave empty to cancel):', ''); var v = num(q); if (!(v > 0)) return; phi = v; }
    led.electrical = { If: If, Vf: Vf, basis: 'lm', value: +phi.toPrecision(5) };
    A.library.push(led); A.ui.selected = led.id; A.save(); A.emit(); A.toast('Added "' + led.name + '" to the LED library (' + phi.toFixed(1) + ' lm at ' + If + ' mA)');
  }
  function exportJSON(ids) {
    var gs = ids ? ids.map(function (i) { return M.groups[i]; }).filter(Boolean) : Object.keys(M.groups).map(function (k) { return M.groups[k]; }), set = {}; gs.forEach(function (g) { set[g.id] = 1; });
    var doc = { format: 'led-spectrum-lab-measurements', version: 1, created: new Date().toISOString(), settings: M.kv.settings || {}, groups: gs, measurements: [] };
    Object.keys(M.meas).forEach(function (k) { var m = M.meas[k]; if (!set[m.gid]) return; var o = Object.assign({}, m); o.v = Array.prototype.map.call(m.v, function (x) { return +x.toPrecision(6); }); o.px = m.px ? Array.prototype.map.call(m.px, function (x) { return +x.toPrecision(6); }) : null; doc.measurements.push(o); });
    dl('led-measurements-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(doc));
  }
  function exportCSV(onlySel) {
    var gs = onlySel ? M.selectedGroups() : M.groupList('created'), ml = M.metricList().filter(function (d) { return !/^r(1?\d)$/.test(d.id) || d.id === 'r9' || d.id === 'r12'; });
    var q = function (s) { return '"' + String(s == null ? '' : s).replace(/"/g, '""') + '"'; }, head = ['group', 'LED', 'shots', 'note'].concat(ml.map(function (d) { return M.metricName(d); }).map(q)), rows = [head.map(function (x, i) { return i < 4 ? q(x) : x; })];
    gs.forEach(function (g) { rows.push([q(g.name), q(g.dut), M.included(g.id).length, q(g.note)].concat(ml.map(function (d) { var v = M.value(d, g); return v == null ? '' : +v.toPrecision(7); }))); });
    dl('led-measurements-summary.csv', rows.map(function (r) { return r.join(','); }).join('\n'), 'text/csv');
  }
  function exportSpectraCSV() {
    var gs = M.groupList('created').filter(function (g) { return M.included(g.id).length; }); if (!gs.length) return A.toast('Nothing to export', 'err');
    var srcs = gs.map(function (g) { return M.groupSrc(g); }), rows = [['wavelength_nm'].concat(gs.map(function (g) { return '"' + g.name.replace(/"/g, '""') + ' (mW/m2/nm)"'; })).join(',')];
    for (var w = 380; w <= 780; w++) rows.push([w].concat(srcs.map(function (s) { return +(s.E[w - L.WL0] * 1000).toPrecision(6); })).join(','));
    dl('led-measurements-spectra.csv', rows.join('\n'), 'text/csv');
  }
  function importFile() {
    pickFile('.json,application/json', function (txt, name) {
      try { var j = JSON.parse(txt); if (j.format !== 'led-spectrum-lab-measurements') throw new Error('Not a measurement file (expected a .json exported from this tool).'); var ng = 0, nm = 0;
        M.batch(function () { (j.groups || []).forEach(function (g) { if (!M.groups[g.id]) { M.putGroup(g); ng++; } }); (j.measurements || []).forEach(function (m) { if (M.meas[m.id]) return; m.v = Float32Array.from(m.v); m.px = m.px ? Float32Array.from(m.px) : null; M.putMeas(m); nm++; }); });
        A.toast('Imported ' + ng + ' group(s) and ' + nm + ' shot(s)' + ((j.groups || []).length - ng ? ' (' + ((j.groups || []).length - ng) + ' already present)' : '')); } catch (e) { A.toast(e.message, 'err'); }
    }, true);
  }
  this.update = function () {
    var q = (M.ui.filter || '').toLowerCase(), gs = M.groupList(M.ui.sort || 'recent').filter(function (g) { return !q || (g.name + ' ' + (g.dut || '') + ' ' + (g.tags || '') + ' ' + (g.note || '')).toLowerCase().indexOf(q) >= 0; });
    var act = M.activeGroup(); list.innerHTML = ''; var cnt = document.getElementById('gcount'); if (cnt) cnt.textContent = Object.keys(M.groups).length;
    if (!gs.length) list.appendChild(h('div', { class: 'empty', text: Object.keys(M.groups).length ? 'No group matches the filter.' : 'No measurements yet. Open measure.html, connect the i1 Pro (or use the demo) and press Measure — they appear here at once.' }));
    else {
      var tbl = h('table', { class: 'tbl mt' }, h('thead', null, h('tr', null, ['', '', 'Group', 'LED', 'mA', 'V', 'W', '°C', 'n', 'lx', 'CCT', 'Duv', 'Ra'].map(function (t, i) { return h('th', { text: t, class: i === 2 || i === 3 ? 'l' : '' }); })))), tb = h('tbody');
      gs.forEach(function (g) {
        var mem = M.included(g.id), allm = M.members(g.id), P = M.power(g);
        function v(id, dp) { var x = M.value(id, g); return x == null ? '–' : x.toFixed(dp); }
        var tr = h('tr', { class: 'grow-row' + (M.ui.cur === g.id ? ' sel' : '') + (act && act.id === g.id ? ' act' : ''), onclick: function (e) { if (e.target.tagName === 'INPUT') return; setCur(g.id); } },
          h('td', null, h('input', { type: 'checkbox', checked: !!M.ui.sel[g.id], onchange: function () { if (this.checked) M.ui.sel[g.id] = true; else delete M.ui.sel[g.id]; M.saveUI(); A.emit(); } })),
          h('td', null, h('span', { class: 'dot', style: { background: act && act.id === g.id ? 'var(--accent)' : 'transparent', borderColor: act && act.id === g.id ? 'var(--accent)' : 'var(--border)' }, title: act && act.id === g.id ? 'active group (receives new measurements)' : '' })),
          h('td', { class: 'l nm', text: g.name, title: g.note || '' }), h('td', { class: 'l nm', text: g.dut || '' }),
          h('td', { class: 'num', text: g.cur == null ? '' : g.cur }), h('td', { class: 'num', text: g.volt == null ? '' : g.volt }), h('td', { class: 'num', text: P ? P.toFixed(2) : '' }), h('td', { class: 'num', text: g.temp == null ? '' : g.temp }),
          h('td', { class: 'num', text: mem.length === allm.length ? String(mem.length) : mem.length + '/' + allm.length }), h('td', { class: 'num', text: mem.length ? v('ev', 1) : '' }), h('td', { class: 'num', text: mem.length ? v('cct', 0) : '' }), h('td', { class: 'num', text: mem.length ? v('duv', 4) : '' }), h('td', { class: 'num', text: mem.length ? v('ra', 1) : '' }));
        tb.appendChild(tr);
      });
      tbl.appendChild(tb); list.appendChild(tbl);
    }
    if (M.ui.cur && !M.groups[M.ui.cur]) M.ui.cur = null; if (!M.ui.cur && gs.length) M.ui.cur = (act || gs[0]).id;
    drawDetail();
  };
  this.render = this.update;
} };

/* ================================================================== tab: Overlay */
T.overlay = { label: 'Overlay', build: function (root) {
  var cs = h('canvas', { class: 'chart', style: { height: '440px' } }), cc = h('canvas', { class: 'chart sq', style: { height: '440px' } }), tbl = h('div', { class: 'tblwrap' }), info = h('div', { class: 'hint' }), lastKey = '';
  var spec = new A.SpectrumChart(cs, specModel), cie = new A.CIEChart(cc, cieModel);
  function groups() { return M.selectedGroups().slice(0, 40); }
  function colors(gs) { var o = {}; gs.forEach(function (g, i) { o[g.id] = colorOf(i); }); return o; }
  function specModel() {
    var gs = groups(), col = colors(gs), o = M.ui.ov, series = [], opts = Object.assign({}, A.ui.spec, { yMode: o.mode === 'peak' ? 'norm' : 'abs', fill: false, channels: true, log: !!o.log });
    var anyG = gs.some(function (g) { return M.gFor(g).known; });
    gs.forEach(function (g) {
      var s = M.groupSrc(g); if (!s) return; var y = s.E, name = g.name + (g.cur != null ? ' · ' + g.cur + ' mA' : '');
      if (o.mode === 'ev') y = L.scale(y, 100 / (s.Ev || 1)); else if (o.mode === 'ee') y = L.scale(y, 1 / (L.sumAll(y) || 1) * 0.1);
      if (o.shots) s.members.forEach(function (m) { var yy = M.shotE(m); if (o.mode === 'ev') yy = L.scale(yy, 100 / (s.Ev || 1)); else if (o.mode === 'ee') yy = L.scale(yy, 0.1 / (L.sumAll(M.shotE(m)) || 1)); series.push({ name: name + ' shot', y: yy, color: col[g.id], width: 0.8, noLegend: true, channel: false, dash: [2, 2] }); });
      series.push({ name: name, y: y, color: col[g.id], width: 2, main: true });
    });
    return { series: series, opts: opts, ylabs: { abs: o.mode === 'ev' ? 'Spectral irradiance, scaled to 100 lx (mW m⁻² nm⁻¹)' : o.mode === 'ee' ? 'Spectral irradiance, scaled to equal total power' : 'Spectral irradiance (mW m⁻² nm⁻¹)', norm: 'Relative (each trace normalised to its peak)' } };
  }
  function cieModel() {
    var gs = groups(), col = colors(gs), pts = [], ob = A.ui.cie.obs;
    gs.forEach(function (g) { var c = M.ctxOf(g); if (!c) return; var a = c.a, m = ob === 10 ? a.xy10 : a.xy, u = ob === 10 ? a.upvp10 : a.upvp; pts.push({ x: m.x, y: m.y, u: u.u, v: u.v, cct: a.cct, duv: a.duv, kind: 'cmp', color: col[g.id], label: g.name }); });
    return { points: pts };
  }
  var o = M.ui.ov;
  var tb = h('div', { class: 'toolbar' }, h('span', { text: 'Scale' }), seg([['abs', 'Absolute'], ['peak', 'Peak = 1'], ['ev', 'Equal lux'], ['ee', 'Equal power']], o.mode, function (v) { o.mode = v; M.saveUI(); self.update(); }),
    h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: !!o.log, onchange: function () { o.log = this.checked; M.saveUI(); self.update(); } }), 'log'),
    h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: !!o.shots, onchange: function () { o.shots = this.checked; M.saveUI(); self.update(); } }), 'individual shots (thin dotted)'),
    h('div', { class: 'grow' }), h('button', { class: 'btn sm', onclick: function () { spec.zoom(0.6); } }, '+'), h('button', { class: 'btn sm', onclick: function () { spec.zoom(1.6); } }, '−'), h('button', { class: 'btn sm', onclick: function () { spec.resetZoom(); } }, 'Reset'),
    h('button', { class: 'btn sm', onclick: function () { cie.fit(); } }, 'Fit chromaticity'), h('button', { class: 'btn sm', onclick: function () { pngOf(cs, 'overlay-spectra.png'); } }, 'PNG spectra'), h('button', { class: 'btn sm', onclick: function () { pngOf(cc, 'overlay-chromaticity.png'); } }, 'PNG chromaticity'));
  var self = this;
  root.appendChild(tb); root.appendChild(info); root.appendChild(h('div', { class: 'grid2' }, h('div', { class: 'card' }, h('h3', null, 'Spectra'), cs), h('div', { class: 'card' }, h('h3', null, 'Chromaticity'), cc))); root.appendChild(h('div', { class: 'card' }, tbl));
  this.update = function () {
    var gs = groups(), key = gs.map(function (g) { return g.id; }).join(); info.textContent = (M.hasSelection() ? gs.length + ' checked group(s)' : 'all ' + gs.length + ' group(s) – check groups in the Measurements tab to choose') + '. Wheel = zoom, drag = pan, double-click = reset.';
    spec.render(); if (key !== lastKey) { lastKey = key; cie.fit(); } else cie.render();
    tbl.innerHTML = ''; var cols = ['ev', 'cct', 'duv', 'ra', 'r9', 'rf', 'rg', 'peak', 'fwhm', 'x', 'y'].map(function (id) { return M.metric(id); }), col = colors(gs);
    if (!gs.length) return;
    tbl.appendChild(A.table(gs.map(function (g) { return [h('span', null, h('span', { class: 'dot', style: { background: col[g.id] } }), ' ' + g.name), g.dut || '', g.cur == null ? '' : g.cur, g.volt == null ? '' : g.volt].concat(cols.map(function (d) { return M.fmtVal(d, M.value(d, g)); })); }), ['Group', 'LED', 'mA', 'V'].concat(cols.map(function (d) { return d.label.replace('Illuminance', 'Ev (lx)').replace(' (2°)', '').replace('Peak wavelength', 'Peak nm').replace('Width of the main peak (FWHM)', 'FWHM nm'); }))));
  };
  this.render = function () { this.update(); };
} };

/* ================================================================== tab: X-Y */
var PRESETS = [['Flux vs current', 'cur', 'phiv'], ['Efficacy vs current', 'cur', 'eff'], ['Duv vs flux', 'phiv', 'duv'], ['CCT vs current', 'cur', 'cct'], ['CRI Ra vs current', 'cur', 'ra'], ['Peak λ vs current', 'cur', 'peak'], ['Peak λ vs temperature', 'temp', 'peak'], ['Flux vs temperature', 'temp', 'phiv'], ['Efficacy vs flux', 'phiv', 'eff'], ['WPE vs current', 'cur', 'wpe'], ['Voltage vs current', 'cur', 'volt'], ['u′ vs v′ (colour shift)', 'u', 'v']];
T.xy = { label: 'X–Y plots', build: function (root) {
  var self = this, canvas = h('canvas', { class: 'chart', style: { height: '520px' } }), tbl = h('div', { class: 'tblwrap' }), msg = h('div', { class: 'hint' }), o = M.ui.xy, lastModel = null;
  var chart = new XYChart(canvas, function () { return lastModel; }, function (g) { M.ui.cur = g.id; M.saveUI(); A.toast('Selected "' + g.name + '" in the Measurements tab'); });
  function metricSelect(val, cb, optional) {
    var sel = h('select', { class: 'inp', onchange: function () { cb(this.value); } }); if (optional) sel.appendChild(h('option', { value: '' }, '— none —'));
    var cat = null, grp = null; M.metricList().forEach(function (d) { if (d.cat !== cat) { cat = d.cat; grp = h('optgroup', { label: cat }); sel.appendChild(grp); } grp.appendChild(h('option', { value: d.id, selected: d.id === val }, M.metricName(d))); }); sel.value = val || ''; return sel;
  }
  var host = h('div', { class: 'toolbar xyctl' });
  function drawControls() {
    host.innerHTML = '';
    host.appendChild(h('label', { class: 'fld inl' }, h('span', { text: 'X' }), metricSelect(o.x, function (v) { o.x = v; save(); })));
    host.appendChild(h('label', { class: 'fld inl' }, h('span', { text: 'Y' }), metricSelect(o.y, function (v) { o.y = v; save(); })));
    host.appendChild(h('label', { class: 'fld inl' }, h('span', { text: 'Y2 (right axis)' }), metricSelect(o.y2, function (v) { o.y2 = v; save(); }, true)));
    host.appendChild(h('label', { class: 'fld inl' }, h('span', { text: 'Curves per' }), h('select', { class: 'inp', onchange: function () { o.by = this.value; save(); } }, [['dut', 'LED / device'], ['tag', 'first tag'], ['none', 'one curve']].map(function (b) { return h('option', { value: b[0], selected: o.by === b[0] }, b[1]); }))));
    host.appendChild(h('label', { class: 'fld inl' }, h('span', { text: 'Normalise Y' }), h('select', { class: 'inp', onchange: function () { o.norm = this.value; save(); } }, [['none', 'no'], ['max', 'to maximum = 1'], ['first', 'to first point = 1']].map(function (b) { return h('option', { value: b[0], selected: o.norm === b[0] }, b[1]); }))));
    [['lines', 'lines'], ['markers', 'markers'], ['err', 'error bars (±1σ of the shots)'], ['labels', 'group names'], ['xlog', 'log X'], ['ylog', 'log Y'], ['y0', 'Y from 0']].forEach(function (k) { host.appendChild(h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: !!o[k[0]], onchange: function () { o[k[0]] = this.checked; save(); } }), k[1])); });
  }
  function save() { M.saveUI(); self.update(); }
  var chips = h('div', { class: 'toolbar' }, h('span', { class: 'hint', text: 'Quick plots:' }), PRESETS.map(function (p) { return h('button', { class: 'btn sm', onclick: function () { var any = M.groupList().some(function (g) { return M.gFor(g).known; }); var sub = { phiv: 'ev', eff: 'evpw', wpe: 'evpw' }; o.x = !any && sub[p[1]] ? sub[p[1]] : p[1]; o.y = !any && sub[p[2]] ? sub[p[2]] : p[2]; o.y2 = ''; drawControls(); save(); } }, p[0]); }), h('div', { class: 'grow' }),
    h('button', { class: 'btn sm', onclick: function () { pngOf(canvas, 'xy-plot.png'); } }, 'PNG'), h('button', { class: 'btn sm', onclick: csv }, 'CSV'));
  root.appendChild(chips); root.appendChild(host); root.appendChild(msg); root.appendChild(h('div', { class: 'card' }, canvas)); root.appendChild(h('div', { class: 'card' }, h('h3', null, 'Plotted data'), tbl));
  drawControls();
  function build() {
    var gs = M.selectedGroups(), dx = M.metric(o.x), dy = M.metric(o.y), dy2 = o.y2 ? M.metric(o.y2) : null, skipped = [], series = {}, order = [];
    if (!dx || !dy) return { series: [], msg: 'Choose X and Y.' };
    gs.forEach(function (g, gi) {
      var x = M.value(dx, g), y = M.value(dy, g), y2 = dy2 ? M.value(dy2, g) : null;
      if (x == null || (y == null && y2 == null)) { skipped.push(g.name + (x == null ? ' (no ' + dx.label.toLowerCase() + ')' : ' (no ' + dy.label.toLowerCase() + ')')); return; }
      var key = o.by === 'dut' ? (g.dut || '(no LED name)') : o.by === 'tag' ? ((g.tags || '').split(',')[0].trim() || '(no tag)') : 'all groups';
      if (!series[key]) { series[key] = { name: key, pts: [] }; order.push(key); }
      var p = { x: x, y: y, y2: y2, sd: M.valueSd(dy, g), sd2: dy2 ? M.valueSd(dy2, g) : null, g: g, n: M.included(g.id).length, xs: M.fmtVal(dx, x) + (dx.unit ? ' ' + dx.unit : ''), ys: y == null ? '–' : M.fmtVal(dy, y) + (dy.unit ? ' ' + dy.unit : '') + (M.valueSd(dy, g) != null ? ' ± ' + M.fmtVal(dy, M.valueSd(dy, g)) : ''), y2s: y2 == null ? '–' : M.fmtVal(dy2, y2) + (dy2.unit ? ' ' + dy2.unit : '') };
      series[key].pts.push(p);
    });
    var list = order.map(function (k, i) { var s = series[k]; s.color = colorOf(i); s.pts.sort(function (a, b) { return a.x - b.x; }); return s; });
    // normalisation (per curve)
    if (o.norm !== 'none') list.forEach(function (s) {
      ['y', 'y2'].forEach(function (k) { var sdk = k === 'y' ? 'sd' : 'sd2', vals = s.pts.map(function (p) { return p[k]; }).filter(function (v) { return v != null; }); if (!vals.length) return; var ref = o.norm === 'max' ? Math.max.apply(null, vals) : vals[0]; if (!ref) return; s.pts.forEach(function (p) { if (p[k] != null) p[k] /= ref; if (p[sdk] != null) p[sdk] /= Math.abs(ref); }); });
    });
    var pre = o.norm === 'none' ? '' : 'relative ';
    return { series: list, xlab: M.metricName(dx), ylab: pre + M.metricName(dy), y2lab: dy2 ? pre + M.metricName(dy2) : '', opts: { lines: o.lines, markers: o.markers, err: o.err, labels: o.labels, xlog: o.xlog, ylog: o.ylog, y2log: o.ylog, y0: o.y0 }, skipped: skipped, dx: dx, dy: dy, dy2: dy2, total: gs.length };
  }
  function csv() {
    if (!lastModel || !lastModel.series.length) return A.toast('Nothing to export', 'err'); var q = function (s) { return '"' + String(s).replace(/"/g, '""') + '"'; };
    var rows = [['curve', 'group', M.metricName(lastModel.dx), M.metricName(lastModel.dy), 'sd (shots)', lastModel.dy2 ? M.metricName(lastModel.dy2) : null].filter(function (x) { return x !== null; }).map(q).join(',')];
    lastModel.series.forEach(function (s) { s.pts.forEach(function (p) { rows.push([q(s.name), q(p.g.name), p.x, p.y == null ? '' : p.y, p.sd == null ? '' : p.sd].concat(lastModel.dy2 ? [p.y2 == null ? '' : p.y2] : []).join(',')); }); });
    dl('xy-plot-data.csv', rows.join('\n'), 'text/csv');
  }
  this.update = function () {
    // keep selects in sync when new "own fields" appear
    var ids = M.metricList().map(function (d) { return d.id; }).join(); if (ids !== self._ids) { self._ids = ids; drawControls(); }
    lastModel = build(); chart.render();
    var m = lastModel, nPts = m.series.reduce(function (a, s) { return a + s.pts.length; }, 0);
    msg.textContent = !m.series.length ? (m.msg || (Object.keys(M.groups).length ? 'No group has values for both axes. Enter current / voltage / temperature in the Measurements tab, or choose other axes.' : 'No measurements yet.')) : (nPts + ' point(s) from ' + (M.hasSelection() ? 'the checked groups' : 'all groups') + (m.skipped.length ? '; skipped: ' + m.skipped.slice(0, 4).join(', ') + (m.skipped.length > 4 ? ' …' : '') : '') + '. Click a point to select its group.');
    tbl.innerHTML = ''; if (!m.series.length) return;
    var rows = []; m.series.forEach(function (s) { s.pts.forEach(function (p) { rows.push([s.name, p.g.name, p.xs, p.ys].concat(m.dy2 ? [p.y2s] : []).concat([String(p.n)])); }); });
    tbl.appendChild(A.table(rows, ['Curve', 'Group', m.dx.label, m.dy.label].concat(m.dy2 ? [m.dy2.label] : []).concat(['shots'])));
  };
  this.render = function () { this.update(); };
} };

/* ------------------------------------------------------------------ keep everything in step with the store */
M.onChange(function () { A.emit(); });
A.groupEditorSyncAll = function () { };
})();
