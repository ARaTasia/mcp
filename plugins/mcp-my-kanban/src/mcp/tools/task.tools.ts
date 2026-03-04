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
      status: z.string().optional().describe('Filter by status: todo|approved|claimed|in_progress|review|done'),
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
    'Create a new task in todo (unapproved) status. ⛔ After creation, STOP and wait for user approval in web UI. Do NOT write code or start implementation until task is approved.',
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
        const task = await kanbanService.createTask({ projectId, title, description, tags, assignee, prerequisites });
        return {
          content: [
            { type: 'text' as const, text: JSON.stringify(task, null, 2) },
            {
              type: 'text' as const,
              text: `⛔ MANDATORY CHECKLIST before proceeding:

1. SELF-CHECK: Review the task you just created. Does the title and description contain ALL information needed for implementation? (requirements, scope, affected files, acceptance criteria) If not, call task_update now to add missing details.

2. STOP: This task is UNAPPROVED. Do NOT write code, modify files, or start implementation.
   - Tell the user: "태스크를 등록했습니다. 웹 UI에서 승인해주세요."
   - Wait for the user to approve the task in the web UI.
   - After approval, use task_list(status=approved) to confirm, then task_start to begin.`,
            },
          ],
        };
      } catch (e) {
        return err((e as Error).message);
      }
    },
  );

  server.tool(
    'task_claim',
    '[DEPRECATED: Use task_start directly on approved tasks] Claim a todo task (todo → claimed). Validates prerequisites are done.',
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
    'Start work on a task (approved/claimed → in_progress). When starting from approved, validates prerequisites and sets assignee.',
    {
      taskId: z.string().describe('Task ID'),
      agentName: z.string().describe('Your agent name'),
    },
    async ({ taskId, agentName }) => {
      try {
        await requireProject();
        const result = await kanbanService.startTask(taskId, agentName);
        return {
          content: [
            { type: 'text' as const, text: JSON.stringify(result, null, 2) },
            {
              type: 'text' as const,
              text: `✅ Task started. Next steps:
1. Post a start comment with task_comment: outline your work plan (analysis → implementation → verification).
2. Begin implementation. After EVERY file change, immediately call task_log_change with the real file path and actual diff.
3. When done, call task_submit_review.`,
            },
          ],
        };
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
        const result = await kanbanService.submitReview(taskId, agentName, summary);
        return {
          content: [
            { type: 'text' as const, text: JSON.stringify(result, null, 2) },
            {
              type: 'text' as const,
              text: `📋 Task submitted for review. Run self-review checklist NOW:
- [ ] All requirements from the task description are met?
- [ ] No existing functionality is broken?
- [ ] Every file change has been recorded with task_log_change?
- [ ] Each diff contains real file paths and actual code lines?

If ALL checks pass → call task_complete.
If ANY check fails → call task_rework with corrections describing what needs to be fixed.`,
            },
          ],
        };
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
    `Record code/document changes for a task. STRICT RULES:
- One file per call. If you changed 3 files, call 3 times.
- diff MUST contain the real file path (e.g. "# src/services/kanban.service.ts"), NOT summaries like "# service file".
- diff MUST contain actual code lines (e.g. "+ if (!name) throw new Error('name required');"), NOT paraphrases like "+ added validation".
- summary MUST be specific (e.g. "Add name validation to createProject"), NOT generic like "Update file".`,
    {
      taskId: z.string().describe('Task ID'),
      agentName: z.string().describe('Your agent name'),
      type: z.enum(['feature', 'fix', 'docs', 'refactor']).describe('Type of change'),
      summary: z.string().describe('One-line summary of the change — must describe the specific change, not just "update file"'),
      diff: z.string().describe(
        'Diff-style text. Use # for real file path, + for added lines, - for removed lines.\nExample:\n# src/foo.ts\n- old line\n+ new line',
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

  server.tool(
    'task_complete',
    'Complete a task after self-review (review → done). Agent calls this when self-review checklist passes.',
    {
      taskId: z.string().describe('Task ID'),
      agentName: z.string().describe('Your agent name'),
    },
    async ({ taskId, agentName }) => {
      try {
        await requireProject();
        const result = await kanbanService.completeTask(taskId, agentName);
        return {
          content: [
            { type: 'text' as const, text: JSON.stringify(result, null, 2) },
            {
              type: 'text' as const,
              text: `🎉 Task completed. Next steps:
1. Commit and push: Stage ONLY the files you changed for this task (do NOT use "git add -A" or "git add ."), create a git commit with a descriptive message, and push to the remote branch.
2. Call task_list(status=approved) to check for more approved tasks.
3. If there are approved tasks available, pick one and call task_start.
4. If none, inform the user that all approved tasks are done.`,
            },
          ],
        };
      } catch (e) {
        return err((e as Error).message);
      }
    },
  );

  server.tool(
    'task_rework',
    'Send task back for rework after self-review failure (review → claimed). Include corrections describing what needs to be fixed.',
    {
      taskId: z.string().describe('Task ID'),
      agentName: z.string().describe('Your agent name'),
      corrections: z.string().describe('Description of what needs to be corrected'),
    },
    async ({ taskId, agentName, corrections }) => {
      try {
        await requireProject();
        const result = await kanbanService.reworkTask(taskId, agentName, corrections);
        return {
          content: [
            { type: 'text' as const, text: JSON.stringify(result, null, 2) },
            {
              type: 'text' as const,
              text: `🔄 Task sent back for rework. Next steps:
1. Call task_start to re-enter in_progress status.
2. Fix the issues described in corrections.
3. Record all changes with task_log_change.
4. When fixes are complete, call task_submit_review again.`,
            },
          ],
        };
      } catch (e) {
        return err((e as Error).message);
      }
    },
  );
}
