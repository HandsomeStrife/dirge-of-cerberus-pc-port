// test_warp_flags.mjs -- the cutscene warps (warp.js, PAGE AID) carry a walked route state's stage / global flags whole
// (worker 0265, fidelity fix 2026-11-09). Each WARPS entry with `state` is compared with that state's RAM read-out
// (tools/trace/out/**/STATE.json 'flags' / 'gflags', written by tools/trace/route.py; gitignored: SKIPPED without it), and
// applyWarp must leave exactly those flags (every other flag 0).
//   node native/web/test_warp_flags.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { WARPS, applyWarp } from './warp.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, '../../tools/trace/out');
let fails = 0, oks = 0, skips = 0;
const ok = (c, m) => { if (c) { oks++; console.log('ok   ' + m); } else { fails++; console.log('FAIL ' + m); } };
const find = (name) => {
  const stack = [OUT];
  while (stack.length) {
    const d = stack.pop();
    let es; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of es) {
      if (e.isDirectory()) stack.push(path.join(d, e.name));
      else if (e.name === name + '.json') return path.join(d, e.name);
    }
  }
  return null;
};
const norm = (o) => JSON.stringify(Object.entries(o || {}).map(([k, v]) => [+k, v]).filter(([, v]) => v !== 0).sort((a, b) => a[0] - b[0]));
for (const [name, w] of Object.entries(WARPS)) {
  if (!w.state) continue;
  const f = find(w.state);
  if (!f) { skips++; console.log(`SKIPPED ${name}: route state ${w.state}.json not under tools/trace/out (gitignored; tools/trace/route.py writes it)`); continue; }
  const st = JSON.parse(fs.readFileSync(f, 'utf8'));
  ok(norm(w.stage) === norm(st.flags), `${name}: stage flags = ${w.state}'s RAM ${norm(st.flags)} (warp ${norm(w.stage)})`);
  ok(norm(w.global) === norm(st.gflags), `${name}: global flags = ${w.state}'s RAM ${norm(st.gflags)} (warp ${norm(w.global)})`);
  // applied over a world that had other flags set: only the state's remain
  const flags = { 0: 4, 9: 3, 33: 1 }, gflags = new Uint8Array(64); gflags[5] = 2; gflags[1] = 3;
  const ctrl = { reset() {}, locate() {}, C: {} };
  applyWarp(name, { ctrl, follow: { reset() {}, pitch: 0 }, flags, gflags });
  const g = {}; gflags.forEach((v, i) => { if (v) g[i] = v; });
  ok(norm(flags) === norm(st.flags) && norm(g) === norm(st.gflags), `${name}: applyWarp leaves exactly the state's flags (${norm(flags)} / ${norm(g)})`);
}
console.log((fails ? 'FAILED ' : 'ok ') + oks + ' / ' + (oks + fails) + (skips ? ', ' + skips + ' SKIPPED' : ''));
process.exit(fails ? 1 : 0);
