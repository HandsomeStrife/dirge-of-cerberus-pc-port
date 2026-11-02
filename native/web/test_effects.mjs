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
import { createEffects, EffectRng, wallImpactId, parseFed, parseCore, _internals } from './effects.js';

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
    // the bullet-end effect 0x41800 (emitter 6). Between the two spawns the game spawns FUN_00336508's 0x1000 (FED
    // r0000: not on the page), so the emitter list is 8, 3, 0x1000, 6 and in the end pass (FUN_002efe98) 0x1000's
    // channels draw the LCG between emitter 3's draws and emitter 6's (the page's spawns draw nothing at the spawn:
    // every frame-1 draw is in the end pass). k6 = draws given to emitter 6 first (searched 0-64; emitter 3 then
    // no longer matches, so this replay checks emitter 6 alone): MEASURED 25. The page leaves 0x1000 out, so its
    // emitter 6 draws 25 values early (notes/effects-research.md 'Bullet end'); the dump replay below has k6 = 0.
    let k6 = -1; for (let k = 0; k <= 64 && k6 < 0; k++) { const r = replay(Math.max(k8, 0), k); const v = valErr(r.m6, e6); if (v.nv > 0 && v.worstV < 1e-5) k6 = k; }
    const r6 = replay(Math.max(k8, 0), Math.max(k6, 0)), v6 = valErr(r6.m6, e6);
    console.log(`  w188 hit: emitter 6 (0x41800) matches RAM with k6 = ${k6} LCG draws after emitter 3's spawn; ${v6.nv} values, worst ${v6.worstV.toExponential(2)} ${v6.at}`);
    ok('w188 state C: emitter 6 (0x41800, FUN_00554ea8 -> FUN_00335918) same particle tags', JSON.stringify(r6.m6.lists[1].map(p => p.tag)) === JSON.stringify(e6.parts.map(p => p.tag)), `${r6.m6.lists[1].map(p => p.tag)} vs ${e6.parts.map(p => p.tag)}`);
    ok(`w188 state C: emitter 6's particle values within 1e-5 (${v6.nv}) after r0000 0x1000's ${k6} draws`, k6 === 25 && v6.nv > 20 && v6.worstV < 1e-5, `k6 ${k6} ${v6.at}`);
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
    // emitter 6 (0x41800, the bullet-end effect): its tag 1 sprites draw from the LCG 25 values early (r0000 0x1000 is
    // not on the page, see k6 above); the others must still match a game sprite's RGBA
    const n6 = drC.filter(s => s.emitter === 6 && !s.line).length, u6 = rC.unmatchedS.filter(u => u.emitter === 6).length;
    ok(`w188 dump C (C+4): emitter 6 (0x41800) draws ${n6} sprites, ${n6 - u6} with a game sprite's exact RGBA; unmatched only its tag 1 (the missing r0000 draws)`,
      n6 >= 4 && n6 - u6 >= 1 && rC.unmatchedS.filter(u => u.emitter === 6).every(u => u.tag === 1), `${n6} ${u6}`);
    ok(`w188 dump C (C+4): ${rC.exS} / ${rC.sps} of the hit's sprites have a game sprite's exact RGBA, within ${rC.worstSame.toFixed(2)} px (fitted on those)`, rC.exS >= 12 && rC.worstSame < 2.5, JSON.stringify(rC));
  }
} else console.log('  (no tools/trace/out/w188_fx: the type 21 / 137 RAM and line checks are skipped)');
console.log(`${checks - fails}/${checks} checks passed`);
process.exit(fails ? 1 : 0);
