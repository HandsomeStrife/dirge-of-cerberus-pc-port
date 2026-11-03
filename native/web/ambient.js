// Placed sounds (stage section 22) and footsteps, as the game plays them (worker 0215; notes/audio-research.md
// "Placed sounds", "Footsteps"). Data: data/audio/ambient_z128.json (native/assets/models/export_web_ambient.py).
//
// Placed sounds. FUN_00548788 makes a class-0xe object (ctor FUN_0057d430, vt 0x5903b8) per section-22 record of type 7.
// Its init vt+0x2fc = FUN_0057dcd0 builds the box spaces; every frame its update FUN_0057d4f8 runs FUN_0057d550 while
// active (+0x28 bit 0): the point FUN_005635e0 (Vincent's position + (0, -7, 0)) inside the shape (vt+0x194 =
// FUN_0057dab8) starts the sound (FUN_0057e188), outside stops it (FUN_0057e220). An inactive object stops it too.
// A positioned sound (+0xbd != 1) is FUN_003e6d70: an emitter slot at the shape's centre (obj+0x1e0) with a fixed
// volume (FUN_003e8b70: slot flag 0x40) = FUN_003e6438(FUN_0057e310(obj, listener)), kept in the table DAT_004f5920
// (8 entries); FUN_003e6ec8 resets that volume every frame (FUN_003e8f70) and FUN_003e9ed0 / FUN_003e9220 send the
// changed volume / pan as request 0x11 (audio.js SeRenderer.update). An area sound (+0xbd == 1) is FUN_003e6c88
// (playBgAreaSound: music.js AreaSound) with the record's volume +0xbb.
//
// Footsteps. FUN_003466a8 puts a name in the motion player (MP+0x3b0, FUN_005ae708): FUN_003415d8(C, kind) with
// kind from the gait C+0x590 bits 30-31 (FUN_00346650 from the clip choice FUN_00346860: 0 stand, 1 walk, 2 run) and
// the floor material C+0x6c1 (FUN_00340e08: the ground polygon's +6 byte). FUN_005ae828 (from the MP update
// FUN_005ab8f0, after the pose) tests the model's foot markers 7 / 8 (mkd): a marker's y below the threshold (mk2
// +0x24; y points down) marks that foot as up (MP+0x440 bits 16-19); the frame it is back at or above the threshold
// with its bit set is a footfall, and the name plays in the MP's own slot (MP+0x3b8, FUN_005a8bc8; range 400) at the
// MP's position (MP+0x10 row 3): FUN_003e8fb0 + FUN_003e9c38 -> FUN_003e9798, a new request on the next FUN_003e9ed0.
// The clip-event path FUN_005aed98 type 1 -> FUN_005ae738 needs clip version > 0x11: z128's clips are 0x10 (none).

// PS2 FPU / VU0 arithmetic rounds toward zero (as audio.js / player.js).
const _c32 = new DataView(new ArrayBuffer(4));
function chop(x) {
  const r = Math.fround(x);
  if (!(Math.abs(r) > Math.abs(x))) return r;
  _c32.setFloat32(0, r); _c32.setInt32(0, _c32.getInt32(0) - 1);
  return _c32.getFloat32(0);
}

// Matrices are 16 floats, 4 rows; a point is p.x r0 + p.y r1 + p.z r2 + p.w r3 (VU0 row vectors).
// FUN_0026125c(out, A, B): out row i = sum_j B[i][j] x A row j, i.e. "apply B, then A".
export function mulG(A, B) {
  const o = new Array(16);
  for (let i = 0; i < 4; i++) for (let k = 0; k < 4; k++) {
    // vmula.x / vmadda.y / vmadda.z / vmadd.w: products summed in that order
    o[i * 4 + k] = chop(chop(chop(chop(B[i * 4] * A[k]) + chop(B[i * 4 + 1] * A[4 + k])) + chop(B[i * 4 + 2] * A[8 + k])) + chop(B[i * 4 + 3] * A[12 + k]));
  }
  return o;
}
// FUN_0026135c: the point with w = 1
export function applyG(M, p) {
  const o = [0, 0, 0];
  for (let k = 0; k < 3; k++) o[k] = chop(chop(chop(chop(p[0] * M[k]) + chop(p[1] * M[4 + k])) + chop(p[2] * M[8 + k])) + M[12 + k]);
  return o;
}
const ident = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const trans = (v) => { const m = ident(); m[12] = v[0]; m[13] = v[1]; m[14] = v[2]; return m; };   // FUN_002613b8 + row 3
const scale = (v) => { const m = ident(); m[0] = v[0]; m[5] = v[1]; m[10] = v[2]; return m; };     // FUN_00260b50
const recip = (v) => v.map((x) => Math.fround(1 / x));      // vdiv Q, vf0.w, v.x / .y / .z (L: VU0 division taken as IEEE)

// FUN_0057dcd0 (obj vt+0x2fc). o: an ambient_z128.json object. Returns the spaces the tests read:
// centre (obj+0x1e0), unit (obj+0x1a0: world -> box space scaled to the half sizes), and per shape the inside-test
// space test (obj+0x130) and, for the cylinder, the segment ends a / b (obj+0x180 / +0x190).
export function soundSpace(o) {
  const lo = o.lo.slice(0, 3), hi = o.hi.slice(0, 3);
  const c = lo.map((x, k) => chop(chop(chop(hi[k] - x) * 0.5) + x));                 // FUN_002611f4(0.5, lo, hi)
  const centre = mulG(o.m, trans(c)).slice(12, 15);                                  // obj+0x1e0
  const half = hi.map((x, k) => chop(x - c[k]));
  const unit = mulG(scale(recip(half)), mulG(trans(c.map((x) => -x)), o.inv));       // obj+0x1a0
  const sp = { centre, unit, shape: o.shape };
  if (o.shape === 1) {
    const c1 = lo.map((x, k) => chop(chop(chop(hi[k] - x) * 0.5) + x));
    const h1 = hi.map((x, k) => chop(chop(x - lo[k]) * 0.5));                         // obj+0x170
    sp.test = mulG(mulG(scale(recip(h1)), trans(c1.map((x) => -x))), o.inv);         // obj+0x130
  } else if (o.shape === 2) {
    const h2 = hi.map((x, k) => (k === 1 ? 1.0 : chop(chop(x - lo[k]) * 0.5)));       // obj+0x170, y = 1.0
    sp.test = mulG(scale(recip(h2)), o.inv);                                          // obj+0x130
    sp.a = [0, hi[1], 0]; sp.b = [0, lo[1], 0];                                        // obj+0x180 / +0x190
  }
  return sp;
}

// vt+0x194 = FUN_0057dab8 (obj+8 = 0: no parent, as every z128 object in the save)
export function inside(o, sp, p) {
  if (o.shape === 0) {                                                               // FUN_00261218 in the record's space
    const q = applyG(o.inv, p);
    for (let k = 0; k < 3; k++) if (!(chop(q[k] - o.lo[k]) >= 0 && chop(o.hi[k] - q[k]) >= 0)) return false;
    return true;
  }
  if (o.shape === 1) {
    const q = applyG(sp.test, p);
    return chop(chop(chop(q[0] * q[0]) + chop(q[1] * q[1])) + chop(q[2] * q[2])) <= 1.0;
  }
  if (o.shape === 2) {                                                               // FUN_0025c770(1.0, q, a, b)
    const q = applyG(sp.test, p), A = sp.a, d = sp.b.map((x, k) => chop(x - A[k]));
    const dot = (u, v) => chop(chop(chop(u[0] * v[0]) + chop(u[1] * v[1])) + chop(u[2] * v[2]));
    const dd = dot(d, d), t = dd ? Math.fround(dot(A.map((x, k) => chop(x - q[k])), d) / dd) : 0;   // FUN_00261498: Q
    const r = A.map((x, k) => chop(chop(x - chop(d[k] * t)) - q[k]));
    if (!(chop(Math.sqrt(dot(r, r))) <= 1.0)) return false;
    const u = chop(0 - t);                                                           // FUN_002614f4: vsubq.x vf0 - Q
    return 0.0 <= u && u <= 1.0;
  }
  return false;
}

// FUN_0057e310: the distance in the unit space (|x|, |y|, |z| of FUN_0026138c(obj+0x1a0, L)), by shape
export function soundDistance(o, sp, p) {
  const q = applyG(sp.unit, p).map(Math.abs);
  let f = 0.0;
  if (o.shape === 0) f = q[0] < q[2] ? q[2] : q[0];
  else if (o.shape === 1) f = chop(Math.sqrt(chop(chop(chop(q[0] * q[0]) + chop(q[1] * q[1])) + chop(q[2] * q[2]))));
  else if (o.shape === 2) f = chop(Math.sqrt(chop(chop(q[0] * q[0]) + chop(q[2] * q[2]))));
  return f < 0.0 ? 0.0 : f;
}

// FUN_003e6438
export function distVolume(d) {
  let f = 1.0;
  if (d < 1.0) f = d <= 0.0 ? 0.0 : d;
  const v = Math.trunc(chop(chop(1.0 - f) * 127.0));
  return v < 0 ? 0 : v > 0x7e ? 0x7f : v;
}

// The class-0xe objects and the bg-sound table DAT_004f5920. backend:
//   open(name, pos, vol) -> handle | null      FUN_003e8e18 + FUN_003e8b70 (a new slot, fixed volume)
//   setVol(handle, vol)                        FUN_003e8f70 (the slot's volume bits; sent by the emitter update)
//   close(handle)                              FUN_003e8ff8 (slot flag 0x20 from the sdb row: the voice is stopped)
//   area(name, vol)                            FUN_003e6c88
//   req15(v)                                   FUN_003e8708 -> request 0x15 (only when it changes; DAT_0047d710)
export class PlacedSounds {
  constructor(data, backend) {
    this.be = backend;
    this.objs = (data.objects || []).map((o) => ({ o, sp: soundSpace(o), playing: false }));   // +0xe0 bit 0
    this.table = new Array(8).fill(null);                                          // DAT_004f5920
    this.d710 = 0x14;                                                               // _DAT_0047d710 (20 in the save)
    this.warned = new Set();
  }

  warnOnce(m) { if (!this.warned.has(m)) { this.warned.add(m); console.warn(m); } }

  // FUN_003e8708
  req15(v) {
    const x = v >= 0 ? v : 0x14;
    if (this.d710 !== x) { this.d710 = x; if (this.be.req15) this.be.req15(x); }
  }

  // FUN_0057e188
  start(e, L) {
    const o = e.o;
    if (o.area !== 1) {
      if (o.name) this.bgPlay(e, L);                                                // FUN_003e6d70(name, obj+0x1e0, obj, 0)
      e.playing = true;
    } else this.be.area(o.name, o.vol);                                            // FUN_003e6c88(name, +0xbb)
    this.req15(o.req15);
  }

  // FUN_0057e220
  stop(e) {
    if (e.o.area === 1) return;
    this.bgStop(e);                                                                  // FUN_003e64b0
    this.req15(0x14);
    e.playing = false;
  }

  // FUN_003e6d70: the first free table entry (entry 0 is tested first, then 1..7)
  bgPlay(e, L) {
    const k = this.table.findIndex((t) => t === null);
    if (k < 0) return;
    const vol = distVolume(soundDistance(e.o, e.sp, L));
    const h = this.be.open(e.o.name, e.sp.centre, vol);
    if (h === null || h === undefined) return;
    this.table[k] = { h, e, vol, pos: e.sp.centre };
  }

  // FUN_003e64b0
  bgStop(e) {
    for (let k = 0; k < 8; k++) {
      const t = this.table[k];
      if (t && t.e === e) { this.be.close(t.h); this.table[k] = null; }
    }
  }

  // One game frame. L: Vincent's position + (0, -7, 0) (FUN_005635e0) for the inside test; Lv: the sound manager's
  // listener +0x3850 (same point, read by FUN_003e6ec8 / FUN_0057e310: audio.js soundListener .alt).
  // active(actor): whether the section-1 record the object follows is active (FUN_0054ef68 passes it on); -1 = none.
  frame(L, Lv = L, active = () => true) {
    for (const e of this.objs) {
      // GUESS: an object that follows no actor is active from the stage load (+0x28 0x200003 in the save; the code that
      // sets it for them was not traced). One that follows an actor takes the actor's state (FUN_0054ef68 -> vt+0x14c).
      const on = e.o.actor < 0 ? true : !!active(e.o.actor);
      if (!on) { if (e.playing) this.stop(e); continue; }                          // FUN_0057d4f8
      const inn = inside(e.o, e.sp, L);                                              // FUN_0057d550
      if (!inn) { if (e.playing) this.stop(e); } else if (!e.playing) this.start(e, L);
    }
    // FUN_003e6ec8 (DAT_0047d6b8 == 0 in the save; game-state bit 7 assumed clear: GUESS, not decoded what sets it).
    // FUN_003e6990's surface-averaged sound (DAT_004f5a3c) is -1 in z128 (none).
    for (let k = 7; k >= 0; k--) {
      const t = this.table[k];
      if (!t) continue;
      t.vol = distVolume(soundDistance(t.e.o, t.e.sp, Lv));                         // PTR_0047d6b0 = -1: no cap
      this.be.setVol(t.h, t.vol);
    }
  }

  playingNames() { return this.table.filter(Boolean).map((t) => t.e.o.name); }
}

// FUN_003415d8(C, kind) -> the cue index (null when the table / material gives none). foot: ambient_z128.json foot.
// gait: C+0x590 bits 30-31 -> kind (FUN_003466a8): 1 -> 0, 2 -> 1, 3 -> 0, 0 -> 4.
export function footCue(foot, mat, gait, version, f568 = 0, f77a = 0) {
  const m = (f568 & 0x10000000) ? f77a : (foot.mat_map[mat] ?? 0xffffffff);       // C+0x6c1 -> DAT_004a1920
  if (!(m >= 0 && m < 0xc)) return null;
  const kind = gait === 1 || gait === 3 ? 0 : gait === 2 ? 1 : 4;
  if (kind < 4) return kind * 16 + m;
  return version >= 0x2f ? 0x6e + m : m;                                            // jump table 0x4a1960 case 4
}
export function footName(foot, mat, gait, version) {
  const k = footCue(foot, mat, gait, version);
  return k === null ? '' : (foot.cues[k] || '');
}

// The foot test of one MP (FUN_005ae828): ys = the foot markers' model-space y (markers 7, 8 [, 4, 5]); thr = mk2 +0x24
// for the first two, +0x28 for the others (-3.0 when the header isn't version '2' or +0x20 < 0). Returns the index of
// the foot that came down this frame (the last one, as the loop keeps it) or -1.
export class FootTest {
  constructor(mk) {
    const ok = mk && mk.version === '2' && mk.legs >= 0;
    this.thr = ok ? [Math.fround(mk.thr[0]), Math.fround(mk.thr[1])] : [-3.0, -3.0];
    this.n = ok && mk.legs > 0 ? 4 : 2;
    this.bits = 0;                                                                  // MP+0x440 bits 16-19
  }
  step(ys) {
    let hit = -1;
    for (let i = 0; i < this.n; i++) {
      const t = i < 2 ? this.thr[0] : this.thr[1];
      if (ys[i] < t) this.bits |= 1 << i;
      else if (this.bits & (1 << i)) { this.bits &= ~(1 << i); hit = i; }
    }
    return hit;
  }
}

// Vincent's footsteps: the name (FUN_003466a8, re-run when the gait or the floor material changes: FUN_00346650 /
// FUN_00340e08) and the footfall test. play(name, pos) = the emitter request (audio.js SoundEmitters.play, range 400).
export class Footsteps {
  constructor(foot, version, play) {
    this.foot = foot; this.version = version; this.play = play;
    this.test = new FootTest(foot.p000);
    this.mat = -1; this.gait = -1; this.name = '';
  }
  setGround(mat, gait) {
    if (mat === this.mat && gait === this.gait) return;
    this.mat = mat; this.gait = gait;
    this.name = footName(this.foot, mat, gait, this.version);                       // MP+0x3b0 ('' = none)
  }
  // ys: foot marker y's in model space after this frame's pose; pos: the MP's position (MP+0x10 row 3)
  frame(ys, pos) {
    const hit = this.test.step(ys);
    if (hit >= 0 && this.name) { this.play(this.name, pos); return this.name; }
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// The emitter slots of the placed sounds on the page (PlacedSounds' backend). The EE side: FUN_003e8e18 opens the slot
// (sdb row +0xc: bit 3 -> 0x20, stop on release; bit 5 -> 0x200000, no Doppler: FUN_003e9b80), FUN_003e8b70 / FUN_003e8f70
// set its fixed volume (flag 0x40, vol << 7), FUN_003e9ed0 sends it the frame after (request 2, audio.js emitterVolPan)
// and then, whenever the volume / pan byte changes, request 0x11 (SeRenderer.update); FUN_003e8ff8 releases it
// (flag 0x20: request 0x12 = SeRenderer.stopFade(10)). The SE plays as a stream (music.js SeStream), rendered a little
// ahead of the AudioContext clock (a page scheduler, not game logic: AHEAD below).
// emitterVolPan, SeStream: passed in (audio.js / music.js), so this module stays importable without them.
const AHEAD_S = 0.2, CHUNK_TICKS = 12;   // page scheduler: 200 ms ahead, 50 ms chunks (an update is heard <= 200 ms late: L)
export class SlotStreams {
  constructor(au, { emitterVolPan, SeStream, hexBytes, FIXED = 0x40 }) {
    this.au = au; this.vp = emitterVolPan; this.SeStream = SeStream; this.hex = hexBytes; this.FIXED = FIXED;
    this.slots = new Map(); this.next = 1; this.log = null; this.areaFn = null; this.warned = new Set();
    this.timer = null;
  }
  warnOnce(m) { if (!this.warned.has(m)) { this.warned.add(m); console.warn(m); } }
  row(name) { const se = this.au.se, res = this.au.res; return (res && res.names[name]) || (se && se.names[name]) || null; }
  open(name, pos, vol) {
    const r = this.row(name);
    if (!r) { this.warnOnce('ambient: no sdb row for ' + name + ' (not played)'); return null; }
    let flags = this.FIXED | ((Math.min(vol, 0x7f) & 0x7f) << 7);                       // FUN_003e8b70
    if (r.flags & 8) flags |= 0x20;
    if (r.flags & 0x20) flags |= 0x200000;
    else this.warnOnce('ambient: ' + name + ': Doppler pitch updates (FUN_00009320) not translated');
    const h = this.next++;
    this.slots.set(h, { name, id: r.id, pos: pos.slice(0, 3), range: 400.0, flags, sent: false, vol: -1, pan: -1, stream: null });
    return h;
  }
  setVol(h, vol) { const s = this.slots.get(h); if (s) s.flags = (s.flags & ~0x3f80) | ((vol & 0x7f) << 7); }   // FUN_003e8f70
  close(h) {
    const s = this.slots.get(h);
    if (!s) return;
    this.slots.delete(h);
    if (!s.stream) return;
    if (s.flags & 0x20) { s.stream.rd.stopFade(10); s.closing = true; this.closing = (this.closing || []).concat([s]); }
    // GUESS: without flag 0x20 the slot is only freed and its voice plays on (FUN_003e8ff8); every z128 placed sound has it
  }
  area(name, vol) { if (this.areaFn) this.areaFn(name, vol); }
  // FUN_003e9ed0 for the placed-sound slots, once a frame with the frame's listener (audio.js soundListener)
  update(L) {
    if (!L) return;
    for (const s of this.slots.values()) {
      const { vol, pan } = this.vp(s, L);
      if (!s.sent) { s.sent = true; s.vol = vol; s.pan = pan; this.start(s); if (this.log) this.log.push({ code: 2, name: s.name, vol, pan }); continue; }
      if (vol !== s.vol || pan !== s.pan) {                                               // request 0x11
        s.vol = vol; s.pan = pan;
        if (s.stream) s.stream.rd.update(vol, pan, 10);
        if (this.log) this.log.push({ code: 0x11, name: s.name, vol, pan });
      }
    }
  }
  start(s) {
    const au = this.au;
    if (!au.ctx || !au.se) return;
    const hex = au.program(s.id);
    if (!hex) { this.warnOnce('ambient: no SE program ' + s.id + ' (' + s.name + ')'); return; }
    const prog = this.hex(hex), bank = au.banks[prog[1] | (prog[2] << 8)];
    if (!bank) return;
    // GUESS: own random-table counter per stream (as music.js AreaSound; IOP FUN_0000a870 keeps one for every SE)
    s.stream = new this.SeStream(au.drv, bank, prog, s.vol, s.pan);
    s.next = au.ctx.currentTime + 0.02; s.srcs = [];
    if (!this.timer) this.timer = setInterval(() => this.pump(), 25);
  }
  pump() {
    const ctx = this.au.ctx;
    const live = [...this.slots.values(), ...(this.closing || [])].filter((s) => s.stream);
    for (const s of live) {
      while (!s.stream.done && s.next < ctx.currentTime + AHEAD_S) {
        const { left, right } = s.stream.ticks(CHUNK_TICKS);
        const buf = ctx.createBuffer(2, left.length, 48000);
        buf.copyToChannel(left, 0); buf.copyToChannel(right, 1);
        const src = ctx.createBufferSource();
        src.buffer = buf; src.connect(ctx.destination); src.start(s.next);
        s.next += left.length / 48000;
        s.srcs.push({ src, end: s.next });
      }
      s.srcs = s.srcs.filter((c) => c.end > ctx.currentTime);
    }
    if (this.closing) this.closing = this.closing.filter((s) => !s.stream.done);
    if (!live.length && this.timer) { clearInterval(this.timer); this.timer = null; }
  }
  stopAll() {
    for (const s of [...this.slots.values(), ...(this.closing || [])]) for (const c of s.srcs || []) { try { c.src.stop(); } catch (e) { /* not started */ } }
    this.slots.clear(); this.closing = [];
  }
}
