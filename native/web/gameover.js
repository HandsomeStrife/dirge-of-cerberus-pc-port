// Game over (worker 0192): what the game does after Vincent dies, translated. Pure logic, no three.js:
// gameover_layer.js draws the menu with pause_layer.js's PauseLayer.
//
// Chain (decoded; notes/gameover-research.md, traces w192_gameover / w192_quit):
//   FUN_00334590 (world-mode object, vtable 0x4a0a78; +0x2c state, +0x2e timer, s16), once a game frame:
//     case 2: FUN_00316cf8 (P status +0x20 HP == 0) nonzero = dead -> FUN_0032a420(CAM, 1, 0, 0) +
//             FUN_00328720(CAM) (the death camera: FollowCamera.startDeath), timer 0xb4, state 3. With FUN_0055f0e0(P, 3) /
//             (P, 2) or FUN_00326068(0x14) the *state* becomes 5 / 7 instead (P flags the page never sets).
//     case 3: timer < 0 -> FUN_00241760(0, 3, 0), FUN_00324ab0(1) (DAT_0046e290 + 0x4c = 1: P+0x2b0 bit 0 clear),
//             FUN_00324a40(e290, 1) (e290+0x48 |= 2: no reader on the page), state 9; else timer -= max(1, (int)step)
//     every case falls into the tail: timer -= 1
//   FUN_004012c0 (stage loop, state 9, after the world update FUN_00322f88): DAT_0046e290 + 0x4c == 1 and
//     not yet started (DAT_0047dbb4) -> FUN_003dec80(0), FUN_003fdd58(), FUN_003fdb48(3), DAT_0047dbb4 = 1
//   FUN_003fdb48(3): end type 3, FUN_003dec80(0) (menus closed), FUN_00241760(1, 0, 0), FUN_003ad5b0 (HUD off:
//     not on the page), the voice FUN_003eb250(0x15b, 0x15e) = se_0347..se_0349 by a clock hash (an ATRAC
//     stream row, FUN_003eb088: not ported), DAT_0047db84 = clock
//   FUN_003fdf00 (the mode machine FUN_00247508 runs it first in every frame), type 3: volume 0x7f - min((clock -
//     DAT_0047db84) >> 5, 0x78) to FUN_003ea1d0 / FUN_003ed7d0 / FUN_003e62d0 (SE / BGM / ambience: not applied,
//     see fidelity-audit), the title file 0x31000fc .. (FED 0x81840000 via FUN_0037f2f0: gameover_title.js), then the box
//     of kind DAT_004a8250[3] = 6 (FUN_003b66c0 -> FUN_003c52b0 -> FUN_003c5358, the sequence screen)
//   FUN_003c6050 (sequence screen), table 0x47a130 (FUN_003c54f8 case 6): t 0: command 0xfd (FUN_003c6600 case
//     0x1a: layout 0x479190 + its text widget, empty for kind 6: nothing visible), t 4000 ms: command 0xf0 (case
//     0xd: FUN_003b66c0(.., 0x21) -> FUN_00534858 -> FUN_005348c0: the Restart / Quit box, layout 0x477c38;
//     screen mode 4), then 0xff (end)
//   Box 0x21 (vtable 0x5373e8): ✕ FUN_005349c0: widget id 3 / 7 -> 6, 8 -> 8, else 7; FUN_00534af8 (DAT_004fcaa0 =
//     0x70, FUN_002420e0(0, 1, 0), FUN_00403460: not on the page; close time + 1000 ms), FUN_003d4780 (input
//     locked); ○ FUN_00534a28 -> FUN_003e1d80 (the menu sound cleared, nothing else). vt+0x1c FUN_00534a48: at
//     the close time FUN_00534a98 -> FUN_003b7830(box, 0, result) (6 also kills FED 0x81840000 and
//     FUN_003aff20 on the HUD). The sequence screen (mode 4) sees the result: 7 / 8 -> its own FUN_003b7830 ->
//     FUN_003fdf00 case 5 (DAT_0047db88) -> the stage loop returns 4 (7: to the title) or 1 (8); 6 in story mode
//     -> the menu box goes, the sequence runs on (FUN_003c72f8: the stage result screens, not decoded).
// Clock: ms. The page passes its game-frame clock (20 ms a frame: the HUD's GUESS row; traced 18-20 ms).
import { PauseScreen, SE, loadPauseData } from './pause.js';

export const DEATH_WAIT = 0xb4;                   // FUN_00334590 case 2 (no P flag 2 / 3, no script flag 0x14)
export const END_GAMEOVER = 3;                    // FUN_004012c0 -> FUN_003fdb48(3)
export const MENU_CLOSE_MS = 1000;                // FUN_00534af8: +0x50 = clock + 1000
const s16 = v => (v << 16) >> 16;
const warned = new Set();
function warnOnce(k, msg) { if (!warned.has(k)) { warned.add(k); console.warn(msg); } }

// pause.json (images, textures, font) + gameover.json (layout 0x477c38, messages, the sequence table)
export function mergeData(pj, gj) {
  return loadPauseData({ ...pj, layouts: { ...pj.layouts, ...gj.layouts }, messages: { ...pj.messages, ...gj.messages },
    seq6: gj.seq6, endKinds: gj.endKinds });
}

// FUN_005349c0: the pressed button's widget id -> the box result
export function menuResult(id) { return (id === 3 || id === 7) ? 6 : id === 8 ? 8 : 7; }
// FUN_003fdf00 type 3: the volume ramp (0x7f .. 7 over 3.84 s)
export function endVolume(now, t0) { return 0x7f - Math.min((now - t0) >> 5, 0x78); }

export class GameOver {
  // D: loadPauseData(pause.json merged with gameover.json: layouts.gameover, the 0x4c01 / 0x4c02 messages,
  //    seq6, endKinds); null = the timing only (no menu)
  constructor(D = null) { this.D = D; this.reset(); }
  reset() {
    this.wm = 2; this.t = 0; this.w4c = 0;        // FUN_00334590 +0x2c / +0x2e, DAT_0046e290 + 0x4c
    this.started = false;                          // DAT_0047dbb4
    this.endType = -1; this.endState = 0;          // PTR_0047db6c, DAT_004fadbc
    this.t0 = 0; this.answer = 0;                  // DAT_0047db84, DAT_0047db88
    this.seq = null;                               // the kind-6 sequence screen
    this.menu = null;                              // the kind-0x21 box (PauseScreen, layout 'gameover')
    this.request = null;                           // 'restart' | 'quit' | 'result8' for the page
    this.count = 0; this.kinds = [0, 0, 0, 0];     // DAT_0046b1dc / DAT_0046b1e0[4] (FUN_00241760)
    this.bit2000 = false; this.db80 = 0;           // DAT_004f3044 0x2000 (FUN_003e0cc8), DAT_0047db80
    this.padMenu = false;                          // DAT_004e0ff8 == 2: the pad belongs to the menus (FUN_00253fd8)
    this.killed = false;
    this.events = [];
    this.volume = 0x7f;
  }
  get active() { return this.endType === END_GAMEOVER; }
  // DAT_004f3044: 0x100 = the count > 0 (FUN_003e0c78; FUN_003de130 returns at once while set, FUN_003e0cb0);
  // 0x2000 (FUN_003e0cc8, read by FUN_003de130's other Start branch, FUN_003dfd18 != 0: not taken in this save,
  // stage +0x1558 bit 37 set -> FUN_003dfd18 = 0). Tracked to match the trace, not a pause gate here.
  get ui() { return (this.count > 0 ? 0x100 : 0) | (this.bit2000 ? 0x2000 : 0); }
  // Start opens the pause only with 0x100 clear and FUN_00254810(0x24) reporting the press, which needs
  // DAT_004e0ff8 == 1: FUN_003ddc18 sets it to 2 (FUN_00253fd8(2)) when a menu takes the focus (the sequence
  // screen, f890) and FUN_003ddd78 back to 1 when the focus goes (traced w192_start / w192_quit)
  get pauseBlocked() { return this.count > 0 || this.padMenu; }
  // FUN_00241760(on, kind, 0): a reference count on DAT_0046b1dc, per kind in DAT_0046b1e0
  ref(on, kind) {
    if (on) { this.count++; this.kinds[kind] = (this.kinds[kind] + 1) & 0xff; }
    else {
      this.count = Math.max(0, this.count - 1);
      const b = (this.kinds[kind] - 1) & 0xff; this.kinds[kind] = b & 0x80 ? 0 : b;
    }
  }
  // One game frame. dead: the player was dead when the frame started (FUN_00316cf8 on last frame's HP);
  // step: DAT_004eeb24 (1.2 on PAL); now: the clock (ms) of this frame.
  frame(dead, step, now) {
    this.events.length = 0;
    // FUN_00576b48 (vt+0x334) runs in the kill's own frame: FUN_00241760(1, 3, 0) (traced: count 1 at f788). The
    // page sees the death a frame later here (play.js blocks the pause on HP 0 itself for that frame)
    if (dead && !this.killed) { this.killed = true; this.ref(1, 3); }
    this.endScreen(now);                           // FUN_00247508 -> FUN_003fdf00, first in the frame
    this.worldMode(dead, step);                    // FUN_00322f88 -> ... FUN_00334590
    // FUN_004012c0 state 9: after the world update
    if (this.w4c === 1 && !this.started) { this.endScreenStop(); this.begin(END_GAMEOVER, now); this.started = true; }
    if (this.seq) this.seqFrame(now);
    if (this.menu) this.menuFrame(now);
  }
  // FUN_00334590, the cases on the page's path (2, 3, 9)
  worldMode(dead, step) {
    switch (this.wm) {
      case 2:
        if (dead) {                                // FUN_00316cf8 != 0 (HP == 0)
          this.events.push('deathCamera');         // FUN_0032a420(CAM, 1, 0, 0) + FUN_00328720(CAM): play.js -> player.js FollowCamera.startDeath
          this.t = DEATH_WAIT; this.wm = 3;
        }
        break;
      case 3:
        if (this.t < 0) {                          // FUN_002419d8(0) == 0 in story mode
          this.ref(0, 3);                          // FUN_00241760(0, 3, 0) (FUN_002419d8(0) == 0)
          this.w4c = 1; this.wm = 9;               // FUN_00324ab0(1), P+0x2b0 bit 0 clear; FUN_00324a40(e290, 1) left out
          this.events.push('request');
        } else {
          this.t = s16(this.t - Math.max(1, Math.trunc(step)));   // iVar4 = (int)DAT_004eeb24, at least 1
        }
        break;
      default: break;                              // 9 -> 10 (FUN_00324a78(e290, 0): not decoded; nothing on the page reads it)
    }
    this.t = s16(this.t - 1);                      // LAB_00334c5c
  }
  // FUN_003fdb48(type)
  begin(type, now) {
    this.endType = type; this.endState = 0;
    this.events.push('begin');                     // play.js: FUN_003ad5b0 (HUD off) -> hud.js hideAll (worker 0203)
    warnOnce('voice', 'game over: the voice se_0347..se_0349 (FUN_003eb250, an ATRAC stream row) is not played');
    this.ref(1, 0);                                // FUN_00241760(1, 0, 0)
    this.db80 = this.bit2000 ? 1 : 0;              // DAT_0047db80 = FUN_003e0d00()
    this.bit2000 = true;                           // FUN_003e0cc8(1)
    this.t0 = now;
  }
  // FUN_003fdd58
  endScreenStop() {
    if (this.seq) this.seq = null;
    if (this.menu) this.menu = null;
    this.padMenu = false;                          // focus gone: FUN_003ddd78 -> FUN_00253fd8(1)
    if (this.db80 === 0) this.bit2000 = false;     // FUN_003e0cc8(0) (traced: 0x2000 clear at f1303, Quit)
    if (this.endType !== END_GAMEOVER) this.ref(0, 0);
    this.endType = -1; this.endState = 0;
  }
  // FUN_003fdf00
  endScreen(now) {
    if (this.endType < 0) return;
    if (this.endType === END_GAMEOVER) this.volume = endVolume(now, this.t0);
    if (this.endState === 0) {
      // states 0 -> 1 -> 2 -> 3: the title file (0x31000fc / dd..e1 by language) is read and its FED
      // (0x81840000, FUN_0037f2f0 slot 0x61) started; the title is gameover_title.js's (worker 0198), spawned
      // 14 game frames after the request's frame there.
      // GUESS: the file read finishes at once (not decoded; see fidelity-audit "Game over"): the game polls
      // the emulated disc read in state 3 (end_state 3 at f882-890) and opens the box at f890; the page at f881
      // state 4: type 3 -> FUN_00241760(0, 0, 0) (traced: count 0, 0x100 clear at f890), then FUN_003b66c0(DAT_00472a80, DAT_004a8250[type], ...)
      if (this.endType === END_GAMEOVER) this.ref(0, 0);
      const kind = this.D && this.D.endKinds ? this.D.endKinds[this.endType] : 6;
      if (kind !== 6) warnOnce('kind', 'game over: end box kind ' + kind + ' is not translated');
      this.seq = { start: now, idx: 0, mode: 0, result: 0, table: (this.D && this.D.seq6) || null };
      this.padMenu = true;                         // FUN_003c5d10 -> FUN_003ddc18: the screen takes the focus -> FUN_00253fd8(2)
      if (!this.seq.table) warnOnce('seq', 'game over: no gameover.json (export_web_gameover.py): no menu');
      this.endState = 5;
      return;
    }
    if (this.endState === 5) {
      // type 3: wait for the box result 6 / 7 (DAT_0047db88), then FUN_003fdd58
      const r = this.seq ? this.seq.result : 0;
      if (r < 6 || r > 7) return;
      this.answer = r;
      this.endScreenStop();
      // FUN_004012c0 default: DAT_0047db88 7 -> return 4 (FUN_00242c18 / the title), 6 -> 6
      this.request = r === 7 ? 'quit' : 'restart';
    }
  }
  // FUN_003c6050 with the kind-6 table: commands at their start time (ms since the screen's ctor)
  seqFrame(now) {
    const q = this.seq;
    if (q.mode === 4 && this.menu && this.menu.result) {          // FUN_003b68b8(menu slot) -> +0x48e
      const r = this.menu.result;
      if (r === 6) {
        // story mode (FUN_002419d8(0xc / 10 / 0x11) == 0, stage +0x1558 bits 47-48 != 1): the menu box goes
        // (FUN_003b6978) and the sequence goes on with FUN_003c72f8 (the stage result screens, not decoded).
        // The page goes to the checkpoint here (play.js -> checkpoint.js, worker 0201): the result screens, the load
        // title and the opening cutscenes in between are left out (warned)
        this.menu.close(now);
        q.mode = 0;
        this.request = 'restart';
      } else {                                     // 7 / 8: LAB_003c629c -> FUN_003b7830(seq, 0, r)
        this.menu.close(now);
        q.mode = 0; q.result = r;
      }
    }
    if (!q.table) return;
    const el = now - q.start;
    while (q.idx < q.table.length) {
      const [t, , cmd] = q.table[q.idx];
      if (cmd === 0xff) break;
      if (el < t) break;
      this.command((cmd + 0x1d) & 0xff, now);
      q.idx++;
    }
  }
  // FUN_003c6600, the cases the kind-6 table uses
  command(c, now) {
    if (c === 0x1a) { this.events.push('seqText'); return; }    // layout 0x479190: invisible for kind 6
    if (c === 0x0d) { this.openMenu(now); this.seq.mode = 4; return; }
    warnOnce('cmd' + c, 'game over: sequence command case 0x' + c.toString(16) + ' is not translated');
  }
  // FUN_005348c0: FUN_003d4160(layout 0x477c38) builds and opens it (FUN_003d5110: 100 ms, sound 3)
  openMenu(now) {
    if (!this.D || !this.D.layouts || !this.D.layouts.gameover) { warnOnce('menu', 'game over: no menu data'); return; }
    const m = new PauseScreen(this.D, { layout: 'gameover', now, dim: false });
    m.result = 0; m.closeAt = 0;
    this.menu = m;
    this.events.push('menu');
  }
  // vt+0x1c FUN_00534a48: the result goes out at the close time (FUN_00534a98 -> FUN_003b7830)
  menuFrame(now) {
    const m = this.menu;
    m.update(now);
    if (m.closeAt && now >= m.closeAt) {
      m.closeAt = 0;
      m.result = m.pending;
      this.events.push('menuResult');
    }
    if (m.closing && m.cur === 0) this.menu = null;
  }
  // pad action on the menu (FUN_003de568: 0 ✕, 1 ○, 2 up, 3 down, 4 left, 5 right)
  input(a, now, kind = 0) {
    const m = this.menu;
    if (!m || m.closing) return null;
    m.se = null;
    const r = m.action(a, kind);
    if (r && r.cancel) { m.se = null; return null; }               // FUN_00534a28 -> FUN_003e1d80: no sound
    if (r && r.event !== undefined) {
      m.pending = menuResult(r.event);
      m.closeAt = now + MENU_CLOSE_MS;                            // FUN_00534af8
      m.flags = (m.flags & 0xfff7) | 2;                           // FUN_003d4780(box, 0): input locked
      warnOnce('fade', 'game over: FUN_002420e0(0, 1, 0) / FUN_00403460 after the answer are not on the page');
      return { answer: m.pending };
    }
    return r;
  }
  // the menu's primitives this frame (PauseScreen.draw), or null
  draw(now) { return this.menu ? this.menu.draw(now) : null; }
  get lastSE() { return this.menu ? this.menu.se : null; }
}
export { SE };
