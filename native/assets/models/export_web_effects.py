#!/usr/bin/env python3
"""Export the game's resident effect file and effect texture pack for native/web/effects.js.

    python3 -I native/assets/models/export_web_effects.py [--extract DIR] [-o native/web/data/effects]

Both files are copied byte for byte from the user's own extracted disc (extract/_KEL) into the
gitignored native/web/data/effects/. Nothing from the game is stored in this script.

  r0001.fed    data/effect/resident/r0000/r0001/fer/r0001.fed: the resident FED with FileCode
               0x40000 (FUN_002e5c60 finds it for every effect id 0x40000..0x7ffff: the bullet
               wall impacts 0x43400.. (table 0x4a0c68, FUN_00336040) and the hits on Vincent
               0x40c00 / 0x41800 / 0x41c00 (table 0x4a0cd8, FUN_003363d0)).
  core_ef.bin  data/effect/core/core_ef.bin: the effect texture pack resident in GS memory.
               27 texture records of 0x20 bytes at +0x70 (u64 GS TEX0, +0xc u16 width, +0xe u16
               height, +0x10 u32 byte size), 27 CLUT records of 0x10 bytes at +0x3d0 (u32 CBP),
               CLUT k (256 x CT32, GS storage order) at 0xf80 + 0x400 k, texture k (PSMT8, linear)
               at 0x7bf0 + the sizes of textures 0..k-1. The layout is MEASURED, not decoded from
               the loader: every texture and CLUT resident in the impact GS dumps equals these
               bytes (notes/effects-research.md). The FED sprite records name their texture by
               the full TEX0 word, so effects.js keys the pack by TEX0.

  scene.json   adds "effects": "effects" to the page's data/scene.json (play.js loads the effects only
               when it is declared).
  ids.json     from the ELF (elf/SLES_541.85): the effect id tables at the call sites,
               wall 0x4a0c68 (28 words, FUN_00336040: [material * 2 + floor]) and
               hit 0x4a0cd8 (4 words, FUN_003363d0: [(C+0x150 >> 16) & 3]).

The checks below only validate the layout; they print and fail on a mismatch.
"""
import argparse
import json
import os
import shutil
import struct
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
SRC = {
    'r0001.fed': 'data/effect/resident/r0000/r0001/fer/r0001.fed',
    'core_ef.bin': 'data/effect/core/core_ef.bin',
}


def check_fed(b):
    if b[:4] != b'FED\x08':                       # FUN_002df140 / FUN_002e4418 (byte +3 == 8)
        return 'not a FED v8'
    if struct.unpack_from('<I', b, 4)[0] != 0x40000:
        return 'FileCode is not 0x40000'
    return None


def check_core(b):
    n = 27
    off = 0x7bf0
    for k in range(n):
        o = 0x70 + 0x20 * k
        tex0 = struct.unpack_from('<Q', b, o)[0]
        w, h, size = struct.unpack_from('<HHI', b, o + 0xc)
        if (tex0 >> 20) & 0x3f != 0x13 or w * h != size:
            return 'texture record %d: psm %#x, %dx%d, size %#x' % (k, (tex0 >> 20) & 0x3f, w, h, size)
        cbp = struct.unpack_from('<I', b, 0x3d0 + 0x10 * k)[0] & 0x3fff
        if cbp != (tex0 >> 37) & 0x3fff:
            return 'CLUT record %d: CBP %d != TEX0 CBP %d' % (k, cbp, (tex0 >> 37) & 0x3fff)
        off += size
    if off != len(b):
        return 'texture data ends at %#x, file is %#x' % (off, len(b))
    return None


def elf_words(path, va, n):
    d = open(path, 'rb').read()
    phoff, = struct.unpack_from('<I', d, 0x1c)
    phnum, = struct.unpack_from('<H', d, 0x2c)
    for i in range(phnum):
        t, off, vaddr, _, filesz, _, _, _ = struct.unpack_from('<8I', d, phoff + 32 * i)
        if t == 1 and vaddr <= va and va + 4 * n <= vaddr + filesz:
            return list(struct.unpack_from('<%dI' % n, d, off + va - vaddr))
    sys.exit('%#x not in the ELF file image' % va)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--extract', default=os.path.join(ROOT, 'extract/_KEL'))
    ap.add_argument('--elf', default=os.path.join(ROOT, 'elf/SLES_541.85'))
    ap.add_argument('-o', '--out', default=os.path.join(ROOT, 'native/web/data/effects'))
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    for name, rel in SRC.items():
        src = os.path.join(a.extract, rel)
        b = open(src, 'rb').read()
        err = (check_fed if name.endswith('.fed') else check_core)(b)
        if err:
            sys.exit('%s: %s' % (src, err))
        shutil.copyfile(src, os.path.join(a.out, name))
        print('wrote', os.path.join(a.out, name), len(b), 'bytes')
    ids = {'wall': elf_words(a.elf, 0x4a0c68, 28), 'hit': elf_words(a.elf, 0x4a0cd8, 4)}
    if any((x & 0xfffc0000) != 0x40000 for x in ids['wall'] + ids['hit']):
        sys.exit('effect id tables: an id outside FED 0x40000')
    json.dump(ids, open(os.path.join(a.out, 'ids.json'), 'w'))
    print('wrote', os.path.join(a.out, 'ids.json'))
    declare(a.out)


def declare(out):
    """Declare the effect data in the page's scene.json ("effects": its directory from data/), so play.js
    fetches it only when it exists (no 404 in the console without it). export_web_room.py, which writes
    scene.json, declares it again when effects/r0001.fed is there (as export_web_hud.py's "hud")."""
    data = os.path.dirname(os.path.abspath(out))
    sp = os.path.join(data, 'scene.json')
    if not os.path.isfile(sp):
        print('note: no %s yet (export_web_room.py declares the effects when it writes it)' % sp)
        return
    scene = json.load(open(sp))
    scene['effects'] = os.path.relpath(os.path.abspath(out), data)
    tmp = sp + '.tmp'
    with open(tmp, 'w') as fh:
        json.dump(scene, fh, indent=1)
    os.replace(tmp, sp)


if __name__ == '__main__':
    main()
