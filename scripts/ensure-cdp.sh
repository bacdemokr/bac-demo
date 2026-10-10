#!/usr/bin/env bash
# ensure-cdp.sh — make sure the persistent Chromium CDP service (9222) is up.
# Uses the installed user service ~/.config/systemd/user/bac-chromium.service
# which has Restart=always, so it self-heals if Chromium dies.
# Usage: bash scripts/ensure-cdp.sh
set -e

if curl -s --max-time 2 http://127.0.0.1:9222/json/version >/dev/null 2>&1; then
  echo "CDP_ALREADY_UP"
  exit 0
fi

systemctl --user reset-failed bac-chromium 2>/dev/null || true
systemctl --user start bac-chromium 2>/dev/null || true

for i in $(seq 1 20); do
  if curl -s --max-time 2 http://127.0.0.1:9222/json/version >/dev/null 2>&1; then
    echo "CDP_UP"
    exit 0
  fi
  sleep 1
done

echo "CDP_FAILED"
exit 1
