// test_stage_controller.mjs -- ev0100 main on the page's stage controller (worker 0219; notes/stage-controller.md).
//   node --import ./native/web/test_hooks.mjs native/web/test_stage_controller.mjs
// Needs data/event/ev0100_stage.json (build step stage). The trace checks need tools/trace/out/w219_beat / w219_skip
// (.jsonl + .calls.jsonl, TRACE_FIELDSET=stage TRACE_CALLLOG=stage) and w219_keys.json (tools/trace/stage_keys.py);
// without them those checks are skipped (reported).
// MUTATE=getflag|setflag|skip|sleep|preempt|opening|skipinit|bit6|card|wait runs one mutant of stage_controller.js (a scratch copy) and expects a failure.
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

console.log((fails ? 'FAILED ' : 'ok ') + oks + ' / ' + (oks + fails) + (MUT ? ' (mutant ' + MUT + ')' : ''));
process.exit(fails ? 1 : 0);
