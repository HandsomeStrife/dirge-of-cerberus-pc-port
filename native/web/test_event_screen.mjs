// test_event_screen.mjs -- the reticle in events and the fade after a skipped event (worker 0265; notes/HANDOFF.md 2026-11-08).
//   node native/web/test_event_screen.mjs
// The game's calls: event mode FUN_0037e048 -> FUN_00324ca0 (game-state bits 5 / 4, then FUN_0033c1a8 = FUN_003b0440(HUD, 0)
// + FUN_003b03e8), the HUD's slide-out FUN_003aff20 -> FUN_003b03e8 (set_usercontrol(0), the game over), battle()
// FUN_0037cf30 -> FUN_00324e70 (bits 5 / 4 cleared, FUN_0033c060: the kind from the mode again).
// Needs data/aim/reticle.json + weapon.json (build step aim) and data/event/ev0100_stage.json (step stage); skips without them.
// battle() after a skipped event: FUN_0037cf30 with +0x156c != 0 and n < 1 kills the fade particle (FUN_002f2218).
// MUTATE=off|sync|bits|ctl|stageobj|modebit|syncorder|start|fadekill|faden|cardsave|loading runs one mutant (scratch copies) and expects a failure.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MUT = process.env.MUTATE;
const subs = {
  off: ['aim_core.js', 'this.setKind(0);\n    for (const k of [5, 6, 7, 4]) this.hideKind(k);', ''],
  sync: ['aim_core.js', 'else if (m === 1 || m === 2) this.setKind(this.lockOn ? 2 : 1);', ''],
  bits: ['stage_controller.js', 'if (gs) { gs.set(5); gs.set(4); }', ''],
  ctl: ['stage_controller.js', 'if (this.o.reticle) this.o.reticle.off(); else', 'if (false) this.o.reticle.off(); else'],
  fadekill: ['stage_controller.js', 'if (this.skip !== 0 && n < 1 && this.fade) { this.fade = null;', 'if (false) {'],
  faden: ['stage_controller.js', 'if (this.skip !== 0 && n < 1 && this.fade)', 'if (this.skip !== 0 && this.fade)'],
  cardsave: ['stage_controller.js', 'if (!this.cardSaved) this.skipOff = false;', 'if (this.cardSaved) this.skipOff = true;'],
  loading: ['stage_info.js', 'finally { si.loading = false; }', 'si.loading = false;'],
  stageobj: ['stage_controller.js', 'if (!first && this.o.reticle) this.o.reticle.sync();', 'if (this.o.reticle) this.o.reticle.sync();'],
  modebit: ['stage_controller.js', 'if ((((this.o.modeBits ?? 0) >>> 5) & 1) === 0) {', 'if (true) {'],
  syncorder: ['stage_controller.js', 'const first = !this.stageObj;', 'const first = !this.stageObj; if (!first && this.o.reticle) this.o.reticle.sync();'],
  start: ['stage_controller.js', '    this.fun324ca0(o.gameState && o.gameState());', ''],
};
const mods = {};
for (const f of ['aim_core.js', 'stage_controller.js', 'stage_info.js']) {
  let p = path.join(HERE, f);
  if (MUT) {
    const sub = subs[MUT];
    if (!sub) throw new Error('unknown mutant ' + MUT);
    if (sub[0] === f) {
      let s = fs.readFileSync(p, 'utf8');
      if (!s.includes(sub[1])) throw new Error('mutant ' + MUT + ': anchor not found');
      s = s.replace(sub[1], sub[2]).replaceAll("from './", "from '" + HERE + '/');
      p = path.join(process.env.TMPDIR || '/tmp', 'w265_mut_' + MUT + '_' + f.replace('.js', '.mjs'));
      fs.writeFileSync(p, s);
    }
  }
  mods[f] = await import(p);
}
const { WeaponSystem } = mods['aim_core.js'];
const { createStageController } = mods['stage_controller.js'];

let fails = 0, oks = 0;
const ok = (c, m) => { if (c) oks++; else { fails++; console.log('FAIL ' + m); } };
const J = (f) => JSON.parse(fs.readFileSync(path.join(HERE, f), 'utf8'));
for (const f of ['data/aim/weapon.json', 'data/aim/reticle.json', 'data/event/ev0100_stage.json'])
  if (!fs.existsSync(path.join(HERE, f))) { console.log('SKIP: no ' + f + ' (tools/byo/build_web.sh)'); process.exit(0); }
const W = J('data/aim/weapon.json'), RET = J('data/aim/reticle.json');

// the reticle is drawn while any kind 1..7 has a phase (aim.js ReticleLayer.draw)
const drawn = (w) => w.r.phase.some((p, k) => k > 0 && p !== 0);
const frames = (w, n) => { for (let i = 0; i < n; i++) w.reticleFrame(20); };

// 1. FUN_003b03e8 on a shown reticle: kind 0, the fade out (len_show), then nothing drawn; the mode is kept, so FUN_0033ba88
// with the same mode does not bring it back; FUN_0033c060 does
{
  const w = new WeaponSystem({ ...W }, RET);
  w.setHudMode(1); frames(w, 10);
  const k = w.r.kind;
  ok(k === (w.lockOn ? 2 : 1) && w.r.phase[k] === 2 && drawn(w), 'gun up: kind ' + k + ' shown (phase ' + w.r.phase[k] + ')');
  w.reticleOff();
  ok(w.r.kind === 0 && w.r.phase[k] === 3, 'reticleOff: kind 0, kind ' + k + ' fading out (phase ' + w.r.phase[k] + ')');
  frames(w, Math.ceil(RET.kinds[k].len_show / 20));
  ok(!drawn(w), 'after the fade (' + RET.kinds[k].len_show + ' ms): nothing drawn');
  w.setHudMode(1); frames(w, 5);
  ok(!drawn(w) && w.hud.mode === 1, 'the same mode again (FUN_0033ba88: no change): still nothing drawn');
  w.reticleSync(); frames(w, 10);
  ok(w.r.kind === k && w.r.phase[k] === 2 && drawn(w), 'reticleSync (FUN_0033c060): kind ' + k + ' shown again');
  // mode 0: kind 0 and the flags dropped
  w.setOnTarget(true); w.hud.mode = 0; w.reticleSync();
  ok(w.r.kind === 0 && !(w.hud.flags & 2) && !(w.r.bits & 1), 'reticleSync with mode 0: kind 0, on-target off');
  // locked: the marker (kind 4) hides too
  const v = new WeaponSystem({ ...W }, RET);
  v.setHudMode(1); frames(v, 10); v.setOnTarget(true); frames(v, 10); v.setLocked(true); frames(v, 10);
  const had4 = v.r.phase[4] !== 0;
  v.reticleOff(); frames(v, 20);
  ok(had4 && !drawn(v), 'locked reticle + marker (kind 4): all gone after reticleOff');
}

// 2. the stage controller: main's Zone.event -> reticle off with the stage object only; battle() -> sync; bits 5 / 4
{
  const data = J('data/event/ev0100_stage.json');
  const bits = new Set(), calls = [];
  const gs = { set: b => bits.add(b), clear: b => bits.delete(b), test: b => (bits.has(b) ? 1 : 0) };
  const reticle = { off: () => calls.push('off'), sync: () => calls.push('sync') };
  const c = createStageController({ data, warn: () => {}, flags: () => ({}), gameState: () => gs, reticle });
  const R = c.rt, N = R.vm.natives;
  const ev = N['fake/KerberosZone.event2()V'], bt = N['fake/KerberosZone.battle2(I)V'];
  // before the stage init (DAT_0046e290 == 0): FUN_00324ca0 sets the bits, no FUN_0033c1a8
  R.stageObj = false;
  ev(R.vm, []);
  ok(bits.has(5) && bits.has(4) && bits.has(2) && bits.has(6), 'event mode: game-state bits 5, 4, 2, 6 set (got ' + [...bits].sort((a, b) => a - b) + ')');
  ok(!calls.length, 'no stage object: no reticle call (FUN_00324ca0 is inside DAT_0046e290 != 0)');
  bt(R.vm, [0]);
  ok(!bits.has(5) && !bits.has(4) && !bits.has(2), 'battle(): bits 5, 4, 2 cleared (got ' + [...bits] + ')');
  ok(!calls.length, 'the first battle (no stage object yet): no FUN_0033c060');
  // with the stage object
  ok(R.stageObj, 'the stage object exists after the first battle');
  ev(R.vm, []);
  ok(calls.join() === 'off', 'event mode with the stage object: reticle off (FUN_0033c1a8): ' + calls.join());
  bt(R.vm, [0]);
  ok(calls.join() === 'off,sync', 'battle(): reticle sync (FUN_0033c060): ' + calls.join());
  // FUN_00324e70 l.41 / l.77-80 / l.81: the stage-load pass FUN_005453b0, then FUN_0033c060, then the camera reset FUN_00329f68
  {
    const seq = [];
    const c3 = createStageController({ data, warn: () => {}, flags: () => ({}), gameState: () => gs,
      reticle: { off: () => seq.push('off'), sync: () => seq.push('sync') }, stagePass: () => seq.push('pass'), cameraReset: () => seq.push('cam') });
    const R3 = c3.rt, N3 = R3.vm.natives;
    R3.stageObj = true; seq.length = 0;
    N3['fake/KerberosZone.battle2(I)V'](R3.vm, [0]);
    ok(seq.join() === 'pass,sync,cam', 'battle(): stage-load pass, then FUN_0033c060, then the camera reset (' + seq.join() + ')');
  }
  // FUN_00324ca0 l.15-21: FUN_0033c1a8 only with FUN_002419d8(5) == 0 (DAT_004b8ac8 bit 5); the bits 5 / 4 are set either way (l.7-8)
  {
    const b4 = new Set(), cl = [];
    const g4 = { set: b => b4.add(b), clear: b => b4.delete(b), test: b => (b4.has(b) ? 1 : 0) };
    const c4 = createStageController({ data, warn: () => {}, flags: () => ({}), gameState: () => g4, modeBits: 1 << 5,
      reticle: { off: () => cl.push('off'), sync: () => cl.push('sync') } });
    c4.rt.stageObj = true;
    c4.rt.vm.natives['fake/KerberosZone.event2()V'](c4.rt.vm, []);
    ok(!cl.includes('off') && b4.has(5) && b4.has(4), 'DAT_004b8ac8 bit 5 set: no reticle off, bits 5 / 4 still set (' + cl.join() + ')');
  }
  // FUN_00374d08 -> FUN_00324ca0 at the program start: a record's reload (globalFlags) and the opening (openingDone) set bits 5 / 4
  // with no stage object; the save's settle runs main through first_event's battle(), which clears them
  for (const [name, extra, want] of [['reload', { globalFlags: new Uint8Array(64), settle: false }, true], ['opening', { openingDone: () => false }, true], ['save', {}, false]]) {
    const b5 = new Set(), cl = [];
    const g5 = { set: b => b5.add(b), clear: b => b5.delete(b), test: b => (b5.has(b) ? 1 : 0) };
    createStageController({ data, warn: () => {}, flags: () => ({}), gameState: () => g5, reticle: { off: () => cl.push('off'), sync: () => {} }, ...extra });
    ok((b5.has(5) && b5.has(4)) === want && !cl.length, `program start (FUN_00374d08), ${name}: bits 5 / 4 ${want ? 'set' : 'clear'}, no reticle call (${[...b5]})`);
  }
  // and end to end with a WeaponSystem behind it
  const w = new WeaponSystem({ ...W }, RET);
  const c2 = createStageController({ data, warn: () => {}, flags: () => ({}), gameState: () => gs,
    reticle: { off: () => w.reticleOff(), sync: () => w.reticleSync() } });
  const R2 = c2.rt, N2 = R2.vm.natives;
  R2.stageObj = true;
  w.setHudMode(1); frames(w, 10);
  N2['fake/KerberosZone.event2()V'](R2.vm, []); frames(w, 10);
  ok(!drawn(w), 'gun up when an event starts: no reticle in the event');
  N2['fake/KerberosZone.battle2(I)V'](R2.vm, [0]); frames(w, 10);
  ok(drawn(w), 'back in battle mode: the reticle again');
}

// 3. the fade after a skipped event (T: the decode; the case: Dan's black room with the HUD after the rescue, roji02_01 Skipped
// before its fadein: main's fadein(1000) is dropped under Skip (FUN_003736c8), then main's battle() (n = 0) kills the fade)
{
  const data = J('data/event/ev0100_stage.json');
  const mk = () => { const c = createStageController({ data, warn: () => {}, flags: () => ({}) }); return c.rt; };
  const bt = (R, n) => R.vm.natives['fake/KerberosZone.battle2(I)V'](R.vm, [n]);
  let R = mk();
  R.fadeTo(false, 0, 0, 0);                               // main's fadeout before the event
  R.skip = 2;                                             // the event Skipped (FUN_00372f70; FUN_00377c68's tail 1 -> 2)
  R.fadeTo(true, 1000, 0, 0);                             // main's fadein under Skip: nothing (FUN_003736c8)
  ok(R.fade && R.fade.level === 256, 'under Skip the fadein does nothing: still black (level ' + (R.fade && R.fade.level) + ')');
  bt(R, 0);
  ok(R.fade === null && R.skip === 0, 'battle() after the Skip: the fade particle killed (FUN_002f2218), the room shows');
  R = mk(); R.fadeTo(false, 0, 0, 0); R.skip = 2; bt(R, 3000);
  ok(R.fade && R.fade.level === 256, 'battle(3000) after a Skip: the fade kept (n >= 1; FUN_0037cf30)');
  R = mk(); R.fadeTo(false, 0, 0, 0); bt(R, 0);
  ok(R.fade && R.fade.level === 256, 'battle() with no Skip: the fade kept (main fades in itself)');
}

// 4. deb_jump's help box (FUN_003fdb48 / FUN_003fdd58): enableSkip(0), the card, the poll sees it gone, enableSkip(1): Skip is offered
// again (FUN_003fdd58 leaves the bit when it was set before the card; the script clears it)
{
  const data = J('data/event/ev0100_stage.json');
  const si = { kind: -1, display(k) { this.kind = k; }, isDisplay(k) { return k < 0 ? this.kind >= 0 : this.kind === k; } };
  const c = createStageController({ data, warn: () => {}, flags: () => ({}), stageInfo: () => si });
  const R = c.rt, N = R.vm.natives;
  R.running = true; R.battle = false;
  N['fake/KerberosEvent.enableSkip(Z)V'](R.vm, [0]);
  N['fake/KerberosEvent.displayStageInfo_l(ILjava/lang/String;)V'](R.vm, [6, 'MES_ITEM_08']);
  ok(!R.skippable(), 'help box up: no Skip');
  si.kind = -1;                                           // the box closed (FUN_003fdd58)
  N['fake/KerberosEvent.enableSkip(Z)V'](R.vm, [1]);       // deb_jump pc 722, after its poll
  R.cardStep();
  ok(R.skippable(), 'after the help box and enableSkip(1): Skip offered again (skipOff ' + R.skipOff + ')');
  // a card with the bit clear before it: cleared at the stop
  si.kind = -1; R.skipOff = false;
  N['fake/KerberosEvent.displayStageInfo_l(ILjava/lang/String;)V'](R.vm, [1, null]);
  si.kind = -1; R.cardStep();
  ok(R.skippable(), 'a card with Skip on before it: on again after it');
}

// 5. stage_info.js with its data missing (404): the load ends (si.loading false), so the stage controller's displayStageInfo hold ends
{
  const { createStageInfo } = mods['stage_info.js'];
  const realFetch = globalThis.fetch, warn = console.warn;
  globalThis.fetch = async () => ({ ok: false, json: async () => null, arrayBuffer: async () => null });
  console.warn = () => {};
  let si;
  try { si = createStageInfo({}); await si.ready; } finally { globalThis.fetch = realFetch; console.warn = warn; }
  ok(si.loading === false && !si.D, 'stage_info.json / pause.json 404: loading ends (' + si.loading + '), no data');
  const data = J('data/event/ev0100_stage.json');
  const c = createStageController({ data, warn: () => {}, flags: () => ({}), stageInfo: () => si });
  const r = c.rt.vm.natives['fake/KerberosEvent.displayStageInfo_l(ILjava/lang/String;)V'](c.rt.vm, [6, 'MES_ITEM_08']);
  ok(!(r && r.$block), 'displayStageInfo with the data missing does not hold (no box drawn, the script goes on)');
}

console.log((fails ? 'FAILED ' : 'ok ') + oks + ' / ' + (oks + fails) + (MUT ? ' (mutant ' + MUT + ')' : ''));
process.exit(fails ? 1 : 0);
