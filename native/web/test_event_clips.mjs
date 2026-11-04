// test_event_clips.mjs -- every clip the story events' scripts ask for resolves on the exported actors (worker 0261; notes/story-cutscenes.md): an actor with no clip stands in its bind pose.
//   node --import ./native/web/test_hooks.mjs native/web/test_event_clips.mjs     (needs data/event; run after export_web_event_actors.py; MUTATE=noresident drops the resident files)
// Each event runs headless twice (stage flags clear / all 1, for its branches), lent actors as their ai.json records' models. Known gaps: LEFT below, each with its reason.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { StageRuntime, PLAYS } from './stage_controller.js';
import { EventActors } from './event_actor_rt.js';
import { AI_TYPES, NPC_TYPES } from './enemy_ai.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
if (!fs.existsSync(path.join(HERE, 'data/event/actors/actors.json'))) { console.log('SKIP: no data/event/actors'); process.exit(0); }
const data = JSON.parse(fs.readFileSync(path.join(HERE, 'data/event/ev0100_stage.json')));
const lib = JSON.parse(fs.readFileSync(path.join(HERE, 'data/event/actors/actors.json'))).models;
const recs = JSON.parse(fs.readFileSync(path.join(HERE, 'data/enemies/ai.json'))).records;
const clipFrames = (m, n, c) => { const p = lib[m] && lib[m].packs[n]; return p && p.clipFrames[c] != null ? p.clipFrames[c] : null; };
const MUT = process.env.MUTATE;
const residentFiles = (m) => (MUT === 'noresident' ? [] : (lib[m] && lib[m].resident) || []);
// event|model:clip -> why it may not resolve
const LEFT = {
  'kita_ev0145|w003:km0701dj': "file 0x56: tracks for 4 bones on w003's 5 (fits); no earlier clip, so that gun is in its bind pose (open)",
};
const events = new Set(PLAYS); events.delete('ev0101.first_event');
const bad = new Map();
for (const key of events) {
  const [cls, m] = key.split('.'), M = data.classes[cls] && data.classes[cls].methods.find(x => x.name === m);
  if (!M) continue;
  for (const fill of [0, 1]) {
    const zf = new Array(64).fill(fill), warns = [];
    const A = new EventActors({ clipFrames, residentFiles, warn: (w) => warns.push(w) });
    const R = new StageRuntime(data, { warn: () => {}, flags: () => zf, sound: {}, actors: A, viewMatrix: () => ({ eye: [0, 0, 0], fwd: [0, 0, 1], down: [0, 1, 0], fov: 70 }),
      // play.js battleObject's rule: an object only with an AI actor (enemy_ai buildsActor: AI_TYPES, NPC_TYPES); else no slot, no clip: left out, not bind pose (first_encounter's e_Shc, n112)
      battleObject: (n) => { const r = recs.find(x => x.tag === n); if (!r) return null; if (n !== 'p_Vin' && !(AI_TYPES.has(r.model) || NPC_TYPES.has(r.model))) return null; return { tag: n, model: n === 'p_Vin' ? 'p000' : r.model, matrix: () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], lend() {}, show() {}, release() {}, place() {} }; } });
    // main's stand on p_Vin before the event: the slots an event gets from main (getbattleactor) by name
    const args = M.desc === '()V' ? [] : [201, 202, 203].map(id => { R.actors.create(({ 201: 'n026', 202: 'n024', 203: 'n023' })[id], id); return { f: { id } }; });
    try { R.vm.start(cls, m, M.desc, args); for (let f = 0; f < 20000 && !R.vm.done; f++) { R.frame(20); A.step(); } } catch (e) { bad.set(key + ' ' + fill, 'crash: ' + e.message); }
    for (const w of warns) { const k = w.match(/\((\w+)\): clip (\S+) not loaded/); if (k && !LEFT[m + '|' + k[1] + ':' + k[2]]) { const id = k[1] + ':' + k[2]; bad.set(id, (bad.get(id) || new Set()).add(m)); } }
  }
}
// loadchr's mask gates the late sets: without it the event file's bv002vn and no bv011vn; with loadchr("p000", 7) both come from k 0x11 (FUN_005a7390: the character's sets first)
{
  const A = new EventActors({ clipFrames, residentFiles, warn: () => {} }), a = A.create('p000', 1); a.files.push(13);
  const h = A.findClip(a, 'bv002vn'), l = A.findClip(a, 'bv011vn');
  if (!h || h.n !== 13) bad.set('mask clear: bv002vn', 'found in ' + (h && h.n));
  if (l) bad.set('mask clear: bv011vn', 'found in ' + l.n);
  if (MUT !== 'noresident') {
    A.charMask.set('p000', 1 << 7);
    const h2 = A.findClip(a, 'bv002vn'), l2 = A.findClip(a, 'bv011vn');
    if (!l2 || l2.n !== 'r11' || !h2 || h2.n !== 'r11') bad.set('mask 7: k 0x11', `bv011vn in ${l2 && l2.n}, bv002vn in ${h2 && h2.n}`);
  }
}
for (const [id, v] of bad) console.log('FAIL ' + id + ' <- ' + (v instanceof Set ? [...v].join(',') : v));
console.log(bad.size ? `${bad.size} clips don't resolve` + (MUT ? ` (mutant ${MUT})` : '') : `ok: every clip of ${events.size} events resolves`);
process.exit(bad.size ? 1 : 0);
