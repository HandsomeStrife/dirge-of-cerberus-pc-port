// The level end and the Status screen on the real play.html (worker 0232; notes/results-research.md), headless:
//   main's level-end tail run through the stage's own classes and natives (a second EventVM on __play.stage.rt.vm's
//   classes / natives, as main runs them): Event.setflag(13, 99), Intermission.endSection(), displayStageInfo(2) (the
//   library's bytecode: Intermission.calc() -> KerberosIntermissionCalc, then displayStageInfo_l -> stage_info.js kind 2
//   -> results.js box 0x1d), then ✕ through the parts, then Zone.exit(181) -> the page stops (report mode) with a note.
//   Checks: the section end (end = play seconds), calc ran (stat 18 = 2000 from the save's stats), the box opens and
//   shows the title, the section name and the rows' values, ✕ moves on, the box closes, exit freezes the page.
//   node native/web/test_results_page.mjs   (needs playwright, data/results.json, data/stage_info.json, data/event)
//   RESULTS_SHOT=<png> saves the rows.
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
for (const f of ['data/results.json', 'data/stage_info.json', 'data/pause.json', 'data/event/ev0100_stage.json'])
  if (!fs.existsSync(path.join(here, f))) { console.log('SKIP: no ' + f); done(); }
let chromium;
try {
  const g = execSync('npm root -g', { encoding: 'utf8' }).trim();
  ({ chromium } = createRequire(path.join(g, '/'))('playwright'));
} catch { console.log('SKIP: playwright not installed'); done(); }

const port = await new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const srv = spawn('python3', ['-I', '-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', here], { stdio: 'ignore' });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const pg = await browser.newPage({ viewport: { width: 960, height: 540 } });
  const errs = [], infos = [];
  pg.on('console', m => { if (m.type() === 'error') errs.push(m.text()); if (m.type() === 'info') infos.push(m.text()); });
  pg.on('pageerror', e => errs.push(e.message));
  for (let i = 0; ; i++) {
    try { await pg.goto(`http://127.0.0.1:${port}/play.html?video=pal&intro=0&enemydmg=0`, { waitUntil: 'load' }); break; }
    catch (e) { if (i > 20) throw e; await new Promise(r => setTimeout(r, 250)); }
  }
  await pg.waitForFunction(() => window.__play && window.__play.stats.ticks > 30 && window.__play.stage && window.__play.stageInfo && window.__play.results, null, { timeout: 180000 });
  await pg.evaluate(() => Promise.all([window.__play.stageInfo.ready, window.__play.results.ready]));
  const until = (fn, arg, t = 60000) => pg.waitForFunction(fn, arg, { timeout: t });
  const s0 = await pg.evaluate(() => { const S = window.__play.results.stats; return { sect: Array.from(S.sect), start: S.start, play: S.playSec, mark: S.mark, D: !!window.__play.results.D }; });
  ok(s0.D && s0.start === 11 && s0.sect[14] === 1 && s0.sect[0] === 3 && s0.mark === 1, `stats from the save: start ${s0.start}, section ${s0.sect[14]}, kills ${s0.sect[0]}, mark ${s0.mark} (11 / 1 / 3 / 1)`);
  ok(s0.play >= 53, `play seconds run from the save's 53: ${s0.play}`);

  // main's tail (bytecode 11123..11152) on a VM of the stage's classes and natives
  const r1 = await pg.evaluate(async () => {
    const P = window.__play, vm0 = P.stage.rt.vm;
    const { EventVM } = await import('./event_vm.js');
    // a native runs its C translation (as the VM's invoke does), a bytecode method on a fresh VM
    const call = (cls, name, desc, args) => {
      const vm = new EventVM({ classes: vm0.classes }, vm0.natives);
      const hit = vm.findMethod(cls, name, desc);
      if (hit.m.access & 0x100) return vm0.natives[hit.cls + '.' + name + desc](vm, args);
      vm.start(cls, name, desc, args); return vm.run(1e7);
    };
    call('fake/KerberosEvent', 'setflag', '(IB)V', [13, 99]);
    const play = P.results.stats.playSec;
    call('fake/KerberosIntermission', 'endSection', '()V', []);
    const S = P.results.stats;
    const afterEnd = { end: S.end, mark: S.mark, total0: S.total[0] };
    const r = call('fake/KerberosEvent', 'displayStageInfo', '(I)V', [2]);
    return { play, afterEnd, r, g13: P.stage.globalFlags[13], s18: S.sect[18], s15: S.get(15), kind: P.stageInfo.kind, log: P.results.log.slice() };
  });
  ok(r1.g13 === 99, `global flag 13 = ${r1.g13} (99)`);
  ok(r1.afterEnd.end === r1.play && r1.afterEnd.mark === -1 && r1.afterEnd.total0 === 3, `endSection: end = play seconds ${r1.afterEnd.end} (${r1.play}), mark cleared, totals += section (kills ${r1.afterEnd.total0})`);
  ok(r1.log.join() === 'endSection,calc', `the natives ran: ${r1.log.join()} (endSection, calc)`);
  ok(r1.s18 === 2000, `calc: stat 18 (Gil) = ${r1.s18} (2000, as the game's w232_status f32)`);
  ok(r1.kind === 2, `displayStageInfo(2): stage-info kind ${r1.kind}`);
  // main: sleep(500), then Zone.exit(181) = exit_l(181, 0, 0) -> onExit: the stage program ends; the box runs on
  await until(t0 => window.__play.stats.ticks >= t0 + 25, await pg.evaluate(() => window.__play.stats.ticks));
  const r2 = await pg.evaluate(async () => {
    const P = window.__play, vm0 = P.stage.rt.vm;
    const { EventVM } = await import('./event_vm.js');
    const vm = new EventVM({ classes: vm0.classes }, vm0.natives);
    vm.start('fake/KerberosZone', 'exit', '(I)V', [181]); vm.run(1e5);
    return { exit: P.results.exit, ai: P.enemyAI.S.now, step: P.results.box ? P.results.box.step : -1 };
  });
  ok(r2.exit && r2.exit.join() === '181,0,0', `Zone.exit -> onExit(${r2.exit}) while the box is in its first part (step ${r2.step})`);
  await until(() => { const b = window.__play.results.box; return b && b.screen && b.step >= 60; }, null, 120000);
  const aiNow = await pg.evaluate(() => window.__play.enemyAI.S.now);
  ok(aiNow === r2.ai, `the world stopped after the exit (AI clock ${r2.ai} -> ${aiNow}) while the box ran on`);
  const rows = await pg.evaluate(() => window.__play.results.box.texts());
  const byId = Object.fromEntries(rows.map(t => [t.id, t.text]));
  ok(rows.length >= 18, `the rows are up: ${rows.length} texts`);
  ok(byId[0x13] === '3', `row 0 value (widget 0x13, stat 0) = ${byId[0x13]} (3)`);
  ok(byId[0x1a] === '100%', `row 1 value (widget 0x1a, stat 10) = ${JSON.stringify(byId[0x1a])} (pct(3, 3) = 100, "%3d%%")`);
  ok(byId[0x8] && byId[0x7] && byId[0x7] !== byId[0x8], 'a label and the section name are drawn (text from the user\'s disc)');
  const prims = await pg.evaluate(() => (window.__play.stageInfo.draw() || []).length);
  ok(prims > 50, `the Status screen draws ${prims} primitives`);
  // worker 0258: the Status box's effects on the menu managers (menu_fx.js) draw on the real page. RESULTS_SHOT: <png>.fx.json holds
  // the layer's sprites for a comparison with the w232 / w241 GS dumps
  const fxs = await pg.evaluate(() => {
    const si = window.__play.stageInfo, L = si.fxLayer, last = (L && L.last) || [];
    const q = last.filter(s => s.verts && !s.line && s.tex);
    return { ids: si.fx ? si.fx.title.fx.emitters.map(e => (e.id >>> 0).toString(16)) : [], mgr: si.fx ? [...si.fx.slots.values()].map(e => e.mgr.toString(16)) : [],
      n: q.length, lines: last.filter(s => s.line).length, clear: !!(L && L.depthClear.visible), age: si.fx && si.fx.title.fx.emitters[0] ? si.fx.title.fx.emitters[0].age : null,
      sprites: q.map(s => ({ tag: s.tag, id: (s.id >>> 0).toString(16), tex0: '0x' + s.tex.tex0[1].toString(16) + s.tex.tex0[0].toString(16).padStart(8, '0'), v: s.verts.map(v => [v.gs[0], v.gs[1], v.rgba]) })) };
  });
  ok(fxs.ids.length > 0 && fxs.n > 0 && fxs.clear, `the Status box's effects run and draw: ${fxs.ids.length} emitters (${fxs.ids.join(', ')}), ${fxs.n} sprites, ${fxs.lines} lines, age ${fxs.age}`);
  if (process.env.RESULTS_SHOT) fs.writeFileSync(process.env.RESULTS_SHOT + '.fx.json', JSON.stringify(fxs));
  if (process.env.RESULTS_SHOT) { await pg.screenshot({ path: process.env.RESULTS_SHOT }); console.log('saved', process.env.RESULTS_SHOT); }
  // ✕ when the box takes it (a hold to jump to, or mode 1: the wait), until it closes: the rows' and the points' fast-forward
  // and next part; then parts D and FUN_003c73f0's screen run out by themselves
  let presses = 0;
  for (let k = 0; k < 8; k++) {
    await until(() => { const b = window.__play.results.box; return b.closed || b.hold !== 0 || b.mode === 1; }, null, 60000);
    if (await pg.evaluate(() => window.__play.results.box.closed)) break;
    const st = await pg.evaluate(() => [window.__play.results.box.step, window.__play.results.box.hold]);
    await pg.keyboard.press('Space'); presses++;
    await until(s => { const b = window.__play.results.box; return b.closed || b.step !== s[0] || b.hold !== s[1]; }, st, 30000);
  }
  // (a 5th can land on part D's auto-advance frame: case 7 sets mode 1 + 0x48f for one frame; it changes nothing)
  ok(presses >= 4 && presses <= 5, `✕ presses taken: ${presses} (4: rows jump, next, points jump, next)`);
  await until(() => window.__play.results.box.closed && window.__play.stageInfo.kind === -1, null, 120000);
  ok(true, 'the Status box closed (stage-info kind clear)');
  // then the page stops (report mode)
  await until(() => window.__play.results.box.closed && window.__play.stageInfo.kind === -1);
  await new Promise(r => setTimeout(r, 300));     // the frame after the kind clears sets the stop
  const t0 = await pg.evaluate(() => window.__play.stats.ticks);
  await new Promise(r => setTimeout(r, 800));
  const dt = (await pg.evaluate(() => window.__play.stats.ticks)) - t0;
  ok(dt === 0, `the page stops after the box (game frames in 0.8 s: ${dt})`);
  ok(infos.some(m => m.includes('Zone.exit(181')) && infos.some(m => m.includes('page stops here')), 'the console notes (the next stage; the stop)');
  ok(errs.length === 0, `no page errors (${errs.slice(0, 3).join(' | ')})`);
} finally {
  await browser.close();
  srv.kill();
}
done();
