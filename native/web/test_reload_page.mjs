// The reload class 0x1c on the real page (worker 0255; test_reload_class has the frame-exact cases), headless, ?intro=0&enemydmg=0:
// F while walking with the gun out: h_fwk_rd. In C+0x564 bit 0x4000's window Space does not jump; C holsters silently and the gun-away
// row h_wk_rd takes over at the same frame. After the window Space jumps and the class goes; the landing is not a reload row.
//   flock tools/trace/out/.browser.lock node native/web/test_reload_page.mjs
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawn, execSync } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
let fail = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };
const done = () => { console.log(fail ? `${fail} FAILED` : 'all ok'); process.exit(fail ? 1 : 0); };
for (const f of ['data/aim/weapon.json', 'data/vincent/vincent_shoot.json'])
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
  const pg = await browser.newPage({ viewport: { width: 960, height: 540 } });
  const errs = [], logs = [];
  pg.on('console', m => { if (m.type() === 'error') errs.push(m.text()); else logs.push(m.text()); });
  pg.on('pageerror', e => errs.push(e.message));
  for (let i = 0; ; i++) {
    try { await pg.goto(`http://127.0.0.1:${port}/play.html?video=pal&intro=0&enemydmg=0`, { waitUntil: 'load' }); break; }
    catch (e) { if (i > 20) throw e; await new Promise(r => setTimeout(r, 250)); }
  }
  await pg.waitForFunction(() => window.__play && window.__play.stats.ticks > 30 && window.__play.aim, null, { timeout: 180000 });
  const S = () => pg.evaluate(() => {
    const P = window.__play, a = P.anim, c = P.ctrl;
    return { key: a.head.key, frame: a.head.frame, c564: c.weaponHook.c564(), st: c.P.state, head: !!(c.jump && c.jump.head), drawn: P.aim.core.P.drawn,
             rounds: P.aim.core.ammo.rounds(), spd: c.C.groundSpeed, ground: c.onGround, wst: P.aim.core.P.st };
  });
  const until = (f, arg, t = 120000) => pg.waitForFunction(f, arg, { timeout: t, polling: 'raf' });
  const ticks = async n => { const t0 = await pg.evaluate(() => window.__play.stats.ticks); await until(t => window.__play.stats.ticks >= t, t0 + n); };
  // the gun out and a few rounds spent, walking
  await pg.keyboard.down('KeyW');
  await pg.evaluate(() => window.__play.aim.press('r1'));
  await until(() => window.__play.aim.core.P.drawn && window.__play.aim.core.P.st === 0);
  await pg.evaluate(() => { window.__play.aim.core.ammo.spend(3); });
  await until(() => window.__play.ctrl.C.groundSpeed > 5 && window.__play.aim.core.P.st === 0);
  // a key at the first game frame the condition holds (the host may run slower or faster than the polling)
  const pressWhen = (code, cond) => pg.evaluate(([code, cond]) => new Promise(res => {
    const c = window.__play.ctrl, step = c.step, test = new Function('c', 'a', 'return ' + cond);
    c.step = function (i) {
      if (test(c, window.__play.anim)) {
        c.step = step;
        window.dispatchEvent(new KeyboardEvent('keydown', { code }));
        window.dispatchEvent(new KeyboardEvent('keyup', { code }));
        setTimeout(res, 0);
      }
      return step.call(this, i);
    };
  }), [code, cond]);
  const WINDOW = "/_rd$/.test(a.head.key) && (c.weaponHook.c564() & 0x4000) && a.head.frame > 2";
  const reload = async () => {
    await pg.evaluate(() => { window.__play.aim.core.ammo.spend(3); window.__play.aim.press('r2'); });
    await until(() => /_rd$/.test(window.__play.anim.head.key));
  };
  // 1. the window refuses Space
  await reload();
  const a0 = await S();
  ok(a0.key === 'h_fwk_rd' && (a0.c564 & 0x4000) !== 0, `F while walking: ${a0.key}, C+0x564 ${a0.c564.toString(16)}`);
  await pressWhen('Space', WINDOW);
  await ticks(2);
  const a1 = await S();
  ok(!a1.head && a1.st === 3 && a1.key === 'h_fwk_rd', `Space in the window: no jump (state ${a1.st}, ${a1.key})`);
  // 2. the holster in the window (a new reload: the first has run on)
  await until(() => !window.__play.ctrl.weaponHook.c564());
  await until(() => window.__play.aim.core.P.st === 0);
  const snd = []; await pg.exposeFunction('__snd', n => snd.push(n));
  await pg.evaluate(() => { const c = window.__play.aim.core, o = c.sound; c.sound = n => { window.__snd(n); if (o) o(n); }; });
  await reload();
  snd.length = 0;
  await pressWhen('KeyC', WINDOW);
  await until(() => !window.__play.aim.core.P.drawn);
  await until(() => window.__play.anim.head.key === 'h_wk_rd');
  const b1 = await S();
  ok(b1.c564 !== 0, `C in the window: the class stays (C+0x564 ${b1.c564.toString(16)})`);
  ok(b1.key === 'h_wk_rd' && b1.frame > 2.5, `the gun-away row at the same frame: ${b1.key} ${b1.frame.toFixed(1)}, not 0.6`);
  await new Promise(r => setTimeout(r, 300));
  ok(snd.length === 0, `no holster sound (${snd.join(' ') || 'none'})`);
  // 3. after the window Space jumps, and the class goes; the landing picks the locomotion row
  await until(() => !window.__play.ctrl.weaponHook.c564());
  await pg.evaluate(() => window.__play.aim.press('r1'));
  await until(() => window.__play.aim.core.P.drawn && window.__play.aim.core.P.st === 0);
  await reload();
  await pressWhen('Space', "c.weaponHook.c564() === 0x20000");
  await until(() => window.__play.ctrl.jump.head);
  const c1 = await S();
  ok(c1.c564 === 0, `Space after the window: he jumps, the class is gone (C+0x564 ${c1.c564.toString(16)})`);
  await pg.keyboard.up('KeyW');
  await until(() => !window.__play.ctrl.jump.head);
  await ticks(3);
  const c2 = await S();
  ok(!/_rd$/.test(c2.key) && c2.c564 === 0, `after the landing: ${c2.key}`);
  ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
} finally {
  await browser.close();
  srv.kill();
}
done();
