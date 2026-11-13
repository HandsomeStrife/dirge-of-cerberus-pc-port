// Item use on the real page (worker 0243; notes/items-research.md 'Item use'), headless, ?intro=0&enemydmg=0.
// 1. The help line names the keys (E = D-pad right: use, Q = D-pad left: next item).
// 2. HP set to 600 (as the trace's poke): E -> the Potion is used in that frame's manager drain: HP 780 (+200 capped),
//    count 2 -> 1, the sound msj_010, the HUD's item count text "1" (FUN_003ae308; w243_potion frame 20).
// 3. E again at full HP: refused (event 0x68: msj_001), count stays 1. Q: one usable entry, selected: nothing changes.
// 4. HP 300, E: the last Potion -> HP 500, the entry cleared, the HUD item name empty and the count code 0x10.
// Worker 0255: E under game-state bit 11, Q at HP 0, H after the last Potion (the HUD follows the inventory).
// Saves a screenshot (TEST_SHOT=path) of the HUD after step 2 for the game-vs-page image.
//   node native/web/test_item_use_page.mjs     (needs data/items + data/hud + data/enemies + playwright; else SKIP)
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
for (const f of ['data/items/items.json', 'data/hud/hud.json', 'data/enemies/ai.json'])
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
  await pg.waitForFunction(() => window.__play && window.__play.stats.ticks > 30 && window.__items && window.__play.enemyAI && window.__play.gameHud, null, { timeout: 180000 });
  const state = () => pg.evaluate(() => {
    const P = window.__play, inv = window.__items.inventory, st = P.gameHud.state;
    return { hp: P.php.hp, n: inv.countAt(0), id0: inv.slots[0][0], sel: inv.sel,
      name: st.find(6, 0x1b).text, count: st.find(6, 0x1c).text, help: document.getElementById('hud').textContent };
  });
  const tickWait = async n => { const t0 = await pg.evaluate(() => window.__play.stats.ticks); await pg.waitForFunction(t => window.__play.stats.ticks >= t, t0 + n, { timeout: 60000 }); };
  const s0 = await state();
  ok(/E use item \(D-pad →\)/.test(s0.help) && /Q next item \(D-pad ←\)/.test(s0.help), 'help line: E use item (D-pad →), Q next item (D-pad ←)');
  ok(s0.n === 2 && s0.sel === 0 && JSON.stringify(s0.count) === '[21]', `start: Potion x ${s0.n}, selected slot ${s0.sel}, HUD count [${s0.count}]`);
  // 2. the use
  await pg.evaluate(() => { window.__play.php.hp = 600; });
  await tickWait(3);
  await pg.keyboard.press('KeyE');
  await tickWait(3);
  const s1 = await state();
  ok(s1.hp === 780 && s1.n === 1, `E at HP 600: HP ${s1.hp} (780), count ${s1.n} (1)`);
  ok(JSON.stringify(s1.count) === '[20]' && s1.name.length > 0, `HUD: count text [${s1.count}] ("1"), the name kept`);
  if (process.env.TEST_SHOT) await pg.screenshot({ path: process.env.TEST_SHOT });
  // 3. full HP: refused; Q: nothing
  await pg.keyboard.press('KeyE');
  await tickWait(3);
  await pg.keyboard.press('KeyQ');
  await tickWait(3);
  const s2 = await state();
  ok(s2.hp === 780 && s2.n === 1 && s2.sel === 0, `E at full HP refused, Q with one entry: count ${s2.n}, selection ${s2.sel}`);
  // game-state bit 11 (the pickup box): FUN_00331f08 skips FUN_003320c0, so E does nothing while it is set (worker 0255)
  await pg.evaluate(() => { window.__play.php.hp = 300; window.__play.gameState.set(11); });
  await tickWait(3);
  await pg.keyboard.press('KeyE');
  await tickWait(3);
  const sb = await pg.evaluate(() => ({ hp: window.__play.php.hp, n: window.__items.inventory.countAt(0) }));
  await pg.evaluate(() => { window.__play.gameState.clear(11); });
  await tickWait(3);
  ok(sb.hp === 300 && sb.n === 1, `E with game-state bit 11 set: nothing (HP ${sb.hp}, count ${sb.n})`);
  // HP 0: FUN_00331f08 again: Q does not cycle (a second usable entry, so it could), no msj_012 (worker 0255)
  const q = await pg.evaluate(() => {
    const P = window.__play, inv = window.__items.inventory;
    inv.slots.push([0x69300001, 1]);
    P.php.hp = 0;
    return { sel: inv.selId };
  });
  await pg.keyboard.press('KeyQ');
  await tickWait(3);
  const q1 = await pg.evaluate(() => window.__items.inventory.selId);
  ok(q1 === q.sel, `Q at HP 0: selection stays ${q1.toString(16)}`);
  await pg.keyboard.press('KeyH');                         // the page's respawn
  await tickWait(3);
  await pg.evaluate(() => { const inv = window.__items.inventory; inv.slots.pop(); });
  // 4. the last one
  await pg.evaluate(() => { window.__play.php.hp = 300; });
  await tickWait(3);
  await pg.keyboard.press('KeyE');
  await tickWait(3);
  const s3 = await state();
  ok(s3.hp === 500 && s3.id0 === -1 && s3.sel === -1, `the last Potion: HP ${s3.hp} (500), slot 0 cleared, selection ${s3.sel}`);
  ok(s3.name.length === 0 && JSON.stringify(s3.count) === '[16]', `HUD: empty name, count [${s3.count}] (code 0x10)`);
  // H (the page's aid, no game counterpart): the HUD is rebuilt from hud.json, then shows the inventory as it is, not the Potion
  await pg.keyboard.press('KeyH');
  await tickWait(3);
  const s4 = await state();
  ok(s4.name.length === 0 && JSON.stringify(s4.count) === '[16]', `H after the last Potion: the HUD still empty (name ${s4.name.length}, count [${s4.count}])`);
  ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
} finally {
  await browser.close();
  srv.kill();
}
done();
