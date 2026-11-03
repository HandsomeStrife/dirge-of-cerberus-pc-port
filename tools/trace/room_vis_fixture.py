#!/usr/bin/env python3
"""room_vis_fixture.py -- save-state fixture for native/web/test_room_vis.mjs (worker 0225).

For each PCSX2 save state, reads from EE RAM what FUN_00264ee0 (the room visibility probe) used and made:
  eye     DAT_004e4800..08 (FUN_00264ee0 stores the probe's eye there before the ray)
  slots   the chunk table DAT_004e4c60 (3 x 0x70): +0x54 chunk, +0x5c loaded, +0x44 cid resource
  m86f0   DAT_004e86f0 (4 words: the probe's half), m8700 (the scripts' half), m8710 (the OR)
Writes OUT (game state: must stay gitignored, default tools/trace/out/room_vis/states.json).

  python3 -I tools/trace/room_vis_fixture.py [-o OUT] STATE.p2s...
"""
import os, sys, json, struct, argparse
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from p2s import read_p2s


def read_state(path):
    ee = read_p2s(path)['eeMemory.bin']
    w4 = lambda a: list(struct.unpack_from('<4I', ee, a))
    slots = []
    for s in range(3):
        b = 0x4e4c60 + s * 0x70
        chunk, = struct.unpack_from('<i', ee, b + 0x54)
        loaded, = struct.unpack_from('<i', ee, b + 0x5c)
        cid, = struct.unpack_from('<I', ee, b + 0x44)
        slots.append({'chunk': chunk, 'loaded': loaded, 'cid': cid})
    return {'name': os.path.basename(path), 'eye': list(struct.unpack_from('<3f', ee, 0x4e4800)),
            'slots': slots, 'm86f0': w4(0x4e86f0), 'm8700': w4(0x4e8700), 'm8710': w4(0x4e8710)}


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('-o', '--out', default=os.path.join(HERE, 'out', 'room_vis', 'states.json'))
    ap.add_argument('states', nargs='+')
    a = ap.parse_args()
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    res = [read_state(p) for p in a.states]
    json.dump(res, open(a.out, 'w'), indent=1)
    for r in res:
        bits = [b for b in range(128) if r['m86f0'][b >> 5] >> (b & 31) & 1]
        print('%-28s eye %s slots %s 86f0 %s' % (r['name'][:28], [round(x, 1) for x in r['eye']],
              [(s['chunk'], s['loaded']) for s in r['slots']], bits))
    print('wrote', a.out)
