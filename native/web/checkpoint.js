// Restart -> the last checkpoint (worker 0201; notes/checkpoint-research.md, fidelity-audit "Restart").
//
// The game (decoded; T = PCSX2 trace w201_reload, from a state saved at the reload after game over -> Restart):
//   game over ✕ Restart: FUN_005349c0 -> 6 ... FUN_003fdf00 -> DAT_0047db88 = 6 -> the stage loop FUN_004012c0
//     (default case: FUN_003fdd00() == 6 -> FUN_002574a0, FUN_0031dbc8) returns 6;
//   pause OK on Restart: FUN_003c0a20 + FUN_003dee40(0xf) -> FUN_004012c0 case 0xf: FUN_00241990(0xe, 1), returns 6.
//   Both: the stage program FUN_00401b90 (cmd 6) returns 6 -> FUN_00247508 game state 0x15, case 6: FUN_003ea1d0(-1),
//   FUN_003e62d0(-1), FUN_00241990(0xd, 1) (or, with bit 0xe, FUN_0030f3d8: the status reset), -> game state 0x13:
//   FUN_00312c68(0), FUN_003ff0c0(alloc, DAT_004b8ba0 (stage 0x80), DAT_004b8ba2[0 / 1] (0, 0)) -> 0x14 FUN_00402220
//   (load) -> 0x15: the stage program runs again from index 0 (the save's program: cmds 0xd, 0xc, 5, 1, 0x11 x 7,
//   4, 0xa, 0 = area 0x80 entry (1, 2), 6 = the stage loop).
//   FUN_003ff0c0: no checkpoint record in use (save block DAT_004b8940 +0x1c4 / mode bits 3 / 5 in this save) ->
//   program index +0xc = 0 and FUN_004039d0: all 64 event flags 0 (T: evt_flags XOR key all 0 after the reload).
// So the z128 checkpoint is the stage start. In between the game shows the stage-result Status screen, the 'Sea of
// Flames' load title and the stage's opening cutscenes (not on the page: warned).
//
// The restored state, as traced (record 10 after the reload = the placement; the save state's own values in brackets):
//   Vincent C+0x30 (-1395.1516, ground -98.6444, -1111.0149) [the save: the same], facing C+0x20 (0.00082, 0, 1.0)
//   [save (0.1753, 0, 0.9845)], HP 780 [780], P+0x118 0x20209 [0x20209], gun drawn (h_st_a) [holstered, h_st];
//   soldiers 44-49 / 66: state +0x104, +0x118, HP, position and clip equal to the save's; 41-43 alive and attacking
//   (HP 10 / 28 / 24, astate 3) [dead in the save]; event flags all 0 [the page's start: {2: 7, 46: 1}].
// Where the stage start's position comes from in code / data is not found (stage files and every extracted file
// searched for the floats: no plain copy; two attempts, notes): the page takes the traced values below.

// Vincent at the checkpoint (T: w201_reload record 10; x / z = the save state's C+0x30 bit for bit)
export const CHECKPOINT = Object.freeze({
  pos: Object.freeze({ x: -1395.151611328125, y: -98.64443969726562, z: -1111.014892578125 }),
  face: Object.freeze({ x: 0.0008162574958987534, z: 0.9999997615814209 }),   // C+0x20 at the placement
  // CAM+0x80 at the placement: the gun-drawn view (kept for the tests; the page restarts holstered and uses its start
  // camera, see restoreCheckpoint)
  camFwd: Object.freeze([-0.0005414184415712953, -0.42466089129447937, 0.9053523540496826]),
  hp: 780,                                       // status +0x20 (FUN_0030f3d8's status reset; T)
  f118: 0x20209,                                 // P+0x118 (T)
  eventFlags: Object.freeze({}),                 // FUN_004039d0: all 0 (T)
  // the world's frame counter (DAT_0046e938+0x20 = enemy_ai S.frame) at the placement: 14 in the state saved at the
  // reload (= w201_reload record 0), + 10 frames to record 10 (L: +1 a frame). The opening cutscenes don't advance it.
  frame: 24,
  // the new AI scheduler's clock (FUN_00365008: += int(step) accumulated; DAT_0046f4ec +0): T w201_reload ai_now 14 at
  // record 0, 26 at record 10, so the rebuilt scheduler runs in the frames before the placement. Its fraction: every
  // value in [0.2001, 0.4] gives all 270 traced records (L: 0.3 taken)
  aiNow: 26, aiAcc: 0.3,
});

// heading (player.js: face = (sin h, 0, cos h))
export const checkpointHeading = () => Math.atan2(CHECKPOINT.face.x, CHECKPOINT.face.z);

// Vincent's stamps against the world's frame counter after the reload (decoded): the stage loop's exit tears the world
// down (FUN_004012c0 -> FUN_003249d0 -> FUN_003236c8 -> FUN_0053a618) and the reload builds a new object manager
// (FUN_00322bc8 -> FUN_0053a560 -> FUN_0053a750: frame counter +0x20 = 0) and a new Vincent: FUN_00571ee8 (P+0x27c =
// -40, P+0x280 = -DAT_0046ee28 = -15) -> FUN_0056f928 -> FUN_00558790 (P+0x142 = 0xff) -> FUN_005596a0 (P+0x148 = counter
// - 0x78, +0x150 / +0x152 = 0, phase bits 40-43 = 0); his C: FUN_0033ff18 (C+0x810 = -15). The new enemy_ai world's
// S.frame is set to that counter at the placement (CHECKPOINT.frame). T: the state saved at the reload holds exactly
// these values (counter 14). (The page's first life keeps its save-RAM values, offset by the save's 1575.)
export const PLAYER_STAMPS = Object.freeze({ t27c: -40, t280: -15, part: -1, s148: 0 - 0x78, s150: 0, s152: 0, sphase: 0, c810: -15 });

const warned = new Set();
const warnOnce = m => { if (!warned.has(m)) { warned.add(m); console.warn(m); } };

// restoreCheckpoint(sys): the stage reload as a reset of the page's systems, in place (no page reload). Each part
// is optional (null = that system is off on the page). sys:
//   ctrl, groundY(x, z, y) -> y | null      Vincent (player.js PlayerController)
//   follow                                  FollowCamera (clearDeath: worker 0199)
//   php                                     the AI's view of Vincent's status ({ hp, f118, s64, pos, face })
//   gameOver, weapon, cape, fx, hud, sfx    gameover_layer / aim.js / cloth / effects.js / hud.js / audio.js SoundEmitters
//   rebuildEnemies(eventFlags, frame, clock) -> world  a new enemy_ai world (S.frame = frame, S.now / S.acc = clock) built as at the start
//   music()                                 the zone music / ambience restart (the stage's ev0100 / ev0101)
// Returns a summary for the tests.
export function restoreCheckpoint(sys) {
  warnOnce('restart: the stage-result Status screen, the load title and the opening cutscenes are not on the page (left out)');
  const C = CHECKPOINT, out = {};
  if (sys.gameOver) sys.gameOver.reset();
  if (sys.php) { sys.php.hp = C.hp; sys.php.f118 = C.f118; sys.php.s64 = 0; Object.assign(sys.php, PLAYER_STAMPS); }
  if (sys.ctrl) {
    const ctrl = sys.ctrl, sp = ctrl.spawn;
    const gy = sys.groundY ? sys.groundY(C.pos.x, C.pos.z, C.pos.y) : null;
    ctrl.spawn = { x: C.pos.x, y: gy ?? C.pos.y, z: C.pos.z, heading: checkpointHeading() };
    ctrl.reset();                                  // the stage load builds him anew (state 2, no motion, no action)
    ctrl.spawn = sp;                               // H (page aid) keeps the page's spawn
    out.pos = { ...ctrl.pos };
    if (sys.php) { sys.php.pos = [ctrl.pos.x, ctrl.pos.y, ctrl.pos.z]; sys.php.face = [ctrl.C.face.x, ctrl.C.face.y, ctrl.C.face.z]; }
  }
  // GUESS: holstered after the restart (the game's opening cutscene leaves him with the gun drawn, h_st_a; that
  // hand-off is not decoded, so the page doesn't draw it)
  warnOnce('restart: the gun is drawn at the game\'s checkpoint (after the opening cutscene); the page restarts holstered');
  if (sys.weapon) sys.weapon.reset();
  if (sys.cape) sys.cape.cloth.started = false;
  if (sys.follow) {
    if (sys.follow.clearDeath) sys.follow.clearDeath();   // FUN_00328368's death bits (worker 0199)
    // GUESS: the page's start camera angles (player.js CAM_SPAWN). The game's at the checkpoint are the gun-drawn view's
    // (CHECKPOINT.camFwd, pitched ~25 deg down), which the holstered page can't use; the hand-off is not decoded
    sys.follow.reset(sys.ctrl ? sys.ctrl.pos : C.pos);
    // the reload's new camera object is built by FUN_00328368 (FUN_003387f8 kind 0xe -> FUN_00328010), which also zeroes
    // what reset() (FUN_003285d0) keeps: CAM+0x1c4 / +0x1c8 (the ladder pull-back), +0x1a8 (the auto-turn gain), and sets
    // +0x1e2 = 0xec (-20). T: the state saved at the reload: +0x1c4 / +0x1c8 / +0x1a8 0, +0x1e2 -12 (-20 + 8 frames).
    sys.follow.back = 0; sys.follow.backTarget = 0; sys.follow.gain = 0; sys.follow.idle = -20;
    // GUESS: CAM+0x17c / +0x1a0 / +0x1a4 (FUN_00328368: 0 / 1.8 / 0) are left at aim_core's holstered rest (weapon.reset:
    // 1 / 5 / 0, the save's): the game ramps them into the gun view from there (traced 0.048 / 4.68 / -0.25), which the
    // holstered page doesn't take
  }
  // GUESS: the effect manager freed / zeroed by the reload (effects.js reset; not decoded)
  if (sys.fx) { if (sys.fx.reset) sys.fx.reset(); else sys.fx.emitters.length = 0; }
  // the HUD: destroyed at the stage program's end (FUN_003ad5e0) and built again (FUN_003ad530 -> FUN_003ad618);
  // hud.js reset (GUESS: hud.json's values for the new HUD's)
  if (sys.hud) sys.hud.reset();
  // GUESS: sound requests not yet sent are dropped with the old world (the slot teardown is not decoded)
  if (sys.sfx) sys.sfx.pending.length = 0;
  if (sys.rebuildEnemies) {
    out.enemies = sys.rebuildEnemies(C.eventFlags, C.frame, { now: C.aiNow, acc: C.aiAcc });
    // MISSING: 41-43 are alive and attacking at the game's checkpoint; the stage-start scripts that activate them
    // (stage controller script 0 event 0x22 / 0x23, notes/enemy-activation.md) are not translated
    warnOnce('restart: soldiers 41-43 (alive at the game\'s checkpoint) are not activated: the stage-start scripts are not translated');
  }
  if (sys.music) sys.music();
  return out;
}
