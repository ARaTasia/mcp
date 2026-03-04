import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { kanbanService } from '../services/kanban.service.js';
import { broadcast } from './websocket.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router = express.Router();

// Serve static files
router.use(express.static(path.join(__dirname, 'public')));

// Projects
router.get('/api/projects', async (_req, res) => {
  try {
    res.json(await kanbanService.listProjects());
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

router.post('/api/projects', async (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name) { res.status(400).json({ error: 'name is required' }); return; }
    res.status(201).json(await kanbanService.createProject(name, description));
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

router.delete('/api/projects/:id', async (req, res) => {
  try {
    const force = req.query.force === 'true';
    res.json(await kanbanService.deleteProject(req.params.id, force));
  } catch (e) {
    const status = (e as Error).message.includes('not found') ? 404 : 400;
    res.status(status).json({ error: (e as Error).message });
  }
});

// Tasks
router.get('/api/tasks', async (req, res) => {
  try {
    const { projectId, status, tags } = req.query as Record<string, string>;
    const tagsArr = tags ? tags.split(',').map((t) => t.trim()) : undefined;
    res.json(await kanbanService.listTasks({ projectId, status, tags: tagsArr }));
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

router.post('/api/tasks', async (req, res) => {
  try {
    const { projectId, title, description, tags, assignee, prerequisites } = req.body;
    if (!projectId || !title) { res.status(400).json({ error: 'projectId and title required' }); return; }
    res.status(201).json(
      await kanbanService.createTask({ projectId, title, description, tags, assignee, prerequisites }),
    );
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

router.get('/api/tasks/:id', async (req, res) => {
  try {
    res.json(await kanbanService.getTask(req.params.id));
  } catch (e) {
    res.status(404).json({ error: (e as Error).message });
  }
});

router.patch('/api/tasks/:id/approve', async (req, res) => {
  try {
    res.json(await kanbanService.approveTask(req.params.id));
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

router.get('/api/archived-tasks', async (req, res) => {
  try {
    const { projectId } = req.query as Record<string, string>;
    res.json(await kanbanService.listArchivedTasks(projectId));
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

router.get('/api/archived-tasks/:id', async (req, res) => {
  try {
    res.json(await kanbanService.getArchivedTask(req.params.id));
  } catch (e) {
    res.status(404).json({ error: (e as Error).message });
  }
});

// Internal broadcast relay (used by non-WebSocket-owner instances)
router.post('/api/_broadcast', (req, res) => {
  const { type, payload } = req.body;
  if (typeof type === 'string') broadcast(type, payload);
  res.status(204).end();
});

// Serve SPA for root
router.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

export default router;
