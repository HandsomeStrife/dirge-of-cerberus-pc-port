// The game over on the real play.html, in a headless browser (worker 0192):
//   1. HP 0: the pause no longer opens; the Restart / Quit box opens 293 game frames after the death frame's clock
//      (91 to the request, 1 to the sequence, 200 = 4000 ms to the menu); ✕ on Restart goes to the checkpoint 1 s later (no reload).
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
  window.__titleAt = null; window.__beginAt = null;      // worker 0198: the title's spawn vs the request
  const b = G.go.begin.bind(G.go);
  G.go.begin = (...x) => { window.__beginAt = G.clock; return b(...x); };
  if (G.title) { const sp = G.title.fx.spawn; G.title.fx.spawn = (...x) => { window.__titleAt = G.clock; return sp(...x); }; }
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
    // the title reaches the canvas (worker 0198 review): ~1 s after its spawn, render the frame with and without
    // the title's group and count the changed pixels inside the letters' screen box. Without the depth clear
    // before layer 5 (FUN_002f0250 -> FUN_002ee990) the floor hides the letters.
    const hasTitle = await pg.evaluate(() => !!window.__play.gameOver.title);
    if (hasTitle) {
      await pg.waitForFunction(() => window.__titleAt !== null, null, { timeout: 60000 });
      await pg.waitForTimeout(1000);
      const P = await pg.evaluate(() => {
        const { renderer, output, root, camera, gameOver: G } = window.__play, L = G.titleLayer, gl = renderer.getContext();
        const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
        const letters = L.last.filter(s => s.alpha === 0x44 && /:1$/.test(s.tex.k));
        const w = L.camera.matrixWorld.elements, V = camera.position.constructor;
        let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
        for (const s of letters) for (const v of s.verts) {
          const [x, y, z] = [v.pos[0], -v.pos[1], -v.pos[2]];
          const q = new V(w[0] * x + w[4] * y + w[8] * z + w[12], w[1] * x + w[5] * y + w[9] * z + w[13], w[2] * x + w[6] * y + w[10] * z + w[14]).project(camera);
          const px = (q.x + 1) / 2 * W, py = (q.y + 1) / 2 * H;
          x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py);
        }
        x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0)); x1 = Math.min(W, Math.ceil(x1)); y1 = Math.min(H, Math.ceil(y1));
        const grab = () => { output.render(root, camera); const b = new Uint8Array((x1 - x0) * (y1 - y0) * 4); gl.readPixels(x0, y0, x1 - x0, y1 - y0, gl.RGBA, gl.UNSIGNED_BYTE, b); return b; };
        const a = grab(); L.group.visible = false; const b = grab(); L.group.visible = true;
        let n = 0;
        for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 24) n++;
        const kids = L.group.children;
        return { n, area: (x1 - x0) * (y1 - y0), letters: letters.length, clearFirst: kids[0] === L.depthClear && L.depthClear.visible,
          after: root.children.indexOf(L.group) > root.children.indexOf(window.__fx?.layer?.group ?? L.group) || !window.__fx };
      });
      ok(P.letters > 0 && P.n > 0.1 * P.area, `the title's letters reach the canvas ~1 s after the spawn (${P.letters} letter sprites; ${P.n} of ${P.area} px in their box change)`);
      ok(P.clearFirst && P.after, 'the depth clear (FUN_002ee990) is the title group\'s first draw, and the group draws after the 3D effects (scene-graph order)');
    }
    await menuOpen(pg);
    const dt = (await pg.evaluate(() => window.__menuAt)) - c0;
    ok(dt === 293 * 20, `menu opens 293 game frames after the death (clock +${dt} ms; 5860 expected)`);
    await pg.waitForTimeout(400);                  // the 100 ms open
    if (process.env.GAMEOVER_SHOT) await pg.screenshot({ path: process.env.GAMEOVER_SHOT });
    // the GAME OVER title (gameover_title.js, worker 0198)
    const T = await pg.evaluate(() => {
      const G = window.__play.gameOver, L = G.titleLayer;
      if (!G.title || !L) return null;
      const cam = window.__play.camera, THREE_V = cam.position.constructor;
      const vis = L.pool.filter(m => m.visible);
      // the letters (tex1, ALPHA 0x44): their projected centre in NDC
      const letters = L.last.filter(s => s.alpha === 0x44 && /:1$/.test(s.tex.k));
      const c = new THREE_V();
      for (const s of letters) for (const v of s.verts) {
        const [x, y, z] = [v.pos[0], -v.pos[1], -v.pos[2]], w = L.camera.matrixWorld.elements;
        c.add(new THREE_V(w[0] * x + w[4] * y + w[8] * z + w[12], w[1] * x + w[5] * y + w[9] * z + w[13], w[2] * x + w[6] * y + w[10] * z + w[14]));
      }
      c.multiplyScalar(1 / Math.max(1, 4 * letters.length)).project(cam);
      return { titleAt: window.__titleAt, beginAt: window.__beginAt, n: L.last.length, vis: vis.length, inRoot: L.group.parent === window.__play.root,
        letters: letters.length, ndc: [c.x, c.y] };
    });
    ok(T !== null, 'the title is loaded (data/gameover_title.fed, gameover.json "title")');
    if (T) {
      ok(T.titleAt - T.beginAt === 14 * 20, `title spawned 14 game frames after the request (clock +${T.titleAt - T.beginAt} ms; 280 expected)`);
      ok(T.n === 30 && T.vis === 30 && T.inRoot, `settled: 30 type-10 sprites drawn (${T.n} sprites, ${T.vis} meshes, in the scene)`);
      ok(T.letters === 8 && Math.abs(T.ndc[0]) < 0.1 && T.ndc[1] > 0 && T.ndc[1] < 0.2, `the 8 letters centred, a little above the middle (NDC ${T.ndc.map(x => x.toFixed(3))})`);
    }
    ok(await pg.evaluate(() => window.__play.gameOver.go.menu.focus.id === 3), 'Restart focused (layout 0x477c38)');
    await pg.evaluate(() => { window.__marker = 1; });
    await pg.keyboard.press('Space');
    await pg.waitForFunction(() => window.__play.restart.count === 1, null, { timeout: 20000, polling: 100 }).catch(() => {});
    ok(await pg.evaluate(() => window.__marker === 1 && window.__play.restart.count === 1 && window.__play.php.hp === 780),
       '✕ on Restart: the checkpoint, no page reload (checkpoint.js; test_checkpoint_page has the details)');
    // FUN_00534a98 (result 6) -> FUN_002f2098(0x81840000): Restart removes the title
    await pg.waitForTimeout(200);
    if (hasTitle) ok(await pg.evaluate(() => { const G = window.__play.gameOver; return G.title.fx.emitters.length === 0 && G.titleLayer.last.length === 0 && !G.titleLayer.pool.some(m => m.visible) && !G.titleLayer.depthClear.visible; }),
       'Restart: the title is gone (0 emitters, 0 sprites, no depth clear)');
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
    const liveBeforeH = await pg.evaluate(() => { const G = window.__play.gameOver; return !G.title || G.title.fx.emitters.length > 0; });
    ok(liveBeforeH, 'after Quit the title is still up (the page stays on the scene)');
    await pg.keyboard.press('KeyH'); await pg.waitForTimeout(500);
    ok(await pg.evaluate(() => { const g = window.__play.gameOver.go; return g.wm === 2 && !g.pauseBlocked && !g.started && !g.active && window.__play.php.hp === 780; }),
       'H (page respawn) resets the game over');
    ok(await pg.evaluate(() => { const G = window.__play.gameOver; return !G.title || (G.title.fx.emitters.length === 0 && G.titleLayer.last.length === 0 && !G.titleLayer.pool.some(m => m.visible)); }),
       'H: the title is gone (0 emitters, 0 sprites)');
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
