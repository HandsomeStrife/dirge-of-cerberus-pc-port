// Restart -> the last checkpoint (worker 0201; notes/checkpoint-research.md, fidelity-audit "Restart").
//
// The game (decoded; T = PCSX2 trace w201_reload, from a state saved at the reload after game over -> Restart):
//   game over ✕ Restart: FUN_005349c0 -> 6 ... FUN_003fdf00 -> DAT_0047db88 = 6 -> the stage loop FUN_004012c0
//     (default case: FUN_003fdd00() == 6 -> FUN_002574a0, FUN_0031dbc8) returns 6;
//   pause OK on Restart: FUN_003c0a20 + FUN_003dee40(0xf) -> FUN_004012c0 case 0xf: FUN_00241990(0xe, 1), returns 6.
//   Both: the stage program FUN_00401b90 (cmd 6) returns 6 -> FUN_00247508 game state 0x15, case 6: FUN_003ea1d0(-1),
//   FUN_003e62d0(-1), FUN_00241990(0xd, 1) (or, with bit 10, FUN_0030f3d8: the status reset), -> game state 0x13:
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
//   (HP 10 / 28 / 24, astate 3) [dead in the save]; event flags all 0 [the save's too: all 0 (worker 0224)].
// The start position and 41-43's moves are the opening event's hand-off (worker 0205, notes/checkpoint-research.md
// "The opening cutscene's hand-off"): the stage's event ev0100 runs its class scr001 (decrypted by FUN_003a8320; T: in
// RAM in the reload state), whose first_event() ends with setpos / setdir / setmotionofbattle per actor, then
// setbattlename / set_battlemode. Each body plays its battle clip; at the clip's end FUN_00343de8
// (C+0x564 bit 0x10000000, FUN_00346150() == 0) -> FUN_00344d68 -> FUN_003157b0 writes the status matrix from the
// event model and FUN_00558cc0 places the actor there. data/checkpoint.json (export_web_checkpoint.py, from the disc)
// carries each actor's origin, dirs and its battle clip's last-frame bone 1; handOff() below does the rest.
// T (w201_reload / w204_reload / w205_reload call log): Vincent placed at record 10, 41-43 at record 24, all from
// 0x344e60 (FUN_00344d68); the clips' last frames give those positions and facings to the float.

// The checkpoint's other values (T: w201_reload record 10 = Vincent's placement)
export const CHECKPOINT = Object.freeze({
  // CAM+0x80 at the placement: the gun-drawn view (kept for the tests; the page restarts holstered and uses its start
  // camera, see restoreCheckpoint)
  camFwd: Object.freeze([-0.0005414184415712953, -0.42466089129447937, 0.9053523540496826]),
  hp: 780,                                       // status +0x20 (FUN_0030f3d8's status reset; T)
  f118: 0x20209,                                 // P+0x118 (T)
  eventFlags: Object.freeze({}),                 // FUN_004039d0: all 0 (T)
  // the page's frame count at the placement (enemy_ai S.frame: the hand-off schedule below counts frames from it)
  frame: 24,
  // the world's clock (DAT_0046e938+0x20 = enemy_ai S.mgr20, ticks; worker 0230): FUN_0053b500 adds int(+0x24 += 1.2) a frame.
  // T: the state saved at the reload holds +0x20 = 14, +0x24 = 0.3999990 (record 0); 10 frames of f32 steps -> 26 / 0.3999983
  // at record 10, as the trace's AI clock (ai_now 14 -> 26). The opening cutscenes don't advance it. Worker 0240: the step is
  // DAT_004eeb24 = 0x3f999999 (1.1999999, player.js STEP; T reload0 RAM), not f32 1.2 (0230's 0.3999996): with it the
  // stage init's 0x113 periods re-arm at the game's records (w205_rng 88 / 118; FUN_0053e9e0: due = +0x20 + period)
  mgr20: 26, mgr24: 0.3999983072280884,
  // the new AI scheduler's clock (FUN_00365008: += int(step) accumulated; DAT_0046f4ec +0): T w201_reload ai_now 14 at
  // record 0, 26 at record 10, so the rebuilt scheduler runs in the frames before the placement. Its fraction: every
  // value in [0.2001, 0.4] gives all 270 traced records (L: 0.3 taken)
  aiNow: 26, aiAcc: 0.3,
});

// worker 0242: the world after a record's reload. The stage init (FUN_003245e8) zeroes the manager clock (worker 0240);
// then main's flag-18 branch runs in event mode (AI paused, game-state bit 6) until its battle(): T w242 (Restart f2420,
// stage loop f3151): manager +0x20 = 64, AI clock 23 at f3966, i.e. the clocks barely move before play. L: the page's
// world starts at clock 0 and frame 0; main's own frames (the page's event mode) do the rest.
export const RECORD_RELOAD = Object.freeze({ frame: 0, clock: Object.freeze({ now: 0, acc: 0, mgr20: 0, mgr24: 0 }) });

// GUESS: the frames from Vincent's battle clip end (his placement, record 10) to the soldiers' (record 24): traced; the
// battle clips' clock across the load is not decoded (their remaining frames at the stage loop's first frame).
export const SOLDIER_RELEASE = 14;

const f32 = Math.fround;
// GUESS (matches T): the status matrix at the battle clip's end = FUN_003157b0's root x bone 1 form (param 0) on the
// clip's last frame. The release itself (FUN_00344d68) calls FUN_003157b0(status, 1), which copies the event model's
// root only; T w205_3157b0 (call-log set w205b): status +0x88 is the event model from frame 10 (FUN_003159b8's param-0
// call, mid-clip), and at the release the root it copies already equals origin x bone 1 of the last frame, so the
// clip's bone-1 offset reaches the model root at the clip's end; that writer is not found. h = data/checkpoint.json
// actor: origin (setpos), dir (setdir), bone1 (the clip's last frame, rows 0-2 axes, row 3 translation). Bone 1 as
// FUN_005ad9c0 -> FUN_005b29c0 (row w's 0, row 3 w 1) with row 3's y zeroed (sp+0x84); FUN_0026125c: out row i =
// sum_k bone[i][k] x root[k]; status +0x30 = out row 3, +0x40 = -(out row 2) normalized (pxor sign + vrsqrt), +0x50 =
// (0, -1, 0).
// FUN_00558cc0: actor row 2 = +0x40 (the facing), row 3 = +0x30 (the position).
// GUESS: setdir's value here (180) = the identity root rotation (T: the event-actor models' roots in the reload state
// are identity for p_Vin and e_Sol_11-13, all with that value; the native behind setdir is not found). Other values are refused (warned).
export function handOff(h) {
  const v3 = v => Array.isArray(v) && v.length >= 3 && v.slice(0, 3).every(Number.isFinite);
  if (!h || !v3(h.origin) || !Array.isArray(h.bone1) || h.bone1.length !== 4 || !h.bone1.every(v3)) {
    warnOnce(`restart: malformed hand-off entry in data/checkpoint.json (${h && h.clip}): skipped`); return null;
  }
  if (h.dir !== 180) { warnOnce(`restart: hand-off with setdir(${h.dir}) not decoded (only 180 = the identity root is known)`); return null; }
  const root = [[1, 0, 0], [0, 1, 0], [0, 0, 1], h.origin.map(f32)];
  const b = h.bone1.map(r => r.map(f32));
  const t = [b[3][0], 0, b[3][2]];                                         // sp+0x84 = 0: bone 1's y off
  const row = (v, w) => [0, 1, 2].map(j => f32(f32(f32(v[0] * root[0][j]) + f32(v[1] * root[1][j])) + f32(v[2] * root[2][j]) + (w ? root[3][j] : 0)));
  const pos = row(t, 1), r2 = row(b[2], 0);
  const n = Math.hypot(r2[0], r2[1], r2[2]);
  return { pos, face: r2.map(v => -v / n) };
}

// Vincent's start from the hand-off (null without data/checkpoint.json: warned)
export function vincentStart(data) {
  const h = data && data.actors && data.actors.p_Vin;
  if (!h) { warnOnce('restart: data/checkpoint.json (export_web_checkpoint.py) missing: Vincent restarts at the page spawn'); return null; }
  return handOff(h);
}

// Vincent's stamps against the world's frame counter after the reload (decoded): the stage loop's exit tears the world
// down (FUN_004012c0 -> FUN_003249d0 -> FUN_003236c8 -> FUN_0053a618) and the reload builds a new object manager
// (FUN_00322bc8 -> FUN_0053a560 -> FUN_0053a750: frame counter +0x20 = 0) and a new Vincent: FUN_00571ee8 (P+0x27c =
// -40, P+0x280 = -DAT_0046ee28 = -15) -> FUN_0056f928 -> FUN_00558790 (P+0x142 = 0xff) -> FUN_005596a0 (P+0x148 = counter
// - 0x78, +0x150 / +0x152 = 0, phase bits 40-43 = 0); his C: FUN_0033ff18 (C+0x810 = -15). The new enemy_ai world's
// S.mgr20 / S.mgr24 are set to that counter at the placement (CHECKPOINT.mgr20 / mgr24). T: the state saved at the reload holds exactly
// these values (counter 14). (The page's first life keeps its save-RAM values, offset by the save's 1575.)
export const PLAYER_STAMPS = Object.freeze({ t27c: -40, t280: -15, part: -1, s148: 0 - 0x78, s150: 0, s152: 0, sphase: 0, c810: -15 });

const warned = new Set();
const warnOnce = m => { if (!warned.has(m)) { warned.add(m); console.warn(m); } };

// ---- The Restart invariant (worker 0254; notes/checkpoint-research.md 'The Restart invariant')
// The game over's Restart and the pause's Restart differ in the stage loop: FUN_004012c0 result 6 runs FUN_0031dbc8 for the
// game over; case 0xf sets mode bit 0xe for the pause. Both then take FUN_00247508 0x15 case 6 (mode bit 0xd set). What survives
// depends on DAT_0046b0b8 (FUN_0023d598), except the player header DAT_0046e248, where bits 0xd / 0xe also decide: the game over
// keeps EXP, level and +0x2c (FUN_00321480, FUN_00320848; items.js restart). Everything else ends the same on both paths:
//   DAT_0046b0b8 == 0, a scene_save's record: mode bit 3, FUN_00400778 -> FUN_0030f688(stage, 2, rec + 0x100) -> FUN_0030fff0 case 2 ->
//     FUN_00311fa0: gil, slot list, inventory and FUN_0031d4d8 (section stats, totals, taken words) are the record's, over
//     whatever the game over cleared; FUN_003fda68: mark = the record's stat 14. HP alone is dropped (FUN_00319798's scratch).
//   DAT_0046b0b8 == 1, the stage start: FUN_0030f3d8 -> FUN_0031dae8 (stats, totals, taken words 0), FUN_003202e8 / FUN_0031c2f8
//     (the lists back); FUN_00400778 does not run, so the mark stays as it was.
//   Either way: the clocks are not rewound, the sounds are torn down (FUN_003ffbb8) and the HUD is rebuilt (FUN_003ad5e0 / FUN_003ad530).
// T w254: the table in the notes. Not decoded: who runs setSectionStat(14, 1) after a stage-start reload (results.js R.reload's GUESS).

// ---- Mid-level checkpoints (worker 0242; notes/checkpoint-research.md 'Mid-level checkpoints (P8)')
// main's beats save with `setflag(18, 1); scene_save(n); setflag(18, 0)` (ev0100 main pc 1271-1286 for n = 1 after
// rv_matiawase; pc 5130-5142 later). scene_save = Zone native FUN_0039c728: unless mode bits DAT_004b8ac8 0xc / 0x10 /
// 0x14 (not story mode: 0 on the page) wait_save, then FUN_0023d690(0, n, 0): DAT_0046b0b8 = 0 and the record
// DAT_004b2680 (0x948 bytes) from FUN_0023d2d8 -
//   +0 the stage byte (*DAT_0047dbb0 = 0x80), +1 / +2 the loaded chunks (FUN_0023cf88: slots with +0x5c and +0x54 != 0,
//   at most 2), +4 the program index to resume at = (FUN_004036f8(stage, 10) - program) >> 4 (FUN_003ff528: the stage
//   program's first command 0xa = run event 100 = ev0100 main; written over FUN_0023d2d8's stage +0xc), +0x10 n
//   (FUN_0023c6c8: DAT_0046b0dc), +0x14 stage +0x1a (the running event, 100), +0x70 the 8 loaded-script slots (stage
//   +0x28), +0x80 the 64 global flags (FUN_0037cea0: flag 18 = 1 in it), +0xc0 the 64 stage flags (FUN_003ff738), and
//   +0x100 the status block (FUN_0030fe58(2, +0x100) -> FUN_00311fa0: the status header 0x98, DAT_0046e248 (gil),
//   DAT_0046e240 / DAT_0046e218 (+4 lists), Vincent's status FUN_00319798 -> FUN_003188f8 (status +0x20..+0x80 without
//   the matrix +0x30..+0x5c; HP = +0x20), DAT_0046e228 (the section stats)).
// sceneSave(n, s) -> the page's record. s: gflags (stage controller), sflags (enemy_ai eventFlags), pair (area_stream
// slots), hp, inventory (items.js Inventory). The page keeps the parts it has; the rest of the status block is left out.
export function sceneSave(n, s = {}) {
  const sf = {};
  for (const [k, v] of Object.entries(s.sflags || {})) if (+k >= 0 && +k < 64 && v) sf[k] = v & 0xff;   // FUN_003ff738: bytes 0..63
  const inv = s.inventory;
  if (inv) { inv.gilBase = inv.gil; inv.gilEarned = 0; }   // FUN_00321480's write: +0x2c = 0, +0x28 = +8 (with FUN_00312630 == 0)
  return Object.freeze({
    stage: 0x80, n: n | 0, resume: 'main', event: 100,
    gflags: Uint8Array.from({ length: 64 }, (_, i) => (s.gflags ? s.gflags[i] | 0 : 0) & 0xff),
    sflags: Object.freeze(sf),
    pair: Array.isArray(s.pair) ? s.pair.slice(0, 2) : null,
    hp: s.hp,
    // worker 0243: the inventory's selection (+0 / +0xc / +0x10) and slot pool are part of the same block
    inventory: inv ? { slots: inv.slots.map(e => e.slice()), gil: inv.gil, gilBase: inv.gil, gilEarned: 0, other: inv.other, sel: inv.sel, last: inv.last, selId: inv.selId, freed: (inv.freed || []).slice(), ammo: inv.ammoState ? inv.ammoState() : null } : null,
    taken: s.taken ? [...s.taken] : [],            // DAT_0046e228 +0x1c0 entries' taken words (FUN_0031e0e0)
    stats: s.stats ? s.stats.block() : null,       // DAT_0046e228 +0 .. +0x1c0 (FUN_0031d4d8; results.js)
    dead: s.dead ? [...s.dead] : [],               // the same entries' dead words (FUN_0031e060 / FUN_0031e160; FUN_00547ce0 at the reload)
  });
}

// FUN_0023cf88 on area_stream.js's slots: the loaded nonzero chunks, at most two (slot order)
export function loadedPair(stream) {
  if (!stream || !stream.slots) return null;
  const p = [];
  for (const s of stream.slots) if (s.loaded && s.chunk && p.length < 2) p.push(s.chunk);
  while (p.length < 2) p.push(0);
  return p;
}

// initWorld(make, { flags, frame, clock, loadRecs, wake }) -> world: the stage reload's new enemy_ai world, in the game's
// order (worker 0240; notes/checkpoint-research.md 'The stage-init pass'). make(opts) = createEnemyAI with the page's opts.
//   1. the stage init FUN_003245e8 -> FUN_0053c140: the objects, then FUN_0053ca50(mgr, 1) = script event 0x22 to every
//      object, then FUN_005459d8 = event 0x23 (enemy_ai stageInit). T w240_init (from start1704, the reload after a
//      Restart): f2276-2278, manager clock +0x20 = 0 / +0x24 = 0 there; script 0's 0x22 activates 44 / 66 (their
//      magazine draws inside the pass), 81-86's 0x23 arms their cmd 0x113 periods from clock 0 (draws at w205_rng
//      records 39 / 45 / 50 / 54 ...). The AI scheduler clock is taken as 0 there too (L: ai_now = mgr +0x20 at every
//      traced record from 0 to 270).
//   2. the clocks at the placement (CHECKPOINT; L: the frames between the init and the placement, ~15 in the game, are
//      not run: 44 / 66's activation event 3 runs on the page's first tick).
//   3. 41-43 at the placement: GUESS stand-in, FUN_005453b0's loop (enemy_ai loadPass, worker 0204's translation). The
//      game activates them through their area switching on (FUN_0054ef68 -> vt+0x14c FUN_0055a0d8 -> vt+0x144(1, 1);
//      T w240_act: every record-10 activation returns to 0x55a124), with no FUN_005453b0 and no second 0x23.
//   4. wake(world): 45-49 (play.js wakeSave, GUESS: the save's states; the game activates them the same way as 41-43).
// main's battle() just after the opening finds no stage object yet (DAT_0046e290 == 0, T w240_init f2264): its
// FUN_00324e70 sends nothing (stage_controller.js enterBattle's stage pass).
export function initWorld(make, o) {
  const W = make({ eventFlags: o.flags, deadRecs: o.deadRecs || [], now: 0, acc: 0, mgr20: 0, mgr24: 0 });
  if (W.stageInit) W.stageInit();
  else warnOnce('restart: enemy_ai has no stageInit (the stage init\'s 0x22 / 0x23 pass left out)');
  const c = o.clock || {};
  W.S.now = c.now ?? 0; W.S.acc = c.acc ?? 0; W.S.mgr20 = c.mgr20 ?? 0; W.S.mgr24 = Math.fround(c.mgr24 ?? 0);
  W.S.frame = o.frame ?? 0;                        // the page's frame count at the placement (the hand-off schedule)
  // GUESS: 41-43's record-10 activation through FUN_00558f68's part (the game: FUN_0054ef68 -> FUN_0055a0d8 -> vt+0x144(1, 1),
  // not translated; see notes/fidelity-audit.md 'GUESS: 41-43's activation at the placement')
  if (W.loadPass) W.loadPass(o.loadRecs || []);
  if (o.wake) o.wake(W);
  return W;
}

// restoreCheckpoint(sys): the stage reload as a reset of the page's systems, in place (no page reload). Each part
// is optional (null = that system is off on the page). sys:
//   ctrl, groundY(x, z, y) -> y | null      Vincent (player.js PlayerController)
//   follow                                  FollowCamera (clearDeath: worker 0199)
//   php                                     the AI's view of Vincent's status ({ hp, f118, s64, pos, face })
//   gameOver, weapon, cape, fx, hud, sfx    gameover_layer / aim.js / cloth / effects.js / hud.js / audio.js SoundEmitters
//   rebuildEnemies(eventFlags, frame, clock) -> world  a new enemy_ai world (S.frame = frame, S.now / S.acc / S.mgr20 / S.mgr24 = clock) built as at the start
//   music()                                 the zone music / ambience restart (the stage's ev0100 / ev0101)
// Returns a summary for the tests.
export function restoreCheckpoint(sys) {
  const C = CHECKPOINT, out = {}, rec = sys.record || null;
  if (rec) return restoreRecord(sys, rec);
  warnOnce('restart: the stage-result Status screen, the load title and the opening cutscenes are not on the page (left out)');
  if (sys.gameOver) sys.gameOver.reset();
  if (sys.php) { sys.php.hp = C.hp; sys.php.f118 = C.f118; sys.php.s64 = 0; Object.assign(sys.php, PLAYER_STAMPS); }
  // Vincent at his battle clip's end (handOff; T record 10). Without the data: the page spawn (warned)
  const vs = vincentStart(sys.handoff);
  out.handoff = vs;
  if (sys.ctrl) {
    const ctrl = sys.ctrl, sp = ctrl.spawn;
    if (vs) {
      // y: status +0x30's (the origin's); the body lands on the ground at once (T: -98.34 -> -98.6444 at record 11)
      const gy = sys.groundY ? sys.groundY(vs.pos[0], vs.pos[2], vs.pos[1]) : null;
      ctrl.spawn = { x: vs.pos[0], y: gy ?? vs.pos[1], z: vs.pos[2], heading: Math.atan2(vs.face[0], vs.face[2]) };
    }
    ctrl.reset();                                  // the stage load builds him anew (state 2, no motion, no action)
    ctrl.spawn = sp;                               // H (page aid) keeps the page's spawn
    out.pos = { ...ctrl.pos };
    if (sys.php) { sys.php.pos = [ctrl.pos.x, ctrl.pos.y, ctrl.pos.z]; sys.php.face = [ctrl.C.face.x, ctrl.C.face.y, ctrl.C.face.z]; }
  }
  // GUESS: holstered after the restart. The game's opening event leaves him with the gun drawn (state 3, h_st_a, already
  // in the reload state). Worker 0205: not FUN_005764d0 (only from states >= 8) nor FUN_00326660 / FUN_003262b8 (not
  // called in the hand-off, T w205_reload); the event's natives (set_battlemode, setmotionofbattle) are not bound by
  // name in the ELF (the native registry is not decoded; two attempts, notes)
  warnOnce('restart: the gun is drawn at the game\'s checkpoint (after the opening cutscene); the page restarts holstered');
  if (sys.weapon) sys.weapon.reset();
  if (sys.cape) sys.cape.cloth.started = false;
  if (sys.follow) {
    if (sys.follow.clearDeath) sys.follow.clearDeath();   // FUN_00328368's death bits (worker 0199)
    // GUESS: the page's start camera angles (player.js CAM_SPAWN). The game's at the checkpoint are the gun-drawn view's
    // (CHECKPOINT.camFwd, pitched ~25 deg down), which the holstered page can't use (the gun's hand-off is not decoded)
    sys.follow.reset(sys.ctrl ? sys.ctrl.pos : vs && { x: vs.pos[0], y: vs.pos[1], z: vs.pos[2] });
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
    out.enemies = sys.rebuildEnemies(C.eventFlags, C.frame, { now: C.aiNow, acc: C.aiAcc, mgr20: C.mgr20, mgr24: C.mgr24 });
    // 41-43: the rebuilt world activates them at the placement (initWorld above, from play.js rebuildEnemies; worker
    // 0204's FUN_00558f68 translation as the stand-in); at their battle clips' end (SOLDIER_RELEASE frames after
    // Vincent's) FUN_00344d68 -> FUN_00558cc0 moves them to the hand-off (enemy_ai scheduleHandOff)
    const list = [];
    if (!(sys.handoff && sys.handoff.actors)) warnOnce('restart: no data/checkpoint.json: 41-43 stay at their placements (the opening event\'s hand-off at record 24 is left out)');
    for (const h of Object.values((sys.handoff && sys.handoff.actors) || {})) {
      if (!h || h.rec === 0) continue;
      const p = handOff(h);
      if (p) list.push({ rec: h.rec, frame: C.frame + SOLDIER_RELEASE, pos: p.pos, face: p.face });
    }
    if (out.enemies && out.enemies.scheduleHandOff) out.enemies.scheduleHandOff(list);
    out.soldierHandOff = list;
  }
  if (sys.music) sys.music();
  return out;
}

// restoreRecord(sys, rec): a Restart after a scene_save (worker 0242). The game (decoded): FUN_00247508 0x15 case 6 with
// DAT_0046b0b8 == 0 (the scene_save's) sets mode bit 3 -> 0x13: FUN_003ff0c0 -> FUN_003ff028(stage, DAT_004b2680): the
// stage byte, the program index (+4: the stage program's cmd 0xa), stage +0x18 bit 0 (+0x3b), +0x19 (+0x42), the stage
// flags FUN_00403a48(+0xc0), FUN_0023c6c8(+0x10); stage +0x18 bit 4 (resuming). The stage program FUN_00401b90 then runs
// FUN_00400778 before any command: the record's chunks loaded (FUN_002673d8(stage, +1, +2)), the status block
// FUN_0030f688(stage, 2, +0x100) (HP, inventory, taken bits; the status matrix is not in it), the ambience (cmd 0x17's
// FUN_00403720), the 8 scripts of +0x70 loaded again (FUN_004002f8), the global flags back (case 0xb: FUN_0037ce60(i,
// +0x80[i]), so flag 18 = 1), then event +0x14 = 100 run from its start (FUN_004002f8(100, -1), FUN_003fffe0) and the
// program goes on at its cmd 0xa. So main runs from the top with the record's flags: its first beat's test fails (stage
// flag 0 != 0), and its flag-18 branch for the beat after the save (pc 1425 for scene_save(1): flag 18 = 0, fadeout,
// playMusic3, Zone.load(128, 2, 3), p000 setpos (-889.2, 0, -599) / setdir / setbattlename p_Vin, Camera.set, stage
// flag 9 = 1, fadein, battle()) puts Vincent and the camera back; the opening (first_event) does not play.
// The page: sys.record = sceneSave's record. The stage controller is restarted by play.js with rec.gflags; this resets the
// rest as the stage load does and leaves Vincent's place to main (vinBattle.place on battle()'s hand-back).
function restoreRecord(sys, rec) {
  const out = { record: rec.n };
  warnOnce('restart (checkpoint record): the save box / load screens between the Restart and the reload are not on the page (left out)');
  if (sys.gameOver) sys.gameOver.reset();
  // HP: full (780), not the record's. FUN_00319798's read branch (the status block's player part) finds no player status
  // yet (FUN_00311038 < 0, FUN_00318bf8(0) == 0: the objects are built later), so it reads the saved status into a scratch
  // status (FUN_00314ad8 / FUN_003188f8 / FUN_00314b38) and drops it; the reload's new status starts full. T w242 (HP 500
  // at the save, 300 at the Restart): the record holds 500 (block +0x402), the new status 780 from r150, 780 in play.
  // P+0x118 / the stamps: the reload's new Vincent (as the stage start's)
  if (sys.php) { sys.php.hp = CHECKPOINT.hp; sys.php.f118 = CHECKPOINT.f118; sys.php.s64 = 0; Object.assign(sys.php, PLAYER_STAMPS); }
  if (sys.ctrl) {
    // GUESS: until main's battle() hands him back, Vincent stands at the page spawn (the game: the reloaded status's own
    // matrix, which the status block does not carry; see notes 'Mid-level checkpoints (P8)')
    sys.ctrl.reset();
    out.pos = { ...sys.ctrl.pos };
    if (sys.php) { sys.php.pos = [sys.ctrl.pos.x, sys.ctrl.pos.y, sys.ctrl.pos.z]; sys.php.face = [sys.ctrl.C.face.x, sys.ctrl.C.face.y, sys.ctrl.C.face.z]; }
  }
  if (sys.weapon) sys.weapon.reset();
  if (sys.cape) sys.cape.cloth.started = false;
  if (sys.follow) {
    if (sys.follow.clearDeath) sys.follow.clearDeath();
    sys.follow.reset(sys.ctrl ? sys.ctrl.pos : undefined);
    sys.follow.back = 0; sys.follow.backTarget = 0; sys.follow.gain = 0; sys.follow.idle = -20;   // FUN_00328368 (as above)
  }
  if (sys.fx) { if (sys.fx.reset) sys.fx.reset(); else sys.fx.emitters.length = 0; }
  if (sys.hud) sys.hud.reset();
  if (sys.sfx) sys.sfx.pending.length = 0;
  if (sys.rebuildEnemies) out.enemies = sys.rebuildEnemies({ ...rec.sflags }, RECORD_RELOAD.frame, RECORD_RELOAD.clock, rec);
  // FUN_003ffbb8's sounds and FUN_00548788's new section-22 objects, as at the stage start; main's flag-18 branch starts the
  // music and ambience again itself (playMusic3 / playBgAreaSound)
  if (sys.music) sys.music(true);
  return out;
}
