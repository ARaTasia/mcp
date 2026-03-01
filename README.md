# Kanban MCP Plugin

칸반보드 MCP 서버 + Claude Code 플러그인.

에이전트 팀이 태스크를 생성·이동·코멘트하고, 웹 UI에서 사용자가 실시간으로 현황 확인 및 리뷰 승인/반려 처리.

## 사용법

### 1. MCP 서버 시작

```bash
cd D:/@Workspace/media/tech/mcp
npm run dev
```

- Web UI + WebSocket: http://localhost:3000
- MCP endpoint: http://localhost:3001/mcp

### 2. Claude Code에서 플러그인 로드

```bash
claude --plugin-dir D:/@Workspace/media/tech/mcp/kanban
```

`--plugin-dir`로 로드하면:
- `.claude-plugin/plugin.json` 의 스킬이 자동 등록됨
- `.mcp.json` 의 MCP 서버가 자동 연결됨

### 3. 스킬 호출

```
/kanban-mcp:kanban
```

`/help` 에서 `kanban-mcp:kanban` 스킬이 목록에 표시되는지 확인.

## 구조

```
kanban/
├── .claude-plugin/
│   └── plugin.json          # 플러그인 메타데이터 (name: "kanban-mcp")
├── .mcp.json                 # MCP 서버 연결 설정
├── skills/
│   └── kanban/
│       └── SKILL.md          # 에이전트 워크플로우 가이드
└── src/                      # MCP 서버 소스
```

## 스킬 내용

`skills/kanban/SKILL.md` — 에이전트가 칸반보드를 사용할 때의 워크플로우:

- 태스크 선택 전 전제조건 확인
- `task_claim` → `task_start` → `task_submit_review` 흐름
- 반려(reject) 후 재작업 흐름
- 사용 가능한 MCP 도구 목록

## 상태 흐름

```
todo → claimed → in_progress → review → done
                                   ↓ (reject)
                                claimed  (재작업 필요)
```
