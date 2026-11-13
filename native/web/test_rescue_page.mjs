// test_rescue_page.mjs -- the beast alley's rescue (worker 0292; Dan's "save the abducted girl"), played on from the abduction
// (test_kidnap_page.mjs's start and walk: route state r04_east, beast_ev01, trigger 163's 'kidnap'). Then as a player: to the fence
// at trigger 165 (-1010.5, 434.1; script 219), ✕ once routine 216/1's step 7 has set short 69 = 1, the child (record 112) to locator
// 19 at the timer's end, back toward trigger 166 (the child's event 0x18: manager cmd 0xab sees manager +0x260 = trigger 166's centre
// -> short 72 = 1 -> trigger 166's event 0x18 wakes e_BestB2 (record 9)), shoot it, trigger 177's poll (script 234) -> stage flag 1 = 11
// -> beast_ev02 (the mother and the child).
// T (PCSX2, tools/trace/out/w292, gitignored; scripts/w292_*.json): w292_x165 from 0276's w276_at165 state with Vincent poked into the
// box (documented in the script's doc), ✕ f20: 76 = 0 next record, 74 = 2 and the child at locator 19 (-1021.3, -3.1, 427.9) 160
// frames on; w292_back: 72 = 1 (f79), record 9 active 3 records later (f82); w292_fight: 9 dies (stbf0) f67, flag 1 = 11 f206 (+139,
// the 320-tick poll's phase), the event from f208.
//   node native/web/test_rescue_page.mjs   (playwright + data; network for the three.js CDN; sandbox off)
// MUTATE=noab (manager cmd 0xab always false) / nocross (script 219 event 0x11 not run on ✕) / nodmg (FUN_0055db50's damage always 0) /
// sleep (the event's sleep twice as long): each must fail.
// Worker 0294: 0292's 'record 9 takes no damage' was this test's aim, not the game's damage path. Once the beast was at Vincent's side
// the old aim loop sent the camera into the sky and every shot missed until the ammo was gone. Record 9 has no gate bits: script 216
// (the kidnap) sets +0x118 bits 3, 4, 2, 6, 5, 13 on record 8 (e_BeastB, the same script 217 and spot), and trigger 166's wake (script
// 220 event 0x18) clears them on record 8 only when manager 0xa6 (FUN_00242c28() == 2) is true; in the save (1) it wakes the fresh
// record 9 and clears them there (a no-op: they were never set).
// PAGE AIDS (test only): the warp entry (as test_kidnap_page); Vincent's HP set to 9999 at the start (the trace runs poke it the same
// way: route.py --hp); the camera turned toward where he walks (FollowCamera.reset) and, for the shots, toward the beast; after the
// beast-7 fight he is put back at the fence spot (navigation only, see there).
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
let chromium;
try { ({ chromium } = createRequire(path.join(execSync('npm root -g', { encoding: 'utf8' }).trim(), '/'))('playwright')); }
catch { console.log('SKIP: playwright not installed (npm i -g playwright)'); done(); }
const port = await new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const srv = spawn('python3', ['-I', '-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', here], { stdio: 'ignore' });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });

// route state r04_east (walked, worker 0217), as test_kidnap_page
const WARP = `kidnap: { pos: [-727.75, -0.06, -36.93], face: [0, 1], pair: [4, 5], whole: true, stage: { 0: 4, 1: 7, 2: 4, 15: 1, 43: 1, 44: 1, 45: 1, 46: 1, 47: 1, 63: 1 }, global: { 0: 1, 1: 7, 55: 4, 56: 7, 58: 1 }, note: 'route state r04_east (test)' },`;
const PATH = [[-660, 30], [-594, 95], [-573, 129], [-585, 166], [-619, 200], [-652, 234], [-719, 303], [-787, 370], [-823, 369], [-852, 390], [-877, 415], [-940, 430], [-1000, 438]];
const T165 = [-1010.512451, 434.11908], X165 = [0.872458, 0.488688];      // trigger 165's centre and its local x row (m[0])
const MUT = process.env.MUTATE;

const pg = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
pg.on('crash', () => errs.push('the renderer crashed'));
await pg.route('**/warp.js', async r => { const t = fs.readFileSync(path.join(here, 'warp.js'), 'utf8'); await r.fulfill({ contentType: 'text/javascript', body: t.replace('export const WARPS = {', 'export const WARPS = { ' + WARP) }); });
const SUB = { nodmg: ['if (a.f118 & 0x60) dmg = 0;', 'dmg = 0;'], sleep: ['stage_controller.js', '(u !== 0 && ((R.clock - t0) >>> 0) >= u)', '(u !== 0 && ((R.clock - t0) >>> 0) >= u * 2)'], noab: ['if (cmd === 0xab) {', 'if (cmd === 0xab) { return 0;'], nocross: ['function gimmickUse(c) { runEvent(c.o, 0x11, [c.face, 0]); }', 'function gimmickUse(c) { }'] }[MUT];
if (SUB) { const [file, from, to] = SUB.length === 3 ? SUB : ['enemy_ai.js', ...SUB];
  if (!fs.readFileSync(path.join(here, file), 'utf8').includes(from)) throw new Error('mutant does not apply');
  await pg.route('**/' + file, async r => { const t = fs.readFileSync(path.join(here, file), 'utf8'); await r.fulfill({ contentType: 'text/javascript', body: t.replace(from, to) }); }); }
const tickOf = () => pg.evaluate(() => window.__play.stats.ticks);
const waitTicks = (fn, arg, ms = 120000) => pg.waitForFunction(fn, arg, { timeout: ms, polling: 50 });
try {
  for (let i = 0; ; i++) { try { await pg.goto(`http://127.0.0.1:${port}/play.html?video=pal&intro=0&sound=0&enemydmg=0&warp=kidnap`, { waitUntil: 'load' }); break; } catch (e) { if (i > 20) throw e; await new Promise(r => setTimeout(r, 250)); } }
  await pg.waitForFunction(() => window.__play && window.__play.warp && window.__play.stats.ticks > window.__play.warp.tick + 60, null, { timeout: 240000 });
  // every tick: the shorts 69-76, stage flags 0 / 1, script events of 165 / 166 / 177 / 219 / 234, records 9 / 112, the stage's event
  await pg.evaluate(() => { const P = window.__play, A = P.enemyAI, t0 = A.tick, L = window.__r = { rows: [], ev: [], last: '', names: [] };
    P.php.hp = 9999;
    A.tick = (...a) => { const r = t0(...a), n = P.stats.ticks, st = P.stage;
      for (const e of A.events) { if (L.p166 == null && /^event t166 script 220 ev 24 /.test(e)) L.p166 = n; if (/script 153 ev 24 /.test(e)) L.n153 = (L.n153 || 0) + 1; if (/script (21[69]|220|234|217|153) /.test(e) && !/script (153|220) ev 24 /.test(e)) L.ev.push([n, e]);
        if (/^(hit|near miss|f38|player shot) /.test(e)) { const x = A.actors.find(q => q.rec === 9); (L.hits = L.hits || []).push([n, e, x ? { f118: x.f118, s64: x.s64, f28: x.flags28, z: x.f19c, f38: x.f38 } : null]); } }
      const row = { n, sh: Array.from(A.mshort.slice(69, 77)), f0: A.eventFlags[0], f1: A.eventFlags[1] };
      for (const x of A.actors) if (x.rec === 7 || x.rec === 9 || x.rec === 112) row[x.rec] = { p: x.pos.slice(), on: !!x.active, hp: x.hp, clip: x.C.mp ? x.C.mp.clip : '' };
      row.v = [P.ctrl.pos.x, P.ctrl.pos.y, P.ctrl.pos.z]; row.ev = !!(st && st.rt.running && !st.rt.battle);
      // the event's fades (event_rt fade: FUN_003a22e0 / FUN_003a2420) by tick; the log is trimmed now and then, so walk back to the last one seen
      if (st) { const lg = st.rt.log, add = []; for (let i = lg.length - 1; i >= 0 && lg[i] !== L.lastLog; i--) add.push(lg[i]); if (lg.length) L.lastLog = lg[lg.length - 1];
        for (const x of add.reverse()) if (/^fade(in|out) \d+$/.test(x[1])) (L.fades = L.fades || []).push([n, x[1]]); }
      if (row.ev) { const w = st.rt.vm.where().split(' ')[0]; if (!L.names.includes(w)) L.names.push(w); }
      const k = JSON.stringify([row.sh, row.f0, row.f1, row.ev, row[9] && row[9].on, row[9] && row[9].clip, row[112] && row[112].clip, row[7] && row[7].on, row[7] && row[7].clip]);
      if (k !== L.last) { L.rows.push(row); L.last = k; }
      return r; }; });
  const go = async (tx, tz, tol = 8, maxMs = 60000) => { const t0 = Date.now(); await pg.keyboard.down('KeyW');
    while (Date.now() - t0 < maxMs) {
      const s = await pg.evaluate(([tx, tz]) => { const P = window.__play, c = P.ctrl.pos, dx = tx - c.x, dz = tz - c.z, R = P.stage.rt;
        if (R.battle) P.follow.reset(c, { yaw: Math.atan2(dx, dz), pitch: P.follow.pitch }); return { d: Math.hypot(dx, dz), battle: R.battle }; }, [tx, tz]);
      if (s.d < tol) break;
      if (!s.battle) { await pg.keyboard.up('KeyW'); await pg.waitForTimeout(500); await pg.keyboard.down('KeyW'); }
      await pg.waitForTimeout(100); }
    await pg.keyboard.up('KeyW'); return pg.evaluate(() => { const c = window.__play.ctrl.pos; return [c.x, c.z]; }); };
  const pitch0 = await pg.evaluate(() => window.__play.follow.pitch);     // the follow camera's own pitch, before the test turns it
  for (const [x, z] of PATH) await go(x, z);
  console.log('at the fence', JSON.stringify(await pg.evaluate(() => { const P = window.__play; return { v: [P.ctrl.pos.x, P.ctrl.pos.z], sh: Array.from(P.enemyAI.mshort.slice(69, 77)), t: P.stats.ticks }; })));
  // wait for routine 216/1's step 7 (short 69 = 1, trigger 165 takes ✕)
  await waitTicks(() => window.__play.enemyAI.mshort[69] === 1, null, 180000);
  // face the fence: walk at the box along its local -x until stopped or in reach, then ✕ (a ray of 7 along the facing, FUN_005513c8)
  await pg.evaluate(([T, X]) => { const P = window.__play; P.follow.reset(P.ctrl.pos, { yaw: Math.atan2(-X[0], -X[1]), pitch: P.follow.pitch }); }, [T165, X165]);
  await pg.keyboard.down('KeyW'); await pg.waitForTimeout(1200); await pg.keyboard.up('KeyW'); await pg.waitForTimeout(300);
  const tx = await tickOf();
  await pg.keyboard.down('Space'); await pg.waitForTimeout(80); await pg.keyboard.up('Space');
  console.log('✕ at', tx, JSON.stringify(await pg.evaluate(([T, X]) => { const P = window.__play, c = P.ctrl.pos; return { v: [c.x, c.z], lx: (c.x - T[0]) * X[0] + (c.z - T[1]) * X[1], head: P.ctrl.heading }; }, [T165, X165])));
  // routine 219/2 gives trigger 166 its period (0x113(2)) at its last step: wait for script 220's event 0x18, as a player watching
  // shoot record k as a player: the camera at its body, the button in bursts, until it is dead or gone
  // shoot record k as a player (test_enemies_page's aim): the gun drawn (R1), the camera turned until the aim ray (P.aim.core eye ->
  // hit) points at its body, R1 per shot, until it is dead or gone
  const shoot = (k, maxMs = 180000) => pg.evaluate(async ([k, maxMs, pitch0]) => {
    const P = window.__play, wait = ms => new Promise(r => setTimeout(r, ms)), t0 = performance.now();
    const act = () => P.enemyAI.actors.find(x => x.rec === k);
    const dirTo = (a, b) => { const v = [0, 1, 2].map(i => b[i] - a[i]); const l = Math.hypot(...v); return v.map(x => x / l); };
    const ang = v => [Math.atan2(v[0], v[2]), Math.asin(v[1])];
    const err = tgt => { const c = P.aim.core, e = [c.eye.x, c.eye.y, c.eye.z], h = [c.hit.x, c.hit.y, c.hit.z]; const w = ang(dirTo(e, tgt)), g = ang(dirTo(e, h));
      let dy = w[0] - g[0]; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); return [dy, w[1] - g[1]]; };
    let shots = 0, sg = null, a = act();
    while (a && a.hp > 0 && performance.now() - t0 < maxMs) {
      if (!P.stage.rt.battle) { await wait(200); a = act(); continue; }
      if (!P.aim.state().drawn) { P.aim.press('r1'); await wait(800); }
      const tgt = [a.pos[0], a.pos[1] - 8, a.pos[2]];
      // worker 0294: face the body first (the view step's yaw convention, the follow camera's own pitch), then small corrections.
      // Stepping by the whole error from wherever the camera was sent it into the sky once the beast was at his side (every shot
      // missed until the ammo was gone: 0292's 'HP 110 after 209 shots')
      { const c = P.ctrl.pos; P.follow.reset(c, { yaw: Math.atan2(tgt[0] - c.x, tgt[2] - c.z), pitch: pitch0 }); await wait(80); }
      if (!sg) { const e0 = err(tgt); P.follow.yaw += 0.02; await wait(120); const sy = Math.sign(e0[0] - err(tgt)[0]) || 1;
                 const e1 = err(tgt); P.follow.pitch += 0.02; await wait(120); sg = [sy, Math.sign(e1[1] - err(tgt)[1]) || 1]; }
      for (let i = 0; i < 6; i++) { const [dy, dp] = err(tgt), cl = x => Math.max(-0.1, Math.min(0.1, x)); if (Math.abs(dy) < 0.02 && Math.abs(dp) < 0.02) break; P.follow.yaw += sg[0] * cl(dy); P.follow.pitch += sg[1] * cl(dp); await wait(80); }
      if (shots < 6 || shots % 20 === 0) { const c = P.aim.core, v = P.ctrl.pos; (window.__r.aim = window.__r.aim || []).push({ k, shots, a: a.pos.map(x => +x.toFixed(1)), v: [v.x, v.y, v.z].map(x => +x.toFixed(1)),
        eye: [c.eye.x, c.eye.y, c.eye.z].map(x => +x.toFixed(1)), hit: [c.hit.x, c.hit.y, c.hit.z].map(x => +x.toFixed(1)), err: err(tgt).map(x => +x.toFixed(3)), st: P.aim.state().st, clip: a.C.mp && a.C.mp.clip }); }
      P.aim.press('r1'); shots++; await wait(250); a = act();
    }
    if (P.aim.state().drawn) { P.aim.press('circle'); await wait(800); }        // the gun away (Circle) before he walks on
    const st = P.aim.state();
    return a ? { hp: a.hp, shots, ammo: st.ammo, st: st.st } : { gone: true, shots };
  }, [k, maxMs, pitch0]);
  // e_Beast (record 7) runs at him here (T w276_rescue f60-250 too): a player shoots it
  console.log('beast 7', JSON.stringify(await shoot(7)));
  // routine 219/2 gives trigger 166 its period (0x113(2)) at its last step: wait for script 220's event 0x18
  await waitTicks(() => window.__r.p166 != null, null, 240000);
  console.log('166 period at', await tickOf());
  // back toward trigger 166's centre (the point manager +0x260 holds), camera ahead
  // PAGE AID (navigation only): the beast fight leaves him wherever its knock-backs put him, and from there the test's straight-line walk
  // stalls (the runs of this test: parked at (-1010.9, 452.5) for 90 s); he is put back at the fence spot he walked to before
  console.log('after the fight', JSON.stringify(await pg.evaluate(() => { const P = window.__play, c = P.ctrl; return { v: [c.pos.x, c.pos.z], st: c.P && c.P.state, anim: P.anim && P.anim.clip, aim: P.aim.state().drawn }; })));
  await pg.evaluate(() => { const c = window.__play.ctrl; c.pos = { x: -1000.0, y: -0.06, z: 433.4 }; c.locate(); c.prev = { ...c.pos }; if (c.onTeleport) c.onTeleport(); });
  // the camera turned toward trigger 166's centre (manager +0x260, T RAM (-989.7, -0.2, 443.7)) while he stands in the trigger (short 71),
  // as the game run's camera did (T w292_back: 72 = 1 at f79 with Vincent near (-1007, 433))
  // (a player turns the view about until the point shows: yaw offsets so that his own body is not on the line to it)
  // (worker 0294: a finer sweep and a second pitch; with 0.35 steps one run in two found no view: the ray to the point passes his body)
  view: for (const dp of [0, 0.15]) for (const off of [0, 0.2, -0.2, 0.35, -0.35, 0.5, -0.5, 0.7, -0.7, 0.9, -0.9]) {
    await pg.evaluate(([off, p]) => { const P = window.__play, c = P.ctrl.pos; P.follow.reset(c, { yaw: Math.atan2(-989.73 - c.x, 443.68 - c.z) + off, pitch: p }); }, [off, pitch0 + dp]);
    const got = await waitTicks(() => window.__play.enemyAI.mshort[72] === 1, null, 2500).then(() => true, () => false);
    console.log('view', off, dp, JSON.stringify(await pg.evaluate(() => { const A = window.__play.enemyAI; return { m260: A.mgr260 && A.mgr260.map(v => +v.toFixed(2)), s71: A.mshort[71], s72: A.mshort[72], n153: window.__r.n153 }; })));
    if (got) break view;
  }
  await waitTicks(() => { const a = window.__play.enemyAI.actors.find(x => x.rec === 9); return a && a.hp > 0; }, null, 60000).catch(() => {});
  console.log('beast 9', JSON.stringify(await shoot(9)));
  await waitTicks(() => window.__play.enemyAI.eventFlags[1] === 11, null, 120000).catch(() => {});
  // beast_ev02 to its end (the game: 833 frames), then battle again
  await waitTicks(() => { const r = window.__r.rows, i = r.findIndex(x => x.f1 === 11); return i >= 0 && r.slice(i).some(x => x.ev) && !r[r.length - 1].ev; }, null, 600000).catch(() => {});
  await pg.waitForTimeout(500);
  const r = await pg.evaluate(() => window.__r), R = r.rows, first = (fn, from = 0) => R.find(x => x.n >= from && fn(x));
  if (process.env.RESCUE_LOG) for (const x of R) console.log(JSON.stringify(x));
  if (process.env.RESCUE_LOG) for (const x of r.hits || []) console.log('hit', JSON.stringify(x));
  if (process.env.RESCUE_LOG) for (const x of r.aim || []) console.log('aim', JSON.stringify(x));
  // ✕ (script 219 event 0x11: short 76 = 0) on the next tick; event 1 (timer 160: 74 = 2) 159 ticks after it (T w292_x165: records 21 -> 180)
  const x76 = first(x => x.sh[7] === 0, tx), x74 = first(x => x.sh[5] === 2, tx);
  ok(x76 && x76.n - tx <= 2, '✕ at trigger 165 runs script 219 event 0x11 (short 76 = 0)', x76 ? `+${x76.n - tx} ticks` : 'never');
  ok(x76 && x74 && Math.abs((x74.n - x76.n) - 159) <= 1, "its timer's event 1 159 ticks later (short 74 = 2; T 159)", x76 && x74 ? `${x74.n - x76.n}` : 'never');
  // the child: on her kidnap root (~0) until then (FUN_00340c00), at locator 19 in 'fear' after (T w292_x165 f200: (-1021.3, -3.1, 427.9))
  const before = R.filter(x => x[112] && x.n < (x74 ? x74.n : Infinity) && x.n > tx - 200).map(x => Math.hypot(...x[112].p)), at19 = x74 && first(x => x[112] && x[112].clip === 'fear', x74.n);
  ok(before.length && Math.max(...before) < 0.01, "n_Child at her clip's root before the rescue (game C+0x30 ~0)", before.length ? `largest ${Math.max(...before).toFixed(4)}` : 'no sample');
  ok(at19 && Math.hypot(at19[112].p[0] + 1021.336, at19[112].p[1] + 3.135, at19[112].p[2] - 427.918) < 0.01, "n_Child at locator 19 playing 'fear' after event 1", at19 ? JSON.stringify(at19[112].p) : 'never');
  // trigger 166: Vincent in it (71) and the child seen (72, manager cmd 0xab) wake e_BestB2 (T w292_back: 72 at record 79, record 9 active at 82)
  const s72 = first(x => x.sh[2] === 1 && x.sh[3] === 1, r.p166 ?? Infinity), on9 = first(x => x[9] && x[9].hp > 0, r.p166 ?? Infinity);
  ok(s72 && on9 && on9.n - s72.n >= 0 && on9.n - s72.n <= 4, 'shorts 71 and 72 wake e_BestB2 (record 9) through trigger 166 (T: 3 frames)', s72 && on9 ? `+${on9.n - s72.n}` : `72 ${!!s72}, 9 ${!!on9}`);
  // its death: trigger 177's poll (script 234, 320 ticks) -> stage flag 1 = 11 (T w292_fight: death record 67, flag record 206)
  const dead9 = first(x => x[9] && x[9].hp <= 0), f11 = first(x => x.f1 === 11);
  ok(dead9 && f11 && f11.n > dead9.n && f11.n - dead9.n <= 330, "record 9's death -> stage flag 1 = 11 within one 320-tick poll (T +139)", dead9 && f11 ? `+${f11.n - dead9.n}` : `dead ${!!dead9}, flag ${!!f11}`);
  // beast_ev02 (the mother and the child): played, back to battle with Vincent at the event's place (T w292_ev02: (-940.0, -0.1, 525.0),
  // short 69 = 0, 833 frames from flag 1 = 11 + 2)
  const evOn = f11 && first(x => x.ev, f11.n), evOff = evOn && first(x => !x.ev, evOn.n);
  ok(r.names.includes('ev0143.beast_ev02'), 'stage flag 1 = 11 plays ev0143.beast_ev02', r.names.join(', '));
  ok(evOff && Math.hypot(evOff.v[0] + 940.0, evOff.v[2] - 525.0) < 2 && evOff.sh[0] === 0, 'after beast_ev02: battle, Vincent at (-940, 525), short 69 = 0', evOff ? `(${evOff.v[0].toFixed(1)}, ${evOff.v[2].toFixed(1)}), 69 = ${evOff.sh[0]}` : 'not ended');
  // its length on the event's own clock: fadein(1000) -> fadeout(3000) (T w292_fight: event +0x1558 bit 43, a fade running, from f491 (50
  // frames: 1000 ms) and from f676 (151 frames: 3000 ms): 185 frames). The whole event (T 806 frames from bit 37 off at f235 to battle at
  // fight f1041; 833 from the flag) is not compared: 256 frames of it before the fadein and 354 after the fadeout (page script: 3 and 102)
  // are the game's disc loads (the event's models / motions / voices, and the chunks back at its zone 128,4,5), which the page's own
  // loads replace (worker 0294). One-sided (worker 0298): the known block-start drift (notes/story-cutscenes.md 'Block starts drift',
  // open) only ever makes the page's blocks start EARLIER than the game's, so the page may be short (by at most 11: 6%; 175 seen, an
  // open 10-frame gap, fidelity-audit 'Event loads complete at once'), never long: a longer span is a different error.
  const fd = (r.fades || []).filter(x => evOn && x[0] >= evOn.n && (!evOff || x[0] <= evOff.n)), fin = fd.find(x => x[1] === 'fadein 1000'), fout = fin && fd.find(x => x[1] === 'fadeout 3000' && x[0] > fin[0]);
  ok(fin && fout && fout[0] - fin[0] <= 185 && 185 - (fout[0] - fin[0]) <= 11, "beast_ev02's fadein -> fadeout no longer than the game's, at most 11 short (T 185 frames; block-start drift)", fin && fout ? `${fout[0] - fin[0]} ticks; whole event ${evOff ? evOff.n - evOn.n : '?'} (T 806 with disc loads), starts +${evOn.n - f11.n} (T +29)` : JSON.stringify(fd));
  ok(!errs.length, 'no page errors', errs.slice(0, 3).join(' | '));
} catch (e) {
  ok(false, 'exception', e.message.split('\n')[0] + (errs.length ? '; ' + errs.slice(0, 3).join(' | ') : ''));
}
await browser.close(); srv.kill();
done();
