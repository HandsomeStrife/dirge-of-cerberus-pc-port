// test_scr005_page.mjs -- class ev0143's events on the real play.html (worker 0261; notes/story-cutscenes.md): main takes each from its stage flag 1 sub-beat. The flags are
// set here (page aid: triggers and kills set them in play); the event draws its actors, main comes back to battle, Vincent drawn.
//   node native/web/test_scr005_page.mjs [event ...]  (needs playwright + data; network for the three.js CDN; sandbox off). SCR005_SHOT=<dir>: one screenshot per event at SCR005_AT ms.
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
if (!fs.existsSync(path.join(here, 'data/event/actors/n034.glb'))) { console.log('SKIP: no data/event/actors/n034.glb'); done(); }
let chromium;
try { ({ chromium } = createRequire(path.join(execSync('npm root -g', { encoding: 'utf8' }).trim(), '/'))('playwright')); }
catch { console.log('SKIP: playwright not installed (npm i -g playwright)'); done(); }
const port = await new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const srv = spawn('python3', ['-I', '-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', here], { stdio: 'ignore' });
// MUTATE: the page's event_actors.js / event_actor_rt.js mutated through the test's own routes: noensure (no model arrives), notrim, keepopen, nohold
const MUT = process.env.MUTATE, SUB = { keepopen: ['event_actors.js', "open = preload && preload.models[m];", "open = null;"], noensure: ['event_actors.js', "return M.ready ??= Promise.all([", "return M.ready ??= Promise.resolve(); Promise.all(["], notrim: ['event_actors.js', "const trim = (keep) => {", "const trim = (keep) => { return;"], nohold: ['event_actor_rt.js', "T.loading(R, T.ensure && T.ensure(str(name)))", "0"] }[MUT];
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
// a page session: [warp, steps, trigger whose event 0xd runs first (as walking into it: enemy_ai runEvent, as test_dog_page)]; a step: [event, stage flags, global 1, models drawn, subtitle?]
const ALL = [
  ['stairs', [['roji01_01', { 0: 2, 1: 4 }, 5, ['n033'], true]]],
  ['stairs', [['heri_tobi', { 0: 4, 1: 7 }, 7, ['e023', 'g043'], false]]],
  ['stairs', [['beast_ev01', { 0: 11, 1: 8 }, 7, ['n028', 'e030', 'n059'], false]]],
  // worker 0265: the helpme / citizens warps fire triggers 59 / 58 and set stage flag 1 themselves (warp.js), so these sessions do not
  ['helpme', [['help_people01', null, null, ['e030', 'e027'], true], ['help_orei01', { 1: 10 }, null, ['p000', 'n034'], true], ['beast_ev02', { 1: 11 }, null, ['n028', 'p000'], true]], null],
  ['citizens', [['help_orei02', null, null, ['n023', 'n024', 'n026'], true]], null],
  ['market', [['help_orei04', { 0: 24, 1: 28, 32: 1, 33: 1, 34: 1 }, 25, ['n018', 'n042', 'p000'], false]]],
  ['market', [['help_people03', { 0: 24, 1: 29 }, 25, ['n017', 'e027'], true]]],
  ['market', [['help_orei03', { 0: 24, 1: 30, 30: 1 }, 25, ['p000'], true]]],
];
const want = process.argv.slice(2), SHOT = process.env.SCR005_SHOT, AT = +(process.env.SCR005_AT || 4000);
for (const [warp, steps, trig] of ALL.filter(x => !want.length || x[1].some(y => want.includes(y[0])))) {
  const pg = await browser.newPage({ viewport: { width: 960, height: 540 } });
  const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  pg.on('crash', () => errs.push('the renderer crashed'));   // worker 0274: a stalled session says how far the page got (see the catch)
  if (SUB) await pg.route('**/' + SUB[0], async r => { const t = fs.readFileSync(path.join(here, SUB[0]), 'utf8'); if (!t.includes(SUB[1])) throw new Error('mutant does not apply'); await r.fulfill({ contentType: 'text/javascript', body: t.replace(SUB[1], SUB[2]) }); });
  try {
    for (let i = 0; ; i++) { try { await pg.goto(`http://127.0.0.1:${port}/play.html?intro=0&sound=0&enemydmg=0&warp=${warp}`, { waitUntil: 'load' }); break; } catch (e) { if (i > 20) throw e; await new Promise(r => setTimeout(r, 250)); } }
    await pg.waitForFunction(() => window.__play && window.__play.stats.ticks > 5 && window.__play.stage, null, { timeout: 240000 });
    // main's chain settles first: its battle()s run the stage-load pass (script 0 event 0x23), which switches off what a later beat's flags say is gone
    if (trig != null) { await pg.waitForTimeout(8000); await pg.waitForFunction(() => window.__play.stage.rt.battle, null, { timeout: 120000, polling: 100 }); }
    if (trig != null) await pg.evaluate(t => { const A = window.__play.enemyAI; A.runEvent(A.triggers.find(o => o.t.idx === t), 0xd, [0, 0]); }, trig);
    for (const [ev, flags, g1, models, sub] of steps) {
      await pg.evaluate(([flags, g1, ev]) => { const P = window.__play, R = P.stage.rt; if (g1 != null) R.gflags[1] = g1; if (flags) for (const k in flags) P.enemyAI.eventFlags[k] = flags[k];
        const E = window.__ev = { n: 0, shown: new Set(), win: 0, cam: 0, done: false, loaded: new Set() }; const f = () => { if (window.__ev !== E) return; const w = R.vm.frames.some(F => F.m.name === ev);
          if (w) { E.n++; for (const a of R.actors.slots) { const b = P.stageView.bodyOf(a); let m = false; if (b && b.visible && a.drawn && a.drawn.shown) b.traverse(o => { if (o.isMesh && o.visible && o.geometry.index && o.geometry.index.count) m = true; }); if (m) E.shown.add(a.model); }   // a body in the scene, with triangles
             if (P.stageView.active) E.cam++; if (P.stageWin && P.stageWin.drawAll(performance.now()).length) E.win++; }
          else if (E.n) E.done = true; requestAnimationFrame(f); }; requestAnimationFrame(f); }, [flags, g1, ev]);
      await pg.waitForFunction(ev => window.__play.stage.rt.vm.frames.some(F => F.m.name === ev), ev, { timeout: 300000, polling: 100 });
      if (SHOT) { fs.mkdirSync(SHOT, { recursive: true }); const t0 = await pg.evaluate(() => window.__play.stage.rt.clock); await pg.waitForFunction(t => window.__play.stage.rt.clock >= t, t0 + AT, { timeout: 120000, polling: 50 }).catch(() => {}); await pg.screenshot({ path: path.join(SHOT, ev + '.png') }); }
      await pg.waitForFunction(() => window.__ev.done, null, { timeout: 300000, polling: 200 });
      await pg.waitForFunction(() => window.__play.stage.rt.battle, null, { timeout: 120000, polling: 200 });
      await pg.waitForTimeout(1500);                     // battle()'s hand-back and camera frames
      // the models go at battle() (stage_view.js -> lib.trim), bar the opening's; they came on demand (event_actors.js)
      const tr = await pg.evaluate(ms => { const L = window.__play.stageLib; return ms.filter(m => L.models[m] && L.models[m].gltf && !['p000', 'p005', 'p014', 'e027', 'e048', 'e063', 'g000', 'g013', 'n013', 'w003'].includes(m)); }, models);
      ok(!tr.length, `${ev}: its models freed after battle()`, tr.join());
      const s = await pg.evaluate(() => { const P = window.__play, R = P.stage.rt, E = window.__ev; return { n: E.n, cam: E.cam, win: E.win, shown: [...E.shown], skip: R.log.filter(x => /^skip /.test(x[1])).map(x => x[1]), vis: P.vin.body.visible, eh: !!P.vin.eventHidden, pos: [P.ctrl.pos.x, P.ctrl.pos.y, P.ctrl.pos.z], eye: P.camera.position.toArray() }; });
      ok(s.n > 20, `${ev}: ran`, `${s.n} samples, camera out in ${s.cam}`);
      ok(!s.skip.length, `${ev}: no Skip`, s.skip.join());
      ok(models.every(m => s.shown.includes(m)), `${ev}: draws ${models}`, s.shown.join());
      if (sub) ok(s.win > 0, `${ev}: subtitles`);
      ok(s.vis && !s.eh, `${ev}: Vincent drawn after it`);
      ok(Math.hypot(s.pos[0], s.pos[2]) > 50 && s.eye.every(Number.isFinite) && Math.hypot(s.eye[0] - s.pos[0], s.eye[2] - s.pos[2]) < 120, `${ev}: Vincent and the follow camera in the level, together`, `pos ${s.pos.map(v => v.toFixed(0))} eye ${s.eye.map(v => v.toFixed(0))}`);
    }
    ok(!errs.length, `${steps.map(x => x[0])}: no page errors`, errs.slice(0, 3).join(' | '));
  } catch (e) {
    const at = await pg.evaluate(() => { const P = window.__play; return P ? `ticks ${P.stats.ticks}, stage ${!!P.stage}, warp ${!!P.warp}` : 'no __play'; }).catch(x => 'page gone: ' + x.message.split('\n')[0]);
    ok(false, steps[0][0] + ': exception', e.message.split('\n')[0] + '; ' + at + (errs.length ? '; ' + errs.slice(0, 3).join(' | ') : ''));
  }
  await pg.close();
}
// the opening's models stay through the first battle()'s trim: a Restart with no record replays the opening, whose runtime has no loads to wait on (event_actors.js trim; play.js preload)
if (!want.length || want.includes('opening')) {
  const pg = await browser.newPage({ viewport: { width: 960, height: 540 } });
  if (SUB) await pg.route('**/' + SUB[0], async r => { const t = fs.readFileSync(path.join(here, SUB[0]), 'utf8'); if (!t.includes(SUB[1])) throw new Error('mutant does not apply'); await r.fulfill({ contentType: 'text/javascript', body: t.replace(SUB[1], SUB[2]) }); });
  try {
    await pg.goto(`http://127.0.0.1:${port}/play.html?sound=0&enemydmg=0`, { waitUntil: 'load' });
    await pg.waitForFunction(() => window.__play && window.__play.stage && window.__play.stage.rt.frameNo > 2, null, { timeout: 240000, polling: 100 });
    // worker 0265's stage title card (first_event displayStageInfo(0)) holds the opening and takes no pause input (FUN_003fdb48 ->
    // FUN_00241760(1, 0, 0)): Enter only after the card's fadein
    await pg.waitForFunction(() => { const P = window.__play, r = P.intro && P.intro.rt, si = P.stageInfo; return r && r.log.some(x => /^fadein /.test(x[1])) && (!si || si.kind < 0); }, null, { timeout: 300000 });
    await pg.keyboard.press('Enter'); await pg.waitForTimeout(300); await pg.keyboard.press('Space');
    await pg.waitForFunction(() => window.__play.stage.battle && !window.__play.intro.active, null, { timeout: 240000, polling: 200 }).catch(() => {});
    await pg.evaluate(() => { const P = window.__play; P.enemyAI.eventFlags[0] = 2; P.enemyAI.eventFlags[63] = 6; });   // one event and its battle(): the trim
    await pg.waitForFunction(() => { const R = window.__play.stage.rt; return R.log.some(([, m]) => /^battle/.test(m)) && R.log.some(([, m]) => m === 'scene_save 1') && R.battle; }, null, { timeout: 200000, polling: 500 }).catch(() => {});
    await pg.waitForTimeout(1000);
    const miss = await pg.evaluate(() => { const L = window.__play.stageLib; return ['e027', 'e048', 'e063', 'g000', 'g013', 'n013', 'p000', 'p005', 'p014', 'w003'].filter(m => !L.models[m].gltf).concat(L.models.p000.packs[254].buf ? [] : ['p000 file 254']); });
    ok(!miss.length, 'the opening\'s models and packs still in after a battle()', miss.join());
  } catch (e) { ok(false, 'opening: exception', e.message.split('\n')[0]); }
  await pg.close();
}
await browser.close(); srv.kill();
done();
