// test_boss_dive_page.mjs -- the boss's dive (state 4, atk_sp1) on the real play.html against the game (worker 0259; notes/boss-research.md
// 'The walked arena'). T: w259_boss_box4b (route r0b_box4, Vincent walked into btbox4, no input): state 4 at f855, flight f927 (clip frame
// 2 x 42.6 past 84), arrival f968 at (732.5, -100, 1406.8) = 60 u short of Vincent (734.3, -100, 1466.7); the volume's hit f944 takes 191 HP and
// knocks him down; timer 0 re-stamped until he stands (h_st f1107), state 3 at f1156 (59 ticks = 49 frames).
//   node native/web/test_boss_dive_page.mjs
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawn, execSync } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const T6 = { volley: 191, done: 304 };
let fail = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };
const done = () => { console.log(fail ? `${fail} FAILED` : 'all ok'); process.exit(fail ? 1 : 0); };
for (const f of ['data/enemies/ai.json', 'data/enemies/e024.glb'])
  if (!existsSync(path.join(here, f))) { console.log(`SKIP: ${f} missing (tools/byo/build_web.sh)`); done(); }
let chromium;
try {
  const g = execSync('npm root -g', { encoding: 'utf8' }).trim();
  ({ chromium } = createRequire(path.join(g, '/'))('playwright'));
} catch { console.log('SKIP: playwright not installed (npm i -g playwright)'); done(); }

const port = await new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const srv = spawn('python3', ['-I', '-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', here], { stdio: 'ignore' });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const pg = await browser.newPage({ viewport: { width: 640, height: 480 } });
  const errs = [], warns = [];
  pg.on('console', m => { if (m.type() === 'error') errs.push(m.text()); if (m.type() === 'warning' && /boss|enemy_ai|stage/.test(m.text())) warns.push(m.text()); });
  pg.on('pageerror', e => errs.push(e.message));
  const OPTIONAL = new Set(['/game_state.js', '/stage_info.js']);
  pg.on('response', r => { if (r.status() !== 404) return; const u = r.url().replace(/^http:..[^/]+/, ''); if (!OPTIONAL.has(u)) errs.push('404 ' + u); });
  // the camera: at btbox5's centre, 60 u up, looking at btbox0 (BOSS_SHOT only)
  const cam = process.env.BOSS_SHOT ? '&cam=' + (process.env.BOSS_CAM || '600,-160,1300,45,-12') : '';
  for (let i = 0; ; i++) {
    try { await pg.goto(`http://127.0.0.1:${port}/play.html?intro=0&sound=0${cam}`, { waitUntil: 'load' }); break; }
    catch (e) { if (i > 20) throw e; await new Promise(r => setTimeout(r, 250)); }
  }
  await pg.waitForFunction(() => window.__play && window.__play.stats.ticks > 30 && window.__play.enemyAI && window.__play.enemies && window.__play.stage, null, { timeout: 180000 });

  // 1. the route: flags as 0231's trace recipe; see whether the stage controller takes the boss block
  await pg.evaluate(() => { const P = window.__play; P.enemyAI.eventFlags[0] = 36; P.stage.globalFlags[19] = 1; });
  const routed = await pg.waitForFunction(() => window.__play.enemyAI.bossPlugin, null, { timeout: 60000 }).then(() => true).catch(() => false);
  // worker 0237: no harness fallback any more: the page's own stage controller must take main's boss block (Zone.boss(true))
  // and its stage-load pass must send event 0x23 (record 32 active); the test fails otherwise
  ok(routed, `the page's stage controller reaches Zone.boss(true) within 60 s (${routed})`);
  await pg.waitForFunction(() => window.__play.enemyAI.objects.get(32 + 22).flags28 & 1, null, { timeout: 20000 }).catch(() => null);
  const st0 = await pg.evaluate(() => {
    const W = window.__play.enemyAI, a = W.objects.get(32 + 22);
    return { kind: a.kind, hp: a.hp, gauge: { ...W.hudGauge() }, mode: a.ai ? a.ai.mode : null };
  });
  ok(st0.kind === 'actor' && st0.hp === 17000, `event 0x23 at flag 0 = 36: record 32 active with HP 17000 (T w231_boss4: 17000 at difficulty 1): ${st0.kind} ${st0.hp}`);
  if (st0.kind !== 'actor') {
    // the 0x23 on this route is battle()'s stage-load pass (FUN_00324e70 -> FUN_005453b0 -> FUN_005459d8, T w240_boss)
    ok(false, 'the boss is not active (no 0x23 from battle()\'s stage-load pass): the remaining checks are skipped');
    throw Object.assign(new Error('stop'), { stop: true });
  }
  ok(st0.gauge.id === 13 && st0.gauge.v === 7000 && st0.gauge.max === 7000 && st0.gauge.c59 === 1, `HUD gauge 13 = 7000 / 7000, shown (manager 0x6e / 0x6f): ${JSON.stringify(st0.gauge)}`);
  const brain = await pg.waitForFunction(() => { const a = window.__play.enemyAI.objects.get(54); return a.ai && a.ai.mode === 0x100 && a.ai.boss && a.ai.boss.st >= 2 ? { st: a.ai.boss.st, pos: a.pos.slice() } : false; },
    null, { timeout: 30000 }).then(h => h.jsonValue()).catch(() => null);
  ok(!!brain && Math.abs(brain.pos[0] - 850) < 1 && Math.abs(brain.pos[2] - 1450) < 1, `AI mode 0x100 with the overlay brain, past states 0 / 1, at btbox0 (850, -110, 1450): ${brain ? JSON.stringify(brain) : 'no'}`);
  const drawn = await pg.waitForFunction(() => { const a = window.__play.enemies.actors.find(x => x.rec === 32); return a && a.body && a.body.parent ? { model: a.model, clip: a.head ? a.head.clip : null } : false; },
    null, { timeout: 60000 }).then(h => h.jsonValue()).catch(() => null);
  ok(!!drawn && drawn.model === 'e024', `the boss is drawn (enemies.js): ${drawn ? JSON.stringify(drawn) : 'no'}`);

  // Every timing below is counted in the brain's own updates (a.boss.update wrapped, vt+0x1c, once a game frame), so a loaded machine can't shift it.
  await pg.evaluate(() => {
    const a = window.__play.enemyAI.objects.get(54), up = a.boss.update;
    window.__bossN = 0; window.__bossHooks = [];
    a.boss.update = () => { up(); window.__bossN++; for (const h of window.__bossHooks) h(); };
    window.__bossUntil = (fn, ms) => new Promise(res => {
      const t0 = performance.now(), h = () => { if (fn() || performance.now() - t0 > ms) { window.__bossHooks.splice(window.__bossHooks.indexOf(h), 1); res(); } };
      window.__bossHooks.push(h);
    });
  });
  // 2. Same conditions as T: boss at btbox1, brain's target at the traced spot. The page's collision is streamed, so Vincent's body cannot be
  // teleported to the far side (harness step: only the brain's target is pinned; no hit happens in this part).
  const A = await pg.evaluate(async () => {
    const P = window.__play, W = P.enemyAI, a = W.objects.get(54), b = a.boss.brain, ai = a.boss.ai;
    P.php.hp = 9999;
    const pl = b.player; window.__realPlayer = pl; b.player = { pos: [734.3, -100, 1466.7], C: pl.C };
    const wait = ms => new Promise(r => setTimeout(r, ms));
    for (let i = 0; i < 4000 && (Math.hypot(a.pos[0] - 730, a.pos[2] - 1320) > 2 || ai.st !== 2); i++) await wait(25);
    b.count = 2; b.alt = 1;
    const seen = {}; let end = null;
    await window.__bossUntil(() => {
      const k = ai.st + '/' + b.sub;
      if (ai.st === 4 && !(k in seen)) seen[k] = window.__bossN;
      if (seen['4/1'] !== undefined && ai.st !== 4) { end = a.pos.slice(); return true; }
      return false;
    }, 120000);
    return { seen, end, near: Math.hypot(a.pos[0] - 730, a.pos[2] - 1320) };
  });
  const sA = A.seen;
  ok(sA['4/1'] !== undefined && A.end, `state 4 from state 2 at count 2, alternation 1, Vincent in btbox4 (FUN_00aa16f8): ${JSON.stringify(sA)}`);
  if (A.end) {
    ok(Math.abs(sA['4/2'] - sA['4/1'] - 71) <= 1, `flight starts when the clip passes 84 (T 71 frames; page ${sA['4/2'] - sA['4/1']})`);
    ok(Math.abs(sA['4/3'] - sA['4/2'] - 41) <= 1, `flight lasts as the game's (T 41 frames; page ${sA['4/3'] - sA['4/2']})`);
    ok(Math.hypot(A.end[0] - 732.5, A.end[1] + 100, A.end[2] - 1406.8) < 0.5, `stops 60 u short of him (T 732.5, -100, 1406.8; page ${A.end.map(v => v.toFixed(1))})`);
  }
  // 2a. A second dive at the same pinned target (worker 0259, a review's find): the body is already 60 u short of it, so FUN_005889c8 starts a
  // move of 0 u: FUN_0034bd10 returns 0 -> FUN_0034d870(C, 0) = arrived at once (fly_mover.js arrive). Without that the body went NaN.
  const A2 = await pg.evaluate(async () => {
    const P = window.__play, W = P.enemyAI, a = W.objects.get(54), b = a.boss.brain, ai = a.boss.ai;
    P.php.hp = 9999;
    const pl = window.__realPlayer;                                            // still pinned from part 2: the body never left its dive's end
    const seen = {}, start = P.stats.ticks; let nan = false, end = null, len = null, pos2 = null;
    await window.__bossUntil(() => {
      if (seen['4/1'] === undefined && ai.st === 2) { b.count = 2; b.alt = 1; }
      const k = ai.st + '/' + b.sub;
      if (ai.st === 4 && !(k in seen)) { seen[k] = window.__bossN; if (k === '4/2') { len = a.C.len; pos2 = a.pos.slice(); } }
      if (!a.pos.every(Number.isFinite)) nan = true;
      if (seen['4/1'] !== undefined && ai.st !== 4) { end = a.pos.slice(); return true; }
      return nan;
    }, 150000);
    await new Promise(r => setTimeout(r, 1500));
    const after = P.stats.ticks; await new Promise(r => setTimeout(r, 500));
    b.player = pl;
    return { seen, nan, end, pos: a.pos.slice(), ticking: P.stats.ticks > after, len, pos2, seen2: seen };
  });
  ok(A2.len !== null && A2.len < 0.001, `the second dive's move is under FUN_0034bd10's 0.001 u (length ${A2.len}, from ${A2.pos2 && A2.pos2.map(v => v.toFixed(2))}; ${JSON.stringify(A2.seen2)})`);
  ok(!A2.nan && A2.end && A2.pos.every(Number.isFinite), `second dive from its own end point: the body stays finite (${A2.nan ? 'NaN' : A2.pos.map(v => v.toFixed(1))})`);
  ok(A2.end && Math.hypot(A2.end[0] - 732.5, A2.end[1] + 100, A2.end[2] - 1406.8) < 0.5, `and stays where it was (${A2.end ? A2.end.map(v => v.toFixed(1)) : '-'})`);
  ok(A2.ticking, 'the game keeps ticking');
  // 2b. State 6 (T w259_boss_box4c: state 6 f1955, clip f1956, volley f2147 (clip frame 228), clip end f2260, state 2 f2286)
  const six = await pg.evaluate(async () => {
    const P = window.__play, W = P.enemyAI, a = W.objects.get(54), b = a.boss.brain, ai = a.boss.ai;
    P.php.hp = 9999;
    const pl = b.player; b.player = { pos: [734.3, -100, 1466.7], C: pl.C };
    const seen = {}; let shots = 0; const ids = new Set();
    await window.__bossUntil(() => {
      if (seen['6/1'] === undefined && ai.st !== 6) { b.count = 2; b.alt = 0; }
      const k = ai.st + '/' + b.sub;
      if (ai.st === 6 && !(k in seen)) seen[k] = window.__bossN;
      for (const s of W.bullets) if (s.shooter === 54 && s.hm === 1 && seen['6/2'] !== undefined && window.__bossN - seen['6/2'] < 6) ids.add(s.id);
      return seen['6/1'] !== undefined && ai.st !== 6;
    }, 180000);
    b.player = pl;
    return { seen, shots: ids.size };
  });
  ok(six.seen['6/2'] !== undefined && Math.abs(six.seen['6/2'] - six.seen['6/1'] - T6.volley) <= 1, `state 6: the volley at clip frame 228 (T ${T6.volley} frames; page ${six.seen['6/2'] - six.seen['6/1']})`);
  ok(six.shots === 4, `state 6: 4 homing missiles (T slots 0, 1, 4, 5; page ${six.shots})`);
  ok(six.seen['6/3'] !== undefined && Math.abs(six.seen['6/3'] - six.seen['6/1'] - T6.done) <= 1, `state 6: the clip's end (T ${T6.done} frames; page ${six.seen['6/3'] - six.seen['6/1']})`);
  // 3. A real hit: Vincent stands in btbox4 where the streamed collision holds him
  const R = await pg.evaluate(async () => {
    const P = window.__play, W = P.enemyAI, a = W.objects.get(54), b = a.boss.brain, ai = a.boss.ai;
    const put = () => { P.ctrl.pos.x = 620; P.ctrl.pos.y = -100; P.ctrl.pos.z = 1466; };
    P.php.hp = 9999;
    const log = { hp0: null, hp1: null, classes: [], stand: null, st3: null, stamped: 0, clips: [] }; let t0v = null;
    await window.__bossUntil(() => {
      if (ai.st !== 4 && log.hp0 === null) { put(); b.count = 2; b.alt = 1; }
      if (ai.st === 4 && log.hp0 === null) log.hp0 = P.php.hp;
      if (log.hp0 !== null) {
        if (log.hp1 === null && P.php.hp < log.hp0) log.hp1 = P.php.hp;
        const c = P.php.motionClass;
        if (log.classes.at(-1) !== c) { if (log.hp1 !== null && c === 3 && [0x34, 0x35, 0x36, 0x37, 0x39, 0x3a].includes(log.classes.at(-1))) { log.stand = window.__bossN; log.standSt = ai.st; } log.classes.push(c); }
        const k = P.anim.head && P.anim.head.key; if (log.clips.at(-1) !== k) log.clips.push(k);
        if (ai.st === 2 && b.sub === 1) { if (t0v !== null && t0v !== b.t[0] && [0x34, 0x35, 0x36, 0x37, 0x39, 0x3a].includes(c)) log.stamped++; t0v = b.t[0]; }
        if (b.moves) log.movesAtEnd = Math.max(log.movesAtEnd ?? 0, b.moves);
        if (log.stand !== null && ai.st === 3) { log.st3 = window.__bossN; return true; }
      }
      return false;
    }, 240000);
    return log;
  });
  ok(R.hp0 !== null && R.hp0 - R.hp1 === 191, `the volume's hit takes 191 HP (T 9810 -> 9619; page ${R.hp0} -> ${R.hp1})`);
  ok(R.clips.includes('c_fl_1') && R.clips.includes('h_rev_0'), `he is knocked down and gets up (T c_fl_1, h_rev_0; page ${R.clips.join()})`);
  ok(R.stamped > 20, `timer 0 is re-stamped while he is down (FUN_00aa2bb8; ${R.stamped} stamps)`);
  // (only when the brain stayed at its box: three moves in state 2 go to state 3 without the wait, FUN_00aa16f8; the trace's every frame is in test_boss_trace)
  if (R.movesAtEnd) console.log(`  (the boss moved ${R.movesAtEnd} times while he was down: the wait isn't measured in this run)`);
  else ok(R.st3 !== null && Math.abs(R.st3 - R.stand - 49) <= 1, `state 3 comes 59 ticks after he stands (T 49 frames; page ${R.st3 - R.stand}; brain state ${R.standSt} as he stood, classes ${R.classes.map(c => c.toString(16))})`);
  ok(errs.length === 0, `no page errors${errs.length ? ': ' + errs.slice(0, 5).join(' | ') : ''}`);
} catch (e) { if (!e.stop) throw e; } finally {
  await browser.close();
  srv.kill();
}
done();
