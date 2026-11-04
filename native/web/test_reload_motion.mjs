// node --import ./test_hooks.mjs test_reload_motion.mjs [trace.jsonl ...] -- the reload motion class 0x1c (worker 0246;
// aim.js makeClipControl, FUN_005980f8) on player.js SpeedAnimator's clock, against PCSX2 traces of a reload while running
// (w246_reload_run) and walking (w246_reload_walk) with the gun out (TRACE_FIELDSET=reloadrun; default folder
// <repo>/tools/trace/out, or $RELOAD_TRACES). Per record: the head layer's clip and frame (MP+0x448 -> MP+0x200 + 0x30 k),
// its loop flag (layer +0x1e bit 0: 0x86 during the reload, C+0x564 bit 0x40000), and the table rows C+0x5f4.
// The reload event is fed on the frame the weapon state goes to 9 (aim_core's FUN_00574f40, tested in test_aim_ammo).
// KNOWN: the class hands back 2 frames early (the game's state event FUN_00343160 -> FUN_00341af0 drops the class's own
// return and the next class comes 2 frames later; not decoded: notes/aim-research.md 'Reload motion class 0x1c').
// AIM_JS=<path> tests another copy of aim.js (mutation runs).
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const { SpeedAnimator, GAME, STEP } = await import('./player.js');
const { makeClipControl } = await import(pathToFileURL(process.env.AIM_JS || path.join(here, 'aim.js')).href);
const J = p => JSON.parse(readFileSync(path.join(here, p)));
const MOTIONS = { ...J('data/vincent/vincent.json').clips, ...J('data/vincent/vincent_shoot.json').clips };
const DIR = process.env.RELOAD_TRACES || path.join(here, '../../tools/trace/out');
const files = process.argv.slice(2).length ? process.argv.slice(2) : ['w246_reload_run', 'w246_reload_walk'].map(n => path.join(DIR, n + '.jsonl'));
let fails = 0, ran = 0;
const DUMP = {};                                          // RELOAD_DUMP=<file>: the per-record rows (for a plot)
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };

for (const file of files) {
  if (!existsSync(file)) { console.log('SKIP (no trace)', file); continue; }
  ran++;
  const raw = readFileSync(file, 'utf8').trim().split('\n').slice(1).map(l => JSON.parse(l));
  if (!raw[0].c_tab) { console.log('SKIP (not a TRACE_FIELDSET=reloadrun trace: no c_tab)', file); ran--; continue; }
  const R = raw.map(r => {
    const w = Buffer.from(r.p_weapon, 'hex'), mh = Buffer.from(r.mp_head, 'hex'), L = r.mp_layers[mh[8]];
    const tab = Buffer.from(r.c_tab, 'hex');
    return { f: r.frame, st: w.readInt32LE(0x14), speed: r.ground_speed, clip: L.clip, frame: L.frame, loop: (L.lflags & 1) === 1,
             c564: Buffer.from(r.c_564, 'hex').readUInt32LE(0) & 0x24000,
             rows: [0, 1, 2].map(i => tab.readInt32LE(i * 0x18)) };
  });
  const r0 = R.findIndex((r, i) => i > 0 && r.st === 9 && R[i - 1].st !== 9);   // the record after the reload request
  const start = r0 - 6;
  // the page at `start`: the aimed move class's table for quadrant 1 (ahead), the head as the trace has it
  const anim = Object.create(SpeedAnimator.prototype);
  Object.assign(anim, { frames: {}, head: { key: R[start].clip, frame: R[start].frame, prevFrame: R[start].frame, loop: true },
                        out: null, blend: { len: 0, rem: 0, w: 1 }, installed: true, cur: -1, override: null,
                        rate: 0.5, current: R[start].clip, actions: {}, names: {}, table: GAME.loco, request: null });
  anim.has = n => !!MOTIONS[n];
  anim.ensure = function (k) { if (this.frames[k]) return true; if (!MOTIONS[k]) return false; this.frames[k] = MOTIONS[k].frames; return true; };
  anim.ensure(R[start].clip);
  const core = { events: [], drawn: () => true };
  const ctrl = { onGround: true, C: { groundSpeed: R[start].speed, face: { x: 0, y: 0, z: 1 }, moveDir: { x: 0, y: 0, z: 1 } } };
  const ctl = makeClipControl({ core, anim, ctrl, motions: MOTIONS, step: STEP });
  ctl.clips();                                             // the aimed table (quadrant 1) at the start
  anim.cur = R[start].clip === anim.table[2]?.key ? 2 : 1;
  const bad = [], known = [], badGate = [];
  let maxDf = 0, reloadClip = null, sawNoLoop = false;
  for (let i = start; i + 1 < R.length && i < r0 + 70; i++) {
    const nx = R[i + 1];
    ctrl.C.groundSpeed = nx.speed;                          // C+0x1d8 of this frame (FUN_0034c388 runs before the class)
    if (nx.st === 9 && R[i].st !== 9) core.events.push({ type: 'reload' });
    ctl.clips(); anim.gameFrame(ctrl, STEP);
    // C+0x564 bits 0x4000 / 0x20000 after this frame's logic (FUN_00598000, FUN_005980f8; the KNOWN early hand-back excepted)
    if (ctl.c564() !== nx.c564 && !(/_rd$/.test(nx.clip) && /_a$/.test(anim.head.key))) badGate.push(`${nx.f}: ${ctl.c564().toString(16)} / ${nx.c564.toString(16)}`);
    const got = anim.head.key, gf = anim.head.frame;
    (DUMP[path.basename(file, '.jsonl')] ||= []).push({ f: nx.f, page: got, pf: gf, game: nx.clip, gf: nx.frame, speed: nx.speed });
    if (got === nx.clip) {
      // the reload rows (rate 0.5): exact; the aimed walk before it runs on rootSpeed's GUESS (0.1%, aim.js)
      if (!known.length && /_rd$/.test(got)) maxDf = Math.max(maxDf, Math.abs(gf - nx.frame));   // (after the KNOWN early hand-back the new clip runs 2 frames ahead)
      if (/_rd$/.test(got)) { reloadClip = got; if (anim.head.loop === false && nx.loop === false) sawNoLoop = true; }
    } else if (/_rd$/.test(nx.clip) && /_a$/.test(got)) known.push(nx.f);
    else bad.push(`${nx.f}: ${got} ${gf.toFixed(2)} / ${nx.clip} ${nx.frame.toFixed(2)}`);
  }
  const name = path.basename(file, '.jsonl');
  const want = R[r0 + 5].clip;
  ok(bad.length === 0, `${name}: the head clip every record from ${R[start].f} (${bad.slice(0, 4).join(' | ') || 'all equal'})`);
  ok(reloadClip === want && sawNoLoop, `${name}: the reload plays ${reloadClip} (trace ${want}) without a loop (layer flags 0x86)`);
  ok(maxDf < 1e-4, `${name}: the reload clip's frames equal (max diff ${maxDf.toExponential(2)})`);
  ok(known.length <= 2, `${name}: KNOWN early hand-back at records ${known.join(', ')} (<= 2)`);
  ok(badGate.length === 0, `${name}: C+0x564 bits 0x4000 / 0x20000 every record (${badGate.slice(0, 4).join(' | ') || 'all equal'})`);
}
if (ran <= 0) console.log('SKIP: no traces');
if (process.env.RELOAD_DUMP) (await import('node:fs')).writeFileSync(process.env.RELOAD_DUMP, JSON.stringify(DUMP));
console.log(fails ? `${fails} FAILED` : 'all ok');
process.exit(fails ? 1 : 0);
