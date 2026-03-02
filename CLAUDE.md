# ARaTasia MCP Monorepo

## 구조

```
plugins/
  mcp-my-kanban/   # Kanban board MCP 서버 (npm: mcp-my-kanban)
```

## 플러그인 작업 시

플러그인별 규칙은 각 플러그인 디렉토리의 `CLAUDE.md` 참고.

## 브랜치 전략

- `main` — 배포 기준 브랜치
- 기능 개발은 `feat/...` 브랜치에서 작업 후 PR

### 배포 절차

1. feat 브랜치에서 작업 완료
2. `npm publish --access public` (npm 레지스트리 배포)
3. feat 브랜치를 main에 머지 + push (플러그인 UI 버전 반영)

## 커밋 컨벤션

```
feat:     새 기능
fix:      버그 수정
chore:    빌드·버전·설정 변경
docs:     문서 변경
refactor: 동작 변경 없는 코드 정리
```
