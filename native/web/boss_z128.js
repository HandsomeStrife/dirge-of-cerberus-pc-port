// boss_z128.js -- the z128 boss brain (e024, record 32): a direct translation of the boss overlay
// kel_boss_z128.ovl (loaded at 0xaa0000 by Zone.boss(true) -> FUN_0039c510 -> FUN_0037fe18; entry
// 0xaa0080 -> FUN_00aa30c8). Decoded by worker 0231 (notes/boss-research.md).
//
// How the game reaches it: record 32's script 242 event 3 sends cmd 0x143(256) = AI mode 0x100.
// FUN_0035f300 hands modes 0x100..0x1ff to the plug-in DAT_0046e590 (vt+0x14 = FUN_00aa3090), which
// makes this brain for 0x100 (FUN_00aa1220, 0x7c bytes, vtable 0xaa3508: enter +0x14 FUN_00aa1690,
// update +0x1c FUN_00aa16f8, +0x44 FUN_00aa1658). Without the overlay (DAT_0046e590 == 0, as in the
// save) mode 0x100 gets no brain.
//
// This module is the brain's logic only. Every engine call it makes goes through `io` (motion, mover,
// shots, sounds, effects, HUD gauge); the names below cite the game function each one stands for.
// Not wired into play.html yet (notes/boss-research.md "Open").

export const DEFEATED_HP = 10000;          // FUN_00aa2c30: HP < 0x2711 = beaten; the bar shows HP - 10000
export const LOW_HP_PCT = 30;              // FUN_00aa2f78
export const STAGGER_DAMAGE = 400;         // FUN_00aa16f8 states 2 / 3: brain +0x2c >= 400 -> state 8

// FUN_00aa13a8: the stage locators (FUN_00311c98 by name) and the two weapons by difficulty
// (FUN_00aa0088 = min(FUN_00242c28(), 2): 0 e, 1 n, 2 h). g = gun (state 3, 7), m = missiles (5, 6, 7).
export const WEAPONS = [['nwe024ge', 'nwe024me'], ['nwe024gn', 'nwe024mn'], ['nwe024gh', 'nwe024mh']];

// FUN_00aa1220: brain fields (offsets in the 0x7c-byte object)
export function makeBrain(ai, actor, status, C) {
  return {
    ai, actor, status, C,                 // +0 / +4 / +8 / +0xc
    t: [0, 0, 0],                         // +0x24.. three clock-B stamps (FUN_00aa2a38(b, i, 0) each)
    prev: -1,                             // +0x1c
    lastHp: 0,                            // +0x20
    sub: 0,                               // +0x2a
    acc: 0,                               // +0x2c (s16): damage since the last reset
    alt: 0,                               // +0x2c bit 16: attack alternation
    smoke: 0,                             // +0x2c bit 17: bsj_294 started
    shots: 0,                             // +0x2f (s8)
    count: 0,                             // +0x30 (s8)
    moves: 0,                             // +0x31 (s8)
    miss: new Array(8).fill(-1),          // +0x34..+0x50 shot ids
    f54: 0,                               // +0x54
    player: null, box4: null, box5: null, // +0x58 / +0x5c / +0x60
    boxes: [null, null, null, null],      // +0x64..+0x70 btbox0..3
    wg: null, wm: null,                   // +0x74 / +0x78
  };
}

const s16 = v => (v << 16) >> 16;
const sub3 = (a, c) => [a[0] - c[0], a[1] - c[1], a[2] - c[2]];   // player +0x90 - body +0x30 (the turn direction)
const s8 = v => (v << 24) >> 24;

// FUN_00aa2a10 / FUN_00aa2a38: brain timers on clock B (*DAT_0046f4ec), 16-bit
const since = (b, io, i) => s16(io.clockB() - (b.t[i] & 0xffff));
const stamp = (b, io, i, d = 0) => { b.t[i] = s16(io.clockB() - d); };
// FUN_0035eb30 / FUN_0035eb50: the AI's own state timer (AI +0x26, clock A *DAT_0046f4e4)
const aiTime = (b, io) => s16(io.clockA() - (b.ai.f26 & 0xffff));
const aiReset = (b, io) => { b.ai.f26 = io.clockA() & 0xffff; };

// FUN_00aa2a60: AI +0x24 = state; prev keeps the old one (the first call stores the new one)
export function setState(b, io, s, reset) {
  if (reset) aiReset(b, io);
  b.prev = b.prev === -1 ? s : b.ai.st;
  b.ai.st = s;
  b.sub = 0;
}

export const defeated = b => b.lastHp < 0x2711;                                   // FUN_00aa2c30
export const lowHp = (b, io) =>                                                   // FUN_00aa2f78
  ((b.status.hp - 10000) / (io.mshort(99) - 10000)) * 100 <= LOW_HP_PCT;

// FUN_00aa0fb8: the player's body motion is one of 0x34..0x37, 0x39, 0x3a
const PLAYER_BUSY = new Set([0x34, 0x35, 0x36, 0x37, 0x39, 0x3a]);
const playerBusy = io => { const p = io.player(); return !!p && PLAYER_BUSY.has(io.motionId(p.C)); };

// FUN_00aa2bb8: ready to attack = no shot of ours alive, the player not busy, 60 frames on timer 0
function ready(b, io) {
  for (let i = 0; i < 8; i++) if (b.miss[i] > -1) { stamp(b, io, 0); return false; }
  if (playerBusy(io)) { stamp(b, io, 0); return false; }
  return since(b, io, 0) > 0x3b;
}

// FUN_00aa2ac8: nearest of btbox0..3 (FUN_0054aa50 distance; start 10000; ties keep the earlier)
function nearestBox(b, io, obj, skip) {
  let best = 10000, k = 0;
  for (let i = 0; i < 4; i++) {
    if (i === skip) continue;
    const d = io.dist(obj, b.boxes[i]);
    if (d < best) { best = d; k = i; }
  }
  return k;
}

// FUN_00aa2b70: mover rates FUN_0034ad00(120k, 600k, 100k, C)
const rates = (b, io, k) => io.moverRates(b.C, k * 120, k * 600, k * 100);

// FUN_00aa2ea0: one gun shot when shots are left and the weapon interval (W +0x44) has passed;
// bullet kind 0x12 when the player is 60 u or more above the body (y down), else 0x11
function fireGun(b, io) {
  const kind = io.player().pos[1] - b.C.pos[1] <= -60 ? 0x12 : 0x11;
  if (s8(b.shots) > 0 && b.ai.W.f44 <= since(b, io, 1)) {
    io.muzzle(b.actor, 0x670);                                                   // FUN_00569340
    io.shoot({ by: b.actor, w: b.wg, at: 'muzzle', n: 4, kind });                // FUN_00569870
    stamp(b, io, 1);
    b.shots = s8(b.shots - 1);
  }
}

// FUN_00aa2c40: missile volley from markers 16 (i < 4) / 15, 50 u up; all 8 after a stagger
// (prev == 8), else i % 4 < 2 (4 shots); speed x (rand * 0.4 + 0.8); asj_017 on shots 0 and 4
function volley(b, io) {
  for (let i = 0; i < 8; i++) {
    if (b.prev !== 8 && i % 4 >= 2) continue;
    const slot = i < 4 ? 0x10 : 0xf;
    const p = io.marker(b.C, slot); p[1] -= 50;
    const s = io.shoot({ by: b.actor, w: b.wm, at: p, n: 4, kind: slot });
    b.miss[i] = s.id;
    s.home = 0;                                                                   // +0x154
    s.speed *= io.rand() * 0.40000004 + 0.8;                                      // +0x12c
    if (i === 0 || i === 4) io.soundAt(b.actor, 1800, 'asj_017');                 // FUN_00aa1110
  }
}

// FUN_00aa2dd8: every live shot gets a heading (rand * 180 + 180) degrees (+0x154 > 0 = homing on)
function homeOn(b, io) {
  for (let i = 0; i < 8; i++) {
    const s = io.shotById(b.miss[i]);
    if (s) s.home = (io.rand() * 180 + 180) * 0.017453294;
  }
}

// FUN_00aa00b0(k, out, a, b, flat): a + normalize(b - a, y = 0) x k  (a point k u from the player
// toward the body; operand order read from the VU macro code)
function toward(k, a, bpos) {
  const d = [bpos[0] - a[0], 0, bpos[2] - a[2]];
  const n = Math.hypot(d[0], d[2]) || 1;
  return [a[0] + d[0] / n * k, a[1], a[2] + d[2] / n * k];
}

// FUN_00aa1690: enter (vt+0x14)
export function enter(b, io) {
  b.ai.f20 = 1;
  b.ai.flags |= 1;
  setState(b, io, 0, 1);
  if (setup(b, io)) io.dropBrain(b.ai);                                           // FUN_0035f268(ai, 0)
}

// FUN_00aa13a8: 1 = a locator or weapon is missing
function setup(b, io) {
  b.player = io.player();                                                         // FUN_0053bb08
  b.box4 = io.locator('btbox4');
  if (!b.box4) return 1;
  b.box5 = io.locator('btbox5') || b.box4;
  for (let i = 0; i < 4; i++) { b.boxes[i] = io.locator('btbox' + i); if (!b.boxes[i]) return 1; }
  const [g, m] = WEAPONS[Math.min(io.difficulty(), 2)];
  b.wg = io.weapon(g); if (b.wg) io.setStatusWeapon(b.status, g);               // FUN_00311600 / FUN_00318610
  b.wm = io.weapon(m);
  if (!b.wg || !b.wm) return 1;
  b.f54 = 0xb4;
  const v = io.stageValue('bshv0'); if (v !== undefined) b.f54 = v;              // FUN_00aa08e8
  return 0;
}

// FUN_00aa16f8: update (vt+0x1c)
export function update(b, io) {
  const C = b.C, ai = b.ai;
  if (io.busy(b.actor) && ai.st !== 10) setState(b, io, 10, 1);                  // FUN_0055ab08
  if (io.motionId(C) === 1 && io.motionDone(C)) io.motionReq(C, 3);               // FUN_003419c0 / FUN_00341780
  let next = -1;
  switch (ai.st) {
    case 0:
      if (!io.fxHost(b.actor)) { io.dropBrain(ai); break; }                       // actor vt+0x26c
      b.actor.f118 = (b.actor.f118 | 0x80000000) >>> 0;                          // FUN_00aa1200
      C.f568 = (C.f568 | 0x1000000) >>> 0;
      b.lastHp = b.status.hp;
      io.motionReq(C, 3);
      io.targetPlayer(ai);                                                        // FUN_0035fd20
      b.actor.f118 = (b.actor.f118 | 0x1c) >>> 0;                                // FUN_00aa0a00(a, 0)
      io.bodyMode(C, 6);                                                          // FUN_0034e960
      io.bodyFlag(C, 3);                                                          // FUN_00340de0
      C.f1c0 = ((C.f1c0 & ~1) | 2) >>> 0;
      rates(b, io, 3.0);
      io.placeAt(b.actor, b.boxes[0].pos);                                        // FUN_0034ab40 / FUN_0054b1a0
      C.f765 = 7; C.f77c = (C.f77c | 0x80) >>> 0;
      io.soundBody(C, 800, 'bsj_291');                                            // FUN_00341458
      next = 1; break;
    case 1:
      if (aiTime(b, io) >= 0x3d) next = 2;
      break;
    case 2: {
      if (b.sub === 0) { stamp(b, io, 0); b.sub++; } else if (b.sub !== 1) break;
      if (io.targetDead()) break;                                                 // FUN_00316cf8
      if (defeated(b)) { next = 9; break; }
      if (s16(b.acc) >= STAGGER_DAMAGE && b.lastHp !== b.status.hp) { next = 8; break; }
      if (!(C.f1c4 & 4)) { stamp(b, io, 0); break; }                             // not at the box yet
      if (ready(b, io)) {
        let s;
        if (!io.inBox(b.box4, b.player)) {                                       // FUN_00552330
          if (!(ai.flags & 2)) { next = 5; break; }                              // FUN_00360bb8(ai, 1)
          s = b.alt ? 5 : 3;
        } else {
          if (s8(b.count) < 2) { next = 3; break; }
          s = b.alt ? 4 : 6;
        }
        setState(b, io, s, 1);
        b.alt ^= 1;
        break;
      }
      if (s8(b.moves) < 3) {
        const p = nearestBox(b, io, b.player, -1), me = nearestBox(b, io, b.actor, -1);
        let to = Math.abs(me - p) !== 2 ? p + 2 : me;
        if (to < 0) to += 4;
        if (to > 3) to -= 4;
        if (to !== me) {
          let left = false;
          if (me < 3) { if (me < 1) { if (me === 0) left = to !== 3; } else left = me <= to; }
          else if (me === 3) left = to !== 0;
          io.setClip(C, left ? 'l_trn' : 'r_trn');                                // FUN_00344840
          io.motionReq(C, 1);
          rates(b, io, 3.0);
          io.flyTo(b.actor, b.boxes[to].pos);                                     // FUN_005889c8
          if (s8(b.count) === 0) b.moves = s8(b.moves + 1);
          b.count = 0;
        }
        break;
      }
      b.moves = 0;
      next = 3; break;
    }
    case 3: {                                                                     // gun burst
      if (b.sub === 0) { stamp(b, io, 1); b.shots = b.ai.W.f48; b.sub++; }
      if (b.sub === 1) {
        if (s16(b.acc) < STAGGER_DAMAGE || b.lastHp === b.status.hp) {
          fireGun(b, io);
          if (s8(b.shots) > 0) break;
          aiReset(b, io); b.sub++; break;
        }
        b.count = s8(b.count + 1); setState(b, io, 8, 1); break;
      }
      if (b.sub === 2 && aiTime(b, io) >= b.ai.W.f46) { b.count = s8(b.count + 1); setState(b, io, 2, 1); }
      break;
    }
    case 4:                                                                       // atk_sp1: dive with a hit volume
      if (b.sub === 0) {
        io.setClip(C, 'atk_sp1'); io.motionReq(C, 1);
        io.soundAt(b.actor, 1800, 'bsj_292');
        // FUN_00541278 -> class 0xd attack volume: 579ef0(2), 579f70(1), +0xc0 nibble 0xc, 579ff8(+0x54),
        // 57a018(own id), +0xe0 200, +0xd0 40, attached (FUN_0054bf48), effect 0x40603400, sound bsj_293
        io.attackVolume({ by: b.actor, a: 2, b: 1, c0: 0xc, f54: b.f54, e0: 200, d0: 40, fx: 0x40603400, se: 'bsj_293' });
        b.sub++;
      } else if (b.sub === 1) {
        if (!io.motionPast(C, 84)) break;
        io.bodyMode(C, 0);
        rates(b, io, 5.0);
        io.flyTo(b.actor, toward(60, b.player.pos, C.pos));
        b.sub++;
      } else if (b.sub === 2) {
        if (!(C.f1c4 & 4)) break;
        io.turnTo(C, 0.5, sub3(b.player.pos, C.pos));                                          // FUN_00aa0d50(0.5, C, dir): FUN_0034ba30 / 0034ba60 / 0034bcf8 / 0034e960(C, 1)
        b.sub++;
      } else if (b.sub === 3 && (C.f1c4 & 8)) {
        io.bodyMode(C, 6); b.count = 0; next = 2;
      }
      break;
    case 5:                                                                       // missile volley
      if (b.sub === 0) { io.bodyMode(C, 0); b.sub++; }
      if (b.sub === 1) { volley(b, io); aiReset(b, io); b.sub++; break; }
      if (b.sub === 2) {
        if (aiTime(b, io) > 0x1d) io.bodyMode(C, 6);
        if (aiTime(b, io) > 0x2c) homeOn(b, io);
        if (aiTime(b, io) < 0x78) break;
        b.count = 0;
        if (b.prev === 8) b.acc = 0;
        next = 2;
      }
      break;
    case 6:                                                                       // atk_sp3: homing volley
      if (b.sub === 0) { io.setClip(C, 'atk_sp3'); io.motionReq(C, 1); b.sub++; }
      else if (b.sub === 1) {
        if (!io.motionPast(C, 228)) break;
        io.bodyMode(C, 0);
        for (let i = 0; i < 8; i++) {
          if (i % 4 >= 2) continue;
          const s = io.shoot({ by: b.actor, w: b.wm, at: 'muzzle', n: 4, kind: i < 4 ? 0x10 : 0xf });
          b.miss[i] = s.id;
          s.home = 3.1415927;
          s.speed *= io.rand() * 0.40000004 + 0.8;
          io.soundAt(b.actor, 1800, 'asj_017');
        }
        b.sub++;
      } else if (b.sub === 2) {
        if (!io.motionDone(C)) break;
        io.turnTo(C, 0.5, sub3(b.player.pos, C.pos)); b.sub++;
      } else if (b.sub === 3 && (C.f1c4 & 8)) {
        io.bodyMode(C, 6); b.count = 0; next = 2;
      }
      break;
    case 7:                                                                       // atk_sp2 (low HP)
      switch (b.sub) {
        case 0: b.sub++;                                                          // falls through
        case 1: volley(b, io); aiReset(b, io); b.sub++; break;
        case 2: {
          if (aiTime(b, io) < 0x2d) break;
          io.setClip(C, 'atk_sp2'); io.motionReq(C, 1);
          const p = [C.pos[0], C.pos[1] - 200, C.pos[2]];
          rates(b, io, 2.0); io.flyTo(b.actor, p);
          b.sub++; break;
        }
        case 3: {
          if (io.motionPast(C, 45)) homeOn(b, io);
          if (!io.motionPast(C, 192)) break;
          const p = io.clampToBox(toward(120, b.player.pos, C.pos), b.box5);    // FUN_00aa0538(p, box5, 0)
          p[1] = -110;
          rates(b, io, 6.0); io.flyTo(b.actor, p);
          b.shots = b.ai.W.f48; stamp(b, io, 1);
          b.sub++; break;
        }
        case 4: if (io.motionPast(C, 230)) b.sub++;                               // falls through
        case 5:
          fireGun(b, io);
          if (!io.motionDone(C)) break;
          io.motionReq(C, 3);
          if (!(C.f1c4 & 4) || s8(b.shots) > 0) break;
          b.acc = 0; next = 2; break;
      }
      break;
    case 8:                                                                       // stagger (lean)
      switch (b.sub) {
        case 0:
          io.stagger(b.actor);                                                    // FUN_0055a828
          io.bodyMode(C, 0); io.setClip(C, 'idl_lean'); io.motionReq(C, 1);
          io.effect(0x40602c00, io.fxHost(b.actor));                              // FUN_00336698
          b.sub++; break;
        case 1:
          if (io.motionPast(C, 160)) { C.f765 = 3; C.f77c = (C.f77c & ~0x80) >>> 0; }
          if (!io.motionDone(C)) break;
          io.setClip(C, 'lean'); io.motionReq(C, 2);
          io.effect(0x40603800, io.fxHost(b.actor));
          aiReset(b, io); b.sub++; break;
        case 2:
          if (aiTime(b, io) < 0xb4) break;
          io.setClip(C, 'lean_idl'); io.motionReq(C, 1);
          io.effectEnd(0x40603800, io.fxHost(b.actor));                           // FUN_003367e0
          b.sub++; break;
        case 3:
          if (io.motionPast(C, 230)) { C.f765 = 7; C.f77c = (C.f77c | 0x80) >>> 0; }
          if (!io.motionDone(C)) break;
          io.turnTo(C, 0.5, sub3(b.player.pos, C.pos)); b.sub++; break;
        case 4:
          if (!(C.f1c4 & 8)) break;
          io.bodyMode(C, 6); io.motionReq(C, 3);
          next = defeated(b) ? 9 : lowHp(b, io) ? 7 : 5;
          break;
      }
      break;
    case 9:                                                                       // beaten
      if (b.sub === 0) { io.bodyMode(C, 0); aiReset(b, io); b.sub++; break; }
      if (b.sub === 1 && aiTime(b, io) > 0xb3) {
        io.motionStop(C);                                                         // FUN_00341518
        io.die(b.actor);                                                          // actor vt+0x334
        return;
      }
      break;
    case 10:
      if (!io.busy(b.actor)) setState(b, io, 2, 1);
      break;
  }
  if (next >= 0) setState(b, io, next, 1);

  // shots in flight: drop dead ids; homing ones steer to a point around the player, off within 80 u
  for (let i = 0; i < 8; i++) {
    const s = io.shotById(b.miss[i]);                                            // FUN_0053e068 + vt+0xbc
    if (!s) { b.miss[i] = -1; continue; }
    if (!(s.home > 0)) continue;
    io.shotRetarget(s);                                                           // FUN_00552ac0(s, -1)
    const a = i * 0.7853982;
    let r = io.rand() * 20 + 40;
    if (i === 0 || i === 4) r = io.rand() * 10 + 10;
    const pp = b.player.pos;
    s.target = [pp[0] + Math.sin(a) * r, pp[1], pp[2] + Math.cos(a) * r];         // +0xd0 (FUN_0045b530 sinf / FUN_0045b428 cosf)
    if (io.dist(s, b.player) <= 80) { s.home = 0; b.miss[i] = -1; }
  }
  if (defeated(b)) {
    b.actor.f118 = (b.actor.f118 | 0x207c) >>> 0;                                // FUN_00aa09a8(a, 1)
    io.lockable(b.actor, 0);                                                      // FUN_0054b508
    if (since(b, io, 2) >= 0x15) {
      io.effect(0x40602400 + Math.trunc(io.rand() * 8), io.fxHost(b.actor));
      stamp(b, io, 2);
    }
    if (!b.smoke) { io.soundBody(C, 1800, 'bsj_294'); b.smoke = 1; }
  }
  b.acc = s16(b.acc + (b.lastHp - b.status.hp));
  if (b.lastHp !== b.status.hp) gauge(b, io, b.status.hp);                        // FUN_00aa11b8
  b.lastHp = b.status.hp;
}

// FUN_00aa11b8: HUD gauge 0xd = (HP - 10000, at least 0) of (manager short 99 - 10000)
export function gauge(b, io, hp) {
  io.hudGauge(0xd, Math.max(hp - 10000, 0), io.mshort(99) - 10000, 1);           // FUN_003b58e0
}
