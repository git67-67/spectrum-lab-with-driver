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
/* LED Spectrum Lab - colorimetry / photometry core (no dependencies) */
(function (root) {
'use strict';
var D = root.LSL_DATA;
var WL0 = 300, WL1 = 1000, N = WL1 - WL0 + 1;      // SPD grid: 1 nm, 300..1000
var V0 = 380, V1 = 780;                            // visual range

/* ---------- table interpolation (5 nm tables -> 1 nm on 380..780) ---------- */
function cubic(tab, x) { // 4-point Lagrange on a uniform grid; x in index units
  var n = tab.length, i = Math.floor(x); if (i < 0) i = 0; if (i > n - 2) i = n - 2;
  var t = x - i;
  if (i < 1 || i > n - 3) return tab[i] * (1 - t) + tab[i + 1] * t;
  var p0 = tab[i - 1], p1 = tab[i], p2 = tab[i + 1], p3 = tab[i + 2];
  var v = -t * (t - 1) * (t - 2) / 6 * p0 + (t + 1) * (t - 1) * (t - 2) / 2 * p1 - (t + 1) * t * (t - 2) / 2 * p2 + (t + 1) * t * (t - 1) / 6 * p3;
  return v;
}
function lin(tab, x) {
  var n = tab.length, i = Math.floor(x); if (i < 0) i = 0; if (i > n - 2) i = n - 2;
  var t = x - i; return tab[i] * (1 - t) + tab[i + 1] * t;
}
function to1nm(tab, mode) { // returns Float64Array length 401 (380..780)
  var o = new Float64Array(401), f = mode === 'cubic' ? cubic : lin;
  for (var k = 0; k <= 400; k++) { var v = f(tab, k / 5); o[k] = (mode === 'cubic' && v < 0 && tab[Math.round(k / 5)] === 0) ? 0 : v; }
  if (mode === 'cubic') for (k = 0; k <= 400; k++) if (o[k] < 0) o[k] = 0;
  return o;
}
var T = {
  x31: to1nm(D.x31, 'cubic'), y31: to1nm(D.y31, 'cubic'), z31: to1nm(D.z31, 'cubic'),
  x64: to1nm(D.x64, 'cubic'), y64: to1nm(D.y64, 'cubic'), z64: to1nm(D.z64, 'cubic'),
  vp: to1nm(D.vp, 'cubic'),
  S: to1nm(D.aS, 'cubic'), M: to1nm(D.aM, 'cubic'), L: to1nm(D.aL, 'cubic'), R: to1nm(D.aR, 'cubic'), Mel: to1nm(D.aMel, 'cubic'),
  d65: to1nm(D.d65, 'lin'),
  tcs: D.tcs.map(function (a) { return to1nm(a, 'lin'); }),
  ces: D.ces.map(function (a) { return to1nm(a, 'lin'); })
};
var ds = { s0: [], s1: [], s2: [] };
(function () { var a = D.ds0, b = D.ds1, c = D.ds2, o0 = new Float64Array(401), o1 = new Float64Array(401), o2 = new Float64Array(401);
  for (var k = 0; k <= 400; k++) { var x = k / 10; o0[k] = lin(a, x); o1[k] = lin(b, x); o2[k] = lin(c, x); }
  ds.s0 = o0; ds.s1 = o1; ds.s2 = o2; })();

/* ---------- SPD helpers ---------- */
function newSpd() { return new Float64Array(N); }
function idx(w) { return w - WL0; }
function fromPoints(pts) { // pts: [[nm, v],...] sorted -> 1 nm grid (linear, zero outside)
  pts = pts.filter(function (p) { return isFinite(p[0]) && isFinite(p[1]); }).sort(function (a, b) { return a[0] - b[0]; });
  var o = newSpd(); if (pts.length < 2) return o;
  var j = 0;
  for (var w = WL0; w <= WL1; w++) {
    if (w < pts[0][0] || w > pts[pts.length - 1][0]) { o[w - WL0] = 0; continue; }
    while (j < pts.length - 2 && pts[j + 1][0] < w) j++;
    var a = pts[j], b = pts[j + 1], t = (b[0] === a[0]) ? 0 : (w - a[0]) / (b[0] - a[0]);
    o[w - WL0] = a[1] * (1 - t) + b[1] * t;
  }
  return o;
}
function integ(f) { var s = 0; for (var i = 0; i < N; i++) s += f(i + WL0, i); return s; }
function sumVis(spd, tab) { var s = 0; for (var k = 0; k <= 400; k++) s += spd[k + V0 - WL0] * tab[k]; return s; }
function sumAll(spd) { var s = 0; for (var i = 0; i < N; i++) s += spd[i]; return s; }
function scale(spd, k) { var o = newSpd(); for (var i = 0; i < N; i++) o[i] = spd[i] * k; return o; }
function addScaled(acc, spd, k) { for (var i = 0; i < N; i++) acc[i] += spd[i] * k; }
function peakOf(spd) { var m = 0, mi = 0; for (var i = 0; i < N; i++) if (spd[i] > m) { m = spd[i]; mi = i; } return { wl: mi + WL0, v: m }; }

/* ---------- physical constants ---------- */
var KM = 683, KMP = 1700.06, H = 6.62607015e-34, C = 299792458, NA = 6.02214076e23, C2 = 1.4388e-2;

/* ---------- illuminants ---------- */
function planck(T) { var o = newSpd(); for (var w = WL0; w <= WL1; w++) { var l = w * 1e-9; o[w - WL0] = Math.pow(l, -5) / (Math.exp(C2 / (l * T)) - 1); } return o; }
function dxy(T) {
  var x = T <= 7000 ? 0.244063 + 0.09911e3 / T + 2.9678e6 / (T * T) - 4.6070e9 / (T * T * T)
                    : 0.237040 + 0.24748e3 / T + 1.9018e6 / (T * T) - 2.0064e9 / (T * T * T);
  return { x: x, y: -3 * x * x + 2.87 * x - 0.275 };
}
function dseries(T) {
  var c = dxy(T), x = c.x, y = c.y, den = 0.0241 + 0.2562 * x - 0.7341 * y;
  var m1 = (-1.3515 - 1.7703 * x + 5.9114 * y) / den, m2 = (0.0300 - 31.4424 * x + 30.0717 * y) / den;
  var o = newSpd();
  for (var w = V0; w <= V1; w++) { var k = w - V0; o[w - WL0] = ds.s0[k] + m1 * ds.s1[k] + m2 * ds.s2[k]; }
  return o;
}
function illumA() { // CIE A (T=2848.0 with c2=1.4350e-2)
  var o = newSpd(); for (var w = WL0; w <= WL1; w++) { var l = w * 1e-9; o[w - WL0] = 100 * Math.pow(560e-9 / l, 5) * (Math.exp(1.435e-2 / (2848 * 560e-9)) - 1) / (Math.exp(1.435e-2 / (2848 * l)) - 1); } return o;
}
function d65spd() { var o = newSpd(); for (var k = 0; k <= 400; k++) o[k + V0 - WL0] = T.d65[k]; return o; }
function equalEnergy() { var o = newSpd(); for (var i = 0; i < N; i++) o[i] = 1; return o; }

/* ---------- tristimulus / chromaticity ---------- */
function XYZ(spd, obs) { // un-normalised sums (observer 2 or 10)
  var x = obs === 10 ? T.x64 : T.x31, y = obs === 10 ? T.y64 : T.y31, z = obs === 10 ? T.z64 : T.z31, X = 0, Y = 0, Z = 0;
  for (var k = 0; k <= 400; k++) { var p = spd[k + V0 - WL0]; X += p * x[k]; Y += p * y[k]; Z += p * z[k]; }
  return { X: X, Y: Y, Z: Z };
}
function xyOf(t) { var s = t.X + t.Y + t.Z; return { x: t.X / s, y: t.Y / s }; }
function xy2uv(x, y) { var d = -2 * x + 12 * y + 3; return { u: 4 * x / d, v: 6 * y / d }; }       // CIE 1960
function xy2upvp(x, y) { var d = -2 * x + 12 * y + 3; return { u: 4 * x / d, v: 9 * y / d }; }     // CIE 1976 u'v'
function upvp2xy(u, v) { var d = 6 * u - 16 * v + 12; return { x: 9 * u / d, y: 4 * v / d }; }

var planckCache = {};
function planckUV(Tk) { // CIE 1960 uv of Planckian radiator
  var key = Math.round(Tk * 1000); var c = planckCache[key]; if (c) return c;
  var t = XYZ(planck(Tk), 2), c2 = xyOf(t), uv = xy2uv(c2.x, c2.y);
  c = { u: uv.u, v: uv.v, x: c2.x, y: c2.y }; if (Object.keys(planckCache).length < 4000) planckCache[key] = c; return c;
}
function planckXY(Tk) { var p = planckUV(Tk); return { x: p.x, y: p.y }; }

/* CCT & Duv: exact nearest point on the Planckian locus in CIE 1960 uv (definition); Duv signed (+ above) */
function cctDuv(x, y) {
  var uv = xy2uv(x, y), u = uv.u, v = uv.v;
  function dist(Tk) { var p = planckUV(Tk); return (u - p.u) * (u - p.u) + (v - p.v) * (v - p.v); }
  var best = 1e30, bt = 0, k, Tk;
  for (k = 0; k <= 160; k++) { Tk = 1000 * Math.pow(100, k / 160); var d = dist(Tk); if (d < best) { best = d; bt = k; } }
  var a = 1000 * Math.pow(100, Math.max(0, bt - 1) / 160), b = 1000 * Math.pow(100, Math.min(160, bt + 1) / 160);
  var gr = 0.6180339887, c1 = b - gr * (b - a), c2 = a + gr * (b - a), f1 = dist(c1), f2 = dist(c2);
  for (k = 0; k < 60; k++) { if (f1 < f2) { b = c2; c2 = c1; f2 = f1; c1 = b - gr * (b - a); f1 = dist(c1); } else { a = c1; c1 = c2; f1 = f2; c2 = a + gr * (b - a); f2 = dist(c2); } }
  var cct = (a + b) / 2, p = planckUV(cct), duv = Math.sqrt(dist(cct));
  // sign: positive if above the locus (towards green): compare with locus tangent normal
  var p2 = planckUV(cct * 1.001), tu = p2.u - p.u, tv = p2.v - p.v; // direction of increasing T
  var cross = tu * (v - p.v) - tv * (u - p.u);                         // >0 => left of travel direction
  // travelling to higher T moves toward lower u... "above" = larger v => with tangent (tu<0) left side is below. Use explicit test:
  var sign = (v - p.v) * 1 >= 0 ? 1 : -1;
  if (Math.abs(v - p.v) < 1e-12) sign = cross < 0 ? 1 : -1;
  var edge = (cct < 1001 || cct > 99000);
  return { cct: cct, duv: sign * duv, valid: !edge && duv <= 0.05 };
}
function mccamy(x, y) { var n = (x - 0.3320) / (0.1858 - y); return 449 * n * n * n + 3525 * n * n + 6823.3 * n + 5520.33; }

/* dominant wavelength / excitation purity (2 deg) relative to equal-energy white */
var locus2 = null;
function spectralLocus() {
  if (locus2) return locus2; var o = [];
  for (var w = 380; w <= 780; w++) { var k = w - 380, s = T.x31[k] + T.y31[k] + T.z31[k]; if (s > 0) o.push({ wl: w, x: T.x31[k] / s, y: T.y31[k] / s }); }
  locus2 = o; return o;
}
function dominant(x, y) {
  var L = spectralLocus(), wx = 1 / 3, wy = 1 / 3, dx = x - wx, dy = y - wy, best = null;
  var pts = L.slice(); pts.push(L[0]);
  for (var i = 0; i < pts.length - 1; i++) {
    var a = pts[i], b = pts[i + 1], ex = b.x - a.x, ey = b.y - a.y, den = dx * ey - dy * ex; if (Math.abs(den) < 1e-14) continue;
    var t = ((a.x - wx) * ey - (a.y - wy) * ex) / den, s = ((a.x - wx) * dy - (a.y - wy) * dx) / den;
    if (t > 0 && s >= 0 && s <= 1) { best = { t: t, s: s, i: i, a: a, b: b }; break; }
  }
  if (!best) return null;
  var ix = wx + best.t * dx, iy = wy + best.t * dy, purity = Math.hypot(dx, dy) / Math.hypot(ix - wx, iy - wy);
  if (best.i === L.length - 1) { // purple line: complementary
    var ax = -dx, ay = -dy, bw = null;
    for (var j = 0; j < L.length - 1; j++) { var p = L[j], q = L[j + 1], ex2 = q.x - p.x, ey2 = q.y - p.y, den2 = ax * ey2 - ay * ex2; if (Math.abs(den2) < 1e-14) continue;
      var t2 = ((p.x - wx) * ey2 - (p.y - wy) * ex2) / den2, s2 = ((p.x - wx) * ay - (p.y - wy) * ax) / den2; if (t2 > 0 && s2 >= 0 && s2 <= 1) { bw = p.wl + s2 * (q.wl - p.wl); break; } }
    return { wl: bw, complementary: true, purity: purity };
  }
  return { wl: best.a.wl + best.s * (best.b.wl - best.a.wl), complementary: false, purity: purity };
}

/* ---------- CRI CIE 13.3-1995 ---------- */
function refIlluminant(cct, blend) {
  if (blend) { // TM-30 / CIE 224 : blend 4500..5500
    if (cct <= 4500) return planck(cct);
    if (cct >= 5500) return dseries(cct);
    var a = planck(cct), b = dseries(cct), ta = XYZ(a, 2), tb = XYZ(b, 2), o = newSpd(), m = (cct - 4500) / 1000;
    // equal-luminance blend (relative SPDs normalised to Y=100)
    for (var i = 0; i < N; i++) o[i] = (1 - m) * a[i] * 100 / ta.Y + m * b[i] * 100 / tb.Y; return o;
  }
  return cct < 5000 ? planck(cct) : dseries(cct);
}
function cri(spd, cctInfo) {
  var t = XYZ(spd, 2), c = xyOf(t), ct = cctInfo || cctDuv(c.x, c.y);
  var ref = refIlluminant(ct.cct, false);
  var tw = XYZ(spd, 2), rw = XYZ(ref, 2);
  var ut = xy2uv(c.x, c.y), crd = xyOf(rw), ur = xy2uv(crd.x, crd.y);
  function cd(u, v) { return { c: (4 - u - 10 * v) / v, d: (1.708 * v + 0.404 - 1.481 * u) / v }; }
  var cT = cd(ut.u, ut.v), cR = cd(ur.u, ur.v);
  var R = [], dEs = [], swT = [], swR = [];
  for (var k = 0; k < 14; k++) {
    var rf = T.tcs[k], Xt = 0, Yt = 0, Zt = 0, Xr = 0, Yr = 0, Zr = 0;
    for (var i = 0; i <= 400; i++) { var p = spd[i + V0 - WL0] * rf[i], q = ref[i + V0 - WL0] * rf[i];
      Xt += p * T.x31[i]; Yt += p * T.y31[i]; Zt += p * T.z31[i]; Xr += q * T.x31[i]; Yr += q * T.y31[i]; Zr += q * T.z31[i]; }
    var Ywt = tw.Y, Ywr = rw.Y;
    var st = Xt + Yt + Zt, sr = Xr + Yr + Zr;
    var uvT = xy2uv(Xt / st, Yt / st), uvR = xy2uv(Xr / sr, Yr / sr);
    var ck = cd(uvT.u, uvT.v), cc = cR.c / cT.c * ck.c, dd = cR.d / cT.d * ck.d;
    var up = (10.872 + 0.404 * cc - 4 * dd) / (16.518 + 1.481 * cc - dd), vp = 5.520 / (16.518 + 1.481 * cc - dd);
    var Wt = 25 * Math.cbrt(100 * Yt / Ywt) - 17, Wr = 25 * Math.cbrt(100 * Yr / Ywr) - 17;
    var Ut = 13 * Wt * (up - ur.u), Vt = 13 * Wt * (vp - ur.v), Ur = 13 * Wr * (uvR.u - ur.u), Vr = 13 * Wr * (uvR.v - ur.v);
    var dE = Math.sqrt((Ut - Ur) * (Ut - Ur) + (Vt - Vr) * (Vt - Vr) + (Wt - Wr) * (Wt - Wr));
    dEs.push(dE); R.push(100 - 4.6 * dE);
    swT.push([Xt / Ywt, Yt / Ywt, Zt / Ywt]); swR.push([Xr / Ywr, Yr / Ywr, Zr / Ywr]);
  }
  var ra = 0; for (k = 0; k < 8; k++) ra += R[k]; ra /= 8;
  return { Ra: ra, R: R, dE: dEs, refCCT: ct.cct, refType: ct.cct < 5000 ? 'Planckian' : 'CIE D', swatchTest: swT, swatchRef: swR,
    dchroma: Math.hypot(ut.u - ur.u, ut.v - ur.v), ref: ref };
}

/* ---------- CIECAM02 / CAM02-UCS ---------- */
var MCAT = [[0.7328, 0.4296, -0.1624], [-0.7036, 1.6975, 0.0061], [0.0030, 0.0136, 0.9834]];
var MCATi = [[1.096124, -0.278869, 0.182745], [0.454369, 0.473533, 0.072098], [-0.009628, -0.005698, 1.015326]];
var MHPE = [[0.38971, 0.68898, -0.07868], [-0.22981, 1.18340, 0.04641], [0, 0, 1]];
function mul(M, v) { return [M[0][0] * v[0] + M[0][1] * v[1] + M[0][2] * v[2], M[1][0] * v[0] + M[1][1] * v[1] + M[1][2] * v[2], M[2][0] * v[0] + M[2][1] * v[1] + M[2][2] * v[2]]; }
function camSetup(W, LA, Yb) { // W = [Xw,Yw,Zw] with Yw=100
  var k = 1 / (5 * LA + 1), k4 = k * k * k * k, FL = 0.2 * k4 * 5 * LA + 0.1 * (1 - k4) * (1 - k4) * Math.cbrt(5 * LA);
  var n = Yb / W[1], Nbb = 0.725 * Math.pow(1 / n, 0.2), z = 1.48 + Math.sqrt(n);
  var rgbw = mul(MCAT, W), D = 1, Dr = [W[1] / rgbw[0] * D + 1 - D, W[1] / rgbw[1] * D + 1 - D, W[1] / rgbw[2] * D + 1 - D];
  var S = { FL: FL, n: n, Nbb: Nbb, z: z, Dr: Dr, c: 0.69, Nc: 1.0 };
  var Aw = camA(W, S); S.Aw = Aw; return S;
}
function adaptCompress(v, FL) { var a = Math.pow(FL * Math.abs(v) / 100, 0.42); return (v < 0 ? -1 : 1) * 400 * a / (27.13 + a) + 0.1; }
function camA(XYZv, S) {
  var rgb = mul(MCAT, XYZv); rgb = [rgb[0] * S.Dr[0], rgb[1] * S.Dr[1], rgb[2] * S.Dr[2]];
  var hpe = mul(MHPE, mul(MCATi, rgb));
  var ra = adaptCompress(hpe[0], S.FL), ga = adaptCompress(hpe[1], S.FL), ba = adaptCompress(hpe[2], S.FL);
  return (2 * ra + ga + ba / 20 - 0.305) * S.Nbb;
}
function camUCS(XYZv, S) {
  var rgb = mul(MCAT, XYZv); rgb = [rgb[0] * S.Dr[0], rgb[1] * S.Dr[1], rgb[2] * S.Dr[2]];
  var hpe = mul(MHPE, mul(MCATi, rgb));
  var ra = adaptCompress(hpe[0], S.FL), ga = adaptCompress(hpe[1], S.FL), ba = adaptCompress(hpe[2], S.FL);
  var A = (2 * ra + ga + ba / 20 - 0.305) * S.Nbb;
  var a = ra - 12 * ga / 11 + ba / 11, b = (ra + ga - 2 * ba) / 9;
  var h = Math.atan2(b, a); if (h < 0) h += 2 * Math.PI;
  var et = 0.25 * (Math.cos(h + 2) + 3.8);
  var t = (50000 / 13 * S.Nc * S.Nbb * et * Math.sqrt(a * a + b * b)) / (ra + ga + 21 / 20 * ba);
  var J = 100 * Math.pow(Math.max(A, 0) / S.Aw, S.c * S.z);
  var Cc = Math.pow(t, 0.9) * Math.sqrt(J / 100) * Math.pow(1.64 - Math.pow(0.29, S.n), 0.73);
  var M = Cc * Math.pow(S.FL, 0.25);
  var Jp = 1.7 * J / (1 + 0.007 * J), Mp = Math.log(1 + 0.0228 * M) / 0.0228;
  return { J: J, M: M, h: h, Jp: Jp, ap: Mp * Math.cos(h), bp: Mp * Math.sin(h) };
}

/* ---------- TM-30-20 ---------- */
var HUE_NAMES = ['Red-pink', 'Red', 'Orange', 'Yellow', 'Yellow-green', 'Green', 'Green-cyan', 'Cyan', 'Cyan-blue', 'Blue', 'Blue-violet', 'Violet', 'Purple', 'Magenta', 'Pink', 'Pink-red'];
function rfTransform(dE) { return 10 * Math.log(Math.exp((100 - 6.73 * dE) / 10) + 1); }
function samplesXYZ(spd, tabs, obs) {
  var xb = obs === 10 ? T.x64 : T.x31, yb = obs === 10 ? T.y64 : T.y31, zb = obs === 10 ? T.z64 : T.z31, out = [];
  var Xw = 0, Yw = 0, Zw = 0, i, k;
  for (i = 0; i <= 400; i++) { var p = spd[i + V0 - WL0]; Xw += p * xb[i]; Yw += p * yb[i]; Zw += p * zb[i]; }
  var kk = 100 / Yw;
  for (k = 0; k < tabs.length; k++) { var X = 0, Y = 0, Z = 0, rf = tabs[k];
    for (i = 0; i <= 400; i++) { var q = spd[i + V0 - WL0] * rf[i]; X += q * xb[i]; Y += q * yb[i]; Z += q * zb[i]; }
    out.push([X * kk, Y * kk, Z * kk]); }
  return { W: [Xw * kk, 100, Zw * kk], S: out };
}
function tm30(spd, cctInfo) {
  var t2 = XYZ(spd, 2), c = xyOf(t2), ct = cctInfo || cctDuv(c.x, c.y);
  var ref = refIlluminant(ct.cct, true);
  var A = samplesXYZ(spd, T.ces, 10), B = samplesXYZ(ref, T.ces, 10);
  var sA = camSetup(A.W, 100, 20), sB = camSetup(B.W, 100, 20);
  var n = 99, tst = [], rf = [], dE = [], i;
  for (i = 0; i < n; i++) { tst.push(camUCS(A.S[i], sA)); rf.push(camUCS(B.S[i], sB)); }
  var sum = 0;
  for (i = 0; i < n; i++) { var d = Math.hypot(tst[i].Jp - rf[i].Jp, tst[i].ap - rf[i].ap, tst[i].bp - rf[i].bp); dE.push(d); sum += d; }
  var Rf = rfTransform(sum / n), RfI = dE.map(rfTransform);
  var bins = [], j;
  for (j = 0; j < 16; j++) bins.push({ n: 0, at: 0, bt: 0, ar: 0, br: 0, dE: 0, idx: [] });
  for (i = 0; i < n; i++) { var hdeg = rf[i].h * 180 / Math.PI, bj = Math.min(15, Math.floor(hdeg / 22.5)); var B_ = bins[bj];
    B_.n++; B_.at += tst[i].ap; B_.bt += tst[i].bp; B_.ar += rf[i].ap; B_.br += rf[i].bp; B_.dE += dE[i]; B_.idx.push(i); }
  var Rfh = [], Rcs = [], Rhs = [], cvg = [], refPts = [], tstPts = [];
  for (j = 0; j < 16; j++) { var b = bins[j]; if (!b.n) { Rfh.push(null); Rcs.push(null); Rhs.push(null); cvg.push(null); refPts.push([0, 0]); tstPts.push([0, 0]); continue; }
    b.at /= b.n; b.bt /= b.n; b.ar /= b.n; b.br /= b.n; b.dE /= b.n;
    var Ct = Math.hypot(b.at, b.bt), Cr = Math.hypot(b.ar, b.br);
    Rfh.push(rfTransform(b.dE)); Rcs.push((Ct - Cr) / Cr);
    var dh = Math.atan2(b.bt, b.at) - Math.atan2(b.br, b.ar); while (dh > Math.PI) dh -= 2 * Math.PI; while (dh < -Math.PI) dh += 2 * Math.PI;
    Rhs.push(dh); refPts.push([b.ar, b.br]); tstPts.push([b.at, b.bt]);
    cvg.push({ rx: b.ar / Cr, ry: b.br / Cr, tx: b.at / Cr, ty: b.bt / Cr }); }
  function area(P) { var s = 0; for (var q = 0; q < P.length; q++) { var a = P[q], b2 = P[(q + 1) % P.length]; s += a[0] * b2[1] - b2[0] * a[1]; } return Math.abs(s) / 2; }
  var Rg = 100 * area(tstPts) / area(refPts);
  var skin = (RfI[14] + RfI[17]) / 2; // CES 15 and 18
  var swT = [], swR = [];
  for (i = 0; i < n; i++) { swT.push(A.S[i]); swR.push(B.S[i]); }
  return { Rf: Rf, Rg: Rg, RfI: RfI, dE: dE, Rfh: Rfh, Rcs: Rcs, Rhs: Rhs, cvg: cvg, bins: bins, Rfskin: skin, Rcsh1: Rcs[0], refCCT: ct.cct, refType: ct.cct <= 4500 ? 'Planckian' : (ct.cct >= 5500 ? 'CIE D' : 'Blend'),
    swatchTest: swT, swatchRef: swR, cam: { test: tst, ref: rf }, ref: ref, whiteTest: A.W, whiteRef: B.W };
}

/* ---------- sRGB helper for display colours ---------- */
function xyz2srgb(X, Y, Z, norm) { // X,Y,Z relative (Y=1 white); returns [r,g,b] 0..255 with gamma
  var r = 3.2406 * X - 1.5372 * Y - 0.4986 * Z, g = -0.9689 * X + 1.8758 * Y + 0.0415 * Z, b = 0.0557 * X - 0.2040 * Y + 1.0570 * Z;
  function gm(v) { v = Math.max(0, Math.min(1, v)); return 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055); }
  return [gm(r), gm(g), gm(b)];
}
function xyToRGB(x, y, Ymax) { // colour of chromaticity, scaled so max channel = 1
  var X = x / y, Y = 1, Z = (1 - x - y) / y;
  var r = 3.2406 * X - 1.5372 * Y - 0.4986 * Z, g = -0.9689 * X + 1.8758 * Y + 0.0415 * Z, b = 0.0557 * X - 0.2040 * Y + 1.0570 * Z;
  var m = Math.max(r, g, b, 1e-9); r /= m; g /= m; b /= m;
  function gm(v) { v = Math.max(0, v); return 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055); }
  return [gm(r), gm(g), gm(b)];
}
function wlToRGB(w) { var k = w - 380; if (k < 0 || k > 400) return [90, 90, 90]; var s = T.x31[k] + T.y31[k] + T.z31[k]; return xyToRGB(T.x31[k] / s, T.y31[k] / s); }
function swatchRGB(xyzArr) { // sample XYZ (Y=100 white) -> sRGB (adapt-free approximation)
  var c = xyz2srgb(xyzArr[0] / 100, xyzArr[1] / 100, xyzArr[2] / 100); return c;
}

/* ---------- alpha-opic, photometry, photon metrics ---------- */
var ALPHA = [
  { id: 'S', name: 'S-cone-opic (cyanolabe)', tab: T.S, peak: 'S', col: '#6c63ff' },
  { id: 'M', name: 'M-cone-opic (chlorolabe)', tab: T.M, col: '#3aa655' },
  { id: 'L', name: 'L-cone-opic (erythrolabe)', tab: T.L, col: '#d9534f' },
  { id: 'R', name: 'Rhodopic (rods)', tab: T.R, col: '#6b7a8f' },
  { id: 'Mel', name: 'Melanopic (ipRGC)', tab: T.Mel, col: '#1fa5c9' }
];
var d65Spd = d65spd();
function alphaK(spd) { var ev = KM * sumVis(spd, T.y31), o = {}; ALPHA.forEach(function (a) { o[a.id] = sumVis(spd, a.tab) / ev; }); return o; }
var KD65 = alphaK(d65Spd);

function bandPhotons(spd, w0, w1) { // photons/s for relative spd in W/nm
  var s = 0; for (var w = Math.max(w0, WL0); w <= Math.min(w1, WL1); w++) s += spd[w - WL0] * (w * 1e-9) / (H * C); return s;
}
/* analyse(spd) : spd must be ABSOLUTE spectral radiant flux in W/nm (1 nm grid) */
function analyse(spd, opts) {
  opts = opts || {};
  var obs2 = XYZ(spd, 2), c = xyOf(obs2), uv = xy2uv(c.x, c.y), up = xy2upvp(c.x, c.y), cc = cctDuv(c.x, c.y);
  var obs10 = XYZ(spd, 10), c10 = xyOf(obs10), up10 = xy2upvp(c10.x, c10.y);
  var phi_e = sumAll(spd);                                 // W (1 nm bins)
  var phi_v = KM * obs2.Y, phi_vp = KMP * sumVis(spd, T.vp), phi_v10 = KM * obs10.Y;
  var res = {
    xy: c, uv: uv, upvp: up, xy10: c10, upvp10: up10, XYZ: obs2, XYZ10: obs10,
    cct: cc.cct, duv: cc.duv, cctValid: cc.valid, cctMcCamy: mccamy(c.x, c.y),
    dominant: dominant(c.x, c.y),
    radiantW: phi_e, lumens: phi_v, lumensScot: phi_vp, lumens10: phi_v10,
    LER: phi_e > 0 ? phi_v / phi_e : 0, SP: phi_v > 0 ? phi_vp / phi_v : 0,
    peak: peakOf(spd)
  };
  res.WperLm = res.lumens > 0 ? phi_e / res.lumens : 0;
  res.LERscot = phi_e > 0 ? phi_vp / phi_e : 0;
  res.LER380_780 = (function () { var s = 0; for (var w = V0; w <= V1; w++) s += spd[w - WL0]; return s > 0 ? phi_v / s : 0; })();
  // centroid & FWHM-ish
  var s0 = 0, s1 = 0; for (var w = WL0; w <= WL1; w++) { s0 += spd[w - WL0]; s1 += spd[w - WL0] * w; } res.centroid = s0 > 0 ? s1 / s0 : 0;
  // photons
  var ph = bandPhotons(spd, 280, 1000) , umol = function (p) { return p / NA * 1e6; };
  res.photon = {
    total: umol(ph), ppf: umol(bandPhotons(spd, 400, 700)), epar: umol(bandPhotons(spd, 400, 750)),
    uv: umol(bandPhotons(spd, 280, 399)), blue: umol(bandPhotons(spd, 400, 499)), green: umol(bandPhotons(spd, 500, 599)),
    red: umol(bandPhotons(spd, 600, 699)), farred: umol(bandPhotons(spd, 700, 750)), nir: umol(bandPhotons(spd, 751, 1000)),
    r660: umol(bandPhotons(spd, 650, 680))
  };
  res.bandsRad = { uv: 0, vis: 0, nir: 0 };
  for (w = WL0; w <= WL1; w++) { var v = spd[w - WL0]; if (w < 380) res.bandsRad.uv += v; else if (w <= 780) res.bandsRad.vis += v; else res.bandsRad.nir += v; }
  // radiant bands
  res.bands = {}; [['UV-A/B <400', 280, 399], ['Violet/Blue 400-500', 400, 499], ['Green 500-600', 500, 599], ['Red 600-700', 600, 699], ['Far-red 700-780', 700, 780], ['NIR >780', 781, 1000]].forEach(function (b) { var s = 0; for (var w = Math.max(b[1], WL0); w <= Math.min(b[2], WL1); w++) s += spd[w - WL0]; res.bands[b[0]] = s; });
  // CRI & TM-30
  res.cri = cri(spd, cc); res.tm30 = tm30(spd, cc); res.sq = spectralQuality(spd, res.tm30.ref);
  // alpha-opic (E_v in lx given by opts.Ev or 500)
  var Ev = opts.Ev || 500, K = alphaK(spd), al = {};
  ALPHA.forEach(function (a) { var Ka = K[a.id], der = Ka / KD65[a.id]; al[a.id] = { name: a.name, K: Ka, DER: der, EDI: der * Ev, E: Ka * Ev, col: a.col }; });
  res.alpha = al; res.Ev = Ev;
  res.melRatio = al.Mel.K / (1); // W/lm
  // photopic / mel ratio : melanopic ratio (EDI/Ev) = DER
  return res;
}


/* ---------- spectral quality: similarity to reference, band coverage, smoothness ---------- */
function visSum(spd) { var s = 0; for (var w = 380; w <= 780; w++) s += spd[w - WL0]; return s; }
function bin5(spd) { var o = [], tot = visSum(spd) || 1; for (var w = 380; w < 780; w += 5) { var s = 0; for (var k = 0; k < 5; k++) s += spd[w + k - WL0]; o.push(s / tot); } return o; }
/* SSI: overlap (in %) of the test and reference spectra, both normalised to equal power over 380-780 nm, in 5 nm bins.
   100 = identical shape; 0 = no overlap. (This is this tool's definition; other "SSI" definitions exist.) */
function ssi(spd, ref) { var a = bin5(spd), b = bin5(ref), s = 0; for (var i = 0; i < a.length; i++) s += Math.min(a[i], b[i]); return 100 * s; }
/* Band coverage: share of the 380-780 power inside [w0,w1], relative to the reference's share. 1.0 = same as reference.
   trough = lowest 10 nm moving-average coverage inside the band (depth of a dip). */
function bandStats(spd, ref, w0, w1) {
  var ts = visSum(spd) || 1, rs = visSum(ref) || 1, t = 0, r = 0, w;
  for (w = Math.max(380, w0); w <= Math.min(780, w1); w++) { t += spd[w - WL0]; r += ref[w - WL0]; }
  var st = t / ts, sr = r / rs, best = Infinity, half = 5;
  if (w1 - w0 < 2 * half + 1) best = sr > 0 ? st / sr : 0;
  else for (var c = w0 + half; c <= w1 - half; c++) { var a = 0, b = 0; for (w = c - half; w <= c + half; w++) { a += spd[w - WL0]; b += ref[w - WL0]; } var q = b > 0 ? (a / ts) / (b / rs) : 0; if (q < best) best = q; }
  return { w0: w0, w1: w1, test: st, ref: sr, ratio: sr > 0 ? st / sr : 0, trough: best };
}
function gaussBlur(spd, sigma) {
  var R = Math.ceil(sigma * 3), k = [], ks = 0, i, j; for (i = -R; i <= R; i++) { var v = Math.exp(-0.5 * i * i / (sigma * sigma)); k.push(v); ks += v; }
  var o = new Float64Array(N); for (i = 0; i < N; i++) { var s = 0; for (j = -R; j <= R; j++) { var q = i + j; if (q >= 0 && q < N) s += spd[q] * k[j + R]; } o[i] = s / ks; } return o;
}
/* spikiness: share of the visible power that sits above a broad (sigma = 25 nm, FWHM ~59 nm) running envelope of the spectrum */
function spikiness(spd) { var b = gaussBlur(spd, 25), up = 0, tot = 0; for (var w = 380; w <= 780; w++) { var d = spd[w - WL0] - b[w - WL0]; if (d > 0) up += d; tot += spd[w - WL0]; } return tot > 0 ? up / tot : 0; }
function effBandwidth(spd) { var s1 = 0, s2 = 0; for (var w = 380; w <= 780; w++) { var v = spd[w - WL0]; s1 += v; s2 += v * v; } return s2 > 0 ? s1 * s1 / s2 : 0; }
/* peaks: local maxima of the 3 nm smoothed spectrum with prominence >= 5% of the maximum; width at half prominence */
function findPeaks(spd) {
  var n = 401, y = new Float64Array(n), i, j, mx = 0;
  for (i = 0; i < n; i++) { var s = 0, c = 0; for (j = -1; j <= 1; j++) { var q = i + j; if (q >= 0 && q < n) { s += spd[380 + q - WL0]; c++; } } y[i] = s / c; if (y[i] > mx) mx = y[i]; }
  var out = [];
  for (i = 1; i < n - 1; i++) {
    if (!(y[i] > y[i - 1] && y[i] >= y[i + 1])) continue;
    var lm = y[i], k = i; while (k > 0 && y[k - 1] <= y[i]) { k--; if (y[k] < lm) lm = y[k]; }
    var rm = y[i]; k = i; while (k < n - 1 && y[k + 1] <= y[i]) { k++; if (y[k] < rm) rm = y[k]; }
    var prom = y[i] - Math.max(lm, rm); if (prom < 0.05 * mx) continue;
    var lev = y[i] - prom / 2, a = i, b = i; while (a > 0 && y[a] > lev) a--; while (b < n - 1 && y[b] > lev) b++;
    var fa = a + (lev - y[a]) / ((y[a + 1] - y[a]) || 1), fb = b - 1 + (y[b - 1] - lev) / ((y[b - 1] - y[b]) || 1);
    out.push({ wl: 380 + i, rel: y[i] / mx, prom: prom / mx, fwhm: Math.max(0, fb - fa) });
  }
  return out;
}
var SQ_BANDS = [{ id: 'violet', name: 'Violet-blue 400-470', w0: 400, w1: 470 }, { id: 'cyan', name: 'Cyan 470-510', w0: 470, w1: 510 }, { id: 'green', name: 'Green-yellow 510-580', w0: 510, w1: 580 }, { id: 'red', name: 'Orange-red 580-630', w0: 580, w1: 630 }, { id: 'deepred', name: 'Deep red 630-760', w0: 630, w1: 760 }];
function spectralQuality(spd, ref) {
  var sq = { ssi: ssi(spd, ref), bands: {}, spike: spikiness(spd), spikeRef: spikiness(ref), effBW: effBandwidth(spd), effBWref: effBandwidth(ref), peaks: findPeaks(spd) };
  SQ_BANDS.forEach(function (b) { sq.bands[b.id] = bandStats(spd, ref, b.w0, b.w1); });
  sq.smooth = 100 * (1 - sq.spike); sq.smoothRef = 100 * (1 - sq.spikeRef);
  sq.bins = []; var ts = visSum(spd) || 1, rs = visSum(ref) || 1;
  for (var w = 380; w < 780; w += 20) { var a = 0, b = 0; for (var k = 0; k < 20; k++) { a += spd[w + k - WL0]; b += ref[w + k - WL0]; } sq.bins.push({ w0: w, w1: w + 19, ratio: b > 0 ? (a / ts) / (b / rs) : 0 }); }
  var narrow = null; sq.peaks.forEach(function (p) { if (!narrow || p.fwhm < narrow.fwhm) narrow = p; }); sq.narrowest = narrow;
  return sq;
}

/* ---------- LED spectrum generators ---------- */
function gaussian(peak, fwhm, skew) {
  // split Gaussian: widths wl (left) wr (right) with fwhm total and skew in [-0.5..0.5] (+ = longer red tail)
  var sk = skew || 0, wl = fwhm * (1 - sk), wr = fwhm * (1 + sk), o = newSpd();
  for (var w = WL0; w <= WL1; w++) { var f = w < peak ? wl : wr, s = f / 2.354820045; var d = (w - peak) / s; o[w - WL0] = Math.exp(-0.5 * d * d); }
  return o;
}
function defaultFWHM(peak) { // typical visible LED widths (nm)
  var tb = [[250, 12], [365, 12], [400, 15], [450, 20], [470, 24], [505, 32], [525, 36], [560, 30], [590, 17], [630, 18], [660, 22], [730, 28], [850, 35], [950, 40]];
  if (peak <= tb[0][0]) return tb[0][1]; for (var i = 0; i < tb.length - 1; i++) if (peak <= tb[i + 1][0]) { var t = (peak - tb[i][0]) / (tb[i + 1][0] - tb[i][0]); return tb[i][1] * (1 - t) + tb[i + 1][1] * t; } return tb[tb.length - 1][1];
}
function pcWhite(p) { // blue pump + up to 3 phosphor bands (each: peak, fwhm, ratio of radiant power to pump power)
  var o = newSpd(), pump = gaussian(p.pumpPeak, p.pumpFwhm, 0), sp = sumAll(pump); addScaled(o, pump, 1 / sp);
  (p.bands || []).forEach(function (b) { var g = gaussian(b.peak, b.fwhm, b.skew || 0), sg = sumAll(g); addScaled(o, g, b.ratio / sg); });
  return o;
}
function spdFromDef(def) {
  if (!def) return newSpd();
  if (def.kind === 'gauss') return gaussian(def.peak, def.fwhm, def.skew || 0);
  if (def.kind === 'pc') return pcWhite(def);
  if (def.kind === 'sum') { var o = newSpd(); (def.parts || []).forEach(function (p) { var s = spdFromDef(p.def), ss = sumAll(s) || 1; addScaled(o, s, p.w / ss); }); return o; }
  if (def.kind === 'bb') return scale(planck(def.T), 1);
  if (def.kind === 'points') return fromPoints(def.points);
  if (def.kind === 'grid') { var g = newSpd(); var st = def.step || 1, wl0 = def.start; for (var i = 0; i < def.values.length; i++) { var w = wl0 + i * st; if (st === 1) { if (w >= WL0 && w <= WL1) g[w - WL0] = def.values[i]; } } if (st !== 1) { return fromPoints(def.values.map(function (v, k) { return [wl0 + k * st, v]; })); } return g; }
  return newSpd();
}


/* phosphor-converted white: solve phosphor power ratios so that chromaticity lies on the Planckian locus at target CCT */
var PC_FAMILIES = {
  ra80: { label: 'Standard (Ra \u2248 80-84)', y: [545, 105], r: [620, 85] },
  ra90: { label: 'High CRI (Ra \u2248 90-93)', y: [530, 95], r: [625, 100] },
  ra97: { label: 'Very high CRI (Ra \u2248 96, R9 \u2248 90)', y: [535, 100], r: [635, 90] }
};
function pcAuto(cct, fam, pumpPeak, pumpFwhm) {
  var f = PC_FAMILIES[fam] || PC_FAMILIES.ra80; pumpPeak = pumpPeak || 450; pumpFwhm = pumpFwhm || 18;
  function g(p, w) { var s = gaussian(p, w, 0); return scale(s, 1 / sumAll(s)); }
  var c = planckXY(cct), P = g(pumpPeak, pumpFwhm), Y = g(f.y[0], f.y[1]), R = g(f.r[0], f.r[1]);
  function eq(t) { var S = t.X + t.Y + t.Z; return [t.X - c.x * S, t.Y - c.y * S]; }
  var ep = eq(XYZ(P, 2)), ey = eq(XYZ(Y, 2)), er = eq(XYZ(R, 2)), det = ey[0] * er[1] - ey[1] * er[0];
  var a = (-ep[0] * er[1] + ep[1] * er[0]) / det, b = (-ey[0] * ep[1] + ey[1] * ep[0]) / det;
  if (!(a > 0) || !(b >= 0)) { a = Math.max(a, 0.05); b = Math.max(b, 0); }
  return { kind: 'pc', pumpPeak: pumpPeak, pumpFwhm: pumpFwhm, auto: { cct: cct, family: fam },
    bands: [{ peak: f.y[0], fwhm: f.y[1], ratio: +a.toFixed(4) }, { peak: f.r[0], fwhm: f.r[1], ratio: +b.toFixed(4) }] };
}

root.LSL = {
  WL0: WL0, WL1: WL1, N: N, T: T, ALPHA: ALPHA, KD65: KD65, KM: KM, KMP: KMP, HUE_NAMES: HUE_NAMES,
  newSpd: newSpd, fromPoints: fromPoints, sumAll: sumAll, sumVis: sumVis, scale: scale, addScaled: addScaled, peakOf: peakOf,
  planck: planck, dseries: dseries, illumA: illumA, d65spd: d65spd, equalEnergy: equalEnergy, planckXY: planckXY, planckUV: planckUV,
  XYZ: XYZ, xyOf: xyOf, xy2uv: xy2uv, xy2upvp: xy2upvp, upvp2xy: upvp2xy, cctDuv: cctDuv, mccamy: mccamy, dominant: dominant, spectralLocus: spectralLocus, dxy: dxy,
  cri: cri, tm30: tm30, analyse: analyse, refIlluminant: refIlluminant,
  gaussian: gaussian, pcAuto: pcAuto, PC_FAMILIES: PC_FAMILIES, defaultFWHM: defaultFWHM, pcWhite: pcWhite, spdFromDef: spdFromDef,
  xyToRGB: xyToRGB, wlToRGB: wlToRGB, swatchRGB: swatchRGB, bandPhotons: bandPhotons, alphaK: alphaK, rfTransform: rfTransform, ssi: ssi, bandStats: bandStats, spikiness: spikiness, effBandwidth: effBandwidth, findPeaks: findPeaks, spectralQuality: spectralQuality, SQ_BANDS: SQ_BANDS, camSetup: camSetup, camA: camA, camUCS: camUCS
};
if (typeof module !== 'undefined' && module.exports) module.exports = root.LSL;
})(typeof globalThis !== 'undefined' ? globalThis : this);
