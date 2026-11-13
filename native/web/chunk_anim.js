// chunk_anim.js -- the room's node animations (worker 0257; notes/battle-camera.md 'The doors'): a chunk's animation file (FileCode <level><chunk>10,
// read by FUN_00266ae0 into the slot's +0x38 state) moves nodes of its BMD: doors and gates. The tracks that only scroll UVs stay in room.js RoomUVAnim.
// FUN_00248110 -> FUN_00265350 -> FUN_00263e90 -> FUN_0026c198: per animation with flags bit 0 set and +6 == 0, each track's curves set the node's local
// matrix (FUN_00261ef0: position x 10, y and z negated; degrees, y and z negated; FUN_00259bd0 x, y, z), then time += DAT_004fc7e8 * 0.5. The animation stops
// (FUN_00261e68) with flags bit 2 or when no curve is still running. Script cmds 0x50 .. 0x53 (FUN_00545b20) -> FUN_00327660 / FUN_00327948 / FUN_00327a30 /
// FUN_003278d8 keep a list (DAT_0046e2ac) that FUN_00327de8 replays when a chunk comes back.
import { evalCurve } from './room.js';
import { STEP } from './video_mode.js';

const fr = Math.fround;
const RAD = 0.017453294;
const rotY = (M, a) => { const c = Math.cos(a), s = Math.sin(a); return [[M[0][0] * c + M[0][2] * s, M[0][1], -M[0][0] * s + M[0][2] * c], [M[1][0] * c + M[1][2] * s, M[1][1], -M[1][0] * s + M[1][2] * c], [M[2][0] * c + M[2][2] * s, M[2][1], -M[2][0] * s + M[2][2] * c]]; };
const rotZ = (M, a) => { const c = Math.cos(a), s = Math.sin(a); return M.map(r => [r[0] * c - r[1] * s, r[0] * s + r[1] * c, r[2]]); };
// FUN_00259bd0: Rx, then x Ry, then x Rz (row vectors; FUN_00259990's row 0 = (c, 0, -s), checked against the door's RAM in w257_door2)
function euler(x, y, z) {
  const c = Math.cos(x), s = Math.sin(x);
  return rotZ(rotY([[1, 0, 0], [0, c, s], [0, -s, c]], y), z);
}
// FUN_002621c8 / FUN_00262328: the value and whether the curve still runs (at or past the last key it does not, unless it loops)
const live = (K, t, loop) => K.length > 0 && (loop || t < K[K.length - 1][0]);

export class ChunkAnims {
  // data: props.json chunkAnims: [{ chunk, rest: { node: rows }, anims: [{ index, flags, h3, tracks: [{ node, pos: [3 curves], rot: [3 curves] }] }] }]
  constructor(data, { onNode = null } = {}) {
    this.byChunk = new Map(data.map(c => [c.chunk, c]));
    this.onNode = onNode;              // (chunk, node, rows) at load and when a node moved: the room's vertices (room.js RoomNodes)
    this.loaded = new Map();           // loaded chunk -> { node: Map(node -> rows), st: Map(anim index -> { flags, time, a }) }
    this.list = [];                    // DAT_0046e2ac: { chunk, anim, on (+0xc bit 0), loop (bit 1), time (+0x10) }
    this.want = null;
  }
  reset() { for (const c of [...this.loaded.keys()]) this.unload(c); this.list.length = 0; }
  unload(c) {
    this.loaded.delete(c);
  }
  load(c) {                            // FUN_00266ae0 -> FUN_002680e0: times zero, the file's matrices and flags
    const C = this.byChunk.get(c);
    if (!C) return;
    const st = new Map(C.anims.map(a => [a.index, { flags: a.flags, time: 0, a }]));
    this.loaded.set(c, { node: new Map(), st });
    if (this.onNode) for (const n of Object.keys(C.rest)) this.onNode(c, +n, C.rest[n]);
    for (const e of this.list) if (e.chunk === c) {                            // FUN_00327de8 -> FUN_00327268
      this.setTime(c, e.anim, e.time);
      if (!e.on) this.oneFrame(c, e.anim);
      else { this.play(c, e.anim, e.loop); this.setTime(c, e.anim, e.time); }
    }
  }
  st(c, a) { const L = this.loaded.get(c); return L ? L.st.get(a) : null; }
  play(c, a, loop) { const s = this.st(c, a); if (s) { s.flags = loop ? 1 : 3; s.time = 0; } }          // FUN_00268220, FUN_00261d88
  oneFrame(c, a) { const s = this.st(c, a); if (s) s.flags = 3 | 4; }          // FUN_002682d0, FUN_00261de0
  setTime(c, a, t) { const s = this.st(c, a); if (s) s.time = t; }             // FUN_00268510
  find(c, a) { return this.list.find(e => e.chunk === c && e.anim === a) ?? null; }  // FUN_00327cc0
  entry(c, a) { let e = this.find(c, a); if (!e) { e = { chunk: c, anim: a, on: false, loop: false, time: 0 }; this.list.push(e); } return e; }
  // cmd 0x50, FUN_00327660(chunk, anim, loop): an entry already listed gives its time
  start(c, a, loop) {
    this.play(c, a, loop);
    const old = this.find(c, a), e = this.entry(c, a);
    if (old) this.setTime(c, a, e.time);
    e.loop = !!loop; e.on = true;
  }
  // cmd 0x51, FUN_00327948: stopped, the entry gone (the pose stays)
  stop(c, a) { const s = this.st(c, a); if (s) s.flags = 0; const i = this.list.findIndex(e => e.chunk === c && e.anim === a); if (i >= 0) this.list.splice(i, 1); }
  // cmd 0x52, FUN_00327a30(time, chunk, anim): time < 0 = the animation's last key (FUN_00269720, FUN_00261e70); one frame at that time
  pose(time, c, a) {
    if (time < 0) { const s = this.st(c, a); time = s ? this.lastKey(s.a) : 0; }
    this.setTime(c, a, time); this.oneFrame(c, a);
    this.entry(c, a).time = time;
  }
  // cmd 0x53, FUN_003278d8: stopped, the entry off
  pause(c, a) { const s = this.st(c, a); if (s) s.flags = 0; const e = this.find(c, a); if (e) e.on = false; }
  lastKey(a) { let m = 0; for (const t of a.tracks) for (const K of [...t.pos, ...t.rot]) if (K.length && K[K.length - 1][0] > m) m = K[K.length - 1][0]; return m; }
  // FUN_00269530 -> FUN_00267c88: the node's matrix; null when the chunk isn't loaded
  node(c, n) { const L = this.loaded.get(c); if (!L) return null; return L.node.get(n) ?? (this.byChunk.get(c).rest[n] || null); }
  // one game frame: FUN_00265350. loaded: the loaded chunks or null = all; advance: DAT_004fc7e8
  frame(loaded, advance = STEP) {
    const want = loaded == null ? [...this.byChunk.keys()] : loaded;
    for (const c of [...this.loaded.keys()]) if (!want.includes(c)) this.unload(c);
    for (const c of want) if (!this.loaded.has(c)) this.load(c);
    const step = fr(fr(advance) * 0.5);
    for (const [c, L] of this.loaded) for (const s of L.st.values()) {
      if (!(s.flags & 1) || s.a.h3) continue;
      const loop = !(s.flags & 2), t = s.time;
      let run = false;
      for (const tr of s.a.tracks) {
        const ev = (K, k) => { if (live(K, t, loop)) run = true; return K.length ? evalCurve(K, t, loop) : 0; };
        const p = tr.pos.map(ev), r = tr.rot.map(ev);
        const R = euler(r[0] * RAD, -r[1] * RAD, -r[2] * RAD);
        const M = [R[0], R[1], R[2], [p[0] * 10, -p[1] * 10, -p[2] * 10]];
        L.node.set(tr.node, M);
        if (this.onNode) this.onNode(c, tr.node, M);
      }
      s.time = fr(s.time + step);
      if ((s.flags & 4) || !run) s.flags = 0;
    }
  }
}
