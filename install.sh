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
  git -C "$INSTALL_DIR" pull --ff-only || error "Failed to update. Remove $INSTALL_DIR and retry."
else
  info "Cloning Mesa into $INSTALL_DIR"
  git clone --depth 1 "$REPO_URL" "$INSTALL_DIR"
fi

info "Installing dependencies"
rm -rf "$INSTALL_DIR/node_modules"
npm install --prefix "$INSTALL_DIR"

info "Building plugin"
npm run build --prefix "$INSTALL_DIR"

info "Generating specialist agents (2 primary + 173 subagents)"
node "$INSTALL_DIR/src/setup/generate-agents.js"

PLUGIN_PATH="file://$INSTALL_DIR/dist/index.js"

info ""
info "Add the following to your project's opencode.json:"
info ""
printf '  %s\n' "{"
printf '    %s\n' "\"plugin\": [\"$PLUGIN_PATH\"]"
printf '  %s\n' "}"
info ""
info "Then restart opencode. Switch agents with Tab or /agent."
info "  /agent briefing-writer  — start a discovery session"
info "  /agent gestor           — orchestrate a specialist team"
info ""
info "Done."
