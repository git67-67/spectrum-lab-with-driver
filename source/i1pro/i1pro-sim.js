/* i1pro-sim.js — software stand-in for an i1 Pro Rev D, speaking the same vendor requests as the real USB device.
 * Used for the page's Demo mode and for Node self-tests. EEPROM image is the one recorded from S/N 715997. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./i1pro-core.js'));
  else root.I1ProSim = factory(root.I1Pro);
})(typeof self !== 'undefined' ? self : this, function (I1Pro) {
  'use strict';
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  function b64(s) { if (typeof atob === 'function') { const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; } return new Uint8Array(Buffer.from(s, 'base64')); }

  class SimTransport {
    /* opts: eepromB64, spd(nm)->relative power, level (counts/s at spd=1), speed (0 instant .. 1 real time), noise */
    constructor(opts) {
      this.o = Object.assign({ spd: nm => Math.exp(-0.5 * ((nm - 450) / 10) ** 2) + 0.7 * Math.exp(-0.5 * ((nm - 560) / 45) ** 2) + 0.35 * Math.exp(-0.5 * ((nm - 630) / 30) ** 2),
        level: 3000, speed: 0, noise: 1.5 }, opts);
      const u = b64(this.o.eepromB64), full = new Uint8Array(0x2000).fill(0xff); full.set(u); this.ee = full;
      this.cal = I1Pro.decodeEEPROM(full); this.mc = 1; this.eeReq = null; this.params = null; this.waiter = null; this.info = { product: 'i1 Pro (simulated)', serial: 'SIM' };
      let seed = 12345; this.rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
      this.dkA = Array.from({ length: 128 }, (_, p) => -40 + 60 * Math.sin(p * 0.37) * 0.5 + 10 * (this.rand() - 0.5));
      this.dkB = Array.from({ length: 128 }, (_, p) => 1.0 + 1.5 * (0.5 + 0.5 * Math.sin(p * 0.11)));
      this.hang = 0; this.locked = false; this.covered = false; this.mode = 'emission'; this.target = 'sample'; this.stats = { reads: 0 };
      this.lampSpd = nm => { const T = 2850, f = x => 1 / (Math.pow(x * 1e-9, 5) * (Math.exp(1.4388e-2 / (x * 1e-9 * T)) - 1)); return f(nm) / f(730); };
      this.tile = nm => { const w = Array.from(this.cal.white).slice(0, 36), i = Math.min(34, Math.max(0, Math.floor((nm - 380) / 10))), f = Math.min(1, Math.max(0, (nm - 380 - 10 * i) / 10)); return w[i] * (1 - f) + w[i + 1] * f; };
      this.sample = this.o.sample || (nm => 0.08 + 0.75 / (1 + Math.exp(-(nm - 590) / 12)));      // a red-orange pigment
      this.lampLevel = this.o.lampLevel || 1.4e6;
    }
    async open() { }
    async close() { }
    async controlOut(req, bytes) {
      bytes = bytes ? Array.from(bytes) : [];
      if (req === 0xCA) { this.locked = false; this.stats.resets = (this.stats.resets || 0) + 1; return; }
      if (req === 0xCF) { this.mc = bytes[0]; return; }
      if (req === 0xC4) { this.eeReq = { addr: (bytes[0] << 24 | bytes[1] << 16 | bytes[2] << 8 | bytes[3]) >>> 0, size: (bytes[4] << 8) | bytes[5] }; return; }
      if (req === 0xC1) { this.params = { ic: (bytes[0] << 8) | bytes[1], n: (bytes[4] << 8) | bytes[5], flags: bytes[6] }; return; }
      if (req === 0xC0) { const p = this.params; if (this.hang > 0) { this.hang--; this.locked = true; } if (this.locked) return; if (this.waiter) { const w = this.waiter; this.waiter = null; w(this._frames(p)); } return; }
    }
    async controlIn(req, len) {
      if (req === 0xC9) return Uint8Array.from([0x01, 0xfa, 0x07, 0xd0, 0xfa, 0x00, 0x01, 0x02]);
      if (req === 0xC2) return new Uint8Array(8);
      if (req === 0xD1) return this.mc === 1 ? Uint8Array.from([2, 1, 0x80, 136, 68, 0]) : Uint8Array.from([2, 2, 0x80, 131, 36, 0]);
      throw new Error('sim: unsupported request 0x' + req.toString(16));
    }
    _clk() { return this.mc === 1 ? 68e-6 : 36e-6; }
    _frames(p) {
      const t = p.ic * this._clk(), n = p.n, cal = this.cal, out = new Uint8Array(n * 256), dv = new DataView(out.buffer);
      const nolamp = !!(p.flags & 2), poly = cal.lin0;
      const lin = v => { let l = poly[3]; for (let k = 2; k >= 0; k--) l = l * v + poly[k]; return l; };
      for (let i = 0; i < n; i++) for (let px = 0; px < 128; px++) {
        const nm = cal.pxnm[px];
        const sig = nolamp ? ((this.mode === 'emission' && !this.covered) ? this.o.level * this.o.spd(nm) * (this.o.sens ? this.o.sens(nm) : 1) * t : 0)
          : this.lampLevel * this.lampSpd(nm) * (this.target === 'white' ? this.tile(nm) : this.sample(nm)) * t;
        const L = this.dkA[px] + this.dkB[px] * t + sig + this.o.noise * (this.rand() + this.rand() + this.rand() - 1.5) * 2;
        let v = L; for (let it = 0; it < 30; it++) v += (L - lin(v)) * 0.99;     // invert the linearisation polynomial
        v = Math.max(-2000, Math.min(63999, Math.round(v)));
        dv.setUint16(i * 256 + 2 * px, v < 0 ? v + 65536 : v);
      }
      this.stats.reads++;
      return { data: out, delay: (p.flags & 2 ? 0 : 0) + t * n * 1000 * this.o.speed };
    }
    /* Fault injection for tests: sim.hang = n makes the next n measurements lock the instrument up (no data) until it is reset. */
    readBulk(len, timeoutMs) {
      if (this.eeReq) { const r = this.eeReq; this.eeReq = null; return Promise.resolve(this.ee.slice(r.addr, r.addr + len)); }
      const p = new Promise(res => { this.waiter = async f => { if (f.delay) await sleep(f.delay); res(f.data); }; });
      if (!timeoutMs) return p;
      return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new I1Pro.I1Error('TIMEOUT', 'Instrument did not answer (timeout)')), timeoutMs))]);
    }
    async recover() { this.stats.usbRecovers = (this.stats.usbRecovers || 0) + 1; }
    watchButton() { }
  }
  return { SimTransport };
});
