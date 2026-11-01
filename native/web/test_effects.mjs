// node native/web/test_effects.mjs
// Checks effects.js (the FED particle engine, worker 0179) against the game.
// Needs data/effects (python3 -I native/assets/models/export_web_effects.py). The game-derived parts
// need tools/trace/out/w179_fx/ (gitignored; notes/effects-research.md "Evidence"):
//   state1..5.json  emitters / particles / camera read from five PCSX2 save states taken during
//                   tools/trace/scripts/w172_sound3.json (frames 837 / 875 / 914 / 956 / 998)
//   dump1/4.json    the effect-texture triangles of the GS dumps taken next to states 1 and 4 (the dump
//                   frame is 4 game frames after its state: PCSX2 starts the dump late)
import { readFileSync, existsSync } from 'node:fs';
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
  // the hit normal's sign is not decoded: floor / ceiling hits (|n.y| > 0.9) get no effect, with a warning
  const wl = [];
  ok('wall id: |n.y| > 0.9 (floor or ceiling) -> no effect', wallImpactId(ids, 1, [0, -0.95, 0], m => wl.push(m)) === -1 &&
    wallImpactId(ids, 1, [0, 0.95, 0]) === -1 && wl.length === 1);
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
  const fx = createEffects({ fed, core, warn: () => {} });
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
  new Uint8Array(b)[param + 0x1d] = 1;
  const w = [], fx = createEffects({ fed: b, core, warn: m => w.push(m), rng: new EffectRng(1) });
  fx.begin(1.2); fx.spawn(0x43400, [0, 0, 30]); fx.end(); fx.update(1.2);
  ok('emitter param +0x1d != 0: not drawn, warned', fx.sprites({ toView: p => p.slice(0, 3) }).length === 0 && w.some(m => m.includes('+0x1d')));
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
      const P = pj.P, F = e.lists && createEffects({ fed, core }).fed;
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
  let n = 0, exact = 0, worst = 0, sum = 0, zWorst = 0;
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
      if (same) exact++;
      else console.log(`  state ${s} age ${em.age.toFixed(1)}: ${tex0} rgba ${JSON.stringify(sprite.verts[0].rgba)} vs ${q.tex0} ${JSON.stringify(q.v[0][6])}`);
    }
  }
  ok(`dump ${s}: sprites drawn`, n >= 9, `${n}`);
  ok(`dump ${s}: every sprite's TEX0, ALPHA, ST and vertex RGBA equal the game's`, exact === n, `${exact}/${n}`);
  console.log(`  dump ${s}: corners worst ${worst.toFixed(3)} px, mean ${(sum / n).toFixed(3)} px; GS Z worst ${(zWorst * 100).toFixed(3)}%`);
  ok(`dump ${s}: corners within 1 px (worst ${worst.toFixed(2)}, mean ${(sum / n).toFixed(2)})`, worst < 1.0, `${worst}`);
  ok(`dump ${s}: GS Z within 0.3% (worst ${(zWorst * 100).toFixed(2)}%)`, zWorst < 0.003, `${zWorst}`);
}
console.log(`${checks - fails}/${checks} checks passed`);
process.exit(fails ? 1 : 0);
