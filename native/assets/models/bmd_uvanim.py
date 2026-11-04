"""bmd_uvanim.py -- the room's scrolling UVs: which chains a chunk's animation file scrolls, and the curves.

Decoded (worker 0226, 2026-11-03; notes/room-blend-streaming.md "Scrolling UVs"):
- Each chunk loads an animation file next to its BMD: FileCode <level><chunk>10 (z128: 0680NN10), read by
  FUN_00266ae0 into the slot's +0x38 state; FUN_002680e0 allocates the slot's time array (+0x40, one float
  per animation) and zeroes it.
- Every frame FUN_00248110 -> FUN_00265350 -> FUN_00263e90(slot) for each loaded slot (+0x5c != 0,
  +0x58 == 0) -> FUN_0026c198(BMD, slot + 0x38, ...) per model of the slot's resource.
- FUN_0026c198, per animation i whose flags (+2) have bit 0 set and +6 == 0: each track (pointer list
  +8; curves list +0xc) names a node (track +0x10, the BMD's node table at header +0x1c; -1 = none).
  Track +0x26 -> node +0xdc = (short)(int)(u(t) * 4096), track +0x28 -> node +0xde =
  (short)(int)(-v(t) * 4096). (+0x2a -> node +0xd8 x 0.01, the texture blend factor: not handled here.)
  Then time[i] += DAT_004fc7e8 * 0.5 (1.2 in play; 0 when DAT_004fc7e4 == 1). Loop = flags bit 1 clear.
- Curves (FUN_00262328 / FUN_002621c8): u16 key count, u16 done flag, keys of 4 floats (time, value,
  in tangent, out tangent). Loop: t = fmodf(t, last key time). t <= first key time -> first value;
  t >= last key time -> last value; else cubic Hermite (matrix DAT_0046be50: 2 -2 1 1 / -3 3 -2 -1 /
  0 0 1 0 / 1 0 0 0) of (p_i, p_i+1, out_i * dt, in_i+1 * dt), dt = the key gap, s = (t - t_i) / dt.
- A node's chains: node +0xc4 (u16) indexes the BMD's mesh table (header +0x14); the mesh's +8 is a list
  of node +0xc8 chain draw objects (FUN_0026bc28). FUN_00265bf0 copies node +0xdc / +0xde to the chain
  object's +0xa4 / +0xa6, and FUN_00265560 sends them / 4096 as the chain's UV offset.
- Checked: save states c0b / c09 (tools/trace/out/room_grade/src): 272 / 272 node offsets in RAM = this
  evaluation at the time before the frame's advance; GS dump tp0b frames 0..3: dump UV - file UV = the
  offsets (+u, +v as stored) on 43 / 43 ff88 chains, exactly, the time 0.6 apart per frame.

Pointers in both files are offsets from their payload start (the game relocates them on load).
"""
import struct


def _u32(b, o):
    return struct.unpack_from('<I', b, o)[0]


def _s16(b, o):
    return struct.unpack_from('<h', b, o)[0]


def read_curve(an, c):
    """[[time, value, in, out], ...] of the curve at offset c."""
    n = struct.unpack_from('<H', an, c)[0]
    return [list(struct.unpack_from('<4f', an, c + 4 + 16 * i)) for i in range(n)]


def chunk_uv_tracks(an, bm, pay, chain_of_obj, warn):
    """UV tracks of one chunk.
    an: the animation file (bytes); bm / pay: the BMD file and its payload offset;
    chain_of_obj(file offset of a chain draw object) -> chain index (or None).
    Returns (anims, tracks, chain_track): anims = [{'index', 'loop'}] (one time each), tracks =
    [{'anim': position in anims, 'node', 'u': curve or None, 'v': curve or None}],
    chain_track = {chain index: position in tracks}. Problems go to warn (a list of strings)."""
    anims, tracks, chain_track = [], [], {}
    ntab = pay + _u32(bm, pay + 0x1c); mtab = pay + _u32(bm, pay + 0x14)
    for i in range(_u32(an, 0)):
        a = _u32(an, 4 + 4 * i)
        ntr, fl, _x, h3 = struct.unpack_from('<4h', an, a)
        tr = _u32(an, a + 8); cu = _u32(an, a + 0xc)
        rows = []
        for k in range(ntr):
            e = _u32(an, tr + 4 * k); node = _s16(an, e + 0x10)
            iu, iv = _s16(an, e + 0x26), _s16(an, e + 0x28)
            if node < 0 or (iu < 0 and iv < 0):
                continue
            rows.append((node, iu, iv))
        if not rows:
            continue
        if not (fl & 1) or h3:
            # not playing at load (started by a script, FUN_00268220): not handled
            warn.append('anim %d: UV tracks on nodes %s but not playing at load (flags %x, +6 %d); left out'
                        % (i, [r[0] for r in rows], fl, h3))
            continue
        if fl & 6 != 0:
            warn.append('anim %d: flags %x (one-shot / stop bits) not handled; left out' % (i, fl))
            continue
        ai = len(anims); anims.append({'index': i, 'loop': True})
        for node, iu, iv in rows:
            ti = len(tracks)
            tracks.append({'anim': ai, 'node': node,
                           'u': read_curve(an, _u32(an, cu + 4 * iu)) if iu >= 0 else None,
                           'v': read_curve(an, _u32(an, cu + 4 * iv)) if iv >= 0 else None})
            n = pay + _u32(bm, ntab + 4 * node)
            mi = struct.unpack_from('<H', bm, n + 0xc4)[0]; cnt = _u32(bm, n + 0xc8)
            if cnt <= 0:
                warn.append('anim %d node %d: no chains' % (i, node)); continue
            lst = pay + _u32(bm, pay + _u32(bm, mtab + 4 * mi) + 8)
            for j in range(cnt):
                c = chain_of_obj(pay + _u32(bm, lst + 4 * j))
                if c is None:
                    warn.append('anim %d node %d: chain object %d is not a chain start' % (i, node, j)); continue
                if c in chain_track:
                    warn.append('chain %d: scrolled by two tracks; the later one wins (as the game\'s write order)' % c)
                chain_track[c] = ti
    return anims, tracks, chain_track


def moved_node_chains(an, bm, pay, chain_of_obj):
    """(node, chain index) for every node with a position or rotation track in a chunk's animation file (FUN_0026c198; chunk_anim.js): the door and gate nodes."""
    out = []; seen = set()
    ntab = pay + _u32(bm, pay + 0x1c); mtab = pay + _u32(bm, pay + 0x14)
    for i in range(_u32(an, 0)):
        a = _u32(an, 4 + 4 * i)
        ntr = _s16(an, a); tr = _u32(an, a + 8)
        for k in range(ntr):
            e = _u32(an, tr + 4 * k); node = _s16(an, e + 0x10)
            pos = [_s16(an, e + o) for o in (0x14, 0x16, 0x18)]; rot = [_s16(an, e + o) for o in (0x1a, 0x1c, 0x1e)]
            if node < 0 or node in seen or (min(pos) < 0 and min(rot) < 0):
                continue
            seen.add(node)
            n = pay + _u32(bm, ntab + 4 * node)
            mi = struct.unpack_from('<H', bm, n + 0xc4)[0]; cnt = _u32(bm, n + 0xc8)
            if cnt <= 0:
                continue
            lst = pay + _u32(bm, pay + _u32(bm, mtab + 4 * mi) + 8)
            for j in range(cnt):
                c = chain_of_obj(pay + _u32(bm, lst + 4 * j))
                if c is not None:
                    out.append((node, c))
    return out

