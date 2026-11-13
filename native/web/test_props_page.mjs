// The explosive barrel on the real page (worker 0209; notes/barrel-research.md), in a headless browser with the default
// options. Record 17's barrel (the one active at the save) is drawn at its placement; the test then moves it in front of
// Vincent (the trace's aid: w209_barrel moves it with cmd 0x121), raises the gun and fires with R1 (aim.js -> lock-on ->
// enemy_ai playerShot): the lock-on takes the barrel (+0x38 bit 2), a pellet breaks it (HP 1), script 196 runs the
// explosion (props.js: cmd 0x2a), Vincent 35 u away takes the blast (118, as in the trace), the effect 0x800 is spawned
// in the page's effect engine and the barrel's model goes.
//   node native/web/test_props_page.mjs     (needs data/props + data/enemies + playwright; else SKIP, exit 0)
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
for (const f of ['data/props/props.json', 'data/props/e057.glb', 'data/enemies/ai.json'])
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
  const errs = [], warns = [];
  pg.on('console', m => { if (m.type() === 'error') errs.push(m.text()); if (m.type() === 'warning') warns.push(m.text()); });
  pg.on('pageerror', e => errs.push(e.message));
  for (let i = 0; ; i++) {
    try { await pg.goto(`http://127.0.0.1:${port}/play.html?video=pal&intro=0`, { waitUntil: 'load' }); break; }
    catch (e) { if (i > 20) throw e; await new Promise(r => setTimeout(r, 250)); }
  }
  await pg.waitForFunction(() => window.__play && window.__play.stats.ticks > 30 && window.__propsView, null, { timeout: 120000 });
  // worker 0246: the explosion's sound bsj_065 (a resident sdb name: FUN_003e8e18 -> FUN_003eb868 slot 0). A gesture makes
  // the AudioContext; the emitter sends are logged (audio.js SoundEmitters.update)
  await pg.keyboard.press('KeyQ');
  const sfxOn = await pg.waitForFunction(() => { const P = window.__play; return !!(P.amb && P.amb.sfx && P.pauseSound.audio && P.pauseSound.audio.ctx); }, null, { timeout: 60000 }).then(() => true).catch(() => false);
  await pg.evaluate(() => { const P = window.__play; if (P.amb.sfx) P.amb.sfx.log = []; });
  const r = await pg.evaluate(async () => {
    const P = window.__play, props = window.__props, view = window.__propsView, ai = P.enemyAI;
    const wait = n => new Promise(res => setTimeout(res, n));
    const o = props.barrels.find(b => b.rec === 17);
    const out = { start: { active: props.barrels.filter(b => b.flags28 & 1).map(b => b.rec), hp: o.hp, pos: o.pos.slice() } };
    const mesh = view.meshes.get(o);
    out.start.mesh = !!mesh && mesh.visible;
    // world y of the model's lowest vertex (FUN_005842c8: the base on the floor under the centre: centre y + 7.5)
    if (mesh) { mesh.updateMatrixWorld(true); const bb = new (P.camera.position.constructor)(); let maxY = -Infinity;
      mesh.traverse(n => { if (n.isMesh) { const a = n.geometry.attributes.position; for (let i = 0; i < a.count; i++) { if (n.isSkinnedMesh) n.getVertexPosition(i, bb); else bb.fromBufferAttribute(a, i); bb.applyMatrix4(n.matrixWorld); maxY = Math.max(maxY, bb.y); } } });
      out.start.baseY = maxY; }
    { let minY = Infinity; const v = new (P.camera.position.constructor)(); mesh && mesh.traverse(n => { if (n.isMesh) { const a = n.geometry.attributes.position; for (let i = 0; i < a.count; i++) { if (n.isSkinnedMesh) n.getVertexPosition(i, v); else v.fromBufferAttribute(a, i); v.applyMatrix4(n.matrixWorld); minY = Math.min(minY, v.y); } } }); out.start.topY = minY; }
    // the test aid: the barrel 35 u in front of Vincent at his chest height, in the camera's view
    const c = P.ctrl.pos, F = P.follow.M[2], hz = Math.hypot(F[0], F[2]);
    const at = [c.x + F[0] / hz * 35, c.y - 12, c.z + F[2] / hz * 35];
    o.pos = at.slice(); o.m[3] = [...at, 1];
    await wait(300);
    const evs = [], hp0 = P.php.hp, spawned = [];
    const FX = window.__fx && window.__fx.fx, sp0 = FX && FX.spawn;
    if (FX) FX.spawn = (id, p, sc) => { spawned.push({ id, sc: sc ? Array.from(sc) : null }); return sp0(id, p, sc); };
    const tick = ai.tick;
    ai.tick = (...x) => { const ev = tick(...x); for (const e of ev) if (/barrel|p17|explosion|blast/.test(e)) evs.push(ai.S.frame + ' ' + e); return ev; };
    if (!P.aim.state().drawn) { P.aim.press('r1'); await wait(1200); }
    for (let k = 0; k < 4 && !evs.some(e => /explosion x0 r/.test(e)); k++) { P.aim.press('r1'); await wait(1500); }
    await wait(1500);
    const fxe = window.__fx ? window.__fx.fx.emitters.filter(e => e.id === 0x800).length : null;
    ai.tick = tick; if (FX) FX.spawn = sp0;
    Object.assign(out, { evs, hp0, hp: P.php.hp, gone: o.gone, hpBarrel: o.hp, meshAfter: !!mesh && mesh.visible, fxe,
                         spawned, fxOn: !!FX, explosions: props.explosions.length });
    return out;
  });
  console.log('events:\n  ' + r.evs.join('\n  '));
  ok(r.start.active.length === 1 && r.start.active[0] === 17 && r.start.hp === 1, `start: active barrels [${r.start.active}] ([17]), HP ${r.start.hp}`);
  ok(r.start.mesh, 'record 17\'s barrel model is drawn at the start (props_view.js)');
  ok(Math.abs(r.start.baseY - (r.start.pos[1] + 7.5)) < 0.01 && Math.abs(r.start.topY - (r.start.pos[1] - 7.5)) < 0.05, `its base at y ${r.start.baseY.toFixed(2)} = centre + 7.5 (${(r.start.pos[1] + 7.5).toFixed(2)}, the floor: FUN_005842c8), top ${r.start.topY.toFixed(2)}`);
  ok(r.evs.some(e => / bullet hits p17$/.test(e)) && r.hpBarrel === 0, `a pellet hits the barrel (HP ${r.hpBarrel})`);
  ok(r.evs.some(e => /explosion x0 r 65 dmg 120/.test(e)), 'script 196 runs the explosion (radius 65, damage 120)');
  ok(r.evs.some(e => /explosion x0 targets P/.test(e)) && r.hp0 - r.hp === 118, `Vincent 35 u away: HP ${r.hp0} -> ${r.hp} (118, as in the trace)`);
  ok(r.gone && !r.meshAfter, 'the barrel and its model are gone');
  const boom = await pg.evaluate(() => { const P = window.__play, A = P.pauseSound.audio;
    return { sent: (P.amb.sfx && P.amb.sfx.log || []).filter(e => e.name === 'bsj_065'), id: A ? A.seIdOf('bsj_065') : 0, prog: !!(A && A.program(A.seIdOf('bsj_065'))) }; });
  ok(sfxOn && boom.id > 0 && boom.prog && boom.sent.length === 1 && boom.sent[0].vol > 0, `the explosion's bsj_065 is sent once (id ${boom.id}, program ${boom.prog}): ${JSON.stringify(boom.sent)}`);
  const s8 = r.spawned.find(x => x.id === 0x800);
  ok(!r.fxOn || (s8 && s8.sc && Math.abs(s8.sc[0] - 6.5) < 1e-6), `effect 0x800 spawned in the page's engine with scale ${s8 && s8.sc} (effects ${r.fxOn ? 'on' : 'off'}; its channel type 46 is not translated yet)`);
  const bad = errs.filter(e => !/favicon/.test(e));
  ok(bad.length === 0, `no page errors (${bad.slice(0, 3).join(' | ')})`);
  const pw = warns.filter(w => /^props:/.test(w));
  console.log('props warnings: ' + (pw.join(' | ') || 'none'));
} finally {
  await browser.close();
  srv.kill();
}
done();
