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
export const TICK_SAMPLES = SPU_RATE / TICK_HZ;          // 200

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
  // holds: the driver ticks of the pauses' SE holds (GameAudio.setPaused), in SE time. The result's `decay` marks the
  // ticks where a hold would change something (a running track's voice in DECAY, see holdVoices): a cheap test for
  // whether a later hold needs a new render.
  render(prog, vol = 0x7f, pan = 0x40, maxSeconds = 8, holds = []) {
    this.start(prog, vol, pan);
    const maxTicks = Math.ceil(maxSeconds * TICK_HZ);
    const L = new Float32Array(maxTicks * TICK_SAMPLES), R = new Float32Array(maxTicks * TICK_SAMPLES);
    const decay = new Uint8Array(maxTicks);
    let t = 0;
    for (; t < maxTicks; t++) {
      if (this.holdVoices(true)) decay[t] = 1;
      if (holds.includes(t)) this.holdVoices();
      if (this.tick(t, L, R, t * TICK_SAMPLES)) { t++; break; }
    }
    return { left: L.subarray(0, t * TICK_SAMPLES), right: R.subarray(0, t * TICK_SAMPLES), rate: SPU_RATE, events: this.events,
      decay: decay.subarray(0, t) };
  }

  // IOP command 6 (irx 0x14008) on a running track's voice (+0x19f): ADSR1 / ADSR2 = 0x7fff / 0x5fff while held. With
  // those, envTick leaves attack (rate 0x7f), sustain (0x7f) and release (0x1f << 2) still, but a decay ends at once
  // (level <= (0xf + 1) * 0x800): after the resume the voice is in sustain and the rest of its decay is gone. The
  // track's timing is frozen (FUN_00007224 skips it), so on the page the hold is this phase change at that tick.
  // L: a stereo pair's second voice is not changed (only +0x19f is written; whether the pair has its own track slot
  // was not checked); voices of tracks that already ended are not touched, as in the IOP.
  // test: only report whether a hold now would change a voice (no change made).
  holdVoices(test = false) {
    let hit = false;
    for (const trk of this.tracks) {
      if (!trk.active) continue;
      const v = trk.voices.filter((x) => !x.pair).at(-1);
      if (v && v.phase === DECAY) { hit = true; if (!test) v.phase = SUSTAIN; }
    }
    return hit;
  }

  // Key the program's tracks on (FUN_000082d0). render() and streaming callers (music.js) then run tick().
  start(prog, vol = 0x7f, pan = 0x40) {
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
        pan: pan << 12, panStep: 0, panTicks: 0, seqVol: vol << 12, seqVolStep: 0, seqVolTicks: 0,
        f148: 0xc00, f154: 0, rnd: [0, 0, 0, 0, 0, 0], pitchStep: 0, pitchTicks: 0, note: 0, voices: [],
      });
      p += v & 0x3fff;
    }
    this.prog = prog; this.tracks = tracks; this.voices = []; this.keyOnQueue = []; this.keyOffQueue = [];
    this.events = [];
    this.liveTracks = tracks.length;
  }

  // IOP command 0x30 (irx table 0x1b8e4 -> FUN_00015d00; EE: request 0x11 FUN_003e7718 -> FUN_003e80d8 -> FUN_003e7e08 ->
  // FUN_0041a380(1, handle, id, 10, pan, vol, pitch)): on every running track of this SE whose program flag byte (+0x1a1)
  // lacks 0x10, slide the pan (FUN_00008f3c: +0x48 / +0x4c / +0x50) and the sequence volume (FUN_0000892c: +0x54 / +0x58 /
  // +0x5c) to the new values over time x 96 / 60 sequence ticks (10 -> 16): step = ((v << 12 | 0x800) - cur) / ticks
  // (MIPS div). The pan target goes through FUN_00008dc4 (= itself in stereo) and, 0x100 or more away, cur += 0x200000.
  // The pitch (FUN_00009320, the Doppler byte) is not translated (worker 0215; see notes/fidelity-audit.md 'Placed sounds').
  update(vol, pan, time = 10) {
    const ticks = Math.trunc((time * 96) / 60);   // mult by 0x88888889: / 60 toward zero
    // MISSING: time 0 (the immediate set, irx 0x8ab4 / 0x9178) is not decoded; FUN_003e7e08 always sends 10
    if (!this.tracks || (this.prog[4] & 0x10) || ticks < 1) return;
    for (const trk of this.tracks) {
      if (!trk.active) continue;
      const tp = (pan << 12) | 0x800;
      if (Math.abs((tp - trk.pan) >> 12) >= 0x100) trk.pan += 0x200000;
      trk.panStep = idiv(tp - trk.pan, ticks); trk.panTicks = ticks;
      trk.seqVolStep = idiv(((vol << 12) | 0x800) - trk.seqVol, ticks); trk.seqVolTicks = ticks;
    }
  }

  // IOP command 0x2f (FUN_00015be8 -> FUN_00008bfc; EE: FUN_003e8ff8 -> FUN_003e9830 -> FUN_003e77f0 = request 0x12 ->
  // FUN_003e80d8 -> FUN_0041a2b8(1, handle, id, 10, or 0xb4 for a slot with 0x20000)): on every running track (not flag
  // 0x10) the sequence volume slides to 0 over time x 96 / 60 sequence ticks (+0x60 = 1: then the track ends).
  // FUN_00013340, called first, is not translated (worker 0215).
  stopFade(time = 10) {
    const ticks = Math.trunc((time * 96) / 60) || 1;      // FUN_00015be8: time 0 -> 1
    if (!this.tracks || (this.prog[4] & 0x10)) return;
    for (const trk of this.tracks) {
      if (!trk.active) continue;
      trk.seqVolStep = idiv(0x800 - trk.seqVol, ticks); trk.seqVolTicks = ticks; trk.fadeStop = true;
    }
  }

  // One 240 Hz driver tick t, mixed into L / R at sample `at` (TICK_SAMPLES samples). True once the SE is over.
  tick(t, L, R, at) {
    const tracks = this.tracks;
    // FUN_00000dfc order: queued key-ons / voice updates first (FUN_00002c24, FUN_000025ac), then the
    // SE tick (FUN_00007224).
    for (const v of this.keyOffQueue) if (v.phase !== OFF) { v.phase = RELEASE; v.envCount = 0; this.events.push({ t, off: v.key }); }
    this.keyOffQueue = [];
    for (const k of this.keyOnQueue) { this.keyOn(k.trk); this.events.push({ t, on: k.trk.key }); }
    this.keyOnQueue = [];
    for (const v of this.voices) this.updateVoice(v);
    for (const trk of tracks) if (trk.active) this.tickTrack(trk);
    const now = tracks.filter((x) => x.active).length;
    if (this.liveTracks && !now) for (const v of this.voices) this.keyOff(v);   // FUN_000034a0, last track
    this.liveTracks = now;
    this.mix(L, R, at);
    return !now && !this.keyOffQueue.length && this.voices.every((v) => v.phase === OFF);
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
    // +0x54 sequence volume / +0x58 step / +0x5c ticks: only IOP command 0x30 starts this slide (update(), worker 0215).
    // At the slide's end with +0x60 == 1 (stopFade, IOP command 0x2f) the track is ended (irx 0x6984: its read pointer
    // goes to an end opcode, +0x158 = 1). L: ended here at once, not at the next sequence event.
    if (trk.seqVolTicks) {
      const s = Math.min(k, trk.seqVolTicks); trk.seqVolTicks -= s; trk.seqVol += trk.seqVolStep * s;
      if (!trk.seqVolTicks && trk.fadeStop) { trk.fadeStop = false; this.endTrack(trk); }
    }
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
// EE 3D sound (worker 0172; notes/audio-research.md "3D volume / pan"). The manager (DAT_0047d728)
// holds 128 emitter slots of 0x70 bytes (FUN_003e8bc8 opens one: +4 SE id, +0x10 range 400.0, +0x50
// position, flag 2 = not sent yet). Once a frame FUN_003e9ed0 runs FUN_003e9220 on every slot; a slot
// with flag 2 gets its volume / pan and is sent as request 2 (FUN_003e7810(_, id, pan, vol)); the
// sound thread passes them to FUN_0041a190(entry, pan, vol & 0x7f) (FUN_003e80d8 case 2).
// Listener (mgr +0x3810 position / +0x3820 forward: the sound camera, FUN_003ee468 -> FUN_003e88f0;
// +0x3850: Vincent's position + (0, -7, 0), FUN_005734a8 -> FUN_005635e0 -> FUN_003e88b0; +0x3890 = 1
// in play, FUN_003e87f8 / FUN_00245d00): the volume is taken from +0x3850 when +0x3890 is set, the pan
// always from +0x3810 / +0x3820.
// PS2 FPU / VU0 arithmetic rounds toward zero (chop, as player.js).
const _c32 = new DataView(new ArrayBuffer(4));
function chop(x) {
  const r = Math.fround(x);
  if (!(Math.abs(r) > Math.abs(x))) return r;
  _c32.setFloat32(0, r); _c32.setInt32(0, _c32.getInt32(0) - 1);
  return _c32.getFloat32(0);
}
// VU0 vrsqrt then vmulq.xyz on (x, 0, z): the unit vector in the xz plane. 1 / sqrt(0) is the VU's
// largest float, and 0 x that is 0, so a zero vector stays zero.
function unitXZ(x, z) {
  const s = chop(chop(chop(x * x) + 0) + chop(z * z));
  if (s === 0) return [0, 0];
  const q = chop(1 / Math.sqrt(s));
  return [chop(x * q), chop(z * q)];
}
export const SLOT_FLAGS = {
  HALF: 0x10,        // volume >> 1
  FIXED: 0x40,       // volume = flags >> 7 & 0x7f (FUN_003e8bc8 arg 5)
  STREAM: 0x4000,    // sdb row +0xc bit 1 (FUN_003e9b80): volume 112..128, sent through FUN_003eb088 (not ported)
  NOPOS: 0x8000,     // |position| == 0 at open (FUN_003e8bc8): pan 0x40
  NO3D: 0x40000,     // volume 0x7f (or FIXED), pan 0x40
};
// FUN_003e9220 for a new slot (flag 2): { vol, pan } as sent to FUN_003e7810. e = { pos, range = 400,
// flags = 0 }; L = { pos (+0x3810), fwd (+0x3820), alt (+0x3850), useAlt (+0x3890) }.
// The pitch byte (Doppler: ((3400 - v_listener) / (3400 - v_emitter) - 1) x 3600, clamped to s8) only
// goes to the update request FUN_003e7718 (code 0x11) for slots that keep playing: not ported.
export function emitterVolPan(e, L) {
  const flags = e.flags | 0, range = Math.fround(e.range ?? 400.0);
  const lo = flags & SLOT_FLAGS.STREAM ? 112.0 : 0.0, hi = flags & SLOT_FLAGS.STREAM ? 128.0 : 117.0;
  let vol, pan = 0x40;
  if (flags & SLOT_FLAGS.NO3D) return { vol: flags & SLOT_FLAGS.FIXED ? (flags >> 7) & 0x7f : 0x7f, pan };
  if (flags & SLOT_FLAGS.FIXED) vol = (flags >> 7) & 0x7f;
  else {
    const A = L.useAlt ? L.alt : L.pos;
    const dx = chop(A[0] - e.pos[0]), dy = chop(A[1] - e.pos[1]), dz = chop(A[2] - e.pos[2]);
    const dist = chop(Math.sqrt(chop(chop(chop(dx * dx) + chop(dy * dy)) + chop(dz * dz))));   // sqrt.s
    vol = 0;
    if (0.0 <= range) {
      vol = Math.trunc(chop(chop(chop(chop(range - dist) / range) * chop(hi - lo)) + lo));          // cvt.w.s
      vol = vol < 1 ? 1 : vol > 0x7f ? 0x7f : vol;
    }
  }
  if (flags & SLOT_FLAGS.HALF) vol >>= 1;
  if (!(flags & SLOT_FLAGS.NOPOS)) {
    const [dx, dz] = unitXZ(chop(L.pos[0] - e.pos[0]), chop(L.pos[2] - e.pos[2]));   // listener - emitter, y = 0
    const [fx, fz] = unitXZ(L.fwd[0], L.fwd[2]);                                     // FUN_003e9ed0: forward, y = 0
    const cy = chop(chop(dz * fx) - chop(fz * dx));                                   // (d x f).y: vopmula / vopmsub
    const dot = chop(chop(chop(dx * fx) + 0) + chop(dz * fz));
    // L: FUN_0045b6a8 (acosf) is taken as Math.acos rounded to f32; its own polynomial / rounding is not translated
    // (an off-by-one pan byte is possible right at a step; w172: 44 / 44 matched)
    let a = Math.fround(Math.acos(Math.max(-1, Math.min(1, dot))));
    if (!(cy < 0.0)) a = -a;
    pan = (Math.trunc(chop(a * Math.fround(40.743664))) - 0x40) & 0xff;              // 128 / pi: 0x40 ahead
  }
  // GUESS: DAT_0047d730, the master scale (vol = vol x it >> 7 when it is >= 0), is not applied: taken as 0x80 or
  // negative (no change), as in the traced play (w172: every volume matched without it); what sets it is not decoded.
  return { vol, pan };
}

// The listener FUN_003e9ed0 uses on game frame k is the game state of two pad polls before (T: w172_sound3: mgr
// +0x3810 / +0x3820 / +0x3850 on frame k = CAM+0x90 eye / CAM+0x80 forward / C+0x30 position + (0, -7, 0) of trace
// record k - 2; FUN_003ee468 -> FUN_003e88f0, FUN_005734a8 -> FUN_005635e0 -> FUN_003e88b0). soundListener keeps the
// start-of-frame states of the last three frames in hist and returns the oldest. eye / fwd: the camera's eye and
// matrix row 2 (CAM+0x60 row 2 = CAM+0x80, the look direction: player.js FollowCamera M[2]); pos {x, y, z}: C+0x30.
export function soundListener(hist, eye, fwd, pos) {
  hist.push({ pos: [eye[0], eye[1], eye[2]], fwd: [fwd[0], fwd[1], fwd[2]], alt: [pos.x, pos.y - 7.0, pos.z], useAlt: true });
  if (hist.length > 3) hist.shift();
  return hist[0];
}

// The page's emitter slots (the EE side of the chain). play() = FUN_0033cc90 -> FUN_003e8e18 ->
// FUN_003e8bc8 (+ FUN_0033ced0's range for FUN_0033ce10 callers); update() = FUN_003e9ed0, run once a
// frame: every slot opened since the last run is sent with FUN_003e9220's volume / pan from the listener
// set by setListener() (so a sound requested on frame f starts on frame f + 1, as in the traces).
// sdb row +0xc (FUN_003e9b80): bit 1 = ATRAC stream (row +8 id, FUN_003eb088: not ported, not played),
// bit 3 -> slot 0x20, bit 5 -> slot 0x200000 (no Doppler; the update path is not ported).
// Not ported: the update requests for slots that keep playing (FUN_003e7718 code 0x11: volume / pan /
// Doppler pitch of a moving emitter, e.g. the bullet's bsj_063 moved by FUN_00557c68 -> FUN_0033cfc8),
// slot release FUN_003e8ff8 / stop FUN_0033cf00 (a rendered SE plays to its end).
export class SoundEmitters {
  constructor(audio) { this.audio = audio; this.pending = []; this.listener = null; this.log = null; }
  play(name, pos, range = 400.0) {
    const row = this.audio.se && this.audio.se.names[name];
    if (!row || (row.flags & 2)) return -1;
    // pos null: FUN_0033cbd8, the sound camera's position (DAT_0047d8c0 block +0x30), which is the listener's
    // +0x3810 when the slot is sent (T: w172 bsj_063, pan 0x81 = a zero vector)
    const slot = { name, id: row.id, pos: pos ? [pos[0], pos[1], pos[2]] : null, range: Math.fround(range), flags: 0 };
    if (pos && Math.sqrt(pos[0] * pos[0] + pos[1] * pos[1] + pos[2] * pos[2]) === 0) slot.flags |= SLOT_FLAGS.NOPOS;
    this.pending.push(slot);
    return slot;
  }
  setListener(L) { this.listener = L; }
  listenerOf(hist, eye, fwd, pos) { return soundListener(hist, eye, fwd, pos); }   // play.js (no import of its own)
  update() {
    const L = this.listener, list = this.pending;
    this.pending = [];
    if (!L) return;
    for (const e of list) {
      if (!e.pos) e.pos = L.pos.slice(0, 3);
      const { vol, pan } = emitterVolPan(e, L);
      if (this.log) this.log.push({ name: e.name, id: e.id, vol, pan });
      this.audio.playId(e.id, vol, pan);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Browser front end: load a zone's SE data and bank 0, play by sdb name or SE id.
const SE_CACHE_MAX = 32;

export class GameAudio {
  constructor(base = 'data/audio/') { this.base = base; this.ctx = null; this.ready = null; }

  load(zone = 128) {
    const z = String(zone).padStart(3, '0');
    const j = (f) => fetch(this.base + f).then((r) => { if (!r.ok) throw new Error(f + ' ' + r.status); return r.json(); });
    this.ready = (async () => {
      // the resident SE block + names (menu sounds; extract.py se_res.json). Optional: an older extract has none.
      const [drv, se, res] = await Promise.all([j('driver.json'), j(`se_z${z}.json`), j('se_res.json').catch(() => null)]);
      if (!res) console.warn('audio: no se_res.json (re-run tools/audio/extract.py): no menu sounds');
      const banks = {};
      for (const b of new Set([...se.banks, ...((res && res.banks) || [])])) {
        const n = String(b).padStart(4, '0');
        const [info, buf] = await Promise.all([j(`wave${n}.json`),
          fetch(this.base + `wave${n}.bin`).then((r) => r.arrayBuffer())]);
        banks[b] = { instruments: info.instruments, data: new Uint8Array(buf) };
      }
      this.drv = drv; this.se = se; this.banks = banks; this.renderers = {};
      for (const b in banks) this.renderers[b] = new SeRenderer(drv, banks[b]);
      this.res = res;
      return this;
    })();
    return this.ready;
  }

  // FUN_003e80d8 cases 2 / 0x16 / 0x17: the id is looked up in each loaded SE block (FUN_003e7ed8, DAT_0047d6c8):
  // the resident block (boot: FUN_003e78a8 request 4, FileCode 0x02810001) and the zone's sep.bin. Their ids don't overlap.
  program(id) {
    const k = String(id);
    return (this.res && this.res.programs[k]) || (this.se && this.se.programs[k]) || null;
  }

  // FUN_003eb970 -> FUN_003eb868: sdb slot 0 (the resident names ressddb.bin, FUN_00244db0) first, then slot 1 (the
  // zone's sdb.bin, FUN_00402220); row +0x10 = the SE id, 0 when the name is in neither.
  seIdOf(name) {
    const r = (this.res && this.res.names[name]) || (this.se && this.se.names[name]);
    return r ? r.id : 0;
  }

  // FUN_00241f40's sound side (pause on / off): FUN_003e86e0(DAT_0047d718, on) sets the manager word that
  // FUN_003e80d8 reads (requests 2 / 0x16 then send vol >> 3; 0x17 does not) and queues request 0x19 ->
  // FUN_00419400(2, on) = IOP command 6 (irx 0x14008), mask 2 = the SE tracks: every playing track whose program
  // flag byte (prog[4], stored at track +0x1a1 by FUN_000082d0, irx 0x85c4) has neither 0x40 nor 0x80 gets flag 8
  // (the SE tick FUN_00007224 skips it) and its voice is silenced and held (volume 0, pitch 0, ADSR 0x7fff / 0x5fff);
  // off: the flag is cleared, ADSR restored, volume / pitch re-sent, and the track goes on from where it stopped.
  // On the page an SE is one rendered buffer, so held = stopped at its offset and restarted there.
  setPaused(on) {
    on = on ? 1 : 0;
    if (this.sePaused === on) return;
    this.sePaused = on;
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    for (const p of this.playing || []) {
      if (p.flags & 0xc0) continue;                // menu sounds (0x58 / 0x59) and asj_033 (0x80) play on
      if (on && !p.held) {
        p.held = Math.min(Math.max(now - p.at, 0), p.buf.duration);
        try { p.src.onended = null; p.src.stop(); } catch (e) { /* not started */ }
      } else if (!on && p.held !== undefined && p.held !== false) {
        const off = p.held; p.held = false;
        this.rehold(p, off);
        this.startSource(p, off);
      }
    }
  }

  // The held SE rendered again from its start with the same random-table counter, the hold applied at the driver
  // tick it was paused on (SeRenderer.holdVoices), on its own renderer so the shared counter is not moved.
  // Every hold of this SE so far is applied (p.holds, SE-time ticks). Re-rendered only when the new hold tick has a voice
  // in decay in the current buffer's render (p.decay); else the buffer is already what the IOP plays.
  rehold(p, off) {
    const h = Math.floor(off * TICK_HZ);
    (p.holds ??= []).push(h);
    if (!p.decay || !p.decay[h]) return false;
    if (!p.prog || !this.drv || !this.banks[p.bank]) return false;
    const rd = new SeRenderer(this.drv, this.banks[p.bank]);
    rd.rngIndex = p.rngStart;
    const out = rd.render(p.prog, p.vol, p.pan, 8, p.holds);
    const buf = this.ctx.createBuffer(2, out.left.length, SPU_RATE);
    buf.copyToChannel(out.left, 0); buf.copyToChannel(out.right, 1);
    p.buf = buf; p.decay = out.decay;
    this.rerenders = (this.rerenders || 0) + 1;
    return true;
  }

  startSource(p, offset = 0) {
    const src = this.ctx.createBufferSource();
    src.buffer = p.buf; src.connect(this.ctx.destination);
    p.src = src; p.at = this.ctx.currentTime - offset;
    src.onended = () => { if (!p.held) this.playing = this.playing.filter((q) => q !== p); };
    src.start(0, offset);
    return src;
  }

  // AudioContext needs a user gesture; call from a key / click handler.
  resume() {
    if (!this.ctx) this.ctx = new AudioContext({ sampleRate: SPU_RATE });
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  // vol / pan: what the game's sound thread passes to FUN_0041a190(entry, pan, vol & 0x7f) (FUN_003e80d8
  // case 2; FUN_003e9220 computes them). pan is FUN_003e9220's angle byte: 0x40 ahead, 0x80 / 0x00 the sides,
  // 0xc0 behind; the IOP indexes its pan table with it (FUN_00001380).
  // code: the request (2 = a gameplay one-shot, 0x16 = a menu sound: FUN_003e80d8 shifts both by 3 while paused).
  playId(id, vol = 0x7f, pan = 0x40, code = 2) {
    if (!this.se || !this.ctx) return null;
    const hex = this.program(id);
    if (!hex) return null;
    if (this.sePaused && code !== 0x17) vol >>= 3;  // FUN_003e80d8: *(int *)mgr != 0 (FUN_003e86e0)
    const prog = hexBytes(hex);
    const bank = prog[1] | (prog[2] << 8);
    const rd = this.renderers[bank];
    if (!rd) return null;
    // A render depends on (program, vol, pan) and the driver's random-table counter rd.rngIndex (FUN_0000a870,
    // advanced by op 0x78 and the randomised pitch / volume / pan / ADSR), and costs a few ms on the main thread.
    // Keep rendered buffers keyed by all four; a hit reuses the buffer and moves the counter to where that render
    // left it, so the output is the same as rendering again (a page cache, not game logic).
    const rngStart = rd.rngIndex;
    const key = `${id}:${vol}:${pan}:${rd.rngIndex}`;
    this.cache ??= new Map();
    let ent = this.cache.get(key);
    if (ent) { this.cache.delete(key); this.cache.set(key, ent); rd.rngIndex = ent.rngEnd; }
    else {
      const out = rd.render(prog, vol, pan);
      const buf = this.ctx.createBuffer(2, out.left.length, SPU_RATE);
      buf.copyToChannel(out.left, 0); buf.copyToChannel(out.right, 1);
      ent = { buf, rngEnd: rd.rngIndex, decay: out.decay };
      this.cache.set(key, ent);
      if (this.cache.size > SE_CACHE_MAX) this.cache.delete(this.cache.keys().next().value);
    }
    // the playing list: what IOP command 6 (setPaused) holds; prog[4] = the program's flag byte (track +0x1a1)
    const p = { buf: ent.buf, decay: ent.decay, flags: prog[4], held: false, prog, vol, pan, rngStart, bank };
    this.playing ??= [];
    this.playing.push(p);
    return this.startSource(p);
  }

  playName(name, vol, pan) {
    const row = this.se && this.se.names[name];
    return row ? this.playId(row.id, vol, pan) : null;
  }

  // FUN_003e9e60(name, x, y): FUN_003eb970 (name -> SE id) -> FUN_003e9d70 (pan from x, y; queued, max 4 a frame) ->
  // FUN_003e9ed0 the same frame: FUN_003e7850(mgr, id, pan, 0x7f) = request 0x16. An id <= 0 sends nothing (FUN_003e9ed0).
  playMenu(name, x = -1, y = -1) {
    const id = this.seIdOf(name);
    const pan = menuPan(x, y);
    if (id > 0) this.playId(id, 0x7f, pan, 0x16);
    return { name, id, pan };
  }
}

// ---------------------------------------------------------------------------------------------
// Menu sounds (worker 0194; notes/audio-research.md "Menu sounds"). Menus latch ONE sound id per frame:
// FUN_003e1d10(id, x, y) writes DAT_004f58c8 / 58cc / 58ce (the last write of a frame wins); FUN_003e1d90 (once a frame,
// from the menu manager FUN_003dce38) plays it and clears the latch.

// GUESS: display width from both saves; writer not found (pans verified in w194). DAT_004fcab8 = 0x1c0 in sea-of-flames and
// w189 cancel; the code reads it as the display width: the XY offset (0x1000 - w) / 2 in FUN_00243948 / FUN_003d28c8 /
// FUN_00242208 / FUN_0040ff70, w / 0x20 columns in FUN_0040ff70.
export const MENU_PAN_WIDTH = 0x1c0;

// FUN_003e9d70: x < 0 and y < 0 -> 0x40; x < 0 -> x = 0; else x = min(x, width); pan = (int)(x * 32.0f / width) + 0x30,
// 0 below 0, 0x80 above 0x7f (single-precision floats, truncation toward zero).
export function menuPan(x, y, width = MENU_PAN_WIDTH) {
  if (x < 0) { if (y < 0) return 0x40; x = 0; }
  if (width <= x) x = width;
  const p = Math.trunc(Math.fround(Math.fround(Math.fround(x) * 32.0) / Math.fround(width))) + 0x30;
  return p < 0 ? 0 : p > 0x7f ? 0x80 : p;
}

// FUN_003cac38 (widget vt+0x7c with the |2 form, as FUN_003cb4a8 calls it): x = +6 + 16, y = +8 + (s16)(+0xc) / 2
export function menuWidgetPos(w) {
  return [(w.x + 16) << 16 >> 16, (w.y + Math.trunc(w.h / 2)) << 16 >> 16];
}

// What a menu action leaves in the latch, from pause.js's record of it (lastSE = the final id of the action, lastSEW = the
// widget it came from): cursor 6 / confirm 7 / cancel 8 go through FUN_003cb4a8(w, id, force) (cursor FUN_003cbc38: not
// forced; FUN_003d14e8 / FUN_003caf90 / FUN_003b80f8 / FUN_003b81b8: forced); the rest (pause 1, unpause 2, open 3,
// close 4, box 9) are FUN_003e1d10(id, -1, -1) / FUN_003cb480(id).
export function latchMenuSound(m, id, w) {
  if (id === null || id === undefined) return;
  if (w && (id === 6 || id === 7 || id === 8)) m.widget(w, id, id !== 6);
  else m.set(id);
}

export class MenuSound {
  // names: FUN_003e1d90's table PTR_DAT_0047d5c8 (extract.py se_res.json "menu", read from the ELF)
  constructor(names = null) {
    this.names = names;
    this.id = 0xff; this.x = -1; this.y = -1;     // DAT_004f58c8 / 58cc / 58ce
    this.enabled = 1;                             // DAT_004f58c9 (FUN_003e1ea0(1) in FUN_003dd810 / FUN_00245d00)
    this.last = 0xff; this.lastT = 0;             // DAT_004f58ca / DAT_004f58d0 (FUN_003dd810: 0xff / 0)
  }
  set(id, x = -1, y = -1) { this.id = id & 0xff; this.x = x; this.y = y; }   // FUN_003e1d10 (FUN_003cb480: x = y = -1)
  pending() { return this.id !== 0xff; }         // FUN_003e1d68
  clear() { this.id = 0xff; }                     // FUN_003e1d80
  // FUN_003cb4a8(w, id, force): only when forced or nothing is latched yet; the position from FUN_003cac38
  widget(w, id, force) {
    if (force || !this.pending()) { const [x, y] = menuWidgetPos(w); this.set(id, x, y); }
  }
  // FUN_003e1d90. now: FUN_0023c1f0 (ms). play(name, x, y): the request (GameAudio.playMenu). Returns what played.
  frame(now, play) {
    if (this.id === 0xff) return null;
    let on = this.enabled, out = null;
    // box-open 9 within 300 ms of a confirm 7 / cancel 8 is not played (lbu + sltiu: unsigned, so only 7 and 8)
    if (((this.last - 7) >>> 0) < 2 && this.id === 9 && now >>> 0 < (this.lastT + 300) >>> 0) on = 0;
    if (on) {
      if (this.id === 0x22) {
        // not translated: id 0x22 plays the stream "on_a104" (FUN_003eb9a0 -> FUN_003eb088); the pause never sends it
        console.warn('menu sound 0x22 (stream on_a104, FUN_003eb088) is not translated');
      } else {
        // (char) index; entry 0 is "" (no sdb row: FUN_003eb970 gives id 0, nothing is sent)
        const name = this.names ? this.names[(this.id << 24) >> 24] : null;
        if (name && play) out = play(name, this.x, this.y);
      }
      this.last = this.id; this.lastT = now;
    }
    this.clear();
    return out;
  }
}
