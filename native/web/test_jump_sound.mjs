// Vincent's jump sounds (worker 0277; notes/jump-research.md "Sounds"). FUN_00598f50 (jump class 0x20) phase 0: FUN_00341410(C, 2)
// (the take-off step by floor material) or, for the second jump, FUN_00341268(C, 'bsj_520') ('bsj_525' with bVar1), then
// FUN_003412d0(C, 0x50, 1) (cue 0x50 = bt_v010, forced). FUN_005a1510 (the back jump 0x59): 'bsj_521' / 'bsj_522' (second) /
// 'bsj_525' (bVar1), then the same cue. FUN_00599aa0 (landing 0x21): FUN_00341410(C, 3) and FUN_003412d0(C, 0x51, 0) (cue 0x51
// is ''). T w277_jump (call log w277jump): f11 fsj_026 + bt_v010, f53 fsj_038, f141 (second) bsj_520 + bt_v010, f190 fsj_038.
// Every named one goes FUN_0054b158(P, name, 1): at P + (0, -P+0x30 x 0.5, 0) (body y - 9 in the trace).
//   node native/web/test_jump_sound.mjs [jump_core.js] [enemy_ai.js] [ambient.js]
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const mod = (i, f) => import(pathToFileURL(path.resolve(process.argv[i] || path.join(here, f))).href);
const J = await mod(2, 'jump_core.js'), AI = await mod(3, 'enemy_ai.js'), AM = await mod(4, 'ambient.js');
let fail = 0, n = 0;
const ok = (c, m) => { n++; if (!c) fail++; console.log((c ? 'ok   ' : 'FAIL ') + m); };
const done = () => { console.log(fail ? `${fail} FAILED of ${n}` : `all ok (${n})`); process.exit(fail ? 1 : 0); };

// ---- the classes' phase 0 calls (a recorder in place of play.js ctrl.jumpSound)
const rec = (wet = false) => { const c = []; return { c, wet, name: x => c.push('name ' + x), foot: k => c.push('foot ' + k), cue: (x, f) => c.push(`cue ${x.toString(16)} ${f}`) }; };
const run = (m, io) => { const s = rec(io.wet); m.update({ ground: true, clipEnded: false, armed: false, groundSpeed: 0, sound: s, ...io }); return s.c.join(', '); };
ok(run(new J.JumpMotion(false), {}) === 'foot 2, cue 50 1', `jump: ${run(new J.JumpMotion(false), {})} (FUN_00341410(C, 2), cue 0x50 forced)`);
ok(run(new J.JumpMotion(false), { armed: true }) === 'foot 2, cue 50 1', 'jump with the gun drawn: the same sounds');
ok(run(new J.JumpMotion(true), {}) === 'name bsj_520, cue 50 1', `second jump: ${run(new J.JumpMotion(true), {})} (0x5a3b50)`);
ok(run(new J.JumpMotion(true), { wet: true }) === 'name bsj_525, cue 50 1', 'second jump with bVar1: bsj_525 (0x5a3b48)');
ok(run(new J.BackJumpMotion(false), {}) === 'name bsj_521, cue 50 1', `back jump: ${run(new J.BackJumpMotion(false), {})} (0x5a3d38)`);
ok(run(new J.BackJumpMotion(true), { usable: () => true }) === 'name bsj_522, cue 50 1', 'second back jump (slot 0xe0 usable): bsj_522 (0x5a3d30)');
ok(run(new J.BackJumpMotion(true), { usable: () => false }) === 'name bsj_521, cue 50 1', 'second back jump without slot 0xe0: bsj_521 (bVar2 false)');
ok(run(new J.LandMotion(), {}) === 'foot 3, cue 51 0', `landing: ${run(new J.LandMotion(), {})} (FUN_00341410(C, 3), cue 0x51 gated)`);
{ // phase 0 only: the next updates play nothing
  const m = new J.JumpMotion(false), s = rec();
  for (let i = 0; i < 40; i++) m.update({ ground: i > 20, clipEnded: true, armed: false, groundSpeed: 0, sound: s });
  ok(s.c.length === 2, `one take-off per jump (${s.c.length} calls over 40 updates)`);
}

// ---- the names, from the data (cue table 9, material map DAT_004a1920)
const ambPath = path.join(here, 'data/audio/ambient_z128.json'), aiPath = path.join(here, 'data/enemies/ai.json');
if (!existsSync(ambPath) || !existsSync(aiPath)) { console.log('SKIP (data): data/audio/ambient_z128.json or data/enemies/ai.json missing'); done(); }
const amb = JSON.parse(readFileSync(ambPath, 'utf8')), data = JSON.parse(readFileSync(aiPath, 'utf8'));
const foot = amb.foot, mat = foot.mat_map.indexOf(2);   // the floor of the w277_jump spot: material 2 (fsj_026 = row 2, column 2)
const nm = k => foot.cues[AM.kindCue(foot, mat, k, amb.version)];
ok(nm(2) === 'fsj_026' && nm(3) === 'fsj_038', `kind 2 / 3 on material 2: ${nm(2)} / ${nm(3)} (T: fsj_026 / fsj_038)`);
ok(AM.kindCue(foot, foot.mat_map.indexOf(0), 2, amb.version) === 0x20, 'kind 2 on material 0: cue 0x20 (jump table 0x4a1960: kind x 16 + m)');
ok(AM.footCue(foot, mat, 2, amb.version) === AM.kindCue(foot, mat, 1, amb.version), 'footCue (gait 2 = run) = kindCue kind 1');

// ---- cue 0x50 through the AI world: bt_v010 at mid-height; its gate C+0x810 shared with the hit voice
{
  const calls = [];
  const player = { pos: [-1395.1516, -98.6444, -1111.0149], hp: 780, id: 0x16, f118: 0, s64: 0 };
  const W = AI.createEnemyAI({ data, player, quiet: true, damage: true, rand: () => 0.1, sound: (name, pos) => calls.push({ name, pos: pos && pos.slice() }) });
  ok(typeof W.playerCue === 'function', 'the world exports playerCue (FUN_003412d0)');
  const c0 = player.c810;
  W.playerCue(0x50, 1);
  const c = calls[0];
  ok(c && c.name === 'bt_v010' && c.pos[0] === player.pos[0] && c.pos[2] === player.pos[2] && Math.abs(c.pos[1] - -107.6444) < 1e-3,
    `cue 0x50: ${c && c.name} at y ${c && c.pos[1]} (T w277_jump f111: bt_v010 at -107.6444 = body -98.6444 - 9)`);
  ok(player.c810 !== c0 && player.c810 === W.S.mgr20, `the forced cue stamps C+0x810 (${c0} -> ${player.c810})`);
  calls.length = 0;
  W.playerCue(0x50, 1);                                 // a second take-off in the same frame (the double jump is 20+ frames on)
  ok(calls.length === 1 && calls[0].name === 'bt_v010', `forced: plays inside the 15-frame gate too (${calls.map(x => x.name)})`);
  calls.length = 0;
  W.playerCue(0x51, 0);
  ok(calls.length === 0, 'cue 0x51 (landing) plays nothing (\'\' for Vincent)');
  // a hit right after the take-off: the hit voice (cue 0x4c through the same gate) is held back
  W.t.damagePlayer({ damage: 44, kind: 1, hit: 0, f148: 0, dir: [1, 0, 0], pos: player.pos.slice(), from: { id: 66 } });
  ok(!calls.some(x => /^bt_v00[012]$/.test(x.name)), `a hit within 15 frames of the take-off: no hit voice (${calls.map(x => x.name).join(',') || 'none'})`);
}
{ // the counterfactual: the same hit with no take-off before it voices (rand 0.1 -> rand_i 0 -> bt_v000)
  const calls = [];
  const player = { pos: [-1395.1516, -98.6444, -1111.0149], hp: 780, id: 0x16, f118: 0, s64: 0 };
  const W = AI.createEnemyAI({ data, player, quiet: true, damage: true, rand: () => 0.1, sound: (name, pos) => calls.push({ name, pos: pos && pos.slice() }) });
  W.t.damagePlayer({ damage: 44, kind: 1, hit: 0, f148: 0, dir: [1, 0, 0], pos: player.pos.slice(), from: { id: 66 } });
  ok(calls.some(x => x.name === 'bt_v000'), `the same hit with no take-off before it: ${calls.map(x => x.name).join(',') || 'none'} (bt_v000)`);
}
done();
