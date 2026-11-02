// test_audio_menu.mjs -- menu sounds and the pause's sound side (worker 0194; notes/audio-research.md "Menu sounds",
// "Pause volume drop"). node native/web/test_audio_menu.mjs
// AUDIO_JS / MUSIC_JS / PAUSE_JS / SE_RES=<path> test other copies (mutation runs). The game-data parts (se_res.json, pause.json,
// the w194_menusnd PCSX2 call log) are skipped when the files are missing.
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const imp = (env, f) => import(pathToFileURL(process.env[env] || path.join(here, f)).href);
const A = await imp('AUDIO_JS', 'audio.js');
const M = await imp('MUSIC_JS', 'music.js');
const P = await imp('PAUSE_JS', 'pause.js');
let pass = 0, skip = 0;
const t = (name, f) => { f(); pass++; console.log('ok', name); };
const ifFile = (files, name, f) => {
  const miss = files.filter((p) => !fs.existsSync(p));
  if (miss.length) { skip++; console.log('skip', name, '(no ' + miss.map((p) => path.relative(here, p)).join(', ') + ')'); return; }
  t(name, f);
};

// ---- FUN_003e9d70 pan and FUN_003cac38 position
t('menuPan: FUN_003e9d70 (no position -> 0x40, x < 0 -> 0x30, x * 32 / 448 + 0x30, clamped at the width)', () => {
  assert.strictEqual(A.menuPan(-1, -1), 0x40);
  assert.strictEqual(A.menuPan(-1, 5), 0x30);
  assert.strictEqual(A.menuPan(0, 0), 0x30);
  assert.strictEqual(A.menuPan(192, 206), 61);     // pause buttons (x 176): w194 trace f101
  assert.strictEqual(A.menuPan(285, 247), 68);     // box CANCEL (x 269): f231
  assert.strictEqual(A.menuPan(143, 247), 58);     // box OK (x 127): f271
  assert.strictEqual(A.menuPan(447, 0), 0x4f);     // 447 * 32 / 448 = 31.93 -> 31 (toward zero)
  assert.strictEqual(A.menuPan(448, 0), 0x50);
  assert.strictEqual(A.menuPan(5000, 0), 0x50);    // x = min(x, width)
  assert.strictEqual(A.menuPan(14, 0), 0x31);      // 14 * 32 / 448 = 1.0 exactly
  assert.strictEqual(A.menuPan(13, 0), 0x30);
});

t('menuWidgetPos: FUN_003cac38 (x + 16, y + h / 2 toward zero)', () => {
  assert.deepStrictEqual(A.menuWidgetPos({ x: 176, y: 194, w: 160, h: 24 }), [192, 206]);
  assert.deepStrictEqual(A.menuWidgetPos({ x: 10, y: 20, w: 1, h: 5 }), [26, 22]);
  assert.deepStrictEqual(A.menuWidgetPos({ x: 10, y: 20, w: 1, h: -5 }), [26, 18]);
});

// ---- the latch FUN_003e1d10 / FUN_003e1d90
const NAMES = Array.from({ length: 34 }, (_, i) => (i ? 'n' + i : null));
const run = (m, now) => { const out = []; m.frame(now, (n, x, y) => { out.push([n, x, y]); return n; }); return out; };

t('MenuSound: the last write of a frame wins; frame plays the table name and clears', () => {
  const m = new A.MenuSound(NAMES);
  m.set(3); m.set(1);
  assert.deepStrictEqual(run(m, 1000), [['n1', -1, -1]]);
  assert.strictEqual(m.pending(), false);
  assert.deepStrictEqual(run(m, 1020), []);
  assert.strictEqual(m.last, 1); assert.strictEqual(m.lastT, 1000);
});

t('MenuSound: FUN_003cb4a8 latches only when forced or nothing is pending (the cursor is not forced)', () => {
  const m = new A.MenuSound(NAMES), w = { x: 176, y: 194, w: 160, h: 24 };
  m.set(4); m.widget(w, 6, false);
  assert.deepStrictEqual(run(m, 0), [['n4', -1, -1]]);
  m.set(4); m.widget(w, 8, true);
  assert.deepStrictEqual(run(m, 0), [['n8', 192, 206]]);
  m.widget(w, 6, false);
  assert.deepStrictEqual(run(m, 0), [['n6', 192, 206]]);
});

t('MenuSound: a box-open 9 within 300 ms of a played 7 / 8 is dropped (last / time kept); not after other ids', () => {
  for (const prev of [7, 8]) {
    const m = new A.MenuSound(NAMES);
    m.set(prev); run(m, 5000);
    m.set(9); assert.deepStrictEqual(run(m, 5299), []);
    assert.strictEqual(m.last, prev); assert.strictEqual(m.lastT, 5000);
    m.set(9); assert.deepStrictEqual(run(m, 5300), [['n9', -1, -1]]);
  }
  for (const prev of [6, 1, 0xff, 10, 0]) {
    const m = new A.MenuSound(NAMES);
    if (prev !== 0xff) { m.set(prev); run(m, 5000); }
    m.set(9); assert.deepStrictEqual(run(m, 5010), [['n9', -1, -1]], 'after ' + prev);
  }
  const m = new A.MenuSound(NAMES); m.set(7); run(m, 5000);
  m.set(4); assert.deepStrictEqual(run(m, 5010), [['n4', -1, -1]]);     // only 9 is dropped
});

t('MenuSound: entry 0 (empty name) sends nothing but counts as played; disabled: nothing, last kept', () => {
  const m = new A.MenuSound(NAMES);
  m.set(0); assert.deepStrictEqual(run(m, 10), []); assert.strictEqual(m.last, 0);
  m.enabled = 0; m.set(3); assert.deepStrictEqual(run(m, 20), []); assert.strictEqual(m.last, 0); assert.strictEqual(m.pending(), false);
});

t('latchMenuSound: 6 / 7 / 8 with a widget take its position, 6 not forced; the others x = y = -1', () => {
  const w = { x: 127, y: 235, w: 116, h: 24 };
  let m = new A.MenuSound(NAMES); A.latchMenuSound(m, 7, w); assert.deepStrictEqual([m.id, m.x, m.y], [7, 143, 247]);
  m = new A.MenuSound(NAMES); A.latchMenuSound(m, 2, w); assert.deepStrictEqual([m.id, m.x, m.y], [2, -1, -1]);
  m = new A.MenuSound(NAMES); m.set(9); A.latchMenuSound(m, 6, w); assert.strictEqual(m.id, 9);
  m = new A.MenuSound(NAMES); m.set(9); A.latchMenuSound(m, 8, w); assert.strictEqual(m.id, 8);
  m = new A.MenuSound(NAMES); A.latchMenuSound(m, null, w); assert.strictEqual(m.pending(), false);
});

// ---- GameAudio with a fake AudioContext: lookup order, request 0x16, the SE hold
class FakeCtx {
  constructor() { this.currentTime = 0; this.sources = []; this.destination = {}; }
  createBuffer(ch, n, rate) { const b = { duration: n / rate, ch: [], copyToChannel(a, i) { b.ch[i] = Float32Array.from(a); } }; return b; }
  createBufferSource() {
    const s = { started: null, stopped: false, connect() {}, start(w, o = 0) { s.started = o; }, stop() { s.stopped = true; } };
    this.sources.push(s); return s;
  }
  createGain() {
    const calls = [];
    return { gain: { value: 1, calls, cancelScheduledValues() { calls.length = 0; }, setValueAtTime(v, at) { calls.push([v, at]); } }, connect() {} };
  }
}
// programs: track count 1, bank 0, priority, flags (prog[4]), one track
const progHex = (flags) => Buffer.from([1, 0, 0, 0xff, flags, 2, 0, 0, 0]).toString('hex');
const fakeAudio = () => {
  const au = new A.GameAudio();
  const calls = [];
  au.ctx = new FakeCtx();
  au.se = { names: { zz: { id: 50 }, both: { id: 51 } }, programs: { 50: progHex(0), 51: progHex(0) } };
  au.res = { names: { msj_000: { id: 1 }, both: { id: 1 } }, programs: { 1: progHex(0x59) } , menu: NAMES };
  au.renderers = { 0: { rngIndex: 0, render(prog, vol, pan) { calls.push({ id: prog[4], vol, pan }); return { left: new Float32Array(4800), right: new Float32Array(4800) }; } } };
  return { au, calls };
};

t('GameAudio: sdb slot 0 (resident) before the zone, programs from both blocks; playMenu sends 0x7f at the pan', () => {
  const { au, calls } = fakeAudio();
  assert.strictEqual(au.seIdOf('both'), 1);
  assert.strictEqual(au.seIdOf('zz'), 50);
  assert.strictEqual(au.seIdOf('nope'), 0);
  assert.ok(au.program(1) && au.program(50));
  assert.deepStrictEqual(au.playMenu('msj_000', 192, 206), { name: 'msj_000', id: 1, pan: 61 });
  assert.deepStrictEqual(calls.at(-1), { id: 0x59, vol: 0x7f, pan: 61 });
  const n = calls.length;
  au.playMenu('nope'); assert.strictEqual(calls.length, n);                 // id 0: nothing sent
});

t('GameAudio: while paused requests 2 / 0x16 send vol >> 3, 0x17 does not; flag 8 programs still play at 0x7f', () => {
  const { au, calls } = fakeAudio();
  au.setPaused(true);
  au.playId(50, 0x7f, 0x40, 2); assert.strictEqual(calls.at(-1).vol, 15);
  au.playId(1, 0x7f, 0x40, 0x16); assert.strictEqual(calls.at(-1).vol, 15);
  au.playId(51, 0x7f, 0x40, 0x17); assert.strictEqual(calls.at(-1).vol, 0x7f);
  au.setPaused(false);
  au.playId(50, 0x7f, 0x40, 2); assert.strictEqual(calls.at(-1).vol, 0x7f);
  // FUN_000082d0: program flag 8 forces the sequence volume to 0x7f (the menu programs: 0x58 / 0x59)
  const rd = new A.SeRenderer({ rng: new Array(256).fill(0) }, { instruments: [], data: new Uint8Array(16) });
  rd.start(Uint8Array.from([1, 0, 0, 0, 0x58, 2, 0, 0, 0]), 15, 0x40); assert.strictEqual(rd.tracks[0].seqVol, 0x7f << 12);
  rd.start(Uint8Array.from([1, 0, 0, 0, 0x50, 2, 0, 0, 0]), 15, 0x40); assert.strictEqual(rd.tracks[0].seqVol, 15 << 12);
});

t('GameAudio.setPaused: IOP command 6 holds SEs with flag byte & 0xc0 == 0 at their offset, resumes there', () => {
  const { au } = fakeAudio();
  au.res.programs[2] = progHex(0x80); au.res.programs[3] = progHex(0x40);
  au.playId(50); au.playId(2); au.playId(3);
  const [a, b, c] = au.ctx.sources;
  au.ctx.currentTime = 0.04;
  au.setPaused(true);
  assert.deepStrictEqual([a.stopped, b.stopped, c.stopped], [true, false, false]);
  au.setPaused(true);                                                     // again: no change
  assert.strictEqual(au.ctx.sources.length, 3);
  au.ctx.currentTime = 7;
  au.setPaused(false);
  assert.strictEqual(au.ctx.sources.length, 4);
  assert.ok(Math.abs(au.ctx.sources[3].started - 0.04) < 1e-9);
  au.setPaused(false);
  assert.strictEqual(au.ctx.sources.length, 4);
});

// ---- the BGM volume (IOP FUN_00010394 / FUN_00010328) and GameMusic.setVolume
t('BgmVolume: pause 0x30 from the save state value lands on the paused save (cur 0x30ff804, step -0x3f3333)', () => {
  const v = new M.BgmVolume();
  assert.strictEqual(v.cur, 0x7fff800); assert.strictEqual(v.reg, 0x7fff);
  v.set(0x14, 0x30);
  assert.strictEqual(v.step, -0x3f3333); assert.strictEqual(v.count, 20);
  const regs = [];
  for (let i = 0; i < 25; i++) { v.tick(); regs.push(v.reg); }
  assert.strictEqual(v.cur, 0x30ff804); assert.strictEqual(v.count, 0);
  assert.strictEqual(regs[0], (0x7fff800 - 0x3f3333) >> 12);
  assert.strictEqual(regs[19], 0x30ff); assert.strictEqual(regs[24], 0x30ff);
  v.set(0x14, 0x7f);
  for (let i = 0; i < 20; i++) v.tick();
  assert.strictEqual(v.cur, 0x7fff800);
  v.set(0, 0x10); assert.strictEqual(v.cur, 0x10ff000); assert.strictEqual(v.count, 0);
  v.set(0x14, 0); for (let i = 0; i < 20; i++) v.tick(); assert.strictEqual(v.reg, 0);   // vol 0: target 0 | 0x800
});

t('GameMusic.setVolume: waits for a stream, then 20 gain steps at 240 Hz; a new command mid-ramp starts there', () => {
  const ctx = new FakeCtx();
  const mu = new M.GameMusic({ ctx });
  mu.setVolume(0x30);
  assert.strictEqual(mu.pendingVol, 0x30);                                // no stream: FUN_003ed8e0 does not send
  mu.src = {}; mu.gain = ctx.createGain();
  ctx.currentTime = 10;
  mu.setVolume(0x30);
  const c = mu.gain.gain.calls;
  assert.strictEqual(c.length, 21);
  assert.deepStrictEqual(c[0], [0x7fff / 32768, 10]);
  assert.ok(Math.abs(c[20][1] - (10 + 20 / 240)) < 1e-9);
  assert.strictEqual(c[20][0], 0x30ff / 32768);
  assert.strictEqual(c[1][0], ((0x7fff800 - 0x3f3333) >> 12) / 32768);
  ctx.currentTime = 10 + 10.5 / 240;                                      // resume after 10 driver ticks
  mu.setVolume(0x7f);
  const v = new M.BgmVolume(); v.set(0x14, 0x30); for (let i = 0; i < 10; i++) v.tick();
  assert.strictEqual(c[0][0], v.reg / 32768);
  assert.strictEqual(c.at(-1)[0], 0x7fff / 32768);
});

const openErr = await (async () => {
  const ctx = new FakeCtx();
  ctx.decodeAudioData = async () => ({});
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(4) });
  try {
    for (const [openAt, mid] of [[11.0, false], [10.5 + 5.5 / 240, true]]) {
      const mu = new M.GameMusic({ ctx });
      mu.meta = { bgm_001: { file: 'x.flac', rate: 48000 } };
      mu.src = {}; mu.gain = ctx.createGain(); mu.name = 'bgm_001';
      ctx.currentTime = 10; mu.setVolume(0x30);                       // pause
      ctx.currentTime = 10.5; mu.setVolume(0x7f);                     // resume: the ramp 0x30ff -> 0x7fff starts
      mu.stopMusic();
      ctx.currentTime = openAt;
      await mu.open('bgm_001', 0);
      const g = mu.gain.gain;
      const v = new M.BgmVolume(); v.set(0x14, 0x30); for (let i = 0; i < 20; i++) v.tick(); v.set(0x14, 0x7f);
      if (!mid) {
        assert.strictEqual(g.value, 0x7fff / 32768, 'full volume after the ramp');
      } else {
        for (let i = 0; i < 5; i++) v.tick();
        assert.strictEqual(g.value, v.reg / 32768, 'mid-ramp value at open');
        const last = g.calls.at(-1);
        assert.strictEqual(last[0], 0x7fff / 32768);
        assert.ok(Math.abs(last[1] - (10.5 + 20 / 240)) < 1e-9, 'the remaining steps on the ramp clock');
        assert.strictEqual(g.calls.length, 1 + 15);
      }
    }
  } catch (e) { return e; } finally { globalThis.fetch = savedFetch; }
  return null;
})();
t('GameMusic: pause, resume, then open() a track: the gain is the IOP volume then (full after the ramp; mid-ramp: the rest scheduled)', () => { if (openErr) throw openErr; });

// ---- game data: the id -> name table, the resident bank, and the w194 PCSX2 call log
const DATA = process.env.SE_RES || path.join(here, 'data/audio/se_res.json'), PJSON = path.join(here, 'data/pause.json');
const TRACE = path.join(here, '../../tools/trace/out/w194_menusnd.calls.jsonl');
const res = fs.existsSync(DATA) ? JSON.parse(fs.readFileSync(DATA)) : null;

ifFile([DATA], 'se_res.json: pause.js SE ids -> FUN_003e1d90 names -> resident SE ids (flag 0x40 / 0x08 set)', () => {
  const want = { pause: ['msj_008', 9], unpause: ['msj_009', 10], open: ['msj_004', 5], close: ['msj_005', 6],
    cursor: ['msj_000', 1], confirm: ['msj_003', 4], cancel: ['msj_002', 3] };
  for (const [k, [name, id]] of Object.entries(want)) {
    assert.strictEqual(res.menu[P.SE[k]], name, k);
    assert.strictEqual(res.names[name].id, id, name);
    const prog = A.hexBytes(res.programs[String(id)]);
    assert.ok((prog[4] & 0xc0) && (prog[4] & 8), name + ' flags');
  }
  assert.strictEqual(res.menu[9], 'msj_003');
  assert.strictEqual(res.menu[0], null);
});

const Z = path.join(here, 'data/audio/se_z128.json'), DRV = path.join(here, 'data/audio/driver.json'), WJ = path.join(here, 'data/audio/wave0000.json');
ifFile([Z, DRV, WJ], 'SE hold on a voice mid-decay (IOP ADSR 0x7fff / 0x5fff): decay -> sustain at the hold tick; the render before it unchanged', () => {
  const drv = JSON.parse(fs.readFileSync(DRV)), z = JSON.parse(fs.readFileSync(Z));
  const bank = { instruments: JSON.parse(fs.readFileSync(WJ)).instruments, data: new Uint8Array(fs.readFileSync(path.join(here, 'data/audio/wave0000.bin'))) };
  const T = TICKS => ({ L: new Float32Array(TICKS * 200), R: new Float32Array(TICKS * 200) });
  let found = null;
  for (const [id, hex] of Object.entries(z.programs)) {
    const prog = A.hexBytes(hex);
    if (prog[1] | prog[2] << 8) continue;
    const rd = new A.SeRenderer(drv, bank); rd.start(prog, 0x7f, 0x40);
    const b = T(480);
    for (let t = 0; t < 480; t++) {
      const v = rd.tracks.filter((k) => k.active).map((k) => k.voices.filter((x) => !x.pair).at(-1)).find((x) => x && x.phase === 2);
      if (v && t > 2) { found = { id, prog, t }; break; }
      if (rd.tick(t, b.L, b.R, t * 200)) break;
    }
    if (found) break;
  }
  assert.ok(found, 'some z128 SE has a voice in decay');
  const a = new A.SeRenderer(drv, bank).render(found.prog, 0x7f, 0x40);
  const h = new A.SeRenderer(drv, bank).render(found.prog, 0x7f, 0x40, 8, [found.t]);
  const at = found.t * 200;
  for (let i = 0; i < at; i++) assert.strictEqual(h.left[i], a.left[i], 'before the hold tick');
  let diff = 0; for (let i = at; i < Math.min(a.left.length, h.left.length); i++) if (a.left[i] !== h.left[i]) diff++;
  assert.ok(diff > 0 || a.left.length !== h.left.length, 'the skipped decay changes the rest');
  const rd = new A.SeRenderer(drv, bank); rd.start(found.prog, 0x7f, 0x40);
  const b = T(found.t);
  for (let t = 0; t < found.t; t++) rd.tick(t, b.L, b.R, t * 200);
  const before = rd.voices.map((v) => v.phase);
  rd.holdVoices();
  const after = rd.voices.map((v) => v.phase);
  assert.ok(before.some((p, i) => p === 2 && after[i] === 3), 'a decay voice went to sustain');
  assert.ok(before.every((p, i) => p === after[i] || (p === 2 && after[i] === 3)), 'nothing else changed');
  console.log(`   (SE ${found.id}: decay at tick ${found.t}, ${diff} samples differ after it)`);
});

// GameAudio on the real bank: every hold kept (p.holds), a re-render only when a hold lands in a decay
const realAudio = () => {
  const drv = JSON.parse(fs.readFileSync(DRV)), z = JSON.parse(fs.readFileSync(Z));
  const bank = { instruments: JSON.parse(fs.readFileSync(WJ)).instruments, data: new Uint8Array(fs.readFileSync(path.join(here, 'data/audio/wave0000.bin'))) };
  const au = new A.GameAudio();
  au.ctx = new FakeCtx(); au.drv = drv; au.banks = { 0: bank }; au.renderers = { 0: new A.SeRenderer(drv, bank) }; au.se = z; au.res = null;
  return { au, drv, bank, z };
};
// pause at SE tick h (offset (h + 0.5) / 240 from the SE's clock), resume 3 s later
const holdAt = (au, p, h) => { au.ctx.currentTime = p.at + (h + 0.5) / A.TICK_HZ; au.setPaused(true); au.ctx.currentTime += 3; au.setPaused(false); };
const same = (b, out) => b.ch[0].length === out.left.length && b.ch[0].every((x, i) => x === out.left[i]);

ifFile([Z, DRV, WJ], 'two pauses on one SE: both holds applied (the first is not dropped by the second re-render)', () => {
  const { au, drv, bank, z } = realAudio();
  // an SE with two decay ticks h1 < h2 where the first hold still matters after the second
  let hit = null;
  for (const [id, hex] of Object.entries(z.programs)) {
    const prog = A.hexBytes(hex);
    if (prog[1] | prog[2] << 8) continue;
    const r1 = new A.SeRenderer(drv, bank).render(prog, 0x7f, 0x40);
    const h1 = r1.decay.indexOf(1, 3);
    if (h1 < 0) continue;
    const r2 = new A.SeRenderer(drv, bank).render(prog, 0x7f, 0x40, 8, [h1]);
    const h2 = r2.decay.indexOf(1, h1 + 20);
    if (h2 < 0) continue;
    const both = new A.SeRenderer(drv, bank).render(prog, 0x7f, 0x40, 8, [h1, h2]);
    const only2 = new A.SeRenderer(drv, bank).render(prog, 0x7f, 0x40, 8, [h2]);
    if (both.left.length === only2.left.length && both.left.every((x, i) => x === only2.left[i])) continue;
    hit = { id: +id, h1, h2, both }; break;
  }
  assert.ok(hit, 'some z128 SE decays twice');
  au.renderers[0].rngIndex = 0;
  au.playId(hit.id);
  const p = au.playing.at(-1);
  holdAt(au, p, hit.h1);
  holdAt(au, p, hit.h2);
  assert.deepStrictEqual(p.holds, [hit.h1, hit.h2]);
  assert.strictEqual(au.rerenders, 2);
  assert.ok(same(p.buf, hit.both), 'the buffer is the render with both holds');
  console.log(`   (SE ${hit.id}: holds at ticks ${hit.h1} and ${hit.h2})`);
});

ifFile([Z, DRV, WJ], 'a hold outside any decay does no re-render (the same buffer restarts at its offset)', () => {
  const { au } = realAudio();
  au.playId(1040);                                                      // bsj_051, Vincent's shot
  const p = au.playing.at(-1), buf0 = p.buf;
  const h = Array.from(p.decay).findIndex((d, i) => i > 2 && !d);
  assert.ok(h > 0);
  holdAt(au, p, h);
  assert.strictEqual(au.rerenders || 0, 0);
  assert.strictEqual(p.buf, buf0);
  assert.deepStrictEqual(p.holds, [h]);
  assert.ok(Math.abs(au.ctx.sources.at(-1).started - (h + 0.5) / A.TICK_HZ) < 1e-9);
});

// the w194_menusnd script on the page's pause flow: frame f = f * 20 ms (PAL, one pad poll a frame)
const SCRIPT = [[60, 'start'], [100, 3], [130, 2], [170, 0], [230, 4], [270, 1], [320, 1]];
const EXPECT = [[61, 'msj_008', -1, -1, 9, 64], [101, 'msj_000', 192, 206, 1, 61], [131, 'msj_000', 192, 232, 1, 61],
  [171, 'msj_003', -1, -1, 4, 64], [231, 'msj_000', 285, 247, 1, 68], [271, 'msj_002', 143, 247, 3, 58],
  [321, 'msj_009', -1, -1, 10, 64]];

ifFile([DATA, PJSON], 'pause flow -> latch -> FUN_003e1d90 -> request: the w194 sequence (names, positions, SE ids, pans) and the pause / resume', () => {
  const D = P.loadPauseData(JSON.parse(fs.readFileSync(PJSON)));
  const flow = new P.PauseFlow(D), m = new A.MenuSound(res.menu);
  const { au, calls } = fakeAudio(); au.res = res; au.se = { names: {}, programs: {} };
  const out = [], pauses = [];
  let active = false;
  for (let f = 0; f < 400; f++) {
    const now = f * 20;
    for (const [sf, a] of SCRIPT) if (sf === f) {
      if (a === 'start') flow.start(now); else flow.input(a, now, 0);
      A.latchMenuSound(m, flow.lastSE, flow.lastSEW); flow.lastSE = null; flow.lastSEW = null;
    }
    flow.frame(now);
    if (flow.active !== active) { active = flow.active; pauses.push([f, active]); au.setPaused(active); }
    m.frame(now, (n, x, y) => { const r = au.playMenu(n, x, y); out.push([f + 1, n, x, y, r.id, r.pan]); });
  }
  assert.deepStrictEqual(out, EXPECT);
  assert.ok(calls.every((c) => (c.id & 8) !== 0));                        // every menu program forces 0x7f
  // the game: pause on f61 (the start press f60 seen one frame later), resume f326 after the 100 ms close
  assert.deepStrictEqual(pauses.map(([f, a]) => [f - pauses[0][0], a]), [[0, true], [326 - 61, false]]);
});

ifFile([TRACE], 'w194_menusnd call log (PCSX2): the same sequence, sent at vol 0x7f >> 3 while paused; 0x30 / 0x7f BGM sends', () => {
  const L = fs.readFileSync(TRACE, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((e) => e.hook);
  const name = (e) => Buffer.from(e['a0+0x0'].u.map((h) => { const b = Buffer.alloc(4); b.writeUInt32LE(parseInt(h, 16) >>> 0); return b; }).reduce((a, b) => Buffer.concat([a, b]))).toString('latin1').split('\0')[0];
  const plays = L.filter((e) => e.hook === 'menu_play').map((e) => [e.frame, name(e), e.a1, e.a2]);
  const reqs = L.filter((e) => e.hook === 'menu_req').map((e) => [e.frame, e.a1, e.a2, e.a3]);
  const sends = L.filter((e) => e.hook === 'se_send').map((e) => [e.frame, parseInt(e['a0+0x8'].u[0], 16), e.a1, e.a2]);
  assert.deepStrictEqual(plays, EXPECT.map(([f, n, x, y]) => [f, n, x, y]));
  assert.deepStrictEqual(reqs, EXPECT.map(([f, , , , id, pan]) => [f + 1, id, pan, 0x7f]));
  assert.deepStrictEqual(sends, EXPECT.map(([f, , , , id, pan]) => [f + 1, id, pan, 0x7f >> 3]));   // paused the whole time
  assert.deepStrictEqual(L.filter((e) => e.hook === 'bgm_vol').map((e) => [e.frame, e.a0]), [[61, 0x30], [326, 0x7f]]);
  assert.deepStrictEqual(L.filter((e) => e.hook === 'bvol_send').map((e) => [e.frame, e.a0, e.a1]), [[61, 0x14, 0x30], [326, 0x14, 0x7f]]);
  assert.deepStrictEqual(L.filter((e) => e.hook === 'se_pause').map((e) => [e.frame, e.a1]), [[61, 1], [326, 0]]);
});

console.log(`test_audio_menu: ${pass} passed, ${skip} skipped`);
