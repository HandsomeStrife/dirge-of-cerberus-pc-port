#!/usr/bin/env bash
# build_web.sh -- build the browser prototype's data (native/web/data) from YOUR disc image.
#
#   tools/byo/build_web.sh /path/to/your.iso
#
# Bring your own disc: nothing from the game is in this repository. This script reads your
# image, unpacks the game archive into <repo>/extract/ and writes the exported scene into
# native/web/data/ and native/assets/models/out/byo/. All three are gitignored. Never commit
# or upload them, the image, or anything made from them.
#
# Supported disc: Dirge of Cerberus: Final Fantasy VII, PAL SLES-54185 (Europe, Australia).
# Prerequisites: python3 (3.8+) with numpy and Pillow (OS packages or a venv: the build runs
# python3 -I, which ignores pip --user installs), a C compiler (cc/gcc/clang), make, git.
# Node.js is only needed for the optional tests. No zlib, no Docker, no PCSX2.
# Optional: ffmpeg plus the libavcodec / libavutil / libswresample dev packages (found with pkg-config)
# for the zone music; without them the music step is skipped and the page plays without music.
# Disk: about 4.5 GB free (1.5 GB archive copy, deleted after unpacking; ~1.3 GB unpacked).
#
# Re-running is safe: a verified extract is reused, outputs are overwritten in place.
#
# Options:
#   --re-extract   unpack again even if extract/ verifies (only replaces an extract this
#                  script made; it never deletes an extract/_KEL it did not create)
#   --no-motions   skip the motion catalogue (data/vincent/motions.json, reference only)
#   --state FILE   a PCSX2 save state (.p2s) of the sea-of-flames start, for the effects'
#                  random state (type 137 sparks). Without it the sparks are left out. The
#                  game's HUD is built from the disc (ELF + locale files) either way.
#   -h, --help
set -euo pipefail

REPO=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
BYO=$REPO/tools/byo
EXT=$REPO/extract
KEL=$EXT/_KEL
NOPATH=$KEL/noPath
STAMP=$KEL/.byo-extract
WORK=$EXT/.byo-work
MODELS=$REPO/native/assets/models
OUT=$MODELS/out/byo
LOGS=$OUT/logs
DATA=$REPO/native/web/data

# Clip packs play.html loads (native/web/ACTIONS.md). Order matters only for byte-identity.
# Every clip comes from the container z128 loads (07703200 common, 0770320b handgun; FUN_005a7390,
# export_web_vincent.py CLIP_SETS). jump: the plain set, the aimed set h_jp*_a (FUN_00598f50
# phases 4-7, the landing FUN_00599aa0, the air shot FUN_00596830) and the second / back jumps
# (c_wjp*, c_bj*, c_bwj*). The _au/_ad partners aren't played.
# c_std: the standing hit (class 0x3f); c_st_fa0: the death (class 0xb, held at its end).
# c_st_bl0 .. c_rev_r: the knock-down (FUN_005618d0: classes 0x33-0x3a, rows 0xa8, 0xab-0xb1, 0xe3, 0xe4).
PACK_JUMP=h_jp0,h_jp1,h_jp2,h_jp3,h_jp4,h_div,h_jp0_a,h_jp1_a,h_jp2_a,h_jp3_a,h_jp4_a,c_wjp0,c_wjp1,c_wjp2,c_bj0,c_bj1,c_bj2,c_bwj0,c_bwj1,c_bwj2,c_std,c_st_fa0,c_st_bl0,c_bl_0,c_bl_1,c_bl_ht0,c_jp_fa0,c_fl_0,c_fl_1,h_rev_0,c_rev_l,c_rev_r
PACK_LADDER=c_ld_d,c_ld_u,c_ld_jp,c_ld_fa0,c_ld_lid,c_ld_rid,c_ld_del,c_ld_uel,c_ld_dml,c_ld_uml,c_ld_der,c_ld_uer,c_ld_dmr,c_ld_umr,h_ld_del,h_ld_uel,h_ld_der,h_ld_uer
PACK_SHOOT=h_wk_a,h_rn_a,h_sq_a,h_st_a,h_sq_f,h_st_f,h_wk_ad,h_rn_ad,h_sq_ad,h_st_ad,h_sq_fd,h_st_fd,h_wk_rd,h_rn_rd,h_sq_rd,h_st_rd,h_swtch,h_wk_au,h_rn_au,h_sq_au,h_st_au,h_sq_fu,h_st_fu,h_fwk_rd,h_sqm_rd,h_frn_rd,h_brn_a,h_brn_au,h_brn_ad,h_lrn_a,h_lrn_au,h_lrn_ad,h_rrn_a,h_rrn_au,h_rrn_ad
# GUESS: the static Vincent in index.html is clip h_st frame 91, the clip frame nearest the hero
# capture (not decoded; see docs/BROWSER.md "Known limitations" and NODUMP_PLACEMENT).
STATIC_CLIP=h_st
STATIC_FRAME=91

ISO=""; REEXTRACT=0; MOTIONS=1; STATE=""
usage() { sed -n '2,29p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }
while [ $# -gt 0 ]; do
  case "$1" in
    --re-extract) REEXTRACT=1 ;;
    --no-motions) MOTIONS=0 ;;
    --state) [ $# -ge 2 ] || { echo "--state needs a file" >&2; exit 2; }; STATE=$2; shift ;;
    -h|--help) usage; exit 0 ;;
    -*) echo "unknown option $1" >&2; usage >&2; exit 2 ;;
    *) [ -z "$ISO" ] || { echo "one image only" >&2; exit 2; }; ISO=$1 ;;
  esac
  shift
done
[ -n "$ISO" ] || { usage >&2; exit 2; }
# absolute, since the export steps run from native/assets/models
abspath() { case "$1" in /*) printf '%s\n' "$1" ;; *) printf '%s/%s\n' "$(pwd)" "$1" ;; esac; }
ISO=$(abspath "$ISO")
[ -z "$STATE" ] || STATE=$(abspath "$STATE")

# Some exporters read tables (the sound names, the BGM / string scramble keys, ...) from the ELF at
# run time. A hash-checked copy lives in extract/.byo-elf (gitignored) only while the build runs.
ELFDIR=$EXT/.byo-elf
ELF=$ELFDIR/SLES_541.85
rm -rf "$ELFDIR"                     # a leftover from an interrupted run
trap 'rm -rf "$ELFDIR"' EXIT

# Don't silently replace a web build that this script didn't make (e.g. a capture-based
# developer build, which has the sky and the capture placement). BYO_FORCE=1 overrides.
if [ -f "$DATA/scene.json" ] && [ ! -f "$DATA/.byo-build" ] && [ "${BYO_FORCE:-0}" != 1 ]; then
    echo "error: $DATA already holds a web build not made by this script." >&2
    echo "       Move it aside, or rerun with BYO_FORCE=1 to replace it." >&2
    exit 1
fi

T0=$(date +%s)
step() { printf '\n==> %s\n' "$*"; }
fail() { printf '\nbuild_web.sh: FAILED: %s\n' "$*" >&2; exit 1; }
# run NAME CMD...: log to $LOGS/NAME.log, show the tail on failure
run() {
  local name=$1; shift
  if ! "$@" > "$LOGS/$name.log" 2>&1; then
    echo "--- last lines of $LOGS/$name.log:" >&2
    tail -n 25 "$LOGS/$name.log" >&2
    fail "step '$name' (full log: $LOGS/$name.log)"
  fi
}
PY="python3 -I"

# ------------------------------------------------------------------ 0. prerequisites
step "checking prerequisites"
missing=()
command -v python3 >/dev/null || missing+=("python3 (3.8 or newer)")
command -v git >/dev/null || missing+=("git")
command -v make >/dev/null || missing+=("make")
CC_FOUND=""
for c in "${CC:-}" cc gcc clang; do
  [ -n "$c" ] && command -v "$c" >/dev/null && { CC_FOUND=$c; break; }
done
[ -n "$CC_FOUND" ] || missing+=("a C compiler (cc, gcc or clang)")
[ ${#missing[@]} -eq 0 ] || fail "missing: ${missing[*]}. Install them and run again (docs/BROWSER.md)."
$PY -c 'import sys; sys.exit(0 if sys.version_info >= (3, 8) else 1)' ||
  fail "python3 is $(python3 -V 2>&1); 3.8 or newer is needed"
$PY -c 'import numpy' 2>/dev/null || fail "python3 -I sees no numpy (OS package python3-numpy, or pip install inside a venv; a pip --user install is not seen)"
$PY -c 'import PIL' 2>/dev/null || fail "python3 -I sees no Pillow (OS package python3-pil, or pip install inside a venv; a pip --user install is not seen)"
git -C "$REPO" rev-parse --git-dir >/dev/null 2>&1 || fail "$REPO is not a git checkout (clone the repo; the exporters use git check-ignore)"
# probe.md: .md is on the allow-list, so it is only ignored by the directory rule itself;
# the other names are the kinds of file the build writes there
for d in extract extract/_KEL/noPath extract/.byo-elf native/web/data native/web/data/vincent native/web/data/audio native/web/data/audio/bgm native/assets/models/out/byo; do
  for f in probe.md probe.bin probe.json probe.glb probe.rgba probe.png probe.log probe.flac probe.fed probe.85; do
    git -C "$REPO" check-ignore -q "$d/$f" ||
      fail "$d/$f would not be gitignored: refusing to write game data there. Restore .gitignore (git checkout .gitignore)."
  done
done
[ -f "$ISO" ] || fail "no such file: $ISO"
[ -z "$STATE" ] || [ -f "$STATE" ] || fail "no such save state: $STATE"
echo "python3 $($PY -c 'import sys,numpy,PIL; print(sys.version.split()[0], "numpy", numpy.__version__, "Pillow", PIL.__version__)'), cc=$CC_FOUND, make, git: ok"
command -v node >/dev/null && echo "node $(node -v): ok (optional, for tests)" || echo "node: not found (optional, only for tests)"
MUSIC=0
if command -v ffmpeg >/dev/null && command -v pkg-config >/dev/null && pkg-config --exists libavcodec libavutil libswresample; then
  MUSIC=1; echo "ffmpeg + libavcodec: ok (optional, for the zone music)"
else
  echo "ffmpeg / libavcodec dev packages: not found (optional; the build skips the zone music)"
fi
mkdir -p "$LOGS"

# ------------------------------------------------------------------ 1. the disc
step "checking the disc image"
$PY "$BYO/disc.py" check "$ISO" || fail "unsupported or damaged disc image (see above)"

# ------------------------------------------------------------------ 2. unpack
step "unpacking the game archive into extract/ (gitignored)"
have_extract=0
if [ -d "$NOPATH" ] && [ $REEXTRACT -eq 0 ]; then
  if $PY "$BYO/disc.py" verify "$NOPATH" >/dev/null 2>&1; then
    have_extract=1
    echo "extract/_KEL/noPath verifies: reusing it (--re-extract to unpack again)"
  elif [ ! -f "$STAMP" ]; then
    $PY "$BYO/disc.py" verify "$NOPATH" | tail -n 5 || true
    fail "extract/_KEL exists, was not made by this script, and does not match the supported disc. Move it away (it is not deleted automatically) and run again."
  fi
fi
if [ $have_extract -eq 0 ]; then
  if [ -d "$KEL" ] && [ ! -f "$STAMP" ]; then
    fail "extract/_KEL exists and was not made by this script; move it away first (not deleted automatically)"
  fi
  if [ -d "$KEL" ]; then
    # this script's own extract: --re-extract, or an older one without the files this build reads
    [ $REEXTRACT -eq 1 ] && echo "--re-extract: unpacking again" ||
      echo "older extract (made by this script, but missing or different inputs): unpacking again"
  fi
  # free space, counting what this script will delete first (its old extract and leftovers of an
  # interrupted run); nothing is deleted unless the check passes
  NEED_KB=4500000
  df_kb=$(df -Pk "$REPO" | awk 'NR==2 {print $4}')
  old_kb=0
  for d in "$KEL" "$KEL.tmp" "$WORK"; do
    if [ -e "$d" ]; then old_kb=$((old_kb + $(du -sk "$d" | cut -f1))); fi
  done
  [ $(( ${df_kb:-0} + old_kb )) -ge $NEED_KB ] ||
    fail "need about 4.5 GB free on $(df -P "$REPO" | awk 'NR==2 {print $6}'), have $((df_kb / 1024)) MB (+ $((old_kb / 1024)) MB of old extract this script would replace). Nothing was deleted."
  rm -rf "$KEL" "$WORK" "$KEL.tmp"
  run disc_extract $PY "$BYO/disc.py" extract "$ISO" "$WORK"
  grep 'KEL.DAT  ' "$LOGS/disc_extract.log" | sed 's/^/  /'
  echo "  unpacking KEL.DAT (a few minutes)"
  # .bin: models, stages, textures, menus; .fed: effects; .irx + .wd: the sound driver and wave
  # banks; .at3: the music (only the zone's track is kept, the other ~380 streams are deleted)
  run kel_unpack $PY "$REPO/tools/kel_unpack.py" "$WORK/FILELIST.BIN" "$WORK/KEL.DAT" "$KEL.tmp" bin,fed,irx,wd,at3,at2
  tail -n 1 "$LOGS/kel_unpack.log" | sed 's/^/  /'
  grep -q ' fail=0$' "$LOGS/kel_unpack.log" || fail "kel_unpack reported failures (see $LOGS/kel_unpack.log)"
  (cd "$KEL.tmp" && find . -name '*.at3' ! -path ./data/zone/z128/sound/bgm_001.at3 ! -path ./data/zone/z128/sound/bgm_012.at3 \
    ! -path ./data/zone/z128/sound/bgm_013.at3 ! -path ./data/zone/z128/sound/bgm_014.at3 ! -path ./data/zone/z128/sound/bgm_018.at3 ! -path ./data/zone/z128/sound/bgm_274.at3 -delete)
  # .at2: only the opening event's voices (tools/audio/voice.py; worker 0222)
  (cd "$KEL.tmp" && find . -name '*.at2' ! -path ./data/event/scene/ev0100/sound/10109vn.at2 \
    ! -path ./data/event/scene/ev0100/sound/10109v2.at2 ! -path ./data/event/scene/ev0100/sound/10110sk.at2 \
    ! -path ./data/event/scene/ev0100/sound/10201vn.at2 -delete)
  $PY "$BYO/disc.py" verify "$KEL.tmp/noPath" || fail "the unpacked files do not match the supported disc"
  date -u +%Y-%m-%dT%H:%M:%SZ > "$KEL.tmp/.byo-extract"
  rm -rf "$KEL"
  mv "$KEL.tmp" "$KEL"
  rm -rf "$WORK"
  echo "  extract/_KEL ready ($(du -sh "$KEL" | cut -f1))"
fi

# ------------------------------------------------------------------ 3. native tools
step "building the native tools (dtex texture decoder, cidweb collision exporter)"
run make_dtex make -C "$REPO/native/assets/textures" CC="$CC_FOUND"
run make_cidweb make -C "$REPO/native/assets/collision" CC="$CC_FOUND" cidweb
echo "ok"

# ------------------------------------------------------------------ 4. exports
cd "$MODELS"
mkdir -p "$DATA" "$OUT"
# mark the data as this script's before the first write, so a re-run after a failed
# step passes the guard at the top
touch "$DATA/.byo-build"
run elf $PY "$BYO/disc.py" elf "$ISO" "$ELF"
step "room z128: 13 geometry chunks, textures from the files, fog from the BMD env block"
run room $PY export_z128_room.py -o "$OUT/z128_room/room"
echo "ok ($(grep -c . "$OUT/z128_room/room.list") lines in room.list; no sky dome: it only exists in a GS capture)"

step "static Vincent for the viewer (clip $STATIC_CLIP frame $STATIC_FRAME, placement GUESS)"
run p000_static $PY export_p000_gpu2.py --no-dump "$OUT/p000_static" --clip "$STATIC_CLIP" --frame "$STATIC_FRAME"
echo "ok"

step "scene.json + room/Vincent meshes and textures -> native/web/data"
run web_room $PY export_web_room.py --room "$OUT/z128_room/room.list" --char "$OUT/p000_static" -o "$DATA"
tail -n 1 "$LOGS/web_room.log"

step "collision (DCOL v2 with the walk mesh)"
run collision make -C "$REPO/native/assets/collision" CC="$CC_FOUND" KEL="$NOPATH" z128web
cp "$REPO/native/assets/collision/out/web/z128_collision.bin" "$DATA/z128_collision.bin"
cp "$REPO/native/assets/collision/out/web/z128_collision.bin.shade" "$DATA/z128_walk_shade.bin"   # corner shades: floor_shade.js
echo "ok"

step "room visibility probe (cid +0x58 class-0x80 packets + surface tables, FUN_00264ee0)"
run cidvis make -C "$REPO/native/assets/collision" CC="$CC_FOUND" cidvis
run room_vis "$REPO/native/assets/collision/cidvis" "$DATA/z128_vis.json" "$NOPATH"/0680?[0-9a-c]11.bin
echo "ok"

step "ladders (stage file section 8)"
run ladders $PY export_web_ladders.py "$NOPATH/06800001.bin" "$DATA/z128_collision.bin" "$DATA/z128_ladders.json"
echo "ok"

step "Vincent for play.html: skinned glb + walk/run/idle clips + cape cloth data"
# the default export also runs its cloth step (export_web_vincent.py cloth): data/vincent/
# cloth.json, the cape's cloth group, skin and clip windows for native/web/cloth.js
run vincent $PY export_web_vincent.py export --no-dump
[ -s "$DATA/vincent/cloth.json" ] || fail "data/vincent/cloth.json missing after the vincent export (log: $LOGS/vincent.log)"
# the locomotion clips' local TRS (player.js builds the pose the game's way, FUN_005a9db0)
[ -s "$DATA/vincent/vincent_local.bin" ] || fail "data/vincent/vincent_local.bin missing after the vincent export (log: $LOGS/vincent.log)"
grep 'cloth.json' "$LOGS/vincent.log" | tail -n 1 | sed "s#$REPO/##" | cut -c1-160
echo "ok"

step "Vincent's light rig (env slot + every chunk's light grid + the area boxes -> data/vincent/light.json)"
run light $PY export_web_light.py "$DATA/vincent"
tail -n 1 "$LOGS/light.log" | sed "s#$REPO/##"
for p in jump ladder shoot; do
  case $p in jump) clips=$PACK_JUMP ;; ladder) clips=$PACK_LADDER ;; shoot) clips=$PACK_SHOOT ;; esac
  step "clip pack: $p"
  run "pack_$p" $PY export_web_vincent.py export --no-dump --clips "$clips" --pack "$p"
  # the pack clips' local TRS (vincent_<pack>_local.bin, same format as vincent_local.bin)
  [ -s "$DATA/vincent/vincent_${p}_local.bin" ] || fail "data/vincent/vincent_${p}_local.bin missing after the $p pack export (log: $LOGS/pack_$p.log)"
  tail -n 1 "$LOGS/pack_$p.log" | cut -c1-160
done

step "Vincent's gun (Cerberus)"
run gun $PY export_web_gun.py --no-dump "$DATA/vincent"
echo "ok"

step "enemy e027 (z128 soldier): skinned glb per variant + r_gst idle -> data/enemies"
# clips: r_gst idle, r_gst_lk, r_st_a / r_st_f (enemy_ai.js), r_stlld0 / r_stlaf0 / r_stbf0 (hit / death, notes/enemy-research.md §10);
# the m_* rows of stance 0x1e (class-2 weapons, FUN_00564228) for the same motions (ai.json model_clips lists them);
# r_gwk / r_grn (+ m_*): the walk / run rows 9 / 0x10 of the locomotion table (motion state 8, path walking);
# r_sq_a / r_sq_f / m_sq_*: crouched aim / fire (brain mode 1's posture change, motions 0x78 / 0x7b);
# r_atk_0 / m_atk: the attack tables' play-clip commands (zone sets 7 / 6, ai.json attacks)
run enemy_e027 $PY export_web_enemy.py export --model e027 --out "$DATA/enemies" --clips r_gst,r_gst_lk,r_st_a,r_st_f,r_stlld0,r_stlaf0,r_stbf0,m_gst,m_st_a,m_st_f,m_stlld0,m_stlaf0,m_stbf0,r_sq_a,r_sq_f,m_sq_a,m_sq_f,r_atk_0,m_atk,r_gwk,r_grn,m_gwk,m_grn,r_para00,r_para10,r_para01,r_para11,r_para02,r_para12,r_para03,r_para13,m_sthd0,m_stbd0,m_stlad0,m_strad0,m_strld0,m_sthf0,m_straf0,m_stllf0,m_strlf0,r_sthd0,r_stbd0,r_stlad0,r_strad0,r_strld0,r_sthf0,r_straf0,r_stllf0,r_strlf0
[ -s "$DATA/enemies/e027.glb" ] || fail "data/enemies/e027.glb missing after the enemy export (log: $LOGS/enemy_e027.log)"
grep '^wrote' "$LOGS/enemy_e027.log" | sed "s#$REPO/##" | cut -c1-160
echo "ok"

step "z128's other enemy types (stage section 1: e048, e030, e036, e023, e024, e001) -> data/enemies"
# Same decode as e027; one idle clip each (GUESS which idle the game starts: enemies.js IDLE, notes/enemy-model.md),
# e048 / e030: the clips of the motions enemy_ai.js requests (their stance rows and attack tables, ai.json model_clips)
E048_CLIPS=r_gst,r_gst_lk,r_st_a,r_st_f,r_stlld0,r_stlaf0,r_stbf0,m_gst,m_gst_lk,m_st_a,m_st_f,m_stlld0,m_stlaf0,m_stbf0,r_sq_a,r_sq_f,m_sq_a,m_sq_f,m_atk,r_atk,m_gwk,m_grn,m_sthd0,m_stbd0,m_stlad0,m_strad0,m_strld0,m_sthf0,m_straf0,m_stllf0,m_strlf0,r_gwk,r_grn,r_sthd0,r_stbd0,r_stlad0,r_strad0,r_strld0,r_sthf0,r_straf0,r_stllf0,r_strlf0
E030_CLIPS=st_a,look,stld0,stbf0,jp0,jp1,jp2,jp3,jp4,atk_0,atk_1,atk_2,atk_3,b_stp,st_btl,lhtn,rhtn,wk_a,rn_a,stbd0,sthf0,stlf0
# worker 0230: e036 runs the soldiers' AI (enemy_ai AI_TYPES): its stance-0x1e rows and attack clip (ai.json model_clips)
E036_CLIPS=m_gst,m_gst_lk,m_st_a,m_st_f,m_stlld0,m_stbf0,m_stlaf0,m_sq_a,m_gwk,m_grn,m_atk_0,m_sthd0,m_stbd0,m_stlad0,m_strad0,m_strld0,m_sthf0,m_straf0,m_stllf0,m_strlf0
# e001: its stance-0x10 rows and attack clip (m001 0765004b; ai.json model_clips)
E001_CLIPS=a_st,a_atk_1,a_stlld0,a_dead,a_wk,a_rn,n_ude,a_lhtn,a_rhtn,a_sthd0,a_stbd0,a_stlad0,a_strad0,a_strld0
# worker 0259: e023's flight clips (script 29 / 180 cmd 0x19b, motion class 0x42; bone 1 carries the world path; notes/other-types.md)
E023_CLIPS=idle,sp0_0,sp1_0,ms4_0,mv4_0,eva_0,evb_0,ms0_1,mv0_1,ms1_2,mv1_2,sp2_2,sp3_2,sp2_3,ms2_3,mv2_3,sp4_3,sp0_4,sp1_4,ms3_4,mv3_4
# worker 0231: e024 (the z128 boss) also takes the clips its overlay brain sets by name (FUN_00344840; notes/boss-research.md)
E024_CLIPS=idle,l_trn,r_trn,atk_sp1,atk_sp2,atk_sp3,idl_lean,lean,lean_idl
for mc in e048:$E048_CLIPS e030:$E030_CLIPS e036:$E036_CLIPS e023:$E023_CLIPS e024:$E024_CLIPS e001:n_st,$E001_CLIPS; do
  m=${mc%%:*}
  run enemy_$m $PY export_web_enemy.py export --model $m --out "$DATA/enemies" --clips ${mc#*:}
  [ -s "$DATA/enemies/$m.glb" ] || fail "data/enemies/$m.glb missing after the enemy export (log: $LOGS/enemy_$m.log)"
  grep '^wrote' "$LOGS/enemy_$m.log" | sed "s#$REPO/##" | cut -c1-160
done
echo "ok"

step "z128's townspeople and WRO men (stage section 1 n0xx records) -> data/enemies"
# worker 0223 (notes/npc-research.md): the stance's row-0 idle (FUN_00564228: r_gst for the WRO men, st for the rest)
# and the clips their scripts request with cmd 0x141 (fear, fear2, fear3, breath1 / 2, r_gst_lk, r_look, m_look).
# worker 0228: + the stance rows the townspeople's actors reach (enemy_ai NPC_TYPES): look, wk / rn (path runs, motion 3) and
# dead1-3 (death rows 0x2a-0x35), where the model's motion file 0 has them.
D3=rn,look,dead1,dead2,dead3
for mc in n017:r_gst,r_gst_lk,r_look n018:r_gst,r_gst_lk n022:r_gst,m_look n023:st,breath1,fear,$D3 n024:st,fear,fear2,fear3,$D3 \
          n025:st,fear,$D3 n026:st,fear,fear3,$D3 n028:st,fear,wk,rn,look n029:st,fear,$D3 n030:st,fear,$D3 n031:st,breath2,fear,$D3 \
          n032:st,fear,$D3 n033:st,fear,wk,rn,look n034:st,fear,wk,rn,look; do
  m=${mc%%:*}
  run enemy_$m $PY export_web_enemy.py export --model $m --out "$DATA/enemies" --clips ${mc#*:}
  [ -s "$DATA/enemies/$m.glb" ] || fail "data/enemies/$m.glb missing after the NPC export (log: $LOGS/enemy_$m.log)"
done
echo "ok"

step "enemy weapons (e027 slot 0: parameter set +0x44 -> w003 / w004 at marker 15) -> data/enemies"
# inputs 077700c1/c2 (w003) and 07770101/02 (w004), checked by disc.py verify; the skip only guards a partial tree
if [ -s "$NOPATH/077700c1.bin" ] && [ -s "$NOPATH/077700c2.bin" ] && [ -s "$NOPATH/07770101.bin" ] && [ -s "$NOPATH/07770102.bin" ]; then
  run enemy_weapons $PY export_web_enemy.py weapon --owner e027 --slot 0 --out "$DATA/enemies"
  [ -s "$DATA/enemies/e027_weapons.json" ] || fail "data/enemies/e027_weapons.json missing (log: $LOGS/enemy_weapons.log)"
  grep '^wrote' "$LOGS/enemy_weapons.log" | sed "s#$REPO/##" | cut -c1-160
  # e048 (w003 / w004) and e036 (w004) carry the same weapons at marker 15 (offset 0): map only, own socket bone
  for o in e048 e036; do
    run enemy_weapons_$o $PY export_web_enemy.py weapon --owner $o --slot 0 --out "$DATA/enemies" --map-only
    [ -s "$DATA/enemies/${o}_weapons.json" ] || fail "data/enemies/${o}_weapons.json missing (log: $LOGS/enemy_weapons_$o.log)"
    grep '^wrote' "$LOGS/enemy_weapons_$o.log" | sed "s#$REPO/##" | cut -c1-160
  done
  echo "ok"
else
  echo "skipped: weapon files 077700c1/c2, 07770101/02 not extracted (soldiers drawn without rifles)"
fi

step "enemy placements (stage file sections 0/1: stage-load e027s -> data/enemies/placements.json)"
run enemy_placements $PY export_web_placements.py "$NOPATH/06800001.bin" "$DATA/enemies"
[ -s "$DATA/enemies/placements.json" ] || fail "data/enemies/placements.json missing (log: $LOGS/enemy_placements.log)"
head -n 1 "$LOGS/enemy_placements.log" | cut -c1-160
# trigger volumes + scripts -> data/enemies/ai.json (enemy_ai.js); the sound-name tables come from the ELF
run enemy_ai $PY export_web_triggers.py "$NOPATH/06800001.bin" "$DATA/enemies" "$ELF"
[ -s "$DATA/enemies/ai.json" ] || fail "data/enemies/ai.json missing (log: $LOGS/enemy_ai.log)"
grep '^wrote' "$LOGS/enemy_ai.log" | sed "s#$REPO/##" | cut -c1-160

step "explosive barrels (stage file sections 14/15: e057 gimmicks -> data/props/props.json; model e057 -> data/props)"
# props.js / props_view.js; notes/barrel-research.md. The model has no clips (--clips '').
run props $PY export_web_props.py "$NOPATH/06800001.bin" "$DATA/props"
[ -s "$DATA/props/props.json" ] || fail "data/props/props.json missing (log: $LOGS/props.log)"
run props_e057 $PY export_web_enemy.py export --model e057 --out "$DATA/props" --clips ''
[ -s "$DATA/props/e057.glb" ] || fail "data/props/e057.glb missing (log: $LOGS/props_e057.log)"
grep '^wrote' "$LOGS/props.log" "$LOGS/props_e057.log" | sed "s#$REPO/##" | cut -c1-160
echo "ok"

step "item pickups and drops (stage sections 0/1/14/15, bgd.bin items, ELF tables -> data/items/items.json; models g038 g039 g040 g041 g058 g067 g068)"
# items.js / items_view.js; notes/items-research.md (worker 0224). The models have no clips (--clips '').
run items $PY export_web_items.py --elf "$ELF" --stage "$NOPATH/06800001.bin" --bgd "$KEL/data/bgd/bgd.bin" -o "$DATA/items/items.json"
[ -s "$DATA/items/items.json" ] || fail "data/items/items.json missing (log: $LOGS/items.log)"
# g058: the boss e024's death drop (worker 0237; notes/boss-research.md)
for m in g038 g039 g040 g041 g058 g067 g068; do
  run items_$m $PY export_web_enemy.py export --model $m --out "$DATA/items" --clips ''
  [ -s "$DATA/items/$m.glb" ] || fail "data/items/$m.glb missing (log: $LOGS/items_$m.log)"
done
grep -h '^wrote' "$LOGS/items.log" | sed "s#$REPO/##" | cut -c1-160
echo "ok"

step "the opening cutscene's hand-off (ev0100 scr001 class + its battle clips, ELF table) -> data/checkpoint.json"
run checkpoint $PY export_web_checkpoint.py --elf "$ELF" --nopath "$NOPATH" --placements "$DATA/enemies/placements.json" -o "$DATA/checkpoint.json"
[ -s "$DATA/checkpoint.json" ] || fail "data/checkpoint.json missing (log: $LOGS/checkpoint.log)"
tail -n 1 "$LOGS/checkpoint.log" | sed "s#$REPO/##" | cut -c1-160

step "the opening event (ev0100 scr001 class + the ELF's event library classes) -> data/event (intro.js)"
run event $PY export_web_event.py --elf "$ELF" --nopath "$NOPATH" -o "$DATA/event/ev0100_scr001.json"
[ -s "$DATA/event/ev0100_scr001.json" ] || fail "data/event/ev0100_scr001.json missing (log: $LOGS/event.log)"
tail -n 1 "$LOGS/event.log" | sed "s#$REPO/##" | cut -c1-160

step "the stage controller (ev0100 scr000..scr007 classes + the ELF's event library + their camera files) -> data/event (stage_controller.js)"
run stage $PY export_web_stage.py --elf "$ELF" --nopath "$NOPATH" -o "$DATA/event/ev0100_stage.json"
[ -s "$DATA/event/ev0100_stage.json" ] || fail "data/event/ev0100_stage.json missing (log: $LOGS/stage.log)"
tail -n 1 "$LOGS/stage.log" | sed "s#$REPO/##" | cut -c1-160

step "the opening event's actors (models + event motion files) -> data/event/actors (event_actors.js)"
run event_actors $PY export_web_event_actors.py --event "$DATA/event/ev0100_scr001.json" -o "$DATA/event/actors"
[ -s "$DATA/event/actors/actors.json" ] || fail "data/event/actors/actors.json missing (log: $LOGS/event_actors.log)"
tail -n 1 "$LOGS/event_actors.log" | sed "s#$REPO/##" | cut -c1-160

step "weapon stats + reticle tables and texture (bgd.bin parts, menudata.bin menu2, ELF from the disc) -> data/aim"
run aim $PY export_web_aim.py --iso "$ISO" -o "$DATA/aim"
tail -n 1 "$LOGS/aim.log"


step "effects: resident effect files r0001.fed / r0000.fed, z128 area FEDs, texture pack core_ef.bin, id tables from the ELF -> data/effects"
# export_web_effects.py also declares "effects" in scene.json (play.js loads the effects only then).
# It takes the effect random generator's state from --state (the type 137 sparks); an empty
# --state (none given) leaves it out, so the sparks are off.
run effects $PY export_web_effects.py --extract "$KEL" --elf "$ELF" -o "$DATA/effects" --state "$STATE"
for f in r0001.fed r0000.fed core_ef.bin z128_a0.fed z128_a1.fed z128_a2.fed ids.json; do
  [ -s "$DATA/effects/$f" ] || fail "data/effects/$f missing after the effects export (log: $LOGS/effects.log)"
done
tail -n 1 "$LOGS/effects.log" | cut -c1-160

step "pause menu: layouts, images, font and messages (ELF + locale uk menudata/fontdata1/kelstr) -> data/pause.json"
run pause $PY export_web_pause.py --elf "$ELF" --disc "$KEL" -o "$DATA/pause.json"
[ -s "$DATA/pause.json" ] || fail "data/pause.json missing (log: $LOGS/pause.log)"
tail -n 1 "$LOGS/pause.log" | cut -c1-160

step "game over menu: layout 0x477c38, sequence table, messages (ELF + locale uk kelstr), title FED a0097 -> data/gameover.json + gameover_title.fed"
run gameover $PY export_web_gameover.py --elf "$ELF" --disc "$KEL" -o "$DATA/gameover.json"
[ -s "$DATA/gameover.json" ] || fail "data/gameover.json missing (log: $LOGS/gameover.log)"
[ -s "$DATA/gameover_title.fed" ] || fail "data/gameover_title.fed missing (log: $LOGS/gameover.log)"

step "stage-info boxes (displayStageInfo): step tables, layouts, '$' codes (ELF), MES_ITEM texts (ev0100 messages 0c0641ca), box FED a0211 -> data/stage_info.json + stage_info.fed"
run stageinfo $PY export_web_stageinfo.py --elf "$ELF" --disc "$KEL" -o "$DATA/stage_info.json"
[ -s "$DATA/stage_info.json" ] || fail "data/stage_info.json missing (log: $LOGS/stageinfo.log)"
tail -n 1 "$LOGS/stageinfo.log" | cut -c1-160
echo "ok"

step "level end / Status results screen: step table, layouts, tables (ELF), texts (kelstr.bin), KerberosIntermissionCalc.class, the screen's FED a0093 -> data/results.json + results.fed"
run results $PY export_web_results.py --elf "$ELF" --disc "$KEL" -o "$DATA/results.json"
[ -s "$DATA/results.json" ] || fail "data/results.json missing (log: $LOGS/results.log)"
tail -n 1 "$LOGS/results.log" | cut -c1-160
echo "ok"

step "menu layout scripts (ELF) -> data/menu.json (read by the menu layout tests)"
run menu $PY export_web_menu.py --elf "$ELF" -o "$DATA/menu.json"
[ -s "$DATA/menu.json" ] || fail "data/menu.json missing (log: $LOGS/menu.log)"
echo "ok"

step "the game's HUD (ELF layout scripts + set-up, locale uk menudata/fontdata1/kelstr) -> data/hud"
# export_web_hud.py builds the element tree as FUN_003ad618 does (no save state) and declares
# "hud" in scene.json (play.js draws the HUD only then)
run hud $PY export_web_hud.py --iso "$ISO" --locale "$KEL/data/etc/locale/uk" -o "$DATA/hud"
[ -s "$DATA/hud/hud.json" ] || fail "data/hud/hud.json missing (log: $LOGS/hud.log)"
tail -n 1 "$LOGS/hud.log" | cut -c1-160

step "sound effects: driver tables (iopsound.irx), z128 + resident SE programs and names, menu names (ELF), wave banks -> data/audio"
run audio $PY "$REPO/tools/audio/extract.py" --kel "$KEL" --elf "$ELF" --zone 128 --out "$DATA/audio"
[ -s "$DATA/audio/se_z128.json" ] || fail "data/audio/se_z128.json missing (log: $LOGS/audio.log)"
head -n 1 "$LOGS/audio.log" | cut -c1-160

step "placed sounds (stage section 22) + Vincent's footstep data (cue table, ELF material map, mkd markers) -> data/audio"
# ambient.js (worker 0215; notes/audio-research.md "Placed sounds", "Footsteps")
run ambient $PY export_web_ambient.py "$NOPATH/06800001.bin" "$NOPATH/07703201.bin" "$ELF" "$DATA/audio/ambient_z128.json"
[ -s "$DATA/audio/ambient_z128.json" ] || fail "data/audio/ambient_z128.json missing (log: $LOGS/ambient.log)"
tail -n 1 "$LOGS/ambient.log" | sed "s#$REPO/##" | cut -c1-160

if [ $MUSIC -eq 1 ]; then
  step "zone music bgm_001 + 012 / 013 / 014 / 018 + the opening's 274 (ATRAC3 descrambled with the ELF's keys, decoded, FLAC) -> data/audio/bgm"
  if ! make -C "$REPO/native/assets/audio" CC="$CC_FOUND" dirge_atdec > "$LOGS/make_atdec.log" 2>&1; then
    tail -n 10 "$LOGS/make_atdec.log" >&2
    echo "warning: dirge_atdec did not compile (log: $LOGS/make_atdec.log): the zone music is skipped." >&2
    MUSIC=0
  fi
fi
if [ $MUSIC -eq 1 ]; then
  # bgm.py also adds "bgm" to se_z128.json (music.js fetches bgm.json only then), so it runs after extract.py
  run music $PY "$REPO/tools/audio/bgm.py" --kel "$KEL" --elf "$ELF" --zone 128 --out "$DATA/audio/bgm" --names bgm_001 bgm_012 bgm_013 bgm_014 bgm_018 bgm_274
  [ -s "$DATA/audio/bgm/bgm_001.flac" ] || fail "data/audio/bgm/bgm_001.flac missing (log: $LOGS/music.log)"
  echo "ok"
  step "the opening event's voices (ATRAC3 .at2, decoded, FLAC) -> data/audio/voice"
  if [ -s "$KEL/data/event/scene/ev0100/sound/10109vn.at2" ]; then
    run voice $PY "$REPO/tools/audio/voice.py" --kel "$KEL" --zone 128 --event 100 --out "$DATA/audio/voice"
    echo "ok"
  else
    echo "skipped: the extract predates the voices (delete $KEL and run again to unpack them); the opening plays without voices."
  fi
else
  step "zone music: skipped (needs ffmpeg, the libavcodec / libavutil / libswresample dev packages and a dirge_atdec that compiles)"
  echo "play.html runs without music (sound effects still play)."
fi

if [ $MOTIONS -eq 1 ]; then
  step "motion catalogue (data/vincent/motions.json, reference only)"
  run motions $PY export_web_vincent.py catalogue
  echo "ok"
fi

# ------------------------------------------------------------------ 5. done
python3 - "$DATA/byo-build.json" "$ISO" "$REPO" <<'PYEOF'
import json, os, subprocess, sys, time
out, iso, repo = sys.argv[1:4]
rev = subprocess.run(['git', '-C', repo, 'rev-parse', '--short', 'HEAD'], capture_output=True, text=True).stdout.strip()
dirty = subprocess.run(['git', '-C', repo, 'status', '--porcelain', '--untracked-files=no'],
                       capture_output=True, text=True).stdout.strip() != ''
json.dump(dict(built=time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), commit=rev + ('+local changes' if dirty else ''),
               disc='SLES_541.85', image_bytes=os.path.getsize(iso), dump_free=True,
               note='built by tools/byo/build_web.sh from the user\'s own disc; game-derived, do not share'),
          open(out, 'w'), indent=1)
PYEOF
n=$(find "$DATA" -type f | wc -l); sz=$(du -sh "$DATA" | cut -f1)
printf '\nDone in %ss: %s files, %s in native/web/data (gitignored: never commit or upload it).\n' "$(( $(date +%s) - T0 ))" "$n" "$sz"
cat <<EOF

Serve it (pick one), then open the printed address in a browser with WebGL:

  tools/byo/serve.sh            python3 http.server on http://127.0.0.1:8000/  (no Docker)
  tools/byo/serve.sh docker     nginx + the optional Report backend, http://127.0.0.1:8796/

  Pages:  index.html  free-camera viewer     play.html  walk Vincent around
  The pages load three.js from cdn.jsdelivr.net, so the browser needs internet access.
  Without the Docker option the Report button (R) can't save; everything else works.
EOF
