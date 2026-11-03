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

// ---------------------------------------------------------------------------------------------
// worker 0215: placed sounds (stage section 22) and footsteps (ambient.js) against the call-log set 'ambfoot'
// (TRACE_FIELDSET=ambfoot; scripts w215_ambfoot / w215_routeA / w215_routeB, see their doc strings). AMBIENT_JS=<path>
// tests another copy (mutation runs). Needs data/audio/ambient_z128.json (export_web_ambient.py) and se_z128.json.
{
  const AM = await import(pathToFileURL(process.env.AMBIENT_JS || path.join(here, 'ambient.js')).href);
  const dataP = path.join(here, 'data/audio/ambient_z128.json'), seP = path.join(here, 'data/audio/se_z128.json');
  const ambTraces = (process.env.AMBIENT_TRACES || 'w215_ambfoot,w215_routeA,w215_routeB').split(',');
  if (!existsSync(dataP) || !existsSync(seP)) { console.log('missing', dataP, 'or se_z128.json'); fails++; }
  else {
    const D = JSON.parse(readFileSync(dataP, 'utf8')), SE = JSON.parse(readFileSync(seP, 'utf8'));
    const objs = D.objects.map((o) => ({ o, sp: AM.soundSpace(o), id: (SE.names[o.name] || {}).id }));
    const Lof = (li) => ({ pos: li['a0+0x3810'].f, fwd: li['a0+0x3820'].f, alt: li['a0+0x3850'].f, useAlt: parseInt(li['a0+0x3890'].u[0], 16) !== 0 });
    for (const tn of ambTraces) {
      const rf = path.join(out, tn + '.jsonl'), cf = path.join(out, tn + '.calls.jsonl');
      if (!existsSync(rf) || !existsSync(cf)) { console.log('missing', rf); fails++; continue; }
      const R = readFileSync(rf, 'utf8').trim().split('\n').slice(1).map((l) => JSON.parse(l));
      const Craw = readFileSync(cf, 'utf8').trim().split('\n').map((l) => JSON.parse(l.replace(/\bNaN\b/g, 'null')));
      const meta = Craw[0].meta, C = Craw.slice(1);
      const lo = Math.max(meta.frames[0], R[0].frame + 1), full = C.length >= 1536;            // a full log stops early
      const hi = full ? C[C.length - 1].frame : Math.min(meta.frames[1], R[R.length - 1].frame + 1);
      const rec = new Map(R.map((r) => [r.frame, r])), lis = new Map(C.filter((e) => e.hook === 'listener').map((e) => [e.frame, e]));
      const at = (h) => C.filter((e) => e.hook === h && e.frame >= lo && e.frame < hi);
      // 1. start / stop: FUN_0057dab8 on record f's position + (0, -7, 0) changes on the frame the game starts / stops it
      const want = [...at('bg_start').map((e) => ['start', e.frame, name(e['a0+0x0'].u)]), ...at('bg_stop').map((e) => ['stop', e.frame, e.a0])];
      const got = [];
      const inside = new Map();
      for (const r of R) {
        const L = [r.matrix[3][0], r.matrix[3][1] - 7.0, r.matrix[3][2]];
        for (const x of objs) {
          const i = AM.inside(x.o, x.sp, L), p = inside.get(x);
          // active: no actor, or record 105 (n017, active in these runs: the save's +0x28 bit 0) for object 28
          const on = x.o.actor < 0 || x.o.actor === 105;
          if (on && x.o.area !== 1 && p !== undefined && i !== p && r.frame >= lo && r.frame < hi) got.push([i ? 'start' : 'stop', r.frame, x.o.name]);
          inside.set(x, i);
          (x.inAt ??= new Map()).set(r.frame, on && i);
        }
      }
      const byF = (a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1);
      want.sort(byF); got.sort(byF);
      const ws = want.map((w) => w.slice(0, 2).join(' ')), gs = got.map((g) => g.slice(0, 2).join(' '));
      try { assert.deepStrictEqual(gs, ws); console.log('ok', tn, 'placed sounds start / stop', ws.join(', ') || 'none'); }
      catch (e) { fails++; console.log('FAIL', tn, 'start / stop: got', got, 'want', want); }
      for (const e of at('bg_start')) {
        const x = objs.find((q) => q.o.name === name(e['a0+0x0'].u) && Math.abs(q.sp.centre[0] - e['a1+0x0'].f[0]) < 1e-3);
        if (!x) { fails++; console.log('FAIL', tn, 'bg_start at', e['a1+0x0'].f, 'is no object centre'); continue; }
        const d = Math.max(...x.sp.centre.map((v, k) => Math.abs(v - e['a1+0x0'].f[k])));
        if (d > 1e-3) { fails++; console.log('FAIL', tn, 'centre', x.sp.centre, e['a1+0x0'].f); }
      }
      for (const e of at('bg_open_vol')) {                                        // FUN_003e6d70's FUN_003e8b70 at the start
        const li = lis.get(e.frame), x = objs.find((q) => q.inAt && q.inAt.get(e.frame) && !q.inAt.get(e.frame - 1));
        const v = x && li ? AM.distVolume(AM.soundDistance(x.o, x.sp, Lof(li).alt)) : null;
        if (v !== e.a2) { fails++; console.log('FAIL', tn, 'open volume', e.frame, v, 'want', e.a2); } else console.log('ok', tn, 'open volume', e.frame, v);
      }
      // 1b. the PlacedSounds class over the records (record f's position, this frame's listener): the same starts / stops,
      //     and per frame the same fixed volumes (FUN_003e6ec8 before the objects). Objects that follow an actor: record 105
      //     active (as in the save), the others not. The first record only sets the state (the save's sounds already play).
      {
        let fr = 0;
        const log = [], vols = [];
        const be = { open: (n) => { log.push('start ' + fr); return n; }, close: () => log.push('stop ' + fr),
          setVol: (h, v) => { if (fr >= lo && fr < hi) vols.push(fr + ':' + v); }, area: () => {}, req15: () => {} };
        const PS = new AM.PlacedSounds(D, be);
        for (const r of R) {
          fr = r.frame;
          const li = lis.get(r.frame) || lis.get(r.frame - 1);
          const Lv = li ? Lof(li).alt : [r.matrix[3][0], r.matrix[3][1] - 7.0, r.matrix[3][2]];
          if (r === R[0]) { log.length = 0; }
          PS.frame([r.matrix[3][0], r.matrix[3][1] - 7.0, r.matrix[3][2]], Lv, (k) => k === 105);
          if (r === R[0]) log.length = 0;
        }
        const wantVols = at('bg_vol').map((e) => e.frame + ':' + e.a2).sort(), gotVols = vols.filter((v) => +v.split(':')[0] > R[0].frame).sort();
        const gl = log.filter((x) => +x.split(' ')[1] >= lo && +x.split(' ')[1] < hi);
        try { assert.deepStrictEqual(gl, ws.map((w) => w)); assert.deepStrictEqual(gotVols, wantVols.filter((v) => +v.split(':')[0] > R[0].frame));
          console.log('ok', tn, 'PlacedSounds replay:', gl.join(', ') || 'no start / stop', '+', gotVols.length, 'volumes'); }
        catch (e) { fails++; console.log('FAIL', tn, 'PlacedSounds replay', gl, ws, gotVols.length, wantVols.length, String(e.message).slice(0, 300)); }
      }
      // 2. FUN_003e6ec8: every frame's fixed volume from this frame's listener +0x3850
      const playing = (f) => objs.filter((x) => x.inAt && (x.inAt.get(f) || x.inAt.get(f - 1)));   // the volume pass runs before the objects
      let vOk = 0, vBad = 0;
      for (const e of at('bg_vol')) {
        const li = lis.get(e.frame);
        if (!li) continue;
        const L = Lof(li).alt;
        if (playing(e.frame).some((x) => AM.distVolume(AM.soundDistance(x.o, x.sp, L)) === e.a2)) vOk++;
        else { vBad++; if (vBad < 4) console.log('  bg vol', e.frame, 'slot', e.a1, 'want', e.a2); }
      }
      if (vBad) { fails++; console.log('FAIL', tn, 'bg volumes', vOk, 'ok', vBad, 'bad'); } else console.log('ok', tn, 'bg volumes', vOk);
      // 3. FUN_003e9ed0's update requests (0x11) of those slots: emitterVolPan(fixed volume, centre) with that listener
      let uOk = 0, uPan = 0, uBad = 0;
      for (const e of at('se_update')) {
        const x = objs.find((q) => q.id === e.a1 && q.inAt && q.inAt.get(e.frame)), li = lis.get(e.frame);   // the one playing
        if (!x || !li) continue;
        const L = Lof(li), vol = AM.distVolume(AM.soundDistance(x.o, x.sp, L.alt));
        const g = A.emitterVolPan({ pos: x.sp.centre, flags: A.SLOT_FLAGS.FIXED | (vol << 7) }, L);
        if (g.vol === e.t0 && g.pan === e.a3 && e.t1 === 0) uOk++;
        else if (g.vol === e.t0 && Math.abs(g.pan - e.a3) === 1) uPan++;                    // acosf (L, emitterVolPan)
        else { uBad++; if (uBad < 4) console.log('  update', e.frame, e.a1, g, 'want', e.t0, e.a3); }
      }
      if (uBad || uPan > 1) { fails++; console.log('FAIL', tn, 'update requests', uOk, 'ok', uPan, 'pan +-1', uBad, 'bad'); }
      else console.log('ok', tn, 'update requests', uOk, 'exact', uPan, 'pan +-1 (acosf L)');
      // 4. footfalls: FUN_005ae828 on the foot markers' y of record f (the pose the frame starts with) -> the game's
      //    FUN_003e9c38 frames, where the MP's name (record mp_3b0) is set; the name = FUN_003415d8(material, gait)
      const ft = new AM.FootTest(D.foot.p000);
      const predicted = [];
      let nBad = 0;
      for (const r of R) {
        const h = ft.step([r.foot_l[1], r.foot_r[1]]);
        const nm = Buffer.from(r.mp_3b0, 'hex').subarray(0, 8).toString('latin1').split('\0')[0];
        if (h >= 0 && nm && r.frame >= lo && r.frame < hi) predicted.push(r.frame + ' ' + nm);
        const gait = r.c_590 >>> 30, mat = (r.c_6c0 >>> 8) & 0xff;
        if (AM.footName(D.foot, mat, gait, D.version) !== nm && r.frame > R[0].frame + 1) {
          // the name changes at FUN_00346650 / FUN_00340e08 inside the frame: the record shows the state after it
          const r1 = rec.get(r.frame + 1);
          if (!r1 || AM.footName(D.foot, (r1.c_6c0 >>> 8) & 0xff, r1.c_590 >>> 30, D.version) !== Buffer.from(r1.mp_3b0, 'hex').subarray(0, 8).toString('latin1').split('\0')[0]) nBad++;
        }
      }
      const plays = at('foot_play').map((e) => e.frame + ' ' + name(e['a2+0x0'].u));
      try { assert.deepStrictEqual(predicted, plays); console.log('ok', tn, 'footfalls', plays.length, '(' + [...new Set(plays.map((p) => p.split(' ')[1]))].join(', ') + ')'); }
      catch (e) { fails++; console.log('FAIL', tn, 'footfalls\n  got ', predicted.join(', '), '\n  want', plays.join(', ')); }
      if (nBad) { fails++; console.log('FAIL', tn, 'footstep names from (material, gait):', nBad, 'records differ'); }
      else console.log('ok', tn, 'footstep names = FUN_003415d8(C+0x6c1, C+0x590) on every record');
      // 5. the footstep request one frame later: the MP's slot (flag 0x8000: pan 0x40), range 400, at MP+0x10 of record
      //    f - 1 (traced: 57 / 57; record f: 56 / 57; why one frame older is not decoded, play.js GUESS)
      let fOk = 0, fBad = 0;
      for (const e of at('foot_play')) {
        const r = rec.get(e.frame - 1), sn = C.find((x) => x.hook === 'se_new' && x.frame === e.frame + 1 && x.a1 === SE.names[name(e['a2+0x0'].u)].id);
        const li = lis.get(e.frame + 1);
        if (!r || !sn || !li) continue;
        const g = A.emitterVolPan({ pos: r.mp_pos.slice(0, 3), range: 400, flags: A.SLOT_FLAGS.NOPOS }, Lof(li));
        if (g.vol === sn.a3 && g.pan === sn.a2) fOk++; else { fBad++; console.log('  footstep request', e.frame, g, 'want', sn.a3, sn.a2); }
      }
      if (fBad) { fails++; console.log('FAIL', tn, 'footstep requests', fOk, 'ok', fBad, 'bad'); } else console.log('ok', tn, 'footstep requests', fOk);
    }
    // hand cases: the material table and the kinds (no trace has a second floor material: w215 routes stay on 3)
    t('footstep cues: walk / run / stand on materials 1, 2, 3, 0xc and none (ladder: 0)', () => {
      const f = D.foot;
      assert.strictEqual(AM.footCue(f, 3, 1, 48), 2);           // DAT_004a1920[3] = 2, walk: row 0
      assert.strictEqual(AM.footCue(f, 3, 2, 48), 16 + 2);      // run: row 1
      assert.strictEqual(AM.footCue(f, 2, 1, 48), 1);           // material 2 -> 1
      assert.strictEqual(AM.footCue(f, 1, 2, 48), 16);          // material 1 -> 0
      assert.strictEqual(AM.footCue(f, 12, 1, 48), 11);         // material 0xc -> 11
      assert.strictEqual(AM.footCue(f, 3, 0, 48), 0x6e + 2);    // stand: 0x6e + m (stage version >= 0x2f)
      assert.strictEqual(AM.footCue(f, 3, 0, 0x2e), 2);         // older stage: m
      assert.strictEqual(AM.footCue(f, 99, 1, 48), null);       // beyond the 14-word table
      assert.strictEqual(AM.footName(f, 3, 1, 48), 'fsj_002');
      assert.strictEqual(AM.footName(f, 3, 2, 48), 'fsj_014');
      assert.strictEqual(AM.footName(f, 2, 1, 48), 'fsj_001');
      assert.strictEqual(AM.footName(f, 3, 0, 48), '');
    });
    t('foot test: up below the threshold, a footfall when back at or above it (only once)', () => {
      const ft = new AM.FootTest(D.foot.p000);
      assert.deepStrictEqual([[-1, -1], [-2.3, -1], [-2.3, -1], [-2.2, -1], [-1, -1]].map((y) => ft.step(y)), [-1, -1, -1, 0, -1]);
      const f3 = new AM.FootTest({ version: '1', legs: 0, thr: [-2.2, -1] });
      assert.deepStrictEqual([[-2.5, 0], [-2.5, 0], [-1, 0]].map((y) => f3.step(y)), [-1, -1, -1]);   // default -3.0
    });
    t('PlacedSounds: the open volume (FUN_003e6d70 -> FUN_003e8890) and the per-frame one use the listener +0x3850, not the inside-test point', () => {
      const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
      const d = { objects: [{ idx: 0, name: 'x', m: I, inv: I, lo: [-10, -20, -10, 1], hi: [10, 0, 10, 1], shape: 0, actor: -1, area: 0, vol: 255, req15: 30 }] };
      const got = [];
      const ps = new AM.PlacedSounds(d, { open: (n, pos, v) => { got.push(['open', v]); return 1; }, setVol: (h, v) => got.push(['vol', v]), close: () => got.push(['close']), area: () => {}, req15: (v) => got.push(['req15', v]) });
      ps.frame([9, -10, 9], [0, -10, 0]);                      // L inside near the edge (0.9 -> 12), the listener at the centre (127)
      ps.frame([9, -10, 9], [5, -10, 0]);                      // next frame: the volume pass first (0.5 -> 63)
      ps.frame([11, -10, 0], [5, -10, 0]);                     // L outside: its volume this frame, then the stop
      assert.deepStrictEqual(got, [['open', 127], ['req15', 30], ['vol', 63], ['vol', 63], ['close'], ['req15', 20]]);   // 0x15 only on a change (DAT_0047d710 = 20)
    });
    t('placed sound volume FUN_003e6438 and distance shapes FUN_0057e310', () => {
      assert.deepStrictEqual([0, 0.5, 0.999, 1, 2, -1].map(AM.distVolume), [127, 63, 0, 0, 0, 127]);
      const o = { m: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], inv: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        lo: [-10, -20, -10, 1], hi: [10, 0, 10, 1], shape: 0 };
      const sp = AM.soundSpace(o);
      assert.deepStrictEqual(sp.centre, [0, -10, 0]);
      assert.strictEqual(AM.soundDistance(o, sp, [5, -10, 8]), Math.fround(0.8));   // box: max(|x|, |z|)
      assert.ok(AM.inside(o, sp, [10, 0, -10]) && !AM.inside(o, sp, [10.01, -5, 0]));
      const o2 = { ...o, shape: 2 }, sp2 = AM.soundSpace(o2);
      assert.ok(Math.abs(AM.soundDistance(o2, sp2, [6, -10, 8]) - 1) < 1e-6);   // cylinder: sqrt(x^2 + z^2)
      assert.ok(AM.inside(o2, sp2, [6, -19, 7.9]) && !AM.inside(o2, sp2, [6, -21, 0]) && !AM.inside(o2, sp2, [8, -5, 7]));
      const o1 = { ...o, shape: 1 }, sp1 = AM.soundSpace(o1);
      assert.ok(AM.inside(o1, sp1, [0, -19, 0]) && !AM.inside(o1, sp1, [8, -18, 0]));
    });
  }
}

console.log(fails ? `FAILED ${fails}` : `all ok (${checked} traced SEs)`);
process.exit(fails ? 1 : 0);
