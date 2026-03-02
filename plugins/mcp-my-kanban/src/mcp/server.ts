import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';
import { registerTaskTools } from './tools/task.tools.js';
import { registerProjectTools } from './tools/project.tools.js';

export function createMcpServer(): McpServer {
  const server = new McpServer({ name: 'kanban-mcp', version: '1.3.0' });
  registerTaskTools(server);
  registerProjectTools(server);
  return server;
}

export function createMcpApp(): express.Express {
  const app = express();
  app.use(express.json());

  app.post('/mcp', async (req, res) => {
    const server = new McpServer({
      name: 'kanban-mcp',
      version: '1.3.0',
    });

    registerTaskTools(server);
    registerProjectTools(server);

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    res.on('close', () => {
      transport.close();
      server.close();
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  return app;
}
