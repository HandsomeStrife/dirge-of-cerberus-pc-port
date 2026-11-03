// The stage controller on the real play.html (worker 0219; stage_controller.js, notes/stage-controller.md): ev0100 main
// runs from the page's start (?intro=0: the save's state), reaches the save's global flags and battle loop; when the
// current world's stage flag 0 becomes 2 (script 88: the start deck cleared) the next beat runs: load(128, 2, 3) ->
// area_stream.js request(2, 3), rv_matiawase, scene_save 1, back to battle. Worker 0248: rv_matiawase plays by default
// (stage_controller.js PLAYS): its event camera is the render camera, p000 / p005 are drawn (stage_view.js), the
// window MES_10201VN opens; ?autoskip=1 skips it through the game's Skip (the old aid). ?stage=0 leaves the controller out.
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
async function beat(q) {
  const { pg, errs } = await open(q);
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
  // during the event (worker 0248): the stage view's camera and actors, sampled each animation frame
  await pg.evaluate(() => { const P = window.__play; window.__ev = { cam: 0, bodies: new Set(), shown: new Set(), win: 0 };
    const f = () => { const v = P.stageView; if (v && v.active) { window.__ev.cam++;
        const c = P.camera, e = P.stage.rt.view.eye; if (Math.hypot(c.position.x - e[0], c.position.y - e[1], c.position.z - e[2]) < 1e-3) window.__ev.at = (window.__ev.at || 0) + 1; }
      const g = P.root.getObjectByName('event actors'); if (g) for (const a of P.stage.rt.actors.slots) if (a.drawn && a.drawn.shown && !a.lent) window.__ev.shown.add(a.model);
      if (P.stageWin && P.stageWin.drawAll(performance.now()).length) window.__ev.win++;
      if (!P.stage.battle || !window.__evDone) requestAnimationFrame(f); };
    requestAnimationFrame(f); });
  await pg.waitForFunction(() => window.__play.stage.rt.log.some(([, m]) => m === 'scene_save 1'), null, { timeout: 120000 });
  await pg.waitForFunction(() => window.__play.stage.battle, null, { timeout: 60000 });
  s = await st(pg);
  const req = await pg.evaluate(() => window.__req);
  ok(s.calls.includes('ev0101.rv_matiawase'), 'rv_matiawase ran', s.calls);
  const ev = await pg.evaluate(() => { window.__evDone = true; const e = window.__ev; return { cam: e.cam, at: e.at || 0, shown: [...e.shown], win: e.win }; });
  if (q.includes('autoskip=1')) ok(s.log.some(m => / skip ev0101\.rv_matiawase/.test(m)), '?autoskip=1: skipped inside rv_matiawase (after Zone.event)');
  else {
    ok(!s.log.some(m => / skip /.test(m)), 'default: rv_matiawase plays (no Skip in it or in main after it)', s.log.filter(m => / skip/.test(m)).join(' | '));
    ok(ev.cam > 20 && ev.at === ev.cam, 'the event camera is the render camera while it runs (FUN_00379148)', JSON.stringify(ev));
    ok(ev.shown.includes('p000') && ev.shown.includes('p005') && ev.shown.includes('weapon'), 'p000, p005 and the weapon drawn (stage_view.js)', ev.shown.join(' '));
    ok(ev.win > 0, 'the window MES_10201VN drawn (event_window.js)', 'frames ' + ev.win);
    ok(s.log.some(m => / voice 10201vn$/.test(m)) && s.log.some(m => / fadein 1500$/.test(m)), 'playVoice 10201vn, then main\'s fadein 1500 unskipped');
  }
  ok(s.log.some(m => / zone 128,2,3$/.test(m)) && req.filter(x => x.startsWith('2,3')).length >= 2, 'load(128, 2, 3) -> FUN_002677a0(2, 3) twice', req.slice(0, 6).join(' | '));
  ok(s.g === '0:1 1:5', 'global flags after the beat (the game: 0 = 1, 1 = 5)', s.g);
  ok(s.battle, 'back in battle mode');
  ok(!errs.length, 'no page errors', errs.slice(0, 3).join(' | '));
  await pg.close();
}
try {
  await beat('');
  await beat('&autoskip=1');
  // ?stage=0: no controller
  const o2 = await open('&stage=0');
  ok(await o2.pg.evaluate(() => window.__play.stage === null), '?stage=0: no stage controller');
  await o2.pg.close();
} catch (e) { ok(false, 'page run', String(e).slice(0, 300)); } finally {
  await browser.close(); srv.kill();
}
done();
