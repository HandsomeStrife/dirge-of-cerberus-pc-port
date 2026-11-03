#!/usr/bin/env python3
"""Export the game's resident effect file and effect texture pack for native/web/effects.js.

    python3 -I native/assets/models/export_web_effects.py [--extract DIR] [-o native/web/data/effects]

Both files are copied byte for byte from the user's own extracted disc (extract/_KEL) into the
gitignored native/web/data/effects/. Nothing from the game is stored in this script.

  r0001.fed    data/effect/resident/r0000/r0001/fer/r0001.fed: the resident FED with FileCode
               0x40000 (FUN_002e5c60 finds it for every effect id 0x40000..0x7ffff: the bullet
               wall impacts 0x43400.. (table 0x4a0c68, FUN_00336040) and the hits on Vincent
               0x40c00 / 0x41800 / 0x41c00 (table 0x4a0cd8, FUN_003363d0)).
  r0000.fed    data/effect/resident/r0000/r0000/fer/r0000.fed (worker 0200): the resident FED with FileCode 0
               (ids 0x0..0x3ffff: FUN_00336508's 0x1000 at a hit on Vincent, FUN_00580410's 0x4800 at an item
               drop). Boot FUN_00244db0 -> FUN_002449e8 -> FUN_002448a0(0) loads the three files of table
               0x4985e0 row 0 (files 0x3100038 / 0x3100039 / 0x310003a = r0000.fed / r0001.fed / r0002.fez;
               row 1 = the _on variants 0x3300000..2) and links each FED into the effect manager (FUN_002f0ff0);
               the z128 save's RAM holds r0000.fed (not r0000_on.fed) next to r0001.fed in that list.
  z128_a0.fed  noPath/06800014.bin, 06800114.bin, 06800214.bin (worker 0208): z128's area FEDs (FileCodes 0x20000000,
  z128_a1.fed  0x20040000, 0x20080000 = 0x20000000 | area << 18, FUN_00306408), loaded into the level manager DAT_004ee3c0
  z128_a2.fed  (FUN_002f15d0, the z128 RAM holds all three); their auto-start records (flag +4 bit 0) are the stage's fire,
               smoke and embers (FUN_002e4e38; notes/effects-research.md "Stage effects"). 06800114's pictures are headers
               only: their texels come with 06800014's (same TEX0 words).
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
  ids.json     'feds': the FED files written here (play.js fetches r0000.fed only when listed); and
               from the ELF (elf/SLES_541.85): the effect id tables at the call sites,
               wall 0x4a0c68 (28 words, FUN_00336040: [material * 2 + floor]) and
               hit 0x4a0cd8 (4 words, FUN_003363d0: [(C+0x150 >> 16) & 3]).
               + twister (worker 0188): the effect Mersenne twister FUN_002d9b18 (624 words at
               DAT_004e9408, index DAT_004e9dc8) in the save state the page starts from
               (--state sea-of-flames.p2s; no default), as the LCG DAT_004e9400 already is in
               effects.js; the type 137 sparks draw from it. Without --state the field is left out
               and both this script and the page warn (sparks off).

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
    'r0000.fed': 'data/effect/resident/r0000/r0000/fer/r0000.fed',
    'core_ef.bin': 'data/effect/core/core_ef.bin',
    'z128_a0.fed': 'noPath/06800014.bin',
    'z128_a1.fed': 'noPath/06800114.bin',
    'z128_a2.fed': 'noPath/06800214.bin',
}
STAGE = ['z128_a0.fed', 'z128_a1.fed', 'z128_a2.fed']     # load order (the z128 RAM emitter list)


CODE = {'r0001.fed': 0x40000, 'r0000.fed': 0,     # FUN_002e5c60 finds a FED by id & 0xfffc0000 == its FileCode
        'z128_a0.fed': 0x20000000, 'z128_a1.fed': 0x20040000, 'z128_a2.fed': 0x20080000}


def check_fed(b, name):
    if b[:4] != b'FED\x08':                       # FUN_002df140 / FUN_002e4418 (byte +3 == 8)
        return 'not a FED v8'
    if struct.unpack_from('<I', b, 4)[0] != CODE[name]:
        return 'FileCode is not %#x' % CODE[name]
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
    ap.add_argument('--state', default=None, help='the save state the page starts from (sea-of-flames.p2s): its effect twister for the type 137 sparks')
    a = ap.parse_args()
    if a.state and not os.path.isfile(a.state):        # a named state that is not there is an error ('' / none: leave it out)
        sys.exit('--state %s: no such file' % a.state)
    os.makedirs(a.out, exist_ok=True)
    for name, rel in SRC.items():
        src = os.path.join(a.extract, rel)
        b = open(src, 'rb').read()
        err = check_fed(b, name) if name.endswith('.fed') else check_core(b)
        if err:
            sys.exit('%s: %s' % (src, err))
        shutil.copyfile(src, os.path.join(a.out, name))
        print('wrote', os.path.join(a.out, name), len(b), 'bytes')
    ids = {'wall': elf_words(a.elf, 0x4a0c68, 28), 'hit': elf_words(a.elf, 0x4a0cd8, 4)}
    ids['feds'] = sorted(n for n in SRC if n.endswith('.fed'))   # worker 0200: play.js fetches only the listed FEDs (no 404)
    ids['stage'] = STAGE                                          # worker 0208: the level manager's FEDs, in load order
    if any((x & 0xfffc0000) != 0x40000 for x in ids['wall'] + ids['hit']):
        sys.exit('effect id tables: an id outside FED 0x40000')
    if a.state:
        sys.path.insert(0, os.path.join(ROOT, 'tools/trace'))
        from p2s import read_p2s
        ee = read_p2s(a.state)['eeMemory.bin']
        mt = list(struct.unpack_from('<624I', ee, 0x4e9408))
        i = struct.unpack_from('<i', ee, 0x4e9dc8)[0]
        if not 0 <= i < 624:
            sys.exit('effect twister index %d out of range' % i)
        ids['twister'] = {'s': mt, 'i': i}
        # newlib's rand() state (*(PTR_DAT_00495844) + 0x58): FUN_002d97f8 reseeds the effect LCG and VU0 R from
        # rand() at every effect frame (FUN_002efc78)
        ids['rand'] = struct.unpack_from('<I', ee, (struct.unpack_from('<I', ee, 0x495844)[0] & 0x1ffffff) + 0x58)[0]
        # worker 0208: the hidden-cell mask DAT_004e8710 = DAT_004e86f0 | DAT_004e8700 (FUN_00269410; 128 bits, set /
        # cleared by scripts FUN_00269368 / FUN_002693a8): FUN_002ea6a0 culls a stage emitter whose param cell (+0x66) is
        # set. Game state at the save, not level data. Worker 0225: the page computes DAT_004e86f0 every frame (room_vis.js,
        # FUN_00264ee0's probe); `hidden` is kept for the tests that replay this save (test_effects / test_effects_page).
        # the two halves apart (review): `hidden` = DAT_004e86f0, `hidden_script` = DAT_004e8700 (the half script cmds 0x54 / 0x55
        # change: enemy_ai.js -> effects.js cellMask)
        bits = lambda b: [i for i in range(128) if b[i >> 3] >> (i & 7) & 1]
        ids['hidden'] = bits(ee[0x4e86f0:0x4e8700])
        ids['hidden_script'] = bits(ee[0x4e8700:0x4e8710])
    else:
        # worker 0225: no `hidden` (DAT_004e86f0 is the page's camera probe, room_vis.js); the script half starts empty
        ids['hidden_script'] = []
        print('WARNING: no --state given: ids.json has no effect twister (DAT_004e9408) or rand() state, so the page '
              'leaves out the type 137 sparks of the bullet impacts and hits (and does not reseed the effect LCG each '
              'frame). Pass --state sea-of-flames.p2s.', file=sys.stderr)
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
