// area_stream.js -- which z128 chunks are loaded: the 3-slot chunk table DAT_004e4c60 (stride 0x70)
// and the area boxes that stream slots 1 / 2 (worker 0216; notes/fidelity-audit.md "Character lighting").
// The table decides which chunks' light grids light 2 scans (FUN_0026a710 -> FUN_00270ed8 -> FUN_00270d08:
// slot +0x5c != 0 and +0x44 set) and which chunks the room draws (room.js showChunks, worker 0213). The page
// still collides with every chunk.
//
//   slot 0     chunk 00, always (FUN_002673d8 case 7: FUN_00266ae0(slot 0, zone, 0)); no light grid in z128
//   slots 1/2  the streamed pair; at the stage load FUN_003ff7a8(0x80, 1, 2) -> FUN_002673d8 (cases 8 / 9)
//              then FUN_002677a0(1, 2) (FUN_003ff7a8 case 3)
// Every frame, before the game logic (FUN_00248110): FUN_00267970 (advance the slot being loaded), then
// FUN_0026a0c0 (the first 'eib' box holding MP+0x10's position: type 0 -> FUN_002677a0(box a, box b)).
//
// Data: light.json `areas` (export_web_light.py: 06800011's 'eib' block), `start_pair`.

export class AreaStream {
  constructor(areas, startPair = [1, 2]) {
    this.areas = areas || [];
    this.reset(startPair);
  }

  // the state after the stage load (save state: slots 0 / 1 / 2 = chunks 0 / 1 / 2, +0x5c = 1,
  // DAT_0046bfb0/b4 = 1, 2, DAT_0046bfb8/bc = 0, DAT_004e4c50 = 0)
  reset(startPair = [1, 2]) {
    const [a, b] = startPair;
    this.all = false;             // page aid (everyChunk), not the game's
    this.slots = [{ chunk: 0, loaded: 1 }, { chunk: a, loaded: a ? 1 : 0 }, { chunk: b, loaded: b ? 1 : 0 }];
    this.cur = [a, b];            // DAT_0046bfb0 / DAT_0046bfb4: the request last applied
    this.pend = [0, 0];           // DAT_0046bfb8 / DAT_0046bfbc: a request made while a load ran
    this.busy = 0;                // DAT_004e4c50 (1 = a load in flight; FUN_00267358)
    this.job = null;              // DAT_004e4c54 slot, DAT_004e4c5c chunk
  }

  // +0x54 when +0x5c != 0, else -1 (FUN_002677a0's slot test)
  slotChunk(i) { return this.slots[i].loaded ? this.slots[i].chunk : -1; }

  // PAGE AID (not the game; the game's slots change only through the boxes and the events' load(128, a, b)):
  // the ?ladder= warp can land in no box, far from the loaded pair. Until a box hits and its pair has loaded,
  // loaded() reports every chunk, so the room draws and light 2 scans all of them. The slots underneath are
  // unchanged. (H respawn instead calls reset(): the start pair.)
  everyChunk(n = 13) { this.all = n; }

  // FUN_002677a0(a, b)
  request(a, b) {
    this.pend = [a, b];
    if (this.busy !== 0) return;                    // FUN_00267358 (DAT_0046bfac = 0 in play)
    this.pend = [0, 0];
    this.cur = [a, b];
    const want = [a, b];
    for (let i = 1; i < 3; i++) {                   // unload slots 1, 2 not in the request (FUN_002688f0)
      if (!this.slots[i].loaded) continue;
      if (want.includes(this.slotChunk(i))) continue;
      this.slots[i] = { chunk: this.slots[i].chunk, loaded: 0 };   // FUN_002688f0: +0x5c = 0
    }
    for (const c of want) {                         // the first wanted chunk not in a slot -> a free slot 1 / 2
      if (c === 0) continue;
      let have = false;
      for (let i = 0; i < 3; i++) if (this.slots[i].loaded && this.slotChunk(i) === c) { have = true; break; }
      if (have) continue;
      for (let i = 1; i < 3; i++) {
        if (this.slots[i].loaded === 0) { this.busy = 1; this.job = { slot: i, chunk: c }; return; }
      }
    }
  }

  // FUN_00267970: FUN_00266ae0 on the slot being loaded; on completion (1) re-apply the requests
  progress() {
    if (this.busy !== 1) return;
    // GUESS: the load completes on its first FUN_00266ae0 call (the disc read time and the 10-case
    // state machine's frame count are not modelled; see notes/fidelity-audit.md "Character lighting").
    // T w247_rescue_load: 69 frames in the game, mostly disc reads (cases 2-9); the unload is immediate on both.
    const { slot, chunk } = this.job;
    this.slots[slot] = { chunk, loaded: 1 };        // case 10: +0x54 = chunk, +0x5c = 1
    this.busy = 0; this.job = null;
    const [pa, pb] = this.pend;
    if (pa !== 0 || pb !== 0) this.request(pa, pb);
    this.request(this.cur[0], this.cur[1]);         // DAT_0046bfb0 / b4 read after the call above
  }

  // FUN_00271b60 -> FUN_00271aa8: the first box whose unit space holds p (each coordinate in [-0.5, 0.5])
  box(p) {
    for (const r of this.areas) {
      const m = r.m;                                // FUN_0026135c: r0 x + r1 y + r2 z + r3
      const u = m[0] * p.x + m[4] * p.y + m[8] * p.z + m[12];
      const v = m[1] * p.x + m[5] * p.y + m[9] * p.z + m[13];
      const w = m[2] * p.x + m[6] * p.y + m[10] * p.z + m[14];
      if (u < -0.5 || u > 0.5 || v < -0.5 || v > 0.5 || w < -0.5 || w > 0.5) continue;
      return r;
    }
    return null;
  }

  // one game frame: FUN_00267970, then FUN_0026a0c0 with MP+0x10's translation (FUN_003261e0 = DAT_0046e290+0x50,
  // the player's motion player; FUN_005a70c8 reads its +0x40). Gates DAT_004fc7d4 / DAT_0046bfd0 are 1 in the save.
  frame(p) {
    this.progress();
    const r = this.box(p);
    if (!r || (r.flags & 1)) return;
    if (r.type === 0) {
      this.request(r.a, r.b);
      if (this.all && this.busy === 0) this.all = false;   // page aid ends once the box's pair is loaded
    }
    // type 1 (a callback DAT_0046bfcc with +0x48 / +0x4c / +0x54) has no box in z128
  }

  // the loaded slots in table order (FUN_0026a710's scan order)
  loaded() {
    if (this.all) return Array.from({ length: this.all }, (_, i) => i);   // page aid: everyChunk()
    return this.slots.filter(s => s.loaded).map(s => s.chunk);
  }
}

// FUN_0026a710: DAT_004e88a4 = start (FUN_00270ec0: 1e6), then each loaded slot's grid in slot order
// (FUN_00270ed8 -> FUN_00270d08); the threshold carries over, so the result is the global least d^2/k
// (the first one on a tie). Cell: FUN_0026fb90, clamped to the grid. Spot lights (type 2) outside
// their cone are skipped.
export function pickLight(grids, p, start = 1e6) {
  let best = start, hit = null;
  for (const g of grids) {
    let ix = Math.trunc((p.x - g.x0) / g.size), iz = Math.trunc((p.z - g.z0) / g.size);   // FUN_0026fb90
    ix = Math.min(Math.max(ix, 0), g.nx - 1); iz = Math.min(Math.max(iz, 0), g.nz - 1);
    for (const li of g.cells[iz * g.nx + ix]) {
      const r = g.lights[li];
      const dx = p.x - r.pos[0], dy = p.y - r.pos[1], dz = p.z - r.pos[2];
      const q = (dx * dx + dy * dy + dz * dz) / r.k;
      if (!(q < best)) continue;
      if (r.type === 2) {                                    // spot: outside the cone -> skip
        const d = Math.hypot(dx, dy, dz);
        if ((dx * r.spot[0] + dy * r.spot[1] + dz * r.spot[2]) / d < r.spot[3]) continue;
      }
      best = q; hit = r;
    }
  }
  return hit;
}

// the grids FUN_0026a710 scans now: light.json v2 `chunks` keyed by chunk, in slot order
export function loadedGrids(L, stream) {
  return stream.loaded().map(c => L.chunks[c]).filter(Boolean);
}

// Light 2 of one motion player, rebuilt every drawn frame by FUN_005ab0b0 (Vincent, the soldiers, the props: every MP):
// the picked light r at the actor point p (FUN_005a72a8): dir = (r - p) / d, colour = rgb x k x 100 / d^2 (not x
// MP+0x450); no light -> both 0. FUN_005ab608 smooths while the chosen light differs from the settled one MP+0x430:
// colour MP+0x140 += 0.1 x (new - old), dir MP+0x110 += 0.2 x (new - old) renormalised, until both differences are
// within d^2 <= 0.010000001, then MP+0x430 = the new light. dir / col are the values the draw uses (uL2 / uC2).
export class Light2 {
  constructor() {
    this.s110 = [0, 0, 0]; this.s140 = [0, 0, 0];
    this.s430 = undefined;                       // undefined: not run yet
    this.dir = [0, 0, 0]; this.col = [0, 0, 0];
  }
  update(r, p) {
    const dir = this.dir, col = this.col;
    dir[0] = dir[1] = dir[2] = 0; col[0] = col[1] = col[2] = 0;
    if (r) {
      dir[0] = r.pos[0] - p.x; dir[1] = r.pos[1] - p.y; dir[2] = r.pos[2] - p.z;
      const d = Math.hypot(dir[0], dir[1], dir[2]);
      if (d !== 0) { const id_ = 1 / d; for (let i = 0; i < 3; i++) { dir[i] *= id_; col[i] = r.rgb[i] * (r.k * 100 / (d * d)); } }
      else dir[0] = dir[1] = dir[2] = 0;
    }
    const id = r || 0;
    if (this.s430 === undefined) {
      // GUESS: start settled on the first light (an MP's initial +0x110 / +0x140 / +0x430 are not decoded;
      // notes/fidelity-audit.md "Character lighting")
      this.s430 = id; this.s110 = dir.slice(); this.s140 = col.slice();
    } else if (id !== this.s430) {
      const dc = col.map((v, i) => v - this.s140[i]), dd = dir.map((v, i) => v - this.s110[i]);
      const sq = v => v[0] * v[0] + v[1] * v[1] + v[2] * v[2];
      if (sq(dc) > 0.010000001 || sq(dd) > 0.010000001) {
        for (let i = 0; i < 3; i++) { this.s140[i] += dc[i] * 0.1; this.s110[i] += dd[i] * 0.2; }
        const l = Math.hypot(...this.s110);
        if (l > 0) { const il = 1 / l; for (let i = 0; i < 3; i++) this.s110[i] *= il; }
        for (let i = 0; i < 3; i++) { col[i] = this.s140[i]; dir[i] = this.s110[i]; }
      } else this.s430 = id;
    }
    return this;
  }
}
