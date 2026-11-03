#!/usr/bin/env python3
"""Placed sounds (stage section 22) and Vincent's footstep data for play.html (native/web/ambient.js), worker 0215.

    python3 -I native/assets/models/export_web_ambient.py STAGE.bin MODEL.bin ELF OUT.json

STAGE = z128's stage file 06800001.bin, MODEL = Vincent's model container 07703201.bin, ELF = SLES_541.85.
Writes OUT.json (gitignored game data). Decoded (notes/audio-research.md "Placed sounds", "Footsteps"):

Section 22 (FUN_00311530: record i at base + i x 0xc0), read at stage load by FUN_00548788 (manager +0xfac): a record
with +0xaa == 7 makes a class-0xe object (FUN_0053db98, ctor FUN_0057d430, vt 0x5903b8) via FUN_005503e8(obj, i, 0, 1):
  +0x00 matrix, +0x40 its inverse, +0x80 / +0x90 box lo / hi (local), +0xa0 s16 script, +0xa4 flags,
  +0xa8 s16 section-1 record it follows (FUN_0053b920 -> FUN_0054c550: the actor's +0xc0 child list, so it is
  activated with that actor, FUN_0054ef68), +0xaa type, +0xab, +0xb0 name, +0xb8 shape (0 box, 1 ellipsoid,
  2 cylinder: FUN_0057dab8 / FUN_0057e310), +0xbb volume (area sounds), +0xbc request-0x15 value (FUN_003e8708),
  +0xbd 1 = area sound (playBgAreaSound path FUN_003e6c88), else a positioned one (FUN_003e6d70).

Footsteps: FUN_003466a8 picks the name with FUN_003415d8(C, kind): floor material C+0x6c1 -> DAT_004a1920 (14 words,
ELF) -> m (< 12), kind 0..3 -> cue kind x 16 + m, kind 4 -> 0x6e + m when the stage version >= 0x2f else m; the name
is the cue table C+0x7ec's entry (stage section 0x1a, Vincent's table: export_web_triggers.PLAYER_CUES, a GUESS).
The foot test FUN_005ae828 reads the model's 'mkd' (mk2 header +0x20 count of extra legs, +0x24 / +0x28 thresholds,
default -3.0 unless +2 == '2' and +0x20 >= 0: FUN_0030ba08 / FUN_0030ba38 / FUN_0030ba68) markers 7 / 8 (and 4 / 5).
"""
import json, os, struct, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import export_web_triggers as T     # noqa: E402  (stage sections, cue tables, PLAYER_CUES)
import export_cerberus as EC        # noqa: E402  (container entries)
from export_web_aim import Elf      # noqa: E402

SEC_SOUND, STRIDE = 22, 0xC0
MAT_MAP, MAT_N = 0x4A1920, 14       # FUN_003415d8's local copy of DAT_004a1920
f32s = lambda d, o, n: [struct.unpack_from('<f', d, o + 4 * k)[0] for k in range(n)]


def objects(d):
    o, n, s = T.SE.sections(d)[SEC_SOUND]
    if n and s != STRIDE:
        raise ValueError('section 22 stride %#x, expected %#x' % (s, STRIDE))
    out = []
    for i in range(n):
        r = o + i * s
        if d[r + 0xaa] != 7:                       # FUN_00548788: only type 7 makes an object
            continue
        out.append(dict(idx=i, name=d[r + 0xb0:r + 0xb8].split(b'\0')[0].decode('latin-1'),
                        m=f32s(d, r, 16), inv=f32s(d, r + 0x40, 16), lo=f32s(d, r + 0x80, 4), hi=f32s(d, r + 0x90, 4),
                        script=struct.unpack_from('<h', d, r + 0xa0)[0], flags=struct.unpack_from('<I', d, r + 0xa4)[0],
                        actor=struct.unpack_from('<h', d, r + 0xa8)[0], ab=d[r + 0xab], shape=d[r + 0xb8],
                        b9=d[r + 0xb9], ba=d[r + 0xba], vol=d[r + 0xbb], req15=d[r + 0xbc], area=d[r + 0xbd]))
    return out


def stage_version(d):
    return (d[3] - 0x30) * 100 + (d[4] - 0x30) * 10 + d[5] - 0x30 if d[:3] == b'bzd' else -1   # FUN_00312248


def mk2(model):
    buf = open(model, 'rb').read()
    for o in EC.entries(buf):
        if buf[o + 8:o + 11] == b'mkd':
            p = o + 0x10
            if buf[p:p + 3] != b'mk2':
                raise ValueError('%s: marker.mkd has no mk2 header' % model)
            n = struct.unpack_from('<H', buf, p + 4)[0]
            m0 = p + struct.unpack_from('<I', buf, p + 8)[0]
            mk = {str(k): list(struct.unpack_from('<3f', buf, m0 + 16 * k)) + [struct.unpack_from('<i', buf, m0 + 16 * k + 12)[0]]
                  for k in (4, 5, 7, 8) if k < n}
            return dict(version=chr(buf[p + 2]), legs=struct.unpack_from('<i', buf, p + 0x20)[0],
                        thr=list(struct.unpack_from('<2f', buf, p + 0x24)), markers=mk)
    raise ValueError('%s: no marker.mkd' % model)


def main():
    if len(sys.argv) != 5:
        sys.exit(__doc__)
    stage, model, elf_path, out = sys.argv[1:]
    d = open(stage, 'rb').read()
    elf = Elf(open(elf_path, 'rb').read())
    cues = T.cue_tables(d)
    res = dict(format='ambient-1', stage=os.path.basename(stage), version=stage_version(d), objects=objects(d),
               foot=dict(mat_map=[elf.u32(MAT_MAP + 4 * k) for k in range(MAT_N)], cue_table=T.PLAYER_CUES,
                         cues=cues[T.PLAYER_CUES] if T.PLAYER_CUES < len(cues) else [], p000=mk2(model)))
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    with open(out, 'w') as fh:
        json.dump(res, fh, separators=(',', ':'))
    print('wrote %s: %d sound objects, %d foot cues' % (out, len(res['objects']), len(res['foot']['cues'])))


if __name__ == '__main__':
    main()
