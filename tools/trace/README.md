# tools/trace: per-frame gameplay oracle from the real game

The GS dumps check rendering; these traces check gameplay. `trace.py` boots PCSX2 headless
from the z128 (sea-of-flames) save state, plays a scripted pad input, logs the player,
motion, cape and camera every game frame, and writes JSONL. Traces are game-derived, so they
go to `tools/trace/out/` (ignored by the default-deny `.gitignore`). Never commit them.

```
python3 -I tools/trace/trace.py tools/trace/scripts/b_walk.json        # -> out/b_walk.jsonl
python3 -I tools/trace/summarize.py out/b_walk.jsonl --from 0 --to 60   # compact table
python3 -I tools/trace/summarize.py --diff out/b_walk.jsonl out/b_walk2.jsonl
```

## How it works

1. **Input injection (the least invasive way that is also deterministic).** The game reads
   port 0 once per frame in FUN_00257de0 with `jal 0x443b50` (scePadRead) at **0x257ebc**;
   the 32-byte buffer is the pad record at 0x4e1900 (FUN_00257a68, called from the per-frame
   pad update FUN_00254638). `hook.py` rewrites that one `jal` to a small MIPS routine at
   0x96000. The routine calls the real 0x443b50 first, so the IOP side is unchanged. It then
   copies 18 bytes from the script table over buffer +2..+19 (buttons active-low, RX RY LX
   LY, DualShock 2 pressure bytes) and appends one log record. Everything lives in EE RAM
   0x96000-0xfffff (zero in the state, below the ELF's 0x100000 load address), written into
   a copy of the .p2s **before** it is loaded. Input therefore starts on the first pad poll
   after the load, with no host timing involved.
   - Not used: xdotool key presses (documented in notes/pcsx2-headless-setup.md; host
     timing jitter, and the keyboard only gives full-deflection sticks); PINE writes to the
     pad buffer (they race the IOP DMA). PINE is used only to *read* the log back.
2. **Logging.** The hook copies a table of (address, words) pairs (`fields.py`) into a
   record per frame: frame index, the injected pad bytes, then the fields. The log is read
   over PINE when the frame counter at CTRL+4 reaches the script length. Records carry their
   index; `trace.py` rejects a log whose indices don't match.
3. **PCSX2.** v2.9.127 AppImage (extracted), OpenGL renderer on Mesa llvmpipe, under a
   private Xvfb (:97) started by `pcsx2_service.sh`. PCSX2 must run as a systemd user unit,
   because the Claude Code Bash tool kills a PCSX2 launched from a command (see the setup
   notes). The unit `~/.config/systemd/user/pcsx2trace.service` sets
   `XDG_CONFIG_HOME=tools/trace/out/env/cfg` (its own PCSX2.ini: BIOS folder, `EnablePINE = true`,
   `Renderer = 12`). It reads `PCSX2_DIR`, `ISO`, `STATEFILE` and `LOG` from
   `tools/trace/out/env/trace.env`; `trace.py` rewrites STATEFILE per run and starts and stops the
   unit. The unit file text is at the end of this README. The save state was written by
   PCSX2 2.8.2 (savestate version 0x9a59); 2.9.127 loads it.

Script format (`scripts/*.json`): `frames` (game frames = pad polls), optional `log_from`
(earlier frames get input but no record; the log area holds about 290 records), and
`events` `{from, to, buttons: [...], lx, ly, rx, ry}`, active on frames from <= f < to.
Sticks are -1..1 (up = ly -1). Buttons: cross circle square triangle l1 l2 r1 r2 l3 r3
start select up down left right.

## Timing (PAL SLES_541.85): measured, and decoded from the code

- **One record = one game frame = one 50 Hz vblank.** Every record of every run has
  `step` (DAT_004eeb24) = **1.2** ticks, i.e. 1 vblank per frame × 1.2 (FUN_0040ce28 /
  FUN_0040cb78). The PAL game ran at a constant 50 fps in all runs here, with no dropped
  frames. Emulated time = frame / 50 s; game ticks = Σ step = 1.2 × frame (60 ticks per
  second). The game keeps no tick counter that we know of: the "tick counter" in a trace is
  Σ step.
- Host speed doesn't matter. PCSX2 ran at about 7 game frames per host second here
  (llvmpipe), and the result is the same.

## Measured (sea-of-flames state, PAL; numbers from out/*.jsonl)

| quantity | game | how |
|---|---|---|
| frame rate / step | 50 fps, step 1.2 ticks every frame | `step`, all runs |
| run speed (full stick) | **60.0 u/s = 1.0 u/tick = 1.2 u per 50 Hz frame** | C+0x1d8 and position deltas, c_run |
| walk speed | **15.0 u/s = 0.25 u/tick = 0.30 u/frame**, at stick magnitude 0.21 AND 0.77 (walk/run is a threshold, not continuous) | b_walk, g_ladder_route |
| walk accel/decel | ±1.85 u/s per frame (0 → 15 in 8 frames); walk → run is an instant jump 14.8 → 60 when h_rn starts | b_walk, c_run |
| clip frame advance | `frame += rate × weight/128 × DAT_004fc7e8`, **FUN_005aa2a8**, called by the per-frame motion update **FUN_005aa5b8** | decoded; matches every record |
| rate (MP+0x40c) | **0.5** for h_st, h_rn, h_jp*, h_st_a/_f; h_wk scales with speed (0.4823 at 15 u/s) | mp_rate |
| → clip frames per real second | h_rn **30/s** (0.6 per 50 Hz frame, 0.5 per tick); h_wk 28.9/s; idle 30/s | mp_layers frame deltas |
| loop wrap | frame resets to exactly 0 when it reaches the clip length; the remainder is dropped (FUN_005aa2a8 loop branch) | h_wk 39.93 → 0.00 |
| cape | **cloth-simulated in a settle window, keyed outside it.** Window MP+0x434/0x438 armed at clip start (h_wk 60, h_rn 28, a facing turn 100), counts down **1 per frame (50/s)**. In the window the hem leaves its keyed target by up to 2.7-3.0 u; after it, pos == target exactly. **Not re-armed when a clip loops** (h_rn wrap at frame 48, h_wk at 153) | cape_pos/cape_target, mp_cloth |
| cloth step | FUN_005b2550 → FUN_005b0d30 → FUN_005b0b38 (integrate: v.y += 0.2 once per call, gated on step ≠ 0, NOT scaled by the step; v = Δpos × 0.1), FUN_005b09f8 ×4, FUN_005b0c50 (pull toward target). One step per drawn frame: 50/s on PAL. The sim is skipped when DAT_0047e1e0 ≥ 2 (frame-drop counter, FUN_0040ce28) unless k = 1 | decoded |
| standing jump | lift-off 2 frames after ✕ (state 8), apex **13.09 up** at +17 frames, 36 frames airborne; movement mode stays 0xc | e_jumps |
| running jump | the same arc; horizontal 1.2 u/frame (60 u/s) kept in the air; slides along walls while airborne | e_jumps (attempt 2) |
| fire (R1) | 1st press only raises the gun (state 3, h_st_a); later presses fire (h_st_f + _fu/_fd partners). Mid-air R1: air-shot counter P+0x270 → 1, **no hop** (apex unchanged) | h_fire |
| right stick | orbits the camera only, up to about 3.3°/frame; the character's heading doesn't change while standing | d_turn_circle |
| `ground_speed` caveat | reads the commanded speed (C+0xcc × 60) when blocked: 15.0 while pinned on a wall | d_turn_circle, f_railing |

Scripted runs (`scripts/`): a_idle, b_walk, b_walk2 (determinism), c_run, d_turn_circle,
e_jumps, f_railing, h_fire, g_ladder_route / g_ladder_route2. (g) was **not reached**: two
route attempts. The second froze the player at x = −1186 with the stick held (speed and clip
frozen, step still 1.2; probably a scripted story trigger), 76 units short of the ladder
bottom (−1110.4, −89.1, −1105.6).

## Determinism

`b_walk` run twice (same script, separate PCSX2 boots): **identical over all frames, every
logged field bit for bit** (`summarize.py --diff`). The trace is a pure function of
(state, script).

## Fields

Bases come from the save state, resolved the way the game resolves them
(`fields.resolve_bases`):

- **P (player) = 0x1339e0.** FUN_0053bb08(DAT_0046e880 = 0x128380): entry *(+0x18) = 22 of
  the table at *(+0x1164) (FUN_0053e040). Then vtable+0x94 (0x579ae8) and vtable+0x9c
  (0x579b18, the call in FUN_00333150) are both `jr ra; daddu v0,a0,zero`, so they return
  `this`. The resolver checks those two instructions.
- **C (character/body) = *(P+0xe8) = 0x919560.** FUN_00333150 and FUN_00575768 read it.
- **Body (physics, mode 0xc) = C+0x3b0**, passed to FUN_003590c8 by FUN_0034c388.
- **CAM = *(DAT_0046e290 + 0x40) = 0x95efe0.** FUN_00333150 and FUN_00326920; CAM+0x54 =
  P (FUN_0032ace0 line 209), which the resolver checks.
- **MP (motion player) = *(C+0x7c8) = 0x14d8180** (FUN_003449a0 → FUN_005a91c8).
  MP2 = *(MP+0x3e8) (child player; FUN_005a91c8 recurses into MP+1000..).
- **CAPE block = 0x18f9d60**, runtime buffer *(+0x1c) = 0x14eeec0. Found by signature
  (`SM2`, 82 cloth vertices, 1 group, group gravity 0.2), not through a game pointer chain:
  that chain (FUN_005b2ef8: *(model+0x10)[i]) isn't traced to a global yet.

Confidence: D = decoded (code read, meaning clear); L = likely (code read, meaning
inferred); G = guess (layout seen in memory only).

| field | address | type | conf | source |
|---|---|---|---|---|
| step | 0x4eeb24 | f32 | D | FUN_00322f88 writes DAT_004eeb24 = vblank step x 1.2 (PAL), cap 5 |
| dt | 0x4eeb28 | f32 | D | FUN_00322f88: DAT_004eeb28 = step x 0.016666668 |
| pad_held | 0x4e0fd8 | u32 | D | FUN_00254638: lo16 = held (FUN_002584b0, pad+0x20), hi16 = pressed (pad+0x24); last frame's |
| lstick | 0x4e0fe8 | bytes:8 | D | FUN_00254638 -> FUN_00258218: left stick x,y floats, dead zone 0x30, scale 1/81; last frame's |
| script_flags | 0x46e298 | u32 | D | FUN_00326298 tests DAT_0046e298 bits; bit 13 = physics-body walk (FUN_0034db80) |
| p_state | P+0x100 | bytes:16 | D | FUN_00333150: P+0x104 = player state byte (8 jump, 10 ladder...); P+0x100 u64 flag bits |
| p_airshots | P+0x270 | u32 | D | FUN_00575768 clears byte P+0x270 on take-off (air-shot counter) |
| p_flags | P+0x29c | bytes:16 | L | FUN_00333150 tests P+0x2a8 bits 1/4; P+0x29c pointer |
| matrix | C+0x0 | mat4 | D | FUN_0034c388 writes row 3 (+0x30) = position from body+0x00; rows 0-2 = orientation (row 2 = facing, FUN_00575768 reads C+0x20) |
| move_dir | C+0x90 | vec4 | D | FUN_0034c388 writes the normalised move direction to C+0x90 |
| want_dir_speed | C+0xc0 | vec4 | D | FUN_0034c388 mode 0xc: step = C+0xc0 (xyz dir) x C+0xcc (units/tick) |
| mflags | C+0x1c0 | u32 | D | C+0x1c0 bit 0x200 = on ground (FUN_003543b8, FUN_00575768), 0x2000/0x4000/0x400000 tested in FUN_0034c388 |
| mflags2 | C+0x1c4 | u32 | D | FUN_0034db80 sets bit 1, clears bit 4 |
| move_mode | C+0x1c8 | u32 | D | FUN_0034db80 writes; FUN_0034c388 switches on it (10 walk, 0xb air, 0xc physics body, 0x10) |
| mode_t | C+0x1cc | f32 | L | FUN_0034db80 zeroes; FUN_0034c388 path-follow time |
| ground_speed | C+0x1d8 | f32 | D | FUN_0034c388: C+0x1d8 = distance moved x 60 / step (units/s) |
| body_pos | C+0x3b0 | vec4 | D | FUN_0034c388: body = C+0x3b0, FUN_003590c8(body); C+0x30 copied from it |
| body_10 | C+0x3c0 | vec4 | L | FUN_00357d48: body+0x10 vs body+0x00 y within 3.5 (previous/ground point) |
| body_80 | C+0x430 | vec4 | L | FUN_0034c388 tests /C+0x430/ == 0 (body+0x80; velocity-like) |
| walk_poly | C+0x4c0 | u32 | D | FUN_00357d48: body+0x110 = current walk-mesh polygon (handoff walk-mesh entry) |
| anim_flags | C+0x564 | bytes:8 | D | FUN_00344608/FUN_00340bb8 motion flags C+0x564; C+0x568 |
| motion | C+0x570 | name8 | D | FUN_003449a0: C+0x570 = current motion (8-char clip name) |
| motion_flags | C+0x580 | bytes:16 | D | FUN_003449a0: C+0x580 = play flags, C+0x588 = -1; C+0x591 blend frames (FUN_00340bb8) |
| mp_head | MP+0x440 | bytes:16 | D | FUN_005a91c8: MP+0x440 flags, +0x448 head layer, +0x449 layer count |
| mp_rate | MP+0x400 | bytes:16 | D | FUN_005aa5b8 passes f32 MP+0x40c as the rate to FUN_005aa2a8 (frame += rate x weight/128 x DAT_004fc7e8); MP+0x408 = 1.0 when no blend |
| mp_cloth | MP+0x430 | bytes:16 | D | cloth settle window: MP+0x434 total, MP+0x438 remaining (FUN_005a95f0 arms, FUN_005aa5b8 decrements once per frame, FUN_005b1128 reads) |
| cloth_k | 0x5b3b50 | f32 | D | DAT_005b3b50 = (1 - rem/total)^2 or 1.0 (FUN_005b1128); FUN_005b2550 passes it to the cloth step FUN_005b0d30 |
| mp_layers | MP+0x200 | layers | L | FUN_005a91c8: 8 layers x 0x30 at MP+0x200: +0 clip, +8 partner clip, +0x18 frame (zeroed at start), +0x1d blend frames, +0x1e flags, +0x1f weight byte, +0x24 blend length |
| mp2_head | MP2+0x440 | bytes:16 | L | child motion player MP+0x3e8 (FUN_005a91c8 recurses into MP+1000..) |
| mp2_layers | MP2+0x200 | layers | L | same layout as mp_layers |
| cape_vel | CAPEBUF+vel[62,63,64,73] | cape | L | FUN_005b0b38: velocity of cape vertices 62,63,64,73 (v.y += gravity once per call; v = dpos x damping 0.1) |
| cape_pos | CAPEBUF+pos[62,63,64,73] | cape | L | FUN_005b0b38/FUN_005b09f8/FUN_005b0c50: simulated position (world) |
| cape_target | CAPEBUF+target[62,63,64,73] | cape | L | FUN_005b0c50 pulls pos toward this skinned (keyed) target by max(k, blend) |
| cam_matrix | CAM+0x60 | mat4 | L | FUN_0032ace0: CAM+0x90 = eye (w set to 1.0 at the end), CAM+0x80 = forward (yaw from FUN_00260f00); rows +0x60 right, +0x70 up |
| cam_a0 | CAM+0xa0 | vec4 | G | point with w=1 next to the eye (target?) |
| cam_fov_pitch_yaw | CAM+0x170 | vec4 | L | FUN_0032ace0: +0x170 divided by DAT_0046e3f0 (base FOV 65) -> FOV deg; +0x174 pitch (clamped +-54 deg); +0x178 yaw |

Notes on the log:
- A record is taken at the pad poll, **before** that frame's logic. Its state is the result
  of the previous frame; `pad_in` is the input this frame's logic will see. `pad_held` and
  `lstick` are the processed values from the previous frame (FUN_00254638 runs after the
  poll).
- Motion layers: `mp_head` byte 8 = head layer index (MP+0x448), byte 9 = layer count. The
  playing clip is `mp_layers[head]`.

## Undecoded or partial (stand-ins are labelled in the code)

- Camera: eye (CAM+0x90) and the basis rows are L; CAM+0xa0 is G; FOV (CAM+0x170 = 73.5 at
  the start, read with DAT_0046e3f0 = 65) is L. The render-side view object
  *(DAT_0046e290+0x44) isn't decoded.
- Layer fields +0x10, +0x14, +0x20 and +0x28.. have no decoded meaning (logged raw).
- MP2 (child motion player): role not decoded.
- Cape: the block is found by signature (see above).

## Unit file

```
[Unit]
Description=PCSX2 DoC trace oracle (dirge-port tools/trace)
[Service]
Type=simple
Environment=XDG_CONFIG_HOME=/srv/games/dirge-port/tools/trace/out/env/cfg
EnvironmentFile=/srv/games/dirge-port/tools/trace/out/env/trace.env
ExecStart=/srv/games/dirge-port/tools/trace/pcsx2_service.sh
KillSignal=SIGKILL
TimeoutStopSec=5
Restart=no
```

### Enemy set (TRACE_FIELDSET=enemy, worker 0116)

Logs the enemies that are active in the loaded state (`fields.find_enemies`, up to 7) as
`e<k>_*` fields; the header's `bases` gives each one's object-table index (`EI<k>`).
Enemies activated during the run are not traced (fixed addresses). See
notes/enemy-research.md §6. Script: scripts/k_enemy_engage*.json. k_enemy_engage7 (worker
0119) climbs the ladder and crosses trigger volume 95 (x -1074, y -146): e027 #66/#67 wake at
frame 784 (AI mode 2, target player) and fire; see §8 and tools/stage_events.py. k_enemy_engage12 (worker 0124) kills #66, sweeps the aim onto
#67 (new fields `cam_fwd`, `cam_eye`) and records its non-lethal hit and death (§10).

### Push-out fields (TRACE_PUSH=1, worker 0154)
With `TRACE_FIELDSET=enemy`, `TRACE_PUSH=1` adds the actor push-out state (FUN_00542ab8): Vincent's `p_a28`,
`p_cyl` (+0x2c radius, +0x30 height, +0x38), `p_a118`, `p_push` (+0x130), `p_c430`, `p_c1c0`, and per soldier
`cyl`, `a118`, `push`. Script: k_push16 (run into #66 on the ladder top; use TRACE_ENEMIES=2).

### Call logger (TRACE_CALLLOG, worker 0127)

`TRACE_CALLLOG=<set>` (sets in `calllog.py`: `bullet`, `spread`) wraps chosen game calls, either a
`jal` site inside a function or a vtable slot, with a stub. The stub calls the real function and logs
a0, a1, v0, f0, f12 and up to 25 words read through the argument pointers after the call. Entries
are only taken in `TRACE_CALLLOG_FRAMES=lo:hi` and are written to `<name>.calls.jsonl`. The log uses
the top 0x30000 bytes of the frame-log area, and scripts must be ≤ 1000 frames. Used for
notes/enemy-research.md §11 (scripts k_bullet1 / k_bullet2).

### Effect spawn call log (TRACE_CALLLOG=fxsrc, worker 0193)
Hook kind `sites` patches an explicit list of `jal callee` addresses (no range scan); `cpr("ra")` logs the caller
(ra - 8 = the site). Set `fxsrc`: every ELF jal to FUN_002e62b0 / FUN_002e6290 (id in a2), FUN_003366b8 /
FUN_003365e0 (id in a0), and `wall_fx` (FUN_0054ff50 -> FUN_00335f40: end point, normal). Scripts (env in each doc):
w193_fxsrc (w174_pain_a's inputs), w193_fxhits (w172_hits'), w193_floor (w172_sound3's route, pitch down / up, a shot
after each);
notes/effects-research.md 'Bullet end, floors, soldier hits'.

### Menu sound call log (TRACE_CALLLOG=menusnd, worker 0194)
Set `menusnd`: `menu_play` (FUN_003e1d90 -> FUN_003e9e60: name, x, y), `menu_req` (FUN_003e9ed0 -> FUN_003e7850: id, pan,
vol), `se_send`, `se_pause` / `bgm_vol` (FUN_00241f40 -> FUN_003e86e0 / FUN_003ed7d0), `bvol_send` (FUN_003ed8e0 ->
FUN_0041af80). Script w194_menusnd (pause, cursor, box, cancel, resume; `log_from` 260: the call log covers all 400 frames).
Run with the sandbox off. notes/audio-research.md "Menu sounds".

### Sound call log (TRACE_CALLLOG=sound3, worker 0172)
Set `sound3` logs every new SE: `play_name` (FUN_0033cc90 -> FUN_003e8e18: sdb name, emitter position, slot), `slot_open`
(FUN_003e8bc8 -> FUN_003e9b80: the sdb name of every new slot, whatever the caller), `se_new` (FUN_003e9220 ->
FUN_003e7810: SE id, pan, volume), `se_send` (FUN_003e80d8 -> FUN_0041a190), `se_range` (FUN_0033ced0) and once a frame
`listener` (FUN_00246c98 -> FUN_003e9ed0: mgr +0x3810 / +0x3820 / +0x3850 / +0x3890). New in calllog.py: `cpr(reg)`
copies the register's own value (descriptor n bit 7) instead of memory at it. Scripts w172_sound3 / w172_hits /
w172_melee (env in each script's doc); notes/audio-research.md "3D volume / pan".

### Shared RNG (TRACE_RNG=1, TRACE_CALLLOG=rng; worker 0173)
`TRACE_RNG=1` adds `rng_state` (the Mersenne twister's 624 words at DAT_004fbe00, hex) and `rng_idx` (DAT_004fc7c0)
to every record; with `log_from` near the end the log still fits (w173_rng: 42 records with the enemy set). Call-log set
`rng` logs every draw (`draw`: v0 of `FUN_0040b500` inside `FUN_0040b5c0`) and the impact callers (`wall_rand`
`FUN_0054ff50`, `decal_rand` `FUN_002e0160`, `mat6_rand` `FUN_00550098`, each logged just after its `draw`). Script
w173_rng; notes/audio-research.md "Wall impact draws". The added hook cycles change the run (compare it only with itself).

### Hits on Vincent (TRACE_CALLLOG=pain; worker 0174)
Call-log set `pain`: `play_name`, every RNG `draw`, the cues (`cue` = FUN_0055c978's FUN_00341330, `cue_gated` = inside
FUN_003412d0 with C+0x810 before the stamp), `script_rand` (VM op 41's FUN_0040b5c0: f0), `p_damage` (vt+0x1ec, a1 = damage),
`hit_dir` (FUN_003af6b8: a1 = angle, HUD +0x230..), `fx_new` (FUN_003366b8 from FUN_003361b8: a0 = effect id), `hit_fx`
(FUN_003361b8 from FUN_0055db50), `fx_1000` (FUN_00336508). Scripts w174_pain_a (engage8 inputs) / w174_pain_m (k_melee18
route and pokes): the hooks move both runs (hits at f952 / f1525; no melee hit). notes/audio-research.md "Vincent's hit voice".

### Enemy motion-player fields (TRACE_EMP=1, worker 0149)
With `TRACE_FIELDSET=enemy`, `TRACE_EMP=1` adds per soldier `mp_head` (MP+0x440..0x44f: +0x448 head layer,
+0x449 count, +0x44a blend-out layer) and `mp_layers` (8 x 0x30 at MP+0x200, decoded as for the player),
MP = C+0x7c8. With `TRACE_ENEMIES=2` a record is 1448 bytes. Script: k_fire_emp15 (engage8 to f830).

### Lock-on fields (TRACE_LOCK=1, worker 0141)
With `TRACE_FIELDSET=enemy`, `TRACE_LOCK=1` adds the camera's lock state (`cam_170` = CAM+0x170..0x22f,
`cam_a0` = CAM+0xa0..0xff), `p_8`, `p_272`, `p_vel`, `p_st64`, `hud_60`, `ret_1b0` and per soldier `a38`,
`par`, `c764`, `vel` (fields.py has the meanings). `TRACE_ENEMIES=n` traces only the first n soldiers
(default 7) so more frames fit in the log (n = 2: about 189 frames). The call log needs room of its own
and doesn't fit next to these. Scripts: k_lock13 (lock, swing off, re-lock), k_lock14
(locked shot kills #66, reticle rests on the corpse).

### Push into the step (TRACE_PUSHSTEP=1, TRACE_CALLLOG=pushstep, TRACE_POKE; worker 0158)
With `TRACE_FIELDSET=enemy`, `TRACE_PUSHSTEP=1` adds `move_dir`, `want_dir_speed`, `ground_speed` and the
physics body's first 0xc0 bytes (`body`, C+0x3b0). Call-log set `pushstep`: FUN_0034c388's FUN_00358fb8
(`set_step`: the step in, body+0x30 / +0x80 / +0xa8) and FUN_003590c8 (`body_step`: body pos / +0x30 /
+0x40 / +0x80 after), FUN_003590c8's FUN_00357d48 calls (`walk_move`) and FUN_00357d48's FUN_0035a440
(`push_out`: out, in, body+0x80, body+0xb0). A call tagged frame k moves record k-1 to record k.
`TRACE_POKE="addr=word,..."` (hex) writes EE words into the state before it loads (prints the old word),
for experiments: `46e90c=0` (push scale DAT_0046e90c, FUN_00542ab8), `46f4d0=1` (FUN_0035a440's
object pass off). Script k_push17 (k_push16 to f960, log from f790); its positions equal k_push16's
with the full `pushstep` set (an earlier run without the `push_out` hook was 0.08-0.1 u off before
contact: not chased).

### Music stream (TRACE_FIELDSET=music; worker 0177)
`bgm_ring` (EE PCM ring 0x1fa0000: u16 write / read slot, u32 frames decoded), `bgm_iop_slot` (DAT_0047d768),
`bgm_main` / `bgm_xfade` (DAT_004fab80 / 84) and `bgm_file` (the main stream's file object at 0x4c2460 in this
state: +0x220 loop start, +0x224 end, +0x234 read position, bytes = frame x 0x180). Scripts w177_music (idle 280:
46.77 frames / s = 48 kHz) and w177_loop (with `TRACE_POKE="4c2694=56fa00"`: read position -> frame 14844, wraps at
14944 to 6696). notes/audio-research.md "Music and ambience".

### Melee hit (TRACE_MELEE=1, TRACE_CALLLOG=melee; worker 0165)
With `TRACE_FIELDSET=path`, `TRACE_MELEE=1` adds Vincent's `p_hp`, `p_state`, `p_f118` and `p_pos` (P+0x60 matrix).
Call-log set `melee`: `make` (FUN_00569dc0's FUN_00541310: the 64-byte record, v0 = the object), `update` (vt+0x214
of vtable 0x58f9f0: position, +0xc0 flags / damage, +0xd0 radius .. +0xe0 life, +0xe8 owner / candidates),
`sph_capsule` (FUN_0025db68: centre, capsule a / b; f12 = radius), `hit` (FUN_0057a830 entry), `defence`
(FUN_00318120 in FUN_0055eac8), `p_damage` / `p_react` (Vincent's vt+0x1ec / +0x324) and `reaction`
(FUN_00565480). With TRACE_LOG_AT set, the call-log control block moves to just below the frame log (calllog.py),
so scripts over 1000 frames can log calls. Script k_melee18 (pokes in its doc): #66 hits Vincent at f1463.

### Soldier path walk (TRACE_FIELDSET=path, worker 0159)
`TRACE_FIELDSET=path` logs a little of the player and camera (matrix, `cam_fwd` / `cam_eye` / `cam_lock`, `cam_a0` =
CAM+0xa0 aim hit + 0xb0 far point) and per soldier the move state: `a100` (actor state, gait bits), `ai_mode`, `cmat`
(C+0x00..0x3f), `dir` (C+0x90), `mv` (C+0x1c0..0x21f: flags, move mode, segment clock / duration, speeds, polyline
index / arc, tension, turn mode), `path` (C+0x300..0x32f: mover, path, node, last), `motion`, `c590`, `mp_head`
(`TRACE_PATH_LAYERS=1` adds the MP layers). `TRACE_ERECS=46,47` picks soldiers by stage record (object index =
record + 22); set `TRACE_ENEMIES` to their count. `TRACE_LOG_AT=<hex>` (hook.py) starts the frame log later, for
scripts over 1024 frames (script frames = (LOG - 0x97000) / 24). Script w159_walk95 (with
`TRACE_POKE=9540a4=6e,10a2140=6e`: trigger 95 runs script 110) wakes 46 / 47 at f783; notes/enemy-ai-hook.md
'Path walking'.
`TRACE_PATH_BODY=1` (worker 0161) adds per soldier the AI block (`ai` +0x14..0x43: action state +0x28, distances),
`ai_e0` (brain / action / combat layer pointers), `want` (C+0xc0 move dir / per-frame distance), `bvel` / `bst` / `blim`
(body+0x30 / +0x40 velocities, +0xa8 state, +0xac flags, +0xc4 / +0xc8 limits), `c430` (actor push), `c310` / `srch`
(mover 0xd follow state, C+0x330 search request), `c398` / `a108` (nav node) and `list` (*(C+0x3a8), logged from the
word below: skip 2 bytes). Script w161_chase (frames 1280, log from 1000; `TRACE_LOG_AT=9E800`; pokes as its doc):
46 / 47 in brain mode 5 taking nav-graph paths; notes/enemy-ai-hook.md 'Nav graph and search'.

### Game over (TRACE_FIELDSET=gameover, worker 0192)
The world-mode object (FUN_00334590: state / timer), DAT_0046e290+0x4c, the end screen (PTR_0047db6c, DAT_004fadbc,
DAT_0047db78 / 84 / 88), the box slots DAT_0050db60, the sequence screen and the menu box (heap addresses of the w192
run), focus, DAT_004f3044 and the clock. Scripts w192_gameover / w192_quit (env in their docs); notes/gameover-research.md.
