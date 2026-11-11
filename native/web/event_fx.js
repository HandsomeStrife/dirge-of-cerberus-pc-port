// Event effects (worker 0275): KerberosEffect.load / strid2numid / playseqstr_l / setVisible_l / stop2_l and the effect
// sequence command 0x1d, for the a-letter FEDs (FileCode 0x8xxx0000) on the menu manager DAT_004ee4a0. The opening's
// scanner (first_event: playseqstr_l(10, FEDEF_A0001_SCOPE01_IN_SCOPE01_IN) on Vincent's scanned body p014) is one.
// notes/story-cutscenes.md 'Effects in events'; T: GS dumps tools/trace/out/w275b (the scanner shot).
//   load(n)        FUN_003a2580 -> FUN_0037f2f0: command 0x18 (FUN_00381a08 loads aNNNN.fed); under Skip 0x7fffffff
//   strid2numid(s) FUN_003a1e58 -> FUN_002f5238: the FED by FUN_002df168(s + 6), its name table (FUN_002e50c8 -> FUN_002e5178)
//   playseqstr_l   FUN_003a1ea8 -> FUN_0037fb88 (the names -> ids) -> FUN_0037f728: command 0x1d -> FUN_00382cd8 each frame
//   setVisible_l   FUN_003a21c0 -> FUN_00379760: FUN_002ed828(mgr, id, b, 2) per id; stop2_l FUN_003a1638 -> FUN_00379808:
//                  FUN_002ed768(mgr, id, 1). Both queue per emitter (FUN_002edad8) for FUN_002edcc0 in FUN_002efc78 (begin)
// The page's manager: menu_fx.js createMenuFx over the exported event FEDs (data/event/fx, export_web_event_fx.py), drawn with
// menuFxLayer.
// GUESS: one page manager object per FED set (stage_info.js holds a0093 / a0211 in another) for the game's one
// DAT_004ee4a0 (notes/fidelity-audit.md 'Event effects: the menu manager split'). Other managers (ids >> 28 != 8) are warned.
import { LOAD_CMD } from './event_actor_rt.js';
import { menuManager, MGR_A } from './menu_fx.js';

const f32 = Math.fround;
// FUN_002df168: the letter's manager nibble, then 4 digits (DAT_0046c8c0: 1000, 100, 10, 1) << 18
const LETTER = { a: 8, e: 4, f: 2, g: 9, l: 10, m: 7, n: 5, o: 1, p: 3, r: 0, w: 6 };
export function fedCode(s, at = 0) {
  const k = LETTER[String.fromCharCode(s.charCodeAt(at) | 0x20)];
  if (k === undefined) return 0;
  let n = 0;
  for (let i = 1; i <= 4; i++) n = n + (s.charCodeAt(at + i) - 0x30) * [1000, 100, 10, 1][i - 1];
  return ((k << 28) | (n << 18)) >>> 0;
}
// DAT_0046f588: the sequence item types still run under Skip (0-5, 10)
const SKIP_TYPES = new Set([0, 1, 2, 3, 4, 5, 10]);
// FUN_002f0878's managers (0x4ee2e0 the impacts / gameplay, 0x4ee3c0 the level's): the ones FUN_0037f728 / FUN_00382cd8 keep under Skip
function mgrOf(id) {
  const t = id >>> 28;
  if (t === 8) return menuManager(id);
  if (t === 2) return 0x4ee3c0;
  if (t === 7) return 0x4ee660;
  if (t === 1 || t === 11 || t > 10) return 0;
  return 0x4ee2e0;
}
const skipKept = (id) => { const m = mgrOf(id); return m === 0x4ee3c0 || m === 0x4ee2e0; };

// base: the data URL root (data/event/fx/); fetchFed(n) -> Promise<ArrayBuffer|null>; createMenuFx: menu_fx.js's (injected for node tests)
export function createEventFx({ createMenuFx, fetchFed, rng = null, warn = (m) => console.warn(m) } = {}) {
  const warned = new Set();
  const warnOnce = (k, m) => { if (!warned.has(k)) { warned.add(k); warn(m); } };
  const feds = new Map();                  // FileCode -> ArrayBuffer (loaded)
  let mfx = null, mgr = null;              // menu_fx over the loaded FEDs; its DAT_004ee4a0 manager
  const queue = [];                        // FUN_002edad8's queue: { op: 2 | 3, em, vis, mode }
  const slots = new Map();                 // actor id -> 16 entries (slot +0xe4 .. : the emitter, +0xf0 the command handle)
  const rebuild = () => {
    mfx = createMenuFx([...feds.values()], { rng, warn: (m) => warnOnce(m, m) });
    mgr = mfx.mgrs.get(MGR_A) || null;
  };
  // the emitters of an id on its manager (FUN_002e6078 -> FUN_002e5f68 mode 0: **(em +0x78) == id)
  const emittersOf = (id) => (mgr && mgrOf(id) === MGR_A ? mgr.emitters.filter(em => (em.id >>> 0) === (id >>> 0)) : []);
  // FUN_002ed660(0, mgr, id): FUN_002e6290 (spawn, no position), +2 |= 0x200 when the age +0x1c is -1.0
  function spawn(id) {
    const m = mgrOf(id);
    if (m !== MGR_A) { warnOnce('mgr' + m, `event fx: effect 0x${(id >>> 0).toString(16)} on manager 0x${m.toString(16)} not on the page (only DAT_004ee4a0's a-FEDs): left out`); return null; }
    if (!mgr) { warnOnce('nofed', `event fx: no FED loaded for 0x${(id >>> 0).toString(16)}: left out`); return null; }
    const em = mgr.spawn(id >>> 0, [0, 0, 0]);
    if (!em) return null;
    if (em.age === -1) { em.flags |= 0x200; warnOnce('f200', 'event fx: emitter +2 bit 0x200 (FUN_002ed660, age -1) not translated'); }
    // FUN_002e8d50 / FUN_002e8df0 attach the emitter to the actor's MP / socket (FUN_002e7cd0 mode 1): only a camera-0 effect reads
    // them (param +4 bits 0x20 / 0x40); the page draws no camera-0 emitter of this manager (menu_fx.js: the 2D layer only)
    if (em.cat !== 1) em.noDraw = 'a camera-0 event effect (attached to an actor: FUN_002e8d50 / FUN_002e7cd0 mode 1 not translated)';
    return em;
  }
  // FUN_00375db8(ev, slot, id, h): an actor's play, in its first free entry of 16 (+0xe4 < 0); the emitter's end callback
  // FUN_002e8b80(.., 0x375c68, slot) frees the entry: on the page an entry whose emitter has left the manager is free
  function playOnActor(R, actor, id, h) {
    if (!actor.model) return;                                     // slot +0x1c (the MP) == 0
    if (R.skip !== 0 && !skipKept(id)) return;
    const E = slots.get(actor.id) || Array.from({ length: 16 }, () => null);
    slots.set(actor.id, E);
    const k = E.findIndex(e => !e || !mgr || !mgr.emitters.includes(e.em));
    if (k < 0) return;
    const em = spawn(id);
    if (!em) return;
    E[k] = { em, h, id };
  }
  // FUN_0037f400(ev, id): without an actor
  function playFree(R, id) {
    if (R.skip !== 0 && !skipKept(id)) return;
    if (mgrOf(id) !== 0) spawn(id);
  }
  // FUN_00382b70: the item types by the jump table 0x4a3520
  function item(c, R, type, id) {
    if (type === 0) {
      const a = R.actors && c.actor ? R.actors.get(c.actor) : null;   // FUN_0037a600: 0 for id 0 or no slot
      if (a) playOnActor(R, a, id, c.h); else playFree(R, id);
      return;
    }
    // 1 FUN_002e6be0 (stop), 2 / 3 FUN_00379680 (loop on / off), 4 / 5 FUN_002ebfb8 (show / hide), 6-9 FUN_00255180 / FUN_00255170,
    // 10 FUN_003826d8: not used by the page's events so far
    if (type < 0xb) warnOnce('type' + type, `event fx: sequence item type ${type} (jump table 0x4a3520) not translated`);
  }
  // FUN_00382cd8: command 0x1d each frame. +0x2c = the clock when the last item ran (0: unset); the items run while the frames
  // since then (ms x 0.06, FUN_003787d0) reach the item's time; a pad item (0xb .. 0x1c) or the last ends the frame's run
  function seq(c, R) {
    if (c.start === 0) c.start = R.clock;
    let t = f32(f32(Math.max(0, R.clock - c.start)) * f32(0.060000002));
    let i = c.idx, more = false;
    if (R.skip === 0) {
      while (i < c.n) {
        more = true;
        if (t < c.times[i]) break;
        const type = c.types[i] >>> 0;
        let pad = false;
        if (type - 0xb >>> 0 < 0x12) { pad = true; warnOnce('pad', 'event fx: sequence pad items (FUN_00382a48) not translated'); }
        else item(c, R, type, c.ids[i]);
        c.start = R.clock;
        t = 0;
        if (pad || c.n <= i + 1) { i++; more = i < c.n; break; }
        i++;
      }
      c.idx = i;
      if (more) return false;
    } else {
      for (; i < c.n; i++) {
        const type = c.types[i] >>> 0;
        if (type < 0x40 && SKIP_TYPES.has(type) && skipKept(c.ids[i])) item(c, R, type, c.ids[i]);
      }
    }
    return true;
  }
  // FUN_002f5238: -1 when the FED is not loaded or the name is not in its table (FUN_002e5178: length, byte sum, strcmp)
  function strid2numid(s) {
    if (s == null) return -1;
    const code = fedCode(s, 6), b = feds.get(code);
    if (!b) return -1;
    const v = new DataView(b), t = v.getUint32(0x18, true);
    if (!t) return -1;
    const name = s.slice(12);
    let sum = 0;
    for (let i = 0; i < name.length; i++) sum += name.charCodeAt(i);
    for (let k = 0; k < v.getUint16(t + 4, true); k++) {
      const e = t + 8 + 12 * k;
      if (v.getUint16(e + 6, true) !== name.length || v.getUint16(e + 4, true) !== (sum & 0xffff)) continue;
      const o = t + v.getUint32(e + 8, true);
      let same = true;
      for (let i = 0; i < name.length && same; i++) same = v.getUint8(o + i) === name.charCodeAt(i);
      if (same && v.getUint8(o + name.length) === 0) return v.getInt32(e, true);
    }
    return -1;
  }
  // FUN_00379760 / FUN_00379808: the ids a .. (b >= 0 ? b : a), at least a
  const idRange = (a, b) => { const out = []; let hi = b >= 0 ? b : a; if (hi < a) hi = a; for (let id = a; id <= hi && out.length < 0x10000; id++) out.push(id); return out; };
  const arr = (x) => (x && x.$arr ? x : null);

  const api = {
    feds,
    get mfx() { return mfx; },
    get mgr() { return mgr; },
    natives(R) {
      return {
        // load(n) (FUN_0037f2f0): Skip -> 0x7fffffff; else the load command (the page: until its fetch is done; a FED not exported warns)
        'fake/KerberosEffect.load(I)I': (vm, [n]) => {
          if (R.skip !== 0) return 0x7fffffff;
          const code = (0x80000000 | (n << 18)) >>> 0;
          if (feds.has(code)) return 0;
          const p = fetchFed ? fetchFed(n) : null;
          if (!p) { warnOnce('load' + n, `event fx: Effect.load(${n}) not exported (export_web_event_fx.py LOADS): its effects are left out`); return 0; }
          const h = R.cmd(LOAD_CMD, { done: false }), c = R.slots[R.slots.length - 1];
          p.then(b => {
            if (b && new DataView(b).getUint32(4, true) >>> 0 === code) { feds.set(code, b); rebuild(); }
            else warnOnce('load' + n, `event fx: Effect.load(${n}): no a${String(n).padStart(4, '0')}.fed (export_web_event_fx.py): its effects are left out`);
          }).finally(() => { c.done = true; });
          return h;
        },
        'fake/KerberosEffect.strid2numid(Ljava/lang/String;)I': (vm, [s]) => strid2numid(s == null ? null : String(s)),
        // FUN_003a1ea8: the three arrays of one length (int types, float times, String names), else 0
        'fake/KerberosEffect.playseqstr_l(I[I[F[Ljava/lang/String;)I': (vm, [actor, types, times, names]) => {
          const T = arr(types), M = arr(times), S = arr(names);
          if (!T || !M || !S || T.a.length !== M.a.length || M.a.length !== S.a.length) return 0;
          const n = S.a.length;
          if (n < 1) return 0;                                           // FUN_0037fb88
          const ids = S.a.map(s => strid2numid(s == null ? null : String(s)) | 0);
          const ty = T.a.map(x => x >>> 0);
          if (R.skip !== 0) {                                            // FUN_0037f728: a kept item, else 0x7fffffff
            if (!ty.some((x, i) => x < 0x40 && SKIP_TYPES.has(x) && skipKept(ids[i]))) return 0x7fffffff;
          }
          R.log.push([R.frameNo, 'fxseq ' + actor + ' ' + S.a.map(String).join(',')]);
          return R.cmd(0x1d, { actor, n, times: M.a.map(f32), ids, types: ty, idx: 0, start: 0 });
        },
        'fake/KerberosEffect.setVisible_l(ZII)V': (vm, [b, a, z]) => {
          for (const id of idRange(a | 0, z | 0)) for (const em of emittersOf(id)) queue.push({ op: 3, em, vis: b ? 1 : 0, mode: 2 });
          R.log.push([R.frameNo, 'fxvis ' + (b ? 1 : 0) + ' ' + ((a >>> 0).toString(16))]);
        },
        'fake/KerberosEffect.stop2_l(II)V': (vm, [a, z]) => {
          for (const id of idRange(a | 0, z | 0)) for (const em of emittersOf(id)) queue.push({ op: 2, em });   // FUN_002ed6c0's callback: the entry frees with the emitter
          R.log.push([R.frameNo, 'fxstop ' + ((a >>> 0).toString(16))]);
        },
      };
    },
    seq,
    // what menu_fx.js menuFxLayer reads (mfx.title), over the current manager (rebuilt when a FED loads)
    title: {
      fx: { get emitters() { return mfx ? mfx.title.fx.emitters : []; }, warn: (m) => warnOnce(m, m) },
      sprites() { return mfx ? mfx.title.sprites() : []; },
    },
    // FUN_002efc78: the managers' frame start (FUN_002e9f98), then FUN_002edcc0 (the queue: FUN_002edd28 per entry)
    begin(step) {
      if (mfx) mfx.begin(step);
      for (const q of queue.splice(0)) {
        if (q.op === 3) {                                               // FUN_002ebee8: b == 0 sets +0x0a bit `mode`, else clears it
          const bit = 1 << (q.mode & 31);
          q.em.f0a = q.vis === 0 ? (q.em.f0a | bit) : (q.em.f0a & ~bit);
        } else if (q.op === 2 && mgr) mgr.remove(q.em);                  // FUN_002e6920(mgr, em, 0)
      }
    },
    end() { if (mfx) mfx.end(); },
    reset() { queue.length = 0; slots.clear(); if (mfx) mfx.reset(); },
  };
  return api;
}
