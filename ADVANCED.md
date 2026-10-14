# 선택 설정

기본 실행에는 이 문서의 설정이 필요하지 않습니다. 로컬 모델 또는 NVIDIA API에 직접 연결하면 OpenClaw와 Docker도 필요하지 않습니다. 처음 실행하는 방법은 [INSTALL.md](INSTALL.md)를 참고하세요.

## 기존 OpenClaw와 MCP 사용

이미 실행 중인 로컬 OpenClaw는 앱이 자동 확인합니다. 별도의 `bac`, `pm`, `dev` 에이전트를 만들 필요는 없습니다. 기본 에이전트로 대화와 PM/Dev 코드 생성을 수행할 수 있습니다. OpenClaw GitHub MCP 경로를 쓰려면 해당 도구를 사용할 에이전트가 있어야 합니다.

OpenClaw를 AI 연결로 선택했다면 Gateway의 `gateway.http.endpoints.chatCompletions.enabled`가 활성화돼 있어야 합니다. 이 앱은 `openclaw/<agent-id>`로 요청을 보냅니다. 설정 구조는 설치한 OpenClaw 버전을 따르세요. 작업 지침을 직접 바꾸려는 경우 `agent-workspaces/workspace-bac`을 참고할 수 있습니다.

앱은 같은 사용자로 실행 중인 로컬 OpenClaw 프로세스의 설정과 `~/.openclaw/openclaw.json`을 확인합니다. 토큰과 실제 에이전트 ID를 읽으며 원본 OpenClaw 설정을 변경하지 않습니다. 발견한 설정 경로만 Git에서 제외되는 `app/.openclaw-path`에 기억합니다.

자동 탐색이 되지 않는 특수한 설치에만 `OPENCLAW_CONFIG_PATH`, `OPENCLAW_STATE_DIR` 또는 `OPENCLAW_PROFILE`을 지정하세요. 원격 Gateway는 `GATEWAY_URL`과 `GATEWAY_TOKEN`을 직접 설정합니다. 요청할 에이전트를 바꾸려면 `GATEWAY_AGENT`, `GITHUB_AGENT`, `PM_AGENT`, `DEV_AGENT`를 사용할 수 있습니다. 기존 `app/.gw_token`도 지원합니다.

GitHub MCP를 추가하려면 Docker가 필요합니다. OpenClaw의 MCP 설정에 `scripts/github-mcp.sh`의 절대 경로를 실행 명령으로 등록하세요. 이 스크립트는 `api.json`의 GitHub 토큰 또는 기존 파일·환경변수를 읽어 `ghcr.io/github/github-mcp-server:latest`를 실행합니다. 이미 실행 중인 MCP 프로세스의 인증은 화면에서 GitHub 키를 바꿔도 변경되지 않으므로 해당 프로세스를 다시 시작해야 합니다.

GitHub MCP를 등록하지 않아도 앱의 GitHub API 연결로 저장소 조회·Fork 생성·내 Fork 삭제·협업 PR 작업을 사용할 수 있습니다. AgentMail도 화면에서는 REST API로 연결합니다. 에이전트의 메일 도구 호출이 필요할 때만 [AgentMail MCP](https://www.agentmail.to/docs/integrations/mcp)를 별도로 등록하세요.

## 실행 옵션과 환경변수

- 다른 앱 포트: `./bac start --port 8001`
- 브라우저 준비 생략: `./bac start --no-browser`
- 별도 연결 파일: `./bac start --config /path/to/api.json`
- Chrome 경로 지정: `CHROME_EXECUTABLE=/path/to/chromium ./bac start`
- 별도 CDP 브라우저: `BROWSER_CDP_URL=http://127.0.0.1:9223 ./bac start`

환경변수를 자주 변경할 때만 `.env`에 필요한 항목을 적으세요. 파일이 있으면 자동으로 읽습니다. `.env.example` 복사는 필수가 아닙니다. 모델과 서비스 키는 화면 또는 `api.json`으로 설정하는 것을 권장합니다. 기존 `GITHUB_TOKEN`, `TG_BOT_TOKEN`, `TG_CHAT_ID`, `AGENTMAIL_API_KEY`, `AGENTMAIL_INBOX_ID`와 토큰 파일도 계속 지원합니다.

## Linux에서 상시 실행 - 선택

터미널을 닫아도 계속 실행하려는 경우에만 사용하세요. `app/systemd/bac-demo.service`의 프로젝트 경로와 Node 실행 경로를 실제 설치에 맞게 변경합니다. 그래픽 Chromium을 실행할 경우 `bac-chromium.service`의 실행 경로와 DISPLAY도 확인합니다.

```bash
mkdir -p ~/.config/systemd/user
cp app/systemd/bac-*.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now bac-chromium bac-demo
```

서비스도 `api.json`을 자동으로 읽으며 `.env`는 없어도 됩니다. 일반 실행은 `./bac start`로 충분합니다. 상시 실행 중에는 `systemctl --user restart bac-demo`로 재시작하고 `journalctl --user -u bac-demo -f`로 실행 기록을 확인합니다.

## 개발 시 검증

```bash
npm test
TEST_CHROMIUM_EXECUTABLE=/path/to/chromium npm run test:browser
```

브라우저 테스트는 로컬 fixture를 사용하며 실제 메일·Telegram 발송이나 저장소 삭제를 실행하지 않습니다.
