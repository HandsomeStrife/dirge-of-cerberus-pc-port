// FUN_0032ace0 base follow: |dy| >= 15 -> the base lands on the player in one frame;
// |dy| < 15 -> min(rate x 1.2, 1) per axis. Also: reset() snaps (flag 0x2000) and measures dist.
// node --import ./native/web/test_hooks.mjs native/web/test_camera.mjs [player.js path]
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const P = process.argv[2] ? pathToFileURL(process.argv[2]).href : new URL('./player.js', import.meta.url).href;
const { FollowCamera, cameraRays, MouseFeed, TICK } = await import(P);
let fail = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };
const near = (a, b, e = 1e-5) => Math.abs(a - b) <= e;
const tick = (cam, pos) => cam.tick({ pos, want: { x: 0, y: 0, z: 1 }, state: 0, stick: 0, pad: null });
for (const dy of [15, 20, -15, -40]) {                // game space, -Y up: dy > 0 = he dropped
  const cam = new FollowCamera(null); cam.reset({ x: 0, y: 0, z: 0 }); tick(cam, { x: 0, y: 0, z: 0 });
  tick(cam, { x: 3, y: dy, z: -2 });
  ok(near(cam.base[0], 3) && near(cam.base[1], dy) && near(cam.base[2], -2), `|dy| ${Math.abs(dy)} (dy ${dy}): base snaps -> ${cam.base.map(v => v.toFixed(3))}`);
}
for (const [dy, ky] of [[14.9, 0.5 * 1.2], [-14.9, 0.15 * 1.2]]) {
  const cam = new FollowCamera(null); cam.reset({ x: 0, y: 0, z: 0 }); tick(cam, { x: 0, y: 0, z: 0 });
  tick(cam, { x: 4, y: dy, z: 0 });
  ok(near(cam.base[1], dy * ky) && near(cam.base[0], 4 * 0.125 * 1.2), `dy ${dy}: eases (y ${cam.base[1].toFixed(4)} want ${(dy * ky).toFixed(4)}, x ${cam.base[0].toFixed(4)})`);
}
{ // reset: next tick snaps, even far away
  const cam = new FollowCamera(null); cam.reset({ x: 0, y: 0, z: 0 });
  cam.reset({ x: 100, y: 5, z: 50 });
  tick(cam, { x: 101, y: 5, z: 50 });
  ok(near(cam.base[0], 101), `after reset the first frame snaps (base x ${cam.base[0].toFixed(3)})`);
}
{ // reset with collision: dist = the measured eye distance, eye consistent with it
  const buf = readFileSync(new URL('data/z128_collision.bin', P));
  const rays = cameraRays(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const cam = new FollowCamera(null, rays);
  const sp = { x: -631.348 + 0, y: 0, z: 0 };
  cam.reset(sp);
  const r = [cam.at[0] - cam.eye[0], cam.at[1] - cam.eye[1], cam.at[2] - cam.eye[2]];
  ok(cam.dist < 1000 && cam.dist > 1, `reset measures dist (${cam.dist.toFixed(3)}), no mouse latch: ${!cam.mouseActive}`);
}
{ // FUN_00254ac8: mouse sets DAT_004e17d0, pad x|x| > 0.3 clears it (0.55^2 = 0.3025), 0.54^2 does not
  const cam = new FollowCamera(null); cam.reset({ x: 0, y: 0, z: 0 });
  cam.addMouse(5, 0); tick(cam, { x: 0, y: 0, z: 0 });
  const on = cam.mouseActive;
  cam.tick({ pos: { x: 0, y: 0, z: 0 }, want: { x: 0, y: 0, z: 1 }, state: 0, stick: 0, pad: [0.54, 0] });
  const keep = cam.mouseActive;
  cam.tick({ pos: { x: 0, y: 0, z: 0 }, want: { x: 0, y: 0, z: 1 }, state: 0, stick: 0, pad: [0, -0.55] });
  ok(on && keep && !cam.mouseActive, `mouse latch: set ${on}, kept at 0.54 ${keep}, cleared at 0.55 ${!cam.mouseActive}`);
}
// mouse look: the page loop as play.js runs it (rendered frames at hz, 50 Hz game frames, the
// MouseFeed share before each game frame); returns the yaw turned per game frame over the last 25
function mouseRun(hz, px, { direct = null, feed = true, frames = 120 } = {}) {
  const cam = new FollowCamera(null); if (direct) cam.mouseDirect = direct; cam.reset({ x: 0, y: 0, z: 0 });
  const mf = new MouseFeed(), d = []; let acc = 0;
  for (let f = 0; f < frames; f++) {
    if (feed) mf.add(px, 0); else cam.addMouse(px, 0);
    acc += 1 / hz;
    const due = Math.min(Math.floor(acc / TICK), 8);
    for (let n = 0; acc >= TICK && n < 8; n++, acc -= TICK) {
      if (feed) mf.feed(cam, due - n);
      const y0 = cam.yaw; tick(cam, { x: 0, y: 0, z: 0 });
      let dy = cam.yaw - y0; if (dy < -Math.PI) dy += 2 * Math.PI; if (dy > Math.PI) dy -= 2 * Math.PI;
      d.push(dy);
    }
  }
  return { cam, avg: d.slice(-25).reduce((a, b) => a + b, 0) / 25, d };
}
{ // full mouse turn = the stick capped at 1 (FUN_00254ac8), / step (FUN_003256d8), x rate 0.05 x step
  const full = 0.05;
  const r144 = mouseRun(144, 20), r100 = mouseRun(60, 100);
  ok(near(r144.avg, full, 1e-6) && near(r100.avg, full, 1e-6), `mouse caps at full stick: ${r144.avg.toFixed(5)} / ${r100.avg.toFixed(5)} rad per game frame (want ${full})`);
  // ramp CAM+0x1ec: target 1/1.2 >= 0.5 -> +0.05 x 1.2 per frame: 14 frames to full
  const i = r144.d.findIndex(v => near(v, full, 1e-6));
  ok(i === 13, `mouse ramp: full speed on game frame ${i + 1} (want 14)`);
  // rendered frames under 50 Hz: every game frame gets its share; without the share the
  // empty game frames drop the ramp to 0 (mouse mode) and the turn crawls
  const r30 = mouseRun(30, 20), raw30 = mouseRun(30, 20, { feed: false });
  ok(near(r30.avg, full, 1e-6), `30 fps page, 20 px/frame: ${r30.avg.toFixed(5)} rad per game frame (want ${full}; unshared ${raw30.avg.toFixed(5)})`);
  ok(raw30.avg < full * 0.3, `(check: unshared counts at 30 fps crawl, ${raw30.avg.toFixed(5)})`);
}
{ // OPTION mouselook=direct: pixels x sens straight to yaw / pitch, no cap; idle counter -20
  const sens = 0.15 * Math.PI / 180;
  const r = mouseRun(60, 100, { direct: { sens }, frames: 60 });
  ok(near(r.avg, 100 * 60 / 50 * sens, 1e-6), `mouselook=direct: ${r.avg.toFixed(5)} rad per game frame for 100 px/frame at 60 fps (want ${(100 * 1.2 * sens).toFixed(5)})`);
  const cam = new FollowCamera(null); cam.mouseDirect = { sens }; cam.reset({ x: 0, y: 0, z: 0 });
  const y0 = cam.yaw, p0 = cam.pitch;
  cam.addMouse(10, 20); tick(cam, { x: 0, y: 0, z: 0 });
  ok(near(cam.yaw - y0, 10 * sens, 1e-6) && near(cam.pitch - p0, -20 * sens, 1e-6) && cam.idle === -20 && !cam.mouseActive && cam.ramp === 0,
     `mouselook=direct: (10, 20) px -> yaw +${(cam.yaw - y0).toFixed(5)}, pitch ${(cam.pitch - p0).toFixed(5)}, idle ${cam.idle}, latch ${cam.mouseActive}, ramp ${cam.ramp}`);
  for (let k = 0; k < 40; k++) { cam.addMouse(0, -500); tick(cam, { x: 0, y: 0, z: 0 }); }
  ok(near(cam.pitch, 50 * 0.017453294, 1e-5), `mouselook=direct keeps the game's pitch limit (${(cam.pitch / 0.017453294).toFixed(2)} deg, want 50)`);
}
{ // worker 0246: FUN_0032ace0 l.437-441 / 612-637: game-state bit 11 (p.noUser): the look read (mouse latch, counts spent) is
  // zeroed, no ramp CAM+0x1ec, no deadzone request, the idle counter runs; the counts are not banked for later frames
  const tk = (cam, nu) => cam.tick({ pos: { x: 0, y: 0, z: 0 }, want: { x: 0, y: 0, z: 1 }, state: 0, stick: 0, pad: null, noUser: nu });
  const cam = new FollowCamera(null); cam.reset({ x: 0, y: 0, z: 0 }); tk(cam, false);
  for (let k = 0; k < 40; k++) tk(cam, false);
  const y0 = cam.yaw, p0 = cam.pitch, r0 = cam.ramp, i0 = cam.idle;
  cam.addMouse(40, 25); tk(cam, true);
  const still = cam.yaw === y0 && cam.pitch === p0;
  ok(still && cam.ramp === r0 && cam.flags14 === 0 && cam.mouseActive && cam.idle >= i0 && cam.look190[0] === 0 && cam.look190[1] === 0,
     `user control off: mouse (40, 25) turns nothing (yaw ${(cam.yaw - y0).toExponential(2)}, pitch ${(cam.pitch - p0).toExponential(2)}), ramp ${cam.ramp} kept, no deadzone bit, latch ${cam.mouseActive}, idle ${i0} -> ${cam.idle}`);
  tk(cam, false);
  ok(cam.yaw === y0 && cam.pitch === p0, `the counts are spent, not banked: next free frame turns nothing (yaw ${(cam.yaw - y0).toExponential(2)})`);
  cam.addMouse(40, 25); tk(cam, false);
  ok(cam.yaw !== y0, `control back: the same mouse turns (yaw ${(cam.yaw - y0).toFixed(5)})`);
  // the ramp CAM+0x1ec / its direction are left as they were (LAB_0032b950 skipped), not eased toward 0
  const r = new FollowCamera(null); r.reset({ x: 0, y: 0, z: 0 }); tk(r, false);
  r.tick({ pos: { x: 0, y: 0, z: 0 }, want: { x: 0, y: 0, z: 1 }, state: 0, stick: 0, pad: [0.5, 0] });
  r.tick({ pos: { x: 0, y: 0, z: 0 }, want: { x: 0, y: 0, z: 1 }, state: 0, stick: 0, pad: [0.5, 0] });
  const rr = r.ramp, rd = r.rampDir.slice();
  tk(r, true);
  ok(rr > 0 && r.ramp === rr && r.rampDir[0] === rd[0] && r.rampDir[1] === rd[1], `user control off keeps the look ramp (${rr.toFixed(4)} -> ${r.ramp.toFixed(4)})`);
  const d = new FollowCamera(null); d.reset({ x: 0, y: 0, z: 0 }); tk(d, false); d.startDeath(); tk(d, true);
  ok(d.look190[0] === 0 && d.look190[1] === 0, `user control off skips the death camera's look (0, -0.3): look ${d.look190}`);
}
process.exit(fail ? 1 : 0);
