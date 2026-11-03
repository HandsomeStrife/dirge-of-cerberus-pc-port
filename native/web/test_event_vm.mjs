// The event VM + runtime (event_vm.js / event_rt.js, worker 0210; notes/event-vm-research.md).
//   node --import ./native/web/test_hooks.mjs native/web/test_event_vm.mjs
// Hand cases (no data needed): the VM's frame handling for wait / sleep / setTimer (FUN_00379d48, FUN_003a0e48,
// FUN_0037db48 + FUN_00377c68 case 0x1c), a synchronized block, the splines (FUN_002616f0 / FUN_00261a90), a camera
// move (FUN_003779d0). With data/event/ev0100_scr001.json: scr001 runs to its end. With the traces
// tools/trace/out/w210_intro_*.jsonl (TRACE_FIELDSET=event, from the state saved at the stage start after a Restart):
// the event clock's step per frame and each camera block's eye / aim / fov against the game.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const OUT = process.env.TRACE_OUT ?? path.join(root, 'tools/trace/out');
const imp = f => import(pathToFileURL(path.join(here, f)).href);
const { EventVM } = await imp('event_vm.js');
const { EventRuntime, buildSpline, evalSpline } = await imp('event_rt.js');
let fail = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };
const done = () => { console.log(fail ? `${fail} FAILED` : 'all ok'); process.exit(fail ? 1 : 0); };
const warns = []; const warn = m => warns.push(String(m));
const f32 = Math.fround;

// ---- a hand-made class: bytecode assembled here (no game data) ----
const NAT = 0x10a;
function lib() {
  const m = (name, desc) => ({ access: NAT, name, desc });
  return {
    'fake/KerberosEvent': { name: 'fake/KerberosEvent', super: null, cp: [], fields: [],
      methods: [m('sleep', '(I)V'), m('wait', '(I)V'), m('setTimer', '(I)I')] },
    'fake/KerberosCamera': { name: 'fake/KerberosCamera', super: null, cp: [], fields: [],
      methods: [m('move_l', '(IFFF)I'), m('active_l', '(II)V'), m('adddata_start_l', '(I)V'),
                m('adddata_l', '(IFFFFFFFFFFFI)V'), m('adddata_end_l', '(II)V'), m('init_l', '(I)V')] },
  };
}
// cp: 1 sleep, 2 wait, 3 setTimer, 4 field T.x, 5 float, ...
function T(code, cpExtra = []) {
  const cp = [null, ['ref', 'fake/KerberosEvent', 'sleep', '(I)V'], ['ref', 'fake/KerberosEvent', 'wait', '(I)V'],
    ['ref', 'fake/KerberosEvent', 'setTimer', '(I)I'], ['ref', 'T', 'x', 'I'], ...cpExtra];
  const hex = code.map(b => (b & 255).toString(16).padStart(2, '0')).join('');
  return { main: 'T', splineEps: 0.5, classes: { ...lib(), T: { name: 'T', super: null, cp, fields: [{ access: 8, name: 'x', desc: 'I' }],
    methods: [{ access: 9, name: 'main', desc: '([Ljava/lang/String;)V', maxLocals: 2, code: hex }] } } };
}
const sipush = n => [0x11, (n >> 8) & 255, n & 255];
const call = i => [0xb8, 0, i];
const putx = [0xb3, 0, 4];
// main: sleep(100); x = 1; h = setTimer(50); wait(h); x = 2; sleep(40); x = 3; return
const code1 = [...sipush(100), ...call(1), 0x04, ...putx, ...sipush(50), ...call(3), 0x3c, 0x1b, ...call(2), 0x05, ...putx,
  ...sipush(40), ...call(1), 0x06, ...putx, 0xb1];
{
  const rt = new EventRuntime(T(code1), { warn });
  rt.start();
  const xs = [];
  for (let f = 1; f <= 14; f++) { rt.frame(20); xs.push(rt.vm.statics.get('T')?.x ?? 0); }
  // window k sees clock 20 (k - 1); sleep(100) from clock 0 -> window 6 (clock 100): x = 1, setTimer at 100 -> until
  // 150; slot passes: frame 6 clock 120, 7 140, 8 160 -> done; window 9: x = 2, sleep(40) from 160 -> window 11 (200): x = 3
  ok(xs.join('') === '00000111223333', `sleep / setTimer / wait land on their frames (x per frame ${xs.join('')})`);
  ok(rt.done, 'the script ends');
}
// a timer of 0 ms: done at the same frame's slot pass, the wait passes in the next window (FUN_00377c68 case 0x1c)
{
  const code = [...sipush(0), ...call(3), 0x3c, 0x1b, ...call(2), 0x04, ...putx, 0xb1];
  const rt = new EventRuntime(T(code), { warn });
  rt.start();
  const xs = [];
  for (let f = 1; f <= 3; f++) { rt.frame(20); xs.push(rt.vm.statics.get('T')?.x ?? 0); }
  ok(xs.join('') === '011', `setTimer(0) + wait: one frame (${xs.join('')})`);
}
// wait on a handle no slot holds returns at once (FUN_00380a90 finds none)
{
  const code = [...sipush(7), ...call(2), 0x04, ...putx, 0xb1];
  const rt = new EventRuntime(T(code), { warn });
  rt.start(); rt.frame(20);
  ok(rt.vm.statics.get('T').x === 1 && rt.done, 'wait(an unknown handle) does not block');
}
// VM arithmetic / branches / arrays / a static <clinit>-less class: sum of i * 1.5f for i < 5, a tableswitch
{
  // float s = 0; for (int i = 0; i < 5; i++) s += i * 1.5f; x = (int) s;  then switch (x) { 15: x = 99 }
  const prog = [0x0b, 0x43, 0x03, 0x3c,                        // fconst_0, fstore_0, iconst_0, istore_1
    0x1b, 0x08, 0xa2, 0x00, 0x11,                              // L: iload_1, iconst_5, if_icmpge +17
    0x22, 0x1b, 0x86, 0x12, 0x05, 0x6a, 0x62, 0x43,            // fload_0, iload_1, i2f, ldc #5, fmul, fadd, fstore_0
    0x84, 0x01, 0x01, 0xa7, 0xff, 0xf0,                        // iinc 1 1, goto L (-16)
    0x22, 0x8b, 0xb3, 0x00, 0x04, 0xb1];                       // fload_0, f2i, putstatic x, return
  const rt = new EventRuntime(T(prog, [['float', 1.5]]), { warn });
  rt.start(); rt.frame(20);
  ok(rt.vm.statics.get('T').x === 15, `loop / float ops / branches (x = ${rt.vm.statics.get('T').x}, want 15)`);
}
// every conditional branch (0x99-0xa4) on below / equal / above operands: x = 1 when taken
{
  const one = [0x99, 0x9a, 0x9b, 0x9c, 0x9d, 0x9e], two = [0x9f, 0xa0, 0xa1, 0xa2, 0xa3, 0xa4];
  const want = { 0x99: '010', 0x9a: '101', 0x9b: '100', 0x9c: '011', 0x9d: '001', 0x9e: '110' };
  const got = {};
  for (const op of [...one, ...two]) {
    got[op] = '';
    for (const v of [-1, 0, 1]) {
      const pre = one.includes(op) ? sipush(v) : [...sipush(v), ...sipush(0)];      // (v op 0) for the two-operand forms
      const code = [...pre, op, 0x00, 0x08, 0x03, ...putx, 0xb1, 0x04, ...putx, 0xb1];
      const rt = new EventRuntime(T(code), { warn }); rt.start(); rt.frame(20);
      got[op] += rt.vm.statics.get('T').x;
    }
  }
  const map2 = { 0x9f: 0x99, 0xa0: 0x9a, 0xa1: 0x9b, 0xa2: 0x9c, 0xa3: 0x9d, 0xa4: 0x9e };
  ok(one.every(op => got[op] === want[op]) && two.every(op => got[op] === want[map2[op]]),
    `branches 0x99-0xa4 on -1 / 0 / 1 (${[...one, ...two].map(o => o.toString(16) + ':' + got[o]).join(' ')})`);
}
// dup_x2: ..., c, b, a -> ..., a, c, b, a. Push 1, 2, 3, dup_x2, then x = ((((a * 10) + b) * 10 + c) * 10 + a')
// popping in order: 3, 2, 1, 3 -> 3213
{
  const code = [0x04, 0x05, 0x06, 0x5b,                                   // iconst_1, iconst_2, iconst_3, dup_x2
    0x3b, 0x3c, 0x3d, 0x3e,                                               // istore_0..3: 3, 2, 1, 3 (top first)
    0x1a, ...sipush(1000), 0x68, 0x1b, ...sipush(100), 0x68, 0x60, 0x1c, 0x10, 10, 0x68, 0x60, 0x1d, 0x60, ...putx, 0xb1];
  const d = T(code); d.classes.T.methods[0].maxLocals = 4;
  const rt = new EventRuntime(d, { warn }); rt.start(); rt.frame(20);
  ok(rt.vm.statics.get('T').x === 3213, `dup_x2 operand order (x = ${rt.vm.statics.get('T').x}, want 3213)`);
}
// a static access runs the superclass's <clinit> before the class's own: S's sets T.x = 1, T's then x = x * 10 + 2
// (S's static is never read, so only the superclass rule runs S first)
{
  const d = T([0xb2, 0, 4, 0xb3, 0, 4, 0xb1]);                         // getstatic x; putstatic x
  d.classes.T.super = 'S';
  d.classes.T.methods.push({ access: 8, name: '<clinit>', desc: '()V', maxLocals: 0,
    code: [0xb2, 0, 4, 0x10, 10, 0x68, 0x05, 0x60, 0xb3, 0, 4, 0xb1].map(b => b.toString(16).padStart(2, '0')).join('') });
  d.classes.S = { name: 'S', super: null, fields: [], cp: [null, ['ref', 'T', 'x', 'I']],
    methods: [{ access: 8, name: '<clinit>', desc: '()V', maxLocals: 0, code: '04b30001b1' }] };   // iconst_1; putstatic T.x
  const rt = new EventRuntime(d, { warn }); rt.start(); rt.frame(20);
  ok(rt.vm.statics.get('T').x === 12, `superclass <clinit> first (x = ${rt.vm.statics.get('T').x}, want 12)`);
}
// a call deeper than FUN_003a99f0's 16 per-depth slots is refused; integer division by 0 is refused (not decoded)
{
  const d = T([0xb8, 0, 5, 0xb1], [['ref', 'T', 'rec', '()V']]);
  d.classes.T.methods.push({ access: 8, name: 'rec', desc: '()V', maxLocals: 0, code: 'b80005b1' });
  const rt = new EventRuntime(d, { warn }); rt.start();
  let msg = ''; try { rt.frame(20); } catch (e) { msg = e.message; }
  ok(/call depth over/.test(msg) && rt.vm.frames.length === 16, `call depth limit 16 (refused with ${rt.vm.frames.length} frames: ${msg})`);
  const rt2 = new EventRuntime(T([0x04, 0x03, 0x6c, ...putx, 0xb1]), { warn }); rt2.start();
  msg = ''; try { rt2.frame(20); } catch (e) { msg = e.message; }
  ok(/division by 0/.test(msg), `idiv by 0 refused (${msg})`);
}
// splines: key values at key times; a flat segment is linear; the Hermite middle
{
  const s = buildSpline([0, 10, 20, 30], [0, 10, 0, 0.25], 0.5);
  ok([0, 10, 20, 30].every((t, i) => evalSpline(t, s) === f32([0, 10, 0, 0.25][i])), 'spline: key values at key times');
  ok(evalSpline(25, s) === f32(0.125), `spline: |dv| <= eps is linear (${evalSpline(25, s)})`);
  // segment 0: u = 0.5, slopes dv/dt = 10/10 (one-sided) and 0/20 (central): h = 10
  const want = f32(f32(0.5 * 0.5 * 2 * 0) + f32(0.125 * 1 * 10) + f32(-0.125 * 0 * 10) + f32(0.25 * 2 * 10));
  ok(Math.abs(evalSpline(5, s) - want) < 1e-5, `spline: Hermite (${evalSpline(5, s)} vs ${want})`);
  ok(evalSpline(-1, s) === 0 && evalSpline(99, s) === f32(0.25), 'spline: clamped outside the keys');
}
// a camera move: t = from + rate x (clock - start), clamped, done when t >= to (FUN_003779d0)
{
  const rt = new EventRuntime(T([0xb1]), { warn });
  const N = rt.vm.natives;
  N['fake/KerberosCamera.init_l(I)V'](rt.vm, [1]);
  N['fake/KerberosCamera.adddata_start_l(I)V'](rt.vm, [1]);
  for (const t of [0, 30]) N['fake/KerberosCamera.adddata_l(IFFFFFFFFFFFI)V'](rt.vm, [1, t, t, 0, 0, t, 0, 10, 0, -1, 0, 40 + t, 2]);
  N['fake/KerberosCamera.adddata_end_l(II)V'](rt.vm, [1, 3]);
  const h = N['fake/KerberosCamera.move_l(IFFF)I'](rt.vm, [1, 0, 30, f32(0.03)]);
  N['fake/KerberosCamera.active_l(II)V'](rt.vm, [1, -1]);
  const xs = [];
  for (let f = 0; f < 60 && rt.busy(h); f++) { rt.frame(20); xs.push(rt.view.eye[0]); }
  ok(Math.abs(xs[0] - 0.6) < 1e-5 && xs.length === 50, `move: t = 0.03 x 20 ms per frame, done at t >= 30 (${xs[0]}, ${xs.length} frames)`);
  ok(rt.view.eye[0] === 30 && rt.view.fov === 70 && rt.view.upDir[1] === 1, 'move: the last key; up point - eye negated (FUN_00379148)');
}

// ---- scr001 ----
const dp = path.join(here, 'data/event/ev0100_scr001.json');
if (!existsSync(dp)) { console.log('SKIP scr001: no data/event/ev0100_scr001.json (export_web_event.py)'); done(); }
const D = JSON.parse(readFileSync(dp, 'utf8'));
ok(D.main === 'ev0101' && Object.keys(D.classes).length === 16, `data: script class ${D.main} + ${Object.keys(D.classes).length - 1} library classes`);
const rt = new EventRuntime(D, { warn });
rt.start();
const page = [];                                     // per frame: clock, active cam, eye, aim, fov, fade
while (!rt.done && rt.frameNo < 5000) {
  rt.frame(20);
  const v = rt.view;
  const mv = v ? rt.slots.find(c => c.type === 7 && c.cam === v.cam) || null : null, cm = v ? rt.cams[v.cam] : null;
  page.push({ clock: rt.clock, cam: v ? v.cam : -1, eye: v && v.eye, aim: v && v.aim, fov: v && v.fov, fade: rt.fade ? rt.fade.level : 0,
              up: cm && cm.up.slice(), spl: cm && cm.spl, tmin: cm && cm.tmin, tmax: cm && cm.tmax, mv });
}
ok(rt.done && rt.frameNo === 1661, `scr001 ends after ${rt.frameNo} frames (main returns)`);
const camLog = rt.log.filter(x => x[1].startsWith('camera')).map(x => x[0] + ':' + x[1].split(' ')[1]).join(' ');
ok(camLog === '1:1 376:2 476:3 601:1 946:2 1051:3 1426:1 1626:2 1627:1', `camera blocks ${camLog}`);
ok(rt.state.battlemode === 1 && rt.state.usercontrol === 1 && rt.state.battlecontrol === 1, 'main() ends with battle mode 1, controls on');
ok(warns.some(w => w.includes('KerberosActor.setpos_l')), 'untranslated natives are warned (actors, ...)');

// ---- against the game (traces) ----
// T w210_intro_a / b / c (TRACE_FIELDSET=event, from the state at the stage start, f1704 of the w210 restart drive).
// Camera ids differ: KerberosCamera's id counter (a static, camera_id_idx % 6) runs on from earlier events in the game,
// from 0 on the page; blocks are matched by their first eye. Times are compared on the event clock (the game's is real
// ms: 20 a frame, 40 when a frame drops; the page's 20 a game frame).
const traces = existsSync(OUT) ? readdirSync(OUT).filter(f => /^w210_intro_.*\.jsonl$/.test(f)).sort() : [];
if (!traces.length) { console.log('SKIP trace parts: no tools/trace/out/w210_intro_*.jsonl'); done(); }
const recs = new Map();
for (const f of traces) for (const l of readFileSync(path.join(OUT, f), 'utf8').split('\n')) if (l.trim()) { const r = JSON.parse(l); if (r.frame !== undefined && r.ev_cam5) recs.set(r.frame, r); }
const hexF = (h, i) => Buffer.from(h, 'hex').readFloatLE(i * 4);
const hexU = (h, i) => Buffer.from(h, 'hex').readUInt32LE(i * 4);
const game = [...recs.keys()].sort((a, b) => a - b).map(k => {
  const r = recs.get(k), cams = [0, 1, 2, 3, 4, 5].map(i => r['ev_cam' + i]);
  const act = cams.findIndex(h => (hexU(h, 13) & 0xff) !== 0);
  return { frame: k, clock: (hexU(r.ev_clock, 0) - hexU(r.ev_clock, 4)) >>> 0, cam: act,
           eye: act < 0 ? null : [0, 1, 2].map(i => hexF(cams[act], i)), aim: act < 0 ? null : [4, 5, 6].map(i => hexF(cams[act], i)),
           up: act < 0 ? null : [8, 9, 10].map(i => hexF(cams[act], i)),
           fov: act < 0 ? null : hexF(cams[act], 12) };
});
const steps = game.slice(1).map((g, i) => (g.frame === game[i].frame + 1 ? g.clock - game[i].clock : null)).filter(x => x != null);
const hist = {}; for (const s of steps) hist[s] = (hist[s] || 0) + 1;
const mode = +Object.entries(hist).sort((a, b) => b[1] - a[1])[0][0];
ok(mode === 20, `the game's event clock: ${mode} ms in most frames (${hist[20]} of ${steps.length}; 40 in ${hist[40] || 0}: dropped frames) = the page's step`);
// blocks: a change of the active camera, or of its eye by more than 20 u in one frame (a new setdata / load)
const gblocks = [];
for (let i = 1; i < game.length; i++) {
  const g = game[i], p = game[i - 1];
  if (g.cam >= 0 && (g.cam !== p.cam || !p.eye || Math.hypot(...g.eye.map((x, k) => x - p.eye[k])) > 20)) gblocks.push(i);
}
const pblocks = [];
for (let i = 0; i < page.length; i++) {
  const g = page[i], p = page[i - 1];
  if (g.cam >= 0 && (!p || g.cam !== p.cam || Math.hypot(...g.eye.map((x, k) => x - p.eye[k])) > 20)) pblocks.push(i);
}
console.log(`  game blocks (trace record:camera) ${gblocks.map(i => game[i].frame + ':' + game[i].cam).join(' ')}; page blocks (frame:camera) ${pblocks.map(i => (i + 1) + ':' + page[i].cam).join(' ')}`);
let worst = 0, worstFov = 0, compared = 0, matched = 0, phased = 0;
const offs = [];
for (const gi of gblocks) {
  let best = null;
  for (const pi of pblocks) { const d = Math.hypot(...page[pi].eye.map((x, k) => x - game[gi].eye[k])); if (!best || d < best.d) best = { pi, d }; }
  if (!best || best.d > 5) { console.log(`  game block at record ${game[gi].frame}: no page block within 5 u (nearest ${best && best.d.toFixed(1)})`); continue; }
  matched++;
  // No fitting. The hook logs at the pad read (FUN_002548d8 in FUN_00248110), before the event update: record r holds
  // the clock of frame r's VM window and the camera frame r - 1 left. The block's move_l ran in frame (first record
  // - 1)'s window, so its start = that record's clock, and record r's camera = the move at record r's clock.
  // One allowance: where a slow frame shifts the pad read against the event update by a frame (T: record 800 in the
  // second block), the camera matches the next record's clock instead; such records are counted (phase+1).
  const p0 = page[best.pi], start = game[gi - 1].clock;
  let e = 0, a = 0, u = 0, fv = 0, n = 0, ph = 0;
  for (let k = 0; gi + k < game.length; k++) {
    const g = game[gi + k];
    if (g.cam !== game[gi].cam || (k && Math.hypot(...g.eye.map((x, j) => x - game[gi + k - 1].eye[j])) > 20)) break;
    const at = clk => {
      let pe = p0.eye, pa = p0.aim, pu = p0.up, pf = p0.fov;               // a still camera (set_l)
      if (p0.spl && p0.mv) {
        const t = f32(p0.mv.from + f32(p0.mv.rate * ((clk - start) >>> 0)));
        const tc = Math.min(p0.tmax, Math.max(p0.tmin, t));
        pe = [0, 1, 2].map(j => evalSpline(tc, p0.spl[j])); pa = [0, 1, 2].map(j => evalSpline(tc, p0.spl[3 + j]));
        pu = [0, 1, 2].map(j => evalSpline(tc, p0.spl[6 + j])); pf = p0.spl[9] ? evalSpline(tc, p0.spl[9]) : p0.fov;
      }
      const r = [Math.hypot(...pe.map((x, j) => x - g.eye[j])), Math.hypot(...pa.map((x, j) => x - g.aim[j])),
                 Math.hypot(...pu.map((x, j) => x - g.up[j])), Math.abs(pf - g.fov)];
      return { r, m: Math.max(r[0], r[1], r[2]) };
    };
    let res = at(g.clock);
    const nx = game[gi + k + 1];
    if (nx && nx.frame === g.frame + 1) { const r2 = at(nx.clock); if (r2.m < res.m) { res = r2; ph++; } }
    e = Math.max(e, res.r[0]); a = Math.max(a, res.r[1]); u = Math.max(u, res.r[2]); fv = Math.max(fv, res.r[3]); n++;
  }
  offs.push(game[gi].frame - best.pi);
  worst = Math.max(worst, e, a, u); worstFov = Math.max(worstFov, fv); compared += n;
  console.log(`  block: game record ${game[gi].frame} (cam ${game[gi].cam}) ~ page frame ${best.pi + 1} (cam ${p0.cam}${p0.mv ? '' : ', still'}); ${n} frames: eye ${e.toFixed(4)} u, aim ${a.toFixed(4)} u, up point ${u.toFixed(4)} u, fov ${fv.toFixed(4)}; phase+1 ${ph}`);
  phased += ph;
}
ok(gblocks.length === 9 && matched === gblocks.length, `${matched} of ${gblocks.length} game camera blocks match a page block (9 in scr001)`);
// 0.002 u: about 2 ms of the fastest block's motion (0.0012 u / ms), the clock's ms jitter between the hook's read and
// the event update
ok(compared > 1500 && worst < 0.002 && worstFov < 0.001 && phased < 0.05 * compared,
  `event cameras vs the game: ${compared} frames, max eye / aim / up-point error ${worst.toFixed(4)} u, fov ${worstFov.toFixed(4)} (${phased} records at the next record's clock)`);
console.log(`  block start offsets (game record - page frame): ${offs.join(' ')} (the page's loads take no time)`);
done();
