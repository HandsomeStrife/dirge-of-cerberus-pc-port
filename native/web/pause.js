// Pause menu (Start in play): the game's pause screen, translated. Pure logic, no three.js:
// pause_layer.js draws the primitives this file emits.
//
// Screen  FUN_003bfe28 (pause ctor, layout 0x477678 through menu_layout.js), open FUN_003d5110,
//         per-frame timer FUN_003d5340, root draw FUN_003d5ac0 (dimming FUN_003d5c40).
// Images  FUN_003c97a0 (gradient FUN_003c8dc0, rows FUN_003c94e0 / FUN_003c9110, sprite
//         FUN_003cac70), inner rect FUN_003ca160.
// Button  type 12: ctor FUN_003d11c0 + FUN_003d1950 (unfocused colours) + FUN_003d7488, draw
//         FUN_003d75a0 -> FUN_003d1368, text FUN_003cc0a8 -> FUN_003cedf0 (the '$&' glyph font).
// Input   FUN_003de130 / FUN_003de568 (actions), FUN_003cbc38 + FUN_003cb018 (up / down),
//         FUN_003dde80 (focus), pause events FUN_003c0220 / FUN_003c04c8, close FUN_003bfd70.
// Output  primitives in the GS drawable (432 x 512) in 1/16 px, exactly as FUN_003d2e80 /
//         FUN_003d3098 write them (script flag 0x1e set: x * 432 / 512, y * 512 / 448), so tests
//         compare them with the GS dump of the open pause menu draw for draw.
// Notes: notes/menu-research.md ("Pause menu drawing", worker 0180).
import { buildLayout, hexBytes } from './menu_layout.js';

// FUN_003d2e80 / FUN_003d3098 with DAT_004f2258 (script flag 0x1e) set: layout units (1/16) ->
// drawable 1/16 px, rounding toward zero; DAT_004f2424 / 2428 (the XYOFFSET origin) left out.
export const gsX = x16 => { const t = x16 * 0x1b0; return (t < 0 ? t + 0x1ff : t) >> 9; };
export const gsY = y16 => Math.trunc((y16 * 512) / 0x1c0);
const s16 = v => (v << 16) >> 16;
const rgbaOf = u => [u & 0xff, (u >>> 8) & 0xff, (u >>> 16) & 0xff, u >>> 24];

// FUN_003c9110: the edge colour is the colour / 4 per channel, alpha kept
const quarter = c => [c[0] >> 2, c[1] >> 2, c[2] >> 2, c[3]];

// FUN_003e1d10 sound ids (recorded, not played: the menu SE bank isn't decoded; see notes):
// pause 1 (FUN_003bfe28 -> FUN_003cb480(1)), unpause 2 (FUN_003c04c8), screen open 3 (FUN_003d5110),
// screen close 4 (FUN_003d51c0), cursor 6, confirm 7, cancel 8 (FUN_003cb4a8)
export const SE = { pause: 1, unpause: 2, open: 3, close: 4, cursor: 6, confirm: 7, cancel: 8 };

// ---------------------------------------------------------------- data (pause.json)
export function loadPauseData(json) {
  const msg = {};
  for (const [k, v] of Object.entries(json.messages)) msg[parseInt(k, 16)] = hexBytes(v);
  const widths = hexBytes(json.widths);
  return { ...json, msg, widthBytes: widths };
}

// ---------------------------------------------------------------- widgets
function imageOf(D, id) { return D.images[String(id)] || null; }

// FUN_003ca160: inner rect (+0xe..+0x14) from the image's margin pieces
function innerRect(D, w) {
  const I = w.image === 0xffff ? null : imageOf(D, w.image);
  const K = I ? D.kinds[I.kind] : null;
  w.ix = w.x; w.iw = w.w; w.iy = w.y; w.ih = w.h;
  if (I && K[2] !== 0 && I.slices.length) {
    const l = Math.abs(I.slices[K[3]][2]), r = Math.abs(I.slices[K[4]][2]);
    w.ix = w.x + l;
    w.iw = s16(w.w - l - r);
    if (w.iw < 0) { w.iw = 0; w.w = l + r; }
  }
  if (I && K[6] !== 0 && I.slices.length) {
    const t = Math.abs(I.slices[K[7]][3]), b = Math.abs(I.slices[K[8]][3]);
    w.iy = w.y + t;
    w.ih = s16(w.h - t - b);
    if (w.ih < 0) { w.ih = 0; w.h = t + b; }
  }
}

function makeWidgets(D, lw, parent, out) {
  const w = {
    type: lw.type, id: lw.id, nav: lw.nav, nav4: lw.params.nav4,
    x: lw.rect[0], y: lw.rect[1], w: lw.rect[2], h: lw.rect[3],
    rgba: lw.rgba.slice(), image: lw.image, flags: 0, parent, children: [],
    textOff: lw.textOff.slice(), s36: lw.s36, textId: lw.text >>> 0,
  };
  innerRect(D, w);
  if (lw.type === 12 || lw.type === 3) initButton(D, w);
  out.push(w);
  for (const c of lw.children) makeWidgets(D, c, w, w.children);   // RAM: +0x24 list in creation order
  return w;
}

// FUN_003d11c0 (type 3) + FUN_003cbf18 (text) + FUN_003d7488 (type 12)
function initButton(D, w) {
  w.col74 = rgbaOf(0x808a86ff);                    // focused text
  w.rgb78 = w.rgba.slice(0, 3);                    // focused frame
  if (w.image === 6) {                             // FUN_003d1950: unfocused = half, text 0x70 grey
    w.rgb80 = w.rgb78.map(v => v >> 1);
    w.col7c = rgbaOf(0x80707070);
  } else {
    w.rgb80 = w.rgb78.slice();
    w.col7c = rgbaOf(0x80707070);
  }
  w.textCol = w.col74;
  // FUN_003d03a0(w, id, 0, 1): message FUN_003fd578(id & 0x7fffffff); a '$&' string sets 0x480
  // (bit 0x80: FUN_003cedf0's glyph font; 0x400: skip the 2 bytes)
  w.str = w.textId ? (D.msg[w.textId & 0x7fffffff] || null) : null;
  w.flags5e = w.s36 & 0xffff;
  if (w.str) {
    if (w.str[0] === 0x24 && w.str[1] === 0x26) w.flags5e |= 0x480;
    else w.flags5e &= 0xfb7f;
  }
  w.spacing = 0;                                   // +0x65: FUN_003e2760() != 0 (language 2, not JP) -> 0
  if (w.type === 12) {                             // FUN_003d7488: orb (image 7) and highlight (image 8)
    const i7 = imageOf(D, 7), i8 = imageOf(D, 8), me = imageOf(D, w.image);
    w.orbUV = [i7.slices[0][0], i7.slices[0][1]];
    w.orbWH = [i7.slices[0][2], i7.slices[0][3]];
    w.orbPage = i7.page;
    w.d96 = me.slices[0][2] - i8.slices[0][2];
    w.d98 = me.slices[0][3] - i8.slices[0][3];
  }
}

// ---------------------------------------------------------------- the screen
export class PauseScreen {
  // D: loadPauseData(pause.json); layout: 'pause' (0x477678) or 'yesno' (0x472ad8)
  constructor(D, { layout = 'pause', focusId = 0xff, now = 0, pulseBase = 0 } = {}) {
    this.D = D;
    const L = buildLayout(hexBytes(D.layouts[layout]), D.opLen, { focusId });
    this.widgets = [];
    this.root = makeWidgets(D, L.roots[0], null, this.widgets);
    this.all = [];
    const walk = w => { this.all.push(w); w.children.forEach(walk); };
    walk(this.root);
    // FUN_003d58b8(screen, root, 0x477c18) with flag 0x1e: flag 8 (TEX1 bilinear) on the listed ids
    for (const id of (D.linearIds && D.linearIds[layout]) || []) { const w = this.all.find(x => x.id === id); if (w) w.flags |= 8; }
    this.focus = null;
    if (L.focus) this.setFocus(this.all.find(w => w.id === L.focus.id));
    // FUN_003bfe28: FUN_003d5c08(root, 2, 200, 0x40): dimming mode 2, alpha 0x40
    this.root.dimMode = 2; this.root.dimAlpha = 0x40;
    // FUN_003d4040 -> FUN_003d5090: cur = total = 100; FUN_003d4198 -> FUN_003d5110 opens it
    this.cur = 100; this.total = 100; this.flags = 0; this.end = 0;
    this.pulseBase = pulseBase;                    // DAT_004f55e8 (see FUN_003d75a0)
    this.clipH = 0x1c0;
    this.open(now);
    this.events = [];                              // SE ids and screen results, for the caller
  }
  // FUN_003d5110: 100 ms open (flag 0x10), sound 3
  open(now) {
    if (this.flags & 0x10) return;
    this.end = (this.flags & 0x60) === 0 ? now + 100 : now + 100 - (this.end >= now ? this.end - now : 0);
    if ((this.flags & 0x60) === 0) this.cur = 0;
    this.total = 100;
    this.flags = (this.flags & 0xff9f) | 0x10;
    this.se = SE.open;
  }
  // FUN_003d4640 -> FUN_003d4588 -> FUN_003d51c0(screen, 100): the timer runs back to 0 (flag 0x20),
  // input locked (FUN_003d4780: flag 2); at 0 the screen is destroyed (FUN_003d4630)
  close(now) {
    if (this.flags & 0x20) return;
    if ((this.flags & 0x90) === 0) { this.cur = 100; this.end = now + 100; }
    else {
      const st = this.end - 100;                   // the open started here
      this.end = st < now ? Math.min(now * 2 - st, now + 100) : now + 100;
    }
    this.total = 100;
    this.flags = (this.flags & 0xff6f) | 0x20 | 2;
  }
  // FUN_003d5340: timer and the children's clip height (+0x26)
  update(now) {
    if (this.flags & 0x30) {
      if (!(this.flags & 0x10)) {                  // closing
        if (now < this.end) this.cur = this.end - now;
        else { this.flags &= 0xffdf; this.cur = 0; this.closing = true; }
      } else if (this.end <= now) {
        this.cur = this.total; this.flags &= 0xffef;
      } else {
        this.cur = now - (this.end - this.total);
      }
    }
    const r = this.root;
    this.clipH = this.cur === this.total ? 0x1c0 : s16(r.iy + Math.trunc((r.ih * this.cur) / this.total));
  }
  anim(w) { return this.cur !== this.total && !(w.flags & 0x40); }
  // FUN_003dde80 (focus bits) as used by FUN_003dd6c8
  setFocus(w) {
    if (this.focus) this.focus.flags &= ~0x06;
    w.flags |= 2;
    this.focus = w;
  }
  lit(w) { return (w.flags & 2) !== 0 && this.focus === w; }    // FUN_003caba8

  // ---- input: FUN_003de568 actions 0 ✕, 1 ○, 2 up, 3 down, 4 left, 5 right.
  // kind: FUN_00255030 source, 0 = pad (no wrap), 1 = mouse, 2 = keyboard (wrap; FUN_003cb018 param_4)
  action(a, kind = 0) {
    if (this.flags & 2) return null;               // FUN_003d47b8: input locked (set by the close)
    const f = this.focus;
    if (!f) return null;
    if (a === 0) { this.se = SE.confirm; return { event: f.id }; }  // FUN_003d14e8 -> screen vt+0x24
    if (a === 1) { this.se = SE.cancel; return { cancel: true }; }  // FUN_003caf90 -> screen vt+0x2c
    if (a === 2 || a === 3) {
      const n = f.nav4[a - 2];
      let t = f;
      if (n === 0xff) t = this.next(f, f.nav, a === 2 ? 1 : 2, kind !== 0);
      else if (!(n & 0x80) || kind !== 0) t = this.next(f, n & 0x7f, 0, true);
      if (t !== f) { this.setFocus(t); this.se = SE.cursor; return { moved: t.id }; }
      return null;
    }
    if (a === 4 || a === 5) {                      // FUN_003cbc38: explicit neighbours only
      const n = f.nav4[a];
      if (n === 0xff || ((n & 0x80) && kind === 0)) return null;
      const t = this.next(f, n & 0x7f, 0, true);
      if (t !== f) { this.setFocus(t); this.se = SE.cursor; return { moved: t.id }; }
    }
    return null;
  }
  // FUN_003cb018(w, order, mode, wrap): mode 1 = previous sibling with order <= cur,
  // 2 = next with order >= cur, 0 = the sibling with that order; wraps at the list end if `wrap`
  next(w, order, mode, wrap) {
    const sib = w.parent ? w.parent.children : [w];
    let i = sib.indexOf(w), ord = order;
    if (order === 0xff) return w;
    for (let guard = 0; guard < 64; guard++) {
      if (mode === 1) {
        i--;
        if (i < 0) { ord = 0xff; if (!wrap) return w; i = sib.length - 1; }
      } else {
        i++;
        if (i >= sib.length) { if (mode === 2) ord = 0; if (!wrap) return w; i = 0; }
      }
      const c = sib[i];
      if (c === w) return w;
      const b = c.nav;
      if (((b + 2) & 0xff) > 1) {
        if (mode === 1 ? b <= ord : mode === 0 ? b === ord : !(b < ord)) return c;
      }
    }
    return w;
  }

  // ---------------------------------------------------------------- drawing
  // Returns the frame's primitives: { kind: 'sprite' | 'strip', tex: page | 'font' | null, clut,
  // clamp, linear, v: [{ x, y, u, v, c: [r, g, b, a] }], sc: scissor (drawable px, inclusive) }
  draw(now) {
    this.out = [];
    this.now = now;
    this.sc = null;
    this.linear = false;
    this.drawRoot(this.root);
    return this.out;
  }
  emitSprite(p0, p1, rgba, tex, extra = {}) {      // FUN_003d2e80
    this.out.push({ kind: 'sprite', tex, linear: this.linear, sc: this.sc, ...extra,
      v: [{ x: gsX(p0[0]), y: gsY(p0[1]), u: p0[2], v: p0[3], c: rgba },
          { x: gsX(p1[0]), y: gsY(p1[1]), u: p1[2], v: p1[3], c: rgba }] });
  }
  emitStrip(verts, cols, tex, extra = {}) {        // FUN_003d3098 (4 vertices, triangle strip)
    this.out.push({ kind: 'strip', tex, linear: this.linear, sc: this.sc, ...extra,
      v: verts.map((p, i) => ({ x: gsX(p[0]), y: gsY(p[1]), u: p[2] ?? 0, v: p[3] ?? 0, c: cols[i] })) });
  }
  // FUN_003d5ac0 (type 1)
  drawRoot(r) {
    if (r.dimMode === 2) this.drawDim(r);
    this.drawImage(r, 1);
    // FUN_003cada0(0, 0, 0x200, clip): children clipped to the opening height
    const clip = (this.anim(r) && !(r.flags & 0x80)) ? this.clipH : 0x1c0;
    this.sc = scissor(0, 0, 0x200, clip);
    for (const c of r.children) if (!(c.flags & 1)) this.drawWidget(c);
    this.sc = null;
  }
  // FUN_003d5c40: full-screen black, alpha 0x40 x the open fraction
  drawDim(r) {
    const a = this.anim(r) ? Math.trunc((r.dimAlpha * this.cur) / this.total) : r.dimAlpha;
    const c = [0, 0, 0, a];
    this.emitStrip([[0, 0], [0x2000, 0], [0, 0x1c00], [0x2000, 0x1c00]], [c, c, c, c], null, { dim: true });
  }
  drawWidget(w) {
    if (w.type === 12) this.drawButton12(w);
    else if (w.type === 3) this.drawButton(w);
    else {                                         // FUN_003d6ec0 (type 4): flag 8 -> FUN_003d3830(1)
      if (w.flags & 8) this.linear = true;
      this.drawImage(w, 0xffff);
      this.linear = false;
    }
  }
  // FUN_003d75a0
  drawButton12(w) {
    this.linear = true;                            // FUN_003d3830(1): TEX1 0x60 (flag 0x1e)
    this.drawButton(w);
    if (this.lit(w) && w.rgba[3] !== 0) {          // FUN_003dcc68() == 0: no menu mouse pointer
      let k = 0x2ee - ((this.now - this.pulseBase) % 0x5dc);
      if (k < 0) k = -k;
      const a = Math.trunc(((0x2ee - k) * 0x60) / 0x2ee) + 0x20;
      const sx = w.x + w.w - 0x15, sy = w.y + 8;   // FUN_003d7868
      const [u, v] = w.orbUV, [ow, oh] = w.orbWH;
      this.emitSprite([sx * 16, sy * 16, u * 16 + 1, v * 16 + 1],
                      [(sx + ow) * 16, (sy + oh) * 16, (u + ow) * 16, (v + oh) * 16],
                      rgbaOf(((a << 24) | 0x505092) >>> 0), w.orbPage);
      const save = { a: w.rgba[3], img: w.image, rgb: w.rgba.slice(0, 3), x: w.x, y: w.y, w: w.w, iw: w.iw, h: w.h, ih: w.ih };
      w.rgba[3] = a; w.image = 8;
      w.y += 1; w.w += w.d96; w.iw += w.d96; w.h -= w.d98; w.ih -= w.d98; w.x += 2;
      w.rgba[0] = w.rgba[1] = w.rgba[2] = 0x80;
      this.drawImage(w, 0xffff);
      w.rgba[3] = save.a; w.image = save.img; w.x = save.x; w.y = save.y; w.w = save.w; w.iw = save.iw;
      w.h = save.h; w.ih = save.ih; w.rgba[0] = save.rgb[0]; w.rgba[1] = save.rgb[1]; w.rgba[2] = save.rgb[2];
    }
    this.linear = false;                           // FUN_003d3830(0)
  }
  // FUN_003d1368 (type 3 draw)
  drawButton(w) {
    let rgb;
    if (this.lit(w)) { w.textCol = w.col74; rgb = w.rgb78; } else { w.textCol = w.col7c; rgb = w.rgb80; }
    w.rgba[0] = rgb[0]; w.rgba[1] = rgb[1]; w.rgba[2] = rgb[2];
    if (w.flags & 8) this.linear = true;
    this.drawImage(w, 0xffff);
    if (w.flags & 8) this.linear = false;
    // FUN_003cc0a8: FUN_003d3830(1) around the text with flag 0x1e, FUN_003d3830(0) after it, so the
    // type-12 orb and highlight that follow are nearest (the dump's TEX1)
    if (w.str && (w.flags5e & 0x80)) {
      this.linear = true;
      this.drawGlyphs(w, (w.flags5e & 0x400) ? w.str.subarray(2) : w.str);
      this.linear = false;
    }
  }
  // FUN_003c97a0
  drawImage(w, p2) {
    const an = this.anim(w);
    const c = w.rgba.slice();
    if (an) c[3] = Math.trunc((w.rgba[3] * this.cur) / this.total);
    let h = w.h, ih = w.ih;
    if (an && !(w.flags & 0x80)) {
      h = s16(Math.trunc((h * this.cur) / this.total));
      ih = s16(Math.trunc((ih * this.cur) / this.total));
    }
    const id = w.image !== 0xffff ? w.image : p2;
    if (id === 0xffff) return;
    const I = imageOf(this.D, id);
    if (!I) return;
    if (I.kind === 1 || I.kind === 3) { h = w.h; ih = w.ih; }
    if (I.colors) this.drawGradient(w, I, h);
    let off = 0;
    if (this.lit(w) && (I.lit === 0 || I.lit === 2)) off = this.D.kinds[I.kind][0];
    if (w.rgba[3] !== 0 && I.slices.length) {
      const K = this.D.kinds[I.kind];
      let y = w.y;
      for (let r = 0; r < K[5]; r++) {
        const dy = I.kind === 4 ? this.row9110(w, I, w.x, y, c, off, r, ih) : this.row94e0(w, I, w.x, y, c, off, r, ih);
        y = s16(y + dy);
        off += K[1];
      }
    }
  }
  // FUN_003c8dc0: the image's 4 gradient colours over the widget rect (untextured)
  drawGradient(w, I, h) {
    const an = this.anim(w);
    const cols = I.colors.map(u => { const c = rgbaOf(u); if (an) c[3] = Math.trunc((c[3] * this.cur) / this.total); return c; });
    const x0 = w.x * 16, y0 = w.y * 16, x1 = x0 + w.w * 16, y1 = y0 + h * 16;
    this.emitStrip([[x0, y0], [x1, y0], [x0, y1], [x1, y1]], cols, null);
  }
  // FUN_003c94e0: one row of sprite pieces, the stretch column / row at the inner size
  row94e0(w, I, x, y, col, off, row, ih) {
    const K = this.D.kinds[I.kind];
    let dh = 0;
    for (let k = 0; k < K[1]; k++) {
      const s = I.slices[off + k];
      let dw, tw, th, wms = 0, wmt = 0;
      if (k === K[2]) {
        dw = Math.max(w.iw, 0); tw = s[2];
        if (I.rep & 1) { wms = 3; tw = dw; }
      } else { dw = Math.abs(s[2]); tw = s[2]; }
      if (row === K[6]) {
        dh = Math.max(ih, 0); th = s[3];
        if (I.rep & 2) { wmt = 3; th = dh; }
      } else { dh = Math.abs(s[3]); th = s[3]; }
      if (s[0] >= 0) {
        const clamp = (wms || wmt) ? { wms, wmt, umsk: (s[2] - 1) & 0x3ff, ufix: s[0], vmsk: (s[3] - 1) & 0x3ff, vfix: s[1] } : null;
        this.sprite3cac70(x, y, dw, dh, s[0], s[1], tw, th, col, I.page, clamp);
      }
      x = s16(x + dw);
    }
    return dh;
  }
  // FUN_003cac70
  sprite3cac70(x, y, dw, dh, u, v, tw, th, col, page, clamp) {
    if (tw === -1) tw = 1;
    if (th === -1) th = 1;
    let u0, u1, v0, v1;
    if (tw < 0) { u0 = u * 16; u1 = (u + tw) * 16 + 1; } else { u0 = u * 16 + 1; u1 = (u + tw) * 16; }
    if (u1 < 0) u1 = 0;
    if (th < 0) { v0 = v * 16; v1 = (v + th) * 16 + 1; } else { v0 = v * 16 + 1; v1 = (v + th) * 16; }
    if (v1 < 0) v1 = 0;
    this.emitSprite([x * 16, y * 16, u0, v0], [(x + dw) * 16, (y + dh) * 16, u1, v1], col, page, clamp ? { clamp } : {});
  }
  // FUN_003c9110: kind-4 row of 5 gouraud quads; the outer pieces fade to colour / 4
  row9110(w, I, x, y, col, off, row, ih) {
    const K = this.D.kinds[I.kind], P = this.D.pieces;
    const s1w = I.slices[off + 1][2];
    const a0 = s1w < w.w ? Math.trunc((w.w - s1w) / 4) : 0;
    const a1 = Math.trunc(s1w / 4);
    let a2 = s16(w.w - a1 * 2 - a0 * 2);
    if (a2 < 0) a2 = 0;
    const widths = [a0, a1, a2];
    const h = row === K[6] ? Math.max(ih, 0) : I.slices[off][3];
    const q = quarter(col);
    const cols8 = [col, q, col, q, col, col, col, col];
    let xx = x;
    for (let e = 0; e < 5; e++) {
      const wi = P[4 * e], so = P[4 * e + 1], dir = (P[4 * e + 2] << 24) >> 24, co = P[4 * e + 3];
      const sl = I.slices[off + so];
      let uoff, uw;
      if (dir === 0) { uoff = 0; uw = sl[2]; }
      else if (Math.abs(dir) === 1) { uw = Math.trunc(sl[2] / 4); uoff = dir < 1 ? s16(sl[2] - uw) : 0; }
      else { uoff = Math.trunc(sl[2] / 4); uw = s16(sl[2] - uoff * 2); }
      const x0 = xx * 16, x1 = x0 + widths[wi] * 16 + 0xf;
      const y0 = y * 16, y1 = y0 + h * 16 + 0xf;
      const u0 = (sl[0] + uoff) * 16, u1 = u0 + uw * 16;
      const v0 = sl[1] * 16, v1 = v0 + sl[3] * 16;
      this.emitStrip([[x0, y0, u0, v0], [x1, y0, u1, v0], [x0, y1, u0, v1], [x1, y1, u1, v1]],
                     cols8.slice(co, co + 4), I.page);
      xx = s16(xx + widths[wi]);
    }
    return h;
  }
  // FUN_003cedf0: '$&' text in the glyph font (page 1), one shadow sprite + one gradient quad per glyph
  drawGlyphs(w, str) {
    const D = this.D;
    let x = w.textOff[0] !== 0x7f ? w.x + w.textOff[0] : w.ix;
    let y = w.textOff[1] !== 0x7f ? w.y + w.textOff[1] : w.iy;
    x *= 16; y *= 16;
    const an = this.anim(w);
    const tc = w.textCol;
    let top = tc.slice(), bottom, shadow;
    if (an) top[3] = Math.trunc((tc[3] * this.cur) / this.total);
    if (tc[3] === 0) {                             // a text colour with alpha 0 (not used by the pause)
      bottom = (w.flags5e & 0x2000) ? top.slice() : [0xff, 0xff, 0xff, 0];
      shadow = [0x10, 0x10, 0x10, 0];
    } else {
      bottom = (w.flags5e & 0x2000) ? top.slice() : [0xff, 0xff, 0xff, an ? Math.trunc((this.cur << 7) / this.total) : 0x80];
      shadow = [0x10, 0x10, 0x10, an ? Math.trunc((this.cur * 0x60) / this.total) : 0x60];
    }
    for (const ch of str) {
      if (ch === 0) break;
      if (ch <= 2) continue;
      let gw, adv;
      if (ch === 3) {                              // space
        gw = (w.flags5e & 0x40) ? 6 : (D.widthBytes[0] & 0xf) + 1;
        adv = (w.spacing + gw) * 16;
      } else {
        if (w.flags5e & 0x40) gw = 6;
        else if (ch < 0x62) { const b = D.widthBytes[(ch - 3) >> 1]; gw = (((ch - 3) & 1) ? b >> 4 : b & 0xf) + 1; }
        else gw = 12;
        const rowv = Math.trunc((ch - 4) / 0x2a) * 16 + 0x1d0;
        const vt = ((rowv << 3) & 0xffff00);       // texel v x 16
        const clut = ((rowv >> 4) & 1) + 3;        // FUN_003dd5b0(bit + 3)
        const u0 = ((ch - 4) % 0x2a) * 0xc0 + 1, u1 = u0 + gw * 16;
        const v0 = vt + 1, v1 = vt + 0xe1;
        this.emitSprite([x, y, u0, v0], [x + gw * 16 + 0x10, y + 0xf0, u1, v1], shadow, 'font', { clut });
        const xr = x + gw * 16;
        this.emitStrip([[x, y, u0, v0], [xr, y, u1, v0], [x, y + 0xe0, u0, v1], [xr, y + 0xe0, u1, v1]],
                       [top, top, bottom, bottom], 'font', { clut });
        adv = gw * 16 + w.spacing * 16;
      }
      x += adv;
    }
  }
}

// FUN_003d3880 (flag 0x1e): scissor in drawable px, inclusive
export function scissor(x, y, w, h) {
  const tx = v => { const t = v * 0x1b0; return (t < 0 ? t + 0x1ff : t) >> 9; };
  const y0 = Math.trunc((y << 9) / 0x1c0);
  const x0 = tx(x);
  return [x0, y0, x0 + tx(w) - 1, y0 + Math.trunc((h << 9) / 0x1c0) - 1];
}

// ---------------------------------------------------------------- the pause flow (FUN_003de130 + FUN_003c0220)
// Pause controller for the page. Start (action 0x24) opens the screen (FUN_003bfd30 via the
// screen table 0x47ab10 entry 0x10); while it is open, Start / ○ close it (FUN_003bfd70 ->
// FUN_003c04c8). ✕ sends the focused button's id to FUN_003c0220:
//   3 Restart  -> message box 0x477a10 (0x25: question message 0x5c06), then the
//                 reload (FUN_003c0a20, FUN_003dee40(0xf)); 4 Tempsave -> box 0x477a50 (0x27,
//                 memory card); 5 Quit -> box 0x477a30 (0x26, to the title).
// The page has no message box (type 8, FUN_003b65c0 / DAT_00472a80 + the text renderer
// FUN_003cd7e8 are not decoded), so ✕ reports the request and the caller decides what the
// page can do (see pause_layer.js).
export class PauseFlow {
  constructor(D, { pulseBase = 0 } = {}) {
    this.D = D; this.screen = null; this.pulseBase = pulseBase; this.lastSE = null;
  }
  // the world is frozen while the screen exists: FUN_00241f40 enters game state 0x17 (script flag
  // 0x12, FUN_00325490) when it opens; its destructor FUN_003c0110 -> FUN_003e0de8 -> FUN_00241f40
  // leaves it, after the close animation
  get active() { return !!this.screen; }
  start(now) {                                     // action 0x24
    if (!this.screen) { this.screen = new PauseScreen(this.D, { now, pulseBase: this.pulseBase }); this.lastSE = SE.pause; return 'open'; }
    if (this.screen.flags & 2) return null;        // FUN_003d47b8: already closing
    this.screen.close(now); this.lastSE = SE.unpause;   // FUN_003bfd70 -> FUN_003c04c8
    return 'close';
  }
  input(a, now, kind = 0) {
    const s = this.screen;
    if (!s) return null;
    s.se = null;
    const r = s.action(a, kind);
    this.lastSE = s.se;
    if (r && r.cancel) { s.close(now); this.lastSE = SE.unpause; return { close: true }; }
    if (r && r.event !== undefined) return { request: ({ 3: 'restart', 4: 'tempsave', 5: 'quit' })[r.event] || null, id: r.event };
    return r;
  }
  // per frame: returns the primitives, or null once the close has finished
  frame(now) {
    const s = this.screen;
    if (!s) return null;
    s.update(now);
    if (s.closing && s.cur === 0) { this.screen = null; return null; }
    return s.draw(now);
  }
}
