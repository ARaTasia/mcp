# mcp-my-kanban

Kanban board MCP server for agent team coordination.

## Installation

```bash
npx -y mcp-my-kanban
```

Or add to your MCP config:

```json
{
  "mcpServers": {
    "kanban": {
      "command": "npx",
      "args": ["-y", "mcp-my-kanban"]
    }
  }
}
```

## Usage

Before using any task tools, register a project first:

```
# New workspace
project_create name="my-project" workspace_path="/absolute/path/to/workspace"

# Existing workspace (reads .kanban file)
project_get_by_path workspace_path="/absolute/path/to/workspace"
```

Then use the returned `project.id` for all task operations.

## Tools

### Project
- `project_create` — Create a new project
- `project_get_by_path` — Restore project from `.kanban` file
- `project_list` — List all projects
- `project_delete` — Delete a project

### Task
- `task_list` — List tasks (filter by status, projectId, tags)
- `task_get` — Get task with full history
- `task_create` — Create a new task
- `task_claim` — Claim a task (todo → claimed)
- `task_start` — Start work (claimed → in_progress)
- `task_submit_review` — Submit for review (in_progress → review)
- `task_comment` — Add a comment
- `task_log_change` — Record a code change with diff
- `task_update` — Update task metadata

## Status Flow

```
todo → claimed → in_progress → review → done
                                  ↓
                               claimed  (if rejected)
```

## Web UI

A local web UI starts automatically on `http://localhost:3000` when the server runs.
