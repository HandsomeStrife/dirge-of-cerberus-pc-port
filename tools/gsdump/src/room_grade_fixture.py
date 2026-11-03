#!/usr/bin/env python3
"""room_grade_fixture.py -- a GS-dump fixture for native/web/test_room_grade.mjs (worker 0213).

Writes, into OUTDIR (game-derived: must be gitignored, default tools/trace/out/room_grade):
  NAME.json        camera (eye, at, up from the state's CAM+0x60.. rows, as the page wants them),
                   the loaded chunks (slot table DAT_004e4c60 +0x54 / +0x5c), the room mask
                   DAT_004e8710, the sky TBP and how many additive (TEST 0x51601) room tris were zeroed
  NAME_game.png    gsrender2 render of the dump's last frame (main framebuffer, 432 x 512)
  NAME_noadd.png   the same with every additive draw after the first one (the sky) zeroed
                   (vertex alpha 0): NAME_game - NAME_noadd = what the additive room draws add
The state must be the one grab_gs.py saved with the dump (the dump is a few frames later; the
grab scripts here stand still, so the camera is the same).

  python3 -I tools/gsdump/src/room_grade_fixture.py DUMP.bin STATE.p2s NAME [OUTDIR]
"""
import os, sys, json, struct
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
sys.path.insert(0, HERE); sys.path.insert(0, os.path.join(REPO, 'tools', 'trace'))
import gsrender2 as G
from gsparse import read_header
from p2s import read_p2s
from PIL import Image

CAM = 0x95efe0           # *(DAT_0046e290 + 0x40) in the sea-of-flames save (tools/trace/fields.py)


def render(path, kill_add):
    buf = open(path, 'rb').read(); h = read_header(buf); gif = G.build(buf, h, sprite_uv=True)
    a, b = G.pick_frame(gif, 'last'); sky = None; n = 0
    for i in range(a, b):
        t = gif.tris[i]; c = t[3]
        if c.get('abe') and c['test'] & 0xfffff == 0x51601:
            tbp = c['tex0'] & 0x3fff
            if sky is None:
                sky = tbp
            if kill_add and tbp != sky:
                gif.tris[i] = tuple(tuple(v[:11]) + (0,) + tuple(v[12:]) for v in t[:3]) + (c,); n += 1
    tc = G.TexCache(path, uploads=gif.uploads)
    img, _info = G.render_frame(buf, h, gif, tc, frame='last', fb='main')
    return np.clip(img, 0, 255).astype(np.uint8), n, sky


def main(argv):
    dump, state, name = argv[:3]
    out = argv[3] if len(argv) > 3 else os.path.join(REPO, 'tools', 'trace', 'out', 'room_grade')
    os.makedirs(out, exist_ok=True)
    ee = read_p2s(state)['eeMemory.bin']
    row = lambda o: struct.unpack_from('<4f', ee, CAM + o)
    eye, fwd, up = row(0x90), row(0x80), row(0x70)
    slots = [(struct.unpack_from('<I', ee, 0x4e4c60 + s * 0x70 + 0x54)[0],
              struct.unpack_from('<I', ee, 0x4e4c60 + s * 0x70 + 0x5c)[0]) for s in range(3)]
    lo, hi = struct.unpack_from('<2Q', ee, 0x4e8710); m = lo | hi << 64
    game, _, sky = render(dump, False)
    noadd, n, _ = render(dump, True)
    Image.fromarray(game).save(os.path.join(out, name + '_game.png'))
    Image.fromarray(noadd).save(os.path.join(out, name + '_noadd.png'))
    # the page's camera: eye, a point ahead, and up = -(CAM+0x70) (the room is -Y up)
    cam = list(eye[:3]) + [eye[k] + 100 * fwd[k] for k in range(3)] + [-up[0], -up[1], -up[2]]
    meta = dict(cam=cam, chunks=[c for c, ok in slots if ok], mask=[i for i in range(128) if m >> i & 1],
                sky_tbp=sky, additive_tris_zeroed=n, dump=os.path.basename(dump), state=os.path.basename(state))
    json.dump(meta, open(os.path.join(out, name + '.json'), 'w'), indent=1)
    print('%s: chunks %s, %d additive tris zeroed, mask %s -> %s' % (name, meta['chunks'], n, meta['mask'], out))


if __name__ == '__main__':
    main(sys.argv[1:])
