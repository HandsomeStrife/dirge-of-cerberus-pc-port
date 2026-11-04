// Restart -> the checkpoint (checkpoint.js, worker 0201).
//   node --import ./native/web/test_hooks.mjs native/web/test_checkpoint.mjs
// Needs data/z128_collision.bin + data/enemies/ai.json (else SKIP). With tools/trace/out/w201_reload.jsonl
// (TRACE_FIELDSET=enemy TRACE_ERECS=44,66, from the state saved at the stage reload after game over -> Restart)
// it checks the restored state and the first 100 frames after it against the game. Worker 0205: needs
// data/checkpoint.json (export_web_checkpoint.py: the opening event's hand-off); w204_reload / w205_rng (TRACE_RNG=1)
// check 41-43's hand-off at record 24 and 41's first shot.
import { readFileSync, existsSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const OUT = process.env.TRACE_OUT ?? path.join(root, 'tools/trace/out');
const imp = f => import(pathToFileURL(path.join(here, f)).href);
const PL = await imp('player.js');
const { Collision } = await imp('collision.js');
const { CHECKPOINT, PLAYER_STAMPS, SOLDIER_RELEASE, handOff, vincentStart, restoreCheckpoint, initWorld, sceneSave, loadedPair, RECORD_RELOAD } = await (process.env.CHECKPOINT_JS ? import(pathToFileURL(process.env.CHECKPOINT_JS).href) : imp('checkpoint.js'));
const { GameOver, mergeData } = await imp('gameover.js');
let fail = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };
const done = () => { console.log(fail ? `${fail} FAILED` : 'all ok'); process.exit(fail ? 1 : 0); };
const warns = []; console.warn = m => warns.push(String(m));
const colPath = path.join(here, 'data/z128_collision.bin'), aiPath = path.join(here, 'data/enemies/ai.json');
if (!existsSync(colPath) || !existsSync(aiPath)) { console.log('SKIP: data/z128_collision.bin or data/enemies/ai.json missing'); done(); }
const cbuf = readFileSync(colPath), col = new Collision(cbuf.buffer.slice(cbuf.byteOffset, cbuf.byteOffset + cbuf.byteLength));
const AIdata = JSON.parse(readFileSync(aiPath, 'utf8'));
const AI = await (process.env.ENEMY_AI_JS ? import(pathToFileURL(process.env.ENEMY_AI_JS).href) : imp('enemy_ai.js'));   // worker 0240: mutants
const dp = path.join(here, 'data/pause.json'), dg = path.join(here, 'data/gameover.json');
if (!existsSync(dp) || !existsSync(dg)) { console.log('SKIP: data/pause.json / data/gameover.json missing'); done(); }
const GD = mergeData(JSON.parse(readFileSync(dp, 'utf8')), JSON.parse(readFileSync(dg, 'utf8')));
// the opening event's hand-off (worker 0205): data/checkpoint.json from export_web_checkpoint.py
const hp_ = path.join(here, 'data/checkpoint.json');
// Without it (or TEST_NO_HANDOFF=1) the restart checks run with the page spawn and the trace parts skip.
const HO = existsSync(hp_) && !process.env.TEST_NO_HANDOFF ? JSON.parse(readFileSync(hp_, 'utf8')) : null;
if (!HO) console.log('SKIP hand-off parts: no data/checkpoint.json (export_web_checkpoint.py)');
const VS = HO ? vincentStart(HO) : null;
if (HO) {
  ok(VS && Object.keys(HO.actors).sort().join() === 'e_Sol_11,e_Sol_12,e_Sol_13,p_Vin', `hand-off actors ${Object.keys(HO.actors)} (the event's setbattlename tags)`);
  ok(['e_Sol_11', 'e_Sol_12', 'e_Sol_13', 'p_Vin'].map(t => HO.actors[t].clip).join() === 'km01daw,km01dbw,km01dcw,km01vnw2'
     && Object.values(HO.actors).every(h => h.dir === 180), 'battle clips km01daw / dbw / dcw / vnw2, the same setdir value');
}
// handOff on synthetic entries (no data needed): FUN_003157b0's bone row 3 y is zeroed (sp+0x84), the root's y stays;
// +0x40 = -row 2; a malformed entry warns and is skipped; vincentStart(null) warns and gives null
{
  const w0 = warns.length;
  const syn = handOff({ origin: [1, 2, 3], dir: 180, bone1: [[1, 0, 0], [0, 1, 0], [0, 0, 1], [4, 5, 6]] });
  ok(syn && syn.pos.join() === '5,2,9' && syn.face.map(v => v + 0).join() === '0,0,-1', `synthetic hand-off: pos ${syn && syn.pos} (5,2,9: bone y 5 dropped), face ${syn && syn.face}`);
  ok(handOff({ origin: [1, 2], dir: 180, bone1: [] }) === null && handOff({ origin: [0, 0, 0], dir: 180, bone1: [[1, 0, 0], [0, 1, 0], [0, 0, 1], [0, 'x', 0]] }) === null
     && handOff({ origin: [0, 0, 0], dir: 90, bone1: [[1, 0, 0], [0, 1, 0], [0, 0, 1], [0, 0, 0]] }) === null && handOff(null) === null,
     'malformed / undecoded entries give null, no throw');
  ok(vincentStart(null) === null && vincentStart({ actors: {} }) === null, 'vincentStart without data: null');
  ok(warns.slice(w0).some(w => /malformed hand-off/.test(w)) && warns.slice(w0).some(w => /setdir\(90\)/.test(w)) && warns.slice(w0).some(w => /checkpoint.json.*missing/.test(w)), 'and they warn');
}
const WALK = () => ({ ...IDLE(), x: 1, z: 0, stick: PL.KEY_RUN });
const IDLE = () => ({ x: 0, z: 0, stick: 0, keys: new Set(), pressed: new Set() });
const STEP = PL.STEP;                   // DAT_004eeb24 = 1.1999999 (the page's step; worker 0240: was 1.2)

// the page's start soldiers (play.js AWAKE / AWAKE_STATE / AWAKE_F118: the save's RAM)
const AWAKE = [44, 45, 46, 47, 48, 49, 66];
const AWAKE_STATE = { 44: 1, 45: 2, 46: 1, 47: 1, 48: 2, 49: 2, 66: 1 };
const AWAKE_F118 = { 44: 0, 45: 0x10000200, 46: 0, 47: 0, 48: 0x200, 49: 0x200, 66: 0 };
// the stage load's statuses (enemies.js loadRecs: placements.json load_flag_records with an event-actor tag, not Vincent)
const PJpath = path.join(here, 'data/enemies/placements.json');
const PJ = existsSync(PJpath) ? JSON.parse(readFileSync(PJpath, 'utf8')) : null;
const LOAD = PJ ? (t => PJ.load_flag_records.filter(r => t.has(r.tag) && r.rec !== 0).map(r => r.rec))(new Set(PJ.event_actors.tags)) : [];
ok(JSON.stringify(LOAD) === '[41,42,43]', `stage-load records ${JSON.stringify(LOAD)} (41-43: bit 3 + e_Sol_11 / 12 / 13)`);
// play.js rebuildEnemies = checkpoint.js initWorld: nothing dead, the stage init's 0x22 / 0x23 pass (44 / 66), the
// placement's clocks, 41-43 (stand-in), then 45-49 (wakeSave)
const rebuild = (opts, flags, frame, clock, load = LOAD) => initWorld(o => AI.createEnemyAI({ ...opts, ...o }), { flags, frame, clock, loadRecs: load,
  wake: W => { for (const k of [45, 46, 47, 48, 49]) W.addActor({ rec: k, astate: AWAKE_STATE[k], f118: AWAKE_F118[k] }); } });

// ------------------------------------------------ the stage init's pass (worker 0240; checkpoint.js initWorld)
// FUN_0053ca50(mgr, 1): event 0x22 to every object (stage object first), then FUN_005459d8: event 0x23 to every object, at
// manager clock 0 (T w240_init). Script 0's 0x22 activates 44 / 66 (their magazines drawn in the pass); 81-86's 0x23 arms
// their 0x113 periods from clock 0; no event 0x23 after the clocks move to the placement.
{
  const php0 = { pos: [-1395.15, -98.64, -1111.01], face: [0, 0, 1], hp: 780, id: 0x16, f118: 0x20209, s64: 0 };
  let draws = 0, drawsAtInit = null;
  const make = o => { const W = AI.createEnemyAI({ data: AIdata, player: php0, quiet: true, damage: true, walkMesh: col, rand: () => { draws++; return 0.1; }, log: () => {}, ...o });
    const si = W.stageInit; W.stageInit = () => { si(); drawsAtInit = draws; W.initEvents = W.events.slice(); W.initDelayed = W.delayed.map(e => [e.id - 22, e.due]); }; return W; };
  const W = initWorld(make, { flags: {}, frame: CHECKPOINT.frame, clock: { now: CHECKPOINT.aiNow, acc: CHECKPOINT.aiAcc, mgr20: CHECKPOINT.mgr20, mgr24: CHECKPOINT.mgr24 }, loadRecs: LOAD });
  const ev = W.initEvents || [], i22 = ev.findIndex(e => / ev 34 /.test(e)), i23 = ev.findIndex(e => / ev 35 /.test(e));
  ok(ev[0] === 'event stage script 0 ev 34 r 0,0,0,0' && i23 > i22 && !ev.slice(i23).some(e => / ev 34 /.test(e)) && ev.filter(e => /^event stage .* ev 35 /.test(e)).length === 1,
     `init pass: the stage object's 0x22 first, every 0x22 before the first 0x23 (${ev.filter(e => / ev 34 /.test(e)).length} x 0x22, ${ev.filter(e => / ev 35 /.test(e)).length} x 0x23)`);
  // worker 0242 (review): within FUN_005459d8's 0x23 the stage object, then the records / actors, then the triggers (t25 /
  // t64 / t160 / t161 handle 0x23), list by list as DAT_0058b040's order
  { const e23 = ev.filter(e => / ev 35 /.test(e)).map(e => e.split(' ')[1]);
    const lastRec = e23.reduce((k, id, i) => (/^\d+$/.test(id) ? i : k), -1), trig = e23.filter(id => /^t\d+$/.test(id));
    ok(e23[0] === 'stage' && lastRec > 0 && trig.join() === 't25,t64,t160,t161' && e23.slice(lastRec + 1).join() === trig.join(),
       `init pass 0x23 order: stage, ${lastRec} records / actors, then the triggers ${trig}`); }
  const a44 = W.actors.find(a => a.rec === 44), a66 = W.actors.find(a => a.rec === 66);
  ok(a44 && a66 && drawsAtInit === 8, `script 0's 0x22 activates 44 / 66 (cmd 0x108); ${drawsAtInit} draws in the pass (44 / 66's magazines + 81-86's op 42: 8)`);
  ok(JSON.stringify((W.initDelayed || []).filter(([k]) => k >= 81 && k <= 86)) === '[[85,59],[81,67],[82,73],[83,77]]',
     `81-86's 0x113 periods armed at clock 0: ${JSON.stringify((W.initDelayed || []).filter(([k]) => k >= 81 && k <= 86))}`);
  ok(W.S.mgr20 === CHECKPOINT.mgr20 && W.S.mgr24 === Math.fround(CHECKPOINT.mgr24) && W.S.now === CHECKPOINT.aiNow && W.S.frame === CHECKPOINT.frame,
     'then the placement\'s clocks and frame');
  ok(!W.events.slice((W.initEvents || []).length).some(e => / ev 35 /.test(e)), 'no second event 0x23 at the placement (T w240_act: no FUN_005453b0 there)');
  // the records' own 0x22: scripts 111 / 11 (records 1 / 2) send cmd 0x108 to themselves when stage flag 0 == 20
  { const W20 = initWorld(make, { flags: { 0: 20 }, frame: 24, clock: {}, loadRecs: [] });
    ok([1, 2].every(k => W20.objects.get(k + 22).flags28 & 1) && ![1, 2].some(k => W.objects.get(k + 22).flags28 & 1),
       'records 1 / 2: their script\'s 0x22 activates them at stage flag 0 = 20 (not at 0)'); }
  // battle()'s stage-load pass (stage_controller.js -> play.js stagePass): FUN_005453b0 = the loop, then FUN_005459d8
  W.events.length = 0; W.stageLoad([]);
  const n23 = W.events.filter(e => / ev 35 /.test(e)).length;
  W.events.length = 0; W.loadPass([]);
  ok(n23 === ev.filter(e => / ev 35 /.test(e)).length && !W.events.some(e => / ev 35 /.test(e)), `stageLoad([]) sends event 0x23 to every object (${n23}), loadPass alone none`);
}

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
    groundY: (x, z, y) => col.groundY(x, z, y), handoff: P.handoff === undefined ? HO : P.handoff, weapon: { reset() { P.weaponResets++; } }, music: () => { P.music++; },
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
  if (VS) {
    ok(P.ctrl.pos.x === VS.pos[0] && P.ctrl.pos.z === VS.pos[2] && Math.abs(P.ctrl.pos.y - col.groundY(VS.pos[0], VS.pos[2], VS.pos[1])) < 1e-9,
       `Vincent at the hand-off ${[P.ctrl.pos.x, P.ctrl.pos.y, P.ctrl.pos.z].map(v => v.toFixed(3))} (on the ground below status +0x30)`);
    ok(Math.abs(P.ctrl.heading - Math.atan2(VS.face[0], VS.face[2])) < 1e-9 && Math.abs(P.ctrl.C.face.z - 1) < 1e-5, `facing ${P.ctrl.C.face.x.toFixed(5)}, ${P.ctrl.C.face.z.toFixed(5)}`);
  } else ok(P.ctrl.pos.x === spawn0.x && P.ctrl.pos.z === spawn0.z && warns.some(w => /checkpoint.json.*missing/.test(w)), 'no hand-off data: Vincent at the page spawn (warned)');
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
  ok(P.W.S.frame === CHECKPOINT.frame && CHECKPOINT.frame === 24, `the page's frame count ${P.W.S.frame} (24: the hand-off schedule's base)`);
  // worker 0230: the manager clock mgr +0x20 / +0x24 (ticks): the reload state's 14 / 0.3999990 at record 0, 10 PAL frames of 1.2
  // (f32 steps of DAT_004eeb24 = 1.1999999, FUN_0053b500) -> 26 / 0.3999983 at the placement, as the trace's AI clock 14 -> 26
  { let a = Math.fround(0.3999990224838257), c = 14;
    for (let i = 0; i < 10; i++) { const v = Math.fround(a + STEP), n = Math.trunc(v); a = v; if (n > 0) { c += n; a = Math.fround(v - n); } }
    ok(P.W.S.mgr20 === c && c === 26 && P.W.S.mgr24 === a, `the new world's manager clock ${P.W.S.mgr20} + ${P.W.S.mgr24} (reload 14 + 10 frames -> ${c} + ${a})`); }
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
  ok(L.every(a => a.pos.every((v, i) => v === AIdata.records[a.rec].pos[i])), '41-43 at their placements until their battle clips end');
  ok(JSON.stringify(P.W.handOffs.map(h => [h.rec, h.frame])) === JSON.stringify(HO ? [[41, 38], [42, 38], [43, 38]] : []) && SOLDIER_RELEASE === 14,
     `41-43's hand-off scheduled at S.frame ${P.W.handOffs.map(h => h.frame)} (24 + 14)`);
  ok(!warns.some(w => /41-43.*not activated/.test(w)) && (HO ? !warns.some(w => /stay at their placements/.test(w)) : warns.some(w => /41-43 stay at their placements/.test(w)))
     && warns.some(w => /Status screen/.test(w)) && warns.some(w => /holstered/.test(w)), 'the left-out parts warn (the screens, the gun)');
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
  // (worker 0237: the pass's event 0x23 arms records 81-86's timer 0 (scripts 159-164, op 42), so only 41's own is checked)
  ok(a.astate === 1 && a.vars[7] === 0 && !W.timerList.includes(a.id) && (a.C.f564 & 0x20000000) && (a.C.f1c0 & 0x200) && a.C.speed === 0,
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
    const f = P.W.S.mgr20;
    return { sounds: P.sounds.slice(), events: P.W.events.slice(ev0).filter(e => !/frame/.test(e)),
             c810: P.php.c810 - f, t280: P.php.t280 - f, s148: P.php.s148 - f, s150: P.php.s150, s152: P.php.s152, hp: P.php.hp };
  };
  const first = page(); restoreCheckpoint(first.sys());          // the restored state on a fresh page (the reference)
  const ref = hitOnce(first);
  const late = page();
  late.W.S.mgr20 = 3000;                                            // die late: hits near tick 3000 stamp everything
  for (let i = 0; i < 3; i++) { late.W.t.damagePlayer({ damage: 10, kind: 1, hit: 0, f148: 0, dir: [1, 0, 0], pos: [...late.php.pos], from: { id: 66 } }); late.W.S.mgr20 += 2; }
  ok(late.php.c810 > 2990 && late.php.s148 > 2990, `late hits stamped (C+0x810 ${late.php.c810}, P+0x148 ${late.php.s148})`);
  late.php.hp = 0;
  restoreCheckpoint(late.sys());
  const got = hitOnce(late);
  ok(JSON.stringify(got) === JSON.stringify(ref), `after a late death + Restart the hit acts as on a first life: ${JSON.stringify(got)} vs ${JSON.stringify(ref)}`);
  ok(ref.c810 === 0 && ref.s148 === 0, `the hit passed the gates (C+0x810 / P+0x148 stamped now: ${ref.c810} / ${ref.s148})`);
}

// ------------------------------------------------ a soldier hit before its hand-off is left in place (warned)
if (HO) {
  const P = page(); restoreCheckpoint(P.sys());
  const L = [41, 42, 43].map(k => P.W.actors.find(a => a.rec === k));
  L[0].hp -= 1;                                                   // 41 hit before frame 38
  const w0 = warns.length, here0 = L[0].pos.slice();
  while (P.W.S.frame < 38) { const p0 = [P.ctrl.pos.x, P.ctrl.pos.y, P.ctrl.pos.z]; P.ctrl.step(IDLE()); P.W.tick(STEP, p0, p0); }
  const H = Object.fromEntries(['e_Sol_11', 'e_Sol_12'].map((t, i) => [41 + i, handOff(HO.actors[t]).pos]));
  ok(L[0].pos.every((v, i) => v === here0[i]) && L[1].pos.every((v, i) => v === H[42][i]) && warns.slice(w0).some(w => /record 41 hit before its hand-off/.test(w)),
     '41 hit before its hand-off stays put (warned), 42 is placed');
}

// ------------------------------------------------ the trace: the restored state and the first 100 frames
const tp = path.join(OUT, 'w201_reload.jsonl');
if (!HO || !existsSync(tp)) console.log('SKIP trace part: ' + (HO ? 'no ' + tp : 'no hand-off data'));
else {
  const recs = readFileSync(tp, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(r => r.frame !== undefined);
  const fp = h => { const b = Buffer.from(h, 'hex'); return { face: [0, 4, 8].map(o => b.readFloatLE(o)), pos: [16, 20, 24].map(o => b.readFloatLE(o)) }; };
  const r10 = recs[10], r11 = recs[11];
  // the hand-off (ev0100's origin + km01vnw2's last frame) = the game's placement: record 10 x / y / z bit for bit,
  // record 11 y on the ground; the facing within the clip decode's rotation error
  ok(r10.matrix[3][0] === VS.pos[0] && r10.matrix[3][1] === VS.pos[1] && r10.matrix[3][2] === VS.pos[2]
     && Math.abs(r11.matrix[3][1] - col.groundY(VS.pos[0], VS.pos[2], VS.pos[1])) < 1e-4,
     `Vincent's hand-off = record 10 (${VS.pos.map(v => v.toFixed(4))}; record 11 y ${r11.matrix[3][1].toFixed(4)} on the ground)`);
  const dFace = Math.abs(Math.atan2(VS.face[0], VS.face[2]) - Math.atan2(r10.matrix[2][0], r10.matrix[2][2]));
  ok(dFace < 1e-4, `Vincent's hand-off facing within ${dFace.toExponential(2)} rad of record 10 (km01vnw2 bone 1 row 2)`);
  console.log(`info: largest Vincent hand-off error: position 0, facing ${dFace.toExponential(2)} rad`);
  ok(r10.cam_fwd.slice(0, 3).every((v, i) => v === CHECKPOINT.camFwd[i]), 'CHECKPOINT.camFwd = record 10');
  const flags = r => { const a = Buffer.from(r.evt_flags, 'hex'), k = Buffer.from(r.evt_key, 'hex'); return a.every((v, i) => (v ^ k[i]) === 0); };
  ok(recs.every(flags), 'event flags all 0 after the reload (every record)');
  // the page after the restore = record 10 (the placement); n frames later = record 10 + n
  const P = page(); restoreCheckpoint(P.sys());
  const W = P.W, S = [{ k: 0, rec: 44 }, { k: 1, rec: 66 }].map(s => ({ ...s, a: W.actors.find(a => a.rec === s.rec) }));
  let worstV = 0, worstE = 0, worstFace = 0, hpOk = true, clockBad = [], stBad = [];
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
      // worker 0240: 44 / 66 come from the stage init's 0x22 now (no wakeSave): actor state, brain mode, +0x28 bit 0
      const m = [s.a.astate, s.a.ai ? s.a.ai.mode : -1, s.a.flags28 & 1], t = [g[`e${s.k}_astate`] & 0xff, g[`e${s.k}_ai_mode`], g[`e${s.k}_flags`] & 1];
      if (m.join() !== t.join() && stBad.length < 4) stBad.push(`${10 + n} rec ${s.rec} ${m} vs ${t}`);
    }
  }
  ok(clockBad.length === 0, 'the AI scheduler clock = ai_now, records 11-110' + (clockBad.length ? ': ' + clockBad.slice(0, 3).join(', ') : ''));
  ok(worstV < 0.005, `Vincent records 11-110: position within ${worstV.toFixed(4)} u`);
  ok(worstFace < 0.015, `Vincent's facing within ${worstFace.toFixed(4)} rad (the game's turns up to 0.012 with the gun drawn: not on the page)`);
  ok(worstE < 0.005, `soldiers 44 / 66 records 11-110: position within ${worstE.toFixed(4)} u`);
  ok(stBad.length === 0, '44 / 66: actor state, brain mode, active = the game\'s, records 11-110' + (stBad.length ? ': ' + stBad.join('; ') : ''));
  ok(hpOk, 'HP: Vincent 780 to record 99 (record 100: 736, a hit from 41, see w204 below), soldiers equal');
}

// ------------------------------------------------ the trace: 41-43 after the reload (worker 0204)
// tools/trace/out/w204_reload.jsonl: the same reload state, TRACE_FIELDSET=enemy TRACE_ERECS=41,42,43 TRACE_ENEMIES=3
// TRACE_EPIN=41:904760:91af00,42:904f80:91b010,43:9057a0:91b120 (their bodies are built at record 10).
const tp4 = path.join(OUT, 'w204_reload.jsonl');
if (!HO || !existsSync(tp4)) console.log('SKIP w204 part: ' + (HO ? 'no ' + tp4 : 'no hand-off data'));
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
    Wq.loadPass(LOAD);
    const R = [41, 42, 43].map(k => Wq.actors.find(a => a.rec === k).ai.rounds & 0xffff);
    // worker 0240: no event 0x23 at the placement (T w240_act: no FUN_005453b0 there), so 2 draws (41 / 42). The game's
    // frame has 7 (w205_rng records 9 -> 10): these 2 + 45-49's activation magazines (FUN_00360418 x 5, T w240_act), which
    // the page's wakeSave GUESS does not draw
    ok(R.join() === [0, 1, 2].map(k => g10[`e${k}_ai_ammo`] & 0xffff).join() && used.length === 2,
       `rounds with draws 0.6 / 0.1: ${R} (T ${[0, 1, 2].map(k => g10[`e${k}_ai_ammo`] & 0xffff)}), ${used.length} draws (2)`);
  }
  let bad = [], posBad = 0, posAfter = 0, faceAt24 = 0, shot42 = null, modeAt = { 0: null, 2: null };
  const ff = h => { const b = Buffer.from(h, 'hex'); return [0, 4, 8].map(o => b.readFloatLE(o)); };
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
    else for (let k = 0; k < 3; k++) {
      posAfter = Math.max(posAfter, ...fp(g[`e${k}_face_pos`]).map((v, i) => Math.abs(v - L[k].pos[i])));
      if (n === 24) faceAt24 = Math.max(faceAt24, ...[0, 2].map(i => Math.abs(ff(g[`e${k}_face_pos`])[i] - L[k].face[i])));
    }
  }
  ok(bad.length === 0, 'brain modes / HP of 41-43 (and 41\'s actor state) = the game\'s, records 11-270' + (bad.length ? `: ${bad.length} off, ${bad.slice(0, 3).join('; ')}` : ''));
  ok(modeAt[0] === 90 && modeAt[2] === 160, `timers: 41 -> mode 2 at record ${modeAt[0]} (90 = 10 + 80), 43 -> mode 1 at record ${modeAt[2]} (160 = 10 + 150)`);
  ok(posBad < 1e-3, `41-43 at their placements, records 11-23: within ${posBad.toFixed(5)} u of the game`);
  const shotT = recs.findIndex((r, i) => i > 10 && (r.e1_ai_ammo & 0xffff) < (recs[i - 1].e1_ai_ammo & 0xffff));
  ok(shot42 === shotT && shot42 === 12, `42's first shot at record ${shot42} (T ${shotT})`);
  // the hand-off (worker 0205): from record 24 they stand where the game's do (the battle clips' last frames)
  ok(posAfter < 1e-3, `41-43 at the hand-off, records 24-270: within ${posAfter.toFixed(5)} u of the game`);
  ok(faceAt24 < 1e-4, `41-43's hand-off facings at record 24 within ${faceAt24.toExponential(2)}`);
  console.log(`info: largest 41-43 errors: position ${posBad.toFixed(5)} (records 11-23) / ${posAfter.toFixed(5)} u (24-270), facing ${faceAt24.toExponential(2)}`);
}

// ------------------------------------------------ the first hit with the game's twister (worker 0205)
// tools/trace/out/w205_rng.jsonl: w204_reload's fields + TRACE_RNG=1 (the twister DAT_004fbe00 / index each record).
// The page from record 10 with the game's twister state there: 41 fires from the hand-off and its bullet takes
// Vincent's HP 780 -> 736 (44) at record 100 in the game.
const tp5 = path.join(OUT, 'w205_rng.jsonl');
if (!HO || !existsSync(tp5)) console.log('SKIP w205 part: ' + (HO ? 'no ' + tp5 : 'no hand-off data'));
else {
  const recs = readFileSync(tp5, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(r => r.frame !== undefined);
  const rf = r => { const g = new AI.GameRandom(1); for (let i = 0; i < 624; i++) g.s[i] = Buffer.from(r.rng_state.slice(8 * i, 8 * i + 8), 'hex').readUInt32LE(0); g.i = r.rng_idx; return g; };
  // worker 0240: the stage init's draws (44 / 66's magazines, 81-86's op 42) come before the trace's record 0 (T w240_init),
  // so they take words from a scratch twister; the game's twister from record 9 on starts at the placement (loadPass)
  let cur = new AI.GameRandom(1);
  const P = page(); P.opts.rand = () => cur.rand();
  const sys5 = P.sys();
  // initWorld calls loadPass right after the stage init and the clocks: the game's twister from there
  const make5 = o => { const W = AI.createEnemyAI({ ...P.opts, ...o }); const lp = W.loadPass; W.loadPass = r => { cur = rf(recs[9]); lp(r); }; return W; };
  sys5.rebuildEnemies = (flags, frame, clock) => { P.W = initWorld(make5, { flags, frame, clock, loadRecs: LOAD,
    wake: W => { for (const k of [45, 46, 47, 48, 49]) W.addActor({ rec: k, astate: AWAKE_STATE[k], f118: AWAKE_F118[k] }); } }); return P.W; };
  restoreCheckpoint(sys5);
  const L = [41, 42, 43].map(k => P.W.actors.find(a => a.rec === k));
  ok(L.map(a => a.ai.rounds & 0xffff).join() === [0, 1, 2].map(k => recs[10][`e${k}_ai_ammo`] & 0xffff).join(),
     `the activation's magazines with the game's twister: ${L.map(a => a.ai.rounds & 0xffff)} (T record 10)`);
  cur = rf(recs[10]);                                   // the frame's other draws are not the page's: restart from record 10
  let hitAt = null, hpAt = null, fire41 = null, r41 = L[0].ai.rounds, shot = null, idxAtShot = null;
  const per18 = [];
  for (let n = 11; n <= 110; n++) {
    const pOld = [P.ctrl.pos.x, P.ctrl.pos.y, P.ctrl.pos.z];
    P.ctrl.step(IDLE());
    P.php.pos = [P.ctrl.pos.x, P.ctrl.pos.y, P.ctrl.pos.z];
    P.W.tick(STEP, pOld, P.php.pos);
    if (fire41 === null && L[0].ai.rounds !== r41) { fire41 = n; shot = P.W.bullets.find(b => b.from === L[0]); idxAtShot = cur.i; }
    if (hitAt === null && P.php.hp < 780) { hitAt = n; hpAt = P.php.hp; }
    if (P.W.events.some(e => /^event 10[3-8] script \d+ ev 24 /.test(e))) per18.push(n);   // 81-86's cmd 0x113 period (event 0x18)
  }
  // worker 0240: 81-86's 0x113 periods, armed by the stage init's event 0x23 at clock 0 (initWorld), fire at the records
  // where the game's twister moves for them (w205_rng: one word each at 39, 45, 50, 54, 88, 101, 111, 118; 0237's fit)
  for (let n = 111; n <= 120; n++) {
    const pOld = [P.ctrl.pos.x, P.ctrl.pos.y, P.ctrl.pos.z];
    P.ctrl.step(IDLE()); P.php.pos = [P.ctrl.pos.x, P.ctrl.pos.y, P.ctrl.pos.z]; P.W.tick(STEP, pOld, P.php.pos);
    if (P.W.events.some(e => /^event 10[3-8] script \d+ ev 24 /.test(e))) per18.push(n);
  }
  const gMove = n => ((recs[n].rng_idx - recs[n - 1].rng_idx + 624) % 624) > 0;
  const want18 = [39, 45, 50, 54, 88, 101, 111, 118];
  ok(JSON.stringify(per18.filter(n => n <= 120)) === JSON.stringify(want18) && want18.every(gMove),
     `81-86's event 0x18 at records ${per18.filter(n => n <= 120)} (the game's draws ${want18})`);
  const gFire = recs.findIndex((r, i) => i > 10 && (r.e0_ai_ammo & 0xffff) < (recs[i - 1].e0_ai_ammo & 0xffff));
  const gHit = recs.findIndex(r => r.p_hp < 780);
  ok(gHit === 100 && recs[gHit].p_hp === 736 && recs[gHit - 1].p_hp === 780, `T: the first hit on Vincent at record ${gHit}, 780 -> ${recs[gHit].p_hp} (44)`);
  const fp5 = h => { const b = Buffer.from(h, 'hex'); return [16, 20, 24].map(o => b.readFloatLE(o)); };
  ok(shot && shot.start[0] === L[0].pos[0] && shot.start[2] === L[0].pos[2]
     && fp5(recs[gFire].e0_face_pos).every((v, i) => Math.abs(v - L[0].pos[i]) < 1e-4),
     `41's first shot leaves from the hand-off (${shot && shot.start.map(v => v.toFixed(2))}), where the game's 41 stands`);
  // NOT reproduced (reported; notes/fidelity-audit.md 'The twister after 42's first shot'): since worker 0240's stage-init
  // pass the page's 41 fires at record 106 (the game's 96) and 43 at 174 (worker 0204's runs: 95 / 169). The twister is
  // 2 words ahead from record 12 (42's first shot: the page draws 3 words, the game 1), so each later draw takes other
  // words; 81-86's draws (records 39, 45, 50, 54, 88) are now the game's. This hooked run has no body poses (the shot starts
  // at the eye, not the muzzle), so the hit can't be judged here either. Pinned below so drift shows up.
  let fire43 = null;                                     // 43's first bullet (as the review's cmp.mjs counts: a new bullet from it)
  for (let n = 121; n <= 200 && fire43 === null; n++) {
    const pOld = [P.ctrl.pos.x, P.ctrl.pos.y, P.ctrl.pos.z], nb = P.W.bullets.length;
    P.ctrl.step(IDLE()); P.php.pos = [P.ctrl.pos.x, P.ctrl.pos.y, P.ctrl.pos.z]; P.W.tick(STEP, pOld, P.php.pos);
    if (P.W.bullets.slice(nb).some(b => b.from === L[2])) fire43 = n;
  }
  ok(fire41 === 106 && idxAtShot === 432 && fire43 === 174,
     `pinned (known gap, not the game's): 41's first shot at page record ${fire41} (106; game ${gFire}), twister index ${idxAtShot} (432; game ${recs[gFire - 1].rng_idx}), 43's at ${fire43} (174)`);
  console.log(`info: 41's first shot: page record ${fire41}, game ${gFire}; twister index at the page's shot ${idxAtShot} (game ${recs[gFire - 1].rng_idx} before its shot); first hit on Vincent: page ${hitAt === null ? 'none to record 110' : 'record ' + hitAt + ' (HP ' + hpAt + ')'}, game record ${gHit} (HP ${recs[gHit].p_hp})`);
}
// ------------------------------------------------ mid-level checkpoints (worker 0242; checkpoint.js sceneSave / restoreRecord)
// T w242 (s826 + the rescue route's scene_save(1) at f704, pause Restart f2420; states in the worker's scratch, numbers here):
// the record DAT_004b2680 = stage 0x80, chunks (3, 2), program index 13 (cmd 0xa), n 1, event 100, global {0: 1, 1: 5, 18: 1,
// 55: 7}, stage {0: 2, 1: 5, 2: 7, 46: 1}; DAT_0046b0b8 0. After the reload: stage flags = the record's (12 / 63 gone), global
// 18 cleared by main, Vincent (-889.2, -0.0636, -599) facing (-1, 0, 0), HP 780 (500 at the save), stage flag 9 = 1.
{
  const stagePath = path.join(here, 'data/event/ev0100_stage.json');
  if (!sceneSave) { ok(false, 'checkpoint.js exports sceneSave'); }
  else if (!existsSync(stagePath)) console.log('SKIP mid-level checkpoint part: no data/event/ev0100_stage.json');
  else {
    const { createStageController } = await imp('stage_controller.js');
    const { AreaStream } = await imp('area_stream.js');
    const SD = JSON.parse(readFileSync(stagePath, 'utf8'));
    const mk = (F, extra = {}) => {
      const stream = new AreaStream([], [1, 2]), ev = [];
      const vin = { tag: 'p_Vin', pos: null, face: null, matrix: () => [0, 0, 1, 0, 0, -1, 0, 0, -1, 0, 0, 0, -1395, -98, -1111, 1], lend() {}, show() {},
        release() {}, place(p, f) { vin.pos = p.slice(); vin.face = f.slice(); ev.push('place'); } };
      const c = createStageController({ data: SD, warn: () => {}, flags: () => F.v, stream: () => stream, battleObject: n => (n === 'p_Vin' ? vin : null), ...extra });
      return { c, stream, vin, ev, run(n) { for (let f = 0; f < n && !c.done; f++) { stream.progress(); c.tick(20); } } };
    };
    // 1. the beat: rv_matiawase's scene_save(1) -> the page's record (onSceneSave as play.js wires it)
    const F = { v: {} }; let rec = null;
    const A = mk(F, { onSceneSave: n => { rec = sceneSave(n, { gflags: A.c.globalFlags, sflags: F.v, pair: loadedPair(A.stream),
      hp: 500, inventory: { slots: [[0x69300000, 2]], gil: 7, other: 36 }, taken: new Set([22]) }); } });
    A.run(30); F.v = { 0: 2, 63: 6 }; A.run(200);
    const nz = o => JSON.stringify(Object.fromEntries(Object.entries(o).filter(([, v]) => v)));
    ok(rec && rec.n === 1 && rec.resume === 'main' && rec.stage === 0x80 && rec.event === 100, `scene_save(1) -> the record (n ${rec && rec.n}, resume at main = the program's cmd 0xa, T index 13)`);
    const g = rec ? Object.fromEntries([...rec.gflags].map((v, i) => [i, v]).filter(([, v]) => v)) : {};
    ok(rec && g[18] === 1 && g[0] === 1 && g[1] === 5, `the record's global flags ${JSON.stringify(g)} (T {0: 1, 1: 5, 18: 1, 55: 7}: flag 18 = 1 inside the save; 55 is the x -1186 help box, not on this route)`);
    ok(rec && rec.gflags !== A.c.globalFlags && A.c.globalFlags[18] === 0, 'the record holds a copy (main clears flag 18 after the save)');
    ok(rec && nz(rec.sflags) === nz(F.v) && Object.isFrozen(rec.sflags), `the record's stage flags ${rec && nz(rec.sflags)} = the world's at the save`);
    ok(rec && rec.pair.join() === '3,2', `the record's chunks ${rec && rec.pair} (T 3, 2: Zone.load(128, 2, 3) before the save)`);
    ok(rec && rec.inventory.slots[0][1] === 2 && rec.inventory.gil === 7 && rec.taken.join() === '22', 'the record copies the inventory and the taken bits');
    // 2. the Restart: restoreCheckpoint with the record (fake systems)
    const php = { hp: 300, f118: 0, s64: 5 };
    let rb = null, music = 0, musicArg = null, resets = 0;
    const sysR = { record: rec, php, ctrl: { pos: { x: 1, y: 2, z: 3 }, C: { face: { x: 0, y: 0, z: 1 } }, reset() { resets++; } },
      rebuildEnemies: (...a) => { rb = a; return null; }, music: r => { music++; musicArg = r; }, handoff: HO };
    const outR = restoreCheckpoint(sysR);
    ok(php.hp === 780 && php.f118 === CHECKPOINT.f118 && php.s64 === 0, `HP after a record's reload: ${php.hp} (780: FUN_00319798 drops the saved status; T 780, the record held 500)`);
    ok(rb && nz(rb[0]) === nz(rec.sflags) && rb[1] === RECORD_RELOAD.frame && rb[2] === RECORD_RELOAD.clock && rb[3] === rec,
       `rebuildEnemies(the record's stage flags ${rb && nz(rb[0])}, frame 0, clock 0, the record)`);
    // worker 0254: the sounds are torn down as at the stage start (FUN_003ffbb8; A4); main's flag-18 branch starts the music itself
    ok(music === 1 && musicArg === true && resets === 1 && outR.record === 1 && !outR.soldierHandOff, `the record's teardown of the sounds runs (music(record = ${musicArg})), no opening hand-off`);
    // 3. main from its top with the record's flags (play.js startStage(false, 0, rec.gflags))
    const F2 = { v: { ...rec.sflags } };
    const B = mk(F2, { globalFlags: Uint8Array.from(rec.gflags), settle: false });
    B.run(400);
    const calls = B.c.rt.vm.calls;
    ok(!calls.includes('ev0101.rv_matiawase') && !B.c.rt.log.some(([, m]) => /first_event/.test(m)),
       'resume: neither the opening nor rv_matiawase plays again (main\'s first beats\' tests fail on the record\'s flags)');
    ok(B.c.globalFlags[18] === 0 && (F2.v[9] | 0) === 1, `resume: main's flag-18 branch ran (global 18 -> ${B.c.globalFlags[18]}, stage flag 9 -> ${F2.v[9]}; T 0 / 1)`);
    ok(B.vin.pos && Math.abs(B.vin.pos[0] + 889.2) < 1e-3 && Math.abs(B.vin.pos[2] + 599) < 1e-3 && B.vin.face && Math.abs(B.vin.face[0] + 1) < 1e-6,
       `resume: Vincent handed back at ${B.vin.pos && B.vin.pos.map(v => v.toFixed(3))} facing ${B.vin.face && B.vin.face.map(v => v.toFixed(4))} (T (-889.2, -0.0636, -599) facing (-1, 0, 0))`);
    ok(B.c.battle, 'resume: battle mode after main\'s battle()');
    // worker 0254 (H3): T w254's call log across a record reload: f3132 battle() -> FUN_00324e70 nothing, f3148 the stage init, f3977
    // battle() -> FUN_00319190, FUN_005453b0 -> FUN_005459d8. So the first battle() has no pass and the flag-18 branch's has it.
    { let pass = 0; const F3 = { v: { 0: 2, 1: 5, 2: 7, 46: 1 } }, tg = new Uint8Array(64);   // T: w242's / w254's record
      tg[0] = 1; tg[1] = 5; tg[18] = 1; tg[55] = 7;
      const C = mk(F3, { globalFlags: tg, settle: false, stagePass: () => { pass++; C.flag9 = F3.v[9] | 0; } });
      C.run(400);
      const lines = C.c.rt.log.filter(([, m]) => /^battle(:| \d)/.test(m)).map(([, m]) => m);
      ok(pass === 1 && lines[0] === 'battle: no stage object yet (FUN_00324e70: nothing)' && C.flag9 === 1,
        `record reload: the first battle() sends nothing, the second runs the stage pass once, stage flag 9 already 1 (T w254 f3132 / f3977): pass ${pass}, flag 9 ${C.flag9}`); }
    // the music natives are heard on a record's reload (no opening to wait for)
    { const mus = []; const F4 = { v: { ...rec.sflags } };
      const D = mk(F4, { globalFlags: Uint8Array.from(rec.gflags), settle: false, music: () => ({ playMusic3: n => mus.push(n), changeMusicVol() {}, stopMusic() {} }) });
      D.run(40);
      ok(mus.includes('bgm_001'), `record reload: main's playMusic3 reaches the music (${mus})`); }
    // the stage start's path is unchanged without a record
    const php0 = { hp: 300 }; let rb0 = null;
    restoreCheckpoint({ php: php0, rebuildEnemies: (...a) => { rb0 = a; return null; }, handoff: HO });
    ok(rb0 && rb0[3] === undefined && rb0[1] === CHECKPOINT.frame && php0.hp === 780, 'no record: the stage start (CHECKPOINT frame 24, no record passed)');
  }
}
done();
