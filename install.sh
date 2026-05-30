#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${1:-https://github.com/hacklabr/opencode-mesa}"
INSTALL_DIR="${2:-$HOME/.local/share/opencode-mesa}"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info()  { printf "${GREEN}[mesa]${NC} %s\n" "$1"; }
warn()  { printf "${YELLOW}[mesa]${NC} %s\n" "$1"; }
error() { printf "${RED}[mesa]${NC} %s\n" "$1" >&2; exit 1; }

command -v git >/dev/null 2>&1  || error "git is required"
command -v node >/dev/null 2>&1 || error "node is required"
command -v npm >/dev/null 2>&1  || error "npm is required"

if [ -d "$INSTALL_DIR" ]; then
  info "Updating existing installation at $INSTALL_DIR"
  git -C "$INSTALL_DIR" fetch --unshallow 2>/dev/null || true
  git -C "$INSTALL_DIR" fetch origin
  git -C "$INSTALL_DIR" reset --hard origin/main
else
  info "Cloning Mesa into $INSTALL_DIR"
  git clone --depth 1 "$REPO_URL" "$INSTALL_DIR"
fi

info "Installing dependencies"
rm -rf "$INSTALL_DIR/node_modules"
npm install --prefix "$INSTALL_DIR"

info "Building plugin"
npm run build --prefix "$INSTALL_DIR"

info "Generating agents (2 primary + 173 hidden subagents)"
GLOBAL_AGENTS_DIR="$HOME/.config/opencode/agents"
node "$INSTALL_DIR/src/setup/generate-agents.js" "$GLOBAL_AGENTS_DIR"

PLUGIN_PATH="file://$INSTALL_DIR/dist/index.js"

CONFIG_DIR="$HOME/.config/opencode"
CONFIG_FILE="$CONFIG_DIR/opencode.json"

info ""
info "Configuring plugin globally..."
mkdir -p "$CONFIG_DIR"

if [ -f "$CONFIG_FILE" ]; then
  if grep -q "opencode-mesa" "$CONFIG_FILE" 2>/dev/null; then
    info "Plugin already configured in $CONFIG_FILE"
  else
    node "$INSTALL_DIR/src/setup/add-plugin.cjs" "$CONFIG_FILE" "$PLUGIN_PATH"
    info "Plugin added to $CONFIG_FILE"
  fi
else
  cat > "$CONFIG_FILE" <<EOCFG
{
  "\$schema": "https://opencode.ai/config.json",
  "plugin": ["$PLUGIN_PATH"]
}
EOCFG
  info "Created $CONFIG_FILE with plugin configured"
fi

info ""
info "Done. Restart opencode to load the plugin."
info ""
info "Agents are generated globally in $GLOBAL_AGENTS_DIR"
info "To also generate agents in a specific project, run:"
info "  node $INSTALL_DIR/src/setup/generate-agents.js /path/to/project/.opencode/agents"
info ""
info "Switch agents with Tab or /agent:"
info "  /agent briefing-writer  — start a discovery session"
info "  /agent gestor           — orchestrate a specialist team"
