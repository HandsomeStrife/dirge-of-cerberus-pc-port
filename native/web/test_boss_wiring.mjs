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

finish();
function finish() { console.log(fail ? `${fail} FAILED` : 'all ok'); process.exit(fail ? 1 : 0); }
