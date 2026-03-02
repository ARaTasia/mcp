import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';

const dataDir = process.env.KANBAN_DATA_DIR
  ?? path.join(os.homedir(), '.mcp-my-kanban');
const dbPath = path.join(dataDir, 'kanban.db');

fs.mkdirSync(dataDir, { recursive: true });

const sqlite = new Database(dbPath);
sqlite.pragma('journal_mode = WAL');

// Compatible types matching the subset of @libsql/client used by this project
export type InValue = string | number | bigint | ArrayBuffer | null;
export type Row = InValue[];
export interface ResultSet {
  columns: string[];
  rows: Row[];
  lastInsertRowid: bigint | undefined;
}

export interface DbClient {
  execute(query: { sql: string; args?: InValue[] }): Promise<ResultSet>;
  executeMultiple(sql: string): Promise<void>;
}

function toResult(stmt: Database.Statement, args: InValue[], isSelect: boolean): ResultSet {
  const bindArgs = args.map(a => a === undefined ? null : a);
  if (isSelect) {
    // Use raw() to get arrays instead of objects, matching @libsql/client Row format
    const rawStmt = stmt.raw(true);
    const rows = rawStmt.all(...bindArgs) as Row[];
    return {
      columns: stmt.columns().map(c => c.name),
      rows,
      lastInsertRowid: undefined,
    };
  } else {
    const info = stmt.run(...bindArgs);
    return {
      columns: [],
      rows: [],
      lastInsertRowid: BigInt(info.lastInsertRowid),
    };
  }
}

function isSelectQuery(sql: string): boolean {
  return /^\s*SELECT\b/i.test(sql);
}

export const db: DbClient = {
  async execute(query: { sql: string; args?: InValue[] }): Promise<ResultSet> {
    const stmt = sqlite.prepare(query.sql);
    return toResult(stmt, query.args ?? [], isSelectQuery(query.sql));
  },

  async executeMultiple(sql: string): Promise<void> {
    sqlite.exec(sql);
  },
};
