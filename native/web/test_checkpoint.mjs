// Restart -> the checkpoint (checkpoint.js, worker 0201).
//   node --import ./native/web/test_hooks.mjs native/web/test_checkpoint.mjs
// Needs data/z128_collision.bin + data/enemies/ai.json (else SKIP). With tools/trace/out/w201_reload.jsonl
// (TRACE_FIELDSET=enemy TRACE_ERECS=44,66, from the state saved at the stage reload after game over -> Restart)
// it checks the restored state and the first 100 frames after it against the game.
import { readFileSync, existsSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const OUT = process.env.TRACE_OUT ?? path.join(root, 'tools/trace/out');
const imp = f => import(pathToFileURL(path.join(here, f)).href);
const PL = await imp('player.js');
const { Collision } = await imp('collision.js');
const { CHECKPOINT, PLAYER_STAMPS, checkpointHeading, restoreCheckpoint } = await imp('checkpoint.js');
const { GameOver, mergeData } = await imp('gameover.js');
let fail = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };
const done = () => { console.log(fail ? `${fail} FAILED` : 'all ok'); process.exit(fail ? 1 : 0); };
const warns = []; console.warn = m => warns.push(String(m));
const colPath = path.join(here, 'data/z128_collision.bin'), aiPath = path.join(here, 'data/enemies/ai.json');
if (!existsSync(colPath) || !existsSync(aiPath)) { console.log('SKIP: data/z128_collision.bin or data/enemies/ai.json missing'); done(); }
const cbuf = readFileSync(colPath), col = new Collision(cbuf.buffer.slice(cbuf.byteOffset, cbuf.byteOffset + cbuf.byteLength));
const AIdata = JSON.parse(readFileSync(aiPath, 'utf8'));
const AI = await imp('enemy_ai.js');
const dp = path.join(here, 'data/pause.json'), dg = path.join(here, 'data/gameover.json');
if (!existsSync(dp) || !existsSync(dg)) { console.log('SKIP: data/pause.json / data/gameover.json missing'); done(); }
const GD = mergeData(JSON.parse(readFileSync(dp, 'utf8')), JSON.parse(readFileSync(dg, 'utf8')));
const WALK = () => ({ ...IDLE(), x: 1, z: 0, stick: PL.KEY_RUN });
const IDLE = () => ({ x: 0, z: 0, stick: 0, keys: new Set(), pressed: new Set() });
const STEP = 1.2;

// the page's start soldiers (play.js AWAKE / AWAKE_STATE / AWAKE_F118: the save's RAM)
const AWAKE = [44, 45, 46, 47, 48, 49, 66];
const AWAKE_STATE = { 44: 1, 45: 2, 46: 1, 47: 1, 48: 2, 49: 2, 66: 1 };
const AWAKE_F118 = { 44: 0, 45: 0x10000200, 46: 0, 47: 0, 48: 0x200, 49: 0x200, 66: 0 };
// the stage load's statuses (enemies.js loadRecs: placements.json load_flag_records with an event-actor tag, not Vincent)
const PJpath = path.join(here, 'data/enemies/placements.json');
const PJ = existsSync(PJpath) ? JSON.parse(readFileSync(PJpath, 'utf8')) : null;
const LOAD = PJ ? (t => PJ.load_flag_records.filter(r => t.has(r.tag) && r.rec !== 0).map(r => r.rec))(new Set(PJ.event_actors.tags)) : [];
ok(JSON.stringify(LOAD) === '[41,42,43]', `stage-load records ${JSON.stringify(LOAD)} (41-43: bit 3 + e_Sol_11 / 12 / 13)`);
// play.js rebuildEnemies: nothing dead, 44 / 66 (active in the reload state), the stage-load pass, then 45-49
const rebuild = (opts, flags, frame, clock, load = LOAD) => {
  const W = AI.createEnemyAI({ ...opts, eventFlags: flags, deadRecs: [], now: clock.now, acc: clock.acc }); W.S.frame = frame;
  for (const k of [44, 66]) W.addActor({ rec: k, astate: AWAKE_STATE[k], f118: AWAKE_F118[k] });
  W.stageLoad(load);
  for (const k of [45, 46, 47, 48, 49]) W.addActor({ rec: k, astate: AWAKE_STATE[k], f118: AWAKE_F118[k] });
  return W;
};

// a page in miniature: Vincent, his status, the game over, a follow-camera stand-in, the enemy world
function page() {
  const ctrl = new PL.PlayerController(col, { pos: { x: -1395.63, y: -98.64, z: -1110.51 }, heading: 0.9 });
  const php = { pos: [ctrl.pos.x, ctrl.pos.y, ctrl.pos.z], face: [0, 0, 1], hp: 780, id: 0x16, f118: 0x20209, s64: 0 };
  const sounds = [];
  const opts = { data: AIdata, player: php, quiet: true, damage: true, deadRecs: [41, 42, 43], walkMesh: col, sound: n => sounds.push(n), rand: () => 0.1, log: m => warns.push(m) };
  const P = { ctrl, php, opts, sounds, W: null, flagsSeen: null, cam: [], weaponResets: 0, music: 0, hudResets: 0,
              fx: { emitters: [1, 2], resets: 0, reset() { this.emitters.length = 0; this.resets++; } },
              sfx: { pending: [{ name: 'x' }] }, gameOver: new GameOver(GD), cape: { cloth: { started: true } } };
  P.W = AI.createEnemyAI(opts); for (const k of AWAKE) P.W.addActor({ rec: k, astate: AWAKE_STATE[k], f118: AWAKE_F118[k] });
  P.follow = { clearDeath() { P.cam.push('clearDeath'); }, reset(pos, s) { P.cam.push(['reset', { ...pos }, s]); } };
  P.sys = () => ({ ctrl, php, follow: P.follow, gameOver: P.gameOver, cape: P.cape, fx: P.fx,
    groundY: (x, z, y) => col.groundY(x, z, y), weapon: { reset() { P.weaponResets++; } }, music: () => { P.music++; },
    hud: { reset() { P.hudResets++; } }, sfx: P.sfx,
    rebuildEnemies: (flags, frame, clock) => { P.flagsSeen = flags; P.W = rebuild(opts, flags, frame, clock, P.load ?? LOAD); return P.W; } });
  return P;
}

// ------------------------------------------------ game over -> Restart -> restore
{
  const P = page();
  // walk him off and die: HP 0, state 7 (FUN_00560fc8), the game over runs to its request
  for (let i = 0; i < 20; i++) P.ctrl.step(WALK());
  P.ctrl.cSnap = null;
  P.php.hp = 0;
  P.ctrl.hitReact({ flags: 0x42, dir: [-1, 0, 0], deadNow: true });
  ok(P.ctrl.P.state === 7, 'dead: state 7');
  const a44 = P.W.actors.find(a => a.rec === 44); a44.hp = 0; a44.pos[0] += 50;   // a soldier changed before the restart
  P.php.f118 = 0; const spawn0 = { ...P.ctrl.spawn };
  const G = P.gameOver; let t = 0, req = null;
  for (let f = 0; f < 2000 && !req; f++) { t += 20; G.frame(true, STEP, t); if (G.menu && G.seq.mode === 4 && !G.menu.answered) { G.input(0, t); G.menu.answered = true; } req = G.request; }
  ok(req === 'restart', `game over: ✕ on Restart -> request '${req}'`);
  const r = restoreCheckpoint(P.sys());
  const C = CHECKPOINT;
  ok(P.php.hp === 780 && P.php.f118 === 0x20209, `HP ${P.php.hp} (780), P+0x118 ${P.php.f118.toString(16)} (20209)`);
  ok(P.ctrl.pos.x === C.pos.x && P.ctrl.pos.z === C.pos.z && Math.abs(P.ctrl.pos.y - C.pos.y) < 0.005,
     `Vincent at the checkpoint ${[P.ctrl.pos.x, P.ctrl.pos.y, P.ctrl.pos.z].map(v => v.toFixed(3))}`);
  ok(Math.abs(P.ctrl.heading - checkpointHeading()) < 1e-9 && Math.abs(P.ctrl.C.face.z - 1) < 1e-5, `facing ${P.ctrl.C.face.x.toFixed(5)}, ${P.ctrl.C.face.z.toFixed(5)}`);
  ok(JSON.stringify(P.ctrl.spawn) === JSON.stringify(spawn0), 'the page spawn (H) is kept');
  ok(P.ctrl.P.state === 2 && !P.ctrl.active, `state ${P.ctrl.P.state} (2: on foot), no action`);
  ok(P.php.pos[0] === P.ctrl.pos.x && P.php.pos[2] === P.ctrl.pos.z, 'the AI sees him at the checkpoint (php.pos)');
  ok(!G.active && !G.started && G.wm === 2 && !G.pauseBlocked, 'game over reset (world mode 2, the pause free)');
  ok(P.cam[0] === 'clearDeath' && P.cam[1][0] === 'reset' && P.cam[1][2] === undefined, 'camera: the death bits cleared, then reset at the checkpoint with the start angles (GUESS)');
  ok(P.weaponResets === 1 && P.cape.cloth.started === false && P.fx.resets === 1 && P.music === 1, 'weapon reset, cloth restarted, effects reset, music restarted');
  ok(P.hudResets === 1 && P.sfx.pending.length === 0, 'HUD rebuilt, unsent sound requests dropped');
  ok(Object.entries(PLAYER_STAMPS).every(([k, v]) => P.php[k] === v), 'Vincent\'s stamps = the constructor\'s (FUN_00571ee8 / FUN_005596a0 / FUN_0033ff18)');
  // the state saved at the reload (counter 14): P+0x27c -40, +0x280 -15, +0x148 -120, +0x150 / +0x152 0, +0x142 0xff, C+0x810 -15
  ok(JSON.stringify(PLAYER_STAMPS) === JSON.stringify({ t27c: -40, t280: -15, part: -1, s148: -120, s150: 0, s152: 0, sphase: 0, c810: -15 }),
     'PLAYER_STAMPS = the traced reload state (frame counter 0 based)');
  ok(P.W.S.now === 26 && Math.abs(P.W.S.acc - 0.3) < 1e-6, `the new AI clock ${P.W.S.now} + ${P.W.S.acc} (26 at the placement, T)`);
  ok(P.W.S.frame === CHECKPOINT.frame && CHECKPOINT.frame === 24, `the new world's frame counter ${P.W.S.frame} (24: traced 14 at the reload + 10)`);
  ok(JSON.stringify(P.flagsSeen) === '{}', 'event flags: all 0 (FUN_004039d0)');
  const b44 = P.W.actors.find(a => a.rec === 44);
  ok(r.enemies === P.W && b44 && b44 !== a44 && b44.hp > 0 && P.W.actors.length === AWAKE.length + 3, `a new enemy world: ${P.W.actors.length} soldiers, 44 alive again (hp ${b44 && b44.hp})`);
  // 41-43: the stage-load pass (FUN_00558f68 -> FUN_00559748(1, 1) -> script event 3, then the tail's FUN_0055b8e0(3, 1))
  const L = [41, 42, 43].map(k => P.W.actors.find(a => a.rec === k));
  ok(L.every(a => a && a.astate === 3 && (a.flags28 & 1) && !(a.flags28 & 0x100000)), `41-43 active, actor state ${L.map(a => a && a.astate)} (3), event 3 done (+0x28 bit 0x100000 clear)`);
  ok(L.map(a => a.hp).join() === '10,28,24' && L.map(a => a.ai.mode).join() === '0,1,0', `HP ${L.map(a => a.hp)} (10 / 28 / 24), brain mode ${L.map(a => a.ai.mode)} (0 / 1 / 0: 42's event 3 cmd 0x143(1))`);
  ok(L.map(a => a.t3c[1]).join() === '80,0,150' && L.map(a => a.vars[7]).join() === '1,0,1', `script timers ${L.map(a => a.t3c[1])} (80 / 0 / 150: cmd 0x106(1, n)), var 7 ${L.map(a => a.vars[7])}`);
  ok(L.every(a => a.target === P.php), '41-43 target Vincent (cmd 0x193)');
  ok(L.every(a => a.C.f564 & 0x20000000), 'C+0x564 bit 0x20000000 set by the pass (FUN_00558f68)');
  ok(L.map(a => a.ai.rounds).join() === '6,6,-1', `rounds ${L.map(a => a.ai.rounds)} (FUN_00360418(ai, 1) with rand 0.1: 6 + 0, 6 + 0, mag -1 -> 0xffff)`);
  ok(L.every(a => a.pos.every((v, i) => v === AIdata.records[a.rec].pos[i])), '41-43 at their placements (the cutscene hand-off at record 24 is MISSING)');
  ok(!warns.some(w => /41-43.*not activated/.test(w)) && warns.some(w => /stage-load actors stay at their placements/.test(w))
     && warns.some(w => /Status screen/.test(w)) && warns.some(w => /holstered/.test(w)), 'the left-out parts warn (the hand-off, the screens, the gun)');
  // play resumes: he walks
  P.W.tick(STEP, [P.ctrl.pos.x, P.ctrl.pos.y, P.ctrl.pos.z], [P.ctrl.pos.x, P.ctrl.pos.y, P.ctrl.pos.z]);
  ok(L.every(a => !(a.C.f564 & 0x20000000) && a.C.blendLen === 0), `their first clip after the pass: blend ${L.map(a => a.C.blendLen)} (FUN_00312678 = 0), bit 0x20000000 cleared (FUN_00344608)`);
  const x0 = P.ctrl.pos.x; for (let i = 0; i < 10; i++) P.ctrl.step(WALK());
  ok(P.ctrl.pos.x > x0 + 1, `play resumes: he walks (${(P.ctrl.pos.x - x0).toFixed(2)} u in 10 frames)`);
}

// ------------------------------------------------ cmd 0x106 / 0x107 (FUN_0054cd70) and the timer list (FUN_0053e868)
{
  const P = page(), W = P.W, o = W.objects.get(41 + 22);              // an inactive record object (timers live on any object; script 105 has an event 1)
  W.t.send(o, -2, 0x106, [0, 5, 0, 0]); W.t.send(o, -2, 0x106, [1, 3, 0, 0]);
  ok(W.timerList.length === 1 && W.timerList[0] === o.id && W.t.send(o, -2, 0x107, [0]) === 5 && W.t.send(o, -2, 0x107, [1]) === 3, 'cmd 0x106: both timers set, the object listed once; 0x107 reads them');
  W.t.send(o, -2, 0x106, [0, 9, 0, 0]);
  ok(o.t3c[0] === 9 && W.timerList.length === 1, `a running timer is set again (${o.t3c[0]}: 9), still listed once`);
  W.t.send(o, -2, 0x106, [1, 0, 0, 0]);
  ok(W.timerList.length === 1 && o.t3c[1] === 0, 'r1 < 1 stops timer 1; timer 0 still runs: listed');
  W.t.send(o, -2, 0x106, [0, -4, 0, 0]);
  ok(W.timerList.length === 0 && o.t3c[0] === 0, 'both stopped: unlinked (FUN_0053e7a8)');
  W.t.send(o, -2, 0x106, [2, 9, 0, 0]);
  ok(W.timerList.length === 0, 'timer 2: ignored (r0 < 2 only)');
  // step 2.4 counts 2 a frame; at <= 0 manager event 0xd -> script event 1 (r0 = the timer), and the entry goes
  W.t.send(o, -2, 0x106, [1, 3, 0, 0]);
  W.tick(2.4, null, null); ok(o.t3c[1] === 1 && W.timerList.length === 1, `step 2.4: timer 3 -> ${o.t3c[1]} (1)`);
  W.tick(2.4, null, null);
  // the entry goes only when the int at +0x3c is 0: a timer left at -1 keeps it listed (and never counts again)
  ok(o.t3c[1] === -1 && W.timerList.length === 1 && W.events.some(e => e === `event ${o.id} script ${o.script} ev 1 r 1,0,0,0`), `timer at ${o.t3c[1]}: event 1 (r0 1) posted and run, the entry stays (+0x3c int != 0)`);
  W.tick(2.4, null, null);
  ok(!W.events.some(e => /ev 1 /.test(e)), 'a timer below 0 posts nothing more');
  const o2 = W.objects.get(43 + 22);
  W.t.send(o2, -2, 0x106, [0, 2, 0, 0]); W.tick(STEP, null, null); W.tick(STEP, null, null);
  ok(o2.t3c[0] === 0 && !W.timerList.includes(o2.id) && W.events.some(e => e === `event ${o2.id} script ${o2.script} ev 1 r 0,0,0,0`), 'step 1.2: timer 0 counts 2 -> 0, event 1 (r0 0), the entry goes');
  // the record object and the activated actor are one object in the game: a timer set before the activation runs on
  const r50 = W.objects.get(50 + 22);
  W.t.send(r50, -2, 0x106, [1, 7, 0, 0]); W.setActive(r50, 1);
  const a50 = W.objects.get(50 + 22);
  ok(a50.kind === 'actor' && a50.t3c[1] === 7 && W.timerList.includes(a50.id), `a timer set on record 50 before its activation runs on in the actor (${a50.t3c[1]})`);
}
// the stage-load pass on an already-active loaded record (not on the page's Restart: its world is new): no +0x144 (no event
// 3 again), the tail's writes, no state change (FUN_00558f68 with bVar1 false, +0x118 bit 16 clear)
{
  const P = page(), W = AI.createEnemyAI({ ...P.opts, deadRecs: [], eventFlags: {} });
  const a = W.addActor({ rec: 41, astate: 1, f118: 0 });
  W.stageLoad([41]);
  ok(a.astate === 1 && a.vars[7] === 0 && W.timerList.length === 0 && (a.C.f564 & 0x20000000) && (a.C.f1c0 & 0x200) && a.C.speed === 0,
     `already active: state ${a.astate} kept (1), no event 3 (var 7 ${a.vars[7]}, timers ${W.timerList.length}), C+0x564 / +0x1c0 bits set, C+0x1d8 0`);
}

// ------------------------------------------------ the camera: a Restart from the ladder (FUN_00328368 on the real FollowCamera)
{
  const P = page(), cam = new PL.FollowCamera(null, null);
  cam.reset(P.ctrl.pos); cam.setBack(true); cam.back = cam.backTarget; cam.gain = 0.7; cam.idle = 30;   // on the ladder: pulled back 4 u
  ok(cam.back > 3.9, `on the ladder: CAM+0x1c4 ${cam.back}`);
  restoreCheckpoint({ ...P.sys(), follow: cam });
  ok(cam.back === 0 && cam.backTarget === 0 && cam.gain === 0 && cam.idle === -20,
     `ladder -> Restart: pull-back ${cam.back} / ${cam.backTarget} (0), gain ${cam.gain}, CAM+0x1e2 ${cam.idle} (-20)`);
  ok(!cam.death && cam.base[0] === P.ctrl.pos.x && cam.base[2] === P.ctrl.pos.z, 'the camera is on him at the checkpoint, no death view');
}

// ------------------------------------------------ the effects: a Restart during a live 0x1000 flash and a wall impact (real manager)
{
  const FXM = await imp('effects.js');
  const dir = path.join(here, 'data/effects'), rd = f => { const b = readFileSync(path.join(dir, f)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
  if (!existsSync(path.join(dir, 'r0001.fed')) || !existsSync(path.join(dir, 'ids.json'))) console.log('SKIP effects part: no data/effects');
  else {
    const ids = JSON.parse(readFileSync(path.join(dir, 'ids.json'), 'utf8'));
    const fed0 = existsSync(path.join(dir, 'r0000.fed')) ? rd('r0000.fed') : null;
    const fx = FXM.createEffects({ fed: rd('r0001.fed'), fed0, core: rd('core_ef.bin'), warn: () => {}, twister: ids.twister, rand: ids.rand ?? 1 });
    const wall = FXM.wallImpactId(ids, 1, [1, 0, 0]);
    const live = () => { fx.begin(STEP); const a = fx.spawn(wall, [-1390, -100, -1100]), b = fed0 ? fx.spawn(0x1000, [0, 0, 0]) : null; fx.end(); fx.update(STEP); return [a, b]; };
    const [w0, f0] = live();
    ok(w0 && fx.emitters.includes(w0) && (!fed0 || (f0 && fx.emitters.includes(f0))), `live: the wall impact 0x${wall.toString(16)}${fed0 ? ' and the 0x1000 flash' : ''} running (${fx.emitters.length} emitters)`);
    const P = page();
    restoreCheckpoint({ ...P.sys(), fx });
    ok(fx.emitters.length === 0, 'Restart: every emitter freed');
    const [w1, f1] = live();
    ok(w1 && fx.emitters.includes(w1) && (!fed0 || (f1 && fx.emitters.includes(f1))), `after the Restart the next impact${fed0 ? ' and flash' : ''} spawn again (${fx.emitters.length} emitters)`);
    if (!fed0) console.log('SKIP 0x1000 part: no data/effects/r0000.fed');
  }
}

// ------------------------------------------------ a late death: the stamps don't carry over
// A first life: a soldier's bullet hits Vincent once (the grunt cue gate C+0x810, the hit flash P+0x280, the stagger
// P+0x148 / +0x150 / +0x152). After a death at a late frame and a Restart the same hit must do the same.
{
  const hitOnce = P => {
    P.sounds.length = 0; const ev0 = P.W.events.length;
    P.W.t.damagePlayer({ damage: 10, kind: 1, hit: 0, f148: 0, dir: [1, 0, 0], pos: [...P.php.pos], from: { id: 66 } });
    const f = P.W.S.frame;
    return { sounds: P.sounds.slice(), events: P.W.events.slice(ev0).filter(e => !/frame/.test(e)),
             c810: P.php.c810 - f, t280: P.php.t280 - f, s148: P.php.s148 - f, s150: P.php.s150, s152: P.php.s152, hp: P.php.hp };
  };
  const first = page(); restoreCheckpoint(first.sys());          // the restored state on a fresh page (the reference)
  const ref = hitOnce(first);
  const late = page();
  late.W.S.frame = 3000;                                            // die late: hits near frame 3000 stamp everything
  for (let i = 0; i < 3; i++) { late.W.t.damagePlayer({ damage: 10, kind: 1, hit: 0, f148: 0, dir: [1, 0, 0], pos: [...late.php.pos], from: { id: 66 } }); late.W.S.frame += 2; }
  ok(late.php.c810 > 2990 && late.php.s148 > 2990, `late hits stamped (C+0x810 ${late.php.c810}, P+0x148 ${late.php.s148})`);
  late.php.hp = 0;
  restoreCheckpoint(late.sys());
  const got = hitOnce(late);
  ok(JSON.stringify(got) === JSON.stringify(ref), `after a late death + Restart the hit acts as on a first life: ${JSON.stringify(got)} vs ${JSON.stringify(ref)}`);
  ok(ref.c810 === 0 && ref.s148 === 0, `the hit passed the gates (C+0x810 / P+0x148 stamped now: ${ref.c810} / ${ref.s148})`);
}

// ------------------------------------------------ the trace: the restored state and the first 100 frames
const tp = path.join(OUT, 'w201_reload.jsonl');
if (!existsSync(tp)) console.log('SKIP trace part: no ' + tp);
else {
  const recs = readFileSync(tp, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(r => r.frame !== undefined);
  const fp = h => { const b = Buffer.from(h, 'hex'); return { face: [0, 4, 8].map(o => b.readFloatLE(o)), pos: [16, 20, 24].map(o => b.readFloatLE(o)) }; };
  const r10 = recs[10], r11 = recs[11];
  ok(r10.matrix[3][0] === CHECKPOINT.pos.x && r10.matrix[3][2] === CHECKPOINT.pos.z && r11.matrix[3][1] === CHECKPOINT.pos.y,
     'CHECKPOINT.pos = the placement (record 10 x / z, record 11 y on the ground)');
  ok(r10.matrix[2][0] === CHECKPOINT.face.x && r10.matrix[2][2] === CHECKPOINT.face.z && r10.cam_fwd.slice(0, 3).every((v, i) => v === CHECKPOINT.camFwd[i]), 'CHECKPOINT.face / camFwd = record 10');
  const flags = r => { const a = Buffer.from(r.evt_flags, 'hex'), k = Buffer.from(r.evt_key, 'hex'); return a.every((v, i) => (v ^ k[i]) === 0); };
  ok(recs.every(flags), 'event flags all 0 after the reload (every record)');
  // the page after the restore = record 10 (the placement); n frames later = record 10 + n
  const P = page(); restoreCheckpoint(P.sys());
  const W = P.W, S = [{ k: 0, rec: 44 }, { k: 1, rec: 66 }].map(s => ({ ...s, a: W.actors.find(a => a.rec === s.rec) }));
  let worstV = 0, worstE = 0, worstFace = 0, hpOk = true, clockBad = [];
  for (let n = 1; n <= 100; n++) {
    const g = recs[10 + n], pOld = [P.ctrl.pos.x, P.ctrl.pos.y, P.ctrl.pos.z];
    P.ctrl.step(IDLE());
    P.php.pos = [P.ctrl.pos.x, P.ctrl.pos.y, P.ctrl.pos.z];
    W.tick(STEP, pOld, P.php.pos);
    if (W.S.now !== g.ai_now) clockBad.push(`${10 + n}: ${W.S.now} vs ${g.ai_now}`);
    worstV = Math.max(worstV, ...[0, 1, 2].map(i => Math.abs(P.php.pos[i] - g.matrix[3][i])));
    worstFace = Math.max(worstFace, Math.abs(Math.atan2(P.ctrl.C.face.x, P.ctrl.C.face.z) - Math.atan2(g.matrix[2][0], g.matrix[2][2])));
    if (10 + n < 100 && P.php.hp !== g.p_hp) hpOk = false;
    for (const s of S) {
      const e = fp(g[`e${s.k}_face_pos`]);
      worstE = Math.max(worstE, ...[0, 1, 2].map(i => Math.abs(s.a.pos[i] - e.pos[i])));
      if (s.a.hp !== g[`e${s.k}_hp`]) hpOk = false;
    }
  }
  ok(clockBad.length === 0, 'the AI scheduler clock = ai_now, records 11-110' + (clockBad.length ? ': ' + clockBad.slice(0, 3).join(', ') : ''));
  ok(worstV < 0.005, `Vincent records 11-110: position within ${worstV.toFixed(4)} u`);
  ok(worstFace < 0.015, `Vincent's facing within ${worstFace.toFixed(4)} rad (the game's turns up to 0.012 with the gun drawn: not on the page)`);
  ok(worstE < 0.005, `soldiers 44 / 66 records 11-110: position within ${worstE.toFixed(4)} u`);
  ok(hpOk, 'HP: Vincent 780 to record 99 (record 100: 736, a hit from 41, see w204 below), soldiers equal');
}

// ------------------------------------------------ the trace: 41-43 after the reload (worker 0204)
// tools/trace/out/w204_reload.jsonl: the same reload state, TRACE_FIELDSET=enemy TRACE_ERECS=41,42,43 TRACE_ENEMIES=3
// TRACE_EPIN=41:904760:91af00,42:904f80:91b010,43:9057a0:91b120 (their bodies are built at record 10).
const tp4 = path.join(OUT, 'w204_reload.jsonl');
if (!existsSync(tp4)) console.log('SKIP w204 part: no ' + tp4);
else {
  const recs = readFileSync(tp4, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(r => r.frame !== undefined);
  const fp = h => { const b = Buffer.from(h, 'hex'); return [16, 20, 24].map(o => b.readFloatLE(o)); };
  const g10 = recs[10];
  ok([0, 1, 2].every(k => (recs[9][`e${k}_flags`] & 1) === 0 && (g10[`e${k}_flags`] & 1) === 1), 'T: 41-43 inactive to record 9, active at record 10 (the placement frame)');
  const P = page(); restoreCheckpoint(P.sys());
  const W = P.W, L = [41, 42, 43].map(k => W.actors.find(a => a.rec === k));
  const st = (n, k) => ({ astate: recs[n][`e${k}_astate`] & 0xff, mode: recs[n][`e${k}_ai_mode`], hp: recs[n][`e${k}_hp`] });
  const mine = k => ({ astate: L[k].astate, mode: L[k].ai.mode, hp: L[k].hp });
  ok([0, 1, 2].every(k => JSON.stringify(mine(k)) === JSON.stringify(st(10, k))), `record 10: state / brain mode / HP ${JSON.stringify([0, 1, 2].map(mine))} = the game's`);
  // the activation's magazine draw FUN_00360418(ai, 1): mag 6 + trunc(4 x rand); the game's 8 / 6 / 0xffff fit draws in
  // [0.5, 0.75) / [0, 0.25) / none. Fed those draws, the page gives the game's (one draw each for 41 / 42, none for 43)
  {
    const seq = [0.6, 0.1, 0.9], used = [];
    const Wq = AI.createEnemyAI({ ...P.opts, deadRecs: [], eventFlags: {}, rand: () => { const v = seq[used.length]; used.push(v); return v; } });
    Wq.stageLoad(LOAD);
    const R = [41, 42, 43].map(k => Wq.actors.find(a => a.rec === k).ai.rounds & 0xffff);
    ok(R.join() === [0, 1, 2].map(k => g10[`e${k}_ai_ammo`] & 0xffff).join() && used.length === 2,
       `rounds with draws 0.6 / 0.1: ${R} (T ${[0, 1, 2].map(k => g10[`e${k}_ai_ammo`] & 0xffff)}), ${used.length} draws`);
  }
  let bad = [], posBad = 0, shot42 = null, modeAt = { 0: null, 2: null };
  for (let n = 11; n <= 270; n++) {
    const g = recs[n], pOld = [P.ctrl.pos.x, P.ctrl.pos.y, P.ctrl.pos.z];
    P.ctrl.step(IDLE());
    P.php.pos = [P.ctrl.pos.x, P.ctrl.pos.y, P.ctrl.pos.z];
    const r42 = L[1].ai.rounds;
    W.tick(STEP, pOld, P.php.pos);
    if (shot42 === null && L[1].ai.rounds < r42) shot42 = n;
    for (const k of [0, 2]) if (modeAt[k] === null && L[k].ai.mode !== 0) modeAt[k] = n;
    // the brain modes (the timers' event 1) and HP over the whole window; 41's actor state too (42 / 43 crouch later:
    // their state 5 depends on the positions, see below)
    for (let k = 0; k < 3; k++) {
      const m = mine(k), t = st(n, k);
      if (m.mode !== t.mode || m.hp !== t.hp || (k === 0 && m.astate !== t.astate)) bad.push(`${n} rec ${41 + k} ${JSON.stringify(m)} vs ${JSON.stringify(t)}`);
    }
    if (n < 24) for (let k = 0; k < 3; k++) posBad = Math.max(posBad, ...fp(g[`e${k}_face_pos`]).map((v, i) => Math.abs(v - L[k].pos[i])));
  }
  ok(bad.length === 0, 'brain modes / HP of 41-43 (and 41\'s actor state) = the game\'s, records 11-270' + (bad.length ? `: ${bad.length} off, ${bad.slice(0, 3).join('; ')}` : ''));
  ok(modeAt[0] === 90 && modeAt[2] === 160, `timers: 41 -> mode 2 at record ${modeAt[0]} (90 = 10 + 80), 43 -> mode 1 at record ${modeAt[2]} (160 = 10 + 150)`);
  ok(posBad < 1e-3, `41-43 at their placements, records 11-23: within ${posBad.toFixed(5)} u of the game`);
  const shotT = recs.findIndex((r, i) => i > 10 && (r.e1_ai_ammo & 0xffff) < (recs[i - 1].e1_ai_ammo & 0xffff));
  ok(shot42 === shotT && shot42 === 12, `42's first shot at record ${shot42} (T ${shotT})`);
  // MISSING (reported, not asserted): from record 24 the game holds them at the cutscene's hand-off positions (41 ~9.6 u,
  // 42 ~8.5 u, 43 ~4.8 u from the placements), and 41's first bullet hits Vincent at record 100 (44); the page's 41 fires
  // from its placement and misses.
  const d24 = [0, 1, 2].map(k => Math.hypot(...fp(recs[24][`e${k}_face_pos`]).map((v, i) => v - AIdata.records[41 + k].pos[i])));
  console.log(`info: record 24 hand-off moves ${d24.map(d => d.toFixed(2)).join(' / ')} u (not on the page); game HP ${recs[99].p_hp} -> ${recs[100].p_hp} at record 100, page ${P.php.hp} at record 270`);
}
done();
