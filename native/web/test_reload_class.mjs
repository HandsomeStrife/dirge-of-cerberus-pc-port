// node test_reload_class.mjs -- the reload class 0x1c against what the player does around it (worker 0255; aim.js makeClipControl,
// aim_core input, player.js SpeedAnimator's clock, jump_core canJump; notes/aim-research.md 'Reload motion class 0x1c'). Each
// frame runs the page's order: input (FUN_003320c0), reloadEnter (FUN_00341780 at once), the jump gate (FUN_00577230), the
// weapon states, clips, the clip advance.
//   jump / fall / hit during the reload: FUN_00341780 replaces it, the landing picks from the locomotion table
//   ladder mount: the same; bit 0x4000 refuses ✕, R1 and the second R2 from the enter until 60 clip units are left (T w246
//   records 91-108 / 109: test_reload_motion); circle in the window: no sound, the class stays, the gun-away row at the same
//   frame (C+0x568 bit 0x40000); circle after it: the sound, the class is replaced; the gun-away rows; the standing hand-back.
// AIM_JS / AIM_CORE_JS / PLAYER_JS / JUMP_JS = other copies (mutation runs; AIM_JS imports its own neighbours).
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const imp = (env, f) => import(pathToFileURL(process.env[env] || path.join(here, f)).href);
const { SpeedAnimator, GAME, STEP } = await imp('PLAYER_JS', 'player.js');
const { makeClipControl } = await imp('AIM_JS', 'aim.js');
const { WeaponSystem } = await imp('AIM_CORE_JS', 'aim_core.js');
const { canJump } = await imp('JUMP_JS', 'jump_core.js');
const J = p => JSON.parse(readFileSync(path.join(here, p)));
const MOTIONS = { ...J('data/vincent/vincent.json').clips, ...J('data/vincent/vincent_shoot.json').clips };
// the locomotion table's keys on the page's animator (GAME.loco -> h_st / h_wk / h_rn)
for (const e of GAME.loco) MOTIONS[e.key] ??= { frames: 160 };
const W0 = J('data/aim/weapon.json'), RET = J('data/aim/reticle.json');
let fails = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };

function rig({ speed = 60, drawn = true } = {}) {
  const anim = Object.create(SpeedAnimator.prototype);
  Object.assign(anim, { frames: {}, head: { key: 'h_st_a', frame: 0, prevFrame: 0, loop: true }, out: null, blend: { len: 0, rem: 0, w: 1 },
                        installed: true, cur: -1, override: null, rate: 0.5, current: 'h_st_a', actions: {}, names: {}, table: GAME.loco, request: null });
  anim.has = n => !!MOTIONS[n];
  anim.ensure = function (k) { if (this.frames[k]) return true; if (!MOTIONS[k]) return false; this.frames[k] = MOTIONS[k].frames; return true; };
  anim.ensure('h_st_a');
  const sounds = [];
  const core = new WeaponSystem({ ...W0 }, RET, { step: STEP });
  core.sound = n => sounds.push(n);
  core.P.drawn = drawn; core.P.st = 0; core.ammo.spend(3);
  const ctrl = { onGround: true, jump: { head: false }, P: { state: drawn ? 3 : 2, flags2a8: drawn ? 1 : 0 }, C: { groundSpeed: speed, face: { x: 0, y: 0, z: 1 }, moveDir: { x: 0, y: 0, z: 1 } } };
  const ctl = makeClipControl({ core, anim, ctrl, motions: MOTIONS, step: STEP });
  // one frame; b: the buttons pressed; returns whether ✕ would take off
  const frame = (b = {}) => {
    core.input({ r1Pressed: !!b.r1, r1Held: !!b.r1, r3Pressed: !!b.r3, circlePressed: !!b.circle, r2Pressed: !!b.r2 }, ctrl.onGround, { x: 0, y: 0, z: 10 }, null, { c564: ctl.c564() });
    ctl.reloadEnter();
    const jump = canJump(ctrl, 3, { pressed: !!b.cross, c564: ctl.c564() });
    core.stateMachine(null);
    ctl.clips();
    if (!ctrl.jump.head) anim.gameFrame(ctrl, STEP);
    return jump;
  };
  return { anim, core, ctrl, ctl, frame, sounds };
}

{ // the standing reload ends with its clip (FUN_003460d8), not at the 180-tick limit
  const r = rig({ speed: 0 });
  r.frame(); r.frame({ r2: true });
  let n = 0; while (r.ctl.state().reload && n < 200) { r.frame(); n++; }
  ok(n > 40 && n < 100, `standing reload: h_st_rd's 40 frames at 0.6 a frame hand back after ${n} frames (the 180-tick limit would be 150)`);
  ok(r.anim.head.key === 'h_st_a', `standing hand-back: ${r.anim.head.key} (the aim idle)`);
}
{ // a jump 10 frames into a reload while running, 30 frames in the air
  const r = rig();
  r.frame(); r.frame({ r2: true });
  for (let i = 0; i < 10; i++) r.frame();
  ok(r.anim.head.key === 'h_frn_rd', `10 frames in: ${r.anim.head.key}`);
  r.ctrl.jump.head = true;
  for (let i = 0; i < 30; i++) r.frame();
  ok(!r.ctl.state().reload && r.ctl.c564() === 0, 'the jump class replaced it: no class, C+0x564 bits clear (FUN_00598070)');
  r.ctrl.jump.head = false;
  r.frame(); r.frame();
  ok(!/_rd$/.test(r.anim.head.key), `after the landing: ${r.anim.head.key}, not a reload row`);
}
{ // the ladder mount during a reload
  const r = rig();
  r.frame(); r.frame({ r2: true }); for (let i = 0; i < 10; i++) r.frame();
  r.ctl.actionEnter({ name: 'ladder' });
  ok(!r.ctl.state().reload && r.ctl.c564() === 0, 'the ladder mount replaced it');
  ok(!r.anim.table || !r.anim.table.noLoop, 'the reload table went with the class');
  r.frame();
  ok(!/_rd$/.test(r.anim.head.key), `after the dismount: ${r.anim.head.key}`);
}
{ // the window: ✕, R1, R2
  const r = rig();
  r.frame();
  const same = r.frame({ r2: true, cross: true });
  ok(!same, '✕ in the frame of the reload press: refused (the enter runs inside FUN_003320c0)');
  let first = -1;
  for (let i = 1; i < 40 && first < 0; i++) if (r.frame({ cross: true })) first = i;
  ok(first === 19, `✕ refused until 60 clip units are left: first allowed ${first} frames after the press (T w246_reload_run: press frame 90, bit clear in record 109: 19)`);
  ok(r.ctl.c564() === 0x20000, 'then only bit 0x20000 is left');
  ok(r.frame({ cross: true }), '✕ stays allowed');
}
{ // circle in the window: no sound, the class stays, the frame carries
  const r = rig();
  r.frame(); r.frame({ r2: true }); for (let i = 0; i < 10; i++) r.frame();
  const f0 = r.anim.head.frame, n0 = r.sounds.length;
  r.frame({ circle: true });
  ok(r.sounds.length === n0, 'circle in the window: no holster sound (FUN_005766c0(P, 0, 0))');
  ok(!r.core.P.drawn && r.ctl.state().reload, 'the gun is away, the class still runs');
  ok(r.anim.head.key === 'h_rn_rd', `the gun-away row: ${r.anim.head.key}`);
  ok(Math.abs(r.anim.head.frame - (f0 + 0.6)) < 1e-3, `the frame carries (FUN_00345590 -> FUN_00345448): ${f0.toFixed(2)} -> ${r.anim.head.frame.toFixed(2)}`);
  ok(r.anim.head.loop === false, 'still flags 0x86');
  for (let i = 0; i < 6; i++) r.frame();
  ok(r.anim.head.frame > f0 + 3.5, `no second carry: runs on to ${r.anim.head.frame.toFixed(2)}`);
}
{ // circle after the window: FUN_0055b8e0(P, 2, 0, 0) replaces the class
  const r = rig();
  r.frame(); r.frame({ r2: true }); for (let i = 0; i < 25; i++) r.frame();
  ok(r.ctl.c564() === 0x20000, 'past the window');
  const n0 = r.sounds.length;
  r.frame({ circle: true });
  ok(r.sounds.length === n0 + 1, 'circle: the holster sound');
  ok(!r.ctl.state().reload && !/_rd$/.test(r.anim.head.key), `the class is replaced: ${r.anim.head.key}`);
}
{ // R1 / R3 with the gun away, in the window
  const r = rig({ drawn: false });
  r.frame(); r.frame({ r2: true }); r.frame();
  r.frame({ r1: true });
  ok(!r.core.P.drawn, 'R1 in the window with the gun away: no draw (bVar1 false)');
  r.frame({ r3: true });
  ok(!r.core.P.drawn, 'R3 in the window with the gun away: no draw');
  for (let i = 0; i < 20; i++) r.frame();
  ok(r.ctl.c564() === 0x20000, 'past the window');
  r.frame({ r1: true });
  ok(r.core.P.drawn && !r.ctl.state().reload, 'R1 after it draws and replaces the class');
}
{ // the rows
  for (const [drawn, speed, want] of [[true, 60, 'h_frn_rd'], [true, 15, 'h_fwk_rd'], [true, 0, 'h_st_rd'], [false, 60, 'h_rn_rd'], [false, 15, 'h_wk_rd'], [false, 0, 'h_st_rd']]) {
    const r = rig({ drawn, speed });
    r.frame(); r.frame({ r2: true }); r.frame();
    ok(r.anim.head.key === want, `gun ${drawn ? 'out' : 'away'}, speed ${speed}: ${r.anim.head.key} (${want})`);
  }
}
{ // FUN_005772c8: no second reload while the class runs (bit 0x20000)
  const r = rig();
  r.frame(); r.frame({ r2: true }); for (let i = 0; i < 25; i++) r.frame();
  const a = r.ctl.state().rl.t;
  r.core.P.st = 0;                                         // (the weapon state runs longer than the class on z128: only the gate is tested)
  r.core.ammo.spend(3);                                    // (rounds to reload: else FUN_00563240's dry click)
  r.frame({ r2: true });
  ok(r.core.P.st === 0 && r.ctl.state().rl.t > a, 'R2 with bit 0x20000 set: FUN_005772c8 refuses, the class goes on');
}
// the game (TRACE_FIELDSET=reloadrun, scripts/w255_reload_holster1 / 2: w246_reload_run with circle 10 / 28 frames after R2)
const OUT = process.env.RELOAD_TRACES || path.join(here, '../../tools/trace/out');
for (const [name, press, circle] of [['w255_reload_holster1', 90, 100], ['w255_reload_holster2', 90, 118]]) {
  const file = path.join(OUT, name + '.jsonl');
  if (!existsSync(file)) { console.log('SKIP (no trace)', file); continue; }
  const R = readFileSync(file, 'utf8').trim().split('\n').slice(1).map(l => JSON.parse(l)).map(r => {
    const L = r.mp_layers[Buffer.from(r.mp_head, 'hex')[8]];
    return { f: r.frame, speed: r.ground_speed, clip: L.clip, frame: L.frame, c564: Buffer.from(r.c_564, 'hex').readUInt32LE(0) & 0x24000 };
  });
  const r = rig();
  const bad = [];
  let end = -1;
  for (let i = press - 3; i + 1 < R.length; i++) {
    const nx = R[i + 1];                                    // a record holds the previous frame's result
    if (i === press - 3) { r.anim.head = { key: R[i].clip, frame: R[i].frame, prevFrame: R[i].frame, loop: true }; r.anim.ensure(R[i].clip); }
    r.ctrl.C.groundSpeed = nx.speed;
    r.frame({ r2: R[i].f === press, circle: R[i].f === circle });
    if (R[i].f < press) continue;
    if (!/_rd$/.test(nx.clip) || !r.ctl.state().reload) { end = nx.f; break; }   // (the page's KNOWN early hand-back: test_reload_motion)
    if (r.anim.head.key !== nx.clip || Math.abs(r.anim.head.frame - nx.frame) > 1e-3 || r.ctl.c564() !== nx.c564)
      if (bad.push(`${nx.f}: ${r.anim.head.key} ${r.anim.head.frame.toFixed(2)} ${r.ctl.c564().toString(16)} / ${nx.clip} ${nx.frame.toFixed(2)} ${nx.c564.toString(16)}`) > 3) break;
  }
  ok(!bad.length, `${name}: clip, frame and C+0x564 bits equal the trace to the hand-back at ${end} (${bad.join(' | ') || 'all equal'})`);
}
console.log(fails ? `${fails} FAILED` : 'all ok');
process.exit(fails ? 1 : 0);
