// The dog's AI (worker 0252; notes/enemy-ai-hook.md 'Mode 3: the dogs'): script 222's wake paths into brain mode 3
// (FUN_00361690, enemy_ai brain3), the chase and attack picks, the special picks FUN_003600c0 (zone header +0x60 + n,
// ai.json sizes[8].p60), and the leaping bite's damage through the shared melee code. NO TRACE: no PCSX2 state has a dog
// awake (notes: 'no trace'), so the expectations are the decode's, not the game's frames.
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
let fails = 0;
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

// 3. the chase and the attack (brain3 on the z128 walk mesh, the default twister). Vincent's aim bone (target vt+0x5c) is a
// fixture 9 u above his feet: without a pose enemy_ai falls back to 12.4 u (PLAYER_AIM_H, GUESS), which at the dog's stop
// distance (12.4 u, the approach's 0.8 x reach) is exactly entry 2's pitch limit (+4, exclusive) and no entry fits
{
  const { W } = world();
  W.playerBoneWorld = () => () => [[1, 0, 0], [0, 1, 0], [0, 0, 1], [SPOT[0], SPOT[1] - 9, SPOT[2]]];
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

console.log(fails ? `${fails} FAILED` : 'all ok');
process.exit(fails ? 1 : 0);
