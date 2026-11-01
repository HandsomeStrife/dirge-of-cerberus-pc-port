// test_audio3d.mjs -- audio.js emitterVolPan (FUN_003e9220, the EE's 3D volume / pan) against the
// PCSX2 call logs (worker 0172). node native/web/test_audio3d.mjs
// Traces (game-derived, gitignored): tools/trace/out/w172_*.calls.jsonl from TRACE_CALLLOG=sound3
// (tools/trace/README.md, scripts w172_sound3 / w172_hits / w172_melee). SOUND3_TRACES=a,b overrides.
// AUDIO_JS=<path> tests another copy (mutation runs).
// Each new SE is checked: the emitter position from the FUN_0033cc90 -> FUN_003e8e18 call (hook play_name,
// frame f, slot v0), the listener the game had when FUN_003e9ed0 ran on frame f + 1 (hook listener), and the
// pan / volume FUN_003e9220 passed to FUN_003e7810 on that frame (hook se_new, in slot order).
// bsj_063 (FUN_0033d788 -> FUN_0033cbd8) is played at the sound camera's position, i.e. at the listener:
// the zero vector gives pan 0x81 (acos 0 -> 63 after the round toward zero).
import assert from 'assert';
import path from 'path';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const A = await import(pathToFileURL(process.env.AUDIO_JS || path.join(here, 'audio.js')).href);
const out = path.join(here, '../../tools/trace/out');
const files = (process.env.SOUND3_TRACES || 'w172_sound3,w172_hits,w172_melee').split(',')
  .map(n => path.join(out, n + '.calls.jsonl'));
const name = u => Buffer.concat(u.map(x => { const b = Buffer.alloc(4); b.writeUInt32LE(parseInt(x, 16)); return b; }))
  .toString('latin1').split('\0')[0];

let checked = 0, fails = 0;
for (const file of files) {
  if (!existsSync(file)) { console.log('missing', file); fails++; continue; }
  const L = readFileSync(file, 'utf8').trim().split('\n').slice(1).map(l => JSON.parse(l.replace(/\bNaN\b/g, 'null')));   // the logs write NaN for non-float words
  const lis = new Map(), plays = new Map(), sent = new Map();
  for (const e of L) {
    if (e.hook === 'listener') lis.set(e.frame, e);
    if (e.hook === 'play_name') (plays.get(e.frame) || plays.set(e.frame, []).get(e.frame)).push(e);
    if (e.hook === 'se_new') (sent.get(e.frame) || sent.set(e.frame, []).get(e.frame)).push(e);
  }
  let n = 0;
  for (const [fr, ps] of plays) {
    const li = lis.get(fr + 1), news = sent.get(fr + 1) || [];
    if (!li) continue;
    ps.sort((a, b) => a.v0 - b.v0);                 // FUN_003e9ed0 walks the slots in index order
    ps.forEach((p, k) => {
      const nm = name(p['a1+0x0'].u), e = news[k];
      if (!e || p.v0 < 0) return;
      const L3 = {
        pos: li['a0+0x3810'].f, fwd: li['a0+0x3820'].f, alt: li['a0+0x3850'].f,
        useAlt: parseInt(li['a0+0x3890'].u[0], 16) !== 0,
      };
      const got = A.emitterVolPan({ pos: p['a2+0x0'].f, range: 400.0 }, L3);
      const want = { vol: e.a3, pan: e.a2 };
      try { assert.deepStrictEqual(got, want); n++; checked++; } catch (err) {
        fails++; console.log('FAIL', path.basename(file), 'f', fr, nm, 'got', got, 'want', want);
      }
    });
  }
  console.log('ok', path.basename(file), n, 'new SEs');
}

// Synthetic: the flag paths of FUN_003e9220 (no trace needed).
const L0 = { pos: [0, 0, 0], fwd: [0, 0, 1], alt: [0, 0, 0], useAlt: true };
const t = (nm, f) => { try { f(); console.log('ok', nm); } catch (e) { fails++; console.log('FAIL', nm, e.message); } };
t('dead ahead: 128 / pi x acosf(-1) chops to 127.99 -> pan 0x41 (as the game, w172_sound3 f956)', () =>
  assert.deepStrictEqual(A.emitterVolPan({ pos: [0, 0, 100], range: 400 }, { ...L0, alt: [0, 0, 100] }), { vol: 117, pan: 0x41 }));
t('beyond the range: vol 1 (not 0)', () => assert.strictEqual(A.emitterVolPan({ pos: [0, 0, 900] }, L0).vol, 1));
t('negative range: vol 0', () => assert.strictEqual(A.emitterVolPan({ pos: [0, 0, 9], range: -1 }, L0).vol, 0));
t('at the listener: zero vector -> pan 0x81 (the game\'s bsj_063)', () =>
  assert.strictEqual(A.emitterVolPan({ pos: [0, 0, 0] }, L0).pan, 0x81));
t('left / right / behind sit on the other quadrants', () => {
  assert.ok(Math.abs(A.emitterVolPan({ pos: [100, 0, 1] }, L0).pan - 0x80) <= 1);
  assert.ok(A.emitterVolPan({ pos: [-100, 0, 1] }, L0).pan <= 1);
  assert.ok(Math.abs(A.emitterVolPan({ pos: [1, 0, -100] }, L0).pan - 0xc0) <= 1);
});
t('flags: fixed volume, half, no position, no 3D', () => {
  const F = A.SLOT_FLAGS;
  assert.strictEqual(A.emitterVolPan({ pos: [0, 0, 300], flags: F.FIXED | (0x55 << 7) }, L0).vol, 0x55);
  assert.strictEqual(A.emitterVolPan({ pos: [0, 0, 0], flags: F.HALF }, L0).vol, 58);
  assert.strictEqual(A.emitterVolPan({ pos: [100, 0, 0], flags: F.NOPOS }, L0).pan, 0x40);
  assert.deepStrictEqual(A.emitterVolPan({ pos: [100, 0, 300], flags: F.NO3D }, L0), { vol: 0x7f, pan: 0x40 });
});
t('volume from the camera when +0x3890 is clear', () =>
  assert.strictEqual(A.emitterVolPan({ pos: [0, 0, 200] }, { ...L0, alt: [0, 0, 200], useAlt: false }).vol, 58));

console.log(fails ? `FAILED ${fails}` : `all ok (${checked} traced SEs)`);
process.exit(fails ? 1 : 0);
