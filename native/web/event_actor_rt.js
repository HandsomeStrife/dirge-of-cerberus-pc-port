// event_actor_rt.js -- the event's actors: the KerberosActor natives and the per-frame actor update (worker 0218;
// notes/event-vm-research.md "Event actors"). Translated from the game (PAL SLES_541.85); no three.js here (the
// drawing is event_actors.js), so node tests can run it.
//
// The game keeps 64 actor slots of 0x200 at event +0x1800 (FUN_00376308 fills one; FUN_0037a600 finds a slot by its
// id at +0x18). Fields used here:
//   +0x00 / +0x08  clip name (8 bytes, FUN_00258590) of a pending motion request; 0 = none
//   +0x1c          the motion player (MP)
//   +0x20..+0x5c   the actor matrix, rows (axis 0, axis 1, axis 2, position); FUN_005a6f40 copies it to the MP
//   +0xa8          flags: bit 48 loop (request flags | 1), bit 49 visible (FUN_005a85f8 0 / 2), bit 52 clip
//                  (MP+0x428 bit 1). FUN_00376308 sets bits 49 and 52 (visible, clipped)
//   +0xb0          request flags 0x82, or 0x86
//   +0xb4          the start frame x 2 (FUN_005a90f8 after the request), -1 = none
//   +0xbc          the request's blend frames (FUN_005a91c8 param_3)
//   +0xc0..+0xcc   attached actors (4), +0x1e5.. their markers
//   +0xdc          a new speed (MP+0x40c = speed x 0.5), 0 = none
//   +0x1e4         LOD (setLOD_l; MP+0x44d)
// Milliseconds -> frames: FUN_003787e8 = (int)(ms x 0.06) (FUN_003787d0).
//
// Per frame the main loop (FUN_00248110) draws the motion players (FUN_005a8e28: pose, then FUN_005aa2a8's advance)
// before the event actor update (FUN_00247428 -> FUN_003772c8), so a request made in a frame's VM window shows in the
// next frame's draw. EventActors.draw() / .update() keep that order (event_actors.js calls them).

const f32 = Math.fround;
const STEP = 1.1999999284744263;      // DAT_004eeb24: ticks per frame (player.js STEP; not imported: player.js needs three)

// FUN_005aa2a8's sums round toward zero on the PS2 FPU (enemy_ai.js chop, the same code; not imported for the same reason)
const _cb = new DataView(new ArrayBuffer(4));
export function rz(x) {
  const r = Math.fround(x);
  if (!(Math.abs(r) > Math.abs(x))) return r;
  _cb.setFloat32(0, r); _cb.setInt32(0, _cb.getInt32(0) - 1);
  return _cb.getFloat32(0);
}

export const msToFrames = (ms) => Math.trunc(f32(f32(ms) * f32(0.06)));     // FUN_003787e8 / FUN_003787d0

const IDENT = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

// rotation matrices, the game's row layout (FUN_00259928 x, FUN_00259990 y, FUN_002599f8 z; sin FUN_0045b530,
// cos FUN_0045b428)
export function rotX(a) { const c = f32(Math.cos(a)), s = f32(Math.sin(a)); const m = IDENT(); m[5] = c; m[6] = s; m[9] = -s; m[10] = c; return m; }
export function rotY(a) { const c = f32(Math.cos(a)), s = f32(Math.sin(a)); const m = IDENT(); m[0] = c; m[2] = -s; m[8] = s; m[10] = c; return m; }
export function rotZ(a) { const c = f32(Math.cos(a)), s = f32(Math.sin(a)); const m = IDENT(); m[0] = c; m[1] = s; m[4] = -s; m[5] = c; return m; }
// FUN_0026125c(out, A, B): out row i = sum_k B[i][k] A[k] (= B x A, row vectors)
export function mul(A, B) {
  const o = new Array(16);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += B[i * 4 + k] * A[k * 4 + j];
    o[i * 4 + j] = f32(s);
  }
  return o;
}

// FUN_00262de0: quaternion -> rows 0-2 (12 values; VU macro words at 0x262e24..: q*q, opmula / opmsub = (yz, zx, xy), q.xyz * w; rows vf13, vf14, vf15)
export function quatRows(x, y, z, w) {
  const m = (u, v) => f32(u * v), xx = m(x, x), yy = m(y, y), zz = m(z, z), yz = m(y, z), zx = m(z, x), xy = m(x, y), xw = m(x, w), yw = m(y, w), zw = m(z, w);
  const d = (v) => f32(2 * f32(v));
  return [f32(1 - d(yy + zz)), d(xy + zw), d(zx - yw), 0,
    d(xy - zw), f32(1 - d(xx + zz)), d(yz + xw), 0,
    d(zx + yw), d(yz - xw), f32(1 - d(xx + yy)), 0];
}

// FUN_00383d10(out, M, next): v = row 3 - next with y 0; row 0 = row 1 x v, row 2 = row 0 x row 1, row 1 = row 2 x row 0, each normalized (VU words at 0x383d10); row 3 kept
export function lookRows(M, next) {
  const cross = (a, b) => [f32(f32(a[1] * b[2]) - f32(b[1] * a[2])), f32(f32(a[2] * b[0]) - f32(b[2] * a[0])), f32(f32(a[0] * b[1]) - f32(b[0] * a[1]))];
  const norm = (a) => { const q = f32(1 / f32(Math.sqrt(f32(f32(f32(a[0] * a[0]) + f32(a[1] * a[1])) + f32(a[2] * a[2]))))); return a.map(x => f32(x * q)); };
  const v = [f32(M[12] - next[0]), 0, f32(M[14] - next[2])];
  const r0 = cross([M[4], M[5], M[6]], v), r2 = cross(r0, [M[4], M[5], M[6]]), r1 = cross(r2, r0);
  const a = norm(r0), b = norm(r1), c = norm(r2);
  return [a[0], a[1], a[2], 0, b[0], b[1], b[2], 0, c[0], c[1], c[2], 0];
}

// ---- texture animations (worker 0248): the model's texanm.tad (export_web_event_actors.py texanims), the faces'
// eyes / mouths. MP+0x400 = one 0x10 entry per animation, MP+0x404 the count:
//   +1 on (bit 0)   +2 frames   +4 frame (f32)   +8 wait (f32)   +0xc / +0xe the wait range (s16)
// FUN_005a8850 (the MP set-up): frame / wait 0, the range and frames from the animation, on when its name starts '@'.
export function texAnimSetup(anims) {
  return (anims || []).map(an => ({ on: an.name[0] === '@' ? 1 : 0, frames: an.frames, frame: 0, wait: 0, wmin: an.wait[0], wmax: an.wait[1] }));
}
// FUN_00414210(list, i, name): the animation's name begins with `name` (up to 8 characters; '' matches every one)
export const texAnimMatch = (an, name) => an.name.slice(0, Math.min(8, name.length)) === name.slice(0, 8);
// FUN_00414290: the key that frame f (the (int) of +4, a short) shows: k with key[k - 1].t <= f < key[k].t, key 0
// before the first key's end and again from the last key's end on (the loop's exit with k reset)
export function texAnimKey(keys, f) {
  const n = keys.length;
  let k = 0;
  if (0 < n) {
    if (-1 < f && f < keys[0][2]) k = 0;
    else {
      let j = 0;
      for (;;) {
        const prev = keys[j][2];
        j++; k = 0;
        if (n <= j) break;
        if (f < prev) continue;
        k = j;
        if (!(keys[j][2] <= f)) break;
      }
    }
  }
  if (n <= k) k = n - 1;
  return k;
}
// FUN_005aa838 (after FUN_005aa9e8's copies, in the MP's draw FUN_005a9938): per animation that is on, a wait runs
// down first (to 0, that frame no advance); else frame += DAT_004fc7e8 (1.2; 0 while DAT_004fc7e4 == 1, the pause:
// the page does not draw a paused event) and at (int)frame >= frames: wait = min + (max - min) x FUN_0040b5c0() when
// max >= 1 (not below 0), frame = 0
export function texAnimAdvance(tex, rand) {
  for (const e of tex) {
    if (!(e.on & 1)) continue;
    const dt = STEP;
    if (0 < e.wait) {
      e.wait = f32(e.wait - dt);
      if (e.wait < 0) e.wait = 0;
      continue;
    }
    e.frame = f32(e.frame + dt);
    if (Math.trunc(e.frame) < e.frames) continue;
    if (0 < e.wmax) {
      const lo = f32(e.wmin);
      e.wait = f32(lo + f32(f32(f32(e.wmax) - lo) * f32(rand())));
      if (e.wait < 0) e.wait = 0;
    }
    e.frame = 0;
  }
}

const lateFile = (n) => /^r[0-9a-f]+$/.test(n) && parseInt(n.slice(1), 16) >= 0xe;
export const LOAD_CMD = 0x7e;                         // page only: no such command type in FUN_00377c68

export class EventActors {
  // clipFrames(model, n, clip) -> frame count of `clip` in event motion file n for that model, or null (no pack)
  // texAnims(model) -> the model's texanm animations (export_web_event_actors.py texanims), or null (worker 0248)
  // rand: FUN_0040b5c0 (the game's shared Mersenne twister, enemy_ai.js GameRandom)
  // residentFiles(model) -> the character's own motion packs (export 'rK' keys), searched before its loadmotion files
  constructor({ clipFrames, texAnims = null, rand = null, residentFiles = null, warn = (m) => console.warn(m) } = {}) {
    this.clipFrames = clipFrames || (() => null);
    this.residentFiles = residentFiles || (() => []);
    this.texAnims = texAnims || (() => null);
    this.rand = rand || (() => { this.warnOnce('rand', 'event actors: no FUN_0040b5c0 source given: the texture animations\' waits use 0.5'); return 0.5; });
    this.warn = warn;
    this.warned = new Set();
    this.charMask = new Map();         // model -> loadchr's motion set mask (loadchr_static_l)
    this.slots = [];                   // live actors in slot order (FUN_00376308 takes the first free of 64)
    // the event light set (KerberosLight -> struct 0x4fc7d0: directions +0x630 + 0x10 i, colours +0x6a0 + 0x10 i,
    // ambient +0x6d0; FUN_0040c988 commits them to the fixed rig +0x580.. and sets DAT_004fcaf8 bit 36 from bit 37,
    // which the setters raise; FUN_005ab0b0 then lights every MP with it: lights 0 / 1 and the ambient, light 2 stays
    // the room light). null = not set (the env rig, as gameplay)
    this.lights = null;
    this.log = [];
  }

  warnOnce(k, m) { if (!this.warned.has(k)) { this.warned.add(k); this.warn(m); } }

  get(id) { return id ? this.slots.find(a => a.id === id) || null : null; }   // FUN_0037a600 (id 0: none)

  // FUN_00380370 -> FUN_00376308: a new slot for character `model` with id `id`
  create(model, id) {
    if (this.slots.length >= 64) { this.warn('event actors: all 64 slots busy'); return null; }
    const a = {
      id, model, M: IDENT(),
      loop: false, visible: true, clip: true,            // +0xa8 bits 48 / 49 / 52 (FUN_00376308: 49, 52)
      code: null, flags: 0x82, start: -1, blend: 0, speed: 0, lod: 5,
      kids: [null, null, null, null], markers: [0, 0, 0, 0], kidsDirty: false,
      // loadmotion_l, in load order, after the character's resident motion files (worker 0248: the model's own sets,
      // loaded with the character; FUN_005a7390 searches them all, the names are unique)
      files: (this.residentFiles(model) || []).filter(n => !lateFile(n)),
      // worker 0261: FUN_005a7390's first list holds the sets the character was loaded with. m004 up (k >= 0xe) come from a named loadchr (beast_ev02's loadchr("p000", 7) -> k 0x11, bv011vn): gated on its mask (findClip)
      late: (this.residentFiles(model) || []).filter(lateFile),
      mp: { clip: null, frame: 0, rate: 0.5, loop: false, count: 0, kids: [null, null, null, null], marker: [0, 0, 0, 0] },
      shown: true, frameDrawn: 0, clipDrawn: null,
      anim: null, animOn: false,                          // +0x10 the setanim name, +0xa8 bits 53 (start) / 54 (stop)
      partMask: 0,                                        // MP+0x180 (hide_model_l)
    };
    a.mp.tex = texAnimSetup(this.texAnims(model));        // FUN_005a8850: MP+0x400 / +0x404 (worker 0248)
    this.slots.push(a);
    return a;
  }

  // a page load as a command: done when its promise is (event_rt.js / stage_controller.js frame: type LOAD_CMD)
  loading(R, p) {
    if (!p) return 0;
    const h = R.cmd(LOAD_CMD, { done: false });
    const c = R.slots[R.slots.length - 1];
    p.then(() => { c.done = true; });
    return h;
  }

  rig() { return this.lights ??= { dir: [[0, 0, 0], [0, 0, 0], [0, 0, 0]], col: [[0, 0, 0], [0, 0, 0], [0, 0, 0]], amb: [0, 0, 0] }; }

  // FUN_005a7390: the clip by name among the actor's motion files (load order)
  findClip(a, name) {
    // the character's sets, then the event files. loadchr's mask (bit k - 0xa) -> FUN_00409460 -> FUN_0030bf90; k < 0xe aren't gated: the stage's own loads of them aren't all in the scripts
    const mask = this.charMask.get(a.model) ?? 0, res = a.files.filter(n => typeof n === 'string');
    const order = [...res, ...a.late.filter(n => (mask >>> (parseInt(n.slice(1), 16) - 0xa)) & 1), ...a.files.filter(n => typeof n !== 'string')];
    for (const n of order) { const nf = this.clipFrames(a.model, n, name); if (nf != null) return { n, nf }; }
    return null;
  }

  // FUN_005a91c8 (blend 0 path): flags & 2 -> the new layer is the head at once; a request with flags & 0x80 is
  // dropped while the top layer already plays that clip
  request(a, name, blend, flags) {
    const mp = a.mp, hit = this.findClip(a, name);
    if (!hit) { this.warnOnce('clip ' + a.model + name, `event actor ${a.id} (${a.model}): clip ${name} not loaded / not exported (left as it was)`); return false; }
    if (mp.count > 0 && (flags & 0x80) && mp.clip === name) return false;
    if (blend) this.warnOnce('blend', 'event actors: a blended motion request (FUN_005a91c8 param_3 != 0) is played without the blend');
    mp.clip = name; mp.n = hit.nf; mp.frame = 0; mp.loop = !!(flags & 1); mp.count = 1; mp.flags = flags;
    mp.req = (mp.req || 0) + 1;                                        // FUN_005a95f0 runs for each (the cape's window: event_actors.js)
    return true;
  }

  // FUN_005a90f8 -> FUN_005a8fd0(x): head frame = min(max(x, 0), 2 n - 1) x 0.5
  setFrame(a, x) {
    const mp = a.mp;
    if (!mp.clip) return;
    let v = f32(x);
    const top = f32(mp.n * 2 - 1);
    if (top < v) v = top;
    if (v < 0) v = 0;
    mp.frame = f32(v * 0.5);
  }

  // the motion players' draw step (FUN_005a8e28): pose at the head frame, then FUN_005aa2a8's advance
  // (frame += rate x step, toward zero; looped: 0 at n, else held at n - 1; enemies.js advance)
  draw(pose) {
    for (const a of this.slots) {
      const mp = a.mp;
      // what this draw shows: the MP as the LAST update left it (matrix FUN_005a6f40, visibility FUN_005a85f8, attached
      // MPs FUN_005a7698), posed at the head frame. A slot whose MP was never updated has no matrix from the actor yet:
      // not placed (its fresh MP matrix is not read)
      a.drawn = mp.M ? { M: mp.M, shown: a.shown, kids: mp.kids.slice(), marker: mp.marker.slice(), clip: mp.clip, frame: mp.frame } : null;
      // FUN_005abec0 (a shown MP's draw; FUN_005a85f8(MP, 2) = +0x440 & 0xf00 0x200 skips it) -> FUN_005a9938: the
      // texture animations' copies (FUN_005aa9e8: on, wait 0 -> FUN_00414290 at frame (int)+4), then the advance
      // FUN_005aa838 (worker 0248)
      if (a.drawn) {
        a.drawn.tex = [];
        if (a.drawn.shown && mp.tex.length) {
          mp.tex.forEach((e, i) => { if ((e.on & 1) && e.wait === 0) a.drawn.tex.push([i, Math.trunc(e.frame) << 16 >> 16]); });
          texAnimAdvance(mp.tex, this.rand);
        }
      }
      if (pose) pose(a);
      a.frameDrawn = mp.frame; a.clipDrawn = mp.clip;
      if (!mp.clip) continue;
      mp.frame = rz(mp.frame + rz(rz(mp.rate * 1.0) * STEP));
      if (mp.loop) { if (mp.n <= mp.frame) mp.frame = 0; }
      else if (mp.n - 1 <= mp.frame) mp.frame = mp.n - 1;
    }
  }

  // FUN_003772c8: per live actor with a motion player
  update() {
    for (const a of this.slots) {
      a.shown = a.visible;                                             // +0xa8 bit 49 -> FUN_005a85f8(MP, 0 / 2)
      // +0xa8 bits 53 / 54 (setanim_l, worker 0248): start -> FUN_005aab10 (on = 1), stop -> FUN_005aabf8 (on = 0) for
      // each of the model's animations whose name begins with +0x10 (FUN_00414210); then both bits cleared
      if (a.anim !== null) {
        const list = this.texAnims(a.model) || [];
        list.forEach((an, i) => { if (texAnimMatch(an, a.anim) && a.mp.tex[i]) a.mp.tex[i].on = a.animOn ? 1 : 0; });
        a.anim = null;
      }
      if (a.kidsDirty) {                                               // FUN_003771e0: bind the attached MPs
        for (let i = 0; i < 4; i++) { a.mp.kids[i] = a.kids[i]; a.mp.marker[i] = a.markers[i]; }
        a.kidsDirty = false;
      }
      if (a.code) {                                                    // +0xd0 < 0: the clip request
        const fl = a.flags | (a.loop ? 1 : 0);
        this.request(a, a.code, a.blend, fl);
        for (const k of a.mp.kids) { const c = this.get(k); if (c && this.findClip(c, a.code)) this.request(c, a.code, a.blend, fl | 2); }
        if (a.start >= 0) { this.setFrame(a, a.start); a.start = -1; }
        a.code = null;
      }
      if (a.speed !== 0) { a.mp.rate = f32(a.speed * 0.5); a.speed = 0; }   // +0xdc -> MP+0x40c
      a.mp.M = a.M.slice();                                            // FUN_005a6f40(MP, actor + 0x20)
    }
  }

  // case 0xc (FUN_00377c68; worker 0263): the walk. The clip once, +0xb0 = 0x86, bit 48 set; s = (clock - start) x speed; while s < L (or +0x156c == 2) row 3 = the line at s,
  // rows 0-2 = FUN_00383d10 toward the line at s + 1; at the end the end clip (blend, bit 48 from the loop flag, flags 0x86 / 0x82)
  walk(c, R) {
    const a = this.get(c.id);
    if (!a) return false;                                              // FUN_0037a600 == 0 -> LAB_00378678: the slot stays, its handle stays busy
    if (c.clip) { a.code = c.clip; a.blend = c.blend; a.start = -1; c.clip = null; }
    a.flags = 0x86; a.loop = true;
    const el = R.clock < c.start ? 0 : (R.clock - c.start) >>> 0;
    const s = f32(f32(el) * c.speed);
    const at = (v) => { const t = c.L > 0 ? Math.min(f32(v / c.L), 1) : 1; return [0, 1, 2].map(k => f32(c.p[k] + f32(f32(c.q[k] - c.p[k]) * t))); };
    if (s < c.L || R.skip === 2) {
      const P = at(s);
      a.M[12] = P[0]; a.M[13] = P[1]; a.M[14] = P[2];
      const rows = lookRows(a.M, at(f32(s + 1)));
      for (let i = 0; i < 12; i++) a.M[i] = rows[i];
    }
    if (s < c.L && R.skip !== 2) return false;
    if (c.end) { a.blend = c.blend; a.code = c.end; a.loop = c.loop; a.flags = c.hold ? 0x86 : 0x82; a.start = -1; }
    return true;
  }

  // case 0x22 (FUN_00382768), a slot command until true: first run waits for +0x34's command, +0x38 becomes an end time, FUN_0037af40 makes the request
  // (+0xb4 = start frames x 2, bit 48 = loop, flags 0x86 / 0x82), +0x30 = the update count +0x10. Under Skip it ends at once unless started this update
  chain(c, R) {
    if (c.n === 0) {
      if (c.prev > 0 && R.busy(c.prev)) return false;
      c.until = (c.until + R.clock) >>> 0;
      const a = this.get(c.id);
      if (a) { a.code = c.name; a.loop = c.loop; a.flags = c.hold ? 0x86 : 0x82; a.blend = c.blend; a.start = c.startF * 2; }
      c.at = R.frameNo;
      c.n = 1;
      this.log.push([R.frameNo, 'chain ' + c.id + ' ' + c.name]);
    }
    if (R.skip !== 0 && R.frameNo !== c.at) return true;
    return c.until <= R.clock;
  }

  // one game frame after the event update (FUN_00377c68): the MP draw (FUN_005a8e28), then FUN_003772c8
  step(pose) { this.draw(pose); this.update(); }

  natives(R) {
    const T = this, A = (id) => T.get(id);
    const str = (s) => (s == null ? null : String(s));
    const N = {
      // load_l(name, id, f) (FUN_0039e2f0 -> FUN_00379c68): command 9 (disc load) or, resident, FUN_00380370 at once.
      // The page's models are resident (preloaded): at once; the handle 0 is never busy (event_rt.js 'event loads')
      // the handle is busy until the page has the model (event_actors.js loadEventActors: T.ensure; none = resident, as the tests)
      'fake/KerberosActor.load_l(Ljava/lang/String;II)I': (vm, [name, id]) => { T.create(str(name), id); T.log.push([R.frameNo, 'load ' + name + ' ' + id]); return R.skip !== 0 && (R.skipMode & 2) ? 0 : T.loading(R, T.ensure && T.ensure(str(name))); },   // FUN_003837d0: under Skip with mode bit 1 the load is passed by
      // loadchr_static_l / loadchrs / unloadchr: character data loads (no actor); resident on the page
      'fake/KerberosActor.loadchr_static_l(Ljava/lang/String;Ljava/lang/String;I)I': (vm, [name, , mask]) => { T.charMask.set(str(name), mask | 0); return 0; },
      'fake/KerberosActor.loadchrs(I)I': () => 0,
      'fake/KerberosActor.unloadchr(Ljava/lang/String;)V': (vm, [name]) => { T.charMask.delete(str(name)); },
      // loadmotion_l(id, n) (FUN_003a13a8 -> FUN_0037b368: command 0x12 -> FUN_00382220): event motion file
      // FUN_00250898(n, event) = 0x0c000400 + event x 0x1000 + n for the actor's MP; at once on the page
      'fake/KerberosActor.loadmotion_l(II)I': (vm, [id, n]) => { if (R.skip === 2 && (R.skipMode & 1)) return 0;   /* FUN_00382220: passed by */ const a = A(id); if (a && !a.files.includes(n)) a.files.push(n); T.log.push([R.frameNo, 'loadmotion ' + id + ' ' + n]); return T.loading(R, a && T.ensurePack && Promise.all([T.ensure(a.model), T.ensurePack(a.model, n)])); },   // the model and the pack
      // unload_residentmotion_l(name, n) (FUN_003a1410 -> FUN_0037b3b0: FUN_0030dac8 on the character's data, FUN_0030dc28): frees a character's resident motion file. Nothing on the page: the library stays (worker 0262)
      'fake/KerberosActor.unload_residentmotion_l(Ljava/lang/String;I)V': () => {},
      'fake/KerberosActor.unloadmotion_l(II)I': (vm, [id, n]) => { const a = A(id); if (a) a.files = a.files.filter(x => x !== n); return 0; },
      // unload_l (FUN_0039eec0 -> FUN_0037e990: the character data); finalize_l (FUN_003a3410 -> FUN_00376c80: the slot)
      'fake/KerberosActor.unload_l(I)V': () => {},
      'fake/KerberosActor.finalize_l(I)V': (vm, [id]) => {
        const i = T.slots.findIndex(a => a.id === id);
        if (i >= 0) T.slots.splice(i, 1);
        T.log.push([R.frameNo, 'finalize ' + id]);
      },
      // setpos_l (FUN_0039d170 -> FUN_0037abf8): matrix row 3 (+0x50); +0x1e8 |= 0x200
      'fake/KerberosActor.setpos_l(IFFF)V': (vm, [id, x, y, z]) => { const a = A(id); if (a) { a.M[12] = x; a.M[13] = y; a.M[14] = z; } },
      // setrot_l (FUN_0039f2b0 -> FUN_0037ba58 -> FUN_00381070): degrees x 0.017453292 (0x3c8efa36);
      // FUN_00259bd0: rows 0-2 = rotX(x) x rotY(y) x rotZ(z) (row vectors: x applied first), row 3 kept
      'fake/KerberosActor.setrot_l(IFFF)V': (vm, [id, x, y, z]) => {
        const a = A(id); if (!a) return;
        const k = f32(0.017453292);
        const m = mul(rotZ(f32(z * k)), mul(rotY(f32(y * k)), rotX(f32(x * k))));   // (X x Y) x Z: FUN_0026125c(out, Y, X), then (out, Z, out)
        for (let i = 0; i < 12; i++) a.M[i] = m[i];
      },
      // setdirrot_l(id, deg, add) (FUN_0039f3b0): add == 0 -> deg + 180 (wrapped to -180..180); FUN_0037be70:
      // rotY(deg x 0.017453294) (FUN_00259990) -> rows 0-2 (add: FUN_002612d0 composes it with the old rows)
      'fake/KerberosActor.setdirrot_l(IIZ)V': (vm, [id, deg, add]) => {
        const a = A(id); if (!a) return;
        let d = deg;
        if (!add) { d = deg + 180; if (180 < deg + 180) d = deg - 180; }
        if (180 < d) d -= 360;
        const m = rotY(f32(d * f32(0.017453294)));
        if (add) { T.warnOnce('dirrot add', 'event actors: setdirrot_l with add (FUN_002612d0) not translated'); return; }
        for (let i = 0; i < 12; i++) a.M[i] = m[i];
      },
      // attach_l(parent, child, marker, i) (FUN_003a1328 -> FUN_00376700 -> FUN_003814c8): parent +0xc0 + 4i = child,
      // +0x1e5 + i = marker (i > 3 -> 0); +0x1e8 |= 0x100 -> FUN_003771e0 binds the MPs (FUN_005a7698)
      'fake/KerberosActor.attach_l(IIII)V': (vm, [p, c, marker, i]) => {
        const a = A(p), b = A(c); if (!a || !b) return;
        const k = (i >>> 0) > 3 ? 0 : i;
        a.kids[k] = c; a.markers[k] = marker & 0xff; a.kidsDirty = true;
      },
      // detach_l(parent, marker, i) (FUN_003a12c0 -> FUN_003767a0 -> FUN_003814a0(parent, i))
      'fake/KerberosActor.detach_l(III)V': (vm, [p, , i]) => { const a = A(p); if (a) { a.kids[(i >>> 0) > 3 ? 0 : i] = null; a.kidsDirty = true; } },
      // setanim_l(id, name, on) (FUN_0039cfe0 -> FUN_00376510 -> FUN_00381168): +0x10 = the name (8 bytes,
      // FUN_00258590), +0xa8 bit 53 (on: startanim) or bit 54 (off: stopanim), the other cleared (worker 0248)
      'fake/KerberosActor.setanim_l(ILjava/lang/String;Z)V': (vm, [id, name, on]) => {
        const a = A(id); if (!a) return;
        a.anim = (str(name) || '').slice(0, 8); a.animOn = !!on;
        T.log.push([R.frameNo, 'setanim ' + id + ' ' + a.anim + ' ' + (a.animOn ? 1 : 0)]);
      },
      // ---- Vincent's (worker 0248; rv_matiawase)
      // getmorphstate (FUN_0039d090 -> FUN_003766a8 -> FUN_00321460): DAT_0046e248 +0xc. T: 0 in the route state
      // r02_climb (no morph; the page has none)
      'fake/KerberosActor.getmorphstate()I': () => 0,
      // getweaponframe (FUN_003a3330 -> FUN_00376618 -> FUN_00312478): DAT_0046dd68 +0x80, 0 read as 1. T: 1 in
      // r02_climb (the handgun frame Cerberus, the page's only weapon)
      'fake/KerberosActor.getweaponframe()I': () => (T.weaponFrame ? T.weaponFrame() : 1) || 1,
      // loadVincentWeapon_l(id) (FUN_0039e060 -> FUN_00379af8): FUN_004099b0(FUN_00312478(), FUN_00312498(), 0, 0)
      // builds the weapon's model, FUN_00376308 a slot with it, the slot matrix = the model's (+0x10..+0x4c). The page's
      // weapon model is the gun mesh (gun.js), model name 'weapon'; its matrix: identity (a new model's, GUESS)
      'fake/KerberosActor.loadVincentWeapon_l(I)V': (vm, [id]) => { T.create('weapon', id); T.log.push([R.frameNo, 'loadVincentWeapon ' + id]); },
      // setVisible_l (FUN_003a3478 -> FUN_0037ede8): +0xa8 bit 49; setClip_l (FUN_003a3518 -> FUN_0037ef08): bit 52
      'fake/KerberosActor.setVisible_l(IZ)V': (vm, [id, v]) => { const a = A(id); if (a) a.visible = !!v; },
      // set_footnoise_l(id, b) (FUN_0039e2a0 -> FUN_0037ed60): the slot's MP +0x428 bit 3 (set b != 0, else clear), the gate of
      // the MP's footfall sounds (FUN_005ae828 / FUN_005ae738). An event-loaded model starts with it clear (FUN_00380370); a lent
      // actor keeps its gameplay MP's. Kept on the slot (a.footnoise); the page plays no event actor's footfalls, so the stage's
      // only use (help_orei04: off for three actors) changes nothing heard (worker 0266)
      'fake/KerberosActor.set_footnoise_l(IZ)V': (vm, [id, b]) => { const a = A(id); if (a) a.footnoise = !!b; },
      // hide_model_l(id, n, b) (FUN_003a11d0 -> FUN_0037aa20(ev, id, n, -1, b)): MP+0x180 bit n set (b 0) / clear (b != 0);
      // FUN_005b2ef8 skips the model's smd list entry n while its bit is set (worker 0261; event_actors.js applyMask)
      'fake/KerberosActor.hide_model_l(IIZ)V': (vm, [id, n, b]) => {
        const a = A(id); if (!a || a.lent) return;
        const bit = (1 << (n & 31)) >>> 0;
        a.partMask = (b ? (a.partMask & ~bit) : (a.partMask | bit)) >>> 0;
      },
      'fake/KerberosActor.setClip_l(IZ)V': (vm, [id, v]) => { const a = A(id); if (a) a.clip = !!v; },
      // setmotionspeed_l (FUN_0039d1f0 -> FUN_0037be10): +0xdc
      'fake/KerberosActor.setmotionspeed_l(IF)V': (vm, [id, s]) => { const a = A(id); if (a) a.speed = f32(s); },
      // setmotion_l(id, name, loop, blendMs, hold) (FUN_0039f460 -> FUN_0037ad78 -> FUN_003811d8): only a new clip;
      // bit 48 = loop, flags 0x86 if hold else 0x82, +0xbc = blend frames
      'fake/KerberosActor.setmotion_l(ILjava/lang/String;ZFZ)V': (vm, [id, name, loop, ms, z]) => {
        const a = A(id); if (!a) return;
        const nm = str(name);
        if (a.code === nm) return;                                    // *param_1 != param_2: a still-pending request
        a.code = nm; a.loop = !!loop; a.flags = z ? 0x86 : 0x82; a.blend = msToFrames(ms);
      },
      // setmotion2_l(id, name, blendMs, startMs, hold) (FUN_0039f6d0 -> FUN_0037af40): bit 48 cleared, +0xbc blend,
      // +0xb4 = start frames x 2, flags 0x86 / 0x82
      'fake/KerberosActor.setmotion2_l(ILjava/lang/String;FFZ)V': (vm, [id, name, ms, startMs, z]) => {
        const a = A(id); if (!a) return;
        const nm = str(name);
        a.code = nm; a.loop = false; a.flags = z ? 0x86 : 0x82; a.blend = msToFrames(ms); a.start = msToFrames(startMs) * 2;
      },
      // setmotion3_l(id, name, blendMs, hold) (FUN_0039f630 -> FUN_0037ae10 -> FUN_00381268): bit 48 cleared
      'fake/KerberosActor.setmotion3_l(ILjava/lang/String;FZ)V': (vm, [id, name, ms, z]) => {
        const a = A(id); if (!a) return;
        const nm = str(name);
        a.code = nm; a.loop = false; a.flags = z ? 0x86 : 0x82; a.blend = msToFrames(ms);
      },
      // move_l(x, y, z, clip, blendMs, id, speed, z1, hold, endClip, loop) (FUN_0039eef8 -> FUN_0037b5b0): command 0xc, a straight walk from the actor's position (+0x50).
      // Knots 0, L; L = FUN_00383be0's distance (5 steps of 0.2 over the two points) x 0.1. z1 is not stored
      'fake/KerberosActor.move_l(FFFLjava/lang/String;FIFZZLjava/lang/String;Z)I': (vm, [x, y, z, clip, blendMs, id, speed, z1, hold, end, loop]) => {
        const a = A(id), p = a ? [a.M[12], a.M[13], a.M[14]] : [0, 0, 0];
        const q = [f32(x), f32(y), f32(z)];
        let L = 0, u = 0, pr = p;
        for (let i = 0; i < 5; i++) { u = f32(u + 0.2); const n = [0, 1, 2].map(k => f32(p[k] + f32(f32(q[k] - p[k]) * u))); L = f32(L + f32(Math.hypot(pr[0] - n[0], pr[1] - n[1], pr[2] - n[2]))); pr = n; }
        return R.cmd(0xc, { id, p, q, L: f32(L * f32(0.1)), speed: f32(speed), start: R.clock, clip: str(clip), end: end == null ? null : str(end), blend: msToFrames(blendMs), hold: !!hold, loop: !!loop });
      },
      // setmotion4_l(id, name, blendMs, startMs, durMs, loop, hold, prev) (KerberosActor.setmotionChain; FUN_0039f7a8 -> FUN_0037ae98): command 0x22
      // {+0x20 id, +0x24 blend frames, +0x28 name, +0x30 start frames, +0x34 prev, +0x38 (int) durMs, +0x3c hold, +0x3d loop}; returns its handle
      'fake/KerberosActor.setmotion4_l(ILjava/lang/String;FFFZZI)I': (vm, [id, name, blendMs, startMs, durMs, loop, hold, prev]) =>
        R.cmd(0x22, { id, name: str(name), blend: msToFrames(blendMs), startF: msToFrames(startMs), prev: prev | 0, until: Math.trunc(f32(durMs)), hold: !!hold, loop: !!loop, n: 0 }),
      // setqt_l(id, x, y, z, w) (FUN_0039f340 -> FUN_0037b9c8): FUN_00262de0 (quaternion -> rows, read from its VU words), rows 0-2 of the actor matrix; row 3 kept
      'fake/KerberosActor.setqt_l(IFFFF)V': (vm, [id, x, y, z, w]) => {
        const a = A(id); if (!a) return;
        const q = quatRows(x, y, z, w);
        for (let i = 0; i < 12; i++) a.M[i] = q[i];
      },
      // setshadow_l(id, b) (FUN_0039e250 -> FUN_0037ebe8): +0xa8 bit 51 (the page draws no event shadows: left out)
      'fake/KerberosActor.setshadow_l(IZ)V': () => { T.warnOnce('setshadow', 'event actors: setshadow_l (FUN_0037ebe8, shadows) left out'); },
      // ---- fake/KerberosLight ----
      // set_directionvector_l(i, x, y, z) (FUN_003a5248): i < 3 -> FUN_0040cc40 (+0x630 + 0x10 i; FUN_004450f0 builds the
      // light matrix: rows -normalize(dir)); else FUN_00380210 (not translated: the shadow direction)
      'fake/KerberosLight.set_directionvector_l(IFFF)V': (vm, [i, x, y, z]) => {
        if ((i >>> 0) >= 3) { T.warnOnce('shadowdir', 'event lights: set_directionvector_l(-1) (FUN_00380210, shadows) left out'); return; }
        T.rig().dir[i] = [f32(x), f32(y), f32(z)];
      },
      // set_directioncolor(i, r, g, b) (FUN_003a5140): i < 3 -> FUN_003a4fe8 (int x 1/128) -> FUN_0040cca0 (+0x6a0 + 0x10 i)
      'fake/KerberosLight.set_directioncolor(IIII)V': (vm, [i, r, g, b]) => {
        if ((i >>> 0) < 3) T.rig().col[i] = [r, g, b].map(v => f32(f32(v) * f32(1 / 128)));
      },
      // set_ambientcolor(r, g, b) (FUN_003a50a8 -> FUN_003a4fe8 -> FUN_0040ccd8: +0x6d0)
      'fake/KerberosLight.set_ambientcolor(III)V': (vm, [r, g, b]) => { T.rig().amb = [r, g, b].map(v => f32(f32(v) * f32(1 / 128))); },
      'fake/KerberosLight.set_shadowalpha(I)V': () => { T.warnOnce('shadowalpha', 'event lights: set_shadowalpha (shadows) left out'); },
      // reset (FUN_003a5200 -> FUN_00269a08): the area's env light again (not translated: the page keeps the event set)
      // reset (FUN_003a5200 -> FUN_00269a08): the stage's own light record again, DAT_004fcaf8 bit 37 cleared: null = the env rig (worker 0263)
      'fake/KerberosLight.reset()V': () => { T.lights = null; },
      // setLOD_l (FUN_0039e200 -> FUN_0037ec88): +0x1e4 (MP+0x44d); the page draws variant 0 (enemies.js VARIANT)
      'fake/KerberosActor.setLOD_l(II)V': (vm, [id, v]) => { const a = A(id); if (a) a.lod = (v >>> 0) > 3 ? -1 : v; },
    };
    return N;
  }
}
