#!/usr/bin/env python3
"""room_occl_fixture.py -- save-state fixture for native/web/test_room_occl.mjs (worker 0233).

For each PCSX2 save state, reads from EE RAM what the room's occluder culling used and made (room_occl.js):
  view     the camera matrix 0x4fcb10 (16 floats, row vectors: world -> view), which FUN_0026c878 builds from
  slots    the chunk table DAT_004e4c60 (3 x 0x70): +0x54 chunk, +0x5c loaded
  volumes  DAT_0046bff8 and the volumes at DAT_004e5db0 (0x50 bytes each, as stored: the first 4 planes transposed)
  nodes    per loaded chunk, per bone-tree node in bmd_occl.tree's order: 'never' (every chain of the node still
           holds its file self pointer at +0xa4: FUN_0026ce60 overwrites it when a chain is drawn, so it was not drawn
           since the chunk loaded), 'seen' (some chain was drawn at some frame), '' (no chains)
Writes OUT (game state: must stay gitignored, default tools/trace/out/room_occl/states.json).

  python3 -I tools/trace/room_occl_fixture.py [-o OUT] STATE.p2s...
"""
import os, sys, json, struct, argparse
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, '..', '..', 'native', 'assets', 'models'))
from p2s import read_p2s
from export_bmd_textured import find_bmd_payload, EXTRACT
from bmd_occl import tree


def ram_payload(ee, buf, pay):
    """RAM address of the chunk's BMD payload: the root node's 0x80 box bytes are unique in RAM (or None)."""
    root = struct.unpack_from('<I', buf, pay + 0x20)[0]
    sig = buf[pay + root:pay + root + 0x80]
    i = ee.find(sig)
    if i < 0 or ee.find(sig, i + 1) >= 0:
        return None
    return i - root


def read_state(path):
    ee = read_p2s(path)['eeMemory.bin']
    slots = []
    for s in range(3):
        b = 0x4e4c60 + s * 0x70
        slots.append({'chunk': struct.unpack_from('<i', ee, b + 0x54)[0], 'loaded': struct.unpack_from('<i', ee, b + 0x5c)[0]})
    n = struct.unpack_from('<i', ee, 0x46bff8)[0]
    vols = [list(struct.unpack_from('<20f', ee, 0x4e5db0 + 0x50 * k)) for k in range(max(0, min(n, 15)))]
    nodes = {}
    for s in slots:
        if not s['loaded']:
            continue
        cid = '0680%02x12' % s['chunk']
        buf = open(os.path.join(EXTRACT, cid + '.bin'), 'rb').read(); pay = find_bmd_payload(buf)
        base = ram_payload(ee, buf, pay)
        if base is None:
            print('%s: chunk %02x not found once in RAM; no node marks' % (os.path.basename(path), s['chunk']))
            continue
        nd, _ = tree(buf, pay)
        marks = []
        for x in nd:
            o = pay + x['off']; nc = struct.unpack_from('<I', buf, o + 0xa0)[0]
            if not nc:
                marks.append(''); continue
            objs = [struct.unpack_from('<I', buf, o + 0xb0 + 16 * k)[0] for k in range(nc)]
            never = all(struct.unpack_from('<I', ee, base + c + 0xa4)[0] == c for c in objs)
            marks.append('never' if never else 'seen')
        nodes[str(s['chunk'])] = marks
    return {'name': os.path.basename(path), 'view': list(struct.unpack_from('<16f', ee, 0x4fcb10)),
            'slots': slots, 'count': n, 'volumes': vols, 'nodes': nodes}


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('-o', '--out', default=os.path.join(HERE, 'out', 'room_occl', 'states.json'))
    ap.add_argument('states', nargs='+')
    a = ap.parse_args()
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    res = [read_state(p) for p in a.states]
    json.dump(res, open(a.out, 'w'))
    for r in res:
        print('%-28s slots %s volumes %d marks %s' % (r['name'][:28], [(s['chunk'], s['loaded']) for s in r['slots']],
              r['count'], {k: sum(m == 'never' for m in v) for k, v in r['nodes'].items()}))
    print('wrote', a.out)
