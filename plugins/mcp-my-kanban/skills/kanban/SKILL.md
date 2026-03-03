---
description: >
  Use this skill when working as an agent on a team using the Kanban MCP server.
  에이전트가 칸반보드 MCP 서버를 통해 태스크를 선택하고, 작업을 시작하고,
  자가 리뷰를 수행하고, 재작업할 때 이 스킬을 사용한다.
  task_start, task_submit_review, task_complete, task_rework, task_comment 등의 도구를 사용할 때 적용된다.
---

# Kanban Agent Workflow

## ⚠️ 필수 전제조건 — 프로젝트 등록

**모든 `task_*` 도구는 프로젝트가 등록된 후에만 작동한다.**
MCP 시작 시 자동 등록되지 않는다. 반드시 수동으로 등록해야 한다.

등록 없이 태스크 도구를 호출하면 다음 오류를 반환한다:
```
No project registered. Use project_create or project_get_by_path to register a project first.
```

### 전체 사용 순서

```
① 프로젝트 등록  →  ② PROJECT_ID 확보  →  ③ task_* 도구 사용
```

### 등록 방법

| 상황 | 도구 | 설명 |
|------|------|------|
| 이 워크스페이스 처음 사용 | `project_create` | 새 프로젝트 생성 · `.kanban` 파일 기록 |
| 이전에 사용한 워크스페이스 | `project_get_by_path` | `.kanban` 파일로 기존 프로젝트 복원 |

→ 세부 절차는 아래 **세션 시작** 섹션 참고.

---

## 세션 시작 (Session Init) — 프로젝트 등록 필수

**모든 세션 시작 시 반드시 아래 순서를 따른다.**

### Step 1 — 워크스페이스에 기존 프로젝트 확인

```
project_get_by_path workspace_path=<현재 작업 디렉토리 절대 경로>
```

### Step 2a — 프로젝트가 있으면: 기존 프로젝트 사용

반환된 `project.id`를 이번 세션의 **PROJECT_ID**로 사용.

### Step 2b — 프로젝트가 없으면 (null 반환): 새 프로젝트 생성

```
project_create name=<프로젝트 이름> workspace_path=<현재 작업 디렉토리 절대 경로>
```

서버가 해당 경로에 `.kanban` 파일을 자동 생성하고 project_id를 기록한다.
반환된 `project.id`를 이번 세션의 **PROJECT_ID**로 사용.

> ⚠️ **CRITICAL:** `project_create` 호출 시 `workspace_path`를 반드시 포함할 것.
> `workspace_path` 없이 호출하면 `.kanban`이 생성되지 않아 재실행 시 중복 프로젝트가 만들어진다.

이후 `task_create`, `task_list` 등 **모든 프로젝트 관련 작업에서 이 PROJECT_ID를 사용**한다.

---

## 상태 흐름

```
todo(미승인) → approved(승인) → in_progress → review → done → [1개월 후 archive]
                                                 ↓
                                              claimed(재작업) → in_progress → ...
```

**Notes:**
- `todo`: 사용자 미승인 상태. 에이전트는 이 상태의 태스크를 작업할 수 없다.
- `approved`: 사용자가 웹 UI에서 승인한 상태. 에이전트가 `task_start`로 작업을 시작할 수 있다.
- `claimed`: 자가 리뷰 실패로 재작업이 필요한 상태. `task_start`로 재시작한다.
- `done` 상태 1개월 초과 태스크는 자동으로 아카이브된다.

---

## 작업 선택 전 (Before Starting)

1. **승인된 작업 확인**
   ```
   task_list status=approved
   ```

2. **전제조건 확인** — prerequisites가 있는 태스크는 상세 조회로 충족 여부 확인
   ```
   task_get taskId=<id>
   ```
   - 미충족 전제조건이 있으면 `task_start`가 에러를 반환하므로 다른 태스크 선택

---

## 작업 시작 (Start)

```
# 승인된 태스크에서 바로 시작 (approved → in_progress)
task_start taskId=<id> agentName=<내 이름>
```

> `task_start`가 실패하면 (`Prerequisite tasks not done`) 전제조건 태스크가 완료될 때까지 대기하거나 다른 태스크를 선택한다.

---

## 작업 중 (In Progress)

### ⚠️ 기록 규칙 — 예외 없음

| 시점 | 호출 도구 |
|------|----------|
| `task_start` 직후 | `task_comment` — 작업 계획 |
| 파일/코드 수정 완료 직후 | `task_log_change` — diff 포함 |
| 단계 전환 전 (분석→구현, 구현→검증 등) | `task_comment` — 다음 단계 예고 |
| 예상 밖 발견 또는 문제 발생 즉시 | `task_comment` — 이슈 설명 |

**파일 하나 수정 = `task_log_change` 한 번. 다음 파일로 넘어가기 전에 반드시 호출한다.**

### task_log_change 엄격 규칙

| 규칙 | 위반 예 | 올바른 예 |
|------|---------|----------|
| 파일 1개 = 호출 1번 | 3파일을 1번 호출 | 3번 호출 |
| 실제 파일 경로 | `# service file` | `# src/services/kanban.service.ts` |
| 실제 코드 라인 | `+ added validation` | `+ if (!name) throw new Error('name required');` |
| 구체적 summary | `Update file` | `Add name validation to createProject` |

### Red Flags — 즉시 기록하라

이런 생각이 들면 합리화다. 멈추고 기록한다:

| 합리화 | 현실 |
|--------|------|
| "이건 나중에 기록해도 된다" | 나중은 없다. 지금 기록한다. |
| "작은 변경이라 괜찮다" | 크기 기준 없다. 파일을 바꿨으면 기록한다. |
| "리뷰 summary로 대신하겠다" | summary는 결과만 보여준다. 과정 기록은 별개다. |
| "지금은 흐름을 끊고 싶지 않다" | 기록이 곧 작업이다. 흐름 핑계는 통하지 않는다. |
| "코드가 self-explanatory하다" | 사용자는 코드 접근 불가. 기록이 유일한 시각화다. |

### task_start 직후 — 시작 코멘트

```
task_comment taskId=<id> agentName=<내 이름> comment="[시작] 작업 계획:
분석: <무엇을 먼저 파악할지>
구현: <어떤 파일을 변경할지>
검증: <완료 조건>"
```

### 파일 수정 직후 — 변경 기록 (즉시 호출)

```
task_log_change taskId=<id> agentName=<내 이름>
  type=<feature|fix|docs|refactor>
  summary="<한 줄 요약>"
  diff="# <파일 경로>
- <삭제된 줄>
+ <추가된 줄>"
```

**diff 작성 규칙:**
- `#` 줄: 변경된 파일 경로
- `+` 줄: 추가된 코드 (UI에서 초록색)
- `-` 줄: 삭제된 코드 (UI에서 빨간색)
- 전체 파일 불필요 — 핵심 변경 부분만 기록

**type 선택 기준:**
| type | 사용 시점 |
|------|----------|
| `feature` | 새 기능 추가 |
| `fix` | 버그 수정 |
| `docs` | 문서·주석 변경 |
| `refactor` | 동작 변경 없는 코드 정리 |

### 단계 전환 / 이슈 발생 시 — 진행 코멘트

```
task_comment taskId=<id> agentName=<내 이름> comment="[진행중] <단계명>
완료: <이번에 끝낸 것>
다음: <다음 할 일>"
```

```
task_comment taskId=<id> agentName=<내 이름> comment="[이슈] <문제 요약>
상황: <구체적 상황>
시도: <해결 시도>
결정: <선택한 방향>"
```

---

## 작업 완료 및 자가 리뷰 (Submit & Self-Review)

### 1. 리뷰 제출

```
task_comment taskId=<id> agentName=<내 이름> comment="완료: <주요 변경사항 요약>"

task_submit_review taskId=<id> agentName=<내 이름> summary="구현 완료: <간략한 설명>"
```

### 2. 자가 리뷰 체크리스트

리뷰 제출 후 반드시 다음을 확인한다:

- [ ] 태스크 description의 요구사항 모두 충족했는가?
- [ ] 기존 기능 깨뜨리지 않았는가?
- [ ] 모든 파일 변경을 task_log_change로 기록했는가?
- [ ] diff에 실제 파일 경로와 실제 코드가 포함되어 있는가?

### 3a. 자가 리뷰 통과 → 완료

```
task_complete taskId=<id> agentName=<내 이름>
```

### 3b. 자가 리뷰 실패 → 재작업

```
task_rework taskId=<id> agentName=<내 이름> corrections="수정 내용 설명"
```

재작업 시 태스크는 `claimed` 상태로 복귀한다. `task_start`로 다시 시작한다.

```
task_start taskId=<id> agentName=<내 이름>
# 수정 후 다시 리뷰 제출
task_submit_review taskId=<id> agentName=<내 이름> summary="재작업 완료: <반영 내용>"
```

---

## 도구 목록 (Quick Reference)

| 도구 | 동작 |
|------|------|
| `task_list` | 태스크 목록 조회 (status, projectId, tags 필터) |
| `task_get` | 태스크 + 전체 히스토리 조회 |
| `task_create` | 새 태스크 생성 (todo/미승인 상태, prerequisites 지정 가능) |
| `task_claim` | ~~[DEPRECATED]~~ todo → claimed. `task_start`를 대신 사용할 것 |
| `task_start` | approved/claimed → in_progress (prerequisites 검증 포함) |
| `task_submit_review` | in_progress → review |
| `task_complete` | review → done (자가 리뷰 통과) |
| `task_rework` | review → claimed + corrections (자가 리뷰 실패) |
| `task_comment` | 상태 변경 없이 코멘트 추가 |
| `task_log_change` | 코드/문서 변경 내역 + diff 기록 |
| `task_update` | 메타데이터 수정 (title, description, tags, prerequisites) |
| `project_list` | 프로젝트 목록 조회 |
| `project_get_by_path` | 워크스페이스 경로로 연결된 프로젝트 조회 (.kanban 파일 읽기) |
| `project_create` | 새 프로젝트 생성 (workspace_path 필수) |
| `project_delete` | 프로젝트 삭제 (force=true 시 태스크 포함) |
