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
// Skip (the path decoded; the player chooses it, play.js):
//   FUN_003c0520 (the pause menu) offers Skip when FUN_003e0d00() == 0 (DAT_004f3044 bit 0x2000: enableSkip(0) sets
//   it, FUN_003e0cc8; the stage title card FUN_003fdb48 too); choosing it: FUN_003c0110 -> FUN_003dfdc8: if
//   FUN_003dfd18 (+0x1558 & 0x102000000000 == 0x100000000000: an event program runs, bit 44 from FUN_00374d08 /
//   FUN_00374e38, and not battle mode, bit 37) -> FUN_00372f70: +0x156c = 1, +0x1558 |= 1 << 36. FUN_00377c68's end:
//   1 -> 2. With +0x156c != 0: isSkip() true (FUN_003a0d88), sleep ends (FUN_003a0e48), timers end (FUN_00377c68 case
//   0x1c), playMusic3 / playMusic2 take their skip branch; with 2 a camera move jumps to its end (FUN_003779d0).
//   battle (FUN_0037cf30) sets +0x156c = 0 and bit 37.

import { EventRuntime } from './event_rt.js';
import { EventVM, block } from './event_vm.js';
import { EventActors } from './event_actor_rt.js';
import { sendEventSe } from './event_sound.js';

// worker 0248: the events the page plays out, every one main calls (StageVM.invoke's check; test_stage_controller reads main's call sites)
// worker 0261 (notes/story-cutscenes.md): sk_mituketa2, heri_taijou (Skip in it takes main's branch past sk_mituketa2), roji02_01
export const PLAYS = new Set(['ev0101.rv_matiawase', 'ev0103.heri_taijou', 'ev0101.sk_mituketa2', 'ev0143.roji02_01', 'ev0141.first_encounter', 'ev0141.rv_toujou', 'ev0141.wro_kaisetu', 'ev0143.roji01_01', 'ev0143.beast_ev01', 'ev0143.beast_ev02', 'ev0143.heri_tobi', 'ev0143.help_people01', 'ev0143.help_orei01', 'ev0143.help_orei02', 'ev0143.help_orei04', 'ev0143.help_people03', 'ev0143.help_orei03', 'ev0103.heri_toujou', 'ev0103.heri_dgsol', 'ev0103.heri_lastst', 'ev0103.heri_lasted', 'ev0145.kita_ev0145']);

// main's own classes: their methods are main's helpers (kalm_ld ...), not events
export const MAIN_CLASSES = ['ev0100', 'ev0148'];

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
    // page only: no auto-skip any more, so an event main calls that isn't in PLAYS would run with no one having looked at it
    const top = this.frames[this.frames.length - 1];
    if (hit && top && MAIN_CLASSES.includes(top.cls) && /^ev\d{4}$/.test(hit.cls) && !MAIN_CLASSES.includes(hit.cls) && !PLAYS.has(hit.cls + '.' + name)) console.error(`stage: main calls ${hit.cls}.${name}, not in PLAYS (stage_controller.js)`);
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
    // the actor slots (event +0x1800, 64 x 0x200): worker 0218's EventActors for the slot state and its natives (load_l,
    // setpos_l, setVisible_l ...). Nothing draws the stage's event-loaded models on the page (left out, warned); the
    // battle actors below lend the gameplay objects' own models to slots (worker 0229)
    // worker 0248: opts.actors (play.js: EventActors with the event actor library's clips and texture animations, drawn
    // by event_actors.js), opts.sound / opts.windows (event_sound.js back ends, event_window.js), as intro.js gives the opening
    super(data, { warn: o.warn, lang: o.lang, actors: o.actors || new EventActors({ warn: o.warn || ((m) => console.warn(m)) }),
                  sound: o.sound || null, windows: o.windows || null });
    this.o = o;
    // +0x156c. opts.skip: its value at the hand-off (the opening's runtime, intro.js: 2 when the player skipped it), so
    // main's isSkip() after first_event takes the game's branch (kalm_ld(100)) until battle() clears it (worker 0222)
    this.skip = o.skip ?? 0;
    // main's prelude runs before the opening (asj_033 at f20, then scr001's asj_036 replaces it: T w222_snd). Until
    // first_event returns its sounds are logged only: the page's opening sound (play.js / event_sound.js, worker 0222)
    // owns that stretch, and from the save the prelude is already past
    // worker 0254: a record's reload has no opening (o.globalFlags: FUN_00400778 resumes main), so its sounds are heard
    this.beforeOpening = !o.globalFlags;
    this.skipMode = 0;                // +0x9860 (setSkipMode bits)
    // +0x1558 bit 37. T: set in the save and at the hand-off (trace_w205_reload). A record's reload: clear from the teardown on, and main
    // runs with it clear until its first battle(), with no FUN_0037e048 (T w254 record 3: f328 clear, battle2 at reload + 2177, no event call):
    // past main's Zone.event (flag 9 = 9, pc 6054 and 6246) it is still event mode, Skip included (skippable)
    this.battle = !o.globalFlags;
    if (!this.battle) {
      // L: the game has no stage object until the stage init (DAT_0046e290 0, no HUD, no manager: T r1600 against r2600), so nothing of the
      // world runs; the page's world exists from the start, so it waits as in event mode (enterEvent's bits, cleared by enterBattle).
      // Bit 11: no Vincent to steer either (FUN_00331f08's gate), and main calls no set_usercontrol(0) on this path. It ends with main's
      // set_usercontrol(1) (ev0100 main pc 1356, 5246, 6670, 8235, 10759) or, on any route without one (global 18 clear: pc 946 -> 1107), the first battle()
      this.reloadHold = true;
      const gs = o.gameState && o.gameState();
      if (gs) { gs.set(6); gs.set(2); gs.set(11); }
      if (o.hudControl) o.hudControl(false);
    }
    this.running = true;              // +0x1558 bit 44: the event program runs (FUN_00374d08), set before main
    this.skipOff = false;             // DAT_004f3044 bit 0x2000 (FUN_003e0cc8 / FUN_003e0d00)
    // DAT_0046e290 != 0: the stage object (FUN_003245e8 builds it in the stage init). A new controller = a stage (re)load:
    // not yet. T w240_init (a Restart's reload): main's battle() after first_event (f2264) comes before the stage init
    // (f2276-2278), so that battle's FUN_00324e70 finds none (worker 0240)
    this.stageObj = false;
    // FUN_00374d08 (the program start: +0x1558 bit 44, FUN_005a6d70(0), then FUN_00324ca0): on a record's reload (no stage object
    // yet: bits 5 / 4 only, cleared by main's first battle()). A new controller is the program's start on every path: a record's reload,
    // the opening, and the save (whose settle below runs main from its start through first_event's battle()). worker 0265
    this.fun324ca0(o.gameState && o.gameState());
    // DAT_0050db20 (stored XOR DAT_0046f608; kept plain here). A new controller = a stage (re)load: all 0. The clearing is
    // traced only (w210 start1704: 0 mid stage load); its writer is not decoded
    this.gflags = o.globalFlags || new Uint8Array(64);
    this.peaceN = 0;                  // DAT_0046f854 (FUN_003809a8's peace count)
    this.noPause = false;             // DAT_004f3044 bit 0x10000 (FUN_003e0d18; cleared at the stage load by FUN_00245d00; worker 0277)
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
    // worker 0265: FUN_003fdd58 clears the bit only when it was clear at FUN_003fdb48 (DAT_0047db80 == 0 -> FUN_003e0cc8(0)); else it
    // leaves it as it is. It used to set skipOff here, which undid deb_jump's enableSkip(1) after its help box (this runs after the
    // script's poll saw the card gone): no event could be Skipped after the first help box
    if (!this.cardSaved) this.skipOff = false;
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
    // FUN_003e9ed0: last frame's event SEs go out (event_sound.js; as event_rt.js frame, worker 0248)
    if (this.sePending && this.sePending.length) this.seSent = sendEventSe(this, this.sound && this.sound.audio ? this.sound.audio() : null);
    this.lentUpdate();                                                  // the statuses' update (main thread, before the VM window)
    // FUN_003fdd58 runs on the main thread (FUN_003fdf00, first in the frame) when the card stops, before the VM thread can see it
    // gone: the Skip bit is back before the script's own enableSkip (worker 0265)
    this.cardStep();
    if (!this.vm.done) this.vm.run();                                   // the VM thread's time this frame
    this.clock = (this.clock + dtMs) >>> 0;                              // FUN_003798a0
    for (const c of this.slots.slice()) {                                // FUN_00377c68's slot loop, slots in order
      let fin = false;
      if (c.type === 0x1c) fin = this.skip !== 0 || this.clock >= c.until;   // case 0x1c
      else if (c.type === 0x7e) fin = c.done;                            // page only (event_actor_rt.js EventActors.loading)
      else if (c.type === 7) fin = this.camMove(c);                      // case 7: FUN_003779d0
      else if (c.type === 4) fin = this.zoneStep(c);                     // case 4: FUN_00381518
      else if (c.type === 0x22) fin = this.actors.chain(c, this);        // case 0x22: FUN_00382768 (setmotionChain; worker 0263)
      else if (c.type === 0xc) fin = this.actors.walk(c, this);          // case 0xc: an actor's walk (Actor.move; worker 0263)
      if (fin) {
        this.slots.splice(this.slots.indexOf(c), 1);
        if (c === this.zoneCmd) this.zoneCmd = null;
      }
    }
    if (this.windows) this.windows.frame(this);                          // the event windows' state (event_window.js; worker 0248)
    if (this.skip === 1) this.skip = 2;                                  // FUN_00377c68's tail
    if (!this.battle) this.camOutput(); else this.view = null;           // FUN_00379148 only out of battle mode
    if (this.fade) {                                                     // the fade's level, as event_rt.js frame (its GUESS rows)
      const f = this.fade; f.level = Math.fround(f.level + Math.fround(f.rate * 1.2));
      if (f.level <= 0) f.level = 0; else if (f.level >= 256) f.level = 256;
    }
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
    // the slot loops: a named slot (+0xa5) keeps its actor for the status that takes it (FUN_00376890 only frees its
    // attachments); the others are finalized, FUN_00376c80(ev, slot, 1): a lent model is freed (FUN_005a7d88), so
    // its object builds a new one in its next update (FUN_003159b8's other branch: FUN_00409908 / FUN_00408b30)
    for (const a of this.actors.slots.slice()) {
      if (a.tag) continue;
      this.actors.slots.splice(this.actors.slots.indexOf(a), 1);
      if (a.lent) { a.lent.release(); this.log.push([this.frameNo, 'battle actor ' + a.id + ' freed']); this.warnOnce('stage: an unnamed battle actor\'s object after battle() (FUN_003159b8 -> FUN_00408b30, a new model at its status place) is drawn by its own system again; where its status is then is not translated'); }
    }
    if (gs) { gs.clear(2); gs.clear(6); }
    // L: the reload's hold ends here if main hasn't taken over: the stage init, with Vincent and the HUD, follows this battle (T w240_init)
    if (this.reloadHold) { this.reloadHold = false; if (gs) gs.clear(11); if (this.o.hudControl) this.o.hudControl(true); }
    // FUN_00324e70(FUN_0037cee8() != 0): with DAT_004b8ac8 bit 5 clear (FUN_002419d8(5) == 0 in the z128 states;
    // player.js DAT_004B8AC8) its second branch runs: FUN_00319190 (each status takes the slot named after it), then
    // the camera reset FUN_00329f68 -> FUN_003285d0 (angles from render view 1's forward)
    // worker 0265: FUN_00324e70 first clears game-state bits 5 and 4 (FUN_00326040; outside its DAT_0046e290 test)
    if (gs) { gs.clear(5); gs.clear(4); }
    this.handBackAll();
    // worker 0240: then FUN_005453b0, the stage-load pass: its per-status loop and FUN_005459d8 (script event 0x23 to every
    // object: the z128 boss's HP / gauge / activation at stage flag 0 = 36). T w240_boss (w231_boss4's route): f1373
    // FUN_0037cf30 -> FUN_00324e70(1) -> FUN_00319190, FUN_005453b0 -> FUN_005459d8. All of FUN_00324e70 is inside
    // `DAT_0046e290 != 0`: the battle() before the stage init (above) sends nothing and resets no camera (worker 0257). Its L: the
    // hand-back (FUN_00319190) stays (the page's settle and hand-off rely on it); +0x1528 stays set for FUN_004012c0 case 9, whose
    // FUN_00326da8 (camera re-enter, message 0x7d5) runs once the stage program does, after the stage init: follow.battleHandBack
    const first = !this.stageObj;
    if (!this.stageObj) this.log.push([this.frameNo, 'battle: no stage object yet (FUN_00324e70: nothing)']);
    else if (this.o.stagePass) this.o.stagePass();
    else this.warnOnce('stage: battle()\'s stage-load pass FUN_005453b0 (event 0x23) not wired');
    // worker 0262: L: a record's reload: the page ran the stage init's 0x22 before main (checkpoint.js initWorld). Its 0x23 belongs here, after
    // this battle (T w240_init): main's Zone.boss(true) has come by now, and the boss's mode 0x100 needs the plug-in
    if (first && this.o.globalFlags) { if (this.o.reloadPass) this.o.reloadPass(); else this.warnOnce('stage: the reload\'s event 0x23 not wired'); }
    // FUN_00324e70 l.77-80, after FUN_005453b0 (the stage-load pass) and before the camera reset: FUN_0033c060 (the reticle's
    // kind from the HUD mode again, after event mode's reticle off) when DAT_0046e290 +0x58 and +0x44 are set. +0x58 is written
    // non-zero by the stage init's load loop (FUN_003245e8 l.93-106 clears it and waits for it), so it is set exactly when there is
    // a stage object from an earlier stage init (!first); +0x44 = the weapon (o.reticle null without one). worker 0265
    if (!first && this.o.reticle) this.o.reticle.sync();
    this.stageObj = true;             // the stage init follows that first battle (FUN_003245e8, T w240_init)
    if (this.o.cameraReset) this.o.cameraReset(this.view, first); else this.warnOnce('stage: battle()\'s camera reset (FUN_00329f68) not wired');
    this.warnOnce('stage: FUN_00324e70\'s player calls (FUN_00578548, FUN_00574928, FUN_0034b2c8, FUN_00331ab0 ...) left out');
    this.cams.forEach(c => { c.active = false; });
    // worker 0265: with +0x156c != 0 (a skipped event: its fades and main's did nothing, FUN_003736c8) and n < 1, FUN_0037cf30 kills
    // the fade particle: FUN_002f2218 -> FUN_002f4678 -> FUN_002f4420(0x50b504) (DAT_0050b504, made by FUN_002f4480 / FUN_002f4578),
    // so the room shows again. +0x1558 bit 43 cleared (not kept on the page). Its FUN_002f4848 / FUN_002f4ac8 (particles 0x50b50c /
    // 0x50b510) are not on the page. With n >= 1 the fade is kept (main's battle(3000) after a skipped heri_taijou)
    if (this.skip !== 0 && n < 1 && this.fade) { this.fade = null; this.log.push([this.frameNo, 'battle: skipped event, fade killed']); }
    this.skip = 0;
    this.battle = true;
    this.battleTimer = n > 0 ? n : 0;
    this.log.push([this.frameNo, 'battle ' + n]);
    if (this.o.onMode) this.o.onMode('battle');
  }

  // ---- battle actors (worker 0229). A slot can hold a gameplay object's own model (getbattleactor); a slot's battle
  // name (+0xa5, setbattlename) is the 8-char status name (FUN_00316d40: section-1 record +0x44) of the object that
  // takes the slot's place back. opts.battleObject(name) -> the page's object for that status name, or null:
  //   matrix() -> the model's 16 floats (rows), lend() / release(), show(bool), place(pos, face)

  // FUN_00376938(name) + FUN_003157b0(status, 0): the slot named `name` is released (FUN_003771e0, FUN_00376890,
  // FUN_00376c80(.., 0)) and the status takes its place: +0x30 = the model root's row 3 with bone 1's offset (y 0),
  // +0x40 = -row 2, normalised. Needs the event program running (+0x1558 bit 44).
  handBack(a) {
    const obj = this.o.battleObject && this.o.battleObject(a.tag);
    if (!obj || !this.running) return false;
    this.actors.slots.splice(this.actors.slots.indexOf(a), 1);
    const M = a.M, n = Math.hypot(M[8], M[9], M[10]);
    // GUESS: bone 1's offset is left out (the slot's motion is not posed on the page: its clip is not exported for the
    // stage); T w229_rescue_pos: x / z = setpos's floats exactly, so it is 0 there (notes/fidelity-audit.md)
    const pos = [M[12], M[13], M[14]], face = [f32(-M[8] / n), f32(-M[9] / n), f32(-M[10] / n)];
    if (!((obj.status60 | 0) & 0x20000)) obj.place(pos, face);          // FUN_00319190 / FUN_003159b8: status +0x60 bit 0x20000 (no writer found; never set on the page)
    obj.release();                                                      // its model is drawn by its own system again
    if (a.lent && a.lent.tag !== a.tag) this.warnOnce('stage: a slot lending ' + a.lent.tag + '\'s model was taken by ' + a.tag + ' (left out)');
    // FUN_00380858(MP) for p_Vin: DAT_0046e290 +0x50 = the model (the camera's player model; no page state)
    this.log.push([this.frameNo, 'handback ' + a.tag + ' ' + pos.map(v => v.toFixed(2)) + ' face ' + face.map(v => v.toFixed(3))]);
    return true;
  }

  // the status update of a lent object (+0x88 == 0 after FUN_0056a5e0): FUN_003159b8 -> FUN_00376938 takes the slot
  // named after it as soon as there is one (main's setbattlename, before battle())
  lentUpdate() {
    for (const a of this.actors.slots.slice()) {
      if (!a.lent) continue;
      const b = this.actors.slots.find(s => s.tag && s.tag === a.lent.tag);
      if (b) this.handBack(b);
    }
  }

  // FUN_00319190 (in battle()'s FUN_00324e70): every status (+0xc bit 3; L: the ones the page resolves by name) takes the
  // slot named after it. GUESS: an object whose model is its own (+0x88 != 0: an event-loaded slot such as main's p000
  // after rv_matiawase) is placed from the slot too; the decompile places it from its own model (FUN_003157b0), but T
  // w229_rescue (f1850) has Vincent at that slot's setpos / setdir (notes/fidelity-audit.md)
  handBackAll() {
    for (const a of this.actors.slots.slice()) if (a.tag) this.handBack(a);
  }

  // FUN_0037e048(ev, n): event mode: +0x9864 = n, waits (the stream FUN_00267358, +0x1560, ...), bit 37 cleared,
  // game-state bit 2 set (FUN_00326018(2))
  enterEvent(n) {
    this.warnOnce('stage: FUN_0037e048\'s waits and calls (FUN_003e9950, FUN_0037ddd0, FUN_005a6d70, FUN_0037dbf8, FUN_003e8888 ...) left out');
    const gs = this.o.gameState && this.o.gameState();
    // FUN_002419d8(0) == 0 (DAT_004b8ac8 bit 0: 0 in the z128 states): FUN_0037dc78(ev, 1), FUN_0037def0(ev, 1) ->
    // FUN_00325b10(1): game-state bit 6, the AI paused (enemy_ai FUN_00365008); then FUN_00326018(2)
    if (gs) gs.set(6);
    // FUN_00324ca0 between the two (FUN_0037e048 l.88)
    this.fun324ca0(gs);
    if (gs) gs.set(2);
    // (+0x9864 & 1) == 0: FUN_003e8888(mgr, 0) (not translated) and FUN_003e6538: the placed-sound table released (playBgSound's
    // entries from the last event's end, and the stage's placed sounds; ambient.js releaseAll; worker 0266)
    if (!(n & 1)) { const bg = this.sound && this.sound.bg && this.sound.bg(); if (bg && bg.releaseAll) bg.releaseAll(); }
    this.battle = false;
    this.log.push([this.frameNo, 'event ' + n]);
    if (this.o.onMode) this.o.onMode('event');
  }

  // FUN_00324ca0 (event mode's HUD side; from FUN_0037e048 and from the program start FUN_00374d08): game-state bits 5 and 4 set
  // (FUN_00326018); inside DAT_0046e290 != 0 (the stage object) and FUN_002419d8(5) == 0 (DAT_004b8ac8 bit 5; o.modeBits, 0 in every
  // z128 state): FUN_0033c1a8 when DAT_0046e290 +0x44 (the weapon) != 0, the reticle off (aim_core reticleOff = FUN_003b03e8).
  // Its other calls (FUN_005a7338, FUN_00324d90, FUN_00312408 / FUN_00312660, FUN_00545330, FUN_00331a40, FUN_00349438, game-state
  // bit 0 cleared by FUN_00326040(0)) are left out (warned). worker 0265
  fun324ca0(gs) {
    if (gs) { gs.set(5); gs.set(4); }
    if (!this.stageObj) return;
    if ((((this.o.modeBits ?? 0) >>> 5) & 1) === 0) {
      if (this.o.reticle) this.o.reticle.off(); else this.warnOnce('stage: event mode\'s reticle off (FUN_0033c1a8) not wired');
    }
    this.warnOnce('stage: FUN_00324ca0\'s FUN_005a7338, FUN_00324d90, FUN_00312408 / FUN_00312660, FUN_00545330, FUN_00331a40, FUN_00349438 left out');
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
      // set_usercontrol (0x39bf80 -> FUN_0037e5e8): waits for the stream (FUN_00267358) first, then FUN_003b01b0, game-state bit 11
      // set when off (FUN_00325b60(b == 0)), FUN_0037def0, FUN_00380a28, FUN_003edaa8 (left out)
      'fake/KerberosEvent.set_usercontrol(Z)V': (vm, [v]) => {
        const apply = () => {
          R.state.usercontrol = v; log('usercontrol ' + v); R.reloadHold = false;
          // FUN_00325b60(b == 0): bit 11; FUN_0037def0(ev, b == 0) -> FUN_00325b10: bit 6 (the AI paused while off)
          const g = gs(); if (g) { if (v) { g.clear(11); g.clear(6); } else { g.set(11); g.set(6); } }
          // FUN_003b01b0(DAT_00471380, b): the HUD's panels out / in (worker 0248: hud.js control; T w248_gs: no HUD in the event)
          if (o().hudControl) o().hudControl(!!v);
          R.warnOnce('stage: set_usercontrol\'s FUN_00380a28 / FUN_003edaa8 left out');
        };
        const s = o().stream && o().stream();
        if (s && s.busy) return block(() => !s.busy, apply);
        apply(); return undefined;
      },
      // free_usercontrol (FUN_003a4768): FUN_00325b60(b != 0)
      'fake/KerberosEvent.free_usercontrol(Z)V': (vm, [v]) => { const g = gs(); if (g) (v ? g.set(11) : g.clear(11)); R.reloadHold = false; log('free_usercontrol ' + v); },
      // set_battlecontrol (FUN_0039c3a8 -> FUN_0037e588): FUN_00403470(b == 0, 1) (the HUD / weapon lock), then the
      // frame sync FUN_0037e4e0
      'fake/KerberosEvent.set_battlecontrol(Z)V': (vm, [v]) => {
        R.state.battlecontrol = v; log('battlecontrol ' + v);
        R.warnOnce('stage: set_battlecontrol\'s FUN_00403470 (HUD / weapon) left out');
        return R.syncFrame();
      },
      // setSkipMode (FUN_0039ea68): n < 2 waits for the load commands (FUN_003806a0); +0x9860 |= 1 << n
      'fake/KerberosEvent.setSkipMode(I)V': (vm, [n]) => {
        const loading = () => R.slots.some(c => [2, 9, 0x12, 0x1a, 0x1b, 0x7e].includes(c.type));
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
        // worker 0265: a page-load hold while stage_info.js fetches its data (a warp reaches deb_jump's box in its first frames)
        const si0 = o().stageInfo && o().stageInfo();
        if (si0 && si0.loading) return block(() => !si0.loading, () => R.vm.natives['fake/KerberosEvent.displayStageInfo_l(ILjava/lang/String;)V'](vm, [k, s]));
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
      // worker 0277: peace's FUN_0037dc78(ev, 0): the +0x1558 abort bit 33 is never set on the page, so FUN_003dedc0() == 0 ->
      // FUN_003e0d18(1): DAT_004f3044 |= 0x10000 (noPause), which FUN_003de130's Start -> pause branch tests (FUN_003e0d50); chaos's
      // FUN_003e0d18(0) clears it. T w277_pickup_gates: 0x10000 from deb_jump's peace (f206) to its chaos (f458); w277_pickup_start:
      // Start with the help box up (f300) opens nothing, Start after chaos (f465) opens the pause
      'fake/KerberosZone.peace()V': () => {
        const g = gs(); if (g) { if (R.peaceN === 0) g.set(10); g.set(6); }
        R.peaceN++;
        R.warnOnce('stage: peace\'s FUN_0037dc78 screen close (FUN_003dec80(0)) and its wait for open screens (FUN_003e05d8 / FUN_003dedc0) left out');
        R.noPause = true;
        R.state.peace = 1; log('peace');
      },
      'fake/KerberosZone.chaos()V': () => {
        const g = gs(); R.peaceN--;
        if (R.peaceN < 1) { R.peaceN = 0; if (g) g.clear(10); }
        R.noPause = false;                                                  // FUN_00380290(ev, 0): FUN_003e0d18(0)
        if (g) g.clear(6); R.state.peace = 0; log('chaos');
      },
      // scene_save (FUN_0039c728): unless game-state bits 0xc / 0x10 / 0x14: wait_save, then FUN_0023d690(0, n, 0) ->
      // FUN_003bf250 (the checkpoint save)
      'fake/KerberosZone.scene_save(I)V': (vm, [n]) => {
        log('scene_save ' + n);
        if (o().onSceneSave) o().onSceneSave(n); else R.warnOnce('stage: scene_save (the checkpoint save FUN_0023d690 / FUN_003bf250) not translated');
      },
      // worker 0231 (notes/boss-research.md): boss(Z) (FUN_0039c510 -> FUN_0037fe18(ev, zone, on)): on loads
      // kel_boss_z<zone>.ovl at 0xaa0000 and runs its entry (z128: 0xaa0080 -> FUN_00aa30c8(0): the plug-in
      // DAT_0046e590 whose vt+0x14 FUN_00aa3090 makes AI mode 0x100's brain); off -> FUN_00aa30c8(-1) deletes it.
      // Skipped in mode bit 0 (FUN_002419d8(0): 0 in story mode). The page: enemy_ai world.setBossPlugin.
      'fake/KerberosZone.boss(Z)V': (vm, [on]) => {
        log('boss ' + (on ? 1 : 0));
        if (o().bossOverlay) o().bossOverlay(!!on); else R.warnOnce('stage: Zone.boss: no enemy_ai world (the boss plug-in not set)');
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
      // FUN_003a53e0 -> FUN_0031d698: results.js's stats when given (o().stats, worker 0232)
      'fake/KerberosIntermission.setSectionStat(II)V': (vm, [k, v]) => { R.sectionStat[k] = v; const st = o().stats && o().stats(); if (st) st.set(k, v); },
      // calc FUN_003a55e8 -> FUN_003a9b88: KerberosIntermissionCalc.calc() (results.js runCalc, worker 0232); every
      // displayStageInfo(I / ILString) of the event library calls it first
      'fake/KerberosIntermission.calc()V': (vm) => { log('calc'); if (o().calc) o().calc(vm); else R.warnOnce('stage: Intermission.calc (FUN_003a55e8: KerberosIntermissionCalc) not translated'); },
      'fake/KerberosIntermission.endSection()V': () => {                                           // FUN_003a26a8
        log('endSection');
        if (o().onEndSection) o().onEndSection(); else R.warnOnce('stage: endSection (FUN_003a26a8: the level end / results) not translated');
      },
      // ---- fake/KerberosActor: battle actors (worker 0229; class registry DAT_004ef498, method +0x0c)
      // getbattleactor_l(id, name) (FUN_0039e1a8 -> FUN_00376b00): the status by name (FUN_003193c0: 8 chars) -> its
      // object (FUN_0053bd50) -> FUN_0056a5e0 takes the object's model (+0x180 = 0, +0x28 |= 0x40, status +0x88 = 0 and
      // +0x60 |= 4: FUN_00315758(s, 1)); MP+0x428 &= ~0x200; a new slot with that model (FUN_00376308(ev, mp, 0, id):
      // visible + clipped), FUN_005a86a0(mp, 0), the slot matrix = the model's (MP +0x10.. -> slot +0x20..); for p_Vin
      // FUN_00380858(0). No object by that name: nothing
      'fake/KerberosActor.getbattleactor_l(ILjava/lang/String;)V': (vm, [id, s]) => {
        const name = str(s), obj = o().battleObject && o().battleObject(name);
        log('getbattleactor ' + id + ' ' + name + (obj ? '' : ' (none)'));
        if (!obj) { R.warnOnce('stage: getbattleactor(' + name + '): no page object by that name (left out)'); return; }
        // the slot plays on the object's own model (MP): loadmotion_l / setmotion_l on this id pose it (heri_toujou's e_Heri, heri_dgsol's e_para_1..6; worker 0262)
        const a = R.actors.create(obj.model || name, id);
        if (!a) return;
        if (R.actors.ensure && obj.model) R.actors.ensure(obj.model);   // worker 0261: on the page, the model on demand; the gameplay body stands for it until it's in (event_actors.js pose)
        a.M = obj.matrix().map(f32);
        a.lent = obj; obj.lend();
      },
      // setbattlename_l(id, name) (FUN_0039d430 -> FUN_003765a0): the frame sync FUN_0037e4e0, then slot +0xa5 = name
      // (FUN_00422d18, 8 bytes)
      'fake/KerberosActor.setbattlename_l(ILjava/lang/String;)V': (vm, [id, s]) => {
        const f0 = R.frameNo;
        return block(() => R.frameNo > f0, () => { const a = R.actors.get(id); if (a) { a.tag = str(s).slice(0, 8); log('battlename ' + id + ' ' + a.tag); } });
      },
      // setdir_l(id, x, y, z, b) (FUN_0039f038; b is popped and not used) -> FUN_0037c300 -> FUN_00383d10(out, M, target):
      // d = row 3 - target with d.y = 0; row 0 = row 1 x d, row 2 = row 0 x row 1, row 1 = row 2 x row 0, each
      // normalised (rsqrt), row 3 kept. So row 2 = d / |d|: the actor faces the target (-row 2)
      'fake/KerberosActor.setdir_l(IFFFZ)V': (vm, [id, x, y, z]) => {
        const a = R.actors.get(id); if (!a) return;
        const M = a.M, cr = (p, q) => [f32(f32(p[1] * q[2]) - f32(p[2] * q[1])), f32(f32(p[2] * q[0]) - f32(p[0] * q[2])), f32(f32(p[0] * q[1]) - f32(p[1] * q[0]))];
        const nz = (v) => { const r = f32(1 / Math.sqrt(f32(f32(f32(v[0] * v[0]) + f32(v[1] * v[1])) + f32(v[2] * v[2])))); return v.map(c => f32(c * r)); };
        const d = [f32(M[12] - x), 0, f32(M[14] - z)], r1 = [M[4], M[5], M[6]];
        const r0 = cr(r1, d), r2 = cr(r0, r1), r1n = cr(r2, r0);
        const [n0, n1, n2] = [nz(r0), nz(r1n), nz(r2)];
        M[0] = n0[0]; M[1] = n0[1]; M[2] = n0[2]; M[4] = n1[0]; M[5] = n1[1]; M[6] = n1[2]; M[8] = n2[0]; M[9] = n2[1]; M[10] = n2[2];
      },
      // finalize_l (FUN_003a3410 -> FUN_00376c80(ev, slot, 0)): the slot goes, a lent model is not freed (param 0); the
      // object's +0x88 stays 0 and its next update builds a model (FUN_003159b8's other branch): its own drawing again
      'fake/KerberosActor.finalize_l(I)V': (vm, [id]) => {
        const a = R.actors.get(id); if (!a) return;
        R.actors.slots.splice(R.actors.slots.indexOf(a), 1);
        if (a.lent) a.lent.release();
        log('finalize ' + id);
      },
      // isPlayerReadyGun (FUN_003a4420 -> FUN_00325bb0): game-state bit 8 (FUN_00576548: aim_core.js draw / holsterCore). __sv_lock / __sv_unlock (FUN_003a3150 / FUN_003a3190): the event mutex + a mode bit: the page's VM never yields there (event_vm.js). Worker 0261
      'fake/KerberosEvent.isPlayerReadyGun()Z': () => { const g = gs(); return g && g.test(8) ? 1 : 0; },
      'fake/KerberosEvent.__sv_lock()V': () => {},
      'fake/KerberosEvent.__sv_unlock()V': () => {},
      // getposx / y / z_l (FUN_0039d488 / FUN_0039e108 / FUN_0039e158 -> FUN_0037a580(ev, id, axis)): slot +0x50 + axis, 0 without a slot. main's setpos(getpos()) (worker 0261)
      'fake/KerberosActor.getposx_l(I)F': (vm, [id]) => { const a = R.actors.get(id); return a ? a.M[12] : 0; },
      'fake/KerberosActor.getposy_l(I)F': (vm, [id]) => { const a = R.actors.get(id); return a ? a.M[13] : 0; },
      'fake/KerberosActor.getposz_l(I)F': (vm, [id]) => { const a = R.actors.get(id); return a ? a.M[14] : 0; },
      // get_battle_camera_l(i, j) (FUN_003a29c8 -> FUN_0037da58): event +0x390 = the current view's matrix, copied at the top of FUN_00377c68 (FUN_003ee608 -> FUN_003ede00), +0x3d0 its fov
      // (view +0x40). j < 0 or i > 2: fov; i 0 row 3 (the eye), 1 row 3 + row 2 (aim), 2 row 3 - row 1 (up point). main keeps the follow camera through an event with it (worker 0261)
      'fake/KerberosCamera.get_battle_camera_l(II)F': (vm, [i, j]) => {
        const v = o().viewMatrix && o().viewMatrix();
        if (!v) { R.warnOnce('stage: get_battle_camera_l: no page hook (viewMatrix)'); return 0; }
        if (j < 0 || i > 2 || i < 0) return f32(v.fov);
        return i === 0 ? v.eye[j] : i === 1 ? f32(v.eye[j] + v.fwd[j]) : f32(v.eye[j] - v.down[j]);
      },
      // setVisibleAll (FUN_0039d118 -> FUN_00380048(ev, mode, b, 1)). Mode 0: every MP of the list DAT_005b3788: FUN_00408900(MP, b) ->
      // FUN_005a85f8(MP, b ? 0 : 2) (+ its gun, FUN_002dbfc8). An event slot's own MP takes its slot's flag back in FUN_003772c8. Worker 0261
      'fake/KerberosActor.setVisibleAll(IZ)V': (vm, [mode, v]) => {
        log('setVisibleAll ' + mode + ' ' + v);
        if (mode !== 0) { R.warnOnce('stage: setVisibleAll mode ' + mode + ' (FUN_00380048) left out'); return; }
        if (o().allVisible) o().allVisible(!!v); else R.warnOnce('stage: setVisibleAll: no page hook');
      },
      // setVisibleModelGroup (FUN_0039dc88): b 0 FUN_00269368(n) sets, else FUN_002693a8(n) clears bit max(n - 1, 0) of DAT_004e8700,
      // the script half of the hidden-cell mask (effects.js createVisMask; as stage script cmds 0x54 / 0x55). Worker 0261
      'fake/KerberosZone.setVisibleModelGroup(IZ)V': (vm, [n, b]) => {
        log('modelgroup ' + n + ' ' + b);
        if (o().cellMask) o().cellMask(Math.max((n | 0) - 1, 0), !b); else R.warnOnce('stage: setVisibleModelGroup: no page hook');
      },
      // start_anim_l(a, chunk, b) (FUN_0039dbe0): FUN_00380c38 (the reload's list +0x9870), FUN_00269668(chunk, a, b) -> FUN_00268220: the
      // chunk's animation a: time 0, playing, one-shot unless b. L: the animations not playing at load are not exported (bmd_uvanim.py)
      'fake/KerberosZone.start_anim_l(IIZ)V': (vm, [a, c, b]) => { log('start_anim ' + a + ' chunk ' + c + ' ' + b); if (o().chunkAnim) o().chunkAnim(c, a, !!b); else R.warnOnce('stage: Zone.start_anim: no page hook'); },
      // Event.stop (FUN_0039fca8): polls while (+0x1558 bits 40 / 39) are set and bit 33 is clear; bit 39 = the event pause, which
      // the page holds by not running game frames (play.js); bit 40 has no writer on the page. Worker 0261
      'fake/KerberosEvent.stop()V': () => {},
      // setVisible_l (FUN_003a3478 -> FUN_0037ede8): +0xa8 bit 49 (event_actor_rt.js); a lent model is the object's own
      'fake/KerberosActor.setVisible_l(IZ)V': (vm, [id, v]) => {
        const a = R.actors.get(id); if (!a) return;
        a.visible = !!v;
        // with a clip the slot's body draws the model (event_actors.js): the page's gameplay body stays hidden
        if (a.lent) a.lent.show(!!v && !a.mp.clip);
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
