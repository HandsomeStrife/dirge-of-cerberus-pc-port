// test_ev0141_page.mjs -- first_encounter, rv_toujou, wro_kaisetu on the real play.html (worker 0263; notes/story-cutscenes.md): the page aids ?warp=encounter|toujou|wro set
// the flags main tests; main plays the event; a player answers wro_kaisetu's choice box with the keys. EV=encounter,toujou,wro picks; STORY_SHOT=<dir>: screenshots at clock
// STORY_SHOT_AT (ms from the event's start; comma list).  node native/web/test_ev0141_page.mjs  (needs playwright + data; network for the three.js CDN; sandbox off)
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
for (const f of ['event/ev0100_stage.json', 'event/actors/n029.glb', 'event/actors/n012.glb', 'audio/voice/10601wr.flac'])
  if (!fs.existsSync(path.join(here, 'data', f))) { console.log('SKIP: no data/' + f); done(); }
let chromium;
try { ({ chromium } = createRequire(path.join(execSync('npm root -g', { encoding: 'utf8' }).trim(), '/'))('playwright')); }
catch { console.log('SKIP: playwright not installed (npm i -g playwright)'); done(); }
const port = await new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const srv = spawn('python3', ['-I', '-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', here], { stdio: 'ignore' });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const SHOT = process.env.STORY_SHOT, AT = (process.env.STORY_SHOT_AT || '').split(',').filter(Boolean).map(Number);
const CASES = {
  encounter: { m: 'first_encounter', want: ['p000', 'e050', 'n013'], end: 22 },
  toujou: { m: 'rv_toujou', want: ['p000', 'e050', 'n013', 'n012'], end: 25 },
  wro: { m: 'wro_kaisetu', want: ['p000', 'n043'], end: 26 },
};
for (const name of (process.env.EV || 'encounter,toujou,wro').split(',')) {
  const C = CASES[name];
  const pg = await browser.newPage({ viewport: { width: 960, height: 540 } });
  try {
    const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('console', m => { if (m.type() === 'error' || /no marker/.test(m.text())) errs.push(m.text()); });
    for (let i = 0; ; i++) {
      try { await pg.goto(`http://127.0.0.1:${port}/play.html?intro=0&sound=0&enemydmg=0&warp=${name}`, { waitUntil: 'load' }); break; }
      catch (e) { if (i > 20) throw e; await new Promise(r => setTimeout(r, 250)); }
    }
    await pg.waitForFunction(() => window.__play && window.__play.stats.ticks > 5, null, { timeout: 240000 });
    await pg.evaluate((m) => { const P = window.__play; window.__ev = { n: 0, shown: new Set(), vin: 0, win: 0, cam: 0, box: 0 };
      const f = () => { const R = P.stage.rt, E = window.__ev;
        if (R.vm.frames.some(F => F.m.name === m)) { E.n++; E.t0 ??= R.clock;
          for (const a of R.actors.slots) if (a.drawn && a.drawn.shown && !a.lent) E.shown.add(a.model);
          // wro_kaisetu's setVisibleAll(0, 1) (FUN_0039d118) shows every MP again, Vincent's included, by the script's order
          if (P.vin && P.vin.body && P.vin.body.visible && !R.log.some(x => /^setVisibleAll 0 (1|true)/.test(x[1])) && !R.actors.slots.some(a => a.lent && a.lent.tag === 'p_Vin' && a.visible) && !R.log.some(x => /^handback p_Vin/.test(x[1]))) { E.vin++; (E.vinAt ??= []).push(R.clock - E.t0); }   // first_encounter's last shot: setVisible(1) on the slot lending him
          if (P.stageView && P.stageView.active) E.cam++;
          if (P.stageWin && P.stageWin.drawAll(performance.now()).length) E.win++;
          if (P.stageWin && P.stageWin.entries.some(e => e.kind === 27 && e.box && e.box.box && e.box.box.result === 0 && !(e.box.box.flags & 0x30))) E.box++;
        }
        requestAnimationFrame(f); };
      requestAnimationFrame(f); }, C.m);
    await pg.waitForFunction(m => window.__play.stage.rt.vm.frames.some(F => F.m.name === m), C.m, { timeout: 300000, polling: 200 });
    if (SHOT) {
      fs.mkdirSync(SHOT, { recursive: true });
      for (const ms of AT) {
        await pg.waitForFunction(([t]) => window.__ev.t0 != null && window.__play.stage.rt.clock - window.__ev.t0 >= t, [ms], { timeout: 400000, polling: 50 });
        await pg.screenshot({ path: path.join(SHOT, `${name}_${ms}.png`) });
      }
    }
    if (name === 'wro') {
      // the box opens at the last row (Nothing); down wraps to Supplies, ✕ asks; the box comes back; ✕ on its Nothing ends the talk
      const boxUp = () => pg.waitForFunction(() => window.__ev.box > window.__ev.boxSeen || (window.__ev.boxSeen === undefined && window.__ev.box > 3), null, { timeout: 200000, polling: 100 });
      await boxUp();
      if (SHOT) await pg.screenshot({ path: path.join(SHOT, 'wro_box.png') });
      const first = await pg.evaluate(() => { const b = window.__play.stageWin.entries.find(e => e.kind === 27).box.box; return { cursor: b.cursor, n: b.rows.length, x: b.root.x, y: b.root.y, w: b.root.w, h: b.root.h }; });
      ok(first.cursor === 3 && first.n === 4 && first.x === 128 && first.y === 274 && first.h === 142, 'the choice box: 4 rows, cursor on the last, at (128, 274), height 142', JSON.stringify(first));
      await pg.keyboard.press('ArrowDown');
      await pg.waitForTimeout(300);
      const c1 = await pg.evaluate(() => window.__play.stageWin.entries.find(e => e.kind === 27).box.box.cursor);
      ok(c1 === 0, 'ArrowDown wraps to row 0', String(c1));
      if (SHOT) await pg.screenshot({ path: path.join(SHOT, 'wro_box0.png') });
      await pg.evaluate(() => { window.__ev.boxSeen = window.__ev.box; });
      await pg.keyboard.press('Space');
      await pg.waitForFunction(() => { const e = window.__play.stageWin.entries.find(x => x.id > 0 && x.kind === 27); return e && e.box.box.result === 0 && !(e.box.box.flags & 0x30) && e.box.box.rows[0].bytes[0] === 0x24; }, null, { timeout: 200000, polling: 100 });
      ok(true, 'after Supplies the box comes back with it marked');
      await pg.waitForTimeout(500);
      await pg.keyboard.press('Space');
    }
    await pg.waitForFunction((e) => { const R = window.__play.stage.rt; return R.gflags[1] === e && R.battle; }, C.end, { timeout: 500000, polling: 500 });
    const s = await pg.evaluate(() => { const P = window.__play, R = P.stage.rt, E = window.__ev;
      return { n: E.n, shown: [...E.shown], vin: E.vin, vinAt: (E.vinAt || []).filter((_, i, l) => i < 3 || i >= l.length - 3).map(x => Math.round(x)).join(), win: E.win, cam: E.cam, log: R.log.map(x => x[1]), vis: P.vin && P.vin.body && P.vin.body.visible, pos: [P.ctrl.pos.x, P.ctrl.pos.y, P.ctrl.pos.z], g: R.gflags[1] }; });
    ok(s.n > 50, `${C.m} ran on the page's frames`, String(s.n));
    ok(!s.log.some(m => /^skip /.test(m)), 'no Skip in it', s.log.filter(m => /^skip /.test(m)).join());
    ok(C.want.every(m => s.shown.includes(m)), 'draws its actors', s.shown.join());
    ok(s.vin === 0, 'Vincent\'s own body hidden in it', s.vin + ' at ms ' + s.vinAt);
    ok(s.cam > 50, 'the event camera renders', String(s.cam));
    ok(s.win > 0, 'its subtitles open', String(s.win));
    ok(s.vis === true, 'after it: Vincent drawn again', s.pos.map(v => v.toFixed(1)).join());
    ok(!errs.length, 'no page errors', errs.slice(0, 3).join(' | '));
  } catch (e) {
    const st = await pg.evaluate(() => { const R = window.__play.stage.rt; return { where: R.vm.where(), clock: R.clock, flag1: R.gflags[1], battle: R.battle, n: window.__ev && window.__ev.n, slots: R.cmds ? R.cmds.filter(c => c && c.type).map(c => c.type) : null, log: R.log.slice(-12).map(x => x[1]) }; }).catch(x => x.message);
    ok(false, name + ' exception', e.message.slice(0, 300) + ' ' + JSON.stringify(st));
  }
  await pg.close();
}
await browser.close(); srv.kill();
done();
