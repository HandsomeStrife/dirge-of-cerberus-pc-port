// The video mode on the real play.html (video_mode.js, worker 0295): the default is NTSC, ?video=pal is PAL.
// Holding Shift + W (run), per game frame Vincent moves the mode's step of the run speed (1.0 u at step 1.0 / 60 Hz,
// 1.2 u at step 1.1999999 / 50 Hz: FUN_0040cb78 / FUN_0034c388), so 60 u/s in real time in both; the loop runs
// the mode's frames per second (the page's clock, TICK).
// The game's ms clocks (FUN_0023c1f0: the stage event clock FUN_003798a0, the HUD clock) gain the frame's real length,
// so a stage wait / timer of N ms lasts N ms of game frames in both modes: 1000 / 60 ms a frame NTSC, 20 PAL (worker 0298).
//   flock tools/trace/out/.browser.lock node native/web/test_video_mode_page.mjs   (needs playwright; else SKIP)
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawn, execSync } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';

const WEB = path.dirname(fileURLToPath(import.meta.url));
let fail = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };
const done = () => { console.log(fail ? `${fail} FAILED` : 'all ok'); process.exit(fail ? 1 : 0); };
let chromium;
try {
  const g = execSync('npm root -g', { encoding: 'utf8' }).trim();
  ({ chromium } = createRequire(path.join(g, '/'))('playwright'));
} catch { console.log('SKIP: playwright not installed (npm i -g playwright)'); done(); }

const port = await new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const srv = spawn('python3', ['-I', '-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', WEB], { stdio: 'ignore' });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
async function run(q) {
  const pg = await browser.newPage({ viewport: { width: 480, height: 360 } });
  const errs = [];
  pg.on('pageerror', e => errs.push(e.message));
  for (let i = 0; ; i++) {
    try { await pg.goto(`http://127.0.0.1:${port}/play.html?${q}intro=0&sound=0&enemydmg=0`, { waitUntil: 'load' }); break; }
    catch (e) { if (i > 20) throw e; await new Promise(r => setTimeout(r, 250)); }
  }
  await pg.waitForFunction(() => window.__play && window.__play.stats.ticks > 30, null, { timeout: 240000 });
  await pg.keyboard.down('ShiftLeft'); await pg.keyboard.down('KeyW');
  const r = await pg.evaluate(async () => {
    const P = window.__play, wait = ms => new Promise(res => setTimeout(res, ms));
    // Vincent's position once a game frame: enemyAI.tick runs once in each gameplay frame, after the player's step (play.js),
    // so every frame is seen (a timer poll missed frames when the page ran several in one rAF; worker 0298)
    const A = P.enemyAI, t00 = A.tick, rec = [];
    A.tick = (...a) => { const r = t00.apply(A, a); rec.push([P.ctrl.pos.x, P.ctrl.pos.z]); return r; };
    const t0 = performance.now(), k0 = P.stats.ticks;
    while (rec.length < 41 && performance.now() - t0 < 120000) await wait(20);   // ramp-up, then full run (before any wall: c_run's is ~25 frames in)
    A.tick = t00;
    const t = P.stats.ticks, ms = performance.now() - t0;
    const d = [];
    for (let i = 11; i < rec.length; i++) d.push(Math.hypot(rec[i][0] - rec[i - 1][0], rec[i][1] - rec[i - 1][1]));
    d.sort((a, b) => a - b);
    const rate = (t - k0) * 1000 / ms;
    // the frame rate over a longer quiet stretch (keys up) as well: 120 frames
    const t1 = performance.now(), k1 = P.stats.ticks;
    const c1 = P.stage && P.stage.rt ? P.stage.rt.clock : null, h1 = P.gameHud ? P.gameHud.state.now : null;
    while (P.stats.ticks < k1 + 120 && performance.now() - t1 < 60000) await wait(5);
    // the ms clocks over whole game frames: read in the same task as the tick count (the loop runs in rAF, not between these reads)
    const k2 = P.stats.ticks, clockMs = c1 == null ? null : ((P.stage.rt.clock - c1) >>> 0) / (k2 - k1), hudMs = h1 == null ? null : ((P.gameHud.state.now - h1) >>> 0) / (k2 - k1);
    return { clockMs, hudMs, stageOn: !!(P.stage && !P.stage.done), per: d.length ? d[d.length - 1] : null, samples: d.length, rate: Math.max(rate, (P.stats.ticks - k1) * 1000 / (performance.now() - t1)), run: P.ctrl.anim && P.ctrl.anim.head ? P.ctrl.anim.head.key : null };
  });
  await pg.keyboard.up('KeyW'); await pg.keyboard.up('ShiftLeft');
  await pg.close();
  return { ...r, errs };
}
try {
  const def = await run(''), pal = await run('video=pal&'), ntsc = await run('video=ntsc&');
  for (const [name, r, per, hz] of [['default', def, 1.0, 60], ['?video=ntsc', ntsc, 1.0, 60], ['?video=pal', pal, 1.2, 50]]) {
    console.log(`info ${name}: peak ${r.per && r.per.toFixed(4)} u a game frame (${r.samples} single-frame samples), ${r.rate.toFixed(1)} frames/s`);
    ok(r.per !== null && Math.abs(r.per - per) < 0.01, `${name}: running, ${r.per && r.per.toFixed(4)} u a game frame (the mode's step x 1.0 u/tick: ${per})`);
    // the loop banks real time and runs at most 8 frames a drawn frame: under 7.5 drawn frames/s it falls behind, so
    // only the upper bound is firm (no more frames than the mode's rate)
    ok(r.rate <= hz * 1.03 && r.rate > hz * 0.5, `${name}: ${r.rate.toFixed(1)} game frames/s of wall time (mode ${hz} Hz)`);
    // the stage event clock (play.js stage.tick) and the HUD clock: 1000 / hz ms a game frame (16 / 17 / 17 in NTSC: within 1 / 120 frames' rounding)
    ok(r.stageOn && r.clockMs !== null && Math.abs(r.clockMs - 1000 / hz) < 0.02, `${name}: the stage event clock gains ${r.clockMs && r.clockMs.toFixed(3)} ms a game frame (1000 / ${hz} = ${(1000 / hz).toFixed(3)})`);
    ok(r.hudMs !== null && Math.abs(r.hudMs - 1000 / hz) < 0.02, `${name}: the HUD clock gains ${r.hudMs && r.hudMs.toFixed(3)} ms a game frame`);
    ok(r.errs.length === 0, `${name}: no page errors${r.errs.length ? ': ' + r.errs.slice(0, 2).join('; ') : ''}`);
  }
  ok(ntsc.rate > pal.rate * 1.05, `NTSC runs more game frames a second than PAL (${ntsc.rate.toFixed(1)} vs ${pal.rate.toFixed(1)})`);
} finally {
  await browser.close();
  srv.kill();
}
done();
