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

export class EventActors {
  // clipFrames(model, n, clip) -> frame count of `clip` in event motion file n for that model, or null (no pack)
  constructor({ clipFrames, warn = (m) => console.warn(m) } = {}) {
    this.clipFrames = clipFrames || (() => null);
    this.warn = warn;
    this.warned = new Set();
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
      files: [],                                          // loadmotion_l, in load order
      mp: { clip: null, frame: 0, rate: 0.5, loop: false, count: 0, kids: [null, null, null, null], marker: [0, 0, 0, 0] },
      shown: true, frameDrawn: 0, clipDrawn: null,
    };
    this.slots.push(a);
    return a;
  }

  rig() { return this.lights ??= { dir: [[0, 0, 0], [0, 0, 0], [0, 0, 0]], col: [[0, 0, 0], [0, 0, 0], [0, 0, 0]], amb: [0, 0, 0] }; }

  // FUN_005a7390: the clip by name among the actor's motion files (load order)
  findClip(a, name) {
    for (const n of a.files) { const nf = this.clipFrames(a.model, n, name); if (nf != null) return { n, nf }; }
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

  // one game frame after the event update (FUN_00377c68): the MP draw (FUN_005a8e28), then FUN_003772c8
  step(pose) { this.draw(pose); this.update(); }

  natives(R) {
    const T = this, A = (id) => T.get(id);
    const str = (s) => (s == null ? null : String(s));
    const N = {
      // load_l(name, id, f) (FUN_0039e2f0 -> FUN_00379c68): command 9 (disc load) or, resident, FUN_00380370 at once.
      // The page's models are resident (preloaded): at once; the handle 0 is never busy (event_rt.js 'event loads')
      'fake/KerberosActor.load_l(Ljava/lang/String;II)I': (vm, [name, id]) => { T.create(str(name), id); T.log.push([R.frameNo, 'load ' + name + ' ' + id]); return 0; },
      // loadchr_static_l / loadchrs / unloadchr: character data loads (no actor); resident on the page
      'fake/KerberosActor.loadchr_static_l(Ljava/lang/String;Ljava/lang/String;I)I': () => 0,
      'fake/KerberosActor.loadchrs(I)I': () => 0,
      'fake/KerberosActor.unloadchr(Ljava/lang/String;)V': () => {},
      // loadmotion_l(id, n) (FUN_003a13a8 -> FUN_0037b368: command 0x12 -> FUN_00382220): event motion file
      // FUN_00250898(n, event) = 0x0c000400 + event x 0x1000 + n for the actor's MP; at once on the page
      'fake/KerberosActor.loadmotion_l(II)I': (vm, [id, n]) => { const a = A(id); if (a && !a.files.includes(n)) a.files.push(n); T.log.push([R.frameNo, 'loadmotion ' + id + ' ' + n]); return 0; },
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
      // FUN_00259bd0: rows 0-2 = rotX(x) . rotY(y) . rotZ(z) (FUN_0026125c twice), row 3 kept
      'fake/KerberosActor.setrot_l(IFFF)V': (vm, [id, x, y, z]) => {
        const a = A(id); if (!a) return;
        const k = f32(0.017453292);
        const m = mul(mul(rotX(f32(x * k)), rotY(f32(y * k))), rotZ(f32(z * k)));
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
      // setVisible_l (FUN_003a3478 -> FUN_0037ede8): +0xa8 bit 49; setClip_l (FUN_003a3518 -> FUN_0037ef08): bit 52
      'fake/KerberosActor.setVisible_l(IZ)V': (vm, [id, v]) => { const a = A(id); if (a) a.visible = !!v; },
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
      'fake/KerberosLight.reset()V': () => { T.warnOnce('lreset', 'event lights: reset (FUN_00269a08) not translated'); },
      // setLOD_l (FUN_0039e200 -> FUN_0037ec88): +0x1e4 (MP+0x44d); the page draws variant 0 (enemies.js VARIANT)
      'fake/KerberosActor.setLOD_l(II)V': (vm, [id, v]) => { const a = A(id); if (a) a.lod = (v >>> 0) > 3 ? -1 : v; },
    };
    return N;
  }
}
