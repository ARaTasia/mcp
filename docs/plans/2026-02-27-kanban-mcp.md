# Kanban MCP Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 팀 에이전트들이 MCP 도구로 칸반보드 태스크를 관리하고, 사용자는 웹 UI에서 실시간으로 현황을 확인하며 Review를 승인/반려할 수 있는 시스템 구축.

**Architecture:** 단일 Node.js 프로세스에서 MCP Streamable HTTP 서버(포트 3001)와 Express 웹서버(포트 3000)를 동시 실행. 두 서버는 KanbanService를 공유하며, KanbanService는 SQLite DB에 쓰고 WebSocket으로 변경사항을 브로드캐스트.

**Tech Stack:** Node.js, TypeScript, `@modelcontextprotocol/sdk` v1.27+, `express`, `ws`, `better-sqlite3`, `zod`, `nanoid`, `tsx`

---

## Project Layout

```
D:/@Workspace/media/tech/mcp/
├── src/
│   ├── server.ts
│   ├── db/
│   │   ├── index.ts
│   │   └── schema.ts
│   ├── services/
│   │   └── kanban.service.ts
│   ├── mcp/
│   │   ├── server.ts
│   │   └── tools/
│   │       ├── task.tools.ts
│   │       └── project.tools.ts
│   └── web/
│       ├── router.ts
│       ├── websocket.ts
│       └── public/
│           ├── index.html
│           ├── app.js
│           └── style.css
├── skills/
│   └── kanban.md
├── data/               # gitignored
│   └── kanban.db
├── docs/plans/
│   └── 2026-02-27-kanban-mcp.md
├── package.json
├── tsconfig.json
├── .env.example
└── .gitignore
```

---

### Task 1: 프로젝트 초기화

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.env.example`
- Create: `.gitignore`

**Step 1: package.json 작성**

```json
{
  "name": "kanban-mcp",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc",
    "start": "node dist/server.js"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.27.0",
    "better-sqlite3": "^9.6.0",
    "express": "^4.19.2",
    "nanoid": "^5.0.7",
    "ws": "^8.17.1",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.10",
    "@types/express": "^4.17.21",
    "@types/node": "^20.14.9",
    "@types/ws": "^8.5.10",
    "tsx": "^4.16.2",
    "typescript": "^5.5.3"
  }
}
```

**Step 2: tsconfig.json 작성**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**Step 3: .env.example 작성**

```
MCP_PORT=3001
WEB_PORT=3000
DB_PATH=./data/kanban.db
```

**Step 4: .gitignore 작성**

```
node_modules/
dist/
data/
.env
*.db
```

**Step 5: 의존성 설치**

```bash
cd "D:/@Workspace/media/tech/mcp"
npm install
```

Expected: `node_modules/` 폴더 생성, 패키지 설치 완료

**Step 6: git 초기화 및 커밋**

```bash
git init
git add package.json tsconfig.json .env.example .gitignore
git commit -m "chore: initialize kanban-mcp project"
```

---

### Task 2: DB 레이어

**Files:**
- Create: `src/db/schema.ts`
- Create: `src/db/index.ts`

**Step 1: `src/db/schema.ts` 작성**

```typescript
export const SCHEMA_SQL = `
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'todo'
    CHECK(status IN ('todo','claimed','in_progress','review','done')),
  tags TEXT NOT NULL DEFAULT '[]',
  assignee TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS task_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  comment TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_history_task ON task_history(task_id);
`;
```

**Step 2: `src/db/index.ts` 작성**

```typescript
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { SCHEMA_SQL } from './schema.js';

const dbPath = process.env.DB_PATH ?? './data/kanban.db';
const dbDir = path.dirname(dbPath);

if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

export const db = new Database(dbPath);
db.exec(SCHEMA_SQL);

export default db;
```

**Step 3: DB 동작 빠른 검증 (node 직접 실행)**

```bash
cd "D:/@Workspace/media/tech/mcp"
node -e "
import('./src/db/index.js').then(({ db }) => {
  const r = db.prepare('SELECT sqlite_version() as v').get();
  console.log('SQLite OK:', r.v);
  db.close();
}).catch(e => console.error(e));
"
```

Expected: `SQLite OK: 3.x.x`

> 참고: ESM 환경이라 직접 node 실행이 안 될 수 있음. 아래처럼 tsx로 확인해도 됨:
> ```bash
> echo "import db from './src/db/index.js'; console.log(db.prepare('SELECT 1 as n').get()); db.close();" > /tmp/test-db.ts
> npx tsx /tmp/test-db.ts
> ```

**Step 4: 커밋**

```bash
git add src/db/
git commit -m "feat: add SQLite schema and db instance"
```

---

### Task 3: WebSocket 브로드캐스터

**Files:**
- Create: `src/web/websocket.ts`

**Step 1: `src/web/websocket.ts` 작성**

```typescript
import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'http';
import type { Server } from 'http';

let wss: WebSocketServer | null = null;

export function initWebSocket(server: Server): void {
  wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    console.log(`[WS] Client connected from ${req.socket.remoteAddress}`);
    ws.on('close', () => console.log('[WS] Client disconnected'));
  });

  console.log('[WS] WebSocket server initialized at /ws');
}

export interface BroadcastEvent {
  type: 'task_created' | 'task_updated' | 'history_added';
  payload: unknown;
}

export function broadcast(event: BroadcastEvent): void {
  if (!wss) return;
  const message = JSON.stringify(event);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}
```

**Step 2: 커밋**

```bash
git add src/web/websocket.ts
git commit -m "feat: add WebSocket broadcaster"
```

---

### Task 4: KanbanService (핵심 비즈니스 로직)

**Files:**
- Create: `src/services/kanban.service.ts`

**Step 1: `src/services/kanban.service.ts` 작성**

```typescript
import { nanoid } from 'nanoid';
import db from '../db/index.js';
import { broadcast } from '../web/websocket.js';

// ── 타입 ──────────────────────────────────────────────────────────────────

export type TaskStatus = 'todo' | 'claimed' | 'in_progress' | 'review' | 'done';
export type HistoryAction =
  | 'create' | 'claim' | 'start' | 'submit_review'
  | 'approve' | 'reject' | 'comment' | 'update';

export interface Project {
  id: string;
  name: string;
  description: string | null;
  created_at: number;
}

export interface Task {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  tags: string[];
  assignee: string | null;
  sort_order: number;
  created_at: number;
  updated_at: number;
}

export interface TaskHistory {
  id: number;
  task_id: string;
  actor: string;
  action: HistoryAction;
  from_status: string | null;
  to_status: string | null;
  comment: string | null;
  created_at: number;
}

// ── 내부 헬퍼 ────────────────────────────────────────────────────────────

function rowToTask(row: Record<string, unknown>): Task {
  return {
    ...row,
    tags: JSON.parse(row.tags as string),
  } as Task;
}

function addHistory(
  task_id: string,
  actor: string,
  action: HistoryAction,
  from_status: string | null,
  to_status: string | null,
  comment: string | null,
): TaskHistory {
  const stmt = db.prepare(`
    INSERT INTO task_history (task_id, actor, action, from_status, to_status, comment)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const info = stmt.run(task_id, actor, action, from_status, to_status, comment);
  return db
    .prepare('SELECT * FROM task_history WHERE id = ?')
    .get(info.lastInsertRowid) as TaskHistory;
}

// ── 프로젝트 ──────────────────────────────────────────────────────────────

export function listProjects(): Project[] {
  return db.prepare('SELECT * FROM projects ORDER BY created_at DESC').all() as Project[];
}

export function createProject(name: string, description?: string): Project {
  const id = nanoid();
  db.prepare('INSERT INTO projects (id, name, description) VALUES (?, ?, ?)').run(
    id, name, description ?? null,
  );
  return db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as Project;
}

// ── 태스크 ────────────────────────────────────────────────────────────────

export interface ListTasksFilter {
  projectId?: string;
  status?: TaskStatus;
  tags?: string[];
}

export function listTasks(filter: ListTasksFilter = {}): Task[] {
  let sql = 'SELECT * FROM tasks WHERE 1=1';
  const params: unknown[] = [];

  if (filter.projectId) { sql += ' AND project_id = ?'; params.push(filter.projectId); }
  if (filter.status)    { sql += ' AND status = ?';     params.push(filter.status); }

  sql += ' ORDER BY sort_order ASC, created_at ASC';
  const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];

  let tasks = rows.map(rowToTask);
  if (filter.tags && filter.tags.length > 0) {
    tasks = tasks.filter((t) => filter.tags!.every((tag) => t.tags.includes(tag)));
  }
  return tasks;
}

export function getTask(taskId: string): (Task & { history: TaskHistory[] }) | null {
  const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as Record<string, unknown> | null;
  if (!row) return null;
  const task = rowToTask(row);
  const history = db
    .prepare('SELECT * FROM task_history WHERE task_id = ? ORDER BY created_at ASC')
    .all(taskId) as TaskHistory[];
  return { ...task, history };
}

export interface CreateTaskInput {
  projectId: string;
  title: string;
  description?: string;
  tags?: string[];
  assignee?: string;
}

export function createTask(input: CreateTaskInput): Task {
  const id = nanoid();
  const maxOrder = (db
    .prepare('SELECT MAX(sort_order) as m FROM tasks WHERE project_id = ?')
    .get(input.projectId) as { m: number | null }).m ?? -1;

  db.prepare(`
    INSERT INTO tasks (id, project_id, title, description, tags, assignee, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.projectId,
    input.title,
    input.description ?? null,
    JSON.stringify(input.tags ?? []),
    input.assignee ?? null,
    maxOrder + 1,
  );

  const task = rowToTask(
    db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Record<string, unknown>,
  );
  const history = addHistory(id, input.assignee ?? 'user', 'create', null, 'todo', null);

  broadcast({ type: 'task_created', payload: task });
  broadcast({ type: 'history_added', payload: { taskId: id, ...history } });
  return task;
}

function moveTask(
  taskId: string,
  toStatus: TaskStatus,
  actor: string,
  action: HistoryAction,
  comment: string | null = null,
): Task {
  const existing = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as Record<string, unknown> | null;
  if (!existing) throw new Error(`Task not found: ${taskId}`);

  const fromStatus = existing.status as string;
  db.prepare(`
    UPDATE tasks SET status = ?, assignee = COALESCE(?, assignee), updated_at = unixepoch()
    WHERE id = ?
  `).run(toStatus, actor !== 'user' ? actor : null, taskId);

  const task = rowToTask(
    db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as Record<string, unknown>,
  );
  const history = addHistory(taskId, actor, action, fromStatus, toStatus, comment);

  broadcast({ type: 'task_updated', payload: task });
  broadcast({ type: 'history_added', payload: { taskId, ...history } });
  return task;
}

export function claimTask(taskId: string, agentName: string): Task {
  return moveTask(taskId, 'claimed', agentName, 'claim');
}

export function startTask(taskId: string, agentName: string): Task {
  return moveTask(taskId, 'in_progress', agentName, 'start');
}

export function submitReview(taskId: string, agentName: string, summary: string): Task {
  return moveTask(taskId, 'review', agentName, 'submit_review', summary);
}

export function approveReview(taskId: string): Task {
  return moveTask(taskId, 'done', 'user', 'approve');
}

export function rejectReview(taskId: string, reason?: string): Task {
  return moveTask(taskId, 'in_progress', 'user', 'reject', reason ?? null);
}

export function addComment(taskId: string, actor: string, comment: string): TaskHistory {
  const existing = db.prepare('SELECT id FROM tasks WHERE id = ?').get(taskId);
  if (!existing) throw new Error(`Task not found: ${taskId}`);
  const history = addHistory(taskId, actor, 'comment', null, null, comment);
  broadcast({ type: 'history_added', payload: { taskId, ...history } });
  return history;
}

export function updateTaskMeta(
  taskId: string,
  updates: { title?: string; description?: string; tags?: string[] },
): Task {
  const existing = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as Record<string, unknown> | null;
  if (!existing) throw new Error(`Task not found: ${taskId}`);

  const fields: string[] = ['updated_at = unixepoch()'];
  const values: unknown[] = [];

  if (updates.title !== undefined)       { fields.push('title = ?');       values.push(updates.title); }
  if (updates.description !== undefined) { fields.push('description = ?'); values.push(updates.description); }
  if (updates.tags !== undefined)        { fields.push('tags = ?');        values.push(JSON.stringify(updates.tags)); }

  db.prepare(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`).run(...values, taskId);

  const task = rowToTask(
    db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as Record<string, unknown>,
  );
  addHistory(taskId, 'user', 'update', null, null, `Updated: ${Object.keys(updates).join(', ')}`);
  broadcast({ type: 'task_updated', payload: task });
  return task;
}
```

**Step 2: 커밋**

```bash
git add src/services/kanban.service.ts
git commit -m "feat: add KanbanService with full CRUD and history"
```

---

### Task 5: REST API 라우터

**Files:**
- Create: `src/web/router.ts`

**Step 1: `src/web/router.ts` 작성**

```typescript
import express from 'express';
import {
  listProjects, createProject,
  listTasks, getTask, createTask,
  approveReview, rejectReview,
} from '../services/kanban.service.js';

export const router = express.Router();

// ── 프로젝트 ──────────────────────────────────────────────────────────────

router.get('/projects', (_req, res) => {
  res.json(listProjects());
});

router.post('/projects', (req, res) => {
  const { name, description } = req.body;
  if (!name) { res.status(400).json({ error: 'name required' }); return; }
  res.status(201).json(createProject(name, description));
});

// ── 태스크 ────────────────────────────────────────────────────────────────

router.get('/tasks', (req, res) => {
  const { projectId, status, tags } = req.query;
  res.json(listTasks({
    projectId: projectId as string | undefined,
    status: status as string | undefined,
    tags: tags ? (tags as string).split(',') : undefined,
  }));
});

router.post('/tasks', (req, res) => {
  const { projectId, title, description, tags, assignee } = req.body;
  if (!projectId || !title) {
    res.status(400).json({ error: 'projectId and title required' });
    return;
  }
  res.status(201).json(createTask({ projectId, title, description, tags, assignee }));
});

router.get('/tasks/:id', (req, res) => {
  const task = getTask(req.params.id);
  if (!task) { res.status(404).json({ error: 'not found' }); return; }
  res.json(task);
});

router.patch('/tasks/:id/approve', (req, res) => {
  try { res.json(approveReview(req.params.id)); }
  catch (e: unknown) { res.status(400).json({ error: (e as Error).message }); }
});

router.patch('/tasks/:id/reject', (req, res) => {
  try { res.json(rejectReview(req.params.id, req.body.reason)); }
  catch (e: unknown) { res.status(400).json({ error: (e as Error).message }); }
});
```

**Step 2: 커밋**

```bash
git add src/web/router.ts
git commit -m "feat: add Express REST API router"
```

---

### Task 6: MCP 도구 — Project Tools

**Files:**
- Create: `src/mcp/tools/project.tools.ts`

**Step 1: `src/mcp/tools/project.tools.ts` 작성**

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { listProjects, createProject } from '../../services/kanban.service.js';

export function registerProjectTools(server: McpServer): void {
  server.tool(
    'project_list',
    'List all projects',
    {},
    async () => ({
      content: [{ type: 'text', text: JSON.stringify(listProjects(), null, 2) }],
    }),
  );

  server.tool(
    'project_create',
    'Create a new project',
    {
      name: z.string().min(1).describe('Project name'),
      description: z.string().optional().describe('Optional description'),
    },
    async ({ name, description }) => ({
      content: [{ type: 'text', text: JSON.stringify(createProject(name, description), null, 2) }],
    }),
  );
}
```

**Step 2: 커밋**

```bash
git add src/mcp/tools/project.tools.ts
git commit -m "feat: add MCP project tools"
```

---

### Task 7: MCP 도구 — Task Tools

**Files:**
- Create: `src/mcp/tools/task.tools.ts`

**Step 1: `src/mcp/tools/task.tools.ts` 작성**

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  listTasks, getTask, createTask,
  claimTask, startTask, submitReview,
  addComment, updateTaskMeta,
} from '../../services/kanban.service.js';

export function registerTaskTools(server: McpServer): void {
  server.tool(
    'task_list',
    'List tasks with optional filters. Returns tasks from all projects if no projectId given.',
    {
      projectId: z.string().optional().describe('Filter by project ID'),
      status: z.enum(['todo','claimed','in_progress','review','done']).optional(),
      tags: z.array(z.string()).optional().describe('Filter by tags (AND condition)'),
    },
    async (args) => ({
      content: [{ type: 'text', text: JSON.stringify(listTasks(args), null, 2) }],
    }),
  );

  server.tool(
    'task_get',
    'Get a task with its full history',
    { taskId: z.string() },
    async ({ taskId }) => {
      const task = getTask(taskId);
      if (!task) return { content: [{ type: 'text', text: 'Task not found' }], isError: true };
      return { content: [{ type: 'text', text: JSON.stringify(task, null, 2) }] };
    },
  );

  server.tool(
    'task_create',
    'Create a new task in todo status',
    {
      projectId: z.string().describe('Project ID'),
      title: z.string().min(1),
      description: z.string().optional(),
      tags: z.array(z.string()).optional().describe('e.g. ["db","backend"]'),
      assignee: z.string().optional(),
    },
    async (args) => ({
      content: [{ type: 'text', text: JSON.stringify(createTask(args), null, 2) }],
    }),
  );

  server.tool(
    'task_claim',
    'Claim a todo task (todo → claimed)',
    {
      taskId: z.string(),
      agentName: z.string().describe('Your agent name'),
    },
    async ({ taskId, agentName }) => {
      try {
        return { content: [{ type: 'text', text: JSON.stringify(claimTask(taskId, agentName), null, 2) }] };
      } catch (e: unknown) {
        return { content: [{ type: 'text', text: (e as Error).message }], isError: true };
      }
    },
  );

  server.tool(
    'task_start',
    'Start working on a claimed task (claimed → in_progress)',
    {
      taskId: z.string(),
      agentName: z.string(),
    },
    async ({ taskId, agentName }) => {
      try {
        return { content: [{ type: 'text', text: JSON.stringify(startTask(taskId, agentName), null, 2) }] };
      } catch (e: unknown) {
        return { content: [{ type: 'text', text: (e as Error).message }], isError: true };
      }
    },
  );

  server.tool(
    'task_submit_review',
    'Submit completed work for review (in_progress → review)',
    {
      taskId: z.string(),
      agentName: z.string(),
      summary: z.string().describe('Summary of what was done'),
    },
    async ({ taskId, agentName, summary }) => {
      try {
        return { content: [{ type: 'text', text: JSON.stringify(submitReview(taskId, agentName, summary), null, 2) }] };
      } catch (e: unknown) {
        return { content: [{ type: 'text', text: (e as Error).message }], isError: true };
      }
    },
  );

  server.tool(
    'task_comment',
    'Add a progress comment to a task (no status change)',
    {
      taskId: z.string(),
      agentName: z.string(),
      comment: z.string(),
    },
    async ({ taskId, agentName, comment }) => {
      try {
        return { content: [{ type: 'text', text: JSON.stringify(addComment(taskId, agentName, comment), null, 2) }] };
      } catch (e: unknown) {
        return { content: [{ type: 'text', text: (e as Error).message }], isError: true };
      }
    },
  );

  server.tool(
    'task_update',
    'Update task title, description, or tags',
    {
      taskId: z.string(),
      title: z.string().optional(),
      description: z.string().optional(),
      tags: z.array(z.string()).optional(),
    },
    async ({ taskId, ...updates }) => {
      try {
        return { content: [{ type: 'text', text: JSON.stringify(updateTaskMeta(taskId, updates), null, 2) }] };
      } catch (e: unknown) {
        return { content: [{ type: 'text', text: (e as Error).message }], isError: true };
      }
    },
  );
}
```

**Step 2: 커밋**

```bash
git add src/mcp/tools/task.tools.ts
git commit -m "feat: add MCP task tools (list/get/create/claim/start/review/comment/update)"
```

---

### Task 8: MCP 서버 설정

**Files:**
- Create: `src/mcp/server.ts`

**Step 1: `src/mcp/server.ts` 작성**

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';
import { registerProjectTools } from './tools/project.tools.js';
import { registerTaskTools } from './tools/task.tools.js';

export function createMcpApp(): express.Application {
  const app = express();
  app.use(express.json());

  app.post('/mcp', async (req, res) => {
    const server = new McpServer({
      name: 'kanban-mcp',
      version: '1.0.0',
    });

    registerProjectTools(server);
    registerTaskTools(server);

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless
    });

    res.on('close', () => transport.close());

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  return app;
}
```

> **Note on Streamable HTTP:** `@modelcontextprotocol/sdk` v1.27+에서 `StreamableHTTPServerTransport`를
> import하는 경로가 변경될 수 있다. 설치 후 `node_modules/@modelcontextprotocol/sdk/server/` 디렉토리를
> 확인하여 정확한 import 경로를 맞춰라.
> 빌드 오류 발생 시: `find node_modules/@modelcontextprotocol -name "*.d.ts" | xargs grep -l "StreamableHTTP"`

**Step 2: 커밋**

```bash
git add src/mcp/server.ts
git commit -m "feat: add MCP Streamable HTTP server"
```

---

### Task 9: 진입점 (두 서버 동시 시작)

**Files:**
- Create: `src/server.ts`

**Step 1: `src/server.ts` 작성**

```typescript
import 'dotenv/config';
import http from 'http';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { router } from './web/router.js';
import { initWebSocket } from './web/websocket.js';
import { createMcpApp } from './mcp/server.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const WEB_PORT = parseInt(process.env.WEB_PORT ?? '3000');
const MCP_PORT = parseInt(process.env.MCP_PORT ?? '3001');

// ── 웹 서버 (Express + WebSocket) ─────────────────────────────────────────
const webApp = express();
webApp.use(express.json());
webApp.use(express.static(path.join(__dirname, 'web/public')));
webApp.use('/api', router);

const webServer = http.createServer(webApp);
initWebSocket(webServer);

webServer.listen(WEB_PORT, () => {
  console.log(`[Web] Kanban UI: http://localhost:${WEB_PORT}`);
});

// ── MCP 서버 ───────────────────────────────────────────────────────────────
const mcpApp = createMcpApp();
mcpApp.listen(MCP_PORT, () => {
  console.log(`[MCP] Streamable HTTP: http://localhost:${MCP_PORT}/mcp`);
});
```

**Step 2: `dotenv` 패키지 추가** (process.env 로드용)

```bash
npm install dotenv
```

`.env` 파일 생성 (로컬):
```
MCP_PORT=3001
WEB_PORT=3000
DB_PATH=./data/kanban.db
```

**Step 3: 서버 시작 테스트**

```bash
npm run dev
```

Expected 출력:
```
[Web] Kanban UI: http://localhost:3000
[MCP] Streamable HTTP: http://localhost:3001/mcp
[WS] WebSocket server initialized at /ws
```

오류 없이 두 줄 모두 나오면 성공.

**Step 4: 커밋**

```bash
git add src/server.ts package.json package-lock.json
git commit -m "feat: start both web and MCP servers from single entry point"
```

---

### Task 10: 웹 UI — HTML 구조

**Files:**
- Create: `src/web/public/index.html`

**Step 1: `src/web/public/index.html` 작성**

```html
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>KanbanMCP</title>
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <!-- Header -->
  <header class="header">
    <div class="header-left">
      <span class="logo">KanbanMCP</span>
      <select id="projectSelect" class="project-select">
        <option value="">전체 프로젝트</option>
      </select>
    </div>
    <div class="header-right">
      <div class="tag-filters" id="tagFilters">
        <button class="tag-btn active" data-tag="">전체</button>
        <button class="tag-btn" data-tag="db">db</button>
        <button class="tag-btn" data-tag="backend">backend</button>
        <button class="tag-btn" data-tag="frontend">frontend</button>
      </div>
      <button class="btn-primary" id="newTaskBtn">+ 새 작업</button>
    </div>
  </header>

  <!-- WS status -->
  <div id="wsStatus" class="ws-status disconnected">● 연결 중...</div>

  <!-- Board -->
  <main class="board">
    <div class="column" data-status="todo">
      <div class="column-header">
        <span class="column-title">To Do</span>
        <span class="column-count" id="count-todo">0</span>
      </div>
      <div class="cards" id="col-todo"></div>
    </div>
    <div class="column" data-status="claimed">
      <div class="column-header">
        <span class="column-title">Claimed</span>
        <span class="column-count" id="count-claimed">0</span>
      </div>
      <div class="cards" id="col-claimed"></div>
    </div>
    <div class="column" data-status="in_progress">
      <div class="column-header">
        <span class="column-title">In Progress</span>
        <span class="column-count" id="count-in_progress">0</span>
      </div>
      <div class="cards" id="col-in_progress"></div>
    </div>
    <div class="column" data-status="review">
      <div class="column-header">
        <span class="column-title">Review</span>
        <span class="column-count" id="count-review">0</span>
      </div>
      <div class="cards" id="col-review"></div>
    </div>
    <div class="column" data-status="done">
      <div class="column-header">
        <span class="column-title">Done</span>
        <span class="column-count" id="count-done">0</span>
      </div>
      <div class="cards" id="col-done"></div>
    </div>
  </main>

  <!-- 새 작업 모달 -->
  <div class="modal-overlay" id="newTaskModal" hidden>
    <div class="modal">
      <div class="modal-header">
        <h2>새 작업 등록</h2>
        <button class="modal-close" id="newTaskClose">✕</button>
      </div>
      <div class="modal-body">
        <label>프로젝트 *
          <select id="newTaskProject"></select>
        </label>
        <label>제목 *
          <input type="text" id="newTaskTitle" placeholder="작업 제목">
        </label>
        <label>설명
          <textarea id="newTaskDesc" rows="3" placeholder="상세 설명"></textarea>
        </label>
        <label>태그 (쉼표로 구분)
          <input type="text" id="newTaskTags" placeholder="db, backend, frontend">
        </label>
      </div>
      <div class="modal-footer">
        <button class="btn-secondary" id="newTaskCancel">취소</button>
        <button class="btn-primary" id="newTaskSubmit">등록</button>
      </div>
    </div>
  </div>

  <!-- 상세 모달 -->
  <div class="modal-overlay" id="detailModal" hidden>
    <div class="modal modal-large">
      <div class="modal-header">
        <h2 id="detailTitle"></h2>
        <button class="modal-close" id="detailClose">✕</button>
      </div>
      <div class="modal-body">
        <div class="detail-meta">
          <span class="detail-status" id="detailStatus"></span>
          <span class="detail-assignee" id="detailAssignee"></span>
        </div>
        <div class="detail-tags" id="detailTags"></div>
        <p class="detail-desc" id="detailDesc"></p>
        <hr>
        <h3>히스토리</h3>
        <div class="history-list" id="detailHistory"></div>
      </div>
      <div class="modal-footer" id="reviewActions" hidden>
        <button class="btn-approve" id="approveBtn">✓ 승인 → Done</button>
        <button class="btn-reject" id="rejectBtn">✗ 반려 → In Progress</button>
      </div>
    </div>
  </div>

  <script src="/app.js"></script>
</body>
</html>
```

**Step 2: 커밋**

```bash
git add src/web/public/index.html
git commit -m "feat: add kanban board HTML structure"
```

---

### Task 11: 웹 UI — CSS 스타일

**Files:**
- Create: `src/web/public/style.css`

**Step 1: `src/web/public/style.css` 작성**

```css
:root {
  --bg: #0f1117;
  --surface: #1a1d27;
  --border: #2a2d3a;
  --text: #e2e8f0;
  --text-muted: #718096;
  --primary: #6366f1;
  --primary-hover: #4f46e5;
  --success: #22c55e;
  --danger: #ef4444;
  --tag-db: #3b82f6;
  --tag-backend: #22c55e;
  --tag-frontend: #f97316;
  --tag-default: #8b5cf6;
}

* { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  background: var(--bg);
  color: var(--text);
  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* Header */
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 20px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.header-left, .header-right { display: flex; align-items: center; gap: 12px; }
.logo { font-size: 18px; font-weight: 700; color: var(--primary); }

.project-select {
  background: var(--bg);
  color: var(--text);
  border: 1px solid var(--border);
  padding: 6px 10px;
  border-radius: 6px;
  font-size: 14px;
}

.tag-filters { display: flex; gap: 6px; }
.tag-btn {
  padding: 4px 10px;
  border-radius: 12px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-muted);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s;
}
.tag-btn.active, .tag-btn:hover { background: var(--primary); color: #fff; border-color: var(--primary); }

.btn-primary {
  background: var(--primary);
  color: #fff;
  border: none;
  padding: 8px 16px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  transition: background 0.15s;
}
.btn-primary:hover { background: var(--primary-hover); }
.btn-secondary {
  background: transparent;
  color: var(--text-muted);
  border: 1px solid var(--border);
  padding: 8px 16px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
}

/* WS Status */
.ws-status {
  font-size: 11px;
  padding: 2px 12px;
  text-align: right;
  flex-shrink: 0;
}
.ws-status.connected { color: var(--success); }
.ws-status.disconnected { color: var(--danger); }

/* Board */
.board {
  display: flex;
  gap: 12px;
  padding: 16px;
  flex: 1;
  overflow-x: auto;
  overflow-y: hidden;
}

.column {
  flex: 0 0 240px;
  background: var(--surface);
  border-radius: 10px;
  border: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  max-height: 100%;
}
.column-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 14px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.column-title { font-weight: 600; font-size: 14px; }
.column-count {
  background: var(--border);
  color: var(--text-muted);
  border-radius: 10px;
  padding: 2px 8px;
  font-size: 12px;
}

.cards {
  flex: 1;
  overflow-y: auto;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* Card */
.card {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px;
  cursor: pointer;
  transition: border-color 0.15s, transform 0.1s;
}
.card:hover { border-color: var(--primary); transform: translateY(-1px); }
.card-title { font-size: 13px; font-weight: 500; margin-bottom: 6px; line-height: 1.4; }
.card-assignee { font-size: 11px; color: var(--text-muted); margin-bottom: 6px; }
.card-tags { display: flex; flex-wrap: wrap; gap: 4px; }

/* Tags */
.tag {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 4px;
  font-weight: 500;
}
.tag-db      { background: rgba(59,130,246,0.2); color: var(--tag-db); }
.tag-backend  { background: rgba(34,197,94,0.2);  color: var(--tag-backend); }
.tag-frontend { background: rgba(249,115,22,0.2); color: var(--tag-frontend); }
.tag-other    { background: rgba(139,92,246,0.2); color: var(--tag-default); }

/* Modals */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}
.modal-overlay[hidden] { display: none; }

.modal {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  width: 480px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
}
.modal-large { width: 580px; }

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.modal-header h2 { font-size: 16px; }
.modal-close { background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 18px; }

.modal-body {
  padding: 20px;
  overflow-y: auto;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.modal-body label { display: flex; flex-direction: column; gap: 6px; font-size: 13px; color: var(--text-muted); }
.modal-body input, .modal-body textarea, .modal-body select {
  background: var(--bg);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 8px 10px;
  font-size: 14px;
  font-family: inherit;
}

.modal-footer {
  padding: 16px 20px;
  border-top: 1px solid var(--border);
  display: flex;
  gap: 10px;
  justify-content: flex-end;
  flex-shrink: 0;
}

/* Detail modal specific */
.detail-meta { display: flex; gap: 12px; align-items: center; }
.detail-status {
  background: rgba(99,102,241,0.2);
  color: var(--primary);
  padding: 3px 10px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 600;
}
.detail-assignee { font-size: 13px; color: var(--text-muted); }
.detail-tags { display: flex; gap: 6px; flex-wrap: wrap; }
.detail-desc { font-size: 14px; color: var(--text-muted); line-height: 1.6; }

.history-list { display: flex; flex-direction: column; gap: 8px; }
.history-item {
  padding: 10px 12px;
  background: var(--bg);
  border-radius: 6px;
  border-left: 3px solid var(--border);
  font-size: 13px;
}
.history-item.action-approve { border-left-color: var(--success); }
.history-item.action-reject  { border-left-color: var(--danger); }
.history-item.action-comment { border-left-color: var(--primary); }
.history-time { font-size: 11px; color: var(--text-muted); margin-bottom: 3px; }
.history-content { line-height: 1.5; }

.btn-approve {
  background: var(--success);
  color: #fff;
  border: none;
  padding: 8px 16px;
  border-radius: 6px;
  cursor: pointer;
  font-weight: 500;
  font-size: 14px;
}
.btn-reject {
  background: var(--danger);
  color: #fff;
  border: none;
  padding: 8px 16px;
  border-radius: 6px;
  cursor: pointer;
  font-weight: 500;
  font-size: 14px;
}

hr { border: none; border-top: 1px solid var(--border); }
h3 { font-size: 14px; color: var(--text-muted); }
```

**Step 2: 커밋**

```bash
git add src/web/public/style.css
git commit -m "feat: add dark-themed kanban board CSS"
```

---

### Task 12: 웹 UI — JavaScript 로직

**Files:**
- Create: `src/web/public/app.js`

**Step 1: `src/web/public/app.js` 작성**

```javascript
// ── 상태 ──────────────────────────────────────────────────────────────────
const state = {
  projects: [],
  tasks: [],
  selectedProject: '',
  selectedTag: '',
  currentTaskId: null,
};

// ── API 헬퍼 ─────────────────────────────────────────────────────────────

async function api(method, path, body) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ── 렌더링 ────────────────────────────────────────────────────────────────

const STATUSES = ['todo', 'claimed', 'in_progress', 'review', 'done'];

function tagClass(tag) {
  if (tag === 'db') return 'tag-db';
  if (tag === 'backend') return 'tag-backend';
  if (tag === 'frontend') return 'tag-frontend';
  return 'tag-other';
}

function renderTag(tag) {
  return `<span class="tag ${tagClass(tag)}">${tag}</span>`;
}

function renderCard(task) {
  const tags = task.tags.map(renderTag).join('');
  const assignee = task.assignee ? `👤 ${task.assignee}` : '';
  return `
    <div class="card" data-id="${task.id}" onclick="openDetail('${task.id}')">
      <div class="card-title">${escHtml(task.title)}</div>
      ${assignee ? `<div class="card-assignee">${escHtml(assignee)}</div>` : ''}
      <div class="card-tags">${tags}</div>
    </div>
  `;
}

function renderBoard() {
  let filtered = state.tasks;
  if (state.selectedProject) filtered = filtered.filter(t => t.project_id === state.selectedProject);
  if (state.selectedTag)    filtered = filtered.filter(t => t.tags.includes(state.selectedTag));

  for (const status of STATUSES) {
    const col = document.getElementById(`col-${status}`);
    const countEl = document.getElementById(`count-${status}`);
    const cards = filtered.filter(t => t.status === status);
    col.innerHTML = cards.map(renderCard).join('');
    countEl.textContent = cards.length;
  }
}

function renderProjectSelect() {
  const sel = document.getElementById('projectSelect');
  const newSel = document.getElementById('newTaskProject');
  const options = state.projects.map(p => `<option value="${p.id}">${escHtml(p.name)}</option>`).join('');
  sel.innerHTML = `<option value="">전체 프로젝트</option>` + options;
  newSel.innerHTML = options;
}

function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function formatTime(unixSec) {
  return new Date(unixSec * 1000).toLocaleString('ko-KR');
}

// ── 데이터 로드 ───────────────────────────────────────────────────────────

async function loadData() {
  [state.projects, state.tasks] = await Promise.all([
    api('GET', '/projects'),
    api('GET', '/tasks'),
  ]);
  renderProjectSelect();
  renderBoard();
}

// ── 상세 모달 ─────────────────────────────────────────────────────────────

async function openDetail(taskId) {
  state.currentTaskId = taskId;
  const task = await api('GET', `/tasks/${taskId}`);

  document.getElementById('detailTitle').textContent = task.title;
  document.getElementById('detailStatus').textContent = task.status;
  document.getElementById('detailAssignee').textContent = task.assignee ? `👤 ${task.assignee}` : '';
  document.getElementById('detailTags').innerHTML = task.tags.map(renderTag).join('');
  document.getElementById('detailDesc').textContent = task.description ?? '설명 없음';

  const histHtml = task.history.map(h => `
    <div class="history-item action-${h.action}">
      <div class="history-time">${formatTime(h.created_at)} · ${escHtml(h.actor)} · ${h.action}</div>
      <div class="history-content">
        ${h.from_status && h.to_status ? `${h.from_status} → ${h.to_status}` : ''}
        ${h.comment ? escHtml(h.comment) : ''}
      </div>
    </div>
  `).join('');
  document.getElementById('detailHistory').innerHTML = histHtml || '<p style="color:var(--text-muted)">히스토리 없음</p>';

  const reviewActions = document.getElementById('reviewActions');
  reviewActions.hidden = task.status !== 'review';

  document.getElementById('detailModal').hidden = false;
}

document.getElementById('detailClose').onclick = () => {
  document.getElementById('detailModal').hidden = true;
  state.currentTaskId = null;
};

document.getElementById('approveBtn').onclick = async () => {
  if (!state.currentTaskId) return;
  await api('PATCH', `/tasks/${state.currentTaskId}/approve`);
  document.getElementById('detailModal').hidden = true;
};

document.getElementById('rejectBtn').onclick = async () => {
  if (!state.currentTaskId) return;
  const reason = prompt('반려 사유 (선택)');
  await api('PATCH', `/tasks/${state.currentTaskId}/reject`, { reason });
  document.getElementById('detailModal').hidden = true;
};

// ── 새 작업 모달 ──────────────────────────────────────────────────────────

document.getElementById('newTaskBtn').onclick = () => {
  document.getElementById('newTaskModal').hidden = false;
};
document.getElementById('newTaskClose').onclick = closeNewTask;
document.getElementById('newTaskCancel').onclick = closeNewTask;

function closeNewTask() {
  document.getElementById('newTaskModal').hidden = true;
  document.getElementById('newTaskTitle').value = '';
  document.getElementById('newTaskDesc').value = '';
  document.getElementById('newTaskTags').value = '';
}

document.getElementById('newTaskSubmit').onclick = async () => {
  const projectId = document.getElementById('newTaskProject').value;
  const title = document.getElementById('newTaskTitle').value.trim();
  if (!title) { alert('제목을 입력하세요'); return; }
  const description = document.getElementById('newTaskDesc').value.trim() || undefined;
  const tagsRaw = document.getElementById('newTaskTags').value;
  const tags = tagsRaw ? tagsRaw.split(',').map(t => t.trim()).filter(Boolean) : [];

  await api('POST', '/tasks', { projectId, title, description, tags });
  closeNewTask();
};

// ── 필터 ──────────────────────────────────────────────────────────────────

document.getElementById('projectSelect').onchange = (e) => {
  state.selectedProject = e.target.value;
  renderBoard();
};

document.getElementById('tagFilters').onclick = (e) => {
  const btn = e.target.closest('.tag-btn');
  if (!btn) return;
  document.querySelectorAll('.tag-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  state.selectedTag = btn.dataset.tag;
  renderBoard();
};

// ── WebSocket ─────────────────────────────────────────────────────────────

const wsStatus = document.getElementById('wsStatus');

function connectWS() {
  const ws = new WebSocket(`ws://${location.host}/ws`);

  ws.onopen = () => {
    wsStatus.textContent = '● 연결됨';
    wsStatus.className = 'ws-status connected';
  };

  ws.onclose = () => {
    wsStatus.textContent = '● 연결 끊김 (재연결 중...)';
    wsStatus.className = 'ws-status disconnected';
    setTimeout(connectWS, 5000);
  };

  ws.onmessage = (e) => {
    const event = JSON.parse(e.data);

    if (event.type === 'task_created') {
      state.tasks.push(event.payload);
      renderBoard();
    } else if (event.type === 'task_updated') {
      const idx = state.tasks.findIndex(t => t.id === event.payload.id);
      if (idx !== -1) state.tasks[idx] = event.payload;
      else state.tasks.push(event.payload);
      renderBoard();
      // 상세 모달이 열려있으면 갱신
      if (state.currentTaskId === event.payload.id) openDetail(event.payload.id);
    }
    // history_added는 상세 모달 갱신은 task_updated에서 처리
  };
}

// ── 초기화 ────────────────────────────────────────────────────────────────

loadData();
connectWS();
```

**Step 2: 커밋**

```bash
git add src/web/public/app.js
git commit -m "feat: add kanban board JavaScript with real-time WebSocket updates"
```

---

### Task 13: Skill 파일

**Files:**
- Create: `skills/kanban.md`

**Step 1: `skills/kanban.md` 작성**

```markdown
---
name: kanban-mcp
description: >
  Use this skill when working on tasks tracked by the KanbanMCP board.
  Triggers: when assigned tasks, starting work, updating progress, or completing work for review.
---

# KanbanMCP Agent Workflow

## MCP 서버 연결 설정

프로젝트의 Claude Code 설정(`.mcp.json` 또는 `~/.claude/mcp.json`)에 추가:

```json
{
  "mcpServers": {
    "kanban": {
      "url": "http://localhost:3001/mcp",
      "type": "http"
    }
  }
}
```

## 워크플로우

### 1. 작업 선택 전

```
task_list status=todo         # 가능한 작업 확인
task_list status=claimed      # 이미 다른 에이전트가 선점한 작업 확인 (겹치지 않도록)
```

### 2. 작업 시작

```
task_claim taskId=<id> agentName=<내 이름>   # todo → claimed (선점)
task_start taskId=<id> agentName=<내 이름>   # claimed → in_progress
```

> 주의: task_claim을 먼저 해서 다른 에이전트와 겹치지 않도록 한다.

### 3. 작업 중

```
task_comment taskId=<id> agentName=<내 이름> comment="진행 상황: ..."
```

중요한 결정이나 블로커가 생기면 즉시 코멘트로 기록한다.

### 4. 작업 완료 후

```
task_comment taskId=<id> agentName=<내 이름> comment="완료: 무엇을 했는지 요약"
task_submit_review taskId=<id> agentName=<내 이름> summary="PR/완료 내용 요약"
```

→ 이후 사용자가 웹 UI(http://localhost:3000)에서 카드를 클릭해 승인/반려 처리.

### 5. 반려된 경우

```
task_list status=in_progress  # 반려되어 다시 in_progress가 된 내 태스크 확인
task_comment taskId=<id> agentName=<내 이름> comment="반려 사유 확인 후 재작업 시작"
```

## 태그 컨벤션

| 태그 | 의미 |
|------|------|
| `db` | 데이터베이스 관련 작업 |
| `backend` | 서버/API 작업 |
| `frontend` | UI/클라이언트 작업 |

## 주의사항

- **task_approve / task_reject는 MCP 도구에 없다.** 이는 사용자 전용 권한이다.
- 작업을 선점(claim)하기 전에 반드시 다른 에이전트가 이미 claimed 상태인지 확인한다.
- `task_get`으로 전체 히스토리를 확인하면 이전 에이전트의 작업 내용을 파악할 수 있다.
```

**Step 2: 커밋**

```bash
git add skills/kanban.md
git commit -m "feat: add kanban-mcp skill file for agent workflow"
```

---

### Task 14: End-to-End 검증

**Step 1: 서버 시작**

```bash
npm run dev
```

Expected:
```
[Web] Kanban UI: http://localhost:3000
[MCP] Streamable HTTP: http://localhost:3001/mcp
[WS] WebSocket server initialized at /ws
```

**Step 2: 프로젝트 생성 (MCP)**

```bash
curl -s -X POST http://localhost:3001/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"project_create","arguments":{"name":"테스트 프로젝트","description":"첫 번째 프로젝트"}}}' | jq .
```

Expected: `result.content[0].text`에 프로젝트 JSON (id 포함)

**Step 3: 태스크 생성 (MCP)**

```bash
# <project_id>를 Step 2에서 받은 id로 교체
curl -s -X POST http://localhost:3001/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"task_create","arguments":{"projectId":"<project_id>","title":"API 엔드포인트 구현","tags":["backend"],"description":"GET /users 엔드포인트 추가"}}}' | jq .
```

**Step 4: 웹 UI 확인**

브라우저에서 `http://localhost:3000` 접속 → To Do 칼럼에 카드 표시 확인

**Step 5: 실시간 업데이트 확인**

브라우저를 열어둔 채로:
```bash
curl -s -X POST http://localhost:3001/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"task_claim","arguments":{"taskId":"<task_id>","agentName":"agent-1"}}}' | jq .
```

Expected: 브라우저에서 카드가 To Do → Claimed로 즉시 이동

**Step 6: Review → 승인 흐름**

```bash
# submit_review
curl -s -X POST http://localhost:3001/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"task_submit_review","arguments":{"taskId":"<task_id>","agentName":"agent-1","summary":"구현 완료, PR #42 생성"}}}' | jq .
```

→ 브라우저에서 카드가 Review 칼럼으로 이동
→ 카드 클릭 → 상세 팝업에서 [✓ 승인] 버튼 클릭
→ 카드가 Done으로 이동 확인

**Step 7: 웹에서 직접 태스크 생성**

브라우저에서 [+ 새 작업] 클릭 → 제목/태그 입력 → 등록 → To Do에 카드 추가 확인

---

## 빠른 트러블슈팅

| 증상 | 확인 사항 |
|------|----------|
| `StreamableHTTPServerTransport` import 오류 | `find node_modules/@modelcontextprotocol -name "*.d.ts" \| xargs grep -l "Streamable"` |
| `better-sqlite3` 네이티브 모듈 오류 | `npm rebuild better-sqlite3` |
| WS 연결 안 됨 | `webServer.listen` 후 `initWebSocket(webServer)` 순서 확인 |
| 포트 충돌 | `.env`에서 `MCP_PORT`, `WEB_PORT` 변경 |
