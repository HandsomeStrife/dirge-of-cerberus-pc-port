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

// ---- the opening's sound and Skip (event_sound.js, event_rt.js requestSkip; worker 0222) ----
// Back ends mocked: what the natives ask of music.js / the area sound / audio.js / the voice player, frame by frame.
{
  const { VOICE_GAIN, rowStreamed } = await imp('event_sound.js');
  ok(VOICE_GAIN === 2896 / 4096, `voice gain (short)(cos(pi/4) x 4096) / 4096 = ${VOICE_GAIN * 4096}/4096 (FUN_003eacb8, FUN_003eb330 >> 12)`);
  ok(rowStreamed(0x94) && !rowStreamed(0x04) && !rowStreamed(0x80) && !rowStreamed(null), 'FUN_003eb930: row flags & 0x84 == 0x84');
  const bgmFlags = { bgm_001: 0x94, bgm_274: 0x04 };
  const SE = { asj_059: 50013, asj_060: 50014, asj_061: 50015, asj_062: 50016, asj_063: 50017 };
  const run = (skipAt) => {
    const calls = [], vb = new Set(); let f = 0;
    const c = (m) => calls.push(f + ' ' + m);
    const sound = {
      music: () => ({ open: (n, v) => c('open ' + n + ' ' + v), playMusic3: (n, v, x) => c('pm3 ' + n + ' ' + v + ' ' + x), stopMusic: () => c('stop'), changeMusicVol: () => c('vol') }),
      area: () => ({ play: (n, v) => c('area ' + n + ' ' + v) }),
      audio: () => ({ ctx: {}, se: { names: Object.fromEntries(Object.entries(SE).map(([k, id]) => [k, { id, flags: 32 }])) }, playId: (id, v, p) => c('se ' + id + ' ' + v + ' ' + p) }),
      voices: () => ({ load: (n) => { vb.add(n); c('vload ' + n); }, play: (n) => c('vplay ' + n + (vb.has(n) ? '' : ' none')), stopAll: () => { vb.clear(); c('vstop'); } }),
      bgmRow: (n) => bgmFlags[n] ?? null,
    };
    const r = new EventRuntime(D, { warn: () => {}, sound });
    r.start();
    while (!r.done && r.frameNo < 5000) { if (skipAt && r.frameNo === skipAt) r.requestSkip(); f = r.frameNo + 1; r.frame(20); }
    return { calls, r };
  };
  const A = run(0);
  const want = ['1 vload 10109vn', '1 vload 10109v2', '1 vload 10110sk', '1 area asj_036 127', '2 se 50013 127 64', '126 vplay 10109vn',
    '226 vplay 10109v2', '377 se 50014 127 64', '946 open bgm_274 0', '947 se 50015 127 64', '966 vplay 10110sk', '1427 se 50016 127 64',
    '1627 se 50017 127 64', '1627 pm3 bgm_001 0 4000'];
  ok(A.calls.join('|') === want.join('|'), `scr001's sound calls, unskipped (SEs a frame after the call): ${A.calls.length} calls` + (A.calls.join('|') === want.join('|') ? '' : '\n   got ' + A.calls.join('|')));
  ok(A.r.frameNo === 1661 && A.r.skip === 0, 'unskipped: same length (1661 frames), +0x156c stays 0');
  const B = run(300);
  const bl = B.r.log.map(x => x[0] + ':' + x[1]);
  ok(B.r.done && B.r.frameNo < 330, `skipped at frame 300: the event ends at frame ${B.r.frameNo} (sleeps / timers end, moves jump)`);
  ok(B.calls.includes('300 vstop') || B.calls.some(x => / vstop$/.test(x)), 'Skip stops and frees the voice channels (FUN_003ea5f0)');
  ok(B.calls.some(x => /vplay 10110sk none$/.test(x)), 'a playVoice after Skip finds no channel (FUN_003ea2c0 freed it)');
  ok(!B.calls.some(x => / se 5001[4-7] /.test(x)), 'no SE after Skip (FUN_0039ff68: +0x156c != 0)');
  ok(!B.calls.some(x => /bgm_274/.test(x)), 'playMusic2(bgm_274) under Skip: FUN_003eb930 false (flags 0x04) -> no music');
  ok(B.calls.slice(-2).join('|').replace(/^\d+ /, '').replace(/\|\d+ /, '|') === 'stop|open bgm_001 0', 'playMusic3(bgm_001) under Skip: stopMusic, then FUN_003ec500 (flags 0x94)');
  ok(bl.filter(x => /fade/.test(x) && !/300|^1:/.test(x)).every(x => / \(skip\)$/.test(x)), 'fades after Skip do nothing (FUN_003736c8)');
  ok(B.r.skip === 2 && bl.includes('300:skip'), '+0x156c 1 -> 2 at the frame tail');
  const cams = B.r.log.filter(x => x[1].startsWith('camera')).length;
  ok(cams === 9, `skipped: all 9 camera blocks still set up (${cams}), each move at its end`);
  ok(B.r.state.battlemode === 1 && B.r.state.usercontrol === 1, 'skipped: main still ends with battle mode 1, controls on (the hand-off runs)');
  // T w222_snd (TRACE_CALLLOG=evsound from 0210's start1704 state, no input): the game's sound calls = the page's, in
  // order, each at the page's call frame + its camera block's start offset (the page's loads take no time)
  {
    const cp = path.join(OUT, 'w222_snd.calls.jsonl');
    if (!existsSync(cp)) console.log('SKIP w222_snd: no tools/trace/out/w222_snd.calls.jsonl');
    else {
      const nm = (u) => Buffer.concat(u.map(h => { const b = Buffer.alloc(4); b.writeUInt32LE(parseInt(h, 16)); return b; })).toString('latin1').split('\0')[0];
      const G = readFileSync(cp, 'utf8').split('\n').filter(l => l && !l.includes('ev_window')).map(l => JSON.parse(l.replace(/\bNaN\b/g, 'null'))).filter(r => r.hook && r.frame >= 300)
        .filter(r => ['area', 'ev_se', 'ev_voice', 'music2', 'music3_fade', 'music3'].includes(r.hook))
        .map(r => ({ f: r.frame, k: { area: 'area', ev_se: 'se', ev_voice: 'voice', music2: 'music2', music3_fade: 'music', music3: 'music' }[r.hook],
                     n: nm((r['a0+0x0'] || r['a1+0x0']).u), v: r.hook === 'area' ? r.a1 : r.hook === 'music3_fade' ? r.a1 : null }));
      const P = A.r.log.filter(x => /^(area|se|voice|music2|music) /.test(x[1])).map(x => ({ f: x[0], k: x[1].split(' ')[0], n: x[1].split(' ')[1] }));
      const starts = [1, 376, 476, 601, 946, 1051, 1426, 1626, 1627], offs = [353, 373, 376, 385, 419, 428, 524, 539, 559];
      const off = (f) => { let i = 0; while (i + 1 < starts.length && starts[i + 1] <= f) i++; return offs[i]; };
      const same = G.length === P.length && G.every((g, i) => g.k === P[i].k && g.n === P[i].n);
      const d = same ? G.map((g, i) => g.f - (P[i].f + off(P[i].f))) : [];
      ok(same, `w222_snd: ${G.length} game sound calls = the page's ${P.length}, same kinds / names / order`);
      // the area call comes before the event's disc loads (voices / effects, game frames 276-328), which the first
      // block's offset includes: it is 26 frames earlier; the others within 5 frames (the game's clock: dropped frames)
      ok(same && d[0] === -26 && d.slice(1).every(x => Math.abs(x) <= 5), `  each at the page frame + its block's offset (${d.join(' ')})`);
      ok(G.filter(g => g.k === 'area').every(g => g.v === 127) && G.filter(g => g.k === 'music').every(g => g.v === 4000), '  area volume 127, bgm_001 crossfade 4000 ms');
    }
  }
  // T w222_skip (as w222_snd, Start f700 = the event pause, ✕ f740 = Skip): the event's clock is held from f701 (+0x9854
  // marks it, +0x9858 grows 20 ms a frame), +0x156c 1 at f741 and 2 at f742; after it no SE, no playMusic2 (bgm_274's
  // row lacks 0x84), no fade; bgm_001 through FUN_003ec500 (the skip branch), not the crossfade; the page's skipped run
  // makes the same calls in the same order
  {
    const cp = path.join(OUT, 'w222_skip.calls.jsonl'), tp = path.join(OUT, 'w222_skip.jsonl');
    if (!existsSync(cp) || !existsSync(tp)) console.log('SKIP w222_skip: no tools/trace/out/w222_skip.*');
    else {
      const nm = (u) => Buffer.concat(u.map(h => { const b = Buffer.alloc(4); b.writeUInt32LE(parseInt(h, 16)); return b; })).toString('latin1').split('\0')[0];
      const C = readFileSync(cp, 'utf8').split('\n').filter(l => l && !l.includes('ev_window')).map(l => JSON.parse(l.replace(/\bNaN\b/g, 'null'))).filter(r => r.hook);
      const sk = C.find(r => r.hook === 'skip');
      const after = C.filter(r => sk && r.frame > sk.frame).map(r => r.hook + ' ' + nm(((r['a0+0x0'] || r['a1+0x0']) || { u: [] }).u));
      ok(sk && sk.frame === 741 && after.join('|') === 'ev_voice 10110sk|music3 bgm_001', `game after Skip (f${sk && sk.frame}): ${after.join(', ')}`);
      const pg = B.r.log.filter(x => x[0] > 300 && /^(voice|se|music2|music|fadein|fadeout) /.test(x[1]) && !/\(skip\)$/.test(x[1])).map(x => x[1]);
      ok(pg.join('|') === 'voice 10110sk', `page after Skip: the same voice call (no channel) and no unskipped SE / fade / music2: ${pg.join(', ')}`);
      const R = new Map(readFileSync(tp, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(r => r.ev_clock).map(r => [r.frame, r]));
      const w = (f, i) => Buffer.from(R.get(f).ev_clock, 'hex').readUInt32LE(i * 4);
      const held = w(700, 4) === 0 && [702, 720, 740].every(f => w(f, 4) === (f - 701) * 20) && w(742, 4) === 800 && w(744, 4) === 800;
      ok(held, `event pause: +0x9858 (paused time) grows 20 ms a frame from f701 to ${w(742, 4)} ms at the Skip, then stays (the event is held, as intro.js pause)`);
      ok(R.get(740).ev_skip === 0 && R.get(741).ev_skip === 1 && R.get(742).ev_skip === 2, '+0x156c 0 / 1 / 2 at f740 / 741 / 742');
    }
  }
  // hand cases on the natives (paths scr001 does not reach after a Skip)
  {
    const calls = [];
    const sound = { music: () => ({ open: (n) => calls.push('open ' + n), stopMusic: () => calls.push('stop'), playMusic3: () => calls.push('pm3') }),
      voices: () => ({ load: (n) => calls.push('vload ' + n) }), bgmRow: (n) => bgmFlags[n] ?? null };
    const r = new EventRuntime(D, { warn: () => {}, sound });
    const N = r.vm.natives;
    r.skip = 2;
    N['fake/KerberosSound.playMusic3(Ljava/lang/String;II)V'](r.vm, ['bgm_274', 0, 4000]);
    ok(calls.join('|') === 'stop', 'playMusic3 under Skip of a row without 0x84: stop only (FUN_003a0198)');
    calls.length = 0;
    const h = N['fake/KerberosSound.loadVoice2(Ljava/lang/String;)I'](r.vm, ['10109vn']);
    ok(h === 0x7fffffff && calls.length === 0, 'loadVoice2 under Skip: 0x7fffffff, nothing loaded (FUN_00378c88)');
    r.skip = 0;
    const h2 = N['fake/KerberosSound.loadVoice2(Ljava/lang/String;)I'](r.vm, ['10109vn']);
    ok(h2 > 0 && h2 < 0x7fffffff && !r.busy(h2) && calls.join('|') === 'vload 10109vn', 'loadVoice2: a command handle, done at once (resident load)');
  }
}

// ---- the event windows (event_window.js; worker 0239): open_l / close_l, box kind 4, the text's '$h', Skip ----
{
  const W = await imp('event_window.js');
  const SI = await imp('stage_info.js');
  const { loadPauseData } = await imp('pause.js');
  const pj = path.join(here, 'data/pause.json'), sj = path.join(here, 'data/stage_info.json');
  const PD = existsSync(pj) && existsSync(sj) ? SI.loadStageInfoData(JSON.parse(readFileSync(sj, 'utf8')), loadPauseData(JSON.parse(readFileSync(pj, 'utf8')))) : null;
  // the pulse FUN_003d0ad0 (hand values)
  ok(W.pulse(1000, 0x200, 0x20, 0x80, 1000) === 0x20 && W.pulse(1000, 0x200, 0x20, 0x80, 1512) === 0x80 && W.pulse(1000, 0x200, 0x20, 0x80, 1256) === 0x50 &&
     W.pulse(1000, 0x200, 0x20, 0x80, 2024) === 0x20 && W.pulse(0, 0x200, 0x20, 0x80, 5) === 0x80 && W.pulse(1000, 0x200, 0x80, 0x20, 1256) === 0x50,
     'FUN_003d0ad0: a 2 x 512 ms triangle from a to b; start 0 -> b');
  // book-keeping without screens (no D)
  {
    const win = W.createEventWindows({ D: null, warn });
    const r = new EventRuntime(D, { warn, windows: win }); r.start();
    const N = win.natives(r), open = N['fake/KerberosWindow.open_l(IIIIIILjava/lang/String;I)V'], close = N['fake/KerberosWindow.close_l(I)V'];
    for (let i = 1; i <= 6; i++) open(r.vm, [i, 4, 0, 380, 512, 448, 'MES_10110SK', 0]);
    close(r.vm, [6]);                                                // FUN_003789b8: the pending command 6 freed
    ok(r.slots.filter(c => c.type === 10).length === 5, 'close_l before the frame frees the pending command 10 (FUN_003789b8)');
    win.frame(r);
    ok(win.entries.map(e => e.id).join() === '1,2,3,4,5' && r.slots.every(c => c.type !== 10), 'case 10: five window entries (+0x9804), slots freed');
    open(r.vm, [7, 4, 0, 380, 512, 448, 'MES_10110SK', 0]); win.frame(r);
    ok(win.screens.length === 5 && !win.entries.some(e => e.id === 7) && win.log.some(x => x[1] === 'open 7 MES_10110SK'), 'no free entry: the box closes at once (FUN_003b6978; no screen without data: gone at once)');
    close(r.vm, [3]);
    ok(win.entries[2].id === -1, 'close_l: the entry id -> -1 (FUN_00378b00)');
    win.frame(r);
    ok(win.entries[2].id === 0 && !win.screens.some(x => x.id === 3), 'the window loop closes it (FUN_003788d8)');
  }
  if (!PD || !PD.layouts.window4 || !PD.speakers || !PD.layouts.eventpause) console.log('SKIP windows draw: data/pause.json without the window layouts / speakers (re-run export_web_pause.py) or no data/stage_info.json');
  else if (!D.messages) console.log('SKIP windows draw: data/event/ev0100_scr001.json without messages (re-run export_web_event.py)');
  else {
    const runWin = (opts = {}) => {
      const win = W.createEventWindows({ D: PD, warn });
      const r = new EventRuntime(D, { warn, windows: win }); r.start();
      const at = {};
      while (!r.done && r.frameNo < 2000) {
        r.frame(20);
        if (opts.skipAt === r.frameNo) r.requestSkip();
        if (opts.frames && opts.frames.includes(r.frameNo)) at[r.frameNo] = { prims: win.draw(), keys: win.screens.map(x => x.key) };
      }
      return { win, r, at };
    };
    const { win, at } = runWin({ frames: [180, 240, 980] });
    ok(win.log.map(x => x.join(' ')).join('|') === '126 open 1 MES_10109VN1|191 close 1|226 open 2 MES_10109VN2|286 close 2|966 open 3 MES_10110SK|1036 close 3',
      'scr001 opens three kind-4 windows and closes each (open_l / close_l)');
    ok(at[180].keys.join() === 'MES_10109VN1' && at[180].prims.length === 0, 'MES_10109VN1 (a space) draws nothing');
    ok(at[240].prims.length === 264 && at[980].prims.length === 108, `glyph sprites: VN2 ${at[240].prims.length} (22 x 12 with the name), SK ${at[980].prims.length}`);
    // the speaker's name: on (DAT_004f3044 bit 10, MEASURED 0xc00) it is drawn and centred with the line
    {
      const b = new W.EventWindowScreen(PD, 0, -1);
      b.moveTo(b.root, 0, 380); b.setSize(512, 448);
      const s = Uint8Array.from(Buffer.from(D.messages.MES_10109VN2, 'hex'));
      b.setText(s);
      const nameLen = PD.msg[PD.speakers.find(x => x[0] === 'vn')[1]].length;
      ok(s[0] === 0x24 && s[1] === 0x68 && b.text.count === s.length - 4 + nameLen, `measure: '$h' + 'vn' inserts the name (count ${b.text.count})`);
      ok(b.text.flags5e === ((0x212 & 0xfffd) | 0x4000) && b.root.flags & 0x80 && b.text.w === 512 && b.text.h === 448,
        `FUN_003b8598 / FUN_003b6c98: text flags 0x${b.text.flags5e.toString(16)}, root no clip, text widget ${b.text.w} x ${b.text.h}`);
      const m2 = W.measureCodes(PD, b.text, Uint8Array.from([0x24, 0x68, 0x7a, 0x7a, 0x41, 0]));   // an unknown speaker: 'zz' is text
      const t = new W.EventWindowScreen(PD, 1000, 300), t0 = new W.EventWindowScreen(PD, 1000, -1);
      ok(t.cur === 0 && t.total === 300 && t.end === 1300 && t0.total === 100 && t0.end === 1100 && t.se === null,
        'open_l t != 0: FUN_003d50b8 makes the open last t ms (else FUN_003d5110\'s 100); no open sound (FUN_003e1d80)');
      ok(m2.count === 3, `'$h' with no table row: the two letters are text (count ${m2.count})`);
    }
    // under Skip: the open window is hidden (FUN_003b7118), later ones open hidden (FUN_00383408)
    {
      const s = runWin({ skipAt: 240, frames: [241] });
      ok(s.at[241] && s.at[241].prims.length === 0 && s.win.screens.every(x => x.box.root.flags & 1), 'Skip hides the open window (FUN_003b7118 -> FUN_003cb360)');
    }
    // the game's draws (GS dumps w239: tools/trace/window_ref.py)
    const refp = path.join(OUT, 'w239/window_ref.json');
    if (!existsSync(refp)) console.log('SKIP windows vs the game: no tools/trace/out/w239/window_ref.json (tools/trace/window_ref.py)');
    else {
      const ref = JSON.parse(readFileSync(refp, 'utf8'));
      const row = q => [q.v[0].x, q.v[0].y, q.v[1].x, q.v[1].y, q.v[0].u, q.v[0].v, q.v[1].u, q.v[1].v, q.v[0].c.join()].join();
      const same = (P, R) => P.length === R.length && P.every((q, i) => row(q) === R[i].slice(0, 8).concat([R[i][8].join()]).join()
        && (q.tex === 'font' ? q.clut === (R[i][9] === 0x3ffa ? 1 : 2) : true) && q.linear === ((R[i][10] & 0x60) !== 0));
      ok(same(at[240].prims, ref.vn2), `MES_10109VN2: all ${ref.vn2.length} glyph sprites = GS dump f596 (xy, uv, rgba, CLUT, bilinear)`);
      ok(same(at[980].prims, ref.sk), `MES_10110SK: all ${ref.sk.length} glyph sprites = GS dump f1400`);
      // the event pause's screen at the dump's pulse phase (alpha 37 = (now - start) % 1024 = 27)
      const P = new W.EventPauseScreen(PD, 1000);
      P.update(1200); P.frame(1200);
      const now = P.t60 + 27; P.update(now); P.frame(now);
      const d = P.draw(now);
      const dim = d[0], R = ref.pause;
      ok(d.length === 3 && dim.dim && dim.v[0].x === R[0][0] && dim.v[3].x === R[0][2] && dim.v[3].y === R[0][3] && dim.v[0].c[3] === R[0][8][3] &&
         same(d.slice(1), R.slice(1)), 'the event pause screen = GS dump f1453 (dim 0x60, image 0x10c, the ✕ icon 0x36; xy, uv, alpha)');
    }
  }
}

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
