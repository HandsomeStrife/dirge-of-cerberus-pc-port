// Game-state bit 6 (AI paused: Zone.peace, the stage-info boxes; game_state.js) in enemy_ai.js (worker 0220):
//   FUN_00365008 returns at once (the AI clock stops: w220_box, clock 1821 from f206 to f457), FUN_00569dc0 makes no
//   melee attack object, FUN_0055c7f8 changes no HP. Each check has its counterfactual with the bit clear.
//   node --import ./native/web/test_hooks.mjs native/web/test_ai_pause.mjs      (MUTATE_AI = a mutated enemy_ai.js copy)
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const imp = (env, rel) => import(process.env[env] ? pathToFileURL(path.resolve(process.env[env])).href : './' + rel);
const { createEnemyAI } = await imp('MUTATE_AI', 'enemy_ai.js');
const GS = await import('./game_state.js');
let fail = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };
const done = () => { console.log(fail ? `${fail} FAILED` : 'all ok'); process.exit(fail ? 1 : 0); };
const STEP = 1.1999999284744263;
const dataPath = path.join(here, 'data/enemies/ai.json');
if (!existsSync(dataPath)) { console.log('SKIP: no data/enemies/ai.json'); done(); }
const data = JSON.parse(readFileSync(dataPath, 'utf8'));

function world() {
  const rec = data.records[44];
  const player = { pos: [rec.pos[0] - 300, rec.pos[1], rec.pos[2]], face: [1, 0, 0], hp: 780, id: 0x16, f118: 0x20209, s64: 0 };
  const W = createEnemyAI({ data, player, rand: () => 0.5, damage: true, quiet: true, log: () => {} });
  const a = W.addActor({ rec: 44, mode: 2, hp: 50, astate: 1 });
  return { W, a, player };
}

for (const paused of [true, false]) {
  const tag = paused ? 'bit 6 set' : 'bit 6 clear (counterfactual)';
  GS.reset();
  const { W, a, player } = world();
  if (paused) GS.set(GS.AI_PAUSED);
  // FUN_00365008: the clock
  const t0 = W.S.now;
  for (let i = 0; i < 30; i++) W.tick(STEP, player.pos, player.pos);
  ok(paused ? W.S.now === t0 : W.S.now > t0, `${tag}: AI clock ${t0} -> ${W.S.now}`);
  // FUN_00569dc0: the melee attack object (the record's attack table, its first hit volume)
  const T = data.attacks[data.records[44].zones];
  const n0 = W.attackObjs.length;
  if (T && T.volumes && T.volumes.length) {
    W.t.makeAttack(a, T, 0);
    ok(paused ? W.attackObjs.length === n0 : W.attackObjs.length === n0 + 1, `${tag}: makeAttack -> ${W.attackObjs.length - n0} attack object(s)`);
  } else ok(false, 'record 44 has no attack table with a hit volume');
  // FUN_0055c7f8 on a soldier (enemyHP through the explosion path: FUN_0055e498)
  const hp0 = a.hp;
  W.blast.actor(a, { dmg: 10, kind: 0, owner: -1 }, a.pos.slice(), [1, 0, 0]);
  ok(paused ? a.hp === hp0 : a.hp < hp0, `${tag}: soldier HP ${hp0} -> ${a.hp}`);
}
GS.reset();
done();
