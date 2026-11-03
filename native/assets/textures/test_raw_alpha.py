#!/usr/bin/env python3
"""test_raw_alpha.py -- dtex --raw-alpha on formats without an 8-bit alpha (worker 0227).

  python3 -I native/assets/textures/test_raw_alpha.py      (DTEX=<path>: test another build, for mutation runs)

Hand-made TIM2 files (no game data), each 4 x 1:
  CT32: the alpha byte as is in raw mode (0x40 / 0x80 / 0xff), x 255 / 128 capped otherwise.
  CT24, CT16 (bit 15 clear and set) and PSMT4 with a 16-bit CLUT: raw mode gives the GS TEXA expansion of the room's
  draws, 0x80 (TEXA 0x8000000080: TA0 = TA1 = 0x80, AEM 0, in the GS dumps tp09 / tp0b / npc_g100), not 255 (which
  room.js would turn into As = 1.99); the normalised mode is unchanged (255 / bit 15 ? 255 : 0).
"""
import os, struct, subprocess, sys, tempfile
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
DTEX = os.environ.get('DTEX') or os.path.join(HERE, 'dtex')
fail = 0
def ok(c, m):
    global fail
    print(('ok   ' if c else 'FAIL ') + m); fail += not c

def tim2(img_type, pixels, clut=b'', clut_type=0, clut_colors=0, w=4, h=1):
    hdr = struct.pack('<IIIHHBBBBHH', 0x30 + len(pixels) + len(clut), len(clut), len(pixels), 0x30, clut_colors,
                      0, 1, clut_type, img_type, w, h) + bytes(0x30 - 0x18)
    return b'TIM2' + bytes([4, 0, 1, 0]) + bytes(8) + hdr + pixels + clut

def alphas(blob, raw):
    with tempfile.TemporaryDirectory() as d:
        p = os.path.join(d, 't.tm2'); open(p, 'wb').write(blob)
        r = subprocess.run([DTEX] + (['--raw-alpha'] if raw else []) + [p, '-o', d], capture_output=True, text=True)
        pngs = [f for f in os.listdir(d) if f.endswith('.png')]
        if r.returncode or len(pngs) != 1:
            return 'dtex: rc %d, %s' % (r.returncode, (r.stdout + r.stderr).strip()[:120])
        return [px[3] for px in Image.open(os.path.join(d, pngs[0])).convert('RGBA').getdata()]

ct32 = tim2(3, bytes([10, 20, 30, 0x40, 10, 20, 30, 0x80, 10, 20, 30, 0xff, 1, 2, 3, 0]))
ct24 = tim2(2, bytes(range(12)))
ct16 = tim2(1, struct.pack('<4H', 0x001f, 0x801f, 0x0000, 0xffff))
pal16 = tim2(4, bytes([0x10, 0x32]), clut=struct.pack('<16H', *([0x001f, 0x801f, 0x7c00, 0xfc00] * 4)),
             clut_type=1, clut_colors=16)
for name, blob, raw, want in [
        ('CT32 raw', ct32, True, [0x40, 0x80, 0xff, 0]),
        ('CT32 normalised', ct32, False, [127, 255, 255, 0]),
        ('CT24 raw', ct24, True, [0x80] * 4),
        ('CT24 normalised', ct24, False, [255] * 4),
        ('CT16 raw', ct16, True, [0x80] * 4),
        ('CT16 normalised', ct16, False, [0, 255, 0, 255]),
        ('PSMT4 + 16-bit CLUT raw', pal16, True, [0x80] * 4),
        ('PSMT4 + 16-bit CLUT normalised', pal16, False, [0, 255, 0, 255])]:
    got = alphas(blob, raw)
    ok(got == want, '%s: alpha %s (want %s)' % (name, got, want))
print('all ok' if not fail else '%d FAILED' % fail)
sys.exit(1 if fail else 0)
