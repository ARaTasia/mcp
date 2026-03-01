import http from 'http';
import express from 'express';
import { initSchema } from './db/schema.js';
import { initWebSocket } from './web/websocket.js';
import webRouter from './web/router.js';
import { createMcpApp } from './mcp/server.js';

const WEB_PORT = parseInt(process.env.WEB_PORT ?? '3000', 10);
const MCP_PORT = parseInt(process.env.MCP_PORT ?? '3001', 10);

async function main() {
  // Initialize DB
  await initSchema();
  console.log('Database initialized');

  // Web server (Express + WebSocket)
  const webApp = express();
  webApp.use(express.json());
  webApp.use(webRouter);

  const webServer = http.createServer(webApp);
  initWebSocket(webServer);

  webServer.listen(WEB_PORT, () => {
    console.log(`Web UI:    http://localhost:${WEB_PORT}`);
    console.log(`WebSocket: ws://localhost:${WEB_PORT}/ws`);
  });

  // MCP server (separate port)
  const mcpApp = createMcpApp();
  mcpApp.listen(MCP_PORT, () => {
    console.log(`MCP:       http://localhost:${MCP_PORT}/mcp`);
  });
}

main().catch(err => {
  console.error('Failed to start:', err);
  process.exit(1);
});
