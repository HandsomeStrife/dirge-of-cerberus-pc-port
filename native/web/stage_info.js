// Stage-info boxes: displayStageInfo / isDisplayStageInfo (worker 0220; notes/message-research.md). The x -1186 "Potion
// Obtained!" help box is kind 6 'MES_ITEM_07', opened by ev0100's deb_jump (the stage's help routine) through the stage
// controller (stage_controller.js, worker 0219), which binds the natives to display() / isDisplay().
//
// Translated:
//   FUN_0039e8e8 displayStageInfo_l: the key resolved in the event's message file (FUN_003a6698; export: messages) and
//     copied to DAT_0047d968; FUN_00380788 -> FUN_003fdb48(kind); the event thread then waits (stage controller).
//   FUN_003fdb48 / FUN_003fdd58 / FUN_003fded0 / FUN_003fdd30 (isDisplay); FUN_003fdf00's states 0..6 (once a game
//     frame, first in the frame).
//   The box: FUN_003b66c0 -> FUN_003c52b0 -> FUN_003c5358 (kind = DAT_004a8250[stage-info kind]), FUN_003c54f8 / FUN_003c6f98
//     (kind 0x2b: step table, the item picture's effect id by event flag 55, the text), FUN_003c6050 (the step timeline,
//     its ✕ in mode 1, the widget fades), FUN_003c6600 cases 3 / 10 / 0x1a / 0x1b, FUN_003c58b8 / FUN_003c5a98 /
//     FUN_003c5c50 (effect slots: book-keeping only, see below), FUN_003c5db0 (widget slots), FUN_003c7278 /
//     FUN_003c72f8, FUN_003b7830 (result 2).
//   The screen: layout 0x479610 with the language's rects (FUN_003ca488 param_6), the type-2 text widget 0x35
//     (FUN_003d6f88; draw FUN_003d7040 -> FUN_003cc0a8 -> FUN_003cd7e8) with the '$' codes (FUN_003d1d98): c (colour,
//     DAT_0047a7c0), r (line break), i (inline image, FUN_003d1d08 / FUN_003d1c90 records).
// Not on the page (warned once):
//   - the box's effects (slot 0 panel 0x834c0000, slot 1 the item picture, FED a0211 / file 0x3100085): effects.js has
//     no channel type 18, draw type 103, nor FUN_002e7198's soft end. The step / life book-keeping still runs.
//   - kinds 0 / 2 / 4 / 5 (results, other screens) and kind 1's drawing (objective text DAT_0047a388[stat 0x32], layout
//     0x479168): kind 1 keeps its timing (step table 0x47a0a0: open 3700 ms) so the controller's waits are right.
//   - kind 3 is the game over (gameover.js owns it).
//   - the menu sounds 0x1d / 0x1e go to the pause's latch when given (opts.menuSound), else they are dropped.
//   - FUN_003fdf00's gates FUN_002e29e0() > 0 and FUN_00400ee8() (not decoded: taken as open).
// Clock: ms (FUN_0023c1f0), 20 ms a game frame (the HUD's GUESS row).
import { PauseScreen } from './pause.js';
import { hexBytes } from './menu_layout.js';

export const BOX_KIND_ITEM = 0x2b, BOX_KIND_OBJECTIVE = 0x1f;
// MEASURED (w220_box): displayStageInfo at game frame 216 (record 217), states 0 -> 3 in frame 217 (record 218), the box
// opens in frame 226 (state 5 at record 227): FUN_003fdf00 state 3 waits for the effect file on PCSX2's disc. GUESS: the
// page loads it with the page and keeps the measured 8 frames in state 3 (as gameover_title.js TITLE_DELAY). notes/fidelity-audit.md 'Stage-info file read'.
export const READ_FRAMES = 8;                   // frames waiting in state 3 after the frame that ran states 0 -> 3
export const FRAME_MS = 20;

const warned = new Set();
function warnOnce(k, m, warn = console.warn) { if (!warned.has(k)) { warned.add(k); warn(m); } }
const u32 = v => v >>> 0;

// ---------------------------------------------------------------- data
// sj: stage_info.json (export_web_stageinfo.py); pd: loadPauseData(pause.json) (images, textures, font, widths)
export function loadStageInfoData(sj, pd) {
  const layouts = { ...pd.layouts };
  for (const [k, hex] of Object.entries(sj.layouts)) layouts['si' + k] = withOverride(hexBytes(hex), pd.opLen, sj.overrides[k]);
  const msg = {};
  for (const [k, v] of Object.entries(sj.messages)) msg[k] = v ? hexBytes(v) : null;
  const inline = sj.inline.map(r => ({ ...r, name: r.name }));
  return { ...pd, layouts, si: { ...sj, messages: msg, inline } };
}
// FUN_003ca488 with param_7 = param_6[language]: each op 0x0e takes the next 4 shorts of the list instead of its own.
// The page's builder (menu_layout.js buildLayout) takes them the same way; here the list is written into a copy of the
// script so PauseScreen (which builds without an override) gets the language's rects.
function withOverride(b, opLen, ov) {
  const out = Uint8Array.from(b);
  if (ov) {
    let p = 0, k = 0;
    while (out[p] !== 0xff) {
      if (out[p] === 0x0e) {
        for (let i = 0; i < 4; i++) { const v = ov[k++] & 0xffff; out[p + 1 + 2 * i] = v & 0xff; out[p + 2 + 2 * i] = v >> 8; }
      }
      p += opLen[out[p]];
    }
  }
  return Array.from(out, x => x.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------- the box's screen (FUN_003c5d10 -> FUN_003d41e0)
const s16 = v => (v << 16) >> 16;
function rgbaOf(v) { return [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, v >>> 24]; }

export class StageInfoScreen extends PauseScreen {
  constructor(D, kind, now) {
    super(D, { layout: 'si' + kind, focusId: 0xff, now, dim: false });
    // FUN_003b76b8 -> FUN_003d4040 -> FUN_003d5090: cur = total = 100 and nothing opens it: no open animation
    this.cur = this.total = 100; this.flags = 0; this.se = null;
    for (const w of this.all) if (w.type === 2) initText2(w);
  }
  drawWidget(w) {
    if (w.type === 2) this.drawText2(w);
    else super.drawWidget(w);
  }
  // FUN_003d7040 (type 2): vt+0x34 image (none), FUN_003cae68 scissor, FUN_003d0240 (+0x4c = +0x58), FUN_003cc0a8(w,
  // +0x54, 0, 0x7fff, 0x7fff, 0x7fff, 0, +0x66): FUN_003cd7e8 (+0x5c = 0, flag 0x80 clear); TEX1 nearest (no flag 8)
  drawText2(w) {
    this.drawImage(w, 0xffff);
    w.col4c = w.c58.slice();
    if (!w.str) return;
    this.linear = true;                            // FUN_003cc0a8: FUN_003d3830(1) around the text (FUN_002413c0(0x1e))
    this.renderCodes(w, w.str, 0x7fff, 0x7fff);
    this.linear = false;
  }
  // FUN_003cd7e8 with the '$' path (FUN_003d1d98: codes c / r / i; the rest warned). Positions in 1/16 px.
  renderCodes(w, str, maxCount, maxLines) {
    const D = this.D, f = w.flags5e;
    let right = (w.ix + w.iw) * 16, x0;
    if (w.textOff[0] !== 0x7f) { x0 = w.x + w.textOff[0]; right = (s16(w.x) + s16(w.w) - w.textOff[0]) * 16; }
    else x0 = (f & 0x10) ? w.ix + Math.trunc((w.iw - w.tw) / 2) : (f & 0x20) ? w.ix + (w.iw - w.tw) : w.ix;
    if (f & 0x1000) warnOnce('f1000', 'stage info: text flag 0x1000 (FUN_003cd7e8 scrolling line) not translated');
    const lineX = (x0 << 20) >> 16;
    let bottom = (w.iy + w.ih) * 16, y0;
    if (w.textOff[1] !== 0x7f) { y0 = w.y + w.textOff[1]; bottom = (s16(w.y) + s16(w.h) - w.textOff[1]) * 16; } else y0 = w.iy;
    let y = (y0 << 20) >> 16, x = lineX;
    const an = this.anim(w), sc = v => an ? Math.trunc((v * this.cur) / this.total) : v;
    let c = w.col4c.slice();
    let main = [c[0], c[1], c[2], sc(c[3])];
    const shadow = [0x10, 0x10, 0x10, c[3] < 0x20 ? 0 : sc((c[3] - 0x20) & 0xff)];
    let glow = [c[0], c[1], c[2], an ? Math.trunc((this.cur * 0x40) / this.total) : 0x40];
    const lineH = (w.lineGap + 0x10) * 0x10, cond = (f & 0x8000) !== 0;
    const codes = D.si.codes;
    let count = 0, p = 0, nl = false, notCode = false;
    while (str[p]) {
      if (bottom <= y || maxCount <= count || maxLines < count) break;
      const ch = str[p];
      let off = 0, adv = 0, uw = 0, draw = false, g = 0, img = null, imgCol = null;
      if (ch === 0x24 && !notCode && !(f & 0x100)) {
        // FUN_003d1d98(str + p): the code letter after '$' in DAT_0047abb0 (char, digits, base); none -> '$' is text
        const k = codes.findIndex(e => e[0] && e[0] === str[p + 1]);
        if (k < 0) { notCode = true; p++; continue; }               // returns 1, *param_4 = 1: the '$' is skipped
        const code = k + 1;
        let n = 2, val = 0;
        if (code === 9) {                                             // 'i': FUN_003d1d08 (two letters, both < 0x80)
          const a = str[p + 2], b = str[p + 3];
          if (a < 0x80 && b < 0x80) { img = D.si.inline.find(r => r.name.charCodeAt(0) === a && r.name.charCodeAt(1) === b) || null; n = 4; }
        } else if (code === 8) {
          warnOnce('code8', 'stage info: text code $h (FUN_003d1c08) not translated');
        }
        for (let d = 0; d < codes[k][1]; d++) {                        // digits (base codes[k][2])
          const q = str[p + n];
          if (q === 0x24) { n++; break; }
          if (q >= 0x30 && q <= 0x39) { val = val * codes[k][2] + (q - 0x30); n++; }
          else break;
        }
        p += n;
        if (code === 1) {                                             // c: colour (9 = the widget's own +0x58)
          const cv = val === 9 ? u32((w.c58[3] << 24) | (w.c58[2] << 16) | (w.c58[1] << 8) | w.c58[0]) : u32(D.si.colours[val]);
          const rgb = rgbaOf(cv);
          main = [rgb[0], rgb[1], rgb[2], main[3]];
          glow = [rgb[0], rgb[1], rgb[2], an ? Math.trunc((this.cur * 0x40) / this.total) : 0x40];
          w.col4c = [rgb[0], rgb[1], rgb[2], main[3]];
          continue;                                                   // no advance
        }
        if (code === 6) { nl = true; }                                // r: iStack_f8 = 1
        else if (code === 9) {
          if (!img) { warnOnce('img', 'stage info: unknown inline image in text'); continue; }
          imgCol = [img.col & 0xff, (img.col >>> 8) & 0xff, (img.col >>> 16) & 0xff, main[3]];   // rgb | text alpha
          adv = ((img.w + 2) << 20) >> 16;
          uw = ((img.h + 2) << 20) >> 16;                             // uVar13 (row height)
        } else {
          warnOnce('code' + code, 'stage info: text code $' + String.fromCharCode(codes[k][0]) + ' (FUN_003cd7e8 case ' + code + ') not translated');
          continue;
        }
      } else if (ch < 0x20) {
        if (ch === 10) nl = true;
        else if (ch === 1) warnOnce('c1', 'stage info: colour code 1 (DAT_004f2008) not translated');
        p++;
      } else if (ch === 0x20) {
        notCode = false;
        let gw = (D.widths20[0] & 0xf) + 1;
        if (f & 0x40) { const o = ((0xe - gw) >>> 1) | 0; gw = 0xe - o; off = o << 4; }
        adv = (gw << 20) >> 16; p++; count++;
      } else if (ch >= 0x80) {
        warnOnce('sjis', 'stage info: Shift-JIS text not translated'); p += 2; continue;
      } else {
        notCode = false;
        const t = ch + 0x877e;
        g = ((t >> 8) - 0x81) * 0xbc - 0x41 + (t & 0xff);
        const bb = D.widths20[Math.trunc((ch - 0x20) / 2)];
        let gw = ((ch & 1) ? bb >> 4 : bb & 0xf) + 1;
        if (f & 0x40) { const o = ((0xe - gw) >>> 1) | 0; gw = 0xe - o; off = o << 4; }
        uw = (gw << 20) >> 16; adv = uw;
        if (cond && adv > 0x80) { adv = 0x80; const d = (uw - 0x80) >> 1; if (d >>> 0 < off >>> 0) off -= d; }
        draw = true; p++; count++;
      }
      x += off;
      if (nl) {                                                       // the line break
        if (right < x + 0x80) y += lineH;
        x = lineX + off; y += lineH; count++; nl = false;
      }
      if (right < x + adv) { y += lineH; x = lineX + off; }            // wrap
      if (adv === 0) continue;
      if (y < bottom) {
        if (img) {                                                    // the image record: page, u, v, w, h (FUN_003d2e80)
          const yy = y + (Math.trunc((0x10 - img.h) / 2) + 2) * 0x10;
          this.emitSprite([x, yy, img.u * 16 + 1, img.v * 16 + 1], [x + img.w * 16, yy + img.h * 16, img.u * 16 + 1 + img.w * 16, img.v * 16 + 1 + img.h * 16],
            imgCol, img.page - 6);
        } else if (draw) this.glyph(w, f, x, y, adv, uw, g, main, shadow, glow);
      }
      x += adv + w.spacing * 16;
    }
  }
}
// FUN_003d6f88 -> FUN_003cbe68 -> FUN_003cbf18 (the type-9 fields: +0x58 colour, +0x5e flags, +0x64 line gap 0 when
// FUN_003e2760(), +0x65 letter gap 0, +0x66 0x7fff) and FUN_003d72e8 (measure: nothing yet)
function initText2(w) {
  w.c58 = [0x80, 0x80, 0x80, 0x80];
  w.col4c = w.c58.slice();
  w.flags5e = w.s36 & 0xffff;
  w.lineGap = 0; w.spacing = 0;
  w.str = null; w.tw = 0; w.th = 0; w.count = 0;
}

// ---------------------------------------------------------------- FUN_003c5358: the sequence screen of one box
class StageBox {
  constructor(D, kind, now, flags) {
    this.D = D; this.kind = kind;
    this.start = now;                              // +0x480
    this.step = 0;                                 // +0x47c
    this.hold = 0;                                 // +0x484
    this.mode = 0;                                 // +0x48d
    this.result = 2;                               // +0x48e
    this.f48f = 0;
    this.fx = Array.from({ length: 0x26 }, () => ({ id: -1, h: -1, life: 0, mv: 0 }));   // +0x54 + 0x1c i
    this.ws = Array.from({ length: 40 }, () => ({ op: 0, mode: 0, end: 0, life: 0, w: null }));   // +0x490 + 0x3c i
    this.screen = null;
    this.closed = false;                           // FUN_003b7830 ran: slot result +1 = this.result
    this.events = [];
    const T = D.si.scripts[String(kind)];
    this.table = T || null;                        // +0x488
    this.text = null;                              // +0xdf0
    if (kind === BOX_KIND_ITEM) {                  // FUN_003c6f98
      const k = flags.event(0x37);
      if (k < 0xc) { this.fx[1].id = D.si.itemFx[k]; this.text = flags.text; }
      else warnOnce('fl55', 'stage info: event flag 55 = ' + k + ': FUN_003c6f98\'s number text (fmt 0x4a5e88) not translated');
    } else if (kind !== BOX_KIND_OBJECTIVE || !T) warnOnce('kind' + kind, 'stage info: box kind 0x' + kind.toString(16) + ' (FUN_003c54f8) not translated');
    if (kind === BOX_KIND_OBJECTIVE) warnOnce('k1draw', 'stage info: the objective box (kind 1: layout 0x479168, text DAT_0047a388[stat 0x32]) is not drawn; its timing runs');
  }
  // FUN_003c6050 (vt+0x1c), once a frame. cross: FUN_003de918(0, 1), the ✕ edge of this frame
  frame(now, cross) {
    if (!this.table || this.closed) return;
    let el = u32(now - this.start);
    const focused = !!this.screen;                 // FUN_003d5480: the screen holds the focus (layout built by 0x1a)
    if (focused) {
      if (this.hold === 0) {
        if (this.mode === 1 && (cross || this.f48f)) {
          this.c7278(); el = 0; this.c72f8(now); this.hold = 0;
          this.events.push('cross');
        }
      } else if (cross) { el = this.hold; this.hold = 0; this.start = now - el; }
    }
    if (this.mode >= 2) warnOnce('mode' + this.mode, 'stage info: box mode ' + this.mode + ' (FUN_003c6050) not translated');
    let i = this.step, skip = false;
    for (;;) {
      const s = this.table[i];
      if (!s || s[2] === -1) break;
      if (el < u32(s[0])) break;
      if (skip) { i++; continue; }
      if (s[2] >= 0) {                             // FUN_003c6600 returns 0: an effect slot
        this.slot(s, now);
        this.fx[s[2]].life = s[1] === 0 ? -1 : s[1];
        i++;
        continue;
      }
      const r = this.command(s, now);
      if (r === 'stop') { this.step = i; return this.fades(el, now); }
      if (r === 'closed') return;
      if (r === 'skipmode') { skip = true; this.start = now - s[1]; el = u32(s[1] - 1); }
      if (r === 'skip1') i++;
      i++;
    }
    this.step = i;
    this.fades(el, now);
  }
  // FUN_003c6600 for the commands these tables use (op + 0x1d)
  command(s, now) {
    const c = (s[2] + 0x1d) & 0xff;
    switch (c) {
      case 3: this.events.push({ se: s[3] & 0xff }); return 'next';      // FUN_003e1d10(arg)
      case 10: this.f48f = 0; this.mode = 1; this.hold = 0; return 'next';
      case 0x1a: {                                 // the layout and its text (kind 0x2b: widget 0x35, the string)
        if (this.kind !== BOX_KIND_ITEM) { warnOnce('1a' + this.kind, 'stage info: box kind 0x' + this.kind.toString(16) + ' layout not drawn'); this.screen = 'nodraw'; return 'next'; }
        this.screen = new StageInfoScreen(this.D, this.kind, now);
        const w = this.screen.byId(0x35);
        if (w) w.str = this.text;                  // vt+0xd4 FUN_003d7218 (FUN_003d0380 + measure)
        this.c5db0(s, w, now);
        return 'next';
      }
      case 0x1b: this.closed = true; this.table = null; return 'closed';  // FUN_003b7830(box, 0, +0x48e)
      default:
        warnOnce('cmd' + c, 'stage info: box command ' + c + ' (FUN_003c6600) not translated');
        return 'next';
    }
  }
  // FUN_003c58b8: an effect in slot s[2] (book-keeping; the effect itself is not drawn, see the header)
  slot(s, now) {
    const S = this.fx[s[2]];
    if (S.h !== -1) S.h = -1;                      // FUN_003c5c50
    let id = s[3];
    if (id === -1) { id = S.id; if (id === -1) return; }
    warnOnce('fx', 'stage info: the box effects (FED a0211, ids 0x834c....: channel type 18, draw type 103) are not drawn');
    S.h = 1; S.id = id; S.mv = 0; S.since = now;
    this.events.push({ fx: u32(id) });
  }
  // FUN_003c5db0: a widget slot (+0x490 + 0x3c x arg): fade in over 100 ms (op != -0xd), life
  c5db0(s, w, now) {
    const W = this.ws[s[3]];
    W.op = s[2]; W.w = w;
    if (s[2] === -0xd) { W.mode = 0; W.end = 0; } else { W.mode = 1; W.end = now + 100; }
    W.life = s[1] === 0 ? -1 : s[1];
    if (w) { w.flags &= ~1; w.c58[3] = W.mode === 1 ? 0 : w.c58[3]; }             // FUN_003cb360(w, 0)
  }
  // the end of FUN_003c6050: effect lives (FUN_003c5a98 at the end) and the widget fades
  fades(el, now) {
    for (const S of this.fx) {
      if (S.h === -1) continue;
      if (!(el < u32(S.life))) { S.h = -1; this.events.push({ fxEnd: u32(S.id) }); }   // FUN_003c5a98 -> FUN_002e7198
    }
    if (!this.screen || this.screen === 'nodraw') return;
    for (const W of this.ws) {
      if (!W.w) continue;
      let a = null;
      if (W.mode === 0) {
        if (u32(W.life) <= el) { W.mode = 2; W.end = now + 100; }
      } else if (W.mode === 1) {
        if (now < W.end) a = (0x80 - Math.trunc(((W.end - now) * 0x80) / 100)) & 0xff;
        else { W.mode = 0; a = 0x80; }
      } else if (now < W.end) a = Math.trunc(((W.end - now) * 0x80) / 100) & 0xff;
      else { W.mode = 0; W.w.flags |= 1; W.w = null; continue; }                  // FUN_003cb360(w, 1)
      if (a !== null) W.w.c58[3] = a;                                              // +0x58 alpha, FUN_003d0240
    }
  }
  // FUN_003c7278: lives -2 (until ✕) -> 0
  c7278() {
    for (const S of this.fx) if (S.id !== -1 && S.life === -2) S.life = 0;
    for (const W of this.ws) if (W.w && W.life === -2) W.life = 0;
  }
  // FUN_003c72f8
  c72f8(now) { this.start = now; this.mode = 0; this.step++; this.f48f = 0; }
  draw(now) { return this.screen && this.screen !== 'nodraw' ? this.screen.draw(now) : null; }
}

// ---------------------------------------------------------------- FUN_003fdb48 / FUN_003fdf00 / FUN_003fdd58
export class StageInfo {
  // D: loadStageInfoData(..) or null (no data: the timing of kinds 1 / 6 still runs, nothing drawn).
  // flags: { event(n) } the event VM's global flags DAT_0050db20 (FUN_0037cea0), from the stage controller
  constructor(D = null, { flags = null, warn = console.warn } = {}) {
    this.D = D; this.flags = flags; this.warn = warn;
    this.kind = -1;                                // PTR_0047db6c
    this.state = 0;                                // DAT_004fadbc
    this.box = null;                               // DAT_0047db78 slot
    this.text = null;                              // DAT_0047d968
    this.now = 0;                                  // FUN_0023c1f0 (ms)
    this.events = [];
  }
  // FUN_0039e8e8: the key's text (FUN_003a6698 in ev0100's message file) to DAT_0047d968; then FUN_00380788 ->
  // FUN_003fdb48(kind) (kind 5 while +0x156c is set is skipped there: not on the page)
  display(kind, key = null) {
    if (key != null) {
      const t = this.D ? this.D.si.messages[key] : undefined;
      if (t) this.text = t;                        // FUN_003a6698 null (or no data): DAT_0047d968 unchanged
      else warnOnce('key' + key, 'stage info: message ' + key + (this.D ? ' not in ev0100\'s message file' : ': no data/stage_info.json (export_web_stageinfo.py)'), this.warn);
    }
    this.begin(kind | 0);
  }
  // FUN_003fdb48
  begin(kind) {
    if (this.kind >= 0) { this.stop(); return this.begin(kind); }
    if (kind === 3) { warnOnce('k3', 'stage info: kind 3 (the game over) belongs to gameover.js', this.warn); return; }
    this.kind = kind; this.state = 0; this.wait = 0;
    if (kind === 0 || kind === 2) warnOnce('k02', 'stage info: kind ' + kind + '\'s FUN_003fdaa0 / FUN_003fdb00 (stat 0xe) not translated', this.warn);
    this.events.push({ begin: kind });
  }
  // FUN_003fdd30: k >= 0: is k the current kind; k < 0: any
  isDisplay(k) { return (k | 0) >= 0 ? this.kind === (k | 0) : this.kind >= 0; }
  // FUN_003fdd58 (also FUN_004012c0's before FUN_003fdb48(3): play.js calls it when the game over starts)
  stop() {
    if (this.box) { this.box = null; }             // FUN_003b6978: the box goes (FUN_003c5428 -> FUN_003c5cc0: its effects too)
    this.kind = -1; this.state = 0;
    this.events.push({ end: true });
  }
  // FUN_003fdf00 (first in the game frame) and the box's vt+0x1c (FUN_003c6050). cross: the ✕ edge of this frame.
  frame(cross = false) {
    this.now += FRAME_MS;
    const now = this.now;
    if (this.kind < 0) return;
    if (this.state === 0) {                        // states 0 -> 3: the file (a0211 for kind 6) is read
      this.state = 3; this.wait = READ_FRAMES; return;
    }
    if (this.state === 3) {
      if (this.wait-- > 0) return;
      this.state = 4;
    }
    if (this.state === 4) {                        // FUN_003b66c0(DAT_00472a80, DAT_004a8250[kind], ...)
      const bk = this.D ? this.D.si.kinds[this.kind] : (this.kind === 6 ? BOX_KIND_ITEM : this.kind === 1 ? BOX_KIND_OBJECTIVE : 0);
      if (this.D && this.D.si.scripts[String(bk)]) {
        this.box = new StageBox(this.D, bk, now, { event: n => (this.flags ? this.flags.event(n) : 0), text: this.text });
      } else {
        warnOnce('nobox' + bk, 'stage info: box kind 0x' + bk.toString(16) + ' has no data: closed at once', this.warn);
        this.box = null;
      }
      this.state = 5;
    }
    if (this.state === 5) {
      // FUN_003fdf00 first (FUN_003b68b8: the slot's result 2, written by the box's FUN_003b7830 in an earlier frame's
      // update: w220_box: the box closes in frame 450, the kind is clear in frame 451), then the box's own update
      // (vt+0x1c, the menu manager). GUESS: the menu manager runs after FUN_003fdf00 in the frame (the page runs both here)
      if (!this.box || this.box.closed) { this.state = 6; this.stop(); return; }
      this.box.frame(now, cross);
      for (const e of this.box.events) this.events.push(e);
      this.box.events.length = 0;
    }
  }
  draw() { return this.box ? this.box.draw(this.now) : null; }
  reset() { this.kind = -1; this.state = 0; this.box = null; this.now = 0; }
}

// ---------------------------------------------------------------- the page (play.js): data, drawing, sounds
// Returns at once (worker 0219's stage controller calls display() before the data has loaded: it then runs without a
// screen). opts.output: output.js (draws after the HUD in output.hud, as the menus); opts.pause: setupPause's result
// (its layer draws the primitives, its menuSound latch takes the box's sounds).
export function createStageInfo({ output = null, pause = null, flags = null, url = 'data/stage_info.json', pauseUrl = 'data/pause.json' } = {}) {
  const si = new StageInfo(null, { flags });
  si.ready = (async () => {
    try {
      const [sj, pj] = await Promise.all([url, pauseUrl].map(u => fetch(u).then(r => (r.ok ? r.json() : null))));
      if (!sj || !pj) { console.warn('stage info: no ' + url + ' or ' + pauseUrl + ' (export_web_stageinfo.py): boxes run without a screen'); return; }
      const { loadPauseData } = await import('./pause.js');
      si.D = loadStageInfoData(sj, loadPauseData(pj));
    } catch (e) { console.warn('stage info: bad data, boxes run without a screen', String(e)); }
  })();
  if (output) {
    let layer = null;
    const prev = output.hud;
    output.hud = o => {
      if (prev) prev(o);
      const prims = si.draw();
      if (!prims || !si.D) return;
      if (!layer) layer = pause && pause.layer ? pause.layer : null;
      if (!layer) { warnOnce('layer', 'stage info: no pause layer to draw with'); return; }
      layer.draw(o.renderer, o, prims);
    };
  }
  si.sounds = () => {                              // the box's FUN_003e1d10 ids of this frame -> the pause's latch
    for (const e of si.events) if (e.se !== undefined && pause && pause.menuSound) pause.menuSound.set(e.se);
  };
  return si;
}
