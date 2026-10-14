# OpenClaw Telegram setup with NVIDIA API

`openclaw.json` in this repository is a sanitized template derived from the working Spark configuration. All agent model routes use NVIDIA Inference API (`azure/openai/gpt-5.6-terra`). It contains no API keys, Telegram bot tokens, gateway tokens, or Telegram user IDs. Machine history, personal agent identity, and the optional machine-specific GitHub MCP launcher are omitted. Existing agent workspace paths use `${HOME}`.

OpenClaw must be installed separately. `./bac start` starts the web demo, not OpenClaw. The web demo and OpenClaw have separate configuration and credentials.

## Apply the template

1. Back up your existing configuration before replacing it. Copying this template replaces your existing provider, channel, and agent settings; review custom settings first.

   ```bash
   mkdir -p ~/.openclaw
   if [ -f ~/.openclaw/openclaw.json ]; then
     cp -p ~/.openclaw/openclaw.json ~/.openclaw/openclaw.json.backup-$(date +%Y%m%d-%H%M%S)
   fi
   cp openclaw.json ~/.openclaw/openclaw.json
   chmod 600 ~/.openclaw/openclaw.json
   ```

2. Edit `~/.openclaw/.env` and add or update these entries, preserving unrelated existing entries. Replace the placeholder values with your own credentials. These are OpenClaw settings, not the project's `.env`.

   ```dotenv
   NVIDIA_API_KEY=YOUR_NVIDIA_INFERENCE_API_KEY
   TELEGRAM_BOT_TOKEN=YOUR_BOTFATHER_TOKEN
   TELEGRAM_ALLOWED_USER_ID=YOUR_NUMERIC_TELEGRAM_USER_ID
   OPENCLAW_GATEWAY_TOKEN=YOUR_EXISTING_OR_NEW_RANDOM_GATEWAY_TOKEN
   ```

   Use your existing gateway token to keep existing clients connected, or generate a new one with `openssl rand -hex 32` and update those clients. Run `chmod 600 ~/.openclaw/.env`. Keep real credentials out of this repository's `openclaw.json`.

3. Validate with the same OpenClaw installation/version that runs your gateway, then restart it. On the prepared Spark, the user service is:

   ```bash
   openclaw config validate
   systemctl --user restart openclaw-gateway
   ```

   If the CLI and service use different OpenClaw installations, use the service's executable for validation. A missing service requires separate OpenClaw gateway installation. Send the bot a new message after restarting. Existing Telegram pairing/access rules still apply.

4. If the demo uses the same Telegram bot, set `BAC_TELEGRAM_RECEIVE=false` in the project's `.env`, then restart the demo with `./bac stop` and `./bac start`. OpenClaw receives the messages and generates AI replies; the demo can still send explicitly requested messages. Use a separate bot if the demo also needs its own incoming-message feed.

The template targets NVIDIA's internal Inference Hub endpoint. A key for the public NVIDIA API Catalog needs its corresponding endpoint and available model ID instead.
