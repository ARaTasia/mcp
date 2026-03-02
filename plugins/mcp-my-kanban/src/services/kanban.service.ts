import { nanoid } from 'nanoid';
import fs from 'fs/promises';
import path from 'path';
import { db } from '../db/index.js';
import { broadcast } from '../web/websocket.js';
import type { InValue, Row, ResultSet } from '../db/index.js';

// Row is an array (indexed by column position).
// Use ResultSet.columns to build a plain named object.
function rowToObj(rs: ResultSet, row: Row): Record<string, InValue> {
  const obj: Record<string, InValue> = {};
  rs.columns.forEach((col, i) => { obj[col] = row[i] as InValue; });
  return obj;
}

export type TaskStatus = 'todo' | 'claimed' | 'in_progress' | 'review' | 'done';

export interface Task {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  tags: string[];
  assignee: string | null;
  prerequisites: string[];
  sort_order: number;
  created_at: number;
  updated_at: number;
}

export interface HistoryEntry {
  id: number;
  task_id: string;
  actor: string;
  action: string;
  from_status: string | null;
  to_status: string | null;
  comment: string | null;
  created_at: number;
}

export interface Project {
  id: string;
  name: string;
  description: string | null;
  workspace_path: string | null;
  created_at: number;
  last_activity?: number;
}

export interface ChangeLog {
  id: number;
  task_id: string;
  actor: string;
  type: 'feature' | 'fix' | 'docs' | 'refactor';
  summary: string;
  diff: string;
  created_at: number;
}

function parseTask(obj: Record<string, InValue>): Task {
  return {
    id: obj.id as string,
    project_id: obj.project_id as string,
    title: obj.title as string,
    description: obj.description as string | null,
    status: obj.status as TaskStatus,
    tags: JSON.parse((obj.tags as string) ?? '[]'),
    assignee: obj.assignee as string | null,
    prerequisites: JSON.parse((obj.prerequisites as string) ?? '[]'),
    sort_order: obj.sort_order as number,
    created_at: obj.created_at as number,
    updated_at: obj.updated_at as number,
  };
}

function parseHistory(obj: Record<string, InValue>): HistoryEntry {
  return {
    id: obj.id as number,
    task_id: obj.task_id as string,
    actor: obj.actor as string,
    action: obj.action as string,
    from_status: obj.from_status as string | null,
    to_status: obj.to_status as string | null,
    comment: obj.comment as string | null,
    created_at: obj.created_at as number,
  };
}

async function queryOne(sql: string, args: InValue[] = []): Promise<Record<string, InValue> | null> {
  const rs = await db.execute({ sql, args });
  if (rs.rows.length === 0) return null;
  return rowToObj(rs, rs.rows[0]);
}

async function queryAll(sql: string, args: InValue[] = []): Promise<Record<string, InValue>[]> {
  const rs = await db.execute({ sql, args });
  return rs.rows.map(row => rowToObj(rs, row));
}

function hasCycle(taskId: string, prereqs: string[], allPrereqs: Map<string, string[]>): boolean {
  const visited = new Set<string>();
  const stack = [...prereqs];
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === taskId) return true;
    if (!visited.has(cur)) {
      visited.add(cur);
      stack.push(...(allPrereqs.get(cur) ?? []));
    }
  }
  return false;
}

export class KanbanService {
  async listProjects(): Promise<Project[]> {
    const rows = await queryAll(`
      SELECT p.*,
        COALESCE(
          (SELECT MAX(t.updated_at) FROM tasks t WHERE t.project_id = p.id),
          p.created_at
        ) AS last_activity
      FROM projects p
      ORDER BY last_activity DESC
    `);
    return rows as unknown as Project[];
  }

  async createProject(name: string, description?: string, workspacePath?: string): Promise<Project> {
    // 1. workspace_path 제공 시 .kanban 파일 확인
    if (workspacePath) {
      const kanbanFile = path.join(workspacePath, '.kanban');
      try {
        const { project_id } = JSON.parse(await fs.readFile(kanbanFile, 'utf-8'));
        const existing = await queryOne('SELECT * FROM projects WHERE id = ?', [project_id]);
        if (existing) return existing as unknown as Project;
        // 파일 있지만 DB에 없음 → 아래로 진행
      } catch { /* 파일 없음 → 아래로 진행 */ }
    }

    // 2. 이름 중복 체크 (workspace 없을 때 안전망)
    if (!workspacePath) {
      const byName = await queryOne('SELECT * FROM projects WHERE name = ?', [name]);
      if (byName) return byName as unknown as Project;
    }

    // 3. 신규 생성
    const id = nanoid();
    await db.execute({
      sql: 'INSERT INTO projects (id, name, description, workspace_path) VALUES (?, ?, ?, ?)',
      args: [id, name, description ?? null, workspacePath ?? null],
    });

    // 4. .kanban 파일 기록
    if (workspacePath) {
      const kanbanFile = path.join(workspacePath, '.kanban');
      await fs.writeFile(kanbanFile, JSON.stringify({ project_id: id }, null, 2), 'utf-8');
    }

    const row = await queryOne('SELECT * FROM projects WHERE id = ?', [id]);
    return row as unknown as Project;
  }

  async getProjectByPath(workspacePath: string): Promise<Project | null> {
    const kanbanFile = path.join(workspacePath, '.kanban');
    try {
      const { project_id } = JSON.parse(await fs.readFile(kanbanFile, 'utf-8'));
      const row = await queryOne('SELECT * FROM projects WHERE id = ?', [project_id]);
      return row ? (row as unknown as Project) : null;
    } catch {
      return null;
    }
  }

  async deleteProject(projectId: string, force = false): Promise<{ deleted: true }> {
    const project = await queryOne('SELECT id, workspace_path FROM projects WHERE id = ?', [projectId]);
    if (!project) throw new Error(`Project not found: ${projectId}`);

    const taskCount = await queryOne(
      'SELECT COUNT(*) as cnt FROM tasks WHERE project_id = ?', [projectId],
    );
    const count = (taskCount?.cnt as number) ?? 0;

    if (count > 0 && !force) {
      throw new Error(
        `Project has ${count} task(s). Use force=true to delete the project and all its tasks.`,
      );
    }

    if (force && count > 0) {
      await db.execute({
        sql: 'DELETE FROM task_changes WHERE task_id IN (SELECT id FROM tasks WHERE project_id = ?)',
        args: [projectId],
      });
      await db.execute({
        sql: 'DELETE FROM task_history WHERE task_id IN (SELECT id FROM tasks WHERE project_id = ?)',
        args: [projectId],
      });
      await db.execute({ sql: 'DELETE FROM tasks WHERE project_id = ?', args: [projectId] });
    }

    await db.execute({ sql: 'DELETE FROM projects WHERE id = ?', args: [projectId] });

    // Clean up .kanban file if workspace_path exists
    if (project.workspace_path) {
      const kanbanFile = path.join(project.workspace_path as string, '.kanban');
      await fs.unlink(kanbanFile).catch(() => {});
    }

    broadcast('project_deleted', { projectId });
    return { deleted: true };
  }

  async listTasks(opts: { projectId?: string; status?: string; tags?: string[] } = {}): Promise<Task[]> {
    let sql = 'SELECT * FROM tasks WHERE 1=1';
    const args: InValue[] = [];

    if (opts.projectId) { sql += ' AND project_id = ?'; args.push(opts.projectId); }
    if (opts.status) { sql += ' AND status = ?'; args.push(opts.status); }
    sql += ' ORDER BY sort_order ASC, created_at ASC';

    const rows = await queryAll(sql, args);
    let tasks = rows.map(parseTask);

    if (opts.tags && opts.tags.length > 0) {
      tasks = tasks.filter(t => opts.tags!.some(tag => t.tags.includes(tag)));
    }
    return tasks;
  }

  async getTask(taskId: string): Promise<{ task: Task; history: HistoryEntry[]; changes: ChangeLog[] }> {
    const row = await queryOne('SELECT * FROM tasks WHERE id = ?', [taskId]);
    if (!row) throw new Error(`Task not found: ${taskId}`);

    const histRows = await queryAll(
      'SELECT * FROM task_history WHERE task_id = ? ORDER BY created_at ASC',
      [taskId],
    );

    const changeRows = await queryAll(
      'SELECT * FROM task_changes WHERE task_id = ? ORDER BY created_at ASC',
      [taskId],
    );

    return {
      task: parseTask(row),
      history: histRows.map(parseHistory),
      changes: changeRows as unknown as ChangeLog[],
    };
  }

  async logChange(
    taskId: string,
    actor: string,
    type: 'feature' | 'fix' | 'docs' | 'refactor',
    summary: string,
    diff: string,
  ): Promise<ChangeLog> {
    const row = await queryOne('SELECT id FROM tasks WHERE id = ?', [taskId]);
    if (!row) throw new Error(`Task not found: ${taskId}`);

    const rs = await db.execute({
      sql: 'INSERT INTO task_changes (task_id, actor, type, summary, diff) VALUES (?, ?, ?, ?, ?)',
      args: [taskId, actor, type, summary, diff],
    });

    const change = await queryOne('SELECT * FROM task_changes WHERE id = ?', [rs.lastInsertRowid!]);
    const result = change as unknown as ChangeLog;
    broadcast('change_logged', { taskId, ...result });
    return result;
  }

  async createTask(data: {
    projectId: string;
    title: string;
    description?: string;
    tags?: string[];
    assignee?: string;
    prerequisites?: string[];
  }): Promise<Task> {
    const id = nanoid();
    const tags = JSON.stringify(data.tags ?? []);
    const prereqs = data.prerequisites ?? [];

    if (prereqs.length > 0) {
      const allRows = await queryAll('SELECT id, prerequisites FROM tasks WHERE project_id = ?', [data.projectId]);
      const allPrereqs = new Map<string, string[]>(
        allRows.map(r => [r.id as string, JSON.parse((r.prerequisites as string) ?? '[]')])
      );
      allPrereqs.set(id, prereqs);
      if (hasCycle(id, prereqs, allPrereqs)) {
        throw new Error('Circular prerequisite detected');
      }
    }

    const prerequisites = JSON.stringify(prereqs);

    const orderRow = await queryOne(
      'SELECT MAX(sort_order) as m FROM tasks WHERE project_id = ?',
      [data.projectId],
    );
    const maxOrder = (orderRow?.m as number | null) ?? -1;
    const sort_order = maxOrder + 1;

    await db.execute({
      sql: `INSERT INTO tasks (id, project_id, title, description, tags, assignee, prerequisites, sort_order)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [id, data.projectId, data.title, data.description ?? null, tags, data.assignee ?? null, prerequisites, sort_order],
    });

    await db.execute({
      sql: `INSERT INTO task_history (task_id, actor, action, to_status) VALUES (?, ?, 'create', 'todo')`,
      args: [id, data.assignee ?? 'system'],
    });

    const row = await queryOne('SELECT * FROM tasks WHERE id = ?', [id]);
    const task = parseTask(row!);
    broadcast('task_created', task);
    return task;
  }

  private async insertHistory(
    taskId: string,
    actor: string,
    action: string,
    fromStatus: string | null,
    toStatus: string | null,
    comment?: string,
  ): Promise<HistoryEntry> {
    const rs = await db.execute({
      sql: `INSERT INTO task_history (task_id, actor, action, from_status, to_status, comment)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [taskId, actor, action, fromStatus ?? null, toStatus ?? null, comment ?? null],
    });

    const row = await queryOne('SELECT * FROM task_history WHERE id = ?', [rs.lastInsertRowid!]);
    const entry = parseHistory(row!);
    broadcast('history_added', { taskId, ...entry });
    return entry;
  }

  private async moveTask(
    taskId: string,
    toStatus: TaskStatus,
    actor: string,
    action: string,
    comment?: string,
    assignee?: string | null,
  ): Promise<Task> {
    const row = await queryOne('SELECT * FROM tasks WHERE id = ?', [taskId]);
    if (!row) throw new Error(`Task not found: ${taskId}`);
    const fromStatus = row.status as string;

    if (assignee !== undefined) {
      await db.execute({
        sql: 'UPDATE tasks SET status = ?, assignee = ?, updated_at = unixepoch() WHERE id = ?',
        args: [toStatus, assignee, taskId],
      });
    } else {
      await db.execute({
        sql: 'UPDATE tasks SET status = ?, updated_at = unixepoch() WHERE id = ?',
        args: [toStatus, taskId],
      });
    }

    await this.insertHistory(taskId, actor, action, fromStatus, toStatus, comment);

    const updated = await queryOne('SELECT * FROM tasks WHERE id = ?', [taskId]);
    const task = parseTask(updated!);
    broadcast('task_updated', task);
    return task;
  }

  async claimTask(taskId: string, agentName: string): Promise<Task> {
    const row = await queryOne('SELECT * FROM tasks WHERE id = ?', [taskId]);
    if (!row) throw new Error(`Task not found: ${taskId}`);
    if (row.status !== 'todo') throw new Error(`Task is not in todo status: ${row.status}`);

    const prerequisites: string[] = JSON.parse((row.prerequisites as string) ?? '[]');
    if (prerequisites.length > 0) {
      const notDone: string[] = [];
      for (const prereqId of prerequisites) {
        const p = await queryOne('SELECT status FROM tasks WHERE id = ?', [prereqId]);
        if (!p || p.status !== 'done') notDone.push(prereqId);
      }
      if (notDone.length > 0) {
        throw new Error(`Prerequisite tasks not done: [${notDone.join(', ')}]`);
      }
    }

    return this.moveTask(taskId, 'claimed', agentName, 'claim', undefined, agentName);
  }

  async startTask(taskId: string, agentName: string): Promise<Task> {
    const row = await queryOne('SELECT status FROM tasks WHERE id = ?', [taskId]);
    if (!row) throw new Error(`Task not found: ${taskId}`);
    if (row.status !== 'claimed') throw new Error(`Task is not in claimed status: ${row.status}`);
    return this.moveTask(taskId, 'in_progress', agentName, 'start');
  }

  async submitReview(taskId: string, agentName: string, summary: string): Promise<Task> {
    const row = await queryOne('SELECT status FROM tasks WHERE id = ?', [taskId]);
    if (!row) throw new Error(`Task not found: ${taskId}`);
    if (row.status !== 'in_progress') throw new Error(`Task is not in_progress: ${row.status}`);
    return this.moveTask(taskId, 'review', agentName, 'submit_review', summary);
  }

  async addComment(taskId: string, actor: string, comment: string): Promise<HistoryEntry> {
    const row = await queryOne('SELECT id FROM tasks WHERE id = ?', [taskId]);
    if (!row) throw new Error(`Task not found: ${taskId}`);
    return this.insertHistory(taskId, actor, 'comment', null, null, comment);
  }

  async updateTaskMeta(
    taskId: string,
    data: { title?: string; description?: string; tags?: string[]; prerequisites?: string[] },
  ): Promise<Task> {
    const row = await queryOne('SELECT id FROM tasks WHERE id = ?', [taskId]);
    if (!row) throw new Error(`Task not found: ${taskId}`);

    const sets: string[] = ['updated_at = unixepoch()'];
    const args: InValue[] = [];

    if (data.title !== undefined) { sets.push('title = ?'); args.push(data.title); }
    if (data.description !== undefined) { sets.push('description = ?'); args.push(data.description); }
    if (data.tags !== undefined) { sets.push('tags = ?'); args.push(JSON.stringify(data.tags)); }
    if (data.prerequisites !== undefined) {
      const allRows = await queryAll('SELECT id, prerequisites FROM tasks WHERE project_id = (SELECT project_id FROM tasks WHERE id = ?)', [taskId]);
      const allPrereqs = new Map<string, string[]>(
        allRows.map(r => [r.id as string, JSON.parse((r.prerequisites as string) ?? '[]')])
      );
      allPrereqs.set(taskId, data.prerequisites);
      if (hasCycle(taskId, data.prerequisites, allPrereqs)) {
        throw new Error('Circular prerequisite detected');
      }
      sets.push('prerequisites = ?');
      args.push(JSON.stringify(data.prerequisites));
    }

    args.push(taskId);
    await db.execute({ sql: `UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`, args });

    await this.insertHistory(taskId, 'system', 'update', null, null, 'Metadata updated');

    const updated = await queryOne('SELECT * FROM tasks WHERE id = ?', [taskId]);
    const task = parseTask(updated!);
    broadcast('task_updated', task);
    return task;
  }

  async approveReview(taskId: string): Promise<Task> {
    const row = await queryOne('SELECT status FROM tasks WHERE id = ?', [taskId]);
    if (!row) throw new Error(`Task not found: ${taskId}`);
    if (row.status !== 'review') throw new Error(`Task is not in review: ${row.status}`);
    return this.moveTask(taskId, 'done', 'user', 'approve');
  }

  async rejectReview(taskId: string, reason?: string): Promise<Task> {
    const row = await queryOne('SELECT status FROM tasks WHERE id = ?', [taskId]);
    if (!row) throw new Error(`Task not found: ${taskId}`);
    if (row.status !== 'review') throw new Error(`Task is not in review: ${row.status}`);
    // v2: reject goes to 'claimed', assignee is kept
    return this.moveTask(taskId, 'claimed', 'user', 'reject', reason);
  }
}

export const kanbanService = new KanbanService();
