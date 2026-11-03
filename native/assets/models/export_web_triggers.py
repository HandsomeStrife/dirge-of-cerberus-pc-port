#!/usr/bin/env python3
"""Trigger volumes and event scripts for the enemy AI on play.html (native/web/enemy_ai.js),
read from the z128 stage file 06800001.bin at build time. Writes <out>/ai.json (gitignored
game data). Decode notes: notes/enemy-research.md §8 / §9, notes/enemy-ai-hook.md.

Decoded (D) layout, read here, nothing copied into the repo:
  - section table at +0x24 (16 B: offset, count, stride); tools/stage_events.py reads the same.
  - section 8 = trigger volumes (0xc0 B; object class vtable 0x58cdf8, record at object +0xd4):
    +0x00 matrix (row 3 = position), +0x40 inverse, +0x80 / +0x90 local box min / max,
    +0xa0 s16 script index, +0xa4 flags, +0xaa shape (FUN_005517a8, FUN_005507a0).
  - section 2 / 3 = event scripts (FUN_00310d20, FUN_0036fd58, FUN_0036fdc8): per script a table
    of (event id, fn index); per fn +8 local count, code = 8-byte (op, imm) instructions.
  - section 1 = actor placements (0x74 B): +0 parameter set, +8 AI mode, +4 s16 script index (object +0x34;
    record 44 -> 108, 45 -> 109, 66 -> 92 as notes §8), +0xc position, +0x1c facing,
    +0x40 override bits (status +0x0c, FUN_00315050), +0x54 weapon index.
  - weapon index (FUN_00318718): override bit 0x16 set -> record +0x54, else the parameter set
    (section 0) +0x88; -1 = none. FUN_00318610 then points status +0xac at that section-24 record.
  - section 24 = enemy weapons (0x104 B; FUN_00311600): the first 0x78 B are W (layout as
    export_web_aim.py): +4 flags, +0x16 s8 pellets, +0x18 f range, +0x2c f speed, +0x40 s16
    damage, +0x42 first delay, +0x44 interval, +0x46 reload, +0x48 magazine, +0x4a u8 hit value.
    z128 records 44 / 45 (#66 / #67) -> weapon 2 = the values in the save's RAM (notes §9.1).
  - section 1 / 0 max HP and level per record (FUN_00314ea8, see records()).
  - e027's part boxes (marker.mkd box array, FUN_0030baa0; see hitboxes()).
  - hit-zone records per section-19 index (parameter set +0x84; FUN_003153d0 / FUN_0030fc68; see zone_set()).
  - e027 clip frame counts (r_gst, r_gst_lk, r_st_a, r_st_f) from its rifle clip set, through
    export_web_enemy.py's loaders (anim_rot.clip_frames).
  - per record its stance (FUN_00559748 -> FUN_00564228, see stance_of) and the stance table of
    the stage's 'bmd' file 06800009.bin (FUN_0030f688 -> FUN_0030fb78 = G+0x84; see stances()):
    stance flags (C+0x808, FUN_0030fc38) and the motion-id -> clip-name rows (C+0x7fc, FUN_0030fc08).
  - per zone set the actor size (FUN_00563fc0, see zone_size) and every z128 enemy type's part
    boxes; clip frame counts per model for the motions enemy_ai.js requests (model_clips).

  - section 9 = stage paths (0x20 B; FUN_00311120 = FUN_00310b40(9) + stride x i): +0 s16 node count,
    +2 s16 (not read by the path mover), +4 first node (section-10 index), +8 flags (bit 0 loop, bits 1 / 2
    spline choice FUN_0034f4a0, bit 3 -> mover 0xe instead of 1, FUN_0055a6d8), +0xc spline tension
    (C+0x210, FUN_0034edf0 -> FUN_0025fcc8 / FUN_0025fd58), +0x10 path length.
  - section 10 = path nodes (0x60 B; FUN_00311180): +0x14 flags (bit 0 = straight segment, FUN_0034f4a0
    with path flags 6), +0x18 segment length (FUN_0034edf0 / FUN_0034f4a0 -> C+0x31c), +0x20 / +0x30 /
    +0x40 rows, +0x50 position (the spline's control point, FUN_0034f4a0 -> FUN_0034aea8).
    The path walk (cmd 0x131) is notes/enemy-ai-hook.md 'Path walking'.
  - sections 5 / 6 / 7 = the nav graph (FUN_0033ef48 -> FUN_0033d918(graph, sec 7, sec 5, sec 6) at
    DAT_0046e878 +0x10; needs G+0x64 >= 0x13): section 7 = header (+2 s16 node count), section 5 = nodes
    (0x20 B: words 0-2 low 24 bits = x / y / z x 256 (psllw / psraw 8, vitof12, x16), +7 s8 link count,
    +0xc u16 first link, +0xe area byte (FUN_003667b0 compares two), +0x1d / +0x1e runtime counts),
    section 6 = links (8 B: +2 s16 neighbour node, +4 u8 cost x 100, +5 flags: bit 0 closed (FUN_0033e5d0),
    bit 1 +100, bit 4 vertical). ai.json `nav` = {nodes: [x, y, z, links, first, area], links: [to, cost,
    flags]}; notes/enemy-ai-hook.md 'Nav graph'.

  - the ELF's sound-name tables (worker 0173; ai.json `se`, see se_tables()): read from elf/SLES_541.85.

Usage: export_web_triggers.py STAGE.bin OUTDIR [ELF]
(the stance file is read from STAGE's directory: 06800009.bin next to 06800001.bin)
"""
import json, os, struct, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, '../../../tools'))
import stage_events as SE          # noqa: E402  (section / script readers, decoded there)

TRIG_STRIDE = 0xc0
SEC1_STRIDE = 0x74
SEC24_STRIDE = 0x104
AI_CLIPS = ('r_gst', 'r_gst_lk', 'r_st_a', 'r_st_f', 'r_stlld0', 'r_stlaf0', 'r_stbf0')
# motion ids enemy_ai.js requests (FUN_0055b8e0 / FUN_00345818 index C+0x7fc rows): 0 / 2 idle (GUESS
# which one the brain starts), 1 the flinch's end without the gun out (FUN_00598950), 0x40 aim (r_st_a for stance 0x1f), 0x57 fire (r_st_f), 0x28 / 0x2b /
# 0x2c the flinch / death rows the k_hits12 trace shows (r_stlld0 / r_stbf0 / r_stlaf0), 0x78 crouched aim
# (motions 0x18 / 0x16 / 0xf: FUN_005978e8 / FUN_005971d8 / FUN_00597c60) and 0x7b crouched fire (0xf),
# 0x09 / 0x10 the walk / run rows of the locomotion table (motion state 8, FUN_00594f98 -> FUN_00345b58(C, 1, 9, 0x10))
AI_MOTIONS = (0x00, 0x01, 0x02, 0x40, 0x57, 0x28, 0x2b, 0x2c, 0x78, 0x7b, 0x09, 0x10)
STANCE_FILE = '06800009.bin'      # z128's 'bmd' file (stage 0x0680, k 9)


def f32s(d, o, n):
    return [round(x, 6) for x in struct.unpack_from('<%df' % n, d, o)]


def triggers(d):
    so, n, stride = SE.sections(d)[8]
    if stride != TRIG_STRIDE:
        raise ValueError('section 8 stride %#x, expected %#x' % (stride, TRIG_STRIDE))
    out = []
    for k in range(n):
        r = so + k * stride
        out.append(dict(
            idx=k,
            m=[f32s(d, r + 16 * i, 4) for i in range(4)],
            inv=[f32s(d, r + 0x40 + 16 * i, 4) for i in range(4)],
            lo=f32s(d, r + 0x80, 3), hi=f32s(d, r + 0x90, 3),
            script=struct.unpack_from('<h', d, r + 0xa0)[0],
            flags=SE.u32(d, r + 0xa4), shape=d[r + 0xaa]))
    # resolved activations / wakes for the save (stage_events.activations: difficulty 1, flag0 = 0;
    # informational: the page runs the scripts themselves in enemy_ai.js's VM)
    nscr = len(SE.scripts(d))
    for t in out:
        t['acts'] = SE.activations(d, t['script']) if 0 <= t['script'] < nscr else []
    return out


def paths(d):
    """Section 9 paths with their section-10 nodes (FUN_00311120 / FUN_003217e0 / FUN_00311180)."""
    sec = SE.sections(d)
    o9, n9, s9 = sec[9]
    o10, n10, s10 = sec[10]
    if s9 != 0x20 or s10 != 0x60:
        raise ValueError('section 9 / 10 stride %#x / %#x, expected 0x20 / 0x60' % (s9, s10))
    out = []
    for k in range(n9):
        r = o9 + k * s9
        cnt, s2, first, flags = struct.unpack_from('<hhiI', d, r)
        tension, length = struct.unpack_from('<2f', d, r + 0xc)
        nodes = []
        for j in range(first, first + max(cnt, 0)):
            if not 0 <= j < n10:
                raise ValueError('path %d node %d outside section 10 (%d)' % (k, j, n10))
            q = o10 + j * s10
            nodes.append(dict(pos=f32s(d, q + 0x50, 4), seg=f32s(d, q + 0x18, 1)[0], flags=SE.u32(d, q + 0x14)))
        out.append(dict(idx=k, n=cnt, s2=s2, first=first, flags=flags, tension=round(tension, 6),
                        length=round(length, 6), nodes=nodes))
    return out


def areas(d):
    """Section 11 areas (worker 0223, notes/npc-research.md "Areas"): FUN_00547bc8 makes one object per record
    (class 4, vt 0x58c308, FUN_0054ee88: obj +0xe4 = record k, +0xe8 = the record) and fills manager +0x2b4[+0xa0]
    (cmd 0x3b, FUN_0053b920 = the lookup gimmicks / placed sounds / ... parent to). Box FUN_0054f0d8: [+0x30 + lo,
    +0x30 + hi] (+0x80 / +0x90, no rotation); +0xa4..+0xa7 = up to four neighbour area indices (s8, -1 = none)."""
    o, n, s = SE.sections(d)[11]
    out = []
    for k in range(n):
        r = o + k * s
        p = struct.unpack_from('<3f', d, r + 0x30)
        lo = struct.unpack_from('<3f', d, r + 0x80)
        hi = struct.unpack_from('<3f', d, r + 0x90)
        out.append(dict(k=k, idx=struct.unpack_from('<i', d, r + 0xa0)[0], pos=list(p), lo=list(lo), hi=list(hi),
                        nb=list(struct.unpack_from('<4b', d, r + 0xa4))))
    return out


def locators(d):
    """Section 16 locators (worker 0212): manager cmd 0x40 (FUN_00545b20) -> FUN_0053c088(mgr, out, r0) -> FUN_003113f8(r0):
    record r0 of section 0x10 (stride +8), 4x4 matrix at +0; +0x41 = parent object (-1 = none: the matrix is the world
    one). [m (16 floats), parent byte]."""
    o, n, st = SE.sections(d)[16]
    return [dict(m=f32s(d, o + k * st, 16), parent=struct.unpack_from('<b', d, o + k * st + 0x41)[0]) for k in range(n)]


def nav_graph(d):
    """Sections 5 / 6 / 7: the stage's nav graph (FUN_0033ef48 / FUN_0033d918; nodes FUN_0033e118,
    neighbours vt+0x14 0x33e540, link records FUN_0033e190)."""
    sec = SE.sections(d)
    o5, n5, s5 = sec[5]
    o6, n6, s6 = sec[6]
    o7, n7, s7 = sec[7]
    if n5 == 0 or n6 == 0 or n7 == 0:
        return None                          # FUN_0033ef48: graph pointer 0
    if (s5, s6, s7) != (0x20, 8, 0x10):
        raise ValueError('nav sections 5 / 6 / 7 stride %#x / %#x / %#x, expected 0x20 / 8 / 0x10' % (s5, s6, s7))
    cnt = struct.unpack_from('<h', d, o7 + 2)[0]
    if cnt != n5:
        raise ValueError('nav header count %d != section 5 count %d' % (cnt, n5))
    s24 = lambda w: (w & 0xffffff) - (1 << 24) if w & 0x800000 else (w & 0xffffff)
    nodes = []
    for i in range(n5):
        q = o5 + i * 0x20
        w = struct.unpack_from('<3I', d, q)
        nl = struct.unpack_from('<b', d, q + 7)[0]
        first = struct.unpack_from('<H', d, q + 0xc)[0]
        if nl > 0 and first + nl > n6:
            raise ValueError('nav node %d links %d..%d outside section 6 (%d)' % (i, first, first + nl, n6))
        nodes.append([s24(w[0]) / 256, s24(w[1]) / 256, s24(w[2]) / 256, nl, first, d[q + 0xe]])
    links = []
    for j in range(n6):
        to, cost, fl = struct.unpack_from('<hBB', d, o6 + j * 8 + 2)
        links.append([to, cost, fl])
    return dict(nodes=nodes, links=links)


# Vincent's object script P+0x34 and parameter set (status +0x9c -> section-0 record): save RAM (P = 0x1339e0:
# +0x34 = 246; *(P+0x17c)+0x9c = stage base + 0x260 + 55 x 0x20c).
# GUESS: save-RAM values; how the game picks them is not decoded (notes/fidelity-audit.md "Vincent's script /
# cue table / C+0x810").
PLAYER_SCRIPT, PLAYER_PSET = 246, 55
# Vincent's cue table C+0x766 (FUN_003405f8 -> FUN_003116d0 -> C+0x7ec).
# GUESS: save RAM 9; where C+0x766 is set is not decoded (same audit row).
PLAYER_CUES = 9


def cue_tables(d):
    """Stage section 0x1a (FUN_003116d0: record i at base + i x size): s16 count, then 8-byte names at
    +8 + cue x 8 (FUN_00341330; '?' = event 0x25 to the owner's script, '' = nothing)."""
    base, n, size = SE.sections(d)[0x1a]
    out = []
    for i in range(n):
        o = base + i * size
        cnt = struct.unpack_from('<h', d, o)[0]
        out.append([d[o + 8 + k * 8: o + 16 + k * 8].split(b'\0')[0].decode('latin-1') for k in range(cnt)])
    return out


def script(d, si):
    """{event id: {locals, code: [[op, imm], ...]}} for script si (op 5 imm as float)."""
    b = SE.scripts(d)[si]
    ev = {}
    for e, f, code, end in SE.functions(d, b):
        ins = SE.disasm(d, code, end)
        # the function's data block (fn + [+4], [+0xc] bytes up to the code; FUN_0036fdc8): op 37's
        # references (data + imm x 8) and op 45's switch tables (worker 0174)
        data = d[f + SE.u32(d, f + 4): f + SE.u32(d, f + 4) + SE.u32(d, f + 0xc)]
        ev[str(e)] = dict(locals=SE.u32(d, f + 8), code=[[op, imm] for _i, op, imm in ins], data=data.hex())
    return ev


def records(d):
    sec = SE.sections(d)
    o0, c0, s0 = sec[0]
    o1, c1, s1 = sec[1]
    if s1 != SEC1_STRIDE:
        raise ValueError('section 1 stride %#x' % s1)
    out = []
    for k in range(c1):
        o = o1 + k * s1
        ps = SE.u32(d, o)
        model = d[o0 + ps * s0 + 0x20:o0 + ps * s0 + 0x24].split(b'\0')[0].decode('latin-1')
        over = SE.u32(d, o + 0x40)                                   # status +0x0c (FUN_00315050)
        if over >> 0x16 & 1:                                         # FUN_00318718 (FUN_00315738(s, 0x16))
            weapon = struct.unpack_from('<i', d, o + 0x54)[0]
        else:
            weapon = struct.unpack_from('<i', d, o0 + ps * s0 + 0x88)[0]
        # +8 = AI mode the activation creates the AI with (FUN_00559748 -> FUN_00365c50: status
        # +0xa0 (this record) +8; mode 8 -> 0 then FUN_0035f2e0)
        # max HP status +0x04 and level +0x11 (FUN_00314ea8): override bit 0x14 -> record +0x50 (u32),
        # else parameter set +0x30 (u16); bit 0x15 -> record +0x59 (u8), else parameter set +0x79.
        # (Status +0x60 bit 1 takes both from FUN_00320d20 instead: a status flag, not in the stage file.)
        hp = SE.u32(d, o + 0x50) if over >> 0x14 & 1 else struct.unpack_from('<H', d, o0 + ps * s0 + 0x30)[0]
        lvl = d[o + 0x59] if over >> 0x15 & 1 else d[o0 + ps * s0 + 0x79]
        # hit-zone set: parameter set +0x84 = section-19 index (FUN_003153d0 -> FUN_00310e40; zone_set)
        zi = struct.unpack_from('<i', d, o0 + ps * s0 + 0x84)[0]
        wcls = None
        if weapon >= 0:
            so24 = sec[24][0] + weapon * sec[24][2]
            wcls = d[so24 + 0x14] >> 2 & 7
        # +0x44: the status name (8 chars; FUN_00316d40 returns status +0xa0 (this record) + 0x44): what ev0100's
        # getbattleactor / setbattlename find the object by (FUN_003193c0; worker 0229)
        tag = d[o + 0x44:o + 0x4c].split(b'\0')[0].decode('latin-1')
        out.append(dict(rec=k, model=model, tag=tag, stance=stance_of(model, weapon >= 0, wcls),
                        script=struct.unpack_from('<h', d, o + 4)[0],
                        mode=struct.unpack_from('<i', d, o + 8)[0],
                        pos=f32s(d, o + 0xc, 3), face=f32s(d, o + 0x1c, 3), weapon=weapon, hp=hp, lvl=lvl, zones=zi,
                        # +0x4c / +0x4d -> AI +0x98 / +0x99 (signed bytes, FUN_00559748): the odds FUN_0035f7c0 /
                        # FUN_0035f8b0 draw against
                        b98=struct.unpack_from('b', d, o + 0x4c)[0], b99=struct.unpack_from('b', d, o + 0x4d)[0],
                        # worker 0251: +0x3e (short) = the parent area index (FUN_00547ce0: status +0xa0 +0x3e ->
                        # FUN_0053b920 -> FUN_0054c550; -1 none), and status +0x0c bit 5 (FUN_00315738(st, 5)): set ->
                        # the area switch FUN_0055a0d8 (actor vt+0x14c) leaves the actor alone unless its +0x28 bit 1
                        area=struct.unpack_from('<h', d, o + 0x3e)[0], ov5=over >> 5 & 1,
                        # status +0x70 = parameter set +0x38 x 10 (FUN_003153d0; parameter set +0x6c == 5 takes
                        # FUN_00315278 instead: none of the AI types): the move speed FUN_00565bd0 hands to
                        # FUN_0034b978 (C+0x1d4; x 0.4 walking, x 0.2 stance 2)
                        speed=(None if struct.unpack_from('<i', d, o0 + ps * s0 + 0x6c)[0] == 5 else
                               round(struct.unpack_from('<f', d, o0 + ps * s0 + 0x38)[0] * 10.0, 6))))
    return out


def attacks(d, i):
    """The attack table of section-19 entry i: C+0x7e8 = zone header +0x34 (FUN_00340760), set at stage
    load by FUN_0030fc68 (file version >= 0x16) = header + u32 header +0x18, relocated by FUN_0030fd08:
    T +0x10 entries (16 B), +0x14 keyframes (8 B), +0x18 commands (8 B), +0x1c names (8 B) are offsets
    from T; +0x2c = the entries again when the keyframe offset < s16 T+0 + count x 16 (the old 8-byte
    form, FUN_00347978), which FUN_00347bd8 refuses (no attack).
    Entry: +0 s16 length (frames), +2 / +4 s16 first keyframe / keyframe count, +6 u16 flags, +8 / +0xa
    s16 distance min / max, +0xc u8 yaw, +0xd s8 yaw tolerance, +0xe u16 pitch nibbles (FUN_00347af0).
    Keyframe: +0 s16 frame, +2 / +4 s16 first command / count. Command: 4 x s16 (FUN_003481e0: op,
    then args). names: the +0x1c entries the play-clip commands (op 0, arg 2) name."""
    sec = SE.sections(d)
    ver = (d[3] - 0x30) * 100 + (d[4] - 0x30) * 10 + d[5] - 0x30 if d[:3] == b'bzd' else -1
    o19, n19, _ = sec[0x13]
    if i < 0 or ver < 0xe or i >= n19:
        return None
    h = sec[0x14][0] + SE.u32(d, o19 + 4 * i)
    T = h + SE.u32(d, h + 0x18)
    s16 = lambda o: struct.unpack_from('<h', d, o)[0]
    n = s16(T + 2)
    E, K, CM, NM = (T + SE.u32(d, T + x) for x in (0x10, 0x14, 0x18, 0x1c))
    alt = SE.u32(d, T + 0x14) < s16(T) + n * 0x10
    entries, names = [], {}
    for k in range(n):
        e = E + 16 * k
        dur, ks, kn, fl, mn, mx = struct.unpack_from('<hhhHhh', d, e)
        kfs = []
        for j in range(kn):
            fr, cs, cn = struct.unpack_from('<hhh', d, K + 8 * (ks + j))
            cmds = [list(struct.unpack_from('<4h', d, CM + 8 * (cs + c))) for c in range(cn)]
            for c in cmds:
                if c[0] == 0:
                    names[str(c[2])] = d[NM + 8 * c[2]:NM + 8 * c[2] + 8].split(b'\0')[0].decode('latin-1')
            kfs.append(dict(frame=fr, cmds=cmds))
        entries.append(dict(dur=dur, kf=kfs, flags=fl, min=mn, max=mx, yaw=d[e + 0xc],
                            tol=struct.unpack_from('b', d, e + 0xd)[0], pitch=struct.unpack_from('<H', d, e + 0xe)[0]))
    used = [c[2] for e in entries for k in e['kf'] for c in k['cmds'] if c[0] == 2 and c[2] >= 0]
    HV = T + SE.u32(d, T + 0x24)
    return dict(alt=alt, entries=entries, names=names,
                volumes=[hit_volume(d, HV + 64 * v) for v in range(max(used) + 1)] if used else [])


def hit_volume(d, o):
    """Attack table +0x24 record (64 B), the melee hit volume op 2 builds (FUN_003481e0 case 2: record =
    T+0x24 + arg 2 x 64 -> owner event 4 -> FUN_00569dc0 -> FUN_00541310):
      +0 type -> FUN_00579ef0 (attack +0xc0 bits 0-1; reaction flags +0xec: 0 -> 2, 1 -> 4, 2 -> 8, 3 -> 0)
      +1 shape -> FUN_00579f70 (+0xc0 bits 2-3: 1 sphere DAT_0046ef3c, 2 DAT_0046ef40, 3 DAT_0046ef44, 0 ef38)
      +2 / +3 axis indices into DAT_0058bab0 (16 B rows): local rows = cross(ax[+3], ax[+2]), ax[+3], ax[+2]
      +4 low nibble -> +0xc0 bits 4-7 (FUN_0057b1b0: the reaction direction rule)
      +5 / +6 attach: +6 < 0: +5 == 0 owner matrix, else marker +5 + 0xe; +6 >= 0: +5 == 0 marker +6,
         else FUN_0054a7d0(+5 - 1)
      +7 -> +0x13c (repeat interval, frames), +8 -> +0xc1 flags (bit 0 every target, bit 2 repeat, bit 3 follow
      the owner, bit 1 / 4 the faction test), +0xa s16 life (+0xe0, frames x step), +0x10 damage (+0xc2),
      +0x14 -> +0x130 (hit effect), +0x18 name (+0x134, effect), +0x20 xyz local offset, +0x30.. shape
      parameters (shape 1 / 3: +0x30 radius -> +0xd0; shape 2: +0xd8 / +0xd0 / +0xd4 = +0x30 / +0x34 / +0x38,
      +0xdc = +0x3c degrees)"""
    r = d[o:o + 64]
    return dict(type=r[0], shape=r[1], ax=[r[2], r[3]], nib=r[4] & 0xf, m5=struct.unpack_from('b', r, 5)[0],
                m6=struct.unpack_from('b', r, 6)[0], every=r[7], c1=r[8], life=struct.unpack_from('<h', r, 10)[0],
                dmg=struct.unpack_from('<I', r, 0x10)[0], fx=struct.unpack_from('<I', r, 0x14)[0],
                name=r[0x18:0x20].split(b'\0')[0].decode('latin-1'),
                off=[round(x, 6) for x in struct.unpack_from('<3f', r, 0x20)],
                p=[round(x, 6) for x in struct.unpack_from('<4f', r, 0x30)])


def stance_of(model, armed, wcls, params=True):
    """FUN_00564228 (called by FUN_00559748 at activation): the body's stance C+0x664 by model name
    (FUN_00340ac0(C, n) also sets C+0x808 = stance flags and C+0x7fc = its motion rows). Only the
    names z128 places are translated; None for the rest (n112, p000, g001, ...):
      e027 / e048 / e036: no case of their own -> LAB_005649f0: weapon W = status +0xac; class
        W+0x14 >> 2 & 7: 2 -> 0x1e, 0 / 1 / 3 or no weapon -> 0x1f, other classes keep the stance.
      e030 -> 0x23 (and C+0x568 |= 0x200); e023 -> 0x19, e024 -> 0x1a (actor +0x118 |= 0x80801c);
      e001 -> 0x10.
    LAB_005649f4 first: no status (+0x17c) or no parameter set (status +0x9c == 0) -> 0x1f. Unreachable
    for a stage record (every section-1 record names a parameter set, which the model name comes from);
    kept as `params` for the translation. Weapon classes 4-7 return with the stance unchanged (None
    here: enemy_ai.js builds no actor for a record without a stance; no z128 record has one)."""
    # NPCs (worker 0223, FUN_00564228's 'n0xx' cases): n017 / n018 / n020-n022 (the WRO men) take the weapon rule
    # (LAB_005649f0 / LAB_005649f4) like e027; the townspeople have fixed stances: 0xd (LAB_005649a4) n023 n025 n029
    # n031, 0xc (LAB_005649b8) n024 n026 n030 n032, 0xe (LAB_005649cc) n027 n028 n033 n034 n058.
    if model in ('e027', 'e048', 'e036', 'n017', 'n018', 'n020', 'n021', 'n022'):
        if not params:
            return 0x1f
        if not armed:
            return 0x1f
        return {0: 0x1f, 1: 0x1f, 2: 0x1e, 3: 0x1f}.get(wcls)
    npc = {'n023': 0xd, 'n025': 0xd, 'n029': 0xd, 'n031': 0xd, 'n024': 0xc, 'n026': 0xc, 'n030': 0xc, 'n032': 0xc,
           'n027': 0xe, 'n028': 0xe, 'n033': 0xe, 'n034': 0xe, 'n058': 0xe}
    return {'e030': 0x23, 'e023': 0x19, 'e024': 0x1a, 'e001': 0x10, **npc}.get(model)


def stances(path, used):
    """The stance table (FUN_0030fb78: 'bmd' magic; +4 = offset of the u32 flags per stance, +8 s16
    stance count, +0xa s16 motions per stance; the 8-byte clip-name rows start after the flags at
    +4 + ((count + 1) & ~1) x 4). FUN_0030fc38(n) = flags[n] -> C+0x808 (bit 0: the brain's shooter
    branch, FUN_00362ef8 state 0); FUN_0030fc08(n) = row base of stance n (C+0x7fc), motion m = row
    m: the clip name FUN_00345818 plays. Returns {stance: {flags, motions: [name or '']}}."""
    d = open(path, 'rb').read()
    if d[:3] != b'bmd':
        raise ValueError('%s: no bmd header' % path)
    base = SE.u32(d, 4)
    n, nm = struct.unpack_from('<hh', d, 8)
    rows = base + ((n + 1) & ~1) * 4
    out = {}
    for st in sorted(used):
        if not 0 <= st < n:
            raise ValueError('stance %#x outside the table (%d)' % (st, n))
        names = [d[rows + (st * nm + m) * 8:rows + (st * nm + m) * 8 + 8].split(b'\0')[0].decode('latin-1')
                 for m in range(nm)]
        out[str(st)] = dict(flags=SE.u32(d, base + 4 * st), motions=names)
    return out


def zone_size(d, i):
    """FUN_00563fc0 (actor setup from the status): with a zone header (status +0xa8, as zone_set)
    radius actor +0x2c = header +0x20 x 0.5 (header +0x10 bit 0: max(+0x20, +0x28) x 0.5), height
    +0x30 = header +0x24; header +0x10 bits 2 / 4 -> actor +0x28 |= 0x10000. No header: height 17.0
    and a radius from a constant vector (not needed: every z128 enemy set has a header).
    Save state check: e027 / e048 5 / 18, e030 6 / 12, e001 7.5 / 28, e023 90 / 40, e024 90 / 120."""
    sec = SE.sections(d)
    ver = (d[3] - 0x30) * 100 + (d[4] - 0x30) * 10 + d[5] - 0x30 if d[:3] == b'bzd' else -1
    o19, n19, _ = sec[0x13]
    if i < 0 or ver < 0xe or i >= n19:
        return None
    h = sec[0x14][0] + SE.u32(d, o19 + 4 * i)
    fl = SE.u32(d, h + 0x10)
    w, ht, dp = struct.unpack_from('<3f', d, h + 0x20)
    r = max(w, dp) * 0.5 if fl & 1 else w * 0.5
    # worker 0252: C+0x7e4 = this header (FUN_00340760); FUN_003600c0(ai, n) = signed byte header +0x60 + n
    # (the mode-3 brain's special attack picks, -1 = none; e030's set: 2, 5, 4, -1)
    p60 = list(struct.unpack_from('4b', d, h + 0x60))
    return dict(r=round(r, 6), h=round(ht, 6), f28_10000=bool(fl & 6), p60=p60)


def weapons(d):
    """Section 24 records: the W fields enemy_ai.js reads."""
    so, n, stride = SE.sections(d)[24]
    if stride != SEC24_STRIDE:
        raise ValueError('section 24 stride %#x, expected %#x' % (stride, SEC24_STRIDE))
    out = []
    for k in range(n):
        o = so + k * stride
        h = lambda x: struct.unpack_from('<h', d, o + x)[0]
        f = lambda x: round(struct.unpack_from('<f', d, o + x)[0], 6)
        out.append(dict(idx=k, flags=SE.u32(d, o + 4), pellets=struct.unpack_from('b', d, o + 0x16)[0],
                        range=f(0x18), speed=f(0x2c), damage=h(0x40), first=h(0x42), interval=h(0x44),
                        reload=h(0x46), mag=h(0x48), hit=d[o + 0x4a], w56=h(0x56),   # W+0x56: melee damage % (FUN_00569dc0)
                        turn=f(0x3c),                       # W+0x3c: homing turn rate, deg/s (FUN_00552dd8 -> bullet +0x154; worker 0235)
                        react=SE.u32(d, o + 0xc),          # W+0xc -> bullet +0x148: the hit reaction flags (FUN_00552dd8, FUN_0055db50)
                        spread=[f(0x1c), f(0x20), f(0x24)],   # W+0x1c / +0x20 / +0x24: cone angle by distance (FUN_005405b0)
                        cls=d[o + 0x14] >> 2 & 7,           # W+0x14 bits 2-4: weapon class (FUN_00564228)
                        # sounds (worker 0172): W+0x8c the shot (FUN_005694f8 -> FUN_0033d6d8, range W+0x74 when > 0
                        # and the stage version FUN_00310c40 > 0x20, else 400), W+0x94 the bullet's (FUN_00554850 ->
                        # FUN_0033d788, at the sound camera)
                        se_fire=d[o + 0x8c:o + 0x94].split(b'\0')[0].decode('latin-1'), se_range=f(0x74),
                        se_bullet=d[o + 0x94:o + 0x9c].split(b'\0')[0].decode('latin-1'),
                        # bullet-end effect (worker 0193): bullet +0x144 = W+0x7c (FUN_00554568), +0x194 = section-24
                        # record [+0x144] (FUN_00554850 -> FUN_00311600); FUN_00554ea8 reads its +0x78 flags (0x2000 no
                        # effect, 8 at the bullet's object), +0x80 (the floor-hit id, FUN_00335960) and +0xb0 (FUN_00335918)
                        bullet=h(0x7c), f78=SE.u32(d, o + 0x78), fx_floor=struct.unpack_from('<i', d, o + 0x80)[0],
                        fx_end=struct.unpack_from('<i', d, o + 0xb0)[0]))
    return out


def hitboxes(model='e027', cont=None):
    """The model's part boxes for the bullet part test FUN_005ad118 -> FUN_0030baa0: the 'mkd'
    chunk (header 'mk2', +6 u16 box count, +0xc box array; FUN_0030b9e0 relocates +8 / +0xc), 32 B
    per box: +0 offset xyz (f32), +0xc bone (s32), +0x10 scale xyz (f32). Box k = part k.
    cont: the model container (default: the enemy model's, export_web_enemy.paths)."""
    import export_web_enemy as E, export_cerberus as EC
    buf = open(cont or E.paths(model)['cont'], 'rb').read()
    for o in EC.entries(buf):
        if buf[o + 8:o + 11] == b'mkd':
            p = o + 0x10
            # FUN_0030baa0 reads +6 / +0xc with no tag test; the townspeople's chunks are tagged 'mkd\0' (worker 0228)
            if buf[p:p + 4] not in (b'mk2\0', b'mkd\0'):
                raise ValueError('%s marker.mkd: no mk2 header' % model)
            n = struct.unpack_from('<H', buf, p + 6)[0]
            b0 = p + struct.unpack_from('<I', buf, p + 0xc)[0]
            out = []
            for i in range(n):
                r = struct.unpack_from('<3fi3f', buf, b0 + 32 * i)
                out.append(dict(offset=[round(x, 6) for x in r[:3]], bone=r[3], scale=[round(x, 6) for x in r[4:7]]))
            return out
    raise ValueError('%s: no marker.mkd' % model)


def markers(model='e027'):
    """The model's markers (FUN_005ad508 -> FUN_0030bef8(mkd + 0x10, n, out, palette)): 'mk2' +4 u16 count,
    +8 offset of 16-byte records {f32 xyz, s32 bone}; marker n's matrix = T(xyz) x bone n's palette matrix."""
    import export_web_enemy as E, export_cerberus as EC
    buf = open(E.paths(model)['cont'], 'rb').read()
    for o in EC.entries(buf):
        if buf[o + 8:o + 11] == b'mkd':
            p = o + 0x10
            if buf[p:p + 4] not in (b'mk2\0', b'mkd\0'):          # no tag test in the game (see hitboxes)
                raise ValueError('%s marker.mkd: no mk2 header' % model)
            n = struct.unpack_from('<H', buf, p + 4)[0]
            m0 = p + struct.unpack_from('<I', buf, p + 8)[0]
            return [[round(x, 6) for x in struct.unpack_from('<3f', buf, m0 + 16 * i)] +
                    [struct.unpack_from('<i', buf, m0 + 16 * i + 12)[0]] for i in range(n)]
    raise ValueError('%s: no marker.mkd' % model)


def zone_set(d, i, n):
    """Hit-zone records of section-19 entry i (status +0xa8 -> +0x30, 16 B per part; FUN_0055bda8 /
    FUN_0055d2c0 / FUN_0055db50), from this stage file:
      status +0xa8 = FUN_00310e40(parameter set +0x84) = section-20 base + section-19 [i] (u32),
        set by FUN_003153d0; 0 when +0x84 < 0 or the file version FUN_00310c40 (FUN_00312248:
        'bzd' + 3 digits at +0) is < 0xe.
      +0x30 = the entry + its u32 +8 + u32 +4 x 4 + u32 +0 (FUN_0030fc68, run on every section-19
        entry at stage load by FUN_0030f968).
    n = the part count (the model's part boxes: part k reads record k). Returns [{scale: byte 0,
    flags: ushort +2}], or None when status +0xa8 would be 0."""
    sec = SE.sections(d)
    ver = (d[3] - 0x30) * 100 + (d[4] - 0x30) * 10 + d[5] - 0x30 if d[:3] == b'bzd' else -1
    o19, n19, _ = sec[0x13]
    if i < 0 or ver < 0xe or i >= n19:
        return None
    r = sec[0x14][0] + SE.u32(d, o19 + 4 * i)
    z = r + SE.u32(d, r + 8) + SE.u32(d, r + 4) * 4 + SE.u32(d, r)
    # fx (worker 0193): the record's word bits 12-15, signed: FUN_0055db50 / FUN_0056c3f0 pass
    # (*(actor +0x19c) << 16) >> 28 to FUN_003361b8 (!= 0: the wall-impact table by that material)
    return [dict(scale=d[z + 16 * k], flags=struct.unpack_from('<H', d, z + 16 * k + 2)[0],
                 fx=((d[z + 16 * k + 1] >> 4) ^ 8) - 8) for k in range(n)]


def lock_bone(d, i):
    """The lock-on bone of section-19 entry i: header byte +0x14 (status +0xa8, as in zone_set), copied
    to C+0x765 at activation by FUN_00340760(C, status +0xa8, 0) (FUN_00559748); vt+0x5c = FUN_00563720
    takes that bone's world position (-1 / no header: FUN_005634e0(actor, 3), 2 below the top)."""
    sec = SE.sections(d)
    ver = (d[3] - 0x30) * 100 + (d[4] - 0x30) * 10 + d[5] - 0x30 if d[:3] == b'bzd' else -1
    o19, n19, _ = sec[0x13]
    if i < 0 or ver < 0xe or i >= n19:
        return -1
    b = d[sec[0x14][0] + SE.u32(d, o19 + 4 * i) + 0x14]
    return b - 256 if b >= 128 else b


def zone_sets(d, recs, boxes):
    """{section-19 index: zone_set} for every index a record of a model with part boxes uses."""
    out = {}
    for r in recs:
        if r['model'] in boxes and r['zones'] >= 0 and str(r['zones']) not in out:
            out[str(r['zones'])] = zone_set(d, r['zones'], len(boxes[r['model']]))
    return out


def clip_frames():
    import export_web_enemy as E
    pth = E.paths('e027')
    res = {}
    for c in AI_CLIPS:
        cbuf, CP = E.V.find_clip(pth['clips'], c)
        res[c] = int(E.AR.clip_frames(cbuf, CP))
    return res


def model_clips(recs, st, atk):
    """{model: {clip: frames}} for the AI_MOTIONS rows of every (model, stance) pair the records use,
    from the model's own motion files (export_web_enemy.clip_file: only disc.py INPUTS). A row whose
    clip no listed file holds is left out (printed)."""
    import export_web_enemy as E
    out = {}
    for model, stance in sorted({(r['model'], r['stance']) for r in recs if r['stance'] is not None and r['model'] in AI_TYPES}):
        names = st[str(stance)]['motions']
        res = out.setdefault(model, {})
        for m in AI_MOTIONS:
            c = names[m] if m < len(names) else ''
            if not c or c in res:
                continue
            try:
                f = E.clip_file(model, c)
            except SystemExit:
                print('WARN %s stance %#x motion %#x: no listed motion file holds %s' % (model, stance, m, c))
                continue
            cbuf, CP = E.V.find_clip(f, c)
            res[c] = int(E.AR.clip_frames(cbuf, CP))
    # the attack clips (the play-clip commands of the model's attack tables, ai.json attacks)
    for r in recs:
        if r['model'] not in AI_TYPES or r['zones'] < 0 or not atk.get(str(r['zones'])):
            continue
        res = out.setdefault(r['model'], {})
        for c in atk[str(r['zones'])]['names'].values():
            if not c or c in res:
                continue
            try:
                f = E.clip_file(r['model'], c)
            except SystemExit:
                print('WARN %s attack clip %s: no listed motion file holds it' % (r['model'], c))
                continue
            cbuf, CP = E.V.find_clip(f, c)
            res[c] = int(E.AR.clip_frames(cbuf, CP))
    # worker 0235: the clips the z128 boss overlay sets by name (FUN_00344840; boss_z128.js), for its motion-done tests
    for model, clips in BOSS_CLIPS.items():
        res = out.setdefault(model, {})
        for c in clips:
            if c in res:
                continue
            cbuf, CP = E.V.find_clip(E.clip_file(model, c), c)
            res[c] = int(E.AR.clip_frames(cbuf, CP))
    return out


BOSS_CLIPS = {'e024': ('idle', 'l_trn', 'r_trn', 'atk_sp1', 'atk_sp2', 'atk_sp3', 'idl_lean', 'lean', 'lean_idl')}


# the types enemy_ai.js builds an actor for (notes/enemy-ai-hook.md "Other types"); part boxes are
# Sound-name tables in the ELF (worker 0173; notes/audio-research.md "Combat sounds on the page"). Pointer tables to
# 8-byte names: 0x46e5b8 (16, FUN_0033d118 / FUN_0033d008: the shots), 0x46e5f8 (24, FUN_0033d4e8: 3 per surface
# kind; the last 6 are not reached from FUN_0033d528); 0x4a1310: FUN_0033d528's material -> surface kind (14 words).
ELF_PATH = os.path.join(HERE, '../../../elf/SLES_541.85')


def se_tables(elf):
    name = lambda p: elf.read(p, 8).split(b'\0')[0].decode('latin-1')
    ptrs = lambda a, n: [name(elf.u32(a + 4 * i)) for i in range(n)]
    return dict(source='ELF 0x46e5b8 / 0x46e5f8 / 0x4a1310', gun=ptrs(0x46e5b8, 16), wall=ptrs(0x46e5f8, 24),
                mat_kind=[elf.u32(0x4a1310 + 4 * i) for i in range(14)])


# Vincent's death cues (worker 0187): the death class 0xb's phase 0 (FUN_00595a60) plays FUN_00341330(C, cue) with
# cue = DAT_005a39b0[side] (FUN_00340658 false) or DAT_005a39d0[side] (true), side = C+0x590 & 0xf (FUN_0055d678).
# Two tables of 7 words (lw; the stack copy in FUN_00595a60 indexes them by side x 4).
def death_cues(elf):
    words = lambda a: [elf.u32(a + 4 * i) for i in range(7)]
    return dict(source='ELF 0x5a39b0 / 0x5a39d0 (FUN_00595a60)', cue=words(0x5a39b0), cue_alt=words(0x5a39d0))


# exported for every z128 enemy type
AI_TYPES = ('e027', 'e048', 'e030')
# worker 0230: e036 (stance 0x1e by its weapon class, FUN_00564228 fall-through; flags 0x872b) runs the soldiers' AI
AI_TYPES += ('e036',)
# worker 0230: e001 / e023 get the shared actor too (FUN_00559748 builds one for every type; brain mode 0 from their records)
AI_TYPES += ('e001', 'e023')
BOX_TYPES = ('e027', 'e048', 'e030', 'e036', 'e023', 'e024', 'e001')
# worker 0228: the townspeople (same actor class 0x58e1f8; their part boxes for Vincent's bullets, notes/npc-research.md §8)
BOX_TYPES += ('n023', 'n024', 'n025', 'n026', 'n027', 'n028', 'n029', 'n030', 'n031', 'n032', 'n033', 'n034')
PLAYER_MODEL = '07703201.bin'   # Vincent's model container in z128 (part boxes for the enemy bullets)


def main():
    if len(sys.argv) not in (3, 4):
        sys.exit(__doc__)
    stage, out = sys.argv[1], sys.argv[2]
    from export_web_aim import Elf     # noqa: E402  (the ELF segment reader)
    elf = Elf(open(sys.argv[3] if len(sys.argv) == 4 else ELF_PATH, 'rb').read())
    d = open(stage, 'rb').read()
    trig = triggers(d)
    recs = records(d)
    nscr = len(SE.scripts(d))
    # + script 0 = the stage controller (events 0x22 / 0x23 stage start / restart, L; it arms the
    # bit-0x20000 triggers by difficulty and event flag: notes/enemy-activation.md §1)
    want = {t['script'] for t in trig} | {r['script'] for r in recs} | {0}
    # worker 0237: the stage object (manager type 0xc, built first by FUN_0053c140) takes script = section 4 +0x18
    # (FUN_00311038 -> FUN_0054e3d8): ai.json stage_script. L: FUN_00310c40() (DAT_0046dd68 +100) >= 0xc taken as
    # true (else -1: no script); where DAT_0046dd68 points is not decoded. z128: script 0.
    s4 = SE.sections(d)[4][0]
    stage_script = struct.unpack_from('<h', d, s4 + 0x18)[0]
    want |= {stage_script}
    # worker 0174: Vincent's own script (P+0x34) and the parameter-set fallback scripts (section 0 +0x7c,
    # FUN_00568f98: run when the object's own script has no such event): his pain cue event 0x25.
    sec0, n0, sz0 = SE.sections(d)[0]
    pset_script = [struct.unpack_from('<i', d, sec0 + i * sz0 + 0x7c)[0] for i in range(n0)]
    want |= {PLAYER_SCRIPT} | {s for s in pset_script if s >= 0}
    # worker 0209: the barrels' scripts (section 15 +0x44: events 3 / 0x17, props.js through enemy_ai's VM)
    import export_web_props as PROPS
    want |= {r['script'] for r in PROPS.records(d, PROPS.types(d)) if r['script'] >= 0}
    scr = {str(s): script(d, s) for s in sorted(want) if 0 <= s < nscr}
    boxes = {m: hitboxes(m) for m in BOX_TYPES if any(r['model'] == m for r in recs)}
    # Vincent's part boxes (player vt+0x17c = FUN_0055bda8 too: the enemy bullets' part test): z128 draws
    # his model from 07703201 (notes/HANDOFF.md, worker 0106); its mkd equals 07700001's
    pbox = hitboxes('p000', os.path.join(os.path.dirname(os.path.abspath(stage)), PLAYER_MODEL))
    st = stances(os.path.join(os.path.dirname(os.path.abspath(stage)), STANCE_FILE),
                 {r['stance'] for r in recs if r['stance'] is not None})
    atk = {str(r['zones']): attacks(d, r['zones']) for r in recs if r['zones'] >= 0 and r['model'] in AI_TYPES}
    os.makedirs(out, exist_ok=True)
    res = dict(format='enemy-ai-2', stage=os.path.basename(stage), triggers=trig, records=recs,
               weapons=weapons(d), scripts=scr, clips=clip_frames(), hitboxes=boxes,
               zones=zone_sets(d, recs, boxes), stances=st, model_clips=model_clips(recs, st, atk), attacks=atk,
               sizes={str(r['zones']): zone_size(d, r['zones']) for r in recs if r['zones'] >= 0},
               lock_bones={str(r['zones']): lock_bone(d, r['zones']) for r in recs if r['zones'] >= 0},
               paths=paths(d), locators=locators(d), areas=areas(d), nav=nav_graph(d), markers={m: markers(m) for m in boxes}, se=se_tables(elf),
               pset_script=pset_script, player=dict(script=PLAYER_SCRIPT, pset=PLAYER_PSET, cues=PLAYER_CUES, death=death_cues(elf)), cues=cue_tables(d), names=names(d), values32=values32(d),
               stage_script=stage_script)
    res['hitboxes']['p000'] = pbox
    path = os.path.join(out, 'ai.json')
    with open(path, 'w') as fh:
        json.dump(res, fh, separators=(',', ':'))
    print('wrote %s: %d triggers, %d records, %d weapons, %d scripts, %d paths, zone sets %s, clips %s, stances %s, model clips %s' % (
        path, len(trig), len(recs), len(res['weapons']), len(scr), len(res['paths']), sorted(res['zones']), res['clips'],
        sorted(st), {m: len(c) for m, c in res['model_clips'].items()}))


def names(d):
    """Section 0x11 = the stage's name dictionary (worker 0231, notes/boss-research.md): FUN_00311c98(name) ->
    FUN_00311078 (section 0x11 base, count > 0) -> FUN_0036f450 binary search over 16-byte entries from +0x10
    (count at +0): bytes 0..7 = the name, last character first; +8 = section << 24 | index. Used by the boss
    overlay (btbox0..5 = triggers, nwe024* = weapons, bshv0 = a section-32 value)."""
    o, _n, _st = SE.sections(d)[0x11]
    cnt = struct.unpack_from('<I', d, o)[0]
    out = {}
    for k in range(cnt):
        e = o + 0x10 + k * 16
        nm = d[e:e + 8][::-1].rstrip(b'\0').decode('latin1')
        v = struct.unpack_from('<I', d, e + 8)[0]
        out[nm] = [v >> 24, v & 0xffffff]
    return out


def values32(d):
    """Section 0x20 words (FUN_00311a80 -> FUN_00311a18(i): entry i's first word)."""
    o, n, st = SE.sections(d)[0x20]
    return [struct.unpack_from('<i', d, o + i * st)[0] for i in range(n)]


if __name__ == '__main__':
    main()
