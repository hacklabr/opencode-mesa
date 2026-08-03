#!/usr/bin/env bash
set -euo pipefail

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
DIM='\033[2m'
BOLD='\033[1m'
NC='\033[0m'

info()  { printf "${GREEN}[mesa]${NC} %s\n" "$1"; }
warn()  { printf "${YELLOW}[mesa]${NC} %s\n" "$1"; }
error() { printf "${RED}[mesa]${NC} %s\n" "$1" >&2; exit 1; }
dim()   { printf "${DIM}[mesa]${NC} %s\n" "$1"; }

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# ---------------------------------------------------------------------------
# Detect context: are we inside the local dev repo or a clone?
# ---------------------------------------------------------------------------
is_local_repo() {
  [ -f "$SCRIPT_DIR/package.json" ] && grep -q '"opencode-mesa"' "$SCRIPT_DIR/package.json" 2>/dev/null
}

CLONE_DIR="$HOME/.local/share/opencode-mesa"
AGENTS_DIR="$HOME/.config/opencode/agents"
CONFIG_DIR="$HOME/.config/opencode"
CONFIG_FILE="$CONFIG_DIR/opencode.json"

REMOVE_HELPER=""
if is_local_repo; then
  REMOVE_HELPER="$SCRIPT_DIR/src/setup/remove-plugin.cjs"
else
  # Running from a clone or elsewhere — try clone location first, then local
  if [ -f "$CLONE_DIR/src/setup/remove-plugin.cjs" ]; then
    REMOVE_HELPER="$CLONE_DIR/src/setup/remove-plugin.cjs"
  elif [ -f "$SCRIPT_DIR/src/setup/remove-plugin.cjs" ]; then
    REMOVE_HELPER="$SCRIPT_DIR/src/setup/remove-plugin.cjs"
  fi
fi

# ---------------------------------------------------------------------------
# Collect what will be removed
# ---------------------------------------------------------------------------
TO_REMOVE=()

BRIEFING_FILE=""
MANAGER_FILE=""
MESA_DIR=""
PLUGIN_ENTRY=false
CLONE_PATH=""

if [ -f "$AGENTS_DIR/briefing-writer.md" ]; then
  BRIEFING_FILE="$AGENTS_DIR/briefing-writer.md"
  TO_REMOVE+=("$BRIEFING_FILE")
fi

if [ -f "$AGENTS_DIR/manager.md" ]; then
  MANAGER_FILE="$AGENTS_DIR/manager.md"
  TO_REMOVE+=("$MANAGER_FILE")
fi

if [ -d "$AGENTS_DIR/mesa" ]; then
  MESA_DIR="$AGENTS_DIR/mesa"
  MESA_COUNT=$(find "$MESA_DIR" -maxdepth 1 -name "*.md" 2>/dev/null | wc -l | tr -d ' ')
  TO_REMOVE+=("$MESA_DIR ($MESA_COUNT files)")
fi

if [ -f "$CONFIG_FILE" ] && grep -q "opencode-mesa" "$CONFIG_FILE" 2>/dev/null; then
  PLUGIN_ENTRY=true
  TO_REMOVE+=("plugin entry in $CONFIG_FILE")
fi

if [ -d "$CLONE_DIR" ] && ! is_local_repo; then
  CLONE_PATH="$CLONE_DIR"
  TO_REMOVE+=("$CLONE_PATH (clone)")
fi

# ---------------------------------------------------------------------------
# Nothing to do?
# ---------------------------------------------------------------------------
if [ ${#TO_REMOVE[@]} -eq 0 ]; then
  info "Nothing to uninstall — no Mesa artifacts found."
  exit 0
fi

# ---------------------------------------------------------------------------
# Show summary + prompt
# ---------------------------------------------------------------------------
printf "\n"
printf "${BOLD}[mesa]${NC} This will remove:\n"
for item in "${TO_REMOVE[@]}"; do
  printf "  ${RED}-${NC} %s\n" "$item"
done
printf "\n"

read -r -p "Continue? [y/N] " response
case "$response" in
  [yY][eE][sS]|[yY]) ;;
  *)
    info "Aborted."
    exit 0
    ;;
esac

# ---------------------------------------------------------------------------
# Execute removal
# ---------------------------------------------------------------------------
printf "\n"

if [ -n "$BRIEFING_FILE" ]; then
  rm -f "$BRIEFING_FILE"
  info "Removed $BRIEFING_FILE"
fi

if [ -n "$MANAGER_FILE" ]; then
  rm -f "$MANAGER_FILE"
  info "Removed $MANAGER_FILE"
fi

if [ -n "$MESA_DIR" ]; then
  rm -rf "$MESA_DIR"
  info "Removed $MESA_DIR ($MESA_COUNT files)"
fi

if $PLUGIN_ENTRY; then
  if [ -n "$REMOVE_HELPER" ] && [ -f "$REMOVE_HELPER" ]; then
    node "$REMOVE_HELPER" "$CONFIG_FILE"
  else
    # Fallback: remove via sed (best-effort, single-line plugin entries)
    # This handles the common case where the plugin line is a single string entry.
    sed -i.bak '/"file:.*opencode-mesa/d' "$CONFIG_FILE" 2>/dev/null || true
    sed -i.bak '/file:\/\/.*opencode-mesa/d' "$CONFIG_FILE" 2>/dev/null || true
    rm -f "${CONFIG_FILE}.bak" 2>/dev/null || true
    info "Removed plugin entry from $CONFIG_FILE (fallback sed)"
    warn "Config may need manual cleanup — verify $CONFIG_FILE is valid JSON"
  fi
fi

if [ -n "$CLONE_PATH" ]; then
  rm -rf "$CLONE_PATH"
  info "Removed clone at $CLONE_PATH"
fi

printf "\n"
info "${BOLD}Done.${NC} Restart opencode to fully unload the plugin."
info "Note: your opencode.json config was preserved (only the Mesa plugin entry was removed)."
