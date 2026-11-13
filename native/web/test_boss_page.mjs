// test_boss_page.mjs -- the z128 boss fight on the real play.html (worker 0235; notes/boss-research.md "Hookup").
//   node native/web/test_boss_page.mjs        (needs playwright, data/enemies/ai.json with e024's model_clips, e024.glb)
//   BOSS_SHOT=<png> saves a screenshot of the boss (camera at btbox5, looking at btbox0).
// The route: stage flag 0 = 36 and global flag 19 = 1 (0231's trace recipe: main's boss block, restart path). The page's
// stage controller is not yet known to reach Zone.boss(true) from the save, so after a short wait the test does what that
// path does in the game (stated as a harness step): the plug-in on (Zone.boss(true), FUN_0037fe18) and FUN_005459d8 (script
// event 0x23 to every object: record 32's HP, gauge 13 and its activation). Worker 0237: that harness step is gone; the page
// must reach both itself (the test fails otherwise). Worker 0240: the 0x23 comes from main's boss-block battle(): FUN_0037cf30
// -> FUN_00324e70 -> FUN_005453b0 -> FUN_005459d8 (T w240_boss; stage_controller.js enterBattle -> play.js stagePass). Then:
// the boss's brain runs (AI mode 0x100,
// boss_z128.js through boss_io.js), it is drawn, it flies between its boxes (move mode 1), fires (gun bullets and missiles
// from its markers), takes damage from a shot, and at HP < 10001 is beaten: script event 0x17 -> stage flag 0 = 40.
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
for (const f of ['data/enemies/ai.json', 'data/enemies/e024.glb'])
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
  const pg = await browser.newPage({ viewport: { width: 640, height: 480 } });
  const errs = [], warns = [];
  pg.on('console', m => { if (m.type() === 'error') errs.push(m.text()); if (m.type() === 'warning' && /boss|enemy_ai|stage/.test(m.text())) warns.push(m.text()); });
  pg.on('pageerror', e => errs.push(e.message));
  const OPTIONAL = new Set(['/game_state.js', '/stage_info.js']);
  pg.on('response', r => { if (r.status() !== 404) return; const u = r.url().replace(/^http:..[^/]+/, ''); if (!OPTIONAL.has(u)) errs.push('404 ' + u); });
  // the camera: at btbox5's centre, 60 u up, looking at btbox0 (BOSS_SHOT only)
  const cam = process.env.BOSS_SHOT ? '&cam=' + (process.env.BOSS_CAM || '600,-160,1300,45,-12') : '';
  for (let i = 0; ; i++) {
    try { await pg.goto(`http://127.0.0.1:${port}/play.html?video=pal&intro=0&sound=0${cam}`, { waitUntil: 'load' }); break; }
    catch (e) { if (i > 20) throw e; await new Promise(r => setTimeout(r, 250)); }
  }
  await pg.waitForFunction(() => window.__play && window.__play.stats.ticks > 30 && window.__play.enemyAI && window.__play.enemies && window.__play.stage, null, { timeout: 180000 });

  // 1. the route: flags as 0231's trace recipe; see whether the stage controller takes the boss block
  await pg.evaluate(() => { const P = window.__play; P.enemyAI.eventFlags[0] = 36; P.stage.globalFlags[19] = 1; });
  const routed = await pg.waitForFunction(() => window.__play.enemyAI.bossPlugin, null, { timeout: 20000 }).then(() => true).catch(() => false);
  // worker 0237: no harness fallback any more: the page's own stage controller must take main's boss block (Zone.boss(true))
  // and its stage-load pass must send event 0x23 (record 32 active); the test fails otherwise
  ok(routed, `the page's stage controller reaches Zone.boss(true) within 20 s (${routed})`);
  await pg.waitForFunction(() => window.__play.enemyAI.objects.get(32 + 22).flags28 & 1, null, { timeout: 20000 }).catch(() => null);
  const st0 = await pg.evaluate(() => {
    const W = window.__play.enemyAI, a = W.objects.get(32 + 22);
    return { kind: a.kind, hp: a.hp, gauge: { ...W.hudGauge() }, mode: a.ai ? a.ai.mode : null };
  });
  ok(st0.kind === 'actor' && st0.hp === 17000, `event 0x23 at flag 0 = 36: record 32 active with HP 17000 (T w231_boss4: 17000 at difficulty 1): ${st0.kind} ${st0.hp}`);
  if (st0.kind !== 'actor') {
    // the 0x23 on this route is battle()'s stage-load pass (FUN_00324e70 -> FUN_005453b0 -> FUN_005459d8, T w240_boss)
    ok(false, 'the boss is not active (no 0x23 from battle()\'s stage-load pass): the remaining checks are skipped');
    throw Object.assign(new Error('stop'), { stop: true });
  }
  ok(st0.gauge.id === 13 && st0.gauge.v === 7000 && st0.gauge.max === 7000 && st0.gauge.c59 === 1, `HUD gauge 13 = 7000 / 7000, shown (manager 0x6e / 0x6f): ${JSON.stringify(st0.gauge)}`);
  const brain = await pg.waitForFunction(() => { const a = window.__play.enemyAI.objects.get(54); return a.ai && a.ai.mode === 0x100 && a.ai.boss && a.ai.boss.st >= 2 ? { st: a.ai.boss.st, pos: a.pos.slice() } : false; },
    null, { timeout: 30000 }).then(h => h.jsonValue()).catch(() => null);
  ok(!!brain && Math.abs(brain.pos[0] - 850) < 1 && Math.abs(brain.pos[2] - 1450) < 1, `AI mode 0x100 with the overlay brain, past states 0 / 1, at btbox0 (850, -110, 1450): ${brain ? JSON.stringify(brain) : 'no'}`);
  const drawn = await pg.waitForFunction(() => { const a = window.__play.enemies.actors.find(x => x.rec === 32); return a && a.body && a.body.parent ? { model: a.model, clip: a.head ? a.head.clip : null } : false; },
    null, { timeout: 60000 }).then(h => h.jsonValue()).catch(() => null);
  ok(!!drawn && drawn.model === 'e024', `the boss is drawn (enemies.js): ${drawn ? JSON.stringify(drawn) : 'no'}`);

  // 2. it fires: gun bullets (nwe024gn) and missiles (nwe024mn, homing mode 1) from its markers
  const fired = await pg.waitForFunction(() => {
    const W = window.__play.enemyAI, bs = W.bullets.filter(b => b.shooter === 54);
    const s = window.__fired || (window.__fired = { gun: 0, mis: 0, seen: new Set() });
    for (const b of bs) if (!s.seen.has(b.id)) { s.seen.add(b.id); if (b.hm === 1) s.mis++; else s.gun++; }
    return s.gun > 0 && s.mis > 0 ? { gun: s.gun, mis: s.mis } : false;
  }, null, { timeout: 150000, polling: 50 }).then(h => h.jsonValue()).catch(() => pg.evaluate(() => window.__fired ? { gun: window.__fired.gun, mis: window.__fired.mis } : null));
  ok(!!fired && fired.gun > 0 && fired.mis > 0, `it fires: gun bullets and homing missiles: ${JSON.stringify(fired)}`);
  // 3. it flies: move mode 1 to another box
  const flew = await pg.waitForFunction(() => { const a = window.__play.enemyAI.objects.get(54); return Math.hypot(a.pos[0] - 850, a.pos[2] - 1450) > 50 ? a.pos.slice() : false; },
    null, { timeout: 150000 }).then(h => h.jsonValue()).catch(() => null);
  ok(!!flew, `it flies to another box: ${flew ? flew.map(v => v.toFixed(1)) : 'no'}`);

  // 4. damage: one of Vincent's shots through its body (its part boxes, hitEnemy -> FUN_0055c7f8), the gauge follows
  const hit = await pg.evaluate(async () => {
    const W = window.__play.enemyAI, a = W.objects.get(54), hp0 = a.hp;
    // through the middle of its first part box (ai.json hitboxes.e024[0]: an offset on its bone)
    const h = (await fetch('data/enemies/ai.json').then(r => r.json())).hitboxes.e024[0];
    const Wv = { ...(await fetch('data/aim/weapon.json').then(r => r.json())), spread: null, pellets: 1 };   // Vincent's handgun, straight
    const bw = W.boneWorld && W.boneWorld(a), B = bw ? bw(h.bone) : null;
    const c = B ? [0, 1, 2].map(k => h.offset[0] * B[0][k] + h.offset[1] * B[1][k] + h.offset[2] * B[2][k] + B[3][k]) : a.pos.slice();
    W.playerShot([c[0] - 80, c[1], c[2]], [c[0] + 80, c[1], c[2]], Wv);
    return { hp0, c };
  });
  const dmg = await pg.waitForFunction(h0 => { const W = window.__play.enemyAI, a = W.objects.get(54); return a.hp < h0 && W.hudGauge().v === a.hp - 10000 ? { hp: a.hp, g: W.hudGauge().v } : false; },   // the brain's next update sets the gauge
    hit.hp0, { timeout: 20000 }).then(h => h.jsonValue()).catch(() => null);
  ok(!!dmg && dmg.g === dmg.hp - 10000, `a shot through its body takes HP (${hit.hp0} -> ${dmg ? dmg.hp : '-'}) and the gauge follows (FUN_00aa11b8: ${dmg ? dmg.g : '-'})`);

  // 5. beaten at HP < 10001 (harness: HP set), state 9, then vt+0x334 -> script event 0x17 -> stage flag 0 = 40
  await pg.evaluate(() => { const a = window.__play.enemyAI.objects.get(54); a.hp = 10000; });
  const beaten = await pg.waitForFunction(() => { const a = window.__play.enemyAI.objects.get(54); return a.ai && a.ai.boss && a.ai.boss.st === 9; }, null, { timeout: 60000 }).then(() => true).catch(() => false);
  ok(beaten, 'HP 10000 (< 10001): the brain goes to state 9 (beaten)');
  if (process.env.BOSS_SHOT) { await pg.screenshot({ path: process.env.BOSS_SHOT }); console.log('saved ' + process.env.BOSS_SHOT); }
  const flag = await pg.waitForFunction(() => window.__play.enemyAI.eventFlags[0] === 40, null, { timeout: 60000 }).then(() => true).catch(() => false);
  ok(flag, 'after 180 ticks: the death event 0x17 sets stage flag 0 = 40 (main\'s boss loop ends)');
  // the boss's death drop (FUN_0055cac8 -> items.js drop) loads item model g058 (exported since worker 0237): no 404 allowed
  ok(errs.length === 0, `no page errors (the drop model g058 included)${errs.length ? ': ' + errs.slice(0, 5).join(' | ') : ''}`);
  if (warns.length) console.log('warnings:\n  ' + [...new Set(warns)].slice(0, 25).join('\n  '));
} catch (e) { if (!e.stop) throw e; } finally {
  await browser.close();
  srv.kill();
}
done();
