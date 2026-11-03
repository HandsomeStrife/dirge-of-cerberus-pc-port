// The section-stat counters during play (worker 0232; notes/results-research.md "The counters"), enemy_ai.js's hooks
// against the game's call log (tools/trace/out/w232/r02_barrier.calls.jsonl: TRACE_CALLLOG=results over
// w217_r02_barrier from r02_walkway): per lethal shot the game adds stat 1 (FUN_00577480), then 0 (Vincent's vt+0x31c
// FUN_005726e0), then 2 (FUN_00554ea8); 3 with the bullet's +0x120 0x40000 (zone flag 8); a soldier's hit on Vincent
// adds 8 = the damage (FUN_0055c7f8).
//   node native/web/test_results_counters.mjs [enemy_ai.js]     (SKIP without data/enemies, data/aim)
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { modelPose, boneRows } from './enemy_hit.js';
import { SectionStats } from './results.js';

const here = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(here, '../..');
const AI = await import(pathToFileURL(path.resolve(process.argv[2] || path.join(here, 'enemy_ai.js'))).href);
const OUT = process.env.TRACE_OUT ?? path.join(root, 'tools/trace/out');
let fail = 0, n = 0;
const ok = (c, m) => { n++; if (!c) fail++; console.log((c ? 'ok   ' : 'FAIL ') + m); };
const done = () => { console.log(fail ? `${fail} FAILED of ${n}` : `all ok (${n})`); process.exit(fail ? 1 : 0); };
const D = p => path.join(here, 'data', p);
const need = [D('enemies/ai.json'), D('enemies/e027.json'), D('enemies/e027_local.bin'), D('aim/weapon.json')];
if (!need.every(existsSync)) { console.log('SKIP: data/enemies or data/aim missing (tools/byo/build_web.sh)'); done(); }
const json = p => JSON.parse(readFileSync(p, 'utf8'));
const f32 = p => { const b = readFileSync(p); return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4); };
const data = json(D('enemies/ai.json')), W = json(D('aim/weapon.json'));
const e027 = json(D('enemies/e027.json')).local_pose, e027d = f32(D('enemies/e027_local.bin'));

// the game's order, from the call log (the stat ids only; game-derived file, gitignored)
const logPath = path.join(OUT, 'w232/r02_barrier.calls.jsonl');
let gameOrder = null;
if (existsSync(logPath)) {
  const L = readFileSync(logPath, 'utf8').trim().split('\n').map(l => JSON.parse(l)).filter(e => e.hook === 'stat_add');
  gameOrder = L.map(e => parseInt(e.a0, 16));
  ok(gameOrder.join() === '8,1,0,2,8,1,0,52,2,3', `game log (r02_barrier): stat adds ${gameOrder.join()}`);
} else console.log('SKIP game order: no ' + logPath);

function world(stats) {
  const php = { pos: [0, 0, 0], hp: 780, id: 0x16, f118: 0, s64: 0 };
  const ai = AI.createEnemyAI({ data, player: php, quiet: true, log: () => {}, damage: true, stats });
  const a = ai.addActor({ rec: 45, mode: 0, pos: [0, 0, 0], face: [0, 0, 1], clip: 'r_st_a' });
  const P0 = modelPose(e027, e027d, 'r_st_a', 0);
  ai.boneWorld = () => b => boneRows(P0.R[b], P0.S[b], P0.P[b], a.pos, a.face);
  return { ai, a, php };
}
const straight = { ...W, spread: null, pellets: 1 };
const run = ai => { for (let i = 0; i < 6; i++) ai.tick(1.2, [0, 0, 0], [0, 0, 0]); };

// a near miss, a hit, a kill
{
  const st = new SectionStats(null);
  const { ai, a } = world(st);
  ai.playerShot([4.5, -9, -60], [4.5, -9, 60], straight); run(ai);
  ok(st.log.map(e => e[1]).join() === '1', `near miss: stat adds ${st.log.map(e => e[1]).join()} (1: the shot only)`);
  st.log.length = 0;
  ai.playerShot([0, -9, -60], [0, -9, 60], straight); run(ai);
  ok(a.hp < 100 && st.log.map(e => e[1]).join() === '1,2', `body hit (HP ${a.hp}): stat adds ${st.log.map(e => e[1]).join()} (1, 2)`);
  st.log.length = 0;
  ai.playerShot([0, -9, -60], [0, -9, 60], { ...straight, damage: 9999 }); run(ai);
  const order = st.log.map(e => e[1]).join();
  ok(a.hp === 0 && order === '1,0,2', `lethal hit: stat adds ${order} (the game's order 1, 0, 2; kill chain 52 not on the page)`);
  ok(st.get(0) === 1 && st.get(1) === 3 && st.get(2) === 2 && st.get(10) === 66, `stats: kills ${st.get(0)}, shots ${st.get(1)}, hits ${st.get(2)}, accuracy ${st.get(10)}% (pct(2, 3) = 66)`);
}
// a critical hit: a part whose zone record has flag 8 (FUN_0055db50: +0x120 |= 0x60000) -> stat 3
{
  let found = null;
  for (let y = -20; y <= 0 && !found; y += 0.5) {
    const st = new SectionStats(null);
    const { ai, a } = world(st);
    ai.playerShot([0, y, -60], [0, y, 60], straight); run(ai);
    if (a.f19c && (a.f19c.flags & 8)) found = { y, st, dead: a.hp === 0 };
  }
  ok(!!found, 'a zone-flag-8 part found along the soldier\'s axis' + (found ? ` (y ${found.y})` : ''));
  // lethal at the head here: 1, 0, 2, 3 = the game's last logged shot (f296..f301) without its kill chain 52
  if (found) ok(found.st.log.map(e => e[1]).join() === (found.dead ? '1,0,2,3' : '1,2,3'), `critical hit${found.dead ? ' (lethal)' : ''}: stat adds ${found.st.log.map(e => e[1]).join()}`);
}
// Vincent hit by a soldier's bullet: FUN_0055c7f8 -> stat 8 += the damage
{
  const st = new SectionStats(null);
  const { ai, a, php } = world(st);
  const hp0 = php.hp;
  ai.t.damagePlayer({ from: a, damage: 44, kind: 0, dir: [0, 0, 1], pos: [0, -9, 0], hit: 0, f148: 0 });
  ok(st.get(8) === hp0 - php.hp && st.get(8) > 0, `damage taken: stat 8 = ${st.get(8)} (HP ${hp0} -> ${php.hp})`);
}
// no stats object: nothing breaks
{
  const { ai } = world(undefined);
  ai.playerShot([0, -9, -60], [0, -9, 60], { ...straight, damage: 9999 }); run(ai);
  ok(true, 'no opts.stats: the hooks are silent');
}
done();
