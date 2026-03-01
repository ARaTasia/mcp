import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { initSchema } from '../db/schema.js';
import { kanbanService } from '../services/kanban.service.js';
import { db } from '../db/index.js';

async function cleanDb() {
  await db.executeMultiple(
    'DELETE FROM task_changes; DELETE FROM task_history; DELETE FROM tasks; DELETE FROM projects;',
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
  it('transitions todo → claimed → in_progress → review → done', async () => {
    const project = await kanbanService.createProject('Flow Project');
    const task = await kanbanService.createTask({ projectId: project.id, title: 'Flow Task' });

    const claimed = await kanbanService.claimTask(task.id, 'agent-1');
    expect(claimed.status).toBe('claimed');
    expect(claimed.assignee).toBe('agent-1');

    const started = await kanbanService.startTask(task.id, 'agent-1');
    expect(started.status).toBe('in_progress');

    const reviewed = await kanbanService.submitReview(task.id, 'agent-1', 'Done!');
    expect(reviewed.status).toBe('review');

    const done = await kanbanService.approveReview(task.id);
    expect(done.status).toBe('done');
  });

  it('reject moves task from review → claimed', async () => {
    const project = await kanbanService.createProject('Reject Project');
    const task = await kanbanService.createTask({ projectId: project.id, title: 'Reject Task' });

    await kanbanService.claimTask(task.id, 'agent-1');
    await kanbanService.startTask(task.id, 'agent-1');
    await kanbanService.submitReview(task.id, 'agent-1', 'Review me');

    const rejected = await kanbanService.rejectReview(task.id, 'Needs more work');
    expect(rejected.status).toBe('claimed');
  });

  it('blocks claiming a done task', async () => {
    const project = await kanbanService.createProject('Done Project');
    const task = await kanbanService.createTask({ projectId: project.id, title: 'Done Task' });

    await kanbanService.claimTask(task.id, 'agent-1');
    await kanbanService.startTask(task.id, 'agent-1');
    await kanbanService.submitReview(task.id, 'agent-1', 'Done');
    await kanbanService.approveReview(task.id);

    await expect(kanbanService.claimTask(task.id, 'agent-2')).rejects.toThrow('not in todo status');
  });

  it('blocks skipping from todo directly to in_progress', async () => {
    const project = await kanbanService.createProject('Skip Project');
    const task = await kanbanService.createTask({ projectId: project.id, title: 'Skip Task' });

    await expect(kanbanService.startTask(task.id, 'agent-1')).rejects.toThrow('not in claimed status');
  });

  it('blocks starting a done task', async () => {
    const project = await kanbanService.createProject('Done Start Project');
    const task = await kanbanService.createTask({ projectId: project.id, title: 'Done Start Task' });

    await kanbanService.claimTask(task.id, 'agent-1');
    await kanbanService.startTask(task.id, 'agent-1');
    await kanbanService.submitReview(task.id, 'agent-1', 'Done');
    await kanbanService.approveReview(task.id);

    await expect(kanbanService.startTask(task.id, 'agent-1')).rejects.toThrow('not in claimed status');
  });
});

describe('Prerequisite validation', () => {
  it('blocks claiming a task with incomplete prerequisites', async () => {
    const project = await kanbanService.createProject('Prereq Project');
    const prereq = await kanbanService.createTask({ projectId: project.id, title: 'Prerequisite' });
    const dependent = await kanbanService.createTask({
      projectId: project.id,
      title: 'Dependent',
      prerequisites: [prereq.id],
    });

    await expect(kanbanService.claimTask(dependent.id, 'agent-1')).rejects.toThrow(
      'Prerequisite tasks not done',
    );
  });

  it('allows claiming when prerequisites are done', async () => {
    const project = await kanbanService.createProject('Prereq Done Project');
    const prereq = await kanbanService.createTask({ projectId: project.id, title: 'Prereq' });
    const dependent = await kanbanService.createTask({
      projectId: project.id,
      title: 'Dependent',
      prerequisites: [prereq.id],
    });

    // Complete the prerequisite
    await kanbanService.claimTask(prereq.id, 'agent-1');
    await kanbanService.startTask(prereq.id, 'agent-1');
    await kanbanService.submitReview(prereq.id, 'agent-1', 'Done');
    await kanbanService.approveReview(prereq.id);

    const claimed = await kanbanService.claimTask(dependent.id, 'agent-1');
    expect(claimed.status).toBe('claimed');
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
