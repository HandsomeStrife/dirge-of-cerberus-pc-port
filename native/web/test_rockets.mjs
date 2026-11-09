// test_rockets.mjs (worker 0270; notes/other-types.md 'The rockets drawn'): Dragonfly's rockets (weapon 25, record 25) as the game makes, flies, draws and
// ends them, without a page. (1) the bullet record: model w011, trail 0x405c0400, +0x2c 6, +0x120 bit 0x800 (FUN_00554850); (2) the matrix rows
// (FUN_00552dd8, FUN_00556218's rebuild); (3) the fat test on Vincent (FUN_005442d8 bit 0x800 -> FUN_0055c480): a rocket passing 9 u from his axis hits,
// a thin bullet there misses; (4) a rocket fired at him hits with the game's damage, the end blast 0x405c0800 and sound asj_374 from its own record, and the
// shot_fx hooks (start / move / end) run in the game's order; (5) the e023 model FED: the trail spawns and takes the bullet's matrix (FUN_002e7660 flag 0x10).
// T (when present, gitignored): tools/trace/out/w270_rockets(.calls).jsonl, the rockets' flight and the hit on Vincent.
//   node --import ./native/web/test_hooks.mjs native/web/test_rockets.mjs     (ENEMY_AI_JS=path: another enemy_ai.js copy; MUTATE=<name>: see below)
import path from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const AI = await import(pathToFileURL(process.env.ENEMY_AI_JS || path.join(here, 'enemy_ai.js')).href);
const { cylinderHit, fatCapsuleHit } = await import('./enemy_hit.js');
const E = await import(pathToFileURL(process.env.EFFECTS_JS || path.join(here, 'effects.js')).href);
const need = ['data/enemies/ai.json', 'data/effects/r0001.fed', 'data/effects/core_ef.bin'];
if (need.some(f => !existsSync(path.join(here, f)))) { console.log('SKIP: data missing (run tools/byo/build_web.sh)'); process.exit(0); }
const data = JSON.parse(readFileSync(path.join(here, 'data/enemies/ai.json'), 'utf8'));
let fails = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const ID = 31 + 22;
const len = v => Math.hypot(v[0], v[1], v[2]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// 1. the record
{
  const W = data.weapons[25], R = data.weapons[W.bullet];
  ok(W.bullet === 25 && R.model === 'w011' && (R.fx_trail >>> 0) === 0x405c0400 && (R.fx_end >>> 0) === 0x405c0800 && R.f2c === 6 && (R.f78 & 2) && R.se_end === 'asj_374',
    `weapon 25's bullet record: model ${R.model}, trail 0x${(R.fx_trail >>> 0).toString(16)}, end 0x${(R.fx_end >>> 0).toString(16)}, +0x2c ${R.f2c}, +0x78 0x${R.f78.toString(16)}, end sound ${R.se_end}`);
  const boss = [17, 18, 19].map(k => data.weapons[data.weapons[k].bullet]);
  ok(boss.every(r => r.model === 'w011' && (r.fx_trail >>> 0) === 0x40600400 && r.f2c === 6), 'the boss\'s missiles (17-19): w011, trail 0x40600400 (e024\'s FED), +0x2c 6');
}

// a world with Dragonfly (record 31) and Vincent at pp; the body's bone 2 at its position, no turn (marker shots need a pose)
function world(pp, hooks = null, extra = {}) {
  const player = { pos: pp.slice(), hp: 9999, id: 0x16, f118: 0, s64: 0 };
  const fx = [], snd = [];
  const W = AI.createEnemyAI({ data, player, rand: () => 0.5, quiet: true, log: () => {}, eventFlags: { 0: 13, 1: 8 },
    sound: (n, p, r) => snd.push({ n, p: p ? p.slice() : null, r }),
    effect: { spawn: (id, p) => fx.push({ id, p: p.slice() }), hit() {}, wall() {} }, shotFx: hooks, ...extra });
  W.t.send(W.objects.get(ID), -2, 0x108, [0, 0, 0, 0]);
  W.tick(1.2, pp, pp);
  const a = W.objects.get(ID);
  W.boneWorld = () => () => [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [a.pos[0], a.pos[1], a.pos[2], 1]];
  return { W, a, player, fx, snd };
}

// 2. rows (FUN_00552dd8): +0x80 = dir, the helper axis = dir's smallest component, rows orthonormal; hand cases
{
  const pp = [0, 0, 0];
  const { W, a } = world(pp);
  const shoot = (dir) => {
    const start = W.t.markerWorld(a, 15), aim = start.map((x, k) => x + dir[k] * 100);
    return W.t.shootMarker(a, data.weapons[25], aim, 4, 15);
  };
  const b1 = shoot([1, 0, 0]), b2 = shoot([0, 0, 1]);
  ok(b1 && len(b1.r70.map((x, k) => x - [0, -1, 0][k])) < 1e-6 && len(b1.r60.map((x, k) => x - [0, 0, 1][k])) < 1e-6,
    `dir (1, 0, 0): h = z (|y| = |z|), +0x70 = dir x z = ${b1?.r70}, +0x60 = ${b1?.r60}`);
  ok(b2 && len(b2.r70.map((x, k) => x - [-1, 0, 0][k])) < 1e-6, `dir (0, 0, 1): h = y, +0x70 = ${b2?.r70}`);
  const b3 = shoot([0.1, 0.9, 0.4].map(x => x / Math.hypot(0.1, 0.9, 0.4)));
  const ortho = b => Math.abs(dot(b.r60, b.r70)) < 1e-5 && Math.abs(dot(b.r60, b.dir)) < 1e-5 && Math.abs(dot(b.r70, b.dir)) < 1e-5 && Math.abs(len(b.r60) - 1) < 1e-5 && Math.abs(len(b.r70) - 1) < 1e-5;
  ok(b3 && ortho(b3) && Math.abs(b3.r70[0]) < 1e-6, `dir (0.1, 0.9, 0.4): h = x (+0x70 has no x: ${b3?.r70.map(v => v.toFixed(3))}), rows orthonormal`);
  // FUN_00556218: after a turn the rows follow the new dir (+0x60 = unit(+0x70 x dir), +0x70 = unit(dir x +0x60))
  const b = shoot([1, 0, 0]);
  b.target = null; b.end = [b.pos[0], b.pos[1], b.pos[2] + 300];           // homing on +0xd0 (no +0x12a target)
  for (let i = 0; i < 30; i++) W.tick(1.2, pp, pp);
  ok(b && ortho(b) && dot(b.dir, [1, 0, 0]) < 0.999, `after ${30} homing steps (dir ${b?.dir.map(v => v.toFixed(2))}) the rows are rebuilt: orthonormal with the new dir`);
  const M = W.bulletMatrix(b);
  ok(M.length === 16 && M[12] === b.pos[0] && M[10] === b.dir[2] && M[15] === 1, 'bulletMatrix: rows +0x60 / +0x70 / +0x80 / +0x90 (FUN_0054a5e8)');
}

// 3. the fat test's geometry: R 5 + rad 6 around a capsule padded by 6 at both ends (FUN_0055c480)
{
  const A = [0, 0, 0], B = [0, -18, 0];
  const at = x => [[x, -9, -50], [x, -9, 50]];
  ok(!!fatCapsuleHit(6, 5, ...at(9), A, B) && !cylinderHit(5, ...at(9), A, B), 'a segment 9 u from his axis: the fat test hits (5 + 6), the thin cylinder misses');
  ok(!fatCapsuleHit(6, 5, ...at(11.5), A, B), 'at 11.5 u: no hit');
  ok(!!fatCapsuleHit(6, 5, [0, 4, -50], [0, 4, 50], A, B) && !cylinderHit(5, [0, 4, -50], [0, 4, 50], A, B), '4 u below his feet: inside the padded capsule (end + 6)');
  const p = fatCapsuleHit(6, 5, [2, -9, 0], [2.5, -9, 0], A, B);
  ok(p && Math.abs(Math.hypot(p.point[0], p.point[2]) - 5) < 1e-6, `starting inside: FUN_0025d1b8 puts the point on his surface (${p?.point.map(v => v.toFixed(2))})`);
}

// 4. a rocket at Vincent: fat hit, damage, the end effect / sound from the rocket's own record, the hooks
{
  const calls = [];
  const hooks = { start: b => calls.push(['start', b.id]), move: b => calls.push(['move', b.id, b.pos.slice()]), end: b => calls.push(['end', b.id]) };
  const pp = [0, 0, 0];
  const { W, a, player, fx, snd } = world(pp, hooks);
  const target = [0, -9, 0];
  // fired from 150 u off at his middle; Dragonfly's own W (a.ai.W) is not weapon 25
  const start0 = W.t.markerWorld(a, 15);
  a.pos = [a.pos[0] - start0[0] + 150, a.pos[1] - start0[1] - 9, a.pos[2] - start0[2]];
  const b = W.t.shootMarker(a, data.weapons[25], target, 4, 15);
  ok(b && (b.f120 & 0x800) && b.f2c === 6 && b.rec === data.weapons[25] && b.W === data.weapons[25], `the rocket: +0x120 0x${b?.f120.toString(16)} (bit 0x800), +0x2c ${b?.f2c}, its own W and record`);
  ok(snd.some(s => s.n === 'asj_354'), 'its flight sound asj_354 (record +0x94, FUN_0033d788) at the spawn');
  const hp0 = player.hp;
  let t = 0;
  while (W.bullets.includes(b) && t++ < 200) W.tick(1.2, pp, pp);
  ok(!W.bullets.includes(b) && player.hp < hp0, `it hits Vincent after ${t} frames: HP ${hp0} -> ${player.hp}`);
  ok(hp0 - player.hp === 78, `damage ${hp0 - player.hp} (80 through his defence; T w259_heli2: -78)`);
  const blast = fx.find(e => e.id === 0x405c0800);
  ok(!!blast && Math.hypot(blast.p[0], blast.p[2]) < 11.5, `the end blast 0x405c0800 (record +0xb0) at the hit point ${blast?.p.map(v => v.toFixed(1))}`);
  ok(snd.some(s => s.n === 'asj_374' && s.r === 400), 'the end sound asj_374 (record +0x9c, FUN_0033d760 -> FUN_0033cc48, range 400)');
  const kinds = calls.filter(c => c[1] === b.id).map(c => c[0]);
  ok(kinds[0] === 'start' && kinds[kinds.length - 1] === 'end' && kinds.slice(1, -1).every(k => k === 'move') && kinds.length > 3,
    `shot_fx hooks: start, ${kinds.length - 2} moves, end (FUN_005534f0, FUN_00557e40 each moved frame, FUN_005529a8)`);
  // a rocket that passes 9 u beside his axis with no turn (+0x154 = 0, no target): hit by the fat test only (5 + 6 > 9)
  {
    const s0 = W.t.markerWorld(a, 15);
    a.pos = [a.pos[0] - s0[0] + 9, a.pos[1] - s0[1] - 9, a.pos[2] - s0[2] - 150];
    const hp1 = player.hp, c = W.t.shootMarker(a, data.weapons[25], [9, -9, 150], 4, 15);
    c.target = null; c.home = 0;
    let n = 0;
    while (W.bullets.includes(c) && n++ < 200) W.tick(1.2, pp, pp);
    ok(player.hp === hp1 - 78, `a rocket 9 u beside his axis hits him (fat test, radius 6): HP ${hp1} -> ${player.hp}`);
  }
  const firstMove = calls.find(c => c[0] === 'move' && c[1] === b.id);
  ok(firstMove && len(firstMove[2].map((x, k) => x - b.start[k])) > 0, 'no move during the +0x142 countdown (the first move is after the bullet left the start)');
}

// 4b. FUN_005442d8 measures every candidate from the same start (the padded A' for a fat bullet). A rocket 13 u from his axis flying straight at him: its
// first step (prev 13 -> pos 10 u, A' at 19) meets the fat capsule (5 + 6) at 11 u, 8 u from A'; a barrel at the step's end (pos) is 9 u from A' (3 from
// prev): Vincent is nearer and takes the hit. Measured from prev for the barrel only, it would win (3 < 8) and he would take nothing.
{
  const got = [];
  const props = { bulletTest: b => (b.f120 & 0x800) ? { point: b.pos.slice(), dist: Math.hypot(...b.pos.map((x, k) => x - b.prev[k])), o: 'barrel' } : null,
    bulletHit: () => { got.push('barrel'); return 1; }, mgr: () => undefined, cmd: () => undefined, nodeBoxes() {}, update() {}, id: () => -1, attach() {} };
  const pp = [0, 0, 0];
  const { W, a, player } = world(pp, null, { props });
  const s0 = W.t.markerWorld(a, 15);
  a.pos = [a.pos[0] - s0[0] + 13, a.pos[1] - s0[1] - 9, a.pos[2] - s0[2]];
  const c = W.t.shootMarker(a, data.weapons[25], [0, -9, 0], 4, 15);
  c.target = null; c.home = 0; c.dir = [-1, 0, 0]; c.end = [-100, -9, 0];
  const hp0 = player.hp;
  for (let i = 0; i < 6 && W.bullets.includes(c); i++) W.tick(1.2, pp, pp);
  ok(!W.bullets.includes(c) && player.hp === hp0 - 78 && got.length === 0, `a barrel 3 u past his fat-test point: he is nearer from the padded start (HP ${hp0} -> ${player.hp}, barrel hits ${got.length}; hit point ${c.hitPoint?.map(v => v.toFixed(1))})`);
}

// 4c. shot_fx.js against a recording effect engine (no model: loadModel gives none, so no three.js is needed): the trail takes the bullet's matrix with rows
// 0 and 2 negated (FUN_003350c0 -> FUN_002e7660 flag 0x10), and the flight sound (record +0x94, slot +0x18c) is stopped at the rocket's delete
// (FUN_005529a8 -> FUN_0033cf00) and by clear() (a Restart's new world), once each.
{
  const { register } = await import('node:module');
  register('data:text/javascript,' + encodeURIComponent(`export async function resolve(spec, ctx, next) {
    if (spec.startsWith('three/addons/')) return { url: 'data:text/javascript,' + encodeURIComponent('export class GLTFLoader { loadAsync() { return Promise.reject(new Error("no loader")); } } export function clone(x) { return x; }'), shortCircuit: true };
    return next(spec, ctx); }`));
  const { createShotFx } = await import(pathToFileURL(process.env.SHOT_FX_JS || path.join(here, 'shot_fx.js')).href);
  const set = [], stops = [], plays = [];
  const fxRec = { spawn: (id, p) => ({ id, p120: [...p, 1], p130: [0, 0, 0, 0] }), setMatrix: (em, M) => set.push({ em, M: [...M] }), softEnd() {} };
  let W = null;
  const sfx = createShotFx({ root: { add() {}, remove() {} }, fx: fxRec, world: () => W, stopSound: s => stops.push(s), loadModel: () => null, warn: () => {} });
  const pp = [0, 0, 0], r = world(pp, sfx, { sound: (n) => { const t = { n }; plays.push(t); return t; }, soundStop: s => stops.push(s) });
  W = r.W;
  const fire = (dx) => { const s0 = W.t.markerWorld(r.a, 15); r.a.pos = [r.a.pos[0] - s0[0] + dx, r.a.pos[1] - s0[1] - 9, r.a.pos[2] - s0[2]]; return W.t.shootMarker(r.a, data.weapons[25], [0, -9, 0], 4, 15); };
  const c = fire(80), tok = plays.find(t => t.n === 'asj_354');
  for (let i = 0; i < 4; i++) W.tick(1.2, pp, pp);
  const last = set[set.length - 1], M = W.bulletMatrix(c);
  const neg = [0, 1, 2, 8, 9, 10], err = Math.max(...[0, 1, 2, 4, 5, 6, 8, 9, 10, 12, 13, 14].map(k => Math.abs(last.M[k] - (neg.includes(k) ? -M[k] : M[k]))));
  ok(set.length >= 3 && err < 1e-6 && last.M[15] === 1, `the trail's matrix = the bullet's rows 0 / 2 negated, row 1 and the position kept (${set.length} moves, largest error ${err})`);
  for (let i = 0; i < 200 && W.bullets.includes(c); i++) W.tick(1.2, pp, pp);
  ok(!W.bullets.includes(c) && tok && stops.filter(s => s === tok).length === 1, `the flight sound asj_354 is stopped once at the rocket's end (${stops.filter(s => s === tok).length})`);
  const d = fire(200), tok2 = plays.filter(t => t.n === 'asj_354').pop();
  W.tick(1.2, pp, pp); W.tick(1.2, pp, pp); W.tick(1.2, pp, pp);
  sfx.clear();
  ok(W.bullets.includes(d) && tok2 !== tok && stops.filter(s => s === tok2).length === 1 && sfx.live.size === 0, 'clear() (a Restart) stops a live rocket\'s flight sound and drops it');
}

// 4c2. FUN_005529a8 hands every bullet's +0x18c to FUN_0033cf00, not only the drawn ones' (whether that stops the sound: 4d): a soldier-type shot (weapon 0: no model, bullet sound bsj_063) with no shot_fx
{
  const plays = [], stops = [], pp = [0, 0, 0];
  const r = world(pp, null, { sound: (n) => { const t = { n }; plays.push(t); return t; }, soundStop: s => stops.push(s) });
  const W0 = data.weapons[0], b = r.W.t.shootMarker(r.a, W0, [0, -9, 0], 4, 15), tok = plays.find(t => t.n === W0.se_bullet);
  for (let i = 0; i < 200 && r.W.bullets.includes(b); i++) r.W.tick(1.2, pp, pp);
  ok(W0.se_bullet && tok && !r.W.bullets.includes(b) && stops.filter(s => s === tok).length === 1, `weapon 0's bullet sound ${W0.se_bullet} is released (FUN_0033cf00) once at the bullet's end (${stops.filter(s => s === tok).length})`);
}

// 4d. audio.js SoundEmitters.stop (FUN_0033cf00 -> FUN_003e9830): a pending slot gets 0x10000 and is still sent (worker 0271: it was
// dropped); a sent one is freed,
// and only a slot with flag 0x20 (sdb row bit 3, FUN_003e9b80) gets the stop request (0x12: SeRenderer.stopFade, time 10).
// bsj_063 (row flags 0) plays to its end; asj_354 (the rocket's flight, row flags 8) fades from the tick it has reached.
{
  const AU = await import(pathToFileURL(process.env.AUDIO_JS || path.join(here, 'audio.js')).href);
  const { SoundEmitters, SLOT_FLAGS, GameAudio, SeRenderer, SPU_RATE, TICK_HZ } = AU;
  const A0 = path.join(here, 'data/audio');
  if (!existsSync(path.join(A0, 'se_z128.json')) || !existsSync(path.join(A0, 'wave0000.bin'))) console.log('SKIPPED 4d (the bullet sounds stop): no data/audio (tools/audio/extract.py)');
  else {
    const j = f => JSON.parse(readFileSync(path.join(A0, f), 'utf8'));
    const ctx = { currentTime: 0, destination: {}, srcs: [],
      createBuffer(ch, n) { const d = [new Float32Array(n), new Float32Array(n)]; return { duration: n / SPU_RATE, length: n, d, copyToChannel: (a, c) => d[c].set(a) }; },
      createBufferSource() { const s = { connect() {}, start: (w, off = 0) => { s.off = off; }, stop: () => { s.stopped = true; } }; ctx.srcs.push(s); return s; } };
    const G = new GameAudio(); G.drv = j('driver.json'); G.se = j('se_z128.json'); G.res = null; G.ctx = ctx;
    const w = j('wave0000.json'); G.banks = { 0: { instruments: w.instruments, data: new Uint8Array(readFileSync(path.join(A0, 'wave0000.bin'))) } };
    G.renderers = { 0: new SeRenderer(G.drv, G.banks[0]) };
    const E = new SoundEmitters(G);
    E.setListener({ pos: [0, 0, 0, 1], m: null });
    const sb = E.play('bsj_063', [0, 0, 10]), sr = E.play('asj_354', [0, 0, 10]), sp = E.play('bsj_064', [0, 0, 10]);
    for (const s of [sb, sr, sp]) s.flags |= SLOT_FLAGS.NO3D;
    ok(!(sb.flags & SLOT_FLAGS.STOP) && (sr.flags & SLOT_FLAGS.STOP), `slot flag 0x20 from the row's bit 3: bsj_063 ${sb.flags & 0x20}, asj_354 ${sr.flags & 0x20}`);
    E.stop(sp);
    E.update();
    // worker 0271: FUN_003e9830 on a slot not sent yet sets 0x10000; its flag 2 (FUN_003e8bc8) keeps it, FUN_003e9ed0 sends it, and
    // without 0x20 the later FUN_003e9830 sends no stop: bsj_064 plays to its end
    ok(!!sp.p && G.playing.includes(sp.p) && !sp.p.stop, 'a pending bsj_064 (row flags 0) stopped before it is sent is still sent and plays to its end');
    {
      // a pending asj_354 (0x20): sent at the next FUN_003e9ed0, the stop request the frame after (its handle back): faded from
      // the driver tick heard then
      ctx.currentTime = 20; const s3 = E.play('asj_354', [0, 0, 10]); s3.flags |= SLOT_FLAGS.NO3D;
      E.stop(s3); E.update();
      const sent = !!s3.p && !s3.p.stop;
      ctx.currentTime = 20.02; E.update();
      ok(sent && s3.p.stop && s3.p.stop.tick === Math.floor(0.02 * TICK_HZ) && s3.p.stop.time === 10,
        `a pending asj_354 (0x20) stopped before it is sent: sent (${sent}), its stop request one frame later at tick ${s3.p && s3.p.stop && s3.p.stop.tick}`);
      ctx.currentTime = 0;
    }
    const pb = sb.p, pr = sr.p, srcB = pb.src, srcR = pr.src, bufR = pr.buf;
    const T = 60.5 / TICK_HZ;                          // mid-tick: tick 60 reached, half of it heard
    ctx.currentTime = T;
    E.stop(sb); E.stop(sr); E.stop(sr);
    ok(!srcB.stopped && G.playing.includes(pb), 'bsj_063 (row flags 0): freed, not stopped: it plays to its end');
    const tick = Math.floor(T * TICK_HZ), TS = SPU_RATE / TICK_HZ;
    const tail = (b, t) => { let m = 0; for (let i = Math.floor(t * SPU_RATE); i < b.length; i++) m = Math.max(m, Math.abs(b.d[0][i]), Math.abs(b.d[1][i])); return m; };
    ok(srcR.stopped && pr.src !== srcR && Math.abs(pr.src.off - T) < 1e-9 && pr.stop && pr.stop.tick === tick && pr.stop.time === 10 && ctx.srcs.filter(s => s.buffer === pr.buf).length === 1,
      `asj_354 (row flags 8): one stop request, a new source from ${T.toFixed(4)} s (stop tick ${pr.stop && pr.stop.tick})`);
    const endS = pr.buf.length / SPU_RATE;
    // the re-render is the old buffer through the stop tick; the fade shows at the next sequence step, within 2 driver ticks
    // (asj_354: stopFade at tick 60 -> first change in tick 61, at 61 -> 63, at 62 -> 63). Two mid-tick stops: 60.5 catches a
    // fade begun a tick late, 61.5 one begun a tick early (59 and 60 render the same)
    const firstChange = (a, b) => { for (let i = 0; i < a.length; i++) if (a.d[0][i] !== b.d[0][i] || a.d[1][i] !== b.d[1][i]) return i; return -1; };
    const d = firstChange(pr.buf, bufR);
    ok(d >= (tick + 1) * TS && d < (tick + 3) * TS, `stop at tick ${tick}.5: the faded render equals the old one through tick ${tick}, the fade starts within 2 ticks (first change at tick ${(d / TS).toFixed(2)})`);
    {
      ctx.currentTime = 10; const s2 = E.play('asj_354', [0, 0, 10]); s2.flags |= SLOT_FLAGS.NO3D; E.update();
      const p2 = s2.p, b2 = p2.buf; ctx.currentTime = 10 + 61.5 / TICK_HZ; E.stop(s2);
      const d2 = firstChange(p2.buf, b2);
      ok(p2.stop && p2.stop.tick === 61 && d2 >= 62 * TS && d2 < 64 * TS, `stop at tick 61.5: unchanged through tick 61, the fade within 2 ticks (first change at tick ${(d2 / TS).toFixed(2)})`);
    }
    ok(endS > 0.25 && endS < 1 && tail(bufR, endS) > 0.001,
      `... and the fade (10 x 96 / 60 sequence ticks, then the track ends) ends it ${(endS - T).toFixed(3)} s after the stop, where it was still sounding (${tail(bufR, endS).toFixed(4)}; ${bufR.length} -> ${pr.buf.length} samples)`);
  }
}

// 5. the trail: e023's FED in the manager, the bullet's matrix through FUN_002e7660 flag 0x10
{
  const f023 = path.join(here, 'data/effects/e023.fed');
  if (!existsSync(f023)) ok(false, 'data/effects/e023.fed missing (export_web_effects.py)');
  else {
    const buf = p => { const b = readFileSync(path.join(here, p)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); };
    const mk = models => E.createEffects({ fed: buf('data/effects/r0001.fed'), core: buf('data/effects/core_ef.bin'), warn: () => {}, rng: new E.EffectRng(1), models });
    const fx0 = mk([]), fx = mk([buf('data/effects/e023.fed')]);
    ok(!fx0.spawn(0x405c0400, [0, 0, 0]), 'without the model FED: no trail (FUN_002e5c60 finds no FED)');
    const em = fx.spawn(0x405c0400, [0, 0, 0]);
    ok(!!em, 'with it: the trail 0x405c0400 spawns');
    for (const ang of [[300, 700, -900], [100, 300, 1500]]) {            // the second: m0 < 0 (FUN_002d9cd0's pi branch)
      const R0 = E._internals.eulerT(E._internals.scaleM([1, 1, 1]), ang, [0, 0, 0], 0);
      const M = [...R0.slice(0, 12), 10, -20, 30, 1];
      if (em) fx.setMatrix(em, M);
      const back = !em ? [] : E._internals.eulerT(E._internals.scaleM([1, 1, 1]), em.p130, [0, 0, 0], 0);
      const err = Math.max(...[0, 1, 2, 4, 5, 6, 8, 9, 10].map(k => Math.abs(back[k] - M[k])));
      ok(em && em.p120[0] === 10 && em.p120[1] === -20 && em.p120[2] === 30 && err < 0.004, `setMatrix (angles ${ang}): +0x120 = row 3, +0x130 = FUN_002d9cd0's angles (${em?.p130.slice(0, 3).map(v => v.toFixed(1))}; rebuilt rows within ${err.toFixed(4)})`);
    }
  }
}

// T: w270_rockets (r06_market, w259_heli2's run, TRACE_CALLLOG=missile f1210-1419; gitignored) with w259_rockets (f1085-1290, the launch): every rocket step
// at FUN_00556870's object test (+0xe0 -> +0x90, the result v0). A call in frame N runs between records N - 1 and N (a record holds the state before its
// frame's logic: record 1313 already has the hit's HP and reaction), so Vincent's capsule is record N - 1's. The fat test (FUN_0055c480) must hit on
// the game's step and no other; the thin cylinder (the page's path before) never reaches him (the rocket passes 10.5 u from his axis).
{
  const fc = path.join(here, '../../tools/trace/out/w270_rockets.calls.jsonl'), fr = path.join(here, '../../tools/trace/out/w270_rockets.jsonl');
  if (!existsSync(fc) || !existsSync(fr)) console.log('SKIPPED T checks (rocket flight and the hit on Vincent): tools/trace/out/w270_rockets(.calls).jsonl not present (gitignored trace)');
  else {
    const J = l => JSON.parse(l.replace(/\bNaN\b/g, 'null'));
    const R = readFileSync(fr, 'utf8').trim().split('\n').map(J).slice(1);
    const C = readFileSync(fc, 'utf8').trim().split('\n').map(J).slice(1).filter(c => c['a3+0x124'].f[2] === 2.5);   // +0x12c 2.5: the rockets
    ok(C.length > 100 && C.every(c => parseInt(c['a3+0x120'].u[0], 16) & 0x800), `T: all ${C.length} rocket steps carry +0x120 bit 0x800`);
    const game = [], fat = [], thin = [];
    for (const c of C) {
      const r = R.find(x => x.frame === c.frame - 1);
      if (!r) continue;
      const a = c['a3+0xe0'].f.slice(0, 3), b = c['a3+0x90'].f.slice(0, 3), P = r.matrix[3].slice(0, 3), T = [P[0], P[1] - 18, P[2]];
      const v = b.map((x, k) => x - a[k]), n = Math.hypot(...v), e = v.map(x => x / n * data.weapons[25].f2c);
      if (c.v0) game.push(c.frame);
      if (fatCapsuleHit(data.weapons[25].f2c, 5, a.map((x, k) => x - e[k]), b.map((x, k) => x + e[k]), P, T)) fat.push(c.frame);
      if (cylinderHit(5, a, b, P, T)) thin.push(c.frame);
    }
    ok(game.length === 1 && fat.join() === game.join(), `T: the game's hit on Vincent at f${game} = the fat test's (${fat.join(', ') || 'none'}), on all ${C.length} steps`);
    ok(thin.length === 0, `T: the thin test hits on ${thin.length} steps (it can't reach him)`);
    const hp = f => R.find(x => x.frame === f)?.p_hp;
    ok(hp(game[0] - 1) - hp(game[0]) === 78, `T: Vincent ${hp(game[0] - 1)} -> ${hp(game[0])} at that hit (78, as the page's)`);
  }
}

// T: the z128 boss's homing volley (state 6) on the walked route r0b_box4: w270_boss_missiles (TRACE_CALLLOG=missile, f2125-2199) for the steps,
// w259_boss_box4c (the same run) for Vincent's HP. The fat test hits on the game's step; the page's weapon 18 does the game's damage.
{
  const O = path.join(here, '../../tools/trace/out/'), fc = O + 'w270_boss_missiles.calls.jsonl', fr = O + 'w270_boss_missiles.jsonl', fh = O + 'w259_boss_box4c.jsonl';
  if (!existsSync(fc) || !existsSync(fr) || !existsSync(fh)) console.log('SKIPPED T checks (boss missiles: hit frame, damage 137): tools/trace/out/w270_boss_missiles / w259_boss_box4c not present (gitignored trace)');
  else {
    const J = l => JSON.parse(l.replace(/\bNaN\b/g, 'null'));
    const R = readFileSync(fr, 'utf8').trim().split('\n').map(J).slice(1), H = readFileSync(fh, 'utf8').trim().split('\n').map(J).slice(1);
    const C = readFileSync(fc, 'utf8').trim().split('\n').map(J).slice(1).filter(c => parseInt(c['a3+0x120'].u[0], 16) & 0x800);
    const rad = data.weapons[data.weapons[18].bullet].f2c, game = [], fat = [], thin = [];
    for (const c of C) {
      const r = R.find(x => x.frame === c.frame - 1);
      if (!r) continue;
      const a = c['a3+0xe0'].f.slice(0, 3), b = c['a3+0x90'].f.slice(0, 3), P = r.matrix[3].slice(0, 3), T = [P[0], P[1] - 18, P[2]];
      const v = b.map((x, k) => x - a[k]), n = Math.hypot(...v), e = v.map(x => x / n * rad);
      if (c.v0) game.push(c.frame);
      if (fatCapsuleHit(rad, 5, a.map((x, k) => x - e[k]), b.map((x, k) => x + e[k]), P, T)) fat.push(c.frame);
      if (cylinderHit(5, a, b, P, T)) thin.push(c.frame);
    }
    ok(C.length > 100 && game.length === 1 && fat.join() === game.join() && thin.length === 0, `T boss: ${C.length} missile steps, the game's hit f${game} = the fat test's (${fat.join(', ') || 'none'}); thin ${thin.length}`);
    const hp = f => H.find(x => x.frame === f)?.p_hp, lost = hp(game[0] - 1) - hp(game[0]);
    const { W, a, player } = world([0, 0, 0]);
    const s0 = W.t.markerWorld(a, 15);
    a.pos = [a.pos[0] - s0[0] + 100, a.pos[1] - s0[1] - 9, a.pos[2] - s0[2]];
    const m = W.t.shootMarker(a, data.weapons[18], [0, -9, 0], 4, 15);
    const hp0 = player.hp;
    for (let i = 0; i < 200 && W.bullets.includes(m); i++) W.tick(1.2, [0, 0, 0], [0, 0, 0]);
    ok(lost === 137 && hp0 - player.hp === lost, `T boss: Vincent loses ${lost} to a missile (weapon 18, damage 140); the page's: ${hp0 - player.hp}`);
  }
}

// T: the trail against the game's GS dump (tools/trace/out/w270: grab_gs at f1300 of w270_rockets: dump1300.json = dumpfx.py --fed e023.fed of the dump,
// state1300.json = fx_fixture.py of its save state with FileCodes 0x405c0000,0x40000 and manager 0x4ee2e0; the dump is 4 frames after the state). The
// rocket's trail (e023 emitter 1, age 246, 5 particles) restored from RAM, moved along T's rocket path each frame (FUN_00557c68's +0x120), 4 frames,
// drawn with the state's camera: its sprites on the game's vertices with the game's RGBA. (Restore as test_effects' w208_still restore, test-only.)
{
  const O = path.join(here, '../../tools/trace/out/'), sp = O + 'w270/state1300.json', dp = O + 'w270/dump1300.json';
  if (!existsSync(sp) || !existsSync(dp) || !existsSync(O + 'w270_rockets.calls.jsonl')) console.log('SKIPPED T checks (the trail vs the f1304 GS dump): tools/trace/out/w270/state1300.json / dump1300.json not present (gitignored)');
  else {
    const f = Math.fround, st = JSON.parse(readFileSync(sp, 'utf8')), dump = JSON.parse(readFileSync(dp, 'utf8'));
    const J = l => JSON.parse(l.replace(/\bNaN\b/g, 'null'));
    const calls = readFileSync(O + 'w270_rockets.calls.jsonl', 'utf8').trim().split('\n').map(J).slice(1).filter(c => c['a3+0x124'].f[2] === 2.5);
    const buf = p => { const b = readFileSync(path.join(here, p)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); };
    const fx = E.createEffects({ fed: buf('data/effects/r0001.fed'), core: buf('data/effects/core_ef.bin'), models: [buf('data/effects/e023.fed')], rng: new E.EffectRng(st.lcg, undefined, st.mt, st.rand), warn: () => {} });
    const e = st.emitters.find(x => x.code === 0x405c0000 && x.ei === 1);
    const F = fx.feds.get(e.code), Em = F.emitter(e.ei), cat = F.u8(Em + 0xe);
    const em = { F, E: Em, ei: e.ei, param: e.rec, id: 0x405c0400, cat: (cat < 5) ? 0 : (cat < 9 || cat === 0xb) ? 1 : 0, flags: 0, f0a: e.f0a, age: e.age, dt: e.dt, carry: e.carry,
      fade: e.fade, d0: e.d0, sched: -1, n58: 0x8000, lists: [[], []], p120: [...e.p120.slice(0, 3), 1], p130: [0, 0, 0, 0], p140: [1, 1, 1, 1], p150: e.p150.slice(),
      d4: e.d4, m: Float32Array.from(e.m), col: e.col.slice(), scale: e.scale.slice(), c4: [0xff, 0xff], c8: 0, cc: 0 };
    for (const pr of e.parts) {
      const P = F.part(Em, pr.tag), b = new ArrayBuffer(Math.max((F.s16(P + 2) + 99) & ~3, 16)), i32 = new Int32Array(b);
      pr.vi.forEach((x, i) => { i32[i] = x; });
      const blk = F.list(P, 0), n0 = F.u8(blk + 4);
      const q = { P, tag: pr.tag, pid: F.u16(P), flags: pr.flags, list: pr.list, age: pr.age, life: F.u16(P + 6), ev: pr.ev, cat: F.u8(P + 0xb), parent: null,
        v: new Float32Array(b), i32, data: pr.data.slice(), entry: pr.entry.map(x => (x && !(x >= blk + 8 && x < blk + 8 + 8 * n0)) ? x : undefined),
        m50: pr.m50 ? Float32Array.from(pr.m50) : null, skip: null, ext: {} };
      for (let j = 0; j < F.u8(P + 8); j++) {
        const d = F.desc(P, j), ty = F.u16(d);
        if (ty === 21) {
          const pl = Object.values(pr.pools).find(z => z.type === 21);
          if (pl) {
            const bb = Buffer.from(pl.hex, 'hex'), dv = new DataView(bb.buffer, bb.byteOffset, bb.length), s16 = o => dv.getInt16(o, true), f32 = o => dv.getFloat32(o, true);
            const capN = s16(0x1c), Pl = { dur: f32(4), life: f32(8), fade: [f32(0xc), f32(0x10), f32(0x14)], t18: f32(0x18), cap: capN, count: s16(0x1e), start: s16(0x20), flag: dv.getUint8(0x22), recs: [] };
            for (let i = 0; i < capN; i++) { const r = new ArrayBuffer(0x90); new Uint8Array(r).set(bb.subarray(0x30 + i * 0x90, 0x30 + (i + 1) * 0x90)); Pl.recs.push({ f: new Float32Array(r), i: new Int32Array(r), h: new Int16Array(r), u8: new Uint8Array(r) }); }
            q.ext[F.u16(d + 4) / 4] = Pl;
          }
        }
      }
      em.lists[pr.list].push(q);
    }
    fx.emitters.length = 0; fx.emitters.push(em);
    const V = st.cam.view, view = { toView: p => [0, 1, 2].map(j => f(f(f(p[0] * V[j]) + f(p[1] * V[4 + j])) + f(f(p[2] * V[8 + j]) + V[12 + j]))), toViewMatrix: () => Float32Array.from(V) };
    let drawn = [];
    for (let k = 1; k <= 4; k++) {
      const c = calls.find(x => x.frame === 1300 + k);
      if (c) { const p = c['a3+0x90'].f; em.p120 = [p[0], p[1], p[2], 1]; }
      fx.begin(f(1.2)); fx.end(view); drawn = fx.sprites(view);
    }
    const tx = s => s.tex ? '0x' + s.tex.tex0[1].toString(16) + s.tex.tex0[0].toString(16).padStart(8, '0') : 'untex';
    let n = 0, near = 0, rgba = 0, worst = 0;
    for (const s of drawn) for (const v of s.verts) {
      let best = null;
      for (const t of dump) if (t.tex0 === tx(s)) for (const u of t.v) { const d = Math.hypot(u[0] - v.gs[0], u[1] - v.gs[1]); if (!best || d < best.d) best = { d, u }; }
      n++; if (best && best.d < 4.5) { near++; worst = Math.max(worst, best.d); if (String(best.u[6]) === String(v.rgba)) rgba++; }
    }
    ok(drawn.length >= 40 && near === n && rgba >= 0.97 * n, `T dump f1304: the trail's ${drawn.length} sprites (types ${[...new Set(drawn.map(s => s.type))]}) on game vertices: ${near} / ${n} within 4.5 px (worst ${worst.toFixed(2)}), RGBA equal ${rgba}`);
  }
}

console.log(fails ? `${fails} FAILED` : 'all ok');
process.exit(fails ? 1 : 0);
