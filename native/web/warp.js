// warp.js -- PAGE AID, not game behaviour (worker 0249): play.html?warp=<name> puts Vincent at a later place in z128 so a
// review can reach it without playing there. Off unless the URL asks for it; ?warp=list prints the names. The game has no
// warp: it reaches these places by walking, and its stage program sets the flags on the way. The aid sets those flags
// itself, then runs the game's own code from there:
//   1. the story flags main's beats test at that place (the stage flags = enemy_ai eventFlags, FUN_003ff738 / FUN_003ff658;
//      the global flags DAT_0050db20, FUN_0037cea0 / FUN_0037ce60). main (stage_controller.js) is waiting in a battle()
//      poll and falls through its beat chain to the one these flags select, as it does in the game.
//   2. the chunk pair through area_stream.js request (FUN_002677a0), as an area box does when he walks in (boss: main's own
//      Zone.load(128, 10, 11) in its boss block).
//   3. Vincent on the walk polygon under the spot (player.js reset + locate: the walk-mesh search) and the follow camera
//      reset behind him (FollowCamera.reset, FUN_003285d0's angles from his facing; GUESS for a warp, as the ?ladder= aid).
//
// Where the flags come from: ev0100 main's beat guards (each beat runs when stage flag 0 == X and global flag 1 < Y, then
// sets global flag 1 = Y; disassembled from data/event/ev0100_stage.json, notes/stage-controller.md 'Beats and the warp
// aid'), the stage scripts' cmd 0xb writes on the trigger volumes (tools/stage_events.py --cmds 0xb / --triggers), and the
// route save states (notes/route-states.md). Spots are walk-polygon points of the page's DCOL in the named chunk (polygon
// +4 >> 16 = the chunk file).
// Not replayed: every other flag write on the way (triggers already fired, the soldiers killed, items taken) and the
// events between the start and the place; see notes/fidelity-audit.md 'PAGE AID: ?warp='.

export const WARPS = {
  // the save's own spot and flags (sea-of-flames.p2s: stage flags all 0, global {0: 1, 1: 3}); a respawn without HP / HUD reset
  deck: { spawn: true, pair: [1, 2], note: 'start deck (the save)' },
  // route state r02_climb (worker 0221, walked in the game): the foot of the brick-alley stairs, chunk 02, stage flags
  // {2: 8, 46: 1, 47: 1} read from its RAM; the area box there holds (1, 2). Faces the steps (picked by eye against the
  // route state's frame r02_climb.png; its facing is not in the state's metadata); trigger 15 at the top (script 88) sets
  // stage flag 0 = 2 -> rv_matiawase
  stairs: { pos: [-860.1, -142.1, -607.1], face: [1, 1], pair: [1, 2], stage: { 2: 8, 46: 1, 47: 1 }, note: 'chunk 02, foot of the alley stairs' },
  // worker 0252: chunk 03 at route state r03_spot2's spot (Dan's 2026-11-03 report position; stage flags from its RAM),
  // pair (2, 3), facing -z (the report's view, toward dog 65 at z -884); trigger 63 (-1347.9, 2.7, -599.6) is not crossed
  dogs: { pos: [-1507.3, -0.06, -573.5], face: [0, -1], pair: [2, 3], stage: { 2: 8, 46: 1, 47: 1 }, note: 'chunk 03 market, Dan\'s report spot (dog 65 south)' },
  // chunk 06 at route state r06_tp's spot (-1328.1, *, 1205.5) (area box (6, 8)). Story: after rv_toujou (main sets global
  // flag 1 = 25 at pc 7187 with stage flag 0 = 24, then scene_save(4)); the next block (pc 8296: global 1 < 29, stage 0
  // < 36) is the market's townspeople beats on stage flag 1 (28 / 29 / 30 / 32 from triggers 33 / 64 / 65 / 26)
  market: { pos: [-1328.1, 0, 1205.5], face: [1, 0], pair: [6, 8], stage: { 0: 24 }, global: { 1: 25 }, note: 'chunk 06 market, townspeople beats' },
  // worker 0265 (fidelity fix, 2026-11-09): the three cutscene warps copy a walked route state's stage and global flags WHOLE (`whole`:
  // both tables cleared first, then the state's RAM values; tools/trace/out/*/NAME.json 'flags' / 'gflags'). Nothing hand-picked
  // except the rows marked GUESS below (notes/fidelity-audit.md 'PAGE AID: ?warp= cutscene places').
  // helpme: route state r05_pre59 (worker 0265: r04_east + the first 2030 frames of w217_r05_west's pad replay, walked; trigger 59
  // fires between f2030 and f2040 of that walk). Spot inside trigger 59, pair (4, 5); then trigger 59's event 0xd as walking in
  // (script 17: soldiers 19-21 and n_helpMe up, stage flag 1 = 8): main plays help_people01
  helpme: { cutscene: true, pos: [-1415.8, 0, 697.6], face: [0, 1], pair: [4, 5], trigger: 59, whole: true, state: 'r05_pre59',
            stage: { 0: 11, 1: 13, 2: 4, 15: 1, 26: 1, 43: 1, 44: 1, 45: 1, 46: 1, 47: 1, 63: 1 }, global: { 0: 1, 1: 8, 55: 4, 56: 7, 58: 1 },
            note: 'chunk 05, trigger 59: help_people01' },
  // citizens: route state r05_back (walked, chunk 05 after the second gate), pair (4, 5). Once the pair is in, trigger 58's event 0xd as
  // walking in wakes the townspeople (script 31). No walked state has them saved (no route state has stage flag 1 = 12), so `late` is
  // hand-set: GUESS: stage flag 1 = 12 (script 47 event 0x17's write when they are saved; that fight is not replayed) and 39 / 40 / 41 = 1
  // (one per townsperson saved: retail main plays help_orei02 only with one set, pc 4175-4217; all three = its debug branch, pc 4128-4155).
  // main then plays help_orei02 (beat 12, 18 < 1) with them lent
  citizens: { cutscene: true, pos: [-1940, 0, 330], face: [0, -1], pair: [4, 5], trigger: 58, whole: true, state: 'r05_back',
              late: { stage: { 1: 12, 39: 1, 40: 1, 41: 1 } },
              stage: { 0: 12, 1: 8, 2: 4, 15: 1, 16: 1, 26: 1, 43: 1, 44: 1, 45: 1, 46: 1, 47: 1, 63: 5 },
              global: { 0: 1, 1: 12, 30: 1, 55: 4, 56: 7, 58: 1 }, note: 'chunk 05, the townspeople: help_orei02' },
  // heli: route state w261_preheri (walked; Dragonfly just beaten, script 29: stage flag 0 = 16, global 1 = 13), at its spot, pair (6, 7)
  // as main's heri_taijou loads: main goes to heri_taijou, then sk_mituketa2
  heli: { cutscene: true, pos: [-1582.9, 0, 1359.1], face: [0, 1], pair: [6, 7], whole: true, state: 'w261_preheri',
          stage: { 0: 16, 1: 8, 2: 1, 15: 1, 16: 1, 26: 1, 42: 1, 43: 1, 44: 1, 45: 1, 46: 1, 47: 1, 50: 1, 63: 1 },
          global: { 0: 1, 1: 13, 30: 1, 55: 1, 56: 7, 58: 2 }, note: 'chunk 06, Dragonfly beaten: heri_taijou, sk_mituketa2' },
  // chunk 07 (walk polygons x -1949..-1740), pair (6, 7) = main's Zone.load(128, 6, 7) after sk_mituketa2 (pc 6412).
  // Story: sk_mituketa2 done (global 1 = 20 at pc 6630, stage 0 = 18 from pc 5939); main waits for stage 0 >= 20, which
  // trigger 18 (-1948.8, -44, 1594.2; script 102) sets: he faces it
  chunk07: { pos: [-1798.3, 0, 1575.2], face: [-1, 0], pair: [6, 7], stage: { 0: 18 }, global: { 1: 20 }, note: 'chunk 07, before first_encounter' },
  // worker 0263: ev0141's events, at the flags main tests. first_encounter: global 1 = 21, stage 0 = 20 (trigger 18 sets it; pc 6743 / 6804). rv_toujou: stage 0 = 24, global 1 = 22
  // (first_encounter's pc 6893; e036's death sets the flag). wro_kaisetu: stage 1 = 32 (trigger 26), global 1 = 25, on r06_back's walk (-1039, 0, 956) (pc 10041)
  encounter: { cutscene: true, pos: [-1948.8, -44, 1594.2], face: [-1, 0], pair: [6, 7], stage: { 0: 20 }, global: { 1: 21 }, note: 'chunk 07, first_encounter' },
  toujou: { cutscene: true, pos: [-1753, -44, 1571], face: [-1, 0], pair: [6, 7], stage: { 0: 24 }, global: { 1: 22 }, note: 'chunk 07, e036 beaten: rv_toujou' },
  wro: { cutscene: true, pos: [-1039, 0, 956], face: [1, 0], pair: [6, 8], stage: { 0: 24, 1: 32 }, global: { 1: 25 }, note: 'market, WRO officer: wro_kaisetu' },
  // chunk 09 near the fire-glow wall (22, -40, 797) (worker 0213's fix), pair (8, 9) (area boxes 5 / 7). Story: the market
  // beats done (wro_kaisetu: stage 1 == 32, then global 1 = 26 at pc 10276); main waits for stage 0 == 36 (pc 10482)
  chunk09: { pos: [-8.3, -40, 779.2], face: [30.3, 17.8], pair: [8, 9], stage: { 0: 24, 1: 32 }, global: { 1: 26 }, note: 'chunk 09, the fire-glow wall' },
  // chunk 0b (file 11) before trigger 29 (415.2, -95.2, 1458.1; script 35: stage flag 0 = 36 -> main's boss beat through
  // its normal path), pair (9, 11) (area boxes 6 / 9 / 20 / 25). Same story flags as chunk09
  chunk0b: { pos: [303.1, -100, 1467.8], face: [1, 0], pair: [9, 11], stage: { 0: 24, 1: 32 }, global: { 1: 26 }, note: 'chunk 0b, before the boss trigger' },
  // worker 0262, cutscene places (`cutscene`: not in test_warp_page; test_heri_kita_page plays from them). Spots and flags from the route states' RAM:
  // r06_door2's flags, the market side of trigger 14 (script 87, -1330, 0, 1155; box z 1140..1170): its event activates Dragonfly, stage flag 0 = 13, scene_save(2), heri_toujou
  heritoujou: { pos: [-1330, 0, 1180], face: [0, -1], pair: [5, 6], stage: { 0: 12, 1: 8, 2: 1, 15: 1, 16: 1, 26: 1, 42: 1, 43: 1, 44: 1, 45: 1, 46: 1, 47: 1, 50: 1, 63: 1 }, global: { 0: 1, 1: 12, 30: 1, 55: 1, 56: 7, 58: 2 }, cutscene: true, note: 'chunk 06, before trigger 14: heri_toujou' },
  // r06_heli's spot and flags: stage flag 0 = 13, the market; heri_dgsol comes on flag 0 = 14 (script 29 event 0x16's last leg)
  heridgsol: { pos: [-1579, 0, 1240], face: [0, 1], pair: [6, 7], stage: { 0: 13, 1: 8, 2: 1, 15: 1, 16: 1, 26: 1, 42: 1, 43: 1, 44: 1, 45: 1, 46: 1, 47: 1, 50: 1, 63: 1 }, global: { 0: 1, 1: 13, 30: 1, 55: 1, 56: 7, 58: 2 }, cutscene: true, note: 'chunk 06 market, before heri_dgsol' },
  // the boss's death (event 0x17: stage flag 0 = 40; global 1 = 29 from main's boss block): heri_lasted, kita_ev0145, the results
  herilasted: { pos: [588.7, -100, 1456.5], face: [1, 0], pair: [10, 11], stage: { 0: 40, 1: 32, 2: 3, 15: 1, 16: 1, 26: 1, 27: 1, 30: 1, 42: 1, 43: 1, 44: 1, 45: 1, 46: 1, 47: 1, 49: 1, 50: 1, 62: 2, 63: 13 }, global: { 0: 1, 1: 29, 30: 1, 55: 3, 56: 7, 58: 3, 59: 4 }, cutscene: true, note: 'chunk 0b arena, boss dead: heri_lasted, kita_ev0145' },
  // the boss: stage flag 0 = 36 + global flag 19 = 1 (worker 0231's recipe, as test_boss_page): main takes its boss block's
  // restart path (Zone.load(128, 10, 11), Zone.boss(true), battle()). In the game that path leaves Vincent where he was
  // (T w235_move: pinned at the save's spot), so the aid puts him in the arena (chunk 0b, file 11), facing btbox5. On the page
  // main's battle() hand-back (stage_controller.js, worker 0229's FUN_003157b0) then moves him to (588.7, -100, 1456.5);
  // that is main's doing, not the aid's (open: does the game's hand-back do the same here? T w235_move says no)
  boss: { pos: [505.8, -100, 1397.4], face: [94.2, -97.4], pair: null, stage: { 0: 36 }, global: { 19: 1 }, note: 'chunk 0b arena, the boss fight' },
};

export const WARP_NAMES = Object.keys(WARPS);
export const warpHelp = () => `?warp=list|${WARP_NAMES.join('|')} (page aid)`;

// the URL's request: null (off), 'list', or a WARPS entry name (an unknown name warns and is off)
export function warpRequest(params) {
  if (!params || !params.has('warp')) return null;
  const v = params.get('warp');
  if (v === 'list') { console.info('warp (page aid): ' + WARP_NAMES.map(n => `${n} = ${WARPS[n].note}`).join('; ')); return 'list'; }
  if (!Object.hasOwn(WARPS, v)) { console.warn(`warp (page aid): unknown place '${v}'; names: ${WARP_NAMES.join(', ')}`); return null; }
  return v;
}

// apply WARPS[name] once. sys: { ctrl, follow, stream, flags (enemy_ai eventFlags), gflags (stage controller globalFlags),
// cape, trigger(idx): fire that trigger's event 0xd (enemy_ai) }
export function applyWarp(name, sys) {
  const w = WARPS[name];
  if (!w) return false;
  // 1. the flags (main reads them at its next poll); w.whole: a route state's tables, every flag it doesn't list is 0 in its RAM
  if (w.whole) for (const t of [sys.flags, sys.gflags]) if (t) for (const k of Object.keys(t)) t[k] = 0;   // a plain object / a Uint8Array
  if (sys.flags) for (const [k, v] of Object.entries(w.stage || {})) sys.flags[k] = v;
  else if (w.stage) console.warn('warp (page aid): no enemy_ai world; the stage flags are not set');
  if (sys.gflags) for (const [k, v] of Object.entries(w.global || {})) sys.gflags[k] = v;
  else if (w.global) console.warn('warp (page aid): no stage controller; the global flags are not set');
  // 2. the chunk pair (FUN_002677a0); the slots load on the stream's next frames (area_stream.js progress)
  if (w.pair && sys.stream) sys.stream.request(w.pair[0], w.pair[1]);
  // 3. Vincent: the clean on-foot state of a respawn, then the spot and the walk-mesh search (on the floor)
  const c = sys.ctrl;
  c.reset();
  if (sys.follow.clearDeath) sys.follow.clearDeath();    // as checkpoint.js's respawn: FUN_00328368's death bits
  if (!w.spawn) {
    c.pos = { x: w.pos[0], y: w.pos[1], z: w.pos[2] };
    c.heading = Math.atan2(w.face[0], w.face[1]);
    c.C.face = { x: Math.sin(c.heading), y: 0, z: Math.cos(c.heading) };
    c.locate();
    c.prev = { ...c.pos }; c.prevHeading = c.heading;
  }
  if (sys.cape) sys.cape.cloth.started = false;          // cloth.js restarts from the new pose
  // the camera behind him: the view's forward = his facing (GUESS: a warp's camera, not the game's; see the header)
  // yaw = FUN_00260f54's (player.js dirAngles) of his facing; the pitch is kept, as the ?ladder= warp keeps it
  sys.follow.reset(c.pos, { yaw: Math.atan2(c.C.face.x, c.C.face.z), pitch: sys.follow.pitch });
  return true;
}

// worker 0265: once the warp's chunk pair has loaded (play.js: the stream idle with both in; walking in, the chunks are always there
// first, and their statuses wake with them): w.trigger's event 0xd, as walking into it (enemy_ai's trigger test fires 0xd on entry: a
// warp lands inside and does not move, so it would never fire), then w.late's flags (hand-set: GUESS rows above).
// GUESS: the entry face argument 0 (segBox's; not checked whether scripts 17 / 31 read it; test_scr005_page fires them the same way).
// PAGE AID (no game counterpart): when it runs. play.js waits 2 page ticks after the warp and then for the stream idle with both of the
// pair's chunks in a slot; walking in, the game has the pair loaded (the area box requests it) before he reaches the trigger
export function applyWarpLate(name, sys) {
  const w = WARPS[name];
  if (!w) return;
  if (w.trigger != null) { if (sys.trigger) sys.trigger(w.trigger); else console.warn('warp (page aid): no enemy_ai: trigger ' + w.trigger + ' not fired'); }
  if (w.late && sys.flags) for (const [k, v] of Object.entries(w.late.stage || {})) sys.flags[k] = v;
}
export function warpPair(name) { const w = WARPS[name]; return w && w.pair ? w.pair : null; }
