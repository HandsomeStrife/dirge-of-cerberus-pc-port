// The cutscene warps (worker 0265; PAGE AID ?warp=, warp.js): each opens on the event the game plays at that place, with the flags of the
// route states (notes/route-states.md), and no deb_jump help box on arrival (its 'seen' stage flag and global 55 set, as at the pickup).
//   helpme   -> trigger 59's event 0xd -> stage flag 1 = 8 -> help_people01 (not heri_tobi, which the game played earlier)
//   citizens -> trigger 58's event 0xd + stage flag 1 = 12 -> help_orei02 (not heri_tobi)
//   heli     -> heri_taijou (no 'Long Barrel' box after it)
//   node native/web/test_warp_cutscene_page.mjs [warp ...]   (needs playwright + data; network for three.js; sandbox off)
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
if (!fs.existsSync(path.join(here, 'data/event/ev0100_stage.json'))) { console.log('SKIP: no data/event/ev0100_stage.json'); done(); }
let chromium;
try { ({ chromium } = createRequire(path.join(execSync('npm root -g', { encoding: 'utf8' }).trim(), '/'))('playwright')); }
catch { console.log('SKIP: playwright not installed'); done(); }
const CASES = { helpme: 'ev0143.help_people01', citizens: 'ev0143.help_orei02', heli: 'ev0103.heri_taijou' };
// the last event of each warp's run (heli: sk_mituketa2; deb_jump's box would come after it)
const LAST = { helpme: 'ev0143.help_people01', citizens: 'ev0143.help_orei02', heli: 'ev0101.sk_mituketa2' };
const want = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(CASES);
const port = await new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const srv = spawn('python3', ['-I', '-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', here], { stdio: 'ignore' });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  for (const name of want) {
    const pg = await browser.newPage({ viewport: { width: 960, height: 540 } });
    const errs = [];
    pg.on('pageerror', e => errs.push(e.message));
    for (let i = 0; ; i++) { try { await pg.goto(`http://127.0.0.1:${port}/play.html?warp=${name}&hud=0&sound=0`, { waitUntil: 'load' }); break; } catch (e) { if (i > 20) throw e; await new Promise(r => setTimeout(r, 250)); } }
    const ev = CASES[name];
    // the first event main enters after the warp
    try {
      await pg.waitForFunction(() => { const P = window.__play; return P && P.warp && P.stage && P.stage.rt.vm.calls.some(c => /^ev01(4[0-7]|0[1-9])\./.test(c) && c !== 'ev0101.first_event'); }, null, { timeout: 240000, polling: 100 });
    } catch (e) {
      console.log('  diag: ' + JSON.stringify(await pg.evaluate(() => { const P = window.__play; return { tk: P.stats.ticks, warp: P.warp, f: [0, 1, 2, 15, 16].map(k => P.enemyAI.eventFlags[k]), slots: [0, 1, 2].map(i => P.light.stream.slotChunk(i)), busy: P.light.stream.busy, battle: P.stage.battle, where: P.stage.rt.vm.where() }; })));
      throw e;
    }
    // and on until main is back in battle after the run's last event, then 300 frames more (a help box would open there)
    await pg.waitForFunction(last => { const P = window.__play; return P.stage.rt.vm.calls.includes(last) && P.stage.rt.battle; }, LAST[name], { timeout: 300000, polling: 100 });
    await pg.waitForFunction(t0 => window.__play.stats.ticks > t0 + 300, await pg.evaluate(() => window.__play.stats.ticks), { timeout: 120000, polling: 100 });
    const r = await pg.evaluate(() => { const P = window.__play, R = P.stage.rt;
      return { calls: R.vm.calls.filter(c => c !== 'ev0101.first_event'), boxes: R.log.filter(([, m]) => /^stageinfo 6/.test(m)).map(([f, m]) => f + ' ' + m), f1: P.enemyAI.eventFlags[1] }; });
    if (process.env.WARP_LOG) console.log((await pg.evaluate(re => window.__play.stage.rt.log.filter(([, m]) => new RegExp(re).test(m)).map(([f, m]) => f + ':' + m), process.env.WARP_LOG)).slice(0, 40).join('\n'));
    const evs = r.calls.filter(c => /^ev01(4[0-7]|0[1-9])\./.test(c));
    ok(evs[0] === ev, `${name}: the first event is ${ev} (${evs.join(', ') || 'none'})`);
    ok(!evs.includes('ev0143.heri_tobi') || name === 'heli', `${name}: heri_tobi not replayed`);
    ok(r.boxes.length === 0, `${name}: no help box on arrival (${r.boxes.join(' | ') || 'none'})`);
    ok(errs.length === 0, `${name}: no page errors` + (errs.length ? ': ' + errs.slice(0, 2).join(' | ') : ''));
    await pg.close();
  }
} finally {
  await browser.close();
  srv.kill();
}
done();
