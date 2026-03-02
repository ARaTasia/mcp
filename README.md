# mcp-my-kanban

[한국어](plugins/mcp-my-kanban/README.ko.md)

Kanban board MCP server + Claude Code plugin for agent team coordination.

Agents create, move, and comment on tasks. Users review and approve via a real-time web UI.

## Installation

```
/install-plugin ARaTasia/mcp
```

## Tools

### Project

| Tool | Description |
|------|-------------|
| `project_create` | Create a new project. Writes `.kanban` file to prevent duplicates. |
| `project_get_by_path` | Restore project from `.kanban` file in workspace directory. |
| `project_list` | List all projects. |
| `project_delete` | Delete a project (use `force` to include tasks). |

### Task

| Tool | Description |
|------|-------------|
| `task_create` | Create a new task in `todo` status with optional tags, assignee, prerequisites. |
| `task_list` | List tasks. Filter by `projectId`, `status`, `tags`. |
| `task_get` | Get a task with its full history. |
| `task_claim` | Claim a task (`todo` → `claimed`). Validates prerequisites. |
| `task_start` | Start work (`claimed` → `in_progress`). |
| `task_submit_review` | Submit for review (`in_progress` → `review`). |
| `task_comment` | Add a comment (no status change). |
| `task_log_change` | Record code changes with diff (`feature` / `fix` / `docs` / `refactor`). |
| `task_update` | Update task metadata (title, description, tags, prerequisites). |

## Task Status Flow

```
todo → claimed → in_progress → review → done
                                  ↓
                               claimed  (rejected)
```

## Web UI

A real-time dashboard starts automatically with the server. Default port `34567` (configurable via `WEB_PORT`).

---

See [full documentation](plugins/mcp-my-kanban/README.md) for detailed parameter references.
