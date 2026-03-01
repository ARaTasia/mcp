import { createClient } from '@libsql/client';
import fs from 'fs';
import os from 'os';
import path from 'path';

const dataDir = process.env.KANBAN_DATA_DIR
  ?? path.join(os.homedir(), '.mcp-my-kanban');
const dbPath = path.join(dataDir, 'kanban.db');

fs.mkdirSync(dataDir, { recursive: true });

export const db = createClient({
  url: `file:${dbPath}`,
});
