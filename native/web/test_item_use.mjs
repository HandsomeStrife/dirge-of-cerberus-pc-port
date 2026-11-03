// Item use, the heal and the item list's cycle (items.js in enemy_ai's world + hud_core setItem; worker 0243,
// notes/items-research.md 'Item use') against the PCSX2 trace w243_potion (tools/trace/out, game-derived, gitignored):
//   TRACE_FIELDSET=items TRACE_CALLLOG=w243 TRACE_POKE=960660=258 trace.py scripts/w243_potion.json
//   (HP 600 of 780; D-pad right at 20 = use, right at 90 = refused at full HP, left at 150 = one entry, right at 200)
//   node --import ./native/web/test_hooks.mjs native/web/test_item_use.mjs
// Checked per press: the frame of the use (the request 0x1c drained in the same frame), event 0x68's result, the sounds by
// name (msj_010 / msj_001; the cycle's msj_012 only when the selection moves), the heal (HP 600 -> 780, capped), the
// inventory count 2 -> 1 and its HUD text (FUN_003ae308: 0x15 -> 0x14), the selection header (+0 / +0xc / +0x10). Without
// the trace: the cycle order (FUN_0031f520 + comparator 0x31f4e0), the remove at 0 (FUN_0031eb60), the add's auto select.
// MUTATE_ITEMS / MUTATE_AI / MUTATE_HUD = paths of mutated copies of items.js / enemy_ai.js / hud_core.js.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const OUT = process.env.TRACE_OUT ?? path.join(root, 'tools/trace/out');
const imp = (env, rel) => import(process.env[env] ? pathToFileURL(path.resolve(process.env[env])).href : './' + rel);
const I = await imp('MUTATE_ITEMS', 'items.js');
const { createEnemyAI } = await imp('MUTATE_AI', 'enemy_ai.js');
const { HudState, numberCodes } = await imp('MUTATE_HUD', 'hud_core.js');
let fail = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };
const done = () => { console.log(fail ? `${fail} FAILED` : 'all ok'); process.exit(fail ? 1 : 0); };
const STEP = 1.1999999284744263;
const D = p => path.join(here, 'data', p);
const need = [D('enemies/ai.json'), D('items/items.json'), D('hud/hud.json')];
if (need.some(p => !existsSync(p))) { console.log('SKIP: ' + need.filter(p => !existsSync(p)).join(', ') + ' missing (tools/byo/build_web.sh)'); done(); }
const json = p => JSON.parse(readFileSync(p, 'utf8'));
const aiData = json(D('enemies/ai.json'));
const itemsData = json(D('items/items.json'));
const hudData = json(D('hud/hud.json'));
if (!itemsData.scripts || !hudData.item_names) { console.log('SKIP: re-run export_web_items.py / export_web_hud.py (no item scripts / names)'); done(); }

// one world; `hud` = DAT_0046e54c as hud.js consumes it (bit 3 -> setItem with the selection)
function world({ hp = 600 } = {}) {
  const snd = [], warns = [], stats = [];
  let mask = 0;
  const items = I.createItems({ data: itemsData, warn: m => warns.push(m), hud: m => { mask |= m; }, stats: (k, n) => stats.push([k, n]) });
  items.inventory.ammo = { inv: items.inventory.count(I.AMMO_ID) - I.AMMO_OTHER_LOADED };
  const P = { pos: [0, 0, 0], face: [1, 0, 0], hp, hpMax: 780, id: 0x16, f118: 0x20209, s64: 0 };
  const ai = createEnemyAI({ data: aiData, player: P, quiet: true, log: () => {}, items, damage: 0, sound: n => snd.push(n) });
  const st = new HudState(hudData);
  // one game frame: the player's input (FUN_003320c0), the world's tick (its FUN_0053fde8 drains the requests), then
  // FUN_00339590's bit 3 (hud.js tick)
  const frame = (inp = {}) => {
    items.input(inp);
    ai.tick(STEP, P.pos, P.pos);
    if (mask & 8) { const e = items.inventory.selected(); if (e && e[1] !== 0) st.setItem(e[0], e[1]); else st.setItem(-1, 0); }
    const m = mask; mask = 0; return m;
  };
  return { ai, items, P, snd, warns, stats, st, frame };
}

// ---------------------------------------------------------------- the trace
const TR = path.join(OUT, 'w243_potion.jsonl'), CL = path.join(OUT, 'w243_potion.calls.jsonl');
if (!existsSync(TR) || !existsSync(CL)) console.log('SKIP trace part: no ' + TR + ' (see the header)');
else {
  const recs = readFileSync(TR, 'utf8').trim().split('\n').map(l => JSON.parse(l)).filter(r => r.frame !== undefined);
  const calls = readFileSync(CL, 'utf8').trim().split('\n').map(l => JSON.parse(l)).filter(c => c.hook);
  const rec = f => recs.find(r => r.frame === f);
  const cnt = r => new DataView(Uint8Array.from(Buffer.from(r.inv, 'hex')).buffer).getUint32(4, true);
  const hdr = r => { const v = new DataView(Uint8Array.from(Buffer.from(r.inv_hdr, 'hex')).buffer); return [v.getInt16(0, true), v.getUint32(0xc, true), v.getUint32(0x10, true)]; };
  const W = world({ hp: rec(0).ps_20 });
  ok(W.P.hp === 600 && rec(0).ps_04 === 780, `start: HP ${rec(0).ps_20} / ${rec(0).ps_04} (the poke)`);
  const h0 = hdr(rec(0));
  ok(h0[0] === W.items.inventory.sel && h0[1] === (W.items.inventory.last >>> 0) && h0[2] === (W.items.inventory.selId >>> 0),
    `selection header = START_SEL / START_LAST (trace ${h0.map(x => x.toString(16))})`);
  // presses: the script's events (pad held on frames from..to-1); the page sees the press edge in the first frame
  const script = json(path.join(root, 'tools/trace/scripts/w243_potion.json'));
  const pressAt = new Map(script.events.map(e => [e.from, e.buttons[0]]));
  let refuses = 0, uses = 0;
  for (let f = 0; f < script.frames - 1; f++) {
    const b = pressAt.get(f);
    const s0 = W.snd.length;
    const m = W.frame({ use: b === 'right', next: b === 'left' });
    const sounds = W.snd.slice(s0).filter(n => /^msj_/.test(n));
    // the call log's frame k = the logic run after record k's poll; the page's frame f is that logic
    const game = calls.filter(c => c.frame === f + 1 && c.hook === 'play_name').map(c => Buffer.from(c['a1+0x0'].u.map(x => Number(x)).flatMap(w => [w & 255, (w >> 8) & 255, (w >> 16) & 255, (w >>> 24) & 255])).toString('latin1').replace(/\0.*$/s, ''));
    if (sounds.join() !== game.join()) ok(false, `frame ${f}: sounds [${sounds}] vs game [${game}]`);
    const nr = rec(f + 1);
    if (nr) {
      if (nr.ps_20 !== W.P.hp) ok(false, `frame ${f}: HP ${W.P.hp} vs trace ${nr.ps_20}`);
      if (cnt(nr) !== W.items.inventory.countAt(0)) ok(false, `frame ${f}: slot 0 count ${W.items.inventory.countAt(0)} vs trace ${cnt(nr)}`);
      const h = hdr(nr);
      if (h[0] !== W.items.inventory.sel || h[2] !== (W.items.inventory.selId >>> 0)) ok(false, `frame ${f}: selection ${W.items.inventory.sel} vs trace ${h[0]}`);
      // the HUD's count text: buffer 3 of 0x4efba8 (the item count element)
      const t3 = Buffer.from(nr.hud_text, 'hex').subarray(96, 128);
      const page = W.st.find(6, 0x1c).text;
      const game3 = [...t3.subarray(0, t3.indexOf(0))];
      if (f >= 20 && JSON.stringify(page) !== JSON.stringify(game3)) ok(false, `frame ${f}: HUD count text [${page}] vs game [${game3}]`);
    }
    const g = calls.filter(c => c.frame === f + 1);
    const gUse = g.find(c => c.hook === 'use');
    if (gUse) { if (gUse.v0) uses++; else refuses++; }
    if (b === 'right' && f === 20) {
      const heal = g.find(c => c.hook === 'heal'), hi = g.find(c => c.hook === 'hud_item');
      ok(heal && heal.a1 === 200 && W.P.hp === 780, `frame 20: heal +${heal && heal.a1} (cmd 0x12d r0) -> HP ${W.P.hp} (capped at 780)`);
      ok(hi && hi.a1 === 0x69300000 && hi.a2 === 1 && (m & 8), `frame 20: HUD item (0x${hi && hi.a1.toString(16)}, ${hi && hi.a2}) refreshed (mask 0x${m.toString(16)})`);
      ok(JSON.stringify(W.st.find(6, 0x1c).text) === JSON.stringify(numberCodes(1)), 'frame 20: HUD count text = "1"');
      ok(W.warns.some(w => /0x14b effect 0x82400/.test(w)), 'frame 20: cmd 0x14b effect 0x82400 (FUN_00336658 in the trace) warned as not on the page');
      ok(JSON.stringify(W.stats) === '[[4,1]]', `frame 20: section stat 4 += 1 (FUN_0031d668; got ${JSON.stringify(W.stats)})`);
    }
  }
  ok(uses === 1 && refuses === 2, `uses: ${uses} used, ${refuses} refused at full HP (frames 90 / 200)`);
  ok(fail === 0, 'every frame: sounds, HP, count, selection and HUD count text equal the trace');
}

// ---------------------------------------------------------------- without a trace: the rules
{
  // the last Potion: count 0 -> the entry cleared (flags bit 1 clear), the selection -> -1, the HUD -> (-1, 0) = empty name, 0x10
  const W = world({ hp: 100 });
  W.items.inventory.slots[0][1] = 1;
  W.frame({ use: true });
  ok(W.P.hp === 300 && W.items.inventory.slots[0][0] === -1 && W.items.inventory.sel === -1, `last Potion: HP 100 -> ${W.P.hp}, slot 0 cleared, selection -1`);
  ok(W.st.find(6, 0x1b).text.length === 0 && JSON.stringify(W.st.find(6, 0x1c).text) === '[16]', 'HUD after the last one: empty name, count code 0x10');
  W.items.input({ use: true });
  ok(W.P.hp === 300 && !W.ai.events.some(e => /^use request/.test(e)), 'no selection: the use request is not posted (FUN_00573db0)');
  W.ai.tick(STEP, W.P.pos, W.P.pos);
  // a new Potion goes to the freed slot 0 and is selected (FUN_0031e940's end)
  W.items.inventory.add(0x69300000, 1);
  ok(W.items.inventory.slots[0][0] === 0x69300000 && W.items.inventory.sel === 0, 'add: the freed slot reused, the selection set');
}
{
  // dead: no use (FUN_00573db0 / FUN_00573eb0 test HP 0); HP over 0 but full: event 0x68 refuses (msj_001)
  const W = world({ hp: 0 });
  W.items.input({ use: true });
  ok(!W.ai.events.some(e => /^use request/.test(e)), 'HP 0: no use request (FUN_00573db0: FUN_00316cf8)');
  W.ai.tick(STEP, W.P.pos, W.P.pos);
  ok(W.items.inventory.countAt(0) === 2 && W.P.hp === 0, 'HP 0: nothing used');
}
{
  // the cycle: three usable items; keys 1000 (0x69300000), 1001 (0x69300001), 1003 (0x69300002)
  const W = world({ hp: 780 });
  const inv = W.items.inventory;
  inv.add(0x69300002, 1); inv.add(0x69300001, 1);
  const k1 = inv.find(0x69300001), k2 = inv.find(0x69300002);
  const seq = [];
  for (let i = 0; i < 3; i++) { W.frame({ next: true }); seq.push(inv.selId.toString(16)); }
  ok(seq.join() === '69300001,69300002,69300000', `next: by key then id [${seq}] (comparator 0x31f4e0)`);
  const s0 = W.snd.length;
  W.items.input({ prev: true });
  ok(inv.selId === 0x69300002 && W.snd.slice(s0).includes(itemsData.sounds.cycle), `previous wraps to the last (0x${inv.selId.toString(16)}) with the cycle sound`);
  ok(k1 >= 6 && k2 >= 6, 'new entries after the save\'s six');
  // key order != id order: 0x69310002 (key 1006) before 0x69300003 (key 1010) and after 0x69300000 (1000)
  const W3 = world({ hp: 780 });
  W3.items.inventory.add(0x69300003, 1); W3.items.inventory.add(0x69310002, 1);
  W3.frame({ next: true });
  ok(W3.items.inventory.selId === 0x69310002, `next after 0x69300000: 0x${(W3.items.inventory.selId >>> 0).toString(16)} (the key +0xa first, not the id)`);
  // one usable entry, already selected: no change, no sound
  const W2 = world({ hp: 780 });
  const s1 = W2.snd.length;
  W2.frame({ next: true });
  ok(W2.items.inventory.sel === 0 && W2.snd.length === s1, 'one entry, selected: no change, no sound (w243_potion frame 150)');
}
done();
