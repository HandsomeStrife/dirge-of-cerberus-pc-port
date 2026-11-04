// The Shop: stage-info kind 4 -> box kind 0x20 (worker 0263; notes/shop-research.md). NOT WIRED TO THE PAGE: logic tested in node only (test_shop.mjs), never drawn against the game. The page warns and closes
// the box (stage_info.js). wro_kaisetu's Supplies opens it; data/shop.json (export_web_shop.py, run by hand, not in build_web.sh).
//   FUN_003fdf00 state 4 -> FUN_003b66c0 -> PTR_FUN_00472d68[0x20] = FUN_003c2140 -> FUN_003c21b0 (vtable 0x4a5c60, 0x129c bytes). Translated here:
//     FUN_003c21b0 the screen (layouts 0x4788c8 root, 0x4789e8 Inventory / Gil, 0x4759d8 item stats, 0x478ab8 required item), FUN_003c2640 its events,
//     FUN_003c2ae8 cancel, FUN_003c29a8 + FUN_003c2f68 the requests and their answers, FUN_003c33b0 / FUN_003c3598 / FUN_003c3820 / FUN_003c3a60 the three lists,
//     FUN_003c2d18 a row, FUN_003c3c50 the sort and the list records, FUN_003c31b0 the count, FUN_003c3f78 / FUN_003c4040 the numbers, FUN_003c43c0 the item panel,
//     FUN_003c4798 + FUN_003c49d0 / FUN_003c4b30 the quantity box, FUN_003c4898 its events, FUN_003e3610 the spinner, FUN_003d8bc8 the list's keys, FUN_003d7bd8 record kind 9.
//   The game asks the status server (FUN_003e0b10 -> FUN_00312b38 -> FUN_003131c8) and gets the answer a frame or so later: on the page the requests are answered at once.
//     Request 5 (buy): FUN_00320dd0 gil >= cost, FUN_0031e940 add, FUN_00321428 take the gil. Request 6 (sell): FUN_0031e658 count >= n, FUN_0031eb60 take, FUN_003213d8 add the gil.
// Not on the page (warned once):
//   - Modify's answer (request 9: FUN_0031ec40 the new part, FUN_0031b190 the weapon's parts) and its screen FUN_003c4cb0: the page's Cerberus has no parts. wro_kaisetu's shop 1 has no Modify rows.
//   - the backdrop effect 0x70040400 (FUN_003e11c0, menu FED m0001), the fade FUN_003e0ed0 and the bottom bar's scrolling text (FUN_003bb808: a long help line); the bar itself is drawn.
import { SE, openBox, measureText, scissor } from './pause.js';
import { StageInfoScreen } from './stage_info.js';
import { measureCodes } from './event_window.js';
import { hexBytes } from './menu_layout.js';

export const BOX_KIND_SHOP = 0x20;
export const SHOP_STAT = 0x13;                     // STAT_SHOP_ID: FUN_0031d7b8(0x13) -> +0x5d
const CAP = 0x32;                                  // +0x1188 = 0x32, FUN_003c3260: + 1 per item with flags bit 9
const ROW_H = 0x14;                                // FUN_003c3c50: FUN_003d94d0(list, 0x14)
const LIST_ID = 10, TAB_IDS = [6, 7, 8];
const LIST_W = 0x110, LIST_W_MOD = 0x1d8;          // FUN_003c33b0's FUN_003c3c50 args
// the item panel: 0x4790f8 the 'Currently' widgets; 0x4767d0 the seven stat numbers (FUN_003c42b8), widget 0x33 the text
const CURRENTLY = [0x12, 0xd, 0x11], STAT_IDS = [0x3b, 0x3c, 0x3d, 0x3e, 0x3f, 0x40, 0x41], DESC_ID = 0x33;
const INV_N = 0x3c;
// +0x110c: an inventory entry's third word (equipped: FUN_003d22f0, bits 0 / 1). T: the save's slots in state w263/gssup: 2 on the first ammo item and the weapon's two parts. The page's Cerberus never changes.
export const EQUIPPED = new Set([0x62300000, 0x70300000, 0x70310000]);

const warned = new Set();
const warnOnce = (k, m, warn = console.warn) => { if (!warned.has(k)) { warned.add(k); warn(m); } };
const s16 = v => (v << 16) >> 16;
const rgbaOf = u => [u & 0xff, (u >>> 8) & 0xff, (u >>> 16) & 0xff, u >>> 24];
const ascii = s => Uint8Array.from(Array.from(s, c => c.charCodeAt(0)));
const idKey = id => (id >>> 0).toString(16).padStart(8, '0');
// FUN_003cba90: decimal as glyph codes (digit + 0x13, a minus 0x10); FUN_003cbb58 'a/b' (0x12)
export function glyphNum(v) {
  const out = [];
  if (v < 0) out.push(0x10);
  for (const c of String(Math.abs(v))) out.push(c.charCodeAt(0) - 0x30 + 0x13);
  return out;
}
const glyphs = a => Uint8Array.from([...a, 0]);
// FUN_003cb968: ASCII -> glyph codes (+ 0xe3)
const asciiGlyphs = b => Array.from(b, c => (c + 0xe3) & 0xff);

export function loadShopData(j, D) {
  const msg = { ...D.msg };
  for (const [k, v] of Object.entries(j.messages)) msg[parseInt(k, 16)] = hexBytes(v);
  const layouts = { ...D.layouts };
  for (const [k, v] of Object.entries(j.layouts)) layouts['si' + k] = v;
  return { ...D, msg, layouts, images: { ...D.images, ...j.images }, textures: { ...j.textures, ...D.textures }, shop: { shops: j.shops, items: j.items, none: hexBytes(j.none), scroll: j.scroll } };
}

// One script's widgets: a screen's root or a sub-screen (FUN_003d4478 / FUN_003d43f8: they share the screen's open timer +0x2c / +0x30)
class ShopPanel extends StageInfoScreen {
  constructor(D, layout, now, box) {
    super(D, layout, now);
    this.box = box;
    for (const w of this.all) {
      if (w.type === 2 || w.type === 5) {
        w.c58 = rgbaOf(w.c30); w.col4c = w.c58.slice(); w.textCol = w.c58.slice(); w.flags5e = w.s36 & 0xffff; w.lineGap = 0; w.spacing = 0; w.str = null; w.count = 0;
        if (w.textId) this.setStr(w, D.msg[w.textId & 0x7fffffff] || null);   // FUN_003d6f30 -> FUN_003d03a0
      }
    }
    this.focus = null; this.hasFocus = false;
  }
  // FUN_003d03a0 / vt+0xd4: a '$&' string or flag 0x80: the glyph font (0x480 / 0x80), else the text path
  setStr(w, b, glyph = false) {
    w.str = b;
    w.flags5e = (w.flags5e & 0xfb7f) | (glyph ? 0x80 : b && b[0] === 0x24 && b[1] === 0x26 ? 0x480 : 0);
    if (b && !(w.flags5e & 0x80) && this.D.si) { const m = measureCodes(this.D, w, b); w.tw = m.w; w.th = m.h; }
  }
  lit(w) { return this.box.focusW === w; }
  drawWidget(w) {
    if (w.flags & 1) return;
    if (w.type === 2) { this.drawImage(w, 0xffff); this.drawStr(w); }
    else if (w.type === 12) { w.textCol = this.lit(w) ? w.col74 : w.col7c; super.drawWidget(w); this.drawButtonText(w); }
    else if (w.type === 6) this.box.drawList(this, w);
    else if (w.type === 5) { this.drawImage(w, 0xffff); w.col4c = this.lit(w) ? [0x80, 0x80, 0x80, 0x80] : [0x70, 0x70, 0x70, 0x80]; this.linear = true; if (w.str) this.renderCodes(w, w.str, 0x7fff, 0x7fff); this.linear = false; }   // FUN_003e2c60
    else if (w.type === 7) { /* FUN_003d6c88: nothing of its own (no image) */ }
    else super.drawWidget(w);
  }
  drawStr(w) {
    if (!w.str) return;
    if (w.flags5e & 0x80) {
      const s = (w.flags5e & 0x400) ? w.str.subarray(2) : w.str;
      // FUN_003cedf0 is given the position FUN_003d0198's flags (0x10 centre, 0x20 right) work out from the measured width
      const off = w.textOff[0];
      if (off === 0x7f && (w.flags5e & 0x30)) {
        const tw = this.glyphWidth(w, s);
        w.textOff[0] = (w.flags5e & 0x10) ? (w.ix - w.x) + Math.trunc((w.iw - tw) / 2) : (w.ix - w.x) + (w.iw - tw);
      }
      w.textCol = w.c58 || w.textCol;
      this.linear = true; this.drawGlyphs(w, s); this.linear = false;
      w.textOff[0] = off;
    } else {
      w.col4c = (w.c58 || [0x80, 0x80, 0x80, 0x80]).slice();
      this.linear = true; this.renderCodes(w, w.str, 0x7fff, 0x7fff); this.linear = false;
    }
  }
  glyphWidth(w, s) {
    const D = this.D;
    let n = 0;
    for (const ch of s) {
      if (ch === 0) break;
      if (ch <= 2) continue;
      if (ch === 3) n += (D.widthBytes[0] & 0xf) + 1;
      else if (ch < 0x62) { const b = D.widthBytes[(ch - 3) >> 1]; n += (((ch - 3) & 1) ? b >> 4 : b & 0xf) + 1; } else n += 12;
    }
    return n;
  }
  // FUN_003d1368's text for a plain string (FUN_003cc0a8 -> FUN_003cd7e8); pause.js draws only the glyph path
  drawButtonText(w) {
    if (!w.str || (w.flags5e & 0x80)) return;
    const col4c = w.col4c;
    w.col4c = w.textCol; w.lineGap = w.lineGap || 0; w.tw = 0;
    this.linear = true; this.renderCodes(w, w.str, 0x7fff, 0x7fff); this.linear = false;
    w.col4c = col4c;
  }
}

// FUN_003c21b0's screen. Interface as stage_info.js's boxes: frame(now), draw(now), closed, events; key(a) from the page's keys.
export class ShopBox {
  // inv: items.js Inventory (DAT_0046e248 +8 the gil, DAT_0046e240 the slots)
  constructor(D, inv, shopId, now, { warn = console.warn } = {}) {
    this.D = D; this.inv = inv; this.warn = warn; this.events = []; this.closed = false; this.now = now;
    this.shop = D.shop.shops[shopId] || null;
    if (!this.shop) warnOnce('noshop' + shopId, 'shop: stage file has no shop ' + shopId, warn);
    this.shopId = shopId;
    this.result = 0; this.leaving = false;
    this.root = new ShopPanel(D, 'shopRoot', now, this);
    this.tabs = new ShopPanel(D, 'shopTabs', now, this);
    this.info = new ShopPanel(D, 'shopInfo', now, this);
    this.desc = null;
    this.bar = new ShopPanel(D, 'shopHelp', now, this);
    this.bar.bar = true;
    this.list = this.root.byId(LIST_ID);
    this.tabWs = TAB_IDS.map(i => this.root.byId(i));
    this.focusW = this.tabWs[0];
    this.tab = 0; this.lastFocus = 0xff;           // +0x5c, +0x1190
    this.backTo = 0xff;                            // +0x1191
    this.rows = []; this.cursor = 0; this.top = 0; this.px = 0;   // +4000 and the records; list +0x84, +0x8a, +0x8c
    this.qty = null; this.boxW = null; this.pick = null;
    this.open = this.root.cur;
    // FUN_003c3f78 / FUN_003c4040 read the status server: request 0 and 0x13 answered at once (FUN_003c3260)
    this.readInventory();
    this.setTab(0, false);
    this.tabs.flags = 0;
    this.help(this.tabWs[0].help);
    this.events.push({ se: SE.open });
  }
  get panels() { return [this.bar, this.root, this.tabs, this.info, this.desc].filter(Boolean); }
  // FUN_003c3260 request 0: the slots: id, count, +0x110c; +0x1184 entries with an id, +0x1188 = 0x32 + those with flags bit 9
  readInventory() {
    const inv = this.inv;
    this.slot = []; this.used = 0; this.cap = CAP;
    for (let k = 0; k < INV_N; k++) {
      const e = inv.slots[k];
      const id = e && e[0] !== -1 ? e[0] >>> 0 : 0xffffffff;
      const r = id !== 0xffffffff ? this.rec(id) : null;
      this.slot.push({ id, n: id !== 0xffffffff ? inv.countAt(k) : 0, f: EQUIPPED.has(id) ? 2 : 0 });
      if (id !== 0xffffffff) { this.used++; if (r && (r.flags & 0x200)) this.cap++; }
    }
    this.gil = inv.gil;
    this.numbers();
  }
  rec(id) { return this.D.shop.items[idKey(id)] || this.inv.rec(id); }
  // FUN_003c31b0: the first entry's count, or (all) every entry's
  countOf(id, all) {
    if (id === 0xffffffff) return 0;
    let n = 0, hit = false;
    for (const s of this.slot) if (s.id === id) { if (!all) return s.n; n += s.n; hit = true; }
    return hit ? n : 0;
  }
  // FUN_003c3f78 + FUN_003c4040: Inventory a/b (widget 0x10), Gil (0x14), from the tabs' sub-screen
  numbers() {
    const T = this.tabs;
    T.setStr(T.byId(0x10), glyphs([...glyphNum(this.used), 0x12, ...glyphNum(this.cap)]), true);
    T.setStr(T.byId(0x14), glyphs(glyphNum(this.gil)), true);
  }
  // FUN_003c2d18 (+0xba0 flags 0)
  row(id, slotF, price, res, req) {
    const r = this.rec(id);
    const max = r && (r.flags & 1) ? r.max : 1;
    return { id, slotF, price, res: res ?? 0xffffffff, req: req ?? 0xffffffff, own: s16(this.countOf(id, false)), max, flags: 0, key: r ? r.key : 0xffff, slot: -1, icon: r ? r.icon : 0x27,
      name: this.name(id), right: ascii(String(price)), third: res != null && res !== 0xffffffff ? this.name(res) : null };
  }
  name(id) { const r = this.rec(id); return r && r.name ? hexBytes(r.name) : ascii('?'); }
  // FUN_003c33b0(tab, keep)
  setTab(t, keep) {
    const S = this.shop;
    const was = keep ? { c: this.cursor, top: this.top } : null;
    this.rows = [];
    if (S) {
      if (t === 0) this.listBuy(S); else if (t === 2) this.listModify(S); else this.listSell(S);
    }
    // FUN_003c3c50: insertion sort by the record's +0xa (a place taken: FUN_003c3c08), the list's width, whole rows, FUN_003da780(list, 0x78)
    const R = this.rows, order = [];
    for (const e of R) { let i = order.findIndex(o => (e.key >>> 0) < (o.key >>> 0)); if (i < 0) i = order.length; order.splice(i, 0, e); }
    this.rows = order;
    const l = this.list, W = t === 2 ? LIST_W_MOD : LIST_W;
    for (const e of this.rows) {
      const tw = measureCodes(this.D, Object.assign(rowW(l), { iw: 0x7fff }), e.right).w;
      e.rightX = W - tw - 0xe;                     // +0x14 = param_3 - width - 0xe
    }
    l.iw = W; l.w = W;
    const h = Math.min(this.rows.length ? this.rows.length * ROW_H : ROW_H, 0x78);
    l.h = h; l.ih = h;
    this.page = Math.trunc((l.ih + ROW_H - 1) / ROW_H);
    this.cursor = was ? Math.min(was.c, Math.max(this.rows.length - 1, 0)) : 0;
    this.top = was ? Math.max(Math.min(was.top, Math.max(this.rows.length - this.page, 0)), 0) : 0;
    this.scrollTo(this.top);
    this.tab = t;
    if (keep) {
      if (this.rows.length < 1) { if (this.focusW === l) this.backToTabs(); else this.panel(-1); }
      else this.panel(this.cursor);
    } else this.panel(-1);
  }
  // FUN_003c3598
  listBuy(S) {
    for (const [id, price] of S.buy) {
      if (!this.rec(id)) continue;
      const e = this.row(id, 0, price);
      const r = this.rec(id);
      if (this.gil < price) e.flags |= 1;
      else if (e.own === 0 && this.cap <= this.used) e.flags |= 1;
      else if (e.own < e.max) { /* buyable */ }
      else if (this.cap <= this.used) e.flags |= 1;
      else if (r.flags & 1) e.flags |= 1;
      this.rows.push(e);
    }
  }
  // FUN_003c3820: 0x3c3760 the price (binary search, 0 when absent); flags bit 5 not listed
  listSell(S) {
    const price = id => { let lo = 0, hi = S.sell.length - 1; while (lo <= hi) { const m = (lo + hi) >> 1, v = S.sell[m][0]; if (v === id) return S.sell[m][1]; if (v < id) lo = m + 1; else hi = m - 1; } return 0; };
    this.slot.forEach((s, k) => {
      const r = s.id !== 0xffffffff ? this.rec(s.id) : null;
      if (!r || (r.flags & 0x20)) return;
      const e = this.row(s.id, s.f, price(s.id));
      e.slot = k;
      if (s.n === 0 || (s.f & 3)) e.flags = 1;     // FUN_003d22f0
      this.rows.push(e);
    });
  }
  // FUN_003c3a60: 0x3c39a0 for each slot's id, the n-th row with it
  listModify(S) {
    this.slot.forEach((s, k) => {
      for (const [id, price, res, req0] of S.modify) {
        if (id !== s.id) continue;
        const req = req0 ? req0 : 0xffffffff;
        if (req !== 0xffffffff && this.countOf(req, false) === 0) continue;
        const e = this.row(id, s.f, price, res, req);
        e.slot = k;
        if (this.gil < price) e.flags |= 1;
        this.rows.push(e);
      }
    });
  }
  // FUN_003c43c0: the item panel for row k (-1 none)
  panel(k) {
    const e = k >= 0 ? this.rows[k] : null;
    const id = e ? (e.res !== 0xffffffff ? e.res : e.id) : 0xffffffff;
    const T = this.tabs, I = this.info;
    const hide = v => { for (const c of CURRENTLY) { const w = T.byId(c); if (w) { if (v) w.flags |= 1; else w.flags &= ~1; } } };
    const dw = I.byId(DESC_ID);
    if (!e) { dw.flags |= 1; hide(true); }
    else {
      const r = this.rec(id);
      I.setStr(dw, r && r.desc ? hexBytes(r.desc) : null); dw.flags &= ~1;
      const total = this.countOf(id, true), max = r && (r.flags & 1) ? r.max : 0;
      T.setStr(T.byId(0x12), glyphs(max < 1 ? glyphNum(total) : [...glyphNum(total), 0x12, ...glyphNum(max)]), true);
      hide(false);
    }
    // FUN_003d2338: seven stats of a kind 3 item, a zero or none '---'
    const r = e ? this.rec(id) : null, st = r && r.stats ? r.stats : [0, 0, 0, 0, 0, 0, 0];
    STAT_IDS.forEach((w, i) => I.setStr(I.byId(w), glyphs(st[i] === 0 ? asciiGlyphs(this.D.shop.none) : glyphNum(st[i])), true));
    if (e && e.req !== 0xffffffff) {
      if (!this.desc) this.desc = new ShopPanel(this.D, 'shopDesc', this.now, this);
      const w = this.desc.byId(0x18), m = this.D.msg[0xa80f];
      this.desc.setStr(w, sprintf(m, [this.name(e.req)]));
    } else this.desc = null;
  }
  // FUN_003bb808: the bar's text; a line longer than the bar scrolls (not translated: warned)
  help(id) {
    const w = this.bar.byId(3);
    if (id == null || id === 0xffffffff) { this.bar.setStr(w, null); return; }
    this.bar.setStr(w, this.D.msg[id & 0x7fffffff] || null);
  }
  backToTabs() { this.focusW = this.tabWs[this.tab]; this.help(this.focusW.help); this.panel(-1); }
  // FUN_003d9368: +0x8a = top, +0x8c its pixels, kept so the cursor's row shows
  scrollTo(top) {
    this.top = top; this.px = top * ROW_H;
    const c = this.cursor * ROW_H;
    if (c < this.px) this.px = c;
    else if (this.px + this.list.ih < c + ROW_H) this.px += c + ROW_H - (this.px + this.list.ih);
    // FUN_003ca388: the scroll bar (+0xa4): width 0 when the rows fit
    const l = this.list, total = this.rows.length * ROW_H, S = this.D.shop.scroll;
    this.barS = null;
    if (S && total > l.ih) {
      const w = Math.abs(S[2].s[2]), iv = l.ih - 0xe;
      let th = Math.trunc(iv * l.ih / total); if ((th & 0xffff) < 0x10) th = 0x10;
      let y = Math.trunc((iv - th) * this.px / (total - l.ih));
      if (iv < y + th) y = iv - th;
      this.barS = { x: l.ix + l.iw - w, w, y: y + 7 + l.iy, h: th };
    }
  }

  // ---------------------------------------------------------------- input
  // FUN_003d8bc8 with the list's nav bytes 0xff: up / down with wrap on fresh presses, left / right a page
  listKey(a) {
    const n = this.rows.length, was = this.cursor;
    let top = this.top;
    if (a === 'up') { if (was - 1 < 0) { this.cursor = n - 1; top = Math.max(n - this.page, 0); } else { this.cursor = was - 1; if (was - 1 < top) top = was - 1; } }
    else if (a === 'down') { if (was + 1 >= n) { this.cursor = 0; top = 0; } else { this.cursor = was + 1; if (top + this.page <= was + 1) top = top + 1; } }
    else if (a === 'left') { if (was === 0) return; const c = was - this.page; if (c < 0) { this.cursor = 0; top = 0; } else { this.cursor = c; top = Math.max(top - this.page, 0); } }
    else if (a === 'right') { if (was === n - 1) return; const c = was + this.page; if (c >= n) { this.cursor = n - 1; top = Math.max(n - this.page, 0); } else { this.cursor = c; top = Math.min(top + this.page, Math.max(n - this.page, 0)); } }
    this.scrollTo(top);
    if (this.cursor !== was) { this.se(SE.cursor); this.panel(this.cursor); }
  }
  se(id) { this.events.push({ se: id }); }
  // a: 'cross' 'circle' 'up' 'down' 'left' 'right'
  key(a, now = this.now) {
    if (this.leaving) return false;
    if (this.boxW) return this.boxKey(a, now);
    if (this.qty) return this.qtyKey(a, now);
    if (this.focusW === this.list) {
      if (a === 'cross') {                         // FUN_003d8930: +0x86 == 0 nothing; a row with bit 0 no event, sound 5
        const e = this.rows[this.cursor];
        if (!e) return true;
        if (e.flags & 1) { this.se(5); return true; }
        this.se(SE.confirm);
        this.choose(e, now);
      } else if (a === 'circle') { this.se(SE.cancel); this.backToTabs(); }   // FUN_003caf90 -> FUN_003c2ae8 -> FUN_003c2ab0
      else this.listKey(a);
      return true;
    }
    const map = { up: 2, down: 3, left: 4, right: 5 };
    if (a === 'cross') {                           // FUN_003d14e8 -> FUN_003c2640 cases 6 .. 8
      this.se(SE.confirm);
      if (this.rows.length === 0) return true;     // +0x86 == 0
      this.backTo = this.focusW.id;
      this.focusW = this.list; this.help(null); this.panel(this.cursor);
      return true;
    }
    if (a === 'circle') {                          // FUN_003caf90 -> FUN_003c2ae8: not the list: box 0x479080 (id 0x55; kinds 0x20 / 0x23)
      this.se(SE.cancel);
      this.openQuestion('shopLeave', null, 0x55, now);
      return true;
    }
    const f = this.navTab(map[a]);
    if (f && f !== this.focusW) {
      this.se(SE.cursor);
      this.focusW = f; this.help(f.help);
      this.setTab(TAB_IDS.indexOf(f.id), false);   // FUN_003c2bb8: the focused tab changed
    }
    return true;
  }
  navTab(a) { // FUN_003cbc38 with fresh presses (kind != 0): an explicit neighbour; the low 7 bits are the order
    const w = this.focusW, n = w.nav4[a - 2];
    if (n === 0xff) return w;
    return this.tabWs.find(t => t.nav === (n & 0x7f)) || w;
  }
  // FUN_003c2640 case 10
  choose(e, now) {
    const own = e.own;
    const p = this.pick = { e, n: 1, price: e.price, mx: 1, slot: e.slot };
    p.mx = e.max - own;
    if (p.mx < 1) p.mx = 1;
    if (this.gil < e.price * p.mx) p.mx = Math.trunc(this.gil / e.price);
    if (e.max < 2 && this.tab !== 2) { this.confirm(1, now); return; }
    if (this.tab === 2) { warnOnce('mod', 'shop: Modify (request 9, FUN_0031ec40, FUN_0031b190, FUN_003c4cb0) not translated: the page has no weapon parts', this.warn); return; }
    // FUN_003c4798: FUN_003c49d0 (Buy) / FUN_003c4b30 (Sell: the count owned, or the limit when more)
    const q = new ShopPanel(this.D, this.tab === 1 ? 'shopQty1' : 'shopQty0', now, this);
    const ids = this.tab === 1 ? [0x25, 0x22, 0x26] : [0x1d, 0x1a, 0x1e];
    q.setStr(q.byId(ids[0]), glyphs([...glyphNum(own), 0x12, ...glyphNum(e.max)]), true);
    q.setStr(q.byId(ids[1]), sprintf(this.D.msg[this.tab === 1 ? 0xa805 : 0xa804], [e.name]));
    const mx = this.tab === 1 ? (e.max < own ? own - e.max : own) : p.mx;
    const sp = q.byId(ids[2]);
    this.qty = { q, sp, min: 1, max: mx, val: 1, digit: 1, step: 1, nd: String(mx).length };
    this.focusW = sp;
    this.spinText();
    this.se(SE.open);
  }
  // FUN_003e3958: the value with leading blanks under the digit count
  spinText() { const Q = this.qty; Q.q.setStr(Q.sp, ascii(String(Q.val).padStart(Q.nd, ' '))); }
  // FUN_003e3610 up / down / left / right; ✕ FUN_003c4898 cases 0x1e / 0x26; ○ FUN_003c4998 + FUN_003d4640
  qtyKey(a, now) {
    const Q = this.qty, was = Q.val, d = Q.digit;
    if (a === 'cross') { this.se(SE.confirm); const n = Q.val; this.qty = null; this.focusW = this.list; this.confirm(n, now); return true; }
    if (a === 'circle') { this.se(SE.cancel); this.qty = null; this.focusW = this.list; return true; }
    if (a === 'up') { if (Q.val + Q.step <= Q.max) Q.val += Q.step; }
    else if (a === 'down') { if (Q.val - Q.step >= Q.min) Q.val -= Q.step; }
    else if (a === 'left') { if (Q.digit === Q.nd) Q.val = Q.max; else { Q.digit++; Q.step *= 10; } }
    else if (a === 'right') { if (Q.digit === 1) Q.val = Q.min; else { Q.digit--; Q.step = Math.trunc(Q.step / 10); } }
    this.spinText();
    if (was !== Q.val || d !== Q.digit) this.se(SE.cursor);
    return true;
  }
  // FUN_003c28a0: the question; Modify with no result goes straight on
  confirm(n, now) {
    const p = this.pick;
    p.n = n;
    const msg = this.tab === 1 ? 0xa80b : 0xa80a;
    this.openQuestion(this.tab === 1 ? 'shopSell' : 'shopBuy', sprintf(this.D.msg[msg], [p.e.name, n]), this.tab === 1 ? 0x54 : 0x53, now);
  }
  // FUN_003d4a20 -> a type-8 box (pause.js openBox)
  openQuestion(script, text, ev, now) {
    const b = openBox(this.D, 'si' + script, now, 0);
    if (!b) { warnOnce('box', 'shop: the question box did not open', this.warn); return; }
    if (text) { const w = b.byId(5); w.str = text; const m = measureText(this.D, w, text); w.tw = m.w; w.th = m.h; w.count = m.count; }
    this.boxW = { b, ev };
    this.se(9);
    this.prevFocus = this.focusW; this.focusW = null;   // FUN_003de9b0: the box gone, the focus returns to the widget that kept flag 2
  }
  // FUN_003b80f8 / FUN_003b81b8 -> FUN_003c2640 cases 0x53 .. 0x56
  boxKey(a, now) {
    const { b, ev } = this.boxW;
    b.se = null;
    if (a === 'left' || a === 'right') {           // FUN_003cbc38: +0x6a / +0x6b
      const n = b.focus.nav4[a === 'left' ? 2 : 3];
      const t = n === 0xff ? null : b.next(b.focus, n & 0x7f, 0, true);
      if (t && t !== b.focus) { b.setFocus(t); this.se(SE.cursor); }
      return true;
    }
    const r = b.action(a === 'cross' ? 0 : a === 'circle' ? 1 : a === 'up' ? 2 : 3, 1);
    if (r && r.moved !== undefined) { this.se(SE.cursor); return true; }
    if (!r) return true;
    const yes = r.event === 6;
    this.se(yes ? SE.confirm : SE.cancel);
    b.close(now); this.closingBox = b; this.boxW = null;
    this.focusW = this.prevFocus;
    if (ev === 0x55) {
      if (yes) { this.result = 2; this.leaving = true; this.se(SE.close); }
      return true;
    }
    if (yes) this.request();
    this.numbers();
    return true;
  }
  // FUN_003c29a8 -> FUN_003131c8 + FUN_003c2f68
  request() {
    const p = this.pick, e = p.e, inv = this.inv;
    if (this.tab === 0) {                          // request 5
      const cost = e.price * p.n;
      let k = -1;
      if (cost <= inv.gil) k = inv.add(e.id | 0, p.n);
      if (k !== -1 && e !== null) inv.gil -= cost;
      else warnOnce('fail5', 'shop: a purchase the list allowed failed', this.warn);
    } else if (this.tab === 1) {                   // request 6
      const k = p.slot, have = inv.countAt(k);
      if (have >= p.n) {
        inv.remove(k, p.n);
        inv.gil = Math.min(inv.gil + e.price * p.n, 99999999);   // FUN_003213d8: under the cap only
      }
    } else { warnOnce('mod', 'shop: Modify not translated', this.warn); return; }
    this.readInventory();
    this.setTab(this.tab, true);
  }

  // ---------------------------------------------------------------- frame + draw
  frame(now) {
    this.now = now;
    for (const p of this.panels) p.update(now);
    const c = this.closingBox;
    if (c) { c.update(now); if (c.closing && c.cur === 0) this.closingBox = null; }
    if (this.boxW) this.boxW.b.update(now);
    if (this.leaving && !this.boxW && !this.closingBox) this.closed = true;
  }
  draw(now) {
    const out = [];
    for (const p of this.panels) out.push(...p.draw(now));
    if (this.qty) { this.qty.q.update(now); out.push(...this.qty.q.draw(now)); }
    if (this.closingBox) out.push(...this.closingBox.draw(now));
    if (this.boxW) out.push(...this.boxW.b.draw(now));
    return out;
  }
  // FUN_003d7bd8, record kind 9 (FUN_003c3c50: FUN_003d9648(list, record, 9, 0x7fff, 0))
  drawList(P, l) {
    const x = s16(l.ix * 2 + 2 - l.x), y0 = s16(l.iy * 2 - l.y - this.px);
    const save = P.sc;
    P.sc = scissor(l.ix, l.iy, l.iw, l.ih);        // FUN_003cae68
    const gap = (ROW_H - 0x10) >> 1;
    for (let i = this.top; i < Math.min(this.rows.length, this.top + this.page + 1); i++) {
      const e = this.rows[i], y = s16(y0 + i * ROW_H);
      // uVar7 & 3: 0x80404040; the cursor's 0x80808080; the others FUN_003d0c88 (0x10 less each)
      const col = (e.flags & 3) ? [0x40, 0x40, 0x40, 0x80] : i === this.cursor ? [0x80, 0x80, 0x80, 0x80] : [0x70, 0x70, 0x70, 0x80];
      const icon = P.D.images[String(e.icon)];
      if (icon) {                                  // FUN_003c9b48 (+0x18), then +0x1a: 0x10e on an equipped entry
        const [u, v, w, h] = icon.slices[0], ix = x, iy = y + gap;
        P.emitSprite([ix * 16, iy * 16, u * 16 + 1, v * 16 + 1], [(ix + w) * 16, (iy + h) * 16, (u + w) * 16, (v + h) * 16], col, icon.page);
      }
      P.linear = true;
      const tw = (off, b) => { const y1 = s16(y + gap); const rw = Object.assign(rowW(l), { x: s16(x + off), y: y1, ix: s16(x + off), iy: y1, iw: l.iw, ih: 0x7fff, col4c: col }); P.renderCodes(rw, b, 0x7fff, 0x7fff); };
      tw(0x13, e.name);
      tw(e.rightX, e.right);
      if (e.third) tw(200, e.third);
      P.linear = false;
    }
    P.sc = save;
    const s = this.barS, S = P.D.shop.scroll;
    if (s) {                                       // FUN_003c9de8: PTR_DAT_0047c6d0 / e0 the ends, 0x47c6c0 the track, 0x47c6b0 the thumb (rows of u, v, w, h at 0, 8, 0x10)
      const c = [0x80, 0x80, 0x80, 0x80];
      const sp = (T, q, y, h) => P.sprite3cac70(s.x, y, s.w, h, T.s[q], T.s[q + 1], T.s[q + 2], T.s[q + 3], c, T.page, false);
      const [thumb, track, top, bot] = S, ta = Math.abs(top.s[3]), ba = Math.abs(bot.s[3]);
      sp(top, 0, l.iy, ta);
      sp(bot, 0, l.iy + l.ih - 7, ba);
      const iy = l.iy + 7 + track.s[3], ih = l.ih - 0xe - track.s[3];
      sp(track, 0, l.iy + 7, track.s[3]);
      sp(track, 8, iy + ih - track.s[11], track.s[11]);
      sp(track, 4, iy, ih - track.s[11]);
      const ty = s.y + thumb.s[3], th = s.h - thumb.s[3];
      sp(thumb, 0, s.y, thumb.s[3]);
      sp(thumb, 8, ty + th - thumb.s[11], thumb.s[11]);
      sp(thumb, 4, ty, th - thumb.s[11]);
    }
  }
}
// FUN_00248f0c on the message's '%s' / '%d' (bytes)
export function sprintf(fmt, args) {
  const out = []; let k = 0;
  for (let i = 0; i < fmt.length; i++) {
    if (fmt[i] === 0x25 && (fmt[i + 1] === 0x73 || fmt[i + 1] === 0x64)) {
      const a = args[k++];
      if (typeof a === 'number') out.push(...ascii(String(a))); else out.push(...a);
      i++;
    } else out.push(fmt[i]);
  }
  return Uint8Array.from(out);
}
function rowW(l) {
  return { type: 9, id: l.id, x: l.x, y: l.y, w: l.w, h: 0x7fff, ix: l.ix, iy: l.iy, iw: l.iw, ih: 0x7fff, flags: 0, flags5e: 0, lineGap: 0, spacing: 0, textOff: [0x7f, 0x7f], col4c: [0x80, 0x80, 0x80, 0x80], c58: [0x80, 0x80, 0x80, 0x80], parent: l.parent, children: [] };
}

// ---------------------------------------------------------------- the page (play.js)
// createShop({ stageInfo, items }): stage_info.js's makeBox for box kind 0x20, the keys; data/shop.json. No data: the box closes at once, warned (as before this job).
export function createShop({ stageInfo, inventory, flags, url = 'data/shop.json', warn = m => console.warn(m) }) {
  const S = { box: null, json: null };
  S.ready = fetch(url).then(r => (r.ok ? r.json() : null)).catch(() => null).then(j => { S.json = j; if (!j) warn('shop: no ' + url + ' (export_web_shop.py): the Shop closes at once'); });
  const prev = stageInfo.makeBox;
  stageInfo.makeBox = (bk, now) => {
    if (bk !== BOX_KIND_SHOP) return prev ? prev(bk, now) : null;
    if (!S.json || !stageInfo.D) { warnOnce('nodata', 'shop: no data: closed at once', warn); return { closed: true, events: [], frame() {}, draw() { return null; } }; }
    const D = loadShopData(S.json, stageInfo.D), inv = inventory();
    if (!inv) { warnOnce('noinv', 'shop: no inventory on the page: closed at once', warn); return { closed: true, events: [], frame() {}, draw() { return null; } }; }
    // the records items.js has no row for (the stage file's items only): FUN_00310560 reads all of bgd.bin
    for (const [k, r] of Object.entries(S.json.items)) inv.table[k] ??= r;
    if (S.json.scripts && S.scripts) S.scripts(S.json.scripts);
    S.box = new ShopBox(D, inv, flags.stat(SHOP_STAT), now, { warn });
    const b = S.box, end = b.frame.bind(b);
    b.frame = n => { end(n); if (b.closed) S.box = null; };
    return b;
  };
  S.key = a => (S.box ? S.box.key(a) : false);
  return S;
}
