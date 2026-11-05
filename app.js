/**
 * My Roadmap Tracker — AI Automation Engineer Learning System
 * Production-Grade Vanilla JavaScript ES6+ Application
 */
(() => {
  'use strict';

  // ==========================================================================
  // CONSTANTS & CURRICULUM ACCESS
  // ==========================================================================
  const STORAGE_KEY = 'learningTrackerData_v1';
  const CURRICULUM = window.TRACKER_CURRICULUM || { weeks: [], projects: [] };

  const $ = (id) => document.getElementById(id);
  const esc = (val) => String(val ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));

  // Role Normalization Helper (Guarantees backward compatibility with tuple & object forms)
  function normalizeRole(role) {
    if (Array.isArray(role)) {
      return {
        name: role[0] || 'Specialist',
        scope: role[1] || '',
        tasks: Array.isArray(role[2]) ? role[2] : []
      };
    }
    return {
      name: role?.name || 'Specialist',
      scope: role?.scope || '',
      tasks: Array.isArray(role?.tasks) ? role.tasks : []
    };
  }

  // ==========================================================================
  // CENTRALIZED STATE MANAGEMENT & LOCALSTORAGE
  // ==========================================================================
  function freshData() {
    return {
      version: 1,
      theme: 'dark',
      activeView: 'roadmap',
      activeWeekId: 1,
      activeProjectId: 'p1',
      showOnlyIncomplete: false,
      weeks: {},          // { [weekId]: { checks: {}, notes: {}, ideas: {} } }
      projects: {},       // { [projectId]: { checks: {}, notes: {}, blockers: [], reflections: {} } }
      artifacts: {},      // { [projectId]: { github, demo, design, readme, video, testReport, evalReport, metrics } }
      customTasks: [],    // [ { id, title, priority, date, completed, status } ]
      taskOverrides: {},  // { [taskKey]: { priority, status, date } }
      focusSessions: [],  // [ { id, durationMinutes, date, topic, tagType, tagId } ]
      revisions: {},      // { [topicKey]: { title, weekId, dayIndex, confidence, dueDate, history: [] } }
      notesVault: [],     // [ { id, title, category, content, codeSnippet, tags, linkedWeek, isFavorite, createdAt, updatedAt } ]
      weeklyReviews: {},  // { [weekId]: { answers: [], completedAt } }
      skills: {},         // { [skillName]: { level, status, evidence } }
      career: {
        resumeChecklist: {},
        linkedinChecklist: {},
        interviewPrep: {},
        applications: []
      },
      activityLog: [],
      lastBackupAt: null,
      updatedAt: new Date().toISOString()
    };
  }

  function loadData() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return freshData();
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return freshData();
      return {
        ...freshData(),
        ...parsed,
        version: 1,
        career: { ...freshData().career, ...(parsed.career || {}) }
      };
    } catch (err) {
      console.warn('Tracker storage could not be parsed; starting with fresh state.', err);
      return freshData();
    }
  }

  // Reactive Application Runtime State
  const state = {
    data: loadData(),
    searchQuery: '',
    searchFilter: 'all',
    saveTimer: null,
    toastTimer: null,
    timerInterval: null,
    timerSecondsLeft: 25 * 60,
    timerTotalSeconds: 25 * 60,
    timerIsRunning: false,
    timerTag: { type: 'general', id: null, topic: 'General Study' },
    isFocusMode: false
  };

  function persist(immediate = false) {
    clearTimeout(state.saveTimer);
    const write = () => {
      try {
        state.data.updatedAt = new Date().toISOString();
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data));
        updateStorageStatusNotice();
      } catch (err) {
        showToast('Storage write failed. Storage might be full or disabled.');
        console.error(err);
      }
    };
    if (immediate) write();
    else state.saveTimer = setTimeout(write, 300);
  }

  function logActivity(type, text) {
    const entry = {
      id: 'act-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      type,
      text,
      timestamp: new Date().toISOString()
    };
    if (!state.data.activityLog) state.data.activityLog = [];
    state.data.activityLog.unshift(entry);
    if (state.data.activityLog.length > 200) state.data.activityLog.pop();
    persist();
  }

  // ==========================================================================
  // CURRICULUM ACCESS & METRIC CALCULATIONS
  // ==========================================================================
  function getWeekData(weekId) {
    const key = String(weekId);
    if (!state.data.weeks[key]) {
      state.data.weeks[key] = { checks: {}, notes: {}, ideas: {} };
    }
    return state.data.weeks[key];
  }

  function getProjectData(projectId) {
    const key = String(projectId);
    if (!state.data.projects[key]) {
      state.data.projects[key] = { checks: {}, notes: {}, blockers: [], reflections: {} };
    }
    return state.data.projects[key];
  }

  function taskKey(dayIndex, group, taskIndex) {
    return `${dayIndex}-${group}-${taskIndex}`;
  }

  function weekTaskCount(week) {
    if (!week || !Array.isArray(week.days)) return 0;
    return week.days.reduce((sum, d) => sum + (d.theory?.length || 0) + (d.practice?.length || 0), 0);
  }

  function weekDoneCount(weekId) {
    const week = CURRICULUM.weeks.find(w => String(w.id) === String(weekId));
    if (!week) return 0;
    const checks = getWeekData(weekId).checks || {};
    return week.days.reduce((sum, day, di) => {
      const t = (day.theory || []).filter((_, ti) => checks[taskKey(di, 't', ti)]).length;
      const p = (day.practice || []).filter((_, pi) => checks[taskKey(di, 'p', pi)]).length;
      return sum + t + p;
    }, 0);
  }

  function projectTaskCount(project) {
    if (!project || !Array.isArray(project.roles)) return 0;
    return project.roles.reduce((sum, r) => sum + normalizeRole(r).tasks.length, 0);
  }

  function projectDoneCount(projectId) {
    const project = CURRICULUM.projects.find(p => p.id === projectId);
    if (!project) return 0;
    const checks = getProjectData(projectId).checks || {};
    return project.roles.reduce((sum, r, ri) => {
      const role = normalizeRole(r);
      const done = role.tasks.filter((_, ti) => checks[`${ri}-${ti}`]).length;
      return sum + done;
    }, 0);
  }

  function calculateAllCounts() {
    let done = 0, total = 0, theoryDone = 0, theoryTotal = 0, practiceDone = 0, practiceTotal = 0;
    let completedDays = 0, totalDays = 0;

    CURRICULUM.weeks.forEach(w => {
      const checks = getWeekData(w.id).checks || {};
      w.days.forEach((d, di) => {
        totalDays++;
        const dTheory = (d.theory || []).length;
        const dPractice = (d.practice || []).length;
        const dTDone = (d.theory || []).filter((_, ti) => checks[taskKey(di, 't', ti)]).length;
        const dPDone = (d.practice || []).filter((_, pi) => checks[taskKey(di, 'p', pi)]).length;

        theoryTotal += dTheory;
        theoryDone += dTDone;
        practiceTotal += dPractice;
        practiceDone += dPDone;

        total += dTheory + dPractice;
        done += dTDone + dPDone;

        if (dTheory + dPractice > 0 && (dTDone + dPDone === dTheory + dPractice)) {
          completedDays++;
        }
      });
    });

    let projectsCompleted = 0;
    CURRICULUM.projects.forEach(p => {
      const pTotal = projectTaskCount(p);
      const pDone = projectDoneCount(p.id);
      total += pTotal;
      done += pDone;
      if (pTotal > 0 && pDone === pTotal) {
        projectsCompleted++;
      }
    });

    const percent = total > 0 ? Math.round((done / total) * 100) : 0;
    return {
      done, total, percent,
      theoryDone, theoryTotal,
      practiceDone, practiceTotal,
      completedDays, totalDays,
      projectsCompleted,
      totalProjects: CURRICULUM.projects.length
    };
  }

  function calculateStreak() {
    const dates = new Set();
    // Gather dates from activityLog and focusSessions
    (state.data.activityLog || []).forEach(a => {
      if (a.timestamp) dates.add(a.timestamp.slice(0, 10));
    });
    (state.data.focusSessions || []).forEach(s => {
      if (s.date) dates.add(s.date.slice(0, 10));
    });

    if (dates.size === 0) return 0;

    let streak = 0;
    let checkDate = new Date();

    // Check today first
    const todayStr = checkDate.toISOString().slice(0, 10);
    if (!dates.has(todayStr)) {
      // If not today, check yesterday
      checkDate.setDate(checkDate.getDate() - 1);
      const yesterdayStr = checkDate.toISOString().slice(0, 10);
      if (!dates.has(yesterdayStr)) return 0;
    }

    while (true) {
      const str = checkDate.toISOString().slice(0, 10);
      if (dates.has(str)) {
        streak++;
        checkDate.setDate(checkDate.getDate() - 1);
      } else {
        break;
      }
    }
    return streak;
  }

  function calculateTotalFocusMinutes() {
    return (state.data.focusSessions || []).reduce((acc, s) => acc + (s.durationMinutes || 0), 0);
  }

  // ==========================================================================
  // NAVIGATION & VIEW ROUTING
  // ==========================================================================
  function navigateTo(view, subId = null) {
    state.data.activeView = view;
    if ((view === 'week' || view === 'roadmap') && subId !== null) {
      state.data.activeWeekId = Number(subId);
    }
    if (view === 'project' && subId !== null) {
      state.data.activeProjectId = String(subId);
    }
    persist();
    renderApp();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    $('sidebar').classList.remove('open');
  }

  function updateBreadcrumbs() {
    const view = state.data.activeView;
    const current = $('breadcrumbCurrent');
    if (!current) return;

    if (view === 'dashboard') current.textContent = 'Dashboard';
    else if (view === 'roadmap' || view === 'week') current.textContent = 'Roadmap Weeks (1–16)';
    else if (view === 'my-day') current.textContent = 'My Day — Smart Daily Planner';
    else if (view === 'timer') current.textContent = 'Study Timer & Focus Sessions';
    else if (view === 'revisions') current.textContent = 'Revision Center (Spaced Repetition)';
    else if (view === 'analytics') current.textContent = 'Analytics & Heatmap';
    else if (view === 'vault') current.textContent = 'Knowledge Vault & Code Journal';
    else if (view === 'reviews') current.textContent = 'Weekly Reviews & Reflections';
    else if (view === 'skills') current.textContent = 'Skills Matrix & Confidence';
    else if (view === 'career') current.textContent = 'Career Readiness & Job Tracker';
    else if (view === 'settings') current.textContent = 'Settings & Data Backup';
    else if (view === 'project') {
      const p = CURRICULUM.projects.find(x => x.id === state.data.activeProjectId);
      current.textContent = p ? p.title.replace(/^Project \d+ — /, '').replace(/^Capstone — /, 'Capstone: ') : 'Project Workspace';
    }
  }

  // ==========================================================================
  // HEADER & SIDEBAR RENDERING
  // ==========================================================================
  function renderSidebar() {
    const activeView = state.data.activeView;

    // Update active state on static nav items
    document.querySelectorAll('.sidebar .nav-item[data-view]').forEach(btn => {
      const v = btn.dataset.view;
      const isRoadmapView = (v === 'roadmap' && (activeView === 'roadmap' || activeView === 'week'));
      if (((v === activeView && activeView !== 'week' && activeView !== 'project') || isRoadmapView)) {
        btn.classList.add('active');
        btn.setAttribute('aria-current', 'page');
      } else {
        btn.classList.remove('active');
        btn.removeAttribute('aria-current');
      }
    });

    // Render Weeks Accordion
    const roadmapNav = $('roadmapNav');
    if (roadmapNav) {
      roadmapNav.innerHTML = CURRICULUM.weeks.map(w => {
        const total = weekTaskCount(w);
        const done = weekDoneCount(w.id);
        const pct = total ? Math.round((done / total) * 100) : 0;
        const isActive = (activeView === 'week' || activeView === 'roadmap') && state.data.activeWeekId === w.id;
        const isDone = total > 0 && done === total;
        return `
          <button class="nav-item ${isActive ? 'active' : ''}" data-nav-week="${w.id}">
            <span class="nav-icon">${isDone ? '✓' : String(w.id).padStart(2, '0')}</span>
            <span style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">Week ${w.id}: ${esc(w.title)}</span>
            <span class="nav-badge ${isDone ? 'alert-badge' : ''}">${pct}%</span>
          </button>
        `;
      }).join('');
    }

    // Render Projects Nav
    const projectNav = $('projectNav');
    if (projectNav) {
      const icons = ['◈', '⌘', '▤', '✦', '⬡'];
      projectNav.innerHTML = CURRICULUM.projects.map((p, i) => {
        const total = projectTaskCount(p);
        const done = projectDoneCount(p.id);
        const pct = total ? Math.round((done / total) * 100) : 0;
        const isActive = activeView === 'project' && state.data.activeProjectId === p.id;
        const isDone = total > 0 && done === total;
        const cleanTitle = p.title.replace(/^Project \d+ — /, '').replace(/^Capstone — /, 'Capstone: ');
        return `
          <button class="nav-item ${isActive ? 'active' : ''}" data-nav-project="${p.id}">
            <span class="nav-icon">${isDone ? '✓' : icons[i % icons.length]}</span>
            <span style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esc(cleanTitle)}</span>
            <span class="nav-badge ${isDone ? 'alert-badge' : ''}">${pct}%</span>
          </button>
        `;
      }).join('');
    }

    // Dynamic Due Badges in Sidebar
    const todayStr = new Date().toISOString().slice(0, 10);
    const revDue = Object.values(state.data.revisions || {}).filter(r => r.dueDate && r.dueDate <= todayStr && r.needsRevision).length;
    const revBadge = $('revisionsDueBadge');
    if (revBadge) {
      revBadge.hidden = revDue === 0;
      revBadge.textContent = revDue;
    }

    // Timer Running Dot Indicator
    const timerDot = $('timerRunningIndicator');
    if (timerDot) {
      timerDot.hidden = !state.timerIsRunning;
    }

    // Attach Click Events to dynamic nav buttons
    document.querySelectorAll('[data-nav-week]').forEach(b => {
      b.onclick = () => navigateTo('roadmap', Number(b.dataset.navWeek));
    });
    document.querySelectorAll('[data-nav-project]').forEach(b => {
      b.onclick = () => navigateTo('project', b.dataset.navProject);
    });
  }

  function renderHeaderOverview() {
    const c = calculateAllCounts();
    const streak = calculateStreak();
    const focusMins = calculateTotalFocusMinutes();
    const focusHours = (focusMins / 60).toFixed(1);

    const overallPercent = $('overallPercent');
    if (overallPercent) overallPercent.textContent = `${c.percent}%`;

    const overallBar = $('overallBar');
    if (overallBar) overallBar.style.width = `${c.percent}%`;

    const overallCounts = $('overallCounts');
    if (overallCounts) overallCounts.textContent = `${c.done} of ${c.total} tasks completed`;

    const overallHours = $('overallHoursSpent');
    if (overallHours) overallHours.textContent = `${focusHours}h focused`;

    const streakPill = $('headerStreakPill');
    if (streakPill) streakPill.textContent = `🔥 ${streak}-day streak`;

    const dateDisplay = $('currentDateDisplay');
    if (dateDisplay) {
      const today = new Date();
      dateDisplay.textContent = today.toLocaleDateString('en-US', {
        weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'
      });
    }

    // Motivational Greeting
    const greeting = $('headerGreeting');
    if (greeting) {
      if (c.percent === 100) {
        greeting.innerHTML = `Roadmap 100% Complete! <span>You are an AI Automation Engineer.</span>`;
      } else if (c.percent > 50) {
        greeting.innerHTML = `Past the halfway mark! <span>${c.percent}% completed.</span>`;
      } else if (c.percent > 0) {
        greeting.innerHTML = `Consistent focus wins. <span>${c.percent}% roadmap progress.</span>`;
      } else {
        greeting.innerHTML = `Build skills. Ship projects. <span>Become an AI Engineer.</span>`;
      }
    }
  }

  function updateStorageStatusNotice() {
    const notice = $('lastSavedNotice');
    if (notice) {
      const now = new Date();
      notice.textContent = `Saved locally at ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
    }
  }

  // ==========================================================================
  // VIEW RENDERER 1: DASHBOARD HOME
  // ==========================================================================
  function renderDashboard() {
    const c = calculateAllCounts();
    const streak = calculateStreak();
    const focusHours = (calculateTotalFocusMinutes() / 60).toFixed(1);

    // Find first incomplete day for "Continue Learning"
    let nextDay = null;
    for (const w of CURRICULUM.weeks) {
      const checks = getWeekData(w.id).checks || {};
      for (let di = 0; di < w.days.length; di++) {
        const d = w.days[di];
        const tTotal = (d.theory?.length || 0) + (d.practice?.length || 0);
        const tDone = (d.theory || []).filter((_, ti) => checks[taskKey(di, 't', ti)]).length +
                      (d.practice || []).filter((_, pi) => checks[taskKey(di, 'p', pi)]).length;
        if (tTotal > 0 && tDone < tTotal) {
          nextDay = { weekId: w.id, weekTitle: w.title, dayIndex: di, day: d, done: tDone, total: tTotal };
          break;
        }
      }
      if (nextDay) break;
    }

    return `
      <!-- Top Level Analytics Cards -->
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-card-top"><span>Roadmap Completion</span><span class="stat-icon">📈</span></div>
          <div class="stat-value">${c.percent}%</div>
          <div class="stat-subtext">${c.done} / ${c.total} total tasks</div>
        </div>
        <div class="stat-card">
          <div class="stat-card-top"><span>Completed Days</span><span class="stat-icon">📅</span></div>
          <div class="stat-value">${c.completedDays} / ${c.totalDays}</div>
          <div class="stat-subtext">${Math.round((c.completedDays / c.totalDays) * 100)}% of journey</div>
        </div>
        <div class="stat-card">
          <div class="stat-card-top"><span>Theory Concepts</span><span class="stat-icon">🧠</span></div>
          <div class="stat-value">${c.theoryDone} / ${c.theoryTotal}</div>
          <div class="stat-subtext">${c.theoryTotal ? Math.round((c.theoryDone / c.theoryTotal) * 100) : 0}% mastered</div>
        </div>
        <div class="stat-card">
          <div class="stat-card-top"><span>Coding Exercises</span><span class="stat-icon">💻</span></div>
          <div class="stat-value">${c.practiceDone} / ${c.practiceTotal}</div>
          <div class="stat-subtext">${c.practiceTotal ? Math.round((c.practiceDone / c.practiceTotal) * 100) : 0}% executed</div>
        </div>
        <div class="stat-card">
          <div class="stat-card-top"><span>Projects Shipped</span><span class="stat-icon">🚀</span></div>
          <div class="stat-value">${c.projectsCompleted} / ${c.totalProjects}</div>
          <div class="stat-subtext">5 major portfolio deliverables</div>
        </div>
        <div class="stat-card">
          <div class="stat-card-top"><span>Current Streak</span><span class="stat-icon">🔥</span></div>
          <div class="stat-value">${streak} Days</div>
          <div class="stat-subtext">Consistency metric</div>
        </div>
        <div class="stat-card">
          <div class="stat-card-top"><span>Focus Time</span><span class="stat-icon">⏱️</span></div>
          <div class="stat-value">${focusHours}h</div>
          <div class="stat-subtext">${(state.data.focusSessions || []).length} focus sessions</div>
        </div>
      </div>

      <!-- Continue Learning Card -->
      ${nextDay ? `
        <div class="continue-card">
          <div class="continue-info">
            <span class="continue-badge">CONTINUE YOUR LEARNING</span>
            <div class="continue-title">Week ${nextDay.weekId}: Day ${nextDay.day.dayNumber || (nextDay.dayIndex + 1)} — ${esc(nextDay.day.title)}</div>
            <div class="continue-desc">${esc(nextDay.weekTitle)} · ${nextDay.done} of ${nextDay.total} tasks completed (${Math.round((nextDay.done / nextDay.total) * 100)}%)</div>
          </div>
          <button class="button button-primary" onclick="window.trackerNavigate('week', ${nextDay.weekId})">
            Continue Day ${nextDay.day.dayNumber || (nextDay.dayIndex + 1)} →
          </button>
        </div>
      ` : `
        <div class="continue-card" style="border-left-color: var(--green);">
          <div class="continue-info">
            <span class="continue-badge" style="color: var(--green);">🎉 CONGRATULATIONS!</span>
            <div class="continue-title">Every Single Day in the Roadmap is Complete!</div>
            <div class="continue-desc">You have finished all daily lessons, exercises, and projects. Review your portfolio and career readiness.</div>
          </div>
          <button class="button button-primary" onclick="window.trackerNavigate('career')">Open Career Dashboard →</button>
        </div>
      `}

      <!-- Weekly Overview Grid -->
      <section class="section-box">
        <div class="section-head">
          <div>
            <h2 class="section-title">Roadmap Curriculum (16 Weeks)</h2>
            <p class="section-sub">Select any week to access daily concepts, exercises, and reflection notes.</p>
          </div>
        </div>
        <div class="weeks-grid">
          ${CURRICULUM.weeks.map(w => {
            const total = weekTaskCount(w);
            const done = weekDoneCount(w.id);
            const pct = total ? Math.round((done / total) * 100) : 0;
            const statusClass = done === 0 ? 'not-started' : (done === total ? 'completed' : 'in-progress');
            const statusLabel = done === 0 ? 'Not Started' : (done === total ? 'Completed' : 'In Progress');
            return `
              <div class="week-tile" onclick="window.trackerNavigate('week', ${w.id})">
                <div class="week-tile-top">
                  <span class="week-tile-num">WEEK ${String(w.id).padStart(2, '0')}</span>
                  <span class="status-pill ${statusClass}">${statusLabel}</span>
                </div>
                <div class="week-tile-title">${esc(w.title)}</div>
                <div class="week-tile-phase">${esc(w.phase)}</div>
                <div class="progress-track" style="margin: 4px 0;">
                  <div class="progress-fill" style="width: ${pct}%"></div>
                </div>
                <div class="week-tile-foot">
                  <span>${done}/${total} tasks</span>
                  <strong>${pct}%</strong>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </section>

      <!-- Projects Section Grid -->
      <section class="section-box">
        <div class="section-head">
          <div>
            <h2 class="section-title">Portfolio Projects (5 Workspaces)</h2>
            <p class="section-sub">End-to-end automation systems, agent supervisors, and production SaaS.</p>
          </div>
        </div>
        <div class="projects-grid">
          ${CURRICULUM.projects.map(p => {
            const total = projectTaskCount(p);
            const done = projectDoneCount(p.id);
            const pct = total ? Math.round((done / total) * 100) : 0;
            const isDone = total > 0 && done === total;
            return `
              <div class="project-card">
                <div class="project-card-header">
                  <div class="project-card-title">${esc(p.title)}</div>
                  <span class="status-pill ${isDone ? 'completed' : (done > 0 ? 'in-progress' : 'not-started')}">
                    ${isDone ? 'Shipped' : (done > 0 ? `${pct}%` : 'Planned')}
                  </span>
                </div>
                <p class="project-card-obj">${esc(p.objective)}</p>
                <div class="chip-list">
                  ${(p.stack || []).slice(0, 4).map(s => `<span class="chip">${esc(s)}</span>`).join('')}
                  ${(p.stack || []).length > 4 ? `<span class="chip">+${p.stack.length - 4}</span>` : ''}
                </div>
                <div class="progress-track" style="margin: 4px 0;">
                  <div class="progress-fill" style="width: ${pct}%"></div>
                </div>
                <div style="display:flex; justify-content:space-between; align-items:center; margin-top:auto;">
                  <span style="font-size:11px; color:var(--muted);">${done}/${total} tasks</span>
                  <button class="button button-sm button-soft" onclick="window.trackerNavigate('project', '${p.id}')">
                    Open Workspace →
                  </button>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </section>

      <!-- Recent Activity Feed -->
      <section class="section-box">
        <div class="section-head">
          <div>
            <h2 class="section-title">Recent Learning Activity</h2>
            <p class="section-sub">Chronological timeline of checked tasks, sessions, and notes.</p>
          </div>
        </div>
        <div class="planner-task-list">
          ${(state.data.activityLog || []).slice(0, 8).map(act => `
            <div class="planner-task-card" style="padding: 10px 14px;">
              <div class="planner-task-left">
                <span style="font-size:14px;">${act.type === 'task_completed' ? '✓' : '●'}</span>
                <div>
                  <div style="font-size:12px; font-weight:600;">${esc(act.text)}</div>
                  <div style="font-size:10px; color:var(--muted);">${new Date(act.timestamp).toLocaleString()}</div>
                </div>
              </div>
            </div>
          `).join('') || `
            <div class="planner-task-card" style="justify-content:center; color:var(--muted); font-size:12px;">
              No activity recorded yet. Start by checking off a daily task or logging a focus session!
            </div>
          `}
        </div>
      </section>
    `;
  }

  // ==========================================================================
  // VIEW RENDERER 2: SMART DAILY PLANNER ("MY DAY")
  // ==========================================================================
  function renderMyDay() {
    const todayStr = new Date().toISOString().slice(0, 10);
    const filter = state.plannerFilter || 'all';

    // Collect daily tasks from current incomplete day or designated day
    const allPlannerTasks = [];

    // 1. Add curriculum tasks from current active or incomplete week
    CURRICULUM.weeks.forEach(w => {
      const checks = getWeekData(w.id).checks || {};
      w.days.forEach((d, di) => {
        // Theory tasks
        (d.theory || []).forEach((tText, ti) => {
          const key = `w${w.id}-d${di}-t${ti}`;
          const isDone = Boolean(checks[taskKey(di, 't', ti)]);
          const override = state.data.taskOverrides[key] || {};
          allPlannerTasks.push({
            id: key,
            type: 'curriculum',
            source: `Week ${w.id} · Day ${d.dayNumber || (di + 1)}`,
            title: tText,
            category: 'Theory',
            completed: isDone,
            priority: override.priority || 'med',
            status: isDone ? 'completed' : (override.status || 'not-started'),
            date: override.date || todayStr,
            weekId: w.id,
            dayIndex: di,
            group: 't',
            taskIndex: ti
          });
        });
        // Practice tasks
        (d.practice || []).forEach((pText, pi) => {
          const key = `w${w.id}-d${di}-p${pi}`;
          const isDone = Boolean(checks[taskKey(di, 'p', pi)]);
          const override = state.data.taskOverrides[key] || {};
          allPlannerTasks.push({
            id: key,
            type: 'curriculum',
            source: `Week ${w.id} · Day ${d.dayNumber || (di + 1)}`,
            title: pText,
            category: 'Practice',
            completed: isDone,
            priority: override.priority || 'high',
            status: isDone ? 'completed' : (override.status || 'not-started'),
            date: override.date || todayStr,
            weekId: w.id,
            dayIndex: di,
            group: 'p',
            taskIndex: pi
          });
        });
      });
    });

    // 2. Add custom personal tasks
    (state.data.customTasks || []).forEach(ct => {
      allPlannerTasks.push({
        id: ct.id,
        type: 'personal',
        source: 'Personal Task',
        title: ct.title,
        category: 'Custom',
        completed: Boolean(ct.completed),
        priority: ct.priority || 'med',
        status: ct.completed ? 'completed' : (ct.status || 'not-started'),
        date: ct.date || todayStr
      });
    });

    // Filter tasks for "My Day" view:
    // Show tasks scheduled for today, or overdue incomplete tasks, or matching the filter tab
    let displayTasks = allPlannerTasks.filter(t => {
      if (filter === 'all') return true;
      if (filter === 'incomplete') return !t.completed;
      if (filter === 'completed') return t.completed;
      if (filter === 'high') return t.priority === 'high';
      if (filter === 'overdue') return !t.completed && t.date < todayStr;
      if (filter === 'today') return t.date === todayStr;
      return t.status === filter;
    });

    // Limit curriculum tasks so the planner focuses on priority tasks without clutter
    if (filter === 'all' && displayTasks.length > 50) {
      displayTasks = displayTasks.filter(t => t.type === 'personal' || !t.completed || t.date === todayStr).slice(0, 40);
    }

    const todayDone = displayTasks.filter(t => t.completed).length;
    const todayTotal = displayTasks.length;
    const todayPct = todayTotal ? Math.round((todayDone / todayTotal) * 100) : 0;

    return `
      <!-- Planner Header Hero -->
      <div class="planner-hero">
        <div>
          <div class="eyebrow">
            <span>MY DAY PLANNER</span>
            <span class="live-dot"></span>
            <span>${todayStr}</span>
          </div>
          <h2 class="section-title" style="margin: 6px 0 4px;">Focused Execution for Today</h2>
          <p class="section-sub">Prioritize curriculum tasks, manage custom goals, and track daily progress.</p>
        </div>
        <div style="min-width: 180px; text-align: right;">
          <div style="font-size: 24px; font-weight: 800; color: var(--accent);">${todayDone} / ${todayTotal}</div>
          <div style="font-size: 11px; color: var(--muted);">${todayPct}% daily completion</div>
          <div class="progress-track" style="margin-top: 8px;">
            <div class="progress-fill" style="width: ${todayPct}%"></div>
          </div>
        </div>
      </div>

      <!-- Quick Add Personal Task -->
      <form class="quick-add-bar" onsubmit="window.trackerAddCustomTask(event)">
        <input type="text" id="quickTaskInput" class="quick-add-input" placeholder="Quick add personal task (e.g., Read LangChain docs, Debug FastAPI tests)..." required>
        <select id="quickTaskPriority" class="text-field" style="width:auto; padding:4px 8px; font-size:11px;">
          <option value="high">High Priority</option>
          <option value="med" selected>Medium Priority</option>
          <option value="low">Low Priority</option>
        </select>
        <button type="submit" class="button button-sm button-primary">+ Add Task</button>
      </form>

      <!-- Filter Controls -->
      <div class="planner-controls">
        <div class="filter-tabs">
          <button class="filter-chip ${filter === 'all' ? 'active' : ''}" onclick="window.trackerSetPlannerFilter('all')">All Tasks (${allPlannerTasks.length})</button>
          <button class="filter-chip ${filter === 'incomplete' ? 'active' : ''}" onclick="window.trackerSetPlannerFilter('incomplete')">Incomplete</button>
          <button class="filter-chip ${filter === 'high' ? 'active' : ''}" onclick="window.trackerSetPlannerFilter('high')">High Priority</button>
          <button class="filter-chip ${filter === 'overdue' ? 'active' : ''}" onclick="window.trackerSetPlannerFilter('overdue')">Overdue</button>
          <button class="filter-chip ${filter === 'completed' ? 'active' : ''}" onclick="window.trackerSetPlannerFilter('completed')">Completed</button>
        </div>
        <button class="button button-sm button-soft" onclick="window.trackerLaunchTimerForTask('Daily Focus Session')">
          ⏱️ Start Focus Timer
        </button>
      </div>

      <!-- Task Cards List -->
      <div class="planner-task-list">
        ${displayTasks.map(t => {
          const isOverdue = !t.completed && t.date < todayStr;
          return `
            <div class="planner-task-card ${isOverdue ? 'is-overdue' : ''} priority-${t.priority}">
              <div class="planner-task-left">
                <input type="checkbox" ${t.completed ? 'checked' : ''} onchange="window.trackerTogglePlannerTask('${t.id}', this.checked)" style="width:17px; height:17px; cursor:pointer;">
                <div style="flex:1;">
                  <div style="display:flex; align-items:center; gap:8px;">
                    <span class="priority-tag ${t.priority}">${t.priority}</span>
                    <span style="font-size:12.5px; font-weight:600; ${t.completed ? 'text-decoration:line-through; color:var(--muted);' : ''}">${esc(t.title)}</span>
                  </div>
                  <div class="planner-task-meta">
                    <span style="color:var(--accent); font-weight:600;">${esc(t.source)}</span>
                    <span>·</span>
                    <span>${esc(t.category)}</span>
                    <span>·</span>
                    <span>Scheduled: ${t.date}</span>
                    ${isOverdue ? '<span style="color:var(--red); font-weight:700;">(Overdue)</span>' : ''}
                    ${t.type === 'personal' ? '<span class="status-pill not-started" style="font-size:9px;">User Custom</span>' : ''}
                  </div>
                </div>
              </div>
              <div style="display:flex; align-items:center; gap:8px;">
                <select class="text-field" style="width:auto; padding:4px 6px; font-size:10.5px;" onchange="window.trackerSetTaskPriority('${t.id}', this.value)">
                  <option value="high" ${t.priority === 'high' ? 'selected' : ''}>High</option>
                  <option value="med" ${t.priority === 'med' ? 'selected' : ''}>Med</option>
                  <option value="low" ${t.priority === 'low' ? 'selected' : ''}>Low</option>
                </select>
                <button class="button button-sm button-soft" title="Study this task in Focus Mode" onclick="window.trackerLaunchTaskInFocusMode('${esc(t.title)}')">
                  ⚡ Focus
                </button>
                ${t.type === 'personal' ? `
                  <button class="button button-sm button-soft" style="color:var(--red);" onclick="window.trackerDeleteCustomTask('${t.id}')">✕</button>
                ` : ''}
              </div>
            </div>
          `;
        }).join('') || `
          <div class="planner-task-card" style="justify-content:center; color:var(--muted); font-size:12px; padding:32px;">
            No tasks match the selected filter. Add a personal goal or switch filters!
          </div>
        `}
      </div>
    `;
  }

  // ==========================================================================
  // VIEW RENDERER 3: STUDY TIMER & FOCUS SESSIONS
  // ==========================================================================
  function renderStudyTimer() {
    const mins = Math.floor(state.timerSecondsLeft / 60);
    const secs = state.timerSecondsLeft % 60;
    const timeFormatted = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    const progressPct = state.timerTotalSeconds > 0
      ? Math.round(((state.timerTotalSeconds - state.timerSecondsLeft) / state.timerTotalSeconds) * 100)
      : 0;

    const totalMinutes = calculateTotalFocusMinutes();
    const todayStr = new Date().toISOString().slice(0, 10);
    const todayMinutes = (state.data.focusSessions || [])
      .filter(s => s.date && s.date.slice(0, 10) === todayStr)
      .reduce((a, b) => a + (b.durationMinutes || 0), 0);

    return `
      <div class="timer-container">
        <!-- Main Timer Card -->
        <div class="timer-main-card">
          <div class="eyebrow">
            <span>DEEP WORK TIMER</span>
            <span class="live-dot" style="${state.timerIsRunning ? '' : 'background:var(--muted)'}"></span>
            <span>${state.timerIsRunning ? 'Running' : 'Ready'}</span>
          </div>

          <div class="timer-display" id="timerClockDisplay">${timeFormatted}</div>

          <!-- Progress Bar -->
          <div class="progress-track" style="width: 80%; height: 10px;">
            <div class="progress-fill" id="timerProgressBar" style="width: ${progressPct}%;"></div>
          </div>

          <!-- Presets -->
          <div class="timer-presets">
            <button class="timer-preset-btn ${state.timerTotalSeconds === 25 * 60 ? 'active' : ''}" onclick="window.trackerSetTimerDuration(25)">25m Pomodoro</button>
            <button class="timer-preset-btn ${state.timerTotalSeconds === 45 * 60 ? 'active' : ''}" onclick="window.trackerSetTimerDuration(45)">45m Deep Work</button>
            <button class="timer-preset-btn ${state.timerTotalSeconds === 60 * 60 ? 'active' : ''}" onclick="window.trackerSetTimerDuration(60)">60m Sprint</button>
            <button class="timer-preset-btn ${state.timerTotalSeconds === 5 * 60 ? 'active' : ''}" onclick="window.trackerSetTimerDuration(5)">5m Break</button>
            <button class="timer-preset-btn ${state.timerTotalSeconds === 15 * 60 ? 'active' : ''}" onclick="window.trackerSetTimerDuration(15)">15m Rest</button>
          </div>

          <!-- Topic Selector -->
          <input type="text" class="timer-link-selector" id="timerTopicInput" value="${esc(state.timerTag.topic)}" placeholder="What are you studying? (e.g. FastAPI Async, RAG Chunking)" onchange="window.trackerSetTimerTopic(this.value)">

          <!-- Timer Controls -->
          <div class="timer-actions">
            ${state.timerIsRunning ? `
              <button class="button button-primary" style="padding:0 24px;" onclick="window.trackerPauseTimer()">⏸ Pause</button>
            ` : `
              <button class="button button-primary" style="padding:0 24px;" onclick="window.trackerStartTimer()">▶ Start Session</button>
            `}
            <button class="button button-soft" onclick="window.trackerResetTimer()">↺ Reset</button>
          </div>
        </div>

        <!-- Timer Stats & Session Log -->
        <div class="timer-stats-card">
          <h3 class="section-title" style="font-size: 15px;">Study Statistics</h3>
          <div class="stats-grid" style="grid-template-columns: 1fr 1fr; gap: 10px;">
            <div class="stat-card" style="padding: 12px;">
              <div class="stat-card-top">Today</div>
              <div class="stat-value" style="font-size: 20px;">${todayMinutes}m</div>
              <div class="stat-subtext">${(todayMinutes / 60).toFixed(1)} hours</div>
            </div>
            <div class="stat-card" style="padding: 12px;">
              <div class="stat-card-top">All-Time</div>
              <div class="stat-value" style="font-size: 20px;">${(totalMinutes / 60).toFixed(1)}h</div>
              <div class="stat-subtext">${(state.data.focusSessions || []).length} sessions</div>
            </div>
          </div>

          <h3 class="section-title" style="font-size: 14px; margin-top: 12px;">Recent Completed Sessions</h3>
          <div style="overflow-x:auto;">
            <table class="session-history-table">
              <thead>
                <tr>
                  <th>Topic</th>
                  <th>Duration</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                ${(state.data.focusSessions || []).slice(0, 6).map(s => `
                  <tr>
                    <td><strong>${esc(s.topic || 'General')}</strong></td>
                    <td>${s.durationMinutes} min</td>
                    <td>${new Date(s.date).toLocaleDateString([], { month: 'short', day: 'numeric' })}</td>
                  </tr>
                `).join('') || `
                  <tr><td colspan="3" style="text-align:center; color:var(--muted);">No completed sessions yet.</td></tr>
                `}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;
  }

  // ==========================================================================
  // VIEW RENDERER 4: ROADMAP WEEKS (1–16) MODERN PURPLE DASHBOARD (EXACT UI)
  // ==========================================================================
  const WEEK_SKILLS_MAP = {
    1: ['Python Basics', 'Control Flow', 'Data Structures'],
    2: ['OOP Python', 'File I/O', 'Error Handling', 'Virtual Envs'],
    3: ['FastAPI', 'Pydantic', 'Async/Await', 'REST APIs'],
    4: ['Prompt Engineering', 'Few-Shot Prompting', 'Chain-of-Thought', 'Structured Outputs'],
    5: ['OpenAI SDK', 'Gemini API', 'Anthropic Claude', 'Embeddings'],
    6: ['LangChain', 'LCEL Chains', 'Retrieval QA', 'Memory Systems'],
    7: ['LlamaIndex', 'Vector Databases', 'RAG Architectures', 'Chunking Strategies'],
    8: ['Lead Research Automation', 'Web Scraping', 'Data Enrichment', 'Portfolio Deliverable'],
    9: ['Multi-Modal AI', 'Whisper Audio', 'Vision Models', 'Function Calling'],
    10: ['Enterprise Knowledge Assistant', 'Hybrid Search', 'Reranking', 'Vector Stores'],
    11: ['CrewAI', 'LangGraph', 'Agentic Workflows', 'Multi-Agent State'],
    12: ['Multi-Agent Intelligence', 'Hierarchical Teams', 'Human-in-the-Loop', 'Market Analysis'],
    13: ['n8n Workflows', 'Make.com Integration', 'Webhook Automation', 'Zapier Triggers'],
    14: ['Customer Support AI', 'Omnichannel Escalation', 'Slack / Zendesk APIs', 'Guardrails'],
    15: ['Production Architecture', 'LangSmith Observability', 'Docker / CI/CD', 'Evaluation Pipelines'],
    16: ['Technical Interviews', 'System Design', 'Portfolio Polish', 'Job Readiness']
  };

  function renderRoadmapWeeksView(targetWeekId) {
    const weekId = Number(targetWeekId) || 1;
    const week = CURRICULUM.weeks.find(w => w.id === weekId) || CURRICULUM.weeks[0];
    if (!week) return `<div class="empty-state">Curriculum week not found.</div>`;

    const wd = getWeekData(week.id);
    const daysCount = week.days ? week.days.length : 7;
    const startDay = (week.days && week.days[0]) ? (week.days[0].dayNumber || 1) : 1;
    const endDay = (week.days && week.days.length)
      ? (week.days[week.days.length - 1].dayNumber || (startDay + daysCount - 1))
      : (startDay + daysCount - 1);

    const totalTasks = weekTaskCount(week);
    const doneTasks = weekDoneCount(week.id);
    const weekPct = totalTasks ? Math.round((doneTasks / totalTasks) * 100) : 0;

    let completedDays = 0;
    (week.days || []).forEach((d, di) => {
      const tCount = (d.theory || []).length;
      const pCount = (d.practice || []).length;
      const dTotal = tCount + pCount;
      const tDone = (d.theory || []).filter((_, ti) => wd.checks[taskKey(di, 't', ti)]).length;
      const pDone = (d.practice || []).filter((_, pi) => wd.checks[taskKey(di, 'p', pi)]).length;
      if (dTotal > 0 && (tDone + pDone === dTotal)) {
        completedDays++;
      }
    });
    const remainingDays = Math.max(0, daysCount - completedDays);

    const keySkills = WEEK_SKILLS_MAP[week.id] || ['Core Automation', 'Architecture', 'Best Practices'];
    const notesSavedCount = Object.values(wd.notes || {}).filter(n => typeof n === 'string' && n.trim().length > 0).length;

    // Circumference for Donut Chart (Radius = 40 => 2 * PI * 40 ≈ 251.3)
    const donutCircumference = 251.3;
    const donutOffset = Math.max(0, donutCircumference * (1 - weekPct / 100));

    // 16 Horizontal Curved Week Selector Pills
    const weekSelectorPillsHTML = CURRICULUM.weeks.map(w => {
      const isActive = (w.id === week.id);
      const sDay = (w.days && w.days[0]) ? (w.days[0].dayNumber || 1) : 1;
      const eDay = (w.days && w.days.length)
        ? (w.days[w.days.length - 1].dayNumber || (sDay + w.days.length - 1))
        : (sDay + 6);
      return `
        <button type="button" class="week-pill ${isActive ? 'active' : ''}"
          onclick="window.trackerSelectRoadmapWeek(${w.id})"
          aria-pressed="${isActive}"
          title="Week ${w.id}: ${esc(w.title)}">
          <div class="week-pill-top">
            ${isActive ? '<span class="week-pill-dot" aria-hidden="true"></span>' : ''}
            <span class="week-pill-title">Week ${w.id}</span>
          </div>
          <div class="week-pill-sub">Day ${sDay}–${eDay}</div>
        </button>
      `;
    }).join('');

    // Ensure expanded state tracking
    if (!state.expandedDays) {
      state.expandedDays = {};
    }

    // Daily Cards
    const dayCardsHTML = (week.days || []).map((day, di) => {
      const curDayNum = day.dayNumber || (di + 1);
      const tCount = (day.theory || []).length;
      const pCount = (day.practice || []).length;
      const dTotal = tCount + pCount;
      const tDone = (day.theory || []).filter((_, ti) => wd.checks[taskKey(di, 't', ti)]).length;
      const pDone = (day.practice || []).filter((_, pi) => wd.checks[taskKey(di, 'p', pi)]).length;
      const dDone = tDone + pDone;

      const isCompleted = dTotal > 0 && dDone === dTotal;
      const hasNotes = Boolean((wd.notes[di] || '').trim());
      const isInProgress = !isCompleted && (dDone > 0 || hasNotes);

      const statusText = isCompleted ? 'Completed' : (isInProgress ? 'In Progress' : 'Not Started');
      const statusClass = isCompleted ? 'completed' : (isInProgress ? 'in-progress' : 'not-started');

      // Expand Day 1 and Day 5 by default if unconfigured, or follow explicit state
      const isExpanded = (state.expandedDays[`${week.id}-${di}`] !== undefined)
        ? state.expandedDays[`${week.id}-${di}`]
        : (di === 0 || di === 4);

      const theoryItemsHTML = (day.theory && day.theory.length > 0)
        ? `<ul class="roadmap-bullet-list">
            ${day.theory.map(item => `<li>${esc(item)}</li>`).join('')}
           </ul>`
        : `<p class="roadmap-empty-hint">Foundational review &amp; concepts</p>`;

      const practiceItemsHTML = (day.practice && day.practice.length > 0)
        ? `<div class="roadmap-practice-list">
            ${day.practice.map((item, pi) => {
              const key = taskKey(di, 'p', pi);
              const isChecked = Boolean(wd.checks[key]);
              return `
                <label class="roadmap-practice-row ${isChecked ? 'completed' : ''}" id="row-${week.id}-${di}-p-${pi}">
                  <input type="checkbox" data-task-key="${esc(key)}" ${isChecked ? 'checked' : ''}
                    onchange="window.trackerToggleRoadmapTask(${week.id}, ${di}, 'p', ${pi}, this.checked)">
                  <span>${esc(item)}</span>
                </label>
              `;
            }).join('')}
           </div>`
        : `<p class="roadmap-empty-hint">Hands-on practice exercises</p>`;

      const noteVal = wd.notes[di] || '';

      return `
        <div class="roadmap-day-card ${isExpanded ? 'expanded' : 'collapsed'}" id="roadmap-day-${week.id}-${di}">
          <div class="roadmap-day-header" onclick="window.trackerToggleRoadmapDayExpand(${week.id}, ${di})">
            <div class="roadmap-day-header-left">
              <div class="roadmap-day-circle">${curDayNum}</div>
              <div class="roadmap-day-title">Day ${curDayNum} – ${esc(day.title)}</div>
              <span class="roadmap-status-pill ${statusClass}" id="day-status-pill-${week.id}-${di}">${statusText}</span>
            </div>
            <div class="roadmap-day-header-right">
              <span class="roadmap-day-chevron" id="day-chevron-${week.id}-${di}">${isExpanded ? '⌃' : '⌄'}</span>
            </div>
          </div>
          <div class="roadmap-day-body" id="day-body-${week.id}-${di}" ${isExpanded ? '' : 'style="display:none;"'}>
            <div class="roadmap-day-grid">
              <!-- Column 1: What to Learn -->
              <div class="roadmap-subcol">
                <div class="roadmap-subcol-header">
                  <span class="roadmap-subcol-icon">📖</span>
                  <span>What to Learn</span>
                </div>
                ${theoryItemsHTML}
              </div>

              <!-- Column 2: What to Practice -->
              <div class="roadmap-subcol">
                <div class="roadmap-subcol-header">
                  <span class="roadmap-subcol-icon">&lt;/&gt;</span>
                  <span>What to Practice</span>
                </div>
                ${practiceItemsHTML}
              </div>

              <!-- Column 3: My Notes -->
              <div class="roadmap-subcol">
                <div class="roadmap-subcol-header">
                  <span class="roadmap-subcol-icon">✏️</span>
                  <span>My Notes</span>
                </div>
                <div class="roadmap-note-container">
                  <textarea class="roadmap-note-input" id="note-input-${week.id}-${di}"
                    placeholder="Write your notes here..."
                    oninput="window.trackerInputRoadmapNote(${week.id}, ${di}, this.value)">${esc(noteVal)}</textarea>
                  <div class="roadmap-note-footer">
                    <span class="roadmap-note-status" id="note-status-${week.id}-${di}">${noteVal ? '✓ Saved' : ''}</span>
                    <button type="button" class="roadmap-note-save-btn" onclick="window.trackerSaveRoadmapNoteBtn(${week.id}, ${di})">
                      <span>💾</span> Save
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      `;
    }).join('');

    return `
      <div class="roadmap-view-container">
        <!-- 16 Horizontal Curved Week Selector Boxes -->
        <div class="week-selector-wrapper" role="tablist" aria-label="16-week navigation">
          ${weekSelectorPillsHTML}
        </div>

        <!-- Weekly Header Banner Card -->
        <div class="weekly-banner-card">
          <div class="weekly-banner-left">
            <div class="weekly-banner-icon">📅</div>
            <div class="weekly-banner-text">
              <h2 class="weekly-banner-title">Week ${week.id} — ${esc(week.title)}</h2>
              <p class="weekly-banner-subtitle">Days ${startDay}–${endDay} • ${esc(week.description || (week.phase ? week.phase.toUpperCase() : 'Build your engineering foundation'))}</p>
            </div>
          </div>
          <div class="weekly-banner-right">
            <div class="weekly-days-badge">📅 ${daysCount} Days</div>
            <div class="weekly-progress-wrap">
              <div class="weekly-progress-bar">
                <div class="weekly-progress-fill" id="bannerProgressFill" style="width: ${weekPct}%"></div>
              </div>
              <span class="weekly-progress-text" id="bannerProgressText">${weekPct}%</span>
            </div>
          </div>
        </div>

        <!-- Two-Column Main Layout -->
        <div class="roadmap-main-grid">
          <!-- Left Column: Daily Learning Cards -->
          <div class="roadmap-days-col">
            ${dayCardsHTML}
          </div>

          <!-- Right Column: Sidebar Widgets -->
          <div class="roadmap-sidebar-col">
            <!-- Widget 1: Week Overview -->
            <div class="roadmap-widget-card">
              <h3 class="roadmap-widget-title">📊 Week ${week.id} Overview</h3>
              <div class="roadmap-overview-flex">
                <svg class="roadmap-donut-svg" viewBox="0 0 100 100" aria-hidden="true">
                  <circle cx="50" cy="50" r="40" stroke="#251c42" stroke-width="8" fill="none" />
                  <circle id="overviewDonutArc" cx="50" cy="50" r="40" stroke="#8b5cf6" stroke-width="8" fill="none"
                    stroke-linecap="round"
                    stroke-dasharray="251.3"
                    stroke-dashoffset="${donutOffset}"
                    transform="rotate(-90 50 50)"
                    style="transition: stroke-dashoffset 0.35s ease;" />
                  <text id="overviewDonutText" x="50" y="55" text-anchor="middle" font-size="18" font-weight="700" fill="#ffffff">${weekPct}%</text>
                </svg>
                <div class="roadmap-donut-info">
                  <div class="roadmap-donut-main" id="overviewDaysDone">${completedDays}/${daysCount} Days Done</div>
                  <div class="roadmap-donut-sub" id="overviewDaysRemaining">${remainingDays} Remaining</div>
                </div>
              </div>
            </div>

            <!-- Widget 2: Key Skills This Week -->
            <div class="roadmap-widget-card">
              <h3 class="roadmap-widget-title">Key Skills This Week</h3>
              <div class="roadmap-skills-wrap">
                ${keySkills.map(s => `<span class="roadmap-skill-pill">${esc(s)}</span>`).join('')}
              </div>
            </div>

            <!-- Widget 3: Quick Actions -->
            <div class="roadmap-widget-card">
              <h3 class="roadmap-widget-title">⚡ Quick Actions</h3>
              <div class="roadmap-quick-actions-list">
                <button type="button" class="roadmap-quick-btn" onclick="window.trackerMarkWeekDone(${week.id})">
                  <span class="quick-btn-icon">✓</span>
                  <span>Mark Week as Done</span>
                </button>
                <button type="button" class="roadmap-quick-btn" onclick="window.trackerDownloadWeekResources(${week.id})">
                  <span class="quick-btn-icon">↓</span>
                  <span>Download Resources</span>
                </button>
                <button type="button" class="roadmap-quick-btn" onclick="window.trackerOpenWeekPlan(${week.id})">
                  <span class="quick-btn-icon">↗</span>
                  <span>View Week Plan</span>
                </button>
              </div>
            </div>

            <!-- Widget 4: Notes Summary -->
            <div class="roadmap-widget-card">
              <h3 class="roadmap-widget-title">📝 Notes Summary</h3>
              <div class="roadmap-notes-summary-row">
                <span class="notes-count-text" id="widgetNotesCount">${notesSavedCount} notes saved this week</span>
                <a href="#" class="roadmap-notes-link" onclick="window.trackerNavigate('vault'); return false;">View All →</a>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  // Alias for backward compatibility
  const renderRoadmapWeek = renderRoadmapWeeksView;

  // ==========================================================================
  // VIEW RENDERER 5: PROJECT WORKSPACE
  // ==========================================================================
  function renderProjectWorkspace(projectId) {
    const p = CURRICULUM.projects.find(x => x.id === projectId);
    if (!p) return `<div class="empty-state">Project ${projectId} not found.</div>`;

    const pd = getProjectData(projectId);
    const total = projectTaskCount(p);
    const done = projectDoneCount(p.id);
    const pct = total ? Math.round((done / total) * 100) : 0;
    const isComplete = total > 0 && done === total;

    const art = state.data.artifacts[projectId] || {};
    const blockers = pd.blockers || [];
    const reflections = pd.reflections || {};

    const activeRoleIndex = state.projectRoleActiveIndex || 0;

    return `
      <!-- Project Header -->
      <div class="project-header-card">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:16px;">
          <div>
            <div class="eyebrow">
              <span>${projectId === 'capstone' ? 'CAPSTONE PROJECT' : 'PORTFOLIO PROJECT'}</span>
              ${isComplete ? '<span class="status-pill completed">COMPLETED &amp; SHIPPED</span>' : ''}
            </div>
            <h2 class="section-title" style="margin: 4px 0 8px;">${esc(p.title)}</h2>
            <p class="section-sub" style="font-size: 13px;">${esc(p.objective)}</p>
          </div>
          <div style="text-align:right; min-width:160px;">
            <div style="font-size:24px; font-weight:800; color:var(--accent);">${pct}%</div>
            <span style="font-size:11px; color:var(--muted);">${done} / ${total} tasks</span>
            <div class="progress-track" style="margin-top:8px;">
              <div class="progress-fill" style="width:${pct}%"></div>
            </div>
          </div>
        </div>

        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:16px; margin-top:6px;">
          <div>
            <div class="side-label" style="padding-left:0;">Target Technology Stack</div>
            <div class="chip-list">
              ${(p.stack || []).map(s => `<span class="chip" style="background:var(--accent-soft); color:var(--accent); font-weight:700;">${esc(s)}</span>`).join('')}
            </div>
          </div>
          <div>
            <div class="side-label" style="padding-left:0;">Architecture Overview</div>
            <div style="font-size:12px; color:var(--text-secondary); line-height:1.5;">${esc(p.architecture)}</div>
          </div>
        </div>
      </div>

      <!-- Role-Based Tracks Tabs -->
      <section class="section-box">
        <div class="role-tabs">
          ${p.roles.map((r, ri) => {
            const role = normalizeRole(r);
            const rDone = role.tasks.filter((_, ti) => pd.checks[`${ri}-${ti}`]).length;
            return `
              <button class="role-tab-btn ${ri === activeRoleIndex ? 'active' : ''}" onclick="window.trackerSetProjectRole(${ri})">
                ${esc(role.name)} (${rDone}/${role.tasks.length})
              </button>
            `;
          }).join('')}
        </div>

        <!-- Active Role Content -->
        ${(() => {
          const role = normalizeRole(p.roles[activeRoleIndex]);
          const ri = activeRoleIndex;
          const rDone = role.tasks.filter((_, ti) => pd.checks[`${ri}-${ti}`]).length;
          const noteKey = `project-${projectId}-${ri}`;
          return `
            <div class="planner-task-card" style="flex-direction:column; align-items:stretch; padding:20px; gap:16px;">
              <div>
                <h3 style="font-size:14px; font-weight:800;">${esc(role.name)}</h3>
                <p style="font-size:12px; color:var(--muted); margin-top:2px;">${esc(role.scope)}</p>
              </div>

              <div>
                <div class="task-group-title"><span class="group-dot"></span>Actionable Implementation Checklist (${rDone}/${role.tasks.length})</div>
                <div class="task-list">
                  ${role.tasks.map((task, ti) => {
                    const checkKey = `${ri}-${ti}`;
                    const isChecked = Boolean(pd.checks[checkKey]);
                    return `
                      <label class="task-row">
                        <input type="checkbox" ${isChecked ? 'checked' : ''} onchange="window.trackerCheckProjectTask('${projectId}', '${checkKey}', this.checked, '${esc(task)}')">
                        <span>${esc(task)}</span>
                      </label>
                    `;
                  }).join('')}
                </div>
              </div>

              <!-- Role Scratchpad -->
              <div class="note-panel" style="margin-top:8px;">
                <div class="note-heading">
                  <span>▤ Role Scratchpad &amp; Architecture Decisions</span>
                  <span class="saved-label" id="saved-${noteKey}">● Saved</span>
                </div>
                <textarea placeholder="Record technical decisions, API endpoints, database schemas, debugging notes..." oninput="window.trackerSaveProjectNote('${projectId}', ${ri}, this.value, '${noteKey}')">${esc(pd.notes[ri] || '')}</textarea>
              </div>
            </div>
          `;
        })()}
      </section>

      <!-- Deliverables Tracker (All 8 Deliverables) -->
      <section class="section-box">
        <div class="section-head">
          <div>
            <h2 class="section-title">Project Deliverables &amp; Artifacts</h2>
            <p class="section-sub">Validate URLs and maintain links for your portfolio, demos, and resume defense.</p>
          </div>
        </div>
        <div class="deliverables-grid">
          ${renderDeliverableInput(projectId, 'github', '1. GitHub Repository URL', art.github, 'https://github.com/...')}
          ${renderDeliverableInput(projectId, 'demo', '2. Live Deployed Application URL', art.demo, 'https://...')}
          ${renderDeliverableInput(projectId, 'design', '3. Architecture Diagram URL', art.design, 'https://...')}
          ${renderDeliverableInput(projectId, 'readme', '4. Detailed README URL', art.readme, 'https://github.com/.../README.md')}
          ${renderDeliverableInput(projectId, 'video', '5. Demo Video URL (2-3 min)', art.video, 'https://loom.com/...')}
          ${renderDeliverableInput(projectId, 'testReport', '6. Test Suite / Pytest URL', art.testReport, 'https://...')}
          ${renderDeliverableInput(projectId, 'evalReport', '7. Evaluation Report URL', art.evalReport, 'https://...')}
          ${renderDeliverableInput(projectId, 'metrics', '8. Measured Impact Metrics', art.metrics, 'e.g. 94% accuracy, 120ms latency')}
        </div>
      </section>

      <!-- Project Blockers & Resolutions -->
      <section class="section-box">
        <div class="section-head">
          <h2 class="section-title">Project Blockers &amp; Resolutions</h2>
        </div>
        <form class="quick-add-bar" onsubmit="window.trackerAddBlocker(event, '${projectId}')">
          <input type="text" id="blockerInput" class="quick-add-input" placeholder="Record technical obstacle or debugging blocker..." required>
          <button type="submit" class="button button-sm button-soft">+ Add Blocker</button>
        </form>
        <div class="planner-task-list">
          ${blockers.map((b, bi) => `
            <div class="planner-task-card" style="padding:10px 14px;">
              <div class="planner-task-left">
                <input type="checkbox" ${b.resolved ? 'checked' : ''} onchange="window.trackerToggleBlocker('${projectId}', ${bi}, this.checked)">
                <span style="${b.resolved ? 'text-decoration:line-through; color:var(--muted);' : ''}">${esc(b.text)}</span>
              </div>
              <button class="button button-sm button-soft" style="color:var(--red);" onclick="window.trackerDeleteBlocker('${projectId}', ${bi})">✕</button>
            </div>
          `).join('') || `
            <div class="planner-task-card" style="justify-content:center; color:var(--muted); font-size:12px;">No active blockers recorded.</div>
          `}
        </div>
      </section>

      <!-- Resume & Portfolio Bullet Points Generator -->
      <section class="section-box">
        <div class="section-head">
          <div>
            <h2 class="section-title">Portfolio &amp; Resume Summary</h2>
            <p class="section-sub">Generate concise impact bullet points based on your deliverables.</p>
          </div>
          <button class="button button-sm button-soft" onclick="window.trackerCopyPortfolioSummary('${projectId}')">
            📋 Copy Resume Bullets
          </button>
        </div>
        <div class="code-snippet-box">
          <pre><code>• Built ${esc(p.title)}: ${esc(p.objective)}
• Engineered architecture using ${esc((p.stack || []).join(', '))}.
• Implemented ${done}/${total} verified components across 5 engineering tracks.
• Live Application: ${esc(art.demo || '[Pending Deployment]')} | Repository: ${esc(art.github || '[Pending GitHub Link]')}</pre></code>
        </div>
      </section>
    `;
  }

  function renderDeliverableInput(projectId, field, label, val, placeholder) {
    const isUrl = field !== 'metrics';
    const hasValue = Boolean(val && val.trim());
    return `
      <div class="deliverable-field">
        <label>${label}</label>
        <div class="deliverable-input-wrap">
          <input type="${isUrl ? 'url' : 'text'}" class="text-field" value="${esc(val || '')}" placeholder="${placeholder}" oninput="window.trackerSaveArtifact('${projectId}', '${field}', this.value)">
          ${isUrl && hasValue ? `
            <a href="${esc(val)}" target="_blank" rel="noopener noreferrer" class="button button-sm button-soft" title="Open Link">↗</a>
          ` : ''}
        </div>
      </div>
    `;
  }

  // ==========================================================================
  // VIEW RENDERER 6: SPACED REPETITION & REVISION CENTER
  // ==========================================================================
  function renderRevisionCenter() {
    const todayStr = new Date().toISOString().slice(0, 10);
    const revisionsList = Object.entries(state.data.revisions || {}).map(([key, r]) => ({ key, ...r }));

    const dueToday = revisionsList.filter(r => r.dueDate && r.dueDate <= todayStr && r.needsRevision);
    const upcoming = revisionsList.filter(r => r.dueDate && r.dueDate > todayStr && r.needsRevision);
    const mastered = revisionsList.filter(r => !r.needsRevision || r.confidence === 5);

    return `
      <div class="planner-hero">
        <div>
          <div class="eyebrow">
            <span>SPACED REPETITION SYSTEM</span>
            <span class="live-dot"></span>
          </div>
          <h2 class="section-title" style="margin:4px 0 6px;">Revision Center</h2>
          <p class="section-sub">Automated spaced intervals based on confidence: 1 (Tomorrow), 2 (+2d), 3 (+4d), 4 (+7d), 5 (+14d).</p>
        </div>
        <div style="display:flex; gap:16px;">
          <div class="stat-card" style="padding:12px 18px; text-align:center;">
            <div style="font-size:22px; font-weight:800; color:var(--orange);">${dueToday.length}</div>
            <div style="font-size:11px; color:var(--muted);">Due Today</div>
          </div>
          <div class="stat-card" style="padding:12px 18px; text-align:center;">
            <div style="font-size:22px; font-weight:800; color:var(--accent);">${upcoming.length}</div>
            <div style="font-size:11px; color:var(--muted);">Upcoming</div>
          </div>
        </div>
      </div>

      <!-- Due Today Section -->
      <section class="section-box">
        <h3 class="section-title" style="font-size:15px; color:var(--orange);">⚠️ Revisions Due Today / Overdue (${dueToday.length})</h3>
        <div class="revision-grid">
          ${dueToday.map(r => renderRevisionCard(r, true)).join('') || `
            <div class="planner-task-card" style="grid-column: 1/-1; justify-content:center; color:var(--muted); font-size:12px;">
              Zero revisions due today! Great work staying ahead.
            </div>
          `}
        </div>
      </section>

      <!-- Upcoming Revisions -->
      <section class="section-box">
        <h3 class="section-title" style="font-size:15px;">Upcoming Scheduled Revisions (${upcoming.length})</h3>
        <div class="revision-grid">
          ${upcoming.map(r => renderRevisionCard(r, false)).join('') || `
            <div class="planner-task-card" style="grid-column: 1/-1; justify-content:center; color:var(--muted); font-size:12px;">
              No upcoming revisions scheduled.
            </div>
          `}
        </div>
      </section>

      <!-- Mastered Topics -->
      ${mastered.length ? `
        <section class="section-box">
          <h3 class="section-title" style="font-size:15px; color:var(--green);">✓ Mastered Concepts (${mastered.length})</h3>
          <div class="revision-grid">
            ${mastered.map(r => renderRevisionCard(r, false)).join('')}
          </div>
        </section>
      ` : ''}
    `;
  }

  function renderRevisionCard(r, isDue) {
    return `
      <div class="revision-card ${isDue ? 'due-today' : ''}">
        <div style="display:flex; justify-content:space-between; align-items:flex-start;">
          <span class="status-pill ${isDue ? 'in-progress' : 'completed'}">${isDue ? 'DUE NOW' : `Due: ${r.dueDate || 'Planned'}`}</span>
          <span style="font-size:11px; color:var(--muted);">Week ${r.weekId} · Day ${(r.dayIndex || 0) + 1}</span>
        </div>
        <div style="font-size:13.5px; font-weight:750;">${esc(r.title)}</div>

        <div>
          <div style="font-size:10px; color:var(--muted); margin-bottom:4px; font-weight:700;">CONFIDENCE (1–5):</div>
          <div class="confidence-stars">
            ${[1, 2, 3, 4, 5].map(lvl => `
              <button class="confidence-btn ${r.confidence === lvl ? 'active' : ''}" onclick="window.trackerSetRevisionConfidence('${r.key}', ${lvl})">${lvl}</button>
            `).join('')}
          </div>
        </div>

        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:auto; padding-top:8px; border-top:1px solid var(--line);">
          <span style="font-size:10.5px; color:var(--muted);">Revised ${(r.history || []).length}x</span>
          <button class="button button-sm button-primary" onclick="window.trackerMarkRevised('${r.key}')">
            ✓ Mark Revised
          </button>
        </div>
      </div>
    `;
  }

  // ==========================================================================
  // VIEW RENDERER 7: ADVANCED LEARNING ANALYTICS & HEATMAP
  // ==========================================================================
  function renderAnalytics() {
    const c = calculateAllCounts();
    const streak = calculateStreak();
    const focusMins = calculateTotalFocusMinutes();
    const focusHours = (focusMins / 60).toFixed(1);

    // Activity distribution by date for heatmap (past 112 days)
    const dateCounts = {};
    (state.data.activityLog || []).forEach(a => {
      const d = a.timestamp ? a.timestamp.slice(0, 10) : '';
      if (d) dateCounts[d] = (dateCounts[d] || 0) + 1;
    });

    // Generate heatmap cells
    const cells = [];
    const now = new Date();
    for (let i = 111; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const str = d.toISOString().slice(0, 10);
      const count = dateCounts[str] || 0;
      let level = '0';
      if (count >= 7) level = '4';
      else if (count >= 4) level = '3';
      else if (count >= 2) level = '2';
      else if (count >= 1) level = '1';
      cells.push(`<div class="heatmap-cell level-${level}" title="${str}: ${count} actions"></div>`);
    }

    return `
      <!-- Analytics Summary Stats -->
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-card-top">Curriculum Done</div>
          <div class="stat-value">${c.percent}%</div>
          <div class="stat-subtext">${c.done}/${c.total} tasks completed</div>
        </div>
        <div class="stat-card">
          <div class="stat-card-top">Learning Streak</div>
          <div class="stat-value">${streak} Days</div>
          <div class="stat-subtext">Active daily engagement</div>
        </div>
        <div class="stat-card">
          <div class="stat-card-top">Focus Study Time</div>
          <div class="stat-value">${focusHours}h</div>
          <div class="stat-subtext">${focusMins} total minutes</div>
        </div>
        <div class="stat-card">
          <div class="stat-card-top">Learning Days</div>
          <div class="stat-value">${c.completedDays} / ${c.totalDays}</div>
          <div class="stat-subtext">${c.totalDays - c.completedDays} days remaining</div>
        </div>
      </div>

      <!-- Activity Heatmap -->
      <div class="chart-card">
        <div class="section-head">
          <div>
            <h3 class="section-title" style="font-size:15px;">Learning Activity Heatmap (Past 16 Weeks)</h3>
            <p class="section-sub">Visual log of verified task completions, study sessions, and notes.</p>
          </div>
        </div>
        <div class="heatmap-wrap">
          <div class="heatmap-grid">
            ${cells.join('')}
          </div>
        </div>
      </div>

      <!-- Phase-Wise Progress Comparison -->
      <div class="chart-card">
        <h3 class="section-title" style="font-size:15px;">Curriculum Phase Progress</h3>
        <div style="display:flex; flex-direction:column; gap:12px; margin-top:8px;">
          ${(() => {
            const phases = {};
            CURRICULUM.weeks.forEach(w => {
              if (!phases[w.phase]) phases[w.phase] = { done: 0, total: 0 };
              phases[w.phase].done += weekDoneCount(w.id);
              phases[w.phase].total += weekTaskCount(w);
            });
            return Object.entries(phases).map(([pName, pStat]) => {
              const pct = pStat.total ? Math.round((pStat.done / pStat.total) * 100) : 0;
              return `
                <div>
                  <div style="display:flex; justify-content:space-between; font-size:12px; font-weight:600; margin-bottom:4px;">
                    <span>${esc(pName)}</span>
                    <span>${pct}% (${pStat.done}/${pStat.total})</span>
                  </div>
                  <div class="progress-track" style="margin:0;">
                    <div class="progress-fill" style="width:${pct}%"></div>
                  </div>
                </div>
              `;
            }).join('');
          })()}
        </div>
      </div>
    `;
  }

  // ==========================================================================
  // VIEW RENDERER 8: KNOWLEDGE VAULT & CODE JOURNAL
  // ==========================================================================
  function renderKnowledgeVault() {
    const notes = state.data.notesVault || [];
    const filterCat = state.vaultFilterCat || 'all';

    const categories = [
      'Concept Notes', 'Code Snippets', 'Errors & Debugging Solutions',
      'Important Learnings', 'Interview Questions', 'Project Ideas',
      'Useful Resources', 'Personal Insights'
    ];

    const displayNotes = notes.filter(n => {
      if (state.vaultShowFavorites && !n.isFavorite) return false;
      if (filterCat !== 'all' && n.category !== filterCat) return false;
      return true;
    });

    return `
      <div class="vault-header-bar">
        <div>
          <h2 class="section-title">Knowledge Vault &amp; Code Journal</h2>
          <p class="section-sub">Store reusable snippets, architectural decisions, and interview flashcards.</p>
        </div>
        <button class="button button-primary" onclick="window.trackerShowAddNoteModal()">+ New Vault Note</button>
      </div>

      <!-- Categories Filter Bar -->
      <div class="filter-tabs">
        <button class="filter-chip ${filterCat === 'all' ? 'active' : ''}" onclick="window.trackerSetVaultCategory('all')">All Notes (${notes.length})</button>
        <button class="filter-chip ${state.vaultShowFavorites ? 'active' : ''}" onclick="window.trackerToggleVaultFavorites()">⭐ Favorites Only</button>
        ${categories.map(cat => `
          <button class="filter-chip ${filterCat === cat ? 'active' : ''}" onclick="window.trackerSetVaultCategory('${cat}')">${cat}</button>
        `).join('')}
      </div>

      <!-- Vault Cards Grid -->
      <div class="vault-grid">
        ${displayNotes.map(n => `
          <div class="vault-card">
            <div style="display:flex; justify-content:space-between; align-items:flex-start;">
              <span class="vault-category-badge">${esc(n.category)}</span>
              <button class="button button-sm button-soft" style="font-size:13px;" onclick="window.trackerToggleNoteFavorite('${n.id}')">
                ${n.isFavorite ? '⭐' : '☆'}
              </button>
            </div>
            <h3 style="font-size:14px; font-weight:800; margin:0;">${esc(n.title)}</h3>
            <p style="font-size:12px; color:var(--text-secondary); white-space:pre-wrap;">${esc(n.content)}</p>

            ${n.codeSnippet ? `
              <div class="code-snippet-box">
                <button class="copy-code-btn" onclick="window.trackerCopyCodeSnippet('${n.id}')">Copy</button>
                <pre><code>${esc(n.codeSnippet)}</code></pre>
              </div>
            ` : ''}

            <div style="display:flex; justify-content:space-between; align-items:center; margin-top:auto; font-size:10.5px; color:var(--muted); border-top:1px solid var(--line); padding-top:8px;">
              <span>${new Date(n.updatedAt || n.createdAt).toLocaleDateString()}</span>
              <button class="button button-sm button-soft" style="color:var(--red);" onclick="window.trackerDeleteVaultNote('${n.id}')">Delete</button>
            </div>
          </div>
        `).join('') || `
          <div class="planner-task-card" style="grid-column: 1/-1; justify-content:center; color:var(--muted); font-size:12px; padding:32px;">
            No notes found. Create your first note in the Knowledge Vault!
          </div>
        `}
      </div>
    `;
  }

  // ==========================================================================
  // VIEW RENDERER 9: WEEKLY REVIEWS & REFLECTION
  // ==========================================================================
  function renderWeeklyReviews() {
    const weekId = state.reviewWeekId || 1;
    const week = CURRICULUM.weeks.find(w => w.id === Number(weekId)) || CURRICULUM.weeks[0];

    const reviewData = state.data.weeklyReviews[String(weekId)] || { answers: [] };
    const questions = [
      '1. What did I learn this week?',
      '2. What did I successfully implement?',
      '3. Which concepts are still confusing?',
      '4. What obstacles or blockers did I encounter?',
      '5. What should I revise?',
      '6. What was my biggest achievement?',
      '7. What should I improve next week?',
      '8. Confidence in this week\'s learning (1–5):'
    ];

    const wDone = weekDoneCount(week.id);
    const wTotal = weekTaskCount(week);
    const pct = wTotal ? Math.round((wDone / wTotal) * 100) : 0;

    return `
      <div class="planner-hero">
        <div>
          <div class="eyebrow"><span>WEEKLY REFLECTION TEMPLATE</span></div>
          <h2 class="section-title" style="margin:4px 0 6px;">Week ${week.id}: ${esc(week.title)} Review</h2>
          <p class="section-sub">Consolidate learnings, document achievements, and plan upcoming improvements.</p>
        </div>
        <div style="display:flex; align-items:center; gap:8px;">
          <select class="text-field" style="width:auto; font-weight:700;" onchange="window.trackerSetReviewWeek(this.value)">
            ${CURRICULUM.weeks.map(w => `
              <option value="${w.id}" ${w.id === week.id ? 'selected' : ''}>Week ${w.id}: ${esc(w.title)}</option>
            `).join('')}
          </select>
          <button class="button button-soft" onclick="window.print()">🖨️ Print Review</button>
        </div>
      </div>

      <div class="planner-task-card" style="padding:14px 20px; justify-content:space-between;">
        <span>Week ${week.id} Tasks Completed: <strong>${wDone} / ${wTotal} (${pct}%)</strong></span>
        ${pct === 100 ? '<span class="status-pill completed">✓ Week Fully Finished!</span>' : ''}
      </div>

      <div style="display:flex; flex-direction:column; gap:16px;">
        ${questions.slice(0, 7).map((q, qi) => `
          <div class="note-panel">
            <div class="note-heading"><span>${q}</span></div>
            <textarea placeholder="Write reflection..." oninput="window.trackerSaveReviewAnswer(${week.id}, ${qi}, this.value)">${esc(reviewData.answers[qi] || '')}</textarea>
          </div>
        `).join('')}

        <div class="note-panel">
          <div class="note-heading"><span>${questions[7]}</span></div>
          <div class="confidence-stars">
            ${[1, 2, 3, 4, 5].map(lvl => `
              <button class="confidence-btn ${reviewData.answers[7] === lvl ? 'active' : ''}" onclick="window.trackerSaveReviewAnswer(${week.id}, 7, ${lvl})">${lvl}</button>
            `).join('')}
          </div>
        </div>
      </div>
    `;
  }

  // ==========================================================================
  // VIEW RENDERER 10: SKILLS MATRIX & CONFIDENCE
  // ==========================================================================
  function renderSkillsMatrix() {
    const skillsList = [
      { name: 'Python Core & Data Structures', cat: 'Programming' },
      { name: 'Object-Oriented Programming (OOP)', cat: 'Programming' },
      { name: 'Git & GitHub Collaboration', cat: 'Software Engineering' },
      { name: 'REST APIs & HTTP Protocols', cat: 'Backend Engineering' },
      { name: 'PostgreSQL & Relational Data Modeling', cat: 'Backend Engineering' },
      { name: 'FastAPI Backend Development', cat: 'Backend Engineering' },
      { name: 'Async Programming (async/await)', cat: 'Backend Engineering' },
      { name: 'LLM Prompt Engineering & Context Design', cat: 'AI Engineering' },
      { name: 'Structured Outputs (Pydantic / JSON)', cat: 'AI Engineering' },
      { name: 'LLM Tool Calling & Function Calling', cat: 'AI Engineering' },
      { name: 'n8n Workflow Automation', cat: 'Automation' },
      { name: 'Embeddings & Vector Databases (pgvector/Qdrant)', cat: 'RAG Engineering' },
      { name: 'RAG Architecture & Document Retrieval', cat: 'RAG Engineering' },
      { name: 'LangGraph Stateful Multi-Agent Systems', cat: 'Agentic AI' },
      { name: 'Model Context Protocol (MCP)', cat: 'Agentic AI' },
      { name: 'Docker & Containerization', cat: 'DevOps & Cloud' },
      { name: 'CI/CD with GitHub Actions', cat: 'DevOps & Cloud' }
    ];

    return `
      <div class="section-head">
        <div>
          <h2 class="section-title">Technical Skill Matrix</h2>
          <p class="section-sub">Self-evaluate proficiency, link verified repository evidence, and track growth.</p>
        </div>
      </div>

      <div class="revision-grid">
        ${skillsList.map(s => {
          const sData = state.data.skills[s.name] || { level: 3, status: 'practiced', evidence: '' };
          return `
            <div class="revision-card">
              <span class="vault-category-badge">${esc(s.cat)}</span>
              <h3 style="font-size:13.5px; font-weight:750; margin:0;">${esc(s.name)}</h3>

              <div>
                <div style="font-size:10px; color:var(--muted); font-weight:700; margin-bottom:4px;">CONFIDENCE RATING:</div>
                <div class="confidence-stars">
                  ${[1, 2, 3, 4, 5].map(lvl => `
                    <button class="confidence-btn ${sData.level === lvl ? 'active' : ''}" onclick="window.trackerSetSkillLevel('${esc(s.name)}', ${lvl})">${lvl}</button>
                  `).join('')}
                </div>
              </div>

              <div>
                <label style="font-size:10px; color:var(--muted); font-weight:700;">VERIFIED EVIDENCE / REPO LINK:</label>
                <input type="url" class="text-field" value="${esc(sData.evidence || '')}" placeholder="https://github.com/..." onchange="window.trackerSetSkillEvidence('${esc(s.name)}', this.value)">
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  // ==========================================================================
  // VIEW RENDERER 11: CAREER READINESS & JOB TRACKER
  // ==========================================================================
  function renderCareerReadiness() {
    const career = state.data.career || {};
    const apps = career.applications || [];

    return `
      <div class="planner-hero">
        <div>
          <div class="eyebrow"><span>CAREER PREPARATION SUITE</span></div>
          <h2 class="section-title" style="margin:4px 0 6px;">Career &amp; Placement Readiness</h2>
          <p class="section-sub">Track resume preparation, interview topics, and target job applications.</p>
        </div>
        <button class="button button-primary" onclick="window.trackerShowAddJobModal()">+ Add Application</button>
      </div>

      <!-- Job Applications Table -->
      <section class="section-box">
        <h3 class="section-title" style="font-size:15px;">Target Job Applications (${apps.length})</h3>
        <div style="overflow-x:auto;">
          <table class="session-history-table">
            <thead>
              <tr>
                <th>Company</th>
                <th>Role</th>
                <th>Date Applied</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${apps.map(a => `
                <tr>
                  <td><strong>${esc(a.company)}</strong></td>
                  <td>${esc(a.role)}</td>
                  <td>${a.date}</td>
                  <td><span class="status-pill in-progress">${esc(a.status)}</span></td>
                  <td>
                    ${a.link ? `<a href="${esc(a.link)}" target="_blank" rel="noopener noreferrer" style="margin-right:8px;">Job Link ↗</a>` : ''}
                    <button class="button button-sm button-soft" style="color:var(--red);" onclick="window.trackerDeleteJobApp('${a.id}')">✕</button>
                  </td>
                </tr>
              `).join('') || `
                <tr><td colspan="5" style="text-align:center; color:var(--muted);">No applications logged yet.</td></tr>
              `}
            </tbody>
          </table>
        </div>
      </section>
    `;
  }

  // ==========================================================================
  // VIEW RENDERER 12: SETTINGS & BACKUP
  // ==========================================================================
  function renderSettings() {
    const raw = localStorage.getItem(STORAGE_KEY) || '';
    const bytes = new Blob([raw]).size;
    const kb = (bytes / 1024).toFixed(1);

    return `
      <div class="section-head">
        <div>
          <h2 class="section-title">Application Settings &amp; Data Management</h2>
          <p class="section-sub">Configure appearance, view local storage usage, export JSON backups, and manage data.</p>
        </div>
      </div>

      <div style="display:flex; flex-direction:column; gap:16px;">
        <!-- Appearance Settings -->
        <div class="planner-task-card">
          <div>
            <strong>Theme Appearance</strong>
            <p style="font-size:12px; color:var(--muted); margin:0;">Toggle between clean light mode and high-contrast dark mode.</p>
          </div>
          <button class="button button-soft" onclick="window.trackerToggleTheme()">
            ${state.data.theme === 'dark' ? '☼ Light Mode' : '◐ Dark Mode'}
          </button>
        </div>

        <!-- Data Backup & Restore -->
        <div class="planner-task-card" style="flex-direction:column; align-items:stretch; gap:14px;">
          <div>
            <strong>Data Backup &amp; Portability</strong>
            <p style="font-size:12px; color:var(--muted); margin-top:2px;">
              Local storage currently utilizes <strong>${kb} KB</strong> on this browser. All curriculum checks, notes, and study logs are stored purely client-side.
            </p>
          </div>
          <div style="display:flex; gap:10px;">
            <button class="button button-primary" onclick="window.trackerExportData()">↓ Export JSON Backup</button>
            <button class="button button-soft" onclick="$('importFile').click()">↑ Import JSON Backup</button>
          </div>
        </div>

        <!-- Danger Zone Reset -->
        <div class="planner-task-card" style="border-color:var(--red-soft); background:var(--red-soft);">
          <div>
            <strong style="color:var(--red-text);">Reset Learning Progress</strong>
            <p style="font-size:12px; color:var(--red-text); margin:0;">
              Clear all user-entered checkmarks, notes, and history from browser localStorage. The original curriculum remains untouched.
            </p>
          </div>
          <button class="button button-danger" onclick="window.trackerShowResetModal()">Reset All Progress</button>
        </div>
      </div>
    `;
  }

  // ==========================================================================
  // VIEW RENDERER 13: FOCUS MODE OVERLAY
  // ==========================================================================
  function renderFocusModeBody() {
    const body = $('focusModeBody');
    if (!body) return;

    const topic = state.focusModeTopic || 'General Deep Work';
    const mins = Math.floor(state.timerSecondsLeft / 60);
    const secs = state.timerSecondsLeft % 60;
    const timeFormatted = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

    body.innerHTML = `
      <div class="timer-main-card" style="max-width:600px; margin:0 auto; width:100%;">
        <div class="timer-display" id="focusClockDisplay">${timeFormatted}</div>
        <div style="font-size:16px; font-weight:700; color:var(--text);">${esc(topic)}</div>
        <div class="timer-actions">
          ${state.timerIsRunning ? `
            <button class="button button-primary" onclick="window.trackerPauseTimer()">⏸ Pause</button>
          ` : `
            <button class="button button-primary" onclick="window.trackerStartTimer()">▶ Start Focus</button>
          `}
          <button class="button button-soft" onclick="window.trackerResetTimer()">↺ Reset</button>
        </div>
      </div>
      <div class="note-panel" style="max-width:600px; margin:0 auto; width:100%;">
        <div class="note-heading"><span>✎ Focus Scratchpad</span></div>
        <textarea style="min-height:120px;" placeholder="Write rapid scratchpad thoughts during deep work..."></textarea>
      </div>
    `;
  }

  // ==========================================================================
  // GLOBAL SEARCH ENGINE
  // ==========================================================================
  function runGlobalSearch(query) {
    const q = (query || '').trim().toLowerCase();
    const resultsContainer = $('globalSearchResults');
    if (!resultsContainer) return;

    if (q.length < 2) {
      resultsContainer.innerHTML = `<div class="empty-state">Type at least 2 characters to search across all 120 days and 5 projects…</div>`;
      return;
    }

    const matches = [];

    // Search Curriculum
    CURRICULUM.weeks.forEach(w => {
      w.days.forEach((d, di) => {
        const inTheory = (d.theory || []).some(t => t.toLowerCase().includes(q));
        const inPractice = (d.practice || []).some(p => p.toLowerCase().includes(q));
        const inTitle = d.title.toLowerCase().includes(q);

        if (inTitle || inTheory || inPractice) {
          matches.push({
            type: 'curriculum',
            title: `Week ${w.id} · Day ${d.dayNumber || (di + 1)}: ${d.title}`,
            subtext: w.title,
            action: () => {
              $('searchModal').hidden = true;
              window.trackerNavigateToDay(w.id, di);
            }
          });
        }
      });
    });

    // Search Projects
    CURRICULUM.projects.forEach(p => {
      const inTitle = p.title.toLowerCase().includes(q);
      const inObj = p.objective.toLowerCase().includes(q);
      const inStack = (p.stack || []).some(s => s.toLowerCase().includes(q));

      if (inTitle || inObj || inStack) {
        matches.push({
          type: 'project',
          title: p.title,
          subtext: `Target Stack: ${(p.stack || []).join(', ')}`,
          action: () => {
            $('searchModal').hidden = true;
            navigateTo('project', p.id);
          }
        });
      }
    });

    // Search Vault Notes
    (state.data.notesVault || []).forEach(n => {
      if (n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q) || (n.codeSnippet || '').toLowerCase().includes(q)) {
        matches.push({
          type: 'vault',
          title: `Vault: ${n.title}`,
          subtext: n.category,
          action: () => {
            $('searchModal').hidden = true;
            navigateTo('vault');
          }
        });
      }
    });

    if (matches.length === 0) {
      resultsContainer.innerHTML = `<div class="empty-state">No matching results found for "${esc(query)}".</div>`;
      return;
    }

    resultsContainer.innerHTML = matches.slice(0, 30).map((m, idx) => `
      <div class="search-item" id="search-item-${idx}">
        <div>
          <div style="font-weight:700; font-size:13px;">${esc(m.title)}</div>
          <div style="font-size:11px; color:var(--muted);">${esc(m.subtext)}</div>
        </div>
        <span class="status-pill in-progress" style="font-size:9.5px;">${esc(m.type.toUpperCase())}</span>
      </div>
    `).join('');

    matches.slice(0, 30).forEach((m, idx) => {
      const el = $(`search-item-${idx}`);
      if (el) el.onclick = m.action;
    });
  }

  // ==========================================================================
  // BACKUP EXPORT & IMPORT (MERGE & REPLACE)
  // ==========================================================================
  function exportProgressJSON() {
    const payload = {
      ...state.data,
      schemaVersion: 1,
      exportedAt: new Date().toISOString()
    };
    state.data.lastBackupAt = new Date().toISOString();
    persist(true);

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `my_roadmap_progress_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Progress exported successfully! Backup safe.');
  }

  let pendingImportPayload = null;

  function handleFileSelected(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (!parsed || typeof parsed !== 'object') {
          showToast('Invalid backup file. Please select a valid JSON export.');
          return;
        }
        pendingImportPayload = parsed;
        const meta = $('importPreviewMeta');
        if (meta) {
          meta.innerHTML = `
            <div style="font-size:11.5px; color:var(--muted); background:var(--surface-2); padding:10px; border-radius:8px;">
              Export Date: <strong>${parsed.exportedAt || 'Unknown'}</strong> ·
              Version: <strong>${parsed.version || 1}</strong>
            </div>
          `;
        }
        $('importModal').hidden = false;
      } catch (err) {
        showToast('Could not parse file. JSON is malformed.');
        console.error(err);
      }
    };
    reader.readAsText(file);
  }

  function executeImport(mode) {
    if (!pendingImportPayload) return;

    if (mode === 'replace') {
      state.data = {
        ...freshData(),
        ...pendingImportPayload,
        version: 1,
        updatedAt: new Date().toISOString()
      };
    } else {
      // Merge mode
      const incoming = pendingImportPayload;
      // Merge weeks checks & notes
      Object.entries(incoming.weeks || {}).forEach(([wId, wData]) => {
        const cur = getWeekData(wId);
        cur.checks = { ...cur.checks, ...(wData.checks || {}) };
        cur.notes = { ...cur.notes, ...(wData.notes || {}) };
        cur.ideas = { ...cur.ideas, ...(wData.ideas || {}) };
      });
      // Merge projects
      Object.entries(incoming.projects || {}).forEach(([pId, pData]) => {
        const cur = getProjectData(pId);
        cur.checks = { ...cur.checks, ...(pData.checks || {}) };
        cur.notes = { ...cur.notes, ...(pData.notes || {}) };
      });
      // Merge artifacts
      state.data.artifacts = { ...(state.data.artifacts || {}), ...(incoming.artifacts || {}) };
      // Merge focus sessions (avoid duplicate ids)
      const existingSessionIds = new Set((state.data.focusSessions || []).map(s => s.id));
      (incoming.focusSessions || []).forEach(s => {
        if (!existingSessionIds.has(s.id)) state.data.focusSessions.push(s);
      });
      // Merge notes vault
      const existingVaultIds = new Set((state.data.notesVault || []).map(n => n.id));
      (incoming.notesVault || []).forEach(n => {
        if (!existingVaultIds.has(n.id)) state.data.notesVault.push(n);
      });
      // Merge revisions
      state.data.revisions = { ...(state.data.revisions || {}), ...(incoming.revisions || {}) };
      // Merge reviews
      state.data.weeklyReviews = { ...(state.data.weeklyReviews || {}), ...(incoming.weeklyReviews || {}) };
      // Merge skills
      state.data.skills = { ...(state.data.skills || {}), ...(incoming.skills || {}) };
    }

    persist(true);
    applyTheme();
    renderApp();
    $('importModal').hidden = true;
    pendingImportPayload = null;
    showToast(`Data successfully imported via ${mode === 'replace' ? 'Replace' : 'Merge'}!`);
  }

  // ==========================================================================
  // THEME MANAGEMENT & TOAST FEEDBACK
  // ==========================================================================
  function applyTheme() {
    const t = state.data.theme === 'dark' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', t);

    const icon = $('themeIcon');
    const label = $('themeLabel');
    if (icon) icon.textContent = t === 'dark' ? '☼' : '◐';
    if (label) label.textContent = t === 'dark' ? 'Light mode' : 'Dark mode';

    const topToggle = $('topThemeToggle');
    if (topToggle) topToggle.textContent = t === 'dark' ? '☼' : '◐';
  }

  function showToast(msg) {
    const el = $('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  function triggerMilestoneAnimation(msg) {
    showToast(`🎉 ${msg}`);
  }

  // ==========================================================================
  // MASTER RENDER DISPATCHER
  // ==========================================================================
  function renderApp() {
    renderSidebar();
    renderHeaderOverview();
    updateBreadcrumbs();

    const container = $('primaryView');
    if (!container) return;

    const view = state.data.activeView;

    const overviewStrip = $('overviewStrip');
    if (overviewStrip) {
      overviewStrip.hidden = (view !== 'dashboard');
    }

    if (view === 'dashboard') {
      container.innerHTML = renderDashboard();
    } else if (view === 'roadmap' || view === 'week') {
      container.innerHTML = renderRoadmapWeeksView(state.data.activeWeekId || 1);
    } else if (view === 'my-day') {
      container.innerHTML = renderMyDay();
    } else if (view === 'timer') {
      container.innerHTML = renderStudyTimer();
    } else if (view === 'project') {
      container.innerHTML = renderProjectWorkspace(state.data.activeProjectId);
    } else if (view === 'revisions') {
      container.innerHTML = renderRevisionCenter();
    } else if (view === 'analytics') {
      container.innerHTML = renderAnalytics();
    } else if (view === 'vault') {
      container.innerHTML = renderKnowledgeVault();
    } else if (view === 'reviews') {
      container.innerHTML = renderWeeklyReviews();
    } else if (view === 'skills') {
      container.innerHTML = renderSkillsMatrix();
    } else if (view === 'career') {
      container.innerHTML = renderCareerReadiness();
    } else if (view === 'settings') {
      container.innerHTML = renderSettings();
    }
  }

  // ==========================================================================
  // GLOBAL WINDOW ACTIONS (BOUND TO USER INTERACTIONS)
  // ==========================================================================
  window.trackerNavigate = navigateTo;

  window.trackerSelectRoadmapWeek = (weekId) => {
    state.data.activeWeekId = Number(weekId);
    state.data.activeView = 'roadmap';
    persist();
    renderApp();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  window.trackerToggleRoadmapDayExpand = (weekId, di) => {
    state.expandedDays = state.expandedDays || {};
    const key = `${weekId}-${di}`;
    const card = $(`roadmap-day-${weekId}-${di}`);
    const body = $(`day-body-${weekId}-${di}`);
    const chevron = $(`day-chevron-${weekId}-${di}`);

    const isCurrentlyExpanded = card ? card.classList.contains('expanded') : false;
    const nextState = !isCurrentlyExpanded;
    state.expandedDays[key] = nextState;

    if (card && body && chevron) {
      if (nextState) {
        card.classList.remove('collapsed');
        card.classList.add('expanded');
        body.style.display = 'block';
        chevron.textContent = '⌃';
      } else {
        card.classList.remove('expanded');
        card.classList.add('collapsed');
        body.style.display = 'none';
        chevron.textContent = '⌄';
      }
    }
  };

  window.trackerToggleRoadmapTask = (weekId, di, group, taskIndex, isChecked) => {
    const key = taskKey(di, group, taskIndex);
    const wd = getWeekData(weekId);
    if (isChecked) {
      wd.checks[key] = true;
    } else {
      delete wd.checks[key];
    }

    const row = $(`row-${weekId}-${di}-${group}-${taskIndex}`);
    if (row) {
      if (isChecked) row.classList.add('completed');
      else row.classList.remove('completed');
    }

    // Update Day Status Pill
    const week = CURRICULUM.weeks.find(w => w.id === Number(weekId));
    if (week && week.days && week.days[di]) {
      const d = week.days[di];
      const tCount = (d.theory || []).length;
      const pCount = (d.practice || []).length;
      const dTotal = tCount + pCount;
      const tDone = (d.theory || []).filter((_, ti) => wd.checks[taskKey(di, 't', ti)]).length;
      const pDone = (d.practice || []).filter((_, pi) => wd.checks[taskKey(di, 'p', pi)]).length;
      const dDone = tDone + pDone;
      const isCompleted = dTotal > 0 && dDone === dTotal;
      const hasNotes = Boolean((wd.notes[di] || '').trim());
      const isInProgress = !isCompleted && (dDone > 0 || hasNotes);

      const pill = $(`day-status-pill-${weekId}-${di}`);
      if (pill) {
        pill.className = `roadmap-status-pill ${isCompleted ? 'completed' : (isInProgress ? 'in-progress' : 'not-started')}`;
        pill.textContent = isCompleted ? 'Completed' : (isInProgress ? 'In Progress' : 'Not Started');
      }
    }

    // Update Banner & Donut Stats
    if (week) {
      const totalTasks = weekTaskCount(week);
      const doneTasks = weekDoneCount(week.id);
      const weekPct = totalTasks ? Math.round((doneTasks / totalTasks) * 100) : 0;
      const daysCount = week.days.length;

      let completedDays = 0;
      week.days.forEach((d, dIdx) => {
        const dtTotal = (d.theory || []).length + (d.practice || []).length;
        const dtDone = (d.theory || []).filter((_, ti) => wd.checks[taskKey(dIdx, 't', ti)]).length +
                       (d.practice || []).filter((_, pi) => wd.checks[taskKey(dIdx, 'p', pi)]).length;
        if (dtTotal > 0 && dtDone === dtTotal) completedDays++;
      });
      const remainingDays = Math.max(0, daysCount - completedDays);

      const bannerFill = $('bannerProgressFill');
      const bannerText = $('bannerProgressText');
      if (bannerFill) bannerFill.style.width = `${weekPct}%`;
      if (bannerText) bannerText.textContent = `${weekPct}%`;

      const donutArc = $('overviewDonutArc');
      const donutText = $('overviewDonutText');
      if (donutArc) donutArc.style.strokeDashoffset = `${Math.max(0, 251.3 * (1 - weekPct / 100))}`;
      if (donutText) donutText.textContent = `${weekPct}%`;

      const doneEl = $('overviewDaysDone');
      const remEl = $('overviewDaysRemaining');
      if (doneEl) doneEl.textContent = `${completedDays}/${daysCount} Days Done`;
      if (remEl) remEl.textContent = `${remainingDays} Remaining`;
    }

    logActivity('task', `${isChecked ? 'Checked' : 'Unchecked'} task in Week ${weekId}, Day ${di + 1}`);
    persist(true);
    renderHeaderOverview();
  };

  const noteSaveTimers = {};
  window.trackerInputRoadmapNote = (weekId, di, val) => {
    const wd = getWeekData(weekId);
    wd.notes[di] = val;

    const statusEl = $(`note-status-${weekId}-${di}`);
    if (statusEl) statusEl.textContent = '● Saving...';

    clearTimeout(noteSaveTimers[`${weekId}-${di}`]);
    noteSaveTimers[`${weekId}-${di}`] = setTimeout(() => {
      persist(true);
      if (statusEl) statusEl.textContent = '✓ Saved';
      updateNotesSummaryCount(weekId);
    }, 400);
  };

  window.trackerSaveRoadmapNoteBtn = (weekId, di) => {
    const input = $(`note-input-${weekId}-${di}`);
    const wd = getWeekData(weekId);
    if (input && typeof input.value === 'string') {
      wd.notes[di] = input.value;
    }
    persist(true);

    const statusEl = $(`note-status-${weekId}-${di}`);
    if (statusEl) {
      statusEl.textContent = '✓ Saved!';
      statusEl.style.color = '#10b981';
      setTimeout(() => { if (statusEl) statusEl.style.color = ''; }, 1800);
    }
    updateNotesSummaryCount(weekId);
    showToast('💾 Day notes saved to browser storage!');
  };

  function updateNotesSummaryCount(weekId) {
    const wd = getWeekData(weekId);
    const count = Object.values(wd.notes || {}).filter(n => typeof n === 'string' && n.trim().length > 0).length;
    const countEl = $('widgetNotesCount');
    if (countEl) countEl.textContent = `${count} notes saved this week`;
  }

  window.trackerMarkWeekDone = (weekId) => {
    const week = CURRICULUM.weeks.find(w => w.id === Number(weekId));
    if (!week) return;
    const wd = getWeekData(weekId);
    week.days.forEach((d, di) => {
      (d.theory || []).forEach((_, ti) => { wd.checks[taskKey(di, 't', ti)] = true; });
      (d.practice || []).forEach((_, pi) => { wd.checks[taskKey(di, 'p', pi)] = true; });
    });
    logActivity('milestone', `Completed all tasks for Week ${weekId}: ${week.title}`);
    persist(true);
    renderApp();
    showToast(`🎉 Week ${weekId} marked as completed!`);
  };

  window.trackerDownloadWeekResources = (weekId) => {
    const week = CURRICULUM.weeks.find(w => w.id === Number(weekId));
    if (!week) return;
    const wd = getWeekData(weekId);

    let md = `# Week ${week.id} — ${week.title}\n\n`;
    md += `**Phase**: ${week.phase.toUpperCase()}\n`;
    md += `**Description**: ${week.description || ''}\n\n`;
    md += `## Daily Learning Curriculum & Exercises\n\n`;

    week.days.forEach((d, di) => {
      const curNum = d.dayNumber || (di + 1);
      md += `### Day ${curNum}: ${d.title}\n\n`;
      md += `#### What to Learn (Theory Concepts)\n`;
      (d.theory || []).forEach(item => {
        md += `- ${item}\n`;
      });
      md += `\n#### What to Practice (Hands-on Exercises)\n`;
      (d.practice || []).forEach((item, pi) => {
        const isDone = Boolean(wd.checks[taskKey(di, 'p', pi)]);
        md += `- [${isDone ? 'x' : ' '}] ${item}\n`;
      });
      const note = (wd.notes[di] || '').trim();
      if (note) {
        md += `\n#### Personal Notes\n${note}\n`;
      }
      md += `\n---\n\n`;
    });

    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Week-${week.id}-${week.title.replace(/[^a-zA-Z0-9]/g, '_')}-Resources.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showToast(`↓ Downloaded Week ${weekId} curriculum resources!`);
  };

  window.trackerOpenWeekPlan = (weekId) => {
    navigateTo('reviews');
  };

  window.trackerNavigateToDay = (targetWeekId, targetDayIndex) => {
    state.data.activeWeekId = targetWeekId;
    state.data.activeView = 'roadmap';
    if (!state.expandedDays) state.expandedDays = {};
    state.expandedDays[`${targetWeekId}-${targetDayIndex}`] = true;
    renderApp();
    setTimeout(() => {
      const el = $(`roadmap-day-${targetWeekId}-${targetDayIndex}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.style.outline = '2px solid var(--accent)';
        setTimeout(() => { el.style.outline = 'none'; }, 1500);
      }
    }, 120);
  };

  window.trackerCheckTask = (weekId, key, isChecked, taskTitle) => {
    const wd = getWeekData(weekId);
    wd.checks[key] = isChecked;
    persist(true);
    logActivity('task_completed', `${isChecked ? 'Completed' : 'Unchecked'}: ${taskTitle}`);
    renderApp();
    if (isChecked) {
      showToast('Progress saved ✓');
    }
  };

  window.trackerCheckProjectTask = (projectId, key, isChecked, taskTitle) => {
    const pd = getProjectData(projectId);
    pd.checks[key] = isChecked;
    persist(true);
    logActivity('task_completed', `${isChecked ? 'Completed' : 'Unchecked'}: ${taskTitle}`);
    renderApp();
    if (isChecked) showToast('Project task saved ✓');
  };

  window.trackerSaveNote = (weekId, dayIndex, val, labelId) => {
    const wd = getWeekData(weekId);
    wd.notes[dayIndex] = val;
    persist();
    const lbl = $(`saved-${labelId}`);
    if (lbl) {
      lbl.classList.add('visible');
      setTimeout(() => lbl.classList.remove('visible'), 1200);
    }
  };

  window.trackerSaveIdea = (weekId, dayIndex, val, labelId) => {
    const wd = getWeekData(weekId);
    wd.ideas[dayIndex] = val;
    persist();
    const lbl = $(`saved-${labelId}`);
    if (lbl) {
      lbl.classList.add('visible');
      setTimeout(() => lbl.classList.remove('visible'), 1200);
    }
  };

  window.trackerSaveProjectNote = (projectId, roleIndex, val, labelId) => {
    const pd = getProjectData(projectId);
    pd.notes[roleIndex] = val;
    persist();
    const lbl = $(`saved-${labelId}`);
    if (lbl) {
      lbl.classList.add('visible');
      setTimeout(() => lbl.classList.remove('visible'), 1200);
    }
  };

  window.trackerSaveArtifact = (projectId, field, val) => {
    if (!state.data.artifacts[projectId]) state.data.artifacts[projectId] = {};
    state.data.artifacts[projectId][field] = val;
    persist();
  };

  window.trackerSetProjectRole = (index) => {
    state.projectRoleActiveIndex = index;
    renderApp();
  };

  window.trackerToggleIncompleteFilter = (val) => {
    state.data.showOnlyIncomplete = Boolean(val);
    persist();
    renderApp();
  };

  // Study Timer Controls
  window.trackerSetTimerDuration = (mins) => {
    clearInterval(state.timerInterval);
    state.timerIsRunning = false;
    state.timerTotalSeconds = mins * 60;
    state.timerSecondsLeft = mins * 60;
    renderApp();
  };

  window.trackerSetTimerTopic = (topic) => {
    state.timerTag.topic = topic;
  };

  window.trackerStartTimer = () => {
    if (state.timerIsRunning) return;
    state.timerIsRunning = true;
    renderApp();

    state.timerInterval = setInterval(() => {
      if (state.timerSecondsLeft > 0) {
        state.timerSecondsLeft--;
        // Update DOM clocks directly to prevent full re-renders
        const mins = Math.floor(state.timerSecondsLeft / 60);
        const secs = state.timerSecondsLeft % 60;
        const formatted = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
        const clock = $('timerClockDisplay');
        if (clock) clock.textContent = formatted;
        const focusClock = $('focusClockDisplay');
        if (focusClock) focusClock.textContent = formatted;
        const bar = $('timerProgressBar');
        if (bar && state.timerTotalSeconds > 0) {
          const pct = Math.round(((state.timerTotalSeconds - state.timerSecondsLeft) / state.timerTotalSeconds) * 100);
          bar.style.width = `${pct}%`;
        }
      } else {
        clearInterval(state.timerInterval);
        state.timerIsRunning = false;
        // Session complete
        const duration = Math.round(state.timerTotalSeconds / 60);
        const session = {
          id: 'fs-' + Date.now(),
          durationMinutes: duration,
          date: new Date().toISOString(),
          topic: state.timerTag.topic || 'General Study'
        };
        state.data.focusSessions.unshift(session);
        logActivity('focus_session', `Completed ${duration}m focus session: ${session.topic}`);
        triggerMilestoneAnimation(`Focus session complete! ${duration} minutes logged.`);
        persist(true);
        renderApp();
      }
    }, 1000);
  };

  window.trackerPauseTimer = () => {
    clearInterval(state.timerInterval);
    state.timerIsRunning = false;
    renderApp();
  };

  window.trackerResetTimer = () => {
    clearInterval(state.timerInterval);
    state.timerIsRunning = false;
    state.timerSecondsLeft = state.timerTotalSeconds;
    renderApp();
  };

  // Planner Task Actions
  window.trackerSetPlannerFilter = (f) => {
    state.plannerFilter = f;
    renderApp();
  };

  window.trackerAddCustomTask = (e) => {
    e.preventDefault();
    const input = $('quickTaskInput');
    const priority = $('quickTaskPriority')?.value || 'med';
    if (!input || !input.value.trim()) return;

    const newTask = {
      id: 'ct-' + Date.now(),
      title: input.value.trim(),
      priority,
      date: new Date().toISOString().slice(0, 10),
      completed: false,
      status: 'not-started'
    };

    state.data.customTasks.unshift(newTask);
    logActivity('custom_task', `Added custom task: ${newTask.title}`);
    persist(true);
    input.value = '';
    renderApp();
    showToast('Task added to My Day ✓');
  };

  window.trackerTogglePlannerTask = (taskId, isChecked) => {
    if (taskId.startsWith('ct-')) {
      const task = (state.data.customTasks || []).find(t => t.id === taskId);
      if (task) {
        task.completed = isChecked;
        task.status = isChecked ? 'completed' : 'not-started';
      }
    } else {
      // Curriculum task: w1-d0-t0
      const parts = taskId.match(/w(\d+)-d(\d+)-([tp])(\d+)/);
      if (parts) {
        const [, wId, dIndex, grp, tIndex] = parts;
        const wd = getWeekData(wId);
        wd.checks[taskKey(Number(dIndex), grp, Number(tIndex))] = isChecked;
      }
    }
    persist(true);
    renderApp();
  };

  window.trackerSetTaskPriority = (taskId, priority) => {
    if (taskId.startsWith('ct-')) {
      const task = (state.data.customTasks || []).find(t => t.id === taskId);
      if (task) task.priority = priority;
    } else {
      if (!state.data.taskOverrides[taskId]) state.data.taskOverrides[taskId] = {};
      state.data.taskOverrides[taskId].priority = priority;
    }
    persist(true);
    renderApp();
  };

  window.trackerDeleteCustomTask = (taskId) => {
    state.data.customTasks = (state.data.customTasks || []).filter(t => t.id !== taskId);
    persist(true);
    renderApp();
    showToast('Task removed');
  };

  window.trackerLaunchTaskInFocusMode = (topicTitle) => {
    state.focusModeTopic = topicTitle;
    $('focusModeTitle').textContent = topicTitle;
    $('focusModeOverlay').hidden = false;
    renderFocusModeBody();
  };

  window.trackerLaunchTimerForTask = (topic) => {
    state.timerTag.topic = topic;
    navigateTo('timer');
  };

  // Revision Center Actions
  window.trackerMarkRevisionPrompt = (key, title, weekId, dayIndex) => {
    const existing = state.data.revisions[key];
    const conf = existing ? existing.confidence : 3;
    const nextDate = new Date();
    nextDate.setDate(nextDate.getDate() + 4);

    state.data.revisions[key] = {
      title,
      weekId,
      dayIndex,
      confidence: conf,
      needsRevision: true,
      dueDate: nextDate.toISOString().slice(0, 10),
      history: existing?.history || []
    };
    persist(true);
    renderApp();
    showToast(`Added "${title}" to Revision Center ✓`);
  };

  window.trackerSetRevisionConfidence = (key, lvl) => {
    const r = state.data.revisions[key];
    if (!r) return;
    r.confidence = lvl;
    // Spaced repetition interval
    const intervals = { 1: 1, 2: 2, 3: 4, 4: 7, 5: 14 };
    const nextDate = new Date();
    nextDate.setDate(nextDate.getDate() + (intervals[lvl] || 4));
    r.dueDate = nextDate.toISOString().slice(0, 10);
    r.needsRevision = lvl < 5;
    persist(true);
    renderApp();
    showToast(`Confidence updated to ${lvl}/5. Next revision: ${r.dueDate}`);
  };

  window.trackerMarkRevised = (key) => {
    const r = state.data.revisions[key];
    if (!r) return;
    if (!r.history) r.history = [];
    r.history.push({ date: new Date().toISOString(), confidence: r.confidence });

    // Extend next interval
    const intervals = { 1: 2, 2: 4, 3: 7, 4: 14, 5: 30 };
    const nextDate = new Date();
    nextDate.setDate(nextDate.getDate() + (intervals[r.confidence] || 7));
    r.dueDate = nextDate.toISOString().slice(0, 10);
    r.needsRevision = false;
    logActivity('revision_completed', `Revised: ${r.title}`);
    persist(true);
    renderApp();
    showToast(`Marked revised! Next scheduled review: ${r.dueDate}`);
  };

  // Blockers Actions
  window.trackerAddBlocker = (e, projectId) => {
    e.preventDefault();
    const input = $('blockerInput');
    if (!input || !input.value.trim()) return;
    const pd = getProjectData(projectId);
    if (!pd.blockers) pd.blockers = [];
    pd.blockers.push({ text: input.value.trim(), resolved: false });
    persist(true);
    input.value = '';
    renderApp();
    showToast('Blocker logged');
  };

  window.trackerToggleBlocker = (projectId, index, resolved) => {
    const pd = getProjectData(projectId);
    if (pd.blockers && pd.blockers[index]) {
      pd.blockers[index].resolved = resolved;
    }
    persist(true);
    renderApp();
  };

  window.trackerDeleteBlocker = (projectId, index) => {
    const pd = getProjectData(projectId);
    if (pd.blockers) pd.blockers.splice(index, 1);
    persist(true);
    renderApp();
  };

  window.trackerCopyPortfolioSummary = (projectId) => {
    const p = CURRICULUM.projects.find(x => x.id === projectId);
    const art = state.data.artifacts[projectId] || {};
    const text = `• Built ${p.title}: ${p.objective}\n• Tech Stack: ${(p.stack || []).join(', ')}\n• Demo: ${art.demo || 'Available on request'}\n• GitHub: ${art.github || 'Available on request'}`;
    navigator.clipboard.writeText(text).then(() => showToast('Resume bullet points copied to clipboard!'));
  };

  // Knowledge Vault Actions
  window.trackerSetVaultCategory = (cat) => {
    state.vaultFilterCat = cat;
    renderApp();
  };

  window.trackerToggleVaultFavorites = () => {
    state.vaultShowFavorites = !state.vaultShowFavorites;
    renderApp();
  };

  window.trackerToggleNoteFavorite = (id) => {
    const note = (state.data.notesVault || []).find(n => n.id === id);
    if (note) note.isFavorite = !note.isFavorite;
    persist(true);
    renderApp();
  };

  window.trackerDeleteVaultNote = (id) => {
    state.data.notesVault = (state.data.notesVault || []).filter(n => n.id !== id);
    persist(true);
    renderApp();
    showToast('Note deleted');
  };

  window.trackerCopyCodeSnippet = (id) => {
    const note = (state.data.notesVault || []).find(n => n.id === id);
    if (note && note.codeSnippet) {
      navigator.clipboard.writeText(note.codeSnippet).then(() => showToast('Code snippet copied to clipboard! ✓'));
    }
  };

  window.trackerShowAddNoteModal = () => {
    const title = prompt('Note Title:');
    if (!title || !title.trim()) return;
    const category = prompt('Category (Concept Notes / Code Snippets / Errors & Debugging Solutions / Interview Questions):', 'Code Snippets');
    const content = prompt('Key Notes / Explanation:');
    const code = prompt('Optional Code Snippet (or leave empty):', '');

    const newNote = {
      id: 'nv-' + Date.now(),
      title: title.trim(),
      category: category || 'Concept Notes',
      content: content || '',
      codeSnippet: code || '',
      isFavorite: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    state.data.notesVault.unshift(newNote);
    logActivity('vault_note', `Created note: ${newNote.title}`);
    persist(true);
    renderApp();
    showToast('Note added to Knowledge Vault ✓');
  };

  // Weekly Reviews Actions
  window.trackerSetReviewWeek = (weekId) => {
    state.reviewWeekId = Number(weekId);
    renderApp();
  };

  window.trackerSaveReviewAnswer = (weekId, questionIndex, val) => {
    const key = String(weekId);
    if (!state.data.weeklyReviews[key]) {
      state.data.weeklyReviews[key] = { answers: [] };
    }
    state.data.weeklyReviews[key].answers[questionIndex] = val;
    state.data.weeklyReviews[key].completedAt = new Date().toISOString();
    persist();
  };

  // Skills Matrix Actions
  window.trackerSetSkillLevel = (skillName, lvl) => {
    if (!state.data.skills[skillName]) state.data.skills[skillName] = {};
    state.data.skills[skillName].level = lvl;
    persist(true);
    renderApp();
  };

  window.trackerSetSkillEvidence = (skillName, url) => {
    if (!state.data.skills[skillName]) state.data.skills[skillName] = {};
    state.data.skills[skillName].evidence = url;
    persist();
  };

  // Career Readiness Actions
  window.trackerShowAddJobModal = () => {
    const company = prompt('Target Company:');
    if (!company || !company.trim()) return;
    const role = prompt('Role Title:', 'AI Automation Engineer');
    const link = prompt('Job Description / Application URL:', '');

    const newApp = {
      id: 'app-' + Date.now(),
      company: company.trim(),
      role: role || 'AI Automation Engineer',
      date: new Date().toISOString().slice(0, 10),
      status: 'Applied',
      link: link || '',
      notes: ''
    };
    if (!state.data.career.applications) state.data.career.applications = [];
    state.data.career.applications.unshift(newApp);
    logActivity('job_application', `Logged application for ${newApp.company}`);
    persist(true);
    renderApp();
    showToast('Application logged ✓');
  };

  window.trackerDeleteJobApp = (id) => {
    state.data.career.applications = (state.data.career.applications || []).filter(a => a.id !== id);
    persist(true);
    renderApp();
  };

  // Theme & Settings Actions
  window.trackerToggleTheme = () => {
    state.data.theme = state.data.theme === 'dark' ? 'light' : 'dark';
    applyTheme();
    persist(true);
    renderApp();
    showToast(`Switched to ${state.data.theme} mode`);
  };

  window.trackerExportData = exportProgressJSON;

  window.trackerShowResetModal = () => {
    $('resetModal').hidden = false;
  };

  // ==========================================================================
  // STATIC DOM EVENT LISTENERS
  // ==========================================================================
  function bindStaticEvents() {
    // Navigation sidebar item clicks
    document.querySelectorAll('.sidebar .nav-item[data-view]').forEach(btn => {
      btn.addEventListener('click', () => navigateTo(btn.dataset.view));
    });

    $('nav-settings')?.addEventListener('click', () => navigateTo('settings'));
    $('themeToggle')?.addEventListener('click', window.trackerToggleTheme);
    $('topThemeToggle')?.addEventListener('click', window.trackerToggleTheme);

    // Mobile Sidebar Drawer
    $('menuToggle')?.addEventListener('click', () => $('sidebar').classList.toggle('open'));

    // Export & Import
    $('exportBtn')?.addEventListener('click', exportProgressJSON);
    $('importBtn')?.addEventListener('click', () => $('importFile')?.click());
    $('importFile')?.addEventListener('change', e => {
      handleFileSelected(e.target.files[0]);
      e.target.value = '';
    });

    // Import Modal Confirmation
    $('confirmImportBtn')?.addEventListener('click', () => {
      const mode = document.querySelector('input[name="importMode"]:checked')?.value || 'merge';
      executeImport(mode);
    });
    $('cancelImportBtn')?.addEventListener('click', () => {
      $('importModal').hidden = true;
      pendingImportPayload = null;
    });

    // Reset Modal Confirmation
    $('confirmResetBtn')?.addEventListener('click', () => {
      state.data = freshData();
      persist(true);
      applyTheme();
      renderApp();
      $('resetModal').hidden = true;
      showToast('All personal progress has been reset.');
    });
    $('cancelResetBtn')?.addEventListener('click', () => {
      $('resetModal').hidden = true;
    });

    // Search Trigger & Modal
    $('searchTriggerBtn')?.addEventListener('click', () => {
      $('searchModal').hidden = false;
      $('globalSearchInput')?.focus();
    });
    $('searchCloseBtn')?.addEventListener('click', () => {
      $('searchModal').hidden = true;
    });
    $('globalSearchInput')?.addEventListener('input', e => {
      runGlobalSearch(e.target.value);
    });

    // Focus Mode
    $('enterFocusModeBtn')?.addEventListener('click', () => {
      state.focusModeTopic = 'General Deep Work Session';
      $('focusModeTitle').textContent = 'General Deep Work';
      $('focusModeOverlay').hidden = false;
      renderFocusModeBody();
    });
    $('exitFocusModeBtn')?.addEventListener('click', () => {
      $('focusModeOverlay').hidden = true;
      renderApp();
    });

    // Keyboard Shortcuts
    document.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        $('searchModal').hidden = false;
        $('globalSearchInput')?.focus();
      }
      if (e.key === 'Escape') {
        $('searchModal').hidden = true;
        $('importModal').hidden = true;
        $('resetModal').hidden = true;
        $('focusModeOverlay').hidden = true;
        $('sidebar').classList.remove('open');
      }
    });

    // Safe Page Unload
    window.addEventListener('beforeunload', () => {
      clearTimeout(state.saveTimer);
      persist(true);
    });
  }

  // ==========================================================================
  // INITIALIZATION
  // ==========================================================================
  bindStaticEvents();
  applyTheme();
  renderApp();
  console.log('My Roadmap Tracker initialized successfully. Version:', state.data.version);
})();
