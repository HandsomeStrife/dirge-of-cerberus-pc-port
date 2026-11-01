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
   position (decoded: "3D volume / pan" below) and queues `FUN_003e7810(_, id, pan, vol)` = `FUN_003e85a8(2, id, pan, vol)`.
   That is a 512-entry ring of 0x18-byte requests at 0x1fdcfc0. Other request codes come from
   `FUN_003e7718` and its neighbours (0x11 / 0x18 / 0x1b ...).
3. **Sound thread.** `FUN_003e7150` (thread made by `FUN_003e7448`) drains the ring into
   `FUN_003e80d8`. Case 2 / 0x16 / 0x17 looks the id up in each of the 6 loaded SE blocks
   (`FUN_003e7ed8`, binary search) and sends the program with `FUN_0041a190(entry, pan, vol & 0x7f)`
   (IOP cmd 0x29 packet +0x10 pan, +0x14 vol -> `FUN_0000885c` -> `FUN_000082d0`: track pan = pan << 12, seq volume = vol << 12).
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
Vincent at f789). The last column was first read as the volume; it is the **pan** (FUN_0041a190's a1; worker 0172).

| event | EE call path | name | SE id | pan (a1) |
|---|---|---|---|---|
| **Vincent's shot** | `FUN_00577480` -> `FUN_0033d118(gunDef)`: `(gunDef+0x14 >> 2) & 7` = 1 -> index 12 of the name table 0x46e5b8 (gunDef+4 bit 3 would pick `bsj_061`) | `bsj_051` | 1040 | 0x39-0x3a |
| Vincent: R1 with the gun lowered (gun ready) | `FUN_0033d348` (names `bsj_018` / `bsj_020` by argument; callers `FUN_0056f150`, `FUN_005766c0`) | `bsj_018` | 1016 | 0x3f |
| **Soldier's shot** (e027 rifle) | `FUN_005694f8` -> `FUN_0033d6d8(weapon part)`: the name at part +0x8c, range part +0x74 (400 if not set) | `bsj_004` | 1005 | 0x39-0x3a |
| Soldier's shot, second sound | `FUN_00554850` -> `FUN_0033d788(part)`: the name at part +0x94 | `bsj_063` | 1060 | 0x81 |
| **Bullet hits the room** | `FUN_0033d528` -> `FUN_0033d4e8(mat, variant)`: table 0x46e5f8[mat * 3 + variant] (`bsj_021`..`bsj_038`, `bsj_102`..`bsj_107`); callers `FUN_0054ff50`, `FUN_00585000` | `bsj_021` / `bsj_022` (`bsj_024` once) | 1019 / 1020 / 1022 | 0x3f-0x41 (0xb0) |
| Bullet hits a character | `FUN_00556870` (hit test) -> `FUN_0033d5c8(bullet+0x138 & 0xf)` (table `bsj_476 bsj_476 bsj_475 bsj_477 ...`), or name 0x58d108 `bsj_491` when the hit type is 6 | - | - | not seen in the trace (Vincent's hit at f789 did not take this branch). `bsj_491` is not in z128's sdb |
| **Vincent hurt** | cue 0x4c -> his script 297 event 0x25 -> cmd 0x125 (worker 0174: "Vincent's hit voice" below) | `bt_v000` / `bt_v001` / `bt_v002` (3 of 7 draws) | 37003 (bt_v002) | 0x3f |
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

## 3D volume / pan (worker 0172, decoded and verified)

`FUN_003e9220(mgr, slot, fwd, ringOk)`, read from the disassembly (Ghidra loses the VU0 macro ops). Slot (0x70 B,
`FUN_003e8bc8`): +0 flags, +4 SE id, +0x10 range (400.0 at open; `FUN_0033ced0` sets it for `FUN_0033ce10` callers),
+0x18 voice handle, +0x30 previous position, +0x50 position. sdb row +0xc (`FUN_003e9b80`): bit 1 -> slot 0x4000
(stream), bit 3 -> 0x20, bit 5 -> 0x200000 (no Doppler). Listener: +0x3810 position and +0x3820 forward (the sound
camera: `FUN_003ee468` -> `FUN_003e88f0` from the `DAT_0047d8c0` block, = CAM eye / forward), +0x3850 = Vincent's
C+0x90 + (0, -7, 0) (`FUN_005734a8` -> `FUN_005635e0` -> `FUN_003e88b0`), +0x3890 = 1 in play (`FUN_003e87f8`,
`FUN_00245d00`; 0 in `FUN_0037e048`).

- **Volume**: d = (+0x3890 ? +0x3850 : +0x3810) - position; `vol = (int)((range - |d|) / range * (hi - lo) + lo)`,
  lo / hi = 0 / 117 (stream 112 / 128), then < 1 -> 1, > 0x7f -> 0x7f (beyond the range it stays 1); range < 0 -> 0.
  Flag 0x40: vol = flags >> 7 & 0x7f; flag 0x10: vol >> 1; flag 0x40000: vol 0x7f (or 0x40's), pan 0x40.
- **Pan**: d = +0x3810 - position with y = 0, normalised (vrsqrt; a zero vector stays 0); f = forward with y = 0,
  normalised (`FUN_003e9ed0`); `a = acosf(d . f)`, negated unless (d x f).y < 0; `pan = ((int)(a x 40.743664) - 0x40) & 0xff`
  (128 / pi): 0x40 ahead, 0x00 / 0x80 the sides, 0xc0 behind. Flag 0x8000 (position at the origin) -> 0x40.
  All arithmetic rounds toward zero (PS2 FPU / VU0): dead ahead gives 0x41, a zero vector 0x81 (both seen in the traces).
- **Pitch** (Doppler, only for updates): ((3400 - (dir . listener move)) / (3400 - (dir . emitter move)) - 1) x 3600,
  clamped to s8; flag 0x200000 -> 0.
- **When**: `FUN_003e9ed0` runs once a frame; a slot opened on frame f is sent on f + 1 (code 2, or 0x17 with flag
  0x20000). A slot that keeps a voice handle (+0x18 >= 0, i.e. not released) is re-sent as code 0x11 (`FUN_003e7718`)
  whenever its vol / pan / pitch byte changes and the request ring has < 0x100 entries. Released one-shots
  (`FUN_003e8ff8`: all the combat sounds but bsj_063) never update. The listener the game uses on frame g is trace
  record g - 2's state (camera eye and Vincent's position, both exact).
- DAT_0047d730 (vol x it >> 7 when >= 0) and `FUN_003e80d8`'s vol >> 3: no effect in the traced play.

**Verification.** Call-log set `sound3` (tools/trace/calllog.py; `cpr()` copies a register's value): play_name
(name, position, slot), se_new (`FUN_003e7810`'s pan / vol), se_send, se_range, slot_open (every new slot's sdb name),
listener (once a frame). Traces w172_sound3 (k_enemy_engage8 inputs), w172_hits (k_hits12: lock-on, the kill),
w172_melee (k_melee18's swing and hit): **44 / 44 new SEs exact** (`node native/web/test_audio3d.mjs`).

## Combat sounds on the page (worker 0172)

| event | game call | page | name(s) |
|---|---|---|---|
| Vincent's shot | `FUN_00577480` after the pellets -> `FUN_0033d118(W, muzzle)`: W+4 bit 3 -> bsj_061, else table 0x46e5b8[class 2 -> 14, 3 -> 13, else 12], at the pulled-back muzzle | enemy_ai.js `playerShot` | bsj_051 |
| draw / holster | `FUN_005766c0` -> `FUN_0033d348` / `FUN_0033d3c8` (tables 0x4a11f0 / 0x4a1218 by W class, gate DAT_004e0ff8 == 1), at C+0x90 | aim_core.js `draw` / `holster` -> play.js | bsj_018 / bsj_048 |
| soldier's shot | `FUN_00554850` (bullet init) -> `FUN_0033d788`: W+0x94 at the sound camera; end of `FUN_005694f8` -> `FUN_0033d6d8`: W+0x8c at the muzzle, range 400 (W+0x74 if > 0 and stage version > 0x20) | enemy_ai.js `spawnShot` (ai.json weapons `se_bullet` / `se_fire` / `se_range`) | bsj_063, bsj_004 |
| bullet ends on a wall | `FUN_005549f0` -> `FUN_00554ea8` -> stage vt+0x1b4 `FUN_0054fee0` -> `FUN_0054ff50`: r = `FUN_0040b5c0`, `FUN_0033d528(mat, (int)(r x 2) != 0, end)` -> kind table 0x4a1310 -> names 0x46e5f8[kind x 3 + variant]. mat = bullet +0x138 & 0xf = (hit surface word >> 16) & 0xf (`FUN_00553660`, `FUN_0026f1e8`) | enemy_ai.js `roomProbe` (`b.mat`), `wallSound`; play.js roomRay `.surface` | mat 2: bsj_021 / 022, mat 1: bsj_024 / 025 (checked at the traced impact points) |
| bullet hits a character | `FUN_00556870`'s `FUN_0033d5c8` is only reached by bullets without +0x120 bit 0x2000 (none here). In the trace the kill plays cue sounds at the soldier: bt_v036, asj_523 (cue tables, below) | not on the page | — |
| Vincent hurt | cue 0x4c '?' -> script 297 event 0x25 -> cmd 0x125 (worker 0174, below) | enemy_ai.js `playerHitCues` / `playerCue` / `gatedCue`, VM ops 37 / 41 / 45, cmd 0x125 | bt_v000 / 001 / 002 |
| melee swing / hit | none: no SE between f1455 and f1463 in w172_melee (only footsteps fsj_057 and the later shots) | nothing to do | — |

Cue sounds: `FUN_00341330(C, cue)` reads C+0x7ec = stage section 0x1a record (`FUN_003116d0`, set by `FUN_003405f8`
from C+0x766): s16 count, then 8-byte names at +8 + cue x 8; '?' = event 0x25 to the object's script; otherwise
`FUN_00341268` -> `FUN_0054b158` plays it at the object's position (`FUN_0054ae78`). Cues 0x00-0x3f are footsteps,
0x56-0x6d hit sounds by body part (played from the reaction motions `FUN_00595a60` / `FUN_00595ea8`). Not exported yet.

Name tables (worker 0173): the ELF tables 0x46e5b8 / 0x46e5f8 / 0x4a1310 are exported to ai.json `se` (`gun`, `wall`,
`mat_kind`; export_web_triggers.py `se_tables`, reads elf/SLES_541.85) and 0x4a11f0 / 0x4a1218 to weapon.json `se_draw` /
`se_holster` (export_web_aim.py). The JS holds only the indices; without the data those sounds are skipped (warned).

### Wall impact draws (worker 0173)

`FUN_0054ff50(b, end, normal, 0)` draws the shared RNG (`FUN_0040b5c0`) in this order:
1. the variant: `FUN_0033d528(mat, (int)(r x 2) != 0, end)`;
2. `FUN_00335f40(end, normal, b, 0)` (impact effect `FUN_00336478` / `FUN_003366b8` -> `FUN_002e7660`, no draws) runs when
   +0x120 bit 2 is clear or `FUN_003354b8()` (`FUN_00242420() == 1 ? DAT_0046e530 : 0`) != 0; with +0x120 bit 0x10000
   clear and param_4 == 0 it calls `FUN_002e2840(end, normal, mat)`: for mat != 6, when `FUN_00249148` gets a heap node,
   `FUN_002e0160` (the bullet-hole decal) draws twice: scale 0.2 + 0.2 r, spin r x 2 pi;
3. mat 6 (and +0x140 bits 7-10 not 6 / 4): `FUN_00550098(.., 0)` -> `FUN_0026a980` -> `FUN_00268f18` -> `FUN_002e28d8`
   (and `FUN_00305c78`) draw more; its own `FUN_0040b5c0` x 3 runs only with param_5 != 0 (0 here). Not translated.

Trace w173_rng (script w173_rng: engage8 inputs to f870; `TRACE_FIELDSET=enemy TRACE_RNG=1 TRACE_LOG_AT=9E000
TRACE_CALLLOG=rng TRACE_CALLLOG_FRAMES=800:870`): fields `rng_state` (624 words at DAT_004fbe00) / `rng_idx`
(DAT_004fc7c0) per record, call-log set `rng` (every `FUN_0040b500` result inside `FUN_0040b5c0`, and which of
`FUN_0054ff50` / `FUN_002e0160` / `FUN_00550098` drew). From f828 to f870 the game draws 30 times: 6 per Vincent shot (f831,
f861: the cone, 2 per pellet) and 3 per wall impact (f834-836, f864-866), nothing else. enemy_ai.js `GameRandom` loaded
with record f828's state gives those 30 words bit for bit, and the page (test_combat_sound) draws the same values in
the same order and picks the game's sounds: 022 021 021 / 022 021 022. Note: this run is not w172_sound3's frame for
frame (the soldier fires at f800 instead of f875, and f835 picks 021 there vs 022): the hooks cost EE cycles, so
compare a run only with its own call log.

Browser rule: an AudioContext starts only after a user gesture. play.js makes it on the first key / click (the
page's click-to-look already asks for one); requests before that are dropped. Sound is on by default; `?sound=0` off.

## Vincent's hit voice (worker 0174, decoded and verified)

Bullet (FUN_005720c8 -> FUN_0055db50) and melee (FUN_0055eac8) hits both reach the damage vt+0x1ec `FUN_0055c7f8`,
which calls vt+0x324 `FUN_00576ac8(P, dmg, dead)` (dead = HP 0 after the hit; the decomp lost the arguments, the
disassembly passes a0-a2 through) -> `FUN_0055c978(P, dmg, dead)`:

1. alive only: `FUN_00341330(C, 0x44)` (cue 0x44 = '' in Vincent's table: nothing), then `FUN_003412d0(C, 0x4c, 0)`:
   runs the cue only when more than 14 frames passed since C+0x810 (manager frame DAT_0046e880+0x20; it stamps
   C+0x810 whatever the cue does). Then script event 8 (r0 = dmg): none in his scripts.
2. vt+0x344 `FUN_00576c28` when dmg > 0 (and again in FUN_00576ac8): `DAT_0046e54c |= 4` when DAT_00470290+0x30 != 0.
   No reader on the page. Then `FUN_003b4ea8(DAT_00471380)`: only when `FUN_00242c28() > 1` (DAT_0046b328 = 1 in the save).
3. melee: FUN_0055eac8's own cue 0x44 / 0x4c gate (0x55ec70-0x55ecf4) is NOT on the damage path: it is the
   P+0x28 bit 0x20 branch, which skips vt+0x1ec; the damage branch jumps over it (`b 0x55ecf8`). (Worker 0178 review:
   0174 had it repeating after the damage.)

Cue table: C+0x7ec = stage section 0x1a record C+0x766 (= 9, save RAM), 126 cues; 0x4c / 0x4d = '?'. `FUN_00341330`'s
'?' sends event 0x25 (r0 = cue, r1 = 0) to C+0x7dc = P. The actor dispatch `FUN_00568f98` (vt+0x2f4) runs the object's
own script (P+0x34 = 246: events 0x3a, 0x18 only) and, when it has no such event, the parameter set's script
(status +0x9c -> section-0 record 55, +0x7c = **297**). Script 297, event 0x25 (its only one):
`switch (r0 - 76)`: 0 (cue 0x4c) -> `rand_i(6)`: 0 / 1 / 2 -> bt_v000 / bt_v001 / bt_v002, 3-6 -> nothing;
1 (cue 0x4d, not on the hit path) -> `rand_i(3)`: bt_v004 / bt_v005 / bt_v006, 3 -> nothing. Each name: `send 0x125` to
itself = `FUN_0054cd70` case 0x125: `FUN_0033cc48(r0, FUN_0054a720(obj), 1)` (+0x90 position).

**cmd 0x125 in general** (worker 0178): r1 != 0 -> `FUN_0033cc48(.., 0)` keeps the slot, `FUN_003e8ec8(r1, DAT_0047d728,
slot)` sets its range (slot +0x10; FUN_003e8bc8 opens it at 400.0) when 0.1f < r1, `FUN_0033cf50` releases it. r1 is a
float cell (op 5) in all z128 calls: 800 / 1000 / 7000 / 10000 / 15000 (stage trigger scripts and soldier death / mail
scripts; Vincent's 297 passes none). Position = obj+0x90: a trigger's is its section-8 matrix row 3 (`FUN_005503e8` ->
`FUN_0054b7c8` copies the matrix to +0x60..+0x9c); an inactive record's is taken as its placement position (L). The page
plays nothing (warned) for an object with no such position. `FUN_003412d0` (the gate) has 8 other callers that stamp
C+0x810 (death, cues 0x4d-0x52: fidelity-audit 'C+0x810 stampers'), likely the 3035 below.

VM ops decoded here (handler table 0x4a2f60: 8-byte entries, the handler at +4): **41** rand_i `0x370d00`: top word v
-> `(int)((float)(v + 1) x FUN_0040b5c0())` (one draw of the shared RNG; cvt.w.s chops); **45** switch `0x370f58`: pop v,
table at data + imm x 8 = (count, default, targets...), 0 <= v < count -> targets[v] else default (instruction index);
**37** `0x370af0`: push (data + imm x 8, type 3). Data block = function + [+4], [+0xc] bytes (ai.json `fn.data`).

**Verification.** w172_sound3 (k_enemy_engage8 inputs): bt_v002 at f789 at Vincent's position, no voice at the f1011
hit. New call-log set `pain` (calllog.py: draws, cues, script rand_i, damage, hit direction, effect spawns), traces
w174_pain_a / w174_pain_m (the hooks move the run: the soldier hits at f952 / f1525 instead; no melee hit in either):
order cue 0x44 -> gate (C+0x810 = 359 = the save) -> rand_i inside it; f952 r = 0.757431 (word 0x49e0f382, the page's
FUN_0040b5c0 conversion matches) -> 5 -> no voice, as the game. f1525: r 0.795133 -> 5 -> none. Open: in w174_pain_m
C+0x810 was 3035 before the f1525 hit with no gated cue logged from f1440; some earlier write (before f1440, or
another writer) is not found.

## Music and ambience (worker 0177, decoded and verified)

**The BGM streams are plain ATRAC3, scrambled, decoded on the EE, played at 48 kHz.** The old reading
(native/assets/audio/FORMAT.md §1/§5: "ATRAC3plus, 44.1 kHz, no EE decoder") was wrong: byte 0 = 0x01 on every frame
is the scramble, and `libat3dec.c` (assert string 0x4afc20) is in the main ELF.

| step | code | what |
|---|---|---|
| script | ev0101 `KerberosSound.playMusic3("bgm_001", 0, 4000)` (end of the opening event; class 0c064001); ev0100 (zone flow, 0c064000) `playBgAreaSound("asj_033")`, then per battle section `playMusic3("bgm_001", 3, 2500)` or `KerberosZone.peace()` + `changeMusicVol(3, 2500)`, later `changeMusicVol(0, 2500)` | KerberosSound natives: table 0x470738 (cls, name, fn), names XOR 0xab; args are read last to first (FUN_003a9f48 / FUN_003a9f10) |
| playMusic3(name, vol, fade) | FUN_003a0198 (DAT_004efba0 +0x156c == 0, as in the save; != 0: stopMusic, then FUN_003ec500 if the row has flags 0x84): fade < 1 -> FUN_003ec500(name, vol) -> FUN_003ec6f8(file, loop, vol, 1) (opens the stream only if none is open, DAT_004fab80 == 0; else nothing; its FUN_003ed740(vol, 100) ramps vol -> vol); else FUN_003ec560 -> FUN_003ec0d8: a crossfade running (DAT_004fab84) -> return; no stream open -> FUN_003ec6f8(file, loop, vol, 1), start now, no fade (z128's ev0101 call: worker 0182, below); else the crossfade (crossfade over `fade` clock units, curve 0x47d770 / 0x47d780, 4 points at 0, T/4, T/2, T; second stream DAT_004fab84 mixed by FUN_003eb52c / FUN_003eb544, swapped in when done). playMusic2 = FUN_003a02b8 (no fade); stopMusic = FUN_003ebfa0; changeMusicVol = FUN_003a5308 -> FUN_003ed740(vol 0..63, time): linear ramp DAT_004faba4 -> DAT_004faba0 applied per frame in FUN_003ed000 | |
| file | FUN_003ec680 (sdb row: +0xc bit 0x10 -> loop start +0x10 / end +0x14, flags +0xc), FUN_003eb9a0 (row +8 = FileCode 0x0680fe01), FUN_003ebd40: byte 1 = 0xfe if DAT_0047d714 != 0 else 0xfc. DAT_0047d714 = the sound output setting (FUN_003e7778, also IOP request 0x1b; 2 in the save). The 0xfc files are the `m` files: exact mono (L = R) | data/zone/z128/sound/bgm_NNN.at3 / bgm_NNNm.at3 |
| read | FUN_003ebda0 -> FUN_0024f870(file, buf, 0x6000, start x 0x180, end x 0x180) -> FUN_0024d730: 64 frames per read, 4 buffers; at `end` the position jumps to `start`. Without the loop flag (+0x224 = 0) it zero-fills past the file end and stops | trace w177_loop |
| descramble | FUN_003eb9e8(frame, 0x180, K = 0x4fabc0): per 0x60 bytes, q0 ^= K, qi ^= q(i-1) ^ D(i-1) (q = the 16-byte words before any write; D0..D4 = 0x47d7d0..0x47d810). K = FUN_003edb18: K[i] = byte 0x47d7c0 + (i & 15) + ((i ^ 15) & 15) x 16 (bgm.py reads it from the ELF at run time; the save's 0x4fabc0 holds the same key) | every 0xc0 unit then starts with the ATRAC3 sync 0x28 |
| decode | FUN_003ebaa8(stream, fade?) -> FUN_00458e80(stream + 0x80): ctx +0x6800 input, +0x68c4 volume offset (stream +0x90, 0..63; FUN_00459ed0 subtracts it from every scale-factor index, clamped at 0). FUN_00458dc8 modes: 1 -> 2 ch, coding 2, 0xc0 per ch (BGM); 2 -> 2 ch, joint stereo 0x12, 0x60; 3 -> 1 ch 0xc0 (title.at3); 4 -> 1 ch 0x60 (.at2 voice / SE streams, FUN_003ea640). Output: 4 x (256 L, 256 R) s16 per frame into the PCM ring DAT_0047d754 = 0x1fa0000 (8 slots of 0x1000 after a 0x20 header: u16 write, u16 read, u32 frames). FUN_003eb330 mixes the .at2 streams (6 channels) into the same slot | |
| IOP | FUN_003ed8e0 -> FUN_0041ae50(1, slot, DAT_0047d768 (0..15), 0x1000): the PCM goes to the IOP (FUN_0041ae50 averages L and R when DAT_0047e86c == 1). Volume: PTR_0047d7a0 (FUN_003ed7d0(0x7f) at the title) -> FUN_0041af80(0x14, 0x7f) = IOP command 0x34 -> irx FUN_00010394(time 0x14, vol 0x7f): ((vol + 1) << 8) - 1 = 0x7fff, ramped over 20 driver ticks, sceSdSetParam 0x0f81 / 0x1081 (core 1 BVOLL / BVOLR: the sound-data input) | the page: gain 0x7fff / 32768 on the voices' scale (audio.js: voice 0x3fff = 1.0) |

**Ambience.** `playBgAreaSound(name)` -> FUN_0039dd80 -> FUN_003e6c88(name, vol): the same name only refreshes the
volume (FUN_003e8b70); a new one stops the old (FUN_003e65b0), opens an emitter slot (FUN_003e8e18) and
FUN_003e9c38, sets fixed volume min(vol, 0x7f) (slot flag 0x40, vol << 7) and 0x20000 (FUN_003e8f00: sent as request
0x17). Save state: DAT_004f5a20 = "asj_033", DAT_004f5a28 = 255, slot 3 (mgr 0xa3a7c0 + 0x10 + 3 x 0x70) flags
0x22bfe1 (fixed vol 0x7f, 0x8000 no position -> pan 0x40, 0x200000 no Doppler), SE 10011, voice handle 0x20.
asj_033 = SE 10011: 6 tracks, each an endless 0x06 loop, with pitch / volume slides, LFOs (0x40 / 0x48 / 0x4b, not
ported) and op 0x78 randomisation. Other natives seen in scripts, not used in z128's gameplay: playBgSound
(FUN_0039de38 -> FUN_003e6d70), setBgSoundVolume, stopBgAreaSound (FUN_0039ddf0), enableDucking.

**Verification.**
- Save state: the live key equals FUN_003edb18's; the stream struct (DAT_004fab80 = 0x9ac480) holds BGM_001.AT3,
  loop 0x1a28 / 0x3a60, vol 0; the ring says 1237 frames decoded, last from input 0x96f480 (= frame 1236 of the file,
  descrambled in place) into slot 3. Our decode of frames 1230-1236 equals slots 5..3 within 18 LSB (mean 4) after a
  sign flip: libavcodec's atrac3 vs Sony's fixed point. `python3 -I tools/audio/test_bgm.py`.
- Trace w177_music (TRACE_FIELDSET=music, idle 280 frames): 46.77 frames decoded and sent to the IOP per second =
  47,897 samples / s, i.e. 48 kHz (44.1 kHz would be 43.07).
- Trace w177_loop (TRACE_POKE="4c2694=56fa00": file read position -> frame 14844): reads 14844 -> 14908, then 36
  frames to the end 14944, wrap to 6696, +28 -> 6724; no reset of the decoder (FUN_00458dc8 runs only at stream start).

- z128's start (worker 0182): ev0101's playMusic3("bgm_001", 0, 4000) took FUN_003ec0d8's no-stream branch, not the
  crossfade. In the save, DAT_004fab8c (the crossfade start clock, written only in that branch; DAT_004fab90 too) is 0,
  and the ring's frame count (0x1fa0004 = 1237, reset to the loop position by FUN_003ec6f8 and not by the crossfade)
  equals bgm_001's own read position (frame 1236). So the music starts at full volume, no fade-in.

**On the page** (music.js; extractor tools/audio/bgm.py -> data/audio/bgm/, declared in se_z128.json "bgm"): bgm_001
starts (playMusic3("bgm_001", 0, 4000), as ev0101) on the first key / click
(GUESS: the game's stream runs from zone load) and loops [6696 + 4, 14944 + 4) frames; the 4 seam frames after the end
are re-decoded with frame 14943's decoder state (bgm.py checks that 4 frames are enough: the re-decode then equals
the first pass). asj_033 streams through the SE driver translation (audio.js `SeRenderer.start` / `tick`, split out
of `render` with no change: all 609 z128 programs render bit-identically). `?sound=0` turns both off.

Not on the page: crossfades with a stream open, volume offsets / ramps (both refused with a warning), the mono setting, the
battle / peace switching in ev0100 (event scripts), the decoder itself (libavcodec instead; running FUN_00458e80
through port/recomp would make it exact).
