// cmp_event_actors.mjs (worker 0261; notes/story-cutscenes.md): an event's actors on the page's runtime against a PCSX2 trace.
//   node tools/trace/cmp_event_actors.mjs CLS.METHOD TRACE.jsonl[,..] --mp MODEL=N,.. --anchor G:P,..
// TRACE = TRACE_FIELDSET=evactor TRACE_EVMP=<slot MPs>. --mp maps a model to its index in TRACE_EVMP; --anchor pairs a game frame with a page
// frame (each shot's first frames: cmp_event_cams.mjs prints them). Prints per model the largest position error (matrix row 3) and clip frame
// error, with the game's frames scaled to the event clock inside each anchor stretch.
import fs from 'node:fs';
import { StageRuntime } from '../../native/web/stage_controller.js';
import { EventActors } from '../../native/web/event_actor_rt.js';

const args = process.argv.slice(2), [ev, tr] = args;
const opt = (k) => { const i = args.indexOf(k); return i < 0 ? '' : args[i + 1]; };
const mpIdx = Object.fromEntries(opt('--mp').split(',').filter(Boolean).map(x => x.split('=')).map(([m, n]) => [m, +n]));
const anchors = opt('--anchor').split(',').filter(Boolean).map(x => x.split(':').map(Number));
const data = JSON.parse(fs.readFileSync(new URL('../../native/web/data/event/ev0100_stage.json', import.meta.url)));
const actors = JSON.parse(fs.readFileSync(new URL('../../native/web/data/event/actors/actors.json', import.meta.url)));
const clipFrames = (m, n, c) => { const p = actors.models[m] && actors.models[m].packs[n]; return p && p.clipFrames[c] != null ? p.clipFrames[c] : null; };
const zf = new Array(64).fill(0), A = new EventActors({ clipFrames, warn: () => {} });
const [cls, m] = ev.split('.'), M = data.classes[cls].methods.find(x => x.name === m);
const R = new StageRuntime(data, { autoSkip: false, warn: () => {}, flags: () => zf, sound: {}, actors: A });
R.vm.start(cls, m, M.desc, M.desc === '()V' ? [] : [101, 102, 103].map(id => ({ f: { id } })));   // help_orei02's actors
const page = [];
for (let f = 0; f < 20000 && !R.vm.done; f++) {
  R.frame(20); A.step();  // stage_view.js step: the draw, then FUN_003772c8
  page.push(Object.fromEntries(A.slots.map(a => [a.model + '#' + a.id, { pos: [a.M[12], a.M[13], a.M[14]], clip: a.mp.clip, frame: a.mp.frame, mp: a.mp.M ? [a.mp.M[12], a.mp.M[13], a.mp.M[14]] : null }])));
}
const worst = {}, game = [];
for (const file of tr.split(',')) for (const l of fs.readFileSync(file, 'utf8').split('\n')) {
  if (!l.trim()) continue; const r = JSON.parse(l); if (r.meta) continue; game.push(r);
}
for (const r of game) {
  const ck = Buffer.from(r.ev_clock, 'hex'), ms = (ck.readUInt32LE(0) - ck.readUInt32LE(16)) >>> 0;
  r.ms = ms;
}
for (const r of game) {
  const an = anchors.filter(a => a[0] <= r.frame).pop(); if (!an) continue;
  const g0 = game.find(x => x.frame === an[0]);
  const pf = an[1] + (g0 ? ((r.ms - g0.ms) >>> 0) / 20 : r.frame - an[0]), P = page[Math.floor(pf)]; if (!P) continue;
  const next = anchors[anchors.indexOf(an) + 1];
  if (next && pf >= next[1]) continue;                     // the game's stretch is longer (its blocks start later): nothing to compare past the page's
  for (const [mo, n] of Object.entries(mpIdx)) {
    const key = Object.keys(P).find(k => k.startsWith(mo + '#')); if (!key) continue;
    const pa = P[key];
    const gm = Buffer.from(r[`mp${n}_mat`], 'hex'), gp = [gm.readFloatLE(48), gm.readFloatLE(52), gm.readFloatLE(56)];
    let gf = null;
    const head = (Number(r[`mp${n}_448`]) & 0xff);
    gf = Number(r[`mp${n}_f${head}`]);
    const w = (worst[mo] ??= { pos: 0, frame: 0, fpos: 0, f: 0, n: 0 });
    w.n++;
    if (pa.mp) { w.np = (w.np || 0) + 1; w.last = gp; const d = Math.hypot(gp[0] - pa.mp[0], gp[1] - pa.mp[1], gp[2] - pa.mp[2]); if (d > w.pos) { w.pos = d; w.fpos = r.frame; } }
    if (pa.clip && Number.isFinite(gf)) { const d = Math.abs(gf - pa.frame); if (d > w.frame && d < 500) { w.frame = d; w.f = r.frame; w.g = gf; w.p = pa.frame; w.clip = pa.clip; } }
  }
}
for (const [mo, w] of Object.entries(worst)) console.log(`${mo}: ${w.n} frames, position error ${w.pos.toFixed(3)} (f${w.fpos}, ${w.np || 0} compared, game's last ${w.last ? w.last.map(v => v.toFixed(1)) : '-'}), clip frame error ${w.frame.toFixed(2)} (f${w.f}: game ${w.g} page ${w.p} ${w.clip})`);
