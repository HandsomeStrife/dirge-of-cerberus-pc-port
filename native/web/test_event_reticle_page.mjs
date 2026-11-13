// The reticle in main's events (worker 0265; Dan: the aiming cursor over the stairs and helicopter cutscenes), on the real
// play.html in a headless browser: Vincent raises the gun (LMB = R1: the reticle shows), then main's natives as the stage program
// calls them before an event: Zone.event() (FUN_0037e048 -> FUN_00324ca0 -> FUN_0033c1a8: the reticle off) and
// set_usercontrol(0) (FUN_003b01b0 -> FUN_003aff20 -> FUN_003b03e8, through hud.js); battle() brings it back (FUN_00324e70 ->
// FUN_0033c060). The reticle's draw (aim.js ReticleLayer) draws the kinds with a phase: none may be left in the event.
//   node native/web/test_event_reticle_page.mjs   (needs playwright, data/aim, data/hud, data/event/ev0100_stage.json)
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
for (const f of ['data/aim/reticle.json', 'data/aim/weapon.json', 'data/event/ev0100_stage.json'])
  if (!fs.existsSync(path.join(here, f))) { console.log('SKIP: no ' + f); done(); }
let chromium;
try {
  const g = execSync('npm root -g', { encoding: 'utf8' }).trim();
  ({ chromium } = createRequire(path.join(g, '/'))('playwright'));
} catch { console.log('SKIP: playwright not installed'); done(); }

const port = await new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const srv = spawn('python3', ['-I', '-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', here], { stdio: 'ignore' });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const pg = await browser.newPage({ viewport: { width: 960, height: 540 } });
  const errs = [];
  pg.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  pg.on('pageerror', e => errs.push(e.message));
  for (let i = 0; ; i++) {
    try { await pg.goto(`http://127.0.0.1:${port}/play.html?video=pal&intro=0&enemydmg=0&hud=0`, { waitUntil: 'load' }); break; }
    catch (e) { if (i > 20) throw e; await new Promise(r => setTimeout(r, 250)); }
  }
  const until = (fn, arg, t = 180000) => pg.waitForFunction(fn, arg, { timeout: t, polling: 50 });
  await until(() => window.__play && window.__play.stats.ticks > 30 && window.__play.stage && window.__play.stage.battle && window.__play.aim);
  // the reticle is drawn while a kind 1..7 has a phase (aim.js ReticleLayer.draw)
  const ret = () => pg.evaluate(() => { const c = window.__play.aim.core; return { mode: c.hud.mode, kind: c.r.kind, drawn: c.r.phase.some((p, k) => k > 0 && p !== 0), ticks: window.__play.stats.ticks }; });
  const frames = async n => { const t0 = (await ret()).ticks; await until(t => window.__play.stats.ticks >= t, t0 + n); };
  // R1 (LMB on the canvas)
  const raise = async () => {
    // the canvas's own events, as test_level_run_page's bot (the lock refused (aim.js mouseR1Gate): the drag fallback's tap)
    await pg.evaluate(() => { const c = window.__play.renderer.domElement, ev = t => c.dispatchEvent(new MouseEvent(t, { button: 0, bubbles: true, clientX: 240, clientY: 180 })); document.dispatchEvent(new Event('pointerlockerror')); ev('mousedown'); ev('mouseup'); });
    await until(() => window.__play.aim.core.hud.mode !== 0, null, 30000);
    await frames(10);
  };
  await raise();
  const a = await ret();
  ok(a.mode !== 0 && a.kind !== 0 && a.drawn, `gun up: HUD mode ${a.mode}, reticle kind ${a.kind} drawn`);
  // main before an event: Zone.event() (event2)
  const call = (n, args) => pg.evaluate(([n, args]) => { const R = window.__play.stage.rt; return R.vm.natives[n](R.vm, args); }, [n, args]);
  await call('fake/KerberosZone.event2()V', []);
  await frames(10);
  const b = await ret();
  ok(b.kind === 0 && !b.drawn, `Zone.event(): no reticle drawn (kind ${b.kind}, drawn ${b.drawn})`);
  const bits = await pg.evaluate(() => [5, 4, 2, 6].map(n => window.__play.gameState.test(n)));
  ok(bits.every(Boolean), `game-state bits 5, 4, 2, 6 set in event mode (${bits})`);
  // battle(): FUN_0033c060 shows it again for the same mode
  await call('fake/KerberosZone.battle2(I)V', [0]);
  await frames(10);
  const c = await ret();
  ok(c.kind === a.kind && c.drawn, `battle(): the reticle again (kind ${c.kind})`);
  // set_usercontrol(0) (the HUD's slide-out, hud.js) takes it too
  if (await pg.evaluate(() => !!window.__play.stage.rt.vm.natives['fake/KerberosEvent.set_usercontrol(Z)V'])) {
    await call('fake/KerberosEvent.set_usercontrol(Z)V', [0]);
    await frames(10);
    const d = await ret();
    ok(d.kind === 0 && !d.drawn, `set_usercontrol(0): no reticle drawn (kind ${d.kind})`);
    await call('fake/KerberosEvent.set_usercontrol(Z)V', [1]);
  }
  const bad = errs.filter(e => !/favicon|404/.test(e));
  ok(bad.length === 0, 'no page errors' + (bad.length ? ': ' + bad.slice(0, 3).join(' | ') : ''));
} finally {
  await browser.close();
  srv.kill();
}
done();
