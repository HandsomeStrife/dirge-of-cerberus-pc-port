// event_answers.mjs (worker 0263): a choice box (wro_kaisetu's kind 27) answered in the compare tools. --answers cross,down,cross: one key whenever a box waits.
import fs from 'node:fs';
import { createEventWindows } from '../../native/web/event_window.js';
import { loadPauseData } from '../../native/web/pause.js';
import { loadStageInfoData } from '../../native/web/stage_info.js';
export function answers(list) {
  const dir = new URL('../../native/web/data/', import.meta.url);
  const J = (f) => JSON.parse(fs.readFileSync(new URL(f, dir)));
  const windows = createEventWindows({ D: loadStageInfoData(J('stage_info.json'), loadPauseData(J('pause.json'))), warn: () => {} });
  let k = 0, seen = -100;
  const step = (f) => {
    const e = windows.entries.find(x => x.id > 0 && x.kind === 27 && x.box && x.box.box);
    if (e && e.box.box.result === 0 && !(e.box.box.flags & 0x30) && f > seen + 30 && k < list.length) { windows.choiceKey(list[k++]); seen = f; }
  };
  return { windows, step };
}
