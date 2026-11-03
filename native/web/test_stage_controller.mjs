// test_stage_controller.mjs -- ev0100 main on the page's stage controller (worker 0219; notes/stage-controller.md).
//   node --import ./native/web/test_hooks.mjs native/web/test_stage_controller.mjs
// Needs data/event/ev0100_stage.json (build step stage). The trace checks need tools/trace/out/w219_beat / w219_skip
// (.jsonl + .calls.jsonl, TRACE_FIELDSET=stage TRACE_CALLLOG=stage) and w219_keys.json (tools/trace/stage_keys.py);
// without them those checks are skipped (reported).
// MUTATE=getflag|setflag|skip|sleep|preempt|opening|skipinit|bit6|card|wait|setpos|camset|setdir|bname|lent|running|stageobj|nopass runs one mutant of stage_controller.js (a scratch copy) and expects a failure.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const OUT = path.join(REPO, 'tools/trace/out');
let modPath = path.join(HERE, 'stage_controller.js');
const MUT = process.env.MUTATE;
if (MUT) {
  let s = fs.readFileSync(modPath, 'utf8');
  const sub = {
    getflag: ["return f && n >>> 0 < 0x40 ? (f[n] ?? 0) & 0xff : 0;", "return 0;"],
    setflag: ["if (f && n >>> 0 < 0x40) { f[n] = v & 0xff;", "if (false) {"],
    skip: ["if (this.autoSkip && this.skip === 0 && this.skippable()", "if (false && this.skippable()"],
    sleep: ["return block(() => R.skip !== 0 || (u !== 0", "return block(() => (u !== 0"],
    preempt: ["if (++n > this.budget) return 'preempted';", "if (++n > 5e6) throw new Error('step limit');"],
    opening: ["const a = !R.beforeOpening && o().area && o().area();", "const a = o().area && o().area();"],
    skipinit: ["this.skip = o.skip ?? 0;", "this.skip = 0;"],
    bit6: ["if (gs) { gs.set(6); gs.set(2); }", "if (gs) { gs.set(2); }"],
    card: ["return this.running && !this.battle && !this.skipOff && !this.cardOn;", "return this.running && !this.battle && !this.skipOff;"],
    wait: ["if (o.openingDone && !o.openingDone()) return block(() => o.openingDone(), end);", ""],
    // worker 0229 (battle actors): the hand-back's place (row 3 = setpos), the camera reset's view (main's Camera.set),
    // setdir's d, setbattlename's frame sync
    setpos: ["const pos = [M[12], M[13], M[14]], face", "const pos = obj.matrix().slice(12, 15), face"],
    camset: ["if (this.o.cameraReset) this.o.cameraReset(this.view);", "if (this.o.cameraReset) this.o.cameraReset(null);"],
    setdir: ["const d = [f32(M[12] - x), 0, f32(M[14] - z)]", "const d = [f32(x - M[12]), 0, f32(z - M[14])]"],
    // worker 0230: the lent status's per-frame update in frame() (FUN_003159b8 -> FUN_00376938) and handBack's +0x1558 bit 44 gate
    lent: ["    this.lentUpdate();                                                  // the statuses' update", "    // lentUpdate off"],
    running: ["if (!obj || !this.running) return false;", "if (!obj) return false;"],
    // worker 0240: the battle() before the stage init (no stage object yet) runs the pass too; or no pass at all
    stageobj: ["if (!this.stageObj) this.log.push(", "if (false) this.log.push("],
    nopass: ["else if (this.o.stagePass) this.o.stagePass();", "else if (false) this.o.stagePass();"],
    bname: ["return block(() => R.frameNo > f0, () => { const a = R.actors.get(id); if (a) { a.tag = str(s).slice(0, 8); log('battlename ' + id + ' ' + a.tag); } });",
            "const a = R.actors.get(id); if (a) { a.tag = str(s).slice(0, 8); log('battlename ' + id + ' ' + a.tag); } return undefined;"],
  }[MUT];
  if (!sub || !s.includes(sub[0])) throw new Error('mutant ' + MUT + ': anchor not found');
  s = s.replace(sub[0], sub[1]).replaceAll("from './", "from '" + HERE + '/');
  modPath = path.join(process.env.TMPDIR || '/tmp', 'stage_controller_mut_' + MUT + '.mjs');
  fs.writeFileSync(modPath, s);
}
const { createStageController } = await import(modPath);
const { AreaStream } = await import('./area_stream.js');

let fails = 0, oks = 0;
const ok = (c, m) => { if (c) oks++; else { fails++; console.log('FAIL ' + m); } };
const dataPath = path.join(HERE, 'data/event/ev0100_stage.json');
if (!fs.existsSync(dataPath)) { console.log('SKIP: no data/event/ev0100_stage.json (tools/byo/build_web.sh step stage)'); process.exit(0); }
const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

function make(flagsRef, extra = {}) {
  const stream = new AreaStream([], [1, 2]);
  const calls = [];
  const warns = [];
  const c = createStageController({
    data, warn: (m) => warns.push(m), flags: () => flagsRef.v, stream: () => stream,
    music: () => ({ playMusic3: (n, v, f) => calls.push(['music3', n, v, f]), changeMusicVol: (v, t) => calls.push(['musicvol', v, t]), stopMusic: () => calls.push(['stopmusic']) }),
    area: () => ({ play: (n, v) => calls.push(['area', n, v]), stop: () => calls.push(['areastop']) }),
    onSceneSave: (n) => calls.push(['scene_save', n]),
    ...extra,
  });
  return { c, stream, calls, warns };
}
const run = (S, n, each) => { for (let f = 0; f < n && !S.c.done; f++) { if (each) each(f); S.stream.progress(); S.c.tick(20); } };
const gf = (c) => Object.fromEntries([...c.globalFlags].map((v, i) => [i, v]).filter(([, v]) => v));

// 1. from the hand-off (the checkpoint's stage flags {}): main's prelude, first_event played by intro.js, battle
{
  const F = { v: {} };
  const S = make(F);
  run(S, 60);
  ok(JSON.stringify(gf(S.c)) === '{"0":1,"1":3}', 'hand-off: global flags ' + JSON.stringify(gf(S.c)) + ' (the save: {0: 1, 1: 3})');
  ok(S.c.battle, 'hand-off: battle mode (bit 37, as the save)');
  ok(S.c.rt.log.some(([, m]) => m === 'played elsewhere ev0101.first_event()V'), 'first_event left to intro.js');
  ok(!S.c.rt.log.some(([, m]) => m === 'skip ' + 'x') && S.c.rt.skip === 0, 'no skip at the hand-off (first_event not skipped)');
  ok(S.c.rt.log.some(([, m]) => m.startsWith('area asj_033 127')), 'playBgAreaSound("asj_033") -> 127 (the wrapper\'s bipush 127)');
  ok(!S.calls.some(c => c[0] === 'area'), 'the prelude\'s asj_033 is not replayed after the opening (T w222_snd: the game plays it before; scr001\'s asj_036 replaces it)');
  ok(!S.c.done && /ev0100\.(main|deb_jump)/.test(S.c.rt.vm.where()), 'main polls in its battle loop (preempted, not ended): ' + S.c.rt.vm.where());
  // 2. a Restart replaces the world: main reads the new world's flags
  F.v = { 0: 2, 63: 6 };
  run(S, 40);
  ok(S.c.rt.vm.calls.includes('ev0101.rv_matiawase'), 'new world flag 0 = 2 -> rv_matiawase runs');
}

// 1b. the opening skipped (worker 0222: +0x156c = 2 at the hand-off): main's isSkip() after first_event -> kalm_ld(100)
{
  const S1 = make({ v: {} }, { skip: 2 });
  run(S1, 30);
  ok(S1.c.rt.log.some(([, m]) => /^isSkip 1 ev0100\.main pc 75\d/.test(m)), 'skipped opening: isSkip() 1 after first_event');
  ok(S1.c.rt.vm.calls.includes('ev0100.kalm_ld'), 'skipped opening: kalm_ld(100) runs');
  ok(S1.c.battle && S1.c.rt.skip === 0, 'skipped opening: battle() clears +0x156c');
  const S0 = make({ v: {} });
  run(S0, 30);
  ok(!S0.c.rt.vm.calls.includes('ev0100.kalm_ld'), 'played opening: no kalm_ld');
}

// 1c. with the opening (play.js startStage(true)): main's prelude runs in the opening's first frames, first_event waits
// for the hand-off; the global flags during the opening = the game's (T w210 state_1: {0: 1, 1: 3, 13: 64})
{
  let done = false, oskip = 0;
  const bits = new Set();
  const gsx = { set: n => bits.add(n), clear: n => bits.delete(n), test: n => (bits.has(n) ? 1 : 0) };
  const S3 = make({ v: {} }, { openingDone: () => done, openingSkip: () => oskip, gameState: () => gsx });
  run(S3, 40);
  ok(JSON.stringify(gf(S3.c)) === '{"0":1,"1":3,"13":64}', 'during the opening: global flags ' + JSON.stringify(gf(S3.c)));
  ok(!S3.c.rt.log.some(([, m]) => m.startsWith('played elsewhere')), 'first_event waits until the hand-off');
  ok(bits.has(11) && bits.has(6), 'prelude usercontrol(0): game-state bits 11 and 6 (FUN_00325b60 / FUN_0037def0)');
  done = true; oskip = 2;
  run(S3, 20);
  ok(S3.c.rt.vm.calls.includes('ev0100.kalm_ld'), 'hand-off with the opening skipped (+0x156c 2): kalm_ld(100)');
  ok(S3.c.battle && S3.c.rt.skip === 0 && !bits.has(11) && !bits.has(6), 'then usercontrol on, battle: bits 11 / 6 clear, skip 0');
  // event mode pauses the AI (FUN_0037e048 -> FUN_0037def0(ev, 1)); peace / chaos count (FUN_003809a8)
  const N = S3.c.rt.vm.natives;
  N['fake/KerberosZone.event2()V'](S3.c.rt.vm, []);
  ok(bits.has(6) && bits.has(2), 'Zone.event(): bits 6 and 2');
  N['fake/KerberosZone.peace()V'](S3.c.rt.vm, []); N['fake/KerberosZone.peace()V'](S3.c.rt.vm, []);
  N['fake/KerberosZone.chaos()V'](S3.c.rt.vm, []);
  ok(bits.has(10), 'peace x2, chaos x1: bit 10 still on (the count)');
  N['fake/KerberosZone.chaos()V'](S3.c.rt.vm, []);
  ok(!bits.has(10), 'chaos x2: bit 10 off');
  // the stage-info card holds Skip off (FUN_003fdb48 / FUN_003fdd58)
  let up = true;
  const S4 = make({ v: {} }, { stageInfo: () => ({ display: () => {}, isDisplay: () => up }) });
  run(S4, 10);
  S4.c.rt.battle = false;
  N.call; S4.c.rt.vm.natives['fake/KerberosEvent.displayStageInfo_l(ILjava/lang/String;)V'](S4.c.rt.vm, [6, 'x']);
  ok(!S4.c.rt.skippable(), 'card up: no Skip (DAT_004f3044 0x2000)');
  up = false; S4.c.rt.cardStep();
  ok(S4.c.rt.skippable(), 'card down: Skip again (the bit was clear before)');
  S4.c.rt.skip = 2;
  ok(S4.c.rt.requestSkip() === false && S4.c.rt.skip === 2, 'requestSkip: event_rt.js guard (+0x156c != 0)');
}
// 1d. autoSkip off (?autoskip=0): rv_matiawase plays out (its sleeps run their time)
{
  const F = { v: { 2: 7, 46: 1 } };
  const S5 = make(F, { autoSkip: false });
  run(S5, 10); F.v[0] = 2; F.v[63] = 6;
  run(S5, 120);
  ok(!S5.c.rt.log.some(([, m]) => m.startsWith('skip ')) && !S5.c.battle, 'autoskip off: no Skip, still in the event after 120 frames');
}

// 2b. deb_jump's help box (the x -1186 message): stage flag 2 == 7 and flag 46 < 1 -> peace, flag 46 = 1, global
// flag 55 = 7, the box, chaos. The save / every trace has stage flags {2: 7, 46: 1} and global 55 = 7 after it.
{
  const F = { v: { 2: 7 } };
  const S2 = make(F);
  run(S2, 30);
  ok(F.v[46] === 1, 'deb_jump: Zone.setflag(46, 1) into the world\'s flags: ' + JSON.stringify(F.v));
  ok(S2.c.globalFlags[55] === 7, 'deb_jump: global flag 55 = 7');
  const L2 = S2.c.rt.log.map(([, m]) => m);
  ok(L2.indexOf('peace') >= 0 && L2.indexOf('chaos') > L2.indexOf('peace'), 'deb_jump: peace then chaos around the box');
  ok(L2.filter(m => m === 'zflag 46 = 1').length === 1, 'deb_jump: the box once (flag 46 now 1)');
}

// 3. the beat: start deck cleared (zone flag 0 = 2, 63 = 6: script 88) -> rv_matiawase skipped -> chunks (2, 3)
{
  const F = { v: { 2: 7, 46: 1 } };
  const B = make(F);
  run(B, 20);
  F.v[0] = 2; F.v[63] = 6;
  const f0 = B.c.rt.frameNo;
  let skipAt = -1, skip2At = -1, eventAt = -1, backAt = -1;
  const n0 = B.calls.length;
  run(B, 400, () => {
    if (backAt < 0 && B.c.rt.log.some(([f, m]) => f > f0 && m.startsWith('battle '))) backAt = B.c.rt.frameNo;
    if (skipAt < 0 && B.c.rt.skip === 1) skipAt = B.c.rt.frameNo;
    if (skip2At < 0 && B.c.rt.skip === 2) skip2At = B.c.rt.frameNo;
  });
  const L = B.c.rt.log.filter(([f]) => f > f0);
  eventAt = (L.find(([, m]) => m === 'event 0') || [-1])[0];
  const sk = L.find(([, m]) => m.startsWith('skip '));
  ok(sk && /ev0101\.rv_matiawase/.test(sk[1]), 'Skip taken inside rv_matiawase: ' + (sk && sk[1]));
  ok(eventAt > 0 && sk && sk[0] >= eventAt, 'Skip only after Zone.event() (FUN_003dfd18: bit 37 clear)');
  ok(skipAt > 0 && skip2At === skipAt + 1, '+0x156c 1 -> 2 on the next frame (FUN_00377c68\'s tail; T w219_skip f961 -> f962)');
  ok(JSON.stringify(gf(B.c)) === '{"0":1,"1":5}', 'after the beat: global flags ' + JSON.stringify(gf(B.c)));
  ok(L.some(([, m]) => m === 'gflag 18 = 1') && L.some(([, m]) => m === 'gflag 18 = 0'), 'global flag 18 = 1 then 0 around scene_save');
  ok(B.stream.slotChunk(1) === 3 || B.stream.slotChunk(2) === 3, 'chunk 3 streamed (load(128, 2, 3) -> FUN_002677a0)');
  ok(B.c.battle && B.c.rt.skip === 0, 'back in battle mode, skip cleared (FUN_0037cf30)');
  ok(backAt > 0 && backAt - f0 < 60, 'the skipped beat is back in battle in under 60 frames: ' + (backAt - f0));
  ok(!B.calls.some(c => c[0] === 'music3'), 'no music change in the beat (bgm_001 continues; T: no FUN_003ec500 / FUN_003ec560)');
  // the page's natives in order vs the game's call log
  const page = B.calls.slice(n0).filter(c => ['musicvol', 'area', 'scene_save', 'music3'].includes(c[0])).map(c => c.join(' '));
  const zoneOrder = L.filter(([, m]) => /^zone |^event |^scene_save|^musicvol|^area /.test(m)).map(([, m]) => m.split(' ')[0]);
  ok(JSON.stringify(zoneOrder) === JSON.stringify(['musicvol', 'zone', 'event', 'area', 'scene_save', 'musicvol']), 'page order ' + zoneOrder.join(' '));
  // 4. against the game (PCSX2 w219_beat: unskipped, w219_skip: Start + cross at f920 / f960)
  const keysP = path.join(OUT, 'w219_keys.json');
  for (const name of ['w219_beat', 'w219_skip']) {
    const tp = path.join(OUT, name + '.jsonl'), cp = path.join(OUT, name + '.calls.jsonl');
    if (!fs.existsSync(tp) || !fs.existsSync(cp) || !fs.existsSync(keysP)) { console.log('SKIP trace ' + name + ' (not in tools/trace/out)'); continue; }
    const K = JSON.parse(fs.readFileSync(keysP, 'utf8'));
    const gk = Buffer.from(K.global_key, 'hex'), zk = Buffer.from(K.zone_key, 'hex');
    const dec = (h, k) => { const b = Buffer.from(h, 'hex'), o = {}; b.forEach((x, i) => { if (x ^ k[i]) o[i] = x ^ k[i]; }); return o; };
    const recs = fs.readFileSync(tp, 'utf8').trim().split('\n').map(l => JSON.parse(l)).filter(r => !r.meta);
    const gcalls = fs.readFileSync(cp, 'utf8').trim().split('\n').map(l => JSON.parse(l)).filter(r => !r.meta);
    const first = recs[0], last = recs[recs.length - 1];
    const g0 = dec(first.gflags, gk), z0 = dec(first.zflags, zk), g1 = dec(last.gflags, gk), z1 = dec(last.zflags, zk);
    delete g0[55]; delete g1[55];                            // flag 55: deb_jump's help box on the route (worker 0220's)
    ok(JSON.stringify(g0) === '{"0":1,"1":3}', name + ': game global flags before ' + JSON.stringify(g0));
    ok(JSON.stringify(z0) === '{"2":7,"46":1}', name + ': game stage flags before ' + JSON.stringify(z0));
    ok(JSON.stringify(g1) === JSON.stringify(gf(B.c)), name + ': global flags after: game ' + JSON.stringify(g1) + ' page ' + JSON.stringify(gf(B.c)));
    ok(JSON.stringify(z1) === JSON.stringify(Object.fromEntries(Object.entries(F.v).map(([k, v]) => [k, v]))), name + ': stage flags after: game ' + JSON.stringify(z1) + ' page ' + JSON.stringify(F.v));
    ok(recs.some(r => dec(r.gflags, gk)[18] === 1), name + ': the game sets global flag 18 = 1 too');
    // the music / area / mode / zone / save calls in order
    const gseq = gcalls.filter(c => c.hook !== 'skip').map(c => c.hook === 'zone_req' ? 'zone_req ' + c.a0 + ',' + c.a1
      : c.hook === 'musicvol' ? 'musicvol ' + c.a0 + ' ' + c.a1 : c.hook === 'scene_save' ? 'scene_save ' + c.a1
      : c.hook === 'area' ? 'area ' + Buffer.from(c['a0+0x0'].u.map(x => { const b = Buffer.alloc(4); b.writeUInt32LE(parseInt(x, 16)); return b; }).reduce((a, b) => Buffer.concat([a, b]))).toString('latin1').replace(/\0.*$/s, '') + ' ' + c.a1
      : c.hook);
    const zr = B.c.rt.log.filter(([, m]) => m.startsWith('zone ')).length;
    const pseq = L.filter(([, m]) => /^zone |^event |^scene_save|^musicvol|^area |^music /.test(m)).flatMap(([, m]) => {
      const w = m.split(' ');
      if (w[0] === 'zone') { const [, a, b] = w[1].split(','); return ['zone_req ' + a + ',' + b, 'zone_req ' + a + ',' + b]; }   // FUN_00381518 calls FUN_002677a0 twice
      if (w[0] === 'event') return ['event2'];
      return [m];
    });
    ok(zr === 1, 'one Zone.load in the beat');
    ok(JSON.stringify(gseq) === JSON.stringify(pseq), name + ': calls\n   game ' + gseq.join(' | ') + '\n   page ' + pseq.join(' | '));
    if (name === 'w219_skip') {
      const sc = gcalls.find(c => c.hook === 'skip'), ev = gcalls.find(c => c.hook === 'event2');
      ok(sc && ev && sc.frame > ev.frame, 'game: Skip (FUN_00372f70) after event mode');
      const r1 = recs.find(r => r.ev_skip === 1), r2 = recs.find(r => r.ev_skip === 2);
      ok(r1 && r2 && r2.frame === r1.frame + 1, 'game: +0x156c 1 -> 2 the next frame');
    }
  }
}

// 5. worker 0229: the battle actors and the hand-back by name (notes/stage-controller.md "Battle actors"). Stand-in objects
// for the page's (play.js battleObject): Vincent (p_Vin, record 0) and the townspeople n_CupM / n_CupW (records 113 / 114).
// From the save's flags: stage flag 0 = 2 (rv_matiawase: main's p000 slot named p_Vin, battle(1500)), then 1 = 5 (pc 0x849:
// getbattleactor x3, roji02_01 skipped, setpos / setdir, Camera.set, setbattlename p_Vin, battle()).
{
  const ev = [];
  const mk = (tag, pos, face) => ({ tag, pos, face, lent: 0, shown: true,
    matrix() { return [-this.face[2], 0, this.face[0], 0, 0, -1, 0, 0, -this.face[0], 0, -this.face[2], 0, ...this.pos, 1]; },
    lend() { this.lent++; ev.push(['lend', tag]); }, release() { this.lent = 0; this.shown = true; ev.push(['release', tag]); },
    show(v) { this.shown = v; ev.push(['show', tag, v]); }, place(p, f) { this.pos = p.slice(); this.face = f.slice(); ev.push(['place', tag, p.slice(), f.slice()]); } });
  const objs = { p_Vin: mk('p_Vin', [-1000, 0, -1080], [1, 0, 0]), n_CupM: mk('n_CupM', [-1081.11, -0.01, -1280.13], [-0.411, 0, 0.911]), n_CupW: mk('n_CupW', [-1074.37, -0.13, -1274.05], [0.684, 0, 0.729]) };
  const F = { v: { 2: 7, 46: 1 } };
  const B = make(F, { battleObject: (n) => objs[n] || null, cameraReset: (v) => ev.push(['camreset', v ? { eye: v.eye.slice(), aim: v.aim.slice() } : null]) });
  const L = () => B.c.rt.log.map(([, m]) => m);
  run(B, 10); F.v[0] = 2;
  run(B, 120, () => {});
  const p1 = ev.filter(e => e[0] === 'place');
  ok(p1.length === 1 && p1[0][1] === 'p_Vin' && p1[0][2].every((v, i) => v === Math.fround([-889.2, 0, -599][i])) && p1[0][3].join() === '-1,0,0',
     'rv_matiawase: the p000 slot named p_Vin hands Vincent (-889.2, 0, -599) facing -x at battle(1500) (T w229_rescue_pos f1850): ' + JSON.stringify(p1[0]));
  const lb = L().findIndex(m => m.startsWith('handback p_Vin -889')), bt = L().findIndex(m => m === 'battle 1500');
  ok(lb >= 0 && bt > lb, 'FUN_00319190 runs inside battle(1500) (the handback is logged with it, before the mode)');
  ev.length = 0; F.v[1] = 5; const n0 = B.c.rt.log.length;
  let held = null, hidden = null;
  run(B, 120, () => { if (held === null && objs.p_Vin.lent) held = B.c.rt.frameNo; if (hidden === null && ev.some(e => e[0] === 'show' && e[1] === 'n_CupM' && e[2] === false)) hidden = true; });
  const gba = L().slice(n0).filter(m => m.startsWith('getbattleactor')).map(m => m.split(' ')[2]);
  ok(gba.join() === 'p_Vin,n_CupM,n_CupW', 'the rescue takes p_Vin / n_CupM / n_CupW as battle actors (FUN_00376b00): ' + gba.join());
  ok(hidden === true, 'setVisible(false) hides the lent townspeople (the slot draws their own model)');
  const pl = ev.filter(e => e[0] === 'place');
  const want = [Math.fround(-1120.2), 0, Math.fround(-1277.3)];
  ok(pl.length === 1 && pl[0][2].every((v, i) => v === want[i]), 'Vincent placed at setpos (-1120.2, 0, -1277.3) exactly (T record 2126 x / z = the same floats): ' + JSON.stringify(pl[0] && pl[0][2]));
  ok(pl.length === 1 && Math.abs(pl[0][3][0] - 0.9889416694641113) < 1e-6 && Math.abs(pl[0][3][2] + 0.1483050286769867) < 1e-6 && pl[0][3][1] === 0,
     'setdir toward (-1118.2, 0, -1277.6): facing (0.98894, 0, -0.14831) (T record 2126 C row 2): ' + JSON.stringify(pl[0] && pl[0][3]));
  const iPlace = ev.findIndex(e => e[0] === 'place'), iCam = ev.findIndex(e => e[0] === 'camreset' && e[1]);
  // main: Camera.active (logged 'camera 0') then setbattlename at once (pc 0x963 / 0x96a)
  const bi = B.c.rt.log.findIndex(([, m], i) => i >= n0 && m.startsWith('battlename ')), ca = B.c.rt.log.slice(0, bi).map(([f, m]) => [f, m]).filter(([, m]) => m === 'camera 0').at(-1);
  ok(bi > 0 && ca && B.c.rt.log[bi][0] === ca[0] + 1, 'setbattlename waits a frame (FUN_0037e4e0) before writing +0xa5: camera f' + (ca && ca[0]) + ', name f' + (bi > 0 && B.c.rt.log[bi][0]));
  const cr = ev[iCam];
  ok(iCam > iPlace && cr && cr[1] && cr[1].eye.join() === [-1135.5, -31.8, -1275.0999755859375].map(Math.fround).join() && cr[1].aim.join() === [-1134.75, -31.15999984741211, -1275.2049560546875].map(Math.fround).join(),
     'battle()\'s camera reset after the placement, from main\'s Camera.set view (eye (-1135.5, -31.8, -1275.1), aim (-1134.75, -31.16, -1275.205)): ' + JSON.stringify(cr && cr[1]));
  if (cr && cr[1]) { const d = cr[1].aim.map((v, i) => v - cr[1].eye[i]), n = Math.hypot(...d);
    ok([0.7564113140106201, 0.6454702615737915, -0.1058778241276741].every((v, i) => Math.abs(d[i] / n - v) < 1e-6), 'its forward = the game\'s CAM+0x80 after the beat (T record 2126): ' + d.map(v => (v / n).toFixed(6))); }
  ok(objs.n_CupM.lent === 0 && objs.n_CupW.lent === 0 && objs.n_CupM.shown && L().filter(m => / freed$/.test(m)).length === 2,
     'unnamed battle actors are finalized at battle() (FUN_00376c80(.., 1): their models freed, the objects draw a new one)');
  ok(!objs.n_CupM.pos.some((v, i) => v !== [-1081.11, -0.01, -1280.13][i]), 'the townspeople are not moved by main (no setbattlename for them)');
  // the trace (PCSX2 w229_rescue_pos, TRACE_FIELDSET=enemy: Vincent's C matrix)
  const tp = path.join(OUT, 'w229_rescue_pos.jsonl');
  if (fs.existsSync(tp)) {
    const R = Object.fromEntries(fs.readFileSync(tp, 'utf8').trim().split('\n').slice(1).map(l => JSON.parse(l)).map(r => [r.frame, r]));
    const m1 = R[1850] && R[1850].matrix, m2 = R[2126] && R[2126].matrix, m0 = R[2125] && R[2125].matrix;
    ok(m1 && m1[3][0] === Math.fround(-889.2) && m1[3][2] === -599 && m1[2][0] === -1, 'T f1850: Vincent at the p000 slot (-889.2, -599) facing -x');
    ok(m0 && pl[0] && m0[3][0] !== m2[3][0] && m2[3][0] === pl[0][2][0] && m2[3][2] === pl[0][2][2] && Math.abs(m2[2][0] - pl[0][3][0]) < 1e-6 && Math.abs(m2[2][2] - pl[0][3][2]) < 1e-6,
       'T record 2126: the game\'s Vincent = the page\'s placement (x / z exact, facing < 1e-6)');
    const cf = R[2126].cam_fwd;
    ok(cf && Math.abs(cf[0] - 0.7564113140106201) < 1e-6, 'T record 2126: CAM+0x80 forward = main\'s event camera');
  } else console.log('SKIP the w229 trace checks (tools/trace/out/w229_rescue_pos.jsonl: tools/trace/scripts/w229_rescue_pos.json)');
}

// 6. worker 0230 (the manager's review of 0229's guards): a slot lending p_Vin's model and a second slot named p_Vin: the next
// frame's lentUpdate (FUN_003159b8 -> FUN_00376938) hands Vincent back to the named slot's place without a battle(); with the
// event program not running (+0x1558 bit 44 clear) handBack does nothing
{
  const ev = [];
  const vin = { tag: 'p_Vin', matrix: () => [0, 0, 1, 0, 0, -1, 0, 0, -1, 0, 0, 0, -1000, 0, -1080, 1], lend() {}, show() {},
    release() { ev.push(['release']); }, place(p, f) { ev.push(['place', p.slice(), f.slice()]); } };
  const M = [0, 0, 1, 0, 0, -1, 0, 0, -1, 0, 0, 0, -900, 0, -600, 1];       // row 2 (-1, 0, 0) -> facing (1, 0, 0)
  const B = make({ v: { 2: 7, 46: 1 } }, { battleObject: n => (n === 'p_Vin' ? vin : null) });
  const rt = B.c.rt;
  const lender = { id: 90, tag: null, lent: vin, M: vin.matrix() }, named = { id: 91, tag: 'p_Vin', lent: null, M };
  rt.actors.slots.push(lender, named);
  rt.running = false;
  ok(rt.handBack(named) === false && !ev.length && rt.actors.slots.includes(named), 'handBack with the event program off (+0x1558 bit 44 clear): nothing (the slot stays, no place)');
  rt.running = true;
  rt.frame(20);
  const pl = ev.find(e => e[0] === 'place');
  ok(pl && pl[1].join() === '-900,0,-600' && pl[2].join() === '1,0,0' && !rt.actors.slots.includes(named),
     'frame(): lentUpdate hands the lent p_Vin back to the named slot\'s place (-900, 0, -600) facing +x, no battle(): ' + JSON.stringify(pl));
}

// 7. worker 0240: battle()'s FUN_00324e70 -> FUN_005453b0 (opts.stagePass: the stage-load pass, event 0x23). A new controller
// is a stage (re)load: main's battle() after first_event comes before the stage init (DAT_0046e290 == 0, T w240_init f2264)
// and sends nothing; every later battle() runs the pass (T w240_boss: f1373)
{
  let n = 0;
  const A = make({ v: {} }, { stagePass: () => n++ });                     // from the save: settled through that battle
  ok(n === 0 && A.c.rt.stageObj && A.c.rt.log.some(([, m]) => m === 'battle: no stage object yet (FUN_00324e70: nothing)'),
     `settle: the battle() after first_event sends no stage pass (${n})`);
  A.c.rt.enterBattle(0);
  ok(n === 1, `the next battle(): the stage pass (${n})`);
  let done = false, m = 0;
  const O = make({ v: {} }, { openingDone: () => done, stagePass: () => m++ });
  run(O, 30); done = true; run(O, 20);
  ok(O.c.battle && m === 0 && O.c.rt.log.some(([, x]) => x.startsWith('battle ')), `with the opening: the hand-off's battle() sends none either (${m})`);
  O.c.rt.enterBattle(0); O.c.rt.enterBattle(0);
  ok(m === 2, `later battles: one pass each (${m})`);
}

console.log((fails ? 'FAILED ' : 'ok ') + oks + ' / ' + (oks + fails) + (MUT ? ' (mutant ' + MUT + ')' : ''));
process.exit(fails ? 1 : 0);
