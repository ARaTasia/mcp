# mcp-my-kanban

[한국어](README.ko.md)

Kanban board MCP server for agent team coordination. Manage tasks with status tracking, prerequisite dependencies, code change logging, and a built-in web UI.

## Installation

Install via Claude Code marketplace:

```
/install-plugin ARaTasia/mcp
```

## Getting Started

Before using any task tools, register a project:

```
# New workspace — creates a .kanban file to remember the project
project_create name="my-project" workspace_path="/path/to/workspace"

# Returning to an existing workspace
project_get_by_path workspace_path="/path/to/workspace"
```

Use the returned `projectId` for all task operations.

## Tools

### Project

#### `project_create`

Create a new project. Writes a `.kanban` file to the workspace to prevent duplicates on re-run.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| name | string | Yes | Project name |
| description | string | No | Project description |
| workspace_path | string | No | Absolute path to workspace directory |

#### `project_get_by_path`

Read the `.kanban` file in the given directory and return the linked project. Returns null if no `.kanban` file exists.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| workspace_path | string | Yes | Absolute path to the workspace directory |

#### `project_list`

List all projects. No parameters.

#### `project_delete`

Delete a project. Fails if the project has tasks unless `force` is true.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| project_id | string | Yes | Project ID to delete |
| force | boolean | No | If true, also deletes all tasks and their history |

### Task

#### `task_create`

Create a new task in `todo` status.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| projectId | string | Yes | Project ID |
| title | string | Yes | Task title |
| description | string | No | Task description |
| tags | string[] | No | Tags, e.g. `["backend", "db"]` |
| assignee | string | No | Agent name |
| prerequisites | string[] | No | Task IDs that must be done before this can be claimed |

#### `task_list`

List tasks with optional filters.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| projectId | string | No | Filter by project ID |
| status | string | No | Filter by status: `todo` \| `claimed` \| `in_progress` \| `review` \| `done` |
| tags | string[] | No | Filter by tags (any match) |

#### `task_get`

Get a task with its full history.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| taskId | string | Yes | Task ID |

#### `task_claim`

Claim a todo task (`todo` → `claimed`). Validates that all prerequisites are done.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| taskId | string | Yes | Task ID |
| agentName | string | Yes | Your agent name |

#### `task_start`

Start work on a claimed task (`claimed` → `in_progress`).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| taskId | string | Yes | Task ID |
| agentName | string | Yes | Your agent name |

#### `task_submit_review`

Submit task for review (`in_progress` → `review`).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| taskId | string | Yes | Task ID |
| agentName | string | Yes | Your agent name |
| summary | string | Yes | Summary of what was done |

#### `task_comment`

Add a comment to a task. No status change.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| taskId | string | Yes | Task ID |
| agentName | string | Yes | Your agent name |
| comment | string | Yes | Comment text |

#### `task_log_change`

Record code/document changes for a task with a diff view.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| taskId | string | Yes | Task ID |
| agentName | string | Yes | Your agent name |
| type | string | Yes | `feature` \| `fix` \| `docs` \| `refactor` |
| summary | string | Yes | One-line summary of the change |
| diff | string | Yes | Diff text. `#` for filenames, `+` for added, `-` for removed lines |

#### `task_update`

Update task metadata (title, description, tags, prerequisites).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| taskId | string | Yes | Task ID |
| title | string | No | New title |
| description | string | No | New description |
| tags | string[] | No | New tags |
| prerequisites | string[] | No | Task IDs that must be done first |

## Task Status Flow

```
todo → claimed → in_progress → review → done
                                  ↓
                               claimed  (rejected)
```

## Web UI

A web dashboard starts automatically when the server runs. Default port is `34567`, configurable via the `WEB_PORT` environment variable.
