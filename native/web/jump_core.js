// Vincent's on-foot jump in z128 (sea of flames), translated from the game. Pure: no three.js.
// Wired into player.js's PlayerController.step (notes/jump-research.md, "Wiring").
//
// The game's jump has three parts:
//   1. FUN_00333150 (input): ✕ (logical id 0xd) -> ladder first, then the jump gate
//      FUN_00577230 -> FUN_00575768(P, 0).                                    -> canJump()
//   2. FUN_00575768, physics-body branch (script flag 13, mode 0xc): player state 8
//      (0x1f for the second, mid-air jump), body take-off FUN_00357168(h).      -> startJump()
//   3. The motion-state classes: 0x20 jump (FUN_00598f50: freeze while h_jp0 plays, then
//      h_jp1 / h_jp2 / h_jp3 queued, done on ground) and 0x21 land (FUN_00599aa0: h_jp4).
//      The done flag sends player state 8 -> 2 (FUN_00538aa0) with motion 0x21 (FUN_00538a30).
// The flight itself (gravity, air steering, wall slide, landing) is the physics body that
// player.js already translates (startFall / gravityStep / airIntent / integrate).
//
// Controller interface (PlayerController in player.js; duck-typed here):
//   ctrl.P { state, b298, b299, dir, airShots?, flags2a8? }, ctrl.C { spd, dir, face, moveDir,
//   groundSpeed, flags79c? }, ctrl.body { state, ... }, ctrl.onGround, ctrl.startFall(h),
//   ctrl.stickInput(input), ctrl.intent(), ctrl.moveTick(), ctrl.rotate().

const f32 = Math.fround;
// PS2 FPU rounding toward zero (player.js / enemy_ai.js chop)
const _cb = new DataView(new ArrayBuffer(4));
function chop(x) {
  const r = f32(x);
  if (!(Math.abs(r) > Math.abs(x))) return r;
  _cb.setFloat32(0, r); _cb.setInt32(0, _cb.getInt32(0) - 1);
  return _cb.getFloat32(0);
}

// ---------------------------------------------------------------- game data
// Runtime values from the sea-of-flames save state (EE RAM), checked against the traces.
export const JUMP = {
  STEP: 1.1999999284744263,  // DAT_004eeb24: ticks per PAL frame (player.js STEP)
  cfgC4: 12.100000381469727, // cfg+0xc4, cfg = *(DAT_0046dd68+0x14) = 0x1faaf24: jump height - 1
  cfgC0: 24.200000762939453, // cfg+0xc0: the alternative height (story-progress branch, not taken in z128)
  gravCfg: 1.2000000476837158, // DAT_0046ee2c -> cfg+0xcc (FUN_00326500 true); gravity = cfg+0xcc x 196
  freezeMax: 10.0,           // FUN_00598f50 phase 1/4/8: leave the wind-up when h_jp0 ends or t >= 10
  aimPhaseMax: 20.0,         // phases 5 / 6 (armed set): next part after 20
  phase2Mark: 30.0,          // phase 2 -> 3 after 30 (FUN_005ae618(MP, 2))
  landMax: 30.0,             // FUN_00599aa0: landing ends after 30 ticks at most
  landMoveAfter: 2.0,        // ... or after 2 ticks once C+0x1d8 > 0 (he is moving)
  backAngle: 90.0,           // FUN_0036b008: |angle(face, move)| <= 90 deg = normal jump
  clipRate: 0.5,             // MP+0x40c for the h_jp clips (trace), x weight 128/128
  blend591: 10,              // C+0x591 = C+0x6c0 = 10 (save state): the blend frames FUN_00340bb8(C, 1, -1) restores
  airFireBlend: 1,           // FUN_00596830: FUN_00340bb8(C, 1, 1) before the h_jp3_a set (aim_g f49: layer 2 = 1 + 1)
  airFireMax: 30.0,          // FUN_00596830 phase 2: the h_jp_f set ends after 30 ticks
};

// clip slots (C+0x7fc table, names read from the save state)
export const SLOT = {
  1: 'idle',                                                // row 1: the page's key for h_st (FUN_0059dd48)
  // the knock-down's rows (worker 0255, the save's C+0x7fc; T w255_phoenix_air)
  0xb1: 'h_rev_0', 0xe3: 'c_rev_l', 0xe4: 'c_rev_r', 0xa8: 'c_st_bl0', 0xab: 'c_bl_0', 0xac: 'c_bl_1', 0xad: 'c_bl_ht0', 0xae: 'c_jp_fa0', 0xaf: 'c_fl_0', 0xb0: 'c_fl_1',
  0x16: 'h_jp0', 0x17: 'h_jp1', 0x18: 'h_jp2', 0x19: 'h_jp3', 0x1a: 'h_jp4',
  0xd5: 'c_wjp0', 0xd6: 'c_wjp1', 0xd7: 'c_wjp2', 0xd8: 'h_jp3', 0xd9: 'h_jp4',
  0xda: 'c_bj0', 0xdb: 'c_bj1', 0xdc: 'c_bj2', 0xdd: 'c_bj0', 0xde: 'c_bj1', 0xdf: 'c_bj2',
  0xe0: 'c_bwj0', 0xe1: 'c_bwj1', 0xe2: 'c_bwj2',
  0xbc: 'h_jp0_a', 0xbd: 'h_jp1_a', 0xbe: 'h_jp2_a', 0xbf: 'h_jp3_a', 0xc0: 'h_jp4_a', 0xc1: 'h_jp_f',
  0x3e: 'c_std',                                          // the standing hit (motion class 0x3f, FUN_0059df28)
  // the death (class 0xb, FUN_00595a60: rows 0x2a-0x2f by hit side); every one of those rows holds the same clip
  // in z128 (save RAM C+0x7fc). (The corpse class 0xd's rows 0x36-0x3b hold c_sq_fa0; only a kill while lying, stance 2, runs that class.)
  0x2a: 'c_st_fa0', 0x2b: 'c_st_fa0', 0x2c: 'c_st_fa0', 0x2d: 'c_st_fa0', 0x2e: 'c_st_fa0', 0x2f: 'c_st_fa0',
};
// slots that are empty in z128's slot table (C+0x7fc in the save state): FUN_003455e8 says no.
// 0xc1 (h_jp_f, the air-shot clip) is empty, so FUN_00596830 plays the h_jp3_a set (aim_g f49).
export const UNLOADED = new Set([0xc1]);
// clip lengths (frames): h_jp* / h_jp*_a in 0770320b, c_wjp* / c_bj* / c_bwj* in 07703200, the
// containers z128 searches (FUN_005a7390; export_web_vincent.py CLIP_SETS; the `jump` pack,
// data/vincent/vincent_jump.json; the c_ lengths equal the traces' hold frame n - 1)
export const CLIP_FRAMES = { h_jp0: 3, h_jp1: 10, h_jp2: 10, h_jp3: 16, h_jp4: 15,
  h_jp0_a: 3, h_jp1_a: 10, h_jp2_a: 10, h_jp3_a: 16, h_jp4_a: 15,
  c_wjp0: 3, c_wjp1: 10, c_wjp2: 9, c_bj0: 2, c_bj1: 11, c_bj2: 10, c_bwj0: 2, c_bwj1: 11, c_bwj2: 10,
  c_std: 16, c_st_fa0: 129, idle: 160,
  c_st_bl0: 5, c_bl_0: 25, c_bl_1: 51, c_bl_ht0: 28, c_jp_fa0: 12, c_fl_0: 16, c_fl_1: 48, h_rev_0: 40, c_rev_l: 21, c_rev_r: 21 };            // 07703200 (export_web_vincent.py catalogue)

// player states (P+0x104) this file deals with
export const ST = { FOOT: 2, JUMP: 8, FALL: 9, JUMP2: 0x1f, BACK: 0x20, BACK2: 0x21 };
export const HIT_STATE = 0x18;                            // the big hit (FUN_00562898 -> FUN_00562b30)
export const REVIVE_STATE = 0x16;                         // FUN_00560d80 -> FUN_0055b8e0(P, 0x16) (vtable 0x58aa10; worker 0255)
export const DEAD_STATE = 7;                              // HP 0 (FUN_00560fc8 / FUN_00561138 -> FUN_0055b8e0(P, 7))
const onFoot = s => s >= 2 && s <= 5;
const inAir = s => s === 8 || s === 9 || s === 0x20;

// FUN_0055a850 (FUN_0055aa88(P) on P+0x104): the air states 8, 9, 0xf, 0x10, 0x1f, 0x20, 0x21
export const airState = s => s === 8 || s === 9 || s === 0xf || s === 0x10 || (s >= 0x1f && s <= 0x21);

// P+0x100 bits 46-47 (P.jumpBits; "took off"): FUN_00565df8(P, v) writes them. The take-off sets
// them (FUN_00575768: 2 for kind 2, else 1; startJump below). FUN_0055b8e0 (every player state
// change) ends with FUN_00565df8(P, 0) when the new state is not an air state (FUN_0055aa88), so
// landing or a ladder clears them and a walk-off or ladder drop (no take-off) leaves them 0. The
// other clearers, the +0x14 slots of state 1 / 0x80 (FUN_00537ce8 / FUN_00539dd8, vtables 0x58ae90 /
// 0x58a860), and the script setters (FUN_005660b0, FUN_005661e8 case 0x145) are in states the page
// doesn't have. Readers: FUN_005766c0 (weaponSwitch below); FUN_00565480 (player.js hitReact).
// enterState: P+0x104 = st as FUN_0055b8e0 writes it, with that tail.
export function enterState(P, st) {
  P.state = st;
  if (!airState(st)) P.jumpBits = 0;                      // FUN_0055b8e0: FUN_00565df8(P, 0)
}

// ---------------------------------------------------------------- 0. motion-done events
// When the character's motion class sets its done flag (class +8 bit 0), FUN_00343160 (once per
// class: C+0x564 bit 0x20) calls FUN_00341af0: event = the class's motion id (+0x70), sent by
// FUN_00341988(C, 0, &ev) to the player's message slot FUN_0056a038 (P vtable 0x58dff8 +0x1dc),
// case 0 (0x56a088): new = the current state class's +0x1c handler (FUN_0055b8c0: the state table
// FUN_00537628) (P, ev); P+0x118 bit 0x10000 -> FUN_0055b8e0(P, 0, 1, 0) instead (clear in the save
// state, 0x20209: not ported); new != 0 -> FUN_0055b8e0(P, new, 0, 0), and FUN_00343160 drops the
// class's own next motion. Returns the new state, or 0 (no change).
// The handlers on the page (state vtables 0x58ae60 / 0x58ae30 / 0x58ad10 / 0x58ace0, slot +0x1c).
// b44 = P+0x100 bit 44, written with C+0x590 bit 24 (the gun out) by FUN_00565d78.
//  states 2 / 3: FUN_00537f38. The save state's P+0x28 = 0x20901f (bit 0x20 clear: both "player"
//   branches taken) and C+0x1c0 bit 0x400000 is clear in z128, so: ground bit 0x200 set: events
//   0x1c / 0x1e / 0x3f -> 2 (3 with b44), others 0 (0x36 / 0x37 have side effects: not on the page);
//   clear: 0x1e / 0x3f -> 0x10, others -> 9.
//  states 8 / 9 / 0x1f / 0x20 / 0x21 (vtables 0x58ad10 / 0x58ace0 / 0x58acb0 / 0x58ac80 / 0x58ac50):
//   FUN_00538aa0. P+0x17c's +0x20 = 0x30c in the save (FUN_00316cf8 false: no state 7),
//   so: events 0x55 / 0x4e while airborne -> 0, else 2 (3 with b44).
//  state 0x18 (the hit, vtable 0x58a9e0): FUN_00539b88, any event: dead (FUN_00316cf8; P+0x28 bit 0x20
//   clear) -> 7 (not on the page: HP 0 is out of scope, the caller never asks while dead); ground bit
//   clear -> 0x10; else C+0x45c bit 17 (clear: body flags 0x236) -> 2, or 3 with b44.
//  state 7 (dead, vtable 0x58ad40): FUN_00538780. Event 0xd (the corpse class done; not reached: see DeathMotion)
//   -> P+0x118 |= 0x100 (the corpse-settled bit) and FUN_003533e0 unless C+0x564 bit 0x800, then 0. Any other event: C+0x1c0
//   bit 0x400000 or the ground bit set -> 0; else (in the air) 0x10 when FUN_0036b008 (the angle FUN_00353458(C+0x20,
//   C+0x90, C+0x10), wrapped to +-pi, 0 beyond +-100 pi, within +-90 deg) else 0xf. Neither state is on the page, so
//   that case warns and returns 0 (C+0x1c0 bit 0x400000 is not on the page either: taken as clear).
// Other states: null (handler not on the page).
// dead (FUN_00316cf8; worker 0255): states 8 / 9 / 0x1f-0x21's FUN_00538aa0 answers any event with 7 first (Vincent's P+0x28 bit 0x20 is clear).
// ahead: FUN_0036b008: FUN_00353458(C+0x20, C+0x90, C+0x10), wrapped to +-pi (0 beyond +-100 pi), within +-90 deg (FUN_00538780).
export function stateEvent(st, ev, ground, b44, dead = false, ahead = false) {
  // the knock-down: state 0xf's +0x1c (0x539360): event 0x34 -> on the ground 0x11, else 0x10; others 0. State 0x10's (0x539430): on the
  // ground 0x11, else 0. State 0x11's FUN_00539570: dead -> 0 (event 0x36: P+0x118 |= 0x100, Jump.event). Alive: not on the page (hitBranch).
  if (st === 0xf) return ev === 0x34 ? (ground ? 0x11 : 0x10) : 0;
  if (st === 0x10) return ground ? 0x11 : 0;
  // alive, events 0x36 / 0x35 / 0x3a: 2 (C+0x45c bit 17 clear): the get-up
  if (st === 0x11) return !dead && (ev === 0x36 || ev === 0x35 || ev === 0x3a) ? 2 : 0;
  // state 0x16's +0x1c (0x539ae0, any event): C+0x808 bit 0x20000 -> 3, C+0x45c bit 17 -> 4, else 2 (both bits clear on the page)
  if (st === REVIVE_STATE) return 2;
  if (st === DEAD_STATE) {
    if (ev === 0xd || ground) return 0;
    return ahead ? 0x10 : 0xf;                            // worker 0255: FUN_00538780's corpse off a ledge: the knock-down's states (KnockMotion)
  }
  if (st === HIT_STATE) return ground ? (b44 ? 3 : 2) : 0x10;
  if (st === 2 || st === 3) {
    if (ground) return (ev === 0x1c || ev === 0x1e || ev === 0x3f) ? (b44 ? 3 : 2) : 0;
    return (ev === 0x1e || ev === 0x3f) ? 0x10 : 9;
  }
  if (st === ST.JUMP || st === ST.FALL || st === ST.JUMP2 || st === ST.BACK || st === ST.BACK2) {
    if (dead) return DEAD_STATE;
    if ((ev === 0x55 || ev === 0x4e) && !ground) return 0;
    return b44 ? 3 : 2;
  }
  return null;
}

// FUN_0055b8e0(P, new, 0, 0)'s motion: the OLD state class's +0x24 slot (P, new). From 8 / 9 / 0x1f
// (FUN_00538a30) and 0x20 / 0x21 (FUN_0053a478 / FUN_0053a528, which differ only for new state
// 0x21): 2 / 3 -> 0x21 (landing). From 2 (FUN_00537d58): 3 -> 5 (armed stand), 9 (armed walk) when
// moving; 9 -> 0x22 (fall). From 3 (FUN_00538120): 2 -> 3 (stand), 8 (walk) when moving; 9 -> 0x22.
// moving: C+0x1d8 != 0 (the ground speed). From 2 / 3 to the hit 0x18: their default -> FUN_00537aa0,
// jumptable 0x589e70[0x18] = 0x537b9c (li v0, 0x3f): the hit class 0x3f. From 0x18 (FUN_00539b48):
// 3 -> 5, 7 -> 0xb, else FUN_00537aa0: 2 -> 3 (0x537acc), 9 -> 0x22 (0x537b34). Others: null (not on the page).
// To the death state 7: from 2 (FUN_00537d58 case 7 -> 0xb), from 3 (FUN_00538120 default -> FUN_00537d58 -> 0xb),
// from 0x18 (FUN_00539b48: 0xb); class 0xb = FUN_00595a60 (factory 0x592918 case 0xb, vtable 0x5a6600).
// Worker 0255: to 0x16 from any old state: jumptable 0x589e70[0x16] = 0x537b84 (li v0, 0x3e). Read: state 7's slot FUN_00538940 ->
// 0x58a5e0[0x16] = 0x538994 (jal FUN_00537aa0); states 2 / 3 / 8 / 9 / 0xf / 0x10 / 0x11 / 0x18's slots have no case 0x16: their defaults
// reach FUN_00537aa0. From 0x16 (FUN_00539ac0 -> FUN_00537aa0) to 2: 3.
// Worker 0255: to 7 from 0xf / 0x10 / 0x11 / 0x16: their defaults (FUN_005392e0 / FUN_005393d0 / FUN_005394d8 / FUN_00539ac0) -> jumptable[7] = 0x537af4: by P+0x100 bits 40-41:
// 1 -> 0xc (not reached: FUN_00539570's C+0x664 is 0 on the page), 2 -> 0xd, else 0xb. To the hit 0x18 from them: jumptable[0x18]: 0x3f. T w255_lying_kill2 / 4 / 0, w255_lying_big.
export function stateMotion(old, st, moving = false, stance = 0) {
  if (st === REVIVE_STATE) return 0x3e;
  if (old === 0xf || old === 0x10 || old === 0x11 || old === REVIVE_STATE) {
    if (st === DEAD_STATE) return stance === 2 ? 0xd : 0xb;
    if (st === HIT_STATE) return 0x3f;
  }
  // the knock-down (worker 0255): to 0xf from any state: 0x33 (FUN_005392e0 / jumptable 0x537b64). To 0x10: from 0xf FUN_005392e0: 0x38, else
  // jumptable 0x537b6c: 0x1b. To 0x11: from 0xf 0x35 (FUN_005392e0), from 0x10 0x3a (FUN_005393d0).
  if (st === 0xf) return 0x33;
  if (st === 0x10) return old === 0xf ? 0x38 : 0x1b;
  if (st === 0x11) return old === 0xf ? 0x35 : 0x3a;
  if (old === 0x11 && (st === 2 || st === 3)) return 0x37;   // FUN_005394d8: the get-up
  // from the air states to 7: FUN_00538a30's default -> FUN_00537aa0: jumptable[7] = 0x537af4 by P+0x100 bits 40-41: stance 0 -> 0xb
  if (st === DEAD_STATE && (old === ST.JUMP || old === ST.FALL || old === ST.JUMP2 || old === ST.BACK || old === ST.BACK2)) return 0xb;
  if (old === REVIVE_STATE && st === 2) return 3;
  if (st === DEAD_STATE && (old === 2 || old === 3 || old === HIT_STATE)) return 0xb;
  if ((old === 2 || old === 3) && st === HIT_STATE) return 0x3f;
  if (old === HIT_STATE) return st === 3 ? 5 : st === 2 ? 3 : st === ST.FALL ? 0x22 : null;
  if ((old === ST.JUMP || old === ST.FALL || old === ST.JUMP2 || old === ST.BACK || old === ST.BACK2)
      && (st === 2 || st === 3)) return 0x21;
  if (old === 2 && st === 3) return moving ? 9 : 5;
  if (old === 3 && st === 2) return moving ? 8 : 3;
  if ((old === 2 || old === 3) && st === ST.FALL) return 0x22;
  return null;
}

// ---------------------------------------------------------------- 1. the gate
// FUN_00575698: may a jump start from the current motion state? (also the second jump)
//   motionId = *(C+2000)+0x70: 0x20 jump, 0x22 fall, 0x59 back jump; standing/walking is 3/8.
export function secondJumpGate(ctrl, motionId) {
  const C = ctrl.C, P = ctrl.P;
  if ((C.flags79c ?? 0) & 0x20) return false;            // second jump already used
  if (!ctrl.onGround && ((P.flags2a8 ?? 0) & 8) && ((P.flags2a8 ?? 0) & 0x10)) return false;
  const s = C.s664 ?? 0;                                  // C+0x664 (0 in z128)
  if (!(s === 0 || s === 1 || s === 2)) return false;
  return motionId === 0x20 || motionId === 0x22 || motionId === 0x59;
}

// FUN_00333150's ✕ branch + FUN_00577230. `env` carries the flags the port doesn't model;
// the defaults are the save state's values (P+0x118 = 0x20209, C+0x564 bit 0x4000 clear,
// no input lock, no weapon block), for which the gate is open on foot.
//   pressed: ✕ went down this frame (FUN_00254810(0xd, 1, 0)); ladder: a ladder took ✕.
export function canJump(ctrl, motionId, { pressed, ladder = false, p118 = 0x20209, c564 = 0,
                                         inputLock = 0, weaponBlock = false } = {}) {
  if (!pressed || ladder) return false;
  // FUN_00577230
  let ok;
  if (p118 & 0x40000) ok = false;
  else if ((p118 & 0x200) && !(c564 & 0x4000)) ok = true;
  else ok = secondJumpGate(ctrl, motionId) || ctrl.P.state === 0x12;
  if (!ok) return false;
  const st = ctrl.P.state;
  if (st === 0x1a || (st >= 0x80 && st < 0xc0)) return false;      // FUN_0055bb40
  if (st >= 0xc0 || st === 0x13 || st === 0x14 || st === 0x1d) return false;   // FUN_0055bb78(P, 1)
  if (inputLock & 2) return false;                        // FUN_003242e8 bit 1
  if (weaponBlock) return false;                          // FUN_00574ca0
  return true;
}

// ---------------------------------------------------------------- 2. take-off
// FUN_00353458: signed angle (rad) from the facing C+0x20 to the move direction C+0x90
// about the up axis C+0x10 (FUN_00260e74). Up is -y in game space.
export function moveAngle(face, move) {
  const cx = face.z * move.x - face.x * move.z;           // (face x move) . (0, -1, 0)
  const dot = face.x * move.x + face.z * move.z;
  return Math.atan2(cx, dot);
}

// FUN_00575768(P, kind) for the physics body (DAT_0046e298 bit 13 set; z128).
// kind 0 = normal (✕), 1 = high jump (FUN_00326068(3) or FUN_00321460() == 1; not z128).
// opts.altHeight: the cfg+0xc0 branch (FUN_00310c60() >= 0x12, FUN_00310c40() >= 0x2e and the
// weapon byte 3..4: story progress; false in z128). opts.backLoaded: slot 0xdb (c_bj1) usable
// (FUN_003455e8; true in z128: the slot holds c_bj1 and j_back plays it).
// Returns the new player state, or null when the state doesn't allow a jump.
export function startJump(ctrl, motionId, { kind = 0, altHeight = false, backLoaded = true } = {}) {
  const P = ctrl.P, C = ctrl.C, J = JUMP;
  if (ctrl.onGround) {                                    // C+0x1c0 bit 0x200
    P.airShots = 0;                                       // P+0x270 = 0
    P.flags2a8 = (P.flags2a8 ?? 0) & ~0x18;               // FUN_00574808(P, 3 / 4, 0)
  }
  P.flags2a8 = (P.flags2a8 ?? 0) & ~0x60;                 // FUN_00574808(P, 5 / 6, 0)
  let h;
  if (kind === 1) h = f32(f32(J.cfgC4 + J.cfgC4) + 1.0);
  else h = f32((altHeight ? J.cfgC0 : J.cfgC4) + 1.0);

  // back jump: FUN_0036b058(angle) and slot 0xdb
  let back = false;
  const a = moveAngle(C.face, C.moveDir ?? { x: 0, y: 0, z: 0 });
  const deg = f32(a * 57.295776);
  if (!(deg >= -J.backAngle && deg <= J.backAngle) && backLoaded) back = true;
  // (back: FUN_0034b638(C, C+0x2d0) sets a turn target here, but FUN_00578748 overwrites
  // C+0x2c0 / C+0x2cc later in the same frame, so it has no effect; not ported)

  const st = P.state;
  let next;
  if (onFoot(st) || st === 0x11) {                        // 0x11: player.js knockInput tested C+0x568 bit 0x2000000 and the ground (FUN_00575768 case 0x11)
    C.flags79c = (C.flags79c ?? 0) & ~0x20;
    next = back ? ST.BACK : ST.JUMP;
  } else if (inAir(st)) {
    if (!secondJumpGate(ctrl, motionId)) return null;
    C.flags79c = (C.flags79c ?? 0) | 0x20;
    next = back ? ST.BACK2 : ST.JUMP2;
  } else {
    return null;                                          // other states: no jump (0x12/0x15/0x17 not ported)
  }
  enterState(P, next);                                    // FUN_0055b8e0(P, next, ...)
  P.flags2a8 &= ~4;                                       // bVar3: FUN_00574808(P, 2, 0)
  P.jumpBits = kind === 2 ? 2 : 1;                        // FUN_00565df8(P, 2 / 1) (l.236-245)

  // physics-body branch: cfg+0xcc = 1.2, gravity = cfg+0xcc x 196 (FUN_00356358)
  const bs = ctrl.body.state, airborne = bs === 2 || bs === 3 || bs === 6 || bs === 7;   // FUN_003577c8
  if (!airborne) {
    ctrl.startFall(h);                                    // FUN_0034a8e0 -> FUN_00357168(h)
  } else if (C.flags79c & 0x20) {
    if ((P.flags2a8 ?? 0) & 1) h = f32(h - 0.1);
    if ((P.airShots ?? 0) > 0) {
      const above = f32(ctrl.body.gy - ctrl.pos.y);        // FUN_00359050: body+0x14 - body+4
      if (h <= above) h = f32(h - Math.min(f32(above - h), 5.0));
    }
    ctrl.startFall(h);                                    // FUN_00357168(h)
  }
  return next;
}

// ---------------------------------------------------------------- 3. motion states
// A clip request for the motion player (FUN_003456c0 / FUN_003449a0): slot, name, blend
// frames (0 while C+0x564 bit 2 is set by FUN_00340bb8(C, 0, -1)), and the play flags:
// now = flag 2 (replace the head layer), else queued after it; loop = flag 1.
const req = (slot, { now = false, loop = false, blend = 0 } = {}) =>
  ({ slot, clip: SLOT[slot], now, loop, blend });

// FUN_00345818(C, level, up, down, flags, param_6, 0): an aimed whole-body set. The level clip
// plays with the up or down partner by the aim zone (C+0x590 bits 25-26); the blend is C+0x591
// when the head layer is still blending in (FUN_00346150 = FUN_005a9768(MP): the head layer's
// +0x24 blend length > 0; aim_g f45 / f48 yes -> 11 / 2, f82 no -> 0) or when param_6 is set
// and the zone is unchanged, else 0 (FUN_00340bb8(C, 0, -1)). Flags 2 = now, 1 = loop; with
// 0x80, a request for the level clip and partner already on the head is dropped (FUN_00344608:
// C+0x570 / C+0x578), so the fall class's re-issue of h_jp3_a doesn't restart it (aim_g f50).
// GUESS: the zone never changes: the page has no aim zones (it plays the level clip, no
// partner; see notes/fidelity-audit.md "Jump"), so "zone unchanged" holds and the partner
// matches whenever the level clip does.
function aimedReq(slot, flags, param6, io, b591 = JUMP.blend591) {
  const clip = SLOT[slot];
  if ((flags & 0x80) && io.headClip === clip) return [];
  const blend = (io.headBlending || param6) ? b591 : 0;
  return [{ ...req(slot, { now: !!(flags & 2), loop: !!(flags & 1), blend }), aimed: true }];
}

// FUN_00598f50: the jump motion state (class 0x20). One update per game frame, before the
// character's move (FUN_0034ea18). `io` = { ground, clipEnded, armed, aimChanged }:
//   ground: C+0x1c0 bit 0x200; clipEnded: FUN_003460d8 (head clip no longer playing);
//   armed: C+0x590 bit 24 and slot 0xbc usable; aimChanged: the aim zone changed (C+0x590
//   bits 25-26 vs 27-28) or FUN_00349db8(C, 3) && FUN_00349db8(C, 4).
// Returns the clip requests of this frame. this.freeze mirrors C+0x1c0 bit 0x20 (FUN_0034ea18
// skips the character's move and turn while it is set).
export class JumpMotion {
  constructor(second = false) {
    this.id = 0x20;
    this.second = second;                                 // C+0x79c bit 0x20 at entry
    this.phase = 0; this.t = 0; this.done = false; this.freeze = false;
  }
  update(io) {
    const J = JUMP, out = [];
    switch (this.phase) {
      case 0: {
        this.freeze = true;
        const armed = !this.second && io.armed;
        if (this.second) out.push(req(0xd5, { now: true }));
        else if (armed) out.push(...aimedReq(0xbc, 0x82, 1, io));   // FUN_00345818(C, 0xbc, 0xc2, 0xc8, 0x82, 1, 0)
        else out.push(req(0x16, { now: true }));
        // the take-off sounds (worker 0277; T w277_jump: f11 fsj_026 + bt_v010, second jump f141 bsj_520 + bt_v010):
        // bVar1 ? (second ? 'bsj_525' : FUN_00341410(C, 2)) : second ? FUN_00341268(C, 'bsj_520') : FUN_00341410(C, 2),
        // then FUN_003412d0(C, 0x50, 1) (the cue, forced)
        if (io.sound) {
          if (this.second) io.sound.name(io.sound.wet ? 'bsj_525' : 'bsj_520');   // 0x5a3b48 / 0x5a3b50
          else io.sound.foot(2);
          io.sound.cue(0x50, 1);
        }
        this.phase = this.second ? 8 : armed ? 4 : 1;
        this.t = 0;
        break;
      }
      case 1:
      case 8:
        if (io.clipEnded || this.t >= J.freezeMax) {
          this.freeze = false;
          if (this.phase === 1) {
            out.push(req(0x17), req(0x18), req(0x19, { loop: true }));
          } else {
            out.push(req(0xd6), req(0xd7), req(0xd8, { loop: true, blend: 4 }));
          }
          this.phase = 2;                                 // t keeps counting (no reset)
        }
        break;
      case 2:
      case 3:
        if (this.t > J.phase2Mark && this.phase === 2) this.phase = 3;   // FUN_005ae618(MP, 2)
        if (io.ground) this.done = true;                 // FUN_005ae618(MP, 3); +8 |= 1
        break;
      case 4:                                             // armed wind-up (h_jp0_a)
        if (io.clipEnded || this.t >= J.freezeMax) {
          this.freeze = false;
          out.push(...aimedReq(0xbd, 2, 0, io));          // FUN_00345818(C, 0xbd, 0xc3, 0xc9, 2, 0, 0)
          this.phase = 5; this.t = 0; return this.tick(out);
        }
        break;
      case 5:
      case 6: {
        // the next part after its clip or 20 ticks (phase 6 -> h_jp3_a, flags 0x83: loop);
        // on the ground -> 7; an aim-zone change re-issues the current set (flags 2: restarts)
        const cur = this.phase === 5 ? 0xbd : 0xbe;
        if (!io.clipEnded && this.t < J.aimPhaseMax) {
          if (io.ground) { this.phase = 7; break; }
          if (io.aimChanged) out.push(...aimedReq(cur, 2, 0, io));
          break;
        }
        if (this.phase === 5) out.push(...aimedReq(0xbe, 2, 0, io));     // h_jp2_a
        else out.push(...aimedReq(0xbf, 0x83, 0, io));                     // h_jp3_a, looped
        this.phase = this.phase === 5 ? 6 : 7; this.t = 0; return this.tick(out);
      }
      case 7:
        if (!io.ground) { if (io.aimChanged) out.push(...aimedReq(0xbf, 0x83, 0, io)); }
        else this.done = true;                            // FUN_005ae618(MP, 3); +8 |= 1
        break;
    }
    return this.tick(out);
  }
  tick(out) { this.t = f32(this.t + JUMP.STEP); return out; }
}

// FUN_005a1510: the back-jump motion state (player states 0x20 / 0x21; its id 0x59 is the one
// FUN_00575698 and FUN_00538a30 name). Same shape as JumpMotion with the c_bj clips; h_jp3
// is queued with blend 4. Armed (phases 4-7): c_bj0-2 played now (FUN_003456c0, flags 2), then
// the h_jp3_a set through FUN_00345818 (flags 0x83, the aimedReq blend rule), as FUN_00598f50.
// io as JumpMotion, plus io.usable(slot) (FUN_003455e8; default: yes).
export class BackJumpMotion extends JumpMotion {
  constructor(second = false) { super(second); this.id = 0x59; }
  update(io) {
    const J = JUMP, out = [];
    const usable = io.usable ?? (slot => !UNLOADED.has(slot));
    switch (this.phase) {
      case 0: {
        this.freeze = true;
        const second = this.second && usable(0xe0);
        const armed = !second && io.armed;
        if (second) out.push(req(0xe0, { now: true }));
        else if (armed) out.push(req(0xdd, { now: true }));   // FUN_00345530(C, 1) first
        else out.push(req(0xda, { now: true }));
        // FUN_005a1510 phase 0 (worker 0277): bVar1 ? 'bsj_525' : second ? 'bsj_522' : 'bsj_521' (FUN_00341268; 0x5a3b48 /
        // 0x5a3d30 / 0x5a3d38), then FUN_003412d0(C, 0x50, 1). Not traced (the back jump's names read from the ELF)
        if (io.sound) {
          io.sound.name(io.sound.wet ? 'bsj_525' : second ? 'bsj_522' : 'bsj_521');
          io.sound.cue(0x50, 1);
        }
        this.phase = second ? 8 : armed ? 4 : 1;
        this.t = 0;
        break;
      }
      case 1:
      case 8:
        if (io.clipEnded || this.t >= J.freezeMax) {
          this.freeze = false;
          if (this.phase === 1) out.push(req(0xdb), req(0xdc), req(0x19, { loop: true, blend: 4 }));
          else out.push(req(0xe1), req(0xe2), req(0xd8, { loop: true, blend: 4 }));
          this.phase = 2;
        }
        break;
      case 2:
      case 3:
        if (this.t > J.phase2Mark && this.phase === 2) this.phase = 3;
        if (io.ground) this.done = true;
        break;
      case 4:
        if (io.clipEnded || this.t >= J.freezeMax) {
          this.freeze = false;
          out.push(req(0xde, { now: true }));
          this.phase = 5; this.t = 0; return this.tick(out);
        }
        break;
      case 5:
      case 6:
        if (!io.clipEnded && this.t < J.aimPhaseMax) {
          if (io.ground) this.phase = 7;                // (the aim-zone checks here play nothing)
          break;
        }
        if (this.phase === 5) out.push(req(0xdf, { now: true }));
        else out.push(...aimedReq(0xbf, 0x83, 0, io));   // FUN_00345818(C, 0xbf, 0xc5, 0xcb, 0x83, 0, 0): now, loop
        this.phase = this.phase === 5 ? 6 : 7; this.t = 0; return this.tick(out);
      case 7:
        // the zone-change re-issue, as phase 6 (FUN_00345818(C, 0xbf, 0xc5, 0xcb, 0x83, 0, 0))
        if (!io.ground) { if (io.aimChanged) out.push(...aimedReq(0xbf, 0x83, 0, io)); }
        else this.done = true;
        break;
    }
    return this.tick(out);
  }
}

// FUN_005766c0(P, on, 1): the R1 / R3 draw (on) and the circle holster, the player side (the weapon
// side, FUN_00576548, is aim_core draw / holsterCore; P+0x2a8 bit 0 is set / cleared there).
// The draw restarts the fall only when P+0x100 bits 46-47 != 0 (a take-off) and C+0x1c0 bit 0x200
// is clear: a walk-off or a ladder drop keeps falling. Both paths then pick the state: the ground
// state when the bits are 0 and the ground bit is set, else 9. So in the jump's wind-up (bits 1,
// still on the ground) a draw goes to state 9 without a restart. FUN_0055bb40 (states 0x80-0xbf)
// is 0 in the states the page draws from. Returns the new player state, or null (holster in
// states 0x1f / 0x20 / 0x21: no change); the ground states are returned, not written (the caller's).
// Not ported: FUN_00565d78 (P+0x100 bit 44, C+0x590 bit 24; the page reads the drawn gun instead:
// Jump.event's b44), the state-4/5 choice by P+0x100 bits 40-41 (0 traced).
export function weaponSwitch(ctrl, on) {
  const P = ctrl.P;
  const took = (P.jumpBits ?? 0) !== 0;                   // (P+0x100 >> 0x2e & 3) != 0
  if (on && took && !ctrl.onGround) {
    // FUN_00326500() true: FUN_00357168(DAT_0046ee88 = 1.0, C+0x3b0), a fresh take-off of height 1;
    // 0 after a second jump (C+0x79c bit 0x20) near the apex (|C+0x498 - C+0x484| = |rise - t| < 0.1)
    const B = ctrl.body;
    let h = 1.0;
    if (((ctrl.C.flags79c ?? 0) & 0x20) && Math.abs(f32(B.rise - B.t)) < 0.1) h = 0;
    ctrl.startFall(h);
  }
  if (!took && ctrl.onGround) {                           // FUN_0055b8e0(P, 3 / 2, 0, 0) (LAB_00576930)
    // with its motion: a draw / holster during the landing cuts to the (armed) stand / walk at once
    // (traced: j_land_draw f58, j_gun_land_holster f82)
    if (ctrl.jump) ctrl.jump.enter(ctrl, on ? 3 : 2);
    else enterState(P, on ? 3 : 2);
    return on ? 3 : 2;
  }
  if (!on) {
    const st = P.state;
    if (st === ST.JUMP2 || st === ST.BACK || st === ST.BACK2) return null;   // ' ', '!', 0x1f
  }
  enterState(P, ST.FALL);                                 // FUN_0055b8e0(P, 9, 1, 0) (enter FUN_00538b50)
  if (ctrl.jump) ctrl.jump.forceFall(ctrl);               // ... its param_3 = 1: the motion becomes 0x22
  // LAB_005769c8: a draw in an air state (FUN_0055aa88) sets P+0x2a8 bit 3 (FUN_00574808(P, 3, 1)):
  // no second R1 draw before the next take-off from the ground (FUN_003320c0 l.288)
  if (on) P.flags2a8 = (P.flags2a8 ?? 0) | 8;
  return ST.FALL;
}

// FUN_00333150's P+0x29c (turn mode) writes. States 0x20 / 0x21 (the back jump), after the stick writes (player.js
// stickInput's air path): P+0x29c = 5 unless P+0x2a8 bit 0 (armed: 3) or bit 2 is set (2),
// and with the stick past DAT_0046e518 = 0.5, P+0x2a8 bit 2 is set once the body's fall clock
// passes the apex: t (body+0xd4) > rise (body+0xe8) + margin, margin = DAT_0046e51c = 0.06 when
// the stick points more than 90 deg away from P+0x80 (the player's facing), else DAT_0046e520 = 0.
// FUN_00578748 then negates the turn target in mode 5 (LAB_00579288): he faces away from the
// stick until bit 2 turns him round. stick = { x, z, mag } in world space.
export function stickMode(ctrl, stick) {
  const P = ctrl.P, st = P.state;
  const f2a8 = P.flags2a8 ?? 0;
  if (st !== ST.BACK && st !== ST.BACK2) { P.mode29c = (f2a8 & 1) ? 3 : 2; return; }   // the other tails
  if (f2a8 & 1) { P.mode29c = 3; return; }               // LAB_00333e08
  if (f2a8 & 4) { P.mode29c = 2; return; }               // LAB_00333e28
  P.mode29c = 5;
  if (!(stick.mag > 0.5)) return;
  // FUN_00261038(P+0x80, stick): the angle between them.
  // GUESS: P+0x80 = the facing C+0x20 (equal in the save state; the writer isn't found;
  // see notes/jump-research.md)
  const a = moveAngle(ctrl.C.face, { x: stick.x, y: 0, z: stick.z });
  const deg = f32(a * 57.295776);
  const margin = (deg >= -90 && deg <= 90) ? 0.0 : 0.05999999865889549;
  if (ctrl.body.t <= f32(ctrl.body.rise + margin)) return;
  P.flags2a8 = f2a8 | 4;                                  // FUN_00574808(P, 2, 1)
}

// FUN_00578748 LAB_00579288: in the air states with P+0x29c = 5 the turn target is negated
// before FUN_0034b638(0.25, C, dir). player.js airIntent doesn't know mode 5; apply after it.
export function backTurnFix(ctrl) {
  const P = ctrl.P, st = P.state;
  if (!(st === 8 || st === 9 || (st >= 0x1f && st <= 0x21))) return;
  if (P.mode29c !== 5) return;
  const t = ctrl.C.turn;
  ctrl.C.turn = { x: -t.x, y: -t.y, z: -t.z };
}

// FUN_00599aa0: the landing motion state (class 0x21). `io` = { clipEnded, groundSpeed, armed }.
// When done, this.next = the motion class the game goes to: 3 idle / 8 moving (6 / 9 armed),
// i.e. back to the locomotion clips.
export class LandMotion {
  constructor() { this.id = 0x21; this.phase = 0; this.t = 0; this.done = false; this.next = null; }
  update(io) {
    const out = [];
    if (this.phase === 0) {
      if (io.armed) out.push(...aimedReq(0xc0, 0x82, 0, io));   // FUN_00345818(C, 0xc0, 0xc6, 0xcc, 0x82, 0, 0)
      else out.push(req(0x1a, { now: true }));
      // FUN_00341410(C, 3), FUN_003412d0(C, 0x51, 0) (worker 0277; T w277_jump f53 / f190: fsj_038; cue 0x51 is '' for Vincent)
      if (io.sound) { io.sound.foot(3); io.sound.cue(0x51, 0); }
      this.t = 0; this.phase = 1;
    } else if (this.phase === 1) {
      if (io.clipEnded || this.t >= JUMP.landMax) {
        this.done = true; this.next = io.armed ? 6 : 3;
      } else if (this.t >= JUMP.landMoveAfter && io.groundSpeed > 0) {
        this.done = true; this.next = io.armed ? 9 : 8;
      }
      if (this.done) return out;                          // returns before t += step
    }
    this.t = f32(this.t + JUMP.STEP);
    return out;
  }
}

// FUN_00596830: the air-shot motion state (class 0x4e, vtable 0x5a6380; FUN_00592918 builds it
// for id 0x4e). A shot in the air enters it (FUN_00577480 -> FUN_00560b58, Jump.airShot). With
// slot 0xc1 (h_jp_f) empty, as in z128, phase 0 sets the blend to 1, plays the h_jp3_a set
// (flags 0x83: now, loop; dropped if h_jp3_a already plays), and is done with next motion 0x22.
// Traced aim_g: R1 f48 -> h_jp3_a 0.6 with blend 2 in the record of f49 (h_jp2_a never plays).
// The h_jp_f branch (phases 1-2: FUN_00345818(C, 0xc1, 199, 0xcd, 0x82, 0, 0), 30 ticks) can't
// run in z128 and is not ported.
export class AirFireMotion {
  constructor() { this.id = 0x4e; this.phase = 0; this.t = 0; this.done = false; this.next = null; this.freeze = false; }
  update(io) {
    const out = [];
    const usable = io.usable ?? (slot => !UNLOADED.has(slot));
    if (this.phase === 0) {
      // FUN_00345530(C, 1); C+0x664 == 2 -> FUN_00340de0(C, 1) (C+0x664 = 0 in z128)
      // the h_jp_f branch is not ported (slot 0xc1 is empty in z128): if a slot table ever has it,
      // leave the feature out (the h_jp3_a set below) instead of breaking the frame loop
      if (usable(0xc1) && !AirFireMotion.warned) {
        AirFireMotion.warned = true;
        console.warn('FUN_00596830: slot 0xc1 (h_jp_f) is loaded but its branch is not ported: playing the h_jp3_a set');
      }
      out.push(...aimedReq(0xbf, 0x83, 0, io, JUMP.airFireBlend));   // after FUN_00340bb8(C, 1, 1)
      this.done = true; this.next = 0x22; this.phase = 2;             // returns 0x22 (before t += step)
      return out;
    }
    this.t = f32(this.t + JUMP.STEP);
    return out;
  }
}

// FUN_00599820: the fall motion state (class 0x22, vtable 0x5a5a70; built by FUN_00599780).
// Phase 0 picks the blend by the previous motion id (FUN_00341780 stores it at +0): 0x16, 6-0xa,
// 0x30, 3, 0x12, 0x1c-0x1d -> FUN_00340bb8(C, 1, -1) and param_6 1; 0x1000-0x107f -> blend 6,
// param_6 1; any other (0x4e, the air shot) -> FUN_00340bb8(C, 0, -1) and param_6 0. Then
// FUN_005ae618(MP, 2) (not ported; the trace shows it at aim_g f49), and armed: the h_jp3_a set
// (flags 0x83, dropped when h_jp3_a already plays: aim_g f50 no restart), else h_jp3 (flags 3:
// now, loop). Phase 2: done on the ground (FUN_005ae618(MP, 3); +8 |= 1).
export class FallMotion {
  constructor(prev = 3) { this.id = 0x22; this.prev = prev; this.phase = 0; this.t = 0; this.done = false; this.freeze = false; }
  update(io) {
    const out = [];
    if (this.phase === 0) {
      const p = this.prev;
      let param6 = 1, b591 = JUMP.blend591, cut = false;
      if (p >= 0x1000 && p < 0x1080) b591 = 6;
      else if (!(p === 0x16 || (p >= 6 && p <= 0xa) || p === 0x30 || p === 3 || p === 0x12 || p === 0x1c || p === 0x1d)) {
        param6 = 0; cut = true;                           // FUN_00340bb8(C, 0, -1): C+0x591 unchanged
      }
      if (io.armed) out.push(...aimedReq(0xbf, 0x83, param6, io, b591));
      else out.push(req(0x19, { now: true, loop: true, blend: cut ? 0 : b591 }));
      this.phase = 2;
    } else if (this.phase === 2) {
      if (io.ground) this.done = true;
    }
    this.t = f32(this.t + JUMP.STEP);
    return out;
  }
}

// FUN_0059df28: the hit motion state (class 0x3f; factory 0x592918 case 0x3f -> 0x593680: FUN_005a37b8,
// vtable 0x5a4b70, update vt+0x24). Phase 0: FUN_00340bb8(C, 1, 2) (blend 2), FUN_003456c0(1.0, C, 0x3e,
// 2, 0) = row 0x3e c_std now, not looped, FUN_00340bb8(C, 1, -1) (C+0x591 back), timer 0. Phase 1: done
// when the clip is done (FUN_003460d8) or the timer > 120 (then FUN_00341b20's next motion: unused, the
// done event changes the state); off the ground (C+0x1c0 bit 0x200 clear) the done bit only. The timer
// (+0xc) += DAT_004eeb24 on every frame that doesn't end.
export class HitMotion {
  constructor() { this.id = 0x3f; this.phase = 0; this.t = 0; this.done = false; this.freeze = false; }
  update(io) {
    const out = [];
    if (this.phase === 0) {
      out.push(req(0x3e, { now: true, loop: false, blend: 2 }));
      this.t = 0; this.phase = 1;
    } else {
      if (io.clipEnded || 120.0 < this.t) { this.done = true; return out; }
      if (!io.ground) this.done = true;
    }
    this.t = f32(this.t + JUMP.STEP);
    return out;
  }
}

// FUN_00595a60: the death motion (class 0xb; factory 0x592918 case 0xb -> FUN_005a37b8, vtable 0x5a6600: enter
// FUN_005959b8 C+0x564 |= 0xc000 and FUN_003467b8(C, 1); leave FUN_005959f8 undoes them and FUN_00340b28(C, 0)).
// Phase 0: C+0x1c8 is 0xc for Vincent (save RAM), so no FUN_003533e0; FUN_0034b110(0, C) (the move speed C+0xcc
// = 0: the death slide's mover 0xb sets its own every frame); C+0x564 bit 0x800 clear -> FUN_00353418 (C+0x214 =
// 0: no turn, C+0x1c4 &= ~2); FUN_00340bb8(C, 0, -1) (no blend); FUN_00340b28(C, 1) (C+0x568 |= 0x20: the clip's
// root motion moves him) and C+0x568 |= 0x40; FUN_003456c0(1.0, C, row, -1, 0): row = DAT_005a3990[C+0x590 &
// 0xf] (0x2b 0x2b 0x2a 0x2c 0x2d 0x2e 0x2f: all c_st_fa0), now, not looped; the death cue FUN_00341330(C, 0x56..
// / 0x62.. by FUN_00340658) (played by enemy_ai.js deathMotionCue; table from ai.json player.death); FUN_00340bb8(C, 1, -1); C+0x710 = identity, C+0x74c = 0;
// timer 0. Phase 1: from 10 ticks C+0x74c drives FUN_00346210(C, .., 0xf) and message 8 (FUN_00341988(C, 8));
// the player's message 8 (0x56a414) returns at once for P+0x28 bit 2 (set: 0x20901f), so nothing on the page.
// Done (+8 |= 1) when the clip is done (FUN_003460d8; C+0x808 bit 0x20000 clear: 0x13fb in the save) or the
// timer > 420; next motion 0xd (C+0x808 bit 0x10000 clear; else 0x39). The timer += step otherwise.
// side = C+0x590 & 0xf (the hit side): ctrl.C.hitSide, written by FUN_0055d678 on a melee hit (enemy_ai.js
// playerHitSide via player.js setHitSide); the bullet path never writes it: 0 from the save RAM (0xa000a00).
const DEATH_ROW = [0x2b, 0x2b, 0x2a, 0x2c, 0x2d, 0x2e, 0x2f];        // DAT_005a3990
export class DeathMotion {
  constructor(side = 0, id = 0xb) { this.id = id; this.phase = 0; this.t = 0; this.done = false; this.next = null; this.side = side; this.freeze = false; this.rootMotion = false; }
  update(io) {
    const out = [];
    // class 0xd FUN_00595ea8 (killed lying, stance 2; rows DAT_005a39f0 hold c_sq_fa0, c_fl_1 stays the head clip in T). GUESS: done and event 0xd on its first update
    // (T w255_lying_kill2 record 175: P+0x118 bit 0x100 and C+0x564 bit 0x20 rise with the kill; the class's own code needs a second update, not decoded; notes/fidelity-audit.md)
    if (this.id === 0xd) { this.done = true; this.next = 0xd; return out; }
    if (this.phase === 0) {
      if (io.C) io.C.rotMode = 0;                         // FUN_00353418: C+0x214 = 0 (no turn)
      out.push(req(DEATH_ROW[this.side & 0xf], { now: true, loop: false, blend: 0 }));
      this.rootMotion = true;                             // FUN_00340b28(C, 1)
      this.t = 0; this.phase = 1;
      return out;                                         // phase 0 returns before the timer
    }
    if (io.clipEnded || 420.0 < this.t) { this.done = true; this.next = 0xd; return out; }
    this.t = f32(this.t + JUMP.STEP);
    return out;
  }
}
// FUN_0059dd48: the revive's motion state (class 0x3e; factory 0x592918 case 0x3e -> 0x593658: FUN_005a37b8, vtable 0x5a4bf0, update
// vt+0x24). Phase 0: FUN_00340bb8(C, 1, 0xf) (blend 15), FUN_003456c0(1.0, C, 1, 0x83, 0) = row 1 (h_st), FUN_003533e0 (no move), timer
// 60. Phase 1: done at FUN_003460d8, when the timer goes below 0 (-= step), or once C+0x1d8 > 0.
// T: w255_phoenix_air 50 frames in state 0x16 (the timer: 60 ticks); w255_phoenix 2, ended by C+0x1d8 = 8.87 at record 1006.
// Enter 0x59dcf0: C+0x564 |= 0x4000 | 0x8000, leave 0x59dd18 clears them (T w255_phoenix 1005-1006: 0xc001): the gate in FUN_003320c0 /
// FUN_00577230 for these two frames (aim.js c564).
export class ReviveMotion {
  constructor() { this.id = 0x3e; this.phase = 0; this.t = 60; this.done = false; this.next = null; }
  update(io) {
    const out = [];
    if (this.phase === 0) {
      if (io.C) io.C.rotMode = 0;                         // FUN_003533e0's FUN_00352a60 / C+0x300 (as DeathMotion's FUN_00353418)
      out.push(req(1, { now: true, loop: true, blend: 15 }));
      this.phase = 1;
      this.t = f32(this.t - JUMP.STEP);
      return out;
    }
    if (io.clipEnded || this.t < 0 || io.groundSpeed > 0) { this.done = true; this.next = 3; return out; }
    this.t = f32(this.t - JUMP.STEP);
    return out;
  }
}
// The knock-down's motion classes (FUN_005618d0 -> states 0xf / 0x10 -> 0x11; worker 0255, T w255_phoenix_air; factory 0x592918). Each: phase 0
// requests its row, phase 1 ends and names the next class, which runs unless the state handler changed the state.
// L: FUN_003456c0's random rates (c_bl_0 0.5-1.2, c_bl_1 0.8-1.0) play at 1.0; FUN_005ae618(MP, 2 / 3) and the cues (0x46 / 0x48, 0x49 / 0x4a, 0x4d),
// the pad's vibration FUN_002573c8 are not on the page.
// (its timers sum as the EE FPU does, toward zero (chop): class 0x3a's 60 < t comes on its 51st update, T w255_knock_run 160-211, w255_phoenix_air 857-908)
// FUN_003533e0: FUN_0034d870(C, 0), FUN_00352a60(C), C+0x300 = 0: the mover goes and the commanded speed C+0xcc with it
export const stopMove = C => { C.slide = null; C.spd = 0; C.groundSpeed = 0; };
class KnockMotion {
  constructor(id, prev) { this.id = id; this.prev = prev; this.phase = 0; this.t = 0; this.done = false; this.next = null; this.freeze = false; this.knock = true; this.lock = false; }
  update(io) {
    const out = [];
    if (this.phase === 2) return out;                     // 0x36 done: holds (the state handler keeps state 0x11)
    const first = this.phase === 0;
    if (first) this.phase = 1;
    const end = n => { this.done = true; this.next = n; return out; };
    switch (this.id) {
      case 0x33:                                          // FUN_0059c810: row 0xa8, at its end class 0x34 (no timer)
        if (first) { out.push(req(0xa8, { now: true, blend: JUMP.blend591 })); return out; }
        if (io.clipEnded) { out.push(req(0xab, { now: true, loop: true })); return end(0x34); }   // (the end asks row 0xab itself, blend 0)
        return out;
      case 0x1b:                                          // FUN_0059d630: row 0xae, at its end class 0x39
        if (first) { out.push(req(0xae, { now: true, blend: JUMP.blend591 })); return out; }
        if (io.clipEnded) { out.push(req(0xaf, { now: true })); return end(0x39); }
        return out;
      case 0x34:                                          // FUN_0059c9a0: row 0xab; the ground ends it; more than 15 above the ground: class 0x38
        if (first) { out.push(req(0xab, { now: true, loop: true, blend: JUMP.blend591 })); return out; }
        if (io.ground) return end(0x36);                  // (the state handler answers 0x11: class 0x35 replaces this)
        return io.above > 15.0 ? end(0x38) : out;         // L: FUN_00359010 (body +0xac bits) false, C+0x1c0 bit 0x400 set off the ground (T); C+0x664 = 0
      case 0x38:                                          // FUN_0059d4c0: row 0xad, at its end 0x3a on the ground, else 0x39
        if (first) { out.push(req(0xad, { now: true, blend: JUMP.blend591 })); this.t = 0; return out; }
        if (io.clipEnded) return end(io.ground ? 0x3a : 0x39);
        this.t = chop(this.t + JUMP.STEP);
        return out;
      case 0x39:                                          // FUN_0059d788: row 0xaf; the ground ends it: class 0x3a
        if (first) { out.push(req(0xaf, { now: true, loop: true, blend: JUMP.blend591 })); return out; }
        return io.ground ? end(0x3a) : out;
      case 0x3a:                                          // FUN_0059dae8: row 0xb0 from frame 1 (FUN_00345448(2.0)), at its end or past 60 ticks class 0x36
        // first 8 ticks: C+0x568 bit 0x2000000 (✕: FUN_005763b8, player.js knockInput). 60 clip units left: C+0x79c bit 0x100 (DAT_0046ef90 = 62: the stick's roll).
        if (first) { const r = req(0xb0, { now: true }); r.frame = 1; out.push(r); this.t = JUMP.STEP; this.tech = true; return out; }
        if (this.tech && 8.0 <= this.t) this.tech = false;
        if (io.rem < 62.0) this.rollOk = true;
        if (io.clipEnded || 60.0 < this.t) return end(0x36);
        this.t = chop(this.t + JUMP.STEP);
        return out;
      case 0x35:                                          // FUN_0059cbe8: phase 0: FUN_003533e0, mover 9 back 15 u in 30 ticks (T w255_knock_air: 60 u/s at record 141), row 0xac; at its end class 0x36
        if (first) { if (io.C) stopMove(io.C); if (io.ctrl) io.ctrl.knockBack(); out.push(req(0xac, { now: true })); this.t = 0; this.tech = true; return out; }
        if (this.tech && 8.0 <= this.t) this.tech = false;
        if (io.rem < 62.0) this.rollOk = true;
        if (io.clipEnded) return end(0x36);
        this.t = chop(this.t + JUMP.STEP);
        return out;
      case 0x37:                                          // FUN_0059d0f8: row 0xb1 (h_rev_0; rows 0xe3 / 0xe4 by FUN_00345060 = 0 here, T), cue 0x52. Past 40 ticks
        // C+0x564 &= ~0x4000000 (the stick is his again: FUN_00333150 LAB_00333b08, player.js stickInput) and C+0x1d8 > 0 ends it. L: FUN_003419e0(C, 1): the crouch
        // bits of those 40 ticks on (rows 0x1b, 0x20): the page has no crouch. T w255_knock_run: 66 frames, clip end.
        // The roll: FUN_00345060 = P+0x100 bits 42-43 (FUN_0055ba30, player.js knockInput) 1 / 2: rows 0xe3 / 0xe4, FUN_003472c0(C, 1): the clip's root moves him (T w255_knock_hold 189-223).
        if (first) {
          const side = io.side ?? 0;
          out.push(req(side === 1 ? 0xe3 : side === 2 ? 0xe4 : 0xb1, { now: true, blend: JUMP.blend591 }));
          if (side && io.C) { io.C.slide = { dir: { x: 0, y: 0, z: 0 }, v: 0, dv: 0, end: 0, mover: 0xb }; this.rootMotion = true; }
          this.t = 0; this.lock = true; return out;
        }
        if (io.clipEnded) return end(3);
        if (this.lock && 40.0 < this.t) this.lock = false;
        else if (!this.lock && 0.0 < io.groundSpeed) return end(3);
        this.t = chop(this.t + JUMP.STEP);
        return out;
      case 0x36:                                          // FUN_0059cee8: FUN_003533e0, timer 10 (-= step while > 0), then done (the row asked again is the one playing: L)
        if (first) { if (io.C) stopMove(io.C); this.t = chop(10.0 - JUMP.STEP); return out; }
        if (!(0.0 < this.t)) { this.done = true; this.next = null; return out; }
        this.t = chop(this.t - JUMP.STEP);
        return out;
    }
    return out;
  }
}
// ---------------------------------------------------------------- head-layer clock
// The motion player's head layer for the jump clips, enough to answer FUN_003460d8:
// frame += rate x weight/128 x step (FUN_005aa2a8); a loop resets to 0 at the clip length;
// a one-shot holds at n - 1 and counts as ended there (trace: h_jp0 2.0, h_jp4 14.0); a
// queued clip takes over at frame 0 on the advance that would pass n - 1, the remainder
// dropped (trace: h_jp1 8.4 -> 9.0 -> h_jp2 0.0; c_wjp2 7.8 -> h_jp3 0.0).
// GUESS: the hold / queue take-over rule (not decoded; inferred from 7 traces, exact on all;
// see notes/jump-research.md). Only FUN_005aa2a8's frame step and loop reset are decoded.
export class ClipClock {
  constructor(clip = null, frame = 0, frames = CLIP_FRAMES) {
    this.frames = frames; this.clip = clip; this.frame = frame; this.loop = false; this.queue = [];
    this.serial = 0; this.blend = 0;                    // each clip switch: serial + 1, the request's blend frames
    this.blendLen = 0;                                  // the head layer's +0x24 blend length (aim_g: 11 -> 9.8 -> ... -> 0)
  }
  apply(reqs) {
    for (const r of reqs) {
      if (r.now) { this.clip = r.clip; this.frame = r.frame ?? 0; this.loop = r.loop; this.queue = []; this.serial++; this.take(r.blend); }
      else this.queue.push(r);
    }
  }
  take(blend) { this.blend = blend; this.blendLen = blend > 0 ? blend + 1 : 0; }
  // FUN_00346150 -> FUN_005a9768(MP): the head layer is still blending in (+0x24 > 0)
  blending() { return this.blendLen > 0; }
  ended() {
    const n = this.frames[this.clip];
    return !this.loop && n !== undefined && this.frame >= n - 1;
  }
  advance(step = JUMP.STEP) {
    if (this.blendLen > 0) { this.blendLen = f32(this.blendLen - step); if (this.blendLen <= 0) this.blendLen = 0; }   // FUN_005aa5b8
    const n = this.frames[this.clip];
    if (n === undefined) return;
    // FUN_005aa2a8: frame += rate x step, on the EE FPU (rounds toward zero: chop). T: c_std in k_lunge166 ends
    // on the 26th advance (state 0x18 -> 2 at record 1489); rounded to nearest it would end on the 25th.
    const f = chop(this.frame + chop(chop(JUMP.clipRate) * step));
    if (this.loop) { this.frame = f >= n ? 0 : f; return; }
    if (f > n - 1 && this.queue.length) {               // passes the last frame: the queued clip
      const r = this.queue.shift(); this.clip = r.clip; this.frame = 0; this.loop = r.loop;
      this.serial++; this.take(r.blend); return;
    }
    this.frame = Math.min(f, n - 1);
  }
}

// ---------------------------------------------------------------- the per-frame driver
// The jump's hooks in the game's frame order, around PlayerController's own steps:
//   FUN_00333150 (✕ -> jump, then the stick)  ->  FUN_00578748 (intent)  ->
//   motion-state update (FUN_00598f50 / FUN_00599aa0)  ->  FUN_0034ea18 (move + turn,
//   skipped while frozen)  ->  state 8 -> 2 when the jump motion is done  ->  clip advance.
// The motion id (*(C+2000)+0x70) is tracked here: 0x20 jump, 0x21 land, 0x22 fall, else 3.
// frame() runs the whole order (test_jump.mjs); player.js's PlayerController.step calls the
// pieces (takeOff, stickMode, motionUpdate, advance) between its own steps.
export class Jump {
  constructor() { this.motion = null; this.clock = null; this.events = []; this.head = false; }
  // FUN_0055b8e0(P, st, 0, 0): the old state's motion for the new state (stateMotion), the state
  // change, then FUN_005641c0(P, motion, 0): FUN_00341780(C, motion, 0) unless it is already the
  // motion. Same state: no change (returns false). The locomotion motions (3 / 5 / 8 / 9) have no
  // class on the page: motion null hands the head layer back to the locomotion clips this frame.
  // The new state's enter slot (+0xc) is the caller's (event below; aim_core draw / holster).
  enter(ctrl, st) {
    const P = ctrl.P, old = P.state;
    if (st === old) return false;
    const prev = this.motionId(ctrl);
    const m = stateMotion(old, st, ctrl.C.groundSpeed !== 0, P.stance ?? 0);   // C+0x1d8
    // FUN_005738d0 (vt+0x2fc, the state's enter): 7, 0xf, 0x10: FUN_00576548(P, 0): the gun goes away (T: weapon state 14 / 15 at every kill and knock-down)
    if ((st === DEAD_STATE || st === 0xf || st === 0x10) && ctrl.weapon && ctrl.weapon.holsterCore) {
      ctrl.weapon.holsterCore(ctrl.onGround, ctrl);
      if (st !== DEAD_STATE && ctrl.weapon.P) ctrl.weapon.P.m29c = 2;   // FUN_005747f8(P, 2): 0xf / 0x10 only
    }
    // The enter slots (+0xc). 0xf / 0x10 FUN_005392b8 / FUN_00539390: stance 0. 0x11 FUN_00539458: stance 2 (0 only with FUN_00317a98 alive: a status item the page doesn't have: L; T w255_knock_run 160).
    // From 0x11 to 2 / 3, FUN_00537e70 / FUN_005380a0: stance 0: FUN_0055b8e0 runs the enter before FUN_005641c0, so their class 0x37 test still sees 0x3a (T 211). 7 and 0x16: player.js.
    if (ctrl.setStance) {
      if (st === 0xf || st === 0x10) ctrl.setStance(0);
      else if (st === 0x11) ctrl.setStance(2);
      else if (old === 0x11 && (st === 2 || st === 3)) ctrl.setStance(0);
    }
    if (st === REVIVE_STATE) ctrl.P.settled = false;      // FUN_00334590 reads it once; (0x539aa8 at the leave: no reader in between on the page)
    enterState(P, st);
    if (m === 0x21) {
      this.motion = new LandMotion();
      this.events.push({ frame: ctrl.frames, ev: 'land', state: st });
    } else if (m === 0x22) {
      this.motion = new FallMotion(prev);                 // runs from the next frame
      this.events.push({ frame: ctrl.frames, ev: 'fall' });
    } else if (m === 0x3f) {
      this.motion = new HitMotion();                      // phase 0 runs in this frame's motion update
      this.events.push({ frame: ctrl.frames, ev: 'hit', state: st });
    } else if (m === 0xb || m === 0xd) {
      // the death: phase 0 runs in this frame's motion update (FUN_005641c0 -> FUN_00341780(C, 0xb))
      this.motion = new DeathMotion(ctrl.C.hitSide ?? 0, m);
      this.events.push({ frame: ctrl.frames, ev: 'death', state: st });
    } else if (m === 0x3e) {
      this.motion = new ReviveMotion();                   // phase 0 runs in this frame's motion update
      this.events.push({ frame: ctrl.frames, ev: 'revive', state: st });
    } else if (m === 0x33 || m === 0x1b || m === 0x38 || m === 0x3a || m === 0x35 || m === 0x37) {
      this.motion = new KnockMotion(m, prev);             // the knock-down (phase 0 in this frame's motion update)
      this.events.push({ frame: ctrl.frames, ev: 'knock', state: st });
    } else if (m === 3 || m === 5 || m === 8 || m === 9) {
      if (this.motion) this.events.push({ frame: ctrl.frames, ev: 'loco', next: m });
      this.motion = null;
    }
    return true;
  }

  // the ladder mount (FUN_00576c88 / FUN_00576de8): FUN_0055b8e0(P, 0xb / 0xc, 0, 0). Every old
  // state's +0x24 slot on the page falls to FUN_00537aa0 for 0xb / 0xc: jumptable 0x589e70 ->
  // 0x537b44 / 0x537b4c, li v0, 0x26 / 0x27: the ladder's motion class, which FUN_005641c0 sets in
  // place of the running one. So a jump / fall / landing motion stops at the mount (the page's
  // ladder owns the clips). The ladder state itself stays with player.js's ladder GUESS.
  ladderMount(ctrl) {
    if (this.motion) this.events.push({ frame: ctrl.frames, ev: 'ladder' });
    this.motion = null;
    // The game's mount enters 0xb / 0xc, not an air state, so FUN_0055b8e0 clears the take-off
    // bits. GUESS: the page keeps no ladder state (player.js ladder GUESS), so a mount on the
    // frame after landing (state 8 / 0x1f / 0x20, done event not sent yet) goes to 2 instead;
    // without it he stays in an air state on the ground with no motion left to land him, and
    // can't jump (see notes/fidelity-audit.md, ladder rows).
    if (airState(ctrl.P.state)) enterState(ctrl.P, 2);
  }

  // FUN_0056a038 case 0 for one done event: the state handler, then FUN_0055b8e0(P, new, 0, 0)
  // (enter above). Returns the new state or 0.
  event(ctrl, ev) {
    const P = ctrl.P, old = P.state;
    const b44 = !!(ctrl.weapon && ctrl.weapon.drawn && ctrl.weapon.drawn());   // P+0x100 bit 44
    let st = stateEvent(old, ev, ctrl.onGround, b44, !!(ctrl.hpZero && ctrl.hpZero()),
                        Math.abs(moveAngle(ctrl.C.face, ctrl.C.moveDir ?? ctrl.C.face)) <= Math.PI / 2);
    if (st === 0x10 && old === HIT_STATE) {
      // GUESS: state 0x10 (the hit ending off the ground, FUN_00539b88) has no class on the page; it
      // goes to the fall state 9, whose motion from 0x18 is decoded (0x22, FUN_00539b48 -> jumptable)
      // (not decoded: state 0x10's class; see notes/fidelity-audit.md "Vincent's hit reaction")
      if (!this.warned10) { this.warned10 = true; console.warn('jump_core: state 0x10 (hit ended in the air) not ported: state 9'); }
      st = ST.FALL;
    }
    // state 0x11's FUN_00539570: dead, event 0x36: P+0x118 |= 0x100 (FUN_00334590 case 5 waits for it), FUN_003533e0 (T w255_phoenix_air record 917)
    if (old === 0x11 && ev === 0x36 && ctrl.hpZero && ctrl.hpZero()) { ctrl.P.settled = true; stopMove(ctrl.C); }
    // alive, events 0x3a / 0x35: FUN_003533e0 (C+0x564 bit 0x800 is clear on the page): mover 10 / 9 ends here
    if (old === 0x11 && (ev === 0x3a || ev === 0x35) && !(ctrl.hpZero && ctrl.hpZero())) stopMove(ctrl.C);
    if (!st || !this.enter(ctrl, st)) return 0;
    if (st === 2 || st === 3) {
      // the enter slot (+0xc) of state 2 / 3, FUN_00537e70 / FUN_005380a0: FUN_0032a0f8(CAM, 0, 0)
      // (traced: cam_j_gun f82)
      if (ctrl.weapon) ctrl.weapon.enterFoot();
    }
    return st;
  }

  motionId(ctrl) {
    if (this.motion) return this.motion.id;
    return ctrl.P.state === ST.FALL ? 0x22 : 3;
  }
  get active() { return !!this.motion; }
  get frozen() { return !!(this.motion && this.motion.freeze); }

  // FUN_00333150's ✕ branch, before the stick writes (the state may become 8 here).
  // opts: canJump's env ({ ladder, ... }) and startJump's options.
  takeOff(ctrl, cross, opts = {}) {
    if (!opts.force && !canJump(ctrl, this.motionId(ctrl), { pressed: cross, ...opts })) return null;   // force: FUN_005763b8 calls FUN_00575768 itself
    const prevMotion = this.motionId(ctrl);
    const st = startJump(ctrl, prevMotion, opts);
    if (st === null) return null;
    // FUN_00537d58 (from 2) / FUN_00538a30 (from 8): 8, 0x1f -> motion 0x20; 0x20, 0x21 -> 0x59
    // GUESS: from states 9 and 0x20 the same mapping (their vt+0x24, 0x538bd8 / 0x53a478,
    // not read; see notes/jump-research.md)
    // FUN_00575768's end, every take-off: CAM+0x1e8 &= ~2 and FUN_00329ff0(CAM, 0) (flag 2 and the
    // target-lock bit 0x10000 / CAM+0x1e3: neither is set on the page), then FUN_0032a0f8(CAM, 1, 0)
    // when P+0x2a8 bit 0 (the gun is drawn): the eye offset starts its blend (aim_core camJump)
    if (ctrl.weapon && ctrl.weapon.drawn()) ctrl.weapon.camJump(true);
    const second = st === ST.JUMP2 || st === ST.BACK2;
    this.motion = (st === ST.BACK || st === ST.BACK2) ? new BackJumpMotion(second) : new JumpMotion(second);
    this.events.push({ frame: ctrl.frames, ev: 'jump', state: st });
    return st;
  }

  // the motion-state update (before FUN_0034ea18). Returns this frame's clip requests, already
  // applied to the head-layer clock. this.head: the jump's motion states own the head layer
  // this frame (from the take-off until the frame the landing motion ends; the locomotion
  // choice takes over on the next frame).
  motionUpdate(ctrl, opts = {}) {
    const reqs = [];
    this.head = !!this.motion;
    if (this.motion) {
      const io = { ground: ctrl.onGround, clipEnded: this.clock ? this.clock.ended() : true,
                   armed: !!opts.armed, aimChanged: !!opts.aimChanged, groundSpeed: ctrl.C.groundSpeed,
                   headClip: this.clock ? this.clock.clip : null, headBlending: this.clock ? this.clock.blending() : false };
      if (opts.usable) io.usable = opts.usable;
      if (ctrl.jumpSound) io.sound = ctrl.jumpSound;      // the jump classes' sounds (play.js; worker 0277)
      io.C = ctrl.C;                                      // the death class's FUN_00353418 (C+0x214)
      io.ctrl = ctrl;                                     // class 0x35's mover 9 (player.js knockBack)
      io.dead = !!(ctrl.hpZero && ctrl.hpZero());
      io.side = ctrl.P.revSide ?? 0;
      io.rem = this.clock && this.clock.frames[this.clock.clip] !== undefined ? 2 * this.clock.frames[this.clock.clip] - Math.trunc(f32(2 * this.clock.frame)) : 1e9;   // FUN_00342f50
      io.above = ctrl.body ? f32(ctrl.body.gy - ctrl.pos.y) : 0;   // FUN_00359050 (the knock-down's class 0x34)
      const out = this.motion.update(io);
      reqs.push(...out);
      if (this.motion.done) {
        // the done flag sends the class's id to the state handler (FUN_00341af0, stateEvent above)
        // (FUN_00343160 sends it once per class: C+0x564 bit 0x20; the held death class doesn't send it again)
        const m = this.motion, st = (m instanceof DeathMotion && m.held) ? 0 : this.event(ctrl, m.id);
        if (st) {
          // the state changed: FUN_00343160 drops the class's own next motion (lVar13 = 0)
          // 0x38 / 0x39 / 0x3a set C+0x564 bit 0x80 at their end (FUN_0059d4c0, FUN_0059d788, FUN_0059dae8): FUN_00343160's loop runs the next class in this frame;
          // 0x33 / 0x34 / 0x35 don't: it runs in the next (T w255_phoenix_air 857 / 800-801, w255_knock_air 140-141, 227-228, w255_knock_run 211)
          if (this.motion instanceof KnockMotion && (m.id === 0x38 || m.id === 0x39 || m.id === 0x3a)) reqs.push(...this.motion.update(io));
        } else if (m instanceof AirFireMotion) {
          // FUN_00538aa0 answers 0x4e with 0 while airborne; the class returns 0x22: the fall class
          // runs from the next frame (aim_g: FUN_00599820's FUN_005ae618(MP, 2) shows at f49)
          this.motion = new FallMotion(0x4e);
        } else if (m instanceof KnockMotion) {
          // 0x36 ends with no next class: it holds. 0x37's next: FUN_00341b20, the locomotion classes.
          if (m.next === 3 && m.rootMotion) ctrl.C.slide = null;   // leave 0x59d078: FUN_003472c0(C, 0)
          this.motion = m.next == null ? (m.held = true, m) : m.next === 3 ? null : new KnockMotion(m.next, m.id);
          if (m.next == null) { m.done = false; m.phase = 2; }
          else if (this.motion && (m.id === 0x38 || m.id === 0x39 || m.id === 0x3a)) reqs.push(...this.motion.update(io));   // bit 0x80, as above
        } else if (m instanceof ReviveMotion) {
          this.motion = null;                             // FUN_0059dd48 returns class 3 when the state handler changed nothing
        } else if (m instanceof LandMotion) {
          this.events.push({ frame: ctrl.frames, ev: 'loco', next: m.next });
          this.motion = null;                             // back to the locomotion clips (class 3 / 6 / 8 / 9)
        } else if (m instanceof DeathMotion) {
          // state 7 answers 0 (FUN_00538780). The class returns next motion 0xd (the corpse class FUN_00595ea8, c_sq_fa0),
          // but from class 0xb it never starts (0xd itself runs only for a kill while lying, jumptable 0x589e70[7]): T w181_death_aim_b, the done event at f1004 sets C+0x564 bit 0x20 and it
          // stays set to f1647 (FUN_00341780 would clear it), the head layer holds c_st_fa0 at 128.
          // GUESS: no next motion; the death class stays, done, and the clip holds its last frame (why FUN_00343160
          // doesn't switch is not decoded; notes/fidelity-audit.md "Vincent at HP 0")
          // T w255_phoenix: P+0x118 bit 0x100 rises with this done event (record 1004): FUN_00538780's corpse-settled bit,
          // which FUN_00334590 case 5 waits for; state 0x16's leave FUN_00539aa8 clears it (Jump.enter)
          if (!m.held) { m.held = true; ctrl.P.settled = true; this.events.push({ frame: ctrl.frames, ev: 'death done' }); }
          if (m.id === 0xd) stopMove(ctrl.C);             // FUN_00538780, event 0xd (T w255_lying_nostatus: the corpse lies still)
        }
      }
    } else if (!opts.action && onFoot(ctrl.P.state) && !ctrl.onGround) {
      // the locomotion classes (stand 3 FUN_00593e70, armed stand 6 FUN_00594978, walk / run 8 / 9
      // FUN_00594f98) set their done flag when C+0x1c0 bit 0x200 is clear: a walk-off or drop.
      // (The stand class tests it from its second frame, phase 1; the page has no locomotion
      // classes, so it tests every frame: different only when the ground goes on a stand's first frame.)
      this.event(ctrl, this.motionId(ctrl));
    }
    if (reqs.length) { if (!this.clock) this.clock = new ClipClock(); this.clock.apply(reqs); }
    return reqs;
  }

  // FUN_00577480 (a shot fired, in FUN_00579570) -> FUN_00560b58(P, 1), its airborne branch: in
  // states 8, 9, 0xf, 0x10, 0x1f-0x21 (FUN_0055aa88) the motion becomes 0x4e (FUN_00341780: the
  // old class's exit, e.g. FUN_00598ee8, clears the wind-up freeze; C+0x79c &= ~0xc0, so the
  // second jump's bit 0x20 stays); from the back jump (0x20 / 0x21, FUN_0055aaa8) the state
  // becomes 9 first. Call it after the weapon step, before motionUpdate (the game's order:
  // FUN_005786e8 runs FUN_00579570 before the character's motion update), so the new class's
  // phase 0 runs this frame (aim_g f48). Not ported: the P+0x100 bits 40-41 = 1 branch (motion
  // 0x11; the bits are 0 in the save state) and the ground branch (aim.js's stand-fire class).
  airShot(ctrl) {
    const st = ctrl.P.state;
    if (!(st === 8 || st === 9 || st === 0xf || st === 0x10 || (st >= 0x1f && st <= 0x21))) return false;
    if (st === ST.BACK || st === ST.BACK2) enterState(ctrl.P, ST.FALL);                 // FUN_0055b8e0(P, 9, 0, 0)
    this.motion = new AirFireMotion();
    this.events.push({ frame: ctrl.frames, ev: 'airShot' });
    return true;
  }

  // FUN_0055b8e0(P, 9, 1, 0), param_3 = 1 (weaponSwitch): the handler is FUN_00537a58(0) (the state
  // table's entry 0, vtable 0x58aec0), whose +0x24 slot FUN_00537cc0 -> FUN_00537aa0 gives state 9's
  // motion from the jumptable 0x589e70[9] (0x537b34: li v0, 0x22). FUN_005641c0(P, 0x22, 1) then sets
  // it even when it is already the motion (FUN_00341780(C, 0x22, 0)): a fresh fall class whose
  // previous motion is the old one. From the wind-up the jump class's exit clears the h_jp0 freeze
  // (cam_j_draw_windup: h_jp3_a and the rise start 2 frames early); mid-air it swaps h_jp3 for the
  // fall class's h_jp3_a.
  forceFall(ctrl) {
    this.motion = new FallMotion(this.motionId(ctrl));
    this.events.push({ frame: ctrl.frames, ev: 'forceFall' });
  }

  // FUN_005aa5b8's advance of the head layer (held after landing until the locomotion clips take over)
  advance(step = JUMP.STEP) { if (this.clock) this.clock.advance(step); }

  // one game frame. input: PlayerController.step's input; cross: ✕ pressed this frame.
  // opts: canJump env plus { armed, aimChanged }. Returns the clip requests of the frame.
  frame(ctrl, input, cross, opts = {}) {
    // FUN_00333150: ✕ first, then the stick (the state may have just become 8)
    this.takeOff(ctrl, cross, opts);
    ctrl.stickInput(input);
    stickMode(ctrl, { x: input.x || 0, z: input.z || 0, mag: input.stick ?? Math.hypot(input.x || 0, input.z || 0) });
    ctrl.intent(false);                                   // player.js airIntent applies backTurnFix's negation itself
    const reqs = this.motionUpdate(ctrl, opts);
    if (!this.frozen) { ctrl.moveTick(); ctrl.rotate(); }   // FUN_0034ea18 (C+0x1c0 bit 0x20)
    this.advance();
    ctrl.frames++;
    return reqs;
  }
}
