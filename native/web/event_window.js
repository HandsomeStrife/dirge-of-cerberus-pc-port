// event_window.js -- the event windows: KerberosWindow open_l / close_l, the opening's subtitles (worker 0239;
// notes/event-vm-research.md "Event windows (subtitles) on the page"). event_rt.js calls natives(R), frame(R) and
// skip(R) (the hooks worker 0222 left); play.js draws the open windows with the pause's PauseLayer.
//
// Translated:
//   open_l 0x39ec20 (args id, kind, x, y, w, h, key, t): the key -> FUN_003a6698 in the event's message file
//     (export_web_event.py `messages`), FUN_0037c3c8: command 10 {id +0x20, x +0x24, y +0x26, w +0x28, h +0x2a,
//     kind +0x34, the text +0x2c, t +0x38}. t is the first value the native pops (s6 -> FUN_0037c3c8's 9th argument,
//     stored at 0x39ecf0): not unused.
//   FUN_00377c68 case 10 -> FUN_00383408: FUN_003b66c0(kind, 0, 1, 0, t or -1) -> PTR_FUN_00472d68[4] = FUN_003b84a8 ->
//     FUN_003b8598 (layout 0x472c48: root 0x13, type-9 text 0x14; FUN_003e1d80 drops the open sound; text flags by
//     FUN_003e15c0; FUN_003d0a70(0x13, 1): no opening clip; FUN_003d4720 screen flag 0x200), FUN_003b72b8 ->
//     FUN_003d50b8 (t != -1: the open runs t ms), under Skip FUN_003b75b0 (silent), FUN_003b6c10 (place),
//     FUN_003b6c98 (size: the root, and the text widget by the same change), FUN_003b6ab8 (the text: vt+0xd4 =
//     FUN_003d03a0's string path, then FUN_003cf2e0 -> FUN_003cf338's measure), the entry in +0x9804 (5 x 0xc:
//     id, box, state); no free entry -> the box closes at once (FUN_003b6978). Under Skip FUN_003b7118 hides it.
//   close_l 0x39e6c0 -> FUN_00378b00 (entry id -> -1) + FUN_003789b8 (a pending command 10 of that id freed).
//   The window loop after the slots (FUN_00377c68 LAB_00378684): id < 0 -> FUN_003788d8 -> FUN_003b6978(box, -1) ->
//     vt+0x34 FUN_003b88d8 -> FUN_003b7930(box, 100): the 100 ms close (silent: FUN_003e1d80); else the box state.
//   Skip (event_rt.js requestSkip = FUN_00372f70): FUN_003b7118(box, 1) -> FUN_003d46a8 -> FUN_003cb360(root, 1):
//     the root's flag 1, the box is not drawn.
//   The text draw: FUN_003e5f58 -> FUN_003cc0a8 -> FUN_003cd7e8 with its '$' path (stage_info.js renderCodes; '$h'
//     = the speaker's name, FUN_003d1c08, worker 0239) and the glyph count +0x68 from the measure.
// Box kind 27 (worker 0263; wro_kaisetu's choice box): EventChoiceScreen below, open_l_str, getstate_l, getvalue_l.
// Left out (warned): other window kinds than 4 / 27, move / hide / select, FUN_003d0058 ('$&' text),
//   kind 4's state (FUN_003b8850 result 5).
// Clock: the menu clock FUN_0023c1f0 (ms); the page steps FRAME_MS a game frame (stage_info.js FRAME_MS, GUESS row
//   'stage-info clock').

import { PauseScreen, SE, scissor } from './pause.js';
import { StageInfoScreen, speakerCode, speakerNamesOn, MENU_CONFIG_BITS, FRAME_MS } from './stage_info.js';
import { hexBytes } from './menu_layout.js';

const s16 = v => (v << 16) >> 16;
const f32 = Math.fround;
const warned = new Set();
function warnOnce(k, m, warn = console.warn) { if (!warned.has(k)) { warned.add(k); warn(m); } }

export const WINDOW_KIND = 4;                    // the only kind scr001 opens (T w222_snd: kind 4 at f482 / 586 / 1390)
export const CHOICE_KIND = 27;                   // PTR_FUN_00472d68[27] = FUN_003b8e50 -> FUN_003b8ec8
export const TEXT_ID = 0x14, ROOT_ID = 0x13;     // FUN_003b8598: +0x50 = 0x14, FUN_003cb0f8(.., 0x13)

// FUN_003e15c0: FUN_002419d8(10) == 0 (story mode) -> DAT_004f3044 bit 11 (stage_info.js MENU_CONFIG_BITS)
const optBit11 = () => (MENU_CONFIG_BITS >> 11) & 1;

// ---------------------------------------------------------------- the box (FUN_003b8598)
export class EventWindowScreen extends PauseScreen {
  constructor(D, now, openMs) {
    // FUN_003b76b8 -> FUN_003d4040 (cur = total = 100), FUN_003d4160(box, 0x472c48) -> FUN_003d41e0 + FUN_003d5110 (open)
    super(D, { layout: 'window4', focusId: 0xff, now, dim: false });
    this.se = null;                                // FUN_003e1d80 (DAT_004f58c8 = 0xff): the open sound 3 is dropped
    this.text = this.byId(TEXT_ID);                // +0x50 = 0x14 (FUN_003b6418's record +8)
    const t = this.text;
    // bVar2 = (kind 4) FUN_003e15c0() == 0 -> FUN_003b8598's param_6
    if (t) {
      if (optBit11() !== 0) { t.flags5e = (t.flags5e & 0xfffd) | 0x4000; }   // param_6 == 0 (T w239: 11 outline sprites)
      else {                                       // param_6 != 0: the colour's alpha 0, flags & 0xf7fc, +0x4c = +0x58
        t.c58 = [t.c58[0], t.c58[1], t.c58[2], 0]; t.flags5e &= 0xf7fc; t.col4c = t.c58.slice();
      }
    }
    this.root.flags |= 0x80;                       // FUN_003d0a70(0x13, 1): no clip to the opening height
    this.flags |= 0x200;                           // FUN_003d4720(box, 1)
    // FUN_003b66c0 param_6 != -1 -> FUN_003b72b8 -> FUN_003d50b8(screen, t): the open runs t ms (cur 0 while opening)
    if (openMs !== -1) {
      this.end = now + openMs;
      this.cur = (this.flags & 0x10) ? 0 : openMs;
      this.total = openMs;
    }
    this.result = 0;                               // the record's +1 (FUN_003b68b8)
  }
  // FUN_003b6c98 for this box: the root takes the size; the text widget (+8) changes by the same amount, not below 0
  // (the record's +0xc .. +0x18 are 0 for kind 4: FUN_003b6450 zeroes them, FUN_003b8598 sets only +8)
  setSize(w, h) {
    const r = this.root, dw = s16(w - r.w), dh = s16(h - r.h);
    this.resize(r, w, h);
    const t = this.text;
    if (t) this.resize(t, Math.max(s16(t.w + dw), 0), Math.max(s16(t.h + dh), 0));
  }
  // FUN_003b6ab8 -> vt+0xd4 = FUN_003d03a0(w, str, 0, 0): the string path, '$&' -> flags 0x480 else & 0xfb7f, then
  // vt+0xdc FUN_003e6158 -> FUN_003cf2e0: flag 0x80 -> FUN_003d0058 (not translated) else FUN_003cf338
  setText(bytes) {
    const w = this.text;
    if (!w) return;
    w.str = bytes;
    if (bytes[0] === 0x24 && bytes[1] === 0x26) w.flags5e |= 0x480; else w.flags5e &= 0xfb7f;
    if (w.flags5e & 0x80) { warnOnce('m80', 'event window: a "$&" text (FUN_003d0058) is not translated; not drawn'); w.str = null; return; }
    if (!codesSupported(w, bytes)) { w.str = null; return; }
    const m = measureCodes(this.D, w, bytes);
    w.tw = m.w; w.th = m.h; w.count = m.count;
  }
  drawWidget(w) {
    if (w.type === 9) this.drawText9c(w);
    else super.drawWidget(w);
  }
  // FUN_003e5f58 (type 9): vt+0x34 image (none), FUN_003d0240 (+0x4c = +0x58), FUN_003cc0a8(w, +0x54, 0, 0x7fff,
  // 0x7fff, +0x68, &+0x6c, 0x7fff): TEX1 bilinear around the text (script flag 0x1e) and FUN_003cd7e8 with '$' codes
  drawText9c(w) {
    this.drawImage(w, 0xffff);
    w.col4c = w.c58.slice();
    if (!w.str) return;
    this.linear = true;
    this.renderCodes(w, w.str, w.count, 0x7fff);
    this.linear = false;
  }
}
// FUN_003cd7e8's '$' path, shared with the stage-info boxes (stage_info.js)
EventWindowScreen.prototype.renderCodes = StageInfoScreen.prototype.renderCodes;

// The '$' codes this page translates in a window text (r, h, c in the draw); others, Shift-JIS and code 1: not drawn
function codesSupported(w, s) {
  for (let p = 0; s[p]; p++) {
    const c = s[p];
    if (c >= 0x80 || c === 1) { warnOnce('code' + c, 'event window: text code 0x' + c.toString(16) + ' (Shift-JIS / colour 1) not translated; text not drawn'); return false; }
  }
  if (w.flags5e & 0x1000) warnOnce('f1000', 'event window: text flag 0x1000 (FUN_003cd7e8 scrolling line) not translated');
  return true;
}

// FUN_003cf338(w) with the widget's string, the '$' path included (FUN_003d1d98; codes 6 'r' and 8 'h'; the others
// take no room here and are warned). As pause.js measureText for the rest. Positions in 1/16 px.
export function measureCodes(D, w, str0) {
  let limit = w.iw;                                // iStack_110
  if (w.textOff[0] !== 0x7f) limit = w.iw - w.textOff[0];
  limit <<= 4;
  const cond = (w.flags5e & 0x8000) !== 0;         // uStack_108
  const lineH = (w.lineGap + 0x10) * 0x10;
  const codes = D.si.codes;
  let str = str0, p = 0, x = 0, maxX = 0, y = 0, maxY = 0, count = 0, lines = 1;
  let nl = false, nlAdv = 1, gw16 = 0, h = 0;      // iVar12 / lVar8 keep their values through a code that sets neither
  let lineStart = 0, notCode = false, ret = null;  // iStack_104, iStack_12c, (puStack_e4, iStack_e0, uStack_dc)
  for (;;) {
    if (!str[p]) {                                 // the end of an inserted name: back to the main string
      if (!ret) break;
      str = ret.str; p = ret.p;
      if (ret.dc) lineStart = x;                   // uStack_dc: iStack_104 = iVar15
      ret = null;
      continue;
    }
    const c = str[p];
    let off = 0;
    if (c === 0x24 && !notCode && !(w.flags5e & 0x100)) {
      const k = codes.findIndex(e => e[0] && e[0] === str[p + 1]);
      if (k < 0) { notCode = true; gw16 = 0; h = 0; p += 1; }        // FUN_003d1d98 -> 1, code 0: the else branch
      else {
        const code = k + 1;
        let n = 2, name = null;
        if (code === 8) ({ n, name } = speakerCode(D, str, p));
        else if (code === 9) { const a = str[p + 2], b = str[p + 3]; if (a < 0x80 && b < 0x80) n = 4; }
        for (let d = 0; d < codes[k][1]; d++) {
          const q = str[p + n];
          if (q === 0x24) { n++; break; }
          if (q >= 0x30 && q <= 0x39) n++;
          else break;
        }
        if (code === 6) { nl = true; nlAdv = n; }                   // iStack_f4 = 1, uStack_ec = the length
        else if (code === 8) {                                       // the name, when FUN_003e1550()
          p += n;
          if (name && speakerNamesOn()) { ret = { str, p, dc: 1 }; str = name; p = 0; }
        } else {
          if (code === 9 || code === 0xb || code === 0xc) warnOnce('mcode' + code, 'event window: text code $' + String.fromCharCode(codes[k][0]) + ' (FUN_003cf338) not translated: takes no room');
          gw16 = 0; h = 0; p += n;
        }
      }
    } else if (c < 0x20) {
      if (c === 10) { nl = true; nlAdv = 1; }
      else { gw16 = 0; h = 0; count++; p++; }
      notCode = false;
    } else {
      const b = D.widths20[Math.trunc((c - 0x20) / 2)];
      let gw = ((c & 1) ? b >> 4 : b & 0xf) + 1;
      if (w.flags5e & 0x40) { const o = ((0xe - gw) >>> 1) | 0; gw = 0xe - o; off = o << 4; }
      gw16 = (gw << 20) >> 16;
      if (cond && gw16 > 0x80) { const d = (gw16 - 0x80) >> 1; gw16 = 0x80; if (d >>> 0 < off >>> 0) off -= d; }
      x += off;
      count++; p++; h = 0x100; notCode = false;
    }
    if (nl) {                                      // the line break
      if (limit <= x + 0x80) { y += lineH; lines++; }
      gw16 = 0; h = 0x100;
      y += lineH; lines++;
      x = lineStart + off;
      count++; p += nlAdv;
      nl = false;
    }
    if (limit < x + gw16) { x = lineStart + off; y += lineH; lines++; }   // wrap
    if (gw16 !== 0) x += gw16 + w.spacing * 16;
    if (maxX < x) maxX = x;
    if (maxY < y + h) maxY = y + h;
  }
  return { w: (maxX + Math.trunc(lineStart / 2) + 0xf) >> 4, h: (maxY + 0xf) >> 4, count, lines };
}

// ---------------------------------------------------------------- the event pause's screen (worker 0239)
// Start during an event: the pause object with param 1 (FUN_003bfe28): layout 0x4779c0 (root 0x21; 0x22 image 0x10c,
// 0x23 image 0x35, a type-3 0x24 that draws nothing), language 2's rect override 0x51fc60[2] is 0; FUN_003e2790()
// (DAT_0046b2fc = 2: != 0 and != 3) -> 0x23's image (+0x1a) = 0x36; FUN_003d0a70(root, 1): no opening clip;
// FUN_002419d8(2) == 0 -> FUN_003d5c08(root, 2, 200, 0x60): the full-screen dim, alpha 0x60; FUN_003d58b8(.., 0x477c30):
// 0x23 / 0x22 bilinear. Each frame FUN_003c0520 state 1 (+0x44 = 1): +0x60 = now - 0x100 the first time, then 0x23 and
// 0x22 take alpha (+0x19) FUN_003d0ad0(+0x60, 0x200, 0x20, 0x80, now) (a 1024 ms triangle 0x20 .. 0x80).
// T: GS dump w239 f1453 (Start at f1420): the dim, then 0x22, then 0x23, at the layout's places, one alpha.
// Not on the page: its sounds (FUN_003cb480(1) and the open sound 3; the page's menu-sound latch does not run while the
// opening plays: warned).
export const PULSE = { period: 0x200, lo: 0x20, hi: 0x80 };
// FUN_003d0ad0(start, period, a, b, now)
export function pulse(start, period, a, b, now) {
  a &= 0xff; b &= 0xff;
  if (start === 0) return b;
  let u = ((now - start) | 0) % ((period << 1) | 0);
  let d = b - a; if (d < 0) d = -d;
  if (period <= u) u = period * 2 - u;
  u = Math.trunc((u * (d & 0xff)) / period) & 0xff;
  return a < b ? (a + u) & 0xff : (a - u) & 0xff;
}
export class EventPauseScreen extends PauseScreen {
  constructor(D, now) {
    super(D, { layout: 'eventpause', focusId: 0xff, now, dim: false });
    const icon = this.byId(0x23);
    if (icon) icon.image = 0x36;                   // FUN_003e2790() == 1 at language 2
    this.root.flags |= 0x80;                       // FUN_003d0a70(root, 1)
    this.root.dimMode = 2; this.root.dimAlpha = 0x60;   // FUN_003d5c08(root, 2, 200, 0x60)
    this.t60 = 0;                                  // +0x60
    warnOnce('epse', 'event pause: its sounds (FUN_003cb480(1), the open sound) are not played on the page');
  }
  // FUN_003c0520, state 1 (once a frame, before the draw)
  frame(now) {
    if (this.t60 === 0) this.t60 = now - 0x100;
    for (const id of [0x23, 0x22]) {
      const w = this.byId(id);
      if (w) w.rgba[3] = pulse(this.t60, PULSE.period, PULSE.lo, PULSE.hi, now);
    }
  }
}

// ---------------------------------------------------------------- box kind 27, the choice box (FUN_003b8ec8; worker 0263)
// Layout 0x472c98: root 0x17 (type 1, image 10), title 0x18 (type 9), list 0x19 (type 6). Record: +8 = title, +0x14 = list, +0x1c = FUN_003b90d0.
const LIST_ID = 0x19, TITLE_ID = 0x18, ROW_H = 0x14;
export class EventChoiceScreen extends PauseScreen {
  constructor(D, now, openMs) {
    super(D, { layout: 'window27', focusId: 0xff, now, dim: false });
    this.se = 9;                                   // FUN_003e1d10(9, -1, -1) after FUN_003d4160's open sound (the last write of a frame wins)
    this.text = this.byId(TITLE_ID);
    this.list = this.byId(LIST_ID);
    if (openMs !== -1) { this.end = now + openMs; this.cur = (this.flags & 0x10) ? 0 : openMs; this.total = openMs; }
    this.result = 0;                               // the record's +1 (FUN_003b6910)
    this.rows = [];                                // FUN_003d9648's records: string bytes, width
    this.cursor = 0;                               // +0x84
    this.init = 0;                                 // +0x1130
    this.barPrev = 0; this.barAt = 0; this.barOff = 0; this.barFrom = 0; this.barTo = 0;   // FUN_003da9f8: +0xbc, +0xac, +0xb0, +0xb4, +0xb8
    this.barSpan = 0;                              // +0xbe
    this.pulseStart = 1;
  }
  byId(id) { return this.all.find(w => w.id === id) || null; }
  // FUN_003b6c98 for this box: root, title (+8) and list (+0x14) change by the same amount, not below 0
  setSize(w, h) {
    const r = this.root, dw = s16(w - r.w), dh = s16(h - r.h);
    this.resize(r, w, h);
    for (const t of [this.text, this.list]) if (t) this.resize(t, Math.max(s16(t.w + dw), 0), Math.max(s16(t.h + dh), 0));
  }
  // FUN_003b6ab8 -> vt+0xd4: the title's text (as EventWindowScreen.setText)
  setText(bytes) { EventWindowScreen.prototype.setText.call(this, bytes); }
  // FUN_003b7330(box, str, i, -1, 0) -> FUN_003b9110 with a string: FUN_003d9648(list, record, 1, 0x7fff, 0) (record +4 flags 0, +8 the string, +0xc x 0);
  // a row wider than the list widens the box
  addRow(bytes) {
    if (this.rows.length >= 0x18) return;          // sVar1 < 0x18
    if (!this.list) return;
    const m = measureCodes(this.D, Object.assign(rowWidget(this.list), { iw: 0x7fff, textOff: [0x7f, 0x7f] }), bytes);
    this.rows.push({ bytes, count: m.count, w: m.w });
    if (this.list.w < m.w) this.setSize(s16(this.root.w + (m.w - this.list.w)), this.root.h);
  }
  // FUN_003b7330(box, 0, sel, -1, 0) -> FUN_003b9110 without a string: the box grows by the title, the list moves down by it, FUN_003da810 fits the list to
  // whole rows (and the root by the same change), FUN_003d9ca0 the cursor, +0x1130 = sel
  select(sel) {
    const t = this.text, l = this.list, r = this.root;
    if (!l) return;
    if (t && t.th) {
      const d = s16(t.th + (t.y - r.y) * 2);
      this.setSize(r.w, s16(d + r.h));
      l.ry = s16(l.ry + d); l.y = s16(l.y + d); this.resize(l, l.w, s16(l.h - d));
    }
    const fit = Math.min(Math.trunc((l.h + 0x13) / ROW_H) * ROW_H, Math.max(this.rows.length, 1) * ROW_H);   // FUN_003da780: not over the rows' height
    const old = l.h;
    this.resize(l, l.w, fit);
    this.resize(r, r.w, s16(r.h - old + l.h));
    this.cursor = sel < 0 ? 0 : Math.min(sel, this.rows.length - 1);   // FUN_003d9ca0
    this.barPrev = this.cursor;                    // +0xbc
    this.init = sel === -1 ? 0 : sel;
    // FUN_003b9110: FUN_003da800 (+0xa6, the scroll bar's width, 0 when the rows fit: FUN_003ca388) -> +0x90 |= 1. RAM s2420: +0x90 = 3, +0xa6 = 0 in wro_kaisetu's box
    this.noPage = this.rows.length * ROW_H <= l.ih;
    if (Math.trunc((l.ih + ROW_H - 1) / ROW_H) < this.rows.length) warnOnce('scroll', 'event window: a choice list longer than the box (scrolling, FUN_003d9368) not translated');
  }
  // the box's input (FUN_003d8bc8 for the fresh presses, FUN_003b9000, FUN_003b9070). a: 'up' 'down' 'cross' 'circle'. Locked after a choice (FUN_003d4780)
  key(a, now) {
    if (this.flags & 2) return false;              // FUN_003de568's gate FUN_003d47b8: flag 2 only (the close and FUN_003d4780), so the 100 ms open takes keys
    const n = this.rows.length, was = this.cursor;
    if (a === 'up') this.cursor = was - 1 < 0 ? Math.max(n - 1, 0) : was - 1;        // FUN_003d9238 at the top: the last row
    else if (a === 'down') this.cursor = was + 1 >= n ? 0 : was + 1;                 // FUN_003d9228 at the end: the first row
    else if (a === 'left' || a === 'right') {        // FUN_003d8bc8 +0x30 / +0x3c: a page, clamped to the first / last row (FUN_003d9228 / FUN_003d9238); +0x90 bit 0: nothing. The list's nav bytes are all 0xff
      if (this.noPage) return true;
      const page = Math.trunc((this.list.ih + ROW_H - 1) / ROW_H);   // +0x88, FUN_003d94d0
      if (a === 'left') { if (was !== 0) this.cursor = Math.max(was - page, 0); }
      else if (was !== n - 1) this.cursor = Math.min(was + page, n - 1);
    } else if (a === 'cross' || a === 'circle') {
      // FUN_003b9000 / FUN_003b9070 -> FUN_003b7830(box, list, 3 / 4): result; +0x3c = 1 (FUN_003b66c0's param_4), so FUN_003d4f00 + vt+0x34 (FUN_003b7930(box, 100)); sound 7 / 8
      this.result = a === 'cross' ? 3 : 4;
      this.se = a === 'cross' ? SE.confirm : SE.cancel;
      this.close(now);
      this.se = a === 'cross' ? SE.confirm : SE.cancel;
      return true;
    }
    if (this.cursor !== was) this.se = SE.cursor;  // FUN_003d9f00: FUN_003cb4a8(list, 6, 0)
    return true;
  }
  drawWidget(w) {
    if (w === this.list) this.drawList(w);
    else if (w.type === 9) EventWindowScreen.prototype.drawText9c.call(this, w);
    else super.drawWidget(w);
  }
  // FUN_003d7bd8 (list draw; rows: x = FUN_003da480 (ix + 2 when ix = x), y = FUN_003da4a0 + row x 20 + (row height - 0x10) / 2; the cursor's row 0x80808080, the others FUN_003d0c88: 0x10 less each)
  drawList(l) {
    const x = s16(l.ix * 2 + 2 - l.x), y0 = s16(l.iy * 2 - l.y);
    const save = this.sc;
    this.sc = scissor(l.ix, l.iy, l.iw, l.ih);    // FUN_003cae68
    this.drawBar(l, x, y0);
    this.linear = true;
    this.rows.forEach((row, i) => {
      const rw = Object.assign(rowWidget(l), { x, y: s16(y0 + i * ROW_H + ((ROW_H - 0x10) >> 1)), ix: x, iy: s16(y0 + i * ROW_H + ((ROW_H - 0x10) >> 1)), iw: l.iw, ih: 0x7fff, col4c: i === this.cursor ? [0x80, 0x80, 0x80, 0x80] : [0x70, 0x70, 0x70, 0x80], tw: row.w });
      this.renderCodes(rw, row.bytes, row.count, 0x7fff);
    });
    this.linear = false;
    this.sc = save;
  }
  // FUN_003da9f8: a bar across the cursor's row: 3 x 2 vertices, colour 0x192887, alpha 0 at both ends and FUN_003d0ad0(1, 500, 0x40, 0x82) in the middle (focused)
  // A moved cursor drags a second bar from the old row over 150 ms (+0xac .. +0xbe)
  drawBar(l, x, y0) {
    const now = this.now, cur = this.cursor, H = ROW_H;
    const yc = s16(y0 + cur * H), w = l.iw;
    const a = pulse(this.pulseStart, 500, 0x40, 0x82, now);
    const x0 = (x + 1) * 16;                       // FUN_003da480 + 1
    const xm = x0 + Math.trunc((w - (w >> 31)) / 2) * 16, x1 = x0 + w * 16;
    const strip = (top, bot) => {
      const c0 = [0x87, 0x28, 0x19, 0], cm = [0x87, 0x28, 0x19, a];
      this.emitStrip([[x0, top], [x0, bot], [xm, top], [xm, bot]], [c0, c0, cm, cm], null);
      this.emitStrip([[xm, top], [xm, bot], [x1, top], [x1, bot]], [cm, cm, c0, c0], null);
    };
    let top = yc * 16, bot = top + (H - 1) * 16;
    strip(top, bot);
    if (this.barPrev !== cur) {
      const big = this.barPrev < cur;
      const target = big ? cur * H : cur * H + H - 1;
      this.barFrom = this.barSpan === 0 ? (big ? this.barPrev * H : this.barPrev * H + H - 1) : this.barTo;
      let d = (big ? target - this.barFrom : this.barFrom - target) << 16 >> 16;
      this.barSpan = d;
      if (H <= d) { this.barSpan = H; this.barFrom = big ? target - H : target + H; }
      this.barAt = now; this.barOff = 0;           // +0xb0 = 0: the list did not scroll
      this.barPrev = cur;
    }
    if (this.barAt !== 0) {
      const t0 = this.barAt + this.barOff, base = (cur * H) << 16 >> 16;
      if (t0 + 0x96 < now) { this.barFrom = base; this.barAt = 0; this.barSpan = 0; }
      else {
        const u = now < t0 ? 0 : now - t0;
        const s = f32(Math.sin(f32(f32((Math.trunc(u * 0x800 / 0x96) + 0xc00) * 0x100000 >> 20) * f32(0.0015339808))));
        const hs = f32(Math.trunc((this.barSpan + (this.barSpan >>> 15 & 1)) / 2));
        const dd = this.barSpan - Math.trunc(f32(f32(s * hs) + hs));
        this.barTo = base < this.barFrom ? base + H + dd - 1 : base - dd;
        const yb = s16(y0 + this.barTo) * 16;
        if (yb < top) strip(top, yb);              // lVar9 < lVar8: the bottoms move to the point
        else if (yb !== top) strip(yb, bot);       // else the tops
      }
    }
  }
}
EventChoiceScreen.prototype.renderCodes = StageInfoScreen.prototype.renderCodes;
// the list's text fields as a type-9 widget's (FUN_003cc0a8 reads the widget it is given; the list has no text of its own)
function rowWidget(l) {
  return { type: 9, id: l.id, x: l.x, y: l.y, w: l.w, h: 0x7fff, ix: l.ix, iy: l.iy, iw: l.iw, ih: 0x7fff, flags: 0, flags5e: (l.s36 & 0xffff), lineGap: 0, spacing: 0,
    textOff: [0x7f, 0x7f], col4c: [0x80, 0x80, 0x80, 0x80], c58: [0x80, 0x80, 0x80, 0x80], parent: l.parent, children: [] };
}

// ---------------------------------------------------------------- the event's window list (+0x9804)
// D: stage_info.js loadStageInfoData(stage_info.json, loadPauseData(pause.json)) (layouts incl. window4, the '$'
// codes, the speaker table and names). Without D the windows still run (book-keeping only) and nothing is drawn.
export function createEventWindows({ D = null, warn = (m) => console.warn(m), se = null } = {}) {
  const W = {
    D,
    now: 0,                                       // FUN_0023c1f0 (ms), FRAME_MS a frame
    entries: Array.from({ length: 5 }, () => ({ id: 0, box: null, state: 0 })),
    screens: [],                                  // live boxes (open or closing), in creation order
    log: [],                                      // (event frame, what) for tests
    natives(R) {
      return {
        'fake/KerberosWindow.open_l(IIIIIILjava/lang/String;I)V': (vm, [id, kind, x, y, w, h, key, t]) => {
          // FUN_0039ec20: the key -> FUN_003a6698 (no message file -> the empty string 0x4a3580)
          const k = key == null ? null : String(key);
          const hex = R.data.messages ? R.data.messages[k] : undefined;
          if (!R.data.messages) warnOnce('nomsg', 'event window: the event data has no messages (re-run export_web_event.py)', warn);
          else if (hex === null || hex === undefined) warnOnce('miss' + k, 'event window: ' + k + ' not in the message file', warn);
          const text = hex ? hexBytes(hex) : new Uint8Array(0);
          R.cmd(10, { id: id | 0, x: s16(x), y: s16(y), w: s16(w), h: s16(h), kind: kind & 0xffff, text, t: t | 0, key: k });
        },
        'fake/KerberosWindow.close_l(I)V': (vm, [id]) => W.close(R, id | 0),
        // open_l_str(id, kind, x, y, w, h, keys, sel, t) (FUN_0039ed48 -> FUN_0037c510): as open_l, each key's message copied, count = keys' length, +0x36 sel (worker 0263)
        'fake/KerberosWindow.open_l_str(IIIIII[Ljava/lang/String;II)V': (vm, [id, kind, x, y, w, h, keys, sel, t]) => {
          if (!keys || !keys.a || !keys.a.length) return;  // sStack_b0 == 3 && length != 0
          const texts = keys.a.map(k => { const hex = R.data.messages ? R.data.messages[String(k)] : null; if (!hex) warnOnce('miss' + k, 'event window: ' + k + ' not in the message file', warn); return hex ? hexBytes(hex) : new Uint8Array(0); });
          R.cmd(10, { id: id | 0, x: s16(x), y: s16(y), w: s16(w), h: s16(h), kind: kind & 0xffff, texts, sel: sel | 0, t: t | 0, key: String(keys.a[0]) });
        },
        // getstate_l(id) (FUN_003a06b8 -> FUN_00378f10): no entry 0; +0x156c == 2: by the box's kind (FUN_003b6888): 0, 9, 0x1a, 0x29 -> 1; 1, 0x18, 0x1b, 0x3b -> 2; 2, 0x19, 0x2d -> 3; else the entry's state 2 -> 1, 3 -> 2, 4 -> 3
        'fake/KerberosWindow.getstate_l(I)I': (vm, [id]) => {
          const e = W.entries.find(x => x.id !== 0 && x.id === (id | 0));
          if (!e) return 0;
          if (R.skip === 2) { const k = e.kind; return [0, 9, 0x1a, 0x29].includes(k) ? 1 : [1, 0x18, 0x1b, 0x3b].includes(k) ? 2 : [2, 0x19, 0x2d].includes(k) ? 3 : 0; }
          return e.state === 2 ? 1 : e.state === 3 ? 2 : e.state === 4 ? 3 : 0;
        },
        // getvalue_l(id, a, b) (FUN_003a0398 -> FUN_00378e48): +0x156c == 2: a = 1, b = 0; FUN_003b7428 -> 0x472e60[kind]: kind 27 FUN_003b9420: a == 1 -> +0x1130, else FUN_003b9450: the list's +0x84
        'fake/KerberosWindow.getvalue_l(III)I': (vm, [id, a]) => {
          const e = W.entries.find(x => x.id !== 0 && x.id === (id | 0));
          const c = e && e.box && e.box.box;
          if (!e) return 0;
          if (e.kind !== CHOICE_KIND) { warnOnce('gv' + e.kind, 'event window: getvalue_l of box kind ' + e.kind + ' (0x472e60) not translated', warn); return 0; }
          const A = R.skip === 2 ? 1 : a;
          if (!c) return e.sel || 0;
          return A === 1 ? c.init : c.cursor;
        },
      };
    },
    // FUN_00378b00 (+ FUN_003789b8)
    close(R, id) {
      const E = W.entries;
      let hit = null;
      if (E[0].id !== 0 && E[0].id === id) hit = E[0];
      else for (let i = 1; i < 5; i++) if (E[i].id !== 0 && E[i].id === id) { hit = E[i]; break; }
      if (hit) hit.id = -1;
      // FUN_003789b8: a command 10 not yet run (this id, or all when id < 0) is freed
      R.slots = R.slots.filter(c => !(c.type === 10 && (id < 0 || c.id === id)));
      W.log.push([R.frameNo, 'close ' + id]);
    },
    // FUN_00383408
    open(R, c) {
      if ((c.kind & 0xff) === CHOICE_KIND) { W.openChoice(R, c); return; }
      if ((c.kind & 0xff) !== WINDOW_KIND) {
        warnOnce('kind' + c.kind, 'event window: box kind ' + c.kind + ' (PTR_FUN_00472d68) not translated; left out', warn);
        return;
      }
      if (W.screens.length >= 8) { warnOnce('slots', 'event window: all 8 box slots busy (FUN_003b66c0 -> -1)', warn); return; }
      const openMs = c.t === 0 ? -1 : c.t;                       // +0x38 == 0 -> -1
      const box = W.D && W.D.layouts && W.D.layouts.window4 ? new EventWindowScreen(W.D, W.now, openMs) : null;
      if (W.D && !box) warnOnce('nolayout', 'event window: pause.json lacks the window layout 0x472c48 (re-run export_web_pause.py); not drawn', warn);
      const rec = { box, id: c.id, key: c.key };
      if (box) {
        if (R.skip !== 0) box.flags |= 0x4000;                    // FUN_003b75b0(box, 1): silent
        box.moveTo(box.root, c.x, c.y);                           // FUN_003b6c10
        box.setSize(c.w, c.h);                                    // FUN_003b6c98
        box.setText(c.text);                                      // FUN_003b6ab8
      }
      W.screens.push(rec);
      W.log.push([R.frameNo, 'open ' + c.id + ' ' + c.key]);
      const e = W.entries.find(x => x.id === 0);
      if (e) {
        e.id = c.id; e.box = rec; e.state = 0; e.kind = c.kind;
        if (R.skip !== 0) W.hide(rec);                            // FUN_003b7118(box, 1)
      } else W.closeBox(rec);                                     // no free entry: FUN_003b6978(box, -1)
    },
    // FUN_00383408 for kind 27 (worker 0263): FUN_003b66c0 -> FUN_003b8ec8; place, size; string 0 = the title (FUN_003b6ab8), the others rows (FUN_003b7330), then FUN_003b7330(box, 0, +0x36, -1, 0)
    openChoice(R, c) {
      const openMs = c.t === 0 ? -1 : c.t;
      const box = W.D && W.D.layouts && W.D.layouts.window27 ? new EventChoiceScreen(W.D, W.now, openMs) : null;
      if (W.D && !box) warnOnce('nolayout27', 'event window: pause.json lacks the choice layout 0x472c98 (re-run export_web_pause.py); not drawn', warn);
      const rec = { box, id: c.id, key: c.key };
      if (box) {
        if (R.skip !== 0) box.flags |= 0x4000;
        box.moveTo(box.root, c.x, c.y);
        box.setSize(c.w, c.h);
        c.texts.forEach((t, i) => { if (i === 0) box.setText(t); else box.addRow(t); });
        box.select(c.sel);
      }
      W.screens.push(rec);
      W.log.push([R.frameNo, 'open ' + c.id + ' ' + c.key]);
      const e = W.entries.find(x => x.id === 0);
      if (e) {
        e.id = c.id; e.box = rec; e.state = 0; e.kind = c.kind; e.sel = c.sel;
        if (R.skip !== 0) W.hide(rec);
      } else W.closeBox(rec);
    },
    // the keys of an open choice box (the menu manager's focus: it takes them before the event pause; play.js)
    choiceKey(a, now = W.now) {
      for (const e of W.entries) {
        const b = e.id > 0 && e.box && e.box.box;
        if (b instanceof EventChoiceScreen && !b.closing) { b.key(a, W.now); return true; }
      }
      return false;
    },
    hide(rec) { if (rec.box) rec.box.root.flags |= 1; },        // FUN_003d46a8 -> FUN_003cb360(root, 1)
    closeBox(rec) {                                               // vt+0x34 FUN_003b88d8 -> FUN_003b7930(box, 100)
      rec.closing = true;
      if (rec.box) { rec.box.close(W.now); rec.box.se = null; }  // FUN_003e1d80: no close sound
      else W.screens.splice(W.screens.indexOf(rec), 1);
    },
    // once an event frame, after the slot loop (event_rt.js frame)
    frame(R) {
      W.now += FRAME_MS;
      for (const c of R.slots.filter(s => s.type === 10)) {      // case 10: FUN_00383408 returns 1, the slot is freed
        R.slots.splice(R.slots.indexOf(c), 1);
        W.open(R, c);
      }
      for (const e of W.entries) {                                // LAB_00378684
        if (e.id === 0) continue;
        if (e.id < 0) {                                           // FUN_003788d8
          if (e.box) W.closeBox(e.box);
          e.box = null; e.id = 0;
        } else e.state = e.box && e.box.box ? e.box.box.result : 0;
      }
      W.update();
    },
    // the menu manager's per-frame update (FUN_003d5340): timers; a closed box goes (FUN_003d4630)
    update() {
      for (const rec of W.screens.slice()) {
        if (!rec.box) continue;
        if (rec.box instanceof EventChoiceScreen && rec.box.se != null) { if (se) se(rec.box.se, rec.box); rec.box.se = null; }   // FUN_003e1d10's latch (the box's own sounds; worker 0263)
        rec.box.update(W.now);
        if (rec.box.closing) W.screens.splice(W.screens.indexOf(rec), 1);
      }
    },
    skip(R) { for (const e of W.entries) if (e.id !== 0 && e.box) W.hide(e.box); },   // FUN_00372f70's FUN_003b7118 loop
    // the frame's primitives for pause_layer.js (the open boxes, in creation order)
    draw() {
      const out = [];
      for (const rec of W.screens) if (rec.box && !(rec.box.root.flags & 1)) out.push(...rec.box.draw(W.now));
      return out;
    },
    reset() { W.entries.forEach(e => { e.id = 0; e.box = null; e.state = 0; }); W.screens.length = 0; W.prompt = null; },
    // the event pause's screen (EventPauseScreen): open at Start, closed (100 ms) at resume / Skip; now = the menu clock (ms)
    prompt: null,
    pausePrompt(on, now) {
      if (on) { if (W.D && W.D.layouts && W.D.layouts.eventpause) W.prompt = new EventPauseScreen(W.D, now); else warnOnce('noep', 'event pause: pause.json lacks layout 0x4779c0 (re-run export_web_pause.py); not drawn', warn); }
      else if (W.prompt) W.prompt.close(now);
    },
    // the menu draw while the opening plays: the windows, then the pause's screen (it is opened last)
    drawAll(now) {
      const out = W.draw();
      const P = W.prompt;
      if (P) {
        P.update(now);
        if (P.closing) W.prompt = null;
        else { P.frame(now); out.push(...P.draw(now)); }
      }
      return out;
    },
  };
  return W;
}

// pause.json + stage_info.json -> D (both are built by build_web.sh: steps pause / stageinfo)
export async function loadEventWindowData(fetchJson = (u) => fetch(u).then(r => (r.ok ? r.json() : null))) {
  const [pj, sj] = await Promise.all([fetchJson('data/pause.json'), fetchJson('data/stage_info.json')]);
  if (!pj || !sj) { console.warn('event window: data/pause.json or data/stage_info.json missing: subtitles not drawn'); return null; }
  const { loadPauseData } = await import('./pause.js');
  const { loadStageInfoData } = await import('./stage_info.js');
  return loadStageInfoData(sj, loadPauseData(pj));
}
