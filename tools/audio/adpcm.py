#!/usr/bin/env python3
"""adpcm.py -- PS2 SPU2 ADPCM (VAG) reference decoder. Hardware format, not game-specific.

16-byte blocks: byte 0 = filter << 4 | shift, byte 1 = flags (bit 0 loop end, bit 1 repeat,
bit 2 loop start), 14 bytes = 28 4-bit samples, low nibble first.
  s = (s16)(nibble << 12) >> shift;  s += (h1 * POS[f] + h2 * NEG[f]) >> 6;  clamp to s16
Filter pairs (x/64): POS = 0, 60, 115, 98, 122; NEG = 0, 0, -52, -55, -60.
A block with flag bit 0 ends the sample: with bit 1 the voice jumps to the loop start,
without it the voice stops. decode() stops after the first end block and returns the loop
start (sample index) when the sample repeats, else None.
"""
import struct
import wave

POS = (0, 60, 115, 98, 122, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)
NEG = (0, 0, -52, -55, -60, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)


def decode(data, start, max_blocks=1 << 20):
    out = []
    h1 = h2 = 0
    loop = None
    p = start
    for _ in range(max_blocks):
        if p + 16 > len(data):
            break
        hdr, flags = data[p], data[p + 1]
        shift, filt = hdr & 0xF, hdr >> 4
        if shift > 12:                 # SPU2 treats shift 13..15 as 9 (PCSX2 Voice.cpp)
            shift = 9
        if flags & 4:
            loop = len(out)
        for i in range(28):
            b = data[p + 2 + (i >> 1)]
            n = (b >> 4) if (i & 1) else (b & 0xF)
            s = ((n << 12) & 0xFFFF)
            if s & 0x8000:
                s -= 0x10000
            s >>= shift
            s += (h1 * POS[filt] + h2 * NEG[filt]) >> 6
            s = max(-32768, min(32767, s))
            out.append(s)
            h2, h1 = h1, s
        p += 16
        if flags & 1:
            return out, (loop if flags & 2 else None)
    return out, None


def write_wav(path, pcm, rate):
    w = wave.open(path, 'wb')
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(rate)
    w.writeframes(struct.pack('<%dh' % len(pcm), *pcm))
    w.close()
