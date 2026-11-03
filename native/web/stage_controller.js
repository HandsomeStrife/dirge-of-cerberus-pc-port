// stage_controller.js -- z128's stage controller: ev0100 scr000 `main` run on worker 0210's event VM (worker 0219;
// notes/stage-controller.md). main is the level's story: a state machine on the stage's event flags (Zone flags) and
// the global flags (Event flags) that runs each beat's event method, switches battle / event mode, streams chunks
// (load(128, a, b)), changes music, saves checkpoints and ends the section.
//
// Built on event_rt.js / event_vm.js (not edited here): StageRuntime extends EventRuntime with the natives main and its
// event methods call, the skip state and command 4 (the zone load); StageVM extends EventVM with the VM thread's
// preemption. Translated from the game (PAL SLES_541.85); each native cites its C function (method +0x0c of the
// library class, read from the class registry DAT_004ef498 in the save).
//
// The VM thread (FUN_00372dd8, created by FUN_00373098 at priority 0x5a) sits below the main thread: it runs whenever
// the main thread waits for the frame, so a polling loop in a script (main's `while (no flag) deb_jump()`) runs in the
// frame's idle time, preempted, not blocked. StageVM.run takes a step budget per frame and goes on next frame.
//
// Skip (the path decoded; WHEN to skip is the page's GUESS: it chooses Skip in every event, at the event's first wait, as
// a stand-in for the player; ?autoskip=0 (opts.autoSkip false) leaves the events to play out):
//   FUN_003c0520 (the pause menu) offers Skip when FUN_003e0d00() == 0 (DAT_004f3044 bit 0x2000: enableSkip(0) sets
//   it, FUN_003e0cc8; the stage title card FUN_003fdb48 too); choosing it: FUN_003c0110 -> FUN_003dfdc8: if
//   FUN_003dfd18 (+0x1558 & 0x102000000000 == 0x100000000000: an event program runs, bit 44 from FUN_00374d08 /
//   FUN_00374e38, and not battle mode, bit 37) -> FUN_00372f70: +0x156c = 1, +0x1558 |= 1 << 36. FUN_00377c68's end:
//   1 -> 2. With +0x156c != 0: isSkip() true (FUN_003a0d88), sleep ends (FUN_003a0e48), timers end (FUN_00377c68 case
//   0x1c), playMusic3 / playMusic2 take their skip branch; with 2 a camera move jumps to its end (FUN_003779d0).
//   battle (FUN_0037cf30) sets +0x156c = 0 and bit 37.

import { EventRuntime } from './event_rt.js';
import { EventVM, block } from './event_vm.js';

const f32 = Math.fround;

// GUESS: the VM thread's instructions per frame (the game's count is the main thread's idle time; not decoded). Any
// budget that lets one poll loop iteration finish gives the same result: what a poll reads only changes on the main
// thread, between VM windows (notes/fidelity-audit.md 'GUESS: the stage VM's steps per frame').
export const STEP_BUDGET = 5000;

// methods the page plays elsewhere. ev0101.first_event (the opening, scr001) is played by intro.js (worker 0210 / 0218):
// main's call waits there until opts.openingDone() (the hand-off), then returns; without opts.openingDone it returns at
// once (the page started from the save, past the opening).
export const PLAYED_ELSEWHERE = ['ev0101.first_event()V'];

class StageVM extends EventVM {
  constructor(data, natives, opts) {
    super(data, natives, opts);
    this.played = new Set(opts.played || []);
    this.budget = opts.budget || STEP_BUDGET;
    this.calls = [];                        // event methods entered, each once, in first-call order (tests)
  }

  invoke(hit, cls, name, desc, args, self) {
    const key = cls + '.' + name + desc;
    if (this.played.has(key)) return { value: this.onPlayed ? this.onPlayed(key) : undefined };
    if (hit && !(hit.m.access & 0x100) && /^ev\d{4}$/.test(hit.cls) && !this.calls.includes(hit.cls + '.' + name)) this.calls.push(hit.cls + '.' + name);
    return super.invoke(hit, cls, name, desc, args, self);
  }

  // one VM window: until the script blocks, ends, or its frame's steps run out (preempted; goes on next frame)
  run() {
    if (this.pending) {
      if (!this.pending.test()) return 'blocked';
      const p = this.pending; this.pending = null;
      const v = p.then ? p.then() : undefined;
      if (p.ret !== 'V') this.frames[this.frames.length - 1].stack.push(v);
    }
    let n = 0;
    while (this.frames.length) {
      if (++n > this.budget) return 'preempted';
      if (this.step() === 'block') return 'blocked';
    }
    this.done = true;
    return 'done';
  }

  // the method running now (for the skip-branch log)
  where() { const F = this.frames[this.frames.length - 1]; return F ? F.cls + '.' + F.m.name + ' pc ' + F.pc : '-'; }
}

export class StageRuntime extends EventRuntime {
  constructor(data, o = {}) {
    super(data, { warn: o.warn, lang: o.lang });
    this.o = o;
    // +0x156c. opts.skip: its value at the hand-off (the opening's runtime, intro.js: 2 when the player skipped it), so
    // main's isSkip() after first_event takes the game's branch (kalm_ld(100)) until battle() clears it (worker 0222)
    this.skip = o.skip ?? 0;
    // main's prelude runs before the opening (asj_033 at f20, then scr001's asj_036 replaces it: T w222_snd). Until
    // first_event returns its sounds are logged only: the page's opening sound (play.js / event_sound.js, worker 0222)
    // owns that stretch, and from the save the prelude is already past
    this.beforeOpening = true;
    this.skipMode = 0;                // +0x9860 (setSkipMode bits)
    this.battle = true;               // +0x1558 bit 37. T: set in the save and at the hand-off (trace_w205_reload)
    this.running = true;              // +0x1558 bit 44: the event program runs (FUN_00374d08), set before main
    this.skipOff = false;             // DAT_004f3044 bit 0x2000 (FUN_003e0cc8 / FUN_003e0d00)
    this.autoSkip = o.autoSkip !== false;
    // DAT_0050db20 (stored XOR DAT_0046f608; kept plain here). A new controller = a stage (re)load: all 0. The clearing is
    // traced only (w210 start1704: 0 mid stage load); its writer is not decoded
    this.gflags = o.globalFlags || new Uint8Array(64);
    this.peaceN = 0;                  // DAT_0046f854 (FUN_003809a8's peace count)
    this.cardOn = false; this.cardSaved = false;
    this.sectionStat = {};            // KerberosIntermission section stats (FUN_003a53e0)
    this.zoneCmd = null;              // the live command 4 (+0x985c: one at a time)
    this.music = null;                // the last music request (tests)
    this.vm = new StageVM(data, this.natives(), { warn: this.warn, played: o.played || PLAYED_ELSEWHERE, budget: o.budget });
    this.vm.onPlayed = (k) => {
      const end = () => {
        this.beforeOpening = false;
        // the opening's +0x156c at its end (intro.js / event_rt.js Skip, worker 0222): main's isSkip() after first_event
        if (o.openingSkip) this.skip = o.openingSkip() | 0;
        this.log.push([this.frameNo, 'played elsewhere ' + k]);
      };
      if (o.openingDone && !o.openingDone()) return block(() => o.openingDone(), end);
      end(); return undefined;
    };
  }

  // the current world's stage flags (DAT_0047dbb0 +0x38): enemy_ai's eventFlags, looked up every time (a Restart
  // replaces the world; worker 0212's rule)
  zf() { const f = this.o.flags && this.o.flags(); if (!f) this.warnOnce('stage: no enemy_ai world: Zone flags read 0, writes lost'); return f; }

  warnOnce(m) { this.vm.warnOnce(m, m); }

  // FUN_003dfd18 + FUN_003e0d00: the pause menu's Skip is offered and takes. DAT_004f3044 bit 0x2000 = enableSkip(0)
  // (skipOff) or a stage-info card up (FUN_003fdb48 sets it, FUN_003fdd58 clears it unless it was set before: cardSaved)
  skippable() { return this.running && !this.battle && !this.skipOff && !this.cardOn; }

  // FUN_003fdd58's half: the card is down (worker 0220's stage_info.js) -> the bit back as FUN_003fdb48 found it
  cardStep() {
    if (!this.cardOn) return;
    const si = this.o.stageInfo && this.o.stageInfo();
    if (si && si.isDisplay(-1)) return;
    this.cardOn = false;
    if (this.cardSaved) this.skipOff = true;
  }

  // FUN_00372f70 (the Skip choice): event_rt.js's (its +0x156c guard, the event sounds' and windows' skip; worker 0222)
  requestSkip() {
    if (!super.requestSkip()) return false;
    this.log.push([this.frameNo, 'skip ' + this.vm.where()]);
    return true;
  }

  frame(dtMs = 20) {
    this.frameNo++;
    if (this.log.length > 4000) this.log.splice(0, 2000);              // page memory: the log is for tests
    if (!this.vm.done) this.vm.run();                                   // the VM thread's time this frame
    this.cardStep();
    this.clock = (this.clock + dtMs) >>> 0;                              // FUN_003798a0
    for (const c of this.slots.slice()) {                                // FUN_00377c68's slot loop, slots in order
      let fin = false;
      if (c.type === 0x1c) fin = this.skip !== 0 || this.clock >= c.until;   // case 0x1c
      else if (c.type === 7) fin = this.camMove(c);                      // case 7: FUN_003779d0
      else if (c.type === 4) fin = this.zoneStep(c);                     // case 4: FUN_00381518
      if (fin) {
        this.slots.splice(this.slots.indexOf(c), 1);
        if (c === this.zoneCmd) this.zoneCmd = null;
      }
    }
    if (this.skip === 1) this.skip = 2;                                  // FUN_00377c68's tail
    if (!this.battle) this.camOutput(); else this.view = null;           // FUN_00379148 only out of battle mode
    // GUESS: the page chooses Skip for every event, once the menu would offer it and the event has reached a wait (its
    // code up to there runs as unskipped). The player's own timing is not the game's code (w219_skip: ✕ 63 frames into
    // rv_matiawase). It forces main's skip branches (heri_taijou -> no sk_mituketa2, heri_lasted -> no kita_ev0145) and
    // a skipped event's timing; ?autoskip=0 (opts.autoSkip false) turns it off (notes/fidelity-audit.md 'GUESS: auto-skip').
    // The pause menu runs after the event update, so +0x156c goes 1 -> 2 on the next frame (T w219_skip: f961 / f962)
    if (this.autoSkip && this.skip === 0 && this.skippable() && !this.vm.done && this.vm.pending) this.requestSkip();
  }

  // FUN_003779d0: with +0x156c == 2 the key time is the move's end
  camMove(c) {
    if (this.skip !== 2) return super.camMove(c);
    const cam = this.cams[c.cam];
    let tc = cam.tmin <= c.to ? c.to : cam.tmin;
    if (cam.tmax < tc) tc = cam.tmax;
    if (cam.spl) this.camEval(cam, tc);
    return true;
  }

  // command 4 (FUN_0037a3b8: zone, a, b) run by FUN_00381518. The zone is loaded (FUN_00269bb0 >= 0) from the stage
  // load on, so: state 0 waits for FUN_00267358 (the stream idle), then FUN_002677a0(a, b), again once idle, done
  // when idle. The page's stream is area_stream.js (worker 0216): request = FUN_002677a0, busy = DAT_004e4c50.
  zoneStep(c) {
    const s = this.o.stream && this.o.stream();
    if (!s) { this.warnOnce('stage: no area stream: load(' + c.zone + ', ' + c.a + ', ' + c.b + ') done at once'); return true; }
    switch (c.st) {
      case 0: if (s.busy) return false; c.st = 2;                        // falls through (cases 0 -> 1 -> 2)
      case 2: s.request(c.a, c.b); c.st = 3; // falls through
      case 3: if (s.busy) return false; s.request(c.a, c.b); c.st = 4; // falls through
      case 4: if (s.busy) return false; c.st = 0; return true;
    }
    return true;
  }

  // FUN_0037cf30(ev, n): battle mode. Translated: the zone-load waits (types 0x1a / 0x1b / 2 / 0x12), FUN_0037fc88,
  // the frame sync FUN_0037e4e0, cameras' active flags cleared (+0x334 .. step -0x90), +0x1560 (n > 0: clock + n),
  // +0x156c = 0, bit 37 set, game-state bit 2 cleared (FUN_00326040(2)), bit 6 set then cleared (FUN_00325b10).
  enterBattle(n) {
    this.warnOnce('stage: FUN_0037cf30\'s sound / effect / HUD calls (FUN_003eebc0, FUN_003e8888, FUN_003e6eb8, FUN_00241760, the event actors\' release FUN_00376890 / FUN_00376c80, FUN_00324128 ...) left out');
    const gs = this.o.gameState && this.o.gameState();
    if (gs) { gs.clear(2); gs.clear(6); }
    this.cams.forEach(c => { c.active = false; });
    this.skip = 0;
    this.battle = true;
    this.battleTimer = n > 0 ? n : 0;
    this.log.push([this.frameNo, 'battle ' + n]);
    if (this.o.onMode) this.o.onMode('battle');
  }

  // FUN_0037e048(ev, n): event mode: +0x9864 = n, waits (the stream FUN_00267358, +0x1560, ...), bit 37 cleared,
  // game-state bit 2 set (FUN_00326018(2))
  enterEvent(n) {
    this.warnOnce('stage: FUN_0037e048\'s waits and calls (FUN_003e9950, FUN_0037ddd0, FUN_005a6d70, FUN_0037dbf8, FUN_003e8888 / FUN_003e6538 ...) left out');
    const gs = this.o.gameState && this.o.gameState();
    // FUN_002419d8(0) == 0 (DAT_004b8ac8 bit 0: 0 in the z128 states): FUN_0037dc78(ev, 1), FUN_0037def0(ev, 1) ->
    // FUN_00325b10(1): game-state bit 6, the AI paused (enemy_ai FUN_00365008); then FUN_00326018(2)
    if (gs) { gs.set(6); gs.set(2); }
    this.battle = false;
    this.log.push([this.frameNo, 'event ' + n]);
    if (this.o.onMode) this.o.onMode('event');
  }

  // FUN_0037e4e0: +0x9866 = 1, then poll until FUN_00377c68 has counted it down (the next frame's window)
  syncFrame() { const f = this.frameNo; return block(() => this.frameNo > f); }

  natives() {
    const R = this, o = () => R.o;
    const N = super.natives();
    const gs = () => o().gameState && o().gameState();
    const log = (m) => R.log.push([R.frameNo, m]);
    const str = (s) => (typeof s === 'string' ? s : s == null ? null : String(s));
    Object.assign(N, {
      // sleep (FUN_003a0e48): poll while (n == 0 or clock - start < n), the abort bit (+0x1558 bit 33) clear and
      // +0x156c == 0. The abort bit is never set on the page (its writers: the stage exit, not translated).
      'fake/KerberosEvent.sleep(I)V': (vm, [n]) => {
        const t0 = R.clock, u = n >>> 0;
        return block(() => R.skip !== 0 || (u !== 0 && ((R.clock - t0) >>> 0) >= u));
      },
      // ---- fake/KerberosEvent: the global flags DAT_0050db20 (FUN_003a3268 -> FUN_0037cea0 / FUN_003a31e8 -> FUN_0037ce60)
      'fake/KerberosEvent.getflag(I)B': (vm, [n]) => (n >>> 0 < 0x40 ? R.gflags[n] : 0),
      'fake/KerberosEvent.setflag(IB)V': (vm, [n, v]) => { if (n >>> 0 < 0x40) { R.gflags[n] = v & 0xff; log('gflag ' + n + ' = ' + (v & 0xff)); } },
      // set_usercontrol (0x39bf80 -> FUN_0037e5e8): waits for the stream (FUN_00267358), FUN_003b01b0, game-state bit 11
      // set when off (FUN_00325b60(b == 0)), FUN_0037def0, FUN_00380a28, FUN_003edaa8 (left out)
      'fake/KerberosEvent.set_usercontrol(Z)V': (vm, [v]) => {
        R.state.usercontrol = v; log('usercontrol ' + v);
        // FUN_00325b60(b == 0): bit 11; FUN_0037def0(ev, b == 0) -> FUN_00325b10: bit 6 (the AI paused while off)
        const g = gs(); if (g) { if (v) { g.clear(11); g.clear(6); } else { g.set(11); g.set(6); } }
        R.warnOnce('stage: set_usercontrol\'s FUN_003b01b0 / FUN_00380a28 / FUN_003edaa8 left out');
        const s = o().stream && o().stream();
        return s && s.busy ? block(() => !s.busy) : undefined;
      },
      // free_usercontrol (FUN_003a4768): FUN_00325b60(b != 0)
      'fake/KerberosEvent.free_usercontrol(Z)V': (vm, [v]) => { const g = gs(); if (g) (v ? g.set(11) : g.clear(11)); log('free_usercontrol ' + v); },
      // set_battlecontrol (FUN_0039c3a8 -> FUN_0037e588): FUN_00403470(b == 0, 1) (the HUD / weapon lock), then the
      // frame sync FUN_0037e4e0
      'fake/KerberosEvent.set_battlecontrol(Z)V': (vm, [v]) => {
        R.state.battlecontrol = v; log('battlecontrol ' + v);
        R.warnOnce('stage: set_battlecontrol\'s FUN_00403470 (HUD / weapon) left out');
        return R.syncFrame();
      },
      // setSkipMode (FUN_0039ea68): n < 2 waits for the load commands (FUN_003806a0); +0x9860 |= 1 << n
      'fake/KerberosEvent.setSkipMode(I)V': (vm, [n]) => {
        const loading = () => R.slots.some(c => [2, 9, 0x12, 0x1a, 0x1b].includes(c.type));
        const set = () => { R.skipMode |= 1 << (n & 31); };
        if (n >>> 0 < 2 && loading()) return block(() => !loading(), set);
        set(); return undefined;
      },
      'fake/KerberosEvent.unsetSkipMode()V': () => { R.skipMode = 0; },             // FUN_0039ea18
      'fake/KerberosEvent.isSkip()Z': () => {                                     // FUN_003a0d88: +0x156c != 0
        const v = R.skip !== 0 ? 1 : 0; log('isSkip ' + v + ' ' + R.vm.where()); return v;
      },
      'fake/KerberosEvent.abortSkip()V': () => { R.skip = 0; },                    // FUN_0039c350
      'fake/KerberosEvent.enableSkip(Z)V': (vm, [v]) => { R.skipOff = !v; },       // FUN_003a4898 -> FUN_003e0cc8(b == 0)
      'fake/KerberosEvent.isDemo()Z': () => 0,                                     // FUN_0039fc60 (retail play)
      // displayStageInfo_l (FUN_0039e8e8) / isDisplayStageInfo (FUN_0039e9c8 -> FUN_003fdd30): worker 0220's stage_info.js
      'fake/KerberosEvent.displayStageInfo_l(ILjava/lang/String;)V': (vm, [k, s]) => {
        log('stageinfo ' + k + ' ' + str(s));
        const si = o().stageInfo && o().stageInfo();
        if (si) {
          si.display(k, str(s));
          // FUN_003fdb48: DAT_0047db80 = FUN_003e0d00(); FUN_003e0cc8(1) (no Skip while the card is up)
          if (!R.cardOn) { R.cardSaved = R.skipOff; R.cardOn = true; }
        } else R.warnOnce('stage: displayStageInfo (stage_info.js) not on the page: left out');
      },
      'fake/KerberosEvent.isDisplayStageInfo(I)Z': (vm, [k]) => { const si = o().stageInfo && o().stageInfo(); return si && si.isDisplay(k) ? 1 : 0; },
      'fake/KerberosEvent.drawNowLoading(Z)I': () => 0,                            // FUN_003a2770: no loading screen (page loads are resident)
      // ---- fake/KerberosZone: the stage flags (FUN_0039c898 -> FUN_0037e6b0 -> FUN_003ff738; FUN_0039c840 -> FUN_0037e6f0 -> FUN_003ff658)
      'fake/KerberosZone.getflag(I)B': (vm, [n]) => { const f = R.zf(); return f && n >>> 0 < 0x40 ? (f[n] ?? 0) & 0xff : 0; },
      'fake/KerberosZone.setflag(IB)V': (vm, [n, v]) => {
        const f = R.zf();
        if (n === 10 && (v & 0xff)) R.warnOnce('stage: Zone.setflag(10): FUN_003ff658\'s mode-0x11 branch not translated (written as other flags)');
        if (f && n >>> 0 < 0x40) { f[n] = v & 0xff; log('zflag ' + n + ' = ' + (v & 0xff)); }
      },
      // battle2 (FUN_0039c618) / battle3 (FUN_0039c650: FUN_00241990(0, 1), (1, 1) first) -> FUN_0037cf30
      'fake/KerberosZone.battle2(I)V': (vm, [n]) => { R.enterBattle(n); return R.syncFrame(); },
      'fake/KerberosZone.battle3()V': () => { R.warnOnce('stage: battle3\'s FUN_00241990(0 / 1, 1) left out'); R.enterBattle(0); return R.syncFrame(); },
      // battle1 (FUN_0039c7e8 -> FUN_0037e3c0): battle, then poll until stage flag n == v (or the abort bit), then event mode
      'fake/KerberosZone.battle1(IB)V': (vm, [n, v]) => {
        if (n >>> 0 >= 0x40) return undefined;
        R.enterBattle(0);
        const want = (v << 24) >> 24, f0 = R.frameNo;
        return block(() => { const f = R.zf(); return R.frameNo > f0 && f && (((f[n] ?? 0) << 24) >> 24) === want; }, () => { R.enterEvent(0); });
      },
      'fake/KerberosZone.event2()V': () => { R.enterEvent(0); },                   // FUN_0039c690 -> FUN_0037e048(ev, 0)
      'fake/KerberosZone.event3(I)V': (vm, [n]) => { R.enterEvent(n); },           // FUN_0039c6b8
      // peace / chaos (FUN_0039def0 / FUN_0039df18 -> FUN_00380290(ev, 1 / 0)): FUN_0037df80 -> FUN_003809a8 (bit 10
      // counter); peace: FUN_0037dc78, FUN_0037def0 (bit 6), waits FUN_00323538; chaos: FUN_003e0d18(0), FUN_00325b10(0)
      // FUN_003809a8's counter DAT_0046f854: peace +1 (bit 10 on at 0 -> 1), chaos -1 (bit 10 off when it drops below 1)
      'fake/KerberosZone.peace()V': () => {
        const g = gs(); if (g) { if (R.peaceN === 0) g.set(10); g.set(6); }
        R.peaceN++; R.state.peace = 1; log('peace');
      },
      'fake/KerberosZone.chaos()V': () => {
        const g = gs(); R.peaceN--;
        if (R.peaceN < 1) { R.peaceN = 0; if (g) g.clear(10); }
        if (g) g.clear(6); R.state.peace = 0; log('chaos');
      },
      // scene_save (FUN_0039c728): unless game-state bits 0xc / 0x10 / 0x14: wait_save, then FUN_0023d690(0, n, 0) ->
      // FUN_003bf250 (the checkpoint save)
      'fake/KerberosZone.scene_save(I)V': (vm, [n]) => {
        log('scene_save ' + n);
        if (o().onSceneSave) o().onSceneSave(n); else R.warnOnce('stage: scene_save (the checkpoint save FUN_0023d690 / FUN_003bf250) not translated');
      },
      'fake/KerberosZone.wait_save()V': () => {},                                  // FUN_0039c6f0: no save in flight on the page
      // load_l (FUN_0039c8e8 -> FUN_0037a3b8): command 4 (zone, a, b); FUN_00381518 runs it (zoneStep)
      'fake/KerberosZone.load_l(III)I': (vm, [z, a, b]) => { log('zone ' + [z, a, b]); return R.cmd(4, { zone: z, a, b, st: 0 }); },
      'fake/KerberosZone.getnum()I': () => 128,                                    // FUN_0039c488: the zone (z128)
      'fake/KerberosZone.exit_l(III)V': (vm, [z, a, b]) => { log('exit ' + [z, a, b]); if (o().onExit) o().onExit(z, a, b); else R.warnOnce('stage: Zone.exit (FUN_0039df70) not translated'); },
      // ---- fake/KerberosSound (music.js, worker 0215)
      // playMusic3 (FUN_003a0198): name, vol, fade; known name (FUN_003eb9a0) -> skip 0: fade < 1 FUN_003ec500(vol) else
      // FUN_003ec560(fade, vol); skip != 0: stopMusic FUN_003ebfa0, then FUN_003ec500(vol) when FUN_003eb930
      'fake/KerberosSound.playMusic3(Ljava/lang/String;II)V': (vm, [s, vol, fade]) => {
        const m = !R.beforeOpening && o().music && o().music(), name = str(s);
        R.music = { name, vol, fade, skip: R.skip }; log('music ' + name + ' ' + vol + ' ' + fade + (R.skip ? ' (skip)' : ''));
        if (!m) return;
        if (R.skip === 0) m.playMusic3(name, vol, fade);
        else { m.stopMusic(); R.warnOnce('stage: playMusic3 under Skip: FUN_003eb930 (stream state & 0x84) not translated: the music starts'); m.playMusic3(name, vol, 0); }
      },
      // playMusic2 (FUN_003a02b8): skip 0 or FUN_003eb930 -> FUN_003ec500(name, 0), FUN_003ebb18
      'fake/KerberosSound.playMusic2(Ljava/lang/String;)V': (vm, [s]) => {
        log('music2 ' + str(s)); const m = o().music && o().music();
        if (m && R.skip === 0) m.playMusic3(str(s), 0, 0);
        R.warnOnce('stage: playMusic2\'s FUN_003ebb18 and skip branch (FUN_003eb930) not translated');
      },
      'fake/KerberosSound.changeMusicVol(II)V': (vm, [vol, t]) => { log('musicvol ' + vol + ' ' + t); const m = o().music && o().music(); if (m) m.changeMusicVol(vol, t); },   // FUN_003a5308 -> FUN_003ed740
      'fake/KerberosSound.stopMusic()V': () => { log('stopmusic'); const m = o().music && o().music(); if (m) m.stopMusic(); },   // FUN_003a0148 -> FUN_003ebfa0
      // playBgAreaSound_l (FUN_0039dd80 -> FUN_003e6c88(name, vol)) / stopBgAreaSound (FUN_0039ddf0 -> FUN_003e65b0)
      'fake/KerberosSound.playBgAreaSound_l(Ljava/lang/String;I)V': (vm, [s, v]) => {
        log('area ' + str(s) + ' ' + v + (R.beforeOpening ? ' (before the opening: not replayed)' : ''));
        const a = !R.beforeOpening && o().area && o().area(); if (a) a.play(str(s), v);
      },
      'fake/KerberosSound.stopBgAreaSound()V': () => { log('area stop'); const a = o().area && o().area(); if (a) a.stop(); },
      // ---- fake/KerberosIntermission
      'fake/KerberosIntermission.setSectionStat(II)V': (vm, [k, v]) => { R.sectionStat[k] = v; },   // FUN_003a53e0
      'fake/KerberosIntermission.endSection()V': () => {                                           // FUN_003a26a8
        log('endSection');
        if (o().onEndSection) o().onEndSection(); else R.warnOnce('stage: endSection (FUN_003a26a8: the level end / results) not translated');
      },
      'fake/KerberosCamera.setBattleCameraInterpolationTime(F)V': (vm, [t]) => { R.state.battleCamMs = f32(t); R.warnOnce('stage: setBattleCameraInterpolationTime not translated (the follow camera\'s blend from the event camera)'); },
    });
    return N;
  }
}

// the controller: one StageRuntime running ev0100.main, one frame per game frame (FUN_00377c68 in FUN_00248110)
export function createStageController(opts) {
  const rt = new StageRuntime(opts.data, opts);
  rt.vm.start(opts.data.main, 'main', '([Ljava/lang/String;)V', [{ $arr: true, kind: 'L', a: [] }]);
  // PAGE STRUCTURE (from the save only, ?intro=0): the save is past main's prelude, first_event and the hand-off; the page
  // runs them here, before its first game frame, up to the battle loop (4 controller frames, counted). With the opening
  // (opts.openingDone) main runs from the opening's start in page frames, as the game: the prelude, then first_event's
  // wait until the hand-off.
  if (opts.settle !== false && !opts.openingDone) {
    const played = () => rt.log.some(([, m]) => m.startsWith('played elsewhere '));
    for (let i = 0; i < 16 && !rt.vm.done && !(played() && rt.battle && rt.skip === 0 && rt.vm.pending === null); i++) rt.frame(20);
  }
  return {
    rt,
    tick(dtMs = 20) { if (!rt.vm.done) rt.frame(dtMs); },
    get done() { return rt.vm.done; },
    get battle() { return rt.battle; },
    get view() { return rt.view; },
    get globalFlags() { return rt.gflags; },
  };
}
