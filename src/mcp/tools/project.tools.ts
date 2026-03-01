import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { kanbanService } from '../../services/kanban.service.js';

function ok(data: unknown): { content: [{ type: 'text'; text: string }] } {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

function err(message: string): { isError: true; content: [{ type: 'text'; text: string }] } {
  return { isError: true, content: [{ type: 'text', text: message }] };
}

export function registerProjectTools(server: McpServer): void {
  server.tool(
    'project_list',
    'List all projects',
    {},
    async () => {
      try {
        return ok(await kanbanService.listProjects());
      } catch (e) {
        return err((e as Error).message);
      }
    },
  );

  server.tool(
    'project_create',
    'Create a new project. If workspace_path is provided, a .kanban file is written there to persist the project ID and prevent duplicate creation on re-run.',
    {
      name: z.string().describe('Project name'),
      description: z.string().optional().describe('Project description'),
      workspace_path: z.string().optional().describe(
        'Absolute path to workspace directory. Server writes .kanban file here to avoid duplicate projects on re-run.',
      ),
    },
    async ({ name, description, workspace_path }) => {
      try {
        return ok(await kanbanService.createProject(name, description, workspace_path));
      } catch (e) {
        return err((e as Error).message);
      }
    },
  );

  server.tool(
    'project_get_by_path',
    'Read the .kanban file in the given directory and return the linked project. Returns null if no .kanban file exists. Use this at session start to reconnect to an existing project.',
    {
      workspace_path: z.string().describe('Absolute path to the workspace directory'),
    },
    async ({ workspace_path }) => {
      try {
        return ok(await kanbanService.getProjectByPath(workspace_path));
      } catch (e) {
        return err((e as Error).message);
      }
    },
  );

  server.tool(
    'project_delete',
    'Delete a project. Fails if the project has tasks unless force=true.',
    {
      project_id: z.string().describe('Project ID to delete'),
      force: z.boolean().optional().describe('If true, also deletes all tasks and their history'),
    },
    async ({ project_id, force }) => {
      try {
        return ok(await kanbanService.deleteProject(project_id, force ?? false));
      } catch (e) {
        return err((e as Error).message);
      }
    },
  );
}
