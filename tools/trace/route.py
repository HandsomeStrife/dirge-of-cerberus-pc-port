#!/usr/bin/env python3
"""(worker 0217) Walk Vincent along a planned route in the real game and save PCSX2 states on the way.

    flock tools/trace/out/.pcsx2.lock python3 -I tools/trace/route.py ROUTE.json NAME \
        --state PARENT.p2s --wp FROM:TO --frames N --out tools/trace/out/route [--gs] [--poke a=w,...]

ROUTE.json: [[x, y, z], ...] waypoints (walk-mesh path, notes/route-states.md says how it was made).
The run loads PARENT (the z128 save state or an earlier route state), installs the trace pad hook (hook.py)
with a neutral script of N frames, and steers over PINE: each poll it reads Vincent's position (C+0x30) and the
camera basis (CAM+0x60 right, CAM+0x80 forward) and writes the stick for the next frames into the hook's script
table. Only the script table is written while the game runs, so the run is a pure function of (parent, pokes,
the recorded pad bytes): NAME's replay script w217_NAME.json is written from the hook's own log of the pad
bytes the game read.

Stuck handling: if Vincent moves < 3 u in 40 frames with the stick held, cycle cross (closes a message box, uses a
gate), fire, back up, sidestep; on a ladder (P+0x104 == 10), climb. Options for story beats and fights: notes/route-states.md. At the end: stick released for --settle frames,
HP set back to --hp-end (PS+0x20) over PINE, PINE save state, then (--gs) one GS dump (Shift+F8). Outputs
(game-derived, so OUTDIR must be gitignored): NAME.p2s, NAME.gs.zst/.png, NAME.json (frame, position,
chunk slots, event flags), w217_NAME.json (replay script).
"""
import argparse, glob, json, math, os, shutil, socket, struct, subprocess, sys, time
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import fields, hook
import trace as T
from p2s import read_p2s, write_p2s
from pine import Pine

SCRATCH = T.scratch_dir()
SLOTS, PAIR = 0x4E4C60, 0x46BFB0         # chunk slot table (3 x 0x70: +0x54 chunk, +0x5c loaded), current pair
EVF, EVKEY = 0x47DBB0, 0x47DBF0          # event-flag block (+0x38, 64 bytes) and its XOR key (FUN_003ff738)
G_FLAGS, G_KEY = 0x50DB20, 0x46F608      # global flags DAT_0050db20[64] XOR DAT_0046f608 (FUN_0037cea0)
G_EV = 0x46F850                          # DAT_0046f850: event object; +0x1558 mode bits (bit 37 battle, 44 program)
WRITE32, SAVESTATE = 6, 9                # PINE opcodes (pcsx2/PINE.cpp)


class PineW(Pine):
    def write32(self, addr, v):
        self._call(struct.pack("<BII", WRITE32, addr, v & 0xFFFFFFFF))

    def save_state(self, slot):
        self._call(struct.pack("<BB", SAVESTATE, slot))

    def f32s(self, addr, n):
        a0 = addr & ~7
        raw = self.read_block(a0, ((addr - a0 + 4 * n + 7) // 8) * 8)
        return struct.unpack_from("<%df" % n, raw, addr - a0)


def u32(mem, a):
    return struct.unpack_from("<I", mem, a & 0x1FFFFFF)[0]


def unpatch(ee):
    """Remove the trace hook from a state saved during a hooked run (route states)."""
    if u32(ee, hook.CALL_SITE) == 0x0C000000 | (hook.HOOK >> 2):
        struct.pack_into("<I", ee, hook.CALL_SITE, 0x0C000000 | (hook.PAD_READ >> 2))
        ee[hook.FREE_LO:hook.FREE_HI] = bytes(hook.FREE_HI - hook.FREE_LO)
        return True
    return False


def game_info(p):
    """Chunk slots, current pair and decoded event flags (read live over PINE)."""
    slots = []
    for s in range(3):
        b = p.read_block(SLOTS + 0x70 * s + 0x50, 0x10)
        slots.append(dict(chunk=struct.unpack_from("<I", b, 4)[0], loaded=struct.unpack_from("<I", b, 0xC)[0]))
    pr = p.read_block(PAIR, 0x10)
    evf = p.read32(EVF)
    fl = bytearray(p.read_block((evf + 0x38) & ~7, 0x48)[(evf + 0x38) % 8:][:64])
    key = p.read_block(EVKEY, 0x40)
    flags = {i: fl[i] ^ key[i] for i in range(64) if fl[i] ^ key[i]}
    gf, gk = p.read_block(G_FLAGS, 0x40), p.read_block(G_KEY, 0x40)
    gflags = {i: gf[i] ^ gk[i] for i in range(64) if gf[i] ^ gk[i]}
    return dict(slots=slots, pair=list(struct.unpack_from("<4I", pr)), flags=flags, gflags=gflags)


def in_event(p):
    """The stage program is in event mode: FUN_003dfd18's test (+0x1558 & 0x102000000000 == 0x100000000000)."""
    ev = p.read32(G_EV)
    return bool(ev) and (p.read32(ev + 0x155C) & 0x1020) == 0x1000


def stick_byte(v):
    return max(0, min(255, int(128 + 127.5 * v)))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("route"); ap.add_argument("name")
    ap.add_argument("--state", default=T.DEFAULT_STATE)
    ap.add_argument("--wp", default="0:-1")
    ap.add_argument("--frames", type=int, default=2000)
    ap.add_argument("--out", default=os.path.join(HERE, "out", "route"))
    ap.add_argument("--gs", action="store_true")
    ap.add_argument("--poke", default="")
    ap.add_argument("--hp", type=int, default=9999, help="HP poked into the state for the run (PS+0x20)")
    ap.add_argument("--hp-end", type=int, default=780, help="HP written back just before the save")
    ap.add_argument("--settle", type=int, default=40)
    ap.add_argument("--reach", type=float, default=6.0)
    ap.add_argument("--look", type=float, default=10.0, help="aim at the first waypoint at least this far")
    ap.add_argument("--timeout", type=float, default=1500)
    ap.add_argument("--prefix", default="", help="SCRIPT.json:K - play that script's first K frames before steering")
    ap.add_argument("--fight", type=int, default=300, help="frames of aim-and-fire when stuck (mode 5)")
    ap.add_argument("--fight-range", type=float, default=60, help="enemies within this are fought when stuck")
    ap.add_argument("--fire-range", type=float, default=1e9, help="hold fire beyond this (the gun's reach, ammo)")
    ap.add_argument("--aim-at", default="", help="x,y,z: fight mode aims here (a breakable box) instead of at an enemy")
    ap.add_argument("--fight-first", action="store_true", help="start with a fight (aim and fire)")
    ap.add_argument("--teleport", default="", help="x,y,z: move Vincent within his current walk polygon (documented poke)")
    ap.add_argument("--drop-poly", action="store_true", help="with --teleport: clear C+0x4c0 (walk polygon)")
    ap.add_argument("--max-stuck", type=int, default=10)
    ap.add_argument("--hunt", type=int, default=-1, help="section-1 record: chase and shoot it, then walk onto its drop")
    ap.add_argument("--stop-item", default="", help="hex item id: end the run when the inventory holds one")
    ap.add_argument("--beats", action="store_true", help="skip events and answer the save box when they come up")
    ap.add_argument("--stop-flag", default="", help="F=V: end the run when stage flag F == V (a trigger fired)")
    ap.add_argument("--shots", default="", help="dir for a screenshot each time Vincent is stuck")
    a = ap.parse_args()
    repo = os.path.dirname(os.path.dirname(HERE)); oabs = os.path.abspath(a.out)
    if oabs.startswith(repo + os.sep) and subprocess.run(
            ["git", "-C", repo, "check-ignore", "-q", os.path.relpath(oabs, repo) + "/x.p2s"]).returncode:
        sys.exit("%s is not gitignored (route states are game data)" % a.out)
    os.makedirs(a.out, exist_ok=True)
    wps = json.load(open(a.route))
    w0, w1 = (int(x) for x in a.wp.split(":"))
    w1 = len(wps) - 1 if w1 < 0 else w1
    route = wps[w0:w1 + 1]

    # --- state: parent (hook removed), HP poke, extra pokes, hook with N neutral frames and a pad + position log
    ee = bytearray(read_p2s(a.state)["eeMemory.bin"])
    hooked = unpatch(ee)
    bases = fields.resolve_bases(ee)
    P, C, CAM = bases["P"], bases["C"], bases["CAM"]
    PS = u32(ee, P + 0x17C)
    pokes = [(PS + 0x20, a.hp)] + [tuple(int(x, 16) for x in it.split("=")) for it in filter(None, a.poke.split(","))]
    for ad, w in pokes:
        print("poke %#x: %d -> %d" % (ad, u32(ee, ad), w)); struct.pack_into("<I", ee, ad, w)
    if a.teleport:     # same walk polygon only (C+0x4c0 kept): the copies of Vincent's position found in the state
        tp = [float(v) for v in a.teleport.split(",")]
        MPb = bases["MP"]
        for ad in (C + 0x30, C + 0x60, C + 0x3B0, C + 0x3C0, MPb + 0x40):
            print("teleport %#x: %s -> %s" % (ad, [round(v, 2) for v in struct.unpack_from("<3f", ee, ad & 0x1FFFFFF)], tp))
            struct.pack_into("<3f", ee, ad & 0x1FFFFFF, *tp)
        if a.drop_poly:  # no current walk polygon (body+0x110): the game searches for the floor below
            print("walk poly %#x: %#x -> 0" % (C + 0x4C0, u32(ee, C + 0x4C0))); struct.pack_into("<I", ee, C + 0x4C0, 0)
    N = a.frames
    neutral = bytes([0xFF, 0xFF, 0x80, 0x80, 0x80, 0x80] + [0] * 12)
    # (worker 0253) leave a gap: steering writes up to 3 frames past f, and near the end of the script those landed on
    # the log's first records ("log record 0 corrupt" on any run that used up its frames; not an overflow). The log
    # has room for about 8900 frames here.
    hook.LOG = (hook.SCRIPT + (N + 8) * hook.SCRIPT_STRIDE + 15) & ~15
    K, frames0 = 0, [neutral] * N
    if a.prefix:                                       # a known-good opening (e.g. k_enemy_engage7: message box, ladder)
        sp_, K = a.prefix.rsplit(":", 1); K = int(K)
        frames0[:K] = T.build_frames(json.load(open(sp_)))[:K]
    rec = hook.patch_memory(ee, frames0, [(C + 0x30, 3)], 0)
    tstate = os.path.join(SCRATCH, "trace_%s.p2s" % a.name)
    write_p2s(tstate, {"eeMemory.bin": bytes(ee)}, a.state)
    env = os.path.join(SCRATCH, "trace.env")
    lines = [l for l in open(env).read().splitlines() if not l.startswith("STATEFILE=")] + ["STATEFILE=" + tstate]
    open(env, "w").write("\n".join(lines) + "\n")
    cfg = os.path.join(SCRATCH, "cfg", "PCSX2")
    before = set(glob.glob(cfg + "/snaps/*")) | set(glob.glob(cfg + "/sstates/*"))
    T.systemctl("stop", T.UNIT)
    sock = os.path.join(os.environ.get("XDG_RUNTIME_DIR", "/tmp"), "pcsx2.sock")
    if os.path.exists(sock): os.unlink(sock)
    T.systemctl("start", T.UNIT)
    p = None; dl = time.time() + 120
    while time.time() < dl:
        try:
            p = PineW(); p.read32(hook.CTRL + 4); break
        except (OSError, IOError):
            p = None; time.sleep(0.5)
    if p is None:
        T.systemctl("stop", T.UNIT); sys.exit("PINE did not come up")

    def entry(f, lx=0.0, ly=0.0, buttons=(), rx=0.0, ry=0.0):
        bits = 0
        for b in buttons: bits |= 1 << T.BUTTONS[b]
        bits ^= 0xFFFF
        e = hook.SCRIPT + f * hook.SCRIPT_STRIDE
        p.write32(e, bits | stick_byte(rx) << 16 | stick_byte(ry) << 24)
        p.write32(e + 4, stick_byte(lx) | stick_byte(ly) << 8)
        p.write32(e + 12, (0xFF if "cross" in buttons else 0) | (0xFF << 24 if "r1" in buttons else 0))

    wi, hist, events, cross_until, cool, t_end, last = 0, [], [], -1, 0, None, -1
    status, nstuck, recover_until, rec_wp, fire_until = "running", 0, -1, 0, -1
    m_ = p.read32(fields.G_OBJTAB); otab = p.read32(m_ + 0x1164)
    aim = dict(n=0, tgt=None)

    def enemies(pos):
        """Live enemy actors (vtable ENEMY_VT, active, HP > 0) within fight_range: [(dist, obj, (x, y, z))]."""
        otab = p.read32(p.read32(fields.G_OBJTAB) + 0x1164)
        tab = struct.unpack("<256I", p.read_block(otab, 1024))
        out = []
        for o in tab:
            if not o or p.read32(o + 0x18) != fields.ENEMY_VT or not p.read32(o + 0x28) & 1: continue
            c_, st_ = p.read32(o + 0xE8), p.read32(o + 0x17C)
            if not c_ or not st_ or p.read32(st_ + 0x20) <= 0: continue  # dead
            q = p.f32s(c_ + 0x30, 3)
            dd = math.dist(q, pos)
            if dd < a.fight_range: out.append((dd, o, q))
        return sorted(out)

    hunt_o = 0
    hunt = dict(last=None)

    def has_item(idw):
        """Inventory *(status +0x80): +0x26 slots, *(+0x34) = entries of 12 bytes (id, count) (FUN_0031e940)."""
        inv = p.read32(PS + 0x80); n_ = p.read32(inv + 0x24) >> 16; ent = p.read32(inv + 0x34)
        raw = p.read_block(ent, 12 * min(n_, 64))
        for k_ in range(min(n_, 64)):
            if struct.unpack_from("<II", raw, 12 * k_) [0] == idw and struct.unpack_from("<II", raw, 12 * k_)[1] > 0: return True
        return False

    def aim_stick(pos, f):
        """Right stick toward the nearest live enemy's chest. Signs from w253_cal: rx > 0 turns the camera's
        atan2(fz, fx) down, ry > 0 turns its forward y up (down the screen); full stick ~0.036 rad a frame."""
        if aim["n"] % 10 == 0:
            es = enemies(pos); aim["tgt"] = es[0] if es else None
            if hunt_o: aim["tgt"] = next((e_ for e_ in es if e_[1] == hunt_o), None)
        aim["n"] += 1
        if a.aim_at:
            q_ = [float(v) for v in a.aim_at.split(",")]; q_[1] += 12   # (the chest offset below)
            aim["tgt"] = (math.dist(q_, pos), 0, q_)
        if not aim["tgt"]: return None
        cam = p.f32s(CAM + 0x80, 8)
        fw, eye = cam[0:3], cam[4:7]
        q = aim["tgt"][2]; d = [q[0] - eye[0], q[1] - 12 - eye[1], q[2] - eye[2]]
        L_ = math.sqrt(sum(v * v for v in d)) or 1; d = [v / L_ for v in d]
        ey = math.atan2(fw[0] * d[2] - fw[2] * d[0], fw[0] * d[0] + fw[2] * d[2])
        ep = math.asin(max(-1, min(1, d[1]))) - math.asin(max(-1, min(1, fw[1])))
        # the game's stick dead zone is 0x30 of 0x80 (FUN_00258218): keep any correction above it
        dz = lambda e, g: 0.0 if abs(e) < 0.015 else math.copysign(min(1.0, 0.55 + 3 * abs(e)), e * g)
        rx, ry = dz(ey, -1.0), dz(ep, 1.0)
        if f >= aim.get("next", 0) and not a.aim_at:
            aim["next"] = f + 50
            st_ = p.read32(aim["tgt"][1] + 0x17C)
            print("fight f%d target %#x d %.0f hp %d err yaw %.3f pitch %.3f" % (
                f, aim["tgt"][1], aim["tgt"][0], p.read32(st_ + 0x20), ey, ep), flush=True)
        close = aim["tgt"][0] < 20                       # point blank: the chest fills the view (and the pitch clamps)
        # a big target (the helicopter, radius 90: other-types.md) is hit well off its centre
        wide = 0.12 if hunt_o and a.fight_range > 500 else 0.05
        return rx, ry, abs(ey) < (0.2 if close else wide) and abs(ep) < (0.25 if close else wide + 0.01)
    side_until, side_pt, side_k = -1, None, 0
    stuck_wi = 0
    flags_seen, pair_seen, flags_g, evt = None, None, {}, dict(t=None, box=None)
    stopf = tuple(int(x) for x in a.stop_flag.split("=")) if a.stop_flag else None
    if a.fight_first: fire_until = a.fight
    dl = time.time() + a.timeout
    while time.time() < dl:
        f = p.read32(hook.CTRL + 4)
        if f >= N - 2:
            status = "out of frames"; break
        if f == last:
            time.sleep(0.01); continue
        last = f
        pos = p.f32s(C + 0x30, 3)
        if f % 10 == 0:                                 # report story progress; optionally stop on a stage flag
            info_ = game_info(p); flags_g = info_["gflags"]
            if info_["flags"] != flags_seen or info_["pair"] != pair_seen:
                flags_seen, pair_seen = info_["flags"], info_["pair"]
                print("f%d (%.0f,%.0f,%.0f) flags %s global %s pair %s" % (f, pos[0], pos[1], pos[2], flags_seen, flags_g, pair_seen[:2]), flush=True)
            # (not mid-event: a state saved during a stage load has no player object, fields.resolve_bases fails on it)
            if stopf and flags_seen.get(stopf[0]) == stopf[1] and not in_event(p):
                status = "flag"; break
        # story beats: skip an event with the game's own path (Start, then cross on the pause menu's Skip); after
        # scene_save (global flag 18 = 1) answer the save box and the map screen, as w229_rescue
        if a.beats and K <= f:
            ev_ = p.read32(G_EV)                        # the save's hold: +0x1558 bit 39 (FUN_00376ee0(ev, 1, 1))
            if evt["box"] is None and (flags_g.get(18) == 1 or p.read32(ev_ + 0x155C) & 0x80):
                evt["box"] = f; print("f%d scene_save: answering the box" % f, flush=True)
            if evt["box"] is not None and f < evt["box"] + 640:
                dt = f - evt["box"]
                btn_ = () 
                for t0, b in ((300, "right"), (320, "cross"), (380, "left"), (400, "cross"), (500, "cross"), (600, "cross")):
                    if t0 <= dt < t0 + 5: btn_ = (b,)
                for k in (1, 2, 3): entry(f + k, 0, 0, btn_)
                hist.clear(); continue
            if evt["box"] is not None: evt["box"] = None
            if in_event(p):
                if evt["t"] is None:
                    evt["t"] = f; print("f%d (%.0f,%.0f,%.0f) event mode" % (f, pos[0], pos[1], pos[2]), flush=True)
                dt = (f - evt["t"]) % 240
                btn_ = ("start",) if 30 <= dt < 35 else ("cross",) if 70 <= dt < 75 else ()
                for k in (1, 2, 3): entry(f + k, 0, 0, btn_)
                hist.clear(); continue
            elif evt["t"] is not None:
                print("f%d (%.0f,%.0f,%.0f) event over after %d frames" % (f, pos[0], pos[1], pos[2], f - evt["t"]), flush=True)
                evt["t"] = None
        if a.stop_item and f % 10 == 0 and has_item(int(a.stop_item, 16)):
            status = "item"; print("f%d has item %s at (%.0f,%.0f,%.0f)" % (f, a.stop_item, pos[0], pos[1], pos[2]), flush=True); break
        hunt_t = None
        if a.hunt >= 0 and not hunt_o:                  # (not before the state has finished loading)
            otab = p.read32(p.read32(fields.G_OBJTAB) + 0x1164); hunt_o = p.read32(otab + 4 * (a.hunt + 22))
        if hunt_o:                                      # the target's position while alive, then the spot it died on
            c_h, st_h = p.read32(hunt_o + 0xE8), p.read32(hunt_o + 0x17C)
            alive = c_h and p.read32(hunt_o + 0x28) & 1 and p.read32(st_h + 0x20) > 0
            if alive: hunt["last"] = p.f32s(c_h + 0x30, 3)
            elif hunt["last"] and not hunt.get("dead"): hunt["dead"] = f; print("f%d target down at %s" % (f, [round(v) for v in hunt["last"]]), flush=True)
            hunt_t = hunt["last"]
            if alive and math.dist(hunt_t, pos) < a.fight_range and math.dist(route[-1], pos) < 12: fire_until = max(fire_until, f + 5)
            elif hunt.get("dead"): fire_until = f
        cam = p.f32s(CAM + 0x60, 12)
        rgt, fwd = (cam[0], cam[2]), (cam[8], cam[10])
        pst = p.read32(P + 0x104) & 0xFF
        if f < max(2, K) or pos == (0.0, 0.0, 0.0):   # not running the hook yet, or in the prefix
            if f % 200 == 0: print("f%d pos (%.0f,%.0f,%.0f) prefix" % (f, pos[0], pos[1], pos[2]), flush=True)
            continue
        hist.append((f, pos))
        if t_end is not None:
            entry(f + 1); entry(f + 2)
            if f >= t_end: status = "reached"; break
            continue
        # waypoint advance: nearest path SEGMENT (i -> i+1) of the next 40 ahead, then aim at the first waypoint
        # after it that is >= look away. (Worker 0221: the old nearest-WAYPOINT rule flipped the target between
        # waypoint i and i+1 when Vincent stood `look` u past i on a long segment, so the stick swapped every
        # frame and the run reported "stuck": the x -1001 (wp 25) and x -868 (wp 40) "blockers" were that.)
        # (worker 0253: y weight 1, not 0.3: the alley stairwell's flights are stacked 36 u apart)
        dist = lambda q: math.hypot(q[0] - pos[0], q[2] - pos[2]) + abs(q[1] - pos[1])
        def segd(i):
            if i + 1 >= len(route): return dist(route[i])
            q0, q1 = route[i], route[i + 1]
            ex, ez = q1[0] - q0[0], q1[2] - q0[2]
            t_ = max(0.0, min(1.0, ((pos[0] - q0[0]) * ex + (pos[2] - q0[2]) * ez) / ((ex * ex + ez * ez) or 1)))
            py_ = q0[1] + t_ * (q1[1] - q0[1])
            # another flight of stairs right above or below is not "nearer": only this floor's segments count
            return dist([q0[0] + t_ * ex, py_, q0[2] + t_ * ez]) + (1e4 if abs(py_ - pos[1]) > 10 else 0)
        wi = min(range(wi, min(len(route), wi + 15)), key=lambda i: (segd(i) >= 1e4, segd(i), i))
        ti = min(wi + 1, len(route) - 1)
        if f < recover_until:                           # back up along the path, then rejoin it
            ti = rec_wp
            if dist(route[ti]) < 3: recover_until = f
        else:
            while ti < len(route) - 1 and dist(route[ti]) < a.look and abs(route[ti][1] - pos[1]) < 20: ti += 1
        if ti == len(route) - 1 and dist(route[ti]) < a.reach and not hunt_o:
            t_end = f + a.settle; print("reached the last waypoint at f%d" % f, flush=True)
            continue
        tx, tz = route[ti][0] - pos[0], route[ti][2] - pos[2]
        if f >= recover_until and ti < len(route) - 1 and wi + 1 < len(route):
            # (worker 0253) carrot on the path, not the next waypoint: on a long segment, a straight line to its far end
            # from off the path cuts through the wall corners. Closest point on segment wi, then `look` u along the path.
            q0, q1 = route[wi], route[wi + 1]
            ex, ez = q1[0] - q0[0], q1[2] - q0[2]; sl = math.hypot(ex, ez) or 1
            t_ = max(0.0, min(sl, ((pos[0] - q0[0]) * ex + (pos[2] - q0[2]) * ez) / sl))
            left_, i_, cx, cz = a.look, wi, q0[0] + ex / sl * t_, q0[2] + ez / sl * t_
            while left_ > 0 and i_ + 1 < len(route):
                nx_, nz_ = route[i_ + 1][0], route[i_ + 1][2]
                d_ = math.hypot(nx_ - cx, nz_ - cz)
                if d_ >= left_: cx += (nx_ - cx) / d_ * left_; cz += (nz_ - cz) / d_ * left_; break
                left_ -= d_; cx, cz = nx_, nz_; i_ += 1
            tx, tz = cx - pos[0], cz - pos[2]
        if hunt_t and (hunt.get("dead") or 25 < math.dist(hunt_t, pos) < 60):
            tx, tz = hunt_t[0] - pos[0], hunt_t[2] - pos[2]
        if f < side_until:                              # sidestep: back-and-aside point, then past the obstacle
            sx, sz = side_pt[2 * side_k], side_pt[2 * side_k + 1]
            if side_k == 0 and math.hypot(sx - pos[0], sz - pos[2]) < 3: side_k = 1
            tx, tz = sx - pos[0], sz - pos[2]
        L = math.hypot(tx, tz) or 1; tx, tz = tx / L, tz / L
        # world = forward * (-ly) + right * lx (w217_cal); normalise the camera axes in xz
        fl = math.hypot(*fwd) or 1; rl = math.hypot(*rgt) or 1
        ly = -(tx * fwd[0] + tz * fwd[1]) / fl
        lx = (tx * rgt[0] + tz * rgt[1]) / rl
        m = max(abs(lx), abs(ly)) or 1; lx, ly = lx / m, ly / m
        btn = ()
        if pst == 10:                                   # ladder: climb toward the target's height
            lx, ly = 0.0, (-1.0 if route[ti][1] < pos[1] else 1.0)
        rx = ry = 0.0
        if f < fire_until:                              # fight: aim at the nearest soldier and fire
            if not (hunt_t and 25 < math.dist(hunt_t, pos) < 60): lx, ly = 0.0, 0.0
            r_ = aim_stick(pos, f)
            if r_ is None:
                fire_until = f
            else:
                rx, ry, on = r_
                btn = ("r1",) if on and (f // 4) % 2 and aim["tgt"][0] < a.fire_range else ()
        if f < cross_until: btn = ("cross",)
        elif cool <= f and len(hist) > 40 and pst != 10:
            f0, p0 = hist[-41]
            if math.hypot(pos[0] - p0[0], pos[2] - p0[2]) < 3.0 and abs(pos[1] - p0[1]) < 3.0:
                near = enemies(pos)
                if wi >= stuck_wi + 3: nstuck = 0
                stuck_wi = wi
                # cross first: a message box (an item's "Obtained!") holds the game until it is closed
                mode = "cross" if nstuck % 2 == 0 else "fire" if near and nstuck % 4 == 1 else ("recover", "left", "right")[(nstuck // 2) % 3]
                if mode in ("left", "right"):          # go round an obstacle that is not in the walk mesh (a prop)
                    nx_, nz_ = route[ti][0] - pos[0], route[ti][2] - pos[2]
                    ln_ = math.hypot(nx_, nz_) or 1; nx_, nz_ = nx_ / ln_, nz_ / ln_
                    sg = 1 if mode == "left" else -1
                    side_pt = (pos[0] - 10 * nx_ + sg * 9 * nz_, pos[2] - 10 * nz_ - sg * 9 * nx_,
                               pos[0] + 25 * nx_ + sg * 9 * nz_, pos[2] + 25 * nz_ - sg * 9 * nx_)
                    side_until, cool, side_k = f + 90, f + 95, 0
                elif mode == "recover":                  # back onto the path line
                    recover_until, cool, rec_wp = f + 60, f + 65, max(0, wi - 3)
                elif mode == "fire":                   # something (a soldier) stands in the way: shoot ahead
                    fire_until, cool = f + a.fight, f + a.fight + 40; aim["n"] = 0
                else:
                    cross_until, cool = f + 4, f + 60
                    btn = ("cross",)
                nstuck += 1
                if nstuck > a.max_stuck:
                    status = "stuck"; break
                mo = p.read_block(C + 0x570, 8).split(b"\0")[0].decode("latin1")
                print("stuck at f%d (%.0f,%.0f,%.0f) wp %d motion %s: %s" % (f, pos[0], pos[1], pos[2], w0 + wi, mo, mode),
                      flush=True)
                if a.shots:
                    subprocess.run(["import", "-display", ":97", "-window", "root",
                                    os.path.join(a.shots, "%s_stuck_f%d.png" % (a.name, f))])
        for k in (1, 2, 3): entry(f + k, lx, ly, btn, rx, ry)
        if f % 200 == 0:
            print("f%d pos (%.0f,%.0f,%.0f) wp %d/%d st %d" % (f, pos[0], pos[1], pos[2], w0 + wi, w1, pst), flush=True)
    f_save = p.read32(hook.CTRL + 4)
    pos = p.f32s(C + 0x30, 3)
    p.write32(PS + 0x20, a.hp_end)
    info = game_info(p)
    p.save_state(9)
    time.sleep(3)
    gs_f = None
    if a.gs:
        envx = dict(os.environ, DISPLAY=":97")
        wid = subprocess.run(["xdotool", "search", "--onlyvisible", "--name", "."], env=envx,
                             capture_output=True, text=True).stdout.split()[-1:]
        for w in wid:
            subprocess.run(["xdotool", "windowactivate", "--sync", w], env=envx)
            gs_f = p.read32(hook.CTRL + 4)
            subprocess.run(["xdotool", "key", "--window", w, "shift+F8"], env=envx)
        time.sleep(8)
    nlog = min(f_save, N)
    raw = p.read_block(hook.LOG, ((rec * nlog + 7) // 8) * 8)
    T.systemctl("stop", T.UNIT)
    new = sorted((set(glob.glob(cfg + "/snaps/*")) | set(glob.glob(cfg + "/sstates/*"))) - before)
    got = {}
    for fn in new:
        ext = ".p2s" if fn.endswith(".p2s") else ".gs.zst" if fn.endswith(".gs.zst") else os.path.splitext(fn)[1]
        dst = os.path.join(a.out, a.name + ext); shutil.move(fn, dst); got[ext] = dst
    os.unlink(tstate)
    # replay script from the hook's log of the pad bytes the game read (run-length events)
    evs, cur, start = [], None, 0
    for i in range(nlog):
        idx, w0b, w1b = struct.unpack_from("<III", raw, i * rec)
        if idx != i:                                   # the state is already saved: keep it, just no full replay
            print("log record %d corrupt: replay script stops there" % i, flush=True); nlog = i; break
        bits = ((w0b >> 16) & 0xFFFF) ^ 0xFFFF
        key = (bits, (w1b >> 16) & 0xFF, (w1b >> 24) & 0xFF, w1b & 0xFF, (w1b >> 8) & 0xFF)
        if key != cur:
            if cur and (cur[0] or any(v != 0x80 for v in cur[1:])): evs.append((start, i, cur))
            cur, start = key, i
    if cur and (cur[0] or any(v != 0x80 for v in cur[1:])): evs.append((start, nlog, cur))
    tob = lambda b: round((b - 128 + 0.5) / 127.5, 5)
    script = dict(name=a.name, frames=nlog, log_from=max(0, nlog - 2),
                  doc="worker 0217 route replay from %s (pokes: %s; HP set to %d before the save). Recorded pad "
                      "bytes of a PINE-steered run; see notes/route-states.md." % (
                          os.path.basename(a.state), ",".join("%x=%x" % pk for pk in pokes), a.hp_end),
                  events=[dict({"from": s, "to": e, "lx": tob(k[1]), "ly": tob(k[2]), "rx": tob(k[3]), "ry": tob(k[4])},
                               **({"buttons": [b for b, n in T.BUTTONS.items() if k[0] >> n & 1]} if k[0] else {}))
                          for s, e, k in evs])
    sp = os.path.join(repo, "tools", "trace", "scripts", "w217_%s.json" % a.name)
    json.dump(script, open(sp, "w"), indent=0)
    meta = dict(name=a.name, parent=os.path.basename(a.state), parent_hooked=hooked, status=status,
                frame_saved=f_save, gs_frame=gs_f, teleport=a.teleport, pos=[round(v, 2) for v in pos], pokes=[[hex(x), w] for x, w in pokes],
                hp_end=a.hp_end, wp=[w0, w0 + wi, w1], files=got, script=os.path.relpath(sp, repo), **info)
    json.dump(meta, open(os.path.join(a.out, a.name + ".json"), "w"), indent=1)
    print(json.dumps(meta))


if __name__ == "__main__":
    main()
