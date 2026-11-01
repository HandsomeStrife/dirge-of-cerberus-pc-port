// audio.js -- game sound effects for the web page (worker 0170). notes/audio-research.md.
//
// Game side (EE): game code plays a sound by its sdb.bin name (FUN_0033cc48 / FUN_0033cbd8 ->
// FUN_0033cc90 -> FUN_003e8e18); the name gives an SE id (sdb row +0x10); the sound thread finds the
// id in the zone's SE block (FUN_003e7ed8) and sends that "SeSep" program to the IOP (FUN_0041a190,
// cmd 0x29) with a volume and pan.
// IOP side (data/sound/lib/iopsound.irx): the program's tracks run on the SE sequencer
// (FUN_000082d0 start, FUN_00007224 tick, opcode table irx 0x1acf0) and key SPU2 voices from the
// wave bank (waveNNNN.wd): region select FUN_00001c5c, voice setup FUN_00001d0c, pitch
// FUN_000012b0, volume / pan FUN_00001380.
// Here an SE is rendered offline into a 48 kHz stereo buffer, one 240 Hz driver tick at a time
// (hard timer compare 0x25800 on the 36.864 MHz IOP clock, FUN_00010bdc), then played with WebAudio.
//
// Data: native/web/data/audio/ from tools/audio/extract.py (game data, gitignored).

export const SPU_RATE = 48000;
export const TICK_HZ = 240;                       // FUN_00010bdc: 36864000 / 0x25800
const TICK_SAMPLES = SPU_RATE / TICK_HZ;          // 200

// ---------------------------------------------------------------------------------------------
// SPU2 ADPCM (hardware format). 16-byte blocks: filter << 4 | shift, flags, 28 nibbles.
const POS = [0, 60, 115, 98, 122, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
const NEG = [0, 0, -52, -55, -60, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

// Decode one block at `p` into out[0..27]; hist = [h1, h2] is updated. Returns the flag byte.
export function decodeBlock(data, p, out, hist) {
  let shift = data[p] & 15;
  const f = data[p] >> 4;
  if (shift > 12) shift = 9;                      // SPU2 behaviour for shift 13..15
  let h1 = hist[0], h2 = hist[1];
  for (let i = 0; i < 28; i++) {
    const b = data[p + 2 + (i >> 1)];
    const n = (i & 1) ? b >> 4 : b & 15;
    let s = ((n << 28) >> 16) >> shift;           // (s16)(nibble << 12) >> shift
    s += (h1 * POS[f] + h2 * NEG[f]) >> 6;
    if (s > 32767) s = 32767; else if (s < -32768) s = -32768;
    out[i] = s;
    h2 = h1; h1 = s;
  }
  hist[0] = h1; hist[1] = h2;
  return data[p + 1];
}

// Whole sample from `start` to its end block. Returns { pcm: Int16Array, loop: index | -1 }.
export function decodeSample(data, start, maxBlocks = 1 << 16) {
  const blk = new Int16Array(28), hist = [0, 0], parts = [];
  let loop = -1, n = 0;
  for (let p = start, k = 0; p + 16 <= data.length && k < maxBlocks; p += 16, k++) {
    const flags = decodeBlock(data, p, blk, hist);
    if (flags & 4) loop = n;
    parts.push(Int16Array.from(blk)); n += 28;
    if (flags & 1) { if (!(flags & 2)) loop = -1; break; }
  }
  const pcm = new Int16Array(n);
  parts.forEach((b, i) => pcm.set(b, i * 28));
  return { pcm, loop };
}

// ---------------------------------------------------------------------------------------------
// SPU2 envelope (hardware): ADSR1 = low 16 bits, ADSR2 = high 16 bits of the region's +0xc word.
const ATTACK = 1, DECAY = 2, SUSTAIN = 3, RELEASE = 4, OFF = 0;

function envTick(v) {
  const a1 = v.adsr & 0xffff, a2 = v.adsr >>> 16;
  let rate, exp, dec;
  switch (v.phase) {
    case ATTACK: rate = (a1 >> 8) & 0x7f; exp = a1 >> 15; dec = 0; break;
    case DECAY: rate = ((a1 >> 4) & 15) << 2; exp = 1; dec = 1; break;
    case SUSTAIN: rate = (a2 >> 6) & 0x7f; exp = a2 >> 15; dec = (a2 >> 14) & 1; break;
    case RELEASE: rate = (a2 & 0x1f) << 2; exp = (a2 >> 5) & 1; dec = 1; break;
    default: return;
  }
  const shift = rate >> 2;
  let step = dec ? -8 + (rate & 3) : 7 - (rate & 3);
  let cycles = 1 << Math.max(0, shift - 11);
  step <<= Math.max(0, 11 - shift);
  if (exp && !dec && v.level > 0x6000) cycles <<= 2;
  if (exp && dec) step = (step * v.level) >> 15;
  if (++v.envCount >= cycles) {
    v.envCount = 0;
    v.level += step;
    if (v.level > 0x7fff) v.level = 0x7fff; else if (v.level < 0) v.level = 0;
  }
  if (v.phase === ATTACK && v.level >= 0x7fff) v.phase = DECAY;
  else if (v.phase === DECAY && v.level <= ((a1 & 15) + 1) * 0x800) v.phase = SUSTAIN;
  else if (v.phase === RELEASE && v.level <= 0) v.phase = OFF;
}

// ---------------------------------------------------------------------------------------------
// Driver maths.

// FUN_000012b0(note20, bend, tune, mod): note20 = key << 20 (+ slide), bend in 1/256 semitone,
// tune = region +0x10 (high 16 bits = 1/256 semitone). Returns the SPU pitch (0x1000 = 48 kHz).
export function spuPitch(drv, note20, bend, tune, mod) {
  let u = (note20 >> 12) + bend + (tune >> 16), oct = 0;
  for (; u < 0; u += 0xc00) oct--;
  const n = (u >> 8) & 0x7f;
  // mult; mflo; srl 16: the low 32 bits of the product, shifted logically
  let p = Math.imul(drv.semitone[n % 12] >>> ((10 - (oct + Math.floor(n / 12))) & 31), drv.fine[u & 0xff]) >>> 16;
  if (mod) p = mod < 1 ? (p * (mod & 0xff)) >> 8 : p + ((p * (mod + 1)) >> 7);
  return p;
}

// FUN_00001c5c: pick the region for a key (+0x14 high key) and velocity (+0x15 high velocity).
export function selectRegion(regs, key, vel) {
  let i = 0;
  if (regs[0].flags & 0x30000) {
    while (!(regs[i].flags & 0x200) && s8(regs[i].keyHi) < key && i + 1 < regs.length) {
      if (regs[i].flags & 1) i++;
      i++;
    }
    const kh = s8(regs[i].keyHi);
    while (!(regs[i].flags & 0x200) && regs[i].velHi < vel && s8(regs[i].keyHi) === kh && i + 1 < regs.length) {
      if (regs[i].flags & 1) i++;
      i++;
    }
  }
  return i;
}

const s8 = (b) => (b << 24) >> 24;
const idiv = (a, b) => (b === 0 ? 0 : Math.trunc(a / b));

// FUN_00002d54: slide step towards `target` (in >>12 units) over `ticks`; 0 ticks if already there.
function slide(cur, target, ticks) {
  if (target === cur >> 12) return [0, 0];
  return [idiv(((target << 12) | 0x800) - cur, ticks), ticks];
}

// Opcode operand layout (irx handler table 0x1acf0; checked on every program on the disc by
// tools/audio/sep.py). 'b' byte, 'v' VLQ, 'E' track end.
const LAYOUT = (() => {
  const t = {};
  const set = (s, ops) => ops.forEach((o) => { t[o] = s; });
  set('', [0x01, 0x03, 0x04, 0x06, 0x10, 0x18, 0x29, 0x2a, 0x2b, 0x2e, 0x2f, 0x30, 0x41, 0x49, 0x51,
    0x60, 0x61, 0x64, 0x65, 0x68, 0x7e, 0x7f]);
  set('b', [0x05, 0x07, 0x08, 0x0a, 0x0d, 0x0e, 0x12, 0x13, 0x1a, 0x1b, 0x20, 0x22, 0x24, 0x26, 0x2d,
    0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x3c, 0x3d, 0x3e, 0x3f, 0x42, 0x44, 0x46, 0x4a,
    0x4c, 0x4e, 0x52, 0x54, 0x56, 0x58, 0x59, 0x5a, 0x5b, 0x5d, 0x6c, 0x70, 0x71, 0x72, 0x79]);
  set('bb', [0x09, 0x0b, 0x0c, 0x11, 0x19, 0x1e, 0x21, 0x39, 0x47, 0x4f, 0x5c, 0x62, 0x78]);
  set('bbb', [0x40, 0x48, 0x50, 0x73, 0x74, 0x75]);
  set('v', [0x28]);
  set('vb', [0x23, 0x25, 0x27, 0x2c, 0x43, 0x45, 0x4b, 0x4d, 0x53, 0x55, 0x76, 0x77]);
  set('E', [0x00, 0x0f, 0x14, 0x15, 0x16, 0x17, 0x1c, 0x1d, 0x1f, 0x3a, 0x3b, 0x57, 0x5e, 0x5f, 0x63,
    0x66, 0x67, 0x6a, 0x6b, 0x6d, 0x6e, 0x6f, 0x7a, 0x7b]);
  return t;
})();
// Opcodes this player runs; others are parsed and skipped (listed in `unsupported`).
const HANDLED = new Set([0x00, 0x04, 0x05, 0x06, 0x10, 0x11, 0x12, 0x13, 0x18, 0x19, 0x1a, 0x1b, 0x1e,
  0x20, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x2a, 0x2b, 0x2c, 0x2d, 0x2e, 0x2f, 0x30, 0x31, 0x32, 0x33,
  0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x60, 0x61, 0x78, 0x7e, 0x7f]);
// ADSR field overrides (track bytes +0x120..+0x127): mask / shift into the 32-bit ADSR word,
// as FUN_00001d0c applies them at key-on and opcodes 0x31..0x38 apply them live.
const ADSR_OV = [
  [0xffff80ff, (b) => b << 8], [0xffffff0f, (b) => b << 4], [0xfffffff0, (b) => b],
  [0xe03fffff, (b) => b << 22], [0xffe0ffff, (b) => b << 16], [0xffff7fff, (b) => (b & 4) << 13],
  [0x1fffffff, (b) => (b & 6) << 29], [0xffdfffff, (b) => (b & 4) << 19],
];
const applyOv = (w, i, b) => (((w & ADSR_OV[i][0]) | ADSR_OV[i][1](b)) >>> 0);

function vlq(b, p) {
  let v = b[p] & 0x7f;
  while (b[p] & 0x80) { p++; v = (v << 7) | (b[p] & 0x7f); }
  return [v, p + 1];
}

export function hexBytes(h) {
  const u = new Uint8Array(h.length >> 1);
  for (let i = 0; i < u.length; i++) u[i] = parseInt(h.substr(i * 2, 2), 16);
  return u;
}

// ---------------------------------------------------------------------------------------------
// The SE player. `bank` = { instruments, data: Uint8Array }, `drv` = driver.json.
export class SeRenderer {
  constructor(drv, bank) {
    this.drv = drv; this.bank = bank;
    this.rngIndex = 0;                            // FUN_0000a870: u8 counter into the table
    this.unsupported = new Set();
    this.masterSe = 0x7f;                         // DAT_0001bb70[1]: FUN_003e7150 sends FUN_00419518(2, 1, 0x7f)
  }

  rng() { const r = this.drv.rng[this.rngIndex]; this.rngIndex = (this.rngIndex + 1) & 0xff; return r; }

  // Render SE program `prog` (Uint8Array) with the request's volume / pan (FUN_0041a190 a1 / a2).
  // GUESS: maxSeconds = 8 is a page cap on the offline render (the driver plays an endless SE until keyed off).
  render(prog, vol = 0x7f, pan = 0x40, maxSeconds = 8) {
    const cnt = prog[0] & 0x7f, flags = prog[4];
    if (flags & 8) vol = 0x7f;                    // FUN_000082d0
    const tracks = [];
    let p = 5 + cnt * 2;
    for (let i = 0; i < cnt; i++) {
      const v = prog[5 + 2 * i] | (prog[6 + 2 * i] << 8);
      if (v & 0x4000) { p += v & 0x7fff; continue; }
      const [d0, q] = vlq(prog, p);
      tracks.push({
        pos: q, active: true, remaining: d0 + 1, counter: 1, loopIdx: 0, loopPtr: [0, 0, 0, 0], loopCnt: [0, 0, 0, 0],
        key: 0, vel: 0, inst: null, ov: [-1, -1, -1, -1, -1, -1, -1, -1],
        vol: 0x3fff000, volStep: 0, volTicks: 0, expr: 0x3fff000, exprStep: 0, exprTicks: 0,
        pan: pan << 12, panStep: 0, panTicks: 0, seqVol: vol << 12,
        f148: 0xc00, f154: 0, rnd: [0, 0, 0, 0, 0, 0], pitchStep: 0, pitchTicks: 0, note: 0, voices: [],
      });
      p += v & 0x3fff;
    }
    this.prog = prog; this.tracks = tracks; this.voices = []; this.keyOnQueue = []; this.keyOffQueue = [];
    this.events = [];
    const maxTicks = Math.ceil(maxSeconds * TICK_HZ);
    const L = new Float32Array(maxTicks * TICK_SAMPLES), R = new Float32Array(maxTicks * TICK_SAMPLES);
    let t = 0, liveTracks = tracks.length;
    for (; t < maxTicks; t++) {
      // FUN_00000dfc order: queued key-ons / voice updates first (FUN_00002c24, FUN_000025ac), then the
      // SE tick (FUN_00007224).
      for (const v of this.keyOffQueue) if (v.phase !== OFF) { v.phase = RELEASE; v.envCount = 0; this.events.push({ t, off: v.key }); }
      this.keyOffQueue = [];
      for (const k of this.keyOnQueue) { this.keyOn(k.trk); this.events.push({ t, on: k.trk.key }); }
      this.keyOnQueue = [];
      for (const v of this.voices) this.updateVoice(v);
      for (const trk of tracks) if (trk.active) this.tickTrack(trk);
      const now = tracks.filter((x) => x.active).length;
      if (liveTracks && !now) for (const v of this.voices) this.keyOff(v);   // FUN_000034a0, last track
      liveTracks = now;
      this.mix(L, R, t * TICK_SAMPLES);
      if (!now && !this.keyOffQueue.length && this.voices.every((v) => v.phase === OFF)) { t++; break; }
    }
    return { left: L.subarray(0, t * TICK_SAMPLES), right: R.subarray(0, t * TICK_SAMPLES), rate: SPU_RATE, events: this.events };
  }

  // FUN_00007224, one track, one driver tick.
  tickTrack(trk) {
    let n = 0;
    trk.counter = (trk.counter - ((0x100000 >> 12) * 0x78 >> 8)) & 0xffff;   // *DAT_0001bb54 = 0x100000
    while (((trk.counter << 16) >> 16) < 1) { trk.counter = (trk.counter + 300) & 0xffff; n++; }
    if (n < 1) return;
    const k = Math.min(n, trk.remaining);
    trk.remaining -= n;
    this.slides(trk, k);
    if (!(trk.f154 & 0x200000) && trk.remaining === 1) this.noteOff(trk);
    const b = this.prog;
    while (trk.active && trk.remaining < 1) {
      const op = b[trk.pos++] & 0x7f;
      this.exec(trk, op);
      if (!trk.active) break;
      let [d, q] = vlq(b, trk.pos); trk.pos = q;
      if (d !== 0) {
        if (d < 1) d = 1;
        else if (trk.remaining >= 0 && (trk.f148 & 0x20000)) {
          d += ((d * trk.rnd[3]) >> 8) * s8(this.rng()) >> 7;
          if (d < 1) d = 1;
        }
      }
      if (trk.remaining < -1) this.slides(trk, trk.remaining + d > 0 ? -trk.remaining : d);
      trk.remaining += d;
    }
  }

  // FUN_00006830 (= FUN_000064e0's layout): volume / expression / pan / pitch slides.
  slides(trk, k) {
    if (trk.volTicks) { const s = Math.min(k, trk.volTicks); trk.volTicks -= s; trk.vol += trk.volStep * s; }
    if (trk.exprTicks) { const s = Math.min(k, trk.exprTicks); trk.exprTicks -= s; trk.expr += trk.exprStep * s; }
    if (trk.panTicks) { const s = Math.min(k, trk.panTicks); trk.panTicks -= s; trk.pan = (trk.pan + trk.panStep * s) & 0x1fffff; }
    if (trk.pitchTicks) {
      const s = Math.min(k, trk.pitchTicks); trk.pitchTicks -= s;
      trk.note += s * trk.pitchStep;
      for (const v of trk.voices) v.note += s * trk.pitchStep;
    }
  }

  exec(trk, op) {
    const b = this.prog;
    const lay = LAYOUT[op];
    const args = [];
    if (lay === 'E') { this.endTrack(trk); return; }
    if (lay === undefined) { this.unsupported.add(op); this.endTrack(trk); return; }
    for (const c of lay) {
      if (c === 'b') args.push(b[trk.pos++]);
      else { const [v, q] = vlq(b, trk.pos); trk.pos = q; args.push(v); }
    }
    if (!HANDLED.has(op)) { this.unsupported.add(op); return; }
    const a = args[0], c = args[1];
    switch (op) {
      case 0x04: trk.loopIdx = (trk.loopIdx + 1) & 3; trk.loopPtr[trk.loopIdx] = trk.pos; trk.loopCnt[trk.loopIdx] = 0; break;
      case 0x05: {
        const want = a || 0x100;
        if (++trk.loopCnt[trk.loopIdx] !== want) trk.pos = trk.loopPtr[trk.loopIdx];
        else trk.loopIdx = (trk.loopIdx - 1) & 3;
        break;
      }
      case 0x06: trk.pos = trk.loopPtr[trk.loopIdx]; break;
      case 0x10: this.noteOn(trk); break;
      case 0x11: trk.key = a; trk.vel = c; this.noteOn(trk); break;
      case 0x12: trk.key = a; this.noteOn(trk); break;
      case 0x13: trk.vel = a; this.noteOn(trk); break;
      case 0x18: case 0x1b: this.noteOff(trk); break;
      case 0x19: case 0x1a: trk.key = a; this.noteOff(trk); break;
      case 0x1e: this.program(trk, a | (c << 8)); break;
      case 0x20: this.program(trk, a); break;
      case 0x22: trk.vol = s8(a) * 0x80000 + (s8(a) > 0 ? 0x7f000 : 0); trk.volTicks = 0; break;
      case 0x24: trk.expr = s8(a) * 0x80000 + (s8(a) > 0 ? 0x7f000 : 0); trk.exprTicks = 0; break;
      case 0x23: case 0x25: {
        const tgt = s8(c) * 0x80 + (s8(c) > 0 ? 0x7f : 0), dur = a || 1;
        if (op === 0x23) [trk.volStep, trk.volTicks] = slide(trk.vol, tgt, dur);
        else [trk.exprStep, trk.exprTicks] = slide(trk.expr, tgt, dur);
        break;
      }
      case 0x26: trk.pan = (a << 12) & 0x1ff000; trk.panTicks = 0; break;   // FUN_00008dc4 = b << 12 in stereo
      case 0x27: [trk.panStep, trk.panTicks] = slide(trk.pan, c, a || 1); break;
      case 0x2a: trk.f154 = (trk.f154 & ~0x100000) | 0x80000; break;
      case 0x2b: trk.f154 &= ~0x80000; break;
      case 0x2c: {
        const dur = a || 1, tgt = s8(c) << 8;
        [trk.pitchStep, trk.pitchTicks] = tgt === 0 ? [0, 0] : [idiv((tgt << 12) | 0x800, dur), dur];
        trk.note &= ~0xfff;
        for (const v of trk.voices) v.note &= ~0xfff;
        break;
      }
      case 0x2d: trk.f148 = a ? trk.f148 | 0x200000 : trk.f148 & ~0x200000; break;
      case 0x2e: trk.f154 |= 0x200000; break;
      case 0x2f: trk.f154 &= ~0x200000; break;
      case 0x30: trk.ov.fill(-1); for (const v of trk.voices) v.adsr = v.region.adsr >>> 0; break;
      case 0x31: case 0x32: case 0x33: case 0x34: case 0x35: case 0x36: case 0x37: case 0x38: {
        const i = op - 0x31;
        trk.ov[i] = a;
        for (const v of trk.voices) v.adsr = applyOv(v.adsr, i, a);
        break;
      }
      case 0x39: trk.ov[1] = a; trk.ov[2] = c;
        for (const v of trk.voices) v.adsr = ((v.adsr & 0xffffff00) | (a << 4) | c) >>> 0;
        break;
      case 0x60: trk.f148 |= 0x3c00; break;                      // dry + effect send (effect not emulated)
      case 0x61: trk.f148 = (trk.f148 & ~0x3000) | 0xc00; break;  // dry only
      case 0x78: {                                                // FUN_00006270: randomisation ranges
        const r = c ? c + 1 : 0x101;
        const bit = [0x4000, 0x8000, 0x10000, 0x20000, 0x40000, 0x80000];
        const i = a >= 1 && a <= 5 ? a : 0;
        trk.rnd[i] = r; trk.f148 |= bit[i];
        break;
      }
      default: break;
    }
  }

  program(trk, n) {                               // FUN_00004044 / FUN_00003fb4
    const ins = this.bank.instruments;
    trk.inst = n < ins.length ? ins[n] : null;
    trk.progNo = n & 0xff;                        // trk+0x19e, the base of the random instrument (FUN_0000326c)
    trk.ov.fill(-1);
  }

  noteOn(trk) {                                   // FUN_0000326c then FUN_00002de4 (queued key-on)
    if ((trk.f148 & 0x80000) && (trk.f154 & 0x180000) !== 0x180000) {
      const ins = this.bank.instruments;
      const u = ((trk.rnd[5] * (this.rng() & 0xff)) >> 8) + (trk.progNo || 0);
      trk.inst = ins[u % ins.length];
      trk.ov.fill(-1);
    }
    trk.f148 |= 1;
    this.keyOnQueue.push({ trk });
  }

  noteOff(trk) {                                  // FUN_00002f10
    if (trk.f154 & 0x80000) return;
    trk.pitchTicks = 0;
    for (const v of trk.voices) if (v.key === trk.key) this.keyOff(v);
    trk.f148 &= ~1;
  }

  endTrack(trk) {                                 // FUN_000034a0
    this.noteOff(trk);
    trk.active = false;
  }

  // Key-off sets voice flag 2 (FUN_00002f10 / FUN_000034a0); FUN_000025ac applies it on the next tick.
  keyOff(v) { if (!this.keyOffQueue.includes(v)) this.keyOffQueue.push(v); }

  // FUN_000023bc -> FUN_00001c5c / FUN_00001d0c.
  keyOn(trk) {
    if (!trk.inst || !trk.inst.length) return;
    const ri = selectRegion(trk.inst, s8(trk.key), trk.vel);
    let v = null;
    if (trk.f154 & 0x80000) v = trk.voices.find((x) => x.phase !== OFF && !x.pair) || null;
    v = this.setupVoice(trk, ri, v, 0);
    if ((trk.inst[ri].flags & 1) && trk.inst[ri + 1]) {      // stereo pair: next region on a second voice
      v.vflags |= 0x40;
      const w = this.setupVoice(trk, ri + 1, null, 0x80);
      w.pair = true;
    }
    trk.f154 |= 0x100000;
  }

  setupVoice(trk, ri, v, extraFlags) {
    const r = trk.inst[ri], drv = this.drv;
    if (!v) { v = {}; this.voices.push(v); trk.voices.push(v); }
    v.trk = trk; v.region = r; v.key = trk.key; v.vel = trk.vel;
    v.note = (r.flags & 0x20000) ? s8(r.keyHi) << 20 : s8(trk.key) << 20;
    trk.note = s8(trk.key) << 20;
    let vf = trk.f148 | extraFlags;
    if (r.mode) vf = (vf & ~0x3c00) | (r.mode === 1 ? 0x3000 : 0x3c00);
    v.vflags = vf;
    v.pitchRnd = 0; v.volRnd = 0; v.panRnd = 0;
    const base = spuPitch(drv, v.note, 0, r.tune, 0);
    if (vf & 0x4000) {
      const u = this.rng(), x = base * trk.rnd[0] * ((u & 0xff) + 1);
      v.pitchRnd = (u & 0x80) === 0 ? x >> 15 : -(x >> 16);
    }
    if (vf & 0x8000) v.volRnd = (trk.rnd[1] * s8(this.rng())) >> 8;
    if (vf & 0x10000) v.panRnd = (trk.rnd[2] * s8(this.rng())) >> 8;
    let adsr = r.adsr >>> 0;
    for (let i = 0; i < 8; i++) if (trk.ov[i] >= 0 && !(trk.ov[i] & 0x80)) adsr = applyOv(adsr, i, trk.ov[i]);
    if (vf & 0x40000) {
      let ar = ((adsr >> 8) & 0x7f) + ((trk.rnd[4] * s8(this.rng())) >> 8);
      ar = Math.max(0, Math.min(0x7f, ar));
      adsr = ((adsr & 0xffff80ff) | (ar << 8)) >>> 0;
    }
    v.adsr = adsr;
    // key on: SSA = region +4, LSAX = +4 + +8 (bank base 0 here: data is the uploaded area)
    v.addr = r.start; v.loopAddr = r.start + r.loop;
    v.hist = [0, 0]; v.blk = new Int16Array(28); v.bi = 28; v.flags = 0;
    v.prev = 0; v.cur = 0; v.counter = 0;
    v.phase = ATTACK; v.level = 0; v.envCount = 0;
    this.updateVoice(v);
    return v;
  }

  // FUN_00001380 (volume / pan) and the pitch write of FUN_0000179c, without LFOs.
  updateVoice(v) {
    const trk = v.trk, r = v.region, drv = this.drv;
    v.pitch = (spuPitch(drv, v.note, 0, r.tune, 0) + v.pitchRnd) & 0x3fff;
    const master = (this.masterSe * 0x1ff) >> 7;                     // FUN_000025ac, SE branch
    let x = ((master ? master + 1 : 0) * ((trk.expr >> 12) + 1)) >> 9;
    if (s8(v.vel)) x = (x * (s8(v.vel) + 1)) >> 7;
    let sv = trk.seqVol >> 12; if (sv) sv++;
    let rv = r.vol & 0x7f; if (rv) rv++;
    x = (((((x * sv) >> 7) * (trk.vol >> 12)) >> 14) * rv) >> 7;
    let pan;
    if ((v.vflags & 0xc0) === 0) {
      pan = (r.pan & 0x80) === 0 ? trk.pan >> 12 : ((r.pan & 0x7f) || 0x40);
      if (v.panRnd) pan += (pan * v.panRnd) >> 7;
    } else pan = (v.vflags & 0x40) ? 0 : 0x7f;
    if (v.volRnd) { x += (x * v.volRnd) >> 7; x = Math.max(-0x4000, Math.min(0x3fff, x)); }
    const tab = drv.pan;
    v.volL = ((x * tab[pan & 0xff]) >> 8) & 0x7fff;
    v.volR = ((x * tab[(pan & 0xff) ^ 0x7f]) >> 8) & 0x7fff;
  }

  nextSample(v) {
    if (v.bi >= 28) {
      if (v.flags & 1) {                          // end block finished
        if (v.flags & 2) v.addr = v.loopAddr;
        else { v.phase = OFF; v.level = 0; return 0; }
      }
      const data = this.bank.data;
      if (v.addr + 16 > data.length) { v.phase = OFF; return 0; }
      const fl = data[v.addr + 1];
      if (fl & 4) v.loopAddr = v.addr;
      v.flags = decodeBlock(data, v.addr, v.blk, v.hist);
      v.addr += 16; v.bi = 0;
    }
    return v.blk[v.bi++];
  }

  mix(L, R, at) {
    for (const v of this.voices) {
      if (v.phase === OFF) continue;
      const gl = s15(v.volL) * 2 / 32768, gr = s15(v.volR) * 2 / 32768;
      for (let i = 0; i < TICK_SAMPLES; i++) {
        v.counter += v.pitch;
        while (v.counter >= 0x1000) { v.counter -= 0x1000; v.prev = v.cur; v.cur = this.nextSample(v); }
        if (v.phase === OFF) break;
        // GUESS: linear interpolation (SPU2 uses a 4-point gaussian; not ported). See notes/fidelity-audit.md
        const s = v.prev + ((v.cur - v.prev) * v.counter) / 0x1000;
        const o = (s * v.level) / 32768 / 32768;
        L[at + i] += o * gl; R[at + i] += o * gr;
        envTick(v);
      }
    }
  }
}

const s15 = (x) => ((x << 17) >> 17);

// ---------------------------------------------------------------------------------------------
// Browser front end: load a zone's SE data and bank 0, play by sdb name or SE id.
export class GameAudio {
  constructor(base = 'data/audio/') { this.base = base; this.ctx = null; this.ready = null; }

  load(zone = 128) {
    const z = String(zone).padStart(3, '0');
    const j = (f) => fetch(this.base + f).then((r) => { if (!r.ok) throw new Error(f + ' ' + r.status); return r.json(); });
    this.ready = (async () => {
      const [drv, se] = await Promise.all([j('driver.json'), j(`se_z${z}.json`)]);
      const banks = {};
      for (const b of se.banks) {
        const n = String(b).padStart(4, '0');
        const [info, buf] = await Promise.all([j(`wave${n}.json`),
          fetch(this.base + `wave${n}.bin`).then((r) => r.arrayBuffer())]);
        banks[b] = { instruments: info.instruments, data: new Uint8Array(buf) };
      }
      this.drv = drv; this.se = se; this.banks = banks; this.renderers = {};
      for (const b in banks) this.renderers[b] = new SeRenderer(drv, banks[b]);
      return this;
    })();
    return this.ready;
  }

  // AudioContext needs a user gesture; call from a key / click handler.
  resume() {
    if (!this.ctx) this.ctx = new AudioContext({ sampleRate: SPU_RATE });
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  // vol / pan: what the game's sound thread passes to FUN_0041a190 (vol 0..0x7f, pan 0..0x7f, 0x40 centre).
  playId(id, vol = 0x7f, pan = 0x40) {
    if (!this.se || !this.ctx) return null;
    const hex = this.se.programs[String(id)];
    if (!hex) return null;
    const prog = hexBytes(hex);
    const bank = prog[1] | (prog[2] << 8);
    const rd = this.renderers[bank];
    if (!rd) return null;
    const out = rd.render(prog, vol, pan);
    const buf = this.ctx.createBuffer(2, out.left.length, SPU_RATE);
    buf.copyToChannel(out.left, 0); buf.copyToChannel(out.right, 1);
    const src = this.ctx.createBufferSource();
    src.buffer = buf; src.connect(this.ctx.destination); src.start();
    return src;
  }

  playName(name, vol, pan) {
    const row = this.se && this.se.names[name];
    return row ? this.playId(row.id, vol, pan) : null;
  }
}
