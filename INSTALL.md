# Installation

Requires Linux, Node.js 20.6 or newer, OpenClaw, snap Chromium, and Docker for the GitHub MCP server. HealthAgent uses `nvidia-smi`. A graphical desktop is required for Chromium; the supplied service uses `DISPLAY=:1`.

## Dependencies and settings

```bash
git clone https://github.com/bacdemokr/bac-demo.git
cd bac-demo
npm install
cp .env.example .env
```

The configured Gateway agent model is used by default. Set `DEMO_MODEL` only to override it with a model available on your gateway. `BROWSER_MODEL` optionally overrides it for browser summaries. Set `GH_OWNER` to your authenticated GitHub account and `GH_REPO` to your demo repository (`bac-demo`). The target needs a `main` branch. Generated files go under `demo-features/`; GitHub creates that directory with the first file.

## OpenClaw

For OpenClaw 2026.9.4, configure `agents.entries` with `bac`, `git`, `pm`, and `dev`. Give each a separate workspace and a working model. Copy `agent-workspaces/workspace-bac` to the `bac` workspace. The `bac`, `pm`, and `dev` agents only need to generate text from the supplied context; GitHubAgent needs GitHub tools.

Enable `gateway.http.endpoints.chatCompletions.enabled`. The server routes through `openclaw/<agent-id>` with agent-scoped session keys. Older OpenClaw versions may use `agents.list`; use the configuration schema of your running gateway.

At startup the app discovers the same-user local OpenClaw listener and its JSON5 configuration, or reads `~/.openclaw/openclaw.json`. `OPENCLAW_CONFIG_PATH`, `OPENCLAW_STATE_DIR` and `OPENCLAW_PROFILE` can select another installation. It uses the token and actual agent IDs automatically; no UI token entry or connection button is needed. Only the discovered config path is remembered in the ignored `app/.openclaw-path`, without copying credentials or modifying OpenClaw. For a remote Gateway set `GATEWAY_URL` and `GATEWAY_TOKEN` in the server environment. `GATEWAY_AGENT`, `GITHUB_AGENT`, `PM_AGENT` and `DEV_AGENT` override routing. Legacy `app/.gw_token` remains supported. The default agent handles general questions and text generation when dedicated agents are absent; GitHub AI actions require a configured `git` agent or `GITHUB_AGENT`. Keep any legacy token files and `app/.gh_token` mode 600.

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
curl http://127.0.0.1:8000/api/agents
bash scripts/ensure-cdp.sh
```

## Browser showcase

The default mode is **맛집 찾기**. Enter a region and menu, then search Naver Map and Kakao Map (formerly Daum Map), or choose one. Ratings come from rendered map labels; no model or API key is needed. The table shows each map's rating separately, Naver's displayed review count, and Kakao's star-evaluation count (not its blog-review count). Names plus street/lot addresses or phone numbers identify shared restaurants; differing known buildings remain separate branches. Missing stars are marked **미표시** and missing observations on the other map **미확인**. Sort independently by either map's rating; review/evaluation counts break ties, and missing ratings follow rated entries. The table shows the top 20 observed candidates, not an exhaustive regional ranking. Provider failures preserve the other map's results and include a direct search link. Each row links to the original place page and the table shows its collection time. Map layouts and displayed ratings may change.

General, news, and comparison modes still accept a research question. With a Gateway they plan up to two focused queries, select relevant sources, and synthesize a cited answer. They support Naver and Daum, searching both in automatic mode. They deduplicate candidates, open up to five candidate articles until three readable pages are found, and extract rendered body text and publication metadata. Unreadable pages and missing dates are reported. Search snippets are not treated as article evidence. Without an available Gateway they still collect readable evidence; **AI로 정리** can synthesize it after the service recovers. The optional quick-search mode keeps the previous single-search behavior.

The browser viewer connects to `BROWSER_CDP_URL` (default `http://127.0.0.1:9222`). It opens a worker tab, captures the actual page while navigating and scrolling, extracts links, and then closes its worker tab. Chromium remains running. Only one search can run at a time; completed captures are kept in memory for up to 12 jobs and removed as new jobs arrive.

On the supplied Spark setup, use the Chromium service above or `npm run cdp`. For a manual headless test on Linux:

```bash
chromium --headless --remote-debugging-address=127.0.0.1 \
  --remote-debugging-port=9222 --user-data-dir=/tmp/bac-demo-browser about:blank
```

On macOS, use a dedicated profile:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-address=127.0.0.1 --remote-debugging-port=9222 \
  --user-data-dir=/tmp/bac-demo-browser about:blank
```

Keep CDP on loopback. A site may present CAPTCHA, consent, or access restrictions. The viewer shows the actual screenshot and does not substitute invented results. An unavailable CDP endpoint produces a clear setup message. Closing the viewer does not cancel the worker; you can reopen it to see its progress. Search-page links are extracted with generic selectors, so extraction quality can vary by site.

The browser viewer can summarize a completed browser job without repeating the search. This requires the automatically selected general Gateway agent and its model. `BROWSER_MODEL` overrides the model used for summarization.

## Optional Telegram

Use a **separate bot** from any existing OpenClaw Telegram integration to avoid competing polling loops.

1. Create it through [BotFather](https://t.me/BotFather).
2. Send `/start` to your new bot.
3. Open **연결 설정 → Telegram** in the demo and enter its Bot token and numeric Chat ID. [userinfobot](https://t.me/userinfobot) can show your personal Chat ID. Group IDs are usually negative.
4. After verification, open **메시지 → Telegram** for two-way chat, or share a research result from the preview dialog.

Connecting calls `getMe` and `getChat`; it does not send a test message. Messages from other chats are ignored. Replies always target the configured Chat ID. A reconnect drops the old message buffer and polling client. Disconnecting also invalidates any pending verification.

Environment setup remains supported: put a token in `app/.tg_token` (mode 600) or `TG_BOT_TOKEN`, and set `TG_CHAT_ID` before restarting. Without a Chat ID, sends are disabled until you complete the UI connection. Incoming Telegram messages are displayed as messages; this dedicated bridge does not independently start gateway agent tasks.

## Optional AgentMail

Create an API key and an inbox in the [AgentMail Console](https://console.agentmail.to). Then open **연결 설정 → AgentMail** and enter the key and existing Inbox ID, typically an address such as `my-agent@agentmail.to`.

The UI verifies the inbox with `GET /v0/inboxes/{inbox_id}`, reads message previews with `GET /messages?limit=12`, and sends reviewed plain-text emails with `POST /messages/send`. It does not create inboxes or automatically reply to received mail. Neither connecting nor refreshing the inbox sends email. Sending is never retried automatically after an uncertain delivery.

For startup configuration, set `AGENTMAIL_API_KEY` and `AGENTMAIL_INBOX_ID` in the gitignored `.env`. UI-entered credentials are memory-only. Reopening or reloading the page keeps the server connection; restarting the server requires re-entering UI credentials.

The message viewer uses the AgentMail REST API. To let an OpenClaw agent call mail tools directly, configure the [official AgentMail MCP integration](https://www.agentmail.to/docs/integrations/mcp) separately, or follow the AgentMail skill setup in the linked demo guide. Do not describe the viewer's direct API calls as MCP calls.

## Local verification

```bash
npm test
# Linux; set the path to your installation
TEST_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run test:browser
```

The browser test defaults to the installed Google Chrome path on macOS. It uses local fixture services and does not send real email or Telegram messages. Real delivery, gateway tool availability, and Spark GPU metrics must be checked on the configured demo machine.
