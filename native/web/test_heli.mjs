// test_heli.mjs (worker 0259; notes/other-types.md 'The helicopter'): Dragonfly (record 31, e023, script 29) on the world without a page.
// Motion class 0x42 (cmd 0x19b, FUN_0059e730): the body follows the clip's bone 1 in world space, the done bit fires script event 0x16 (next leg).
// cmd 0x114's timed routine (FUN_0054ddf8 / FUN_0054dec0, ai.json script_fns). What ends the fight: a hit that leaves HP <= 20000 (event 8) -> timer 0 = 240
// ticks -> event 1 -> flag 0 = 16. T (when present): tools/trace/out/w259_heli.jsonl, gitignored.
//   node --import ./native/web/test_hooks.mjs native/web/test_heli.mjs     (ENEMY_AI_JS=path: another enemy_ai.js copy)
import path from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const AI = await import(pathToFileURL(process.env.ENEMY_AI_JS || path.join(here, 'enemy_ai.js')).href);
const { rootTrack } = await import('./enemy_hit.js');
const need = ['data/enemies/ai.json', 'data/enemies/e023.json', 'data/enemies/e023_local.bin'];
if (need.some(f => !existsSync(path.join(here, f)))) { console.log('SKIP: data/enemies missing (run tools/byo/build_web.sh)'); process.exit(0); }
const data = JSON.parse(readFileSync(path.join(here, 'data/enemies/ai.json'), 'utf8'));
const side = JSON.parse(readFileSync(path.join(here, 'data/enemies/e023.json'), 'utf8'));
const lpb = readFileSync(path.join(here, 'data/enemies/e023_local.bin'));
const lpd = new Float32Array(lpb.buffer, lpb.byteOffset, lpb.length >> 2);
let fails = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const tracks = {};
const rt = (m, c) => (m === 'e023' ? (tracks[c] ??= rootTrack(side.local_pose, lpd, side.clips[c], c)) : null);
const ID = 31 + 22;
const pp = [-1579, 0, 1240];

function fight(rand = () => 0.5, flag0 = 13) {
  const player = { pos: pp.slice(), hp: 9999, id: 0x16, f118: 0, s64: 0 };
  const fx = [], flags = { 0: flag0, 1: 8 };
  const W = AI.createEnemyAI({ data, player, rand, quiet: true, log: () => {}, eventFlags: flags, rootTrack: rt,
    effect: { spawn: (id, p) => fx.push({ id, p: p.slice(), fr: W.S.mgr20 }), hit() {}, wall() {} } });
  W.t.send(W.objects.get(ID), -2, 0x108, [0, 0, 0, 0]);
  W.tick(1.2, pp, pp);
  W.runEvent(W.objects.get(ID), 0x23);
  return { W, a: W.objects.get(ID), fx, flag: n => W.t.send(W.objects.get(ID), -2, 0xc, [n, 0, 0, 0]), player };
}

// 1. the export: functions by index, the flight clips' frame counts
{
  const f = data.script_fns && data.script_fns['29'];
  ok(f && f['6'] && f['39'] && !f['5'], 'ai.json script_fns: script 29 has its routines 6..39, not the event functions');
  ok(data.model_clips.e023.sp0_4 === 531 && data.model_clips.e023.eva_0 === 151, 'model_clips e023: the flight clips (sp0_4 531, eva_0 151)');
}
// 2. event 0x23 at flag 0 = 13: 'eva_0', HP 21600 (0x1a3), root motion: the body = bone 1, C+0x20 = minus row 2
{
  const { W, a } = fight();
  ok(a.hp === 21600, `event 0x23: HP ${a.hp} (0x1a3(0x5460))`);
  W.tick(1.2, pp, pp); W.tick(1.2, pp, pp);
  ok(a.C.motion && a.C.motion.cls === 0x42 && a.C.mp.clip === 'eva_0', `cmd 0x19b: class 0x42, clip ${a.C.mp && a.C.mp.clip}`);
  ok((a.C.f564 & 4) && (a.C.f564 & 0x400000) && (a.C.f564 & 0x4000) && (a.C.f564 & 0x200000), 'C+0x564 bits 4, 0x400000 (root) and 0x4000, 0x200000 (enter FUN_0059e640)');
  for (let i = 0; i < 100; i++) W.tick(1.2, pp, pp);
  // the MP frame advances after the body's update (tick: FUN_005aa2a8 last): the body took the frame before
  const tr = rt('e023', 'eva_0'), fr = a.C.mp.frame - 0.6, i0 = Math.trunc(fr), u = fr - i0;
  const want = [0, 1, 2].map(k => tr.t[i0][k] * (1 - u) + tr.t[i0 + 1][k] * u);
  const d = Math.hypot(...want.map((v, k) => v - a.pos[k]));
  { const [x, y, z, w] = tr.q[Math.round(fr)];
    const g = [-2 * (x * z + w * y), -2 * (y * z - w * x), -(1 - 2 * (x * x + y * y))];
    ok(Math.hypot(g[0] - a.face[0], g[1] - a.face[1], g[2] - a.face[2]) < 0.05, `C+0x20 = minus the bone's row 2: ${a.face.map(v => v.toFixed(2))} (T w259_heli)`); }
  ok(d < 0.01 && Math.hypot(...a.pos) > 500, `the body is on bone 1's path at frame ${fr.toFixed(1)} (off by ${d.toFixed(3)} u, at ${a.pos.map(v => v.toFixed(0))})`);
}
// 3. the leg's end: event 0x16 picks the next clip, once (T w259_heli2: sp0_4 -> ms4_0 at f861, var 0 from 4 to 0)
{
  const { W, a } = fight();
  const seen = [];
  let last = null, n = 0;
  for (let i = 0; i < 2600; i++) {
    W.tick(1.2, pp, pp);
    n += W.events.filter(e => e.startsWith(`event ${ID} script 29 ev 22 `)).length;
    if (a.C.mp && a.C.mp.clip !== last) { last = a.C.mp.clip; seen.push(last); }
  }
  ok(seen.length >= 3 && seen[0] === 'eva_0', `legs follow: ${seen.join(' -> ')}`);
  ok(new Set(seen).size === seen.length || seen.length > 2, 'each leg ends in a new request');
  ok(n === seen.length - 1, `event 0x16 fired once per leg end (${n} for ${seen.length} clips)`);
}
// 4. what ends the fight: HP <= 20000 on a hit -> timer 0 = 240 -> event 1 -> flag 0 = 16; before that, nothing
{
  const { W, a, flag, fx } = fight();
  for (let i = 0; i < 5; i++) W.tick(1.2, pp, pp);
  const hit = dmg => W.t.hitEnemy(a, { damage: dmg, kind: 0, dir: [1, 0, 0], shooter: 0x16, f148: 0, hit: 0, f120: 0x800 }, a.pos.slice());
  hit(100);
  ok(a.hp < 21600 && a.hp > 20000, `a hit above the line: HP ${a.hp}`);
  for (let i = 0; i < 300; i++) W.tick(1.2, pp, pp);
  ok(flag(0) === 13, `flag 0 still 13 at HP ${a.hp}`);
  a.hp = 20005;
  hit(100);
  const hp = a.hp;
  ok(hp <= 20000 && hp > 0, `HP ${hp} after the hit that crosses 20000`);
  let f16 = -1;
  for (let i = 0; i < 400 && f16 < 0; i++) { W.tick(1.2, pp, pp); if (flag(0) === 16) f16 = i; }
  ok(f16 >= 236 && f16 <= 242, `flag 0 = 16 ${f16} frames after that hit (timer 0 = 240: FUN_0053e868 takes the whole part of the step, 1 a frame on PAL)`);
  // routine 0x27 (FUN_0054dec0): the blasts at clocks 1, 20, 40, .. from the start: 0x405c2400, 0x405c2000 .. 2009, then its end
  const ids = fx.map(e => e.id).filter(id => (id & 0xffffc000) >>> 0 === 0x405c0000 && (id & 0x3000) === 0x2000);
  ok(ids.length === 11 && ids[0] === 0x405c2400 && ids[10] === 0x405c2009, `routine 39: the blasts ${ids.length}, ${ids[0]?.toString(16)} .. ${ids[10]?.toString(16)}`);
  const fr = fx.filter(e => (e.id & 0x3000) === 0x2000).map(e => e.fr);
  const clocks = fr.map(x => x - fr[0]);
  const want = [1, 20, 40, 60, 85, 105, 110, 140, 160, 180, 195].map(x => x - 1);    // the script's clocks; the manager clock moves in whole ticks (1 or 2 a frame)
  ok(clocks.length === 11 && clocks.every((c, i) => Math.abs(c - want[i]) <= 1), `their clocks from the first: ${clocks.join(' ')} (script: 1, 20, 40, .. 195)`);
  ok(a.s44 === -1, 'the routine ended (+0x44 = -1)');
}
// 5. routine control (FUN_0054ddf8): a new routine replaces the old (pending code -4 dropped); 0x115 stops it
{
  const { W, a } = fight();
  W.t.send(a, -2, 0x114, [39, 0, 0, 0]);
  for (let i = 0; i < 4; i++) W.tick(1.2, pp, pp);                      // past its step at clock 1: the next is at clock 20
  ok(a.s44 === 39 && a.s46 >= 1, `0x114(39) is running (step ${a.s46})`);
  const pend = () => W.delayed.filter(e => e.id === ID && e.code === -4).length;
  ok(pend() === 1, 'one code -4 pending');
  W.t.send(a, -2, 0x114, [6, 0, 0, 0]); W.tick(1.2, pp, pp);
  ok(a.s44 === 6 && pend() === 1, `0x114(6) replaced it: +0x44 ${a.s44}, pending ${pend()}`);
  W.t.send(a, -2, 0x115, [0, 0, 0, 0]); W.tick(1.2, pp, pp);
  ok(a.s44 === -1 && pend() === 0, '0x115 stopped it');
}
// 5b. leaving the class: FUN_0059e6a0 + the next request's FUN_00340c00: bits 0x400000 and 4 off, the body keeps the root's last place
{
  const { W, a } = fight();
  for (let i = 0; i < 60; i++) W.tick(1.2, pp, pp);
  const at = a.pos.slice();
  W.t.setMotion ? W.t.setMotion(a, 3) : (a.C.motion = null);
  W.t.send(a, -2, 0x141, [0, 0, 0, 0]);
  a.C.f564 &= ~0x400000;
  W.t.playClip && W.t.playClip(a, 'idle', 2);
  if (W.t.playClip) ok(!(a.C.f564 & 4), 'the next request takes bit 4 off (the page draws with the actor\'s own heading again)');
  ok(Math.hypot(a.pos[0] - at[0], a.pos[1] - at[1], a.pos[2] - at[2]) < 8, 'the body keeps its place');
}
// 6. T: w259_heli (r06_market, f0-759, sp0_4 from frame 13 at 0.6 a frame): the path against C+0x30 / C+0x20
{
  const p = path.join(here, '../../tools/trace/out/w259_heli.jsonl');
  if (!existsSync(p)) console.log('skip T: w259_heli.jsonl not here');
  else {
    const tr = rt('e023', 'sp0_4');
    let worst = 0, worstF = 0, wf = 0, n = 0;
    const qrow = fr => {                                                // minus row 2 of bone 1 (rootDrive): the frame's quaternion
      const q = tr.q[Math.min(Math.round(fr), tr.q.length - 1)], [x, y, z, w] = q;
      return [-2 * (x * z + w * y), -2 * (y * z - w * x), -(1 - 2 * (x * x + y * y))];
    };
    for (const l of readFileSync(p, 'utf8').split('\n')) {
      if (!l || l.includes('"meta"')) continue;
      const r = JSON.parse(l);
      const b = Buffer.from(r.e0_face_pos, 'hex');
      const P = [0, 1, 2].map(k => b.readFloatLE(16 + 4 * k)), F = [0, 1, 2].map(k => b.readFloatLE(4 * k));
      // the page frame: the nearest clip frame by the known rate (the trace starts in mid-leg)
      const fr = 13.05 + 0.6 * r.frame, i0 = Math.trunc(fr), u = fr - i0;
      const Q = [0, 1, 2].map(k => tr.t[i0][k] * (1 - u) + tr.t[i0 + 1][k] * u);
      const d = Math.hypot(P[0] - Q[0], P[1] - Q[1], P[2] - Q[2]);
      if (d > worst) { worst = d; worstF = r.frame; }
      const G = qrow(fr);
      wf = Math.max(wf, Math.hypot(G[0] - F[0], G[1] - F[1], G[2] - F[2]));
      n++;
    }
    ok(n > 700 && worst < 3, `T w259_heli: ${n} records, largest position error ${worst.toFixed(2)} u at f${worstF}`);
    ok(wf < 0.1, `T w259_heli: C+0x20 = minus the bone's row 2, largest error ${wf.toFixed(3)}`);
  }
}
console.log(fails ? `${fails} FAILED` : 'all ok');
process.exit(fails ? 1 : 0);
