/* i1pro-core.js — browser/Node driver for the X-Rite / Gretag-Macbeth i1 Pro (Rev A–D) over WebUSB.
 *
 * Ported from ArgyllCMS spectro/i1pro_imp.c (USB command set, EEPROM key table, linearisation,
 * adaptive integration, interpolated dark calibration, 36-band matrix, emission calibration).
 * Everything outside the USB transport is plain maths and runs in Node for testing.
 *
 * Not covered: Rev E / i1Pro2 (different protocol), reflective/transmissive modes, scan mode, high-gain mode
 * (disabled in Argyll too: USE_HIGH_GAIN_MODE is #undef'd).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.I1Pro = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const VID = 0x0971, PID = 0x2000;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const NPIX = 128, NBAND = 36;
  const WL36 = Array.from({ length: NBAND }, (_, i) => 380 + 10 * i);
  const SLOPE = (730 - 380) / (13 - 120);           // nm per pixel (negative: blue is on high pixels)
  const px2nm = px => 380 + (px - 120) * SLOPE;

  class I1Error extends Error {
    constructor(code, msg) { super(msg || code); this.code = code; }
  }

  /* ------------------------------------------------------------------ EEPROM */
  const INT_KEYS = new Set([0x3ea, 0x3eb, 0x4b4, 0x4b5, 0x4b7, 0x4b8, 0x4bb, 0x4bc, 0xbb9, 0xbba, 0xbbf, 0xbc0,
    0xbc1, 0xbc2, 0xbc3, 0xbc4, 0xbc5, 0xfa0]);

  /* Key table lives at 0x1000: u16 id, u16 byteLength, then (u16 key, u32 addr) entries. Size of a value is the
     distance to the next address. Verified against the S/N 715997 dump (55 keys, 334 bytes). */
  function decodeEEPROM(u8) {
    if (u8.length < 0x2000) throw new I1Error('EEPROM', 'EEPROM image too short');
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const len = dv.getUint16(0x1002);
    if (len < 10 || len > 2000 || (len - 4) % 6) throw new I1Error('EEPROM', 'Unrecognised EEPROM key table');
    const n = (len - 4) / 6, ents = [];
    for (let i = 0; i < n; i++) ents.push({ key: dv.getUint16(0x1004 + 6 * i), addr: dv.getUint32(0x1006 + 6 * i) });
    const addrs = [...new Set(ents.map(e => e.addr))].sort((a, b) => a - b);
    const T = new Map();
    for (const e of ents) {
      const nx = addrs.find(a => a > e.addr);
      T.set(e.key, { addr: e.addr, size: nx === undefined ? 0 : nx - e.addr });
    }
    const need = k => { const t = T.get(k); if (!t) throw new I1Error('EEPROM', 'Missing EEPROM key 0x' + k.toString(16)); return t; };
    const getI = k => { const t = need(k), o = new Array(t.size >> 2); for (let i = 0; i < o.length; i++) o[i] = dv.getInt32(t.addr + 4 * i); return o; };
    const getF = k => { const t = need(k), o = new Float64Array(t.size >> 2); for (let i = 0; i < o.length; i++) o[i] = dv.getFloat32(t.addr + 4 * i); return o; };

    const index = getI(0x3ea).slice(0, NBAND), nocoef = getI(0x3eb).slice(0, NBAND), flat = getF(0x3ec);
    const coef = []; let cx = 0;
    for (let b = 0; b < NBAND; b++) { coef.push(Float64Array.from(flat.subarray(cx, cx + nocoef[b]))); cx += nocoef[b]; }
    const cal = {
      serial: getI(0x4bb)[0], mfgDate: getI(0x4bc)[0], cpldRev: getI(0xbc0)[0], physFilter: getI(0xbc4)[0],
      lin0: Array.from(getF(0x3e8)), lin1: Array.from(getF(0x3e9)),
      minIntEE: getF(0x4c5)[0], maxInt: getF(0x4c6)[0],
      sensTarget: getI(0x4b4)[0], sensDark: getI(0x4b5)[0], sat0: getI(0x4b7)[0], sat1: getI(0x4b8)[0],
      highgain: getF(0x4bd)[0],
      index, nocoef, coef, white: getF(0x44c), emis: getF(0x44d).subarray(0, NBAND),
      keys: [...T.keys()]
    };
    if (cal.emis.length < NBAND) throw new I1Error('EEPROM', 'emission calibration incomplete');
    Object.assign(cal, pixelWavelengths(cal));
    return cal;
  }

  /* Wavelength of every pixel, derived from this unit's own factory matrix instead of a straight line. Row b of the matrix
     is the response of band b (380 + 10 b nm); its weighted mean pixel position says where that wavelength lands on the
     sensor. A cubic through those 36 points gives wavelength(pixel), valid between the bands (about pixels 13-120); the
     few pixels beyond are extrapolated. Returns { pxnm (128 values), pxnmErr (rms of the cubic fit, nm) }. */
  function pixelWavelengths(cal) {
    const xs = [], ys = [];
    for (let b = 0; b < NBAND; b++) {
      let s = 0, sx = 0; for (let k = 0; k < cal.coef[b].length; k++) { s += cal.coef[b][k]; sx += cal.coef[b][k] * (cal.index[b] + k); }
      if (Math.abs(s) > 1e-9) { xs.push((sx / s - 64) / 64); ys.push(380 + 10 * b); }
    }
    if (xs.length < 12) return { pxnm: Float64Array.from({ length: NPIX }, (_, p) => px2nm(p)), pxnmErr: NaN };
    const D = 4, A = Array.from({ length: D }, () => new Float64Array(D + 1));
    for (let i = 0; i < xs.length; i++) for (let r = 0; r < D; r++) { for (let c = 0; c < D; c++) A[r][c] += Math.pow(xs[i], r + c); A[r][D] += ys[i] * Math.pow(xs[i], r); }
    for (let c = 0; c < D; c++) {                                  // Gauss-Jordan
      let m = c; for (let r = c + 1; r < D; r++) if (Math.abs(A[r][c]) > Math.abs(A[m][c])) m = r;
      [A[c], A[m]] = [A[m], A[c]];
      for (let r = 0; r < D; r++) if (r !== c) { const f = A[r][c] / A[c][c]; for (let k = c; k <= D; k++) A[r][k] -= f * A[c][k]; }
    }
    const co = A.map((row, r) => row[D] / row[r]), f = x => co[0] + x * (co[1] + x * (co[2] + x * co[3]));
    let e = 0; for (let i = 0; i < xs.length; i++) e += (f(xs[i]) - ys[i]) ** 2;
    return { pxnm: Float64Array.from({ length: NPIX }, (_, p) => f((p - 64) / 64)), pxnmErr: Math.sqrt(e / xs.length) };
  }

  /* ------------------------------------------------------------------ core maths (all ported 1:1) */
  const compNummeas = (t, it) => { if (t <= 0) return 0; return Math.max(1, Math.floor(t / it + 0.5)); };

  /* raw bytes -> absolute linearised sensor values (counts/sec), i1pro_sens_to_absraw (Rev A–D branch) */
  function rawToAbs(u8, n, inttime, cal, maxpve, subtmode) {
    const out = new Float64Array(n * NPIX), p = cal.lin0, scale = 1 / inttime;
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let avlast = 0;
    if (subtmode) {
      for (let i = 0; i < n; i++) { let v = dv.getUint16(i * 256 + 254); if (v >= maxpve) v -= 65536; avlast += v; }
      avlast /= n;
    }
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < NPIX; j++) {
        let v = dv.getUint16(i * 256 + 2 * j); if (v >= maxpve) v -= 65536;
        v -= avlast;
        let l = p[p.length - 1];
        for (let k = p.length - 2; k >= 0; k--) l = l * v + p[k];
        out[i * NPIX + j] = l * scale;
      }
      out[i * NPIX] = out[i * NPIX + 1];
      out[i * NPIX + 127] = out[i * NPIX + 126];
    }
    return out;
  }
  function rawInts(u8, n, maxpve) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), o = new Int32Array(n * NPIX);
    for (let i = 0; i < o.length; i++) { let v = dv.getUint16(2 * i); if (v >= maxpve) v -= 65536; o[i] = v; }
    return o;
  }

  /* i1pro_average_multimeas. Pixels 0 and 127 are excluded from statistics (they are edge duplicates). */
  function averageMulti(abs, n, satthresh, darkthresh) {
    const avg = new Float64Array(NPIX), perFrame = new Float64Array(n);
    let highest = -1e6, oall = 0, overth = 0, mx = -1e38, mn = 1e38;
    for (let i = 0; i < n; i++) {
      let s = 0, k = 0;
      for (let j = 0; j < NPIX; j++) {
        const v = abs[i * NPIX + j]; avg[j] += v;
        if (j === 0 || j === 127) continue;
        if (v > highest) highest = v;
        if (v > satthresh) overth++;
        s += v; k++;
      }
      s /= k; perFrame[i] = s; oall += s;
      if (s < mn) mn = s; if (s > mx) mx = s;
    }
    for (let j = 0; j < NPIX; j++) avg[j] /= n;
    oall /= n; overth /= n;
    let rv = 0;
    if (satthresh > 0 && overth > 0) rv |= 2;
    let norm = Math.abs(0.5 * (mx + mn)); if (norm < 2 * darkthresh) norm = 2 * darkthresh;
    const variation = (mx - mn) / norm;
    if (variation > 0.1) rv |= 1;
    return { avg, highest, oall, rv, variation, perFrame };
  }

  /* i1pro_prepare_idark / i1pro_interp_dark: dark(t)*t = base + slope*t, from readings at two integration times */
  function makeDarkModel(a0, t0, a1, t1) {
    const base = new Float64Array(NPIX), slope = new Float64Array(NPIX);
    for (let j = 0; j < NPIX; j++) {
      const d01 = a0[j] * t0, d1 = a1[j] * t1;
      slope[j] = (d1 - d01) / (t1 - t0);
      base[j] = d01 - slope[j] * t0;
    }
    return { t0, t1, base, slope };
  }
  const darkAt = (m, t) => { const o = new Float64Array(NPIX); for (let j = 0; j < NPIX; j++) o[j] = (m.base[j] + t * m.slope[j]) / t; return o; };

  function bands36(cal, avgAbs) {
    const o = new Float64Array(NBAND);
    for (let b = 0; b < NBAND; b++) {
      let s = 0; const c = cal.coef[b], ix = cal.index[b];
      for (let k = 0; k < c.length; k++) s += c[k] * avgAbs[ix + k];
      o[b] = s * cal.emis[b];
    }
    return o;
  }

  /* i1pro_optimise_sensor with the emission-spot settings (high gain off, permitclip). */
  function optimiseTime(cal, minInt, curT, optscale, targoscale, targmaxIn) {
    const targmax = targmaxIn || 2.0, targoscale2 = 0.15;
    let t = curT * optscale;
    if (t > targmax) { if (targmax / t > targoscale2) t = targmax; else t *= targoscale2; }
    if (t > cal.maxInt) t = cal.maxInt;
    if (t < minInt && targoscale < 1.0) { t /= targoscale; if (t > minInt) t = minInt; }
    if (t < minInt) t = minInt;
    return t;
  }

  /* ------------------------------------------------------------------ resampler (custom grid + kernel) */
  function sincK(d, W) { const x = Math.PI * d / W; return Math.abs(x) < 1e-9 ? 1 : Math.sin(x) / x; }
  function hannK(d, Ww) { return Math.abs(d) < Ww ? 0.5 + 0.5 * Math.cos(Math.PI * d / Ww) : 0; }
  function bandModel(x, p) {
    const d = x - p[1], left = d < 0;
    return p[0] * sincK(d, left ? p[2] : p[3]) * hannK(d, left ? p[4] : p[5]);
  }
  const FIT_LO = [0.05, -15, 1, 1, 2, 2], FIT_HI = [1.5, 15, 18, 18, 25, 25];   // x0 bounds relative to peak

  function solve(A, b, n) {
    const M = A.map((r, i) => [...r, b[i]]);
    for (let i = 0; i < n; i++) {
      let p = i; for (let r = i + 1; r < n; r++) if (Math.abs(M[r][i]) > Math.abs(M[p][i])) p = r;
      [M[i], M[p]] = [M[p], M[i]];
      if (Math.abs(M[i][i]) < 1e-14) return null;
      for (let r = i + 1; r < n; r++) { const f = M[r][i] / M[i][i]; for (let c = i; c <= n; c++) M[r][c] -= f * M[i][c]; }
    }
    const x = new Array(n).fill(0);
    for (let i = n - 1; i >= 0; i--) { let s = M[i][n]; for (let c = i + 1; c < n; c++) s -= M[i][c] * x[c]; x[i] = s / M[i][i]; }
    return x;
  }
  /* Levenberg–Marquardt fit of the asymmetric Hann-windowed sinc to one factory band. */
  function fitBand(xs, ys) {
    let imax = 0; for (let i = 1; i < ys.length; i++) if (ys[i] > ys[imax]) imax = i;
    const owl = xs[imax];
    const lo = FIT_LO.map((v, i) => i === 1 ? owl + v : v), hi = FIT_HI.map((v, i) => i === 1 ? owl + v : v);
    const cost = p => { let s = 0; for (let i = 0; i < xs.length; i++) { const r = bandModel(xs[i], p) - ys[i]; s += r * r; } return s; };
    let best = null;
    for (const w0 of [[5, 5, 8, 8], [10, 10, 14, 14]]) {
      let p = [ys[imax], owl, ...w0].map((v, i) => Math.min(hi[i], Math.max(lo[i], v)));
      let c = cost(p), lam = 1e-3;
      for (let it = 0; it < 200; it++) {
        const J = []; const r = xs.map((x, i) => bandModel(x, p) - ys[i]);
        for (let q = 0; q < 6; q++) {
          const h = 1e-5 * Math.max(1, Math.abs(p[q])), pp = p.slice(); pp[q] += h;
          J.push(xs.map((x, i) => (bandModel(x, pp) - bandModel(x, p)) / h));
        }
        const A = [], g = [];
        for (let a = 0; a < 6; a++) {
          A.push([]); g.push(0);
          for (let b = 0; b < 6; b++) { let s = 0; for (let i = 0; i < xs.length; i++) s += J[a][i] * J[b][i]; A[a].push(s); }
          for (let i = 0; i < xs.length; i++) g[a] -= J[a][i] * r[i];
        }
        let improved = false;
        for (let tries = 0; tries < 12; tries++) {
          const Ad = A.map((row, i) => row.map((v, j) => i === j ? v * (1 + lam) + 1e-12 : v));
          const d = solve(Ad, g, 6); if (!d) { lam *= 10; continue; }
          const pn = p.map((v, i) => Math.min(hi[i], Math.max(lo[i], v + d[i])));
          const cn = cost(pn);
          if (cn < c) { const rel = (c - cn) / (c + 1e-30); p = pn; c = cn; lam = Math.max(lam / 5, 1e-9); improved = true; if (rel < 1e-10) it = 1e9; break; }
          lam *= 5;
        }
        if (!improved) break;
      }
      if (!best || c < best.c) best = { p, c };
    }
    const mean = ys.reduce((a, b) => a + b, 0) / ys.length;
    let sst = 0; for (const y of ys) sst += (y - mean) ** 2;
    const [A, x0, WL, WR, WwL, WwR] = best.p;
    return { A, x0, x0off: x0 - owl, WL, WR, WwL, WwR, r2: sst > 0 ? 1 - best.c / sst : 0 };
  }
  function fitAllBands(cal) {
    return WL36.map((wl, b) => {
      const xs = [], ys = [];
      for (let k = 0; k < cal.coef[b].length; k++) {
        if (Math.abs(cal.coef[b][k]) > 1e-7) { xs.push(cal.pxnm[cal.index[b] + k]); ys.push(cal.coef[b][k]); }
      }
      const f = fitBand(xs, ys); f.wl = wl;
      f.sum = cal.coef[b].reduce((a, c) => a + c, 0);
      f.dx = f.x0 - wl;                       // kernel centre relative to the nominal band wavelength
      return f;
    });
  }

  function lagrange4(xk, yk, x) {
    const n = xk.length; let best = 0, bd = 1e9;
    for (let i = 0; i < n; i++) { const d = Math.abs(xk[i] - x); if (d < bd) { bd = d; best = i; } }
    const lo = Math.max(0, Math.min(n - 4, best - 1)); let r = 0;
    for (let i = lo; i < lo + 4; i++) {
      let num = yk[i], den = 1;
      for (let j = lo; j < lo + 4; j++) { if (i === j) continue; num *= (x - xk[j]); den *= (xk[i] - xk[j]); }
      r += num / den;
    }
    return r;
  }
  function interp1(xk, yk, x, method) {
    if (x <= xk[0]) return yk[0];
    if (x >= xk[xk.length - 1]) return yk[yk.length - 1];
    if (method === 'linear') {
      let i = 0; while (x > xk[i + 1]) i++;
      const t = (x - xk[i]) / (xk[i + 1] - xk[i]); return yk[i] * (1 - t) + yk[i + 1] * t;
    }
    return lagrange4(xk, yk, x);
  }
  function fwhmOf(fn) {                       // numerical FWHM of a symmetric-ish kernel centred at 0
    const peak = fn(0); let l = 0, r = 0;
    for (let d = 0; d < 60; d += 0.05) { if (fn(d) < peak / 2) { r = d; break; } }
    for (let d = 0; d < 60; d += 0.05) { if (fn(-d) < peak / 2) { l = d; break; } }
    return l + r;
  }

  /* ArgyllCMS's own re-sampling filter (i1pro_compute_wav_filters in i1pro_imp.c, used for its high-resolution mode and, in the
     OEM driver, for the standard bands): the 128 pixel values are joined by a cubic Lagrange interpolation (4 neighbouring
     pixels, only the middle span of each used), and the output at wavelength `owl` is that curve integrated against a triangle
     centred on owl whose half-width is the output spacing. Returns the 128 pixel weights (they sum to 1). The pixel
     wavelengths are cal.pxnm; ArgyllCMS derives them the same way, from where neighbouring factory filters cross over (checked:
     the two derivations agree to 0.02 nm on the tested unit). */
  const GL5 = [[-0.9061798459386640, 0.2369268850561891], [-0.5384693101056831, 0.4786286704993665], [0, 0.5688888888888889], [0.5384693101056831, 0.4786286704993665], [0.9061798459386640, 0.2369268850561891]];
  function argyllFilter(pxnm, owl, tw) {
    const w = new Float64Array(NPIX);
    for (let lip = 0; lip + 3 < NPIX; lip++) {
      const r = [0, 1, 2, 3].map(i => pxnm[lip + i] - owl);
      const a = Math.min(r[1], r[2]), b = Math.max(r[1], r[2]);
      if (b < -tw || a > tw) continue;
      const den = r.map((ri, i) => r.reduce((d, rj, j) => (j === i ? d : d * (ri - rj)), 1));
      for (const [lo0, hi0] of [[-tw, 0], [0, tw]]) {
        const lo = Math.max(a, lo0), hi = Math.min(b, hi0); if (!(hi > lo)) continue;
        for (const [gx, gw] of GL5) {
          const x = 0.5 * (hi - lo) * gx + 0.5 * (hi + lo), tri = (1 - Math.abs(x) / tw) / tw, f = gw * 0.5 * (hi - lo) * tri;
          for (let i = 0; i < 4; i++) { let n = 1; for (let j = 0; j < 4; j++) if (j !== i) n *= (x - r[j]); w[lip + i] += f * n / den[i]; }
        }
      }
    }
    return w;
  }

  /* Build the combined weight matrix W[o][px] so spectrum(o) = sum_px W[o][px] * avgAbs[px]  (emission cal included).
   * opts: lo, hi, step (nm); kernel: 'factory'|'sinc'|'triangle'|'gaussian'; widthScale (factory) ; fwhm (nm, others;
   * 0 = same as factory at that wavelength); winMult (sinc window half-width / W); interp: 'lagrange'|'linear';
   * preserveGain (default true). */
  function buildResampler(cal, fits, opts) {
    const o = Object.assign({ lo: 380, hi: 730, step: 1, kernel: 'factory', widthScale: 1, fwhm: 0, winMult: 1.4, interp: 'lagrange', preserveGain: true, emis: true, corr: null }, opts);
    const xk = fits.map(f => f.wl), M = interp1.bind(null, xk);
    const col = k => fits.map(f => k === 'x0' ? f.dx : f[k]);
    const cols = { A: col('A'), x0: col('x0'), WL: col('WL'), WR: col('WR'), WwL: col('WwL'), WwR: col('WwR'), sum: col('sum') };
    const emis = Array.from(cal.emis), corrArr = o.corr ? Array.from(o.corr) : null;
    const wl = [], W = [], extrap = [];
    const n = Math.floor((o.hi - o.lo) / o.step + 1e-9) + 1;
    for (let i = 0; i < n; i++) {
      const lam = +(o.lo + i * o.step).toFixed(6), lc = Math.min(730, Math.max(380, lam));
      const P = {}; for (const k in cols) P[k] = M(cols[k], lc, o.interp);
      const x0 = lam + P.x0;                       // kernel centre in nm
      const w = new Float64Array(NPIX);
      let kfn;
      if (o.kernel === 'argyll') {
        const w = argyllFilter(cal.pxnm, lam, o.argyllWidth || o.fwhm || o.step);
        const e = (o.emis === false ? 1 : M(emis, lc, o.interp)) * (corrArr ? M(corrArr, lc, o.interp) : 1);
        for (let p = 0; p < NPIX; p++) w[p] *= e;
        wl.push(lam); W.push(w); extrap.push(lam < 380 || lam > 730); continue;
      }
      if (o.kernel === 'factory') {
        const s = o.widthScale;
        kfn = d => P.A * sincK(d, (d < 0 ? P.WL : P.WR) * s) * hannK(d, (d < 0 ? P.WwL : P.WwR) * s);
      } else {
        let fw = o.fwhm;
        if (!(fw > 0)) fw = fwhmOf(d => P.A * sincK(d, (d < 0 ? P.WL : P.WR)) * hannK(d, (d < 0 ? P.WwL : P.WwR)));
        fw = Math.max(fw, 4);
        if (o.kernel === 'sinc') { const Wd = fw / 1.2067; kfn = d => sincK(d, Wd) * hannK(d, Wd * o.winMult); }
        else if (o.kernel === 'triangle') kfn = d => Math.max(0, 1 - Math.abs(d) / fw);
        else kfn = d => { const s = fw / 2.3548; return Math.exp(-d * d / (2 * s * s)); };
      }
      let sum = 0;
      for (let p = 0; p < NPIX; p++) { const v = kfn(cal.pxnm[p] - x0); w[p] = v; sum += v; }
      if (o.preserveGain || o.kernel !== 'factory') {
        if (Math.abs(sum) > 1e-9) { const g = P.sum / sum; for (let p = 0; p < NPIX; p++) w[p] *= g; }
      }
      const e = (o.emis === false ? 1 : M(emis, lc, o.interp)) * (corrArr ? M(corrArr, lc, o.interp) : 1);
      for (let p = 0; p < NPIX; p++) w[p] *= e;
      wl.push(lam); W.push(w); extrap.push(lam < 380 || lam > 730);
    }
    return { wl, W, extrap, opts: o, apply(avg) { return W.map(w => { let s = 0; for (let p = 0; p < NPIX; p++) s += w[p] * avg[p]; return s; }); } };
  }


  /* ------------------------------------------------------------------ EEPROM text import */
  /* Accepts an ArgyllCMS -D9 log (the "0000: 00 00 24 fd ..." hex dump after readEEProm), or plain hex text. */
  function parseEEPROMText(text) {
    const lines = text.split(/\r?\n/), re = /^\s*([0-9a-fA-F]{4}):\s+((?:[0-9a-fA-F]{2}\s?){1,16})\s*$/;
    let blocks = [], cur = null;
    for (const l of lines) {
      const m = re.exec(l);
      if (!m) { if (cur && l.trim() && !/^\s*[0-9a-fA-F]{4}:/.test(l)) { blocks.push(cur); cur = null; } continue; }
      const a = parseInt(m[1], 16), b = m[2].trim().split(/\s+/).map(x => parseInt(x, 16));
      if (cur && a === cur.next) { cur.bytes.push(...b); cur.next += b.length; }
      else { if (cur) blocks.push(cur); cur = { start: a, bytes: [...b], next: a + b.length }; }
    }
    if (cur) blocks.push(cur);
    const big = blocks.find(b => b.start === 0 && b.bytes.length >= 0x1c00) || blocks.sort((a, b) => b.bytes.length - a.bytes.length)[0];
    if (big && big.bytes.length >= 0x1c00) {
      const out = new Uint8Array(0x2000).fill(0xff); out.set(big.bytes.slice(0, 0x2000), big.start); return out;
    }
    const hex = text.replace(/0x/gi, '').replace(/[^0-9a-fA-F]/g, '');
    if (hex.length >= 2 * 0x1c00) { const out = new Uint8Array(0x2000).fill(0xff); for (let i = 0; i < Math.min(0x2000, hex.length >> 1); i++) out[i] = parseInt(hex.substr(2 * i, 2), 16); return out; }
    throw new I1Error('EEPROM', 'No EEPROM hex dump found (expected an ArgyllCMS -D9 log, or at least 7 KB of hex bytes).');
  }
  function eepromToHexDump(u8) {
    const L = []; for (let a = 0; a < u8.length; a += 16) L.push('    ' + a.toString(16).padStart(4, '0') + ': ' + Array.from(u8.subarray(a, a + 16), b => b.toString(16).padStart(2, '0')).join(' '));
    return L.join('\n') + '\n';
  }

  /* ------------------------------------------------------------------ source calibration against a known spectrum */
  function planck(T, nm) { const l = nm * 1e-9; return 1 / (Math.pow(l, 5) * (Math.exp(1.4388e-2 / (l * T)) - 1)); }
  /* Reference spectrum at the 36 bands. kind: 'blackbody' | 'tungsten' (blackbody x approximate filament emissivity) */
  function referenceBands(kind, T) {
    return WL36.map(nm => planck(T, nm) * (kind === 'tungsten' ? Math.max(0.2, 0.47 - 0.000133 * (nm - 400)) : 1));
  }
  /* Per-band correction c[b] so that measured*c matches the reference shape. Scale-free: normalised so the mean over 500-600 nm is 1
     (absolute level stays with the factory calibration). Bands with too little signal hold the nearest good value. */
  function computeCorrection(meas36, ref36, o) {
    o = Object.assign({ minRel: 0.03, smooth: true }, o);
    let mx = 0; for (const v of meas36) mx = Math.max(mx, v);
    const c = new Float64Array(NBAND), ok = new Array(NBAND).fill(false);
    for (let b = 0; b < NBAND; b++) if (meas36[b] > o.minRel * mx && ref36[b] > 0) { c[b] = ref36[b] / meas36[b]; ok[b] = true; }
    const good = ok.map((v, i) => v ? i : -1).filter(i => i >= 0);
    if (good.length < 8) throw new I1Error('CALSIGNAL', 'Not enough signal across the spectrum to calibrate (only ' + good.length + ' usable bands). Use a brighter or broader-band source.');
    for (let b = 0; b < NBAND; b++) if (!ok[b]) { let best = good[0], bd = 99; for (const g of good) if (Math.abs(g - b) < bd) { bd = Math.abs(g - b); best = g; } c[b] = c[best]; }
    if (o.smooth) { const t = Float64Array.from(c); for (let b = 1; b < NBAND - 1; b++) c[b] = 0.25 * t[b - 1] + 0.5 * t[b] + 0.25 * t[b + 1]; }
    let s = 0, n = 0; for (let b = 0; b < NBAND; b++) if (WL36[b] >= 500 && WL36[b] <= 600) { s += c[b]; n++; }
    for (let b = 0; b < NBAND; b++) c[b] /= s / n;
    return { c, usable: ok, lo: WL36[good[0]], hi: WL36[good[good.length - 1]] };
  }
  /* Integral of a sampled spectrum between lo and hi nm (trapezoids): mW/m2 for a mW/m2/nm spectrum. */
  function bandIntegral(wl, v, lo, hi) {
    let s = 0;
    for (let i = 1; i < wl.length; i++) {
      const a = Math.max(wl[i - 1], lo), b = Math.min(wl[i], hi); if (!(b > a)) continue;
      const f = x => v[i - 1] + (v[i] - v[i - 1]) * (x - wl[i - 1]) / (wl[i] - wl[i - 1]);
      s += 0.5 * (f(a) + f(b)) * (b - a);
    }
    return s;
  }
  /* Absolute-level factor k so that the measurement matches a known value: target / measured. */
  function absoluteFactor(measured, target) {
    if (!(measured > 0) || !(target > 0)) throw new I1Error('CALSIGNAL', 'Absolute calibration needs a positive measured value and a positive target.');
    return target / measured;
  }

  /* Several measurements of one thermal source (for example a lamp) at different, not exactly known, temperatures.
     Model: ln v_i(b) = f(b) + g_i + ln Planck(wl_b, T_i), with f(b) free per band (instrument response and emissivity, the
     same for every temperature) and g_i a free level per measurement. Fitting f and g away leaves only the temperatures,
     but only their DIFFERENCES in 1/T are fixed by the data: a tilt in f proportional to 1/wavelength looks exactly like a
     common shift of 1/T. The absolute scale therefore needs one more piece of information:
       opts.anchorIndex + opts.anchorT : the true temperature of one measurement (a pyrometer, or the filament resistance
                                         of a tungsten lamp), or
       nothing: f is taken to have no 1/wavelength tilt, i.e. the factory calibration and a grey emitter are trusted.
     items: [{ v: 36 band values (any scale), T0: optional starting guess }]. Returns { T[], resid (rms of ln, after fitting),
     f[] (ln response per band, mean 0 over 500-600 nm), corr[36] (multiplier that turns each spectrum into its blackbody
     shape, mean 1 over 500-600 nm), usable[], gauge: 'anchor'|'grey', relativeOnly: false }. */
  function fitBlackbodyTemperatures(items, opts) {
    const o = Object.assign({ lo: 430, hi: 710, minRel: 0.03 }, opts), N = items.length;
    if (N < 2) throw new I1Error('CALSIGNAL', 'At least two measurements at different temperatures are needed.');
    const C2 = 1.4388e7, lnB = (nm, T) => -5 * Math.log(nm) - Math.log(Math.expm1(C2 / (nm * T)));
    const use = []; for (let b = 0; b < NBAND; b++) {
      if (WL36[b] < o.lo || WL36[b] > o.hi) continue;
      if (items.every(it => it.v[b] > o.minRel * Math.max(...it.v) && it.v[b] > 0)) use.push(b);
    }
    if (use.length < 8) throw new I1Error('CALSIGNAL', 'Not enough signal across ' + o.lo + '-' + o.hi + ' nm in all measurements (' + use.length + ' usable bands).');
    const lv = items.map(it => use.map(b => Math.log(it.v[b]))), nb = use.length, wl = use.map(b => WL36[b]);
    // given temperatures: residual after removing per-band f and per-measurement g (alternating least squares)
    function resid(Ts) {
      const lb = Ts.map(T => wl.map(w => lnB(w, T))), d = lv.map((row, i) => row.map((x, k) => x - lb[i][k]));
      const g = new Array(N).fill(0), f = new Array(nb).fill(0);
      for (let it = 0; it < 30; it++) {
        for (let k = 0; k < nb; k++) { let a = 0; for (let i = 0; i < N; i++) a += d[i][k] - g[i]; f[k] = a / N; }
        for (let i = 0; i < N; i++) { let a = 0; for (let k = 0; k < nb; k++) a += d[i][k] - f[k]; g[i] = a / nb; }
        const m = g.reduce((a, b) => a + b, 0) / N; for (let i = 0; i < N; i++) g[i] -= m;   // gauge: mean g = 0
      }
      let rss = 0; for (let i = 0; i < N; i++) for (let k = 0; k < nb; k++) rss += (d[i][k] - f[k] - g[i]) ** 2;
      return { rss, f, g };
    }
    // starting values: grey-body fit of each spectrum (slope of ln v - ln B against 1/wl is not needed: scan T)
    const greyT = row => { let best = 1e99, bt = 3000; for (let T = 1500; T <= 12000; T += 25) {
      const d = row.map((x, k) => x - lnB(wl[k], T)), m = d.reduce((a, b) => a + b, 0) / nb, r = d.reduce((a, x) => a + (x - m) ** 2, 0); if (r < best) { best = r; bt = T; } } return bt; };
    const T0 = items.map((it, i) => it.T0 > 0 ? it.T0 : greyT(lv[i]));
    // relative fit: u_i = 1/T_i, with the first one held at its start value
    const u0 = T0.map(T => 1 / T), mkT = x => [1 / u0[0]].concat(x.map(u => 1 / u));
    const nm = nelderMead(x => resid(mkT(x)).rss, u0.slice(1), u0.slice(1).map(u => u * 0.05), 600);
    let u = [u0[0]].concat(nm.x);
    // choose the common shift of all 1/T
    const gaugeUse = o.anchorT > 0 && o.anchorIndex >= 0 && o.anchorIndex < N ? 'anchor' : 'grey';
    let delta;
    if (gaugeUse === 'anchor') delta = 1 / o.anchorT - u[o.anchorIndex];
    else {
      const cost = d => { const r = resid(u.map(x => 1 / (x + d))), m = r.f.reduce((a, b) => a + b, 0) / nb; return r.f.reduce((a, x) => a + (x - m) ** 2, 0); };
      let a = -0.5 * u[0], b = 0.5 * u[0]; const gr = (Math.sqrt(5) - 1) / 2;
      for (let it = 0; it < 60; it++) { const c = b - gr * (b - a), d = a + gr * (b - a); if (cost(c) < cost(d)) b = d; else a = c; }
      delta = 0.5 * (a + b);
    }
    u = u.map(x => x + delta); const T = u.map(x => 1 / x), r = resid(T);
    // correction: 1 / exp(f), normalised over 500-600 nm, held to the nearest usable band elsewhere
    const corr = new Float64Array(NBAND), usable = new Array(NBAND).fill(false); use.forEach((b, k) => { corr[b] = Math.exp(-r.f[k]); usable[b] = true; });
    for (let b = 0; b < NBAND; b++) if (!usable[b]) { let best = use[0], bd = 99; for (const g of use) if (Math.abs(g - b) < bd) { bd = Math.abs(g - b); best = g; } corr[b] = corr[best]; }
    let sm = 0, sn = 0; for (let b = 0; b < NBAND; b++) if (WL36[b] >= 500 && WL36[b] <= 600) { sm += corr[b]; sn++; } for (let b = 0; b < NBAND; b++) corr[b] /= sm / sn;
    return { T, resid: Math.sqrt(r.rss / (N * nb)), f: r.f, corr, usable, lo: wl[0], hi: wl[nb - 1], gauge: gaugeUse, nBands: nb };
  }
  function nelderMead(fn, x0, steps, maxIter) {
    const n = x0.length, P = [x0.slice()]; for (let i = 0; i < n; i++) { const p = x0.slice(); p[i] += steps[i]; P.push(p); }
    let F = P.map(fn);
    for (let it = 0; it < maxIter; it++) {
      const idx = F.map((_, i) => i).sort((a, b) => F[a] - F[b]); P.splice(0, P.length, ...idx.map(i => P[i])); F = idx.map(i => F[i]);
      if (Math.abs(F[n] - F[0]) < 1e-14 * (1 + Math.abs(F[0]))) break;
      const c = x0.map((_, j) => P.slice(0, n).reduce((a, p) => a + p[j], 0) / n), at = k => c.map((v, j) => v + k * (P[n][j] - v));
      const xr = at(-1), fr = fn(xr);
      if (fr < F[0]) { const xe = at(-2), fe = fn(xe); if (fe < fr) { P[n] = xe; F[n] = fe; } else { P[n] = xr; F[n] = fr; } }
      else if (fr < F[n - 1]) { P[n] = xr; F[n] = fr; }
      else { const xc = at(fr < F[n] ? -0.5 : 0.5), fc = fn(xc); if (fc < Math.min(fr, F[n])) { P[n] = xc; F[n] = fc; } else for (let i = 1; i <= n; i++) { P[i] = P[i].map((v, j) => P[0][j] + 0.5 * (v - P[0][j])); F[i] = fn(P[i]); } }
    }
    let bi = 0; for (let i = 1; i <= n; i++) if (F[i] < F[bi]) bi = i; return { x: P[bi], f: F[bi] };
  }
  /* Mean (and standard deviation) of several measurements */
  function averageResults(list) {
    const n = list.length, first = list[0], avgAbs = new Float64Array(NPIX), s36 = new Float64Array(NBAND), sd36 = new Float64Array(NBAND), s36raw = new Float64Array(NBAND);
    for (const r of list) { for (let j = 0; j < NPIX; j++) avgAbs[j] += r.avgAbs[j] / n; for (let b = 0; b < NBAND; b++) { s36[b] += r.s36[b] / n; s36raw[b] += (r.s36raw || r.s36)[b] / n; } }
    if (n > 1) for (const r of list) for (let b = 0; b < NBAND; b++) sd36[b] += (r.s36[b] - s36[b]) ** 2 / (n - 1);
    for (let b = 0; b < NBAND; b++) sd36[b] = Math.sqrt(sd36[b]);
    const mean = k => list.reduce((a, r) => a + r[k], 0) / n;
    return Object.assign({}, first, { avgAbs, s36, s36raw, sd36, nSamples: n, nFrames: list.reduce((a, r) => a + r.nFrames, 0), inttime: mean('inttime'),
      peakCounts: Math.max(...list.map(r => r.peakCounts)), headroom: Math.max(...list.map(r => r.headroom)), inconsistent: list.some(r => r.inconsistent),
      elapsedMs: list.reduce((a, r) => a + r.elapsedMs, 0), samples: list });
  }

  /* Reflectance on any grid: ratio of the sample and the white tile through the same kernel, times the tile's reflectance. */
  function reflectanceFromAbs(cal, fits, sampleAbs, whiteAbs, opts) {
    const rs = buildResampler(cal, fits, Object.assign({}, opts, { emis: false, corr: null }));
    const num = rs.apply(sampleAbs), den = rs.apply(whiteAbs), ref = Array.from(cal.white).slice(0, NBAND);
    const v = num.map((x, i) => { const lc = Math.min(730, Math.max(380, rs.wl[i])), r = interp1(WL36, ref, lc, rs.opts.interp), d = den[i]; return r * x / (d < 1000 ? 1000 : d); });
    return { wl: rs.wl, v, extrap: rs.extrap };
  }

  /* Output resolutions. 'std10' and 'hires3' reproduce the two grids ArgyllCMS offers for the i1 Pro (spotread without / with -H):
     36 bands of 10 nm over 380-730 nm, and 3.33 nm spacing over 370-730 nm (HIGHRES_SHORT/LONG/WIDTH in i1pro_imp.c). The hires3
     kernel is ArgyllCMS's own algorithm (argyllFilter) with its emission calibration upsampled from the 36 factory values by
     interpolation (ArgyllCMS uses a smoothing spline there, so the two differ slightly, mostly beyond 380-730 nm). */
  const RES_PRESETS = [
    { id: 'std10', label: 'Standard: 10 nm bands, 380-730 nm (ArgyllCMS default)', opts: { lo: 380, hi: 730, step: 10, kernel: 'factory' } },
    { id: 'hires3', label: 'High resolution: 3.33 nm, 370-730 nm (ArgyllCMS -H grid)', opts: { lo: 370, hi: 730, step: 10 / 3, kernel: 'argyll' } },
    { id: 'fine1', label: 'Fine: 1 nm, 380-730 nm (interpolated)', opts: { lo: 380, hi: 730, step: 1, kernel: 'factory' } },
    { id: 'custom', label: 'Custom grid and kernel...', opts: null }
  ];
  /* The spectra ArgyllCMS itself would report for these pixel values, whatever grid or kernel the user chose for display.
     Stored with every measurement so the original numbers are never lost. */
  function argyllValues(cal, fits, avgAbs, refl) {
    const hr = RES_PRESETS[1].opts;
    if (!refl) {
      const std = bands36(cal, avgAbs), r = buildResampler(cal, fits, Object.assign({}, hr, { corr: null })).apply(avgAbs);
      return { std36: Array.from(std), hires: { lo: hr.lo, hi: hr.hi, step: hr.step, v: Array.from(r) } };
    }
    return null;
  }

  /* ------------------------------------------------------------------ export helpers */
  function toCSV(wl, v, meta) {
    const L = []; for (const k in (meta || {})) L.push('# ' + k + ',' + String(meta[k]).replace(/[\r\n]+/g, ' '));
    L.push('wavelength,intensity'); for (let i = 0; i < wl.length; i++) L.push(wl[i] + ',' + v[i].toPrecision(7));
    return L.join('\n') + '\n';
  }
  function toSP(wl, v, desc) {
    const step = wl.length > 1 ? +(wl[1] - wl[0]).toFixed(4) : 10;
    const L = ['SPECT', '', 'DESCRIPTOR "' + (desc || 'i1Pro spectrum') + '"', 'ORIGINATOR "i1pro-webusb"', 'CREATED "' + new Date().toString() + '"', '',
      'SPECTRAL_BANDS ' + wl.length, 'SPECTRAL_START_NM ' + wl[0].toFixed(2), 'SPECTRAL_END_NM ' + wl[wl.length - 1].toFixed(2), 'SPECTRAL_NORM 1.000000', '',
      'NUMBER_OF_FIELDS 2', 'BEGIN_DATA_FORMAT', 'SAMPLE_ID SPECTRAL_NM', 'END_DATA_FORMAT', '', 'NUMBER_OF_SETS ' + wl.length, 'BEGIN_DATA'];
    for (let i = 0; i < wl.length; i++) L.push((i + 1) + ' ' + v[i].toFixed(6));
    L.push('END_DATA'); void step; return L.join('\n');
  }

  /* ------------------------------------------------------------------ transports */
  class WebUSBTransport {
    constructor(device) { this.dev = device; this.epIn = 2; this.epSw = 4; this._watch = false; }
    static supported() { return typeof navigator !== 'undefined' && !!navigator.usb; }
    static async request() {
      if (!WebUSBTransport.supported()) throw new I1Error('NOWEBUSB', 'This browser has no WebUSB (use Chrome, Edge or another Chromium browser).');
      const paired = await navigator.usb.getDevices();
      const dev = paired.find(d => d.vendorId === VID && d.productId === PID) ||
        await navigator.usb.requestDevice({ filters: [{ vendorId: VID, productId: PID }] });
      return new WebUSBTransport(dev);
    }
    async open() {
      const d = this.dev;
      if (!d.opened) await d.open();
      if (d.configuration === null) await d.selectConfiguration(1);
      await d.claimInterface(0);
      this.info = { product: d.productName, serial: d.serialNumber, usbVersion: d.usbVersionMajor + '.' + d.usbVersionMinor };
    }
    async controlOut(req, bytes) {
      const r = await this.dev.controlTransferOut({ requestType: 'vendor', recipient: 'device', request: req, value: 0, index: 0 },
        bytes ? new Uint8Array(bytes) : undefined);
      if (r.status !== 'ok') throw new I1Error('USB', 'control OUT 0x' + req.toString(16) + ' ' + r.status);
    }
    async controlIn(req, len) {
      const r = await this.dev.controlTransferIn({ requestType: 'vendor', recipient: 'device', request: req, value: 0, index: 0 }, len);
      if (r.status !== 'ok') throw new I1Error('USB', 'control IN 0x' + req.toString(16) + ' ' + r.status);
      return new Uint8Array(r.data.buffer, r.data.byteOffset, r.data.byteLength);
    }
    /* Reads exactly `len` bytes from the data endpoint; rejects after timeoutMs (the pending transfer cannot be
       cancelled in WebUSB, so a timeout means the session should be re-initialised). */
    readBulk(len, timeoutMs) {
      const run = async () => {
        const out = new Uint8Array(len); let got = 0;
        while (got < len) {
          const r = await this.dev.transferIn(this.epIn, len - got);
          if (r.status === 'stall') { await this.dev.clearHalt('in', this.epIn); throw new I1Error('USB', 'bulk read stalled'); }
          const b = new Uint8Array(r.data.buffer, r.data.byteOffset, r.data.byteLength);
          out.set(b, got); got += b.length;
          if (!b.length) throw new I1Error('USB', 'bulk read returned no data');
        }
        return out;
      };
      const p = run();
      p.catch(() => { });
      if (!timeoutMs) return p;
      return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new I1Error('TIMEOUT', 'Instrument did not answer (timeout)')), timeoutMs))]);
    }
    watchButton(cb) {
      this._watch = true;
      (async () => {
        while (this._watch) {
          if (this._btnPause) { await sleep(50); continue; }       // no interrupt reads while a measurement is running
          try { const r = await this.dev.transferIn(this.epSw, 1); if (r.status === 'ok' && r.data.byteLength) cb(); }
          catch (e) { if (!this._watch) return; await sleep(500); }
        }
      })();
    }
    pauseButton(p) { this._btnPause = !!p; }
    /* Reset the USB side after a stuck transfer: clear halts, reset the port, re-open and re-claim. */
    async recover() {
      const d = this.dev;
      try { await d.clearHalt('in', this.epIn); } catch (e) { }
      try { await d.reset(); } catch (e) { }
      try { if (!d.opened) await d.open(); if (d.configuration === null) await d.selectConfiguration(1); } catch (e) { }
      try { await d.claimInterface(0); } catch (e) { }
    }
    async close() { this._watch = false; try { await this.dev.releaseInterface(0); } catch (e) { } try { await this.dev.close(); } catch (e) { } }
  }

  /* ------------------------------------------------------------------ the instrument */
  class I1ProDevice {
    constructor(transport, opts) {
      this.t = transport; this.log = (opts && opts.log) || (() => { });
      this._c = { req: 0, intclkp: 68e-6, subclkdiv: 130, subtmode: 0 };
      this.dark = null; this._lastT = 0; this.cal = null; this.fits = null;
      this.minTimeoutMs = opts && opts.minTimeoutMs; this.events = []; this.recoveries = 0; this._lastUsb = Date.now(); this.autoRecover = !(opts && opts.autoRecover === false);
      this.lampOffMs = opts && opts.lampOffMs != null ? opts.lampOffMs : 1500; this._lampOffAt = 0; this.userCorr = null; this.absCal = null; this.refl = null; this.eeprom = null; this.clocks = {};
    }
    async init() {
      const t = this.t, log = this.log;
      await t.open();
      await this._reset(0x1f);
      const m = await this._getmisc(); this.fwrev = m.fwrev; this.maxpve = m.maxpve; this.powmode = m.powmode;
      log('firmware ' + m.fwrev + ', maxpve ' + m.maxpve + ', power mode ' + m.powmode);
      const ee = new Uint8Array(0x2000);
      await t.controlOut(0xC4, [0, 0, 0, 0, 0x20, 0x00, 0, 0]);
      ee.set(await t.readBulk(0x2000, 5000));
      this.eeprom = ee;
      this.cal = decodeEEPROM(ee);
      this.minInt = this.fwrev >= 301 ? 0.004716 : 0.00884;            // Argyll overrides the EEPROM value
      this.fits = fitAllBands(this.cal);
      await this._highPower();
      await t.controlIn(0xC2, 8);                                        // getmeasparams (Argyll does this; harmless)
      this.info = this.describe();
      log('serial ' + this.cal.serial + ', min/max integration ' + (this.minInt * 1e3).toFixed(2) + ' ms / ' + this.cal.maxInt.toFixed(3) + ' s');
      return this.info;
    }
    async _reset(mask) { await this.t.controlOut(0xCA, [mask]); await sleep(100); this._c.req = 0; }
    async _getmisc() {
      const b = await this.t.controlIn(0xC9, 8); await sleep(10);
      return { fwrev: (b[0] << 8) | b[1], maxpve: (b[4] << 8) | b[5], powmode: b[7] };
    }
    async _highPower() {
      let m = await this._getmisc();
      if (m.powmode !== 8) { await this._reset(0x1f); return; }
      await this._reset(1);
      for (let i = 0; i < 15; i++) { m = await this._getmisc(); if (m.powmode !== 8) { await this._reset(0x1f); return; } await sleep(100); }
      throw new I1Error('POWER', 'Instrument would not enter high-power mode (plug it directly into a USB port, not an unpowered hub).');
    }
    async _configureClock(inttime) {
      const c = this._c;
      if (this.fwrev >= 301) {
        for (let mc = 1; ; mc++) {
          await this.t.controlOut(0xCF, [mc]); await sleep(10);
          const b = await this.t.controlIn(0xD1, 6);
          const r = { max: b[0], mc: b[1], subclkdiv: b[3], usec: b[4], subt: b[5] };
          c.subclkdiv = r.subclkdiv; this.clocks[r.mc] = { usec: r.usec, subclkdiv: r.subclkdiv, max: r.max };
          if (inttime / (r.usec * 1e-6) > 65535.5) throw new I1Error('INTTOOBIG', 'integration time too long');
          if (inttime >= r.usec * r.subclkdiv * 1e-6 * 0.99) { c.intclkp = r.usec * 1e-6; c.subtmode = (r.subt & 1) ? 1 : 0; break; }
          if (mc >= r.max) throw new I1Error('INTTOOSMALL', 'integration time too short');
        }
      } else { c.intclkp = 68e-6; c.subclkdiv = 130; c.subtmode = 0; }
    }
    /* one acquisition: setmeasparams, queue the read, trigger, collect.
       Emission = lamp off, normal gain (flags 0x06). Reflective = lamp on (flags 0x04) with lampTime seconds of lamp warm-up. */
    /* ---- reliability: event log, power check, recovery after a timeout ---- */
    _ev(type, msg, extra) {
      const e = Object.assign({ t: Date.now(), type, msg }, extra || {}); this.events.push(e); if (this.events.length > 300) this.events.shift();
      try { this.log('[' + type + '] ' + msg); } catch (er) { }
    }
    /* Text a user can paste into a bug report. */
    diagnostics() {
      const c = this.cal || {}, t0 = this.events.length ? this.events[0].t : Date.now();
      const head = ['i1pro-webusb diagnostics', 'serial ' + c.serial + '  firmware ' + this.fwrev + '  maxpve ' + this.maxpve + '  power mode ' + this.powmode,
        'usb ' + JSON.stringify(this.t && this.t.info || {}), 'clock modes ' + JSON.stringify(this.clocks), 'recoveries ' + this.recoveries,
        'user agent ' + (typeof navigator !== 'undefined' ? navigator.userAgent : 'node'), ''];
      return head.concat(this.events.map(e => '+' + ((e.t - t0) / 1000).toFixed(3).padStart(8) + ' s  ' + e.type.padEnd(8) + ' ' + e.msg)).join('\n');
    }
    /* Low-power mode (after idling, a hub, USB autosuspend) makes the instrument stop answering; check cheaply when it has been idle. */
    async _ensureAwake() {
      if (Date.now() - this._lastUsb < 4000) return;
      const m = await this._getmisc(); this.powmode = m.powmode;
      if (m.powmode === 8) { this._ev('power', 'instrument had dropped to low power mode, re-establishing high power'); await this._highPower(); this._c.req = 0; }
    }
    /* After a timeout the instrument can be locked up (ArgyllCMS notes the same). Reset the USB side and the instrument, re-enter high power mode. */
    async recover(why) {
      this._ev('recover', 'starting recovery' + (why ? ' (' + why + ')' : '')); this.recoveries++;
      try { if (this.t.recover) await this.t.recover(); } catch (e) { this._ev('recover', 'USB-level reset failed: ' + (e && e.message)); }
      try { await sleep(200); await this._reset(0x1f); await sleep(200); await this._highPower(); this._c.req = 0; this._lastUsb = Date.now(); this._ev('recover', 'instrument re-initialised'); }
      catch (e) { this._ev('recover', 'failed: ' + (e && e.message)); throw new I1Error('RECOVER', 'The instrument did not recover. Unplug it, plug it back in (directly into a USB port) and connect again. (' + (e && e.message) + ')'); }
    }
    async _acquireRaw(nummeas, inttime, lampOpt) {
      try { return await this._acquireRaw1(nummeas, inttime, lampOpt); }
      catch (e) {
        if (!this.autoRecover || !(e && (e.code === 'TIMEOUT' || e.code === 'USB'))) throw e;
        this._ev('error', e.message + ' (' + nummeas + ' frames x ' + (inttime * 1000).toFixed(1) + ' ms) - retrying once after recovery');
        await this.recover(e.code);
        try { return await this._acquireRaw1(nummeas, inttime, lampOpt); }
        catch (e2) { e2.message += ' (second attempt after a reset also failed; see the diagnostic log)'; e2.diag = this.diagnostics(); throw e2; }
      }
    }
    async _acquireRaw1(nummeas, inttime, lampOpt) {
      const lamp = !!(lampOpt && lampOpt.lamp), lampTime = lamp ? (lampOpt.lampTime || 0.25) : 0;
      await this._ensureAwake();
      if (inttime < this.minInt) inttime = this.minInt;
      if (inttime !== this._c.req) { await this._configureClock(inttime); this._c.req = inttime; }
      const ic = Math.floor(inttime / this._c.intclkp + 0.5);
      if (ic > 65535) throw new I1Error('INTTOOBIG', 'integration time too long');
      const tq = ic * this._c.intclkp;
      nummeas = Math.min(nummeas, 65535);
      const lampclocks = lamp ? Math.min(256, Math.floor(lampTime / (this._c.subclkdiv * this._c.intclkp) + 0.5)) : 0;
      if (!lamp) { const dt = Date.now() - this._lampOffAt; if (dt < this.lampOffMs) await sleep(this.lampOffMs - dt); }     // lamp must be dark (Argyll LAMP_OFF_TIME)
      await this.t.controlOut(0xC1, [ic >> 8, ic & 255, lampclocks >> 8, lampclocks & 255, nummeas >> 8, nummeas & 255, lamp ? 0x04 : 0x06, 0]);
      const expect = tq * nummeas + lampTime, tmo = ((this.minTimeoutMs || 3000) / 1000 + expect * 1.5) * 1000;                 // Argyll uses 2 s + expected time; more margin here
      this._ev('measure', nummeas + ' frames x ' + (tq * 1000).toFixed(2) + ' ms' + (lamp ? ', lamp ' + (lampTime * 1000).toFixed(0) + ' ms' : '') + ', expect ' + (expect * 1000).toFixed(0) + ' ms, timeout ' + tmo.toFixed(0) + ' ms');
      const t0 = Date.now();
      if (this.t.pauseButton) this.t.pauseButton(true);
      let buf;
      try {
        const rd = this.t.readBulk(nummeas * 256, tmo);
        await sleep(10);
        await this.t.controlOut(0xC0);
        buf = await rd;
      } catch (e) { this._ev('error', (e && e.message) + ' after ' + (Date.now() - t0) + ' ms (asked for ' + nummeas * 256 + ' bytes)'); throw e; }
      finally { if (this.t.pauseButton) this.t.pauseButton(false); }
      this._lastUsb = Date.now(); this._ev('measure', 'got ' + buf.length + ' bytes in ' + (Date.now() - t0) + ' ms');
      if (lamp) this._lampOffAt = Date.now();
      return { buf, tq, nummeas };
    }
    _stats(buf, n, tq, subtractDark) {
      const abs = rawToAbs(buf, n, tq, this.cal, this.maxpve, this._c.subtmode);
      if (subtractDark) { const d = darkAt(this.dark, tq); for (let i = 0; i < n; i++) for (let j = 0; j < NPIX; j++) abs[i * NPIX + j] -= d[j]; }
      const sat = this.cal.sat0 / tq, dth = (this.cal.sensDark + tq * 900) / tq;
      return { abs, ...averageMulti(abs, n, sat, dth), satthresh: sat, darkthresh: dth };
    }

    /* Dark calibration (instrument covered). Two points like Argyll: min integration time (~1 s of readings) and 4 s. */
    async calibrateDark(o) {
      o = Object.assign({ longTime: 4.0, readTime: 1.0, progress: () => { } }, o);
      const pts = [];
      const plan = [[this.minInt, compNummeas(o.readTime, this.minInt)], [o.longTime, compNummeas(o.readTime, o.longTime)]];
      for (let i = 0; i < 2; i++) {
        o.progress('dark ' + (i + 1) + '/2', i / 2);
        const r = await this._acquireRaw(plan[i][1], plan[i][0]);
        const s = this._stats(r.buf, r.nummeas, r.tq, false);
        if (s.rv & 2) throw new I1Error('DARKSAT', 'Dark reading saturated — cover the sensor.');
        if (s.rv & 1) throw new I1Error('DARKINCONS', 'Dark readings are inconsistent — hold the instrument still, covered.');
        if (s.oall > 2 * s.darkthresh) throw new I1Error('DARKLIGHT', 'Too much light during dark calibration — cover the sensor (put it on the white tile / a dark surface).');
        pts.push({ abs: s.avg, t: r.tq });
      }
      this.dark = makeDarkModel(pts[0].abs, pts[0].t, pts[1].abs, pts[1].t);
      this.darkDate = Date.now(); this._lastT = 0;
      o.progress('dark done', 1);
      return { when: this.darkDate };
    }
    setDark(model, date) { this.dark = model; this.darkDate = date || Date.now(); }

    async _trial(n, t, targ) {
      const r = await this._acquireRaw(n, t);
      const s = this._stats(r.buf, r.nummeas, r.tq, true);
      const optscale = (this.cal.sensTarget * targ / r.tq) / Math.max(s.highest, 1);
      return { saturated: !!(s.rv & 2), optscale, tq: r.tq, peakCounts: s.highest * r.tq };
    }
    async _adapt(targ, targmax) {
      let t = 0.25, tr = await this._trial(1, t, targ);
      if (tr.saturated) { t = this.minInt; tr = await this._trial(compNummeas(0.25, t), t, targ); }
      else t = tr.tq;
      return optimiseTime(this.cal, this.minInt, tr.tq, tr.optscale, targ, targmax);
    }
    _clampT(t) { return Math.min(this.cal.maxInt, Math.max(this.minInt, t)); }
    /* Integration time the instrument would really use (clock mode quantisation), for display. */
    quantize(t) {
      t = this._clampT(t);
      const modes = Object.keys(this.clocks).length ? Object.values(this.clocks) : [{ usec: 68, subclkdiv: 136 }, { usec: 36, subclkdiv: 131 }];
      const sorted = modes.slice().sort((x, y) => y.usec - x.usec);
      let use = sorted[sorted.length - 1];
      for (const m of sorted) if (t >= m.usec * m.subclkdiv * 1e-6 * 0.99) { use = m; break; }
      return Math.round(t / (use.usec * 1e-6)) * use.usec * 1e-6;
    }

    /* Emission spot measurement, Argyll-equivalent adaptive sequence.
     * opts: readTime (s of averaged frames, Argyll uses 1.0)
     *       targoscale  auto exposure aims for peak = sensTarget*targoscale counts (Argyll: 0.9 -> 40 500 with a 45 000 target)
     *       maxAutoTime longest exposure auto will choose before it trades signal for speed (Argyll: 2.0 s)
     *       manualTime  seconds; when set, exposure is fixed and no trial is made
     *       reuse       keep the previous exposure when it still fits (auto only) */
    async measure(opts) {
      const o = Object.assign({ readTime: 1.0, reuse: true, targoscale: 0.9, maxAutoTime: 2.0, manualTime: 0, progress: () => { } }, opts);
      if (!this.dark) throw new I1Error('NODARK', 'Calibrate the dark reference first.');
      const t0 = performance.now ? performance.now() : Date.now(), manual = o.manualTime > 0;
      let t, reused = false, trials = 0;
      if (manual) t = this._clampT(o.manualTime);
      else if (o.reuse && this._lastT && this._lastTarg === o.targoscale) { t = this._lastT; reused = true; }
      else { o.progress('finding exposure', 0.1); t = await this._adapt(o.targoscale, o.maxAutoTime); trials = 1; }
      o.progress('measuring', 0.4);
      let r = await this._acquireRaw(compNummeas(o.readTime, t), t), s = this._stats(r.buf, r.nummeas, r.tq, true);
      const peak = () => s.highest * r.tq;
      if (reused && ((s.rv & 2) || peak() < 0.12 * this.cal.sensTarget)) {
        o.progress('re-adapting', 0.5); t = await this._adapt(o.targoscale, o.maxAutoTime); trials++; reused = false;
        r = await this._acquireRaw(compNummeas(o.readTime, t), t); s = this._stats(r.buf, r.nummeas, r.tq, true);
      }
      if (s.rv & 2) throw new I1Error('SATURATED', manual
        ? 'Sensor saturated at ' + (r.tq * 1000).toFixed(1) + ' ms — shorten the manual exposure.'
        : 'Sensor saturated — light too bright for the minimum integration time (use an ND filter or move away).');
      if (!manual) { this._lastT = r.tq; this._lastTarg = o.targoscale; }
      const s36raw = bands36(this.cal, s.avg), ce = this.effectiveCorrection(), s36 = ce ? s36raw.map((v, i) => v * ce[i]) : s36raw;
      const now = performance.now ? performance.now() : Date.now();
      return {
        kind: 'emission', wl36: WL36.slice(), s36, s36raw, corrApplied: !!(this.userCorr && this.userCorr.enabled),
        absApplied: !!(this.absCal && this.absCal.enabled), absK: this.absCal && this.absCal.enabled ? this.absCal.k : null,
        avgAbs: s.avg, rawFrames: rawInts(r.buf, r.nummeas, this.maxpve), nFrames: r.nummeas,
        inttime: r.tq, exposureMode: manual ? 'manual' : 'auto', targetCounts: this.cal.sensTarget * o.targoscale,
        peakCounts: peak(), headroom: peak() / this.cal.sat0, frameMeans: s.perFrame, variation: s.variation,
        inconsistent: !!(s.rv & 1), reusedExposure: reused, trials, elapsedMs: now - t0,
        darkAgeSec: (Date.now() - this.darkDate) / 1000, serial: this.cal.serial, when: Date.now()
      };
    }

    /* Several measurements, averaged. opts: count (0 = until stop()), intervalSec (start-to-start), onSample(result, i, list), shouldStop(), plus measure() options. */
    async measureSeries(opts) {
      const o = Object.assign({ count: 5, intervalSec: 0, onSample: () => { }, shouldStop: () => false }, opts), list = [];
      for (let i = 0; !o.count || i < o.count; i++) {
        if (o.shouldStop()) break;
        const t0 = Date.now();
        const r = await this.measure(o); list.push(r); o.onSample(r, i, list);
        if (o.count && i === o.count - 1) break;
        const wait = o.intervalSec * 1000 - (Date.now() - t0);
        for (let w = wait; w > 0 && !o.shouldStop(); w -= 100) await sleep(Math.min(100, w));
      }
      if (!list.length) throw new I1Error('ABORT', 'No samples taken.');
      return averageResults(list);
    }

    /* ---- reflective (pigment) mode: Argyll i1p_refl_spot. Needs the white tile (calibration) and the sample. */
    async _reflDark(t, n) {
      const r = await this._acquireRaw(n, t, { lamp: false });
      const s = this._stats(r.buf, r.nummeas, r.tq, false);
      if (s.rv & 2) throw new I1Error('DARKSAT', 'Ambient light saturates the sensor during the lamp-off reading — shade the instrument.');
      if (s.rv & 1) throw new I1Error('DARKINCONS', 'Lamp-off readings are inconsistent — keep the instrument still and shaded.');
      if (s.oall > 2 * s.darkthresh) throw new I1Error('DARKLIGHT', 'Too much ambient light during the lamp-off reading — press the instrument flat against the surface.');
      return { avg: s.avg, tq: r.tq };
    }
    async _reflLamp(t, n, darkAvg, lampTime) {
      const r = await this._acquireRaw(n, t, { lamp: true, lampTime });
      const abs = rawToAbs(r.buf, r.nummeas, r.tq, this.cal, this.maxpve, this._c.subtmode);
      for (let i = 0; i < r.nummeas; i++) for (let j = 0; j < NPIX; j++) abs[i * NPIX + j] -= darkAvg[j];
      const sat = this.cal.sat0 / r.tq, dth = (this.cal.sensDark + r.tq * 900) / r.tq;
      return Object.assign({ tq: r.tq, n: r.nummeas, buf: r.buf }, averageMulti(abs, r.nummeas, sat, dth));
    }
    whiteRef36() { return Array.from(this.cal.white).slice(0, NBAND); }
    async calibrateWhite(opts) {
      const o = Object.assign({ targoscale: 1.0, tInit: 0.02366, dcal: 0.05, wcal: 0.05, wadapt: 0.10, lampTime: 0.25, progress: () => { } }, opts);
      let t = this._clampT(o.tInit), best = null, nm = compNummeas(o.wcal, t);
      for (let it = 0; it < 5; it++) {
        o.progress('lamp-off reading ' + (it + 1), 0.1 + it * 0.15);
        const d = await this._reflDark(t, compNummeas(it ? o.wadapt : o.dcal, t)); const tq = d.tq;
        o.progress('white tile with lamp', 0.25 + it * 0.15);
        const w = await this._reflLamp(tq, compNummeas(it ? o.wadapt : o.wcal, tq), d.avg, o.lampTime);
        if (w.rv & 2) { if (tq <= this.minInt * 1.001) throw new I1Error('SATURATED', 'White tile saturates the sensor even at the shortest exposure.'); t = this.minInt; continue; }
        const scale = (this.cal.sensTarget * o.targoscale / tq) / Math.max(w.highest, 1);
        best = { dark: d.avg, white: w, tq, scale };
        if (scale >= 0.95 && scale <= 1.05) break;
        const nt = optimiseTime(this.cal, this.minInt, tq, scale, o.targoscale, 2.0);
        if (Math.abs(nt - tq) < 1e-4) break;
        t = nt;
      }
      if (!best) throw new I1Error('CALFAIL', 'White calibration did not settle.');
      const white36 = bands36({ coef: this.cal.coef, index: this.cal.index, emis: new Float64Array(NBAND).fill(1) }, best.white.avg);
      const ref = this.whiteRef36(), cf = Array.from(white36, (w, i) => w < 1000 ? ref[i] / 1000 : ref[i] / w);
      this.refl = { t: best.tq, whiteAbs: Float64Array.from(best.white.avg), white36, ref36: ref, calFactor36: cf, peakCounts: best.white.highest * best.tq, date: Date.now(), inconsistent: !!(best.white.rv & 1) };
      o.progress('white calibration done', 1);
      return { inttime: best.tq, peakCounts: this.refl.peakCounts, scale: best.scale, date: this.refl.date };
    }
    async measureReflective(opts) {
      const o = Object.assign({ readTime: 0.05, lampTime: 0.25, progress: () => { } }, opts);
      if (!this.refl) throw new I1Error('NOWHITE', 'Calibrate on the white tile first.');
      const t0 = Date.now(), t = this.refl.t, n = compNummeas(o.readTime, t);
      o.progress('lamp-off reading', 0.2);
      const d = await this._reflDark(t, n);
      o.progress('measuring with lamp', 0.5);
      const w = await this._reflLamp(d.tq, n, d.avg, o.lampTime);
      if (w.rv & 2) throw new I1Error('SATURATED', 'Sample is brighter than the white tile calibration allows; recalibrate on the tile.');
      const sample36 = bands36({ coef: this.cal.coef, index: this.cal.index, emis: new Float64Array(NBAND).fill(1) }, w.avg);
      const R36 = sample36.map((v, i) => v * this.refl.calFactor36[i]);
      return { kind: 'reflective', wl36: WL36.slice(), s36: R36, avgAbs: w.avg, whiteAbs: this.refl.whiteAbs, nFrames: w.n, inttime: d.tq, peakCounts: w.highest * d.tq,
        headroom: w.highest * d.tq / this.cal.sat0, inconsistent: !!(w.rv & 1), variation: w.variation, elapsedMs: Date.now() - t0,
        rawFrames: rawInts(w.buf, w.n, this.maxpve), serial: this.cal.serial, whiteAgeSec: (Date.now() - this.refl.date) / 1000, when: Date.now(), reusedExposure: false, trials: 0, exposureMode: 'fixed (white cal)' };
    }
    /* Reflectance on any grid: ratio of sample to white through the same kernel, times the tile's reflectance. */
    reflectance(res, opts) { return reflectanceFromAbs(this.cal, this.fits, res.avgAbs, res.whiteAbs, opts); }

    /* ---- EEPROM / calibration data ---- */
    loadEEPROM(u8) {
      const cal = decodeEEPROM(u8);
      this.cal = cal; this.eeprom = u8; this.fits = fitAllBands(cal);
      this.dark = null; this.refl = null; this._lastT = 0; this.info = this.describe();
      return this.info;
    }
    describe() {
      const c = this.cal;
      return { serial: c.serial, firmware: this.fwrev, minInt: this.minInt, maxInt: c.maxInt, sensTarget: c.sensTarget, sat0: c.sat0, sensDark: c.sensDark,
        highgain: c.highgain, lin0: c.lin0, physFilter: c.physFilter, mfgDate: c.mfgDate, usb: this.t && this.t.info, clocks: this.clocks };
    }
    setCorrection(c, enabled, meta) { this.userCorr = c ? { c: Float64Array.from(c), enabled: enabled !== false, meta: meta || {} } : null; }
    /* Absolute level: one factor k multiplying every emission result (kept apart from the per-band source correction). */
    setAbsCal(k, enabled, meta) { this.absCal = k > 0 ? { k, enabled: enabled !== false, meta: meta || {} } : null; }
    /* Per-band multiplier that is really applied to emission results: source correction x absolute factor, or null. */
    effectiveCorrection() {
      const u = this.userCorr && this.userCorr.enabled ? this.userCorr.c : null, k = this.absCal && this.absCal.enabled ? this.absCal.k : 1;
      if (!u && k === 1) return null;
      return Float64Array.from({ length: NBAND }, (_, b) => (u ? u[b] : 1) * k);
    }
    resampler(opts) { return buildResampler(this.cal, this.fits, Object.assign({ corr: this.effectiveCorrection() }, opts)); }
    onButton(cb) { if (this.t.watchButton) this.t.watchButton(cb); }
    async close() { await this.t.close(); }
  }

  return {
    VID, PID, WL36, px2nm, pixelWavelengths, I1Error, decodeEEPROM, rawToAbs, averageMulti, makeDarkModel, darkAt, bands36, optimiseTime,
    compNummeas, fitBand, fitAllBands, buildResampler, reflectanceFromAbs, RES_PRESETS, argyllValues, argyllFilter, bandIntegral, absoluteFactor, fitBlackbodyTemperatures, toCSV, toSP, WebUSBTransport, I1ProDevice, rawInts,
    parseEEPROMText, eepromToHexDump, planck, referenceBands, computeCorrection, averageResults
  };
});
