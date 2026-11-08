// Walking with the gun out (worker 0267; Dan 2026-11-08: "the guards on the stairs ... slide around as opposed to animating").
// Motion state 6 (FUN_00594978) / 5 / 0x19 hand a moving body (C+0x1d8 > 0) to motion 9 (FUN_00595440), and 0x16 / 0x18 to 0x17
// (FUN_00597430): a locomotion table by the move's quadrant against the facing (FUN_0036a638), walk / run rows 0x60-0x77 (crouched
// 0x7e-0x89), played by the table step (FUN_00346860, enemy_ai locoFrame). Before this the class stayed 6 and the soldier slid in r_st_a.
//   1. hand cases on an e027 / e048 / e036 actor: each quadrant's clip, the run entry, the stop back to 6, the crouched table
//   2. the PCSX2 trace w161_chase (tools/trace/scripts/w161_chase.json, TRACE_PATH_BODY=1; game-derived, not committed): records
//      46 / 47 in brain mode 5 on mover 0xd. Open loop: each frame the game's facing (C+0x20), move direction (C+0x90), speed
//      (C+0x1d8) and C+0x1c0 go into the motion update + table step (bodyUpdate's order); the clip after it vs the next record's
//      C+0x570, and the pushes vs the MP head index (MP+0x448).
//   node native/web/test_strafe_walk.mjs [enemy_ai.js]
import { readFileSync, existsSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const AI = await import(pathToFileURL(path.resolve(process.argv[2] ?? path.join(here, 'enemy_ai.js'))).href);
const tracePath = path.join(process.env.TRACE_OUT ?? path.join(root, 'tools/trace/out'), 'w161_chase.jsonl');
const dataPath = path.join(here, 'data/enemies/ai.json');
let fail = 0;
const skipped = [];
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };
const skip = m => { console.log('SKIP ' + m); skipped.push(m); };
const done = () => {
  const sk = skipped.length ? ` (${skipped.length} SKIPPED: ${skipped.join('; ')})` : '';
  console.log(fail ? `${fail} FAILED${sk}` : `all ok${sk}`); process.exit(fail ? 1 : 0);
};
if (!existsSync(dataPath)) { skip('data/enemies/ai.json missing (tools/byo/build_web.sh)'); done(); }
const data = JSON.parse(readFileSync(dataPath, 'utf8'));
const STEP = 1.2;

function world(rec, extra = {}) {
  const pl = { pos: [0, 0, 0], hp: 780, id: 0x16, f118: 0, s64: 0 };
  const W = AI.createEnemyAI({ data, player: pl, rand: () => 0.5, quiet: true, log: () => {}, los: () => true, ...extra });
  const a = W.addActor({ rec, astate: 3, f118: 0, face: [0, 0, 1] });
  return { W, a };
}
// FUN_00343160's order without the mover: the motion update (vt+0x24), [the mover: speed -> after], then the next class or the
// table step (which reads the speed the mover left: T w161_chase #47 f1019, stopped by the mover and r_st_a in the same frame)
function frame(W, a, after = null) {
  const C = a.C;
  C.nextMotion = 0;
  C.inUpdate = true;
  try { if (C.motion) W.t.motionUpdate(a, C.motion, STEP); } finally { C.inUpdate = false; }
  if (after != null) C.speed = after;
  if (C.nextMotion) W.t.setMotion(a, C.nextMotion);
  else W.t.locoFrame(a);
}
const rot = (face, deg) => {                                     // a direction deg to the facing's side FUN_00353458 calls positive
  const r = -deg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
  return [face[0] * c + face[2] * s, 0, -face[0] * s + face[2] * c];
};

// ------------------------------------------------ 1. hand cases
const firstRec = (model, stance) => data.records.findIndex(r => r && r.model === model && r.stance === stance);
for (const [model, stance, pre] of [['e027', 31, 'r_'], ['e027', 30, 'm_'], ['e048', 31, 'r_'], ['e036', 30, 'm_']]) {
  const rec = firstRec(model, stance);
  if (rec < 0) { skip(`no ${model} record with stance ${stance}`); continue; }
  const { W, a } = world(rec), C = a.C;
  C.f1c0 |= 0x200;
  W.t.setMotion(a, 6);
  C.speed = 0; C.dir = a.face.slice();
  frame(W, a); frame(W, a);
  const stand = C.clip;
  ok(C.motion.cls === 6 && stand === pre + 'st_a', `${model} #${rec}: standing, motion 6 plays ${stand}`);
  const seen = {};
  for (const [deg, want] of [[0, 'wk_a'], [90, 'lwk_a'], [180, 'bwk_a'], [-90, 'rwk_a'], [20, 'wk_a'], [160, 'bwk_a'], [140, 'lwk_a'], [155, 'bwk_a']]) {
    C.speed = 15; C.dir = rot(a.face, deg);
    frame(W, a); frame(W, a); frame(W, a);
    seen[deg] = `${C.motion.cls.toString(16)}:${C.clip}`;
    ok(C.motion.cls === 9 && C.clip === pre + want, `${model}: moving at ${deg} deg -> motion 9 ${C.clip} (want ${pre + want})`);
  }
  C.speed = 30; C.dir = a.face.slice(); frame(W, a); frame(W, a);
  ok(C.clip === pre + 'rn_a', `${model}: 30 u/s (over FUN_00345e38's 24) -> the run entry ${C.clip}`);
  C.speed = 22; frame(W, a); frame(W, a);
  const at22 = C.clip;
  C.speed = 25; frame(W, a); frame(W, a);
  ok(at22 === pre + 'wk_a' && C.clip === pre + 'rn_a', `${model}: 22 u/s -> ${at22} (walk), 25 u/s -> ${C.clip} (run): threshold 24 (- 0.1 from the run, FUN_00346860)`);
  C.speed = 0; frame(W, a); frame(W, a);
  ok(C.motion.cls === 6 && C.clip === pre + 'st_a', `${model}: stopped -> motion 6, ${C.clip}`);
  // crouched (0x16 -> 0x17): rows 0x78 + 0x7e / 0x81 / 0x84 / 0x87
  W.t.setMotion(a, 0x16); frame(W, a);
  C.speed = 10; C.dir = rot(a.face, 90); frame(W, a); frame(W, a);
  const want17 = model === 'e036' ? null : pre + 'ls_ma';
  ok(C.motion.cls === 0x17 && (want17 == null || C.clip === want17), `${model}: crouched and moving left -> motion 0x17 ${C.clip}${want17 ? ` (want ${want17})` : ''}`);
  C.speed = 0; frame(W, a); frame(W, a);
  ok(C.motion.cls === 0x16, `${model}: crouched, stopped -> motion 0x16 (${C.motion.cls.toString(16)}, ${C.clip})`);
}
// off the ground (C+0x1c0 bit 9 clear) motion 6 only sets its done bit: no walk (FUN_00594978's first phase-1 test)
{
  const { W, a } = world(firstRec('e027', 31)), C = a.C;
  C.f1c0 &= ~0x200; W.t.setMotion(a, 6); C.speed = 15; C.dir = rot(a.face, 90);
  frame(W, a); frame(W, a);
  ok(C.motion.cls === 6 && (C.motion.done & 1), `off the ground, moving: motion 6 kept, done bit (${C.motion.cls.toString(16)}, done ${C.motion.done})`);
  // back on the ground: the class has finished (done bit), nothing switches it to 9 here
  C.f1c0 |= 0x200; W.t.setMotion(a, 6); frame(W, a); frame(W, a);
  // leaving 9 uninstalls its table (FUN_005953b8 -> FUN_00345b58(C, 0, 0, 0)); 0x17's leave (FUN_005973e8) keeps it
  const had = !!C.loco && C.motion.cls === 9;
  C.speed = 0; frame(W, a);                                      // the switch's frame: 6 has not run (or requested) yet
  ok(had && C.motion.cls === 6 && C.loco === null, `9 -> 6: the table is uninstalled by the leave (had ${had}, now ${C.loco === null ? 'none' : 'still there'})`);
  W.t.setMotion(a, 0x16); frame(W, a); C.speed = 10; frame(W, a); frame(W, a);
  const had17 = !!C.loco && C.motion.cls === 0x17;
  C.speed = 0; frame(W, a);
  ok(had17 && C.motion.cls === 0x16 && C.loco !== null && !(C.f564 & 8), `0x17 -> 0x16: the table stays, bits 8 / 0x10 cleared (FUN_00345678)`);
}
// FUN_003455e8 needs the clip in the model's motion sets: e036 has no m_sq_ma, so crouched and moving ahead its table is row 0x78 alone
{
  const rec = firstRec('e036', 30);
  if (rec >= 0 && data.model_clips && data.model_clips.e036 && !('m_sq_ma' in data.model_clips.e036)) {
    const { W, a } = world(rec), C = a.C;
    C.f1c0 |= 0x200; W.t.setMotion(a, 0x16); frame(W, a);
    C.speed = 10; C.dir = a.face.slice(); frame(W, a); frame(W, a);
    ok(C.motion.cls === 0x17 && C.loco && C.loco.rows.length === 1 && C.clip === 'm_sq_a', `e036 crouched, moving ahead: table rows ${C.loco && C.loco.rows.map(r => r.toString(16))} (0x78 only), ${C.clip}`);
  } else skip('e036 / its model_clips (m_sq_ma absent) not in ai.json');
}
// worker 0267 (manager review): the cases below each pin one decoded constant or branch
{
  const rec = firstRec('e027', 31);
  // the crouched raise 0x18 moving -> 0x17, not 9 (FUN_005978e8)
  {
    const { W, a } = world(rec), C = a.C;
    C.f1c0 |= 0x200; C.dir = rot(a.face, 90); C.speed = 12;
    W.t.setMotion(a, 0x18); frame(W, a); frame(W, a);
    ok(C.motion.cls === 0x17, `motion 0x18 (crouch down), moving -> 0x${C.motion.cls.toString(16)} (want 0x17)`);
  }
  // the stand-up 0x19 off the ground and moving -> 9 (FUN_00597ae8 LAB_00597bdc: the move test after the done bit)
  {
    const { W, a } = world(rec), C = a.C;
    C.f1c0 &= ~0x200; C.dir = rot(a.face, 90); C.speed = 12;
    W.t.setMotion(a, 0x19); frame(W, a);
    ok(C.motion.cls === 9, `motion 0x19 in the air, moving -> 0x${C.motion.cls.toString(16)} (want 9)`);
  }
  // the run entry's root speed (FUN_00345e58 entry 2) sets its rate: 30 / 40 = 0.75 -> the run clamp 0.9 -> MP+0x40c 0.45
  {
    const roots = { r_wk_a: 10, r_rn_a: 40 };
    const { W, a } = world(rec, { rootSpeed: (m, c) => roots[c] ?? 0 }), C = a.C;
    C.f1c0 |= 0x200; C.dir = a.face.slice(); C.speed = 30;
    W.t.setMotion(a, 9); frame(W, a); frame(W, a);
    ok(C.clip === 'r_rn_a' && C.loco.root65c === 40 && Math.abs(C.rate - 0.45) < 1e-6, `run entry: root ${C.loco.root65c} (40), rate ${C.rate} (0.45)`);
  }
  // stopping in 9: FUN_00340bb8(C, 1, -1) before 6 (C+0x591 = C+0x6c0, bit 2 clear), in the switch's frame
  {
    const { W, a } = world(rec), C = a.C;
    C.f1c0 |= 0x200; C.dir = rot(a.face, 90); C.speed = 12;
    W.t.setMotion(a, 9); frame(W, a); frame(W, a);
    C.f564 |= 2; C.b591 = 77; C.speed = 0; frame(W, a);
    ok(C.motion.cls === 6 && C.b6c0 > 0 && C.b591 === C.b6c0 && !(C.f564 & 2), `9 stopped -> 6 with the blend reset: C+0x591 ${C.b591} (C+0x6c0 ${C.b6c0}), bit 2 ${C.f564 & 2}`);
  }
  // a shot in motion 8 with the body stopped: +0x74 = 0xe (FUN_00594ef0)
  {
    const { W, a } = world(rec), C = a.C;
    C.f1c0 |= 0x200; C.speed = 0;
    W.t.setMotion(a, 8);
    W.t.setTarget(a.ai, W.player); a.ai.rounds = 10;
    W.shotOf(a.ai);
    ok(C.motion.cls === 0xe, `motion 8, stopped, a shot -> 0x${C.motion.cls.toString(16)} (want 0xe)`);
  }
  // FUN_00345ca8 packs the up partners it finds on their own: e036 has no m_lwk_au, so the left walk entry gets m_lrn_au and the
  // run entry none (a plain 0x87 request)
  const r36 = firstRec('e036', 30);
  if (r36 >= 0 && data.model_clips && data.model_clips.e036 && 'm_lrn_au' in data.model_clips.e036 && !('m_lwk_au' in data.model_clips.e036)) {
    const { W, a } = world(r36), C = a.C;
    C.f1c0 |= 0x200; C.dir = rot(a.face, 90); C.speed = 15;
    W.t.setMotion(a, 9); frame(W, a); frame(W, a);
    const walk = { clip: C.clip, partner: C.partner, flags: C.flags };
    C.speed = 30; frame(W, a); frame(W, a);
    ok(walk.clip === 'm_lwk_a' && walk.partner === 'm_lrn_au' && walk.flags === 0x83, `e036 left walk: ${walk.clip} partner ${walk.partner} (m_lrn_au) flags 0x${walk.flags.toString(16)}`);
    ok(C.clip === 'm_lrn_a' && C.partner == null && C.flags === 0x87, `e036 left run: ${C.clip} partner ${C.partner} (none) flags 0x${C.flags.toString(16)} (0x87)`);
  } else skip('e036 model_clips without the partner rows (rebuild ai.json)');
}
// the raise (5) and the stand-up (0x19) also hand a moving body to 9
{
  const { W, a } = world(firstRec('e027', 31)), C = a.C;
  C.f1c0 |= 0x200; C.dir = rot(a.face, -90);
  for (const cls of [5, 0x19]) {
    W.t.setMotion(a, cls); C.speed = 0; frame(W, a);
    C.speed = 12; frame(W, a); frame(W, a); frame(W, a);
    ok(C.motion.cls === 9 && C.clip === 'r_rwk_a', `motion 0x${cls.toString(16)}, moving -> 9 ${C.clip}`);
  }
}

// a shot in motion 9 with the body stopped (FUN_003605d8 -> FUN_00341b78): the class's +0x74 = 0xe (ctor FUN_00594ef0), the standing shot
{
  const { W, a } = world(firstRec('e027', 31)), C = a.C;
  C.f1c0 |= 0x200; C.dir = rot(a.face, 90); C.speed = 15;
  W.t.setMotion(a, 9); frame(W, a);
  W.t.setTarget(a.ai, W.player); a.ai.rounds = 10; C.speed = 0;
  W.shotOf(a.ai);
  ok(C.motion.cls === 0xe, `motion 9, stopped, a shot -> its +0x74: motion 0x${C.motion.cls.toString(16)} (want 0xe)`);
}

// ------------------------------------------------ 2. w161_chase
if (!existsSync(tracePath)) { skip('trace w161_chase missing (tools/trace/scripts/w161_chase.json)'); done(); }
const recs = readFileSync(tracePath, 'utf8').trim().split('\n').slice(1).map(l => JSON.parse(l));
const hex = s => Buffer.from(s, 'hex');
function st(r, e) {
  const p = `e${e}_`, cm = hex(r[p + 'cmat']), mv = hex(r[p + 'mv']);
  return { face: [0, 1, 2].map(i => cm.readFloatLE(32 + 4 * i)), dir: r[p + 'dir'].slice(0, 3), f1c0: mv.readUInt32LE(0),
           speed: mv.readFloatLE(0x18), clip: r[p + 'motion'], head: hex(r[p + 'mp_head'])[8] };
}
for (const [e, rec] of [[0, 46], [1, 47]]) {
  const { W, a } = world(rec), C = a.C;
  const s0 = st(recs[0], e);
  a.face = s0.face.slice(); C.dir = s0.dir.slice(); C.speed = s0.speed; C.f1c0 = s0.f1c0;
  // f1000: the game is already in a table entry (r_bwk_a); the page enters 9 (phase 0: the table by f1000's quadrant)
  W.t.setMotion(a, s0.speed > 0 ? 9 : 6);
  // and the MP's top layer is the game's at f1000: that clip, aimed (its stance row + 1 as the partner, as locoFrame plays it)
  const rows = data.stances[String(data.records[rec].stance)].motions;
  C.mp = { clip: s0.clip, frame: 0, loop: true, partner: rows[rows.indexOf(s0.clip) + 1] };
  let n = 0, same = 0, pushPage = 0, pushGame = 0, zone = 0, lastMp = C.mp, lastHead = s0.head, lastGame = s0.clip;
  const bad = [], gameSeq = [], pageSeq = [];
  for (let i = 0; i + 1 < recs.length; i++) {
    const x = st(recs[i], e), y = st(recs[i + 1], e);
    a.face = x.face.slice(); C.dir = x.dir.slice(); C.speed = x.speed; C.f1c0 = x.f1c0;
    frame(W, a, y.speed);
    // a push = a request the MP takes (C.mp is replaced unless FUN_005a91c8 drops it: the same clip and partner on top).
    // The game's pushes that keep C+0x570 are FUN_00346860's same-entry re-request on an aim-zone change (C+0x590 bits
    // 25-26 != 27-28; T: #47 f1137 0x55 -> 0x53): zones not decoded, not on the page (fidelity-audit row, worker 0267).
    if (C.mp !== lastMp) { pushPage++; if (process.env.DBG) console.log("push", e, recs[i + 1].frame, C.mp.clip, C.mp.partner, C.motion.cls); }
    if (y.head !== lastHead) { if (y.clip !== lastGame) pushGame++; else zone++; }
    lastMp = C.mp; lastHead = y.head; lastGame = y.clip;
    if (!gameSeq.length || gameSeq[gameSeq.length - 1] !== y.clip) gameSeq.push(y.clip);
    if (!pageSeq.length || pageSeq[pageSeq.length - 1] !== C.clip) pageSeq.push(C.clip);
    n++;
    if (C.clip === y.clip) same++; else if (bad.length < 6) bad.push(`${recs[i + 1].frame}:${C.clip}/${y.clip}`);
  }
  ok(n > 200 && same === n, `#${rec}: clip after each frame = the game's C+0x570 on ${same}/${n} frames${bad.length ? ' (page/game ' + bad.join(' ') + ')' : ''}`);
  ok(gameSeq.join(' ') === pageSeq.join(' '), `#${rec}: clip sequence page ${pageSeq.join(' ')} | game ${gameSeq.join(' ')}`);
  ok(pushPage === pushGame, `#${rec}: MP pushes ${pushPage} (game MP+0x448 pushes with a new clip ${pushGame}; aim-zone re-pushes not modelled: ${zone})`);
}
done();
