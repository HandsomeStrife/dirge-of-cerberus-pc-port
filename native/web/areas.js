// Stage areas (section 11) and which of them are on (worker 0223; notes/npc-research.md "Areas").
//
// FUN_00547bc8 makes one area object per section-11 record (class 4, vt 0x58c308) and stores its id in manager
// +0x2b4[record +0xa0] (the "area index"; script cmd 0x3b, lookup FUN_0053b920). Gimmicks (section 15 +0x4c) and the
// placed sounds (section 22 +0xa8) are children of an area (FUN_0054c550): FUN_0054ef68 (the area's +0x28 bit 0)
// passes its state on to them (vt+0x14c). Every frame the player's update FUN_00573c60 (player vt 0x58f128 +0x234)
// calls FUN_00542920(manager, his position): it keeps the current area (manager +0x14) while its box holds him, else
// takes the first neighbour (+0xa4..+0xa7) that does, else the last area of the manager's list (+0x1118: the section-11
// records in order, read from the save's RAM) that does, else none; FUN_00543f28 then turns the old area and its
// neighbours off (FUN_00544138(.., 0)) unless the new set keeps them, and the new area and its neighbours on.
// T: the save (current 105, on 105 / 2 / 15) and a PCSX2 state with Vincent poked into area 15 (on 15 / 105 / 53,
// 2 switched off): test_areas.mjs.
//
// Not on the page: FUN_00544138's FUN_00326130(3, k) / (2) (a status bit on the game manager +0x68..+0x74), and the
// gate in FUN_00573c60 (manager +0x12a0 != 0 and DAT_0046f4dc +0x60 bit 0 clear: 1 and 0 in the save; the page keeps
// them so).

const f32 = Math.fround;

export class Areas {
  // list: ai.json `areas` (section-11 order: k, idx = +0xa0, pos, lo, hi, nb = +0xa4..+0xa7)
  constructor(list) {
    this.list = list || [];
    this.byIdx = new Map();
    for (const a of this.list) {
      if (!this.byIdx.has(a.idx)) this.byIdx.set(a.idx, a);       // FUN_00547bc8: the first record keeps the slot
      // FUN_0054f0d8: box = [+0x30 + lo, +0x30 + hi] (vadd)
      a.bmin = [0, 1, 2].map(i => f32(a.pos[i] + a.lo[i]));
      a.bmax = [0, 1, 2].map(i => f32(a.pos[i] + a.hi[i]));
    }
    // manager +0x14 = -1 and every area off until the first frame (the stage-start pass FUN_0053ced8 switches on only
    // classes 2 1 10 15 16 19 3 14 11 8 18 (DAT_0058b090), not class 4; L: +0x14's start value not read). The first
    // frame's rule gives exactly the save's set: current 105 with 105 / 2 / 15 on, the other 17 off
    this.cur = -1;
    this.on = new Set();           // area index -> +0x28 bit 0
    this.changes = 0;
    // FUN_0054ef68's children: called (area index, on) only when that area's state changes, in FUN_00543f28's order
    // (offs, then ons); play.js passes it on to each child's vt+0x14c (props.js, items.js, ambient.js PlacedSounds)
    this.onSwitch = null;
  }

  // the stage (re)load: FUN_00547bc8 builds the areas again, off (class 4 is not in FUN_0053ced8's lists), current -1
  reset() { this.cur = -1; this.on.clear(); }

  // FUN_0053b920(manager, k): an area object at manager +0x2b4[k]? (k < 0 or an empty slot: none -> the child has no parent)
  has(k) { return k >= 0 && this.byIdx.has(k); }

  // FUN_0054f0d8 -> FUN_00261218(p, min, max): (p - min) and (max - p) have the same sign in every lane
  contains(a, p) {
    for (let i = 0; i < 3; i++) {
      const lo = f32(p[i] - a.bmin[i]), hi = f32(a.bmax[i] - p[i]);
      if ((lo < 0 || Object.is(lo, -0)) !== (hi < 0 || Object.is(hi, -0))) return false;
    }
    return true;
  }

  isOn(idx) { return this.on.has(idx); }

  // FUN_00542920(manager, p)
  frame(p) {
    const cur = this.byIdx.get(this.cur);
    if (this.cur !== -1 && cur && this.contains(cur, p)) return;
    let pick = -1;
    if (this.cur !== -1 && cur) {
      for (const nb of cur.nb) {
        if (nb === -1) continue;
        const a = this.byIdx.get(nb);
        if (a && this.contains(a, p)) { pick = nb; break; }
      }
    }
    if (pick === -1) for (const a of this.list) if (this.contains(a, p)) pick = a.idx;   // no break: the last one wins
    if (pick !== this.cur) this.switchTo(pick);
  }

  // FUN_00544138(manager, k, v) -> FUN_0054ef68(area, v)
  set(k, v) {
    if (k < 0 || k >= 0x7f || !this.byIdx.has(k)) return;
    if (!!v === this.on.has(k)) return;                          // FUN_0054ef68: only on a change
    if (v) this.on.add(k); else this.on.delete(k);
    if (this.onSwitch) this.onSwitch(k, !!v);
  }

  // FUN_00543f28(manager, n)
  switchTo(n) {
    const nu = this.byIdx.get(n) || null, old = this.byIdx.get(this.cur) || null;
    if (old) {
      if (!nu) {
        for (const nb of old.nb) if (nb !== -1 && nb !== n) this.set(nb, 0);
        this.set(this.cur, 0);
      } else {
        for (const nb of old.nb) if (nb !== -1 && nb !== n && !nu.nb.includes(nb)) this.set(nb, 0);
        if (!nu.nb.includes(this.cur)) this.set(this.cur, 0);
      }
    }
    if (nu) {
      this.set(n, 1);
      for (const nb of nu.nb) if (nb !== -1) this.set(nb, 1);
    }
    this.cur = n;
    this.changes++;
  }
}
