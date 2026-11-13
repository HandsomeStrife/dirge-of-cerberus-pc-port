// The game's video mode: the one place the page reads its frame rate, time step, mouse factor
// and screen-space layout from (worker 0295; notes/frame-rate.md). Pure, no three.js.
//
// The ELF holds both modes. FUN_00248528 -> FUN_00242650(argv[0]) sets script flag 0x1e for an
// `S?ES` name (this SLES), FUN_00244c38 then calls FUN_0040c078(0x4fc7d0, flag ? 2 : 1), which
// stores the mode at 0x4fc7d0+0x2dc: 2 = PAL (GS CRT mode 3, 50 Hz), 1 = NTSC (mode 2, 60 Hz).
// The real disc always boots mode 2; mode 1 is the branch the NTSC release runs. Every mode
// branch below is a translated `FUN_002413c0(0x1e)` / `+0x2dc` test.
//
// Choosing it: play.html?video=pal | ?video=ntsc. The page's default is NTSC (Dan asked for 60
// fps, 2026-11-12). In node (no `location`) the default is PAL, because the node tests are the
// parity bench against the PAL traces; DIRGE_VIDEO=ntsc picks NTSC there. Read once at load,
// like the game's boot (the mode never changes after FUN_00244c38).
const f32 = Math.fround;

function pick() {
  let v = null;
  try { if (typeof location !== 'undefined') v = new URLSearchParams(location.search).get('video'); } catch (e) { /* no location */ }
  if (v == null && typeof process !== 'undefined' && process.env) v = process.env.DIRGE_VIDEO || null;
  const browser = typeof location !== 'undefined';
  if (v == null) return browser ? 1 : 2;
  v = String(v).toLowerCase();
  if (v === 'pal' || v === '2' || v === '50') return 2;
  if (v === 'ntsc' || v === '1' || v === '60') return 1;
  console.warn('video_mode: unknown video=' + v + '; using ' + (browser ? 'ntsc' : 'pal'));
  return browser ? 1 : 2;
}

export const MODE = pick();                      // 0x4fc7d0+0x2dc
export const PAL = MODE === 2;                   // script flag 0x1e
export const NAME = PAL ? 'pal' : 'ntsc';

// ---- timing
// Vblank rate of the CRT mode (FUN_0040c078: FUN_00440468(0, 1, 3 | 2, 0)). The page runs one game
// frame per vblank: TICK seconds per frame. (An NTSC PS2 field is 1/59.94 s; the page paces at 1/60.)
export const HZ = PAL ? 50 : 60;
export const TICK = 1 / HZ;
// FUN_0040cb78(1.0) (boot, 0x40c7ac): scale +0x20 = base x 1.1999999 in mode 2, else base.
// FUN_0040ce28: DAT_004fc7e8 = vblanks x scale; FUN_00322f88: DAT_004eeb24 = that step (cap 5),
// DAT_004eeb28 = step x 0.016666668 s. One vblank a frame on the page.
export const STEP = PAL ? f32(1.0 * f32(1.1999999)) : 1.0;      // 1.1999999284744263 | 1.0
export const DT = f32(STEP * f32(0.016666668));                 // 0.019999999552965164 | 0.01666666753590107
// The game's ms clocks (FUN_0023c1f0: EE timer 1 / 0x24000, whole ms, real time; read by the event clock FUN_003798a0,
// the HUD clock DAT_004f58ec, the menu clock) advance by the frame's real length. GUESS: the page's fixed game frames
// (fidelity-audit 'GUESS: the event clock's step', 'HUD clock in ms'): FRAME_MS on average, 20 PAL; whole ms, so
// frameMs() steps floor(k x 1000 / HZ) - floor((k - 1) x 1000 / HZ) on its k-th frame: 20 every frame in PAL, 16 / 17 / 17
// in NTSC. (Not a fixed 1000 x TICK step: that alternative, rejected, would truncate 16.67 to 16 in the clocks' `>>> 0`,
// 4% slow.) One stepper per clock.
export const FRAME_MS = 1000 * TICK;
export function frameMs() {
  let k = 0, t = 0;
  return () => { const n = Math.floor(++k * 1000 / HZ); const d = n - t; t = n; return d; };
}

// ---- input
// FUN_00254490: DAT_0046baac = 0x3f99999a (f32 1.2) with flag 0x1e, else 1.0. FUN_00256b08 / 60:
// pointer counts x DAT_0046baa8 x DAT_004fc7e8 x DAT_0046baac (read by FUN_002553e8 into DAT_004e1230 / 34).
export const MOUSE = PAL ? f32(1.2) : 1.0;

// ---- screen-space layout (3D <-> screen)
// FUN_0040c078: framebuffer +0x2e8 x +0x2ec = 0x1c0 x 0x200 (448 x 512) in mode 2, 0x200 x 0x1c0 in mode 1.
export const FB_W = PAL ? 0x1c0 : 0x200;
export const FB_H = PAL ? 0x200 : 0x1c0;
// FUN_0040d7f0 (world point -> screen): x - 2048 + (224 | 256), y - 2048 + (256 | 224) for mode 2 | 1.
export const SCREEN_CX = PAL ? 224.0 : 256.0;
export const SCREEN_CY = PAL ? 256.0 : 224.0;
// FUN_0032ace0 l.517-535 (screen offset <-> view angle): vertical tan(FOV x KY / 2) x y x INV_H,
// horizontal tan(FOV x KX / 2) x x x INV_W. Mode 1: DAT_0046e360..36c, mode 2: DAT_0046e370..37c (ELF).
export const ASPECT = PAL
  ? { KY: f32(1.1428572), KX: 1.0, INV_H: 0.001953125, INV_W: f32(0.0022321429) }
  : { KY: 0.875, KX: 1.0, INV_H: f32(0.0022321429), INV_W: 0.001953125 };
// FUN_00328968 (lock keep test) and FUN_0055bda8 mode 2 (probe 2): the projected point must lie in
// x (lo, hi), y (lo, hi) of the mode's screen.
export const KEEP_BOX = PAL ? [-60, 508, -110, 622] : [-60, 572, -110, 558];
export const PROBE2_BOX = PAL ? [-50, 498, -100, 612] : [-50, 562, -100, 548];
