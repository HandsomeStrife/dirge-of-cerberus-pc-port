# Manager handoff: finish the first level (written 2026-11-03)

You are the new project manager for dirge-port: a faithful web port of Dirge of Cerberus (PAL SLES_541.85), played at
http://192.168.0.234:8796/play.html (served straight from `native/web` in this checkout, nginx container `dirge-play`).

Dan wants you to run overnight, unattended: do every item in "The work", delegate with `ccm`, run things in parallel
where you can, and keep going until the list is done. Don't wait for him between items.

Read first: `CLAUDE.md`, the newest ~30 entries of `notes/HANDOFF.md`, `notes/first-level-plan.md`.
HEAD when this was written: 9e1ff04 on `main`, clean, pushed. Remote: `git@github.com:HandsomeStrife/dirge-of-cerberus-pc-port.git`.
Next worker number: **dirge-worker-0253**.

## Where it stopped (2026-11-05, wind-down)

Dan asked for a wind-down on 2026-11-04. All workers are retired; next worker number: **dirge-worker-0265**.

- **The level has not been played deck to results.** `test_level_run_page` is red. The bot's furthest run passed e036, rv_toujou and wro_kaisetu and ran out of rounds near chunk 08. Gate 3, chunk 0b, the boss and results were never reached on foot; they pass only from warps (`test_heri_kita_page`, `test_results_page`).
- **Blocker:** ammo. The Shop is decoded (`notes/shop-research.md`, `native/web/shop.js`) but unwired and never compared with the game, and the bot's aim wastes rounds, so how much of the shortage is the game's isn't known.
- **Last full suite:** 43 page tests ok, node clean. `test_scr005_page` failed on a read of `__play.stage` before its declaration; the declaration has moved (other `__play` getters such as stageLib, checkpointRec still have that window). `test_warp_page` failed `stairs: the warp ran`, not explained. A rerun of both died from low system memory, so **neither has passed since**. Page tests that ran before worker 0264's last edits (0x191, 0x1a5, height) also need a rerun; see its list in `notes/HANDOFF.md`.
- **Next:** rerun those on a quiet machine, then wire the Shop. Then walk the bot on through chunk 0b.
- **Not done from "The work":** effects in events, block drift, rv_matiawase's 200-frame hold and memory-card box, door walls (Vincent passes shut doors), laptop-size memory run in the market, and all of step 5's list below.

## Dan's rules

- **Everything is based on a decompile of the game.** Decode, translate, cite addresses (`// FUN_xxxxxxxx`), check against
  PCSX2. Match the game as closely as possible. Quality-of-life concessions are fine as separate options: widescreen HUD
  and full-HD rendering are on by default at his request.
- **Undecoded parts:** a small `// GUESS:` stand-in listed in `notes/fidelity-audit.md`, or left out with a console warning.
  After two failed decode attempts, stop and report. A new line of evidence is not a third attempt.
- **The repo is public.** No bulk game data or anything exported from it: dumps, traces, exports, tables, decrypted script
  listings. Decryption keys and cipher constants are read from the user's ELF at run time, never committed
  (`native/common/doc_cipher.c`, `kel_class.cipher_consts()`). **Quoting game text (names, messages, menu lines) is fine.**
  `tools/hygiene_text.py` is optional, not a commit gate.
- **Re-review after fixing.** The worst defect of a round is often the previous round's fix. Mutation-test anything
  load-bearing: a test proves nothing until you've seen it fail.
- **Commit and push** without asking, then post a review-board item saying it's already committed.
- `ccm title` in the main session only; never in workers.
- Copy-paste snippets for Dan go through the clipboard tool (see his global CLAUDE.md).
- Plain, short updates. He reads the first sentence.

## The work

Do these in order. Run everything inside a step in parallel.

### 1. Review the backlog (no review yet)

These are committed with only their workers' own tests. Earlier reviews found a real bug in most pieces, so don't skip this.
Use read-only `general-purpose` agents, one per group; send the fixes to a fresh worker (these workers are all gone).

| Group | Worker | What |
|---|---|---|
| A | 0242 | mid-level checkpoints: `checkpoint.js` sceneSave / restoreRecord, Restart resume, `items.restart(rec)`, plus the Restart review items it took over |
| B | 0243 | item use: `items.js`, E / Q keys, HUD item name and count |
| C | 0244, 0247 | camera: `cameraRays` per loaded chunk, `battleReset` / `battleHandBack` / `messages`, `test_market_cam_page` |
| D | 0246 | barrel and pickup sounds (resident sdb names), the input gate under bit 11, reload motion class 0x1c |
| E | 0248 | face texture animation (`texanm`), rv_matiawase playing, `stage_view.js`, autoskip default per event |
| F | 0241 | menu-box effects: `menu_fx.js`, channel types 8 / 18, type 103's draw, the soft end |
| G | 0249, 0251, 0252 | `warp.js`, area switching of actors (`areaSwitch`), dog brain mode 3 (`brain3`) |
| H | 0233, 0240, 0232, 0239 | occluder cull got one partial look; stage-init pass, results and subtitles had one review whose fixes went in without a re-review |

### 2. Walk the real level in PCSX2

**Part 1 done (worker 0253, 2026-11-04):** walked states with GS dumps in every chunk, table in `notes/route-states.md`, with what each stretch needs (three cardkeys, a door, Dragonfly). Awake-dog traces there too.

Goal: walked states (not teleports) in every chunk on the route 02 -> 03 -> 04 -> 05 -> 06 -> 07/08 -> 09 -> 0b, each with
a GS dump, indexed in `notes/route-states.md`. Teleported states freeze Vincent and don't fire triggers.

The route may need story beats to open; chunks (2, 3) load in rv_matiawase. Save states on the way so later runs start nearer.

When walked states exist:
- **Dogs:** record an awake dog (trigger 63 needs Vincent walking into it). Check `brain3` against it. Then translate the
  motion state 4 walk (dogs slide today), attack ops 3 and 6-9 (jumps), shape-2 volumes, and settle the pitch sign of
  FUN_00260f54 (a dog stops at 12.4 u and never bites in 3 of 4 runs). Notes: `notes/enemy-ai-hook.md` 'Mode 3: the dogs'.
- **Other fights:** e036, the e023 helicopter, a moving-Vincent boss trace (boss states 4 / 6-9 are hand-tested only),
  shots at townspeople, the rescue beat. Notes: `notes/other-types.md`, `notes/boss-research.md`, `notes/npc-research.md`.
- **Grades:** room per chunk against the dumps (`test_room_grade` method), and lighting per chunk (never graded outside 01 / 02 / 06).

### 3. A whole-level run on the page

A scripted page test from the deck to the results screen, with default options, intro on, real gun, no warps or pokes. It
walks the route, fights, picks things up, passes the beats, beats the boss, reaches results. This is what catches bugs that
only appear in sequence.

Dan's **market crash** is still open: "Game crashed in the market, after killing the first dog enemy". Not reproduced in two
workers' attempts (see HANDOFF 0245 / 0251). `report.js` now records uncaught errors in a report's `meta.json`, so also check
`/srv/shared/dirge-port/reports/` for new reports each turn.

### 4. Play the remaining story cutscenes

About 20 events in ev0100 `main` still auto-skip (a labelled GUESS, `stage_controller.js`). Only the opening (ev0101 first_event)
and rv_matiawase play. Skipping changes the story path: sk_mituketa2 and kita_ev0145 never play.

Machinery exists: `event_vm.js`, `event_rt.js`, `event_actor_rt.js`, `event_actors.js`, `event_sound.js`, `event_window.js`,
`stage_view.js`. One worker per event class (scr001 / 002 / 003 / 005 / 006) can run side by side. Add each event's subtitle
messages to the export (the old hygiene limit on them is gone). For each: trace it unskipped, compare cameras and actors,
turn its auto-skip off. Once all play, auto-skip goes away.

Known leftovers for this step:
- roji02_01: Skip at the event's first wait lands mid camera move and overwrites main's `Camera.set`, so `test_npc_page`
  runs with `autoskip=1`. Remove that when the event plays.
- 113 / 114 reappear far away after the rescue in the game; on the page they stay put (roji02_01 or their scripts on flag 12).
- rv_matiawase: after its last shot the game holds about 200 frames, then the memory-card box; the page goes straight on.
- `setBattleCameraInterpolationTime` isn't translated (camera 21.65 vs the game's 21.29 after the rescue).

### 5. Smaller visual and logic gaps

- Fade's real draw: a separate particle system built into the ELF (data at 0x2df5f0, FUN_002f4270); the black veil is a GUESS.
- Title card: box 0x1e, step table 0x47a028; 3D burst, type 113 frame-buffer filter, an undecoded layout step for the stage name.
- Scope view (SCOPE01: tint, HUD, x2 zoom), actor effect sequences (visor glow), focus blur, cape cloth on event models.
- Type 119 (help box backdrop and scanlines; matrix jump table 0x49f740); results type 26 and emitter E15; time row (Shift-JIS).
- Draw order of box effects (the item picture after the box text, title strands after the HUD).
- Model effect attachment: the Potion's green swirl 0x82400, boss effects, muzzle effects.
- Floor-impact models: still off outside the fire (they didn't match `w206_floor`; the cause is unknown).
- `FUN_002f93d8`: the one undecoded fire glow; lens flares (types 50 / 53 / 56 read the depth buffer).
- Soldier footsteps fsj_057; WRO men n017 / n018 / n022 (rifles, brain modes 3 / 5); knock-down reactions; air reactions.
- Stand-ins to replace: 41-43 and 45-49's start (FUN_0055a0d8 area path), the hand-back's bone 1 offset, area status bit 5.
- Soldier 41 fires at record 106 vs the game's 96 (the twister runs 2 ahead from record 12, from 42's first-shot gap; pinned in test_checkpoint).
- `notes/fidelity-audit.md` is the full list. Work down its MISSING and GUESS rows if you get this far.

### Don't start

The second level. Finish this one first, then report to Dan.

## How to run workers

```bash
export APPS_DIRS=/srv/apps:/srv/games:/srv/tools   # always first
ccm new dirge-port --detach --name dirge-worker-NNNN --task "$(cat brief.txt)"
ccm wait dirge-worker-NNNN --timeout 14400         # as a background Bash call, one per worker
ccm kill dirge-worker-NNNN                         # retire when reviewed; frees memory
ccm json                                           # name, status, title
```

Things that bit me:
- **Messaging:** workers retitle themselves, so `SendMessage` to `dirge-worker-NNNN` often fails. Use the exact name from
  `ListAgents` or the `title` from `ccm json`.
- **Busy is not working.** A worker whose report is done still shows busy if background shells are running (0222 sat "busy"
  for 5 hours). Check `tmux capture-pane -p -t dirge-worker-NNNN | tail` before waiting again.
- **Idle is not done.** A worker waiting on queued background tests shows idle, and its idle notice repeats its last message.
  Read its last message before treating it as finished.
- **Memory:** the machine has 29 GB and other projects run on it too. Above about 6-7 workers, browsers crash out of memory and
  tests fail for no real reason. Check `free -g` before spawning more; retire workers as soon as they're reviewed.
- **Reading a report:**

```bash
cd ~/.claude/projects/-srv-games-dirge-port
f=$(grep -l "You are dirge-worker-NNNN" *.jsonl | head -1)   # exclude your own session's file
python3 - "$f" <<'EOF'
import json,sys
t=[]
for l in open(sys.argv[1]):
    try: d=json.loads(l)
    except: continue
    if d.get('type')=='assistant':
        t+=[c['text'] for c in d['message'].get('content',[]) if isinstance(c,dict) and c.get('type')=='text' and len(c['text'])>300]
print(t[-1])
EOF
```

## Paste this into every worker brief

```
Rules:
- Read CLAUDE.md and the newest notes/HANDOFF.md entries. Faithful port: decode, translate, cite addresses (// FUN_xxxxxxxx), invent nothing. Undecodable parts: leave out with a console warning, or a small labelled `// GUESS:` with a row in notes/fidelity-audit.md. After two failed decode attempts, stop and report.
- The repo is PUBLIC: no bulk game data, dumps, traces, exports, tables or decrypted script listings in tracked files; keys and cipher constants are read from the ELF. Quoting game text is fine.
- Only ONE PCSX2: wrap every trace.py / grab_gs.py / PCSX2 run in `flock /srv/games/dirge-port/tools/trace/out/.pcsx2.lock <command>`, and keep holds short.
- Browser page tests run one at a time across all workers: `flock /srv/games/dirge-port/tools/trace/out/.browser.lock node native/web/test_X_page.mjs`. They need the network (three.js CDN): run them with the sandbox disabled. Close any browser or server you start.
- Several workers share this checkout. Re-read shared files (play.js, enemy_ai.js, player.js, room.js, effects.js, build_web.sh, notes/HANDOFF.md, notes/fidelity-audit.md) right before editing, and make minimal Edit-tool edits. Never git checkout / stash / restore in the main tree; mutate scratch copies. Bisecting: use a git worktree in your scratchpad.
- New disc inputs go into tools/byo/build_web.sh and tools/byo/disc.py INPUTS.
- Check against PCSX2 traces / GS dumps, and report the largest errors. Add tests a user's action would exercise, and mutation-check them.
- Add a dated notes/HANDOFF.md entry. Do NOT commit. Do NOT post to the review board. Save a game-vs-page image if the work is visual, and give its path.
- End with a short report: what was decoded (addresses), what the page now does, tests and mutation results, what's still open.
```

## Your loop

1. Spawn workers; one background `ccm wait` each.
2. When one finishes, read its report and start a read-only reviewer (`Agent`, `general-purpose`, background) with the worker's
   files and claims. Tell it not to write to the repo or run git commands that write, and give it a scratch folder. Ask it to spot-check decode
   claims in `analysis/decomp/`, run the tests, mutate scratch copies, and rank findings.
3. Send the fixes to the worker with `SendMessage`, with `notify_when_idle: true`.
4. Re-review if the fixes were substantial. Retire the worker.
5. Run the full suite, commit, push, post to the board.

Check `git status` for other workers' half-done edits before committing. Tonight's commits were checkpoints that included
in-progress work; say so in the commit message. Don't commit with a red test unless the message says which and why. End
commit messages with: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`

## The full suite

**Run every test file**, not a list: a hand-kept list missed `test_aim_camera`, and a syntax error in `test_boss_page` went
unseen until I ran it. Page tests print `all ok`; a blank line means a crash.

```bash
cd /srv/games/dirge-port
for t in $(ls native/web/test_*.mjs | grep -v _page | xargs -n1 basename | sed 's/.mjs//') test_jump_page; do
  r=$(timeout 600 node --import ./native/web/test_hooks.mjs native/web/$t.mjs 2>&1)
  n=$(echo "$r" | grep -cE '^FAIL|^ *[1-9][0-9]* FAILED|Error:'); [ "$n" != 0 ] && echo "$t: $n"; done
for t in $(ls native/web/test_*_page.mjs | xargs -n1 basename | sed 's/.mjs//' | grep -v test_jump_page); do
  echo "$t: $(flock tools/trace/out/.browser.lock timeout 900 node native/web/$t.mjs 2>&1 | grep -E '^FAIL|all ok|FAILED|passed' | tail -2 | tr '\n' ' ')"; done
python3 -I native/assets/models/test_cull_tag.py | tail -1
python3 -I native/assets/textures/test_raw_alpha.py | tail -1
```

Run it in the background (it takes well over 10 minutes) with the sandbox disabled. `test_jump_page` is really a node test, despite the name.

Known gaps, not failures: `test_enemy_ai` 2, `test_enemy_hits` 4, `test_lock_on` 1.

Flaky under load; rerun once alone before calling it a failure, and fix these if they come up on a quiet machine:
`test_hud_page` ('pause during the slide-in (H)', wall clock, about 1 in 3), `test_char_light_page` ('then a box: its pair
loaded'), `test_enemies_page` (#66's death-clip frame), `test_audio_menu_page`, `test_hit_voice_page`, `test_gameover_page`
(pause check), `test_effects_page`.

Also tidy: `test_ambient_page` still ignores 404s on `game_state.js` / `stage_info.js` from before those files existed.

## PCSX2 tracing

- `notes/pcsx2-headless-setup.md`, `tools/trace/`: `trace.py`, `grab_gs.py`, `calllog.py`, `fields.py`, `route.py`, `scripts/*.json`. Outputs in `tools/trace/out/` are gitignored.
- The `pcsx2trace` user unit's environment is `tools/trace/out/env/` (gitignored; worker 0253). No `TRACE_SCRATCH` needed.
- The game's clock is real time, so page frames and trace frames differ by load times; the HANDOFF entries say how each comparison handles it.
- Answering the memory-card box and the map screen after scene_save: `tools/trace/scripts/w229_rescue.json`.
- Reaching the boss: stage flag 0 = 36 + global flag 19 = 1 (`r0b_boss2` is mid-fight).

## Data rebuilds

Exports live in `native/web/data/` (gitignored) and many were re-exported tonight in place. `tools/byo/build_web.sh` must still
rebuild them all from Dan's disc, and no one has run it end to end since these changes. Do a full run into a scratch folder
at some point (it checks free space, about 4.5 GB) and diff it against `data/`. Expect the room step to differ on `room_sky`.

## Page aids

Labelled PAGE AID, off unless asked for: `?warp=list|deck|stairs|market|chunk07|chunk09|chunk0b|boss|dogs`, `?ladder=N`, `H` (back to
spawn), `?intro=0` (skip the opening, start from the save), `?autoskip=0|1`, `?stage=0`, `?cull=0`, `?items=0`, `?props=0`, `?fx=0`,
`?sound=0`, `?enemydmg=0`, `?widehud=0`, `?res=native`.

Keys: WASD move, Shift run, Space jump, F reload, E use item, Q next item, Esc / Enter pause, ✕ = Space, R report.

## Review board

`/srv/shared/dirge-port/review/queue.json` is a list; edit it under `fcntl.flock`. New id = last id + random(10^12..10^13). Fields:
`id, title, ask, summary, images, status: "needs-review", created`. Copy images into that folder and use their file names. Title ends
`(already committed, <hash>)`. Verdicts arrive as `[review-board] ...` messages; treat them as Dan's own words. "Approved" means commit
once the code review passes. Dan's page reports (R key): `/srv/shared/dirge-port/reports/<id>/` with `meta.json`, `plain.png`, `marked.png`.

Still open on the board: Room fixes, Townspeople, Boss fight (Dan couldn't reach them before the jump links; send him the links).
"Item pickups" has a 'changes' verdict ("Popup doesn't block moving"): fixed since, so post a new item for it.

## Dan's last play-test list

Fixed, not yet confirmed by him: barrel and pickup sounds, the pickup box gate, reload glide, missing market buildings, mouths, stairs
cutscene, stairs soldiers.

Open:
- The market crash (step 3).
- "Enemy AI at the bottom section": dogs now chase and bite but aren't checked against the game (step 2).
- "Cameras not working properly": only the market case is explained. The full route was never walked on the page.

## Stray things

- `.claude/worktrees/agent-a96fb25f676bd5a75` is a leftover worktree, not from tonight's workers. Check it's unused, and leave it if unsure.
- A few orphaned `http.server` processes from crashed test runs may be running. Check before killing: other projects share this machine.

## When you finish

Everything pushed, then one short summary to Dan: what now works, what's still missing, and the links to play.

## 2026-11-08 playtest round (committed 07edd20)

Dan's playtest list was worked by workers 0265-0270, all reviewed, review fixes re-reviewed, full suite green (warp boss timing flake passed on rerun; char_light test race fixed). All workers retired. Board items posted for each issue. Still open: title card's bar groups/red dot and hold length; mouth timing gaps in sk_mituketa2; barrier lightning offset, barrels/camera vs barriers, door walls; boss blast unverified; cutscene actor footsteps, music delay, flushSoundEffect. Awaiting Dan: which scene is "save the abducted girl". Next worker number: 0271.

## 2026-11-09 fidelity audit (committed 3a81479)

Dan asked to validate 07edd20 against the game code. Workers 0271-0273 audited each hunk (TRANSLATED / DIFFERS / DERIVED / INVENTED), then fixed their findings; 0274 fixed the warp boss test timing. All reviewed and re-reviewed. Derived voice delay replaced by a translation of the PCM ring (BGM through it too); Restart/Skip SE ending decoded from iopsound.irx; warps use walked route states. Still open: title-card fade-in gap is disc read time (no load-time model); veil draw order GUESS; enemy-vs-barrier contact untraced; citizens' late flags GUESS; reload teardown sound GUESS; one-off scr005 load stall (diagnostics added). Next worker number: 0275.

## 2026-11-09/11 playtest round (committed 465f9a2)

Dan's list: scanner overlay (0275: it is Shelke's scope view; KerberosEffect translated, blue tint/bars/dial/TARGET still undecoded), "save the abducted girl" (0276: beast alley kidnap, clips in second motion files; awaiting Dan's confirmation it's the scene he meant), pause during pickup + jump noise (0277), bullet trails (0278), warp picker (0279, made mouse-only after review), cape in cutscenes (0280; p001's cloth still missing). Reviews 0282-0287, re-review 0288, suite fixes 0289/0290 (test races; the restart test pressed Start inside a peace..chaos window). Original workers were closed by the overnight idle cleanup before review fixes: hand fixes to the reviewer (role change) when that happens.

Direction change (Dan, 2026-11-09): the goal is a NATIVE C port for Windows; the browser build is the test bench. README updated. Migration plan: worker 0281 (brief in the manager's scratchpad briefs/w0281.txt; includes evaluating PS2Recomp, OpenGOAL's structure, splat/m2c). Next worker number: 0291.
