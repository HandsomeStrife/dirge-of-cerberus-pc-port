// The event's actors (event_actor_rt.js, worker 0218; notes/event-vm-research.md "Event actors").
//   node native/web/test_event_actors.mjs
// Hand cases (no data): the KerberosActor natives' slot effects (setpos / setdirrot / setrot / attach / setVisible /
// setmotion* / setmotionspeed / finalize) and the per-frame order (MP draw + advance, then FUN_003772c8).
// With data/event/ev0100_scr001.json + data/event/actors/actors.json: scr001's loads are all exported (the exporter's
// MODELS / FILES), every clip it plays resolves. With tools/trace/out/w218_mp_a.jsonl (TRACE_FIELDSET=evactor,
// TRACE_EVMP=14d4700,14d5000,14d5900, from 0210's stage-start state): actor 1 / 3's MP rate and head frame per frame
// after the block-2 re-sync against the page's.
import { readFileSync, existsSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const OUT = process.env.TRACE_OUT ?? path.join(root, 'tools/trace/out');
const imp = f => import(pathToFileURL(path.join(here, f)).href);
const { EventActors, msToFrames } = await imp('event_actor_rt.js');
const { EventRuntime } = await imp('event_rt.js');
let fail = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };
const done = () => { console.log(fail ? `${fail} FAILED` : 'all ok'); process.exit(fail ? 1 : 0); };
const near = (a, b, e = 1e-5) => Math.abs(a - b) <= e;

// ---- hand cases ----
{
  const frames = { 'm/1/clipA': 100, 'm/1/clipB': 40, 'm/2/clipA': 7 };
  const A = new EventActors({ clipFrames: (m, n, c) => frames[`${m}/${n}/${c}`] ?? null, warn: () => {} });
  const N = A.natives({ frameNo: 0 });
  const call = (k, ...a) => N[Object.keys(N).find(x => x.startsWith('fake/KerberosActor.' + k + '(') || x.startsWith('fake/KerberosLight.' + k + '('))](null, a);
  call('load_l', 'm', 1, 1); call('load_l', 'm', 2, 1); call('load_l', 'w', 3, 1);
  const a = A.get(1), b = A.get(2);
  ok(a && b && a.visible && a.clip, 'load_l: a slot per id, visible and clipped (FUN_00376308 bits 49 / 52)');
  call('setpos_l', 1, 10, 20, 30);
  ok(a.M[12] === 10 && a.M[13] === 20 && a.M[14] === 30 && a.M[0] === 1, 'setpos_l: matrix row 3 (FUN_0037abf8 +0x50)');
  call('setdirrot_l', 1, 180, 0);
  ok(near(a.M[0], 1) && near(a.M[2], 0) && near(a.M[10], 1), 'setdirrot_l(180, 0): +180 wraps to 0 -> identity rows (FUN_0039f3b0)');
  call('setdirrot_l', 1, 0, 0);
  ok(near(a.M[0], -1) && near(a.M[10], -1), 'setdirrot_l(0, 0): 180 degrees about y');
  call('setrot_l', 2, 90, 0, 0);
  ok(near(b.M[5], 0) && near(b.M[6], 1) && near(b.M[9], -1), 'setrot_l x 90: FUN_00259928 rows (m5 c, m6 s, m9 -s)');
  call('setrot_l', 2, 0, 0, 90);
  ok(near(b.M[0], 0) && near(b.M[1], 1) && near(b.M[4], -1), 'setrot_l z 90: FUN_002599f8 rows');
  call('setrot_l', 2, 90, 90, 0);    // rotX . rotY (FUN_0026125c(out, Y, X) = X x Y): row 1 of X (0,0,1) x Y -> (sin, 0, cos)? = (1, 0, 0)
  ok(near(b.M[4], 1) && near(b.M[5], 0) && near(b.M[6], 0), 'setrot_l: x then y (row 1 = X row 1 x Y)');
  call('loadmotion_l', 1, 1);
  call('setmotion2_l', 1, 'clipA', 0, 1000, 0);
  ok(a.code === 'clipA' && a.start === msToFrames(1000) * 2 && a.start === 120, 'setmotion2_l: +0xb4 = (int)(ms x 0.06) x 2');
  A.step();
  ok(a.mp.clip === 'clipA' && a.mp.frame === 60 && a.code === null && a.start === -1, 'update: request, then FUN_005a8fd0 frame = 120 x 0.5');
  A.step();
  ok(a.frameDrawn === 60 && near(a.mp.frame, 60.6), 'next frame: drawn at 60, then advanced by 0.5 x 1.2 (rounded toward zero)');
  call('setmotionspeed_l', 1, 0.3); A.step();
  ok(near(a.mp.rate, 0.15) && a.speed === 0, 'setmotionspeed_l 0.3 -> MP+0x40c 0.15, +0xdc cleared');
  call('setmotion2_l', 1, 'clipA', 0, 99999, 0); A.step();
  ok(near(a.mp.frame, 99.5, 1e-4), 'start past the end: min(x, 2n - 1) x 0.5 = n - 0.5');
  // setmotion3 after setmotion2 in one window: the pending start (+0xb4) stays (FUN_00381268 doesn't touch it)
  call('setmotion2_l', 1, 'clipA', 0, 500, 0); call('setmotion3_l', 1, 'clipB', 0, 0); A.step();
  ok(a.mp.clip === 'clipB' && near(a.mp.frame, 30), 'setmotion3_l keeps a pending setmotion2 start (clipB at frame 30)');
  // setmotion_l: no new request while the same name is still pending; loop flag -> looped layer
  call('setmotion_l', 1, 'clipA', 1, 0, 0); call('setmotion_l', 1, 'clipA', 0, 0, 0);
  ok(a.loop === true, 'setmotion_l: the second call with the pending name is ignored (FUN_003811d8)');
  A.step();
  ok(a.mp.clip === 'clipA' && a.mp.loop && a.mp.frame === 0, 'setmotion_l loop: looped layer from frame 0');
  for (let i = 0; i < 400; i++) A.step();
  ok(a.mp.frame < 100, `looped clip wraps (${a.mp.frame.toFixed(2)})`);
  { const f0 = a.mp.frame; call('setmotion3_l', 1, 'clipA', 0, 0); A.step();
    ok(a.mp.frame > f0 || a.mp.frame < 1 && f0 > 98, `the playing clip asked again (flags 0x80, FUN_005a91c8) is not restarted (${f0.toFixed(1)} -> ${a.mp.frame.toFixed(1)})`); }
  call('setmotion2_l', 2, 'clipB', 0, 0, 0); A.step();
  ok(b.mp.clip === null, 'a clip outside the actor\'s motion files is not played (FUN_005a7390)');
  call('attach_l', 1, 3, 15, 0);
  ok(a.mp.kids[0] === null, 'attach_l: bound at the next update (FUN_003771e0)');
  A.step();
  ok(a.mp.kids[0] === 3 && a.mp.marker[0] === 15, 'update binds child 3 at marker 15');
  call('setVisible_l', 1, 0); ok(a.shown, 'setVisible_l takes effect at the update'); A.step(); ok(!a.shown, '... then hidden');
  call('finalize_l', 2); ok(!A.get(2), 'finalize_l frees the slot');
  call('set_directioncolor', 0, 128, 64, 0); call('set_ambientcolor', 8, 16, 32);
  ok(A.lights.col[0][0] === 1 && A.lights.col[0][1] === 0.5 && near(A.lights.amb[2], 0.25), 'light colours x 1/128 (FUN_003a4fe8)');
}

// ---- scr001 with the exported actors ----
const dp = path.join(here, 'data/event/ev0100_scr001.json'), ip = path.join(here, 'data/event/actors/actors.json');
if (!existsSync(dp) || !existsSync(ip)) { console.log('SKIP scr001 parts: no data/event (export_web_event.py / export_web_event_actors.py)'); done(); }
const data = JSON.parse(readFileSync(dp, 'utf8')), idx = JSON.parse(readFileSync(ip, 'utf8'));
const clipFrames = (m, n, c) => { const p = idx.models[m] && idx.models[m].packs[n]; return p && p.clipFrames[c] != null ? p.clipFrames[c] : null; };
const warns = [];
const A = new EventActors({ clipFrames, warn: m => warns.push(m) });
const rt = new EventRuntime(data, { warn: m => warns.push(m), actors: A });
const loads = [], motions = [], plays = [];
const N0 = { ...rt.vm.natives };
for (const k of Object.keys(N0)) {
  if (k.includes('KerberosActor.load_l(Ljava')) rt.vm.natives[k] = (vm, a, s) => { loads.push(a[0]); return N0[k](vm, a, s); };
  if (k.includes('KerberosActor.loadmotion_l')) rt.vm.natives[k] = (vm, a, s) => { motions.push([a[0], a[1]]); return N0[k](vm, a, s); };
  if (/KerberosActor\.setmotion[23]?_l/.test(k)) rt.vm.natives[k] = (vm, a, s) => { plays.push([a[0], String(a[1])]); return N0[k](vm, a, s); };
}
rt.start();
const hist = [];
let n = 0, bindShown = [], staleM = 0, cutsSeen = 0;
const skinned = new Set(Object.keys(idx.models).filter(m => Object.keys(idx.models[m].packs).length));
const lastM = new Map();
while (!rt.done && n < 5000) {
  rt.frame(20);
  A.step(); n++;
  // the draw shows the previous update's matrix / visibility (FUN_005a8e28 before FUN_003772c8), and no actor with
  // clips is drawn shown without one (the bind-pose flash at a cut)
  for (const a of A.slots) {
    const d = a.drawn;
    if (d && lastM.has(a) && d.M !== lastM.get(a)) staleM++;
    if (d && lastM.has(a) && a.mp.M.some((x, i) => x !== d.M[i])) cutsSeen++;
    if (d && d.shown && skinned.has(a.model) && !d.clip && (d.M[12] || d.M[13] || d.M[14])) bindShown.push(n + ':' + a.id);   // at the origin (no setpos yet) is off-screen, as in the game (T w218_act_a: 4 / 6 at 0,0,0)
    lastM.set(a, a.mp.M);
  }
  const g = id => { const a = A.get(id); return a ? [a.mp.clip, a.frameDrawn, a.mp.rate] : null; };
  hist.push({ 1: g(1), 3: g(3) });
}
ok(rt.done, `scr001 runs to its end with the actors (${n} frames)`);
ok(staleM === 0 && cutsSeen > 0, `the draw uses the previous update's matrix (${cutsSeen} frames where the update moved an actor after its draw)`);
// the only placed, shown, clipless actors: soldiers 4 / 6 between their block-1 setpos and their block-2 clips, as in the
// game (T w218_act_a: placed from record 591 / 594 to 745 with no request); none at a cut otherwise
const odd = bindShown.filter(s => { const [f, id] = s.split(':').map(Number); return !((id === 4 || id === 6) && f > 226 && f <= 377); });
ok(odd.length === 0 && bindShown.length > 0, `no placed actor with clips is drawn without one, but 4 / 6 in block 1 as the game (${odd.slice(0, 5).join(' ') || 'none other'})`);
const MODELS = ['e027', 'e048', 'e063', 'g000', 'g013', 'n013', 'p005', 'p014', 'w003'];   // export_web_event_actors.py MODELS
const FILES = [0x01, 0x02, 0x04, 0x05, 0x1d, 0x22, 0xc6];                                  // ... FILES
ok(loads.every(m => MODELS.includes(m) || m === 'p000'), `load_l models: ${[...new Set(loads)].join(' ')} (all exported or p000)`);
const vin = 14;   // actor id of p000 in scr001 (load_l('p000', 14, 1))
ok(motions.every(([id, f]) => FILES.includes(f) || (id === vin && f === 0xfe)), `loadmotion_l files: ${[...new Set(motions.map(x => x[1].toString(16)))].join(' ')} (exported, or p000's 0xfe)`);
ok(MODELS.every(m => idx.models[m]), 'every exporter model is in actors.json');
const unresolved = warns.filter(w => /clip .* not loaded/.test(w) && !/\(p000\)/.test(w));
ok(unresolved.length === 0, `every clip scr001 plays resolves (but p000's): ${unresolved.join('; ') || 'none missing'}`);

// ---- against the game (w218_mp_a: MP 0 = actor 1, MP 1 = actor 3) ----
const tp = path.join(OUT, 'w218_mp_a.jsonl');
if (!existsSync(tp)) { console.log('SKIP trace part: no tools/trace/out/w218_mp_a.jsonl'); done(); }
const recs = readFileSync(tp, 'utf8').trim().split('\n').slice(1).map(l => JSON.parse(l));
const head = (r, k) => {
  const v = r[`mp${k}_448`], hi = typeof v === 'number' ? v & 0xff : parseInt(v.slice(0, 2), 16);
  const nm = Buffer.from(r[`mp${k}_l${hi}`], 'hex').toString('latin1').split('\0')[0];
  return [nm, r[`mp${k}_f${hi}`], r[`mp${k}_rate`]];
};
const game = recs.map(r => ({ f: r.frame, a1: head(r, 0), a3: head(r, 1) }));
// the block-2 re-sync: the record where actor 3's km0102vn frame drops (setmotion2_l 3500 ms -> 210)
const gi = game.findIndex((g, i) => i && g.a3[1] < game[i - 1].a3[1]);
const pi = hist.findIndex((h, i) => i && h[3] && hist[i - 1][3] && h[3][1] < hist[i - 1][3][1]);
ok(gi > 0 && pi > 0, `block-2 re-sync found: game record ${game[gi] && game[gi].f}, page frame ${pi + 1}`);
let worst = 0, cnt = 0;
for (let k = 0; gi + k < game.length && pi + k < hist.length; k++) {
  const G = game[gi + k], P = hist[pi + k];
  for (const [g, p] of [[G.a1, P[1]], [G.a3, P[3]]]) {
    if (g[0] !== p[0] || Math.abs(g[2] - p[2]) > 1e-6) worst = Infinity;
    else worst = Math.max(worst, Math.abs(g[1] - p[1]));
    cnt++;
  }
}
ok(cnt > 60 && worst < 1e-4, `actors 1 / 3 after the re-sync: ${cnt} samples, clip + rate equal, max head-frame error ${worst}`);
// before it: the rates (0.15 = speed 0.3, 0.3 = speed 0.6, 0.5 default) as the trace shows them
const rates = new Set(game.map(g => g.a1[2]).concat(game.map(g => g.a3[2])).map(x => x.toFixed(3)));
ok(['0.150', '0.300', '0.500'].every(r => rates.has(r)), `MP+0x40c values in the trace: ${[...rates].join(' ')} (speed x 0.5)`);
// frame step per record at rate 0.5: 0.6 (FUN_005aa2a8 x STEP)
const st = game.slice(gi + 1, gi + 20).map((g, i) => g.a1[1] - game[gi + i].a1[1]);
ok(st.every(d => near(d, 0.6, 1e-3)), `the game's head frame steps 0.6 a frame at rate 0.5 (${st.slice(0, 3).map(x => x.toFixed(4))})`);
done();
