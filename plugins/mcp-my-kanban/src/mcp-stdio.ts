#!/usr/bin/env node
import http from 'http';
import path from 'path';
import { writeFileSync, unlinkSync, readdirSync, mkdirSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import express from 'express';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { initSchema } from './db/schema.js';
import { createMcpServer } from './mcp/server.js';
import { dbPath, sqlite } from './db/index.js';
import webRouter from './web/router.js';
import { initWebSocket } from './web/websocket.js';

const WEB_PORT = parseInt(process.env.WEB_PORT ?? '34567', 10);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '../data');
const PIDS_DIR = path.join(DATA_DIR, 'pids');

function registerPid() {
  mkdirSync(PIDS_DIR, { recursive: true });
  writeFileSync(path.join(PIDS_DIR, `${process.pid}.pid`), '');
}

function unregisterPid(): boolean {
  const f = path.join(PIDS_DIR, `${process.pid}.pid`);
  if (existsSync(f)) unlinkSync(f);
  if (!existsSync(PIDS_DIR)) return true;
  for (const file of readdirSync(PIDS_DIR).filter(f => f.endsWith('.pid'))) {
    const pid = parseInt(file);
    try { process.kill(pid, 0); return false; } // still alive
    catch { unlinkSync(path.join(PIDS_DIR, file)); } // dead, clean up
  }
  return true; // no other clients
}

async function tryStartWebServer() {
  return new Promise<void>((resolve) => {
    const app = express();
    app.use(express.json());
    app.use(webRouter);
    const server = http.createServer(app);
    initWebSocket(server);
    server.listen(WEB_PORT);
    server.on('listening', () => {
      process.stderr.write(`Web UI: http://localhost:${WEB_PORT}\n`);
      resolve();
    });
    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        process.stderr.write(`Web UI already running on port ${WEB_PORT}, skipping\n`);
        resolve();
      } else {
        process.stderr.write(`Web server error: ${err.message}\n`);
        resolve();
      }
    });
  });
}

async function main() {
  process.stderr.write(`[kanban-mcp] DB: ${dbPath}\n`);
  await initSchema();
  await tryStartWebServer();

  // PID tracking for shutdown when all clients disconnect
  registerPid();

  const shutdown = () => {
    try { sqlite.pragma('wal_checkpoint(TRUNCATE)'); } catch {}
    unregisterPid();
    process.exit(0);
  };

  process.stdin.once('end', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('exit', () => unregisterPid());

  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write('kanban-mcp stdio ready\n');
}

main().catch((e) => {
  process.stderr.write(String(e));
  process.exit(1);
});
