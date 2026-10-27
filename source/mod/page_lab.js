/* LED Spectrum Lab - analysis page additions
 * SPDX-License-Identifier: AGPL-3.0-or-later */
(function () {
'use strict';
if (window.LSL_PAGE === 'measure') return;
var A = window.APP, M = A.M, h = A.h;
A.tabOrder = ['overview', 'meas', 'overlay', 'xy', 'spectrum', 'cie', 'cri', 'tm30', 'sq', 'photo', 'circ', 'guide', 'about'];
A.headerExtras = function () {
  var st = h('span', { class: 'chip' });
  setTimeout(function () { st.textContent = M.persistent ? 'live link to measure.html' : 'NOT saved (no database)'; st.className = 'chip ' + (M.persistent ? 'on' : 'bad'); st.title = M.persistent ? 'Measurements taken in measure.html appear here at once' : 'IndexedDB is unavailable in this browser context'; }, 0);
  return h('span', { class: 'hdr-x' }, st, h('a', { class: 'btn', href: 'measure.html', target: 'led-lab-measure', title: 'Open the measurement page (same browser: shares all data)' }, 'Measure ↗'));
};
})();
