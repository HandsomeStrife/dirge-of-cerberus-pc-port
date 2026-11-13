// Vincent's hit voice on the real page (worker 0197; notes/audio-research.md "Vincent's hit voice"), in a headless
// browser with the default options. A soldier (record 69, woken with his damage event 8 as in test_enemies_page
// step 8) fires at Vincent 80 u away and his bullets hit (bullet damage is on by default). For every hit:
//   - the 15-frame gate FUN_003412d0 (C+0x810): a hit more than 14 frames after the last gated one runs cue 0x4c,
//     which reaches event 0x25 of his script (FUN_00341330 '?' -> FUN_00568f98 fallback -> script 297); the test
//     works the gate out from the hit frames itself, so a broken cue / gate / fallback shows as a missing event;
//   - script 297's rand_i(6) gives 0-2 for about 3 in 7 of those: cmd 0x125 (FUN_0054cd70) plays bt_v000-002;
//   - each of those must reach the AudioContext: SoundEmitters.update -> GameAudio.playId -> a buffer source
//     started on the running context, the frame after (FUN_003e9ed0 sends the slot a frame later), with the
//     game's volume (T: w172_sound3 f790 se_new 37003 vol 114 at Vincent's own position: falloff over 400 from
//     the listener at Vincent - 7 y) and a buffer that is not silent.
// Also printed (not graded): how often a hit grunts, and the grunt buffers' level next to the soldier's gun sounds.
//   node native/web/test_hit_voice_page.mjs     (needs data/enemies + data/audio + playwright; else SKIP, exit 0)
// Serves native/web with python3 http.server on a free port. three.js comes from the CDN (play.html importmap).
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

for (const f of ['data/enemies/ai.json', 'data/audio/se_z128.json', 'data/audio/wave0000.bin'])
  if (!existsSync(path.join(here, f))) { console.log(`SKIP: ${f} missing (tools/byo/build_web.sh)`); done(); }
let chromium;
try {
  const g = execSync('npm root -g', { encoding: 'utf8' }).trim();
  ({ chromium } = createRequire(path.join(g, '/'))('playwright'));
} catch { console.log('SKIP: playwright not installed (npm i -g playwright)'); done(); }

const GRUNTS = { 37001: 'bt_v000', 37002: 'bt_v001', 37003: 'bt_v002' };
const port = await new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const srv = spawn('python3', ['-I', '-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', here], { stdio: 'ignore' });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const pg = await browser.newPage({ viewport: { width: 960, height: 540 } });
  const errs = [];
  pg.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  pg.on('pageerror', e => errs.push(e.message));
  for (let i = 0; ; i++) {
    try { await pg.goto(`http://127.0.0.1:${port}/play.html?video=pal&intro=0`, { waitUntil: 'load' }); break; }   // default options
    catch (e) { if (i > 20) throw e; await new Promise(r => setTimeout(r, 250)); }
  }
  await pg.waitForFunction(() => window.__play && window.__play.stats.ticks > 30, null, { timeout: 120000 });
  await pg.mouse.click(480, 270);                          // the gesture that starts the AudioContext (play.js)
  await pg.waitForFunction(() => { const a = window.__play.pauseSound.audio; return a && a.se && a.ctx; }, null, { timeout: 60000 });

  const r = await pg.evaluate(async (GRUNTS) => {
    const P = window.__play, ai = P.enemyAI, au = P.pauseSound.audio, c = P.ctrl;
    const wait = n => new Promise(res => setTimeout(res, n));
    // the AudioContext side: every buffer source started, tagged with the SE id GameAudio.playId is playing
    const started = [];
    let cur = null;
    const playId = au.playId;
    au.playId = function (id, vol, pan, code) { cur = { id, vol, pan }; try { return playId.call(this, id, vol, pan, code); } finally { cur = null; } };
    const start0 = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...a) {
      if (cur && this.context === au.ctx) {
        const b = this.buffer, L = b ? b.getChannelData(0) : [], R = b ? b.getChannelData(1) : [];
        let pk = 0, ss = 0, nz = 0;
        for (let i = 0; i < L.length; i++) { const v = Math.max(Math.abs(L[i]), Math.abs(R[i])); pk = Math.max(pk, v); if (v > 1e-4) { nz++; ss += L[i] * L[i] + R[i] * R[i]; } }
        started.push({ ...cur, frame: ai.S.frame, state: au.ctx.state, peak: pk, rms: Math.sqrt(ss / (2 * Math.max(nz, 1))), dur: nz / b.sampleRate });
      }
      return start0.apply(this, a);
    };
    // the game side, per AI tick (S.frame after the tick = the frame its hits happened on)
    const hits = [], cues = [], plays = [];
    const tick = ai.tick;
    ai.tick = (...x) => {
      const m = ai.S.mgr20;                                 // the manager clock the tick's hits read (mgr +0x20, ticks)
      const ev = tick(...x), f = ai.S.frame;
      for (const e of ev) {
        if (/^hit player /.test(e)) hits.push({ f, m, pos: P.php.pos.slice() });
        else if (/^event -1 script \d+ ev 37 r 76,/.test(e)) cues.push(f);
        else { const m = /^sound (bt_v00[0-2]) range (\S+) at /.exec(e); if (m) plays.push({ f, name: m[1], range: +m[2] }); }
      }
      return ev;
    };
    // record 69 woken (event 8: AI mode 5, he fires from where he stands), Vincent 80 u in front of him
    const rec = await fetch('data/enemies/ai.json').then(x => x.json()).then(a => a.records[69]);
    c.pos = { x: rec.pos[0] + rec.face[0] * 80, y: rec.pos[1], z: rec.pos[2] + rec.face[2] * 80 }; c.prev = { ...c.pos }; c.locate(); if (c.onTeleport) c.onTeleport();
    ai.setActive(ai.objects.get(69 + 22), 1);
    for (let i = 0; i < 300 && !ai.actors.some(a => a.rec === 69); i++) await wait(50);
    const a69 = ai.actors.find(a => a.rec === 69);
    if (!a69) return null;
    ai.runEvent(a69, 8, [10, 0, 0, 0]);
    const t0 = performance.now();
    while (performance.now() - t0 < 90000 && P.php.hp > 0 && (plays.length < 6 || cues.length < 12)) await wait(250);
    await wait(500);                                         // the last slot goes out a frame later
    ai.tick = tick; au.playId = playId; AudioBufferSourceNode.prototype.start = start0;
    // the soldier's gun sounds (ai.json weapon se_fire / se_bullet of record 69's weapon), for the level comparison
    const name = {}; for (const [n, row] of Object.entries(au.se.names)) name[row.id] ??= n;
    const shots = started.filter(s => !GRUNTS[s.id]).map(s => ({ ...s, name: name[s.id] }));
    return { hits, cues, plays, started: started.filter(s => GRUNTS[s.id]), shots, ctx: au.ctx.state, hp: P.php.hp };
  }, GRUNTS);
  ok(!!r, 'record 69 activated and firing');
  if (!r) done();

  // the gate, worked out here from the hits: FUN_003412d0 passes when more than 14 ticks of the manager clock (DAT_0046e880 +0x20,
  // 1.2 ticks a PAL frame: worker 0230) passed since the last gated hit (the save's C+0x810 = 359 against the counter 1575 leaves
  // the first hit open)
  let last = -Infinity;
  const want = [];
  for (const h of r.hits) if (14 < h.m - last) { want.push(h.f); last = h.m; }
  ok(r.hits.length >= 12, `Vincent hit ${r.hits.length} times (HP now ${r.hp})`);
  ok(JSON.stringify(r.cues) === JSON.stringify(want),
     `cue 0x4c through the 15-tick gate reaches script event 0x25 on every gated hit: ${r.cues.length} events at the ${want.length} gated hit frames (${r.cues.slice(0, 6).join(',')}..)`);
  ok(r.plays.length >= 1 && r.plays.every(p => r.cues.includes(p.f) && p.range === 400),
     `script 297 rand_i(6) 0-2 -> cmd 0x125: ${r.plays.length} of ${r.cues.length} gated hits grunt (${r.plays.map(p => p.name.slice(-1)).join('')}), each on a gated hit's frame, range 400 (no r1)`);
  // each grunt reaches the AudioContext: started on the running context the next frame (play.js runs
  // sfx.update before the next AI tick, so S.frame still reads the hit's frame), at the game's volume
  const miss = r.plays.filter(p => !r.started.some(s => GRUNTS[s.id] === p.name && s.frame === p.f));
  ok(r.plays.length >= 1 && miss.length === 0,
     `every grunt starts a buffer source on the AudioContext the frame after its hit: ${r.started.length} started, missing ${miss.map(p => p.name + '@' + p.f).join(' ') || 'none'}`);
  ok(r.started.length >= 1 && r.started.every(s => s.state === 'running'), `the AudioContext was running for every grunt (${[...new Set(r.started.map(s => s.state))]})`);
  ok(r.started.length >= 1 && r.started.every(s => s.vol === 114), `grunt volume ${[...new Set(r.started.map(s => s.vol))]} (game: 114 at Vincent, T w172_sound3 f790)`);
  ok(r.started.length >= 1 && r.started.every(s => s.peak > 0.1 && s.dur > 0.1), `grunt buffers not silent: peak ${Math.min(...r.started.map(s => s.peak)).toFixed(3)}+, ${Math.min(...r.started.map(s => s.dur)).toFixed(3)} s+`);
  ok(errs.length === 0, `no console / page errors${errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''}`);

  // informational: how often a hit grunts, and the level next to the soldier's shot (bsj_004, SE 1005)
  const lv = a => a.length ? `peak ${Math.max(...a.map(s => s.peak)).toFixed(3)}, rms ${(a.reduce((x, s) => x + s.rms, 0) / a.length).toFixed(3)}, ${(a.reduce((x, s) => x + s.dur, 0) / a.length).toFixed(3)} s, vol ${[...new Set(a.map(s => s.vol))].join('/')}` : 'none';
  console.log(`info: ${r.hits.length} hits, ${r.cues.length} through the gate, ${r.plays.length} grunts (${(100 * r.plays.length / r.hits.length).toFixed(0)}% of hits)`);
  console.log(`info: grunts ${lv(r.started)}`);
  for (const n of [...new Set(r.shots.map(s => s.name))]) console.log(`info: ${n} ${lv(r.shots.filter(s => s.name === n))}`);
} finally {
  await browser.close();
  srv.kill();
}
done();
