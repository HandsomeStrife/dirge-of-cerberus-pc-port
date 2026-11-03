// event_vm.js -- the game's event-script VM: a JVM subset (worker 0210; notes/event-vm-research.md).
//
// Translated from the game's interpreter (PAL SLES_541.85):
//   FUN_003ad288   dispatch one instruction through the handler table at 0x470b80 (JVM opcodes 0x00-0xca);
//                  long ops -> stub 0x3aa048, double ops -> stub 0x3aa050 (the scripts use neither; refused here)
//   FUN_003a99f0   call a bytecode method: max_locals 8-byte slots (Code attribute +4), arguments copied from the
//                  operand stack (+1 for `this` unless static), run until the pc leaves the code, pop the frame
//   FUN_003aa7b8 / FUN_003aa998 / FUN_003aa8b0  invokestatic / invokevirtual / invokespecial: resolve the method
//                  (FUN_003a6bb8: class by name FUN_003a6928, method by name + descriptor FUN_003a88b8); method +0x0c
//                  != 0 -> the native C function (it pops its own arguments), else FUN_003a99f0
//   FUN_003a9c58   a missing method: the game prints an error and goes on (java/lang/Object.<init> is not loaded)
//   FUN_003aa3c8 / FUN_003aa470  monitorenter / monitorexit: hold / release the event mutex (+0x474) that the main
//                  loop also takes, so a synchronized block's commands land in one frame. The page's VM runs on the
//                  page's frame and never yields inside a block, which keeps that property.
// The game runs the VM on its own EE thread. A native that must wait (wait / sleep, FUN_00379d48 / FUN_003a0e48)
// loops: lock, test, unlock + RotateThreadReadyQueue, yield. The main thread lets the VM thread run once per frame
// (FUN_00377c68's start: FUN_003761a8(ev, 1) .. FUN_00376158(ev, 1)). Here a native returns `block(test, then)`:
// the VM stops, and each later `run()` (once per frame, from the event runtime) retests before going on.
// Interpreter frames are explicit (not JS recursion) so a block can suspend any depth of calls.

const f32 = Math.fround;

export class EventVM {
  static MAX_DEPTH = 16;
  constructor(data, natives, opts = {}) {
    this.classes = data.classes;          // name -> { name, super, cp, fields, methods }
    this.natives = natives;               // 'cls.name(desc)' -> fn(vm, args, self) -> value | block
    this.warn = opts.warn || ((m) => console.warn(m));
    this.statics = new Map();             // class name -> { field: value }
    this.inited = new Set();
    this.frames = [];
    this.pending = null;                  // { test, then, ret }
    this.done = false;
    this.steps = 0;
    this.warned = new Set();
    this.mcache = new Map();
  }

  warnOnce(key, msg) { if (!this.warned.has(key)) { this.warned.add(key); this.warn(msg); } }

  // the method (name + descriptor) on cls or its super classes (FUN_003a88b8 per class, FUN_003a6928 per name)
  findMethod(cls, name, desc) {
    const key = cls + '.' + name + desc;
    if (this.mcache.has(key)) return this.mcache.get(key);
    let c = this.classes[cls], hit = null;
    while (c && !hit) {
      const m = c.methods.find(x => x.name === name && x.desc === desc);
      if (m) hit = { cls: c.name, m };
      else c = c.super ? this.classes[c.super] : null;
    }
    this.mcache.set(key, hit);
    return hit;
  }

  static argSlots(desc) {
    const s = desc.slice(1, desc.indexOf(')')); let i = 0, n = 0;
    while (i < s.length) {
      while (s[i] === '[') i++;
      i = s[i] === 'L' ? s.indexOf(';', i) + 1 : i + 1; n++;
    }
    return n;
  }

  static retKind(desc) { return desc[desc.indexOf(')') + 1]; }

  // start a static method (main([Ljava/lang/String;)V gets an empty array, as FUN_003a9b88's caller passes)
  start(cls, name, desc, args = []) {
    const hit = this.findMethod(cls, name, desc);
    if (!hit) throw new Error('event VM: no ' + cls + '.' + name + desc);
    this.done = false;
    this.pushFrame(hit, args);
  }

  pushFrame(hit, args) {
    // FUN_003a99f0 keeps each call depth's locals / stack bases in 4-byte arrays at +0x123b0 / +0x123f0 (0x40 bytes:
    // 16 depths); a deeper call would write past them. The page refuses one (no script nests that deep).
    if (this.frames.length >= EventVM.MAX_DEPTH) throw new Error('event VM: call depth over ' + EventVM.MAX_DEPTH + ' (the VM\'s per-depth arrays, FUN_003a99f0)');
    const m = hit.m;
    if (!m.bytes) m.bytes = Uint8Array.from(m.code.match(/../g) || [], h => parseInt(h, 16));
    const locals = new Array(Math.max(m.maxLocals || 0, args.length)).fill(0);
    for (let i = 0; i < args.length; i++) locals[i] = args[i];
    this.frames.push({ cls: hit.cls, cp: this.classes[hit.cls].cp, m, code: m.bytes, pc: 0, locals, stack: [] });
  }

  // a class's static initialiser runs on first static access (the game: the loader; here lazily, before the access)
  // the superclass first (its frame runs before this class's: pushed last)
  ensureInit(cls) {
    if (this.inited.has(cls)) return false;
    this.inited.add(cls);
    if (!this.statics.has(cls)) this.statics.set(cls, {});
    let pushed = false;
    const ci = this.findMethod(cls, '<clinit>', '()V');
    if (ci && ci.cls === cls) { this.pushFrame(ci, []); pushed = true; }
    const sup = this.classes[cls] && this.classes[cls].super;
    if (sup && this.classes[sup] && this.ensureInit(sup)) pushed = true;
    return pushed;
  }

  // call a method from an invoke: native -> the JS translation; bytecode -> a new frame
  invoke(hit, cls, name, desc, args, self) {
    const key = cls + '.' + name + desc;
    if (!hit) {
      if (name === '<init>') return { value: undefined };          // java/lang/Object.<init> (not loaded; FUN_003a9c58)
      this.warnOnce(key, 'event VM: no method ' + key + ' (skipped, as FUN_003a9c58)');
      return { value: 0 };
    }
    if (hit.m.access & 0x100) {
      const nkey = hit.cls + '.' + name + desc;
      const fn = this.natives[nkey];
      if (!fn) {
        this.warnOnce(nkey, 'event VM: native ' + nkey + ' not translated (left out)');
        return { value: EventVM.retKind(desc) === 'V' ? undefined : (EventVM.retKind(desc) === 'L' || EventVM.retKind(desc) === '[' ? null : 0) };
      }
      return { value: fn(this, args, self) };
    }
    this.pushFrame(hit, self === undefined ? args : [self, ...args]);
    return { frame: true };
  }

  // run until the script blocks (a wait) or ends; returns 'blocked' | 'done'
  run(maxSteps = 1e6) {
    if (this.pending) {
      if (!this.pending.test()) return 'blocked';
      const p = this.pending; this.pending = null;
      const v = p.then ? p.then() : undefined;
      if (p.ret !== 'V') this.frames[this.frames.length - 1].stack.push(v);
    }
    let n = 0;
    while (this.frames.length) {
      if (++n > maxSteps) throw new Error('event VM: step limit');
      const r = this.step();
      if (r === 'block') return 'blocked';
    }
    this.done = true;
    return 'done';
  }

  // one instruction of the top frame (the handlers of the table at 0x470b80)
  step() {
    const F = this.frames[this.frames.length - 1];
    const c = F.code, S = F.stack, L = F.locals;
    const pc = F.pc, op = c[pc];
    this.steps++;
    const s8 = (o) => (c[pc + o] << 24) >> 24;
    const u16 = (o) => (c[pc + o] << 8) | c[pc + o + 1];
    const s16 = (o) => (u16(o) << 16) >> 16;
    const s32 = (o) => (c[o] << 24) | (c[o + 1] << 16) | (c[o + 2] << 8) | c[o + 3];
    const br = (cond) => { F.pc = cond ? pc + s16(1) : pc + 3; };
    let x, y, a;
    switch (op) {
      case 0x00: F.pc++; return;
      case 0x01: S.push(null); F.pc++; return;
      case 0x02: case 0x03: case 0x04: case 0x05: case 0x06: case 0x07: case 0x08: S.push(op - 3); F.pc++; return;
      case 0x0b: case 0x0c: case 0x0d: S.push(op - 0x0b); F.pc++; return;            // fconst 0 / 1 / 2
      case 0x10: S.push(s8(1)); F.pc += 2; return;
      case 0x11: S.push(s16(1)); F.pc += 3; return;
      case 0x12: S.push(this.constant(F, c[pc + 1])); F.pc += 2; return;
      case 0x13: S.push(this.constant(F, u16(1))); F.pc += 3; return;
      case 0x15: case 0x17: case 0x19: S.push(L[c[pc + 1]]); F.pc += 2; return;     // iload / fload / aload
      case 0x1a: case 0x1b: case 0x1c: case 0x1d: S.push(L[op - 0x1a]); F.pc++; return;
      case 0x22: case 0x23: case 0x24: case 0x25: S.push(L[op - 0x22]); F.pc++; return;
      case 0x2a: case 0x2b: case 0x2c: case 0x2d: S.push(L[op - 0x2a]); F.pc++; return;
      case 0x2e: case 0x30: case 0x32: case 0x33: case 0x34: case 0x35:                 // xaload
        y = S.pop(); a = S.pop(); S.push(this.arr(a, y).a[y]); F.pc++; return;
      case 0x36: case 0x38: case 0x3a: L[c[pc + 1]] = S.pop(); F.pc += 2; return;
      case 0x3b: case 0x3c: case 0x3d: case 0x3e: L[op - 0x3b] = S.pop(); F.pc++; return;
      case 0x43: case 0x44: case 0x45: case 0x46: L[op - 0x43] = S.pop(); F.pc++; return;
      case 0x4b: case 0x4c: case 0x4d: case 0x4e: L[op - 0x4b] = S.pop(); F.pc++; return;
      case 0x4f: case 0x51: case 0x53: case 0x54: case 0x55: case 0x56: {             // xastore
        const v = S.pop(); y = S.pop(); a = S.pop(); this.arr(a, y);
        a.a[y] = op === 0x54 ? (v << 24) >> 24 : op === 0x55 ? v & 0xffff : op === 0x56 ? (v << 16) >> 16 : v;
        F.pc++; return;
      }
      case 0x57: S.pop(); F.pc++; return;
      case 0x58: S.pop(); S.pop(); F.pc++; return;
      case 0x59: S.push(S[S.length - 1]); F.pc++; return;
      case 0x5a: x = S.pop(); y = S.pop(); S.push(x, y, x); F.pc++; return;
      case 0x5b: x = S.pop(); y = S.pop(); a = S.pop(); S.push(x, a, y, x); F.pc++; return;
      case 0x5c: x = S.pop(); y = S.pop(); S.push(y, x, y, x); F.pc++; return;
      case 0x5f: x = S.pop(); y = S.pop(); S.push(x, y); F.pc++; return;
      case 0x60: y = S.pop(); x = S.pop(); S.push((x + y) | 0); F.pc++; return;
      case 0x62: y = S.pop(); x = S.pop(); S.push(f32(x + y)); F.pc++; return;
      case 0x64: y = S.pop(); x = S.pop(); S.push((x - y) | 0); F.pc++; return;
      case 0x66: y = S.pop(); x = S.pop(); S.push(f32(x - y)); F.pc++; return;
      case 0x68: y = S.pop(); x = S.pop(); S.push(Math.imul(x, y)); F.pc++; return;
      case 0x6a: y = S.pop(); x = S.pop(); S.push(f32(x * y)); F.pc++; return;
      case 0x6c: y = S.pop(); x = S.pop(); if (y === 0) this.divZero(F, pc); S.push((x / y) | 0); F.pc++; return;
      case 0x6e: y = S.pop(); x = S.pop(); S.push(f32(x / y)); F.pc++; return;
      case 0x70: y = S.pop(); x = S.pop(); if (y === 0) this.divZero(F, pc); S.push((x % y) | 0); F.pc++; return;
      case 0x72: y = S.pop(); x = S.pop(); S.push(f32(x % y)); F.pc++; return;
      case 0x74: S.push((-S.pop()) | 0); F.pc++; return;
      case 0x76: S.push(f32(-S.pop())); F.pc++; return;
      case 0x78: y = S.pop(); x = S.pop(); S.push(x << (y & 31)); F.pc++; return;
      case 0x7a: y = S.pop(); x = S.pop(); S.push(x >> (y & 31)); F.pc++; return;
      case 0x7c: y = S.pop(); x = S.pop(); S.push((x >>> (y & 31)) | 0); F.pc++; return;
      case 0x7e: y = S.pop(); x = S.pop(); S.push(x & y); F.pc++; return;
      case 0x80: y = S.pop(); x = S.pop(); S.push(x | y); F.pc++; return;
      case 0x82: y = S.pop(); x = S.pop(); S.push(x ^ y); F.pc++; return;
      case 0x84: L[c[pc + 1]] = (L[c[pc + 1]] + s8(2)) | 0; F.pc += 3; return;
      case 0x86: S.push(f32(S.pop())); F.pc++; return;                                 // i2f
      case 0x8b: x = S.pop(); S.push(Number.isNaN(x) ? 0 : x >= 2147483647 ? 2147483647 : x <= -2147483648 ? -2147483648 : Math.trunc(x)); F.pc++; return;
      case 0x91: S.push((S.pop() << 24) >> 24); F.pc++; return;
      case 0x92: S.push(S.pop() & 0xffff); F.pc++; return;
      case 0x93: S.push((S.pop() << 16) >> 16); F.pc++; return;
      case 0x95: case 0x96:                                                             // fcmpl / fcmpg
        y = S.pop(); x = S.pop();
        S.push(Number.isNaN(x) || Number.isNaN(y) ? (op === 0x95 ? -1 : 1) : x > y ? 1 : x < y ? -1 : 0); F.pc++; return;
      case 0x99: br(S.pop() === 0); return;
      case 0x9a: br(S.pop() !== 0); return;
      case 0x9b: br(S.pop() < 0); return;
      case 0x9c: br(S.pop() >= 0); return;
      case 0x9d: br(S.pop() > 0); return;
      case 0x9e: br(S.pop() <= 0); return;
      case 0x9f: y = S.pop(); x = S.pop(); br(x === y); return;
      case 0xa0: y = S.pop(); x = S.pop(); br(x !== y); return;
      case 0xa1: y = S.pop(); x = S.pop(); br(x < y); return;
      case 0xa2: y = S.pop(); x = S.pop(); br(x >= y); return;
      case 0xa3: y = S.pop(); x = S.pop(); br(x > y); return;
      case 0xa4: y = S.pop(); x = S.pop(); br(x <= y); return;
      case 0xa5: y = S.pop(); x = S.pop(); br(x === y); return;
      case 0xa6: y = S.pop(); x = S.pop(); br(x !== y); return;
      case 0xa7: F.pc = pc + s16(1); return;
      case 0xaa: {                                                                      // tableswitch
        const q = (pc + 4) & ~3, def = s32(q), lo = s32(q + 4), hi = s32(q + 8); x = S.pop();
        F.pc = pc + (x < lo || x > hi ? def : s32(q + 12 + 4 * (x - lo))); return;
      }
      case 0xab: {                                                                      // lookupswitch
        const q = (pc + 4) & ~3, def = s32(q), n = s32(q + 4); x = S.pop(); let t = def;
        for (let i = 0; i < n; i++) if (s32(q + 8 + 8 * i) === x) { t = s32(q + 12 + 8 * i); break; }
        F.pc = pc + t; return;
      }
      case 0xac: case 0xae: case 0xb0: x = S.pop(); this.frames.pop(); this.frames[this.frames.length - 1]?.stack.push(x); return;
      case 0xb1: this.frames.pop(); return;
      case 0xb2: case 0xb3: {                                                           // getstatic / putstatic
        const r = F.cp[u16(1)], owner = this.staticOwner(r[1], r[2]);
        if (this.ensureInit(owner)) return;                                             // <clinit> first, then retry
        const st = this.statics.get(owner);
        if (op === 0xb2) S.push(st[r[2]] ?? (r[3][0] === 'L' || r[3][0] === '[' ? null : 0)); else st[r[2]] = S.pop();
        F.pc += 3; return;
      }
      case 0xb4: { const r = F.cp[u16(1)]; a = S.pop(); S.push(this.obj(a, r).f[r[2]] ?? (r[3][0] === 'L' || r[3][0] === '[' ? null : 0)); F.pc += 3; return; }
      case 0xb5: { const r = F.cp[u16(1)]; const v = S.pop(); a = S.pop(); this.obj(a, r).f[r[2]] = v; F.pc += 3; return; }
      case 0xb6: case 0xb7: case 0xb8: case 0xb9: {                                     // invokevirtual / special / static / interface
        const r = F.cp[u16(1)], [, cls, name, desc] = r, n = EventVM.argSlots(desc);
        if (op === 0xb8 && this.ensureInit(cls)) return;
        const args = S.splice(S.length - n, n);
        let self, hit;
        if (op === 0xb8) hit = this.findMethod(cls, name, desc);
        else {
          self = S.pop();
          hit = op === 0xb7 ? this.findMethod(cls, name, desc) : this.findMethod(self && self.$class ? self.$class : cls, name, desc);
        }
        F.pc += op === 0xb9 ? 5 : 3;
        const res = this.invoke(hit, cls, name, desc, args, self);
        if (res.frame) return;
        const v = res.value, rk = EventVM.retKind(desc);
        if (v && v.$block) { this.pending = { test: v.test, then: v.then, ret: rk }; return 'block'; }
        if (rk !== 'V') S.push(v === undefined ? 0 : v);
        return;
      }
      case 0xbb: {                                                                      // new
        const cn = F.cp[u16(1)][1];
        if (this.ensureInit(cn)) return;
        S.push({ $class: cn, f: {} }); F.pc += 3; return;
      }
      case 0xbc: x = S.pop(); S.push({ $arr: true, kind: c[pc + 1], a: new Array(Math.max(0, x)).fill(0) }); F.pc += 2; return;
      case 0xbd: x = S.pop(); S.push({ $arr: true, kind: 'L', a: new Array(Math.max(0, x)).fill(null) }); F.pc += 3; return;
      case 0xbe: a = S.pop(); S.push(this.arr(a, 0).a.length); F.pc++; return;
      case 0xc0: F.pc += 3; return;                                                     // checkcast (no type errors in the scripts)
      case 0xc2: case 0xc3: S.pop(); F.pc++; return;                                    // monitorenter / exit (see the header)
      case 0xc6: br(S.pop() === null); return;
      case 0xc7: br(S.pop() !== null); return;
      case 0xc8: F.pc = pc + s32(pc + 1); return;
      default:
        throw new Error('event VM: opcode 0x' + op.toString(16) + ' at ' + F.cls + '.' + F.m.name + ' pc ' + pc
          + (op === 0xbf ? ' (athrow: no exception handling; the scripts only throw from monitor handlers)' : ''));
    }
  }

  // idiv / irem by 0: not decoded (the handlers' MIPS div by 0 leaves HI / LO undefined); no script divides by 0, so
  // the page refuses rather than invent a result
  divZero(F, pc) {
    throw new Error('event VM: integer division by 0 at ' + F.cls + '.' + F.m.name + ' pc ' + pc + ' (not decoded; refused)');
  }

  constant(F, i) {
    const k = F.cp[i];
    if (!k) throw new Error('event VM: bad constant ' + i);
    return k[0] === 'float' ? f32(k[1]) : k[1];
  }

  // the class that declares a static field (walks supers; the first one that declares it)
  staticOwner(cls, name) {
    let c = this.classes[cls];
    while (c) { if (c.fields.some(f => f.name === name)) return c.name; c = c.super ? this.classes[c.super] : null; }
    return cls;
  }

  arr(a, i) {
    if (!a || !a.$arr) throw new Error('event VM: null / not an array');
    if (i < 0 || i >= a.a.length) throw new Error('event VM: array index ' + i + ' out of range ' + a.a.length);
    return a;
  }

  obj(a, r) {
    if (!a || a.$arr || typeof a !== 'object') throw new Error('event VM: field ' + r[2] + ' of a null / non-object');
    return a;
  }
}

// a native's "wait until test() holds, then return then()" (the game's polling loops; see the header)
export function block(test, then) { return { $block: true, test, then }; }
