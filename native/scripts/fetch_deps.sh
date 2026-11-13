#!/usr/bin/env bash
# fetch_deps.sh -- download the native build's third-party code into native/third_party/ (gitignored).
#
# Everything is pinned by version and sha256 and is permissive (the port's code is MIT; no GPL in the build):
#   SDL2 2.30.9 source             zlib     Linux preset (built from source: no libsdl2-dev, no sudo)
#   SDL2 2.30.9 MinGW devel        zlib     Windows preset (headers, import lib, SDL2.dll)
#   cJSON 1.7.18                   MIT      the .json exports
#   cgltf 1.14                     MIT      the .glb models
#   dr_flac (dr_libs e1f125c)      MIT-0    BGM / voice FLAC
#   stb_image_write (stb aeb6907)  MIT/PD   report screenshots
# The wasm preset takes SDL2 from Emscripten (-sUSE_SDL=2); emsdk 3.1.74 lives in ~/emsdk (docs/NATIVE.md).
#
# Usage: native/scripts/fetch_deps.sh        (idempotent; re-checks hashes, re-downloads what is missing or wrong)
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
tp="$here/../third_party"
mkdir -p "$tp/dl" "$tp/vendor"

fetch() {   # fetch <url> <dest> <sha256>
  local url="$1" dest="$2" sum="$3"
  if [[ -f "$dest" ]] && echo "$sum  $dest" | sha256sum -c --quiet - 2>/dev/null; then return; fi
  echo "fetch $url"
  curl -sSfL -o "$dest.part" "$url"
  echo "$sum  $dest.part" | sha256sum -c --quiet - || { echo "sha256 mismatch: $url" >&2; rm -f "$dest.part"; exit 1; }
  mv "$dest.part" "$dest"
}

SDL_VER=2.30.9
SDL_URL=https://github.com/libsdl-org/SDL/releases/download/release-$SDL_VER
fetch "$SDL_URL/SDL2-$SDL_VER.tar.gz" "$tp/dl/SDL2-$SDL_VER.tar.gz" \
  24b574f71c87a763f50704bbb630cbe38298d544a1f890f099a4696b1d6beba4
fetch "$SDL_URL/SDL2-devel-$SDL_VER-mingw.tar.gz" "$tp/dl/SDL2-devel-$SDL_VER-mingw.tar.gz" \
  b188d165dc4a0372042bff3d0c18e9bb90772581e92a7b8b47b521b47714f75c

# unpack: source -> third_party/SDL2-src, MinGW devel -> third_party/SDL2-mingw (its x86_64 tree)
if [[ ! -f "$tp/SDL2-src/.v$SDL_VER" ]]; then
  rm -rf "$tp/SDL2-src"; mkdir -p "$tp/SDL2-src"
  tar -xzf "$tp/dl/SDL2-$SDL_VER.tar.gz" -C "$tp/SDL2-src" --strip-components=1
  touch "$tp/SDL2-src/.v$SDL_VER"
fi
if [[ ! -f "$tp/SDL2-mingw/.v$SDL_VER" ]]; then
  rm -rf "$tp/SDL2-mingw" "$tp/dl/mingw"; mkdir -p "$tp/dl/mingw"
  tar -xzf "$tp/dl/SDL2-devel-$SDL_VER-mingw.tar.gz" -C "$tp/dl/mingw" --strip-components=1
  mv "$tp/dl/mingw/x86_64-w64-mingw32" "$tp/SDL2-mingw"; rm -rf "$tp/dl/mingw"
  touch "$tp/SDL2-mingw/.v$SDL_VER"
fi

V="$tp/vendor"
fetch https://raw.githubusercontent.com/DaveGamble/cJSON/v1.7.18/cJSON.c "$V/cJSON.c" \
  75c51de8fa40ac9d7a99319c6330719bd692eb81c0a869265f3d4c682533f9b9
fetch https://raw.githubusercontent.com/DaveGamble/cJSON/v1.7.18/cJSON.h "$V/cJSON.h" \
  0578cc29132912edbc88f83207a8fc76e5db3db0605497e909a9384ef3cc474b
fetch https://raw.githubusercontent.com/jkuhlmann/cgltf/v1.14/cgltf.h "$V/cgltf.h" \
  19db3bdf85f6aa991a3b9d056641bcb39a2ef11cd5211e7a9f6b6c307d9ebc64
fetch https://raw.githubusercontent.com/mackron/dr_libs/e1f125c1e03ba65e98dcbe54bab2b9b86d7ccd1a/dr_flac.h "$V/dr_flac.h" \
  d649910974a8a9e7009fc4f70b343dca4c5fe5f16c853ff3fb77f8b219d17c82
fetch https://raw.githubusercontent.com/nothings/stb/aeb69073d7570a481245a665dc17726d68827062/stb_image_write.h "$V/stb_image_write.h" \
  03f49804a8cf8a28c7ce4ed870e0eb642737ef97249aec30fdd3a8dc7886ae40
echo "third_party ready: $tp"
