# bac-demo

A live multi-agent demo for NVIDIA Spark (DGX Spark / GB10). Click the animated characters to chat with agents backed by a local OpenClaw gateway.

| Agent | Function |
| --- | --- |
| HealthAgent | Reports live GPU and disk metrics |
| NaverAgent | Searches Naver in Chromium and captures the results |
| GitHubAgent | Reads repositories and performs requested GitHub actions |
| OrchestratorAgent | PM plans a feature; Dev generates a module and opens a pull request |
| ArxivAgent | Shows an automatically refreshed selection of AI papers |
| TelegramAgent | Optional two-way bridge using a dedicated bot |

## Run

See [INSTALL.md](INSTALL.md) for gateway, model, credential, and browser setup.

```bash
npm install
cp .env.example .env
# Set a model available through your gateway and configure credentials.
node --env-file=.env app/server.js
```

Open http://127.0.0.1:8081. The server binds to localhost by default.

The Node server serves the Canvas UI, gathers live data, and routes chat to OpenClaw agents `bac`, `git`, `pm`, and `dev`. Naver uses a separate Chromium profile on CDP port 9222. The orchestrator targets `GH_OWNER/GH_REPO` and writes standalone modules under `demo-features/`.

GitHub actions create real branches, commits, and pull requests when requested. Credentials belong in the gitignored `.env` or `app/.gw_token`, `app/.gh_token`, and optional `app/.tg_token` files. Never commit them.
