// node --import ./native/web/test_hooks.mjs native/web/test_knock.mjs -- the death in the air / knock-down and the revive after it (worker 0255; player.js
// knockDown, jump_core.js KnockMotion, FUN_005618d0, states 0xf / 0x10 / 0x11, notes/items-research.md 'The knock-down'). Real PlayerController + collision, against
// w255_phoenix_air (TRACE_FIELDSET=revive; shot at HP 1 in the jump's wind-up, f788; FUN_0040b5c0's three draws taken from the call log: T 11.36, d 27.01, rise 22).
// Also: death on the ladder, ✕ and R1-free corpse, state 0x16's own timer. JS paths for mutants: run from a scratch copy.
import { readFileSync, existsSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
const here = path.dirname(fileURLToPath(import.meta.url));
const PL = await import(pathToFileURL(path.join(here, 'player.js')).href);
const JC = await import(pathToFileURL(path.join(here, 'jump_core.js')).href);
const { GameOver } = await import(pathToFileURL(path.join(here, 'gameover.js')).href);
const { Collision } = await import(pathToFileURL(path.join(here, 'collision.js')).href);
let fail = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };
const done = () => { console.log(fail ? `${fail} FAILED` : 'all ok'); process.exit(fail ? 1 : 0); };
const colPath = path.join(here, 'data/z128_collision.bin'), packPath = path.join(here, 'data/vincent/vincent_jump.json');
if (!existsSync(colPath) || !existsSync(packPath)) { console.log('SKIP: data missing'); done(); }
const cbuf = readFileSync(colPath), col = new Collision(cbuf.buffer.slice(cbuf.byteOffset, cbuf.byteOffset + cbuf.byteLength));
const pack = JSON.parse(readFileSync(packPath, 'utf8')).clips;
const IDLE = (o = {}) => ({ x: 0, z: 0, stick: 0, keys: new Set(), pressed: new Set(), ...o });
const ctrlAt = (p, face) => {
  const c = new PL.PlayerController(col, { pos: { x: p[0], y: p[1], z: p[2] }, heading: Math.atan2(face[0], face[2]) });
  c.locate(); c.pos = { x: p[0], y: p[1], z: p[2] };
  c.C.face = { x: face[0], y: face[1], z: face[2] }; c.heading = Math.atan2(face[0], face[2]);
  Object.assign(c.ctx.motions, pack);
  return c;
};
const fr = (c, go, S, inp) => {                           // one frame as play.js: the game over first, then the step
  go.frame(S.hp === 0, 1.2, 0);
  if (go.events.includes('revive')) { S.hp = 780; c.revive(); }
  if (go.events.includes('reviveEnd')) { S.s64 = 1; }
  c.step(inp ?? IDLE());
};
const rig = (p, face, s64 = 8) => {
  const S = { hp: 780, s64 }, c = ctrlAt(p, face), go = new GameOver(null);
  go.status = { s64: () => S.s64, settled: () => !!c.P.settled, state: () => c.P.state };
  c.hpZero = () => S.hp === 0;
  return { S, c, go };
};
const TR = path.join(process.env.TRACE_OUT ?? path.join(here, '../../tools/trace/out'), 'w255_phoenix_air.jsonl');
if (!existsSync(TR)) console.log('SKIP trace part: no ' + TR);
else {
  const R = readFileSync(TR, 'utf8').trim().split('\n').slice(1).map(l => JSON.parse(l)).map(r => ({
    f: r.frame, st: parseInt(r.p_state.slice(8, 10), 16), clip: r.motion, x: r.matrix[3][0], y: r.matrix[3][1], z: r.matrix[3][2], hp: r.p_hp, wm: r.wmode & 0xffff, s: r.ps_64, gs: r.ground_speed,
    face: r.matrix[2] }));
  const at = f => R.find(r => r.f === f);
  const r0 = at(786);
  const { S, c, go } = rig([r0.x, r0.y, r0.z], [r0.face[0], 0, r0.face[2]]);
  // the run's speed into the take-off, the ✕ press of f786
  c.C.groundSpeed = r0.gs;
  const draws = [0.3644, 0.0108, 0.8]; c.rng = () => draws.shift() ?? 0.5;
  c.step(IDLE({ cross: true }));                           // record 787: state 8
  c.step(IDLE());                                          // record 788
  ok(c.P.state === 8, `the jump's wind-up: state ${c.P.state}`);
  c.step(IDLE());                                          // frame 788's C update
  const u = (() => { const a = at(788), b = at(789), dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz); return [dx / l, 0, dz / l]; })();
  S.hp = 0;
  const hit = c.hitReact({ flags: 0x42, dir: u, aliveBefore: true, deadNow: true });
  ok(hit === 'knock', `shot in the air at HP 1: FUN_00561270 (${hit})`);
  let maxY = 0, maxXZ = 0, badSt = [], badClip = [];
  const sets = {};
  for (const r of R.filter(r => r.f >= 789)) {
    if (r.f > 789) fr(c, go, S);
    const key = c.jump.clock ? c.jump.clock.clip : null;
    const name = key === 'idle' ? 'h_st' : key;
    if (c.P.state !== r.st) badSt.push(`${r.f}: ${c.P.state.toString(16)} / ${r.st.toString(16)}`);
    if (name !== r.clip && r.st !== 2) badClip.push(`${r.f}: ${name} / ${r.clip}`);
    if (r.f <= 917) { maxY = Math.max(maxY, Math.abs(c.pos.y - r.y)); maxXZ = Math.max(maxXZ, Math.hypot(c.pos.x - r.x, c.pos.z - r.z)); }
    if (sets[r.st] === undefined) sets[r.st] = { page: null, game: r.f };
    if (r.f > 980) break;
  }
  ok(badSt.length <= 1, `player state per record (${badSt.length} off: ${badSt.slice(0, 6).join(' | ') || 'none'})`);
  ok(badClip.length <= 1, `head clip per record (${badClip.length} off: ${badClip.slice(0, 6).join(' | ') || 'none'})`);
  console.log(`     largest error to the settle (record 917): y ${maxY.toFixed(2)}, xz ${maxXZ.toFixed(2)}`);
  ok(maxY < 1.5 && maxXZ < 3, `path: y within 1.5, xz within 3 (the flight of 120 frames)`);
  ok(S.hp === 780 && c.P.state === 2 && go.wm === 2, `revived after it: HP ${S.hp}, state ${c.P.state}, world mode ${go.wm}`);
}
// the live knock-down, FUN_005618d0 with HP left: the get-up class 0x37 (w255_knock_run: flags 8 while running; w255_knock_air: flags 4 in a jump; draws from the call log)
for (const [name, hitF, flags, k, draws, jump] of [['w255_knock_run', 100, 8, 0, [0.5, 0.979128, 0.5], false], ['w255_knock_air', 112, 4, 2, [0.5, 0.181675], true]]) {
  const file = path.join(process.env.TRACE_OUT ?? path.join(here, '../../tools/trace/out'), name + '.jsonl');
  if (!existsSync(file)) { console.log('SKIP trace part: no ' + file); continue; }
  const R = readFileSync(file, 'utf8').trim().split('\n').slice(1).map(l => JSON.parse(l)).map(r => ({
    f: r.frame, st: parseInt(r.p_state.slice(8, 10), 16), clip: r.motion, x: r.matrix[3][0], y: r.matrix[3][1], z: r.matrix[3][2], gs: r.ground_speed, face: r.matrix[2] }));
  const at = f => R.find(r => r.f === f), r0 = at(hitF - 1);
  const { S, c, go } = rig([r0.x, r0.y, r0.z], [r0.face[0], 0, r0.face[2]], 0);
  // the launch's T = 2 d / (v + 0.5) from the trace's first frames
  const u = (() => { const a = at(hitF - 1), b = at(hitF), bb = at(hitF + 1), dx = bb.x - b.x, dz = bb.z - b.z, l = Math.hypot(dx, dz); return [dx / l, 0, dz / l]; })();
  c.rng = () => draws.shift() ?? 0.5;
  if (jump) { c.P.state = 8; c.onGround = false; c.startFall(0); c.body.gy = -94.5; }
  c.step(IDLE()); c.pos = { x: r0.x, y: r0.y, z: r0.z };
  S.hp = 730;
  const hit = c.hitReact({ flags, dir: u, aliveBefore: true, deadNow: false });
  ok(hit === 'knock', `${name}: a live hit, flags ${flags}: ${hit}`);
  const badSt = [], badClip = []; let maxY = 0, maxXZ = 0, lastF = 0;
  for (const r of R.filter(r => r.f >= hitF)) {
    if (r.f > hitF) fr(c, go, S);
    const key = c.jump.clock ? c.jump.clock.clip : null, name2 = c.jump.head ? (key === 'idle' ? 'h_st' : key) : null;
    if (c.P.state !== r.st) badSt.push(`${r.f}: ${c.P.state.toString(16)} / ${r.st.toString(16)}`);
    if (name2 && name2 !== r.clip && !/^h_st/.test(r.clip)) badClip.push(`${r.f}: ${name2} / ${r.clip}`);
    maxY = Math.max(maxY, Math.abs(c.pos.y - r.y)); maxXZ = Math.max(maxXZ, Math.hypot(c.pos.x - r.x, c.pos.z - r.z));
    lastF = r.f;
  }
  // (w255_knock_run: state 0x10 one frame early, and so each change after it: FUN_00359050's ground point moves under him in the game, the page's gy stays at the take-off: L. w255_knock_air: class 0x35's random clip rate plays at 1.0: L)
  ok(badSt.length <= 3, `${name}: player state per record to ${lastF} (${badSt.length} off: ${badSt.slice(0, 5).join(' | ') || 'none'})`);
  ok(badClip.length <= 3, `${name}: head clip per record (${badClip.length} off: ${badClip.slice(0, 5).join(' | ') || 'none'})`);
  console.log(`     ${name}: largest error y ${maxY.toFixed(2)}, xz ${maxXZ.toFixed(2)}`);
  ok(S.hp === 730 && !c.jump.motion && c.P.state === 2, `${name}: on his feet, control back`);
}
const AT = [-1070.912, -146.066, -1105.614], FACE = [0.912, 0, -0.409];
{ // the stick held through it: the roll-up instead of the wait (w255_knock_hold; stick as the run's own direction)
  const file = path.join(process.env.TRACE_OUT ?? path.join(here, '../../tools/trace/out'), 'w255_knock_hold.jsonl');
  if (!existsSync(file)) console.log('SKIP trace part: no ' + file);
  else {
    const R = readFileSync(file, 'utf8').trim().split('\n').slice(1).map(l => JSON.parse(l)).map(r => ({ f: r.frame, st: parseInt(r.p_state.slice(8, 10), 16), clip: r.motion, x: r.matrix[3][0], y: r.matrix[3][1], z: r.matrix[3][2], face: r.matrix[2] }));
    const at = f => R.find(r => r.f === f), r0 = at(99);
    const { S, c, go } = rig([r0.x, r0.y, r0.z], [r0.face[0], 0, r0.face[2]], 0);
    const f0 = at(228).face, STICK = { x: f0[0], z: f0[2], stick: 1 };   // the way he turns once he has the stick back
    const b = at(100), bb = at(101), dl = Math.hypot(bb.x - b.x, bb.z - b.z), u = [(bb.x - b.x) / dl, 0, (bb.z - b.z) / dl];
    const draws = [0.5, 0.979128, 0.5]; c.rng = () => draws.shift() ?? 0.5;
    c.step(IDLE(STICK)); c.pos = { x: r0.x, y: r0.y, z: r0.z };
    S.hp = 730; c.hitReact({ flags: 8, dir: u, aliveBefore: true, deadNow: false });
    let roll = null, back = null, zAt = 0;
    for (const r of R.filter(r => r.f > 100 && r.f <= 240)) {
      fr(c, go, S, IDLE(STICK));
      if (!roll && c.P.state === 2) { roll = r.f; ok(c.jump.motion && c.jump.clock.clip === 'c_rev_r', `the stick in state 0x11: state 2 in record ${r.f} (T 189, a frame early from 0x10's L), clip ${c.jump.clock.clip} (T c_rev_r)`); zAt = c.pos.z; }
      if (roll && !back && !c.jump.motion) { back = r.f; ok(Math.abs(Math.abs(c.pos.z - zAt) - 3.09) < 0.6, `the roll moves him ${Math.abs(c.pos.z - zAt).toFixed(2)} u along his side (T 3.09)`); }
    }
    ok(roll && Math.abs(roll - 189) <= 1, `the roll at ${roll} (T 189)`);
    ok(back && Math.abs(back - 224) <= 2, `the class ends at ${back} (T 223-224)`);
    ok(c.C.groundSpeed > 5, `he walks on with the stick (${c.C.groundSpeed.toFixed(1)} u/s)`);
  }
}
{ // the get-up's lock: the first 40 ticks of class 0x37 give no stick (T w255_knock_gun: bit 0x4000000 34 frames, 211-245)
  const { S, c, go } = rig(AT, FACE, 0);
  c.step(IDLE()); c.cSnap = null; S.hp = 400;
  c.hitReact({ flags: 8, dir: [-1, 0, 0] });
  let g = 0; while (c.P.state !== 2 && g++ < 400) fr(c, go, S);
  ok(c.P.state === 2 && c.jump.motion && c.jump.motion.id === 0x37, `the get-up: state 2, class 0x${c.jump.motion && c.jump.motion.id.toString(16)} after ${g} frames`);
  let n = 0;
  while (c.jump.motion && c.jump.motion.lock && n < 80) { fr(c, go, S, IDLE({ x: 1, z: 0, stick: 1 })); n++; }
  ok(Math.abs(n - 34) <= 1, `the stick is back after ${n} frames (T 34)`);
  let w = 0; while (w++ < 60 && c.C.groundSpeed < 5) fr(c, go, S, IDLE({ x: 1, z: 0, stick: 1 }));
  ok(c.C.groundSpeed >= 5, `with the stick he walks out of it (${c.C.groundSpeed.toFixed(1)} u/s after ${w} frames)`);
}
{ // ✕ in class 0x3a's first 8 ticks: FUN_005763b8: the jump
  const { S, c, go } = rig(AT, FACE, 0);
  c.step(IDLE()); c.cSnap = null; S.hp = 400;
  c.hitReact({ flags: 8, dir: [-1, 0, 0] });
  let g = 0; while (c.P.state !== 0x11 && g++ < 400) fr(c, go, S);
  c.weaponHook = { c564: () => (c.jump.motion && c.jump.motion.knock ? 0x4000 : 0) };   // aim.js c564: the gate FUN_00577230 reads, so only FUN_005763b8 can jump here
  const id = c.jump.motion && c.jump.motion.id;
  fr(c, go, S, IDLE({ cross: true }));
  ok(c.P.state === 8 || c.P.state === 0x20, `✕ just after the landing (class 0x${id && id.toString(16)}): state 0x${c.P.state.toString(16)} (FUN_00575768)`);
}
{ // ... and not after those 8 ticks (FUN_0059dae8 clears the bit): the gate holds, he stays down
  const { S, c, go } = rig(AT, FACE, 0);
  c.step(IDLE()); c.cSnap = null; S.hp = 400;
  c.hitReact({ flags: 8, dir: [-1, 0, 0] });
  let g = 0; while (c.P.state !== 0x11 && g++ < 400) fr(c, go, S);
  c.weaponHook = { c564: () => (c.jump.motion && c.jump.motion.knock ? 0x4000 : 0) };
  for (let i = 0; i < 9; i++) fr(c, go, S);
  fr(c, go, S, IDLE({ cross: true }));
  ok(c.P.state === 0x11, `✕ after the 8 ticks: state 0x${c.P.state.toString(16)}, no jump`);
}
{ // class 0x3e: its own 60-tick timer with no push (T w255_phoenix_air: 50 frames); C+0x1d8 > 0 ends it early (T w255_phoenix: 2)
  const { S, c, go } = rig(AT, FACE);
  c.step(IDLE()); c.cSnap = null; S.hp = 0; c.hitReact({ flags: 2, dir: [-1, 0, 0], deadNow: true });
  let n = 0, guard = 0;
  while (c.P.state !== 0x16 && guard++ < 400) fr(c, go, S);
  ok(c.P.state === 0x16, `the corpse settled, state 0x16 after ${guard} frames (T 215)`);
  ok(c.jump.motion && c.jump.motion.id === 0x3e, 'class 0x3e runs');
  while (c.P.state === 0x16 && n < 80) { fr(c, go, S); n++; }
  ok(n === 50, `state 0x16 lasts ${n} frames on its timer (T 50)`);
  fr(c, go, S);
  ok(!c.jump.head && c.P.state === 2, 'the head layer is back with the locomotion class');
  ok(go.wm === 2 && S.s64 === 1, 'world mode 2, status 0');
}
{ // the corpse takes no ✕ (FUN_00331f08)
  const { S, c, go } = rig(AT, FACE);
  c.step(IDLE()); c.cSnap = null; S.hp = 0; c.hitReact({ flags: 2, dir: [-1, 0, 0], deadNow: true });
  for (let i = 0; i < 5; i++) fr(c, go, S);
  fr(c, go, S, IDLE({ cross: true }));
  ok(c.P.state === 7, `✕ on the corpse: state ${c.P.state}`);
}
{ // no edge reaches an action at HP 0 (the ladder's mount reads ctx.input.pressed; FUN_00333150 is skipped)
  const { S, c, go } = rig(AT, FACE);
  c.step(IDLE()); c.cSnap = null; S.hp = 0; c.hitReact({ flags: 2, dir: [-1, 0, 0], deadNow: true });
  let saw = null;
  c.actions.push({ name: 'probe', canEnter(ctx) { saw = ctx.input.pressed.has('Space'); return false; }, canStart(ctx) { saw = ctx.input.pressed.has('Space'); return false; } });
  fr(c, go, S, IDLE({ pressed: new Set(['Space']) }));
  ok(saw === false, `Space at HP 0 reaches no action (seen: ${saw})`);
}
{ // nor in the knock-down (the page's second jump would take it)
  const { S, c, go } = rig(AT, FACE);
  c.step(IDLE()); c.cSnap = null; S.hp = 0; c.hitReact({ flags: 8, dir: [1, 0, 0], deadNow: true });
  const m = c.jump.motion;
  fr(c, go, S, IDLE({ cross: true }));
  ok((c.P.state === 0xf || c.P.state === 0x10) && c.jump.motion === m, `✕ in the knock-down: state 0x${c.P.state.toString(16)}, the class runs on`);
}
{ // stateMotion to 0x16 from any old state; a state that left 0x16 by itself cannot strand the class
  for (const o of [2, 3, 7, 8, 9, 0xf, 0x10, 0x11, 0x18]) ok(JC.stateMotion(o, 0x16) === 0x3e, `stateMotion(0x${o.toString(16)}, 0x16) = 0x3e`);
  const { S, c, go } = rig(AT, FACE);
  c.step(IDLE()); c.revive();
  c.P.state = 3;                                           // (as the page's R1 bug did)
  c.step(IDLE()); c.jump.motion.t = -1; c.step(IDLE());
  ok(!c.jump.motion, 'class 0x3e done with no state change: FUN_0059dd48 returns class 3, the motion goes');
}
{ // a corpse off a ledge: FUN_00538780 at the death class's done event, off the ground: state 0xf / 0x10, class 0x33 / 0x1b, landing, settled (decomp; no trace)
  const { S, c, go } = rig(AT, FACE);
  c.step(IDLE()); c.cSnap = null; S.hp = 0; c.hitReact({ flags: 2, dir: [-1, 0, 0], deadNow: true });
  ok(c.P.state === 7, 'state 7');
  const m0 = JC.stateEvent(7, 0xb, false, false, true, true), m1 = JC.stateEvent(7, 0xb, false, false, true, false);
  ok(m0 === 0x10 && m1 === 0xf, `FUN_00538780 off the ground: ahead 0x${m0.toString(16)}, else 0x${m1.toString(16)}`);
  ok(JC.stateEvent(7, 0xb, true, false, true, true) === 0, 'on the ground: 0');
  ok(JC.stateEvent(7, 0xd, false, false, true, true) === 0, 'event 0xd: 0');
  c.onGround = false;                                      // the death class's done event with no floor under him
  const st = c.jump.event(c, 0xb);
  ok((st === 0xf || st === 0x10) && c.jump.motion.knock, `the event off the ground: state 0x${st.toString(16)}, class 0x${c.jump.motion.id.toString(16)}`);
  ok(!c.P.settled, 'not settled yet');
  c.startFall(0);
  let n = 0;
  while (n++ < 400 && c.P.state !== 0x16) fr(c, go, S);
  ok(c.P.state === 0x16, `it lands, settles, the revive: state 0x${c.P.state.toString(16)} after ${n} frames`);
}
{ // a kill by a knock-down on the ground (a barrel's flags 8): lands, settles, revives; and with no status the game over's request
  for (const s64 of [8, 0]) {
    const { S, c, go } = rig(AT, FACE, s64);
    c.step(IDLE()); c.cSnap = null; S.hp = 0;
    const r = c.hitReact({ flags: 8, dir: [1, 0, 0], deadNow: true });
    ok(r === 'knock', `flags 8 at HP 0: ${r}`);
    let n = 0; const stn = new Set();
    while (n < 900 && !(s64 ? (c.P.state === 2 && go.wm === 2 && S.hp === 780) : go.w4c === 1)) { fr(c, go, S); stn.add(c.P.state); n++; }
    ok(s64 ? (S.hp === 780 && c.P.state === 2) : go.w4c === 1, `status ${s64}: ${s64 ? 'revived' : 'game over request'} after ${n} frames (states ${[...stn].map(x => x.toString(16))})`);
  }
}
done();
