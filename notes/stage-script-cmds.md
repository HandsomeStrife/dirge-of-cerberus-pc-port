# Stage-script commands the page skipped (worker 0212, 2026-11-03)

Item P1 of notes/first-level-plan.md. The stage scripts (06800001 section 2/3, VM FUN_00371318, `send` = op 38 ->
FUN_00370b40) send commands < 0x100 to the object manager FUN_00545b20 (whatever the target) and the rest to the
target's class handler (e027 / records FUN_005661e8 -> default FUN_00588b78 -> default FUN_0054cd70; triggers
FUN_0054cd70). List every send of a command: `python3 -I tools/stage_events.py extract/_KEL/noPath/06800001.bin --cmds 0xb`.

## Translated (enemy_ai.js `send`, `drainManager`, `destroyObject`)

- **Manager 0xb, event-flag write.** FUN_00545b20 case 0xb: if the player object (FUN_00318c98) is not dead for good
  (FUN_00316d08: status HP 0 and +0x64 bits 4 / 8 clear), FUN_003ff658(DAT_0047dbb0, r0, (byte) r1). FUN_003ff658:
  r0 < 0x40 -> block +0x38 + r0 = r1 XOR DAT_0047dbf0[r0] (FUN_003ff738 reads it back XOR the same key, so the page
  keeps plain values). Its mode-0x11 branch (FUN_002419d8(0x11) = DAT_004b8ac8 bit 17, flag 10, value != 0:
  FUN_00325b10(1) -> FUN_00326018(6), then skipped while FUN_00323578 = the player dead for good) is not translated:
  no z128 script writes flag 10. The world now keeps its own copy of the flags (`opts.eventFlags` is not written).
  Argument order in the scripts: the first push is the flag, the second the value (`push_i 1 ; push_i 10` = flag 1 = 10).
- **0x10a, delete.** FUN_0054cd70 case 0x10a: vt+0x54 (actors 0x58e24c = FUN_0054e908, returns 0; triggers
  FUN_00550380) -> FUN_0054add0(obj, 1) = manager event 0x18 -> script event 0x54, only if the script has event 0x54
  (FUN_0054e7c8): none of z128's 298 scripts has one. Then FUN_0053fa08(mgr, id): +0x28 bit 0x80000 set already ->
  nothing; else set it and queue manager event 0 with the key (+0x4c << 16 | id). FUN_0053fde8 case 1: key still
  matches -> FUN_0053e1e0: timers off the list (FUN_0053e7a8), +0x26 pending messages (FUN_0053ec98), +0x27 queued
  manager events of type != 0 (FUN_0053fcf8), manager +0x18 / the player's lock +0x272 (FUN_00573378) / +0x10ac,
  child objects (vt+0x2c4), the body (vt+0xdc / vt+0x84 -> FUN_003497c8), unlink, FUN_0036e2c8. The page does the
  timers, queue, mailbox, actor (AI, fire timer, mover, nav node, body via onDeactivate), trigger and unlink parts.
- **0x40 / 0x10e, move to a locator.** FUN_00545b20 case 0x40: FUN_0053c088(mgr, m, r0): FUN_003113f8(r0) = stage
  section 16 record r0 (stride +8; z128: 37 x 0x50: a 4x4 matrix, +0x41 parent object, all -1); no parent -> copy;
  found -> FUN_0053d960(mgr, m row 3): manager +0x230 = identity, +0x260 = the position (w 1). FUN_0054cd70 case 0x10e:
  FUN_0054cd18 (+0x40 bit 0 off; manager +0x10ac -> 0 if this object), FUN_0054b1d8(obj, mgr + 0x260): +0x90 =
  FUN_0054a698 (no parent: identity) x the point, vt+0x234(obj, 1, 0); +0x28 |= 0x8000. Also 0x10f writes +0x260 from
  the object; 0x13b / 0x13e (FUN_00588b78) read it. ai.json `locators` (export_web_triggers.py `locators`).
- **0x14a, revive.** FUN_005661e8 case 0x14a: status -> FUN_00316948(status, 1): HP (+0x20) = max (+4);
  vt+0x33c(a, 0) = FUN_0055cff8 (0x58e534); manager event 6 -> FUN_0053fde8 case 7 = script event 0x21 (no args).
  Scripts revive a dead record then send it 0x108 (51 / 55 / 289 / 161-164 / 190): the respawns.
  FUN_0055cff8 on a record not yet active: no AI (+0x184 0), +0x28 bit 1 cleared, FUN_0055b8e0(a, 2, 1, 0) unless
  +0x118 bit 0x10000, FUN_005aad08 (the MP), FUN_0031e060(+0x100, 1), vt+0x344. On an active actor (FUN_0035f268 on
  its AI, actor state 2, the MP reset) it is not translated (warned, skipped).
- **0x133** (FUN_00588b78): body -> FUN_003533e0 (path_mover.js stopAll). **0x155**: body -> FUN_0034b978: C+0x1d4 =
  r0 as a float (asm 0x588e7c: `lwc1 $f12, 0x10($s2)`; the scripts push floats 50-72).
- **Manager 6, area sound.** FUN_00545b20 case 6: r0 (a data-block name) == 0 -> nothing; else FUN_003e6c88(r0, r1) =
  the area sound (playBgAreaSound's path; music.js AreaSound), then FUN_003e8708(DAT_0047d718, r2) -> FUN_003e85a8(0x15,
  r2 < 0 ? 0x14 : r2) when it changed (IOP request 0x15: not decoded, warned). Scripts 0-6 (trigger events 0xd):
  r1 255, r2 20 / 30 / 35.

## Evidence

- T: **w212_flag95** (tools/trace/scripts; `TRACE_POKE=9540a4=58,10a2140=58 TRACE_FIELDSET=enemy TRACE_ERECS=41,42,43,44
  TRACE_ENEMIES=4`): w159_walk95's route; trigger 95 runs script 88 (trigger 15's) at its crossing. The decoded flags
  (evt_flags XOR evt_key): start 2 = 7, 46 = 1 (= SAVE_EVENT_FLAGS); at record 783 flag 0 0 -> 2 and 63 0 -> 6, no
  other change to f829. Record 44's +0x28 bit 0 clears the same record (script 88's 0x109). TRACE_ERECS picked only
  record 44 (E0..E3 = the same object), so the deletion of 41-43 itself is not in the trace.
- The plan's "flag 1 = 6 at trigger 15" mixed two things: **trigger 15 runs script 88** (flag 0 = 2, flag 63 = 6,
  0x10a to 41-43 and trigger 76, 0x109 to 44, short 1 = 2, all only while flag 0 < 2); **script 15** (flag 1 = 6, then
  0x10a to itself) is not the script of any trigger, record or section-15 gimmick on z128.
- Kills: scripts 47-50 (records 27-30) count deaths in manager short 35 and write flag 1 = 12 at the 4th; scripts 13 /
  14 (records 19-21) write flag 1 = 10 at the 3rd only when trigger 62 answers cmd 0x186 (not translated).
- test_enemy_ai (worker 0212 block): trigger 15 through the game's script 88, Vincent dead (and +0x64 bit 8), records
  27-30's kills, the respawn chain 0x40 / 0x10e / 0x14a / 0x108 on dead record 41, 0x10a timing on an actor,
  0x155 / 0x133, cmd 6, and the w212_flag95 flags. Mutants: 21 / 21 killed (5 on cmd 0xb). A deleted trigger stays in the `triggers` list, off (trigObj(k) indexes it; script 0 event 0x22 deletes trigger 90 on difficulty 3).

## Still open

- 0x113 (FUN_0054cd70: +0x36 and FUN_0053e9e0's delayed self-message; the delivery is the same undecoded queue as the
  page's 0x101 mailbox GUESS), 0x141 (FUN_005661e8: FUN_00344840 name -> C+0x640, FUN_00341780(C, 2, 0) event-motion
  object at C+0x7d0, its +0x80 = r1; records 50 / 51's event 3), 0x142 to an inactive record, 0x14a on an active actor.
- Commands the flag writers sit behind: 0x177 (scripts 161-164 ev 2), 0x186 (scripts 13 / 14), manager 0x9 / 0xa
  (FUN_0037ce60 / FUN_0037cea0: event-VM values; scripts 47-50, 60, 62, 140, 217, 234, 273), 0x66, 0xa1.
- Request 0x15 of cmd 6; FUN_003ff658's mode-0x11 branch; the parts of FUN_0053e1e0 listed above.

## Review fixes (2026-11-03, manager review)

- Manager +0x260 is one field (world.mgr260): 0x40 and 0x10f (FUN_0054cd70: FUN_0054a720 -> FUN_0053d960) write it;
  0x10e, 0x13b / 0x13e (not on the page) and the barrels' 0x2a / 0x2b / 4 (props.js) read it.
- One delete queue: barrels' 0x10a goes through the generic case and FUN_0053fde8; FUN_0053e1e0 calls props `deleted`.
- FUN_0053e1e0's tail: status slot -> manager +0x3b2[slot] = 0xffff (vt+0x8c, +0x100 < 0x100); trigger (vt+0x84) ->
  +0x7b0[+0xd0] (< 0x3fe); gimmicks (vt+0xdc / +0xd4 / +0x134) -> +0x5b2[..] (< 0xff). So 0x3a / 0x3d / 0x3e give -1.
- Children: FUN_0054b9b0(child, 0, 1, 1, 1) detaches each one keeping its world matrix, then vt+0x2c4. The melee hit
  volume (FUN_00579d00, vtable 0x58f9f0) has vt+0x2c4 = 0x54bf38 (`jr ra`): it lives on where it was. FUN_00569dc0
  makes it a child only when it follows the owner (FUN_0054b9b0 / FUN_0054bf48 / FUN_0054bf90); once-placed ones
  (FUN_0054b770) are not children.
- 0x14a needs status +0x17c: the stage load FUN_00547ce0 makes an object only for a status slot (FUN_00318bf8(k) != 0)
  and links it (FUN_0055a168 -> FUN_00563fc0), so every page record / actor object has one.
- 0x10e on an actor: FUN_00588b78 (cases 0x10d / 0x10e / 0x112 / 0x121) -> FUN_00588430: FUN_0034aae0 (C+0x00.. =
  actor +0x60) and FUN_00356d98(C+0x3b0, +0x90, 1, 0, 0). Not translated (warned).
