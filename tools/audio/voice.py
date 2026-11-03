#!/usr/bin/env python3
"""voice.py -- Dirge of Cerberus event voices (data/event/scene/evNNNN/sound/<name>.at2) -> native/web/data/audio/voice/
(gitignored game data).

  python3 -I tools/audio/voice.py [--kel extract/_KEL] [--zone 128] [--event 100] [--names 10109vn 10109v2 10110sk]

Writes, per voice: <name>.flac (48 kHz mono PCM, lossless) and voice.json (name -> samples, file, FileCode, row +0x14).
Decoded from the game's EE code (worker 0222, notes/event-vm-research.md "Event sound"):

  - name -> sdb row (the zone's sdb.bin 06zz0008, FUN_003eb9a0 / FUN_003eb868): +8 FileCode 0x0c06450n, +0xc bit 1
    (a stream), +0x14 the voice's length in ms (scr001 sleeps exactly that after playVoice).
  - loadVoice2 (FUN_003a0968 -> FUN_00378c88: command 0x11) loads the file; playVoice (FUN_003a0900 -> FUN_003eaf10(pi/4,
    name, 0) -> FUN_003ead30 -> FUN_003eacb8) sets the channel's gains (cos, sin)(pi / 4) x 4096 = 2896 / 2896 and
    starts it (channel +0x1c bit 1).
  - FUN_003ed000, per 1024-sample frame of the music's 48 kHz PCM ring, for each of the 6 voice channels:
    FUN_003eaf90 -> FUN_003eab20 decodes the next 0x60-byte frame with libat3dec (FUN_00458e80: plain ATRAC3, mono,
    not scrambled) and returns no block for the frame at offset 0; FUN_003eb330 adds block x gain >> 12 to L and R
    (pmulth / psraw 12 / paddsh). So: 48 kHz, sample for sample (no resampling), the first decoded frame dropped.
  - assumed: DAT_0047d748 = 1. FUN_003ed000 calls FUN_003eaf90 DAT_0047d748 times per channel per 1024-sample frame and
    mixes only the last block; 1 is its initial value in the ELF data (worker 0237) and the decomp has no writer, so one
    0x60-byte frame per 1024 samples. L: a write through a pointer is not ruled out; with N > 1 every Nth frame would play.
  - sign: libat3dec's output is libavcodec's negated (tools/audio/bgm.py), kept here.
"""
import argparse
import json
import os
import struct
import subprocess
import sys
import tempfile
import wave

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bgm import ATDEC, sdb_rows  # noqa: E402

FRAME = 0x60           # FUN_003eab20: +0x10 += 0x60 per decoded frame
SAMPLES = 1024
RATE = 48000           # mixed into the 48 kHz music ring 1:1 (FUN_003eb330)


def decode(raw):
    import numpy as np
    with tempfile.TemporaryDirectory() as tmp:
        src, dst = os.path.join(tmp, 'v.at2'), os.path.join(tmp, 'v.wav')
        open(src, 'wb').write(raw[:len(raw) // FRAME * FRAME])
        r = subprocess.run([ATDEC, src, dst, '--at3', '--ch', '1', '--block', str(FRAME)], capture_output=True, text=True)
        if r.returncode or 'errors=0' not in r.stdout + r.stderr:
            raise RuntimeError('dirge_atdec: ' + r.stdout + r.stderr)
        w = wave.open(dst)
        pcm = np.frombuffer(w.readframes(w.getnframes()), '<i2').astype(np.int32)
    pcm = np.clip(-pcm, -32768, 32767).astype(np.int16)      # libat3dec's sign
    return pcm[SAMPLES:]                                      # FUN_003eab20: the offset-0 frame is never mixed


def write_flac(path, pcm):
    with tempfile.TemporaryDirectory() as tmp:
        w = os.path.join(tmp, 'a.wav')
        with wave.open(w, 'wb') as f:
            f.setnchannels(1); f.setsampwidth(2); f.setframerate(RATE); f.writeframes(pcm.tobytes())
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', w, '-c:a', 'flac', path], check=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--kel', default='extract/_KEL')
    ap.add_argument('--zone', type=int, default=128)
    ap.add_argument('--event', type=int, default=100)
    ap.add_argument('--out', default='native/web/data/audio/voice')
    # the opening event's (ev0101.first_event: loadVoice2 / playVoice)
    ap.add_argument('--names', nargs='*', default=['10109vn', '10109v2', '10110sk', '10201vn'])
    a = ap.parse_args()
    rows = sdb_rows(open(os.path.join(a.kel, 'noPath', '%08x.bin' % (0x06000000 | a.zone << 16 | 8)), 'rb').read())
    os.makedirs(a.out, exist_ok=True)
    jpath = os.path.join(a.out, 'voice.json')
    meta = json.load(open(jpath)) if os.path.exists(jpath) else {}
    for name in a.names:
        row = rows[name]
        assert row['flags'] & 2, name + ': not a stream row'
        raw = open(os.path.join(a.kel, 'data', 'event', 'scene', 'ev%04d' % a.event, 'sound', name + '.at2'), 'rb').read()
        pcm = decode(raw)
        write_flac(os.path.join(a.out, name + '.flac'), pcm)
        meta[name] = dict(file=name + '.flac', rate=RATE, samples=len(pcm), frames=len(raw) // FRAME,
                          code='0x%08x' % row['code'], ms=row['end'])
        print(name, meta[name])
    json.dump(meta, open(jpath, 'w'), indent=1)


if __name__ == '__main__':
    main()
