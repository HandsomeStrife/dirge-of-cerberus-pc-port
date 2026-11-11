// event_fx.js (worker 0275): the event effect natives and the sequence command 0x1d, on the real opening script (scr001) and the
// exported FED a0001 (data/event/fx, export_web_event_fx.py). notes/fidelity-audit.md 'Event effects: ...'.
//   node --import ./native/web/test_hooks.mjs native/web/test_event_fx.mjs
import { readFileSync, existsSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const imp = f => import(pathToFileURL(path.join(here, f)).href);
let fail = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };
const done = () => { console.log(fail ? `${fail} FAILED` : 'all ok'); process.exit(fail ? 1 : 0); };
const { createEventFx, fedCode } = await imp('event_fx.js');
const { createMenuFx } = await imp('menu_fx.js');
const { EventRuntime } = await imp('event_rt.js');
const { EventActors } = await imp('event_actor_rt.js');

// FUN_002df168: letter nibble << 28 | 4 digits << 18
ok(fedCode('A0001') === 0x80040000 && fedCode('a0093') === 0x81740000 && fedCode('e0027') === 0x406c0000 && fedCode('x0001') === 0,
  'FUN_002df168: A0001 0x80040000, a0093 0x81740000, e0027 0x406c0000, unknown letter 0');

for (const f of ['data/event/fx/a0001.fed', 'data/event/ev0100_scr001.json'])
  if (!existsSync(path.join(here, f))) { console.log('SKIP the rest: no ' + f + ' (tools/byo/build_web.sh)'); done(); }
const fedBuf = (() => { const b = readFileSync(path.join(here, 'data/event/fx/a0001.fed')); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); })();
const D = JSON.parse(readFileSync(path.join(here, 'data/event/ev0100_scr001.json'), 'utf8'));

function run({ skipAt = 0, until = 5000, each = null } = {}) {
  const warns = [];
  const ef = createEventFx({ createMenuFx, warn: m => warns.push(m), fetchFed: () => Promise.resolve(fedBuf) });
  const actors = new EventActors({ clipFrames: () => 10, warn: () => {} });
  const rt = new EventRuntime(D, { warn: () => {}, actors, effects: ef });
  rt.start();
  const seen = [];
  return (async () => {
    while (!rt.done && rt.frameNo < until) {
      ef.begin(1); rt.frame(20); ef.end();
      if (skipAt && rt.frameNo === skipAt) rt.requestSkip();
      await null;                                                  // the FED's load promise
      if (each) each(rt, ef, seen);
    }
    return { rt, ef, warns, seen };
  })();
}

// strid2numid (FUN_002f5238 -> FUN_002e5178): the FED's own table; not loaded / not listed -> -1
{
  const ef = createEventFx({ createMenuFx, warn: () => {}, fetchFed: () => Promise.resolve(fedBuf) });
  const R = { skip: 0, slots: [], log: [], frameNo: 0, cmd(t, x) { this.slots.push({ type: t, ...x }); return 1; } };
  const N = ef.natives(R), s2n = N['fake/KerberosEffect.strid2numid(Ljava/lang/String;)I'];
  ok(s2n(null, ['FEDEF_A0001_SCOPE01_IN_SCOPE01_IN']) === -1, 'strid2numid before Effect.load(1): -1');
  N['fake/KerberosEffect.load(I)I'](null, [1]);
  await new Promise(r => setTimeout(r, 0));
  ok(s2n(null, ['FEDEF_A0001_SCOPE01_IN_SCOPE01_IN']) >>> 0 === 0x80042000 && s2n(null, ['FEDEF_A0001_HEAD00_HEAD01']) >>> 0 === 0x80040403,
    'strid2numid: SCOPE01_IN 0x80042000, HEAD00_HEAD01 0x80040403 (the table order, not the name order)');
  ok(s2n(null, ['FEDEF_A0001_SCOPE01_IN_SCOPE01_IX']) === -1 && s2n(null, ['FEDEF_A0002_SCOPE01_IN_SCOPE01_IN']) === -1,
    'strid2numid: a wrong name or another FED: -1');
  R.skip = 1;
  ok(N['fake/KerberosEffect.load(I)I'](null, [1]) === 0x7fffffff, 'Effect.load under Skip: 0x7fffffff (FUN_0037f2f0)');
  ok(N['fake/KerberosEffect.playseqstr_l(I[I[F[Ljava/lang/String;)I'](null, [10, { $arr: true, a: [0] }, { $arr: true, a: [0] }, { $arr: true, a: ['FEDEF_A0001_SCOPE01_IN_SCOPE01_IN'] }]) === 0x7fffffff,
    'playseqstr_l under Skip with only DAT_004ee4a0 ids: 0x7fffffff (FUN_0037f728)');
  R.skip = 0;
  ok(N['fake/KerberosEffect.playseqstr_l(I[I[F[Ljava/lang/String;)I'](null, [10, { $arr: true, a: [0, 0] }, { $arr: true, a: [0] }, { $arr: true, a: ['a', 'b'] }]) === 0,
    'playseqstr_l with arrays of different lengths: 0 (FUN_003a1ea8)');
}

// the sequence timing (FUN_00382cd8): times in frames (ms x 0.06) since the item before; the last item ends the command
{
  const ef = createEventFx({ createMenuFx, warn: () => {}, fetchFed: () => Promise.resolve(fedBuf) });
  const R = { skip: 0, clock: 0, slots: [], log: [], frameNo: 0, actors: null, cmd(t, x) { this.slots.push({ type: t, ...x }); return 1; } };
  const N = ef.natives(R);
  N['fake/KerberosEffect.load(I)I'](null, [1]); await new Promise(r => setTimeout(r, 0));
  N['fake/KerberosEffect.playseqstr_l(I[I[F[Ljava/lang/String;)I'](null, [0, { $arr: true, a: [0, 0] }, { $arr: true, a: [5, 10] },
    { $arr: true, a: ['FEDEF_A0001_SCOPE01_IN_SCOPE01_IN', 'FEDEF_A0001_WANTED_WANTED'] }]);
  const c = R.slots.find(x => x.type === 0x1d), log = [];
  for (let k = 0; k < 20; k++) {
    R.clock = 20 * (k + 1);                                       // the event clock (ms)
    const fin = ef.seq(c, R);
    log.push([k, ef.mgr.emitters.map(e => (e.id >>> 0).toString(16)).join(','), fin]);
    if (fin) break;
  }
  const first = log.find(l => l[1].includes('80042000')), second = log.find(l => l[1].includes('80040000'));
  // start = the first frame's clock; item 0 when (clock - start) x 0.06 >= 5 (100 ms: step 5); +0x2c is then reset to that
  // clock, so item 1 comes 10 frames after item 0 (180 ms: step 14), not 10 frames after the command's start (step 9)
  ok(first && first[0] === 5 && second && second[0] === 14 && second[2] === true,
    `items at 5 and 10 frames: played at steps ${first && first[0]} / ${second && second[0]} (the time since the item before), the command ends with the last (${second && second[2]})`);
}

// a hidden emitter (+0x0a bit 2) is left out of FUN_002ea6a0 (l.64: +0x0a & 0xfc7f: no FUN_002e7cd0, no FUN_002eacc8) and of
// FUN_002ea040's ageing: its particles and the shared LCG stay as they are, frame after frame
{
  const ef = createEventFx({ createMenuFx, warn: () => {}, fetchFed: () => Promise.resolve(fedBuf) });
  const R = { skip: 0, clock: 0, slots: [], log: [], frameNo: 0, actors: null, cmd(t, x) { this.slots.push({ type: t, ...x }); return 1; } };
  const N = ef.natives(R), s2n = N['fake/KerberosEffect.strid2numid(Ljava/lang/String;)I'];
  N['fake/KerberosEffect.load(I)I'](null, [1]); await new Promise(r => setTimeout(r, 0));
  const names = ['FEDEF_A0001_SCOPE01_IN_SCOPE01_IN', 'FEDEF_A0001_SCOPE01_LOOP_SCOPE01_LOOP', 'FEDEF_A0001_WANTED_WANTED', 'FEDEF_A0001_DEADORALIVE_DEADORALIVE'];
  N['fake/KerberosEffect.playseqstr_l(I[I[F[Ljava/lang/String;)I'](null, [0, { $arr: true, a: names.map(() => 0) }, { $arr: true, a: names.map(() => 0) }, { $arr: true, a: names }]);
  const c = R.slots.find(x => x.type === 0x1d);
  for (let k = 0; k < 40; k++) { R.clock = 20 * (k + 1); ef.begin(1); ef.seq(c, R); ef.end(); }
  for (const s of names) N['fake/KerberosEffect.setVisible_l(ZII)V'](null, [0, s2n(null, [s]), -1]);
  ef.begin(1); ef.end();
  const snap = () => JSON.stringify({ rng: [ef.mgr.rng.s, ef.mgr.rng.R], p: ef.mgr.emitters.map(e => [e.age, e.lists.map(L => L.map(p => [p.age, p.flags, p.v]))]) });
  const s0 = snap();
  let same = true;
  for (let k = 0; k < 10; k++) { ef.begin(1); ef.end(); if (snap() !== s0) same = false; }
  const n = ef.mgr.emitters.length, hid = ef.mgr.emitters.filter(e => e.f0a & 4).length;
  ok(n > 0 && hid === n && same, `hidden emitters (${hid} / ${n}): particles and the LCG unchanged over 10 frames (FUN_002ea6a0 l.64, FUN_002ea040)`);
}

// the opening: the scanner from first_event (actor 10), hidden by setVisible_l(0) at the black, the four HEAD00 on actor 12
const A = await run({ each: (rt, ef, seen) => { if (ef.mgr) seen.push([rt.frameNo, ef.mgr.emitters.map(e => (e.id >>> 0).toString(16) + (e.f0a ? 'h' : ''))]); } });
const at = (fr) => (A.seen.find(([f]) => f === fr) || [0, []])[1];
const L = A.rt.log.filter(([, m]) => /^fx/.test(m));
const fs0 = L.find(([, m]) => /^fxseq 10 FEDEF_A0001_SCOPE01_IN/.test(m)), fv = L.find(([, m]) => m === 'fxvis 0 80042000');
ok(fs0 && at(fs0[0]).includes('80042000'), `SCOPE01_IN spawned the frame first_event plays it (f${fs0 && fs0[0]})`);
ok(fv && at(fv[0]).includes('80042000') && at(fv[0] + 1).includes('80042000h'), `setVisible_l(0) at f${fv && fv[0]} hides it at the next manager frame start (FUN_002edcc0 in FUN_002efc78)`);
const sp = A.ef.title.sprites().length;
ok(at(fv[0] + 1).includes('80042000h') && A.ef.mgr.emitters.filter(e => (e.id >>> 0) === 0x80042000).every(e => e.f0a & 4), 'the hidden scanner keeps its emitter with +0x0a bit 2 (FUN_002ebee8 mode 2)');
ok(sp === 0, `nothing drawn at the opening's end (all hidden: FUN_002eadc0 draws +0x0a == 0 only): ${sp} sprites`);
const stop = L.find(([, m]) => m === 'fxstop 80040800');
ok(stop && !at(stop[0] + 1).some(x => x.startsWith('80040800')) && at(stop[0] - 1).some(x => x.startsWith('80040800')), `stop2_l(HINOKO) at f${stop && stop[0]}: the emitter goes at the next frame start (FUN_002ed768 -> FUN_002e6920)`);
const h12 = L.find(([, m]) => /^fxseq 12 /.test(m));
ok(h12 && ['80040400', '80040403', '80040401', '80040402'].every(id => at(h12[0]).includes(id)), 'the four HEAD00 items at time 0 all play in one frame');

// Skip: none of these play (FUN_0037f728 / FUN_00382cd8: only the impacts' and the level's managers run under Skip)
const B = await run({ skipAt: 300, until: 3000 });
ok(!B.rt.log.some(([f, m]) => f > 300 && /^fxseq/.test(m)) && (!B.ef.mgr || !B.ef.mgr.emitters.some(e => (e.id >>> 0) === 0x80042000)), 'under Skip: no scanner');
done();
