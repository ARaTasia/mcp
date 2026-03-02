# mcp-my-kanban

Kanban board MCP 서버. 에이전트 팀 협업용 태스크 관리 도구.

## 버전 관리 — 반드시 지켜야 할 규칙

버전을 올릴 때 **반드시 아래 3개 파일을 모두 동시에 수정**한다. 하나라도 누락하면 안 된다.

| 파일 | 위치 | 변경 내용 |
|------|------|----------|
| `package.json` | 루트 | `"version"` 필드 |
| `.claude-plugin/plugin.json` | 루트 | `"version"` 필드 |
| `src/mcp/server.ts` | src | `version: '...'` (2곳) |

### 배포 체크리스트

```
[ ] package.json             "version": "X.Y.Z"
[ ] .claude-plugin/plugin.json  "version": "X.Y.Z"
[ ] src/mcp/server.ts        version: 'X.Y.Z'  (createMcpServer, createMcpApp 각 1곳)
[ ] npm run build            빌드 성공 확인
[ ] git commit               chore: bump version to X.Y.Z
[ ] npm publish --access public
[ ] main 브랜치에 머지 + push
```

### 플러그인 버전 표시 구조

Claude Code 마켓플레이스와 npm 레지스트리는 **별개 경로**로 버전을 읽는다.

```
플러그인 UI 버전:   git clone (main) → plugin.json
MCP 서버 실행:     npx mcp-my-kanban@latest → npm 레지스트리
```

- 마켓플레이스는 git의 **main 브랜치**에서 `plugin.json`을 읽는다.
- `npm publish`만으로는 플러그인 UI에 표시되는 버전이 갱신되지 않는다.
- feat 브랜치를 **main에 머지 + push**해야 `/plugin` update 시 새 버전이 반영된다.

### 버전 번호 기준 (Semver)

| 변경 유형 | 올릴 자리 | 예시 |
|----------|----------|------|
| 동작 변경 / 새 기능 | Minor (Y) | 1.1.0 → 1.2.0 |
| 버그 수정 / 누락 수정 | Patch (Z) | 1.2.0 → 1.2.1 |
| 하위 호환 불가 변경 | Major (X) | 1.x.x → 2.0.0 |

### npm 퍼블리시

```bash
cd plugins/mcp-my-kanban
npm publish --access public
```

- 동일 버전은 재배포 불가. 내용이 바뀌었으면 패치 버전을 올려야 한다.
- npm 토큰은 `~/.npmrc`에 저장되어 있다 (`//registry.npmjs.org/:_authToken=...`).

## 프로젝트 구조

```
src/
  mcp-stdio.ts          # 진입점 (stdio MCP 서버)
  mcp/
    server.ts            # McpServer 생성 — 버전 하드코딩 위치
    tools/
      task.tools.ts      # task_* 도구 (9개)
      project.tools.ts   # project_* 도구 (4개)
  services/
    kanban.service.ts    # 비즈니스 로직
  db/
    schema.ts            # SQLite 스키마 초기화
    index.ts             # DB 래퍼
  web/
    router.ts            # REST API
    websocket.ts         # WebSocket 브로드캐스트
skills/
  kanban/SKILL.md        # 에이전트 워크플로 스킬
.claude-plugin/
  plugin.json            # Claude Code 플러그인 메타데이터
```

## 주요 설계 결정

- **프로젝트 명시적 등록 필수**: MCP 시작 시 자동 프로젝트 생성 없음.
  `project_create` 또는 `project_get_by_path` 호출 후에만 `task_*` 도구 사용 가능.
- **requireProject() 가드**: 모든 task_* 핸들러 최상단에서 등록된 프로젝트 존재 여부 검증.
- **DB**: SQLite (better-sqlite3), `~/.mcp-my-kanban/kanban.db`
- **멀티 클라이언트**: PID 파일로 관리, 마지막 클라이언트 종료 시 웹 서버 자동 종료.

## 빌드

```bash
npm run build   # tsc + 정적 파일 복사
```
