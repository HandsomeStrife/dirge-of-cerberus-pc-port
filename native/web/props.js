// props.js -- z128's explosive barrels (gimmick model e057) and their explosions, the game logic (no three.js;
// props_view.js draws them). notes/barrel-research.md has the decode; data/props/props.json comes from
// native/assets/models/export_web_props.py (stage file 06800001.bin sections 14 / 15).
//
// Objects (FUN_00548348 at stage load): one per section-15 record; section-14 type +0x14 = 0 -> object type 10,
// class vt 0x5914e8 (FUN_00583708). FUN_00583b10 fills it: +0x104 HP = type +0x16 (1), +0x2c bound radius, the matrix
// (FUN_0054b7c8; row 3 = the barrel's centre), the script (+0x44). The barrel joins the enemy AI's world (enemy_ai.js)
// as a 'prop' object, so its script events run in that VM and Vincent's bullets meet it in FUN_005442d8's
// closest-hit test (enemy_ai playerBulletHit / enemyBulletHit call bulletTest / bulletHit below).
//
//   createProps({ data, weapons, effect, warn }) -> props
//   props.attach(world)    enemy_ai createEnemyAI (opts.props): registers the barrels, runs the stage-start activation
//   props.id / mgr / cmd   enemy_ai send(): manager 0x3e / 0x2a / 0x2b / 0x4, the barrel's object commands
//   props.bulletTest(b) / bulletHit(h, b)   enemy_ai's bullet pass
//   props.update(step)     enemy_ai tick: the explosions (vt+0x214 FUN_0057e638)
//   props.barrels / props.explosions        state (props_view.js, tests)
import { cylinderHit } from './enemy_hit.js';

const f = Math.fround;
const sub3 = (a, b) => [f(a[0] - b[0]), f(a[1] - b[1]), f(a[2] - b[2])];
const add3 = (a, b) => [f(a[0] + b[0]), f(a[1] + b[1]), f(a[2] + b[2])];
const mul3 = (a, k) => [f(a[0] * k), f(a[1] * k), f(a[2] * k)];
const dot3 = (a, b) => f(f(f(a[0] * b[0]) + f(a[1] * b[1])) + f(a[2] * b[2]));
const len3 = a => f(Math.sqrt(dot3(a, a)));
// the EE FPU's add.s rounds toward zero (T: w209_barrel, the explosion clock +0xc8 = 59.9999 after 50 steps of
// 1.1999999 where round-to-nearest gives 60.00003: 51 updates in the game); as effects.js rz
const rz = x => { const r = Math.fround(x); if (!isFinite(r) || r === x || Math.abs(r) <= Math.abs(x)) return r; const b = new Float32Array([r]), u = new Uint32Array(b.buffer); u[0] -= 1; return b[0]; };
const unit3 = v => { const l = len3(v); return l > 0 ? v.map(x => f(x / l)) : [0, 0, 0]; };   // vrsqrt / vmulq (0 -> 0)

export const PROP_KIND = 'prop';
export const BARRIER_CLS = 8;           // section-14 +0x14 class 8 -> object type 0x13 (FUN_00548348), vt 0x58c630: the EM barriers
export const EXPL_TIME = 60.0;          // FUN_0057f040: +0xcc = 60.0 (0x42700000): the explosion lives 60 ticks (50 frames)
export const EXPL_GROW = 0.2;           // FUN_0057f040: +0xd8 = radius x 0.2 per frame (FUN_0057e638)
export const EXPL_FX_SCALE = 0.1;       // FUN_00336280: effect scale = radius x DAT_0046e534 (0.1)
export const EXPL_FX = 0x800;           // FUN_00336280 -> FUN_003366b8(0x800): FED r0000 emitter 3
export const EXPL_MAX = 0x20;           // FUN_0057ed98: at most 32 targets
export const EXPL_CLEAR = 10.0;         // FUN_0057e7d0: a wall blocks only when 10 units or more in front of the target
export const BLAST_FLAGS = 8;           // FUN_0057e4d8: +0x1ec = 8 (FUN_00565480's flags for the hit reaction)

// FUN_0025d1b8(r, out p, out n, q, a, b): the nearest point to q on the closed cylinder a..b of radius r (flat ends).
// t = (q - a) . u (FUN_002614f4, foot = a + u t); before a: inside the rim -> onto the end disc (q + u (-t)), else the
// rim (a + unit(reject(q - a, u)) r, FUN_00260e28); along the side: foot + unit(q - foot) r; past b: the disc
// (q + u (L - t)) or the rim at b.
export function nearestOnCylinder(r, q, a, b) {
  const ab = sub3(b, a), L = len3(ab), u = unit3(ab);
  const t = dot3(sub3(q, a), u);
  const foot = add3(a, mul3(u, t)), dl = len3(sub3(foot, q));
  const rim = base => { const w = sub3(q, base), wu = dot3(w, u); return add3(base, mul3(unit3(sub3(w, mul3(u, wu))), r)); };
  if (t < 0) return dl < r ? add3(q, mul3(u, f(-t))) : rim(a);
  if (t <= L) return add3(foot, mul3(unit3(sub3(q, foot)), r));
  return dl < r ? add3(q, mul3(u, f(L - t))) : rim(b);
}
// FUN_0025c770(r, q, a, b): q inside the closed cylinder
export function insideCylinder(r, q, a, b) {
  const ab = sub3(b, a), L = len3(ab), u = unit3(ab), t = dot3(sub3(q, a), u);
  if (t < 0 || t > L) return false;
  return len3(sub3(sub3(q, a), mul3(u, t))) < r;
}

// FUN_0025a8f0(hit, n, a, b, half, M, 0): a segment against a box. Rejected by the bounding spheres; a and b into the box's rigid frame (FUN_002610e0,
// FUN_0026135c), scaled to the unit box; VCLIP's flags: only faces a and b are on opposite sides of count; +1 faces z, y, x, then -1 faces z, y, x; each t <= the
// best so far, the point inside the other faces; the point clamped (DAT_004992b0 / c0 = +-1), scaled back, through M; the normal through M's rotation
export function boxRay(a, b, half, m) {
  const c = m[3], mid = [0, 1, 2].map(j => f(f(a[j] + b[j]) * 0.5));
  if (!(len3(sub3(mid, c)) <= f(len3(sub3(mid, a)) + len3(half)))) return null;
  const local = p => { const v = sub3(p, c); return [0, 1, 2].map(i => f(f(f(f(v[0] * m[i][0]) + f(v[1] * m[i][1])) + f(v[2] * m[i][2])) / half[i])); };
  const clip = p => { let r = 0; for (let i = 0; i < 3; i++) { if (p[i] > 1) r |= 1 << (2 * i); if (p[i] < -1) r |= 2 << (2 * i); } return r; };   // VCLIP, w = 1
  const A = local(a), B = local(b), cross = clip(A) ^ clip(B);
  if (!(cross & 0x3f)) return null;
  const D = sub3(B, A);
  let best = 1, P = null, N = null;
  for (const s of [1, -1]) for (let i = 2; i >= 0; i--) {
    const bit = 2 * i + (s < 0 ? 1 : 0);
    if (!((cross >> bit) & 1) || !(0 < Math.abs(D[i]))) continue;
    const t = f(f(s - A[i]) / D[i]);
    if (!(t <= best)) continue;
    const p = [0, 1, 2].map(j => f(A[j] + f(D[j] * t)));   // FUN_002611f4
    if (clip(p) & ~(1 << bit) & 0x3f) continue;
    P = p; N = [0, 0, 0]; N[i] = s; best = t;
  }
  if (!P) return null;
  const q = P.map((v, i) => f(Math.max(-1, Math.min(1, v)) * half[i]));
  return { point: [0, 1, 2].map(j => f(f(f(f(q[0] * m[0][j]) + f(q[1] * m[1][j])) + f(q[2] * m[2][j])) + c[j])),
           normal: [0, 1, 2].map(j => f(f(f(N[0] * m[0][j]) + f(N[1] * m[1][j])) + f(N[2] * m[2][j]))) };
}

// worker 0269: a gimmick's model as an effect attachment (FUN_002dbc80's MP +0x3e4 -> +0x10 = the MP): matrix() = MP +0x10 =
// FUN_005842c8's T(0, +0x1c / 2, 0) (type flag bit 4) x the object matrix; bone(k) = FUN_002db448 = the bone's model-space
// matrix x that. L: the bones at their bind pose (data/props/<model>.json joints.bind_world_colmajor: column-major = the game's
// rows; the model has no clips and no local pose file).
export function modelAttach(o, bind) {
  const hh = (o.type.flags >> 4) & 1 ? f(o.h * 0.5) : 0, m = o.m;
  const M = new Float32Array(16);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) M[4 * i + j] = f(m[i][j]);
  for (let j = 0; j < 3; j++) M[12 + j] = f(o.pos[j] + f(m[1][j] * hh));
  M[15] = 1;
  const bone = k => {
    const b = bind && bind[k];
    if (!b) return M;
    const o4 = new Float32Array(16);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) o4[4 * i + j] = f(f(f(b[4 * i] * M[j]) + f(b[4 * i + 1] * M[4 + j])) + f(f(b[4 * i + 2] * M[8 + j]) + f(b[4 * i + 3] * M[12 + j])));
    return o4;
  };
  return { matrix: () => M, bone };
}

export function createProps({ data, weapons = [], effect = null, areas = null, hum = null, models = {}, warn = console.warn } = {}) {
  const warned = new Set();
  const warnOnce = m => { if (!warned.has(m)) { warned.add(m); warn(m); } };
  const types = data.types || {};
  const barrels = [];
  const camBoxes = [];                   // class 3 gimmicks (vt 0x591890): cameraProbe's boxes (FUN_00548348 case 3)
  const explosions = [];
  let W = null;                          // the enemy AI world (attach)
  // manager +0x260 (cmd 0x10f / 0x40 write it, 0x2a / 0x2b / 4 read it) is the enemy AI world's one field (W.mgr260; worker 0212)
  let nextExpl = 0;
  const byRec = new Map();
  const ev = (o, n, args) => W.runEvent(o, n, args);
  const push = s => { if (W) W.events.push(s); };

  // FUN_00548348 + FUN_00583b10: a fresh barrel from its record (the stage load; L: a Restart reloads the stage, so
  // the barrels come back too: notes/barrel-research.md)
  function make(rec) {
    const ty = types[String(rec.type)];
    const pos = rec.m[3].slice(0, 3).map(f);
    const shape = ty.shape;
    if (ty.cls === BARRIER_CLS) return makeBarrier(rec, ty, pos);
    if (shape !== 2) warnOnce(`props: record ${rec.rec} shape ${shape} (only the cylinder, 2, is translated): not hittable`);
    return {
      kind: PROP_KIND, id: 'p' + rec.rec, rec: rec.rec, model: rec.model, type: ty, m: rec.m, pos,
      script: rec.script, vars: new Int16Array(8), t3c: new Int16Array(2),
      hp: ty.hp,                                                    // +0x104 = type +0x16 (FUN_00583b10; class != 5)
      flags28: 0x8000,                                              // FUN_00583708: +0x28 |= 0x8000 (save RAM: 0x8003 / 0x8000)
      f38: 0, f40: 0x170, f48: rec.flags48,                         // +0x40 (save RAM 0x170: bits 4-6, 8)
      r: f(ty.size[0]), h: f(ty.size[1]),                           // cylinder radius +0x18, height +0x1c
      area: rec.f4c, drawn: false, gone: false,                    // +0x4c: the parent area (FUN_00548348 -> FUN_0053b920)
    };
  }
  // FUN_00583d70 (vt+0x2f8): the type flags -> +0x38 / +0x40 / +0x28 bits (only those read on the page)
  function flagBits(o) {
    const fl = o.type.flags;
    o.f38 = 0;
    if (!((fl >> 10) & 1)) o.f38 |= 0x40;
    if (!((fl >> 12) & 1)) o.f38 |= 8;
    if (!((fl >> 13) & 1)) o.f38 |= 2;
    if (fl & 1) { o.f38 |= 1; o.f40 |= 0x10; } else o.f40 &= ~0x10;  // bit 0: bullets test it (+0x38 bit 0)
    if ((fl >> 8) & 1) { o.f38 |= 0x80; o.f40 |= 0x20; } else o.f40 &= ~0x20;   // bit 8: +0x40 bit 5 = explosion target
    if ((fl >> 9) & 1) { o.f40 |= 0x40; o.f38 |= 0x100; }
    if ((fl >> 19) & 1) { o.f38 |= 0x181; o.f40 |= 0x70; }
    if ((fl >> 1) & 1) o.f38 |= 0x30;
    if (!((fl >> 11) & 1)) o.f38 |= 4;                              // +0x38 bit 2 (lockable)
    // shape 0..3 with type flag bit 2 clear (not breakable): +0x28 bit 0x200000 (FUN_0035a440 sweeps the body against it)
    if (o.type.shape >= 0 && o.type.shape < 4) o.flags28 = (fl & 4) ? (o.flags28 & ~0x200000) : (o.flags28 | 0x200000);
  }

  // ---- the EM barriers (worker 0269): section-14 class 8 -> object type 0x13 (FUN_00548348 case 8 -> FUN_0053db98 ->
  // FUN_0054f1c8, vt 0x58c630; model g048). The state byte +0x120: 1 = on (constructor), 2 = switching off, 0 = off.
  // FUN_0054f540(o, state, quiet): 1 / 2: +0x38 |= 0x70 (bits 4 / 5: FUN_0035a440's object pass, obj_contact.js; bit 6: the
  // camera), the sound asj_630 (on) / asj_631 (off) at the object (FUN_0054b158) unless quiet; 0: +0x38 low byte and +0x40
  // bit 6 cleared. Then, on a change or when not quiet, an active barrier's beams (FUN_0054f9d8(o, 0)).
  function makeBarrier(rec, ty, pos) {
    return {
      kind: PROP_KIND, id: 'p' + rec.rec, rec: rec.rec, model: rec.model, type: ty, m: rec.m, pos, barrier: true,
      script: rec.script, vars: new Int16Array(8), t3c: new Int16Array(2),
      hp: ty.hp, flags28: 0x8000, f38: 0, f40: 0x170, f48: rec.flags48, f50: rec.f50 ?? 0,
      st: 1,                                                        // +0x120 = 1 (FUN_0054f1c8)
      ems: [],                                                      // its beams' emitters (MP +0x3e4 slots +0x1c..)
      half: ty.size.map(v => f(v * 0.5)),                           // shape 0: the box +-size / 2 (FUN_005861a8 / FUN_00585dc0)
      r: f(ty.size[0]), h: f(ty.size[1]),                           // props_view: FUN_005842c8's T(0, +0x1c / 2, 0) (type flag bit 4)
      area: rec.f4c, drawn: false, gone: false,
    };
  }
  // vt+0x2fc FUN_0054fa48(o, 0): FUN_00583d70, +0x38 bit 10 cleared; the record's +0x50 bit 0 -> off (0), else on (1), quiet
  function barrierFlags(o) {
    flagBits(o);
    o.f38 &= ~0x400;
    barrierState(o, (o.f50 & 1) ? 0 : 1, 1);
  }
  function barrierState(o, s, quiet) {
    const same = o.st === s;
    o.st = s;
    if (s === 1 || s === 2) {
      o.f38 |= 0x70;
      if (!quiet) W.sound(s === 1 ? 'asj_630' : 'asj_631', o.pos.slice());   // FUN_0054b158 -> FUN_0054ae78: +0x90 (+0x40 bit 7 clear)
      if (s === 2) humStop(o);
    } else if (s === 0) {
      o.f38 &= 0xff00; o.f40 &= ~0x40;
      humStop(o);
    }
    if (same && !quiet) return;
    if (o.flags28 & 1) beams(o, 0);
  }
  // FUN_0054f9d8(o, age) -> FUN_0054f660: state 1 -> FUN_0054f7b8(o, 1) then the four emitters 0x90c00000..3 (record +0x50
  // bit 1: 0x90c00400..; model g091: 0x916c..) from the model's FED, FUN_002dbc80(age 0 or 50, MP +0x3e4, id, 1); other
  // states -> FUN_0054f7b8(o, 0): their soft end (FUN_002e7198). Then the hum: Vincent within 80 (FUN_0054f8b0) ->
  // FUN_0054f918 (state 1: asj_620 looped at the object, FUN_003e8ec8(80.0, ..)).
  // T: w269_spawn2 (r03_dogawake -> r03_mid, area 1 on at f36): FUN_0054f2b0 -> FUN_0054f9d8(o, 1) -> FUN_0054f660 -> FUN_002dbc80(50, ..)
  // x 4 -> FUN_002dbce0 -> FUN_002e6290 with age 0 (FUN_002dbce0 does not pass FUN_002dbc80's age on), each spawn an emitter.
  function beams(o, age) {
    o.beams = o.st === 1;
    if (o.st === 1) {
      beamsOff(o, 1);                                               // FUN_0054f7b8(o, 1): the old ones go at once (FUN_002dc948)
      const base = (o.f50 & 2) ? 0x90c00400 : 0x90c00000;           // record +0x50 bit 1 (g091's 0x916c.. tables: not on z128)
      if (o.model !== 'g048') warnOnce(`props: barrier model ${o.model}: its beam ids (0x916c..) not translated`);
      else if (!effect || !effect.attached) warnOnce('props: no effect engine: the EM barrier beams are not spawned');
      else for (let i = 0; i < 4; i++) { const em = effect.attached(base + i, modelAttach(o, models[o.model] && models[o.model].joints && models[o.model].joints.bind_world_colmajor)); if (em) o.ems.push(em); }
    } else beamsOff(o, 0);                                          // FUN_0054f7b8(o, 0): their soft end (FUN_002e7198)
    if (near(o)) humStart(o);
  }
  function beamsOff(o, now) {
    for (const em of o.ems) { if (now) { if (effect && effect.remove) effect.remove(em); } else if (effect && effect.softEnd) effect.softEnd(em); }
    if (now) o.ems = [];
  }
  // FUN_0054f8b0: Vincent's point (FUN_0053bb08 -> FUN_0054a720: +0x90) within 80 of the object's +0x90 (FUN_0054a888, a distance)
  function near(o) {
    const P = W && W.player && W.player.pos;
    if (!P) return false;
    return Math.sqrt(f(f(f((P[0] - o.pos[0]) ** 2) + f((P[1] - o.pos[1]) ** 2)) + f((P[2] - o.pos[2]) ** 2))) < 80.0;
  }
  // FUN_0054f918: the old hum stopped; record +0x50 bit 2 clear and state 1 -> asj_620 at the object (FUN_0054b158 -> FUN_0033cc48 ->
  // FUN_0033cc90: a slot whose volume follows the distance), its range 80 (FUN_003e8ec8). The sample loops by itself (sdb).
  function humStart(o) {
    humStop(o);
    if (o.f50 & 4 || o.st !== 1) return;
    if (!hum) { warnOnce('props: no sound slots (play.js amb.slots): the EM barrier hum asj_620 is not played'); return; }
    const h = hum.open('asj_620', o.pos.slice(), 0, { fixed: false, range: 80.0 });
    o.hum = h == null ? null : h;
  }
  function humStop(o) { if (o.hum != null && hum) hum.close(o.hum); o.hum = null; }   // FUN_0054f998 -> FUN_0033cf00 (FUN_003e98e0, FUN_003e8ff8)
  // vt+0x214 FUN_0054f4b0, an active barrier's frame: Vincent out of range -> the hum stops; in range, none playing and state 1 -> it starts
  function barrierFrame(o) {
    if (!(o.flags28 & 1) || o.gone) return;
    if (!near(o)) { if (o.hum != null) humStop(o); }
    else if (o.hum == null && o.st === 1) humStart(o);
  }
  // vt+0x144 FUN_0054f2b0(o, on, p3): FUN_00584018 (the generic activation), then on: FUN_0054f9d8(o, 1) (beams aged 50);
  // off: FUN_0054fa18 (FUN_0054f7b8(o, 1): the emitters go, and the hum). FUN_0054add0 writes manager queue type 0x18 only
  // for a script with event 0x54 (the barriers have no script).
  function activateBarrier(o, on, p3) {
    activate(o, on, p3);
    if (on && (o.flags28 & 1)) beams(o, 50);
    else if (!on) { o.beams = false; beamsOff(o, 1); humStop(o); }    // FUN_0054fa18 -> FUN_0054f7b8(o, 1)
  }
  // the barrier's vt+0xc FUN_0054f358 (then FUN_00588b78's cases, as a barrel's)
  function barrierCmd(t, c) {
    if (c === 0x18e) {                                              // off: state 2, the delayed code -5 after DAT_0046e940 (36) ticks
      if (t.st === 1) { barrierState(t, 2, 0); W.delayedPost(t.id, -5, 36); }
      return 0;
    }
    if (c === 0x18f) {                                              // on again: the pending -5 dropped (FUN_0053edb0)
      if (t.st === 2) W.delayedDrop(t.id, -5);
      barrierState(t, 1, 0);
      return 0;
    }
    if (c === 0x108) { activateBarrier(t, 1, 0); if (t.flags28 & 1) ev(t, 3); return 0; }   // as a barrel's 0x108 (GUESS row: event 3 at once)
    if (c === 0x109) { activateBarrier(t, 0, 0); ev(t, 4); return 0; }
    return undefined;
  }
  // FUN_0053f040 code -5 -> vt+0x294 FUN_0054f338: FUN_0054f540(o, 0, 0) (enemy_ai's delayed list)
  function vt294(o) { if (o.barrier) barrierState(o, 0, 0); }
  // FUN_0035a440's object list (obj_contact.js): active objects with +0x38 bit 4 or 5 (the barriers, shape 0 boxes with +0x28 bit
  // 0x200000). L: the game walks grid list 6 (FUN_0036d400) around the body; the box tests reject the far ones the same way.
  function blockers() {
    const out = [];
    for (const o of barrels) {
      if (!(o.flags28 & 1) || o.gone || !(o.f38 & 0x30)) continue;
      // MISSING: a barrel (+0x38 bits 4 / 5 from type flag bit 1) is in the game's pass via its untranslated branch (obj_contact.js header)
      if (!o.barrier) { warnOnce('props: explosive barrels are left out of FUN_0035a440\'s object pass (no +0x28 bit 0x200000: the nearest-point / moving-object branch, FUN_0025d1b8\'s normal, not translated): bodies pass through them'); continue; }
      // vt 0x58c630: +0x13c FUN_0054fb70 returns the object (non-zero), +0x84 FUN_0054eb78 returns 0
      out.push({ id: o.id, half: o.half, m: o.m, f38: o.f38, vt13c: true, vt84: false });
    }
    return out;
  }
  // FUN_00584018 (vt+0x144): activation. Off -> on is refused for a breakable (type flag bit 2) with HP 0. On: the model
  // (FUN_00583848: the motion player, drawn by props_view), event 3 with param_3; off: event 4 with param_3, model gone.
  function activate(o, on, p3) {
    if ((on ? 1 : 0) === (o.flags28 & 1)) return;
    if (on && (o.type.flags & 4) && o.hp === 0) return;
    o.flags28 = on ? (o.flags28 | 1) : (o.flags28 & ~1);
    o.drawn = !!on;
    push(`${on ? 'activate' : 'deactivate'} ${o.id}`);
    if (p3) ev(o, on ? 3 : 4);
  }
  // cmd 0x10a = enemy_ai's generic FUN_0054cd70 case: FUN_0053fa08 (+0x28 |= 0x80000, manager event 0 on the one queue);
  // the object stays active until FUN_0053fde8 serves it at the end of the manager frame (T: w209_barrel f273, +0x28
  // 0x800b -> 0x8800b; the explosion created in that frame still lists the barrel as its 2nd target). FUN_0053e1e0 then
  // calls this (worker 0212: one delete queue, the game's order).
  function deleted(o) {
    o.flags28 &= ~1; o.drawn = false; o.gone = true; push(`remove ${o.id}`);
    // worker 0269: FUN_0053e1e0's tail calls the object's vt+0x1c(o, 3); a barrier's is FUN_0054f230 -> FUN_0054fa18: its beams
    // go at once (FUN_0054f7b8(o, 1) -> FUN_002dc948) and its hum stops (FUN_0054f998), then the base FUN_00583798
    if (o.barrier) { beamsOff(o, 1); humStop(o); }
  }

  function attach(world) {
    W = world;
    for (const o of barrels) if (o.barrier) { humStop(o); beamsOff(o, 1); }   // a Restart's new world: the old barriers' hums and beams go
    barrels.length = 0; explosions.length = 0; byRec.clear(); camBoxes.length = 0;
    // no script, record +0x48 0: on with their area, or from the stage start without one (T: 22 records against route RAM, notes/battle-camera.md).
    // Their matrix: nodeBoxes (FUN_005877e8)
    if (!data.camBoxes) warnOnce('props: props.json has no camBoxes (re-export data/props, export_web_props.py): the class 3 boxes do not stop the camera');
    for (const rec of data.camBoxes || []) camBoxes.push({ kind: PROP_KIND, id: 'c' + rec.rec, script: -1, vars: new Int16Array(8), t3c: new Int16Array(2), rec: rec.rec, m: rec.m, rest: rec.m, chunk: rec.chunk, node: rec.node, rec50: rec.rec50, type: rec.type, flags28: 1, hp: rec.type.hp, half: rec.size.map(v => f(v * 0.5)), area: rec.area, on: !parented(rec.area) });
    for (const rec of data.records || []) {
      const o = make(rec);
      if (o.barrier) barrierFlags(o); else flagBits(o);
      barrels.push(o); byRec.set(rec.rec, o);
      world.objects.set(o.id, o);
    }
    // the stage-start pass FUN_0053ced8 (class 0xf is in its lists, DAT_0058b090): vt+0x14c(1) for every gimmick without a
    // parent area (+0x40 bit 0x100 clear: +0x4c -1 or an empty manager +0x2b4 slot, e.g. 69 / 10). The others follow their
    // area (areaSwitch, worker 0223; areas.js)
    for (const o of barrels) if (!parented(o.area)) vt14c(o, 1);
  }
  const parented = k => (areas ? areas.has(k) : k >= 0);
  // vt+0x14c = FUN_00584220: +0x144(on, 1) unless record +0x48 bit 2
  function vt14c(o, on) { if (!(o.f48 & 4)) (o.barrier ? activateBarrier : activate)(o, on, 1); }
  // FUN_0054ef68 (area k switched on / off) -> vt+0x14c on its children
  function areaSwitch(k, on) { for (const o of barrels) if (!o.gone && o.area === k) vt14c(o, on); for (const b of camBoxes) if (b.area === k) b.on = !!on; }

  // ---- manager commands (FUN_00545b20) the barrels' scripts send
  function mgr(o, cmd, r) {
    if (cmd === 0x2a || cmd === 0x2b) {                             // FUN_00540b90(r0 radius, mgr, 0, mgr+0x260, r1 damage, -1, 0x2a)
      const mgr260 = W.mgr260;
      if (!mgr260) { warnOnce(`props: cmd 0x${cmd.toString(16)} before any 0x10f (manager +0x260 unset): at 0,0,0`); }
      const e = explode(f(+r[0]), mgr260 ? mgr260.slice(0, 3) : [0, 0, 0], r[1] | 0, -1, cmd === 0x2a);
      return e.id;
    }
    if (cmd === 4) {                                                // FUN_003365e0(r0 id, mgr+0x260); r1 != 0 -> scale (r1, r1, r1, 1)
      if (effect && effect.spawn) effect.spawn(r[0] >>> 0, W.mgr260 ? W.mgr260.slice(0, 3) : [0, 0, 0], r[1] ? [f(+r[1]), f(+r[1]), f(+r[1]), 1] : null);
      return 0;
    }
    return undefined;
  }

  // ---- object commands (barrel vt+0xc FUN_00586520, then FUN_00588b78, then FUN_0054cd70); undefined = enemy_ai's generic
  function cmd(t, c, r) {
    if (t.barrier) {
      const v = barrierCmd(t, c);
      if (v !== undefined) return v;
      // FUN_0054f358 hands the rest to FUN_00588b78, not the barrel's FUN_00586520 (0x14a, 0x130, 0x138, 0x1a3, 0x172..0x175):
      // those go to enemy_ai's generic cases
      if (c === 0x14a || c === 0x130 || c === 0x138 || c === 0x1a3 || (c >= 0x172 && c <= 0x175)) return undefined;
    }
    switch (c) {
      case 0x14a: t.hp = t.type.hp; W.postManager(6, t.id); return 0;   // then manager event 6 -> event 0x21 (FUN_0053fde8 case 7)
      case 0x130: t.hp = 0; activate(t, 0, 0); warnOnce('props: cmd 0x130 manager event 8 not translated'); return 0;   // FUN_00586520
      case 0x138: return t.hp;
      case 0x1a3: t.hp = r[0] | 0; return 0;
      case 0x172: return t.hp === t.type.hp ? 1 : 0;
      case 0x173: return t.hp < (r[0] | 0) ? 1 : 0;
      case 0x174: return (r[0] | 0) < t.hp ? 1 : 0;
      case 0x175: return t.hp === (r[0] | 0) ? 1 : 0;
      case 0x10f: case 0x10a: return undefined;                     // FUN_0054cd70 (enemy_ai's generic cases: manager +0x260, FUN_0053fa08)
      case 0x16e: if ((r[0] | 0) === 1) t.f38 |= 4; else t.f38 &= ~4; return 0;
      case 0x11a: if (r[0]) t.flags28 |= 0x1000; else t.flags28 &= ~0x1000; return 0;   // FUN_0054b508
      case 0x108: activate(t, 1, 0); if (t.flags28 & 1) ev(t, 3); return 0;   // +0x144(1, 0); GUESS: event 3 at once (the game's manager event 7 runs it at the frame's end)
      case 0x109: activate(t, 0, 0); ev(t, 4); return 0;            // GUESS: event 4 at once (manager event 8)
      case 0x104: case 0x105: case 0x106: case 0x107: case 0x125: case 0x101: return undefined;
      default: warnOnce(`props: barrel cmd 0x${c.toString(16)} not translated (skipped)`); return 0;
    }
  }

  // ---- bullets. Bullet record flags (+0x194 + 4): FUN_00552ad0 (0x100000) and FUN_00552b48 (0x200000). Vincent's
  // bullets have no record (+0x194 = 0); a soldier's is ai.json weapons[W.bullet] (z128's never set either bit).
  const recFlags = b => {
    const Wb = b.from && b.from.ai && b.from.ai.W;
    if (!Wb || Wb.bullet == null || Wb.bullet < 0) return 0;
    const rec = weapons[Wb.bullet];
    return rec ? rec.flags | 0 : 0;
  };
  // FUN_00584f40 (vt+0x1ac) for a bullet: +0x114 == -1 (always: no online mode) and type flag bit 21 clear (or bullet
  // +0x120 bit 2) -> FUN_00552b48 == 0 -> FUN_00554738 kind 0 / 1: type flag bit 0, 2 / 3: bit 19
  function bulletFilter(o, b) {
    const fl = o.type.flags;
    if (((fl >> 21) & 1) && !(b.f120 & 4)) return false;
    if (recFlags(b) & 0x200000) return false;
    const k = b.kind | 0;
    if (k < 2) return !!(fl & 1);
    if (k < 4) return !!((fl >> 19) & 1);
    return false;
  }
  // FUN_00584408 (vt+0x17c, mode 0), shape 2: the closed cylinder centre +- matrix row 1 x (h / 2) of radius r through
  // FUN_0025c0f8 (enemy_hit.js cylinderHit, the soldiers' too); the segment = the bullet's prev -> pos. The closest hit
  // (|prev - point|) of FUN_005442d8 among the barrels; enemy_ai compares it with the soldiers' / Vincent's.
  // FUN_005877e8 (class 3's vt+0x214, the object update): an active box's matrix = record +0x50 x the node (FUN_00269530) while the chunk is loaded, else the record's
  // (FUN_0054b770). Read from the node as last frame's FUN_00265350 left it, as the game's order (T w257_door2: the box 2 frames behind the anim's time)
  function nodeBoxes(anims) {
    if (!anims) return;
    for (const o of camBoxes) {
      if (!o.on) continue;
      const N = anims.node(o.chunk, o.node);
      if (!N) { o.m = o.rest; continue; }
      const r = o.rec50, m = [0, 1, 2, 3].map(i => [0, 1, 2].map(j => f(r[i][0] * N[0][j] + r[i][1] * N[1][j] + r[i][2] * N[2][j] + (i === 3 ? N[3][j] : 0))));
      o.m = m;
    }
  }
  function bulletTest(b) {
    let best = null;
    for (const o of barrels) {
      if (!(o.flags28 & 1) || o.gone || !(o.f38 & 1)) continue;     // active, +0x38 bit 0 (FUN_005442d8's object list)
      if (o.type.shape !== 2) continue;
      if (!bulletFilter(o, b)) continue;
      const up = o.m[1].slice(0, 3), hh = f(o.h * 0.5);
      const A = add3(o.pos, mul3(up, hh)), B = add3(o.pos, mul3(up, f(-hh)));
      const c = cylinderHit(o.r, b.prev, b.pos, A, B);
      if (!c) continue;
      const dist = len3(sub3(b.prev, c.point));
      if (!best || dist < best.dist) best = { o, point: c.point.map(f), dist };
    }
    // class 3 (+0x38 0x47b: bit 0; vt+0x1ac FUN_00584f40, vt+0x17c FUN_00584408 shape 0, vt+0x1b4 FUN_00585000 as a barrel's): they stop the bullet; type flag bit 2 clear, so no damage
    for (const o of camBoxes) {
      if (!o.on || !bulletFilter(o, b)) continue;
      const c = boxRay(b.prev, b.pos, o.half, o.m);
      if (!c) continue;
      const dist = len3(sub3(b.prev, c.point));
      if (!best || dist < best.dist) best = { o, point: c.point, dist };
    }
    return best;
  }
  // FUN_005449f0 probe 6 (the camera, player.js probe6): active barrels with +0x38 bit 6, vt+0x17c = FUN_00584408: shape 2 ->
  // FUN_0025c0f8 on the cylinder (both ends + fRam0046ef60: +0x110 is set on a barrel), then the class 3 boxes. The nearest to a: { point, normal }.
  // L: the normal = the end disc's axis or the side's radial, from the hit point (FUN_0025c0f8's branches give the same)
  function cameraProbe(a, b_) {
    let best = null;
    for (const o of barrels) {
      if (o.barrier && (o.flags28 & 1) && !o.gone && (o.f38 & 0x40)) warnOnce('props: an EM barrier on the camera probe (+0x38 bit 6, FUN_00584408 shape 0 with its +0x110 margin: not read) is left out');
      if (!(o.flags28 & 1) || o.gone || !(o.f38 & 0x40) || o.type.shape !== 2) continue;
      // FUN_00584408 case 2: probe 6 with +0x110 set (RAM: every barrel) lengthens both ends by fRam0046ef60 = 3 (RAM)
      const up = o.m[1].slice(0, 3), hh = f(f(o.h * 0.5) + 3);
      const A = add3(o.pos, mul3(up, hh)), B = add3(o.pos, mul3(up, f(-hh)));
      const c = cylinderHit(o.r, a, b_, A, B);
      if (!c) continue;
      const d = len3(sub3(a, c.point));
      if (best && !(d < best.d)) continue;
      const w = sub3(c.point, o.pos), h = dot3(w, up);
      const onDisc = Math.abs(Math.abs(h) - hh) < 1e-3;
      const normal = onDisc ? mul3(up, h < 0 ? -1 : 1) : unit3(sub3(w, mul3(up, h)));
      best = { point: c.point.map(f), normal, d };
    }
    for (const o of camBoxes) {                        // FUN_00584408 shape 0 (+0x110 = 0: no margin): half the type's size, its matrix
      if (!o.on) continue;
      const c = boxRay(a, b_, o.half, o.m);
      if (!c) continue;
      const d = len3(sub3(a, c.point));
      if (!best || d < best.d) best = { point: c.point, normal: c.normal, d };
    }
    return best;
  }
  // FUN_00585000 (vt+0x1b4) for the closest hit; it returns 1: the bullet ends on the barrel.
  function bulletHit(h, b) {
    const o = h.o, ty = o.type;
    W.events.push(`bullet hits ${o.id}`);
    if (recFlags(b) & 0x100000) {                                   // FUN_00552ad0: the ricochet sound only
      const r = (b.age > 3.0) ? 0 : W.rng();                       // +0x124 <= 3.0 -> int(r x 256) < 10
      if (b.age > 3.0 || Math.trunc(f(r * 256.0)) < 10) impactSound(ty.mat, h.point);
      return 1;
    }
    // vt+0x2f4 event 0x12: r0 = the owner id (+0x128), r2 = the owner's +0x20 (FUN_0053b978; -1 without)
    ev(o, 0x12, [b.shooter ?? 0, 0, b.shooter ?? -1, 0]);
    if (ty.mat) {
      // FUN_003361b8(hit point, bullet): the hit effect (GUESS: kind 0, the bullet class table; the a2 of this call is
      // not traced) and FUN_0033d528(type +0x0a, int(r x 2) != 0, hit point): one shared-RNG draw, the wall sound
      if (effect && effect.hit) effect.hit(0, (b.cls ?? (b.from && b.from.ai && b.from.ai.W ? b.from.ai.W.cls : 0)) & 3, h.point);
      impactSound(ty.mat, h.point, W.rng());
    }
    const fl = ty.flags;
    if (((fl >> 6) & 1) && !(b.f120 & 4)) return 1;                 // bit 6: only bullets with +0x120 bit 2 (Vincent's) break it
    if (!((fl >> 2) & 1) || o.hp < 1) return 1;
    // damage: FUN_00554738 kind 0 / 1 -> type flag bit 15 ? int(HP / type +0x0b + 0.99) : bullet +0x134;
    // 2 / 3 -> bullet +0x134 != 0 and kind != 3: flag bit 20 ? int(HP / +0x0e + 0.99) : +0x134, else 0
    const k = b.kind | 0;
    let dmg = 0;
    if (k < 2) dmg = ((fl >> 15) & 1) ? Math.trunc(f(f(ty.hp / ty.div_b) + 0.99)) : b.damage | 0;
    else if (k < 4 && (b.damage | 0) !== 0 && k !== 3) dmg = ((fl >> 20) & 1) ? Math.trunc(f(f(ty.hp / ty.div_e) + 0.99)) : b.damage | 0;
    damage(o, dmg);
    return 1;
  }
  // FUN_0033d528(mat, variant, pos) -> FUN_0033d4e8: names 0x46e5f8[0x4a1310[mat] x 3 + variant] (enemy_ai's se tables)
  function impactSound(mat, pos, r = null) {
    const variant = r == null ? 0 : (Math.trunc(f(r * 2.0)) !== 0 ? 1 : 0);
    const kind = W.seName('mat_kind', mat & 0xf);
    const name = kind == null ? null : W.seName('wall', kind * 3 + variant);
    if (name) W.sound(name, pos);
  }
  // FUN_00585bf0 -> vt+0x1ec FUN_00585cd8: HP -= dmg; at <= 0: HP 0, script event 0x17, else event 8 (r0 = dmg).
  // FUN_00583828() == 9 (another game mode) gates: not this stage. The broken-by-Vincent count FUN_005694a0(P, 2)
  // (bullet +0x120 bit 2, sec-15 +0x48 bit 6 clear) is a stat: not on the page.
  function damage(o, dmg) {
    if (!(o.hp > 0)) return;
    const hp = o.hp - dmg;
    W.events.push(`${o.id} hp ${o.hp} -> ${hp < 1 ? 0 : hp}`);
    if (hp < 1) { o.hp = 0; ev(o, 0x17); }
    else { o.hp = hp; ev(o, 8, [dmg, 0, 0, 0]); }
  }

  // ---- the explosion (object type 7, vt 0x5906c0; FUN_00540b90 -> FUN_0057f040)
  function explode(radius, pos, dmg, owner, fx) {
    const e = {
      id: 'x' + (nextExpl++), pos: pos.slice(0, 3).map(f),          // +0x90
      c4: 0xa0, c8: 0, cc: f(EXPL_TIME), d0: 0, d4: f(radius), d8: f(radius * EXPL_GROW), dmg, owner,
      flags: BLAST_FLAGS, kind: 1,                                  // FUN_0057f0e8: +0xc4 bit 10 clear, +0x16b nibble 0 -> 1
      i: 0, count: 0, targets: [], f169: 0, done: false,
    };
    explosions.push(e);
    W.events.push(`explosion ${e.id} r ${radius} dmg ${dmg} at ${e.pos.map(v => +v.toFixed(2)).join(',')}`);
    if (fx) {
      W.sound('bsj_065', e.pos);                                    // FUN_0033d6b0: FUN_0033cc48(0x4a13b8 'bsj_065', pos, 1)
      // FUN_00336280: FUN_003366b8(0x800), FUN_002e7660(flags 5: pos, scale = radius x 0.1)
      const s = f(radius * EXPL_FX_SCALE);
      if (effect && effect.spawn) effect.spawn(EXPL_FX, e.pos.slice(), [s, s, s, 1]);
    }
    return e;
  }
  // the characters and gimmicks the explosion can reach, in the page's order (GUESS: Vincent, the soldiers in activation
  // order, the barrels; the grid order of FUN_0036d400 list 6 is not read)
  function candidates() {
    const P = W.player, out = [];
    if (P) out.push(P);
    for (const a of W.actors) out.push(a);
    for (const o of barrels) out.push(o);
    return out;
  }
  const isProp = t => t && t.kind === PROP_KIND;
  const activeOf = t => t === W.player ? true : isProp(t) ? !!(t.flags28 & 1) && !t.gone : !!(t.flags28 & 1);   // +0x28 bit 0 (Vincent's 0x20901f)
  // vt+0x1c4: Vincent / soldiers FUN_0055e0d8 (enemy_ai blast.filter); a barrel FUN_00585390: +0x114 == -1 and (type
  // flag bit 21 clear or +0xc4 bit 2) -> kind < 2: type flag bit 8, 2 / 3: bit 19
  function filter(t, e) {
    if (!isProp(t)) return W.blast.filter(t, e);
    const fl = t.type.flags;
    if (((fl >> 21) & 1) && !(e.c4 & 4)) return false;
    return e.kind < 2 ? !!((fl >> 8) & 1) : e.kind < 4 ? !!((fl >> 19) & 1) : false;
  }
  // the target's cylinder (FUN_0055bc90 -> FUN_0054b2b0: feet .. feet + up x +0x30, radius +0x2c; a barrel: centre
  // +- row 1 x h / 2, radius type +0x18 (L: FUN_00585dc0 / FUN_00584900 shape 2 read as that cylinder))
  function cylOf(t) {
    if (isProp(t)) {
      const up = t.m[1].slice(0, 3), hh = f(t.h * 0.5);
      return { r: t.r, a: add3(t.pos, mul3(up, hh)), b: add3(t.pos, mul3(up, f(-hh))) };
    }
    const p = t.pos, h = t === W.player ? 18.0 : (t.size ? t.size.h : 18.0), r = t === W.player ? 5.0 : (t.size ? t.size.r : 5.0);
    return { r: f(r), a: p.slice(0, 3), b: [p[0], f(p[1] - h), p[2]] };
  }
  // FUN_0054ae78: +0x40 bit 7 (Vincent, soldiers: 0xf0 / 0x1f0) -> the matrix x (0, +0x30 x 0.5, 0) = the body's middle;
  // else +0x90 (a barrel: +0x40 0x170)
  function targetPoint(t) {
    if (isProp(t)) return t.pos.slice();
    const h = t === W.player ? 18.0 : (t.size ? t.size.h : 18.0);
    return [t.pos[0], f(t.pos[1] - f(h * 0.5)), t.pos[2]];
  }
  const key = t => t === W.player ? 'P' : t.id;
  // FUN_0057ed98, the first update: every candidate active (+0x28 bit 0) with +0x40 bit 5 that passes vt+0x1c4 and is
  // inside its cylinder (vt+0x194) or whose nearest cylinder point (vt+0x3c) is within the radius (+10 with +0xc4 bit 3
  // and the target's +0x28 bit 2: never here). The list keeps its object ids (+0x16c); none -> +0xc4 |= 1.
  function gather(e) {
    for (const t of candidates()) {
      if (e.targets.length >= EXPL_MAX) break;
      if (!activeOf(t)) continue;
      const f40 = isProp(t) ? t.f40 : 0xf0;                         // save RAM: Vincent 0xf0, soldiers 0x1f0 (bit 5 set)
      if (!((f40 >> 5) & 1)) continue;
      if (!filter(t, e)) continue;
      const c = cylOf(t);
      const rad = (e.c4 & 8) && t === W.player ? f(e.d4 + 10.0) : e.d4;
      const hit = insideCylinder(c.r, e.pos, c.a, c.b) || len3(sub3(nearestOnCylinder(c.r, e.pos, c.a, c.b), e.pos)) < rad;
      if (hit) e.targets.push(key(t));
    }
    e.count = e.targets.length;
    if (!e.count) e.c4 |= 1;
    W.events.push(`explosion ${e.id} targets ${e.targets.join(',') || '-'}`);
  }
  const byKey = k => k === 'P' ? W.player : W.objects.get(k) || barrels.find(o => o.id === k) || null;
  // FUN_0057e7d0: one target per update (index +0x168). Still active and listed: the ray from the centre along
  // unit(target point - centre) x radius (stage vt+0x17c, probe 7 / 0xd); a wall more than 10 units in front of the
  // target point blocks it (FUN_0057e6f0: only a material-6 wall reacts, not translated). Else FUN_00541b08 (manager
  // +0x10c0 / +0x10d0 = centre, dir: not read on the page) and the target's vt+0x1cc(target, e, centre, dir).
  function perTarget(e) {
    if (e.count <= e.i) return 0;
    const t = byKey(e.targets[e.i]);
    if (t && activeOf(t) && filter(t, e)) {
      const tp = targetPoint(t);
      const dir = unit3(sub3(tp, e.pos)), to = add3(e.pos, mul3(dir, e.d4));
      let blocked = false;
      if (e.c4 & 0x80) {
        // GUESS: the page's bullet room ray (probe 0x18d) for the explosion's probe 7 / 0xd (FUN_002419d8 picks; not decoded)
        const hit = W.roomRay ? W.roomRay(e.pos, to) : null;
        if (!W.roomRay) warnOnce('props: no room ray: explosions are never blocked by walls');
        if (hit) {
          const dh = len3(sub3(hit, e.pos)), dt = len3(sub3(tp, e.pos));
          if (dh < dt && f(Math.abs(f(dt - dh))) > EXPL_CLEAR) {
            blocked = true;
            if ((((hit.surface | 0) >> 16) & 0xff) === 6) warnOnce('props: explosion on a material-6 wall (FUN_0057e6f0 -> FUN_00550098) not translated');
          }
        }
      }
      W.events.push(`explosion ${e.id} ${blocked ? 'blocked' : 'hits'} ${key(t)}`);
      if (!blocked) {
        if (t === W.player) W.blast.player(e, e.pos.slice(), dir);
        else if (isProp(t)) blastProp(t, e);
        else W.blast.actor(t, e, e.pos.slice(), dir);
      }
    }
    e.i++;
    return 1;
  }
  // FUN_00585448 (a barrel's vt+0x1cc): type flag bit 6 needs +0xc4 bit 2 (an owner with +0x28 bit 2): a barrel's own
  // explosion (owner -1) never breaks another, so z128 has no chain. Else FUN_0057f0e8 kind < 2: +0x12 bit 0 ? int(HP /
  // +0x0c + 0.99) : +0xdc; 2 / 3 as FUN_00585000; FUN_00585bf0; then event 0x15 (r0 = owner, r2 = its id or -1).
  function blastProp(o, e) {
    const ty = o.type, fl = ty.flags;
    if (((fl >> 6) & 1) && !(e.c4 & 4)) return 1;
    if (((fl >> 2) & 1) && o.hp >= 1) {
      let dmg = 0;
      if (e.kind < 2) dmg = (ty.flags12 & 1) ? Math.trunc(f(f(ty.hp / ty.div_c) + 0.99)) : e.dmg;
      else if (e.kind < 4 && e.kind !== 3 && e.dmg) dmg = ((fl >> 20) & 1) ? Math.trunc(f(f(ty.hp / ty.div_e) + 0.99)) : e.dmg;
      damage(o, dmg);
    }
    ev(o, 0x15, [e.owner, 0, -1, 0]);
    return 0;
  }
  // FUN_0057e638 (vt+0x214), once a frame: the first update gathers; the radius grows by +0xd8 up to +0xd4; the clock
  // +0xc8 += step; no target left -> FUN_0057ebb8 (one sphere ray a frame, 32 directions: only material-6 walls react,
  // not translated); at +0xcc (60) FUN_0053fa08 removes it.
  function update(step) {
    for (const o of barrels) if (o.barrier) barrierFrame(o);           // worker 0269: vt+0x214 FUN_0054f4b0 (the hum)
    for (const e of explosions.slice()) {
      if (!(e.c4 & 0x100)) { gather(e); e.c4 |= 0x100; }
      e.d0 = rz(e.d0 + e.d8);
      e.c8 = rz(e.c8 + f(step));
      if (e.d4 < e.d0) e.d0 = e.d4;
      if (!perTarget(e)) warnOnce('props: explosion sphere rays (FUN_0057ebb8, material-6 walls only) not translated');
      if (e.cc <= e.c8) { e.done = true; explosions.splice(explosions.indexOf(e), 1); W.events.push(`explosion ${e.id} ends`); }
    }
  }

  // The barrels for the lock-on (lock_on.js; the game locks them: T w209_barrel, P+0x2b0 = record 17's +0x90 at the
  // shot). vt+0x5c = FUN_0054b6a8 -> FUN_0054ae78: +0x90 (the centre); lockable = vt+0x204 FUN_0054b910: +0x38 bit 2 and
  // not +0x28 bit 0x400000; probe bits = +0x38. FUN_00584408 mode 2: the centre within 1.5 x +0x2c (the bound radius,
  // |(r, h/2)| = 9.30 in RAM) of the ray, on screen, line of sight to the centre; modes 1 / 0: the shape cylinder. Its
  // vt+0x8c (FUN_0054eb80, L: no actor) leaves the probe's radius term out (dR 0).
  function lockTargets() {
    const out = [];
    for (const o of barrels) {
      if (!(o.flags28 & 1) || o.gone || o.barrier) continue;          // a barrier: +0x38 bit 2 clear, never lockable
      const up = o.m[1].slice(0, 3), hh = f(o.h * 0.5);
      out.push({ id: o.id, alive: true, lockable: !!(o.f38 & 4) && !(o.flags28 & 0x400000), probeBits: o.f38,
                 point: o.pos.slice(), losPoint: o.pos.slice(), feet: o.pos.slice(), height: o.h, radius: o.r,
                 r2: f(Math.sqrt(f(f(o.r * o.r) + f(hh * hh)))), cylR: o.r, cylA: add3(o.pos, mul3(up, hh)), cylB: add3(o.pos, mul3(up, f(-hh))), dR: 0 });
    }
    return out;
  }

  return {
    barrels, camBoxes, explosions, attach, areaSwitch, update, mgr, cmd, bulletTest, bulletHit, cameraProbe, nodeBoxes, lockTargets, deleted,
    blockers, vt294,
    id: k => (byRec.has(k) ? byRec.get(k).id : -1),
    get world() { return W; }, get mgr260() { return W ? W.mgr260 : null; },
    t: { boxRay, nearestOnCylinder, insideCylinder, gather, perTarget, explode, damage, bulletFilter, filter },
  };
}
