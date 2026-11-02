// The effect hooks of the bullets (worker 0193): which effect the game spawns where, through enemy_ai.js
//   - FUN_00554ea8's bullet-end effect (FUN_00335918 W+0xb0 / FUN_00335960 W+0x80 on a floor, FUN_00335020);
//   - FUN_003361b8 on a soldier hit by Vincent (FUN_0055db50: the zone nibble, else the hit table by his class);
//   - FUN_00336478's floor test FUN_00260c38 with the game's normal (effects.js floorHit / wallImpactId).
// Expected ids and order: w193_fxsrc / w193_fxhits (notes/effects-research.md 'Bullet end'). Needs data/enemies
// (ai.json with the bullet-end fields) and data/effects/ids.json; SKIP without them.
//   node --import ./native/web/test_hooks.mjs native/web/test_effects_hooks.mjs [enemy_ai.js] [effects.js]
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const AI = await import(pathToFileURL(path.resolve(process.argv[2] || path.join(here, 'enemy_ai.js'))).href);
const FX = await import(pathToFileURL(path.resolve(process.argv[3] || path.join(here, 'effects.js'))).href);
const aiPath = path.join(here, 'data/enemies/ai.json'), idsPath = path.join(here, 'data/effects/ids.json');
if (!existsSync(aiPath) || !existsSync(idsPath)) { console.log('SKIP: data/enemies/ai.json or data/effects/ids.json missing'); process.exit(0); }
const data = JSON.parse(readFileSync(aiPath, 'utf8')), ids = JSON.parse(readFileSync(idsPath, 'utf8'));
let checks = 0, fails = 0;
const ok = (name, c, extra = '') => { checks++; if (!c) fails++; console.log(`${c ? 'ok  ' : 'FAIL'} ${name}${extra ? ' ' + extra : ''}`); };
const hex = l => l.map(([k, id]) => `${k}:${id < 0 ? id : '0x' + (id >>> 0).toString(16)}`).join(' ');

// --- effects.js: FUN_00260c38 / FUN_00336040 / FUN_003363d0 on the game's normal (y down: a floor faces -y)
{
  ok('floor (game normal (0, -1, 0)) -> table [mat x 2 + 1]: material 1 = 0x47400', FX.wallImpactId(ids, 1, [0, -1, 0]) === 0x47400);
  ok('ceiling (0, 1, 0) and walls -> [mat x 2]: 0x46400', FX.wallImpactId(ids, 1, [0, 1, 0]) === 0x46400 && FX.wallImpactId(ids, 1, [1, 0, 0]) === 0x46400);
  ok('FUN_00260c38 threshold: -y > 0.9f (y = -0.9 is a wall, -0.9000001 a floor)', !FX.floorHit([0, -0.9, 0]) && FX.floorHit([0, -0.9000001, 0]));
  const w = []; ok('no normal: no effect, warned', FX.wallImpactId(ids, 1, null, m => w.push(m)) === -1 && w.length === 1);
  ok('hit, zone nibble 0: the hit table by class (1 -> 0x41800, 3 -> 0x40c00)', FX.hitImpactId(ids, 0, 1) === 0x41800 && FX.hitImpactId(ids, 0, 3) === 0x40c00);
  ok('hit, zone nibble 3: FUN_00336040(3, 0) = wall table [6]', FX.hitImpactId(ids, 3, 1) === ids.wall[6]);
  const w2 = []; ok('hit, zone nibble < 0: no effect, warned', FX.hitImpactId(ids, -2, 1, m => w2.push(m)) === -1 && w2.length === 1);
}

// --- enemy_ai.js hooks
const player = { pos: [0, 0, 0], hp: 780, id: 0x16, f118: 0, s64: 0 };
const make = () => {
  const log = [];
  const world = AI.createEnemyAI({ data, player, quiet: true, damage: false, sound: () => {},
    effect: { wall: (mat, n, p) => log.push(['wall', FX.wallImpactId(ids, mat, n), p]), hit: (kind, cls, p) => log.push(['hit', FX.hitImpactId(ids, kind, cls), p]), spawn: (id, p) => log.push(['end', id, p]) } });
  return { world, log };
};
const W0 = data.weapons[0];
ok('ai.json: the soldiers\' record 0 has the bullet-end fields (W+0x7c 0, W+0xb0 0x41800, W+0x80 -1)', W0.bullet === 0 && W0.fx_end === 0x41800 && W0.fx_floor === -1, JSON.stringify({ b: W0.bullet, e: W0.fx_end, fl: W0.fx_floor }));
const soldier = W => ({ ai: { W, f74: 0, f78: 0 } });
const bullet = (o = {}) => ({ from: soldier(W0), start: [0, 0, 0], dir: [1, 0, 0], end: [10, 0, 0], endDist: 10, range: 515, speed: 50,
  age: 0, pos: [0, 0, 0], prev: [0, 0, 0], f120: 0x2000, delay: 0, damage: 45, hit: 6, f148: 0, kind: 0, shooter: 0x2c, mat: 1, ...o });
{
  // a soldier's bullet stopping at a room hit (+0x120 bit 0 from FUN_00553660): FUN_00554ea8 runs the wall's
  // vt+0x1b4 (FUN_0054fee0 -> FUN_00335f40: 0x46400 on material 1) and then FUN_00335918's W+0xb0 at +0xf0 = end
  // (T: w193_fxsrc f884: 0x46400, then 0x41800)
  const { world, log } = make();
  const b = bullet({ f120: 0x2001, normal: [1, 0, 0] });
  const r = world.t.bulletUpdate(b, 1.0);
  ok('room hit: wall impact, then the bullet-end effect 0x41800 at the end point', r === 1 && hex(log) === 'wall:0x46400 end:0x41800' && log[1][2].join() === '10,0,0', hex(log));
  ok('room hit: bit 0x800000 stays clear at the end point (FUN_00556068)', !(b.f120 & 0x800000));
}
{
  // a floor hit: the game's normal faces up -> the floor id
  const { world, log } = make();
  world.t.bulletUpdate(bullet({ f120: 0x2001, normal: [0, -1, 0] }), 1.0);
  ok('room hit on a floor: 0x47400 (material 1 floor), then 0x41800 (W+0x80 = -1: FUN_00335918)', hex(log) === 'wall:0x47400 end:0x41800', hex(log));
}
{
  // no room hit: the end point sets +0x120 bit 0x800000 -> no bullet-end effect (and no wall impact)
  const { world, log } = make();
  const b = bullet();
  world.t.bulletUpdate(b, 1.0);
  ok('no room hit (end of range): bit 0x800000, no effect', (b.f120 & 0x800000) && log.length === 0, hex(log));
}
{
  const { world, log } = make();
  world.t.endEffect(bullet({ from: soldier({ ...W0, bullet: 1 }), f120: 0x2001 }), [1, 2, 3]);
  const fl = { ...data.weapons[1] };
  data.weapons[1] = { ...fl, f78: 0x2000 };
  world.t.endEffect(bullet({ from: soldier({ ...W0, bullet: 1 }), f120: 0x2001 }), [1, 2, 3]);
  data.weapons[1] = { ...fl, fx_floor: 0x41000 };
  world.t.endEffect(bullet({ from: soldier({ ...W0, bullet: 1 }), f120: 0x2001, normal: [0, -1, 0] }), [4, 5, 6]);
  world.t.endEffect(bullet({ from: soldier({ ...W0, bullet: 1 }), f120: 0x2001, normal: [1, 0, 0] }), [4, 5, 6]);
  world.t.endEffect(bullet({ from: soldier({ ...W0, bullet: 1 }), f120: 0x2000, normal: [0, -1, 0] }), [4, 5, 6]);
  data.weapons[1] = { ...fl, fx_end: -1 };
  world.t.endEffect(bullet({ from: soldier({ ...W0, bullet: 1 }), f120: 0x2001 }), [1, 2, 3]);
  data.weapons[1] = fl;
  world.t.endEffect(bullet({ from: player, f120: 0x2001 }), [1, 2, 3]);
  world.t.endEffect(bullet({ f120: 0x40002001 }), [1, 2, 3]);
  world.t.endEffect(bullet({ f120: 0x41002001 }), [7, 8, 9]);
  ok('+0x194 = the record W+0x7c points at; W+0x78 bit 0x2000 none; W+0x80 on a room-hit floor, else W+0xb0; W+0xb0 = -1 none; Vincent\'s bullets none; bit 0x40000000 needs 0x1000000',
    hex(log) === 'end:0x41800 end:0x41000 end:0x41800 end:0x41800 end:0x41800' && log[1][2].join() === '4,5,6' && log[4][2].join() === '7,8,9', hex(log));
}
{
  // FUN_0055db50 on a soldier (gate FUN_0055f0e0: no damage, the effect still runs): kind = zone nibble
  const { world, log } = make();
  const a = { id: 66, s64: 1, f118: 0, part: 0, hp: 100, f19c: { scale: 20, flags: 0, fx: 0 } };
  world.t.hitEnemy(a, bullet({ from: player, cls: 1 }), [1, 2, 3]);
  world.t.hitEnemy({ ...a, f19c: { scale: 20, flags: 0, fx: 4 } }, bullet({ from: player, cls: 1 }), [1, 2, 3]);
  world.t.hitEnemy({ ...a, f19c: null }, bullet({ from: player, cls: 3 }), [1, 2, 3]);
  ok('Vincent\'s bullet on a soldier: nibble 0 -> hit[class 1] 0x41800 (T: w193_fxhits f843 / f870 / f871); nibble 4 -> wall[8]; no zone record -> hit[class]',
    hex(log) === `hit:0x41800 hit:0x${ids.wall[8].toString(16)} hit:0x40c00` && log[0][2].join() === '1,2,3', hex(log));
}
{
  // Vincent's pellets carry +0x150 bits 16-17 = his W+0x14 >> 2 & 3 (FUN_00552dd8): the class FUN_003363d0 reads
  const wp = path.join(here, 'data/aim/weapon.json');
  if (!existsSync(wp)) console.log('  (no data/aim/weapon.json: the pellet class check is skipped)');
  else {
    const Wv = JSON.parse(readFileSync(wp, 'utf8'));
    const { world } = make();
    world.playerShot([0, -10, 0], [100, -10, 0], Wv);
    ok(`Vincent's pellets: cls = weapon.json class & 3 (${Wv.class & 3})`, world.bullets.length === Wv.pellets && world.bullets.every(b => b.cls === (Wv.class & 3)), `${world.bullets.map(b => b.cls)}`);
  }
}

// --- the game's impacts (w193_floor: w172_sound3 route, Vincent pitched down then up; TRACE_CALLLOG=fxsrc logs
// FUN_00335f40's end + normal and the id FUN_003366b8 spawns): the page's room probe at each impact (a ray through the
// end point along the game's normal, probe set 0x18d) must give the game's normal negated (play.js roomRay negates it)
// and, with its material, the game's id
{
  const OUT = process.env.TRACE_OUT ?? path.join(here, '../../tools/trace/out'), logp = path.join(OUT, 'w193_floor.calls.jsonl');
  const colBin = path.join(here, 'data/z128_collision.bin');
  if (!existsSync(logp) || !existsSync(colBin)) console.log('  (no tools/trace/out/w193_floor.calls.jsonl or data/z128_collision.bin: the impact check is skipped)');
  else {
    const { loadCollision, probeSet } = await import('./collision.js');
    const buf = readFileSync(colBin), col = await loadCollision(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length));
    const L = readFileSync(logp, 'utf8').trim().split('\n').map(l => JSON.parse(l)).filter(r => r.hook === 'wall_fx' || r.hook === 'fx66b8');
    let n = 0, good = 0, floors = 0, worst = 0; const bad = [];
    for (let i = 0; i + 1 < L.length; i++) {
      if (L[i].hook !== 'fx66b8' || L[i + 1].hook !== 'wall_fx') continue;
      const id = parseInt(L[i].a0, 16), e = L[i + 1]['a0+0x0'].f, gn = L[i + 1]['a1+0x0'].f;
      const h = col.segment({ x: e[0] + gn[0], y: e[1] + gn[1], z: e[2] + gn[2] }, { x: e[0] - gn[0], y: e[1] - gn[1], z: e[2] - gn[2] }, probeSet(0x18d));
      n++;
      if (!h) { bad.push(`f${L[i].frame} miss`); continue; }
      const nn = h.normal.map(v => -v), mat = ((h.surface | 0) >> 16) & 0xf, pid = FX.wallImpactId(ids, mat, nn);
      const dn = Math.max(...nn.map((v, k) => Math.abs(v - gn[k])));
      if (FX.floorHit(gn)) floors++;
      const dot = nn.reduce((t, v, k) => t + v * gn[k], 0);
      worst = Math.max(worst, dn);
      // the sign is the decode in question: same side (dot > 0.9); f877 hits a slope where the page's surface is ~0.26 u
      // off the game's point and the probe takes the neighbouring face (dn 0.197), the others are the same face
      if (dot > 0.9 && pid === id) good++; else bad.push(`f${L[i].frame} id 0x${id.toString(16)} page 0x${(pid >>> 0).toString(16)} dot ${dot.toFixed(4)}`);
    }
    ok(`w193_floor: ${good} / ${n} impacts (${floors} floors): the page's negated normal on the game's side (dot > 0.9; worst component ${worst.toFixed(3)}) and the same id`, n >= 6 && floors >= 3 && good === n, bad.join(', '));
  }
}
console.log(`${checks - fails}/${checks} checks passed`);
process.exit(fails ? 1 : 0);
