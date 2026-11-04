# Stage-info boxes (help / objective messages) and the AI pause (worker 0220, 2026-11-03)

Plan item P11. Page: native/web/stage_info.js, game_state.js; data: native/assets/models/export_web_stageinfo.py
(build step "stage-info boxes"); tests: test_stage_info.mjs, test_stage_info_page.mjs, test_ai_pause.mjs (hooked).

## What the x -1186 stop is (decoded + traced)
- It is **displayStageInfo(6, "MES_ITEM_07")**, an item help box, not a script trigger box.
- Chain: Vincent picks up an item (section-1 record 22) -> his own script **246, event 0x3a** (r1 = the picked-up
  object; `send 0x3e(22)` = record 22's id) -> manager cmd 0xb: **zone flag 2 = 7** (other records: 45 -> 8, 122 -> 5,
  125 -> 2, ...). ev0100 main's loop calls **`deb_jump`** (misnamed: the stage's help routine): for each (flag 2 value,
  item flag 42..49 / 55..56, MES_ITEM_xx): `peace`, `enableSkip(0)`, `free_usercontrol(1)`, `set_battlecontrol(0)`,
  Zone.setflag(item flag, 1), Event.setflag(55, n), `displayStageInfo(6, key)`, wait `!isDisplayStageInfo(6)`,
  `setBattleCameraInterpolationTime(5000)`, `enableSkip(1)`, `free_usercontrol(0)`, `set_battlecontrol(1)`, `chaos`.
- Trace w220_box (tools/trace/scripts/w220_box.json, `TRACE_FIELDSET=stageinfo`, new in fields.py; out/w220): flag 2 = 7
  at f205 (x -1188), bits 6 + 10 f206 (peace), 11 f208, 1 f209, flag 46 f211, kind 6 f217, FUN_003fdf00 state 3 f218,
  box f227 (state 5), steps 3-4 at f252 (focus moves to the screen), ✕ f400 -> step 7 at f401, box closed f451, kind
  clear f452, bits 11 f454, 1 f455, 6 / 10 f458; AI clock 1821 from f206 to f457 (records = the previous frame's state).
- **One ✕ closes it**: the box closes 1000 ms after the first ✕ (step table's second section). The "two ✕" in
  enemy-research §7 was the second press landing as it closed.
- 0221's stop at (-954, -160, -1080) after soldier 45 dies is most likely the same handler: record 45 -> flag 2 = 8
  (MES_ITEM_08, his drop). Not traced.
- **enemy_ai.js SAVE_EVENT_FLAGS {2: 7, 46: 1} is not the save's start**: at f100 every zone flag is 0. See
  fidelity-audit.

## Natives (event library, C at method +0x0c, read from save RAM)
displayStageInfo(I) / (ILString) -> displayStageInfo_l **0x39e8e8**; isDisplayStageInfo **0x39e9c8**; peace 0x39def0,
chaos 0x39df18 (FUN_00380290 -> FUN_0037def0 = bit 6); free_usercontrol 0x3a4768 (bit 11); set_battlecontrol 0x39c3a8;
enableSkip 0x3a4898; KerberosWindow.addHelpMessage 0x3a0508 (not used by z128). A small reader for the library
natives: walk the "SSSS" class images in eeMemory, method table +0x30 (0x18 each), +0x0c = C function.

## FUN_0039e8e8 -> FUN_003fdb48 -> FUN_003fdf00
- FUN_0039e8e8: string arg -> FUN_003a6698(VM message object, string) -> strncpy DAT_0047d968 (0x1ff);
  FUN_00380788(ev, kind) -> FUN_003fdb48(kind) (kind 5 skipped while +0x156c); waits on event cmd 0x20.
- Message file: ev0100's **0c0641ca.bin** (the one in RAM; how the language picks it: not decoded). FUN_003a6520:
  0x20-byte header decrypted with a fixed key (lui/ori/dsll in its prologue, read from the ELF), the rest with the
  header's first u64 (kel_class.cipher = FUN_0041c1d8); +0xb != 0 -> zlib. Records (hash, name, text) 12 bytes, sorted
  by FUN_003a6628 hash (bytes XORed at 8 x (i & 3), <= 23 bytes), binary search FUN_003a6390, count header +8.
  MES_ITEM_09 is not in z128's file (other stages).
- FUN_003fdb48(kind): an open kind -> FUN_003fdd58 first; PTR_0047db6c = kind; state DAT_004fadbc = 0; FUN_00241760(1,0,0);
  kind 0 / 2 / 3 extras. FUN_003fdd30 = isDisplay. FUN_003fdd58: box gone (FUN_003b6978), FED freed, kind -1.
- FUN_003fdf00 (first in every frame): state 0 picks the effect file (kind 6: 0x3100084 / **0x3100085** by language =
  a0195 / **a0211.fed**, FED id 0x834c0000; else 0x31000fc / dd..e1), 1-3 read and register it (FUN_002f1ae8), 4:
  FUN_003b66c0(DAT_00472a80, **DAT_004a8250[kind]**) = 0x1e 0x1f 0x1d 6 0x20 0x22 0x2b for kinds 0..6; 5: wait for the
  slot result (FUN_003b68b8) 2 (kind 3: DAT_0047db88 6 / 7), then FUN_003fdd58.

## The box: FUN_003c52b0 -> FUN_003c5358 (0x10d8 bytes, vtable 0x4a5ee0, the "sequence screen")
- FUN_003c54f8: stats FUN_0031d7b8(0..0x35) at +0xff0 (the results screens'), step table +0x488: kind 0x2b 0x47a220 /
  **0x51cfd8** (FUN_003e2760: language != 0), 0x1f 0x47a0a0, 0x1e 0x47a028, 6 0x47a130 (game over), default 0x479650.
  0x51xxxx is the kel_us overlay, present in the ELF's section headers (export_web_menu.Elf reads it).
- FUN_003c6f98 (kind 0x2b): slot 1's effect id = PTR_0051d090[event flag 55] (the item picture; 7 = 0x834c2000), the
  string to +0xdf0.
- Steps (0x14): +0 start ms, +4 life (-2 = until ✕, 0 = none), +8 s8 op, +0xc arg, +0x10/+0x12 x, y. Op >= 0: effect
  slot op (FUN_003c58b8: FUN_002e62b0 spawn of id arg, -1 = the slot's id); op < 0: FUN_003c6600 case op + 0x1d:
  3 sound FUN_003e1d10(arg), 10 mode 1 (wait for ✕), 0x1a the layout + text (kind 0x2b: layout 0x479610, widget 0x35
  vt+0xd4 with +0xdf0; kind 0x1f: layout 0x479168, widget 2 = sprintf(0x4a5d78, FUN_003fd578(DAT_0047a388[stat
  0x32]))), 0x1b close (FUN_003b7830 result +0x48e = 2). FUN_003c6050 runs the steps due (time since +0x480), ✕ in mode 1
  (FUN_003de918(0, 1), the screen focused FUN_003d5480): FUN_003c7278 (lives -2 -> 0) + FUN_003c72f8 (clock restart,
  step + 1: past the end mark into the next section). Widget slots (FUN_003c5db0): 100 ms alpha fade in / out.
- Kind 0x2b's table: t0 sound 0x1d, slot 0 panel 0x834c0000, slot 1 picture; t500 layout + text (life -2), mode 1;
  [✕] sound 0x1e; t1000 close. Kind 0x1f: sound 0x11, effects 0x81740000 / 0400 / 0c00 (life 3000), t500 text, t3700 close.
- Layout 0x479610: root 0x34 (512 x 448), **type 2** text 0x35 (FUN_003d6f88, vtable 0x4a67b0; uk rect 24, 98, 464 x 240,
  outline flag 2), type 3 0x36 (invisible, takes the focus). Type 2 draw FUN_003d7040 -> FUN_003cc0a8 (TEX1 bilinear)
  -> FUN_003cd7e8.
- '$' codes (FUN_003d1d98, table 0x47abb0: char, digits, base): c f u w t r & h i x o m = cases 1..12. Used: c (colour
  DAT_0047a7c0[n], alpha kept), r (line break), i + 2 letters (FUN_003d1d08: PTR_0047a990 names -> DAT_004f2048 records
  from FUN_003d1c90 / FUN_003cb300: page = image +4 + 6, u v w h; drawn at y + ((16 - h) / 2 + 2), advance w + 2).

## Game-state bits (game_state.js)
2 event mode, 6 AI paused, 10 peace counter, 11 no user control; readers of 6: FUN_00365008, FUN_00569dc0, FUN_00569870,
FUN_0055c7f8; of 11: FUN_00331f08 (player control update), FUN_0032ace0.

## Open
The box effects (effects.js: channel type 18, draw type 103, FUN_002e7198); item pickups (the real trigger, P5); kind 1
drawing (stat 0x32); kinds 0 / 2 / 4 / 5; FUN_0055c7f8's gate on Vincent's damage; the camera's bit-11 branch;
FUN_00241760 (bit 1 / the counter DAT_0046b1e0) consumers.

## User control off during the box (worker 0246, 2026-11-03; decoded)

Dan: with the pickup box up he could still shoot, turn the camera (and, per the review board, move). The page blocked only the
stick. What game-state bit 11 (free_usercontrol(1) / set_usercontrol(0), FUN_00325b60) does:
- **FUN_00331f08** (the control object's update, vtable 0x4a0910 +0x14) tests FUN_00326068(0xb). Clear: vt+0x5c
  **FUN_003343a8** (the aimed face point, unless P+0x2a4 is 1 / 3), and with HP != 0 vt+0x4c **FUN_003320c0** (R1 / R2 / R3 /
  circle, the auto reload) and vt+0x54 **FUN_00333150** (the stick, ✕), then the select message 0x7d3. Set: none of them;
  FUN_00574920(P, 0) (P+0x298 stick = 0), FUN_0055a410 states -> FUN_00577038 (player state 10 only; not translated, warned),
  FUN_0055a378 + W+4 bit 0 (auto fire) -> FUN_00574b98 (the R1 release: 3 -> 0, 4 -> 2).
- **FUN_0032ace0** (camera) l.437-441: bVar1 = FUN_00324258(10) (game-state bits 7 / 5, FUN_00324a78(G, 2), DAT_0046e290
  +0x10 / +0x18 bit 10) or bit 11. FUN_003256d8 still reads the look stick and the mouse (the latch updates, the counts are
  spent); with bVar1 the look is zeroed and the update jumps to LAB_0032bcac (no ramp CAM+0x1ec / +0x1f0, no deadzone request
  FUN_00324440(10), no death look). FUN_00325678 (the left stick the camera reads) gives 0 under bit 11.
- Page: play.js passes `noControl` in the neutral input and `noUser` (bit 11 or bits 7 / 5) to FollowCamera.tick; aim.js
  hook.pre drops the button edges and runs aim_core `noControl` instead of `input`. Tests: test_camera (5 checks), test_no_control
  (7), test_items_page (W / R1 / R2 / drag with the box up). Movement was already neutral under bit 11 on the page.

## Box effects (worker 0241, 2026-11-03)
- native/web/menu_fx.js: the box slots' effects on the menu managers. FUN_002f0878 for ids >> 28 == 8: (id >> 18) & 0x3ff
  in {0x5d, 0xe0, 0xfd, 0x109, 0x115} -> DAT_004ee580 (a0093, the Status / objective FED 0x8174....), else DAT_004ee4a0
  (a0211 0x834c...., the title card's a0099 0x818c...., the GAME OVER title). FUN_003e27d0 -> FUN_0051bdc0 remaps ids for
  languages 3..6 only (table 0x51df20); the page's language 2: identity.
- FUN_003c58b8: FUN_003c5c50 (remove the slot's old emitter), id -1 = the slot's id, position = the step's (+0x10 / +0x12)
  or, id -1 with script flag 0x1e (FUN_002413c0: DAT_004b8980 bit 30, MEASURED set), the slot's (+0x60 / +0x62), stored
  back unless that case; FUN_002e62b0(0, mgr, id, { flag 1, &(x, y) }). FUN_003c6050's tail per slot: life over ->
  FUN_003c5a98 (FUN_002e7198 soft end), else +0x6c set -> FUN_003c5b00 (move: +0x60 -> +0x64 over +0x6c ms from +0x68).
  FUN_003c5cc0 at the box's end. The box code runs in the menu update FUN_003dce38 (after FUN_002efe98): managers in state 9.
- Frame order (FUN_00248110): FUN_002f00c0 (layers 3, 4), FUN_003dcf58(0) (menus: HUD, box text), FUN_002f0250 (layer 5),
  FUN_003dcf58(1), FUN_002f0428 (layer 6). The help box: panel in layer 4 (slots 0x11c / 0x11d), the picture in layer 5
  (0x12d: open330 draws it last, after the text). Page: both before the HUD (GUESS row).
- The help box on the page now draws the panel's bars / stripes (type 11), the strands (103) and the case (type 10);
  missing: the dark backdrop and scanlines (type 119 children of type 18). Image: worker 0241's scratchpad
  w0241_helpbox_game_vs_page.png.
- **Title card (box 0x1e) not wired**: its effects are a0099's E6 (0x818c0000: a type 21 burst on camera 0, whose spawn z
  is stack data) and E5 (0x818c0400: type 113, FUN_002d4250's frame-buffer passes); its step [500, 3000, -3, 0x27] is
  command 0x1a with arg 0x27 for kind 0x1e (a layout, likely the stage name: not decoded). event_rt.js still drops
  displayStageInfo(0). No hold to add: scr001 checks isDisplayStageInfo(0) once (no wait loop).

## Objective box (worker 0258, 2026-11-03)
- FUN_003c6600 case 0x1a, kind 0x1f: FUN_003c5d10(box, 0x479168, 0): third argument 0, no language rect override. Widget 2 (rect 20, 214, 472 x 16, flags 0x212: centred, outline) gets sprintf('%s', FUN_003fd578(DAT_0047a388[+0x10b8])) through vt+0xd4 FUN_003d7218 (FUN_003d0380, then the measure FUN_003cf2e0 the centring needs).
- +0x10b8 = +0xff0 + 4 x 0x32: stat 0x32, copied by FUN_003c54f8 (section stat, or the total when stat 14 == 0x10). Writers: manager cmd 0x46 (FUN_00545b20 -> FUN_0031d698), setSectionStat. Table: 40 kelstr ids at 0x47a388 (rows 0 and 1 are the same text).
- Opening it in PCSX2 without the route: TRACE_POKE=47db6c=1,4fadbc=0 (FUN_003fdb48's two writes that matter; FUN_003fdf00 then reads a0093 and opens box 0x1f). Script w258_box31, grabs 40 / 120. RAM: stat 0x32 = 0 ('Protect the civilians!').
- Compare: tools/trace/out/w258 (gitignored): b120.gs, fx120.json; data/stage_info_k1_ref.json. The text is exact; the panel's type 26 and parented particles are not drawn yet.
- The box's close: FUN_003fdd58 -> FUN_003b6978 -> vt+0x34 (table 0x4a5ee0) FUN_003b7930 -> FUN_003d4588(box, 100, 0): +0x25 == 0 (RAM: w258 b40 / b120, w220 open330, +0x10 = 0x9104) -> FUN_003d4630, +0x10 |= 1. FUN_003dd9f8 then skips the box's update; FUN_003de938 (in FUN_003dce38, after FUN_002efe98, before the draw) calls vt+0xc FUN_003c5428 -> FUN_003c5cc0. No 100 ms close for these boxes (FUN_003d51c0 is the +0x25 != 0 path).
