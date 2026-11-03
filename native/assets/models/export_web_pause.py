#!/usr/bin/env python3
"""Export what the pause menu page (native/web/pause.js) needs, read from the user's own game files.

    python3 -I native/assets/models/export_web_pause.py [--elf ELF] [--disc extract/_KEL] [-o native/web/data/pause.json]

Everything written comes from the user's ELF (SLES_541.85) and disc files at run time and lands in
the gitignored native/web/data/. This script holds only addresses and the decode steps.
Notes: notes/menu-research.md ("Pause menu drawing", worker 0180).

What is exported
  layouts      pause 0x477678 (FUN_003bfe28) and the Yes/No message box 0x472ad8 (FUN_003b7f38), as
               byte scripts for menu_layout.js; opLen = DAT_0047a6c8. Worker 0239: the event window (box kind 4,
               0x472c48, FUN_003b8598) and the event pause (0x4779c0, FUN_003bfe28 param 1) for event_window.js.
  speakers     PTR_DAT_0047a8c8 (FUN_003d1c08, text code '$h'): [two letters, message id]; the ids' messages go
               into `messages` (worker 0239).
  images       DAT_0047bfc0 (16 bytes per image id): +0 slice list (8 bytes per piece: u, v, w, h,
               signed), +4 texture page (FUN_003dd4a8(page + 6)), +5 slice kind, +6 lit-variant byte,
               +7 repeat flags (bit 0 u, bit 1 v; FUN_003c94e0), +8 gradient colours (4 x u32,
               FUN_003c8dc0) or 0. Only the ids the pause and Yes/No screens draw.
  kinds        DAT_0047d180: 0x24 bytes per slice kind (lit offset, cols, stretch col, left / right
               margin piece, rows, stretch row, top / bottom margin piece).
  pieces       DAT_0047a6b0: FUN_003c9110's 5 pieces per row (width index, slice offset, direction,
               colour offset).
  textures     page -> name PTR_DAT_0047d500[page + 6] ('menuN'), texels + CLUT from the locale's
               menudata.bin (same TIM rule as export_web_aim.py menu_texture).
  font         page 1 'kelfnt0' (FUN_003cedf0 -> FUN_003dd4a8(1)): TEX0 tbp 0 PSMT4HH, TBW 8. Its
               texels are the kelfnt0 TIM image of fontdata1.bin (equal to the GS memory of the pause
               dump, all 448 rows). Exported: all 448 rows (FUN_003cd7e8 uses the whole page).
               CLUTs 1..5: FUN_003dcf58 uploads them from 0x47d3c0 + 0x40 (n - 1) when script flag
               0x1e is set (else 0x47d280), CBP = 0x3fff - DAT_0047ad14 - n (FUN_003dd5b0).
  widths       menudata.bin item 2 (DAT_004f2250 = FUN_003d25c8(2)) + 0x70: one nibble per glyph,
               width - 1, from code 3 (FUN_003cedf0).
  widths20     the same item from +0: one nibble per ASCII code from 0x20 (FUN_003cd7e8 / FUN_003cf338).
  boxTextOff   DAT_00472f58[language]: OK / CANCEL text x (0x7fff = keep the layout's), FUN_003b7f38.
  messages     kelstr.bin (FUN_00250770 -> loaded at 0x1fe0000, decoded by FUN_003fd370: XOR with two
               8-byte keys, then bank pointers relocated). Lookup FUN_003fd578: bank id >> 10,
               entry id & 0x3ff. Only the ids the pause flow uses.
Locale: language 2 (PTR_0046b2dc in the pause RAM snapshot) -> data/etc/locale/uk (menudata.bin
equals RAM at DAT_004bcd78 except 193 runtime bytes; kelstr.bin decodes to RAM 0x1fe0000 except
the 30 relocated pointers).
"""
import argparse
import json
import os
import re
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
sys.path.insert(0, HERE)
from export_web_menu import Elf, read_layout, OPLEN_AT, OPLEN_N  # noqa: E402
from export_web_aim import find_tim  # noqa: E402

ELF = os.path.join(ROOT, 'elf/SLES_541.85')
DISC = os.path.join(ROOT, 'extract/_KEL')
OUT = os.path.join(ROOT, 'native/web/data/pause.json')
LOCALE = 'uk'                                   # language 2 (see the docstring)
LANGUAGE = 2

LAYOUTS = {'pause': 0x477678, 'yesno': 0x472ad8,
           # FUN_003c0220 -> FUN_003c0a68 -> FUN_003d4a20: one type-8 widget each (rect, message, id, box kind)
           'box_restart': 0x477a10, 'box_quit': 0x477a30, 'box_tempsave': 0x477a50,
           # the event window, box kind 4 (FUN_003b84a8 -> FUN_003b8598, param_7 0; worker 0239)
           'window4': 0x472c48,
           # the event pause (FUN_003bfe28 param 1: Start during an event; language 2's rect override 0x51fc60[2] is 0)
           'eventpause': 0x4779c0}
BOX_TEXTOFF_AT = 0x472f58                       # FUN_003b7f38: per language 2 shorts, OK / CANCEL text x (+0x60)
LINEAR_IDS = {'pause': 0x477c18, 'eventpause': 0x477c30}   # FUN_003d58b8 (flag 0x1e): widget ids that get flag 8 (bilinear)
IMAGES_AT, KINDS_AT, PIECES_AT, PAGES_AT = 0x47bfc0, 0x47d180, 0x47a6b0, 0x47d500
IMAGE_IDS = [0x06, 0x07, 0x08, 0x0a, 0x34, 0x106, 0x107,
             0x10c, 0x35, 0x36]                 # the event pause's widgets 0x22 / 0x23 (0x36 when FUN_003e2790(); worker 0239)
CLUTS_AT = 0x47d3c0                             # FUN_003dcf58, flag 0x1e set (the PAL dump's branch)
FONT_ROWS = (0, 448)                            # the whole page: FUN_003cd7e8 glyphs (rows 0..27), FUN_003cedf0 (224..287)
MESSAGES = [0x5c00, 0x5c01, 0x5c02, 0x5c06, 0x5c07, 0x5c08, 0x3800, 0x3801]
# FUN_003d1c08 (text code '$h' + two letters): PTR_DAT_0047a8c8, 8 bytes a row (+0 two-letter name pointer, +4 message id),
# ends at id 0; the speaker names (its message ids) are exported with the table (worker 0239)
SPEAKERS_AT = 0x47a8c8


# FUN_003fd370 builds its two 8-byte XOR keys from four 16-bit constants that sit in its own
# instructions; they are read from the user's ELF (like tools/audio/bgm.py scramble_keys), not
# kept here. (address, opcode, rt): the ori / addiu that loads each one.
KELSTR_KEY_INSNS = {
    'k0_lo': (0x3fd398, 0x0d, 12),              # ori   t4, zero, imm   (shifted left by i)
    'k0_hi': (0x3fd3a0, 0x09, 10),              # addiu t2, zero, imm   (shifted left by 8 - i)
    'k1_lo': (0x3fd3a4, 0x0d, 9),               # ori   t1, zero, imm
    'k1_hi': (0x3fd3a8, 0x09, 8),               # addiu t0, zero, imm
}


def kelstr_keys(elf):
    """FUN_003fd370's key loop: k[i] = ((lo << i) >> 8) ^ ((hi << (8 - i)) >> 8), low byte."""
    imm = {}
    for name, (addr, op, rt) in KELSTR_KEY_INSNS.items():
        w = elf.u32(addr)
        if w >> 26 != op or (w >> 21) & 31 != 0 or (w >> 16) & 31 != rt:
            raise ValueError('FUN_003fd370: unexpected instruction %#010x at %#x (not SLES_541.85?)' % (w, addr))
        imm[name] = w & 0xffff
    def key(lo, hi):
        return bytes(((((lo << i) & 0xffffffff) >> 8) ^ (((hi << ((8 - i) & 31)) & 0xffffffff) >> 8)) & 0xff
                     for i in range(8))
    return key(imm['k0_lo'], imm['k0_hi']), key(imm['k1_lo'], imm['k1_hi'])


def kelstr_decode(d, keys):
    """FUN_003fd370: XOR the body (from +0x20, (+0x1c >> 3) qwords) with keys k0 / k1 alternately."""
    d = bytearray(d)
    k0, k1 = keys
    n = struct.unpack_from('<I', d, 0x1c)[0] >> 3
    for j in range(n):
        k = (k0, k1)[j & 1]
        for i in range(8):
            d[0x20 + 8 * j + i] ^= k[i]
    return bytes(d)


def kelstr_message(d, mid):
    """FUN_003fd578 on the decoded file (offsets kept file-relative: pointer = off + 0x24)."""
    count = struct.unpack_from('<I', d, 0x20)[0]
    if mid >= count:
        raise ValueError('message %#x out of range' % mid)
    off = struct.unpack_from('<I', d, 0x28 + 4 * (mid >> 10))[0]
    bank = off + 0x24
    n = struct.unpack_from('<H', d, bank)[0]
    if not off or (mid & 0x3ff) >= n:
        raise ValueError('message %#x missing' % mid)
    so = struct.unpack_from('<H', d, bank + 2 + 2 * (mid & 0x3ff))[0]
    s = d[bank + so:d.index(b'\0', bank + so)]
    return s


def menu_texture8(data, name):
    """A PSMT8 'menuN' picture (menu3 / menu4): the TIM image region ends with the CT32 upload of
    the texels (w / 2 x h / 2 words; 0100's rule for the PSMT4 reticle), followed by the 256-entry
    CT32 CLUT. Both equal the pause dump's GS memory at TBP / CBP 10828 / 10824 and 10960 / 10956
    word for word. Indices: the PSMT8-through-CT32 layout (tools/gsdump gstex_decode.unswizzle8);
    the CLUT is returned in CSM1 order resolved (entry i = palette colour of index i)."""
    t = find_tim(data, name)
    pic = t + (0x80 if data[t + 5] else 0x10)
    total, clut_size, img_size, hdr, ncol = struct.unpack_from('<IIIHH', data, pic)
    itype = data[pic + 0x13]
    w, h = struct.unpack_from('<HH', data, pic + 0x14)
    tex0 = struct.unpack_from('<Q', data, pic + 0x18)[0]
    psm, tbw = (tex0 >> 20) & 0x3f, (tex0 >> 14) & 0x3f
    if itype != 5 or psm != 0x13 or ncol != 256:
        raise ValueError('%s: not a PSMT8 / 256-colour picture' % name)
    img = pic + hdr
    src = data[img + img_size - w * h: img + img_size]
    clut = data[img + img_size + clut_size - ncol * 4: img + img_size + clut_size]
    idx = []
    for y in range(h):
        for x in range(w):
            block = (y & ~0xf) * w + (x & ~0xf) * 2
            swap = (((y + 2) >> 2) & 1) * 4
            pos_y = (((y & ~3) >> 1) + (y & 1)) & 7
            col = pos_y * w * 2 + ((x + swap) & 7) * 4
            byte = ((y >> 1) & 1) + ((x >> 2) & 2)
            idx.append('%02x' % src[block + col + byte])
    pal = [list(clut[4 * i:4 * i + 4]) for i in range(256)]
    order = [(i & 0xe7) | ((i & 0x08) << 1) | ((i & 0x10) >> 1) for i in range(256)]
    return {'w': w, 'h': h, 'psm': 'PSMT8', 'tbw': tbw, 'idx': ''.join(idx), 'clut': [pal[o] for o in order]}


def font_rows(fontdata):
    """kelfnt0's TIM3 image: 4-bit, linear rows of 256 bytes, texels = the last 0x1c000 bytes."""
    m = re.search(rb'kelfnt0\x00tm2\x00', fontdata)
    if not m:
        raise ValueError('fontdata1.bin: no kelfnt0 record')
    pic = m.start() + 16 + 0x10
    total, clut_size, img_size, hdr, ncol = struct.unpack_from('<IIIHH', fontdata, pic)
    w, h = struct.unpack_from('<HH', fontdata, pic + 0x14)
    if (w, h) != (512, 448):
        raise ValueError('kelfnt0: unexpected size %dx%d' % (w, h))
    img = pic + hdr + img_size - w * h // 2
    a, b = FONT_ROWS
    rows = fontdata[img + a * 256: img + b * 256]
    out = []
    for byte in rows:
        out.append('%x%x' % (byte & 15, byte >> 4))   # texel x even = low nibble
    return ''.join(out)


def dump_reference(path):
    """The last full frame's pause-menu draws of a GS dump (test_pause.mjs compares them): every draw
    from the full-screen dimming quad (FUN_003d5c40) to the end of the frame, as drawable 1/16 px
    (XYOFFSET removed), UV / RGBA per vertex, TEX0 / CLAMP / TEX1. Game-derived: gitignored data/."""
    sys.path.insert(0, os.path.join(ROOT, 'tools/gsdump/src'))
    import gsparse as G  # noqa: E402
    keep = (0x08, 0x14, 0x42)

    class Interp(G.GIFInterp):
        def __init__(self):
            super().__init__()
            self.extra = {}

        def write_reg(self, addr, data):
            if addr in keep:
                self.extra[addr] = data
            return super().write_reg(addr, data)

        def _new_draw(self):
            super()._new_draw()
            self._cur['extra'] = dict(self.extra)
    buf = open(path, 'rb').read()
    h = G.read_header(buf)
    g = Interp()
    off, vs = h['packets_at'], []
    while off < len(buf):
        t = buf[off]; off += 1
        if t == 0:
            off += 1
            n, = struct.unpack_from('<I', buf, off); off += 4
            g.feed(buf[off:off + n]); off += n
        elif t == 1:
            off += 1; vs.append(len(g.draws))
        elif t == 2:
            off += 4
        elif t == 3:
            off += 0x2000
        else:
            break
    a, b = vs[-2], vs[-1]
    draws = []
    start = None
    for d in g.draws[a:b]:
        if not d['verts']:
            continue
        xo = d['xyoffset']
        ox, oy = xo & 0xffff, (xo >> 32) & 0xffff
        v = [{'x': p['x'] - ox, 'y': p['y'] - oy, 'u': p['u'], 'v': p['vv'], 'c': [p['r'], p['g'], p['b'], p['a']]}
             for p in d['verts']]
        full = (d['ptype'] == 4 and not d['tme'] and len(v) == 4 and v[0]['x'] == 0 and v[0]['y'] == 0
                and v[3]['x'] == 432 * 16 and v[3]['y'] == 512 * 16)
        if start is None and full:
            start = len(draws)
        t0 = d['tex0']
        draws.append({'prim': d['ptype'], 'tme': d['tme'], 'tbp': t0 & 0x3fff, 'cbp': (t0 >> 37) & 0x3fff,
                      'psm': (t0 >> 20) & 0x3f, 'clamp': '%x' % d['extra'].get(0x08, 0),
                      'tex1': d['extra'].get(0x14, 0), 'v': v})
    if start is None:
        raise ValueError('no full-screen dimming quad in the last frame')
    # the font page as the draws sample it: GS memory (freeze snapshot at +0x1a9; no uploads to
    # TBP 0 in the stream), PSMT4HH = bits 28..31 of the PSMCT32 word at (x, y), TBW 8
    mem = buf[h['freeze_at'] + 0x1a9: h['freeze_at'] + 0x1a9 + 4 * 1024 * 1024]
    B32 = [[0, 1, 4, 5, 16, 17, 20, 21], [2, 3, 6, 7, 18, 19, 22, 23], [8, 9, 12, 13, 24, 25, 28, 29],
           [10, 11, 14, 15, 26, 27, 30, 31]]
    C32 = [[0, 1, 4, 5, 8, 9, 12, 13], [2, 3, 6, 7, 10, 11, 14, 15], [16, 17, 20, 21, 24, 25, 28, 29],
           [18, 19, 22, 23, 26, 27, 30, 31], [32, 33, 36, 37, 40, 41, 44, 45], [34, 35, 38, 39, 42, 43, 46, 47],
           [48, 49, 52, 53, 56, 57, 60, 61], [50, 51, 54, 55, 58, 59, 62, 63]]
    font = []
    for y in range(FONT_ROWS[0], FONT_ROWS[1]):
        for x in range(512):
            wa = (x // 64 + (y // 32) * 8) * 2048 + B32[(y % 32) // 8][(x % 64) // 8] * 64 + C32[y % 8][x % 8]
            font.append('%x' % (mem[4 * wa + 3] >> 4))
    return {'source': os.path.basename(path), 'draws': draws[start:], 'font4hh': ''.join(font)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--elf', default=ELF)
    ap.add_argument('--disc', default=DISC)
    ap.add_argument('-o', default=OUT)
    ap.add_argument('--dump', help='GS dump of the open pause menu: also write data/pause_ref.json (test reference)')
    ap.add_argument('--box-dump', help='GS dump of the pause with the Restart box open, CANCEL lit: data/pause_box_ref.json')
    ap.add_argument('--box-ok-dump', help='the same with OK lit: data/pause_box_ok_ref.json')
    a = ap.parse_args()
    elf = Elf(open(a.elf, 'rb').read())
    loc = os.path.join(a.disc, 'data/etc/locale', LOCALE)
    menudata = open(os.path.join(loc, 'menudata.bin'), 'rb').read()
    fontdata = open(os.path.join(loc, 'fontdata1.bin'), 'rb').read()
    kelstr = kelstr_decode(open(os.path.join(loc, 'kelstr.bin'), 'rb').read(), kelstr_keys(elf))
    oplen = list(elf.read(OPLEN_AT, OPLEN_N))

    kinds = [list(struct.unpack('<9i', elf.read(KINDS_AT + 0x24 * k, 0x24))) for k in range(5)]
    images, pages = {}, set()
    for i in IMAGE_IDS:
        b = elf.read(IMAGES_AT + 16 * i, 16)
        sp, page, kind, lit, rep, cp = struct.unpack_from('<IBBBBI', b, 0)
        n = kinds[kind][0] * (2 if lit in (0, 2) else 1)   # lit variant: pieces [count, 2 count)
        slices = [list(struct.unpack('<4h', elf.read(sp + 8 * k, 8))) for k in range(n)] if sp else []
        cols = list(struct.unpack('<4I', elf.read(cp, 16))) if cp else None
        images[str(i)] = {'page': page, 'kind': kind, 'lit': lit, 'rep': rep, 'slices': slices, 'colors': cols}
        pages.add(page)
    textures = {}
    for p in sorted(pages):
        name = elf.read(elf.u32(PAGES_AT + 4 * (p + 6)), 8).split(b'\0')[0].decode()
        t = menu_texture8(menudata, name)
        t['name'] = name
        textures[str(p)] = t
    nitems, = struct.unpack_from('<I', menudata, 0)
    w_off = struct.unpack_from('<I', menudata, 4 + 4 * 2)[0]
    if nitems < 3:
        raise ValueError('menudata.bin: no item 2')
    widths = menudata[w_off + 0x70: w_off + 0x70 + 0x30].hex()      # codes 3..0x61
    widths20 = menudata[w_off: w_off + 0x30].hex()                  # ASCII 0x20..0x7f
    box_textoff = list(struct.unpack('<2h', elf.read(BOX_TEXTOFF_AT + 4 * LANGUAGE, 4)))
    cluts = [[list(elf.read(CLUTS_AT + 0x40 * n + 4 * i, 4)) for i in range(16)] for n in range(5)]
    speakers, i = [], 0
    while elf.u32(SPEAKERS_AT + 8 * i + 4):
        nm = elf.read(elf.u32(SPEAKERS_AT + 8 * i), 2)
        speakers.append([nm.decode('ascii'), elf.u32(SPEAKERS_AT + 8 * i + 4)])
        i += 1
    msgs = {}
    for mid in MESSAGES + [sp[1] for sp in speakers]:
        s = kelstr_message(kelstr, mid)
        msgs['%#x' % mid] = s.hex()
    doc = {
        'source': 'SLES_541.85 + data/etc/locale/%s (exported by export_web_pause.py)' % LOCALE,
        'opLen': oplen,
        'layouts': {k: read_layout(elf, v, oplen).hex() for k, v in LAYOUTS.items()},
        'linearIds': {k: list(elf.read(v, 16).split(b'\xff')[0]) for k, v in LINEAR_IDS.items()},
        'images': images, 'kinds': kinds,
        'pieces': list(elf.read(PIECES_AT, 20)),
        'textures': textures,
        'font': {'w': 512, 'v0': FONT_ROWS[0], 'h': FONT_ROWS[1] - FONT_ROWS[0], 'idx': font_rows(fontdata),
                 'cluts': cluts},
        'widths': widths, 'widths20': widths20, 'boxTextOff': box_textoff,
        'messages': msgs, 'speakers': speakers,
    }
    os.makedirs(os.path.dirname(a.o), exist_ok=True)
    with open(a.o, 'w') as f:
        json.dump(doc, f)
    for src, name in ((a.dump, 'pause_ref.json'), (a.box_dump, 'pause_box_ref.json'),
                      (a.box_ok_dump, 'pause_box_ok_ref.json')):
        if not src:
            continue
        ref = dump_reference(src)
        rp = os.path.join(os.path.dirname(a.o), name)
        with open(rp, 'w') as f:
            json.dump(ref, f)
        print('wrote', rp, len(ref['draws']), 'menu draws')
    print('wrote', a.o, 'images', len(images), 'textures', [t['name'] for t in textures.values()],
          'messages', {k: bytes.fromhex(v)[:24] for k, v in msgs.items()})


if __name__ == '__main__':
    sys.exit(main())
