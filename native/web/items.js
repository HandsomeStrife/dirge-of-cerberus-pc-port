// items.js -- item pickups and drops (object type 8, class vt 0x590a68), the inventory, the game logic (no three.js;
// items_view.js draws them). Worker 0224; notes/items-research.md. Data: data/items/items.json (export_web_items.py).
//
// The items join the enemy AI's world (enemy_ai.js `opts.items`, as props.js does): they are script objects (cmd 0x1a4,
// 0x3e of a placed record), Vincent's script event 0x3a runs in that world's VM, a take deletes through its queue.
//
//   items.attach(world)            the stage load (FUN_00548348 case 2) and each Restart's new world
//   items.sweep(newPos, oldPos)    FUN_00573c60 -> FUN_005442a0: Vincent's move this frame (enemy_ai tick 1a)
//   items.update(step)             vt+0x214 FUN_0057ff80 for every item (enemy_ai tick, the object lists)
//   items.drop(actor)              FUN_0055cac8's drop (enemy_ai enemyDeath)
//   items.inventory                FUN_0031e940 / FUN_0031f0f0 (+ the ammo item bound to aim_core's Ammo)
//
// Not translated (warned): the HUD pickup notice FUN_00560098 -> FUN_003b3538 and the "can't carry" notices
// FUN_003b2dd8 / FUN_003b3538(2) (a formatted text log, which can also open the item list FUN_003b47d0); the drops'
// life timer (FUN_0053e9e0 types -7 / -3, FUN_0057fe78, +0xe4 / bit 14 0x4000 -> FUN_0057fee0's fade); the object rays of
// the drop's ground search (FUN_005449f0); weapon items (+200 bit 1) and the key items' side test (bits 9 / 10);
// item use (the item list and its input).

const f = Math.fround;
export const ITEM_KIND = 'item';
export const AMMO_ID = 0x62300000;           // the first weapon slot's ammo item (bgd section 13; aim_core Ammo)
// the save's other weapon slots' loaded rounds: the inventory count of AMMO_ID is aim_core's Ammo.inv + these
// (aim_core.js START_AMMO: w214_dry inventory 225 = reserve 180 + class sum 45, this slot's 18)
export const AMMO_OTHER_LOADED = 27;
// FUN_00580730: the pickup test from Vincent's swept position (y - 7, FUN_00573c60)
export const PICK_R = 8.0, PICK_DY_LO = -18.0, PICK_DY_HI = 5.0;   // 0x41000000, 0xc1900000, 0x40a00000
export const SWEEP_DY = 7.0;                 // FUN_00573c60: both ends of the move 7 up
export const FALL_G = 0.1;                   // FUN_0057ff80: +0xd8 += step x 0.1 (0x3dcccccd)
export const BOUNCE = f(-0.624649);          // 0xbf1fe8ff
export const HOVER_MAX = 15.0;               // the model at most 15 above its place
export const DROP_LIFT = 10.0;               // FUN_00580388: a dropped item's model starts 10 above its place
export const FULL_HOP = f(-1.1);             // FUN_00580438: +0xd8 = -1.1 when it can't be carried
export const SPIN = f(0.024543693);          // FUN_0057ff80: 2 pi / 256 per frame
export const SIZE_HIDE = 3.0, SIZE_SPIN = 5.0;   // FUN_0054c308's screen size: < 3 hidden, >= 5 spins
export const DROP_LIFE = 0xe10;              // FUN_0055cac8: 3600 frames (status bit 14: none)
export const INV_SLOTS = 60;                 // the save's inventory +0x26
export const GIL_MAX = 99999999;             // FUN_003213d8
// FUN_00310c40 = the save data's version (FUN_00312248 of "bzdNNN": 48 in the save); FUN_00316d70 reads the status
// flags only from version 0x1d on
export const SAVE_VERSION = 48;
// the save RAM (sea-of-flames, frame 1575): the inventory (+0x34 entries) and the gil (DAT_0046e248 +8), as aim_core's
// START_AMMO is hand-written from it. Only ids and counts.
export const START_INVENTORY = [[0x69300000, 2], [AMMO_ID, 225], [0x62300001, 0], [0x62300002, 0], [0x70300000, 1], [0x70310000, 1]];
export const START_GIL = 0;
// The Restart (worker 0224, review): the game restores the checkpoint's inventory block and clears the taken bits. T: the
// reload state of the w201 route (w220_box's run takes record 22's item at f205, then death, Restart; state at f3984):
// 0x69300000 x 2 again, the ammo item 234 with the three slots at 18 (the other slots' 36), taken words 0, record 22's
// object rebuilt. The restore path itself (the checkpoint's save block) is not decoded: these are its traced values.
export const RESTART_INVENTORY = [[0x69300000, 2], [AMMO_ID, 234], [0x62300001, 0], [0x62300002, 0], [0x70300000, 1], [0x70310000, 1]];
export const RESTART_OTHER_LOADED = 36;
export const RESTART_GIL = 0;
// the game frame counter (DAT_0046e938 +0x20) is 1575 at the save; the page's world frame S.frame starts at 0
export const FRAME0 = 1575;
// GUESS: the items active at the save keep their spin clock +0xdc from the save RAM (FUN_005804a8 set it when they
// were activated at the stage load, frame 27); the page cannot replay that load. Section-15 record -> +0xdc.
export const SAVE_DC = { 22: 27, 123: 27 };

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

export class Inventory {
  // entries: [id, count] in slot order (FUN_0031e658: +0x34 + 12 k); ammo: aim_core Ammo (its inv holds AMMO_ID's count
  // less AMMO_OTHER_LOADED)
  constructor(table, start = START_INVENTORY, gil = START_GIL) {
    this.table = table; this.slots = start.map(e => e.slice()); this.gil = gil; this.ammo = null; this.other = AMMO_OTHER_LOADED;
  }
  // aim_core's Ammo, read live: a reset (Restart / H) makes a new one (aim_core reset). `ammo` = the object or a getter
  get A() { return typeof this.ammo === 'function' ? this.ammo() : this.ammo;
  }
  rec(id) { return this.table[(id >>> 0).toString(16).padStart(8, '0')] || null; }
  find(id) { return this.slots.findIndex(e => e[0] === id); }                     // FUN_0031f0b0
  count(id) {
    if (id === AMMO_ID && this.A) return this.A.inv + this.other;
    const k = this.find(id); return k < 0 ? 0 : this.slots[k][1];
  }
  setCount(k, n) {
    this.slots[k][1] = n;
    if (this.slots[k][0] === AMMO_ID && this.A) this.A.inv = n - this.other;
  }
  // FUN_0031f0f0: can the item go in? kind 4 (gil) always; a stacking item (flags bit 0) with an entry: under its max;
  // else a free slot (FUN_0036e2a8)
  canAdd(id) {
    const r = this.rec(id);
    if (!r) return false;
    if (r.kind === 4) return true;
    const k = this.find(id);
    if (k >= 0 && (r.flags & 1)) return this.count(id) < r.max;
    return this.slots.length < INV_SLOTS;
  }
  // FUN_005740c0 -> FUN_0031e940 (FUN_003213d8 for kind 4): returns the slot (>= 0), 1 for gil, -1 when it fails
  add(id, n) {
    const r = this.rec(id);
    if (!r) return -1;                       // FUN_00321ac0 for an unknown id: not translated (no z128 item)
    if (r.kind === 4) {
      if (this.gil >= GIL_MAX) return 0;
      this.gil = Math.min(this.gil + r.value * n, GIL_MAX);
      return 1;
    }
    let k = (r.flags & 1) ? this.find(id) : -1;
    if (k >= 0) {
      const c = this.count(id);
      if (c >= r.max) return -1;
      this.setCount(k, Math.min(c + n, r.max));
      return k;
    }
    if (this.slots.length >= INV_SLOTS) return -1;
    this.slots.push([id, n]); k = this.slots.length - 1;
    if (id === AMMO_ID && this.A) this.A.inv = n - this.other;
    return k;
  }
}

// FUN_0057f6f8: the model by item (index into the ELF's name table, data.models)
export function modelIndex(o, rec) {
  if (!rec) return -1;
  const id = o.itemId | 0;
  if (id === (0x6931001a | 0) || id === (0x6932000b | 0)) return 0x11;
  if (id === (0x69310013 | 0)) return 9;
  if (id === (0x69310000 | 0)) return 8;
  if (id === (0x69310003 | 0)) return 10;
  if (id === (0x69310017 | 0)) return 0xd;
  if (id === (0x69310019 | 0) || id === (0x6932000c | 0)) return 0x10;
  if (id === (0x6b300000 | 0)) return 0xc;
  if (id === (0x6b300001 | 0)) return 4;
  if (id === (0x6b300002 | 0)) return 0xf;
  if (id === (0x6b300003 | 0)) return 0xe;
  if (o.f200 & 8) return 1;                                   // a placed item
  switch (rec.kind - 2) {
    case 1:
      if ((rec.part10 & 0xf0000) !== 0x50000) return 0;
      if (id === (0x62300001 | 0)) return 7;
      if (id === (0x62300002 | 0)) return 6;
      if (id === (0x62300003 | 0)) return 0xb;
      return 5;
    case 2: case 7: return 2;
    case 8: return 0xc;
    default: return 0;
  }
}

export function createItems({ data, effect = null, warn = console.warn, ground = null, camera = null, hud = null, areas = null } = {}) {
  const warned = new Set();
  const warnOnce = m => { if (!warned.has(m)) { warned.add(m); warn(m); } };
  const inventory = new Inventory(data.items || {});
  const taken = new Set();                   // FUN_0031e0e0: the placed items' taken bits (+0xce)
  // the Restart (before the new world's attach): the checkpoint's inventory, the taken bits cleared (traced values above).
  // aim_core's reset makes its Ammo at START_AMMO (18 / 180: inv 198) = 234 - 36, consistent with RESTART_INVENTORY.
  function restart() {
    inventory.slots = RESTART_INVENTORY.map(e => e.slice()); inventory.gil = RESTART_GIL; inventory.other = RESTART_OTHER_LOADED;
    taken.clear();
  }
  const list = [];
  const byRec = new Map();
  let W = null, nextDrop = 0;
  const push = s => { if (W) W.events.push(s); };
  const frame = () => (W ? W.S.frame : 0) + FRAME0;          // DAT_0046e938 +0x20
  const rng = () => (W && W.rng ? W.rng() : 0);
  const sound = (name, pos) => { if (W && W.sound && name) W.sound(name, pos); };

  function make(fields) {
    const o = Object.assign({
      kind: ITEM_KIND, f28: 0x8000, f40: 0x8, f200: 0, ca: -1, ce: -1, script: -1, vars: new Int16Array(8), t3c: new Int16Array(2),
      pos: [0, 0, 0], mdl: null, gone: false,
    }, fields);
    o.rec_ = inventory.rec(o.itemId);
    // FUN_00580590: kind 10 -> +200 bit 5; 0x6b300002 / 3 -> bit 9
    if (o.rec_ && o.rec_.kind === 10) o.f200 |= 0x20;
    if (o.itemId === 0x6b300002 || o.itemId === 0x6b300003) o.f200 |= 0x200;
    return o;
  }
  // FUN_005804a8: the model (FUN_0057f6f8) at the item's place, +0xd8 = 0, +0xdc = now
  function modelOn(o) {
    const k = modelIndex(o, o.rec_);
    const name = k >= 0 ? (data.models || [])[k] : null;
    if (!name) { warnOnce(`items: item ${o.itemId.toString(16)} has no model`); return; }
    o.mdl = { name, pos: o.pos.slice(), vy: 0, dc: frame(), col: 0, yaw: 0, hidden: false };
    // FUN_00580388 (vt+0x234 FUN_00580a58 after a move): a dropped item's model (+200 bits 3 and 7 clear) 10 above
    place(o);
  }
  function place(o) {
    if (!o.mdl) return;
    o.mdl.pos = o.pos.slice();
    if (!(o.f200 & 8) && !(o.f200 & 0x80)) o.mdl.pos[1] = f(o.mdl.pos[1] - DROP_LIFT);
  }
  // FUN_00580298 (vt+0x144): activation. On: the model; Vincent already within the pickup test sets +200 bit 4, so he
  // must step out and back in. Off: the model goes (FUN_00580530).
  function activate(o, on) {
    if ((on ? 1 : 0) === (o.f28 & 1)) return;
    o.f28 = on ? (o.f28 | 1) : (o.f28 & ~1);
    if (!on) { o.mdl = null; push(`deactivate ${o.id}`); return; }
    modelOn(o);
    const p = W && W.player && W.player.pos;
    if (p) { if (inRange(o, p)) o.f200 |= 0x10; else o.f200 &= ~0x10; }
    push(`activate ${o.id}`);
  }

  function attach(world) {
    W = world;
    list.length = 0; byRec.clear();
    for (const p of data.placed || []) {
      // FUN_00548348 case 2: skipped when its taken bit is set (FUN_0031e1a8(k))
      if (taken.has(p.k)) continue;
      const o = make({ id: 'i' + p.rec, rec: p.rec, k: p.k, itemId: p.id | 0, count: p.count, script: p.script,
        pos: p.m[3].slice(0, 3).map(f), placed: p });
      o.f200 |= 8; o.ce = p.k;                              // FUN_00580718: +0xcc record, +0xce k, bit 3
      if (p.flags48 & 4) o.f200 |= 1;                       // FUN_00548348: wait for a script's activation
      list.push(o); byRec.set(p.rec, o);
      world.objects.set(o.id, o);
    }
    // the stage-start pass FUN_0053ced8 (class 0x13 is in its lists, DAT_0058b090): vt+0x14c(1) for every item without a
    // parent area (+0x4c -1 or an empty manager +0x2b4 slot: 69 in z128). The others follow their area (areaSwitch, worker
    // 0223; areas.js). SAVE_DC (GUESS above) is applied at an item's first activation after the load.
    for (const o of list) { o.dcSave = SAVE_DC[o.rec]; if (!parented(o.placed.area)) vt14c(o, 1); }
  }
  const parented = k => (areas ? areas.has(k) : k >= 0);
  // vt+0x14c = FUN_00580348: +0x144(on, 1) unless +200 bit 0 (record +0x48 bit 2, FUN_00548348)
  function vt14c(o, on) {
    if (o.f200 & 1) return;
    activate(o, on);
    if (on && o.dcSave !== undefined && o.mdl) { o.mdl.dc = o.dcSave; o.dcSave = undefined; }
  }
  // FUN_0054ef68 (area k switched on / off) -> vt+0x14c on its children
  function areaSwitch(k, on) { for (const o of list) if (!o.gone && o.placed && o.placed.area === k) vt14c(o, on); }

  // FUN_00580730: Vincent's swept point q (feet - 7) against the item's place: xz distance < 8, -18 < dy < 5
  function inRange(o, q) {
    if (o.f200 & 0x400) { warnOnce('items: +200 bit 10 pickup test (DAT_0046ef48) not translated'); return false; }
    const dy = f(q[1] - o.pos[1]);
    const dx = f(q[0] - o.pos[0]), dz = f(q[2] - o.pos[2]);
    const d = f(Math.sqrt(f(f(dx * dx) + f(dz * dz))));
    if (!(d < PICK_R)) return false;
    if (dy <= PICK_DY_LO) return false;
    return dy < PICK_DY_HI;
  }

  // FUN_00560110(player, item): the take. Returns 0 (not taken), 1 (taken: delete), 2 (taken: deactivate), -1
  function take(o) {
    const P = W.player;
    if (P && P.hp === 0) return 0;                          // FUN_00316cf8: status +0x20 == 0
    if (o.f200 & 0x200) { warnOnce('items: the key items\' side test (FUN_005806d8) not translated'); return -1; }
    const id = o.itemId, n = o.count, rec = o.rec_;
    const ppos = P && P.pos ? P.pos : o.pos;
    // FUN_0031f0f0 on the status's inventory (+0x80)
    if (!inventory.canAdd(id)) {
      warnOnce('items: the HUD "can\'t carry" notices (FUN_003b2dd8 / FUN_003b3538(2)) not translated');
      sound(data.sounds && data.sounds.full, ppos);         // FUN_0054b158(P, 0x58d938, 1)
      if (o.mdl) o.mdl.vy = FULL_HOP;                       // FUN_00580438
      push(`item full ${o.id}`);
      return 0;
    }
    if (o.f200 & 2) { warnOnce('items: weapon items (+200 bit 1, FUN_00574518) not translated'); return -1; }
    // the item's script event 0x47 and Vincent's 0x3a (r0 = item id, r1 = the item object's id); their results
    // (FUN_0036fe20: the stack top; no event: DAT_004ef400 = 0) pick the mode
    const m47 = Math.trunc(W.runEvent(o, 0x47) ?? 0);
    if (!W.playerObj) warnOnce('items: the AI world has no player script object: Vincent\'s event 0x3a not run');
    let mode = W.playerObj ? Math.trunc(W.runEvent(W.playerObj, 0x3a, [id, o.id]) ?? 0) : 0;
    if (m47 === 1) { if (mode < 2) mode = 1; }
    else if (m47 === 2) mode = 2;
    else if (m47 === 3) mode = 3;
    let res = 0;
    if (mode === 0) {
      res = add(id, n) ? 1 : 0;
      effect4800(o);                                        // FUN_00580450
    } else if (mode === 2) res = 1;
    else if (mode === 3) { res = add(id, n) ? 2 : 0; effect4800(o); }
    if (res === 0) { sound(data.sounds && data.sounds.full, ppos); return 0; }
    // the sound (FUN_0054b158(P, name, 1)) by item
    const S = data.sounds || {};
    let nm;
    if (id === (0x6932000b | 0)) nm = S.id_6932000b;
    else if (id === (0x6932000c | 0)) nm = S.id_6932000c;
    else nm = nonAmmo(rec) ? S.nonammo : ((o.f200 & 4) ? S.dropped : S.placed);
    if (rec) sound(nm, ppos);
    warnOnce('items: the HUD pickup notice (FUN_00560098 -> FUN_003b3538) not translated');
    push(`take ${o.id} ${id.toString(16)} x${n} mode ${mode}`);
    return res;
  }
  // FUN_005740c0: FUN_0031e940; a success with DAT_0046e290 +0x30 set (the save: set) -> DAT_0046e54c |= 0x6e
  function add(id, n) {
    const r = inventory.add(id, n);
    if (r < 0) return false;
    const rec = inventory.rec(id);
    if (rec && rec.kind !== 4 && hud) hud(0x6e);
    return rec && rec.kind === 4 ? r === 1 : true;
  }
  // FUN_0031e2c8
  function nonAmmo(r) {
    if (!r) return false;
    if (r.kind === 4) return false;
    if (r.kind === 3) return false;                         // (callers pass ammo; a z128 kind-3 item: 0x6230000x -> 0)
    if (r.kind === 9) return false;
    return ((r.flags >> 2) & 1) === 0;
  }
  function effect4800(o) {
    if (!effect || !effect.spawn) return;
    const p = o.pos.slice();
    if (o.f200 & 0x1000) warnOnce('items: FUN_00580450 bit 12 offset (DAT_0046ef4c) not translated');
    effect.spawn(0x4800, p);                                // FUN_003365e0(0x4800, position)
  }

  // FUN_00580870 (vt+0x164), from FUN_005442a0's grid walk: a = the swept new point, b = the old one
  function touch(o, a, b) {
    if (!inRange(o, a)) {
      o.f200 &= ~0x10;
      return 0;
    }
    if (o.f200 & 0x10) {
      if (inRange(o, b)) return 0;
      o.f200 &= ~0x10;
      return 0;
    }
    const r = take(o);
    if (r === 1) {
      remove(o);                                            // FUN_0053fa08
      if (o.f200 & 8) taken.add(o.ce);                      // FUN_0031e0e0(+0xce, 1)
    } else if (r === 2) activate(o, 0);
    if (r < 0) return 0;
    o.f200 |= 0x10;
    return 1;
  }
  function remove(o) {
    o.f28 |= 0x80000;
    if (W.postManager) W.postManager(0, o.id);              // manager event 0 -> FUN_0053e1e0 at the frame end
    else deleted(o);
  }
  function deleted(o) { o.f28 &= ~1; o.mdl = null; o.gone = true; const i = list.indexOf(o); if (i >= 0) list.splice(i, 1); push(`remove ${o.id}`); }

  // FUN_00573c60: Vincent moved (distance > 0), both ends 7 up; every active item with +0x40 bit 3.
  // L: FUN_00589a78 walks the grid cells along the move (FUN_0036d400); every item is tested here (the cell rules only
  // narrow the candidates, the test is FUN_00580730's).
  function sweep(pNew, pOld) {
    if (!W || !pNew || !pOld) return;
    const d = sub(pNew, pOld);
    if (!(d[0] * d[0] + d[1] * d[1] + d[2] * d[2] > 0)) return;
    const a = [pNew[0], f(pNew[1] - SWEEP_DY), pNew[2]], b = [pOld[0], f(pOld[1] - SWEEP_DY), pOld[2]];
    for (const o of list.slice()) if ((o.f40 & 8) && (o.f28 & 1) && !(o.f28 & 0x80000)) touch(o, a, b);
  }

  // FUN_0057ff80 (vt+0x214): screen size, the colour pulse and spin, the fall
  function update(step) {
    const cam = camera ? camera() : null;
    for (const o of list) {
      if (!(o.f28 & 1) || !o.mdl) continue;
      const M = o.mdl;
      let small = false, big = false;
      if (cam) {
        // FUN_0054c308: +0x30 (the bound radius, 7) x 256 / (|camera row 3 - position| x camera +0xd0 (tan(fov / 2)))
        const e = sub(o.pos, cam.pos);
        const s = f(f(7.0 * 256.0) / f(f(Math.sqrt(e[0] * e[0] + e[1] * e[1] + e[2] * e[2])) * cam.tanHalf));
        if (s < SIZE_HIDE) small = true; else big = !(s < SIZE_SPIN);
      } else warnOnce('items: no camera: items drawn at every distance (FUN_0054c308 needs it)');
      if (!(o.f200 & 0x400) && !(o.f200 & 0x1000) && small !== !!(o.f200 & 0x100)) {
        if (small) o.f200 |= 0x100; else o.f200 &= ~0x100;  // FUN_005a85f8(model, 2 / 0)
      }
      M.hidden = !!(o.f200 & 0x100);
      if (M.hidden) continue;
      let t = 0;
      if (big) t = (frame() - M.dc) | 0; else M.dc = frame();
      M.col = ((data.pulse || [])[t & 0x1f] + 100) & 0xff;  // FUN_005a86a0: (c, c, c, 0x80)
      if (o.f200 & 0x40) warnOnce('items: the fade FUN_0057fee0 (+200 bit 6) not translated');
      M.yaw = f(f((t & 0xff) * SPIN) - f(Math.PI));        // FUN_005a7018
      // the fall: +0xd8 += step x 0.1; at or below the place: there, x -0.624649; 15 above at most
      const vy = f(M.vy + f(step * FALL_G));
      M.vy = vy;
      let y = f(M.pos[1] + vy);
      if (o.pos[1] <= y) { y = o.pos[1]; M.vy = f(vy * BOUNCE); }
      else if (y <= f(o.pos[1] - HOVER_MAX)) { y = f(o.pos[1] - HOVER_MAX); M.vy = 0; }
      M.pos = [o.pos[0], y, o.pos[2]];
    }
  }

  // FUN_0055cac8's drop for a killed actor a (a.rec = its section-1 record; FUN_0055a370 = its status)
  function drop(a) {
    if (!W || a.rec === undefined) return null;
    if ((a.flags28 ?? 0) & 4) return null;                  // FUN_0055cac8: actor +0x28 bit 2 (Vincent's) skips the drop
    if ((a.flags28 ?? 0) & 0x20) return null;               // actor +0x28 bit 5
    if ((a.f118 ?? 0) & 0x400000) return null;              // +0x118 bit 22
    const dr = (data.drops || {})[String(a.rec)];
    // FUN_00316d70
    let it = null;
    const fl = dr ? dr.flags >>> 0 : 0;
    if (SAVE_VERSION >= 0x1d && dr && ((fl >> 18) & 1)) it = null;               // status bit 18: none
    else if (SAVE_VERSION >= 0x1d && dr && ((fl >> 23) & 1)) it = [dr.id | 0, dr.count];
    else {
      const r1 = f(rng()), r2 = f(rng());                   // both drawn (FUN_0040b5c0 x 2)
      if (dr && Math.trunc(f(r1 * 100.0)) < dr.chance) {
        const r = Math.trunc(f(r2 * 100.0)), T = dr.table;
        let acc = T[0][2];
        if (r < acc) it = [T[0][0] | 0, T[0][1]];
        else for (let i = 1; ; i++) {
          if (i > 4) break;
          acc += T[i][2];
          if (acc > r) { it = [T[i][0] | 0, T[i][1]]; break; }
        }
      }
    }
    if (!it || it[0] === -1) return null;
    if (!inventory.rec(it[0])) return null;                 // FUN_00541688: FUN_00310560 == 0 -> no object
    const life = ((fl >> 14) & 1) ? -1 : DROP_LIFE;
    if (life < 0) warnOnce('items: FUN_00518968 (status bit 14 with FUN_00326500) not translated');
    else warnOnce('items: the drop\'s life timer (FUN_0053e9e0 -7 / -3, FUN_0057fe78) not translated: drops stay');
    // FUN_00541688(mgr, item, matrix at FUN_005636b0 = the actor's place, life, ...): a random yaw (one draw), active
    rng();
    const o = make({ id: 'd' + (nextDrop++), itemId: it[0], count: it[1], pos: a.pos.slice(0, 3).map(f) });
    list.push(o); W.objects.set(o.id, o);
    activate(o, 1);
    o.f200 |= 4; o.ca = a.rec;                              // +200 bit 2 (dropped), +0xca = the actor's +0x100
    // the place (FUN_0055cac8): FUN_0054b1d8(item, body C+0x3b0) when the actor has no parent (+8), its body has a
    // polygon (+0x3b0 +0x110), FUN_00359050(body) = body +0x14 - +0x4 < 1, C+0x1c0 bit 0x200, and not (FUN_0055bb40 =
    // actor state +0x104 in 0x80..0xbf, and C+0x564 bit 0x80000); else FUN_0057fb38: the room's first polygon below (from
    // 5 up to 300 down, flags 0x112 refuse it).
    // L: C+0x3b0 is the body's copy of the position (notes/route-states.md: one of five copies), = a.pos on the page;
    // page actors have no parent; FUN_00359050 is taken as 0 for a page body (its +0x0 / +0x10 points are not kept apart).
    const C = a.C || {};
    const onBody = (a.B ? a.B.poly != null : true) && (C.f1c0 & 0x200)
      && !(a.astate >= 0x80 && a.astate <= 0xbf && ((C.f564 ?? 0) & 0x80000));
    if (!onBody) {
      const g = ground ? ground(o.pos) : null;
      if (g) o.pos = [o.pos[0], f(g), o.pos[2]];
      warnOnce('items: FUN_0057fb38\'s object rays (FUN_005449f0) not translated');
    }
    place(o);                                               // vt+0x234 FUN_00580a58 -> FUN_00580388
    effect4800(o);                                          // FUN_00580410
    push(`drop ${o.id} ${it[0].toString(16)} x${it[1]} from ${a.rec}`);
    return o;
  }

  // object commands (FUN_00580d38 = vt+0xc): 0x1a4 -> +0xca; the rest FUN_0054cd70 (enemy_ai's generic cases)
  function cmd(o, c) { return c === 0x1a4 ? o.ca : undefined; }

  return {
    attach, restart, areaSwitch, sweep, update, drop, cmd, deleted, inventory, taken, list,
    id: k => (byRec.has(k) && !byRec.get(k).gone ? byRec.get(k).id : -1),
    t: { inRange, take, touch, activate, modelIndex },
  };
}
