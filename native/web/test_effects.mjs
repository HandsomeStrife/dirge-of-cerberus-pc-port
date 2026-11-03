// node native/web/test_effects.mjs
// Checks effects.js (the FED particle engine, worker 0179) against the game.
// Needs data/effects (python3 -I native/assets/models/export_web_effects.py). The game-derived parts
// need tools/trace/out/w179_fx/ (gitignored; notes/effects-research.md "Evidence"):
//   state1..5.json  emitters / particles / camera read from five PCSX2 save states taken during
//                   tools/trace/scripts/w172_sound3.json (frames 837 / 875 / 914 / 956 / 998)
//   dump1/4.json    the effect-texture triangles of the GS dumps taken next to states 1 and 4 (the dump
//                   frame is 4 game frames after its state: PCSX2 starts the dump late)
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEffects, EffectRng, wallImpactId, parseFed, parseCore, _internals, screenClip } from './effects.js';

const here = dirname(fileURLToPath(import.meta.url));
const rd = p => { const b = readFileSync(p); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
const dataDir = join(here, 'data/effects');
if (!existsSync(join(dataDir, 'r0001.fed'))) { console.log('SKIP: no data/effects (run export_web_effects.py)'); process.exit(0); }
const fed = rd(join(dataDir, 'r0001.fed')), core = rd(join(dataDir, 'core_ef.bin'));
const ids = JSON.parse(readFileSync(join(dataDir, 'ids.json'), 'utf8'));
const f = Math.fround;
let fails = 0, checks = 0;
const ok = (what, cond, info = '') => { checks++; if (!cond) { fails++; console.log('FAIL', what, info); } };

// --- static: the file, the pack, the call-site tables
{
  const F = parseFed(fed);
  ok('FED code 0x40000', F.code === 0x40000);
  // FUN_002e62b0: 0x43400 -> group 13 -> emitter 12 (wall impact, materials 0 / 2 / 7 / 12)
  ok('group 13 -> emitter 12', F.u16(F.groupOf(13) + 8) === 12);
  ok('hit 0x40c00 -> emitter 3', F.u16(F.groupOf((0x40c00 >> 10) & 0x7f) + 8) === 3);
  const tex = parseCore(core);
  ok('27 effect textures', tex.size === 27);
  const t = tex.get('4007bd06:613137c0');
  ok('TEX0 0x4007bd06613137c0 = 256 x 512 ST space', t && t.W === 256 && t.H === 512);
  ok('wall id material 2 (wall)', wallImpactId(ids, 2, [0, 0, 1]) === 0x43400);
  ok('wall id material 1 (wall)', wallImpactId(ids, 1, [1, 0, 0]) === 0x46400);
  ok('wall table: material 1 floor (FUN_00260c38: y < -0.9f) = 0x47400', ids.wall[3] === 0x47400);
  // FUN_00260c38 on the game's normal (y down; play.js roomRay negates the page's: MEASURED, effects.js floorHit):
  // a floor (n.y < -0.9f) takes [mat x 2 + 1], a ceiling the wall id (more in test_effects_hooks.mjs)
  ok('wall id: floor (n.y = -0.95) -> 0x47400, ceiling (0.95) -> 0x46400', wallImpactId(ids, 1, [0, -0.95, 0]) === 0x47400 &&
    wallImpactId(ids, 1, [0, 0.95, 0]) === 0x46400);
  ok('wall id: y = -0.9 is a wall', wallImpactId(ids, 1, [0, -0.9, 0]) === 0x46400);
  ok('hit id: weapon class 3', ids.hit[3] === 0x40c00);
}

// --- FUN_002d82d0 order 0 = FUN_002d7ff0: in . Rz . Ry . Rx (+ pos), 4096 units a turn (decode check:
// no captured particle turns about more than one axis)
{
  const m = _internals.eulerT(_internals.scaleM([1, 1, 1]), [1024, 0, 1024], [5, 6, 7], 0);
  ok('Euler orders 1-5 (not translated) -> null', [1, 2, 3, 4, 5].every(o => _internals.eulerT(_internals.scaleM([1, 1, 1]), [0, 0, 0], [0, 0, 0], o) === null));
  const want = [0, 0, 1, 0, -1, 0, 0, 0, 0, -1, 0, 0, 5, 6, 7, 1];
  ok('Euler order Z, Y, X', want.every((x, i) => Math.abs(m[i] - x) < 1e-6), JSON.stringify(Array.from(m).map(x => +x.toFixed(3))));
}

// --- close to the eye: the depth matrix pulls these sprites 3 units nearer, so within 3 units their GS Z
// is negative and the program drops them (FCAND 0x810). That is also why the near fade (VU1 0x3f5, below
// view depth 2) never acts on the translated sprites: it is decoded but unexercised.
{
  const col = depth => {
    const fx = createEffects({ fed, core, warn: () => {}, rng: new EffectRng(1) });
    fx.begin(1.2); fx.spawn(0x43400, [0, 0, depth]); fx.end();
    for (let i = 0; i < 5; i++) fx.update(1.2);
    const s = fx.sprites({ toView: p => p.slice(0, 3) }).find(x => x.alpha === 0x44);
    return s ? s.verts[0].rgba : null;
  };
  const near = col(0.8), far = col(30);           // particle 0 sits within 2 units of its emitter
  ok('sprites within 3 units of the eye are dropped', near === null && far !== null, `${near} ${far}`);
}

// --- the LCG (FUN_002d98c8): x / z draws of emitter 12's particle 0 from a known state
{
  let inv = 1; for (let i = 0; i < 5; i++) inv = Math.imul(inv, (2 - Math.imul(0x41c64e6d, inv)) >>> 0) >>> 0;
  const r = new EffectRng(Math.imul((0x77a9 - 0x3039) >>> 0, inv) >>> 0);    // next() = 0x77a9
  const x = r.signed(4); r.signed(0); const z = r.signed(4);
  ok('LCG draws', Math.abs(x - 3.478750705718994) < 1e-6 && Math.abs(z - 1.3005337715148926) < 1e-6, `${x} ${z}`);
}

// --- a spawn with no game data: emitter 12 lives 64 frames, its particles die by life
{
  const fx = createEffects({ fed, core, warn: () => {}, twister: ids.twister, rand: ids.rand ?? 1 });
  fx.begin(1.2); const em = fx.spawn(0x43400, [0, 0, 0]); fx.end();
  ok('spawn returns the emitter', !!em && em.ei === 12);
  ok('spawned in the logic phase: age 0, five particles', em.age === 0 && em.lists[1].length === 5);
  for (let i = 0; i < 20; i++) fx.update(1.2);
  ok('particle 1 (life 17) is gone by age 24', !em.lists[1].some(p => p.tag === 1));
  for (let i = 0; i < 40; i++) fx.update(1.2);
  ok('emitter removed at its duration (64)', !fx.emitters.includes(em));
  ok('unknown id: no emitter', fx.spawn(0x80000, [0, 0, 0]) === null);
}

// --- the untranslated paths are not drawn (warned): emitter param +0x1d != 0, the emitter fade, a particle's
// rotation order != 0
{
  const run = mut => {
    const w = [], fx = createEffects({ fed, core, warn: m => w.push(m), rng: new EffectRng(1) });
    fx.begin(1.2); const em = fx.spawn(0x43400, [0, 0, 30]); fx.end();
    mut(em, fx);
    for (let i = 0; i < 3; i++) fx.update(1.2);
    return { n: fx.sprites({ toView: p => p.slice(0, 3) }).length, w };
  };
  ok('baseline: emitter 12 draws', run(() => {}).n > 0);
  const fade = run(em => { em.fade = 0; });
  ok('emitter fade (+0x28): not drawn, warned', fade.n === 0 && fade.w.some(m => m.includes('emitter fade')));
  const ord = run(em => { for (const p of em.lists[1]) p.noDraw = 'rotation order 1 (FUN_002d82d0 case 1)'; });
  ok('particle rotation order != 0: not drawn, warned', ord.n === 0 && ord.w.some(m => m.includes('rotation order')));
  // param +0x1d: a copy of the FED with emitter 12's param record byte +0x1d set
  const b = fed.slice(0), F = parseFed(b), g = F.groupOf(13), param = g + F.u32(g + 0x20 + 4 * (0x43400 & 0x1ff));
  const draw = (mode, buf) => {
    new Uint8Array(buf)[param + 0x1d] = mode;
    const w = [], fx = createEffects({ fed: buf, core, warn: m => w.push(m), rng: new EffectRng(1) });
    fx.begin(1.2); fx.spawn(0x43400, [0, 0, 30]); fx.end(); fx.update(1.2);
    return { sp: fx.sprites({ toView: p => p.slice(0, 3) }), w };
  };
  // FUN_002e7cd0: mode 1 without an attached object (+0x30 == 0, as every page spawn) is the mode-0 matrix
  const m0 = draw(0, fed.slice(0)), m1 = draw(1, b);
  ok('emitter param +0x1d == 1 (nothing attached): the same sprites as mode 0 (FUN_002e7cd0 falls through)',
    m1.sp.length > 0 && JSON.stringify(m1.sp.map(s => s.verts)) === JSON.stringify(m0.sp.map(s => s.verts)) && !m1.w.some(m => m.includes('+0x1d')));
  const m2 = draw(2, fed.slice(0));
  ok('emitter param +0x1d == 2 (bone matrix FUN_00269530): not drawn, warned', m2.sp.length === 0 && m2.w.some(m => m.includes('+0x1d')));
}

// --- no effect twister (ids.json without `twister`: export_web_effects.py run without --state): one warning,
// no spark lines, the sprites still drawn (worker 0188 review)
{
  const w = [], fx = createEffects({ fed, core, warn: m => w.push(m), twister: null, rand: ids.rand ?? 1 });
  let lines = 0, sprites = 0;
  fx.begin(1.2); fx.spawn(0x43400, [0, 0, 30]); fx.end();
  for (let i = 0; i < 6; i++) { fx.update(1.2); const out = fx.sprites({ toView: p => p.slice(0, 3), toViewMatrix: () => _internals.scaleM([1, 1, 1]) }); lines += out.filter(s => s.line).length; sprites += out.filter(s => !s.line).length; }
  ok('no twister: a warning at load, no spark lines, sprites still drawn', w.some(m => m.includes('no effect twister')) && lines === 0 && sprites > 0, `${w.length} warnings, ${lines} lines, ${sprites} sprites`);
}

// --- no rand() state (an ids.json exported before `rand`): the frame reseed cannot run, so the page's engine
// spawns nothing, with one warning; a caller's own rng (tests) runs on, warned
{
  const w = [], fx = createEffects({ fed, core, warn: m => w.push(m), twister: ids.twister });
  fx.begin(1.2); const em = fx.spawn(0x43400, [0, 0, 30]); fx.end();
  ok('no rand: one warning, nothing spawned', em === null && fx.emitters.length === 0 && w.filter(m => m.includes('no rand() state')).length === 1 && w.some(m => m.includes('left out')), JSON.stringify(w));
  const w2 = [], fx2 = createEffects({ fed, core, warn: m => w2.push(m), rng: new EffectRng(1) });
  fx2.begin(1.2); const em2 = fx2.spawn(0x43400, [0, 0, 30]); fx2.end();
  ok('no rand, a given rng: spawns, warned', em2 !== null && w2.some(m => m.includes('runs on unreseeded')));
  const fx3 = createEffects({ fed, core, warn: () => {}, twister: ids.twister, rand: ids.rand ?? 1 });
  fx3.begin(1.2); ok('with rand: spawns', fx3.spawn(0x43400, [0, 0, 30]) !== null); fx3.end();
}

// --- type 17's transition FUN_002eccc8 (x y z w; FUN_002ecf18 is the same over x y z): b' = new b + ((a t^2 / 2 +
// r t + b) - (old a t^2 / 2 + old r t + old b)), r' = new r + ((a t + r) - (old a t + old r)), a' = new a + (a - old a)
{
  const buf = new ArrayBuffer(0x60), dv = new DataView(buf);
  for (let i = 0; i < 12; i++) { dv.setFloat32(4 * i, 1 + i, true); dv.setFloat32(0x30 + 4 * i, 0.5 * i - 2, true); }   // new at 0, old at 0x30
  const F = { f32: o => dv.getFloat32(o, true) };
  const v = new Float32Array(20); for (let i = 4; i < 16; i++) v[i] = f(0.25 * i);
  const t = 2.5, h = f(f(t * t) * 0.5), want = [];
  for (let i = 0; i < 4; i++) {
    const b0 = v[4 + i], r0 = v[8 + i], a0 = v[12 + i], nb = F.f32(4 * i), nr = F.f32(16 + 4 * i), na = F.f32(32 + 4 * i);
    const ob = F.f32(0x30 + 4 * i), or = F.f32(0x40 + 4 * i), oa = F.f32(0x50 + 4 * i);
    want.push([f(nb + f(f(f(f(a0 * h) + f(r0 * t)) + b0) - f(f(f(oa * h) + f(or * t)) + ob))), f(nr + f(f(f(a0 * t) + r0) - f(f(oa * t) + or))), f(na + f(a0 - oa))]);
  }
  _internals.T[17].trans({ F, p: { v } }, t, 0, 0, 0x30);
  ok('type 17 transition (FUN_002eccc8): all four lanes', want.every((w, i) => w[0] === v[4 + i] && w[1] === v[8 + i] && w[2] === v[12 + i]), JSON.stringify(Array.from(v.slice(4, 16))));
}

// --- worker 0208: the z128 stage fire (the level manager DAT_004ee3c0; notes/effects-research.md "Stage effects")
{
  const S = n => join(dataDir, n);
  if (!(ids.stage || []).every(n => existsSync(S(n))) || !(ids.stage || []).length) console.log('  (no stage FEDs in data/effects: the stage-fire checks are skipped; re-run export_web_effects.py)');
  else {
    const stage = ids.stage.map(n => rd(S(n)));
    const mkStage = rng => createEffects({ fed: stage[0], stage, core, rng, rand: ids.rand, cull: true, hidden: ids.hidden, models0: true, warn: () => {} });
    const viewOf = V => ({ toView: p => [0, 1, 2].map(j => f(f(f(p[0] * V[j]) + f(p[1] * V[4 + j])) + f(f(p[2] * V[8 + j]) + V[12 + j]))),
      toViewMatrix: () => Float32Array.from(V), eye: [0, 1, 2].map(i => -(V[12] * V[4 * i] + V[13] * V[4 * i + 1] + V[14] * V[4 * i + 2])) });
    // hand cases (no game data): type 61's envelope and type 62's in-place product
    {
      const T = _internals.T, buf = new ArrayBuffer(0x50), dv = new DataView(buf);
      const W = (o, x) => dv.setFloat32(o, x, true);
      for (let i = 0; i < 4; i++) { W(4 * i, 0.25); W(0x20 + 4 * i, 0.75); }               // B base 0.25, A base 0.75, ranges 0
      dv.setUint16(0x40, 2, true); dv.setUint16(0x42, 3, true); dv.setUint16(0x44, 4, true);   // hold 2, hold 3, ramps 4
      const F = { f32: o => dv.getFloat32(o, true), u16: o => dv.getUint16(o, true), u8: o => dv.getUint8(o) };
      const vb = new ArrayBuffer(64), p = { v: new Float32Array(vb), i32: new Int32Array(vb) };
      const X = { F, p, rng: new EffectRng(1) };
      T[61].init(X, 0, 0);
      const seq = []; for (let k = 0; k < 18; k++) { T[61].eval(X, 0, 0, 0); seq.push(+p.v[0].toFixed(4)); }
      // phases: 0 (c 0-1) hold 1, 1 (c 2-5) ramp to 0.75 in 4, 2 (c 6-8) hold, 3 (c 9-12) ramp to 0.25, then wrap (period 13)
      const want = [1, 1, 0.9375, 0.875, 0.8125, 0.75, 0.75, 0.75, 0.75, 0.625, 0.5, 0.375, 0.25, 0.25, 0.25, 0.375, 0.5, 0.625];
      ok('type 61 (FUN_002b4660): hold / ramp to A / hold / ramp to B over the frame counter, wrapping at +0x30', JSON.stringify(seq) === JSON.stringify(want), JSON.stringify(seq));
      const d62 = new Uint8Array(16); const dd = new DataView(d62.buffer);
      dd.setUint16(0, 62, true); dd.setUint8(2, 2); dd.setUint16(4, 0x20, true); dd.setUint16(6, 0, true); dd.setUint16(8, 1, true); dd.setUint16(10, 0, true); dd.setUint16(12, 0x10, true);
      const F2 = { u8: o => dd.getUint8(o), u16: o => dd.getUint16(o, true) }, p2 = { v: new Float32Array(16) };
      for (let i = 0; i < 4; i++) { p2.v[i] = 200; p2.v[4 + i] = 0.5 + 0.5 * i; }
      T[62].init({ F: F2, d: 0, p: p2 }, 0, 8); T[62].eval({ F: F2, d: 0, p: p2 }, 0, 0, 8);
      { const pv = { v: new Float32Array(8) }; for (let i = 0; i < 4; i++) { pv.v[i] = 10 + i; pv.v[4 + i] = 1; }
        T[15].loop({ p: pv }, 0, 0, 0, 0);
        ok('type 15 loop (FUN_00272238): base = out', JSON.stringify(Array.from(pv.v)) === '[10,11,12,13,10,11,12,13]', JSON.stringify(Array.from(pv.v))); }
      ok('type 62 (FUN_002b4500): ref 0 x ref 1 written into ref 0, clamped to 255; its own slot keeps the init copy',
        JSON.stringify(Array.from(p2.v.slice(0, 4))) === '[100,200,255,255]' && JSON.stringify(Array.from(p2.v.slice(8, 12))) === '[200,200,200,200]', JSON.stringify(Array.from(p2.v.slice(0, 12))));
    }
    // script cmds 0x54 / 0x55 -> cellMask: hiding cell 27 (E15 k0's) culls it with 0x100; showing it again does not; reset
    // restores the start mask
    {
      const fx = mkStage(undefined), ems = fx.stageLoad(), V = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1282.8, 56.8, 1024, 1]);
      const e = ems.find(m => m.ei === 15 && Math.abs(m.param - 0x2420) < 1) ?? ems.find(m => m.ei === 15);
      const v = viewOf(V);
      fx.cellMask(27, true); fx.end(v); const hid = e.f0a & 0x100;
      fx.cellMask(27, false); fx.end(v); const shown = e.f0a & 0x100;
      fx.cellMask(27, true); fx.reset(); const back = !fx.cells().includes(27);
      ok('cellMask (cmds 0x54 / 0x55, the DAT_004e8700 half): a hidden cell culls its emitters (0x100), showing it again does not, reset restores the start mask', hid === 0x100 && shown === 0 && back, `${hid} ${shown} ${back}`);
    }
    // camera-0 models only with models0 (play.js: the stage engine): the impacts' floor model 0x45400 E20 does not match w206_floor
    {
      const fx = createEffects({ fed, core, rng: new EffectRng(7), warn: () => {} }), v = viewOf(new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 60, 1]));
      fx.begin(f(1.2)); fx.spawn(0x45400, [0, 0, 0]); fx.end();
      let models = 0; for (let i = 0; i < 4; i++) { fx.update(f(1.2)); models += fx.sprites(v).filter(q => q.type === 11 || q.type === 20).length; }
      ok('the impacts\' engine (no models0) draws no camera-0 model (the floor impact 0x45400 E20 is unchecked: w206_floor mismatch)', models === 0, `${models}`);
    }
    const out208 = join(here, '../../tools/trace/out');
    const st208 = ['w208_fire/save.json', 'w208_fire/state1.json', 'w208_look/state01.json', 'w208_look/state02.json', 'w208_look/state03.json',
      'w208_look/state04.json', 'w208_still/state1.json', 'w208_still/state2.json'].filter(n => existsSync(join(out208, n)));
    if (!st208.length) console.log('  (no tools/trace/out/w208_*: the stage-fire RAM / dump checks are skipped)');
    // FUN_002f15d0 -> FUN_002e4e38: the stage-load pass spawns the game's emitter list (FED, emitter, record, place, order)
    let same = 0, cullEq = 0, cullN = 0, alphaBad = '', occl = 0;
    for (const n of st208) {
      const st = JSON.parse(readFileSync(join(out208, n), 'utf8')), fx = mkStage(undefined), ems = fx.stageLoad();
      fx.end(viewOf(st.cam.view));
      if (ems.length === st.emitters.length && ems.every((e, i) => e.F.code === st.emitters[i].code && e.ei === st.emitters[i].ei && e.param === st.emitters[i].rec &&
        [0, 1, 2].every(k => Math.abs(e.m[12 + k] - st.emitters[i].p80[k]) < 1e-3))) same++;
      // FUN_002ea6a0: +0x0a's cull bits per emitter (0x200: the occluder test, not translated: the page may draw those)
      ems.forEach((e, i) => { const r = st.emitters[i]; cullN++; if (!r || r.code !== e.F.code || r.ei !== e.ei) return; const a = e.f0a & 0x380, b = r.f0a & 0x380;
        if (b === 0x200) occl++;
        if (a === b || b === 0x200) cullEq++;
        if (!a && !b && Math.abs(e.col[3] - r.col[3]) > 1e-5) alphaBad += `${n} #${i} ${e.col[3]} vs ${r.col[3]}; `; });
    }
    if (st208.length) {
      ok(`stage load (FUN_002e4e38): the RAM's emitter list in ${st208.length} states (76 emitters: FED, emitter, param record, position, order)`, same === st208.length, `${same}/${st208.length}`);
      ok(`emitter cull (FUN_002ea6a0): +0x0a's 0x100 / 0x80 bits equal RAM (${cullEq}/${cullN}; ${occl} occluder-culled 0x200 not compared)`, cullEq === cullN, `${cullEq}/${cullN}`);
      ok('emitter cull: the visible emitters\' alpha +0xbc equals RAM (the screen-size / distance fades)', !alphaBad, alphaBad.slice(0, 300));
    }
    // the draw against the GS dumps of w208_still (camera still; dump = state + 3 frames): the level manager restored from RAM,
    // replayed 3 frames (RNG reseeded from the state's rand()), drawn
    const ramPool = pl => {
      const b = Buffer.from(pl.hex, 'hex'), dv = new DataView(b.buffer, b.byteOffset, b.length), s16 = o => dv.getInt16(o, true), f32 = o => dv.getFloat32(o, true);
      const cap = s16(0x1c), P = { dur: f32(4), life: f32(8), fade: [f32(0xc), f32(0x10), f32(0x14)], t18: f32(0x18), cap, count: s16(0x1e), start: s16(0x20), flag: dv.getUint8(0x22), recs: [] };
      for (let i = 0; i < cap; i++) { const r = new ArrayBuffer(0x90); new Uint8Array(r).set(b.subarray(0x30 + i * 0x90, 0x30 + (i + 1) * 0x90));
        P.recs.push({ f: new Float32Array(r), i: new Int32Array(r), h: new Int16Array(r), u8: new Uint8Array(r) }); }
      return P;
    };
    const restore = (fx, st) => {                                     // test-only: the engine's emitter / particle objects from RAM
      fx.emitters.length = 0;
      for (const e of st.emitters) {
        const F = fx.feds.get(e.code), E = F.emitter(e.ei), cat = F.u8(E + 0xe);
        const em = { F, E, ei: e.ei, param: e.rec, id: 0, cat: (cat < 5) ? 0 : (cat < 9 || cat === 0xb) ? 1 : 0, flags: 0, f0a: e.f0a, age: e.age, dt: e.dt, carry: e.carry,
          fade: e.fade, d0: e.d0, sched: -1, n58: 0x8000, lists: [[], []], p120: [...e.p120.slice(0, 3), 1], p130: [0, 0, 0, 0], p140: [1, 1, 1, 1], p150: e.p150.slice(),
          d4: e.d4, m: Float32Array.from(e.m), col: e.col.slice(), scale: e.scale.slice(), c4: [0xff, 0xff], c8: 0, cc: 0 };
        for (const pr of e.parts) {
          const P = F.part(E, pr.tag), buf = new ArrayBuffer(Math.max((F.s16(P + 2) + 99) & ~3, 16)), i32 = new Int32Array(buf);
          pr.vi.forEach((x, i) => { i32[i] = x; });
          const blk = F.list(P, 0), n0 = F.u8(blk + 4);
          const p = { P, tag: pr.tag, pid: F.u16(P), flags: pr.flags, list: pr.list, age: pr.age, life: F.u16(P + 6), ev: pr.ev, cat: F.u8(P + 0xb), parent: null,
            v: new Float32Array(buf), i32, data: pr.data.slice(), entry: pr.entry.map(x => (x && !(x >= blk + 8 && x < blk + 8 + 8 * n0)) ? x : undefined),
            m50: Float32Array.from(pr.m50), skip: null, ext: {} };
          for (let j = 0; j < F.u8(P + 8); j++) {
            const d = F.desc(P, j), ty = F.u16(d);
            if (ty === 21) { const pl = Object.values(pr.pools).find(q => q.type === 21); if (pl) p.ext[F.u16(d + 4) / 4] = ramPool(pl); }
            if (ty === 26) p.skip = 'channel type 26';
            if (ty === 50 || ty === 53 || ty === 56) p.noDraw = `draw type ${ty}`;
          }
          em.lists[pr.list].push(p);
        }
        fx.emitters.push(em);
      }
    };
    for (const k of [1, 2]) {
      const sp = join(out208, `w208_still/state${k}.json`), dp = join(out208, `w208_still/dump${k}.json`);
      if (!existsSync(sp) || !existsSync(dp)) { console.log(`  (no w208_still state / dump ${k}: skipped)`); continue; }
      const st = JSON.parse(readFileSync(sp, 'utf8')), dump = JSON.parse(readFileSync(dp, 'utf8'));
      if (!st.emitters.some(e => e.parts.some(p => p.entry))) { console.log(`  (w208_still/state${k}.json predates the 'entry' field: re-run fx_fixture.py; skipped)`); continue; }
      const fx = mkStage(new EffectRng(st.lcg, undefined, st.mt, st.rand)), view = viewOf(st.cam.view);
      restore(fx, st);
      let drawn = [];
      for (let i = 0; i < 3; i++) { fx.begin(f(1.2)); fx.end(view); drawn = fx.sprites(view); }
      // FUN_002ea040: a looping emitter culled the frame before (+0x0a & 0x380) is not aged (the camera is still: the same set)
      const frozen = st.emitters.map((e, i) => [e, fx.emitters[i]]).filter(([e]) => e.f0a & 0x380);
      ok(`w208_still state ${k}: the ${frozen.length} culled looping emitters keep their RAM age over the replay`, frozen.length > 30 && frozen.every(([e, m]) => m.age === e.age), frozen.filter(([e, m]) => m.age !== e.age).length);
      const tx = s => s.tex ? '0x' + s.tex.tex0[1].toString(16) + s.tex.tex0[0].toString(16).padStart(8, '0') : 'untex';
      const R = {}; let zWorst = 0, zLo = 0;
      for (const s of drawn) {
        const dv = dump.tris.filter(t => tx(s) === 'untex' || t.tex0 === tx(s)).flatMap(t => t.v), r = R[s.type] ??= { n: 0, near: 0, rgba: 0, worst: 0 };
        for (const v of s.verts) {
          let best = null; for (const u of dv) { const d = Math.hypot(v.gs[0] - u[0], v.gs[1] - u[1]) + (JSON.stringify(u[6]) === JSON.stringify(v.rgba) ? 0 : 1e3); if (!best || d < best.d) best = { d, u }; }
          r.n++; if (best && best.d < 1) { r.near++; r.rgba++; r.worst = Math.max(r.worst, best.d);
            if (s.type !== 21) { const e = (v.gs[2] - best.u[2]) / best.u[2]; zWorst = Math.max(zWorst, Math.abs(e)); zLo = Math.min(zLo, e); } }
        }
      }
      const pv = drawn.flatMap(s => s.verts.map(v => [v.gs[0], v.gs[1], tx(s)]));
      const missing = dump.tris.filter(t => !t.v.every(u => pv.some(q => (q[2] === t.tex0 || q[2] === 'untex') && Math.hypot(q[0] - u[0], q[1] - u[1]) < 1)));
      for (const ty of [20, 21, 11]) ok(`w208_still dump ${k}: type ${ty} vertices on a game vertex with its RGBA (${R[ty]?.rgba}/${R[ty]?.n}, worst ${R[ty]?.worst.toFixed(3)} px)`,
        R[ty] && R[ty].n >= 8 && R[ty].rgba === R[ty].n && R[ty].worst < 0.5, JSON.stringify(R[ty]));
      // every model, with or without a depth matrix, sits the same 0.05-0.075 % above the game's Z here (the camera of the state vs
      // the dump's); E14 without its depth matrix would be 0.06 % below, with +d as the offset 1.35 % above
      ok(`w208_still dump ${k}: model GS Z (incl. E14's depth matrix) within 0.1 % and on one side (${(zLo * 100).toFixed(3)} .. ${(zWorst * 100).toFixed(3)} %)`, zWorst < 1e-3 && zLo > -2e-4, `${zLo} ${zWorst}`);
      // what the page leaves out: E10-E12's type 11 data +0x15 models (FUN_002f93d8, not decoded): 4 gouraud triangles of RGB (130, 50, 5)
      ok(`w208_still dump ${k}: every game fire triangle drawn but E10-E12's FUN_002f93d8 models (${missing.length} left, all RGB (130, 50, 5))`,
        missing.length <= 4 && missing.every(t => t.v.every(u => u[6][0] === 130 && u[6][1] === 50 && u[6][2] === 5)), JSON.stringify(missing.map(t => t.v.map(u => u[6]))));
    }
  }
}

const out = join(here, '../../tools/trace/out/w179_fx');
if (!existsSync(join(out, 'state1.json'))) {
  console.log(`${checks - fails}/${checks} checks passed; SKIP the game comparisons (no tools/trace/out/w179_fx)`);
  process.exit(fails ? 1 : 0);
}
const load = n => JSON.parse(readFileSync(join(out, n), 'utf8'));

// The effect LCG's state when an emitter spawned: its particle 0's position offsets are the first
// two x / z draws of range 4 (type 22), so the low 15 bits of the state follow from them (the LCG
// keeps the low 15 bits to itself).
const K = new Float32Array(new Uint32Array([0x387fffd5]).buffer)[0];
const val = (s, r) => f(f(((s & 0x7fff) - 0x4000) * K) * f(r));
const next = s => (Math.imul(s, 0x41c64e6d) + 0x3039) >>> 0;
function seedOf(em) {
  const p0 = em.parts.find(p => p.tag === 0);
  for (let L = 0; L < 0x8000; L++)
    if (Math.abs(val(L, 4) - p0.v[4]) <= 1e-6 && Math.abs(val(next(next(L)), 4) - p0.v[6]) <= 1e-6) {
      let x = 1; for (let i = 0; i < 5; i++) x = Math.imul(x, (2 - Math.imul(0x41c64e6d, x)) >>> 0) >>> 0;
      return Math.imul((L - 0x3039) >>> 0, x) >>> 0;
    }
  return null;
}
function replay(em, age, proj, view) {
  const fx = createEffects({ fed, core, warn: () => {}, rng: new EffectRng(seedOf(em)), proj });
  fx.begin(1.2); const e = fx.spawn(0x43400, em.p120); fx.end();
  let sp = view ? fx.sprites(view) : [];
  for (let i = 0, n = Math.round(age / 1.2); i < n; i++) { fx.update(1.2); if (view) sp = fx.sprites(view); }
  return { fx, e, sp };
}

// --- every emitter-12 instance in the five states: the particles' values and matrices
{
  let n = 0, worstM = 0, worstV = 0, worstAt = '';
  for (let s = 1; s <= 5; s++) for (const em of load(`state${s}.json`).emitters.filter(e => e.ei === 12)) {
    const { e } = replay(em, em.age, undefined, { toView: p => p.slice(0, 3) });   // draws advance the sprite clocks
    ok(`state ${s} age ${em.age.toFixed(1)}: same particle tags`,
      JSON.stringify(e.lists[1].map(p => p.tag)) === JSON.stringify(em.parts.map(p => p.tag)));
    for (const pr of em.parts) {
      const pj = e.lists[1].find(p => p.tag === pr.tag);
      if (!pj || pj.skip) continue;
      n++;
      ok(`state ${s} tag ${pr.tag} age`, Math.abs(pj.age - pr.age) < 1e-4, `${pj.age} ${pr.age}`);
      for (let i = 0; i < 16; i++) worstM = Math.max(worstM, Math.abs(pj.m50[i] - pr.m50[i]));
      // the channel values (the w lanes of rotation / scale are never written: uninitialised in the game);
      // with the draw pass run every frame the sprite clocks (+0) must equal the game's (= the age)
      const P = pj.P, F = e.lists && createEffects({ fed, core, warn: () => {} }).fed;
      const size = F.s16(P + 2) / 4;
      // the words each channel type writes (the rest of the region is pool memory in the game);
      // type 10: +0 clock, +4 u16 frame index | flip byte << 16 (its top byte is never written)
      const WR = { 1: [0, 1, 2, 3, 4, 5, 6, 7], 2: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], 4: [0, 1, 2, 4, 5, 6], 7: [0, 1, 2, 4, 5, 6],
        9: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], 15: [0, 1, 2, 3, 4, 5, 6, 7], 16: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], 10: [0] };
      const words = new Set();
      for (let c = 0; c < F.u8(P + 8); c++) {
        const d = F.desc(P, c), o = F.u16(d + 4) / 4;
        for (const k of WR[F.u16(d)] ?? []) words.add(o + k);
        if (F.u16(d) !== 10) continue;
        const a = pj.i32[o + 1] & 0xffffff, b = pr.vi[o + 1] & 0xffffff;
        // L: the page steps exactly 1.2; the game's step varies by ~1e-5 (DAT_004eeb24), which moves a
        // clock that sits on a frame's end time to the other side of it
        // (past the animation's length the index stays where the last boundary left it)
        const an = F.anim(F.s32(pj.data[c] + 0xc));
        const edge = Math.abs(pr.v[o] - Math.round(pr.v[o])) < 1e-3 || (an && pr.v[o] >= F.u8(an + 7));
        ok(`state ${s} tag ${pr.tag} sprite frame index`, a === b || (edge && Math.abs(a - b) === 1), `${a} vs ${b} (clock ${pr.v[o]})`);
      }
      for (let i = 0; i < size; i++) {
        if (!words.has(i)) continue;
        if (pr.vi[i] === 1065353216 || pr.v[i] === 1065353216 || Math.abs(pr.v[i]) > 1e9) continue;
        const d = Math.abs(pj.v[i] - pr.v[i]) / Math.max(1, Math.abs(pr.v[i]));
        if (!(i % 4 === 3 && pj.v[i] === 0) && d > worstV) { worstV = d; worstAt = `state ${s} age ${em.age.toFixed(1)} tag ${pr.tag} [${i}] ${pj.v[i]} vs ${pr.v[i]}`; }
      }
    }
  }
  ok('particles compared', n >= 40, `${n}`);
  ok('particle matrices (+0x50) within 2e-5', worstM < 2e-5, `${worstM}`);
  // the type 10 clock (+0) equals the age in RAM: the spawn ran in manager state 5 (FUN_002e63d0)
  ok('particle values within 1e-4 (relative)', worstV < 1e-4, `${worstV} at ${worstAt}`);
}

// --- the draw against the GS dumps: corners, ST, vertex RGBA, TEX0, ALPHA
for (const [s, d] of [[1, 'dump1.json'], [4, 'dump4.json']]) {
  const st = load(`state${s}.json`), dump = load(d);
  const V = st.cam.view, P = st.cam.proj;
  const view = { toView: p => [0, 1, 2].map(j => f(p[0] * V[j] + p[1] * V[4 + j] + p[2] * V[8 + j] + V[12 + j])) };
  const proj = { fx: P[0], fy: P[5], cx: P[8], cy: P[9], zA: P[14], zB: P[10] };
  const quads = [];
  for (let i = 0; i + 1 < dump.length; i++) {
    const a = dump[i], b = dump[i + 1];
    if (b.i === a.i + 1 && a.tex0 === b.tex0) { quads.push({ tex0: a.tex0, blend: a.blend, v: [...a.v, b.v[2]] }); i++; }
  }
  let n = 0, exact = 0, worst = 0, sum = 0, zWorst = 0, n21 = 0, exact21 = 0;
  for (const em of st.emitters.filter(e => e.ei === 12)) {
    const { sp } = replay(em, em.age + 4.8, proj, view);         // the dump is 4 frames after the state
    for (const sprite of sp) {
      const c = sprite.verts.map(v => v.gs);
      let best = null;
      for (const q of quads) {
        const dd = Math.max(...c.map((g, k) => Math.hypot(g[0] - q.v[k][0], g[1] - q.v[k][1])));
        if (!best || dd < best.d) best = { d: dd, q };
      }
      n++; worst = Math.max(worst, best.d); sum += best.d;
      // GS Z from the depth matrix (the sprite pulled 3 units toward the eye, FUN_002e3948)
      for (let k = 0; k < 4; k++) zWorst = Math.max(zWorst, Math.abs(c[k][2] - best.q.v[k][2]) / best.q.v[k][2]);
      const q = best.q;
      const tex0 = '0x' + sprite.tex.tex0[1].toString(16) + sprite.tex.tex0[0].toString(16).padStart(8, '0');
      const stq = q.v.map(v => [v[3] / v[5], v[4] / v[5]]);
      const blend = sprite.alpha === 0x44 ? '0,1,0,1' : sprite.alpha === 0x48 ? '0,2,0,1' : '?';
      const same = tex0 === q.tex0 && blend === q.blend.slice(0, 4).join(',') &&
        sprite.verts.every((v, k) => JSON.stringify(v.rgba) === JSON.stringify(q.v[k][6]) &&
          Math.abs(v.uv[0] - stq[k][0]) < 1e-4 && Math.abs(v.uv[1] - stq[k][1]) < 1e-4);
      if (sprite.type === 21) { n21++; if (same && best.d < 1) exact21++; }
      if (same) exact++;
      else console.log(`  state ${s} age ${em.age.toFixed(1)}: ${tex0} rgba ${JSON.stringify(sprite.verts[0].rgba)} vs ${q.tex0} ${JSON.stringify(q.v[0][6])}`);
    }
  }
  ok(`dump ${s}: sprites drawn`, n >= 9, `${n}`);
  // type 21 (FUN_0027bda0 / FUN_0027cd68): the burst, one sub-sprite record (two sprites) per impact
  ok(`dump ${s}: type 21 burst sprites drawn (6) and each equal to a game sprite within 1 px`, n21 === 6 && exact21 === n21, `${exact21}/${n21}`);
  ok(`dump ${s}: every sprite's TEX0, ALPHA, ST and vertex RGBA equal the game's`, exact === n, `${exact}/${n}`);
  console.log(`  dump ${s}: corners worst ${worst.toFixed(3)} px, mean ${(sum / n).toFixed(3)} px; GS Z worst ${(zWorst * 100).toFixed(3)}%`);
  ok(`dump ${s}: corners within 1 px (worst ${worst.toFixed(2)}, mean ${(sum / n).toFixed(2)})`, worst < 1.0, `${worst}`);
  ok(`dump ${s}: GS Z within 0.3% (worst ${(zWorst * 100).toFixed(2)}%)`, zWorst < 0.003, `${zWorst}`);
}

// --- worker 0188: types 21 / 137 against RAM and GS dumps of w172_sound3 grabbed around the pellet impacts
// (f834-836): state B (f831, before them) and its dump (f835), state D (f837, after) and its dump (f841).
// The replay starts from state B's LCG and effect twister; the spark lives use VU0 R (not in EE RAM: the
// GUESS in EffectRng), so they are copied from state D's RAM when compared.
const w188 = join(here, '../../tools/trace/out/w188_fx');
// a RAM pool (fx_fixture.py 'pools': raw bytes at its address) as the page's pool object
function ramPool(pl) {
  const b = Buffer.from(pl.hex, 'hex'), dv = new DataView(b.buffer, b.byteOffset, b.length), base = pl.addr;
  const u32 = o => dv.getUint32(o, true), s16 = o => dv.getInt16(o, true), f32 = o => dv.getFloat32(o, true);
  if (pl.type === 137) {
    const cap = u32(12), size = u32(24), sp = u32(4) - base, tm = u32(8) - base, rg = u32(0) - base + 16;
    const P = { cap, blocks: u32(16), L: u32(20), size, mask: u32(32), idx: u32(28), carry: f32(36), start: u32(40), now: f32(44),
      ring: new Float32Array(size), spark: new Int16Array(cap * 8), birth: new Float32Array(cap) };
    for (let k = 0; k < size; k++) P.ring[k] = f32(rg + 4 * k);
    for (let s = 0; s < cap; s++) {
      const q = sp + (s >> 5) * 0x210 + 0x10 + (s & 31) * 0x10;
      for (let k = 0; k < 8; k++) P.spark[s * 8 + k] = s16(q + 2 * k);
      P.birth[s] = f32(tm + (s >> 5) * 0x90 + 0x10 + (s & 31) * 4);
    }
    return P;
  }
  const cap = s16(0x1c), P = { dur: f32(4), life: f32(8), t18: f32(0x18), cap, count: s16(0x1e), start: s16(0x20), flag: dv.getUint8(0x22), recs: [] };
  for (let i = 0; i < cap; i++) {
    const r = new ArrayBuffer(0x90); new Uint8Array(r).set(b.subarray(0x30 + i * 0x90, 0x30 + (i + 1) * 0x90));
    P.recs.push({ f: new Float32Array(r), i: new Int32Array(r), h: new Int16Array(r), u8: new Uint8Array(r) });
  }
  return P;
}
const relErr = (a, b) => Math.abs(a - b) / Math.max(1, Math.abs(b));
if (existsSync(join(w188, 'stateD.json'))) {
  const B = JSON.parse(readFileSync(join(w188, 'stateB.json'), 'utf8')), Dst = JSON.parse(readFileSync(join(w188, 'stateD.json'), 'utf8'));
  const gB = JSON.parse(readFileSync(join(w188, 'grabB.json'), 'utf8'))[0].state, gD = JSON.parse(readFileSync(join(w188, 'grabD.json'), 'utf8'))[0].state;
  const imp = Dst.emitters.filter(e => e.ei === 12).sort((a, b) => b.age - a.age);
  ok('w188: three pellet impacts (emitter 12) in state D', imp.length === 3, `${imp.length}`);
  const camOf = st => {
    const V = st.cam.view, P = st.cam.proj;
    return { view: { toView: p => [0, 1, 2].map(j => f(p[0] * V[j] + p[1] * V[4 + j] + p[2] * V[8 + j] + V[12 + j])), toViewMatrix: () => Float32Array.from(V) },
      proj: { fx: P[0], fy: P[5], cx: P[8], cy: P[9], zA: P[14], zB: P[10] } };
  };
  // the game's step per frame (DAT_004eeb24 varies by ~1e-6): from the type 137 time rings in state D (ring[j]
  // is written in frame spawn + j - 1; ring[1] = 1.0 is the spawn tail); after D: state D's step
  const dtAt = new Map();
  for (const e of Dst.emitters) for (const p of e.parts) for (const pl of Object.values(p.pools)) if (pl.type === 137) {
    const R = ramPool(pl), s0 = gD - R.idx + 1;
    for (let j = 2; j <= R.idx; j++) if (!dtAt.has(s0 + j - 1)) dtAt.set(s0 + j - 1, f(R.ring[j & R.mask] - R.ring[(j - 1) & R.mask]));
  }
  const stepOf = k => dtAt.get(gB + k) ?? f(Dst.emitters[0].dt);
  // the LCG and VU0 R are reseeded from rand() every frame (FUN_002d97f8): state B's rand drives the whole replay
  const rng = new EffectRng(B.lcg, undefined, B.mt, process.env.FXSEED ? null : B.rand);
  const camB = camOf(B), camD = camOf(Dst);
  const fx = createEffects({ fed, core, warn: () => {}, rng, proj: camB.proj });
  const spawnAt = new Map(imp.map(e => [gD - gB - Math.round(e.age / 1.2), e]));
  const made = new Map();
  let lastDraw = [];
  const firstLife = new Map();
  const lifeFromRam = () => {                                   // VU0 R (GUESS): the sparks' lives from state D
    for (const [e, em] of made) for (const p of em.lists[1]) {
      const pr = e.parts.find(q => q.tag === p.tag);
      for (const [c, pl] of Object.entries(pr?.pools ?? {})) {
        if (pl.type !== 137) continue;
        const R = ramPool(pl), S = p.ext[F_slot(p, +c)];
        for (let s = 0; s < S.start; s++) if (S.spark[s * 8 + 7] === R.spark[s * 8 + 7]) {   // spawned slots only (no wrap here)
          const key = gD - gB - Math.round(e.age / 1.2) + S.spark[s * 8 + 7];   // the absolute frame (emitters in list order)
          if (!firstLife.has(key)) firstLife.set(key, S.spark[s * 8 + 3] === R.spark[s * 8 + 3]);   // the frame's first spark: VU0 R from FUN_002d97f8's VRINIT
          S.spark[s * 8 + 3] = R.spark[s * 8 + 3];
        }
      }
    }
  };
  const Fq = parseFed(fed);
  function F_slot(p, c) { return Fq.u16(Fq.desc(p.P, c) + 4) / 4; }
  let drawB = null;
  const DUMP_AFTER = +(process.env.FXDUMP ?? 3);                // dump D shows state D + 3 (MEASURED: sprites 0.44 px at +3, 3.2 px at +4)
  for (let k = 1; k <= gD - gB + DUMP_AFTER; k++) {
    fx.begin(stepOf(k));
    const e = spawnAt.get(k);
    if (e) { if (process.env.FXSEED) rng.s = seedOf(e); made.set(e, fx.spawn(0x43400, e.p120)); }
    fx.end();
    if (process.env.FXLIFE) lifeFromRam();                     // (debug) the lives from RAM; asserted equal below
    lastDraw = fx.sprites(k <= gD - gB ? camB.view : camD.view);
    if (k === +(process.env.FXDUMPB ?? 4)) drawB = lastDraw;     // dump B: state B + 4
    if (k === gD - gB && process.env.FXDBG) for (const [e, em] of made) {
      console.log('  em age', em.age, 'ram', e.age, 'E', Array.from(em.m.slice(12, 15)), 'ram', e.m.slice(12, 15));
      for (const pr of e.parts) { const pj = em.lists[1].find(q => q.tag === pr.tag); console.log('   tag', pr.tag, pj && pj.age, pr.age, pj && Array.from(pj.v.slice(0, 8)).map(x => x.toFixed(3)).join(','), '|', pr.v.slice(0, 8).map(x => x === null ? 'n' : x.toFixed(3)).join(',')); }
    }
    if (k === gD - gB) {
      // state D: the type 21 / 137 pools against RAM
      let n21 = 0, n137 = 0, worst21 = 0, bad = [];
      for (const [e, em] of made) for (const pr of e.parts) {
        const p = em.lists[1].find(q => q.tag === pr.tag);
        for (const [c, pl] of Object.entries(pr.pools)) {
          const R = ramPool(pl), S = p?.ext?.[F_slot(p, +c)];
          if (!S) { bad.push(`no pool tag ${pr.tag}`); continue; }
          if (pl.type === 137) {
            n137++;
            if (process.env.FXDBG) { const g = {}; for (let s2 = 0; s2 < R.start; s2++) (g[R.spark[s2 * 8 + 7]] ??= []).push(`${S.spark[s2 * 8 + 3]}/${R.spark[s2 * 8 + 3]}`); console.log('  lives page/ram', e.age.toFixed(1), JSON.stringify(g)); }
            for (const k2 of ['cap', 'L', 'size', 'mask', 'idx', 'start']) if (S[k2] !== R[k2]) bad.push(`137 ${k2} ${S[k2]} vs ${R[k2]}`);
            if (relErr(S.carry, R.carry) > 1e-5 || relErr(S.now, R.now) > 1e-4) bad.push(`137 carry/now ${S.carry}/${S.now} vs ${R.carry}/${R.now}`);
            // the written slots (no wrap here; the rest is heap memory)
            for (let s = 0; s < R.start; s++) for (let k2 = 0; k2 < 8; k2++) if (S.spark[s * 8 + k2] !== R.spark[s * 8 + k2] ) bad.push(`137 spark ${s}[${k2}] ${S.spark[s * 8 + k2]} vs ${R.spark[s * 8 + k2]}`);
          } else {
            n21++;
            for (const k2 of ['cap', 'count', 'start']) if (S[k2] !== R[k2]) bad.push(`21 ${k2} ${S[k2]} vs ${R[k2]}`);
            for (let q = 0; q < S.count; q++) {
              const a = S.recs[(S.start + q) % S.cap], b2 = R.recs[(R.start + q) % R.cap];
              for (const w of [0, 1, 2, 4, 5, 6, 7, 8, 9, 10, 12, 13, 14, 15, 16, 17, 19, 20, 21, 23, 24, 25, 26, 27, 28, 32, 33, 34, 35]) {
                const er = relErr(a.f[w], b2.f[w]);
                if (er > worst21) { worst21 = er; if (er > 1e-5) bad.push(`21 tag ${pr.tag} rec ${q} [${w}] ${a.f[w]} vs ${b2.f[w]}`); }
              }
              if (a.i[3] !== b2.i[3] || a.h[22] !== b2.h[22] || a.u8[0x2e] !== b2.u8[0x2e]) bad.push(`21 rec ${q} frame / flip`);
            }
          }
        }
      }
      ok(`w188 state D: type 137 pools (spark velocity / acceleration shorts, life (VU0 R), birth, ring, carry) equal RAM (${n137})`, n137 === 3 && !bad.some(x => x.startsWith('137') || x.startsWith('no')), bad.slice(0, 4).join('; '));
      ok(`w188 state D: type 21 pools equal RAM, floats within 1e-5 (${n21}; worst ${worst21.toExponential(2)})`, n21 === 3 && worst21 < 1e-5 && !bad.some(x => x.startsWith('21')), bad.filter(x => x.startsWith('21')).slice(0, 6).join('; '));
    }
  }
  // The dumps: the camera of the dump frame is not in the save (the shot's recoil moves it between the state
  // and the dump), so a screen shift is fitted from the textured sprites (types 10 / 21: their RGBA must
  // match exactly), then the sparks (the VU1 line program's x 127 colours) are compared after the same shift.
  const compareDump = (nm, dmp, drawn, sparkG = 95) => {
    const quads = []; for (let i = 0; i + 1 < dmp.tris.length; i++) { const a = dmp.tris[i], b2 = dmp.tris[i + 1]; if (b2.i === a.i + 1 && a.tex0 === b2.tex0) { quads.push({ v: [...a.v, b2.v[2]] }); i++; } }
    const near = (c, sh) => { let best = null; for (const q of quads) { const d = Math.max(...c.map((g, k) => Math.hypot(g[0] + sh[0] - q.v[k][0], g[1] + sh[1] - q.v[k][1]))); if (!best || d < best.d) best = { d, q }; } return best; };
    const sps = drawn.filter(s => !s.line);
    let sh = [0, 0];
    for (let it = 0; it < 3; it++) {                             // shift = mean corner difference to the nearest quads
      let sx = 0, sy = 0, n = 0;
      // fitted on the sprites whose nearest game quad has their RGBA (the same sprite), not on all of them
      const rgb = sp => JSON.stringify(sp.verts.map(v => v.rgba));
      for (const sp of sps) { const c = sp.verts.map(v => v.gs), q = near(c, sh).q; if (rgb(sp) !== JSON.stringify(q.v.map(v => v[6]))) continue; c.forEach((g, k) => { sx += q.v[k][0] - g[0]; sy += q.v[k][1] - g[1]; n++; }); }
      if (n) sh = [sx / n, sy / n];
    }
    let worstS = 0, exS = 0, worstSame = 0;
    const unmatchedS = [];
    for (const sp of sps) { const b = near(sp.verts.map(v => v.gs), sh); worstS = Math.max(worstS, b.d); if (JSON.stringify(sp.verts.map(v => v.rgba)) === JSON.stringify(b.q.v.map(v => v[6]))) { exS++; worstSame = Math.max(worstSame, b.d); } else unmatchedS.push({ emitter: sp.emitter, type: sp.type, tag: sp.tag, d: b.d }); }
    const segs = []; for (const s of drawn.filter(s => s.line)) for (let i = 0; i + 1 < s.verts.length; i++) segs.push({ a: s.verts[i], b: s.verts[i + 1], alpha: s.alpha });
    const gl = dmp.lines.filter(g => g.v[0][3][0] === 127 && g.v[0][3][1] === sparkG);   // the x 127 colours of this effect's sparks
    let worstL = 0, col = 0, onSpot = 0, onSpotCol = 0;
    // game segments no page segment lands on (within 1 px)
    const unmatched = gl.filter(g => !segs.some(sg => Math.max(Math.hypot(sg.a.gs[0] + sh[0] - g.v[0][0], sg.a.gs[1] + sh[1] - g.v[0][1]), Math.hypot(sg.b.gs[0] + sh[0] - g.v[1][0], sg.b.gs[1] + sh[1] - g.v[1][1])) < 1));
    for (const sg of segs) {
      let best = null;
      for (const g of gl) { const d = Math.max(Math.hypot(sg.a.gs[0] + sh[0] - g.v[0][0], sg.a.gs[1] + sh[1] - g.v[0][1]), Math.hypot(sg.b.gs[0] + sh[0] - g.v[1][0], sg.b.gs[1] + sh[1] - g.v[1][1])); if (!best || d < best.d) best = { d, g }; }
      if (!best) { worstL = Infinity; continue; }
      worstL = Math.max(worstL, best.d);
      if (best.d < 1) { onSpot++; if (JSON.stringify([sg.a.rgba, sg.b.rgba]) === JSON.stringify([best.g.v[0][3], best.g.v[1][3]])) onSpotCol++; }
      if (JSON.stringify([sg.a.rgba, sg.b.rgba]) === JSON.stringify([best.g.v[0][3], best.g.v[1][3]]) && best.g.alpha.slice(0, 4).join() === (sg.alpha === 0x48 ? '0,2,0,1' : '0,1,0,1')) col++;
      if (process.env.FXDBG) console.log(`   ${nm}`, sg.a.gs.map(x => (x).toFixed(1)).join(), '>', (sg.b.gs[0] - sg.a.gs[0]).toFixed(1), (sg.b.gs[1] - sg.a.gs[1]).toFixed(1), sg.a.rgba[3], '| game', best.g.v[0][0].toFixed(1), best.g.v[0][1].toFixed(1), '>', (best.g.v[1][0] - best.g.v[0][0]).toFixed(1), (best.g.v[1][1] - best.g.v[0][1]).toFixed(1), best.g.v[0][3][3], best.d.toFixed(2));
    }
    console.log(`  w188 dump ${nm}: shift ${sh.map(x => x.toFixed(2))} px; ${sps.length} sprites worst ${worstS.toFixed(2)} px, RGBA ${exS}/${sps.length} (those within ${worstSame.toFixed(2)} px); ${segs.length} spark segments (game ${gl.length}) worst ${worstL.toFixed(2)} px, RGBA + ALPHA ${col}/${segs.length}`);
    return { sps: sps.length, worstS, exS, worstSame, unmatchedS, segs: segs.length, game: gl.length, worstL, col, sh, onSpot, onSpotCol,
      unmatchedZero: unmatched.filter(g => Math.hypot(g.v[0][0] - g.v[1][0], g.v[0][1] - g.v[1][1]) < 0.01).length, unmatched: unmatched.length };
  };
  const rB = compareDump('B', JSON.parse(readFileSync(join(w188, 'dumpB.json'), 'utf8')), drawB);
  if (process.env.FXOUT) writeFileSync(process.env.FXOUT, JSON.stringify({ shift: rB.sh, draw: drawB.map(s => ({ line: !!s.line, type: s.type, gs: s.verts.map(v => v.gs), rgba: s.verts.map(v => v.rgba) })) }));
  ok('w188 dump B (f835): the replay\'s sprites within 1 px (fitted screen shift) and RGBA exact', rB.sps > 0 && rB.worstS < 1 && rB.exS === rB.sps, JSON.stringify(rB));
  // L: the game does not clear the pool (FUN_002f3068): a slot it never wrote keeps heap bytes; in dump B one has a
  // life above 1000 and zero velocity, so the game draws a zero-length line at the impact. The page's pools start
  // at zero. Every other game segment has a page segment on it.
  ok('w188 dump B: every game spark segment has a page segment within 1 px, except zero-length ones from never-written pool slots',
    rB.segs > 0 && rB.unmatched === rB.unmatchedZero && rB.unmatched <= 1 && rB.segs + rB.unmatched === rB.game, JSON.stringify({ segs: rB.segs, game: rB.game, unmatched: rB.unmatched, zero: rB.unmatchedZero }));
  ok('w188 dump B: every spark segment within 1 px of a game segment (same shift)', rB.worstL < 1, `${rB.worstL}`);
  ok('w188 dump B: every spark vertex RGBA and the ALPHA equal the game\'s', rB.col === rB.segs, `${rB.col}/${rB.segs}`);
  // dump D (f840: state D + 3): after state D the youngest impact still spawns with an unknown game step and its
  // carry on a knife edge (0.99999809), so this one is reported, not asserted
  const rD = compareDump('D', JSON.parse(readFileSync(join(w188, 'dumpD.json'), 'utf8')), lastDraw);
  // the segments that land on a game segment are the same sparks: their colours (alpha = the life fade
  // min((life - age) / (life / 2), 1), VU 0x3f4.z) must be the game's
  ok(`w188 dump D: the sparks on a game segment (${rD.onSpot}) have its RGBA (older sparks: the life fade)`, rD.onSpot >= 20 && rD.onSpotCol === rD.onSpot, `${rD.onSpotCol}/${rD.onSpot}`);
  // --- the hit on Vincent at f789 (w172_sound3): state A (f787), state C (f789, one frame after the spawn) and
  // its dump. The game spawns 0x40c00 (emitter 3: param +0x1d = 1) and 0x41800 (emitter 6; source not decoded,
  // the page spawns only 0x40c00) at the hit point. Frame 1 (the spawn): emitter 3's LCG from its first particle
  // (seedOf). Frame 2: FUN_002d97f8 reseeds the LCG from rand() (state A's, two steps on), then the soldier's
  // muzzle emitter 8 (not replayed; first in the list) could draw before emitter 3: its draw count k8 is FITTED
  // (searched 0-200 for the records to equal RAM; it comes out 0).
  {
    const C = JSON.parse(readFileSync(join(w188, 'stateC.json'), 'utf8')), A = JSON.parse(readFileSync(join(w188, 'stateA.json'), 'utf8'));
    const e3 = C.emitters.find(e => e.ei === 3), e6 = C.emitters.find(e => e.ei === 6), camC = camOf(C);
    ok('w188 state C: the hit spawned emitters 3 and 6 at one point', e3 && e6 && e3.age === e6.age && e3.p120.every((x, i) => x === e6.p120[i]));
    const randStep = x => (Math.imul(x, 0x41c64e6d) + 0x3039) >>> 0;
    const pr21 = e3.parts.find(p => Object.values(p.pools).some(q => q.type === 21)), R21 = ramPool(Object.values(pr21.pools)[0]);
    const replay = (k8, k6 = 0) => {
      const rng = new EffectRng(seedOf(e3), undefined, A.mt, null);
      const fx = createEffects({ fed, core, warn: () => {}, rng, proj: camC.proj });
      // the game's order (w193_fxsrc f789): 0x40c00 in the bullet's vt+0x1b4 (FUN_003361b8), 0x1000 (FUN_00336508,
      // FED r0000: not on the page), then FUN_00554ea8's bullet-end effect W+0xb0 = 0x41800 (FUN_00335918)
      fx.begin(f(1.2)); const m3 = fx.spawn(0x40c00, e3.p120); for (let i = 0; i < k6; i++) rng.next();
      const m6 = fx.spawn(0x41800, e6.p120); fx.end(); const first = fx.sprites(camC.view);
      rng.libc = randStep(A.rand);                               // frame 1's rand(); frame 2's begin steps it again
      fx.begin(f(e3.dt)); for (let i = 0; i < k8; i++) rng.next(); fx.end(); const second = fx.sprites(camC.view);
      const S = m3.lists[1].find(p => p.tag === pr21.tag).ext[F_slot(m3.lists[1].find(p => p.tag === pr21.tag), +Object.keys(pr21.pools)[0])];
      const errs = []; for (let q = 0; q < R21.count; q++) { const a = S.recs[(S.start + q) % S.cap], b2 = R21.recs[(R21.start + q) % R21.cap]; errs.push(Math.max(...[0, 1, 2, 4, 5, 6, 12, 13, 15, 19, 24, 25, 26, 27].map(w => relErr(a.f[w], b2.f[w])))); }
      return { fx, rng, m3, m6, first, second, errs, n: S.count };
    };
    const r0 = replay(0);
    ok('w188 state C: the hit\'s type 21 records of the spawn frame (0-2) equal RAM (tag 5\'s type 23 / 24 transitions now run: no extra draws)', r0.n === R21.count && r0.errs.slice(0, 3).every(x => x < 1e-5), JSON.stringify(r0.errs));
    let k8 = -1; for (let k = 0; k <= 200 && k8 < 0; k++) { const r = replay(k); if (r.errs.every(x => x < 1e-5)) k8 = k; }
    console.log(`  w188 hit: frame 2 matches RAM with k8 = ${k8} (fitted, 0-200) LCG draws ahead of emitter 3`);
    ok('w188 state C: the hit\'s frame-2 type 21 records (3-5) equal RAM from the rand() reseed plus emitter 8\'s draws', k8 >= 0, `${k8}`);
    const { fx: fxC, m3, first } = replay(Math.max(k8, 0));
    // categories 6 / 8 draw: emitter 3's tag 0 is render category 6
    ok('w188: the hit draws, incl. its render category 6 particle (tag 0)', first.length > 0 && first.some(s => s.emitter === 3 && s.tag === 0), `${first.filter(s => s.tag === 0).length}`);
    // the translated channels' values of one emitter vs RAM: {n, worst, at}
    const valErr = (m, e) => {
      let nv = 0, worstV = 0, at = '';
      for (const pr of e.parts) {
        const pj = m.lists[1].find(p => p.tag === pr.tag);
        if (!pj || pj.skip) continue;
        for (let c = 0; c < Fq.u8(pj.P + 8); c++) {
          const d = Fq.desc(pj.P, c), ty = Fq.u16(d), o = Fq.u16(d + 4) / 4;
          const W = { 1: [0, 1, 2], 2: [0, 1, 2, 4, 5, 6], 4: [0, 1, 2], 7: [0, 1, 2], 9: [0, 1, 2], 15: [0, 1, 2, 3], 16: [0, 1, 2, 3], 17: [0, 1, 2, 3] }[ty];
          for (const k of W ?? []) { nv++; const er = relErr(pj.v[o + k], pr.v[o + k]); if (er > worstV) { worstV = er; at = `tag ${pr.tag} type ${ty} [${k}] ${pj.v[o + k]} vs ${pr.v[o + k]}`; } }
        }
      }
      return { nv, worstV, at };
    };
    ok('w188 state C: emitter 3 same particle tags', JSON.stringify(m3.lists[1].map(p => p.tag)) === JSON.stringify(e3.parts.map(p => p.tag)));
    const { nv, worstV, at } = valErr(m3, e3);
    ok(`w188 state C: the hit's (emitter 3) particle values within 1e-5 (${nv}, incl. its render category 6 tag 0; worst ${worstV.toExponential(2)})`, nv > 20 && worstV < 1e-5, at);
    // the bullet-end effect 0x41800 (emitter 6). The emitter list is 8, 3, 0x1000 (r0000), 6. k6 = draws given to
    // emitter 6 first (searched 0-64; emitter 3 then no longer matches, so this replay checks emitter 6 alone):
    // MEASURED 25. Worker 0200 (call log w200_lcg, every LCG call with its caller): they are NOT r0000's (its
    // channels draw nothing) but emitter 3 tag 4's type 100 eval (0x2cb3b8 -> FUN_0029e630 -> FUN_0029e688, 5 trail
    // points x 5 draws) right after its type 21 eval; the page runs no type 100 eval, so emitter 6 draws 25 values
    // early. The dump replay below has k6 = 0.
    let k6 = -1; for (let k = 0; k <= 64 && k6 < 0; k++) { const r = replay(Math.max(k8, 0), k); const v = valErr(r.m6, e6); if (v.nv > 0 && v.worstV < 1e-5) k6 = k; }
    const r6 = replay(Math.max(k8, 0), Math.max(k6, 0)), v6 = valErr(r6.m6, e6);
    console.log(`  w188 hit: emitter 6 (0x41800) matches RAM with k6 = ${k6} LCG draws after emitter 3's spawn; ${v6.nv} values, worst ${v6.worstV.toExponential(2)} ${v6.at}`);
    ok('w188 state C: emitter 6 (0x41800, FUN_00554ea8 -> FUN_00335918) same particle tags', JSON.stringify(r6.m6.lists[1].map(p => p.tag)) === JSON.stringify(e6.parts.map(p => p.tag)), `${r6.m6.lists[1].map(p => p.tag)} vs ${e6.parts.map(p => p.tag)}`);
    ok(`w188 state C: emitter 6's particle values within 1e-5 (${v6.nv}) after emitter 3's type 100's ${k6} draws (FUN_0029e688)`, k6 === 25 && v6.nv > 20 && v6.worstV < 1e-5, `k6 ${k6} ${v6.at}`);
    // the dump (C+4: the frame whose sprites fit best; C+3 / C+5 are worse): frames 3-4 are reseeded from rand()
    // like frame 2, but not checked against RAM (no state there)
    const dC = JSON.parse(readFileSync(join(w188, 'dumpC.json'), 'utf8'));
    const quads = []; for (let i = 0; i + 1 < dC.tris.length; i++) { const a = dC.tris[i], b2 = dC.tris[i + 1]; if (b2.i === a.i + 1 && a.tex0 === b2.tex0) { quads.push({ v: [...a.v, b2.v[2]] }); i++; } }
    let drC = null;
    const CK = +(process.env.FXCK ?? 4);
    for (let k = 1; k <= Math.max(4, CK); k++) { fxC.begin(f(e3.dt)); fxC.end(); const dr = fxC.sprites(camC.view); if (k >= 3) compareDump(`C+${k} (reported)`, dC, dr, 111); if (k === CK) drC = dr; }
    // asserted: most of the hit's sprites have a game sprite with their exact RGBA, within 2.5 px after a shift
    // fitted on those sprites (the dump frame's camera is not in the save; the residual is not a pure shift).
    // Reported: the other sprites (no game sprite with their RGBA) and their distance to the nearest game sprite
    const rC = compareDump('C+4 (asserted)', dC, drC, 111);
    console.log(`  w188 dump C+4: unmatched sprites (no game sprite with their RGBA), nearest game sprite: ${rC.unmatchedS.map(u => `emitter ${u.emitter} type ${u.type} tag ${u.tag} ${u.d.toFixed(2)} px`).join(', ')}`);
    // emitter 6 (0x41800, the bullet-end effect): its tag 1 sprites draw from the LCG 25 values early (type 100's eval
    // is not on the page, see k6 above); the others must still match a game sprite's RGBA
    const n6 = drC.filter(s => s.emitter === 6 && !s.line).length, u6 = rC.unmatchedS.filter(u => u.emitter === 6).length;
    ok(`w188 dump C (C+4): emitter 6 (0x41800) draws ${n6} sprites, ${n6 - u6} with a game sprite's exact RGBA; unmatched only its tag 1 (the missing type 100 draws)`,
      n6 >= 4 && n6 - u6 >= 1 && rC.unmatchedS.filter(u => u.emitter === 6).every(u => u.tag === 1), `${n6} ${u6}`);
    ok(`w188 dump C (C+4): ${rC.exS} / ${rC.sps} of the hit's sprites have a game sprite's exact RGBA, within ${rC.worstSame.toFixed(2)} px (fitted on those)`, rC.exS >= 12 && rC.worstSame < 2.5, JSON.stringify(rC));
  }
} else console.log('  (no tools/trace/out/w188_fx: the type 21 / 137 RAM and line checks are skipped)');

// --- r0000.fed (worker 0200): FileCode 0, FUN_00336508's 0x1000 (the hit on Vincent's screen flash, emitter 7:
// tag 0 type 107, tag 1 types 109 + 110) and FUN_00580410's 0x4800 (emitter 18, the item drop's burst)
if (existsSync(join(dataDir, 'r0000.fed'))) {
  const fed0 = rd(join(dataDir, 'r0000.fed'));
  const F0 = parseFed(fed0);
  ok('r0000: FileCode 0', F0.code === 0);
  const mk = (o = {}) => createEffects({ fed, fed0, core, warn: () => {}, rng: new EffectRng(1, undefined, null, null), ...o });
  {
    const fx = mk(); fx.begin(f(1.2));
    const m = fx.spawn(0x1000, [0, 0, 0]), m48 = fx.spawn(0x4800, [1, 2, 3]), m4 = fx.spawn(0x40c00, [0, 0, 0]);
    ok('r0000: 0x1000 -> its emitter 7 (FUN_002e5c60 by id & 0xfffc0000), 0x4800 -> emitter 18, 0x40c00 still r0001 emitter 3',
      m && m.ei === 7 && m.F === fx.feds.get(0) && m48 && m48.ei === 18 && m4 && m4.ei === 3 && m4.F === fx.fed);
    const w = []; const fxNo = createEffects({ fed, core, warn: x => w.push(x), rng: new EffectRng(1, undefined, null, null) });
    fxNo.begin(f(1.2));
    ok('r0000: without fed0, 0x1000 is not spawned (warned)', fxNo.spawn(0x1000, [0, 0, 0]) === null && w.some(x => x.includes('no FED for id 0x1000')));
  }
  // the screen sprite of type 107 against the decode: whole buffer 0 (448 x 512), colour = the type 17 value truncated,
  // ALPHA byte +0x18 = 1 -> 0x48, TEST 0x3000d; type 110 is not drawn
  const run = (frames, o) => { const fx = mk(o); fx.begin(f(1.2)); const m = fx.spawn(0x1000, [0, 0, 0]); fx.end(); let dr = fx.sprites({ toView: p => p }); for (let k = 0; k < frames; k++) { fx.begin(f(1.2)); fx.end(); dr = fx.sprites({ toView: p => p }); } return { fx, m, dr }; };
  {
    const { m, dr } = run(4);
    const sc = dr.filter(s => s.screen);
    const p0 = m.lists[1].find(p => p.tag === 0), c = p0.v.slice(24, 28);
    ok('r0000 0x1000: one screen sprite per frame (tag 0, type 107), none for type 110', sc.length === 1 && sc[0].type === 107 && sc[0].tag === 0 && !dr.some(s => s.type === 110), JSON.stringify(dr));
    ok('r0000 0x1000: its rectangle is display buffer 0 (0, 0, 448, 512)', sc[0] && JSON.stringify(sc[0].rect) === '[0,0,448,512]');
    ok('r0000 0x1000: RGBA = the type 17 colour (slot 96) clamped and truncated, no emitter colour', sc[0] && JSON.stringify(sc[0].rgba) === JSON.stringify([...c].map(x => Math.trunc(Math.min(255, Math.max(0, x))))), `${sc[0]?.rgba} ${[...c]}`);
    ok('r0000 0x1000: ALPHA 0x48 (data +0x18 = 1), TEST 0x3000d', sc[0] && sc[0].alpha === 0x48 && sc[0].test === 0x3000d);
    // FUN_002849a8's colour with the prim record's +0x70 = 0 (FUN_00286870): the emitter colour (+0xb0) is not applied
    const fxc = mk(); fxc.begin(f(1.2)); const mc = fxc.spawn(0x1000, [0, 0, 0]); mc.p150 = [0.5, 0.5, 0.5, 0.5]; fxc.end();
    const p0c = mc.lists[1].find(p => p.tag === 0), sc2 = fxc.sprites({ toView: p => p }).find(s => s.screen);
    ok('r0000 0x1000: the screen colour ignores the emitter colour (0.5 here)', mc.col[0] === 0.5 && sc2 && sc2.rgba[1] === Math.trunc(p0c.v[25]) && sc2.rgba[1] > 40, `${sc2?.rgba}`);
    // review (worker 0200): FUN_002849a8's VMAX 0 / VMINI 255 / VFTOI0 on an out-of-range colour, hand-written values
    const fxh = mk(); fxh.begin(f(1.2)); const mh = fxh.spawn(0x1000, [0, 0, 0]); fxh.end();
    mh.lists[1].find(p => p.tag === 0).v.set([300, -5, 12.9, 128.7], 24);
    const sh = fxh.sprites({ toView: p => p }).find(s => s.screen);
    ok('r0000 0x1000: colour (300, -5, 12.9, 128.7) -> RGBA (255, 0, 12, 128)', sh && JSON.stringify(sh.rgba) === '[255,0,12,128]', `${sh?.rgba}`);
    const { dr: drEnd } = run(11);
    ok('r0000 0x1000: gone at its life (11)', !drEnd.some(s => s.screen));
  }
  // review (worker 0200): synthetic type 107 blocks (r0000 never sets +0x1a / +0x19). A fake FED view over one buffer:
  // block A at 0 (+0x10 base, +0x14 rate, byte +0x18 ALPHA index, +0x19 own rectangle at +0..+0xc, +0x1a mode),
  // block B at 0x40, a descriptor at 0x100 (type 107, nref 2, out slot 0, ref slots: colour at value slot 0)
  {
    const buf = new ArrayBuffer(0x200), dv = new DataView(buf);
    const Fk = { u8: o => dv.getUint8(o), u16: o => dv.getUint16(o, true), s16: o => dv.getInt16(o, true), s32: o => dv.getInt32(o, true),
      u32: o => dv.getUint32(o, true), f32: o => dv.getFloat32(o, true) };
    const blk = (o, base, rate, a18, a19, a1a, rect = [0, 0, 0, 0]) => { rect.forEach((v, i) => dv.setInt32(o + 4 * i, v, true)); dv.setFloat32(o + 0x10, base, true); dv.setFloat32(o + 0x14, rate, true); dv.setUint8(o + 0x18, a18); dv.setUint8(o + 0x19, a19); dv.setUint8(o + 0x1a, a1a); };
    dv.setUint16(0x100, 107, true); dv.setUint8(0x102, 2); dv.setUint16(0x104, 0, true); dv.setUint16(0x10a, 0, true);
    const T107 = _internals.T[107], warns = [];
    const X = { F: Fk, d: 0x100, p: { v: new Float32Array(8), tag: 0 }, em: { ei: 7, id: 0x1000 }, warn: m => warns.push(m) };
    blk(0, 10, 2, 1, 0, 1); blk(0x40, 4, 1, 0, 0, 0);
    T107.init(X, 0, 0); const Q = X.p.ext[0];
    ok('type 107 init (FUN_002a3178): value = base = data +0x10, rate = data +0x14, acc 0', Q.v === 10 && Q.base === 10 && Q.rate === 2 && Q.acc === 0);
    T107.eval(X, 3, 0, 0);
    ok('type 107 eval with +0x1a (FUN_002a35f0): value = 2 x 3 + 10 = 16', Q.v === 16, `${Q.v}`);
    T107.eval(X, 5, 0x40, 0);
    ok('type 107 eval without +0x1a: value kept', Q.v === 16);
    Q.base = 11; Q.rate = 3;
    blk(0x80, 20, 5, 1, 0, 0);
    T107.trans(X, 2, 0x80, 0, 0x40);          // neither block has +0x1a: nothing
    ok('type 107 transition, neither block with +0x1a: unchanged', Q.base === 11 && Q.rate === 3);
    blk(0x80, 20, 5, 1, 0, 1);
    T107.trans(X, 2, 0x80, 0, 0x40);          // FUN_002a3258: base 20 + ((3 x 2 + 11) - (1 x 2 + 4)) = 31, rate 5 + (3 - 1) = 7
    ok('type 107 transition with +0x1a (FUN_002a3258): base 31, rate 7, acc 0', Q.base === 31 && Q.rate === 7 && Q.acc === 0, `${Q.base} ${Q.rate}`);
    const out = []; X.p.v.set([128, 64, 32, 16], 0);
    T107.draw(X, 0, 0, null, out);
    ok('type 107 draw with +0x1a (frame-buffer mode): not drawn, warned', out.length === 0 && warns.some(w => w.includes('frame-buffer mode')));
    blk(0, 10, 2, 2, 1, 0, [100, 20, 50, 60]);
    T107.draw(X, 0, 0, null, out);
    ok('type 107 draw with +0x19: the rectangle from data +0..+0xc (100, 20, 50, 60), ALPHA index 2 -> 0x42', out.length === 1 && JSON.stringify(out[0].rect) === '[100,20,50,60]' && out[0].alpha === 0x42, JSON.stringify(out[0]));
    blk(0, 10, 2, 7, 0, 0); out.length = 0;
    T107.draw(X, 0, 0, null, out);
    ok('type 107 draw: ALPHA index byte 7 -> FUN_00284e20 0 -> 0x44; rect = buffer 0 (0, 0, 448, 512)', out[0] && out[0].alpha === 0x44 && JSON.stringify(out[0].rect) === '[0,0,448,512]');
    // the SCISSOR clip (0-431 x 0-511) of the screen rectangle in the view's clip space
    const near = (a, b) => a && a.every((v, i) => Math.abs(v - b[i]) < 1e-9);
    ok('screenClip: buffer 0 (448 wide) -> the whole 432 x 512 view', near(screenClip([0, 0, 448, 512]), [-1, 1, 1, -1]));
    ok('screenClip: (0, 0, 216, 512) -> the left half (x 216 / 432)', near(screenClip([0, 0, 216, 512]), [-1, 1, 0, -1]));
    ok('screenClip: (400, 10, 100, 600) clipped at 432 / 512', near(screenClip([400, 10, 100, 600]), [2 * 400 / 432 - 1, 1 - 20 / 512, 1, -1]));
    ok('screenClip: (440, 0, 8, 512) wholly past the scissor -> null', screenClip([440, 0, 8, 512]) === null);
  }
  // the game: w188 state C (f789, one frame after the hit) with r0000's emitters (fx_fixture.py STATE OUT 0,0x40000)
  // and the hit dump's screen sprites (dumpfx.py --flat), both under tools/trace/out/w200_fx/
  const w200 = join(here, '../../tools/trace/out/w200_fx');
  if (existsSync(join(w200, 'stateC.json'))) {
    const C = JSON.parse(readFileSync(join(w200, 'stateC.json'), 'utf8'));
    const e7 = C.emitters.find(e => e.code === 0 && e.ei === 7), e3 = C.emitters.find(e => e.code === 0x40000 && e.ei === 3);
    ok('w200 state C: the hit spawned r0000 emitter 7 at position 0, same age as emitter 3', e7 && e3 && e7.age === e3.age && e7.p120.every(x => x === 0));
    // the game's order (w193_fxsrc f789): 0x40c00 (r0001), 0x1000 (r0000), 0x41800 (r0001) in one emitter list
    const e6 = C.emitters.find(e => e.code === 0x40000 && e.ei === 6);
    const fx = mk(); fx.begin(f(1.2)); fx.spawn(0x40c00, e3.p120); const m = fx.spawn(0x1000, [0, 0, 0]); fx.spawn(0x41800, e6.p120); fx.end(); fx.begin(f(e7.dt)); fx.end();
    ok('w200 state C: same particle tags', JSON.stringify(m.lists[1].map(p => p.tag)) === JSON.stringify(e7.parts.map(p => p.tag)));
    let nv = 0, worst = 0, at = '', objs = 0, objBad = '';
    for (const pr of e7.parts) {
      const pj = m.lists[1].find(p => p.tag === pr.tag);
      for (let c = 0; c < F0.u8(pj.P + 8); c++) {
        const d = F0.desc(pj.P, c), ty = F0.u16(d), o = F0.u16(d + 4) / 4;
        // the lanes each type writes (type 7's w is never written by FUN_002760d8: heap garbage in RAM)
        for (const k of { 1: [0, 1, 2, 4, 5, 6], 4: [0, 1, 2, 4, 5, 6], 7: [0, 1, 2, 4, 5, 6], 17: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] }[ty] ?? []) {
          nv++; const er = relErr(pj.v[o + k], pr.v[o + k]); if (er > worst) { worst = er; at = `tag ${pr.tag} type ${ty} [${k}] ${pj.v[o + k]} vs ${pr.v[o + k]}`; }
        }
        const R = pr.pools[String(c)];
        if (ty === 107 || ty === 109) {
          objs++; const Q = pj.ext?.[o];
          const mine = Q ? [Q.v, Q.base, Q.rate, Q.acc] : [];
          if (!R || mine.length !== 4 || mine.some((x, i) => relErr(x, R.f[1 + i]) > 1e-6)) objBad += `tag ${pr.tag} type ${ty}: ${mine} vs ${R?.f.slice(1)}; `;
        }
      }
    }
    ok(`w200 state C: r0000 emitter 7's channel values equal RAM (${nv} values, worst ${worst.toExponential(2)})`, nv >= 60 && worst < 1e-6, at);
    ok('w200 state C: the type 107 / 109 value objects (+4 value, +8 base, +0xc rate, +0x10 acceleration) equal RAM', objs === 2 && !objBad, objBad);
    if (existsSync(join(w200, 'dumpC_flat.json'))) {
      // dump C = state C + 4 frames: the screen sprite (two triangles) right after the hit's sprites
      const flat = JSON.parse(readFileSync(join(w200, 'dumpC_flat.json'), 'utf8')).filter(t => t.v[0][2] === 0);
      for (let k = 0; k < 4; k++) { fx.begin(f(1.2)); fx.end(); }
      const sc = fx.sprites({ toView: p => p }).filter(s => s.screen);
      const xs = flat.flatMap(t => t.v.map(v => v[0])), ys = flat.flatMap(t => t.v.map(v => v[1]));
      const s0 = sc[0];
      // FUN_002849a8: x0 = ((x + 0x800) - w / 2) x 16 - 8 (1/16 px), y the same with the height
      const gx0 = s0 ? s0.rect[0] + 2048 - s0.buf.w / 2 - 0.5 : NaN, gy0 = s0 ? s0.rect[1] + 2048 - s0.buf.h / 2 - 0.5 : NaN;
      ok('w200 dump C+4: one screen sprite in the game and on the page', flat.length === 2 && sc.length === 1, `${flat.length} ${sc.length}`);
      ok('w200 dump C+4: the page\'s rectangle = the game\'s (1823.5, 1791.5)-(2271.5, 2303.5)', s0 && Math.min(...xs) === gx0 && Math.max(...xs) === gx0 + s0.rect[2] && Math.min(...ys) === gy0 && Math.max(...ys) === gy0 + s0.rect[3], `${gx0} ${gy0} vs ${Math.min(...xs)} ${Math.min(...ys)}`);
      ok('w200 dump C+4: RGBA exact (game 128, 30, 7, 24)', s0 && flat.every(t => t.v.every(v => JSON.stringify(v[3]) === JSON.stringify(s0.rgba))), `${s0?.rgba} vs ${JSON.stringify(flat[0]?.v[0][3])}`);
      ok('w200 dump C+4: ALPHA 0x48 = blend (A Cs, B 0, C As, D Cd), TEST 0x3000d', s0 && s0.alpha === 0x48 && flat.every(t => JSON.stringify(t.blend.slice(0, 4)) === '[0,2,0,1]' && t.test === s0.test));
    } else console.log('  (no w200_fx/dumpC_flat.json: the screen sprite vs the dump is skipped)');
  } else console.log('  (no tools/trace/out/w200_fx: the r0000 RAM / dump checks are skipped)');
} else console.log('  (no data/effects/r0000.fed: the r0000 checks are skipped; re-run export_web_effects.py)');
console.log(`${checks - fails}/${checks} checks passed`);
process.exit(fails ? 1 : 0);
