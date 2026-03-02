# mcp-my-kanban

[English](README.md)

에이전트 팀 협업을 위한 칸반보드 MCP 서버. 상태 추적, 선행조건 의존성, 코드 변경 기록, 웹 UI를 제공합니다.

## 설치

Claude Code 마켓플레이스에서 설치:

```
/install-plugin ARaTasia/mcp
```

## 시작하기

태스크 도구를 사용하기 전에 프로젝트를 등록해야 합니다:

```
# 새 워크스페이스 — .kanban 파일을 생성하여 프로젝트를 기억
project_create name="my-project" workspace_path="/path/to/workspace"

# 기존 워크스페이스로 복귀
project_get_by_path workspace_path="/path/to/workspace"
```

반환된 `projectId`를 모든 태스크 작업에 사용합니다.

## 도구

### 프로젝트

#### `project_create`

새 프로젝트를 생성합니다. 워크스페이스에 `.kanban` 파일을 기록하여 재실행 시 중복 생성을 방지합니다.

| 파라미터 | 타입 | 필수 | 설명 |
|---------|------|------|------|
| name | string | O | 프로젝트 이름 |
| description | string | | 프로젝트 설명 |
| workspace_path | string | | 워크스페이스 디렉토리 절대 경로 |

#### `project_get_by_path`

지정된 디렉토리의 `.kanban` 파일을 읽어 연결된 프로젝트를 반환합니다. `.kanban` 파일이 없으면 null을 반환합니다.

| 파라미터 | 타입 | 필수 | 설명 |
|---------|------|------|------|
| workspace_path | string | O | 워크스페이스 디렉토리 절대 경로 |

#### `project_list`

전체 프로젝트 목록을 조회합니다. 파라미터 없음.

#### `project_delete`

프로젝트를 삭제합니다. 태스크가 있으면 `force`가 true일 때만 삭제됩니다.

| 파라미터 | 타입 | 필수 | 설명 |
|---------|------|------|------|
| project_id | string | O | 프로젝트 ID |
| force | boolean | | true이면 모든 태스크와 히스토리도 함께 삭제 |

### 태스크

#### `task_create`

`todo` 상태의 새 태스크를 생성합니다.

| 파라미터 | 타입 | 필수 | 설명 |
|---------|------|------|------|
| projectId | string | O | 프로젝트 ID |
| title | string | O | 태스크 제목 |
| description | string | | 태스크 설명 |
| tags | string[] | | 태그, 예: `["backend", "db"]` |
| assignee | string | | 에이전트 이름 |
| prerequisites | string[] | | 선행 태스크 ID 목록 (완료되어야 claim 가능) |

#### `task_list`

필터를 적용하여 태스크 목록을 조회합니다.

| 파라미터 | 타입 | 필수 | 설명 |
|---------|------|------|------|
| projectId | string | | 프로젝트 ID로 필터 |
| status | string | | 상태로 필터: `todo` \| `claimed` \| `in_progress` \| `review` \| `done` |
| tags | string[] | | 태그로 필터 (하나라도 일치하면 포함) |

#### `task_get`

태스크와 전체 히스토리를 조회합니다.

| 파라미터 | 타입 | 필수 | 설명 |
|---------|------|------|------|
| taskId | string | O | 태스크 ID |

#### `task_claim`

todo 태스크를 선점합니다 (`todo` → `claimed`). 모든 선행조건이 완료되었는지 검증합니다.

| 파라미터 | 타입 | 필수 | 설명 |
|---------|------|------|------|
| taskId | string | O | 태스크 ID |
| agentName | string | O | 에이전트 이름 |

#### `task_start`

선점한 태스크의 작업을 시작합니다 (`claimed` → `in_progress`).

| 파라미터 | 타입 | 필수 | 설명 |
|---------|------|------|------|
| taskId | string | O | 태스크 ID |
| agentName | string | O | 에이전트 이름 |

#### `task_submit_review`

태스크를 리뷰에 제출합니다 (`in_progress` → `review`).

| 파라미터 | 타입 | 필수 | 설명 |
|---------|------|------|------|
| taskId | string | O | 태스크 ID |
| agentName | string | O | 에이전트 이름 |
| summary | string | O | 작업 내용 요약 |

#### `task_comment`

태스크에 코멘트를 추가합니다. 상태 변경 없음.

| 파라미터 | 타입 | 필수 | 설명 |
|---------|------|------|------|
| taskId | string | O | 태스크 ID |
| agentName | string | O | 에이전트 이름 |
| comment | string | O | 코멘트 내용 |

#### `task_log_change`

태스크에 코드/문서 변경 사항을 diff 형식으로 기록합니다.

| 파라미터 | 타입 | 필수 | 설명 |
|---------|------|------|------|
| taskId | string | O | 태스크 ID |
| agentName | string | O | 에이전트 이름 |
| type | string | O | `feature` \| `fix` \| `docs` \| `refactor` |
| summary | string | O | 변경 내용 한 줄 요약 |
| diff | string | O | diff 텍스트. `#`은 파일명, `+`는 추가, `-`는 삭제 |

#### `task_update`

태스크 메타데이터를 수정합니다 (제목, 설명, 태그, 선행조건).

| 파라미터 | 타입 | 필수 | 설명 |
|---------|------|------|------|
| taskId | string | O | 태스크 ID |
| title | string | | 새 제목 |
| description | string | | 새 설명 |
| tags | string[] | | 새 태그 |
| prerequisites | string[] | | 선행 태스크 ID 목록 |

## 태스크 상태 흐름

```
todo → claimed → in_progress → review → done
                                  ↓
                               claimed  (반려)
```

## 웹 UI

서버 실행 시 웹 대시보드가 자동으로 시작됩니다. 기본 포트는 `34567`이며, `WEB_PORT` 환경변수로 변경할 수 있습니다.
