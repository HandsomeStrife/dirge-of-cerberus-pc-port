// worker 0264: the whole-level run's freeze (test_level_run_page, chunk 03 after the first dog; the same scene as Dan's market crash report).
// An actor with a target has +0x118 bits 0, 1 and +0x11c = the target (FUN_00562f50). FUN_00559748 (off) leaves them, and +0x120 (FUN_00558790: (0, 0, 0, 1)),
// so an actor switched off by its area and on again still has its target (FUN_00563200). The page kept the bits but dropped the target and +0x120: then
// FUN_00360558 -> FUN_00563438 read a null aim, shot() threw inside the AI scheduler before its timer left the list, and every later frame threw too:
// the world stopped. Also FUN_00562f50 with no target clears BOTH bits (the page cleared bit 1). Run: node test_actor_reactivate_shot.mjs
import { readFileSync } from 'node:fs';
import { createEnemyAI } from './enemy_ai.js';
import { initWorld } from './checkpoint.js';

const here = new URL('.', import.meta.url).pathname;
const data = JSON.parse(readFileSync(here + 'data/enemies/ai.json', 'utf8'));
let fails = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const mk = () => { const player = { pos: [-1395, -99, -1110], hp: 780, id: 0x16, f118: 0, s64: 0 };
  const W = initWorld(o => createEnemyAI({ data, player, quiet: true, log: () => {}, ...o }), { flags: {}, frame: 24, clock: {}, loadRecs: [] });
  W.tick(1.2, player.pos, player.pos); return { W, player }; };
const rec = data.records[50];

{ const { W, player } = mk();
  player.pos = [rec.pos[0] - 30, rec.pos[1], rec.pos[2]];
  const a = W.addActor({ rec: 50, mode: 2 });
  W.addActor({ rec: 45 });                                      // idle, keeps the brain queue and fireTimers running
  let targeted = false;
  for (let i = 0; i < 300 && !targeted; i++) { W.tick(1.0, player.pos, player.pos); targeted = !!(a.f118 & 2); }
  ok(targeted && (a.f118 & 1) && !!a.aim120, `it took a target: +0x118 ${a.f118 & 3}, +0x120 ${a.aim120 && a.aim120.map(Math.round)}`);
  const kept = a.aim120.slice();
  W.setActive(a, 0);
  ok(W.objects.get(a.id).kind === 'record' && W.objects.get(a.id).f118 & 1, 'off: the record keeps bit 0');
  W.setActive(W.objects.get(a.id), 1);
  const b = W.actors.find(x => x.rec === 50);
  ok(b && (b.f118 & 3) === 3 && b.target === player, `on again: bits 0, 1 and the target kept (FUN_00559748) (${b && b.f118 & 3}, ${b && b.target === player})`);
  ok(b && b.aim120 && b.aim120.every((v, i) => v === kept[i]), `on again: +0x120 is the kept point (${b && b.aim120 && b.aim120.map(Math.round)})`);
  // a shot request (FUN_003605d8): the line that threw. His burst's timer calls it whatever brought him back on
  let threw = null;
  try { W.shotOf(b.ai); } catch (e) { threw = e; }
  ok(!threw, `the reactivated soldier's shot does not throw${threw ? ': ' + threw.message : ''}`);
  const tp = W.aimPointOf(b);
  ok(tp && Math.hypot(tp[0] - player.pos[0], tp[2] - player.pos[2]) < 5, `it aims at his target (${tp && tp.map(Math.round)}, Vincent ${player.pos.map(Math.round)})`);
}
// FUN_00562f50 with no target: both bits clear, so FUN_00563438 aims along his facing, not at the kept point
{ const { W, player } = mk();
  player.pos = [rec.pos[0] - 30, rec.pos[1], rec.pos[2]];
  const a = W.addActor({ rec: 50, mode: 2 });
  W.addActor({ rec: 45 });
  for (let i = 0; i < 300 && !(a.f118 & 2); i++) W.tick(1.0, player.pos, player.pos);
  W.setTargetOf(a.ai, null);
  ok((a.f118 & 3) === 0 && a.target === null, `target gone: +0x118 bits 0, 1 clear (${a.f118 & 3})`);
  W.tick(1.0, player.pos, player.pos);
  const p = W.aimPointOf(a), want = [0, 1, 2].map(k => a.pos[k] + a.face[k] * 1000);
  ok(a.f118 & 2 || (p && p.every((v, k) => Math.abs(v - want[k]) < 1e-3)), `no target: the aim is 1000 along his facing (FUN_00563438 bit 0 clear) (${p && p.map(Math.round)})`);
}
{ const { W } = mk();                                           // FUN_00558790: a new object's +0x120
  const a = W.addActor({ rec: 50 });
  ok(a.aim120 && a.aim120.join() === '0,0,0', `a new actor's +0x120 = (0, 0, 0) (${a.aim120})`); }
console.log(fails ? `${fails} FAILED` : 'all ok');
process.exit(fails ? 1 : 0);
