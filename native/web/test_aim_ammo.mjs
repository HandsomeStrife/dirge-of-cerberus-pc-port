// node test_aim_ammo.mjs [trace.jsonl ...] -- the magazine, reload and HUD ammo numbers against the PCSX2 traces
// (worker 0214; TRACE_FIELDSET=ammo TRACE_CALLLOG=sound, scripts tools/trace/scripts/w214_*.json; default folder
// <repo>/tools/trace/out, or $AMMO_TRACES). Frame by frame (sim frame f = pad_in of record f -> record f+1):
//   aim_core.js WeaponSystem: weapon state P+0x2a4 and timer P+0x290 (FUN_00579570 states 0-4, 7-9, 0xc-0xf), the
//   loaded rounds R+0x30 and the reserve (inventory count - class sum) (FUN_0031a138, FUN_00319f80, FUN_00317328);
//   the sounds it asks for (dry click / reload) vs the call log's play_name (draw / fire / impact names are other code's);
//   hud_core.js HudState.setAmmo (FUN_00339590 -> FUN_003ae138) after the frame vs the HUD text buffers 0x4efba8 + 0x20 k
//   (k 2 = slot 6 0x1a "a/b", k 1 = 0x19 the reserve).
//   clips (with `node --import ./test_hooks.mjs`): aim.js makeClipControl on player.js SpeedAnimator's clock, the head
//   clip vs the trace's C+0x570 (h_st_a / h_st_f / h_st_rd: the reload clip's GUESS end)
// Plus the decoded rules without a trace: pellets cut to the loaded rounds, the R2 click with nothing to load.
// Mutation aid: MUT=mag (magazine 18 -> 9), MUT=reload (W+0x46 80 -> 70), MUT=last15 (no 15-tick cut).
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const { WeaponSystem, Ammo } = await import('./aim_core.js');
const { HudState } = await import('./hud_core.js');
// the clip check needs three.js stubbed (test_hooks.mjs); without it the clips are skipped
let CLIPS = null;
try {
  const { SpeedAnimator, GAME, STEP } = await import('./player.js');
  const { makeClipControl } = await import('./aim.js');
  CLIPS = { SpeedAnimator, GAME, STEP, makeClipControl };
} catch (e) { console.log('clips skipped (run with node --import ./test_hooks.mjs):', e.message.split('\n')[0]); }

const DIR = process.env.AMMO_TRACES || fileURLToPath(new URL('../../tools/trace/out/', import.meta.url));
const J = p => JSON.parse(readFileSync(new URL(p, import.meta.url)));
const W0 = J('./data/aim/weapon.json'), RET = J('./data/aim/reticle.json'), HUD = J('./data/hud/hud.json');
const MUT = process.env.MUT || '';
const W = { ...W0, magazine: MUT === 'mag' ? 9 : W0.magazine, reload: MUT === 'reload' ? 70 : W0.reload };
const files = process.argv.slice(2).length ? process.argv.slice(2)
  : ['w214_dry', 'w214_r2', 'w214_empty'].map(n => DIR + '/' + n + '.jsonl');
const BTN = { r1: 0x0008, r2: 0x0002, r3: 0x0400, circle: 0x0020 };
// sounds the weapon code asks for here; the rest of the call log is draw (bsj_018), fire (bsj_051), impacts
const OURS = new Set([...W0.se_dry, ...W0.se_reload, ...W0.se_reload_alt]);

const hex = h => Buffer.from(h, 'hex');
function rec(r) {
  const w = hex(r.p_weapon), wl = hex(r.wl), rr = hex(r.r_20), inv = hex(r.inv_ammo), t = hex(r.hud_text);
  const buf = k => { const s = t.subarray(k * 32, k * 32 + 32); const z = s.indexOf(0); return Array.from(z < 0 ? s : s.subarray(0, z)); };
  return { st: w.readInt32LE(0x14), T: w.readFloatLE(0), acc: w.readFloatLE(4), drawn: (w.readUInt32LE(0x18) & 1) === 1,
           loaded: rr.readInt16LE(0x10), reserve: inv.readInt32LE(4) - wl.readInt16LE(6 + 2 * 1), buttons: r.pad_in.buttons,
           hudAB: buf(2), hudC: buf(1), motion: r.motion };
}
function sounds(file) {
  const out = {};
  const p = file.replace(/\.jsonl$/, '.calls.jsonl');
  if (!existsSync(p)) return null;
  for (const l of readFileSync(p, 'utf8').trim().split('\n')) {
    const d = JSON.parse(l);
    if (d.hook !== 'play_name') continue;
    const nm = Buffer.concat(d['a1+0x0'].u.map(x => { const b = Buffer.alloc(4); b.writeUInt32LE(parseInt(x, 16) >>> 0); return b; }));
    const name = nm.subarray(0, nm.indexOf(0) < 0 ? 8 : nm.indexOf(0)).toString('latin1');
    if (OURS.has(name)) (out[d.frame] ||= []).push(name);
  }
  return out;
}
const eq = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const txt = a => a.map(c => c >= 0x13 && c <= 0x1c ? String(c - 0x13) : c === 0x12 ? '/' : c === 0x10 ? '-' : '?').join('');

let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } };
let ran = 0;
for (const file of files) {
  if (!existsSync(file)) { console.log('SKIP (no trace)', file); continue; }
  ran++;
  const R = readFileSync(file, 'utf8').trim().split('\n').slice(1).map(l => rec(JSON.parse(l)));
  const SND = sounds(file);
  const sim = new WeaponSystem(W, RET);
  sim.P.acc = R[0].acc; sim.P.st = R[0].st; sim.P.T = R[0].T;
  // the trace's own start (w214_empty pokes the inventory: reserve 0 from the start)
  sim.ammo = new Ammo(W.magazine, { loaded: R[0].loaded, reserve: R[0].reserve });
  const heard = [];
  sim.sound = n => { if (OURS.has(n)) heard.push(n); };
  if (MUT === 'last15') { const orig = sim.stateMachine.bind(sim); sim.stateMachine = h => { const a = sim.ammo; const r = a.rounds; a.rounds = () => 1; try { return orig(h); } finally { a.rounds = r; } }; }
  const hud = new HudState(HUD);
  // the start text as the trace's HUD holds it (w214_empty's poke changes the count, not the text, until the first refresh)
  hud.find(6, 0x1a).text = R[0].hudAB.slice(); hud.find(6, 0x19).text = R[0].hudC.slice();
  const mism = {};
  const note = (k, f, a, b) => { (mism[k] ||= []).push(`${f}:${a}/${b}`); };
  let sndN = 0, clipN = 0;
  const known = [];
  let anim = null, ctl = null;
  if (CLIPS) {
    const { SpeedAnimator, GAME, STEP, makeClipControl } = CLIPS;
    const MOTIONS = { ...J('./data/vincent/vincent.json').clips, ...J('./data/vincent/vincent_shoot.json').clips };
    anim = Object.create(SpeedAnimator.prototype);           // test_aim.mjs headlessAnim
    Object.assign(anim, { frames: { idle: 160, walk: 40, run: 20 }, head: { key: 'idle', frame: 0, prevFrame: 0 },
                          out: null, blend: { len: 0, rem: 0, w: 1 }, installed: false, cur: -1, override: null,
                          rate: 0.5, current: 'idle', actions: {}, names: {}, table: GAME.loco, request: null });
    anim.has = n => !!MOTIONS[n];
    anim.ensure = function (k) { if (this.frames[k]) return true; if (!MOTIONS[k]) return false; this.frames[k] = MOTIONS[k].frames; return true; };
    const actrl = { C: { groundSpeed: 0, face: { x: 0, y: 0, z: 1 }, moveDir: { x: 0, y: 0, z: 1 } } };
    ctl = makeClipControl({ core: sim, anim, ctrl: actrl, motions: MOTIONS, step: STEP });
    ctl.actrl = actrl; ctl.STEP = STEP;
  }
  for (let f = 0; f + 1 < R.length; f++) {
    const r = R[f], nx = R[f + 1], prevB = f ? R[f - 1].buttons : 0;
    const pressed = m => !!((r.buttons & m) && !(prevB & m));
    heard.length = 0;
    sim.input({ r1Pressed: pressed(BTN.r1), r1Held: !!(r.buttons & BTN.r1), r3Pressed: pressed(BTN.r3),
                circlePressed: pressed(BTN.circle), r2Pressed: pressed(BTN.r2) }, true, null);
    sim.stateMachine(null);
    if (ctl) {
      ctl.clips(); anim.gameFrame(ctl.actrl, ctl.STEP);
      const got = { idle: 'h_st' }[anim.head.key] || anim.head.key;
      if (nx.drawn) {
        clipN++;
        // KNOWN gap: the reload clip's end is a GUESS (clip end); the game keeps h_st_rd 2 frames longer, to
        // about when state 9 ends (fidelity-audit 'Reload motion'); counted, not failed
        if (got === 'h_st_a' && nx.motion === 'h_st_rd') known.push(f + 1);
        else if (got !== nx.motion) note('clip', f + 1, got, nx.motion);
      }
    }
    sim.events.length = 0;
    if (sim.hudMask & 2) hud.setAmmo(...sim.ammo.hud());  // hud.js tick: FUN_00339590
    sim.hudMask = 0;
    if (sim.P.st !== nx.st) note('state', f + 1, sim.P.st, nx.st);
    if (Math.abs(sim.P.T - nx.T) > 1e-4) note('timer', f + 1, sim.P.T, nx.T);
    if (sim.ammo.rounds() !== nx.loaded) note('loaded', f + 1, sim.ammo.rounds(), nx.loaded);
    if (sim.ammo.reserve() !== nx.reserve) note('reserve', f + 1, sim.ammo.reserve(), nx.reserve);
    const ab = hud.find(6, 0x1a).text, c = hud.find(6, 0x19).text;
    if (!eq(ab, nx.hudAB)) note('hud a/b', f + 1, txt(ab), txt(nx.hudAB));
    if (!eq(c, nx.hudC)) note('hud reserve', f + 1, txt(c), txt(nx.hudC));
    if (SND) {
      // the call log's frame index is the frame counter while the logic ran = the record that shows its result
      const want = SND[f + 1] || [];
      if (!eq(heard, want)) note('sound', f + 1, heard.join('+') || '-', want.join('+') || '-');
      sndN += want.length;
    }
  }
  const name = file.split('/').pop();
  const keys = Object.keys(mism);
  const last = R[R.length - 1];
  console.log(`${name}: ${R.length - 1} frames, end ${last.loaded}/${W.magazine} ${last.reserve}, sounds ${sndN}, clips ${clipN}` +
              (keys.length ? '' : ', all fields match'));
  if (known.length) console.log(`  KNOWN reload clip ends early (GUESS) at records ${known.join(', ')}`);
  for (const k of keys) { fails++; console.log(`  FAIL ${k} x${mism[k].length}: ${mism[k].slice(0, 6).join(' ')}`); }
}
if (!ran) console.log('no w214 traces: run tools/trace/scripts/w214_*.json (see notes/aim-research.md "Ammo and reload")');

// ---- rules without a trace
{
  const a = new Ammo(18, { loaded: 2, reserve: 0 });
  const w = new WeaponSystem({ ...W0 }, RET); w.ammo = a; const heard = []; w.sound = n => heard.push(n);
  w.P.drawn = true; w.P.st = 1; w.P.T = 0; w.P.acc = 0;
  w.stateMachine(null);
  const ev = w.events.find(e => e.type === 'shot');
  ok(ev && ev.pellets === 2 && a.rounds() === 0, 'FUN_00577480: 3 pellets cut to the 2 loaded rounds');
  ok(w.P.T === 15, 'interval after the emptying shot = min(W+0x44, 15)');
  w.events.length = 0; w.P.st = 1; w.P.T = 0; heard.length = 0; const kick = w.cam.kick = 0;
  w.stateMachine(null);
  ok(!w.events.some(e => e.type === 'shot') && heard.join() === W0.se_dry[W0.class] && w.cam.kick === kick, 'empty: dry click, no shot, no kick');
  heard.length = 0; w.P.st = 0;
  w.input({ r2Pressed: true }, true, null);
  ok(w.P.st === 0 && heard.join() === W0.se_dry[W0.class], 'R2 with nothing to load: FUN_00563240 click, no reload');
  const p = new WeaponSystem({ ...W0 }, RET); p.ammo = new Ammo(18, { loaded: 5, reserve: 0 }); const ph = []; p.sound = n => ph.push(n);
  p.P.drawn = true; p.input({ r2Pressed: true }, true, null);
  ok(p.P.st === 0 && ph.join() === W0.se_dry[W0.class], 'R2 with rounds loaded and no reserve: FUN_00317328 == 0 -> click, no reload');
  const b = new Ammo(18, { loaded: 18, reserve: 5 });
  ok(!b.canReload(), 'full magazine: no reload');
  b.spend(3); b.refill();
  ok(b.rounds() === 18 && b.reserve() === 2, 'refill = min(reserve + loaded, cap)');
  const c = new Ammo(18, { loaded: 3, reserve: 4 }); c.spend(3); c.refill();
  ok(c.rounds() === 4 && c.reserve() === 0, 'refill with a short reserve');
}
console.log(fails ? `${fails} failure(s)` : 'ok');
process.exit(fails ? 1 : 0);
