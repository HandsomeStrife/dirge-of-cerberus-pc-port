// test_tracer.mjs (worker 0278; notes/effects-research.md 'Bullet tracers'): the bullet tracer, decoded from FUN_005534f0 /
// FUN_002d77c0 / FUN_00557d70 / FUN_002d7a70. (1) core_ef.bin's model 0 through the load's relocation (FUN_002f5460); (2) which
// shots get one: every shot type fired through enemy_ai with shot_fx (Vincent's pellets, a soldier's shot, the marker shots with a
// trail record, the rockets) and the tracer's fields as the game sets them (spawn length 0.01, then |pos - prev|, colour by
// +0x120 bit 0x400, freed at the delete, 32 at most); (3) the drawn quads (FUN_002d93d0 look-at, FUN_002d8438 scale, FUN_002f5c50).
// T (when present, gitignored): tools/trace/out/w278_tracer.calls.jsonl (TRACE_CALLLOG=w278tracer): per tracer the game's fields and
// its scale x look-at / x view x projection matrices; tools/trace/out/w278/dump*.json (dumpfx.py): the tracer quads in GS dumps.
//   node native/web/test_tracer.mjs      (SHOT_FX_JS / EFFECTS_JS / ENEMY_AI_JS = another copy, for mutants)
import path from 'node:path';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const need = ['data/enemies/ai.json', 'data/effects/core_ef.bin', 'data/aim/weapon.json'];
if (need.some(f => !existsSync(path.join(here, f)))) { console.log('SKIP: data missing (run tools/byo/build_web.sh)'); process.exit(0); }
await import('./test_hooks.mjs');
{ // shot_fx.js imports the glTF loader: stubbed (no model is loaded here: loadModel gives none), as test_rockets
  const { register } = await import('node:module');
  register('data:text/javascript,' + encodeURIComponent(`export async function resolve(spec, ctx, next) {
    if (spec.startsWith('three/addons/')) return { url: 'data:text/javascript,' + encodeURIComponent('export class GLTFLoader { loadAsync() { return Promise.reject(new Error("no loader")); } } export function clone(x) { return x; }'), shortCircuit: true };
    return next(spec, ctx); }`));
}
const E = await import(pathToFileURL(process.env.EFFECTS_JS || path.join(here, 'effects.js')).href);
const AI = await import(pathToFileURL(process.env.ENEMY_AI_JS || path.join(here, 'enemy_ai.js')).href);
const SF = await import(pathToFileURL(process.env.SHOT_FX_JS || path.join(here, 'shot_fx.js')).href);
const data = JSON.parse(readFileSync(path.join(here, 'data/enemies/ai.json'), 'utf8'));
const WV = JSON.parse(readFileSync(path.join(here, 'data/aim/weapon.json'), 'utf8'));
const coreBuf = readFileSync(path.join(here, 'data/effects/core_ef.bin'));
const core = coreBuf.buffer.slice(coreBuf.byteOffset, coreBuf.byteOffset + coreBuf.byteLength);
const Fc = E.byteReader(core), tex = E.parseCore(core);
let fails = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const f = Math.fround, len = v => Math.hypot(v[0], v[1], v[2]);

// 1. the model: R = core +0x3c, the type-4 table R + R +0x10, entry 0 relative to R (FUN_002f5460 / FUN_002f53f0(core, R, 4))
const m0 = E.coreModel(Fc, 0);
{
  ok(m0 === 0x720, `core_ef.bin model 0 at 0x${m0.toString(16)} (RAM 0xeb0720 in the save states: DAT_0050b5a8[0])`);
  const lo = Fc.u32(m0 + 0x20 + 8), hi = Fc.u32(m0 + 0x20 + 12);
  ok(Fc.u32(m0) === 7 && Fc.u8(m0 + 0x21) === 6 && Fc.s16(m0 + 0x22) === 8 && Fc.u16(m0 + 0x12) === 20 && Fc.u8(m0 + 0x16) === 0x48,
    'model flags 7 (no cull, no flag 8), one command: 8 textured quads, 20 vertices, ALPHA 0x48 (additive)');
  ok(tex.has(`${hi.toString(16)}:${lo.toString(16)}`) && tex.get(`${hi.toString(16)}:${lo.toString(16)}`).k === 7, 'its TEX0 is core_ef.bin texture 7');
  ok(Math.abs(Fc.f32(m0 + 0x18) * 32767 - 9.737) < 1e-3, `scale +0x18 ${Fc.f32(m0 + 0x18)}: 32767 units = 9.74 (x the length x 0.1 along z)`);
}

// a recording effect engine for shot_fx: its draw hook as effects.js sprites() calls it
function stubFx() {
  const hooks = [], spawned = [];
  return { hooks, spawned, core: Fc, tex, addDraw: h => hooks.push(h), spawn: (id, p) => { const em = { id, p: p.slice() }; spawned.push(em); return em; },
    setMatrix() {}, softEnd() {}, draw(view, proj = E.PROJ) { const out = []; for (const h of hooks) h(view, out, proj); return out; } };
}
// a view with no rotation that puts world point p at view z 300 (in front of the camera, on the screen centre; a tracer reaches
// 9.74 x its length x 0.1 back, and the vertices behind the camera are dropped as the game's w <= 0)
const viewAt = p => ({ toViewMatrix: () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -p[0], -p[1], 300 - p[2], 1]) });

function world(pp = [0, 0, 0]) {
  const player = { pos: pp.slice(), hp: 9999, id: 0x16, f118: 0, s64: 0 };
  const fx = stubFx(), warns = [];
  const shotFx = SF.createShotFx({ root: { add() {}, remove() {} }, fx, world: () => W, loadModel: () => null, warn: m => warns.push(m) });
  const W = AI.createEnemyAI({ data, player, rand: () => 0.5, quiet: true, log: () => {}, eventFlags: { 0: 13, 1: 8 },
    sound() {}, effect: { spawn: (id, p) => fx.spawn(id, p), hit() {}, wall() {} }, shotFx });
  return { W, fx, shotFx, player, warns };
}

// 2a. Vincent's shots: every pellet of FUN_00577480 (W from weapon.json; pellets / speed as the other weapons and ammo would set
// them: the path takes no record for any of them)
for (const [name, Wx] of [['weapon.json', WV], ['3 pellets', { ...WV, pellets: 3 }], ['fast', { ...WV, speed10: WV.speed10 * 2 }]]) {
  const { W, shotFx, fx } = world();
  W.playerShot([0, -10, 0], [0, -10, 500], Wx, null);
  const bs = W.bullets.filter(b => b.from === W.player || b.shooter === 0x16);
  const tr = bs.map(b => shotFx.live.get(b)?.tr);
  ok(bs.length === Wx.pellets && tr.every(Boolean) && shotFx.tracers.length === Wx.pellets,
    `Vincent (${name}): ${bs.length} pellets, ${shotFx.tracers.length} tracers (FUN_005408e8: no record -> FUN_002d77c0)`);
  ok(tr.every(t => t.colour === 0) && bs.every(b => b.f120 & 0x400), 'his bullets have +0x120 bit 0x400 (his +0x28 & 4): colour 0, blue (0x40, 0x60, 0xc8)');
  ok(tr.every(t => Math.abs(t.len - f(0.001)) < 1e-9 && len(t.dir) === 0), 'at the spawn: length 0.01 x 0.1 (bit 0x400000), no direction (pos = prev)');
  // FUN_005549f0 returns while +0x142 > 0 (pellet i: i + 2), before its FUN_00557e40: the tracer keeps the spawn state
  W.tick(1.2, [0, 0, 0], [0, 0, 0]);
  const held = bs.filter(b => b.delay > 0 && W.bullets.includes(b));
  ok(held.length === bs.length && held.every(b => { const t = shotFx.live.get(b).tr; return Math.abs(t.len - f(0.001)) < 1e-9 && len(t.dir) === 0; }),
    `during the delay (+0x142 > 0, ${held.length} pellets): no FUN_00557e40, the tracer keeps length 0.001 and no direction`);
  let moved = null;
  for (let i = 0; i < 6 && !moved; i++) { W.tick(1.2, [0, 0, 0], [0, 0, 0]); moved = bs.find(b => b.age > 0 && W.bullets.includes(b)); }
  const t = moved && shotFx.live.get(moved)?.tr;
  const d = moved && moved.pos.map((x, k) => x - moved.prev[k]);
  ok(t && Math.abs(t.len - len(d) * 0.1) < 1e-4 && len(t.dir.map((x, k) => x + d[k] / len(d))) < 1e-5 && t.pos.every((x, k) => x === moved.pos[k]),
    `after a move: +0x10 = pos, +0x20 = -unit(pos - prev), +8 = |pos - prev| x 0.1 = ${t?.len.toFixed(3)} (speed ${moved?.speed.toFixed(2)} x 1.2 x 0.1)`);
  const q = fx.draw(viewAt(moved.pos)).filter(p => p.tracer === t);
  ok(q.length === 8 && q.every(p => p.alpha === 0x48 && p.tex && p.tex.k === 7 && p.tracer), `drawn: ${q.length} quads (8 per moved tracer), ALPHA 0x48, texture 7`);
  for (let i = 0; i < 400 && W.bullets.some(b => bs.includes(b)); i++) W.tick(1.2, [0, 0, 0], [0, 0, 0]);
  ok(!W.bullets.some(b => bs.includes(b)) && shotFx.tracers.length === 0, 'the bullets end (range): their tracers are freed (FUN_005529a8 -> FUN_002d78a0)');
}

// 2b. a soldier's shot (record 44, #66, e027: weapon 2 -> bullet record 2: no model, no trail) and the marker shots
{
  const { W, shotFx, fx } = world([0, 0, 300]);
  const id = 44 + 22;
  W.t.send(W.objects.get(id), -2, 0x108, [0, 0, 0, 0]);
  W.tick(1.2, [0, 0, 300], [0, 0, 300]);
  const a = W.objects.get(id), Wx = data.weapons[data.records[44].weapon];
  ok(Wx.bullet >= 0 && data.weapons[Wx.bullet].model === '' && data.weapons[Wx.bullet].fx_trail === -1, `#66's weapon ${data.records[44].weapon}: bullet record ${Wx.bullet}, no model, no trail`);
  const n0 = W.bullets.length;
  W.t.spawnShot(a, [a.pos[0], a.pos[1] - 10, a.pos[2] + 200], [a.pos[0], a.pos[1] - 10, a.pos[2]], Wx);
  const b = W.bullets[n0], t = b && shotFx.live.get(b)?.tr;
  ok(t && t.colour === 1 && !(b.f120 & 0x400), 'his bullet: a tracer, +0x120 bit 0x400 clear (side 1, no +0x28 & 4): colour 1, orange (0xc8, 0x64, 0x20)');
  for (let i = 0; i < 6 && !(b.age > 0); i++) W.tick(1.2, [0, 0, 300], [0, 0, 300]);   // +0x142 = 2: two frames at the spawn state
  const q = fx.draw(viewAt(b.pos)).filter(p => p.tracer === t);
  ok(b.age > 0 && q.length === 8 && q.every(p => p.verts.every(v => v.rgba[1] <= 0x64 && v.rgba[2] <= 0x20)), `moved, drawn: ${q.length} quads in its colour (vertex bytes x colour / 128)`);
  // a soldier with side 0 (an ally: FUN_00563288 == 0) gets bit 0x400 (blue)
  a.f188 = 0;
  W.t.spawnShot(a, [a.pos[0], a.pos[1] - 10, a.pos[2] + 200], [a.pos[0], a.pos[1] - 10, a.pos[2]], Wx);
  ok(shotFx.live.get(W.bullets[W.bullets.length - 1])?.tr?.colour === 0, 'side 0: +0x120 bit 0x400 set, colour 0 (FUN_0055fe40)');
  delete a.f188;
  // the rockets (record 25: model w011 and a trail) and record 26 (a trail, no model): no tracer
  for (const k of [25, 26]) {
    const n = W.bullets.length, tn = shotFx.tracers.length;
    W.t.spawnShot(a, [a.pos[0], a.pos[1] - 10, a.pos[2] + 200], [a.pos[0], a.pos[1] - 10, a.pos[2]], data.weapons[k]);
    const bk = W.bullets[n];
    ok(bk && shotFx.live.get(bk) && !shotFx.live.get(bk).tr && shotFx.tracers.length === tn, `weapon ${k} (record ${data.weapons[k].bullet}: model '${data.weapons[data.weapons[k].bullet].model}', trail 0x${(data.weapons[data.weapons[k].bullet].fx_trail >>> 0).toString(16)}): no tracer`);
  }
}

// 2c. the pool: 32 slots; more bullets get the dummy (not drawn)
{
  const { W, shotFx } = world();
  for (let i = 0; i < 12; i++) W.playerShot([0, -10, 0], [i, -10, 500], { ...WV, pellets: 3 }, null);
  ok(shotFx.tracers.length === 32 && W.bullets.length === 36, `36 bullets: ${shotFx.tracers.length} tracers in the list (DAT_004e8e00 has 0x20 slots)`);
}

// 3. the geometry: FUN_002d93d0 / FUN_002d8438 by hand for one tracer, and the 8 quads
{
  const tr = { model: 0, colour: 1, len: f(8), pos: [100, -20, 50], dir: [0.6, 0, -0.8].map(f) };
  const M = E.tracerMatrix(tr, Fc.f32(m0 + 0x18));
  const s = Fc.f32(m0 + 0x18);
  // up (0, 1, 0) x d = (-0.8, 0, -0.6); row 2 = d; row 1 = d x row 0 = (0, 1, 0)
  const want = [-0.8 * s, 0, -0.6 * s, 0, 0, s, 0, 0, 0.6 * 8 * s, 0, -0.8 * 8 * s, 0, 100, -20, 50, 1];
  ok(M.every((x, i) => Math.abs(x - want[i]) < 1e-9), 'scale x look-at: rows (up x d) s, (d x row 0) s, d x len s, pos');
  // FUN_002d93d0's up: 0x46c710 (0, 0, 1) only when the words d.x and d.z are both 0 (+0.0). d = (0, 1, 0): (0, 0, 1) x d =
  // (-1, 0, 0), row 1 = d x row 0 = (0, 0, 1). d = (-0, 1, -0) (a zero step's negation, FUN_002d76a8): 0x46c700 (0, 1, 0), up x d
  // = 0 and FUN_00444ad0's VDIV by 0 (the largest float) x 0 leaves rows 0 and 1 zero
  const Lv = E.tracerLookAt([1, 2, 3], [0, 1, 0]), Ln = E.tracerLookAt([1, 2, 3], [-0, 1, -0]);
  ok([-1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 2, 3, 1].every((x, i) => Lv[i] === x), 'd = (0, 1, 0): up (0, 0, 1) (d.x, d.z +0), row 0 (-1, 0, 0), row 1 (0, 0, 1)');
  ok([0, 1, 2, 4, 5, 6].every(i => Ln[i] === 0) && Ln[9] === 1, 'd = (-0, 1, -0): up (0, 1, 0) (-0 is not the word 0), rows 0 and 1 zero');
  // each drawn vertex = the model's (x, y, z) through M, then the view; colour = the vertex bytes x (0xc8, 0x64, 0x20, 0xc8) / 128
  const out = [], V = viewAt(tr.pos).toViewMatrix();
  E.drawTracer(Fc, tex, tr, viewAt(tr.pos), E.PROJ, out, () => {});
  const vb = m0 + Fc.u32(m0 + 8), c = m0 + Fc.u32(m0 + 4);
  let worst = 0, colOk = true;
  out.forEach((p, e) => p.verts.forEach((v, j) => {
    const r = c + 16 + 40 * e, vi = Fc.u16(r + 0x10 + 2 * j);
    const x = Fc.s16(vb + 6 * vi), y = Fc.s16(vb + 6 * vi + 2), z = Fc.s16(vb + 6 * vi + 4);
    const w = [0, 1, 2].map(k => x * M[k] + y * M[4 + k] + z * M[8 + k] + M[12 + k]);
    const pv = [0, 1, 2].map(k => w[0] * V[k] + w[1] * V[4 + k] + w[2] * V[8 + k] + V[12 + k]);
    worst = Math.max(worst, len(pv.map((u, k) => u - v.pos[k])));
    const word = Fc.u32(r + 4 * j), want = [0xc8, 0x64, 0x20, 0xc8].map((cc, k) => Math.max(k === 3 ? 1 : 0, Math.trunc(((word >>> (8 * k)) & 0xff) * cc / 128)));
    if (want.some((u, k) => u !== v.rgba[k])) colOk = false;
  }));
  ok(out.length === 8 && worst < 1e-3, `8 quads, every vertex = model point x scale x look-at x view (worst ${worst.toExponential(2)} u)`);
  ok(colOk, 'every vertex colour = its bytes x the colour / 128 (alpha at least 1: VMAX (0, 0, 0, 1))');
  // view z = -0.8 x (z_m s 8) - 0.6 x (x_m s): from the glow's front corner (z_m -1682, x_m -3672) to its back one (32767, -3672)
  const zs = out.flatMap(p => p.verts.map(v => v.pos[2] - 300)), sc = Fc.f32(m0 + 0x18);
  const zf = -0.8 * -1682 * sc * 8 - 0.6 * -3672 * sc, zb = -0.8 * 32767 * sc * 8 - 0.6 * 3785 * sc;
  ok(Math.abs(Math.max(...zs) - zf) < 0.01 && Math.abs(Math.min(...zs) - zb) < 0.01, `it spans from 4.0 u ahead of pos (the glow's z -1682) to 77.9 u behind it (32767 x s x 8): view z ${Math.min(...zs).toFixed(2)} .. ${Math.max(...zs).toFixed(2)} (want ${zb.toFixed(2)} .. ${zf.toFixed(2)})`);
}

// T: the game's tracers (call log) against the page's fields and matrices
const T = path.join(here, '../../tools/trace/out/w278_tracer.calls.jsonl');
if (existsSync(T)) {
  const L = readFileSync(T, 'utf8').trim().split('\n').map(l => JSON.parse(l)).filter(e => e.hook);
  const fl = w => new Float32Array(new Uint32Array(w).buffer);
  const words = e => e['a0+0x0'].u.map(h => parseInt(h, 16));
  let n = 0, worstSO = 0, worstMVP = 0, cams = new Map();
  for (const e of L) if (e.hook === 'cam' && e.a0 === '0x70003f80') cams.set(e.frame, fl(words(e)));
  for (let i = 0; i < L.length; i++) {
    const e = L[i];
    if (e.hook !== 'tr') continue;
    const w = words(e), F = fl(w);
    const tr = { model: w[1] & 0xff, colour: (w[1] >> 8) & 0xff, len: F[2], pos: [F[4], F[5], F[6]], dir: [F[8], F[9], F[10]] };
    // the logger runs after each call returns: FUN_002d7a70's own two products come just before its 'tr' entry
    const so = L[i - 2]?.hook === 'so' ? L[i - 2] : null, mvp = L[i - 1]?.hook === 'mvp' ? L[i - 1] : null;
    if (!so || !mvp) continue;
    const M = E.tracerMatrix(tr, Fc.f32(m0 + 0x18)), G = fl(words(so));
    for (let k = 0; k < 16; k++) if (k % 4 !== 3) worstSO = Math.max(worstSO, Math.abs(M[k] - G[k]) / Math.max(1, Math.abs(G[k])));
    const VP = cams.get(e.frame), Gm = fl(words(mvp));
    if (VP) for (let r = 0; r < 4; r++) for (let j = 0; j < 4; j++) {
      let a = 0; for (let k = 0; k < 4; k++) a += (k === 3 ? (r === 3 ? 1 : 0) : M[4 * r + k]) * VP[4 * k + j];
      worstMVP = Math.max(worstMVP, Math.abs(a - Gm[4 * r + j]) / Math.max(1, Math.abs(Gm[4 * r + j])));
    }
    n++;
  }
  ok(n > 0 && worstSO < 1e-5 && worstMVP < 1e-4, `T: ${n} drawn tracers of w278_tracer: scale x look-at = the game's (worst rel ${worstSO.toExponential(2)}), x camera +0x1d0 = its draw matrix (${worstMVP.toExponential(2)})`);
  // the GS dumps of grab_gs w278_tracer 904 / 944 (states at f905 / f945, dumps 4 frames later: f909 / f949): every tracer the game
  // drew that frame through the page's drawTracer with the logged camera (+0x150 view; +0x110 projection: fx P0, fy P5, cx P8, cy P9,
  // Z = P14 / z + P10), against the dump's texture-7 triangles in draw order (each quad a strip: (0 1 2), (1 2 3))
  for (const [fr, file] of [[909, 'dump_g1.json'], [949, 'dump_g2.json']]) {
    const D = path.join(here, '../../tools/trace/out/w278', file);
    if (!existsSync(D)) { console.log(`SKIPPED T: tools/trace/out/w278/${file} (dumpfx.py of the w278 grab) not present`); continue; }
    const dump = JSON.parse(readFileSync(D, 'utf8'));
    const camOf = a0 => fl(words(L.find(x => x.hook === 'cam' && x.frame === fr && x.a0 === a0)));
    const V = camOf('0x70003f00'), P = camOf('0x70003f40');
    const proj = { fx: P[0], fy: P[5], cx: P[8], cy: P[9], zA: P[14], zB: P[10] };
    const out = [], cols = [];
    for (const e of L.filter(x => x.hook === 'tr' && x.frame === fr)) {
      const w = words(e), F = fl(w), tr = { model: w[1] & 0xff, colour: (w[1] >> 8) & 0xff, len: F[2], pos: [F[4], F[5], F[6]], dir: [F[8], F[9], F[10]] };
      cols.push(tr.colour + (tr.len > 0.01 ? ' moved' : ''));
      E.drawTracer(Fc, tex, tr, { toViewMatrix: () => V }, proj, out, () => {});
    }
    const page = out.flatMap(p => [[p.verts[0], p.verts[1], p.verts[2]], [p.verts[1], p.verts[2], p.verts[3]]]);
    const seq = dump.filter(t => t.tex0 === '0x4007bd06613137c0');
    const k0 = seq.findIndex(t => t.v.some(v => v[6][3] === 200) && new Set(t.v.map(v => v[6].join())).size > 1);
    let xy = 0, zr = 0, rgba = 0, st = 0, nv = 0;
    page.forEach((q, i) => q.forEach((u, j) => {
      const v = seq[k0 + i]?.v[j];
      if (!v) { xy = Infinity; return; }
      xy = Math.max(xy, Math.hypot(u.gs[0] - v[0], u.gs[1] - v[1])); zr = Math.max(zr, Math.abs(u.gs[2] - v[2]) / v[2]);
      if (u.rgba.every((c, k) => c === v[6][k])) rgba++;
      st = Math.max(st, Math.abs(u.uv[0] - v[3] / v[5]), Math.abs(u.uv[1] - v[4] / v[5])); nv++;
    }));
    ok(k0 >= 0 && page.length >= 16 && xy <= 0.0625 && zr < 1e-5 && rgba === nv && st < 1e-6,
      `T: GS dump f${fr} (tracers ${cols.join(', ')}): ${page.length} triangles in draw order, XY within ${xy.toFixed(4)} px, Z ${zr.toExponential(1)} rel, RGBA ${rgba} / ${nv} exact, ST ${st.toExponential(1)}`);
  }
} else console.log('SKIPPED T: tools/trace/out/w278_tracer.calls.jsonl (gitignored) not present');

console.log(fails ? `${fails} FAILED` : 'all ok');
process.exit(fails ? 1 : 0);
