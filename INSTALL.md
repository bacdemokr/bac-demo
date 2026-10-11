# Installation

Requires Node.js 20.6 or newer on macOS or Linux. AI responses require OpenClaw. Browser exploration requires installed Chrome/Chromium; the launcher uses a dedicated headless profile. HealthAgent uses `nvidia-smi` when available. Docker is only needed for the separate GitHub MCP server. The optional Linux graphical Chromium service uses `DISPLAY=:1`.

## Dependencies and settings

```bash
git clone https://github.com/bacdemokr/bac-demo.git
cd bac-demo
./bac start
```

The launcher installs missing app dependencies with `npm ci`, loads `.env` when present, validates `api.json` (or prepares a blank file with mode 600 on first start), discovers the local OpenClaw configuration, and prepares an installed Chrome/Chromium on the configured local CDP port (default 9222). It reuses an existing CDP browser. It runs in the terminal; Ctrl+C stops the app and only the browser it started. It does not stop an existing browser or OpenClaw. `./bac status` checks the app. Use `./bac start --port 8001` for another web port, `--no-browser` to skip browser startup, or `CHROME_EXECUTABLE` to select an executable. An occupied web port produces an explicit error without killing its owner.

## Unified API settings

```bash
cp api.example.json api.json
chmod 600 api.json
# Fill in the services you want, then:
./bac start
```

The root `api.json` has `github` (`token`; optional `owner`, `repo` for an existing fixed target), `telegram` (`botToken`, `chatId`), and `agentmail` (`apiKey`, `inboxId`). Enter Chat ID as a string. Blank keys preserve existing environment/token-file fallbacks. Omit unused provider sections if desired. A configured Telegram token needs a Chat ID; an AgentMail key needs an existing Inbox ID. A JSON GitHub token alone connects the authenticated account without a fixed repository, overriding old environment target defaults. Each configured provider is verified at startup, and the settings UI displays **api.json** as its source; secrets are never returned to the browser. Connecting does not send a message or change a GitHub repository.

Runtime entries replace the current connection in memory. `api.json` takes precedence over legacy file/environment credentials; an empty JSON key falls back to those paths. Restarting removes runtime overrides and reloads the file. Disconnecting clears the memory connection until reconnect or restart. It does not edit `api.json`. Editing the JSON file requires a restart. Invalid JSON or invalid configuration stops startup with an error that does not quote credentials. Authentication/network failures appear per service in the UI, allowing the rest of the app to work.

`./bac start --config /path/to/api.json` or `BAC_API_CONFIG` selects another file. `api.json` and `.bac/` (the dedicated browser profile) are gitignored. Only the blank example is packaged. This file configures the app's REST bridges. The bundled GitHub MCP launcher also reads its GitHub token at process start; it does not modify credentials in an already running OpenClaw MCP process. Advanced Gateway/model/port settings remain available in `.env`.

The configured Gateway agent model is used by default. Set `DEMO_MODEL` only to override it with a model available on your gateway. `BROWSER_MODEL` optionally overrides it for browser summaries. `GH_OWNER` and `GH_REPO` set the startup GitHub target; the runtime GitHub tab can change it. The target needs an initial commit and a default branch. PRs use the verified default branch. Generated files go under `demo-features/`; GitHub creates that directory with the first file.

## OpenClaw

For OpenClaw 2026.9.4, configure `agents.entries` with `bac`, `git`, `pm`, and `dev`. Give each a separate workspace and a working model. Copy `agent-workspaces/workspace-bac` to the `bac` workspace. The `bac`, `pm`, and `dev` agents only need to generate text from the supplied context; GitHubAgent needs GitHub tools.

Enable `gateway.http.endpoints.chatCompletions.enabled`. The server routes through `openclaw/<agent-id>` with agent-scoped session keys. Older OpenClaw versions may use `agents.list`; use the configuration schema of your running gateway.

At startup the app discovers the same-user local OpenClaw listener and its JSON5 configuration, or reads `~/.openclaw/openclaw.json`. `OPENCLAW_CONFIG_PATH`, `OPENCLAW_STATE_DIR` and `OPENCLAW_PROFILE` can select another installation. It uses the token and actual agent IDs automatically; no UI token entry or connection button is needed. Only the discovered config path is remembered in the ignored `app/.openclaw-path`, without copying credentials or modifying OpenClaw. For a remote Gateway set `GATEWAY_URL` and `GATEWAY_TOKEN` in the server environment. `GATEWAY_AGENT`, `GITHUB_AGENT`, `PM_AGENT` and `DEV_AGENT` override routing. Legacy `app/.gw_token` remains supported. The default agent handles general questions and text generation when dedicated agents are absent. GitHub tool actions need a configured `git` agent or `GITHUB_AGENT`; without one, a verified app GitHub connection supports read-only repository metadata and AI explanation. Keep any legacy token files and `app/.gh_token` mode 600.

For GitHub MCP, pull `ghcr.io/github/github-mcp-server:latest`, then configure an OpenClaw `mcp.servers` entry whose command is the absolute path to `scripts/github-mcp.sh`. This script loads `.env`, reads the GitHub credential from `api.json` (or legacy file/environment settings), and passes it directly in Docker's environment without printing it. Validate the gateway config and reload it.

## GitHub connection: runtime or startup file

- **Runtime:** Open **연결 설정 → GitHub**, enter only a PAT, and click **GitHub 연결**. GET `/user` determines the account; no fixed owner/repo is required. Search for a public repository by keyword or URL, or use **추천 중 무작위 선택**, then explicitly click **내 계정에 Fork**. The server verifies the public source, POSTs the fork once, waits for the fork's parent and git ref, and selects the owned fork for collaboration. **이 저장소에서 작업** opens the existing PM/Dev workflow. It creates its feature branch and PR inside this fork; it does not submit to the upstream project. Fork jobs are polled and survive closing the modal, and credential changes/other writes are blocked while preparing the fork. Private, archived, disabled or empty sources are rejected. Search and connection are read-only. If a fixed existing target is desired, expand the optional repository field. A failed replacement preserves the working connection. Tokens remain in server memory and are never passed to the model or returned to the browser.
- **Startup:** Prefer the unified `api.json` above. Alternatively put the PAT in `app/.gh_token` (mode 600), or set `GITHUB_TOKEN` in `.env`, and run `./bac start`. Set `GH_OWNER` and `GH_REPO` for the legacy startup target. After JSON credentials, file credentials take precedence over environment credentials and are verified at startup. Runtime entries override the active connection without editing either file. Restarting removes the runtime override and reloads startup settings. Disconnecting clears the app connection until a reconnect or restart; it leaves files intact.

Use a fine-grained PAT restricted to the demo repository, with **Contents: Read and write** and **Pull requests: Read and write** for collaboration PRs. Connection verification confirms account and repository reads; it does not create a test branch or PR to prove the token's write permissions. A repository with no write access, an archived repository, or a disabled repository cannot start a collaboration PR. Connection changes are blocked while a collaboration job runs, and its requests retain the credentials, repository, and default branch selected at job start.

For selecting changing public sources and creating new forks, a token limited to one existing repository will not cover later fork edits. Ensure it can access the new forks under your own account. The [GitHub fork endpoint](https://docs.github.com/en/rest/repos/forks#create-a-fork) requires **Contents: read** plus either **Administration: write** or **Repository creation: write** for a fine-grained token; writing the fork and PR additionally needs Contents/Pull requests write. The token creation link pre-fills Administration, Contents and Pull requests write, but repository access must be selected in GitHub. These permissions are verified by the actual operation, never by making a test write at connection time.

The runtime GitHub tab configures the app's REST client. It does not change OpenClaw's MCP configuration or replace credentials in an already running MCP process. MCP tool actions continue using the separately configured OpenClaw integration. The bundled MCP launcher reads `api.json`, with its existing token-file fallback, when that process starts.

## Persistent services

Edit paths and the Node executable in `app/systemd/bac-demo.service` for your checkout. Edit the display in `bac-chromium.service` if necessary.

```bash
mkdir -p ~/.config/systemd/user
cp app/systemd/bac-*.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now bac-chromium bac-demo
```

The service reads `.env` and the app automatically reads `api.json`. For a foreground run with browser preparation, use `./bac start`.

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
