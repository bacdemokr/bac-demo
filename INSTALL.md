# 설치 및 실행

앱 실행에 필요한 것은 **Node.js 20.6 이상**입니다. macOS와 Linux를 지원합니다. `.env` 복사, API 키 입력, OpenClaw 설치는 앱 실행의 필수 단계가 아닙니다.

## 처음 실행

GitHub에서 프로젝트를 받은 뒤 바로 실행하세요.

```bash
git clone https://github.com/bacdemokr/bac-demo.git
cd bac-demo
./bac start
```

이미 이 버전의 프로젝트 폴더가 있다면 `./bac start`만 실행하세요. [http://127.0.0.1:8000](http://127.0.0.1:8000)에서 앱을 엽니다. 첫 실행의 패키지 설치에는 인터넷 연결이 필요합니다.

앱이 자동으로 처리합니다.

- 필요한 앱 패키지 설치
- 저장된 `api.json` 읽기와 연결 확인 - 파일이 없으면 빈 파일 준비
- 설치된 Chrome/Chromium 실행 또는 기존 CDP 브라우저 재사용
- 실행 중인 로컬 OpenClaw의 설정·토큰·에이전트 자동 확인

Chrome/Chromium은 브라우저 탐색 기능을 사용할 때만 필요합니다. 설치돼 있지 않아도 앱은 실행됩니다. OpenClaw는 이미 설치하고 실행해 둔 경우에 자동 연결하며, 앱이 새로 설치하거나 실행하지는 않습니다.

종료는 다른 터미널에서도 **`./bac stop`** 한 번으로 할 수 있습니다. 실행 상태 확인은 `./bac status`입니다. `./bac stop`은 이 폴더의 `./bac start`가 실행한 앱과 브라우저를 종료하고 포트가 닫혔는지 확인합니다. 다른 포트로 실행했다면 `./bac stop --port 8001`처럼 같은 포트를 지정하세요. 기존 브라우저·OpenClaw·다른 프로그램은 종료하지 않습니다. 실행한 터미널의 **Ctrl+C**도 계속 사용할 수 있습니다.

이전 버전에서 이미 실행 중인 앱은 기존 터미널에서 한 번 종료하고 업데이트한 `./bac start`로 다시 실행해야 `stop`을 사용할 수 있습니다. systemd로 직접 실행한 경우에는 `systemctl --user stop bac-demo`를 사용하세요.

## 사용할 기능만 연결하기

**연결 설정**에서 필요한 서비스만 입력하세요. 전체 항목을 채울 필요가 없습니다.

| 사용할 기능 | 필요한 설정 |
| --- | --- |
| 시스템 지표·논문 목록 | API 키 없음 |
| 맛집·아마존 검색, 검색 페이지·원문 탐색 | 설치된 Chrome/Chromium; API 키 없음 |
| AI 대화·조사 요약·PM/Dev 코드 생성 | 기존 OpenClaw, 로컬 모델, NVIDIA API 중 **하나** |
| GitHub 저장소 조회·Fork·PR | GitHub 토큰; 작업할 저장소는 화면에서 선택 |
| Telegram 수신·결과 공유 | Bot token + Chat ID |
| AgentMail 받은편지함·결과 공유 | API key + 기존 Inbox ID |

AI 연결이 없다면 **연결 설정 → 모델**에서 로컬 모델 또는 NVIDIA API를 연결하세요. 기존 OpenClaw가 정상 실행 중이면 해당 연결을 그대로 사용할 수 있습니다. AI 모델이 없어도 표의 조회·브라우저 검색 기능을 사용할 수 있습니다. PM/Dev가 PR을 만들려면 AI 모델과 쓰기 가능한 GitHub 작업 저장소가 함께 필요합니다.

로컬 모델은 이미 실행 중인 OpenAI 호환 서버 주소를 입력하고 **모델 목록 불러오기**에서 모델을 선택합니다. 기본 예시 주소는 `http://127.0.0.1:8001/v1`이며 앱의 8000번 포트와 겹치지 않아야 합니다. 서버가 인증을 요구할 때만 키를 넣습니다. 모델 서버 설치·모델 다운로드는 앱이 대신 수행하지 않습니다.

NVIDIA API는 사용할 서비스와 API 키를 입력하고 모델을 선택합니다. 앱에서 연결을 확인한 뒤 바로 사용합니다. 두 종류를 모두 설정할 필요는 없습니다.

## 재시작 후에도 연결 유지하기 - 선택

화면에서 입력한 연결은 서버 메모리에 보관하므로 앱 재시작 시 초기화됩니다. 계속 사용할 연결만 프로젝트의 `api.json`에 넣으면 다음 시작 때 자동으로 읽습니다. 이 파일은 첫 실행에 준비되므로 복사 명령이 필요하지 않습니다. 사용하지 않는 서비스는 비워두거나 항목을 빼세요.

예를 들어 GitHub만 연결한다면 다음으로 충분합니다.

```json
{
  "github": { "token": "YOUR_GITHUB_TOKEN" }
}
```

로컬 모델만 사용한다면 다음과 같이 설정합니다.

```json
{
  "models": {
    "active": "local",
    "local": {
      "baseUrl": "http://127.0.0.1:8001/v1",
      "model": "YOUR_MODEL_ID"
    }
  }
}
```

전체 항목의 빈 예시는 [api.example.json](api.example.json), NVIDIA 모델을 포함한 설정 예시는 [README.md](README.md#모델-설정)에 있습니다. 파일 변경 후 앱을 재시작하세요. 화면에서 이미 연결됐다고 표시되는 서비스는 키를 다시 입력하지 않아도 됩니다. `api.json`은 Git과 배포 파일에서 제외됩니다. 기존 `.env`와 토큰 파일도 계속 읽습니다.

## 기능별 연결 참고

**GitHub:** 토큰만 입력하면 계정을 확인합니다. `owner/repo`는 고정된 기존 저장소를 바로 쓸 때만 입력합니다. 공개 저장소를 검색해 **내 계정에 Fork**한 다음 **이 저장소에서 작업**을 선택하면 협업을 시작합니다. 토큰 권한은 수행할 작업에 따라 달라집니다. 새 Fork에 대한 접근과 생성 권한이 필요하며, 코드·PR 작업에는 Contents와 Pull requests 쓰기 권한, 내 Fork 삭제에는 Administration 쓰기 권한이 필요합니다. [GitHub Fork 권한](https://docs.github.com/en/rest/repos/forks#create-a-fork), [삭제 권한](https://docs.github.com/en/rest/repos/repos#delete-a-repository)을 참고하세요. 조회·연결만으로 저장소를 변경하지 않습니다.

**Telegram:** [BotFather](https://t.me/BotFather)에서 봇을 만들고 봇에게 `/start`를 보낸 뒤 Bot token과 Chat ID를 연결합니다. 기존 OpenClaw가 사용하는 봇과는 별도 봇을 사용하세요. 연결 확인만으로 메시지를 발송하지 않습니다.

**AgentMail:** [AgentMail Console](https://console.agentmail.to)에서 API key와 inbox를 만든 뒤 키와 기존 Inbox ID를 연결합니다. 연결·조회만으로 이메일을 발송하지 않습니다.

**OpenClaw MCP:** 직접 모델 연결과 앱의 GitHub·메시지 기능에는 필요하지 않습니다. OpenClaw 에이전트가 MCP 도구를 직접 호출하는 경로를 시연할 때만 별도로 등록합니다. 원격 Gateway, 특수한 설치 경로, GitHub MCP와 Linux 상시 실행 설정은 [선택 설정](ADVANCED.md)에 있습니다.
