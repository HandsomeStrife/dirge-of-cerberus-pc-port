// Walkway "blockers" (worker 0221). Worker 0217's route walker reported that the game stops Vincent at
// x ~ -1001 on the chunk-02 walkway and at (-868, -160, -1085) at its end, where the page lets him through.
// Neither stop is in the game: both were the walker flipping its target between two waypoints (fixed in
// tools/trace/route.py; notes/route-states.md). These PCSX2 traces push straight through both spots.
// The test replays the game's own moves through the page's walk-mesh walker: per frame, the call log
// gives FUN_00357d48's input move (walk_move a1, logged at the call from FUN_003590c8) and the body
// position before it, and body_step (FUN_003590c8 from FUN_0034c388, copied after the call) gives the
// position after. collision.js navMove (the FUN_00357d48 translation) must land where the game did, and
// must slide (hit) exactly where the game's displacement differs from its input move. Then the page blocks him exactly where the game
// does on this stretch: nowhere at x -1001 or at the walkway's end.
//   node --import ./test_hooks.mjs test_walkway_stops.mjs
// Traces are game-derived (tools/trace/out, gitignored); missing ones are skipped. Record them with
// TRACE_CALLLOG=pushstep and tools/trace/scripts/w221_{walk1x,stop1,ne}.json (the state is in each note).
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const WEB = process.env.WEB ?? path.dirname(fileURLToPath(import.meta.url));
const OUT = process.env.TRACE_OUT ?? path.join(WEB, '../../tools/trace/out');
const { Collision } = await import(path.join(WEB, 'collision.js'));

const buf = readFileSync(path.join(WEB, 'data/z128_collision.bin'));
const col = new Collision(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
// w221_walk1x frames 51-58 (sliding along the edge of page poly 65, x -957..-949): the game's slide is up
// to 0.017 u longer or shorter per frame than navMove's, with the same input and the same hit; not
// decoded (open in notes/route-states.md). Everywhere else here the error is < 3e-4.
const POS_TOL = 0.02;

// to: frames replayed (before the first button press); cross: an x the game and page must both pass
const CASES = [
  { name: 'w221_walk1x', to: 70, cross: -1001, note: 'r02_walkway, stick up, through x -1001' },
  { name: 'w221_stop1', to: 90, cross: -1001, note: 'r02_barrier (gun up), stick up, through x -1001' },
  { name: 'w221_ne', to: 140, cross: -860, note: 'r02_corridor, stick NE, on past (-868, -1085)' },
];

function replay(name, to) {
    // Python's json writes NaN (unused float views of pointer words); JSON.parse needs null there
  const J = l => JSON.parse(l.replace(/\bNaN\b|-?Infinity\b/g, 'null'));
  const [, ...E] = readFileSync(path.join(OUT, name + '.calls.jsonl'), 'utf8').trim().split('\n').map(J);
  let n = 0, maxPos = 0, hitBad = 0, gameX = -Infinity, pageX = -Infinity, moved = 0;
  for (let i = 0; i < E.length; i++) {
    const w = E[i];
    if (w.hook !== 'walk_move' || w.frame >= to) continue;
    const s = E.slice(i + 1).find(e => e.frame === w.frame && e.hook === 'body_step');
    if (!s) continue;
    const p0 = w['a0+0x0'].f, mv = w['a1+0x0'].f, p1 = s['a0+0x0'].f;
    const f = col.locate(p0[0], p0[1], p0[2]);
    if (f === null) throw new Error(`${name} f${w.frame}: no page polygon under the game's position`);
    const r = col.navMove(f[0], p0[0], p0[1], p0[2], mv[0], mv[2], false);
    const e = Math.hypot(r[0] - p1[0], r[2] - p1[2]);
    maxPos = Math.max(maxPos, e); n++;
    moved += Math.hypot(p1[0] - p0[0], p1[2] - p0[2]);
    // the game slid (or stopped) when its displacement differs from the input move
    const gHit = Math.hypot(p1[0] - p0[0] - mv[0], p1[2] - p0[2] - mv[2]) > 0.005;
    if (gHit !== r[4]) hitBad++;
    if (process.env.DEBUG && (gHit !== r[4] || e > 1e-3)) console.log(name, w.frame, 'hit game/page', gHit, r[4], '|pos|', e);
    gameX = Math.max(gameX, p1[0]); pageX = Math.max(pageX, r[0]);
  }
  return { n, maxPos, hitBad, gameX, pageX, moved };
}

let fails = 0, ran = 0;
for (const c of CASES) {
  if (!existsSync(path.join(OUT, c.name + '.calls.jsonl'))) { console.log(`skip ${c.name} (no trace)`); continue; }
  const r = replay(c.name, c.to); ran++;
  const ok = r.n > 20 && r.maxPos <= POS_TOL && r.hitBad === 0 && r.gameX > c.cross && r.pageX > c.cross;
  if (!ok) fails++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${c.name.padEnd(12)} ${c.note}: ${r.n} moves, ${r.moved.toFixed(1)} u, ` +
              `max x game ${r.gameX.toFixed(2)} page ${r.pageX.toFixed(2)}, max |pos| ${r.maxPos.toExponential(2)}, hit mismatches ${r.hitBad}`);
}
console.log(ran ? (fails ? `${fails} FAILED` : 'all passed') : 'no traces found');
process.exit(fails ? 1 : 0);
