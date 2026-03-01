import { describe, it, expect, beforeAll } from 'vitest';
import { initSchema } from '../db/schema.js';
import { db } from '../db/index.js';

describe('DB schema', () => {
  beforeAll(async () => {
    await initSchema();
  });

  it('initSchema is idempotent (can be called multiple times)', async () => {
    await expect(initSchema()).resolves.not.toThrow();
    await expect(initSchema()).resolves.not.toThrow();
  });

  it('tables exist after initSchema', async () => {
    const rs = await db.execute({
      sql: "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
      args: [],
    });
    const tables = rs.rows.map((r) => r[0] as string);
    expect(tables).toContain('projects');
    expect(tables).toContain('tasks');
    expect(tables).toContain('task_history');
    expect(tables).toContain('task_changes');
  });

  it('tasks table stores JSON fields (tags, prerequisites)', async () => {
    // Insert a project
    const { nanoid } = await import('nanoid');
    const projId = nanoid();
    await db.execute({
      sql: 'INSERT INTO projects (id, name) VALUES (?, ?)',
      args: [projId, 'json-test-project'],
    });

    const taskId = nanoid();
    const tags = JSON.stringify(['alpha', 'beta']);
    const prerequisites = JSON.stringify(['prereq1', 'prereq2']);

    await db.execute({
      sql: 'INSERT INTO tasks (id, project_id, title, tags, prerequisites, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
      args: [taskId, projId, 'JSON Test Task', tags, prerequisites, 0],
    });

    const rs = await db.execute({ sql: 'SELECT tags, prerequisites FROM tasks WHERE id = ?', args: [taskId] });
    expect(rs.rows.length).toBe(1);
    expect(JSON.parse(rs.rows[0][0] as string)).toEqual(['alpha', 'beta']);
    expect(JSON.parse(rs.rows[0][1] as string)).toEqual(['prereq1', 'prereq2']);

    // Cleanup
    await db.execute({ sql: 'DELETE FROM tasks WHERE id = ?', args: [taskId] });
    await db.execute({ sql: 'DELETE FROM projects WHERE id = ?', args: [projId] });
  });
});
