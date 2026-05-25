// ===== STATE =====
// Импорт Supabase функций
import {
    supabase,
    getCurrentUser, getProfile, signOut as supabaseSignOut,
    getProjects, createProject as sbCreateProject, updateProject as sbUpdateProject, deleteProject as sbDeleteProject,
    getTasks, createTask as sbCreateTask, updateTask as sbUpdateTask, deleteTask as sbDeleteTask,
    getNotes, createNote as sbCreateNote, deleteNote as sbDeleteNote,
    inviteMember, checkUserByEmail, updateProfile as sbUpdateProfile, getAllProfiles,
    getTaskAttachments, addTaskLink, uploadTaskFile, deleteTaskAttachment,
    getTaskComments, addTaskComment, deleteTaskComment
} from './js/supabase.js';

let state = {
    user: null,
    profile: null,
    profiles: [], // все профили для отображения имён
    projects: [],
    tasks: [],
    notes: []
};

let currentProjectId = null;
let currentTaskId = null;
let draggedTaskId = null;
let calendarDate = new Date();
let isSavingProject = false;
let rejectTaskId = null;
let refreshTimer = null;

// Делаем глобальными чтобы onclick в HTML видел их
window.currentProjectId = null;
window.currentTaskId = null;

// ===== INIT — загружаем данные из Supabase =====
async function init() {
    const user = await getCurrentUser();
    if (!user) {
        window.location.href = 'simple-login.html';
        return;
    }

    state.user = user;
    state.profile = await getProfile(user.id);

    // Загружаем данные параллельно
    const [projects, tasks, notes, profiles] = await Promise.all([
        getProjects(),
        getTasks(),
        getNotes(),
        getAllProfiles()
    ]);

    state.projects = projects || [];
    state.tasks = tasks || [];
    state.notes = notes || [];
    state.profiles = profiles || [];

    updateUserUI();
    updateBadges();
    renderDashboard();
    applyRoleUI();
    document.body.classList.add('loaded');

    // Обновляем командные проекты в сайдбаре
    updateTeamProjectsSidebar();

    // Приветствие
    const lastVisit = localStorage.getItem('nikomi_last_visit');
    const today = new Date().toDateString();
    if (lastVisit !== today) {
        localStorage.setItem('nikomi_last_visit', today);
        setTimeout(() => showPersNotif('welcome'), 1000);
    }
    setTimeout(() => checkDeadlines(), 3000);
    setupRealtimeRefresh();
}

// ===== SAVE — теперь сохраняем в Supabase =====
function save() {
    // Данные хранятся в Supabase, localStorage только для темы и настроек UI
    localStorage.setItem('nikomi_theme', document.body.classList.contains('dark') ? 'dark' : 'light');
}

// ===== NAVIGATION =====
function navigate(section) {
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    document.querySelectorAll('.content-section').forEach(s => s.classList.remove('active'));

    const navItem = document.querySelector(`[data-section="${section}"]`);
    if (navItem) navItem.classList.add('active');

    const sectionEl = document.getElementById(`${section}-section`);
    if (sectionEl) sectionEl.classList.add('active');

    const titles = {
        dashboard: 'Главная', projects: 'Проекты', tasks: 'Мои задачи',
        notes: 'Заметки', calendar: 'Календарь', analytics: 'Аналитика',
        profile: 'Профиль', settings: 'Настройки', 'project-detail': 'Проект',
        review: 'Задачи на проверку',
        'ai-decompose': 'AI Декомпозиция',
        'ai-day': 'Мой день (AI)'
    };
    document.getElementById('currentSection').textContent = titles[section] || section;

    if (section === 'dashboard') renderDashboard();
    if (section === 'projects') renderProjects();
    if (section === 'tasks') renderAllTasks();
    if (section === 'notes') renderNotes();
    if (section === 'calendar') renderCalendar();
    if (section === 'analytics') renderAnalytics();
    if (section === 'profile') renderProfile();
    if (section === 'settings') renderSettings();
    if (section === 'review') renderReviewTasks();
    if (section === 'ai-decompose') renderAiDecompose();
    if (section === 'ai-day') renderAiDay();
}

function goHome() {
    closeAllModals();
    navigate('dashboard');
    document.getElementById('sidebar')?.classList.remove('mobile-open');
}

// ===== MODALS =====
function resetTaskModalSubmitButton() {
    const btn = document.querySelector('#taskModal .btn-primary');
    if (!btn) return;
    delete btn.dataset.editing;
    btn.textContent = 'Создать';
    btn.disabled = false;
    btn.onclick = saveTask;
}

function openModal(id) {
    if (id === 'taskModal') {
        // Заполняем проекты только если вызвано напрямую (не из openTaskModalForProject)
        const projectSel = document.getElementById('taskProject');
        const alreadyHasProject = currentProjectId && projectSel.value === currentProjectId;

        if (!alreadyHasProject) {
            fillTaskProjectSelect();
            if (currentProjectId) {
                projectSel.value = currentProjectId;
            }
        }

        // Заполняем исполнителей по текущему проекту
        const projectId = projectSel.value || currentProjectId;
        fillAssigneeSelect(projectId);

        // Сбрасываем кнопку
        const btn = document.querySelector('#taskModal .btn-primary');
        if (!btn?.dataset.editing) resetTaskModalSubmitButton();
    }
    document.getElementById(id).classList.add('open');
}
function closeModal(id) {
    document.getElementById(id).classList.remove('open');
    if (id === 'projectModal') { 
        document.getElementById('projectName').value = ''; 
        document.getElementById('projectDesc').value = ''; 
        document.getElementById('projectStatus').value = 'active';
        document.getElementById('projectEmoji').value = '📁';
        document.getElementById('projectEmojiBtn').textContent = '📁';
        document.getElementById('aiModalDecomposeInput').value = '';
        const aiResult = document.getElementById('aiModalResult');
        if (aiResult) aiResult.style.display = 'none';
        window._aiModalPhases = null;
    }
    if (id === 'taskModal') { document.getElementById('taskName').value = ''; document.getElementById('taskDesc').value = ''; document.getElementById('taskStatus').value = 'todo'; document.getElementById('taskPriority').value = 'medium'; document.getElementById('taskDue').value = ''; document.getElementById('taskProject').value = ''; document.getElementById('taskAssignee').value = ''; resetTaskModalSubmitButton(); const titleEl = document.getElementById('taskModalTitle'); if (titleEl) titleEl.textContent = 'Новая задача'; }
    if (id === 'noteModal') { document.getElementById('noteTitle').value = ''; document.getElementById('noteContent').value = ''; }
    if (id === 'rejectTaskModal') rejectTaskId = null;
}

function closeAllModals() {
    document.querySelectorAll('.modal-overlay.open').forEach(modal => modal.classList.remove('open'));
}

function fillTaskProjectSelect(selectedId) {
    const sel = document.getElementById('taskProject');
    sel.innerHTML = '<option value="">— Без проекта —</option>';
    state.projects.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.title;
        if (selectedId && p.id === selectedId) opt.selected = true;
        sel.appendChild(opt);
    });
    // При смене проекта обновляем исполнителей
    sel.onchange = () => fillAssigneeSelect(sel.value);
}

function fillAssigneeSelect(projectId) {
    const sel = document.getElementById('taskAssignee');
    if (!sel) return;
    sel.innerHTML = '<option value="">— Не назначен —</option>';

    const myEmail = state.user?.email;

    // Всегда добавляем себя первым
    if (myEmail) {
        const opt = document.createElement('option');
        opt.value = myEmail;
        opt.textContent = myEmail + ' (я)';
        sel.appendChild(opt);
    }

    if (!projectId) return;
    const project = state.projects.find(p => p.id === projectId);
    if (!project || !project.members) return;

    // Добавляем участников проекта (кроме себя — уже добавлен)
    project.members.forEach(email => {
        if (email === myEmail) return;
        const opt = document.createElement('option');
        opt.value = email;
        opt.textContent = email;
        sel.appendChild(opt);
    });
}

function openTaskModalForProject(status) {
    fillTaskProjectSelect(currentProjectId);
    if (currentProjectId) {
        document.getElementById('taskProject').value = currentProjectId;
        fillAssigneeSelect(currentProjectId);
    }
    if (status) document.getElementById('taskStatus').value = status;
    // Сбрасываем кнопку на "Создать"
    resetTaskModalSubmitButton();
    const titleEl = document.getElementById('taskModalTitle');
    if (titleEl) titleEl.textContent = 'Новая задача';
    openModal('taskModal');
}

// ===== EMOJI PICKER =====
const EMOJI_LIST = [
    '📁','📂','🗂️','📋','📌','📍','🗒️','📝','✏️','🖊️',
    '💼','🎯','🚀','⭐','🌟','💡','🔥','⚡','🎨','🎭',
    '🏠','🏡','🏢','🏗️','🏋️','💪','🎮','🎵','🎬','📸',
    '🌱','🌿','🌸','🌺','🍀','🦋','🐾','🐶','🐱','🦁',
    '💰','💳','🧾','📊','📈','📉','🔑','🔒','🛡️','⚙️',
    '🚗','✈️','🚂','🚢','🏖️','🏔️','🌍','🗺️','🧭','🎒',
    '🍕','🍔','☕','🍰','🎂','🥗','🍱','🛒','🧹','🧺',
    '❤️','💙','💚','💛','🧡','💜','🖤','🤍','💯','✅',
    '📱','💻','🖥️','⌨️','🖱️','📡','🔭','🔬','💊','🩺',
    '🎓','📚','🏫','✍️','🧠','💭','🗣️','👥','🤝','🏆',
];

let _emojiTargetBtn = null;
let _emojiTargetInput = null;

function openEmojiPicker(btnId, inputId) {
    const picker = document.getElementById('emojiPickerDropdown');
    const btn = document.getElementById(btnId);

    // Закрываем если уже открыт для этой кнопки
    if (picker.style.display !== 'none' && _emojiTargetBtn === btnId) {
        picker.style.display = 'none';
        return;
    }

    _emojiTargetBtn = btnId;
    _emojiTargetInput = inputId;

    // Заполняем эмодзи
    const grid = document.getElementById('emojiPickerGrid');
    grid.innerHTML = EMOJI_LIST.map(e => `
        <button onclick="selectEmoji('${e}')" style="font-size:22px;width:32px;height:32px;border:none;background:none;cursor:pointer;border-radius:6px;transition:background 0.15s;display:flex;align-items:center;justify-content:center;"
            onmouseover="this.style.background='rgba(58,176,168,0.12)'" onmouseout="this.style.background='none'">${e}</button>
    `).join('');

    // Позиционируем под кнопкой
    const rect = btn.getBoundingClientRect();
    picker.style.display = 'block';
    let left = rect.left;
    if (left + 300 > window.innerWidth - 8) left = window.innerWidth - 308;
    picker.style.top = (rect.bottom + 6) + 'px';
    picker.style.left = left + 'px';

    // Закрываем при клике вне
    setTimeout(() => {
        document.addEventListener('click', function closePicker(e) {
            if (!picker.contains(e.target) && e.target.id !== btnId) {
                picker.style.display = 'none';
                document.removeEventListener('click', closePicker);
            }
        });
    }, 50);
}

function selectEmoji(emoji) {
    if (_emojiTargetBtn) {
        const btn = document.getElementById(_emojiTargetBtn);
        if (btn) btn.textContent = emoji;
    }
    if (_emojiTargetInput) {
        const input = document.getElementById(_emojiTargetInput);
        if (input) input.value = emoji;
    }
    document.getElementById('emojiPickerDropdown').style.display = 'none';
}

function getProjectEmoji(project) {
    return project?.emoji || '📁';
}

// ===== BUTTON LOADING STATE =====
function setBtnLoading(btn, text = 'Сохраняем...') {
    if (!btn) return;
    btn._originalHTML = btn.innerHTML;
    btn.innerHTML = `<i class="fas fa-spinner fa-spin" style="margin-right:6px;"></i>${text}`;
    btn.disabled = true;
}
function setBtnDone(btn, text, successText) {
    if (!btn) return;
    if (successText) {
        btn.innerHTML = `<i class="fas fa-check" style="margin-right:6px;"></i>${successText}`;
        btn.style.background = 'linear-gradient(135deg,#4CAF50,#388E3C)';
        setTimeout(() => {
            btn.innerHTML = btn._originalHTML || text || 'Сохранить';
            btn.style.background = '';
            btn.disabled = false;
        }, 1500);
    } else {
        btn.innerHTML = btn._originalHTML || text || 'Создать';
        btn.disabled = false;
    }
}


async function saveProject() {
    if (isSavingProject) return;
    const title = document.getElementById('projectName').value.trim();
    if (!title) { alert('Введите название проекта'); return; }

    const btn = document.querySelector('#projectModal .btn-primary');
    isSavingProject = true;
    setBtnLoading(btn, 'Создаём...');

    try {
        const result = await sbCreateProject({
            title,
            description: document.getElementById('projectDesc').value.trim(),
            status: document.getElementById('projectStatus').value,
            start_date: document.getElementById('projectStartDate').value || null,
            deadline: document.getElementById('projectDeadline').value || null,
            emoji: document.getElementById('projectEmoji')?.value || '📁',
        });

        if (!result.success) { setBtnDone(btn, 'Создать проект'); alert('Ошибка: ' + result.error); return; }

        if (!state.projects.some(p => p.id === result.project.id)) {
            state.projects.unshift({ ...result.project, members: result.project.members || [] });
        }

        const phases = Array.isArray(window._aiModalPhases) ? window._aiModalPhases : [];
        let created = 0;
        if (phases.length) {
            setBtnLoading(btn, 'Создаём задачи...');
            for (const phase of phases) {
                for (const taskTitle of phase.tasks) {
                    const task = typeof taskTitle === 'string' ? { title: taskTitle, priority: 'medium' } : taskTitle;
                    const r = await sbCreateTask({
                        title: task.title,
                        description: `Этап: ${phase.name}`,
                        status: 'todo',
                        priority: task.priority || 'medium',
                        project_id: result.project.id,
                    });
                    if (r.success) { state.tasks.unshift(r.task); created++; }
                }
            }
        }

        window._aiModalPhases = null;
        closeModal('projectModal');
        ['projectName','projectDesc','projectStartDate','projectDeadline'].forEach(id => document.getElementById(id).value = '');
        document.getElementById('projectStatus').value = 'active';
        const aiInput = document.getElementById('aiModalDecomposeInput');
        if (aiInput) aiInput.value = '';
        const aiResult = document.getElementById('aiModalResult');
        if (aiResult) aiResult.style.display = 'none';

        updateBadges();
        if (document.getElementById('projects-section').classList.contains('active')) renderProjects();
        if (document.getElementById('dashboard-section').classList.contains('active')) renderDashboard();
        showPersNotif('success', created ? `Проект создан! AI добавил ${created} задач` : 'Проект создан! Теперь добавьте задачи');
    } finally {
        isSavingProject = false;
        btn.textContent = 'Создать проект';
        btn.disabled = false;
    }
}

function renderProjects() {
    const grid = document.getElementById('projectsGrid');
    if (!state.projects.length) {
        grid.innerHTML = '<div class="empty-state"><i class="fas fa-folder-open"></i><h3>Нет проектов</h3><p>Создайте первый проект</p></div>';
        return;
    }
    grid.innerHTML = '';
    state.projects.forEach(p => {
        const tasks = state.tasks.filter(t => t.project_id === p.id);
        const done = tasks.filter(t => t.status === 'done').length;
        const progress = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
        const members = p.members || [];
        const isOwner = p.owner_id === state.user?.id;
        const projectEmoji = getProjectEmoji(p);

        // Бейдж роли
        const roleBadge = isOwner
            ? `<span style="display:inline-flex;align-items:center;gap:4px;background:rgba(58,176,168,0.12);color:var(--primary);border-radius:20px;padding:3px 10px;font-size:11px;font-weight:700;"><i class="fas fa-crown" style="font-size:9px;"></i>Мой проект</span>`
            : `<span style="display:inline-flex;align-items:center;gap:4px;background:rgba(167,139,250,0.12);color:#7C3AED;border-radius:20px;padding:3px 10px;font-size:11px;font-weight:700;"><i class="fas fa-users" style="font-size:9px;"></i>Участник</span>`;

        // Создатель (для чужих проектов)
        let creatorHtml = '';
        if (!isOwner) {
            const ownerName = getProfileName(p.owner_id) || 'Создатель';
            const ownerAvatar = getProfileAvatar(p.owner_id);
            const avatarEl = ownerAvatar
                ? `<img src="${ownerAvatar}" style="width:16px;height:16px;border-radius:50%;object-fit:cover;">`
                : `<i class="fas fa-user-tie" style="font-size:10px;"></i>`;
            creatorHtml = `<span class="project-card-meta-item"><span style="display:inline-flex;align-items:center;gap:4px;">${avatarEl}Создал: ${ownerName}</span></span>`;
        }

        // Проверяем дедлайн
        let deadlineHtml = '';
        if (p.deadline) {
            const daysLeft = Math.ceil((new Date(p.deadline) - new Date()) / (1000*60*60*24));
            const isNear = daysLeft <= 3 && daysLeft >= 0;
            const isOver = daysLeft < 0;
            const deadlineClass = (isNear || isOver) ? 'deadline-near' : '';
            const icon = isOver ? 'fa-exclamation-circle' : 'fa-flag';
            const text = isOver ? `Просрочен (${Math.abs(daysLeft)}д)` : (isNear ? `${daysLeft}д до дедлайна` : formatDate(p.deadline));
            deadlineHtml = `<span class="project-card-meta-item ${deadlineClass}"><i class="fas ${icon}"></i>${text}</span>`;
        }

        // Участники
        const membersHtml = members.length
            ? members.slice(0,4).map(m => `<div class="member-avatar" title="${m}">${m[0].toUpperCase()}</div>`).join('')
              + (members.length > 4 ? `<div class="member-avatar more">+${members.length-4}</div>` : '')
            : `<span style="font-size:12px;color:var(--text-secondary);">Нет участников</span>`;

        // Кнопки редактирования — только для владельца
        const actionBtns = isOwner ? `
            <div class="project-card-actions">
                <button class="project-card-action-btn" title="Редактировать" onclick="event.stopPropagation();openEditProjectModal('${p.id}')"><i class="fas fa-edit"></i></button>
                <button class="project-card-action-btn danger" title="Удалить" onclick="event.stopPropagation();deleteProjectDirect('${p.id}')"><i class="fas fa-trash"></i></button>
            </div>` : '';

        const card = document.createElement('div');
        card.className = 'project-card';
        card.innerHTML = `
            <div class="project-card-header">
                <div class="project-card-emoji" title="Эмодзи проекта">${projectEmoji}</div>
                <div style="display:flex;flex-direction:column;gap:6px;flex:1;min-width:0;">
                    <div class="project-card-title">${p.title}</div>
                    ${roleBadge}
                </div>
                ${actionBtns}
            </div>
            <div class="project-card-desc">${p.description || 'Нет описания'}</div>
            <div class="project-card-meta">
                ${creatorHtml}
                ${p.start_date ? `<span class="project-card-meta-item"><i class="fas fa-play"></i>${formatDate(p.start_date)}</span>` : ''}
                ${deadlineHtml}
                <span class="project-card-meta-item"><i class="fas fa-tasks"></i>${tasks.length} задач</span>
            </div>
            <div class="project-members" style="margin-bottom:12px;">${membersHtml}</div>
            ${buildSegmentProgress(progress)}
            <div class="project-card-footer" style="margin-top:12px;">
                <span class="project-status ${p.status}">${statusLabel(p.status)}</span>
                <span style="font-size:12px;font-weight:700;color:var(--primary);">${progress}%</span>
            </div>`;
        card.addEventListener('click', () => showProjectDetailModal(p.id));
        grid.appendChild(card);
    });
}

function buildSegmentProgress(progress) {
    const total = 12;
    const filled = Math.round((progress / 100) * total);
    let segs = '';
    for (let i = 0; i < total; i++) {
        const cls = i < filled ? 'filled' : 'empty';
        segs += `<div class="segment ${cls}"></div>`;
    }
    return `<div class="segment-progress">${segs}</div>`;
}

function showProjectDetailModal(id) {
    currentProjectId = id;
    window.currentProjectId = id;
    const p = state.projects.find(x => x.id === id);
    if (!p) return;
    const tasks = state.tasks.filter(t => t.project_id === id);
    const done = tasks.filter(t => t.status === 'done').length;
    const progress = tasks.length ? Math.round((done / tasks.length) * 100) : 0;

    document.getElementById('pdTitle').textContent = `${getProjectEmoji(p)} ${p.title}`;
    document.getElementById('pdDesc').textContent = p.description || 'Нет описания';
    document.getElementById('pdStatus').className = `project-status ${p.status}`;
    document.getElementById('pdStatus').textContent = statusLabel(p.status);
    document.getElementById('pdDate').textContent = 'Создан: ' + formatDate(p.createdAt);
    document.getElementById('pdTaskCount').textContent = tasks.length;
    document.getElementById('pdProgressPct').textContent = progress + '%';

    // Дедлайн
    const dlWrap = document.getElementById('pdDeadlineWrap');
    if (p.deadline) {
        document.getElementById('pdDeadline').textContent = 'Дедлайн: ' + formatDate(p.deadline);
        dlWrap.style.display = '';
    } else {
        dlWrap.style.display = 'none';
    }

    // Участники
    const members = p.members || [];
    const membersEl = document.getElementById('pdMembers');
    if (members.length) {
        membersEl.innerHTML = members.map(m =>
            `<span class="modal-member-chip"><i class="fas fa-user"></i>${m}</span>`
        ).join('');
    } else {
        membersEl.innerHTML = '<span style="font-size:13px;color:var(--text-secondary);">Нет участников</span>';
    }

    // Сегментный прогресс
    document.getElementById('pdSegments').innerHTML = buildSegmentProgress(progress).replace('<div class="segment-progress">', '').replace('</div>', '');
    document.getElementById('pdSegments').innerHTML = '';
    const total = 12;
    const filled = Math.round((progress / 100) * total);
    for (let i = 0; i < total; i++) {
        const seg = document.createElement('div');
        seg.className = `segment ${i < filled ? 'filled' : 'empty'}`;
        document.getElementById('pdSegments').appendChild(seg);
    }

    openModal('projectDetailModal');
}

function openEditProjectModal(id) {
    closeModal('projectDetailModal');
    currentProjectId = id;
    window.currentProjectId = id;
    const p = state.projects.find(x => x.id === id);
    if (!p) return;
    document.getElementById('editProjectName').value = p.title;
    document.getElementById('editProjectDesc').value = p.description || '';
    document.getElementById('editProjectStart').value = p.start_date || '';
    document.getElementById('editProjectDeadline').value = p.deadline || '';
    document.getElementById('editProjectStatus').value = p.status;
    document.getElementById('editProjectEmoji').value = getProjectEmoji(p);
    document.getElementById('editProjectEmojiBtn').textContent = getProjectEmoji(p);

    // Показываем участников
    renderEditMembersList(p.members || []);
    document.getElementById('editMemberEmail').value = '';
    document.getElementById('editMemberStatus').style.display = 'none';

    openModal('editProjectModal');
}

function renderEditMembersList(members) {
    const list = document.getElementById('editProjectMembersList');
    if (!members.length) {
        list.innerHTML = '<span style="font-size:12px;color:var(--text-secondary);">Нет участников</span>';
        return;
    }
    list.innerHTML = members.map(m => `
        <span style="display:inline-flex;align-items:center;gap:6px;background:rgba(58,176,168,0.12);color:var(--primary);border-radius:20px;padding:4px 10px;font-size:12px;font-weight:600;">
            <i class="fas fa-user"></i>${m}
            <button onclick="removeMemberFromProject('${m}')" style="background:none;border:none;cursor:pointer;color:var(--text-secondary);padding:0;margin-left:2px;font-size:11px;">✕</button>
        </span>
    `).join('');
}

async function addMemberToProject() {
    const email = document.getElementById('editMemberEmail').value.trim();
    const statusEl = document.getElementById('editMemberStatus');

    if (!email) return;

    statusEl.textContent = 'Проверяем...';
    statusEl.style.display = 'block';
    statusEl.style.color = 'var(--text-secondary)';
    statusEl.style.background = 'rgba(58,176,168,0.1)';

    const check = await checkUserByEmail(email);

    if (!check.exists) {
        statusEl.textContent = '❌ Пользователь с таким email не найден в Nikomi';
        statusEl.style.color = '#c62828';
        statusEl.style.background = 'rgba(229,115,115,0.1)';
        return;
    }

    const p = state.projects.find(x => x.id === currentProjectId);
    if (!p) return;
    if (!p.members) p.members = [];
    if (p.members.includes(email)) {
        statusEl.textContent = '⚠️ Этот участник уже добавлен';
        statusEl.style.color = '#b8860b';
        statusEl.style.background = 'rgba(248,201,93,0.15)';
        return;
    }

    // Добавляем и сразу сохраняем в БД
    p.members.push(email);
    const result = await sbUpdateProject(p.id, { members: p.members });

    if (!result.success) {
        p.members.pop(); // откатываем
        statusEl.textContent = '❌ Ошибка сохранения: ' + result.error;
        statusEl.style.color = '#c62828';
        statusEl.style.background = 'rgba(229,115,115,0.1)';
        return;
    }

    renderEditMembersList(p.members);
    document.getElementById('editMemberEmail').value = '';
    statusEl.textContent = `✅ ${check.user.name || email} добавлен в проект!`;
    statusEl.style.color = '#2e7d32';
    statusEl.style.background = 'rgba(76,175,80,0.1)';
    showPersNotif('success', `${check.user.name || email} добавлен в проект! 👥`);
    setTimeout(() => statusEl.style.display = 'none', 3000);
}

function removeMemberFromProject(email) {
    const p = state.projects.find(x => x.id === currentProjectId);
    if (!p) return;
    p.members = (p.members || []).filter(m => m !== email);
    renderEditMembersList(p.members);
}

async function saveEditProject() {
    const p = state.projects.find(x => x.id === currentProjectId);
    if (!p) return;
    const title = document.getElementById('editProjectName').value.trim();
    if (!title) { alert('Введите название'); return; }

    const btn = document.getElementById('saveEditProjectBtn');
    setBtnLoading(btn, 'Сохраняем...');

    const updates = {
        title,
        description: document.getElementById('editProjectDesc').value.trim(),
        start_date: document.getElementById('editProjectStart').value || null,
        deadline: document.getElementById('editProjectDeadline').value || null,
        status: document.getElementById('editProjectStatus').value,
        emoji: document.getElementById('editProjectEmoji')?.value || '📁',
        members: p.members || []  // сохраняем участников в БД
    };

    const result = await sbUpdateProject(p.id, updates);

    if (!result.success) {
        setBtnDone(btn, 'Сохранить');
        alert('Ошибка: ' + result.error);
        return;
    }

    Object.assign(p, updates);
    setBtnDone(btn, 'Сохранить', 'Сохранено');
    setTimeout(() => {
        closeModal('editProjectModal');
        renderProjects();
        showPersNotif('info', 'Проект обновлён! ✏️');
    }, 1500);
}

async function deleteProjectDirect(id) {
    if (!confirm('Удалить проект? Все задачи тоже будут удалены.')) return;
    const result = await sbDeleteProject(id);
    if (!result.success) { alert('Ошибка: ' + result.error); return; }
    state.projects = state.projects.filter(p => p.id !== id);
    state.tasks = state.tasks.filter(t => t.project_id !== id);
    updateBadges();
    renderProjects();
    if (document.getElementById('dashboard-section').classList.contains('active')) renderDashboard();
    showPersNotif('warning', 'Проект удалён 🗑️');
}

async function deleteProject(id) {
    if (!confirm('Удалить проект? Все задачи проекта тоже будут удалены.')) return;
    const result = await sbDeleteProject(id);
    if (!result.success) { alert('Ошибка: ' + result.error); return; }
    state.projects = state.projects.filter(p => p.id !== id);
    state.tasks = state.tasks.filter(t => t.project_id !== id);
    closeModal('projectDetailModal');
    updateBadges();
    navigate('projects');
    showPersNotif('warning', 'Проект удалён 🗑️');
}

function openProjectDetail(id) {
    closeModal('projectDetailModal');
    currentProjectId = id;
    window.currentProjectId = id;
    const p = state.projects.find(x => x.id === id);
    if (!p) return;
    document.getElementById('detailProjectTitle').textContent = `${getProjectEmoji(p)} ${p.title}`;
    document.getElementById('detailProjectDesc').textContent = p.description || '';
    document.getElementById('detailProjectStatus').className = `project-status ${p.status}`;
    document.getElementById('detailProjectStatus').textContent = statusLabel(p.status);

    const isOwner = p.owner_id === state.user?.id;

    // Показываем создателя если это не мой проект
    const dateEl = document.getElementById('detailProjectDate');
    if (isOwner) {
        dateEl.textContent = 'Создан: ' + formatDate(p.created_at || p.createdAt);
    } else {
        const ownerName = getProfileName(p.owner_id) || 'другой пользователь';
        dateEl.innerHTML = `Создан: ${formatDate(p.created_at || p.createdAt)} &nbsp;·&nbsp; <span style="color:var(--primary);font-weight:600;"><i class="fas fa-crown" style="font-size:10px;margin-right:3px;"></i>Создатель: ${ownerName}</span>`;
    }

    // Кнопка "Добавить задачу" — только для владельца
    const addTaskBtn = document.querySelector('#project-detail-section .section-header .btn-primary');
    if (addTaskBtn) addTaskBtn.style.display = isOwner ? 'inline-flex' : 'none';

    // Кнопка "Пригласить" — только для владельца
    const inviteBtn = document.getElementById('inviteBtn');
    if (inviteBtn) inviteBtn.style.display = isOwner ? 'inline-flex' : 'none';

    renderKanban(id);
    navigate('project-detail');

    // Кнопки "+ Добавить" в колонках — только для владельца (после рендера)
    setTimeout(() => {
        document.querySelectorAll('.kanban-add-btn').forEach(btn => {
            btn.style.display = isOwner ? 'block' : 'none';
        });
    }, 50);
}

// ===== TASKS =====
async function saveTask() {
    const title = document.getElementById('taskName').value.trim();
    if (!title) { alert('Введите название задачи'); return; }

    const btn = document.querySelector('#taskModal .btn-primary');
    setBtnLoading(btn, 'Создаём...');

    const assigneeVal = document.getElementById('taskAssignee')?.value?.trim() || null;

    const taskData = {
        title,
        description: document.getElementById('taskDesc').value.trim(),
        status: document.getElementById('taskStatus').value,
        priority: document.getElementById('taskPriority').value,
        due_date: document.getElementById('taskDue').value || null,
        project_id: document.getElementById('taskProject').value || null,
        assignee: assigneeVal,
    };

    const result = await sbCreateTask(taskData);

    setBtnDone(btn, 'Создать');

    if (!result.success) { 
        console.error('saveTask error:', result.error);
        alert('Ошибка сохранения задачи:\n' + result.error); 
        return; 
    }

    state.tasks.unshift(result.task);
    closeModal('taskModal');
    updateBadges();
    if (currentProjectId && result.task.project_id === currentProjectId) renderKanban(currentProjectId);
    if (document.getElementById('tasks-section').classList.contains('active')) renderAllTasks();
    if (document.getElementById('dashboard-section').classList.contains('active')) renderDashboard();
}

function renderKanban(projectId) {
    const statuses = ['todo', 'inprogress', 'review', 'done'];
    statuses.forEach(s => {
        const container = document.getElementById(`cards-${s}`);
        if (!container) return;
        const tasks = state.tasks.filter(t => t.project_id === projectId && t.status === s);
        const countEl = document.getElementById(`count-${s}`);
        if (countEl) countEl.textContent = tasks.length;
        container.innerHTML = '';
        // Сортировка по приоритету
        const prioOrder = { high: 0, medium: 1, low: 2 };
        tasks.sort((a, b) => (prioOrder[a.priority] || 1) - (prioOrder[b.priority] || 1));
        tasks.forEach(t => container.appendChild(createTaskCard(t, true)));
        setupDropZone(container, s, projectId);
    });
}

// ===== TEAM PROJECTS IN SIDEBAR =====
function updateTeamProjectsSidebar() {
    const myId = state.user?.id;
    const myEmail = state.user?.email;

    // Проекты где я участник (не владелец)
    const teamProjects = state.projects.filter(p =>
        p.owner_id !== myId &&
        p.members && p.members.includes(myEmail)
    );

    const navSection = document.getElementById('teamProjectsNav');
    const list = document.getElementById('teamProjectsList');
    if (!navSection || !list) return;

    if (teamProjects.length > 0) {
        navSection.style.display = 'block';
        list.innerHTML = teamProjects.map(p => `
            <li class="nav-item">
                <a href="#" class="nav-link team-project-nav-item" onclick="openProjectDetail('${p.id}')">
                    <span class="nav-icon project-nav-emoji">${getProjectEmoji(p)}</span>
                    <span class="nav-text">${p.title}</span>
                </a>
            </li>
        `).join('');
    } else {
        navSection.style.display = 'none';
    }

    // Показываем раздел "На проверку" для владельцев проектов
    const myProjects = state.projects.filter(p => p.owner_id === myId);
    const reviewSection = document.getElementById('reviewNavSection');
    if (reviewSection) {
        reviewSection.style.display = myProjects.length > 0 ? 'block' : 'none';
    }
    updateReviewBadge();
}

function updateReviewBadge() {
    const myId = state.user?.id;
    const myProjects = state.projects.filter(p => p.owner_id === myId).map(p => p.id);
    const reviewCount = state.tasks.filter(t =>
        t.status === 'review' && myProjects.includes(t.project_id)
    ).length;
    const badge = document.getElementById('reviewBadge');
    if (badge) {
        badge.textContent = reviewCount;
        badge.style.display = reviewCount > 0 ? 'inline-block' : 'none';
    }
}

function getTaskProject(task) {
    return state.projects.find(p => p.id === task?.project_id);
}

function isProjectOwnerForTask(task) {
    const project = getTaskProject(task);
    return project?.owner_id === state.user?.id;
}

function isAssignedToMe(task) {
    return task?.assignee === state.user?.email;
}

function canSendTaskToReview(task) {
    const project = getTaskProject(task);
    return Boolean(project && !isProjectOwnerForTask(task) && isAssignedToMe(task) && ['todo', 'inprogress'].includes(task.status));
}

function canChangeTaskStatus(task, status) {
    const myId = state.user?.id;
    const myEmail = state.user?.email;
    const project = getTaskProject(task);

    // Владелец задачи — полные права
    if (task?.owner_id === myId) return true;

    // Владелец проекта — полные права
    if (project?.owner_id === myId) return true;

    // Нет проекта — только владелец задачи (уже проверили)
    if (!project) return false;

    // Участник проекта — может двигать задачи кроме "Сделано"
    const isProjectMember = project.members && project.members.includes(myEmail);
    const isAssigned = task?.assignee === myEmail;

    if (!isProjectMember && !isAssigned) return false;

    // Участник не может сам ставить "Сделано" — только через проверку
    if (status === 'done') return false;

    // Участник может отправить на проверку только назначенную ему задачу
    if (status === 'review') return isAssigned || isProjectMember;

    // todo/inprogress — любой участник проекта
    return true;
}

function canSeeReviewNote(task) {
    return Boolean(task?.review_note && task.status === 'inprogress' && isAssignedToMe(task));
}

async function updateTaskAndLocal(task, updates) {
    const result = await sbUpdateTask(task.id, updates);
    if (!result.success) {
        console.error('updateTask error:', result.error, 'task:', task.id, 'updates:', updates);
        alert('Ошибка сохранения: ' + result.error);
        return false;
    }
    Object.assign(task, updates);
    return true;
}

function scheduleWorkspaceRefresh() {
    clearTimeout(refreshTimer);
    // 2 секунды задержки — даём время локальному рендеру отработать, не мигаем
    refreshTimer = setTimeout(() => {
        if (!draggedTaskId) refreshWorkspaceData();
    }, 2000);
}

async function refreshWorkspaceData() {
    if (!state.user || document.hidden) return;
    if (draggedTaskId) return;

    const [projects, tasks, notes, profiles] = await Promise.all([
        getProjects(),
        getTasks(),
        getNotes(),
        getAllProfiles()
    ]);

    state.projects = projects || [];
    state.tasks = tasks || [];
    state.notes = notes || [];
    state.profiles = profiles || [];

    updateBadges();
    const activeSection = document.querySelector('.content-section.active')?.id;
    if (activeSection === 'dashboard-section') renderDashboard();
    if (activeSection === 'projects-section') renderProjects();
    if (activeSection === 'tasks-section') renderAllTasks();
    if (activeSection === 'notes-section') renderNotes();
    if (activeSection === 'calendar-section') renderCalendar();
    if (activeSection === 'analytics-section') renderAnalytics();
    if (activeSection === 'review-section') renderReviewTasks();
    if (currentProjectId && activeSection === 'project-detail-section') renderKanban(currentProjectId);
}

function setupRealtimeRefresh() {
    // Подписываемся только на projects и notes — tasks обновляем только вручную
    supabase
        .channel('workspace-live-refresh')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'projects' }, scheduleWorkspaceRefresh)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'notes' }, scheduleWorkspaceRefresh)
        .subscribe();

    // Realtime для комментариев — мгновенное обновление
    supabase
        .channel('comments-live')
        .on('postgres_changes', {
            event: 'INSERT',
            schema: 'public',
            table: 'task_comments'
        }, (payload) => {
            const newComment = payload.new;
            // Если открыт модал этой задачи — обновляем комментарии
            const modal = document.getElementById('taskDetailModal');
            if (modal?.classList.contains('open') && window.currentTaskId === newComment.task_id) {
                // Не перезагружаем если это наш собственный комментарий (уже добавлен)
                if (newComment.author_id !== state.user?.id) {
                    loadTaskComments(newComment.task_id);
                    // Показываем уведомление
                    const profile = state.profiles?.find(p => p.id === newComment.author_id);
                    const name = profile?.name || profile?.email?.split('@')[0] || 'Кто-то';
                    showPersNotif('info', `${name} написал комментарий 💬`);
                }
            }
        })
        .on('postgres_changes', {
            event: 'DELETE',
            schema: 'public',
            table: 'task_comments'
        }, (payload) => {
            const modal = document.getElementById('taskDetailModal');
            if (modal?.classList.contains('open') && window.currentTaskId) {
                loadTaskComments(window.currentTaskId);
            }
        })
        .subscribe();

    // Фоновый рефреш каждые 60 секунд
    setInterval(() => {
        if (!document.hidden && !draggedTaskId) refreshWorkspaceData();
    }, 60000);
}

// ===== SEND TO REVIEW =====
async function sendToReview(taskId) {
    const task = state.tasks.find(t => t.id === taskId);
    if (!task) return;
    if (!canSendTaskToReview(task)) {
        alert('Эту задачу может отправить на проверку только назначенный исполнитель.');
        return;
    }

    const ok = await updateTaskAndLocal(task, {
        status: 'review',
        review_requested_at: new Date().toISOString()
    });
    if (!ok) return;

    closeModal('taskDetailModal');
    updateBadges();
    updateReviewBadge();

    // Обновляем все виды
    if (currentProjectId) renderKanban(currentProjectId);
    if (document.getElementById('tasks-section').classList.contains('active')) renderAllTasks();
    if (document.getElementById('dashboard-section').classList.contains('active')) renderDashboard();

    showPersNotif('info', 'Задача отправлена на проверку модератору! 📋');
}

// ===== REVIEW TASKS (для модераторов) =====
function renderReviewTasks() {
    const myId = state.user?.id;
    const myProjects = state.projects.filter(p => p.owner_id === myId);
    const myProjectIds = myProjects.map(p => p.id);

    const reviewTasks = state.tasks.filter(t =>
        t.status === 'review' && myProjectIds.includes(t.project_id)
    );

    const container = document.getElementById('reviewTasksList');
    if (!container) return;

    if (!reviewTasks.length) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-clipboard-check"></i>
                <h3>Нет задач на проверку</h3>
                <p>Когда участники отправят задачи на проверку — они появятся здесь</p>
            </div>`;
        return;
    }

    container.innerHTML = reviewTasks.map(task => {
        const project = state.projects.find(p => p.id === task.project_id);
        return `
        <div class="review-task-card">
            <div class="review-task-info">
                <div class="review-task-title">${escapeHtml(task.title)}</div>
                ${task.description ? `<div class="review-task-desc">${escapeHtml(task.description)}</div>` : ''}
                <div class="review-task-meta">
                    ${project ? `<span class="task-project-label"><i class="fas fa-folder" style="margin-right:3px;font-size:9px;"></i>${escapeHtml(project.title)}</span>` : ''}
                    <span class="task-priority-badge ${task.priority}">${priorityLabel(task.priority)}</span>
                    ${task.assignee ? `<span style="font-size:12px;color:var(--text-secondary);"><i class="fas fa-user" style="margin-right:3px;"></i>${escapeHtml(task.assignee)}</span>` : ''}
                    ${task.due_date ? `<span class="task-due"><i class="fas fa-clock" style="margin-right:3px;"></i>${formatDate(task.due_date)}</span>` : ''}
                </div>
            </div>
            <div class="review-task-actions">
                <button class="btn-primary" style="padding:8px 14px;font-size:12px;" onclick="approveTask('${task.id}')">
                    <i class="fas fa-check"></i> Принять
                </button>
                <button class="btn-secondary-outline" style="padding:8px 14px;font-size:12px;" onclick="rejectTask('${task.id}')">
                    <i class="fas fa-undo"></i> Вернуть
                </button>
                <button class="btn-secondary-outline" style="padding:8px 14px;font-size:12px;" onclick="showTaskDetail('${task.id}')">
                    <i class="fas fa-eye"></i>
                </button>
            </div>
        </div>`;
    }).join('');
}

async function approveTask(taskId) {
    const task = state.tasks.find(t => t.id === taskId);
    if (!task) return;
    if (!isProjectOwnerForTask(task)) return;
    const ok = await updateTaskAndLocal(task, {
        status: 'done',
        review_note: null,
        reviewed_at: new Date().toISOString()
    });
    if (!ok) return;
    updateBadges();
    updateReviewBadge();
    renderReviewTasks();
    if (currentProjectId && task.project_id === currentProjectId) renderKanban(currentProjectId);
    if (document.getElementById('tasks-section').classList.contains('active')) renderAllTasks();
    showPersNotif('taskDone', 'Задача принята и отмечена выполненной! ✅');
}

async function rejectTask(taskId) {
    openRejectTaskModal(taskId);
}

function openRejectTaskModal(taskId) {
    const task = state.tasks.find(t => t.id === taskId);
    if (!task) return;
    if (!isProjectOwnerForTask(task)) return;
    rejectTaskId = taskId;
    const title = document.getElementById('rejectTaskTitle');
    const note = document.getElementById('rejectTaskNote');
    const error = document.getElementById('rejectTaskNoteError');
    if (title) title.textContent = task.title;
    if (note) {
        note.value = '';
        setTimeout(() => note.focus(), 80);
    }
    if (error) error.textContent = '';
    openModal('rejectTaskModal');
}

function closeRejectTaskModal() {
    rejectTaskId = null;
    closeModal('rejectTaskModal');
}

async function submitRejectTask() {
    const task = state.tasks.find(t => t.id === rejectTaskId);
    if (!task) return;
    const noteEl = document.getElementById('rejectTaskNote');
    const errorEl = document.getElementById('rejectTaskNoteError');
    const btn = document.querySelector('#rejectTaskModal .review-note-submit');
    const trimmedNote = noteEl?.value.trim() || '';
    if (!trimmedNote) {
        if (errorEl) errorEl.textContent = 'Напишите короткую заметку, что нужно исправить.';
        noteEl?.focus();
        return;
    }
    if (errorEl) errorEl.textContent = '';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Возвращаем...';
    }
    const ok = await updateTaskAndLocal(task, {
        status: 'inprogress',
        review_note: trimmedNote,
        review_rejected_at: new Date().toISOString()
    });
    if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-rotate-left"></i> Вернуть';
    }
    if (!ok) return;
    closeRejectTaskModal();
    updateBadges();
    updateReviewBadge();
    renderReviewTasks();
    if (currentProjectId && task.project_id === currentProjectId) renderKanban(currentProjectId);
    if (document.getElementById('tasks-section').classList.contains('active')) renderAllTasks();
    showPersNotif('warning', 'Задача возвращена на доработку 🔄');
}
let taskFilters = { priority: 'all', project: 'all', stat: 'all' };

function setTaskFilter(type, value, btn) {
    taskFilters[type] = value;
    // Обновляем активную кнопку в группе
    const group = btn.closest('.filter-group');
    if (group) group.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderAllTasks();
}

function setTaskStatFilter(value) {
    taskFilters.stat = value;
    renderAllTasks();
}

function taskMatchesStatFilter(task, stat, today, weekEnd) {
    const todayIso = formatDateISO(today);
    const weekEndIso = formatDateISO(weekEnd);
    if (stat === 'all') return true;
    if (stat === 'inprogress') return task.status === 'inprogress';
    if (stat === 'doneToday') {
        if (task.status !== 'done') return false;
        const d = new Date(task.updated_at || task.created_at);
        d.setHours(0,0,0,0);
        return d.getTime() === today.getTime();
    }
    if (stat === 'dueToday') {
        if (!task.due_date || task.status === 'done') return false;
        return task.due_date === todayIso;
    }
    if (stat === 'dueWeek') {
        if (!task.due_date || task.status === 'done') return false;
        return task.due_date >= todayIso && task.due_date <= weekEndIso;
    }
    return true;
}

function taskStatFilterLabel(stat) {
    return {
        all: 'Все задачи',
        inprogress: 'В работе',
        doneToday: 'Сегодня готово',
        dueToday: 'На сегодня',
        dueWeek: 'На неделю'
    }[stat] || 'Все задачи';
}

function renderTaskActiveFilterSummary(count) {
    const el = document.getElementById('tasksActiveFilter');
    if (!el) return;
    if (taskFilters.stat === 'all') {
        el.style.display = 'none';
        el.innerHTML = '';
        return;
    }
    el.style.display = 'flex';
    el.innerHTML = `
        <span><i class="fas fa-filter"></i> Показаны задачи: <strong>${taskStatFilterLabel(taskFilters.stat)}</strong> · ${count}</span>
        <button type="button" onclick="setTaskStatFilter('all')"><i class="fas fa-times"></i> Сбросить</button>
    `;
}

function renderTasksStats() {
    const myEmail = state.user?.email;
    const myTasks = state.tasks.filter(t => t.owner_id === state.user?.id || t.assignee === myEmail);
    const today = new Date(); today.setHours(0,0,0,0);
    const weekEnd = new Date(today); weekEnd.setDate(weekEnd.getDate() + 7);
    const todayIso = formatDateISO(today);
    const weekEndIso = formatDateISO(weekEnd);

    const total = myTasks.length;
    const inWork = myTasks.filter(t => t.status === 'inprogress').length;
    const doneToday = myTasks.filter(t => {
        if (t.status !== 'done') return false;
        const d = new Date(t.updated_at || t.created_at);
        d.setHours(0,0,0,0);
        return d.getTime() === today.getTime();
    }).length;
    const dueToday = myTasks.filter(t => {
        if (!t.due_date || t.status === 'done') return false;
        return t.due_date === todayIso;
    }).length;
    const dueWeek = myTasks.filter(t => {
        if (!t.due_date || t.status === 'done') return false;
        return t.due_date >= todayIso && t.due_date <= weekEndIso;
    }).length;

    document.getElementById('tasksStats').innerHTML = `
        <button type="button" class="tasks-stat-chip ${taskFilters.stat === 'all' ? 'active' : ''}" onclick="setTaskStatFilter('all')"><i class="fas fa-list"></i> Всего: ${total}</button>
        <button type="button" class="tasks-stat-chip ${taskFilters.stat === 'inprogress' ? 'active' : ''}" onclick="setTaskStatFilter('inprogress')"><i class="fas fa-bolt" style="color:#F8C95D"></i> В работе: ${inWork}</button>
        <button type="button" class="tasks-stat-chip ${taskFilters.stat === 'doneToday' ? 'active' : ''}" onclick="setTaskStatFilter('doneToday')"><i class="fas fa-check" style="color:#4CAF50"></i> Сегодня готово: ${doneToday}</button>
        <button type="button" class="tasks-stat-chip ${taskFilters.stat === 'dueToday' ? 'active' : ''}" onclick="setTaskStatFilter('dueToday')"><i class="fas fa-calendar-day" style="color:#60B4F0"></i> На сегодня: ${dueToday}</button>
        <button type="button" class="tasks-stat-chip ${taskFilters.stat === 'dueWeek' ? 'active' : ''}" onclick="setTaskStatFilter('dueWeek')"><i class="fas fa-calendar-week" style="color:#A78BFA"></i> На неделю: ${dueWeek}</button>
    `;
}

function renderProjectFilterBtns() {
    const container = document.getElementById('projectFilterBtns');
    if (!container) return;
    container.innerHTML = state.projects.map(p => `
        <button class="filter-btn ${taskFilters.project === p.id ? 'active' : ''}" data-project="${p.id}" onclick="setTaskFilter('project','${p.id}',this)">
            <span class="filter-project-emoji">${getProjectEmoji(p)}</span>${p.title}
        </button>
    `).join('');
    const allProjectBtn = document.querySelector('.filter-btn[data-project="all"]');
    if (allProjectBtn) allProjectBtn.classList.toggle('active', taskFilters.project === 'all');
}

function renderAllTasks() {
    renderTasksStats();
    renderProjectFilterBtns();

    const myEmail = state.user?.email;
    const myId = state.user?.id;

    // Фильтруем задачи — только мои (созданные мной или назначенные мне)
    let tasks = state.tasks.filter(t =>
        t.owner_id === myId || t.assignee === myEmail
    );

    // Применяем фильтры
    if (taskFilters.priority !== 'all') {
        tasks = tasks.filter(t => t.priority === taskFilters.priority);
    }
    if (taskFilters.project !== 'all') {
        tasks = tasks.filter(t => t.project_id === taskFilters.project);
    }
    if (taskFilters.stat !== 'all') {
        const today = new Date(); today.setHours(0,0,0,0);
        const weekEnd = new Date(today); weekEnd.setDate(weekEnd.getDate() + 7);
        tasks = tasks.filter(t => taskMatchesStatFilter(t, taskFilters.stat, today, weekEnd));
    }
    renderTaskActiveFilterSummary(tasks.length);

    // Сортировка по приоритету
    const prioOrder = { high: 0, medium: 1, low: 2 };
    tasks.sort((a, b) => (prioOrder[a.priority] || 1) - (prioOrder[b.priority] || 1));

    const statuses = ['todo', 'inprogress', 'review', 'done'];
    statuses.forEach(s => {
        const container = document.getElementById(`all-cards-${s}`);
        const countEl = document.getElementById(`all-count-${s}`);
        if (!container) return;
        const filtered = tasks.filter(t => t.status === s);
        if (countEl) countEl.textContent = filtered.length;
        container.innerHTML = '';
        if (filtered.length) {
            filtered.forEach(t => container.appendChild(createTaskCard(t, false)));
        } else {
            container.innerHTML = '<div class="kanban-empty-small">Нет задач</div>';
        }
        setupDropZone(container, s, null);
    });
}

function createTaskCard(task, inProject) {
    const card = document.createElement('div');
    card.className = 'task-card';
    card.draggable = true;
    card.dataset.id = task.id;

    const dueText = task.due_date ? formatDate(task.due_date) : '';
    const isOverdue = task.due_date && new Date(task.due_date) < new Date() && task.status !== 'done';

    // Название проекта (показываем в общем списке задач)
    const project = state.projects.find(p => p.id === task.project_id);
    const projectLabel = (!inProject && project)
        ? `<div class="task-project-label"><span class="task-project-emoji">${getProjectEmoji(project)}</span>${project.title}</div>`
        : '';

    const reviewBtn = canSendTaskToReview(task)
        ? `<button class="review-send-btn" onclick="event.stopPropagation();sendToReview('${task.id}')" title="Отправить на проверку">
               <i class="fas fa-paper-plane"></i>
           </button>`
        : '';
    const reviewNote = canSeeReviewNote(task)
        ? `<div class="task-review-note"><i class="fas fa-comment-dots"></i>${escapeHtml(task.review_note)}</div>`
        : '';

    card.innerHTML = `
        ${projectLabel}
        <div class="task-card-title">${task.title}</div>
        ${task.description ? `<div class="task-card-desc">${task.description}</div>` : ''}
        ${reviewNote}
        <div class="task-card-footer">
            <span class="task-priority-badge ${task.priority}">${priorityLabel(task.priority)}</span>
            ${task.assignee ? `<span style="font-size:11px;color:var(--text-secondary);"><i class="fas fa-user" style="margin-right:3px;"></i>${task.assignee.split('@')[0]}</span>` : ''}
            ${dueText ? `<span class="task-due ${isOverdue ? 'overdue' : ''}"><i class="fas fa-clock" style="margin-right:3px;"></i>${dueText}</span>` : ''}
            ${reviewBtn}
        </div>`;

    card.addEventListener('dragstart', e => {
        draggedTaskId = task.id;
        card.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
    });
    card.addEventListener('dragend', () => card.classList.remove('dragging'));
    card.addEventListener('click', () => showTaskDetail(task.id));
    return card;
}

function setupDropZone(container, status, projectId) {
    container.addEventListener('dragover', e => {
        e.preventDefault();
        container.classList.add('drag-over');
    });
    container.addEventListener('dragleave', () => container.classList.remove('drag-over'));
    container.addEventListener('drop', async e => {
        e.preventDefault();
        container.classList.remove('drag-over');
        if (!draggedTaskId) return;
        const task = state.tasks.find(t => t.id === draggedTaskId);
        if (!task) return;
        if (!canChangeTaskStatus(task, status)) {
            draggedTaskId = null;
            showPersNotif('warning', status === 'done'
                ? 'Исполнитель не может сам отметить задачу готовой. Отправьте её на проверку.'
                : 'Недостаточно прав для смены этого статуса.');
            return;
        }
        const ok = await updateTaskAndLocal(task, { status });
        if (!ok) {
            draggedTaskId = null;
            return;
        }
        draggedTaskId = null;
        // Небольшая задержка чтобы realtime не перебил локальный рендер
        if (projectId) renderKanban(projectId);
        else renderAllTasks();
        updateBadges();
        if (document.getElementById('dashboard-section').classList.contains('active')) renderDashboard();
        if (status === 'done') showPersNotif('taskDone');
    });
}

function showTaskDetail(id) {
    currentTaskId = id;
    window.currentTaskId = id;
    const task = state.tasks.find(t => t.id === id);
    if (!task) return;

    document.getElementById('taskDetailTitle').textContent = task.title;
    document.getElementById('taskDetailDesc').innerHTML =
        `${escapeHtml(task.description || 'Нет описания')}${
            canSeeReviewNote(task)
                ? `<span class="task-detail-review-note"><i class="fas fa-comment-dots"></i><strong>Доработать:</strong> ${escapeHtml(task.review_note)}</span>`
                : ''
        }`;

    const statusEl = document.getElementById('taskDetailStatus');
    statusEl.className = `task-status-badge ${task.status}`;
    statusEl.textContent = taskStatusLabel(task.status);

    const prioEl = document.getElementById('taskDetailPriority');
    prioEl.className = `task-priority-badge ${task.priority}`;
    prioEl.textContent = priorityLabel(task.priority);

    document.getElementById('taskDetailDue').textContent = task.due_date ? 'Срок: ' + formatDate(task.due_date) : '';

    // Показываем/скрываем кнопку "Отправить на проверку"
    const project = getTaskProject(task);
    const isOwner = isProjectOwnerForTask(task);
    const canSendReview = canSendTaskToReview(task);

    const reviewBtnEl = document.getElementById('taskDetailReviewBtn');
    if (reviewBtnEl) {
        reviewBtnEl.style.display = canSendReview ? 'flex' : 'none';
    }

    // Скрываем кнопки смены статуса для участников в чужих проектах
    const statusBtns = document.getElementById('taskDetailStatusBtns');
    if (statusBtns) {
        statusBtns.style.display = (isOwner || !project) ? 'flex' : 'none';
    }

    openModal('taskDetailModal');
    // Загружаем вложения и комментарии
    loadTaskAttachments(id);
    loadTaskComments(id);
}

async function changeTaskStatus(id, status) {
    const taskId = id || window.currentTaskId;
    const task = state.tasks.find(t => t.id === taskId);
    if (!task) return;
    if (!canChangeTaskStatus(task, status)) {
        alert(status === 'done'
            ? 'Исполнитель не может сам отметить задачу готовой. Нужно отправить её на проверку.'
            : 'Недостаточно прав для смены этого статуса.');
        return;
    }
    const ok = await updateTaskAndLocal(task, { status });
    if (!ok) return;
    // Обновляем отображение в модале
    const statusEl = document.getElementById('taskDetailStatus');
    if (statusEl) {
        statusEl.className = `task-status-badge ${status}`;
        statusEl.textContent = taskStatusLabel(status);
    }
    closeModal('taskDetailModal');
    updateBadges();
    if (currentProjectId && task.project_id === currentProjectId) renderKanban(currentProjectId);
    if (document.getElementById('tasks-section').classList.contains('active')) renderAllTasks();
    if (document.getElementById('dashboard-section').classList.contains('active')) renderDashboard();
    if (status === 'done') showPersNotif('taskDone');
}

async function deleteTask(id) {
    const taskId = id || window.currentTaskId;
    if (!confirm('Удалить задачу?')) return;
    const task = state.tasks.find(t => t.id === taskId);
    await sbDeleteTask(taskId);
    state.tasks = state.tasks.filter(t => t.id !== taskId);
    closeModal('taskDetailModal');
    updateBadges();
    if (task && task.project_id === currentProjectId) renderKanban(currentProjectId);
    if (document.getElementById('tasks-section').classList.contains('active')) renderAllTasks();
    if (document.getElementById('dashboard-section').classList.contains('active')) renderDashboard();
}

function openEditTaskModal(id) {
    const taskId = id || window.currentTaskId;
    const task = state.tasks.find(t => t.id === taskId);
    if (!task) return;
    closeModal('taskDetailModal');
    // Заполняем форму редактирования
    document.getElementById('taskName').value = task.title;
    document.getElementById('taskDesc').value = task.description || '';
    document.getElementById('taskStatus').value = task.status;
    document.getElementById('taskPriority').value = task.priority;
    document.getElementById('taskDue').value = task.due_date || '';
    fillTaskProjectSelect(task.project_id);
    if (task.project_id) document.getElementById('taskProject').value = task.project_id;
    // Заполняем исполнителя
    setTimeout(() => {
        const assigneeSel = document.getElementById('taskAssignee');
        if (assigneeSel && task.assignee) assigneeSel.value = task.assignee;
    }, 50);
    // Меняем кнопку на "Сохранить"
    const btn = document.querySelector('#taskModal .btn-primary');
    btn.dataset.editing = 'true';
    btn.textContent = 'Сохранить';
    btn.onclick = () => saveEditTask(taskId);
    const title = document.getElementById('taskModalTitle');
    if (title) title.textContent = 'Редактировать задачу';
    openModal('taskModal');
}

async function saveEditTask(taskId) {
    const title = document.getElementById('taskName').value.trim();
    if (!title) { alert('Введите название задачи'); return; }
    const btn = document.querySelector('#taskModal .btn-primary');
    setBtnLoading(btn, 'Сохраняем...');

    const updates = {
        title,
        description: document.getElementById('taskDesc').value.trim(),
        status: document.getElementById('taskStatus').value,
        priority: document.getElementById('taskPriority').value,
        due_date: document.getElementById('taskDue').value || null,
        project_id: document.getElementById('taskProject').value || null,
        assignee: document.getElementById('taskAssignee')?.value?.trim() || null,
    };

    const existingTask = state.tasks.find(t => t.id === taskId);
    if (existingTask && updates.status !== existingTask.status && !canChangeTaskStatus(existingTask, updates.status)) {
        setBtnDone(btn, 'Сохранить');
        alert(updates.status === 'done'
            ? 'Исполнитель не может сам отметить задачу готовой. Нужно отправить её на проверку.'
            : 'Недостаточно прав для смены этого статуса.');
        return;
    }

    const result = await sbUpdateTask(taskId, updates);

    if (!result.success) { setBtnDone(btn, 'Сохранить'); alert('Ошибка: ' + result.error); return; }

    const task = state.tasks.find(t => t.id === taskId);
    if (task) Object.assign(task, updates);

    setBtnDone(btn, 'Сохранить', 'Сохранено');
    setTimeout(() => {
        resetTaskModalSubmitButton();
        const titleEl = document.getElementById('taskModalTitle');
        if (titleEl) titleEl.textContent = 'Новая задача';
        closeModal('taskModal');
        updateBadges();
        if (currentProjectId) renderKanban(currentProjectId);
        if (document.getElementById('tasks-section').classList.contains('active')) renderAllTasks();
        showPersNotif('info', 'Задача обновлена! ✏️');
    }, 1000);
}

// ===== TASK COMMENTS =====
async function loadTaskComments(taskId) {
    const container = document.getElementById('taskCommentsList');
    const countEl = document.getElementById('commentsCount');
    if (!container) return;

    const comments = await getTaskComments(taskId);
    if (countEl) countEl.textContent = comments.length;

    if (!comments.length) {
        container.innerHTML = `<div style="font-size:13px;color:var(--text-secondary);text-align:center;padding:8px;">Нет комментариев. Будьте первым!</div>`;
        return;
    }

    container.innerHTML = comments.map(c => {
        const isMe = c.author_id === state.user?.id;
        const profile = state.profiles?.find(p => p.id === c.author_id);
        const authorName = profile?.name || profile?.email?.split('@')[0] || 'Пользователь';
        const avatarUrl = profile?.avatar_url;
        const avatarEl = avatarUrl
            ? `<img src="${avatarUrl}" style="width:28px;height:28px;border-radius:50%;object-fit:cover;flex-shrink:0;">`
            : `<div style="width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,#3AB0A8,#2A9D95);display:flex;align-items:center;justify-content:center;color:white;font-size:11px;font-weight:700;flex-shrink:0;">${authorName[0].toUpperCase()}</div>`;
        const time = new Date(c.created_at).toLocaleString('ru-RU', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });

        return `
        <div style="display:flex;gap:8px;align-items:flex-start;${isMe ? 'flex-direction:row-reverse;' : ''}">
            ${avatarEl}
            <div style="max-width:80%;${isMe ? 'align-items:flex-end;' : ''}display:flex;flex-direction:column;gap:3px;">
                <div style="font-size:11px;color:var(--text-secondary);${isMe ? 'text-align:right;' : ''}">${isMe ? 'Вы' : authorName} · ${time}</div>
                <div style="background:${isMe ? 'var(--primary)' : 'var(--bg-main)'};color:${isMe ? 'white' : 'var(--text-primary)'};padding:8px 12px;border-radius:${isMe ? '14px 4px 14px 14px' : '4px 14px 14px 14px'};font-size:13px;line-height:1.5;border:1px solid ${isMe ? 'transparent' : 'var(--border)'};">
                    ${escapeHtml(c.text)}
                </div>
                ${isMe ? `<button onclick="removeComment('${c.id}')" style="background:none;border:none;cursor:pointer;font-size:10px;color:var(--text-secondary);padding:0;text-align:right;" onmouseover="this.style.color='#c62828'" onmouseout="this.style.color='var(--text-secondary)'">удалить</button>` : ''}
            </div>
        </div>`;
    }).join('');

    // Скроллим вниз
    container.scrollTop = container.scrollHeight;
}

async function submitComment() {
    const text = document.getElementById('newCommentText')?.value?.trim();
    if (!text) return;

    const taskId = window.currentTaskId;
    const btn = document.querySelector('#taskDetailModal .fa-paper-plane')?.closest('button');
    if (btn) setBtnLoading(btn, '');

    const result = await addTaskComment(taskId, text);

    if (btn) setBtnDone(btn, '<i class="fas fa-paper-plane"></i>');
    if (!result.success) { alert('Ошибка: ' + result.error); return; }

    document.getElementById('newCommentText').value = '';
    loadTaskComments(taskId);

    // Уведомляем участников задачи через бейдж
    updateNotifBadge();
}

async function removeComment(id) {
    const result = await deleteTaskComment(id);
    if (result.success) loadTaskComments(window.currentTaskId);
}

// ===== TASK ATTACHMENTS =====
async function loadTaskAttachments(taskId) {
    const container = document.getElementById('taskAttachmentsList');
    if (!container) return;
    container.innerHTML = `<div style="font-size:13px;color:var(--text-secondary);text-align:center;padding:12px;"><i class="fas fa-spinner fa-spin"></i></div>`;

    const attachments = await getTaskAttachments(taskId);

    if (!attachments.length) {
        container.innerHTML = `<div style="font-size:13px;color:var(--text-secondary);text-align:center;padding:12px;">Нет вложений</div>`;
        return;
    }

    container.innerHTML = attachments.map(a => {
        const icon = a.type === 'link' ? 'fa-link' : getFileIcon(a.mime_type);
        const sizeText = a.size ? formatFileSize(a.size) : '';
        return `
        <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--bg-main);border-radius:10px;border:1px solid var(--border);">
            <div style="width:32px;height:32px;border-radius:8px;background:rgba(58,176,168,0.1);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                <i class="fas ${icon}" style="color:var(--primary);font-size:13px;"></i>
            </div>
            <div style="flex:1;min-width:0;">
                <a href="${a.url}" target="_blank" style="font-size:13px;font-weight:600;color:var(--text-primary);text-decoration:none;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" onmouseover="this.style.color='var(--primary)'" onmouseout="this.style.color='var(--text-primary)'">${escapeHtml(a.name)}</a>
                ${sizeText ? `<div style="font-size:11px;color:var(--text-secondary);">${sizeText}</div>` : ''}
            </div>
            <button onclick="removeAttachment('${a.id}')" style="background:none;border:none;cursor:pointer;color:var(--text-secondary);padding:4px;border-radius:6px;font-size:12px;flex-shrink:0;" title="Удалить" onmouseover="this.style.color='#c62828'" onmouseout="this.style.color='var(--text-secondary)'">
                <i class="fas fa-times"></i>
            </button>
        </div>`;
    }).join('');
}

function getFileIcon(mimeType) {
    if (!mimeType) return 'fa-file';
    if (mimeType.startsWith('image/')) return 'fa-image';
    if (mimeType.startsWith('video/')) return 'fa-video';
    if (mimeType.includes('pdf')) return 'fa-file-pdf';
    if (mimeType.includes('word') || mimeType.includes('document')) return 'fa-file-word';
    if (mimeType.includes('excel') || mimeType.includes('spreadsheet')) return 'fa-file-excel';
    if (mimeType.includes('zip') || mimeType.includes('rar')) return 'fa-file-archive';
    return 'fa-file';
}

function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' Б';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' КБ';
    return (bytes / (1024 * 1024)).toFixed(1) + ' МБ';
}

async function addAttachmentLink() {
    // Открываем красивый модал вместо prompt()
    document.getElementById('linkAttachName').value = '';
    document.getElementById('linkAttachUrl').value = '';
    openModal('linkAttachModal');
}

async function saveLinkAttachment() {
    const name = document.getElementById('linkAttachName').value.trim();
    const url = document.getElementById('linkAttachUrl').value.trim();
    if (!name) { alert('Введите название'); return; }
    if (!url) { alert('Введите URL'); return; }

    const btn = document.querySelector('#linkAttachModal .btn-primary');
    setBtnLoading(btn, 'Добавляем...');

    const taskId = window.currentTaskId;
    const result = await addTaskLink(taskId, name, url);

    setBtnDone(btn, 'Добавить');
    closeModal('linkAttachModal');

    if (result.success) {
        loadTaskAttachments(taskId);
        showPersNotif('success', 'Ссылка добавлена! 🔗');
    } else {
        alert('Ошибка: ' + result.error);
    }
}

async function uploadAttachmentFile(input) {
    const file = input.files[0];
    if (!file) return;

    const maxSize = 10 * 1024 * 1024; // 10 МБ
    if (file.size > maxSize) {
        alert('Файл слишком большой. Максимум 10 МБ.');
        input.value = '';
        return;
    }

    const taskId = window.currentTaskId;
    showPersNotif('info', 'Загружаем файл...');

    const result = await uploadTaskFile(taskId, file);
    input.value = '';

    if (result.success) {
        loadTaskAttachments(taskId);
        showPersNotif('success', `Файл "${file.name}" загружен! 📎`);
    } else {
        alert('Ошибка загрузки: ' + result.error);
    }
}

async function removeAttachment(id) {
    if (!confirm('Удалить вложение?')) return;
    const result = await deleteTaskAttachment(id);
    if (result.success) {
        loadTaskAttachments(window.currentTaskId);
    } else {
        alert('Ошибка: ' + result.error);
    }
}

// ===== NOTES =====
async function saveNote() {
    const title = document.getElementById('noteTitle').value.trim();
    if (!title) { alert('Введите заголовок заметки'); return; }

    const btn = document.querySelector('#noteModal .btn-primary');
    setBtnLoading(btn, 'Сохраняем...');

    const result = await sbCreateNote({
        title,
        content: document.getElementById('noteContent').value.trim()
    });

    setBtnDone(btn, 'Сохранить');
    if (!result.success) { alert('Ошибка: ' + result.error); return; }

    state.notes.unshift(result.note);
    closeModal('noteModal');
    if (document.getElementById('notes-section').classList.contains('active')) renderNotes();
}

function renderNotes() {
    const grid = document.getElementById('notesGrid');
    if (!state.notes.length) {
        grid.innerHTML = '<div class="empty-state"><i class="fas fa-sticky-note"></i><h3>Нет заметок</h3><p>Создайте первую заметку</p></div>';
        return;
    }
    grid.innerHTML = '';
    state.notes.forEach(n => {
        const card = document.createElement('div');
        card.className = 'note-card';
        card.innerHTML = `
            <button class="note-delete-btn" title="Удалить заметку" onclick="event.stopPropagation();deleteNote('${n.id}')"><i class="fas fa-trash"></i></button>
            <div class="note-card-title">${escapeHtml(n.title)}</div>
            <div class="note-card-content">${escapeHtml(n.content || 'Нет содержимого')}</div>
            <div class="note-card-date">${formatDate(n.created_at || n.createdAt)}</div>`;
        grid.appendChild(card);
    });
}

async function deleteNote(id) {
    if (!confirm('Удалить заметку?')) return;
    const result = await sbDeleteNote(id);
    if (!result.success) {
        alert('Ошибка: ' + result.error);
        return;
    }
    state.notes = state.notes.filter(n => n.id !== id);
    renderNotes();
    showPersNotif('warning', 'Заметка удалена');
}

// ===== DASHBOARD =====
function renderDashboard() {
    const activePr = state.projects.filter(p => p.status === 'active').length;
    const inProgressTasks = state.tasks.filter(t => t.status === 'inprogress').length;
    const doneTasks = state.tasks.filter(t => t.status === 'done').length;
    document.getElementById('statProjects').textContent = activePr;
    document.getElementById('statTasks').textContent = inProgressTasks;
    document.getElementById('statDone').textContent = doneTasks;

    const container = document.getElementById('dashboardProjects');
    if (!state.projects.length) {
        container.innerHTML = '<p style="color:var(--text-secondary);font-size:14px;">Проектов пока нет. Создайте первый!</p>';
        return;
    }
    container.innerHTML = '';
    state.projects.slice(0, 3).forEach(p => {
        const tasks = state.tasks.filter(t => t.project_id === p.id);
        const done = tasks.filter(t => t.status === 'done').length;
        const progress = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
        const item = document.createElement('div');
        item.className = 'project-item';
        item.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:14px;background:var(--bg-main);border-radius:10px;border:1px solid var(--border);margin-bottom:10px;cursor:pointer;';
        item.innerHTML = `
            <div class="dashboard-project-emoji">${getProjectEmoji(p)}</div>
            <div style="flex:1;min-width:0;">
                <div style="font-size:15px;font-weight:600;margin-bottom:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${p.title}</div>
                <div style="display:flex;align-items:center;gap:10px;">
                    <div class="progress-bar"><div class="progress-fill" style="width:${progress}%"></div></div>
                    <span class="progress-text">${progress}%</span>
                </div>
            </div>
            <span class="project-status ${p.status}" style="margin-left:16px;">${statusLabel(p.status)}</span>`;
        item.addEventListener('click', () => openProjectDetail(p.id));
        container.appendChild(item);
    });
}

// ===== CALENDAR =====
function renderCalendar() {
    const container = document.getElementById('calendarGrid');
    const year = calendarDate.getFullYear();
    const month = calendarDate.getMonth();
    const today = new Date();
    const monthNames = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
    const weekdays = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];

    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    let startDow = firstDay.getDay() - 1;
    if (startDow < 0) startDow = 6;

    let html = `
        <div class="calendar-header">
            <button class="calendar-nav" onclick="changeMonth(-1)"><i class="fas fa-chevron-left"></i></button>
            <h3>${monthNames[month]} ${year}</h3>
            <button class="calendar-nav" onclick="changeMonth(1)"><i class="fas fa-chevron-right"></i></button>
        </div>
        <div class="calendar-weekdays">${weekdays.map(d => `<div class="calendar-weekday">${d}</div>`).join('')}</div>
        <div class="calendar-grid">`;

    for (let i = 0; i < startDow; i++) {
        const d = new Date(year, month, -startDow + i + 1);
        html += `<div class="calendar-day other-month"><span class="cal-day-num">${d.getDate()}</span></div>`;
    }
    for (let d = 1; d <= lastDay.getDate(); d++) {
        const date = new Date(year, month, d);
        const iso = formatDateISO(date);
        const allDayTasks = state.tasks.filter(t => t.due_date === iso && t.status !== 'done');
        const dayTasks = allDayTasks.slice(0, 2);
        const hiddenCount = allDayTasks.length - dayTasks.length;
        const isToday = d === today.getDate() && month === today.getMonth() && year === today.getFullYear();
        const hasTasks = allDayTasks.length > 0;

        html += `<div class="calendar-day ${isToday ? 'today' : ''} ${hasTasks ? 'has-tasks' : ''}" onclick="openCalendarDay('${iso}', event)">
            <span class="cal-day-num">${d}</span>
            <div class="cal-tasks-list">
                ${dayTasks.map(t => `
                    <div class="cal-task-chip cal-task-${t.priority}" onclick="event.stopPropagation();showTaskDetail('${t.id}')" title="${escapeHtml(t.title)}">
                        ${escapeHtml(t.title)}
                    </div>`).join('')}
                ${hiddenCount > 0 ? `<div class="cal-task-more">+${hiddenCount} ещё</div>` : ''}
            </div>
        </div>`;
    }
    const remaining = 42 - startDow - lastDay.getDate();
    for (let d = 1; d <= remaining; d++) {
        html += `<div class="calendar-day other-month"><span class="cal-day-num">${d}</span></div>`;
    }
    html += '</div>';
    container.innerHTML = html;
}

function openCalendarDay(iso, event) {
    const dayTasks = state.tasks.filter(t => t.due_date === iso);
    const date = new Date(iso + 'T00:00:00');
    const label = date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });

    // Удаляем старый попап если есть
    const old = document.getElementById('calDayPopup');
    if (old) { old.remove(); return; }

    if (!dayTasks.length) return;

    const popup = document.createElement('div');
    popup.id = 'calDayPopup';
    popup.className = 'cal-day-popup';
    popup.style.position = 'fixed';
    popup.style.zIndex = '2000';
    popup.innerHTML = `
        <div class="cal-day-popup-header">
            <span class="cal-day-popup-title"><i class="fas fa-calendar-day"></i> ${label}</span>
            <button class="cal-day-popup-close" onclick="document.getElementById('calDayPopup').remove()"><i class="fas fa-times"></i></button>
        </div>
        <div class="cal-day-popup-tasks">
            ${dayTasks.map(t => `
                <div class="cal-day-popup-task" onclick="document.getElementById('calDayPopup').remove();showTaskDetail('${t.id}')">
                    <span class="cal-popup-prio cal-popup-prio-${t.priority}"></span>
                    <div class="cal-popup-task-info">
                        <div class="cal-popup-task-title">${escapeHtml(t.title)}</div>
                        <div class="cal-popup-task-meta">
                            <span class="task-status-badge ${t.status}" style="font-size:10px;padding:2px 7px;">${taskStatusLabel(t.status)}</span>
                            ${t.assignee ? `<span style="font-size:11px;color:var(--text-secondary);"><i class="fas fa-user" style="margin-right:2px;"></i>${t.assignee.split('@')[0]}</span>` : ''}
                        </div>
                    </div>
                    <i class="fas fa-chevron-right" style="color:var(--text-secondary);font-size:11px;margin-left:auto;"></i>
                </div>
            `).join('')}
        </div>
        <div class="cal-day-popup-footer">
            <button class="btn-primary" style="width:100%;padding:9px;font-size:13px;" onclick="document.getElementById('calDayPopup').remove();openModal('taskModal')">
                <i class="fas fa-plus"></i> Добавить задачу
            </button>
        </div>
    `;
    document.body.appendChild(popup);

    // Позиционируем рядом с кликнутой ячейкой
    const popupW = 340;
    const popupH = Math.min(popup.offsetHeight || 400, window.innerHeight * 0.8);
    const src = event?.currentTarget || event?.target;
    let x, y;

    if (src) {
        const rect = src.getBoundingClientRect();
        x = rect.right + 8;
        y = rect.top;
        // Не выходим за правый край
        if (x + popupW > window.innerWidth - 8) x = rect.left - popupW - 8;
        // Не выходим за нижний край
        if (y + popupH > window.innerHeight - 8) y = window.innerHeight - popupH - 8;
        if (y < 8) y = 8;
    } else {
        x = (window.innerWidth - popupW) / 2;
        y = (window.innerHeight - popupH) / 2;
    }

    popup.style.left = x + 'px';
    popup.style.top = y + 'px';
    popup.style.width = popupW + 'px';

    // Закрываем при клике вне
    setTimeout(() => {
        document.addEventListener('click', function closePop(e) {
            if (!popup.contains(e.target)) {
                popup.remove();
                document.removeEventListener('click', closePop);
            }
        });
    }, 50);
}

function changeMonth(dir) {
    calendarDate.setMonth(calendarDate.getMonth() + dir);
    renderCalendar();
}

// ===== ANALYTICS =====
function renderAnalytics() {
    const todo = state.tasks.filter(t => t.status === 'todo').length;
    const inprogress = state.tasks.filter(t => t.status === 'inprogress').length;
    const done = state.tasks.filter(t => t.status === 'done').length;
    const total = state.tasks.length;

    const active = state.projects.filter(p => p.status === 'active').length;
    const planning = state.projects.filter(p => p.status === 'planning').length;
    const completed = state.projects.filter(p => p.status === 'completed').length;
    const paused = state.projects.filter(p => p.status === 'paused').length;

    const high = state.tasks.filter(t => t.priority === 'high').length;
    const medium = state.tasks.filter(t => t.priority === 'medium').length;
    const low = state.tasks.filter(t => t.priority === 'low').length;

    // --- Stat cards с анимацией счётчика ---
    const statsRow = document.getElementById('analyticsStatsRow');
    statsRow.innerHTML = `
        <div class="analytics-stat-card anim-card"><div class="analytics-stat-number" data-target="${total}" style="color:var(--primary)">0</div><div class="analytics-stat-label">Всего задач</div></div>
        <div class="analytics-stat-card anim-card"><div class="analytics-stat-number" data-target="${todo}" style="color:#60B4F0">0</div><div class="analytics-stat-label">В планах</div></div>
        <div class="analytics-stat-card anim-card"><div class="analytics-stat-number" data-target="${inprogress}" style="color:#F8C95D">0</div><div class="analytics-stat-label">В процессе</div></div>
        <div class="analytics-stat-card anim-card"><div class="analytics-stat-number" data-target="${done}" style="color:#4CAF50">0</div><div class="analytics-stat-label">Выполнено</div></div>
        <div class="analytics-stat-card anim-card"><div class="analytics-stat-number" data-target="${state.projects.length}">0</div><div class="analytics-stat-label">Проектов</div></div>
    `;
    // Анимируем числа
    statsRow.querySelectorAll('.analytics-stat-number[data-target]').forEach((el, i) => {
        const target = parseInt(el.dataset.target);
        if (target === 0) { el.textContent = '0'; return; }
        let start = 0;
        const duration = 800;
        const step = 16;
        const increment = target / (duration / step);
        setTimeout(() => {
            const timer = setInterval(() => {
                start = Math.min(start + increment, target);
                el.textContent = Math.round(start);
                if (start >= target) clearInterval(timer);
            }, step);
        }, i * 80);
    });

    // --- Donut Chart ---
    const donutData = [
        { value: todo, color: '#60B4F0', label: 'В планах' },
        { value: inprogress, color: '#F8C95D', label: 'В процессе' },
        { value: done, color: '#4CAF50', label: 'Сделано' }
    ];
    renderDonut('donutChart', 'donutLegend', donutData, total);

    // --- Projects bars с анимацией ---
    const projData = [
        { label: 'Активных', value: active, color: '#4CAF50' },
        { label: 'Планирование', value: planning, color: '#F8C95D' },
        { label: 'Завершено', value: completed, color: '#3AB0A8' },
        { label: 'Приостановлено', value: paused, color: '#E57373' }
    ];
    const projTotal = state.projects.length || 1;
    document.getElementById('projectsBarsChart').innerHTML = projData.map((d, i) => `
        <div class="analytics-bar anim-card" style="animation-delay:${i*80}ms">
            <span class="analytics-bar-label">${d.label}</span>
            <div class="analytics-bar-track">
                <div class="analytics-bar-fill anim-bar" data-width="${(d.value/projTotal*100).toFixed(0)}" style="width:0%;background:${d.color};transition:width 0.8s cubic-bezier(0.4,0,0.2,1) ${i*100}ms;"></div>
            </div>
            <span class="analytics-bar-value">${d.value}</span>
        </div>`).join('');

    // --- Priority bar chart с анимацией ---
    const maxPrio = Math.max(high, medium, low, 1);
    const prioData = [
        { label: 'Высокий', value: high, color: '#E57373' },
        { label: 'Средний', value: medium, color: '#F8C95D' },
        { label: 'Низкий', value: low, color: '#4CAF50' }
    ];
    const barH = 120;
    document.getElementById('priorityBarChart').innerHTML = prioData.map((d, i) => {
        const h = maxPrio > 0 ? Math.round((d.value / maxPrio) * barH) : 4;
        return `
        <div style="display:flex;flex-direction:column;align-items:center;gap:4px;flex:1;">
            <span style="font-size:12px;font-weight:700;color:var(--text-primary)">${d.value}</span>
            <div style="width:100%;height:0px;background:${d.color};border-radius:8px 8px 0 0;min-height:4px;transition:height 0.7s cubic-bezier(0.4,0,0.2,1) ${i*120}ms;" data-height="${h}"></div>
            <span style="font-size:11px;color:var(--text-secondary);text-align:center;">${d.label}</span>
        </div>`;
    }).join('') + `<div style="position:absolute;bottom:24px;left:0;right:0;height:1px;background:var(--border);"></div>`;

    // --- Projects progress с анимацией ---
    if (!state.projects.length) {
        document.getElementById('projectsProgressChart').innerHTML = '<p style="color:var(--text-secondary);font-size:13px;padding:8px 0;">Нет проектов</p>';
    } else {
        document.getElementById('projectsProgressChart').innerHTML = state.projects.map((p, i) => {
            const tasks = state.tasks.filter(t => t.project_id === p.id);
            const doneTasks = tasks.filter(t => t.status === 'done').length;
            const progress = tasks.length ? Math.round((doneTasks / tasks.length) * 100) : 0;
            const isOwner = p.owner_id === state.user?.id;
            return `
            <div class="anim-card" style="margin-bottom:14px;animation-delay:${i*60}ms">
                <div style="display:flex;justify-content:space-between;margin-bottom:5px;align-items:center;">
                    <span style="font-size:13px;font-weight:600;color:var(--text-primary);display:flex;align-items:center;gap:6px;">
                        ${isOwner ? '<i class="fas fa-crown" style="font-size:10px;color:var(--primary);"></i>' : '<i class="fas fa-users" style="font-size:10px;color:#A78BFA;"></i>'}
                        ${p.title}
                    </span>
                    <span style="font-size:12px;font-weight:700;color:var(--primary)">${progress}%</span>
                </div>
                <div class="analytics-bar-track" style="height:10px;">
                    <div class="analytics-bar-fill anim-bar" data-width="${progress}" style="width:0%;background:linear-gradient(90deg,var(--primary),var(--success));transition:width 0.8s cubic-bezier(0.4,0,0.2,1) ${i*80}ms;"></div>
                </div>
            </div>`;
        }).join('');
    }

    // Запускаем анимации через requestAnimationFrame
    requestAnimationFrame(() => {
        // Прогресс-бары
        document.querySelectorAll('.anim-bar').forEach(el => {
            el.style.width = el.dataset.width + '%';
        });
        // Столбчатые диаграммы
        document.querySelectorAll('[data-height]').forEach(el => {
            el.style.height = el.dataset.height + 'px';
        });
    });
}

function renderDonut(svgId, legendId, data, total) {
    const svg = document.getElementById(svgId);
    const legend = document.getElementById(legendId);
    const cx = 60, cy = 60, r = 46, strokeW = 16;
    const circumference = 2 * Math.PI * r;

    if (total === 0) {
        svg.innerHTML = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--border)" stroke-width="${strokeW}"/>
            <text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="middle" font-size="14" font-weight="700" fill="var(--text-secondary)">0</text>`;
        legend.innerHTML = '<span style="font-size:12px;color:var(--text-secondary)">Нет данных</span>';
        return;
    }

    let offset = 0;
    let svgHTML = '';
    data.forEach(d => {
        const pct = d.value / total;
        const dash = pct * circumference;
        const gap = circumference - dash;
        svgHTML += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${d.color}" stroke-width="${strokeW}"
            stroke-dasharray="${dash} ${gap}" stroke-dashoffset="${-offset}" stroke-linecap="round"
            style="transition:stroke-dasharray 0.6s ease;" transform="rotate(-90 ${cx} ${cy})"/>`;
        offset += dash;
    });
    svgHTML += `<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="middle" font-size="18" font-weight="800" fill="var(--text-primary)">${total}</text>
        <text x="${cx}" y="${cy+16}" text-anchor="middle" font-size="10" fill="var(--text-secondary)">задач</text>`;
    svg.innerHTML = svgHTML;

    legend.innerHTML = data.map(d => `
        <div class="donut-legend-item">
            <div class="donut-legend-dot" style="background:${d.color}"></div>
            <span class="donut-legend-label">${d.label}</span>
            <span class="donut-legend-value">${d.value}</span>
        </div>`).join('');
}

// ===== PROFILE =====
function renderProfile() {
    const profile = state.profile;
    const user = state.user;
    document.getElementById('profileName').textContent = profile?.name || user?.email || '—';
    document.getElementById('profileEmail').textContent = user?.email || '—';
    const role = profile?.role || 'creator';
    const roleEl = document.getElementById('profileRole');
    roleEl.textContent = role === 'creator' ? 'Создатель проекта' : 'Участник проекта';
    roleEl.style.background = role === 'creator' ? 'rgba(58,176,168,0.15)' : 'rgba(248,201,93,0.2)';
    roleEl.style.color = role === 'creator' ? 'var(--primary)' : '#b8860b';
    document.getElementById('profileDate').textContent = formatDate(profile?.created_at || user?.created_at);
    document.getElementById('profileProjects').textContent = state.projects.length;
    document.getElementById('profileTasksDone').textContent = state.tasks.filter(t => t.status === 'done').length;

    // Аватарка в профиле
    const profileAvatar = document.getElementById('profileAvatarEl');
    if (profileAvatar) {
        const avatarUrl = profile?.avatar_url;
        if (avatarUrl) {
            profileAvatar.innerHTML = `<img src="${avatarUrl}" alt="avatar" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
        } else {
            profileAvatar.innerHTML = `<i class="fas fa-user"></i>`;
        }
    }
}

// ===== SETTINGS =====
function renderSettings() {
    document.getElementById('settingsName').value = state.profile?.name || '';
    document.getElementById('settingsEmail').value = state.user?.email || '';
    const avatarUrl = state.profile?.avatar_url || '';
    document.getElementById('settingsAvatarUrl').value = avatarUrl;
    // Обновляем превью
    const preview = document.getElementById('settingsAvatarPreview');
    if (preview) {
        if (avatarUrl) {
            preview.innerHTML = `<img src="${avatarUrl}" alt="preview" style="width:100%;height:100%;object-fit:cover;" onerror="this.parentElement.innerHTML='<i class=\\'fas fa-user\\'></i>'">`;
        } else {
            preview.innerHTML = `<i class="fas fa-user"></i>`;
        }
    }
}

async function saveSettings() {
    const name = document.getElementById('settingsName').value.trim() || state.profile?.name;
    const avatarUrl = document.getElementById('settingsAvatarUrl').value.trim();
    const btn = document.querySelector('#settings-section .btn-primary');

    if (state.profile) {
        setBtnLoading(btn, 'Сохраняем...');
        const updates = { name };
        if (avatarUrl !== undefined) updates.avatar_url = avatarUrl || null;

        const result = await sbUpdateProfile(state.user.id, updates);
        if (result.success) {
            state.profile.name = name;
            state.profile.avatar_url = avatarUrl || null;
            updateUserUI();
            setBtnDone(btn, 'Сохранить', 'Сохранено');
        } else {
            setBtnDone(btn, 'Сохранить');
            alert('Ошибка сохранения: ' + result.error);
        }
    }
}

// ===== BADGES & UI =====
function updateBadges() {
    document.getElementById('projectsBadge').textContent = state.projects.length;
    const myId = state.user?.id;
    const myEmail = state.user?.email;
    // Задачи: мои + назначенные мне
    const myTasks = state.tasks.filter(t =>
        (t.owner_id === myId || t.assignee === myEmail) && t.status !== 'done'
    );
    document.getElementById('tasksBadge').textContent = myTasks.length;
    updateReviewBadge();
    updateTeamProjectsSidebar();
    updateNotifBadge();
}

function updateUserUI() {
    const name = state.profile?.name || state.user?.email || 'Пользователь';
    const email = state.user?.email || '';
    document.getElementById('sidebarUserName').textContent = name;
    document.getElementById('sidebarUserEmail').textContent = email;

    // Аватарка в сайдбаре
    const sidebarAvatar = document.querySelector('.user-profile .user-avatar');
    if (sidebarAvatar) {
        const avatarUrl = state.profile?.avatar_url;
        if (avatarUrl) {
            sidebarAvatar.innerHTML = `<img src="${avatarUrl}" alt="avatar" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
        } else {
            sidebarAvatar.innerHTML = `<i class="fas fa-user"></i>`;
        }
    }

    // Аватарка в хедере
    const headerAvatar = document.getElementById('headerUserBtn');
    if (headerAvatar) {
        const avatarUrl = state.profile?.avatar_url;
        if (avatarUrl) {
            headerAvatar.innerHTML = `<img src="${avatarUrl}" alt="avatar" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
        } else {
            headerAvatar.innerHTML = `<i class="fas fa-user"></i>`;
        }
    }
}

// ===== SEARCH =====
document.getElementById('searchInput').addEventListener('input', function() {
    const q = this.value.toLowerCase().trim();
    let dropdown = document.getElementById('searchDropdown');

    if (!dropdown) {
        dropdown = document.createElement('div');
        dropdown.id = 'searchDropdown';
        dropdown.style.cssText = `
            position:absolute; top:100%; left:0; right:0; z-index:1000;
            background:var(--card); border:1px solid var(--border);
            border-radius:10px; box-shadow:0 8px 24px rgba(0,0,0,0.12);
            max-height:320px; overflow-y:auto; margin-top:4px;
        `;
        this.parentElement.style.position = 'relative';
        this.parentElement.appendChild(dropdown);
    }

    if (!q) { dropdown.style.display = 'none'; return; }

    const results = [
        ...state.projects.filter(p => p.title.toLowerCase().includes(q)).map(p => ({ type: 'project', icon: 'fa-folder-open', label: p.title, sub: 'Проект', item: p })),
        ...state.tasks.filter(t => t.title.toLowerCase().includes(q)).map(t => ({ type: 'task', icon: 'fa-check-circle', label: t.title, sub: taskStatusLabel(t.status), item: t })),
        ...state.notes.filter(n => n.title.toLowerCase().includes(q)).map(n => ({ type: 'note', icon: 'fa-sticky-note', label: n.title, sub: 'Заметка', item: n }))
    ];

    if (!results.length) {
        dropdown.innerHTML = `<div style="padding:14px 16px;color:var(--text-secondary);font-size:13px;">Ничего не найдено</div>`;
        dropdown.style.display = 'block';
        return;
    }

    dropdown.innerHTML = results.slice(0, 8).map((r, i) => `
        <div class="search-result-item" data-index="${i}" style="
            display:flex;align-items:center;gap:10px;padding:10px 16px;
            cursor:pointer;transition:background 0.15s;font-size:13px;
        ">
            <i class="fas ${r.icon}" style="color:var(--primary);width:16px;"></i>
            <div>
                <div style="font-weight:600;color:var(--text-primary);">${r.label}</div>
                <div style="font-size:11px;color:var(--text-secondary);">${r.sub}</div>
            </div>
        </div>
    `).join('');

    dropdown.querySelectorAll('.search-result-item').forEach((el, i) => {
        el.addEventListener('mouseenter', () => el.style.background = 'rgba(58,176,168,0.08)');
        el.addEventListener('mouseleave', () => el.style.background = '');
        el.addEventListener('click', () => {
            const r = results[i];
            dropdown.style.display = 'none';
            document.getElementById('searchInput').value = '';
            if (r.type === 'project') openProjectDetail(r.item.id);
            if (r.type === 'task') showTaskDetail(r.item.id);
            if (r.type === 'note') navigate('notes');
        });
    });

    dropdown.style.display = 'block';
});

// Закрываем dropdown при клике вне
document.addEventListener('click', e => {
    const dropdown = document.getElementById('searchDropdown');
    if (dropdown && !e.target.closest('.search-box')) {
        dropdown.style.display = 'none';
    }
});

// ===== SIDEBAR TOGGLE =====
document.getElementById('sidebarToggle').addEventListener('click', () => {
    const sidebar = document.getElementById('sidebar');
    if (window.matchMedia('(max-width: 820px)').matches) {
        sidebar.classList.toggle('mobile-open');
        sidebar.classList.remove('collapsed');
        return;
    }
    sidebar.classList.toggle('collapsed');
});
document.getElementById('mobileMenuBtn').addEventListener('click', () => {
    const sidebar = document.getElementById('sidebar');
    sidebar.classList.toggle('mobile-open');
    sidebar.classList.remove('collapsed');
});

// ===== NAV CLICKS =====
document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', e => {
        if (item.dataset.section) {
            e.preventDefault();
            navigate(item.dataset.section);
        }
        if (window.matchMedia('(max-width: 820px)').matches) {
            document.getElementById('sidebar').classList.remove('mobile-open');
        }
    });
});

document.addEventListener('click', e => {
    const sidebar = document.getElementById('sidebar');
    const clickedMenuButton = e.target.closest('#mobileMenuBtn, #sidebarToggle');
    if (!window.matchMedia('(max-width: 820px)').matches || clickedMenuButton) return;
    if (sidebar.classList.contains('mobile-open') && !e.target.closest('#sidebar')) {
        sidebar.classList.remove('mobile-open');
    }
});

// ===== USER PROFILE CLICK — выпадающее меню =====
document.getElementById('userProfileBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    openUserMenu(e.currentTarget);
});
document.getElementById('headerUserBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    openUserMenu(e.currentTarget);
});

function openUserMenu(anchor) {
    const old = document.getElementById('userMenuDropdown');
    if (old) { old.remove(); return; }

    const menu = document.createElement('div');
    menu.id = 'userMenuDropdown';
    menu.className = 'user-menu-dropdown';

    const name = state.profile?.name || state.user?.email?.split('@')[0] || 'Пользователь';
    const email = state.user?.email || '';
    const avatarUrl = state.profile?.avatar_url;
    const avatarEl = avatarUrl
        ? `<img src="${avatarUrl}" style="width:40px;height:40px;border-radius:50%;object-fit:cover;border:2px solid rgba(58,176,168,0.3);">`
        : `<div style="width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,#3AB0A8,#2A9D95);display:flex;align-items:center;justify-content:center;color:white;font-size:16px;"><i class="fas fa-user"></i></div>`;

    menu.innerHTML = `
        <div class="user-menu-header">
            ${avatarEl}
            <div style="min-width:0;">
                <div style="font-size:14px;font-weight:700;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${name}</div>
                <div style="font-size:12px;color:var(--text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${email}</div>
            </div>
        </div>
        <div class="user-menu-divider"></div>
        <button class="user-menu-item" onclick="document.getElementById('userMenuDropdown').remove();navigate('profile')">
            <i class="fas fa-user-circle"></i> Мой профиль
        </button>
        <button class="user-menu-item" onclick="document.getElementById('userMenuDropdown').remove();navigate('settings')">
            <i class="fas fa-cog"></i> Настройки
        </button>
        <div class="user-menu-divider"></div>
        <button class="user-menu-item user-menu-item-danger" onclick="document.getElementById('userMenuDropdown').remove();document.getElementById('logoutBtn').click()">
            <i class="fas fa-sign-out-alt"></i> Выйти
        </button>
    `;

    document.body.appendChild(menu);

    // Позиционируем под anchor
    const rect = anchor.getBoundingClientRect();
    const menuW = 220;
    let left = rect.left;
    if (left + menuW > window.innerWidth - 8) left = window.innerWidth - menuW - 8;
    menu.style.top = (rect.bottom + 8) + 'px';
    menu.style.left = left + 'px';

    // Закрываем при клике вне
    setTimeout(() => {
        document.addEventListener('click', function closeMenu(e) {
            if (!menu.contains(e.target)) {
                menu.remove();
                document.removeEventListener('click', closeMenu);
            }
        });
    }, 50);
}

// ===== AVATAR PREVIEW IN SETTINGS =====
document.addEventListener('input', e => {
    if (e.target.id === 'settingsAvatarUrl') {
        const preview = document.getElementById('settingsAvatarPreview');
        if (!preview) return;
        const url = e.target.value.trim();
        if (url) {
            preview.innerHTML = `<img src="${url}" alt="preview" style="width:100%;height:100%;object-fit:cover;" onerror="this.parentElement.innerHTML='<i class=\\'fas fa-user\\'></i>'">`;
        } else {
            preview.innerHTML = `<i class="fas fa-user"></i>`;
        }
    }
});

// ===== NOTIFICATIONS BUTTON =====
// Кнопка уведомлений управляется через onclick="openNotifPanel()" в HTML

// ===== LOGOUT =====
document.getElementById('logoutBtn').addEventListener('click', async () => {
    if (confirm('Выйти из аккаунта?')) {
        await supabaseSignOut();
        document.body.style.opacity = '0';
        setTimeout(() => window.location.href = 'index.html', 300);
    }
});

// ===== CLOSE MODAL ON OVERLAY CLICK =====
document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', e => {
        if (e.target === overlay) overlay.classList.remove('open');
    });
});

// ===== HELPERS =====
function statusLabel(s) {
    return { active:'Активен', planning:'Планирование', completed:'Завершен', paused:'Приостановлен' }[s] || s;
}
function taskStatusLabel(s) {
    return { todo:'В планах', inprogress:'В процессе', review:'На проверке', done:'Сделано' }[s] || s;
}
function priorityLabel(p) {
    return { low:'Низкий', medium:'Средний', high:'Высокий' }[p] || p;
}

// Получить имя пользователя по id из загруженных профилей
function getProfileName(userId) {
    if (!userId) return '';
    const profile = state.profiles?.find(p => p.id === userId);
    if (!profile) return '';
    return profile.name || profile.email?.split('@')[0] || '';
}

// Получить аватарку пользователя по id
function getProfileAvatar(userId) {
    if (!userId) return null;
    const profile = state.profiles?.find(p => p.id === userId);
    return profile?.avatar_url || null;
}
function formatDate(d) {
    if (!d) return '';
    const date = new Date(d);
    return date.toLocaleDateString('ru-RU', { day:'2-digit', month:'2-digit', year:'numeric' });
}
function formatDateISO(date) {
    const d = new Date(date);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function addDaysISO(dateValue, days) {
    const d = dateValue ? new Date(dateValue) : new Date();
    d.setDate(d.getDate() + days);
    return formatDateISO(d);
}
function getDateRangeDays(startDate, endDate) {
    const start = startDate ? new Date(startDate) : new Date();
    const end = endDate ? new Date(endDate) : new Date(start);
    if (!endDate) end.setDate(start.getDate() + 30);
    const diff = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
    return Math.max(1, diff || 1);
}
function readAiDateRange(startId, endId, fallbackStart, fallbackEnd) {
    const startEl = document.getElementById(startId);
    const endEl = document.getElementById(endId);
    const startDate = startEl?.value || fallbackStart || formatDateISO(new Date());
    let endDate = endEl?.value || fallbackEnd || addDaysISO(startDate, 30);
    if (new Date(endDate) <= new Date(startDate)) {
        endDate = addDaysISO(startDate, 1);
        if (endEl) endEl.value = endDate;
    }
    return {
        startDate,
        endDate,
        days: getDateRangeDays(startDate, endDate)
    };
}

// ===== PERS NOTIFICATIONS =====
const persMessages = {
    deadline: [
        { img: 'pers/angry.png', text: 'Дедлайн совсем скоро! Срочно завершай задачи! 😤', type: 'danger' },
        { img: 'pers/mangry.png', text: 'Эй! Дедлайн горит! Не теряй время! 🔥', type: 'danger' }
    ],
    overdue: [
        { img: 'pers/angry.png', text: 'Дедлайн уже прошёл! Нужно срочно разобраться! 😡', type: 'danger' },
        { img: 'pers/shok.png', text: 'Ой-ой! Проект просрочен! Это катастрофа! 😱', type: 'danger' }
    ],
    taskDone: [
        { img: 'pers/happy.png', text: 'Отлично! Задача выполнена! Так держать! 🎉', type: 'success' },
        { img: 'pers/happy.png', text: 'Ура! Ещё одна задача готова! Ты молодец! ⭐', type: 'success' }
    ],
    projectCreated: [
        { img: 'pers/happy.png', text: 'Новый проект создан! Удачи в работе! 🚀', type: 'success' }
    ],
    noTasks: [
        { img: 'pers/sad.png', text: 'Нет задач на сегодня... Может добавить что-нибудь? 😔', type: 'warning' }
    ],
    welcome: [
        { img: 'pers/happy.png', text: 'Привет! Добро пожаловать в Nikomi! 👋', type: 'success' },
        { img: 'pers/pers.png', text: 'Рада тебя видеть! Давай работать вместе! 😊', type: 'success' }
    ],
    info: [
        { img: 'pers/pers.png', text: '', type: 'info' }
    ],
    warning: [
        { img: 'pers/sad.png', text: '', type: 'warning' }
    ]
};

let persNotifTimer = null;

function showPersNotif(type, customText) {
    const pool = persMessages[type] || persMessages.info;
    const msg = pool[Math.floor(Math.random() * pool.length)];
    const notif = document.getElementById('persNotification');
    const img = document.getElementById('persNotifImg');
    const text = document.getElementById('persNotifText');

    img.src = msg.img;
    text.textContent = customText || msg.text;
    notif.className = `pers-notification ${msg.type}`;

    // Показываем
    setTimeout(() => notif.classList.add('show'), 50);

    // Автоскрытие через 5 секунд
    if (persNotifTimer) clearTimeout(persNotifTimer);
    persNotifTimer = setTimeout(() => closePersNotif(), 5000);
}

function closePersNotif() {
    const notif = document.getElementById('persNotification');
    notif.classList.remove('show');
}

// Проверяем дедлайны при загрузке
function checkDeadlines() {
    const today = new Date();
    today.setHours(0,0,0,0);

    state.projects.forEach(p => {
        if (!p.deadline) return;
        const dl = new Date(p.deadline);
        dl.setHours(0,0,0,0);
        const diff = Math.ceil((dl - today) / (1000*60*60*24));

        if (diff < 0 && p.status !== 'completed') {
            setTimeout(() => showPersNotif('overdue', `Проект "${p.title}" просрочен на ${Math.abs(diff)} дн.! 😡`), 2000);
        } else if (diff <= 2 && diff >= 0 && p.status !== 'completed') {
            setTimeout(() => showPersNotif('deadline', `До дедлайна "${p.title}" осталось ${diff === 0 ? 'сегодня!' : diff + ' дн.!'} 😤`), 2000);
        }
    });
}

// ===== INIT =====
updateUserUI();
updateBadges();
renderDashboard();
applyRoleUI();
document.body.classList.add('loaded');

// Приветствие при первом заходе
const lastVisit = localStorage.getItem('nikomi_last_visit');
const today = new Date().toDateString();
if (lastVisit !== today) {
    localStorage.setItem('nikomi_last_visit', today);
    setTimeout(() => showPersNotif('welcome'), 1000);
}

// Проверяем дедлайны
setTimeout(() => checkDeadlines(), 3000);

// ===== ROLE-BASED UI =====
function applyRoleUI() {
    // Все пользователи видят одинаковый интерфейс
    // Командные проекты появляются динамически через updateTeamProjectsSidebar
    const inviteBtn = document.getElementById('inviteBtn');
    if (inviteBtn) inviteBtn.style.display = 'inline-flex';
}

// ===== INVITE =====
function openInviteModal() {
    const sel = document.getElementById('inviteProject');
    sel.innerHTML = '';
    state.projects.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.title;
        if (p.id === currentProjectId) opt.selected = true;
        sel.appendChild(opt);
    });
    openModal('inviteModal');
}

async function sendInvite() {
    const email = document.getElementById('inviteEmail').value.trim();
    const projectId = document.getElementById('inviteProject').value;
    if (!email) { showInviteStatus('Введите email участника', 'error'); return; }

    const statusEl = document.getElementById('inviteEmailStatus');

    // Проверяем существование пользователя
    showInviteStatus('Проверяем...', 'info');
    const check = await checkUserByEmail(email);

    if (!check.exists) {
        showInviteStatus('❌ Пользователь с таким email не найден', 'error');
        return;
    }

    showInviteStatus(`✅ Найден: ${check.user.name || email}`, 'success');

    const result = await inviteMember(projectId, email);
    if (result.success) {
        showInviteStatus(`✅ Участник добавлен!`, 'success');
        // Добавляем в локальный state
        const project = state.projects.find(p => p.id === projectId);
        if (project) {
            if (!project.members) project.members = [];
            if (!project.members.includes(email)) project.members.push(email);
        }
        setTimeout(() => {
            closeModal('inviteModal');
            document.getElementById('inviteEmail').value = '';
            renderProjects();
        }, 1500);
    } else {
        showInviteStatus('❌ Ошибка: ' + result.error, 'error');
    }
}

function showInviteStatus(msg, type) {
    let el = document.getElementById('inviteEmailStatus');
    if (!el) return;
    el.textContent = msg;
    el.style.display = 'block';
    el.style.color = type === 'error' ? '#c62828' : type === 'success' ? '#2e7d32' : 'var(--text-secondary)';
    el.style.background = type === 'error' ? 'rgba(229,115,115,0.1)' : type === 'success' ? 'rgba(76,175,80,0.1)' : 'rgba(58,176,168,0.1)';
}


// ===== NOTIFICATIONS PANEL =====
function buildNotifications() {
    const today = new Date(); today.setHours(0,0,0,0);
    const notifs = [];

    // Просроченные задачи
    state.tasks.forEach(t => {
        if (!t.due_date || t.status === 'done') return;
        const d = new Date(t.due_date); d.setHours(0,0,0,0);
        const diff = Math.ceil((d - today) / (1000*60*60*24));
        if (diff < 0) {
            notifs.push({ icon: 'fa-exclamation-circle', color: '#E57373', title: 'Просрочена задача', text: t.title, sub: `${Math.abs(diff)} дн. назад`, taskId: t.id });
        } else if (diff === 0) {
            notifs.push({ icon: 'fa-clock', color: '#F8C95D', title: 'Срок сегодня', text: t.title, sub: 'Нужно завершить сегодня', taskId: t.id });
        } else if (diff <= 2) {
            notifs.push({ icon: 'fa-bell', color: '#3AB0A8', title: 'Скоро дедлайн', text: t.title, sub: `Осталось ${diff} дн.`, taskId: t.id });
        }
    });

    // Просроченные проекты
    state.projects.forEach(p => {
        if (!p.deadline || p.status === 'completed') return;
        const d = new Date(p.deadline); d.setHours(0,0,0,0);
        const diff = Math.ceil((d - today) / (1000*60*60*24));
        if (diff < 0) {
            notifs.push({ icon: 'fa-folder-open', color: '#E57373', title: 'Проект просрочен', text: p.title, sub: `${Math.abs(diff)} дн. назад` });
        } else if (diff <= 3) {
            notifs.push({ icon: 'fa-flag', color: '#F8C95D', title: 'Дедлайн проекта', text: p.title, sub: `Осталось ${diff} дн.` });
        }
    });

    // Задачи на проверку (для владельцев)
    const myId = state.user?.id;
    const myProjectIds = state.projects.filter(p => p.owner_id === myId).map(p => p.id);
    const reviewCount = state.tasks.filter(t => t.status === 'review' && myProjectIds.includes(t.project_id)).length;
    if (reviewCount > 0) {
        notifs.push({ icon: 'fa-clipboard-check', color: '#A78BFA', title: 'Задачи на проверку', text: `${reviewCount} задач ждут вашей проверки`, sub: 'Нажмите чтобы перейти', section: 'review' });
    }

    return notifs;
}

function openNotifPanel() {
    const old = document.getElementById('notifPanel');
    if (old) { old.remove(); return; }

    const notifs = buildNotifications();
    const panel = document.createElement('div');
    panel.id = 'notifPanel';
    panel.className = 'notif-panel';
    panel.innerHTML = `
        <div class="notif-panel-header">
            <span><i class="fas fa-bell" style="margin-right:8px;color:var(--primary);"></i>Уведомления</span>
            <button onclick="document.getElementById('notifPanel').remove()" style="background:none;border:none;cursor:pointer;color:var(--text-secondary);font-size:14px;padding:4px;"><i class="fas fa-times"></i></button>
        </div>
        <div class="notif-panel-body">
            ${notifs.length ? notifs.map(n => `
                <div class="notif-item" onclick="${n.taskId ? `document.getElementById('notifPanel').remove();showTaskDetail('${n.taskId}')` : n.section ? `document.getElementById('notifPanel').remove();navigate('${n.section}')` : ''}">
                    <div class="notif-item-icon" style="background:${n.color}22;color:${n.color};"><i class="fas ${n.icon}"></i></div>
                    <div class="notif-item-content">
                        <div class="notif-item-title">${n.title}</div>
                        <div class="notif-item-text">${n.text}</div>
                        <div class="notif-item-sub">${n.sub}</div>
                    </div>
                </div>
            `).join('') : `
                <div style="text-align:center;padding:40px 20px;color:var(--text-secondary);">
                    <i class="fas fa-check-circle" style="font-size:36px;opacity:0.3;display:block;margin-bottom:12px;color:var(--primary);"></i>
                    <div style="font-size:14px;font-weight:600;">Всё в порядке!</div>
                    <div style="font-size:12px;margin-top:4px;">Нет новых уведомлений</div>
                </div>
            `}
        </div>
    `;
    document.body.appendChild(panel);

    // Закрываем при клике вне
    setTimeout(() => {
        document.addEventListener('click', function closePanel(e) {
            const btn = document.querySelector('.action-btn');
            if (!panel.contains(e.target) && !e.target.closest('.action-btn')) {
                panel.remove();
                document.removeEventListener('click', closePanel);
            }
        });
    }, 50);
}

function updateNotifBadge() {
    const notifs = buildNotifications();
    const badge = document.getElementById('notifBadge');
    if (badge) {
        if (notifs.length > 0) {
            badge.textContent = notifs.length;
            badge.style.display = 'inline-block';
        } else {
            badge.style.display = 'none';
        }
    }
}


async function callGroqAPI(type, data) {
    const response = await fetch('/api/groq', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, data })
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.success) {
        if (response.status === 404) {
            throw new Error('Vercel API route не найден. Сделайте новый deploy и проверьте, что api/groq.js попал в репозиторий.');
        }
        throw new Error(result?.error || `Groq API error: ${response.status}`);
    }
    return result.result;
}

function showAiError(output, message, fallbackAction = '') {
    if (!output) return;
    output.innerHTML = `
        <div style="color:#c62828;padding:16px;background:rgba(229,115,115,0.1);border-radius:10px;border:1px solid rgba(229,115,115,0.25);line-height:1.5;">
            <div style="font-weight:700;margin-bottom:4px;">Groq не ответил</div>
            <div style="font-size:13px;">${escapeHtml(message || 'Проверьте GROQ_API_KEY в Vercel и сделайте новый deploy.')}</div>
            ${fallbackAction ? `
                <button class="btn-primary" style="margin-top:12px;padding:10px 14px;background:linear-gradient(135deg,#3AB0A8,#2A9D95);" onclick="${fallbackAction}">
                    Использовать локальный вариант без Groq
                </button>
            ` : ''}
        </div>`;
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function normalizeAiPhases(result, fallbackDays, startDate = formatDateISO(new Date())) {
    const phases = Array.isArray(result) ? result : result?.phases;
    if (!Array.isArray(phases) || !phases.length) throw new Error('Groq вернул результат без этапов');

    let currentDay = 0;
    return phases.map((phase, index) => {
        const tasks = Array.isArray(phase.tasks) ? phase.tasks : [];
        const days = Math.max(1, parseInt(phase.days, 10) || Math.round((fallbackDays || 30) / phases.length));
        const normalized = {
            name: String(phase.name || `Этап ${index + 1}`),
            days,
            startDay: currentDay,
            endDay: currentDay + days,
            startDate: addDaysISO(startDate, currentDay),
            endDate: addDaysISO(startDate, currentDay + days),
            tasks: tasks.map(task => typeof task === 'string'
                ? { title: task, priority: 'medium', assignee: '' }
                : {
                    title: String(task.title || task.name || 'Новая задача'),
                    priority: ['high', 'medium', 'low'].includes(task.priority) ? task.priority : 'medium',
                    assignee: task.assignee || ''
                })
        };
        currentDay += days;
        return normalized;
    });
}
// ===== AI DECOMPOSE =====

// ???????????? ?????? AI ????????????
function switchAiMode(mode) {
    const existingBlock = document.getElementById('aiExistingBlock');
    const newBlock = document.getElementById('aiNewBlock');
    const btnExisting = document.getElementById('aiModeExisting');
    const btnNew = document.getElementById('aiModeNew');
    if (!existingBlock || !newBlock) return;
    if (mode === 'existing') {
        existingBlock.style.display = 'block';
        newBlock.style.display = 'none';
        btnExisting.style.background = 'var(--primary)';
        btnExisting.style.color = 'white';
        btnNew.style.background = 'none';
        btnNew.style.color = 'var(--text-secondary)';
    } else {
        existingBlock.style.display = 'none';
        newBlock.style.display = 'block';
        btnNew.style.background = 'var(--primary)';
        btnNew.style.color = 'white';
        btnExisting.style.background = 'none';
        btnExisting.style.color = 'var(--text-secondary)';
    }
}

function renderAiDecompose() {
    const sel = document.getElementById('aiDecomposeProject');
    if (!sel) return;
    const myId = state.user?.id;
    const myProjects = state.projects.filter(p => p.owner_id === myId);
    sel.innerHTML = '<option value="">— Выберите проект —</option>' +
        myProjects.map(p => `<option value="${p.id}">${p.title}</option>`).join('');
    const startEl = document.getElementById('aiDecomposeStartDate');
    const endEl = document.getElementById('aiDecomposeEndDate');
    if (startEl && !startEl.value) startEl.value = formatDateISO(new Date());
    if (endEl && !endEl.value) endEl.value = addDaysISO(startEl?.value, 30);
    sel.onchange = () => syncAiDateRangeFromProject(sel.value);
}

function syncAiDateRangeFromProject(projectId) {
    const project = state.projects.find(p => p.id === projectId);
    const startEl = document.getElementById('aiDecomposeStartDate');
    const endEl = document.getElementById('aiDecomposeEndDate');
    if (!startEl || !endEl || !project) return;
    if (project.start_date) startEl.value = project.start_date;
    if (project.deadline) endEl.value = project.deadline;
}

// Запуск AI прямо в модале создания проекта
async function runAiDecomposeInModal() {
    const description = document.getElementById('aiModalDecomposeInput').value.trim();
    const range = readAiDateRange('projectStartDate', 'projectDeadline');
    const days = range.days;
    const output = document.getElementById('aiModalResult');

    if (!description) {
        output.style.display = 'block';
        output.innerHTML = `<div style="color:#c62828;padding:10px 14px;background:rgba(229,115,115,0.1);border-radius:8px;font-size:13px;">Введите описание проекта</div>`;
        return;
    }

    output.style.display = 'block';
    output.innerHTML = `
        <div style="display:flex;align-items:center;gap:10px;padding:12px;background:rgba(167,139,250,0.08);border-radius:10px;">
            <div style="width:20px;height:20px;border:2px solid rgba(167,139,250,0.3);border-top-color:#A78BFA;border-radius:50%;animation:spin 0.8s linear infinite;flex-shrink:0;"></div>
            <span style="font-size:13px;color:var(--text-secondary);">AI генерирует задачи...</span>
        </div>`;

    try {
        const result = await callGroqAPI('decompose', {
            title: document.getElementById('projectName')?.value.trim() || 'Новый проект',
            description,
            days,
            startDate: range.startDate,
            endDate: range.endDate
        });
        const phases = normalizeAiPhases(result, days, range.startDate);
        window._aiModalPhases = phases;
        renderDecomposeInModal(phases);
    } catch (error) {
        console.error('Groq decomposition error:', error);
        window._aiModalPhases = normalizeAiPhases({ phases: generateMockDecomposition(description, days, range.startDate) }, days, range.startDate);
        showAiError(output, error.message, 'renderDecomposeInModal(window._aiModalPhases)');
    }
}

function renderDecomposeInModal(phases) {
    const output = document.getElementById('aiModalResult');
    const colors = ['#60B4F0', '#A78BFA', '#3AB0A8', '#F8C95D', '#4CAF50'];
    const totalTasks = phases.reduce((sum, p) => sum + p.tasks.length, 0);

    output.innerHTML = `
        <div style="background:rgba(76,175,80,0.08);border:1px solid rgba(76,175,80,0.2);border-radius:10px;padding:12px 14px;margin-bottom:10px;">
            <div style="font-size:13px;font-weight:600;color:#2e7d32;margin-bottom:4px;">✅ AI сгенерировал ${totalTasks} задач в ${phases.length} этапах</div>
            <div style="font-size:12px;color:var(--text-secondary);">Задачи будут созданы автоматически после нажатия "Создать проект"</div>
        </div>
        <div style="max-height:200px;overflow-y:auto;display:flex;flex-direction:column;gap:6px;">
            ${phases.map((phase, i) => `
                <div style="padding:8px 12px;background:var(--bg-main);border-radius:8px;border-left:3px solid ${colors[i % colors.length]};">
                    <div style="font-size:12px;font-weight:700;color:var(--text-primary);margin-bottom:4px;">${escapeHtml(phase.name)} · ${formatDate(phase.startDate)}–${formatDate(phase.endDate)}</div>
                    <div style="font-size:11px;color:var(--text-secondary);">${phase.tasks.map(t => escapeHtml(t.title)).join(' · ')}</div>
                </div>
            `).join('')}
        </div>
        <button type="button" onclick="window._aiModalPhases = null; document.getElementById('aiModalResult').style.display='none'; document.getElementById('aiModalDecomposeInput').value='';" 
            style="margin-top:8px;background:none;border:none;color:var(--text-secondary);font-size:12px;cursor:pointer;padding:4px;">
            ✕ Отменить генерацию
        </button>
    `;
}

async function runAiDecompose() {
    const newBlock = document.getElementById('aiNewBlock');
    const isNewMode = newBlock && newBlock.style.display !== 'none';
    const description = document.getElementById('aiDecomposeInput').value.trim();
    const range = readAiDateRange('aiDecomposeStartDate', 'aiDecomposeEndDate');
    const days = range.days;
    const output = document.getElementById('aiDecomposeOutput');
    let projectId = '';

    if (!description) {
        output.innerHTML = `<div style="color:#c62828;padding:16px;background:rgba(229,115,115,0.1);border-radius:10px;">Введите описание проекта</div>`;
        return;
    }
    
    if (isNewMode) {
        // ??????? ????? ??????
        const newName = document.getElementById('aiNewProjectName')?.value.trim();
        if (!newName) {
            document.getElementById('aiDecomposeOutput').innerHTML = '<div style="color:#c62828;padding:16px;background:rgba(229,115,115,0.1);border-radius:10px;">Введите название нового проекта</div>';
            return;
        }
        const result = await sbCreateProject({ title: newName, description: '', status: 'active', start_date: range.startDate, deadline: range.endDate });
        if (!result.success) {
            document.getElementById('aiDecomposeOutput').innerHTML = '<div style="color:#c62828;padding:16px;background:rgba(229,115,115,0.1);border-radius:10px;">Ошибка создания проекта: ' + result.error + '</div>';
            return;
        }
        state.projects.unshift({ ...result.project, members: [] });
        projectId = result.project.id;
        updateBadges();
        renderProjects();
    } else {
        projectId = document.getElementById('aiDecomposeProject').value;
        if (!projectId) {
            document.getElementById('aiDecomposeOutput').innerHTML = '<div style="color:#c62828;padding:16px;background:rgba(229,115,115,0.1);border-radius:10px;">Выберите проект</div>';
            return;
        }
    }
    // Показываем загрузку
    output.innerHTML = `
        <div style="text-align:center;padding:40px;">
            <div style="width:40px;height:40px;border:3px solid var(--border);border-top-color:#A78BFA;border-radius:50%;animation:spin 0.8s linear infinite;margin:0 auto 16px;"></div>
            <p style="color:var(--text-secondary);font-size:14px;">AI анализирует проект...</p>
        </div>`;

    try {
        const project = state.projects.find(p => p.id === projectId);
        const result = await callGroqAPI('decompose', {
            title: project?.title || document.getElementById('aiNewProjectName')?.value.trim() || 'Новый проект',
            description,
            days,
            startDate: range.startDate,
            endDate: range.endDate
        });
        renderDecomposeResult(normalizeAiPhases(result, days, range.startDate), projectId);
    } catch (error) {
        console.error('Groq decomposition error:', error);
        window._aiDecomposeFallback = {
            phases: normalizeAiPhases({ phases: generateMockDecomposition(description, days, range.startDate) }, days, range.startDate),
            projectId
        };
        showAiError(output, error.message, 'renderDecomposeResult(window._aiDecomposeFallback.phases, window._aiDecomposeFallback.projectId)');
    }
}

function generateMockDecomposition(description, totalDays, startDate = formatDateISO(new Date())) {
    const phases = [
        { name: 'Анализ и планирование', percent: 15, tasks: ['Сбор требований', 'Анализ конкурентов', 'Составление ТЗ', 'Планирование архитектуры'] },
        { name: 'Дизайн', percent: 20, tasks: ['Wireframes', 'UI/UX дизайн', 'Прототипирование', 'Согласование дизайна'] },
        { name: 'Разработка', percent: 45, tasks: ['Настройка окружения', 'Разработка backend', 'Разработка frontend', 'Интеграция компонентов'] },
        { name: 'Тестирование', percent: 15, tasks: ['Unit тесты', 'Интеграционное тестирование', 'Исправление багов', 'Нагрузочное тестирование'] },
        { name: 'Запуск', percent: 5, tasks: ['Деплой', 'Документация', 'Обучение пользователей'] }
    ];

    let currentDay = 0;
    return phases.map(phase => {
        const phaseDays = Math.round(totalDays * phase.percent / 100);
        const startDay = currentDay;
        currentDay += phaseDays;
        return {
            ...phase,
            startDay,
            endDay: currentDay,
            startDate: addDaysISO(startDate, startDay),
            endDate: addDaysISO(startDate, currentDay),
            days: phaseDays
        };
    });
}

function renderDecomposeResult(phases, projectId) {
    const output = document.getElementById('aiDecomposeOutput');
    const colors = ['#60B4F0', '#A78BFA', '#3AB0A8', '#F8C95D', '#4CAF50'];

    output.innerHTML = `
        <div style="margin-bottom:16px;padding:12px 16px;background:rgba(167,139,250,0.1);border-radius:10px;border-left:3px solid #A78BFA;">
            <div style="font-size:13px;font-weight:600;color:#7C3AED;">✨ AI предлагает ${phases.length} этапов</div>
            <div style="font-size:12px;color:var(--text-secondary);margin-top:2px;">Результат сгенерирован через Groq</div>
        </div>
        ${phases.map((phase, i) => `
            <div style="margin-bottom:16px;border:1px solid var(--border);border-radius:12px;overflow:hidden;">
                <div style="padding:12px 16px;background:${colors[i % colors.length]}20;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;">
                    <div>
                        <span style="font-weight:700;color:var(--text-primary);">${i+1}. ${escapeHtml(phase.name)}</span>
                        <span style="font-size:11px;color:var(--text-secondary);margin-left:8px;">${formatDate(phase.startDate)}–${formatDate(phase.endDate)}</span>
                    </div>
                    <span style="font-size:12px;font-weight:600;color:${colors[i % colors.length]};background:${colors[i % colors.length]}20;padding:3px 10px;border-radius:10px;">${formatDate(phase.endDate)}</span>
                </div>
                <div style="padding:12px 16px;">
                    ${phase.tasks.map(t => `
                        <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border);font-size:13px;">
                            <i class="fas fa-circle" style="font-size:6px;color:${colors[i % colors.length]};"></i>
                            <span style="color:var(--text-primary);">${escapeHtml(t.title)}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        `).join('')}
        ${projectId ? `
            <button class="btn-primary" style="width:100%;margin-top:8px;background:linear-gradient(135deg,#A78BFA,#7C3AED);" onclick="applyDecomposition()">
                <i class="fas fa-check"></i> Применить — создать задачи в проекте
            </button>
        ` : ''}
    `;

    // Сохраняем результат для применения
    window._aiDecomposeResult = { phases, projectId };
}

async function applyDecomposition() {
    const data = window._aiDecomposeResult;
    if (!data || !data.projectId) return;

    const btn = event.target.closest('button');
    setBtnLoading(btn, 'Создаём задачи...');

    let created = 0;
    for (const phase of data.phases) {
        for (const task of phase.tasks) {
            const result = await sbCreateTask({
                title: task.title,
                description: `Этап: ${phase.name}`,
                status: 'todo',
                priority: task.priority || 'medium',
                project_id: data.projectId,
                due_date: null
            });
            if (result.success) {
                state.tasks.unshift(result.task);
                created++;
            }
        }
    }

    updateBadges();
    setBtnDone(btn, 'Применить', `Создано ${created} задач!`);
    showPersNotif('success', `AI создал ${created} задач для проекта! 🚀`);
}

// ===== AI DAY PLAN =====
function renderAiDay() {
    // Дата
    const dateEl = document.getElementById('aiDayDate');
    if (dateEl) dateEl.textContent = new Date().toLocaleDateString('ru-RU', { weekday:'long', day:'numeric', month:'long' });

    // Список задач пользователя
    const myId = state.user?.id;
    const myEmail = state.user?.email;
    const myTasks = state.tasks.filter(t =>
        (t.owner_id === myId || t.assignee === myEmail) &&
        t.status !== 'done' && t.status !== 'review'
    );

    const list = document.getElementById('aiDayTasksList');
    if (!list) return;

    if (!myTasks.length) {
        list.innerHTML = '<p style="font-size:13px;color:var(--text-secondary);">Нет активных задач</p>';
        return;
    }

    list.innerHTML = myTasks.map(t => {
        const project = state.projects.find(p => p.id === t.project_id);
        return `
        <div style="display:flex;align-items:center;gap:10px;padding:8px 12px;background:var(--bg-main);border-radius:8px;border:1px solid var(--border);">
            <input type="checkbox" checked data-task-id="${t.id}" style="accent-color:#A78BFA;width:16px;height:16px;">
            <div style="flex:1;min-width:0;">
                <div style="font-size:13px;font-weight:600;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${t.title}</div>
                ${project ? `<div style="font-size:11px;color:var(--text-secondary);">${project.title}</div>` : ''}
            </div>
            <span class="task-priority-badge ${t.priority}" style="flex-shrink:0;">${priorityLabel(t.priority)}</span>
        </div>`;
    }).join('');
}

function runAiDayPlan() {
    const start = document.getElementById('aiDayStart').value || '09:00';
    const end = document.getElementById('aiDayEnd').value || '18:00';
    const notes = document.getElementById('aiDayNotes').value.trim();
    const output = document.getElementById('aiDayOutput');
    const btn = document.querySelector('#ai-day-section .btn-primary');
    setBtnLoading(btn, 'Составляем план...');

    // Собираем выбранные задачи
    const checkedIds = [...document.querySelectorAll('#aiDayTasksList input[type=checkbox]:checked')]
        .map(cb => cb.dataset.taskId);

    if (!checkedIds.length) {
        output.innerHTML = `<div style="color:#c62828;padding:16px;background:rgba(229,115,115,0.1);border-radius:10px;">Выберите хотя бы одну задачу</div>`;
        setBtnDone(btn, 'Составить план дня');
        return;
    }

    output.innerHTML = `
        <div style="text-align:center;padding:40px;">
            <div style="width:40px;height:40px;border:3px solid var(--border);border-top-color:#A78BFA;border-radius:50%;animation:spin 0.8s linear infinite;margin:0 auto 16px;"></div>
            <p style="color:var(--text-secondary);font-size:14px;">AI составляет расписание...</p>
        </div>`;

    const tasks = checkedIds.map(id => state.tasks.find(t => t.id === id)).filter(Boolean);
    callGroqAPI('dayplan', {
        date: formatDateISO(new Date()),
        startTime: start,
        endTime: end,
        notes,
        tasks: tasks.map(t => ({
            title: t.title,
            description: t.description,
            priority: t.priority,
            due_date: t.due_date,
            project_deadline: state.projects.find(p => p.id === t.project_id)?.deadline || null
        }))
    }).then(async result => {
        if (!result?.schedule) throw new Error('Groq вернул результат без расписания');
        const updatedCount = await applyAiDayPlanDates(result, tasks);
        renderDayPlanFromAI(result, tasks, updatedCount);
        setBtnDone(btn, 'Составить план дня', 'План готов!');
    }).catch(error => {
        console.error('Groq day plan error:', error);
        setBtnDone(btn, 'Составить план дня');
        window._aiDayFallback = { tasks, start, end };
        showAiError(output, error.message, 'renderDayPlan(window._aiDayFallback.tasks, window._aiDayFallback.start, window._aiDayFallback.end)');
    });
}

function findTaskForAiTitle(title, tasks) {
    const normalizedTitle = normalizeTaskTitle(title);
    return tasks.find(task => normalizeTaskTitle(task.title) === normalizedTitle) ||
        tasks.find(task => normalizedTitle.includes(normalizeTaskTitle(task.title)) || normalizeTaskTitle(task.title).includes(normalizedTitle));
}

function normalizeTaskTitle(value) {
    return String(value || '').toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

async function applyAiDayPlanDates(aiResult, tasks) {
    const todayIso = formatDateISO(new Date());
    const updates = new Map();

    (aiResult.schedule || [])
        .filter(item => item.type === 'task')
        .forEach(item => {
            const task = findTaskForAiTitle(item.title, tasks);
            if (task) updates.set(task.id, todayIso);
        });

    (aiResult.carryover || []).forEach(item => {
        const task = findTaskForAiTitle(item.title, tasks);
        if (task && item.date) updates.set(task.id, item.date);
    });

    let updatedCount = 0;
    for (const [taskId, dueDate] of updates) {
        const task = state.tasks.find(t => t.id === taskId);
        if (!task || task.due_date === dueDate) continue;
        const result = await sbUpdateTask(taskId, { due_date: dueDate });
        if (result.success) {
            task.due_date = dueDate;
            updatedCount++;
        }
    }

    if (updates.size) {
        if (document.getElementById('calendar-section').classList.contains('active')) renderCalendar();
        if (document.getElementById('tasks-section').classList.contains('active')) renderAllTasks();
        if (document.getElementById('dashboard-section').classList.contains('active')) renderDashboard();
    }
    return updatedCount;
}

function renderDayPlan(tasks, startTime, endTime) {
    const output = document.getElementById('aiDayOutput');

    // Сортируем по приоритету
    const prioOrder = { high: 0, medium: 1, low: 2 };
    tasks.sort((a, b) => (prioOrder[a.priority] || 1) - (prioOrder[b.priority] || 1));

    // Распределяем время
    const [startH, startM] = startTime.split(':').map(Number);
    const [endH, endM] = endTime.split(':').map(Number);
    const totalMinutes = (endH * 60 + endM) - (startH * 60 + startM);
    const breakMinutes = 60; // обед
    const workMinutes = totalMinutes - breakMinutes;
    const timePerTask = Math.floor(workMinutes / tasks.length);

    let currentMinutes = startH * 60 + startM;
    const schedule = [];

    tasks.forEach((task, i) => {
        // Обед в середине дня
        const midpoint = startH * 60 + startM + workMinutes / 2;
        if (i > 0 && currentMinutes < midpoint && currentMinutes + timePerTask > midpoint) {
            schedule.push({ type: 'break', time: formatTime(midpoint), label: '🍽️ Обед', duration: 60 });
            currentMinutes = midpoint + 60;
        }

        const taskDuration = task.priority === 'high' ? Math.round(timePerTask * 1.3) :
                             task.priority === 'low' ? Math.round(timePerTask * 0.7) : timePerTask;

        schedule.push({
            type: 'task',
            time: formatTime(currentMinutes),
            endTime: formatTime(currentMinutes + taskDuration),
            task,
            duration: taskDuration
        });
        currentMinutes += taskDuration + 10; // 10 мин перерыв между задачами
    });

    const colors = { high: '#E57373', medium: '#F8C95D', low: '#4CAF50' };

    output.innerHTML = `
        <div style="margin-bottom:16px;padding:12px 16px;background:rgba(167,139,250,0.1);border-radius:10px;border-left:3px solid #A78BFA;">
            <div style="font-size:13px;font-weight:600;color:#7C3AED;">✨ Оптимальный план на день</div>
            <div style="font-size:12px;color:var(--text-secondary);margin-top:2px;">Локальный план без Groq</div>
        </div>
        ${schedule.map(item => item.type === 'break' ? `
            <div style="display:flex;align-items:center;gap:12px;padding:10px 14px;margin-bottom:8px;background:var(--bg-main);border-radius:10px;border:1px dashed var(--border);">
                <span style="font-size:13px;font-weight:700;color:var(--text-secondary);min-width:50px;">${item.time}</span>
                <span style="font-size:14px;">${item.label}</span>
                <span style="margin-left:auto;font-size:12px;color:var(--text-secondary);">60 мин</span>
            </div>
        ` : `
            <div style="display:flex;align-items:center;gap:12px;padding:12px 14px;margin-bottom:8px;background:var(--card);border-radius:10px;border:1px solid var(--border);border-left:4px solid ${colors[item.task.priority]};">
                <div style="min-width:50px;">
                    <div style="font-size:13px;font-weight:700;color:var(--text-primary);">${item.time}</div>
                    <div style="font-size:11px;color:var(--text-secondary);">${item.endTime}</div>
                </div>
                <div style="flex:1;">
                    <div style="font-size:14px;font-weight:600;color:var(--text-primary);">${item.task.title}</div>
                    ${item.task.description ? `<div style="font-size:12px;color:var(--text-secondary);">${item.task.description}</div>` : ''}
                </div>
                <div style="text-align:right;">
                    <span class="task-priority-badge ${item.task.priority}">${priorityLabel(item.task.priority)}</span>
                    <div style="font-size:11px;color:var(--text-secondary);margin-top:4px;">${item.duration} мин</div>
                </div>
            </div>
        `).join('')}
        <div style="margin-top:16px;padding:12px 16px;background:rgba(76,175,80,0.1);border-radius:10px;text-align:center;">
            <span style="font-size:13px;font-weight:600;color:#2e7d32;">
                <i class="fas fa-check-circle"></i> 
                Запланировано ${tasks.length} задач · ${Math.round(workMinutes/60 * 10)/10} рабочих часов
            </span>
        </div>
    `;
}


function renderDayPlanFromAI(aiResult, tasks, updatedCount = 0) {
    const output = document.getElementById('aiDayOutput');
    const schedule = aiResult.schedule || [];
    const summary = aiResult.summary || '';
    const suggestion = aiResult.suggestion || '';
    const carryover = Array.isArray(aiResult.carryover) ? aiResult.carryover : [];
    const overload = aiResult.overload || false;
    const colors = { high: '#E57373', medium: '#F8C95D', low: '#4CAF50', break: '#A78BFA', lunch: '#3AB0A8' };

    let html = '';

    // ?????????????? ? ??????????
    if (overload) {
        html += '<div style="margin-bottom:12px;padding:12px 16px;background:rgba(229,115,115,0.1);border-radius:10px;border-left:3px solid #E57373;display:flex;gap:10px;align-items:flex-start;">' +
            '<span style="font-size:18px;">!</span>' +
            '<div><div style="font-size:13px;font-weight:700;color:#c62828;margin-bottom:2px;">Внимание: день перегружен</div>' +
            '<div style="font-size:12px;color:var(--text-secondary);">' + escapeHtml(suggestion) + '</div></div></div>';
    }

    // ??????????? ?????? ?? AI
    html += '<div style="margin-bottom:16px;padding:14px 16px;background:linear-gradient(135deg,rgba(167,139,250,0.1),rgba(58,176,168,0.08));border-radius:12px;border-left:3px solid #A78BFA;display:flex;gap:10px;align-items:flex-start;">' +
        '<span style="font-size:20px;flex-shrink:0;">AI</span>' +
        '<div><div style="font-size:13px;font-weight:700;color:#7C3AED;margin-bottom:4px;">Groq AI</div>' +
        '<div style="font-size:13px;color:var(--text-primary);line-height:1.6;">' + escapeHtml(summary) + '</div></div></div>';

    // ??????????
    html += schedule.map(item => {
        const isBreak = item.type === 'break' || item.type === 'lunch';
        const color = isBreak ? (item.type === 'lunch' ? colors.lunch : colors.break) : (colors[item.priority] || '#3AB0A8');
        const bg = isBreak ? 'rgba(167,139,250,0.06)' : 'var(--card)';
        const icon = item.type === 'lunch' ? 'Обед' : item.type === 'break' ? 'Перерыв' : '';

        return '<div style="display:flex;align-items:flex-start;gap:12px;padding:12px 14px;margin-bottom:8px;background:' + bg + ';border-radius:12px;border:1px solid var(--border);border-left:4px solid ' + color + ';">' +
            '<div style="min-width:52px;flex-shrink:0;"><div style="font-size:13px;font-weight:700;color:var(--text-primary);">' + escapeHtml(item.time) + '</div><div style="font-size:11px;color:var(--text-secondary);">' + escapeHtml(item.endTime) + '</div></div>' +
            '<div style="flex:1;min-width:0;">' +
            '<div style="font-size:14px;font-weight:600;color:var(--text-primary);">' + (icon ? icon + ': ' : '') + escapeHtml(item.title) + '</div>' +
            (item.tip ? '<div style="font-size:12px;color:var(--text-secondary);margin-top:3px;line-height:1.4;">Совет: ' + escapeHtml(item.tip) + '</div>' : '') +
            '</div>' +
            '<div style="text-align:right;flex-shrink:0;"><div style="font-size:11px;color:var(--text-secondary);">' + escapeHtml(item.duration) + ' мин</div></div>' +
            '</div>';
    }).join('');

    if (suggestion || carryover.length) {
        html += '<div style="margin-top:14px;padding:14px 16px;background:rgba(58,176,168,0.08);border-radius:12px;border:1px solid rgba(58,176,168,0.22);">' +
            '<div style="font-size:13px;font-weight:700;color:#25847d;margin-bottom:8px;"><i class="fas fa-lightbulb" style="margin-right:6px;"></i>Советы и переносы</div>' +
            (suggestion ? '<div style="font-size:12px;color:var(--text-primary);line-height:1.55;margin-bottom:10px;">' + escapeHtml(suggestion) + '</div>' : '') +
            (carryover.length ? '<div style="display:flex;flex-direction:column;gap:6px;">' + carryover.map(item =>
                '<div style="display:flex;gap:8px;align-items:flex-start;padding:8px 10px;background:var(--card);border-radius:8px;border:1px solid var(--border);">' +
                    '<i class="fas fa-calendar-plus" style="color:#3AB0A8;margin-top:2px;"></i>' +
                    '<div style="flex:1;min-width:0;">' +
                        '<div style="font-size:12px;font-weight:700;color:var(--text-primary);">' + escapeHtml(item.title) + '</div>' +
                        '<div style="font-size:11px;color:var(--text-secondary);line-height:1.4;">' + escapeHtml(formatDate(item.date || '') || item.date || '') + (item.reason ? ' · ' + escapeHtml(item.reason) : '') + '</div>' +
                    '</div>' +
                '</div>'
            ).join('') + '</div>' : '') +
            '<div style="font-size:11px;color:var(--text-secondary);margin-top:10px;">' + (updatedCount ? 'Обновлено дат в календаре: ' + updatedCount + '.' : 'Советы готовы; даты уже совпадали или не потребовали изменений.') + '</div>' +
        '</div>';
    }

    // ???? 
    html += '<div style="margin-top:16px;padding:14px 16px;background:rgba(76,175,80,0.08);border-radius:12px;border:1px solid rgba(76,175,80,0.2);text-align:center;">' +
        '<span style="font-size:13px;font-weight:600;color:#2e7d32;">Запланировано блоков: ' + schedule.length + '</span></div>';

    output.innerHTML = html;
}

function formatTime(minutes) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
}
const isDark = localStorage.getItem('nikomi_theme') === 'dark';
if (isDark) applyTheme(true);

function applyTheme(dark) {
    document.body.classList.toggle('dark', dark);
    document.getElementById('themeIcon').textContent = dark ? '☀️' : '🌙';
    document.getElementById('themeLabel').textContent = dark ? 'Светлая тема' : 'Тёмная тема';
    localStorage.setItem('nikomi_theme', dark ? 'dark' : 'light');
}

document.getElementById('themeToggleBtn').addEventListener('click', () => {
    const isDarkNow = document.body.classList.contains('dark');
    applyTheme(!isDarkNow);
});

// ===== START =====
init();

// ===== ЭКСПОРТ В ГЛОБАЛЬНУЮ ОБЛАСТЬ =====
// Нужно потому что main.js — ES модуль, onclick не видит функции модуля
Object.assign(window, {
    openModal, closeModal, navigate, goHome,
    saveProject, saveEditProject, deleteProject, deleteProjectDirect,
    openProjectDetail, openEditProjectModal, showProjectDetailModal,
    addMemberToProject, removeMemberFromProject,
    saveTask, changeTaskStatus, deleteTask, openTaskModalForProject,
    showTaskDetail, openEditTaskModal,
    saveNote, deleteNote,
    openInviteModal, sendInvite,
    saveSettings,
    changeMonth, openCalendarDay,
    closePersNotif,
    setTaskFilter, setTaskStatFilter,
    sendToReview, approveTask, rejectTask, closeRejectTaskModal, submitRejectTask,
    runAiDecompose, applyDecomposition, switchAiMode,
    runAiDayPlan, runAiDecomposeInModal,
    openNotifPanel,
    addAttachmentLink, uploadAttachmentFile, removeAttachment, saveLinkAttachment,
    submitComment, removeComment,
    openEmojiPicker, selectEmoji,
});

