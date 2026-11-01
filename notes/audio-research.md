# Audio: how the game plays sound effects (worker 0170, 2026-11-01)

Goal: game sounds on the web page, combat first. This note covers the whole SE path, from the
game code that asks for a sound to the SPU2 voice. The formats are decoded from the EE code and
from the IOP sound driver (`data/sound/lib/iopsound.irx`), and checked against the game's own RAM.
BGM and voice streams (`.at3` / `.at2`, ATRAC) are a separate path (native/assets/audio/FORMAT.md)
and are not covered here.

## The chain

1. **Game code -> name.** Gameplay plays a sound by its **sdb.bin name** (`bsj_051`, `fsj_025`, ...)
   at a position: `FUN_0033cc48(name, pos, 1)` / `FUN_0033cbd8` / `FUN_0033ce10` (with a range)
   -> `FUN_0033cc90` -> `FUN_003e8e18(mgr DAT_0047d728, name, pos, 0)`.
   `FUN_003e8e18` hashes the name (`FUN_0024909c`), finds the sdb row (`FUN_003eb868`) and takes
   the **SE id = row +0x10** (or row +8 when row +0xc bit 1 is set: an ATRAC stream). It then opens
   an emitter slot (`FUN_003e8bc8`: 128 slots x 0x70; v0 = the slot).
2. **Emitters -> request.** Each frame `FUN_003e9220` turns the slots into volume / pan from the 3D
   position (NOT decoded yet) and queues `FUN_003e7810(_, id, vol, pan)` = `FUN_003e85a8(2, id, vol, pan)`.
   That is a 512-entry ring of 0x18-byte requests at 0x1fdcfc0. Other request codes come from
   `FUN_003e7718` and its neighbours (0x11 / 0x18 / 0x1b ...).
3. **Sound thread.** `FUN_003e7150` (thread made by `FUN_003e7448`) drains the ring into
   `FUN_003e80d8`. Case 2 / 0x16 / 0x17 looks the id up in each of the 6 loaded SE blocks
   (`FUN_003e7ed8`, binary search) and sends the program with `FUN_0041a190(entry, vol, pan)`.
   That checks the `SeSep` magic and queues IOP command 0x29 (`FUN_00418e38`, the EE->IOP queue;
   the command names are in `EESound`'s debug strings at 0x4a8cb0..0x4a8de0).
4. **IOP.** The async command table is at irx 0x1b8e4 (`FUN_000176dc`); cmd 0x29 -> `FUN_000159ac`.
   If the SE is not resident it is received first (`FUN_00012710`), then `FUN_0000885c` ->
   **`FUN_000082d0`** starts the program's tracks. The main process (`FUN_00010ab4`, woken by a
   hard timer: `FUN_00010bdc` AllocHardTimer(sysclock, 32, 1), compare **0x25800** = 36.864 MHz /
   153600 = **240 Hz**) runs, per tick, `FUN_00000dfc`: pending key-ons / voice updates
   (`FUN_00002c24`, `FUN_000025ac`), then the SE tick `FUN_00007224`, then the command queue.

## Files

| what | where | format |
|---|---|---|
| SE names | zone `sdb.bin` = FileCode **06zz0008** (`FUN_0024a828` case 8; z128 = noPath/06800008.bin) | 24-byte rows: char[8] name, +8 u8, +9 u8, +0xa u16, +0xc u32 flags (bit 1 = stream), +0x10 u32 SE id, +0x14 u32 (range? 800 for `bsj_000`) |
| SE programs | zone `sound/sep.bin` = FileCode **06zz0005** (case 5) | u16 count, u16 index[count] (sorted by id), entry k at `index[k]*16`: `"SeSep"`, +8 u32 id, +0xc u32 size (bit 31 masked), +0x10 program |
| wave banks | `data/sound2/waveNNNN.wd` (only copies on the disc) | see "WD bank" below; bank N = file N (the loader overwrites the header's bank field) |
| driver | `data/sound/lib/iopsound.irx` | relocatable IOP module; sections at their own addresses from base 0 (text 0, rodata 0x19170, data 0x1a0a0) |

**Checked against the game's RAM (sea-of-flames .p2s):** IOP RAM holds `wave0000.wd`'s header with
its SPU address filled in (+0x10 = 0x20000), and its instrument and region tables are byte-identical
to the file. SPU2 RAM at 0x20000 holds the file's whole 1,888,320-byte sample area byte-identical.
So bank 0 is resident in z128, and the layout below is the one the game uploads.

## SE program (iopsound.irx FUN_000082d0)

`b0 & 0x7f` track count, `b1..b2` u16 wave bank, `b3` priority, `b4` flags (bit 3: volume forced
to 0x7f), then a u16 length per track. An entry with bit 0x4000 is a skip, not a track. Tracks
follow the table. A track is MIDI-like: VLQ delta (`FUN_00006c34`), then an opcode byte (`& 0x7f`
indexes the handler table at **irx 0x1acf0**), then operands, then the next delta.

Operand lengths are checked on **all 37,921 programs** in all 128 zone sep.bin files:
`python3 -I tools/audio/sep.py check extract/_KEL/noPath/06??0005.bin` (every track ends exactly
on its declared length; the 1,535 "bad" ones all end on an endless `0x06` loop, as they should).

| op | operands | meaning (handler) |
|---|---|---|
| 00 (and 0f 14-17 1c 1d 1f 3a 3b 57 5e 5f 63 66 67 6a 6b 6d-6f 7a 7b) | - | track end `FUN_000034a0`: note-off; when the last track of the SE ends, all its voices are keyed off |
| 04 / 05 n / 06 | - / b / - | loop begin (4-level stack) / loop end, n times (0 = 256) / loop back forever |
| 08 / 09 / 0a / 0b / 0c | b / bb / b / bb / bb | tempo, tempo slide, relative tempo, slide, time signature (music path; the SE tick uses the global `*DAT_0001bb54`) |
| 10 / 11 k v / 12 k / 13 v | | note on (`FUN_0000326c` + `FUN_00002de4` queue a key-on) |
| 18 / 19 k _ / 1a k / 1b _ | | note off `FUN_00002f10` (ignored while the hold flag is set) |
| 1e lo hi / 20 n / 21 slot n | | instrument: WD +0x20 offset table index. Also resets the ADSR overrides |
| 22 b / 23 v b | | volume: `s8(b) * 0x80000 (+0x7f000 if > 0)` / slide over v ticks (`FUN_00002d54`) |
| 24 b / 25 v b | | expression, same scale |
| 26 b / 27 v b | | pan `b << 12` (stereo: `FUN_00008dc4` returns it) / slide |
| 2a / 2b | | hold on / off (trk+0x154 bit 0x80000: note-off ignored, the next note reuses the voice) |
| 2c v b | | pitch slide by `s8(b)` semitones over v ticks (voice note in << 20 units) |
| 2d b / 2e / 2f | | voice flag 0x200000 / no auto key-off on / off (trk+0x154 bit 0x200000) |
| 30 / 31-38 b / 39 b b | | ADSR back to the region's / one ADSR field (live on the track's voices; masks in audio.js `ADSR_OV`) / decay + sustain level |
| 60 / 61 | | voice output flags 0x3c00 (dry + effect send) / 0xc00 (dry) |
| 78 t b | | per-note randomisation range `b + 1`: t 0 pitch, 1 volume, 2 pan, 3 delta time, 4 attack, 5 instrument (`FUN_00006270`) |
| 40-56, 28/29, 0d, 58-79 others | (see sep.py) | LFOs (vibrato / tremolo / pan), portamento, pitch tables, misc: parsed, not played yet |

**Timing (`FUN_00007224`).** Each track has a u16 counter that starts at 1. Every 240 Hz tick it
drops by `(*DAT_0001bb54 >> 12) * 0x78 >> 8` = 120 (`*DAT_0001bb54 = 0x100000` at init), and every
time it reaches <= 0 it gains 300 and the track advances one sequence tick. That is 96 sequence
ticks a second (2 per 5 driver ticks). A track's first delta + 1 is its starting count. When one
tick remains before the next event, the note is keyed off automatically (unless trk+0x154 bit
0x200000 is set). Key-ons and key-offs reach the SPU on the next driver tick.

## WD bank (FUN_0000b578 loader)

Header 0x20 bytes: "WD", +2 bank (overwritten at load), +4 sample-area size, +8 instrument count,
+0xc region count, +0x10 SPU address (filled in at load). Then the instrument offset table (padded to
a multiple of 4 entries), then regions x 0x20. The sample area follows; it is what goes to SPU RAM,
and region offsets are relative to it (wave0000: sample area at file 0x2980).

Region (0x20 bytes; `FUN_00001c5c`, `FUN_00001d0c`, `FUN_00001380`):

| off | field | use |
|---|---|---|
| +0x00 u32 | flags | bit 0: stereo pair (the next region plays on a second voice, panned hard L / R); 0x200 last region; 0x30000 multi-region (key / velocity split); 0x20000 fixed key (+0x14) |
| +0x04 u32 | sample start | SSA = bank SPU address + this (`sceSdSetAddr` voice 0x2040) |
| +0x08 u32 | loop start, relative to the sample start | LSAX = SSA + this (0x2140); an ADPCM loop-start flag overrides it |
| +0x0c u32 | ADSR1 (low 16) / ADSR2 (high 16) | SPU regs 0x300 / 0x400, with the track's 0x31-0x39 overrides |
| +0x10 s32 | tune | `>> 16` = 1/256 semitone, added to key << 8 (there is no separate root key) |
| +0x14 u8 / +0x15 u8 | high key / high velocity | region choice |
| +0x16 u8 | volume (& 0x7f) | volume law |
| +0x17 u8 | pan: bit 7 set = use `& 0x7f` (0 -> 0x40), clear = the track's pan | |
| +0x18 u8 | mode | non-zero overrides the output flags (1: 0x3000, else 0x3c00) |

(The old notes in native/assets/audio/FORMAT.md §3 read +0x08 as a length and +0x14 as a float.
Both readings are wrong: see the table above.)

**Pitch (`FUN_000012b0`).** `u = (note20 >> 12) + bend + (tune >> 16)`, `n = u >> 8 & 0x7f` (an
octave is subtracted while u < 0). Then `pitch = (SEMI[n % 12] >> (10 - n / 12)) * FINE[u & 0xff] >> 16`.
The tables are at irx 0x1af7c (12 x u32) and 0x1afac (256 x u32). The SPU pitch is written `& 0x3fff`
(`FUN_0000179c`); 0x1000 plays at 48 kHz.

**Volume (`FUN_00001380`).** `master` = `DAT_0001bb70[1] * 0x1ff >> 7` for SE voices
(`FUN_000025ac`; the game sends `FUN_00419518(2, 1, 0x7f)` at sound-thread start, giving 507).
`v = (master + 1) * (expr + 1) >> 9`; `v = v * (vel + 1) >> 7` if the velocity is not 0;
`v = ((((v * (reqVol + 1)) >> 7) * vol) >> 14) * (regionVol + 1) >> 7`. Then
`L = v * PAN[p] >> 8`, `R = v * PAN[p ^ 0x7f] >> 8`, with the pan table at irx 0x1b55c.
Randomisation (op 0x78) adds `v * r >> 7` etc. from a 256-byte random table at irx 0x1b45c
(`FUN_0000a870`, a u8 index that wraps). Tremolo / vibrato / pan LFO terms are not ported.

## Combat sound map (z128)

From two PCSX2 call-log traces (`TRACE_CALLLOG=sound` / `sound2`, scripts w170_sound / w170_sound2:
k_enemy_engage8 inputs, Vincent fires at f831-951, soldier #66 fires at f786 / 875 / 1008 and hits
Vincent at f789). "vol" is the volume the sound thread passed to `FUN_0041a190`.

| event | EE call path | name | SE id | vol |
|---|---|---|---|---|
| **Vincent's shot** | `FUN_00577480` -> `FUN_0033d118(gunDef)`: `(gunDef+0x14 >> 2) & 7` = 1 -> index 12 of the name table 0x46e5b8 (gunDef+4 bit 3 would pick `bsj_061`) | `bsj_051` | 1040 | 0x39-0x3a |
| Vincent: R1 with the gun lowered (gun ready) | `FUN_0033d348` (names `bsj_018` / `bsj_020` by argument; callers `FUN_0056f150`, `FUN_005766c0`) | `bsj_018` | 1016 | 0x3f |
| **Soldier's shot** (e027 rifle) | `FUN_005694f8` -> `FUN_0033d6d8(weapon part)`: the name at part +0x8c, range part +0x74 (400 if not set) | `bsj_004` | 1005 | 0x39-0x3a |
| Soldier's shot, second sound | `FUN_00554850` -> `FUN_0033d788(part)`: the name at part +0x94 | `bsj_063` | 1060 | 0x81 |
| **Bullet hits the room** | `FUN_0033d528` -> `FUN_0033d4e8(mat, variant)`: table 0x46e5f8[mat * 3 + variant] (`bsj_021`..`bsj_038`, `bsj_102`..`bsj_107`); callers `FUN_0054ff50`, `FUN_00585000` | `bsj_021` / `bsj_022` (`bsj_024` once) | 1019 / 1020 / 1022 | 0x3f-0x41 (0xb0) |
| Bullet hits a character | `FUN_00556870` (hit test) -> `FUN_0033d5c8(bullet+0x138 & 0xf)` (table `bsj_476 bsj_476 bsj_475 bsj_477 ...`), or name 0x58d108 `bsj_491` when the hit type is 6 | - | - | not seen in the trace (Vincent's hit at f789 did not take this branch). `bsj_491` is not in z128's sdb |
| **Vincent hurt** | not pinned (played at the hit, f789) | `bt_v002` | 37003 | 0x3f |
| Melee hit | `FUN_0057a830` -> `FUN_0033cc48(attack object +0x134)`: the name comes from the attack data (`FUN_00541310` record) | ? | ? | not traced yet |
| Melee swing | not found yet | | | |
| Other gun names | `FUN_0033d008(gunDef)`: index table 0x4a10f8 by gunDef+0x14 bits -> 0x46e5b8 (`bsj_000`..`bsj_011`, `bsj_051`..`bsj_054`); used by `FUN_005694f8`, `FUN_00571dd8`, `FUN_00577480` (with gun flag 0x20) | | | |

## Tools and code

- `tools/audio/sep.py` - SE block parser / disassembler / checker (`list`, `dis <id>`, `check`).
- `tools/audio/extract.py` - writes `native/web/data/audio/` (gitignored): `driver.json` (tables read
  from the irx), `se_zNNN.json` (names, programs), `waveNNNN.bin` (the SPU sample area) and
  `waveNNNN.json` (instruments / regions). Run: `python3 -I tools/audio/extract.py` (z128 default).
- `tools/audio/adpcm.py` - reference SPU-ADPCM decoder (also `extract.py --wav DIR --region N ...`).
- `native/web/audio.js` - `decodeBlock` / `decodeSample`, `spuPitch`, `selectRegion`, `SeRenderer`
  (renders a program into a 48 kHz stereo buffer, one 240 Hz tick at a time, with the
  driver's timing, volume law, ADSR overrides, randomisation and the SPU2 envelope) and
  `GameAudio` (load a zone, `playName` / `playId`).
- `native/web/test_audio.mjs` - 9 tests on synthetic data (ADPCM filters / shift / clamp / loop
  flags, pitch, region choice, SE tick timing, hold, loops, volume law). 14 of 14 non-equivalent
  mutants killed (one more was equivalent).
- `play.html?sound=1` (off by default): Vincent's shot plays `bsj_051` at the traced volume 0x3a.
  The pan is a GUESS (0x40; `FUN_003e9220` is not decoded).

**Verification.** ADPCM decode: the new JS, the new Python and the old C `dirge_wd` agree
sample-for-sample on all 248 active regions of wave0000. Bank layout: byte-identical to SPU / IOP
RAM in the save state. Names / ids: the live call logs above. **Not yet verified:** the rendered
SE against PCSX2's actual SPU2 output. That needs an audio capture (or SPU2 voice-register
snapshots) from a trace run. The envelope follows the documented SPU2 hardware rules, not a
capture, and the interpolation is linear (GUESS; the SPU2 uses a gaussian).

## Gaps / next

1. Decode `FUN_003e9220` (emitter -> volume / pan from listener distance and angle; sdb +0x14 is
   probably the range) and wire the combat events: soldier shots (`bsj_004` + `bsj_063`), wall
   impacts (`FUN_0033d4e8`'s material table: needs the room probe's material), Vincent hurt (`bt_v002`).
2. Melee: trace `FUN_0057a830`'s name (attack object +0x134) and find the swing sound (probably in the
   attack op data, like the hit volume).
3. Grade a rendered SE against a PCSX2 audio capture; port the gaussian interpolation and the LFO opcodes.
4. Footsteps etc. (`fsj_*`, `asj_*`) use the same path: find their callers with the `sound` call-log set.
