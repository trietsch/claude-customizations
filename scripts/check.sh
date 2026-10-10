#!/usr/bin/env bash
# Validates the marketplace and runs the tests of every mod (or of the mods given as arguments).
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

claude plugin validate "$repo_root"

if [[ $# -gt 0 ]]; then
  mods=("$@")
else
  mods=()
  for dir in mods/*/; do mods+=("$(basename "$dir")"); done
fi

for mod in "${mods[@]}"; do
  echo "== $mod"
  claude plugin validate "mods/$mod"
  if compgen -G "mods/$mod/tests/*.test.ts" > /dev/null; then
    claude plugin test "mods/$mod"
  fi
done
