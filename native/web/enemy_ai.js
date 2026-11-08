// Enemy AI for z128's soldiers (e027, e048) and the e030s: wake by trigger volume + event script, and the awake
// combat AI (brain modes 1 / 2, combat layer 2, fire timer, shot, bullet, damage to Vincent), and
// Vincent's bullets hitting them (pellets, spread, part boxes, damage, flinch / death; §13).
// A direct translation of the game's functions (addresses cited per function); decode notes
// notes/enemy-research.md §8 / §9, hook patch for play.js / enemies.js notes/enemy-ai-hook.md.
// Pure logic: no three.js. Tested against PCSX2 traces by test_enemy_ai.mjs.
//
// Types (notes/enemy-ai-hook.md "Other types"): every z128 placement is the same actor class (vtable
// 0x58e1f8, constructor FUN_00558790; save state: all 215 enemy / NPC objects), so the brain, the
// layers, the part test vt+0x17c FUN_0055bda8 and the damage path are shared code. What differs per
// type is data: the stance FUN_00564228 picks by model name at activation (C+0x664; its flags
// C+0x808 and motion -> clip rows C+0x7fc from the stage's 'bmd' table, ai.json stances), the actor
// size from the zone header (FUN_00563fc0, ai.json sizes), the part boxes (model 'mkd'), the zones,
// HP, weapon. AI_TYPES lists the types an activation builds an actor for.
//
// Data (gitignored, tools/byo/build_web.sh): data/enemies/ai.json from
// native/assets/models/export_web_triggers.py (stage file sections 1, 2/3, 8; e027 clip lengths).
//
// Frame order inside one game frame (GUESS: the game's top-level object/AI/body update order
// is not decoded; this order reproduces k_enemy_engage7/8, see notes/enemy-ai-hook.md):
//   1. AI scheduler FUN_00365008 (AIs FUN_00365110, then the fire timer FUN_003656a0)
//   2. bullets FUN_005549f0 (a bullet spawned in step 3 is first updated next frame)
//   3. bodies: motion state update (class 0xe FUN_00596460; spawns the bullet)
//   4. object messages queued last frame delivered (FUN_0053e9e0's consumer, not decoded; the
//      trace: #67 re-queued with interval 15 on the wake frame, so after the AI step)
//   5. player moved -> trigger volumes FUN_005517a8(old, new) (they queue the wake messages)

import { cylinderHit, cylinderCross, partTest, cone, fatCapsuleHit } from './enemy_hit.js';
import { objectPass } from './obj_contact.js';
import * as PM from './path_mover.js';
import * as NG from './nav_graph.js';
import { floorHit } from './effects.js';
import { aiPaused } from './game_state.js';
import { createBoss } from './boss_io.js';
// PS2 FPU rounding toward zero for a stored f32 (player.js chop; not imported: player.js needs three.js)
const _cb = new DataView(new ArrayBuffer(4));
export function chop(x) {
  const r = Math.fround(x);
  if (!(Math.abs(r) > Math.abs(x))) return r;
  _cb.setFloat32(0, r); _cb.setInt32(0, _cb.getInt32(0) - 1);
  return _cb.getFloat32(0);
}

// ---------------------------------------------------------------- constants
// Enemy weapon W (status +0xac) = stage section 24 record (FUN_00318610 / FUN_00311600), index by
// FUN_00318718: from ai.json (export_web_triggers.py: data.weapons, data.records[k].weapon).
// Actor size (decoded, FUN_00563fc0): radius actor +0x2c = zone header +0x20 x 0.5, height +0x30 = header
// +0x24, from ai.json sizes[record.zones] (e027 / e048 5 / 18, e030 6 / 12; save state values). These two
// are the fallback for an old ai.json without sizes. R_PLAYER: Vincent's +0x2c in FUN_0035e830's
// AI+0x38 = AI+0x34 - both radii: 10 - 5 (k_enemy_engage8) = 5.
export const R_ACTOR = 5.0;
export const EYE_H = 18.0;
export const R_PLAYER = 5.0;
// The types whose actor this module builds at activation (the per-type dispatch; FUN_00559748 builds
// one for every type). e027 / e048 (stance 0x1f / 0x1e, flags 0x872b: brain 2 shooter branch) run the
// whole translated AI; e030 (stance 0x23, flags 0x8c44: bit 0 clear) takes brain 2's states 7 / 8
// (melee attacks, not translated: it stands) but is hit, flinches and dies like the others; its own script (222) puts it in
// brain mode 3 (FUN_00361690, brain3: chase and attacks; worker 0252). Other types
// (e036, e023, e024, e001) are drawn by enemies.js without an AI actor.
export const AI_TYPES = new Set(['e027', 'e048', 'e030']);
// worker 0230: e036 (record 80). FUN_00564228 has no case for 'e036' (0x65303336 falls through to the weapon-class rule, as
// e027 / e048): weapon 8 class 2 -> stance 0x1e (m_* rows), flags 0x872b (brain 2 shooter branch). So it runs e027's whole AI.
AI_TYPES.add('e036');
// worker 0230: e001 (record 1, stance 0x10, the a_* rows) and e023 (records 31 / 87, the helicopter: stance 0x19, row 0 / 1 'idle')
// get the same actor (FUN_00559748 builds one for every type); their records' brain mode is 0 (class 0x4a2430, empty update), so
// what they do comes from their scripts (cmds 0x113 / 0x19e / 0x131 / 0x141 ...) and the shared body / hit / death code.
// Not traced (no route state reaches their fights): notes/other-types.md.
AI_TYPES.add('e001'); AI_TYPES.add('e023');
// worker 0235: e024 (the z128 boss, record 32) gets the same actor; its brain is the overlay's (AI mode 0x100, boss_io.js)
AI_TYPES.add('e024');
// worker 0228 (notes/npc-research.md §8): the townspeople. The same actor class 0x58e1f8, so an activation builds the same
// actor + AI (FUN_00559748 -> FUN_00365c50; T: w223_npc95 AI mode 0 after the wake). Brain mode 0 (their section-1 +8) is
// class 0x4a2430, update FUN_003614b0 = `jr ra` (empty): what they do comes from their scripts (cmds 0x141 / 0x131 / 0x16a /
// 0x109, events 3 / 2 / 0x13 / 0x14 / 0x17) and the shared body, hit and death code. Not the WRO men (n017 / n018 / n022):
// their rifles (weapon 9) are not exported, so they stay body-only (npcBodies).
export const NPC_TYPES = new Set(['n023', 'n024', 'n025', 'n026', 'n027', 'n028', 'n029', 'n030', 'n031', 'n032', 'n033', 'n034']);
// The MP layer push drops a request whose flags have bit 0x80 while the top layer ((MP+0x448 + MP+0x449 - 1) & 7,
// layer count MP+0x449 >= 1) already plays it: a plain request (FUN_003456c0 -> FUN_005a91c8) compares the
// clip (+0x200), and stores partner +0x208 = 0; an aimed set (FUN_00345818 -> FUN_00344bd0 -> FUN_005a9398)
// compares the clip and the partner. top = { clip, partner } (null = no layer); partner null = 0.
// T: k_fire_emp15 #67 plain r_st_a f796 then aimed r_st_a f804: both pushed (test_enemy_ai); w159_walk95 path
// end: table r_gst, then motion 3's plain r_gst dropped (test_path_walk). enemies.js pushes only when false.
export const mpDrops = (flags, top, clip, partner = null) =>
  !!(flags & 0x80) && !!top && top.clip === clip && (top.partner ?? null) === (partner ?? null);
// FUN_00346860's choice of the locomotion table entry (C+0x5f4, n entries, thresholds thr = C+0x600 / +0x618):
// speed C+0x1d8 at or below max(thr0, 0.01; 0.75 with C+0x564 bit 0x800) -> 0; at or below thr1 (- 0.1 while
// entry 2 plays: hysteresis) -> 1; else the last. cur = C+0x659 (-1 none).
export function locoChoice(speed, thr, n, cur, f564) {
  const t0 = (f564 & 0x800) ? f(0.75) : f(0.01);
  const hyst = cur === 2 ? f(-0.1) : 0;
  let i;
  if (speed <= (thr[0] < t0 ? t0 : thr[0])) i = 0;
  else if (speed <= f(thr[1] + hyst)) i = 1;
  else i = n - 1;
  if (n <= i) i = n - 1;
  return i;
}
// FUN_00346c10 -> FUN_003453e0: MP+0x40c = r x 0.5, r = speed / root speed (C+0x65c) clamped to C+0x770 / +0x774
// (0.9 / 1.0) for the run entry (2, with C+0x564 bit 3), else C+0x768 / +0x76c (0.1 / 1.1); those four are the
// body constructor's FUN_0033ff18 constants. Then a floor: C+0x564 bit 0 -> 1.0 (run) / 0.5; else none with bit
// 0x800, else 0.5. Root speed 0 -> r 1.0.
export function locoRate(speed, root, cur, f564) {
  const run = (f564 & 8) !== 0 && cur === 2;
  let r = f(1.0);
  if (root) {
    const v = f(speed / root);
    const lo = run ? f(0.9) : f(0.1), hi = run ? f(1.0) : f(1.1);
    r = v < lo ? lo : v > hi ? hi : v;
    const floor = (f564 & 1) ? (run ? 1.0 : 0.5) : (f564 & 0x800) ? null : 0.5;
    if (floor != null && r < floor) r = f(floor);
  }
  return f(r * 0.5);
}
// FUN_00345448 -> FUN_005a8fd0: a table switch starts the new clip at the old head's frame:
// min(max(2 frame, 0), 2 n - 1) / 2 (n = the new clip's frame count). enemies.js (C.reqCarry).
export const carryFrame = (frame, n) => Math.min(Math.max(frame * 2, 0), n * 2 - 1) * 0.5;
// Vincent's vt+0x5c = FUN_00563720: C+0x765 != -1 -> the world position of bone C+0x765 (FUN_0054a768, row 3);
// C+0x765 = 3 for Vincent (save RAM; T: the k_bullet1 f786 aim = bone 3 of the traced pose, 0.000 u). Needs his
// skeleton (world.playerBoneWorld, set by the page). PLAYER_AIM_H is the fallback without one (headless tests):
export const PLAYER_AIM_BONE = 3;
export const PLAYER_AIM_H = 12.4; // GUESS (fallback only): feet - 12.4 up when no pose is given (trace AI+0x40 at f784)
// Vincent's status fields read by FUN_00318120 (defence), and the game globals it reads. GUESS:
// values read from the sea-of-flames save state's RAM (P status = P+0x17c); their source on the
// disc / in the save file is not decoded. lvl +0x11 4, +0xc0 armour record 0, +0x60 0x8233,
// +0x27 0, +0x64 0, his weapon W+0x68 0 (export_web_aim.py compose() of the save's parts),
// FUN_00317630 0, param set +0x9c 0. With them a 45 shot does 44 (trace f789 / f1011).
export const PLAYER_STATUS = { lvl: 4, armour: null, f60: 0x8233, f27: 0, f64: 0, u20top: 0, w68: 0, b317630: 0, elem9c: 0,
                                b10: 2, f118: 0 };   // status +0x10 (FUN_005405b0's level term; 4.8 / 1.028 = the k_hits12 cone angle), actor +0x118
// GUESS (save RAM): G = *DAT_0046dd68: G+0x60 story progress 20, G+0x14 table +0x270 level factors,
// +0xaa / +0xae / +0xb2 difficulty cuts; DAT_004b8ac8 option bits 0, DAT_0046b328 1, DAT_0046b2fc 2.
// ELF data: DAT_0046e220 {0, 50} (level factors before progress 7), DAT_004a02b0 element factors.
// Offence (FUN_00317ef0, save RAM): G+0x14 +0x278 / +0x280 level factors, +0xa8 / +0xac / +0xb0 cuts,
// DAT_0046e248 +0x24 = 60 (+0x44 = 0, FUN_003212a8).
export const GAME = { progress: 20, lvlK: [0.33, 0.4], lvlK0: [0, 50], cut: { aa: 0, ae: 20, b2: 100 },
                      offK: [0.75, 0], offK2: [0.27, 1.4], cutO: { a8: 0, ac: 0, b0: -50 }, d46e248: 60,
                      bits4b8ac8: 0, d46b328: 1, d46b2fc: 2, elem: [1, 0, 0.25, 0.5, 2], armour: null,
                      // T = G+0x14: +0xd0 / +0xd4 spread distance classes, +0x268 the spread level factors (FUN_0031cf08)
                      spreadD: [120, 380], spreadK: [0.15, 2.5] };
export const MANAGER_SHORT_18 = 1; // GUESS: manager short 18 (cmd 0x30); trace: script 108 event 2 took the mode-2 branch, so != 0
export const JITTER_ON = GAME.d46b2fc !== 0;   // FUN_00326500 = FUN_002424a0 = DAT_0046b2fc != 0 (notes §9.6)
// FUN_00573720 (player vt+0x18c, the deflect window): DAT_0046ee30 = 8 ticks, DAT_0046ee34 = 1.309 rad (ELF)
const DEFLECT_TICKS = 8;
// P+0x27c, the deflect window's start: FUN_00571ee8 (player constructor) sets -40; only Vincent's own melee
// (FUN_00569dc0 -> FUN_00573360, combo FUN_0056de80 / FUN_0056ec08) moves it, and the page has no melee for him.
const P27C_INIT = -40;
// P+0x280 (worker 0200): FUN_00571ee8 sets -DAT_0046ee28 = -15 (ELF word 15; the save RAM holds -15 at frame counter
// 1575, the page's S.mgr20 0), so the first hit always passes FUN_005720c8's gate
const HIT_FX_GAP = 15, P280_INIT = -HIT_FX_GAP - 1575;
// FUN_00348fe8 (FUN_00323128, after the object update) runs FUN_00343160 on each C object in the list *(DAT_0046f0e0
// + 8) -> C+0x550. The save's list (RAM): #66 (record 44), #88 (record 66), Vincent, 0x919d80, #67..#71 (records
// 45-49). Records listed here update before Vincent. GUESS: a record activated after the save joins after him (the
// list insertion is not read).
const C_BEFORE_PLAYER = new Set([44, 66]);
// Motion ids -> clip names: the actor's stance rows (C+0x7fc, ai.json stances; stance 0x1f: 0x40 = r_st_a,
// 0x57 = r_st_f as traced, notes §9.7). MOTION = stance 0x1f's two rows, the fallback for an old ai.json.
// Actor state -> body motion: setActorState / stateMotion (old state's class vt+0x24, ELF vtables; workers 0149 / 0150).
export const MOTION = { 0x40: 'r_st_a', 0x57: 'r_st_f' };
// FUN_00310c40 = G+0x64 (game progress; save RAM 48, worker 0149 notes/enemy-ai-hook.md). GUESS: the
// stagger comment (stagger()) reads it as < 27 in this save; the two reads disagree.
const G64 = 48;
const STANCE_1F_FLAGS = 0x872b;   // C+0x808 of stance 0x1f (trace k_enemy_engage8), for an old ai.json
// The page's save state: FUN_00242c28() = 1 (worker 0125, notes §9.11). Event flags: all 0 in the save (worker 0224:
// T w220_box / w224_item22, every zone flag is 0 until the pickup of section-15 record 22 sets flag 2 = 7 through
// Vincent's script 246 event 0x3a, items.js; ev0100's deb_jump then sets 46 = 1). The old { 2: 7, 46: 1 } was read in
// k_enemy_engage7, a run past that pickup (notes/enemy-activation.md §1).
export const SAVE_DIFFICULTY = 1;
export const SAVE_EVENT_FLAGS = Object.freeze({});
// FUN_00312678's value (DAT_0046dd68 + 0x7c; 0 in 0201's reload state): the blend of an actor's first clip after the
// stage-load pass (C+0x564 bit 0x20000000). GUESS: read from RAM, its writer is not decoded.
const BLEND_312678 = 0;
// Vincent's bullets vs the soldiers (notes/enemy-research.md §13). Hit-zone records (status +0xa8
// -> +0x30 -> 16 B per part, FUN_0055bda8): byte 0 = damage scale (x 0.05, FUN_0055d2c0) and ushort
// +2 flags (bit 1 no reaction flags, bit 2 no stagger, bit 3 bullet +0x120 |= 0x60000; FUN_0055db50).
// From the stage file: ai.json zones[record.zones] (export_web_triggers.py zone_set: FUN_003153d0 /
// FUN_00310e40 / FUN_0030fc68).
// Enemy status fields FUN_00318120 reads (§10.2, RAM of #67): armour +0xc0 none, +0x60 0, +0x27 0,
// +0x64 0, element 0; level +0x11 comes from ai.json (FUN_00314ea8). The save state has the same
// +0x60 (less the activation bits 0x41) / +0xc0 / +0x27 / +0x64 on every e027, e048 and e030 status.
// +0x10 = 0 (FUN_005405b0's level term: T, the e027 cone angle 24.390244 = 25 / 1.025 in every k_bullet call log).
export const ENEMY_STATUS = { lvl: 0, armour: null, f60: 0, f27: 0, f64: 0, u20top: 0, w68: null, b317630: 0, elem9c: 0, b10: 0 };
// GUESS: C+0x1c0 of a standing soldier (trace k_enemy_engage12 #67: 0x10301; bit 0x200 = on the
// ground, read by FUN_00565480). The page has no enemy physics, so it stays.
const C1C0_STAND = 0x10301;
// GUESS: the motion classes' motions. Class 0x1e (flinch, FUN_00561718 stance 0) and the death motion
// (class 0x36 after FUN_0055b8e0(actor, 7)) pick a motion by hit side / part; that choice is not
// decoded. The traces show r_stlld0 (flinch, part 10), r_stlaf0 (death, part 6) and r_stbf0 (death,
// part 0 = head) = stance 0x1f rows 0x28 / 0x2c / 0x2b: head -> 0x2b, any other part -> 0x2c. The
// clip name is the actor's own stance row (decoded): e048 with a w004 m_stlld0 ..., e030 stld0 / stbf0.
// worker 0259: the flinch's row, DECODED: FUN_00598950's jump table 0x5a3b10, by the hit area (FUN_0055d390); anything else: 0x25.
const LYING_DEATH_ROW = [0x37, 0x37, 0x36, 0x38, 0x39, 0x3a, 0x3b];         // DAT_005a39f0
const KNOCK_CLASS = new Set([0x33, 0x34, 0x1b, 0x38, 0x39, 0x35, 0x3a, 0x37]);   // worker 0259: the knock-down's motion classes (knockClass)
const FLINCH_ROW = { 1: 0x25, 2: 0x24, 3: 0x26, 4: 0x27, 5: 0x28, 6: 0x29 };
// worker 0259: the death row = the flinch's table + 6, by the hit area (C+0x590 low 4 bits, FUN_0055d390): L, the row's writer was not found (two attempts: the class's own row 0xac is not it). T: e027
// k_hits12 #66 area 3 r_stlaf0, #67 (area 5 -> 1 under the flinch's bit 0x10000) r_stbf0; e036 w259_e036 f162 area 5 m_stllf0. No area yet (a kill that never ran FUN_0055d390): the table's default + 6 = 0x2b, whatever the part (T w259_hit_soldier #70, part 10: m_stbf0; w259_hit_npc 114 / 113: dead1).
const deathMotion = (part, area) => (FLINCH_ROW[area] ?? 0x25) + 6;
const FALLBACK_CLIPS = { 0x28: 'r_stlld0', 0x2b: 'r_stbf0', 0x2c: 'r_stlaf0', 0x00: 'r_gst', 0x01: 'r_gst' };   // old ai.json: stance 0x1f rows
const ID_BASE = 22;               // GUESS: manager +0x3b2 table (cmd 0x3a): object id = record + 22 (trace meta EI0..6: rec 44 -> 66, 66 -> 88)

// ---------------------------------------------------------------- sound names (worker 0172)
// The ELF's name tables are game data: ai.json `se` (export_web_triggers.py se_tables): se.gun = 0x46e5b8 (FUN_0033d118 /
// FUN_0033d008), se.wall = 0x46e5f8 (FUN_0033d4e8, 3 per surface kind; the last 6 'on_v00n' rows are not reached from
// FUN_0033d528), se.mat_kind = FUN_0033d528's material -> kind table 0x4a1310 (14 words). Missing: no such sounds.

// ---------------------------------------------------------------- RNG FUN_0040b398 / 0040b500 / 0040b5c0
// The game's Mersenne twister (624 words at DAT_004fbe00, index DAT_004fc7c0). It returns the
// tempered *current* word, then twists that word in place.
export class GameRandom {
  constructor(seed = 0) { this.s = new Uint32Array(624); this.seed(seed); }   // GUESS: seed and call history at stage start unknown
  seed(p) {                                                                     // FUN_0040b398
    const s = this.s;
    s[0] = p !== 0 ? p : p + 1;
    for (let i = 1; i < 624; i++) s[i] = (Math.imul(s[i - 1] ^ (s[i - 1] >>> 30), 0x6c078965) + i) >>> 0;
    this.i = 0;
    for (let k = 0; k < 624; k++) this.twist(k);
    this.i = 0;
  }
  twist(i) {
    const s = this.s, n = i < 623 ? s[i + 1] : s[0];
    let y = ((s[i] & 0x80000000) | (n & 0x7fffffff)) >>> 1;
    if (n & 1) y ^= 0x9908b0df;
    s[i] = (y ^ (i < 0xe3 ? s[i + 397] : s[i - 227])) >>> 0;
  }
  next() {                                                                      // FUN_0040b500
    const i = this.i;
    let y = this.s[i];
    this.twist(i);
    this.i = i < 0x26f ? i + 1 : 0;
    y ^= y >>> 11; y ^= (y & 0x13a58ad) << 7; y ^= (y & 0x1df8c) << 15; y ^= y >>> 18;
    return y >>> 0;
  }
  rand() {                                                                      // FUN_0040b5c0
    const b = new DataView(new ArrayBuffer(4));
    b.setUint32(0, (this.next() & 0x7fffff) | 0x3f800000);
    return Math.fround(b.getFloat32(0) - 1.0);
  }
}

// ---------------------------------------------------------------- defence FUN_00318120
// Damage after the victim's defence. st: the victim's status fields (PLAYER_STATUS layout),
// raw: bullet +0x134, kind: FUN_00554738(bullet) (0 for an e027 bullet: flag 2 clear, W+4 bit
// 0x80000 clear). Float maths in single precision as the game's FPU; (uint) casts truncate.
const f = Math.fround;
export function defence(st, raw, kind, G = GAME) {
  if (kind === 3) return raw;
  let L = 0;
  const armour = st.armour;                                   // status +0xc0
  if (st.w68 != null && st.b317630 !== 2 && kind !== 2) L = st.w68;   // FUN_00317c70 W+0x68 (FUN_00317630 != 2)
  let noArmour = false, f60 = st.f60;
  if (!armour) {
    if (kind !== 2) L += Math.trunc(f(f(G.progress < 7 ? G.lvlK0[0] : G.lvlK[0]) * st.lvl + (G.progress < 7 ? G.lvlK0[1] : G.lvlK[1])) + 0.5);   // FUN_0031ce90
    noArmour = (f60 & 2) === 0;
  } else {
    const i = kind === 1 ? armour.u10 >>> 28 : kind === 2 ? armour.b14 >> 4 : armour.b14 & 0xf;
    L += G.armour[i];                                         // G+0x14 table +0x46c (s16)
  }
  if (L > 99) L = 99;
  let d = Math.trunc(f(f(f(raw) + 0.5) * f(100 - L) * f(0.01)));
  if ((f60 & 2) && !(f60 & 0x100)) {                          // difficulty cut
    let c = 0, ok = true;
    if (G.progress > 0x11) {                                  // FUN_00310c60
      const d242c28 = (G.d46b2fc !== 0 && G.d46b328 === 0) ? 1 : G.d46b328;   // FUN_00242c28
      if (G.d46b2fc === 0) c = d242c28;                       // FUN_00312698
      else c = ((G.bits4b8ac8 >>> 0x11) & 1) ? 0 : d242c28 - 1;   // FUN_002419d8(0x11)
      c = c === 1 ? G.cut.ae : (c < 2 || c > 3) ? G.cut.aa : G.cut.b2;
      c = -c;
      ok = c < 100;
    }
    if (!ok) c = 99;
    d = Math.trunc(f(f(f(d) + 0.5) * f(100 - c) * f(0.01)));
  }
  let immune = false;
  if (noArmour) {                                             // element FUN_0031d388 by param set +0x9c
    let u = st.elem9c;
    if (kind === 1) u >>= 3; else if (kind >= 2) u = (u >> 6) & 7;
    if (kind >= 0 && kind <= 3) {                          // FUN_00318120: negative kind skips the element step
      if (G.elem[u & 7] == null) throw new Error(`defence: element ${u & 7} past the 5-entry table DAT_004a02b0`);
      d = Math.trunc(f(f(d) * f(G.elem[u & 7]) + 0.5)); immune = (u & 7) === 1;
    }
  }
  if ((st.f27 & 0xf) === 1) d = Math.trunc(f(f(d) * f(0.2)));                    // FUN_003177a8
  else if ((st.f64 & 0x20) && st.u20top === 2) d = Math.trunc(f(f(d) * f(G.d46b2fc === 0 ? 0.33 : 0.2)));   // FUN_00317b68
  if (raw > 0 && d === 0) d = immune ? 0 : 1;
  return d < 10000 ? d : 9999;
}

// ---------------------------------------------------------------- small helpers
const short = v => (v << 16) >> 16;
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len3 = v => Math.hypot(v[0], v[1], v[2]);
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit3 = v => { const l = len3(v); return l ? [f(v[0] / l), f(v[1] / l), f(v[2] / l)] : v.slice(); };   // VU vrsqrt x vmulq

// FUN_00323318(r): per-frame fraction for a per-tick rate at step *(DAT_0046e290+4) (as player.js fracStep)
export function fracStep(r, step) {
  if (!(1.0 < step)) return f(r * step);
  let i = 1, k = 1.0;
  if (1.0 <= step) do { i++; k = f(k * f(1.0 - r)); } while (i <= step);
  return f(1.0 - k);
}

// Body yaw toward the aim target, one frame: FUN_0034de50 (from FUN_0034ea18) while C+0x214 = 6.
// Case 6: C+0x2c0 = unit(C+0x2b0 - C+0x30) (3D), C+0x2cc = 0.5; then LAB_0034e2f0: if the target
// is behind (face . dir <= -0.97) dir = row 0 (C+0x1c0 bit 0x40 clear: e027 0x10301), else dir as is;
// face = face + (dir - face) x FUN_00323318(0.5) (FUN_002611f4), unit; FUN_0034a5a8(C, 1) rebuilds
// the rows from the up row (0,-1,0): face loses its y and is renormalised (row 0 = up x face,
// row 2 = row 0 x up). Not taken: the rate-limited branch for C+0x45c bit 21 (FUN_0025a560 by
// C+0x478 x DAT_004eeb28); the lerp branch fits #66 / #67 per frame (test_enemy_ai 'facing').
// C+0x224 (the turn rate the motion code reads): path_mover.js turnRate.
// worker 0259: turnBody's step toward a direction (FUN_0034b638's rate; turnBody's 0.5)
export function turnToward(face, dir0, rate, step) {
  let dir = unit3([dir0[0], 0, dir0[2]]);
  if (!(-0.97 < dot3(face, dir))) dir = [f(-face[2]), 0, f(face[0])];
  const k = fracStep(rate, step);
  return unit3([f(face[0] + f(f(dir[0] - face[0]) * k)), 0, f(face[2] + f(f(dir[2] - face[2]) * k))]);
}
export function turnBody(face, pos, t2b0, step) {
  let dir = unit3(sub3(t2b0, pos));
  if (len3(dir) === 0) dir = face.slice();
  if (!(-0.97 < dot3(face, dir))) dir = [f(-face[2]), 0, f(face[0])];      // row 0 = up x face, up (0,-1,0)
  const k = fracStep(0.5, step);
  let v = unit3([0, 1, 2].map(i => f(face[i] + f(f(dir[i] - face[i]) * k))));
  v = unit3([v[0], 0, v[2]]);                                                 // FUN_0034a5a8 with up = (0,-1,0)
  return v;
}
// FUN_00353458(C) = FUN_00260e74(C+0x20, C+0x90, C+0x10): facing and move direction, both flattened against row 1 (0, -1, 0), the
// angle between them, negative when (face x dir) . row 1 < 0. Facing +z with the move at +x: negative.
export function moveAngle(face, dir) {
  const a = unit3([face[0], 0, face[2]]), b = unit3([dir[0], 0, dir[2]]);
  if (len3(b) === 0 || len3(a) === 0) return 0;
  const c = f(f(f(a[2] * b[0]) - f(a[0] * b[2])) * -1.0);
  const d = dot3(a, b), ang = f(Math.acos(d < -1 ? -1 : d > 1 ? 1 : d));
  return c < 0 ? -ang : ang;
}
// row-vector transform (PS2 / VU convention: p' = [x y z 1] . M, row 3 = translation)
const xform = (m, p) => [0, 1, 2].map(c => p[0] * m[0][c] + p[1] * m[1][c] + p[2] * m[2][c] + m[3][c]);

// FUN_00261218: point inside a box
function inBox(p, lo, hi) {
  return p[0] >= lo[0] && p[0] <= hi[0] && p[1] >= lo[1] && p[1] <= hi[1] && p[2] >= lo[2] && p[2] <= hi[2];
}
// FUN_00550918 stand-in: segment a->b crosses the box (slab test). GUESS: the game's returned
// face index (passed as event arg r0) is not decoded; this returns 0 on a hit, -1 on none.
function segBox(a, b, lo, hi) {
  let t0 = 0, t1 = 1;
  for (let k = 0; k < 3; k++) {
    const d = b[k] - a[k];
    if (Math.abs(d) < 1e-12) { if (a[k] < lo[k] || a[k] > hi[k]) return -1; continue; }
    let u = (lo[k] - a[k]) / d, v = (hi[k] - a[k]) / d;
    if (u > v) [u, v] = [v, u];
    t0 = Math.max(t0, u); t1 = Math.min(t1, v);
    if (t0 > t1) return -1;
  }
  return 0;
}

// FUN_0025e400(out1, out2, a, b, lo, hi): clips the segment a..b to the box, low planes then high
// planes per axis (x, y, z). Returns the face where b was clipped (2 x axis low, 2 x axis + 1 high), -1
// when b was not clipped or the clipped segment misses the box (FUN_0025f638 on both ends); p2 = the
// clipped b (a and b themselves when it misses).
function clipSeg(a, b, lo, hi) {
  let p1 = a.slice(0, 3), p2 = b.slice(0, 3), face = -1, ax1 = -1, ax2 = -1;
  const lerp = (t, u, v) => [0, 1, 2].map(k => f(u[k] + f(f(v[k] - u[k]) * f(t))));   // FUN_002611f4
  for (let k = 0; k < 3; k++) {
    const v = lo[k];
    if (v <= p1[k] || p2[k] < v) {
      if (p2[k] < v && v <= p1[k]) { p2 = lerp(f(f(v - p1[k]) / f(p2[k] - p1[k])), p1, p2); face = k << 1; ax2 = k; }
    } else { p1 = lerp(f(f(v - p1[k]) / f(p2[k] - p1[k])), p1, p2); ax1 = k; }
  }
  for (let k = 0; k < 3; k++) {
    const v = hi[k];
    if (p1[k] <= v || v < p2[k]) {
      if (v < p2[k] && p1[k] <= v) { p2 = lerp(f(f(v - p1[k]) / f(p2[k] - p1[k])), p1, p2); face = 2 * k + 1; ax2 = k; }
    } else { p1 = lerp(f(f(v - p1[k]) / f(p2[k] - p1[k])), p1, p2); ax1 = k; }
  }
  if (!inBoxBut(p1, lo, hi, ax1) && !inBoxBut(p2, lo, hi, ax2)) return { face: -1, p1: a.slice(0, 3), p2: b.slice(0, 3) };
  return { face, p1, p2 };
}
// FUN_0025f638(p, lo, hi, axis): p inside the box on the two axes other than `axis` (all three for -1;
// the last test of the 3-axis form is strict on z's high side)
function inBoxBut(p, lo, hi, axis) {
  if (axis === 0) return !(p[1] < lo[1] || p[2] < lo[2] || hi[1] < p[1] || hi[2] < p[2]);
  if (axis === 1) return !(p[0] < lo[0] || p[2] < lo[2] || hi[0] < p[0] || hi[2] < p[2]);
  if (axis === 2) return !(p[0] < lo[0] || p[1] < lo[1] || hi[0] < p[0] || hi[1] < p[1]);
  return lo[0] <= p[0] && lo[1] <= p[1] && lo[2] <= p[2] && p[0] <= hi[0] && p[1] <= hi[1] && !(hi[2] < p[2]);
}

// ---------------------------------------------------------------- the world
// createEnemyAI(opts):
//   data    ai.json (export_web_triggers.py)
//   player  { pos:[x,y,z], hp, id: 0x16, f118: 0, s64: 0 }   (P status +0x20 HP; logged on change)
//   rand    () => [0,1): FUN_0040b5c0 (default: GameRandom(0))
//   los     (a, b) => true when the probe-3 ray a->b is blocked (FUN_005449f0). Default: never
//           blocked (GUESS until the page passes its room collision ray).
//   damage  false: the soldiers' bullets still hit Vincent (and stop) but do no damage (an option, the
//           page's ?enemydmg=0; default true = the game). Melee hits always damage.
//   roomRay (a, b) => hit point | null: the stage ray FUN_0026a320(a, b, 0x18d) (the page: collision.js
//           segment with probeSet(0x18d)). Without it bullets pass walls (warned once).
//   spreadRand  () => [0,1): the cone's two draws (FUN_0025a058); default the shared rand. Tests feed
//           the traced draws (the k_bullet call logs log only the cone's own draws).
//   playerBoneWorld () => (bone) => rows | null: Vincent's posed skeleton as the game has it when the
//           bullets update (the last drawn pose, his start-of-frame matrix). Also settable on the world.
//   log     (msg) => void
//   difficulty  FUN_00242c28() (default SAVE_DIFFICULTY = 1: manager 0xa6 / 0xa7 are false)
//   eventFlags  {N: value} event flags (FUN_003ff738, manager cmd 0xc); default SAVE_EVENT_FLAGS
//   deadRecs    section-1 records whose status is dead at the start (the save: 41-43); FUN_00559748
//               refuses to activate them
//   onActivate  (record, actor|null) => void: a section-1 record was activated (cmd 0x108 ->
//               FUN_00559748). actor = the AI actor (e027 only); null for other models (their
//               bodies / AIs are not exported yet). Also listed per frame in `activated`.
//   onDeactivate (record) => void: cmd 0x109 / 0x130 turned an active record off.
export function createEnemyAI(opts) {
  const data = opts.data;
  if (!data || !Array.isArray(data.weapons) || !Array.isArray(data.records)) throw new Error('ai.json has no weapons / records (old export: rebuild data/enemies)');
  const P = opts.player;
  const rng = opts.rand || (() => (opts._rng || (opts._rng = new GameRandom(0))).rand());
  const los = opts.los || (() => false);
  const viewRay = opts.viewRay || (() => false);   // manager cmd 0xab's map ray (play.js: probe word 0x187)
  const log = opts.log || (() => {});
  const warned = new Set();
  const warnOnce = m => { if (warned.has(m)) return; warned.add(m); log(m); if (typeof console !== 'undefined' && !opts.quiet) console.warn(m); };
  const DAMAGE = opts.damage !== false;
  const spreadRand = opts.spreadRand || rng;
  let pStart = null;                                                          // Vincent's start-of-frame position (tick)
  if (P) P.t27c ??= P27C_INIT;                                                // P+0x27c (FUN_00571ee8)
  if (P) P.t280 ??= P280_INIT;                                                // P+0x280 (FUN_00571ee8): the hit flash gate
  // P+0x148 / +0x150 / +0x152 / +0x150 bits 40-43: the stagger time and sums (save RAM: -120 / 0 / 0 / phase 0;
  // the frame counter DAT_0046e938+0x20 is 1575 there, so the first gap is >= 60 either way; as P+0x27c's -40)
  if (P) { P.s148 ??= -120; P.s150 ??= 0; P.s152 ??= 0; P.sphase ??= 0; }
  // FUN_00565480 on Vincent (player.js hitReact via play.js): (h) => branch name; none = no reaction
  const playerReact = opts.react || null;
  // C+0x590 & 0xf (Vincent's hit side: written by FUN_0055d678, read by the death class FUN_00595a60). play.js
  // passes { get, set } on his C (player.js setHitSide); without it (tests) the side lives here.
  const hitSideIO = opts.hitSide || (() => { let v = 0; return { get: () => v, set: x => { v = x; } }; })();
  // sounds (worker 0172; audio.js SoundEmitters.play): sound(name, pos, range) at the game's call sites; pos null =
  // at the sound camera (FUN_0033cbd8). Names come from the weapon data (ai.json se_*) and the ELF tables below.
  const sound = opts.sound || (() => {});
  const SE_T = data.se || null;
  const seName = (tab, i) => {
    if (!SE_T) { warnOnce('enemy_ai: ai.json has no se tables (ELF sound names): rebuild data/enemies; no gun / wall sounds'); return null; }
    return (SE_T[tab] && SE_T[tab][i]) ?? null;
  };
  const PST = opts.playerStatus || PLAYER_STATUS;
  const scripts = data.scripts;
  // Vincent as a script object (worker 0174). His own script P+0x34 (save RAM 246) and, when it has no such
  // event, his parameter set's (status +0x9c = section-0 record, save RAM 55) script at +0x7c (= 297): the actor
  // dispatch FUN_00568f98 (vt+0x2f4). ai.json player / pset_script (export_web_triggers.py).
  // MISSING: the same fallback for the soldiers (their parameter sets name scripts 291-296; runEvent skips it).
  // GUESS: script 246 / parameter set 55 are save-RAM values (not decoded how the game picks them; see
  // notes/audio-research.md "Vincent's hit voice", fidelity-audit "Vincent's script / cue table / C+0x810").
  const PLAYER_OBJ = P && data.player ? { kind: 'player', id: -1, script: data.player.script,
    fallback: (data.pset_script || [])[data.player.pset] ?? -1, get pos() { return P.pos; } } : null;
  // his cue table C+0x7ec = stage section 0x1a record C+0x766 (FUN_003405f8 -> FUN_003116d0).
  // GUESS: record 9 is the save-RAM value of C+0x766 (not decoded where it is set; same notes)
  const PLAYER_CUES = data.cues && data.player ? data.cues[data.player.cues] : null;
  // C+0x810: the frame of the last gated cue (FUN_003412d0). GUESS: save RAM 359 with the frame counter at 1575
  // (DAT_0046e880+0x20 = DAT_0046e938+0x20 = S.mgr20 here, which starts at 0); not decoded: FUN_003412d0 has
  // other callers that stamp it (fidelity-audit "C+0x810 stampers"), so its stage-start value is unknown.
  if (P) P.c810 ??= 359 - 1575;
  // manager shorts (+0x28, cmd 0x2f writes, 0x30 reads). GUESS: their values at stage start are not
  // decoded; short 18 = MANAGER_SHORT_18, the rest 0.
  const mshort = new Int16Array(0x100);
  // worker 0231: the HUD gauge request of manager cmds 0x6e / 0x6f / 0x70 (FUN_003b58e0: id, value, max, flag; +0xc59 shown)
  // and the boss overlay's plug-in (DAT_0046e590, set by Zone.boss: stage_controller.js -> world.setBossPlugin)
  const hudGauge = { id: -1, v: 0, max: 0, f: 0, c59: 0 };
  let bossPlugin = false;
  mshort[18] = MANAGER_SHORT_18;
  // manager +0x260: the position cmd 0x40 (a locator, FUN_0053d960) / 0x10f (the object's +0x90) write; 0x10e and the
  // gimmicks' 0x2a / 0x2b / 4 (props.js, through world.mgr260) read it. One field for both (worker 0212). L: its
  // stage-start value is not read (null until the first write; every z128 reader follows a 0x40 / 0x10f in its event).
  let mgr260 = null;
  // FUN_0053e1e0's tail writes 0xffff into the deleted object's id slot: manager +0x3b2[status slot] (records, cmd 0x3a),
  // +0x7b0[k] (triggers, 0x3d), +0x5b2[k] (gimmicks, 0x3e). The page's ids map one to one onto those slots, so the
  // freed ids are kept here and the lookups answer -1 for them.
  const freedIds = new Set();
  const slot = id => (freedIds.has(id) ? -1 : id);

  // AI scheduler (*DAT_0046f4e4): +0 clock, +8 step accumulator, +0x10 rays / +0x11 shots /
  // +0x12 runs / +0x13 total this tick, +0x20 AI queue (sorted by due), +0x2c fire timers.
  // mgr20 / mgr24 = DAT_0046e880 +0x20 / +0x24 (the same object as DAT_0046e938): ticks, and the step accumulator's fraction.
  // The page's 0 is the save's 1575; the save RAM's +0x24 is 0.5998749732971191 (sea-of-flames.p2s, worker 0230). A rebuilt
  // world passes its own (opts.mgr20 / opts.mgr24: checkpoint.js).
  const S = { mgr20: opts.mgr20 ?? 0, mgr24: Math.fround(opts.mgr24 ?? 0.5998749732971191), frame: 0, now: opts.now ?? 0, acc: opts.acc ?? 0, rays: 0, shots: 0, runs: 0, total: 0, q: [], timers: [] };
  const objects = new Map();    // object id -> actor or trigger object
  const actors = [];
  const bullets = [];
  let bulletIds = 0;                                                          // worker 0235: bullet object ids (the boss brain's shot slots)
  // Manager event queue (manager +0x1268 head / +0x126c tail, FUN_0053fbe8 appends {type, object id}),
  // drained in order by FUN_0053fde8 at the end of the manager frame FUN_0053b500 (switch on type + 1).
  const mgrQueue = [];
  const postManager = (type, id, arg = 0) => { mgrQueue.push({ type, id, arg }); };
  // Script-timer list (manager +0x1244 head / +0x1248 tail / +0x124c count): object ids with a running +0x3c / +0x3e
  // timer. FUN_0053e6e8 appends at the tail, FUN_0053e7a8 unlinks by id, FUN_0053e868 walks it from the head.
  // L: the node pool (+0x1240, FUN_00548eb0) never runs out on the page (the game's append can fail: cmd 0x106 then
  // sets nothing).
  const timerList = [];
  const mailbox = [];           // 0x101 messages posted this frame, delivered next frame (GUESS: FUN_0053e9e0 consumer not decoded)
  // worker 0230: the manager's delayed list (+0x1254, FUN_0053e9e0(mgr, id, code, delay, arg, 0): due = mgr +0x20 (S.mgr20, ticks) +
  // delay) for its negative codes, consumed by FUN_0053f040 (switch on code + 0xd3). Translated: the corpse chain -11 / -10 (below,
  // enemyDeath / delayedTick). The page's non-negative codes (0x101 messages) still go through `mailbox`.
  const delayed = [];
  const events = [];            // per-frame record of what happened (tests / page debug)

  // ------------------------------------------------ objects
  // Trigger volumes = section-8 objects; vars at +0xa0 (cmd 0x104 / 0x105, FUN_0054cd70).
  const triggers = data.triggers.map(t => {
    const o = { kind: 'trigger', id: 't' + t.idx, t, vars: new Int16Array(8), t3c: new Int16Array(2), flags28: 0, script: t.script };
    // FUN_005503e8 (shapes 0 / 8): flags +0xa4 bit 5 (0x20) -> +0x40 |= 0x10 (FUN_005511e8 runs event
    // 0x12), +0x38 |= 1 (bullets test it, FUN_005442d8) and +0x28 |= 0x100 (see-through: listed, not the
    // closest hit). Shape 3 clears +0x28 bit 8 and sets no +0x38 bit 0.
    o.shot = (t.shape === 0 || t.shape === 8) && !!(t.flags & 0x20);
    objects.set(o.id, o);
    return o;
  });
  // worker 0237: the stage object. FUN_0053c140 builds it first (FUN_0053db98 type 0xc, FUN_00589760; manager +0x10aa = its
  // id) and gives it script = stage section 4 +0x18 (FUN_00311038 -> FUN_0054e3d8; ai.json stage_script, z128: script 0).
  // It is on the manager's type-0xc list, so FUN_005459d8 sends it event 0x23 (first). GUESS: object id 'stage' (its slot
  // from FUN_0036e1f0(-1) is not read; no script names it by id). Without stage_script (an old ai.json) there is none.
  const STAGE_OBJ = data.stage_script >= 0
    ? { kind: 'stage', id: 'stage', script: data.stage_script, vars: new Int16Array(8), t3c: new Int16Array(2), flags28: 0 } : null;
  if (STAGE_OBJ) objects.set(STAGE_OBJ.id, STAGE_OBJ);
  else console.warn('enemy_ai: ai.json has no stage_script (re-export data/enemies): the stage object gets no event 0x23');
  const recById = id => data.records[id - ID_BASE];
  // FUN_00550ad8 (stage start, L: its caller is a vtable slot, not traced): each trigger object is
  // activated (+0x144(1)) unless its flags +0xa4 have bit 17 (0x20000); those wait for a script's
  // cmd 0x108 (manager 0x3d lookup). L: an inactive trigger runs no volume test (FUN_005517a8).
  for (const o of triggers) o.active = !((o.t.flags >>> 17) & 1);
  // FUN_005503e8 case 3 (+0xaa): +0x40 bit 2 with flags bit 3 (✕ can choose it), +0xe0 from record +0xb0 bit 0 (FUN_0057c698). Cases 0 / 8 the same bit (worker 0257: T r06_door2 trigger 12 +0x40 0x105)
  // FUN_005503e8: +0x40 bit 2 with flags bit 3 on shape 3, bit 3 or 4 on shapes 0 / 8; +0x4f = 1 on shape 3, 2 on shapes 0 / 8 (FUN_00544960's pick). +0xd0's bits 16-19 start at 0xf (FUN_00550228): r0 = -1 until a ray writes it
  for (const o of triggers) { const s = o.t.shape, fl = o.t.flags; o.use = s === 3 ? !!(fl & 8) : (s === 0 || s === 8) && !!(fl & 0x18); o.f4f = s === 3 ? 1 : 2; o.face = -1; o.e0 = s === 3 && (o.t.b0 & 1) ? 1 : 0; }
  // GUESS: trigger object id = 't' + index (manager +0x7b0 table, cmd 0x3d, not read; scripts only pass it on).
  // -1 once the trigger is deleted (FUN_0053e1e0: +0x7b0[k] = 0xffff; `slot`).
  const trigObj = k => triggers[k] ? slot(triggers[k].id) : -1;
  // Section-1 records exist as (inactive) objects from stage load; cmd 0x3a gives their id and
  // 0x101 / 0x108 reach them by it. addActor replaces the record object with the active actor.
  const DIFF = opts.difficulty ?? SAVE_DIFFICULTY;
  // the world's own copy: manager cmd 0xb writes it (FUN_003ff658; worker 0212); the caller's object stays as given
  const EVFLAGS = { ...(opts.eventFlags ?? SAVE_EVENT_FLAGS) };
  const deadRecs = new Set(opts.deadRecs ?? []);
  // DAT_0046e228 +0x290's words at +4 (FUN_0031e060 sets, FUN_0031e160 reads): the records FUN_00547ce0 zeroes at a stage load. In a
  // scene_save's record (FUN_0031d4d8), so they outlive a Restart from it; T w254: 41, 42, 43, 111, 113, 114 kept through the reload
  const deadBits = new Set(deadRecs);
  const onActivate = opts.onActivate || (() => {});
  const onDeactivate = opts.onDeactivate || (() => {});
  const activated = [];         // records activated this frame (tick clears it)
  // Status HP (+0x20) = max HP from the placement setup (FUN_00315050 / FUN_003151c8 -> FUN_00314ea8:
  // ai.json hp; GUESS 100 for an old ai.json). It lives on the status, so it survives deactivation
  // and reactivation (FUN_00559748 does not reset it).
  data.records.forEach((rec, k) => {
    const id = k + ID_BASE;
    // t3c: the object's two script timers (+0x3c / +0x3e shorts, cmd 0x106 / 0x107; FUN_0053e868 counts them down)
    if (!objects.has(id)) objects.set(id, { kind: 'record', id, rec: k, script: rec.script, vars: new Int16Array(8), t3c: new Int16Array(2), flags28: 0, f118: 0, ai: null, hp: deadRecs.has(k) ? 0 : rec.hp ?? 100 });
  });

  // FUN_00564228 -> FUN_00340ac0(C, n): the record's stance (ai.json records[k].stance, exported by
  // stance rule), its flags C+0x808 (FUN_0030fc38) and motion rows C+0x7fc (FUN_0030fc08). An old
  // ai.json (no stances): stance 0x1f's flags and the MOTION / FALLBACK_CLIPS names.
  function stanceOf(rec) {
    const st = data.stances && rec.stance != null ? data.stances[rec.stance] : null;
    if (st) return { st664: rec.stance, f808: st.flags, rows: st.motions };
    if (data.stances) warnOnce(`enemy_ai: no stance for record ${rec.rec} (${rec.model}); stance 0x1f assumed`);
    return { st664: 0x1f, f808: STANCE_1F_FLAGS, rows: null };
  }
  const clipOf = (a, m) => (a.C.rows ? a.C.rows[m] : (MOTION[m] ?? FALLBACK_CLIPS[m])) || null;
  // FUN_00563fc0: radius / height from the zone header of the record's set (ai.json sizes)
  function sizeOf(rec) {
    const z = data.sizes && rec.zones >= 0 ? data.sizes[rec.zones] : null;
    // h0 = +0x170 (standing); h = +0x30, which FUN_00565bd0 switches to +0x174 = 0.6 x h0 when crouched
    return z ? { r: z.r, h: z.h, h0: z.h } : { r: R_ACTOR, h: EYE_H, h0: EYE_H };
  }
  // the per-type dispatch: does an activation of this record build an AI actor here (AI_TYPES; an old
  // ai.json without stances: e027 only, as before)
  const buildsActor = rec => data.stances ? (AI_TYPES.has(rec.model) || NPC_TYPES.has(rec.model)) && rec.stance != null : rec.model === 'e027';

  // addActor: an activated soldier (FUN_00559748 gave it a body and an AI). init may carry the
  // state of a traced actor (test) or nothing (page).
  function addActor(init) {
    const rec = data.records[init.rec];
    if (!rec) throw new Error(`ai.json: no section-1 record ${init.rec}`);
    // FUN_00318718: weapon index (section-1 +0x54 or parameter set +0x88), -1 = none
    const W = rec.weapon >= 0 ? data.weapons[rec.weapon] ?? null : null;
    const id = init.id ?? init.rec + ID_BASE;
    const prev = objects.get(id);                // the record object: its vars (0x104) carry over
    const a = {
      kind: 'actor', id, rec: init.rec, script: init.script ?? rec.script,
      pos: init.pos || rec.pos.slice(), face: init.face || rec.face.slice(),
      vars: prev && prev.kind === 'record' ? prev.vars : new Int16Array(8),
      t3c: prev && prev.kind === 'record' && prev.t3c ? prev.t3c : new Int16Array(2),   // +0x3c / +0x3e timers (same object in the game)
      flags28: 1,                                // +0x28 bit 0 = active (FUN_00559748 tests it)
      // +0x118: the record object's (cmd 0x14c / 0x14d reach an inactive record too; same object in the game)
      f118: init.f118 ?? (prev && prev.kind === 'record' ? prev.f118 | 0 : 0),
      // +0x11c: FUN_00559748 (off) leaves +0x118 and +0x11c alone, so a reactivated actor still has its target (worker 0264)
      target: init.target ?? (prev && prev.kind === 'record' ? prev.target ?? null : null),
      // +0x120: FUN_00558790 = (0, 0, 0, 1); the same object across deactivation, as +0x118, so FUN_00563438's bit 0 path (no target) finds it (worker 0264: was null; with the target dropped too, a reactivated soldier's shot threw every frame)
      aim120: prev && prev.kind === 'record' && prev.aim120 ? prev.aim120 : [0, 0, 0],
      // status +0x20 HP: the record object's (set at placement setup, kept across deactivation)
      astate: init.astate ?? 0, hp: init.hp ?? (prev && prev.kind === 'record' ? prev.hp : rec.hp ?? 100), s64: 0, f19c: null,
      lvl: rec.lvl ?? 0,                         // status +0x11 (FUN_00314ea8)
      stance: 0, f110: 0,                        // +0x100 bits 40-41 stance / +0x110 reaction nibbles (0 for z128's soldiers, §10.3)
      part: -1, f144: -0x7fffffff,               // +0x142 last part hit, +0x144 frame of the last flinch clip
      s148: -0x7fffffff, s150: 0, s152: 0, sphase: 0,   // stagger FUN_0055d950: +0x148 time, +0x150 / +0x152 sums, phase (+0x150 bits 40-43)
      // worker 0264: all of these belong to the object (FUN_00558790, once): FUN_00559748 / FUN_00558bb8 write none of them, so off / on keeps them
      ...(prev && prev.kind === 'record' && prev.kept ? prev.kept : null),
      // body C (+0x300 mover mode and its slide; C+0x1c0 move flags)
      // C+0x664 stance / C+0x808 flags / C+0x7fc rows: FUN_00564228 -> FUN_00340ac0 at activation
      C: { f564: init.f564 ?? 0, speed: 0, s214: 0, aim: null, t2b0: null, motion: null, clip: null,
           f1c0: C1C0_STAND, mover: 0, slide: null, hold: false, gun: 0, req: 0, loop: true,
           b591: 10, b6c0: 10, blendLen: 10,         // C+0x591 / C+0x6c0 = 10 (FUN_0033ff18); blendLen: C+0x591 at the last request
           // root motion (rootSample): C+0x568 flags, C+0x6d0 last root sample (identity: FUN_0033ff18), C+0x310 / +0x370
           // (mover 8), mp = the MP head layer as enemies.js plays it (clip, frame; null before the first request)
           f568: 0, r6d0: PM.IDENT4(), m310: PM.IDENT4(), r370: 0, mp: null,
           f6b4: 1, f6b8: 1, f6bc: 0,                // the body fade (FUN_0033ff18: C+0x6b4 = 1.0; worker 0230)
           ...stanceOf(rec) },
      model: rec.model,
      size: sizeOf(rec),                         // actor +0x2c / +0x30 (FUN_00563fc0)
      ai: null,
    };
    // worker 0228: a townsperson's object +0x38 (the soldiers' is the PROBE_BITS stand-in): T 0x391 for 113 / 114 after
    // their event 3's cmd 0x16a(1) (w223_npc95 RAM f826; bit 0 bullets test it, bit 2 clear never lockable, bit 9 push-out).
    // GUESS: the same value from the activation on (its constructor / FUN_00559748 writer is not read; 0x16a sets 0x210 again)
    if (NPC_TYPES.has(rec.model)) a.f38 = 0x391;                            // = NPC_PROBE_BITS
    // worker 0264: a kept stance 1 keeps its height: FUN_00565bd0 wrote +0x30 = +0x174 and off never clears it
    if (a.stance === 1) a.size.h = f(a.size.h0 * f(0.6));
    // worker 0230: FUN_00564228 'e023' (0x65303233): FUN_00340ac0(C, 0x19), actor +0x118 |= 0x80801c (the same for e024)
    if (rec.model === 'e023') a.f118 = (a.f118 | 0x80801c) >>> 0;
    // the body listener's node event (FUN_0034fad0 -> C+0x540 event 3 -> FUN_005690c8 case 3): FUN_00588550 case 3 posts
    // manager event 0x10 with the node (0x588694: arg = *param_3), then FUN_00563970(a, -1)
    a.listen = (ev, n) => { if (ev === 3) { postManager(0x10, a.id, n); trackMoved(a); } };
    a.ai = {
      owner: a, flags: init.aiFlags ?? 0x100, due: init.due ?? S.now, last: init.last ?? S.now,
      interval: init.interval ?? 15, bstate: init.bstate ?? 0, btime: 0, atime: 0, cstate: 0, ctime: 0,
      d34: 10, d38: 10, d3c: 10, d40: 0, seen: 0, lost: 0, perc: init.perc ?? -1000,
      rounds: init.rounds ?? (W ? W.mag : 0), mode: init.mode ?? 0, amode: 0, cmode: 0, brain: null, timer: null,
      W, hits: 0,
      // +0x74 / +0x78: the AI's own bullets that ended on nothing / on an object (FUN_00554ea8 ->
      // FUN_00568e20 / FUN_00568df8 -> FUN_00360920 / FUN_00360900)
      f72: 0, f74: 0, f78: 0,
      // +0x98 / +0x99 = section-1 record +0x4c / +0x4d (FUN_00559748): the odds of FUN_0035f7c0 /
      // FUN_0035f8b0. GUESS for an old ai.json (no b98): 0.
      b98: rec.b98 ?? 0, b99: rec.b99 ?? 0,
    };
    // the body's move state (path_mover.js): C+0x1d4 = status +0x70 = parameter set +0x38 x 10 (FUN_003153d0 ->
    // FUN_00565bd0 -> FUN_0034b978; ai.json records speed; postureOnEnter resets it by gait).
    a.s70 = f(rec.speed ?? 0);
    PM.bodyInit(a.C, a.s70);
    // GUESS: C+0x45c (body +0xac flags) = 0x36, the save state's value for its e027s, for every type (its
    // initial writer is not decoded; notes/fidelity-audit.md). Read only by path_mover (bit 21, clear) and
    // written by FUN_00565bd0 (bit 3, postureOnEnter).
    a.C.f45c = 0x36;
    // GUESS: the idle the body starts in = motion 0 of its stance (r_gst for stance 0x1f: the save's idle
    // soldiers; which motion FUN_0055b8e0(a, 2) plays is not decoded)
    a.C.clip = init.clip || clipOf(a, 0) || 'r_gst';
    a.C.t2b0 = a.pos.map((x, i) => f(x + a.face[i]));                           // FUN_0034b4c8: C+0x2b0 = facing + position (no turn)
    // Activation (no astate given): FUN_00559748 -> FUN_0055b8e0(a, 2, 1, 0) for a plain placement:
    // state 2 (enter FUN_00537e70: gun bit clear), body motion 3 (state 0's table, FUN_00537aa0).
    // L: the other branches (+0x28 bit 1 with +0x104 set -> that state; a linked object +0xbc -> its
    // +0x60 byte; C+0x664 0x2a-0x2b / 0x2d or +0x118 bit 16 -> 3) need bits not exported. Motion
    // class 3 is not ported (no update). The save's soldiers (play.js AWAKE) pass their traced state.
    if (init.astate === undefined) setActorState(a, 2, 1);
    // FUN_00559748's tail: the actor's nav node (+0x108) = the nearest within 50 u (FUN_0033daf0)
    a.node108 = -1;
    NG.spawnNode(G, a);
    objects.set(a.id, a);
    actors.push(a);
    queueInsert(a.ai);
    // a dead actor's AI is in mode 0: the death path FUN_0055cac8 -> FUN_0035f728 (notes §9.10 f843)
    if (dead(a)) { if (a.ai.mode) setMode(a.ai, 0); }
    else if (a.ai.mode) setMode(a.ai, a.ai.mode);
    return a;
  }

  // ------------------------------------------------ script VM FUN_00371318 (ops: tools/stage_events.py)
  // Runs event `ev` of object o's script (vtable +0x2f4, FUN_003715e0) with args r0..r3.
  // worker 0259: fnBody = a function by index, not event (cmd 0x114's routine; ai.json script_fns; FUN_003714b0)
  function runEvent(o, ev, args = [], fnBody = null) {
    // worker 0243: an object may carry its own table (o.scripts): items.js runs an item's bgd script (FUN_00310718) for Vincent
    const sc = (o.scripts || scripts)[String(o.script)];
    let fn = fnBody || (sc && sc[String(ev)]);
    // FUN_00568f98: no script (-1) or no such event -> the parameter set's script (Vincent only here)
    if (!fn && o.fallback >= 0) fn = (scripts[String(o.fallback)] || {})[String(ev)];
    if (!fn) return;
    const code = fn.code, st = [], loc = new Array(fn.locals + 8).fill(0);
    let r = [args[0] ?? 0, args[1] ?? 0, args[2] ?? 0, args[3] ?? 0];
    events.push(`event ${o.id} script ${o.script} ev ${ev} r ${r}`);
    const pop = () => st.length ? st.pop() : 0;
    for (let pc = 0, n = 0; pc < code.length && n < 10000; n++) {
      const [op, imm] = code[pc++];
      switch (op) {
        case 0: case 31: case 32: break;                       // nop, nop31, enter
        // halt, ret. FUN_00371318 -> FUN_0036fe20: the event's result is the stack top (worker 0224: items.js reads
        // Vincent's event 0x3a result, FUN_00560110). L: an empty stack reads 0 here.
        case 1: case 17: return st.length ? st[st.length - 1] : 0;
        case 2: pop(); break;                                  // drop
        case 3: st.push(st[st.length - 1]); break;             // dup
        case 4: case 5: st.push(imm); break;                   // push int / float
        case 6: { const b = pop(), a = pop(); st.push(a + b); break; }
        case 8: { const b = pop(), a = pop(); st.push(a - b); break; }
        case 14: pc = imm; break;                              // jmp
        case 18: case 19: case 20: case 21: case 22: case 23: { // compares (a op b)
          const b = pop(), a = pop();
          st.push(+[a > b, a < b, a >= b, a <= b, a === b, a !== b][op - 18]); break;
        }
        case 24: st.push(r[imm]); break;                       // push reg
        case 25: st.push(loc[imm]); break;                     // push local
        case 26: r[imm] = pop(); break;                        // pop reg
        case 27: loc[imm] = pop(); break;                      // pop local
        case 28: st.push(+!pop()); break;                      // not
        case 29: if (!pop()) pc = imm; break;                  // jz
        case 30: if (pop()) pc = imm; break;                   // jnz
        case 33: case 34: case 35: loc[imm] = 0; break;        // clear local (int / float / string)
        // op 37 FUN_00370af0: push a pointer into the function's data block (data + imm x 8, type 3): ai.json fn.data
        // (hex; worker 0174); cmds 0x125 (sound) and 0x141 (clip, worker 0223) read a name through it (refName).
        case 37: st.push({ ref: imm, data: fnData(fn) }); break;
        // op 41 FUN_00370d00: the top cell's word v -> (int)((float)(v + 1) x FUN_0040b5c0()), type int (EE
        // cvt.w.s chops). One draw of the shared RNG.
        case 41: {
          if (!st.length) { warnOnce(`enemy_ai: script ${o.script} ev ${ev}: rand_i on an empty stack; event stopped`); return; }
          const v = st[st.length - 1] | 0;
          st[st.length - 1] = Math.trunc(Math.fround(Math.fround(v + 1) * rng()));
          break;
        }
        // worker 0237: op 42 FUN_00370d68 (table DAT_004a2f60 entry 42; asm 0x370d68-0x370e44): hi = pop, lo = pop, each
        // chopped to int if it is a float cell (cvt.w.s), then push the int lo + (int)((float)(hi - lo + 1) x FUN_0040b5c0()):
        // one draw of the shared RNG, in [lo, hi]. Scripts 159-164 (records 81-86) event 0x23: cmd 0x106 timer 0 = 200..600.
        case 42: {
          const hi = Math.trunc(pop()) | 0, lo = Math.trunc(pop()) | 0;
          st.push((lo + Math.trunc(Math.fround(Math.fround((hi - lo + 1) | 0) * rng()))) | 0);
          break;
        }
        // op 45 FUN_00370f58: pop v (a float is chopped); table at data + imm x 8: +0 count, +4 default,
        // +8 + 4v targets; 0 <= v < count -> pc = targets[v], else pc = default (instruction indices)
        case 45: {
          const v = Math.trunc(pop()), dv = fnData(fn);
          if (!dv) { warnOnce(`enemy_ai: script ${o.script} ev ${ev}: switch without a data block (rebuild data/enemies); event stopped`); return; }
          // (count < 0: every v takes the default, as in the game; a table past the data block stops the event)
          const t0 = imm * 8, cnt = t0 + 8 <= dv.byteLength ? dv.getInt32(t0, true) : null;
          if (cnt === null || t0 + 8 + 4 * Math.max(0, cnt) > dv.byteLength) { warnOnce(`enemy_ai: script ${o.script} ev ${ev}: switch table ${imm} outside the data block; event stopped`); return; }
          pc = (v >= 0 && v < cnt) ? dv.getInt32(t0 + 8 + 4 * v, true) : dv.getInt32(t0 + 4, true);
          break;
        }
        case 38: { const tgt = pop(); st.push(send(o, tgt, imm, r)); break; }   // FUN_00370b40
        // op 39 FUN_00370cb8: pop (FUN_0036fe98), then FUN_00326298(7) = DAT_0046e298 bit 7, result
        // unused: a debug print compiled out. op 40 FUN_00370ce0: FUN_00326298(7) only. No effect.
        // (Script 127 event 2: ops 37 / 39 / 40 print its data string "path_Sol31".)
        case 39: pop(); break;
        case 40: break;
        case 52: r = [0, 0, 0, 0]; break;                      // clear regs
        default:
          warnOnce(`enemy_ai: script ${o.script} ev ${ev}: op ${op} not translated; event stopped`);
          return;
      }
    }
  }

  // a script function's data block (ai.json fn.data, hex) as a DataView, once per function
  const fnDV = new WeakMap();                                                 // (not on the shared data: tests clone it)
  function fnData(fn) {
    if (fnDV.has(fn)) return fnDV.get(fn);
    let dv = null;
    if (typeof fn.data === 'string') {
      const b = new Uint8Array(fn.data.length >> 1);
      for (let i = 0; i < b.length; i++) b[i] = parseInt(fn.data.substr(2 * i, 2), 16);
      dv = new DataView(b.buffer);
    }
    fnDV.set(fn, dv);
    return dv;
  }
  // an op-37 reference's 8-byte name (sdb names are char[8], NUL-padded)
  function refName(v) {
    if (!v || !v.data) return null;
    let n = '';
    for (let k = 0; k < 8 && v.ref * 8 + k < v.data.byteLength; k++) {
      const c = v.data.getUint8(v.ref * 8 + k);
      if (!c) break;
      n += String.fromCharCode(c);
    }
    return n || null;
  }
  // FUN_0054a720(obj): obj+0x90 (the +8 != 0 branch FUN_0054a5e8 is not translated). Actors / Vincent: their
  // position. Triggers: FUN_005503e8 -> FUN_0054b7c8 copies the section-8 matrix to +0x60..+0x9c, so +0x90 = row 3
  // (ai.json m[3]). Section-1 records not yet active: the placement position (ai.json pos; L: the copy to +0x90
  // at stage load is not traced); a deactivated actor keeps its last position (T: setActive's off path). Anything else: null (the caller skips; never the listener).
  function objPos90(t) {
    if (t.pos) return Array.from(t.pos).slice(0, 3);
    if (t.kind === 'trigger' && t.t && t.t.m) return t.t.m[3].slice(0, 3);
    if (t.kind === 'record') {
      if (t.p90) return t.p90.slice(0, 3);
      const rec = data.records[t.rec];
      if (rec && rec.pos) return rec.pos.slice(0, 3);
    }
    return null;
  }
  // FUN_00370b40: command imm to target (-2 = own object); < 0x100 -> object manager FUN_00545b20,
  // else the object's +0xc handler (generic FUN_0054cd70, e027 FUN_005661e8).
  function send(o, tgt, cmd, r) {
    if (cmd < 0x100) {
      if (cmd === 0x3a || cmd === 0x3f) return slot(r[0] + ID_BASE);   // object id of section-1 record r0 (manager +0x3b2; -1 after a delete)
      if (cmd === 0x3d) return trigObj(r[0]);                  // object id of section-8 trigger r0 (manager +0x7b0)
      if (cmd === 0xc) return EVFLAGS[r[0]] ?? 0;              // event flag r0 (FUN_003ff738)
      // FUN_00545b20 cases 0xa / 9: global flag r0 (DAT_0050db20, FUN_0037cea0), set unless the player is finally dead as cmd 0xb (FUN_0037ce60) (worker 0264). The stage controller's table (opts.globalFlags).
      // T: route RAM global 58 = 1 after key 1, 2 after key 2 (scripts 243 / 246 / 200); 56, 57, 59 are counted the same way
      if (cmd === 0xa || cmd === 9) {
        const g = opts.globalFlags && opts.globalFlags();
        if (!g) { warnOnce('enemy_ai: manager cmd 9 / 0xa: no opts.globalFlags (the stage controller): 0'); return 0; }
        if ((r[0] >>> 0) >= 0x40) return 0;
        if (cmd === 0xa) return g[r[0]];
        if (!(P && deadFinal(P))) g[r[0]] = r[1] & 0xff;
        return 0;
      }
      // FUN_00545b20 case 0xa1: FUN_0053b978 (record r0's object, manager +0x3b2; none: 0) -> its status (FUN_0055a370) +0x20 >= 1 (worker 0264)
      if (cmd === 0xa1) { const q = objects.get(r[0] + ID_BASE); return +(!!q && q.hp >= 1); }
      // FUN_00545b20 cases 0x33 / 0x32 (the card gates' scripts 199, 202, 211, 221, 244; worker 0264): FUN_0031f0b0 the slot of item r0. 0x33: its count, no slot 0.
      // 0x32: FUN_0031eb60 takes r1 of it, all of it when r1 < 0; returns the amount, no slot 0. Without these every gate read 0 keys and refused
      if (cmd === 0x33 || cmd === 0x32) {
        const inv = opts.items && opts.items.inventory; if (!inv) return 0;
        const k = inv.find(r[0]); if (k < 0) return 0;
        return cmd === 0x33 ? inv.countAt(k) : inv.remove(k, r[1] >= 0 ? r[1] : inv.countAt(k));
      }
      // worker 0259: FUN_00545b20 case 0xa2: status of record r0 (FUN_00318bf8), its +0x20 (HP) == 0 -> 1
      if (cmd === 0xa2) { const q = objects.get(r[0] + ID_BASE); return +(!!q && q.hp === 0); }
      // worker 0259: case 4: FUN_003365e0(r0, manager +0x260) an effect at that point (FUN_003350c0 rotation +0x230 and r1's scale
      // FUN_00335070: r1 is 0 in z128's calls; rotation not read). Stage 29's routine 0x27: the helicopter's blasts
      if (cmd === 4) {
        if (!mgr260) { warnOnce('enemy_ai: cmd 4 before any 0x40 / 0x10f (manager +0x260 stage-start value not read): skipped'); return 0; }
        if (opts.effect && opts.effect.spawn) opts.effect.spawn(r[0] >>> 0, mgr260.slice());
        return 0;
      }
      if (cmd === 0xa6) return +(DIFF === 2);                  // FUN_00242c28() == 2
      if (cmd === 0xa7) return +(DIFF === 3);                  // FUN_00242c28() == 3
      // FUN_00545b20 cases 0x50 .. 0x53: the chunk's node animations (chunk_anim.js; worker 0257)
      if (cmd === 0x50) { if (opts.chunkAnims) opts.chunkAnims.start(r[0], r[1], r[2]); return 0; }
      if (cmd === 0x51) { if (opts.chunkAnims) opts.chunkAnims.stop(r[0], r[1]); return 0; }
      if (cmd === 0x52) { if (opts.chunkAnims) opts.chunkAnims.pose(r[2] | 0, r[0], r[1]); return 0; }
      if (cmd === 0x53) { if (opts.chunkAnims) opts.chunkAnims.pause(r[0], r[1]); return 0; }
      if (cmd === 0x2f) { if ((r[0] >>> 0) < 0x100) mshort[r[0]] = r[1]; return 0; }   // FUN_00545b20 case 0x2f
      if (cmd === 0x30) return (r[0] >>> 0) < 0x100 ? mshort[r[0]] : 0;                 // case 0x30
      // worker 0231 (notes/boss-research.md): case 0x6e: r0 < 0x12 -> FUN_003b58e0(HUD DAT_00471380, r0, r1, r2, r3) (a
      // HUD gauge: id, value, max, r3); 0x6f -> FUN_003b5378 (HUD +0xc59 = 1: shown); 0x70 -> FUN_003b53c0 (shown -> 2).
      // The page keeps the request (world.hudGauge()) and passes it on (opts.hudGauge -> play.js -> hud.js / hud_core.js, which
      // draws it: worker 0237). Worker 0237: 0x6e with r0 >= 0x12 calls nothing, so nothing is passed on.
      if (cmd === 0x6e || cmd === 0x6f || cmd === 0x70) {
        if (cmd === 0x6e && !((r[0] >>> 0) < 0x12)) return 0;
        if (cmd === 0x6e) Object.assign(hudGauge, { id: r[0] | 0, v: r[1] | 0, max: r[2] | 0, f: r[3] | 0 });
        else if (cmd === 0x6f) hudGauge.c59 = 1;
        else if (cmd === 0x70 && hudGauge.c59 === 1) hudGauge.c59 = 2;
        if (opts.hudGauge) opts.hudGauge(cmd, hudGauge); else warnOnce('enemy_ai: HUD gauge (FUN_003b58e0 / FUN_003b5378 / FUN_003b53c0): no HUD on the page');
        return 0;
      }
      // worker 0209: section-15 gimmicks (props.js): 0x3e = object id of gimmick r0 (manager +0x5b2), 0x2a / 0x2b the explosion
      // worker 0224: placed items are section-15 gimmicks too (items.js)
      if (cmd === 0x3e) { const k = opts.props ? opts.props.id(r[0]) : -1; return slot(k !== -1 ? k : (opts.items ? opts.items.id(r[0]) : -1)); }   // manager +0x5b2 (-1 after a delete)
      if (opts.props) { const v = opts.props.mgr(o, cmd, r); if (v !== undefined) return v; }
      // worker 0212 (notes/stage-script-cmds.md): FUN_00545b20 case 0xb: unless the player object (FUN_00318c98) is
      // dead for good (FUN_00316d08), FUN_003ff658(DAT_0047dbb0, r0, (byte) r1): flag r0 (< 0x40) = r1 (stored XOR
      // DAT_0047dbf0[r0]; the page keeps the plain value, FUN_003ff738 reads it back the same). FUN_003ff658's mode-0x11
      // branch (FUN_002419d8(0x11), flag 10, value != 0: FUN_00325b10(1), skipped while FUN_00323578) is not translated:
      // no z128 script writes flag 10 (tools/stage_events.py --cmds 0xb); warned if one does.
      if (cmd === 0xb) {
        if (P && deadFinal(P)) return 0;
        const n = r[0] >>> 0;
        if (n === 10 && (r[1] & 0xff)) warnOnce('enemy_ai: cmd 0xb flag 10: FUN_003ff658 mode-0x11 branch not translated (written as other flags)');
        if (n < 0x40) { EVFLAGS[n] = r[1] & 0xff; events.push(`flag ${n} = ${r[1] & 0xff}`); }
        return 0;
      }
      // case 0x40: FUN_0053c088(mgr, m, r0): locator r0 (stage section 16, FUN_003113f8) -> m; found -> FUN_0053d960(mgr,
      // m row 3): manager +0x230 = identity with position +0x260 = the locator's (w 1). Read by 0x10e / 0x13b / 0x13e.
      // A locator with a parent object (+0x41 != -1: FUN_0053bdb8 x the matrix) is not translated (none on z128).
      if (cmd === 0x40) {
        const L = data.locators && (r[0] | 0) >= 0 ? data.locators[r[0] | 0] : null;
        if (!data.locators) { warnOnce('enemy_ai: cmd 0x40: ai.json has no locators (re-export data/enemies); skipped'); return 0; }
        if (!L) return 0;                                                       // FUN_003113f8 0: FUN_002613b8(out) only
        if (L.parent !== -1) { warnOnce(`enemy_ai: cmd 0x40 locator ${r[0]} with a parent object (FUN_0053bdb8) not translated`); return 0; }
        mgr260 = [L.m[12], L.m[13], L.m[14], 1];
        return 0;
      }
      // case 6: r0 (a name) != 0 -> FUN_003e6c88(r0, r1) = the area sound (music.js AreaSound.play: same name refreshes only),
      // then FUN_003e8708(DAT_0047d718, r2) -> FUN_003e85a8(0x15, r2 < 0 ? 0x14 : r2) when it changed: request 0x15 (the
      // IOP side is not decoded: warned, not sent).
      if (cmd === 6) {
        if (!r[0]) return 0;
        const nm = refName(r[0]);
        if (!nm) { warnOnce('enemy_ai: cmd 6 without a name (rebuild data/enemies)'); return 0; }
        events.push(`area sound ${nm} ${r[1]}`);
        if (opts.areaSound) opts.areaSound(nm, r[1] | 0);
        warnOnce('enemy_ai: cmd 6: FUN_003e8708 sound request 0x15 not translated');
        return 0;
      }
      // worker 0208: case 0x54 / 0x55 (r0 < 0x81): FUN_002693a8 / FUN_00269368(r0) clear / set bit max(r0 - 1, 0) of
      // DAT_004e8700, the script half of the hidden-cell mask DAT_004e8710 (FUN_00269410): the stage effects' cull reads it
      // (play.js -> room_vis.js visMask, worker 0225). The room's chain skip (FUN_0026ccc8) reads it too (room.js showChunks).
      if (cmd === 0x54 || cmd === 0x55) {
        if ((r[0] >>> 0) < 0x81) {
          const b = Math.max((r[0] | 0) - 1, 0);
          events.push(`cell ${b} ${cmd === 0x55 ? 'hidden' : 'shown'}`);
          if (opts.cellMask) opts.cellMask(b, cmd === 0x55);
        }
        return 0;
      }
      // FUN_00545b20 case 0xab -> FUN_0053da98 (worker 0257): manager +0x260 on the screen and a clear probe 3 ray from the camera (CAM+0x90, FUN_00326200) to 0.1 short of it.
      // FUN_0053d9f0 -> FUN_0040d7f0(display): FUN_0040d778's clip test (display +0x3c0: x, y x scrz / 1024, RAM 0.29294; z x 1.00007 - 2.00007, w = z), then the screen point (+0x380: scrz, 1.5 scrz, 2037, 2048;
      // mode +0x2dc = 2, RAM: x - 2048 + 224, y - 2048 + 256) inside 0 <= x < 512, 0 <= y < 448. L: probe 3's objects as probe 6's on the page (the same +0x38 bits on all of them); the map = opts.viewRay (probe word 0x187)
      if (cmd === 0xab) {
        if (!opts.viewCam) { warnOnce('enemy_ai: manager cmd 0xab: no opts.viewCam (the camera): false'); return 0; }
        if (!mgr260) return 0;
        const c = opts.viewCam(), v = c.toView(mgr260), scrz = f(224 / f(Math.tan(f(c.fov * 0.008726647)))), w = v[2], z = f(f(w * 1.00007) - 2.00007), k = f(scrz / 1024);
        const X = f(v[0] * k), Y = f(v[1] * k), aw = Math.abs(w);
        if (X > aw || X < -aw || Y > aw || Y < -aw || z > aw || z < -aw) return 0;
        const sx = f(f(f(scrz * v[0]) / w) + 2037) - 2048 + 224, sy = f(f(f(f(scrz * 1.5) * v[1]) / w) + 2048) - 2048 + 256;
        if (!(sx >= 0 && sx < 512 && sy >= 0 && sy < 448)) return 0;
        const eye = c.eye, d = sub3(mgr260.slice(0, 3), eye), l = len3(d), s = 0.1 < l ? f(l - 0.1) : 0.1, end = [0, 1, 2].map(j => f(eye[j] + f(f(d[j] / l) * s)));
        return +!(viewRay(eye, end) || cameraObjects(eye, end));
      }
      // worker 0264: read for a value and left at 0: 0xa4 (FUN_00242c28 == 0; 0 is right, RAM DAT_0046b328 = 1 in the save and every route state); 0x44 (+0xfac: the section-22 placed sounds' object ids, FUN_00548788; script 0 passes them to 0x108 / 0x109: on / off, not done through scripts on the page). notes/fidelity-audit.md
      // GUESS: other manager commands are skipped (return 0, the script goes on)
      warnOnce(`enemy_ai: manager cmd 0x${cmd.toString(16)} not translated (skipped)`);
      return 0;
    }
    // FUN_00370b40: -2 = the host's object id (VM+0x1c), looked up per send. The page swaps a record's object for a new actor
    // on cmd 0x108 (setActive): the commands after a script's own 0x108 go to that actor (worker 0268: script 124's 0x131 path
    // after its wake went to the stale record and was dropped, so the cardkey-2 soldiers stood at locator 0)
    const t = tgt === -2 ? (objects.get(o.id) || o) : objects.get(tgt);
    if (!t) return 0;
    // a gimmick's own handler (barrel vt+0xc FUN_00586520 -> FUN_00588b78 -> FUN_0054cd70: props.js); undefined = the generic cases below
    if (t.kind === 'prop' && opts.props) { const v = opts.props.cmd(t, cmd, r); if (v !== undefined) return v; }
    if (t.kind === 'item' && opts.items) { const v = opts.items.cmd(t, cmd, r); if (v !== undefined) return v; }   // FUN_00580d38 (worker 0224)
    // worker 0243: Vincent's FUN_00571b60 -> FUN_005661e8 cases the item scripts send (0x12d / 0x12e / 0x14b / 0x172 / 0x173: items.js)
    if (t.kind === 'player' && opts.items && opts.items.playerCmd) { const v = opts.items.playerCmd(t, cmd, r); if (v !== undefined) return v; }
    switch (cmd) {
      // FUN_0054cd70 case 0x125 (worker 0174): FUN_0033cc48(r0 name, FUN_0054a720(object) = its +0x90 position, 1),
      // a released one-shot. r1 != 0: FUN_0033cc48(.., 0) keeps the slot, FUN_003e8ec8(r1, DAT_0047d728, slot)
      // writes the range (slot +0x10, opened at 400.0 by FUN_003e8bc8) when 0.1 < r1, FUN_0033cf50 releases it.
      // r1 is a float cell in every 0x125 call (op 5: 800 / 1000 / 7000 / 10000 / 15000).
      case 0x125: {
        const nm = refName(r[0]);
        if (!nm) { warnOnce(`enemy_ai: cmd 0x125 without a name (rebuild data/enemies)`); return 0; }
        const r1 = Math.fround(+r[1] || 0);
        const range = r[1] !== 0 && Math.fround(0.1) < r1 ? r1 : 400.0;          // FUN_003e8ec8 (0.1f, c.lt.s)
        const p = objPos90(t);
        if (!p) { warnOnce(`enemy_ai: cmd 0x125 '${nm}' on ${t.kind} ${t.id}: no +0x90 position on the page; not played`); return 0; }
        events.push(`sound ${nm} range ${range} at ${p.map(v => +v.toFixed(2)).join(',')}`);
        sound(nm, p, range);
        return 0;
      }
      // FUN_005661e8 case 0x141 (worker 0223): unless FUN_00566198 (status dead, not flag 1) and r2 == 0, and only with a
      // body (+0xe8): FUN_00344840(C, r0, 0, 0) puts the clip name r0 in C+0x640, FUN_00341780(C, 2, 0) plays it, MP +0x80 =
      // r1, then LAB_0056799c: FUN_0055b8e0(actor, 1, 0, 0) = actor state 1. Page: for a record that has a game body but no
      // page actor (the n0xx NPCs, enemies.js draws t.motion; T: w223_npc95, 111 / 113 / 114 'fear' from their event 3,
      // actor +0x104 = 1). An AI actor's 0x141 is not translated (warned).
      case 0x141: {
        // worker 0228: an actor (the townspeople): FUN_00344840 (C+0x640 = r0), FUN_00341780(C, 2, 0) = motion class 2
        // (vt 0x5a6b28, cmd141Motion), MP object +0x80 = r1, then FUN_0055b8e0(a, 1, 0, 0)
        if (t.kind === 'actor') {
          if (gone(t) && r[2] === 0) return 0;                                    // FUN_00566198
          if (!t.C) return 0;                                                     // +0xe8 == 0
          const nm = refName(r[0]);
          if (!nm) { warnOnce('enemy_ai: cmd 0x141 without a clip name (rebuild data/enemies)'); return 0; }
          t.C.n640 = nm;
          setMotion(t, 2);
          if (t.C.motion && t.C.motion.cls === 2) t.C.motion.n80 = r[1] | 0;
          else t.C.n80next = r[1] | 0;                                            // from inside an update: set on the switch
          setActorState(t, 1, 0);
          events.push(`motion ${t.id} ${nm}`);
          return 0;
        }
        if (t.kind !== 'record') { warnOnce(`enemy_ai: object cmd 0x141 on ${t.kind} ${t.id} not translated (skipped)`); return 0; }
        if (gone(t) && r[2] === 0) return 0;                                      // FUN_00566198
        if (!t.body) return 0;                                                    // +0xe8 == 0
        const nm = refName(r[0]);
        if (!nm) { warnOnce('enemy_ai: cmd 0x141 without a clip name (rebuild data/enemies)'); return 0; }
        t.motion = nm; t.motionSeq = (t.motionSeq | 0) + 1;
        t.astate = 1;                                                             // FUN_0055b8e0(actor, 1, 0, 0) (the field only)
        events.push(`motion ${t.id} ${nm}`);
        return 0;
      }
      case 0x100: return t.id;                                 // FUN_0054cd70 case 0x100: +0x20, the object's own id (worker 0257: the doors' scripts mail themselves)
      case 0x101:                                              // FUN_0054cd70: queue message r1 to object r0
        if (r[1] >= 0 && objects.get(r[0]) && !(objects.get(r[0]).flags28 & 0x80000))
          mailbox.push({ to: r[0], n: r[1], from: t.id });
        return 0;
      case 0x108:                                              // FUN_0054cd70: +0x144(1, 0) (actors FUN_00559748)
        setActive(t, 1);
        // then manager event 7 (FUN_0053fbe8) if now active -> script event 3 (FUN_0053fde8 case 8)
        // L: the page's triggers track activity in .active, not +0x28 bit 0 (whether the trigger class's
        // +0x144 sets that bit is not read), so a trigger never gets event 7 / event 3 here; see
        // notes/fidelity-audit.md "Manager events 7 / 8".
        if (objects.get(t.id).flags28 & 1) postManager(7, t.id);
        return 0;
      case 0x109: case 0x130:                                  // +0x144(0, 0), then manager event 8 -> script event 4
        setActive(t, 0);
        postManager(8, t.id);
        return 0;
      // FUN_0054cd70 case 0x106: script timer r0 (0 / 1 = object +0x3c / +0x3e) = r1 frames. r1 < 1 stops it (and the
      // object leaves the timer list FUN_0053e7a8 when both are now 0); else the object joins the list (FUN_0053e6e8)
      // if neither ran. FUN_0053e868 counts them down; at 0 -> manager event 0xd -> script event 1 (r0 = the timer).
      // Scripts 105 / 107 (records 41 / 43) event 3: timer 1 = 80 / 150 -> event 1 (r0 1) sets their brain mode.
      // case 0x107: read timer r0.
      case 0x106: {
        if (!(r[0] < 2)) return 0;                                                // iVar6 < 2 (signed)
        if (r[0] < 0) { warnOnce(`enemy_ai: cmd 0x106 timer ${r[0]} (writes before +0x3c) not translated`); return 0; }
        if (!t.t3c) t.t3c = new Int16Array(2);
        const running = () => (t.t3c[0] | t.t3c[1]) !== 0;                       // *(int *)(obj + 0x3c) != 0
        if ((r[1] | 0) < 1) {
          if (running()) { t.t3c[r[0]] = 0; if (!running()) { const i = timerList.indexOf(t.id); if (i >= 0) timerList.splice(i, 1); } }
        } else {
          if (!running()) timerList.push(t.id);                                  // FUN_0053e6e8 (L: never fails)
          t.t3c[r[0]] = r[1];
        }
        return 0;
      }
      // 0x107 has no index check in the game: r0 >= 2 reads the short at object +0x3c + 2 x r0 (r0 2 / 3 = +0x40 / +0x42,
      // the object's +0x40 flags), r0 < 0 below +0x3c. The page returns 0 there (L: no z128 script sends 0x107 at all).
      case 0x107: return t.t3c && (r[0] >>> 0) < 2 ? t.t3c[r[0]] : 0;
      // the box trigger class vt 0x58fd90 (shape 3), FUN_0057ca68: its door state +0xe0 (worker 0257): 0 shut, 2 opening, 1 open, 3 closing; 0x168 / 0x169 post the request (r0 = the delay)
      case 0x168: if (t.t && t.t.shape === 3 && (t.e0 === 0 || t.e0 === 3)) postManager(10, t.id, r[0]); return 0;
      case 0x169: if (t.t && t.t.shape === 3 && (t.e0 === 1 || t.e0 === 2)) postManager(0xb, t.id, r[0]); return 0;
      case 0x17c: return +(t.e0 === 1 || t.e0 === 2);        // FUN_0057c650
      case 0x17d: return +(t.e0 === 0 || t.e0 === 3);        // FUN_0057c660
      case 0x17e: return +(t.e0 === 2 || t.e0 === 3);        // FUN_0057c688
      case 0x18d: t.use = !!r[0]; return 0;                  // FUN_0054cd70 case 0x18d: +0x40 bit 2 (✕ takes it)
      case 0x104: if (r[0] < 8) { t.vars[r[0]] = r[1]; t.flags28 |= 0x4000; } return 0;
      case 0x105: return t.vars[r[0]];
      case 0x143: if (t.kind === 'actor') cmd143(t, r); return 0;
      case 0x142:                                              // FUN_005661e8 case 0x142
        if (t.kind === 'actor') cmd142(t, r);
        else warnOnce(`enemy_ai: cmd 0x142 to inactive record ${t.rec} (FUN_0055b8e0 without a body) not translated`);
        return 0;
      // FUN_005661e8 case 0x14c / 0x14d: set / clear actor +0x118 bit r0 (r0 < 0x20). Script 109 (record 45)
      // event 3 sets bit 28 (0x10000000: never pushed by FUN_00542ab8).
      // FUN_0054cd70 cases 0x176 / 0x177: +0x28 & 1, active; ^ 1, not active (worker 0264). The soldier pools ask 0x177 before activating the next one (script 104 event 2: chunk 07's 75-79, then the corpse count -> e036);
      // skipped it read 0 and no one came. Scripts 52-54 event 1 ask 0x176 before their cmd 0x125 message. A trigger's activity is .active on the page (setActive), an item's bit is f28
      case 0x176: case 0x177: { const on = t.t ? (t.active ? 1 : 0) : ((t.flags28 ?? t.f28 ?? 0) & 1); return cmd === 0x176 ? on : on ^ 1; }
      // FUN_00551d08 (triggers) cases 0x186 / 0x188 -> FUN_00552330: is Vincent / record r0 in this box: FUN_005635e0's point (feet, 7 up) through FUN_005507a0 (worker 0264). L: an inactive record's point is its kept +0x90
      case 0x186: case 0x188: {
        if (!t.t) { warnOnce(`enemy_ai: cmd 0x${cmd.toString(16)} on ${t.kind} ${t.id} (the trigger class only) skipped`); return 0; }
        const q = cmd === 0x186 ? P : objects.get(r[0] + ID_BASE), q0 = q && (q.pos || q.p90);
        return q0 ? +inBox(xform(t.t.inv, [q0[0], Math.fround(q0[1] - 7), q0[2]]), t.t.lo, t.t.hi) : 0;
      }
      // FUN_005661e8 cases 0x1a5 / 0x1a6: +0x110 low nibble = r0, read (worker 0264). The same object off and on: an inactive record holds it in `kept`
      case 0x1a5: { const v = r[0] & 0xf; if (t.kind === 'record') t.kept = { ...t.kept, f110: ((t.kept && t.kept.f110) ?? 0) & ~0xf | v }; else t.f110 = ((t.f110 ?? 0) & ~0xf) | v; return 0; }
      case 0x1a6: return ((t.kind === 'record' ? t.kept && t.kept.f110 : t.f110) ?? 0) & 0xf;
      case 0x14c: case 0x14d:
        if (!(t.kind === 'actor' || (t.kind === 'record' && buildsActor(data.records[t.rec])))) {
          warnOnce(`enemy_ai: object cmd 0x${cmd.toString(16)} to a non-actor not translated (skipped)`); return 0;
        }
        if ((r[0] >>> 0) < 0x20) t.f118 = (cmd === 0x14c ? t.f118 | (1 << r[0]) : t.f118 & ~(1 << r[0])) >>> 0;
        return 0;
      // FUN_005661e8 case 0x131: unless FUN_00566198 and r1 == 0, FUN_0055a6d8(a, r0, 0, -1): put the body
      // on stage path r0 (section 9) and start mover 1; path_mover.js pathStart. The turn mode: with an AI,
      // 6 when FUN_0035eda0 (FUN_00563200: the AI's target) and C+0x590 bit 24 (gun out), else 5.
      // Path +8 bit 3 (mover 0xe) is not translated (warned; no soldier record uses one on z128).
      // case 0x13a (worker 0178): the same FUN_0055a6d8(a, r0, r1, r2) with node range r1 / r2, skipped when
      // FUN_00566198 and r3 == 0 (script 104 events 1 / 0x13 / 0x21: path 12-18 from a mid node).
      case 0x131: case 0x13a:
        if (t.kind === 'actor' && !(gone(t) && r[cmd === 0x131 ? 1 : 3] === 0)) {
          if (!data.paths) { warnOnce('enemy_ai: cmd 0x131: ai.json has no stage paths (re-export): the soldier stands'); return 0; }
          if (!t.C.spd) warnOnce('enemy_ai: cmd 0x131: no move speed in ai.json (re-export): the soldier stands');
          else {
            const turn = t.ai ? (t.target && t.C.gun ? 6 : 5) : 5;               // FUN_0055a6d8 (no AI: +0xe4 bit 0 not modelled)
            const [n0, n1] = cmd === 0x131 ? [0, -1] : [r[1] | 0, r[2] | 0];
            if (PM.pathStart(t, data.paths, r[0], turn, warnOnce, n0, n1)) events.push(`path ${t.id} ${r[0]}${cmd === 0x131 ? '' : ` nodes ${n0}-${n1}`}`);
          }
        }
        return 0;
      // FUN_0054cd70 case 0x16a (worker 0228): vt+0x8c (actors 0x56bda8: returns the object, != 0) -> r0 == 1: +0x38 |= 0x210,
      // else +0x38 &= ~0x210 (0xfdef). Bit 9 = the push-out (FUN_00542ab8). Only the townspeople carry +0x38 on the page (a.f38);
      // the soldiers' +0x38 is the PROBE_BITS stand-in (warned there). The vt+0x8c == 0 branch (0x230) is for other classes.
      case 0x16a:
        if (t.kind === 'actor' && t.f38 !== undefined) {
          t.f38 = (r[0] === 1 ? t.f38 | 0x210 : t.f38 & 0xfdef) >>> 0;
          events.push(`f38 ${t.id} 0x${t.f38.toString(16)}`);
        } else warnOnce(`enemy_ai: object cmd 0x16a on ${t.kind} ${t.id} (+0x38 not modelled) not translated (skipped)`);
        return 0;
      // FUN_005661e8 case 0x191 (worker 0264): target record r0's object, only if it is active (FUN_0053b978, +0x28 bit 0; else no change) -> FUN_0035fc98. Scripts 24, 25, 26, 51 event 0x18: alive(NPC) (0xa1) ? 0x191 : 0x193
      case 0x191: {
        const q = objects.get(r[0] + ID_BASE);
        if (!q || !(q.flags28 & 1)) return 0;
        if (t.kind === 'actor' && t.ai) setTarget(t.ai, q);
        else if (t.kind === 'record') warnOnce(`enemy_ai: cmd 0x191 on inactive record ${t.rec} (FUN_00562f50) not kept`);
        return 0;
      }
      case 0x193:                                                                // FUN_005661e8 0x193 (FUN_0053bb08 = the player)
        if (t.kind === 'actor' && t.ai) setTarget(t.ai, P);
        // worker 0237: no AI (+0x184 0: an inactive record, e.g. 81-86 at event 0x23) -> FUN_00562f50(actor, player id):
        // +0x11c = the id, +0x118 |= 3. Not kept: the page's activation (addActor) does not carry a record's +0x118.
        else if (t.kind === 'record' && P) warnOnce(`enemy_ai: cmd 0x193 on inactive record ${t.rec} (FUN_00562f50: +0x11c / +0x118 bits 0-1) not kept`);
        return 0;
      // worker 0230 (notes/other-types.md). FUN_0054cd70: object +0x38 bit commands, r0 == 1 sets else clears: 0x16b bit 3,
      // 0x16c bit 0 (+ +0x40 bit 4: not modelled), 0x16d bit 1, 0x16e bit 2, 0x16f bit 6, 0x167 bit 8 (+ +0x40 bit 6). Bit 0 gates
      // Vincent's bullets, bit 2 the lock-on, bit 9 the push-out (a.f38 readers). An actor without its own +0x38 (the soldiers'
      // PROBE_BITS stand-in) takes the stand-in's value first.
      case 0x167: case 0x16b: case 0x16c: case 0x16d: case 0x16e: case 0x16f: {
        if (t.kind !== 'actor') { warnOnce(`enemy_ai: object cmd 0x${cmd.toString(16)} on ${t.kind} ${t.id} (+0x38 not modelled) not translated (skipped)`); return 0; }
        const bit = { 0x167: 0x100, 0x16b: 8, 0x16c: 1, 0x16d: 2, 0x16e: 4, 0x16f: 0x40 }[cmd];
        if (t.f38 === undefined) { t.f38 = dead(t) ? PROBE_BITS_DEAD : PROBE_BITS; t.f38own = true; }
        t.f38 = (r[0] === 1 ? t.f38 | bit : t.f38 & ~bit) >>> 0;
        events.push(`f38 ${t.id} 0x${t.f38.toString(16)}`);
        return 0;
      }
      // FUN_0054cd70 case 0x11a -> FUN_0054b508: +0x28 bit 12 (0x1000) = r0 != 0 (its readers are not decoded: stored)
      case 0x11a: t.flags28 = (r[0] ? t.flags28 | 0x1000 : t.flags28 & ~0x1000) >>> 0; return 0;
      // FUN_005661e8 case 0x1a3: status (+0x17c) -> FUN_00317420(status, (short) r0): HP = r0 clamped to [0, max +4]
      case 0x1a3: {
        const max = data.records[t.rec] ? data.records[t.rec].hp ?? 0 : 0;
        if (t.kind === 'actor' || t.kind === 'record') t.hp = Math.min(Math.max(short(r[0] | 0), 0), max);
        return 0;
      }
      // FUN_005661e8 case 0x19e: AI (+0x184) -> FUN_0035f9a0(ai, r0) = the combat layer; 0x19f: FUN_0035f540(ai, r0) = the action
      // layer. No AI: nothing.
      // worker 0259: FUN_005661e8 case 0x138: status +0x20 (HP) (no status: 0)
      case 0x138: return t.hp ?? 0;
      // worker 0259: case 0x19b: FUN_00566198 (dead) and r1 == 0 -> nothing; with a body FUN_00344840(C, r0, 0, 0) (the clip in C+0x640),
      // FUN_00341780(C, 0x42, 0), LAB_0056799c = actor state 1. Script 29 / 180: the helicopter's flights; 159-164 the paratroopers.
      case 0x19b: {
        if (t.kind !== 'actor' || !t.C || (dead(t) && r[1] === 0)) return 0;
        const nm = refName(r[0]);
        if (!nm) { warnOnce('enemy_ai: cmd 0x19b without a name'); return 0; }
        t.C.n640 = nm;
        setMotion(t, 0x42);
        setActorState(t, 1, 0);
        return 0;
      }
      // worker 0259: FUN_0054cd70 case 0x114: FUN_0053fb80(mgr, target, the host's script +0x34, r0) -> manager event 2 ->
      // FUN_0054ddf8; 0x115: the same with r0 = -1 (stop). The routine runs function r0 of that script by index.
      case 0x114: postManager(2, t.id, { script: o.script, fn: r[0] | 0 }); return 0;
      case 0x115: postManager(2, t.id, { script: t.script, fn: -1 }); return 0;
      // worker 0259: FUN_005661e8 case 0x14b: FUN_00336658(r0, +0x100, the model, the model) an effect on the model. L: at the body's position
      // (the attachment as boss_io's effect). Vincent's is items.js playerCmd.
      case 0x14b: {
        const p = objPos90(t);
        if (p && opts.effect && opts.effect.spawn) opts.effect.spawn(r[0] >>> 0, p.slice());
        return 0;
      }
      // worker 0259: FUN_005661e8 case 0x19d: weapon r0 (FUN_00311600), aim FUN_00563438 = aimPoint; r1 < 1: n 5, marker -1, else n r2, marker
      // r3; FUN_00569870(-1, actor, W, aim, n, marker, -1), then FUN_00552ac0(b, FUN_005630c0(actor)) (in spawnShot); returns (short) b +0x20.
      case 0x19d: {
        const W = data.weapons[r[0] | 0];
        if (!W || t.kind !== 'actor' || !t.C) return 0;
        const b = (r[1] | 0) < 1 ? shootMarker(t, W, aimPoint(t), 5, -1) : shootMarker(t, W, aimPoint(t), r[2] | 0, r[3] | 0);
        return b ? b.id ?? 0 : 0;
      }
      // worker 0259: FUN_00588b78 case 0x1aa: C+0x568 |= 0x100000 (the paratroopers, after their 0x19b; its reader was not looked at)
      case 0x1aa: if (t.C) t.C.f568 = (t.C.f568 | 0x100000) >>> 0; return 0;
      case 0x19e: if (t.kind === 'actor' && t.ai) setCombatLayer(t.ai, r[0] | 0); return 0;
      case 0x19f: if (t.kind === 'actor' && t.ai) setActionLayer(t.ai, r[0] | 0); return 0;
      // FUN_0054cd70 case 0x113: old = +0x36, +0x36 = (short) r0. New < 1: an old period > 0 loses its pending code -2
      // (FUN_0053edb0). Else: drop a pending one (old > 0), queue code -2 at +0x36 (FUN_0053e9e0). Code -2 -> manager event 0x16
      // (FUN_0053f040 case 0xd1) -> FUN_0053fde8 case 0x17: script event 0x18 (FUN_0054cca8: its result != 0 ends it); 0 and
      // +0x36 > 0 -> again at +0x36, else +0x36 = 0. So: event 0x18 every r0 ticks until it returns non-zero.
      case 0x113: {
        const old = t.s36 | 0;
        t.s36 = short(r[0] | 0);
        if (t.s36 < 1) { if (old > 0) delayedDrop(t.id, -2); }
        else { if (old > 0) delayedDrop(t.id, -2); delayedPost(t.id, -2, t.s36); }
        return 0;
      }
      // worker 0212 (notes/stage-script-cmds.md). FUN_0054cd70 case 0x10a: vt+0x54 (actors 0x58e24c -> FUN_0054e908 = 0;
      // triggers FUN_00550380) -> FUN_0054add0(obj, 1): only with a script event 0x54 (FUN_0054e7c8), which no z128 script
      // has (warned); then FUN_0053fa08(mgr, id): +0x28 bit 0x80000 already set -> nothing; else set it and queue manager
      // event 0 keyed to this object; FUN_0053fde8 case 1 deletes it (destroyObject, FUN_0053e1e0).
      case 0x10a: {
        const sc = scripts[String(t.script)];
        if (t.kind !== 'actor' && sc && sc['84']) warnOnce(`enemy_ai: cmd 0x10a on ${t.id}: script event 0x54 (FUN_0054add0 / FUN_00550380) not translated`);
        if (t.flags28 & 0x80000) return 0;
        t.flags28 |= 0x80000;
        postManager(0, t.id);
        return 0;
      }
      // FUN_0054cd70 case 0x10e: FUN_0054cd18 (+0x40 bit 0 off; the manager's gimmick +0x10ac -> 0 if it is this object:
      // not modelled on the page, L) and FUN_0054b1d8(obj, manager +0x260): +0x90 = FUN_0054a698 (no parent, +8 == 0:
      // identity) x the point, vt+0x234(obj, 1, 0); +0x28 |= 0x8000. A record not yet active keeps it as its +0x90
      // (objPos90; setActive builds the body there: FUN_00588270 -> FUN_00588430); an active actor moves.
      case 0x10e: {
        if (!mgr260) { warnOnce('enemy_ai: cmd 0x10e before any 0x40 / 0x10f (manager +0x260 stage-start value not read): skipped'); return 0; }
        const p = mgr260.slice(0, 3);
        // an actor: FUN_00588b78 then runs FUN_00588430: body +0xe8 -> FUN_0034aae0 (C+0x00.. = the actor matrix +0x60) and
        // FUN_00356d98(C+0x3b0, +0x90, 1, 0, 0) (the body's three position slots, FUN_00356740, +0x70 (FUN_003562d0 with
        // body +0xac bit 12), velocity +0x60 = 0): not translated (the page's body keeps no such slots); position only
        if (t.kind === 'actor') { t.pos = [p[0], p[1], p[2]]; if (t.C) warnOnce('enemy_ai: cmd 0x10e on an actor with a body: FUN_00588430 body sync (FUN_0034aae0 / FUN_00356d98) not translated (position only)'); }
        else if (t.kind === 'record') { t.p90 = p; t.p90set = true; }
        else { warnOnce(`enemy_ai: cmd 0x10e on ${t.kind} ${t.id} not translated`); return 0; }
        t.flags28 |= 0x8000;
        events.push(`move ${t.id} to ${p.map(v => +v.toFixed(2)).join(',')}`);
        return 0;
      }
      // FUN_005661e8 case 0x14a: status +0x17c -> FUN_00316948(status, 1): HP = max (+4); vt+0x33c(a, 0) = FUN_0055cff8;
      // manager event 6 -> FUN_0053fde8 case 7: script event 0x21. With 0x108 after it this is the scripts' respawn.
      // A record not yet active: FUN_0055cff8's +0x184 AI is 0, +0x28 bit 1 cleared, FUN_0055b8e0(a, 2, 1, 0) (the page's
      // activation starts every body in state 2), FUN_005aad08 / FUN_0031e060 / vt+0x344 (MP / status side, L: not read).
      // An active actor (FUN_0035f268 on its AI, state 2, the MP reset) is not translated: warned, skipped.
      // The game acts only with a status (+0x17c != 0). Every page record / actor object has one: the stage load
      // (FUN_00547ce0) makes an object only for a status slot (FUN_00318bf8(k) != 0) and links it (FUN_0055a168 ->
      // FUN_00563fc0: +0x17c); ai.json's records are those slots. Anything else (triggers): nothing.
      case 0x14a:
        if (t.kind === 'record' && data.records[t.rec]) {
          t.hp = data.records[t.rec].hp ?? 100;                               // FUN_00316948(s, 1): +0x20 = +4
          t.flags28 &= ~2;
          deadBits.add(t.rec);                                                // FUN_0055cff8: FUN_0031e060(+0x100, 1)
          events.push(`revive rec ${t.rec}`);
          postManager(6, t.id);
        } else if (t.kind === 'actor') warnOnce('enemy_ai: cmd 0x14a on an active actor (FUN_0055cff8 with a body) not translated');
        return 0;
      // FUN_00588b78 case 0x133: body +0xe8 -> FUN_003533e0 (the mover stop; path_mover.js stopAll)
      // FUN_0054cd70 case 0x10f: FUN_0054a720(obj) (its +0x90) -> FUN_0053d960(mgr, it): manager +0x260
      case 0x10f: { const p = objPos90(t); if (p) mgr260 = [p[0], p[1], p[2], 1]; else warnOnce(`enemy_ai: cmd 0x10f on ${t.kind} ${t.id}: no +0x90 on the page`); return 0; }
      case 0x133: if (t.kind === 'actor' && t.C) PM.stopAll(t, warnOnce); return 0;
      // FUN_00588b78 case 0x155: body +0xe8 -> FUN_0034b978: C+0x1d4 (the constant move speed) = r0 as a float (lwc1 of
      // the cell: asm 0x588e7c)
      case 0x155: if (t.kind === 'actor' && t.C) t.C.spd = Math.fround(+r[0] || 0); return 0;
      // worker 0231: FUN_00588b78 case 0x156: body -> FUN_0034ad00(r0, r1, r2): C+0x1e4 = r0, +0x1e0 = r1, +0x1e8 = r2 (the
      // mode-1 move's accel / top speed / decel, fly_mover.js; script 242 sends floats 120 / 600 / 60)
      case 0x156: if (t.kind === 'actor' && t.C) { t.C.f1e4 = Math.fround(+r[0] || 0); t.C.f1e0 = Math.fround(+r[1] || 0); t.C.f1e8 = Math.fround(+r[2] || 0); } return 0;
      // case 0x157: r0 0 -> C+0x1c0 |= 1, &= ~2; 1 -> &= ~1, |= 2 (profiled moves); 2 -> &= ~3; else nothing
      case 0x157: {
        if (t.kind !== 'actor' || !t.C) return 0;
        const C = t.C, n = r[0] | 0;
        if (n === 0) C.f1c0 = ((C.f1c0 | 1) & ~2) >>> 0;
        else if (n === 1) C.f1c0 = ((C.f1c0 & ~1) | 2) >>> 0;
        else if (n === 2) C.f1c0 = (C.f1c0 & ~3) >>> 0;
        return 0;
      }
      // 0x113 (FUN_0054cd70): object +0x36 = r0 and a delayed message to itself through
      // FUN_0053e9e0, whose delivery is not decoded. GUESS: it and other commands are skipped
      // (return 0, the script goes on).
      default:
        warnOnce(`enemy_ai: object cmd 0x${cmd.toString(16)} not translated (skipped)`);
        return 0;
    }
  }

  // vtable +0x144(on, ev). Triggers: generic activate (L: the trigger class's +0x144 is not read;
  // it gates the volume test). Records / actors: FUN_00559748; param_3 = ev: 0 from cmd 0x108 / 0x109 / 0x130
  // (event 3 then comes through manager event 7), 1 from the stage-load pass FUN_00558f68 (stageLoad): FUN_00559748's
  // tail runs script event 3 itself (vt+0x2f4, zero args) and clears +0x28 bit 0x100000.
  function setActive(t, on, ev = 0) {
    if (t.kind === 'trigger') { t.active = !!on; events.push(`${on ? 'arm' : 'disarm'} ${t.id}`); return; }
    if (t.kind !== 'record' && t.kind !== 'actor') return;
    if (on === (t.flags28 & 1)) return;                      // FUN_00559748: already in that state
    const rec = data.records[t.rec];
    if (on) {
      if (dead(t)) return;                                   // FUN_00318bf8 status dead (FUN_00316cf8): stays off
      // AI mode: status +0xa0 (the placement) +8 (FUN_00365c50). L: the status +0x61 bit-0 path
      // (mode from the parameter set) is not taken. Mode 8 -> 0, then FUN_0035f2e0 (not translated).
      let mode = rec.mode ?? 0;
      if (mode === 8) { mode = 0; warnOnce('enemy_ai: activation mode 8 (FUN_0035f2e0) not translated'); }
      let a = null;
      if (buildsActor(rec)) {
        // FUN_0055b8e0(a, 2, 1, 0): actor state 2 for a plain placement (addActor without astate)
        const f28 = t.flags28 | 0;                           // the object's +0x28 before the activation
        // FUN_00588270 -> FUN_00588430: the new body takes the object's matrix +0x60 (FUN_0034aae0) and +0x90 (FUN_00356d98): the
        // placement until something moved it (cmd 0x10e; a switched-off actor keeps where it stood). T: 46 / 47 walked back to from
        // r03_spot2 (route state w0256): new bodies (+0xe8) with C+0x30 = the kept +0x90 and row 2, not the placement.
        a = addActor(t.p90set ? { rec: t.rec, mode, pos: t.p90.slice(0, 3), ...(t.face80 ? { face: t.face80.slice() } : {}) } : { rec: t.rec, mode });
        a.flags28 |= 0x100000;                               // FUN_00559748; cleared by manager event 7
        // FUN_00559748 -> FUN_00365c50 (the AI) -> FUN_0035ee08(ai, a, 1) -> FUN_00360418(ai, 1): the magazine plus
        // trunc(((mag >> 1) + 1) x FUN_0040b5c0()), one draw (worker 0204; T w204_reload: 41 8, 42 6 with mag 6; T w204_t56rng:
        // records 50 / 51 by trigger 56, the twister word for word). Gate bVar1: no AI at all unless +0x28 bit 2 (4) is
        // clear and bit 5 (0x20) is clear or the linked object +0xbc has +0x14 bit 0x80 and not 0x100.
        // GUESS: the gate is taken as open. The page's flags28 is not the game's +0x28 (the constructor's bits are not
        // modelled: e.g. 0x208400 before activation, 0x20c403 after, in the reload state), so f28 here only carries the
        // page's own bits; bits 4 / 0x20 are clear for every z128 soldier in the save / reload RAM (notes/fidelity-audit.md
        // 'GUESS: FUN_00559748 bVar1 gate open'). Should the page ever set them, it warns and skips only the draw (the AI is
        // already built by addActor; the game would build none).
        if (f28 & 0x24) warnOnce(`enemy_ai: record ${t.rec} +0x28 bit 4 / 0x20 at activation: the game builds no AI here (FUN_00559748 bVar1); the page keeps its AI and skips only the magazine draw`);
        else refill(a.ai, 1);
      } else {
        // other models: no AI actor (AI_TYPES); marked active only, enemies.js draws them idle
        t.flags28 |= 1 | 0x100000;
        t.motion = null;                                     // a new body: the stance's idle until a cmd 0x141 (worker 0223)
        t.body = true;                                       // FUN_00559748 built it (+0xe8): cmd 0x141 needs one
        warnOnce(`enemy_ai: record ${t.rec} (${rec.model}) activated without an AI (types with an actor: ${[...AI_TYPES].join(', ')})`);
      }
      events.push(`activate rec ${t.rec}`);
      activated.push(t.rec);
      // a body-only record moved by cmd 0x10e is built at its +0x90 too (worker 0223; T: w223_npc95, NPCs 111 / 114 at
      // locators 6 / 5 with their placement facing)
      onActivate(!a && t.p90set ? { ...rec, pos: t.p90.slice(0, 3) } : rec, a);
      if (ev) {
        const o = objects.get(t.id);
        runEvent(o, 3);
        o.flags28 &= ~0x100000;
      }
      return;
    }
    // Off: FUN_00559748 (param_2 = 0) -> FUN_00558bb8: when the AI index (+0x140) is >= 0,
    // FUN_003659d8(DAT_0046f4ec, +0x140) unlinks the AI from the brain list (S.q) and calls its
    // destructor (vtable 0x4a2358 +0xc = FUN_0035e6f8), whose first call is FUN_00360820 = stopFire
    // (the fire timer leaves the list DAT_0046f4e4 +0x2c); then +0x184 = 0, +0x140 = 0xff.
    // Reactivation builds a new AI (FUN_00365c50 in the on path), so nothing of the old one stays.
    // HP stays on the status (FUN_00559748 does not write +0x20; the record object keeps it), and +0x60..+0x9c stay on the
    // object: T route RAM r03_spot2, soldiers 46 / 47 off (body +0xe8 = 0) with the +0x90 and row 2 they had at r02_climb.
    // With param_3 FUN_00559748 runs script event 4 here: not translated, no z128 script has an event 4.
    // Before FUN_00558bb8, FUN_00559748 runs FUN_0054c430(a, 0, 0) and FUN_00563a50(a, -1): the actor's
    // +0x1e node count goes back (setNode -1).
    // GUESS: the rest (body / weapon release, FUN_00588330, flags28 kept) is not translated;
    // notes/fidelity-audit.md 'Actor deactivation'.
    t.flags28 &= ~1;
    t.body = false;                                         // FUN_00588330 detaches the body (+0xe8 = 0; worker 0223: cmd 0x141's gate)
    if (t.kind === 'actor') {
      const i = actors.indexOf(t); if (i >= 0) actors.splice(i, 1);
      if (G) NG.setNode(G, t, -1);                                          // FUN_00559748: FUN_00563a50(a, -1)
      // GUESS: the body's mover is stopped here (FUN_003533e0, so mover 0xd gives its list's +0x1d counts
      // back and drops a queued search). FUN_00588330 only detaches the body (actor +0xe8 = 0, C+0x564 bit
      // 24, read nowhere in the decomp); where the game releases a detached body's path was not found.
      // notes/fidelity-audit.md 'Actor deactivation'.
      if (t.C && t.C.mover !== 0) PM.stopAll(t, warnOnce);
      if (t.ai) {
        const j = S.q.indexOf(t.ai); if (j >= 0) S.q.splice(j, 1);           // FUN_003659d8 unlink
        stopFire(t.ai);                                                     // FUN_0035e6f8 -> FUN_00360820
      }
      objects.set(t.id, { kind: 'record', id: t.id, rec: t.rec, script: t.script, vars: t.vars, t3c: t.t3c, flags28: 0, f118: t.f118 | 0, target: t.target, aim120: t.aim120, kept: { stance: t.stance, f110: t.f110, part: t.part, f144: t.f144, s148: t.s148, s150: t.s150, s152: t.s152, sphase: t.sphase }, ai: null, hp: t.hp,
        p90: t.pos ? Array.from(t.pos) : null, p90set: !!t.pos, face80: t.face ? Array.from(t.face) : null });   // +0x90 and row 2 (+0x80) kept
    }
    events.push(`deactivate rec ${t.rec}`);
    onDeactivate(rec);
  }

  // FUN_005661e8 case 0x143: AI mode r0
  // FUN_00566198: status dead (FUN_00316cf8) and status +0xc bit 1 clear (FUN_00315738(s, 1)).
  // GUESS: status +0xc bit 1 is never set on the page (not exported).
  const gone = a => a.hp === 0;
  function cmd143(a, r) {
    if (!a.ai) return;
    if (gone(a) && r[1] === 0) return;
    if (!target(a.ai)) {
      // FUN_005632f0 / FUN_00563318 not decoded (GUESS false) -> FUN_0035fe08 (candidate: GUESS, see candidate)
      pickTarget(a.ai);
    }
    if (r[0] === 8) warnOnce('enemy_ai: mode 8 (FUN_0035f2e0) not translated');
    else setMode(a.ai, r[0]);
  }

  // FUN_005661e8 case 0x142 (MIPS 0x566818): skipped when FUN_00566198 and r1 == 0, or when the actor
  // state is 0xf-0x11 with r0 2 / 3 and r1 == 0; r0 >= 0x100 -> 2; then FUN_0055b8e0(a, r0, 0, 0).
  function cmd142(a, r) {
    if (gone(a) && r[1] === 0) return;
    const s = r[0] >>> 0;
    if (((a.astate - 0xf) >>> 0) < 3 && ((s - 2) >>> 0) < 2 && r[1] === 0) return;
    setActorState(a, s < 0x100 ? s : 2, 0);
  }

  // ------------------------------------------------ AI helpers
  const now = () => S.now;
  const target = ai => (ai.owner.f118 & 2) ? ai.owner.target : null;          // FUN_0035eda0 / FUN_00563200
  const dead = o => o.hp === 0;                                               // FUN_00316cf8
  const deadFinal = o => o.hp === 0 && !(o.s64 & 8) && !(o.s64 & 4);          // FUN_00316d08
  const busy = a => (a.C.f564 >>> 15) & 1;                                    // FUN_0055ab08: C+0x565 bit 7
  const attacking = a => a.astate >= 0x80 && a.astate <= 0xbf;                // FUN_0055bb40

  function setTarget(ai, t) {                                                 // FUN_0035fc98
    const prev = target(ai);
    // FUN_00562f50 -> FUN_00342608(C, target): C+0x6c2 = target id and C+0x564 bit 30 (the body
    // then aims at the target every frame, FUN_00342650 in bodyTrack); none: 0xffff, bit 30 clear
    if (t) { ai.owner.f118 |= 3; ai.owner.target = t; ai.owner.C.f564 |= 0x40000000; }
    else { ai.owner.f118 &= ~3; ai.owner.target = null; ai.owner.C.f564 &= ~0x40000000; }   // FUN_00562f50: & 0xfffffffc, both bits (worker 0264: was bit 1 only)
    distances(ai, t !== prev);
    return !!t;
  }
  // GUESS: FUN_005608e8(actor, 0, 0) (the candidate search) = the player (not decoded; Vincent is the
  // only hostile on the page; notes/fidelity-audit.md 'Candidate target = the player')
  const candidate = () => P;
  // FUN_0035fe08(ai): FUN_0035fc98(ai, FUN_005608e8(actor, 0, 0))
  const pickTarget = ai => setTarget(ai, candidate());
  // FUN_0035fec0(ai, c): c none (then the search) or already the target -> 0; with a target, keep it when
  // AI +0x38 <= 50 or +0x38 - 20 <= FUN_0054aa50(actor, c); else FUN_0035fc98(ai, c)
  function retarget(ai, c) {
    const cur = target(ai);
    if (!c) c = candidate();
    if (!c || c === cur) return false;
    if (cur) {
      if (ai.d38 <= 50.0) return false;
      // MISSING: FUN_0054aa50 -> FUN_0054a9d0 (actor-to-actor distance) not translated; unreachable while
      // the candidate is the player (the target is then already the player)
      warnOnce('enemy_ai: FUN_0035fec0 switch between two targets (FUN_0054a9d0) not translated; target kept');
      return false;
    }
    return setTarget(ai, c);
  }
  function eye(o) {                                                           // FUN_005634e0(o, 3): (0, h-2, 0) in o's frame, up = -y
    return [o.pos[0], o.pos[1] - ((o.size ? o.size.h : EYE_H) - 2.0), o.pos[2]];
  }
  // vt+0x5c of the target (the player): FUN_00563720 -> bone PLAYER_AIM_BONE's world row 3; no pose -> the GUESS
  // fallback. after: read after Vincent's C update of this frame (FUN_00348fe8, see C_BEFORE_PLAYER), else before.
  const targetPoint = (t, after = false) => {
    const bw = t === P ? playerBones(after) : null;
    const r = bw && bw(PLAYER_AIM_BONE);
    return r ? r[3].slice() : [t.pos[0], t.pos[1] - PLAYER_AIM_H, t.pos[2]];
  };
  // Vincent's skeleton: his last drawn pose (MP+0x3f8 is rebuilt at the draw) x his C matrix, the start-of-frame one
  // until his C update in FUN_00348fe8 (FUN_00343160 -> FUN_0034c388), this frame's after it (T: k_bullet1 f875,
  // #67's aim = bone 3 of record 874's pose with record 875's matrix, 0.0001 u; #66's f786 aim: 785 with 785)
  const playerBones = (after = false) => world.playerBoneWorld ? world.playerBoneWorld(after) : null;
  function aimPoint(a) {                                                      // FUN_00360558 -> FUN_00563438 / FUN_00562ff8
    const t = target(a.ai);
    if (t) a.aim120 = targetPoint(t);                                         // target vt+0x5c
    else if (!(a.f118 & 1)) a.aim120 = [a.pos[0] + a.face[0] * 1000, a.pos[1] + a.face[1] * 1000, a.pos[2] + a.face[2] * 1000];
    if (t) setAim(a, a.aim120);                                               // FUN_00562ff8 -> FUN_003424c0(C, +0x120)
    return a.aim120;
  }
  function distances(ai, retarget) {                                          // FUN_0035e830
    const t = target(ai);
    if (!t) { ai.d34 = ai.d38 = ai.d3c = 10.0; ai.d40 = 0; return; }
    const v = sub3(aimPoint(ai.owner), ai.owner.pos);
    ai.d34 = Math.fround(len3(v));
    const rr = ai.owner.size.r + R_PLAYER;                                    // actor +0x2c + target +0x2c
    ai.d38 = ai.d34 - rr;
    ai.d40 = v[1];
    ai.d3c = Math.hypot(v[0], v[2]) - rr;
    // GUESS: +0x7e / +0x94 / +0x80 last-seen bookkeeping (FUN_00360bb8) not translated
  }
  function rayBlocked(a, b) {                                                 // FUN_00360378
    S.rays++; S.total++;
    return len3(sub3(a, b)) <= 1000.0 ? !!los(a, b) : false;
  }
  function visible(ai, t) {                                                   // FUN_003600e0(ai, t, 3)
    if (!t) return false;
    return !rayBlocked(eye(ai.owner), eye(t));
  }
  function inRange(ai) {                                                      // FUN_003602e8(ai, 3, 0)
    return !!target(ai) && !!ai.W && ai.d34 < ai.W.range * 10.0 * 1.0;   // no W: not decoded (GUESS: out of range)
  }
  function perception(ai) {                                                   // FUN_0035ec10
    const skip = S.rays !== 0 && (S.rays > 2 || S.now - ai.perc < 0x3d) && S.now - ai.perc < 0x79;
    if (!skip) {
      const t = target(ai);
      if (!t) {
        if (ai.mode !== 0) {
          const c = P;                                                        // FUN_0035fd78 -> FUN_005608e8 (GUESS: the player)
          if (c && visible(ai, c)) { ai.seen = S.now; setTarget(ai, c); ai.flags |= 2; }
          else { ai.lost = S.now; ai.flags &= ~2; }
        }
      } else {
        const was = ai.flags & 2;
        ai.flags = visible(ai, t) ? ai.flags | 2 : ai.flags & ~2;            // FUN_00360290
        ai.flags = inRange(ai) ? ai.flags | 4 : ai.flags & ~4;
        if (!!was !== !!(ai.flags & 2)) { if (ai.flags & 2) ai.seen = S.now; else ai.lost = S.now; }
      }
      ai.perc = S.now;
    }
    distances(ai, false);
  }

  // ------------------------------------------------ actor state FUN_0055b8e0 + motion requests
  // FUN_0055b8e0(a, st, act, 0). act = param_3: 1 at activation (the old class is state 0's,
  // FUN_00537a58(0); the enter runs even in the same state; FUN_005641c0 always restarts the motion).
  function setActorState(a, st, act = 0, noMotion = false) {
    if (st >= 0x100) st = 2;
    if (a.astate === st && !act) return 0;
    // the old state's class vt+0x24(new) gives the body's motion state, applied after the enter
    // (FUN_005641c0 -> FUN_00341780; none if 0)
    const mot = stateMotion(act ? 0 : a.astate, st, a.C);
    // the old state's leave (class vt+0x14): attack states 0x539dd8: C+0x564 &= ~0x80000 (then FUN_00565df8(a, 0)
    // on the ground: not read)
    if (attacking(a)) a.C.f564 &= ~0x80000;
    a.astate = st;
    if (attacking(a)) a.C.f564 &= ~0x80000;    // attack enter 0x539db0 (class 0x80 for 0x80-0xbf, FUN_00537490)
    gunOnEnter(a, st);
    postureOnEnter(a, st);
    if (mot && !noMotion) motionOfState(a, mot, act);
    if (st === 7 && a.stance === 2) {            // worker 0259: FUN_00537aa0 row 7 (0x537af4), stance 2 -> 0x537b2c: class 0xd FUN_00595ea8: row DAT_005a39f0[C+0x590 & 0xf] (T on Vincent only). Its end: as class 0x36's
      setMotion(a, 0xd);
      const row = LYING_DEATH_ROW[(a.C.f590 ?? 0) & 0xf] ?? 0x37, clip = clipOf(a, row);
      a.C.motion.noRow = !clip;
      playClip(a, clip || a.C.clip, 0x82); a.C.hold = true;
    } else if (st === 7) {                       // the death motion (class 0x36); its motion: GUESS deathMotion
      setMotion(a, 0x36);
      // GUESS (flags): the death clip holds its last frame (0x82, notes §10.5: r_stlaf0 held)
      playClip(a, clipOf(a, deathMotion(a.part, (a.C.f590 ?? 0) & 0xf)) || a.C.clip, 0x82); a.C.hold = true;
    }
    return 1;
  }
  // State class vt+0x24 (vtables of FUN_00537628's classes, read from the ELF: state 0 0x58aec0 /
  // 1 0x58ae90 -> FUN_00537cc0 / FUN_00537d38 = FUN_00537aa0; 2 0x58ae60 -> FUN_00537d58; 3 0x58ae30
  // -> FUN_00538120; 5 0x58ad70 -> FUN_005385f8). Standing (C+0x1d8 == 0) rows only, as the page's
  // soldiers; moving gives 8 / 9 / 0x13 / 0x17 instead (not on the page).
  //   FUN_00537aa0 (jump table 0x589e70): 2 -> 3, 3 -> 6, 5 -> 0x16
  //   FUN_00537d58: 3 -> 5, 4 -> 0x14, 5 -> 0x18, 7 -> 0xb, other -> FUN_00537aa0
  //   FUN_00538120: 2 -> 3, 3 -> 0, 4 -> 0x14, 5 -> 0x18, other -> FUN_00537d58
  //   FUN_005385f8: 2 -> 0x15, 3 -> 0x19, 4 -> 0x12, 5 -> 0, other -> FUN_00538420 (not read)
  // T: k_fire_emp15 #66 1 -> 3 = motion 6 (r_st_a looped f785), #67 2 -> 3 = motion 5 (f796).
  // Death (7): the page plays motion 0x36 (above); 2's 7 -> 0xb is not used (GUESS, notes §10.5).
  // Attack states (class 0x80, vt+0x24 FUN_00539e28): new 2 / 3 with C+0x564 bit 0x80000 -> 0x21, the same
  // attack -> 0, else FUN_00537aa0. FUN_00537aa0 (0x589e70 entries 0x80-0xbf = 0x537bf4): 0x80 + i -> 0x1000 + i.
  function stateMotion(from, st, C = null) {
    const base = { 0: 0, 1: 0, 2: 3, 3: 6, 5: 0x16, 8: 0x22, 0x18: 0x3f, 0xf: 0x33, 0x10: 0x1b };                // FUN_00537aa0 (0x589e70: 0 / 1 -> 0x537ac4 = 0, 8 -> 0x537b34 = 0x22, 0x18 -> 0x537b9c = 0x3f)
    if (st === 0xf) return 0x33;                                              // jump_core.js stateMotion: jumptable 0x537b64
    if (st === 0x10) return from === 0xf ? 0x38 : 0x1b;                       // FUN_005392e0: 0x38, else jumptable 0x537b6c
    if (from === 0xf && st === 0x11) return 0x35;                             // jump_core.js stateMotion: FUN_005392e0 / FUN_005393d0 / FUN_005394d8
    if (from === 0x10 && st === 0x11) return 0x3a;
    if (from === 0x11 && (st === 2 || st === 3)) return 0x37;                 // FUN_005394d8
    if ((from === 0xf || from === 0x10 || from === 0x11) && st !== 7) return base[st] ?? 0;   // their defaults: FUN_00537aa0 (0x18 -> 0x3f: FUN_005394d8)
    if (from === 0x18 && st === 3) return 5;                                  // state 0x18's vt+0x24 FUN_00539b48: 3 -> 5, else FUN_00537aa0
    if (from === 0x18 && st !== 7) return base[st];
    if (from === 8 && (st === 2 || st === 3)) return 0x21;                    // state 8's vt+0x24 FUN_00538a30 (landing; other rows not reached here)
    if (st >= 0x80 && st <= 0xbf) base[st] = st + 0xf80;
    if (from >= 0x80 && from <= 0xbf) {
      if ((st === 2 || st === 3) && C && (C.f564 & 0x80000)) return 0x21;
      if (st === from) return 0;
      if (base[st] !== undefined) return base[st];
    }
    const d58 = { 3: 5, 4: 0x14, 5: 0x18 };                                   // FUN_00537d58
    if (st === 7) return 0;
    let m;
    if (from === 0 || from === 1) m = base[st];
    else if (from === 2) m = d58[st] ?? base[st];
    else if (from === 3) m = st === 3 ? 0 : ({ 2: 3, 4: 0x14, 5: 0x18 })[st] ?? d58[st] ?? base[st];
    // FUN_005385f8, other -> FUN_00538420 (2 / 3 / 4 / 5 rows shadowed by 005385f8's; 7 handled above),
    // other -> FUN_00537aa0
    else if (from === 5) m = ({ 2: 0x15, 3: 0x19, 4: 0x12, 5: 0 })[st] ?? base[st];
    // 6 (vt+0x24 FUN_00538278) / 0x1b (FUN_00538340): the same state -> 0, other -> FUN_00537d58
    else if (from === 6 || from === 0x1b) m = st === from ? 0 : d58[st] ?? base[st];
    if (m === undefined) {
      // GUESS: the class's row for this pair is not read (other old states, FUN_00538420, base
      // jump-table entries other than 2 / 3 / 5): the motion is left as it is
      warnOnce(`enemy_ai: actor state 0x${from.toString(16)} -> 0x${st.toString(16)} body motion not read; motion kept`);
      return 0;
    }
    return m;
  }
  // FUN_005641c0(a, n, act): the same motion as now -> no restart unless act (any class)
  function motionOfState(a, cls, act) {
    if (!act && a.C.motion && a.C.motion.cls === cls) return;
    setMotion(a, cls);
  }
  // C+0x590 bit 24 ('gun out'; read by the flinch's end, class 0x1e FUN_00598950, and FUN_00341b20):
  // FUN_0055b8e0 runs the new state's enter, actor vt+0x2fc FUN_0055bbf8 -> state class vt+0xc (classes
  // from FUN_00537628, table DAT_004eedf0). Of the enters and leaves (vt+0x14) only these enters call
  // FUN_00565d78 (sets / clears the bit with actor +0x100 bit 44; the page keeps only the bit):
  //   set:   3 FUN_005380a0, 5 FUN_00538598
  //   clear: 0 FUN_00537c68, 4 FUN_005383a8 (both only with +0x118 bit 0x10000 clear),
  //          2 FUN_00537e70, 7 FUN_005386f0 (unconditional)
  // The other clearing enters (0xa-0xe, 0x12, 0x13, 0x15-0x17, 0x1a, 0x1d) are not read here;
  // no soldier on the page enters them. Activation (FUN_0055b8e0(a, 2, 1, 0)) runs state 2's enter:
  // the bit starts clear (C.gun: 0). FUN_0055f9d0's clear is reached only through status bit 7
  // (FUN_0055f128 / FUN_0055f338 kind 7 -> FUN_0055f448): not on this path.
  function gunOnEnter(a, st) {
    switch (st) {
      case 3: case 5: a.C.gun = 1; return;
      case 0: case 4: if (!(a.f118 & 0x10000)) a.C.gun = 0; return;
      case 2: case 7: a.C.gun = 0; return;
      // 6 FUN_00538218 / 0x1b FUN_005382e0 (vtables 0x58ae00 / 0x58add0): FUN_00565bd0(a, 0), FUN_00565d78(a, 0),
      // +0x118 |= 0x200 (their leaves 0x538260 / 0x538328 only clear +0x118 bit 0x200)
      case 6: case 0x1b: a.C.gun = 0; return;
      case 1: case 8: case 9: case 0xf: case 0x10: case 0x11: case 0x14: case 0x18: case 0x19: case 0x1c:
      case 0x1e: case 0x1f: case 0x20: case 0x21: case 0xc0: return;   // enters without FUN_00565d78
      default:
        if (st >= 0x80 && st <= 0xbf) return;  // attack class 0x80 (enter 0x539db0)
        warnOnce(`enemy_ai: actor state 0x${st.toString(16)} enter's C+0x590 bit 24 write not translated`);
    }
  }
  // FUN_00345818 / FUN_003456c0: a motion request pushes a new head layer on the motion player
  // (MP+0x448), the old head becomes the blend-out layer, and the new one blends in over C+0x591 + 1
  // (T: k_fire_emp15, MP layers of #66 / #67). flags bit 0 = the layer loops (0x83; 0x82 holds n - 1;
  // FUN_003456c0's -1 = FUN_00344608's default, L: 0x82). The page (enemies.js) plays C.req / C.loop.
  // The up / down partner rows (m + 1 / m + 2, by the aim pitch C+0x680) are not exported: GUESS, the
  // middle row only.
  // aimed = FUN_00345818's set (rows m, m + 1, m + 2), else FUN_003456c0 (row m alone).
  // GUESS: an aimed set's partner (the up / down row by the aim zone, C+0x590 bits 25-26: zones not
  // decoded, see jump_core aimedReq) is taken as nonzero (row m + 1 here; the row is unknown: k_fire_emp15
  // #67 f804 has r_st_ad = m + 2), used only for the same-layer test (mpDrops): two aimed sets match when
  // their level clips do ('zone unchanged'), an aimed set never matches a plain layer (partner 0). L: in
  // FUN_00345818 zone 0 (level aim) goes to LAB_00345988, a plain FUN_003456c0 request with partner 0, so
  // at zone 0 the game would match (and drop) where the page pushes. Not translated (visible in
  // FUN_00345818): the 1 < C+0x77b branch (row by pitch C+0x680 + C+0x7b0 against +-pi/4, flags |= 0x80,
  // plain FUN_003456c0 request).
  function request(a, m, flags = 0x82, aimed = false) {
    const name = clipOf(a, m);                   // the stance row C+0x7fc + m x 8
    // an empty row: no clip to play; the body keeps its clip (what FUN_00345818 does with it is not read)
    if (!name) { warnOnce(`enemy_ai: ${a.model} stance 0x${a.C.st664.toString(16)} has no motion 0x${m.toString(16)}; clip kept`); return; }
    playClip(a, name, flags, 0, false, aimed ? (clipOf(a, m + 1) || null) : null);
  }
  // keep = FUN_00344608's last argument (1 from the table switch FUN_00346860); 0 uninstalls the locomotion
  // table: C+0x658 = 0, C+0x659 = -1, C+0x564 bit 3 clear (so the rate is FUN_003456c0's 1.0 again).
  // carry = FUN_00345448 (the table switch keeps the clip phase, enemies.js C.reqCarry).
  function playClip(a, name, flags, keep = 0, carry = false, partner = null) {
    const C = a.C;
    // worker 0259: FUN_003449a0: C+0x564 bit 0x400000 != bit 4 -> FUN_00340c00: bit 4 off with 0x400000 clear (the body keeps the root's last place).
    // The page's bit 4 is set by motion42, the only setter of 0x400000.
    if ((C.f564 & 4) && !(C.f564 & 0x400000)) C.f564 &= ~4;
    if (!keep) { C.loco = null; C.f564 &= ~8; C.rate = null; }
    // FUN_00344608 (bit 0x400 clear: FUN_003456c0 passes 0): the new layer's blend = C+0x591, 0 with
    // C+0x564 bit 2 (FUN_00340bb8(C, 0, ..)); bit 0x20000000 (set by the stage-load pass FUN_00558f68) -> the blend is
    // FUN_00312678() = DAT_0046dd68 ? *(DAT_0046dd68 + 0x7c) : 0, and FUN_00344608 clears the bit after the request
    // (FUN_005a9678, the MP's skeleton reset, is not translated: the page's body is new). GUESS: BLEND_312678 = 0, the
    // value in the reload state's RAM (its writer is not decoded).
    if (C.f564 & 0x20000000) { C.blendLen = BLEND_312678; C.f564 &= ~0x20000000; }
    else C.blendLen = C.f564 & 2 ? 0 : C.b591;
    C.reqCarry = carry;
    // C.flags: FUN_005a91c8 (enemies.js) drops a request with bit 0x80 whose clip already plays on the top layer
    // the MP head layer the root sample reads (MP+0x448 head, +0x218 frame), kept as enemies.js's tick applies the
    // request: dropped by FUN_005a91c8, else a new head at 0 or at the carried frame (FUN_005a8fd0)
    if (!(C.mp && mpDrops(flags, C.mp, name, partner))) {
      const n = clipFrames(a, name);
      C.mp = { clip: name, frame: carry ? (C.mp && n != null ? carryFrame(C.mp.frame, n) : null) : 0, loop: !!(flags & 1), partner };
    }
    C.clip = name; C.loop = !!(flags & 1); C.flags = flags; C.partner = partner; C.req = (C.req | 0) + 1;
    C.r6d0 = PM.IDENT4();                                                     // FUN_00344608's end (0x344814): FUN_002613b8(C+0x6d0). T: w0256_bstp b_stp then atk_2, no jump
    events.push(`clip ${a.id} ${name}`);
  }
  // FUN_00340bb8(C, on, n): on 0 -> C+0x564 |= 2 (the next requests don't blend); on 1 -> clear bit 2
  // and C+0x591 = n, or for n < 0 C+0x591 = C+0x6c0 (bit 2 set instead when C+0x6c0 is 0)
  function blendSet(a, on, n) {
    const C = a.C;
    if (!on || (n < 0 && !C.b6c0)) { C.f564 |= 2; return; }
    C.b591 = n < 0 ? C.b6c0 : n & 0xff;
    C.f564 &= ~2;
  }
  // FUN_00565bd0(actor, n) from the enters of state 3 (FUN_005380a0: n 0) and 5 (FUN_00538598: n 1):
  // actor +0x100 bits 40-41 = n, height +0x30 = +0x170 (n 0) / +0x174 = 0.6 x +0x170 (n 1, FUN_00563fc0);
  // then the body: n 0 / 3 -> FUN_003419e0(C, 0), C+0x1d4 = FUN_00317610 = status +0x70, C+0x45c &= ~8;
  // n 1 -> FUN_003419e0(C, 1), C+0x1d4 = FUN_00317660 = +0x70 x 0.4 (status +0x60 bit 1 clear: z128's
  // soldiers), C+0x45c |= 8 (n 2, +0x70 x 0.2, is not entered here). Then the actor's vt+0x34c (not read).
  // Not modelled: the posture C+0x590 bits 16-19 written by FUN_003419e0 (the flinch reads a.stance).
  function postureOnEnter(a, st) {
    // 6 / 0x1b enters: FUN_00565bd0(a, 0) (above)
    // state 8 (vt 0x58ad10) enter FUN_005389a8: FUN_00565bd0(a, 0), FUN_00563930(a, FUN_005637c8(a)) (-1 without actor +0x28 bit 2: C+0x568 bit 15 clear). Its leave
    // FUN_00563780 only writes actor +0x143 (no reader here).
    if (st === 8) {
      if (a.flags28 & 4) warnOnce('enemy_ai: state 8 enter with actor +0x28 bit 2 (FUN_005637c8) not translated');
      a.C.f568 &= ~0x8000;
    }
    // worker 0259: 0x11's enter FUN_00539458: lying (stance 2; FUN_00565bd0(a, 2)'s height not on the page: L); 0xf / 0x10 FUN_005392b8 / FUN_00539390, 0x18 FUN_00539b20 and from 0x11 to 2 / 3 FUN_00537e70 / FUN_005380a0: stance 0
    if (st === 0x11) { a.stance = 2; return; }
    if (a.stance === 2 && (st === 2 || st === 0xf || st === 0x10 || st === 0x18)) { a.stance = 0; return; }
    if (st !== 3 && st !== 5 && st !== 6 && st !== 0x1b && st !== 8) return;
    posture565bd0(a, st === 5 ? 1 : 0);
  }
  // n 2 (height +0x178, +0x70 x 0.2, C+0x45c |= 8) is reached by attack op 6 only with its nibble 2: not in z128 (warned)
  function posture565bd0(a, n) {
    if (n === 2 || n > 3) { warnOnce(`enemy_ai: FUN_00565bd0 with n ${n} not translated`); return; }
    a.stance = n === 1 ? 1 : n;
    a.size.h = n === 1 ? f(a.size.h0 * f(0.6)) : a.size.h0;
    if (n === 1) { a.C.spd = f(a.s70 * f(0.4)); a.C.f45c |= 8; }
    else { a.C.spd = a.s70; a.C.f45c &= ~8; }
  }
  // FUN_00341780(C, n): the body's motion state. Leave / enter of the crouch transitions 0x18
  // (FUN_00597888 / FUN_00597828) and 0x19 (FUN_00597a88 / FUN_00597a28) clear / set C+0x564 bit
  // 0x4000 (a shot meanwhile spawns no bullet, FUN_003605d8). +0x74 = the shot class FUN_00341b78
  // starts from it: 0x18 / 0x16 -> 0xf (FUN_005977e8 / FUN_00597108), 6 -> 0xe (FUN_00594898), else 0.
  // Motion 5 (raise the gun, FUN_005945e8: +0x74 0xe) does the same (enter 0x594628 sets, leave
  // FUN_00594640 clears; T: k_fire_emp15 #67 C+0x564 0x40004000 f796-803).
  // worker 0267: 8 / 9 (ctor FUN_00594ef0 +0x74 = 0xe) and 0x17 (ctor FUN_00597360 +0x74 = 0xf)
  const NEXT74 = { 0x18: 0xf, 0x16: 0xf, 6: 0xe, 5: 0xe, 8: 0xe, 9: 0xe, 0x17: 0xf };
  const BIT4000 = cls => cls === 0x18 || cls === 0x19 || cls === 5;
  // FUN_00341780 also clears C+0x564 bits 8 / 0x10 / 0x40000 (FUN_00345678; its C+0x568 bits 0x10000 /
  // 0x20000 are not modelled). MISSING (none read here): C+0x79c &= ~0xc0, C+0x564 bit 0x20 cleared,
  // FUN_00346650(C, 0), C+0x5f2 = 0, the old motion's +0x70 carried to the new one's +0.
  // Motion classes not ported (3, 0x15, 0x12, 0x14, 0xb, ...) are kept as a class with no update.
  // The flinch class 0x1e (vtable 0x5a5c70; not Ghidra functions, disassembled from the ELF): enter
  // 0x5988b8 sets C+0x564 bits 0x8000 (busy, FUN_0055ab08), 0x4000 (no bullet, FUN_003605d8) and
  // 0x10000; leave 0x5988f0 clears them and C+0x1c0 bit 0x20 (T: 0x4001c000 while flinching).
  const FLINCH_BITS = 0x8000 | 0x4000 | 0x10000;
  function motionLeave(a, old) {                                              // old class vt+0x1c
    const C = a.C;
    if (BIT4000(old.cls)) C.f564 &= ~0x4000;
    if (KNOCK_CLASS.has(old.cls) || old.k36) C.f564 &= ~0xc000;                          // T w259_hit_poly: 0x4000c000 down to r_rev_0's end
    if (old.cls === 0x3f) C.f564 &= ~FLINCH_BITS;                             // worker 0259: T w259_hit_soldier: C+0x564 bits 0x1c000 only while the class runs
    if (old.cls === 0x1e) { C.f564 &= ~FLINCH_BITS; C.f1c0 &= ~0x20; }        // 0x5988f0
    if (old.cls === 0x36 || old.cls === 0xd) C.f564 &= ~0xc000;                                  // death leave FUN_0059ce98
    if (old.cls === 2) C.f564 &= ~(0x4000 | 0x200000);                         // class 2 leave 0x593c60 (worker 0228)
    if (old.cls === 1) C.f564 &= ~(0x4000 | 0x200000);                         // class 1 leave 0x593b30 (worker 0235)
    // worker 0259: class 0x42 leave FUN_0059e6a0: bit 4 -> FUN_00341750(C, 0), FUN_00340bb8(C, 1, -1). Bit 4 itself follows at the next request
    // (FUN_003449a0 -> FUN_00340c00)
    if (old.cls === 0x42) {
      C.f564 &= ~(0x4000 | 0x200000); C.f568 = (C.f568 | 0x80000) >>> 0;
      if (C.f564 & 4) { C.f564 &= ~0x400000; blendSet(a, 1, -1); }
    }
    // motion 8 leave FUN_00594f38 (vtable 0x5a6790 +0x1c) and motion 3 leave FUN_00593e08: FUN_00345b58(C, 0, 0, 0)
    // uninstalls the locomotion table (C+0x658 = 0, C+0x659 = -1, rows / root speeds 0, FUN_00345678) and
    // 8's leave clears C+0x564 bits 8 / 0x10 (3's clears C+0x568 bits 0x10000 / 0x20000: not modelled).
    // MP+0x40c (C.rate) is left as it is: only the next request's FUN_003453e0 rewrites it.
    if (old.cls === 8 || old.cls === 3) { C.loco = null; C.f564 &= ~(8 | 0x10 | 0x40000); }
    // worker 0267: motion 9 leave FUN_005953b8 (vtable 0x5a6708 +0x1c): FUN_00345530(C, 0), FUN_00340de0(C, 0) when C+0x760 == 1
    // (neither modelled: the partner pick C+0x590 and the C+0x7e0 object), then 8's FUN_00345b58(C, 0, 0, 0) and bits 8 / 0x10.
    // 0x17's leave FUN_005973e8 has only the first two: its table stays installed (FUN_00341780's FUN_00345678 clears bits 8 / 0x10).
    if (old.cls === 9) { C.loco = null; C.f564 &= ~(8 | 0x10 | 0x40000); }
    // GUESS (see attackUpdate, 'Attack end'): an attack motion replaced before its end (a flinch) also ends
    // the attack state; the new motion is kept (no state motion)
    if (old.cls >= 0x1000 && !old.left) rootLeave(a);                         // FUN_0059e938 (the attack motion's leave)
    if (old.cls >= 0x1000 && attacking(a)) setActorState(a, attackReturn(a), 0, true);
  }
  // FUN_00343160: a motion update (vt+0x24) returns the next class; FUN_00341780 switches to it only after
  // the body's frame FUN_0034ea18 (bodyUpdate). A setMotion from inside an update is that return value.
  function setMotion(a, cls) {
    const C = a.C;
    if (C.inUpdate) { C.nextMotion = cls; return; }
    const old = C.motion;
    if (old) motionLeave(a, old);
    C.f564 &= ~(8 | 0x10 | 0x40000);                                          // FUN_00345678
    C.f568 &= ~0x30000;                                                       // FUN_00345678 (bits the idle table sets, loco3)
    // motion 3 enter 0x593dd0: C+0x564 &= ~0x4000, FUN_003419e0(C, 0) (motion 8's enter 0x594f30 is empty).
    // FUN_003419e0 writes the posture C+0x590 bits 16-19 (old value to 20-23) and FUN_00341a48 sets C+0x1c0 bit
    // 0x20000 by posture and C+0x568 bits 0x200 / 0x400, then FUN_003550a0 re-levels the body rows when the bit
    // is clear. Not modelled: the page has no C+0x590 posture field (the flinch reads a.stance) and no C+0x568
    // 0x200 / 0x400; the walking soldiers stay level (FUN_0034a5a8).
    if (cls === 3 || cls === 4) C.f564 &= ~0x4000;                            // motion 4 enter 0x5940c0: the same bit
    if (cls === 1) C.f564 |= 0x4000 | 0x200000;                              // worker 0235: class 1 enter 0x593b08
    // worker 0259: class 0x42 (FUN_00592918, vt 0x5a4970) enter FUN_0059e640; FUN_00341780 clears the done-sent bit 0x20
    if (cls === 0x42) { C.f564 = ((C.f564 | 0x4000 | 0x200000) & ~0x20) >>> 0; C.f568 = (C.f568 | 0x80000) >>> 0; }
    C.motion = { cls, phase: 0, timer: 0, done: 0, t: 0, next74: NEXT74[cls] || 0, prev: old ? old.cls : 3 };
    if (cls >= 0x1000) {
      // FUN_0059e830 (attack enter): +0x10 entry, C+0x568 bit 15 clear, FUN_0034b110(0, C), FUN_00356278(0, body),
      // C+0x45c bit 18 set / bit 8 clear (T: k_lunge166 body+0xac 0x400b6 through the swing), timer +0xc 0 (+-4
      // only with the C+0x7dc object's +0x28 bit 5: clear for z128's soldiers)
      C.motion.entry = cls - 0x1000; C.motion.kf = 0; C.speed = 0;
      C.f568 &= ~0x8000;
      C.want = a.face.slice(); C.wk = 0;
      PM.bodyRootY(a, 0);
      C.f45c = (((C.f45c | 0) | 0x40000) & ~0x100) >>> 0;
    }
    if (BIT4000(cls)) C.f564 |= 0x4000;
    if (cls === 0x1e) C.f564 |= FLINCH_BITS;                                  // 0x5988b8
    if (KNOCK_CLASS.has(cls)) C.f564 |= 0xc000;
    if (cls === 0x3f) C.f564 |= FLINCH_BITS;                                  // worker 0259: T w259_hit_soldier f200 (enter 0x5a4b70 not read)
    // class 2 (cmd 0x141's clip, vt 0x5a6b28; worker 0228): enter 0x593c20 C+0x564 |= 0x4000 | 0x200000, C+0x568 |= 0x1000000
    if (cls === 2) { C.f564 |= 0x4000 | 0x200000; C.f568 |= 0x1000000; C.motion.n80 = C.n80next ?? 0; C.n80next = undefined; }
    // the death motion 0x36 (vtable 0x5a4ef0): enter FUN_0059ce58 sets C+0x564 0x4000 | 0x8000 (T: k_hits12
    // f871 0x4000c000); its FUN_003467b8(C, 1) is not read
    if (cls === 0x36 || cls === 0xd) C.f564 |= 0xc000;                        // (0xd: L, as Vincent's class 0xb)
  }
  // The motion ends with no next class (the page's stand-in for FUN_00341b20's next state, see the
  // flinch in bodyUpdate): the old class's leave still runs, as FUN_00341780 runs it on a change.
  function endMotion(a) {
    if (a.C.motion) motionLeave(a, a.C.motion);
    a.C.motion = null;
  }

  // ------------------------------------------------ brain / layers
  // FUN_0035f268 -> FUN_0035f300(mode): new brain object. Mode 1 = class 0x4a2588 (FUN_00362868: start
  // vt+0x14 FUN_003628f8, update vt+0x1c FUN_00362998); mode 2 = class 0x4a2608 (FUN_00362e58);
  // mode 0 / other = class 0x4a2430 (update FUN_003614b0 is empty).
  function setMode(ai, mode) {
    // worker 0231: FUN_0035f300 modes 0x100..0x1ff: the brain comes from the plug-in DAT_0046e590 (vt+0x14; z128: the
    // boss overlay's FUN_00aa3090, mode 0x100 only). No plug-in -> AI +0xe0 = 0 and +0xd0 (the mode) = 0.
    if (mode >= 0x100 && mode < 0x200) {
      if (!bossPlugin || mode !== 0x100) { ai.brain = null; ai.mode = 0; events.push(`mode ${ai.owner ? ai.owner.id : -1} ${mode}: no brain`); return; }
      // worker 0235: FUN_00aa3090 -> FUN_00aa1220 (boss_z128.js through boss_io.js), then the start vt+0x14 FUN_00aa1690
      ai.brain = { mode, boss: ai.owner ? createBoss(bossEnv, ai.owner) : null };
      ai.mode = mode;
      ai.flags &= ~0x100;
      if (ai.brain.boss) { ai.owner.boss = ai.brain.boss; ai.brain.boss.enter(); events.push(`boss brain ${ai.owner.id}`); }
      return;
    }
    ai.brain = { mode };
    if (![0, 1, 2, 3, 5, 6].includes(mode)) warnOnce(`enemy_ai: brain mode ${mode} not translated (empty update)`);
    ai.mode = mode;
    ai.flags &= ~0x100;
    if (ai.owner) {
      if (mode === 2) ai.interval = 5;           // start FUN_00362ee8
      else if (mode === 1) start1(ai);
      else if (mode === 0) { setActionLayer(ai, 0); setCombatLayer(ai, 0); }   // start FUN_00361440
      // Mode 5 = class 0x4a2770 (FUN_003638f8), start vt+0x14 0x363988 (not a Ghidra function; from the
      // ELF): interval 10, C+0x1c0 |= 0x1000000 | 0x4000000. Mode 3 (vt 0x4a2510) start 0x361648: the
      // same with interval 5. Mode 6 (vt 0x4a2830) start 0x364548: interval 5 only.
      else if (mode === 5 || mode === 3) { ai.interval = mode === 5 ? 10 : 5; ai.owner.C.f1c0 |= 0x1000000 | 0x4000000; }
      else if (mode === 6) ai.interval = 5;
      ai.flags |= 0x100;
    }
    ai.bstate = 0;
    ai.btime = short(S.now);                     // FUN_0035eb50
    events.push(`mode ${ai.owner.id} ${mode}`);
  }
  // FUN_0035f540 -> FUN_0035f590(ai, m): a new action (move) layer, AI +0x28 = 0, FUN_0035eb88 (+0x2a =
  // now), then the layer's start. Layers 1-7 / 0xb = vtables 0x4a2a28..0x4a2908 / 0x4a28d8 (updates: 2
  // FUN_00366390, 3 FUN_003667b0, 5 FUN_003670e8, 6 FUN_003672d8, 7 FUN_00367508). The old layer's vt+0xc
  // (layer 3: 0x367ac0) only frees it and layer 3's start 0x3667a8 is empty, so a running mover carries on.
  // Layers 2 (action2), 3 (action3), 5 / 6 (action56) are translated, with the nav-graph follower mover 0xd
  // (path_mover.js). MISSING: layers 1, 4, 7 / 0xb (notes/enemy-ai-hook.md 'Mover 0xd'). Those soldiers stand.
  function setActionLayer(ai, m) {
    ai.amode = m; ai.astate28 = 0; ai.atime = short(S.now);
    if (m && ![2, 3, 5, 6].includes(m)) warnOnce(`enemy_ai: action layer ${m} (move) not translated: the soldier stands`);
  }
  const aTime = ai => short(S.now - (ai.atime & 0xffff));                     // FUN_0035eb68
  // FUN_00360aa8: the actor is busy (FUN_0055ab08), C+0x564 bit 14, or attacking (FUN_0055bb40)
  const actBusy = a => !!busy(a) || !!(a.C.f564 & 0x4000) || attacking(a);
  // FUN_0035edc0: the target, alive (vt+0x8c -> FUN_0055a370 -> FUN_00316d08)
  const liveTarget = ai => { const t = target(ai); return !!t && !deadFinal(t); };

  // ---- nav-graph requests (worker 0163; path_mover.js mover 0xd)
  // FUN_0035ef18(ai): 0x60, or 0x40 when the AI's +0xf4 object's +0x9c record has +0x92 bit 5 set.
  // GUESS: always 0x60 (that record is not exported; T: every request of 46 / 47 in w161_chase carries 0x60).
  function searchFlags(ai) { return 0x60; }
  // the two nodes' areas (+0xe) are the same (both nodes valid)
  function sameArea(sn, goal) {
    if (!G || sn === -1 || goal === -1) return false;
    const p = NG.node(G, sn), q = NG.node(G, goal);
    return !!(p && q) && p[5] === q[5];
  }
  // FUN_0055a4e0(a): turn mode 6 when the AI has a target (FUN_0035eda0) and C+0x590 bit 24 (gun out, as
  // cmd 0x131 reads it), else (actor +0xe4 bit 0 clear: not modelled) turn mode 5 with C+0x1c0 |= 0x8000
  function navTurn(a) {
    if (a.ai && target(a.ai) && a.C.gun) { PM.setTurn(a, 6); return; }
    PM.setTurn(a, 5);
    a.C.f1c0 = (a.C.f1c0 | 0x8000) >>> 0;
  }
  // FUN_0055a628(a, req): alive (FUN_00316cf8), has a body, FUN_00563970 gives a node -> FUN_00353080 + the
  // request (start = that node), FUN_0055a4e0, FUN_0034edf0(C, 0xd). True when started.
  function navPath(a, req) {
    if (dead(a) || !a.C) return false;
    NG.trackNode(G, a);
    if (!G || a.node108 === -1) return false;
    PM.navRequest(a, req, a.node108, warnOnce);
    navTurn(a);
    PM.navStart(a, navOf(a), placeBody);
    return true;
  }
  // FUN_0055a590(a, goal): the same checks, goal != -1 -> FUN_00352f18 (queued mode 0 to the goal)
  function navPathTo(a, goal) {
    if (dead(a) || !a.C) return false;
    NG.trackNode(G, a);
    if (!G || a.node108 === -1) return false;
    if (goal === -1) return false;
    PM.navRequestTo(a, a.node108, goal, searchFlags(a.ai), warnOnce);
    navTurn(a);
    PM.navStart(a, navOf(a), placeBody);
    return true;
  }
  // FUN_00563bc0(t, n): |t - node n| (FUN_0054a888: 3D from the actor's position), 10000 without the node
  function nodeDist(t, n) {
    const q = G ? NG.node(G, n) : null;
    if (!q) return 10000.0;
    const x = f(t.pos[0] - q[0]), y = f(t.pos[1] - q[1]), z = f(t.pos[2] - q[2]);
    return f(Math.sqrt(f(f(f(x * x) + f(y * y)) + f(z * z))));
  }
  // FUN_0035e9b0(ai, out): the unit direction to the target (FUN_0054a720) through the actor's matrix
  // (FUN_0054a5e8, FUN_00261540: transposed 3x3), then FUN_00260f54 -> out[0], out[1]. Layer 3 state 2
  // compares |out[1]| with 30 deg and |out[0]| with 40 deg.
  // out = FUN_00260f54 of the direction in the actor's frame (localAngles): [0] the pitch, [1] the yaw.
  function coneAngles(a, t) {
    return localAngles(a, unit3(sub3(t.pos, a.pos)));
  }
  // FUN_00261540 (the rows dotted with u) then FUN_00260f54, with the actor's matrix (T: k_melee18 e0_cmat): row 0 = row 1 x row 2
  // = (-fz, 0, fx), row 1 = (0, -1, 0), row 2 = the facing. FUN_00260f54 (VU macro
  // ops, 0x260f04 / 0x260f54 / 0x260ffc / 0x261040): out[0] = atan2(-y, hypot(x, z)), out[1] = atan2(x, z) (as player.js
  // dirAngles), so with local y = -u.y the pitch is atan2(+u.y, h): negative when the point is above.
  function localAngles(a, u) {
    const fw = unit3([a.face[0], 0, a.face[2]]);
    const x = dot3(u, [-fw[2], 0, fw[0]]), z = dot3(u, fw), y = -u[1];
    return [Math.atan2(-y, Math.hypot(x, z)), Math.atan2(x, z)];
  }

  // Action layer 2 (vtable 0x4a29f8: start 0x366388 empty, end 0x367a78 frees it; update FUN_00366390):
  // move about while the target is out of view. Busy -> state 0. No live target: FUN_0035fe08 (a new target,
  // MISSING: warned), then in state 3 its wait, else stop (FUN_0055a828) and state 0. State AI +0x28:
  // 0 (target out of view): a path near the target: same area -> queued mode 0 (queue room) or mode 6 (+4 4,
  // cap 7, flags 7), state 1; else mode 1 (+4 6, cap 10, flags 0x17; T: w161_chase) and the state stays 0 (a
  // new request every run). C+0x1c0 |= 0x10 either way. 1 / 2: after 0x79 ticks with d34 > 50 C+0x1c0 bit 4
  // clears; in view after 0x1e ticks -> bit 4 set, state 3; mover ended -> 0; C+0x1c0 bit 20 -> stop, 0;
  // bit 19 toggles 1 / 2 (in 2 for 0x3c ticks -> stop, 3); 3 waits 0x3d ticks -> stop, 0.
  function action2(ai) {
    const a = ai.owner, C = a.C;
    if (actBusy(a)) { ai.astate28 = 0; return; }
    if (!liveTarget(ai)) warnOnce('enemy_ai: action layer 2 with no target: FUN_0035fe08 (new target) not translated');
    const stop0 = () => { PM.stopAll(a, warnOnce); ai.astate28 = 0; };       // FUN_0055a828, state 0
    if (!liveTarget(ai) && ai.astate28 !== 3) { stop0(); return; }
    const vis = !!(ai.flags & 2);                                             // FUN_00360bb8(ai, 1)
    switch (ai.astate28) {
      case 0: {
        if (vis) return;
        NG.trackNode(G, a);                                                   // FUN_00563970(a, -1)
        const sn = G ? a.node108 : -1;
        const goal = G ? NG.freeNeighbour(G, target(ai), rng) : -1;           // FUN_00563d20(t, 1, 1)
        if (sameArea(sn, goal)) {
          if (!NG.queueFree(svc)) navPath(a, { goal, s4: 4, max: 7, mode: 6, flags: 7 | searchFlags(ai), c: 100.0 });
          else navPathTo(a, goal);
          ai.atime = short(S.now);                                            // FUN_0035eb88
          ai.astate28 = 1;
          C.f1c0 = (C.f1c0 | 0x10) >>> 0;
          return;
        }
        C.f1c0 = (C.f1c0 | 0x10) >>> 0;
        navPath(a, { goal, s4: 6, max: 10, mode: 1, flags: 0x17 | searchFlags(ai), c: 100.0 });
        return;
      }
      case 1: case 2: {
        if (!(aTime(ai) < 0x79) && 50.0 < ai.d34) C.f1c0 = (C.f1c0 & ~0x10) >>> 0;
        if (vis && 0x1e < aTime(ai)) {
          C.f1c0 = (C.f1c0 | 0x10) >>> 0;
          ai.atime = short(S.now); ai.astate28 = 3; return;
        }
        if (C.mover === 0) { ai.astate28 = 0; return; }
        if (C.f1c0 & 0x100000) { stop0(); return; }
        if (!(C.f1c0 & 0x80000)) {
          if (ai.astate28 !== 2) return;
          ai.astate28 = 1; ai.atime = short(S.now); return;
        }
        if (ai.astate28 === 1) { ai.astate28 = 2; ai.atime = short(S.now); return; }
        if (aTime(ai) < 0x3c) return;
        PM.stopAll(a, warnOnce);
        ai.atime = short(S.now); ai.astate28 = 3; return;
      }
      case 3:
        if (aTime(ai) < 0x3d) return;
        stop0(); return;
    }
  }

  // Action layers 5 (vtable 0x4a2968, update FUN_003670e8) and 6 (vtable 0x4a2938, update FUN_003672d8; starts
  // 0x3670e0 / 0x3672d0 empty, ends 0x367b50 / 0x367b98 free only). No live target or busy -> state 0. State 0:
  // with the soldier's node (FUN_00563970) and the target's node (its +0x108 as it is), one nav request from one to
  // the other, +4 3, then state 1 (layer time reset); state 1 waits for the mover to end -> state 0 (time reset).
  //   5: mode 3 (away from the target: cost -|goal - n| x 0.1, +20 nearer), c 150, flags 0xe | FUN_0035ef18; queue
  //      room -> queued, cap 20 + (int)(r x 11), else sync (| 1), cap 7 + (int)(r x 3); state 1 only when started.
  //   6: C+0x1c0 bit 4 cleared first; mode 2 (keep the distance: cost | |goal - n| - c | x 0.1), c = d34, flags 0xe;
  //      queue room -> queued, cap 10 + (int)(r x 6), else sync (| 1), cap 5; then (int)(r x 11) < 8 -> C+0x1c0 bit 4
  //      set (0.3 speed) else clear; state 1 whether or not FUN_0055a628 started. r = FUN_0040b5c0 draws.
  function action56(ai, m) {
    const a = ai.owner, C = a.C;
    if (!liveTarget(ai) || actBusy(a)) { ai.astate28 = 0; return; }
    if (ai.astate28 === 1) {
      if (C.mover !== 0) return;
      ai.atime = short(S.now); ai.astate28 = 0; return;
    }
    if (ai.astate28 !== 0) return;
    if (m === 6) C.f1c0 = (C.f1c0 & ~0x10) >>> 0;
    NG.trackNode(G, a);
    const sn = G ? a.node108 : -1, t = target(ai), tn = t.node108 ?? -1;
    if (sn === -1 || tn === -1) { ai.atime = short(S.now); ai.astate28 = 0; return; }
    let req;
    if (m === 5) {
      const q = NG.queueFree(svc);
      const max = q ? Math.trunc(f(f(rng()) * 11.0)) + 0x14 : Math.trunc(f(f(rng()) * 3.0)) + 7;
      req = { goal: tn, s4: 3, max, mode: 3, flags: 0xe | searchFlags(ai) | (q ? 0 : 1), c: 150.0 };
      if (!navPath(a, req)) return;
    } else {
      const q = NG.queueFree(svc);
      const max = q ? Math.trunc(f(f(rng()) * 6.0)) + 10 : 5;
      req = { goal: tn, s4: 3, max, mode: 2, flags: 0xe | (q ? 0 : 1), c: ai.d34 };
      if (Math.trunc(f(f(rng()) * 11.0)) < 8) C.f1c0 = (C.f1c0 | 0x10) >>> 0;
      else C.f1c0 = (C.f1c0 & ~0x10) >>> 0;
      navPath(a, req);
    }
    ai.atime = short(S.now); ai.astate28 = 1;
  }

  // Action layer 3 (vtable 0x4a29c8, update FUN_003667b0): walk at the target. State AI +0x28:
  // 0 wait until d38 >= 5; 1 pick: target visible (AI +0x14 bit 1) within 100 (or 50) and C+0x1c0 bit 18
  // clear -> under 20 state 4, else mover 3 (FUN_00353110(20, 1000, C, target) + FUN_0034edf0(C, 3)) and
  // state 3; otherwise a nav-graph path (mover 0xd) and state 2; 2 on the path: back to mover 3 inside the
  // view cone, on to 1 when the path ends far from the target; 3 while mover 3 runs: back to 1 once the
  // target is out of view beyond 100, or C+0x1c0 bit 18 with d34 > 24; 0 when the mover ended; 4 wait 0x3d
  // ticks and d38 > 5, then 1.
  function action3(ai) {
    const a = ai.owner, C = a.C;
    if (!liveTarget(ai)) return;
    if (actBusy(a)) { ai.astate28 = 0; return; }
    const vis = !!(ai.flags & 2);                                             // FUN_00360bb8(ai, 1)
    switch (ai.astate28) {
      case 0: if (ai.d38 < 5.0) return; ai.astate28 = 1; return;
      case 1: {
        if (vis && ai.d34 < 100.0 && !(C.f1c0 & 0x40000)) {
          ai.atime = short(S.now);                                            // FUN_0035eb88
          if (ai.d34 < 20.0) { ai.astate28 = 4; return; }
          PM.approachStart(a, target(ai), 20.0, 1000.0, placeBody, warnOnce);
          ai.astate28 = 3; return;
        }
        // The nav-graph branch (0x366908): FUN_00563970(a, -1) = the soldier's node; the target alive
        // (FUN_0035edc0) else state 0; goal = FUN_00563d20(target, 1, 1), a free neighbour of the target's node
        // (one FUN_0040b5c0 draw when there is one). Same area (+0xe): the queue has room (FUN_00368120) ->
        // FUN_0055a590 (queued mode 0 to the goal), else FUN_0055a628 with mode 6 (+4 4, cap 7, flags 0x87);
        // other area: C+0x1c0 |= 0x10, FUN_0055a628 with mode 1 (+4 6, cap 10, flags 0x8f). c = 100. Either way the
        // flags take FUN_0035ef18's 0x60. Started -> state 2 (layer time reset); failed -> stays in state 1.
        NG.trackNode(G, a);
        const sn = G ? a.node108 : -1;
        if (!liveTarget(ai)) { ai.astate28 = 0; return; }
        const goal = G ? NG.freeNeighbour(G, target(ai), rng) : -1;
        let started;
        if (sameArea(sn, goal)) {
          started = NG.queueFree(svc) ? navPathTo(a, goal)
            : navPath(a, { goal, s4: 4, max: 7, mode: 6, flags: 0x87 | searchFlags(ai), c: 100.0 });
        } else {
          C.f1c0 = (C.f1c0 | 0x10) >>> 0;
          started = navPath(a, { goal, s4: 6, max: 10, mode: 1, flags: 0x8f | searchFlags(ai), c: 100.0 });
        }
        if (!started) return;
        ai.atime = short(S.now);                                              // FUN_0035eb88
        ai.astate28 = 2;
        return;
      }
      case 2: {
        // following the path (mover 0xd). Back to mover 3 when the target is in view inside the cone
        // (FUN_0035e9b0: |out[1]| < 30 deg, |out[0]| < 40 deg; out = [pitch, yaw], see coneAngles) with d38 < 150 and dy > -25, or d38 < 10; either
        // with C+0x1c0 bit 18 clear, and in view when d38 >= 50
        let go = false;
        if (vis) {
          const [pitch, yaw] = coneAngles(a, target(ai));
          if (Math.abs(yaw) < 0.5235988 && Math.abs(pitch) < 0.69813174 && ai.d38 < 150.0 && -25.0 < ai.d40) go = true;
          else go = ai.d38 < 10.0 && !(C.f1c0 & 0x40000);
        }
        if (go && (!(50.0 <= ai.d38) || vis) && !(C.f1c0 & 0x40000)) {
          PM.approachStart(a, target(ai), 20.0, 1000.0, placeBody, warnOnce);   // FUN_00353110 + FUN_0034edf0(C, 3)
          ai.astate28 = 3; return;
        }
        // LAB_00366ca4: within 0x709 ticks of the layer time, or while the path has a last node (FUN_0034aa28)
        if (aTime(ai) < 0x709 || PM.navGoal(C) !== -1) {
          if (C.mover === 0) { ai.astate28 = 0; return; }
          const t = liveTarget(ai) ? target(ai) : null;
          const n = t ? PM.navGoal(C) : -1;
          // FUN_00563bc0(t, n): |t - node n| (FUN_0054a888, 3D), 10000 without the node
          if (n !== -1 && 30.0 < nodeDist(t, n) && ai.d38 < 60.0) { PM.setTurn(a, 6); ai.astate28 = 1; return; }
        } else { ai.atime = short(S.now); ai.astate28 = 0; }
        if (!(C.f1c0 & 0x100000)) return;
        ai.atime = short(S.now);
        PM.stopAll(a, warnOnce);                                              // FUN_0055a828 -> FUN_003533e0
        PM.setTurn(a, 6);
        ai.astate28 = 4; return;
      }
      case 3:
        if (C.mover === 0) { ai.astate28 = 0; return; }
        if (ai.d34 <= 100.0 || vis) {
          if (!(C.f1c0 & 0x40000)) return;
          if (ai.d34 <= 24.0) return;
        }
        ai.astate28 = 1; return;
      case 4:
        if (aTime(ai) < 0x3d) return;
        if (ai.d38 <= 5.0) return;
        ai.astate28 = 1; return;
    }
  }
  // The soldier's physics body C+0x3b0 (walk-mesh body; path_mover.js mover 3 / move mode 0xc).
  // T (w161_chase, 46 / 47 in the save state): body+0xc4 = 2.5, +0xc8 = 4 pi (12.566), flags +0xac = C+0x45c = 0x36.
  // GUESS: the same for every soldier (their writer is not decoded; notes/fidelity-audit.md).
  const walkCol = opts.walkMesh || null;
  // The stage nav graph (FUN_0033ef48; DAT_0046e878 +0x10): ai.json `nav`, null without it (old export).
  const G = NG.makeGraph(data.nav || null);
  // z128 has a nav graph: without it (a stale ai.json) every nav request fails and mover 3 keeps
  // homing out of view, as on a stage with no graph; make that visible
  if (!G) warnOnce('enemy_ai: ai.json has no nav block (re-export with export_web_triggers.py): nav requests fail, approach movement is wrong');
  // The search service DAT_0046e290 +100 (nav_graph.js makeService: 40 steps a frame, 1 queue slot, 3000 records)
  const svc = NG.makeService();
  // Node tracking: the game runs FUN_00563970 when an actor's position is set (vt+0x234; soldiers: FUN_0055ef78,
  // T: w161_chase, 46 / 47's +0x108 follows FUN_0033dda8 from the last frame's node on all 560 frames).
  // GUESS (when): every frame for every actor and Vincent; whether a standing actor's position is set each
  // frame is not traced (a repeat at the same point can only step to a neighbour that scores lower).
  function trackMoved(a) { if (G) NG.trackNode(G, a); }
  // The body listener C+0x540 (FUN_005690c8) for mover 0xd: event 5 (node passed) -> FUN_00563a50(node) and
  // FUN_00588550 case 5 (0x5886d4: manager event 0x12 with the node -> script event 0x27); event 4 (path end)
  // -> FUN_00563a50(node) unless -1, then case 4 (0x5886c0: manager event 0x11 -> script event 0x26)
  function navOf(a) {
    return a.navCtx || (a.navCtx = {
      G, svc, rng, warn: warnOnce,
      event(ev, n) {
        if (ev === 5) { NG.setNode(G, a, n); postManager(0x12, a.id, n); }
        else if (ev === 4) { if (n !== -1) NG.setNode(G, a, n); postManager(0x11, a.id, n); }
      },
    });
  }
  function bodyOf(a) {
    return a.B || (a.B = { poly: null, state: 0, vel: [0, 0, 0], want: [0, 0, 0], acc: 2.5, turn: f(4 * Math.PI), dt: f(0.019999999552965164) });
  }
  // FUN_00356d98(C+0x3b0, C+0x30, 1, 1, 0): the body at the position; FUN_00356740 -> FUN_0035cbc8 its polygon
  // (collision.js locate). Without the page's collision the body has no polygon and FUN_00357d48 skips the walk.
  function placeBody(a) {
    const B = bodyOf(a);
    B.state = 0;
    const r = walkCol ? walkCol.locate(a.pos[0], a.pos[1], a.pos[2]) : null;
    B.poly = r ? r[0] : null;
  }
  // FUN_003590c8 body state 0 walk: FUN_00357d48 (collision.js navMove) from the body polygon by move x / z.
  // The actor push C+0x430 enters it (FUN_0035a440, body flag bit 4) -- GUESS: soldiers get no push on the
  // page (the soldier-soldier push is not computed; T: w161_chase C+0x430 non-zero in 24 of 380 records).
  // worker 0269: FUN_0035a440's object pass (obj_contact.js) runs for every body with flag bit 2 (decomp l.696): soldiers 0x280036 /
  // 0x36, the dog 0x2400b6 (T: w269_bar1 set_step). The body's radius / height: FUN_0055efb8 -> FUN_003561c8(actor +0x2c, +0x170,
  // C+0x3b0): +0xb8 = r below 6.4, else 6.4 (compressed instead with manager +0x2b0 bit 0 and C+0x664 == 0x11: 0 on z128, RAM
  // r03_mid2 / r08_walk), +0xbc = +0x170 x 0.5 (a.size.r / a.size.h0, FUN_00563fc0). T: w269_bar1 bodies 5 / 9 and 6 / 6 (e027 r 5
  // h 18, e030 r 6 h 12). No soldier push (GUESS above). The pass's bits go to C+0x1c0 (0x80000, 0x40000 | 0x400 with C+0xbc,
  // 0x100000), which the brains read; FUN_0034c388's moveStart clears them each frame.
  function bodyRH(a) {
    const z = a.size || { r: R_ACTOR, h0: EYE_H };
    const r = f(z.r) < f(6.4) ? f(z.r) : f(6.4);
    return [r, f(f(z.h0 ?? z.h) * 0.5)];
  }
  function objPass(a, mv, air) {
    const objs = opts.props && opts.props.blockers ? opts.props.blockers() : null;
    if (!objs || !objs.length) { if (a.C) a.C.f1c0 = (a.C.f1c0 & ~0x100000) >>> 0; return mv; }   // l.1274: iStack_110 0 -> cleared
    const [r, h] = bodyRH(a);
    const res = objectPass({ objs, pos: a.pos, move: mv, air, cross: cylinderCross, r, h, face: a.face || null, warn: warnOnce });
    const C = a.C;
    if (C) {
      if (res.bits[0x80000]) C.f1c0 = (C.f1c0 | 0x80000) >>> 0;
      C.f1c0 = res.bits[0x100000] ? (C.f1c0 | 0x100000) >>> 0 : (C.f1c0 & ~0x100000) >>> 0;
      if (res.bits[0x40000]) {
        C.f1c0 = (C.f1c0 | 0x40000) >>> 0;
        if (!(C.f1c0 & 0x400)) { C.f1c0 = (C.f1c0 | 0x400) >>> 0; C.fbc = res.kind; }
      }
    }
    return res.applied ? res.out : mv;
  }
  function walkBody(a, mv) {
    const B = bodyOf(a);
    if (a.C) a.C.f1c0 = (a.C.f1c0 & ~(0x400 | 0x40000)) >>> 0;              // worker 0269: FUN_00357d48 clears them on every call
    if (B.state === 2) return airBody(a, mv);
    if (!walkCol || B.poly === null) return a.pos.slice();
    mv = objPass(a, mv, false);                                               // FUN_00357d48 -> FUN_0035a440 before the walk
    const r = walkCol.navMove(B.poly, a.pos[0], a.pos[1], a.pos[2], mv[0], mv[2], false);
    B.poly = r[3];
    wallBits(a);
    if (r[5]) warnOnce('enemy_ai: soldier walked off an edge (FUN_00357148 fall) not translated');
    return [chop(r[0]), chop(r[1]), chop(r[2])];   // stored as f32 rounded toward zero (player.js chop)
  }
  // FUN_00357d48: a wall hit not along the edge (collision.js wall45) sets C+0x1c0 0x40000 and 0x80000 (cleared each frame: PM.moveStart, FUN_0034c388). The brains read
  // them (brain3 states 3 / 4 / 5: back to a nav path; path_mover stuck clock). MISSING: FUN_0035a440's actor-actor writes (0x40000 | 0x400, 0x100000; T: dog 65 f224-232).
  function wallBits(a) {
    const C = a.C;
    if (walkCol.wall45) C.f1c0 = (C.f1c0 | 0x40000 | 0x80000) >>> 0;
  }
  // FUN_003590c8 body state 2 (the leap; player.js state 2): FUN_00357d48 walks the ground point body+0x10 (airborne: its rise capped by
  // (v0 + g t) x DAT_004eeb28); the body is at body+0xd8 + body+0xdc. FUN_00326500 true: no landing while rising (t <= rise); below the
  // ground -> body state 0, y = ground.
  // GUESS: a landing on a 0x10 polygon (body state 3 in the game) walks as state 0 (not decoded; see notes/fidelity-audit.md 'Dog leap')
  function airBody(a, mv) {
    if (a.C) a.C.f1c0 = (a.C.f1c0 & ~(0x400 | 0x40000)) >>> 0;              // worker 0269: FUN_00357d48 clears them on every call
    const B = bodyOf(a), y = f(B.y0 + B.dy), g = B.g ?? 235.2;
    if (!walkCol || B.poly === null) return [a.pos[0], y, a.pos[2]];
    const vdt = f(f(B.v0 + f(g * B.t)) * B.dt);
    mv = objPass(a, mv, true);                                                // worker 0269: FUN_0035a440 (FUN_003577c8: air)
    const r = walkCol.navMove(B.poly, a.pos[0], B.gy, a.pos[2], mv[0], mv[2], true, { air: { bodyY: y, vdt } });
    B.poly = r[3];
    wallBits(a);
    B.gy = r[1];
    let land;
    if (B.rise > 0) land = !(B.t <= B.rise);
    else if (B.t <= B.dt) land = (walkCol.polys[B.poly].flags & 0x10) === 0;
    else land = true;
    if (y > B.gy && land) { B.state = 0; return [chop(r[0]), chop(B.gy), chop(r[2])]; }
    return [chop(r[0]), y, chop(r[2])];
  }
  function setCombatLayer(ai, m) {                                            // FUN_0035f9a0 -> FUN_0035fa10
    if (m === ai.cmode && ai.combat) return;
    if (m === 0) stopFire(ai);                                                // FUN_0035fa10 case 0
    // layer 1 = vt 0x4a23a0, layer 2 = vt 0x4a2370 (FUN_0035fa10); other m: none (+0xd8 = 0)
    ai.combat = m === 2 || m === 1 ? { mode: m } : null;
    ai.cmode = ai.combat ? m : 0;
    ai.cstate = 0;
    ai.ctime = short(S.now);                                                  // FUN_0035ebc0
    if (m === 2) stopFire(ai);                                                // start FUN_00360e30
    else if (m === 1) startFire(ai, -1);                                      // start FUN_00360da8 -> FUN_003607a8(ai, -1) (worker 0230)
  }
  // Combat layer 1 (worker 0230; cmd 0x19e(1), the e023 helicopter's script 180): update vt+0x1c FUN_00360dc8: magazine not empty
  // (FUN_003604f0) -> FUN_003607a8(ai, -1) (a timer with no count, kept while one runs), else the reload FUN_00360718. Its vt+0x24
  // FUN_00360e10 (= FUN_00360820, stop) has no caller found on the page's paths.
  function combat1(ai) {
    if (!magEmpty(ai)) startFire(ai, -1);
    else reload(ai);
  }
  const bTime = ai => short(S.now - (ai.btime & 0xffff));                     // FUN_0035eb30
  const cTime = ai => short(S.now - (ai.ctime & 0xffff));                     // FUN_0035eba0

  function brain2(ai) {                                                       // FUN_00362ef8
    const a = ai.owner;
    if (ai.bstate !== 1 && busy(a)) ai.bstate = 1;
    if (attacking(a)) return;
    if (!target(ai)) ai.bstate = 5;
    switch (ai.bstate) {
      case 0:
        setActorState(a, 3);
        // FUN_0055a828: stop (FUN_003533e0); standing, nothing to stop on the page
        setActionLayer(ai, 0);
        a.C.s214 = 6;                                                         // FUN_0034e960(C, 6)
        if (!target(ai)) { ai.btime = short(S.now); a.C.s214 = 6; ai.bstate = 2; return; }
        // C+0x808 bit 0 (stance flags): shooter -> 3 (e027 / e048: 0x872b, trace), else 7 (e030: 0x8c44)
        ai.bstate = (a.C.f808 & 1) ? 3 : 7;
        return;
      case 1: if (busy(a)) return; break;
      case 2: if (bTime(ai) < 0x1f) return; ai.btime = short(S.now); break;
      case 3: setCombatLayer(ai, 2); ai.bstate = 4; ai.btime = short(S.now); return;
      case 5:
        if (!(ai.flags & 0x40)) setActorState(a, 3);
        else warnOnce('enemy_ai: brain 5 with AI bit 0x40 (motions 0xb6 / 2) not translated');
        a.C.s214 = 6; ai.bstate = 6;
      // fall through
      case 6: if (!target(ai)) return; break;
      case 7: case 8:
        warnOnce(`enemy_ai: brain states 7/8 (non-shooter, ${a.model}) not translated`);   // e030 (stance 0x23)
        return;
      default: return;
    }
    ai.bstate = 0;
  }

  // Mode 1 start FUN_003628f8: interval 5, no action layer; unless busy: stop (FUN_0055a828: standing,
  // nothing to stop), turn mode 6, actor state 5 if crouched (actor +0x100 bits 40-41 == 1) else 3.
  function start1(ai) {
    const a = ai.owner;
    ai.interval = 5;
    setActionLayer(ai, 0);
    if (busy(a)) return;
    a.C.s214 = 6;                                                             // FUN_0034e960(C, 6)
    setActorState(a, (a.stance & 3) === 1 ? 5 : 3);
  }

  // Mode 1 brain FUN_00362998: mode 2's shooter (FUN_00362ef8) with a posture change. In state 4, with
  // stance flag C+0x808 bit 3 (e027 / e048 0x872b), every run once 0x79 ticks have passed since the
  // last change: one FUN_0040b5c0 draw, < 0.2 -> actor state 5 (crouch) when standing, 3 (stand) when
  // crouched, combat layer off, state 5; 0x1f ticks later -> 3 (combat layer 2 again). No target -> 6.
  function brain1(ai) {
    const a = ai.owner;
    if (ai.bstate !== 1 && busy(a)) ai.bstate = 1;
    if (attacking(a)) return;
    if (!target(ai)) ai.bstate = 6;
    const crouched = () => (a.stance & 3) === 1;
    switch (ai.bstate) {
      case 0:
        setActorState(a, crouched() ? 5 : 3);
        // FUN_0055a828: stop (FUN_003533e0); standing, nothing to stop
        setActionLayer(ai, 0);
        a.C.s214 = 6;
        if (!target(ai)) { ai.btime = short(S.now); a.C.s214 = 6; ai.bstate = 2; return; }
        if (!(a.C.f808 & 1)) { ai.bstate = 8; return; }                       // non-shooter (e030)
        ai.bstate = 3; return;
      case 1: if (busy(a)) return; break;
      case 2: if (bTime(ai) < 0x1f) return; ai.btime = short(S.now); break;
      case 3:
        setCombatLayer(ai, 2); ai.bstate = 4; ai.btime = short(S.now);
      // fall through
      case 4:
        if (ai.flags & 0x40) {
          // FUN_0035fe80 / FUN_0035fec0 (target re-pick -> state 3): AI bit 0x40 is never set on the page
          warnOnce('enemy_ai: mode 1 state 4 with AI bit 0x40 (FUN_0035fe80) not translated');
        }
        if (!(a.C.f808 & 8)) return;
        if (bTime(ai) < 0x79) return;
        if (!(rng() < 0.2)) return;                                           // FUN_0040b5c0
        setActorState(a, crouched() ? 3 : 5);
        ai.btime = short(S.now);
        setCombatLayer(ai, 0);
        ai.bstate = 5;
        return;
      case 5: if (bTime(ai) < 0x1f) return; ai.bstate = 3; return;
      case 6:
        if (!(ai.flags & 0x40)) setActorState(a, 3);
        else warnOnce('enemy_ai: brain 1 state 6 with AI bit 0x40 (motions 0xb6 / 2) not translated');
        a.C.s214 = 6; ai.bstate = 7;
      // fall through
      case 7: if (!target(ai)) return; break;
      case 8: {
        // no target, or the target dead (FUN_0035edc0 -> FUN_0055a370 -> FUN_00316d08) -> state 0
        const t = target(ai);
        if (!t || deadFinal(t)) break;
        if (G64 < 0x18) return;                                               // FUN_00310c40
        if (bTime(ai) < 0x3d) return;
        if (Math.trunc(f(rng() * 11.0)) !== 0) return;                        // FUN_0040b5c0
        const i = attackPick(ai);                                             // FUN_0035ff98
        if (i < 0) return;
        // FUN_00353418(C) (stop: standing), FUN_0035f9a0(ai, 0), FUN_0055baa8(a, i, 0): the attack actor state
        setCombatLayer(ai, 0);
        startAttack(a, i);
        ai.bstate = 9;
        return;
      }
      case 9:
        if (!attacking(a)) { ai.interval = 6; a.C.s214 = 6; ai.bstate = 8; ai.btime = short(S.now); }   // AI +0x20 (interval) = 6
        return;
      default: return;
    }
    ai.bstate = 0;
  }
  // FUN_0035f7c0(ai, n) / FUN_0035f8b0(ai, n): one FUN_0040b5c0 draw against odds from AI +0x98 / +0x99
  // (signed bytes, record +0x4c / +0x4d): b >= n -> 0.5 + (b - n) x 0.5 / (100 - n), else 0.5 - (b - n) x
  // 0.5 / (-100 - n). n >= 100 -> false, n < -99 -> true (no draw).
  function odds(b, n) {
    if (n >= 100) return false;
    if (n < -99) return true;
    const k = b - n;
    const p = b < n ? f(0.5 - f(f(k * 0.5) / (-100 - n))) : f(f(f(k * 0.5) / (100 - n)) + 0.5);
    return rng() < p;
  }
  const odds98 = (ai, n) => odds(ai.b98, n);                                  // FUN_0035f7c0
  const odds99 = (ai, n) => odds(ai.b99, n);                                  // FUN_0035f8b0
  // FUN_00360518: AI +0x100 (W) set and 0 <= rounds (+0x7c) <= W+0x48 (magazine) / 2
  const halfEmpty = ai => !!ai.W && ai.rounds >= 0 && ai.rounds <= (short(ai.W.mag) >> 1);
  // FUN_0035f768(ai, 1): AI flag 8, then FUN_00365d20: every other AI on the scheduler list whose actor is
  // on a friendly side (FUN_005633d8: table 0x58d9f0 by actor +0x188) within 100 (FUN_0054aa50) takes
  // this AI's target if it has none, and gets flag 8. MISSING: the side table / actor +0x188 are not
  // read, so the others are not alerted (only this AI's flag 8 is set).
  function alert(ai) {
    ai.flags |= 8;
    warnOnce('enemy_ai: FUN_00365d20 alert of nearby allies (side table 0x58d9f0) not translated');
  }

  // Mode 5 brain FUN_003639d0 (class 0x4a2770; most soldiers' scripts switch to it when hit). Brain
  // object: [0] AI, [1] actor, [3] body C. State in AI +0x24. Action layers 2 / 3 / 5 / 6 move the
  // soldier (setActionLayer: not translated, he stands); the combat layer 2 shoots.
  function brain5(ai) {
    const a = ai.owner, C = a.C;
    if (ai.bstate !== 1 && busy(a)) ai.bstate = 1;
    if (attacking(a)) return;
    const t = target(ai);
    const tdead = !!t && deadFinal(t);                                        // FUN_0035edc0 -> FUN_0055a370 -> FUN_00316d08
    let st = ai.bstate;
    for (let guard = 0; guard < 8; guard++) {                                 // the switch's fall-throughs / gotos
      switch (st) {
        case 0:
          if (target(ai)) { if (!tdead) { st = 5; continue; } st = 3; continue; }
          st = 2;
        // fall through
        case 2: setActorState(a, 6); ai.bstate = 4; return;
        case 1:
          if (busy(a)) return;
          if (ai.flags & 0x40) warnOnce('enemy_ai: mode 5 state 1 with AI bit 0x40 (FUN_0035fe08) not translated');
          ai.bstate = 0; return;
        case 3: setActorState(a, 3); ai.bstate = 4; return;
        case 4:
          if (!(ai.flags & 2)) { if (!(ai.flags & 8)) return; if (!target(ai)) return; }
          alert(ai);                                                          // FUN_0035f768(ai, 1)
          st = 5; continue;
        case 5:
          if (ai.flags & 0x40) warnOnce('enemy_ai: mode 5 state 5 with AI bit 0x40 (FUN_0035fe80 / FUN_0035fec0) not translated');
          setActorState(a, 3);
          setCombatLayer(ai, 2);
          setActionLayer(ai, 2);
          C.s214 = 6;                                                         // FUN_0034e960(C, 6)
          ai.f74 = 0;                                                         // FUN_00360940
          ai.hits = 0;                                                        // FUN_003608b0 (+0x70)
          ai.btime = short(S.now);                                            // FUN_0035eb50
          ai.bstate = st = 6;
        // fall through
        case 6:
          if (!(ai.flags & 2)) {
            if (halfEmpty(ai)) { reload(ai); return; }                        // FUN_00360518 -> FUN_00360718
            if (bTime(ai) < 0x79) return;
            ai.bstate = 7; return;
          }
          if (C.f1c0 & 0x100000) { ai.bstate = 0x11; return; }
          if (ai.d34 < 22.0) { setCombatLayer(ai, 0); ai.bstate = 10; return; }
          if ((ai.hits & 0xffff) < 3) {
            if ((ai.f74 & 0xffff) < 3) {
              if (bTime(ai) < 0x79) return;
              ai.bstate = !odds98(ai, 0) ? 0xe : (3 < (ai.f78 & 0xffff) ? 7 : 0xc);
            } else {
              ai.f74 = 0;
              ai.bstate = odds98(ai, 0) ? 7 : 0xe;
            }
            return;
          }
          ai.hits = 0; ai.bstate = 0xc; return;                               // LAB_00364198
        case 7:
          setActorState(a, 3);
          C.f1c0 |= 0x10;
          setCombatLayer(ai, 2);
          setActionLayer(ai, 3);
          C.s214 = 6;
          ai.f78 = 0;                                                         // FUN_003609d8
          ai.btime = short(S.now);
          ai.bstate = 8; return;
        case 8:
          if (C.f1c0 & 0x100000) { ai.bstate = 0x11; return; }
          if (!(ai.flags & 2)) { if (bTime(ai) > 0x78) { st = 5; continue; } }   // LAB_00363b64 -> case 5
          else ai.btime = short(S.now);
          if (25.0 <= ai.d34) {
            if ((ai.f78 & 0xffff) === 0) return;
            ai.f78 = 0; ai.btime = short(S.now); ai.bstate = st = 9; continue;
          }
          setCombatLayer(ai, 0); ai.bstate = 10; return;
        case 9: if (bTime(ai) < 0x3d) return; ai.bstate = 5; return;
        case 10: {
          if (tdead) { ai.bstate = 0; return; }
          const i = attackPick(ai);                                           // FUN_0035ff98
          if (i < 0) { ai.bstate = 0xe; return; }
          startAttack(a, i);                                                  // FUN_0055baa8(a, i, 0)
          ai.bstate = 0xb; return;
        }
        case 0xb: if (attacking(a)) return; ai.bstate = 0xe; return;
        case 0xc:
          setActionLayer(ai, 6); ai.btime = short(S.now); ai.bstate = st = 0xd;
        // fall through
        case 0xd:
          if (bTime(ai) < 0x79) { if (bTime(ai) < 0x3d) return; if (ai.flags & 2) return; }
          ai.bstate = 5; setActionLayer(ai, 0); return;
        case 0xe:
          setActionLayer(ai, 5);
          setCombatLayer(ai, 2);
          setActorState(a, 3);
          C.s214 = 6;
          if (odds98(ai, 0)) C.f1c0 |= 0x10; else C.f1c0 &= ~0x10;            // FUN_0035f890 (= FUN_0035f7c0 ^ 1) == 0 -> set
          ai.btime = short(S.now);
          ai.bstate = odds98(ai, 0) ? 0x10 : 0xf; return;
        case 0xf:
          if (bTime(ai) > 0xb4) break;
          if (bTime(ai) < 0x3d) return;
          if (!target(ai)) return;
          if (ai.d34 <= 200.0) return;
          break;
        case 0x10:
          if (bTime(ai) > 0x3c) break;
          if (bTime(ai) < 0x1f) return;
          if (!target(ai)) return;
          if (ai.d38 <= 20.0) return;
          break;
        case 0x11:
          setActorState(a, 3);
          setCombatLayer(ai, 2);
          setActionLayer(ai, 0);
          // FUN_0055a828: stop (standing, nothing to stop)
          C.s214 = 6;
          ai.f78 = 0;
          ai.btime = short(S.now);
          ai.bstate = st = 0x12;
        // fall through
        case 0x12:
          if (!(C.f1c0 & 0x100000)) { ai.bstate = 5; return; }
          if ((ai.hits & 0xffff) < 2) return;
          ai.hits = 0; ai.bstate = 0xc; return;
        default: return;
      }
      // LAB_003640e0 (states 0xf / 0x10)
      ai.bstate = 5; setActionLayer(ai, 0); C.f1c0 |= 0x10;
      return;
    }
  }

  // Mode 6 brain FUN_00364558 (class 0x4a2830). States 3-5 need the action layers 5 / 7 (not translated).
  function brain6(ai) {
    const a = ai.owner, C = a.C;
    if (ai.bstate !== 1 && busy(a)) ai.bstate = 1;
    if (attacking(a)) return;
    const t = target(ai);
    const tdead = !!t && deadFinal(t);
    const unseen = () => S.now - ai.seen;                                     // FUN_00360a78: now - AI +0x64
    // states 2-5, unconditional: c = FUN_0035fe80(ai, 0, 0) (= FUN_005608e8); FUN_0035fec0(ai, c) != 0 ->
    // FUN_0035fc98(ai, c) again
    const repick = () => { const c = candidate(); if (retarget(ai, c)) setTarget(ai, c); };
    const tryAttack = () => {                                                 // LAB_00364a08
      const i = attackPick(ai);
      if (i < 0) return;
      // FUN_00353418(C): stop (standing)
      setCombatLayer(ai, 0);
      startAttack(a, i);
      ai.bstate = 6;
    };
    switch (ai.bstate) {
      case 0:
        if (!target(ai) || tdead) { pickTarget(ai); return; }                 // FUN_0035fe08 (candidate: GUESS, see candidate)
        setActorState(a, 3); C.s214 = 6; setCombatLayer(ai, 2); setActionLayer(ai, 5);
        C.f1c0 &= ~0x10; ai.btime = short(S.now); ai.bstate = 2; return;
      case 1: if (!busy(a)) ai.bstate = 0; return;
      case 2: {
        repick();
        if (150.0 < ai.d34 && !(ai.flags & 2) && 300 < unseen()) {
          ai.hits = 0; ai.f72 = 0; ai.btime = short(S.now); ai.bstate = 3; C.f1c0 |= 0x10; return;
        }
        if (G64 < 0x18) return;                                               // FUN_00310c40
        let go = false;
        if (!(ai.flags & 0x200)) { if (0x78 < bTime(ai)) go = Math.trunc(f(rng() * 11.0)) === 0; }
        else if (0x3c < bTime(ai)) go = odds98(ai, 0);
        if (go) tryAttack();
        return;
      }
      case 3:
        repick();
        if (30.0 <= ai.d34 && !(ai.flags & 2) && !ai.hits && !ai.f72) {
          if (unseen() < 0x12d) {
            if (G64 < 0x18) return;
            if (bTime(ai) < 0x79) return;
            if (Math.trunc(f(rng() * 11.0)) !== 0) return;
            tryAttack(); return;
          }
          let nb;
          if (unseen() < 0x12c0) { setActorState(a, 3); C.s214 = 6; ai.btime = short(S.now); nb = 4; }
          else {
            // FUN_003455e8: the stance has row 0xb6 -> actor state 0x1b, row 2 -> 6, else 3 (AI bit 0x200) / 2
            const s2 = clipOf(a, 0xb6) ? 0x1b : clipOf(a, 2) ? 6 : (ai.flags & 0x200) ? 3 : 2;
            setActorState(a, s2);
            C.s214 = (ai.flags & 0x200) ? 6 : 5;
            ai.btime = short(S.now); nb = 5;
          }
          ai.bstate = nb; C.f1c0 |= 0x10; setActionLayer(ai, 7); return;
        }
        break;
      case 4: case 5:
        repick();
        if (30.0 <= ai.d34 && !(ai.flags & 2) && !ai.hits && !ai.f72) {
          if (ai.bstate !== 4) return;
          if (unseen() < 0x12c0) return;
          // FUN_00360200(70, ai): |aim point - AI +0x80| > 70. MISSING: AI +0x80 (a remembered point)
          // is not tracked; the state stays.
          warnOnce('enemy_ai: mode 6 state 4 (FUN_00360200, AI +0x80) not translated');
          return;
        }
        break;
      case 6:
        if (!attacking(a)) { ai.interval = 6; ai.bstate = 0; ai.btime = short(S.now); }   // AI +0x20 = 6
        return;
      default: return;
    }
    ai.btime = short(S.now); ai.bstate = 0; C.f1c0 &= ~0x10;                 // LAB_00364acc
  }

  // ---- Mode 3 brain FUN_00361690 (class vt 0x4a2510, start 0x361648; worker 0252). Script 222 (the dogs, e030) sets it
  // when the dog is hit (event 8), on its timer (event 1) or at activation with var 7 == 1 (event 3). Brain object:
  // [0] AI, [1] actor, [3] body C; state AI +0x24, AI +0x20 = the scheduler interval, AI +0x9a = the node kept in state 3.
  // FUN_003600c0(ai, n): signed byte C+0x7e4 (the zone header, FUN_00340760) +0x60 + n, -1 without a header
  // (ai.json sizes[zone set].p60; e030: n 1 -> attack 5 st_btl, n 2 -> attack 4 b_stp).
  function specialAttack(ai, n) {
    const rec = data.records[ai.owner.rec], z = data.sizes && rec && rec.zones >= 0 ? data.sizes[rec.zones] : null;
    if (!z) return -1;
    if (!z.p60) { warnOnce('enemy_ai: ai.json sizes have no p60 (re-export data/enemies): FUN_003600c0 gives -1'); return -1; }
    return z.p60[n];
  }
  // FUN_00353418(C): FUN_0034e880(C, 1), C+0x214 (turn mode) = 0, C+0x1c4 bit 1 clear. FUN_0034e880 with turn mode 1 / 3 / 6
  // sends the body listener C+0x540 event 7 (FUN_005690c8 -> FUN_00588550 jump table 0x591ef0 [7]: not translated).
  function stopTurn(a) {
    const C = a.C;
    if (C.s214 === 1 || C.s214 === 3 || C.s214 === 6) warnOnce('enemy_ai: FUN_0034e880 listener event 7 (FUN_00588550 case 7) not translated');
    C.s214 = 0;
    C.f1c4 = (C.f1c4 & ~2) >>> 0;
  }
  // FUN_00562d90(t, a, n): node n set and |t - node n| > 30 (FUN_00563bc0); u = unit(node n - a), v = unit(t - a);
  // FUN_00259d58 = the angles of u minus those of v (FUN_00260f54 in world axes: [1] = atan2(x, z)), each wrapped by
  // FUN_00260bc8(x, pi) = 13 signed bits of x / pi x 4096, truncated, times pi / 4096; true when |a - t| < 300
  // (FUN_0054a888) and |angle [1]| > pi / 4.
  function nodeOffTarget(t, a, n) {
    if (n === -1) return false;
    if (!(30.0 < nodeDist(t, n))) return false;
    const q = G ? NG.node(G, n) : null;
    if (!q) return false;
    const u = sub3([q[0], q[1], q[2]], a.pos), v = sub3(t.pos, a.pos);
    const pi = 3.1415927;                                                     // 0x40490fdb
    const wrap = x => f(f(((Math.trunc(f(f(x / pi) * 4096.0)) << 19) >> 19) * pi) * 0.00024414062);
    const d1 = wrap(f(f(Math.atan2(u[0], u[2])) - f(Math.atan2(v[0], v[2]))));
    return len3(v) < 300.0 && 0.7853982 < Math.abs(d1);
  }
  const FLAG13 = true;                                                        // FUN_00326298(0xd): script flag 13, set in z128 (path_mover.js)
  function brain3(ai) {
    const a = ai.owner, C = a.C;
    const near = 50.0;                                                        // fVar13
    let reach = 20.0;                                                         // fVar14
    if (ai.bstate !== 1 && busy(a)) { setCombatLayer(ai, 0); ai.bstate = 1; }
    if (attacking(a)) return;
    if (target(ai)) reach = f(f(R_PLAYER + a.size.r) + 5.0);                  // target +0x2c + actor +0x2c + 5
    const vis = () => !!(ai.flags & 2);                                       // FUN_00360bb8(ai, 1)
    const tAlive = () => { const t = target(ai); return !!t && !deadFinal(t); };   // FUN_0035edc0 -> FUN_0055a370 -> FUN_00316d08
    let st = ai.bstate;
    for (let guard = 0; guard < 8; guard++) {
      switch (st) {
        case 0: {
          setCombatLayer(ai, 0);
          // a target seen (AI +0x14 bits 1 and 2: FUN_003601d8) goes straight on
          if (!(target(ai) && (ai.flags & 2) && (ai.flags & 4))) {
            setActorState(a, (ai.flags & 0x200) ? 3 : 2);
            // AI bit 0x40: FUN_0035fe08 (the candidate search). No target: actor +0x188 in 1..2 (FUN_00563340 ->
            // FUN_00563288; the dogs' is 1, T: route RAM r03_spot2 object 87) -> FUN_0035fd20 = the player
            // (FUN_0053bb08), else FUN_0035fe08. GUESS: actor +0x188 is not exported, taken as 1 (every e030).
            if (ai.flags & 0x40) pickTarget(ai);
            else if (!target(ai)) setTarget(ai, P);
            if (!target(ai)) return;
            if (deadFinal(target(ai))) return;
          }
          ai.btime = short(S.now); ai.bstate = st = 2;
          continue;
        }
        case 2: {
          ai.interval = 5;
          let lab = 'L1990';
          if (!(ai.d34 < f(reach + 10.0))) {
            if (!(ai.d3c < 5.0 && ai.d40 < 2.0 && -27.0 < ai.d40)) {
              if (!(C.f1c0 & 0x100000)) lab = 'L19ac';
              else if (!(C.f808 & 1) && attackPick(ai) === -1) lab = 'L19ac';
            }
          }
          if (lab === 'L1990') { PM.setTurn(a, 6); ai.btime = short(S.now); ai.bstate = 6; return; }
          // LAB_003619ac
          let turn;
          if (ai.d38 < 250.0 && (C.f808 & 1)) { setCombatLayer(ai, 2); setActorState(a, 3); turn = 6; }
          else if (!(ai.flags & 0x200)) {                                     // LAB_00361a04
            setCombatLayer(ai, 0);
            // the target's +0x15a (FUN_00542ab8 / FUN_0056a8c8: other-side actors pressing on it) >= 2 and a lost
            // FUN_0035f7c0(ai, -50) draw -> state 0xb. GUESS: +0x15a = 0 (the side table FUN_005632c0 is not
            // decoded); one dog never takes this branch.
            if (specialAttack(ai, 1) >= 0 && target(ai) && ai.d38 < 80.0 && 10.0 < ai.d38) {
              const b15a = 0;
              if (b15a >= 2 && !odds98(ai, -50)) { ai.bstate = st = 0xb; continue; }
            }
            C.f1c0 = (C.f1c0 | 0x8000) >>> 0;
            setActorState(a, (ai.flags & 0x200) ? 3 : 2);
            turn = 5;
          } else { setActorState(a, 3); turn = 6; }
          PM.setTurn(a, turn);
          ai.bstate = st = 3;
          continue;
        }
        case 3: {
          if (!target(ai)) { ai.bstate = 0; return; }
          if (ai.d38 < near && vis() && !(C.f1c0 & 0x40000) && !(C.f1c0 & 0x100000)) {
            if (reach <= ai.d34) {
              C.f1c0 = (C.f1c0 & ~0x10) >>> 0;
              PM.approachStart(a, target(ai), f(reach * 0.8), 1000.0, placeBody, warnOnce);   // FUN_00353110 + FUN_0034edf0(C, 3)
              ai.bstate = 5; ai.btime = short(S.now); return;
            }
            PM.setTurn(a, 6); ai.btime = short(S.now); ai.bstate = 6; return;
          }
          // a nav-graph path toward a free node next to the target (as action layer 3's 0x366908)
          NG.trackNode(G, a);                                                 // FUN_00563970(a, -1)
          const sn = G ? a.node108 : -1;
          if (!target(ai)) { ai.bstate = 0; return; }
          const goal = G ? NG.freeNeighbour(G, target(ai), rng) : -1;         // FUN_00563d20(t, 1, 1)
          if (!sameArea(sn, goal)) {
            C.f1c0 = (C.f1c0 | 0x10) >>> 0;
            navPath(a, { goal, s4: 6, max: 10, mode: 1, flags: 0x87 | searchFlags(ai), c: 100.0 });
          } else {
            // DAT_0046f4e8 != 0 also takes the synchronous request (0 in the save RAM)
            if (!NG.queueFree(svc)) navPath(a, { goal, s4: 4, max: 7, mode: 6, flags: 0x87 | searchFlags(ai), c: 100.0 });
            else { ai.btime = short(S.now); navPathTo(a, goal); }
            C.f1c0 = (C.f1c0 & ~0x10) >>> 0;
          }
          ai.interval = 0x1e;
          ai.btime = short(S.now);
          ai.n9a = a.node108;
          ai.bstate = 4; return;
        }
        case 4: {
          const t = target(ai);
          const out = t ? coneAngles(a, t) : [0, 0];                          // FUN_0035e9b0: [0] uStack_b0, [1] fStack_ac
          if ((ai.flags & 0x40) && retarget(ai, candidate())) { ai.bstate = 2; return; }   // FUN_0035fe80 / FUN_0035fec0
          if (C.f1c0 & 0x100000) { PM.setTurn(a, 6); ai.btime = short(S.now); PM.stopAll(a, warnOnce); ai.bstate = 6; return; }
          let go;
          if (Math.abs(out[1]) < 0.5235988 && !(0.69813174 <= Math.abs(out[0])) && !(150.0 <= ai.d38) && !(ai.d40 <= -25.0)) go = true;
          else go = ai.d34 < reach && !(C.f1c0 & 0x40000);                    // LAB_00361f1c / LAB_00361f20
          if (go && ai.d38 < near && vis() && !(C.f1c0 & 0x40000) && FLAG13) {
            C.f1c0 = (C.f1c0 & ~0x10) >>> 0;
            PM.approachStart(a, t, f(reach * 0.8), 1000.0, placeBody, warnOnce);
            // FUN_003577c8(body): body state +0xa8 in 2..3 / 6..7 -> FUN_0034b110(min(w, 1), C), w = the FUN_0034b070 copy's
            // +0xc = 1.0 (0x34b078 vmove.w vf1, vf0 overwrites C+0xcc in the copy), so the argument is always 1.0 (0x362008)
            if (a.B && [2, 3, 6, 7].includes(a.B.state)) PM.wantFace(a, 1.0);
            if (C.f808 & 1) { setCombatLayer(ai, 2); setActorState(a, 3); PM.setTurn(a, 6); }
            ai.bstate = 5; ai.btime = short(S.now); return;
          }
          if (!(bTime(ai) < 0x709) && PM.navGoal(C) === -1) {
            ai.interval = 0x3c; ai.btime = short(S.now); PM.setTurn(a, 6); PM.stopAll(a, warnOnce); ai.bstate = 6; return;
          }
          if (C.mover === 0) {
            if (a.node108 !== ai.n9a) { ai.interval = 6; ai.bstate = 2; return; }
            ai.interval = 0x3c; PM.setTurn(a, 6); ai.btime = short(S.now); PM.stopAll(a, warnOnce); ai.bstate = 6; return;
          }
          if (target(ai)) {                                                   // FUN_0035edc0 (no death test here)
            if (nodeOffTarget(target(ai), a, PM.navGoal(C)) && !(bTime(ai) < 0x78) && ai.d38 < 60.0) { ai.interval = 6; ai.bstate = 2; return; }
          }
          if ((ai.flags & 0x200) && target(ai) && !(G64 < 0x18) && !(bTime(ai) < 0x79) && odds98(ai, 0)) {
            const i = attackPick(ai);
            if (i >= 0) { PM.stopAll(a, warnOnce); stopTurn(a); setCombatLayer(ai, 0); startAttack(a, i); ai.bstate = 7; return; }
          }
          if (!(C.f1c0 & 0x100000)) return;
          ai.btime = short(S.now); PM.stopAll(a, warnOnce); PM.setTurn(a, 6); ai.bstate = 6; return;
        }
        case 5: {
          if (C.mover !== 0 && 1.0 <= ai.d38) {
            if (C.f1c0 & 0x100000) { PM.setTurn(a, 6); PM.stopAll(a, warnOnce); ai.bstate = 6; ai.btime = short(S.now); return; }
            if ((ai.d38 <= near + near || vis()) && (!(C.f1c0 & 0x40000) || ai.d34 <= f(reach * 1.2))) {
              if (!tAlive()) { ai.bstate = 9; return; }
              if (G64 < 0x18) return;
              if (bTime(ai) < 0x3d) return;
              if (Math.trunc(f(f(rng()) * 11.0)) !== 0) return;
              const i = attackPick(ai);
              if (i < 0) return;
              PM.stopAll(a, warnOnce); stopTurn(a); setCombatLayer(ai, 0); startAttack(a, i); ai.bstate = 7; return;
            }
            ai.interval = 6; ai.bstate = 3; return;
          }
          PM.stopAll(a, warnOnce); PM.setTurn(a, 6); ai.interval = 6; ai.bstate = 2; return;
        }
        case 6: {
          if (!tAlive()) { ai.bstate = 9; return; }
          const i = attackPick(ai);
          if (i >= 0) { setCombatLayer(ai, 0); PM.stopAll(a, warnOnce); stopTurn(a); startAttack(a, i); ai.bstate = 7; return; }
          if ((C.f1c0 & 0x100000) && (C.f808 & 1)) { setCombatLayer(ai, 2); setActorState(a, 3); PM.setTurn(a, 6); ai.bstate = 8; return; }
          if (15.0 <= ai.d38) { if (bTime(ai) < 0x79) return; ai.interval = 6; ai.bstate = 2; return; }
          PM.setTurn(a, 6); ai.bstate = 10; return;
        }
        case 7: {
          ai.interval = 6;
          if (ai.d38 < 20.0) {
            const i = specialAttack(ai, 2);
            if (i >= 0 && odds99(ai, 0x32)) { startAttack(a, i); ai.bstate = 7; return; }
          }
          ai.bstate = 2; return;
        }
        case 8: PM.setTurn(a, 6); ai.bstate = 6; return;
        case 9:
          pickTarget(ai);                                                     // FUN_0035fe08
          if (target(ai) && ai.d38 < 200.0) { PM.setTurn(a, 6); ai.btime = short(S.now); ai.bstate = 6; return; }
          ai.bstate = 8; return;
        case 10: {
          if (!tAlive()) { ai.bstate = 9; return; }
          if (15.0 < ai.d38) { PM.setTurn(a, (ai.flags & 0x200) ? 6 : 5); ai.interval = 6; ai.bstate = 2; return; }
          const i = attackPick(ai);
          if (i < 0) return;
          PM.setTurn(a, (ai.flags & 0x200) ? 6 : 5);
          setCombatLayer(ai, 0); PM.stopAll(a, warnOnce); stopTurn(a); startAttack(a, i); ai.bstate = 7; return;
        }
        case 0xb: {
          const i = specialAttack(ai, 1);
          if (i < 0) { ai.bstate = 2; return; }
          startAttack(a, i); ai.bstate = 7; return;
        }
        case 1:
          if (busy(a)) return;
          if (ai.flags & 0x40) pickTarget(ai);                                // FUN_0035fe08
          ai.bstate = 0; return;
        default: return;
      }
    }
  }
  // ------------------------------------------------ melee: attack pick and attack state
  // The attack table C+0x7e8 = zone header +0x34 (FUN_00340760 at activation; ai.json attacks[zone set],
  // export_web_triggers.attacks). e027 / e048: one entry (m_atk / r_atk / r_atk_0), e030: seven.
  const attackTable = a => {
    const rec = data.records[a.rec];
    return data.attacks && rec && rec.zones >= 0 ? data.attacks[rec.zones] || null : null;
  };
  // FUN_003479c0(C, &yaw, &pitch, &dist, point): the point relative to the body's matrix (C+0x54c vt+0x24):
  // dist = (short)(int)|point - origin|; the unit direction through the inverse rotation (FUN_00261540:
  // transposed 3x3), then FUN_00260f54 (localAngles) -> two angles: yaw byte = (char)(int)(a1 x 40.743664)
  // (256 per turn), pitch = (char)(int)(a0 x 5.092958) (32 per turn; negative = the point above). z128's entries
  // all have yaw 0 with a symmetric tolerance; the pitch limits are e030's (pitch nibbles 0x4c: [-4, 4)).
  function attackAngles(a, pt) {
    const v = sub3(pt, a.pos);
    const dist = short(Math.trunc(f(Math.sqrt(f(f(f(v[0] * v[0]) + f(v[1] * v[1])) + f(v[2] * v[2]))))));
    const [pitch, yaw] = localAngles(a, unit3(v));
    const c8 = n => ((Math.trunc(n) << 24) >> 24);
    return { dist, yaw: c8(f(yaw * 40.743664)), pitch: c8(f(pitch * 5.092958)) };
  }
  // FUN_00347af0(C, entry, yaw, pitch, dist): +8 <= dist <= +0xa, |(char)(yaw - +0xc)| <= |(char)+0xd|;
  // flags bit 1: pitch in [low nibble, high nibble) (signed nibbles of +0xe).
  function attackFits(e, ang) {
    if (!(e.min <= ang.dist && ang.dist <= e.max)) return false;
    const dy = Math.abs(((ang.yaw - e.yaw) << 24) >> 24);
    let ok = dy <= Math.abs(e.tol);
    if (e.flags & 2) {
      const lo = ((e.pitch & 0xf) << 28) >> 28, hi = ((e.pitch >> 4 & 0xf) << 28) >> 28;
      if (ang.pitch < lo) ok = false;
      else if (hi <= ang.pitch) ok = false;
    }
    return ok;
  }
  // FUN_00347bd8(C, point, visible): G+0x64 < 0x18 -> a random entry; else the entries that pass (flags
  // bit 0 never; C+0x1c0 bit 0x100000 clear: bit 3 only below 0x2d; set: dist >= 0x19 unless bit 2;
  // then, when visible, FUN_00347af0), at most 16, one picked by a FUN_0040b5c0 draw. -1 = none.
  function attackScan(a, pt, vis) {
    const T = attackTable(a);
    if (G64 < 0x18) {
      if (!T || !(T.entries.length > 0)) return -1;
      return Math.trunc(f(T.entries.length * rng()));
    }
    if (!T || T.alt) return -1;                                               // +0x2c set: the old form (no attack)
    const ang = attackAngles(a, pt);
    const ok = [];
    for (let i = 0; i < T.entries.length && ok.length < 16; i++) {
      const e = T.entries[i];
      if (e.flags & 1) continue;
      if (!(a.C.f1c0 & 0x100000)) { if (!(G64 < 0x2d || !(e.flags & 8))) continue; }
      else if (!(e.flags & 4) && ang.dist < 0x19) continue;
      if (vis && attackFits(e, ang)) ok.push(i);
    }
    return ok.length ? ok[Math.trunc(f(ok.length * rng()))] : -1;
  }
  // FUN_0035ff98(ai): no target -> -1; else FUN_00347bd8(C, aim point FUN_00360558, AI flag 2). None, and the target
  // right overhead (d3c < 5, -27 < d40 < -20): again with the target's FUN_0054a720 point (its +0x90, the feet).
  function attackPick(ai) {
    const a = ai.owner;
    if (!target(ai)) return -1;
    if (!attackTable(a)) { warnOnce(`enemy_ai: no attack table for ${a.model} (old ai.json: rebuild data/enemies); no attack`); return -1; }
    const i = attackScan(a, aimPoint(a), !!(ai.flags & 2));
    if (i === -1 && target(ai) && ai.d3c < 5.0 && ai.d40 < -20.0 && -27.0 < ai.d40)
      return attackScan(a, objPos90(target(ai)), !!(ai.flags & 2));
    return i;
  }
  // FUN_0055baa8(a, i, 0): actor state 0x80 + i (the rider branch, actor +0x28 bits 0x20 / 0x20000, is
  // not on the page)
  function startAttack(a, i) {
    events.push(`attack ${a.id} ${i}`);
    setActorState(a, 0x80 + i);
  }

  function combat2(ai) {                                                      // FUN_00360e50
    const a = ai.owner;
    if (busy(a)) return;
    const t = target(ai);
    const ts = t;                                                             // target status (FUN_0055a370)
    switch (ai.cstate) {
      case 0: {
        if (magEmpty(ai)) { reload(ai); return; }
        if (!t) { stopFire(ai); ai.cstate = 1; return; }
        if (!ts || !dead(ts)) {
          if ((ai.flags & 2) && (ai.flags & 4)) {                             // FUN_003601d8
            if (!ai.timer) startFire(ai, -1);
            ai.ctime = short(S.now);
            return;
          }
          stopFire(ai);
          // FUN_00360bb8(ai, 1) not decoded (GUESS: false)
          if (cTime(ai) < 0x12d) return;
          ai.cstate = 1; return;
        }
        stopFire(ai);
        ai.cstate = deadFinal(ts) ? 1 : 2;
        return;
      }
      case 1:
        if (cTime(ai) < 0x3d) return;
        pickTarget(ai);                                                       // FUN_0035fe08 (candidate: GUESS, see candidate)
        break;
      case 2:
        if (ts && !dead(ts)) { ai.ctime = short(S.now); ai.cstate = 3; return; }
        if (t) return;
        ai.ctime = short(S.now); ai.cstate = 1; return;
      case 3:
        if (cTime(ai) < 0x1f) return;
        break;
      default: return;
    }
    ai.ctime = short(S.now);
    ai.cstate = 0;
  }

  const magEmpty = ai => ai.W && ai.rounds === 0;                             // FUN_003604f0
  function refill(ai, extra) {                                                // FUN_00360418
    if (!ai.W) return;
    ai.rounds = ai.W.mag;
    if (ai.W.mag < 0) { ai.rounds = -1; return; }                             // 0xffff, no draw
    if (extra) ai.rounds += Math.trunc(Math.fround(((ai.W.mag >> 1) + 1) * rng()));
  }
  function reload(ai) {                                                       // FUN_00360718
    // FUN_005612e8 reload motion (C motion 0x1c / 0x1d): GUESS not translated (no reload clip exported)
    events.push(`reload ${ai.owner.id}`);
    refill(ai, 0);
  }

  // ------------------------------------------------ fire timer list (scheduler +0x2c)
  function timerInsert(e) {                                                   // FUN_00365520: before the first entry with due >= e.due
    let i = 0;
    while (i < S.timers.length && e.due - S.timers[i].due > 0) i++;
    S.timers.splice(i, 0, e);
  }
  function startFire(ai, count) {                                             // FUN_003607a8 -> FUN_00365308
    if (ai.timer || !ai.W) return;
    const e = { due: S.now, ai, left: count, period: ai.W.interval };
    ai.timer = e;
    timerInsert(e);
    // period < 15: FUN_00565ff0(actor, 1) aim pose (not for e027: 180)
    events.push(`timer ${ai.owner.id}`);
  }
  function stopFire(ai) {                                                     // FUN_00360820
    if (!ai.timer) return;
    S.timers.splice(S.timers.indexOf(ai.timer), 1);                           // FUN_00365478
    ai.timer = null;
  }
  function fireTimers() {                                                     // FUN_003656a0
    let n = 0;
    for (const e of S.timers.slice()) {
      if (!(e.due - S.now < 1)) continue;
      if (!S.timers.includes(e)) continue;
      const ai = e.ai;
      let rel = 0;
      if (!magEmpty(ai)) {
        if (ai.flags & 0x10) rel = ai.W.reload;
        else shot(ai);
      } else rel = ai.W.reload;
      S.timers.splice(S.timers.indexOf(e), 1);
      if (e.left > 0) e.left--;
      if (e.left === 0) ai.timer = null;
      else {
        if (rel < 1) {
          e.due = S.now + e.period + n;
          if (JITTER_ON) {
            if (e.period > 12) e.due += Math.trunc(Math.fround(e.period * Math.fround(rng() - 0.5)));
            else {
              const r24 = Math.fround(rng() * 24.0);
              if (r24 < 1.0) e.due += e.period * 2;
              else if (r24 < 2.0) e.due += e.period;
            }
          }
        } else e.due = S.now + rel + n;
        timerInsert(e);
      }
      n++;
      if (n > 1) return;
    }
  }

  // FUN_003605d8: one shot request
  function shot(ai) {
    const a = ai.owner;
    if (ai.rounds === 0) return;
    if (dead(a)) return;                                                      // owner status (AI +0xf4)
    const aim = aimPoint(a).slice();
    const C = a.C;
    if (!(a.f118 & 0x800)) {
      if (C.f564 & 0x4000) {
        if (C.f564 & 0x200000) spawnShot(a, aim);
      } else if (C.speed === 0) {
        if (C.s214 !== 6) C.s214 = 6;
        standShot(a, aim);                                                    // FUN_00341b78
      } else spawnShot(a, aim);
    } else warnOnce('enemy_ai: actor +0x118 bit 0x800 shot (FUN_0055b878) not translated');
    S.shots++; S.total++;
    if (ai.rounds >= 0) ai.rounds = short(ai.rounds - 1);
    events.push(`round ${a.id} ${ai.rounds}`);
  }

  // FUN_003424c0: C+0x670 = aim; while C+0x214 = 6 also the turn target C+0x2b0 = aim + row 0 x
  // stance offset (only with C+0x564 bit 0; e027 0x40000400 / 0x204000 in k_enemy_engage8: offset 0),
  // through FUN_0034b5e0 = the inverse of the body's parent frame (vt+0x2c). The soldiers stand on
  // the static room, so that frame is taken as the world (L: the turn fits the traces with it).
  function setAim(a, aim) {
    const C = a.C;
    C.aim = aim.slice();
    if (C.s214 !== 6) return;
    if (C.f564 & 1) warnOnce('enemy_ai: C+0x564 bit 0 stance offset (C+0x664, DAT_0046f0e8..f4) not translated');
    C.t2b0 = aim.slice();
  }

  // FUN_00341b78: aim point to C+0x670, then motion state (current +0x74) or 0xe
  function standShot(a, aim) {
    setAim(a, aim);
    const m = a.C.motion;
    if (!m) setMotion(a, 0xe);
    else if (m.next74) setMotion(a, m.next74);
  }

  // ------------------------------------------------ locomotion motion states 3 / 8 (worker 0159)
  // Motion state 3 (stand, factory 0x5a6c28 -> FUN_00593e70). Phase 0: FUN_00340bb8(C, 1, -1) (0x10 / 0x14 when
  // the motion came from 0x1c: not on the page); C+0x7c0 set -> FUN_00344608(1.0) (not modelled: never set
  // here); rows 7 and 8 both present -> the idle table FUN_00345b58(C, 1, 7, 8) + FUN_00345f30(C, 0, 1, 1) (each row's
  // turn speed, FUN_00344468), C+0x564 &= ~(8 | 0x10), C+0x568 |= 0x10000 | 0x20000 (locoFrame; e030: st_a / lhtn / rhtn;
  // stance 0x1f has neither); else row 1, flags 0x83 (FUN_003456c0); FUN_00340bb8(C, 1, -1) again. Phase 1: off the
  // ground -> done; moving (C+0x1d8 > 0) -> done, next state 8 (4 with C+0x808 bit 2).
  // T: w159_walk95 (46 / 47 r_gst_lk -> r_gst at the wake, r_grn two frames later).
  function loco3(a, m) {
    const C = a.C;
    if (m.phase === 0) {
      blendSet(a, 1, -1);
      if (clipOf(a, 7) && clipOf(a, 8)) {
        const rows = [1, 7, 8], turn = r => (opts.rootTurn && opts.rootTurn(a.model, clipOf(a, r))) || 0;
        C.loco = { rows, thr: [0, 0], root: [0, 0, 0], turn: rows.map(turn), cur: -1 };
        C.f564 &= ~(8 | 0x10);
        C.f568 |= 0x10000 | 0x20000;
      } else request(a, 1, 0x83);
      blendSet(a, 1, -1);
      m.phase = 1;
      return;
    }
    if (m.phase !== 1) return;
    if (!(C.f1c0 & 0x200)) { m.done |= 1; return; }
    if (C.speed > 0) {
      m.done |= 1;
      setMotion(a, (C.f808 & 4) ? 4 : 8);
    }
  }
  // Motion 0x22 (the fall, FUN_00599820; jump_core.js FallMotion, T on Vincent): phase 0 row 0x19 flags 3; blend 6 after an attack motion, FUN_00340bb8(C, 1, -1) after 0x16, 6-0xa,
  // 0x30, 3, 0x12, 0x1c, 0x1d, else none; phase 2 on the ground -> done: FUN_00341af0 -> state 8's vt+0x1c FUN_00538aa0(0x22): dead 7 (dead actors don't reach this), else 2 (3 with the gun bit).
  // The state's vt+0x24 then gives motion 0x21. NOT TRACED on an actor: no trace has a dog in the air.
  function loco22(a, m) {
    const C = a.C;
    if (m.phase === 0) {
      const p = m.prev;
      if (p >= 0x1000 && p < 0x1080) blendSet(a, 1, 6);
      else if (p === 0x16 || (p >= 6 && p <= 0xa) || p === 0x30 || p === 3 || p === 0x12 || p === 0x1c || p === 0x1d) blendSet(a, 1, -1);
      else blendSet(a, 0, -1);
      request(a, 0x19, 3);
      m.phase = 2;
    } else if (m.phase === 2 && (C.f1c0 & 0x200)) {
      m.done |= 1;
      setActorState(a, C.gun ? 3 : 2);
    }
  }
  // Motion 0x21 (landing, FUN_00599aa0; jump_core.js LandMotion): phase 0 FUN_00340bb8(C, 0, -1), row 0x1a (flags -1 = 2, FUN_00344608); phase 1: clip over or timer >= 30 -> done, next 3 (6 with the gun); timer >= 2 and
  // moving -> done, next 8 (9). Timer += step after the tests.
  function loco21(a, m, step) {
    const C = a.C;
    if (m.phase === 0) { blendSet(a, 0, -1); request(a, 0x1a, 2); m.timer = 0; m.phase = 1; }
    else if (m.phase === 1) {
      if (motionDone(a) || 30.0 <= m.timer) { m.done |= 1; setMotion(a, C.gun ? 6 : 3); return; }
      if (2.0 <= m.timer && 0 < C.speed) { m.done |= 1; setMotion(a, C.gun ? 9 : 8); return; }
    }
    m.timer = f(m.timer + step);
  }
  // Motion state 4 (the turn into a walk, FUN_00592918 case 4 -> ctor 0x594088, vt 0x5a6a28, update FUN_005940e0; worker 0256).
  // Phase 0: a = FUN_00353458(C); FUN_00340bb8(C, 0, -1); FUN_0036a638(deg): |a| < 30 -> 1, >= 150 -> 3, a > 0 -> 2, else 4.
  // 1: FUN_00340bb8(C, 1, -1), done, next. 2: row 3 (flags -1, one shot) else row 7 (0x83); 4: row 4 else row 8; 3: a >= 0 row 5
  // else 7, a < 0 row 6 else 8. Next phase 1 for a one-shot row, 2 for a looped one; FUN_00340bb8(C, 1, -1), timer +0xc = 0.
  // Phases 1 / 2: off the ground -> done. Phase 1 with the motion done, or timer >= 80 -> done, next. Timer >= 5, moving and
  // |a| <= 90 (FUN_0036b008) -> done, next state 8. Else timer += *0x4eeb24 (the step). 'next' = 8 moving, 3 not (0x594534).
  function loco4(a, m, step) {
    const C = a.C, ang = moveAngle(a.face, C.dir || a.face), next = () => { m.done |= 1; setMotion(a, 0 < C.speed ? 8 : 3); };
    if (m.phase === 0) {
      const deg = f(ang * 57.295776), ab = Math.abs(deg);
      blendSet(a, 0, -1);
      const q = ab < 30.0 ? 1 : !(ab < 150.0) ? 3 : deg > 0 ? 2 : 4;
      if (q === 1) { blendSet(a, 1, -1); next(); return; }
      const row = q === 2 ? 3 : q === 4 ? 4 : (0 <= ang ? 5 : 6);
      const alt = q === 2 ? 7 : q === 4 ? 8 : (0 <= ang ? 7 : 8);
      if (clipOf(a, row)) { request(a, row, 2); m.phase = 1; }
      else { request(a, alt, 0x83); m.phase = 2; }
      blendSet(a, 1, -1);
      m.timer = 0;
      return;
    }
    if (m.phase !== 1 && m.phase !== 2) return;
    if (!(C.f1c0 & 0x200)) { m.done |= 1; return; }
    if ((motionDone(a) && m.phase === 1) || 80.0 <= m.timer) { next(); return; }
    if (5.0 <= m.timer && 0 < C.speed && Math.abs(f(ang * 57.295776)) <= 90.0) { m.done |= 1; setMotion(a, 8); return; }
    m.timer = f(m.timer + step);
  }
  // Motion state 8 (walk / run, FUN_00594f98). Phase 0: FUN_00345b58(C, 1, 9, 0x10) installs the rows that have
  // a clip (FUN_003455e8) as the table C+0x5f4 (stride 0x18), FUN_00345e38(0, 30) the thresholds C+0x600 / +0x618,
  // FUN_00345e48(0, 70, 0) the root speeds, FUN_00345e58(C, 0, 1, 1) entries 1 / 2 take their clip's root speed
  // (FUN_00344340, opts.rootSpeed), C+0x564 |= 8 | 0x10; then phase 1 at once. Phase 1: off the ground -> done;
  // standing (C+0x1d8 == 0) -> FUN_00340bb8(C, 1, 0x14), done, next 3; moving with C+0x808 bit 2 (e027's 0x872b has it
  // clear, e030's 0x8c44 set): FUN_00353458 outside +-90 deg (FUN_0036b058; FUN_0036a638 is then never 1) -> done, next 4.
  function loco8(a, m) {
    const C = a.C;
    if (m.phase === 0) {
      const rows = [1, 9, 0x10].filter(r => clipOf(a, r));
      const root = r => (opts.rootSpeed && opts.rootSpeed(a.model, clipOf(a, r))) || 0;
      C.loco = { rows, thr: [0, f(30.0)], root: [0, rows.length > 1 ? f(root(rows[1])) : f(70.0), rows.length > 2 ? f(root(rows[2])) : 0], cur: -1 };
      C.f564 |= 8 | 0x10;
      m.phase = 1;
    } else if (m.phase !== 1) return;
    if (!(C.f1c0 & 0x200)) { m.done |= 1; return; }
    if (C.speed === 0) { blendSet(a, 1, 0x14); m.done |= 1; setMotion(a, 3); return; }
    if ((C.f808 & 4) && !(Math.abs(f(moveAngle(a.face, C.dir || a.face) * 57.295776)) <= 90.0)) { m.done |= 1; setMotion(a, 4); }
  }
  // worker 0267: motion state 9 (walk / run with the gun out) and 0x17 (the same, crouched). Factory FUN_00592918 (compare tree,
  // read from the ELF): case 9 = 0x90 bytes, FUN_00594ef0 (+0x74 = 0xe) then vtable 0x5a6708 (enter FUN_00595370, leave
  // FUN_005953b8, update FUN_00595440); case 0x17 = FUN_00597360 (+0x74 = 0xf), vtable 0x5a5ff0 (enter FUN_005973a0, leave
  // FUN_005973e8, update FUN_00597430). The enters (FUN_00345530(C, 1): C+0x568 bit 0x400000 and the partner pick; FUN_00340de0(C, 1)
  // with C+0x664 == 2) are not modelled. Update: a = FUN_00353458(C) wrapped to [-pi, pi] (0 beyond +-100 pi).
  //   Phase 0: +0x80 = a; FUN_0036aec8 -> FUN_0036a638(deg): |a| < 30 -> 1, >= 150 -> 3, a > 0 -> 2, else 4. The table by that
  //   quadrant: FUN_00345b58(C, r0, r1, r2) (entries with a clip, FUN_003455e8), FUN_00345ca8 / FUN_00345d70 the up / down
  //   partners (each row + 1 / + 2), FUN_00345e58 root speeds (9: entries 1 and 2; 0x17: entry 1), FUN_00345e38(0, t1)
  //   thresholds (9: 24; 0x17: 0), C+0x564 |= 8 | 0x10, phase 1 (the table step runs after the update: locoFrame).
  //     9:    1 (0x40, 0x60, 0x6c) wk / rn   2 (0x40, 0x66, 0x72) lwk / lrn   3 (0x40, 0x63, 0x6f) bwk / brn   4 (0x40, 0x69, 0x75) rwk / rrn
  //     0x17: 1 (0x78, 0x7e) sq_ma           2 (0x78, 0x81) ls_ma             3 (0x78, 0x87) bs_ma             4 (0x78, 0x84) rs_ma
  //   Phase 1: off the ground -> done; standing (C+0x1d8 == 0) -> done, next 6 (9: FUN_00340bb8(C, 1, -1) first) / 0x16; else the
  //   quadrant of +0x80 against a's: changed -> phase 0 (the table again next update).
  // T: w161_chase e0 / e1 (records 46 / 47, mode 5 on mover 0xd): r_bwk_a / r_rwk_a / r_wk_a / r_lwk_a as the move turns (test_strafe_walk).
  const LOCO9 = { 9: { 1: 0x60, 2: 0x66, 3: 0x63, 4: 0x69 }, 0x17: { 1: 0x7e, 2: 0x81, 3: 0x87, 4: 0x84 } };
  const quadrant = r => {                                                     // FUN_0036a638 (degrees)
    let d = f(r * 57.295776);
    if (18000.0 < d || d < -18000.0) d = 0;
    else if (d < -180.0) { while (d < -180.0) d = f(d + 360.0); }
    else while (180.0 < d) d = f(d - 360.0);
    const ab = Math.abs(d);
    return ab < 30.0 ? 1 : !(ab < 150.0) ? 3 : 0 < d ? 2 : 4;
  };
  function loco9(a, m) {
    const C = a.C, crouch = m.cls === 0x17;
    let ang = f(moveAngle(a.face, C.dir || a.face));                          // FUN_00353458
    if (314.15927 < ang || ang < -314.15927) ang = 0;
    else if (ang < -3.1415927) { while (ang < -3.1415927) ang = f(ang + 6.2831855); }
    else while (3.1415927 < ang) ang = f(ang - 6.2831855);
    if (m.phase === 0) {
      m.a80 = ang;
      const q = quadrant(ang), b = LOCO9[m.cls][q];
      // FUN_003455e8: the row has a name and FUN_005a7390 finds the clip in the model's motion sets (ai.json model_clips, the
      // same files; e036 has no m_sq_ma). FUN_00345ca8 packs the up partners the same way, on their own: entry k takes the k-th
      // partner found (e036 has no m_lwk_au, so its left table's walk entry takes m_lrn_au and its run entry none). The partners
      // are not exported (request's GUESS: the middle row drawn); FUN_00345d70's down partners are not kept.
      const has = r => !!clipOf(a, r) && (!(data.model_clips && data.model_clips[a.model]) || clipFrames(a, clipOf(a, r)) != null);
      const all = crouch ? [0x78, b] : [0x40, b, b + 0xc];
      const rows = all.filter(has), partner = all.map(r => r + 1).filter(has).map(r => clipOf(a, r));
      const root = r => (opts.rootSpeed && opts.rootSpeed(a.model, clipOf(a, r))) || 0;
      // FUN_00345e58(C, 0, 1, 1 / 0): entry 0's root speed 0; an entry the flag leaves out (0x17's third) has none
      C.loco = { rows, partner, thr: [0, crouch ? 0 : f(24.0)],
                 root: [0, rows.length > 1 ? f(root(rows[1])) : 0, rows.length > 2 && !crouch ? f(root(rows[2])) : 0], cur: -1 };
      C.f564 |= 8 | 0x10;
      m.phase = 1;
      return;
    }
    if (m.phase !== 1) return;
    if (!(C.f1c0 & 0x200)) { m.done |= 1; return; }
    if (C.speed === 0) {
      if (!crouch) blendSet(a, 1, -1);
      m.done |= 1; setMotion(a, crouch ? 0x16 : 6); return;
    }
    if (quadrant(m.a80) !== quadrant(ang)) m.phase = 0;
  }
  // FUN_00343160's table step: the choice FUN_00346860 (with C+0x564 bit 3 and an installed table) and the rate
  // FUN_00346c10 -> FUN_003453e0 (MP+0x40c = r x 0.5, enemies.js C.rate). Not modelled: FUN_00346650 (the posture
  // bits C+0x590 by the choice), the partner pick (C+0x590 bits 25-28; motion 9 / 0x17's partner rows: worker 0267, below), C+0x564 bit
  // 0x40000 (flags 0x86), the C+0x568 bits.
  function locoFrame(a) {
    const C = a.C, L = C.loco;
    if (!L) return;
    const n = L.rows.length;
    // FUN_00346d50 (the idle table, C+0x568 bit 0x10000, no C+0x564 bit 3): C+0x224 > 0.2 -> entry 1, < -0.2 -> entry 2, else 0;
    // entry 0 FUN_00340bb8(C, 1, 0xf), others (C, 1, -1); C+0x660 = the entry's turn speed; FUN_003456c0 0x87 (0x86), the phase
    // kept (FUN_00345448) unless nothing played. FUN_00346f10: rate = |C+0x224 / C+0x660|, at most 1.5 (1.0 with C+0x660 = 0).
    if (!(C.f564 & 8) && (C.f568 & 0x10000) && L.turn && (n >= 2 || (n === 1 && L.cur === -1))) {
      const r = C.f224 || 0, i = !(0.2 < Math.abs(r)) ? 0 : 0 < r ? 1 : 2;
      if (i !== L.cur) {
        const first = L.cur === -1;
        if (i === 0) blendSet(a, 1, 0xf); else blendSet(a, 1, -1);
        L.cur = i;
        L.turn660 = L.turn[i];
        playClip(a, clipOf(a, L.rows[i]), (C.f564 & 0x40000) ? 0x86 : 0x87, 1, !first);
      }
      if (C.f568 & 0x20000) {
        const v = L.turn660 ? Math.abs(f(r / L.turn660)) : 1.0;
        C.rate = f(f(1.5 < v ? 1.5 : v) * 0.5);
      }
      return;
    }
    if ((C.f564 & 8) && (n >= 2 || (n === 1 && L.cur === -1))) {
      const i = locoChoice(C.speed, L.thr, n, L.cur, C.f564);
      if (i !== L.cur) {
        const first = L.cur === -1;
        if (i === 0) { if (!first) blendSet(a, 1, 0x14); }
        else blendSet(a, 1, -1);
        L.cur = i;
        L.root65c = L.root[i];
        // worker 0267: an entry with a partner row (+0x5f8, motions 9 / 0x17) -> FUN_00345818(C, row, up, down, 0x83, 1, 1), the
        // aimed set (request's GUESS: the middle row drawn, the up row as the partner). GUESS: no phase carry: FUN_00345818's
        // FUN_00345448 hangs on the aim zones C+0x590 (not decoded), so the new clip starts at 0. The same-entry re-request
        // (zone change, bits 25-26 != 27-28) is not modelled.
        if (L.partner && L.partner[i]) playClip(a, clipOf(a, L.rows[i]), 0x83, 1, false, L.partner[i]);
        else playClip(a, clipOf(a, L.rows[i]), (C.f564 & 0x40000) ? 0x86 : 0x87, 1, !first);
      }
    }
    // FUN_00346c10 (C+0x564 bit 0x10)
    if (!(C.f564 & 0x10)) return;
    C.rate = locoRate(C.speed, L.root65c, L.cur, C.f564);
  }

  // body update: motion state class 0xe, FUN_00596460 (called with the frame step)
  // FUN_00343160's order: the motion update (vt+0x24) -> the body FUN_0034ea18 (moverUpdate) -> with no next
  // class the locomotion table step (FUN_00346860 / FUN_00346c10, locoFrame), else FUN_00341780 (setMotion).
  // worker 0228: motion class 2 update FUN_00593c90 (phase +4, done +8, count +0x80 = cmd 0x141's r1). Phase 0:
  // FUN_00340bb8(C, 1, -1) and FUN_003448c0(C, 0, 1): the clip C+0x640 (slot 0) at C+0x591, FUN_003449a0 flags 3 (looped;
  // no 0x80 bit, so never dropped as the same clip), rate 1.0 (FUN_003453e0); on a request -> phase 1. Phase 1: per
  // finished motion (FUN_003460d8) phase + 1, done bit once +0x80 != 0 and phase >= +0x80. MISSING: phase 1 with a count
  // (FUN_005a9860 on a looped layer not read; z128's 0x141 all send r1 = 0, so the clip loops on).
  function cmd141Motion(a, m) {
    if (m.phase === 0) {
      blendSet(a, 1, -1);
      if (a.C.n640) { playClip(a, a.C.n640, 3); m.phase = 1; }
      else m.done |= 1;                                                       // FUN_003448c0 0 (no clip): done bit
      return;
    }
    if (m.n80) warnOnce(`enemy_ai: cmd 0x141 loop count ${m.n80} (FUN_00593c90 phase 1, FUN_005a9860) not translated`);
  }
  // worker 0235: motion class 1 (FUN_00592918 case 1, vt 0x5a6ba8: enter 0x593b08 C+0x564 |= 0x4000 | 0x200000, leave
  // 0x593b30 clears them), update FUN_00593b60: phase 0 FUN_00340bb8(C, 1, -1) and FUN_003448c0(C, 0, 0) = the slot-0 clip
  // C+0x640 once (else the done bit); phases 1 / 2: when the motion is done (FUN_003460d8) the slot-n clip (C+0x648 /
  // +0x650), phase + 1, done at 3 or when the slot is empty. The z128 boss sets slot 0 only (FUN_00344840(C, name, 0, 0)).
  // L: FUN_003448c0's last argument 0 = flags 2 (not looped), as its 1 = flags 3 (cmd141Motion).
  function motion1(a, m) {
    const C = a.C, slot = [C.n640, C.n648, C.n650];
    if (m.phase === 0) {
      blendSet(a, 1, -1);
      if (slot[0]) { playClip(a, slot[0], 2); m.phase = 1; } else m.done |= 1;
      return;
    }
    if (m.phase < 0 || m.phase > 2 || !motionDone(a)) return;
    if (slot[m.phase]) { playClip(a, slot[m.phase], 2); m.phase++; if (m.phase !== 3) return; }
    m.done |= 1;
  }
  // worker 0259: motion class 0x42 (cmd 0x19b; FUN_0059e730). Phase 0: the body matrix = the identity with rows 1 and 2 negated at
  // the origin (FUN_002613b8, FUN_0034aae0), FUN_00341750(C, 1) (C+0x564 |= 0x400000), FUN_00340bb8(C, 0, -1) (no blend),
  // FUN_003448c0(C, 0, 0) = the clip C+0x640 once, or phase 2 + the done bit. Phase 1: FUN_003460d8 -> phase 2, done bit. The request's
  // FUN_003449a0 -> FUN_00340c00 copies 0x400000 to bit 4, which makes FUN_00343160 take the body's matrix from the root bone
  // (FUN_005ad9c0): the clips hold their path in world space. L: the page keeps the old a.pos on phase 0's frame (T: w259_heli2 f861 C+0x30 =
  // 0 for that one frame; the game draws through the MP, the page would flash the body at the origin).
  function motion42(a, m) {
    const C = a.C;
    if (m.phase === 0) {
      C.f564 |= 0x400000;
      blendSet(a, 0, -1);
      if (C.n640) { playClip(a, C.n640, 2); C.f564 |= 4; m.phase = 1; }
      else { m.phase = 2; m.done |= 1; }
      return;
    }
    if (m.phase === 1 && motionDone(a)) { m.done |= 1; m.phase = 2; }
  }
  // FUN_00343160 with C+0x564 bit 4: FUN_005ad9c0(MP, M), FUN_0034aae0(C, M): C+0x20.. = the root bone's matrix. T: w259_heli sp0_4, C+0x30
  // within 1.6 u of bone 1 at clip frame 13 + 0.6 x f.
  function rootDrive(a) {
    const C = a.C, h = C.mp, tr = h && opts.rootTrack ? opts.rootTrack(a.model, h.clip) : null;
    if (!h || h.frame == null || !tr) { warnOnce('enemy_ai: motion class 0x42 without the root track (opts.rootTrack): the body stays'); return; }
    const M = rootMatrix(tr, h.frame);
    for (let k = 0; k < 3; k++) { a.pos[k] = f(M[3][k]); a.face[k] = f(-M[2][k]); }   // T: C+0x20 = minus the bone's row 2
  }
  function bodyUpdate(a, step) {
    const C = a.C, m = C.motion;
    if (C.f564 & 0x80000000) return;                                          // FUN_00343160's first test: lent (FUN_00344ec0(C, 1)); FUN_0034ea18 is inside it
    C.nextMotion = 0;
    if (m) { C.inUpdate = true; try { motionUpdate(a, m, step); } finally { C.inUpdate = false; } }
    if (m && m.cls === 0x42) {
      if (m.phase === 1 && (C.f564 & 4) && C.mp && C.mp.clip === C.n640) rootDrive(a);
      // FUN_00343160: the done bit, C+0x564 bit 0x20 clear -> set, FUN_00341af0 -> FUN_00341988 (listener C+0x7d4, code 0) -> FUN_005887a0: script
      // event 0x16 (the next leg's 0x19b replaces the class). The mover (FUN_0034ea18) has nothing to do under this class.
      if ((m.done & 1) && !(C.f564 & 0x20)) { C.f564 |= 0x20; runEvent(a, 0x16); }
      if (C.nextMotion) setMotion(a, C.nextMotion);
      return;
    }
    rootSample(a);                                                            // FUN_00343160 after vt+0x24: C+0x310
    moverUpdate(a, step);                                                     // FUN_0034ea18 (path walk, C+0x300 slides)
    if (C.nextMotion) setMotion(a, C.nextMotion);
    else locoFrame(a);
  }
  function motionUpdate(a, m, step) {
    if (m.cls === 0x42) { motion42(a, m); return; }
    if (m.cls === 3 || m.cls === 8) { (m.cls === 3 ? loco3 : loco8)(a, m); return; }
    if (m.cls === 9 || m.cls === 0x17) { loco9(a, m); return; }            // worker 0267: FUN_00595440 / FUN_00597430
    if (m.cls === 4) { loco4(a, m, step); return; }
    if (m.cls === 0x22) { loco22(a, m); return; }
    if (m.cls === 0x21) { loco21(a, m, step); return; }
    if (m.cls === 2) { cmd141Motion(a, m); return; }
    if (m.cls === 1) { motion1(a, m); return; }
    if (m.cls >= 0x1000) { attackUpdate(a, m, step); return; }
    if (m.cls === 0x3f) { hitMotion(a, m, step); return; }
    if (KNOCK_CLASS.has(m.cls) || m.k36) { knockClass(a, m, step); return; }
    if (m.cls === 0x1e || m.cls === 0x36 || m.cls === 0xd) {
      // the clip clock as enemies.js plays it (MP+0x40c 0.5 x step, FUN_005aa2a8). Death (0x36): at the
      // clip's end the motion-done event FUN_00343160 -> FUN_00539570 sets actor +0x118 bit 0x100
      // (corpse settled, notes §10.5) and the last frame holds. The flinch (0x1e): its update
      // FUN_00598950 phase 1 ends when the motion is done (FUN_003460d8) or its timer +0xc > 120, then
      // requests motion 0x40 if C+0x590 bit 24 (gun out, FUN_00565d78) is set, else motion 1 (flags
      // 0x83): e027 / e048 r_st_a, e030 st_a (its stance has no row 0x40). Phase 2 (the next frame):
      // C+0x1c0 &= ~0x20, then the next motion state FUN_00341b20: posture C+0x590 bits 16-19 == 1 (crouched,
      // the page's stance 1) -> 0x16 with the gun bit, else 0x12 (not translated: the motion ends); other
      // postures -> 6 with the gun bit, else 3 (worker 0159: a soldier hit on his path walk runs again).
      if (m.cls === 0x1e && m.phase === 2) {
        a.C.f1c0 &= ~0x20;
        const next = a.stance === 1 ? (a.C.gun ? 0x16 : 0x12) : (a.C.gun ? 6 : 3);
        if (next === 0x12) { warnOnce('enemy_ai: motion state 0x12 (crouched, gun in) not translated'); endMotion(a); }
        else setMotion(a, next);
        return;
      }
      const mc = data.model_clips && data.model_clips[a.model];               // per model (old ai.json: e027's)
      const n = mc ? mc[a.C.clip] : data.clips && data.clips[a.C.clip];
      m.t = f(m.t + f(f(0.5) * step));
      // GUESS: the timer's step DAT_004eeb24 is a runtime global (BSS), taken as the frame step
      if (m.cls === 0x1e || m.cls === 0xd) m.timer = f((m.timer ?? 0) + step);
      // worker 0259: class 0xd: the clip's end or timer > 300 (FUN_00595ea8); no row: at once (FUN_003460d8)
      const off1e = m.cls === 0x1e && a.astate === 0x18 && !(a.C.f1c0 & 0x200);
      if ((n != null && n <= m.t) || (m.cls === 0x1e && m.timer > 120.0) || off1e || (m.cls === 0xd && (m.noRow || n == null || m.timer > 300.0))) {
        if (m.cls === 0x36 || m.cls === 0xd) { if (!m.done) { m.done = 1; a.f118 |= 0x100; events.push(`settled ${a.id}`); } }
        else if (m.phase !== 2) {
          m.done |= 1;
          // worker 0259: a re-hit in state 0x18 ran this class (FUN_00562b30): the done bit is read at phase 1's end (FUN_00598950, FUN_00343160) and goes to state 0x18's FUN_00539b88, which ignores the class id
          if (a.astate === 0x18) { setActorState(a, dead(a) ? 7 : (a.C.f1c0 & 0x200) ? (a.C.gun ? 3 : 2) : 0x10); return; }
          request(a, a.C.gun ? 0x40 : 0x01, 0x83); m.phase = 2;
        }
      }
      return;
    }
    if (m.cls === 6 || m.cls === 0x16) {
      // Motion state 6 (stand, aim: FUN_00594978) / 0x16 (crouched: FUN_005971d8): standing still on the
      // ground they request their aim rows (6: 0x40-0x42, 0x16: 0x78-0x7a, flags 0x83) only when the
      // partner pick C+0x590 bits 25-26 differs from bits 27-28 or FUN_00349db8(C, 3) && (C, 4). GUESS: those
      // conditions are not decoded; on its first standing update the class requests its row and stays (6: puts
      // r_st_a at f788, two frames after r_st_f, trace k_enemy_engage8 / k_fire_emp15). Their +0x74 (0xe / 0xf)
      // starts the next shot.
      // Phase 0: FUN_00340bb8(C, 1, -1) (C+0x591 = C+0x6c0), or 0x10 / 0x14 by C+0x664 when the motion
      // came from 0x1c (not on the page); phase 1 at once, in the same update.
      // worker 0267: phase 1 (decoded): off the ground (C+0x1c0 bit 9 clear) -> done; moving (C+0x1d8 > 0) -> done,
      // next 9 / 0x17 (loco9). T: w161_chase (46 / 47 in mode 5 on mover 0xd: r_*wk_a, not r_st_a).
      if (!m.started) { m.started = true; blendSet(a, 1, -1); }
      if (!(a.C.f1c0 & 0x200)) { m.done |= 1; return; }
      if (0 < a.C.speed) { m.done |= 1; setMotion(a, m.cls === 6 ? 9 : 0x17); return; }
      if (!m.asked) { m.asked = true; request(a, m.cls === 6 ? 0x40 : 0x78, 0x83, true); }
      return;
    }
    if (m.cls === 5) {
      // FUN_005946a0 (raise the gun), phase +4, timer +0xc:
      // 0: timer 0; with a row 0x41 (up partner): C+0x564 bit 0x20000000 ? motions 0x40-0x42 flags 0x83
      //    : motion 0x40 flags -1 (no loop: T k_fire_emp15 #67 f796 lflags 6); no row 0x41: row 0x8a ->
      //    motion 0x8a (-> 1), else motion 0x40 (-1); -> 2.
      // 2: timer > 8 -> done bit, returns 6 (T: #67 r_st_a looped from f804); moving -> 9 (phases 1 / 2, below the 6 test).
      // 1: timer > 30 or the motion done (FUN_003460d8, motionDone) -> 6.
      if (m.phase === 0) {
        m.timer = 0;
        if (clipOf(a, 0x41)) {
          if (a.C.f564 & 0x20000000) request(a, 0x40, 0x83, true); else request(a, 0x40, 0x82);
          m.phase = 2;
        } else if (clipOf(a, 0x8a)) { request(a, 0x8a, 0x82); m.phase = 1; }
        else { request(a, 0x40, 0x82); m.phase = 2; }
        m.timer = f(m.timer + step);
        return;
      }
      if (m.phase === 2 ? m.timer > 8.0 : (m.timer > 30.0 || motionDone(a))) { m.done |= 1; setMotion(a, 6); return; }
      if (0 < a.C.speed) { m.done |= 1; setMotion(a, 9); return; }          // worker 0267: LAB_00594840 (phases 1 and 2)
      m.timer = f(m.timer + step);
      return;
    }
    if (m.cls === 0x18 || m.cls === 0x19) {
      // FUN_005978e8 (0x18, crouch down) / FUN_00597ae8 (0x19, stand up), phase +4, timer +0xc:
      // 0: timer 0, blend C+0x591 = 10 (FUN_00340bb8(C, 1, 10)), sound cue 0x42 / 0x43 (FUN_00341330,
      // not on the page), motion 0x78-0x7a / 0x40-0x42 (flags 0x83) -> 1, then at once:
      // 1: off the ground: done bit (stays). Else timer > 20, or timer >= 10 and the motion is done
      // (FUN_003460d8) -> done bit, returns 0x16 / 6; moving (C+0x1d8 > 0) -> 0x17 / 9.
      // FUN_003460d8 reads the head layer's clip A (FUN_005aa200), which the three-clip request's layer (FUN_005a9398 /
      // FUN_005a91c8) stores as a one-clip one does: motionDone (worker 0236).
      if (m.phase === 0) {
        m.timer = 0;
        blendSet(a, 1, 10);
        request(a, m.cls === 0x18 ? 0x78 : 0x40, 0x83, true);
        m.phase = 1;
      }
      // worker 0267 (decoded): moving -> 0x17 / 9. 0x19 (FUN_00597ae8 LAB_00597bdc) tests it off the ground too, 0x18 does not.
      if (!(a.C.f1c0 & 0x200)) {
        m.done |= 1;
        if (m.cls === 0x19 && 0 < a.C.speed) { setMotion(a, 9); return; }
        m.timer = f(m.timer + step); return;
      }
      if (m.timer > 20.0 || (m.timer >= 10.0 && motionDone(a))) { m.done |= 1; setMotion(a, m.cls === 0x18 ? 0x16 : 6); return; }
      if (0 < a.C.speed) { m.done |= 1; setMotion(a, m.cls === 0x18 ? 0x17 : 9); return; }
      m.timer = f(m.timer + step);
      return;
    }
    if (m.cls !== 0xe && m.cls !== 0xf) return;
    // 0xe = standing shot FUN_00596460 (motions 0x57-0x59, returns 6); 0xf = crouched shot FUN_00597c60
    // (motions 0x7b-0x7d, returns 0x16): the same phases.
    const crouch = m.cls === 0xf;
    if (m.phase === 2) {
      // FUN_00596460 / FUN_00597c60 phase 2 (asm 0x596550-0x5965b0, worker 0236): the motion done (FUN_003460d8,
      // motionDone) or timer > 30 -> request motions 0x40-0x42 / 0x78-0x7a (flags 0x83); either way (not done and
      // timer <= 30 branches past the request, bc1fl at 0x596578) the done bit is set and it returns 6 / 0x16, so phase 2
      // always ends on its first update. T k_fire_emp15 #66: r_st_f pushed f786, not done at f787 (no request), r_st_a f788
      // from state 6's first update.
      if (motionDone(a) || m.timer > 30.0) request(a, crouch ? 0x78 : 0x40, 0x83, true);
      m.done |= 1;
      setMotion(a, crouch ? 0x16 : 6);                                       // returns 6 / 0x16 (GUESS: return value = next motion state)
      return;
    }
    if (m.phase === 0) {
      // C+0x300 / FUN_00342308 -> FUN_003533e0 stop: standing, nothing to stop
      m.phase = 1;
    }
    if (m.phase === 1) {
      // muzzle FUN_00341ec8 (marker 15): GUESS = eye point (no skeleton markers in this module)
      spawnShot(a, a.C.aim, eye(a));                                          // FUN_00341988 -> slot 0x56a11c -> FUN_00569340
      request(a, crouch ? 0x7b : 0x57, 0x82, true);
      m.timer = 0;
      m.phase = 2;
    }
    m.timer = f(m.timer + step);
  }

  // Attack motion 0x1000 + i (factory 0x5a6c28 -> vtable 0x5a4270): enter FUN_0059e830 (+0x10 entry i,
  // +0x14 keyframe 0, +0x18 the entry's length, timer +0xc = 0; C+0x568 &= ~0x8000, speed 0
  // FUN_0034b110: standing here), update FUN_0059eb18, leave FUN_0059e938.
  // Update: timer += DAT_004eeb24 (GUESS: the frame step, as the flinch's), fr = (int)timer. Phase 0: run
  // every keyframe whose frame <= fr (FUN_00347e98 / FUN_00348138: each command through the body's
  // vt+0xc FUN_003481e0; -2 ends the attack, >= 0 jumps to that frame's keyframe); once all ran and
  // fr >= the length the done bit is set (phase 1 waits for the length). FUN_003489a8's jump request
  // (C+0x7a0, set only by command 0xf) is never set on the page.
  function attackUpdate(a, m, step) {
    const T = attackTable(a), e = T && T.entries[m.entry];
    // timer += step, rounded toward zero (PS2 FPU): T k_lunge166 #66 ends r_atk_0 (dur 66) on its 56th step, f1510;
    // round to nearest reaches 66.000004 a step early
    m.timer = chop(m.timer + step);
    const fr = Math.trunc(m.timer);
    if (m.phase === 0) {
      if (!e) { m.phase = 2; m.done |= 1; }
      else if (!(m.timer < 0.0)) {
        while (m.kf < e.kf.length) {
          const k = e.kf[m.kf];
          if (fr < k.frame) break;
          const r = attackCommands(a, T, k);
          if (r === -2) { m.phase = 2; m.done |= 1; break; }
          if (r >= 0) {
            const j = e.kf.findIndex(x => x.frame === r);                     // FUN_00347f00
            if (j >= 0) { m.kf = j; m.timer = f(r - 1); }
            break;
          }
          m.kf++;
        }
        if (m.phase === 0 && m.kf >= e.kf.length) {
          if (fr < e.dur) m.phase = 1; else { m.phase = 2; m.done |= 1; }
        }
      }
    } else if (m.phase === 1) {
      if (fr >= e.dur) { m.phase = 2; m.done |= 1; }
    } else m.done |= 1;
    // GUESS: who leaves the attack actor state is not found (two attempts: the class vt+0x1c caller,
    // the motion-end event 5 = FUN_00563780). The class's vt+0x1c (0x539ea0, from the ELF) gives the
    // state to return to: off the ground 8; else by stance (actor +0x100 bits 40-41) and the gun bit
    // (bit 44): 0 -> gun ? 3 : 2, 1 -> gun ? 5 : 4. Stand-in: once the attack motion is done the actor
    // takes that state (notes/fidelity-audit.md 'Attack end').
    if ((m.done & 1) && attacking(a)) {
      // GUESS (part of 'Attack end'): the leave's root part (FUN_0059e938) runs now, before this step's body move,
      // not after it with the motion switch: T k_lunge166 f1510 (state 2): no root move, body+0xac already 0x200036
      // and the velocity x 0.92 (turn limit toward 0) in that step's move
      if (!m.left) { rootLeave(a); m.left = true; }
      events.push(`attack end ${a.id}`);
      setActorState(a, attackReturn(a));
    }
  }
  const attackReturn = a => !(a.C.f1c0 & 0x200) ? 8 : (a.stance & 3) === 1 ? (a.C.gun ? 5 : 4) : (a.C.gun ? 3 : 2);   // 0x539ea0
  // FUN_00348138: the keyframe's commands through FUN_003481e0 until one returns other than -1.
  // Translated: 0 (play clip: name = table +0x1c [arg 2], flags 7 (loop) with byte 6 bit 3 else 6; blend
  // = byte 7 (0: none, FUN_00340bb8); then owner event 4 -> 0x56a1f4: actor state 1 when not attacking),
  // 2 (hit volume -> owner event 4 -> FUN_00569dc0), 0xe (-2: end). MISSING: the hit volume itself
  // (FUN_00569dc0 -> FUN_00541310: an attack object from the 64-byte record at table +0x24, placed on a
  // bone, damage +0xc2 x status +0x56; its overlap test and damage are not decoded), so a melee attack
  // never hits Vincent; byte 6 bits 0-2 of op 0 (root motion: mover 8, C+0x568 bits) are not ported;
  // worker 0256: 3, 6, 7, 8, 9 (attackOp3 ..; e030's). 0xb / 0xd / 0xf / 0x10 are not translated (none in e030's table: op 0xb is
  // mover 0xe's, as op 6 / 8's FUN_00351170); 4 / 5 / 0xa are effects and sounds (not on the page).
  function attackCommands(a, T, k) {
    for (const c of k.cmds) {
      const op = c[0];
      if (op === 0) {
        const b6 = c[3] & 0xff, b7 = (c[3] >> 8) & 0xff;
        if ((b6 & 7) && a.C.mover !== 0xe) rootOn(a, b6);                       // root motion: mover 8 (rootSample)
        const name = T.names[String(c[2])] || null;
        if (b7 === 0) blendSet(a, 0, 0); else blendSet(a, 1, b7);
        if (name) playClip(a, name, (b6 & 8) ? 7 : 6);
        else warnOnce(`enemy_ai: attack table has no clip name ${c[2]} (${a.model})`);
        if (!attacking(a)) setActorState(a, 1);                               // event 4 op 0 (0x56a1f4)
      } else if (op === 2) {
        events.push(`melee ${a.id} hit ${c[2]}`);
        if (c[2] >= 0) makeAttack(a, T, c[2]);                                // FUN_003481e0 case 2 (arg 2 < 0: none)
      } else if (op === 0xe) return -2;
      else if (op === 3) attackOp3(a, T, c);
      else if (op === 6) attackOp6(a, c);
      else if (op === 7) attackOp7(a, c);
      else if (op === 8) attackOp8(a, c);
      else if (op === 9) attackOp9(a, c);
      else if (op !== 4 && op !== 5 && op !== 0xa) warnOnce(`enemy_ai: attack command ${op} not translated`);
    }
    return -1;
  }

  // Op 3 (FUN_003481e0 case 3: arg 3 >= 0 and < T+0xe, else nothing -> owner event 4 0x56a228): W = FUN_00311600(arg 2) (section 24, the
  // bullet record), the point T+0x28 + arg 3 x 16 through the actor's matrix (FUN_0054a5e8 + FUN_0026135c), FUN_00569870(-1, a, W, point, +0xc, +0xd, -1).
  function attackOp3(a, T, c) {
    const P3 = T.points && T.points[c[3]];
    if (c[3] < 0) return;
    if (!T.points) { warnOnce('enemy_ai: ai.json attacks have no points (re-export data/enemies): op 3 fires nothing'); return; }
    if (!P3) return;
    const W = data.weapons && data.weapons[c[2]];
    if (!W) return;
    const fz = a.face, r0 = [f(-fz[2]), 0, fz[0]];                            // rows: FUN_00260f54's test k_melee18 (localAngles)
    const pt = [0, 1, 2].map(k => f(f(f(f(P3[0] * r0[k]) + f(P3[1] * [0, -1, 0][k])) + f(P3[2] * fz[k])) + a.pos[k]));
    // FUN_00569870: n 5 -> W+0xb4, marker < 0 -> W+0xb5 (neither in e030's records; not exported)
    if (P3[3] === 5 || P3[4] < 0) { warnOnce('enemy_ai: FUN_00569870 with W+0xb4 / +0xb5 not translated'); return; }
    shootMarker(a, W, pt, P3[3], P3[4], -1);
  }
  // Op 6 (case 6): FUN_00351170 (only mover 0xe: not on the page), FUN_005ae618(MP, by the byte's bits 6-7: 0 -> 3, 1 -> 1, 2 -> 2; MP+0x457, not
  // modelled), owner event 4 0x56a2c4: low nibble != 3 -> FUN_00565bd0(a, n) (the posture: C+0x1d4 back to status +0x70, T: dog 65 21 u/s = 0.3 x 70
  // after its first attack, 0.3 x 75 before); bits 4-5 != 2 -> FUN_00565d78 (the gun bit); bits 6-7 != 3 -> FUN_00565df8 (actor +0x100 bits 46-47).
  function attackOp6(a, c) {
    if (a.C.mover === 0xe) warnOnce('enemy_ai: attack op 6 with mover 0xe (FUN_00351170) not translated');
    const b = c[2] & 0xff, n = b & 0xf, g = (b >> 4) & 3, h = b >> 6;
    if (n !== 3) posture565bd0(a, n);
    if (g !== 2) a.C.gun = g === 1 ? 1 : 0;
    if (h !== 3) a.f100b46 = h;
  }
  // Op 7 (owner event 4 0x56a2b0): FUN_00563930(a, arg 2): actor +0x143 = the byte; >= 0 -> C+0x568 |= 0x8000, else clear
  function attackOp7(a, c) {
    const b = (c[2] << 24) >> 24;
    a.b143 = b & 0xff;
    if (b >= 0) a.C.f568 |= 0x8000; else a.C.f568 &= ~0x8000;
  }
  // Op 8 (case 8; mover 0xe -> FUN_00351170, 0xf -> FUN_0034d828: neither on the page). Not in mode 0xc: FUN_0034b110(0, C), FUN_0034db80(C, 0xc, 0).
  // FUN_00326500 (script flag 13, set in z128): arg 1 != 0 -> gravity FUN_00356358(cfg +0xcc x arg 1 x 1.96), else arg 3 != 0 -> x 196. Grounded or not,
  // with the flag: FUN_00357168(arg 2) (FUN_0034a8e0 / direct). C+0x564 |= 0x80000 (read by stateMotion; attack leave clears).
  function attackOp8(a, c) {
    const C = a.C;
    if (C.mover === 0xe || C.mover === 0xf) { warnOnce(`enemy_ai: attack op 8 with mover 0x${C.mover.toString(16)} not translated`); return; }
    bodyOf(a);
    if (C.mm !== 0xc && a.B.poly === null) placeBody(a);
    PM.enterMode0xc(a);
    const CFG = 1.2;                                                          // *(*(DAT_0046dd68 + 0x14) + 0xcc), T: r03_dogawake
    if (c[1] !== 0) a.B.g = f(f(CFG * c[1]) * 1.9599999);
    else if (c[3] !== 0) a.B.g = f(f(CFG * c[3]) * 196.0);
    PM.bodyTakeoff(a, c[2]);
    C.f564 |= 0x80000;
  }
  // Op 9 (case 9): FUN_0034b110(0, C) + FUN_0034db80(C, 0xc, 0) unless mode 0xc; C+0x568 |= 0x1000; low byte of arg 3 = 0: FUN_0034b110(arg 2 / 60, C)
  // (forward at arg 2 u/s; the attack leave stops it, rootLeave); else FUN_0034b160 (turned by byte x 1.40625 deg: not in e030's table).
  function attackOp9(a, c) {
    const C = a.C;
    bodyOf(a);
    if (C.mm !== 0xc && a.B.poly === null) placeBody(a);
    PM.enterMode0xc(a);
    C.f568 |= 0x1000;
    if ((c[3] & 0xff) !== 0) { warnOnce('enemy_ai: attack op 9 with an angle (FUN_0034b160) not translated'); return; }
    PM.wantFace(a, f(c[2] * 0.016666668));
  }

  // ------------------------------------------------ the attack clip's root motion (the lunge; worker 0166)
  // FUN_003481e0 case 0 (op 0 byte 6 bits 0-2, body mover not 0xe): FUN_00340b28(C, 1) (C+0x568 |= 0x20), bit 0 ->
  // C+0x568 0x40, bit 1 -> 0x100 and FUN_00356248(body, 1) (else (body, 0)), bit 2 -> 0x80; FUN_0034edf0(C, 8)
  // (C+0x564 bit 11: C+0x45c bit 27 around it, not modelled); bit 2 -> FUN_0034e960(C, 8) (turn mode 8: not
  // translated); C+0x568 |= 0x1000. T: k_melee18 (#66 r_atk_0, byte 6 = 3).
  function rootOn(a, b6) {
    const C = a.C;
    C.f568 |= 0x20;
    if (b6 & 1) C.f568 |= 0x40;
    if (b6 & 2) { C.f568 |= 0x100; bodyOf(a); PM.bodyRootOn(a, 1); } else { bodyOf(a); PM.bodyRootOn(a, 0); }
    if (b6 & 4) C.f568 |= 0x80;
    if (C.f564 & 0x800) warnOnce('enemy_ai: mover 8 start with C+0x564 bit 11 (C+0x45c bit 27 placement) not translated');
    PM.rootStart(a, placeBody, warnOnce);
    if (b6 & 4) warnOnce('enemy_ai: root motion byte 6 bit 2 (FUN_0034e960(C, 8), turn mode 8) not translated');
    C.f568 |= 0x1000;
  }
  // The clip's frame count (FUN_005ad6e8 = clip +0x1c x 2; +0x1c taken as the frame count, as model_clips)
  function clipFrames(a, name) {
    const mc = data.model_clips && data.model_clips[a.model];
    return mc ? mc[name] ?? null : (data.clips ? data.clips[name] ?? null : null);
  }
  // worker 0231: FUN_003460d8(C) = 1 without an MP (C+0x7c8), else !FUN_005a9860(MP): MP+0x440 bit 20 -> 0; layer count
  // MP+0x449 < 1 -> 0, >= 2 -> 1 (a queued layer plays), 1 -> FUN_005aa200(head layer MP+0x200 + 0x30 x MP+0x448): a clip
  // that does not loop (+0x1e bit 0 clear) with frame (+0x18) >= its count (+0x1c) - 1 -> 0 (frame clamped there). The page
  // keeps the head layer only (C.mp, replaced by every request, as flags bit 2 does in FUN_005a9398: z128's requests carry
  // it); L: a request without bit 2 queues a second layer in the game (done = 0 until the head ends), not modelled.
  // Three-clip (aim) requests FUN_00345818 (C.mp.partner): FUN_003456f0 -> FUN_00344608 -> FUN_00344bd0 -> FUN_005a9398
  // writes one layer with clip A at +0x200 (clip B +0x208, ratio +0x210); its frame advances and ends on clip A's count
  // (FUN_005aa2a8), so the same test holds (worker 0236; the shot's early end is its own control flow, FUN_00596460).
  function motionDone(a) {
    const h = a.C && a.C.mp;
    if (!h) return true;
    if (h.loop) return false;
    const n = clipFrames(a, h.clip);
    if (n == null || h.frame == null) return false;                          // no frame kept: as playing
    return n - 1 <= h.frame;
  }
  // FUN_00346108(f, C): 1 without an MP, else FUN_005a9120 (2 x the head layer's frame MP+0x218) >= f
  function motionPast(a, fr) {
    const h = a.C && a.C.mp;
    if (!h || h.frame == null) return true;
    return !(f(h.frame + h.frame) < fr);
  }
  // 4 x 4 rows (p' = p M). FUN_0026125c(out, A, B) = B x A (out row i = sum_k B[i][k] A[k]).
  const mmul = (A, B) => B.map(r => [0, 1, 2, 3].map(c => f(f(f(f(r[0] * A[0][c]) + f(r[1] * A[1][c])) + f(r[2] * A[2][c])) + f(r[3] * A[3][c]))));
  // FUN_00261144: the affine inverse (rows 0-2 by the cross products over the determinant, row 3 = -t x inverse)
  function minv(M) {
    const [a, b, c] = M, t = M[3];
    const cr = (u, v) => [f(f(u[1] * v[2]) - f(u[2] * v[1])), f(f(u[2] * v[0]) - f(u[0] * v[2])), f(f(u[0] * v[1]) - f(u[1] * v[0]))];
    const c0 = cr(b, c), c1 = cr(c, a), c2 = cr(a, b);
    const q = f(1.0 / f(f(f(c0[0] * a[0]) + f(c0[1] * a[1])) + f(c0[2] * a[2])));
    const k = [c0, c1, c2].map(v => v.map(x => f(x * q)));                 // the inverse's columns
    const R = [0, 1, 2].map(i => [k[0][i], k[1][i], k[2][i], 0]);
    const T = k.map(v => f(-f(f(f(t[0] * v[0]) + f(t[1] * v[1])) + f(t[2] * v[2]))));
    return [...R, [T[0], T[1], T[2], 1]];
  }
  // FUN_005ad730(MP, .., (int)(2 x head frame), out): the root bone's sample at that / 2 (FUN_005af980: q, t x 1/256)
  // as a matrix (FUN_00262de0 rows = q applied to the axes, FUN_00444c88 translation). opts.rootTrack(model, clip)
  // = { n, t: [[x, y, z]...], q: [[x, y, z, w]...] } per clip frame, model space (enemies.js / enemy_hit.js rootTrack);
  // between frames t lerps and q nlerps as the page's pose (enemy_hit.js modelPose).
  function rootMatrix(tr, s) {
    const n = tr.t.length, i0 = Math.max(0, Math.min(Math.floor(s), n - 2)), u = s - i0, i1 = Math.min(i0 + 1, n - 1);
    const t = [0, 1, 2].map(c => f(tr.t[i0][c] * (1 - u) + tr.t[i1][c] * u));
    const q0 = tr.q[i0], q1 = tr.q[i1], sg = q0[0] * q1[0] + q0[1] * q1[1] + q0[2] * q1[2] + q0[3] * q1[3] < 0 ? -1 : 1;
    let q = [0, 1, 2, 3].map(c => q0[c] * (1 - u) + sg * q1[c] * u);
    const m = Math.hypot(...q) || 1; q = q.map(x => x / m);
    const rot = v => {                                                        // q v q*
      const [x, y, z, w] = q, ix = w * v[0] + y * v[2] - z * v[1], iy = w * v[1] + z * v[0] - x * v[2];
      const iz = w * v[2] + x * v[1] - y * v[0], iw = -x * v[0] - y * v[1] - z * v[2];
      return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x];
    };
    const rows = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map(e => [...rot(e).map(f), 0]);
    return [...rows, [t[0], t[1], t[2], 1]];
  }
  // FUN_00343160 l.138-216, after the motion update: with the MP (C+0x7c8) and C+0x568 bit 5, the head layer's
  // root at (int)(2 x frame) (FUN_005a9120: MP+0x218 + 0x30 x head, x 2) while that is under 2 x n (FUN_005ad6e8);
  // delta = the sample x inverse(C+0x6d0) (FUN_0026125c(D, M, inv) = inv x M), C+0x6d0 = the sample, C+0x370 = its
  // y with C+0x568 bit 8, else 0 (FUN_00351400: only with C+0x1c4 bit 7). Past the end: delta identity, C+0x370 0.
  // Movers 8 / 0xb: bit 6 -> the translation mirrored along the delta's row 0 (FUN_00260e28(-1, t, t, row 0):
  // t - 2 (t . u) u, u = unit row 0), else its x / z 0; bit 7 clear -> rows 0-2 zeroed; bit 8 clear -> its y 0;
  // C+0x54c vt+0x34 (a parent frame): none for the stage's soldiers (path_mover FUN_0034af98); FUN_003513c8 ->
  // C+0x310 (C+0x1c4 bit 7). T: k_melee18 #66, one sample per frame at 0, 0.5, 1, 1.5, 2, 2.5, 3.5, 4 ...
  // (the head frame gains 0.59999996 a frame; 5 x that is 2.9999998, so 3.0 is skipped).
  function rootSample(a) {
    const C = a.C;
    if (!(C.f568 & 0x20)) return;
    const h = C.mp, tr = h && opts.rootTrack ? opts.rootTrack(a.model, h.clip) : null;
    if (!h || h.frame == null || !tr) { warnOnce('enemy_ai: root motion without the head layer\'s frame or root track (opts.rootTrack): no lunge'); return; }
    const fr = Math.trunc(f(h.frame + h.frame)), n = clipFrames(a, h.clip) ?? tr.t.length;
    let D;
    if (fr < 2 * n) {
      const M = rootMatrix(tr, f(fr * 0.5));
      D = mmul(M, minv(C.r6d0));
      C.r6d0 = M;
      if (C.f1c4 & 0x80) C.r370 = (C.f568 & 0x100) ? M[3][1] : 0;
      if (M[3][1] !== 0 && (C.f568 & 0x100)) warnOnce('enemy_ai: vertical root motion (body+0xa0 under +0xac bit 7) not translated');
    } else {
      D = PM.IDENT4();
      if (C.f1c4 & 0x80) C.r370 = 0;
    }
    if (C.mover !== 8 && C.mover !== 0xb) return;
    const t = D[3].slice();
    if (C.f568 & 0x40) {
      const u = D[0], l = f(Math.sqrt(f(f(f(u[0] * u[0]) + f(u[1] * u[1])) + f(u[2] * u[2]))));
      const nu = [0, 1, 2].map(c => f(u[c] / l)), d = f(f(f(t[0] * nu[0]) + f(t[1] * nu[1])) + f(t[2] * nu[2]));
      for (let c = 0; c < 3; c++) t[c] = f(f(t[c] - f(nu[c] * d)) + f(f(nu[c] * d) * -1.0));
    } else { t[0] = 0; t[2] = 0; }
    if (!(C.f568 & 0x80)) { D[0] = [0, 0, 0, 0]; D[1] = [0, 0, 0, 0]; D[2] = [0, 0, 0, 0]; }
    if (!(C.f568 & 0x100)) t[1] = 0;
    D[3] = t;
    if (C.f1c4 & 0x80) C.m310 = D;
  }
  // The attack motion's leave FUN_0059e938, its root-motion part: FUN_00340b28(C, 0) (C+0x568 bit 5 clear,
  // C+0x310 identity, C+0x370 0), FUN_00356248(body, 0), FUN_00356278(0, body), C+0x45c &= ~0x40100; with
  // C+0x568 bit 12: C+0x564 bit 11 clear -> FUN_003533e0 (every mover stops), then FUN_0034b110(0, C) and move
  // mode 0xc (FUN_0034db80) unless 0xc / 0x10-0x12; bit 12 cleared; C+0x1c0 bit 26 -> C+0x45c |= 0x200000.
  // Not translated here: its FUN_00341988(C, 5, 0) and FUN_00348998(C). C+0x568 bits 6-8 stay set (no clear found
  // apart from FUN_003472c0).
  function rootLeave(a) {
    const C = a.C;
    C.f568 &= ~0x20;
    if (C.f1c4 & 0x80) { C.m310 = PM.IDENT4(); C.r370 = 0; }
    PM.bodyRootOn(a, 0);
    PM.bodyRootY(a, 0);
    C.f45c = ((C.f45c | 0) & ~0x40100) >>> 0;
    if (C.f568 & 0x1000) {
      if (!(C.f564 & 0x800)) PM.stopAll(a, warnOnce);
      else warnOnce('enemy_ai: attack leave with C+0x564 bit 11 (FUN_00342308 branch) not translated');
      C.want = a.face.slice(); C.wk = 0;                                      // FUN_0034b110(0, C)
      if (C.mm !== 0xc && !(C.mm >= 0x10 && C.mm <= 0x12)) warnOnce('enemy_ai: attack leave outside move mode 0xc (FUN_0034db80) not translated');
    }
    C.f568 &= ~0x1000;
    if (C.f1c0 & 0x4000000) C.f45c = ((C.f45c | 0) | 0x200000) >>> 0;
  }

  // ------------------------------------------------ melee hit volume: the attack object (class 0xd)
  // op 2 -> FUN_003481e0 case 2: record = table +0x24 + arg 2 x 64 (ai.json attacks[set].volumes,
  // export_web_triggers.hit_volume) -> owner event 4 (0x56a214) -> FUN_00569dc0(owner, record).
  // T: k_melee18 (#66's r_atk_0): made f1460 (attack keyframe 6), updates from f1461, sphere test and hit
  // f1463 (Vincent HP 560 -> 511), object gone that frame.
  const attackObjs = [];
  const REACT_EC = [2, 4, 8, 0];                                              // FUN_00579ef0: type -> +0xec
  // Soldier status fields the attack damage reads (save RAM, all seven awake e027s): +0x60 0 (so
  // FUN_00317630 = 0 and FUN_00317ef0's difficulty / FUN_003212a8 terms are skipped), +0x64 0
  // (FUN_00317b68 false: no x2), +0xc0 0 (no armour), +0x12 / +0x13 levels 0.
  // GUESS: these fields are read from the save RAM of the seven awake e027s and used for every soldier type
  // (notes/fidelity-audit.md 'Melee hit volume')
  const ENEMY_OFFENCE = { f60: 0, f64: 0, armour: null, l12: 0, l13: 0 };
  function makeAttack(a, T, idx) {
    const v = T.volumes && T.volumes[idx];
    if (!v) { warnOnce(`enemy_ai: attack table has no hit volume ${idx} (old ai.json: rebuild data/enemies)`); return; }
    // FUN_00569dc0 first returns with no object while FUN_00325b40 (AI paused, game-state bit 6) is set.
    if (aiPaused()) return;
    // FUN_00541310: FUN_00541278 = FUN_0053db98(mgr, 0xd) (constructor FUN_00579d00) + activate.
    // FUN_00579ef0: type > 3 -> 0, kept in +0xc0 bits 0-1 (FUN_0055eac8 reads it there), +0xec by type.
    // +0x13c (the repeat interval, record +7) is a signed char (FUN_0057a428 compares it as one).
    const type = v.type > 3 ? 0 : v.type;
    const o = { owner: a, v, type, shape: v.shape > 3 ? 0 : v.shape, ec: REACT_EC[type],
                c1: v.c1, life: f(v.life), every: (v.every << 24) >> 24, r: 5.0, grow: 0, dmg: Math.min(v.dmg, 9999), kind: 1,
                cand: [], local: v.off.slice(), fixed: null };
    if (o.shape === 1 || o.shape === 3) o.r = f(v.p[0]);                       // +0xd0 = record +0x30
    // shape 2 (FUN_00541310): +0xd8 height = record +0x30, +0xd0 outer = +0x34, +0xd4 inner = +0x38, +0xdc = +0x3c x 0.017453294.
    // o.r is then the half side of its candidate box (FUN_0057bd00), which does not grow. Shapes 0 / 3: not translated
    if (o.shape === 2) {
      o.h = f(v.p[0]); o.outer = f(v.p[1]); o.inner = f(v.p[2]); o.ang = f(f(v.p[3]) * 0.017453294);
      o.r = sectorBoxR(o);
    } else if (o.shape !== 1) { warnOnce(`enemy_ai: hit volume shape ${o.shape} (target vt+0x19c / vt+0x1a4 kin) not translated: no hit`); return; }
    // FUN_00569dc0: owner weapon W (FUN_00317c70 = status +0xac, +0x60 bit 9 clear) and FUN_00317630 != 2:
    // damage = (int)((dmg + 0.5) x 0.01 x (W+0x56 + 100)), FUN_00579ff8 cap 9999
    const W = a.ai && a.ai.W;
    if (W) {
      if (W.w56 == null) warnOnce('enemy_ai: weapons have no w56 (W+0x56; old ai.json): melee damage unscaled');
      o.dmg = Math.min(Math.trunc(f(f(f(f(o.dmg) + 0.5) * f(0.01)) * f((W.w56 ?? 0) + 100))), 9999);
    }
    // FUN_00317b68(owner status) -> FUN_0057a2b0 (x2, radius x 1.5): status +0x64 bit 5 is 0 (save RAM)
    if (ENEMY_OFFENCE.f64 & 0x20) warnOnce('enemy_ai: FUN_0057a2b0 (doubled melee) not translated');
    // FUN_0057a018(o, owner +0x100) -> FUN_00318bf8 -> FUN_0057a248: the owner's offence FUN_00317ef0
    o.dmg = Math.min(offence(ENEMY_OFFENCE, o.dmg, o.kind), 9999);
    // attach (record +5 / +6; +0xc1 bit 3 = follow the owner's marker every frame, else placed once)
    if (v.m6 < 0 || v.m5 !== 0) { warnOnce(`enemy_ai: hit volume attach +5 ${v.m5} / +6 ${v.m6} (owner matrix / FUN_0054a7d0) not translated: no hit`); return; }
    o.marker = v.m6;
    if (!(o.c1 & 8)) { o.fixed = attackCentre(o); if (!o.fixed) return; if (o.shape === 2) o.fixedRows = attackRows(o); }
    attackObjs.push(o);
    events.push(`attack object ${a.id} vol ${idx} dmg ${o.dmg}`);
    // owner +0x28 bit 2 (FUN_00573360 + HUD) : the soldiers have it clear (0x208403)
  }
  // worker 0235: the z128 boss's dive volume (boss overlay FUN_00aa16f8 state 4; notes/boss-research.md): FUN_00541278 =
  // FUN_0053db98(mgr, 0xd) (constructor FUN_00579d00: +0xc1 = 1, every target) + activate; FUN_00579ef0(2) (type 2: +0xec 8),
  // FUN_00579f70(1) (sphere), +0xc0 bits 4-7 = 0xc, FUN_00579ff8(bshv0) (cap 9999), FUN_0057a018(owner id) (the offence
  // FUN_00317ef0, as makeAttack), +0xe0 = 200 (life), +0xd0 = 40 (radius), FUN_0054bf48(o, owner, 1) = parented to the
  // owner's marker 1 (+0x3a = 1, +0x3b = -1: followed every frame, attackCentre), +0x130 = the hit effect, FUN_0057a090 =
  // the hit sound +0x134 (both played by FUN_0057a830 at the hit). +0xc0's nibble has no reader on the page.
  function bossVolume(a, x) {
    if (aiPaused()) return null;
    const o = { owner: a, v: { c0: x.c0 }, type: x.a > 3 ? 0 : x.a, shape: x.b, ec: REACT_EC[x.a > 3 ? 0 : x.a], c1: 1, life: f(x.e0),
                every: 0, r: f(x.d0), grow: 0, dmg: Math.min(x.f54, 9999), kind: 1, cand: [], local: [0, 0, 0], fixed: null,
                marker: x.marker, fx: x.fx, se: x.se };
    o.dmg = Math.min(offence(ENEMY_OFFENCE, o.dmg, o.kind), 9999);
    attackObjs.push(o);
    events.push(`attack object ${a.id} boss dmg ${o.dmg}`);
    return o;
  }
  // FUN_00317ef0(status, raw, kind): the attacker's level bonus, as defence's (FUN_00318120) mirror.
  // Armour (+0xc0 with +0x61 bit 0): G+0x14 tables +0x40c / +0x43c / +0x45c: not translated (soldiers have none).
  function offence(st, raw, kind, G = GAME) {
    let L = 0;
    if (st.armour) warnOnce('enemy_ai: FUN_00317ef0 armour bonus not translated');
    else {
      const k = G.progress < 7 ? G.lvlK0 : kind === 2 ? G.offK2 : G.offK;   // FUN_0031d0b0 / FUN_0031cd58
      L = Math.trunc(f(f(f(k[0]) * (kind === 2 ? st.l13 : st.l12)) + f(k[1])) + 0.5);
    }
    if ((st.f60 & 2) && !(st.f60 & 0x100)) {
      if (G.progress > 0x11) {                                                // FUN_00310c60
        const d242c28 = (G.d46b2fc !== 0 && G.d46b328 === 0) ? 1 : G.d46b328;
        let c = G.d46b2fc === 0 ? d242c28 : (((G.bits4b8ac8 >>> 0x11) & 1) ? 0 : d242c28 - 1);
        L += c === 1 ? G.cutO.ac : (c < 2 || c > 3) ? G.cutO.a8 : G.cutO.b0;
      }
      L += G.d46e248;                                                         // FUN_003212a8
    }
    if (L < -100) L = -100;
    const d = Math.trunc(f(f(f(raw) + 0.5) * f(L + 100) * f(0.01)));
    let r = raw !== 0 ? d : 0;
    if (raw > 0 && d === 0) r = 1;
    return r;
  }
  // FUN_0054a720 of the attack object: with a parent (+8 = owner, +0x3a = marker, +0x3b = -1) its world =
  // local x marker world (FUN_0054a5e8 -> FUN_0054a768 -> owner vt+0x24 FUN_005883c0 -> FUN_003462f8 ->
  // FUN_005ad508 -> FUN_0030bef8: T(marker xyz) x bone palette, then x diag(1,-1,-1) (FUN_00342fa8) and
  // the owner's world). The page's boneWorld (bone x model, the part test's) stands for the last three.
  // Local row 3 = record +0x20 (the rows' rotation does not move a sphere's centre).
  // why world.boneWorld gave no pose: unset (no page / test hook), or set but this actor has no posed body (still loading)
  const noPose = a => world.boneWorld ? `record ${a.rec} has no posed body yet` : 'boneWorld unset';
  function attackCentre(o) {
    if (o.fixed) return o.fixed;
    const a = o.owner, mk = data.markers && data.markers[recModel(a)];
    const m = mk && mk[o.marker];
    if (!m) { warnOnce(`enemy_ai: no marker ${o.marker} for ${recModel(a)} (old ai.json: rebuild data/enemies)`); return null; }
    const bw = world.boneWorld ? world.boneWorld(a) : null;
    if (!bw || m[3] < 0) { warnOnce('enemy_ai: no pose for the melee hit volume (' + noPose(a) + ')'); return null; }
    const B = bw(m[3]);
    const p = [0, 1, 2].map(k => f(m[k] + o.local[k]));
    return [0, 1, 2].map(k => f(f(f(f(p[0] * B[0][k]) + f(p[1] * B[1][k])) + f(p[2] * B[2][k])) + B[3][k]));
  }
  // The attack object's rows 0-2 in the world (FUN_0054a5e8: local +0x60 x the owner's marker): FUN_00541310's local rows =
  // cross(ax[+3], ax[+2]), ax[+3], ax[+2] from the axis table DAT_0058bab0; the markers carry no rotation (as attackCentre).
  const AXES = [[-1, 0, 0], [1, 0, 0], [0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1]];   // DAT_0058bab0
  function attackRows(o) {
    if (o.fixedRows) return o.fixedRows;
    const a = o.owner, m = data.markers[recModel(a)][o.marker], B = world.boneWorld(a)(m[3]);
    const r2 = AXES[o.v.ax[0]], r1 = AXES[o.v.ax[1]];
    const r0 = [f(f(r1[1] * r2[2]) - f(r1[2] * r2[1])), f(f(r1[2] * r2[0]) - f(r1[0] * r2[2])), f(f(r1[0] * r2[1]) - f(r1[1] * r2[0]))];
    return [r0, r1, r2].map(L => [0, 1, 2].map(k => f(f(f(L[0] * B[0][k]) + f(L[1] * B[1][k])) + f(L[2] * B[2][k]))));
  }
  // FUN_0057bd00 (shape 2's vt+0x34): the local box of FUN_0025fbe8, half its diagonal = the half side of the candidate box.
  // playerCandidate measures from the object's own position (FUN_0057aed8: FUN_0054a720), as for the sphere.
  function sectorBoxR(o) {
    let lo, hi;
    if (o.ang < 3.1415927) {
      const s = f(Math.sin(f(o.ang * 0.5))), x = f(o.outer * s);
      lo = [-x, f(-f(o.h * 0.5)), f(o.inner * f(Math.cos(f(o.ang * 0.5))))];
      hi = [x, f(o.h * 0.5), o.outer];
    } else {
      lo = [-o.outer, f(-f(o.h * 0.5)), f(o.outer * f(Math.cos(f(o.ang * 0.5))))];
      hi = [o.outer, f(o.h * 0.5), o.outer];
    }
    const d = sub3(lo, hi);
    return f(f(Math.sqrt(f(f(f(d[0] * d[0]) + f(d[1] * d[1])) + f(d[2] * d[2])))) * 0.5);
  }
  // FUN_0025dce0(rt, p, vol, m): the point p with radius rt against an annular sector: axis row 1 of height h centred on row 3,
  // radii inner .. outer, opening ang about local +z. Past the axis's ends the radii shrink by rt cos(e pi/2 / rt); outside
  // the opening the point must lie within rt of the sector's edge segment (xz only while within the height, 0x25e17c).
  function sectorTest(rt, p, o, c, rows) {
    const d = rows[1].map(x => f(x * o.h));
    const base = c.map((x, k) => f(x - f(d[k] * 0.5)));
    const dot = (u, v) => f(f(f(u[0] * v[0]) + f(u[1] * v[1])) + f(u[2] * v[2]));
    const near = (pt, a, dir) => {                                            // FUN_002614f4: t along dir (unclamped), the point there
      const t = f(dot(sub3(pt, a), dir) / dot(dir, dir));
      return { t, q: a.map((x, k) => f(x + f(dir[k] * t))) };
    };
    const n = near(p, base, d);
    const s = f(n.t * f(Math.sqrt(dot(d, d))));
    if (f(o.h + rt) < s || s < -rt) return false;
    const e = sub3(p, n.q), radial = f(Math.sqrt(dot(e, e)));
    if (f(o.outer + rt) < radial || radial < f(o.inner - rt)) return false;
    const w = sub3(p, c), l = [Math.abs(dot(w, rows[0])), dot(w, rows[1]), dot(w, rows[2])];   // FUN_002610e0 + FUN_0026138c; |x|
    const cs = f(Math.cos(f(o.ang * 0.5)));
    if (cs <= f(l[2] / f(Math.hypot(l[0], l[2])))) {
      const over = s < 0 ? Math.abs(s) : o.h < s ? Math.abs(f(s - o.h)) : -1;
      if (over < 0) return true;
      const k = f(rt * f(Math.cos(f(f(over * 1.5707964) / rt))));
      return radial <= f(o.outer + k) && f(o.inner - k) <= radial;
    }
    const edge = [f(Math.sin(f(o.ang * 0.5))), 0, cs];
    const a0 = edge.map(x => f(x * o.inner)), seg = edge.map(x => f(x * f(o.outer - o.inner)));
    const inHeight = !(s < 0 || o.h < s);
    if (!inHeight) a0[1] = f(o.h * (s < 0 ? -0.5 : 0.5));
    const g = near(l, a0, seg);
    const pt = g.t < 0 ? a0 : g.t <= 1 ? g.q : a0.map((x, k) => f(x + seg[k]));
    const r = sub3(pt, l), d2 = inHeight ? f(f(r[0] * r[0]) + f(r[2] * r[2])) : dot(r, r);
    return f(Math.sqrt(d2)) <= rt;
  }
  // FUN_0025db68(rs, rc, c, a, b): sphere (c, rs) against the capsule a..b of radius rc. FUN_002614f4: t =
  // (c - a).d / d.d, q = a + d t (not clamped); |q - c| < rs + rc, then s = t |d| in [-rs, rs + |d|]: on
  // the segment -> hit; past an end by e -> hit when |q - c| <= rc + rs cos(e pi/2 / rs) (FUN_0045b428 = cosf).
  function sphereCapsule(rs, rc, c, A, B) {
    const d = sub3(B, A), dd = f(f(f(d[0] * d[0]) + f(d[1] * d[1])) + f(d[2] * d[2]));
    const w = sub3(c, A), t = f(f(f(f(w[0] * d[0]) + f(w[1] * d[1])) + f(w[2] * d[2])) / dd);
    const q = A.map((x, k) => f(x + f(d[k] * t))), e = sub3(q, c);
    const dist = f(Math.sqrt(f(f(f(e[0] * e[0]) + f(e[1] * e[1])) + f(e[2] * e[2]))));
    if (!(dist < f(rs + rc))) return false;
    const L = f(Math.sqrt(dd));
    let s = f(t * L);
    if (!(-rs <= s && s <= f(rs + L))) return false;
    if (s < 0) s = Math.abs(s);
    else { if (s <= L) return true; s = f(s - L); }
    const k = f(Math.cos(f(f(s * f(1.5707964)) / rs)));
    return !(f(rc + f(rs * k)) < dist);
  }
  // Vincent's capsule (FUN_0055bc90 -> FUN_0054b2b0: +0x118 bit 24 and +0x28 bit 16 clear, T k_melee18):
  // feet .. feet + up (0,-1,0) x P+0x30 (18), radius P+0x2c (5)
  const playerCapsule = () => [P.pos.slice(), [P.pos[0], f(P.pos[1] - H_PLAYER), P.pos[2]]];
  // Candidates (FUN_0057a9b8 first update, FUN_0057aed8 later ones): objects of grid M+0x1170 (type 6) in the
  // box centre -/+ (r + growth x life) (vt+0x34 FUN_0057b968) with +0x28 bit 0, +0x40 bit 6, the filter vt+0x1dc
  // FUN_0055e878 and a horizontal (xz) distance from the box middle < |box diagonal| / 2 + their +0x2c.
  // Only Vincent: FUN_0055e878 rejects the soldiers by their +0x188 bit 39 (save RAM 0x8765430087652d01
  // on all seven; their faction 1 -> 1 is also not hostile in DAT_004a0290 = 0x16 0x3d 0x3b 0 0 0x16 0).
  // Vincent passes: +0x28 0x20901f, +0x40 0xf0, +0x188 0x00cccf20c00c0605 (faction 5: 0x3d bit 5 set),
  // +0x118 0x20209. L: the grid cell lookup FUN_0036d400 is not read (the distance test decides); FUN_0055e878's
  // FUN_003419c0 states 0x3c-0x3e (immune) and status +0x64 bits 0 / 1 are taken from P.motionClass / PST.f64.
  // P.motionClass: play.js, jump_core motionId (worker 0255; the page's locomotion classes all read as 3).
  function playerCandidate(o, c) {
    if (dead(P)) return false;                                                // FUN_00316cf8 with +0x28 bit 5 clear
    if (JITTER_ON && P.motionClass != null && P.motionClass >= 0x3c && P.motionClass <= 0x3e) return false;
    if ((PST.f64 | (P.s64 ?? 0)) & 3) return false;                           // FUN_0055f0e0(P, 1) / (P, 0) (worker 0255: php.s64 = status +0x64)
    const h = f(f(o.r) + f(f(o.grow) * o.life)), diag = f(Math.sqrt(f(3 * f(f(2 * h) * f(2 * h)))));
    const dx = f(P.pos[0] - c[0]), dz = f(P.pos[2] - c[2]);
    return f(Math.sqrt(f(f(dx * dx) + f(dz * dz)))) < f(f(diag * 0.5) + R_PLAYER);
  }
  // FUN_0057a330, the object's update: hit = FUN_0057a428; life -= step; a hit that is not for every target
  // (+0xc1 bits 0 / 2 clear) or life < 0 ends it (no hit recorded (bit 5) -> the owner's miss count
  // FUN_00568e70 -> FUN_003609b0: AI +0x76 += 1, +0x58 = now); else FUN_0057b170: radius += growth x step.
  function attackObjUpdate(o, step) {
    const hit = attackHitTest(o);
    o.life = f(o.life - step);
    if ((hit && !(o.c1 & 1) && !(o.c1 & 4)) || o.life < 0) {
      const ai = o.owner.ai;
      if (!(o.c1 & 0x20) && ai) { ai.f76 = short((ai.f76 | 0) + 1); ai.f58 = S.now; }
      events.push(`attack object end ${o.owner.id}${o.c1 & 0x20 ? ' hit' : ''}`);
      return 1;
    }
    o.r = f(o.r + f(o.grow * step));                                          // shape 1 vt+0x2c (0x57b950)
    return 0;
  }
  // FUN_0057a428: the candidate list (+0xea count, +0xf0 entries {id, flags, frame}), then per candidate
  // the shape test (sphere: FUN_0057b8b8 -> target vt+0x19c FUN_0055c5f8 -> FUN_0025db68; sector: FUN_0057bc00 -> vt+0x1a4
  // FUN_0055c678 (Vincent's too, T vtable 0x58f128): FUN_0025dce0 at FUN_00342108's point, (0, 8, 0) through his C matrix, row 1
  // (0, -1, 0) T route RAM; its hit point = row 2 x inner + row 3). A first hit
  // ends the loop unless +0xc1 bit 0; bit 2 lets an entry hit again after +0x13c frames. The hit(s) go to
  // FUN_0057a830.
  function attackHitTest(o) {
    const c = attackCentre(o);
    if (!c) return false;
    if (!(o.c1 & 0x80)) { o.cand = []; o.c1 |= 0x80; }                        // FUN_0057a9b8 (fresh) / FUN_0057aed8 (add)
    if (o.cand.length < 16 && !o.cand.some(e => e.who === P) && playerCandidate(o, c)) o.cand.push({ who: P, fl: 0, fr: 0 });
    let hit = false;
    for (const e of o.cand) {
      if (!(o.c1 & 4)) { if (e.fl & 1) continue; }
      else if (e.fl & 2) { if (((S.mgr20 - e.fr) << 24 >> 24) < o.every) continue; e.fl &= ~2; }
      const [A, B] = playerCapsule();
      let at = c;
      if (o.shape === 2) {
        const rows = attackRows(o);
        if (!sectorTest(R_PLAYER, [P.pos[0], f(P.pos[1] - 8.0), P.pos[2]], o, c, rows)) continue;
        at = c.map((x, k) => f(x + f(rows[2][k] * o.inner)));
      } else if (!sphereCapsule(o.r, R_PLAYER, c, A, B)) continue;
      e.fl |= 1;
      if (o.c1 & 4) { e.fl |= 3; e.fr = S.mgr20 & 0xff; }
      attackApply(o, at, A, B);
      hit = true;
      if (!(o.c1 & 1)) break;
    }
    return hit;
  }
  // FUN_0057a830: target vt+0x1e4 (Vincent: FUN_005725d8 -> FUN_0055eac8), +0xc1 |= 0x20, the owner's hit
  // count FUN_00568e48 -> FUN_00360990 (AI +0x7a += 1, +0x60 = now). Effects FUN_00541b08 / +0x130 / +0x134
  // are not on the page. FUN_005725d8 calls FUN_00336508 (= FUN_003366b8(0x1000), FED r0000) after FUN_0055eac8
  // with no gate and no P+0x280 stamp (worker 0200).
  function attackApply(o, c, A, B) {
    if (!((P.f118 | 0) & 0x20)) {                                               // FUN_005725d8: P+0x118 bit 5
      attackDamagePlayer(o, c, A, B);
      if (opts.effect && opts.effect.spawn) opts.effect.spawn(0x1000, [0, 0, 0]);
    }
    // worker 0235: FUN_0057a830: +0x130 effect (FUN_003365e0) and +0x134 sound (FUN_0033cc48) at the hit (bossVolume sets them).
    // L: the hit point is taken as the volume's centre (FUN_00541b08's point is not read).
    if (o.fx && opts.effect && opts.effect.spawn) opts.effect.spawn(o.fx, c.slice());
    if (o.se) sound(o.se, c.slice());
    o.c1 |= 0x20;
    const ai = o.owner.ai;
    if (ai) { ai.f7a = short((ai.f7a | 0) + 1); ai.f60 = S.now; }
  }
  // FUN_0055eac8(P, attack, point): no damage with status +0x64 bits 0 / 1 unless type 3; dmg = defence
  // FUN_00318120(status, +0xc2, FUN_0057a218 = 1) (cap 9999); alive: +0x118 bits 5 / 6 -> 0, then vt+0x1ec
  // vt+0x324 FUN_00576ac8(P, dmg, deadNow) from vt+0x1ec FUN_0055c7f8 (worker 0174): FUN_0055c978(P, dmg, deadNow):
  // alive -> cue 0x44 (FUN_00341330), cue 0x4c through the 15-frame gate FUN_003412d0 (C+0x810), then script event 8
  // (r0 = dmg; Vincent's scripts have none). Vincent's z128 cues: 0x44 '' (nothing), 0x4c '?' -> event 0x25 of his
  // script = script 297: rand_i(6) -> bt_v000 / bt_v001 / bt_v002 for 0 / 1 / 2, nothing for 3-6 (cmd 0x125).
  // Then vt+0x344 FUN_00576c28 (dmg > 0, and again in FUN_00576ac8): DAT_0046e54c |= 4 when DAT_00470290+0x30 != 0,
  // no reader on the page; FUN_003b4ea8(DAT_00471380) acts only when FUN_00242c28() > 1 (save: DAT_0046b328 = 1).
  // T: w172_sound3 f789 bt_v002 at Vincent; w174_pain_a f952 cue 0x44, rand 0.757431 -> 5, no sound, C+0x810 359.
  function playerHitCues(dmg, deadNow) {
    if (!PLAYER_OBJ || deadNow) return;
    playerCue(0x44);                                                          // FUN_00341330(C, 0x44)
    gatedCue(0x4c, 0);                                                        // FUN_003412d0(C, 0x4c, 0)
    runEvent(PLAYER_OBJ, 8, [dmg, 0]);                                        // vt+0x2f4 event 8
  }
  // vt+0x334 FUN_00576b48 (Vincent's death, worker 0181) -> FUN_0055cac8: FUN_00341298(C, 0x4e) (his cue 0x4e is '')
  // -> FUN_003412d0(C, 0x4c, 0) (gated: the hit-voice script 297 event 0x25, one RNG draw); script event 0x17 (none
  // in 246 / 297); FUN_005435a8 (the manager's lock list), P+0x28 bit 2 branch (FUN_0055f0e0(P, 4): status bit 4
  // clear), vt+0x374(2, now) (P+0x244 = the death frame), vt+0x344 FUN_00576c28 (DAT_0046e54c |= 4 when G+0x30),
  // FUN_00573378(P, -1) (his lock target cleared), FUN_00241760(1, 3, 0) (the pause menu blocked, FUN_003de130):
  // not on the page (no reader there). Returns nothing; the death motion's own cue is deathMotionCue.
  function playerDeathCues() {
    if (!PLAYER_OBJ) return;
    gatedCue(0x4c, 0);
  }
  // FUN_00321328 (FUN_0055c7f8 after vt+0x334, P+0x28 bit 2: set for Vincent, 0x20901f): DAT_0046e248+0x18 += 1
  // when the record exists. FUN_003210f0 zeroes it (and +0x10) from FUN_0031db30 (the stage record's reset). No
  // reader found in the decomp (only those two touch +0x18 by that name): likely a death count, kept for the game
  // over (notes/enemy-ai-hook.md 'Game over'). The page's record: W.stageRec (created zeroed with the AI).
  const stageRec = { f10: 0, f18: 0 };
  function deathCount() { if (((P.f28 ?? 0x20901f) & 4)) stageRec.f18++; }
  // FUN_00595a60 phase 0 (the death class 0xb, the frame he enters state 7): FUN_00341330(C, cue) with cue =
  // DAT_005a39b0[side] (ai.json player.death.cue: 0x56 0x56 0x57 .. 0x5b) when FUN_00340658 is false (C+0x6c1 not in
  // 10..11), else DAT_005a39d0[side] (cue_alt, 0x62..); side = C+0x590 & 0xf (FUN_0055d678 below: melee kills set
  // it; the bullet path never calls it, so a shot keeps the side last written, 0 from the save RAM or a live hit).
  // GUESS: C+0x6c1 = 3 is the save-RAM value (not decoded where it is set): the 39b0 row.
  // Not taken: FUN_00342308(C) != 0 (side = FUN_00345060(C) % 7); the page's death class takes it as 0 too.
  function deathMotionCue() {
    if (!PLAYER_OBJ) return;
    const t = data.player.death;
    if (!t) { warnOnce('enemy_ai: ai.json has no player.death cues: rebuild data/enemies; no death cue'); return; }
    const side = hitSideIO.get() & 0xf;
    if (side < t.cue.length) playerCue(t.cue[side]);
  }
  // FUN_0055d678(P, point): C+0x590 low 4 bits = the hit side. Called by FUN_0055eac8 (melee) after the damage
  // (vt+0x1ec, which runs vt+0x334 on a kill) when he was alive before, and before FUN_00565480; never on the bullet
  // path (FUN_0055db50). The point goes into P's frame (FUN_0054aaf8 = FUN_0054a5e8 matrix P+0x60, FUN_00261618:
  // R^T (point - row 3)): x along row 0 (= up x face, up (0, -1, 0): (-face.z, 0, face.x)), y along row 1 (0, -1,
  // 0) = height above P+0x90. Dead (FUN_00316cf8): y > P+0x30 x 0.3 -> 3 (x > 0.25), 4 (x < -0.25), else 1; lower
  // -> 5, or 6 for x < 0. Alive: every path writes 0 (asm 0x55d6cc-0x55d794: the C+0x564 bit 0x10000 / 0.7 / 0.3
  // / 0.5 tests all reach the store with s1 = 0). P+0x30 = 18 (H_PLAYER, k_push16 p_cyl). No C: nothing.
  // L: P's matrix = php.pos / php.face as the melee hit test sees them (after this frame's step on the page).
  function playerHitSide(point) {
    const face = P.face;
    if (!face) { warnOnce('enemy_ai: player has no face (C+0x20): FUN_0055d678 hit side not written'); return; }
    let side = 0;
    if (dead(P)) {
      const dx = f(point[0] - P.pos[0]), dy = f(point[1] - P.pos[1]), dz = f(point[2] - P.pos[2]);
      const x = f(f(-face[2] * dx) + f(face[0] * dz)), y = f(-dy);
      if (f(H_PLAYER * f(0.3)) < y) side = 0.25 < x ? 3 : x < -0.25 ? 4 : 1;
      else side = x < 0 ? 6 : 5;
    }
    hitSideIO.set(side);
  }
  // FUN_003412d0(C, cue, force): force or more than 14 frames since C+0x810 -> FUN_00341330, C+0x810 = now
  function gatedCue(c, force) {
    if (!force && !(0xe < S.mgr20 - P.c810)) return;
    playerCue(c);
    P.c810 = S.mgr20;
  }
  // FUN_00341330(C, cue): C+0x7ec table; '' -> nothing; '?' -> event 0x25 (r0 = cue) to the owner C+0x7dc = P;
  // else FUN_00341268 -> FUN_0054b158(P, name, 1). L: FUN_0054b158 taken as "play the name at P" (notes/audio-
  // research.md 'Cue sounds'; no named cue is reached on the hit path in z128).
  function playerCue(c) {
    if (!PLAYER_CUES) { warnOnce('enemy_ai: ai.json has no cue tables: rebuild data/enemies; no hit voice'); return; }
    if (!(c < PLAYER_CUES.length)) return;
    const nm = PLAYER_CUES[c];
    if (!nm) return;
    if (nm === '?') { runEvent(PLAYER_OBJ, 0x25, [c, 0]); return; }
    sound(nm, Array.from(P.pos));
  }

  // FUN_0055c7f8 (as damagePlayer). The soldier's vt+0x314 / +0x31c (0x55e0c8 / 0x55e0d0) and Vincent's
  // +0x184 (no AI) do nothing. Not behind opts.damage: that option (the page's ?enemydmg=0) only covers the
  // soldiers' bullets; a melee hit always damages Vincent.
  // Then vt+0x324 FUN_00576ac8 (playerHitCues: his hit voice), the reaction FUN_00565480 (play.js react).
  // FUN_0055ea50 ('h_dmg_N': a pad vibration pattern) and HUD FUN_00567fe8 (FUN_00567d00 returns for Vincent):
  // nothing to draw; script event 0x1d (vt+0x2f4): none in his scripts.
  function attackDamagePlayer(o, c, A, B) {
    events.push(`melee hit player ${o.owner.id}`);
    if (((PST.f64 | (P.s64 ?? 0)) & 3) && o.type !== 3) return;               // +0xc0 & 3 (FUN_00579ef0's clamped type)
    let dmg = Math.min(defence(PST, o.dmg, o.kind), 9999);
    if (dead(P)) return;
    if ((P.f118 & 0x20) || (P.f118 & 0x40)) dmg = 0;
    if ((P.f118 | 0) < 0 && P.hp <= dmg) dmg = P.hp - 1;                      // FUN_0055c7f8
    // FUN_0057b1b0(attack, out, FUN_0054a720(P)): +0xc0 bits 4-7 = 0xc (k_melee18: 0x3288c5) >= 8, bits 4-6
    // = case 4: P's position less the parent's (+8 = the owner) matrix row 3, its component along the
    // owner's row 1 removed (FUN_00260e28(0, ..)), normalised. The soldiers' row 1 is (0, -1, 0).
    const away = sub3(P.pos, o.owner.pos);
    const dir = unit3([away[0], 0, away[2]]);
    if (!aiPaused()) {                                                        // FUN_0055c7f8: nothing while FUN_00325b40 (bit 6)
      const before = P.hp;
      P.hp = Math.max(0, P.hp - dmg);                                         // FUN_003168c8
      statAdd(8, dmg);                                                        // FUN_0055c7f8: P+0x28 bit 2 -> FUN_0031d668(8, dmg)
      events.push(`hit player ${before}->${P.hp}`);
      log(`enemy_ai: Vincent HP ${before} -> ${P.hp} (melee #${o.owner.id})`);
      playerHitCues(dmg, dead(P));                                            // vt+0x324 FUN_00576ac8
      if (dead(P)) { playerDeathCues(); deathCount(); }                       // vt+0x334 FUN_00576b48, FUN_00321328
    }
    // FUN_0055eac8's own cue 0x44 / gate 0x4c (0x55ec70-0x55ecf4) is the P+0x28 bit 0x20 branch, which skips
    // vt+0x1ec (no damage; with FUN_00bec508 and FUN_003b5c88 for attack +0xc1 bit 6). MISSING: P+0x28 bit 0x20 is
    // not on the page, so this function always takes the damage branch (b 0x55ecf8 after vt+0x1ec).
    playerHitSide(c);                                                         // FUN_0055d678 (alive before: the early return above)
    // FUN_00565480(P, +0xec | (P+0x28 bit 2 and +0xec bit 1 -> the owner's +0x60 bit 0x4000: 4), dir, point,
    // alive before), unless P+0x118 bit 0x10000. Type 1 -> +0xec = 4 (bit 1 clear).
    let fl = o.ec;
    if ((o.ec & 2) && ENEMY_OFFENCE.f60 & 0x4000) fl |= 4;
    if (playerReact && !((P.f118 | 0) & 0x10000)) {
      const r = playerReact({ flags: fl, dir, point: c, aliveBefore: true, deadNow: dead(P), f118: P.f118 ?? 0x20209 });
      events.push(`react player ${r}`);
      if (r === 'death') deathMotionCue();                                    // the death class's phase 0 (this frame's C update)
    }
    // FUN_0055ea50 'h_dmg_N' = a pad vibration pattern (FUN_002573c8, table DAT_0046bd98): no pad on the page.
  }

  // FUN_005405b0(.., muzzle, aim, W, status) (W+4 without 0x100000 / 0x200000): s = W+0x1c / +0x20 / +0x24
  // by |aim - muzzle| < T+0xd0 (120) / < T+0xd4 (380) / beyond, / FUN_0031cf08(1.0, status +0x10),
  // FUN_00318518 (no armour record: unchanged), x 0.5 for FUN_00317b68; FUN_0025a058 tilts the direction
  // (two draws, spreadRand); aim' = muzzle + dir x W+0x18 x 10. Shared by Vincent's pellets and the soldiers'
  // shots (notes/enemy-research.md §11.2 / §13). GUESS: FUN_003251f8 (with FUN_00326500 and status +0x60
  // bit 1: the x {1, 0.33, 0.75, 0.1} factor) taken as false: not read; the call logs show no factor.
  function spreadAim(W, range10, start, aim, PS) {
    if (!W.spread || (W.flags & 0x300000)) return aim.slice();
    const v0 = sub3(aim, start), d0 = len3(v0);
    let s = d0 < GAME.spreadD[0] ? W.spread[0] : d0 < GAME.spreadD[1] ? W.spread[1] : W.spread[2];
    const kk = GAME.progress < 7 ? GAME.lvlK0 : GAME.spreadK;                 // FUN_0031cf08 (G+0x60 >= 7)
    s = f(s * f(1.0 / f(f(f(f(kk[0] * PS.b10) + kk[1]) * f(0.01)) + 1.0)));
    if ((PS.f64 & 0x20) && PS.u20top === 2) s = f(s * 0.5);                  // FUN_00317b68
    const d2 = cone(s, unit3(v0), spreadRand);
    return start.map((x, k) => f(x + f(d2[k] * f(range10 * 10.0))));
  }
  // FUN_00552dd8's bullet flags +0x120 that the page reads: W+4 bit 0x2000 clear -> 0x2000 (the room probe at
  // the countdown end, FUN_00554970); W+5 bit 0 clear -> 0x8000 (FUN_0055d100: no hit on a hostile); W+4
  // bit 0x200 -> 0x200 (friendly fire). e027 and Vincent (W+4 0x100): 0x2000 (T: e027 bullets 0x402001).
  function bulletFlags(W) {
    let fl = 0;
    if (W.flags & 0x200) fl |= 0x200;
    if (!(W.flags & 0x100)) fl |= 0x8000;
    if (!(W.flags & 0x2000)) fl |= 0x2000;                                    // else homing: +0x150 mode 1 (spawnShot, worker 0235)
    return fl;
  }
  // worker 0270: the bullet's matrix rows (FUN_00554058 draws its model with them, FUN_00557c68 its trail). FUN_00552dd8: +0x80 =
  // dir; h = the axis of dir's smallest component (|y| <= |x| or |z| <= |x|: y when |y| < |z|, else z; otherwise x); +0x70 =
  // unit(dir x h), +0x60 = +0x70 x dir. FUN_00556218, after a turn: +0x60 = unit(+0x70 x dir), +0x70 = unit(dir x +0x60).
  // (VOPMULA a, b + VOPMSUB b, a = a x b; unit = x VRSQRT.)
  const cross3 = (a, b) => [f(f(a[1] * b[2]) - f(a[2] * b[1])), f(f(a[2] * b[0]) - f(a[0] * b[2])), f(f(a[0] * b[1]) - f(a[1] * b[0]))];
  const unitQ = v => { const k = f(1 / f(Math.sqrt(f(f(f(v[0] * v[0]) + f(v[1] * v[1])) + f(v[2] * v[2]))))); return v.map(x => f(x * k)); };
  function bulletRows(b, turned = false) {
    const d = b.dir;
    if (turned) { b.r60 = unitQ(cross3(b.r70, d)); b.r70 = unitQ(cross3(d, b.r60)); return; }
    const [x, y, z] = d.map(Math.abs);
    const h = (y <= x || z <= x) ? (y < z ? [0, 1, 0] : [0, 0, 1]) : [1, 0, 0];
    b.r70 = unitQ(cross3(d, h));
    b.r60 = cross3(b.r70, d);
  }
  // the bullet's matrix (FUN_0054a5e8 with no parent: +0x60 .. +0x9c), 16 floats, row r at [4r .. 4r + 3]
  function bulletMatrix(b) {
    return [...b.r60, 0, ...b.r70, 0, ...b.dir, 0, ...b.pos, 1];
  }
  // FUN_00569340 -> FUN_005694f8 -> FUN_005409a8(mgr, muzzle, aim, W, status, 0, 0) -> FUN_00554568
  // -> FUN_00552dd8(bullet, 0, ...): one bullet from the muzzle along (aim - muzzle).
  function spawnShot(a, aim0, muzzle, Wx = null) {
    const W = Wx || a.ai.W;                                                   // worker 0235: FUN_00569870 passes its own W
    const start = (muzzle || eye(a)).slice();                                 // +0xc0, +0xe0
    // FUN_005409a8 -> FUN_005405b0: the cone (s = 24.39 deg for e027; T: k_bullet1 / k_bullet2 / w168 call logs)
    if (!W.spread) warnOnce('enemy_ai: ai.json weapons have no spread (W+0x1c..0x24): rebuild data/enemies; enemy shots fly straight');
    const aim = spreadAim(W, W.range, start, aim0, ENEMY_STATUS);
    if (W.react == null) warnOnce('enemy_ai: ai.json weapons have no react (W+0xc, bullet +0x148): rebuild data/enemies; taken as 0');
    const v = sub3(aim, start), d = len3(v);
    const dir = d > 0 ? v.map(x => f(x / d)) : [0, 0, 0];                     // +0x80 (vrsqrt; d = 0 not handled by the game)
    // +0x15c range = W+0x18 x 10 + DAT_0046ed6c (15). GUESS: FUN_00321e20(W) (then +20) taken as false.
    const range = f(f(W.range * 10.0) + 15.0);
    // +0xd0 end: W+4 bit 0x400000 -> the aim point, else start + dir x range; +0x130 = |end - start|
    const end = (W.flags & 0x400000) ? aim.slice() : start.map((x, k) => f(x + f(dir[k] * range)));
    const b = {
      from: a, start, dir, end, endDist: f(len3(sub3(start, end))), range,
      speed: f(W.speed * f(0.16666667)),                                      // +0x12c (bullet flag 2 clear)
      age: 0, pos: start.slice(), prev: start.slice(), f120: bulletFlags(W),
      delay: 0 + 2,                                                           // +0x142 = (FUN_005409a8 arg 7 = 0) + 2
      damage: W.damage,                                                       // +0x134 = (short)W+0x40
      hit: W.hit ?? 0, f148: W.react ?? 0,                                    // +0x153 = W+0x4a, +0x148 = W+0xc (FUN_00552dd8)
      kind: (W.flags & 0x80000) && JITTER_ON ? 2 : 0,                        // FUN_00554738 (flag 2 clear; FUN_00326500)
      target: target(a.ai),
      shooter: a.id,                                                          // +0x128 owner id
      id: ++bulletIds,                                                        // the object id (the boss brain keeps them)
    };
    bulletRows(b);
    // worker 0270: FUN_00554568 -> FUN_00554850(b, 0): +0x194 = the section-24 record W+0x7c (FUN_00311600; < 0 is
    // FUN_005547c0's ELF records: not translated). Its +0x78 bit 2: +0x2c = (char)+0xb6, +0x120 |= 0x800 (FUN_005442d8's
    // fat test), +0x28 |= 0x200000. b.W = the shot's own W (FUN_00569870 passes one; FUN_00552dd8 reads it for +0x150).
    b.W = W;
    b.rec = W.bullet >= 0 ? data.weapons[W.bullet] ?? null : null;
    if (b.rec && (b.rec.f78 & 2)) {
      if (b.rec.f2c == null) warnOnce('enemy_ai: ai.json weapons have no f2c (+0xb6; old ai.json: rebuild data/enemies): fat bullet radius 0');
      b.f2c = b.rec.f2c ?? 0; b.f120 |= 0x800;
    }
    // worker 0235: FUN_00552dd8, W+4 bit 0x2000: +0x150 bits 20-23 = 1 (FUN_005549f0 -> the homing move FUN_00556218)
    // and +0x154 = W+0x3c x pi / 180 (the turn rate, rad / s); +0x158 = the distance flown
    if (W.flags & 0x2000) {
      if (W.turn == null) warnOnce('enemy_ai: weapons have no turn (W+0x3c; old ai.json): homing turn rate 0');
      b.hm = 1; b.home = f(f(W.turn ?? 0) * f(0.017453294)); b.d158 = 0;
    }
    bullets.push(b);
    if (opts.shotFx) opts.shotFx.start(b);                                    // worker 0270: FUN_00553f48 (model) + FUN_005534f0 (trail)
    // FUN_00554568 -> FUN_00554850 (bullet init with W = +0x194): FUN_0033d788 plays W+0x94 at the sound camera
    // (FUN_0033cbd8) and keeps the slot in bullet +0x18c (moved by FUN_00557c68, stopped by FUN_005529a8 /
    // FUN_00558210: the updates are not ported, audio.js SoundEmitters)
    if (W.se_bullet) b.snd = sound(W.se_bullet, null);                        // worker 0270: kept as +0x18c (stopped by FUN_005529a8)
    // the end of FUN_005694f8 (status +0xac = W): FUN_0033d6d8 plays W+0x8c at the muzzle with range W+0x74 when
    // FUN_00310c40() > 0x20 and W+0x74 > 0, else 400 (FUN_0033ce10 -> FUN_0033ced0)
    if (W.se_fire) {
      if (W.se_range > 0) warnOnce('enemy_ai: weapon W+0x74 range set: the stage version test FUN_00310c40 > 0x20 is not exported; 400 used');
      sound(W.se_fire, start, 400.0);
    } else if (W.se_fire == null) warnOnce('enemy_ai: ai.json weapons have no se_fire (W+0x8c): rebuild data/enemies; no shot sound');
    events.push(`shot ${a.id}`);
    return b;
  }
  // worker 0235: FUN_00569870(k, actor, W, aim, n, marker, -1), the marker shot the z128 boss fires (gun: markers 0x11 /
  // 0x12, missiles 0xf / 0x10; notes/boss-research.md). FUN_00325b40 (AI paused) -> none. n = 4: the start is
  // FUN_003461a0(model, out, marker); W+4 bit 0x400000: aim = start + unit(aim - start) x (k < 0: W+0x2c / 6, else k).
  // Then FUN_005409a8(mgr, start, aim, W, status, 0, 0) (spawnShot's path) and, actor +0x28 bit 0x20 clear or 0x20000 set,
  // FUN_00552ac0(b, FUN_005630c0(actor)) = the actor's target (spawnShot's +0x12a). The player branch (actor +0x28 bit 4:
  // FUN_00317a58 auto-aim, FUN_00543ad0 lock) is not for enemies. Not translated: n != 4 (FUN_00346578), no model
  // (FUN_0054a720), and the muzzle effects FUN_00335a68 / FUN_00335b60 (warned). FUN_0033d6d8 = spawnShot's shot sound.
  function shootMarker(a, W, aim0, n, marker, k = -1) {
    if (aiPaused()) return null;
    if (n !== 4) { warnOnce(`enemy_ai: FUN_00569870 with n ${n} (FUN_00346578) not translated: no shot`); return null; }
    const start = markerWorld(a, marker);
    if (!start) return null;
    let aim = aim0.slice();
    if (W.flags & 0x400000) {
      const u = unit3(sub3(aim, start)), r = k < 0 ? f(W.speed * f(0.16666667)) : f(k);
      aim = start.map((x, i) => f(x + f(u[i] * r)));
    }
    warnOnce('enemy_ai: FUN_00569870 muzzle effects (FUN_00335a68 / FUN_00335b60) not translated');
    return spawnShot(a, aim, start, W);
  }
  // FUN_003461a0(model, out, marker): the marker's point (its xyz in its bone's frame) in the world, as attackCentre
  // (FUN_0054a768's chain). L: the same bone-palette path is taken for both callers.
  function markerWorld(a, i) {
    const mk = data.markers && data.markers[recModel(a)], m = mk && mk[i];
    if (!m || m[3] < 0) { warnOnce(`enemy_ai: no marker ${i} for ${recModel(a)} (old ai.json: rebuild data/enemies)`); return null; }
    const bw = world.boneWorld ? world.boneWorld(a) : null;
    if (!bw) { warnOnce('enemy_ai: no pose for marker shots (' + noPose(a) + ')'); return null; }
    const B = bw(m[3]);
    return [0, 1, 2].map(k => f(f(f(f(m[0] * B[0][k]) + f(m[1] * B[1][k])) + f(m[2] * B[2][k])) + B[3][k]));
  }
  // worker 0235: FUN_00556218, the homing move (+0x150 mode 1). +0xe0 = +0x90; target point FUN_00557f38 (+0x12a set: the
  // object's vt+0x5c, else +0xd0 = b.end); d = unit(target - pos); axis = +0x80 x d (not normalised); angle FUN_00260fe8 =
  // FUN_00261038 (0 at cos >= 1, pi at cos <= -1, else acos) with the sign of (dir x d) . axis (never negative), clamped
  // to +0x154 / 60; above 0.001 the direction turns by FUN_00259f60(angle, axis) (FUN_0026135c) and is renormalised (the
  // +0x60 / +0x70 rows, rebuilt from it, are not kept on the page). Then +0x90 += dir x (+0x12c x step), +0x158 += the
  // same; past +0x15c (range) it ends (+0xf0 = +0x90, bit 0x800000); else without +0x120 bit 0x2000000 it ends when
  // speed <= 0, age > 1800 or +0x158 > 3000.
  function homingStep(b, step) {
    b.prev = b.pos.slice();
    const tp = b.target ? targetPoint(b.target) : b.end;
    const d = unit3(sub3(tp, b.pos)), u = b.dir;
    const ax = [f(f(u[1] * d[2]) - f(u[2] * d[1])), f(f(u[2] * d[0]) - f(u[0] * d[2])), f(f(u[0] * d[1]) - f(u[1] * d[0]))];
    const dot = f(f(f(d[0] * u[0]) + f(d[1] * u[1])) + f(d[2] * u[2]));
    const c = f(dot / f(Math.sqrt(f(f(f(f(d[0] * d[0]) + f(d[1] * d[1])) + f(d[2] * d[2])) * f(f(f(u[0] * u[0]) + f(u[1] * u[1])) + f(u[2] * u[2]))))));
    let ang = !(c < 1) ? 0 : !(-1 < c) ? f(Math.PI) : f(Math.acos(c));
    const lim = f(b.home * f(0.016666668));
    if (lim < Math.abs(ang)) ang = ang < 0 ? -lim : lim;
    if (0.001 < Math.abs(ang)) {
      // worker 0237: FUN_00259f60's order (asm 0x259fa0-0x25a048): the pair products first (x x, y y, z z, x y, z x, y z), then
      // x (1 - cos), then +- the sin terms / + cos, each rounded to f32
      const sn = f(Math.sin(ang)), cs = f(Math.cos(ang)), t = f(1.0 - cs), [x, y, z] = ax;
      const xx = f(t * f(x * x)), yy = f(t * f(y * y)), zz = f(t * f(z * z)), xy = f(t * f(x * y)), zx = f(t * f(z * x)), yz = f(t * f(y * z));
      const R = [[f(xx + cs), f(xy + f(z * sn)), f(zx - f(y * sn))],
                 [f(xy - f(z * sn)), f(yy + cs), f(yz + f(x * sn))],
                 [f(zx + f(y * sn)), f(yz - f(x * sn)), f(zz + cs)]];
      b.dir = unit3([0, 1, 2].map(k => f(f(f(u[0] * R[0][k]) + f(u[1] * R[1][k])) + f(u[2] * R[2][k]))));
      if (b.r70) bulletRows(b, true);                                         // worker 0270: +0x60 / +0x70 rebuilt
    }
    const k = f(b.speed * step);
    b.pos = b.pos.map((v, i) => f(v + f(b.dir[i] * k)));
    b.d158 = f(b.d158 + k);
    if (b.range < b.d158) { b.f120 |= 0x800000; b.end = b.pos.slice(); return 1; }
    if (!(b.f120 & 0x2000000) && !(0 < b.speed && b.age <= 1800.0 && b.d158 <= 3000.0)) { b.f120 |= 0x800000; b.end = b.pos.slice(); return 1; }
    return 0;
  }
  // FUN_00556870's room test for a bullet without +0x120 bit 0x2000 (the homing ones): after the object test, unless bit
  // 0x20 / 0x40000000, the stage's vt+0x17c on +0xe0 -> +0x90; a hit ends it there as roomProbe's (+0x120 bit 1, the
  // surface). L: the thick branch (bit 0x800) and the hit polygon's pass-through bits are not translated.
  function homingRoom(b) {
    if (b.f120 & 0x40000020) return false;
    if (!opts.roomRay) { warnOnce('enemy_ai: no roomRay (FUN_0026a320): bullets pass walls'); return false; }
    const h = opts.roomRay(b.prev, b.pos);
    if (!h) return false;
    b.pos = h.map(f); b.end = b.pos.slice();
    b.f120 |= 1; b.mat = ((h.surface | 0) >> 16) & 0xf; b.normal = h.normal ?? null;
    events.push('bullet wall');
    return true;
  }
  // FUN_005549f0: one frame of a bullet. Returns 1 when it ends this frame (hit or out of range).
  function bulletUpdate(b, step) {
    if (b.delay > 0) {                                                        // +0x142 countdown
      const was = b.delay;
      b.delay--;
      if (was === 1) {                                                        // FUN_00554970: script event 0x4e, then
        events.push('bullet start');
        if (b.f120 & 0x2000) roomProbe(b);                                    // FUN_00553808, then FUN_00553aa8 (no state here)
      }
      return 0;
    }
    b.age = f(b.age + step);                                                  // +0x124 += DAT_004eeb24 (the frame step)
    if (b.hm === 1) {                                                         // worker 0235: +0x150 mode 1 (FUN_00556218)
      const done = homingStep(b, step);
      if (b.from !== P && enemyBulletHit(b)) { endEffect(b, b.hitPoint); bulletEnd(b, 1); return 1; }
      if (homingRoom(b) || done) { wallSound(b); endEffect(b, b.end); bulletEnd(b, 0); return 1; }
      return 0;
    }
    // FUN_00556068 (motion type 0): prev = pos; pos = start + dir x (age x speed)
    b.prev = b.pos.slice();
    const t = f(b.age * b.speed);
    const p = b.start.map((x, k) => f(x + f(b.dir[k] * t)));
    const dist = f(len3(sub3(p, b.start)));                                   // +0x158
    let done = 0;
    if (b.endDist < dist) { b.pos = b.end.slice(); if (!(b.f120 & 1)) b.f120 |= 0x800000; done = 1; }   // FUN_00556068: not after a room hit
    else if (b.range < dist) { b.f120 |= 0x800000; done = 1; }                // +0x90 not moved in this branch
    else b.pos = p;
    if (!done && !(b.f120 & 0x2000000) && !(b.speed > 0 && b.age <= 1800.0 && dist <= 3000.0)) { b.f120 |= 0x800000; done = 1; }
    // FUN_00556870 -> FUN_005442d8: objects along prev -> pos (closest hit, vt+0x1b4). With bullet bit
    // 0x2000 (every bullet here) no hit returns 0: the room was probed once at the countdown end.
    if (b.from === P) {                                                       // Vincent's bullet: the soldiers
      const hit = playerBulletHit(b);
      if (hit) playerBulletStats(b);                                          // FUN_00554ea8's stat adds (results.js, worker 0232)
      if (!hit && done) wallSound(b);
      return hit || done;
    }
    if (enemyBulletHit(b)) {
      endEffect(b, b.hitPoint);                                               // +0xf0 = the hit point (T: w193_fxsrc f789)
      bulletEnd(b, 1);
      return 1;
    }
    if (done) { wallSound(b); endEffect(b, b.end); bulletEnd(b, 0); }         // +0xf0 = +0xd0 (FUN_00556068)
    return done;
  }
  // The bullet's end, FUN_005549f0 -> FUN_00554ea8: with +0x120 bit 1 (the room probe hit) the stage object's
  // vt+0x1b4 = FUN_0054fee0(stage, b, +0xd0 end, +0x100 normal) -> FUN_0054ff50(b, end, normal, 0) (FUN_00552ba0 = 0:
  // no W+4 0x300000; +0x120 bit 0x1000 clear). It draws the shared RNG (FUN_0040b5c0) in this order:
  //   1. r = FUN_0040b5c0, FUN_0033d528(mat, (int)(r x 2) != 0, end) -> FUN_0033d4e8: se.wall[se.mat_kind[mat] x 3 +
  //      variant] at the end point (FUN_0033cc48, range 400);
  //   2. FUN_00335f40(end, normal, b, 0), the impact effect (not on the page), when +0x120 bit 2 is clear or
  //      FUN_003354b8() != 0: with +0x120 bit 0x10000 clear and param_4 (0 from FUN_0054fee0) == 0 it calls
  //      FUN_002e2840(end, normal, mat): for mat != 6, when FUN_00249148 allocates a decal node, FUN_002e0160 (the
  //      bullet-hole decal, not on the page) draws twice: scale 0.2 + 0.2 r, then the spin r x 2pi;
  //   3. mat 6 (with +0x140 bits 7-10 not 6 / 4): FUN_00550098(.., 0) -> FUN_0026a980 -> FUN_00268f18 -> FUN_002e28d8
  //      draws more (not translated: warned, the page's draws then fall out of step with the game's).
  // T: w173_rng, every impact draws 3 (wall_rand, decal_rand x 2) and nothing else draws between them.
  // GUESS: no wall sound when the bullet ended on a character (T: w172_sound3 f789, #66 hits Vincent: none; the
  // flag that skips FUN_00554ea8's vt+0x1b4 then is not found).
  function wallSound(b) {
    if (!(b.f120 & 1)) return;
    const mat = b.mat & 0xf;                                                  // +0x138 & 0xf
    const r = rng();
    const variant = Math.trunc(f(r * 2.0)) !== 0 ? 1 : 0;
    const kind = seName('mat_kind', mat);                                     // FUN_0033d528: 0x4a1310[mat]
    const name = kind == null ? null : seName('wall', kind * 3 + variant);    // FUN_0033d4e8: 0x46e5f8[kind x 3 + variant]
    if (name) sound(name, b.end);
    // FUN_00335f40: the gate on +0x120 bit 2 (FUN_003354b8 = FUN_00242420() == 1 ? DAT_0046e530 : 0) is not
    // translated; no page bullet sets bit 2.
    if (b.f120 & 2) warnOnce('enemy_ai: bullet +0x120 bit 2 (FUN_00335f40 gate FUN_003354b8) not translated: decal draws taken');
    if (opts.effect) opts.effect.wall(mat, b.normal ?? null, b.end);        // FUN_00335f40 -> FUN_00336478 / FUN_003366b8 (effects.js)
    if (!(b.f120 & 0x10000) && mat !== 6) {                                   // FUN_00335f40 -> FUN_002e2840 (param_4 = 0)
      // GUESS: FUN_00249148 (FUN_003056b0 -> FUN_00251e70(0x10, 0, 0xe), the heap) always allocates (not decoded:
      // the heap's state; notes/fidelity-audit.md)
      rng(); rng();                                                           // FUN_002e0160: scale, spin (the decal itself is not on the page)
    }
    if (mat === 6) warnOnce('enemy_ai: wall material 6 (FUN_00550098 -> FUN_0026a980 effect draws) not translated');
  }
  // FUN_00553808 (bullet +0x120 bit 0x20 clear): one ray from the muzzle +0xc0 to +0xd0 + unit(+0xd0 - +0xc0)
  // x 0.1 against the stage object (FUN_0053bb58 -> vt+0x17c FUN_0054fc38, probe 0 = flags 0x18d ->
  // FUN_0026a320). A hit becomes the end: +0xd0 = +0xf0 = +0x110 = hit, +0x130 = |hit - +0xc0| (the move then
  // stops there, FUN_00556068). T: k_bullet2 #67 f875 stops at (-1302.142, -142.204, -1210.419) = 362.3 u.
  function roomProbe(b) {
    if (b.f120 & 0x20) return;
    if (!opts.roomRay) { warnOnce('enemy_ai: no roomRay (FUN_0026a320): bullets pass walls'); return; }
    const u = unit3(sub3(b.end, b.start));
    const h = opts.roomRay(b.start, b.end.map((x, k) => f(x + f(u[k] * f(0.1)))));
    if (!h) return;
    b.end = h.map(f);
    b.endDist = f(len3(sub3(b.start, b.end)));
    // FUN_00553660: +0x120 |= 1 (room hit), +0x138 low 4 bits = (FUN_0026f1e8() >> 16) & 0xf: the hit polygon's
    // surface word (DAT_004e8824; collision.js keeps it per triangle, roomRay's .surface). Material 6 (and the
    // pass-through bits 0x20 / 2 of FUN_0026f1e8's word) are not translated.
    b.f120 |= 1;
    b.mat = ((h.surface | 0) >> 16) & 0xf;
    b.normal = h.normal ?? null;                                              // +0x100 (FUN_00335f40's floor test)
    events.push('bullet wall');
  }
  // FUN_005442d8 for a soldier's bullet (thin: +0x120 bit 0x800 clear). Each active object along the segment
  // with +0x38 bit 0 passes the filter vt+0x1ac = FUN_0055d100 or is skipped; the soldiers fail it (their
  // faction and the shooter's are the same side, FUN_0031d1a8, and the bullet has no bit 0x200; T: filter 0
  // for #66 / #67 and 1 for Vincent on every k_bullet frame). Vincent: mgr+0x1294 = the bullet, then
  // vt+0x17c = FUN_0055bda8(P, 0, ...) (playerPartTest); a hit gets vt+0x1b4 = FUN_005720c8, whose result
  // ends the bullet. The trigger volumes nearer than the hit take event 0x12 first (shotVolumes).
  // L: the grid walk FUN_0036d400 only picks the candidates; Vincent is the only object that can pass.
  function enemyBulletHit(b) {
    if (b.f120 & 0x200) warnOnce('enemy_ai: friendly-fire bullet (+0x120 bit 0x200) vs soldiers not translated');
    const hit = playerFilter(b) ? ((b.f120 & 0x800) ? playerFatTest(b) : playerPartTest(b)) : null;
    // worker 0209: a gimmick nearer than Vincent ends the bullet there (props.js; FUN_005442d8's closest solid hit)
    let ph = opts.props ? opts.props.bulletTest(b) : null;
    let dh = doorBullet(b);                                                   // worker 0257: a shut door's box
    // worker 0270: FUN_005442d8 measures every candidate from one start (+0x120 bit 0x800: the padded A', fatSeg); the props' and
    // doors' tests here measure from b.prev, so re-measure theirs from A' (their own fat tests are still the thin ones: L)
    if (b.f120 & 0x800) { const A = fatSeg(b)[0], re = h => h && { ...h, dist: f(len3(sub3(A, h.point))) }; ph = re(ph); dh = re(dh); }
    if (dh && (!hit || dh.dist < hit.dist) && (!ph || dh.dist < ph.dist)) { shotVolumes(b, dh.dist); b.hitPoint = dh.point; runEvent(dh.o, 0x12, [b.shooter ?? 0, 0, b.shooter ?? -1, 0]); return 1; }
    if (ph && (!hit || ph.dist < hit.dist)) { shotVolumes(b, ph.dist); b.hitPoint = ph.point; return opts.props.bulletHit(ph, b); }
    shotVolumes(b, hit ? hit.dist : FLT_MAX);
    if (hit) b.hitPoint = hit.point;                                          // +0xd0 = +0xf0 = +0x110 = the hit
    return hit ? playerHandler(b, hit) : 0;
  }
  // FUN_0055d100(P, bullet): false with bullet bit 0x4000; P+0x28 bit 4 (set: 0x20901f) with FUN_00326500 and a
  // body: motion class FUN_003419c0 0x3c / 0x3d / 0x3e -> false; +0x28 bit 0x100000 (clear); dead (FUN_00316cf8;
  // +0x28 bit 0x20 clear) -> false; +0x188 bit 39 (clear: 0x00cccf20c00c0605) and FUN_00552ad0(bullet) (0: L,
  // the filter returned 1 on every traced frame); shooter id == his id -> false; mgr+0x2b0 >= 0: the shooter's
  // side is hostile to his (FUN_0031d1a8) -> true unless bullet bit 0x8000. MISSING as for the melee filter:
  // P.motionClass: play.js.
  function playerFilter(b) {
    if (b.f120 & 0x4000) return false;
    if (JITTER_ON && P.motionClass != null && P.motionClass >= 0x3c && P.motionClass <= 0x3e) return false;
    if (dead(P)) return false;
    if (b.shooter === (P.id ?? 0x16)) return false;
    return !(b.f120 & 0x8000);
  }
  // FUN_0055bda8(P, 0, hit, nrm, A = prev, B = pos): the capsule FUN_0055bc90 -> FUN_0054b2b0 (P+0x118 bit 24
  // clear): feet .. feet + up (0,-1,0) x P+0x30 (18), radius P+0x2c (5), at his start-of-frame position
  // (T: the k_bullet / w168 call logs' capsule = the record before the call, to 0.000 u); FUN_0025c0f8, else
  // FUN_0025c770 (cylinderHit). Then (model +0x180 set) with P+0x28 bit 4 and mgr+0x1294 set: vt+0x18c
  // FUN_00573720 true -> a hit without the part test; else FUN_005ad118(model, A, B) on his 'mkd' part boxes
  // (ai.json hitboxes.p000, 07703201) against his posed skeleton. -1 (or a C+0x77c masked part: 0 on the page,
  // L) -> FUN_0055df90 (no AI on Vincent: nothing) and no hit; else P+0x142 = part, P+0x19c = status +0xa8's
  // zone record (L: none for Vincent; 44 per hit on parts 6, 0 and 1). T: parts 6 (f789 twice), 0 (k_bullet1
  // f879), 1 (w168 f1011) from the traced pose. The hit distance is |A - capsule point| (FUN_005442d8).
  function playerPartTest(b) {
    const A = (pStart || P.pos).slice(), B = [A[0], f(A[1] - H_PLAYER), A[2]];
    const cyl = cylinderHit(R_PLAYER, b.prev, b.pos, A, B);
    if (!cyl) return null;
    const dist = len3(sub3(b.prev, cyl.point));
    if (deflects(b)) return { point: cyl.point, dist, deflect: true };
    const boxes = data.hitboxes && data.hitboxes.p000;
    if (!boxes) { warnOnce('enemy_ai: no part boxes for Vincent (ai.json hitboxes.p000: rebuild data/enemies); not hit'); return null; }
    const bw = playerBones();
    if (!bw) { warnOnce('enemy_ai: no pose for Vincent\'s part test (playerBoneWorld unset); not hit'); return null; }
    const part = partTest(boxes, bw, b.prev, b.pos);
    if (part < 0) { events.push('near miss player'); return null; }
    P.part = part;                                                            // P+0x142
    return { point: cyl.point, dist, part };
  }
  // worker 0270: FUN_005442d8 for a fat bullet (+0x120 bit 0x800: the rockets / missiles, record +0x78 bit 2). The segment
  // prev -> pos, longer than 0.1, grows by e = unit x +0x2c at both ends (A' = prev - e, B' = pos + e). Vincent (+0x28 bit
  // 0x200000 set: 0x20901f) with |A' - B'| > +0x2c: vt+0x184 = FUN_0055c480(+0x2c, ..) (+0x120 bit 0x80000000 with vt+0x8c:
  // half the radius; never set here), no part test (vt+0x17c is the thin bullets'). Hit distance |A' - point|.
  // |A' - B'| <= +0x2c takes vt+0x19c = FUN_0055c5f8 (a sphere at B') then vt+0x3c: not translated (warned; a rocket moves
  // 2.5 u a frame, so its segment is 14.5 u).
  // FUN_005442d8's segment for +0x120 bit 0x800: prev -> pos grown by unit x +0x2c at both ends when longer than 0.1
  function fatSeg(b) {
    let A = b.prev, B = b.pos;
    const v = sub3(B, A), n = len3(v);
    if (0.1 < n) { const e = v.map(x => f(f(x / n) * b.f2c)); A = sub3(A, e).map(f); B = B.map((x, k) => f(x + e[k])); }
    return [A, B];
  }
  function playerFatTest(b) {
    const [A, B] = fatSeg(b);
    if (!(b.f2c < len3(sub3(A, B)))) { warnOnce('enemy_ai: fat bullet with a segment <= +0x2c (FUN_005442d8 vt+0x19c FUN_0055c5f8) not translated: no hit'); return null; }
    const F = (pStart || P.pos).slice(), T = [F[0], f(F[1] - H_PLAYER), F[2]];
    const h = fatCapsuleHit(b.f2c, R_PLAYER, A, B, F, T);
    if (!h) return null;
    return { point: h.point.map(f), dist: len3(sub3(A, h.point)) };
  }
  // FUN_00573720 (player vt+0x18c): status +0x61 bit 0 clear, now - P+0x27c < 8 ticks, bullet bit 0x800 clear and
  // the bullet's origin within +-1.309 rad of his facing (FUN_0054a720 / FUN_0054ac18 / FUN_00260f00). The window
  // opens only with his own melee (P+0x27c), which the page does not have; the angle test is not translated.
  function deflects(b) {
    if (PST.f61 & 1) return false;
    if (!(S.mgr20 - P.t27c < DEFLECT_TICKS)) return false;                     // DAT_0046e938 +0x20 (S.mgr20, ticks)
    if (b.f120 & 0x800) return false;
    warnOnce('enemy_ai: deflect window open (P+0x27c): its angle test FUN_00573720 is not translated; no deflect');
    return false;
  }
  // FUN_005720c8 (player vt+0x1b4): vt+0x18c true -> the deflect (FUN_005694a0 effect; no damage). Else P+0x118
  // bit 0x20 (with +0x28 bit 0x20 clear) -> return 0: no hit, the bullet flies on; else (+0x28 bit 0x20 clear)
  // FUN_0055db50 = damagePlayer. Then the hit effect FUN_00567c08 and FUN_00336508 (not on the page). Returns 1.
  function playerHandler(b, hit) {
    if (hit.deflect) { events.push('deflect player'); return 1; }
    if (P.f118 & 0x20) return 0;
    if (opts.effect) {
      // FUN_003361b8's gate: +0x120 bit 2 set -> FUN_003354b8 (not translated; as wallSound)
      if (b.f120 & 2) warnOnce('enemy_ai: bullet +0x120 bit 2 (FUN_003361b8 gate FUN_003354b8) not translated: hit effect spawned');
      opts.effect.hit(0, ((b.W ?? b.from?.ai?.W)?.cls ?? 0) & 3, hit.point);   // worker 0270: the shot's own W (FUN_00552dd8)
    }
    // FUN_0055db50 -> FUN_003361b8(param_3 = the hit point, kind: P+0x19c = 0): bullet +0x150 = W+0x14 >> 2 & 3
    if (DAMAGE) damagePlayer(b);
    else events.push('hit player (damage off)');
    // FUN_00567c08(P, bullet +0xc0 = b.start) unless bullet +0x140 bit 1 (never set on the page's soldier bullets):
    // the HUD's hit-direction ring (hud_core.js HitRing). Also with ?enemydmg=0 (the hit itself is the game's)
    // P+0x90 during the bullet pass = the frame's start position (pStart; P.pos can move in the hit-reaction redo)
    if (opts.hudHit) opts.hudHit((pStart || P.pos).slice(), b.start.slice());
    hitFlashGate();
    return 1;
  }
  // FUN_005720c8, after FUN_0055db50 and FUN_00567c08 (worker 0200): DAT_0046ee28 (15) < now - P+0x280 ->
  // FUN_00336508, P+0x280 = now (DAT_0046e938+0x20 = S.mgr20). FUN_00336508 = FUN_003366b8(0x1000) alone (no
  // FUN_002e7660): the emitter keeps the spawn's position 0 (FED r0000 emitter 7: the screen flash, type 107, and the
  // frame-buffer zoom, type 110). T: w193_fxsrc f789 / f1011: 0x40c00, 0x1000, 0x41800 in that order.
  function hitFlashGate() {
    if (!(HIT_FX_GAP < S.mgr20 - P.t280)) return;
    if (opts.effect && opts.effect.spawn) opts.effect.spawn(0x1000, [0, 0, 0]);
    P.t280 = S.mgr20;
  }
  // FUN_00554ea8 (the bullet's end), bullet +0x120 bit 0x80 clear (never set here): the shooter (+0x128,
  // FUN_0053b978) with an AI counts it: nothing hit (+0x14c == -1) -> FUN_00568e20 -> FUN_00360920 (AI
  // +0x74 += 1, +0x54 = now), else FUN_00568df8 -> FUN_00360900 (+0x78 += 1, +0x5c = now). With
  // enemy damage off a bullet still hits (and counts as +0x78); only Vincent's HP is kept.
  // ---- worker 0232: the section stats (results.js; notes/results-research.md; T: w232 call log FUN_0031d668 sites)
  function statAdd(k, n) { if (opts.stats && opts.stats.add) opts.stats.add(k, n); }   // FUN_0031d668
  // Vincent's vt+0x31c FUN_005726e0(P, victim): FUN_0055e0d0, FUN_00572618(victim +0x9c +0x72) -> FUN_00320f70 (the gil /
  // EXP add: not on the page), FUN_0031d668(0, 1); then FUN_005694a0(P, 0) unless the victim's status flag 0x19
  // (FUN_00315738): stat 52 (the kill chain) only while the HUD's chain display is up (FUN_003b3538(HUD, 3)): not on the page
  function playerKill(a) {
    statAdd(0, 1);
    warnOnce('enemy_ai: the kill\'s gil / EXP (FUN_00572618 -> FUN_00320f70) and kill-chain count (FUN_005694a0: the HUD chain FUN_003b3538) not translated');
  }
  // FUN_00554ea8 for a bullet that hit an object (+0x14c != -1) with +0x120 bit 2 (Vincent's 0x100004): stat 2 when its
  // +0x140 hit nibble (bits 7..10) is 0 (the page's bullets end at their first hit: 0), stat 3 with +0x120 bit 0x40000
  // (hitEnemy: zone flag 8 -> 0x60000). T: w232 f195 / f301 (the game counts it 3 frames after the hit: L)
  function playerBulletStats(b) {
    if (!(b.f120 & 4)) return;
    if ((((b.f140 | 0) >> 7) & 0xf) === 0) statAdd(2, 1);
    if (b.f120 & 0x40000) statAdd(3, 1);
  }
  function bulletEnd(b, hit) {
    const ai = b.from && b.from.ai;
    if (!ai) return;
    if (hit) { ai.f78 = short(ai.f78 + 1); ai.f5c = S.now; }
    else { ai.f74 = short(ai.f74 + 1); ai.f54 = S.now; }
  }

  // FUN_00554ea8 (the bullet's end): the bullet-end effect of its record +0x194 (FUN_00554850: FUN_00311600(+0x144),
  // the section-24 record W+0x7c; Vincent's bullets (FUN_005408e8 -> FUN_00553630 -> FUN_00552dd8) keep +0x194 = 0
  // from FUN_00552850: none). With W+0x78 bit 0x2000 clear, +0x120 bit 0x800000 clear (timed out / past its range)
  // and (+0x120 bit 0x40000000 clear or bit 0x1000000 or no room hit): FUN_00310c40() = G+0x64 (48) >= 0x28, so a room
  // hit (bit 0) with W+0x80 != -1 on a floor (FUN_00260c38(+0x100)) -> FUN_00335960 (W+0x80) at +0x110, else
  // FUN_00335918 (W+0xb0 != -1) at +0xf0 (W+0x78 bit 8: FUN_0054a720's position, not translated); FUN_003366b8 spawns,
  // FUN_00335020 places it (flag 1). It runs after the hit's vt+0x1b4 (wall: FUN_0054fee0, Vincent: FUN_005720c8).
  // T: w193_fxsrc (w172_sound3 inputs): #66's hit on Vincent f789 spawns 0x40c00, 0x1000, then 0x41800 from 0x33593c
  // at the hit point; #67's wall hit f884 0x46400 then 0x41800; Vincent's pellets nothing. FUN_0033d760 (W+0x9c
  // sound) follows: empty for the soldiers' records.
  // worker 0270: the shot's own W (b.W: FUN_00569870's for the marker shots), the shooter's only for old bullets. Then
  // FUN_0033d760: the record's +0x9c sound at +0xf0 (FUN_0033cc48, range 400), with or without an effect (the rockets' asj_374).
  function endEffect(b, pos) {
    const W0 = b.W ?? (b.from && b.from.ai && b.from.ai.W);
    if (!W0) return;
    const fx = !!(opts.effect && opts.effect.spawn);
    if (W0.bullet == null || W0.fx_end == null) { warnOnce('enemy_ai: ai.json weapons have no bullet-end fields (W+0x7c / +0xb0: rebuild data/enemies); no bullet-end effect'); return; }
    if (W0.bullet < 0) { warnOnce('enemy_ai: bullet +0x144 < 0 (FUN_005547c0 ELF records) not translated; no bullet-end effect'); return; }
    const W = data.weapons[W0.bullet];                                        // FUN_00311600: 0 past the count
    if (!W) return;
    const f120 = b.f120 | 0, room = f120 & 1;
    // FUN_00554ea8's room branch first (+0x194 != 0): W+0x78 bit 0x10 -> +0x120 |= 0x10000 before the wall's vt+0x1b4
    // (no decal draws in wallSound); the 0x2000 test and the early return come after it
    if (room && (W.f78 & 0x10)) warnOnce('enemy_ai: bullet record W+0x78 bit 0x10 (+0x120 |= 0x10000: no decal) not translated');
    if (W.f78 & 0x2000) return;
    // FUN_00554ea8 returns early (before this) with neither 0x800000 nor 0x1000000 when, after a room hit, bit 0x8000000
    // or 0x20000000 is set, or without one, bit 0x20000000 (the page's bullets never set those bits): not translated
    if (!(f120 & 0x1800000) && (f120 & (room ? 0x28000000 : 0x20000000))) { warnOnce('enemy_ai: FUN_00554ea8 early return (+0x120 0x8000000 / 0x20000000) not translated'); return; }
    if (f120 & 0x800000) return;
    if ((f120 & 0x40000000) && !(f120 & 0x1000000) && room) return;
    if (room && W.fx_floor !== -1 && b.normal && floorHit(b.normal)) { if (pos && fx) opts.effect.spawn(W.fx_floor >>> 0, pos); }   // +0x110 = +0xf0 here
    else if (W.fx_end !== -1 && pos) {
      if (W.f78 & 8) warnOnce('enemy_ai: weapon W+0x78 bit 8 (bullet-end effect at FUN_0054a720) not translated');
      else if (fx) opts.effect.spawn(W.fx_end >>> 0, pos);
    }
    // worker 0270: FUN_0033d760(record, +0xf0) after the effect, in the same branch: +0x9c named -> FUN_0033cc48(+0x9c, +0xf0,
    // 1) (range 400). The rockets' asj_374 (weapons 17-20, 22, 25); empty for the soldiers' records.
    if (W.se_end && pos) sound(W.se_end, pos.slice(), 400.0);
  }

  // FUN_0055db50 -> FUN_0055d2c0 -> vt+0x1ec FUN_0055c7f8 on the player
  function damagePlayer(b) {
    // FUN_0055db50: FUN_0055f0e0(P, 1) / (P, 0) (status +0x64 bits 1 / 0): no damage, no reaction; only the tail FUN_003361b8 (the hit effect) runs
    if ((PST.f64 | (P.s64 ?? 0)) & 3) { events.push('hit player: status gate'); return; }
    let dmg = defence(PST, b.damage, b.kind);                                 // FUN_0055d2c0: FUN_00318120
    dmg = Math.min(dmg, 9999);                                                // (no zone record: +0x19c 0)
    if ((P.f118 & 0x20) || (P.f118 & 0x40)) dmg = 0;                          // FUN_0055db50
    if ((P.f118 | 0) < 0 && P.hp <= dmg) dmg = P.hp - 1;                      // FUN_0055c7f8
    // FUN_0055d390: the bullet's direction +0x80 with y = 0, normalised (as hitEnemy)
    const wasDead = dead(P);
    const dir = wasDead || !playerReact ? [0, 0, 0] : unit3([b.dir[0], 0, b.dir[2]]);   // only the reaction reads it
    // vt+0x2f4 event 0x12: no script. P+0x19c = 0 (no zone record for Vincent): FUN_0055d950 stagger.
    const fl = stagger(P, b.hit ?? 0);
    if (wasDead) {
      if (playerReact && !((P.f118 | 0) & 0x10000)) events.push(`react player ${playerReact({ flags: b.f148 | 0, dir, point: b.pos, aliveBefore: false, deadNow: true, f118: P.f118 ?? 0x20209 })}`);
      return;
    }
    if (!aiPaused()) {                                                        // FUN_0055c7f8: nothing while FUN_00325b40 (bit 6)
      const before = P.hp;
      P.hp = Math.max(0, P.hp - dmg);                                         // FUN_003168c8 (clamp at 0: L)
      statAdd(8, dmg);                                                        // FUN_0055c7f8: P+0x28 bit 2 -> FUN_0031d668(8, dmg)
      events.push(`hit player ${before}->${P.hp}`);
      log(`enemy_ai: Vincent HP ${before} -> ${P.hp} (shot by #${b.from.id})`);
      playerHitCues(dmg, dead(P));                                            // vt+0x324 FUN_00576ac8
      if (dead(P)) { playerDeathCues(); deathCount(); }                       // vt+0x334 FUN_00576b48, FUN_00321328
    }
    // FUN_00565480(P, bullet +0x148 | stagger, dir, point, alive before), unless P+0x118 bit 0x10000
    if (playerReact && !((P.f118 | 0) & 0x10000)) {
      const r = playerReact({ flags: (b.f148 | 0) | fl, dir, point: b.pos, aliveBefore: true, deadNow: dead(P), f118: P.f118 ?? 0x20209 });
      events.push(`react player ${r}`);
      if (r === 'death') deathMotionCue();                                    // the death class's phase 0 (this frame's C update)
    }
    // P+0x28 bit 2: FUN_0055ea50 (-1 < dmg) = pad vibration 'h_dmg_N' (no pad). FUN_003361b8 = the hit effect
    // (playerHandler -> opts.effect.hit, effects.js). FUN_00567f10 -> FUN_00567d00 returns
    // for Vincent (FUN_0053bb08's object): no damage number on him.
  }

  // ------------------------------------------------ Vincent's bullets (notes/enemy-research.md §13)
  // FUN_00577480 -> FUN_005408e8(mgr, 0, muzzle, aim, W, status, i, 0) for i < W+0x16 pellets ->
  // FUN_00552dd8(b, i): every pellet flies from the muzzle toward the aim, pellet i with i + 2 frames
  // of countdown (+0x142), so the pellets follow each other one frame apart on one line.
  // W = data/aim/weapon.json (export_web_aim.py: speed10 = W+0x2c, range10 = W+0x18, hit = W+0x4a).
  // GUESS: the pellet count is not cut by the rounds left (FUN_00319ee0; the page counts no ammo).
  // aim = P+0x2b0 = CAM+0xa0: with a lock, the target's lock point (lock_on.js via aim.js). FUN_00577480
  // adds a lead (aim and direction += C+0x410 x |aim - muzzle| / (W+0x2c x 10) x 60) only when P+8 (a
  // parent object, FUN_0054a720) is set: never on the page (trace k_lock13: P+8 = 0). The bullets get
  // +0x12a = the FUN_00329740 target's id; with no W+4 bit 0x2000 (Vincent's W+4 = 0x100) there is no
  // homing (FUN_00552dd8: +0x154 = W+0x3c only with that bit), and +0x12a only feeds FUN_00567ef0's
  // HUD popup at the bullet's end (FUN_00554ea8; not on the page).
  // chest = marker 1 (FUN_00342000; Vincent: bone 5, offset 0): FUN_00563148 first pulls the muzzle
  // back along the shot by 0.8 x |muzzle - chest| (unless actor +0x118 bit 0x1000). Then per pellet
  // FUN_005405b0 (W+4 without 0x100000 / 0x200000): s = W+0x1c / +0x20 / +0x24 by |aim - muzzle|
  // < T+0xd0 (120) / < T+0xd4 (380) / beyond, / FUN_0031cf08(1.0, status +0x10), FUN_00318518 (no
  // armour record: unchanged), x 0.5 for FUN_00317b68 (not for Vincent here); FUN_0025a058 tilts the
  // direction (two draws from the shared RNG); aim' = muzzle + dir x W+0x18 x 10 -> FUN_00552dd8.
  // GUESS: FUN_003251f8 (with FUN_00326500 and status +0x60 bit 1: the x {1, 0.33, 0.75, 0.1} factor)
  // taken as false: not read; the k_hits12 log shows s = 4.8 / 1.028 with no factor.
  const pendingShots = [];
  // the page's hook (play.js / aim.js onShot): the player steps before tick, so his shot waits for
  // tick's slot after the scheduler (see tick 1b)
  function queueShot(muzzle, aim, W, chest = null) { pendingShots.push([muzzle, aim, W, chest]); }
  function playerShot(muzzle, aim, W, chest = null) {
    const PS = opts.playerStatus || PLAYER_STATUS;
    let m0 = muzzle.slice();
    if (chest && !(PS.f118 & 0x1000)) {
      const u = unit3(sub3(aim, m0)), k = f(len3(sub3(m0, chest)) * f(-0.8));
      m0 = m0.map((x, i) => f(x + f(u[i] * k)));
    }
    if (!W.spread) warnOnce('enemy_ai: weapon.json has no spread (W+0x1c..0x24): rebuild data/aim; pellets fly straight');
    const range = f(f(W.range10 * 10.0) + 15.0);                              // +0x15c (FUN_00321e20 false, as above)
    for (let i = 0; i < W.pellets; i++) {
      const start = m0.slice();
      const aimP = spreadAim(W, W.range10, start, aim, PS);                   // FUN_005405b0
      const v = sub3(aimP, start), d = len3(v);
      const dir = d > 0 ? v.map(x => f(x / d)) : [0, 0, 0];
      const end = (W.flags & 0x400000) ? aimP.slice() : start.map((x, k) => f(x + f(dir[k] * range)));
      bullets.push({
        from: P, start, dir, end, endDist: f(len3(sub3(start, end))), range,
        speed: f(W.speed10 * f(0.16666667)),                                  // +0x12c = W+0x2c / 6
        // FUN_005405b0: +0x120 |= 0x100004 with the shooter's status (param_6) +0x60 bit 1 (Vincent's 0x8233; worker 0209:
        // bit 2 lets the bullet break a gimmick with type flag bit 6, FUN_00585000)
        age: 0, pos: start.slice(), prev: start.slice(), f120: (bulletFlags(W) | ((PS.f60 & 2) ? 0x100004 : 0)) >>> 0, f148: 0,
        cls: W.class & 3,                                                     // +0x150 bits 16-17 = W+0x14 >> 2 & 3 (FUN_00552dd8)
        delay: i + 2,                                                         // +0x142 = pellet index + 2
        damage: W.damage, hit: W.hit ?? 0,                                    // +0x134 (short)W+0x40, +0x153 W+0x4a
        kind: (W.flags & 0x80000) && JITTER_ON ? 2 : 0,                      // FUN_00554738
        shooter: P.id ?? 0x16,                                                // +0x128 owner id
      });
    }
    if (W.hit == null) warnOnce('enemy_ai: weapon.json has no hit value (W+0x4a): rebuild data/aim; stagger uses 0');
    // after the pellets FUN_00577480 plays FUN_0033d118(W, muzzle) (P+0x28 bit 0x20 clear: T: w170_sound2 v_fire_118;
    // the other branch FUN_0033d008 is not translated): W+4 bit 3 -> 'bsj_061', else table 0x46e5b8[class 2 -> 14,
    // 3 -> 13, else 12] at the pulled-back muzzle (T: w172_sound3 bsj_051)
    const gun = W.flags & 8 ? 'bsj_061' : seName('gun', W.class === 2 ? 14 : W.class === 3 ? 13 : 12);
    if (gun) sound(gun, m0);
    statAdd(1, 1);                                                            // FUN_00577480 (bullets made): FUN_0031d668(1, 1) (T: w232 f190)
    events.push(`player shot ${W.pellets}`);
  }

  // FUN_005442d8 for Vincent's bullet: the active soldiers along prev -> pos, each through its vt+0x17c
  // = FUN_0055bda8(actor, 0, ...): the cylinder (FUN_0054b2b0: feet .. feet + up x actor+0x30, radius
  // actor+0x2c; e027 has no actor +0x28 bit 0x20, so not the extended form), then the part test
  // FUN_005ad118 on the same segment. No part (or a masked part, C+0x77c) -> FUN_0055df90 -> FUN_00360870
  // (ai, 0, 0): counted, no hit. A part -> actor +0x142 = part, +0x19c = zone record, a hit.
  // The closest hit (distance from prev to the cylinder point) gets vt+0x1b4 -> FUN_0055db50 and the
  // bullet ends (FUN_00556870 returns its result). GUESS: soldiers are not see-through (actor +0x28
  // bit 8 / bullet +0x120 bit 0x40 would list every hit instead; bit 8 is not exported); W flags 0x100
  // has no 0x40. L: the object filter vt+0x1ac lets Vincent's bullets reach every soldier; the room
  // probe after the objects (probe 0) is not done (bullets pass walls, as the soldiers' do).
  // FUN_005442d8's see-through objects: the trigger volumes with +0x38 bit 0 and +0x28 bit 8 (o.shot)
  // that are active (+0x28 bit 0) take every bullet (filter vt+0x1ac = 0x552838: returns 1; vt+0x8c /
  // vt+0xbc = 0). Ray test vt+0x17c = FUN_00550da0(o, 0, ...): the segment in the box's frame, clipped
  // from the end toward the start (FUN_0025e400: the entry point), and when the start is inside, from
  // the start toward the end (the exit point); no point when both ends are inside or it misses. Every
  // listed volume nearer the start (|start - point|) than the closest solid hit (`nearest`, the
  // soldier / player hit, else DAT_0058b5b4 = FLT_MAX) gets vt+0x1b4 = FUN_005511e8 before the solid hit's,
  // in list order: with +0x40 bit 4, its script event 0x12 with r0 = the bullet's owner id (+0x128),
  // r1 = that object's id (FUN_0053b978; -1 when gone). The scripts' return value is not used here.
  // GUESS: list order = trigger index (the bullet grid M+0x1170 order is not read). L: a trigger with
  // +0x38 bit 0 is in that grid. The room probe is not done (bullets pass walls; see playerBulletHit),
  // so a volume behind a wall can fire on the page where the game's bullet stops at the wall.
  const FLT_MAX = 3.4028234663852886e38;                                     // DAT_0058b5b4
  function shotVolumes(b, nearest) {
    // MISSING: bullets with +0x120 bit 0x800 (the page's never set it) take another path in FUN_005442d8:
    // segment start from param_3 (l.57), then a radius test, |start - end| <= bullet +0x2c (x 0.5 with
    // bit 0x80000000 unless vt+0x8c) -> vt+0x19c / vt+0x3c, or vt+0x184 (the swept test with radius +0x2c)
    // instead of vt+0x17c. Not decoded (vt+0x184 / +0x19c of the trigger vtable not read): no volume
    // test for them rather than the +0x17c one.
    if (b.f120 & 0x800) { warnOnce('enemy_ai: bullet +0x120 bit 0x800 volume test (FUN_005442d8 vt+0x184) not translated'); return; }
    const list = [];
    for (const o of triggers) {
      if (!o.shot || !o.active) continue;
      const t = o.t;
      const s = xform(t.inv, b.prev), e = xform(t.inv, b.pos);                 // FUN_0026135c (no parent)
      let c = clipSeg(e, s, t.lo, t.hi);
      if (c.face === -1) c = clipSeg(s, e, t.lo, t.hi);
      if (c.face === -1) continue;
      const point = xform(t.m, c.p2);                                     // FUN_0026135c(record +0x00)
      list.push({ o, dist: f(len3(sub3(b.prev, point))) });
    }
    for (const h of list.slice(0, 0x20)) {
      if (!(h.dist < nearest)) continue;
      const owner = objects.get(b.shooter);
      events.push(`shot volume ${h.o.id}`);
      runEvent(h.o, 0x12, [b.shooter ?? 0, owner ? owner.id : -1]);            // FUN_005511e8 (+0x40 bit 4 = o.shot)
    }
  }
  function playerBulletHit(b) {
    let best = null;
    for (const a of actors) {                                                 // active only (+0x28 bit 0: setActive keeps the list)
      // L: a dead soldier is not tested: AI +0x70 (counted on every hit and near miss) stops at the
      // death for both soldiers while the later pellets pass him (k_enemy_engage11a / 12). The gate
      // (filter vt+0x1ac or object +0x38 bit 0) is not read.
      if (dead(a)) continue;
      if (a.f38 !== undefined && !(a.f38 & 1)) continue;                      // a townsperson's +0x38 bit 0 (worker 0228; L: the gate bit)
      const boxes = data.hitboxes && data.hitboxes[recModel(a)];
      // part boxes per model (export_web_triggers.py hitboxes: every z128 enemy type's 'mkd'); none in an old ai.json
      if (!boxes) { warnOnce(`enemy_ai: no part boxes for ${recModel(a)} (old ai.json: rebuild data/enemies); not hit`); continue; }
      const A = a.pos, B = [a.pos[0], f(a.pos[1] - a.size.h), a.pos[2]];     // up row (0,-1,0) x actor+0x30
      const cyl = cylinderHit(a.size.r, b.prev, b.pos, A, B);
      if (!cyl) continue;
      const bw = world.boneWorld ? world.boneWorld(a) : null;                 // the MP's posed skeleton
      if (!bw) { warnOnce('enemy_ai: no pose for the part test (' + noPose(a) + '); not hit'); continue; }
      const part = partTest(boxes, bw, b.prev, b.pos);
      if (part < 0) { aiHit(a, 0, 0); events.push(`near miss ${a.id}`); continue; }   // FUN_0055df90 (no part mask on the page: C+0x77c 0, trace pmask)
      const dist = len3(sub3(b.prev, cyl.point));
      if (!best || dist < best.dist) best = { a, part, point: cyl.point, dist };
    }
    // worker 0209: the gimmicks (props.js: filter FUN_00584f40, cylinder FUN_00584408); the closest solid hit wins
    const ph = opts.props ? opts.props.bulletTest(b) : null;
    const dh = doorBullet(b);                                                 // worker 0257: a shut door's box
    if (dh && (!best || dh.dist < best.dist) && (!ph || dh.dist < ph.dist)) { shotVolumes(b, dh.dist); runEvent(dh.o, 0x12, [b.shooter ?? 0, 0, b.shooter ?? -1, 0]); return 1; }
    if (ph && (!best || ph.dist < best.dist)) { shotVolumes(b, ph.dist); return opts.props.bulletHit(ph, b); }
    shotVolumes(b, best ? best.dist : FLT_MAX);
    if (!best) return 0;
    best.a.part = best.part;                                                  // +0x142
    best.a.f19c = zoneRec(best.a, best.part);                                 // +0x19c = zone record (null: status +0xa8 = 0)
    hitEnemy(best.a, b, best.point);
    return 1;
  }
  const recModel = a => data.records[a.rec] ? data.records[a.rec].model : 'e027';

  // The soldiers as the lock-on (lock_on.js lockFrame, FUN_00328968) sees them: the active actors.
  // point = vt+0x5c FUN_00563720: bone C+0x765's world position (C+0x765 = the zone header's byte
  // +0x14, FUN_00340760 at activation: ai.json lock_bones, 3 for z128's soldiers, trace k_lock13), else
  // FUN_005634e0(actor, 3) = actor +0x30 - 2 up the body; that point is also the line-of-sight end.
  // alive = HP != 0 (FUN_00316cf8), lockable = +0x38 bit 2 and alive (vt+0x204 FUN_0055ef38).
  // GUESS (traced values, setters not read): +0x38 = 0x387 alive (probes 0-2) and 0x183 once dead (bits
  // 2 and 0x200 cleared on the death frame; k_lock14 f836), so a corpse leaves probe 2 and can't be locked.
  const PROBE_BITS = 0x387, PROBE_BITS_DEAD = 0x183;

  // ---- actor push-out, FUN_00542ab8 (run by the manager frame FUN_0053b500 before the actors move).
  // Every actor on the manager list +0x1274 whose +0x38 has bit 9 (0x200): Vincent (+0x38 = 0x381, T
  // k_push16) and the live soldiers (0x387; a corpse has 0x183, k_lock14 f836). Each actor's push vector
  // +0x130 is cleared, then every pair whose horizontal distance (vsub/vmul .xz, vaddbc x += z) is at
  // most the sum of the radii pushes both: i from j's capsule (FUN_0025d508) and j from i's, each by
  // (overlap^2 / own radius) x DAT_0046e90c (0.25 in the ELF), along the capsule's normal.
  // GUESS: list order = Vincent, then the AI actors in activation order (the +0x1274 order is not read;
  // it only changes the order of the float sums). Not ported: the neighbour counters +0x158..+0x15b
  // (FUN_0056a8c8 / FUN_0056a908; no reader on the page) and FUN_0025d860 (+0x118 bit 0x8000000).
  const PUSH_K = 0.25;                                                        // DAT_0046e90c
  const H_PLAYER = 18.0;                                                      // P+0x30 (T: k_push16 p_cyl 5 / 18)
  // FUN_0025d508(r, out p2, out n3, p, a, b): the point on the cylinder a..b of radius r (flat end at a,
  // round end b - r..b) nearest p, and the unit normal there. Returns null where the game writes nothing.
  // unit(v) as the VU does it (vrsqrt, vmulq): length 0 -> rsqrt = +max float, 0 x max = 0 (no NaN)
  const vunit = v => { const l = f(len3(v)); return l > 0 ? v.map(x => f(x / l)) : [0, 0, 0]; };
  function capsule(r, p, a, b) {
    const ab = sub3(b, a), L = f(len3(ab)), u = ab.map(x => f(x / L));
    const t = f(dot3(sub3(p, a), u));                                        // FUN_002614f4
    const foot = a.map((x, k) => f(x + u[k] * t));
    const dl = f(len3(sub3(foot, p)));
    if (t < 0) {
      if (r <= dl) {
        const w = sub3(p, a), wu = f(dot3(w, u)), rej = w.map((x, k) => f(x - u[k] * wu));   // FUN_00260e28
        const ru = vunit(rej), p2 = a.map((x, k) => f(x + ru[k] * r));
        return { p: p2, n: vunit(sub3(p, p2)) };
      }
      return { p: p.map((x, k) => f(x - u[k] * t)), n: u.map(x => f(-x)) };
    }
    if (f(L - r) <= t) {
      const c = a.map((x, k) => f(x + u[k] * f(L - r))), n = vunit(sub3(p, c));
      return { p: c.map((x, k) => f(x + n[k] * r)), n };
    }
    if (0 <= t && t <= L) {
      const n = vunit(sub3(p, foot));
      return { p: foot.map((x, k) => f(x + n[k] * r)), n };
    }
    return null;
  }
  // FUN_0054b3a0 with up row (0,-1,0): feet, top = feet + up x +0x30, low = feet + up x +0x2c
  // MISSING: with +0x28 bit 0x10000 all three move up by vt+0x64() (the class's value is not read). T: the
  // bit is clear on Vincent (0x20901f) and the soldiers (0x208403 / 0x20c403 / 0x20c40b) in k_push16.
  const cyl = (pos, r, h, f28 = 0) => {
    if (f28 & 0x10000) warnOnce('enemy_ai: FUN_0054b3a0 +0x28 bit 0x10000 offset (vt+0x64) not translated');
    return { feet: pos, top: [pos[0], f(pos[1] - h), pos[2]], low: [pos[0], f(pos[1] - r), pos[2]], r };
  };
  // one half of the pair body: push i out of j's capsule (FUN_00542ab8 0x542c78.. / 0x543038..)
  function pushHalf(i, j) {
    if (j.f118 & 0x8000000) { warnOnce('enemy_ai: FUN_0025d860 push-out (actor +0x118 bit 0x8000000) not translated'); return; }
    const s = capsule(j.c.r, i.c.low, j.c.feet, j.c.top);
    if (!s) return;
    const ov = f(i.c.r - f(len3(sub3(s.p, i.c.low))));
    if (!(0.0 <= ov)) return;
    if (i.attacking && !(i.flags28 & 4)) return;                            // FUN_0055bb40, +0x28 bit 2
    const m = f(f(ov * ov) / i.c.r), k = (j.f118 & 0x4000000) ? m : f(m * PUSH_K);
    if (!(i.f118 & 0x10000000)) i.push = i.push.map((x, q) => f(x + f(s.n[q] * k)));
    // both bodies, the other's C+0x1c0 bit 0x100000 (move ended): this one's too when its C+0x90 points
    // within 30 deg of the other (FUN_00260fe8). Nothing on the page sets that bit yet.
    if (i.C && j.C && (j.C.f1c0 & 0x100000)) warnOnce('enemy_ai: FUN_00542ab8 blocked-bit branch (C+0x90 angle) not translated');
  }
  // Vincent's push vector for this frame (actor +0x130 -> C+0x430, FUN_00343160); the soldiers' pushes go
  // to a.push (T k_push16: #66 is pushed but does not move, so nothing applies them).
  // worker 0223: the woken townspeople / WRO men (n0xx records with a stance): class 0x58e1f8 actors in the game with a body
  // but no page actor. T (w223_npc95 RAM f826 / npcview f100): +0x38 = 0x391 (bit 9: in the push-out; bit 2 clear: never
  // lockable; bit 0: bullets test them), +0x28 0x20c40b. Position = their +0x90 (placement or cmd 0x10e). Worker 0228: the
  // townspeople are actors now (NPC_TYPES; +0x38 = a.f38), so this list holds the WRO men only; bullets on them are MISSING
  // (no actor: their rifles are not exported; notes/npc-research.md §8).
  const NPC_PROBE_BITS = 0x391;
  const npcBodies = () => [...objects.values()].filter(o => o.kind === 'record' && (o.flags28 & 1) && !dead(o) &&
    data.records[o.rec] && data.records[o.rec].stance != null && /^n0\d\d$/.test(data.records[o.rec].model));
  const npcPos = o => (o.p90set ? o.p90.slice(0, 3) : data.records[o.rec].pos.slice());
  function pushOut(ppos) {
    // Vincent's +0x28 = 0x20901f (T: k_push16 p_a28, every frame)
    const list = [{ c: cyl(ppos, R_PLAYER, H_PLAYER, 0x20901f), f118: (P && P.f118) | 0, flags28: 0x20901f, attacking: false, C: null, push: [0, 0, 0] }];
    for (const a of actors) {
      a.push = [0, 0, 0];
      // GUESS: +0x38 bit 9 stand-in = on the active list (+0x28 bit 0) and alive. The page keeps no +0x38;
      // traced 0x387 alive / 0x183 dead (PROBE_BITS above), so bit 9 goes at the death; its setter is not read.
      if (!(a.flags28 & 1) || dead(a)) continue;
      if (a.f38 !== undefined && !(a.f38 & 0x200)) continue;                  // a townsperson's +0x38 bit 9 (cmd 0x16a; worker 0228)
      list.push({ a, c: cyl(a.pos, a.size.r, a.size.h, a.flags28), f118: a.f118 | 0, flags28: a.flags28, attacking: attacking(a), C: a.C, push: [0, 0, 0] });
    }
    // the NPC bodies (+0x38 bit 9 set, T). GUESS: list order after the AI actors (the +0x1274 order is not read; see above)
    for (const o of npcBodies()) {
      const sz = sizeOf(data.records[o.rec]);
      list.push({ c: cyl(npcPos(o), sz.r, sz.h, 0), f118: o.f118 | 0, flags28: o.flags28, attacking: false, C: null, push: [0, 0, 0] });
    }
    for (let x = 0; x < list.length; x++) {
      for (let y = x + 1; y < list.length; y++) {
        const i = list[x], j = list[y];
        // 0x542bc8: the pair is skipped when both have +0x28 bit 0x20 and both +0x118 bit 0x20000 (T: Vincent
        // 0x20901f / 0x20209 and #66 0x20c403 / 0x203 in k_push16: never on this page)
        if ((i.flags28 & 0x20) && (j.flags28 & 0x20) && (i.f118 & 0x20000) && (j.f118 & 0x20000)) continue;
        const dx = f(j.c.feet[0] - i.c.feet[0]), dz = f(j.c.feet[2] - i.c.feet[2]);
        if (!(f(Math.sqrt(f(f(dx * dx) + f(dz * dz)))) <= f(i.c.r + j.c.r))) continue;
        pushHalf(i, j);
        pushHalf(j, i);
      }
    }
    for (const e of list) if (e.a) e.a.push = e.push;
    return list[0].push;
  }
  function lockTargets() {
    const out = [];
    for (const a of actors) {
      if (!(a.flags28 & 1)) continue;                                         // FUN_005449f0: +0x28 bit 0
      const rec = data.records[a.rec];
      const lb = data.lock_bones && rec && rec.zones >= 0 ? data.lock_bones[rec.zones] : -1;
      const top = [a.pos[0], f(a.pos[1] - f(a.size.h - 2.0)), a.pos[2]];
      let point = top;
      if (lb != null && lb >= 0) {
        const bw = world.boneWorld ? world.boneWorld(a) : null;
        if (bw) point = bw(lb)[3].slice(0, 3);
        else warnOnce('enemy_ai: no pose for the lock point (' + noPose(a) + '); lock-on aims at the body top');
      }
      const alive = !dead(a), bits = a.f38 !== undefined ? a.f38 : alive ? PROBE_BITS : PROBE_BITS_DEAD;   // townspeople: +0x38 (worker 0228)
      out.push({ id: a.id, alive, lockable: alive && !!(bits & 4), probeBits: bits, point,
                 feet: a.pos.slice(), radius: a.size.r, height: a.size.h, losPoint: top });
    }
    // the NPC bodies: on the +0x28 bit 0 list, never lockable (+0x38 0x391, bit 2 clear: FUN_0055ef38); point as above
    for (const o of npcBodies()) {
      const rec = data.records[o.rec], sz = sizeOf(rec), pos = npcPos(o);
      const lb = data.lock_bones && rec.zones >= 0 ? data.lock_bones[rec.zones] : -1;
      const top = [pos[0], f(pos[1] - f(sz.h - 2.0)), pos[2]];
      let point = top;
      if (lb != null && lb >= 0 && world.boneWorld) { const bw = world.boneWorld(o); if (bw) point = bw(lb)[3].slice(0, 3); }
      out.push({ id: o.id, alive: true, lockable: false, probeBits: NPC_PROBE_BITS, point,
                 feet: pos, radius: sz.r, height: sz.h, losPoint: top });
    }
    return out;
  }
  // FUN_0055bda8: actor +0x19c = *(status +0xa8 + 0x30) + part x 16, or 0 without a zone set
  function zoneRec(a, part) {
    const rec = data.records[a.rec];
    if (!data.zones || !rec || rec.zones == null) { warnOnce('enemy_ai: ai.json has no hit zones (old export: rebuild data/enemies); damage unscaled'); return null; }
    const zs = rec.zones >= 0 ? data.zones[rec.zones] : null;
    return zs ? zs[part] ?? null : null;
  }

  // FUN_00360870(ai, shooter, dmg): AI +0x70 hits + 1, +0x4c = now; with a shooter FUN_003608d8
  // (AI +0x90 = the shooter; T: 0x160016 after Vincent's hit, k_enemy_engage11a)
  function aiHit(a, shooter, dmg) {
    const ai = a.ai;
    if (!ai) return;
    ai.hits = short(ai.hits + 1); ai.f4c = S.now;
    if (shooter) ai.f90 = shooter;
  }

  // FUN_0055d2c0: FUN_00318120 (defence) of the bullet's damage, then x zone byte x 0.05 unless bullet
  // +0x120 bit 0x800; cap 9999
  function enemyDamage(a, b) {
    let d = defence({ ...ENEMY_STATUS, lvl: a.lvl }, b.damage, b.kind);
    if (a.f19c && !(b.f120 & 0x800)) d = Math.trunc(f(f(f(d + 0.5) * a.f19c.scale) * f(0.05)));
    return Math.min(d, 9999);
  }

  // FUN_0055d950(actor, hit value): the stagger flags 0x42 / 0x44 / 0x48. Thresholds 1 / 30 / 60
  // (FUN_00310c40 = G+0x64 < 27 in this save; else status +0x9c -> +0x94..+0x98).
  // The window is FUN_0054cbe8 = DAT_0046e938 +0x20 - actor +0x148 < 60 (the counter the flinch
  // throttle reads; ticks: S.mgr20).
  function stagger(a, hv) {
    if (S.mgr20 - a.s148 < 60) { a.s150 += hv; a.s152 += hv; }
    else { a.s150 = hv; a.s152 = hv; a.sphase = 0; }
    a.s148 = S.mgr20;
    let fl = 0;
    if (a.s152 >= 1) { fl = 0x42; a.s152 = 0; if (a.sphase === 0) a.sphase = 1; }
    if (a.sphase === 1 && a.s150 >= 30) { fl = 0x44; a.sphase = 2; }
    else if (a.sphase === 2 && a.s150 >= 60) { fl = 0x48; a.s150 = 0; a.s152 = 0; a.sphase = 0; }
    return fl;
  }

  // worker 0259: FUN_0055d390 (from FUN_0055db50 while the victim lives): C+0x590 low 4 bits = the hit area. Clear C+0x564 bit 0x10000: the zone record's word bits 8-11
  // (ai.json zones[].area) + 1; no zone: the point in the actor's frame (FUN_0054aaf8, as playerHitSide), y > height x 0.7 -> 2, > 0.3 -> 3 (x > 0.5) / 4 (x < -0.5) / 1, else
  // 5 / 6 (x < 0). Bit 0x10000 set: by side and the old area. The rest of the function (the push direction, C+0x5a0) is flinch()'s own stand-in.
  function hitArea(a, point) {
    const C = a.C;
    if (!C || dead(a)) return;
    const dx = f(point[0] - a.pos[0]), dy = f(point[1] - a.pos[1]), dz = f(point[2] - a.pos[2]);
    const x = f(f(-a.face[2] * dx) + f(a.face[0] * dz)), y = f(-dy), old = (C.f590 ?? 0) & 0xf;
    let v;
    if (C.f564 & 0x10000) {
      if (x < 0) v = old === 5 ? 6 : old === 1 ? 5 : 1;
      else v = old === 2 ? 3 : old === 1 ? 4 : old === 4 ? 2 : 1;
    } else if (a.f19c && a.f19c.area != null) v = a.f19c.area + 1;
    else {
      if (a.f19c) warnOnce('enemy_ai: ai.json zones have no area (old export: rebuild data/enemies)');
      const h = a.size ? a.size.h : 0;
      if (f(h * f(0.7)) < y) v = 2;
      else if (f(h * f(0.3)) < y) v = 0.5 < x ? 3 : x < -0.5 ? 4 : 1;
      else v = x < 0 ? 6 : 5;
    }
    C.f590 = v & 0xf;
  }
  // FUN_0055db50(victim, bullet, hit point): Vincent's bullet on a soldier
  function hitEnemy(a, b, hitpos) {
    const shooter = b.shooter;
    const gate = a.s64 & 3;                                                   // FUN_0055f0e0(a, 1) / (a, 0): no damage
    let dmg = 0;
    if (!gate) {
      const wasDead = dead(a);
      dmg = enemyDamage(a, b);
      hitArea(a, hitpos);
      if (a.f118 & 0x60) dmg = 0;
      let dir = [0, 0, 0];
      if (!dead(a)) dir = unit3([b.dir[0], 0, b.dir[2]]);                     // FUN_0055d390: the bullet's +0x80, y = 0
      // vt+0x2f4 event 0x12 (r0 = owner id, r2 = owner +0x20); scripts 108 / 109 have none
      runEvent(a, 0x12, [shooter, 0, shooter, 0]);
      const zf = a.f19c ? a.f19c.flags : 0;
      let fl = 0;
      if (!a.f19c || !(zf & 4)) fl = stagger(a, b.hit);
      if (zf & 8) b.f120 |= 0x60000;
      if (wasDead) {
        if (!(a.f118 & 0x10000)) react(a, b.f148, dir, hitpos, 0);
      } else {
        enemyHP(a, dmg);                                                      // vt+0x1ec FUN_0055c7f8
        // the shooter's vt+0x314 (FUN_00572670: damage callback) not translated; vt+0x31c when the victim is dead now
        // (FUN_00316cf8): Vincent's FUN_005726e0 (worker 0232)
        if (b.from === P && dead(a)) playerKill(a);
        let flags = b.f148 | fl;
        if (zf & 2) flags = 0;
        if (!(a.f118 & 0x10000)) react(a, flags, dir, hitpos, 1);
      }
    }
    aiHit(a, shooter, dmg);                                                   // FUN_00360870
    // FUN_003361b8(hit point, bullet, (*(a+0x19c) << 16) >> 28): the hit effect by the zone record's nibble (0: the
    // hit table by the bullet's +0x150 class, Vincent's W+0x14 >> 2 & 3; effects.js hitImpactId). T: w193_fxhits
    if (opts.effect) {
      if (a.f19c && a.f19c.fx == null) warnOnce('enemy_ai: ai.json zones have no fx nibble (old export: rebuild data/enemies); kind 0 used');
      if (b.f120 & 2) warnOnce('enemy_ai: bullet +0x120 bit 2 (FUN_003361b8 gate FUN_003354b8) not translated: hit effect spawned');
      opts.effect.hit(a.f19c ? a.f19c.fx ?? 0 : 0, b.cls ?? 0, hitpos);
    }
    // FUN_00567f10 (actor +0x28 bit 0x20 clear): not on the page
    events.push(`hit ${a.id} part ${a.part} dmg ${dmg} hp ${a.hp}`);
  }

  // ---- worker 0209: an explosion (object type 7, props.js; notes/barrel-research.md) on a character.
  // ex = { dmg: +0xdc, owner: +0xe0 (-1 for a barrel's), kind: FUN_0057f0e8 (1), flags: +0x1ec (8), id }.
  // FUN_0055e0d8 (vt+0x1c4, Vincent's and the soldiers'): dead -> false unless +0x28 bit 0x20; +0x188 bit 39 (clear for
  // both in the save: 0x00cccf20c00c0605 / 0x8765430087652d01) -> false; +0x28 bit 2 (Vincent) with a body: motion class
  // 0x3c / 0x3e / 0x3d -> false (as in playerFilter); +0x28 bit 0x100000 -> false;
  // no owner (+0xe0 == -1) -> true. An owner's side test (FUN_0031d1a8, +0xc4 bits 5 / 6) is not translated (warned).
  function blastFilter(t, ex) {
    if (dead(t) && !(((t === P ? P.f28 ?? 0x20901f : t.flags28) | 0) & 0x20)) return false;
    if (t === P && JITTER_ON && P.motionClass != null && P.motionClass >= 0x3c && P.motionClass <= 0x3e) return false;
    if (((t === P ? P.f28 ?? 0x20901f : t.flags28) | 0) & 0x100000) return false;
    if (ex.owner !== -1) warnOnce('enemy_ai: an explosion with an owner (FUN_0055e0d8 side test FUN_0031d1a8) not translated: hit');
    return true;
  }
  // FUN_0055e498 (vt+0x1cc) on a soldier: owner = FUN_0053b978(+0xe0), else Vincent when the actor's +0x188 byte
  // (FUN_00563288) is 1 or 2 (z128's soldiers: 1). Gate FUN_0055f0e0(a, 1) / (a, 0) -> only the AI count FUN_00360948.
  // FUN_0055e240: the explosion's +0x16b nibble 0 -> FUN_00318120(status, +0xdc, FUN_0057f0e8) capped at 9999, 0 with
  // actor +0x118 bits 0x20 / 0x40. Alive with dmg >= 0: vt+0x1ec (enemyHP), the owner's vt+0x314 / +0x31c (Vincent's
  // damage / kill callbacks: not translated, as in hitEnemy), FUN_00360870 (aiHit). Then FUN_00565480(a, +0x1ec, dir,
  // centre, alive before) unless +0x118 bit 0x10000; FUN_00360948; script event 0x15 (r0 = +0xe0, r2 = the owner's id
  // or -1); FUN_00336338 (needs +0x16b != 0: nothing here); FUN_00568080 (the damage number: not on the page).
  function blastActor(a, ex, centre, dir) {
    const owner = ex.owner !== -1 ? objects.get(ex.owner) : ((a.f188 ?? 1) === 1 || (a.f188 ?? 1) === 2) ? P : null;
    const ownerId = owner === P ? (P.id ?? 0x16) : owner ? owner.id : 0;
    let dmg = 0;
    if (!(a.s64 & 3)) {
      const wasDead = dead(a);
      dmg = Math.min(defence({ ...ENEMY_STATUS, lvl: a.lvl }, ex.dmg, ex.kind), 9999);
      if (a.f118 & 0x60) dmg = 0;
      if (!wasDead && dmg >= 0) { enemyHP(a, dmg); if (owner === P && dead(a)) playerKill(a); aiHit(a, ownerId, dmg); }   // FUN_0055e498: owner vt+0x31c (worker 0232)
      if (!(a.f118 & 0x10000)) react(a, ex.flags, dir, centre, wasDead ? 0 : 1);
      if (a.f118 & 0x2000000) warnOnce('enemy_ai: blast on an actor with +0x118 bit 0x2000000 (FUN_00562898) not translated');
    }
    if (a.ai) { a.ai.f72 = short((a.ai.f72 | 0) + 1); a.ai.f50 = S.now; if (ownerId) a.ai.f90 = ownerId; }   // FUN_00360948 (+0x72, +0x50; FUN_003608d8)
    runEvent(a, 0x15, [ex.owner, 0, owner ? ownerId : -1, 0]);
    events.push(`blast ${a.id} dmg ${dmg} hp ${a.hp}`);
    return 0;
  }
  // FUN_00572418 (Vincent's vt+0x1cc): P+0x118 bit 0x20 -> 0; +0xdc >= 0 and FUN_0055f0e0 -> 0; P+0x28 bit 0x20 clear ->
  // FUN_0055e498 on him (owner: +0x188 byte 5, none): HP through vt+0x1ec (as damagePlayer: +0x118 bit 31, the hit cues
  // vt+0x324, the death cues vt+0x334), the reaction FUN_00565480(P, 8, dir, centre); it returns 0, so FUN_00336508 (the
  // screen flash) does not run. No HUD ring (FUN_00567c08 is the bullet path's). The pad vibration (+0x28 bit 2) is not
  // on the page.
  function blastPlayer(ex, centre, dir) {
    if (P.f118 & 0x20) return 0;
    if (P.s64 & 3) return 0;
    const wasDead = dead(P);
    let dmg = Math.min(defence(PST, ex.dmg, ex.kind), 9999);
    if ((P.f118 & 0x20) || (P.f118 & 0x40)) dmg = 0;
    if (!wasDead && dmg >= 0) {
      if (DAMAGE && aiPaused()) events.push('blast player (AI paused: FUN_0055c7f8 returns)');
      else if (DAMAGE) {
        if ((P.f118 | 0) < 0 && P.hp <= dmg) dmg = P.hp - 1;                  // FUN_0055c7f8
        const before = P.hp;
        P.hp = Math.max(0, P.hp - dmg);
        statAdd(8, dmg);                                                      // FUN_0055c7f8 -> FUN_0031d668(8, dmg)
        events.push(`blast player ${before}->${P.hp}`);
        log(`enemy_ai: Vincent HP ${before} -> ${P.hp} (explosion)`);
        playerHitCues(dmg, dead(P));
        if (dead(P)) { playerDeathCues(); deathCount(); }
      } else events.push('blast player (damage off)');
    }
    if (playerReact && !((P.f118 | 0) & 0x10000)) {
      const r = playerReact({ flags: ex.flags | 0, dir, point: centre, aliveBefore: !wasDead, deadNow: dead(P), f118: P.f118 ?? 0x20209 });
      events.push(`react player ${r}`);
      if (r === 'death' && !wasDead) deathMotionCue();
    }
    runEvent(P, 0x15, [ex.owner, 0, -1, 0]);
    return 0;
  }

  // FUN_0055c7f8: HP -= dmg (cap 9999; +0x118 bit 31 leaves 1); alive -> vt+0x324 FUN_0055c978(dmg, 0):
  // script event 8 (r0 = dmg; cues 0x44 / 0x4c are sound); killed -> FUN_0055c978(dmg, 1) (vt+0x344
  // is empty for e027) and vt+0x334 FUN_0055cac8
  function enemyHP(a, dmg) {
    if (aiPaused()) return;                                                   // FUN_0055c7f8: FUN_00325b40 set -> nothing
    const was = dead(a);
    if (dmg > 9999) dmg = 9999;
    if ((a.f118 | 0) < 0 && a.hp <= dmg) dmg = a.hp - 1;
    const before = a.hp;
    a.hp = Math.max(0, a.hp - dmg);                                           // FUN_003168c8 (clamp at 0: L)
    log(`enemy_ai: #${a.id} HP ${before} -> ${a.hp}`);
    if (was) return;
    if (!dead(a)) runEvent(a, 8, [dmg, 0, 0, 0]);
    else enemyDeath(a);
  }

  // FUN_0055cac8: cue (sound), script event 0x17, FUN_005435a8 (manager: not decoded), the AI's
  // modes 0 (FUN_0035f728 = FUN_0035f268 / FUN_0035f540 / FUN_0035f9a0 with 0: the fire timer stops)
  // and the item drop (worker 0224: items.js `drop`).
  // The drop's effect (worker 0200): FUN_0055cac8 places the new item (FUN_00541688, FUN_0054b1d8) and calls
  // FUN_00580410(item) = FUN_003365e0(0x4800, FUN_0054a720(item): its position): FED r0000 emitter 18, a type 21
  // burst. T: w193_fxhits f871 (#67 killed by Vincent's second shot; w200_4800 call log: the jal at 0x55ce58).
  // items.js spawns it with the item.
  function enemyDeath(a) {
    if (!(a.flags28 & 0x20) && a.rec != null) deadBits.add(a.rec);             // FUN_0055cac8: FUN_0031e060(+0x100, 1), skipped by +0x28 bit 5 (LAB_0055cf1c)
    runEvent(a, 0x17);
    if (a.ai) { setMode(a.ai, 0); setActionLayer(a.ai, 0); setCombatLayer(a.ai, 0); }
    events.push(`dead ${a.id}`);
    // worker 0224: the drop (FUN_00316d70 -> FUN_00541688, its effect 0x4800 FUN_00580410; items.js `drop`)
    if (opts.items) opts.items.drop(a);
    else if (opts.effect) warnOnce('enemy_ai: no items.js: the soldier death item drop (FUN_00316d70 / FUN_00541688) left out');
    // worker 0230: FUN_0055cac8's tail (0x55ce64): status +0x60 bit 1 clear, +0x28 bit 0x20 clear and status +0xc bit 1 clear
    // (FUN_00315738(s, 1)) -> FUN_0053e9e0(mgr, id, -11, 300, -1, 0): the corpse chain (delayedTick). L: +0x60 = 0 on z128's
    // actors; +0xc bit 1 is never set on the page (as `gone`); the other branches (+0xbc linked object: code -14 at 0x1a4,
    // FUN_0055f0e0 / FUN_0056baa8) need data the page has not.
    // an actor whose +0x38 came from a bit command (cmd 0x16b-0x16f) loses bits 2 and 0x200 as the stand-in does (GUESS as PROBE_BITS_DEAD)
    if (a.f38own) a.f38 = (a.f38 & ~0x204) >>> 0;
    if (a.flags28 & 0x20) warnOnce(`enemy_ai: #${a.id} died with +0x28 bit 0x20: FUN_0055cac8's other corpse branch not translated`);
    else delayedPost(a.id, -11, 300);
  }
  // FUN_0053e9e0(mgr, id, code, delay, -1, 0): an entry due at mgr +0x20 + delay. Mgr +0x20 counts ticks, not frames: FUN_0053b500's
  // end adds the integer part of its accumulator +0x24 (+= DAT_004eeb24, the step: 1.2 on PAL) after FUN_0053fde8 (S.mgr20 / S.mgr24
  // here; every reader of mgr +0x20 uses S.mgr20; S.frame only counts the page's frames for the hand-off schedule).
  // T: w230_corpse, 300 + 180 ticks = 400 frames. L: entries with the same due run in posting order
  // (the list insert, FUN_0053e9e0's walk, keeps that for the page's cases).
  function delayedPost(id, code, delay) {
    const e = { id, code, due: S.mgr20 + delay };
    let i = delayed.length;
    while (i > 0 && delayed[i - 1].due - e.due > 0) i--;
    delayed.splice(i, 0, e);
  }
  // FUN_0053edb0(mgr, id, code): the object's pending entries of that code leave the list
  function delayedDrop(id, code) { for (let i = delayed.length - 1; i >= 0; i--) if (delayed[i].id === id && delayed[i].code === code) delayed.splice(i, 1); }
  // FUN_0053f040: every entry with due - mgr +0x20 < 1, in list order. Codes (switch on code + 0xd3):
  //  -11 (case 200): object +0x24 == 0x11 takes FUN_0057ce00 (not an actor: L); else the body (vt+0x11c -> +0xe8):
  //       FUN_00342360(0.0, C, 180) = the fade to 0 over 180 frames (C+0x6b8 = 0, C+0x6bc = -C+0x6b4 / 180, C+0x564 |= 0x800000),
  //       the weapon MP's FUN_005a78d8 (left out: enemies.js draws the weapon with the body), +0xe4 |= 2;
  //       then FUN_0053e9e0(mgr, id, -10, 180, -1, 0).
  //  -10 (case 0xc9): vt+300 (an actor has none: L) -> manager event 9 (FUN_0053fde8 case 10: off, script event 0x20).
  // Other negative codes: warned. T: w230_corpse (k_hits12's inputs to f1400).
  function delayedTick() {
    while (delayed.length && delayed[0].due - S.mgr20 < 1) {
      const e = delayed.shift();
      // worker 0255: Vincent's status timers (FUN_0055f128 -> FUN_0053e9e0): FUN_0053f040 cases 0x6c / 0x6b / 0x6e / 0x6d / 0x6a ->
      // FUN_0055f338(P, k, 1)
      if (PLAYER_OBJ && e.id === PLAYER_OBJ.id && e.code >= -0x69 && e.code <= -0x65) {
        if (opts.items && opts.items.statusOff) opts.items.statusOff({ [-0x67]: 0, [-0x68]: 1, [-0x65]: 2, [-0x66]: 3, [-0x69]: 4 }[e.code], false);
        continue;
      }
      const o = objects.get(e.id);
      if (!o) continue;
      if (e.code === -11) {
        if (o.kind === 'actor' && o.C) {
          const C = o.C, d = Math.fround(0 - C.f6b4);
          C.f6b8 = 0;
          if (Math.abs(d) <= 0.0078125) { C.f6b4 = 0; C.f564 = (C.f564 & ~0x800000) >>> 0; }
          else { C.f564 = (C.f564 | 0x800000) >>> 0; C.f6bc = Math.fround(d / 180); }
          o.fe4 = (o.fe4 | 0) | 2;
        }
        delayedPost(e.id, -10, 180);
      } else if (e.code === -10) postManager(9, e.id);
      else if (e.code === -2) postManager(0x16, e.id);                        // case 0xd1 (cmd 0x113's period)
      else if (e.code === -4) postManager(0x17, e.id);                        // worker 0259: case 0xcf (cmd 0x114's next step)
      else if (e.code === -5 && o.kind === 'prop') { if (opts.props && opts.props.vt294) opts.props.vt294(o); }   // worker 0269: an EM barrier's vt+0x294 FUN_0054f338 (props.js)
      else if (e.code === -5) { o.e0 = 1; runEvent(o, 0x51); }                // worker 0257: vt+0x294 FUN_0057c7e8: open. FUN_0054add0 only with a script event 0x54 (none on z128's doors)
      else if (e.code === -6) { o.e0 = 0; runEvent(o, 0x53); }                // vt+0x2a4 FUN_0057c920: shut
      else warnOnce(`enemy_ai: delayed code ${e.code} (FUN_0053f040) not translated`);
    }
  }
  // FUN_00343160's fade step (C+0x564 bit 0x800000): C+0x6b4 += C+0x6bc x step, stopped at C+0x6b8; the corpse's 180-tick
  // fade (rate -1 / 180 per tick, x 1.2 a frame) takes 150 PAL frames. The draw alpha is
  // C+0x6b4 x 128 (FUN_00343de8 -> MP FUN_005a86a8). MISSING: enemies.js does not draw it (how the MP alpha blends on the GS is
  // not decoded; the corpse stays opaque until manager event 9 removes it).
  function fadeStep(C, step) {
    if (!(C.f564 & 0x800000)) return;
    const v = Math.fround(C.f6b4 + Math.fround(C.f6bc * step));
    C.f6b4 = v;
    if ((C.f6bc > 0 && v > C.f6b8) || (C.f6bc < 0 && v < C.f6b8)) {
      C.f6b4 = C.f6b8; C.f6bc = 0; C.f564 = (C.f564 & ~0x800000) >>> 0;
    }
  }

  // FUN_00565480(actor, flags, hitdir, hitpos, wasAlive), the branches z128's soldiers take (notes §10.3)
  function react(a, flags, dir, hitpos, wasAlive) {
    const C = a.C;
    // 1. C+0x1c8 / FUN_00356740 and the flag 8 -> 4 swap for actor +0x28 bit 0x20 or C+0x45c bit 17:
    // GUESS: not translated (z128's soldiers have neither bit; FUN_00356740 not read)
    if (!wasAlive) {
      if (C.motion && C.motion.cls === 0x36) warnOnce('enemy_ai: hit on a corpse in its death motion (FUN_005612a0) not translated');
      return;
    }
    if (a.f110 & 0xff00) warnOnce('enemy_ai: actor +0x110 reaction nibbles (FUN_00562670 / FUN_00562778) not translated');
    const isDead = dead(a);
    const grounded = C.f1c0 & 0x200;
    // FUN_00565480: +0x118 bit 0x800 turns a masked flag 8 / 4 into 2
    if (a.f118 & 0x800) { if ((flags & 8) && (a.f118 & 4)) flags = 2; else if ((flags & 4) && (a.f118 & 0x10)) flags = 2; }
    // worker 0259: FUN_0055aa88 (8, 9, 0xf, 0x10, 0x1f-0x21; player.js hitBranch). +0x118 bit 4 -> nothing. Flags 4 / 8: dead FUN_00561270(a, dir, 0, 0), alive FUN_005618d0(a, dir, 0, 2). Other flags: dead FUN_00561270(a, dir, 0, 0), alive nothing.
    // L: its other way in (attack states / state 1 / above 2 u, with +0x100 bits 46-47): the page's actors don't write those bits.
    const st = a.astate;
    if (st === 8 || st === 9 || st === 0xf || st === 0x10 || (st >= 0x1f && st <= 0x21)) {
      if (a.f118 & 4) return;
      if (isDead) knock(a, dir, 0, true);
      else if (flags & 0xc) knock(a, dir, 2, false);
      return;
    }
    // FUN_0055a410 (10-14, 0x15, 0x17): the ladder's states; no actor on the page has them
    if ((st >= 10 && st <= 14) || st === 0x15 || st === 0x17) return;
    if (flags & 8 && !(a.f118 & 4)) {
      // worker 0259: FUN_00565480 flags 8: dead: on the ground without flag 1: FUN_00561270(a, dir, 0, 0), else k 2. Alive: state 0xf -> nothing; on the ground without flag 0x40: FUN_005618d0(a, dir, 0, 0), else k 2
      if (isDead) { knock(a, dir, grounded && !(flags & 1) ? 0 : 2, true); return; }
      knock(a, dir, grounded && !(flags & 0x40) ? 0 : 2, false);
      return;
    }
    if (flags & 4 && !(a.f118 & 0x10)) {
      // worker 0259: FUN_00565480 flags 4 on the ground. T w259_hit_soldier f200 (TRACE_HIT): state 0x18, m_stbd0, 49 frames, back to 3; the kill f360: state 7
      if (!grounded) { knock(a, dir, 2, isDead); return; }                    // FUN_00561270 / FUN_005618d0(a, dir, 0, 2)
      if (C.motion && C.motion.cls === 0x36) { warnOnce('enemy_ai: hit on a corpse in its death motion (FUN_005612a0) not translated'); return; }
      if (isDead) { bigDeath(a, dir); return; }
      if ((a.f118 & 0x100000) && !(flags & 0x40)) return;
      bigHit(a, dir);
      return;
    }
    if (flags & 2) {
      if (a.f118 & 8) { if (isDead) die(a, dir); return; }                    // FUN_00565480: masked: the no-flags end, FUN_00560fc8
      if (!grounded) { knock(a, dir, 0, isDead); return; }                    // FUN_00561270 / FUN_005618d0(a, dir, 0, 0)
      if (isDead) { die(a, dir); return; }
      if ((a.f118 & 0x100000) && !(flags & 0x40)) return;
      const away = unit3(sub3(a.pos, hitpos));
      flinch(a, unit3([0, 1, 2].map(k => f(dir[k] + f(0.15 * away[k])))));
      return;
    }
    if (isDead) die(a, dir);                                                  // 8. no flag 2/4/8
  }

  // worker 0259: FUN_00562898(a, dir, 0): the big hit (flags 4: what reaches it on the page is the stagger chain's 0x44 and a weapon's react flag; Vincent's melee isn't on the page yet). Event 0x29; +0x118 bits 0x10 / 0x10000 -> nothing. With a walk polygon
  // (C+0x4c0) and no +0x118 bit 0x2000000: FUN_0034b638(0.25, C, -dir), C+0x1c0 |= 0x200,
  // DAT_0046e298 bit 13: unless +0x118 & 0x1800: FUN_003531e0(8, 12, C, dir) + mover 9; FUN_0034e960(C, 4). Then FUN_00562b30: flinching (C+0x564 bit 0x10000) ->
  // motion 0x1e, else state 0x18 (posture 1 or state 0x1d: 0x1f / 0x1c, warned). The traced soldiers had no polygon (FUN_0055a828's branch): no slide in T.
  function bigHit(a, dir) {
    const C = a.C;
    runEvent(a, 0x29);
    if ((a.f118 & 0x10) || (a.f118 & 0x10000)) return;
    if (hasPoly(a)) {
      if (!(a.f118 & 0x2000000)) {
        C.kturn = { dir: unit3([-dir[0], -dir[1], -dir[2]]), rate: 0.25 };    // FUN_0034b638(0.25, C, -dir)
        C.f1c0 |= 0x200;
        if (!(a.f118 & 0x1800)) { slide(a, 9, 8.0, 12.0, dir); C.s214 = 4; }
      } else if (!(C.f564 & 0x800)) PM.stopAll(a, warnOnce);                  // FUN_00342308, FUN_0055a828
    }
    if (a.stance === 1 || a.astate === 0x1d) { warnOnce('enemy_ai: big hit in posture 1 / state 0x1d (motion 0x1f / state 0x1c) not translated'); return; }
    if (C.f564 & 0x10000) flinchMotion(a); else setActorState(a, 0x18);
  }
  // FUN_0034f178 cases 9 / 0xb / 10: FUN_00356d98 when the move mode isn't 0xc yet: the body at the position now (a script walk on mover 1 leaves B.poly behind; navMove would clamp him to it). Not while airborne.
  function enterBody(a) {
    if (walkCol && a.C.mm !== 0xc && !(a.B && a.B.state === 2)) placeBody(a);
  }
  // C+0x4c0: the body's walk polygon (the page places a body when a walking mode first needs it; without the page's collision there is none)
  function hasPoly(a) {
    const B = bodyOf(a);
    if (B.poly === null && walkCol) placeBody(a);
    return B.poly !== null;
  }
  // worker 0259: FUN_00561138(a, dir): the big hit's death: FUN_0034b638(0.25, C, -dir), FUN_00353340(DAT_0046edb0 = 12, DAT_0046edb4 = 16, C, dir) + mover 0xb, FUN_0034e960(C, 4), state 7 unless +0x118 bits 0x8000 / 0x10000. No FUN_003533e0, unlike FUN_00560fc8.
  function bigDeath(a, dir) {
    const C = a.C;
    C.kturn = { dir: unit3([-dir[0], -dir[1], -dir[2]]), rate: 0.25 };
    slide(a, 0xb, 12.0, 16.0, dir);
    C.s214 = 4;
    if (!(a.f118 & 0x18000)) setActorState(a, 7);
  }
  // worker 0259: FUN_005618d0(a, dir, 0, k) / FUN_00561270 (dead; player.js knockDown is the same function on Vincent). No polygon (C+0x4c0, T w259_hit_soldier): FUN_00562898 alive, FUN_00560fc8 dead.
  // +0x118 bits 4 / 0x10000 -> nothing. +0x156 hits off the ground; under DAT_0046ed98 = 15 ticks since +0x164 -> nothing; DAT_0046ed9c = 6 hits -> k 2. Event 0x29. Within 130 deg of the facing (the hit from behind):
  // state 0x10, turn to dir, else 0xf, turn from it. FUN_003533e0, C+0x1c0 &= ~0x200, FUN_00353280(d, T, rise, 0.5, C, dir) + mover 10, FUN_0034e960(C, 4). T w259_hit_poly (route r02_walkway, TRACE_HIT): 46 from the front f80 state 0xf,
  // r_stbl0, r_bl_0, lands f126 state 0x11, r_bl_1, state 2 f203, r_rev_0; 45 from behind f160 state 0x10, r_jp_dm0, r_fl_0, f202 state 0x11, r_fl_1, f226 state 2, r_rev_0, f326 r_gst; dead f360 the same, held in 0x11.
  function knock(a, dir, k, isDead) {
    const C = a.C, B = bodyOf(a);
    enterBody(a);
    if (!hasPoly(a)) { if (isDead) die(a, dir); else bigHit(a, dir); return 0; }
    if ((a.f118 & 4) || (a.f118 & 0x10000)) return 0;
    a.f156 = (C.f1c0 & 0x200) ? 0 : ((a.f156 ?? 0) + 1) & 0xff;
    if (a.f164 != null && S.mgr20 - a.f164 < 15) return 0;
    if (a.f156 >= 6) k = 2;
    runEvent(a, 0x29);
    const u = unit3(dir), behind = Math.abs(moveAngle(a.face, u)) < 2.268928;
    PM.stopAll(a, warnOnce);
    C.slide = null;
    C.kturn = { dir: behind ? u : [-u[0], -u[1], -u[2]], rate: 0.25 };
    C.f1c0 = (C.f1c0 & ~0x200) >>> 0;
    const T = f(rng() + 11.0), above = B.state === 2 && B.gy != null ? f(B.gy - a.pos[1]) : 0;   // FUN_00359050: above the ground
    if (above > 24.0) k = 2;
    let d, n;
    if (k === 1) { d = f(22.0 + rng()); n = Math.trunc(rng() * 3.0) + 5; }
    else if (k === 0) { d = f(27.0 + rng()); n = Math.trunc(rng() * 9.0) + 7; }
    else { d = f(rng() + 17.0); n = 4; }
    const rise = (a.f156 >= 12 && above > 10.0) || above > 30.0 ? 0 : n === 4 ? 4.0 : n + 8.0;   // DAT_004ef388[n] (FUN_0056aba8)
    const v = f(f(f(d + d) / T) - 0.5);
    if (C.mover !== 0) PM.moverStop(a, warnOnce);
    C.slide = { dir: u, v, dv: f(v / T), end: 0.5, first: true };
    C.mover = 10;
    const gy = B.state === 2 ? B.gy : null;
    PM.bodyTakeoff(a, rise);
    if (gy !== null) B.gy = gy;                                               // already off the ground: body+0x10 keeps its ground point (bodyTakeoff is for a take-off from it; player.js startFall leaves it)
    C.s214 = 4;
    // FUN_0055b8e0 last: mid-swing (C+0x568 bit 12) the attack class's leave FUN_0059e938 -> FUN_003533e0 stops mover 10, as row 540 records for the flinch; the body still falls (knockMove with no slide)
    setActorState(a, behind ? 0x10 : 0xf);
    a.f164 = S.mgr20;
    return 1;
  }
  // FUN_003515e8 (mover 10): the move at +0x320, then off the ground down by +0x324 x step to the end 0.5; on it capped at 0.5, down by DAT_0046f480 (0.0125) x step to 0. T: the first frame is on the ground's branch: 260.8 -> 29.1 -> 30 u/s.
  function knockMove(a, step) {
    const C = a.C, B = a.B, s = C.mover === 10 ? C.slide : null;
    const k = s ? f(s.v * step) : 0, mv = s ? [f(s.dir[0] * k), 0, f(s.dir[2] * k)] : [0, 0, 0];
    if (B.state === 2) PM.gravityStep(B);
    a.pos = walkBody(a, mv);
    if (s) {
      const ground = s.first || B.state !== 2;
      if (ground && s.end < s.v) s.v = s.end;
      s.first = false;
      const end = ground ? 0 : s.end, dv = ground ? 0.0125 : s.dv;
      s.v = f(s.v - f(dv * step));
      if (s.v < end) s.v = end;
    }
    if (B.state === 2) C.f1c0 = (C.f1c0 & ~0x200) >>> 0; else C.f1c0 = (C.f1c0 | 0x200) >>> 0;
  }
  // The knock-down's classes on a soldier (jump_core.js KnockMotion for Vincent; factory 0x592918; C+0x564 |= 0xc000, T). Rows: 0x33 0xa8, then 0x34 0xab; 0x1b 0xae, then 0x39 0xaf; ground: state 0x11: from 0x34 class 0x35: FUN_003533e0, 15 u in 30 ticks
  // back along the facing, row 0xac; from 0x39 class 0x3a: row 0xb0 from frame 1, its end or 60 ticks. Their end: state 2 alive (state 0x11's FUN_00539570), held dead. State 2 from 0x11: class 0x37: row 0xb1, its end. T: the soldier's rows don't take Vincent's class 0x38 (r_bl_ht0, above 15).
  function knockClass(a, m, step) {
    const C = a.C, ground = (C.f1c0 & 0x200) && a.B.state !== 2;
    const ask = (row, frame) => { m.noRow = !clipOf(a, row); blendSet(a, 1, 2); playClip(a, clipOf(a, row) || C.clip, 0x82); C.hold = false; blendSet(a, 1, -1); if (frame && C.mp) C.mp.frame = frame; };
    const done = () => m.noRow || clipFrames(a, C.clip) == null || motionDone(a);   // FUN_003460d8: no row (a townsperson's stance) or no frames kept: nothing plays
    const first = !m.phase;
    if (first) { m.phase = 1; m.timer = 0; }
    if (a.astate === 0xf || a.astate === 0x10) {
      if (ground && !first) { setActorState(a, 0x11); return; }
      if (m.cls === 0x33 || m.cls === 0x1b || m.cls === 0x38) {
        if (first) { ask(m.cls === 0x33 ? 0xa8 : m.cls === 0x1b ? 0xae : 0xad); return; }   // 0x38: FUN_0059d4c0, row 0xad, at its end 0x39 (the ground takes it above)
        if (done()) { C.motion.cls = m.cls === 0x33 ? 0x34 : 0x39; ask(m.cls === 0x34 ? 0xab : 0xaf); }
      }
      return;
    }
    if (m.cls === 0x35) {
      if (first) { C.slide = null; C.mover = 0; const fc = a.face; slide(a, 9, 15.0, 30.0, [-fc[0], 0, -fc[2]]); ask(0xac); return; }
    } else if (m.cls === 0x3a) {
      if (first) { ask(0xb0, 1); return; }
      m.timer = f(m.timer + step);
    } else if (m.cls === 0x37) {
      if (first) { ask(0xb1); return; }
      if (done()) { C.f564 &= ~0xc000; endMotion(a); setMotion(a, 3); }
      return;
    }
    if (m.k36) {                                                              // class 0x36 FUN_0059cee8: FUN_003533e0, timer 10, then its event 0x36 (FUN_00539570): +0x118 |= 0x100, FUN_003533e0 unless C+0x564 bit 0x800
      if (m.k36 === 1) { C.slide = null; C.mover = 0; m.k36 = 2; m.timer = f(10.0 - step); return; }
      if (m.k36 === 2 && !(0.0 < m.timer)) { m.k36 = 3; a.f118 |= 0x100; events.push(`settled ${a.id}`); return; }
      if (m.k36 === 2) m.timer = f(m.timer - step);
      return;
    }
    if (a.astate !== 0x11 || !(done() || (m.cls === 0x3a && m.timer > 60.0))) return;
    if (dead(a)) {
      // FUN_00539570 events 0x35 / 0x3a, dead: C+0x664 7..9: FUN_00565bd0(a, 1), state 7; else nothing: the class's next, 0x36
      const n664 = C.st664 ?? 0;
      if (n664 >= 7 && n664 < 10) { posture565bd0(a, 1); setActorState(a, 7); return; }
      m.cls = 0x36; m.k36 = 1;
      return;
    }
    if (!(C.f564 & 0x800)) { C.slide = null; C.mover = 0; }
    setActorState(a, 2);
  }
  // FUN_0059df28 (class 0x3f, vtable 0x5a4b70; jump_core.js HitMotion for Vincent): phase 0: blend 2, row 0x3e now, not looped, blend back, timer 0. Phase 1: done at the
  // clip's end or timer > 120; off the ground the done bit at once. Done -> state 0x18's FUN_00539b88: dead 7, off the ground 0x10, else 3 with the gun, 2 without.
  // T: row 0x3e = m_stbd0 (stance 30), 49 frames, m_st_a a frame after state 3.
  function hitMotion(a, m, step) {
    const C = a.C;
    if (!m.phase) {
      blendSet(a, 1, 2);
      m.noRow = !clipOf(a, 0x3e);
      playClip(a, clipOf(a, 0x3e) || C.clip, 0x82); C.hold = false;
      blendSet(a, 1, -1);
      m.phase = 1; m.t = 0; m.timer = 0;
      return;
    }
    m.timer = f(m.timer + step);
    const ended = m.noRow || clipFrames(a, C.clip) == null || motionDone(a) || m.timer > 120.0 || !(C.f1c0 & 0x200);    // FUN_003460d8
    if (!ended || a.astate !== 0x18) return;
    if (dead(a)) { setActorState(a, 7); return; }
    if (!(C.f1c0 & 0x200)) { setActorState(a, 0x10); return; }
    setActorState(a, C.gun ? 3 : 2);
  }
  // FUN_00561570: the flinch. FUN_0034b638(0.15, C, -dir) is left out (GUESS: not read; it runs
  // before the push-back), push-back FUN_003531e0(4, 4, C, dir) + mover 9 (FUN_0034edf0) for an
  // actor without +0x28 bit 0x20 (e027), C+0x214 = 4 (FUN_0034e960: no turn), then FUN_00561718.
  function flinch(a, dir) {
    const C = a.C;
    const locked = (a.f118 & 0x1800) !== 0;
    const mv = C.mover === 1 || C.mover === 0xe;
    if (!mv && !locked) {
      slide(a, 9, 4.0, 4.0, dir);
      C.s214 = 4;
    }
    const started = flinchClip(a);
    if (mv && started) C.f1c0 |= 0x20;
  }
  // FUN_00561718: no new clip within 12 frames of the last (6 on a coin flip: one FUN_0040b5c0 draw,
  // int(r x 2) != 0); stance (actor +0x100 bits 40-41) 0 -> motion state 0x1e (FUN_00341780)
  function flinchClip(a) {
    const el = S.mgr20 - a.f144;                                              // FUN_0054cbe8: DAT_0046e938 +0x20 (ticks)
    const r = rng();
    if (Math.trunc(r * 2) === 0 ? el < 12 : el < 6) { a.f144 = S.mgr20 - 6; return 0; }
    const st = (a.stance ?? 0) & 3;
    if (st === 2) { a.f144 = S.mgr20; return 1; }                             // FUN_00561718: FUN_0055b8e0(a, 0x11): lying, already there; +0x144 written, returns 1
    if (st !== 0) { warnOnce(`enemy_ai: flinch stance ${st} (motion 0x1f) not translated`); return 0; }
    // worker 0259: FUN_00598950 phase 0: class +0 (the class it replaced, FUN_00341780) == +0x70: FUN_00340bb8(C, 1, 5), else (C, 0, -1); the row by
    // C+0x590 low 4 bits (jump table 0x5a3b10; FUN_0055d390), flags -1; FUN_00340bb8(C, 1, -1) after the request.
    flinchMotion(a);
    a.f144 = S.mgr20;
    return 1;
  }
  // FUN_00560fc8: stop (FUN_003533e0), the death slide FUN_00353340(12, 16, C, dir) + mover 0xb for an
  // actor without +0x28 bit 0x20 (C+0x7e4 +0x50 / +0x54 override: none on the page), status bit 6
  // (FUN_0055f0e0(a, 6) -> FUN_0056b620): not set for z128's soldiers; actor state 7 unless +0x118
  // has 0x8000 / 0x10000
  function flinchMotion(a) {
    const again = a.C.motion && a.C.motion.cls === 0x1e;
    setMotion(a, 0x1e);
    if (again) blendSet(a, 1, 5); else blendSet(a, 0, -1);
    playClip(a, clipOf(a, FLINCH_ROW[(a.C.f590 ?? 0) & 0xf] ?? 0x25) || a.C.clip, 0x82); a.C.hold = false;
    blendSet(a, 1, -1);
  }
  function die(a, dir) {
    const C = a.C;
    PM.stopAll(a, warnOnce);                                                  // FUN_003533e0 (FUN_0034d870, FUN_00352a60: mover 0xd gives its nodes back)
    C.slide = null;
    slide(a, 0xb, 12.0, 16.0, dir);
    if (a.s64 & 0x40) warnOnce('enemy_ai: status bit 6 death (FUN_0056b620) not translated');
    if (!(a.f118 & 0x18000)) setActorState(a, 7);
  }
  // FUN_003531e0 / FUN_00353340 + FUN_0034edf0(C, mode): direction (unit), speed 2d / T per tick,
  // deceleration speed / T per tick
  function slide(a, mode, d, T, dir) {
    const C = a.C, v = f(f(d + d) / T);
    enterBody(a);
    if (C.mover !== 0) PM.moverStop(a, warnOnce);                             // FUN_0034edf0: C+0x300 != 0 -> FUN_00352a60 (any mover)
    C.slide = { dir: unit3(dir), v, dv: f(v / T) };
    C.mover = mode;
  }
  // FUN_0034f8c0 (body mover): mode 9 = FUN_00351550, mode 0xb = FUN_003516a0. Both hand the speed to
  // FUN_0034af98 (C+0xc0 dir, C+0xcc speed), which the body move FUN_0034c388 applies as dir x speed x
  // step; then speed -= deceleration x step. Mode 9 ends below 0 (FUN_00352a60 -> mover 0); mode 0xb
  // stops at 0 and stays. GUESS: mode 0xb's second term (a root-motion velocity from the death clip,
  // FUN_003516a0's matrix part) is left out.
  function moverUpdate(a, step) {
    const C = a.C, s = C.slide;
    if (a.boss) { a.boss.body(); return; }                                   // worker 0235: move mode 1 / turn mode 1 (boss_io.js)
    if (C.kturn) {                                                            // FUN_0034b638(rate, C, d): the turn to d, as turnBody's FUN_0034a5a8 with FUN_0034e960(C, 4)
      a.face = turnToward(a.face, C.kturn.dir, C.kturn.rate, step);
      if (1 - dot3(a.face, unit3([C.kturn.dir[0], 0, C.kturn.dir[2]])) < 1e-6) C.kturn = null;
    }
    if (C.mover === 10 || ((a.astate === 0xf || a.astate === 0x10) && a.B && a.B.state === 2)) { knockMove(a, step); return; }
    // path walking (mover 1, move mode 9, turn mode 5): FUN_0034ea18's order, path_mover.js. The end of the
    // path (FUN_0034f8c0) sends the body listener event 2: FUN_005690c8 -> FUN_00588550 case 2 (0x588678)
    // posts manager event 0xf (FUN_0053fbe8), which FUN_0053fde8 turns into script event 0x13 (drainManager).
    if (C.mm === 0xc) {
      // move mode 0xc (the walk-mesh body; mover 3 sets it and FUN_00352a60 leaves it): path_mover.js
      // approachFrame, never bodyFrame (that is move mode 9's polyline). The target position =
      // FUN_0054a720(target) (C+0x30). A flinch / death slide (movers 9 / 0xb) also runs in mode 0xc in the
      // game (FUN_0034f178 cases 9 / 0xb only enter 0xc): the step below goes through walkBody.
      bodyOf(a);
      const t = C.tgt, sliding = !!s && (C.mover === 9 || C.mover === 0xb), air = sliding && a.B.state === 2;
      // A slide in the air (killed in state 8): the game's own path, FUN_003516a0 / FUN_00351550 -> FUN_0034af98 (C+0xc0, C+0xcc; below 0.01 FUN_0034b110) and the mode-0xc body falls and lands.
      if (air) { C.want = s.dir.slice(); C.wk = C.mover === 0xb && !(s.v >= 0.01) ? 0 : s.v; }
      const r = PM.approachFrame(a, t && t.pos ? t.pos : null, step, walkBody, warnOnce, sliding, navOf(a));
      if (r === 'done') events.push(`approach end ${a.id}`);
      else if (r === 'nav end') events.push(`nav end ${a.id}`);
      if (air) {
        s.v = f(s.v - f(s.dv * step));
        if (s.v < 0) { s.v = 0; if (C.mover === 9) { C.mover = 0; C.slide = null; C.wk = 0; } }
      }
      if (!sliding || air) return;
    } else if (PM.moveStart(C), C.mover === 1 || C.mm || C.s214 === 5) {
      if (PM.bodyFrame(a, data.paths, step, PM.MOVE_DT, warnOnce) === 'done') {
        events.push(`path end ${a.id}`);
        postManager(0xf, a.id);
      }
    }
    if (!s || (C.mover !== 9 && C.mover !== 0xb)) return;
    if (C.mover === 0xb && !(s.v >= 0.01)) { s.v = Math.max(0, f(s.v - f(s.dv * step))); return; }   // FUN_0034b110: no move
    const k = f(s.v * step);
    // worker 0259: FUN_0034f178 cases 9 / 0xb enter mode 0xc: the slide is the walk-mesh body's (FUN_00357d48: no polygon, no walk). Without the page's collision (node tests) a flat step.
    if (walkCol) { hasPoly(a); a.pos = walkBody(a, [f(s.dir[0] * k), 0, f(s.dir[2] * k)]); }
    else a.pos = [f(a.pos[0] + f(s.dir[0] * k)), a.pos[1], f(a.pos[2] + f(s.dir[2] * k))];
    s.v = f(s.v - f(s.dv * step));
    if (C.mover === 9) { if (s.v < 0) { s.v = 0; C.mover = 0; C.slide = null; } }
    else if (s.v < 0) s.v = 0;
    if (C.mm === 0xc && a.B) a.B.vel = [f(s.dir[0] * s.v), 0, f(s.dir[2] * s.v)];
  }

  // ------------------------------------------------ AI run FUN_00365110 and scheduler FUN_00365008
  function queueInsert(ai) {                                                  // FUN_00365ad0
    let i = 0;
    while (i < S.q.length && ai.due - S.q[i].due > 0) i++;
    S.q.splice(i, 0, ai);
  }
  function runAI(ai) {
    perception(ai);
    if (ai.brain && !(ai.flags & 0x10)) {                                     // owner vt+0x26c (actor+0x180) assumed set
      if (ai.brain.mode === 2) brain2(ai);                                    // vt+0x1c
      else if (ai.brain.mode === 1) brain1(ai);
      else if (ai.brain.mode === 5) brain5(ai);
      else if (ai.brain.mode === 6) brain6(ai);
      else if (ai.brain.mode === 3) brain3(ai);                               // FUN_00361690 (worker 0252)
      else if (ai.brain.mode === 0x100 && ai.brain.boss) ai.brain.boss.update();   // worker 0235: FUN_00aa16f8
      if (ai.amode === 3) action3(ai);                                        // action layer (+0xe4, FUN_00365110)
      else if (ai.amode === 2) action2(ai);
      else if (ai.amode === 5 || ai.amode === 6) action56(ai, ai.amode);
      if (ai.combat) { if (ai.combat.mode === 1) combat1(ai); else combat2(ai); }   // combat layer (+0xe8)
    }
    ai.last = S.now;
    ai.due = S.now + ai.interval;
    if (!(ai.flags & 1)) ai.due += S.runs;
    if (S.q.length > 1) { S.q.splice(S.q.indexOf(ai), 1); queueInsert(ai); }
    S.runs++;
  }
  function scheduler(step) {
    // FUN_00365008: returns at once while FUN_00325b40 (game-state bit 6, AI paused: Zone.peace, game_state.js) is set;
    // the clock does not advance (w220_box: AI clock 1821 from f206 to f457). Manager +0x2b0 bit 12: GUESS never set
    if (aiPaused()) return;
    const f = Math.fround(S.acc + step);
    S.acc = f;
    if (!(1.0 <= f)) return;
    S.now += Math.trunc(f);
    S.rays = S.shots = S.runs = S.total = 0;
    S.acc = Math.fround(f - Math.trunc(f));
    if (S.q.length > 0) {
      while (S.q[0].due - S.now < 1) runAI(S.q[0]);
      if (S.runs === 0 && S.q[0]) runAI(S.q[0]);
      fireTimers();
    }
  }

  // ------------------------------------------------ trigger volumes FUN_005517a8 (shapes 0 / 3 / 8)
  function triggerCheck(o, pNew, pOld) {
    const t = o.t;
    if (!o.active) return;                                                    // FUN_00550ad8 / cmd 0x108 (see setActive)
    if (t.shape !== 0 && t.shape !== 3 && t.shape !== 8) return;              // shape 4 (FUN_003114d0) not translated
    if ((t.flags >> 19) & 1) return;                                          // GUESS: bit-19 swept branch not translated
    const lNew = xform(t.inv, pNew), lOld = xform(t.inv, pOld);               // FUN_005507a0
    const inNew = inBox(lNew, t.lo, t.hi), inOld = inBox(lOld, t.lo, t.hi);
    if (inNew) {
      if (!inOld && (t.flags & 1)) runEvent(o, 0xd, [segBox(lOld, lNew, t.lo, t.hi), 0]);
      return;
    }
    if (inOld && (t.flags & 2)) runEvent(o, 0xe, [segBox(lNew, lOld, t.lo, t.hi), 0]);
    if (inOld) return;
    const h = segBox(lOld, lNew, t.lo, t.hi);
    if (h !== -1) {
      runEvent(o, 0xd, [h, 0]);
      runEvent(o, 0xe, [segBox(lNew, lOld, t.lo, t.hi), 0]);
    }
  }

  // ------------------------------------------------ one game frame
  function tick(step, playerOld, playerNew) {
    events.length = 0;
    S.frame++;                                                                // the page's frame count (hand-offs); mgr +0x20 is S.mgr20
    activated.length = 0;
    // 0. the nav search service FUN_00368420 (first in FUN_00323128): queued searches take their 40 steps
    if (G) NG.serviceUpdate(svc);
    // 1. AI
    scheduler(step);
    // 1a. Vincent's position is set in the player tick (FUN_0053b500, after the AI): vt+0x234 = FUN_00573c60
    // -> FUN_0055ef78 -> FUN_00563970 (his +0x28 = 0x20901f in the save: bit 0x10 set): his nav node
    if (G && P && P.pos) NG.trackNode(G, P, playerNew || P.pos);
    // worker 0224: then FUN_00573c60's grid walk FUN_005442a0 -> each item's vt+0x164 FUN_00580870 (the pickups; items.js)
    if (opts.items) opts.items.sweep(playerNew, playerOld);
    // 1b. Vincent's shot (queueShot). FUN_00323128 runs the AI scheduler FUN_00365008 first, then the
    // object update FUN_0053b500, which ticks the player (vt+0x214 of vtable 0x58f128 = FUN_005747a0
    // -> FUN_005786e8 -> FUN_00579570 -> FUN_00577480: the cone draws) before its object lists
    // (FUN_005810e8: bullets, so the flinch draw). The shared RNG is drawn in that order.
    for (const sh of pendingShots.splice(0)) playerShot(...sh);
    // 2. bullets (oldest first). Vincent as they see him: C+0x00 is rewritten in the body update (FUN_0034c388,
    // after the object lists), so his capsule is at his start-of-frame position (T: w168 / k_bullet call logs)
    pStart = playerOld ? playerOld.slice() : null;
    // worker 0270: FUN_005549f0's tail places the model (FUN_00554058) and moves the trail (FUN_00557e40) after a moved
    // update, the end frame too; the delete (FUN_0053fa08 -> FUN_005529a8) then ends the trail and frees the model
    for (const b of bullets.slice()) {
      const end = bulletUpdate(b, step);
      if (opts.shotFx && b.age > 0) opts.shotFx.move(b);
      if (end) {
        bullets.splice(bullets.indexOf(b), 1);
        if (b.snd && opts.soundStop) { opts.soundStop(b.snd); b.snd = null; }  // worker 0270: FUN_005529a8 -> FUN_0033cf00(+0x18c)
        if (opts.shotFx) opts.shotFx.end(b);
      }
    }
    // 2b. melee attack objects (FUN_0057a330), oldest first; one made in step 3 first updates next frame
    // (T k_melee18: made f1460, first update f1461). L: their place among the manager's object lists.
    for (const o of attackObjs.slice()) if (attackObjUpdate(o, step)) attackObjs.splice(attackObjs.indexOf(o), 1);
    // worker 0209: the explosions (object type 7, vt+0x214 FUN_0057e638; props.js). GUESS: after the bullets and attack
    // objects (the FUN_005810e8 list order of type 7 is not read)
    if (opts.props) { opts.props.nodeBoxes(opts.chunkAnims); opts.props.update(step); }
    // worker 0224: the items (vt+0x214 FUN_0057ff80; items.js). L: in the same object lists, after the explosions
    if (opts.items) opts.items.update(step);
    // 3. bodies: turn (FUN_0034ea18 -> FUN_0034de50), then the motion state (may spawn bullets).
    // GUESS: turn before the motion state (their order inside the body update is not traced; the turn
    // reads only C+0x2b0, which neither changes)
    for (const a of actors) {
      // GUESS: a dead soldier stops turning. In the game the turn runs in FUN_0034ea18 until C+0x214 is 0;
      // the death path (FUN_0055cac8 -> FUN_0035f728) isn't seen to clear it, so he may keep turning
      // toward his last aim point (notes/fidelity-audit.md 'Dead soldier stops turning').
      if (dead(a)) { bodyUpdate(a, step); trackMoved(a); continue; }
      // FUN_00343160 (motion update): C+0x564 bit 30 -> FUN_00342650: the C+0x6c2 object's vt+0x5c
      // point -> FUN_003424c0 (no parent-frame transform: vt+0x34 = no parent on the static room, L)
      // T: the point is where Vincent was before this frame's move (record f's position fits the
      // game's turn, f+1's does not: k_enemy_engage7 #66 open loop median 0.9 vs 1.0 deg, max 5.5 vs 11)
      // With Vincent's pose: his C as this soldier's update sees it (C_BEFORE_PLAYER); without one the fallback
      // keeps the start-of-frame position as before.
      if ((a.C.f564 & 0x40000000) && a.target) {
        const bw = a.target === P ? playerBones(!C_BEFORE_PLAYER.has(a.rec)) : null;
        setAim(a, (bw && bw(PLAYER_AIM_BONE)) ? bw(PLAYER_AIM_BONE)[3].slice() : targetPoint(a.target === P && playerOld ? { pos: playerOld } : a.target));
      }
      a.C.f224 = 0;                                                           // FUN_0034de50: zero first; turn modes 5 / 6 write it
      if (a.C.s214 === 6 && !(a.C.f564 & 0x80000000)) { const old = a.face; a.face = turnBody(old, a.pos, a.C.t2b0, step); a.C.f224 = PM.turnRate(old, a.face, step); }
      bodyUpdate(a, step);
      trackMoved(a);
    }
    // 3b. the opening event's hand-off (worker 0205, checkpoint.js handOff): a body whose battle clip ends this frame
    // (FUN_00343de8: C+0x564 bit 0x10000000, FUN_00346150() == 0) -> FUN_00344d68: C+0x564 &= ~0x18000000,
    // FUN_003157b0(status, 1), FUN_00558cc0 (the actor at the status matrix: +0x30 position, +0x40 facing).
    // T: after step 3's turn (record 24 holds the hand-off facing, the turn shows from record 25). Not translated: FUN_00558cc0's
    // vt+0x234 / FUN_00356d98 / FUN_00340e08 body sync and FUN_005476d0(mgr, 1, a) (T w204_reload: they stay at
    // the hand-off, y -141.45, to record 270).
    // GUESS: a fixed frame (h.frame, checkpoint.js SOLDIER_RELEASE) stands in for the whole clip-end condition. Not
    // translated: FUN_00344d68's status +0x60 bit 0x20000 branch (no FUN_003157b0) and its param_2 != 0 path (from
    // FUN_00558bb8, the deactivation). In the game a new motion request (a hit reaction, FUN_00344bd0 / FUN_003449a0)
    // ends the battle clip early and places the actor at that frame's pose, which the page doesn't have: a soldier hit
    // (HP changed) or dead before its hand-off is skipped (warned).
    for (let i = 0; i < handOffs.length;) {
      const h = handOffs[i];
      if (h.frame !== S.frame) { i++; continue; }
      handOffs.splice(i, 1);
      const a = actors.find(x => x.rec === h.rec);
      if (!a) continue;
      if (dead(a) || (h.hp != null && a.hp !== h.hp)) { warnOnce(`enemy_ai: record ${h.rec} hit before its hand-off: the game places it at that frame's battle-clip pose (not on the page); left in place`); continue; }
      // C+0x564 &= ~0x18000000 (FUN_00344d68): kept for the record; the page never sets these bits (dead here)
      a.C.f564 = (a.C.f564 & ~0x18000000) >>> 0;
      a.pos = h.pos.slice(); a.face = h.face.slice();
    }
    // 4. messages posted last frame -> event 2 of the receiver (r0 = n, r2 = sender)
    const mail = mailbox.splice(0);
    for (const m of mail) { const o = objects.get(m.to); if (o) runEvent(o, 2, [m.n, 0, m.from, 0]); }
    // 5. trigger volumes (the player's move this frame): FUN_00573c60 -> FUN_005442a0 tests both ends of the move 7 up (as the items' sweep,
    // items.js SWEEP_DY). Many boxes' floors lie just above the walk floor (trigger 160: y -0.41, feet -0.06): the feet alone miss them (worker 0264)
    if (playerOld && playerNew) {
      const a = [playerNew[0], Math.fround(playerNew[1] - 7), playerNew[2]], b = [playerOld[0], Math.fround(playerOld[1] - 7), playerOld[2]];
      for (const o of triggers) triggerCheck(o, a, b);
    }
    // 5b. script timers FUN_0053e868, then FUN_0053f040 (not read), then FUN_0053fde8 (FUN_0053b500's last three calls)
    for (const a of actors) if (a.C) fadeStep(a.C, step);                    // the bodies' FUN_00343160 (object updates; worker 0230)
    timerTick(step);
    delayedTick();                                                           // FUN_0053f040 (worker 0230)
    // 6. manager events, FUN_0053fde8 (the last call of FUN_0053b500). L: the page's steps 1-5 are not
    // in the game's exact order, but they all run before this.
    drainManager();
    // FUN_0053b500's end (worker 0230): mgr +0x24 += step; its integer part moves to +0x20 (the delayed list's clock)
    { const v = Math.fround(S.mgr24 + step), n = Math.trunc(v); S.mgr24 = v; if (n > 0) { S.mgr20 += n; S.mgr24 = Math.fround(v - n); } }
    // the MP head layers advance as enemies.js's tick does after the AI (FUN_005aa2a8: frame += MP+0x40c x step,
    // the sum rounded toward zero; a looped layer wraps to 0 at n, any other holds n - 1); rootSample reads them
    // next frame. T: k_lunge166 #66 MP+0x218 (r_atk_0): 23.999971 after 40 frames (round to nearest: 24.00001)
    for (const a of actors) {
      const h = a.C.mp, n = h && clipFrames(a, h.clip);
      if (!h || h.frame == null || n == null || (a.C.f564 & 0x80000000)) continue;   // lent: the actor has no MP (FUN_0056a5e0: +0x180 = 0)
      h.frame = chop(h.frame + chop(chop((a.C.rate != null ? a.C.rate : 0.5) * 1.0) * step));
      if (h.loop) { if (n <= h.frame) h.frame = 0; }
      else if (n - 1 <= h.frame) h.frame = n - 1;
    }
    return events.slice();
  }

  // Stage-load activation (worker 0204). FUN_00324e70 -> FUN_00319190 loads the status of every placement whose flags
  // (section-1 +0x40) have bit 3 and whose tag FUN_00376938 finds among the event actors (placements.json
  // load_flag_records / event_actors: 41-43 on z128); FUN_003159b8 sets status +0x60 bits 1 / 0x40. Then FUN_005453b0
  // calls vt+0x36c = FUN_00558f68 for each of the 256 object slots in order (object = record + 22); with +0x60 bit 0x40
  // and the actor inactive: +0x144(1, 1) (FUN_00559748 with event 3), bit 0x40 cleared, FUN_00558cc0 (the actor at its
  // status matrix = the placement here; FUN_003157b0's event-model matrix: see below), FUN_0034b4c8, then the tail:
  //   FUN_0056a790 (status +0x60 bit 2 clear: FUN_00344ec0 / FUN_00340680 only; not translated), C+0x1d8 = 0,
  //   C+0x564 |= 0x20000000 (the next clip's blend from FUN_00312678, playClip), C+0x1c0 |= 0x200;
  //   FUN_002419d8(0) (DAT_004b8ac8 bit 0) -> FUN_00347250 / FUN_00341518: GUESS skipped (the bit is 0 in the
  //   reload state's RAM; its writer is not decoded);
  //   actor +0x28 bit 2 (clear for these records: T w204_reload +0x28 = 0x20c403 / 0x208403): else branch:
  //   +0x118 bit 16 -> FUN_0055b8e0(a, 0, 0, 0); status +0x61 bit 0 -> (2, 1) (L: not exported, clear here: status
  //   +0x60 = 1); newly active: C+0x808 bit 0 or stance 0x2b / 0x2d -> (3, 1), else (2, 1). FUN_0034edf0(C, 0) (the
  //   body's mover off: a new body's mover is 0 already), +0x154 = 0, +0x118 &= ~0x40000, +0x150 bits 44-47 = 0.
  // T: w204_reload (from 0201's reload state): 41-43 active at record 10 (Vincent's placement frame), actor state 3,
  // HP 10 / 28 / 24, timer 1 = 80 / 0 / 150, 42 brain mode 1; 41 mode 2 at record 90.
  // At record 24 the game moves all three to the opening event's hand-off (worker 0205: FUN_00344d68 -> FUN_003157b0 ->
  // FUN_00558cc0 at their battle clips' end): checkpoint.js schedules it (scheduleHandOff, applied in tick step 3b).
  // Worker 0240: split in two. loadPass(recs) = FUN_005453b0's per-slot loop (above); stageLoad(recs) = the whole function
  // (the loop, then FUN_005459d8: event 0x23 to every object), which only battle()'s FUN_00324e70 calls (stage_controller.js
  // enterBattle -> play.js stagePass). T w240_act / w240_init: at the reload's record 10 the game runs NO FUN_005453b0 (no
  // 0x23 there): 41-43 and 45-49 are activated by their area switching on (FUN_0054ef68 -> vt+0x14c FUN_0055a0d8 ->
  // vt+0x144(1, 1)); play.js rebuildEnemies uses loadPass for 41-43 as the stand-in (GUESS row in notes/fidelity-audit.md).
  function stageLoad(recs) {
    // worker 0262: a lent object has +0x28 bit 0x40 (FUN_0056a5e0), so the loop reaches it: FUN_00558f68's tail, FUN_0056a790
    loadPass([...recs, ...actors.filter(a => a.C && (a.C.f564 & 0x80000000)).map(a => a.rec)]);
    event23();                                                                // worker 0235: FUN_005453b0's end
  }
  function loadPass(recs) {
    const order = [...new Set(recs)].sort((x, y) => x - y);                    // slot order (record + 22)
    // Only the loaded statuses get here: FUN_005453b0 calls vt+0x36c for an object with +0x28 bit 0x40 or status +0x60
    // bit 0. T: in the reload state the already-active 44 / 66 have neither (+0x28 0x208403, status +0x60 0), so the tail
    // does not touch them. An already-active loaded record (not on the page: the Restart's world is new) gets no +0x144,
    // FUN_00558cc0 and the tail's writes, and no state unless +0x118 bit 16.
    for (const k of order) {
      const t = objects.get(k + ID_BASE);
      if (!t) continue;
      const was = t.flags28 & 1;
      if (!was) setActive(t, 1, 1);                                             // +0x144 only when inactive (bVar1)
      const a = objects.get(k + ID_BASE);
      if (!a || a.kind !== 'actor' || !(a.flags28 & 1)) continue;
      a.C.f564 &= 0x7fffffff;                                                   // FUN_0056a790 -> FUN_00344ec0(C, 0)
      a.C.speed = 0;                                                            // C+0x1d8
      a.C.f564 |= 0x20000000;
      a.C.f1c0 |= 0x200;
      if (a.f118 & 0x10000) setActorState(a, 0, 0);
      else if (!was && ((a.C.f808 & 1) || a.C.st664 === 0x2b || a.C.st664 === 0x2d)) setActorState(a, 3, 1);
      else if (!was) setActorState(a, 2, 1);
      // FUN_0034edf0(C, 0): a running mover is stopped first (FUN_00352a60, not translated; a new body has none)
      if (a.C.mover !== 0) warnOnce(`enemy_ai: stage-load pass on record ${k} with a moving body (FUN_0034edf0(C, 0) -> FUN_00352a60) not translated`);
      a.f118 = (a.f118 & ~0x40000) >>> 0;
    }
  }
  // worker 0235: FUN_005459d8 (the end of FUN_005453b0 and of FUN_0053ca50): script event 0x23 to every object of the
  // manager's type lists (mgr +0x1108, types 0xc, 1, 2, 3, 8, 0xa, 0xf, 0x10, 0xb, 0xe, ... from DAT_0058b5c8). The z128
  // boss's script 242 sets its HP, the gauge and activates itself there. Worker 0237: list order = type order: 0xc the stage
  // object (STAGE_OBJ), 1 the actors (FUN_00558790: records / actors), 3 the triggers (FUN_00550228, vtable 0x58cdf8).
  // L: inside a list, id order (FUN_00580ed8's insertion not read); props / items (other types) get no event 0x23 here.
  function event23() {
    if (STAGE_OBJ) runEvent(STAGE_OBJ, 0x23);
    for (const o of [...objects.values()]) if (o.kind === 'record' || o.kind === 'actor') runEvent(o, 0x23);
    for (const o of triggers) runEvent(o, 0x23);
  }
  // Worker 0240: the stage init's pass, FUN_0053ca50(mgr, 1), the end of FUN_0053c140 (stage init FUN_003245e8, after the
  // stage object and the section objects are built). T w240_init (from start1704, a Restart's reload): FUN_003245e8 ->
  // FUN_0053c140 -> FUN_0053ca50(mgr, 1) -> FUN_005459d8, at manager clock +0x20 = 0, +0x24 = 0; 44 / 66's activation draws
  // (FUN_00360418) inside it. Order:
  //  1. objects FUN_0053bdb8(mgr, k) get +0x4e = k for k < FUN_00310b90(0x12) (FUN_00310c40() = 48 > 12): read only by the
  //     0x22 handlers' attach below, which never fires in z128: not kept.
  //  2. vt+0x2ec(o, 1) on every object of the lists DAT_0058b040 = types 0xc, 1, 2, 3, 8, 0xa, 0xf, 0x10, 0x13, 0xb, 0xe (the
  //     0x23 lists plus 0x13), list by list. vt+0x2ec = FUN_0054b110 (stage object 0x592600, type 8) or a wrapper that first
  //     attaches the object to FUN_0053bdb8(mgr, byte) when that byte != -1 (actors FUN_0055f028: status +0xa0 +0x4f;
  //     triggers / type 0xb / 0xe FUN_00551b18: +0xd4 +0xab; props FUN_00585a48: +0x10c +0x4e). Every such byte is 0xff in
  //     the reload state (216 actors, 195 triggers, 95 props), so each is FUN_0054b110 = script event 0x22 (vt+0x2f4).
  //     Script 0's 0x22 (flag 0 < 2): cmd 0x108 to 44 and 66 (worker 0237): their activation.
  //  3. FUN_0053cc00: FUN_0053ccc8 for each of DAT_004eeb30[0..2] that is 0: all three are 1 before and after (start1704,
  //     reload0), so nothing; mgr +0x2b0 bit 6 cleared (no reader on the page).
  //  4. FUN_005459d8: event 0x23 to every object (event23).
  // L: props / items (types 0xa / 0xf / 0x10 / 0x13) get neither event here (as event23); the player (type 2) has no script.
  // worker 0251: the area switch for actors. FUN_00547ce0 builds each section-1 record's actor and parents it to area
  // record +0x3e (FUN_0053b920 -> FUN_0054c550; Vincent and -1 get none: ai.json records[].area). An area that changes
  // state (FUN_0054ef68, areas.js onSwitch) calls vt+0x14c = FUN_0055a0d8(actor, on) on its children: unless status
  // +0x0c bit 5 is set (FUN_00315738(st, 5); records[].ov5) -> vt+0x144(on, 1) = FUN_00559748 (setActive with event 3);
  // with bit 5 only when actor +0x28 bit 1 is set. In z128 bit 5 clear = 10-14 (area 13), 41-43 / 45 (105), 46-49 (2),
  // 52-54 (0, the alley stairs), 62 / 63 (53; deleted at normal difficulty). T: route RAM r02_deckend / r02_climb (52-54
  // active, area 0 on) and r03_spot2 (46-49 off with area 2). A deleted record (no object) is skipped (FUN_0053e1e0
  // unlinked it). MISSING: the bit-5 actors' +0x28 bit 1 test (its writer is not decoded; the page's flags28 is not the
  // game's +0x28): they are left alone, as before (warned once).
  // FUN_005449f0 probe 6 (the camera, player.js probe6) on this world's objects: the box triggers (section 8 shape 3, class vt
  // 0x58fd90, FUN_0057c530 / FUN_0057c698: +0x38 |= 0x1db, bit 6 among them) and the barrels. FUN_00550da0 (vt+0x17c): the segment
  // into the box's frame (record +0x40 = t.inv), FUN_0025e400 from the far end (probe 6: no second try); -1 no hit; the hit
  // through record +0x00 (t.m); the face: 0 -row 0, 1 +row 0, 2 -row 1, 3 +row 1, 4 -row 2, 5 +row 2.
  // T route RAM r03_start / r06_tp / r0b_boss: slots 243-255 are on (+0x28 bit 0) exactly while their parent area (+0xa8: 13 / 16 / 27)
  // is; t.boxOn follows the area switch. Not modelled: FUN_0057c698(obj, 1)'s clearing of the bits (FUN_0057c7e8, a script's timed
  // state +0xe0: every box's is 0 in the route states). A box without an area (none in z128) stays off (no ai.json area either)
  const boxes = triggers.filter(o => o.t.shape === 3);
  function cameraObjects(a, b) {
    let best = null, bd = Infinity;
    for (const o of boxes) {
      if (!o.boxOn || !o.active || o.e0 === 1) continue;                      // FUN_0057c698(1): +0x38 &= 0xfe04, bit 6 off while open (T w257_door2 f440)
      const t = o.t, s = xform(t.inv, a), e = xform(t.inv, b);
      const c = clipSeg(e, s, t.lo, t.hi);
      if (c.face === -1) continue;
      const point = xform(t.m, c.p2), d = f(len3(sub3(a, point)));
      if (!(d < bd)) continue;
      const row = t.m[c.face >> 1].slice(0, 3);
      bd = d; best = { point, normal: c.face & 1 ? row : row.map(x => -x) };
    }
    const ph = opts.props && opts.props.cameraProbe ? opts.props.cameraProbe(a, b) : null;
    return ph && ph.d < bd ? ph : best;
  }
  // ✕ on a trigger (worker 0257). The map update's choice M+0x10ac: FUN_005513c8 (vt+0x154) for shapes 0 / 3 / 8: +0x40 bit 2, not opening or closing (vt+0xec, FUN_0057c688). Flags bit 4 with the origin in the box (FUN_005507a0): chosen,
  // +0xd0 as it was. Else flags bit 3: a ray of 7 along the facing hits the box: its first face (FUN_00550918), for shape 3 a z face (4, 5) only; it goes in +0xd0's bits 16-19. FUN_00544960: the lower +0x4f, then the nearer (FUN_0054a888).
  function gimmickChoose(origin, dir) {
    let best = null, bd = Infinity;
    for (const o of triggers) {
      const t = o.t;
      if (!o.active || !o.use || o.e0 === 2 || o.e0 === 3) continue;
      const s = xform(t.inv, origin);
      if (!((t.flags & 0x10) && inBox(s, t.lo, t.hi))) {
        if (!(t.flags & 8)) continue;
        const e = xform(t.inv, [origin[0] + dir[0] * 7, origin[1] + dir[1] * 7, origin[2] + dir[2] * 7]);
        const face = clipSeg(e, s, t.lo, t.hi).face;
        if (face === -1 || (t.shape === 3 && face !== 4 && face !== 5)) continue;
        o.face = face;
      }
      const d = len3(sub3(origin, t.m[3].slice(0, 3)));
      if (!best || o.f4f < best.f4f || (o.f4f === best.f4f && d <= bd)) { bd = d; best = o; }
    }
    return best ? { o: best, face: best.face } : null;
  }
  // FUN_00544200 -> vt+0x15c FUN_005516f0: event 0x11 with r0 = +0xd0's bits 16-19, signed
  function gimmickUse(c) { runEvent(c.o, 0x11, [c.face, 0]); }
  // MISSING: Vincent against door boxes (walk probe FUN_005451d0(mgr, 4, ..) -> FUN_00544bf0 -> FUN_0054c628, not translated; notes/fidelity-audit.md 'MISSING: door walls'): he passes shut doors
  warnOnce('enemy_ai: door walls not translated (FUN_005451d0 -> FUN_0054c628): Vincent passes shut doors');
  // FUN_005442d8 on a door box: +0x38 bit 0 (0x1db, not while open), solid (+0x28 bit 8 clear): vt+0x17c, vt+0x1b4 FUN_0057ca10 = event 0x12, FUN_0054ff50 (the hit's effect: not translated)
  function doorBullet(b) {
    let best = null;
    for (const o of boxes) {
      if (!o.boxOn || !o.active || o.e0 === 1 || o.shot) continue;
      const t = o.t, s = xform(t.inv, b.prev), e = xform(t.inv, b.pos), c = clipSeg(e, s, t.lo, t.hi);
      if (c.face === -1) continue;
      const point = xform(t.m, c.p2), dist = f(len3(sub3(b.prev, point)));
      if (!best || dist < best.dist) best = { o, point, dist };
    }
    return best;
  }
  function areaSwitch(k, on) {
    for (const o of boxes) if (o.t.area === k) o.boxOn = on;
    for (const rec of data.records) {
      if (rec.area !== k || rec.rec === 0) continue;
      const t = objects.get(rec.rec + ID_BASE);
      if (!t || (t.kind !== 'record' && t.kind !== 'actor')) continue;
      if (rec.ov5) { warnOnce('enemy_ai: area switch on a status-bit-5 actor (FUN_0055a0d8: actor +0x28 bit 1 not modelled): left alone'); continue; }
      setActive(t, on ? 1 : 0, 1);
    }
  }
  if (data.records.length && data.records.every(r => r.area === undefined)) warnOnce('enemy_ai: ai.json records have no area (re-export data/enemies): the actors\' area switch is off');

  function stageInit(send23 = true) {
    if (STAGE_OBJ) runEvent(STAGE_OBJ, 0x22);
    for (const o of [...objects.values()]) if (o.kind === 'record' || o.kind === 'actor') runEvent(o, 0x22);
    for (const o of triggers) runEvent(o, 0x22);
    if (send23) event23();
  }

  // the opening event's hand-off (checkpoint.js): [{ rec, frame (S.frame of the tick it happens in), pos, face }]
  const handOffs = [];
  function scheduleHandOff(list) {
    for (const h of list) {
      const a = actors.find(x => x.rec === h.rec);
      handOffs.push({ rec: h.rec, frame: h.frame, pos: h.pos.slice(), face: h.face.slice(), hp: a ? a.hp : null });
    }
  }

  // FUN_0053e868: for each listed object (head first; an entry appended meanwhile is reached too): each running timer
  // (> 0) loses (int) of the frame step DAT_0046e290+4; one that reaches <= 0 (as a short) posts manager event 0xd with
  // +0xc = the timer index. The entry goes when both timers are 0 (the int at +0x3c) or the object is gone.
  // T: w204_reload records 10-90 (record 41's timer 1: 80 at the placement, 0 at record 90, mode 2 there).
  function timerTick(step) {
    const dec = Math.trunc(step);
    for (let i = 0; i < timerList.length;) {
      const o = objects.get(timerList[i]);
      if (o && o.t3c) {
        for (let k = 0; k < 2; k++) {
          if (o.t3c[k] > 0) {
            const v = (o.t3c[k] & 0xffff) - dec;
            o.t3c[k] = v;                                                         // stored as a short
            if ((v << 16) < 1) postManager(0xd, o.id, k);                         // iVar3 * 0x10000 < 1
          }
        }
      }
      if (!o || !o.t3c || (o.t3c[0] | o.t3c[1]) === 0) timerList.splice(i, 1);
      else i++;
    }
  }

  // FUN_0053fde8: up to 0x1000 entries; one posted while draining is handled in the same pass. An entry
  // whose object is gone (FUN_0053e040) is dropped. Types translated: 7 (case 8: script event 3 with
  // zero args (0x4ef400, BSS), then +0x28 &= ~0x100000) and 8 (case 9: script event 4; then, if it is
  // the manager's +0x10ac object, FUN_0053be88(0): the page never sets +0x10ac, L). The other types (3-6
  // from cmds 0x12c-0x12f, ...) carry no consumer on the page yet: MISSING, warned.
  // FUN_0053e1e0(mgr, obj) (worker 0212; from cmd 0x10a): the object leaves the world. Translated: its script timers leave
  // the timer list (+0x3c running -> FUN_0053e7a8), its queued manager events of type != 0 go (+0x27 count ->
  // FUN_0053fcf8), its pending 0x101 messages go (+0x26 count -> FUN_0053ec98; L: the page's mailbox is the GUESS queue
  // of FUN_0053e9e0), an actor's AI / fire timer / mover / nav node and body go (as a deactivation: FUN_003497c8 via
  // vt+0x84), a trigger stops testing its volume, a gimmick goes (props.js `deleted`), the object is unlinked and its id
  // slot freed (the tail's 0xffff into manager +0x3b2 / +0x7b0 / +0x5b2: `freedIds`, so 0x3a / 0x3d / 0x3e give -1).
  // Child objects (+0xc list): each is detached into the world keeping its world matrix (FUN_0054b9b0(child, 0, 1, 1, 1))
  // and gets vt+0x2c4, which for the melee hit volumes (vtable 0x58f9f0 +0x2c4 = 0x54bf38) is an empty function: an
  // owner-following hit volume (FUN_00569dc0 links it with FUN_0054b9b0 / FUN_0054bf48 / FUN_0054bf90; c1 bit 3) stays
  // alive where it is and stops following; a once-placed one (FUN_0054b770) is no child.
  // L (not modelled on the page): FUN_00326130(1, +0x24), manager +0x18 and Vincent's lock (+0x272 -> FUN_00573378(P, -1)),
  // manager +0x10ac, other child kinds, FUN_0036e2c8.
  function destroyObject(o) {
    const id = o.id;
    const ti = timerList.indexOf(id); if (ti >= 0) timerList.splice(ti, 1);
    for (let i = mgrQueue.length - 1; i >= 0; i--) if (mgrQueue[i].id === id && mgrQueue[i].type !== 0) mgrQueue.splice(i, 1);
    for (let i = mailbox.length - 1; i >= 0; i--) if (mailbox[i].to === id) mailbox.splice(i, 1);
    for (let i = delayed.length - 1; i >= 0; i--) if (delayed[i].id === id) delayed.splice(i, 1);   // worker 0230 (L, as the mailbox)
    if (o.kind === 'actor') {
      const i = actors.indexOf(o); if (i >= 0) actors.splice(i, 1);
      if (G) NG.setNode(G, o, -1);
      if (o.C && o.C.mover !== 0) PM.stopAll(o, warnOnce);
      if (o.ai) { const j = S.q.indexOf(o.ai); if (j >= 0) S.q.splice(j, 1); stopFire(o.ai); }
      for (const h of attackObjs) if (h.owner === o && !h.fixed) h.fixed = attackCentre(h);   // no pose: warned, it keeps following (L)
      onDeactivate(data.records[o.rec]);
    } else if (o.kind === 'trigger') {
      // kept in `triggers` (trigObj(k) indexes it), off for good: no volume test; trigObj gives -1 (freedIds)
      o.active = false; o.deleted = true;
    } else if (o.kind === 'prop' && opts.props && opts.props.deleted) opts.props.deleted(o);
    else if (o.kind === 'item' && opts.items) opts.items.deleted(o);                // worker 0224
    if (o.kind !== 'stage') freedIds.add(id);
    objects.delete(id);
    events.push(`delete ${id}`);
  }

  // worker 0259: cmd 0x114's timed routine. FUN_0054ddf8: a running one (+0x44 != -1) loses its pending code -4 (FUN_0053edb0) and gets
  // script event 0x1c; +0x42 = script, +0x44 = function index, +0x46 = 0, +0x48 = manager clock; index != -1 -> first step.
  function routineStart(o, script, fn) {
    if ((o.s44 ?? -1) !== -1) { delayedDrop(o.id, -4); runEvent(o, 0x1c); }
    o.s42 = script; o.s44 = fn; o.s46 = 0; o.f48 = S.mgr20;
    if (fn !== -1) routineStep(o);
  }
  // FUN_0054dec0: function +0x44 of script +0x42 (FUN_003714b0 -> FUN_00371490: ai.json script_fns) runs with r0 = step +0x46. Its result (a
  // float chopped) is the next step's clock from the start; < 1 ends it (event 0x1b, +0x46 = 0, +0x44 = -1), except 0 at step 0, which goes on.
  // Next: +0x46 + 1, code -4 due at +0x48 + result (FUN_0053e9e0).
  function routineStep(o) {
    if ((o.s42 ?? -1) === -1 || (o.s44 ?? -1) === -1) return;
    const fns = data.script_fns && data.script_fns[String(o.s42)], fn = fns && fns[String(o.s44)];
    if (!fn) {
      if (!data.script_fns) warnOnce('enemy_ai: ai.json has no script_fns (rebuild data/enemies): cmd 0x114 routines off');
      else warnOnce(`enemy_ai: script ${o.s42} has no function ${o.s44}`);
      o.s44 = -1; return;
    }
    const res = Math.trunc(+runEvent(o, `fn${o.s44}`, [o.s46 | 0, 0, -1, -1], fn) || 0);
    if (res < 1 && !((o.s46 | 0) === 0 && res === 0)) { runEvent(o, 0x1b); o.s46 = 0; o.s44 = -1; return; }
    o.s46 = (o.s46 | 0) + 1;
    delayedPost(o.id, -4, short(o.f48 + res - S.mgr20));
  }
  function drainManager() {
    for (let n = 0; mgrQueue.length && n < 0x1000; n++) {
      const e = mgrQueue.shift();
      // worker 0243: Vincent (PLAYER_OBJ, not in `objects`) for requests 0x1c (the item use) and 5 (the heal)
      const o = objects.get(e.id) ?? (PLAYER_OBJ && e.id === PLAYER_OBJ.id && (e.type === 0x1c || e.type === 5) ? PLAYER_OBJ : null);
      if (!o) continue;
      if (e.type === 7) { runEvent(o, 3); objects.get(e.id).flags28 &= ~0x100000; }
      else if (e.type === 8) runEvent(o, 4);
      else if (e.type === 0xd) runEvent(o, 1, [e.arg, 0]);                     // case 0xe: event 1 (timer index, 0) (FUN_0053e868)
      else if (e.type === 10) {                                                // case 0xb: vt+0x28c FUN_0057c728 (worker 0257): state 2, event 0x50, code -5 after the delay
        if (o.e0 === 3) delayedDrop(o.id, -6);
        if (o.e0 === 0 || o.e0 === 3) { o.e0 = 2; runEvent(o, 0x50); delayedPost(o.id, -5, Math.max(e.arg | 0, 0)); }
      } else if (e.type === 0xb) {                                             // case 0xc: vt+0x29c FUN_0057c850: state 3, event 0x52, code -6 after the delay
        if (o.e0 === 2) delayedDrop(o.id, -5);
        if (o.e0 === 1 || o.e0 === 2) { o.e0 = 3; runEvent(o, 0x52); delayedPost(o.id, -6, Math.max(e.arg | 0, 0)); }
      }
      else if (e.type === 0xf) runEvent(o, 0x13);                              // case 0x10: event 0x13, no args (0x4ef400)
      else if (e.type === 0x10) runEvent(o, 0x14, [e.arg, 0]);                 // case 0x11: event 0x14 (path node, 0) (worker 0228)
      else if (e.type === 0x11) runEvent(o, 0x26);                             // case 0x12: event 0x26, no args (the node is dropped)
      else if (e.type === 0x12) runEvent(o, 0x27, [e.arg, 0]);                 // case 0x13: event 0x27 (node, 0)
      else if (e.type === 6) runEvent(o, 0x21);                                // case 7: event 0x21, no args (cmd 0x14a; worker 0212)
      // case 10 (type 9, worker 0230; posted by FUN_0053f040 code -10, the corpse): vt+0x144(o, 0, 1) (FUN_00559748 off), the
      // object's matrix set upright from its own (FUN_0054a5e8 -> FUN_0054b238; nothing draws it once off), script event 0x20, no
      // args; then, when the status +0x60 has bit 0x40000, the object is freed (FUN_0053e1e0, FUN_00318ea0). L: +0x60 = 0 on z128's
      // actors (notes/enemy-ai-hook.md 'Other types'), so that branch is warned.
      // case 0x17 (type 0x16, cmd 0x113's period; worker 0230): vt+0x22c FUN_0054cca8 = script event 0x18, result != 0 -> +0x36 = 0;
      // else +0x36 > 0 -> code -2 again at +0x36 (after dropping a pending one), else +0x36 = 0
      else if (e.type === 2) routineStart(o, e.arg.script, e.arg.fn);          // worker 0259: FUN_0053fde8 case 3: FUN_0054ddf8
      else if (e.type === 0x17) routineStep(o);                                 // worker 0259: case 0x18: FUN_0054dec0
      else if (e.type === 0x16) {
        const res = runEvent(o, 0x18);
        if (!res && (o.s36 | 0) > 0) { delayedDrop(o.id, -2); delayedPost(o.id, -2, o.s36); }
        else o.s36 = 0;
      }
      else if (e.type === 9) {
        setActive(o, 0, 1);
        const q = objects.get(e.id);
        if (q) runEvent(q, 0x20);
      }
      // case 1 (cmd 0x10a's FUN_0053fa08; worker 0212): the key (+0x4c << 16 | id) still matches -> FUN_0053e1e0. The page
      // never re-creates an object under the same id, so the id alone is the key.
      else if (e.type === 0) destroyObject(o);
      // worker 0243: case 0x1d (FUN_00573db0's request 0x1c): FUN_00573eb0(o, +0xc = the slot); case 6 (cmd 0x12d / 0x12e's
      // request 5): vt+0x1f4(o, +0xc) = FUN_0055c910 for Vincent (items.js heal). An actor's request 5 is not translated (warned).
      else if (e.type === 0x1c && opts.items && opts.items.useSlot) opts.items.useSlot(o, e.arg);
      else if (e.type === 5 && o.kind === 'player' && opts.items && opts.items.heal) opts.items.heal(e.arg);
      else warnOnce(`enemy_ai: manager event ${e.type} (FUN_0053fde8 case ${e.type + 1}) not translated`);
    }
  }

  // worker 0235: what boss_io.js needs of this world (the boss brain's engine calls)
  function bossGauge(id, v, max, fl) {                                       // FUN_003b58e0, as manager 0x6e
    if ((id >>> 0) < 0x12) Object.assign(hudGauge, { id: id | 0, v: v | 0, max: max | 0, f: fl | 0 });
    if (opts.hudGauge) opts.hudGauge(0x6e, hudGauge);
  }
  const bossEnv = { S, P, data, warn: m => warnOnce(m), rng: () => rng(), DIFF, mshort, MOVE_DT: PM.MOVE_DT,
    sound: (n, p, r) => sound(n, p, r), effect: (id, p) => { if (opts.effect && opts.effect.spawn) opts.effect.spawn(id, p); },
    setMotion, motionDone, motionPast, setMode, setTarget, setTurn: (a, m) => PM.setTurn(a, m), stopAll: a => PM.stopAll(a, warnOnce),
    busy, dead, enemyDeath, shootMarker, spawnShot, markerWorld, bossVolume, bullets, gauge: bossGauge };
  // boneWorld: (actor) => (bone) => world rows of that bone (the MP's last posed skeleton), set by the
  // page (enemies.js partPose) or a test; the part test needs it. playerShot(muzzle, aim, W): Vincent
  // fired, now; queueShot: the same at this frame's player slot inside the next tick (the page).
  // postManager: worker 0243 (FUN_0053fbe8: items.js posts the item use's request 0x1c)
  const world = { walkBody, airBody, bodyOf, action2,   // worker 0269: the body step and action layer 2 (tests: the object pass and its bits)
                  bulletMatrix, deadBits, S, actors, triggers, bullets, attackObjs, objects, addActor, tick, runEvent, postManager, delayedPost, delayedDrop, recById, events, activated, setActive, stageLoad, scheduleHandOff, handOffs, delayed,
                  event23,                                // worker 0235: FUN_005459d8 (script event 0x23 to every object)
                  setTargetOf: setTarget, aimPointOf: aimPoint, shotOf: shot, stageInit, loadPass, areaSwitch, cameraObjects, gimmickChoose, gimmickUse, doorBullet, triggers, mshort,                    // worker 0240: FUN_0053ca50(mgr, 1) (0x22 then 0x23); FUN_005453b0's loop alone
                  stageObj: STAGE_OBJ,                    // worker 0237: the stage object (type 0xc, script 0 on z128)
                  timerList,                              // script-timer list (FUN_0053e6e8; tests)
                  playerShot, queueShot, lockTargets, pushOut, boneWorld: opts.boneWorld || null,
                  eventFlags: EVFLAGS,
                  // manager +0x260 (cmds 0x40 / 0x10f write, 0x10e and props.js 0x2a / 0x2b / 4 read; worker 0212)
                  get mgr260() { return mgr260; }, set mgr260(v) { mgr260 = v; },
                  hudGauge: () => hudGauge,               // worker 0231: manager 0x6e / 0x6f / 0x70
                  get bossPlugin() { return bossPlugin; }, setBossPlugin: on => { bossPlugin = !!on; },   // FUN_00aa30c8 (Zone.boss)
                  playerObj: PLAYER_OBJ,                  // Vincent's script object (worker 0224: items.js runs his event 0x3a)
                  postManager,                            // FUN_0053fbe8 (props.js: cmd 0x14a's event 6)                    // the world's event flags (FUN_003ff738; tests: checkpoint.js)
                  playerBoneWorld: opts.playerBoneWorld || null,
                  attackPick: a => attackPick(a.ai),     // FUN_0035ff98 on an actor's AI (tests)
                  // single translated functions, for the tests' direct state checks
                  stageRec, t: { stopAll: a => PM.stopAll(a, warnOnce), setMotion, motionUpdate, locoFrame, brain3, specialAttack, nodeOffTarget, attackPick, localAngles, sectorTest, sectorBoxR, brain5, brain6, stateMotion, setActorState, bulletEnd, target, send, setMode, setTarget, setActionLayer, action2, action3, action56, flinch, die, navOf,
                       makeAttack, attackObjUpdate, attackCentre, sphereCapsule, offence,
                       spreadAim, roomProbe, enemyBulletHit, playerPartTest, targetPoint, damagePlayer, attackDamagePlayer, playerCandidate,
                       endEffect, bulletUpdate, hitEnemy, react, enemyHP, setActorState, playerHandler, attackApply, spawnShot, setMotion, playClip,
                       shootMarker, markerWorld, homingStep, bossVolume, motion1 },             // worker 0235
                  // worker 0209: the explosion on a character (props.js), Vincent's object, the twister, the sound hook
                  blast: { filter: blastFilter, actor: blastActor, player: blastPlayer }, player: P, dead, rng, sound: (n, p, r) => sound(n, p, r), seName, roomRay: opts.roomRay || null,
                  difficulty: DIFF, warnOnce: m => warnOnce(m) };
  // the section-15 gimmicks join this world's objects (props.js attach; again for the Restart's new world)
  if (opts.chunkAnims) opts.chunkAnims.reset();                              // worker 0257: the stage reload: the nodes back in their files, list empty
  if (opts.props) opts.props.attach(world);
  if (opts.items) opts.items.attach(world);                // worker 0224: the item pickups (items.js)
  return world;
}
