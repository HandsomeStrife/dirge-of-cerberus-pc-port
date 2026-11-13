// test_strafe_walk_page.mjs -- worker 0267: Dan's "the guards on the stairs work, but they seem to slide around as opposed to animating
// (same with the guards at the lower level)" (2026-11-08) on the real play.html. ?warp=stairs (chunk 02, the alley stairs: e048 / e027
// records 52-54 active), then one real shot on soldier 53 (enemy_ai playerShot through his part boxes): his hit script changes his
// brain and he moves. Every frame a soldier's body moves, the drawn body (enemies.js head layer) must play a walk / run clip of
// motion 9 / 0x17 (FUN_00595440 / FUN_00597430: *_wk_a, *_rn_a, *_ma) or 8 (r_gwk / r_grn), not a standing clip, and its frame
// must advance. Before worker 0267 the class stayed 6 (FUN_00594978's move test was missing) and the body slid in r_st_a.
//   flock tools/trace/out/.browser.lock node native/web/test_strafe_walk_page.mjs   (WEBDIR=<dir> serves another copy)
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawn, execSync } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const WEB = process.env.WEBDIR || here;
let fail = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };
const done = () => { console.log(fail ? `${fail} FAILED` : 'all ok'); process.exit(fail ? 1 : 0); };
for (const f of ['data/z128_collision.bin', 'data/enemies/ai.json', 'data/enemies/e027.json'])
  if (!existsSync(path.join(WEB, f))) { console.log(`SKIP: ${f} missing (tools/byo/build_web.sh)`); done(); }
let chromium;
try {
  const g = execSync('npm root -g', { encoding: 'utf8' }).trim();
  ({ chromium } = createRequire(path.join(g, '/'))('playwright'));
} catch { console.log('SKIP: playwright not installed (npm i -g playwright)'); done(); }

const port = await new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const srv = spawn('python3', ['-I', '-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', WEB], { stdio: 'ignore' });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const pg = await browser.newPage({ viewport: { width: 480, height: 360 } });
  const errs = [];
  pg.on('pageerror', e => errs.push(e.message));
  for (let i = 0; ; i++) {
    try { await pg.goto(`http://127.0.0.1:${port}/play.html?video=pal&sound=0&warp=stairs`, { waitUntil: 'load' }); break; }
    catch (e) { if (i > 20) throw e; await new Promise(r => setTimeout(r, 250)); }
  }
  const warped = await pg.waitForFunction(() => window.__play && window.__play.warp, null, { timeout: 240000 }).then(() => true).catch(() => false);
  ok(warped, 'the stairs warp ran');
  if (!warped) done();
  await pg.waitForFunction(() => [52, 53, 54].every(k => window.__play.enemies.actors.some(a => a.rec === k && a.posed)), null, { timeout: 60000 }).catch(() => null);
  const r = await pg.evaluate(async () => {
    const P = window.__play, A = P.enemyAI, wait = ms => new Promise(res => setTimeout(res, ms));
    const hb = (await fetch('data/enemies/ai.json').then(x => x.json())).hitboxes.e027;
    const Wv = { ...(await fetch('data/aim/weapon.json').then(x => x.json())), spread: null, pellets: 1 };
    const s53 = A.actors.find(a => a.rec === 53);
    if (!s53 || !hb) return { err: `no soldier 53 (${!!s53}) or e027 hitboxes (${!!hb})` };
    // one shot through his first part box, from 6 u out along x (nothing else in between) (the box's world point from his drawn pose)
    const hp0 = s53.hp, mode0 = s53.ai && s53.ai.mode;
    for (let k = 0; k < 20 && s53.hp === hp0; k++) {
      const bw = P.enemies.partPose(53);
      if (!bw) { await wait(50); continue; }
      const b = hb[0], B = bw(b.bone), c = [0, 1, 2].map(i => b.offset[0] * B[0][i] + b.offset[1] * B[1][i] + b.offset[2] * B[2][i] + B[3][i]);
      A.playerShot([c[0] - 6, c[1], c[2]], [c[0] + 6, c[1], c[2]], Wv);
      await wait(60);
    }
    const hit = { hp0, hp: s53.hp, mode0, mode: s53.ai && s53.ai.mode };
    // sample every tick for ~700 ticks: per soldier, ticks with the body moving and what the drawn body plays
    const walkClip = c => /(wk_a|rn_a|_ma|_gwk|_grn)$/.test(c) || /^(a_wk|a_wk_l|a_wk_r|a_rn)$/.test(c);
    const stat = {}, last = {};
    let t = P.stats.ticks; const end = t + 700, t0 = performance.now();
    while (P.stats.ticks < end && performance.now() - t0 < 180000) {
      await wait(4);
      if (P.stats.ticks === t) continue;
      t = P.stats.ticks;
      for (const a of A.actors) {
        const d = P.enemies.actors.find(x => x.rec === a.rec);
        if (!d || !d.head || !a.C) continue;
        const s = stat[a.rec] ??= { model: a.model, moving: 0, walk: 0, run: 0, worst: 0, adv: 0, clips: {}, bad: [] };
        const l = last[a.rec], moved = l && Math.hypot(a.pos[0] - l.pos[0], a.pos[2] - l.pos[2]) > 0.05;
        if (moved && a.C.speed > 0) {
          s.moving++;
          s.clips[d.head.clip] = (s.clips[d.head.clip] || 0) + 1;
          if (walkClip(d.head.clip)) { s.walk++; s.run = 0; if (l.clip === d.head.clip && d.head.frame !== l.frame) s.adv++; }
          else { s.run++; s.worst = Math.max(s.worst, s.run); if (s.bad.length < 4) s.bad.push(`${t}:${d.head.clip}/m${a.C.motion && a.C.motion.cls}`); }
        } else if (l) s.run = 0;
        last[a.rec] = { pos: a.pos.slice(), clip: d.head.clip, frame: d.head.frame };
      }
    }
    return { hit, stat };
  });
  if (r.err) { ok(false, r.err); done(); }
  ok(r.hit.hp < r.hit.hp0, `soldier 53 hit: HP ${r.hit.hp0} -> ${r.hit.hp}, brain mode ${r.hit.mode0} -> ${r.hit.mode}`);
  const movers = Object.entries(r.stat).filter(([, s]) => s.moving >= 20);
  ok(movers.length >= 1, `soldiers that moved (>= 20 frames): ${movers.map(([k, s]) => `${k} ${s.model} ${s.moving}`).join(', ') || 'none'}`);
  for (const [k, s] of movers) {
    // a switch into the walk takes the motion update's frame and the table step's (FUN_00343160): at most 2 moving frames in another clip
    ok(s.worst <= 2 && s.walk >= s.moving - 4, `#${k} ${s.model}: moving ${s.moving} frames, drawn in a walk / run clip on ${s.walk} (clips ${JSON.stringify(s.clips)}; longest other run ${s.worst}${s.bad.length ? ', ' + s.bad.join(' ') : ''})`);
    ok(s.walk > 0 && s.adv >= s.walk * 0.9, `#${k}: the walk clip's frame advances on ${s.adv} / ${s.walk} frames`);
  }
  ok(errs.length === 0, `no page errors (${errs.slice(0, 2).join(' | ')})`);
} finally {
  await browser.close();
  srv.kill();
}
done();
