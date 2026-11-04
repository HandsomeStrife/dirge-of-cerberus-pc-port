# The Shop (box kind 0x20): decoded, NOT on the page (worker 0263, 2026-11-04)

Stopped when Dan asked for a wind-down (box short of memory). **The page still warns and closes the box** (stage_info.js 'box kind 0x20 has no data'); the talk goes on with Supplies marked.
`native/web/shop.js`, `native/web/test_shop.mjs` and `native/assets/models/export_web_shop.py` exist but nothing loads them: not in play.js, not in build_web.sh. Run the exporter by hand:
`python3 -I native/assets/models/export_web_shop.py --elf elf/SLES_541.85 --disc extract/_KEL --stage extract/_KEL/noPath/06800006.bin --bgd extract/_KEL/data/bgd/bgd.bin`
The one trace of it left in shared code: pause.js `makeWidgets` keeps `c30` and `help` on each widget (inert).

**What has been checked:** the lists against the game's RAM in the Shop (state tools/trace/out/w263/gssup) and node logic tests (test_shop 56 / 56, 23 mutants all fail cleanly).
**What has not:** shop.js has never run on the page or been drawn against the game; no game-vs-page image. The game's flow beyond the first screen was never traced: `tools/trace/scripts/w263_shop.json` (from gssup's state: buy, sell, leave) got 0 of 14 grabs ('deadline passed'), cause not looked into.

## How it opens and closes
displayStageInfo(4) -> FUN_003fdf00 state 4: DAT_004a8250[4] = 0x20 -> FUN_003b66c0 -> PTR_FUN_00472d68[0x20] = FUN_003c2140 -> FUN_003c21b0 (vtable 0x4a5c60; kinds 8 and 0x23 share it). Shop id +0x5d = FUN_0031d7b8(0x13), STAT_SHOP_ID (setSectionStat from the script; RAM: 1 in wro_kaisetu).
Back to the talk: ○ on a tab -> FUN_003c2ae8 -> box 0x479080 ('Quit and exit the shop?', box kind 2: CANCEL first), event 0x55, answer 3 -> FUN_003e0ed0(0, ..) + FUN_003b7830(.., 2); FUN_003fdf00 sees result 2 and FUN_003fdd58 ends the kind.

## Data
Stage file `noPath/06800006.bin` (DAT_0047dbb0 +0x20): u32 count, then (offset, size). Each entry (FUN_0023c418): u32 inflated size, u32 size, cipher FUN_0041c1d8 with key 7 (FUN_0023c3f0; `kel_class.cipher`), zlib. Header 'KelShop1.0'.
+0x40 / +0x44 Buy rows, 0x20 bytes: id, price (0x3c3548). +0x48 / +0x4c Modify rows, 0x20 bytes: id, price, result, +0x10 required item (0 = none) (0x3c39a0). +0x50 / +0x54 Sell prices, 8 bytes, sorted (binary search 0x3c3760, 0 if absent).
Stage's shops, rows Buy / Modify / Sell: 0: 0 / 0 / 474; **1: 2 / 0 / 474** (Vital Rations, Spirit Rations, both price 0: wro_kaisetu's); 2: 3 / 1 / 474; 3: 18 / 68 / 474. Which script sets 2 and 3 not looked up.
Names and descriptions FUN_003fd690 / FUN_003fd6c0 -> FUN_003fd5e8 (table at kelstr +0x24). Row icon FUN_003d21c8; stats FUN_003d2338 -> FUN_003106c8 (bgd section 5, seven shorts, zero prints '---').

## Screen
Root 0x4788c8; Inventory / Gil 0x4789e8 (+0x64); stats 0x4759d8 (+0x68); required item 0x478ab8 (+0x6c, only with a required item); quantity 0x478b08 Buy / 0x478ba8 Sell (FUN_003c4798); Modify's screen 0x478c48 (FUN_003c4cb0); questions 0x479040 Buy, 0x479060 Sell, 0x4790a0 Modify (FUN_003c28a0).
Tabs ids 6, 7, 8 (help messages 0xa80c..e), list id 10 (type 6, record kind 9: name +0x13, price right-aligned, third text at 200, icon). Width 0x110, 0x1d8 on Modify; height at most 0x78. FUN_003c2bb8: a changed focus rebuilds the list. Rows sort by item +0xa (FUN_003c3c50).
Row greyed (bit 0): Buy FUN_003c3598 (too dear; new item and no room; at the stack limit); Sell FUN_003c3820 (count 0 or equipped); Modify FUN_003c3a60 (too dear). A greyed row's ✕ gives sound 5, others 7 (FUN_003d8930). Item flags bit 5: not sellable, not listed.
RAM (gssup): the list's +0x90 = 0 at the tabs, so no cursor bar there; in the list not read.

## Requests (FUN_003e0b10 -> FUN_00312b38 -> FUN_003131c8; answer FUN_003c2f68)
5 buy: gil >= cost, FUN_0031e940 add, FUN_00321428 take. 6 sell: count >= n, FUN_0031eb60, FUN_003213d8. 9 modify: FUN_0031ec40, FUN_0031b190. 0 inventory, 0x13 gil (FUN_003c3260).

## Open
- Modify's request and screen: not translated; the page's Cerberus has no parts. Shop 1 has no Modify rows, so wro_kaisetu doesn't reach it.
- The backdrop FED 0x70040400 (FUN_003e11c0; `data/effect/menu/m0000/m0001/fer/m0001.fed` holds FileCode 0x7004), the fade FUN_003e0ed0, the bar screen DAT_00476810 (FUN_003bafb0; scrolling FUN_003bb808). shop.js draws only the bar's layout 0x476818, untested.
- shop.js `EQUIPPED` is hand-written from the RAM's +0x110c (2 on the first ammo item, Cerberus, Normal Barrel). Request 0's answer writes 8-byte rows while FUN_003c3260 reads 12: not reconciled.
- The spinner's mode (FUN_003e2f98, FUN_003cbbc0): shop.js assumes up / down work as soon as the box opens, per FUN_003e3610 (mode 2). Not traced. Start inside the Shop: not decoded.
- The Sell quantity limit in FUN_003c4b30 was translated but not traced.
- Rations are usable items (flags 13, scripts 22 / 23): the exporter writes `scripts`; merging them into items.js was removed with the wiring.
- pause.js `action` reads `f.nav4[a]` for a = 4 / 5, past the 4-entry array, so left / right on a pause or box button jumps to the button with order 0. Looks like a real bug on the page (FUN_003d8bc8's +0x6a / +0x6b); left alone, outside this job. shop.js works around it. Fix: `f.nav4[a - 2]` (test_pause stayed 94 / 94 with it).
