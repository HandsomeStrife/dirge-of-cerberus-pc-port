// The game over on the real play.html, in a headless browser (worker 0192):
//   1. HP 0: the pause no longer opens; the Restart / Quit box opens 293 game frames after the death frame's clock
//      (91 to the request, 1 to the sequence, 200 = 4000 ms to the menu); ✕ on Restart reloads the page 1 s later.
//      The 293 include the GUESS 'the title file read finishes at once' (the game spends 9 more frames: 302).
//   2. down + ✕ on Quit: a warning, no reload. 3. H (the page's respawn) resets the game over; a new death restarts it.
//   GAMEOVER_SHOT=<png> saves the open box.  node native/web/test_gameover_page.mjs (needs playwright + data; else SKIP)
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
for (const f of ['pause.json', 'gameover.json'])
  if (!fs.existsSync(path.join(here, 'data', f))) { console.log('SKIP: no data/' + f); done(); }
let chromium;
try {
  const g = execSync('npm root -g', { encoding: 'utf8' }).trim();
  ({ chromium } = createRequire(path.join(g, '/'))('playwright'));
} catch { console.log('SKIP: playwright not installed (npm i -g playwright)'); done(); }

const port = await new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const srv = spawn('python3', ['-I', '-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', here], { stdio: 'ignore' });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
async function open() {
  const pg = await browser.newPage({ viewport: { width: 960, height: 540 } });
  const errs = [], warns = [];
  pg.on('console', m => { if (m.type() === 'error') errs.push(m.text()); if (m.type() === 'warning') warns.push(m.text()); });
  pg.on('pageerror', e => errs.push(e.message));
  for (let i = 0; ; i++) {
    try { await pg.goto(`http://127.0.0.1:${port}/play.html`, { waitUntil: 'load' }); break; }
    catch (e) { if (i > 20) throw e; await new Promise(r => setTimeout(r, 250)); }
  }
  await pg.waitForFunction(() => window.__play && window.__play.stats.ticks > 30, null, { timeout: 120000 });
  await pg.evaluate(() => window.__play.packsReady);
  return { pg, errs, warns };
}
// kill Vincent between two game frames; returns the game over clock at that moment
const kill = pg => pg.evaluate(() => {
  const G = window.__play.gameOver;
  window.__menuAt = null;
  const o = G.go.openMenu.bind(G.go);
  G.go.openMenu = now => { window.__menuAt = now; return o(now); };
  window.__play.php.hp = 0;
  return G.clock;
});
const menuOpen = pg => pg.waitForFunction(() => window.__menuAt !== null && window.__play.gameOver.go.menu, null, { timeout: 60000 });
try {
  { // 1
    const { pg, errs } = await open();
    ok(await pg.evaluate(() => !!(window.__play.gameOver && window.__play.gameOver.go.D)), 'game over loaded with its menu data');
    const c0 = await kill(pg);
    await pg.waitForTimeout(300);
    await pg.keyboard.press('Enter');
    await pg.waitForTimeout(300);
    ok(!(await pg.evaluate(() => window.__play.pause.active)), 'dead: Start does not open the pause (FUN_00241760(1, 3, 0))');
    await menuOpen(pg);
    const dt = (await pg.evaluate(() => window.__menuAt)) - c0;
    ok(dt === 293 * 20, `menu opens 293 game frames after the death (clock +${dt} ms; 5860 expected)`);
    await pg.waitForTimeout(400);                  // the 100 ms open
    if (process.env.GAMEOVER_SHOT) await pg.screenshot({ path: process.env.GAMEOVER_SHOT });
    ok(await pg.evaluate(() => window.__play.gameOver.go.menu.focus.id === 3), 'Restart focused (layout 0x477c38)');
    await pg.evaluate(() => { window.__marker = 1; });
    await pg.keyboard.press('Space');
    await pg.waitForFunction(() => !window.__marker, null, { timeout: 20000, polling: 100 }).catch(() => {});
    ok(await pg.evaluate(() => !window.__marker), '✕ on Restart: the page reloads (GUESS stand-in)');
    ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.slice(0, 2).join(' | ') : ''));
    await pg.close();
  }
  { // 2 + 3
    const { pg, warns } = await open();
    const pauseToggles = async () => {             // Start opens the pause, Start again closes it
      await pg.keyboard.press('Enter'); await pg.waitForTimeout(300);
      const on = await pg.evaluate(() => window.__play.pause.active);
      await pg.keyboard.press('Enter'); await pg.waitForTimeout(500);
      return on && !(await pg.evaluate(() => window.__play.pause.active));
    };
    ok(await pauseToggles(), 'alive: the pause opens and closes as before');
    await kill(pg);
    await menuOpen(pg);
    await pg.waitForTimeout(300);
    await pg.evaluate(() => { window.__marker = 1; });
    await pg.keyboard.press('ArrowDown'); await pg.waitForTimeout(100);
    ok(await pg.evaluate(() => window.__play.gameOver.go.menu.focus.id === 4), 'down: Quit');
    await pg.keyboard.press('Space');
    await pg.waitForFunction(() => !window.__play.gameOver.go.active, null, { timeout: 20000 });
    ok(await pg.evaluate(() => window.__marker === 1), 'Quit: no reload');
    ok(warns.some(w => /Quit; the page has no title/.test(w)), 'Quit: warned (no title on the page)');
    // after Quit the game over stays done (DAT_0047dbb4; the game is at its title); H resets it
    await pg.keyboard.press('KeyH'); await pg.waitForTimeout(500);
    ok(await pg.evaluate(() => { const g = window.__play.gameOver.go; return g.wm === 2 && !g.pauseBlocked && !g.started && !g.active && window.__play.php.hp === 780; }),
       'H (page respawn) resets the game over');
    ok(await pauseToggles(), 'after H: the pause opens again');
    await kill(pg);
    await pg.waitForFunction(() => window.__play.gameOver.go.wm === 3, null, { timeout: 20000 });
    ok(true, 'a death after H starts the timer again');
    await pg.close();
  }
} finally {
  await browser.close(); srv.kill();
}
done();
