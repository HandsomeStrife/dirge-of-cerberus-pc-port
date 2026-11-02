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

// a page in miniature: Vincent, his status, the game over, a follow-camera stand-in, the enemy world
function page() {
  const ctrl = new PL.PlayerController(col, { pos: { x: -1395.63, y: -98.64, z: -1110.51 }, heading: 0.9 });
  const php = { pos: [ctrl.pos.x, ctrl.pos.y, ctrl.pos.z], face: [0, 0, 1], hp: 780, id: 0x16, f118: 0x20209, s64: 0 };
  const sounds = [];
  const opts = { data: AIdata, player: php, quiet: true, damage: true, deadRecs: [41, 42, 43], walkMesh: col, sound: n => sounds.push(n), rand: () => 0.1 };
  const P = { ctrl, php, opts, sounds, W: null, flagsSeen: null, cam: [], weaponResets: 0, music: 0, hudResets: 0,
              fx: { emitters: [1, 2], resets: 0, reset() { this.emitters.length = 0; this.resets++; } },
              sfx: { pending: [{ name: 'x' }] }, gameOver: new GameOver(GD), cape: { cloth: { started: true } } };
  P.W = AI.createEnemyAI(opts); for (const k of AWAKE) P.W.addActor({ rec: k, astate: AWAKE_STATE[k], f118: AWAKE_F118[k] });
  P.follow = { clearDeath() { P.cam.push('clearDeath'); }, reset(pos, s) { P.cam.push(['reset', { ...pos }, s]); } };
  P.sys = () => ({ ctrl, php, follow: P.follow, gameOver: P.gameOver, cape: P.cape, fx: P.fx,
    groundY: (x, z, y) => col.groundY(x, z, y), weapon: { reset() { P.weaponResets++; } }, music: () => { P.music++; },
    hud: { reset() { P.hudResets++; } }, sfx: P.sfx,
    rebuildEnemies: (flags, frame, clock) => { P.flagsSeen = flags; P.W = AI.createEnemyAI({ ...opts, eventFlags: flags, now: clock.now, acc: clock.acc }); P.W.S.frame = frame;
      for (const k of AWAKE) P.W.addActor({ rec: k, astate: AWAKE_STATE[k], f118: AWAKE_F118[k] }); return P.W; } });
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
  ok(r.enemies === P.W && b44 && b44 !== a44 && b44.hp > 0 && P.W.actors.length === AWAKE.length, `a new enemy world: ${P.W.actors.length} soldiers, 44 alive again (hp ${b44 && b44.hp})`);
  ok(!P.W.actors.some(a => [41, 42, 43].includes(a.rec)), '41-43 not active (MISSING: stage-start scripts)');
  ok(warns.some(w => /41-43/.test(w)) && warns.some(w => /Status screen/.test(w)) && warns.some(w => /holstered/.test(w)), 'the left-out parts warn');
  // play resumes: he walks
  const x0 = P.ctrl.pos.x; for (let i = 0; i < 10; i++) P.ctrl.step(WALK());
  ok(P.ctrl.pos.x > x0 + 1, `play resumes: he walks (${(P.ctrl.pos.x - x0).toFixed(2)} u in 10 frames)`);
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
  ok(hpOk, 'HP: Vincent 780 to record 99 (record 100: 736, a hit from 41-43, not on the page), soldiers equal');
}
done();
