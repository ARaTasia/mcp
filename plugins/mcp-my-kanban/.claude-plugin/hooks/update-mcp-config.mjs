import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { writeFileSync } from 'fs';

// hooks/ 디렉토리의 부모 = .claude-plugin/ 의 부모 = 플러그인 루트
const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
const scriptPath = join(pluginRoot, 'src/mcp-stdio.ts').replace(/\\/g, '/');

const config = {
  mcpServers: {
    kanban: {
      type: 'stdio',
      command: 'npx',
      args: ['tsx', scriptPath],
      env: { KANBAN_WORKSPACE: process.cwd() }
    }
  }
};

writeFileSync(join(pluginRoot, '.mcp.json'), JSON.stringify(config, null, 2));
