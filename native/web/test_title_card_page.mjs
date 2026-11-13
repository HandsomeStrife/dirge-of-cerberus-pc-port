// The stage title card in the opening (worker 0265), on the real play.html in a headless browser:
//   first_event (ev0101) pc 884 displayStageInfo(0) -> stage_info.js kind 0 -> box kind 0x1e (FUN_003c54f8: steps 0x47a028):
//   the two effects 0x81740000 / 0x81740400 (a0093, menu_fx.js) from the box's start, at 500 ms layout 0x479190 with widget 4 =
//   'Sea of Flames' (DAT_0047a340[stat 0xe], FUN_003fd578), closed at 4000 ms; the event waits on isDisplayStageInfo(0) (pc 1428)
//   and fades in only after it. T: GS dump tools/trace/out/w265/k0 (start1704 + f101: the card with its text and graphics); the card's
//   length from the call-log trace w265_card (tools/trace/out/w0265fix, gitignored: SKIPPED without it).
//   node native/web/test_title_card_page.mjs   (needs playwright, data/stage_info.json + results.json/.fed, data/event/*)
//   TITLE_SHOT=<png> saves the card.
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
for (const f of ['data/stage_info.json', 'data/results.json', 'data/pause.json', 'data/event/ev0100_stage.json', 'data/event/ev0100_scr001.json'])
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
  const errs = [];
  const warns = [];
  pg.on('console', m => { if (m.type() === 'error') errs.push(m.text()); else if (m.type() === 'warning' && /menu fx|stage info|effects/.test(m.text())) warns.push(m.text()); });
  pg.on('pageerror', e => errs.push(e.message));
  for (let i = 0; ; i++) {
    try { await pg.goto(`http://127.0.0.1:${port}/play.html?video=pal&hud=0`, { waitUntil: 'load' }); break; }
    catch (e) { if (i > 20) throw e; await new Promise(r => setTimeout(r, 250)); }
  }
  const until = (fn, arg, t = 180000) => pg.waitForFunction(fn, arg, { timeout: t, polling: 50 });
  await until(() => window.__play && window.__play.intro && window.__play.intro.rt);
  // the card opens from the opening's native (event_rt.js) on stage_info.js
  await until(() => window.__play.intro.rt.log.some(([, m]) => m === 'stageinfo 0'));
  const a = await pg.evaluate(() => { const P = window.__play, si = P.stageInfo; return { si: !!si, kind: si ? si.kind : null, D: !!(si && si.D) }; });
  ok(a.si && a.kind === 0, `displayStageInfo(0) from first_event: stage-info kind 0 (si ${a.si}, kind ${a.kind}, data ${a.D})`);
  // the card's close frame (the event's frame counter when stage_info's kind goes back to -1), watched from here on
  await pg.evaluate(() => { const P = window.__play; window.__w265close = null;
    const w = () => { if (P.stageInfo.kind < 0) { window.__w265close = P.intro.rt.frameNo; return; } requestAnimationFrame(w); }; w(); });
  await until(() => { const si = window.__play.stageInfo; return si && si.box && si.box.screen && si.box.screen !== 'nodraw'; });
  const b = await pg.evaluate(() => {
    const P = window.__play, si = P.stageInfo, w = si.box.screen.byId(4);
    const em = si.fx ? si.fx.title.fx.emitters.length : null;
    return { kind: si.box.kind, str: w && w.str ? String.fromCharCode(...w.str) : null, em, fade: P.intro.rt.fade ? P.intro.rt.fade.level : null,
             ids: si.box.fx.filter(s => s.h !== -1).map(s => (s.id >>> 0).toString(16)) };
  });
  ok(b.kind === 0x1e, `box kind 0x1e (DAT_004a8250[0]): 0x${(b.kind >>> 0).toString(16)}`);
  ok(b.str === 'Sea of Flames', `widget 4's text: ${JSON.stringify(b.str)}`);
  ok(b.ids.join() === '81740000,81740400', `effect slots 0 / 2: ${b.ids.join()} (steps 1 / 2 of 0x47a028)`);
  ok(b.em > 0, `the card's effects spawned on the menu managers: ${b.em} emitters`);
  if (warns.length) console.log('  warnings: ' + [...new Set(warns)].slice(0, 12).join('\n            '));
  ok(b.fade === 256, `the opening is still black behind the card (fade level ${b.fade})`);
  // the game's f101 dump is the card about 1.5 s in (fully up, text faded in)
  await until(() => { const si = window.__play.stageInfo; return si.box && si.now - si.box.start >= 1500; });
  const sp = await pg.evaluate(() => { const si = window.__play.stageInfo; const S = si.fx.title.sprites(); return { n: S.length, em: si.fx.title.fx.emitters.length, vis: si.fxLayer.group.visible, kids: si.fxLayer.group.children.length }; });
  ok(sp.n > 0 && sp.em === 2, `the card's effects draw sprites at 1500 ms: ${sp.n} (2 emitters)`);
  // the effects are drawn over the opening's black (the veil drawn before the menu managers, menu_fx.js): the game's f101 has the
  // circuit border along the top of the 4:3 picture (copper, about 0.04 of its height); the page's top band must not be black
  const shot = process.env.TITLE_SHOT || path.join(process.env.TMPDIR || '/tmp', 'w265_title_' + process.pid + '.png');
  await pg.screenshot({ path: shot });
  const lit = Number(execSync(`python3 -I -c "from PIL import Image; im=Image.open('${shot}').convert('RGB'); w,h=im.size; x0=(w-h*4//3)//2; px=[im.getpixel((x,y)) for x in range(x0+20,x0+h*4//3-20,4) for y in range(2,int(h*0.07),2)]; print(sum(1 for p in px if p[0]>60)/len(px))"`, { encoding: 'utf8' }).trim());
  if (!process.env.TITLE_SHOT) fs.unlinkSync(shot);
  ok(lit > 0.02, `the card's top border is drawn over the black (lit share ${lit.toFixed(3)})`);
  // the event waits on isDisplayStageInfo(0) (pc 1428) and fades in only after the card is gone
  await until(() => window.__play.intro.rt.log.some(([, m]) => /^fadein /.test(m)));
  const c = await pg.evaluate(() => { const P = window.__play, L = P.intro.rt.log; return { kind: P.stageInfo.kind, at: L.find(([, m]) => m === 'stageinfo 0')[0], fin: L.find(([, m]) => /^fadein /.test(m))[0], close: window.__w265close }; });
  ok(c.kind === -1, `the card is closed when the opening fades in (kind ${c.kind})`);
  // T w265_card (worker 0265, 2026-11-09; start1704 state, no input; call log set w265card): displayStageInfo FUN_00380788 ->
  // FUN_003fdb48 at f27, the card's close FUN_003fdf00 -> FUN_003fdd58 at f235 (208 frames: 8 read + 4000 ms), the fadein at f351.
  // The 116 frames between the close and the fadein are first_event's wait(h) at pc 1436 on Actor.load("e048")'s handle (pc
  // 1400 / 1403), the last of the disc loads started after displayStageInfo (Zone.load, actors, motions, voices, effect file
  // 288..294 / 1): the game's disc time. The page's loads finish at once (GUESS row 'the page's loads are at once'), so its
  // fade-in follows the close; that difference is reported, not failed.
  // without the trace too: the card's own close step from the game's table 0x47a028 (data/stage_info.json scripts['30']; op -2 =
  // FUN_003c6600 case 0x1b, FUN_003b7830: the box closes) at its time (ms from the box's start). The card can't close before it, and
  // no later than its open delay after it: 10 frames from displayStageInfo to the open (w220_box: frame 216 -> 226,
  // notes/fidelity-audit.md 'Stage-info file read') + the close's frame
  {
    const sj = JSON.parse(fs.readFileSync(path.join(here, 'data/stage_info.json'), 'utf8'));
    const st = (sj.scripts['30'] || []).find(r => r[2] === -2), closeMs = st ? st[0] : null;
    const pms = (c.close - c.at) * 20;
    ok(closeMs != null && c.close != null && pms >= closeMs && pms <= closeMs + 11 * 20,
      `the card closes ${pms} ms after displayStageInfo(0): the close step (0x47a028, case 0x1b) at ${closeMs} ms + the open's 10 frames + 1`);
  }
  const T = path.join(here, '../../tools/trace/out/w0265fix/w265_card.calls.jsonl');
  if (!fs.existsSync(T)) console.log('SKIPPED: the card length vs the game (no ' + path.relative(here, T) + ': gitignored trace; tools/trace/scripts/w265_card.json)');
  else {
    const H = fs.readFileSync(T, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(e => e.hook);
    const g = n => H.find(e => e.hook === n), gd = g('si_display').frame, gc = g('si_close').frame, gf = g('ev_fadein').frame;
    // in the game's own clock (FUN_0023c1f0, real ms): v0 of the display hook = DAT_0047db84 (FUN_003fdb48's last call); the frame
    // log's ev_clock at the close's record (the same run's frame log, w265_card.jsonl). The page counts FRAME_MS = 20 a frame
    // (GUESS row 'stage-info clock'); the game's frames there run 8..39 ms, so its close lands on the first frame past the box's
    // 4000 ms: allowed 2 page frames (40 ms)
    const F = new Map(fs.readFileSync(T.replace('.calls.jsonl', '.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
      .filter(r => r.frame != null).map(r => [r.frame, Buffer.from(r.ev_clock.slice(0, 8), 'hex').readUInt32LE(0)]));
    const gms = F.get(gc) - g('si_display').v0, pms = (c.close - c.at) * 20;
    ok(c.close != null && Math.abs(pms - gms) <= 40, `the card closes ${pms} ms (${c.close - c.at} frames) after displayStageInfo(0) (game: ${gms} ms, f${gd} -> f${gc}, ${gc - gd} frames)`);
    console.log(`KNOWN DIFF: the fade-in ${c.fin - c.at} frames after displayStageInfo(0), the game's ${gf - gd} (f${gd} -> f${gf}): the game's disc loads (wait at pc 1436) end ${gf - gc} frames after the close; the page's loads take no time`);
  }
  const bad = errs.filter(e => !/favicon|404/.test(e));
  ok(bad.length === 0, 'no page errors' + (bad.length ? ': ' + bad.slice(0, 3).join(' | ') : ''));
} finally {
  await browser.close();
  srv.kill();
}
done();
