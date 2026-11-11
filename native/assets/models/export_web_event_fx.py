#!/usr/bin/env python3
"""Event effect FEDs for native/web/event_fx.js (worker 0275).

KerberosEffect.load(n) (FUN_003a2580 -> FUN_0037f2f0: command 0x18 -> FUN_00381a08) loads
data/effect/anything/a<n // 50 x 50>/a<n>/fer/a<n>.fed, FileCode 0x80000000 | n << 18 (FUN_002df168: letter a = 8).
The page needs the opening's a0001 (Effect.load(1) in first_event: the scanner SCOPE01_*, HINOKO, HEAD*).
The files are copied as they are (game data: written under native/web/data, which is gitignored).

  python3 -I native/assets/models/export_web_event_fx.py --disc <extract/_KEL> -o native/web/data/event/fx
"""
import argparse
import os

LOADS = [1]                       # the Effect.load numbers exported (first_event's)


def fed_path(n):
    return 'data/effect/anything/a%04d/a%04d/fer/a%04d.fed' % (n // 50 * 50, n, n)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--disc', required=True, help='the unpacked KEL root (extract/_KEL)')
    ap.add_argument('-o', required=True, help='output directory (native/web/data/event/fx)')
    a = ap.parse_args()
    os.makedirs(a.o, exist_ok=True)
    for n in LOADS:
        b = open(os.path.join(a.disc, fed_path(n)), 'rb').read()
        code = int.from_bytes(b[4:8], 'little')
        if b[:4] != b'FED\x08' or code != (0x80000000 | n << 18):
            raise SystemExit('%s: not FED %#x' % (fed_path(n), 0x80000000 | n << 18))
        with open(os.path.join(a.o, 'a%04d.fed' % n), 'wb') as f:
            f.write(b)
        print('a%04d.fed: FED %#x, %d bytes' % (n, code, len(b)))


if __name__ == '__main__':
    main()
