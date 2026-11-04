// test_shop.mjs -- the Shop's logic (worker 0263; notes/shop-research.md): real inventory and gil through shop.js, the lists, buy, sell, quantity, the leave box.
//   node native/web/test_shop.mjs   MUTATE=<name> runs one mutant of shop.js in a scratch copy. Needs data/shop.json, pause.json, stage_info.json.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL ' + m); } };
const MUT = process.env.MUTATE;
const MUTS = {
  gil: ['if (k !== -1 && e !== null) inv.gil -= cost;', ''],
  sellgil: ['inv.gil = Math.min(inv.gil + e.price * p.n, 99999999);', ''],
  sellcount: ['inv.remove(k, p.n);', ''],
  buyadd: ['if (cost <= inv.gil) k = inv.add(e.id | 0, p.n);', 'if (cost <= inv.gil) k = 0;'],
  buypoor: ['if (this.gil < price) e.flags |= 1;', 'if (false) e.flags |= 1;'],
  buyfull: ['else if (e.own === 0 && this.cap <= this.used) e.flags |= 1;', ''],
  buymax: ['else if (r.flags & 1) e.flags |= 1;', ''],
  sellequip: ['if (s.n === 0 || (s.f & 3)) e.flags = 1;', ''],
  selllook: ['if (v === id) return S.sell[m][1];', 'if (v === id) return 0;'],
  sort: ['if (i < 0) i = order.length; order.splice(i, 0, e);', 'i = order.length; order.splice(i, 0, e);'],
  qtymax: ['if (Q.val + Q.step <= Q.max) Q.val += Q.step;', 'Q.val += Q.step;'],
  qtymin: ['if (Q.val - Q.step >= Q.min) Q.val -= Q.step;', 'Q.val -= Q.step;'],
  qtyskip: ['if (e.max < 2 && this.tab !== 2) { this.confirm(1, now); return; }', ''],
  poorlimit: ['if (this.gil < e.price * p.mx) p.mx = Math.trunc(this.gil / e.price);', ''],
  disabled: ['if (e.flags & 1) { this.se(5); return true; }', ''],
  leave: ['if (yes) { this.result = 2; this.leaving = true; this.se(SE.close); }', ''],
  leavealways: ['if (ev === 0x55) {\n      if (yes) {', 'if (ev === 0x55) {\n      if (true) {'],
  back: ["this.se(SE.cancel); this.backToTabs();", "this.se(SE.cancel); this.openQuestion('shopLeave', null, 0x55, now);"],
  emptytab: ['if (this.rows.length === 0) return true;', ''],
  tabnav: ['this.setTab(TAB_IDS.indexOf(f.id), false);', ''],
  answerno: ['if (yes) this.request();', 'this.request();'],
  capmat: ['if (r && (r.flags & 0x200)) this.cap++;', ''],
  sellshow: ['if (!r || (r.flags & 0x20)) return;', 'if (!r) return;'],
};
let base = HERE;
if (MUT) {
  const m = MUTS[MUT]; if (!m) throw new Error('unknown mutant ' + MUT);
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'mut-shop-'));
  for (const f of fs.readdirSync(HERE)) if (f.endsWith('.js')) fs.copyFileSync(path.join(HERE, f), path.join(base, f));
  const p = path.join(base, 'shop.js'), s = fs.readFileSync(p, 'utf8');
  if (!s.includes(m[0])) throw new Error('mutant does not apply: ' + m[0]);
  fs.writeFileSync(p, s.replace(m[0], m[1]));
}
const data = path.join(HERE, 'data');
for (const f of ['shop.json', 'pause.json', 'stage_info.json']) if (!fs.existsSync(path.join(data, f))) { console.log('SKIP: no data/' + f); process.exit(0); }
const imp = f => import(pathToFileURL(path.join(base, f)));
const { loadPauseData } = await imp('pause.js'); const { loadStageInfoData } = await imp('stage_info.js');
const { ShopBox, loadShopData, sprintf, glyphNum } = await imp('shop.js'); const { Inventory } = await imp('items.js');
const J = n => JSON.parse(fs.readFileSync(path.join(data, n)));
const j = J('shop.json'), D = loadShopData(j, loadStageInfoData(J('stage_info.json'), loadPauseData(J('pause.json'))));
const str = b => String.fromCharCode(...b);
// the inventory of state w263/gssup (T): Potion 3, ammo 198, two empty ammo items, the weapon's parts, a Fire Materia, a Long Barrel; gil 100
const POTION = 0x69300000, VITAL = 0x69310011, SPIRIT = 0x69310012, AMMO = 0x62300000, FIRE = 0x70340032, LONG = 0x70310008;
const SAVE = [[POTION, 3], [AMMO, 198], [0x62300001, 0], [0x62300002, 0], [0x70300000, 1], [0x70310000, 1], [FIRE, 1], [LONG, 1]];
const mk = (gil = 100, slots = SAVE, shop = 1) => { const inv = new Inventory({ ...j.items }, slots, gil); inv.other = 0; const b = new ShopBox(D, inv, shop, 0, { warn: () => {} }); b.frame(200); return { inv, b }; };
const sounds = b => b.events.map(e => e.se);
const count = (inv, id) => { const k = inv.slots.findIndex(e => e[0] === id); return k < 0 ? 0 : inv.slots[k][1]; };

try {
// the stage file: 4 shops, shop 1 as the game's RAM in the Shop (state gssup): 2 rows at 0, no Modify, 474 Sell prices
ok(j.shops.length === 4, 'four shops in the stage file');
ok(j.shops[1].buy.length === 2 && j.shops[1].buy[0][0] === VITAL && j.shops[1].buy[1][0] === SPIRIT && j.shops[1].buy[0][1] === 0, 'shop 1: Vital and Spirit Rations at 0');
ok(j.shops[1].modify.length === 0 && j.shops[1].sell.length === 474, 'shop 1: no Modify, 474 Sell prices');
// the first screen (g400): Buy lit, the two rows, 8/50, Gil 100
{
  const { b } = mk();
  ok(b.focusW.id === 6 && b.tab === 0, 'Buy has the focus');
  ok(b.rows.length === 2 && str(b.rows[0].name) === 'Vital Rations' && str(b.rows[1].name) === 'Spirit Rations', 'the rows: ' + b.rows.map(r => str(r.name)));
  ok(b.used === 8 && b.cap === 50 && b.gil === 100, `inventory ${b.used}/${b.cap}, gil ${b.gil}`);
  ok(str(b.tabs.byId(0x14).str.subarray(0, 3)) === str(Uint8Array.from(glyphNum(100))), 'the Gil widget shows the inventory\'s gil');
  ok(str(b.bar.byId(3).str) === 'Purchase items.', 'the bar: ' + str(b.bar.byId(3).str));
  ok(b.draw(200).length > 50, 'it draws: ' + b.draw(200).length);
  ok(b.rows[0].own === 0 && b.rows[0].max === 5, 'Vital Rations own 0, max 5');
}
// buy: ✕ the tab, ✕ the row, up x 1, ✕ the spinner, ✕ OK
{
  const { b, inv } = mk();
  b.key('cross'); ok(b.focusW === b.list, 'the tab\'s ✕ enters the list');
  b.key('down'); ok(b.cursor === 1, 'down: row 1');
  b.key('up'); ok(b.cursor === 0, 'up: row 0');
  b.key('up'); ok(b.cursor === 1, 'up at the top wraps');
  b.key('down'); ok(b.cursor === 0, 'down at the end wraps');
  b.key('cross'); ok(b.qty && b.qty.max === 5 && b.qty.val === 1, 'the quantity box: 1 of 5');
  b.key('down'); ok(b.qty.val === 1, 'not below 1');
  b.key('up'); ok(b.qty.val === 2, 'up: 2');
  for (let i = 0; i < 9; i++) b.key('up');
  ok(b.qty.val === 5, 'not above 5: ' + b.qty.val);
  b.key('down'); b.key('down'); b.key('down');
  b.key('cross'); ok(b.boxW && str(b.boxW.b.byId(5).str) === 'Purchase Vital Rations x2?', 'the question: ' + (b.boxW && str(b.boxW.b.byId(5).str)));
  ok(count(inv, VITAL) === 0, 'nothing bought yet');
  b.key('cross');
  ok(count(inv, VITAL) === 2 && inv.gil === 100, 'bought 2 at 0: ' + count(inv, VITAL) + ', gil ' + inv.gil);
  ok(b.used === 9 && b.rows[0].own === 2, 'the screen follows: ' + b.used + ', own ' + b.rows[0].own);
  ok(b.focusW === b.list, 'back in the list');
  b.frame(800);
  // a stack already at its limit: disabled
  inv.slots[inv.find(VITAL)][1] = 5; b.readInventory(); b.setTab(0, true);
  ok((b.rows[0].flags & 1) === 1, 'a full stack is greyed');
  b.events.length = 0; b.cursor = 0; b.key('cross');
  ok(!b.qty && !b.boxW && sounds(b).includes(5), 'a greyed row: no box, sound 5: ' + sounds(b));
}
// a price: gil limits the buy and the quantity. Shop 2: Handgun Bullets 10, Potion 100, Phoenix Down 1000
{
  const { b, inv } = mk(250, SAVE, 2);
  const phoenix = b.rows.find(r => r.id === 0x69300004), pot = b.rows.find(r => r.id === POTION);
  ok(phoenix && (phoenix.flags & 1) === 1, 'too dear: greyed');
  ok(pot && (pot.flags & 1) === 0, 'Potion affordable');
  b.key('cross'); b.cursor = b.rows.indexOf(pot); b.key('cross');
  ok(b.qty && b.qty.max === 1, 'the quantity is limited by the stack (3 of 4): ' + (b.qty && b.qty.max));
  b.qty = null; b.focusW = b.list;
  inv.slots[0][1] = 0; b.readInventory(); b.setTab(0, true);
  const p2 = b.rows.find(r => r.id === POTION); b.cursor = b.rows.indexOf(p2); b.key('cross');
  ok(b.qty && b.qty.max === 2, '250 gil buys 2 at 100: ' + (b.qty && b.qty.max));
  b.key('up'); b.key('cross'); b.key('cross');
  ok(inv.gil === 50 && inv.countAt(0) === 2, 'paid: ' + inv.gil + ', potions ' + inv.countAt(0));
}
// no room: 50 entries
{
  const many = Array.from({ length: 50 }, (_, i) => [0x63300000 + i % 24 + (i >= 24 ? 0x10000 : 0), 1]);
  const { b } = mk(100, many);
  ok(b.used === 50 && (b.rows[0].flags & 1) === 1, 'inventory full: a new item is greyed: ' + b.used);
}
// sell: the right prices, equipped greyed, the money comes in, the entry goes
{
  const { b, inv } = mk();
  b.key('right');
  ok(b.tab === 1 && b.focusW.id === 7, 'right: Sell');
  ok(str(b.bar.byId(3).str) === 'Sell items from your inventory.', 'the bar follows');
  const by = id => b.rows.find(r => r.id === id);
  ok(by(POTION) && by(POTION).price === 70, 'Potion sells at 70: ' + (by(POTION) && by(POTION).price));
  ok(by(0x70300000) && (by(0x70300000).flags & 1) === 1, 'the weapon is equipped: greyed');
  ok(!by(AMMO), 'ammo (flags bit 5) is not listed');
  ok(by(FIRE) && (by(FIRE).flags & 1) === 0, 'Fire Materia can go');
  // sorted by the record's key
  ok(b.rows.every((r, i) => i === 0 || (b.rows[i - 1].key >>> 0) <= (r.key >>> 0)), 'sorted by +0xa: ' + b.rows.map(r => r.key));
  b.key('cross');
  const k = b.rows.indexOf(by(POTION)); b.cursor = k;
  b.key('cross'); ok(b.qty && b.qty.max === 3, 'Sell quantity: what is owned: ' + (b.qty && b.qty.max));
  b.key('up'); b.key('cross');
  ok(b.boxW && str(b.boxW.b.byId(5).str) === 'Sell Potion x2?', 'the question: ' + (b.boxW && str(b.boxW.b.byId(5).str)));
  b.key('cross');
  ok(inv.gil === 240 && inv.countAt(0) === 1, 'sold 2: gil ' + inv.gil + ', left ' + inv.countAt(0));
  ok(b.gil === 240, 'the screen\'s gil: ' + b.gil);
  // answering no changes nothing
  b.cursor = b.rows.findIndex(r => r.id === FIRE); const g = inv.gil;
  b.key('cross'); ok(!b.qty && b.boxW, 'max 1: straight to the question');
  b.key('right'); b.key('cross');
  ok(inv.gil === g && inv.find(FIRE) >= 0, 'CANCEL: nothing sold: gil ' + inv.gil + ' was ' + g + ' slot ' + inv.find(FIRE));
}
// tabs: ○ from the list goes back to its tab, the empty Modify does not enter, ○ from a tab asks, cancel stays, OK leaves with result 2
{
  const { b } = mk();
  b.key('cross'); b.key('circle');
  ok(b.focusW.id === 6 && !b.boxW, '○ in the list: back to the tab');
  b.key('left'); ok(b.focusW.id === 8 && b.tab === 2 && b.rows.length === 0, 'left from Buy wraps to Modify, empty');
  b.key('cross'); ok(b.focusW.id === 8, 'an empty list is not entered');
  b.key('right'); ok(b.focusW.id === 6, 'right from Modify wraps to Buy');
  b.key('circle');
  ok(b.boxW && b.boxW.ev === 0x55 && str(b.boxW.b.byId(5).str) === 'Quit and exit the shop?', 'the leave box');
  ok(b.boxW.b.focus.id === 7, 'kind 2: CANCEL first');
  b.key('cross'); ok(!b.closed && b.result === 0 && !b.leaving, 'CANCEL: still in the Shop');
  b.frame(1000); b.frame(1100);
  b.key('circle'); b.key('left'); ok(b.boxW.b.focus.id === 6, 'left: OK');
  b.key('cross');
  ok(b.result === 2, 'OK: FUN_003b7830(.., 2)');
  b.frame(1200); b.frame(1400);
  ok(b.closed, 'the box goes: the talk goes on');
}
} catch (e) { ok(false, 'threw: ' + e.message); }
ok(str(sprintf(D.msg[0xa80a], [Uint8Array.from([0x41]), 3])) === 'Purchase A x3?', 'sprintf');
console.log(fail ? `FAILED ${pass} / ${pass + fail}` + (MUT ? ` (mutant ${MUT})` : '') : `ok ${pass} / ${pass}`);
process.exit(fail ? 1 : 0);
