#!/usr/bin/env bash
set -euo pipefail
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd -- "$REPO_ROOT"
if [[ -f .env ]]; then
  exec node --env-file=.env scripts/github-mcp.js
fi
exec node scripts/github-mcp.js
