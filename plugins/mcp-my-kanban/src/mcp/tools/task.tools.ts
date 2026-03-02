import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { kanbanService } from '../../services/kanban.service.js';

async function requireProject() {
  const projects = await kanbanService.listProjects();
  if (projects.length === 0) {
    throw new Error(
      'No project registered. Use project_create or project_get_by_path to register a project first.',
    );
  }
}

function ok(data: unknown): { content: [{ type: 'text'; text: string }] } {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

function err(message: string): { isError: true; content: [{ type: 'text'; text: string }] } {
  return { isError: true, content: [{ type: 'text', text: message }] };
}

export function registerTaskTools(server: McpServer): void {
  server.tool(
    'task_list',
    'List tasks with optional filters',
    {
      projectId: z.string().optional().describe('Filter by project ID'),
      status: z.string().optional().describe('Filter by status: todo|claimed|in_progress|review|done'),
      tags: z.array(z.string()).optional().describe('Filter by tags (any match)'),
    },
    async ({ projectId, status, tags }) => {
      try {
        await requireProject();
        return ok(await kanbanService.listTasks({ projectId, status, tags }));
      } catch (e) {
        return err((e as Error).message);
      }
    },
  );

  server.tool(
    'task_get',
    'Get a task with its full history',
    { taskId: z.string().describe('Task ID') },
    async ({ taskId }) => {
      try {
        await requireProject();
        return ok(await kanbanService.getTask(taskId));
      } catch (e) {
        return err((e as Error).message);
      }
    },
  );

  server.tool(
    'task_create',
    'Create a new task in todo status',
    {
      projectId: z.string().describe('Project ID'),
      title: z.string().describe('Task title'),
      description: z.string().optional().describe('Task description'),
      tags: z.array(z.string()).optional().describe('Tags e.g. ["backend", "db"]'),
      assignee: z.string().optional().describe('Agent name'),
      prerequisites: z
        .array(z.string())
        .optional()
        .describe('Task IDs that must be done before this can be claimed'),
    },
    async ({ projectId, title, description, tags, assignee, prerequisites }) => {
      try {
        await requireProject();
        return ok(
          await kanbanService.createTask({ projectId, title, description, tags, assignee, prerequisites }),
        );
      } catch (e) {
        return err((e as Error).message);
      }
    },
  );

  server.tool(
    'task_claim',
    'Claim a todo task (todo → claimed). Validates prerequisites are done.',
    {
      taskId: z.string().describe('Task ID'),
      agentName: z.string().describe('Your agent name'),
    },
    async ({ taskId, agentName }) => {
      try {
        await requireProject();
        return ok(await kanbanService.claimTask(taskId, agentName));
      } catch (e) {
        return err((e as Error).message);
      }
    },
  );

  server.tool(
    'task_start',
    'Start work on a claimed task (claimed → in_progress)',
    {
      taskId: z.string().describe('Task ID'),
      agentName: z.string().describe('Your agent name'),
    },
    async ({ taskId, agentName }) => {
      try {
        await requireProject();
        return ok(await kanbanService.startTask(taskId, agentName));
      } catch (e) {
        return err((e as Error).message);
      }
    },
  );

  server.tool(
    'task_submit_review',
    'Submit task for review (in_progress → review)',
    {
      taskId: z.string().describe('Task ID'),
      agentName: z.string().describe('Your agent name'),
      summary: z.string().describe('Summary of what was done'),
    },
    async ({ taskId, agentName, summary }) => {
      try {
        await requireProject();
        return ok(await kanbanService.submitReview(taskId, agentName, summary));
      } catch (e) {
        return err((e as Error).message);
      }
    },
  );

  server.tool(
    'task_comment',
    'Add a comment to a task (no status change)',
    {
      taskId: z.string().describe('Task ID'),
      agentName: z.string().describe('Your agent name'),
      comment: z.string().describe('Comment text'),
    },
    async ({ taskId, agentName, comment }) => {
      try {
        await requireProject();
        return ok(await kanbanService.addComment(taskId, agentName, comment));
      } catch (e) {
        return err((e as Error).message);
      }
    },
  );

  server.tool(
    'task_log_change',
    'Record code/document changes for a task with a diff view. Call after each meaningful change.',
    {
      taskId: z.string().describe('Task ID'),
      agentName: z.string().describe('Your agent name'),
      type: z.enum(['feature', 'fix', 'docs', 'refactor']).describe('Type of change'),
      summary: z.string().describe('One-line summary of the change'),
      diff: z.string().describe(
        'Diff-style text. Use # for filename headers, + for added lines, - for removed lines.\nExample:\n# src/foo.ts\n- old line\n+ new line',
      ),
    },
    async ({ taskId, agentName, type, summary, diff }) => {
      try {
        await requireProject();
        return ok(await kanbanService.logChange(taskId, agentName, type, summary, diff));
      } catch (e) {
        return err((e as Error).message);
      }
    },
  );

  server.tool(
    'task_update',
    'Update task metadata (title, description, tags, prerequisites)',
    {
      taskId: z.string().describe('Task ID'),
      title: z.string().optional(),
      description: z.string().optional(),
      tags: z.array(z.string()).optional(),
      prerequisites: z.array(z.string()).optional().describe('Task IDs that must be done first'),
    },
    async ({ taskId, title, description, tags, prerequisites }) => {
      try {
        await requireProject();
        return ok(await kanbanService.updateTaskMeta(taskId, { title, description, tags, prerequisites }));
      } catch (e) {
        return err((e as Error).message);
      }
    },
  );
}
