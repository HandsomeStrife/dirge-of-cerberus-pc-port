// cmp_event_cams.mjs (worker 0261; notes/story-cutscenes.md): an event's cameras on the page's runtime against a PCSX2 trace, shot by shot.
//   node tools/trace/cmp_event_cams.mjs CLS.METHOD TRACE.jsonl[,TRACE2.jsonl] [--from F] [--to F] [--shift N] [--jump U] [-v]   (--jump: a fast shot moves more than the default 5 u a frame)
// TRACE = TRACE_FIELDSET=event (ev_clock, ev_cam0..5). A shot = a stretch with one camera active and no jump. The page's loads take
// no time and the game's frames take what they take (a load hitch: 3 frames' ms in one), so shots are matched in order and compared by the
// event clock from each shot's first frame (the page's frames interpolated). Prints per shot the game's frame
// range, both lengths and the largest eye / aim / up point / fov errors.
import fs from 'node:fs';
import { StageRuntime } from '../../native/web/stage_controller.js';
import { answers } from './event_answers.mjs';

const args = process.argv.slice(2), [ev, tr] = args;
const opt = (k, d) => { const i = args.indexOf(k); return i < 0 ? d : Number(args[i + 1]); };
const jump = opt('--jump', 5), from = opt('--from', 0), to = opt('--to', 1e9), shift = opt('--shift', 0), verbose = args.includes('-v'), JUMP = opt('--jump', 5);   // --jump: a fast move isn't a cut
const data = JSON.parse(fs.readFileSync(new URL('../../native/web/data/event/ev0100_stage.json', import.meta.url)));
const f3 = (b, o) => [b.readFloatLE(o), b.readFloatLE(o + 4), b.readFloatLE(o + 8)];
const game = [];
for (const file of tr.split(',')) for (const l of fs.readFileSync(file, 'utf8').split('\n')) {
  if (!l.trim()) continue;
  const r = JSON.parse(l); if (r.meta || r.frame < from || r.frame > to) continue;
  let cam = null;
  for (let i = 0; i < 6; i++) {
    const b = Buffer.from(r['ev_cam' + i], 'hex');
    if (b[0x34]) { cam = { i, eye: f3(b, 0), aim: f3(b, 0x10), up: f3(b, 0x20), fov: b.readFloatLE(0x30) }; break; }
  }
  const ck = Buffer.from(r.ev_clock, 'hex');
  game.push({ f: r.frame, cam, ms: (ck.readUInt32LE(0) - ck.readUInt32LE(16)) >>> 0 });
}
const [cls, m] = ev.split('.'), M = data.classes[cls].methods.find(x => x.name === m);
const zf = new Array(64).fill(0), warns = [];
const ans = args.includes('--answers') ? answers(args[args.indexOf('--answers') + 1].split(',')) : null;   // worker 0263: a choice box's keys
const R = new StageRuntime(data, { autoSkip: false, warn: w => warns.push(w), flags: () => zf, sound: {}, ...(ans ? { windows: ans.windows } : {}) });
R.vm.start(cls, m, M.desc, M.desc === '()V' ? [] : [101, 102, 103].map(id => ({ f: { id } })));   // help_orei02's actors
const page = [];
for (let f = 0; f < 20000 && !R.vm.done; f++) {
  if (ans) ans.step(f);
  R.frame(20);
  const i = R.cams.findIndex(c => c.active);
  page.push({ f, cam: i < 0 ? null : { i, eye: R.cams[i].eye.slice(), aim: R.cams[i].aim.slice(), up: R.cams[i].up.slice(), fov: R.cams[i].fov } });
}
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
// a new shot: another camera, or a jump of the eye over 5 u in a frame (Camera objects are reused)
function shots(seq) {
  const out = []; let cur = null, prev = null;
  for (const s of seq) {
    if (!s.cam) { cur = null; prev = null; continue; }
    if (!cur || cur.i !== s.cam.i || (prev && dist(prev.cam.eye, s.cam.eye) > jump)) { cur = { i: s.cam.i, fr: [] }; out.push(cur); }
    cur.fr.push(s); prev = s;
  }
  return out;
}
const G = shots(game), P = shots(page);
console.log(`${ev}: game shots ${G.length}, page shots ${P.length}, page frames ${page.length}, done ${R.vm.done}`);
let worst = [0, 0, 0, 0];
for (let k = 0; k < Math.max(G.length, P.length); k++) {
  const g = G[k], p = P[k + shift];
  if (!g || !p) { console.log(`shot ${k}: ${g ? 'game f' + g.fr[0].f + ' only' : 'page only'}`); continue; }
  let e = [0, 0, 0, 0], jw = 0;
  const lerp = (a, b, u) => a.map((v, q) => v + (b[q] - v) * u);
  for (let j = 0; j < g.fr.length; j++) {
    const x = ((g.fr[j].ms - g.fr[0].ms) >>> 0) / 20, x0 = Math.floor(x), u = x - x0;
    if (x0 + 1 >= p.fr.length) break;
    const a = g.fr[j].cam, p0 = p.fr[x0].cam, p1 = p.fr[x0 + 1].cam;
    const b = { eye: lerp(p0.eye, p1.eye, u), aim: lerp(p0.aim, p1.aim, u), up: lerp(p0.up, p1.up, u), fov: p0.fov + (p1.fov - p0.fov) * u };
    if (dist(a.aim, b.aim) > e[1]) jw = g.fr[j].f;
    e = [Math.max(e[0], dist(a.eye, b.eye)), Math.max(e[1], dist(a.aim, b.aim)), Math.max(e[2], dist(a.up, b.up)), Math.max(e[3], Math.abs(a.fov - b.fov))];
    if (verbose && j % 25 === 0) console.log(' ', g.fr[j].f, a.eye.map(v => v.toFixed(2)).join(','), '|', b.eye.map(v => v.toFixed(2)).join(','));
  }
  worst = worst.map((w, q) => Math.max(w, e[q]));
  console.log(`shot ${k}: game f${g.fr[0].f}-${g.fr[g.fr.length - 1].f} (${g.fr.length}, clock ${((g.fr[g.fr.length - 1].ms - g.fr[0].ms) >>> 0) / 20 + 1}) page ${p.fr[0].f}-${p.fr[p.fr.length - 1].f} (${p.fr.length}) cam ${g.i}/${p.i}  eye ${e[0].toFixed(3)} aim ${e[1].toFixed(3)} (f${jw}) up ${e[2].toFixed(3)} fov ${e[3].toFixed(3)}`);
}
console.log('largest: eye ' + worst[0].toFixed(3) + ' aim ' + worst[1].toFixed(3) + ' up ' + worst[2].toFixed(3) + ' fov ' + worst[3].toFixed(3));
