// The dog's AI (worker 0252; notes/enemy-ai-hook.md 'Mode 3: the dogs'): script 222's wake paths into brain mode 3
// (FUN_00361690, enemy_ai brain3), the chase and attack picks, the special picks FUN_003600c0 (zone header +0x60 + n,
// ai.json sizes[8].p60), and the leaping bite's damage through the shared melee code. NO TRACE: no PCSX2 state has a dog
// awake when it was written, so sections 1-8 are the decode's; section 11 (worker 0256) runs against w253_dog2. Section 3d pins
// each limit of FUN_00361690's states.
// Run: node --import ./native/web/test_hooks.mjs native/web/test_dog_ai.mjs   (ENEMY_AI_JS=path: another enemy_ai.js copy)
import path from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const AI = await import(pathToFileURL(process.env.ENEMY_AI_JS || path.join(here, 'enemy_ai.js')).href);
const aiPath = path.join(here, 'data/enemies/ai.json'), colPath = path.join(here, 'data/z128_collision.bin');
if (!existsSync(aiPath) || !existsSync(colPath)) { console.log('SKIP: data/enemies/ai.json or data/z128_collision.bin missing (tools/byo/build_web.sh)'); process.exit(0); }
const { Collision } = await import(pathToFileURL(path.join(here, 'collision.js')).href);
const data = JSON.parse(readFileSync(aiPath, 'utf8'));
const cb = readFileSync(colPath), col = new Collision(cb.buffer.slice(cb.byteOffset, cb.byteOffset + cb.byteLength));
let fails = 0, skipped = 0;
const ok = (c, msg) => { console.log((c ? 'ok   ' : 'FAIL ') + msg); if (!c) fails++; };
const DOG = 65, ID = DOG + 22;
const SPOT = [-1507.3, -0.06, -573.5];                       // route state r03_spot2 (Dan's report spot), 310 u north of dog 65
const world = (extra = {}) => {
  const player = { pos: SPOT.slice(), hp: 780, id: 0x16, f118: 0, s64: 0 };
  const W = AI.createEnemyAI({ data, player, quiet: true, walkMesh: col, log: () => {}, ...extra });
  return { W, player };
};
const activate = (W, var7 = 0) => { const o = W.objects.get(ID); o.vars[7] = var7; W.t.send(o, -2, 0x108, [0, 0, 0, 0]); W.tick(1.2, SPOT, SPOT); return W.objects.get(ID); };

// 1. data: FUN_003600c0 reads the zone header bytes +0x61 / +0x62 (e030's set 8: 5 = st_btl, 4 = b_stp)
{
  const rec = data.records[DOG];
  ok(rec.model === 'e030' && rec.script === 222 && rec.zones === 8, `record 65: e030, script 222, zone set ${rec.zones}`);
  const z = data.sizes['8'];
  ok(z && Array.isArray(z.p60) && z.p60.join() === '2,5,4,-1', `sizes[8].p60 = ${z && z.p60} (zone header +0x60..+0x63)`);
  const { W } = world();
  const a = activate(W);
  ok(W.t.specialAttack(a.ai, 1) === 5 && W.t.specialAttack(a.ai, 2) === 4, 'FUN_003600c0(ai, 1) = 5, (ai, 2) = 4');
}

// 2. script 222's wake paths (event 3 var 7; event 8 hit; event 2 r0 1 -> timer 250 -> event 1)
{
  let { W } = world();
  let a = activate(W, 0);
  ok(a.ai && a.ai.mode === 0, `activation with var 7 = 0: brain mode ${a.ai && a.ai.mode} (script 222 ev 3 leaves it in mode 0)`);
  ({ W } = world());
  a = activate(W, 1);
  ok(a.ai.mode === 3, `activation with var 7 = 1: brain mode ${a.ai.mode} (ev 3: 0x155(75), 0x193, 0x143(3))`);
  ok(a.C.f1c0 & 0x1000000 && a.C.f1c0 & 0x4000000 && a.ai.interval >= 5, 'mode 3 start 0x361648: C+0x1c0 |= 0x1000000 | 0x4000000');
  ({ W } = world());
  a = activate(W, 0);
  W.t.hitEnemy(a, { damage: 10, kind: 0, dir: [0, 0, 1], shooter: 0x16, f148: 0, hit: 0, f120: 0x800 }, a.pos.slice());
  W.tick(1.2, SPOT, SPOT);
  ok(a.ai.mode === 3, `shot (event 8): brain mode ${a.ai.mode}`);
  ({ W } = world());
  a = activate(W, 0);
  W.runEvent(a, 2, [1, 0, 0, 0]);
  let at = -1;
  for (let i = 0; i < 400 && at < 0; i++) { W.tick(1.2, SPOT, SPOT); if (a.ai.mode === 3) at = i; }
  ok(a.vars[7] === 1 && at > 150 && at < 260, `event 2 (r0 1): var 7 = ${a.vars[7]}, timer 0 = 250 -> event 1 -> mode 3 after ${at} frames`);
}

// 3. the chase and the attack (brain3 on the z128 walk mesh, the default twister). Without a pose the aim point is 12.4 u up
// (PLAYER_AIM_H): at the dog's stop distance (0.8 x reach) that is about 45 deg above, entry 2's pitch -4 of [-4, 4): it bites
{
  const { W } = world();
  const a = activate(W, 1);
  const d0 = Math.hypot(a.pos[0] - SPOT[0], a.pos[2] - SPOT[2]);
  let atk = null, states = new Set(), minD = d0;
  for (let i = 0; i < 1200 && !atk; i++) {
    W.tick(1.2, SPOT, SPOT);
    states.add(a.ai.bstate);
    minD = Math.min(minD, Math.hypot(a.pos[0] - SPOT[0], a.pos[2] - SPOT[2]));
    const e = W.events.find(x => /^attack 87 \d/.test(x));
    if (e) atk = { i, e, st: a.astate };
  }
  ok(states.has(4) && states.has(5), `brain states seen: ${[...states].join(' ')} (4 = nav path, 5 = approach mover)`);
  ok(minD < 40, `the dog closes from ${d0.toFixed(1)} to ${minD.toFixed(1)} u`);
  ok(atk && atk.st >= 0x80 && atk.st <= 0x86, `an attack from the brain: ${atk ? `${atk.e} at frame ${atk.i}, actor state 0x${atk.st.toString(16)}` : 'none'}`);
  ok(atk && a.ai.bstate === 7, `... then brain state 7 (${a.ai.bstate})`);
}

// 3b. the pitch sign on the dog's own distance (entry 2's window [-4, 4); negative = above): 45 deg up passes, 61 deg either way
// is out, and at 50 deg the window's open end tells the signs apart: up (-4) passes, down (+4) does not
const brainDog = (o = {}) => {
  const { W, player } = world(o);
  const a = activate(W, 1);
  W.t.setTarget(a.ai, W.player);
  a.ai.flags |= 2; a.C.f1c0 &= ~(0x40000 | 0x100000);
  a.face = [0, 0, 1]; a.astate = 2; a.ai.btime = W.S.now;
  return { W, a, player };
};
{
  const at = (h, up) => { const { W, a, player } = brainDog(); player.pos = [a.pos[0], a.pos[1] - up, a.pos[2] + h]; return W.t.attackPick(a.ai); };
  ok(at(12.4, 0) === 2, `aim point 12.4 up at 12.4 u: pick ${at(12.4, 0)} (entry 2, pitch -4)`);
  ok(at(8, 2) === -1, `aim point 14.4 up at 8 u (61 deg): pick ${at(8, 2)} (-1, pitch -5)`);
  ok(at(8, -26.8) === -1, `aim point 14.4 down at 8 u: pick ${at(8, -26.8)} (-1, pitch +5)`);
  // the open end: aim point down at 50.2 deg (+4 by the sign, out; the same angle up is -4, in)
  ok(at(10, -24.4) === -1 && at(10, 0) === 2, `+4 is outside [-4, 4), -4 inside: ${at(10, -24.4)} / ${at(10, 0)} (-1 / 2)`);
}
// FUN_00261540 + FUN_00260f54 on the actor's rows: facing +z, row 0 = (-1, 0, 0), row 1 = (0, -1, 0)
{
  const { W, a } = brainDog();
  const near = (x, y) => Math.abs(x - y) < 1e-5;
  const [p0, y0] = W.t.localAngles(a, [1, 0, 0]);
  ok(near(p0, 0) && near(y0, -Math.PI / 2), `+x from a +z facing: pitch ${p0}, yaw ${y0} (0, -pi / 2; row 0 is -x)`);
  const [p1, y1] = W.t.localAngles(a, [0, -Math.SQRT1_2, Math.SQRT1_2]);
  ok(near(p1, -Math.PI / 4) && near(y1, 0), `45 deg above: pitch ${p1} (-pi / 4), yaw ${y1}`);
}
// 3c. FUN_0035ff98's retry: nothing from the aim point and the target right overhead (d3c < 5, -27 < d40 < -20): again from his
// feet (FUN_0054a720). Feet 10 up at 7 u: aim point 73 deg (-6), feet 55 deg (-4)
for (const [d3c, d40, want] of [[3, -22.4, 2], [5, -22.4, -1], [3, -20, -1], [3, -27, -1]]) {
  const { W, a, player } = brainDog();
  player.pos = [a.pos[0], a.pos[1] - 10, a.pos[2] + 7];
  a.ai.d3c = d3c; a.ai.d40 = d40;
  const i = W.t.attackPick(a.ai);
  ok(i === want, `retry at d3c ${d3c}, d40 ${d40}: pick ${i} (${want})`);
}

// 3d. brain3's limits, state by state (the states and constants of FUN_00361690). reach = target +0x2c + actor +0x2c + 5 = 16.
// The distances are set by hand (FUN_0035e830 runs before the brain); not in view unless asked, so no attack entry passes.
const step = (st, set = {}, o = {}) => {
  const d = brainDog(o);
  d.a.ai.bstate = st;
  d.a.ai.flags &= ~2;
  d.a.C.mover = set.mover ?? 3;
  if (set.vis) d.a.ai.flags |= 2;
  Object.assign(d.a.ai, set.ai || {});
  if (set.age !== undefined) d.a.ai.btime = (d.W.S.now - set.age) << 16 >> 16;
  if (set.pre) set.pre(d);
  d.W.t.brain3(d.a.ai);
  return d.a;
};
{
  const reach = 5 + 5 + brainDog().a.size.r;
  ok(reach === 16, `reach ${reach} (16: target +0x2c 5, actor +0x2c, 5)`);
  // state 2: d34 < reach + 10 -> turn 6, state 6; else on to state 3 (far out of view: a nav path, state 4)
  let a = step(2, { ai: { d34: reach + 9.9, d38: 200, d3c: 10, d40: 0 } });
  ok(a.ai.bstate === 6 && a.C.s214 === 6 && a.ai.interval === 5, `state 2, d34 reach + 9.9: state ${a.ai.bstate}, turn ${a.C.s214}, interval ${a.ai.interval} (6, 6, 5)`);
  a = step(2, { ai: { d34: reach + 10.1, d38: 200, d3c: 10, d40: 0 } });
  ok(a.ai.bstate === 4 && a.ai.interval === 0x1e, `state 2, d34 reach + 10.1: state ${a.ai.bstate}, interval ${a.ai.interval} (4, 0x1e: state 3's nav request)`);
  // state 3: the approach window is [0.8 x reach, 1000]
  a = step(3, { vis: true, ai: { d34: 30, d38: 19 } });
  ok(a.ai.bstate === 5 && a.C.mover === 3 && Math.abs(a.C.lo - 12.8) < 1e-5 && a.C.hi === 1000, `state 3: approach window ${a.C.lo} .. ${a.C.hi} (12.8 .. 1000), state ${a.ai.bstate}`);
  // state 3's d38 < 50 gate: out of range -> the nav request
  a = step(3, { vis: true, ai: { d34: 62, d38: 50 } });
  ok(a.ai.bstate === 4, `state 3, d38 50: state ${a.ai.bstate} (4)`);
  // state 5: out of view, kept while d38 <= 100
  a = step(5, { ai: { d34: 111, d38: 100 } });
  ok(a.ai.bstate === 5, `state 5, d38 100, not in view: state ${a.ai.bstate} (5)`);
  a = step(5, { ai: { d34: 112, d38: 101 } });
  ok(a.ai.bstate === 3 && a.ai.interval === 6, `state 5, d38 101, not in view: state ${a.ai.bstate}, interval ${a.ai.interval} (3, 6)`);
  // state 5's draw: (int)(r x 11) == 0 and 0x3d ticks, then a pick. Vincent 12.4 u ahead in view: entry 2 passes
  const s5 = (r, age) => step(5, { vis: true, age, ai: { d34: 25, d38: 14 }, pre: d => { d.player.pos = [d.a.pos[0], d.a.pos[1], d.a.pos[2] + 12.4]; } }, { rand: () => r });
  a = s5(0.09, 0x3d);
  ok(a.ai.bstate === 7 && a.astate === 0x82, `state 5, draw 0.09 (x 11 = 0.99): state ${a.ai.bstate}, actor state 0x${a.astate.toString(16)} (7, 0x82)`);
  a = s5(0.091, 0x3d);
  ok(a.ai.bstate === 5 && a.astate < 0x80, `state 5, draw 0.091 (x 11 = 1.001): state ${a.ai.bstate} (5, no attack)`);
  a = s5(0.09, 0x3c);
  ok(a.ai.bstate === 5 && a.astate < 0x80, `state 5, 0x3c ticks: state ${a.ai.bstate} (5, no attack)`);
  // state 6: d38 < 15 -> state 10; else after 0x79 ticks state 2
  a = step(6, { age: 0, ai: { d34: 25.9, d38: 14.9 } });
  ok(a.ai.bstate === 10 && a.C.s214 === 6, `state 6, d38 14.9: state ${a.ai.bstate}, turn ${a.C.s214} (10, 6)`);
  a = step(6, { age: 0, ai: { d34: 26, d38: 15 } });
  ok(a.ai.bstate === 6, `state 6, d38 15, young: state ${a.ai.bstate} (6)`);
  a = step(6, { age: 0x79, ai: { d34: 26, d38: 15 } });
  ok(a.ai.bstate === 2 && a.ai.interval === 6, `state 6, d38 15, 0x79 ticks: state ${a.ai.bstate}, interval ${a.ai.interval} (2, 6)`);
  // state 10: d38 > 15 -> state 2; d38 == 15 stays (nothing to pick out of view)
  a = step(10, { ai: { d34: 26, d38: 15 } });
  ok(a.ai.bstate === 10, `state 10, d38 15: state ${a.ai.bstate} (10)`);
  a = step(10, { ai: { d34: 26.1, d38: 15.1 } });
  ok(a.ai.bstate === 2 && a.ai.interval === 6, `state 10, d38 15.1: state ${a.ai.bstate}, interval ${a.ai.interval} (2, 6)`);
  // state 4's cone: |out[1]| (yaw) < 30 deg and |out[0]| (pitch) < 40 deg. At d34 >= reach the cone alone decides
  const cone = (yawDeg, pitchDeg) => step(4, { vis: true, age: 0, ai: { d34: 30, d38: 19, d40: 0 }, pre: d => {
    const y = yawDeg * Math.PI / 180, p = pitchDeg * Math.PI / 180, D = 30;
    d.player.pos = [d.a.pos[0] - Math.sin(y) * Math.cos(p) * D, d.a.pos[1] - Math.sin(p) * D, d.a.pos[2] + Math.cos(y) * Math.cos(p) * D];
  } }).ai.bstate;
  ok(cone(0, 35) === 5, `state 4 cone: 35 deg pitch, yaw 0 -> go (state ${cone(0, 35)}, 5)`);
  ok(cone(35, 0) === 4 && cone(-35, 0) === 4, `state 4 cone: +-35 deg yaw, pitch 0 -> no (${cone(35, 0)}, ${cone(-35, 0)}: 4)`);
  ok(cone(25, 0) === 5 && cone(0, -35) === 5, `state 4 cone: 25 deg yaw go, -35 deg pitch go (${cone(25, 0)}, ${cone(0, -35)}: 5)`);
  ok(cone(0, 45) === 4, `state 4 cone: 45 deg pitch -> no (state ${cone(0, 45)}, 4)`);
  // state 4's approach start: FUN_003577c8(body) -> FUN_0034b110(1.0, C): want = the facing, per-frame 1.0 (the mover replaces it next frame)
  const st4 = bs => step(4, { vis: true, age: 0, mover: 0, ai: { d34: 30, d38: 19, d40: 0 }, pre: d => {
    d.player.pos = [d.a.pos[0], d.a.pos[1], d.a.pos[2] + 30];
    d.a.B = { poly: null, state: bs, vel: [0, 0, 0], want: [0, 0, 0], acc: 2.5, turn: 12.566371, dt: 0.02 }; d.a.C.mm = 0xc; d.a.C.wk = 0.25; d.a.C.want = [1, 0, 0];
  } });
  a = st4(2);
  ok(a.ai.bstate === 5 && a.C.wk === 1 && a.C.want[2] === 1 && Math.abs(a.C.lo - 12.8) < 1e-5, `state 4 start, body state 2: C+0xcc ${a.C.wk}, C+0xc0 ${a.C.want} (1, the facing), approach from ${a.C.lo} (12.8)`);
  a = st4(0);
  ok(a.ai.bstate === 5 && a.C.wk === 0.25 && a.C.want[0] === 1, `state 4 start, body state 0: C+0xcc ${a.C.wk} (kept)`);
  // state 4's timeout: 0x709 ticks and no path goal -> turn 6, state 6, interval 0x3c
  a = step(4, { age: 0x709, ai: { d34: 200, d38: 189, d40: 0 } });
  ok(a.ai.bstate === 6 && a.ai.interval === 0x3c && a.C.s214 === 6, `state 4 at 0x709 ticks: state ${a.ai.bstate}, interval 0x${a.ai.interval.toString(16)} (6, 0x3c)`);
  a = step(4, { age: 0x708, ai: { d34: 200, d38: 189, d40: 0 } });
  ok(a.ai.bstate === 4, `state 4 at 0x708 ticks: state ${a.ai.bstate} (4)`);
  // state 4's node test (FUN_00562d90) on a real nav node n: Vincent > 30 u from n, within 300 of the dog, n > 45 deg off him
  const g = data.nav && data.nav.nodes ? data.nav.nodes : null;
  ok(!!g, 'ai.json nav nodes');
  const onNode = (ang, age, d38 = 50, D = 60) => step(4, { age, ai: { d34: 200, d38, d40: 0 }, pre: d => {
    const n = 0, q = d.W.navNode ? d.W.navNode(n) : g[n];
    d.a.pos = [q[0], q[1], q[2] - 40];                                        // the node 40 u +z of the dog
    d.player.pos = [d.a.pos[0] + Math.sin(ang) * D, d.a.pos[1], d.a.pos[2] + Math.cos(ang) * D];
    d.a.C.mover = 0xd; d.a.C.list = [n]; d.a.C.nst = 2; d.a.C.nlen = 1;
    d.a.ai.n9a = d.a.node108;
  } });
  a = onNode(Math.PI / 2, 0x78);
  ok(a.ai.bstate === 2 && a.ai.interval === 6, `state 4, the path's end 90 deg off him: state ${a.ai.bstate}, interval ${a.ai.interval} (2, 6)`);
  a = onNode(Math.PI / 6, 0x78);
  ok(a.ai.bstate === 4, `state 4, the path's end 30 deg off him: state ${a.ai.bstate} (4)`);
  a = onNode(Math.PI / 2, 0x77);
  ok(a.ai.bstate === 4, `state 4, the same at 0x77 ticks: state ${a.ai.bstate} (4)`);
  // FUN_00562d90 itself: the wrap (FUN_00260bc8): 170 deg vs -170 deg is 20 deg apart
  const { W, a: dg, player } = brainDog();
  const q = g[0];
  dg.pos = [q[0] - Math.sin(170 * Math.PI / 180) * 40, q[1], q[2] - Math.cos(170 * Math.PI / 180) * 40];
  player.pos = [dg.pos[0] + Math.sin(-170 * Math.PI / 180) * 80, dg.pos[1], dg.pos[2] + Math.cos(-170 * Math.PI / 180) * 80];
  ok(W.t.nodeOffTarget(player, dg, 0) === false, 'FUN_00562d90: 170 deg vs -170 deg wraps to 20 deg (no)');
}

// 4. state 7 (after an attack): d38 < 20 and FUN_0035f8b0(ai, 50) -> the special attack FUN_003600c0(ai, 2) = b_stp (4);
// a lost draw -> state 2. Record 65's +0x99 = 0: p = 0.5 - (0 - 50) x 0.5 / -150 = 1/3
for (const [r, want] of [[0.1, 0x84], [0.9, -1]]) {
  const { W } = world({ rand: () => r });
  const a = activate(W, 1);
  W.t.setTarget(a.ai, W.player);
  a.ai.bstate = 7; a.ai.d38 = 10.0; a.astate = 2;
  W.t.brain3(a.ai);
  if (want > 0) ok(a.astate === want && a.ai.bstate === 7, `state 7, draw ${r}: attack 4 (actor state 0x${a.astate.toString(16)}, brain state ${a.ai.bstate})`);
  else ok(a.ai.bstate === 2 && !(a.astate >= 0x80 && a.astate <= 0xbf), `state 7, draw ${r}: no special attack, state ${a.ai.bstate}`);
}

// 4b. state 3: the target in view (AI +0x14 bit 1) inside 50 and at least reach (16 = 5 + 6 + 5) away, C+0x1c0 bits 18 / 20 clear
// -> the approach mover 3 to 0.8 x reach (FUN_00353110 + FUN_0034edf0(C, 3)), C+0x1c0 bit 4 clear, state 5; nearer than reach
// -> turn mode 6, state 6
for (const [d34, wantSt, wantMv] of [[30, 5, 3], [12, 6, 0]]) {
  const { W } = world();
  const a = activate(W, 1);
  W.t.setTarget(a.ai, W.player);
  a.ai.bstate = 3; a.ai.d34 = d34; a.ai.d38 = d34 - 11; a.ai.flags |= 2; a.C.f1c0 &= ~(0x40000 | 0x100000);
  W.t.brain3(a.ai);
  ok(a.ai.bstate === wantSt && a.C.mover === wantMv && (wantMv !== 3 || !(a.C.f1c0 & 0x10)) && (wantSt !== 6 || a.C.s214 === 6),
     `state 3 at d34 ${d34}: state ${a.ai.bstate}, mover ${a.C.mover}, turn ${a.C.s214}`);
}

// 5. state 7 with d38 >= 20: state 2, AI +0x20 = 6
{
  const { W } = world({ rand: () => 0.1 });
  const a = activate(W, 1);
  W.t.setTarget(a.ai, W.player);
  a.ai.bstate = 7; a.ai.d38 = 25.0; a.astate = 2;
  W.t.brain3(a.ai);
  ok(a.ai.bstate === 2 && a.ai.interval === 6, `state 7 at d38 25: state ${a.ai.bstate}, interval ${a.ai.interval}`);
}

// 6. the leaping bite atk_3 (entry 3: hit volumes 3 / 4, sphere r 5, damage 90 / 45) on Vincent 8 u ahead. The pose is a stub
// (every bone at the dog's position + (0, -6, 3)): the volumes' placement is not under test here, only the damage path
{
  const { W, player } = world();
  const a = W.addActor({ rec: DOG, mode: 0, pos: [SPOT[0], -0.06, SPOT[2] - 8], face: [0, 0, 1], clip: 'st_a' });
  W.boneWorld = x => () => [[1, 0, 0], [0, 1, 0], [0, 0, 1], [x.pos[0], x.pos[1] - 6, x.pos[2] + 3]];
  W.tick(1.2, SPOT, SPOT);
  W.t.setActorState(a, 0x83);
  const hp = [];
  for (let i = 0; i < 120; i++) { W.tick(1.2, SPOT, SPOT); for (const e of W.events) { const m = /^hit player (\d+)->(\d+)/.exec(e); if (m) hp.push([+m[1], +m[2]]); } }
  ok(hp.length === 2 && hp[0][0] - hp[0][1] === 88 && hp[1][0] - hp[1][1] === 44, `atk_3 hits twice: ${hp.map(h => `${h[0]} -> ${h[1]}`).join(', ')} (90 / 45 through FUN_0055eac8's defence)`);
  ok(player.hp === 780 - 88 - 44, `Vincent HP ${player.hp}`);
}

// 7. the sector FUN_0025dce0 with atk_2's first volume (height 8, radii 8 .. 19, 90 deg), rt 5. Volume at the origin, rows x, y, z
{
  const { W } = world();
  const v1 = data.attacks['8'].volumes[1];
  ok(v1.shape === 2 && v1.dmg === 30 && v1.p.join() === '8,19,8,90', `e030 volume 1: shape 2, damage 30, p ${v1.p}`);
  const o = { h: v1.p[0], outer: v1.p[1], inner: v1.p[2], ang: Math.fround(v1.p[3] * 0.017453294) };
  const rows = [[1, 0, 0], [0, 1, 0], [0, 0, 1]], c = [0, 0, 0];
  const t = (x, y, z) => W.t.sectorTest(5, [x, y, z], o, c, rows);
  // radially: inner - rt = 3, outer + rt = 24
  ok(t(0, 0, 12) && t(0, 0, 3.5) && !t(0, 0, 2.9) && t(0, 0, 23.9) && !t(0, 0, 24.1), 'ahead: radius 3 .. 24 (inner - rt, outer + rt) inside');
  // along the axis: from -rt to h + rt, measured from the base (centre - h / 2), the radii narrowing past the ends
  ok(t(0, 3.9, 12) && t(0, 8, 12) && !t(0, 9.1, 12) && !t(0, -9.1, 12), 'axis: within the height, past it only by rt');
  ok(t(0, 8, 19) && !t(0, 8.9, 23), 'past the end the outer radius shrinks by rt cos(e pi/2 / rt)');
  // the opening: 45 deg each side of +z; x is folded (|x|)
  const pol = (deg, r) => [Math.sin(deg * Math.PI / 180) * r, 0, Math.cos(deg * Math.PI / 180) * r];
  ok(t(...pol(44, 15)) && t(...pol(-44, 15)), '+-44 deg: in the opening');
  ok(t(...pol(60, 15)) && t(...pol(-60, 15)), '+-60 deg at 15 u: within rt of the edge segment');
  ok(!t(...pol(80, 15)) && !t(...pol(-80, 15)), '+-80 deg at 15 u: more than rt from it');
  ok(!t(0, 0, -12), 'behind: no');
  // outside the opening the height counts in 3D past the ends, not within them (0x25e17c vsub.xz)
  const e60 = pol(60, 15);                                                   // 3.88 u from the edge segment in xz
  ok(t(e60[0], 3.9, e60[2]) && t(e60[0], 6, e60[2]) && !t(e60[0], 7.5, e60[2]), 'off the opening: y free inside the height (3.9), 3D past its end (6 yes, 7.5 no)');
  ok(Math.abs(W.t.sectorBoxR(o) - 15.52) < 0.01, `FUN_0057bd00 half side ${W.t.sectorBoxR(o)} (15.52)`);
}
// 8. atk_2's bite through the attack object on Vincent: in front the sector hits (30 / 40 before defence), behind it does not. The pose
// stub has bone 0 at the dog's position with rows x, y, -z (local row 2 = table[4] = -z, so the opening looks along +z in the world)
// A bone turned a quarter (rows z, y, x: the opening looks along -x): the rows come from the pose
for (const [dx, dz, wantHits, rows] of [[0, 12, 2, [[1, 0, 0], [0, 1, 0], [0, 0, -1]]], [0, -12, 0, [[1, 0, 0], [0, 1, 0], [0, 0, -1]]],
                                        [-12, 0, 2, [[0, 0, 1], [0, 1, 0], [1, 0, 0]]], [0, 12, 0, [[0, 0, 1], [0, 1, 0], [1, 0, 0]]]]) {
  const { W, player } = world();
  const a = W.addActor({ rec: DOG, mode: 0, pos: [SPOT[0], -0.06, SPOT[2]], face: [0, 0, 1], clip: 'st_a' });
  player.pos = [SPOT[0] + dx, -0.06, SPOT[2] + dz];
  W.boneWorld = x => () => [...rows, [x.pos[0], x.pos[1] - 8, x.pos[2]]];
  W.tick(1.2, player.pos, player.pos);
  W.t.setActorState(a, 0x82);
  const hp = [];
  for (let i = 0; i < 100; i++) { W.tick(1.2, player.pos, player.pos); for (const e of W.events) { const m = /^hit player (\d+)->(\d+)/.exec(e); if (m) hp.push(+m[1] - +m[2]); } }
  ok(hp.length === wantHits, `atk_2, Vincent at (${dx}, ${dz}), bone row 2 ${rows[2]}: ${hp.length} hits (${wantHits}) ${hp.join(' / ')}`);
  if (wantHits) ok(hp[0] < hp[1] && hp[0] > 0, `damage ${hp.join(' / ')} (first volume 30, second 40, before his defence)`);
}

// 9. the motion states (worker 0256): idle table FUN_00345b58(C, 1, 7, 8) / FUN_00346d50, motion 4 FUN_005940e0, motion 8's C+0x808 bit 2
{
  const near = (x, y) => Math.abs(x - y) < 1e-5;
  ok(near(AI.moveAngle([0, 0, 1], [1, 0, 0]), -Math.PI / 2) && near(AI.moveAngle([0, 0, 1], [-1, 0, 0]), Math.PI / 2), 'FUN_00353458: move to +x from a +z facing is negative (rhtn side), to -x positive');
  const { W } = world();
  const a = W.addActor({ rec: DOG, mode: 0, pos: [SPOT[0], -0.06, SPOT[2]], face: [0, 0, 1], clip: 'st_a' });
  ok(a.C.f808 & 4, `e030's stance flags 0x${a.C.f808.toString(16)} have bit 2`);
  a.C.f1c0 |= 0x200;
  W.t.setMotion(a, 3);
  const run = n => { for (let i = 0; i < n; i++) W.tick(1.2, SPOT, SPOT); };
  run(2);
  ok(a.C.loco && a.C.loco.rows.join() === '1,7,8' && (a.C.f568 & 0x30000) === 0x30000 && !(a.C.f564 & 8), `motion 3: idle table rows ${a.C.loco && a.C.loco.rows} (1, 7, 8), C+0x568 bits 0x30000`);
  ok(a.C.clip === 'st_a', `not turning: ${a.C.clip} (st_a)`);
  // turn mode 6: a target to +x raises atan2(x, z) -> C+0x224 negative -> entry 2, row 8 (T: w253_dog2 f122 rhtn, yaw 23 -> 47)
  a.C.s214 = 6; a.C.t2b0 = [a.pos[0] + 100, a.pos[1], a.pos[2]];
  run(1);
  ok(a.C.f224 < -0.2 && a.C.clip === 'rhtn', `turning to +x: C+0x224 ${a.C.f224.toFixed(2)} < 0, clip ${a.C.clip} (rhtn)`);
  a.face = [0, 0, 1]; a.C.t2b0 = [a.pos[0] - 100, a.pos[1], a.pos[2]];
  run(1);
  ok(a.C.f224 > 0.2 && a.C.clip === 'lhtn', `turning to -x: C+0x224 ${a.C.f224.toFixed(2)} > 0, clip ${a.C.clip} (lhtn; T: f226)`);
  a.C.s214 = 0;
  run(1);
  ok(a.C.f224 === 0 && a.C.clip === 'st_a', `turn over: C+0x224 ${a.C.f224}, clip ${a.C.clip} (st_a)`);
  // motion 3 moving with C+0x808 bit 2 -> motion 4 (the turn clip for a move 90 deg off)
  {
    const { W } = world();
    const b = W.addActor({ rec: DOG, mode: 0, pos: [SPOT[0], -0.06, SPOT[2]], face: [0, 0, 1], clip: 'st_a' });
    b.C.f1c0 |= 0x200;
    W.t.setMotion(b, 3);
    W.tick(1.2, SPOT, SPOT);
    b.C.speed = 12; b.C.dir = [1, 0, 0];
    W.tick(1.2, SPOT, SPOT); b.C.speed = 12; b.C.dir = [1, 0, 0];
    W.tick(1.2, SPOT, SPOT);
    ok(b.C.motion.cls === 4 && b.C.clip === 'rhtn', `motion 3 moving: next motion ${b.C.motion.cls} (4), ${b.C.clip} (rhtn)`);
  }
  // moving -> motion 4: |angle| < 30 -> at once 8; 30 .. 150 -> the turn clip (looped, phase 2) until timer 5 and within 90 -> 8
  const go = (dir) => {
    const { W } = world();
    const a = W.addActor({ rec: DOG, mode: 0, pos: [SPOT[0], -0.06, SPOT[2]], face: [0, 0, 1], clip: 'st_a' });
    a.C.f1c0 |= 0x200; a.C.dir = dir; a.C.speed = 12;
    W.t.setMotion(a, 4);
    const seq = [];
    for (let i = 0; i < 12; i++) { a.C.speed = 12; a.C.dir = dir; W.tick(1.2, SPOT, SPOT); seq.push(`${a.C.motion.cls}:${a.C.clip}`); }
    return seq;
  };
  const s0 = go([0, 0, 1]);
  ok(s0[1].startsWith('8:'), `motion 4, moving straight on: motion 8 at once (${s0.slice(0, 3).join(' ')})`);
  const s1 = go([1, 0, 0]);
  const i8 = s1.findIndex(x => x.startsWith('8:'));
  ok(s1[0] === '4:rhtn' && i8 >= 4 && i8 <= 6, `motion 4, move 90 deg right: rhtn, motion 8 after timer 5 at step 1.2 (${s1.slice(0, 7).join(' ')})`);
  const s2 = go([-1, 0, 0]);
  ok(s2[0] === '4:lhtn', `motion 4, move 90 deg left: ${s2[0]} (4:lhtn)`);
  const s3 = go([0, 0, -1]);
  ok(s3.every(x => x.startsWith('4:')) && /[lr]htn/.test(s3[0]), `motion 4, move behind: stays in the turn (|a| > 90) ${s3[0]}`);
  // motion 8 outside +-90 -> 4; table wk_a below 30, rn_a above
  {
    const { W } = world();
    const a = W.addActor({ rec: DOG, mode: 0, pos: [SPOT[0], -0.06, SPOT[2]], face: [0, 0, 1], clip: 'st_a' });
    a.C.f1c0 |= 0x200; a.C.dir = [0, 0, 1];
    W.t.setMotion(a, 8);
    const at = sp => { a.C.speed = sp; W.tick(1.2, SPOT, SPOT); return a.C.clip; };
    at(12);
    ok(at(12) === 'wk_a' && at(60) === 'rn_a', `motion 8 table: 12 u/s ${a.C.clip && 'wk_a'}, 60 u/s rn_a`);
    a.C.dir = [0, 0, -1]; a.C.speed = 60;
    W.tick(1.2, SPOT, SPOT); W.tick(1.2, SPOT, SPOT);
    ok(a.C.motion.cls === 4, `motion 8, move behind the facing: next motion ${a.C.motion.cls} (4)`);
  }
}

// 10. attack ops: 6, 7 (table 8 entry 2 / 0), the leap 9 + 8 (atk_0: forward 100 u/s, height 20), 3 (atk_1: the bullet record 23)
{
  const leap = () => {
    const { W, player } = world();
    const a = W.addActor({ rec: DOG, mode: 0, pos: [SPOT[0], SPOT[1], SPOT[2] - 200], face: [0, 0, 1], clip: 'st_a' });
    W.boneWorld = x => () => [[1, 0, 0], [0, 1, 0], [0, 0, -1], [x.pos[0], x.pos[1] - 8, x.pos[2]]];
    W.tick(1.2, player.pos, player.pos);
    return { W, a, player };
  };
  {
    const { W, a, player } = leap();
    a.C.spd = 75; a.C.gun = 1; a.C.f568 |= 0x8000;
    W.t.setActorState(a, 0x82);
    W.tick(1.2, player.pos, player.pos);
    ok(a.C.spd === 70, `op 6 [6, 0, 0, 0]: C+0x1d4 ${a.C.spd} (status +0x70 = 70; T: w253_dog2 21 u/s = 0.3 x 70 after the first attack)`);
    ok(a.C.gun === 0, `op 6: the gun bit clear (T: k_lunge166 r_atk_0 -> r_gst)`);
    ok(a.b143 === 0xff && !(a.C.f568 & 0x8000), `op 7 [7, 0, -1, 0]: actor +0x143 0x${a.b143.toString(16)}, C+0x568 bit 15 clear`);
  }
  {
    const { W, a, player } = leap();
    const y0 = a.pos[1], z0 = a.pos[2];
    W.t.setActorState(a, 0x80);
    let top = y0, airAt = -1, downAt = -1, zLand = 0, ends = -1, stEnd = null, clipEnd = null, flagsEnd = null, landSt = null, landClip = null;
    for (let i = 0; i < 120; i++) {
      W.tick(1.2, player.pos, player.pos);
      if (a.pos[1] < top) top = a.pos[1];
      if (airAt < 0 && a.B && a.B.state === 2) airAt = i;
      if (airAt >= 0 && airAt === i - 1) ok(!(a.C.f1c0 & 0x200), 'in the air: C+0x1c0 bit 0x200 clear');
      if (airAt >= 0 && downAt < 0 && a.B.state === 0) { downAt = i; zLand = a.pos[2]; }
      if (ends < 0 && W.events.includes(`attack end ${a.id}`)) ends = i;
      if (ends >= 0 && stEnd === null && i > ends) { stEnd = a.astate; clipEnd = a.C.clip; flagsEnd = a.C.flags; }
      if (stEnd === 8 && landSt === null && a.astate !== 8) landSt = a.astate;
      if (landSt !== null && landClip === null && i > 0 && a.C.motion.cls === 0x21 && a.C.clip === 'jp4') landClip = a.C.clip;
    }
    // keyframe 10 at step 1.2: frame 8 or 9; v0 = -sqrt(2 x 235.2 x 20) = -97; rise 0.412 s, fall at 0.8 g 0.461 s: 0.873 s = 44 frames of 0.02
    ok(airAt >= 7 && airAt <= 9, `op 8 at keyframe 10: take-off on frame ${airAt}`);
    ok(Math.abs(y0 - top - 20) < 1.5, `op 8 height ${(y0 - top).toFixed(2)} (20)`);
    ok(downAt - airAt >= 43 && downAt - airAt <= 45, `in the air ${downAt - airAt} frames (44: 0.8 g after the apex)`);
    ok(Math.abs(a.pos[1] - y0) < 1.0, `landed at ground height ${a.pos[1].toFixed(2)} (${y0.toFixed(2)})`);
    const flew = zLand - z0;
    ok(flew > 75 && flew < 90, `op 9 forward ${flew.toFixed(1)} u by the landing (100 u/s x 0.88 s, the body's acceleration first)`);
    ok(ends > 0 && a.C.wk === 0, `attack leave: C+0xcc ${a.C.wk}`);
    ok(stEnd === 8 && clipEnd === 'jp3', `the attack ends in the air (${ends} / landing ${downAt}): actor state ${stEnd} (8), clip ${clipEnd} (jp3, motion 0x22)`);
    ok(flagsEnd === 3, `the fall's request flags ${flagsEnd} (3: FUN_00599820 FUN_003456c0(1.0, row, 0x19, 3, 0))`);
    ok(landSt === 2 && landClip === 'jp4', `on the ground: actor state ${landSt} (2, FUN_00538aa0), clip ${landClip} (jp4, motion 0x21)`);
    ok(a.astate === 2 && a.C.motion.cls === 3 && a.C.clip === 'st_a', `after the landing: state ${a.astate}, motion ${a.C.motion.cls} (3), ${a.C.clip} (st_a)`);
    W.t.setActorState(a, 0x82);
    ok(a.astate === 0x82 && a.C.motion.cls === 0x1002, `the next attack starts (motion 0x${a.C.motion.cls.toString(16)})`);
    W.t.setActorState(a, 2);
    // state 8's enter FUN_005389a8: FUN_00565bd0(a, 0): C+0x1d4 back to status +0x70
    a.C.spd = 75;
    W.t.setActorState(a, 8);
    ok(a.C.spd === 70, `state 8 enter: C+0x1d4 ${a.C.spd} (70)`);
    W.t.setActorState(a, 2);
    const z1 = a.pos[2];
    for (let i = 0; i < 20; i++) W.tick(1.2, player.pos, player.pos);
    ok(Math.abs(a.pos[2] - z1) < 2.0, `no drift after the attack: ${(a.pos[2] - z1).toFixed(2)} u`);
  }
  {
    // killed in state 8 (the attack over, still in the air): FUN_0034f178 cases 9 / 0xb enter mode 0xc, so mover 0xb doesn't stop the fall; the corpse lands
    const { W, a, player } = leap();
    const y0 = a.pos[1];
    W.t.setActorState(a, 0x80);
    let i = 0;
    for (; i < 120 && a.astate !== 8; i++) W.tick(1.2, player.pos, player.pos);
    ok(a.astate === 8 && a.B.state === 2 && y0 - a.pos[1] > 0.05, `in the air in state 8 on frame ${i}: state ${a.astate}, body ${a.B.state}, ${(y0 - a.pos[1]).toFixed(2)} u up`);
    const killY = a.pos[1], kx = a.pos[0], kz = a.pos[2];
    a.hp = 1;
    W.t.hitEnemy(a, { damage: 10, kind: 0, dir: [0, 0, 1], shooter: 0x16, f148: 2, hit: 0, f120: 0x800 }, a.pos.slice());
    ok(a.hp === 0 && a.astate === 7 && a.C.mover === 0xb && a.C.mm === 0xc, `killed in the air: hp ${a.hp}, state ${a.astate} (7), mover 0x${a.C.mover.toString(16)}, mode 0x${a.C.mm.toString(16)}`);
    const v0 = a.C.slide.v;
    W.tick(1.2, player.pos, player.pos);
    ok(a.C.want[2] === 1 && a.C.wk === v0, `the slide goes through C+0xc0 / C+0xcc in the air (FUN_0034af98): dir z ${a.C.want[2]}, speed ${a.C.wk} (${v0})`);
    for (let k = 0; k < 40; k++) W.tick(1.2, player.pos, player.pos);
    ok(a.B.state === 0 && (a.C.f1c0 & 0x200), `the corpse lands: body state ${a.B.state}, C+0x1c0 bit 0x200 ${a.C.f1c0 & 0x200}`);
    ok(a.pos[1] > killY && Math.abs(a.pos[1] - y0) < 1.0, `at ground height ${a.pos[1].toFixed(2)} (${y0.toFixed(2)})`);
    ok(a.astate === 7, `still dead after the landing: state ${a.astate}`);
    const moved = Math.hypot(a.pos[0] - kx, a.pos[2] - kz);
    const x1 = a.pos[0], z1 = a.pos[2];
    for (let k = 0; k < 40; k++) W.tick(1.2, player.pos, player.pos);
    ok(moved > 0 && moved < 40 && a.C.slide.v === 0 && Math.hypot(a.pos[0] - x1, a.pos[2] - z1) < 2, `the slide ends: ${moved.toFixed(1)} u after the kill, then ${Math.hypot(a.pos[0] - x1, a.pos[2] - z1).toFixed(2)} u`);
  }
  {
    // killed during the attack itself, in the air: leaving the attack motion (FUN_0059e938) stops the mover, the body still falls and lands
    const { W, a, player } = leap();
    const y0 = a.pos[1];
    W.t.setActorState(a, 0x80);
    for (let i = 0; i < 120 && !(a.B && a.B.state === 2 && a.B.t > a.B.rise); i++) W.tick(1.2, player.pos, player.pos);
    a.hp = 1;
    W.t.hitEnemy(a, { damage: 10, kind: 0, dir: [0, 0, 1], shooter: 0x16, f148: 2, hit: 0, f120: 0x800 }, a.pos.slice());
    for (let k = 0; k < 60; k++) W.tick(1.2, player.pos, player.pos);
    ok(a.astate === 7 && a.B.state === 0 && Math.abs(a.pos[1] - y0) < 1.0, `killed in the attack: state ${a.astate}, body ${a.B.state}, at ${a.pos[1].toFixed(2)} (${y0.toFixed(2)})`);
  }
  {
    // state 8 at the top of the leap, killed there: frame by frame, the mode-0xc body alone moves it (no flat step on top) and the slide's speed runs down
    const { W, a, player } = leap();
    const y0 = a.pos[1];
    W.t.setActorState(a, 0x80);
    for (let i = 0; i < 120 && !(a.B && a.B.state === 2 && a.B.t > a.B.rise); i++) W.tick(1.2, player.pos, player.pos);
    W.t.setActorState(a, 8);
    a.hp = 1;
    W.t.hitEnemy(a, { damage: 10, kind: 0, dir: [0, 0, 1], shooter: 0x16, f148: 2, hit: 0, f120: 0x800 }, a.pos.slice());
    const { v, dv } = a.C.slide;
    let frames = 0, worst = 0, speeds = true, last = a.pos.slice();
    for (; frames < 80 && a.B.state === 2; frames++) {
      const want = v - frames * dv * 1.2;
      W.tick(1.2, player.pos, player.pos);
      if (a.B.state === 2 && Math.abs(a.C.wk - Math.max(want, 0)) > 1e-3) speeds = false;
      if (a.B.state === 2) worst = Math.max(worst, Math.hypot(a.pos[0] - last[0], a.pos[2] - last[2]) - Math.hypot(a.B.vel[0], a.B.vel[2]) * 1.2);
      last = a.pos.slice();
    }
    ok(frames > 10 && a.B.state === 0 && Math.abs(a.pos[1] - y0) < 1.0, `killed at the top: lands after ${frames} frames at ${a.pos[1].toFixed(2)} (${y0.toFixed(2)})`);
    ok(speeds, 'in the air C+0xcc runs down by the slide\'s deceleration x step (FUN_003516a0)');
    ok(worst < 0.01, `in the air each step is the body's velocity x step (worst excess ${worst.toFixed(3)} u)`);
  }
  {
    const T8 = data.attacks['8'];
    ok(T8.points && T8.points.length === 2 && T8.points[0][2] === 100 && T8.points[0][3] === 4 && T8.points[0][4] === 4, `T+0x28 of table 8: ${JSON.stringify(T8.points && T8.points[0])} (100 ahead, n 4, marker 4)`);
    const { W, a, player } = leap();
    W.t.setActorState(a, 0x81);
    const shots = [];
    for (let i = 0; i < 60; i++) { W.tick(1.2, player.pos, player.pos); for (const e of W.events) if (e === `shot ${a.id}`) shots.push(i); }
    ok(shots.length === 1 && shots[0] >= 42 && shots[0] <= 45, `op 3 at keyframe 53: one bullet on frame ${shots[0]} (FUN_00569870 with W 23)`);
  }
}

// 10a. every clip request resets the root sample C+0x6d0 (FUN_00344608's end): a root attack after b_stp (root 37 u back) starts from there, no jump.
// T: w0256_bstp f634 b_stp, moved 2.58 / 3.61 at most per frame, 37.3 u in all; f744 atk_2 with no move
{
  const q = [0, 0, 0, 1], n = 25;
  const rootTrack = (m, c) => c === 'b_stp' ? { n, t: Array.from({ length: n }, (_, i) => [0, 0, 37.3 * i / (n - 1)]), q: Array(n).fill(q) } : { n: 35, t: Array(35).fill([0, 0, 0]), q: Array(35).fill(q) };
  const { W, player } = world({ rootTrack });
  const a = W.addActor({ rec: DOG, mode: 0, pos: [SPOT[0], SPOT[1], SPOT[2] - 200], face: [0, 0, 1], clip: 'st_a' });
  W.tick(1.2, player.pos, player.pos);
  a.B || W.t.setActorState(a, 2);
  W.t.setActorState(a, 0x84);
  const z0 = a.pos[2];
  for (let i = 0; i < 60; i++) W.tick(1.2, player.pos, player.pos);
  const back = z0 - a.pos[2];
  ok(Math.abs(back - 37.3) < 3, `b_stp moved ${back.toFixed(1)} u back (the stub's 37.3, less the samples the frame rate skips)`);
  W.t.setActorState(a, 0x82);
  let jump = 0, last = a.pos.slice();
  for (let i = 0; i < 20; i++) { W.tick(1.2, player.pos, player.pos); jump = Math.max(jump, Math.hypot(a.pos[0] - last[0], a.pos[2] - last[2])); last = a.pos.slice(); }
  ok(jump < 0.01, `atk_2 after b_stp: largest step ${jump.toFixed(2)} u (0)`);
}

// 10b. the wall bits (FUN_00357d48): straight at the wall south of (-1491, -679), T: the dog's path passes it at x -1500 (w253_dog2) -> C+0x1c0 0x40000 -> state 5 back to a nav path
{
  const { W, a, player } = brainDog();
  player.pos = [-1487.33, 0, -649.45];
  W.tick(1.2, player.pos, player.pos);
  a.pos = [-1491.6, 0, -687]; a.face = [0, 0, 1];
  a.B.poly = col.locate(a.pos[0], a.pos[1], a.pos[2])[0];
  W.t.stopAll(a);
  a.ai.bstate = 3; a.ai.flags |= 2; a.ai.interval = 5; a.ai.btime = W.S.now & 0xffff;
  let bit = false, back = false, seen = new Set();
  for (let i = 0; i < 80; i++) {
    W.tick(1.2, player.pos, player.pos);
    if (a.C.f1c0 & 0x40000) bit = true;
    seen.add(a.ai.bstate);
    if (bit && (a.ai.bstate === 3 || a.ai.bstate === 4)) back = true;
  }
  ok(bit, `the walk into the wall sets C+0x1c0 bit 0x40000`);
  ok(back, `... and brain3 goes back to its nav path (states ${[...seen].join(' ')})`);
  // away from the wall the bits clear on the next move (FUN_0034c388's start), 0x80000 too: not for life (T: k_lock14, 8 records)
  a.pos = [-1500, 0, -700]; a.B.poly = col.locate(a.pos[0], a.pos[1], a.pos[2])[0]; a.C.f1c0 |= 0x40000 | 0x80000 | 0x100000 | 0x400;
  W.t.stopAll(a);
  W.tick(1.2, player.pos, player.pos);
  ok(!(a.C.f1c0 & (0x40000 | 0x80000 | 0x100000 | 0x400)), `one move away from the wall: C+0x1c0 0x${a.C.f1c0.toString(16)} (bits 0x400, 0x40000, 0x80000, 0x100000 clear)`);
}

// 11. against the game: w253_dog2 (notes/route-states.md 'Awake dogs'; tools/trace/out/w253, gitignored), dog 65 with Vincent as traced, the trace's 16 AIs on the scheduler
// (r03_dogawake's queue: with fewer, FUN_00365008's extra run gives a brain run every frame). From the record f97 (brain state 5 begins), no random draw taken
{
  const tp = path.join(process.env.TRACE_OUT || path.join(here, '../../tools/trace/out'), 'w253/w253_dog2.jsonl');
  if (!existsSync(tp)) { console.log('SKIP: w253_dog2 not here'); skipped++; }
  else {
    const rows = readFileSync(tp, 'utf8').trim().split('\n').map(l => JSON.parse(l)).filter(r => r.e2_face_pos).map(r => {
      const b = Buffer.from(r.e2_face_pos, 'hex'), g = i => b.readFloatLE(i * 4), m = typeof r.matrix === 'string' ? JSON.parse(r.matrix) : r.matrix;
      return { f: r.frame, face: [g(0), g(1), g(2)], pos: [g(4), g(5), g(6)], mot: r.e2_motion, sp: r.e2_speed, bs: Buffer.from(r.e2_ai, 'hex')[16], v: [m[3][0], m[3][1], m[3][2]], hp: r.p_hp };
    });
    const at = f => rows.find(r => r.f === f);
    const t0 = at(97);
    const player = { pos: t0.v.slice(), hp: 9999, id: 0x16, f118: 0, s64: 0 };
    const W = AI.createEnemyAI({ data, player, quiet: true, walkMesh: col, log: () => {}, rand: () => 0.9 });
    W.objects.get(ID).vars[7] = 1; W.t.send(W.objects.get(ID), -2, 0x108, [0, 0, 0, 0]);
    W.tick(1.2, player.pos, player.pos);
    const a = W.objects.get(ID);
    for (const r of [50, 51, 55, 56, 58, 59, 60, 66, 87, 111, 113, 114, 131, 132, 133]) { const q = W.objects.get(r + 22); if (q) { q.vars[7] = 0; W.t.send(q, -2, 0x108, [0, 0, 0, 0]); } }
    for (let i = 0; i < 30; i++) W.tick(1.2, player.pos, player.pos);
    ok(W.S.q.length === 16, `the scheduler holds ${W.S.q.length} AIs (16, r03_dogawake)`);
    a.pos = t0.pos.slice(); a.face = t0.face.slice();
    a.B.poly = col.locate(a.pos[0], a.pos[1], a.pos[2])[0];
    W.t.stopAll(a);
    a.ai.bstate = 3; a.ai.flags |= 2; a.ai.interval = 30; a.ai.btime = W.S.now & 0xffff; a.ai.due = W.S.now;
    W.S.q.splice(W.S.q.indexOf(a.ai), 1); W.S.q.unshift(a.ai);
    const P = new Map(), ev = [];
    for (const r of rows) {
      if (r.f < 97 || r.f > 240) continue;
      player.pos = r.v.slice();
      W.tick(1.2, player.pos, player.pos);
      for (const e of W.events) ev.push([r.f, e]);
      P.set(r.f, { pos: a.pos.slice(), sp: a.C.speed, clip: a.C.clip, bs: a.ai.bstate, cls: a.C.motion && a.C.motion.cls });
    }
    const first = (fn, lo = 97, hi = 240) => { for (let f = lo; f <= hi; f++) if (fn(f)) return f; return -1; };
    const tEnd = first(f => at(f).sp === 0), pEnd = first(f => P.get(f).sp === 0);
    ok(Math.abs(tEnd - pEnd) <= 1, `the run stops on f${pEnd} (T f${tEnd})`);
    const dist = Math.hypot(P.get(pEnd).pos[0] - at(tEnd).pos[0], P.get(pEnd).pos[2] - at(tEnd).pos[2]);
    ok(dist < 3, `... ${dist.toFixed(2)} u from where the game stopped`);
    const dv = v => Math.hypot(P.get(pEnd).pos[0] - v[0], P.get(pEnd).pos[2] - v[2]);
    ok(Math.abs(dv(at(pEnd).v) - 12.54) < 0.6, `... ${dv(at(pEnd).v).toFixed(2)} u from Vincent (T 12.54: 0.8 x reach 16 = 12.8 minus the last step)`);
    const tTurn = first(f => at(f).mot === 'rhtn'), pTurn = first(f => P.get(f).clip === 'rhtn', pEnd);
    ok(tTurn === 122 && Math.abs(pTurn - tTurn) <= 1, `AI interval 30: the turn starts f${pTurn} (rhtn; T f${tTurn})`);
    const tAtk = first(f => at(f).mot === 'atk_2'), pAtk = first(f => P.get(f).clip === 'atk_2');
    // T f129 / f135, page f127 / f131: FUN_00365110's interval + the run count of that frame (the others' phases differ)
    // (the two extra ticks per run are S.runs, set by where the other 15 AIs fall that frame; the page's is deterministic with this draw)
    ok(tAtk === 135 && pAtk >= 131 && pAtk <= 135, `atk_2 starts f${pAtk} (T f${tAtk}; 4 early at most)`);
    const pAtkEnd = first(f => P.get(f).clip !== 'atk_2', pAtk), tAtkEnd = first(f => at(f).mot !== 'atk_2', tAtk);
    ok(Math.abs((pAtkEnd - pAtk) - (tAtkEnd - tAtk)) <= 1, `atk_2 lasts ${pAtkEnd - pAtk} frames (T ${tAtkEnd - tAtk})`);
    const hits = ev.filter(([f, e]) => e === `melee ${a.id} hit 1` || e === `melee ${a.id} hit 2`).map(([f]) => f - pAtk).slice(0, 2);
    ok(hits[0] >= 15 && hits[0] <= 16 && hits[1] >= 26 && hits[1] <= 27, `hit volumes at +${hits.join(', +')} (T: HP -29 at +16, -39 at +27)`);
    // the walk after the bite: T 0.1, 6, 9, 12, 15, 18, 21, ... at 0.3 x 70 (op 6) and wk_a, rhtn first
    const seq = (get, from, n) => { const o = []; for (let f = from; f < from + n; f++) o.push(Math.round(get(f) * 10) / 10); return o.join(); };
    ok(pAtkEnd > 0, `the attack ended inside the window (f${pAtkEnd})`);
    const tW = first(f => at(f).sp > 0, tAtkEnd), pW = first(f => P.get(f).sp > 0, pAtkEnd);
    ok(seq(f => at(f).sp, tW, 8) === '0.1,6,9,12,15,18,21,21', `T's walk speeds ${seq(f => at(f).sp, tW, 8)}`);
    ok(seq(f => P.get(f).sp, pW, 8) === seq(f => at(f).sp, tW, 8), `the page's walk speeds ${seq(f => P.get(f).sp, pW, 8)}`);
    const tWk = first(f => at(f).mot === 'wk_a', tW), pWk = first(f => P.get(f).clip === 'wk_a', pW);
    ok(tWk - tW === pWk - pW, `wk_a ${pWk - pW} frames after the walk starts (T ${tWk - tW})`);
    ok(P.get(pW).clip === 'rhtn' && at(tW).mot === 'rhtn', `the walk starts in ${P.get(pW).clip} (T ${at(tW).mot})`);
    const tE2 = first(f => at(f).sp === 0, tW), pE2 = first(f => P.get(f).sp === 0, pW);
    ok(Math.abs(tE2 - pE2) <= 2, `the walk ends f${pE2} (T f${tE2})`);
    const d2 = Math.hypot(P.get(pE2).pos[0] - at(tE2).pos[0], P.get(pE2).pos[2] - at(tE2).pos[2]);
    ok(d2 < 3, `... ${d2.toFixed(2)} u from the game's stop`);
  }
}

// 12. the wake without a shot: w253_dog, Vincent as traced walks through trigger 63 (f90: 59, 60, dog 65 appear), 59 / 60 see him (f228, mode 1, script 36's
// event 2 also reaches script 222: timer 0 = 250), and the dog's brain mode 3 comes 250 frames later, f478; rhtn f492, wk_a f495, rn_a f502
{
  const tp = path.join(process.env.TRACE_OUT || path.join(here, '../../tools/trace/out'), 'w253/w253_dog.jsonl');
  if (!existsSync(tp)) { console.log('SKIP: w253_dog not here'); skipped++; }
  else {
    const rows = readFileSync(tp, 'utf8').trim().split('\n').map(l => JSON.parse(l)).filter(r => r.matrix && r.e2_ai_mode !== undefined);
    const mt = r => (typeof r.matrix === 'string' ? JSON.parse(r.matrix) : r.matrix)[3].slice(0, 3);
    const player = { pos: mt(rows[0]), hp: 9999, id: 0x16, f118: 0, s64: 0 };
    const W = AI.createEnemyAI({ data, player, quiet: true, walkMesh: col, log: () => {} });
    let last = mt(rows[0]);
    const seen = {};
    const mark = (k, f) => { if (seen[k] === undefined) seen[k] = f; };
    for (const r of rows) {
      const p = mt(r);
      W.tick(1.2, last, p); player.pos = p; last = p;
      const d = W.objects.get(ID), s = W.objects.get(59 + 22);
      if (d && d.ai) mark('dog body', r.frame);
      if (s && s.ai && s.ai.mode === 1) mark('59 mode 1', r.frame);
      if (d && d.ai && d.ai.mode === 3) mark('dog mode 3', r.frame);
      if (seen['dog mode 3'] !== undefined && d.C.clip && d.C.clip !== 'st_a') mark(d.C.clip, r.frame);
    }
    const want = { 'dog body': 90, '59 mode 1': 228 };
    for (const k in want) ok(seen[k] === want[k], `${k} on f${seen[k]} (T f${want[k]})`);
    // L: one frame early (the timer's clock against the record's frame; not looked into)
    ok(Math.abs(seen['dog mode 3'] - 478) <= 1, `dog mode 3 on f${seen['dog mode 3']} (T f478)`);
    // from mode 3 the first brain runs, by the scheduler's other 2 AIs here (16 in the game): rhtn up to 14 frames on
    ok(seen.rhtn > 478 && seen.rhtn <= 494, `rhtn f${seen.rhtn} (T f492)`);
    ok(seen.wk_a - seen.rhtn === 3, `wk_a ${seen.wk_a - seen.rhtn} frames after rhtn (T 3: f495)`);
    ok(seen.rn_a - seen.wk_a === 7, `rn_a ${seen.rn_a - seen.wk_a} frames after wk_a (T 7: f502)`);
  }
}

console.log((fails ? `${fails} FAILED` : 'all ok') + (skipped ? ` (${skipped} trace sections skipped)` : ''));
process.exit(fails ? 1 : 0);
