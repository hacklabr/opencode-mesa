#!/usr/bin/env bash
# Dual-runtime smoke wrapper: builds if needed, then runs scripts/smoke.mjs
# under BOTH node and bun in isolated temp dirs, propagating each exit code.
# Exits 0 only if both runtimes pass. Used by `npm run test:smoke` and CI.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DIST="$REPO_ROOT/dist/index.js"

# Build if dist/index.js is missing OR older than any TypeScript source file.
# (The smoke targets the BUILT bundle, so a stale dist invalidates the result.)
need_build=0
if [[ ! -f "$DIST" ]]; then
  need_build=1
else
  # -print -quit yields the first stale file (empty string if none are stale).
  if [[ -n "$(find "$REPO_ROOT/src" -name '*.ts' -newer "$DIST" -print -quit 2>/dev/null)" ]]; then
    need_build=1
  fi
fi
if [[ $need_build -eq 1 ]]; then
  echo "[smoke] dist missing or stale — building..." >&2
  (cd "$REPO_ROOT" && npm run build >/dev/null)
fi

# Two isolated temp dirs so neither runtime inherits the other's .mesa/state.db.
tmp_root="$(mktemp -d)"
TMP_NODE="$tmp_root/node"
TMP_BUN="$tmp_root/bun"
mkdir -p "$TMP_NODE" "$TMP_BUN"
trap 'rm -rf "$tmp_root"' EXIT

node_ok=0
bun_ok=0

echo "[smoke] running under node..." >&2
# --experimental-sqlite is required by node 22 to load node:sqlite (used by the
# driver inside dist/); it is inert on node 26 where node:sqlite is unflagged.
if node --experimental-sqlite "$SCRIPT_DIR/smoke.mjs" "$TMP_NODE"; then
  node_ok=1
else
  echo "[smoke] node leg FAILED (exit $?)" >&2
fi

echo "[smoke] running under bun..." >&2
if bun "$SCRIPT_DIR/smoke.mjs" "$TMP_BUN"; then
  bun_ok=1
else
  echo "[smoke] bun leg FAILED (exit $?)" >&2
fi

echo "───────────────────────────────────────" >&2
echo "[smoke] node: $([[ $node_ok -eq 1 ]] && echo PASS || echo FAIL)" >&2
echo "[smoke] bun:  $([[ $bun_ok  -eq 1 ]] && echo PASS || echo FAIL)" >&2
echo "───────────────────────────────────────" >&2

if [[ $node_ok -eq 1 && $bun_ok -eq 1 ]]; then
  echo "SMOKE: both runtimes OK"
  exit 0
fi
echo "SMOKE: one or more runtimes FAILED" >&2
exit 1
