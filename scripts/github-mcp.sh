#!/usr/bin/env bash
set -euo pipefail
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
GITHUB_PERSONAL_ACCESS_TOKEN="$(cat "$REPO_ROOT/app/.gh_token")"
export GITHUB_PERSONAL_ACCESS_TOKEN
exec /usr/bin/docker run -i --rm -e GITHUB_PERSONAL_ACCESS_TOKEN ghcr.io/github/github-mcp-server:latest
