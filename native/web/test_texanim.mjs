// The event actors' texture animations (worker 0248; notes/event-vm-research.md "Texture animations").
//   node native/web/test_texanim.mjs
// Hand cases (no data): FUN_005a8850's set-up ('@' = on), setanim_l's name-prefix start / stop (FUN_00381168 ->
// FUN_003772c8 -> FUN_005aab10 / FUN_005aabf8, FUN_00414210), the key choice FUN_00414290, the advance FUN_005aa838
// (wait first, frame += 1.2, the random wait after a cycle), no copies / advance while hidden (FUN_005abec0).
// With data/event/ev0100_scr001.json + data/event/actors/actors.json: the opening's g000 mouth parts ('00_*') are on
// from startanim("00") to stopanim("00") and that span holds the voice 10110sk's playVoice (scr001's own order).
// MUTATE=prefix|wait|hidden|key|auto runs one mutant of event_actor_rt.js (a scratch copy) and expects a FAIL.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';

const here = path.dirname(fileURLToPath(import.meta.url));
let modUrl = pathToFileURL(path.join(here, 'event_actor_rt.js')).href;
const MUT = process.env.MUTATE;
if (MUT) {
  let s = readFileSync(path.join(here, 'event_actor_rt.js'), 'utf8');
  const sub = {
    prefix: ["an.name.slice(0, Math.min(8, name.length)) === name.slice(0, 8)", "an.name === name"],
    wait: ["      e.wait = f32(e.wait - dt);\n      if (e.wait < 0) e.wait = 0;\n      continue;", "      e.wait = 0;"],
    hidden: ["if (a.drawn.shown && mp.tex.length) {", "if (mp.tex.length) {"],
    key: ["        if (!(keys[j][2] <= f)) break;", "        if (!(keys[j][2] < f)) break;"],
    auto: ["on: an.name[0] === '@' ? 1 : 0", "on: 0"],
  }[MUT];
  if (!sub || !s.includes(sub[0])) throw new Error('mutant ' + MUT + ': anchor not found');
  s = s.replace(sub[0], sub[1]);
  const f = path.join(os.tmpdir(), 'event_actor_rt_mut_' + MUT + '.mjs');
  writeFileSync(f, s);
  modUrl = pathToFileURL(f).href;
}
const AR = await import(modUrl);
const { EventActors, texAnimKey } = AR;
let fail = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };

// g000's four animations and p000's three, as the exporter reads them (hand-written: names, frames, waits, keys)
const G000 = [
  { name: '00_ue', frames: 20, wait: [0, 0], keys: [[0, 0, 5], [0, 11, 10], [0, 22, 15], [0, 33, 20]] },
  { name: '00_sita', frames: 20, wait: [0, 0], keys: [[0, 44, 5], [0, 56, 10], [0, 68, 15], [0, 80, 20]] },
  { name: '00_naka', frames: 20, wait: [0, 0], keys: [[0, 93, 5], [0, 103, 10], [0, 112, 15], [0, 121, 20]] },
  { name: '01_eye', frames: 665, wait: [0, 0], keys: [[100, 62, 100], [100, 92, 105]] },
];
const P000 = [
  { name: '@_eye', frames: 19, wait: [128, 512], keys: [[0, 0, 8], [0, 14, 10], [0, 28, 14], [0, 14, 19]] },
  { name: 'eye_clo', frames: 1, wait: [0, 0], keys: [[0, 28, 1]] },
  { name: 'ang', frames: 1, wait: [0, 0], keys: [[20, 0, 1]] },
];
const lib = { g000: G000, p000: P000 };

// ---- FUN_00414290's key
{
  const k = G000[0].keys;
  const got = [0, 4, 5, 9, 10, 14, 15, 19, 20, 30].map(f => texAnimKey(k, f)).join(',');
  ok(got === '0,0,1,1,2,2,3,3,0,0', 'key per frame 0..30 of 00_ue (key k runs to its frame; from the last key\'s end key 0): ' + got);
  ok(texAnimKey([[0, 28, 1]], 0) === 0, 'one-key animation: key 0');
}

// ---- set-up, start / stop by prefix, the advance
{
  let r = 0.25;
  const A = new EventActors({ clipFrames: () => null, texAnims: m => lib[m] || null, rand: () => r, warn: () => {} });
  const N = A.natives({ frameNo: 0 });
  const call = (k, ...a) => N[Object.keys(N).find(x => x.startsWith('fake/KerberosActor.' + k + '('))](null, a);
  call('load_l', 'g000', 1, 1); call('load_l', 'p000', 2, 1);
  const g = A.get(1); let p = A.get(2);
  ok(g.mp.tex.every(e => e.on === 0) && p.mp.tex[0].on === 1 && p.mp.tex[1].on === 0, 'FUN_005a8850: only the \'@\' animation (p000 @_eye) is on at set-up');
  A.step();                                                   // first draw: no matrix yet (no snapshot), then the update
  call('setanim_l', 1, '00', 1);
  A.step();
  ok(g.mp.tex.slice(0, 3).every(e => e.on === 1) && g.mp.tex[3].on === 0, 'startanim("00"): 00_ue / 00_sita / 00_naka on, 01_eye not (FUN_00414210 prefix)');
  for (let i = 0; i < 5; i++) A.step();
  ok(g.drawn.tex.length === 3 && g.drawn.tex[0][1] === Math.trunc(Math.fround(1.2 * 4) + 1e-9) - 0, 'g000 draws 3 copies; frame advances 1.2 a draw: ' + JSON.stringify(g.drawn.tex));
  // 20-frame loop with no wait (max 0): frame back to 0 at (int)frame >= 20
  for (let i = 0; i < 12; i++) A.step();
  ok(g.mp.tex[0].frame < 20 && g.mp.tex[0].wait === 0, 'loop: frame wraps to 0 at 20, no wait (wait max 0): ' + g.mp.tex[0].frame);
  call('setanim_l', 1, '00', 0);
  A.step();
  ok(g.mp.tex.every(e => e.on === 0), 'stopanim("00"): all three off');
  A.step();
  ok(g.drawn.tex.length === 0, 'stopped: no copies (the face texture as uploaded)');
  // p000's blink: 19 frames, then wait = 128 + (512 - 128) x rand (a fresh actor: p000 ran above)
  call('finalize_l', 2); call('load_l', 'p000', 3, 1);
  const p3 = A.get(3); A.step();
  p = p3;
  let n = 0;
  while (p.mp.tex[0].wait === 0 && n < 40) { A.step(); n++; }
  ok(n === 16 && Math.abs(p.mp.tex[0].wait - (128 + 384 * 0.25)) < 1e-3, 'p000 @_eye: after 16 draws (int)(16 x 1.2) >= 19 -> wait 128 + 384 x FUN_0040b5c0() = ' + p.mp.tex[0].wait + ' (draws ' + n + ')');
  A.step();
  ok(p.drawn.tex.length === 0 && Math.abs(p.mp.tex[0].wait - (224 - 1.2)) < 1e-3, 'during the wait: no copy, the wait runs down 1.2 a draw: ' + p.mp.tex[0].wait);
  // hidden: no copies, no advance (FUN_005abec0 skips the MP)
  call('setVisible_l', 3, 0); A.step();
  const w0 = p.mp.tex[0].wait; A.step(); A.step();
  ok(p.mp.tex[0].wait === w0, 'hidden actor: the texture animations hold (no draw, FUN_005abec0 +0x440 & 0xf00 0x200)');
}

// ---- the opening: g000's mouths vs the voice (scr001's own order, the page VM)
{
  const here2 = (f) => path.join(here, f);
  if (!existsSync(here2('data/event/ev0100_scr001.json')) || !existsSync(here2('data/event/actors/actors.json'))) {
    console.log('SKIP the opening checks: no data/event/ev0100_scr001.json / actors.json (build steps event, event_actors)');
  } else {
    const { EventRuntime } = await import(pathToFileURL(here2('event_rt.js')).href);
    const data = JSON.parse(readFileSync(here2('data/event/ev0100_scr001.json'), 'utf8'));
    const idx = JSON.parse(readFileSync(here2('data/event/actors/actors.json'), 'utf8'));
    ok(idx.models.g000 && idx.models.g000.texanim && idx.models.g000.texanim.anims.map(a => a.name).join(',') === '00_ue,00_sita,00_naka,01_eye',
       'export: g000 texanm = 00_ue, 00_sita, 00_naka, 01_eye');
    ok(idx.models.p000 && idx.models.p000.texanim && idx.models.p000.texanim.anims[0].wait.join(',') === '128,512', 'export: p000 @_eye wait 128..512');
    const clipFrames = (m, n, c) => { const M = idx.models[m], p = M && M.packs[n]; return p && p.clipFrames[c] != null ? p.clipFrames[c] : null; };
    const A = new EventActors({ clipFrames, texAnims: m => (idx.models[m] && idx.models[m].texanim ? idx.models[m].texanim.anims : null), rand: () => 0.5, warn: () => {} });
    const voices = [];
    const sound = { voices: () => ({ load() {}, play: (n) => voices.push([rt.frameNo, n]), has: () => true, stop() {}, skip() {} }) };
    const rt = new EventRuntime(data, { warn: () => {}, actors: A, sound });
    rt.start();
    const on = [];                                             // frames the g000 mouth draws a copy
    for (let f = 0; f < 4000 && !rt.done; f++) {
      rt.frame(20); A.step();
      const g = A.slots.find(a => a.model === 'g000');
      if (g && g.drawn && g.drawn.tex.some(([i]) => i < 3)) on.push(rt.frameNo);
    }
    const logs = A.log.filter(x => /^setanim/.test(x[1])).map(x => x[1]);
    // startanim("00") on g000; its stopanim("00") (pc 5385) comes after finalize of g000's slot: FUN_0037a600 finds no
    // slot, nothing happens (the mouths stop with the slot)
    const gid = (A.log.find(x => / g000 /.test(' ' + x[1] + ' ') && /^load /.test(x[1])) || [0, 'load g000 -1'])[1].split(' ')[2];
    ok(logs.some(m => m === 'setanim ' + gid + ' 00 1'), 'scr001: startanim("00") on g000 (slot ' + gid + '): ' + logs.join(' | '));
    const vsk = rt.log.find(([, m]) => /^voice 10110sk/.test(m));
    ok(on.length > 0, 'g000\'s mouth copies drawn on ' + on.length + ' frames (' + on[0] + '..' + on[on.length - 1] + ')');
    if (vsk) ok(on.length && on[0] <= vsk[0] + 1 && vsk[0] <= on[on.length - 1], 'the voice 10110sk (frame ' + vsk[0] + ') starts inside the mouth span');
    else console.log('note: 10110sk\'s playVoice not seen in the log (sound back end stub)');
  }
}

console.log(fail ? `${fail} FAILED` : 'all ok');
process.exit(fail ? 1 : 0);
