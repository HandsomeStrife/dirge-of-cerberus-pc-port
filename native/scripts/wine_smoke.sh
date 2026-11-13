#!/usr/bin/env bash
# wine_smoke.sh -- run the Windows build under wine (on an Xvfb display) for N ticks and check its state hash.
#
#   native/scripts/wine_smoke.sh [ticks=300]
#
# Needs: cmake --build --preset windows (dirge.exe + SDL2.dll in native/build/windows/game), wine64, xvfb-run,
# and the BYO data (native/web/data, tools/byo/build_web.sh). If the linux preset is built too, its hash for the
# same ticks is the expected value: equal hashes = the two builds ran the same ticks bit for bit
# (fp probe included). Exit 0 on SMOKE OK (and equal hashes when compared), else 1.
# The wine prefix lives outside the repo: $WINEPREFIX, default ~/.cache/dirge-port/wine (made on first run).
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
native="$(cd "$here/.." && pwd)"
ticks="${1:-300}"
exe="$native/build/windows/game/dirge.exe"
data="$native/web/data"
[[ -f "$exe" ]] || { echo "no $exe: cmake --preset windows && cmake --build --preset windows" >&2; exit 1; }

export WINEPREFIX="${WINEPREFIX:-$HOME/.cache/dirge-port/wine}" WINEDEBUG=-all WINEDLLOVERRIDES="mscoree,mshtml="
mkdir -p "$(dirname "$WINEPREFIX")"
out="$(xvfb-run -a -s '-screen 0 1280x720x24' wine64 "$exe" --data "Z:$data" --smoke "$ticks" --hidden 2>&1 | tr -d '\r')" || true
echo "$out"
hash="$(sed -n 's/^dirge: SMOKE OK hash \([0-9a-f]*\)$/\1/p' <<<"$out")"
[[ -n "$hash" ]] || { echo "wine smoke: FAIL (no SMOKE OK line)"; exit 1; }

linux="$native/build/linux/game/dirge"
if [[ -x "$linux" ]]; then
  ref="$(SDL_VIDEODRIVER=offscreen "$linux" --data "$data" --smoke "$ticks" --hidden --no-audio | sed -n 's/^dirge: SMOKE OK hash \([0-9a-f]*\)$/\1/p')"
  if [[ "$ref" != "$hash" ]]; then echo "wine smoke: FAIL hash $hash, linux $ref"; exit 1; fi
  echo "wine smoke: OK hash $hash (= linux)"
else
  echo "wine smoke: OK hash $hash (linux preset not built: not compared)"
fi
