#!/usr/bin/env python3
"""test_bgm.py -- tools/audio/bgm.py against the game itself (sea-of-flames save state).

  python3 -I tools/audio/test_bgm.py            (BGM_PY=<path> tests another copy: mutation runs)

1. FUN_003edb18's key from the ELF table == the live key at 0x4fabc0 in the save's EE RAM.
2. Every 0xc0-byte sound unit of the descrambled bgm_001 starts with the ATRAC3 sync 0x28 (top 6 bits).
3. The decode of frames 1230..1236 == the game's PCM ring (0x1fa0040 + slot * 0x1000; the save's stream struct says
   1237 frames decoded, last into slot 3, layout 4 x (256 L, 256 R) s16), within libavcodec's float rounding
   (max |d| 24, mean |d| < 6). Without the sign flip the error is ~2x the signal.
4. bgm.track()'s output: rate 48000, loop samples [(start + SEAM) x 1024, (end + SEAM) x 1024), the SEAM frames
   after the end = frames start.. decoded right after frame end - 1 (the reader's jump, FUN_0024d730), and the loop
   target continues that sequence; the end frame clamped to the file size (a short copy of the file).
5. bgm.declare() lists the tracks in se_zNNN.json (the page fetches bgm.json only then).
6. The loop seam check in bgm.track() rejects SEAM = 0 (the decoder state needs frames to converge).
"""
import importlib.util
import json
import os
import shutil
import sys
import tempfile

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
sys.path.insert(0, os.path.join(ROOT, 'tools', 'trace'))
spec = importlib.util.spec_from_file_location('bgm', os.environ.get('BGM_PY') or os.path.join(ROOT, 'tools', 'audio', 'bgm.py'))
bgm = importlib.util.module_from_spec(spec); spec.loader.exec_module(bgm)
import numpy as np  # noqa: E402
import p2s  # noqa: E402

KEL = os.path.join(ROOT, 'extract', '_KEL')
STATE = '/srv/shared/dirge-port/save-states/sea-of-flames.p2s'
ok = 0


def check(name, cond):
    global ok
    if not cond:
        print('FAIL', name); sys.exit(1)
    ok += 1; print('ok', name)


elf = open(os.path.join(ROOT, 'elf', 'SLES_541.85'), 'rb').read()
k, d = bgm.scramble_keys(elf)
ee = p2s.read_p2s(STATE)['eeMemory.bin']
check('key FUN_003edb18 == live 0x4fabc0', k == ee[0x4FABC0:0x4FABD0])

raw = open(os.path.join(KEL, 'data', 'zone', 'z128', 'sound', 'bgm_001.at3'), 'rb').read()
st = bgm.descramble(raw, k, d)
units = np.frombuffer(st, np.uint8)[::0xC0] >> 2
check('all %d sound units carry sync 0x28' % len(units), bool((units == 0x28).all()))

pcm = bgm.atrac3_decode(st[:1237 * bgm.FRAME]).astype(int)
worst = 0; means = []
for back in range(7):                       # slot 3 = frame 1236, slot 2 = 1235, ... (ring of 8)
    slot, fr = (3 - back) % 8, 1236 - back
    g = np.frombuffer(ee[0x1FA0040 + slot * 0x1000:0x1FA1040 + slot * 0x1000], '<i2').reshape(4, 2, 256)
    game = np.stack([g[:, 0].ravel(), g[:, 1].ravel()], 1).astype(int)
    diff = np.abs(game - pcm[fr * 1024:(fr + 1) * 1024])
    worst = max(worst, int(diff.max())); means.append(diff.mean())
check('frames 1230..1236 == the game PCM ring (max |d| %d, mean %.2f)' % (worst, max(means)), worst <= 24 and max(means) < 6)

rows = bgm.sdb_rows(open(os.path.join(KEL, 'noPath', '06800008.bin'), 'rb').read())
r = rows['bgm_001']
check('sdb bgm_001: FileCode 0x0680fe01, flags 0x94 (loop), 6696 -> 14944',
      (r['code'], r['flags'], r['start'], r['end']) == (0x0680FE01, 0x94, 6696, 14944))
F, N = bgm.FRAME, bgm.SAMPLES
pcm, info = bgm.track(KEL, 128, 'bgm_001', r, k, d)
s0, e0, sm = 6696, 14944, info['seam']
check('track info: rate 48000, loop %d -> %d, seam %d' % (info['start'], info['end'], sm),
      info['rate'] == 48000 and (info['loop'], info['start'], info['end']) == (True, s0, e0) and sm >= 1)
check('loop samples [(start + seam) x 1024, (end + seam) x 1024), file ends at the loop end',
      info['loop_start_sample'] == (s0 + sm) * N and info['loop_end_sample'] == (e0 + sm) * N
      and info['samples'] == len(pcm) == info['loop_end_sample'])
game = bgm.atrac3_decode(st[:e0 * F] + st[s0 * F:(s0 + sm + 2) * F])      # the reader's sequence: e - 1, s, s + 1, ...
check('seam frames = frames start.. decoded after frame end - 1',
      np.array_equal(pcm[e0 * N:], game[e0 * N:(e0 + sm) * N]))
ls = info['loop_start_sample']
check('the loop target continues the game sequence',
      np.array_equal(pcm[ls:ls + 2 * N], game[(e0 + sm) * N:(e0 + sm + 2) * N]))

tmp = tempfile.mkdtemp()
try:
    sd = os.path.join(tmp, 'data', 'zone', 'z128', 'sound')
    os.makedirs(sd)
    open(os.path.join(sd, 'bgm_001.at3'), 'wb').write(raw[:300 * F])
    pc2, i2 = bgm.track(tmp, 128, 'bgm_001', dict(r, start=100, end=10 ** 6), k, d)
    check('end clamped to the file size (FUN_0024d730): 300 frames, loop end (300 + seam) x 1024',
          (i2['frames'], i2['end'], i2['loop_end_sample'], len(pc2)) == (300, 300, (300 + i2['seam']) * N, (300 + i2['seam']) * N))
    open(os.path.join(tmp, 'se_z128.json'), 'w').write(json.dumps(dict(zone=128, bgm=['bgm_002'])))
    ok1 = bgm.declare(tmp, 128, ['bgm_001'])
    check('declare: se_z128.json "bgm" lists the tracks; no se json -> False',
          ok1 and json.load(open(os.path.join(tmp, 'se_z128.json')))['bgm'] == ['bgm_001', 'bgm_002']
          and json.load(open(os.path.join(tmp, 'se_z128.json')))['zone'] == 128 and not bgm.declare(tmp, 129, ['x']))
finally:
    shutil.rmtree(tmp)

bgm.SEAM = 0
try:
    bgm.track(KEL, 128, 'bgm_001', r, k, d); seam_ok = False
except RuntimeError:
    seam_ok = True
check('seam check rejects SEAM = 0', seam_ok)
print(ok, 'passed')
