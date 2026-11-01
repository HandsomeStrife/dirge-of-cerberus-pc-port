#!/usr/bin/env python3
"""bgm.py -- Dirge of Cerberus zone music (bgm_NNN.at3) -> native/web/data/audio/bgm/ (gitignored game data).

  python3 -I tools/audio/bgm.py [--kel extract/_KEL] [--elf elf/SLES_541.85] [--zone 128] [--names bgm_001 ...]

Writes, per track: bgm_NNN.flac (48 kHz stereo PCM, lossless) and bgm.json (zone -> track -> loop points), and
lists the tracks in the zone's se_zNNN.json ("bgm", from tools/audio/extract.py): the page fetches bgm.json only when
that list is there, so a page without the BGM makes no failing request.
Decoded from the game's EE code (notes/audio-research.md "Music"):

  - file: sdb row +8 = FileCode 0x06zzXXnn; FUN_003ebd40 sets byte 1 to 0xfe (DAT_0047d714 != 0, stereo; 2 in the
    sea-of-flames save) or 0xfc (0: the mono 'm' file). On disc: data/zone/zNNN/sound/<name>.at3 / <name>m.at3.
  - scramble: FUN_003ed000 runs FUN_003eb9e8(frame, 0x180, 0x4fabc0) on every 0x180-byte frame before decoding.
    Per 0x60-byte block of 6 x 16 bytes q0..q5 (all read before any write): q0 ^= K, qi ^= q(i-1) ^ D(i-1).
    K = FUN_003edb18(0x4fabc0): K[i] = byte 0x47d7c0 + (i & 15) + ((i ^ 15) & 15) * 16; D0..D4 = 0x47d7d0..0x47d810.
  - codec: libat3dec (FUN_00458dc8 mode 1 -> FUN_0045af90(2 channels, coding mode 2, 0xc0 bytes per channel)):
    plain ATRAC3, 1024 samples a frame. The decoder writes 4 x (256 L, 256 R) s16 (FUN_00458e80 / FUN_0045af64).
    Decoded here with libavcodec's atrac3 (native/assets/audio/dirge_atdec); its output is the game's with the
    sign flipped (checked against the PCM ring in the save, see the note), so samples are negated.
  - rate: 48 kHz. The IOP takes one 1024-sample frame per 1024 / 48000 s (trace w177_music: 46.77 frames/s).
  - loop: sdb row +0xc bit 0x10 -> loop start / end frames = row +0x10 / +0x14 (FUN_003ec680). The reader
    FUN_003ebda0 -> FUN_0024f870 -> FUN_0024d730 jumps from end * 0x180 back to start * 0x180 and the decoder runs on
    (no reset), so after the jump frame `start` is decoded with frame end - 1's state. The file therefore holds
    frames [0, end) and then SEAM frames decoded after end - 1; the page loops [start + SEAM, end + SEAM) frames.
    Without bit 0x10 the stream plays once (FUN_0024d730 zero-fills past the file end).
"""
import argparse
import json
import os
import struct
import subprocess
import sys
import tempfile
import wave

ATDEC = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'native', 'assets', 'audio', 'dirge_atdec')
FRAME = 0x180          # bytes per stereo frame (2 x 0xc0)
SAMPLES = 1024         # per frame and channel
RATE = 48000
SEAM = 4               # frames re-decoded after the loop jump (they must match the first pass from there on)


def elf_read(elf, va, n):
    """The ELF's first PT_LOAD segment (file 0x100 -> va 0x100000) holds the tables."""
    off, = struct.unpack_from('<I', elf, 0x1c)
    _t, foff, vaddr, _p, fsz = struct.unpack_from('<5I', elf, off)
    assert vaddr <= va and va + n <= vaddr + fsz, hex(va)
    return elf[foff + va - vaddr:foff + va - vaddr + n]


def scramble_keys(elf):
    tab = elf_read(elf, 0x47D7C0, 0x100)
    k = bytes(tab[(i & 15) + ((i ^ 15) & 15) * 16] for i in range(16))       # FUN_003edb18
    d = [elf_read(elf, 0x47D7D0 + 16 * i, 16) for i in range(5)]            # FUN_003eb9e8's _DAT_0047d7d0..810
    return k, d


def descramble(data, k, d):
    """FUN_003eb9e8 over the whole stream (every 0x60-byte block is independent)."""
    import numpy as np
    a = np.frombuffer(data[:len(data) // 0x60 * 0x60], np.uint8).reshape(-1, 6, 16)
    o = a.copy()
    o[:, 0] ^= np.frombuffer(k, np.uint8)
    for i in range(1, 6):
        o[:, i] = a[:, i] ^ a[:, i - 1] ^ np.frombuffer(d[i - 1], np.uint8)
    return o.tobytes()


def atrac3_decode(stream):
    """Plain ATRAC3 frames (0x180 bytes, 2 channels) -> int16 array (n, 2), the game's sign."""
    import numpy as np
    with tempfile.TemporaryDirectory() as tmp:
        src, dst = os.path.join(tmp, 's.at3'), os.path.join(tmp, 's.wav')
        open(src, 'wb').write(stream)
        r = subprocess.run([ATDEC, src, dst, '--at3', '--ch', '2', '--block', str(FRAME)], capture_output=True, text=True)
        if r.returncode or 'errors=0' not in r.stdout + r.stderr:
            raise RuntimeError('dirge_atdec: ' + r.stdout + r.stderr)
        w = wave.open(dst)
        pcm = np.frombuffer(w.readframes(w.getnframes()), '<i2').reshape(-1, 2).astype(np.int32)
    return np.clip(-pcm, -32768, 32767).astype(np.int16)       # libat3dec's output = -libavcodec's


def sdb_rows(d):
    """sdb.bin (FileCode 06zz0008): 24-byte rows, char[8] name, +8 u32 FileCode, +0xc flags, +0x10 / +0x14."""
    rows = {}
    for p in range(0, len(d) - 23, 24):
        name = d[p:p + 8].split(b'\0')[0].decode('latin1')
        code, flags, a, b = struct.unpack_from('<4I', d, p + 8)
        rows[name] = dict(code=code, flags=flags, start=a, end=b)
    return rows


def track(kel, zone, name, row, k, d):
    import numpy as np
    path = os.path.join(kel, 'data', 'zone', 'z%03d' % zone, 'sound', name + '.at3')
    raw = open(path, 'rb').read()
    n = len(raw) // FRAME
    stream = descramble(raw, k, d)
    loop = bool(row['flags'] & 0x10)
    if loop:
        s, e = row['start'], min(row['end'], n)                   # FUN_0024d730: end clamped to the file size
        assert 0 <= s < e
        seq = stream[:e * FRAME] + stream[s * FRAME:(s + SEAM) * FRAME]
        pcm = atrac3_decode(seq)
        first = atrac3_decode(stream[:e * FRAME])
        # From frame s + SEAM on, the re-decode after the jump must equal the first pass (state converged).
        tail = atrac3_decode(stream[:e * FRAME] + stream[s * FRAME:(s + SEAM + 2) * FRAME])
        same = np.array_equal(tail[(e + SEAM) * SAMPLES:(e + SEAM + 2) * SAMPLES], first[(s + SEAM) * SAMPLES:(s + SEAM + 2) * SAMPLES])
        if not same:
            raise RuntimeError('%s: decoder state has not converged %d frames after the loop jump' % (name, SEAM))
        info = dict(frames=n, loop=True, start=s, end=e, seam=SEAM,
                    loop_start_sample=(s + SEAM) * SAMPLES, loop_end_sample=(e + SEAM) * SAMPLES)
    else:
        pcm = atrac3_decode(stream[:n * FRAME])
        info = dict(frames=n, loop=False)
    info.update(rate=RATE, samples=len(pcm), file=name + '.flac', code='0x%08x' % row['code'], flags='0x%x' % row['flags'])
    return pcm, info


def declare(se_dir, zone, names):
    """Adds names to se_zNNN.json's "bgm" list (extract.py keeps the list when it rewrites the file)."""
    p = os.path.join(se_dir, 'se_z%03d.json' % zone)
    if not os.path.exists(p):
        print('note: %s missing (python3 -I tools/audio/extract.py), the page will not play the BGM' % p)
        return False
    se = json.load(open(p))
    se['bgm'] = sorted(set(se.get('bgm', [])) | set(names))
    json.dump(se, open(p, 'w'))
    return True


def write_flac(path, pcm):
    with tempfile.TemporaryDirectory() as tmp:
        w = os.path.join(tmp, 'a.wav')
        with wave.open(w, 'wb') as f:
            f.setnchannels(2); f.setsampwidth(2); f.setframerate(RATE); f.writeframes(pcm.tobytes())
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', w, '-c:a', 'flac', path], check=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--kel', default='extract/_KEL')
    ap.add_argument('--elf', default='elf/SLES_541.85')
    ap.add_argument('--zone', type=int, default=128)
    ap.add_argument('--out', default='native/web/data/audio/bgm')
    # bgm_001: what z128's gameplay plays (ev0101's playMusic3("bgm_001", 0, 4000); BGM_001.AT3 in the save)
    ap.add_argument('--names', nargs='*', default=['bgm_001'])
    a = ap.parse_args()
    elf = open(a.elf, 'rb').read()
    k, d = scramble_keys(elf)
    code = 0x06000000 | a.zone << 16 | 8          # FUN_0024a828 case 8: 06zz0008 = the zone's sdb.bin
    rows = sdb_rows(open(os.path.join(a.kel, 'noPath', '%08x.bin' % code), 'rb').read())
    os.makedirs(a.out, exist_ok=True)
    jpath = os.path.join(a.out, 'bgm.json')
    meta = json.load(open(jpath)) if os.path.exists(jpath) else {}
    z = meta.setdefault('z%03d' % a.zone, {})
    for name in a.names:
        row = rows[name]
        pcm, info = track(a.kel, a.zone, name, row, k, d)
        write_flac(os.path.join(a.out, info['file']), pcm)
        z[name] = info
        print(name, info)
    json.dump(meta, open(jpath, 'w'), indent=1)
    declare(os.path.dirname(os.path.normpath(a.out)), a.zone, a.names)


if __name__ == '__main__':
    main()
