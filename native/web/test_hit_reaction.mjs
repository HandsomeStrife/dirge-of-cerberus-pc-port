// Vincent's hit reaction (player.js hitReact = FUN_00565480's player branches -> FUN_00562898 big hit:
// slide FUN_003531e0 + mover 9 FUN_00351550, turn FUN_0034b638(0.25), state 0x18 (FUN_00562b30), motion
// class 0x3f FUN_0059df28 playing c_std, state 0x18's done handler FUN_00539b88 -> 2), and the enemy_ai.js
// calls that reach it (melee FUN_0055eac8, bullets FUN_0055db50 with the stagger FUN_0055d950).
// Checked against the PCSX2 trace k_lunge166 (k_melee18's run; tools/trace/out, game-derived, gitignored):
// #66's swing hits him in frame 1462 (record 1463: HP 511, state 0x18), he slides ~4.97 u along the
// railing over 10 frames and is back in state 2 at record 1489.
//   node --import ./native/web/test_hooks.mjs native/web/test_hit_reaction.mjs
import { readFileSync, existsSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const OUT = process.env.TRACE_OUT ?? path.join(root, 'tools/trace/out');
const AI = await import(pathToFileURL(path.join(here, 'enemy_ai.js')).href);
const PL = await import(pathToFileURL(path.join(here, 'player.js')).href);
const { Collision } = await import(pathToFileURL(path.join(here, 'collision.js')).href);
const AIM = await import(pathToFileURL(path.join(here, 'aim.js')).href);
let fail = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };
const done = () => { console.log(fail ? `${fail} FAILED` : 'all ok'); process.exit(fail ? 1 : 0); };
const dataPath = path.join(here, 'data/enemies/ai.json'), colPath = path.join(here, 'data/z128_collision.bin');
if (!existsSync(dataPath) || !existsSync(colPath)) { console.log('SKIP: data/enemies/ai.json or data/z128_collision.bin missing'); done(); }
const data = JSON.parse(readFileSync(dataPath, 'utf8'));
const cbuf = readFileSync(colPath), col = new Collision(cbuf.buffer.slice(cbuf.byteOffset, cbuf.byteOffset + cbuf.byteLength));
const IDLE = () => ({ x: 0, z: 0, stick: 0, keys: new Set(), pressed: new Set() });
const ctrlAt = (p, face) => {
  const c = new PL.PlayerController(col, { pos: { x: p[0], y: p[1], z: p[2] }, heading: Math.atan2(face[0], face[2]) });
  c.locate(); c.pos = { x: p[0], y: p[1], z: p[2] };
  c.C.face = { x: face[0], y: face[1], z: face[2] }; c.heading = Math.atan2(face[0], face[2]);
  return c;
};

// ------------------------------------------------ player.js branches (hand cases)
{
  const c = ctrlAt([-1070.03, -146.0675, -1105.5845], [0.9124, 0, -0.4093]);
  c.step(IDLE());
  c.cSnap = null;                                 // hand-set states below: a hit with no C update of this frame to redo
  ok(c.hitReact({ flags: 0x42, dir: [-1, 0, 0] }) === 'none' && c.P.state === 2 && !c.C.slide,
     'small hit (flags 2 | 0x40, P+0x118 bit 3 set): no reaction, state 2 (traced: bullet hits keep state 2 / 3)');
  ok(c.hitReact({ flags: 4, dir: [-1, 0, 0], f118: 0x20209 | 0x10 }) === 'none' && c.P.state === 2,
     'big hit with P+0x118 bit 4: no reaction');
  ok(c.hitReact({ flags: 8, dir: [-1, 0, 0] }) === 'missing' && c.P.state === 2, 'knock-down (flags 8): not translated, no state change');
  ok(c.hitReact({ flags: 4, dir: [-1, 0, 0], aliveBefore: false, deadNow: true }) === 'none' && c.P.state === 2, 'already dead: no reaction (FUN_003419c0 != 0x36)');
  {                                               // worker 0181: the deaths themselves are in test_death.mjs
    const d = ctrlAt([-1070.03, -146.0675, -1105.5845], [0.9124, 0, -0.4093]); d.step(IDLE()); d.cSnap = null;
    ok(d.hitReact({ flags: 4, dir: [-1, 0, 0], deadNow: true }) === 'death' && d.P.state === 7, 'big hit that kills (FUN_00561138): state 7');
  }
  c.active = { name: 'ladder' };
  ok(c.hitReact({ flags: 4, dir: [-1, 0, 0] }) === 'none' && c.P.state === 2, 'on the ladder (FUN_0055a410 states): no reaction');
  c.active = null;
  c.P.state = 9;
  ok(c.hitReact({ flags: 2, dir: [-1, 0, 0] }) === 'none' && c.hitReact({ flags: 4, dir: [-1, 0, 0] }) === 'missing' && c.P.state === 9,
     'in the air (FUN_0055aa88): small -> none, big -> FUN_005618d0 not translated');
  c.P.state = 2;
  ok(c.hitReact({ flags: 4, dir: [-1, 0, 0] }) === 'big' && c.P.state === 0x18 && c.C.slide && c.jump.motion && c.jump.motion.id === 0x3f,
     'big hit on the ground: state 0x18, slide, motion class 0x3f');
  c.step(IDLE());
  const t1 = c.jump.motion.t, n1 = c.jump.events.filter(e => e.ev === 'hit').length;
  ok(c.hitReact({ flags: 4, dir: [0, 0, 1] }) === 'big' && c.jump.motion.id === 0x3f && c.jump.motion.t === t1
     && c.jump.events.filter(e => e.ev === 'hit').length === n1 && Math.abs(c.C.slide.dir.z - 1) < 1e-6,
     'hit again in state 0x18: same state, so no new motion (FUN_0055b8e0), but a new slide');
}
{
  // the slide alone (FUN_003531e0(5, 12) + FUN_00351550): v 10/12, -v/12 x 1.2 per frame, 10 moving frames,
  // on open floor (no wall) 0.8333 x 1.2 x (10 + 9 + ... + 1) / 10 = 5.5 u
  const c = ctrlAt([-1070.03, -146.0675, -1105.5845], [0.9124, 0, -0.4093]);
  c.step(IDLE());
  const x0 = c.pos.x;
  c.hitReact({ flags: 4, dir: [1, 0, 0] });
  const steps = [c.pos.x - x0];
  for (let i = 0; i < 12; i++) { const x = c.pos.x; c.step(IDLE()); steps.push(c.pos.x - x); }
  const want = [1, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1, 0, 0, 0];
  ok(steps.every((s, k) => Math.abs(s - want[k]) < 2e-3), `slide steps on open floor ${steps.map(s => s.toFixed(3)).join(' ')} (${want.join(' ')})`);
}

// ------------------------------------------------ enemy_ai.js -> react
{
  const calls = [];
  const player = { pos: [0, 0, 0], hp: 780, id: 0x16, f118: 0x20209 };
  const W = AI.createEnemyAI({ data, player, quiet: true, rand: () => 0.5, react: h => { calls.push(h); return 'big'; } });
  const a = W.addActor({ rec: 44, mode: 0, pos: [3, 0, -4], face: [0, 0, 1], clip: 'r_st_a' });
  W.boneWorld = () => () => [[1, 0, 0], [0, 1, 0], [0, 0, 1], [0, -9, -3]];
  W.t.makeAttack(a, data.attacks[String(data.records[44].zones)], 0);
  W.tick(1.2, player.pos, player.pos);
  const h = calls[0];
  ok(calls.length === 1 && h.flags === 4 && Math.abs(h.dir[0] + 0.6) < 1e-6 && Math.abs(h.dir[2] - 0.8) < 1e-6 && h.dir[1] === 0 && h.aliveBefore && !h.deadNow,
     `melee hit -> react(flags ${h && h.flags} (4: type 1 +0xec), dir ${h && h.dir.map(v => v.toFixed(3))} (-0.6, 0, 0.8: from #66 to him, flat))`);
}
{
  // bullets: flags = bullet +0x148 (W+0xc, 0 for z128's soldiers' weapons) | FUN_0055d950: 0x42 from the first
  // hit; 0x44 once the sum (hit value 6 each, gaps < 60 frames) reaches 30; 0x48 at 60
  const calls = [];
  const player = { pos: [0, 0, 0], hp: 780, id: 0x16, f118: 0x20209 };
  const W = AI.createEnemyAI({ data, player, quiet: true, rand: () => 0.5, react: h => { calls.push(h.flags); return 'x'; } });
  ok(data.weapons.every(w => w.react != null) && data.weapons[0].react === 0 && data.weapons[12].react === 8,
     `ai.json weapons carry W+0xc (react): w0 ${data.weapons[0].react} (0), w12 ${data.weapons[12].react} (8)`);
  const shot = () => ({ damage: 1, kind: 0, hit: 6, f148: data.weapons[0].react, dir: [1, 0, 0], pos: [0, -9, 0], from: { id: 66 } });
  for (let i = 0; i < 10; i++) { W.S.mgr20 = 100 + 10 * i; W.t.damagePlayer(shot()); }   // the manager clock (ticks)
  ok(calls.join(',') === [0x42, 0x42, 0x42, 0x42, 0x44, 0x42, 0x42, 0x42, 0x42, 0x48].join(','),
     `ten hits 10 frames apart (hit value 6): flags ${calls.map(x => x.toString(16)).join(',')} (42 x4, 44, 42 x4, 48)`);
  calls.length = 0; W.S.mgr20 = 400; W.t.damagePlayer(shot()); W.S.mgr20 = 470; W.t.damagePlayer(shot());
  ok(calls.join(',') === '66,66', `hits 70 frames apart restart the sum: ${calls.map(x => x.toString(16))} (42, 42)`);
  // worker 0230: the window is mgr +0x20 ticks (FUN_0054cbe8): four hits 10 ticks apart (sum 24, phase 1), then one 70 ticks
  // later restarts the sum (0x42); inside the window it would reach 30 (0x44)
  calls.length = 0; Object.assign(player, { s148: -100000, s150: 0, s152: 0, sphase: 0 });   // a fresh window
  for (let i = 0; i < 4; i++) { W.S.mgr20 = 1000 + 10 * i; W.t.damagePlayer(shot()); }
  W.S.mgr20 = 1030 + 70; W.t.damagePlayer(shot());
  ok(calls.at(-1) === 0x42, `four hits then one 70 ticks later: ${calls.map(x => x.toString(16))} (the last 42: the sum restarted)`);
}

// ------------------------------------------------ frame order: a hit after the step (page) = before the C update (game)
// The game runs the hits in the object lists, then his C update. The page runs ctrl.step first and the soldiers
// after, so hitReact puts the frame back to the start of its C update and runs it again. 'pre' below is the
// game's order (the hits at the start of the C update, after his input / intent: step's preC; nothing to redo);
// 'post' is the page's. They must agree frame by frame, whatever the hits: one, two in the same frame, a re-hit
// in state 0x18, a hit on the frame 0x18 ends.
{
  const P0 = [-1070.03, -146.0675, -1105.5845], F0 = [0.9124, 0, -0.4093];
  const snap = c => JSON.stringify({ pos: c.pos, h: c.heading, P: c.P, C: c.C, body: c.body, g: c.onGround, vel: c.vel,
    m: c.jump.motion, mp: c.jump.motion && Object.getPrototypeOf(c.jump.motion).constructor.name,
    k: c.jump.clock && { clip: c.jump.clock.clip, frame: c.jump.clock.frame, serial: c.jump.clock.serial, bl: c.jump.clock.blendLen },
    ev: c.jump.events.map(e => e.ev + e.frame), a: c.ctx.anim && c.ctx.anim.saveFrame() }, (k, v) => k === 'jumpClock' ? undefined : v);
  // hits: { frame: [dir, ...] }; mk(c) attaches extras (animator, weapon) to a fresh controller
  const run = (hits, order, n = 40, mk = null) => {
    const c = ctrlAt(P0, F0), out = [];
    if (mk) mk(c);
    for (let f = 0; f < n; f++) {
      const hs = hits[f] || [];
      c.step(IDLE(), order === 'pre' && hs.length ? () => { for (const d of hs) c.hitReact({ flags: 4, dir: d }); } : null);
      if (order === 'post') for (const d of hs) c.hitReact({ flags: 4, dir: d });
      out.push(snap(c));
    }
    return { c, out };
  };
  const same = (a, b) => { const i = a.out.findIndex((x, k) => x !== b.out[k]); return i < 0 ? 'all equal' : `differ from frame ${i}`; };
  const stateAt = r => r.out.map(x => JSON.parse(x).P.state);
  const X = [1, 0, 0], Z = [0, 0, 1];

  const one = run({ 1: [X] }, 'post'), onePre = run({ 1: [X] }, 'pre');
  ok(same(one, onePre) === 'all equal', `one hit: page order = game order (${same(one, onePre)})`);
  const end = stateAt(one).findIndex((s, k) => k > 1 && s === 2);   // the frame 0x18 ends (back to 2)

  // a second hit in the same frame (melee + bullet stagger, two soldiers): both before the one C update
  const two = run({ 1: [X, Z] }, 'post'), twoPre = run({ 1: [X, Z] }, 'pre'), zOnly = run({ 1: [Z] }, 'post');
  ok(same(two, twoPre) === 'all equal', `two hits in one frame: page order = game order (${same(two, twoPre)})`);
  ok(same(two, zOnly) === 'all equal', `two hits in one frame = the second one alone (setTurn / slide replaced, one state change, one C update) (${same(two, zOnly)})`);
  ok(two.c.jump.events.filter(e => e.ev === 'hit').length === 1, 'two hits in one frame: one hit motion');

  // a re-hit in state 0x18: FUN_0055b8e0(P, 0x18) finds the same state, so the motion runs on (not restarted);
  // the turn and the slide restart. The clip clock advances once a frame, so 0x18 ends on the single hit's frame.
  const re = run({ 1: [X], 5: [Z] }, 'post'), rePre = run({ 1: [X], 5: [Z] }, 'pre');
  ok(same(re, rePre) === 'all equal', `re-hit in 0x18 (frame 5): page order = game order (${same(re, rePre)})`);
  const clk = r => r.out.map(x => JSON.parse(x).k);
  ok(JSON.stringify(clk(re)) === JSON.stringify(clk(one)) && stateAt(re).indexOf(2, 2) === end,
     `re-hit in 0x18: c_std clock frame by frame as one hit (frame 5: ${clk(re)[5].frame} = ${clk(one)[5].frame}), back to 2 at frame ${stateAt(re).indexOf(2, 2)} (${end})`);
  const zr = JSON.parse(re.out[5]).C.slide, zs = JSON.parse(one.out[5]).C.slide;
  ok(zr && Math.abs(zr.dir.z - 1) < 1e-6 && zs && zr.v > zs.v, `re-hit in 0x18: a new slide along the new hit (v ${zr && zr.v.toFixed(3)} > ${zs && zs.v.toFixed(3)})`);

  // a hit on the frame the first pass ends 0x18: the game sees it in 0x18 (before the C update), so no new
  // hit motion; the C update then ends 0x18 as without it (state 2), and the new slide runs in state 2
  const ex = run({ 1: [X], [end]: [Z] }, 'post'), exPre = run({ 1: [X], [end]: [Z] }, 'pre');
  ok(same(ex, exPre) === 'all equal', `hit on the exit frame (${end}): page order = game order (${same(ex, exPre)})`);
  const exS = JSON.parse(ex.out[end]);
  ok(exS.P.state === 2 && ex.c.jump.events.filter(e => e.ev === 'hit').length === 1 && exS.C.slide && Math.abs(exS.C.slide.dir.z - 1) < 1e-6,
     `hit on the exit frame: state ${exS.P.state.toString(16)} (2), one hit motion, the new slide runs`);

  // no reaction (small hit; P+0x118 bit 3) after the step changes nothing
  const c = ctrlAt(P0, F0); c.step(IDLE()); c.step(IDLE());
  const b0 = snap(c);
  ok(c.hitReact({ flags: 0x42, dir: X }) === 'none' && snap(c) === b0, 'no reaction after the step: the frame is left as it was');
  // ... through a jump (take-off, fall, landing events): a small hit after every step changes nothing
  const jumpRun = small => {
    const j = ctrlAt(P0, F0), out = [];
    for (let f = 0; f < 60; f++) {
      j.step({ ...IDLE(), cross: f === 3 });
      if (small) j.hitReact({ flags: 0x42, dir: X });
      out.push(snap(j));
    }
    return { c: j, out };
  };
  const jr = jumpRun(false), js = jumpRun(true);
  ok(same(jr, js) === 'all equal' && jr.c.jump.events.length > 1,
     `a jump with a no-reaction hit after every step = without (${same(jr, js)}; events ${jr.c.jump.events.map(e => e.ev).join(',')})`);

  // with the animator and the gun drawn (aim.js's clip classes): the animator's layers follow the game's order;
  // the draw (drawHook) runs once a frame, in the hit frame with the pose it had before the hit (the game's draw
  // there blends c_std in at weight 0: the old head alone)
  const animated = (draws) => c => {
    const a = Object.create(PL.SpeedAnimator.prototype);
    Object.assign(a, { frames: { idle: 160, walk: 40, run: 20, c_std: 16, h_st_a: 60 }, head: { key: 'idle', frame: 0, prevFrame: 0 },
                       out: null, blend: { len: 0, rem: 0, w: 1 }, installed: false, cur: -1, override: null,
                       rate: 0.5, current: 'idle', actions: {}, names: {}, table: PL.GAME.loco, request: null });
    a.has = k => k in a.frames; a.ensure = k => k in a.frames;
    a.drawHook = () => draws.push(`${c.frames}:${a.head.key}@${a.head.frame}`);
    c.attach({ anim: a });
    const core = { drawn: () => true, isAiming: () => false, enterFoot() {}, events: [], cam: null, P: { facePt: null } };
    const ctl = AIM.makeClipControl({ core, anim: a, ctrl: c, motions: {}, step: PL.STEP });
    c.weapon = core; c.weaponHook = { pre() {}, weapon() { return false; }, post(i, act) { if (!act) ctl.clips(); } };
  };
  const dA = [], dB = [];
  const an = run({ 3: [X] }, 'post', 40, animated(dA)), anPre = run({ 3: [X] }, 'pre', 40, animated(dB));
  ok(same(an, anPre) === 'all equal', `animator + gun drawn: page order = game order (${same(an, anPre)})`);
  ok(dA.length === 40 && dA[3] === dA[2].replace(/^2:/, '3:').replace(/@.*/, '@' + JSON.parse(an.out[2]).a.head.frame),
     `one draw a frame (${dA.length}); hit frame draws the old head ${dA[3]}`);
  ok(stateAt(an).at(-1) === 3, `gun drawn: 0x18 ends in state 3 (FUN_00539b88 with P+0x100 bit 44): ${stateAt(an).at(-1)}`);
  // a re-hit with the animator: the redo keeps the head layer's clock object (the animator follows it by identity;
  // a new one would restart c_std's blend)
  const reA = run({ 3: [X], 8: [Z] }, 'post', 40, animated([])), reAPre = run({ 3: [X], 8: [Z] }, 'pre', 40, animated([]));
  ok(same(reA, reAPre) === 'all equal', `animator, re-hit in 0x18: page order = game order (${same(reA, reAPre)})`);

  // reset() (respawn / the H test aid) between the step and a hit: nothing of the old life to redo
  const r = ctrlAt(P0, F0); r.step(IDLE()); r.step(IDLE());
  r.spawn = { x: P0[0] + 30, y: P0[1], z: P0[2], heading: 0 }; r.reset();
  r.hitReact({ flags: 4, dir: X });
  ok(Math.abs(r.pos.x - (P0[0] + 30)) < 1e-6 && r.P.state === 0x18, `a hit after reset(): at the spawn (x ${r.pos.x.toFixed(2)}), state 0x18 for the next C update`);
}

// ------------------------------------------------ the trace: k_lunge166 (k_melee18)
const TF = ['k_lunge166', 'k_melee18'].map(n => path.join(OUT, n + '.jsonl')).find(existsSync);
const TC = path.join(OUT, 'k_melee18.calls.jsonl');
if (!TF || !existsSync(TC)) { console.log('SKIP trace part: no tools/trace/out/k_lunge166 / k_melee18 (tools/trace/scripts/k_melee18.json)'); done(); }
const R = new Map(readFileSync(TF, 'utf8').trim().split('\n').slice(1).map(l => JSON.parse(l)).map(r => [r.frame, r]));
const calls = readFileSync(TC, 'utf8').trim().split('\n').map(l => JSON.parse(l)).filter(e => e.hook);
const rc = calls.find(e => e.hook === 'reaction');
const f32s = h => { const b = Buffer.from(h, 'hex'); return Array.from({ length: b.length / 4 }, (_, i) => b.readFloatLE(i * 4)); };
const pos = f => R.get(f).matrix[3].slice(0, 3), face = f => R.get(f).matrix[2].slice(0, 3);
const state = f => parseInt(R.get(f).p_state.slice(8, 10), 16);
const HIT = 1462;                                              // the frame whose logic hits (record 1463 shows it)
{
  // FUN_0057b1b0 case 4 on the game's numbers: #66's position (record HIT's e0_cmat row 3) to Vincent's, flat
  const e = f32s(R.get(HIT).e0_cmat).slice(12, 15), v = pos(HIT);
  const d = [v[0] - e[0], v[2] - e[2]], L = Math.hypot(...d), g = rc['a2+0x0'].f;
  ok(rc.a1 === 4 && Math.abs(d[0] / L - g[0]) < 2e-3 && Math.abs(d[1] / L - g[2]) < 2e-3 && g[1] === 0,
     `FUN_0055ee24's FUN_00565480 call: flags ${rc.a1} (4), dir (${g[0].toFixed(4)}, ${g[2].toFixed(4)}); from #66 to him flat: (${(d[0] / L).toFixed(4)}, ${(d[1] / L).toFixed(4)})`);
}
{
  // closed loop from record HIT: no stick, the hit with the call log's direction in frame HIT after the step
  // (play.js order), then free frames; position, facing and state byte P+0x104 per record
  const c = ctrlAt(pos(HIT), face(HIT));
  const g = rc['a2+0x0'].f;
  let worst = 0, worstF = -1, fworst = 0, stBad = [];
  for (let f = HIT; f <= 1500; f++) {
    c.step(IDLE());
    if (f === HIT) c.hitReact({ flags: 4, dir: [g[0], g[1], g[2]] });
    const r = f + 1, p = pos(r), q = face(r);
    const e = Math.hypot(c.pos.x - p[0], c.pos.z - p[2]);
    if (e > worst) { worst = e; worstF = r; }
    fworst = Math.max(fworst, Math.hypot(c.C.face.x - q[0], c.C.face.z - q[2]));
    if (c.P.state !== state(r)) stBad.push(`${r}:${c.P.state.toString(16)}/${state(r).toString(16)}`);
  }
  const slid = Math.hypot(pos(1473)[0] - pos(HIT)[0], pos(1473)[2] - pos(HIT)[2]);
  ok(worst < 0.01, `k_lunge166 f${HIT + 1}-1501 position: worst ${worst.toFixed(4)} u at f${worstF} (the game slides ${slid.toFixed(3)} u along the railing)`);
  ok(fworst < 2e-3, `facing (matrix row 2): worst ${fworst.toFixed(5)} (one 0.25 turn toward #66 in the hit frame, then none)`);
  ok(stBad.length === 0, `state byte P+0x104 per record (0x18 from f1463, 2 from f1489): ${stBad.length ? stBad.slice(0, 6).join(' ') : 'all equal'}`);
}
done();
