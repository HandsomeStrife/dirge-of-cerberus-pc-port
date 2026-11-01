#!/usr/bin/env python3
"""Export the game's menu layout scripts for native/web/menu_layout.js.

    python3 -I native/assets/models/export_web_menu.py [--elf ELF] [-o native/web/data/menu.json]

Everything written is read from the user's own ELF (SLES_541.85) at run time, into the
gitignored native/web/data/. Nothing from the game is stored in this script: only the
addresses below.

What is exported (see notes/menu-research.md):
  opLen       DAT_0047a6c8: byte length of each layout opcode (FUN_003ca488 steps by it).
  layouts     layout byte scripts, read up to their 0xff end byte:
                title main menu  DAT_00aa6450 (normal), DAT_00aa64c0 (script flag 0x19 set),
                                 DAT_00aa6550 (FUN_003e2730 != 0)   (FUN_00aa3c98)
                pause            0x477678 (normal), 0x477858 (FUN_002419d8(10)),
                                 0x4778f8 (FUN_002419d8(0x11)), 0x4779c0 (param 1) (FUN_003bfe28)
  pauseRectOverride  0x51fc00: per-language rect override table pointers (FUN_003ca488 param_7;
                     language from FUN_00242450). Only the pointers, so a page can tell that
                     language 0 has none.
  titleItems  DAT_00aa6820 / DAT_00aa68e8: the title menu item records (0x28 bytes each,
              FUN_00aa5050): slot, widget id, two cursor positions, button rect, four FED
              sprite-id lists, position.
The .kel_title section (0xaa0000) is part of the ELF file image, so it reads like the rest.
"""
import argparse
import json
import os
import struct
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
ELF = os.path.join(ROOT, 'elf/SLES_541.85')
OUT = os.path.join(ROOT, 'native/web/data/menu.json')

OPLEN_AT, OPLEN_N = 0x47a6c8, 0x22          # FUN_003ca488: param_3 += DAT_0047a6c8[op]
LAYOUTS = {
    'title_main': 0xaa6450, 'title_main_cleared': 0xaa64c0, 'title_main_alt': 0xaa6550,
    'pause': 0x477678, 'pause_flag10': 0x477858, 'pause_flag11': 0x4778f8, 'pause_mode1': 0x4779c0,
}
PAUSE_OVERRIDE_AT = 0x51fc00
TITLE_ITEMS = {'normal': 0xaa6820, 'cleared': 0xaa68e8}


class Elf:
    """Section-header map of PROGBITS sections (covers .kel_title, which no PT_LOAD does)."""
    def __init__(self, data):
        if data[:4] != b'\x7fELF':
            raise ValueError('not an ELF')
        self.d = data
        shoff, = struct.unpack_from('<I', data, 0x20)
        shnum, = struct.unpack_from('<H', data, 0x30)
        self.secs = []
        for i in range(shnum):
            _, ty, _, addr, off, size = struct.unpack_from('<IIIIII', data, shoff + i * 40)
            if addr and ty == 1:
                self.secs.append((addr, off, size))

    def read(self, addr, n):
        for va, off, size in self.secs:
            if va <= addr and addr + n <= va + size:
                return self.d[off + addr - va: off + addr - va + n]
        raise ValueError('address %#x not in the ELF file image' % addr)

    def u32(self, a):
        return struct.unpack('<I', self.read(a, 4))[0]


def read_layout(elf, addr, oplen):
    """Bytes from addr through the 0xff end byte, stepping by opLen as FUN_003ca488 does."""
    out = bytearray()
    p = addr
    for _ in range(4096):
        op = elf.read(p, 1)[0]
        if op == 0xff:
            out.append(op)
            return bytes(out)
        n = oplen[op] if op < len(oplen) else 0
        if n == 0:
            raise ValueError('layout %#x: opcode %#x has no length' % (addr, op))
        out += elf.read(p, n)
        p += n
    raise ValueError('layout %#x: no end byte' % addr)


def read_items(elf, addr):
    """FUN_00aa5050 walks 0x28-byte records until the next record's widget id byte is 0xff."""
    items = []
    p = addr
    while True:
        b = elf.read(p, 0x28)
        lists = []
        for ptr in struct.unpack_from('<4I', b, 0x14):
            lst = []
            for k in range(8):                      # FUN_00aa4c88 reads list[param_4], param_4 = 0
                v = elf.u32(ptr + 4 * k)
                lst.append(v)
                if v == 0xffffffff:
                    break
            lists.append(lst)
        items.append({
            'slot': b[0], 'id': b[1],
            'cursor': list(struct.unpack_from('<4h', b, 2)),
            'rect': list(struct.unpack_from('<4h', b, 10)),
            'sprites': lists,
            'pos': list(struct.unpack_from('<2h', b, 0x24)),
        })
        if elf.read(p + 0x28 + 1, 1)[0] == 0xff:
            return items
        p += 0x28


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--elf', default=ELF)
    ap.add_argument('-o', default=OUT)
    a = ap.parse_args()
    elf = Elf(open(a.elf, 'rb').read())
    oplen = list(elf.read(OPLEN_AT, OPLEN_N))
    doc = {
        'source': 'SLES_541.85 (exported by export_web_menu.py)',
        'opLen': oplen,
        'layouts': {k: read_layout(elf, v, oplen).hex() for k, v in LAYOUTS.items()},
        'layoutAddr': {k: '%#x' % v for k, v in LAYOUTS.items()},
        'pauseRectOverride': [elf.u32(PAUSE_OVERRIDE_AT + 4 * i) for i in range(7)],
        'titleItems': {k: read_items(elf, v) for k, v in TITLE_ITEMS.items()},
    }
    os.makedirs(os.path.dirname(a.o), exist_ok=True)
    with open(a.o, 'w') as f:
        json.dump(doc, f, indent=1)
    print('wrote', a.o, {k: len(v) // 2 for k, v in doc['layouts'].items()})


if __name__ == '__main__':
    sys.exit(main())
