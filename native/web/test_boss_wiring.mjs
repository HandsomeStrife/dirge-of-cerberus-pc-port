// test_boss_wiring.mjs -- the boss pieces wired into the page (worker 0231; notes/boss-research.md):
// enemy_ai.js cmds 0x156 / 0x157 and manager 0x6e / 0x6f / 0x70, AI mode 0x100 with and without the overlay
// plug-in (FUN_0035f300), stage_controller.js Zone.boss -> the plug-in, fly_mover.js (move mode 1), and the
// exported name dictionary (section 0x11) the boss overlay reads.
//   node --import ./native/web/test_hooks.mjs native/web/test_boss_wiring.mjs
// MUTATE_AI / MUTATE_FLY = paths of mutated copies (the mutation runs).
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const imp = (env, rel) => import(process.env[env] ? pathToFileURL(path.resolve(process.env[env])).href : './' + rel);
const { createEnemyAI } = await imp('MUTATE_AI', 'enemy_ai.js');
const FM = await imp('MUTATE_FLY', 'fly_mover.js');
let fail = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };
const near = (a, b, e) => Math.abs(a - b) <= e;

// ---------------------------------------------------------------- fly_mover.js (no data)
{
  // the profile (FUN_00349e98): top 600, accel 120, decel 60 (script 242's cmd 0x156) over 6000 u: ramps 5 s / 10 s (4500 u), then cruise
  const P = FM.profile(6000, 600, 120, 60);
  ok(near(P[0], 5, 1e-5) && near(P[2], 10, 1e-5) && near(P[1], (6000 - 600 * 15 * 0.5) / 600, 1e-4), `profile with a cruise ${P.map(x => x.toFixed(3))}`);
  ok(near(FM.distAt(P[3], 600, 120, 60, P), 6000, 0.05), 'distance at the end = the length');
  { const t = P[0] + P[1] / 2; ok(near(FM.distAt(t, 600, 120, 60, P), 0.5 * 120 * P[0] * P[0] + 600 * (t - P[0]), 0.05), 'mid-cruise distance = ramp + top x time'); }
  ok(near(FM.distAt(2, 600, 120, 60, P), 0.5 * 120 * 4, 1e-4) && FM.speedAt(2, 600, 120, 60, P) === 240, 'accelerating: d = a t^2 / 2, v = a t');
  const Q = FM.profile(100, 600, 120, 60);              // too short to reach the top speed
  ok(Q[1] === 0 && near(FM.distAt(Q[3], 600, 120, 60, Q), 100, 1e-3), 'no cruise on a short move; it still covers the length');
  ok(near(FM.speedAt(Q[0], 600, 120, 60, Q), Math.sqrt(2 * 100 * 120 * 60 / 180), 1e-3), 'peak speed sqrt(2 L a d / (a + d))');
  // a move to the end: arrival sets C+0x1c4 bit 2, mode 0, at the target
  const C = { pos: [0, -100, 0], f1c0: 2, f1c4: 0, f1e0: 360, f1e4: 1800, f1e8: 300, spd: 0 };
  ok(FM.flyTo(C, [100, -100, 0]) && C.mm === 1 && !(C.f1c4 & 4) && (C.f1c4 & 1), 'flyTo: mode 1, moving');
  let n = 0;
  while (C.mm === 1 && n < 1000) { FM.step(C, 1 / 60); n++; }
  ok(C.mm === 0 && (C.f1c4 & 4) && !(C.f1c4 & 1) && near(C.pos[0], 100, 1e-4), `arrives at the target with bit 2 (${n} frames)`);
  ok(n === Math.ceil(C.dur * 60) || n === Math.ceil(C.dur * 60) + 1, `frames = duration (${C.dur.toFixed(3)} s)`);
  const C2 = { pos: [0, 0, 0], f1c0: 0, f1c4: 0, spd: 0 };
  const w = []; ok(!FM.flyTo(C2, [10, 0, 0], m => w.push(m)) && w.length === 1, 'no profile / speed bits: warned, no move');
  const C3 = { pos: [0, 0, 0], f1c0: 1, f1c4: 0, spd: 20 };
  FM.flyTo(C3, [10, 0, 0]); ok(near(C3.dur, 0.5, 1e-6), 'constant speed: duration = length / C+0x1d4');
  // two dives at the same spot (FUN_0034bd10 case 1 returns 0 under 0.001 u -> FUN_0034d870(C, 0)): already there is arrived, no snap, no NaN
  const C4 = { pos: [0, -100, 0], f1c0: 2, f1c4: 0, f1e0: 360, f1e4: 1800, f1e8: 300, spd: 0 };
  FM.flyTo(C4, [100, -100, 0]); for (let i = 0; i < 1000 && C4.mm === 1; i++) FM.step(C4, 1 / 60);
  const dive2 = FM.flyTo(C4, [100, -100, 0]);
  ok(!dive2 && C4.mm === 0 && (C4.f1c4 & 4) && !(C4.f1c4 & 1) && C4.vel === 0, `the second dive to the same point: arrived at once (mode ${C4.mm}, +0x1c4 ${C4.f1c4})`);
  for (let i = 0; i < 5; i++) FM.step(C4, 1 / 60);
  ok(C4.pos.every(Number.isFinite) && near(C4.pos[0], 100, 1e-4), `and the body stays put: ${C4.pos}`);
  const C5 = { pos: [5, 0, 0], p120: [50, 0, 0], mm: 1, f1c4: 1 };
  ok(FM.arrive(C5, 0) === 1 && C5.pos[0] === 5 && C5.mm === 0 && (C5.f1c4 & 4), 'FUN_0034d870(C, 0): mode 0 and bit 2 without the snap');
  const C6 = { pos: [5, 0, 0], p120: [50, 0, 0], mm: 1, f1c4: 1 };
  ok(FM.arrive(C6, 1) === 1 && C6.pos[0] === 50, 'FUN_0034d870(C, 1): the snap');
}

// ---------------------------------------------------------------- enemy_ai.js + data
const D = p => path.join(here, 'data', p);
if (!existsSync(D('enemies/ai.json'))) { console.log('SKIP data checks (tools/byo/build_web.sh)'); finish(); }
const aiData = JSON.parse(readFileSync(D('enemies/ai.json'), 'utf8'));
ok(aiData.names && aiData.names.btbox4 && aiData.names.btbox4[0] === 8 && aiData.names.btbox4[1] === 199, 'names: btbox4 = trigger 199');
ok(['nwe024ge', 'nwe024gn', 'nwe024gh', 'nwe024me', 'nwe024mn', 'nwe024mh'].every((k, i) => aiData.names[k][0] === 24 && aiData.names[k][1] === 14 + i), 'names: nwe024g* / m* = weapons 14-19');
ok(aiData.records[32].weapon === aiData.names.nwe024gn[1], 'record 32 carries nwe024gn (weapon 15)');
ok(Array.isArray(aiData.values32) && aiData.values32[0] === 0xc3 && aiData.names.bshv0[0] === 32, 'bshv0 = section 32 entry 0 = 0xc3');
ok(aiData.scripts['242'], 'ai.json carries record 32\'s script 242');
// worker 0237: the item model the boss fight loads at its death drop (worker 0235 saw a 404): g058 (build_web.sh item models)
ok(existsSync(D('items/g058.glb')), 'data/items/g058.glb exported (the boss\'s death drop model)');

const P = { pos: [0, 0, 0], face: [1, 0, 0], hp: 780, id: 0x16, f118: 0x20209, s64: 0 };
const gauges = [];
function mk(o = {}) { return createEnemyAI({ data: aiData, player: P, quiet: true, log: () => {}, rand: () => 0.5, ...o }); }
{
  const W = mk({ hudGauge: (c, g) => gauges.push([c, { ...g }]) });
  const a = W.addActor({ rec: 44, mode: 0, hp: 100, astate: 1 });
  const s = W.t.send;
  s(a, -2, 0x156, [Math.fround(120), Math.fround(600), Math.fround(60)]);
  ok(a.C.f1e4 === 120 && a.C.f1e0 === 600 && a.C.f1e8 === 60, 'cmd 0x156: C+0x1e4 / 0x1e0 / 0x1e8 = r0 / r1 / r2');
  a.C.f1c0 = 1; s(a, -2, 0x157, [1]); ok((a.C.f1c0 & 3) === 2, 'cmd 0x157(1): bit 0 off, bit 1 on');
  s(a, -2, 0x157, [0]); ok((a.C.f1c0 & 3) === 1, 'cmd 0x157(0): bit 0 on, bit 1 off');
  s(a, -2, 0x157, [2]); ok((a.C.f1c0 & 3) === 0, 'cmd 0x157(2): both off');
  s(a, -2, 0x157, [3]); ok((a.C.f1c0 & 3) === 0, 'cmd 0x157(3): nothing');
  // script 242 event 0x23's order: 0x6e(13, 12000, 12000, 1), 0x6f; event 0x17: 0x70
  s(a, -2, 0x6e, [13, 12000, 12000, 1]); s(a, -2, 0x6f, []);
  const g = W.hudGauge();
  ok(g.id === 13 && g.v === 12000 && g.max === 12000 && g.f === 1 && g.c59 === 1, 'manager 0x6e / 0x6f: gauge 13, 12000 / 12000, shown');
  s(a, -2, 0x70, []); ok(W.hudGauge().c59 === 2 && gauges.length === 3, 'manager 0x70: hidden (shown -> 2); the HUD hook saw all three');
  s(a, -2, 0x6e, [0x12, 1, 1, 1]); ok(W.hudGauge().id === 13, 'manager 0x6e: id >= 0x12 ignored');
  // mode 0x100: no plug-in -> no brain, mode 0 (FUN_0035f300 with DAT_0046e590 == 0)
  W.t.setMode(a.ai, 0x100);
  ok(a.ai.brain === null && a.ai.mode === 0, 'mode 0x100 without the overlay: no brain, mode 0');
  W.setBossPlugin(true); ok(W.bossPlugin, 'Zone.boss(true) -> plug-in on');
  W.t.setMode(a.ai, 0x101); ok(a.ai.brain === null && a.ai.mode === 0, 'mode 0x101 with the plug-in: none (FUN_00aa3090 makes 0x100 only)');
  W.t.setMode(a.ai, 0x100); ok(a.ai.brain && a.ai.mode === 0x100, 'mode 0x100 with the plug-in: a brain');
  W.setBossPlugin(false); ok(!W.bossPlugin, 'Zone.boss(false) -> plug-in off');
}

// ---------------------------------------------------------------- stage_controller.js Zone.boss
{
  // the native table is built inside the runtime; find it by calling the builder the module exports, else read the source
  const src = readFileSync(path.join(here, 'stage_controller.js'), 'utf8');
  ok(/'fake\/KerberosZone\.boss\(Z\)V': \(vm, \[on\]\) => \{[\s\S]{0,200}o\(\)\.bossOverlay\(!!on\)/.test(src), 'stage_controller: Zone.boss(Z) calls opts.bossOverlay(on)');
  const play = readFileSync(path.join(here, 'play.js'), 'utf8');
  ok(/bossOverlay: on => \{ if \(enemyAI && enemyAI\.setBossPlugin\) enemyAI\.setBossPlugin\(on\); \}/.test(play), 'play.js passes Zone.boss to the enemy_ai world');
}

// ---------------------------------------------------------------- the hookup (worker 0235): e024 runs boss_z128.js through boss_io.js
{
  const P2 = { pos: [700, -100, 1460], face: [1, 0, 0], hp: 780, id: 0x16, f118: 0x20209, s64: 0 };
  const gs = [];
  const bones = a => k => [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [a.pos[0], a.pos[1], a.pos[2], 1]];
  const W = createEnemyAI({ data: aiData, player: P2, quiet: true, log: () => {}, rand: () => 0.5, eventFlags: { 0: 36 }, boneWorld: bones,
                            hudGauge: (c, g) => gs.push([c, g.v, g.max]) });
  W.setBossPlugin(true);
  W.event23();                                                              // FUN_005459d8: script 242 event 0x23 (flag 0 == 36)
  const a = W.objects.get(32 + 22);
  ok(a.kind === 'actor' && a.hp === 17000 && W.hudGauge().id === 13 && W.hudGauge().v === 7000, `event 0x23: record 32 active, HP 17000, gauge 13 at 7000 (${a.kind} ${a.hp})`);
  const seen = { st: new Set(), clip: new Set(), mis: 0, gun: 0, vol: null, flew: false, turned: false, posAt: null };
  let marker15 = null;
  for (let fr = 0; fr < 4000; fr++) {
    if (fr >= 1500 && fr < 1700 && !(fr % 4)) a.hp -= 10;                   // hits: the stagger needs one with acc >= 400 (state 2 / 3)
    if (fr === 2600) a.hp = 10000;                                          // beaten
    const ev = W.tick(1.2, P2.pos, P2.pos);
    if (!seen.io && a.ai && a.ai.brain && a.ai.brain.boss) seen.io = a.ai.brain.boss.io;
    const bs = a.ai && a.ai.boss ? a.ai.boss : null;
    if (bs) seen.st.add(bs.st);
    if (a.C.clip) seen.clip.add(a.C.clip);
    for (const b of W.bullets) if (b.shooter === a.id && !b.seen) { b.seen = 1; if (b.hm === 1) { seen.mis++; if (!marker15) marker15 = b.start.slice(); } else seen.gun++; }
    for (const o of W.attackObjs) if (o.owner === a) seen.vol = { marker: o.marker, r: o.r, life: o.life, dmg: o.dmg, c1: o.c1, fixed: o.fixed };
    if (Math.hypot(a.pos[0] - 850, a.pos[2] - 1450) > 50) seen.flew = true;
    if (a.C.s214 === 1) seen.turned = true;
    if (W.eventFlags[0] === 40 && !seen.dead) seen.dead = fr;
  }
  ok(a.ai.mode === 0 || seen.st.has(9), `brain states seen: ${[...seen.st].sort((x, y) => x - y).join(' ')}`);
  ok([2, 3, 6, 8, 9].every(k => seen.st.has(k)) && (seen.st.has(4) || seen.st.has(5)), 'the brain runs: decide (2), gun (3), atk_sp3 (6), stagger (8), beaten (9), and atk_sp1 (4) or a volley (5)');
  ok(seen.flew, 'move mode 1 (fly_mover.js): it flies from btbox0 to another box');
  ok(seen.gun > 0 && seen.mis > 0, `it fires from its markers: ${seen.gun} gun bullets, ${seen.mis} homing missiles (W+4 0x2000: +0x150 mode 1)`);
  // missiles start at a pod marker: marker 16 (27.4, -1.2, -65.4) / 15 on bone 2 (here at the body's position)
  ok(!!marker15 && Math.abs(Math.abs(marker15[2] - 1450) - 65.2) < 1, `missiles start at the pods (markers 15 / 16, z +-65): ${marker15 && marker15.map(v => v.toFixed(1))}`);
  ok(seen.clip.has('lean') || seen.clip.has('idl_lean'), `motion class 1 / 2 clips play (FUN_00593b60 / FUN_00593c90): ${[...seen.clip].join(' ')}`);
  ok(seen.turned, 'turn mode 1 (turn_mover.js) after the stagger');
  ok(gs.some(g => g[1] === 6500) && gs.some(g => g[1] === 0), `the gauge follows the HP (FUN_00aa11b8): ${gs.length} updates, ${gs.at(-3)[1]} .. ${gs.at(-1)[1]}`);
  ok(seen.dead > 0, `beaten: 180 ticks later vt+0x334 -> script event 0x17 -> stage flag 0 = 40 (frame ${seen.dead})`);
  // atk_sp1's volume (state 4 needs Vincent in btbox4 and the alternation): the brain's call, made directly through its io
  const o = seen.io.attackVolume({ by: a, a: 2, b: 1, c0: 0xc, f54: 195, e0: 200, d0: 40, fx: 0x40603400, se: 'bsj_293' });
  ok(o && o.marker === 1 && o.fixed === null && o.r === 40 && o.life === 200 && o.c1 === 1 && o.ec === 8, 'bossVolume: class 0xd sphere r 40, life 200, every target (+0xc1 1), type 2 (+0xec 8), on marker 1, followed (FUN_0054bf48)');
  const c0 = W.t.attackCentre(o).slice(); a.pos = [a.pos[0] + 30, a.pos[1], a.pos[2]];
  const c1 = W.t.attackCentre(o);
  ok(Math.abs(c1[0] - c0[0] - 30) < 1e-3 && Math.abs(c0[0] - (a.pos[0] - 30) - 71.93) < 1e-2, `the volume follows marker 1 (71.9, -8.5, 0 on bone 2): ${c0.map(v => v.toFixed(1))} -> ${c1.map(v => v.toFixed(1))}`);
}

// worker 0237: the homing turn's matrix FUN_00259f60 in its asm order (0x259fa0-0x25a048): pair products, then x (1 - cos),
// then the sin / cos terms, each f32. Reference homing step (the rest as enemy_ai.js homingStep) against the page, exactly,
// over seeded random bullets (the trace w235_missile cannot see this order: its error is the same either way).
{
  const f = Math.fround, W = mk();
  const unit = v => { const l = Math.hypot(v[0], v[1], v[2]); return l ? [f(v[0] / l), f(v[1] / l), f(v[2] / l)] : v.slice(); };
  const ref = (b, step) => {
    const d = unit([b.end[0] - b.pos[0], b.end[1] - b.pos[1], b.end[2] - b.pos[2]]), u = b.dir;
    const ax = [f(f(u[1] * d[2]) - f(u[2] * d[1])), f(f(u[2] * d[0]) - f(u[0] * d[2])), f(f(u[0] * d[1]) - f(u[1] * d[0]))];
    const dot = f(f(f(d[0] * u[0]) + f(d[1] * u[1])) + f(d[2] * u[2]));
    const c = f(dot / f(Math.sqrt(f(f(f(f(d[0] * d[0]) + f(d[1] * d[1])) + f(d[2] * d[2])) * f(f(f(u[0] * u[0]) + f(u[1] * u[1])) + f(u[2] * u[2]))))));
    let ang = !(c < 1) ? 0 : !(-1 < c) ? f(Math.PI) : f(Math.acos(c));
    const lim = f(b.home * f(0.016666668)); if (lim < Math.abs(ang)) ang = ang < 0 ? -lim : lim;
    let dir = u;
    if (0.001 < Math.abs(ang)) {
      const sn = f(Math.sin(ang)), cs = f(Math.cos(ang)), t = f(1 - cs), [x, y, z] = ax;
      const M = [f(f(t * f(x * x)) + cs), f(f(t * f(x * y)) + f(z * sn)), f(f(t * f(z * x)) - f(y * sn)),
                 f(f(t * f(x * y)) - f(z * sn)), f(f(t * f(y * y)) + cs), f(f(t * f(y * z)) + f(x * sn)),
                 f(f(t * f(z * x)) + f(y * sn)), f(f(t * f(y * z)) - f(x * sn)), f(f(t * f(z * z)) + cs)];
      dir = unit([0, 1, 2].map(k => f(f(f(u[0] * M[k]) + f(u[1] * M[3 + k])) + f(u[2] * M[6 + k]))));
    }
    return dir;
  };
  let seed = 12345; const rnd = () => (seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296;
  let same = 0, N = 300;
  for (let i = 0; i < N; i++) {
    const dir = unit([rnd() - 0.5, rnd() - 0.5, rnd() - 0.5].map(f));
    const b = { pos: [f(rnd() * 2000 - 1000), f(rnd() * -300), f(rnd() * 2000)], dir, end: [f(rnd() * 2000 - 1000), f(-100), f(rnd() * 2000)],
                target: null, home: f(30 + rnd() * 600), speed: f(5), d158: 0, range: 3000, age: 0, f120: 0 };
    const want = ref(b, f(1.2));
    W.t.homingStep(b, f(1.2));
    if (b.dir.every((v, k) => v === want[k])) same++;
  }
  ok(same === N, `homing turn = FUN_00259f60's f32 order, exactly, on ${same} / ${N} random bullets`);
}
finish();
function finish() { console.log(fail ? `${fail} FAILED` : 'all ok'); process.exit(fail ? 1 : 0); }
