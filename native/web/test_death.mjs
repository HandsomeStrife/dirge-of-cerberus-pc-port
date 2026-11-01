// Vincent's death at HP 0 (worker 0181): player.js hitBranch's HP-0 branches -> FUN_00560fc8 / FUN_00561138
// (death slide FUN_00353340(12, 16) + mover 0xb FUN_003516a0 with the death clip's root motion), state 7
// (FUN_0055b8e0, enter FUN_005386f0), motion class 0xb FUN_00595a60 (c_st_fa0, no blend, no turn), state 7's
// handler FUN_00538780 (and no corpse class, as traced); FUN_005786e8 (no intent / weapon while HP is 0).
// Checked against the PCSX2 trace w181_death_aim_a (tools/trace/out, game-derived, gitignored; script
// tools/trace/scripts/w181_death_aim_a.json, HP poked to 1): a soldier's bullet kills him in frame 788.
//   node --import ./native/web/test_hooks.mjs native/web/test_death.mjs
import { readFileSync, existsSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const OUT = process.env.TRACE_OUT ?? path.join(root, 'tools/trace/out');
const PL = await import(pathToFileURL(path.join(here, 'player.js')).href);
const JC = await import(pathToFileURL(path.join(here, 'jump_core.js')).href);
const { Collision } = await import(pathToFileURL(path.join(here, 'collision.js')).href);
let fail = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };
const done = () => { console.log(fail ? `${fail} FAILED` : 'all ok'); process.exit(fail ? 1 : 0); };
const colPath = path.join(here, 'data/z128_collision.bin'), packPath = path.join(here, 'data/vincent/vincent_jump.json');
if (!existsSync(colPath) || !existsSync(packPath)) { console.log('SKIP: data/z128_collision.bin or data/vincent/vincent_jump.json missing'); done(); }
const cbuf = readFileSync(colPath), col = new Collision(cbuf.buffer.slice(cbuf.byteOffset, cbuf.byteOffset + cbuf.byteLength));
const pack = JSON.parse(readFileSync(packPath, 'utf8')).clips;
const IDLE = () => ({ x: 0, z: 0, stick: 0, keys: new Set(), pressed: new Set() });
const ctrlAt = (p, face) => {
  const c = new PL.PlayerController(col, { pos: { x: p[0], y: p[1], z: p[2] }, heading: Math.atan2(face[0], face[2]) });
  c.locate(); c.pos = { x: p[0], y: p[1], z: p[2] };
  c.C.face = { x: face[0], y: face[1], z: face[2] }; c.heading = Math.atan2(face[0], face[2]);
  Object.assign(c.ctx.motions, pack);             // the jump pack's clips (root tracks: rootDelta)
  return c;
};
const AT = [-1070.912, -146.066, -1105.614], FACE = [0.912, 0, -0.409];

// ------------------------------------------------ branches (hand cases)
{
  const c = ctrlAt(AT, FACE); c.step(IDLE()); c.cSnap = null;
  ok(c.hitReact({ flags: 0x42, dir: [-1, 0, 0], deadNow: true }) === 'death' && c.P.state === 7 && c.C.slide && c.C.slide.mover === 0xb,
     'a bullet that kills (flags 2, P+0x118 bit 3 set): FUN_00560fc8 -> state 7, slide mover 0xb');
  ok(Math.abs(c.C.slide.v - 1.5) < 1e-6 && Math.abs(c.C.slide.dv - 0.09375) < 1e-6, 'death slide FUN_00353340(12, 16): 2d / T = 1.5, / T = 0.09375 per tick');
  ok(c.jump.motion instanceof JC.DeathMotion && c.jump.motion.id === 0xb, 'motion class 0xb (FUN_00537d58 case 7)');
  ok(c.hitReact({ flags: 4, dir: [-1, 0, 0], aliveBefore: false, deadNow: true }) === 'none' && c.P.state === 7, 'hit on the dead: none (FUN_003419c0 != 0x36)');
}
{
  const c = ctrlAt(AT, FACE); c.step(IDLE()); c.cSnap = null;
  ok(c.hitReact({ flags: 0, dir: [-1, 0, 0], deadNow: true }) === 'death' && c.P.state === 7, 'a hit with no reaction flags that kills: FUN_00560fc8');
}
{
  const c = ctrlAt(AT, FACE); c.step(IDLE()); c.cSnap = null;
  ok(c.hitReact({ flags: 4, dir: [0, 0, 1], deadNow: true }) === 'death' && c.P.state === 7 && c.C.turnRate === 0.25 && Math.abs(c.C.turn.z + 1) < 1e-6,
     'a big hit that kills: FUN_00561138 (turn 0.25 toward the hitter, slide, state 7)');
  ok(c.C.slide && c.C.slide.mover === 0xb && Math.abs(c.C.slide.v - 1.5) < 1e-6 && Math.abs(c.C.slide.dv - 0.09375) < 1e-6,
     `big death slide FUN_00353340(DAT_0046edb0 12, DAT_0046edb4 16): v ${c.C.slide && c.C.slide.v} (1.5), dv ${c.C.slide && c.C.slide.dv} (0.09375)`);
}
{
  // FUN_00560fc8: d = DAT_0046edac (5.0) with P+0x28 bits 4 and 0x20; the slide runs with 0x20 only when 0x20000 is set
  const c = ctrlAt(AT, FACE); c.step(IDLE()); c.cSnap = null;
  ok(c.hitReact({ flags: 2, dir: [-1, 0, 0], deadNow: true, f28: 0x20901f | 0x20 | 0x20000 }) === 'death' && c.C.slide && Math.abs(c.C.slide.v - 0.625) < 1e-6,
     `P+0x28 bits 4 + 0x20 (+ 0x20000): slide DAT_0046edac 5: v ${c.C.slide && c.C.slide.v} (2 x 5 / 16 = 0.625)`);
  const c2 = ctrlAt(AT, FACE); c2.step(IDLE()); c2.cSnap = null;
  ok(c2.hitReact({ flags: 2, dir: [-1, 0, 0], deadNow: true, f28: 0x20901f | 0x20 }) === 'death' && !c2.C.slide && c2.P.state === 7,
     'P+0x28 bit 0x20 without 0x20000: no slide, state 7');
}
{
  const c = ctrlAt(AT, FACE); c.step(IDLE()); c.cSnap = null;
  ok(c.hitReact({ flags: 2, dir: [-1, 0, 0], deadNow: true, f118: 0x20209 | 0x8000 }) === 'none' && c.P.state === 2, 'P+0x118 bit 0x8000: no state 7 (FUN_00560fc8 returns 0)');
  c.P.state = 9;
  ok(c.hitReact({ flags: 2, dir: [-1, 0, 0], deadNow: true }) === 'missing' && c.P.state === 9, 'in the air: FUN_00561270 not translated');
  c.P.state = 2; c.active = { name: 'ladder' };
  ok(c.hitReact({ flags: 2, dir: [-1, 0, 0], deadNow: true }) === 'none' && c.P.state === 2, 'on the ladder (FUN_0055a410 states): none');
  c.active = null;
  ok(c.hitReact({ flags: 8, dir: [-1, 0, 0], deadNow: true }) === 'missing' && c.P.state === 2, 'knocked down at HP 0 (FUN_00561270): not translated');
}
{
  // flag 2 with P+0x118 bit 3 clear: the small-hit branch's own death (FUN_00560fc8 on the ground)
  const c = ctrlAt(AT, FACE); c.step(IDLE()); c.cSnap = null;
  ok(c.hitReact({ flags: 2, dir: [-1, 0, 0], deadNow: true, f118: 0x20201 }) === 'death' && c.P.state === 7, 'flag 2, P+0x118 bit 3 clear, HP 0: FUN_00560fc8 (not the flinch)');
}
{
  // FUN_00561138 asks for a turn toward the hitter, but the death class's phase 0 sets C+0x214 = 0 in the same frame
  // (FUN_00353418): he never turns
  const c = ctrlAt(AT, FACE); c.step(IDLE()); c.cSnap = null;
  const h0 = c.heading; let dead = false; c.hpZero = () => dead;
  c.step(IDLE(), cc => { dead = true; cc.hitReact({ flags: 4, dir: [0.409, 0, 0.912], deadNow: true }); });
  for (let i = 0; i < 30; i++) c.step(IDLE());
  ok(c.P.state === 7 && Math.abs(c.heading - h0) < 1e-9, `big killing hit from the side: no turn (heading ${(c.heading - h0).toExponential(1)})`);
}
{
  // FUN_005786e8: FUN_00579570 (the weapon) doesn't run while HP is 0
  const c = ctrlAt(AT, FACE); let calls = 0;
  c.weapon = { drawn: () => false, isAiming: () => false, reset() {} };
  c.weaponHook = { pre() {}, post() {}, weapon() { calls++; return false; } };
  c.step(IDLE()); const n0 = calls;
  c.hpZero = () => true; c.step(IDLE()); c.step(IDLE());
  ok(n0 === 1 && calls === 1, `weapon step: ${n0} call alive, ${calls - n0} while HP is 0`);
}
{
  // FUN_005786e8: no intent while HP is 0. A dead body with a held stick doesn't walk.
  const c = ctrlAt(AT, FACE); c.step(IDLE()); c.cSnap = null;
  c.hitReact({ flags: 2, dir: [-1, 0, 0], deadNow: true }); c.hpZero = () => true;
  for (let i = 0; i < 40; i++) c.step(IDLE());
  const p0 = { ...c.pos }, h0 = c.heading;
  for (let i = 0; i < 20; i++) c.step({ x: 0, z: 1, stick: 1, run: true, keys: new Set(), pressed: new Set() });
  ok(Math.hypot(c.pos.x - p0.x, c.pos.z - p0.z) < 1e-3 && Math.abs(c.heading - h0) < 1e-9 && c.P.state === 7, 'dead + stick held: no move, no turn (FUN_005786e8, C+0x214 = 0)');
}
{
  // the death class ends at the clip end (129 frames at 0.6 a frame); state 7 answers 0, and (as traced) no corpse class
  // starts: the clip holds its last frame, the done event goes once
  const c = ctrlAt(AT, FACE); c.step(IDLE()); c.cSnap = null;
  c.hitReact({ flags: 2, dir: [-1, 0, 0], deadNow: true }); c.hpZero = () => true;
  let doneAt = -1;
  for (let i = 0; i < 600; i++) { c.step(IDLE()); if (doneAt < 0 && c.jump.motion && c.jump.motion.done) doneAt = i; }
  const dones = c.jump.events.filter(e => e.ev === 'death done').length;
  ok(doneAt >= 212 && doneAt <= 215 && dones === 1, `death class done at the clip end (step ${doneAt}), once (${dones})`);
  ok(c.P.state === 7 && c.jump.clock.clip === 'c_st_fa0' && c.jump.clock.frame === 128, `held: state 7, c_st_fa0 at ${c.jump.clock.frame}`);
}

{
  // the page's order: the soldiers run after ctrl.step, so the killing hit lands after this frame's C update and
  // hitReact puts the frame back and reruns it ('death' like 'big'); it must equal the hit at the game's place (preC)
  const A = ctrlAt(AT, FACE), B = ctrlAt(AT, FACE);
  for (let i = 0; i < 3; i++) { A.step(IDLE()); B.step(IDLE()); }
  let dA = false, dB = false; A.hpZero = () => dA; B.hpZero = () => dB;
  A.step(IDLE(), cc => { dA = true; cc.hitReact({ flags: 2, dir: [-0.97, 0, -0.24], deadNow: true }); });
  B.step(IDLE()); dB = true; const r = B.hitReact({ flags: 2, dir: [-0.97, 0, -0.24], deadNow: true });
  let worst = 0;
  for (let i = 0; i < 140; i++) {
    worst = Math.max(worst, Math.hypot(A.pos.x - B.pos.x, A.pos.z - B.pos.z), Math.abs(A.jump.clock.frame - B.jump.clock.frame));
    A.step(IDLE()); B.step(IDLE());
  }
  ok(r === 'death' && B.P.state === 7 && worst < 1e-6, `hit after the step (hitReact redo) = hit before the C update: worst ${worst}`);
}

{
  // play.js's H aid: HP back + ctrl.reset() -> on foot, walks again (not the game's retry)
  const c = ctrlAt(AT, FACE); c.step(IDLE()); c.cSnap = null;
  let dead = true; c.hpZero = () => dead;
  c.hitReact({ flags: 2, dir: [-1, 0, 0], deadNow: true });
  for (let i = 0; i < 20; i++) c.step(IDLE());
  dead = false; c.reset();
  const p0 = { ...c.pos };
  for (let i = 0; i < 20; i++) c.step({ x: 0, z: 1, stick: 1, run: true, keys: new Set(), pressed: new Set() });
  ok(c.P.state === 2 && !c.jump.motion && Math.hypot(c.pos.x - p0.x, c.pos.z - p0.z) > 1, 'H aid (HP back, reset): state 2, walks again');
}

// ------------------------------------------------ the hit side (FUN_0055d678) -> the death cue (worker 0187)
// A melee kill (FUN_0055eac8) writes C+0x590 & 0xf by where the hit point lies in his frame; the death class's
// phase 0 plays cue DAT_005a39b0[side] (ai.json player.death). z128's cues 0x56-0x5b all name asj_501, so the
// cue table here is a copy with one name per cue (c56..c5b) to see which one the chain picked.
const aiPath = path.join(here, 'data/enemies/ai.json');
const AIdata = existsSync(aiPath) ? JSON.parse(readFileSync(aiPath, 'utf8')) : null;
if (!AIdata || !AIdata.player || !AIdata.player.death) console.log('SKIP hit side part: data/enemies/ai.json without player.death (rebuild data/enemies)');
else {
  const AI = await import(pathToFileURL(path.join(here, 'enemy_ai.js')).href);
  ok(AIdata.player.death.cue.join(' ') === '86 86 87 88 89 90 91', `ai.json player.death.cue = DAT_005a39b0 (0x56 0x56 0x57 .. 0x5b): ${AIdata.player.death.cue.map(v => v.toString(16))}`);
  const data = structuredClone(AIdata);
  const cues = data.cues[data.player.cues];
  for (let k = 0x56; k <= 0x5b; k++) cues[k] = 'c' + k.toString(16);
  const R0 = [-FACE[2], 0, FACE[0]];                 // P's matrix row 0 = up x face, up (0, -1, 0)
  // a soldier's melee volume that kills him (HP 1); the point x along row 0, h above his feet
  const kill = (x, h, how = 'melee') => {
    const c = ctrlAt(AT, FACE); c.step(IDLE());       // cSnap: the hit redoes this frame's C update (as on the page)
    const php = { pos: [c.pos.x, c.pos.y, c.pos.z], face: [c.C.face.x, c.C.face.y, c.C.face.z], hp: 1, id: 0x16, f118: 0x20209, s64: 0 };
    const sounds = [];
    const W = AI.createEnemyAI({ data, player: php, quiet: true, damage: true, rand: () => 0.99,
      sound: n => sounds.push(n), react: h => c.hitReact(h),
      hitSide: { get: () => c.C.hitSide ?? 0, set: s => c.setHitSide(s) } });
    const pt = [php.pos[0] + R0[0] * x, php.pos[1] - h, php.pos[2] + R0[2] * x];
    if (how === 'melee') W.t.attackDamagePlayer({ type: 1, dmg: 50, kind: 1, ec: 4, owner: { id: 66, pos: [php.pos[0] - 6, php.pos[1], php.pos[2]] } }, pt);
    else W.t.damagePlayer({ damage: 50, kind: 1, hit: 0, f148: 0, dir: [1, 0, 0], pos: pt, from: { id: 66 } });
    return { c, php, W, cue: sounds.filter(n => /^c5/.test(n)) };
  };
  // [x, h, side, cue]: high (h > 18 x 0.3 = 5.4): 3 / 1 / 4 by x > 0.25 / between / < -0.25; low: 5 / 6 by x >= 0 / < 0
  const cases = [[3, 12, 3, 'c58'], [0, 12, 1, 'c56'], [-3, 12, 4, 'c59'], [0.3, 5.5, 3, 'c58'], [-0.2, 5.5, 1, 'c56'], [0.2, 5.5, 1, 'c56'], [-0.3, 5.5, 4, 'c59'],
                 [3, 2, 5, 'c5a'], [0, 2, 5, 'c5a'], [-3, 2, 6, 'c5b'], [-0.01, 5.3, 6, 'c5b']];
  for (const [x, h, side, cue] of cases) {
    const k = kill(x, h);
    ok(k.php.hp === 0 && k.c.P.state === 7 && k.c.C.hitSide === side && k.c.jump.motion.side === side && k.cue.join() === cue,
       `melee kill, point x ${x} h ${h}: side ${k.c.C.hitSide} (${side}), death class side ${k.c.jump.motion?.side}, cue ${k.cue} (${cue})`);
  }
  const b = kill(3, 12, 'shot');
  ok(b.php.hp === 0 && b.c.P.state === 7 && b.c.C.hitSide === 0 && b.cue.join() === 'c56', `a shot that kills (no FUN_0055d678): side ${b.c.C.hitSide} (0), cue ${b.cue} (c56)`);
  ok(b.W.stageRec.f18 === 1 && kill(0, 2).W.stageRec.f18 === 1, 'FUN_00321328: the death count DAT_0046e248+0x18 + 1 on a kill (P+0x28 bit 2)');
  {
    const c = ctrlAt(AT, FACE); c.C.hitSide = 4; c.step(IDLE());   // side 4 in the frame's start snapshot too
    const php = { pos: [c.pos.x, c.pos.y, c.pos.z], face: [c.C.face.x, c.C.face.y, c.C.face.z], hp: 780, id: 0x16, f118: 0x20209, s64: 0 };
    const W = AI.createEnemyAI({ data, player: php, quiet: true, damage: true, rand: () => 0.99, sound: () => {}, react: h => c.hitReact(h),
      hitSide: { get: () => c.C.hitSide ?? 0, set: s => c.setHitSide(s) } });
    W.t.attackDamagePlayer({ type: 1, dmg: 50, kind: 1, ec: 4, owner: { id: 66, pos: [php.pos[0] - 6, php.pos[1], php.pos[2]] } }, [php.pos[0] + R0[0] * 3, php.pos[1] - 12, php.pos[2] + R0[2] * 3]);
    ok(php.hp > 0 && c.C.hitSide === 0 && W.stageRec.f18 === 0, `a melee hit he lives through writes side 0 (${c.C.hitSide}), no death count`);
  }
}

// ------------------------------------------------ trace w181_death_aim_a (closed loop from the hit frame)
const tp = path.join(OUT, 'w181_death_aim_a.jsonl');
if (!existsSync(tp)) { console.log('SKIP trace part: ' + tp + ' missing'); done(); }
const recs = new Map();
for (const f of [tp, path.join(OUT, 'w181_death_aim_b.jsonl')].filter(existsSync))   // b: f1000-1259 (the held clip)
  for (const l of readFileSync(f, 'utf8').split('\n')) { if (!l) continue; const r = JSON.parse(l); if (r.frame !== undefined) recs.set(r.frame, r); }
{
  const r0 = recs.get(788), m = r0.matrix;
  const c = ctrlAt([m[3][0], m[3][1], m[3][2]], [m[2][0], 0, m[2][2]]);
  // the bullet's horizontal direction: the slide alone moves him in f799-802 (clip frames 6-8: the root is still)
  let sx = 0, sz = 0;
  for (let f = 799; f <= 802; f++) { const a = recs.get(f).matrix[3], b = recs.get(f - 1).matrix[3]; sx += a[0] - b[0]; sz += a[2] - b[2]; }
  const dir = [sx / Math.hypot(sx, sz), 0, sz / Math.hypot(sx, sz)];
  let dead = false;
  c.hpZero = () => dead;
  c.step(IDLE(), cc => { dead = true; cc.hitReact({ flags: 0x42, dir, deadNow: true }); });   // frame 788: the hit, then his C update
  let worst = 0, wf = 0, clipBad = 0, frameBad = 0, stateBad = 0, faceBad = 0;
  let last = 0;
  for (let f = 789; f <= 1259; f++) {
    const r = recs.get(f);
    if (!r) break;
    const p = r.matrix[3], e = Math.hypot(c.pos.x - p[0], c.pos.z - p[2]);
    if (e > worst) { worst = e; wf = f; }
    if (r.mp_layers[0].clip !== c.jump.clock.clip) clipBad++;
    if (Math.abs(r.mp_layers[0].frame - c.jump.clock.frame) > 1e-3) frameBad++;
    if (parseInt(r.p_state.slice(8, 10), 16) !== c.P.state) stateBad++;
    if (Math.abs(Math.atan2(r.matrix[2][0], r.matrix[2][2]) - c.heading) > 1e-4) faceBad++;
    last = f;
    c.step(IDLE());
  }
  ok(last >= 1003, `records compared f789-${last}`);
  ok(stateBad === 0, `state 7 every record (${stateBad} off)`);
  ok(clipBad === 0 && frameBad === 0, `head clip c_st_fa0 and its frame per record (clip ${clipBad} off, frame ${frameBad} off)`);
  ok(faceBad === 0, `facing unchanged (no turn) (${faceBad} off)`);
  ok(worst < 0.005, `position (x / z) per record: worst ${worst.toFixed(4)} u at f${wf} (slide 12 u + the clip's 5 u back, then the 4.5 u at f882-908)`);
}
done();
