// The stage controller on the real play.html (worker 0219; stage_controller.js, notes/stage-controller.md): ev0100 main
// runs from the page's start (?intro=0: the save's state), reaches the save's global flags and battle loop; when the
// current world's stage flag 0 becomes 2 (script 88: the start deck cleared) the next beat runs with rv_matiawase
// skipped through the game's Skip: load(128, 2, 3) -> area_stream.js request(2, 3), scene_save 1, back to battle.
// ?stage=0 leaves the controller out.
//   node native/web/test_stage_page.mjs (needs playwright + data; else SKIP; network for the three.js CDN)
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
let fail = 0;
const ok = (c, m, info = '') => { console.log((c ? 'ok   ' : 'FAIL ') + m + (info ? '  (' + info + ')' : '')); if (!c) fail++; };
const done = () => { console.log(fail ? `${fail} FAILED` : 'all ok'); process.exit(fail ? 1 : 0); };
for (const f of ['event/ev0100_stage.json', 'enemies/ai.json'])
  if (!fs.existsSync(path.join(here, 'data', f))) { console.log('SKIP: no data/' + f); done(); }
let chromium;
try {
  const g = execSync('npm root -g', { encoding: 'utf8' }).trim();
  ({ chromium } = createRequire(path.join(g, '/'))('playwright'));
} catch { console.log('SKIP: playwright not installed (npm i -g playwright)'); done(); }

const port = await new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const srv = spawn('python3', ['-I', '-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', here], { stdio: 'ignore' });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
async function open(q = '') {
  const pg = await browser.newPage({ viewport: { width: 960, height: 540 } });
  const errs = [], warns = [];
  pg.on('console', m => { if (m.type() === 'error') errs.push(m.text()); if (m.type() === 'warning') warns.push(m.text()); });
  pg.on('pageerror', e => errs.push(e.message));
  for (let i = 0; ; i++) {
    try { await pg.goto(`http://127.0.0.1:${port}/play.html?intro=0&sound=0&enemydmg=0${q}`, { waitUntil: 'load' }); break; }
    catch (e) { if (i > 20) throw e; await new Promise(r => setTimeout(r, 250)); }
  }
  await pg.waitForFunction(() => window.__play && window.__play.stats.ticks > 30, null, { timeout: 120000 });
  await pg.evaluate(() => window.__play.packsReady);
  await pg.evaluate(() => { window.__instance = Math.random(); });
  return { pg, errs, warns };
}

const st = (pg) => pg.evaluate(() => { const s = window.__play.stage; if (!s) return null;
  return { g: [...s.globalFlags].map((v, i) => (v ? i + ':' + v : '')).filter(Boolean).join(' '), battle: s.battle,
           log: s.rt.log.map(([f, m]) => f + ' ' + m), where: s.rt.vm.where(), calls: s.rt.vm.calls.join(' ') }; });
try {
  const { pg, errs } = await open();
  await pg.waitForFunction(() => window.__play.stage && window.__play.stage.rt.frameNo > 20, null, { timeout: 60000 });
  let s = await st(pg);
  ok(s.g === '0:1 1:3', 'main from the save: global flags 0 = 1, 1 = 3 (the save\'s RAM)', s.g);
  ok(s.battle && /ev0100\.(main|deb_jump)/.test(s.where), 'in the battle loop', s.where);
  ok(s.log.some(m => / played elsewhere ev0101\.first_event/.test(m)), 'first_event left to intro.js');
  // the start deck cleared: script 88's flag writes into the current world, and record the stream's requests
  await pg.evaluate(() => {
    const P = window.__play, S = P.light.stream, r = S.request.bind(S);
    window.__req = []; S.request = (a, b) => { window.__req.push(a + ',' + b + (S.busy ? ' busy' : '')); return r(a, b); };
    P.enemyAI.eventFlags[0] = 2; P.enemyAI.eventFlags[63] = 6;
  });
  await pg.waitForFunction(() => window.__play.stage.rt.log.some(([, m]) => m === 'scene_save 1'), null, { timeout: 60000 });
  await pg.waitForFunction(() => window.__play.stage.battle, null, { timeout: 60000 });
  s = await st(pg);
  const req = await pg.evaluate(() => window.__req);
  ok(s.calls.includes('ev0101.rv_matiawase'), 'rv_matiawase ran', s.calls);
  ok(s.log.some(m => / skip ev0101\.rv_matiawase/.test(m)), 'skipped inside rv_matiawase (after Zone.event)');
  ok(s.log.some(m => / zone 128,2,3$/.test(m)) && req.filter(x => x.startsWith('2,3')).length >= 2, 'load(128, 2, 3) -> FUN_002677a0(2, 3) twice', req.slice(0, 6).join(' | '));
  ok(s.g === '0:1 1:5', 'global flags after the beat (the game: 0 = 1, 1 = 5)', s.g);
  ok(s.battle, 'back in battle mode');
  ok(!errs.length, 'no page errors', errs.slice(0, 3).join(' | '));
  await pg.close();
  // ?stage=0: no controller
  const o2 = await open('&stage=0');
  ok(await o2.pg.evaluate(() => window.__play.stage === null), '?stage=0: no stage controller');
  await o2.pg.close();
} catch (e) { ok(false, 'page run', String(e).slice(0, 300)); } finally {
  await browser.close(); srv.kill();
}
done();
