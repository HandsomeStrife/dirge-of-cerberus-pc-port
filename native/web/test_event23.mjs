// test_event23.mjs -- worker 0237: the stage-load pass's script event 0x23 (FUN_005459d8) and script op 42.
//   node native/web/test_event23.mjs          (MUTATE_AI = path of a mutated enemy_ai.js copy)
// - FUN_005459d8 walks the manager type lists 0xc, 1, 2, 3, 8, 0xa, 0xf, 0x10, 0xb, 0xe (DAT_0058b5c8): type 0xc is the stage
//   object (FUN_0053c140 builds it first, script = section 4 +0x18 = 0 on z128), 1 the actors / records, 3 the triggers.
// - op 42 FUN_00370d68: hi = pop, lo = pop (float cells chopped), push lo + (int)((float)(hi - lo + 1) x rand).
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const { createEnemyAI } = await import(process.env.MUTATE_AI ? pathToFileURL(path.resolve(process.env.MUTATE_AI)).href : './enemy_ai.js');
let fail = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };
const finish = () => { console.log(fail ? `${fail} FAILED` : 'all ok'); process.exit(fail ? 1 : 0); };
const D = p => path.join(here, 'data', p);
if (!existsSync(D('enemies/ai.json'))) { console.log('SKIP (tools/byo/build_web.sh)'); finish(); }
const data = JSON.parse(readFileSync(D('enemies/ai.json'), 'utf8'));
const P = { pos: [-1395.6, -98.6, -1110.5], face: [0, 0, 1], hp: 780, id: 0x16, f118: 0, s64: 0 };
const mk = (o = {}) => createEnemyAI({ data, player: P, quiet: true, log: () => {}, rand: () => 0.5, ...o });

// ---------------------------------------------------------------- the stage object
ok(data.stage_script === 0, `ai.json stage_script ${data.stage_script} (section 4 +0x18 = 0)`);
{
  const W = mk();
  ok(W.stageObj && W.stageObj.kind === 'stage' && W.stageObj.script === 0 && W.objects.get('stage') === W.stageObj, 'the stage object exists with script 0');
  W.events.length = 0;
  W.event23();
  const ev = W.events.filter(e => / ev 35 /.test(e));
  const first = ev.findIndex(e => /^event stage /.test(e));
  const lastRec = ev.map(e => /^event \d+ /.test(e)).lastIndexOf(true);
  const firstTrig = ev.findIndex(e => /^event t\d+ /.test(e));
  ok(first === 0, `event 0x23 goes to the stage object first (${ev[0]})`);
  ok(lastRec > 0 && (firstTrig === -1 || firstTrig > lastRec), `records / actors (type 1) before triggers (type 3): last record ${lastRec}, first trigger ${firstTrig}`);
}
// script 0 event 0x23: flag 0 == 2 -> manager 0xb(63, 1) (flag 63 = 1); flag 0 == 0 (the Restart's flags) -> nothing
{
  const W = mk({ eventFlags: { 0: 2 } });
  W.event23();
  ok(W.eventFlags[63] === 1, `flag 0 = 2: script 0's event 0x23 sets flag 63 = ${W.eventFlags[63]} (1)`);
  const W0 = mk({ eventFlags: {} });
  W0.event23();
  ok(!W0.eventFlags[63], 'flags 0: flag 63 stays 0');
}

// ---------------------------------------------------------------- op 42 (hand cases on a test script)
{
  const run = (code, r) => {
    const d = { ...data, scripts: { ...data.scripts, 9999: { 35: { code: [...code, [42, -1], [1, 0]], locals: 0 } } } };
    const W = createEnemyAI({ data: d, player: P, quiet: true, log: () => {}, rand: () => r });
    return W.runEvent({ kind: 'stage', id: 'x', script: 9999, vars: new Int16Array(8), t3c: new Int16Array(2), flags28: 0 }, 35);
  };
  ok(run([[4, 200], [4, 600]], 0) === 200, 'rand 0 -> lo (200)');
  ok(run([[4, 200], [4, 600]], 0.99999) === 600, 'rand 0.99999 -> hi (600)');
  ok(run([[4, 200], [4, 600]], 0.5) === 200 + Math.trunc(401 * 0.5), `rand 0.5 -> 200 + trunc(401 x 0.5) = ${run([[4, 200], [4, 600]], 0.5)}`);
  ok(run([[5, 2.7], [5, 5.9]], 0.99999) === 5 && run([[5, 2.7], [5, 5.9]], 0) === 2, 'float cells are chopped: [2.7, 5.9] -> 2..5');
  ok(run([[5, 2.7], [5, 5.2]], 0.99999) === 5, `[2.7, 5.2] chopped to [2, 5]: top 5 (${run([[5, 2.7], [5, 5.2]], 0.99999)})`);
  ok(run([[4, -3], [4, 3]], 0.5) === 0, '[-3, 3] at 0.5 -> -3 + trunc(7 x 0.5) = 0');
  // f32: (hi - lo + 1) x rand in single precision; 0x7fff..: rand just below 1 that rounds to 1 in f32 gives hi + 1
  { const r = 1 - 2 ** -30; ok(run([[4, 0], [4, 9]], r) === 10, `f32 product: 10 x (1 - 2^-30) rounds to 10 in f32 -> ${run([[4, 0], [4, 9]], r)}`); }
  ok(run([[4, 7], [4, 7]], 0.9) === 7, 'lo == hi -> lo');
}
// records 81-86 (scripts 159-164) at the 0x23 pass: their timer 0 = rand in their ranges; one draw each
{
  const used = [];
  const W = mk({ rand: () => { used.push(1); return 0.25; } });
  W.event23();
  const t0 = k => W.objects.get(k + 22).t3c[0];
  const exp = { 81: [200, 600], 82: [400, 500], 83: [300, 400], 84: [80, 160], 85: [130, 200], 86: [20, 100] };
  ok(Object.entries(exp).every(([k, [lo, hi]]) => t0(+k) === lo + Math.trunc(Math.fround((hi - lo + 1) * 0.25))),
     `81-86 timer 0 = lo + trunc((hi - lo + 1) x 0.25): ${Object.keys(exp).map(k => t0(+k)).join(', ')}`);
  ok([81, 82, 83, 84, 85, 86].every(k => W.timerList.includes(k + 22)), '81-86 join the timer list (cmd 0x106)');
  ok(used.length === 6, `6 draws (${used.length})`);
  // cmd 0x143 on an inactive record (no AI: +0x184 0) does nothing (FUN_005661e8), as on the page
  ok([81, 82, 83, 84, 85, 86].every(k => W.objects.get(k + 22).kind === 'record' && !W.objects.get(k + 22).ai), '81-86 stay inactive records without an AI');
}
// manager 0x6e / 0x6f / 0x70 -> opts.hudGauge (the HUD's top-right gauge; worker 0237): 0x6e with r0 >= 0x12 calls nothing
{
  const calls = [];
  const W = mk({ hudGauge: (cmd, g) => calls.push([cmd, g.id, g.v, g.max, g.f]) });
  const o = W.stageObj;
  W.t.send(o, -2, 0x6e, [0x12, 5, 5, 0]);
  W.t.send(o, -2, 0x6e, [13, 7000, 7000, 1]);
  W.t.send(o, -2, 0x6f, [0, 0, 0, 0]);
  W.t.send(o, -2, 0x70, [0, 0, 0, 0]);
  ok(JSON.stringify(calls) === JSON.stringify([[0x6e, 13, 7000, 7000, 1], [0x6f, 13, 7000, 7000, 1], [0x70, 13, 7000, 7000, 1]]),
     `hudGauge calls: ${JSON.stringify(calls)} (0x6e 0x12 dropped)`);
}
finish();
