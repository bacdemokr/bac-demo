# Agentic AI Demo

NVIDIA Spark의 로컬 OpenClaw gateway를 사용하는 에이전트 데모입니다. 캐릭터를 선택해 대화하거나, 미션 카드에서 브라우저 탐색·에이전트 협업·논문 조회·메시지 연결을 시작하세요.

## 이번 개선

- 에이전트 무대: 입체감 있는 격자, 발광 링, 선택·작업 상태에 연결된 데이터 이동, PM → Dev 인계 애니메이션. 애니메이션 일시 정지와 OS의 동작 줄이기 설정을 지원합니다.
- 작업 유지: 에이전트별 대화와 입력 초안을 보관하고, 대화창을 닫거나 전환해도 진행 중인 작업의 결과를 받습니다. 서버 재시작 시 작업이 초기화됩니다. 페이지 새로고침 시 진행 중인 협업 작업은 다시 추적합니다.
- 대화창: 데스크톱에서는 무대 옆에 열리고 에이전트가 남은 공간에 맞춰 이동합니다. 모바일에서는 아래쪽 창과 두 줄 에이전트 배치를 사용합니다. 무대의 빈 곳 또는 Esc로 닫고, 다른 에이전트를 선택해 전환할 수 있습니다.
- 질문 기반 조사: 일반 조사·뉴스 정리·비교 조사 중 고릅니다. Gateway가 연결되면 요청을 최대 2개의 검색어로 나누고 읽을 원문을 선택합니다. 자동 조사에서는 Naver·Daum의 후보를 합치고 중복을 제거한 뒤 본문 최대 3개를 직접 읽습니다. 결과에 출처 번호와 확인하지 못한 내용을 표시합니다. Google은 수동으로 선택한 경우에만 사용합니다. Gateway 없이도 원문 탐색과 근거 조회는 동작합니다.
- 실제 브라우저 탐색: Naver / Google / Daum 페이지를 Chromium에서 열고 스크롤합니다. 화면 캡처와 실제 실행 단계, 추출한 링크를 함께 표시합니다. 검색과 요약은 같은 창에서 진행하고 결과를 공유할 수 있습니다.
- Telegram 설정: 화면에서 Bot token과 Chat ID를 입력하면 연결을 검증합니다. **메시지 → Telegram**에서 양방향 대화를 제공합니다. 선택한 Chat ID에만 보내고, 해당 채팅에서 온 메시지만 받습니다.
- AgentMail: API key와 기존 Inbox ID를 연결해 받은 메일의 제목·미리보기를 조회하고, 검색·논문 결과를 이메일로 공유합니다.
- 결과 공유: 보낼 내용과 목적지를 확인·수정한 뒤 사용자가 보내기를 누르면 전송합니다. 연결 또는 조회만으로 메시지를 발송하지 않습니다.
- 실행 기록: 실제 브라우저 단계와 gateway 요청·응답, 메시지 전달 결과를 표시합니다. gateway 내부의 개별 MCP 도구 호출까지 추적하는 로그는 아닙니다.

| Agent | 기능 | 실제 연동 방식 |
| --- | --- | --- |
| HealthAgent | GPU·디스크 상태 | 로컬 명령 + gateway 요약 |
| GitHubAgent | 저장소·이슈·PR 요청 | OpenClaw `git` 에이전트의 GitHub MCP 설정 필요 |
| OrchestratorAgent | PM 계획 → Dev 구현 → PR | gateway 에이전트 + GitHub REST API |
| ArxivAgent | 논문 모음·분 단위 확인 | arXiv RSS + 캐시; 피드가 비면 참고 논문임을 표시 |

MCP, CDP, REST API는 서로 다른 연동 방식입니다. 이 데모는 이를 구분해 표시하며, 모든 기능을 MCP 도구 호출로 설명하지 않습니다. GitHub 도구가 실제 설정됐는지는 저장소 조회 등의 요청으로 확인하세요.

## 실행

Node.js 20.6 이상이 필요합니다. gateway와 Chromium 설정은 [INSTALL.md](INSTALL.md)를 참고하세요.

```bash
npm ci
cp .env.example .env
# .env에 Gateway 인증 정보를 설정하세요. 모델은 Gateway 기본 설정을 사용합니다.
node --env-file=.env app/server.js
```

[http://127.0.0.1:8000](http://127.0.0.1:8000)에서 열립니다. 화면 자체는 gateway 없이도 확인할 수 있습니다. AI 응답과 외부 메시지 발송에는 해당 서비스가 필요합니다. 시스템 지표와 논문 조회는 Gateway 없이 동작합니다.

## 권장 시연 흐름

1. **연결 설정 → AI 연결**에서 주소·인증 토큰을 연결합니다. 시작 환경변수로 설정해두어도 됩니다. Telegram·AgentMail은 결과 공유가 필요할 때 연결합니다.
2. **브라우저 탐색**에서 “최근 일주일 AI 발표 정리”, “DGX Spark와 Jetson 비교” 같은 질문을 입력하고 조사 방식을 고릅니다.
3. 검색어 계획 → 여러 검색원 확인 → 원문 방문 → 근거 답변 순서가 자동으로 진행됩니다. 출처 번호로 원문을 확인할 수 있습니다. 모델이 연결되지 않았으면 읽은 근거를 먼저 보고 연결 후 **AI로 정리**할 수 있습니다.
4. **결과 공유**에서 내용을 확인하고 Telegram 또는 이메일로 보냅니다.
5. **에이전트 협업**에서 기능을 요청하면 PM의 계획과 Dev의 PR 생성 과정을 볼 수 있습니다. 기존 동작대로 대상 저장소에 실제 브랜치·커밋·PR이 생성됩니다.

## 연결 정보

**AI 연결**은 이 데모가 사용하는 **OpenClaw Gateway** 연결입니다. 질문 계획·AI 정리·에이전트 대화를 OpenClaw의 모델에 전달합니다. 서버 주소와 OpenClaw 설정의 `gateway.auth.token`을 사용합니다. `127.0.0.1`은 데모 서버가 실행 중인 컴퓨터를 가리킵니다. OpenClaw가 다른 Spark에서 실행 중이면 그 서버의 접근 가능한 주소를 입력하세요.

화면에서 입력한 Gateway·Telegram·AgentMail 키는 **이 로컬 서버의 메모리**에만 저장합니다. 페이지를 새로고침해도 서버가 실행 중이면 연결은 유지되고, 서버를 재시작하면 다시 입력해야 합니다. 브라우저의 localStorage·쿠키에는 키를 저장하지 않습니다.

이 서버는 한 명의 시연자가 사용하는 로컬 앱입니다. 여러 브라우저 탭은 같은 연결을 공유합니다. 기본 localhost 바인딩을 유지하세요. 다중 사용자 서비스로 배포하려면 인증과 사용자별 연결 격리를 추가해야 합니다.

기존 환경변수와 토큰 파일도 지원합니다. `.env`, `app/.gw_token`, `app/.gh_token`, `app/.tg_token`을 커밋하지 마세요. 환경변수로 AgentMail을 연결하려면 `AGENTMAIL_API_KEY`, `AGENTMAIL_INBOX_ID`를 설정합니다. Telegram은 별도 봇의 token과 `TG_CHAT_ID`를 함께 지정합니다.

## 검증

```bash
npm test
# 로컬 Chrome/Chromium 설치 필요
TEST_CHROMIUM_EXECUTABLE=/path/to/chromium npm run test:browser
```

연결 검증·취소 경쟁·발송 조건·작업 조회 재시도·Gateway 오류·HTTPS·잘못된 요청 거부를 테스트합니다. 브라우저 테스트는 로컬 fixture로 데스크톱·모바일 UI, 대화 전환 중 지연 응답 유지와 실제 CDP 탐색·스크롤·링크 추출·JPEG 캡처, 다중 검색원 병합·원문 읽기·출처 검증을 확인합니다. 접근이 막힌 원문을 건너뛰고 다른 후보를 읽는 동작도 확인합니다. 실제 Telegram / AgentMail 계정 또는 Spark gateway로 보내는 테스트는 포함하지 않습니다.

## 참고 구현

- [데모 구성 안내](https://hackmd.io/WhaCGaC5RH6vsG4z_vmYqg): Telegram·브라우저·AgentMail 활용 흐름.
- [ai-studio](https://github.com/bacdemokr/ai-studio/tree/94fd9a31f49c245dd4ff6270b3a0fb4ac33313a4): Bot token + Chat ID 설정 흐름 참고.
- [bac-demo-kr](https://github.com/yechank-nvidia/bac-demo-kr/tree/a205ea8b228a6e77f88199649f3f9b6dc55f8655): 탐색 팝업·진행 표시 흐름 참고. 여기서는 결과 재생 대신 실제 CDP 화면을 캡처합니다.
- [AgentMail 공식 SDK](https://github.com/agentmail-to/agentmail-node/tree/e344c53d0e8777ee353759c141f85e23d6e71a99): Inbox 조회, 메시지 목록, 발송 API 경로 확인.
- [AgentMail MCP 안내](https://www.agentmail.to/docs/integrations/mcp): gateway의 에이전트가 직접 이메일 도구를 호출하게 확장할 때 참고. 현재 메시지 화면은 REST API 연동입니다.
