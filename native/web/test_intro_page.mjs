// The opening event on the page (intro.js, worker 0210): play.html starts with ev0100 scr001, the event camera drives
// the view, play does not tick while it runs, and at its end the Restart path hands Vincent / 41-43 to play.
//   node native/web/test_intro_page.mjs        (needs network for three.js: run with the sandbox off)
// Needs data/event/ev0100_scr001.json (export_web_event.py) + data/checkpoint.json, else SKIP.
// TEST_SHOTS=dir: also saves page screenshots at a few event frames (for game-vs-page images; scratch only).
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
let fail = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };
const done = () => { console.log(fail ? `${fail} FAILED` : 'all ok'); process.exit(fail ? 1 : 0); };
for (const f of ['event/ev0100_scr001.json', 'checkpoint.json', 'enemies/ai.json'])
  if (!fs.existsSync(path.join(here, 'data', f))) { console.log('SKIP: no data/' + f); done(); }
let chromium;
try {
  const g = execSync('npm root -g', { encoding: 'utf8' }).trim();
  ({ chromium } = createRequire(path.join(g, '/'))('playwright'));
} catch { console.log('SKIP: playwright not installed (npm i -g playwright)'); done(); }

const SHOTS = process.env.TEST_SHOTS || null;
const port = await new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const srv = spawn('python3', ['-I', '-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', here], { stdio: 'ignore' });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const pg = await browser.newPage({ viewport: { width: 960, height: 540 } });
  const errs = [], warns = [];
  pg.on('console', m => { if (m.type() === 'error') errs.push(m.text()); if (m.type() === 'warning') warns.push(m.text()); });
  pg.on('pageerror', e => errs.push(e.message));
  for (let i = 0; ; i++) {
    // enemydmg=0: bullets hit without damage, so the soldiers don't kill Vincent during the test's long waits
    try { await pg.goto(`http://127.0.0.1:${port}/play.html?sound=0&enemydmg=0`, { waitUntil: 'load' }); break; }
    catch (e) { if (i > 20) throw e; await new Promise(r => setTimeout(r, 250)); }
  }
  await pg.waitForFunction(() => window.__play && window.__play.intro.rt && window.__play.intro.rt.frameNo > 20, null, { timeout: 120000 });
  const a = await pg.evaluate(() => {
    const P = window.__play, rt = P.intro.rt, v = rt.view, c = P.camera.position;
    return { active: P.intro.active, ticks: P.stats.ticks, view: v && { cam: v.cam, eye: v.eye },
             cam: [c.x, c.y, c.z], hud: !!P.output.hud, vin: P.vin.body.visible, restarts: P.restart.count };
  });
  ok(a.active && a.ticks === 0, `the event runs first; play has not ticked (${a.ticks} ticks)`);
  ok(a.view && a.view.cam === 1, `event camera 1 drives the view (${a.view && a.view.cam})`);
  ok(a.view && a.cam.every((x, i) => Math.abs(x - a.view.eye[i]) < 1e-3), `the render camera sits at the event camera's eye (${a.cam.map(x => x.toFixed(2))})`);
  ok(!a.hud && !a.vin, 'the game HUD and Vincent\'s gameplay body are hidden while it runs');
  // the event's actors (worker 0218; event_actor_rt.js / event_actors.js): with data/event/actors, p005 (Vincent on the
  // railing) plays km0102vn and its body is drawn in the 'event actors' group
  if (fs.existsSync(path.join(here, 'data/event/actors/actors.json'))) {
    const e = await pg.evaluate(() => {
      const P = window.__play, A = P.intro.rt.actors, g = P.root.getObjectByName('event actors');
      const v = A && A.slots.find(x => x.model === 'p005');
      let meshes = 0; if (g) g.traverse(o => { if (o.isMesh && o.visible) { let s = o, vis = true; while (s && s !== g) { vis = vis && s.visible; s = s.parent; } if (vis) meshes++; } });
      return { n: A ? A.slots.length : 0, clip: v && v.mp.clip, frame: v && v.frameDrawn, bodies: g ? g.children.length : 0, meshes };
    });
    ok(e.n >= 6 && e.clip === 'km0102vn' && e.frame > 256, `event actors: ${e.n} slots, p005 plays ${e.clip} at ${e.frame && e.frame.toFixed(1)}`);
    ok(e.bodies >= 6 && e.meshes > 0, `event actor bodies drawn (${e.bodies} bodies, ${e.meshes} visible meshes)`);
  } else console.log('SKIP event actors: no data/event/actors (export_web_event_actors.py)');
  // every rendered frame from here: what the page shows (sampled between renders, so each sample = the last frame drawn)
  await pg.evaluate(() => {
    const P = window.__play, rec = window.__rec = [];
    const step = () => {
      const c = P.camera.position, p = P.ctrl.pos;
      const W = P.enemyAI, sol = W && P.intro.ended >= 1 ? W.actors.filter(a => [41, 42, 43].includes(a.rec)).map(a => [a.rec, a.pos[0], a.pos[2]]) : null;
      rec.push({ active: P.intro.active, ended: P.intro.ended, hud: !!P.output.hud, vin: P.vin.body.visible,
                 cam: [c.x, c.y, c.z], pos: [p.x, p.z], ticks: P.stats.ticks, sol });
      if (rec.length < 200000) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
  // screenshots for the comparison images (event frames; scratch only)
  if (SHOTS) {
    fs.mkdirSync(SHOTS, { recursive: true });
    for (const f of (process.env.TEST_SHOT_FRAMES || '120,450,1000,1600').split(',').map(Number)) {
      await pg.waitForFunction(n => window.__play.intro.rt && window.__play.intro.rt.frameNo >= n, f, { timeout: 300000 });
      const fr = await pg.evaluate(() => window.__play.intro.rt.frameNo);
      await pg.screenshot({ path: path.join(SHOTS, `page_ev${String(fr).padStart(5, '0')}.png`) });
    }
  }
  // the HUD's slot 5 group per game frame (hud.js tick), hooked before the hand-off so its slide-in is seen
  await pg.evaluate(() => {
    const P = window.__play, H = P.gameHud, t0 = H.tick, log = window.__hl = [];
    H.tick = () => { t0(); const st = H.state, g = st.chain[st.groupOf[5]]; log.push({ y: g.rect[1], s: g.slide[0] }); };
  });
  // the camera blocks switch as the script says (event_rt.js log), then the end
  await pg.waitForFunction(() => window.__play.intro.ended === 1, null, { timeout: 600000 });
  const b = await pg.evaluate(() => {
    const rt = window.__play.intro.rt;
    return { frames: rt.frameNo, log: rt.log.map(x => x[1]), state: rt.state };
  });
  const cams = b.log.filter(x => x.startsWith('camera')).map(x => +x.split(' ')[1]);
  ok(cams.join() === '1,2,3,1,2,3,1,2,1', `camera order ${cams.join()}`);
  ok(b.state.usercontrol === 1 && b.state.battlecontrol === 1 && b.state.battlemode === 1, 'main() ends: battle mode 1, user / battle control on');
  ok(b.frames > 1500 && b.frames < 1800, `the event lasts ${b.frames} frames`);
  // the hand-off: the Restart path (uncounted), then play ticks from Vincent's hand-off position (T record 10)
  await pg.waitForFunction(() => window.__play.stats.ticks > 30, null, { timeout: 120000 });
  const c = await pg.evaluate(() => {
    const P = window.__play, p = P.ctrl.pos;
    return { pos: [p.x, p.y, p.z], restarts: P.restart.count, active: P.intro.active, hud: !!P.output.hud, vin: P.vin.body.visible,
             paused: P.pause && P.pause.open };
  });
  ok(!c.active && c.restarts === 0, `the event ended; the hand-off is not counted as a Restart (${c.restarts})`);
  ok(Math.hypot(c.pos[0] + 1395.1516, c.pos[2] + 1111.0149) < 2, `play starts at the hand-off (${c.pos.map(x => x.toFixed(2))}; T record 10: -1395.15, -1111.01, within 2 u after 30 ticks)`);
  ok(c.hud && c.vin, 'the HUD and Vincent are back');
  // no frame between the event's end and the hand-off shows the world before it: still the event's view, hidden
  // bodies, no HUD, no play tick; the first frame after shows Vincent at the hand-off, not at the save's place
  {
    const R = await pg.evaluate(() => window.__rec.filter(r => r.ended >= 1).slice(0, 400));
    const held = R.filter(r => r.active), first = R.find(r => !r.active);
    const still = held.every(r => !r.hud && !r.vin && r.ticks === 0 && r.cam.every((x, i) => Math.abs(x - held[0].cam[i]) < 1e-6));
    ok(held.length > 0 && still, `between the event's end and the hand-off: ${held.length} frames, all the event's last view, hidden, no tick`);
    ok(first && Math.hypot(first.pos[0] + 1395.1516, first.pos[1] + 1111.0149) < 0.05 && first.hud && first.vin,
      `the first frame after shows the hand-off (${first && first.pos.map(x => x.toFixed(3))}; the save's place is -1395.63, -1110.51)`);
  }
  // play after the hand-off: soldiers 41-43 act (42 fires at record 12, all three move at record 24, worker 0204 / 0205),
  // the HUD slides in (hud_core restartedHud), input moves Vincent
  {
    await pg.waitForFunction(t => window.__play.stats.ticks > t, c.ticks + 60, { timeout: 120000 }).catch(() => {});
    const S = await pg.evaluate(() => window.__rec.filter(r => r.ended === 1 && !r.active && r.sol));
    const s0 = S[0] && S[0].sol, s1 = S[S.length - 1] && S[S.length - 1].sol;
    const moved = s0 && s1 ? s1.filter(([r, x, z]) => { const q = s0.find(v => v[0] === r); return q && Math.hypot(x - q[1], z - q[2]) > 3; }).length : 0;
    ok(s0 && s0.length === 3 && moved >= 2, `41-43 act after the hand-off: ${moved} of 3 moved > 3 u (the record-24 hand-off move and their AI)`);
    const hl = await pg.evaluate(() => window.__hl);
    const ys = hl.map(x => x.y);
    ok(hl.length > 20 && new Set(ys.slice(0, 20)).size > 1 && ys[ys.length - 1] === ys[ys.length - 2], `the HUD slides in after the hand-off (slot 5 y ${ys[0]} -> ${ys[ys.length - 1]})`);
    const p0 = await pg.evaluate(() => [window.__play.ctrl.pos.x, window.__play.ctrl.pos.z]);
    await pg.keyboard.down('KeyW'); await pg.waitForTimeout(1500); await pg.keyboard.up('KeyW');
    const p1 = await pg.evaluate(() => [window.__play.ctrl.pos.x, window.__play.ctrl.pos.z]);
    ok(Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) > 3, `input works after the hand-off (W moved him ${Math.hypot(p1[0] - p0[0], p1[1] - p0[1]).toFixed(2)} u)`);
  }
  ok(errs.length === 0, `no page errors (${errs.slice(0, 3).join(' | ')})`);
  const left = warns.filter(w => w.includes('not translated')).length;
  ok(left > 0, `untranslated natives warn (${left} warnings)`);
  // Restart (pause -> Restart -> OK): the stage reload plays the event again, then hands off again (T: w210 restart drive)
  {
    const until = (fn, arg, t = 60000) => pg.waitForFunction(fn, arg, { timeout: t });
    await pg.keyboard.press('Enter');
    await until(() => { const s = window.__play.pause.flow.screen; return s && s.cur === s.total && s.hasFocus && s.focus.id === 3; });
    await pg.keyboard.press('Space');
    await until(() => { const f = window.__play.pause.flow; return !!f.box && f.box.cur === f.box.total; });
    await pg.keyboard.press('ArrowLeft');
    await until(() => window.__play.pause.flow.box.focus.id === 6);
    await pg.keyboard.press('Space');                 // OK
    await until(() => window.__play.restart.count === 1 && window.__play.intro.active && !window.__play.pause.active);
    const r = await pg.evaluate(() => ({ cam: window.__play.intro.rt.view && window.__play.intro.rt.view.cam, t: window.__play.stats.ticks }));
    ok(true, 'Restart plays the opening event again');
    await until(() => window.__play.intro.ended === 2, null, 600000);
    await until(t => window.__play.stats.ticks > t + 10, r.t, 120000);
    const e = await pg.evaluate(() => { const P = window.__play, p = P.ctrl.pos; return { count: P.restart.count, pos: [p.x, p.z], hp: P.php.hp }; });
    ok(e.count === 1 && Math.hypot(e.pos[0] + 1395.1516, e.pos[1] + 1111.0149) < 2 && e.hp > 0,
      `after the replay: one Restart counted, play from the hand-off again (${e.pos.map(x => x.toFixed(2))}, HP ${e.hp})`);
  }
  // game over -> ✕ on Restart: the event again, then the hand-off (the default path; T: w210 restart drive)
  {
    const until = (fn, arg, t = 60000) => pg.waitForFunction(fn, arg, { timeout: t });
    await pg.evaluate(() => { window.__play.php.hp = 0; });
    await until(() => window.__play.gameOver.go.menu && window.__play.gameOver.go.menu.focus && window.__play.gameOver.go.menu.focus.id === 3, null, 60000);
    await pg.waitForTimeout(500);
    await pg.keyboard.press('Space');                 // ✕ on Restart
    await until(() => window.__play.restart.count === 2 && window.__play.intro.active);
    const g = await pg.evaluate(() => ({ hud: !!window.__play.output.hud, vin: window.__play.vin.body.visible, go: window.__play.gameOver.go.active }));
    ok(!g.hud && !g.vin, `game over -> Restart plays the event (HUD / Vincent hidden; game over active ${g.go})`);
    const n0 = await pg.evaluate(() => window.__rec.length);
    await until(() => window.__play.intro.ended === 3 && !window.__play.intro.active, null, 600000);
    await until(t => window.__play.stats.ticks > t + 10, (await pg.evaluate(() => window.__play.stats.ticks)), 60000);
    const R = await pg.evaluate(n => window.__rec.slice(n), n0);
    const after = R.filter(r => r.ended === 3);
    const firstOff = after.find(r => !r.active);
    ok(after.filter(r => r.active).every(r => !r.hud && !r.vin) && firstOff && Math.hypot(firstOff.pos[0] + 1395.1516, firstOff.pos[1] + 1111.0149) < 0.05,
      `game over replay: no frame between its end and the hand-off shows play; then the hand-off (${firstOff && firstOff.pos.map(x => x.toFixed(3))})`);
    const e = await pg.evaluate(() => ({ count: window.__play.restart.count, hp: window.__play.php.hp, go: window.__play.gameOver.go.active }));
    ok(e.count === 2 && e.hp === 780 && !e.go, `after it: two Restarts counted, HP ${e.hp}, game over cleared`);
  }
  // worker 0222: the event pause and Skip (game over -> Restart -> the event; Start holds it (FUN_00376ee0), ✕ = Skip
  // (FUN_00372f70): sleeps / timers end, moves jump, the script runs to its end and the hand-off runs as usual)
  {
    const until = (fn, arg, t = 60000) => pg.waitForFunction(fn, arg, { timeout: t });
    await pg.evaluate(() => { window.__play.php.hp = 0; });
    await until(() => window.__play.gameOver.go.menu && window.__play.gameOver.go.menu.focus && window.__play.gameOver.go.menu.focus.id === 3, null, 60000);
    await pg.waitForTimeout(500);
    await pg.keyboard.press('Space');
    await until(() => window.__play.restart.count === 3 && window.__play.intro.active && window.__play.intro.rt.frameNo > 60, null, 120000);
    await pg.keyboard.press('Enter');
    await until(() => window.__play.intro.paused);
    const f0 = await pg.evaluate(() => window.__play.intro.rt.frameNo);
    await pg.waitForTimeout(1500);
    const f1 = await pg.evaluate(() => ({ n: window.__play.intro.rt.frameNo, pause: window.__play.pause.active }));
    ok(f1.n === f0 && !f1.pause, `Start in the event: the event is held (frame ${f0} -> ${f1.n}), not the gameplay pause menu`);
    await pg.keyboard.press('Space');
    await until(() => window.__play.intro.ended === 4 && !window.__play.intro.active, null, 120000);
    await until(t => window.__play.stats.ticks > t + 10, (await pg.evaluate(() => window.__play.stats.ticks)), 60000);
    const k = await pg.evaluate(() => { const P = window.__play, r = P.intro.rt, p = P.ctrl.pos;
      return { skip: r.skip, n: r.frameNo, log: r.log.filter(x => x[1] === 'skip').map(x => x[0]), pos: [p.x, p.z], bm: r.state.battlemode, count: P.restart.count }; });
    ok(k.skip === 2 && k.log.length === 1 && k.n - k.log[0] < 40, `✕ skips: +0x156c = ${k.skip}, the event ends ${k.n - k.log[0]} frames after the Skip (frame ${k.n})`);
    ok(k.bm === 1 && k.count === 3 && Math.hypot(k.pos[0] + 1395.1516, k.pos[1] + 1111.0149) < 2, `the skipped event still hands off (battle mode ${k.bm}, ${k.pos.map(x => x.toFixed(2))})`);
  }
  // ?intro=0: straight to play from the save, as before
  const pg2 = await browser.newPage({ viewport: { width: 640, height: 360 } });
  await pg2.goto(`http://127.0.0.1:${port}/play.html?sound=0&intro=0`, { waitUntil: 'load' });
  await pg2.waitForFunction(() => window.__play && window.__play.stats.ticks > 10, null, { timeout: 120000 });
  const d = await pg2.evaluate(() => ({ active: window.__play.intro.active, rt: !!window.__play.intro.rt }));
  ok(!d.active && !d.rt, '?intro=0 skips the event');
  await pg2.close();
  // worker 0222: with sound on, the opening's own sound reaches the page's back ends: asj_036 (playBgAreaSound), the
  // voices (VoicePlayer: fetched, decoded, started), bgm_274 (playMusic2 -> GameMusic.open)
  {
    const pg3 = await browser.newPage({ viewport: { width: 640, height: 360 } });
    const errs3 = []; pg3.on('pageerror', e => errs3.push(String(e)));
    await pg3.goto(`http://127.0.0.1:${port}/play.html`, { waitUntil: 'load' });
    await pg3.waitForFunction(() => window.__play && window.__play.intro.rt && window.__play.intro.rt.frameNo > 5, null, { timeout: 120000 });
    await pg3.keyboard.press('ShiftLeft');                // the browser's first gesture (AudioContext)
    await pg3.waitForFunction(() => window.__play.intro.rt.frameNo > 140, null, { timeout: 300000 });
    const v = await pg3.evaluate(() => { const r = window.__play.intro.rt, V = r.sound.voices(); return { log: V.log.slice(), out: !!V.out, area: r.lastArea, ctx: !!(window.__play.pauseSound.audio && window.__play.pauseSound.audio.ctx) }; });
    ok(v.ctx && v.log[0] === '10109vn' && v.out && v.area && v.area[0] === 'asj_036', `sound on: AudioContext ${v.ctx}, voice ${v.log[0]} started (${v.out}), area ${v.area && v.area[0]}`);
    await pg3.waitForFunction(() => window.__play.intro.rt.frameNo > 960, null, { timeout: 600000 });
    const m = await pg3.evaluate(() => window.__play.pauseSound.music && window.__play.pauseSound.music.name);
    ok(m === 'bgm_274', `playMusic2: the music stream is ${m}`);
    ok(errs3.length === 0, `sound on: no page errors (${errs3.slice(0, 2).join(' | ')})`);
    await pg3.close();
  }
} finally {
  await browser.close();
  srv.kill();
}
done();
