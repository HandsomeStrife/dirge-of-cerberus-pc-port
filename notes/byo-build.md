# Build from your own disc: what the page loads and where it comes from

Worker 0191, 2026-11-01. Scripts: `tools/byo/build_web.sh`, `tools/byo/disc.py`. User doc: `docs/BROWSER.md`.

## Page fetch -> exporter -> disc input

| page file (native/web/data/...) | fetched by | exporter (build step) | read from |
|---|---|---|---|
| scene.json, room_g*.bin, t_*.rgba, vincent.bin | main.js / room.js | export_z128_room.py + export_p000_gpu2.py --no-dump + export_web_room.py (room, p000_static, web_room) | noPath 0680xxxx, 0770000x |
| scene.json "hud" / "effects" keys | play.js | export_web_hud.py / export_web_effects.py declare them (export_web_room.py re-declares when the files exist) | - |
| z128_collision.bin | play.js / collision.js | cidweb (make z128web) | noPath 068000xx |
| z128_ladders.json | play.js | export_web_ladders.py | noPath 06800001 |
| vincent/vincent.glb .json _local.bin cloth.json | play.js | export_web_vincent.py export --no-dump (vincent) | noPath 07703200..11 |
| vincent/vincent_{jump,ladder,shoot}.* | play.js | export_web_vincent.py --pack (pack_*) | same |
| vincent/light.json | play.js | export_web_light.py (light) | env slot + room BMD |
| vincent/cerberus_web.* | gun.js | export_web_gun.py --no-dump (gun) | noPath 07770580..82 |
| vincent/motions.json | (reference only) | export_web_vincent.py catalogue (motions) | - |
| enemies/eNNN*.glb .json _local.bin, *_weapons.json, w00x | enemies.js | export_web_enemy.py (enemy_*, enemy_weapons*) | noPath 0765xxxx, 0777xxxx |
| enemies/placements.json | enemies.js | export_web_placements.py | noPath 06800001 |
| enemies/ai.json | play.js / enemy_ai.js | export_web_triggers.py **+ ELF (sound names)** | noPath 06800001, 06800009, ELF |
| aim/weapon.json, reticle.json | aim.js | export_web_aim.py --iso | data/bgd/bgd.bin, data/etc/menudata.bin, ELF |
| effects/r0001.fed, core_ef.bin, ids.json | play.js -> effects.js | export_web_effects.py (effects) | data/effect/resident/r0000/r0001/fer/r0001.fed, data/effect/core/core_ef.bin, ELF; twister + rand from --state (without them all effects are left out) |
| pause.json | pause_layer.js | export_web_pause.py (pause) | ELF, data/etc/locale/uk/{menudata,fontdata1,kelstr}.bin |
| menu.json | tests only (test_menu_layout) | export_web_menu.py (menu) | ELF |
| hud/hud.json | hud.js | export_web_hud.py (hud, **only with --state**) | ELF, locale uk menudata/fontdata1, **save state** |
| audio/driver.json, se_z128.json, wave0000.{bin,json} | audio.js | tools/audio/extract.py (audio) | data/sound/lib/iopsound.irx, noPath 06800005 / 06800008, data/sound2/wave0000.wd |
| audio/bgm/bgm.json, bgm_001.flac | music.js | tools/audio/bgm.py (music, **only with ffmpeg + libavcodec dev**) | data/zone/z128/sound/bgm_001.at3, noPath 06800008, ELF (scramble keys) |

tools/audio/sep.py is a library/print tool (imported by extract.py), not a build step.

Dev-only files in the maintainers' data (not made by the disc build): room_sky.bin (sky from a GS capture),
pause_ref.json / pause_box_ref.json / pause_box_ok_ref.json, hud/dump_*.json, hud/ring_*.json (GS-dump test
references), vincent/_ref_check/ (old check output).

## Changes (2026-11-01)

- The ELF: disc.py `elf <iso> <dst>` copies SLES_541.85 out of the image (hash-checked) to
  extract/.byo-elf/; build_web.sh deletes it on exit (trap). Keys (BGM scramble, kelstr) are read from it at
  run time by the exporters; nothing is stored.
- **Pre-existing break fixed:** export_web_triggers.py reads the ELF (sound names, worker 0173) and the
  build did not pass it, so a disc-only build failed at `enemy_ai`. Now passed as the 3rd argument.
- Unpack filter `bin` -> `bin,fed,irx,wd,at3`; all .at3 except data/zone/z128/sound/bgm_001.at3 are deleted
  from the temp tree before it becomes extract/_KEL (peak ~3.6 GB; check raised to 4.5 GB; extract 1.2 GB). An older stamped extract is announced;
  the free-space check counts it (and leftovers) as freed and nothing is deleted unless it passes; the .at3 delete runs inside the temp tree (no repo path in
  the pattern); ISO / --state made absolute after parsing; a dirge_atdec that fails to compile skips the music.
- disc.py INPUTS: +10 files (list found by an audit hook on open() over the new exporters). An older
  stamped extract without them fails `verify` and is unpacked again (seen in the proof run: 214/218).
- New steps: effects, pause, menu, HUD (with --state), SE audio, music (optional: ffmpeg + pkg-config
  libavcodec/libavutil/libswresample; builds native/assets/audio/dirge_atdec).

## Proof (scratch copy of the working tree as its own git repo)

Fresh unpack from the ISO in an earlier run (old stamped extract failed verify 214/218 and was unpacked
again; extract 1.2 GB). Reference run below (2026-11-01, after the manager's review fixes): extract
reused, ISO and --state given as RELATIVE paths from another directory, exit 0, 424 s, 412 files, 160 MB.
vs native/web/data (423 files): 407 byte-identical (all audio incl. bgm_001.flac, effects incl. ids.json,
pause.json, menu.json, hud/hud.json, aim, enemies, room, textures, collision, ladders, Vincent + packs).
3 differ, all expected: scene.json (meshes/draws/char), vincent.bin, vincent/cerberus_web.json
(parts_source): the maintainers' data is the capture-based build. 13 only in the maintainers' data: the
dev-only files listed above.

Without --state: the effects step reads no save (audit-hooked: no .p2s opened); ids.json = the
maintainers' minus the `twister` and `rand` fields, so the page leaves ALL effects out (warned; 0188:
every effect frame reseeds the effect LCG from rand()); the HUD step is skipped and scene.json has no "hud".
An earlier "disc-only" run was not: export_web_effects.py then defaulted --state to the shared save.
The build now always passes --state "$STATE" ('' when not given = left out; 0188 removed the default).

## Open

- The HUD needs a save state (element tree; the HUD setup code FUN_003daec8 etc. isn't translated). Until
  it is, disc-only users have no game HUD.
- bgm_001.flac byte identity depends on the ffmpeg version (FLAC encoder tag); same machine here.
