// The pause menu on the real play.html, in a headless browser:
//   1. (pointer reported locked) a click on the canvas while paused leaves no R1 press behind: after the resume no shot
//      fires (aim.js isFrozen covers `paused`); the same click unpaused does fire (counterfactual);
//   2. a present but malformed data/pause.json: the page runs without the pause menu (a warning,
//      no page error, __play.pause null).
//   3. the confirm box: ✕ opens it, ○ cancels, OK on Quit warns, OK on Restart goes to the checkpoint (PAUSE_SHOT=<png> saves the open box).
//   node native/web/test_pause_page.mjs            (needs playwright and data/pause.json; else SKIP, exit 0)
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
if (!fs.existsSync(path.join(here, 'data/pause.json'))) { console.log('SKIP: no data/pause.json (run export_web_pause.py)'); done(); }
let chromium;
try {
  const g = execSync('npm root -g', { encoding: 'utf8' }).trim();
  ({ chromium } = createRequire(path.join(g, '/'))('playwright'));
} catch { console.log('SKIP: playwright not installed (npm i -g playwright)'); done(); }

const port = await new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const srv = spawn('python3', ['-I', '-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', here], { stdio: 'ignore' });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
async function open(q = '', route = null) {
  const pg = await browser.newPage({ viewport: { width: 960, height: 540 } });
  const errs = [], warns = [];
  pg.on('console', m => { if (m.type() === 'error') errs.push(m.text()); if (m.type() === 'warning') warns.push(m.text()); });
  pg.on('pageerror', e => errs.push(e.message));
  if (route) await pg.route('**/data/pause.json', route);
  for (let i = 0; ; i++) {
    try { await pg.goto(`http://127.0.0.1:${port}/play.html${q}`, { waitUntil: 'load' }); break; }
    catch (e) { if (i > 20) throw e; await new Promise(r => setTimeout(r, 250)); }
  }
  await pg.waitForFunction(() => window.__play && window.__play.stats.ticks > 30, null, { timeout: 120000 });
  await pg.evaluate(() => window.__play.packsReady);
  return { pg, errs, warns };
}
const wait = (pg, ms) => pg.waitForTimeout(ms);
const click = async pg => { await pg.mouse.move(480, 270); await pg.mouse.down(); await wait(pg, 40); await pg.mouse.up(); };
try {
  { // 1. click while paused
    const { pg, errs } = await open();
    await pg.evaluate(() => {                     // count the shots aim.js fires (onShot)
      // headless has no pointer lock: report the canvas as locked so a click is R1 (aim.js mouseR1Gate)
      const cv = window.__play.renderer.domElement;
      Object.defineProperty(document, 'pointerLockElement', { get: () => cv, configurable: true });
      const A = window.__play.aim; window.__shots = 0;
      const o = A.onShot; A.onShot = (...x) => { window.__shots++; return o && o(...x); };
    });
    const shots = () => pg.evaluate(() => window.__shots);
    ok(await pg.evaluate(() => !!window.__play.pause), 'pause menu loaded');
    await click(pg); await wait(pg, 1000);       // draw
    await click(pg); await wait(pg, 1500);       // fire: the counterfactual, a click does shoot
    const s0 = await shots();
    ok(s0 >= 1, `an unpaused click fires (${s0} shot(s))`);
    await wait(pg, 500);
    await pg.keyboard.press('Enter'); await wait(pg, 300);
    ok(await pg.evaluate(() => window.__play.pause.active), 'Enter opens the pause menu');
    await click(pg); await wait(pg, 200);
    await pg.keyboard.press('Enter'); await wait(pg, 400);
    ok(await pg.evaluate(() => !window.__play.pause.active), 'Enter closes it');
    await wait(pg, 1500);
    const s1 = await shots();
    ok(s1 === s0, `no shot after the resume from a click while paused (${s1 - s0} extra)`);
    ok(errs.length === 0, 'no console / page errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
    await pg.close();
  }
  { // 3. the confirm box (worker 0189): ✕ on Restart opens it, ○ cancels it, OK on Quit only warns,
    // OK on Restart goes to the checkpoint (no reload)
    const { pg, errs, warns } = await open();
    const st = () => pg.evaluate(() => { const f = window.__play.pause.flow; return { active: f.active, box: f.box ? f.box.boxId : null, focus: f.box ? f.box.focus.id : f.screen && f.screen.focus.id }; });
    // wait on the flow's state, not on time (the machine may be loaded): box present / gone
    const until = (fn, arg) => pg.waitForFunction(fn, arg, { timeout: 20000 });
    const boxOpen = () => until(() => { const f = window.__play.pause.flow; return !!f.box && f.box.cur === f.box.total; });
    const boxGone = () => until(() => !window.__play.pause.flow.box);
    const pauseFocus = id => until(i => { const s = window.__play.pause.flow.screen; return s && s.cur === s.total && s.hasFocus && s.focus.id === i; }, id);
    await pg.keyboard.press('Enter'); await pauseFocus(3);
    await pg.keyboard.press('Space'); await boxOpen();
    let s = await st();
    ok(s.active && s.box === 0x25 && s.focus === 7, `✕ on Restart opens box 0x25 with CANCEL focused (${JSON.stringify(s)})`);
    if (process.env.PAUSE_SHOT) await pg.screenshot({ path: process.env.PAUSE_SHOT });
    await pg.keyboard.press('Backspace'); await boxGone();
    s = await st();
    ok(s.active && s.box === null && s.focus === 3, `○ closes the box, the pause stays with Restart focused (${JSON.stringify(s)})`);
    await pg.keyboard.press('ArrowDown'); await pauseFocus(4);
    await pg.keyboard.press('ArrowDown'); await pauseFocus(5);
    await pg.keyboard.press('Space'); await boxOpen();
    await pg.keyboard.press('ArrowLeft');
    await until(() => window.__play.pause.flow.box.focus.id === 6);
    await pg.keyboard.press('Space'); await boxGone(); await pauseFocus(5);
    s = await st();
    ok(s.active && s.box === null && warns.some(w => w.includes('quit confirmed')), `OK on Quit: warning, box closed, pause open (${JSON.stringify(s)})`);
    await pg.keyboard.press('ArrowUp'); await pauseFocus(4);
    await pg.keyboard.press('ArrowUp'); await pauseFocus(3);
    await pg.keyboard.press('Space'); await boxOpen();
    await pg.keyboard.press('ArrowLeft');
    await until(() => window.__play.pause.flow.box.focus.id === 6);
    await pg.evaluate(() => { window.__marker = 1; });
    await pg.keyboard.press('Space');
    await until(() => window.__play.restart.count === 1 && !window.__play.pause.active);
    ok(await pg.evaluate(() => window.__marker === 1), 'OK on Restart: the checkpoint, no page reload (checkpoint.js)');
    ok(errs.length === 0, 'box: no console / page errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
    await pg.close();
  }
  { // 2. malformed pause.json
    const { pg, errs, warns } = await open('', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
    ok(await pg.evaluate(() => window.__play.pause === null), 'malformed pause.json: __play.pause is null');
    ok(warns.some(w => w.includes('pause menu: bad')), 'malformed pause.json: warned');
    ok(errs.length === 0, 'malformed pause.json: no page errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
    await pg.close();
  }
} catch (e) { ok(false, 'exception: ' + (e && e.stack || e)); }
await browser.close(); srv.kill();
done();
