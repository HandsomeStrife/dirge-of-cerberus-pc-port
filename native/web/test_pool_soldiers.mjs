// worker 0268: the soldiers by cardkey 2 come out when Vincent walks south past triggers 87 and 85 (Dan: "soldiers near the card key don't
// activate"). Trigger 87 (script 131): manager short 50 = 4, 52 = 0. Trigger 85 (script 125): message 1 to records 33-40. Their script 124
// event 2: while short 50 > 0 and the record is off (cmd 0x177), 50 - 1, then on itself 0x40 / 0x10e (locator 0), 0x14a, 0x108 (the wake),
// 0x14c, a random free slot short 53-61 -> var 7 and cmd 0x131 path 20 / 22 / 24 / 24 / 25 .. 29. The page swapped the record for a new actor
// at 0x108 and sent the script's later "own object" (-2) commands to the old record, so 0x131 was dropped and all four stood at locator 0.
// FUN_00370b40: -2 is the host's object id, looked up per send. T: w268_key2_stand (route state r05_key2, PCSX2): the path-20 soldier
// stands at (-1929, 0, 945) = path 20's last node, in brain mode 5. Run: node test_pool_soldiers.mjs
import { readFileSync } from 'node:fs';
import { createEnemyAI } from './enemy_ai.js';
import { initWorld } from './checkpoint.js';

const here = new URL('.', import.meta.url).pathname;
const data = JSON.parse(readFileSync(here + 'data/enemies/ai.json', 'utf8'));
let fails = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const POOL = [33, 34, 35, 36, 37, 38, 39, 40];
const PATH_OF = { 1: 20, 2: 22, 3: 24, 4: 24, 5: 25, 6: 26, 7: 27, 8: 28, 9: 29 };   // script 124 event 2's switch: slot short 52 + var 7 -> 0x131 path
const player = { pos: [-1931, 0, 992], hp: 780, id: 0x16, f118: 0, s64: 0 };          // r05_key2's spot (T)
const W = initWorld(o => createEnemyAI({ data, player, quiet: true, log: () => {}, ...o }), { flags: {}, frame: 24, clock: {}, loadRecs: [] });
const log = [];
const tick = (a = player.pos, b = player.pos) => { W.tick(1.2, a, b); log.push(...W.events); };
tick();
// Vincent's walk: a segment along each trigger's thin local z (feet 5 above the box floor; enemy_ai tests feet + 7 up)
const cross = (i) => { const m = data.triggers[i].m, c = m[3], z = m[2];
  const a = [0, 1, 2].map(k => c[k] - 10 * z[k] + (k === 1 ? 2 : 0)), b = [0, 1, 2].map(k => c[k] + 10 * z[k] + (k === 1 ? 2 : 0));
  tick(a, a); tick(a, b); };
const on = () => POOL.filter(r => { const o = W.objects.get(r + 22); return o && o.kind === 'actor' && (o.flags28 & 1); });
ok(on().length === 0, `none of 33-40 up before the walk (${on()})`);
cross(87);
ok(W.mshort[50] === 4 && W.mshort[52] === 0, `trigger 87: short 50 = 4, 52 = 0 (${W.mshort[50]}, ${W.mshort[52]})`);
cross(85);
tick();                                                                   // message 1 lands as event 2 on the next frame (mailbox)
const up = on();
ok(up.join() === '33,34,35,36', `trigger 85: four come out, the first four records (${up})`);
ok(W.mshort[50] === 0 && W.mshort[52] === 1, `short 50 used up, 52 = 1 (${W.mshort[50]}, ${W.mshort[52]})`);
const loc0 = data.locators[0].m.slice(12, 15);
const paths = up.map(r => { const o = W.objects.get(r + 22), p = PATH_OF[o.vars[7]], e = log.find(x => x.startsWith(`path ${o.id} `)); return { r, o, p, e }; });
for (const { r, o, p, e } of paths) ok(p != null && e === `path ${o.id} ${p}`, `${r}: slot var 7 = ${o.vars[7]}, on path ${p} (${e || 'no path event'})`);
const end = p => data.paths[p].nodes.at(-1).pos;
const best = new Map(paths.map(x => [x.r, Infinity]));
for (let f = 0; f < 600; f++) {
  tick();
  for (const { r, o, p } of paths) if (p != null) { const q = end(p); best.set(r, Math.min(best.get(r), Math.hypot(o.pos[0] - q[0], o.pos[2] - q[2]))); }
}
for (const { r, o } of paths) ok(Math.hypot(o.pos[0] - loc0[0], o.pos[2] - loc0[2]) > 20, `${r}: left locator 0 (${o.pos.map(v => v.toFixed(0))})`);
for (const { r, p } of paths) ok(best.get(r) < 1.0, `${r}: reached path ${p}'s end (closest ${best.get(r).toFixed(3)} u)`);
// T w268_key2_stand f0: the path-20 soldier (record 37 there) at (-1929.0, -0.0, 945.0); path 20's last node (-1928.28, 944.96)
const q20 = end(20);
ok(Math.hypot(q20[0] + 1928.6, q20[2] - 945.0) < 1.0, `path 20 ends where the game's path-20 soldier stands (${q20[0].toFixed(2)}, ${q20[2].toFixed(2)})`);
// The same pattern on the beast soldiers of beast_ev01 (records 8 / 9, e030, script 217): trigger 166's event 0x18 (script 220, shorts
// 71 / 72 = 1) sends message 0 to record 9 (record 8 on hard: 0xa6); its event 2 puts itself at locator 20 (0x40 / 0x10e), 0x193,
// wakes itself (0x108), then 0x16e(1), 0x11a(0), 0x193, 0x143(3): brain mode 3. Without the per-send lookup the mode went to the old
// record and the woken soldier kept its placement mode (0).
{
  const o9 = W.objects.get(9 + 22);
  ok(o9 && o9.kind === 'record' && !(o9.flags28 & 1), 'record 9 (e_BestB2) off before its message');
  W.runEvent(o9, 2, [0, 0, 0, 0]);                                         // the receiver's event 2, as the mailbox delivers message 0
  const a9 = W.objects.get(9 + 22);
  ok(a9 && a9.kind === 'actor' && (a9.flags28 & 1), `record 9 woken by its own 0x108 (${a9 && a9.kind})`);
  ok(a9 && a9.ai && a9.ai.mode === 3, `record 9: its 0x143(3) after the wake reaches the new actor: brain mode ${a9 && a9.ai && a9.ai.mode} (3)`);
  const l20 = data.locators[20].m.slice(12, 15);
  ok(a9 && Math.hypot(a9.pos[0] - l20[0], a9.pos[2] - l20[2]) < 0.01, `record 9 built at locator 20 (${a9 && a9.pos.map(v => v.toFixed(1))})`);
}
console.log(fails ? `${fails} FAILED` : 'all ok');
process.exit(fails ? 1 : 0);
