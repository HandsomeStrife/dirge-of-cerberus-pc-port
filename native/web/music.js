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
  // bgm_001's own position, 1237. The crossfade itself (a stream already open) is not translated.
  playMusic3(name, vol = 0, fade = 0) {
    if (fade < 1 || this.name === null) return this.open(name, vol);
    // the page never runs a crossfade, so DAT_004fab84 is always 0 here
    this.warnOnce('music: playMusic3 crossfade (FUN_003ec0d8 with a stream open) not translated');
    return Promise.resolve(null);
  }

  // FUN_003ec6f8(file, loop, vol, 1): opens the stream only when none is open (DAT_004fab80 == 0); else does nothing.
  // Only vol 0 is translated: the game subtracts vol from every scale-factor index in the decoder (FUN_00459ed0,
  // ctx +0x68c4), not done here. Its FUN_003ed740(vol, 100) ramps from the stream's vol to vol: no change.
  async open(name, vol = 0) {
    const ctx = this.au.ctx, info = this.meta && this.meta[name];
    if (!ctx || !info) return null;
    if (this.name !== null) return null;             // DAT_004fab80 != 0: nothing
    if (vol !== 0) { this.warnOnce('music: vol ' + vol + ' not translated (FUN_00459ed0 scale-factor offset)'); return null; }
    this.name = name;
    const req = this.req;
    let buf;
    try {
      const r = await fetch(this.base + info.file);
      if (!r.ok) throw new Error(info.file + ' ' + r.status);
      buf = await ctx.decodeAudioData(await r.arrayBuffer());
    } catch (e) {
      if (this.req === req) this.name = null;
      this.warnOnce('music: ' + name + ' not loaded (tools/audio/bgm.py) ' + e);
      return null;
    }
    if (this.req !== req) return null;               // stopped while loading
    const src = ctx.createBufferSource();
    src.buffer = buf;
    // the rate bgm.py wrote (48 kHz: the IOP's frame rate, trace w177_music); the context resamples the buffer
    if (info.loop) { src.loop = true; src.loopStart = info.loop_start_sample / info.rate; src.loopEnd = info.loop_end_sample / info.rate; }
    const g = ctx.createGain();
    // the IOP's volume now (= BGM_GAIN until a FUN_003ed7d0); the ramp keeps running on the IOP between streams
    this.catchUp(ctx.currentTime);
    g.gain.value = (this.vol ? this.vol.reg : 0x7fff) / 32768;
    src.connect(g); g.connect(ctx.destination);
    src.start();
    this.src = src; this.gain = g;
    if (this.pendingVol !== undefined) this.sendVolume();        // FUN_003ed8e0: sent with the first PCM slot
    else this.schedule();                                        // the rest of a ramp still running
    return src;
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
    this.src = null; this.name = null; this.req++;
  }

  warnOnce(m) { if (!this.warned.has(m)) { this.warned.add(m); console.warn(m); } }
}
