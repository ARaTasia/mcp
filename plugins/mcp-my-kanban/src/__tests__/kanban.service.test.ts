import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { initSchema } from '../db/schema.js';
import { kanbanService } from '../services/kanban.service.js';
import { db } from '../db/index.js';

async function cleanDb() {
  await db.executeMultiple(
    'DELETE FROM archived_task_changes; DELETE FROM archived_task_history; DELETE FROM archived_tasks; DELETE FROM task_changes; DELETE FROM task_history; DELETE FROM tasks; DELETE FROM projects;',
  );
}

beforeAll(async () => {
  await initSchema();
});

beforeEach(async () => {
  await cleanDb();
});

describe('Project management', () => {
  it('creates a project successfully', async () => {
    const project = await kanbanService.createProject('My Project');
    expect(project.id).toBeTruthy();
    expect(project.name).toBe('My Project');
    expect(project.created_at).toBeTruthy();
  });

  it('prevents duplicate project names (without workspace_path)', async () => {
    const p1 = await kanbanService.createProject('Dup Project');
    const p2 = await kanbanService.createProject('Dup Project');
    expect(p1.id).toBe(p2.id); // returns existing
  });

  it('lists all projects', async () => {
    await kanbanService.createProject('Project A');
    await kanbanService.createProject('Project B');
    const projects = await kanbanService.listProjects();
    expect(projects.length).toBeGreaterThanOrEqual(2);
  });
});

describe('Task creation', () => {
  it('creates a task with initial todo status', async () => {
    const project = await kanbanService.createProject('Test Project');
    const task = await kanbanService.createTask({
      projectId: project.id,
      title: 'My Task',
    });
    expect(task.status).toBe('todo');
    expect(task.title).toBe('My Task');
    expect(task.project_id).toBe(project.id);
  });

  it('assigns a unique ID to each task', async () => {
    const project = await kanbanService.createProject('Test Project');
    const t1 = await kanbanService.createTask({ projectId: project.id, title: 'Task 1' });
    const t2 = await kanbanService.createTask({ projectId: project.id, title: 'Task 2' });
    expect(t1.id).not.toBe(t2.id);
  });

  it('records creation in task history', async () => {
    const project = await kanbanService.createProject('Test Project');
    const task = await kanbanService.createTask({ projectId: project.id, title: 'Tracked Task' });
    const { history } = await kanbanService.getTask(task.id);
    expect(history.length).toBeGreaterThanOrEqual(1);
    expect(history[0].action).toBe('create');
    expect(history[0].to_status).toBe('todo');
  });

  it('stores tags and prerequisites as arrays', async () => {
    const project = await kanbanService.createProject('Test Project');
    const task = await kanbanService.createTask({
      projectId: project.id,
      title: 'Tagged Task',
      tags: ['backend', 'urgent'],
      prerequisites: [],
    });
    expect(task.tags).toEqual(['backend', 'urgent']);
    expect(task.prerequisites).toEqual([]);
  });
});

describe('Status transitions', () => {
  it('transitions todo → approved → in_progress → review → done (via complete)', async () => {
    const project = await kanbanService.createProject('Flow Project');
    const task = await kanbanService.createTask({ projectId: project.id, title: 'Flow Task' });

    const approved = await kanbanService.approveTask(task.id);
    expect(approved.status).toBe('approved');

    const started = await kanbanService.startTask(task.id, 'agent-1');
    expect(started.status).toBe('in_progress');
    expect(started.assignee).toBe('agent-1');

    const reviewed = await kanbanService.submitReview(task.id, 'agent-1', 'Done!');
    expect(reviewed.status).toBe('review');

    const done = await kanbanService.completeTask(task.id, 'agent-1');
    expect(done.status).toBe('done');
    expect(done.done_at).toBeTruthy();
  });

  it('rework moves task from review → claimed', async () => {
    const project = await kanbanService.createProject('Rework Project');
    const task = await kanbanService.createTask({ projectId: project.id, title: 'Rework Task' });

    await kanbanService.approveTask(task.id);
    await kanbanService.startTask(task.id, 'agent-1');
    await kanbanService.submitReview(task.id, 'agent-1', 'Review me');

    const reworked = await kanbanService.reworkTask(task.id, 'agent-1', 'Needs more work');
    expect(reworked.status).toBe('claimed');
  });

  it('allows starting from claimed (rework) status', async () => {
    const project = await kanbanService.createProject('Rework Start Project');
    const task = await kanbanService.createTask({ projectId: project.id, title: 'Rework Start Task' });

    await kanbanService.approveTask(task.id);
    await kanbanService.startTask(task.id, 'agent-1');
    await kanbanService.submitReview(task.id, 'agent-1', 'Review me');
    await kanbanService.reworkTask(task.id, 'agent-1', 'Fix this');

    const restarted = await kanbanService.startTask(task.id, 'agent-1');
    expect(restarted.status).toBe('in_progress');
  });

  it('blocks approving a non-todo task', async () => {
    const project = await kanbanService.createProject('Approve Block Project');
    const task = await kanbanService.createTask({ projectId: project.id, title: 'Approve Block Task' });
    await kanbanService.approveTask(task.id);

    await expect(kanbanService.approveTask(task.id)).rejects.toThrow('not in todo status');
  });

  it('blocks starting a todo (unapproved) task', async () => {
    const project = await kanbanService.createProject('Start Block Project');
    const task = await kanbanService.createTask({ projectId: project.id, title: 'Start Block Task' });

    await expect(kanbanService.startTask(task.id, 'agent-1')).rejects.toThrow('not in approved or claimed status');
  });

  it('blocks completing a non-review task', async () => {
    const project = await kanbanService.createProject('Complete Block Project');
    const task = await kanbanService.createTask({ projectId: project.id, title: 'Complete Block Task' });
    await kanbanService.approveTask(task.id);
    await kanbanService.startTask(task.id, 'agent-1');

    await expect(kanbanService.completeTask(task.id, 'agent-1')).rejects.toThrow('not in review');
  });

  it('blocks starting a done task', async () => {
    const project = await kanbanService.createProject('Done Start Project');
    const task = await kanbanService.createTask({ projectId: project.id, title: 'Done Start Task' });

    await kanbanService.approveTask(task.id);
    await kanbanService.startTask(task.id, 'agent-1');
    await kanbanService.submitReview(task.id, 'agent-1', 'Done');
    await kanbanService.completeTask(task.id, 'agent-1');

    await expect(kanbanService.startTask(task.id, 'agent-1')).rejects.toThrow('not in approved or claimed status');
  });

  it('legacy claim flow still works (todo → claimed → in_progress)', async () => {
    const project = await kanbanService.createProject('Legacy Project');
    const task = await kanbanService.createTask({ projectId: project.id, title: 'Legacy Task' });

    const claimed = await kanbanService.claimTask(task.id, 'agent-1');
    expect(claimed.status).toBe('claimed');

    const started = await kanbanService.startTask(task.id, 'agent-1');
    expect(started.status).toBe('in_progress');
  });
});

describe('Prerequisite validation', () => {
  it('blocks starting an approved task with incomplete prerequisites', async () => {
    const project = await kanbanService.createProject('Prereq Project');
    const prereq = await kanbanService.createTask({ projectId: project.id, title: 'Prerequisite' });
    const dependent = await kanbanService.createTask({
      projectId: project.id,
      title: 'Dependent',
      prerequisites: [prereq.id],
    });

    await kanbanService.approveTask(dependent.id);

    await expect(kanbanService.startTask(dependent.id, 'agent-1')).rejects.toThrow(
      'Prerequisite tasks not done',
    );
  });

  it('allows starting when prerequisites are done', async () => {
    const project = await kanbanService.createProject('Prereq Done Project');
    const prereq = await kanbanService.createTask({ projectId: project.id, title: 'Prereq' });
    const dependent = await kanbanService.createTask({
      projectId: project.id,
      title: 'Dependent',
      prerequisites: [prereq.id],
    });

    // Complete the prerequisite
    await kanbanService.approveTask(prereq.id);
    await kanbanService.startTask(prereq.id, 'agent-1');
    await kanbanService.submitReview(prereq.id, 'agent-1', 'Done');
    await kanbanService.completeTask(prereq.id, 'agent-1');

    await kanbanService.approveTask(dependent.id);
    const started = await kanbanService.startTask(dependent.id, 'agent-1');
    expect(started.status).toBe('in_progress');
  });
});

describe('Circular prerequisite detection', () => {
  it('throws on direct self-reference', async () => {
    const project = await kanbanService.createProject('Cycle Project');
    const task = await kanbanService.createTask({ projectId: project.id, title: 'Task A' });

    await expect(
      kanbanService.updateTaskMeta(task.id, { prerequisites: [task.id] }),
    ).rejects.toThrow('Circular prerequisite detected');
  });

  it('throws on indirect cycle (A → B → A)', async () => {
    const project = await kanbanService.createProject('Cycle2 Project');
    const taskA = await kanbanService.createTask({ projectId: project.id, title: 'Task A' });
    const taskB = await kanbanService.createTask({
      projectId: project.id,
      title: 'Task B',
      prerequisites: [taskA.id],
    });

    // Now try to make A depend on B (creates cycle A→B→A)
    await expect(
      kanbanService.updateTaskMeta(taskA.id, { prerequisites: [taskB.id] }),
    ).rejects.toThrow('Circular prerequisite detected');
  });

  it('throws on cycle during createTask', async () => {
    const project = await kanbanService.createProject('Cycle3 Project');
    const taskA = await kanbanService.createTask({ projectId: project.id, title: 'Task A' });
    const taskB = await kanbanService.createTask({
      projectId: project.id,
      title: 'Task B',
      prerequisites: [taskA.id],
    });
    const taskC = await kanbanService.createTask({
      projectId: project.id,
      title: 'Task C',
      prerequisites: [taskB.id],
    });

    // Make A depend on C → creates cycle A→B→C→A
    await expect(
      kanbanService.updateTaskMeta(taskA.id, { prerequisites: [taskC.id] }),
    ).rejects.toThrow('Circular prerequisite detected');
  });

  it('allows valid non-cyclic prerequisites', async () => {
    const project = await kanbanService.createProject('NoCycle Project');
    const taskA = await kanbanService.createTask({ projectId: project.id, title: 'Task A' });
    const taskB = await kanbanService.createTask({
      projectId: project.id,
      title: 'Task B',
      prerequisites: [taskA.id],
    });

    await expect(
      kanbanService.createTask({
        projectId: project.id,
        title: 'Task C',
        prerequisites: [taskA.id, taskB.id],
      }),
    ).resolves.not.toThrow();
  });
});

describe('Archive', () => {
  it('archives done tasks older than 1 month', async () => {
    const project = await kanbanService.createProject('Archive Project');
    const task = await kanbanService.createTask({ projectId: project.id, title: 'Old Task' });

    await kanbanService.approveTask(task.id);
    await kanbanService.startTask(task.id, 'agent-1');
    await kanbanService.submitReview(task.id, 'agent-1', 'Done');
    await kanbanService.completeTask(task.id, 'agent-1');

    // Manually set done_at to 2 months ago
    const twoMonthsAgo = Math.floor(Date.now() / 1000) - 60 * 24 * 60 * 60;
    await db.execute({
      sql: 'UPDATE tasks SET done_at = ? WHERE id = ?',
      args: [twoMonthsAgo, task.id],
    });

    const result = await kanbanService.archiveOldTasks(project.id);
    expect(result.archived).toBe(1);

    // Task should be removed from active tasks
    const tasks = await kanbanService.listTasks({ projectId: project.id });
    expect(tasks.find(t => t.id === task.id)).toBeUndefined();

    // Task should be in archive
    const archived = await kanbanService.listArchivedTasks(project.id);
    expect(archived.length).toBe(1);
    expect(archived[0].id).toBe(task.id);

    // Archived task detail should have history
    const detail = await kanbanService.getArchivedTask(task.id);
    expect(detail.history.length).toBeGreaterThan(0);
  });

  it('does not archive recent done tasks', async () => {
    const project = await kanbanService.createProject('Recent Archive Project');
    const task = await kanbanService.createTask({ projectId: project.id, title: 'Recent Task' });

    await kanbanService.approveTask(task.id);
    await kanbanService.startTask(task.id, 'agent-1');
    await kanbanService.submitReview(task.id, 'agent-1', 'Done');
    await kanbanService.completeTask(task.id, 'agent-1');

    const result = await kanbanService.archiveOldTasks(project.id);
    expect(result.archived).toBe(0);
  });
});
