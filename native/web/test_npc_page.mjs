// Townspeople on the real page (worker 0223; notes/npc-research.md): play.js -> enemy_ai.js -> enemies.js for the n0xx records.
//   1. trigger 96 (script 23) crossed in the page's enemy_ai world wakes NPCs 111 / 113 / 114: enemies.js draws them (n033 /
//      n023 / n024 bodies, no AI actor) at the cmd 0x10e locators, and they switch to the clip their event 3 asks for (cmd
//      0x141 'fear' over the stance's row-0 idle 'st'). T: w223_npc95 (wake f783 in 'st', 'fear' from f784).
//   2. the stage areas follow Vincent (areas.js): at the start 105 (on 2 / 15 / 105, the save's RAM).
//   3. (worker 0228) they are actors: 113 slides along path 96 and is drawn at its end; shots at 114 hit and kill it (dead clip).
//   NPC_SHOT=<png>: a screenshot with Vincent where w223_npcview put him (-1125, -1, -1255), facing the game's (0.912, 0, -0.409).
//   node native/web/test_npc_page.mjs     (needs data/enemies with the n0xx exports + playwright; else SKIP). Sandbox off (CDN).
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
for (const f of ['data/enemies/ai.json', 'data/enemies/n023.glb', 'data/enemies/n024.glb', 'data/enemies/n033.glb'])
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
  pg.on('console', m => { if (m.type() === 'error') errs.push(m.text()); if (m.type() === 'warning' && /enemies|npc|0x141|areas/.test(m.text())) warns.push(m.text()); });
  pg.on('pageerror', e => errs.push(e.message));
  const OPTIONAL = new Set(['/game_state.js', '/stage_info.js']);
  pg.on('response', r => { if (r.status() !== 404) return; const u = r.url().replace(/^http:..[^/]+/, ''); if (!OPTIONAL.has(u)) errs.push('404 ' + u); });
  const page = process.env.PLAY_HTML || 'play.html';
  for (let i = 0; ; i++) {
    // NPC_SHOT: the game's camera of w223_npcview f100 (CAM+0x90 eye, +0x80 forward -> yaw 96.92, pitch 8.13) as ?cam=
    const cam = process.env.NPC_SHOT ? '&cam=' + (process.env.NPC_CAM || '-1162.73,-11.40,-1250.42,96.92,8.13') : '';
    try { await pg.goto(`http://127.0.0.1:${port}/${page}?intro=0&sound=0${cam}`, { waitUntil: 'load' }); break; }
    catch (e) { if (i > 20) throw e; await new Promise(r => setTimeout(r, 250)); }
  }
  await pg.waitForFunction(() => window.__play && window.__play.stats.ticks > 30 && window.__play.enemyAI && window.__play.enemies, null, { timeout: 120000 });

  // 2. areas at the start
  const ar = await pg.evaluate(() => { const A = window.__play.areas; return A ? { cur: A.cur, on: [...A.on].sort((a, b) => a - b) } : null; });
  ok(!!ar && ar.cur === 105 && ar.on.join() === '2,15,105', `stage areas at the start: current ${ar && ar.cur}, on ${ar && ar.on.join(' / ')} (save RAM: 105; 2 / 15 / 105)`);

  // 1. the wake: Vincent's segment across trigger 96 (its local z, row 2) in the page's world
  await pg.evaluate(async () => {
    const P = window.__play, W = P.enemyAI, r = await fetch('data/enemies/ai.json').then(x => x.json());
    const m = r.triggers[96].m, c = m[3], z = m[2], a = [0, 1, 2].map(i => c[i] - 10 * z[i] + (i === 1 ? -5 : 0)), b = [0, 1, 2].map(i => c[i] + 10 * z[i] + (i === 1 ? -5 : 0));
    W.tick(1.0, a, a); W.tick(1.0, a, b);
  });
  const got = await pg.waitForFunction(() => {
    const E = window.__play.enemies, rs = [111, 113, 114].map(k => E.actors.find(a => a.rec === k));
    return rs.every(Boolean) && rs.every(a => a.head && a.head.clip === 'fear')
      ? rs.map(a => ({ rec: a.rec, model: a.model, clip: a.head.clip, out: a.out ? a.out.clip : null, pos: a.body.position.toArray(), inScene: !!a.body.parent })) : false;
  }, null, { timeout: 60000 }).then(h => h.jsonValue()).catch(() => null);
  ok(!!got, 'trigger 96: NPCs 111 / 113 / 114 drawn, each in the clip its event 3 asked for (fear)' + (got ? ': ' + got.map(g => `${g.rec} ${g.model} ${g.clip}`).join(', ') : ''));
  if (got) {
    const by = k => got.find(g => g.rec === k);
    ok(by(111).model === 'n033' && by(113).model === 'n023' && by(114).model === 'n024' && got.every(g => g.inScene), 'models n033 / n023 / n024, in the scene');
    const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 0.02);
    ok(near(by(111).pos, [-1016.41, -0.3, -1174.9]) && near(by(114).pos, [-1074.37, -0.127, -1274.05]),
       `at the locators (T RAM: 111 (-1016.41, -0.30, -1174.90), 114 (-1074.37, -0.13, -1274.05)): ${by(111).pos.map(v => v.toFixed(2))} / ${by(114).pos.map(v => v.toFixed(2))}`);
  }
  // worker 0228: the townspeople are enemy_ai actors. 113's path 96 slide ends at (-1081.11, -0.01, -1280.13) (T w223_npc95 f791),
  // and its drawn body follows; a shot through 114's chest bone (the page's own pose: enemies.js partPose) hits it, three kill it.
  const slid = await pg.waitForFunction(() => {
    const E = window.__play.enemies, a = E.actors.find(x => x.rec === 113), s = window.__play.enemyAI.objects.get(113 + 22);
    return a && s && s.kind === 'actor' && s.C.mover === 0 ? { body: a.body.position.toArray(), ai: s.pos.slice() } : false;
  }, null, { timeout: 30000 }).then(h => h.jsonValue()).catch(() => null);
  ok(!!slid && [-1081.11, -0.01, -1280.13].every((v, i) => Math.abs(v - slid.body[i]) < 0.05),
     `113 slid along path 96 and is drawn at its end: ${slid ? slid.body.map(v => v.toFixed(2)) : 'no'}`);
  // worker 0229: ev0100 main's rescue beat on the page. Stage flag 0 = 2 (rv_matiawase; main then puts its p000 slot named
  // p_Vin at (-889.2, 0, -599) and battle(1500) hands it to Vincent), then flag 1 = 5 (pc 0x849: getbattleactor p_Vin / n_CupM /
  // n_CupW, roji02_01 auto-skipped, setpos / setdir, Camera.set, setbattlename p_Vin, battle()). T w229_rescue_pos (PCSX2, the
  // same flags poked from w223's s826): f1850 Vincent (-889.2, -0.064, -599) facing (-1, 0, 0); record 2126 (-1120.2, -0.0623,
  // -1277.3) facing (0.98894, 0, -0.14831), the camera's forward (0.75641, 0.64547, -0.10588) = main's event camera, eye
  // (-1136.096, -31.009, -1275.074). The townspeople's lent models are freed at battle() (they are drawn again).
  if (!process.env.NPC_SHOT) {
    const beat = async (k, v, want) => pg.evaluate(async ([k, v, want]) => {
      const P = window.__play, rt = P.stage && P.stage.rt;
      if (!rt) return { err: 'no stage controller' };
      const cams = [], f = P.follow, reset = f.reset;
      f.reset = function (...a) { const r = reset.apply(this, a); cams.push({ eye: this.eye.slice(), fwd: this.M[2].slice() }); return r; };
      P.enemyAI.eventFlags[k] = v;
      const t0 = Date.now();
      while (!rt.log.some(([, m]) => m.startsWith('handback p_Vin ' + want)) && Date.now() - t0 < 30000) await new Promise(r => setTimeout(r, 50));
      const t1 = P.stats.ticks; while (P.stats.ticks < t1 + 3) await new Promise(r => setTimeout(r, 50));
      f.reset = reset;
      const E = P.enemies.actors, vis = k => { const a = E.find(x => x.rec === k); return a ? a.body.visible : null; };
      return { pos: [P.ctrl.pos.x, P.ctrl.pos.y, P.ctrl.pos.z], face: [P.ctrl.C.face.x, P.ctrl.C.face.z], cams, vis: [vis(113), vis(114)], vin: P.vin.body.visible,
               log: rt.log.filter(([, m]) => /getbattleactor|battlename|handback|freed|^battle /.test(m)).map(x => x.join(' ')).slice(-8) };
    }, [k, v, want]);
    const near = (a, b, e) => a.every((x, i) => Math.abs(x - b[i]) <= e);
    const b1 = await beat(0, 2, '-889.20');
    ok(b1 && !b1.err && near(b1.pos, [-889.2, -0.064, -599], 0.02) && near(b1.face, [-1, 0], 1e-5),
       `rv_matiawase: main's p000 slot named p_Vin hands Vincent its place (T f1850 (-889.2, -0.064, -599) facing -x): ${b1 && b1.pos ? b1.pos.map(v => v.toFixed(3)) + ' face ' + b1.face.map(v => v.toFixed(4)) : JSON.stringify(b1)}`);
    const b2 = await beat(1, 5, '-1120.20');
    const c = b2 && b2.cams && b2.cams.at(-1);
    ok(b2 && !b2.err && near(b2.pos, [-1120.2, -0.0623, -1277.3], 0.02) && near(b2.face, [0.98894, -0.14831], 1e-4),
       `the rescue (getbattleactor p_Vin, setpos, setdir, setbattlename): Vincent at T record 2126 (-1120.2, -0.0623, -1277.3) facing (0.98894, -0.14831): ${b2 && b2.pos ? b2.pos.map(v => v.toFixed(4)) + ' face ' + b2.face.map(v => v.toFixed(5)) : JSON.stringify(b2)}`);
    ok(!!c && near(c.fwd, [0.75641, 0.64547, -0.10588], 2e-4),
       `battle()'s camera reset (FUN_00329f68 -> FUN_003285d0): forward from main's event camera ${c ? c.fwd.map(v => v.toFixed(5)) : '-'} (T 0.75641 0.64547 -0.10588)`);
    // KNOWN GAP (not this work's): the eye's distance along that forward. T: 21.05 u from the aim point (feet - 17.4 in y),
    // the page's FollowCamera places it 36.1 u out at this pitch (-0.70 rad); the reset's angles above are the translated part
    if (c) console.log(`GAP  camera eye after the reset ${c.eye.map(v => v.toFixed(3))} (T -1136.096 -31.009 -1275.074): FollowCamera distance at pitch -0.70`);
    ok(b2 && b2.vin === true && b2.vis && b2.vis.every(v => v !== false) && b2.log.some(m => /battle actor \d+ freed/.test(m)),
       `after battle(): Vincent drawn, 113 / 114 lent models freed and drawn again (${b2 && b2.vis}); log: ${b2 && b2.log && b2.log.join(' | ')}`);
  }
  // (skipped with NPC_SHOT: the image wants 114 alive)
  if (!process.env.NPC_SHOT) {
  const kill = await pg.evaluate(async () => {
    const P = window.__play, W = P.enemyAI, wj = await fetch('data/aim/weapon.json').then(x => x.json());
    const straight = { ...wj, spread: null, pellets: 1 }, hp = [], log = [];
    const tk = W.tick; W.tick = (...x) => { const r = tk(...x); log.push(...W.events.filter(e => /136|bullet|hit|miss/.test(e))); return r; };
    const a = () => W.objects.get(114 + 22);
    for (let k = 0; k < 6 && a().hp > 0; k++) {
      const bw = W.boneWorld && W.boneWorld(a()); if (!bw) return { err: 'no pose' };
      // a horizontal line through the chest bone that the room ray (collision.js) leaves clear for 30 u: 114 stands among crates
      const c = bw(3)[3];
      let f = null;
      for (let i = 0; i < 16 && !f; i++) {
        const t = i * Math.PI / 8, d = [Math.sin(t), 0, Math.cos(t)], m = [c[0] + 30 * d[0], c[1], c[2] + 30 * d[2]];
        if (!W.roomRay || !W.roomRay(m, [c[0] - d[0], c[1], c[2] - d[2]])) f = d;
      }
      if (!f) return { err: 'no clear line to 114', hp };
      W.queueShot([c[0] + 30 * f[0], c[1], c[2] + 30 * f[2]], [c[0] - 30 * f[0], c[1], c[2] - 30 * f[2]], straight);
      const t0 = P.stats.ticks;                                              // the bullet's flight: wait 12 page ticks
      while (P.stats.ticks < t0 + 12) await new Promise(r => setTimeout(r, 50));
      hp.push(a().hp);
    }
    const t1 = P.stats.ticks; while (P.stats.ticks < t1 + 20) await new Promise(r => setTimeout(r, 50));
    const d = P.enemies.actors.find(x => x.rec === 114);
    return { hp, state: a().astate, clip: a().C.clip, drawn: d ? d.head.clip : null, f38: a().f38, ev: log.slice(0, 6).concat([`bullets ${W.bullets.length}`, `c ${W.boneWorld(a())(3)[3].map(v => v.toFixed(1))} pos ${a().pos.map(v => v.toFixed(1))}`]), paused: !!(window.__play.gameState && window.__play.gameState.aiPaused && window.__play.gameState.aiPaused()) };
  });
  ok(kill && !kill.err && kill.hp[0] < 58 && kill.hp.at(-1) === 0 && kill.state === 7 && /^dead/.test(kill.drawn) && kill.f38 === 0x181,
     `shots at 114 on the page: HP ${kill && kill.hp && kill.hp.join(' -> ')}, actor state ${kill && kill.state}, drawn ${kill && kill.drawn}${kill && kill.err ? ' ' + kill.err : ''}${kill && kill.hp.at(-1) ? ' ' + JSON.stringify(kill.ev) : ''}`);
  }
  ok(!warns.some(w => /not drawn|not exported/.test(w)), 'no "not drawn" / "not exported" warnings' + (warns.length ? ': ' + warns.slice(0, 2).join(' | ') : ''));

  if (process.env.NPC_SHOT) {
    await pg.evaluate(() => {
      // test aid (as test_enemies_page): position write, walk polygon re-found by locate(), camera reset as on the H / ladder warps
      const P = window.__play, c = P.ctrl, h = Math.atan2(0.9124146, -0.4092672);
      c.heading = h; c.prevHeading = h; c.C.face = { x: Math.sin(h), y: 0, z: Math.cos(h) };
      c.pos = { x: -1125, y: 0, z: -1255 }; c.prev = { ...c.pos }; c.locate(); if (c.onTeleport) c.onTeleport();
    });
    await pg.waitForTimeout(15000);
    // the game's Vincent stands where w223_npcview poked him; the page's soldiers 69-71 (woken by the same script) walked up to
    // him here and pushed him ~12 u away (the game's never came: different route), so: him back in place, them hidden (image only)
    const shot = async (file, side) => {
      await pg.evaluate(side => {
        const P = window.__play, c = P.ctrl;
        c.pos = { x: -1125, y: 0, z: -1255 }; c.prev = { ...c.pos }; c.locate();
        for (const a of P.enemies.actors) if (![111, 113, 114].includes(a.rec)) a.body.visible = false;
        const bodies = new Set([P.vin.body, ...P.enemies.actors.map(a => a.body)]);
        // NPC_BARE=1: the bodies only; NPC_SIDE=front|back: the room drawn one-sided (a test of the grey surface)
        for (const ch of P.root.children) if (!bodies.has(ch)) {
          if (side === 'bare') ch.visible = false;
          else if (side) ch.traverse(o => { if (o.isMesh && o.material && !Array.isArray(o.material)) { o.material.side = side === 'front' ? 0 : 1; o.material.needsUpdate = true; } });
        }
      }, side);
      await pg.waitForTimeout(300);
      await pg.screenshot({ path: file });
      console.log('     shot', file, side || 'as drawn');
    };
    if (process.env.NPC_SIDE) for (const sd of ['front', 'back']) await shot(process.env.NPC_SHOT.replace(/\.png$/, `_${sd}.png`), sd);
    else await shot(process.env.NPC_SHOT, process.env.NPC_BARE ? 'bare' : null);
  }
  ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
} catch (e) { ok(false, String(e)); } finally {
  await browser.close();
  srv.kill();
}
done();
