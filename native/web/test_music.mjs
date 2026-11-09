// test_music.mjs -- music.js (zone BGM + area ambience). node native/web/test_music.mjs
// Uses the extracted data under data/audio/ when present (python3 -I tools/audio/extract.py; tools/audio/bgm.py),
// else only the synthetic checks run. MUSIC_JS=<path> tests another copy (mutation runs).
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const M = await import(pathToFileURL(process.env.MUSIC_JS || path.join(here, 'music.js')).href);
const A = await import(pathToFileURL(path.join(here, 'audio.js')).href);
let pass = 0, skip = 0;
const t = async (name, f) => { await f(); pass++; console.log('ok', name); };
const D = path.join(here, 'data/audio/');
const have = (f) => fs.existsSync(D + f);

// A fake AudioContext: records buffers and when / how they start.
class Ctx {
  constructor() { this.currentTime = 0; this.started = []; this.destination = {}; }
  createBuffer(ch, n, rate) {
    const c = [new Float32Array(n), new Float32Array(n)];
    return { length: n, sampleRate: rate, copyToChannel: (a, i) => c[i].set(a), ch: c };
  }
  createBufferSource() {
    const s = { connect: (n) => { s.to = n; }, start: (w = 0) => { s.at = w; this.started.push(s); }, stop: () => { s.stopped = true; } };
    return s;
  }
  createGain() {
    const auto = [], g = { gain: { value: 1, auto }, connect: (n) => { g.to = n; } };
    for (const f of ['setValueAtTime', 'linearRampToValueAtTime', 'exponentialRampToValueAtTime', 'setTargetAtTime', 'setValueCurveAtTime']) g.gain[f] = (...a) => auto.push([f, ...a]);
    return g;
  }
  async decodeAudioData(b) { return { decoded: b.byteLength }; }
}

// Synthetic driver + a one-voice bank + an endless program (loop_begin, note on, wait, note off, loop back forever).
const drv = {
  semitone: Array.from({ length: 12 }, (_, i) => 0x20000 + i * 0x2000),   // note 60 -> pitch 0x1000 (48 kHz)
  fine: Array.from({ length: 256 }, (_, i) => 0x10000 + i * 16),
  pan: Array.from({ length: 256 }, (_, i) => i * 2),
  rng: Array.from({ length: 256 }, (_, i) => (i * 37) & 0xff),
};
const sample = new Uint8Array(16 * 8);
for (let b = 0; b < 8; b++) { sample[b * 16] = 0x00; sample[b * 16 + 1] = b === 7 ? 3 : b === 0 ? 4 : 2; for (let k = 2; k < 16; k++) sample[b * 16 + k] = (k * 29 + b) & 0xff; }
const bank = { data: sample, instruments: [[{ flags: 0x200, start: 0, loop: 0, adsr: (0x5fe8 << 16) | 0x00ff, tune: 0, keyHi: 127, velHi: 127, vol: 127, pan: 0, mode: 0 }]] };
// track: delta 0, 0x20 program 0; delta 0, 0x04 loop; 0x12 note_on_k 60; delta 40, 0x18 note off; delta 10, 0x06 loop forever
const trk = [0x00, 0x20, 0x00, 0x00, 0x04, 0x00, 0x12, 60, 40, 0x18, 10, 0x06];
const PROG = Uint8Array.from([1, 0, 0, 100, 0, trk.length, 0, ...trk]);

await t('SeStream: streamed ticks equal the offline render tick for tick (same driver translation)', () => {
  const off = new A.SeRenderer(drv, bank).render(PROG, 0x7f, 0x40, 3);
  const s = new M.SeStream(drv, bank, PROG, 0x7f, 0x40);
  const parts = [s.ticks(100), s.ticks(77), s.ticks(3 * 240 - 177)];
  const L = new Float32Array(off.left.length); let o = 0;
  for (const p of parts) { L.set(p.left, o); o += p.left.length; }
  assert.strictEqual(o, off.left.length, 'the endless program fills the whole cap');
  assert.ok(off.left.some((v) => v !== 0), 'it makes sound');
  assert.deepStrictEqual(L, off.left);
});

await t('SeStream: an endless program never ends', () => {
  const s = new M.SeStream(drv, bank, PROG);
  for (let i = 0; i < 20; i++) s.ticks(240);
  assert.strictEqual(s.done, false);
});

const au = () => ({ ctx: new Ctx(), drv, banks: { 0: bank },
  se: { names: { asj_033: { id: 10011 }, asj_034: { id: 10012 } }, programs: { 10011: hexOf(PROG), 10012: hexOf(PROG) } } });
function hexOf(b) { return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join(''); }

await t('AreaSound FUN_003e6c88: fixed vol min(arg, 0x7f) (FUN_003e8b70), pan 0x40, same name keeps playing', () => {
  const a = au(), s = new M.AreaSound(a);
  assert.ok(s.play('asj_033', 255));
  const st = s.stream;
  assert.strictEqual(st.rd.tracks[0].seqVol, 0x7f << 12);
  assert.strictEqual(st.rd.tracks[0].pan, 0x40 << 12);
  const n = a.ctx.started.length;
  assert.ok(n >= 4, 'scheduled ahead');
  assert.ok(s.play('asj_033', 255));
  assert.strictEqual(s.stream, st, 'same name: no restart');
  assert.ok(s.play('asj_034', 40));
  assert.notStrictEqual(s.stream, st, 'a new name replaces it (FUN_003e65b0 first)');
  assert.strictEqual(s.stream.rd.tracks[0].seqVol, 40 << 12);
  s.stop();
});

await t('AreaSound: chunks are back to back on the context clock', () => {
  const a = au(), s = new M.AreaSound(a);
  s.play('asj_033');
  const st = a.ctx.started;
  for (let i = 1; i < st.length; i++) assert.ok(Math.abs(st[i].at - (st[i - 1].at + st[i - 1].buffer.length / A.SPU_RATE)) < 1e-9);
  s.stop();
});

const warns = [];
console.warn = (...a) => warns.push(a.join(' '));
const fetchOk = (calls = []) => async (u) => { calls.push(u); return { ok: true, arrayBuffer: async () => new ArrayBuffer(8), json: async () => ({ z128: { bgm_001: {} } }) }; };
const META = { bgm_001: { file: 'bgm_001.flac', loop: true, rate: 48000, loop_start_sample: 6700 * 1024, loop_end_sample: 14948 * 1024 } };

await t('GameMusic z128 start: playMusic3("bgm_001", 0, 4000) with no stream open starts now, no fade-in (FUN_003ec0d8 -> FUN_003ec6f8)', async () => {
  const a = { ctx: new Ctx() }, m = new M.GameMusic(a, 'x/');
  m.meta = META;
  globalThis.fetch = fetchOk();
  const src = await m.playMusic3('bgm_001', 0, 4000);
  assert.ok(src, 'started');
  // worker 0271: heard when the IOP plays the first block mixed after the open (pcm_ring.js; the ring full, as T w266 every frame):
  // block 23 of a ring made at 0 (the IOP starts on block 0), 23 x 1024 / 48000 s
  assert.strictEqual(src.at, 23 * 1024 / 48000);
  assert.strictEqual(src.loop, true);
  assert.strictEqual(src.loopStart, 6700 * 1024 / 48000);
  assert.strictEqual(src.loopEnd, 14948 * 1024 / 48000);
  assert.strictEqual(src.to.to.gain.value, 0x7fff / 32768, 'core-1 input gain 0x7fff (the IOP node after the stream node)');
  assert.deepStrictEqual(src.to.to.gain.auto, [], 'no IOP ramp');
  assert.strictEqual(src.to.gain.value, 1, 'decoder offset 0: gain 1');
  assert.ok(src.to.gain.auto.every((a) => a[1] === 1), 'FUN_003ed740(0, 100) ramps 0 -> 0: every frame at 1');
  m.stopMusic();
});

await t('GameMusic: loop points in seconds use bgm.json\'s rate', async () => {
  const a = { ctx: new Ctx() }, m = new M.GameMusic(a, 'x/');
  m.meta = { bgm_001: { ...META.bgm_001, rate: 24000 } };
  globalThis.fetch = fetchOk();
  const src = await m.playMusic3('bgm_001', 0, 0);
  assert.strictEqual(src.loopStart, 6700 * 1024 / 24000);
  assert.strictEqual(src.loopEnd, 14948 * 1024 / 24000);
});

await t('GameMusic FUN_003ec6f8: with a stream open, playMusic3(fade < 1) does nothing (any vol); with fade it crossfades (FUN_003ec0d8), a second one is refused while it runs', async () => {
  const a = { ctx: new Ctx() }, m = new M.GameMusic(a, 'x/');
  m.meta = { ...META, bgm_012: { ...META.bgm_001, file: 'bgm_012.flac' } };
  globalThis.fetch = fetchOk();
  const src = await m.playMusic3('bgm_001', 0, 0);
  const n = a.ctx.started.length;
  assert.strictEqual(await m.playMusic3('bgm_001', 0, 0), null);
  assert.strictEqual(await m.playMusic3('bgm_001', 3, 0), null);
  assert.strictEqual(a.ctx.started.length, n, 'nothing new started');
  const x = await m.playMusic3('bgm_012', 3, 2500);
  assert.ok(x && a.ctx.started.length === n + 1, 'the crossfade stream starts');
  assert.strictEqual(await m.playMusic3('bgm_013', 0, 1000), null, 'DAT_004fab84 != 0: refused');
  assert.ok(!src.stopped && m.src === src, 'the old stream is still the main one');
  // the first scheduled frame is at t = 0: f = 1, b = (int)(inf) & 0xffff = 0xffff = -1 as the divisor: the game's samples
  // wrap (mixSample), the page leaves the new stream out of that frame (gain 0, warned) and the old one at 256 / 256
  const [wa0, wb] = M.mixWeights(M.evalCurve(M.crossfadeCurve(2500), 0));
  assert.deepStrictEqual([wa0, wb], [256, 0xffff]);
  assert.strictEqual(M.mixGain(wb), null);
  // worker 0271: the frames are weighted when they are mixed (pcm_ring.js mixedAt), not when heard: the first frame of the new
  // stream is block 23 (heard at 23 x 1024 / 48000 s), mixed by the ring's second wake at 40 ms: the curve at 40 ms
  a.ctx.currentTime = 0.3; m.pump();
  const [wa1, wb1] = M.mixWeights(M.evalCurve(M.crossfadeCurve(2500), 40));
  assert.strictEqual(x.to.gain.auto[0][2], 23 * 1024 / 48000);
  assert.ok(Math.abs(x.to.gain.auto[0][1] - M.sfGain(3) * M.mixGain(wb1)) < 1e-12, 'first frame: ' + x.to.gain.auto[0] + ' vs ' + [wa1, wb1]);
  assert.strictEqual(src.to.gain.auto.at(-1)[1] > 0, true);
  m.stopMusic();
  assert.ok(src.stopped && x.stopped, 'stopMusic (FUN_003ebfa0) stops both');
  const src2 = await m.playMusic3('bgm_001', 0, 4000);
  assert.ok(src2 && !src2.stopped, 'after stopMusic a new stream opens');
  m.stopMusic();
});

await t('GameMusic crossfade: the curve 1 / 4 / 8 / 64 at 0 / T/4 / T/2 / T, weights old 1/f, new 1 - 1/f, then the swap', async () => {
  const c = M.crossfadeCurve(4000);
  assert.deepStrictEqual([0, 1000, 2000, 4000].map((t) => M.evalCurve(c, t)), [1, 4, 8, 64]);
  assert.ok(M.evalCurve(c, 3000) > 8 && M.evalCurve(c, 3000) < 64);
  // between the knots, worked by hand from FUN_00261a90 (slopes dy / dx from FUN_002616f0: 3 / 1000, 7 / 2000, 60 / 3000,
  // 56 / 2000; Hermite (2u + 1) v^2 y0 + u v^2 m0 h - u^2 v m1 h + u^2 (3 - 2u) y1):
  for (const [t, y] of [[250, 1.7265625], [500, 2.4375], [1500, 3.9375], [3000, 34]]) assert.ok(Math.abs(M.evalCurve(c, t) - y) < 1e-4, t + ': ' + M.evalCurve(c, t));
  assert.deepStrictEqual(M.mixWeights(2), [512, 512]);                    // 1 / (1 - 1/2) = 2
  // FUN_003eb544 per sample (hand values): 1000 x 256 / 512 = 500; 1000 / -1 -> -256000 -> low 16 bits 0x1800 = 6144 (the
  // wrap); 100 / -1 -> -25600 (fits); 256 x 65536 / 0x8000 (-32768) = -512, >> 8 = -2; paddsh saturates; a weight 0 skips the mix
  assert.strictEqual(M.mixPart(1000, 512), 500);
  assert.strictEqual(M.mixPart(1000, 0xffff), 6144);
  assert.strictEqual(M.mixPart(100, 0xffff), -25600);
  assert.strictEqual(M.mixPart(256, 0x8000), -2);
  assert.strictEqual(M.mixSample(30000, 30000, 256, 256), 0x7fff);
  assert.strictEqual(M.mixSample(1234, 999, 0, 256), 1234);
  assert.strictEqual(M.mixGain(0x8000), -1 / 128);                        // a negative weight that cannot wrap: a gain
  assert.strictEqual(M.mixGain(0xff80), null);                            // -128: x 2 would wrap
  assert.strictEqual(M.mixGain(0x7fff), 256 / 0x7fff);                   // the last frame: old nearly gone
  assert.strictEqual(M.mixGain(0x100), 1);
  const a = { ctx: new Ctx() }, m = new M.GameMusic(a, 'x/');
  m.meta = { ...META, bgm_012: { ...META.bgm_001, file: 'bgm_012.flac' } };
  globalThis.fetch = fetchOk();
  const old = await m.playMusic3('bgm_001', 0, 0);
  const x = await m.playMusic3('bgm_012', 0, 100);
  a.ctx.currentTime = 0.7; m.pump();                // worker 0271: T = 100 ms after the frames heard ~0.49 s on (the ring)
  assert.strictEqual(m.src, x, 'after T the new stream is the main one (DAT_004fab80 = DAT_004fab84)');
  assert.strictEqual(m.name, 'bgm_012');
  assert.ok(old.stopped, 'the old stream is stopped after the last mixed frame');
  m.stopMusic();
});

await t('GameMusic changeMusicVol (FUN_003ed740): linear offset ramp per decoded frame, clamped to 0..63', async () => {
  const r = new M.MusicRamp();
  r.set(3, 2500, 1000);
  assert.deepStrictEqual([1000, 2000, 3000, 3499, 3500].map((t) => r.apply(t, 0)), [0, 1, 2, 2, 3]);
  assert.strictEqual(r.active, false);
  r.set(99, 100, 0); assert.strictEqual(r.to, 0x3f);
  r.set(-1, 0, 0); assert.strictEqual(r.active, false);
  const a = { ctx: new Ctx() }, m = new M.GameMusic(a, 'x/');
  m.meta = META;
  globalThis.fetch = fetchOk();
  const src = await m.playMusic3('bgm_001', 0, 0);
  a.ctx.currentTime = 1; m.changeMusicVol(3, 1000); a.ctx.currentTime = 1.7; m.pump();   // worker 0271: frames heard ~0.47 s after their mix (pcm_ring.js)
  const last = src.to.gain.auto[src.to.gain.auto.length - 1];
  assert.ok(last[1] < 1 && last[1] > M.sfGain(3), 'ramping down: ' + last[1]);
  a.ctx.currentTime = 2.5; m.pump();
  assert.strictEqual(src.to.gain.auto[src.to.gain.auto.length - 1][1], M.sfGain(3));
  m.stopMusic();
});

await t('GameMusic: vol != 0 with no stream open plays with the decoder offset (sfGain 2^(-vol / 3))', async () => {
  const a = { ctx: new Ctx() }, m = new M.GameMusic(a, 'x/');
  m.meta = META;
  globalThis.fetch = fetchOk();
  const src = await m.playMusic3('bgm_001', 3, 0);
  assert.ok(src);
  assert.strictEqual(src.to.gain.value, 0.5);
  m.stopMusic();
});

await t('GameMusic: a second playMusic3 while the first is loading does nothing (stream already open); stop while loading cancels', async () => {
  const a = { ctx: new Ctx() }, m = new M.GameMusic(a, 'x/');
  m.meta = META;
  globalThis.fetch = fetchOk();
  const [s1, s2] = await Promise.all([m.playMusic3('bgm_001', 0, 4000), m.playMusic3('bgm_001', 0, 4000)]);
  assert.ok(s1); assert.strictEqual(s2, null);
  assert.strictEqual(a.ctx.started.length, 1);
  m.stopMusic();
  const p = m.playMusic3('bgm_001'); m.stopMusic();
  assert.strictEqual(await p, null);
  assert.strictEqual(a.ctx.started.filter((s) => !s.stopped).length, 0);
});

await t('GameMusic: a missing FLAC (404) warns once and resolves null; no stream left open', async () => {
  const a = { ctx: new Ctx() }, m = new M.GameMusic(a, 'x/');
  m.meta = META;
  globalThis.fetch = async () => ({ ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(4) });
  warns.length = 0;
  assert.strictEqual(await m.playMusic3('bgm_001', 0, 4000), null);
  assert.strictEqual(await m.playMusic3('bgm_001', 0, 4000), null);
  assert.strictEqual(warns.length, 1, 'once');
  assert.strictEqual(m.name, null);
  assert.strictEqual(a.ctx.started.length, 0);
});

await t('GameMusic.load: fetches bgm.json only when se_zNNN.json declares "bgm" (no failing request without the data)', async () => {
  const calls = [];
  globalThis.fetch = fetchOk(calls);
  const m0 = new M.GameMusic({ ctx: new Ctx(), ready: Promise.resolve(), se: { names: {} } }, 'x/');
  await assert.rejects(m0.load(128));
  assert.deepStrictEqual(calls, []);
  assert.strictEqual(m0.meta, null);
  const m1 = new M.GameMusic({ ctx: new Ctx(), ready: Promise.resolve(), se: { names: {}, bgm: ['bgm_001'] } }, 'x/');
  await m1.load(128);
  assert.deepStrictEqual(calls, ['x/bgm.json']);
  assert.ok(m1.meta.bgm_001);
  const m2 = new M.GameMusic({ ctx: new Ctx(), ready: Promise.reject(new Error('no SE')) }, 'x/');
  await assert.rejects(m2.load(128));
  assert.deepStrictEqual(calls, ['x/bgm.json']);
});

await t('AreaSound.stop (FUN_003e65b0) stops the chunks already scheduled', () => {
  const a = au(), s = new M.AreaSound(a);
  s.play('asj_033');
  const st = a.ctx.started.slice();
  assert.ok(st.length >= 8, '2 s ahead');
  s.stop();
  assert.ok(st.every((x) => x.stopped));
});

if (have('bgm/bgm.json')) {
  await t('bgm.json z128 bgm_001: sdb loop 6696 -> 14944, seam frames after the end', () => {
    const j = JSON.parse(fs.readFileSync(D + 'bgm/bgm.json')).z128.bgm_001;
    assert.strictEqual(j.start, 6696); assert.strictEqual(j.end, 14944); assert.strictEqual(j.rate, 48000);
    assert.strictEqual(j.loop_start_sample, (6696 + j.seam) * 1024);
    assert.strictEqual(j.loop_end_sample, (14944 + j.seam) * 1024);
    assert.strictEqual(j.samples, j.loop_end_sample);
  });
} else { skip++; console.log('SKIP bgm.json (python3 -I tools/audio/bgm.py)'); }

if (have('se_z128.json') && have('wave0000.json')) {
  await t('asj_033 (SE 10011) streams: endless, sounds, the first 4 s equal the offline render', () => {
    const d = JSON.parse(fs.readFileSync(D + 'driver.json')), se = JSON.parse(fs.readFileSync(D + 'se_z128.json'));
    const info = JSON.parse(fs.readFileSync(D + 'wave0000.json'));
    const b = { instruments: info.instruments, data: new Uint8Array(fs.readFileSync(D + 'wave0000.bin')) };
    assert.strictEqual(se.names.asj_033.id, 10011);
    const prog = A.hexBytes(se.programs['10011']);
    const off = new A.SeRenderer(d, b).render(prog, 0x7f, 0x40, 4);
    const s = new M.SeStream(d, b, prog, 0x7f, 0x40);
    const L = new Float32Array(off.left.length); let o = 0;
    while (o < L.length) { const p = s.ticks(60); L.set(p.left.subarray(0, L.length - o), o); o += p.left.length; }
    assert.deepStrictEqual(L, off.left);
    for (let i = 0; i < 60; i++) s.ticks(240);
    assert.strictEqual(s.done, false);
  });
} else { skip++; console.log('SKIP asj_033 (python3 -I tools/audio/extract.py)'); }

console.log(pass + ' passed' + (skip ? ', ' + skip + ' skipped' : ''));
