// test_boss_trace.mjs -- boss_z128.js against the PCSX2 trace of the z128 boss fight (worker 0231).
// Trace: tools/trace/out/w231_fight2.jsonl (game-derived, gitignored): from route/r0b_boss2.p2s (stage flag 0 = 36 and
// global flag 19 = 1 poked at the save: main's boss block takes its restart path, kalm_ld(3) loads e024, heri_lastst,
// Zone.boss(true), battle; 1800 frames), no input, TRACE_FIELDSET=enemy TRACE_ERECS=32 TRACE_BOSS_BRAIN=8da900.
//   node native/web/test_boss_trace.mjs        (BOSS_MOD = a mutated copy of boss_z128.js)
// The brain starts from the game's brain bytes at the first record and runs once a frame with the game's AI clock
// (both brain clocks read the AI scheduler's: T); the shots' lives are the game's (their flight is not translated:
// a shot the brain fires takes the slot the game's took, alive while the game's slot holds an id).
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const B = await import(process.env.BOSS_MOD || new URL('./boss_z128.js', import.meta.url).href);
const T = process.env.TRACE_OUT ?? path.join(here, '../../tools/trace/out');
let fail = 0, n = 0;
const ok = (c, m) => { n++; console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };
if (!existsSync(path.join(T, 'w231_fight2.jsonl')) || !existsSync(path.join(here, 'data/enemies/ai.json'))) { console.log('SKIP: trace w231_fight2 or ai.json missing'); process.exit(0); }
const ai0 = JSON.parse(readFileSync(path.join(here, 'data/enemies/ai.json'), 'utf8'));
const e024Clips = JSON.parse(readFileSync(path.join(here, 'data/enemies/e024.json'), 'utf8')).clips;
// worker 0235: also w235_move (the same state, records 531-1189: the left stick held, but Vincent stays pinned at the
// save's spot in this route state, so the boss keeps to states 2 / 3 / 5; the gun burst at record 985)
// worker 0259: w259_boss_box4 / box4b / box4c (route r0b_box4: Vincent walked from r0b_fight into btbox4, no input; brain 0x9a75c0 on this path)
for (const [name, nVolleys] of [['w231_fight2', 1], ['w235_move', 0], ['w259_boss_box4', null], ['w259_boss_box4b', null], ['w259_boss_box4c', null]]) {
const file = path.join(T, name + '.jsonl');
if (!existsSync(file)) { console.log(`SKIP: trace ${name} missing`); continue; }
const recs = readFileSync(file, 'utf8').trim().split('\n').map(l => JSON.parse(l)).slice(1);

const hex = h => Buffer.from(h, 'hex');
function brainOf(r) {
  const b = hex(r.boss_brain), a = hex(r.e0_ai);
  return {
    st: a.readInt16LE(0x10), st26: a.readUInt16LE(0x12), flags: a.readUInt32LE(0),
    prev: b.readInt32LE(0x1c), lastHp: b.readInt32LE(0x20), t: [b.readInt16LE(0x24), b.readInt16LE(0x26), b.readInt16LE(0x28)],
    sub: b.readInt16LE(0x2a), acc: b.readInt16LE(0x2c), alt: b[0x2e] & 1, smoke: (b[0x2e] >> 1) & 1,
    shots: b.readInt8(0x2f), count: b.readInt8(0x30), moves: b.readInt8(0x31),
    ids: [0, 1, 2, 3, 4, 5, 6, 7].map(i => b.readInt32LE(0x34 + 4 * i)),
  };
}
const posOf = r => r.matrix[3].slice(0, 3);                                     // P matrix row 3 (Vincent's position)
const bossPos = r => { const m = hex(r.e0_face_pos); return [m.readFloatLE(16), m.readFloatLE(20), m.readFloatLE(24)]; };

// the run
const g0 = brainOf(recs[0]);
const trig = k => ai0.triggers.find(t => t.idx === k);
const box = k => ({ pos: trig(ai0.names['btbox' + k][1]).m[3].slice(0, 3), t: trig(ai0.names['btbox' + k][1]) });
const P = { pos: posOf(recs[0]), C: { pos: posOf(recs[0]) } };
const C = { pos: bossPos(recs[0]), f568: 0, f1c0: recs[0].e0_mflags >>> 0, f1c4: 4 | 8, f765: 7, f77c: 0x80 };
const ai = { st: g0.st, f26: g0.st26, f20: 1, flags: g0.flags, W: null };
const actor = { f118: 0, pos: C.pos };
const status = { hp: recs[0].e0_hp };
const b = B.makeBrain(ai, actor, status, C);
Object.assign(b, { prev: g0.prev, lastHp: g0.lastHp, t: g0.t.slice(), sub: g0.sub, acc: g0.acc, alt: g0.alt, smoke: g0.smoke,
  shots: g0.shots, count: g0.count, moves: g0.moves, miss: g0.ids.slice(), player: P, f54: 0xc3 });
b.box4 = box(4); b.box5 = box(5); b.boxes = [0, 1, 2, 3].map(box);
const W = ai0.weapons;
b.wg = { name: 'nwe024gn', W: W[ai0.names.nwe024gn[1]] }; b.wm = { name: 'nwe024mn', W: W[ai0.names.nwe024mn[1]] };
ai.W = { f44: b.wg.W.interval, f46: b.wg.W.reload, f48: b.wg.W.mag };

let frame = 0, clock = recs[0].ai_now;
const shots = new Map();                       // sim id -> slot (the game's slot's life)
let nextId = 1;
const log = [];
// inside a trigger volume (FUN_005507a0 as enemy_ai.js: local box of the trigger's inverse matrix)
function inTrig(t, p) {
  const m = t.inv, q = [0, 1, 2].map(c => p[0] * m[0][c] + p[1] * m[1][c] + p[2] * m[2][c] + m[3][c]);
  return q.every((v, c) => t.lo[c] <= v && v <= t.hi[c]);
}
const io = {
  clockA: () => clock, clockB: () => clock, rand: () => 0.5, mshort: () => 17000, difficulty: () => 1,
  // nVolleys === null (Vincent knocked down for real): his clip stands for FUN_003419c0's class (c_fl / h_rev are busy, T: timer 0
  // re-stamped through them; his body runs first, so record f + 1's clip); the clip frame FUN_00346108 reads = 2 x head frame = the step sum since the request
  player: () => P, busy: () => false, motionId: c => (nVolleys === null && c === P.C && /^(c_fl|h_rev)/.test(recs[frame + 1].motion) ? 0x37 : 0), motionDone: () => nVolleys === null && clipFrames * 0.6 >= e024Clips.atk_sp3.frames - 1,
  motionPast: (c, fr) => nVolleys === null && clipFrames * 1.1999999284744263 >= fr,
  motionReq() {}, setClip: (c, nm) => { clipFrames = 0; log.push(`clip ${nm}`); }, bodyMode() {}, bodyFlag() {}, moverRates() {},
  flyTo: (a, p) => log.push(`fly ${p.map(Math.round)}`), turnTo() {}, placeAt() {}, soundBody() {}, soundAt() {},
  shoot(x) {
    // the volley's slot i is the first free slot the brain writes next: found from the call order (FUN_00aa2c40 i)
    const s = { id: nextId++, speed: 100, home: 0, pos: [0, 0, 0] }; log.push(`shoot ${x.kind}`); pend.push(s); return s;
  },
  shotById: id => { let k = shots.get(id); if (k == null && id > 0) { k = b.miss.indexOf(id); if (k < 0) return null; shots.set(id, k); } if (k == null) return null; return brainOf(recs[frame + 1]).ids[k] !== -1 ? { pos: [1e9, 0, 0], home: 0 } : null; },
  shotRetarget() {}, muzzle() {}, marker: () => [0, 0, 0],
  dist: (a, q) => Math.hypot(a.pos[0] - q.pos[0], a.pos[1] - q.pos[1], a.pos[2] - q.pos[2]),
  inBox: (bx, p) => inTrig(bx.t, p.pos), targetDead: () => false, targetPlayer() {}, fxHost: () => ({}), dropBrain() {},
  attackVolume() {}, clampToBox: p => p, effect() {}, effectEnd() {}, stagger() {}, motionStop() {}, die() {}, lockable() {},
  hudGauge() {},
};
let pend = [];
let clipFrames = 0;
let mism = 0, first = null;
for (frame = 0; frame + 1 < recs.length; frame++) {
  const r = recs[frame];
  // record f is logged before frame f's logic (the state after f - 1); the AI clock frame f's update reads has
  // already advanced: record f + 1's (T: the gun rest W+0x46 = 240 ends at 3852 - 3612)
  clock = recs[frame + 1].ai_now; P.pos = posOf(r); status.hp = r.e0_hp;
  if (nVolleys === null) {                     // the body is the game's: position, FUN_0034ab40's arrival (+0x1c4 bit 4: move mode 0)
    C.pos = actor.pos = bossPos(r); clipFrames++;
    // bit 8 (turn done) has no traced field: the game's own leaving state 4 / 6 stands for it
    C.f1c4 = (r.e0_move_mode === 0 ? 4 : 0) | (brainOf(recs[frame + 1]).st === ai.st && (ai.st === 4 || ai.st === 6) ? 0 : 8);
  }
  pend = [];
  B.update(b, io);
  // the brain wrote its new shots into b.miss: map each sim id to its slot
  for (let i = 0; i < 8; i++) if (pend.some(s => s.id === b.miss[i])) shots.set(b.miss[i], i);
  const g = brainOf(recs[frame + 1]);
  const simIds = b.miss.map(id => (id === -1 ? -1 : 0)), gIds = g.ids.map(id => (id === -1 ? -1 : 0));
  const same = ai.st === g.st && b.sub === g.sub && b.count === g.count && b.moves === g.moves && b.alt === g.alt &&
    b.shots === g.shots && (b.t[0] & 0xffff) === (g.t[0] & 0xffff) && simIds.join() === gIds.join();
  if (!same) { mism++; if (!first) first = { f: frame + 1, sim: { st: ai.st, sub: b.sub, count: b.count, moves: b.moves, alt: b.alt, shots: b.shots, t0: b.t[0], ids: simIds.join() }, game: { st: g.st, sub: g.sub, count: g.count, moves: g.moves, alt: g.alt, shots: g.shots, t0: g.t[0], ids: gIds.join() } }; }
}
ok(mism === 0, `${name}: brain state / sub-state / count / moves / alternation / shots / timer 0 / shot slots match the game every frame (${recs.length - 1} frames, ${mism} off${first ? ': first ' + JSON.stringify(first) : ''})`);
if (nVolleys) ok(log.filter(s => s.startsWith('shoot')).length === 4, `one volley of 4 missiles (game: slots 0, 1, 4, 5) (${log.filter(s => s.startsWith('shoot')).length})`);
else if (name === 'w259_boss_box4b') ok(ai.st === brainOf(recs.at(-1)).st && log.includes('clip atk_sp1') && log.includes('fly 733,-100,1407'), `${name}: the dive (state 4, atk_sp1) flies to 60 u short of Vincent, y his (FUN_00aa1a48 sub 1: T stops at 732.5, -100, 1406.8)`);
else if (name === 'w259_boss_box4c') ok(log.filter(s => s.startsWith('shoot')).length === 4, `${name}: state 6's volley of 4 homing missiles at clip frame 228 (game: slots 0, 1, 4, 5) (${log.filter(s => s.startsWith('shoot')).length})`);
else if (nVolleys === 0) { const k = log.filter(s => s.startsWith('shoot 17') || s.startsWith('shoot 18')).length; ok(k === ai.W.f48, `${name}: one gun burst of W+0x48 = ${ai.W.f48} marker shots (${k})`); }
}

// worker 0235: the homing move FUN_00556218 (enemy_ai.js homingStep) against the game's missiles, frame by frame.
// Trace w235_missile (r0b_boss2, no input, TRACE_CALLLOG=missile 130:330): each bullet after its move (position, direction,
// target point +0xd0, +0x150 mode / +0x154 turn rate / +0x158 distance / +0x15c range). A step = the bullet at frame f
// plus frame f + 1's target point, turn rate and speed (the brain writes them before the bullets move) -> f + 1.
{
  const cf = path.join(T, 'w235_missile.calls.jsonl');
  if (!existsSync(cf)) console.log('SKIP: trace w235_missile missing');
  else {
    const { createEnemyAI } = await import(process.env.MUTATE_AI ? pathToFileURL(path.resolve(process.env.MUTATE_AI)).href : new URL('./enemy_ai.js', import.meta.url).href);
    const E = readFileSync(cf, 'utf8').trim().split('\n').slice(1).map(l => JSON.parse(l.replace(/\bNaN\b/g, 'null')));
    const fl = u => u.map(h => { const q = Buffer.alloc(4); q.writeUInt32LE(parseInt(h, 16)); return q.readFloatLE(0); });
    const Wd = createEnemyAI({ data: ai0, player: { pos: [0, 0, 0], hp: 1 }, quiet: true, log: () => {} });
    const byF = new Map(); for (const e of E) { if (!byF.has(e.frame)) byF.set(e.frame, []); byF.get(e.frame).push(e); }
    let steps = 0, turning = 0, maxP = 0, maxD = 0;
    for (const e of E) {
      const nx = (byF.get(e.frame + 1) || []).find(x => x['a3+0xe0'].u.slice(0, 3).join() === e['a3+0x90'].u.slice(0, 3).join());
      if (!nx || ((parseInt(nx['a3+0x150'].u[0], 16) >> 20) & 0xf) !== 1) continue;
      const m = fl(nx['a3+0x150'].u), t = fl([nx['a3+0x124'].u[0], nx['a3+0x124'].u[2]]);
      const bl = { pos: fl(e['a3+0x90'].u).slice(0, 3), dir: fl(e['a3+0x80'].u).slice(0, 3), end: fl(nx['a3+0xd0'].u).slice(0, 3), target: null,
                   home: m[1], speed: t[1], d158: fl(e['a3+0x150'].u)[2], range: m[3], age: t[0], f120: 0 };
      Wd.t.homingStep(bl, Math.fround(1.2));
      const gp = fl(nx['a3+0x90'].u), gd = fl(nx['a3+0x80'].u);
      maxP = Math.max(maxP, ...bl.pos.map((v, i) => Math.abs(v - gp[i])));
      maxD = Math.max(maxD, ...bl.dir.map((v, i) => Math.abs(v - gd[i])));
      steps++; if (m[1] > 0) turning++;
    }
    ok(steps > 600 && turning > 400, `w235_missile: ${steps} missile steps, ${turning} while homing (+0x154 > 0)`);
    ok(maxP <= 2e-4 && maxD <= 1e-6, `homingStep = the game's FUN_00556218: position within ${maxP.toExponential(2)} u, direction within ${maxD.toExponential(2)}`);
  }
}
console.log(fail ? `${fail} FAILED` : `all ok (${n})`);
process.exit(fail ? 1 : 0);
