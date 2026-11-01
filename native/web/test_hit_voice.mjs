// Vincent's hit voice (worker 0174; notes/audio-research.md "Vincent's hit voice"). Damage vt+0x1ec FUN_0055c7f8 ->
// vt+0x324 FUN_00576ac8 -> FUN_0055c978: cue 0x44 (FUN_00341330; '' in z128) and cue 0x4c through the 15-frame gate
// FUN_003412d0 (C+0x810). Cue 0x4c is '?' -> event 0x25 (r0 = 0x4c) of his script: own script 246 has none, so the
// parameter set's script 297 runs (FUN_00568f98): switch (r0 - 76), rand_i(6) (VM op 41), names bt_v000 / bt_v001 /
// bt_v002 for 0 / 1 / 2 and nothing for 3-6, cmd 0x125 (FUN_0054cd70: FUN_0033cc48 at the object's position).
// Melee (FUN_0055eac8): its own cue 0x44 / gate 0x4c are on the P+0x28 bit 0x20 (no damage) branch only.
// Data: data/enemies/ai.json (gitignored; build_web.sh step enemy_ai). Traces (gitignored, optional):
// tools/trace/out/w174_pain_a (script w174_pain_a: call-log set 'pain') and w172_sound3.
//   node --import ./native/web/test_hooks.mjs native/web/test_hit_voice.mjs [enemy_ai.js]
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const AI = await import(pathToFileURL(path.resolve(process.argv[2] || path.join(here, 'enemy_ai.js'))).href);
let fail = 0, n = 0;
const ok = (c, m) => { n++; if (!c) fail++; console.log((c ? 'ok   ' : 'FAIL ') + m); };
const done = () => { console.log(fail ? `${fail} FAILED of ${n}` : `all ok (${n})`); process.exit(fail ? 1 : 0); };
const dataPath = path.join(here, 'data/enemies/ai.json');
if (!existsSync(dataPath)) { console.log('SKIP: data/enemies/ai.json missing'); done(); }
const data = JSON.parse(readFileSync(dataPath, 'utf8'));
if (!data.cues || !data.player || !data.pset_script) { console.log('SKIP: ai.json has no cues / player / pset_script: rebuild data/enemies'); done(); }

// ---- the data the chain reads
ok(data.player.script === 246 && data.pset_script[data.player.pset] === 297,
  `Vincent's scripts: own ${data.player.script} (save P+0x34), parameter set ${data.player.pset} -> ${data.pset_script[data.player.pset]} (297)`);
const cues = data.cues[data.player.cues];
ok(cues[0x44] === '' && cues[0x4c] === '?' && cues[0x4d] === '?', `cue table ${data.player.cues}: 0x44 '${cues[0x44]}', 0x4c '${cues[0x4c]}', 0x4d '${cues[0x4d]}'`);
const s297 = data.scripts['297'] && data.scripts['297']['37'];
ok(!!s297 && typeof s297.data === 'string' && !(data.scripts['246'] || {})['37'], 'script 297 has event 0x25 with a data block; script 246 has none');

// a world with Vincent and a bullet hit through damagePlayer (FUN_0055db50 -> vt+0x1ec); r = the shared RNG
function world(draws, opts = {}) {
  const calls = [], drawn = [];
  const player = { pos: [-1070.9, -146.07, -1105.6], hp: 780, id: 0x16, f118: 0, s64: 0 };
  const W = AI.createEnemyAI({ data, player, quiet: true, damage: true,
    rand: () => { const v = draws.length ? draws.shift() : 0.5; drawn.push(v); return v; },
    sound: (name, pos) => calls.push({ name, pos: pos && pos.slice() }),
    react: opts.react, ...opts.extra });
  const shot = () => W.t.damagePlayer({ damage: 44, kind: 1, hit: 0, f148: 0, dir: [1, 0, 0], pos: player.pos.slice(), from: { id: 66 } });
  return { W, calls, drawn, player, shot };
}
const pick = k => (k + 0.5) / 7;                      // a draw r with (int)(7 r) = k

// ---- script 297 through the page: the name per rand_i result
const want = ['bt_v000', 'bt_v001', 'bt_v002', null, null, null, null];
for (let k = 0; k < 7; k++) {
  const w = world([pick(k)]);
  w.shot();
  const got = w.calls.map(c => c.name);
  ok(w.drawn.length === 1 && (want[k] ? got.length === 1 && got[0] === want[k] : got.length === 0),
    `bullet hit, rand_i -> ${k}: ${got.join(',') || 'no sound'} (${want[k] || 'none'}), ${w.drawn.length} draw(s)`);
}
{ // at Vincent's position, after the HP change, before the reaction
  const order = [], sounds = [];
  const w = world([pick(2)], { react: h => { order.push(`react after ${sounds[0].length} sound(s)`); return 'none'; } });
  sounds.push(w.calls);
  const s0 = w.calls.length;
  w.W.t.damagePlayer({ damage: 44, kind: 1, hit: 0, f148: 0, dir: [1, 0, 0], pos: w.player.pos.slice(), from: { id: 66 } });
  const c = w.calls[s0];
  ok(c && c.name === 'bt_v002' && c.pos.every((x, i) => x === w.player.pos[i]), `bt_v002 at Vincent's position ${c && c.pos}`);
  ok(w.player.hp < 780 && order.length === 1 && order[0] === `react after ${s0 + 1} sound(s)`, `HP ${w.player.hp} and the voice before the reaction (${order})`);
}

// ---- the 15-frame gate FUN_003412d0 (C+0x810): > 14 frames since the last gated cue
for (const [gap, draws2] of [[14, 0], [15, 1]]) {
  const w = world([pick(0), pick(1)]);
  w.shot();
  for (let i = 0; i < gap; i++) w.W.tick(1.2, w.player.pos, w.player.pos);
  w.shot();
  ok(w.drawn.length === 1 + draws2 && w.calls.length === 1 + draws2,
    `second hit ${gap} frames later: ${w.drawn.length} draws, sounds ${w.calls.map(c => c.name)} (gate ${draws2 ? 'open' : 'shut'})`);
}
{ // the save's C+0x810 = 359 at frame counter 1575: the first hit passes on frame 0
  const w = world([pick(1)]);
  w.shot();
  ok(w.calls.length === 1, `first hit at the page's frame 0 passes the gate (save C+0x810 359, counter 1575): ${w.calls.map(c => c.name)}`);
}
{ // dead after the hit: vt+0x324 (FUN_00576ac8 -> FUN_0055c978(.., 1)) runs no cue; the death vt+0x334 FUN_00576b48 ->
  // FUN_0055cac8 runs the gated cue 0x4c (his 0x4e is ''): the same voice script, one draw (worker 0181)
  const w = world([pick(0)]);
  w.player.hp = 10;
  w.shot();
  ok(w.player.hp === 0 && w.drawn.length === 1 && w.calls.length === 1 && w.calls[0].name === 'bt_v000',
     `killing hit: no hit cue, the death's gated 0x4c: ${w.drawn.length} draws, ${w.calls.map(c => c.name)}`);
}
{ // the death's 0x4c goes through the same 15-frame gate: a hit 5 frames before the killing one shuts it
  const w = world([pick(0), pick(1)]);
  w.shot();
  for (let i = 0; i < 5; i++) w.W.tick(1.2, w.player.pos, w.player.pos);
  w.player.hp = 10; w.shot();
  ok(w.player.hp === 0 && w.calls.length === 1 && w.drawn.length === 1, `killing hit 5 frames after a voiced hit: gate shut, no death voice (${w.calls.map(c => c.name)})`);
}
{ // the reaction takes the death (state 7): the death class's phase 0 cue 0x56 = asj_501 after the voice (worker 0181)
  const seen = [];
  const w = world([pick(0)], { react: h => { seen.push(h.deadNow); return h.deadNow ? 'death' : 'none'; } });
  w.player.hp = 10;
  w.shot();
  ok(seen.length === 1 && seen[0] === true && w.calls.map(c => c.name).join(',') === 'bt_v000,asj_501',
     `killing hit with the death reaction: ${w.calls.map(c => c.name)} (bt_v000 then asj_501)`);
  const w2 = world([pick(0)], { react: () => 'none' });
  w2.player.hp = 10; w2.shot();
  ok(w2.calls.map(c => c.name).join(',') === 'bt_v000', `no state 7 (reaction none): no death-motion cue (${w2.calls.map(c => c.name)})`);
}

// ---- melee: FUN_0055eac8 -> vt+0x1ec (the cues; the damage branch skips FUN_0055eac8's own cue block) -> one draw
for (const k of [1, 4]) {
  const w = world([pick(k), pick(0)]);
  const owner = { id: 66, pos: [w.player.pos[0] + 10, w.player.pos[1], w.player.pos[2]] };
  w.W.t.attackDamagePlayer({ dmg: 50, kind: 1, type: 1, ec: 4, owner }, w.player.pos.slice(), null, null);
  ok(w.player.hp < 780 && w.drawn.length === 1 && w.calls.map(c => c.name).join() === (want[k] || ''),
    `melee hit, rand_i -> ${k}: ${w.calls.map(c => c.name).join(',') || 'no sound'}, ${w.drawn.length} draw (HP ${w.player.hp})`);
}

// ---- VM ops on their own (a synthetic event 0x25 in script 297, run through a hit; cue 0x44 made '?' too)
// data: table 0 = (count 1, default 20, target 5) at data + 0; names 'aaa' / 'bbb' / 'ccc' at data + 2 / 3 / 4 x 8
{
  const d2 = JSON.parse(JSON.stringify(data));
  const b = new Uint8Array(40), dv = new DataView(b.buffer);
  [1, 20, 5].forEach((x, k) => dv.setInt32(4 * k, x, true));
  b.set([0x61, 0x61, 0x61], 16); b.set([0x62, 0x62, 0x62], 24); b.set([0x63, 0x63, 0x63], 32);
  const say = ref => [[37, ref], [52, 0], [26, 0], [4, -2], [38, 0x125], [17, 0]];
  d2.scripts['297']['37'] = { locals: 2, data: Buffer.from(b).toString('hex'), code: [
    [24, 0], [4, 76], [8, 0], [45, 0], [17, 0],        // 0-4: switch (r0 - 76) on table 0
    [4, 1], [41, -1], [29, 14],                        // 5-7: rand_i(1) -> (int)(2 r); 0 -> 14
    ...say(3),                                         // 8-13: 'bbb'
    ...say(2),                                         // 14-19: 'aaa'
    ...say(4)] };                                      // 20-25 (default): 'ccc'
  d2.cues[d2.player.cues] = d2.cues[d2.player.cues].slice(); d2.cues[d2.player.cues][0x44] = '?';
  for (const [base, r, w2] of [[76, 0.49, 'ccc,aaa'], [76, 0.5, 'ccc,bbb'], [76, 0.999, 'ccc,bbb'], [68, 0.49, 'aaa,ccc']]) {
    d2.scripts['297']['37'].code[1] = [4, base];
    const calls = [], drawn = [];
    const player = { pos: [1, 2, 3], hp: 780, id: 0x16, f118: 0, s64: 0 };
    const W = AI.createEnemyAI({ data: d2, player, quiet: true, damage: true, rand: () => { drawn.push(r); return r; }, sound: nm => calls.push(nm) });
    W.t.damagePlayer({ damage: 1, kind: 1, hit: 0, f148: 0, dir: [1, 0, 0], pos: [1, 2, 3], from: { id: 66 } });
    ok(calls.join() === w2 && drawn.length === 1,
      `VM: switch (r0 - ${base}): cues 0x44 / 0x4c -> ${w2} (r ${r}; v < 0 and v >= count take the default 'ccc'): ${calls} (${drawn.length} draw)`);
  }
}

// ---- cmd 0x125 on other objects (worker 0178): FUN_0033cc48 at FUN_0054a720(obj) = obj+0x90, range r1 when
// 0.1 < r1 (FUN_003e8ec8 on the kept slot), else the slot's 400. No position -> not played (never the listener).
{
  const near = (a, b) => !!a && !!b && a.length === 3 && a.every((x, i) => Math.abs(x - b[i]) < 1e-4);
  const run = (d, objId, ev, setup) => {
    const calls = [], warns = [];
    const W = AI.createEnemyAI({ data: d, player: { pos: [0, 0, 0], hp: 780, id: 0x16, f118: 0, s64: 0 }, quiet: true,
      rand: () => 0.5, warn: m => warns.push(m), log: m => warns.push(m), sound: (name, pos, range) => calls.push({ name, pos, range }) });
    if (setup) setup(W);
    W.runEvent(W.objects.get(objId), ev, [0, 0]);
    return { calls, warns };
  };
  // t179 (script 236) enter event 0xd: var 0 == 0 -> 0x125 to itself, r1 7000 (op 5)
  const t179 = data.triggers[179];
  if (!(t179 && t179.script === 236 && data.scripts['236'] && data.scripts['236']['13'])) ok(false, 'trigger 179 / script 236 event 0xd in ai.json');
  else {
    const a = run(data, 't179', 0xd);
    const c = a.calls[0];
    ok(a.calls.length === 1 && c.range === 7000 && near(c.pos, t179.m[3].slice(0, 3)),
      `t179 enter (script 236): ${c && c.name} range ${c && c.range} (7000) at ${c && c.pos} (= trigger +0x90 = m[3] ${t179.m[3].slice(0, 3)})`);
    // the same with r1 = 0.05 / 0 / 0.1 (not > 0.1) -> 400; 0.2 -> 0.2 (f32)
    for (const [v, want] of [[0.05, 400], [0, 400], [0.1, 400], [0.2, Math.fround(0.2)]]) {
      const d2 = JSON.parse(JSON.stringify(data));
      const code = d2.scripts['236']['13'].code, k = code.findIndex(x => x[0] === 5 && x[1] === 7000);
      code[k] = [5, v];
      const b = run(d2, 't179', 0xd);
      ok(b.calls.length === 1 && b.calls[0].range === want, `t179 with r1 ${v}: range ${b.calls[0] && b.calls[0].range} (${want})`);
    }
    // an object without a +0x90 position on the page: not played, warned
    const e = run(data, 'x', 0xd, W => W.objects.set('x', { kind: 'other', id: 'x', script: 236, vars: new Int16Array(8), flags28: 0 }));
    ok(e.calls.length === 0 && e.warns.some(m => /0x125 .*no \+0x90 position/.test(m)), `0x125 on an object with no position: not played (${e.calls.length} sounds), warned`);
  }
  // t68 (script 70) enter: 0x125 to record 126's object (cmd 0x3a; n025, not active) with r1 15000 -> its placement pos
  const r126 = data.records[126];
  const f = run(data, 't68', 0xd);
  const c = f.calls.find(x => near(x.pos, r126.pos.slice(0, 3)));
  ok(!!c && c.range === 15000, `t68 enter (script 70): ${c ? `${c.name} range ${c.range} at record 126's placement` : 'no sound at record 126'} (${f.calls.map(x => x.name)})`);
}

// ---- cmd 0x13a (worker 0178): FUN_0055a6d8(a, r0 path, r1 first node, r2 last node) -> FUN_00352cb8 node range
{
  const PM = await import(pathToFileURL(path.join(here, 'path_mover.js')).href);
  const p = data.paths && data.paths.find((q, i) => q && q.n > 3 && !((q.flags >> 3) & 1) && (q.idx = i, true));
  if (!p) ok(false, 'a stage path with > 3 nodes');
  else for (const [first, last, wn, wl] of [[1, 2, 1, 2], [1, -1, 1, (p.flags & 1) ? -1 : p.n - 1], [p.n + 3, p.n + 3, p.n - 1, (p.flags & 1) ? -1 : p.n - 1]]) {
    const a = { pos: [0, 0, 0], face: [0, 0, 1], C: { mover: 0, f1c4: 0, f1c0: 0, dur: 0, spd: 50 } };
    PM.pathStart(a, data.paths, p.idx, 5, () => {}, first, last);
    ok(a.C.path === p.idx && a.C.node === wn && a.C.last === wl, `pathStart(path ${p.idx}, ${first}, ${last}): node ${a.C.node} (${wn}) last ${a.C.last} (${wl})`);
  }
  if (p) { // through the script command: record 46's actor, send 0x13a (path, 1, 2, r3 1) vs 0x131 (path)
    const W = AI.createEnemyAI({ data, player: { pos: [0, 0, 0], hp: 780, id: 0x16, f118: 0, s64: 0 }, quiet: true, rand: () => 0.5 });
    const a = W.addActor({ rec: 46, astate: 1, mode: 0 });
    W.t.send(a, -2, 0x13a, [p.idx, 1, 2, 1]);
    const g1 = [a.C.path, a.C.node, a.C.last, a.C.mover];
    W.t.send(a, -2, 0x131, [p.idx, 0, 0, 0]);
    const g2 = [a.C.path, a.C.node, a.C.last];
    ok(g1.join() === `${p.idx},1,2,1` && g2.join() === `${p.idx},0,${(p.flags & 1) ? -1 : p.n - 1}`,
      `cmd 0x13a (path ${p.idx}, 1, 2): [path, node, last, mover] ${g1} (${p.idx},1,2,1); cmd 0x131 after it: ${g2}`);
  }
}

// ---- trace evidence (optional): w174_pain_a f952 and w172_sound3 f789
const OUT = path.join(here, '../../tools/trace/out');
const TA = path.join(OUT, 'w174_pain_a.calls.jsonl'), TS = path.join(OUT, 'w172_sound3.calls.jsonl');
if (!existsSync(TA)) console.log('SKIP trace part: no tools/trace/out/w174_pain_a.calls.jsonl (tools/trace/scripts/w174_pain_a.json)');
else {
  const E = readFileSync(TA, 'utf8').trim().split('\n').map(l => JSON.parse(l)).filter(e => e.hook);
  const i = E.findIndex(e => e.hook === 'script_rand');
  const word = E.slice(0, i).reverse().find(e => e.hook === 'draw');
  const gate = E.find(e => e.hook === 'cue_gated');
  // FUN_0040b5c0: 1.(mantissa of the tempered word) - 1
  const r = Math.fround(new Float32Array(new Uint32Array([((word.v0 >>> 0) & 0x7fffff) | 0x3f800000]).buffer)[0] - 1);
  ok(Math.abs(r - E[i].f0) < 1e-6, `w174_pain_a f${E[i].frame}: word 0x${(word.v0 >>> 0).toString(16)} -> r ${r.toFixed(6)} (game ${E[i].f0})`);
  ok(E.findIndex(e => e.hook === 'cue' && e.a1 === 0x44) < i && gate.a1 === 0x4c && parseInt(gate['a0+0x810'].u[0], 16) === 359,
    `order: cue 0x44, then the gated 0x4c (C+0x810 ${parseInt(gate['a0+0x810'].u[0], 16)} = save 359), rand inside it`);
  const w = world([r]);
  w.shot();
  const played = E.some(e => e.hook === 'play_name' && e.frame >= E[i].frame && e.frame <= E[i].frame + 1 &&
    Buffer.from(e['a1+0x0'].u.flatMap(h => [...new Uint8Array(new Uint32Array([parseInt(h, 16)]).buffer)])).toString('latin1').startsWith('bt_'));
  ok(!played && w.calls.length === 0, `f${E[i].frame}: rand_i ${Math.trunc(Math.fround(7 * r))} -> no voice (game: ${played ? 'a voice' : 'none'}; page: ${w.calls.map(c => c.name).join(',') || 'none'})`);
}
if (existsSync(TS)) {
  const E = readFileSync(TS, 'utf8').trim().split('\n').map(l => JSON.parse(l)).filter(e => e.hook === 'play_name');
  const nm = e => Buffer.from(e['a1+0x0'].u.flatMap(h => [...new Uint8Array(new Uint32Array([parseInt(h, 16)]).buffer)])).toString('latin1').split('\0')[0];
  const v = E.filter(e => nm(e).startsWith('bt_v'));
  ok(v.length === 1 && v[0].frame === 789 && nm(v[0]) === 'bt_v002', `w172_sound3: one voice, ${v.map(e => nm(e) + ' f' + e.frame)} (bt_v002 f789: a draw in [2/7, 3/7); f1011's hit none)`);
}
done();
