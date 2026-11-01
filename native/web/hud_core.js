// hud_core.js -- the in-game HUD's draw list (HP gauge, weapon panel), translated from the game's
// menu-widget code. Pure: no three.js; hud.js draws the primitives, test_hud.mjs checks them against
// the GS dump. Data: data/hud/hud.json (export_web_hud.py). Notes: notes/hud-research.md.
//
// Primitives (what the game hands the GS; all coordinates already mapped to the 432 x 512 frame):
//   { kind: 'sprite', tex, clut?, bilinear, v: [[x0, y0, u0, v0], [x1, y1, u1, v1]], c: [r, g, b, a] }
//   { kind: 'strip',  tex|null, clut?, bilinear, v: [[x, y, u, v] x 4], c: [[r, g, b, a] x 4] }  (TL, TR, BL, BR)
//   { kind: 'line',   v: [[x, y] x n], c: [[r, g, b, a] x n] }                                     (line strip)
// x, y, u, v in pixels / texels (the GS's 12.4 values / 16). Blend for all: ALPHA (Cs - Cd) As + Cd
// (hero dump: (0, 1, 0, 1, 0) on every HUD draw), TFX modulate (Cv = Cf Ct >> 7).

// ------------------------------------------------------------------ frame mapping (DAT_004f2258 set)
const div0 = (a, b) => Math.trunc(a / b);                   // C integer division (toward zero)
const sra = (a, n) => a >> n;
// FUN_003d2e80 / FUN_003d3098: x' = (x * 0x1b0) >> 9 rounded toward zero, y' = (y << 9) / 0x1c0
export const mapA = (x, y) => [div0(x * 0x1b0, 512), div0(y * 512, 0x1c0)];
// FUN_003d3330: the same on the pixel part only, keeping the 1/16 fraction
export const mapB = (x, y) => [(div0(sra(x, 4) * 0x1b0, 512) << 4) | (x & 0xf),
                               (div0(sra(y, 4) * 512, 0x1c0) << 4) | (y & 0xf)];
const px = v => v / 16;

// FUN_003d3880: SCISSOR_1 from a HUD rect (x, y, w, h): fb x0 = (x 0x1b0) >> 9, x1 = x0 + (w 0x1b0 >> 9) - 1,
// y0 = (y << 9) / 0x1c0, y1 = y0 + (h << 9) / 0x1c0 - 1 (inclusive; x1 < x0 = nothing drawn)
export function scissorFb(x, y, w, h) {
  const x0 = div0(x * 0x1b0, 512), y0 = div0(y * 512, 0x1c0);
  return [x0, x0 + div0(w * 0x1b0, 512) - 1, y0, y0 + div0(h * 512, 0x1c0) - 1];
}
// FUN_003cada0: clamp to the 512 x 448 HUD, then FUN_003d3880
function clipHud(x, y, w, h) {
  if (x < 0) { w = (w + x) << 16 >> 16; x = 0; }
  if (0x1ff < x + w) w = (0x200 - x) << 16 >> 16;
  let e = y + h;
  if (y < 0) { h = (h + y) << 16 >> 16; y = 0; e = h; }
  if (0x1bf < e) h = (0x1c0 - y) << 16 >> 16;
  return scissorFb(x, y, w, h);
}
// FUN_003cae68: the same plus the owner's clip height (elem +0x34 = the HUD, +0x26)
function clipElem(st, x, y, w, h) {
  if (x < 0) { w = (w + x) << 16 >> 16; x = 0; }
  if (0x1ff < x + w) w = (0x200 - x) << 16 >> 16;
  let e = y + h;
  if (y < 0) { h = (h + y) << 16 >> 16; y = 0; e = h; }
  if (0x1bf < e) h = (0x1c0 - y) << 16 >> 16;
  if (st.h26 <= y + h) h = (st.h26 - y) << 16 >> 16;
  return scissorFb(x, y, w, h);
}
const FULL = scissorFb(0, 0, 0x200, 0x1c0);
const rgba = c => [c[0], c[1], c[2], c[3]];

// The element alpha as the draws scale it: a * fade num / den (HUD +0x2c / +0x30 via elem +0x34),
// unless elem flag 0x40 (FUN_003c97a0, FUN_003c8dc0, FUN_003d5f68, FUN_003cedf0)
function fadeA(st, e, a) {
  const [n, d] = st.fade;
  if (n === d || (e.flags & 0x40)) return a;
  return div0(a * n, d);
}

// ------------------------------------------------------------------ sprites (FUN_003c97a0)
// FUN_003cac70: one frame quad: (x, y) w x h HUD px, texels (u, v) extent (uw, vh) signed (negative =
// mirrored: the +1 moves to the other end); -1 means 1. Then FUN_003d2e80 (mapA, a sprite).
function frameQuad(out, x, y, w, h, u, v, uw, vh, tex, c, bilinear, wrap) {
  if (vh === -1) vh = 1;
  if (uw === -1) uw = 1;
  let u0, u1, v0, v1;
  if (uw < 0) { u0 = u << 4; u1 = (u + uw) * 16 + 1; } else { u0 = u * 16 + 1; u1 = (u + uw) * 16; }
  if (u1 < 0) u1 = 0;
  if (vh < 0) { v0 = v << 4; v1 = (v + vh) * 16 + 1; } else { v0 = v * 16 + 1; v1 = (v + vh) * 16; }
  if (v1 < 0) v1 = 0;
  const [X0, Y0] = mapA(x << 4, y << 4), [X1, Y1] = mapA((x + w) * 16, (y + h) * 16);
  const p = { kind: 'sprite', tex, bilinear, v: [[px(X0), px(Y0), px(u0), px(v0)], [px(X1), px(Y1), px(u1), px(v1)]], c };
  if (wrap) p.wrap = wrap;
  out.push(p);
}

// FUN_003c8dc0: an untextured sprite (record +8 = 4 corner colours) as a gouraud strip (FUN_003d3098 kind 1)
function solidQuad(out, st, e, S, x, y, w, h) {
  const x0 = (x << 16) >> 12, y0 = (y << 16) >> 12, x1 = x0 + ((w << 16) >> 12), y1 = y0 + ((h << 16) >> 12);
  const c = S.corners.map(k => [k[0], k[1], k[2], fadeA(st, e, k[3])]);
  const p = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]].map(([a, b]) => mapA(a, b));
  out.push({ kind: 'strip', tex: null, v: p.map(([a, b]) => [px(a), px(b), 0, 0]), c });
}

// FUN_003c94e0: one row of a sprite's frames (columns d184; the stretch column d188 takes the box
// width +0x12, the stretch row d198 the box height +0x14). Returns the row height.
function spriteRow(out, data, e, sid, x, y, c, f0, row, boxH, bilinear) {
  const S = data.sprites[sid], K = data.kinds[S.kind];
  const cols = K[2], scol = K[3], srow = K[7];
  let h = 0;
  for (let i = 0; i < cols; i++) {
    const fr = S.frames[f0 + i];
    if (!fr) break;
    // sprite +7 bit 0 / bit 1: the stretch column / row repeats its frame (FUN_003d3fb8 -> CLAMP_1
    // REGION_REPEAT: texel (t & (size - 1)) | start) and its UV extent becomes the drawn size
    let w, uw = fr[2], vh = fr[3], wu = 0, wv = 0;
    if (i === scol) {
      w = Math.max(e.box[2], 0);
      if (S.f7 & 1) { wu = 3; uw = w; }
    } else w = Math.abs(fr[2]);
    if (row === srow) {
      h = Math.max(boxH, 0);
      if (S.f7 & 2) { wv = 3; vh = h; }
    } else h = Math.abs(fr[3]);
    if (fr[0] >= 0) {
      let wrap = null;
      if (wu || wv) {
        wrap = {};
        if (wu === 3) wrap.u = [(fr[2] - 1) & 0x3ff, fr[0] & 0x3ff];     // MINU (mask), MAXU (OR-ed start)
        if (wv === 3) wrap.v = [(fr[3] - 1) & 0x3ff, fr[1] & 0x3ff];
      }
      frameQuad(out, x, y, w, h, fr[0], fr[1], uw, vh, 'menu' + (S.tex + 1), c, bilinear, wrap);
    }
    x += w;
  }
  return h;
}

const warned = new Set();
function warn(m) { if (!warned.has(m)) { warned.add(m); if (typeof console !== 'undefined') console.warn(m); } }

// FUN_003c97a0 (vtable slot 13), called by FUN_003d6ec0 (type 4), FUN_003d6d70 (type 7), FUN_003d7040 (type 2)
function spriteElement(out, data, st, e) {
  const sid = e.sprite;
  if (sid < 0) return;
  const S = data.sprites[sid];
  if (!S) { warn('hud: sprite ' + sid + ' not exported'); return; }
  const c = [e.rgba[0], e.rgba[1], e.rgba[2], fadeA(st, e, e.rgba[3])];
  let h = e.rect[3], boxH = e.box[3];
  const [n, d] = st.fade;
  if (n !== d && !(e.flags & 0x80)) { h = div0(h * n, d); boxH = div0(e.box[3] * n, d); }
  if (S.kind === 1 || S.kind === 3) { h = e.rect[3]; boxH = e.box[3]; }
  if (S.corners) solidQuad(out, st, e, S, e.rect[0], e.rect[1], e.rect[2], h);
  if (e.flags & 2) warn('hud: selectable element (FUN_003caba8) not translated');
  if (e.rgba[3] === 0 || !S.frames.length) return;
  const K = data.kinds[S.kind], rows = K[6], cols = K[2];
  let y = e.rect[1];
  for (let r = 0, f0 = 0; r < rows; r++, f0 += cols) {
    y += spriteRow(out, data, e, sid, e.rect[0], y, c, f0, r, boxH, !!(e.flags & 8));
  }
}

// FUN_003d5f68 (type 13): the frames with the element's corner colours (+0x3c, (cols + 1) x (rows + 1);
// a 1-frame sprite: TL, TR, BL, BR), each as a textured gouraud strip through FUN_003d3330 (mapB)
function cornerElement(out, data, st, e) {
  const S = data.sprites[e.sprite];
  if (!S || e.rgba[3] === 0) return;
  if (S.kind !== 3) { warn('hud: type-13 element with a multi-frame sprite not translated: ' + e.sprite); return; }
  const fr = S.frames[0];
  if (!fr || fr[0] < 0) return;
  const x0 = e.rect[0] << 4, y0 = e.rect[1] << 4;
  const w = e.rect[2] << 4, h = e.rect[3] << 4;
  let xa, xb, ua, ub, ya, yb, va, vb;
  if (fr[2] < 0) { xb = x0 - 1; xa = xb + w; ua = (fr[0] + 1 + fr[2]) * 16; ub = ua + (fr[2] + 1) * -16; }
  else { xa = x0; xb = x0 + w - 1; ua = fr[0] << 4; ub = (fr[0] + fr[2]) * 16; }
  if (fr[3] < 0) { yb = y0; ya = y0 + h; va = (fr[1] + 1 + fr[3]) * 16; vb = va + (fr[3] + 1) * -16; }
  else { ya = y0; yb = y0 + h - 1; va = fr[1] << 4; vb = (fr[1] + fr[3]) * 16; }
  const cc = e.corners.map(k => [k[0], k[1], k[2], fadeA(st, e, k[3])]);
  const p = [[xa, ya, ua, va], [xb, ya, ub, va], [xa, yb, ua, vb], [xb, yb, ub, vb]].map(([x, y, u, v]) => {
    const [X, Y] = mapB(x, y);
    return [px(X), px(Y), px(u), px(v)];
  });
  out.push({ kind: 'strip', tex: 'menu' + (S.tex + 1), bilinear: !!(e.flags & 8), v: p, c: cc });
}

// ------------------------------------------------------------------ gauges (type-7 callbacks)
// FUN_003aec78: the shown value drains from `from` to `cur` over 1000 ms after a hit (s: [cur, max, from, shown, timer])
export function gaugeTick(s, now) {
  if (s[4] !== 0) {
    if ((s[4] >>> 0) < (now >>> 0)) { s[4] = 0; s[3] = s[0]; s[2] = s[0]; }
    else s[3] = (s[2] - div0((s[2] - s[0]) * ((now + 1000) - s[4]), 1000)) << 16 >> 16;
  }
}
// FUN_003aec10: set a gauge value; lag != 0 starts the 1000 ms drain when the gauge has a max
export function gaugeSet(s, v, lag, now) {
  if (lag !== 0 && s[1] !== 0) { s[2] = s[3]; s[4] = now + 1000; s[0] = v; return; }
  s[2] = v; s[3] = v; s[4] = 0; s[0] = v;
}

// FUN_003aed60(HUD, s, row, rect): the bar = a slanted gouraud strip (bottom edge h - 1 px to the left)
// from 0 to (w - 1) min(cur, shown) / max, colour c0 on the left vertices and c1 on the right, the two edge lines, and the lag segment
// between cur and shown (alpha - 0x20).
function bar(out, data, s, row, R) {
  if (s[1] === 0) return;
  const B = data.bars[row];
  let lo = s[3], hi = s[0];
  if (hi < lo) { const t = lo; lo = hi; hi = t; }   // lo = min(cur, shown), hi = max
  const [rx, ry, rw, rh] = R;
  let a0, a1;
  if (B.dir === 1) { a0 = (rx + rw - 1) * 16; a1 = a0 + div0((rw - 1) * lo, s[1]) * -16; }
  else { a0 = rx << 4; a1 = (rx + div0((rw - 1) * lo, s[1])) * 16; }
  const sl = (rh - 1) * -16, top = ry << 4, bot = (ry + rh - 1) * 16;
  const strip = (xa, xb, ca, cb) => {
    const p = [[xa, top], [xb, top], [xa + sl, bot], [xb + sl, bot]].map(([x, y]) => mapA(x, y));
    out.push({ kind: 'strip', tex: null, v: p.map(([x, y]) => [px(x), px(y), 0, 0]), c: [ca, cb, ca, cb] });   // TL, TR, BL, BR = c0, c1, c0, c1
  };
  strip(a0, a1, rgba(B.c0), rgba(B.c1));
  if (s[0] > 0) {                                     // edge lines: 3-point line strips (FUN_003d3098 kind 3)
    const line = (pts, cols) => out.push({ kind: 'line', v: pts.map(([x, y]) => mapA(x, y)).map(([x, y]) => [px(x), px(y)]), c: cols.map(rgba) });
    line([[a0 + sl, bot], [a1 + sl, bot], [a1, top]], B.edgeA);
    line([[a0 + sl, bot], [a0, top], [a1, top]], B.edgeB);
    line([[a0 + sl, bot + 16], [a0, top + 16], [a1, top + 16]], B.edgeB);
  }
  if (lo < s[1]) {
    let b0, b1;
    if (B.dir === 1) { const e = rx + rw; b1 = e - (div0((rw - 1) * hi, s[1]) + 1); b0 = e - (div0((rw - 1) * lo, s[1]) + 1); }
    else { b1 = rx + div0((rw - 1) * hi, s[1]); b0 = rx + div0((rw - 1) * lo, s[1]); }
    const ca = [B.c0[0], B.c0[1], B.c0[2], (B.c0[3] - 0x20) & 0xff], cb = [B.c1[0], B.c1[1], B.c1[2], (B.c1[3] - 0x20) & 0xff];
    strip(b0 * 16, b1 * 16, ca, cb);
  }
}

// FUN_003ae938 (element 0x0a, via 0x3ae910): Vincent's HP bar (HUD +100), row 0. The low-HP pulse
// FUN_003af1e0 (HP below a quarter) is not translated.
function hpBar(out, data, st, e) {
  const s = st.hp;
  if (s[1] === 0) return;
  gaugeTick(s, st.now);
  bar(out, data, s, 0, e.rect);
  if (s[0] < (s[1] >> 2) && s[0] !== 0) warn('hud: low-HP pulse FUN_003af1e0 not translated');
}
// FUN_003aea10 (element 9, via 0x3ae9e8): the MP gauge (HUD +0x70, max +0x72, cap +0x2ce): rows 1-3
function mpBar(out, data, st, e) {
  const s = st.mp;
  if (s[1] === 0) return;
  const [x, y, w, h] = e.rect;
  gaugeTick(s, st.now);
  const cap = st.mpCap;
  const a = [Math.min(s[0], cap), cap, 0, 0, 0];
  a[3] = Math.min(s[3], cap);
  const wc = div0(w * cap, s[1]);
  bar(out, data, [a[0], cap, 0, a[3], 0], 1, [x, y, wc, h]);
  const r0 = s[0] - Math.min(s[0], cap), r3 = s[3] - Math.min(s[3], cap);
  if (r0 > 0 || r3 > 0) bar(out, data, [r0, s[1] - cap, 0, r3, 0], 2, [x + wc, y, w - wc, h]);
  // FUN_002419d8(0) == 0 (normal play): the marker at the cap: rect x + wc - 1, w 2 (the element's x
  // still carries the first segment's width when the game sets it)
  bar(out, data, [2, 2, 0, 2, 0], 3, [x + wc - 1, y, 2, h]);
  if (st.mp[0] !== 0) warn('hud: MP pulse FUN_003af1e0 not translated');
}

// ------------------------------------------------------------------ text
// FUN_003cedf0 (text flag 0x80): the number font. Glyph code c >= 4 (FUN_003cba90: digits 0x13-0x1c,
// '-' 0x10, '/' 0x12): cell (c - 4) % 42 at 12 px, row (c - 4) / 42; width = nibble (c - 3) of the
// font table +0x70, plus 1 (flag 0x40: 6; c >= 0x62: 12); a shadow sprite one px larger, then a
// textured gouraud strip with the element colour on top and white below. Code 3 = a space.
function numberText(out, data, st, e, metrics) {
  const flags = e.tflags;
  let x, y;
  if (e.t60 !== 0x7f) x = (e.rect[0] + e.t60) << 4;
  else if (flags & 0x10) x = (e.box[0] + div0(e.box[2] - textWidth(e, metrics), 2)) * 16;
  else if (flags & 0x20) x = (e.box[0] + (e.box[2] - textWidth(e, metrics))) * 16;
  else x = e.box[0] << 4;
  y = (e.t62 === 0x7f ? e.box[1] : e.rect[1] + e.t62) << 4;
  const col = e.col4c, fa = fadeA(st, e, col[3]);
  let top, bot, shadow;
  if (col[3] === 0) {
    warn('hud: number text with colour alpha 0 not translated');
    return;
  }
  top = [col[0], col[1], col[2], fa];
  bot = (flags & 0x2000) ? top : [0xff, 0xff, 0xff, (st.fade[0] !== st.fade[1] && !(e.flags & 0x40)) ? div0(st.fade[0] << 7, st.fade[1]) : 0x80];
  shadow = [0x10, 0x10, 0x10, (st.fade[0] !== st.fade[1] && !(e.flags & 0x40)) ? div0(st.fade[0] * 0x60, st.fade[1]) : 0x60];
  for (const c of e.text) {
    if (c <= 2) continue;
    if (c === 3) { x += (e.t65 + glyphW3(flags, metrics, 3)) * 16; continue; }
    const w = glyphW3(flags, metrics, c);
    const adv = (w << 20) >> 16;
    const row = div0(c - 4, 0x2a), colI = (c - 4) % 0x2a;
    const iv = ((row * 0x10 + 0x1d0) * 0x10000) | 0;
    const vt = (iv >> 0xd) & 0xffff00;
    const clut = ((iv >> 0x14) & 1) + 3;                 // FUN_003dd5b0(bit + 3)
    const u0 = colI * 0xc0 + 1, u1 = u0 + w * 16, v0 = vt + 1, v1 = vt + 0xe1;
    const [sx0, sy0] = mapA(x, y), [sx1, sy1] = mapA(x + adv + 0x10, y + 0xf0);
    out.push({ kind: 'sprite', tex: 'font', clut, bilinear: false, v: [[px(sx0), px(sy0), px(u0), px(v0)], [px(sx1), px(sy1), px(u1), px(v1)]], c: shadow });
    const q = [[x, y, u0, v0], [x + adv, y, u1, v0], [x, y + 0xe0, u0, v1], [x + adv, y + 0xe0, u1, v1]]
      .map(([a, b, u, v]) => { const [X, Y] = mapA(a, b); return [px(X), px(Y), px(u), px(v)]; });
    out.push({ kind: 'strip', tex: 'font', clut, bilinear: false, v: q, c: [top, top, bot, bot] });
    x += adv + e.t65 * 16;
  }
}
function nib(metrics, i) { const b = metrics[i >> 1]; return (i & 1) ? b >> 4 : b & 15; }
function glyphW3(flags, metrics, c) {
  if (flags & 0x40) return 6;
  if (c === 3) return (metrics[0x70] & 0xf) + 1;
  if (c >= 0x62) return 12;
  return nib(metrics.subarray(0x70), c - 3) + 1;
}
// elem +0x44: the text's width in px. GUESS: the sum of the renderer's advances (the measuring function
// that writes +0x44 is not read; matches the hero dump's right-aligned numbers to the px).
function textWidth(e, metrics) {
  let w = 0;
  if (e.tflags & 0x80) { for (const c of e.text) if (c > 2) w += glyphW3(e.tflags, metrics, c) + e.t65; }
  else for (const c of e.text) w += plainW(e.tflags, metrics, c) + e.t65;
  return w;
}
function plainW(flags, metrics, c) {
  if (c === 0x20) return (metrics[0] & 0xf) + 1;          // FUN_003cc208: *DAT_004f2250 & 0xf + 1
  return nib(metrics, c - 0x20) + 1;
}

// FUN_003cc208 (text +0x5c != 0), the plain single-byte path only (no control codes, no SJIS pairs):
// cell = ((c + 0x877e >> 8) - 0x81) x 0xbc - 0x41 + (c + 0x877e & 0xff); kelfnt (cell / 0x700) + 1
// (only kelfnt0 is exported); CLUT 1 + (cell & 0x3f > 0x1f); texel (cell & 0x1f, cell >> 6) x 16;
// width w = nibble (c - 0x20) + 1, height 16. Each glyph: flag 1 a shadow 2 px down-right, flag 2 the
// outline (4 copies at x -1 / +1, y -1 / +2), flag 0x800 a copy at (-1, -1), then the glyph; every
// sprite spans x .. x + w - 1/16. Dark copies: 0x101010 with alpha a - 0x20 (0 below 0x20). Advance
// w + elem +0x65.
function plainText(out, data, st, e, metrics) {
  const flags = e.tflags;
  let x;
  if (e.t60 !== 0x7f) x = (e.rect[0] + e.t60) * 16;
  else if (flags & 0x10) x = (e.box[0] + div0(e.box[2] - textWidth(e, metrics), 2)) * 16;
  else if (flags & 0x20) x = (e.box[0] + e.box[2] - textWidth(e, metrics)) * 16;
  else x = e.box[0] * 16;
  const y = (e.t62 === 0x7f ? e.box[1] : e.rect[1] + e.t62) * 16;
  const col = e.col4c, a = fadeA(st, e, col[3]);
  const main = [col[0], col[1], col[2], a];
  const dark = [0x10, 0x10, 0x10, col[3] < 0x20 ? 0 : fadeA(st, e, col[3] - 0x20)];
  const side = [col[0], col[1], col[2], (st.fade[0] !== st.fade[1] && !(e.flags & 0x40)) ? div0(st.fade[0] * 0x40, st.fade[1]) : 0x40];
  if (flags & 0x100c) warn('hud: text flags ' + flags.toString(16) + ' (boxes / clip) not translated');
  for (const c of e.text) {
    if (c < 0x20 || c >= 0x80 || c === 0x24) { warn('hud: text control / SJIS byte not translated: ' + c); continue; }
    const w = plainW(flags, metrics, c), W = w << 4;
    if (c !== 0x20) {
      const k = c + 0x877e;
      const cell = ((k >> 8) - 0x81) * 0xbc - 0x41 + (k & 0xff);
      const page = div0(cell, 0x700), cl = cell - page * 0x700;
      if (page !== 0) { warn('hud: kelfnt' + page + ' not exported'); x += W + e.t65 * 16; continue; }
      const clut = ((cl & 0x3f) > 0x1f ? 1 : 0) + 1;
      const u0 = (cl & 0x1f) * 0x100, v0 = (cl >> 6) * 0x100, u1 = u0 + W, v1 = v0 + 0x100;
      const spr = (gx, gy, cc) => {
        const [a0, b0] = mapA(gx, gy), [a1, b1] = mapA(gx + W - 1, gy + 0x100);
        out.push({ kind: 'sprite', tex: 'font', clut, bilinear: false, v: [[px(a0), px(b0), px(u0), px(v0)], [px(a1), px(b1), px(u1), px(v1)]], c: cc });
      };
      if (flags & 1) spr(x + 0x20, y + 0x20, dark);
      if (flags & 2) for (const ox of [-1, 1]) for (const oy of [-1, 2]) spr(x + ox * 16, y + oy * 16, dark);
      if (flags & 0x800) spr(x - 0x10, y - 0x10, side);
      spr(x, y, main);
    }
    x += W + e.t65 * 16;
  }
}

function textElement(out, data, st, e, metrics) {
  spriteElement(out, data, st, e);
  if (!e.text || !e.text.length) return;
  if (e.tflags & 0x80) numberText(out, data, st, e, metrics);
  else if (e.t5c !== 0) plainText(out, data, st, e, metrics);
  else warn('hud: text renderer FUN_003cd7e8 (+0x5c == 0) not translated');
}

// ------------------------------------------------------------------ state + the frame's draw list
// FUN_003cbb58: "cur" 0x12 "max" in number-font codes (FUN_003cba90: digit + 0x13, '-' = 0x10)
export function numberCodes(v) {
  const out = [];
  if (v < 0) out.push(0x10);
  const d = String(Math.abs(v | 0)).split('').map(ch => ch.charCodeAt(0) - 48 + 0x13);
  return out.concat(d);
}
export function hpText(cur, max) { return numberCodes(cur).concat([0x12], numberCodes(max)); }

export class HudState {
  constructor(data) {
    const v = data.values;
    this.hp = v.hp.slice(); this.mp = v.mp.slice(); this.mpCap = v.mp_cap; this.fade = v.fade.slice();
    this.chainG = v.chain.slice(); this.chainBB4 = v.chain_bb4; this.h26 = v.h26;
    // the HUD clock (DAT_004f58ec / FUN_0023c1f0, ms) as the save has it; hud.js advances it
    this.now = v.clock >>> 0;
    // the draws read sprite records the HUD code rewrites (FUN_003d10a8): a copy per state
    this.data = { ...data, sprites: JSON.parse(JSON.stringify(data.sprites)) };
    this.sc = FULL;
    this.metrics = hexBytes(data.font.metrics);
    this.chain = data.chain.map(e => ({ ...e }));
    let slot = null;
    for (const e of this.chain) { if (e.depth === 0) slot = e.slot ?? null; e.inSlot = slot; }
    this.hpElem = this.find(5, 5);
  }
  find(slot, id) { return this.chain.find(e => e.inSlot === slot && e.id === id && e.depth > 0) || null; }
  // FUN_00339988 -> FUN_003adda8(HUD, P+0x20, P+4, 1) when the status HP changes: FUN_003aec10 with the
  // lag, max -> HUD+0x66, FUN_003aed00: text element 5 = FUN_003cbb58(cur, max)
  setHP(cur, max) {
    gaugeSet(this.hp, cur, 1, this.now);
    this.hp[1] = max;
    if (this.hpElem) this.hpElem.text = hpText(this.hp[0], max);
  }
  // the draw list in order (the root's sibling chain); a hidden element (+2 bit 0) hides its children
  prims() {
    const out = [];
    let skip = -1;
    this.sc = FULL;
    for (const e of this.chain) {
      if (skip >= 0) { if (e.depth > skip) continue; skip = -1; }
      if (e.flags & 1) { skip = e.depth; continue; }
      const n0 = out.length;
      switch (e.type) {
        case 1: this.group(out, e); break;
        case 4: spriteElement(out, this.data, this, e); break;
        case 13: cornerElement(out, this.data, this, e); break;
        case 2: textElement(out, this.data, this, e, this.metrics); break;
        case 7:
          spriteElement(out, this.data, this, e);
          if (e.inSlot === 5 && e.id === 0x0a) hpBar(out, this.data, this, e);       // +0x3c = 0x3ae910
          else if (e.inSlot === 5 && e.id === 0x09) mpBar(out, this.data, this, e);  // +0x3c = 0x3ae9e8
          else if (e.inSlot === 6 && e.id === 0x2e) this.chainGauge(e, 0);           // LAB_003b4f50
          else if (e.inSlot === 6 && e.id === 0x32) this.chainGauge(e, 1);           // LAB_003b4f78
          // other callbacks are not translated: root 0x3f = the reticle (aim.js draws it), slot 3 0x4e,
          // slot 4 0x46, slot 8 0x70, slot 9 0x74, slot 10 0x77 (their panels are off screen or empty at the save)
          break;
        default: break;                                        // type 10 (hidden in the save) not translated
      }
      if (this.sc !== FULL) for (let i = n0; i < out.length; i++) out[i].scissor = this.sc;
    }
    return out;
  }
  // FUN_003d5ac0 (type 1): full scissor (FUN_003cae40), the group's own sprite, then the children's clip:
  // +0x3c bit 0 -> the box rows (+0x10, +0x14), else the full HUD (fade obj: num == den or flag 0x80;
  // otherwise HUD +0x26 rows)
  group(out, e) {
    this.sc = FULL;
    spriteElement(out, this.data, this, e);
    if (!(e.g3c & 1)) {
      const [n, d] = this.fade;
      this.sc = (n === d || (e.flags & 0x80)) ? clipHud(0, 0, 0x200, 0x1c0) : clipHud(0, 0, 0x200, this.h26);
    } else this.sc = clipHud(0, e.box[1], 0x200, e.box[3]);
    if (this.sc[0] === FULL[0] && this.sc[1] === FULL[1] && this.sc[2] === FULL[2] && this.sc[3] === FULL[3]) this.sc = FULL;
  }
  // FUN_003b4fa0(HUD, elem, which): the CHAIN gauge (HUD +0xbbc: cur, max, from, shown, timer). which 0
  // (element 0x2e) clips to the lag segment, 1 (0x32) to the filled part; then the pulse: cur != 0 ->
  // alpha = FUN_003d0ad0(1, 200 - 150 cur / max, 0x40, 0xc0, clock) on elements 0x33-0x35, 0x29, 0x2a
  // (list 0x472948) and the corners of sprites 0xec / 0xee / 0xf2 / 0xf3 (FUN_003d10a8), 0x1d -> 0
  // (0x472958); cur == 0 with HUD +0xbb4 == 0: 0x472948 -> 0x80, 0x472950 (0x29, 0x2a) -> 0, 0x1d -> 0x80
  chainGauge(e, which) {
    const g = this.chainG;
    gaugeTick(g, this.now);
    const w = e.rect[2];
    let lo, hi;
    if (g[0] < g[3]) { lo = w * g[0]; hi = w * g[3]; } else { lo = w * g[3]; hi = w * g[0]; }
    const a = (div0(lo, g[1]) << 16) >> 16;
    if (which === 0) this.sc = clipElem(this, (a + e.rect[0]) << 16 >> 16, e.rect[1], ((div0(hi, g[1]) << 16 >> 16) - a) << 16 >> 16, e.rect[3]);
    else this.sc = clipElem(this, e.rect[0], e.rect[1], a, e.rect[3]);
    const setA = (ids, v) => { for (const id of ids) { const x = this.find(6, id); if (x) x.rgba[3] = v; } };
    if (g[0] === 0 && this.chainBB4 === 0) {
      setA([0x33, 0x34, 0x35, 0x29, 0x2a], 0x80); setA([0x29, 0x2a], 0); setA([0x1d], 0x80);
    } else {
      const v = pulse(1, 200 - div0(g[0] * 0x96, g[1]), 0x40, 0xc0, this.now);
      setA([0x33, 0x34, 0x35, 0x29, 0x2a], v); setA([0x1d], 0);
      for (const sid of [0xec, 0xee, 0xf2, 0xf3]) {
        const S = this.data.sprites[sid];
        if (S && S.corners) for (const k of S.corners) k[3] = v;
      }
    }
  }
}

// FUN_003d0ad0(t0, half, a, b, now): a triangle wave from a to b and back, `half` ms each way
export function pulse(t0, half, a, b, now) {
  a &= 0xff; b &= 0xff;
  if (t0 === 0) return b;
  let t = ((now | 0) - t0) % (half * 2);
  if (t < 0) t += half * 2;                    // (unsigned in the game; the clock never runs below t0)
  let d = Math.abs(b - a);
  if (half <= t) t = half * 2 - t;
  t = div0(t * (d & 0xff), half) & 0xff;
  return a < b ? (a + t) & 0xff : (a - t) & 0xff;
}

export function hexBytes(h) {
  const b = new Uint8Array(h.length >> 1);
  for (let i = 0; i < b.length; i++) b[i] = parseInt(h.substr(2 * i, 2), 16);
  return b;
}
