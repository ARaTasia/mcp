// Kanban MCP - Web UI
'use strict';

const COLUMNS = [
  { key: 'todo',        label: 'To Do' },
  { key: 'claimed',     label: 'Claimed' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'review',      label: 'Review' },
  { key: 'done',        label: 'Done' },
];

let state = {
  projects: [],
  tasks: [],
  selectedProject: '',
  activeTag: '',
  openTaskId: null,
};

// ── Utils ──────────────────────────────────────────────────────────────────

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

function timeAgo(unixSec) {
  const diff = Math.floor(Date.now() / 1000) - unixSec;
  if (diff < 60) return `${diff}초 전`;
  if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`;
  return `${Math.floor(diff / 86400)}일 전`;
}

function tagClass(tag) {
  if (tag === 'db') return 'tag-db';
  if (tag === 'backend') return 'tag-backend';
  if (tag === 'frontend') return 'tag-frontend';
  return 'tag-default';
}

// Known all-caps or special-cased tags
const TAG_DISPLAY = { db: 'DB' };
function formatTag(tag) {
  if (TAG_DISPLAY[tag]) return TAG_DISPLAY[tag];
  return tag.charAt(0).toUpperCase() + tag.slice(1);
}

function tagsHtml(tags) {
  return (tags || [])
    .map(t => `<span class="tag ${tagClass(t)}">${t}</span>`)
    .join('');
}

function isLocked(task) {
  if (task.status !== 'todo') return false;
  const prereqs = task.prerequisites || [];
  if (prereqs.length === 0) return false;
  return prereqs.some(pid => {
    const p = state.tasks.find(t => t.id === pid);
    return !p || p.status !== 'done';
  });
}

// ── Data loading ───────────────────────────────────────────────────────────

async function loadProjects() {
  state.projects = await api('GET', '/api/projects');
  renderProjectSelect();
}

async function loadTasks() {
  const qs = new URLSearchParams();
  if (state.selectedProject) qs.set('projectId', state.selectedProject);
  // Tag filtering is done client-side after loading all tasks
  state.tasks = await api('GET', `/api/tasks?${qs}`);
  renderBoard();
  renderTagFilters();
}

// ── Render ─────────────────────────────────────────────────────────────────

function renderProjectSelect() {
  const sel = document.getElementById('projectSelect');
  const current = sel.value;
  sel.innerHTML = '<option value="">전체</option>';
  state.projects.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    sel.appendChild(opt);
  });
  if (current) sel.value = current;
}

function renderTagFilters() {
  const allTags = [...new Set(state.tasks.flatMap(t => t.tags || []))].sort();
  const container = document.getElementById('tagFilters');

  let sel = document.getElementById('tagSelect');
  if (!sel) {
    sel = document.createElement('select');
    sel.id = 'tagSelect';
    container.innerHTML = '';
    container.appendChild(sel);
    sel.addEventListener('change', (e) => {
      state.activeTag = e.target.value;
      renderBoard();
      renderTagFilters();
    });
  }

  sel.innerHTML = '<option value="">전체</option>';
  allTags.forEach(tag => {
    const opt = document.createElement('option');
    opt.value = tag;
    opt.textContent = `#${formatTag(tag)}`;
    if (state.activeTag === tag) opt.selected = true;
    sel.appendChild(opt);
  });
}

function renderBoard() {
  const board = document.getElementById('board');
  board.innerHTML = '';

  // Client-side tag filter
  const visibleTasks = state.activeTag
    ? state.tasks.filter(t => (t.tags || []).includes(state.activeTag))
    : state.tasks;

  COLUMNS.forEach(col => {
    const tasks = visibleTasks.filter(t => t.status === col.key);

    const colEl = document.createElement('div');
    colEl.className = `column col-${col.key}`;
    colEl.innerHTML = `
      <div class="col-header">
        <span class="col-title">${col.label}</span>
        <span class="col-count">${tasks.length}</span>
      </div>
      <div class="cards-container" id="col-${col.key}"></div>
    `;
    board.appendChild(colEl);

    const container = colEl.querySelector(`#col-${col.key}`);

    if (tasks.length === 0) {
      container.innerHTML = '<div class="empty-state">없음</div>';
    } else {
      tasks.forEach((task, i) => {
        container.appendChild(renderCard(task, i));
      });
    }
  });
}

function renderCard(task, index = 0) {
  const locked = isLocked(task);
  const card = document.createElement('div');
  card.className = `card${locked ? ' locked' : ''}`;
  card.dataset.taskId = task.id;
  card.style.setProperty('--i', index);

  const lockIcon = locked ? '<span class="card-lock">🔒</span>' : '';
  const assigneeHtml = task.assignee
    ? `<span class="card-assignee">${task.assignee}</span>`
    : '';

  card.innerHTML = `
    <div class="card-header">
      ${lockIcon}
      <div class="card-title">${escHtml(task.title)}</div>
    </div>
    <div class="tags">${tagsHtml(task.tags)}</div>
    <div class="card-meta">
      ${assigneeHtml}
    </div>
  `;

  card.addEventListener('click', () => openTaskDetail(task.id));
  return card;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Task Detail Modal ──────────────────────────────────────────────────────

async function openTaskDetail(taskId) {
  state.openTaskId = taskId;
  const modal = document.getElementById('taskModal');
  modal.classList.add('open');

  document.getElementById('modalTitle').textContent = 'Loading...';
  document.getElementById('modalBody').innerHTML = '';

  try {
    const { task, history, changes } = await api('GET', `/api/tasks/${taskId}`);
    renderTaskModal(task, history, changes ?? []);
  } catch (e) {
    document.getElementById('modalBody').innerHTML = `<p style="color:var(--red)">${e.message}</p>`;
  }
}

const CHANGE_TYPE_LABEL = { feature: 'feature', fix: 'fix', docs: 'docs', refactor: 'refactor' };
const CHANGE_TYPE_COLOR = {
  feature: 'var(--accent)',
  fix: 'var(--red)',
  docs: 'var(--blue)',
  refactor: 'var(--yellow)',
};

function renderDiff(diffText) {
  if (!diffText) return '';
  return diffText.split('\n').map(line => {
    if (line.startsWith('#')) {
      return `<div class="diff-file">${escHtml(line.slice(1).trim())}</div>`;
    } else if (line.startsWith('+')) {
      return `<div class="diff-add">${escHtml(line)}</div>`;
    } else if (line.startsWith('-')) {
      return `<div class="diff-del">${escHtml(line)}</div>`;
    } else if (line.trim() === '') {
      return `<div class="diff-empty"> </div>`;
    } else {
      return `<div class="diff-ctx">${escHtml(line)}</div>`;
    }
  }).join('');
}

function renderTaskModal(task, history, changes = []) {
  document.getElementById('modalTitle').textContent = task.title;

  const prereqs = task.prerequisites || [];
  const prereqHtml = prereqs.length === 0
    ? '<span style="color:var(--text-muted);font-size:12px">없음</span>'
    : `<div class="prereq-list">${prereqs.map(pid => {
        const p = state.tasks.find(t => t.id === pid);
        const done = p && p.status === 'done';
        const label = p ? escHtml(p.title) : pid;
        return `<div class="prereq-item">
          <span class="prereq-icon ${done ? 'prereq-done' : 'prereq-pending'}">${done ? '✅' : '❌'}</span>
          <span>${label}</span>
        </div>`;
      }).join('')}</div>`;

  const historyHtml = history.length === 0
    ? '<div class="empty-state">히스토리 없음</div>'
    : `<div class="history-list">${history.map(h => `
        <div class="history-item">
          <div class="history-dot"></div>
          <div style="flex:1">
            <div>
              <span class="history-actor">${escHtml(h.actor)}</span>
              <span class="history-action"> · ${escHtml(h.action)}</span>
              ${h.from_status && h.to_status
                ? `<span class="history-transition">${h.from_status} → ${h.to_status}</span>`
                : ''}
            </div>
            ${h.comment ? `<div class="history-comment">${escHtml(h.comment)}</div>` : ''}
          </div>
          <div class="history-time">${timeAgo(h.created_at)}</div>
        </div>`).join('')}</div>`;

  const reviewActionsHtml = task.status === 'review'
    ? `<div class="modal-section">
        <div class="modal-label">리뷰 액션</div>
        <div class="review-actions">
          <div class="review-btns">
            <button class="btn btn-success" id="approveBtn">✓ 승인</button>
            <button class="btn btn-danger" id="rejectToggleBtn">✗ 반려</button>
          </div>
          <div class="reject-form" id="rejectForm">
            <textarea id="rejectReason" placeholder="요청사항 입력 (선택사항)"></textarea>
            <div style="display:flex;gap:8px;justify-content:flex-end;">
              <button class="btn btn-ghost" id="rejectCancelBtn">취소</button>
              <button class="btn btn-danger" id="rejectConfirmBtn">반려 확인</button>
            </div>
          </div>
        </div>
      </div>`
    : '';

  document.getElementById('modalBody').innerHTML = `
    ${task.description ? `
    <div class="modal-section">
      <div class="modal-label">설명</div>
      <div class="modal-desc">${escHtml(task.description)}</div>
    </div>` : ''}

    <div class="modal-section" style="display:flex;gap:16px;flex-wrap:wrap;">
      <div>
        <div class="modal-label">상태</div>
        <span class="status-badge status-${task.status}">${task.status}</span>
      </div>
      ${task.assignee ? `<div>
        <div class="modal-label">담당자</div>
        <span style="font-size:13px">👤 ${escHtml(task.assignee)}</span>
      </div>` : ''}
      ${task.tags && task.tags.length ? `<div>
        <div class="modal-label">태그</div>
        <div class="tags">${tagsHtml(task.tags)}</div>
      </div>` : ''}
    </div>

    <div class="modal-section">
      <div class="modal-label">전제조건</div>
      ${prereqHtml}
    </div>

    ${reviewActionsHtml}

    ${changes.length > 0 ? `
    <div class="modal-section">
      <div class="modal-label">변경 내역</div>
      <div class="change-list">
        ${changes.map(c => `
          <div class="change-item">
            <div class="change-header">
              <span class="change-type-badge" style="color:${CHANGE_TYPE_COLOR[c.type] || 'var(--text-muted)'}">${CHANGE_TYPE_LABEL[c.type] || c.type}</span>
              <span class="change-summary">${escHtml(c.summary)}</span>
              <span class="history-time">${timeAgo(c.created_at)} · ${escHtml(c.actor)}</span>
            </div>
            ${c.diff ? `<div class="diff-block">${renderDiff(c.diff)}</div>` : ''}
          </div>`).join('')}
      </div>
    </div>` : ''}

    <div class="modal-section">
      <div class="modal-label">히스토리</div>
      ${historyHtml}
    </div>
  `;

  // Wire up review buttons
  if (task.status === 'review') {
    document.getElementById('approveBtn').addEventListener('click', async () => {
      await handleApprove(task.id);
    });

    document.getElementById('rejectToggleBtn').addEventListener('click', () => {
      document.getElementById('rejectForm').classList.add('open');
      document.getElementById('rejectToggleBtn').style.display = 'none';
    });

    document.getElementById('rejectCancelBtn').addEventListener('click', () => {
      document.getElementById('rejectForm').classList.remove('open');
      document.getElementById('rejectToggleBtn').style.display = '';
      document.getElementById('rejectReason').value = '';
    });

    document.getElementById('rejectConfirmBtn').addEventListener('click', async () => {
      const reason = document.getElementById('rejectReason').value.trim();
      await handleReject(task.id, reason);
    });
  }
}

async function handleApprove(taskId) {
  try {
    await api('PATCH', `/api/tasks/${taskId}/approve`);
    closeModal('taskModal');
    await loadTasks();
  } catch (e) {
    alert('승인 실패: ' + e.message);
  }
}

async function handleReject(taskId, reason) {
  try {
    await api('PATCH', `/api/tasks/${taskId}/reject`, { reason });
    closeModal('taskModal');
    await loadTasks();
  } catch (e) {
    alert('반려 실패: ' + e.message);
  }
}

// ── Modals ─────────────────────────────────────────────────────────────────

function closeModal(id) {
  document.getElementById(id).classList.remove('open');
  if (id === 'taskModal') state.openTaskId = null;
}

document.getElementById('modalClose').addEventListener('click', () => closeModal('taskModal'));
document.getElementById('taskModal').addEventListener('click', e => {
  if (e.target === e.currentTarget) closeModal('taskModal');
});

// Create Task Modal
document.getElementById('newTaskBtn').addEventListener('click', () => {
  // Populate project dropdown
  const sel = document.getElementById('newTaskProject');
  sel.innerHTML = '<option value="">— 프로젝트 선택 —</option>';
  state.projects.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    if (p.id === state.selectedProject) opt.selected = true;
    sel.appendChild(opt);
  });

  // Show project selector only in "전체" mode
  const group = document.getElementById('modalProjectGroup');
  group.style.display = state.selectedProject ? 'none' : '';

  document.getElementById('createTaskModal').classList.add('open');
});

document.getElementById('createTaskClose').addEventListener('click', () => closeModal('createTaskModal'));
document.getElementById('createTaskCancel').addEventListener('click', () => closeModal('createTaskModal'));
document.getElementById('createTaskModal').addEventListener('click', e => {
  if (e.target === e.currentTarget) closeModal('createTaskModal');
});

document.getElementById('createTaskSubmit').addEventListener('click', async () => {
  const title = document.getElementById('newTaskTitle').value.trim();
  if (!title) return alert('제목을 입력하세요.');

  const projectId = state.selectedProject || document.getElementById('newTaskProject').value;
  if (!projectId) return alert('프로젝트를 선택해 주세요.');

  const desc = document.getElementById('newTaskDesc').value.trim() || undefined;
  const assignee = document.getElementById('newTaskAssignee').value.trim() || undefined;
  const tagsRaw = document.getElementById('newTaskTags').value.trim();
  const tags = tagsRaw ? tagsRaw.split(',').map(t => t.trim()).filter(Boolean) : [];
  const prereqsRaw = document.getElementById('newTaskPrereqs').value.trim();
  const prerequisites = prereqsRaw ? prereqsRaw.split(',').map(t => t.trim()).filter(Boolean) : [];

  try {
    await api('POST', '/api/tasks', {
      projectId,
      title,
      description: desc,
      assignee,
      tags,
      prerequisites,
    });
    closeModal('createTaskModal');
    // Clear form
    ['newTaskTitle','newTaskDesc','newTaskAssignee','newTaskTags','newTaskPrereqs'].forEach(id => {
      document.getElementById(id).value = '';
    });
    await loadTasks();
  } catch (e) {
    alert('생성 실패: ' + e.message);
  }
});

// Project select
document.getElementById('projectSelect').addEventListener('change', async (e) => {
  state.selectedProject = e.target.value;
  state.activeTag = '';
  await loadTasks();
});

// Tag filter select is wired up inside renderTagFilters()

// ── WebSocket ──────────────────────────────────────────────────────────────

let ws = null;
let wsReconnectTimer = null;

function connectWS() {
  const url = `ws://${location.host}/ws`;
  ws = new WebSocket(url);

  ws.onopen = () => {
    updateWsStatus(true);
    clearTimeout(wsReconnectTimer);
  };

  ws.onclose = () => {
    updateWsStatus(false);
    wsReconnectTimer = setTimeout(connectWS, 5000);
  };

  ws.onerror = () => {
    ws.close();
  };

  ws.onmessage = async (evt) => {
    let msg;
    try { msg = JSON.parse(evt.data); } catch { return; }

    const { type, payload } = msg;

    if (type === 'task_created') {
      if (!state.selectedProject || payload.project_id === state.selectedProject) {
        state.tasks.push(payload);
        renderBoard();
        renderTagFilters();
      }
    } else if (type === 'task_updated') {
      if (!state.selectedProject || payload.project_id === state.selectedProject) {
        const idx = state.tasks.findIndex(t => t.id === payload.id);
        if (idx !== -1) state.tasks[idx] = payload;
        else state.tasks.push(payload);
        renderBoard();
        renderTagFilters();

        // Refresh open modal if it's this task
        if (state.openTaskId === payload.id) {
          openTaskDetail(payload.id);
        }
      }
    } else if (type === 'history_added') {
      if (state.openTaskId === payload.taskId) {
        openTaskDetail(payload.taskId);
      }
    } else if (type === 'change_logged') {
      if (state.openTaskId === payload.taskId) {
        openTaskDetail(payload.taskId);
      }
    }
  };
}

function updateWsStatus(connected) {
  const dot = document.getElementById('wsDot');
  const label = document.getElementById('wsLabel');
  dot.className = 'ws-dot' + (connected ? ' connected' : '');
  label.textContent = connected ? 'Live' : 'Reconnecting...';
}

// ── Init ───────────────────────────────────────────────────────────────────

(async function init() {
  connectWS();
  await loadProjects();
  await loadTasks();
})();
