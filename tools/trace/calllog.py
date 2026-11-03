"""Call logger for the trace state (worker 0127): wrap chosen game calls, log args and results.

Opt-in with TRACE_CALLLOG=<set> (see SETS). Each hook is either a `jal` call site inside a
function (rewritten to `jal STUB`) or a vtable slot (pointer replaced by STUB). The stub saves
a0-a3/t0/t1 and ra, calls the real function, then a shared logger appends one 128-byte entry:
  w0 hook id, w1 frame index (CTRL+4), w2 a0, w3 a1, w4 v0, w5 f0 (float result), w6 f12 at
  entry (first float argument), then up to 25 words copied from
  (saved register + offset) AFTER the call, per the hook's copy list.
Entries are only written while frame_lo <= frame < frame_hi. Results go to <name>.calls.jsonl.

Memory: stubs + logger at 0x96200..0x967ff (the pad hook ends below 0x96200), descriptors at
CLOG_CTRL, entries in the top CLOG_BYTES of the frame-log area (the frame log is shortened).
"""
import struct

import hook

STUBS, CLOG_CTRL, CLOG_DESC = 0x96200, 0x9CC00, 0x9CC20   # CTRL2: lo, hi, wp, end
# TRACE_LOG_AT moves the frame log up (hook.py); the control block then sits just below it, so a script
# longer than 1000 frames can carry a call log too (worker 0165).
if __import__("os").environ.get("TRACE_LOG_AT"):
    CLOG_CTRL = hook.LOG - 0x400
    CLOG_DESC = CLOG_CTRL + 0x20
# CLOG_CTRL/DESC sit at the end of the script area: scripts must be <= 1000 frames.
CLOG_BYTES = 0x30000
ENTRY = 128
SLOT = dict(ra=0x00, a0=0x10, a1=0x20, a2=0x30, a3=0x40, t0=0x50, t1=0x60, v0=0x70)


class Asm(hook.Asm):
    def lq(self, rt, off, rs): self._i(0x1E, rs, rt, off)
    def sq(self, rt, off, rs): self._i(0x1F, rs, rt, off)
    def sra(self, rd, rt, sa): self._r("zero", rt, rd, sa, 0x03)
    def srl(self, rd, rt, sa): self._r("zero", rt, rd, sa, 0x02)
    def andi(self, rt, rs, imm): self._i(0x0C, rs, rt, imm)
    def swc1(self, ft, off, rs): self.code.append((0x39 << 26) | (hook.R[rs] << 21) | (ft << 16) | (off & 0xFFFF))


hook.R.update(a3=7, v1=3, s2=18, t9=25)


def _logger(a):
    """t8 = stub frame (saved regs), t9 = descriptor {id, copy words..., 0}. Leaf, t-regs only."""
    a.label("logger")
    a.li32("t0", CLOG_CTRL)
    a.li32("t1", hook.CTRL)
    a.lw("t1", 4, "t1")                  # frame index
    a.lw("t2", 0, "t0")
    a.slt("t3", "t1", "t2")
    a.bne("t3", "zero", "lret")
    a.lw("t2", 4, "t0")                  # delay
    a.slt("t3", "t1", "t2")
    a.beq("t3", "zero", "lret")
    a.lw("t4", 8, "t0")                  # delay: wp
    a.lw("t5", 12, "t0")
    a.addiu("t6", "t4", ENTRY)
    a.slt("t3", "t5", "t6")
    a.bne("t3", "zero", "lret")          # full
    a.nop()
    a.sw("t6", 8, "t0")                  # wp += ENTRY
    a.lw("t2", 0, "t9")
    a.sw("t2", 0, "t4")                  # id
    a.sw("t1", 4, "t4")                  # frame
    a.lw("t2", SLOT["a0"], "t8"); a.sw("t2", 8, "t4")
    a.lw("t2", SLOT["a1"], "t8"); a.sw("t2", 12, "t4")
    a.lw("t2", SLOT["v0"], "t8"); a.sw("t2", 16, "t4")
    a.lw("t2", 0x80, "t8"); a.sw("t2", 20, "t4")      # f0 after the call
    a.lw("t2", 0x84, "t8"); a.sw("t2", 24, "t4")      # f12 at entry
    a.addiu("t4", "t4", 28)
    a.addiu("t9", "t9", 4)
    a.label("cpy")
    a.lw("t2", 0, "t9")                  # (slot << 24) | (n << 16) | off16
    a.beq("t2", "zero", "lret")
    a.srl("t3", "t2", 24)                # delay: slot
    a.addu("t3", "t3", "t8")
    a.srl("t6", "t2", 16)
    a.andi("t6", "t6", 0xFF)             # n words (bit 7: copy the saved register itself, see cpr)
    a.andi("t5", "t6", 0x80)
    a.bne("t5", "zero", "rawreg")
    a.andi("t6", "t6", 0x7F)             # delay
    a.lw("t3", 0, "t3")                  # saved register (low word)
    a.label("rawreg")
    a.sll("t5", "t2", 16)
    a.sra("t5", "t5", 16)
    a.addu("t3", "t3", "t5")             # src
    a.label("cw")
    a.lw("t5", 0, "t3")
    a.sw("t5", 0, "t4")
    a.addiu("t3", "t3", 4)
    a.addiu("t4", "t4", 4)
    a.addiu("t6", "t6", -1)
    a.bgtz("t6", "cw")
    a.nop()
    a.addiu("t9", "t9", 4)
    a.beq("zero", "zero", "cpy")
    a.nop()
    a.label("lret")
    a.jr("ra")
    a.nop()


def _stub(a, target, desc):
    a.addiu("sp", "sp", -0x90)
    a.sq("ra", 0, "sp")
    for r in ("a0", "a1", "a2", "a3", "t0", "t1"):
        a.sq(r, SLOT[r], "sp")
    a.swc1(12, 0x84, "sp")
    a.jal(target)
    a.nop()
    a.sq("v0", SLOT["v0"], "sp")
    a.swc1(0, 0x80, "sp")               # f0 (float result); f12 was saved at 0x84
    a.li32("t9", desc)
    a.addu("t8", "sp", "zero")
    a.jal(a.labels["logger"])
    a.nop()
    a.lq("v0", SLOT["v0"], "sp")
    a.lq("ra", 0, "sp")
    a.jr("ra")
    a.addiu("sp", "sp", 0x90)


def cp(reg, off, n):
    return (SLOT[reg] << 24) | (n << 16) | (off & 0xFFFF)


def cpr(reg):
    """Copy the register's own value (low word) instead of memory at it (worker 0172)."""
    return (SLOT[reg] << 24) | (0x81 << 16)


JAL = lambda t: 0x0C000000 | (t >> 2)

# Hook sets. kind "site": (function start, end, callee) -> every `jal callee` in [start, end).
# kind "vt": (vtable, slot offset).
SETS = {
    # worker 0127, notes/enemy-research.md §11: the bullet hit test.
    "bullet": [
        dict(id=1, kind="site", where=(0x556870, 0x557400, 0x5442D8), name="hit_test",
             # a3 = bullet: +0xe0 seg start, +0x90 seg end, +0x120 flags, +0x128 owner id,
             # +0xc0 origin, +0x124 time, +0x12c speed; a0 = mgr +0x10c0 hit point/normal
             copy=[cp("a3", 0xE0, 4), cp("a3", 0x90, 4), cp("a3", 0x120, 1), cp("a3", 0x128, 1),
                   cp("a3", 0xC0, 4), cp("a3", 0x124, 3), cp("a0", 0x10C0, 8)]),
        dict(id=2, kind="vt", where=(0x58F128, 0x1AC), name="filter_player", copy=[]),
        dict(id=3, kind="vt", where=(0x58E1F8, 0x1AC), name="filter_e027", copy=[]),
        dict(id=4, kind="vt", where=(0x58F128, 0x17C), name="part_player",
             copy=[cp("t0", 0, 3), cp("t1", 0, 3), cp("a2", 0, 3), cp("a0", 0x140, 1),
                   cp("a0", 0x19C, 1), cp("a0", 0x2C, 1), cp("a0", 0x118, 1), cp("a0", 0x28, 1)]),
        dict(id=5, kind="vt", where=(0x58E1F8, 0x17C), name="part_e027",
             copy=[cp("t0", 0, 3), cp("t1", 0, 3), cp("a2", 0, 3), cp("a0", 0x140, 1),
                   cp("a0", 0x19C, 1), cp("a0", 0x2C, 1), cp("a0", 0x118, 1), cp("a0", 0x28, 1)]),
        dict(id=6, kind="site", where=(0x55BDA8, 0x55C470, 0x55BC90), name="capsule",
             copy=[cp("a1", 0, 4), cp("a2", 0, 4), cp("a0", 0x2C, 1)]),
        dict(id=7, kind="site", where=(0x55BDA8, 0x55C470, 0x5AD118), name="part_ray",
             copy=[cp("a1", 0, 3), cp("a2", 0, 3)]),
        dict(id=8, kind="site", where=(0x55BDA8, 0x55C470, 0x25C0F8), name="seg_capsule",
             copy=[]),
        dict(id=9, kind="site", where=(0x55BDA8, 0x55C470, 0x25C770), name="pt_capsule",
             copy=[]),
    ],
}
# worker 0235: the homing missiles (FUN_00556218): every bullet at FUN_00556870's object test, after its move. a3 = bullet:
# +0xe0 seg start, +0x90 pos, +0x80 direction, +0xd0 target point, +0x120 flags, +0x124 age / +0x128 owner / +0x12c speed,
# +0x150 mode bits / +0x154 turn rate / +0x158 distance / +0x15c range.
SETS["missile"] = [
    dict(id=1, kind="site", where=(0x556870, 0x557400, 0x5442D8), name="hit_test",
         copy=[cp("a3", 0xE0, 4), cp("a3", 0x90, 4), cp("a3", 0x80, 4), cp("a3", 0xD0, 4), cp("a3", 0x120, 1),
               cp("a3", 0x124, 3), cp("a3", 0x150, 4)]),
]
# worker 0127: the fire-time spread (FUN_005405b0 -> FUN_0025a058, rand FUN_0040b5c0).
SETS["spread"] = [SETS["bullet"][0],
    dict(id=20, kind="site", where=(0x5694F8, 0x569870, 0x5409A8), name="spawn",
         copy=[cp("a1", 0, 4), cp("a2", 0, 4)]),          # muzzle, aim as passed (unchanged)
    dict(id=21, kind="site", where=(0x5409A8, 0x540AB0, 0x5405B0), name="aim_spread",
         copy=[cp("a2", 0, 4), cp("a3", 0, 4)]),          # muzzle, aim after spread (= end point)
    dict(id=22, kind="site", where=(0x5405B0, 0x5408E8, 0x25A058), name="cone",
         copy=[cp("a1", 0, 4)]),                          # f12 = spread (deg); dir after
    dict(id=23, kind="site", where=(0x25A058, 0x25A240, 0x40B5C0), name="rand", copy=[]),  # f0
]

# worker 0158: the physics-body step of mode 0xc (FUN_0034c388 -> FUN_00358fb8 / FUN_003590c8 ->
# FUN_00357d48). a0 = body (C+0x3b0): +0 pos, +0x30 step, +0x40 velocity, +0x80 (= C+0x430), +0xa8.
SETS["pushstep"] = [
    dict(id=30, kind="site", where=(0x34C388, 0x34D400, 0x358FB8), name="set_step",
         copy=[cp("a1", 0, 4), cp("a0", 0x30, 4), cp("a0", 0x80, 4), cp("a0", 0xA8, 2)]),
    dict(id=31, kind="site", where=(0x34C388, 0x34D400, 0x3590C8), name="body_step",
         copy=[cp("a0", 0, 4), cp("a0", 0x30, 4), cp("a0", 0x40, 4), cp("a0", 0x80, 4)]),
    dict(id=32, kind="site", where=(0x3590C8, 0x359D68, 0x357D48), name="walk_move",
         copy=[cp("a1", 0, 4), cp("a0", 0, 4), cp("a0", 0x110, 1)]),
    # FUN_0035a440(body, out, in): out = in + correction (wall / object contacts, then + body+0x80)
    dict(id=33, kind="site", where=(0x357D48, 0x358FB8, 0x35A440), name="push_out",
         copy=[cp("a1", 0, 4), cp("a2", 0, 4), cp("a0", 0x80, 4), cp("a0", 0xB0, 4)]),
]

# worker 0165: the melee hit volume. FUN_00569dc0 (owner event 4 op 2) -> FUN_00541310(mgr, record);
# the attack object's update vt+0x214 = FUN_0057a330 (vtable 0x58f9f0); the sphere test FUN_0057b8b8 ->
# target vt+0x19c FUN_0055c5f8 -> FUN_0025db68(r, R, centre, a, b); the hit FUN_0057a428 -> FUN_0057a830;
# the damage FUN_0055eac8 -> FUN_00318120 and Vincent's vt+0x1ec FUN_0055c7f8 / vt+0x324 FUN_00576ac8.
SETS["melee"] = [
    dict(id=40, kind="site", where=(0x569DC0, 0x56A0A0, 0x541310), name="make",
         copy=[cp("a1", 0, 16)]),                          # the 64-byte record; v0 = attack object
    dict(id=41, kind="vt", where=(0x58F9F0, 0x214), name="update",
         copy=[cp("a0", 0x90, 4), cp("a0", 0xC0, 2), cp("a0", 0xD0, 5), cp("a0", 0xE8, 4), cp("a0", 0x60, 4),
               cp("a0", 0x13C, 1), cp("a0", 0x20, 1)]),
    dict(id=42, kind="site", where=(0x55C5F8, 0x55C700, 0x25DB68), name="sph_capsule",
         copy=[cp("a0", 0, 4), cp("a1", 0, 4), cp("a2", 0, 4)]),
    dict(id=43, kind="site", where=(0x57A428, 0x57A830, 0x57A830), name="hit",
         copy=[cp("a1", 0, 12)]),
    dict(id=44, kind="site", where=(0x55EAC8, 0x55EF78, 0x318120), name="defence", copy=[]),
    dict(id=45, kind="vt", where=(0x58F128, 0x1EC), name="p_damage", copy=[cp("a0", 0x118, 1), cp("a0", 0x28, 1)]),
    dict(id=46, kind="vt", where=(0x58F128, 0x324), name="p_react", copy=[cp("a0", 0x100, 2)]),
    dict(id=47, kind="site", where=(0x55EAC8, 0x55EF78, 0x565480), name="reaction",
         copy=[cp("a2", 0, 4), cp("a3", 0, 4)]),
]


# worker 0170: sound requests (notes/audio-research.md). Game code plays a sound by sdb.bin name through
# FUN_0033cc48 / FUN_0033cbd8 -> FUN_0033cc90 -> FUN_003e8e18(mgr, name, pos, ...) (v0 = emitter slot);
# the sound thread later sends the SE program with FUN_0041a190(entry, vol, pan) from FUN_003e80d8.
SETS["sound"] = [
    dict(id=60, kind="site", where=(0x33CC90, 0x33CD90, 0x3E8E18), name="play_name",
         copy=[cp("a1", 0, 2)]),                           # a1 = sdb name (8 bytes); v0 = slot
    dict(id=61, kind="site", where=(0x5694F8, 0x569870, 0x33D008), name="fire_snd",
         copy=[cp("a0", 0, 8)]),                           # a0 = gun def (+4 flags, +0x14 index bits)
    dict(id=62, kind="site", where=(0x5694F8, 0x569870, 0x33D6D8), name="fire_part",
         copy=[cp("a0", 0x8C, 2)]),                        # a0 = weapon part, +0x8c custom name
    dict(id=63, kind="site", where=(0x556870, 0x557400, 0x33D5C8), name="impact_mat", copy=[]),  # a0 = material
    dict(id=64, kind="site", where=(0x556870, 0x557400, 0x33CC48), name="impact_chr", copy=[cp("a0", 0, 2)]),
    dict(id=65, kind="site", where=(0x57A830, 0x57A9B8, 0x33CC48), name="melee_hit", copy=[cp("a0", 0, 2)]),
    dict(id=66, kind="site", where=(0x3E80D8, 0x3E8588, 0x41A190), name="se_send",
         copy=[cp("a0", 8, 1)]),                           # a0 = SeSep entry (+8 SE id); a1 = volume
]
# Who asks: Vincent's fire FUN_00577480 -> FUN_0033d008 / FUN_0033d118 (gun def), FUN_00571dd8 -> FUN_0033d008,
# the shot FUN_00554850 -> FUN_0033d788 (weapon part +0x94).
SETS["sound2"] = [SETS["sound"][0], SETS["sound"][6],
    dict(id=70, kind="site", where=(0x577480, 0x577D40, 0x33D008), name="v_fire", copy=[cp("a0", 0, 8)]),
    dict(id=71, kind="site", where=(0x577480, 0x577D40, 0x33D118), name="v_fire_118", copy=[cp("a0", 0, 8)]),
    dict(id=72, kind="site", where=(0x571DD8, 0x571EE8, 0x33D008), name="auto_fire", copy=[cp("a0", 0, 8)]),
    dict(id=73, kind="site", where=(0x554850, 0x554970, 0x33D788), name="shot_part94", copy=[cp("a0", 0x94, 2)]),
]

# worker 0172: the EE 3D sound (notes/audio-research.md "3D volume / pan"). FUN_003e9ed0 (from FUN_00246c98)
# runs FUN_003e9220 on every emitter slot; a new one-shot is sent with FUN_003e7810(_, id, pan, vol).
SETS["sound3"] = [
    dict(id=60, kind="site", where=(0x33CC90, 0x33CD90, 0x3E8E18), name="play_name",
         copy=[cp("a1", 0, 2), cp("a2", 0, 4)]),          # name, emitter position; v0 = slot
    dict(id=66, kind="site", where=(0x3E80D8, 0x3E8588, 0x41A190), name="se_send",
         copy=[cp("a0", 8, 1), cpr("a1"), cpr("a2")]),     # SE id, pan, volume
    dict(id=80, kind="site", where=(0x3E9220, 0x3E9798, 0x3E7810), name="se_new",
         copy=[cpr("a2"), cpr("a3")]),                     # a1 = SE id; pan, volume
    dict(id=81, kind="site", where=(0x33CE58, 0x33CED0, 0x33CED0), name="se_range", copy=[]),  # f12 range, a1 slot
    dict(id=83, kind="site", where=(0x3E8BC8, 0x3E8E18, 0x3E9B80), name="slot_open",
         copy=[cp("a2", 0, 2), cp("a1", 4, 1)]),           # every new slot: sdb row name (a2 = row), SE id
    dict(id=82, kind="site", where=(0x246C98, 0x247000, 0x3E9ED0), name="listener",
         copy=[cp("a0", 0x3810, 4), cp("a0", 0x3820, 4), cp("a0", 0x3850, 4), cp("a0", 0x3890, 1)]),
]

# worker 0173: every draw of the shared RNG (FUN_0040b5c0 -> FUN_0040b500: v0 = the tempered word) and who drew it at
# a wall impact (FUN_0054ff50: the variant; FUN_002e0160: the bullet-hole decal, twice; FUN_00550098: material 6).
# The 'draw' entry is logged when FUN_0040b500 returns, so it comes just before its caller's entry. 624 consecutive
# draws give the whole twister state (notes/audio-research.md "Wall impact draws").
SETS["rng"] = [SETS["sound3"][0],
    dict(id=90, kind="site", where=(0x40B5C0, 0x40B5F0, 0x40B500), name="draw", copy=[]),       # v0
    dict(id=91, kind="site", where=(0x54FF50, 0x550098, 0x40B5C0), name="wall_rand", copy=[]),  # f0
    dict(id=92, kind="site", where=(0x2E0160, 0x2E0348, 0x40B5C0), name="decal_rand", copy=[]),
    dict(id=93, kind="site", where=(0x550098, 0x550148, 0x40B5C0), name="mat6_rand", copy=[]),
]


# worker 0174: what a hit on Vincent shows and plays. Damage vt+0x1ec FUN_0055c7f8 -> vt+0x324 FUN_00576ac8 ->
# FUN_0055c978: cue 0x44 (FUN_00341330) and cue 0x4c through the 15-frame gate FUN_003412d0 ('?' -> event 0x25 of
# the owner's script: stage script 297 draws rand_i (VM op 41, FUN_0040b5c0 at 0x370d30) and sends cmd 0x125 with a
# name). The hit effect FUN_003361b8 (FUN_003366b8 -> effect id), the hit-direction HUD FUN_003af6b8 (HUD +0x230..).
SETS["pain"] = [SETS["sound3"][0],
    dict(id=90, kind="site", where=(0x40B5C0, 0x40B5F0, 0x40B500), name="draw", copy=[]),          # v0
    dict(id=101, kind="site", where=(0x3412D0, 0x341330, 0x341330), name="cue_gated",
         copy=[cp("a0", 0x810, 1)]),                                                                # a1 = cue
    dict(id=102, kind="site", where=(0x55C978, 0x55CA20, 0x341330), name="cue", copy=[]),
    dict(id=103, kind="site", where=(0x370D00, 0x370D68, 0x40B5C0), name="script_rand", copy=[]),   # f0
    dict(id=104, kind="vt", where=(0x58F128, 0x1EC), name="p_damage", copy=[]),                     # a1 = damage
    dict(id=105, kind="site", where=(0x567C08, 0x567D00, 0x3AF6B8), name="hit_dir",
         copy=[cp("a0", 0x230, 10)]),                                                               # a1 = angle
    dict(id=106, kind="site", where=(0x3361B8, 0x336280, 0x3366B8), name="fx_new", copy=[]),        # a0 id, v0
    dict(id=107, kind="site", where=(0x55DB50, 0x55DF90, 0x3361B8), name="hit_fx",
         copy=[cp("a0", 0, 4)]),                                                                    # a2 = kind
    dict(id=108, kind="site", where=(0x5720C8, 0x572418, 0x336508), name="fx_1000", copy=[]),
]

# worker 0193: who spawns an effect. Every jal to the spawn entry points of the ELF (FUN_002e62b0, FUN_002e6290,
# FUN_003366b8, FUN_003365e0; the overlay site 0xaa4d80 left out), logging the id (a2 / a0) and the caller (ra = site + 8).
_S62B0 = [0x2d73a0, 0x2e6298, 0x3c59e4]
_S6290 = [0x242b38, 0x2463d8, 0x246a8c, 0x246b80, 0x246ba8, 0x246bd0, 0x2473ac, 0x2d73b8, 0x2dbd30, 0x2ed670,
          0x306328, 0x336728, 0x336abc, 0x381ea0, 0x3835ac, 0x3c1dec, 0x3e11e0, 0x3e1390]
_S66B8 = [0x3358f4, 0x33593c, 0x335984, 0x335fbc, 0x336170, 0x336230, 0x33629c, 0x336510, 0x336550, 0x3365b8, 0x336608]
_S65E0 = [0x335318, 0x335678, 0x335710, 0x3357c4, 0x545c50, 0x5579b8, 0x5721e0, 0x57a8f8, 0x580424, 0x580490,
          0x58236c, 0x582520, 0x587440]
SETS["fxsrc"] = [
    dict(id=120, kind="sites", where=(0x2E62B0, _S62B0), name="fx62b0", copy=[cpr("a2"), cpr("ra")]),
    dict(id=121, kind="sites", where=(0x2E6290, _S6290), name="fx6290", copy=[cpr("a2"), cpr("ra")]),
    dict(id=122, kind="sites", where=(0x3366B8, _S66B8), name="fx66b8", copy=[cpr("ra")]),
    dict(id=123, kind="sites", where=(0x3365E0, _S65E0), name="fx65e0", copy=[cpr("ra")]),
    dict(id=124, kind="sites", where=(0x335F40, [0x54FFC8]), name="wall_fx",                    # FUN_0054ff50
         copy=[cp("a0", 0, 4), cp("a1", 0, 4)]),                                                 # end, normal (+0x100)
]

# worker 0200: every effect-LCG draw (FUN_002d98c8 signed / FUN_002d9938 unit: one range-scanned stub each over the
# effect channel code 0x270000..0x2e0000) with its caller, the per-frame reseed (FUN_002efc78 -> FUN_002d97f8) and the
# effect spawns (fxsrc's FUN_003366b8 sites): which code draws between the hit's 0x40c00 and 0x41800 (w188 'State C').
SETS["w200lcg"] = [SETS["fxsrc"][2],
    dict(id=140, kind="site", where=(0x270000, 0x2E0000, 0x2D98C8), name="lcg_signed", copy=[cpr("ra")]),
    dict(id=141, kind="site", where=(0x270000, 0x2E0000, 0x2D9938), name="lcg_unit", copy=[cpr("ra")]),
    dict(id=142, kind="site", where=(0x2EFC78, 0x2EFE00, 0x2D97F8), name="fx_reseed", copy=[cpr("ra")]),
]

# worker 0202: the same LCG draws plus the VU0 R spans (FUN_002d9828 / FUN_002d9880) during the GAME OVER title:
# which title channels (types 24 / 103 / 119) draw, in what order.
# worker 0204: every shared-RNG draw (each `jal FUN_0040b5c0`, f0 = the value) with its caller, and the activation's
# magazine draw FUN_00360418 (its a0 = the AI, +0x7c after the call = the rounds): trigger 56's 0x108 on records 50 / 51
SETS["w204rng"] = [
    dict(id=150, kind="site", where=(0x100000, 0x5B0000, 0x40B5C0), name="rand", copy=[cpr("ra")]),
    dict(id=151, kind="site", where=(0x35EE08, 0x35EF50, 0x360418), name="refill", copy=[cpr("ra"), cp("a0", 0x7C, 1)]),
]

# worker 0205: the opening event's end (FUN_0037cf30 -> FUN_00324e70) after a Restart: the actors' hand-off
# (FUN_00319190 -> FUN_003157b0, a0 = status; +0x30.. after = the matrix it wrote), the stage-load pass, Vincent's
# placement / state calls and the camera calls in FUN_00324e70, and every FUN_005764d0 (player state 2 / 3).
_E = (0x324E70, 0x325188)
SETS["w205"] = [
    dict(id=160, kind="site", where=(0x37CF30, 0x37D540, 0x324E70), name="event_end", copy=[cpr("a0")]),
    dict(id=161, kind="site", where=_E + (0x319190,), name="actor_handoff", copy=[]),
    dict(id=162, kind="site", where=(0x319190, 0x3192A0, 0x3157B0), name="status_from_model",
         copy=[cpr("a0"), cp("a0", 0x30, 12), cp("a0", 0x44, 2)]),
    dict(id=163, kind="site", where=_E + (0x5453B0,), name="stage_pass", copy=[]),
    dict(id=164, kind="site", where=_E + (0x54A5E8,), name="player_mat", copy=[cpr("a0"), cp("a1", 0, 16)]),
    dict(id=165, kind="site", where=_E + (0x578548,), name="c578548", copy=[cpr("a0")]),
    dict(id=166, kind="site", where=_E + (0x574928,), name="c574928", copy=[cpr("a0"), cpr("a1")]),
    dict(id=167, kind="site", where=_E + (0x34B2C8,), name="c34b2c8", copy=[cp("a1", 0, 4)]),
    dict(id=168, kind="site", where=_E + (0x328640,), name="cam_328640", copy=[cpr("a0"), cpr("a1")]),
    dict(id=169, kind="site", where=_E + (0x33C060,), name="cam_33c060", copy=[]),
    dict(id=170, kind="site", where=(0x100000, 0x5B0000, 0x5764D0), name="c5764d0", copy=[cpr("a0"), cpr("a1"), cpr("ra")]),
    dict(id=171, kind="site", where=(0x100000, 0x5B0000, 0x558CC0), name="c558cc0", copy=[cpr("a0"), cpr("ra")]),
]
# review fix (0205): every FUN_003157b0 call (a0 = status, a1 = param, ra = caller; status +0x88 / +0x60 and the matrix
# +0x30..+0x5f after the call) -> which write brings the battle clip's bone 1 into the status matrix
SETS["w205b"] = SETS["w205"][-1:] + [
    dict(id=172, kind="site", where=(0x100000, 0x5B0000, 0x3157B0), name="c3157b0",
         copy=[cpr("a0"), cpr("a1"), cpr("ra"), cp("a0", 0x88, 1), cp("a0", 0x60, 1), cp("a0", 0x30, 12)]),
]

SETS["w202lcg"] = SETS["w200lcg"][1:] + [
    dict(id=146, kind="site", where=(0x270000, 0x2E0000, 0x2D9828), name="vr_span", copy=[cpr("ra")]),
    dict(id=147, kind="site", where=(0x270000, 0x2E0000, 0x2D9880), name="vr_flip", copy=[cpr("ra")]),
]

# worker 0200: who calls FUN_00580410 (FUN_003365e0(0x4800) at FUN_0054a720's position of its object a0)
SETS["w200_4800"] = [SETS["fxsrc"][3],
    dict(id=143, kind="site", where=(0x518838, 0x518a00, 0x580410), name="c580410_518838", copy=[cpr("a0"), cpr("ra")]),
    dict(id=144, kind="site", where=(0x545b20, 0x547800, 0x580410), name="c580410_545b20", copy=[cpr("a0"), cpr("ra")]),
    dict(id=145, kind="site", where=(0x55cac8, 0x55d2c0, 0x580410), name="c580410_55cac8", copy=[cpr("a0"), cpr("ra")]),
]

# worker 0194: menu sounds and the pause volume (notes/audio-research.md "Menu sounds"). FUN_003e1d90 (once a frame) plays
# the latched id: FUN_003e9e60(name 0x47d5c8[id], x, y); FUN_003e9ed0 sends it as FUN_003e7850(_, id, pan, 0x7f);
# FUN_00241f40 (pause / resume) calls FUN_003e86e0(mgr, paused) and FUN_003ed7d0(vol); FUN_003ed8e0 then sends
# FUN_0041af80(0x14, vol) (IOP command 0x34: the core-1 input volume, i.e. the BGM).
SETS["menusnd"] = [SETS["sound3"][1],
    dict(id=130, kind="site", where=(0x3E1D90, 0x3E1EA0, 0x3E9E60), name="menu_play",
         copy=[cp("a0", 0, 2), cpr("a1"), cpr("a2")]),      # sdb name, x, y
    dict(id=131, kind="site", where=(0x3E9ED0, 0x3EA168, 0x3E7850), name="menu_req",
         copy=[cpr("a1"), cpr("a2"), cpr("a3")]),           # SE id, pan, volume
    dict(id=132, kind="site", where=(0x241F40, 0x242080, 0x3E86E0), name="se_pause", copy=[cpr("a1")]),
    dict(id=133, kind="site", where=(0x241F40, 0x242080, 0x3ED7D0), name="bgm_vol", copy=[cpr("a0")]),
    dict(id=134, kind="site", where=(0x3ED8E0, 0x3EDA60, 0x41AF80), name="bvol_send", copy=[cpr("a0"), cpr("a1")]),
]

# worker 0209: the explosive barrel (e057, class vt 0x5914e8) and its explosion (object type 7, vt 0x5906c0).
# Pointer slots: +0x1b4 bullet hit FUN_00585000, +0x1ec HP FUN_00585cd8, +0x1cc blast FUN_00585448, +0x2f4 script
# event FUN_0054e4a0; explosion +0x214 update FUN_0057e638; player / e027 +0x1cc blast FUN_00572418 / FUN_0055e498.
SETS["barrel_all"] = [SETS["sound3"][0],
    dict(id=210, kind="vt", where=(0x5914E8, 0x1B4), name="b_bullet",
         copy=[cp("a1", 0x120, 1), cp("a1", 0x134, 1), cp("a0", 0x104, 1), cp("a0", 0x90, 4)]),   # bullet flags, dmg; HP
    dict(id=211, kind="vt", where=(0x5914E8, 0x1EC), name="b_hp", copy=[cp("a0", 0x104, 1)]),        # a1 = damage
    dict(id=212, kind="vt", where=(0x5914E8, 0x1CC), name="b_blast", copy=[cp("a0", 0x104, 1)]),     # a1 = explosion
    dict(id=213, kind="vt", where=(0x5914E8, 0x2F4), name="b_event", copy=[]),                        # a1 = event
    dict(id=214, kind="site", where=(0x540B90, 0x540C88, 0x57F040), name="expl_new",
         copy=[cpr("a2"), cp("a1", 0, 4), cpr("a3")]),                                               # f12 radius, a0 obj; damage, pos, owner
    dict(id=215, kind="vt", where=(0x5906C0, 0x214), name="expl_upd",
         copy=[cp("a0", 0xC4, 8), cp("a0", 0x168, 12), cp("a0", 0x90, 4)]),
    dict(id=216, kind="vt", where=(0x58F128, 0x1CC), name="p_blast", copy=[]),                       # a1 = explosion
    dict(id=217, kind="vt", where=(0x58E1F8, 0x1CC), name="e_blast", copy=[cp("a0", 0x90, 4)]),
    dict(id=218, kind="site", where=(0x55E498, 0x55EA50, 0x55E240), name="blast_dmg", copy=[]),     # v0 = damage
    dict(id=219, kind="site", where=(0x55E498, 0x55EA50, 0x565480), name="blast_react",
         copy=[cpr("a1"), cp("a2", 0, 4), cp("a3", 0, 4)]),                                           # flags, dir, pos
    dict(id=220, kind="vt", where=(0x58F128, 0x1EC), name="p_damage", copy=[]),                       # a1 = damage
    dict(id=221, kind="sites", where=(0x3366B8, [0x33629c]), name="fx_expl", copy=[cpr("ra")]),       # a0 = effect id
    dict(id=222, kind="site", where=(0x336280, 0x336338, 0x2E7660), name="fx_place",
         copy=[cp("a2", 0, 8)]),                                                                       # a2 = {5, .., pos, scale}
    dict(id=223, kind="site", where=(0x57E7D0, 0x57EBB8, 0x541B08), name="blast_dir",
         copy=[cp("a1", 0, 4), cp("a2", 0, 4)]),                                                      # centre, unit dir
]
SETS["barrel"] = [h for h in SETS["barrel_all"] if h["name"] not in ("b_blast", "b_event", "fx_place", "blast_dir")]
SETS["barrel_b"] = [h for h in SETS["barrel_all"] if h["name"] in ("b_blast", "b_event", "fx_place", "blast_dir", "b_hp", "expl_new")]

def patch(mem, setname, frame_lo, frame_hi, log_end):
    """Install the hooks of SETS[setname]. Returns (clog_start, clog_end, hooks)."""
    hooks = SETS[setname]
    a = Asm(STUBS)
    a.beq("zero", "zero", "past")        # logger first so stubs can jal it
    a.nop()
    _logger(a)
    a.label("past")
    desc_at, desc_words = CLOG_DESC, []
    sites = []
    for h in hooks:
        d = desc_at + 4 * len(desc_words)
        desc_words += [h["id"]] + h["copy"] + [0]
        assert len(h["copy"]) == 0 or sum((c >> 16) & 0x7F for c in h["copy"]) <= 25
        stub_at = a.pc()
        if h["kind"] == "site":
            lo, hi, callee = h["where"]
            found = [x for x in range(lo, hi, 4) if struct.unpack_from("<I", mem, x)[0] == JAL(callee)]
            if not found:
                raise RuntimeError("no jal %#x in %#x..%#x" % (callee, lo, hi))
            _stub(a, callee, d)
            sites += [(x, JAL(stub_at)) for x in found]
            h["sites"] = [hex(x) for x in found]
        elif h["kind"] == "sites":          # worker 0193: an explicit list of `jal callee` sites (no range scan)
            callee, found = h["where"]
            for x in found:
                if struct.unpack_from("<I", mem, x)[0] != JAL(callee):
                    raise RuntimeError("no jal %#x at %#x" % (callee, x))
            _stub(a, callee, d)
            sites += [(x, JAL(stub_at)) for x in found]
            h["sites"] = [hex(x) for x in found]
        else:
            vt, off = h["where"]
            target = struct.unpack_from("<I", mem, vt + off)[0]
            _stub(a, target, d)
            sites.append((vt + off, stub_at))
            h["sites"] = [hex(vt + off) + "->" + hex(target)]
    code = a.bytes()
    assert STUBS + len(code) <= hook.CTRL, "stubs overflow"
    assert CLOG_DESC + 4 * len(desc_words) <= hook.LOG, "descriptors overflow"
    assert not any(mem[CLOG_CTRL:hook.LOG]), "script area overlaps the call-log control block"
    mem[STUBS:STUBS + len(code)] = code
    struct.pack_into("<%dI" % len(desc_words), mem, CLOG_DESC, *desc_words)
    start = log_end - CLOG_BYTES
    struct.pack_into("<4I", mem, CLOG_CTRL, frame_lo, frame_hi, start, log_end)
    for addr, word in sites:
        struct.pack_into("<I", mem, addr, word)
    return start, log_end, hooks


def decode(raw, hooks):
    names = {h["id"]: h for h in hooks}
    out = []
    for i in range(0, len(raw) - ENTRY + 1, ENTRY):
        w = struct.unpack_from("<32I", raw, i)
        if w[0] == 0:
            break
        h = names[w[0]]
        tof = lambda x: round(struct.unpack("<f", struct.pack("<I", x))[0], 6)
        e = dict(hook=h["name"], frame=w[1], a0=hex(w[2]), a1=w[3], v0=w[4] if w[4] < 0x80000000 else w[4] - (1 << 32),
                 f0=tof(w[5]), f12=tof(w[6]))
        k = 7
        for c in h["copy"]:
            n, off, reg = (c >> 16) & 0x7F, c & 0xFFFF, [r for r, s in SLOT.items() if s == c >> 24][0]
            ws = w[k:k + n]
            fl = [round(struct.unpack("<f", struct.pack("<I", x))[0], 4) for x in ws]
            if (c >> 16) & 0x80:
                e[reg] = ws[0] if ws[0] < 0x80000000 else ws[0] - (1 << 32)
            else:
                e["%s+%#x" % (reg, off)] = {"u": [hex(x) for x in ws], "f": fl}
            k += n
        out.append(e)
    return out


# worker 0215: footsteps and the stage's section-22 sound objects (notes/audio-research.md "Footsteps", "Placed sounds").
# Footsteps: FUN_003466a8 -> FUN_005ae708 stores the name in MP+0x3b0; FUN_005ae828 (foot markers) / FUN_005ae738 (clip
# event) -> FUN_003e9c38(mgr, slot MP+0x3b8, name). Sound objects (class 0xe, vt 0x5903b8): FUN_0057e188 starts
# (FUN_003e6d70 positioned / FUN_003e6c88 area, FUN_003e8708 request 0x15), FUN_0057e220 stops (FUN_003e64b0);
# FUN_003e6ec8 -> FUN_003e8f70 sets the fixed volume every frame; FUN_003e9ed0 -> FUN_003e7718 sends the 0x11 / 0x18 updates.
SETS["ambfoot"] = [SETS["sound3"][2], SETS["sound3"][5], SETS["sound3"][4],
    dict(id=150, kind="site", where=(0x5AE828, 0x5AEBC8, 0x3E9C38), name="foot_play", copy=[cpr("a1"), cp("a2", 0, 2)]),
    dict(id=151, kind="site", where=(0x5AE738, 0x5AE828, 0x3E9C38), name="foot_event", copy=[cpr("a1"), cp("a2", 0, 2)]),
    dict(id=152, kind="site", where=(0x3466A8, 0x3467B8, 0x5AE708), name="foot_name", copy=[cp("a1", 0, 2)]),
    dict(id=153, kind="site", where=(0x57E188, 0x57E220, 0x3E6D70), name="bg_start", copy=[cp("a0", 0, 2), cp("a1", 0, 4)]),
    dict(id=154, kind="site", where=(0x57E188, 0x57E220, 0x3E6C88), name="area_start", copy=[cp("a0", 0, 2), cpr("a1")]),
    dict(id=155, kind="site", where=(0x57E220, 0x57E288, 0x3E64B0), name="bg_stop", copy=[]),
    dict(id=156, kind="site", where=(0x3E6EC8, 0x3E6FC8, 0x3E8F70), name="bg_vol", copy=[cpr("a1"), cpr("a2")]),
    dict(id=157, kind="site", where=(0x3E9220, 0x3E9798, 0x3E7718), name="se_update",
         copy=[cpr("a1"), cpr("a2"), cpr("a3"), cpr("t0"), cpr("t1")]),            # id, handle, pan, vol, pitch
    dict(id=158, kind="site", where=(0x3E6D70, 0x3E6EC8, 0x3E8B70), name="bg_open_vol", copy=[cpr("a1"), cpr("a2")]),
    dict(id=159, kind="site", where=(0x57E188, 0x57E288, 0x3E8708), name="req15", copy=[cpr("a1")]),
]
# worker 0219: the stage controller's natives (notes/stage-controller.md): music (playMusic3 FUN_003a0198 -> FUN_003ec500 /
# FUN_003ec560, playMusic2 FUN_003a02b8, changeMusicVol FUN_003a5308 -> FUN_003ed740, playBgAreaSound FUN_0039dd80 ->
# FUN_003e6c88), the modes (battle2 / battle3 / battle1 -> FUN_0037cf30 / FUN_0037e3c0, event2 / event3 -> FUN_0037e048),
# the zone load's stream request (FUN_00381518 -> FUN_002677a0), scene_save (FUN_0039c728 -> FUN_0023d690) and Skip
# (FUN_003dfdc8 -> FUN_00372f70).
SETS["stage"] = [
    dict(id=190, kind="site", where=(0x3A0198, 0x3A02B8, 0x3EC500), name="music3", copy=[cp("a0", 0, 2), cpr("a1")]),
    dict(id=191, kind="site", where=(0x3A0198, 0x3A02B8, 0x3EC560), name="music3_fade", copy=[cp("a0", 0, 2), cpr("a1"), cpr("a2")]),
    dict(id=192, kind="site", where=(0x3A02B8, 0x3A0378, 0x3EC500), name="music2", copy=[cp("a0", 0, 2), cpr("a1")]),
    dict(id=193, kind="site", where=(0x3A5308, 0x3A534C, 0x3ED740), name="musicvol", copy=[cpr("a0"), cpr("a1")]),
    dict(id=194, kind="site", where=(0x39DD80, 0x39DDF0, 0x3E6C88), name="area", copy=[cp("a0", 0, 2), cpr("a1")]),
    dict(id=195, kind="site", where=(0x39C618, 0x39C650, 0x37CF30), name="battle2", copy=[cpr("a1")]),
    dict(id=196, kind="site", where=(0x39C650, 0x39C690, 0x37CF30), name="battle3", copy=[]),
    dict(id=197, kind="site", where=(0x39C7E8, 0x39C83C, 0x37E3C0), name="battle1", copy=[cpr("a1"), cpr("a2")]),
    dict(id=198, kind="site", where=(0x39C690, 0x39C6B8, 0x37E048), name="event2", copy=[]),
    dict(id=199, kind="site", where=(0x39C6B8, 0x39C6F0, 0x37E048), name="event3", copy=[cpr("a1")]),
    dict(id=200, kind="site", where=(0x381518, 0x381654, 0x2677A0), name="zone_req", copy=[cpr("a0"), cpr("a1")]),
    dict(id=201, kind="site", where=(0x39C728, 0x39C7E4, 0x23D690), name="scene_save", copy=[cpr("a1")]),
    dict(id=202, kind="site", where=(0x3DFDC8, 0x3DFE0C, 0x372F70), name="skip", copy=[]),
]
# worker 0231: the boss beat (notes/boss-research.md): the stage set + Zone.boss(Z) (FUN_0039c510 / FUN_0039c568 ->
# FUN_0037fe18: a1 = zone or -1, a2 = on).
SETS["boss"] = SETS["stage"] + [
    dict(id=230, kind="site", where=(0x39C510, 0x39C5C8, 0x37FE18), name="zone_boss", copy=[cpr("a1"), cpr("a2")]),
]
# worker 0222: the opening event's sound and windows (notes/event-vm-research.md "Event sound"): setSoundEffect2_l
# FUN_0039ff68 -> FUN_003e8e18 (slot open: a1 = the name), loadVoice2 FUN_003a0968 -> FUN_00378c88 (a1 = name),
# playVoice FUN_003a0900 -> FUN_003eaf10 (a0 = name; f12 = pi / 4), the window command FUN_00383408 -> FUN_003b66c0
# (a1 = box kind) / FUN_003b6ab8 (a2 = the text), the fades FUN_003736c8 -> FUN_002f21d8 (in) / FUN_002f21f8 (out)
# (f12 = seconds); + the stage set's music / area / skip hooks.
SETS["evsound"] = [SETS["stage"][0], SETS["stage"][1], SETS["stage"][2], SETS["stage"][4], SETS["stage"][12],
    dict(id=240, kind="site", where=(0x39FF68, 0x3A0148, 0x3E8E18), name="ev_se", copy=[cp("a1", 0, 2), cpr("a3")]),
    dict(id=241, kind="site", where=(0x3A0968, 0x3A09B8, 0x378C88), name="ev_voice_load", copy=[cp("a1", 0, 2)]),
    dict(id=242, kind="site", where=(0x3A0900, 0x3A0968, 0x3EAF10), name="ev_voice", copy=[cp("a0", 0, 2)]),
    dict(id=243, kind="site", where=(0x383408, 0x3837D0, 0x3B66C0), name="ev_window", copy=[cpr("a1"), cpr("a2"), cpr("a3")]),
    dict(id=244, kind="site", where=(0x383408, 0x3837D0, 0x3B6AB8), name="ev_window_text", copy=[cp("a2", 0, 6)]),
    dict(id=245, kind="site", where=(0x3736C8, 0x3737C0, 0x2F21D8), name="ev_fadein", copy=[]),
    dict(id=246, kind="site", where=(0x3736C8, 0x3737C0, 0x2F21F8), name="ev_fadeout", copy=[]),
]
# worker 0232: the section stats (notes/results-research.md): every FUN_0031d668(stat, n) (stat += n), FUN_0031d698
# (stat = v) and FUN_0031d6d8 (total = v) call in the ELF, with the caller's return address (ra = site + 8).
SETS["results"] = [
    dict(id=260, kind="site", where=(0x100000, 0x5f0000, 0x31D668), name="stat_add", copy=[cpr("ra")]),
    dict(id=261, kind="site", where=(0x100000, 0x5f0000, 0x31D698), name="stat_set", copy=[cpr("ra")]),
    dict(id=262, kind="site", where=(0x100000, 0x5f0000, 0x31D6D8), name="total_set", copy=[cpr("ra")]),
]

# worker 0240: the stage init and the stage-load pass (notes/checkpoint-research.md 'The stage-init pass'): who calls
# FUN_0053c140 (stage objects) / FUN_0053ca50 (0x22 pass + FUN_005459d8) / FUN_005453b0 (the stage-load pass) /
# FUN_00324e70 (battle()'s end) / FUN_00319190, and when (a0 +0x20 / +0x24 = the manager clock where a0 = the manager);
# FUN_00360418 (the magazine draw at an activation) for the order against them.
_ELF = (0x100000, 0x5f0000)
SETS["w240"] = [
    dict(id=270, kind="site", where=_ELF + (0x53C140,), name="stage_objs", copy=[cpr("ra"), cpr("a1"), cp("a0", 0x20, 2)]),
    dict(id=271, kind="site", where=_ELF + (0x53CA50,), name="pass22", copy=[cpr("ra"), cpr("a1"), cp("a0", 0x20, 2)]),
    dict(id=272, kind="site", where=_ELF + (0x5459D8,), name="pass23", copy=[cpr("ra"), cp("a0", 0x20, 2)]),
    dict(id=273, kind="site", where=_ELF + (0x5453B0,), name="stage_pass", copy=[cpr("ra"), cp("a0", 0x20, 2)]),
    dict(id=274, kind="site", where=_ELF + (0x324E70,), name="battle_end", copy=[cpr("ra"), cpr("a0")]),
    dict(id=275, kind="site", where=_ELF + (0x319190,), name="statuses", copy=[cpr("ra")]),
    dict(id=276, kind="site", where=_ELF + (0x3245E8,), name="stage_init", copy=[cpr("ra"), cpr("a0"), cpr("a1")]),
    dict(id=278, kind="site", where=_ELF + (0x360418,), name="refill", copy=[cpr("ra"), cp("a0", 0x7C, 1)]),
]
# who activates 41-43 / 45-49 at the reload's record 10 (the actor class's vt+0x144 = activate, ra = its caller)
SETS["w240b"] = SETS["w240"] + [
    dict(id=279, kind="vt", where=(0x58E1F8, 0x144), name="activate", copy=[cpr("ra"), cpr("a1"), cpr("a2"), cp("a0", 0x20, 1)]),
]
# worker 0243 (notes/items-research.md 'Item use'): pad 0x1d -> FUN_00573db0 (request 0x1c), the manager's FUN_00573eb0,
# the item script's events 0x68 / 100 (FUN_0054e138), Vincent's event 0x39 (FUN_00568ea0), the remove (FUN_0031eb60), the
# heal FUN_003168e8 (status +0x20 after), cmd 0x14b's effect (FUN_00336658), the cycle (FUN_00574058), the HUD item text
# (FUN_00339590 -> FUN_003ae308), the sounds by name.
SETS["w243"] = [
    SETS["sound"][0],
    dict(id=2430, kind="site", where=(0x3320C0, 0x333150, 0x573DB0), name="use_req", copy=[]),
    dict(id=2431, kind="site", where=(0x53FDE8, 0x5405B0, 0x573EB0), name="use", copy=[cpr("a1")]),
    dict(id=2432, kind="site", where=(0x573EB0, 0x574058, 0x54E138), name="ev68", copy=[cpr("a1"), cpr("a2")]),
    dict(id=2433, kind="site", where=(0x573EB0, 0x574058, 0x568EA0), name="ev39", copy=[cpr("a1")]),
    dict(id=2434, kind="site", where=(0x573EB0, 0x574058, 0x31EB60), name="remove", copy=[cpr("a1"), cpr("a2")]),
    dict(id=2435, kind="site", where=(0x568EA0, 0x568F98, 0x54E138), name="ev100", copy=[cpr("a1"), cpr("a2")]),
    dict(id=2436, kind="site", where=(0x55C910, 0x55C978, 0x3168E8), name="heal", copy=[cpr("a1"), cp("a0", 0, 12)]),
    dict(id=2437, kind="site", where=(0x5661E8, 0x567C08, 0x336658), name="effect", copy=[cpr("a0"), cpr("a1")]),
    dict(id=2438, kind="site", where=(0x3320C0, 0x333150, 0x574058), name="cycle", copy=[cpr("a1")]),
    dict(id=2439, kind="site", where=(0x339590, 0x339988, 0x3AE308), name="hud_item", copy=[cpr("a1"), cpr("a2")]),
    dict(id=2440, kind="site", where=(0x339590, 0x339988, 0x3ADDA8), name="hud_hp", copy=[cpr("a1"), cpr("a2")]),
]
# worker 0244 (the camera after the rescue's battle()): camera type 0xc's update (vt 0x4a07a8 +0x14 = FUN_00330478) and
# enter (+0xc = FUN_00330240) with the caller and CAM+0x17c / +0x1c0 / eye after; the reset FUN_003285d0, battle()'s
# FUN_00324e70, FUN_0053d420 (the 0x7d5 re-enter) and FUN_00325880
SETS["w244"] = [
    dict(id=2441, kind="vt", where=(0x4A07A8, 0x14), name="cam_update", copy=[cpr("ra"), cp("a1", 0x17C, 1), cp("a1", 0x1C0, 1), cp("a1", 0x90, 3)]),
    dict(id=2442, kind="vt", where=(0x4A07A8, 0xC), name="cam_enter", copy=[cpr("ra"), cp("a1", 0x17C, 1)]),
    dict(id=2443, kind="site", where=_ELF + (0x3285D0,), name="cam_reset", copy=[cpr("ra")]),
    dict(id=2444, kind="site", where=_ELF + (0x324E70,), name="battle_end", copy=[cpr("ra")]),
    dict(id=2445, kind="site", where=_ELF + (0x53D420,), name="msg7d5", copy=[cpr("ra")]),
    dict(id=2446, kind="site", where=_ELF + (0x325880,), name="wmode1", copy=[cpr("ra")]),
]
