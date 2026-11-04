// P6 part 1 (worker 0230; notes/other-types.md): e036 (record 80) runs the soldiers' AI; the corpse chain that wakes it
// (FUN_0055cac8 -> delayed code -11 at +300 -> FUN_0053f040 case 200: fade, code -10 at +180 -> manager event 9 ->
// FUN_0053fde8 case 10: off + script event 0x20); script 104's count of soldiers 72-79 -> record 80 at the 8th corpse.
// T: w230_corpse (k_hits12's inputs to f1400, logged f1200-1400; tools/trace/out, gitignored).
// Run: node --import ./native/web/test_hooks.mjs native/web/test_other_types.mjs   (ENEMY_AI_JS=path: another enemy_ai.js copy)
import path from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const AI = await import(pathToFileURL(process.env.ENEMY_AI_JS || path.join(here, 'enemy_ai.js')).href);
const aiPath = path.join(here, 'data/enemies/ai.json');
if (!existsSync(aiPath)) { console.log('SKIP: data/enemies/ai.json missing (run tools/byo/build_web.sh)'); process.exit(0); }
const data = JSON.parse(readFileSync(aiPath, 'utf8'));
let fails = 0;
let pageOff = null;                                  // the page's death -> off delay (block 2), compared with the trace
const ok = (c, msg) => { console.log((c ? 'ok   ' : 'FAIL ') + msg); if (!c) fails++; };
const ID = r => r + 22;
const far = [-1395, -99, -1110];
const world = (extra = {}) => {
  const player = { pos: far.slice(), hp: 780, id: 0x16, f118: 0, s64: 0 }, act = [], deact = [];
  const W = AI.createEnemyAI({ data, player, rand: () => 0.5, quiet: true, log: () => {}, deadRecs: [41, 42, 43],
    onActivate: (rec, a) => act.push({ rec: rec.rec, actor: !!a }), onDeactivate: rec => deact.push(rec.rec), ...extra });
  return { W, act, deact, player };
};
const kill = (W, a) => W.t.hitEnemy(a, { damage: 9999, kind: 0, dir: [1, 0, 0], shooter: 0x16, f148: 0, hit: 0, f120: 0x800 }, a.pos.slice());

// 1. e036 builds the soldiers' actor
{
  const rec = data.records[80];
  ok(rec.model === 'e036' && rec.stance === 0x1e && data.stances['30'].flags === 0x872b && rec.weapon === 8 && data.weapons[8].cls === 2,
     'record 80 e036: stance 0x1e (FUN_00564228 falls through to the weapon-class rule: weapon 8 class 2), flags 0x872b');
  ok(AI.AI_TYPES.has('e036'), 'e036 is in AI_TYPES');
  const { W, act } = world();
  W.setActive(W.objects.get(ID(80)), 1);
  const a = W.objects.get(ID(80));
  ok(a.kind === 'actor' && a.ai && act.some(x => x.rec === 80 && x.actor), 'activation builds an actor with an AI');
  ok(a.C.st664 === 0x1e && a.C.f808 === 0x872b && a.C.clip === 'm_gst', `stance rows: C+0x664 ${a.C.st664}, idle ${a.C.clip}`);
  ok(a.ai.W === data.weapons[8] && a.hp === 750, `weapon 8, HP ${a.hp}`);
  ok(data.model_clips.e036 && data.model_clips.e036.m_st_a > 0 && data.model_clips.e036.m_st_f > 0, 'model_clips has e036 m_st_a / m_st_f');
}

// 1b. woken (cmd 0x143(2) brain mode 2, cmd 0x193 target Vincent 15 u ahead), e036 fires the soldiers' bullet with weapon 8's
// damage (+0x134 = (short) W+0x40) and hit class (+0x153 = W+0x4a)
{
  const r = data.records[80];
  const pp = [r.pos[0] + r.face[0] * 15, r.pos[1], r.pos[2] + r.face[2] * 15];
  const { W, player } = world();
  player.pos = pp;
  W.t.send(W.objects.get(ID(80)), -2, 0x108, [0, 0, 0, 0]); W.tick(1.2, pp, pp);
  const a = W.objects.get(ID(80));
  W.t.send(a, -2, 0x143, [2, 0, 0, 0]); W.t.send(a, -2, 0x193, [0, 0, 0, 0]);
  let b = null;
  for (let i = 0; i < 600 && !b; i++) { W.tick(1.2, pp, pp); b = W.bullets.find(x => x.shooter === ID(80)) || null; }
  ok(b && b.damage === data.weapons[8].damage && b.damage === 8 && b.hit === data.weapons[8].hit,
     `e036 woken: a bullet from #${ID(80)}, damage ${b && b.damage} (weapon 8: ${data.weapons[8].damage}), hit ${b && b.hit}`);
}

// 1c. worker 0264: chunk 07's pool, as trigger 18 starts it (72-74 up). Script 104 event 0x17 counts deaths and at two posts message 1 to 72-79; event 2 asks cmd 0x177 (FUN_005661e8: not active) and an idle record activates itself.
// With 0x177 skipped no one came, the corpse count stopped at 3 and e036 (at the 8th corpse) never appeared: the level stopped here on the page (test_level_run_page)
{
  const { W } = world();
  for (const k of [72, 73, 74]) W.setActive(W.objects.get(ID(k)), 1);
  const on = k => !!(W.objects.get(ID(k)).flags28 & 1), pool = [75, 76, 77, 78, 79];
  ok(pool.every(k => !on(k)), 'chunk 07: 75-79 idle while 72-74 stand');
  ok(W.t.send(W.objects.get(ID(75)), -2, 0x177, [0, 0, 0, 0]) === 1 && W.t.send(W.objects.get(ID(72)), -2, 0x177, [0, 0, 0, 0]) === 0, 'cmd 0x177: an idle record 1, an active soldier 0');
  kill(W, W.objects.get(ID(72))); for (let i = 0; i < 5; i++) W.tick(1.2, far, far);
  kill(W, W.objects.get(ID(73))); for (let i = 0; i < 40; i++) W.tick(1.2, far, far);
  const up = pool.filter(on);
  ok(up.length > 0, `two dead: the pool comes (${up.join(' ')} active)`);
  let killed = 2, seen80 = false;
  for (let n = 0; n < 4000 && !seen80; n++) {
    for (const k of [72, 73, 74, 75, 76, 77, 78, 79]) { const o = W.objects.get(ID(k)); if ((o.flags28 & 1) && o.kind === 'actor' && o.hp > 0) { kill(W, o); killed++; } }
    W.tick(1.2, far, far); seen80 = on(80);
  }
  ok(seen80 && killed === 8, `the 8th corpse brings e036 (record 80 active ${seen80}, ${killed} killed)`);
}

// 2. the corpse chain on a soldier (record 72, e027, script 104 has an event 0x20): event 0x17 at death; fade at +300 ticks; off +
// event 0x20 at +480 ticks (= 250 / 400 PAL frames at step 1.2)
{
  const { W, deact } = world();
  W.setActive(W.objects.get(ID(72)), 1);
  const a = W.objects.get(ID(72));
  kill(W, a);
  const t0 = W.S.frame + 1;                          // the death frame: kill() runs between ticks, in the next frame's update
  const ev = [];
  let fadeAt = -1, offAt = -1;
  for (let i = 0; i < 520; i++) {
    W.tick(1.2, far, far); ev.push(...W.events.map(e => `${W.S.frame} ${e}`));
    const o = W.objects.get(ID(72));
    if (fadeAt < 0 && o.C && (o.C.f564 & 0x800000)) fadeAt = W.S.frame;
    if (offAt < 0 && !(o.flags28 & 1)) offAt = W.S.frame;
  }
  ok(fadeAt === t0 + 250, `fade starts ${fadeAt - t0} frames after the death frame (code -11 at +300 ticks = 250 PAL frames: mgr +0x20 += int(+0x24 += 1.2))`);
  pageOff = offAt - t0;
  ok(offAt === t0 + 400 && deact.includes(72), `deactivated ${offAt - t0} frames after (300 + 180 ticks), body removed (onDeactivate)`);
  ok(ev.some(e => new RegExp(`^${t0 + 400} event ${ID(72)} script \\d+ ev 32\\b`).test(e)), 'script event 0x20 on that frame');
}

// the same at each of the five phases of the PAL clock (1.2 ticks per frame): 300 and 480 ticks are 250 and 400 frames in every phase
{
  const got = [];
  for (let ph = 0; ph < 5; ph++) {
    const { W } = world();
    for (let i = 0; i < ph; i++) W.tick(1.2, far, far);
    W.setActive(W.objects.get(ID(72)), 1);
    kill(W, W.objects.get(ID(72)));
    const t0 = W.S.frame + 1;
    let fadeAt = -1, offAt = -1;
    for (let i = 0; i < 420 && offAt < 0; i++) {
      W.tick(1.2, far, far);
      const o = W.objects.get(ID(72));
      if (fadeAt < 0 && o.C && (o.C.f564 & 0x800000)) fadeAt = W.S.frame;
      if (!(o.flags28 & 1)) offAt = W.S.frame;
    }
    got.push(`${fadeAt - t0}/${offAt - t0}`);
  }
  ok(got.every(g => g === '250/400'), `five clock phases: fade / off at ${got.join(' ')} frames after the death`);
}

// fade value: FUN_00342360(0, C, 180) then FUN_00343160 steps
{
  const { W } = world();
  const a = W.actors.find(x => x.rec === 66) || (W.setActive(W.objects.get(ID(66)), 1), W.objects.get(ID(66)));
  kill(W, a);
  for (let i = 0; i < 251; i++) W.tick(1.2, far, far);
  const C = W.objects.get(ID(66)).C;
  ok(Math.abs(C.f6bc - Math.fround(-1 / 180)) < 1e-9 && C.f6b8 === 0, `C+0x6bc ${C.f6bc.toFixed(6)}, C+0x6b8 0`);
  for (let i = 0; i < 75; i++) W.tick(1.2, far, far);
  ok(Math.abs(C.f6b4 - 0.5) < 0.01, `half way (75 frames x 1.2 / 180): C+0x6b4 ${C.f6b4.toFixed(4)}`);
}

// 3. records 72-79 (script 104): 8 deaths -> counter 12 = 8; the next corpse's event 0x20 activates record 80 and posts it
// message 1; its event 2 (r0 1, var1 0) sets var1 = 1 and starts path 84 (cmd 0x131)
{
  const { W, act } = world();
  const recs = [72, 73, 74, 75, 76, 77, 78, 79];
  for (const r of recs) W.setActive(W.objects.get(ID(r)), 1);
  const ev = [];
  for (const r of recs) { kill(W, W.objects.get(ID(r))); W.tick(1.2, far, far); ev.push(...W.events); }
  ok(recs.every(r => W.objects.get(ID(r)).hp === 0) && !act.some(x => x.rec === 80), 'all eight dead, record 80 not yet active');
  for (let i = 0; i < 500 && !act.some(x => x.rec === 80); i++) { W.tick(1.2, far, far); ev.push(...W.events); }
  const a = W.objects.get(ID(80));
  ok(act.some(x => x.rec === 80 && x.actor) && a.kind === 'actor', `record 80 (e036) activated by the first corpse's event 0x20 after the 8th death`);
  for (let i = 0; i < 3; i++) { W.tick(1.2, far, far); ev.push(...W.events); }
  ok(a.vars[1] === 1 && ev.some(e => new RegExp(`path ${ID(80)} 84`).test(e)), `message 1 -> event 2: var1 ${a.vars[1]}, path 84`);
}

// 5. e023 record 87 by trigger 71 (script 86, ev 0xd): activated as an actor (+0x118 |= 0x80801c, FUN_00564228), its event 3
// (script 112: 0x16e(0) +0x38 bit 2 off, 0x11a(1) +0x28 bit 12, 0x14c bits 2 3 4 6 21), then script 86's 0x14c(13), 0x155(95),
// 0x141 'idle', 0x131 path 74, timer 0 = 10
const enter = (W, player, k) => {
  const c = data.triggers[k].m[3].slice(0, 3), a = [c[0] - 40, c[1] - 5, c[2]], b = [c[0], c[1] - 5, c[2]];
  player.pos = a; W.tick(1.2, a, a); player.pos = b; W.tick(1.2, a, b); return b;
};
{
  const { W, act, player } = world();
  const ev = [];
  const b = enter(W, player, 71); ev.push(...W.events);
  const h = W.objects.get(ID(87));
  ok(act.some(x => x.rec === 87 && x.actor) && h.kind === 'actor' && h.ai && h.ai.mode === 0, 'trigger 71: record 87 (e023) active, an actor in brain mode 0');
  const want = (0x80801c | 1 << 2 | 1 << 3 | 1 << 4 | 1 << 6 | 1 << 21 | 1 << 13) >>> 0;
  ok(h.f118 === want, `+0x118 0x${h.f118.toString(16)} (FUN_00564228 0x80801c + script 112 ev 3 + script 86's bit 13; want 0x${want.toString(16)})`);
  ok(h.f38 !== undefined && !(h.f38 & 4) && (h.flags28 & 0x1000), `cmd 0x16e(0): +0x38 0x${(h.f38 >>> 0).toString(16)} bit 2 clear (not lockable); cmd 0x11a(1): +0x28 bit 12`);
  ok(!W.lockTargets().some(t => t.id === ID(87) && t.lockable), 'not in the lock-on list as lockable');
  ok(ev.some(e => new RegExp(`path ${ID(87)} 74`).test(e)) && h.C.n640 === 'idle', `path 74 started, C+0x640 ${h.C.n640} (cmd 0x141)`);
  ok(h.t3c[0] === 10 || h.t3c[0] < 10, `timer 0 set (cmd 0x106(0, 10)): ${h.t3c[0]}`);
}

// 6. cmd 0x113 (FUN_0054cd70): e001 record 1's event 3 sends 0x113(200): script event 0x18 every 200 ticks while it returns 0
{
  const { W } = world();
  W.t.send(W.objects.get(ID(1)), -2, 0x108, [0, 0, 0, 0]);
  W.tick(1.2, far, far);                              // event 3 comes through manager event 7 (cmd 0x108)
  const e1 = W.objects.get(ID(1));
  ok(e1.kind === 'actor' && e1.C.st664 === 0x10 && e1.s36 === 200, `record 1 (e001): actor, stance 0x${e1.C.st664.toString(16)}, +0x36 ${e1.s36}`);
  ok(e1.f38 !== undefined && !(e1.f38 & 1) && !(e1.f38 & 4), `cmd 0x16c(0) / 0x16e(0): +0x38 0x${(e1.f38 >>> 0).toString(16)} (bullets and lock-on off)`);
  const at = [];
  const t0 = W.S.mgr20;
  // the clock FUN_0053f040 compares is mgr +0x20 before the frame's increment (1 or 2 ticks per PAL frame): each event comes on
  // the first frame whose clock has reached the due tick, the next is due 200 after that clock
  const prev = [];
  for (let i = 0; i < 400; i++) {
    const c = W.S.mgr20; W.tick(1.2, far, far);
    if (W.events.some(e => new RegExp(`^event ${ID(1)} script 111 ev 24\\b`).test(e))) { at.push(c - t0); prev.push(c); }
  }
  ok(at.length >= 2 && at[1] - at[0] >= 200 && at[1] - at[0] <= 201, `event 0x18 at ticks ${at.join(', ')} (period 200 from the firing clock)`);
}

// 7. cmd 0x19e(1) = combat layer 1 (FUN_0035f9a0 -> FUN_0035fa10 vt 0x4a23a0): start FUN_00360da8 = a fire timer with no count
{
  const { W } = world();
  W.setActive(W.objects.get(ID(87)), 1);
  const h = W.objects.get(ID(87));
  W.t.send(h, -2, 0x19e, [1, 0, 0, 0]);
  ok(h.ai.cmode === 1 && h.ai.timer && h.ai.timer.left === -1, `cmd 0x19e(1): combat layer ${h.ai.cmode}, fire timer left ${h.ai.timer && h.ai.timer.left}`);
  W.t.send(h, -2, 0x19e, [0, 0, 0, 0]);
  ok(h.ai.cmode === 0 && !h.ai.timer, 'cmd 0x19e(0): layer 0, the timer stops (FUN_0035fa10 case 0 -> FUN_00360820)');
}

// 8. cmd 0x1a3: HP = r0 clamped to [0, max]
{
  const { W } = world();
  W.setActive(W.objects.get(ID(87)), 1);
  const h = W.objects.get(ID(87));
  W.t.send(h, -2, 0x1a3, [100, 0, 0, 0]); const a = h.hp;
  W.t.send(h, -2, 0x1a3, [31000, 0, 0, 0]); const b = h.hp;
  W.t.send(h, -2, 0x1a3, [40000, 0, 0, 0]); const c = h.hp;
  ok(a === 100 && b === data.records[87].hp && c === 0, `cmd 0x1a3: HP ${a}; 31000 -> max ${b}; (short) 40000 < 0 -> ${c}`);
}

// 9. a deleted object's delayed entries leave the list with it (enemy_ai deleteObject, as its 0x101 mail): record 72 killed (code
// -11 queued) then deleted by cmd 0x10a before the 300 ticks
{
  const { W } = world();
  W.setActive(W.objects.get(ID(72)), 1);
  kill(W, W.objects.get(ID(72)));
  ok(W.delayed.some(e => e.id === ID(72) && e.code === -11), 'death: code -11 for #94 on the delayed list');
  W.t.send(W.objects.get(ID(72)), -2, 0x10a, [0, 0, 0, 0]);
  for (let i = 0; i < 3; i++) W.tick(1.2, far, far);
  ok(!W.objects.get(ID(72)) && !W.delayed.some(e => e.id === ID(72)), 'cmd 0x10a: the object is gone and so are its delayed entries');
}

// 4. the trace: #66 / #67 (e0 / e1) killed at f843 / f871 (k_hits12): +0x28 bit 0 clears on f843 + 400 / f871 + 400
{
  const f = path.join(here, '../../tools/trace/out/w230_corpse.jsonl');
  if (!existsSync(f)) console.log('skip  trace w230_corpse.jsonl not here');
  else {
    const rows = readFileSync(f, 'utf8').trim().split('\n').slice(1).map(l => JSON.parse(l.replace(/\bNaN\b/g, 'null')));
    const off = e => rows.find(r => r[e + '_flags'] != null && !(r[e + '_flags'] & 1))?.frame;
    ok(off('e0') - 843 === pageOff && off('e1') - 871 === pageOff, `w230_corpse: #66 off at f${off('e0')}, #67 at f${off('e1')}: death + ${off('e0') - 843} / ${off('e1') - 871} frames, page ${pageOff}`);
  }
}

// 7. worker 0259: the hit area and the reaction rows (FUN_0055d390; FUN_00598950's table 0x5a3b10; the death row = the same table + 6). T: w259_e036 (r07_beat, e036 shot by the walker,
// tools/trace/out, gitignored): C+0x590 low 4 bits per hit 1 5 1 | 1 4 1 4 1 5 with m_stbd0 throughout, the kill in area 5 -> m_stllf0, e001's timer 0 = 140 counts one a frame.
{
  const { W } = world();
  W.t.send(W.objects.get(ID(80)), -2, 0x108, [0, 0, 0, 0]); W.tick(1.2, far, far);
  const a = W.objects.get(ID(80));
  W.runEvent(a, 0x13);                                                    // the path's end: damage on, brain mode 5
  ok(a.ai.mode === 5, `event 0x13: brain mode ${a.ai.mode} (T: 5)`);
  a.pos = [0, 0, 0]; a.face = [0, 0, 1];
  const zones = data.zones[String(data.records[80].zones)];
  ok(zones[2].area === 0 && zones[6].area === 2 && zones[10].area === 4, 'ai.json zones: the area nibble (part 2 -> 0, 6 -> 2, 10 -> 4)');
  const R = 0x1e;
  const shot = (part, sign, hit = 0) => {                                  // x in the actor's frame = -face.z dx + face.x dz: sign x -> dx = -sign
    a.f19c = zones[part]; a.part = part;
    W.t.hitEnemy(a, { damage: 31, kind: 0, dir: [0, 0, 1], shooter: 0x16, f148: 0, hit, f120: 0x800 }, [-sign, 10, 0]);
    return a.C.f590;
  };
  // the first hit: bit 0x10000 clear: the zone's area + 1
  ok(shot(2, 1) === 1, `part 2, no flinch: area ${a.C.f590} (zone 0 + 1)`);
  ok(shot(6, 1) === 3, `part 6, no flinch: area ${a.C.f590} (zone 2 + 1)`);
  // under the flinch (C+0x564 bit 0x10000): T's sequence, side by side
  a.C.f564 |= 0x10000; a.C.f590 = 1;
  const seq = [[1, -1], [6, 1], [6, 1], [4, -1], [2, 1], [6, -1], [0, -1]].map(([p, sg]) => shot(p, sg));
  ok(seq.join(' ') === '5 1 4 1 4 1 5', `bit 0x10000: by side and the old area: ${seq.join(' ')} (5 -> 6 x < 0, 1 -> 5 x < 0, 1 -> 4 x >= 0, 4 -> 2 x >= 0, 2 -> 3 x >= 0, else 1)`);
  const C = a.C;
  C.f564 |= 0x10000; C.f590 = 5; a.f19c = zones[6];
  W.t.hitEnemy(a, { damage: 31, kind: 0, dir: [0, 0, 1], shooter: 0x16, f148: 0, hit: 0, f120: 0x800 }, [1, 10, 0]);
  ok(C.f590 === 6, `old 5, x < 0: area ${C.f590}`);
  C.f590 = 4; W.t.hitEnemy(a, { damage: 31, kind: 0, dir: [0, 0, 1], shooter: 0x16, f148: 0, hit: 0, f120: 0x800 }, [-1, 10, 0]);
  ok(C.f590 === 2, `old 4, x >= 0: area ${C.f590}`);
  C.f590 = 2; W.t.hitEnemy(a, { damage: 31, kind: 0, dir: [0, 0, 1], shooter: 0x16, f148: 0, hit: 0, f120: 0x800 }, [-1, 10, 0]);
  ok(C.f590 === 3, `old 2, x >= 0: area ${C.f590}`);
  // a flinch takes its row from the table (area 1 -> 0x25 m_stbd0), a kill the row 6 on (area 5 -> 0x2e m_stllf0)
  const rows = data.stances['30'].motions;
  ok(rows[0x25] === 'm_stbd0' && rows[0x2e] === 'm_stllf0', 'e036 rows 0x25 m_stbd0, 0x2e m_stllf0');
  ok(data.model_clips.e036.m_stbd0 > 0 && data.model_clips.e036.m_stllf0 > 0, 'model_clips e036 has them');
  C.f564 &= ~0x10000; a.hp = 200; a.f144 = -1000; C.motion = null;
  a.f19c = zones[2]; a.part = 2;
  W.t.hitEnemy(a, { damage: 31, kind: 0, dir: [0, 0, 1], shooter: 0x16, f148: 0, hit: 1, f120: 0x800 }, [-1, 10, 0]);
  ok(C.motion && C.motion.cls === R && C.clip === 'm_stbd0', `flinch in area 1: class 0x${(C.motion && C.motion.cls || 0).toString(16)}, clip ${C.clip} (T m_stbd0)`);
  C.f564 |= 0x10000; C.f590 = 1; a.hp = 4; a.f19c = zones[0]; a.part = 0;
  W.t.hitEnemy(a, { damage: 31, kind: 0, dir: [0, 0, 1], shooter: 0x16, f148: 0, hit: 1, f120: 0x800 }, [1, 10, 0]);
  ok(a.hp === 0 && C.f590 === 5 && C.clip === 'm_stllf0', `the kill at x < 0 from area 1: area ${C.f590}, clip ${C.clip} (T m_stllf0)`);
}
// 7b. every row of the table 0x5a3b10 (FUN_00598950), and the death row 6 on: a fresh e036 per area, through hitEnemy
{
  const rows = data.stances['30'].motions;
  // area, how FUN_0055d390 gets there (old area under bit 0x10000, side of the hit: dx > 0 is x < 0; area 1: a zone's nibble 0 with the bit clear), row
  const T7 = [[1, null, 0, 0x25], [2, 4, -1, 0x24], [3, 2, -1, 0x26], [4, 1, -1, 0x27], [5, 1, 1, 0x28], [6, 5, 1, 0x29]];
  for (const [area, old, dx, row] of T7) for (const kill of [false, true]) {
    const { W } = world();
    W.t.send(W.objects.get(ID(80)), -2, 0x108, [0, 0, 0, 0]); W.tick(1.2, far, far);
    const a = W.objects.get(ID(80)), C = a.C;
    W.runEvent(a, 0x13);
    a.pos = [0, 0, 0]; a.face = [0, 0, 1]; a.hp = kill ? 4 : 200; a.f144 = -1000; C.motion = null;
    const zones = data.zones[String(data.records[80].zones)];
    a.f19c = zones[2]; a.part = 2;
    if (old === null) C.f564 &= ~0x10000; else { C.f564 |= 0x10000; C.f590 = old; }
    W.t.hitEnemy(a, { damage: 31, kind: 0, dir: [0, 0, 1], shooter: 0x16, f148: 0, hit: 1, f120: 0x800 }, [dx, 10, 0]);
    const want = rows[kill ? row + 6 : row];
    ok(C.f590 === area && want && C.clip === want, `area ${C.f590}: ${kill ? 'kill row' : 'flinch row'} 0x${(kill ? row + 6 : row).toString(16)} = ${want}, drawn ${C.clip}`);
  }
}
console.log(fails ? `${fails} FAILED` : 'all ok');
process.exit(fails ? 1 : 0);
