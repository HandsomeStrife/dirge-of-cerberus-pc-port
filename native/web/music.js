// Zone music (BGM streams) and the area ambience loop, as the game plays them (worker 0177;
// notes/audio-research.md "Music and ambience"). Extracted data: python3 -I tools/audio/bgm.py
// -> data/audio/bgm/ (bgm.json + bgm_NNN.flac, gitignored game data; declared in se_zNNN.json "bgm").
// The decoded track is one AudioBuffer: bgm_001 = 15.3 M samples x 2 ch x 4 bytes = 122 MB of float PCM.
//
// BGM: KerberosSound.playMusic3(name, vol, fade) (native FUN_003a0198; args read last to first; GameMusic.playMusic3).
// The EE decodes one 1024-sample ATRAC3 frame at a time into the PCM ring 0x1fa0000 (FUN_003ed000 -> FUN_003ebaa8 -> libat3dec FUN_00458e80), the IOP
// plays it at 48 kHz (trace w177_music: 46.77 frames / s) on core 1's sound-data input, volume
// FUN_00010394(0x14, 0x7f): ((0x7f + 1) << 8) - 1 = 0x7fff (sceSd params 0x0f81 / 0x1081). The stream loops from
// the sdb row's end frame back to its start frame (FUN_003ebda0 -> FUN_0024f870 -> FUN_0024d730; trace w177_loop).
// The extractor wrote the seam frames after the end, so a plain buffer loop over [loop_start, loop_end) samples
// repeats exactly the game's frame sequence.
//
// Ambience: KerberosSound.playBgAreaSound(name) -> native FUN_0039dd80 -> FUN_003e6c88(name, vol): a new name stops
// the old one (FUN_003e65b0) and opens an emitter slot (FUN_003e8e18); FUN_003e8b70 fixes its volume (slot flag
// 0x40, vol = min(arg, 0x7f)) and FUN_003e8f00 sets 0x20000 (sent as request 0x17). The slot has no position
// (flag 0x8000 -> pan 0x40). The same name again only refreshes the volume. The SE program is endless (op 0x06),
// so it is rendered as a stream by the IOP driver translation in audio.js (SeRenderer.start / tick).
import { SeRenderer, hexBytes, SPU_RATE, TICK_HZ, TICK_SAMPLES } from './audio.js';

export const BGM_GAIN = 0x7fff / 32768;      // core-1 input volume 0x7fff (IOP FUN_00010394); voices: audio.js mix

// The core-1 input (BGM) volume on the IOP (worker 0194; notes/audio-research.md "Pause volume drop").
// FUN_003ed7d0(vol) stores PTR_0047d7a0; FUN_003ed8e0 sends it with the next PCM slot as FUN_0041af80(0x14, vol) = IOP
// command 0x34 -> FUN_00010394(time 0x14, vol): target = vol ? ((vol + 1) << 8) - 1 : 0, in 1/4096 units; with a time,
// step = ((target << 12 | 0x800) - cur) / time (MIPS div: toward zero) for `time` driver ticks, else cur = target at
// once. FUN_00010328, run by the 240 Hz driver tick while the count is non-zero: cur += step, BVOLL / BVOLR (sceSd
// 0x0f81 / 0x1081) = cur >> 12. Checked against the IOP RAM (irx base 0x82130, state at irx 0x5ddb0): sea-of-flames
// cur 0x7fff800 (the title's FUN_003ed7d0(0x7f) ramp), w189 cancel (paused) cur 0x30ff804, step -0x3f3333, count 0.
export class BgmVolume {
  constructor() { this.cur = 0x7fff800; this.step = 0; this.count = 0; }
  set(time, vol) {                                 // FUN_00010394
    let t = vol ? (((vol + 1) << 8) - 1) << 12 : 0;
    if (time) { this.step = Math.trunc(((t | 0x800) - this.cur) / time); this.count = time; }
    else { this.cur = t; this.count = 0; }
  }
  tick() { if (this.count) { this.count--; this.cur += this.step; } }   // FUN_00010328
  get reg() { return (this.cur >> 12) & 0xffff; }
}

// One streamed SE program (an endless one, like the area ambience). ticks(n) renders n driver ticks.
export class SeStream {
  constructor(drv, bank, prog, vol = 0x7f, pan = 0x40) {
    // Its own renderer: the shared one is reused by every offline SE render (audio.js GameAudio.playId).
    // GUESS: own random-table counter (IOP FUN_0000a870 keeps one for every SE; not decoded; see notes/fidelity-audit.md)
    this.rd = new SeRenderer(drv, bank);
    this.rd.start(prog, vol, pan);
    this.t = 0;
    this.done = false;
  }

  ticks(n) {
    const L = new Float32Array(n * TICK_SAMPLES), R = new Float32Array(n * TICK_SAMPLES);
    for (let i = 0; i < n && !this.done; i++, this.t++) this.done = this.rd.tick(this.t, L, R, i * TICK_SAMPLES);
    return { left: L, right: R };
  }
}

// Schedules a SeStream into an AudioContext a little ahead of the clock (a page scheduler, not game logic).
// 2 s ahead: background tabs run timers about once a second. Page limitation: Chrome's intensive throttling (a tab
// hidden for 5 min: timers once a minute) outruns it and the ambience gaps (notes/fidelity-audit.md 'Area ambience').
const AHEAD_TICKS = 480, CHUNK_TICKS = 60;

export class AreaSound {
  constructor(audio) { this.au = audio; this.name = null; this.stream = null; this.timer = null; this.srcs = []; }

  // FUN_003e6c88(name, vol). vol: the native's int argument.
  // GUESS: default 255 = the sea-of-flames save's DAT_004f5a28 (the JVM wrapper passing it not decoded; see notes/fidelity-audit.md)
  play(name, vol = 255) {
    const au = this.au;
    if (!au.se || !au.ctx) return false;
    if (name === this.name) return true;           // same name: only FUN_003e8b70 again (the volume is fixed anyway)
    this.stop();                                     // FUN_003e65b0
    const row = au.se.names[name];
    const hex = row && au.se.programs[String(row.id)];
    if (!hex) return false;
    const prog = hexBytes(hex);
    const bank = au.banks[prog[1] | (prog[2] << 8)];
    if (!bank) return false;
    this.name = name;
    this.stream = new SeStream(au.drv, bank, prog, Math.min(vol, 0x7f), 0x40);
    this.next = au.ctx.currentTime + 0.05;
    this.pump();
    this.timer = setInterval(() => this.pump(), 100);
    return true;
  }

  pump() {
    const ctx = this.au.ctx, s = this.stream;
    if (!s) return;
    while (!s.done && this.next < ctx.currentTime + AHEAD_TICKS / TICK_HZ) {
      const { left, right } = s.ticks(CHUNK_TICKS);
      const buf = ctx.createBuffer(2, left.length, SPU_RATE);
      buf.copyToChannel(left, 0); buf.copyToChannel(right, 1);
      const src = ctx.createBufferSource();
      src.buffer = buf; src.connect(ctx.destination); src.start(this.next);
      this.next += left.length / SPU_RATE;
      this.srcs.push({ src, end: this.next });
    }
    this.srcs = this.srcs.filter((c) => c.end > ctx.currentTime);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    for (const c of this.srcs) { try { c.src.stop(); } catch (e) { /* not started */ } }
    this.timer = null; this.stream = null; this.name = null; this.srcs = [];
  }
}

// FUN_0023c1f0: the EE's millisecond clock; the page takes the AudioContext's (t: a scheduled time)
const clockMs = (ctx, t = ctx.currentTime) => Math.floor(t * 1000);
export const BGM_FRAME_S = 1024 / 48000;          // one ATRAC3 frame: the unit FUN_003ed000 decodes and mixes

// The decoder's volume offset (stream +0x90 -> ctx +0x68c4, FUN_00459ed0: subtracted from every scale-factor index,
// clamped at 0). ATRAC3's scale factors are 2^((i - 15) / 3), so the offset is a gain of 2^(-off / 3).
// L: a scale factor already below `off` is clamped at index 0 instead of going lower (not reproduced: a gain on PCM).
export const sfGain = (off) => Math.pow(2, -off / 3);

// FUN_003ed740(vol, time) and its use in FUN_003ed000 (worker 0215).
export class MusicRamp {
  constructor() { this.t0 = 0; this.t1 = 0; this.from = -1; this.to = 0; this.active = false; }   // 0x98 / 0x9c / 0xa4 / 0xa0
  set(vol, time, now) {
    this.t0 = now;
    if (vol < 0 && time === 0) { this.active = false; return; }                  // DAT_004fab98 = 0
    this.to = vol > 0x3e ? 0x3f : vol < 0 ? 0 : vol;
    this.t1 = now + time; this.from = -1; this.active = true;
  }
  // one decoded frame of the main stream at clock `now`: returns its new +0x90
  apply(now, cur) {
    if (!this.active) return cur;
    if (this.from < 0) this.from = cur;                                            // DAT_004faba4 < 0 -> +0x90
    if (now < this.t1 && this.t1 !== this.t0) {
      let v = (Math.trunc(((this.to - this.from) * 0x100 * (now - this.t0)) / (this.t1 - this.t0)) >> 8) + this.from;
      return v < 0 ? 0 : v > 0x3e ? 0x3f : v;
    }
    this.active = false;
    return this.to;
  }
}

// FUN_002616f0(curve, x, y, 4): end slopes one-sided, inner ones central (dx, dy kept apart); FUN_00261a90 evaluates it.
// x = 0, T / 4, T / 2, T (FUN_003ec0d8 writes 0x47d774..0x47d77c), y = 1, 4, 8, 64 (0x47d780), eps = DAT_0046be00 = 0.5.
export function crossfadeCurve(T) {
  const f = Math.fround;
  const x = [0, f(f(T) * 0.25), f(f(T) * 0.5), f(T)], y = [1, 4, 8, 64], n = 4;
  const dx = new Array(n), dy = new Array(n);
  for (let i = 1; i < n - 1; i++) { dx[i] = f(x[i + 1] - x[i - 1]); dy[i] = f(y[i + 1] - y[i - 1]); }
  dx[0] = f(x[1] - x[0]); dy[0] = f(y[1] - y[0]); dx[n - 1] = f(x[n - 1] - x[n - 2]); dy[n - 1] = f(y[n - 1] - y[n - 2]);
  return { x, y, dx, dy, eps: 0.5 };
}
export function evalCurve(c, t) {
  const f = Math.fround, { x, y, dx, dy } = c;
  t = f(t);
  if (t < x[0]) return y[0];
  if (x[3] < t) return y[3];
  let lo = 0, hi = 3, k = hi;                         // FUN_00261a90's search
  if (0 < hi) {
    do { k >>= 1; if (x[k] < t) { lo = k + 1; k = hi; } hi = k; k = lo + hi; } while (lo < hi);
  }
  const i = lo - (0 < lo ? 1 : 0);
  const y0 = y[i], y1 = y[i + 1], d = f(y1 - y0);
  if (Math.abs(d) <= c.eps) return f(y0 + f(f(d / f(x[i + 1] - x[i])) * f(t - x[i])));
  const h = f(x[i + 1] - x[i]), u = f(f(t - x[i]) / h), v = f(1 - u);
  return f(f(f(f(f(u + u) + 1) * v) * v) * y0 + f(f(f(f(u * v) * v) * f(dy[i] / dx[i])) * Math.abs(h))
    + f(f(f(f(-u * u) * v) * f(dy[i + 1] / dx[i + 1])) * Math.abs(h)) + f(f(f(u * u) * f(3 - f(u + u))) * y1));
}
// FUN_003ed000 -> FUN_003eb52c(a, b): (int)(f x 256) & 0xffff, (int)(1 / (1 - 1 / f) x 256) & 0xffff
const cvtw = (x) => (Number.isFinite(x) ? Math.trunc(x) : x > 0 ? 0x7fffffff : -0x80000000) | 0;   // cvt.w.s
export function mixWeights(f) {
  return [cvtw(Math.fround(f * 256)) & 0xffff, cvtw(Math.fround(Math.fround(1 / Math.fround(1 - Math.fround(1 / f))) * 256)) & 0xffff];
}
// FUN_003eb544: sample x (x << 16) / (s16)w >> 8 (pdivbw), as a gain; w == 0 -> the mix is skipped (returns -1: nothing)
export const mixGain = (w) => { const s = (w << 16) >> 16; return s === 0 ? 1 : 256 / s; };

export class GameMusic {
  constructor(audio, base = 'data/audio/bgm/') {
    this.au = audio; this.base = base; this.meta = null; this.src = null; this.name = null; this.req = 0; this.warned = new Set();
  }

  // Fetches bgm.json only when the zone's SE data declares it (se_zNNN.json "bgm", written by tools/audio/bgm.py):
  // a page without the extracted BGM makes no request, so no 404 in the console. Rejects when there is none.
  load(zone = 128) {
    this.zone = 'z' + String(zone).padStart(3, '0');
    this.ready = Promise.resolve(this.au.ready).then(() => {
      const names = this.au.se && this.au.se.bgm;
      if (!names || !names.length) throw new Error('not extracted');
      return fetch(this.base + 'bgm.json');
    }).then((r) => { if (!r.ok) throw new Error('bgm.json ' + r.status); return r.json(); })
      .then((j) => { this.meta = j[this.zone] || {}; return this; });
    return this.ready;
  }

  // KerberosSound.playMusic3(name, vol, fade) -> FUN_003a0198, taking its DAT_004efba0 +0x156c == 0 branch (0 in the
  // sea-of-flames save; the != 0 branch stops the music first). fade < 1 -> FUN_003ec500 -> FUN_003ec6f8(file, loop,
  // vol, 1). Else FUN_003ec560 -> FUN_003ec0d8: with a crossfade already running (DAT_004fab84 != 0) it returns; with
  // no stream open (DAT_004fab80 == 0) it calls FUN_003ec6f8(file, loop, vol, 1) too: the stream starts at once, no
  // fade-in. That is z128's start (ev0101 playMusic3("bgm_001", 0, 4000)): in the save the crossfade clock
  // DAT_004fab8c (written only by that branch) is 0 and the ring's frame count (reset by FUN_003ec6f8) equals
  // bgm_001's own position, 1237. With a stream open it crossfades (crossfade below; worker 0215).
  playMusic3(name, vol = 0, fade = 0) {
    if (fade < 1 || this.name === null) return this.open(name, vol);
    return this.crossfade(name, vol, fade);
  }

  // changeMusicVol(vol, time) -> FUN_003a5308 -> FUN_003ed740 (worker 0215): a linear ramp of the main stream's decoder
  // volume offset (stream +0x90) from its value at the first decoded frame (DAT_004faba4 = -1 -> +0x90) to vol over
  // `time` ms, applied per decoded frame by FUN_003ed000 (MusicRamp). vol < 0 with time 0 stops a ramp.
  changeMusicVol(vol, time = 0) {
    const ctx = this.au.ctx;
    (this.ramp ??= new MusicRamp()).set(vol, time, ctx ? clockMs(ctx) : 0);
    this.pumpStart();
  }

  // FUN_003ec6f8(file, loop, vol, 1): opens the stream only when none is open (DAT_004fab80 == 0); else does nothing.
  // Its FUN_003ed740(vol, 100) ramps from the stream's vol to vol: no change. vol = the decoder's scale-factor offset
  // (sfGain).
  async open(name, vol = 0) {
    const ctx = this.au.ctx, info = this.meta && this.meta[name];
    if (!ctx || !info) return null;
    if (this.name !== null) return null;             // DAT_004fab80 != 0: nothing
    this.name = name;
    const req = this.req;
    const buf = await this.track(name, info);
    if (!buf) { if (this.req === req) this.name = null; return null; }
    if (this.req !== req) return null;               // stopped while loading
    // the IOP's volume node (core-1 input, BgmVolume): one for both streams of a crossfade (they are mixed on the EE)
    if (!this.gain) {
      const g = ctx.createGain();
      // the IOP's volume now (= BGM_GAIN until a FUN_003ed7d0); the ramp keeps running on the IOP between streams
      this.catchUp(ctx.currentTime);
      g.gain.value = (this.vol ? this.vol.reg : 0x7fff) / 32768;
      g.connect(ctx.destination);
      this.gain = g;
    }
    this.main = this.startStream(buf, info, vol);
    this.src = this.main.src;
    this.ramp ??= new MusicRamp();
    this.ramp.set(vol, 100, clockMs(ctx));            // FUN_003ec6f8 -> FUN_003ed740(vol, 100)
    if (this.pendingVol !== undefined) this.sendVolume();        // FUN_003ed8e0: sent with the first PCM slot
    else this.schedule();                                        // the rest of a ramp still running
    this.pumpStart();
    return this.src;
  }

  async track(name, info) {
    const ctx = this.au.ctx;
    try {
      const r = await fetch(this.base + info.file);
      if (!r.ok) throw new Error(info.file + ' ' + r.status);
      return await ctx.decodeAudioData(await r.arrayBuffer());
    } catch (e) {
      this.warnOnce('music: ' + name + ' not loaded (tools/audio/bgm.py) ' + e);
      return null;
    }
  }

  // a stream: buffer source -> its own gain (the decoder offset x the crossfade weight) -> the IOP node
  startStream(buf, info, vol) {
    const ctx = this.au.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    // the rate bgm.py wrote (48 kHz: the IOP's frame rate, trace w177_music); the context resamples the buffer
    if (info.loop) { src.loop = true; src.loopStart = info.loop_start_sample / info.rate; src.loopEnd = info.loop_end_sample / info.rate; }
    const sg = ctx.createGain();
    sg.gain.value = sfGain(vol);
    src.connect(sg); sg.connect(this.gain);
    const at = ctx.currentTime;
    src.start(at);
    return { src, sg, at, off: vol, next: 0 };       // off = stream +0x90; next = the next frame to schedule
  }

  // FUN_003ec0d8 with a stream open and no crossfade running: the new stream (vol = its +0x90 from the start) is decoded
  // alongside; FUN_003ed740(vol, fade) ramps the main stream's offset to vol; FUN_003ed000 mixes, per decoded frame,
  // old x 256 / a + new x 256 / b (FUN_003eb52c / FUN_003eb544: MMI word / halfword divides, saturating add), with
  // f = the curve at (clock - start) (FUN_00261a90; FUN_002616f0 on x = 0, T/4, T/2, T, y = 1, 4, 8, 64 from 0x47d770 /
  // 0x47d780), a = (int)(f x 256) & 0xffff, b = (int)(1 / (1 - 1 / f) x 256) & 0xffff; from clock >= start + T the
  // frame is mixed with (0x7fff, 0x100) and the new stream becomes the main one (DAT_004fab80 = DAT_004fab84).
  // L: the weights are applied as gains per 1024-sample frame (the sample-level truncation of the divides is not
  // reproduced); the curve and the ramp are evaluated at each frame's output time, not at its decode time (the ring
  // runs up to 8 frames ahead); the new track starts when its FLAC has loaded.
  async crossfade(name, vol, fade) {
    const ctx = this.au.ctx, info = this.meta && this.meta[name];
    if (!ctx || !info || !this.main) return null;    // FUN_003ec0d8: no PCM ring / no file -> nothing
    if (this.xf) return null;                         // DAT_004fab84 != 0: a crossfade is running
    const req = this.req;
    this.xf = { pending: true };
    const buf = await this.track(name, info);
    if (!buf || this.req !== req) { this.xf = null; return null; }
    const t0 = clockMs(ctx);
    const s = this.startStream(buf, info, vol);
    s.sg.gain.value = 0;
    this.xf = { s, name, start: t0, end: t0 + fade, curve: crossfadeCurve(fade) };
    this.ramp ??= new MusicRamp();
    this.ramp.set(vol, fade, t0);                     // FUN_003ed740(param_4, param_2) on the main stream
    this.pumpStart();
    return s.src;
  }

  pumpStart() { if (!this.pumpTimer && this.au.ctx) this.pumpTimer = setInterval(() => this.pump(), 50); this.pump(); }

  // FUN_003ed000's per-frame part, scheduled frame by frame a little ahead of the clock (page scheduler: 250 ms)
  pump() {
    const ctx = this.au.ctx, m = this.main;
    if (!ctx || !m) return;
    const horizon = ctx.currentTime + 0.25;
    for (;;) {
      const t = m.at + m.next * BGM_FRAME_S;
      if (t > horizon) break;
      m.next++;
      const now = clockMs(ctx, t);
      if (this.ramp) m.off = this.ramp.apply(now, m.off);
      let wOld = 1, wNew = null;
      const x = this.xf && this.xf.s ? this.xf : null;
      if (x) {
        const [a, b] = now < x.end ? mixWeights(evalCurve(x.curve, now - x.start)) : [0x7fff, 0x100];
        wOld = mixGain(a); wNew = mixGain(b);
        x.s.sg.gain.setValueAtTime(sfGain(x.s.off) * wNew, t);
      }
      m.sg.gain.setValueAtTime(sfGain(m.off) * wOld, t);
      if (x && now >= x.end) {                       // the swap: DAT_004fab80 = DAT_004fab84
        try { m.src.stop(t + BGM_FRAME_S); } catch (e) { /* not started */ }
        x.s.next = Math.max(0, Math.round((t + BGM_FRAME_S - x.s.at) / BGM_FRAME_S));
        this.main = x.s; this.src = x.s.src; this.name = x.name; this.xf = null;
        return this.pump();
      }
    }
    if (!this.xf && !(this.ramp && this.ramp.active) && this.pumpTimer) { clearInterval(this.pumpTimer); this.pumpTimer = null; }
  }

  // FUN_003ed7d0(vol): the pause sends 0x30, the resume 0x7f (FUN_00241f40). The IOP gets it only when FUN_003ed8e0
  // sends a PCM slot (a stream running, DAT_0047d794 != 0), so without music it waits for the stream.
  // L: applied now, not with the next slot (a slot is 1024 samples, 21 ms).
  setVolume(vol) {
    this.pendingVol = vol;
    if (this.src) this.sendVolume();
  }

  // FUN_0041af80(0x14, vol) -> IOP FUN_00010394; the 20 ticks of FUN_00010328 as gain steps on the driver's 240 Hz clock
  sendVolume() {
    const ctx = this.au.ctx, vol = this.pendingVol & 0x7f;    // FUN_0041af80: param_2 & 0x7f
    this.pendingVol = undefined;
    const m = this.vol ??= new BgmVolume();
    if (!ctx || !this.gain) { m.set(0x14, vol); return; }
    const t0 = ctx.currentTime;
    this.catchUp(t0);                                // a new command mid-ramp starts from where the ramp is
    m.set(0x14, vol);
    this.volT0 = t0; this.volDone = 0;
    this.schedule();
  }

  // FUN_00010328 ticks run on the IOP since the ramp started at volT0 (volDone of them already applied to this.vol)
  catchUp(t) {
    const m = this.vol;
    if (!m || this.volT0 === undefined) return;
    const n = Math.floor((t - this.volT0) * TICK_HZ);
    for (; this.volDone < n && m.count; this.volDone++) m.tick();
  }

  // the ramp's remaining steps as gain values on this.gain, each at its driver tick volT0 + k / 240
  schedule() {
    const ctx = this.au.ctx, m = this.vol;
    if (!ctx || !this.gain || !m) return;
    const g = this.gain.gain, t = ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(m.reg / 32768, t);
    if (this.volT0 === undefined) return;
    const s = Object.assign(new BgmVolume(), m);
    for (let k = this.volDone + 1; s.count; k++) { s.tick(); g.setValueAtTime(s.reg / 32768, this.volT0 + k / TICK_HZ); }
  }

  // stopMusic -> FUN_003ebfa0.
  stopMusic() {
    if (this.src) { try { this.src.stop(); } catch (e) { /* not started */ } }
    if (this.xf && this.xf.s) { try { this.xf.s.src.stop(); } catch (e) { /* not started */ } }
    this.src = null; this.name = null; this.req++; this.main = null; this.xf = null;
  }

  warnOnce(m) { if (!this.warned.has(m)) { this.warned.add(m); console.warn(m); } }
}
