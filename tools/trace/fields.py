"""What the trace hook logs each frame, where it lives, and why we believe it.

Bases are resolved from the save state's EE memory the way the game resolves them
(resolve_bases), then each field is an absolute address copied per frame by the hook.
Confidence: D = decoded (code read, meaning clear), L = likely (code read, meaning
inferred), G = guess (layout seen in memory only). README.md has the same table.
"""
import struct

G_GAME = 0x46E290      # DAT_0046e290: game/world manager; +4 step, +0x40 camera, +0x44 view
G_OBJTAB = 0x46E880    # DAT_0046e880: object table owner (FUN_0053bb08)
STEP = 0x4EEB24        # DAT_004eeb24: logic step in ticks (FUN_00322f88)
DT = 0x4EEB28          # DAT_004eeb28: step in seconds = step / 60 (FUN_00322f88)
FLAGS = 0x46E298       # DAT_0046e298: script flags (FUN_00326298)
G_GSTATE = 0x46E294    # DAT_0046e294: game-state bit set (FUN_00326068 / FUN_00326018 / FUN_00326040)
G_AISCHED = 0x46F4EC   # DAT_0046f4ec: AI scheduler (FUN_00365dd8 creates, FUN_00365008 runs)
RETICLE = 0x471380     # DAT_00471380: reticle sprite object (FUN_003b0440 / FUN_003b0ac0)


def u32(mem, a):
    return struct.unpack_from("<I", mem, a & 0x1FFFFFF)[0]


def resolve_bases(mem):
    """Player P: FUN_0053bb08(DAT_0046e880) -> entry *(M+0x18) of the table at M+0x1164
    (FUN_0053e040) -> vtable+0x94 (here 0x579ae8, `move v0,a0`) -> FUN_00333150 calls
    vtable+0x9c (0x579b18, `move v0,a0`). Both getters return `this`, checked below."""
    if FIELDSET in ("event", "evactor", "stage"):    # absolute addresses only (worker 0210: states taken mid stage load have no player)
        return {}
    m = u32(mem, G_OBJTAB)
    idx = u32(mem, m + 0x18)
    obj = u32(mem, u32(mem, m + 0x1164) + 4 * idx)
    vt = u32(mem, obj + 0x18)
    for slot, adj in ((0x94, 0x90), (0x9C, 0x98)):
        fn = u32(mem, vt + slot)
        if (struct.unpack_from("<h", mem, vt + adj)[0] != 0 or u32(mem, fn) != 0x03E00008
                or u32(mem, fn + 4) != 0x0080102D):        # jr ra; daddu v0,a0,zero
            raise RuntimeError("player getter at vtable+%#x is not `return this`" % slot)
    P = obj
    C = u32(mem, P + 0xE8)
    CAM = u32(mem, u32(mem, G_GAME) + 0x40)
    MP = u32(mem, C + 0x7C8)
    MP2 = u32(mem, MP + 0x3E8)
    if u32(mem, CAM + 0x54) != P:
        raise RuntimeError("camera +0x54 is not the player")
    HUD = u32(mem, u32(mem, G_GAME) + 0x44)     # view/HUD object (FUN_0033c060, FUN_0033c868)
    RET = u32(mem, RETICLE)                       # reticle sprite object (FUN_003b0440)
    BM = u32(mem, MP + 0x3F8)                     # bone matrices (FUN_005a87a0 -> FUN_005b2d58)
    bases = dict(P=P, C=C, CAM=CAM, MP=MP, MP2=MP2, HUD=HUD, RET=RET, BM=BM)
    if FIELDSET == "path":
        bases.update(find_enemies(mem))
        bases["PS"] = u32(mem, P + 0x17C)          # player status record (TRACE_MELEE's p_hp)
    elif FIELDSET == "enemy":
        bases.update(find_enemies(mem))
        # game-state bit set: FUN_00326068(n) -> FUN_0036b610(DAT_0046e294, n) tests word n>>5
        # of *(*DAT_0046e294 + 4). Bit 6 set = AI scheduler paused (FUN_00365008 via FUN_00325b40).
        bases["GSB"] = u32(mem, u32(mem, u32(mem, G_GSTATE)) + 4)
        bases["AIQ"] = u32(mem, G_AISCHED)
        bases["PS"] = u32(mem, P + 0x17C)          # player status record (FUN_0055a370)
        bases["EVF"] = u32(mem, 0x47DBB0)        # DAT_0047dbb0: event-flag block (FUN_003ff658 / FUN_003ff738)
    elif FIELDSET == "stageinfo":                  # worker 0220: as "enemy" (no enemy records)
        bases["GSB"] = u32(mem, u32(mem, u32(mem, G_GSTATE)) + 4)
        bases["AIQ"] = u32(mem, G_AISCHED)
        bases["EVF"] = u32(mem, 0x47DBB0)
    elif FIELDSET in ("ammo", "reloadrun"):            # reloadrun: worker 0246
        # worker 0214: the weapon slot record R (FUN_0031a990(*(PS+0x84))) and the inventory entry of its ammo item
        # (FUN_00319ef0: FUN_0031e658(*(PS+0x80), FUN_00319ec0(R, 5)))
        PS = u32(mem, P + 0x17C)
        L = u32(mem, PS + 0x84)
        idx = ((u32(mem, L) << 28) & 0xFFFFFFFF) >> 28
        R = u32(mem, L + 0x10) + idx * 0xCC
        it = struct.unpack_from("<h", mem, (R + 0x2C) & 0x1FFFFFF)[0]
        bases.update(PS=PS, WL=L, R=R, INV=u32(mem, u32(mem, PS + 0x80) + 0x34) + it * 0xC)
    elif FIELDSET == "items":
        # worker 0224: the inventory entries (*(PS+0x80) +0x34, 12 bytes each; FUN_0031e658), the status, the event flags
        PS = u32(mem, P + 0x17C)
        bases.update(PS=PS, INVE=u32(mem, u32(mem, PS + 0x80) + 0x34), EVF=u32(mem, 0x47DBB0), INV0=u32(mem, PS + 0x80),
                     GSB=u32(mem, u32(mem, u32(mem, G_GSTATE)) + 4))
    elif FIELDSET == "hud":
        # the HUD's top-level groups (worker 0203): root HUD+0x18, slot i HUD+0x38+4i (FUN_003ad618)
        bases["HGR"] = u32(mem, RET + 0x18)
        for s in (1, 5, 6, 7, 8, 9, 10):
            bases["HG%d" % s] = u32(mem, RET + 0x38 + 4 * s)
    else:
        bases.update(find_cape(mem))
    return bases


ENEMY_VT = 0x58E1F8    # enemy actor class vtable, set by the constructor FUN_00558790
ENEMY_MAX = int(__import__("os").environ.get("TRACE_ENEMIES", 7))   # active e027s in the sea-of-flames save (notes/enemy-research.md); TRACE_ENEMIES=2 traces #66 / #67 only (longer logs)


ERECS = [int(x) for x in __import__("os").environ.get("TRACE_ERECS", "").split(",") if x]
# TRACE_EPIN="41:904760:91af00,..." (worker 0204): record:body:AI (hex) for actors that are still inactive in the state
# and activated during the run. The run is deterministic, so the body / AI addresses seen in a first run (call log or a
# later state) are where they will be built again; fields before the activation read whatever is there.
EPIN = {int(r): (int(c, 16), int(a, 16)) for r, c, a in
        (x.split(":") for x in __import__("os").environ.get("TRACE_EPIN", "").split(",") if x)}


def find_enemies(mem):
    """Active enemy actors at load: object table *(M+0x1164)[0..255] (FUN_0053e040), class
    vtable ENEMY_VT, with a body (+0xe8), status (+0x17c, FUN_0055a370) and AI (+0x184), i.e.
    already activated by vtable +0x144 = FUN_00559748. Enemies activated later in the run have
    no body yet and are NOT traced (the hook copies fixed addresses)."""
    m = u32(mem, G_OBJTAB)
    tab = u32(mem, m + 0x1164)
    out = {}
    n = 0
    for i in range(256):
        o = u32(mem, tab + 4 * i)
        if not o or u32(mem, o + 0x18) != ENEMY_VT:
            continue
        if ERECS and i - 22 not in ERECS:      # TRACE_ERECS: stage records (object index = record + 22)
            continue
        C, ST, AI = u32(mem, o + 0xE8), u32(mem, o + 0x17C), u32(mem, o + 0x184)
        if i - 22 in EPIN and ST and not u32(mem, o + 0x28) & 1:
            C, AI = EPIN[i - 22]
            out.update({"E%d" % n: o, "EC%d" % n: C, "ES%d" % n: ST, "EA%d" % n: AI, "EI%d" % n: i, "EM%d" % n: o, "EL%d" % n: o})
            n += 1
            if n == ENEMY_MAX:
                break
            continue
        if not (C and ST and AI) or not u32(mem, o + 0x28) & 1:
            continue
        out.update({"E%d" % n: o, "EC%d" % n: C, "ES%d" % n: ST, "EA%d" % n: AI, "EI%d" % n: i,
                    "EM%d" % n: u32(mem, C + 0x7C8),      # motion player, as the player's MP (C+0x7c8)
                    "EL%d" % n: u32(mem, C + 0x3A8) & ~3})   # nav node list *(C+0x3a8), word-aligned down (FUN_00369f40)
        n += 1
        if n == ENEMY_MAX:
            break
    if n == 0:
        raise RuntimeError("no active enemy actors in this state")
    for k in range(n, ENEMY_MAX):     # pad with the first enemy so the record layout is fixed
        for p in ("E", "EC", "ES", "EA", "EI", "EM"):
            out["%s%d" % (p, k)] = out["%s0" % p]
    return out


CAPE_N = 82            # cloth vertices in Vincent's cape block (p000_cloth.py)
CAPE_VERTS = (62, 63, 64, 73)   # free (unpinned) hem vertices, picked from the group list


def find_cape(mem):
    """Vincent's cape mesh block ("SM2", +0xe = 82 cloth vertices, +0x10 = 1 group).
    Found by signature, NOT through the game's pointer chain (the draw path reaches it as
    *(model+0x10)[i] in FUN_005b2ef8; that model pointer isn't traced yet). Runtime buffer
    +0x1c: velocity[n], position[n] at +n*16, target[n] at +n*32 (FUN_005b0d30 ->
    FUN_005b0b38(group, vel, pos, target)). Group +0 gravity, +8 damping."""
    hits = []
    for a in range(0x100000, 0x1FFF000, 16):
        if mem[a:a + 4] == b"SM2\0" and struct.unpack_from("<hh", mem, a + 0xE) == (CAPE_N, 1):
            hits.append(a)
    if len(hits) != 1:
        raise RuntimeError("expected one cape block, found %d" % len(hits))
    blk = hits[0]
    grp = u32(mem, u32(mem, blk + 0x24))
    if abs(struct.unpack_from("<f", mem, grp)[0] - 0.2) > 1e-6:
        raise RuntimeError("cape group gravity is not 0.2")
    return dict(CAPE=blk, CAPEBUF=u32(mem, blk + 0x1C))


# (name, base, offset, type, conf, source). Types: f32 / u32 / i32 / vec4 / mat4 / name8 /
# bytes:N. Every entry is copied as whole words; offsets are 4-aligned.
FIELDS = [
    ("step", None, STEP, "f32", "D", "FUN_00322f88 writes DAT_004eeb24 = vblank step x 1.2 (PAL), cap 5"),
    ("dt", None, DT, "f32", "D", "FUN_00322f88: DAT_004eeb28 = step x 0.016666668"),
    ("pad_held", None, 0x4E0FD8, "u32", "D", "FUN_00254638: lo16 = held (FUN_002584b0, pad+0x20), hi16 = pressed (pad+0x24); last frame's"),
    ("lstick", None, 0x4E0FE8, "bytes:8", "D", "FUN_00254638 -> FUN_00258218: left stick x,y floats, dead zone 0x30, scale 1/81; last frame's"),
    ("script_flags", None, FLAGS, "u32", "D", "FUN_00326298 tests DAT_0046e298 bits; bit 13 = physics-body walk (FUN_0034db80)"),
    ("p_state", "P", 0x100, "bytes:16", "D", "FUN_00333150: P+0x104 = player state byte (8 jump, 10 ladder...); P+0x100 u64 flag bits"),
    ("p_airshots", "P", 0x270, "u32", "D", "FUN_00575768 clears byte P+0x270 on take-off (air-shot counter)"),
    ("p_flags", "P", 0x29C, "bytes:16", "L", "FUN_00333150 tests P+0x2a8 bits 1/4; P+0x29c pointer"),
    ("matrix", "C", 0x00, "mat4", "D", "FUN_0034c388 writes row 3 (+0x30) = position from body+0x00; rows 0-2 = orientation (row 2 = facing, FUN_00575768 reads C+0x20)"),
    ("move_dir", "C", 0x90, "vec4", "D", "FUN_0034c388 writes the normalised move direction to C+0x90"),
    ("want_dir_speed", "C", 0xC0, "vec4", "D", "FUN_0034c388 mode 0xc: step = C+0xc0 (xyz dir) x C+0xcc (units/tick)"),
    ("mflags", "C", 0x1C0, "u32", "D", "C+0x1c0 bit 0x200 = on ground (FUN_003543b8, FUN_00575768), 0x2000/0x4000/0x400000 tested in FUN_0034c388"),
    ("mflags2", "C", 0x1C4, "u32", "D", "FUN_0034db80 sets bit 1, clears bit 4"),
    ("move_mode", "C", 0x1C8, "u32", "D", "FUN_0034db80 writes; FUN_0034c388 switches on it (10 walk, 0xb air, 0xc physics body, 0x10)"),
    ("mode_t", "C", 0x1CC, "f32", "L", "FUN_0034db80 zeroes; FUN_0034c388 path-follow time"),
    ("ground_speed", "C", 0x1D8, "f32", "D", "FUN_0034c388: C+0x1d8 = distance moved x 60 / step (units/s)"),
    ("body_pos", "C", 0x3B0, "vec4", "D", "FUN_0034c388: body = C+0x3b0, FUN_003590c8(body); C+0x30 copied from it"),
    ("body_10", "C", 0x3C0, "vec4", "L", "FUN_00357d48: body+0x10 vs body+0x00 y within 3.5 (previous/ground point)"),
    ("body_80", "C", 0x430, "vec4", "L", "FUN_0034c388 tests |C+0x430| == 0 (body+0x80; velocity-like)"),
    ("walk_poly", "C", 0x4C0, "u32", "D", "FUN_00357d48: body+0x110 = current walk-mesh polygon (handoff walk-mesh entry)"),
    ("anim_flags", "C", 0x564, "bytes:8", "D", "FUN_00344608/FUN_00340bb8 motion flags C+0x564; C+0x568"),
    ("motion", "C", 0x570, "name8", "D", "FUN_003449a0: C+0x570 = current motion (8-char clip name)"),
    ("motion_flags", "C", 0x580, "bytes:16", "D", "FUN_003449a0: C+0x580 = play flags, C+0x588 = -1; C+0x591 blend frames (FUN_00340bb8)"),
    ("mp_head", "MP", 0x440, "bytes:16", "D", "FUN_005a91c8: MP+0x440 flags, +0x448 head layer, +0x449 layer count"),
    ("mp_rate", "MP", 0x400, "bytes:16", "D", "FUN_005aa5b8 passes f32 MP+0x40c as the rate to FUN_005aa2a8 (frame += rate x weight/128 x DAT_004fc7e8); MP+0x408 = 1.0 when no blend"),
    ("mp_cloth", "MP", 0x430, "bytes:16", "D", "cloth settle window: MP+0x434 total, MP+0x438 remaining (FUN_005a95f0 arms, FUN_005aa5b8 decrements once per frame, FUN_005b1128 reads)"),
    ("cloth_k", None, 0x5B3B50, "f32", "D", "DAT_005b3b50 = (1 - rem/total)^2 or 1.0 (FUN_005b1128); FUN_005b2550 passes it to the cloth step FUN_005b0d30"),
    ("mp_layers", "MP", 0x200, "layers", "L", "FUN_005a91c8: 8 layers x 0x30 at MP+0x200: +0 clip, +8 partner clip, +0x18 frame (zeroed at start), +0x1d blend frames, +0x1e flags, +0x1f weight byte, +0x24 blend length"),
    ("mp2_head", "MP2", 0x440, "bytes:16", "L", "child motion player MP+0x3e8 (FUN_005a91c8 recurses into MP+1000..)"),
    ("mp2_layers", "MP2", 0x200, "layers", "L", "same layout as mp_layers"),
    ("cape_vel", "CAPEBUF", ("cape", 0), "cape", "L", "FUN_005b0b38: velocity of cape vertices 62,63,64,73 (v.y += gravity once per call; v = dpos x damping 0.1)"),
    ("cape_pos", "CAPEBUF", ("cape", 1), "cape", "L", "FUN_005b0b38/FUN_005b09f8/FUN_005b0c50: simulated position (world)"),
    ("cape_target", "CAPEBUF", ("cape", 2), "cape", "L", "FUN_005b0c50 pulls pos toward this skinned (keyed) target by max(k, blend)"),
    ("cam_matrix", "CAM", 0x60, "mat4", "L", "FUN_0032ace0: CAM+0x90 = eye (w set to 1.0 at the end), CAM+0x80 = forward (yaw from FUN_00260f00); rows +0x60 right, +0x70 up"),
    ("cam_a0", "CAM", 0xA0, "vec4", "G", "point with w=1 next to the eye (target?)"),
    ("cam_fov_pitch_yaw", "CAM", 0x170, "vec4", "L", "FUN_0032ace0: +0x170 divided by DAT_0046e3f0 (base FOV: 73.5 in RAM, ELF 65) -> FOV deg; +0x174 pitch (clamped to DAT_0046e3f8 = +50 deg in RAM (ELF 54) / DAT_0046e3fc = -54 deg); +0x178 yaw"),
]

# Opt-in set for aim/shoot research (TRACE_FIELDSET=aim): drops the cape, adds the weapon
# state (P+0x290..), the camera aim ray and view mode, the HUD reticle and the camera types.
# notes/aim-research.md explains each offset.
AIM_FIELDS = [f for f in FIELDS if f[0] in (
    "step", "pad_held", "p_state", "p_airshots", "matrix", "mflags", "move_mode",
    "ground_speed", "anim_flags", "motion", "motion_flags", "mp_head", "mp_layers")] + [
    ("p_face", "P", 0x118, "bytes:24", "D", "FUN_00562ef8: P+0x118 flags (bit 0/1), P+0x120 = face-toward point"),
    ("p_188", "P", 0x188, "bytes:8", "D", "FUN_00565ff0 sets/clears P+0x188 bit 38"),
    ("p_weapon", "P", 0x290, "bytes:48", "D", "FUN_00579570: +0x290 timer, +0x294 accumulator, +0x29c, +0x2a0, +0x2a4 state, +0x2a8 flags, +0x2b0 aim point (FUN_005784d8)"),
    ("cam_view", "CAM", 0x28, "bytes:8", "D", "FUN_00337338: CAM+0x28 camera type, +0x2c transition phase"),
    ("cam_typeptr", "CAM", 0x48, "u32", "D", "FUN_00337338: CAM+0x48 = camera type object"),
    ("cam_60", "CAM", 0x60, "bytes:128", "L", "CAM+0x60..0xdf: basis rows, +0x90 eye, +0xa0 aim hit, +0xb0 far point, +0xc0 hit normal (FUN_00329778)"),
    ("cam_f0", "CAM", 0xF0, "bytes:32", "L", "FUN_00329778 reads CAM+0xf0 (look-at point); FUN_0032a420 writes CAM+0x100"),
    ("cam_170", "CAM", 0x170, "bytes:192", "D", "FUN_0032ace0 / FUN_00329778 / FUN_0032a420: +0x170 FOV, +0x17c ramp, +0x184 hit dist, +0x1a0 shoulder, +0x1b0/+0x1b8 range, +0x1e0 fade, +0x1e4 target ids, +0x1e8 flags, +0x21c view mode, +0x224 kick"),
    ("hud", "HUD", 0x60, "bytes:80", "D", "FUN_0033c060 / FUN_0033c868: +0x60 reticle mode, +0x64 flags, +0x70 lock blend, +0x78/+0x7c offset, +0x90 target screen pos"),
    ("ret", "RET", 0x1B0, "bytes:96", "D", "FUN_003b0ac0: +0x1b0 kind, +0x1b1 flags, +0x1b2+k phase, +0x1bc+4k time, +0x1dc+2k length, +0x1ec/+0x1fc x/y"),
    ("camtype_c", None, 0x4EEBE0, "bytes:80", "D", "FUN_003314e0: camera type 0xc object at 0x4eebd0 (+0x10..)"),
    ("camtype_d", None, 0x4EEC40, "bytes:80", "D", "camera type 0xd object at 0x4eec30 (+0x10..)"),
    ("camtype_e", None, 0x4EECA0, "bytes:80", "D", "camera type 0xe object at 0x4eec90 (+0x10..)"),
]

# Opt-in set for body-pose research (TRACE_FIELDSET=pose): the motion player's bone
# matrices, 93 x 0x40 at *(MP+0x3f8). FUN_005a87a0 hands MP+0x3f8 to FUN_005b2d58 as the
# model's matrix buffer; FUN_005a9db0 -> FUN_005afa30/FUN_005afa58 fill it; FUN_005b06d0
# reads it (*(model+0x20) + bone*0x40) for the cape target. Model space, row-vector
# (row 3 = translation); checked against anim_rot.compose for h_st in the save state (0.01).
# 6.4 KB per record: set "log_from" so the log fits (about 60 frames).
POSE_BONES = 93
POSE_FIELDS = [f for f in FIELDS if f[0] in (
    "step", "pad_held", "matrix", "ground_speed", "mp_head", "mp_rate", "mp_layers", "cape_target")] + [
    ("bones", "BM", 0x0, "bytes:%d" % (POSE_BONES * 0x40), "D", "*(MP+0x3f8): bone matrices (FUN_005b2d58 / FUN_005b06d0), model space, row-vector"),
]

# Opt-in set for the follow camera (TRACE_FIELDSET=cam, worker 0089): FUN_0032ace0's state.
# CAM+0x170..0x22f (FOV, pitch +0x174, yaw +0x178, timers +0x1a8/+0x1e2, flags +0x1e8),
# the basis/eye (+0x60..+0xdf), look-at (+0xf0) and the normal type 0xc object.
CAM_FIELDS = [f for f in FIELDS if f[0] in (
    "step", "pad_held", "p_state", "matrix", "move_dir", "want_dir_speed", "ground_speed", "body_pos", "motion")] + [
    f for f in AIM_FIELDS if f[0] in ("cam_view", "cam_typeptr", "cam_60", "cam_f0", "camtype_c")] + [
    ("cam_170", "CAM", 0x170, "bytes:192", "D", "FUN_0032ace0: +0x170 FOV, +0x174 pitch, +0x178 yaw, +0x180 blend, +0x198/+0x19c, +0x1a8 auto-turn gain, +0x1ac, +0x1bc, +0x1c4/+0x1c8, +0x1e2 stick-idle counter, +0x1e8 flags, +0x214, +0x218"),
    ("cam_00", "CAM", 0x0, "bytes:96", "G", "CAM+0x00..0x5f: type +0x28, phase +0x2c, type object +0x48, player +0x54"),
    ("mp_matrix", "MP", 0x10, "mat4", "D", "MP+0x10: the draw matrix; FUN_003477c8 (camera base when C+0x564 & 0x18000000) = MP+0x10 x bone 0"),
    ("c_564", "C", 0x564, "u32", "D", "FUN_003422f0: C+0x564 & 0x18000000 picks the camera base (MP path vs C+0x54c vtable+0x24)"),
    # worker 0107 (jump camera): P+0x2a8 bit 0 gates FUN_00575768's FUN_0032a0f8(CAM, 1, 0)
    ("p_2a8", "P", 0x2A8, "u32", "D", "FUN_00574808 bits; FUN_00575768 bit 0 -> FUN_0032a0f8(CAM, 1, 0)"),
    # worker 0199 (death camera): FUN_00328790 writes CAM+0x230 phase / +0x234 clock; HP and the world-mode
    # object's state / timer at this state's addresses (as the gameover set)
    ("cam_230", "CAM", 0x230, "bytes:16", "D", "FUN_00328790: CAM+0x230 phase, +0x234 = DAT_0046e880+0x20 at the set"),
    ("p_hp", None, 0x960660, "u32", "D", "Vincent's HP (status P+0x17c + 0x20; gameover set)"),
    ("wmode", None, 0x94D58C, "u32", "D", "FUN_00334590 +0x2c state (lo16), +0x2e timer (hi16)"),
]

# Opt-in set for the jump (TRACE_FIELDSET=jump, worker 0095): no cape; the whole physics
# body (C+0x3b0..+0x4cf: state +0xa8, take-off t/y0/dy/v0/rise +0xd4..+0xe8, poly +0x110),
# the jump gates (FUN_00575698 / FUN_00577230) and the motion-state object pointer.
JUMP_FIELDS = [f for f in FIELDS if f[0] in (
    "step", "pad_held", "lstick", "p_state", "p_airshots", "matrix", "move_dir", "want_dir_speed",
    "mflags", "move_mode", "ground_speed", "body_pos", "motion", "motion_flags", "mp_head",
    "mp_layers", "cam_matrix")] + [
    ("body", "C", 0x3B0, "bytes:288", "D", "physics body C+0x3b0: +0xa8 state (FUN_00357860), +0xac flags, +0xd0 gravity, +0xd4 t, +0xd8 y0, +0xdc dy, +0xe0 v0, +0xe4 -h, +0xe8 rise (FUN_00357168)"),
    ("c_79c", "C", 0x79C, "u32", "D", "FUN_00575768: C+0x79c bit 0x20 = second jump used"),
    ("c_664", "C", 0x664, "u32", "D", "FUN_00575698: short C+0x664 must be 0, 1 or 2"),
    ("c_7d0", "C", 0x7D0, "u32", "D", "FUN_003419c0: *(C+2000) = motion-state object, its +0x70 = class id"),
    ("p_118", "P", 0x118, "u32", "D", "FUN_00577230 / FUN_005771c8: P+0x118 bits 0x200 / 0x40000"),
    ("p_2a8", "P", 0x2A8, "u32", "D", "FUN_00574808 bits; FUN_00575698 tests 8 and 0x10 in the air"),
    # M = *DAT_0046e880 = 0x128380 in the save state (worker 0131)
    ("m_gimmick", None, 0x128380 + 0x10AC, "u32", "D", "FUN_0053be88: M+0x10ac u16 = current gimmick id (0xffff none), chosen per frame by FUN_0053b500 -> FUN_0053bf30 -> FUN_00589978; the ✕ ladder check FUN_00544200 uses only it"),
]

# Opt-in set for enemy AI research (TRACE_FIELDSET=enemy, worker 0116): no cape; a little of
# the player, then the same block for each of the ENEMY_MAX actors found by find_enemies.
# notes/enemy-research.md §3 explains the objects.
def _enemy_fields(k):
    A, C, S, I = "E%d" % k, "EC%d" % k, "ES%d" % k, "EA%d" % k
    p = "e%d_" % k
    return [
        (p + "flags", A, 0x28, "u32", "D", "actor+0x28 bit 0 = active (FUN_00541c98, FUN_00558f68 test it before vtable +0x144)"),
        (p + "target", A, 0x118, "bytes:8", "D", "FUN_00563200: actor+0x118 bit 1 set -> target = object id u16 actor+0x11c (FUN_0053e040)"),
        (p + "face_pos", C, 0x20, "bytes:32", "D", "body C+0x20 = facing row, C+0x30 = position (same layout as the player's, FUN_0034c388)"),
        (p + "mflags", C, 0x1C0, "u32", "D", "C+0x1c0 move flags (as the player's); FUN_00361690 reads bit 0x100000"),
        (p + "move_mode", C, 0x1C8, "u32", "D", "C+0x1c8 move mode (FUN_0034c388)"),
        (p + "speed", C, 0x1D8, "f32", "D", "C+0x1d8 ground speed units/s (FUN_0034c388)"),
        (p + "motion", C, 0x570, "name8", "D", "C+0x570 current clip (FUN_003449a0)"),
        (p + "hp", S, 0x20, "u32", "D", "status+0x20 HP (FUN_0055c7f8 subtracts damage via FUN_003168c8)"),
        (p + "ai", I, 0x14, "bytes:48", "D", "AI +0x14 flags, +0x18 next think time, +0x20 interval/sub-state, +0x24 state, +0x34..+0x40 target distance/angle floats (FUN_00365110, FUN_00361690)"),
        (p + "ai_mode", I, 0xD0, "u32", "D", "AI +0xd0 brain mode (FUN_0035f300 / FUN_0035f268)"),
        (p + "ai_hit", I, 0x4C, "u32", "D", "AI +0x4c time of last hit taken (FUN_00360870, from FUN_0055db50)"),
        (p + "ai_hits", I, 0x70, "u32", "D", "AI +0x70 short = hits taken (FUN_00360870); +0x72 next"),
        # worker 0121 (combat AI, notes/enemy-research.md §9)
        (p + "ai_ammo", I, 0x7C, "u32", "D", "AI +0x7c short = rounds left (FUN_00360418 loads weapon +0x48; FUN_003605d8 -1 per shot); +0x7e"),
        (p + "ai_timer", I, 0xFC, "u32", "D", "AI +0xfc = fire-timer entry on the scheduler's 2nd list (FUN_003607a8 / FUN_00365478), 0 = not firing"),
        (p + "astate", A, 0x104, "u32", "D", "actor +0x104 byte = actor state (FUN_0055b8e0; 3 = gun up; 0x80-0xbf = attack, FUN_0055bb40)"),
        (p + "cflags", C, 0x564, "u32", "D", "C+0x564 motion flags: 0x4000 / 0x200000 tested by the shot FUN_003605d8; C+0x565 bit 7 = busy (FUN_0055ab08)"),
        # worker 0123 (why #66 takes no damage, notes/enemy-research.md §9.10)
        (p + "zone", A, 0x19C, "u32", "D", "actor +0x19c = hit-zone record (status +0xa8 -> +0x30 + part*16) set by the hit test FUN_0055bda8; byte 0 scales damage x0.05 (FUN_0055d2c0)"),
        (p + "part", A, 0x140, "u32", "D", "actor +0x142 byte = part index hit (FUN_0055bda8, from FUN_005ad118)"),
        (p + "st64", S, 0x64, "u32", "D", "status +0x64: bits 0/1 = no damage (FUN_0055f0e0 in FUN_0055db50), 0x20 (FUN_00317b68)"),
        (p + "ai_90", I, 0x90, "u32", "D", "AI +0x90 = shooter (+0x4c<<16 | +0x20) by FUN_003608d8; set only on the FUN_0055db50/0055e498 path, not the masked-part path FUN_0055df90"),
        (p + "pmask", C, 0x77C, "bytes:8", "D", "C+0x77c part mask; a hit on a set bit goes to FUN_0055df90 (hit counted, no damage) in FUN_0055bda8"),
    ] + ([  # TRACE_EVARS=1 (worker 0204): the script timers and vars
        (p + "a3c", A, 0x3C, "u32", "D", "object +0x3c / +0x3e script timers (cmd 0x106, FUN_0053e868)"),
        (p + "vars", A, 0xA0, "bytes:16", "D", "object +0xa0 script vars 0-7 (cmd 0x104 / 0x105)"),
        (p + "c590", C, 0x590, "u32", "D", "C+0x590 low 4 bits = the hit area (FUN_0055d390; worker 0259)"),
    ] if __import__("os").environ.get("TRACE_EVARS") else [])


ENEMY_FIELDS = [f for f in FIELDS if f[0] in ("step", "pad_held", "p_state", "matrix", "motion")]
ENEMY_FIELDS += [
    ("p_aim", "P", 0x2B0, "vec4", "D", "P+0x2b0 = weapon aim point = CAM+0xa0 (FUN_005784d8; notes/aim-research.md)"),
    ("cam_lock", "CAM", 0x1E4, "bytes:8", "D", "CAM+0x1e4 = locked actor id, CAM+0x1e8 bit 2 = lock mode (FUN_00328968)"),
    ("p_hp", "PS", 0x20, "u32", "D", "player status (P+0x17c, FUN_0055a370) +0x20 = HP (FUN_0055c7f8 subtracts damage; 780 in the save)"),
    ("gstate", "GSB", 0, "bytes:8", "D", "game-state bits 0..63 (FUN_0036b610); bit 6 = AI paused (FUN_00325b10, set by the event VM FUN_0037def0 / FUN_0037cf30)"),
    ("ai_now", "AIQ", 0, "u32", "D", "AI scheduler clock in ticks (FUN_00365008: += int(step) accumulated)"),
    ("evt_obj", None, 0x47DBB0, "u32", "D", "DAT_0047dbb0: event-flag block; FUN_0037e3c0 waits until flag N == value (FUN_003ff738)"),
    ("evt_flags", "EVF", 0x38, "bytes:64", "D", "event flags 0..63, stored XOR DAT_0047dbf0[n] (FUN_003ff658 writes, FUN_003ff738 reads)"),
    ("evt_key", None, 0x47DBF0, "bytes:64", "D", "DAT_0047dbf0: XOR key for evt_flags"),
    # worker 0124 (steer the aim onto #67): camera forward +0x80 and eye +0x90 (FUN_0032ace0)
    ("cam_fwd", "CAM", 0x80, "vec4", "L", "CAM+0x80 = camera forward (FUN_0032ace0); the aim ray runs eye + fwd * far (FUN_00329778)"),
    ("cam_eye", "CAM", 0x90, "vec4", "L", "CAM+0x90 = camera eye (FUN_0032ace0)"),
]
for _k in range(ENEMY_MAX):
    ENEMY_FIELDS += _enemy_fields(_k)
# TRACE_BOSS_BRAIN=<hex> (worker 0231, notes/boss-research.md): the z128 boss brain object (AI +0xe0, vtable 0xaa3508,
# 0x7c bytes: +0x1c prev state, +0x20 last HP, +0x24.. timers, +0x2a sub-state, +0x2c damage counter / bits, +0x2f
# shots, +0x30 count, +0x31 moves, +0x34.. shot ids) at an absolute address read from the state.
if __import__("os").environ.get("TRACE_BOSS_BRAIN"):
    ENEMY_FIELDS += [("boss_brain", None, int(__import__("os").environ["TRACE_BOSS_BRAIN"], 16), "bytes:128", "D",
                      "boss brain FUN_00aa1220 object (boss_z128.js makeBrain)")]
# TRACE_PPOS=1 (worker 0235): Vincent's object position P+0x90 (FUN_0054a720 with no parent) and parent P+8; in the boss
# route state r0b_boss2 the body / camera bases (C, CAM) do not follow him
if __import__("os").environ.get("TRACE_PPOS"):
    ENEMY_FIELDS += [("p_pos", "P", 0x90, "vec4", "D", "P+0x90 = object position (FUN_0054a720 without a parent)"),
                     ("p_par", "P", 0x8, "u32", "L", "P+8 = parent object")]
# Opt-in with TRACE_LOCK=1 (worker 0141, lock-on FUN_00328968 / FUN_00329778): the camera's
# lock state and the inputs of the picker, plus the per-soldier fields it reads. Off by default so
# the enemy record layout of the older traces stays the same.
if __import__("os").environ.get("TRACE_LOCK"):
    ENEMY_FIELDS += [
        ("cam_170", "CAM", 0x170, "bytes:192", "D", "CAM+0x170 FOV, +0x174/+0x178 view pitch/yaw, +0x190/+0x194 look stick, +0x1b0/+0x1b4/+0x1b8 lock range / cone / range, +0x1cc reticle angle, +0x1e4/+0x1e6 lock ids, +0x1e8 flags, +0x218 turn gain (FUN_00328968 / FUN_0032ace0)"),
        ("cam_a0", "CAM", 0xA0, "bytes:96", "D", "CAM+0xa0 aim point, +0xb0 far point, +0xc0 hit normal, +0xf0 look-at (FUN_00329778)"),
        ("p_8", "P", 0x8, "u32", "L", "P+8 = parent object (FUN_0054a720: 0 -> world position P+0x90); FUN_00577480's lead runs only when set"),
        ("p_272", "P", 0x270, "u32", "D", "P+0x272 short = aimed-at actor id (FUN_00573378)"),
        ("p_vel", "C", 0x410, "vec4", "D", "C+0x410 = (pos - last pos) / step (FUN_0034ea18, not in move mode 0xc)"),
        ("p_st64", "PS", 0x64, "u32", "D", "player status +0x64 bit 4 = no lock-on (FUN_0055f0e0(P, 4) in FUN_00328968)"),
        ("hud_60", "HUD", 0x60, "bytes:16", "D", "HUD+0x60 reticle mode, +0x64 flags (bit 0 lock option, 2 on target, 0x10 locked, 0x40 camera turn: FUN_0033c018)"),
        ("ret_1b0", "RET", 0x1B0, "bytes:64", "D", "RET+0x1b0 kind, +0x1b1 on-target/locked bits, +0x1b3.. phases, +0x1c0.. end times, +0x1de.. lengths (FUN_003b0ac0)"),
    ]
    for _k in range(ENEMY_MAX):
        _p = "e%d_" % _k
        ENEMY_FIELDS += [
            (_p + "a38", "E%d" % _k, 0x38, "u32", "D", "actor +0x38 probe bits (bit 2 = lockable: FUN_005449f0 probe 2, FUN_0055ef38)"),
            (_p + "par", "E%d" % _k, 0x8, "u32", "L", "actor +8 parent (FUN_00329778 adds 0.5 x C+0x410 only when set)"),
            (_p + "c764", "EC%d" % _k, 0x764, "u32", "D", "C+0x765 byte = lock bone (FUN_00340760 <- status +0xa8 +0x14; FUN_00563720)"),
            (_p + "vel", "EC%d" % _k, 0x410, "vec4", "D", "C+0x410 velocity per tick (FUN_0034ea18)"),
        ]

# Opt-in with TRACE_EMP=1 (worker 0149, enemy fire / blend clips): each enemy's motion player
# head and layer stack (MP = C+0x7c8, same layout as the player's mp_head / mp_layers).
if __import__("os").environ.get("TRACE_EMP"):
    for _k in range(ENEMY_MAX):
        _p = "e%d_" % _k
        ENEMY_FIELDS += [
            (_p + "mp_head", "EM%d" % _k, 0x440, "bytes:16", "D", "MP+0x440 flags, +0x448 head layer, +0x449 layer count (FUN_005a91c8)"),
            (_p + "mp_layers", "EM%d" % _k, 0x200, "layers", "L", "8 layers x 0x30 at MP+0x200 (as mp_layers)"),
        ]

# Opt-in with TRACE_PUSH=1 (worker 0154, actor push-out FUN_00542ab8): the push vector each actor
# gets (actor +0x130, cleared and summed by FUN_00542ab8), its cylinder and the flags the pair test reads,
# for the player and each traced soldier.
if __import__("os").environ.get("TRACE_PUSH"):
    ENEMY_FIELDS += [
        ("p_a28", "P", 0x28, "u32", "D", "actor +0x28 flags (FUN_00542ab8 tests 0x20 / 4)"),
        ("p_cyl", "P", 0x2C, "bytes:16", "D", "actor +0x2c radius, +0x30 height, +0x38 u16 (bit 9 = takes part in FUN_00542ab8)"),
        ("p_a118", "P", 0x118, "u32", "D", "actor +0x118 flags (0x8000000 / 0x4000000 / 0x10000000 / 0x20000 in FUN_00542ab8)"),
        ("p_push", "P", 0x130, "vec4", "D", "actor +0x130 = push vector summed by FUN_00542ab8"),
        ("p_c430", "C", 0x430, "vec4", "D", "C+0x430 = copy of actor +0x130 (FUN_00343160)"),
        ("p_c1c0", "C", 0x1C0, "u32", "D", "C+0x1c0 move flags"),
    ]
    for _k in range(ENEMY_MAX):
        _p = "e%d_" % _k
        ENEMY_FIELDS += [
            (_p + "cyl", "E%d" % _k, 0x2C, "bytes:16", "D", "actor +0x2c radius, +0x30 height, +0x38 u16"),
            (_p + "a118", "E%d" % _k, 0x118, "u32", "D", "actor +0x118 flags"),
            (_p + "push", "E%d" % _k, 0x130, "vec4", "D", "actor +0x130 push vector (FUN_00542ab8)"),
        ]

# Opt-in with TRACE_PUSHSTEP=1 (worker 0158, where the push enters Vincent's step): the move request
# C+0xc0 (dir, +0xcc speed), C+0x90 and the physics body's first 0xc0 bytes (+0x30 step from
# FUN_00358fb8, +0x40 velocity, +0x80 = C+0x430, +0xa8 state / +0xac flags; FUN_003590c8).
if __import__("os").environ.get("TRACE_PUSHSTEP"):
    ENEMY_FIELDS += [f for f in FIELDS if f[0] in ("move_dir", "want_dir_speed", "ground_speed")] + [
        ("body", "C", 0x3B0, "bytes:192", "D", "physics body C+0x3b0..+0x46f (FUN_003590c8)"),
    ]

# Opt-in set for soldier path walking (TRACE_FIELDSET=path, worker 0159; cmd 0x131 -> FUN_0055a6d8 ->
# FUN_0034edf0(C, 1), per frame FUN_0034ea18 -> FUN_0034f8c0 / FUN_0034fad0 and FUN_0034c388 move mode 9).
# TRACE_ERECS="46,47" picks the soldiers by stage record (object index = record + 22). Kept small so a
# long walk fits in the log: a little of the player and camera (to aim the wake shot), then per soldier the
# move state. C+0x1c0 block: +0x1c0 / +0x1c4 flags, +0x1c8 move mode, +0x1cc segment time, +0x1d0 duration,
# +0x1d4 constant speed, +0x1d8 ground speed, +0x1dc segment length, +0x1e0.. profile, +0x200 / +0x204
# polyline index / count, +0x208 arc position, +0x20c arc length, +0x210 tension, +0x214 turn mode, +0x218.
# C+0x300 block: +0x300 mover, +0x310 path, +0x314 node, +0x318 last node, +0x31c segment length,
# +0x320 length walked, +0x324, +0x328 path length, +0x32c.
PATH_FIELDS = [f for f in FIELDS if f[0] in ("step", "pad_held", "matrix")] + [
    ("cam_fwd", "CAM", 0x80, "vec4", "L", "CAM+0x80 = camera forward (FUN_0032ace0)"),
    ("cam_eye", "CAM", 0x90, "vec4", "L", "CAM+0x90 = camera eye (FUN_0032ace0)"),
    ("cam_lock", "CAM", 0x1E4, "bytes:8", "D", "CAM+0x1e4 = locked actor id (FUN_00328968)"),
    ("cam_a0", "CAM", 0xA0, "bytes:32", "D", "CAM+0xa0 aim point (ray hit), +0xb0 far point (FUN_00329778)"),
]
for _k in range(ENEMY_MAX):
    _A, _C, _I, _M = "E%d" % _k, "EC%d" % _k, "EA%d" % _k, "EM%d" % _k
    _p = "e%d_" % _k
    PATH_FIELDS += [
        (_p + "a100", _A, 0x100, "bytes:8", "D", "actor +0x100 u64: +0x104 byte actor state (FUN_0055b8e0), bits 40-41 gait (FUN_00565bd0)"),
        (_p + "ai_mode", _I, 0xD0, "u32", "D", "AI +0xd0 brain mode"),
        (_p + "cmat", _C, 0x0, "bytes:64", "D", "C+0x00 matrix rows (row 2 facing, row 3 = C+0x30 position; FUN_0034c388)"),
        (_p + "dir", _C, 0x90, "vec4", "D", "C+0x90 move direction (FUN_0034c388 mode 9: FUN_0025fdf0 tangent, normalised)"),
        (_p + "mv", _C, 0x1C0, "bytes:96", "D", "C+0x1c0..0x21f move state (see PATH_FIELDS)"),
        (_p + "path", _C, 0x300, "bytes:48", "D", "C+0x300..0x32f path mover (FUN_0034edf0 / FUN_0034fad0)"),
        (_p + "motion", _C, 0x570, "name8", "D", "C+0x570 current clip (FUN_003449a0)"),
        (_p + "c590", _C, 0x590, "bytes:8", "D", "C+0x590 posture bits 16-19 (FUN_003419e0), bit 24 gun out"),
        (_p + "mp_head", _M, 0x440, "bytes:16", "D", "MP+0x440 flags, +0x448 head layer, +0x449 count"),
    ]
# TRACE_PATH_BODY=1 (worker 0161, mover 3 = FUN_003504b0): the AI's distances / action state and the
# walk-mesh body the approach drives (FUN_0034af98 -> FUN_0034c388 move mode 0xc -> FUN_003590c8).
if __import__("os").environ.get("TRACE_PATH_BODY"):
    for _k in range(ENEMY_MAX):
        _C, _I, _p = "EC%d" % _k, "EA%d" % _k, "e%d_" % _k
        PATH_FIELDS += [
            (_p + "ai", _I, 0x14, "bytes:48", "D", "AI +0x14 flags, +0x28 action state (FUN_003667b0), +0x2a action time, +0x34 / +0x38 / +0x40 target distance / minus radii / dy"),
            (_p + "ai_e0", _I, 0xE0, "bytes:16", "D", "AI +0xe0 brain, +0xe4 action layer, +0xe8 combat layer, +0xec"),
            (_p + "want", _C, 0xC0, "bytes:32", "D", "C+0xc0 wanted move dir, +0xcc per-frame distance (FUN_0034af98), +0xd0 last"),
            (_p + "bvel", _C, 0x3E0, "bytes:32", "D", "body+0x30 wanted velocity, +0x40 velocity (FUN_00358fb8 / FUN_003590c8)"),
            (_p + "bst", _C, 0x458, "bytes:8", "D", "body+0xa8 state, +0xac flags (bits 19-21 accel / speed / turn limits)"),
            (_p + "blim", _C, 0x470, "bytes:16", "D", "body+0xc0.., +0xc4 speed change / s, +0xc8 turn rate / s (FUN_003590c8)"),
            (_p + "c430", _C, 0x430, "vec4", "D", "C+0x430 actor push (FUN_00542ab8)"),
            (_p + "c310", _C, 0x310, "bytes:16", "D", "C+0x310 s16 list length, +0x312 index, +0x314 byte follow state, +0x316, +0x318 (FUN_00351928)"),
            (_p + "srch", _C, 0x330, "bytes:16", "D", "C+0x330 search: +0 start node, +2 goal, +4, +6 max length, +8 mode, +0xa flags, +0xc f32 (FUN_0055a628)"),
            (_p + "c398", _C, 0x398, "u32", "D", "C+0x398 s16 = actor +0x108 node (FUN_00563a50)"),
            (_p + "a108", "E%d" % _k, 0x108, "u32", "D", "actor +0x108 s16 nav node (FUN_00563970)"),
            (_p + "list", "EL%d" % _k, 0x0, "bytes:68", "D", "*(C+0x3a8) u16 node list, -1 ended (FUN_00369f40); logged from the word below (skip ptr & 3 bytes: 2 for 46 / 47)"),
        ]
# TRACE_MELEE=1 (worker 0165, the melee hit FUN_00569dc0 -> FUN_00541310 / FUN_0057a330): Vincent's HP,
# flags and state, so the call-log set 'melee' can be lined up with the frames.
if __import__("os").environ.get("TRACE_MELEE"):
    PATH_FIELDS += [
        ("p_hp", "PS", 0x20, "u32", "D", "player status +0x20 = HP (FUN_0055c7f8 -> FUN_003168c8)"),
        ("p_state", "P", 0x100, "bytes:16", "D", "P+0x100 u64 flags, +0x104 state byte"),
        ("p_f118", "P", 0x118, "u32", "D", "P+0x118 flags (bit 0x20 / 0x40: no damage, FUN_0055eac8)"),
        ("p_pos", "P", 0x60, "bytes:64", "D", "P+0x60 world matrix (FUN_0054a5e8; row 3 = position)"),
    ]
if __import__("os").environ.get("TRACE_PATH_LAYERS"):
    for _k in range(ENEMY_MAX):
        PATH_FIELDS += [("e%d_mp_layers" % _k, "EM%d" % _k, 0x200, "layers", "L", "8 layers x 0x30 at MP+0x200")]

# Opt-in set for the BGM stream (TRACE_FIELDSET=music, worker 0177; notes/audio-research.md "Music"):
# the EE PCM ring DAT_0047d754 = 0x1fa0000 (u16 write slot, u16 read slot, u32 frames decoded; FUN_003ed000),
# the slot sent to the IOP next (DAT_0047d768, FUN_003ed8e0) and the main stream struct (DAT_004fab80).
MUSIC_FIELDS = [f for f in FIELDS if f[0] in ("step",)] + [
    ("bgm_ring", None, 0x1FA0000, "bytes:8", "D", "FUN_003ed000: +0 u16 write slot, +2 u16 read slot (FUN_003ed8e0), +4 u32 frames decoded"),
    ("bgm_iop_slot", None, 0x47D768, "u32", "D", "DAT_0047d768: next IOP slot (0..15), FUN_003ed8e0 -> FUN_0041ae50(1, buf, slot, 0x1000)"),
    ("bgm_main", None, 0x4FAB80, "u32", "D", "DAT_004fab80: main stream struct (FUN_003ec6f8); DAT_004fab84 = crossfade target"),
    ("bgm_xfade", None, 0x4FAB84, "u32", "D", "DAT_004fab84: crossfade stream (FUN_003ec0d8)"),
    # The main stream's file object (stream +8; 0x4c2460 in the sea-of-flames state): FUN_0024f870 / FUN_0024d730.
    ("bgm_file", None, 0x4C2460 + 0x218, "bytes:32", "L", "file +0x218 buffer, +0x21c 0x6000, +0x220 loop start, +0x224 loop end, +0x234 read position (bytes; frame = /0x180)"),
]

# Opt-in set for the game over (TRACE_FIELDSET=gameover, worker 0192; notes/gameover-research.md). Fixed
# addresses from the w181 death route (scripts/w192_*): the world-mode object (FUN_00334590's param_2,
# found by its vtable 0x4a0a78) and the two box screens are heap objects of that run.
GAMEOVER_FIELDS = [f for f in FIELDS if f[0] in ("step", "pad_held", "p_state", "motion", "cam_matrix")] + [
    ("clock_ms", None, 0x46B094, "u32", "D", "FUN_0023c1f0: uRam0046b094, the menu clock in ms"),
    ("p_hp", None, 0x960660, "u32", "D", "Vincent's HP: status P+0x17c (0x960640 in this state) + 0x20 (FUN_00316cf8)"),
    ("wmode", None, 0x94D58C, "u32", "D", "FUN_00334590 param_2 +0x2c state (lo16), +0x2e timer (hi16, s16)"),
    ("w_4c", None, 0x915540 + 0x4C, "u32", "D", "DAT_0046e290+0x4c: 1 = game over requested (FUN_00324ab0(1)); FUN_00324a90"),
    ("end_type", None, 0x47DB6C, "u32", "D", "PTR_0047db6c: end screen type (3 = game over), FUN_003fdb48"),
    ("end_state", None, 0x4FADBC, "u32", "D", "DAT_004fadbc: FUN_003fdf00 state"),
    ("end_box", None, 0x47DB78, "u32", "D", "PTR_0047db78: the kind-6 box slot"),
    ("end_t0", None, 0x47DB84, "u32", "D", "DAT_0047db84: clock at FUN_003fdb48"),
    ("end_ans", None, 0x47DB88, "u32", "D", "DAT_0047db88: the box result (6 / 7 / 8)"),
    ("boxes", None, 0x50DB60, "bytes:80", "D", "DAT_0050db60: box slots 0 and 1 (0x28 each)"),
    ("seq", None, 0x2340A0 + 0x47C, "bytes:20", "G", "kind-6 screen +0x47c index, +0x480 start ms, +0x484, +0x488 table, +0x48c kind, +0x48d mode"),
    ("seq_10d4", None, 0x2340A0 + 0x10D4, "u32", "G", "kind-6 screen +0x10d4: the menu box slot"),
    ("menu", None, 0x233EA0 + 0x38, "bytes:40", "G", "kind-0x21 screen +0x38.."),
    ("focus", None, 0x4F3034, "u32", "D", "DAT_004f3034 focused widget"),
    ("ui_flags", None, 0x4F3044, "u32", "D", "DAT_004f3044: 0x100 = DAT_0046b1dc count > 0 (FUN_00241760 -> FUN_003e0c78), 0x2000 FUN_003e0cc8"),
    ("pause", None, 0x477670, "u32", "D", "DAT_00477670: the pause screen (0 = none)"),
    ("sflags", None, 0x4B8980, "u32", "D", "DAT_004b8980 script flags (FUN_002413c0; bit 0x14 = FUN_003de130's first gate)"),
    ("pad_gate", None, 0x4E0FF8, "u32", "D", "DAT_004e0ff8 (FUN_00254810 needs 1)"),
    ("pad_gate2", None, 0x4E1204, "u32", "D", "DAT_004e1204 (FUN_00254810 needs != 0)"),
    ("fade", None, 0x4EC04C, "f32", "D", "DAT_004ec04c (FUN_002e29e0): FUN_003de130 needs <= 0"),
    ("dbb0_18", None, 0xA06300 + 0x18, "u32", "G", "DAT_0047dbb0 (0xa06300 in this run) +0x18: bit 5 = FUN_003e2910"),
    ("gstate", None, 0x4B8B2C, "u32", "D", "DAT_004b8b2c (FUN_00241d68): game state, 0x17 = paused"),
    ("stage_1558", None, 0x222F80 + 0x1558, "bytes:8", "G", "DAT_0046f850 (0x222f80 here) +0x1558 flags (FUN_003dfd18: bits 44 / 37)"),
    ("ref_1dc", None, 0x46B1DC, "bytes:8", "D", "DAT_0046b1dc count + DAT_0046b1e0[4] per-kind counts (FUN_00241760)"),
]

# Opt-in set for the HUD slides (TRACE_FIELDSET=hud, worker 0203; notes/hud-research.md "Slide-out at game over"):
# each top-level group's +2 flags / +6 rect (FUN_003cb380) and +0x48 slide state (FUN_003d0d50: state, length / 100 ms,
# base x y, dx dy, start ms). Group addresses are read from the state (the reload rebuilds the HUD at the same ones).
HUD_FIELDS = [f for f in FIELDS if f[0] in ("step",)] + [
    ("clock_ms", None, 0x46B094, "u32", "D", "FUN_0023c1f0: the menu clock in ms"),
    ("p_hp", None, 0x960660, "u32", "D", "Vincent's HP in the w192 route (status +0x20)"),
    ("end_type", None, 0x47DB6C, "u32", "D", "PTR_0047db6c: 3 = game over (FUN_003fdb48)"),
    ("gstate", None, 0x4B8B2C, "u32", "D", "DAT_004b8b2c (FUN_00241d68): game state"),
    ("hud_ac", "RET", 0xAC, "u32", "D", "HUD +0xac: panel 2 shown (FUN_003afe60 / FUN_003b0050)"),
] + [((("g%d" % s) if s else "groot") + sfx, ("HG%d" % s) if s else "HGR", o, "bytes:16", "D", d)
     for s in (0, 1, 5, 6, 7, 8, 9, 10)
     for o, sfx, d in ((0, "", "group +0: +2 flags, +6 x y w h (s16)"), (0x48, "_slide", "group +0x48 slide state (FUN_003d0d38)"))]

# Opt-in set for the event runtime (TRACE_FIELDSET=event, worker 0210; notes/event-vm-research.md): the event object
# DAT_004efba0 (0x222f80 in the z128 states; also DAT_0046f850), its clock (+0x9848 - +0x9858, ms; FUN_003798a0),
# the command slots' mask +0x514 and handle counter +0x1520 (FUN_00376040), skip state +0x156c, the system FED's fade
# particle DAT_0050b504 (FUN_002f4480 / FUN_002f4578), and event cameras 0-5 (+0x30 + id x 0x90: eye, aim, up point,
# fov, +0x64 active / +0x65 flag; FUN_003779d0 / FUN_00379148).
EV = 0x222F80
EVENT_FIELDS = [f for f in FIELDS if f[0] in ("step",)] + [
    ("ev_clock", None, EV + 0x9848, "bytes:20", "D", "+0x9848 clock, +0x984c last timer ms, +0x9850 shift, +0x9854 pause mark, +0x9858 paused total"),
    ("ev_mask", None, EV + 0x514, "u32", "D", "+0x514 live command slots (FUN_00376040 / FUN_00377c68)"),
    ("ev_handle", None, EV + 0x1520, "u32", "D", "+0x1520 last command handle"),
    ("ev_skip", None, EV + 0x156C, "u32", "D", "+0x156c skip state (FUN_00377c68: 1 -> 2)"),
    ("fade_p", None, 0x50B504, "u32", "D", "DAT_0050b504: the fade particle (FUN_002f4480 / FUN_002f4578)"),
] + [("ev_cam%d" % i, None, EV + 0x30 + i * 0x90, "bytes:56", "D", "event camera %d: +0x30 eye, +0x40 aim, +0x50 up point, +0x60 fov, +0x64 flags" % i)
     for i in range(6)]

# Opt-in set for ammo / reload (TRACE_FIELDSET=ammo, worker 0214; notes/aim-research.md "Ammo and reload"): the weapon
# state, the slot record's loaded rounds R+0x30 / cap R+0x94, the class sums at L+6, the ammo item count, the HUD text
# buffers (DAT_00471e08 -> 0x4efba8 + 0x20 k) and the HUD refresh mask DAT_0046e54c.
AMMO_FIELDS = [f for f in AIM_FIELDS if f[0] in ("step", "pad_held", "p_state", "motion", "p_188", "p_weapon")] + [
    ("p_10c", "P", 0x10C, "u32", "D", "FUN_00574f40 / FUN_005612e8: P+0x10c & 3 = the reload sound's table index"),
    ("p_118", "P", 0x118, "u32", "D", "FUN_00574f40: P+0x118 bit 0x200 clear -> reload state 8"),
    ("ps_60", "PS", 0x60, "bytes:80", "D", "status +0x60 flags (+0x61 bit 0), +0x64 flags, +0x80 inventory, +0x84 slot list, +0x9c"),
    ("wl", "WL", 0x0, "bytes:32", "D", "slot list: +0 index, +4 count, +6 class sums (FUN_0031aaa0), +0x10 records"),
    ("r_20", "R", 0x20, "bytes:24", "D", "slot record +0x2c ammo item index, +0x30 loaded rounds (FUN_00319ee0)"),
    ("r_94", "R", 0x94, "u32", "D", "slot record +0x94 cap (W+0x48)"),
    ("inv_ammo", "INV", 0x0, "bytes:12", "D", "inventory entry of the ammo item: +4 count (FUN_0031e658 / FUN_0031eb60)"),
    ("hud_text", None, 0x4EFBA8, "bytes:320", "D", "HUD text buffers 0x4efba8 + 0x20 k"),
    ("hud_mask", None, 0x46E54C, "u32", "D", "DAT_0046e54c: HUD refresh mask (bit 2 = weapon / ammo)"),
]

# Opt-in set for the reload while moving (TRACE_FIELDSET=reloadrun, worker 0246; notes/aim-research.md 'Reload motion
# class 0x1c'): the ammo set + position, speed, the head clip and layers, C+0x1c0 (bit 0x20 frozen, 0x200 ground),
# C+0x564 (0x4000 / 0x20000 from FUN_00598000), C+0x590 (bit 24 gun out), the speed table C+0x5f4..0x65c (FUN_00345b58)
# and the motion class object C+2000 (+4 phase, +8 done, +0xc timer, +0x70 class id).
RELOADRUN_FIELDS = AMMO_FIELDS + [f for f in FIELDS if f[0] in ("matrix", "ground_speed", "mp_head", "mp_rate", "mp_layers")] + [
    ("c_1c0", "C", 0x1C0, "u32", "D", "C+0x1c0 (0x20: FUN_0034ea18 returns at once; 0x200 on the ground)"),
    ("c_564", "C", 0x564, "bytes:8", "D", "C+0x564 / +0x568 flags"),
    ("c_590", "C", 0x590, "bytes:8", "D", "C+0x590 (bit 24 gun out), +0x591 blend"),
    ("c_tab", "C", 0x5F4, "bytes:112", "D", "FUN_00345b58 table: 3 x 0x18 rows from +0x5f4 (+0 motion row), +0x658 count, +0x659 index"),
    ("c_cls", "C", 2000, "u32", "D", "C+2000 = the motion class object (FUN_00341780)"),
]

# Opt-in set for footsteps and placed sounds (TRACE_FIELDSET=ambfoot, worker 0215; notes/audio-research.md "Footsteps").
AMBFOOT_FIELDS = [f for f in FIELDS if f[0] in ("step", "pad_held", "matrix", "ground_speed", "walk_poly", "mp_head")] + [
    ("c_6c0", "C", 0x6C0, "u32", "D", "byte 1 = C+0x6c1 floor material (FUN_00340e08)"),
    ("c_568", "C", 0x568, "u32", "D", "C+0x568 (bits 0x10000000 / 0x20000000 / 0x80000000: FUN_003415d8 / FUN_003466a8 / FUN_003467b8)"),
    ("c_590", "C", 0x590, "u32", "D", "C+0x590 bits 30-31: gait (FUN_00346650; 0 stand, 1 walk, 2 run)"),
    ("mp_3b0", "MP", 0x3B0, "bytes:12", "D", "MP+0x3b0 footstep name (FUN_005ae708), +0x3b8 slot"),
    ("mp_440", "MP", 0x440, "u32", "D", "MP+0x440 bits 16-19: feet up (FUN_005ae828)"),
    ("mp_pos", "MP", 0x40, "vec4", "D", "MP+0x10 matrix row 3 (FUN_005a70c8: the footstep's position)"),
    ("foot_l", "BM", 84 * 0x40 + 0x30, "vec4", "D", "bone 84 row 3 (p000 marker 7, FUN_0030bef8)"),
    ("foot_r", "BM", 88 * 0x40 + 0x30, "vec4", "D", "bone 88 row 3 (p000 marker 8)"),
    ("bg_tab", None, 0x4F5920, "bytes:256", "D", "DAT_004f5920: 8 x {slot, object, vol, _, pos} (FUN_003e6d70)"),
]

# Opt-in set for the event's actors (TRACE_FIELDSET=evactor, worker 0218; notes/event-vm-research.md "Event actors"):
# the event clock, actor slots 0..13 (event +0x1800 + 0x200 i: +0x18 id, +0x1c MP, +0x50 matrix row 3 = setpos;
# FUN_00376308 / FUN_0037abf8). TRACE_EVMP="a,b,..." (hex MP addresses from a first run) adds per MP: +0x10 matrix
# (64 bytes), +0x40c rate, +0x448 head / count, and each of the 8 layers' clip (+0x200 + 0x30 k) and frame (+0x218).
# TRACE_EVVOICE=1 (worker 0263): the six voice channels DAT_004f7c38 (0x40 each): +4 the voice, +0x1c bit 1 playing (FUN_003ead30, FUN_003eaea8)
if __import__("os").environ.get("TRACE_EVVOICE"):
    EVENT_FIELDS += [("ev_vc%d" % i, None, 0x4F7C38 + 0x40 * i, "bytes:32", "D", "voice channel %d" % i) for i in range(6)]
_EVSLOTS = int(__import__("os").environ.get("TRACE_EVSLOTS", "14"))   # worker 0262: kita_ev0145 has 30 slots
EVACTOR_FIELDS = [f for f in FIELDS if f[0] in ("step",)] + [
    ("ev_clock", None, EV + 0x9848, "bytes:20", "D", "+0x9848 clock .. +0x9858 paused total"),
] + [("ea%d" % i, None, EV + 0x1800 + 0x200 * i + 0x18, "bytes:8", "D", "actor slot %d: +0x18 id, +0x1c MP" % i)
     for i in range(_EVSLOTS)] + [("ea%d_pos" % i, None, EV + 0x1800 + 0x200 * i + 0x50, "bytes:12", "D", "actor slot %d: matrix row 3" % i)
                            for i in range(_EVSLOTS)]
for _k, _a in enumerate(x for x in __import__("os").environ.get("TRACE_EVMP", "").split(",") if x):
    _a = int(_a, 16)
    EVACTOR_FIELDS += [("mp%d_mat" % _k, None, _a + 0x10, "bytes:64", "D", "MP %#x +0x10 matrix" % _a),
                       ("mp%d_rate" % _k, None, _a + 0x40C, "f32", "D", "MP +0x40c rate"),
                       ("mp%d_448" % _k, None, _a + 0x448, "u32", "D", "MP +0x448 head, +0x449 count"),
                       ("mp%d_180" % _k, None, _a + 0x180, "bytes:8", "D", "MP +0x180 hidden smd list entries (FUN_0037aa20, worker 0261)")]
    EVACTOR_FIELDS += [("mp%d_l%d" % (_k, _l), None, _a + 0x200 + 0x30 * _l, "bytes:8", "D", "layer clip") for _l in range(8)]
    EVACTOR_FIELDS += [("mp%d_f%d" % (_k, _l), None, _a + 0x218 + 0x30 * _l, "f32", "D", "layer frame") for _l in range(8)]

# Opt-in set for the stage-info / message boxes (TRACE_FIELDSET=stageinfo, worker 0220; notes/message-research.md):
# displayStageInfo_l FUN_0039e8e8 -> FUN_003fdb48 (kind PTR_0047db6c), FUN_003fdf00 (state DAT_004fadbc), the box object
# DAT_00479160 (FUN_003c5358). TRACE_SIBOX=addr adds the box's timeline fields (+0x47c step, +0x480 start, +0x48d mode).
STAGEINFO_FIELDS = [f for f in FIELDS if f[0] in ("step", "pad_held", "matrix")] + [
    ("gstate", "GSB", 0, "bytes:8", "D", "game-state bits 0..63; bit 6 = AI paused (FUN_00325b10)"),
    ("ai_now", "AIQ", 0, "u32", "D", "AI scheduler clock (FUN_00365008)"),
    ("evt_obj", None, 0x47DBB0, "u32", "D", "DAT_0047dbb0 event-flag block"),
    ("evt_flags", "EVF", 0x38, "bytes:64", "D", "event flags 0..63, XOR evt_key"),
    ("evt_key", None, 0x47DBF0, "bytes:64", "D", "DAT_0047dbf0"),
    ("si_kind", None, 0x47DB6C, "bytes:36", "D", "PTR_0047db6c kind, +4 0x47db70 file, +8 db74, +0xc db78 box slot, +0x10 db7c, +0x14 db80, +0x18 db84 clock, +0x1c db88, +0x20 db8c"),
    ("si_state", None, 0x4FADBC, "u32", "D", "DAT_004fadbc: FUN_003fdf00 state"),
    ("si_box", None, 0x479160, "u32", "D", "DAT_00479160: the stage-info box (FUN_003c5358)"),
    ("gclock", None, 0x4B8B2C, "u32", "D", "DAT_004b8b2c game state"),
    ("si_slots", None, 0x50DB60, "bytes:80", "D", "DAT_0050db60: type-8 box slots 0-1 (0x28 each; +1 result, FUN_003b68b8)"),
    ("si_focus", None, 0x4F3034, "u32", "D", "DAT_004f3034: focused widget"),
]
if __import__("os").environ.get("TRACE_SIBOX"):
    _b = int(__import__("os").environ["TRACE_SIBOX"], 16)
    STAGEINFO_FIELDS += [("sb_tl", None, _b + 0x47C, "bytes:20", "D", "box +0x47c step, +0x480 start clock, +0x484, +0x488 script, +0x48c kind / mode / result / +0x48f"),
                         ("sb_root", None, _b + 0x18, "bytes:8", "D", "box +0x18 root widget")]


# Opt-in set for the stage controller (TRACE_FIELDSET=stage, worker 0219; notes/stage-controller.md): the global flags
# DAT_0050db20 (XOR DAT_0046f608; FUN_0037cea0), the stage flags (zone object DAT_0047dbb0 = 0xa06300 in the z128 states,
# +0x38, XOR DAT_0047dbf0; FUN_003ff738), the event object's skip +0x156c and mode bits +0x1558 (bit 37 battle, 44 program).
STAGE_FIELDS = [f for f in FIELDS if f[0] in ("step",)] + [
    ("gflags", None, 0x50DB20, "bytes:64", "D", "DAT_0050db20 global flags (stored XOR DAT_0046f608)"),
    ("zflags", None, 0xA06300 + 0x38, "bytes:64", "D", "stage flags: zone object +0x38 (stored XOR DAT_0047dbf0)"),
    ("ev_skip", None, EV + 0x156C, "u32", "D", "+0x156c skip state"),
    ("ev_bits", None, EV + 0x1558, "bytes:8", "D", "+0x1558 mode bits"),
    ("ev_mask", None, EV + 0x514, "u32", "D", "+0x514 live command slots"),
]

# Opt-in set for item pickups and drops (TRACE_FIELDSET=items, worker 0224; notes/items-research.md): the inventory's first
# 8 entries, Vincent's status (+0x20 HP), the event flags, the HUD refresh mask, the frame counter, and the item objects
# TRACE_ITEMS="13cec0,..." (type 8, vt 0x590a68: +0x20 id, +0x28 flags, +0x90 place, +0xc0 item, +0xc4 count, +200 flags,
# +0xca dropper, +0xd0 model, +0xd8 fall speed, +0xdc spin clock) with their model's colour MP+0x41c and matrix MP+0x10.
ITEMS_FIELDS = [f for f in FIELDS if f[0] in ("step", "pad_held", "matrix")] + [
    ("inv", "INVE", 0, "bytes:96", "D", "inventory entries 0-7: u32 id, u32 count, u32 (FUN_0031e658)"),
    ("ps_20", "PS", 0x20, "u32", "D", "status +0x20 HP (FUN_00316cf8)"),
    ("ps_04", "PS", 0x4, "u32", "D", "status +4 max HP (FUN_003168e8; worker 0243)"),
    ("inv_hdr", "INV0", 0, "bytes:48", "D", "inventory +0 selected slot, +0xc last id, +0x10 selected id, +0x26 slots (worker 0243)"),
    ("gstate", "GSB", 0, "bytes:8", "D", "game-state bits 0..63"),
    ("evt_flags", "EVF", 0x38, "bytes:64", "D", "event flags 0..63, XOR evt_key"),
    ("evt_key", None, 0x47DBF0, "bytes:64", "D", "DAT_0047dbf0"),
    ("hud_mask", None, 0x46E54C, "u32", "D", "DAT_0046e54c: HUD refresh mask"),
    ("hud_text", None, 0x4EFBA8, "bytes:320", "D", "HUD text buffers 0x4efba8 + 0x20 k"),
    ("gil", None, 0x46E248, "u32", "D", "DAT_0046e248 (gil at +8)"),
]
for _k, _a in enumerate(x for x in __import__("os").environ.get("TRACE_ITEMS", "").split(",") if x):
    _a = int(_a, 16)
    ITEMS_FIELDS += [("it%d" % _k, None, _a + 0x20, "bytes:208", "D", "item %#x +0x20 .. +0xf0" % _a)]

# Opt-in set for the level end / Status screen (TRACE_FIELDSET=results, worker 0232; notes/results-research.md): the
# section stats DAT_0046e228 (0xa09b00 in the z128 states: +0 start, +4 end, +8 KO start, +0x10 + 4k stat k), the play
# clock DAT_0046b308 / KO counter DAT_0046b304, PTR_0047db90, the stage-info kind / state / box (as 'stageinfo'), the
# loader request DAT_004f5570 (calc: request 7). TRACE_SIBOX=addr adds the box's timeline and its +0xff0 stats copy.
RESULTS_FIELDS = [f for f in FIELDS if f[0] in ("step",)] + [
    ("st_head", None, 0xA09B00, "bytes:16", "D", "stats +0 start, +4 end, +8 KO start, +0xc"),
    ("st_sect", None, 0xA09B10, "bytes:80", "D", "section stats 0..19 (the box copy has all 54)"),
    ("clk", None, 0x46B304, "bytes:16", "D", "DAT_0046b304 KOs, 308 play seconds, 30c last second, 310 running"),
    ("db90", None, 0x47DB90, "u32", "D", "PTR_0047db90"),
    ("si_kind", None, 0x47DB6C, "bytes:36", "D", "PTR_0047db6c kind .. db8c"),
    ("si_state", None, 0x4FADBC, "u32", "D", "DAT_004fadbc: FUN_003fdf00 state"),
    ("si_box", None, 0x479160, "u32", "D", "DAT_00479160: the box (FUN_003c5358)"),
    ("ldr", None, 0x4F5570, "bytes:8", "D", "DAT_004f5570 loader state, 5572 request"),
    ("gclock", None, 0x4B8B2C, "u32", "D", "DAT_004b8b2c game state"),
]
if __import__("os").environ.get("TRACE_SIBOX"):
    _b = int(__import__("os").environ["TRACE_SIBOX"], 16)
    RESULTS_FIELDS += [("sb_tl", None, _b + 0x47C, "bytes:20", "D", "box +0x47c step, +0x480 start, +0x484 hold, +0x488 table, +0x48c kind / mode / result / +0x48f"),
                       ("sb_stats", None, _b + 0xFF0, "bytes:216", "D", "box +0xff0 stats copy"),
                       ("sb_1028", None, _b + 0x1028, "u32", "D", "box +0x1028")]

# Opt-in set for the Phoenix Down revive (TRACE_FIELDSET=revive, worker 0255; notes/items-research.md 'The revive'): the game
# over set's world mode + status flags +0x64, P+0x118, the head clip, the class object and C+0x1c0 / C+0x564.
REVIVE_FIELDS = [f for f in GAMEOVER_FIELDS if f[0] in ("step", "pad_held", "p_state", "motion", "p_hp", "wmode", "w_4c", "end_type", "end_state", "ref_1dc")] + \
                [f for f in FIELDS if f[0] in ("matrix", "ground_speed", "mp_head")] + [f for f in AIM_FIELDS if f[0] == "p_weapon"] + [
    ("ps_64", None, 0x9606A4, "u32", "D", "Vincent's status +0x64 (FUN_0055f3b0's flag bits)"),
    ("p_118", "P", 0x118, "u32", "D", "P+0x118 (bit 0x100: state 7's event 0xd, the corpse settled)"),
    ("c_1c0", "C", 0x1C0, "u32", "D", "C+0x1c0"),
    ("c_564", "C", 0x564, "bytes:8", "D", "C+0x564 / +0x568"),
    ("c_cls", "C", 2000, "u32", "D", "C+2000 = the motion class object"),
    ("cam_1e8", "CAM", 0x1E8, "u32", "D", "CAM+0x1e8 (0x400000: the death camera)"),
]

FIELDSET = __import__("os").environ.get("TRACE_FIELDSET")
if FIELDSET == "revive":
    FIELDS = REVIVE_FIELDS
if FIELDSET == "results":
    FIELDS = RESULTS_FIELDS
if FIELDSET == "items":
    FIELDS = ITEMS_FIELDS
if FIELDSET == "stage":
    FIELDS = STAGE_FIELDS
if FIELDSET == "stageinfo":
    FIELDS = STAGEINFO_FIELDS
if FIELDSET == "evactor":
    FIELDS = EVACTOR_FIELDS
if FIELDSET == "ammo":
    FIELDS = AMMO_FIELDS
if FIELDSET == "reloadrun":
    FIELDS = RELOADRUN_FIELDS
if FIELDSET == "event":
    FIELDS = EVENT_FIELDS
if FIELDSET == "hud":
    FIELDS = HUD_FIELDS
elif FIELDSET == "gameover":
    FIELDS = GAMEOVER_FIELDS
elif FIELDSET == "music":
    FIELDS = MUSIC_FIELDS
elif FIELDSET == "ambfoot":
    FIELDS = AMBFOOT_FIELDS
elif FIELDSET == "path":
    FIELDS = PATH_FIELDS
elif FIELDSET == "enemy":
    FIELDS = ENEMY_FIELDS
elif __import__("os").environ.get("TRACE_FIELDSET") == "jump":
    FIELDS = JUMP_FIELDS
elif __import__("os").environ.get("TRACE_FIELDSET") == "cam":
    FIELDS = CAM_FIELDS
elif __import__("os").environ.get("TRACE_FIELDSET") == "aim":
    FIELDS = AIM_FIELDS
elif __import__("os").environ.get("TRACE_FIELDSET") == "pose":
    FIELDS = POSE_FIELDS

# TRACE_RNG=1 (worker 0173): the shared RNG FUN_0040b5c0 -> FUN_0040b500, a Mersenne twister: 624 words at
# DAT_004fbe00 and the index DAT_004fc7c0 (enemy_ai.js GameRandom). With call-log set 'rng' it checks the draws.
if __import__("os").environ.get("TRACE_RNG"):
    FIELDS = FIELDS + [("rng_state", None, 0x4FBE00, "bytes:2496", "D", "DAT_004fbe00: MT state (624 u32)"),
                       ("rng_idx", None, 0x4FC7C0, "u32", "D", "DAT_004fc7c0: MT index")]

# TRACE_RAW=name:hexaddr:nbytes,... (worker 0257): any absolute RAM block, for one state's own objects
for _r in filter(None, __import__("os").environ.get("TRACE_RAW", "").split(",")):
    _n, _a, _c = _r.split(":")
    FIELDS = FIELDS + [(_n, None, int(_a, 16), "bytes:%d" % int(_c), "D", "TRACE_RAW")]

# TRACE_SLOTS=1 (worker 0244): the chunk slot table DAT_004e4c60 (3 slots, stride 0x70: +0x54 chunk, +0x5c loaded;
# area_stream.js) and the stream request DAT_0046bfb0..bc (current a / b, pending a / b)
if __import__("os").environ.get("TRACE_SLOTS"):
    FIELDS = FIELDS + [("chunk_slots", None, 0x4E4C60, "bytes:336", "D", "DAT_004e4c60: chunk slots (+0x54 chunk, +0x5c loaded)"),
                       ("stream_req", None, 0x46BFB0, "bytes:16", "D", "DAT_0046bfb0 / b4 current pair, b8 / bc pending")]

# TRACE_STREAMJOB=1 (worker 0247): the chunk load job: DAT_004e4c50 busy / +4 slot / +8 zone / +0xc chunk (FUN_002677a0,
# FUN_00267970) and FUN_00266ae0's case DAT_0046bf94 / file handle DAT_0046bf9c
if __import__("os").environ.get("TRACE_STREAMJOB"):
    FIELDS = FIELDS + [("stream_job", None, 0x4E4C50, "bytes:16", "D", "DAT_004e4c50 busy, +4 slot, +8 zone, +0xc chunk"),
                       ("load_case", None, 0x46BF94, "bytes:12", "D", "DAT_0046bf94 case, +4 DAT_0046bf98, +8 DAT_0046bf9c handle")]

# TRACE_FXTITLE=d15820 (worker 0202): the GAME OVER title's emitter (DAT_004ee4a0 +0x84 list head; the same heap
# address in the w198 states 1-5 of w192_gameover): its age +0x1c and step +0x20 (FUN_002ea040), read before the spawn too
if __import__("os").environ.get("TRACE_FXTITLE"):
    _e = int(__import__("os").environ["TRACE_FXTITLE"], 16)
    FIELDS = FIELDS + [("fxt_age", None, _e + 0x1C, "f32", "D", "title emitter +0x1c age"),
                       ("fxt_dt", None, _e + 0x20, "f32", "D", "title emitter +0x20 dt (FUN_002ea040: step + carry)")]

LAYER_BYTES = 8 * 0x30


def size_of(t):
    if t in ("f32", "u32", "i32"):
        return 4
    if t in ("vec4", "name8"):
        return 16 if t == "vec4" else 8
    if t == "mat4":
        return 64
    if t == "layers":
        return LAYER_BYTES
    if t == "cape":
        return 16 * len(CAPE_VERTS)
    if t.startswith("bytes:"):
        return int(t[6:])
    raise ValueError(t)


def field_table(bases):
    out = []
    for name, base, off, t, _c, _s in FIELDS:
        if t == "cape":
            arr = bases[base] + off[1] * CAPE_N * 16
            out.extend((arr + 16 * k, 4) for k in CAPE_VERTS)
            continue
        addr = off if base is None else bases[base] + off
        out.append((addr, size_of(t) // 4))
    return out


def _name(b):
    return b.split(b"\0", 1)[0].decode("latin-1")


def decode_layers(b):
    out = []
    for i in range(8):
        r = b[i * 0x30:(i + 1) * 0x30]
        out.append(dict(clip=_name(r[0:8]), partner=_name(r[8:16]),
                        f10=struct.unpack_from("<f", r, 0x10)[0],
                        f14=struct.unpack_from("<f", r, 0x14)[0],
                        frame=struct.unpack_from("<f", r, 0x18)[0],
                        b1c=r[0x1C], blend_frames=r[0x1D], lflags=r[0x1E], weight=r[0x1F],
                        u20=struct.unpack_from("<I", r, 0x20)[0],
                        blend_len=struct.unpack_from("<f", r, 0x24)[0],
                        tail=r[0x28:0x30].hex()))
    return out


def decode_record(rec):
    """rec: bytes of one log record -> dict."""
    idx, w0, w1 = struct.unpack_from("<III", rec, 0)
    pad = struct.pack("<II", w0, w1)
    out = dict(frame=idx, pad_in=dict(buttons=(pad[2] << 8 | pad[3]) ^ 0xFFFF,
                                      rx=pad[4], ry=pad[5], lx=pad[6], ly=pad[7], mode=pad[1]))
    p = 12
    for name, _b, _o, t, _c, _s in FIELDS:
        n = size_of(t)
        b = rec[p:p + n]
        p += n
        if t == "f32":
            v = struct.unpack("<f", b)[0]
        elif t in ("u32", "i32"):
            v = struct.unpack("<I" if t == "u32" else "<i", b)[0]
        elif t == "vec4":
            v = list(struct.unpack("<4f", b))
        elif t == "mat4":
            v = [list(struct.unpack_from("<4f", b, 16 * r)) for r in range(4)]
        elif t == "name8":
            v = _name(b)
        elif t == "layers":
            v = decode_layers(b)
        elif t == "cape":
            v = {str(k): list(struct.unpack_from("<4f", b, 16 * i)) for i, k in enumerate(CAPE_VERTS)}
        else:
            v = b.hex()
        out[name] = v
    return out

# TRACE_BARREL=1 (worker 0209; notes/barrel-research.md): record 17's barrel (object 479 at 0x1cedc0 in the save):
# +0x28 flags (bit 0 active), +0x90 centre, +0x104 HP; its motion player (0x14df680) +0x40 = MP+0x10 row 3, the draw origin
if __import__("os").environ.get("TRACE_BARREL"):
    FIELDS = FIELDS + [("b_a28", None, 0x1CEDC0 + 0x28, "u32", "D", "barrel object +0x28 (bit 0 = active, FUN_00584018)"),
                       ("b_pos", None, 0x1CEDC0 + 0x90, "bytes:16", "D", "barrel object +0x90 (the centre)"),
                       ("b_hp", None, 0x1CEDC0 + 0x104, "u32", "D", "barrel +0x104 HP (FUN_00585cd8)"),
                       ("b_mp", None, 0x14DF680 + 0x40, "bytes:16", "D", "barrel MP+0x10 row 3 (FUN_005842c8)")]
