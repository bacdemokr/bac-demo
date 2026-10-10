# Installation

Requires Linux, Node.js 20.6 or newer, OpenClaw, snap Chromium, and Docker for the GitHub MCP server. HealthAgent uses `nvidia-smi`. A graphical desktop is required for Chromium; the supplied service uses `DISPLAY=:1`.

## Dependencies and settings

```bash
git clone https://github.com/bacdemokr/bac-demo.git
cd bac-demo
npm install
cp .env.example .env
```

Set `DEMO_MODEL` to a model available on your gateway. `BROWSER_MODEL` optionally overrides it for Naver. Set `GH_OWNER` to your authenticated GitHub account and `GH_REPO` to your demo repository (`bac-demo`). The target needs a `main` branch. Generated files go under `demo-features/`; GitHub creates that directory with the first file.

## OpenClaw

For OpenClaw 2026.9.4, configure `agents.entries` with `bac`, `git`, `pm`, and `dev`. Give each a separate workspace and a working model. Copy `agent-workspaces/workspace-bac` to the `bac` workspace. The `bac`, `pm`, and `dev` agents only need to generate text from the supplied context; GitHubAgent needs GitHub tools.

Enable `gateway.http.endpoints.chatCompletions.enabled`. The server routes through `openclaw/<agent-id>` with agent-scoped session keys. Older OpenClaw versions may use `agents.list`; use the configuration schema of your running gateway.

Store the gateway auth token in `app/.gw_token` and a GitHub token with access to the target repository in `app/.gh_token`. Set both files to mode 600. Environment alternatives are `GATEWAY_TOKEN` and `GITHUB_TOKEN` for the web server.

For GitHub MCP, pull `ghcr.io/github/github-mcp-server:latest`, then configure an OpenClaw `mcp.servers` entry whose command is the absolute path to `scripts/github-mcp.sh`. This script reads `app/.gh_token` and passes it to Docker. Validate the gateway config and reload it.

## Persistent services

Edit paths and the Node executable in `app/systemd/bac-demo.service` for your checkout. Edit the display in `bac-chromium.service` if necessary.

```bash
mkdir -p ~/.config/systemd/user
cp app/systemd/bac-*.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now bac-chromium bac-demo
```

The service reads `.env`. For a foreground run, use `node --env-file=.env app/server.js`.

```bash
systemctl --user restart bac-demo
journalctl --user -u bac-demo -f
curl http://127.0.0.1:8081/api/agents
bash scripts/ensure-cdp.sh
```

## Optional Telegram

Use a separate bot from any existing OpenClaw Telegram integration to avoid competing polling loops. Put its token in `app/.tg_token`, set mode 600, and restart the demo. Without this token the bridge remains disabled.
