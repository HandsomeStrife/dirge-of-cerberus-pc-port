#!/usr/bin/env python3
"""export_web_light.py -- Vincent's light rig inputs for play.html (data/vincent/light.json).

    python3 -I export_web_light.py [OUT_DIR]      (default native/web/data/vincent)

What the game does (decoded; notes/fidelity-audit.md "Character lighting"):
  FUN_005ab0b0 builds an actor's VU1 program-D rig every drawn frame:
    light 0  dir = env slot obj[+0x44e] light direction (stored negated in the BMD, bmd_env.py),
             colour = light_col_a/128                                  -> x obj[+0x450]/128
    light 1  nearest active point light of the 4-slot table DAT_004eea50 (FUN_0030e208), or the
             actor's own obj+0x160: effect lights (FUN_00271fb8). Not exported: the page has no
             effects, and the table is empty in the z128 save state.
    light 2  room light: FUN_0026a710 -> FUN_00270d08 over every loaded BMD's light grid
             (BMD version >= 0x12, struct at BMD+0x98): the light with the least d^2/k in the
             actor point's grid cell (type 2 = spot: skipped when outside its cone).
             dir = (light - p)/d, colour = rgb * k*100/d^2 (NOT scaled by +0x450); smoothed by
             FUN_005ab608 only while the chosen light changes.
    ambient  light_col_b/128                                           -> x obj[+0x450]/128
  Actor point p = obj+0x10 matrix x (obj+0x90 + obj+0xa0)/2 (FUN_005a72a8).
  Program D per vertex: rgb = min(vcol * (sum_i C_i*max(L_i.n, 0) + A), 255).

Layout of the BMD light grid (file offsets are relative to the BMD base, file offset 0x30;
the game relocates them by adding the load address):
  BMD+0x98  i32 count (0 = no grid), ..., +0xa8 u32 grid
  grid      f32 cell size, f32 x0, f32 z0, i16 nx, i16 nz, then nx*nz u32 cell lists (0 = empty)
  cell list i32 n, 12 bytes, then n u32 light records
  record    +0x40 vec3 position, +0x4c i32 type, +0x50 vec3 spot dir + f32 cos limit,
            +0x60 rgb (floats) + f32 k
Which grids are scanned (decoded, worker 0216; notes/fidelity-audit.md "Character lighting"):
  FUN_0026a710 walks the 3-slot chunk table DAT_004e4c60 (stride 0x70): a slot counts when
  +0x5c != 0 (set at the end of its load, FUN_00266ae0 case 10) and +0x44 (the 'cid' block of
  file 0680AA11, FUN_00258f20(res, 'cid')) is set. Slot 0 = chunk 00 (no grid), slots 1 / 2 =
  the streamed pair: FUN_002673d8(zone, a, b) at the stage load, then FUN_002677a0(a, b)
  from the area boxes ('eib' block of 06800011, FUN_00269bd0) that FUN_0026a0c0 tests MP+0x10's
  position against every frame. The page runs that (area_stream.js), so this file exports
  every chunk's grid ('chunks') and the boxes ('areas').
  rfd file: +0x10 u16 n, +0x14 n u32 entry offsets; entry: name[8], tag[4] ('cid' / 'eib'),
  size; its data (and the relocated offsets inside it) start at entry +0x10.
  eib data: i32 n, i32, n u32 box offsets; box (0x70): 4x4 f32 world -> unit-box matrix
  (rows = VU columns, FUN_0026135c), +0x40 i32 type (0 = stream), +0x44 u32 flags (bit 0
  done, type 1 only), +0x48 / +0x4c / +0x54 type-1 arguments, +0x50 / +0x51 u8 chunks a, b.
"""
import os, sys, json, struct

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
NOPATH = os.path.join(REPO, "extract", "_KEL", "noPath")
sys.path.insert(0, HERE)
import bmd_env as BE

ENV_FILE = "06800012.bin"              # z128 env slots (bmd_env.py)
ENV_SLOT = 0                           # Vincent's obj+0x44e in z128 (save state)
ZONE = 0x80                            # z128's chunk files 0680AA11 (FUN_00266ae0: zone << 16 | chunk << 8 | 0x11)
CHUNKS = 13                            # 0680{00..0c}11.bin
START_PAIR = (1, 2)                    # stage program 06800000 cmd 0: FUN_003ff7a8(0x80, 1, 2) -> FUN_002673d8
# Vincent's motion player (MP = C+0x7c8), read from the z128 save state:
#   +0x450 = 122: light 0 / ambient scale byte, set by script (FUN_00342240 from actor+0x779)
#   +0x90 / +0xa0 = model-space bbox min/max, set once at model setup (FUN_005a8850 ->
#   FUN_005b0380 / FUN_005affb0, not decoded); FUN_005a72a8 takes their mean.
SCALE_BYTE = 122
BBOX_MIN = (-8.8122, -18.0863, -6.9951)
BBOX_MAX = (8.5174, -0.3689, 10.3344)


def rfd_entry(d, tag):
    """FUN_00258f20(res, tag, 0): the first entry with this tag; returns its data offset or None."""
    n = struct.unpack_from("<H", d, 0x10)[0]
    for o in struct.unpack_from("<%dI" % n, d, 0x14):
        if d[o + 8:o + 12].rstrip(b"\0") == tag:
            return o + 0x10
    return None


def read_areas(path):
    """The area boxes FUN_0026a0c0 tests (FUN_00271b60 -> FUN_00271aa8)."""
    d = open(path, "rb").read()
    base = rfd_entry(d, b"eib")
    if base is None:
        return []
    n = struct.unpack_from("<i", d, base)[0]
    out = []
    for i in range(n):
        o = base + struct.unpack_from("<I", d, base + 8 + 4 * i)[0]
        out.append(dict(m=list(struct.unpack_from("<16f", d, o)),
                        type=struct.unpack_from("<i", d, o + 0x40)[0],
                        flags=struct.unpack_from("<I", d, o + 0x44)[0],
                        a=d[o + 0x50], b=d[o + 0x51]))
    return out


def read_grid(path, base=None):
    d = open(path, "rb").read()
    if base is None:
        base = rfd_entry(d, b"cid")
    u32 = lambda o: struct.unpack_from("<I", d, base + o)[0]
    if struct.unpack_from("<i", d, base + 4)[0] < 0x12:     # FUN_00270ed8: version < 0x12 -> no grid
        return None
    if u32(0x98) == 0:
        return None
    g = u32(0x98 + 0x10)
    size, x0, z0 = struct.unpack_from("<3f", d, base + g)
    nx, nz = struct.unpack_from("<2h", d, base + g + 0xc)
    recs, index, cells = [], {}, []
    for c in range(nx * nz):
        cl = u32(g + 0x10 + 4 * c); lst = []
        if cl:
            for k in range(u32(cl)):
                r = u32(cl + 16 + 4 * k)
                if r not in index:
                    o = base + r
                    index[r] = len(recs)
                    recs.append(dict(
                        pos=list(struct.unpack_from("<3f", d, o + 0x40)),
                        type=struct.unpack_from("<i", d, o + 0x4c)[0],
                        spot=list(struct.unpack_from("<4f", d, o + 0x50)),
                        rgb=list(struct.unpack_from("<3f", d, o + 0x60)),
                        k=struct.unpack_from("<f", d, o + 0x6c)[0]))
                lst.append(index[r])
        cells.append(lst)
    return dict(file=os.path.basename(path), size=size, x0=x0, z0=z0, nx=nx, nz=nz,
                cells=cells, lights=recs)


def main(argv):
    out = os.path.abspath(argv[0]) if argv else os.path.join(REPO, "native", "web", "data", "vincent")
    r = os.system(f"git -C '{REPO}' check-ignore -q '{os.path.join(out, 'light.json')}'")
    if r != 0:
        sys.exit(f"REFUSING: {out} is not gitignored (game-derived output)")
    env = BE.read_env(open(os.path.join(NOPATH, ENV_FILE), "rb").read(), ENV_SLOT)
    chunks = {}
    for c in range(CHUNKS):
        g = read_grid(os.path.join(NOPATH, "%08x.bin" % ((0x06 << 24) | (ZONE << 16) | (c << 8) | 0x11)))
        if g:
            g["chunk"] = c
            chunks[str(c)] = g
    areas = read_areas(os.path.join(NOPATH, "%08x.bin" % ((0x06 << 24) | (ZONE << 16) | 0x11)))
    j = dict(
        format="dirge light rig v2 (export_web_light.py)",
        env=dict(file=ENV_FILE, slot=ENV_SLOT,
                 dir0=[-x for x in env["light_dir1"]],          # VU +0xc0: toward the light
                 col0=[c / 128.0 for c in env["light_col_a"]],
                 ambient=[c / 128.0 for c in env["light_col_b"]]),
        scale_byte=SCALE_BYTE,
        actor_center=[(a + b) / 2 for a, b in zip(BBOX_MIN, BBOX_MAX)],
        pick_start=1e6,                                           # FUN_00270ec0: DAT_004e88a4
        chunks=chunks,                                            # every chunk's grid; the page scans the loaded slots
        areas=areas,                                              # FUN_0026a0c0's stream boxes
        start_pair=list(START_PAIR),
        note="program D: rgb = min(vcol*(C0*max(L0.n,0) + C2*max(L2.n,0) + A), 255); "
             "C0, A x scale_byte/128; light 2 from the grids (FUN_00270d08)")
    os.makedirs(out, exist_ok=True)
    with open(os.path.join(out, "light.json"), "w") as f:
        json.dump(j, f, separators=(",", ":"))
    print("light.json: %d chunk grids, %d lights, %d area boxes -> %s" % (
        len(chunks), sum(len(g["lights"]) for g in chunks.values()), len(areas), os.path.join(out, "light.json")))


if __name__ == "__main__":
    main(sys.argv[1:])
