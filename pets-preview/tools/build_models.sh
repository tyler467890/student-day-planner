#!/usr/bin/env bash
# Build compact pet models: Blender export (export_glb.py) -> meshopt compression.
# Usage: PYTHON=/path/to/python-with-bpy ./build_models.sh [out_dir]
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="${1:-$HERE/../models}"; RAW="$(mktemp -d)"
"${PYTHON:-python}" "$HERE/export_glb.py" "$RAW" all
mkdir -p "$OUT"
for f in "$RAW"/*.glb; do
  npx --yes @gltf-transform/cli@4 meshopt "$f" "$OUT/$(basename "$f")" --level high
done
du -cb "$OUT"/*.glb
