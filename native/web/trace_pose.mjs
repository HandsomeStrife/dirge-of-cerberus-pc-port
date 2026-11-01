// Vincent's traced skeleton for the enemy-bullet tests (test_bullet_hit, test_enemy_ai): pose traces
// (tools/trace TRACE_FIELDSET=pose: *(MP+0x3f8) bone matrices, model space, row-vector; row 3's w slot is
// not 1 and is ignored) placed by C+0x00 with rows 1 and 2 negated (T: bone 3 = the traced aim, 1e-4 u).
// A call tagged frame k runs in the step from record k - 1: before Vincent's C update it sees record k - 1's
// bones and matrix, after it record k - 1's bones with record k's matrix (enemy_ai.js playerBones).
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

export function loadPoses(dir, names) {
  const poses = new Map();
  for (const name of names) {
    const file = path.join(dir, name + '.jsonl');
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, 'utf8').trim().split('\n').slice(1)) {
      const r = JSON.parse(line), buf = Buffer.from(r.bones, 'hex'), M = r.matrix;
      const model = [M[0].slice(0, 3), M[1].slice(0, 3).map(x => -x), M[2].slice(0, 3).map(x => -x), M[3].slice(0, 3)];
      const bonesOf = b => [0, 1, 2, 3].map(i => [0, 1, 2].map(j => buf.readFloatLE(b * 64 + i * 16 + j * 4)));
      const rowsWith = m => [0, 1, 2, 3].map(i => [0, 1, 2].map(j => m[i][0] * model[0][j] + m[i][1] * model[1][j] + m[i][2] * model[2][j] + (i === 3 ? model[3][j] : 0)));
      poses.set(r.frame, { pos: M[3].slice(0, 3), bonesOf, rowsWith, rows: b => rowsWith(bonesOf(b)) });
    }
  }
  return poses;
}
// enemy_ai playerBoneWorld for a call tagged frame k (null outside the traced frames)
export function boneWorldAt(poses, k) {
  const p = poses.get(k - 1), q = poses.get(k);
  if (!p) return () => null;
  return after => after ? (q ? b => q.rowsWith(p.bonesOf(b)) : null) : p.rows;
}
