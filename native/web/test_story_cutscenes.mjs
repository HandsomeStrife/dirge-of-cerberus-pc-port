// test_story_cutscenes.mjs -- main's story events that play out (worker 0261; notes/story-cutscenes.md).
//   node --import ./native/web/test_hooks.mjs native/web/test_story_cutscenes.mjs
// Needs data/event/ev0100_stage.json. MUTATE=walkskip|walkmiss|chainskip|boxlock|boxlockopen|circlecross|boxleft|boxright|boxnopage|winkind|getpos|battlecam|nextevent|frames1|plays|roll|rollsign|rollraw|voicepause|hide|visall|group runs one mutant of the modules in a scratch copy.
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
    // worker 0262
    reloadpass: ['stage_controller.js', 'if (first && this.o.globalFlags) {', 'if (false) {'],
    reload23: ['enemy_ai.js', 'if (send23) event23();', 'event23();'],
    lentgate: ['enemy_ai.js', 'if (C.f564 & 0x80000000) return;', ''],
    lentturn: ['enemy_ai.js', 'a.C.s214 === 6 && !(a.C.f564 & 0x80000000)', 'a.C.s214 === 6'],
    lentclear: ['enemy_ai.js', 'a.C.f564 &= 0x7fffffff;', ''],
    lentpass: ['enemy_ai.js', 'loadPass([...recs, ...actors.filter(a => a.C && (a.C.f564 & 0x80000000)).map(a => a.rec)]);', 'loadPass(recs);'],
    status60: ['stage_controller.js', 'if (!((obj.status60 | 0) & 0x20000)) obj.place(pos, face);', 'obj.place(pos, face);'],
    loud: ['stage_controller.js', '&& !PLAYS.has(hit.cls + \'.\' + name)) console.error(', '&& false) console.error('],
    lentmodel: ['stage_controller.js', 'R.actors.create(obj.model || name, id)', 'R.actors.create(name, id)'],
    lentshow: ['stage_controller.js', 'a.lent.show(!!v && !a.mp.clip)', 'a.lent.show(!!v)'],
    plays0262: ['stage_controller.js', "'ev0103.heri_lasted', ", ''],
    playsht: ['stage_controller.js', "'ev0103.heri_toujou', ", ''],
    skipload: ['event_actor_rt.js', "return R.skip !== 0 && (R.skipMode & 2) ? 0 : T.loading(", "return T.loading("],
    loadhold: ['event_actor_rt.js', "T.loading(R, T.ensure && T.ensure(str(name)))", "0"],
    motionhold: ['event_actor_rt.js', "Promise.all([T.ensure(a.model), T.ensurePack(a.model, n)])", "T.ensure(a.model)"],
    lentensure: ['stage_controller.js', "if (R.actors.ensure && obj.model) R.actors.ensure(obj.model);", ""],
    gunbit: ['aim_core.js', "gameState.set(8);", ""],
    getpos: ['stage_controller.js', "return a ? a.M[12] : 0; }", "return 0; }"],
    battlecam: ['stage_controller.js', "i === 1 ? f32(v.eye[j] + v.fwd[j])", "i === 1 ? 0"],
    rollraw: ['event_rt.js', 'r1 = crs(fw, raw); v = r1;', 'r1 = crs(fw, r0); v = r1;'],
    voicepause: ['event_sound.js', 'if (on) this.hold(rec); else this.start(rec, rec.off, VOICE_PIPE_S);', ''],
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
    walkskip: ['event_actor_rt.js', 'if (s < c.L && R.skip !== 2) return false;', 'if (s < c.L) return false;'],
    walkmiss: ['event_actor_rt.js', 'if (!a) return false;                                              // FUN_0037a600', 'if (!a) return true;                                              // FUN_0037a600'],
    chainskip: ['event_actor_rt.js', 'if (R.skip !== 0 && R.frameNo !== c.at) return true;', ''],
    boxlock: ['event_window.js', 'if (this.flags & 2) return false;              // FUN_003de568', 'if (false) return false;              // FUN_003de568'],
    boxlockopen: ['event_window.js', 'if (this.flags & 2) return false;              // FUN_003de568', 'if (this.flags & 0x32) return false;              // FUN_003de568'],
    circlecross: ['event_window.js', "this.result = a === 'cross' ? 3 : 4;", 'this.result = 3;'],
    boxleft: ['event_window.js', 'if (was !== 0) this.cursor = Math.max(was - page, 0);', ''],
    boxright: ['event_window.js', 'else if (was !== n - 1) this.cursor = Math.min(was + page, n - 1);', ''],
    boxnopage: ['event_window.js', 'if (this.noPage) return true;', ''],
    winkind: ['event_window.js', 'e.id = c.id; e.box = rec; e.state = 0; e.kind = c.kind;\n        if (R.skip !== 0) W.hide(rec);                            // FUN_003b7118(box, 1)', 'e.id = c.id; e.box = rec; e.state = 0;\n        if (R.skip !== 0) W.hide(rec);                            // FUN_003b7118(box, 1)'],
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
const { createStageController, PLAYS, PLAYED_ELSEWHERE, MAIN_CLASSES } = await import(pathToFileURL(path.join(base, 'stage_controller.js')));
const { AreaStream } = await import(pathToFileURL(path.join(base, 'area_stream.js')));
const { EventActors, quatRows } = await import(pathToFileURL(path.join(base, 'event_actor_rt.js')));
const { createEventWindows, EventChoiceScreen } = await import(pathToFileURL(path.join(base, 'event_window.js')));
const { loadPauseData } = await import(pathToFileURL(path.join(base, 'pause.js')));
const { loadStageInfoData } = await import(pathToFileURL(path.join(base, 'stage_info.js')));

function make(v, globalFlags, extra = {}) {
  const stream = new AreaStream([], [6, 7]), warns = [];
  const c = createStageController({ data, warn: m => warns.push(m), flags: () => v, stream: () => stream, globalFlags,
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
// 3d. Every event main calls plays (no auto-skip any more): main's call sites in the data, and the loud check at the call itself
{
  const hex = (c) => Uint8Array.from(c.match(/../g) || [], h => parseInt(h, 16));
  const sites = new Set();
  for (const k of MAIN_CLASSES) for (const m of data.classes[k].methods) {
    if (!m.code) continue;
    const c = hex(m.code), cp = data.classes[k].cp;
    for (let i = 0; i + 2 < c.length; i++) {
      if (c[i] !== 0xb8) continue;
      const r = cp[(c[i + 1] << 8) | c[i + 2]];
      if (r && r[0] === 'ref' && /^ev\d{4}$/.test(r[1]) && !MAIN_CLASSES.includes(r[1])) sites.add(r[1] + '.' + r[2]);
    }
  }
  const out = [...sites].filter(e => !PLAYS.has(e) && !PLAYED_ELSEWHERE.some(p => p.startsWith(e + '(')));
  ok(sites.size >= 10, 'main\'s event call sites read from the data: ' + [...sites].join());
  ok(!out.length, 'every event main calls is in PLAYS or played elsewhere: missing ' + out.join());
  const errs = [], was = console.error; console.error = (m) => errs.push(String(m));
  try {
    { const S = make({ 0: 14, 1: 8 }, G({ 0: 1, 1: 13 })); S.run(300, () => S.R.vm.frames.some(F => F.m.name === 'heri_dgsol')); ok(!errs.length, 'no complaint for an event in PLAYS: ' + errs.join()); }
    PLAYS.delete('ev0103.heri_dgsol');
    const S = make({ 0: 14, 1: 8 }, G({ 0: 1, 1: 13 })), R = S.R;
    S.run(300, () => R.vm.frames.some(F => F.m.name === 'heri_dgsol'));
    PLAYS.add('ev0103.heri_dgsol');
    ok(errs.some(m => /main calls ev0103\.heri_dgsol, not in PLAYS/.test(m)), 'an event taken out of PLAYS: console.error at main\'s call: ' + errs.join());
    ok(!R.log.some(x => /^skip /.test(x[1])), 'and nothing presses Skip for it');
  } finally { console.error = was; }
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
  // worker 0266: what the channel mixed before the pause is still in the PCM ring: heard VOICE_PIPE_S (P) on, and the resume is heard P later
  const { VoicePlayer, VOICE_PIPE_S: P } = await import(pathToFileURL(path.join(base, 'event_sound.js')));
  const ctx = { currentTime: 10, createGain: () => ({ gain: {}, connect() {} }), createBufferSource() { const n = { connect() {}, start(t, o) { n.at = t; n.started = o; made.push(n); }, stop(t) { n.stopped = t; } }; return n; } };
  const made = [], V = new VoicePlayer({ ctx }); V.out = {};
  const rec = { name: 'x', buf: { duration: 9 } };
  V.start(rec, 0); ctx.currentTime = 11; V.pause(true);
  ok(Math.abs(made[0].stopped - (11 + P)) < 1e-9 && Math.abs(rec.off - (1 + P)) < 1e-9 && made[0].onended === null, 'paused: the source plays on for the ring (P) and stops at offset 1 + P, its end not taken as the voice\'s');
  ctx.currentTime = 50; V.pause(false);
  ok(made.length === 2 && Math.abs(made[1].started - (1 + P)) < 1e-9 && Math.abs(made[1].at - (50 + P)) < 1e-9 && V.playing.includes(rec), 'resumed: a new source from offset 1 + P, heard P later');
  ctx.currentTime = 51; V.pause(true); ok(Math.abs(rec.off - (2 + P)) < 1e-9, 'the offset goes on from there, not from the pause\'s time');
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
// 3j. isPlayerReadyGun = game-state bit 8 (FUN_00576548: draw / holsterCore): with the gun drawn main's end of help_orei02 takes fov 52, battlemode 1 (pc 4462); holstered 73.5, battlemode 2
{
  const GS = await import(pathToFileURL(path.join(base, 'game_state.js')));
  const { WeaponSystem } = await import(pathToFileURL(path.join(base, 'aim_core.js')));
  const core = { W: { class: 0, se_draw: 1 }, P: {}, far: [0, 0, 0], setView() {}, sound: null, camJump() {} };
  GS.reset();
  try { WeaponSystem.prototype.draw.call(core, true, null); } catch { /* the rest of draw needs a real weapon: the bit comes first */ }
  ok(GS.test(8) === 1, 'draw sets game-state bit 8');
  try { WeaponSystem.prototype.holsterCore.call(core, true, null); } catch { /* as above */ }
  ok(GS.test(8) === 0, 'holsterCore clears it');
  for (const [drawn, fov, mode] of [[true, 52, 1], [false, 73.5, 2]]) {
    const S = make({ 0: 12, 1: 12, 39: 1, 40: 1, 41: 1 }, G({ 0: 1, 1: 12 }), { gameState: () => ({ set() {}, clear() {}, test: b => (b === 8 && drawn ? 1 : 0) }), viewMatrix: () => ({ eye: [0, 0, 0], fwd: [0, 0, 1], down: [0, 1, 0], fov: 70 }) }), R = S.R, seen = new Set();
    let v = null;
    const orig = R.o.cameraReset; R.o.cameraReset = (view) => { v = view; if (orig) orig(view); };
    S.run(4000, () => { for (const F of R.vm.frames) seen.add(F.m.name); return seen.has('help_orei02') && !R.vm.frames.some(F => F.m.name === 'help_orei02') && R.battle; });
    ok(v && v.fov === fov && R.log.some(x => x[1] === 'battlemode ' + mode), `gun ${drawn ? 'drawn' : 'away'}: fov ${v && v.fov} (want ${fov}), battlemode ${mode}: ` + R.log.filter(x => /^battlemode/.test(x[1])).map(x => x[1]).join());
  }
}
// 3k. The page's loads: load_l's and loadmotion_l's handles stay busy until the model and pack are in (EventActors.loading); getbattleactor asks for the model; none of it without ensure (the tests' resident case)
{
  const pend = [], A = new EventActors({ warn: () => {} });
  const later = () => { let res; const p = new Promise(r => { res = r; }); pend.push(res); return p; };
  const asked = [];
  A.ensure = (m) => { asked.push('model ' + m); return later(); }; A.ensurePack = (m, n) => { asked.push('pack ' + m + ' ' + n); return later(); };
  const S = make({}, G({ 0: 1, 1: 13 }), { actors: A }), R = S.R, N = R.vm.natives;
  const h = N['fake/KerberosActor.load_l(Ljava/lang/String;II)I'](R.vm, ['n013', 21, 0]);
  ok(h && R.busy(h), 'load_l: handle busy until the model is in');
  pend.shift()(); await new Promise(r => setTimeout(r, 0)); R.frame(20);
  ok(!R.busy(h), 'then free');
  const h2 = N['fake/KerberosActor.loadmotion_l(II)I'](R.vm, [21, 125]);
  ok(h2 && R.busy(h2) && asked.includes('model n013') && asked.includes('pack n013 125'), 'loadmotion_l: asks for model and pack, handle busy: ' + asked.join());
  pend.shift()(); await new Promise(r => setTimeout(r, 0)); R.frame(20);
  ok(R.busy(h2), 'still busy with only one of the two in');
  pend.shift()(); await new Promise(r => setTimeout(r, 0)); R.frame(20);
  ok(!R.busy(h2), 'free when both are in');
  // under Skip these loads are passed by (FUN_003837d0 mode bit 1; FUN_00382220 skip 2 with bit 0): no fetch, no hold
  asked.length = 0; R.skip = 2; R.skipMode = 3;
  const hs = N['fake/KerberosActor.load_l(Ljava/lang/String;II)I'](R.vm, ['e050', 22, 0]), hm = N['fake/KerberosActor.loadmotion_l(II)I'](R.vm, [22, 126]);
  ok(hs === 0 && hm === 0 && !asked.length, 'Skip: load_l and loadmotion_l pass by: ' + asked.join());
  R.skip = 0; R.skipMode = 0;
  const S2 = make({}, G({ 0: 1, 1: 13 }), { actors: A, battleObject: n => ({ tag: n, model: 'e027', matrix: () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], lend() {}, show() {}, release() {}, place() {} }) });
  asked.length = 0;
  S2.R.vm.natives['fake/KerberosActor.getbattleactor_l(ILjava/lang/String;)V'](S2.R.vm, [30, 'e_x']);
  ok(asked.join() === 'model e027', 'getbattleactor_l asks for the model: ' + asked.join());
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
  // Skip (FUN_00382768): a running chain ends at the next update, but not in the update that started it
  const h3 = N(R.vm, [7, 'x_sk', 0, 0, 5000, 1, 0, 0]);
  const c3 = R.slots.find(c => c.type === 0x22 && c.name === 'x_sk');
  R.skip = 2; R.frameNo = 100;
  ok(A.chain(c3, R) === false, 'chain under Skip: not over in the update that started it');
  R.frameNo = 101;
  ok(A.chain(c3, R) === true, 'chain under Skip: over at the next update, long before its 5 s');
  R.skip = 0; R.slots = R.slots.filter(c => c !== c3);
  ok(h3 > 0, 'chain handle');
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
  // Skip: +0x156c == 2 ends the walk at once, row 3 on the line at s (not at its end), the end clip goes out
  const h2 = R.vm.natives['fake/KerberosActor.move_l(FFFLjava/lang/String;FIFZZLjava/lang/String;Z)I'](R.vm, [0, 0, 300, 'rn', 0, 9, 0.005, 0, 1, 'st2', 1]);
  const c2 = R.slots.find(x => x.type === 0xc && x !== c);
  R.clock = c2.start + 200; R.skip = 2;
  ok(A.walk(c2, R) === true, 'walk under Skip ends at once');
  ok(a.code === 'st2', 'walk under Skip: the end clip goes out: ' + a.code);
  R.skip = 0; R.slots = R.slots.filter(x => x !== c2);
  // FUN_0037a600 == 0 -> LAB_00378678: no actor: the slot stays, the handle stays busy
  const h4 = R.vm.natives['fake/KerberosActor.move_l(FFFLjava/lang/String;FIFZZLjava/lang/String;Z)I'](R.vm, [0, 0, 300, 'rn', 0, 9, 0.005, 0, 1, 'st2', 1]);
  const c4 = R.slots.find(x => x.type === 0xc && x !== c);
  c4.id = 987;
  ok(A.walk(c4, R) === false && R.busy(h4), 'walk with no actor: the slot is kept, its handle busy');
  R.slots = R.slots.filter(x => x !== c4);
  ok(h2 > 0 && h4 > 0, 'walk handles');
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
  // the box's keys, on the box itself: the lock is flag 2 alone (FUN_003de568 -> FUN_003d47b8), so a key in the 100 ms open counts; left / right FUN_003d8bc8 +0x30 / +0x3c
  if (D) {
    const box = (n, sel) => { const b = new EventChoiceScreen(D, 1000, -1); b.moveTo(b.root, 64, 149); b.setSize(384, 162); for (let i = 0; i < n; i++) b.addRow(Uint8Array.from([0x41 + i])); b.select(sel); return b; };
    const o = box(4, 3);
    ok((o.flags & 0x10) !== 0, 'a new box is opening (flag 0x10)');
    o.key('up', 1000); ok(o.cursor === 2, 'up in the open moves the cursor: ' + o.cursor);
    o.key('cross', 1000); ok(o.result === 3, '✕ in the open answers: ' + o.result);
    ok((o.flags & 2) !== 0, 'the answer locks the box (flag 2)');
    o.key('down', 1000); ok(o.cursor === 2, 'locked: down does nothing: ' + o.cursor);
    o.key('circle', 1000); ok(o.result === 3, 'locked: ○ does not change the answer: ' + o.result);
    const n = box(4, 3);
    ok(n.noPage === true, 'rows fit: +0x90 bit 0 (RAM s2420: 3)');
    n.key('left', 1000); ok(n.cursor === 3, 'rows fit: left does nothing: ' + n.cursor);
    n.key('right', 1000); ok(n.cursor === 3, 'rows fit: right does nothing: ' + n.cursor);
    const l = box(10, 3);
    ok(l.noPage === false, 'ten rows do not fit 140: bit 0 clear');
    l.key('right', 1000); ok(l.cursor === 9, 'right: a page (7), clamped to the last row: ' + l.cursor);
    l.key('left', 1000); ok(l.cursor === 2, 'left: a page: ' + l.cursor);
    l.key('left', 1000); ok(l.cursor === 0, 'left: clamped to the first row: ' + l.cursor);
    const c = box(2, 0);
    c.key('circle', 1000); ok(c.result === 4, '○ answers 4 (cancel), ✕ answers 3: ' + c.result);
  }
  // the entry's kind: a kind 4 window in an entry a choice box used: getstate_l under Skip by kind 4 -> 0 (FUN_00378f10)
  {
    const W = createEventWindows({ D: null, warn: () => {} }), S = make({}, G({ 0: 1, 1: 25 }), { windows: W }), R = S.R;
    const gs = R.vm.natives['fake/KerberosWindow.getstate_l(I)I'];
    W.open(R, { id: 5, kind: 27, t: 0, x: 0, y: 0, w: 10, h: 10, texts: [], sel: 0, key: 'a' });
    R.skip = 2;
    ok(gs(R.vm, [5]) === 2, 'kind 27 under Skip: 2: ' + gs(R.vm, [5]));
    W.entries.find(e => e.id === 5).id = 0;
    W.open(R, { id: 6, kind: 4, t: 0, x: 0, y: 0, w: 10, h: 10, text: new Uint8Array(1), key: 'b' });
    ok(gs(R.vm, [6]) === 0, 'kind 4 in the same entry under Skip: 0: ' + gs(R.vm, [6]));
    R.skip = 0;
  }
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
// 10. Worker 0262 (review): the real enemy_ai world behind the battle objects
{
  const { createEnemyAI } = await import(pathToFileURL(path.join(base, 'enemy_ai.js')));
  const { initWorld } = await import(pathToFileURL(path.join(base, 'checkpoint.js')));
  const ai = JSON.parse(fs.readFileSync(path.join(HERE, 'data/enemies/ai.json'), 'utf8'));
  const player = () => ({ pos: [700, -100, 1460], face: [1, 0, 0], hp: 780, id: 0x16, f118: 0x20209, s64: 0 });
  const bones = a => () => [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [a.pos[0], a.pos[1], a.pos[2], 1]];
  const opts = { data: ai, player: player(), quiet: true, log: () => {}, rand: () => 0.5, boneWorld: bones };
  // 10a. Restart at the boss (a scene_save(5) record): the stage init's 0x22 before main with the plug-in off, its 0x23 after main's first battle(),
  // by then Zone.boss(true) has come: record 32 gets the overlay's brain (T w240_init's order)
  {
    const flags = { 0: 36, 1: 32, 2: 3 };
    const W = initWorld(o => createEnemyAI({ ...opts, ...o }), { flags, frame: 0, clock: {}, reload: true, deadRecs: [], loadRecs: [] });
    const before = W.objects.get(32 + 22);
    ok(!(before.ai && before.ai.mode === 0x100), 'reload: no boss brain before main runs');
    const S = make(flags, G({ 0: 1, 1: 26, 18: 1 }), { settle: false, bossOverlay: on => W.setBossPlugin(on), reloadPass: () => W.stageLoad([]), stagePass: () => W.stageLoad([]) });
    S.run(8000, () => S.R.battle && S.R.stageObj);
    ok(S.R.log.some(x => x[1] === 'scene_save 5') || S.R.vm.calls.includes('ev0103.heri_lastst'), 'reload: main resumed at the boss beat: ' + S.R.vm.calls.join());
    const a = W.objects.get(32 + 22);
    for (let i = 0; i < 30; i++) W.tick(1.2, [700, -100, 1460], [700, -100, 1460]);        // the frames after the battle(): its activation runs
    ok(W.bossPlugin, 'reload: main took Zone.boss(true) before its battle()');
    ok(a.kind === 'actor' && a.hp === 17000, `reload: record 32 active, HP 17000 (${a.kind} ${a.hp})`);
    ok(a.ai && a.ai.mode === 0x100 && a.ai.boss, 'reload: record 32 has the boss brain, mode 0x100: ' + (a.ai ? a.ai.mode : 'no ai'));
    const n23 = []; const W2 = initWorld(o => createEnemyAI({ ...opts, ...o, log: m => { if (/^event .* 35\b|0x23/.test(String(m))) n23.push(m); } }), { flags: { 0: 2 }, frame: 0, clock: {}, reload: true, deadRecs: [], loadRecs: [] });
    ok(!W2.eventFlags[63], 'reload: event 0x23 not sent by initWorld (script 0 at flag 0 = 2 would set flag 63)');
    W2.stageLoad([]);
    ok(W2.eventFlags[63] === 1, 'reload: the pass sends it');
    const W3 = initWorld(o => createEnemyAI({ ...opts, ...o }), { flags: { 0: 2 }, frame: 0, clock: {}, deadRecs: [], loadRecs: [] });
    ok(W3.eventFlags[63] === 1, 'the stage start: initWorld still sends it');
  }
  // 10b. A lent body stands (FUN_0056a5e0 -> FUN_00344ec0(C, 1), FUN_00343160's first test) until the stage pass (FUN_00558f68 -> FUN_0056a790)
  {
    const pp = [-1579, 0, 1240];
    const { rootTrack } = await import(pathToFileURL(path.join(base, 'enemy_hit.js')));
    const side = JSON.parse(fs.readFileSync(path.join(HERE, 'data/enemies/e023.json'), 'utf8')), lpb = fs.readFileSync(path.join(HERE, 'data/enemies/e023_local.bin'));
    const lpd = new Float32Array(lpb.buffer, lpb.byteOffset, lpb.length >> 2), tracks = {};
    const rt = (m, c) => (m === 'e023' ? (tracks[c] ??= rootTrack(side.local_pose, lpd, side.clips[c], c)) : null);   // as test_heli.mjs
    const mk = () => { const W = createEnemyAI({ ...opts, player: { ...player(), pos: pp.slice() }, eventFlags: { 0: 13, 1: 8 }, rootTrack: rt, effect: { spawn() {}, hit() {}, wall() {} } });
      W.t.send(W.objects.get(53), -2, 0x108, [0, 0, 0, 0]); W.tick(1.2, pp, pp); W.runEvent(W.objects.get(53), 0x23); W.tick(1.2, pp, pp); W.tick(1.2, pp, pp); return W; };
    const run = (W, n) => { let ev16 = 0; for (let i = 0; i < n; i++) { W.tick(1.2, pp, pp); ev16 += W.events.filter(e => /^event 53 script 29 ev 22 /.test(e)).length; } return ev16; };
    const snap = x => JSON.stringify([x.pos, x.face, x.C.motion && x.C.motion.cls, x.C.motion && x.C.motion.phase, x.C.mp && x.C.mp.frame, x.C.mp && x.C.mp.clip]);
    const W = mk(), a = W.objects.get(53);
    ok(a.C.motion && a.C.motion.cls === 0x42, 'Dragonfly in its flight class 0x42');
    const free = mk(), fa = free.objects.get(53), f0 = snap(fa);
    // long enough for a leg to end: the free one's event 0x16 fires and its clip changes
    const n16 = run(free, 1300);
    ok(snap(fa) !== f0 && n16 >= 1, `not lent: it flies, event 0x16 fires ${n16} (the checks below can fail)`);
    a.C.f564 |= 0x80000000;                                                  // what battleObject's lend() does (play.js)
    const s0 = snap(a), n0 = run(W, 1300);
    ok(snap(a) === s0, 'lent: no flight, no motion, no clip frame: ' + s0 + ' -> ' + snap(a));
    ok(n0 === 0, `lent: its event 0x16 doesn't fire (${n0})`);
    a.C.s214 = 6; a.C.t2b0 = [a.pos[0] + 10, a.pos[1], a.pos[2] + 10]; const face = a.face.join();
    run(W, 5);
    ok(a.face.join() === face, 'lent: no turn (FUN_0034ea18 is inside FUN_00343160)');
    a.C.s214 = 0;
    W.stageLoad([]);
    ok(!(a.C.f564 & 0x80000000), 'the stage pass clears the bit (FUN_00558f68 -> FUN_0056a790)');
    ok((a.C.f564 & 0x20000000) && (a.C.f1c0 & 0x200), 'and runs the tail: C+0x564 bit 0x20000000, C+0x1c0 bit 0x200');
    const s1 = snap(a); run(W, 40);
    ok(snap(a) !== s1, 'after the pass it runs again');
  }
  // 10c. The hand-back's place: FUN_00319190's status +0x60 bit 0x20000 test
  {
    for (const [v, want] of [[0, 1], [0x20000, 0]]) {
      let placed = 0;
      const obj = { tag: 'e_Heri', status60: v, matrix: () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], lend() {}, show() {}, release() {}, place() { placed++; } };
      const S = make({}, G({ 0: 1 }), { battleObject: () => obj });
      S.R.running = true;
      const A = { id: 90, tag: 'e_Heri', lent: obj, M: obj.matrix() };
      S.R.actors.slots.push(A);
      S.R.handBack(A);
      ok(placed === want, `status +0x60 = ${v.toString(16)}: place ${placed} (${want})`);
    }
  }
}
console.log((fails ? 'FAILED ' : 'ok ') + oks + ' / ' + (oks + fails) + (MUT ? ' (mutant ' + MUT + ')' : ''));
if (base !== HERE) fs.rmSync(base, { recursive: true, force: true });
process.exit(fails ? 1 : 0);
