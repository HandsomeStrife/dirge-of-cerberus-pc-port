#!/usr/bin/env python3
"""export_web_hud.py -- the in-game HUD (HP gauge, weapon panel) for the web play page (hud.js).

    python3 -I native/assets/models/export_web_hud.py [--elf ELF] [--locale DIR]
        [--state sea-of-flames.p2s (cross-check)] [-o native/web/data/hud]

Writes OUT/hud.json (gitignored game data; notes/hud-research.md). Sources:

ELF (static data):
  - the HUD's layout scripts (FUN_003ad618 builds 11 panels with FUN_003d41e0 / FUN_003d43f8 /
    FUN_003d4478 -> FUN_003ddc18 -> FUN_003ca488): a byte code; ops 1-13 create an element of that
    type (constructor PTR_FUN_0047a6f0[op - 1]; op 1 = a group whose children follow), ops 0xe-0x21
    set the next element's attributes (op lengths DAT_0047a6c8), 0xff ends. Exported as `layout`
    (raw; the tree below is built from the same scripts).
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

The element tree (no save state; worker 0195): built as the game builds it. FUN_003ad618 (the
constructor: the layout scripts, priorities, PAL widening, text buffers, colours, hide lists, the item
list, the weapon / ammo / item panels), the status sync's setters (FUN_00339988 / FUN_00339590 ->
FUN_003ae030 / FUN_003ae138 / FUN_003adda8 / FUN_003ae308 / FUN_003ae418 / FUN_003addf8 / FUN_003b4e08)
fed with START (Vincent's status at the start: the save's values, hand-written), a hide / show
(FUN_003ad5b0 / FUN_003ad560, GUESS order), the slides / item list / fades run to their end and one
draw's writes (CHAIN glow alpha, the 'drawn' flag of plain text). The item name is kelstr.bin's
(FUN_003fd690; data/etc/locale/uk/kelstr.bin, decoded with export_web_pause's keys). `chain` = the
root's sibling list from the root (HUD +0x18): root, slots 1, 3-10, in draw order, each top-level group
tagged with its slot. Equal field by field to the sea-of-flames save's tree (all 114 elements and
`values`); the save's list goes on with 88 elements of other screens, which draw nothing on screen.

--state sea-of-flames.p2s (cross-check): read the tree from the save's HUD object *(0x471380) instead
(the 88 extra elements included; the old output, byte for byte) and print its differences to the disc
build; exit status 1 when there are any (a failing disc build counts as one). Test: test_hud_setup.mjs.
"""
import argparse
import json
import math
import os
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import export_web_aim as A  # noqa: E402  (Elf, menu_texture)
import export_web_pause as P  # noqa: E402  (kelstr decode)

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


# ------------------------------------------------------------------ the HUD built as the game builds it
# (FUN_003ad618 and the start-of-stage calls; notes/hud-research.md "Set-up from the disc")
S16 = lambda v: ((v & 0xffff) ^ 0x8000) - 0x8000

HUD_SCRIPT_ROOT = 0x4717e8
VT_TYPE = {1: 1, 2: 2, 4: 4, 6: -1, 7: 7, 10: 10, 13: 13}   # layout op -> export_web_hud type (vtable)


class El:
    """A menu element (FUN_003c8910's layout: +2 flags, +3 id, +5 priority, +6 rect, +0xe box,
    +0x16 rgba, +0x1a sprite, +0x1c/+0x1e position in the parent, +0x20 parent, +0x24 children)."""

    def __init__(self, op):
        self.op = op
        self.children = []
        self.parent = None
        self.prio = 0


class Setup:
    def __init__(self, elf, lang=2, clock=0, bilinear=True, start=None):
        self.elf = elf
        self.lang = lang                       # PTR_0046b2dc (2 = UK English, the exported locale)
        self.pal = lang != 0                   # FUN_003e2760: lang != 0 and PTR_FUN_0047ad24 == 0
        self.clock = clock                     # DAT_004f58ec / FUN_0023c1f0 (ms)
        self.bilinear = bilinear               # FUN_002413c0(0x1e): DAT_004b8980 bit 30
        self.H = {}                            # the HUD object's fields by offset
        self.slots = [None] * 11               # HUD +0x38 + 4 i
        self.top = []                          # the global root's child list (FUN_003cab20 order)
        self.oplen = [elf.u8(0x47a6c8 + i) for i in range(0x22)]

    # ------------------------------------------------------------------ ELF reads
    def s16(self, a):
        return struct.unpack('<h', self.elf.read(a, 2))[0]

    def u16(self, a):
        return struct.unpack('<H', self.elf.read(a, 2))[0]

    def i32(self, a):
        return struct.unpack('<i', self.elf.read(a, 4))[0]

    def bytelist(self, a, end):
        out = []
        while self.elf.u8(a) != end:
            out.append(self.elf.u8(a)); a += 1
        return out

    def sprite_rec(self, sid):
        return 0x47bfc0 + 0x10 * (sid & 0xffff)

    def kind_rec(self, sid):
        return 0x47d180 + 0x24 * self.elf.u8(self.sprite_rec(sid) + 5)

    # ------------------------------------------------------------------ element primitives
    def find(self, e, ident):
        """FUN_003cb0f8: the first direct child with id `ident`, else the element itself."""
        if ident == 0xff or ident == -1:
            return e
        for c in e.children:
            if c.id == (ident & 0xff):
                return c
        return e

    def hide(self, e, on):
        """FUN_003cb360"""
        e.flags = (e.flags | 1) if on else (e.flags & 0xfe)

    def box(self, e):
        """FUN_003ca160 (vtable +0x3c of every HUD type but 6): the inner box from the sprite's frame
        kind (DAT_0047d180: +8 / +0x18 stretch col / row, +0xc / +0x10 / +0x1c / +0x20 edge frames)."""
        # type 6's FUN_003da740 = this + its +0x88 line count (not exported)
        sid = e.sprite & 0xffff
        k8 = k9 = 0
        if sid != 0xffff:
            kb = self.kind_rec(sid)
            k9 = self.i32(kb + 0x18); k8 = self.i32(kb + 0x8)
        else:
            sid = 0
        fp = self.elf.u32(self.sprite_rec(sid))
        if k8 != 0 and fp:
            kb = self.kind_rec(sid)
            a = abs(self.s16(fp + self.i32(kb + 0xc) * 8 + 4))
            b = abs(self.s16(fp + self.i32(kb + 0x10) * 8 + 4))
            e.box[0] = S16(e.rect[0] + a)
            v = (e.rect[2] & 0xffff) - a - b
            e.box[2] = S16(v)
            if S16(v) < 0:
                e.box[2] = 0; e.rect[2] = S16(a + b)
        else:
            e.box[0] = e.rect[0]; e.box[2] = e.rect[2]
        if k9 != 0 and fp:
            kb = self.kind_rec(sid)
            a = abs(self.s16(fp + self.i32(kb + 0x1c) * 8 + 6))
            b = abs(self.s16(fp + self.i32(kb + 0x20) * 8 + 6))
            e.box[1] = S16(e.rect[1] + a)
            v = (e.rect[3] & 0xffff) - a - b
            e.box[3] = S16(v)
            if S16(v) < 0:
                e.box[3] = 0; e.rect[3] = S16(a + b)
        else:
            e.box[1] = e.rect[1]; e.box[3] = e.rect[3]

    def move(self, e, x, y, rel):
        """FUN_003cb380"""
        if not rel:
            if x != 0x7fff:
                e.rect[0] = S16(x)
            if y != 0x7fff:
                e.rect[1] = S16(y)
        else:
            e.rect[0] = e.rx; e.rect[1] = e.ry
            if e.parent is not None:
                e.rect[0] = S16(e.rx + e.parent.rect[0]); e.rect[1] = S16(e.ry + e.parent.rect[1])
        self.box(e)
        for c in e.children:
            self.move(c, 0, 0, 1)

    def resize(self, e, w, h):
        """FUN_003cb450"""
        e.rect[3] = S16(h); e.rect[2] = S16(w)
        self.box(e)

    def set_sprite(self, e, sid):
        """FUN_003cb168"""
        e.sprite = S16(sid)
        fp = self.elf.u32(self.sprite_rec(sid))
        if fp:
            e.rect[2] = abs(self.s16(fp + 4)); e.rect[3] = abs(self.s16(fp + 6))
        self.box(e)

    def insert(self, e, prio):
        """FUN_003cab20 on the parent's child list (sorted by +5, after the last with prio <= new)."""
        lst = e.parent.children if e.parent is not None else self.top
        if e in lst:
            lst.remove(e)
        e.prio = prio
        i = len(lst)
        while i > 0 and lst[i - 1].prio > prio:
            i -= 1
        lst.insert(i, e)

    def set_prio(self, e, prio):
        """FUN_003caab8"""
        if e.prio != prio:
            self.insert(e, prio)

    # ------------------------------------------------------------------ corner colours (type 13)
    def lerp4(self, e, cols, px, py):
        """FUN_003d6a48: the colour at (px, py) of the element's box, bilinear between the four
        corner colours (0 top-left, 1 top-right, 2 bottom-left, 3 bottom-right)."""
        c0, c1, c2, c3 = cols
        h, w = e.rect[3], e.rect[2]
        def div(a, b):
            q = abs(a) // abs(b)
            return q if (a >= 0) == (b >= 0) else -q
        out = 0
        for sh in (0, 8, 16, 24):
            a0 = ((c0 >> sh) & 0xff) << 8; a2 = ((c2 >> sh) & 0xff) << 8
            a1 = ((c1 >> sh) & 0xff) << 8; a3 = ((c3 >> sh) & 0xff) << 8
            l = div((a2 - a0) * py, h) + a0
            r = div((a3 - a1) * py, h) + a1
            v = l + div((r - l) * px, w)
            out |= ((v >> 8) & 0xff) << sh
        return out

    def corners_init(self, e, cols):
        """FUN_003d6730: per sprite frame cell corner, the colour lerped at that point (the 9-cell
        sprite's corners). The export keeps only the element's +0x3c..+0x48 (the first 4 words)."""
        sid = e.sprite & 0xffff
        e.cw = [0] * 32
        if sid == 0xffff or self.elf.u32(self.sprite_rec(sid)) == 0:
            return
        fp = self.elf.u32(self.sprite_rec(sid))
        kb = self.kind_rec(sid)
        rows = self.i32(kb + 0x14); cols_n = self.i32(kb + 0x4)
        sc = self.i32(kb + 0x8); sr = self.i32(kb + 0x18)
        y = 0
        dy = 0
        for r in range(rows):
            x = 0
            for c in range(cols_n):
                fw = abs(self.s16(fp + (r * cols_n + c) * 8 + 4))
                if c == sc:
                    fw = max(e.box[2], 0)
                if r == sr:
                    dy = max(e.box[3], 0)
                else:
                    dy = abs(self.s16(fp + (r * cols_n + c) * 8 + 6))
                x2 = x + fw
                if self.s16(fp + (r * cols_n + c) * 8) >= 0:
                    i0 = r * (cols_n + 1) + c; i1 = (r + 1) * (cols_n + 1) + c
                    e.cw[i0] = self.lerp4(e, cols, x, y)
                    e.cw[i0 + 1] = self.lerp4(e, cols, x2, y)
                    e.cw[i1] = self.lerp4(e, cols, x, y + dy)
                    e.cw[i1 + 1] = self.lerp4(e, cols, x2, y + dy)
                x = S16(x2)
            y = S16(y + dy)

    def corner_set(self, e, cols, px, py, i):
        """FUN_003d6c38"""
        e.cw[i] = self.lerp4(e, cols, px, py)

    # ------------------------------------------------------------------ text (type 2)
    def text_set(self, e, s, fl, keep):
        """vtable +0xd4 = FUN_003d7218 -> FUN_003d03a0(e, s, fl, keep), then +0xdc = FUN_003d72e8."""
        if keep:
            e.text = s                          # +0x54 points at the caller's buffer
        else:
            e.text = bytes(s)                   # copied into +0x50 (t5c >= len) or a new block
        e.f3c = len(s) + 1
        if not (fl & 0x80):
            if e.text[:2] == b'$&':
                e.tflags |= 0x480
            else:
                e.tflags &= 0xfb7f
        else:
            e.tflags = (e.tflags & 0xfbff) | 0x80
        self.text_layout(e)

    def text_layout(self, e):
        """FUN_003d72e8 -> FUN_003cf2e0: +0x44 = the text width. flag 0x80 -> FUN_003d0058 (number font);
        else FUN_003cf338 (single-line ASCII only: the HUD's texts; '$' codes / wrapping raise)."""
        m = self.metrics
        s = bytes(e.text)
        if e.tflags & 0x80:
            if e.tflags & 0x400:
                s = s[2:]
            if not s:
                return
            x = mx = 0
            for c in s:
                if c > 2:
                    if e.tflags & 0x40:
                        w = 6
                    elif c < 0x62:
                        b = m[0x70 + (c - 3) // 2]
                        w = ((b & 0xf) if (c - 3) % 2 == 0 else (b >> 4)) + 1
                    else:
                        w = 0xc
                    w = S16(w << 4)
                    mx = max(mx, x + w)
                    x = S16(x + w + e.t65 * 0x10)
            e.t44 = ((mx + 0xf) if mx + 0xf >= 0 else (mx + 0x1e)) >> 4
            return
        e.tflags &= 0xfdff
        if not s:
            return
        x = mx = 0
        for c in s:
            if c == 0x24 or c < 0x20 or c >= 0x80:
                raise ValueError('FUN_003cf338: text code %#x not translated' % c)
            b = m[(c - 0x20) // 2]
            w = ((b & 0xf) if (c & 1) == 0 else (b >> 4)) + 1
            if e.tflags & 0x40:
                raise ValueError('FUN_003cf338: fixed-pitch text not translated')
            w = S16(w << 4)
            x = x + w + e.t65 * 0x10
            mx = max(mx, x)
        e.t44 = ((mx + 0xf) if mx + 0xf >= 0 else (mx + 0x1e)) >> 4

    @staticmethod
    def digits(v):
        """FUN_003cba90: decimal digits as codes 0x13.. (0x10 = minus)."""
        s = bytes([0x13 + int(ch) for ch in str(abs(v))])
        return (b'\x10' + s) if v < 0 else s

    def cur_max(self, a, b):
        """FUN_003cbb58: "a" 0x12 "b"."""
        return self.digits(a) + b'\x12' + self.digits(b)

    # ------------------------------------------------------------------ the layout byte code
    def run(self, a, parent, screen_rects=None):
        """FUN_003ca488 (+ FUN_003ca9d8 defaults, the constructors PTR_FUN_0047a6f0, FUN_003c8910,
        FUN_003caa90 / FUN_003cab20). `screen_rects` = the per-language rect list (none for lang 2)."""
        def defaults():
            return {'flags': 0, 'id': 0xff, 'rect': [0, 0, 0, 0], 'rgba': [0x80] * 4, 'sprite': -1,
                    'text': None, 'col': 0x80808080, 'tflags': 0, 't5c': 0, 't60': 0x7f, 't62': 0x7f,
                    't64': 0 if self.pal else 4, 'g42': 0, 'corners': [0x80808080] * 4}
        at = defaults()
        e = None
        while True:
            op = self.elf.u8(a)
            if op == 0xff:
                return e
            b = self.elf.read(a, self.oplen[op])
            if 1 <= op <= 0xd:
                if op not in VT_TYPE:
                    raise ValueError('layout op %d at %#x: element type not translated' % (op, a))
                e = El(op)
                e.parent = parent if parent is not None and parent is not self else None
                e.flags = at['flags']; e.id = at['id']
                e.rx, e.ry = at['rect'][0], at['rect'][1]
                e.rect = list(at['rect'])
                if e.parent is not None:                        # FUN_003c8910: + the parent's x, y
                    e.rect[0] = S16(e.rect[0] + e.parent.rect[0]); e.rect[1] = S16(e.rect[1] + e.parent.rect[1])
                e.box = [0, 0, 0, 0]
                e.rgba = list(at['rgba']); e.sprite = at['sprite']
                self.box(e)                                     # FUN_003ca160
                if op == 1:                                     # FUN_003d59b0
                    e.g3c = 0; e.g3d = 0; e.g3f = 1 if at['g42'] & 1 else 0
                    e.anim = [0, 0, e.rect[0], e.rect[1], 0, 0, 0]   # FUN_003d5ce8 -> FUN_003d0d38
                if op == 2:                                     # FUN_003cbe68 -> FUN_003cbf18 / FUN_003d72e8
                    e.col58 = at['col']; e.col4c = at['col']; e.tflags = at['tflags']
                    e.t5c = at['t5c']; e.t60 = at['t60']; e.t62 = at['t62']; e.t64 = at['t64']
                    e.t65 = 0 if self.pal else 1
                    e.t44 = 0; e.text = b''
                    if at['text']:
                        self.text_set(e, self.c_string(at['text']), 0, 1)
                    else:
                        self.text_layout(e)
                if op == 13:                                    # FUN_003d5e60 -> FUN_003d6730
                    self.corners_init(e, at['corners'])
                if op == 10:                                    # FUN_003db608 -> FUN_003db7b0(e, 0, 0)
                    e.p3c = 0; e.b40 = 0
                if op == 7:                                     # FUN_003d6ce0
                    e.p3c = 0
                prio = (parent.prio if isinstance(parent, El) else 0)
                if e.parent is not None:
                    self.insert(e, prio)                        # FUN_003caa90 -> FUN_003cab20(e, parent +5)
                else:
                    self.insert(e, 0)
                at = defaults()
                a += self.oplen[op]
                if op == 1:
                    self.run(a, e)
                    return e
                continue
            if op == 0xe:
                at['rect'] = list(struct.unpack('<4h', b[1:9]))
            elif op == 0xf:
                at['rgba'] = list(b[1:5])
            elif op == 0x10:
                at['text'] = struct.unpack('<I', b[1:5])[0]
            elif op == 0x21:
                at['text'] = self.elf.u32(self.elf.u32(0x47a6ac) + 4 * b[1])
            elif op == 0x12:
                at['col'] = struct.unpack('<I', b[1:5])[0]
            elif op == 0x14:
                at['tflags'] = struct.unpack('<H', b[1:3])[0]
            elif op == 0x15:
                at['t64'] = b[1]
            elif op == 0x16:
                at['id'] = b[1]
            elif op == 0x17:
                at['sprite'] = struct.unpack('<h', b[1:3])[0]
            elif op == 0x1e:
                at['t60'], at['t62'] = struct.unpack('<hh', b[1:5])
            elif op == 0x1f:
                at['g42'] = b[1]
            elif op == 0x20:
                at['corners'] = list(struct.unpack('<4I', b[1:17]))
            a += self.oplen[op]

    def c_string(self, a):
        out = bytearray()
        while self.elf.u8(a):
            out.append(self.elf.u8(a)); a += 1
        return bytes(out)

    # ------------------------------------------------------------------ FUN_003ad618
    def slot(self, i):
        return self.slots[i]

    def construct(self, metrics):
        """FUN_003ad618 (the HUD constructor), in its order."""
        self.metrics = metrics
        H = self.H
        H[0x538] = 0
        # FUN_003d41e0(HUD, 0x4717e8, 0xff, 0xff, -1, 0): the root group (HUD +0x18)
        self.root = self.run(HUD_SCRIPT_ROOT, None)
        # FUN_003d43f8 / FUN_003d4478 (slot, script); slots 5 / 6 take a per-language rect list
        # (0x51fb40 / 0x51fb60, filled at boot): none for language 2 (FUN_003ca488 then reads the script's)
        from_tables = [(0, 0x4718d8), (2, 0x471938), (8, 0x471970), (9, 0x471c18), (10, 0x471c50),
                       (1, 0x471898), (3, 0x471910), (4, 0x471810), (5, 0x471390), (6, 0x4714d0), (7, 0x471760)]
        if self.lang not in (0, 1, 2) and self.lang <= 6:
            raise ValueError('language %d: per-language HUD rects (0x51fb40 / 0x51fb60) not decoded' % self.lang)
        for i, a in from_tables:
            self.slots[i] = self.run(a, None)
        # FUN_003d58b8: bilinear (+2 bit 3) on lists 0x471e18 / 20 / 28 when FUN_002413c0(0x1e)
        if self.bilinear:
            for s, lst in ((5, 0x471e18), (6, 0x471e20), (4, 0x471e28)):
                for ident in self.bytelist(lst, 0xff):
                    x = self.find(self.slots[s], ident); x.flags |= 8
        # FUN_003adeb0: type-10 elements of slot 5 (list 0x471e30) -> FUN_003db7b0(e, HUD+0x2d0+0x10k, 2)
        for k, ident in enumerate(self.bytelist(0x471e30, 0)):
            x = self.find(self.slots[5], ident); x.p3c = ('HUD', 0x2d0 + 0x10 * k); x.b40 = 2
        # FUN_003caab8: priorities -0x32 (root, slots 1, 3-10) / -0x37 (slots 0, 2)
        self.set_prio(self.root, -0x32)
        for i in range(11):
            if self.slots[i] is not None:
                self.set_prio(self.slots[i], -0x37 if i in (0, 2) else -0x32)
        if self.pal:                            # FUN_003e2760: slot 8 and its 0x53 widened by 0x34
            g = self.slots[8]
            self.resize(g, S16(g.rect[2] + 0x34), g.rect[3])
            c = self.find(g, 0x53)
            self.resize(c, S16(c.rect[2] + 0x34), c.rect[3])
            if self.lang == 4:
                self.find(self.slots[6], 0x2a).sprite = 0x114
        # the text buffers (DAT_00471e08 pairs (slot, id); FUN_003cc018(e, 0x4efba8 + 0x20 k, 0x20))
        a = 0x471e08; k = 0
        while True:
            s, ident = self.elf.u8(a), self.elf.u8(a + 1)
            e = self.find(self.root if s == 0xff else self.slots[s], ident)
            e.text = b''; e.f3c = 1; e.t5c = 0x20; e.f3e = 0
            k += 1
            if self.elf.u8(a + 3) == 0:
                break
            a += 2
        H[100] = [0, 0, 0, 0, 0]                # +100 cur, +0x66 max (the rest: GUESS 0, the allocation's contents)
        # FUN_002419d8(0) (DAT_004b8ac8 bit 0) is clear: no slot-5 0x05 shift
        H[0x70] = [0, 0, 0, 0, 0]; H[0x2ce] = 1; H[0x2cc] = 1
        H[0x2ca] = 0                            # FUN_003ae028(HUD, 0)
        H[0x2c8] = 0; H[0x2c9] = 0; H[0x2c0] = 0; H[0x2c4] = 0x808080
        self.limit_colour(0, 1)                 # FUN_003ae418(HUD, 0, 1)
        self.find(self.slots[2], 0x51).tflags |= 0x80          # FUN_003b2600
        # FUN_003b33d0: slot 9 0x75 / slot 10 0x78 flag 0x4000, then FUN_003b45c8 (the item list)
        self.find(self.slots[9], 0x75).tflags |= 0x4000
        self.find(self.slots[10], 0x78).tflags |= 0x4000
        g = self.slots[8]
        H[0x564] = 0; H[0x574] = S16(g.rect[1] + g.rect[3]); H[0x572] = 0; H[0x570] = g.rect[3]
        lst = self.bytelist(0x472910, 0xff)
        for s in (8, 9, 10):                    # FUN_003d5698(.., 0x472910, 0): alpha 0
            for ident in lst:
                self.find(self.slots[s], ident).rgba[3] = 0
        g.g3c |= 1                              # FUN_003d5be8(slot 8, 1, 1)
        self.list_state(0)                      # FUN_003b4720(HUD, 0)
        # FUN_003b4aa8: the CHAIN gauge (HUD +0xbbc) and sprites -1 on list 0x472940 (DAT_004b8ac8 bit 0 clear)
        H[0xbb4] = 0; H[0xbb0] = 0; H[3000] = 0
        self.gauge_set(0xbbc, 0, 1)
        H[0xbbc][1] = 1000
        for ident in self.bytelist(0x472940, 0xff):
            self.find(self.slots[4], ident).sprite = -1
        # FUN_003daec8(slot 6: 0x1e, 0x1f, HUD+0x94, 0x26, 0x27, 0x28)
        s6 = self.slots[6]
        e1e, e1f = self.find(s6, 0x1e), self.find(s6, 0x1f)
        w = S16(e1e.rect[2] + e1f.rect[2])
        H[0x94] = [w, e1e.rect[3], S16(e1f.rx + e1f.rect[2] - (w + ((w >> 15) & 1) >> 1)), e1e.ry,
                   e1e.cw[0], e1e.cw[1], e1e.cw[2], e1e.cw[3]]
        for ident in (0x1e, 0x1f, 0x26, 0x27, 0x28):
            self.hide(self.find(s6, ident), 1)
        black = [0, 0, 0, 0]                    # 0x47d270: four zero words
        for e in (e1e, e1f):
            for i in range(4):
                self.corner_set(e, black, 0, 0, i)
        self.weapon(0, 0, -1)                   # FUN_003ae030(HUD, 0, 0, -1)
        self.ammo(0, 0, 0)                      # FUN_003ae138(HUD, 0, 0, 0)
        self.item(0x69300000, 9)                # FUN_003ae308(HUD, 0x69300000, 9)
        # FUN_003b2e30: list 0x472818 (slot 6) alpha 0
        H[0x53c] = 0xff
        for k in range(5):
            self.find(s6, self.elf.u8(0x472818 + k)).rgba[3] = 0
        H[0x530] = 0
        # FUN_003af7f0: slot 7 0x3d text = HUD+0xb4 (""), panel 2 hidden
        H[0xac] = 0; H[0xb0] = -1; H[0xb4] = 0
        self.text_set(self.find(self.slots[7], 0x3d), b'', 0, 1)
        self.panel_hide(2, 1)
        # FUN_003b52c8: slot 4 0x45 text = HUD+0xbd8 (""), 0xbc8 = slot 4 0x44 y, the gauge at +0x88
        self.text_set(self.find(self.slots[4], 0x45), b'', 0, 1)
        H[0xc59] = 0; H[0xc58] = 0
        H[0xbc8] = self.find(self.slots[4], 0x44).rect[1]
        self.gauge_set(0x88, 1, 0); H[0x88][1] = 1
        self.all_hide(1)                        # FUN_003afb10(HUD, 1)
        for p in (4, 5, 6):
            self.panel_hide(p, 1)
        self.input_off = True                   # FUN_003d4720(HUD, 1)

    # ------------------------------------------------------------------ HUD helpers (translations)
    def panel_group(self, p):
        s = self.elf.u8(0x471db0 + p)
        return self.root if s == 0xff else self.slots[s]

    def panel_hide(self, p, on):
        """FUN_003afbf8: hide / show the ids of list PTR_DAT_00471d80[p] in panel p's slot."""
        g = self.panel_group(p)
        a = self.elf.u32(0x471d80 + 4 * p)
        for ident in self.bytelist(a, 0):
            self.hide(self.find(g, ident), on)

    def all_hide(self, on):
        """FUN_003afb10"""
        self.hide(self.root, on)                # FUN_003d46a8
        for p in (7, 8, 9, 10, 0):
            self.panel_hide(p, on)
        if self.cut_ok or on:                   # FUN_003e20e0
            self.panel_hide(1, on)
        self.panel_hide(3, on)
        self.mp_icons()                         # FUN_003adf28
        self.ammo_vis()                         # FUN_003ae220

    def gauge_set(self, off, v, lag):
        """FUN_003aec10 on the gauge at HUD+off: [cur, max, from, shown, timer]."""
        g = self.H.setdefault(off, [0, 0, 0, 0, 0])
        if lag == 0:
            g[2] = v
        elif g[1] != 0:
            g[2] = g[3]; g[4] = (self.clock + 1000) & 0xffffffff; g[0] = v
            return
        else:
            g[2] = v
        g[3] = v; g[4] = 0; g[0] = v

    def gauge_tick(self, off):
        """FUN_003aec78"""
        g = self.H[off]
        if g[4] != 0:
            if g[4] < self.clock:
                g[4] = 0; g[3] = g[0]; g[2] = g[0]
            else:
                g[3] = S16(g[2] - int((g[2] - g[0]) * (self.clock + 1000 - g[4]) / 1000))

    def limit_colour(self, lv, sub):
        """FUN_003ae418(HUD, lv, sub): the limit gauge colours (slot 5 ids 7 / 8 and list 0x471e30)."""
        H = self.H
        if lv > 6:
            return
        H[0x2c4] = self.elf.u32(0x471e38 + 4 * H[0x2c8])
        H[0x2c0] = (self.clock + 100) & 0xffffffff
        s5 = self.slots[5]
        if lv != 0:                             # FUN_002419d8(0) clear
            self.find(s5, 7).rgba[3] = 0x80
            e8 = self.find(s5, 8); e8.rgba[3] = 0x80; e8.sprite = self.s16(0x471ec0 + 2 * sub)
        else:
            self.find(s5, 7).rgba[3] = 0
            self.find(s5, 8).rgba[3] = 0
        H[0x2c8] = lv; H[0x2c9] = sub
        for k, ident in enumerate(self.bytelist(0x471e30, 0)):
            e = self.find(s5, ident)
            c = self.elf.read(0x471e60 + self.elf.u8(0x471e58 + k) * 4 + lv * 0xc, 4)
            e.rgba = list(c)

    def list_state(self, length):
        """FUN_003b4720(HUD, len): the item list closes (state 3)."""
        if self.H.get(0x564) != 3:
            self.H[0x564] = 3; self.H[0x565] = length; self.H[0x56c] = self.clock

    def mp_icons(self):
        """FUN_003adf28: slot 5 ids 0xb-0x10 hidden unless panel 0 shows and HUD+0x2cb."""
        g = self.panel_group(0)
        first = self.elf.u8(self.elf.u32(0x471d80))
        off = (self.find(g, first).flags & 1) != 0 or self.H.get(0x2cb, 0) == 0
        for ident in range(0xb, 0x11):
            self.hide(self.find(self.slots[5], ident), off)

    def ammo_vis(self):
        """FUN_003ae220"""
        if not self.cut_ok:
            return
        g = self.panel_group(1)
        first = self.elf.u8(self.elf.u32(0x471d84))
        hid = self.find(g, first).flags & 1
        e19, e20 = self.find(self.slots[6], 0x19), self.find(self.slots[6], 0x20)
        if not hid:
            if not e19.text:
                self.hide(e19, 1); self.hide(e20, 0)
            else:
                self.hide(e19, 0); self.hide(e20, 1)
        else:
            self.hide(e19, hid); self.hide(e20, hid)

    def weapon(self, a, b, sel):
        """FUN_003ae030 -> FUN_003db080: the weapon icon pair (slot 6 0x1e / 0x1f) and the three
        selector marks 0x26-0x28; the 11th argument = slot 6 0x16 hidden."""
        s6 = self.slots[6]
        e1e, e1f = self.find(s6, 0x1e), self.find(s6, 0x1f)
        m = [self.find(s6, i) for i in (0x26, 0x27, 0x28)]
        hidden = self.find(s6, 0x16).flags & 1
        P = self.H[0x94]
        w0 = h0 = w1 = h1 = 0
        r0 = (0x47d232 + 6 * a) if a >= 1 else None
        r1 = (0x47d252 + 6 * b) if b >= 1 else None
        if r0:
            fp = self.elf.u32(self.sprite_rec(self.u16(r0)))
            w0, h0 = (self.s16(fp + 4), self.s16(fp + 6)) if fp else (0, 0)
        if r1:
            fp = self.elf.u32(self.sprite_rec(self.u16(r1)))
            w1, h1 = (self.s16(fp + 4), self.s16(fp + 6)) if fp else (0, 0)
        cols = P[4:8]
        black = [0, 0, 0, 0]
        def div2(v):
            return int(v / 2)
        for e, r, ww, hh, dx in ((e1e, r0, w0, h0, 0), (e1f, r1, w1, h1, w0)):
            if r is None:
                for i in range(4):
                    self.corner_set(e, black, 0, 0, i)
                self.hide(e, 1)
                continue
            e.rx = S16(self.s16(r + 2) + dx + (P[2] - div2(w0 + w1)))
            e.ry = S16(self.s16(r + 4) + (P[3] + P[1] - h0))      # both use the first icon's height
            e.rect[0] = S16(s6.rect[0] + e.rx); e.rect[1] = S16(s6.rect[1] + e.ry)
            e.rect[2] = P[0]; e.rect[3] = P[1]
            self.corner_set(e, cols, 0, 0, 0)
            self.corner_set(e, cols, ww, 0, 1)
            self.corner_set(e, cols, 0, hh, 2)
            self.corner_set(e, cols, ww, hh, 3)
            self.set_sprite(e, self.u16(r))
            if not hidden:
                self.hide(e, 0)
        if sel < 0:
            for x in m:
                self.hide(x, 1)
        else:
            if sel < 3:
                for x in m:
                    x.rgba[3] = 0x30
                m[sel].rgba[3] = 0x70
            else:
                for x in m:
                    x.rgba[3] = 0
            if not hidden:
                for x in m:
                    self.hide(x, 0)

    def ammo(self, a, b, c):
        """FUN_003ae138: slot 6 0x1a = "a/b" (b < 0: a fixed dash text), 0x19 = c (c < 0: empty)."""
        s6 = self.slots[6]
        t = bytes([0x10, 0x10, 0x12, 0x10, 0x10]) if b < 0 else self.cur_max(a, b)
        self.text_set(self.find(s6, 0x1a), t, 0x80, 0)
        self.text_set(self.find(s6, 0x19), b'' if c < 0 else self.digits(c), 0x80, 0)
        self.ammo_vis()

    def item(self, ident, count):
        """FUN_003ae308: slot 6 0x1b = the item's name (FUN_003fd690), 0x1c = the count."""
        s6 = self.slots[6]
        name = b'' if ident == -1 else self.item_name(ident)
        self.text_set(self.find(s6, 0x1b), name, 0, 0)
        self.text_set(self.find(s6, 0x1c), self.digits(count) if count >= 1 else b'\x10', 0x80, 0)

    def item_name(self, ident):
        """FUN_003fd690 -> FUN_003fd5e8(id, 0) on kelstr (the id table at +0x24); else message 6."""
        d = self.kelstr
        T = struct.unpack_from('<I', d, 0x24)[0] + 0x24      # relocated pointer (file offset + 0x24)
        u = lambda o: struct.unpack_from('<H', d, T + o)[0]
        n = u(0) + u(2) * 0x10000
        k = 2
        for _ in range(n):
            if (ident >> 16) == u(2 * k + 2):
                if (ident & 0xffff) < u(2 * k):
                    off = struct.unpack_from('<H', d, T + (ident & 0xffff) * 4 + (u(2 * k + 4) & 0xfffe))[0]
                    s = T + off
                    return d[s:d.index(b'\0', s)]
                break
            k += 4
        return self.message(6)

    def message(self, mid):
        return P.kelstr_message(self.kelstr, mid)

    # ------------------------------------------------------------------ export (export_web_hud's chain format)
    def chain(self):
        out = []
        slot_of = {id(self.slots[i]): i for i in range(11) if self.slots[i] is not None}

        def elem(e, depth):
            d = {'id': e.id, 'type': VT_TYPE[e.op], 'depth': depth, 'flags': e.flags,
                 'rect': list(e.rect), 'box': list(e.box), 'rgba': list(e.rgba), 'sprite': e.sprite,
                 'rel': [e.rx, e.ry]}                   # +0x1c / +0x1e: the position in the parent (FUN_003cb380)
            if e.op == 1:
                d['g3c'] = e.g3c; d['g3d'] = e.g3d
                if depth == 0:                          # +0x48 slide state (FUN_003d0d50; worker 0203)
                    d['slide'] = [e.anim[0], e.anim[1], e.anim[2], e.anim[3], e.anim[4], e.anim[5], e.anim[6]]
            if e.op == 13:
                d['corners'] = [list(struct.pack('<I', e.cw[i])) for i in range(4)]
            if e.op == 2:
                d.update(text=list(e.text), tflags=e.tflags, t5c=e.t5c, t60=e.t60, t62=e.t62, t64=e.t64,
                         t65=e.t65, t44=e.t44, col4c=list(struct.pack('<I', e.col4c)),
                         col58=list(struct.pack('<I', e.col58)))
            return d

        def walk(e, depth):
            d = elem(e, depth)
            if depth == 0:
                d['slot'] = 'root' if e is self.root else slot_of[id(e)]
            out.append(d)
            for c in e.children:
                walk(c, depth + 1)

        start = self.top.index(self.root)
        for g in self.top[start:]:              # the root's sibling chain (the draw list)
            walk(g, 0)
        return out

    # ------------------------------------------------------------------ slides (group +0x48, FUN_003d0d38 family)
    def slide_in(self, p):
        """FUN_003afcf8: unless the screen root is hidden (FUN_003d46d0), FUN_003d5d68 (FUN_003d0f08 ->
        FUN_003d5d10) with DAT_00471dc0[p] = (length / 100 ms, dx, dy), then show list p."""
        if self.root.flags & 1:
            return
        g = self.panel_group(p)
        an = g.anim
        if an[0] - 1 & 0xff >= 2:               # FUN_003d0f08: not already in (1) / at (2)
            ln = self.elf.u8(0x471dc0 + 6 * p)
            if an[0] == 3:
                t = an[6] + ln * 100
                an[6] = self.clock if t < self.clock else (self.clock * 2 - t) & 0xffffffff
            else:
                an[6] = self.clock
            an[0] = 1; an[1] = ln
            an[4] = self.s16(0x471dc0 + 6 * p + 2); an[5] = self.s16(0x471dc0 + 6 * p + 4)
            self.slide_step(g)
        self.panel_hide(p, 0)

    def slide_out(self, p):
        """FUN_003afc98 -> FUN_003d5da0 (FUN_003d0fd0 -> FUN_003d5d10)."""
        g = self.panel_group(p)
        an = g.anim
        if an[0] - 3 & 0xff >= 2:
            ln = self.elf.u8(0x471dc0 + 6 * p)
            if an[0] == 1:
                t = an[6] + ln * 100
                an[6] = self.clock if t < self.clock else (self.clock * 2 - t) & 0xffffffff
            else:
                an[6] = self.clock
            an[0] = 3; an[1] = ln
            an[4] = self.s16(0x471dc0 + 6 * p + 2); an[5] = self.s16(0x471dc0 + 6 * p + 4)
            self.slide_step(g)

    def slide_step(self, g):
        """FUN_003d5d10 -> FUN_003d0d50 (position on the sine ease; at the end state 2 / 4)."""
        an = g.anim
        if an[6] == 0:
            return
        T = an[1] * 100
        if self.clock < an[6] + T:
            t = self.clock - an[6]
            if an[0] == 1:
                t = T - t
            q = int((t << 11) / T) + 0xc00
            ang = (((q * 0x100000) & 0xffffffff) ^ 0x80000000) - 0x80000000 >> 0x14   # 12-bit angle, signed
            # FUN_0045b530 = sinf (f32 rounding not modelled: mid-slide only, the build settles every slide)
            f = math.sin(ang * 0.0015339808)
            half = lambda v: (v + ((v & 0xffff) >> 15)) >> 1
            x = S16(an[2] + int(half(S16(an[4])) * (f + 1.0)))
            y = S16(an[3] + int(half(S16(an[5])) * (f + 1.0)))
        else:
            if an[0] == 1:
                an[0] = 2; x, y = an[2], an[3]
            elif an[0] == 3:
                an[0] = 4; x, y = S16(an[2] + an[4]), S16(an[3] + an[5])
            else:
                an[6] = 0
                return
            an[6] = 0
        self.move(g, x, y, 0)

    # ------------------------------------------------------------------ show / hide (FUN_003b01b0)
    def show(self):
        """FUN_003ad560: FUN_003afb10(HUD, 0), FUN_003b01b0(HUD, 1) -> FUN_003b0128."""
        self.all_hide(0)
        self.slide_in(0); self.mp_icons()                      # FUN_003affe0
        if self.cut_ok:                                        # FUN_003b0010
            self.slide_in(1)
        self.ammo_vis()
        if self.H.get(0xac, 0):                                # FUN_003b0050
            self.slide_in(2)
        if self.H.get(0xc59) == 1:                             # FUN_003b0098 -> FUN_003b5378
            raise ValueError('FUN_003b5378 (panel 4 shown) not translated')
        for p in (8, 9, 10):                                   # FUN_003b00c8
            self.slide_in(p)

    def hide_all(self):
        """FUN_003ad5b0: FUN_003b01b0(HUD, 0) -> FUN_003aff20 (slides out; the lists stay shown)."""
        self.slide_out(0)                                      # FUN_003afe10
        self.slide_out(1); self.H[0xd8] = 1                    # FUN_003afe30
        if self.H.get(0xac, 0):                                # FUN_003afe60
            self.slide_out(2); self.H[0xdc] = 1
        if self.H.get(0xc59) == 1:                             # FUN_003afec0
            self.slide_out(4)
        for p in (8, 9, 10, 5):
            self.slide_out(p)
        if self.H.get(0x564, 0) != 0:                          # FUN_003b4768
            self.list_state(2)
            self.text_set(self.find(self.slots[8], 0x72), b'', 0, 0)
            self.H[0x568] = 0
        # FUN_003b03e8: the reticle kinds 4-7 hide (not the tree)

    # ------------------------------------------------------------------ per frame (FUN_003add28 parts that touch the tree)
    def frame(self):
        H = self.H
        # FUN_003ae5d8: the limit gauge colour (slot 5 0x11) fades to DAT_00471e38[HUD+0x2c8] over 100 ms
        e = self.find(self.slots[5], 0x11)
        if H[0x2c0] != 0:
            if self.clock < H[0x2c0]:
                raise ValueError('FUN_003ae5d8 mid-fade not translated (settle the clock first)')
            e.rgba = list(self.elf.read(0x471e38 + 4 * H[0x2c8], 4)); H[0x2c0] = 0
        if H[0x2c9] != 0 or H.get(0x2cb, 0):
            raise ValueError('FUN_003ae5d8 pulses (HUD+0x2c9 / +0x2cb) not translated')
        self.list_frame()                                      # FUN_003b41d8 -> FUN_003b48b0
        for g in [self.root] + [s for s in self.slots if s is not None]:
            if g.anim[6]:
                self.slide_step(g)
        for off in (100, 0x70, 0xbbc):                         # the gauges' drains (FUN_003aec78)
            self.gauge_tick(off)

    def list_frame(self):
        """FUN_003b48b0: the item list's open / close (HUD +0x564 state, +0x570 height, +0x574 bottom)."""
        H = self.H
        if H.get(0x56c, 0) == 0:
            return
        g = self.slots[8]
        due = H[0x565] * 100 + H[0x56c]
        if self.clock < due:
            raise ValueError('FUN_003b48b0 mid-animation not translated (settle the clock first)')
        st = H[0x564]
        H[0x56c] = self.clock
        if st == 2:
            if H.get(0x567, 0) == 0:
                H[0x564] = 3
            else:
                H[0x56c] = 0
            H[0x565] = 2
        elif st == 1:
            H[0x564] = 2; H[0x565] = H[0x566]
        elif st == 3:
            H[0x564] = 0; H[0x56c] = 0
        t = H[0x565] * 100
        st = H[0x564]
        H[0x572] = g.rect[3]
        if st == 1:
            g.rgba[3] = 0x80
            H[0x572] = S16(H[0x570] - int(H[0x570] * t / (H[0x565] * 100)))
        elif st == 0:
            H[0x572] = 0
        elif st == 2:
            H[0x572] = H[0x570]
        elif st == 3:
            H[0x572] = S16(int(H[0x570] * t / (H[0x565] * 100)))
        g.sprite = 0xe
        self.move(g, g.rect[0], S16(H[0x574] - H[0x572]), 0)
        g.anim[3] = g.rect[1]                                  # FUN_003d5df8
        self.resize(g, g.rect[2], H[0x572])
        if g.box[3] == 0:
            g.rgba[3] = 0; g.rect[3] = 0; H[0x572] = 0; g.sprite = -1

    # ------------------------------------------------------------------ the status sync (FUN_00339988 / FUN_00339590)
    def status(self, st):
        """The HUD setters the status sync calls, with the start-of-stage values `st`."""
        a, b, sel = st['weapon']
        self.weapon(a, b, sel)                                 # FUN_003ae030
        self.ammo(*st['ammo'])                                 # FUN_003ae138
        cur, mx = st['hp']                                     # FUN_003adda8 (lag on)
        self.gauge_set(100, cur, 1); self.H[100][1] = mx
        self.text_set(self.find(self.slots[5], 5), self.cur_max(self.H[100][0], mx), 0x80, 0)   # FUN_003aed00
        self.item(*st['item'])                                 # FUN_003ae308
        self.limit_colour(*st['limit'])                        # FUN_003ae418
        mp, mpmax, need, cap = st['mp']                        # FUN_003addf8 (lag on)
        self.gauge_set(0x70, mp, 1); self.H[0x2cc] = need; self.H[0x70][1] = mpmax
        self.H[0x2ce] = cap
        self.H[0x2cb] = 0 if self.H[0x70][0] < self.H[0x2cc] else 1
        self.mp_icons()
        self.H[0x2ca] = st['ae028']                            # FUN_003ae028
        self.chain_count(st['chain'])                          # FUN_003b4e08

    def chain_count(self, n):
        """FUN_003b4e08 (HUD +3000 = the chain count; gauge 0xbbc = min(n, 10) x 100) -> FUN_003b5180.
        Its FUN_00321290 call (outside the HUD) is not ported."""
        H = self.H
        H[3000] = min(n, 99)
        self.gauge_set(0xbbc, S16(min(H[3000], 10) * 100), 1)
        if H[3000] < 5:
            sp, co = 0x472968, 0x472980
        else:
            sp, co = 0x472970, 0x472990
        for k, ident in enumerate(self.bytelist(0x472960, 0xff)):
            self.find(self.slots[6], ident).sprite = self.s16(sp + 2 * k)
        for k, ident in enumerate(self.bytelist(0x472978, 0xff)):
            e = self.find(self.slots[6], ident)
            c = self.elf.read(co + 4 * k, 3)
            e.rgba[0], e.rgba[1], e.rgba[2] = c[0], c[1], c[2]

    # ------------------------------------------------------------------ one drawn frame's writes into the tree
    @staticmethod
    def pulse(t0, half, a, b, now):
        """FUN_003d0ad0"""
        a &= 0xff; b &= 0xff
        if t0 == 0:
            return b
        t = (now - t0) % (half * 2)
        d = abs(b - a)
        if half <= t:
            t = half * 2 - t
        t = (t * (d & 0xff) // half) & 0xff
        return (a + t) & 0xff if a < b else (a - t) & 0xff

    def draw_writes(self):
        """What one draw of the HUD writes back (the save holds the last drawn frame's): the CHAIN
        callbacks (slot 6 0x2e / 0x32 -> FUN_003b4fa0: the glow alpha on lists 0x472948 / 0x472950 /
        0x472958) and FUN_003cc208's 'all drawn' flag 0x200 on a plain text (FUN_003d7040 -> FUN_003cc0a8,
        +0x5c != 0, no 0x80)."""
        H = self.H
        def walk(e):
            if e.flags & 1:
                return
            if e.op == 7 and e.parent is self.slots[6] and e.id in (0x2e, 0x32):
                self.gauge_tick(0xbbc)
                g = H[0xbbc]
                s6 = self.slots[6]
                if g[0] == 0 and H[0xbb4] == 0:
                    for lst, v in ((0x472948, 0x80), (0x472950, 0), (0x472958, 0x80)):
                        for ident in self.bytelist(lst, 0xff):
                            self.find(s6, ident).rgba[3] = v
                else:
                    half = 200 - int(g[0] * 0x96 / g[1])
                    v = self.pulse(1, half, 0x40, 0xc0, self.clock)
                    for lst, x in ((0x472948, v), (0x472958, 0)):
                        for ident in self.bytelist(lst, 0xff):
                            self.find(s6, ident).rgba[3] = x
                    # FUN_003d10a8(0xec / 0xee / 0xf2 / 0xf3, v): sprite-record corner alpha (hud_core does it per frame)
            if e.op == 2 and e.text and e.t5c != 0 and not (e.tflags & 0x80):
                e.tflags |= 0x200
            for c in e.children:
                walk(c)
        for g in self.top[self.top.index(self.root):]:
            walk(g)


# Vincent's status and the session clocks at the page's start. NOT decoded from the stage start: these
# are the sea-of-flames save's values, hand-written (the page starts there; play.js hard-codes his HP 780
# the same way). fidelity-audit 'HUD start values'. The setters they feed are translated above.
START = {
    # the stage-start sync FUN_00339988 passes sel = -1; sel = 1 is the per-frame sync FUN_00339590's (it ran)
    'weapon': (1, 1, 1),        # FUN_003ae030(a, b, sel): W+0x14 bits 2-4 / 5-6, FUN_00317c48 (Cerberus, mark 1)
    'ammo': (18, 18, 180),      # FUN_003ae138: FUN_00317240, W+0x48, FUN_00317328
    'hp': (780, 780),           # FUN_003adda8: P+0x20, P+4
    'item': (0x69300000, 2),    # FUN_003ae308: the selected item (item id 0x69300000) and its count
    'limit': (0, 0),            # FUN_003ae418: FUN_00317bc8, FUN_00317c08 - 1 (clamped 0-2)
    'mp': (0, 100, 10, 100),    # FUN_003addf8: P+0x24, P+8, FUN_00317878, FUN_00317908
    'ae028': 0,                 # FUN_003ae028 (FUN_00318c98 / FUN_003179a0)
    # chain, ammo, items: progress state of this one save session (FUN_003b4ea8 resets the chain to 0, so a
    # fresh stage start most likely shows 0; per-stage start data on the disc not checked). 2 = the save's.
    'chain': 2,                 # FUN_003b4e08: the chain count (HUD +3000)
    # arbitrary session values (ms since boot / frames drawn), chosen to match the save's phases:
    'clock': 232753,            # DAT_004f58ec (the CHAIN glow's phase)
    'ring_frame': 1304,         # HUD +0x234 (frames since FUN_003af580; the ring arrow's blink phase)
}
BUILD_CLOCK = 1000              # GUESS: the clock when the HUD is built (only != 0 and < START clock matters)


def disc_tree(elf, locale, metrics, start=START):
    """The HUD tree and values from the ELF + locale files alone (no save state): FUN_003ad618, then the
    status sync (FUN_00339988 / FUN_00339590 -> the setters) with `start`, a hide (FUN_003ad5b0) and a show
    (FUN_003ad560), every slide / fade / list animation run to its end, and one draw's writes at the start
    clock. GUESS (fidelity-audit 'HUD start sequence'): the hide -> show pair is read from the save
    (slot 1 in slide state 4), its caller is not traced; it moves only hidden panel 5."""
    S = Setup(elf, lang=2, clock=BUILD_CLOCK, bilinear=True)
    S.cut_ok = True                     # FUN_003e20e0: DAT_0046f850 +0x1558 bits 47-48 = 0 (no movie)
    S.kelstr = P.kelstr_decode(open(os.path.join(locale, 'kelstr.bin'), 'rb').read(), P.kelstr_keys(elf))
    S.construct(metrics)
    S.status(start)
    S.clock += 5000; S.frame()
    S.hide_all(); S.clock += 5000; S.frame()
    S.show(); S.clock += 5000; S.frame()
    if S.clock >= start['clock']:
        raise ValueError('start clock too small')
    S.clock = start['clock']; S.frame()
    S.draw_writes()
    H = S.H
    values = {'hp': list(H[100]), 'mp': list(H[0x70]), 'mp_cap': H[0x2ce], 'chain': list(H[0xbbc]),
              'chain_bb4': H[0xbb4], 'h26': 0x1c0, 'clock': start['clock'],      # +0x26 / fade: FUN_003d5090
              'fade': [100, 100],
              # the ring (FUN_003af580: on, timers 0; FUN_003b0370: kind 5 phase / end / length 0)
              'ring': {'on': 1, 'f234': start['ring_frame'], 'timers': [0] * 8, 'phase': 0, 'end': 0, 'len': 0}}
    return S.chain(), values


def compare(chain_s, values_s, chain_d, values_d):
    """--state: the save's tree vs the disc build, field by field. Returns the number of differences."""
    n = 0
    hud = len(chain_d)
    for i, (a, b) in enumerate(zip(chain_s[:hud], chain_d)):
        for k in sorted(set(a) | set(b)):
            if a.get(k) != b.get(k):
                n += 1
                print('  element %d (id %d): %s save %s disc %s' % (i, a['id'], k, a.get(k), b.get(k)))
    for k in sorted(set(values_s) | set(values_d)):
        if values_s.get(k) != values_d.get(k):
            n += 1
            print('  values.%s: save %s disc %s' % (k, values_s.get(k), values_d.get(k)))
    rest = chain_s[hud:]
    print('save vs disc build: %d HUD elements, %d differences; the save has %d more elements after slot 10 '
          '(other screens on the same root list, not built by the HUD; none draws)' % (hud, n, len(rest)))
    return n


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
             'sprite': s16(e + 0x1a),
             'rel': [s16(e + 0x1c), s16(e + 0x1e)]}             # position in the parent (FUN_003cb380)
        if d['type'] == 1:                                      # FUN_003d5ac0: +0x3c bit 0 = clip children to the box
            d['g3c'] = mem[e + 0x3c]; d['g3d'] = mem[e + 0x3d]
            if depth == 0:                                      # +0x48 slide state: state, length / 100 ms, base x y, dx dy, start
                d['slide'] = [mem[e + 0x48], mem[e + 0x49]] + [s16(e + o) for o in (0x4a, 0x4c, 0x4e, 0x50)] + [u32(e + 0x54)]
                if d['slide'][0] == 0:                          # FUN_003d0d38 leaves length / dx / dy unset (stale heap bytes)
                    d['slide'][1] = d['slide'][4] = d['slide'][5] = 0   # until a slide start (FUN_003d0f08 / 0fd0) writes them
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


def slides_json(elf):
    """The HUD panels' slides (worker 0203; FUN_003afc98 / FUN_003afcf8): panel p -> group DAT_00471db0[p] (0xff = the
    root HUD+0x18, else slot HUD+0x38+4n) and DAT_00471dc0[p] = { u8 length / 100 ms, pad, s16 dx, s16 dy }."""
    out = []
    for p in range(11):
        s = elf.u8(0x471db0 + p)
        r = 0x471dc0 + 6 * p
        out.append({'slot': 'root' if s == 0xff else s, 'len': elf.u8(r),
                    'dx': struct.unpack('<h', elf.read(r + 2, 2))[0], 'dy': struct.unpack('<h', elf.read(r + 4, 2))[0]})
    return out


def ring_json(elf):
    """The hit-direction ring = reticle kind 5 (FUN_003b1048(RET, ctx, 5, t, 0)): its pieces
    DAT_00472790[5 * 3 + 0] (0x14-byte records, as export_web_aim.reticle_json reads kinds 1-4; all three
    variants point at the same list), their sprite frames (DAT_0047bfc0[id] +0), the texture
    PTR_DAT_0047d500[DAT_004727f0[10]] and the show / hide length DAT_00472110[5] (FUN_003b0680 / 0738)."""
    k = 5
    tex = elf.read(elf.u32(0x47d500 + 4 * elf.u8(0x4727f0 + 2 * k)), 8).split(b'\0')[0].decode('latin-1')
    p = elf.u32(0x472790 + k * 0xc)
    pieces, frames = [], {}
    while p:
        rec = elf.read(p + 0x14 * len(pieces), 0x14)
        sid, frame, copies = struct.unpack_from('<HBb', rec, 0)
        if sid == 0:
            break
        x, y, w, h = struct.unpack_from('<hhhh', rec, 4)
        sx = lambda s: ((s & 0xfff) ^ 0x800) - 0x800     # (u16 << 20) >> 20
        pieces.append({'sprite': sid, 'frame': frame, 'copies': copies, 'x': sx(x), 'y': sx(y),
                       'w': -1 if w == -1 else sx(w), 'h': -1 if h == -1 else sx(h),
                       'rgba': list(rec[0xc:0x10]), 'flags': struct.unpack_from('<I', rec, 0x10)[0]})
        if len(pieces) > 64:
            raise ValueError('kind 5: no end marker')
    for sid in {pc['sprite'] for pc in pieces}:
        sp = elf.u32(SPRITES + 0x10 * sid)
        n = max(pc['frame'] for pc in pieces if pc['sprite'] == sid) + 1
        frames[str(sid)] = [list(struct.unpack('<4h', elf.read(sp + 8 * i, 8))) for i in range(n)] if sp else []
    return {'texture': tex, 'len_show': struct.unpack('<i', elf.read(0x472110 + 4 * k, 4))[0],
            'pieces': pieces, 'frames': frames}


def ring_state(mem):
    """The ring's state in the save (FUN_003af580 / FUN_003af6b8): HUD +0x230 on, +0x234 frame counter,
    +0x238 + 4 i segment timers; kind 5's phase / end / length RET+0x1b7 / +0x1d0 / +0x1e6 (one object)."""
    u32 = lambda a: struct.unpack_from('<I', mem, a)[0]
    H = u32(HUD_PTR)
    return {'on': u32(H + 0x230), 'f234': u32(H + 0x234), 'timers': [u32(H + 0x238 + 4 * i) for i in range(8)],
            'phase': mem[H + 0x1b2 + 5], 'end': u32(H + 0x1bc + 4 * 5),
            'len': struct.unpack_from('<h', mem, H + 0x1dc + 2 * 5)[0]}


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


def dump_ring(path, state):
    """Test reference for the hit-direction ring (test_hud.mjs): the menu1 strips (TBP 10756) of a GS
    dump's last frame drawn between the reticle and the HUD panels (FUN_003b0ac0 kind 5, before the first
    menu3 sprite), as dump_hud's records, plus the ring state and camera yaw (CAM+0x178) of the save
    state grabbed with it (grab_gs.py: the dump shows the 4th frame after the state)."""
    sys.path.insert(0, os.path.join(ROOT, 'tools/gsdump/src'))
    import gsrender2 as g, gsparse  # noqa: E402
    buf = open(path, 'rb').read()
    h = gsparse.read_header(buf)
    gif = g.build(buf, h, sprite_uv=True)
    a, b = g.pick_frame(gif, 'last')
    start = next(i for i in range(a, b) if gif.tris[i][3]['tme'] and gif.tris[i][3]['ptype'] == 6
                 and g.tex0_fields(gif.tris[i][3]['tex0'])['tbp0'] == 10828)
    i = a
    while i < start and not (gif.tris[i][3]['tme'] and g.tex0_fields(gif.tris[i][3]['tex0'])['tbp0'] == 10792):
        i += 1                                                  # the reticle (menu2), when it is drawn
    i = a if i == start else i
    out = []
    while i + 1 < start:
        t0, t1 = gif.tris[i], gif.tris[i + 1]
        c = t0[3]
        if c['frame'] & 0x1ff != 224 or c['ptype'] != 4 or not c['tme'] or g.tex0_fields(c['tex0'])['tbp0'] != 10756:
            i += 1
            continue
        ofx, ofy = (c['xyoffset'] & 0xffffffff) / 16, (c['xyoffset'] >> 32) / 16
        out.append({'v': [[v[0] / 16 - ofx, v[1] / 16 - ofy, v[6] / 16, v[7] / 16, list(v[8:12])]
                          for v in (t0[0], t0[1], t0[2], t1[2])], 'blend': list(c['blend'])})
        i += 2
    sys.path.insert(0, os.path.join(ROOT, 'tools/trace'))
    from p2s import read_p2s  # noqa: E402
    mem = read_p2s(state)['eeMemory.bin']
    cam = struct.unpack_from('<I', mem, struct.unpack_from('<I', mem, 0x46e290)[0] + 0x40)[0]
    return {'prims': out, 'ring': ring_state(mem), 'clock': struct.unpack_from('<I', mem, 0x4f58ec)[0],
            'yaw': struct.unpack_from('<f', mem, cam + 0x178)[0]}


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
    ap.add_argument('--state', default='',
                    help='cross-check: read the element tree and values from this save state (the sea-of-flames '
                         'start, e.g. %s) instead of building them from the disc, and print the differences '
                         'to the disc build' % STATE)
    ap.add_argument('-o', '--out', default=OUT)
    ap.add_argument('--dump', help='also write OUT/dump_<name>.json: this GS dump\'s HUD draws (test reference)')
    ap.add_argument('--ring-dump', nargs=2, metavar=('DUMP', 'STATE'),
                    help='also write OUT/ring_<name>.json: the hit-direction ring\'s draws in this (decompressed) GS dump '
                         'and the ring state / camera yaw of the save state grabbed with it (test reference)')
    ap.add_argument('--tree', metavar='STATE',
                    help='also write OUT/tree_<name>.json: the HUD element tree (rect, box, slide state) of this save state '
                         '(test reference: the slid-out HUD at game over, worker 0203)')
    a = ap.parse_args()
    if a.tree:
        sys.path.insert(0, os.path.join(ROOT, 'tools/trace'))
        from p2s import read_p2s  # noqa: E402
        os.makedirs(a.out, exist_ok=True)
        name = os.path.splitext(os.path.basename(a.tree))[0].replace(' ', '_')
        with open(os.path.join(a.out, 'tree_%s.json' % name), 'w') as fh:
            json.dump([{k: d[k] for k in ('id', 'depth', 'slot', 'rect', 'box', 'slide', 'flags') if k in d}
                       for d in read_tree(read_p2s(a.tree)['eeMemory.bin'])[0]], fh)
    if a.ring_dump:
        os.makedirs(a.out, exist_ok=True)
        name = os.path.splitext(os.path.basename(a.ring_dump[0]))[0].replace(' ', '_')
        with open(os.path.join(a.out, 'ring_%s.json' % name), 'w') as fh:
            json.dump(dump_ring(*a.ring_dump), fh)
    if a.dump:
        os.makedirs(a.out, exist_ok=True)
        name = os.path.splitext(os.path.basename(a.dump))[0]
        with open(os.path.join(a.out, 'dump_%s.json' % name), 'w') as fh:
            json.dump(dump_hud(a.dump), fh)
    elf = A.load_elf(a)
    md = open(os.path.join(a.locale, 'menudata.bin'), 'rb').read()
    nent = struct.unpack_from('<I', md, 0)[0]
    font_off = struct.unpack_from('<I', md, 4 + 4 * 2)[0] if nent > 2 else None
    metrics = md[font_off:font_off + 0x3a0]
    ndiff = 0
    if a.state:
        sys.path.insert(0, os.path.join(ROOT, 'tools/trace'))
        from p2s import read_p2s  # noqa: E402
        mem = read_p2s(a.state)['eeMemory.bin']
        chain_s, values_s = read_tree(mem)
        values_s['ring'] = ring_state(mem)
        try:                                    # a disc build that fails is a difference, not the end of the save read
            chain, values = disc_tree(elf, a.locale, metrics)
            ndiff = compare(chain_s, values_s, chain, values)
        except Exception as ex:                 # noqa: BLE001
            ndiff = 1
            print('save vs disc build: the disc build failed: %s: %s' % (type(ex).__name__, ex))
        chain, values = chain_s, values_s
    else:
        chain, values = disc_tree(elf, a.locale, metrics)
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
    textures = {}
    for n in ('menu1', 'menu2'):
        textures[n] = A.menu_texture(md, n)
    for n in ('menu3', 'menu4'):
        textures[n] = menu_texture8(md, n)
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
        'textures': textures, 'ring': ring_json(elf), 'slides': slides_json(elf),
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
    if ndiff:                                   # --state: the cross-check failed (hud.json is still the save's)
        sys.exit('save vs disc build: %d difference(s)' % ndiff)


if __name__ == '__main__':
    main()
