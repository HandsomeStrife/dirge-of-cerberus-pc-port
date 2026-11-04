// fly_mover.js -- the body's move mode 1 (a straight move to a point), as the z128 boss uses it (worker 0231;
// notes/boss-research.md "The flying move"). The boss brain calls FUN_005889c8(actor, point) after FUN_0034ad00 set
// the rates; with C+0x1c0 bit 1 (cmd 0x157(1), boss state 0) the move follows a speed profile (accelerate, cruise,
// decelerate), else a constant speed. No three.js; C is the page body object (path_mover.js bodyInit fields plus
// f1e0 / f1e4 / f1e8 from cmd 0x156).
//
// Fields (body C): pos = +0x30, p110 = +0x110 start, p120 = +0x120 target, dir = +0x90, mm = +0x1c8 move mode,
// t = +0x1cc time, dur = +0x1d0, spd = +0x1d4, vel = +0x1d8, len = +0x1dc, f1e0 / f1e4 / f1e8 = top speed / accel /
// decel, prof = +0x1f0..+0x1fc (accel time, cruise time, decel time, total).

const f = Math.fround;

// FUN_00349e98(len, prof, rates): the profile's phase times for a distance (rates = [top, accel, decel])
export function profile(len, top, acc, dec) {
  const a = Math.abs(acc), d = Math.abs(dec);
  const ta = a > 0 ? f(top / a) : 0, td = d > 0 ? f(top / d) : 0;
  const ramp = f(top * (ta + td) * 0.5);
  if (len < ramp) {                                     // no cruise: the peak speed sqrt(2 len a d / (a + d))
    const v = f(Math.sqrt(f(f((len + len) * a) * d) / f(a + d)));
    const p0 = a > 0 ? f(v / a) : 0;
    const p2 = 0 < d ? f(v / d) : 0;
    return [p0, 0, p2, f(p0 + p2)];
  }
  const cruise = f((len - ramp) / top);
  return [ta, cruise, td, f(ta + cruise + td)];
}

// FUN_00349fb8(t, rates, prof): distance covered at time t
export function distAt(t, top, acc, dec, P) {
  if (P[3] <= t) return f(P[0] * P[0] * 0.5 * acc + P[1] * top + P[2] * P[2] * 0.5 * dec);
  if (P[0] <= t) {
    if (P[0] + P[1] <= t) {
      const r = P[3] - t;
      return f(f(P[0] * P[0] * 0.5 * acc + P[1] * top + P[2] * P[2] * 0.5 * dec) - r * r * 0.5 * dec);
    }
    return f(top * (P[0] * 0.5 + (t - P[0])));
  }
  return f(t * t * 0.5 * acc);
}

// FUN_0034a208(t, rates, prof): speed at time t
export function speedAt(t, top, acc, dec, P) {
  if (P[3] <= t) return dec === 0 ? top : 0;
  if (t < P[0]) return f(t * acc);
  if (P[0] + P[1] <= t) return f((P[3] - t) * dec);
  return top;
}

// FUN_005889c8(actor, point): FUN_0034add8 (start = pos), FUN_0034ae00 (target), FUN_0034db80(C, 1, 1) ->
// FUN_0034bd10 case 1. Returns false when the move did not start (distance < 0.001: FUN_0034d870(C, 0)).
// FUN_0034db80's param 3 path stop (C+0x300 != 0 -> FUN_00352a60) is the caller's (no path on the boss).
export function flyTo(C, point, warn = () => {}) {
  C.p110 = C.pos.slice(0, 3);                                                    // FUN_0034add8 (C+0x300 != 0xf)
  C.p120 = [f(point[0]), f(point[1]), f(point[2])];                               // FUN_0034ae00
  C.mm = 1;                                                                       // FUN_0034db80
  const old = C.f1c4 >>> 0;
  C.f1c4 = ((old & ~4) | 1) >>> 0;
  if (!(old & 0x10)) C.t = 0;
  // FUN_0034bd10 case 1
  C.pos = C.p110.slice();
  const d = [C.p120[0] - C.p110[0], C.p120[1] - C.p110[1], C.p120[2] - C.p110[2]];
  C.len = f(Math.hypot(d[0], d[1], d[2]));
  C.dir = C.len > 0 ? d.map(x => f(x / C.len)) : [0, 0, 0];
  // FUN_0034bd10 case 1: C+0x1dc < 0.001 -> C+0x1d8 = 0, returns 0 -> FUN_0034db80: C+0x1cc = 0, FUN_0034d870(C, 0)
  if (!(0.001 <= C.len)) { C.vel = 0; C.t = 0; arrive(C, 0); C.f1c0 = (C.f1c0 & ~0x800) >>> 0; return false; }
  if (C.f1c0 & 2) {
    C.prof = profile(C.len, C.f1e0, C.f1e4, C.f1e8);
    C.dur = C.prof[3];
  } else if (C.f1c0 & 1) {
    C.vel = C.spd;
    C.dur = f(C.len / C.spd);
  } else {
    // FUN_0034bd10's C+0x1c0 bits 0 / 1 clear branch (path timing C+0x31c / +0x328 / +0x32c) is not translated
    warn('fly_mover: mode-1 move without C+0x1c0 bit 0 / 1 (path timing) not translated: no move');
    C.mm = 0;
    return false;
  }
  if (C.f1c0 & 2) C.vel = f(C.len / C.dur);
  C.f1c0 = (C.f1c0 & ~0x800) >>> 0;
  return true;
}

// FUN_0034ea18's move branch for mode 1: FUN_0034c388 (case 1: fraction of the distance by the profile, or t / dur;
// position = start + (target - start) x fraction, FUN_002611f4), time += dt (DAT_0046e290 +0xc), and at the end
// FUN_0034d870(C, 1). The mode-1 ground drop FUN_00356d98 (body +0x3b0) is not translated (the caller's).
export function step(C, dt) {
  if (C.mm !== 1) return;
  let fr;
  if (C.f1c0 & 2) {
    fr = f(distAt(C.t, C.f1e0, C.f1e4, C.f1e8, C.prof) / C.len);
    C.vel = speedAt(C.t, C.f1e0, C.f1e4, C.f1e8, C.prof);
  } else {
    fr = f(C.t / C.dur);
    C.vel = (C.f1c0 & 1) ? C.spd : f(C.len / C.dur);
  }
  const a = C.p110, b = C.p120;
  C.pos = [f(a[0] + (b[0] - a[0]) * fr), f(a[1] + (b[1] - a[1]) * fr), f(a[2] + (b[2] - a[2]) * fr)];
  C.t = f(C.t + dt);
  if (!(C.t < C.dur) && !(C.dur < 0)) arrive(C, 1);
}

// FUN_0034d870(C, on) case 1: on -> snap to the target (when farther than 0.001); on = 0 jumps to the shared end without the
// snap (0x34d8a8's default label, iVar4 = 1). Either way mode 0 and C+0x1c4 = (&~1) | 4 (arrived: the boss brain waits on
// bit 2). The other modes' cases are not this mover's. The body listener's event 6 (+0x540) is not modelled.
export function arrive(C, on) {
  if (C.mm !== 1) return 0;
  const p = C.pos, q = C.p120;
  if (on && 0.001 < Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])) C.pos = q.slice();
  C.mm = 0;
  C.f1c4 = ((C.f1c4 & ~1) | 4) >>> 0;
  return 1;
}
