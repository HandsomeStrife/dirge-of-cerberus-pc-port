// Menu layout scripts: the game's widget-tree builder, translated.
//
// Every menu screen (title main menu FUN_00aa3c98, pause FUN_003bfe28, ...) builds its widgets
// from a byte script through FUN_003d41e0 -> FUN_003ddc18 -> FUN_003ca488. This file is
// FUN_003ca488 (the script interpreter), FUN_003ca9d8 (the parameter block's defaults) and the
// part of FUN_003c8910 that copies the block into a widget and makes its rect absolute.
// Scripts and the opcode length table come from data/menu.json (export_web_menu.py, read from
// the user's ELF). Notes: notes/menu-research.md.
//
// Not translated here (see the notes): the widget constructors behind the type table
// PTR_FUN_0047a6f0 (only their parameter block is kept), FUN_003ca160 (inner rect from the image
// frame margins), drawing (FUN_003c97a0), focus movement (FUN_003dde80 / FUN_003dd6c8).

// FUN_003ca9d8: the 0x58-byte parameter block, reset before the script and after each widget.
// Byte offsets of the fields that the opcodes write, named after where FUN_003c8910 puts them.
export function paramDefaults() {
  return {
    b0: 0,                 // +0x00 (copied to widget +2: runtime flags)
    id: 0xff,              // +0x01 op 0x16 -> widget +3
    nav: 0xff,             // +0x02 op 0x11 byte 1 -> widget +4 (focus order; 0xff = not focusable)
    rect: [0, 0, 0, 0],    // +0x04 op 0x0e x, y, w, h -> widget +6..+0xc
    rgba: [0x80, 0x80, 0x80, 0x80], // +0x14 op 0x0f -> widget +0x16..+0x19
    image: 0xffff,         // +0x18 op 0x17 -> widget +0x1a (image id, table DAT_0047bfc0)
    nav4: [0, 0, 0, 0],    // +0x20 op 0x11 bytes 2..5 (bStack_f0..ed)
    u24: 0xffffffff,       // +0x24 op 0x1b
    u2c: 0,                // +0x2c op 0x10 (button text: message id, e.g. 0x80005c01)
    c30: 0x80808080,       // +0x30 op 0x12
    s36: 0,                // +0x36 op 0x14
    textOff: [0x7f, 0x7f], // +0x38 / +0x3a op 0x1e
    b3c: null,             // +0x3c op 0x15; default 4 or 0 by FUN_003e2760 (not decoded) -> null
    b40: 0xff,             // +0x40 op 0x1c
    b41: 0,                // +0x41 op 0x18
    b42: 0,                // +0x42 op 0x1f
    u44: 9999,             // +0x44 op 0x19
    c48: [0x80808080, 0x80808080, 0x80808080, 0x80808080], // +0x48..+0x54 op 0x20
  };
}

const s16 = (b, o) => ((b[o] | (b[o + 1] << 8)) << 16) >> 16;
const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

// FUN_003c8910 (param block given): copy the block, then rect += parent rect (x at +6, y at +8).
function makeWidget(type, p, parent) {
  const w = {
    type, id: p.id, nav: p.nav, rect: p.rect.slice(), rgba: p.rgba.slice(), image: p.image,
    text: p.u2c, textOff: p.textOff.slice(), s36: p.s36, params: p, parent, children: [],
  };
  if (parent) {
    w.rect[0] = (w.rect[0] + parent.rect[0]) << 16 >> 16;
    w.rect[1] = (w.rect[1] + parent.rect[1]) << 16 >> 16;
  }
  return w;
}

// FUN_003ca488(parent, screen, script, focusId, ., ., override).
//  bytes    Uint8Array script (ends at 0xff)
//  opLen    DAT_0047a6c8 (bytes per opcode)
//  opts.focusId   param_4: the id of the widget to focus first (0xff = the first focusable)
//  opts.override  param_7: Int16 rect list for this language (4 per op 0x0e), or null
// Returns { roots, focus }: the widget tree and the widget FUN_003dd6c8 would focus at build.
export function buildLayout(bytes, opLen, opts = {}) {
  const focusId = opts.focusId ?? 0xff;
  const ov = opts.override || null;
  const state = { ovAt: 0, focus: null };
  const roots = [];
  run(bytes, 0, null, roots, opLen, focusId, ov, state);
  return { roots, focus: state.focus };
}

function run(b, p, parent, out, opLen, focusId, ov, st) {
  let prm = paramDefaults();
  let wantFocus = false;                        // bVar2 (local to each call)
  let focusDone = false;                        // iStack_ac (local to each call)
  for (let guard = 0; guard < 4096; guard++) {
    const op = b[p];
    if (op === 0xff) return;
    if (op < 0xe) {
      if (op !== 0) {
        const w = makeWidget(op, prm, parent);  // (&PTR_FUN_0047a6f0)[op - 1]
        out.push(w);                            // FUN_003caa90: w +0x20 = parent
        if (wantFocus && (prm.id === focusId || focusId === 0xff)) {
          st.focus = w;                         // FUN_003dd6c8(w, ...): the last one wins
          wantFocus = false;
          focusDone = true;                     // iStack_ac = 1
        }
        prm = paramDefaults();                  // FUN_003ca9d8 again
        if (op === 1) {                         // a type-1 widget takes the rest as children
          run(b, p + opLen[op], w, w.children, opLen, focusId, ov, st);
          return;
        }
      }
    } else {
      switch (op) {
        case 0x0e:
          if (!ov) prm.rect = [s16(b, p + 1), s16(b, p + 3), s16(b, p + 5), s16(b, p + 7)];
          else { prm.rect = ov.slice(st.ovAt, st.ovAt + 4); st.ovAt += 4; }
          break;
        case 0x0f: prm.rgba = [b[p + 1], b[p + 2], b[p + 3], b[p + 4]]; break;
        case 0x10: prm.u2c = u32(b, p + 1); break;
        case 0x11:
          prm.nav = b[p + 1];
          prm.nav4 = [b[p + 2], b[p + 3], b[p + 4], b[p + 5]];
          if (!focusDone && prm.nav !== 0xff) wantFocus = true;
          break;
        case 0x12: prm.c30 = u32(b, p + 1); break;
        case 0x14: prm.s36 = u16(b, p + 1); break;
        case 0x15: prm.b3c = b[p + 1]; break;
        case 0x16: prm.id = b[p + 1]; break;
        case 0x17: prm.image = u16(b, p + 1); break;
        case 0x18: prm.b41 = b[p + 1]; break;
        case 0x19: prm.u44 = u32(b, p + 1); break;
        case 0x1b: prm.u24 = u32(b, p + 1); break;
        case 0x1c: prm.b40 = b[p + 1]; break;
        case 0x1e: prm.textOff = [s16(b, p + 1), s16(b, p + 3)]; break;
        case 0x1f: prm.b42 = b[p + 1]; break;
        case 0x20: prm.c48 = [u32(b, p + 1), u32(b, p + 5), u32(b, p + 9), u32(b, p + 13)]; break;
        // 0x21: +0x2c = DAT_0047a6ac[byte] (a runtime table, 0 in the ELF): not used by these menus
        default: break;
      }
    }
    if (!opLen[op]) throw new Error('layout opcode 0x' + op.toString(16) + ' has no length');
    p += opLen[op];
  }
  throw new Error('layout script has no end byte');
}

// Flat list, depth first in creation order (the game's child list order is the reverse: each new
// child is linked at the head; only creation order matters for the checks here).
export function flatten(roots) {
  const out = [];
  const walk = (w) => { out.push(w); w.children.forEach(walk); };
  roots.forEach(walk);
  return out;
}

export function hexBytes(hex) {
  const a = new Uint8Array(hex.length / 2);
  for (let i = 0; i < a.length; i++) a[i] = parseInt(hex.substr(i * 2, 2), 16);
  return a;
}
