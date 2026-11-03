// boss_io.js -- the page's side of the z128 boss (worker 0235; notes/boss-research.md "Hookup"): the engine calls the
// translated brain boss_z128.js makes (its `io`), answered with enemy_ai.js's own translated pieces (env), and the
// boss's body step (move mode 1 fly_mover.js, turn mode 1 turn_mover.js). No three.js.
//
// enemy_ai.js builds one of these when AI mode 0x100 gets its brain from the overlay plug-in (FUN_0035f300 with
// DAT_0046e590 set by Zone.boss(true)): createBoss(env, actor). Calls are cited by the game function they stand for.

import * as BZ from './boss_z128.js';
import * as FM from './fly_mover.js';
import * as TM from './turn_mover.js';

const f = Math.fround;
const xform = (M, p) => [0, 1, 2].map(c => f(f(f(f(p[0] * M[0][c]) + f(p[1] * M[1][c])) + f(p[2] * M[2][c])) + M[3][c]));

// env: { S, P, data, warn, rng, DIFF, mshort, sound(name, pos, range), effect(id, pos), setMotion(a, cls), motionDone(a),
//        motionPast(a, fr), setMode(ai, m), setTarget(ai, t), setTurn(a, mode), stopAll(a), busy(a), dead(o),
//        enemyDeath(a), shootMarker(a, W, aim, n, marker), spawnShot(a, aim, muzzle, W), markerWorld(a, i),
//        bossVolume(a, x), bullets, gauge(id, v, max, f), MOVE_DT }
export function createBoss(env, a) {
  const { P, data, warn } = env;
  const C = a.C, ai = a.ai;
  C.pos = a.pos;
  // the brain's view of the AI record (AI +0x24 state, +0x26 its timer, +0x20 interval, +0x14 flags = the page's ai.flags,
  // +0x100 = the AI's weapon: W+0x44 interval, +0x46 rest, +0x48 shots)
  const bai = {
    st: 0, f26: 0,
    get f20() { return ai.interval; }, set f20(v) { ai.interval = v; },   // AI +0x20 = the scheduler interval (T: due = last + 1)
    get flags() { return ai.flags | 0; }, set flags(v) { ai.flags = v; },
    get W() { const W = ai.W || {}; return { f44: W.interval, f46: W.reload, f48: W.mag }; },
  };
  ai.boss = bai;
  const PC = { player: true };                                     // Vincent's body, for FUN_003419c0 (P.motionClass)
  const player = { get pos() { return P.pos; }, C: PC };
  const names = data.names || {};
  const trig = k => data.triggers.find(t => t.idx === k);
  const locs = new Map();
  const proxies = new Map();
  // a bullet as the brain reads it: +0x154 home, +0x12c speed, +0xd0 target point (b.end), +0x90 pos
  const proxy = b => {
    if (!b) return null;
    let p = proxies.get(b);
    if (!p) {
      p = { get id() { return b.id; }, get home() { return b.home ?? 0; }, set home(v) { b.home = f(v); },
            get speed() { return b.speed; }, set speed(v) { b.speed = f(v); },
            get target() { return b.end; }, set target(v) { b.end = v.map(f); }, get pos() { return b.pos; }, b };
      proxies.set(b, p);
    }
    return p;
  };
  const none = { id: -1, home: 0, speed: 0 };                     // FUN_00569870 returned no bullet
  let bodySound = null;

  const io = {
    clockA: () => env.S.now, clockB: () => env.S.now,             // both brain clocks = the AI scheduler's (T: w231_fight2)
    rand: () => env.rng(),                                         // FUN_0040b5c0
    mshort: i => env.mshort[i],                                    // manager short (cmd 0x2f / 0x30)
    difficulty: () => env.DIFF,                                    // FUN_00242c28
    player: () => player,                                          // FUN_0053bb08
    busy: x => !!env.busy(x),                                      // FUN_0055ab08
    motionId: c => (c === PC ? (P.motionClass ?? 0) : (c.motion ? c.motion.cls : 0)),   // FUN_003419c0
    motionDone: () => !!env.motionDone(a),                         // FUN_003460d8
    motionPast: (c, fr) => !!env.motionPast(a, fr),                // FUN_00346108
    motionReq: (c, n) => env.setMotion(a, n),                      // FUN_00341780(C, n, 0)
    setClip: (c, name) => { C.n640 = name; C.n648 = null; C.n650 = null; },   // FUN_00344840(C, name, 0, 0): slots 0-2
    bodyMode: (c, m) => env.setTurn(a, m),                         // FUN_0034e960 (path_mover setTurn)
    bodyFlag: (c, n) => warn(`boss_io: FUN_00340de0(C, ${n}) not decoded: left out`),
    moverRates: (c, acc, top, dec) => { C.f1e4 = f(acc); C.f1e0 = f(top); C.f1e8 = f(dec); },   // FUN_0034ad00
    placeAt: (x, p) => { a.pos = p.slice(0, 3).map(f); C.pos = a.pos; },      // FUN_0034ab40 / FUN_0054b1a0
    flyTo: (x, p) => { C.pos = a.pos; FM.flyTo(C, p, warn); a.pos = C.pos; }, // FUN_005889c8
    turnTo: (c, k, dir) => TM.turnStart(a, dir, k, warn),         // FUN_00aa0d50
    soundBody: (c, range, name) => { bodySound = env.sound(name, a.pos, range); },   // FUN_00341458 (slot C+0x80c)
    soundAt: (x, range, name) => env.sound(name, a.pos, range),    // FUN_00aa1110 -> FUN_0033cc48
    motionStop: () => {                                            // FUN_00341518: stop the C+0x80c sound, C+0x754 = 0
      if (bodySound && bodySound.stop) bodySound.stop(); else if (bodySound) warn('boss_io: FUN_00341518: the sound hook gives no stop handle');
      bodySound = null;
    },
    effect: (id, host) => env.effect(id >>> 0, a.pos.slice()),     // FUN_00336698(id, model). L: at the body's position
    effectEnd: id => warn(`boss_io: FUN_003367e0 (end effect 0x${(id >>> 0).toString(16)}) not translated`),
    fxHost: () => a,                                               // actor vt+0x26c (the model)
    dropBrain: x => env.setMode(ai, 0),                            // FUN_0035f268(ai, 0)
    targetPlayer: () => env.setTarget(ai, P),                      // FUN_0035fd20 -> FUN_0035fc98(ai, player)
    targetDead: () => env.dead(P),                                 // FUN_00316cf8
    locator: name => {                                             // FUN_00311c98 (name dictionary) -> trigger
      if (locs.has(name)) return locs.get(name);
      const e = names[name], t = e && e[0] === 8 ? trig(e[1]) : null;
      const L = t ? { pos: t.m[3].slice(0, 3), t } : null;
      locs.set(name, L);
      return L;
    },
    weapon: name => { const e = names[name]; return e && e[0] === 24 ? data.weapons[e[1]] ?? null : null; },
    setStatusWeapon: (s, name) => { ai.W = io.weapon(name); },    // FUN_00318610: status +0xac
    stageValue: name => { const e = names[name]; return e && e[0] === 32 && data.values32 ? data.values32[e[1]] : undefined; },
    dist: (p, q) => f(Math.hypot(p.pos[0] - q.pos[0], p.pos[1] - q.pos[1], p.pos[2] - q.pos[2])),   // FUN_0054aa50. L: 3-D
    inBox: (bx, p) => {                                            // FUN_00552330: inside the trigger's box (FUN_005507a0)
      const l = xform(bx.t.inv, p.pos);
      return l.every((v, c) => bx.t.lo[c] <= v && v <= bx.t.hi[c]);
    },
    clampToBox: (p, bx) => {                                       // FUN_00aa0538(p, box, 0): local x / z clamped, back to world
      const l = xform(bx.t.inv, p);
      if (l[0] < bx.t.lo[0]) l[0] = bx.t.lo[0];
      if (l[2] < bx.t.lo[2]) l[2] = bx.t.lo[2];
      if (bx.t.hi[0] < l[0]) l[0] = bx.t.hi[0];
      if (bx.t.hi[2] < l[2]) l[2] = bx.t.hi[2];
      return xform(bx.t.m, l);
    },
    muzzle: () => {                                                // FUN_00569340(actor, C+0x670): the status weapon
      const W = ai.W;
      if (!W) return;
      if (!(W.f78 & 0x800)) env.spawnShot(a, (C.aim || a.pos).slice(), null, W);   // FUN_005694f8
      else warn('boss_io: FUN_00569340 with W+0x78 bit 0x800 (marker table W+0xdc / +0xe0) not translated');
    },
    shoot: x => {                                                  // FUN_00569870(-1, actor, W, aim, 4, marker, -1)
      const aim = x.at === 'muzzle' ? (C.aim || a.pos).slice() : x.at;
      return proxy(env.shootMarker(a, x.w, aim, x.n, x.kind)) || none;
    },
    shotById: id => (id > 0 ? proxy(env.bullets.find(b => b.id === id)) : null),   // FUN_0053e068 + vt+0xbc
    shotRetarget: s => { s.b.target = null; },                     // FUN_00552ac0(s, -1)
    marker: (c, i) => env.markerWorld(a, i) || a.pos.slice(),      // FUN_003461a0
    attackVolume: x => env.bossVolume(a, { ...x, marker: 1 }),     // FUN_00541278 + FUN_0054bf48(o, owner, 1)
    stagger: () => { if (C.mm === 1) warn('boss_io: FUN_0055a828 while flying (FUN_0034d870 mode 1 off) not translated'); else env.stopAll(a); },
    die: () => env.enemyDeath(a),                                  // actor vt+0x334 = FUN_0055cac8
    lockable: (x, on) => { a.flags28 = on ? (a.flags28 | 0x1000) : (a.flags28 & ~0x1000); },   // FUN_0054b508
    hudGauge: (id, v, max, fl) => env.gauge(id, v, max, fl),       // FUN_003b58e0
  };
  const b = BZ.makeBrain(bai, a, a, C);
  return {
    brain: b, io, ai: bai,
    enter: () => BZ.enter(b, io),                                  // vt+0x14
    update: () => BZ.update(b, io),                                // vt+0x1c
    // the boss's part of FUN_0034ea18 (the body step): move mode 1 and turn mode 1 (mode 6 is enemy_ai turnBody)
    body: () => {
      C.pos = a.pos;
      FM.step(C, env.MOVE_DT);
      a.pos = C.pos;
      TM.turnStep(a, env.MOVE_DT);
    },
  };
}
