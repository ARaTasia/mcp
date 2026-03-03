// Kanban MCP - Web UI
'use strict';

// ── i18n ────────────────────────────────────────────────────────────────────

const I18N = {
  ko: {
    columns: { todo: '미승인', approved: '승인', claimed: '재작업', in_progress: '진행중', review: '리뷰', done: '완료' },
    header: { project: '프로젝트', tag: '태그', newTask: '+ 새 작업', all: '전체', delete: '삭제' },
    modal: { desc: '설명', status: '상태', assignee: '담당자', tags: '태그', prereqs: '전제조건', none: '없음',
             history: '히스토리', noHistory: '히스토리 없음', changes: '변경 내역', archive: '보관함',
             approve: '승인', createTitle: '새 작업 만들기', title: '제목', description: '설명',
             assigneePlaceholder: '에이전트 이름 (선택)', tagsPlaceholder: 'backend, frontend, db',
             prereqsPlaceholder: 'task_id1, task_id2', cancel: '취소', create: '만들기',
             deleteProject: '프로젝트 삭제', deleteConfirm: '삭제', deleteMsg: '프로젝트를 삭제하시겠습니까?',
             deleteWarning: '이 프로젝트에 작업이 있습니다.', deleteWarningDetail: '삭제하면 모든 작업과 히스토리가 함께 삭제됩니다.',
             titleRequired: '제목을 입력하세요.', projectRequired: '프로젝트를 선택해 주세요.',
             clickToApprove: '클릭하여 승인',
             createFailed: '생성 실패', approveFailed: '승인 실패', deleteFailed: '삭제 실패' },
    time: { sec: '초 전', min: '분 전', hour: '시간 전', day: '일 전' },
    empty: '없음',
  },
  en: {
    columns: { todo: 'Unapproved', approved: 'Approved', claimed: 'Rework', in_progress: 'In Progress', review: 'Review', done: 'Done' },
    header: { project: 'Project', tag: 'Tag', newTask: '+ New Task', all: 'All', delete: 'Delete' },
    modal: { desc: 'Description', status: 'Status', assignee: 'Assignee', tags: 'Tags', prereqs: 'Prerequisites', none: 'None',
             history: 'History', noHistory: 'No history', changes: 'Changes', archive: 'Archive',
             approve: 'Approve', createTitle: 'Create Task', title: 'Title', description: 'Description',
             assigneePlaceholder: 'Agent name (optional)', tagsPlaceholder: 'backend, frontend, db',
             prereqsPlaceholder: 'task_id1, task_id2', cancel: 'Cancel', create: 'Create',
             deleteProject: 'Delete Project', deleteConfirm: 'Delete', deleteMsg: 'Delete this project?',
             deleteWarning: 'This project has tasks.', deleteWarningDetail: 'All tasks and history will be deleted.',
             titleRequired: 'Title is required.', projectRequired: 'Please select a project.',
             clickToApprove: 'Click to approve',
             createFailed: 'Create failed', approveFailed: 'Approve failed', deleteFailed: 'Delete failed' },
    time: { sec: 's ago', min: 'm ago', hour: 'h ago', day: 'd ago' },
    empty: 'None',
  },
};

function t(path) {
  return path.split('.').reduce((o, k) => o?.[k], I18N[state.lang]) ?? path;
}

const COLUMNS = [
  { key: 'todo' },
  { key: 'approved' },
  { key: 'claimed' },
  { key: 'in_progress' },
  { key: 'review' },
  { key: 'done' },
];

let state = {
  projects: [],
  tasks: [],
  archivedTasks: [],
  selectedProject: '',
  activeTag: '',
  openTaskId: null,
  lang: localStorage.getItem('kanban-lang') || 'ko',
  archiveOpen: false,
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
  if (diff < 60) return `${diff}${t('time.sec')}`;
  if (diff < 3600) return `${Math.floor(diff / 60)}${t('time.min')}`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}${t('time.hour')}`;
  return `${Math.floor(diff / 86400)}${t('time.day')}`;
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
  state.tasks = await api('GET', `/api/tasks?${qs}`);
  renderBoard();
  renderTagFilters();
}

async function loadArchivedTasks() {
  const qs = new URLSearchParams();
  if (state.selectedProject) qs.set('projectId', state.selectedProject);
  state.archivedTasks = await api('GET', `/api/archived-tasks?${qs}`);
}

// ── Helpers ────────────────────────────────────────────────────────────────

function formatProjectName(project) {
  if (project.workspace_path) {
    const normalized = project.workspace_path.replace(/\\/g, '/');
    const segments = normalized.split('/').filter(Boolean);
    if (segments.length <= 3) return normalized;
    return '.../' + segments.slice(-3).join('/');
  }
  return project.name;
}

// ── Language ──────────────────────────────────────────────────────────────

function setLang(lang) {
  state.lang = lang;
  localStorage.setItem('kanban-lang', lang);
  updateLangToggle();
  updateStaticI18n();
  renderProjectSelect();
  renderBoard();
  renderTagFilters();
}

function updateLangToggle() {
  document.getElementById('langToggle').textContent = '🌐 ' + state.lang.toUpperCase();
}

function updateStaticI18n() {
  // Update static elements with data-i18n attribute
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    el.textContent = t(key);
  });

  // Update create task modal labels
  const createModal = document.getElementById('createTaskModal');
  if (createModal) {
    createModal.querySelector('.modal-title').textContent = t('modal.createTitle');
    const labels = createModal.querySelectorAll('.form-group label');
    if (labels[0]) labels[0].textContent = t('header.project') + ' *';
    if (labels[1]) labels[1].textContent = t('modal.title') + ' *';
    if (labels[2]) labels[2].textContent = t('modal.description');
    if (labels[3]) labels[3].textContent = t('modal.assignee');
    if (labels[4]) labels[4].textContent = t('modal.tags') + ' (,)';
    if (labels[5]) labels[5].textContent = t('modal.prereqs') + ' Task ID (,)';
  }

  // Update placeholders
  const el = (id) => document.getElementById(id);
  if (el('newTaskAssignee')) el('newTaskAssignee').placeholder = t('modal.assigneePlaceholder');
  if (el('newTaskTags')) el('newTaskTags').placeholder = t('modal.tagsPlaceholder');
  if (el('newTaskPrereqs')) el('newTaskPrereqs').placeholder = t('modal.prereqsPlaceholder');

  // Update buttons
  if (el('createTaskCancel')) el('createTaskCancel').textContent = t('modal.cancel');
  if (el('createTaskSubmit')) el('createTaskSubmit').textContent = t('modal.create');

  // Update delete modal
  const delModal = document.getElementById('deleteProjectModal');
  if (delModal) {
    delModal.querySelector('.modal-title').textContent = t('modal.deleteProject');
    if (el('deleteProjectCancel')) el('deleteProjectCancel').textContent = t('modal.cancel');
    if (el('deleteProjectConfirm')) el('deleteProjectConfirm').textContent = t('modal.deleteConfirm');
  }
}

// ── Render ─────────────────────────────────────────────────────────────────

function renderProjectSelect() {
  const dropdown = document.getElementById('projectDropdown');
  const trigger = document.getElementById('projectTrigger');
  const optionsEl = document.getElementById('projectOptions');
  const delBtn = document.getElementById('deleteProjectBtn');

  // Update trigger text
  const selected = state.projects.find(p => p.id === state.selectedProject);
  trigger.querySelector('.project-trigger-text').textContent =
    selected ? formatProjectName(selected) : t('header.all');
  trigger.title = selected?.workspace_path || selected?.name || t('header.all');

  // Build options list
  optionsEl.innerHTML = '';

  // "All" option
  const allOpt = document.createElement('div');
  allOpt.className = 'project-option' + (!state.selectedProject ? ' selected' : '');
  allOpt.innerHTML = `<span class="project-option-name">${t('header.all')}</span>`;
  allOpt.addEventListener('click', () => selectProject(''));
  optionsEl.appendChild(allOpt);

  state.projects.forEach(p => {
    const opt = document.createElement('div');
    opt.className = 'project-option' + (p.id === state.selectedProject ? ' selected' : '');
    opt.title = p.workspace_path || p.name;
    opt.innerHTML = `
      <span class="project-option-name">${escHtml(formatProjectName(p))}</span>
      <span class="project-option-time">${timeAgo(p.last_activity)}</span>
    `;
    opt.addEventListener('click', () => selectProject(p.id));
    optionsEl.appendChild(opt);
  });

  // Show/hide delete button
  delBtn.style.display = state.selectedProject ? '' : 'none';
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

  sel.innerHTML = `<option value="">${t('header.all')}</option>`;
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
        <span class="col-title">${t('columns.' + col.key)}</span>
        <span class="col-count">${tasks.length}</span>
      </div>
      <div class="cards-container" id="col-${col.key}"></div>
    `;
    board.appendChild(colEl);

    const container = colEl.querySelector(`#col-${col.key}`);

    if (tasks.length === 0) {
      container.innerHTML = `<div class="empty-state">${t('empty')}</div>`;
    } else {
      tasks.forEach((task, i) => {
        container.appendChild(renderCard(task, i));
      });
    }

    // Archive section in Done column
    if (col.key === 'done') {
      const archiveSection = document.createElement('div');
      archiveSection.className = 'archive-section';
      archiveSection.innerHTML = `
        <button class="archive-toggle" id="archiveToggle">
          <span class="archive-toggle-arrow${state.archiveOpen ? ' open' : ''}" id="archiveArrow">▶</span>
          <span>${t('modal.archive')} (${state.archivedTasks.length})</span>
        </button>
        <div class="archive-list" id="archiveList" style="display:${state.archiveOpen ? 'flex' : 'none'}"></div>
      `;
      container.appendChild(archiveSection);

      const toggleBtn = archiveSection.querySelector('#archiveToggle');
      toggleBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        state.archiveOpen = !state.archiveOpen;
        if (state.archiveOpen && state.archivedTasks.length === 0) {
          await loadArchivedTasks();
        }
        renderArchiveList();
        document.getElementById('archiveArrow').classList.toggle('open', state.archiveOpen);
        document.getElementById('archiveList').style.display = state.archiveOpen ? 'flex' : 'none';
      });

      if (state.archiveOpen) {
        renderArchiveList();
      }
    }
  });
}

function renderArchiveList() {
  const list = document.getElementById('archiveList');
  if (!list) return;
  if (state.archivedTasks.length === 0) {
    list.innerHTML = `<div class="empty-state">${t('empty')}</div>`;
    return;
  }
  list.innerHTML = '';
  state.archivedTasks.forEach(task => {
    const card = document.createElement('div');
    card.className = 'archive-card';
    card.textContent = task.title;
    card.addEventListener('click', (e) => {
      e.stopPropagation();
      openArchivedTaskDetail(task.id);
    });
    list.appendChild(card);
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

  // Approve button for todo (unapproved) tasks
  const approveHtml = (task.status === 'todo' && !locked)
    ? `<button class="card-approve-btn" data-approve-id="${task.id}">${t('modal.approve')}</button>`
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
    ${approveHtml}
  `;

  card.addEventListener('click', (e) => {
    if (e.target.classList.contains('card-approve-btn')) return;
    openTaskDetail(task.id);
  });

  // Wire approve button
  const approveBtn = card.querySelector('.card-approve-btn');
  if (approveBtn) {
    approveBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        await api('PATCH', `/api/tasks/${task.id}/approve`);
        await loadTasks();
      } catch (err) {
        alert(t('modal.approveFailed') + ': ' + err.message);
      }
    });
  }

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

async function openArchivedTaskDetail(taskId) {
  state.openTaskId = taskId;
  const modal = document.getElementById('taskModal');
  modal.classList.add('open');

  document.getElementById('modalTitle').textContent = 'Loading...';
  document.getElementById('modalBody').innerHTML = '';

  try {
    const { task, history, changes } = await api('GET', `/api/archived-tasks/${taskId}`);
    renderTaskModal(task, history, changes ?? [], true);
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

function renderTaskModal(task, history, changes = [], isArchived = false) {
  document.getElementById('modalTitle').textContent = task.title;

  const prereqs = task.prerequisites || [];
  const prereqHtml = prereqs.length === 0
    ? `<span style="color:var(--text-muted);font-size:12px">${t('modal.none')}</span>`
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
    ? `<div class="empty-state">${t('modal.noHistory')}</div>`
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

  const statusLabel = isArchived ? 'done (archived)' : task.status;

  document.getElementById('modalBody').innerHTML = `
    ${task.description ? `
    <div class="modal-section">
      <div class="modal-label">${t('modal.desc')}</div>
      <div class="modal-desc">${escHtml(task.description)}</div>
    </div>` : ''}

    <div class="modal-section" style="display:flex;gap:16px;flex-wrap:wrap;">
      <div>
        <div class="modal-label">${t('modal.status')}</div>
        <span class="status-badge status-${task.status || 'done'}">${statusLabel}</span>
      </div>
      ${task.assignee ? `<div>
        <div class="modal-label">${t('modal.assignee')}</div>
        <span style="font-size:13px">👤 ${escHtml(task.assignee)}</span>
      </div>` : ''}
      ${task.tags && task.tags.length ? `<div>
        <div class="modal-label">${t('modal.tags')}</div>
        <div class="tags">${tagsHtml(task.tags)}</div>
      </div>` : ''}
    </div>

    <div class="modal-section">
      <div class="modal-label">${t('modal.prereqs')}</div>
      ${prereqHtml}
    </div>

    ${changes.length > 0 ? `
    <div class="modal-section">
      <div class="modal-label">${t('modal.changes')}</div>
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
      <div class="modal-label">${t('modal.history')}</div>
      ${historyHtml}
    </div>

    ${task.status === 'todo' && !isArchived ? `
    <div class="modal-section stamp-section">
      <button class="stamp-btn" id="modalApproveBtn">
        <div class="stamp-face">
          <div class="stamp-text">APPROVED</div>
          <div class="stamp-date">${new Date().toISOString().slice(0, 10)}</div>
        </div>
        <div class="stamp-hint">${t('modal.clickToApprove')}</div>
      </button>
    </div>` : ''}
  `;

  const modalApproveBtn = document.getElementById('modalApproveBtn');
  if (modalApproveBtn) {
    modalApproveBtn.addEventListener('click', async () => {
      modalApproveBtn.classList.add('stamped');
      try {
        await api('PATCH', `/api/tasks/${task.id}/approve`);
        await loadTasks();
        setTimeout(() => closeModal('taskModal'), 600);
      } catch (err) {
        modalApproveBtn.classList.remove('stamped');
        alert(t('modal.approveFailed') + ': ' + err.message);
      }
    });
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
  sel.innerHTML = `<option value="">— ${t('header.project')} —</option>`;
  state.projects.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = formatProjectName(p);
    if (p.id === state.selectedProject) opt.selected = true;
    sel.appendChild(opt);
  });

  // Show project selector only in "All" mode
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
  if (!title) return alert(t('modal.titleRequired'));

  const projectId = state.selectedProject || document.getElementById('newTaskProject').value;
  if (!projectId) return alert(t('modal.projectRequired'));

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
    alert(t('modal.createFailed') + ': ' + e.message);
  }
});

// ── Project dropdown ──────────────────────────────────────────────────────

async function selectProject(id) {
  state.selectedProject = id;
  state.activeTag = '';
  state.archivedTasks = [];
  state.archiveOpen = false;
  document.getElementById('projectDropdown').classList.remove('open');
  renderProjectSelect();
  await loadTasks();
}

document.getElementById('projectTrigger').addEventListener('click', (e) => {
  e.stopPropagation();
  document.getElementById('projectDropdown').classList.toggle('open');
});

document.addEventListener('click', (e) => {
  const dropdown = document.getElementById('projectDropdown');
  if (!dropdown.contains(e.target)) {
    dropdown.classList.remove('open');
  }
});

// ── Delete project ────────────────────────────────────────────────────────

document.getElementById('deleteProjectBtn').addEventListener('click', () => {
  const projectId = state.selectedProject;
  if (!projectId) return;

  const project = state.projects.find(p => p.id === projectId);
  if (!project) return;

  document.getElementById('deleteProjectMsg').textContent =
    `"${formatProjectName(project)}" ${t('modal.deleteMsg')}`;

  const hasTasks = state.tasks.length > 0;
  const warning = document.getElementById('deleteProjectTaskWarning');
  warning.style.display = hasTasks ? '' : 'none';
  if (hasTasks) {
    warning.querySelector('p:first-child').textContent = t('modal.deleteWarning');
    warning.querySelector('p:last-child').textContent = t('modal.deleteWarningDetail');
  }

  document.getElementById('deleteProjectModal').classList.add('open');
});

document.getElementById('deleteProjectClose').addEventListener('click', () => closeModal('deleteProjectModal'));
document.getElementById('deleteProjectCancel').addEventListener('click', () => closeModal('deleteProjectModal'));
document.getElementById('deleteProjectModal').addEventListener('click', e => {
  if (e.target === e.currentTarget) closeModal('deleteProjectModal');
});

document.getElementById('deleteProjectConfirm').addEventListener('click', async () => {
  const projectId = state.selectedProject;
  if (!projectId) return;

  try {
    await api('DELETE', `/api/projects/${projectId}?force=true`);
    closeModal('deleteProjectModal');
    state.selectedProject = '';
    await Promise.all([loadProjects(), loadTasks()]);
  } catch (e) {
    alert(t('modal.deleteFailed') + ': ' + e.message);
  }
});

// ── Language toggle ───────────────────────────────────────────────────────

document.getElementById('langToggle').addEventListener('click', () => {
  setLang(state.lang === 'ko' ? 'en' : 'ko');
});

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
    } else if (type === 'project_deleted') {
      state.projects = state.projects.filter(p => p.id !== payload.projectId);
      if (state.selectedProject === payload.projectId) {
        state.selectedProject = '';
        state.tasks = [];
        renderBoard();
        renderTagFilters();
      }
      renderProjectSelect();
    } else if (type === 'tasks_archived') {
      // Reload tasks and archived tasks
      await loadTasks();
      if (state.archiveOpen) {
        await loadArchivedTasks();
        renderArchiveList();
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
  updateLangToggle();
  updateStaticI18n();
  connectWS();
  await Promise.all([loadProjects(), loadTasks()]);
})();
