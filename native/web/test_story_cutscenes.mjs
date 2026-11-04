// test_story_cutscenes.mjs -- main's story events that play out (worker 0261; notes/story-cutscenes.md).
//   node --import ./native/web/test_hooks.mjs native/web/test_story_cutscenes.mjs
// Needs data/event/ev0100_stage.json. MUTATE=getpos|battlecam|nextevent|frames1|plays|roll|rollsign|rollraw|voicepause|hide|visall|group runs one mutant of the modules in a scratch copy.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MUT = process.env.MUTATE;
let fails = 0, oks = 0;
const ok = (c, m) => { if (c) oks++; else { fails++; console.log('FAIL ' + m); } };
if (!fs.existsSync(path.join(HERE, 'data/event/ev0100_stage.json'))) { console.log('SKIP: no data/event/ev0100_stage.json'); process.exit(0); }
const data = JSON.parse(fs.readFileSync(path.join(HERE, 'data/event/ev0100_stage.json')));

// the mutants edit a scratch copy of the event modules
let base = HERE;
if (MUT) {
  const SUB = {
    nextevent: ['stage_controller.js', ' && !PLAYS.has(this.nextEvent())', ''],
    // worker 0262
    lentmodel: ['stage_controller.js', 'R.actors.create(obj.model || name, id)', 'R.actors.create(name, id)'],
    lentshow: ['stage_controller.js', 'a.lent.show(!!v && !a.mp.clip)', 'a.lent.show(!!v)'],
    plays0262: ['stage_controller.js', "'ev0103.heri_lasted', ", ''],
    playsht: ['stage_controller.js', "'ev0103.heri_toujou', ", ''],
    getpos: ['stage_controller.js', "return a ? a.M[12] : 0; }", "return 0; }"],
    battlecam: ['stage_controller.js', "i === 1 ? f32(v.eye[j] + v.fwd[j])", "i === 1 ? 0"],
    frames1: ['stage_controller.js', "if (E && /^ev\\d/.test(E.cls)", "if (false && /^ev\\d/.test(E.cls)"],
    rollraw: ['event_rt.js', 'r1 = crs(fw, raw); v = r1;', 'r1 = crs(fw, r0); v = r1;'],
    voicepause: ['event_sound.js', 'if (on) this.hold(rec); else this.start(rec, rec.off);', ''],
    plays: ['stage_controller.js', "'ev0103.heri_taijou', ", ''],
    roll: ['event_rt.js', 'if (roll) { ch[6] = ch[7] = ch[8] = null; rollUpSplines(ch, roll.keys, R.eps); }', ''],
    rollsign: ['event_rt.js', 'let deg = f32(-(rs.n', 'let deg = f32((rs.n'],
    hide: ['event_actor_rt.js', '(b ? (a.partMask & ~bit) : (a.partMask | bit))', '(b ? (a.partMask | bit) : (a.partMask & ~bit))'],
    visall: ['stage_controller.js', 'if (o().allVisible) o().allVisible(!!v);', 'if (false) {}'],
    group: ['stage_controller.js', 'o().cellMask(Math.max((n | 0) - 1, 0), !b)', 'o().cellMask(Math.max((n | 0) - 1, 0), !!b)'],
    chain: ['stage_controller.js', "else if (c.type === 0x22) fin = this.actors.chain(c, this);", "else if (c.type === 0x22) fin = true;"],
    chainprev: ['event_actor_rt.js', 'if (c.prev > 0 && R.busy(c.prev)) return false;', ''],
    chainloop: ['event_actor_rt.js', 'a.code = c.name; a.loop = c.loop;', 'a.code = c.name; a.loop = false;'],
    walk: ['stage_controller.js', "else if (c.type === 0xc) fin = this.actors.walk(c, this);", "else if (c.type === 0xc) fin = true;"],
    walklen: ['event_actor_rt.js', 'L: f32(L * f32(0.1))', 'L: f32(L)'],
    walkend: ['event_actor_rt.js', 'if (c.end) { a.blend = c.blend; a.code = c.end;', 'if (false) { a.blend = c.blend; a.code = c.end;'],
    qt: ['event_actor_rt.js', 'd(xy + zw), d(zx - yw), 0,', 'd(xy - zw), d(zx - yw), 0,'],
    choiceskip: ['event_window.js', '[1, 0x18, 0x1b, 0x3b].includes(k) ? 2', '[1, 0x18, 0x3b].includes(k) ? 2'],
    choicestate: ['event_window.js', 'e.state === 3 ? 2 : e.state === 4 ? 3 : 0', 'e.state === 3 ? 3 : e.state === 4 ? 2 : 0'],
    choicewrap: ['event_window.js', 'was + 1 >= n ? 0 : was + 1', 'was + 1 >= n ? was : was + 1'],
    choicesel: ['event_window.js', 'this.cursor = sel < 0 ? 0 : Math.min(sel, this.rows.length - 1);', 'this.cursor = 0;'],
    choicegrow: ['event_window.js', 'l.ry = s16(l.ry + d); l.y = s16(l.y + d); this.resize(l, l.w, s16(l.h - d));', ''],
    playsfe: ['stage_controller.js', "'ev0141.first_encounter', ", ''],
    playsrv: ['stage_controller.js', "'ev0141.rv_toujou', ", ''],
    playswro: ['stage_controller.js', "'ev0141.wro_kaisetu'", "'ev0141.none'"],
  }[MUT];
  if (!SUB) throw new Error('unknown mutant ' + MUT);
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'mut-story-'));
  for (const f of fs.readdirSync(HERE)) if (f.endsWith('.js')) fs.copyFileSync(path.join(HERE, f), path.join(base, f));
  const p = path.join(base, SUB[0]), s = fs.readFileSync(p, 'utf8');
  if (!s.includes(SUB[1])) throw new Error('mutant does not apply: ' + SUB[1]);
  fs.writeFileSync(p, s.replace(SUB[1], SUB[2]));
}
const { createStageController, PLAYS } = await import(pathToFileURL(path.join(base, 'stage_controller.js')));
const { AreaStream } = await import(pathToFileURL(path.join(base, 'area_stream.js')));
const { EventActors, quatRows } = await import(pathToFileURL(path.join(base, 'event_actor_rt.js')));
const { createEventWindows } = await import(pathToFileURL(path.join(base, 'event_window.js')));
const { loadPauseData } = await import(pathToFileURL(path.join(base, 'pause.js')));
const { loadStageInfoData } = await import(pathToFileURL(path.join(base, 'stage_info.js')));

function make(v, globalFlags, extra = {}) {
  const stream = new AreaStream([], [6, 7]), warns = [];
  const c = createStageController({ data, warn: m => warns.push(m), flags: () => v, stream: () => stream, autoSkip: 'unplayed', globalFlags,
    actors: new EventActors({ warn: () => {} }), onSceneSave: () => {},
    battleObject: n => ({ tag: n, matrix: () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], lend() {}, show() {}, release() {}, place() {} }), ...extra });
  const run = (n, stop) => { for (let f = 0; f < n && !c.done; f++) { stream.progress(); c.tick(20); if (stop && stop()) return true; } return false; };
  return { c, R: c.rt, stream, warns, run };
}
const G = (o) => { const g = new Uint8Array(64); for (const k in o) g[k] = o[k]; return g; };

// 1. A player beats Dragonfly (script 29: stage flag 0 = 16): heri_taijou and sk_mituketa2 play out, no Skip, main's branch takes
// sk_mituketa2, the chunks go (1, 0) then back to (6, 7), then the fight goes on (battle, global 1 = 20).
{
  const seen = new Set(), vis = [], cells = [], cams = new Set();
  const S = make({ 0: 16, 1: 8, 2: 1 }, G({ 0: 1, 1: 13 }), { allVisible: v => vis.push(v), cellMask: (b, on) => cells.push([b, on]) });
  const log = () => S.R.log.map(x => x[1]);
  const done = S.run(5000, () => { for (const F of S.R.vm.frames) seen.add(F.cls + '.' + F.m.name); if (S.R.view) cams.add(S.R.view.eye.join()); return S.R.gflags[1] === 20 && S.R.battle; });
  ok(done, 'main comes back to battle with global 1 = 20 after the two events');
  ok(seen.has('ev0103.heri_taijou') && seen.has('ev0101.sk_mituketa2'), 'both events ran: ' + [...seen].join());
  ok(!log().some(m => /^skip /.test(m)), 'no Skip in the stretch: ' + log().filter(m => /^skip /.test(m)).join());
  ok(log().includes('isSkip 0 ev0100.main pc 6355'), 'main\'s isSkip after heri_taijou reads 0');
  ok(log().indexOf('zone 128,1,0') >= 0 && log().indexOf('zone 128,6,7') >= 0 && log().lastIndexOf('zone 128,6,7') > log().indexOf('zone 128,1,0'), 'chunks (1, 0) for sk_mituketa2, back to (6, 7)');
  ok(log().indexOf('scene_save 3') >= 0 && log().indexOf('scene_save 3') < log().indexOf('zone 128,1,0'), 'scene_save(3) before sk_mituketa2');
  ok(vis.join() === 'false,true', 'setVisibleAll(0, 0) at the start of the stretch, (0, 1) at its end: ' + vis.join());
  ok(cells.some(([b, on]) => b === 99 && on === true), 'setVisibleModelGroup(100, 0) hides cell 99 (DAT_004e8700 bit 99): ' + JSON.stringify(cells));
  ok(cams.size > 300, 'the event cameras moved: ' + cams.size);
  // T w261_heri_a: heri_taijou's 8 shots; here the page's cameras have no NaN (type 10 channels)
  ok(![...cams].some(s => s.includes('NaN')), 'no NaN in the event view');
}
// 2. The rescue (stage 1 = 5): roji02_01 plays out and main's Camera.set stands at battle() (T w229_rescue_pos); .
{
  const v = { 0: 2, 1: 5, 63: 6 };
  const S = make(v, G({ 0: 1, 1: 5 }));
  const seen = new Set();
  S.run(6000, () => { for (const F of S.R.vm.frames) seen.add(F.cls + '.' + F.m.name); return v[12] === 1 && S.R.battle; });
  const skips = S.R.log.map(x => x[1]).filter(m => /^skip /.test(m));
  ok(v[12] === 1 && seen.has('ev0143.roji02_01') && !skips.length, 'roji02_01 played, no Skip: ' + skips.join());
}
// 3. Camera file 33: a one-key roll channel; T w261_heri_a f430 (camera 2): eye (-1450.38, -160.46, 1312.79), up point (-1451.26, -160.91, 1312.63).
// File 10's up point comes from the roll channel (file types 6-8 are ignored).
{
  const S = make({}, G({ 0: 1, 1: 13 })), R = S.R, id = 3;
  R.vm.natives['fake/KerberosCamera.load_l(II)I'](R.vm, [id, 33]);
  const c = R.cams[id];
  ok(c.spl && c.spl[6], 'file 33 has an up spline');
  R.camEval(c, 0);
  const d = Math.hypot(c.up[0] + 1451.26, c.up[1] + 160.91, c.up[2] - 1312.63);
  ok(d < 0.01, `file 33's up point against T: off by ${d}`);
}
// 3b. The decoded formula with a non-zero roll (FUN_00373908 group 4; only heri_lasted's files 139-143 have one, not traced yet): looking
// along +z, row 0 = (1, 0, 0), row 1 = (0, 1, 0); roll +90 -> z rotation by -90 -> up point = eye - row 0
{
  const { rollUpSplines, buildSpline } = await import(pathToFileURL(path.join(base, 'event_rt.js')));
  const k = (v) => buildSpline([0, 10], [v, v], 0.5), ch = [k(0), k(0), k(0), k(0), k(0), k(5), null, null, null, null];
  rollUpSplines(ch, [[0, 90], [10, 90]], 0.5);
  const u = [ch[6].v[0], ch[7].v[0], ch[8].v[0]];
  ok(Math.abs(u[0] + 1) < 1e-5 && Math.abs(u[1]) < 1e-5 && Math.abs(u[2]) < 1e-5, 'roll 90: up point (-1, 0, 0): ' + u);
  rollUpSplines(ch, [[0, 0], [10, 0]], 0.5);
  ok(Math.abs(ch[7].v[0] + 1) < 1e-5, 'roll 0: up point = eye - row 1 (y-down world): ' + ch[7].v[0]);
}
// 3c. The game crosses the raw vector (FUN_00373908, 0x373f50): pitched, row 1 keeps length |f.xz|, so a roll turns less than its angle in the frame.
// aim - eye = (0, 3, 4): f = (0, 0.6, 0.8), row 0 = (1, 0, 0), row 1 = (0, 0.64, -0.48); roll 45 -> up point -(s' row 0 + c' row 1) normalised
{
  const { rollUpSplines, buildSpline } = await import(pathToFileURL(path.join(base, 'event_rt.js')));
  const k = (v) => buildSpline([0, 10], [v, v], 0.5), ch = [k(0), k(0), k(0), k(0), k(3), k(4), null, null, null, null];
  rollUpSplines(ch, [[0, 45], [10, 45]], 0.5);
  const u = [ch[6].v[0], ch[7].v[0], ch[8].v[0]], want = [-0.7809, -0.4998, 0.3748];
  ok(u.every((x, i) => Math.abs(x - want[i]) < 1e-3), 'pitched roll 45: ' + u + ' (want ' + want + ')');
}
// 3d. Inside an unplayed event main's pc is past its call: nextEvent = that event, so heri_dgsol does not count as 'before heri_taijou' and auto-skips
{
  const v = { 0: 14, 1: 8 }, S = make(v, G({ 0: 1, 1: 13 })), R = S.R;
  let inside = null;
  S.run(4000, () => { if (R.vm.frames.some(F => F.m.name === 'heri_dgsol')) inside ??= R.nextEvent(); return R.gflags[1] > 13 && R.battle; });
  ok(inside === 'ev0103.heri_dgsol', 'nextEvent inside heri_dgsol: ' + inside);
  if (!PLAYS.has('ev0103.heri_dgsol')) ok(R.log.some(x => /^skip ev0103\.heri_dgsol/.test(x[1])), 'heri_dgsol auto-skipped at its first wait: ' + R.log.filter(x => /^skip/.test(x[1])).map(x => x[1]).join());
}
// 3e. A player's Skip in heri_taijou (Start, cross): main's branch at pc 6355 goes past sk_mituketa2, chunks (6, 7), battle
{
  const seen = new Set(), vis = [], S = make({ 0: 16, 1: 8, 2: 1 }, G({ 0: 1, 1: 13 }), { allVisible: b => vis.push(b) }), R = S.R;
  S.run(200, () => R.vm.frames.some(F => F.m.name === 'heri_taijou') && R.vm.pending && R.skippable());
  ok(R.requestSkip(), 'Skip offered in heri_taijou');
  S.run(3000, () => { for (const F of R.vm.frames) seen.add(F.m.name); return R.gflags[1] === 20 && R.battle; });
  ok(R.gflags[1] === 20 && !seen.has('sk_mituketa2'), 'Skip in heri_taijou: no sk_mituketa2, global 1 = 20: ' + [...seen].join());
  ok(vis.join() === 'false,true', 'everything shown again after the Skip: ' + vis.join());
}
// 3f. Skip in sk_mituketa2: its voices are off, main goes on to battle at (6, 7)
{
  const S = make({ 0: 16, 1: 8, 2: 1 }, G({ 0: 1, 1: 13 })), R = S.R;
  S.run(2000, () => R.vm.frames.some(F => F.m.name === 'sk_mituketa2') && R.vm.pending && R.skippable());
  ok(R.requestSkip(), 'Skip offered in sk_mituketa2');
  ok(S.run(800, () => R.gflags[1] === 20 && R.battle), 'Skip in sk_mituketa2: main reaches battle, global 1 = 20');
}
// 3g. The event pause holds a voice where it is (FUN_003ea9f0 / FUN_003eaa78): stopped at its offset, the same offset after, no end while held
{
  const { VoicePlayer } = await import(pathToFileURL(path.join(base, 'event_sound.js')));
  const ctx = { currentTime: 10, createGain: () => ({ gain: {}, connect() {} }), createBufferSource() { const n = { connect() {}, start(t, o) { n.started = o; made.push(n); }, stop() { n.stopped = true; } }; return n; } };
  const made = [], V = new VoicePlayer({ ctx }); V.out = {};
  const rec = { name: 'x', buf: {} };
  V.start(rec, 0); ctx.currentTime = 11; V.pause(true);
  ok(made[0].stopped && Math.abs(rec.off - 1) < 1e-9 && made[0].onended === null, 'paused: source stopped at offset 1, its end not taken as the voice\'s');
  ctx.currentTime = 50; V.pause(false);
  ok(made.length === 2 && made[1].started === 1 && V.playing.includes(rec), 'resumed: a new source from offset 1');
  ctx.currentTime = 51; V.pause(true); ok(Math.abs(rec.off - 2) < 1e-9, 'the offset goes on from there, not from the pause\'s time');
}
// 3h. scr005: each event from main's own beat (stage flag 1 sub-beats, main's pcs in notes/story-cutscenes.md): it runs, no Skip, its voices finish, main comes back to
// battle. Flags as a player reaches them (traced route states; the first flag word as in r05_west / r07_toujou)
for (const [ev, flags, g1, extra] of [
  ['roji01_01', { 0: 2, 1: 4 }, 5], ['beast_ev01', { 0: 11, 1: 8 }, 7], ['heri_tobi', { 0: 4, 1: 7 }, 7], ['help_people01', { 0: 11, 1: 8 }, 8], ['help_orei01', { 0: 11, 1: 10 }, 8], ['beast_ev02', { 0: 11, 1: 11 }, 8],
  ['help_orei02', { 0: 12, 1: 12, 39: 1, 40: 1, 41: 1 }, 12], ['help_orei04', { 0: 24, 1: 28, 32: 1, 33: 1, 34: 1 }, 25], ['help_people03', { 0: 24, 1: 29 }, 25], ['help_orei03', { 0: 24, 1: 30, 30: 1 }, 25],
]) {
  const v = { ...flags }, S = make(v, G({ 0: 1, 1: g1 })), R = S.R, seen = new Set(), vis = [];
  R.o.allVisible = b => vis.push(b);
  const back = S.run(6000, () => { for (const F of R.vm.frames) seen.add(F.m.name); return seen.has(ev) && !R.vm.frames.some(F => F.m.name === ev) && R.battle; });
  ok(seen.has(ev), ev + ' ran from main: ' + [...seen].join());
  ok(back, ev + ': main back in battle');
  ok(!R.log.some(x => /^skip /.test(x[1])), ev + ': no Skip: ' + R.log.filter(x => /^skip /.test(x[1])).map(x => x[1]).join());
  ok(!vis.length || vis[vis.length - 1] === true, ev + ': everything shown again: ' + vis.join());
}
// 3i. help_orei02's end: main's setpos(getpos()) keeps Vincent where he was (FUN_0037a580; 0 used to send him to the origin), and its camera comes back from get_battle_camera_l
{
  const places = [], resets = [], at = [-1940, 0, 330];
  const S = make({ 0: 12, 1: 12, 39: 1, 40: 1, 41: 1 }, G({ 0: 1, 1: 12 }), { battleObject: n => ({ tag: n, matrix: () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, at[0], at[1], at[2], 1], lend() {}, show() {}, release() {}, place: (p) => places.push([n, p]) }),
    viewMatrix: () => ({ eye: [1, 2, 3], fwd: [0, 0, 1], down: [0, 1, 0], fov: 73.5 }), cameraReset: (v) => resets.push(v && { eye: v.eye.slice(), aim: v.aim.slice() }) });
  const R = S.R, seen = new Set();
  S.run(4000, () => { for (const F of R.vm.frames) seen.add(F.m.name); return seen.has('help_orei02') && R.gflags[1] >= 12 && R.battle && places.length; });
  const p = places.find(x => x[0] === 'p_Vin');
  ok(p && Math.hypot(p[1][0] - at[0], p[1][2] - at[2]) < 1e-3, 'help_orei02: Vincent stays: ' + JSON.stringify(places));
  const r = resets[resets.length - 1];
  ok(r && r.eye.join() === '1,2,3' && r.aim.join() === '1,2,4', 'its battle() reads main\'s Camera.set from get_battle_camera_l: ' + JSON.stringify(r));
}
// 4. hide_model_l: bit set = the smd list entry is skipped (FUN_0037aa20: b 0 sets, b 1 clears)
{
  const A = new EventActors({ warn: () => {} }), a = A.create('n013', 7);
  const S = make({}, G({ 0: 1, 1: 13 }), { actors: A });
  const n = S.R.vm.natives['fake/KerberosActor.hide_model_l(IIZ)V'];
  n(S.R.vm, [7, 11, 0]); ok(a.partMask === 1 << 11, 'hide_model(11, false): bit 11 set');
  n(S.R.vm, [7, 3, 1]); ok(a.partMask === 1 << 11, 'hide_model(3, true): bit 3 clear');
  n(S.R.vm, [7, 11, 1]); ok(a.partMask === 0, 'hide_model(11, true): clear');
}
// 4. A player steps on trigger 18 (stage 0 = 20): first_encounter plays out, no Skip, then the fight's battle() with global 1 = 22.
{
  const seen = new Set(), v = { 0: 20, 1: 8 };
  const S = make(v, G({ 0: 1, 1: 21 }), { actors: new EventActors({ clipFrames: () => 10, warn: () => {} }) });
  let chained = false;
  S.run(6000, () => { for (const F of S.R.vm.frames) seen.add(F.cls + '.' + F.m.name); if (S.R.actors.log.some(x => /^chain \d+ h_st/.test(x[1]))) chained = true; return S.R.gflags[1] === 22 && S.R.battle; });
  ok(chained, 'the slot loop runs setmotionChain: the chain reaches its second clip h_st (weapon frame 1)');
  ok(seen.has('ev0141.first_encounter'), 'first_encounter ran: ' + [...seen].join());
  ok(S.R.gflags[1] === 22 && S.R.battle, 'main comes back to battle with global 1 = 22');
  ok(!S.R.log.some(x => /^skip /.test(x[1])), 'no Skip in first_encounter: ' + S.R.log.filter(x => /^skip /.test(x[1])).map(x => x[1]).join());
}
// 5. e036 beaten (stage 0 = 24): rv_toujou plays out, main's setflag(1, 25) and scene_save(4) after it.
{
  const seen = new Set(), v = { 0: 24, 1: 8 };
  const S = make(v, G({ 0: 1, 1: 22 }));
  S.run(12000, () => { for (const F of S.R.vm.frames) seen.add(F.cls + '.' + F.m.name); return S.R.gflags[1] === 25; });
  ok(seen.has('ev0141.rv_toujou'), 'rv_toujou ran');
  ok(S.R.gflags[1] === 25, 'global 1 = 25 after it: ' + S.R.gflags[1]);
  ok(!S.R.log.some(x => /^skip /.test(x[1])), 'no Skip in rv_toujou');
}
// 6. setmotionChain (FUN_00382768): the second waits for the first's end, the clip goes out with its loop and start; setqt: FUN_00262de0's rows
{
  const A = new EventActors({ warn: () => {} });
  const S = make({}, G({ 0: 1, 1: 13 }), { actors: A }), R = S.R;
  const a = A.create('e027', 7); a.files = [];
  const N = R.vm.natives['fake/KerberosActor.setmotion4_l(ILjava/lang/String;FFFZZI)I'];
  const h1 = N(R.vm, [7, 'bv002vn', 0, 500, 200, 1, 0, 0]), h2 = N(R.vm, [7, 'h_st', 500, 0, 100, 0, 1, h1]);
  R.slots = R.slots.filter(c => c.type === 0x22);
  const step = () => { R.clock += 20; for (const c of R.slots.slice()) if (A.chain(c, R)) R.slots.splice(R.slots.indexOf(c), 1); };
  step();
  ok(a.code === 'bv002vn' && a.loop === true && a.start === 60 && a.flags === 0x82, `first clip's request: ${a.code} loop ${a.loop} start ${a.start} flags ${a.flags}`);
  a.code = null;
  let f = 0; while (R.busy(h1) && f < 50) { ok(a.code === null, 'second clip waits for the first'); step(); f++; }
  ok(f === 10, 'first ends after its 200 ms: ' + f);
  step();
  ok(a.code === 'h_st' && a.loop === false && a.blend === 30 && a.flags === 0x86, `second clip's request: ${a.code} ${a.loop} ${a.blend} ${a.flags}`);
  const q = quatRows(0, 0, Math.SQRT1_2, Math.SQRT1_2);   // 90 degrees about z: row 0 = (0, 1, 0), row 1 = (-1, 0, 0)
  const want = [0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0];
  ok(q.every((x, i) => Math.abs(x - want[i]) < 1e-5), 'quatRows 90 about z: ' + q);
}
// 7. Actor.move (command 0xc): straight line at speed, facing it, then the end clip
{
  const A = new EventActors({ warn: () => {} });
  const S = make({}, G({ 0: 1, 1: 13 }), { actors: A }), R = S.R;
  const a = A.create('n029', 9); a.M[12] = 0; a.M[14] = 0; a.files = [];
  const h = R.vm.natives['fake/KerberosActor.move_l(FFFLjava/lang/String;FIFZZLjava/lang/String;Z)I'](R.vm, [0, 0, 100, 'rn', 0, 9, 0.005, 0, 1, 'st', 1]);
  R.slots = R.slots.filter(c => c.type === 0xc);
  const c = R.slots[0];
  ok(Math.abs(c.L - 10) < 1e-3, 'walk length = distance x 0.1: ' + c.L);
  R.clock = c.start + 1000; ok(!A.walk(c, R), 'still walking at 1 s');
  ok(Math.abs(a.M[14] - 50) < 1e-2 && a.code === 'rn', 'halfway at 1 s of 2: ' + a.M[14]);
  ok(Math.abs(a.M[10] + 1) < 1e-5, 'row 2 against the walk (v = position - next): ' + a.M[10]);
  R.clock = c.start + 2100; ok(A.walk(c, R), 'done at the end');
  ok(a.code === 'st' && a.loop === true && a.flags === 0x86, `end clip ${a.code} ${a.loop} ${a.flags}`);
  ok(h > 0, 'handle');
}
// 8. wro_kaisetu's choice box (kind 27): the box opens at its sel, ✕ on 'Nothing' ends the talk; ○ reopens it; Supplies plays and the box comes back with it marked;
// a Skip takes state 2 and +0x1130 (the page hung on this before: getstate_l was missing). A player's path through main: stage 1 = 32
{
  const dir = path.join(HERE, 'data');
  const D = fs.existsSync(path.join(dir, 'pause.json')) ? loadStageInfoData(JSON.parse(fs.readFileSync(path.join(dir, 'stage_info.json'))), loadPauseData(JSON.parse(fs.readFileSync(path.join(dir, 'pause.json'))))) : null;
  const go = (keys, opts = {}) => {
    const sounds = [], W = createEventWindows({ D, warn: () => {}, se: id => sounds.push(id) });
    const v = { 0: 24, 1: 32 }, g = G({ 0: 1, 1: 25 });
    const S = make(v, g, { windows: W });
    const seen = new Set(), got = [];
    let k = 0, wait = 0, moved = false;
    const ran = new Map();
    const done = S.run(20000, () => {
      for (const F of S.R.vm.frames) seen.add(F.cls + '.' + F.m.name);
      for (const a of S.R.actors.slots) if (a.code === 'rn') ran.set(a, ran.get(a) ?? a.M[14]); else if (ran.has(a) && a.M[14] !== ran.get(a)) moved = true;
      if (opts.skipAt && S.R.vm.frames.some(F => F.m.name === 'wro_kaisetu') && W.entries.some(e => e.kind === 27)) S.R.requestSkip();
      const e = W.entries.find(x => x.id > 0 && x.kind === 27 && x.box && x.box.box);
      if (e && e.box.box.result === 0 && !(e.box.box.flags & 0x30) && ++wait > 5 && k < keys.length) {
        const b = e.box.box; if (!got.length) got.push(['first', b.cursor, b.rows.length, b.root.h, b.list.y]);
        got.push(['row0', String.fromCharCode(...b.rows[0].bytes)]);
        W.choiceKey(keys[k++]); wait = 0; got.push([keys[k - 1], b.cursor]);
      }
      return g[1] === 26;
    });
    return { S, W, g, done, seen, got, sounds, k, moved };
  };
  const T = go(['cross']);
  ok(T.seen.has('ev0141.wro_kaisetu'), 'wro_kaisetu ran');
  ok(T.moved, 'the slot loop runs Actor.move: the townspeople run after the talk');
  ok(T.done && T.g[1] === 26, 'main goes on with global 1 = 26 after ✕ on the box\'s first row: ' + T.g[1]);
  if (D && T.got.length) {
    ok(T.got[0][1] === 3 && T.got[0][2] === 4, 'the box opens with 4 rows, cursor on row 3 (Nothing, sel 3): ' + T.got[0]);
    ok(T.got[0][3] === 142 && T.got[0][4] === 325, 'title grows the box (16 + 24), whole rows (80): root h 142, list y 325: ' + T.got[0]);
    ok(T.sounds.includes(9) && T.sounds.includes(7), 'box open sound 9, confirm 7: ' + T.sounds.join());
  }
  const C = go(['circle', 'cross']);
  ok(C.k === 2 && C.done, '○ closes the box and the talk comes back to it (state 3): keys used ' + C.k);
  const Sup = go(['down', 'cross', 'cross']);
  ok(Sup.got.some(x => x[0] === 'down' && x[1] === 0), 'down from the last row wraps to row 0: ' + JSON.stringify(Sup.got));
  ok(Sup.k === 3 && Sup.done, 'Supplies plays, the box comes back, ✕ ends: keys ' + Sup.k);
  ok(Sup.got.filter(x => x[0] === 'row0').pop()[1].startsWith('$c00$Supplies'), 'the box comes back with Supplies marked (MES_10600WR1h): ' + JSON.stringify(Sup.got.filter(x => x[0] === 'row0').pop()));
  const K = go([], { skipAt: true });
  ok(K.done && K.g[1] === 26, 'Skip at the box: state 2 and the box\'s first value end the talk, no hang: ' + K.g[1]);
}
// 9. Worker 0262, scr002 / scr006 from main's own beats (notes/story-cutscenes.md): each plays out unskipped, the lent objects get their own models and the event's clips, and main goes on.
// The hand-backs are the events' setpos / setdir.
{
  const clipFrames = (m, n, c) => { const A = heriActors && heriActors.models[m], p = A && A.packs[n]; return p && p.clipFrames[c] != null ? p.clipFrames[c] : null; };
  const heriActors = fs.existsSync(path.join(HERE, 'data/event/actors/actors.json')) ? JSON.parse(fs.readFileSync(path.join(HERE, 'data/event/actors/actors.json'))) : null;
  const beat = (v, g, stop, lim = 9000) => {
    const places = {}, shows = [], seen = new Set(), warned = [], models = { p_Vin: 'p000', e_Heri: 'e023', e_HobH: 'e024' };
    const A = new EventActors({ clipFrames, residentFiles: (m) => (heriActors && heriActors.models[m] && heriActors.models[m].resident) || [], warn: m => warned.push(m) });
    const S = make(v, G(g), { actors: A, battleObject: n => (models[n] ? { tag: n, model: models[n], matrix: () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], lend() {}, show: b => { const sl = A.slots.find(x => x.lent && x.lent.tag === n); if (b && sl && sl.mp.clip) shows.push(n); }, release() {}, place: (p, f) => { places[n] = [p, f]; } } : null) });
    const clips = {};
    S.run(lim, () => { for (const F of S.R.vm.frames) seen.add(F.cls + '.' + F.m.name); for (const a of A.slots) if (a.lent && a.mp.clip) clips[a.lent.tag] = a.model + ':' + a.mp.clip; A.step(); return stop(S); });
    return { ...S, A, places, shows, seen, clips, warned, skips: S.R.log.map(x => x[1]).filter(m => /^skip /.test(m)) };
  };
  const near = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) < 0.01;
  const clipWarn = (B) => B.warned.filter(m => /clip .* not loaded/.test(m) && !/km0701dj/.test(m));   // km0701dj: 4 bones' tracks on the 5-bone w003, left out (fidelity-audit)
  {
    const B = beat({ 0: 13, 1: 8, 2: 1 }, { 0: 1, 1: 12 }, S => S.R.gflags[1] === 13 && S.R.battle);
    ok(B.seen.has('ev0103.heri_toujou') && !B.skips.length, 'heri_toujou played, no Skip: ' + B.skips.join());
    ok(B.R.gflags[1] === 13 && B.R.battle, 'after heri_toujou main is in battle with global 1 = 13');
    ok(B.R.log.some(x => x[1] === 'scene_save 2'), 'scene_save(2) on the way');
    ok(/^e023:/.test(B.clips.e_Heri || ''), 'e_Heri\'s slot plays the event\'s clip on its own model e023: ' + B.clips.e_Heri);
    ok(B.places.p_Vin && near(B.places.p_Vin[0], [-1591.1, 0, 1364.4]), 'Vincent handed back at the event\'s setpos: ' + (B.places.p_Vin && B.places.p_Vin[0]));
    ok(B.places.e_Heri, 'e_Heri handed back by name');
    if (heriActors) ok(!clipWarn(B).length, 'heri_toujou: every clip it names is exported: ' + clipWarn(B).join(' | '));
  }
  {
    const B = beat({ 0: 14, 1: 8, 2: 1 }, { 0: 1, 1: 13 }, S => S.R.gflags[1] === 14 && S.R.battle);
    ok(B.seen.has('ev0103.heri_dgsol') && !B.skips.length && B.R.gflags[1] === 14, 'heri_dgsol played, no Skip, global 1 = 14: ' + B.skips.join());
    ok(/^e023:/.test(B.clips.e_Heri || ''), 'e_Heri in heri_dgsol plays on e023: ' + B.clips.e_Heri);
    ok(/^p000:/.test(B.clips.p_Vin || ''), 'p_Vin in heri_dgsol plays on p000: ' + B.clips.p_Vin);
    ok(!B.shows.length, 'a slot\'s setVisible never brings the gameplay body back while the slot has a clip: ' + B.shows.join());
    ok(B.places.p_Vin && near(B.places.p_Vin[0], [-1692.6, 0, 1268.2]), 'Vincent\'s hand-back: ' + (B.places.p_Vin && B.places.p_Vin[0]));
    // T w262_dgac: under the flag poke e_para_1..6 have no object: no slot, and nothing else breaks
    ok(!B.R.actors.slots.some(a => /^e_para/.test(a.model)), 'no object: getbattleactor does nothing (FUN_00376b00)');
    if (heriActors) ok(!clipWarn(B).filter(m => !/\(e_para/.test(m)).length, 'heri_dgsol: every clip is exported: ' + clipWarn(B).join(' | '));
  }
  {
    const B = beat({ 0: 36, 1: 32, 2: 3 }, { 0: 1, 1: 26 }, S => S.R.gflags[1] === 29 && S.R.battle);
    ok(B.seen.has('ev0103.heri_lastst') && !B.skips.length, 'heri_lastst played, no Skip: ' + B.skips.join());
    ok(B.R.log.some(x => x[1] === 'boss 1'), 'then Zone.boss(true)');
    ok(B.places.e_HobH && near(B.places.e_HobH[0], [760, -110, 1456.5]), 'the boss handed back at the event\'s setpos: ' + (B.places.e_HobH && B.places.e_HobH[0]));
    ok(B.places.p_Vin && near(B.places.p_Vin[0], [588.7, -99.9, 1456.5]), 'Vincent in the arena: ' + (B.places.p_Vin && B.places.p_Vin[0]));
    if (heriActors) ok(!clipWarn(B).length, 'heri_lastst: every clip is exported: ' + clipWarn(B).join(' | '));
  }
  {
    const B = beat({ 0: 40, 1: 32, 2: 3 }, { 0: 1, 1: 29 }, S => S.R.log.some(x => x[1] === 'endSection'), 12000);
    ok(B.seen.has('ev0103.heri_lasted') && B.seen.has('ev0145.kita_ev0145') && !B.skips.length, 'the boss dead: heri_lasted, then kita_ev0145, no Skip: ' + [...B.seen].filter(m => /heri|kita/.test(m)).join() + ' ' + B.skips.join());
    ok(B.R.log.some(x => x[1] === 'isSkip 0 ev0100.main pc 11079'), 'main\'s isSkip after heri_lasted reads 0 (pc 11079)');
    ok(B.R.log.some(x => x[1] === 'endSection'), 'kita_ev0145 hands on to the level\'s end');
    if (heriActors) ok(!clipWarn(B).length, 'heri_lasted, kita_ev0145: every clip is exported: ' + clipWarn(B).join(' | '));
    // A player's Skip in heri_lasted: main's branch goes past kita_ev0145
    const v = { 0: 40, 1: 32, 2: 3 }, T = make(v, G({ 0: 1, 1: 29 })), R = T.R, seen = new Set();
    T.run(400, () => R.vm.frames.some(F => F.m.name === 'heri_lasted') && R.vm.pending && R.skippable());
    ok(R.requestSkip(), 'Skip offered in heri_lasted');
    T.run(4000, () => { for (const F of R.vm.frames) seen.add(F.m.name); return R.log.some(x => x[1] === 'endSection'); });
    ok(R.log.some(x => x[1] === 'endSection') && !seen.has('kita_ev0145'), 'Skip in heri_lasted: no kita_ev0145, the level still ends: ' + [...seen].join());
  }
}
console.log((fails ? 'FAILED ' : 'ok ') + oks + ' / ' + (oks + fails) + (MUT ? ' (mutant ' + MUT + ')' : ''));
if (base !== HERE) fs.rmSync(base, { recursive: true, force: true });
process.exit(fails ? 1 : 0);
