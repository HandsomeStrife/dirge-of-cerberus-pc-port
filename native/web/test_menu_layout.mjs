// node native/web/test_menu_layout.mjs
// Checks the translated layout interpreter (menu_layout.js: FUN_003ca488 / FUN_003c8910) against
// the widget tree the game built. Expected values were read from PCSX2 EE RAM with the pause
// menu open in the sea-of-flames state (worker 0176, 2026-11-01): screen 0x235110 (vtable
// 0x4a5ab0 = FUN_003bfe28), root widget 0x2350a0, children by +0x24 / +0x30, focused widget
// DAT_004f3034 = 0x234fa0. Needs data/menu.json (export_web_menu.py).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildLayout, flatten, hexBytes } from './menu_layout.js';

const here = dirname(fileURLToPath(import.meta.url));
const menu = JSON.parse(readFileSync(join(here, 'data/menu.json'), 'utf8'));
let fails = 0, checks = 0;
const eq = (what, got, want) => {
  checks++;
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) { fails++; console.log('FAIL', what, 'got', g, 'want', w); }
};

// --- pause menu (layout 0x477678) vs the game's live widget tree
{
  const { roots, focus } = buildLayout(hexBytes(menu.layouts.pause), menu.opLen);
  const ws = flatten(roots);
  // [id, nav, x, y, w, h, image] per widget, from RAM (+3, +4, +6..+0xc, +0x1a)
  const ram = [
    [1, 255, 167, 167, 178, 114, 0x0a],
    [2, 255, 167, 175, 178, 96, 0x34],
    [3, 0, 176, 194, 160, 24, 0x06],
    [4, 1, 176, 220, 160, 24, 0x06],
    [5, 2, 176, 246, 160, 24, 0x06],
    [6, 255, 202, 177, 107, 15, 0x106],
    [7, 255, 167, 189, 35, 3, 0x107],
    [8, 255, 309, 180, 36, 3, 0x107],
  ];
  eq('pause widget count', ws.length, ram.length);
  for (const r of ram) {
    const w = ws.find((x) => x.id === r[0]);
    eq('pause widget ' + r[0], w && [w.id, w.nav, ...w.rect, w.image], r);
  }
  // rgba as built (+0x16..0x19). Widgets 4 and 5 read 49282880 in RAM: the unfocused button
  // halves its colour after the build, so only the focused one and the panels are compared here.
  const rgba = (id) => ws.find((x) => x.id === id).rgba.map((v) => v.toString(16).padStart(2, '0')).join('');
  eq('pause rgba root', rgba(1), '80808080');
  eq('pause rgba panel', rgba(2), '8080801e');
  eq('pause rgba focused button', rgba(3), '92505080');
  // tree shape: everything after the type-1 root is its child (FUN_003ca488 recursion)
  eq('pause roots', roots.length, 1);
  eq('pause root children', roots[0].children.map((w) => w.id), [2, 3, 4, 5, 6, 7, 8]);
  // types per the script (PTR_FUN_0047a6f0 index + 1); vtables in RAM: 4 -> 0x4a66f0, 12 -> 0x4a6898
  eq('pause types', ws.map((w) => w.type), [1, 4, 12, 12, 12, 4, 4, 4]);
  // button texts (op 0x10): message ids Restart / Tempsave / Quit
  eq('pause texts', ws.filter((w) => w.type === 12).map((w) => w.text.toString(16)),
    ['80005c01', '80005c00', '80005c02']);
  eq('pause text offset', ws.find((w) => w.id === 3).textOff, [18, 4]);
  // focus at build: FUN_003d41e0(.., 0xff, 0xff, ..) -> first widget with a focus order
  eq('pause focus', focus && focus.id, 3);
}

// --- focus rule: a requested id wins over the first focusable (param_4 of FUN_003ca488)
{
  const { focus } = buildLayout(hexBytes(menu.layouts.pause), menu.opLen, { focusId: 5 });
  eq('pause focus id 5', focus && focus.id, 5);
}

// --- title main menu (DAT_00aa6450): root 16,16 480x416, three buttons 0x17..0x19
{
  const { roots, focus } = buildLayout(hexBytes(menu.layouts.title_main), menu.opLen);
  const ws = flatten(roots);
  eq('title ids', ws.map((w) => w.id), [0x16, 0x17, 0x18, 0x19]);
  eq('title rects', ws.map((w) => w.rect),
    [[16, 16, 480, 416], [136, 321, 160, 24], [136, 345, 160, 24], [136, 369, 160, 24]]);
  eq('title nav', ws.map((w) => w.nav), [255, 0, 1, 3]);
  eq('title focus', focus && focus.id, 0x17);
  const c = flatten(buildLayout(hexBytes(menu.layouts.title_main_cleared), menu.opLen).roots);
  eq('title cleared ids', c.map((w) => w.id), [0x1a, 0x1b, 0x1c, 0x1d, 0x1e]);
}

// --- title item table (FUN_00aa5050, DAT_00aa6820): button rects the title writes over the layout
{
  const it = menu.titleItems.normal;
  eq('title item ids', it.map((x) => x.id), [0x17, 0x18, 0x19, 0x1a]);
  eq('title item rects', it.slice(0, 3).map((x) => x.rect), [[70, 310, 110, 24], [82, 334, 110, 24], [94, 358, 124, 24]]);
  eq('title item FED ids', it[0].sprites.map((l) => l[0].toString(16)), ['81584800', '81584c00', '81580c00', '81581000']);
}

console.log(fails ? `${fails}/${checks} FAILED` : `ok ${checks} checks`);
process.exit(fails ? 1 : 0);
