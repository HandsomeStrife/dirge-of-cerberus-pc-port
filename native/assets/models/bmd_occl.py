"""bmd_occl.py -- the room BMD's bone tree and occluder quads (worker 0233; notes/room-blend-streaming.md
'Occluder culling').

Decoded from the game (SLES_541.85):
- The room model is the BMD payload (RFD entry + 0x10). FUN_0026c670 walks its tree from the root node at
  header +0x20 with FUN_0026ccc8. A node: +0x00..+0x7f 8 box corners (vec4; the VU0 box test FUN_0026cc80 takes
  corners 0 and 7 as min / max), +0x80 8 child offsets (0 = none, walked in slot order 0..7), +0xa0 chain count,
  +0xb0 the chain list (16 bytes per entry, +0 the chain draw object's offset). Offsets are from the payload.
- FUN_0026ccc8 draws a node's chains, then recurses into each child that passes the frustum box test AND is not
  wholly inside an occluder volume (FUN_00269978(child, 8): all 8 corners inside one volume). The root itself is
  never occluder-tested, so its own chains always draw.
- Header +0x18: the occluder list (0 = none): +0 count, +0x10 the entries, 0xe0 bytes each; an entry's first
  4 vec4 are the quad's corners in world space (strip order 0, 1, 2, 3; the rest is runtime scratch:
  FUN_0026c878 zeroes +0x90). FUN_00269868 -> FUN_00268b58 -> FUN_0026c878 build the volumes from them every
  frame (room_occl.js).

tree(buf, pay) -> (nodes, chain_node): nodes in walk order (pre-order, children 0..7), each
{'off', 'parent' (-1 for the root), 'box' (8 x [x, y, z])}; chain_node = {chain draw object offset: node index}.
occluders(buf, pay) -> [[c0, c1, c2, c3]] ([x, y, z] each).
Failure direction: a malformed tree (an offset out of the file, a loop) raises ValueError; the exporter then
exports no tree for that chunk (every chain drawn, as before), never a wrong one.
"""
import struct


def _u32(b, o):
    return struct.unpack_from('<I', b, o)[0]


def tree(buf, pay):
    N = len(buf)
    root = _u32(buf, pay + 0x20)
    nodes, chain_node, seen = [], {}, set()
    stack = [(root, -1)]
    while stack:
        off, parent = stack.pop()
        o = pay + off
        if off in seen or o + 0xb0 > N:
            raise ValueError('node 0x%x: loop or out of the file' % off)
        seen.add(off)
        i = len(nodes)
        box = [list(struct.unpack_from('<3f', buf, o + 16 * k)) for k in range(8)]
        nodes.append({'off': off, 'parent': parent, 'box': box})
        nc = _u32(buf, o + 0xa0)
        if o + 0xb0 + 16 * nc > N:
            raise ValueError('node 0x%x: %d chains past the file' % (off, nc))
        for k in range(nc):
            chain_node[_u32(buf, o + 0xb0 + 16 * k)] = i
        kids = [_u32(buf, o + 0x80 + 4 * k) for k in range(8)]
        for k in reversed(kids):           # pop order = slot order 0..7 (FUN_0026ccc8's loop)
            if k:
                stack.append((k, i))
    return nodes, chain_node


def occluders(buf, pay):
    off = _u32(buf, pay + 0x18)
    if not off:
        return []
    o = pay + off
    n = _u32(buf, o)
    if o + 0x10 + 0xe0 * n > len(buf):
        raise ValueError('occluder list at 0x%x: %d entries past the file' % (off, n))
    return [[list(struct.unpack_from('<3f', buf, o + 0x10 + 0xe0 * k + 16 * j)) for j in range(4)] for k in range(n)]
