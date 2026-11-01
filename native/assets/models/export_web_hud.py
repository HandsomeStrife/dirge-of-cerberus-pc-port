#!/usr/bin/env python3
"""export_web_hud.py -- the in-game HUD (HP gauge, weapon panel) for the web play page (hud.js).

    python3 -I native/assets/models/export_web_hud.py [--elf ELF] [--locale DIR]
        [--state sea-of-flames.p2s] [-o native/web/data/hud]

Writes OUT/hud.json (gitignored game data; notes/hud-research.md). Sources:

ELF (static data):
  - the HUD's layout scripts (FUN_003ad618 builds 11 panels with FUN_003d41e0 / FUN_003d43f8 /
    FUN_003d4478 -> FUN_003ddc18 -> FUN_003ca488): a byte code; ops 1-13 create an element of that
    type (constructor PTR_FUN_0047a6f0[op - 1]; op 1 = a group whose children follow), ops 0xe-0x21
    set the next element's attributes (op lengths DAT_0047a6c8), 0xff ends. Exported as `layout`
    (a cross-check of the save's tree; the page draws the save's tree, see below).
  - sprite records DAT_0047bfc0[id] (0x10 bytes: +0 frame list (u, v, w, h shorts), +4 texture
    (PTR_DAT_0047d500[+4 + 6]: menu1-4), +5 frame kind, +7 stretch flags, +8 corner colours of an
    untextured sprite (FUN_003c8dc0)); frame kinds DAT_0047d180 (0x24 bytes, FUN_003c97a0 /
    FUN_003c94e0).
  - gauge colours DAT_00471fa0 (0x14 bytes per row: 2 colours, 2 edge-line colour lists, a direction
    byte; FUN_003aed60).
  - font CLUTs: FUN_003dd5b0(n) -> CBP base - n; the 16 colours of CLUT n are the static words at
    0x47d380 + 0x40 n (n = 1, 2: white text halves; 3, 4: grey number halves).

data/etc/locale/uk/menudata.bin (the save runs the UK locale: its font table equals the save's RAM
byte for byte): textures menu1-4 (export_web_aim.menu_texture) and entry 2 = the font metrics
(FUN_003d2600 -> FUN_003d25c8(2) = DAT_004f2250: width nibbles, number widths at +0x70, kerning
pairs at +0x360).
data/etc/locale/uk/fontdata1.bin: kelfnt0 (TIM3 512x448, 4-bit, stored linear; equals the GS memory
at TBP 0 read as PSMT4HH in the hero dump, 0 mismatches). Each texel holds two 2-bit glyph planes;
the CLUT picks one.

sea-of-flames.p2s (the save state the page starts from): the HUD object *(0x471380): HP / MP
values and the element tree of every HUD panel (slot 5 HP, 6 weapon, 8 item list, ...), as
the HUD code left them (positions after the PAL widening and the slides, colours, sprites, hidden
flags, text bytes). All panels hang off one sibling list from the root (HUD +0x18): `chain`, in
draw order, each top-level group tagged with its slot. The HUD code that set them (weapon icon pick FUN_003daec8, CHAIN gauge, item
list) is not translated; the page keeps these as the save has them.
"""
import argparse
import json
import os
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import export_web_aim as A  # noqa: E402  (Elf, menu_texture)

ROOT = A.ROOT
LOCALE = os.path.join(ROOT, 'extract/_KEL/data/etc/locale/uk')
STATE = '/srv/shared/dirge-port/save-states/sea-of-flames.p2s'
OUT = os.path.join(ROOT, 'native/web/data/hud')

HUD_PTR = 0x471380                      # DAT_00471380 = the HUD object (FUN_003ad618)
SLOT_TABLES = [0x4718d8, 0x471898, 0x471938, 0x471910, 0x471810, 0x471390, 0x4714d0,
               0x471760, 0x471970, 0x471c18, 0x471c50]   # FUN_003ad618: slot i -> HUD + 0x38 + 4 i
SPRITES = 0x47bfc0
KINDS = 0x47d180
BARS = 0x471fa0
OPLEN = 0x47a6c8
FONT_CLUTS = 0x47d380


# ------------------------------------------------------------------ layout byte code (FUN_003ca488)
def parse_layout(elf, a):
    """The element list of one layout script, in creation order: dicts with type, depth and the
    attributes the script set (rect x, y, w, h relative to the parent; rgba; sprite; id; ...)."""
    lens = [elf.u8(OPLEN + i) for i in range(0x22)]
    out, depth, attrs = [], 0, {}
    while True:
        op = elf.u8(a)
        if op == 0xff:
            return out
        b = elf.read(a, lens[op])
        if 1 <= op <= 0xd:
            out.append(dict(attrs, type=op, depth=depth))
            attrs = {}
            a += lens[op]
            if op == 1:
                depth += 1
            continue
        if op == 0xe:
            attrs['rect'] = list(struct.unpack('<4h', b[1:9]))
        elif op == 0xf:
            attrs['rgba'] = list(b[1:5])
        elif op == 0x16:
            attrs['id'] = b[1]
        elif op == 0x17:
            attrs['sprite'] = struct.unpack('<h', b[1:3])[0]
        elif op == 0x14:
            attrs['text_flags'] = struct.unpack('<h', b[1:3])[0]
        elif op == 0x20:
            attrs['corners'] = [list(struct.pack('<I', v)) for v in struct.unpack('<4I', b[1:17])]
        a += lens[op]


# ------------------------------------------------------------------ save state: the live tree
def read_tree(mem):
    u32 = lambda a: struct.unpack_from('<I', mem, a & 0x1ffffff)[0]
    s16 = lambda a: struct.unpack_from('<h', mem, a & 0x1ffffff)[0]
    u16 = lambda a: struct.unpack_from('<H', mem, a & 0x1ffffff)[0]
    H = u32(HUD_PTR)
    vt_type = {0x4a64b0: 1, 0x4a66f0: 4, 0x4a6630: 7, 0x4a67b0: 2, 0x4a6570: 13, 0x4a6ac0: 10}

    def elem(e, depth):
        vt = u32(e + 0x38)
        d = {'id': mem[e + 3], 'type': vt_type.get(vt, -1), 'depth': depth,
             'flags': mem[e + 2],                               # +2: bit 0 hidden, 8 / 0x40 / 0x80 draw bits
             'rect': [s16(e + o) for o in (6, 8, 10, 12)],      # absolute x, y, w, h (HUD px)
             'box': [s16(e + o) for o in (14, 16, 18, 20)],     # +0xe..: inner box (FUN_003ca160)
             'rgba': list(mem[e + 0x16:e + 0x1a]),
             'sprite': s16(e + 0x1a)}
        if d['type'] == 1:                                      # FUN_003d5ac0: +0x3c bit 0 = clip children to the box
            d['g3c'] = mem[e + 0x3c]; d['g3d'] = mem[e + 0x3d]
        if d['type'] == 13:                                     # FUN_003d5f68: corner colours at +0x3c
            d['corners'] = [list(mem[e + 0x3c + 4 * i:e + 0x40 + 4 * i]) for i in range(4)]
        if d['type'] == 2:                                      # text (FUN_003d7040 -> FUN_003cc0a8)
            s = u32(e + 0x54)
            txt = bytes(mem[s:s + 256].split(b'\0')[0]) if s else b''
            d.update(text=list(txt), tflags=u16(e + 0x5e), t5c=s16(e + 0x5c), t60=s16(e + 0x60),
                     t62=s16(e + 0x62), t64=mem[e + 0x64], t65=mem[e + 0x65], t44=u16(e + 0x44),
                     col4c=list(struct.pack('<I', u32(e + 0x4c))), col58=list(struct.pack('<I', u32(e + 0x58))))
        return d

    slot_of = {u32(H + 0x38 + 4 * i): i for i in range(11)}

    def walk(e, depth, out):
        while e:
            d = elem(e, depth)
            if depth == 0 and e in slot_of:
                d['slot'] = slot_of[e]
            if depth == 0 and e == u32(H + 0x18):
                d['slot'] = 'root'
            out.append(d)
            c = u32(e + 0x24)                                   # first child; +0x30 = next sibling
            if c:
                walk(c, depth + 1, out)
            e = u32(e + 0x30)
        return out

    # the draw list: every top-level group is a sibling of the root (HUD +0x18): root -> slot 1 ->
    # ... -> slot 4 -> slot 5 (HP) -> slot 6 (weapon) -> ... (the hero dump draws in this order)
    chain = walk(u32(H + 0x18), 0, [])
    values = {'hp': [s16(H + 100 + 2 * i) for i in range(4)] + [u32(H + 0x6c)],   # cur, max, from, shown, timer
              'mp': [s16(H + 0x70 + 2 * i) for i in range(4)] + [u32(H + 0x78)],
              'mp_cap': s16(H + 0x2ce),                                            # HUD+0x2ce (FUN_003aea10)
              'chain': [s16(H + 0xbbc + 2 * i) for i in range(4)] + [u32(H + 0xbc4)],  # FUN_003b4fa0 gauge
              'chain_bb4': u32(H + 0xbb4),
              'h26': s16(H + 0x26),                                                # FUN_003cae68 clip height
              'clock': u32(0x4f58ec),                                              # DAT_004f58ec (HUD clock, ms)
              'fade': [struct.unpack_from('<i', mem, H + 0x2c)[0], struct.unpack_from('<i', mem, H + 0x30)[0]]}
    return chain, values


def menu_texture8(data, name):
    """A PSMT8 / 256-colour menu picture (menu3, menu4): like export_web_aim.menu_texture, the texels
    are the last w*h bytes of the image region and the colours the last 0x400 bytes of the CLUT
    region; both are uploaded verbatim (hero dump: menu3 CT32 128x64 -> TBP 10828, CLUT 16x16 ->
    CBP 10824; menu4 64x64 -> 10960 / 10956) and read back as PSMT8 TBW w/64 with a CSM1 CLUT.
    Read-back = the canonical PSMT8 deswizzle of a CT32 write (gstex_decode.unswizzle8)."""
    t = A.find_tim(data, name)
    pic = t + (0x80 if data[t + 5] else 0x10)
    _tot, clut_size, img_size, hdr, ncol = struct.unpack_from('<IIIHH', data, pic)
    ctype, itype, w, h = data[pic + 0x12], data[pic + 0x13], *struct.unpack_from('<HH', data, pic + 0x14)
    if itype != 5 or (ctype & 0x3f) != 3 or ncol != 256:
        raise ValueError('%s: not a PSMT8 / 256-colour CT32 CLUT picture' % name)
    img = pic + hdr
    src = data[img + img_size - w * h:img + img_size]
    clut = data[img + img_size + clut_size - 0x400:img + img_size + clut_size]
    idx = bytearray(w * h)
    for y in range(h):
        for x in range(w):
            block = (y & ~0xf) * w + (x & ~0xf) * 2
            swap = (((y + 2) >> 2) & 1) * 4
            pos_y = (((y & ~3) >> 1) + (y & 1)) & 7
            col = pos_y * w * 2 + ((x + swap) & 7) * 4
            byte = ((y >> 1) & 1) + ((x >> 2) & 2)
            idx[y * w + x] = src[block + col + byte]
    pal = []
    for i in range(256):                                     # CSM1: index bits 3 and 4 swapped
        j = (i & 0xe7) | ((i & 0x08) << 1) | ((i & 0x10) >> 1)
        pal.append(list(clut[4 * j:4 * j + 4]))
    return {'w': w, 'h': h, 'psm': 'PSMT8', 'idx8': bytes(idx).hex(), 'clut': pal}


def sprite_table(elf, ids):
    out = {}
    for sid in sorted(ids):
        if sid < 0:
            continue
        a = SPRITES + 0x10 * sid
        fp, tex, kind, f6, f7, cp = elf.u32(a), elf.u8(a + 4), elf.u8(a + 5), elf.u8(a + 6), elf.u8(a + 7), elf.u32(a + 8)
        k = struct.unpack('<HH8i', elf.read(KINDS + 0x24 * kind, 0x24))
        n = k[7] if k[7] > 0 else 0                            # frames per draw (DAT_0047d194)
        nf = max(n * k[3], 1) if kind != 3 else 1
        frames = [list(struct.unpack('<4h', elf.read(fp + 8 * i, 8))) for i in range(max(k[0], 1))] if fp else []
        s = {'tex': tex, 'kind': kind, 'f6': f6, 'f7': f7, 'frames': frames}
        if cp:
            s['corners'] = [list(elf.read(cp + 4 * i, 4)) for i in range(4)]
        out[sid] = s
    return out


def dump_hud(path):
    """The HUD draws of a GS dump's last frame (test reference for test_hud.mjs): every draw from the
    first sprite textured from menu3 (TBP 10828; the room streams other textures through that slot earlier) on, one record per GS primitive (a sprite or a 4-vertex
    strip = 2 triangles in gsparse), as {p, tbp, cbp, v: [x, y, u, v, rgba] per vertex (px / texels), sc: SCISSOR x0, x1, y0, y1}."""
    sys.path.insert(0, os.path.join(ROOT, 'tools/gsdump/src'))
    import gsrender2 as g, gsparse  # noqa: E402
    buf = open(path, 'rb').read()
    h = gsparse.read_header(buf)
    gif = g.build(buf, h, sprite_uv=True)
    a, b = g.pick_frame(gif, 'last')
    start = next(i for i in range(a, b) if gif.tris[i][3]['tme'] and gif.tris[i][3]['ptype'] == 6
                 and g.tex0_fields(gif.tris[i][3]['tex0'])['tbp0'] == 10828)
    out, i = [], start
    while i + 1 < b:
        t0, t1 = gif.tris[i], gif.tris[i + 1]
        c = t0[3]
        if c['frame'] & 0x1ff != 224:
            i += 1
            continue
        ofx, ofy = (c['xyoffset'] & 0xffffffff) / 16, (c['xyoffset'] >> 32) / 16
        tf = g.tex0_fields(c['tex0'])
        vs = []
        for v in (t0[0], t0[1], t0[2], t1[2]):
            vs.append([v[0] / 16 - ofx, v[1] / 16 - ofy, v[6] / 16, v[7] / 16, list(v[8:12])])
        sc = c['scissor']
        out.append({'p': c['ptype'], 'tme': c['tme'], 'tbp': tf['tbp0'] if c['tme'] else None,
                    'cbp': tf['cbp'] if c['tme'] else None, 'v': vs,
                    'sc': [sc & 0x7ff, (sc >> 16) & 0x7ff, (sc >> 32) & 0x7ff, (sc >> 48) & 0x7ff]})
        i += 2
    return out


def declare(out):
    """Declare hud.json in the page's scene.json ("hud": path from data/), so play.js fetches it only
    when it exists (no 404 in the console without it). export_web_room.py, which writes scene.json,
    declares it again when hud/hud.json is there."""
    data = os.path.dirname(os.path.abspath(out))
    sp = os.path.join(data, 'scene.json')
    if not os.path.isfile(sp):
        print('note: no %s yet (export_web_room.py declares the HUD when it writes it)' % sp)
        return
    scene = json.load(open(sp))
    scene['hud'] = os.path.relpath(os.path.join(os.path.abspath(out), 'hud.json'), data)
    tmp = sp + '.tmp'
    with open(tmp, 'w') as fh:
        json.dump(scene, fh, indent=1)
    os.replace(tmp, sp)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--elf', default=A.ELF)
    ap.add_argument('--iso')
    ap.add_argument('--locale', default=LOCALE)
    ap.add_argument('--state', default=STATE)
    ap.add_argument('-o', '--out', default=OUT)
    ap.add_argument('--dump', help='also write OUT/dump_<name>.json: this GS dump\'s HUD draws (test reference)')
    a = ap.parse_args()
    if a.dump:
        os.makedirs(a.out, exist_ok=True)
        name = os.path.splitext(os.path.basename(a.dump))[0]
        with open(os.path.join(a.out, 'dump_%s.json' % name), 'w') as fh:
            json.dump(dump_hud(a.dump), fh)
    elf = A.load_elf(a)
    sys.path.insert(0, os.path.join(ROOT, 'tools/trace'))
    from p2s import read_p2s  # noqa: E402
    mem = read_p2s(a.state)['eeMemory.bin']
    chain, values = read_tree(mem)
    layout = {i: parse_layout(elf, SLOT_TABLES[i]) for i in range(11)}
    ids = {e['sprite'] for e in chain}
    kinds = [list(struct.unpack('<HH8i', elf.read(KINDS + 0x24 * k, 0x24))) for k in range(5)]
    bars = []
    for r in range(6):
        b = elf.read(BARS + 0x14 * r, 0x14)
        pa, pb = struct.unpack_from('<II', b, 8)
        bars.append({'c0': list(b[0:4]), 'c1': list(b[4:8]), 'dir': b[0x10],
                     'edgeA': [list(elf.read(pa + 4 * i, 4)) for i in range(3)],
                     'edgeB': [list(elf.read(pb + 4 * i, 4)) for i in range(3)]})
    md = open(os.path.join(a.locale, 'menudata.bin'), 'rb').read()
    textures = {}
    for n in ('menu1', 'menu2'):
        textures[n] = A.menu_texture(md, n)
    for n in ('menu3', 'menu4'):
        textures[n] = menu_texture8(md, n)
    nent = struct.unpack_from('<I', md, 0)[0]
    font_off = struct.unpack_from('<I', md, 4 + 4 * 2)[0] if nent > 2 else None
    metrics = md[font_off:font_off + 0x3a0]
    fd = open(os.path.join(a.locale, 'fontdata1.bin'), 'rb').read()
    t = fd.find(b'TIM3')
    pic = t + 0x10
    _tot, csz, isz, hdr, _nc = struct.unpack_from('<IIIHH', fd, pic)
    w, h = struct.unpack_from('<HH', fd, pic + 0x14)
    img = pic + hdr
    atlas = fd[img + isz - w * h // 2: img + isz]               # linear 4-bit, low nibble = even x
    cluts = {n: [list(elf.read(FONT_CLUTS + 0x40 * n + 4 * i, 4)) for i in range(16)] for n in (1, 2, 3, 4)}
    out = {
        'hud': [512, 448], 'fb': [432, 512],                   # FUN_003d2e80 / FUN_003d3098 (DAT_004f2258 set)
        'chain': chain, 'values': values,
        'layout': {str(k): v for k, v in layout.items()},
        'sprites': {str(k): v for k, v in sprite_table(elf, ids).items()}, 'kinds': kinds, 'bars': bars,
        'textures': textures,
        'font': {'w': w, 'h': h, 'atlas': atlas.hex(), 'cluts': {str(k): v for k, v in cluts.items()},
                 'metrics': metrics.hex()},
    }
    os.makedirs(a.out, exist_ok=True)
    tmp = os.path.join(a.out, 'hud.json.tmp')
    with open(tmp, 'w') as fh:
        json.dump(out, fh)
    os.replace(tmp, os.path.join(a.out, 'hud.json'))
    declare(a.out)
    print('hud.json: %d elements in the draw list (slots %s), %d sprites, HP %d/%d, textures %s, font %dx%d'
          % (len(chain), [e['slot'] for e in chain if 'slot' in e], len(out['sprites']),
             values['hp'][0], values['hp'][1], ', '.join(textures), w, h))


if __name__ == '__main__':
    main()
