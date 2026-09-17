/**
 * ============================================================
 *  Cupix Capture Tracker — application logic
 * ============================================================
 * Talks only to `Store` (see data.js). Renders five views into
 * #view-root and uses a single modal (#modal-root) for forms and
 * the calendar day-detail panel.
 * ============================================================
 */

const STATE = {
  view: "dashboard",
  data: { projects: [], people: [], schedule: [] },
  calendar: (() => {
    const t = new Date();
    return { year: t.getFullYear(), month: t.getMonth(), projectFilter: "all" };
  })(),
  reports: (() => {
    const t = new Date();
    return { year: t.getFullYear(), month: t.getMonth(), projectFilter: "all" };
  })(),
};

/* ================= small utilities ================= */

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

function byId(list, id) {
  return list.find((x) => x.id === id) || null;
}

function projectName(id) {
  const p = byId(STATE.data.projects, id);
  return p ? p.name : "(deleted project)";
}

function personName(id) {
  if (!id) return "Unassigned";
  const p = byId(STATE.data.people, id);
  return p ? p.name : "(removed)";
}

function initials(name) {
  return (name || "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
}

function formatDateHuman(dateStr) {
  if (!dateStr) return "—";
  return parseDateStr(dateStr).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatDayMonth(dateStr) {
  return parseDateStr(dateStr).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function formatPercent(x) {
  return x === null || x === undefined ? "—" : `${Math.round(x * 100)}%`;
}

function frequencyLabel(f) {
  return { weekly: "Weekly", biweekly: "Every 2 weeks", monthly: "Monthly", manual: "Manual" }[f] || f;
}

function entriesInMonth(entries, year, month) {
  const prefix = `${year}-${String(month + 1).padStart(2, "0")}`;
  return entries.filter((e) => e.plannedDate.startsWith(prefix));
}

function filterByProject(entries, projectId) {
  return projectId === "all" ? entries : entries.filter((e) => e.projectId === projectId);
}

function sortedByPlannedDate(entries, dir = 1) {
  return [...entries].sort((a, b) => (a.plannedDate < b.plannedDate ? -1 : 1) * dir);
}

function daysOverdue(dateStr) {
  const ms = parseDateStr(todayStr()) - parseDateStr(dateStr);
  return Math.round(ms / 86400000);
}

/* ================= schedule generation helper ================= */

async function regenerateSchedule(project) {
  if (!project || project.frequency === "manual" || !project.anchorDate) return;
  const fresh = await Store.getData();
  const horizon = addMonthsKeepDay(todayStr(), SCHEDULE_HORIZON_MONTHS);
  const wanted = generatePlannedDates(project, horizon);
  const existing = new Set(
    fresh.schedule.filter((e) => e.projectId === project.id).map((e) => e.plannedDate)
  );
  const toAdd = wanted.filter((d) => !existing.has(d));
  if (toAdd.length) {
    await Store.addScheduleEntries(
      toAdd.map((d) => ({ projectId: project.id, personId: project.defaultAssigneeId || null, plannedDate: d }))
    );
  }
}

/* ================= toast + modal ================= */

function showToast(message, isError = false) {
  const root = document.getElementById("toast-root");
  const el = document.createElement("div");
  el.className = "toast" + (isError ? " error" : "");
  el.textContent = message;
  root.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

function openModal(html) {
  const root = document.getElementById("modal-root");
  root.innerHTML = `<div class="modal-overlay" id="modal-overlay"><div class="modal">${html}</div></div>`;
  document.getElementById("modal-overlay").addEventListener("click", (e) => {
    if (e.target.id === "modal-overlay") closeModal();
  });
}

function closeModal() {
  document.getElementById("modal-root").innerHTML = "";
}

/* ================= data refresh ================= */

async function refreshDataOnly() {
  try {
    STATE.data = await Store.getData();
  } catch (err) {
    showToast("Could not load data: " + (err.message || err), true);
  }
}

async function afterMutate() {
  await refreshDataOnly();
  render();
}

/* ================= init ================= */

function init() {
  const banner = document.getElementById("mode-banner");
  banner.hidden = false;
  if (Store.mode === "remote") {
    banner.classList.add("remote");
    banner.textContent = "Connected to Google Sheets — everyone who opens this site shares the same data.";
  } else {
    banner.textContent =
      "Demo mode — data is saved only in this browser. Connect Google Sheets (see README.md) so your team shares one tracker.";
  }

  document.querySelectorAll(".tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      STATE.view = btn.dataset.view;
      render();
    });
  });

  document.addEventListener("click", handleGlobalClick);

  refreshDataOnly().then(render);
}

/* ================= global click delegation ================= */

async function handleGlobalClick(e) {
  const el = e.target.closest("[data-action]");
  if (!el) return;
  const action = el.dataset.action;

  if (action === "close-modal") {
    closeModal();
    return;
  }

  if (action === "cal-prev" || action === "cal-next" || action === "cal-today") {
    if (action === "cal-today") {
      const t = new Date();
      STATE.calendar.year = t.getFullYear();
      STATE.calendar.month = t.getMonth();
    } else {
      const delta = action === "cal-prev" ? -1 : 1;
      let m = STATE.calendar.month + delta;
      let y = STATE.calendar.year;
      if (m < 0) { m = 11; y -= 1; }
      if (m > 11) { m = 0; y += 1; }
      STATE.calendar.month = m;
      STATE.calendar.year = y;
    }
    render();
    return;
  }

  if (action === "report-prev" || action === "report-next") {
    const delta = action === "report-prev" ? -1 : 1;
    let m = STATE.reports.month + delta;
    let y = STATE.reports.year;
    if (m < 0) { m = 11; y -= 1; }
    if (m > 11) { m = 0; y += 1; }
    STATE.reports.month = m;
    STATE.reports.year = y;
    render();
    return;
  }

  if (action === "print-report") {
    window.print();
    return;
  }

  if (action === "open-day") {
    openDayModal(el.dataset.date);
    return;
  }

  if (action === "add-project") {
    openProjectModal(null);
    return;
  }
  if (action === "edit-project") {
    openProjectModal(byId(STATE.data.projects, el.dataset.id));
    return;
  }
  if (action === "delete-project") {
    if (!confirm("Delete this project and all of its planned/captured dates? This can't be undone.")) return;
    try {
      await Store.deleteProject(el.dataset.id);
      await afterMutate();
      showToast("Project deleted");
    } catch (err) {
      showToast(err.message || "Could not delete project", true);
    }
    return;
  }
  if (action === "regen-schedule") {
    const project = byId(STATE.data.projects, el.dataset.id);
    try {
      await regenerateSchedule(project);
      await afterMutate();
      showToast("Schedule refreshed");
    } catch (err) {
      showToast(err.message || "Could not refresh schedule", true);
    }
    return;
  }

  if (action === "add-person") {
    openPersonModal(null);
    return;
  }
  if (action === "edit-person") {
    openPersonModal(byId(STATE.data.people, el.dataset.id));
    return;
  }
  if (action === "delete-person") {
    if (!confirm("Remove this person? Captures already logged under their name will show as “removed”.")) return;
    try {
      await Store.deletePerson(el.dataset.id);
      await afterMutate();
      showToast("Person removed");
    } catch (err) {
      showToast(err.message || "Could not remove person", true);
    }
    return;
  }

  if (action === "mark-captured-today") {
    try {
      await Store.updateScheduleEntry(el.dataset.id, { capturedDate: todayStr() });
      await afterMutate();
      showToast("Marked as captured");
    } catch (err) {
      showToast(err.message || "Could not update", true);
    }
    return;
  }

  if (action === "mark-captured-on") {
    const row = el.closest("[data-entry-row]");
    const dateInput = row.querySelector("input[type=date]");
    try {
      await Store.updateScheduleEntry(el.dataset.id, { capturedDate: dateInput.value || todayStr() });
      await refreshDataOnly();
      render();
      openDayModal(el.dataset.reopenDate);
      showToast("Marked as captured");
    } catch (err) {
      showToast(err.message || "Could not update", true);
    }
    return;
  }

  if (action === "undo-capture") {
    try {
      await Store.updateScheduleEntry(el.dataset.id, { capturedDate: null });
      await refreshDataOnly();
      render();
      if (el.dataset.reopenDate) openDayModal(el.dataset.reopenDate);
      showToast("Capture cleared");
    } catch (err) {
      showToast(err.message || "Could not update", true);
    }
    return;
  }

  if (action === "delete-entry") {
    if (!confirm("Remove this planned capture?")) return;
    try {
      await Store.deleteScheduleEntry(el.dataset.id);
      await refreshDataOnly();
      render();
      if (el.dataset.reopenDate) openDayModal(el.dataset.reopenDate);
      showToast("Removed");
    } catch (err) {
      showToast(err.message || "Could not remove", true);
    }
    return;
  }

  if (action === "add-entry-for-day") {
    const date = el.dataset.date;
    const projectSel = document.getElementById("add-entry-project");
    const personSel = document.getElementById("add-entry-person");
    if (!projectSel.value) {
      showToast("Choose a project first", true);
      return;
    }
    try {
      await Store.addScheduleEntries([
        { projectId: projectSel.value, personId: personSel.value || null, plannedDate: date },
      ]);
      await refreshDataOnly();
      render();
      openDayModal(date);
      showToast("Planned capture added");
    } catch (err) {
      showToast(err.message || "Could not add", true);
    }
    return;
  }
}

/* ================= render dispatch ================= */

function render() {
  document.querySelectorAll(".tab").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === STATE.view);
  });
  const root = document.getElementById("view-root");
  if (STATE.view === "dashboard") root.innerHTML = renderDashboard();
  else if (STATE.view === "calendar") renderCalendarInto(root);
  else if (STATE.view === "projects") root.innerHTML = renderProjects();
  else if (STATE.view === "people") root.innerHTML = renderPeople();
  else if (STATE.view === "reports") root.innerHTML = renderReports();
  wireViewInputs();
}

function wireViewInputs() {
  const projFilter = document.getElementById("calendar-project-filter");
  if (projFilter) {
    projFilter.value = STATE.calendar.projectFilter;
    projFilter.addEventListener("change", () => {
      STATE.calendar.projectFilter = projFilter.value;
      render();
    });
  }
  const reportFilter = document.getElementById("report-project-filter");
  if (reportFilter) {
    reportFilter.value = STATE.reports.projectFilter;
    reportFilter.addEventListener("change", () => {
      STATE.reports.projectFilter = reportFilter.value;
      render();
    });
  }
  document.querySelectorAll("[data-toggle-active]").forEach((cb) => {
    cb.addEventListener("change", async () => {
      try {
        await Store.updateProject(cb.dataset.toggleActive, { active: cb.checked });
        await afterMutate();
      } catch (err) {
        showToast(err.message || "Could not update", true);
      }
    });
  });
}

/* ================= Dashboard ================= */

function renderDashboard() {
  const today = todayStr();
  const t = new Date();
  const monthEntries = entriesInMonth(STATE.data.schedule, t.getFullYear(), t.getMonth());
  const summary = summarize(monthEntries);

  const missing = sortedByPlannedDate(
    STATE.data.schedule.filter((e) => captureStatus(e) === "missing")
  ).slice(0, 8);

  const upcoming = sortedByPlannedDate(
    STATE.data.schedule.filter((e) => {
      if (captureStatus(e) !== "upcoming") return false;
      return e.plannedDate <= addDays(today, 7);
    })
  ).slice(0, 8);

  const projectRows = STATE.data.projects
    .filter((p) => p.active !== false)
    .map((p) => {
      const s = summarize(filterByProject(monthEntries, p.id));
      return { p, s };
    });

  return `
    <div class="view-header">
      <div>
        <h1>Dashboard</h1>
        <p>${monthLabel(t.getFullYear(), t.getMonth())} overview across ${STATE.data.projects.length} project${STATE.data.projects.length === 1 ? "" : "s"}</p>
      </div>
    </div>

    <div class="card-grid">
      <div class="card stat-card">
        <div class="stat-label">Planned this month</div>
        <div class="stat-value">${monthEntries.length}</div>
        <div class="stat-sub">${summary.upcoming} still upcoming</div>
      </div>
      <div class="card stat-card">
        <div class="stat-label">Captured on time</div>
        <div class="stat-value">${summary["on-time"]}</div>
        <div class="stat-sub">${summary.late} captured late</div>
      </div>
      <div class="card stat-card">
        <div class="stat-label">Missing</div>
        <div class="stat-value">${summary.missing}</div>
        <div class="stat-sub">out of ${summary.due} due so far</div>
      </div>
      <div class="card stat-card">
        <div class="stat-label">On-time rate (this month)</div>
        <div class="stat-value">${formatPercent(summary.onTimeRate)}</div>
        <div class="stat-sub">missing rate ${formatPercent(summary.missingRate)}</div>
      </div>
    </div>

    <div class="card-grid" style="grid-template-columns: 1.2fr 1fr;">
      <div class="card card-pad">
        <div class="section-title">Needs attention (overdue, not yet captured)</div>
        ${
          missing.length
            ? missing
                .map(
                  (e) => `
              <div class="list-row">
                <div class="list-row-main">
                  <div class="list-row-title">${escapeHtml(projectName(e.projectId))}</div>
                  <div class="list-row-sub">Planned ${formatDateHuman(e.plannedDate)} · ${daysOverdue(e.plannedDate)}d overdue · ${escapeHtml(personName(e.personId))}</div>
                </div>
                <button class="btn btn-small btn-primary" data-action="mark-captured-today" data-id="${e.id}">Mark captured</button>
              </div>`
                )
                .join("")
            : `<div class="empty-state">Nothing overdue. Clean sheet.</div>`
        }
      </div>
      <div class="card card-pad">
        <div class="section-title">Upcoming (next 7 days)</div>
        ${
          upcoming.length
            ? upcoming
                .map(
                  (e) => `
              <div class="list-row">
                <div class="list-row-main">
                  <div class="list-row-title">${escapeHtml(projectName(e.projectId))}</div>
                  <div class="list-row-sub">${formatDateHuman(e.plannedDate)} · ${escapeHtml(personName(e.personId))}</div>
                </div>
                <span class="chip chip-upcoming">Upcoming</span>
              </div>`
                )
                .join("")
            : `<div class="empty-state">Nothing scheduled in the next week.</div>`
        }
      </div>
    </div>

    <div class="card card-pad" style="margin-top:16px;">
      <div class="section-title">Projects this month</div>
      ${
        projectRows.length
          ? projectRows
              .map(
                ({ p, s }) => `
            <div class="list-row">
              <div class="list-row-main">
                <div class="list-row-title">${escapeHtml(p.name)}</div>
                <div class="list-row-sub">${s.due} due · ${s["on-time"]} on time · ${s.missing} missing</div>
              </div>
              <div style="display:flex; align-items:center; gap:10px;">
                <div class="progress-track" style="width:120px;">
                  <div class="progress-fill" style="width:${Math.round((s.onTimeRate ?? 0) * 100)}%; background:${s.missing > 0 ? "var(--amber-text)" : "var(--green-text)"};"></div>
                </div>
                <span style="font-size:13px; font-weight:600;">${formatPercent(s.onTimeRate)}</span>
              </div>
            </div>`
              )
              .join("")
          : `<div class="empty-state">No active projects yet. Add one from the Projects tab.</div>`
      }
    </div>
  `;
}

/* ================= Calendar ================= */

function getMonthMatrix(year, month) {
  const first = new Date(year, month, 1);
  // Monday-first grid
  const startOffset = (first.getDay() + 6) % 7;
  const gridStart = new Date(year, month, 1 - startOffset);
  const weeks = [];
  let cursor = new Date(gridStart);
  for (let w = 0; w < 6; w++) {
    const days = [];
    for (let d = 0; d < 7; d++) {
      days.push({
        dateStr: toDateStr(cursor),
        inMonth: cursor.getMonth() === month,
        dayNum: cursor.getDate(),
      });
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(days);
    if (cursor.getMonth() !== month && w >= 3) break; // trim trailing empty week when possible
  }
  return weeks;
}

function renderCalendarInto(root) {
  const { year, month, projectFilter } = STATE.calendar;
  const weeks = getMonthMatrix(year, month);
  const today = todayStr();
  const dows = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  const html = `
    <div class="view-header">
      <div>
        <h1>Calendar</h1>
        <p>Planned capture dates. Click any day to log a capture or add one.</p>
      </div>
      <div class="actions">
        <select id="calendar-project-filter">
          <option value="all">All projects</option>
          ${STATE.data.projects.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("")}
        </select>
      </div>
    </div>

    <div class="calendar-toolbar">
      <div class="calendar-nav">
        <button class="btn btn-small" data-action="cal-prev">&larr;</button>
        <div class="calendar-month-label">${monthLabel(year, month)}</div>
        <button class="btn btn-small" data-action="cal-next">&rarr;</button>
      </div>
      <button class="btn btn-small" data-action="cal-today">Today</button>
    </div>

    <div class="calendar-legend">
      <span><i class="legend-on-time"></i>On time</span>
      <span><i class="legend-late"></i>Late</span>
      <span><i class="legend-missing"></i>Missing</span>
      <span><i class="legend-upcoming"></i>Upcoming</span>
    </div>

    <div class="calendar-grid">
      ${dows.map((d) => `<div class="calendar-dow">${d}</div>`).join("")}
      ${weeks
        .map((week) =>
          week
            .map((day) => {
              const dayEntries = filterByProject(
                STATE.data.schedule.filter((e) => e.plannedDate === day.dateStr),
                projectFilter
              );
              const shown = dayEntries.slice(0, 3);
              const extra = dayEntries.length - shown.length;
              return `
              <button type="button" class="calendar-day ${day.inMonth ? "" : "outside"} ${day.dateStr === today ? "today" : ""}" data-action="open-day" data-date="${day.dateStr}">
                <div class="calendar-day-num">${day.dayNum}</div>
                <div style="display:flex; flex-direction:column; gap:3px;">
                  ${shown
                    .map((e) => {
                      const status = captureStatus(e);
                      return `<div class="calendar-day-item chip-${status}">${escapeHtml(projectName(e.projectId))}</div>`;
                    })
                    .join("")}
                  ${extra > 0 ? `<div class="calendar-day-item" style="background:var(--surface-alt); color:var(--text-muted);">+${extra} more</div>` : ""}
                </div>
              </button>`;
            })
            .join("")
        )
        .join("")}
    </div>
  `;
  root.innerHTML = html;
}

function openDayModal(dateStr) {
  const entries = sortedByPlannedDate(
    STATE.data.schedule.filter((e) => e.plannedDate === dateStr)
  );
  const activeProjects = STATE.data.projects.filter((p) => p.active !== false);

  const rows = entries
    .map((e) => {
      const status = captureStatus(e);
      const statusChip = `<span class="chip chip-${status}">${STATUS_LABEL[status]}</span>`;
      let actionHtml = "";
      if (e.capturedDate) {
        actionHtml = `
          <span class="list-row-sub">Captured ${formatDateHuman(e.capturedDate)}</span>
          <button class="btn btn-small" data-action="undo-capture" data-id="${e.id}" data-reopen-date="${dateStr}">Undo</button>`;
      } else {
        actionHtml = `
          <input type="date" value="${dateStr}" style="border:1px solid var(--border); border-radius:8px; padding:6px;">
          <button class="btn btn-small btn-primary" data-action="mark-captured-on" data-id="${e.id}" data-reopen-date="${dateStr}">Mark captured</button>`;
      }
      return `
        <div class="day-detail-item" data-entry-row>
          <div class="list-row-main">
            <div class="list-row-title">${escapeHtml(projectName(e.projectId))}</div>
            <div class="list-row-sub">${escapeHtml(personName(e.personId))} · ${statusChip}</div>
          </div>
          <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
            ${actionHtml}
            <button class="btn btn-small btn-danger" data-action="delete-entry" data-id="${e.id}" data-reopen-date="${dateStr}" title="Remove">&times;</button>
          </div>
        </div>`;
    })
    .join("");

  const html = `
    <div class="modal-title">${formatDateHuman(dateStr)}</div>
    <div class="modal-sub">Planned captures for this day</div>
    <div class="day-detail-list">
      ${rows || `<div class="empty-state">No captures planned for this day yet.</div>`}
    </div>
    <div class="form-row">
      <label>Add a planned capture</label>
      <div style="display:flex; gap:8px; flex-wrap:wrap;">
        <select id="add-entry-project" style="flex:1; min-width:160px; border:1px solid var(--border); border-radius:8px; padding:8px;">
          <option value="">Choose project…</option>
          ${activeProjects.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("")}
        </select>
        <select id="add-entry-person" style="flex:1; min-width:140px; border:1px solid var(--border); border-radius:8px; padding:8px;">
          <option value="">Unassigned</option>
          ${STATE.data.people.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("")}
        </select>
        <button class="btn btn-primary" data-action="add-entry-for-day" data-date="${dateStr}">Add</button>
      </div>
    </div>
    <div class="form-actions">
      <button type="button" class="btn" data-action="close-modal">Close</button>
    </div>
  `;
  openModal(html);
}

/* ================= Projects ================= */

function renderProjects() {
  const rows = STATE.data.projects
    .map((p) => {
      const s = summarize(filterByProject(STATE.data.schedule, p.id));
      return `
        <tr>
          <td>
            <div style="font-weight:600;">${escapeHtml(p.name)}</div>
            <div class="list-row-sub">${frequencyLabel(p.frequency)}${p.frequency !== "manual" ? " · anchor " + formatDateHuman(p.anchorDate) : ""}</div>
          </td>
          <td>${escapeHtml(personName(p.defaultAssigneeId))}</td>
          <td>
            <label class="checkbox-row" style="justify-content:flex-start;">
              <input type="checkbox" data-toggle-active="${p.id}" ${p.active !== false ? "checked" : ""}>
              <span>${p.active !== false ? "Active" : "Paused"}</span>
            </label>
          </td>
          <td class="num">${s.due}</td>
          <td class="num">${formatPercent(s.onTimeRate)}</td>
          <td class="num">${s.missing}</td>
          <td>
            <div class="actions">
              ${p.frequency !== "manual" ? `<button class="btn btn-small" data-action="regen-schedule" data-id="${p.id}">Refresh schedule</button>` : ""}
              <button class="btn btn-small" data-action="edit-project" data-id="${p.id}">Edit</button>
              <button class="btn btn-small btn-danger" data-action="delete-project" data-id="${p.id}">Delete</button>
            </div>
          </td>
        </tr>`;
    })
    .join("");

  return `
    <div class="view-header">
      <div>
        <h1>Projects</h1>
        <p>${STATE.data.projects.length} project${STATE.data.projects.length === 1 ? "" : "s"} tracked</p>
      </div>
      <div class="actions">
        <button class="btn btn-primary" data-action="add-project">+ Add project</button>
      </div>
    </div>
    <div class="card">
      <table>
        <thead>
          <tr>
            <th>Project</th>
            <th>Default owner</th>
            <th>Status</th>
            <th class="num">Due</th>
            <th class="num">On-time</th>
            <th class="num">Missing</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${rows || `<tr><td colspan="7"><div class="empty-state">No projects yet — add your first one.</div></td></tr>`}
        </tbody>
      </table>
    </div>
  `;
}

function openProjectModal(project) {
  const isEdit = !!project;
  const people = STATE.data.people;
  const html = `
    <div class="modal-title">${isEdit ? "Edit project" : "Add project"}</div>
    <div class="modal-sub">Set up who owns capture for this project and how often it's expected.</div>
    <form id="project-form">
      <div class="form-row">
        <label for="pf-name">Project name</label>
        <input type="text" id="pf-name" required value="${escapeHtml(project?.name || "")}">
      </div>
      <div class="form-row">
        <label for="pf-assignee">Default capture owner</label>
        <select id="pf-assignee">
          <option value="">— Unassigned —</option>
          ${people.map((p) => `<option value="${p.id}" ${project?.defaultAssigneeId === p.id ? "selected" : ""}>${escapeHtml(p.name)}</option>`).join("")}
        </select>
      </div>
      <div class="form-row">
        <label for="pf-frequency">Capture frequency</label>
        <select id="pf-frequency">
          <option value="weekly" ${project?.frequency === "weekly" ? "selected" : ""}>Weekly</option>
          <option value="biweekly" ${project?.frequency === "biweekly" ? "selected" : ""}>Every 2 weeks</option>
          <option value="monthly" ${project?.frequency === "monthly" ? "selected" : ""}>Monthly</option>
          <option value="manual" ${project?.frequency === "manual" || !project ? "selected" : ""}>Manual — I'll add dates myself</option>
        </select>
        <span class="hint">Weekly/biweekly/monthly auto-generates the next ${SCHEDULE_HORIZON_MONTHS} months of planned dates.</span>
      </div>
      <div class="form-row">
        <label for="pf-anchor">First planned capture date</label>
        <input type="date" id="pf-anchor" value="${project?.anchorDate || todayStr()}">
      </div>
      <div class="form-row checkbox-row">
        <input type="checkbox" id="pf-active" ${project?.active !== false ? "checked" : ""}>
        <label for="pf-active">Active</label>
      </div>
      <div class="form-actions">
        <button type="button" class="btn" data-action="close-modal">Cancel</button>
        <button type="submit" class="btn btn-primary">${isEdit ? "Save changes" : "Add project"}</button>
      </div>
    </form>
  `;
  openModal(html);
  document.getElementById("project-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fields = {
      name: document.getElementById("pf-name").value.trim(),
      defaultAssigneeId: document.getElementById("pf-assignee").value || null,
      frequency: document.getElementById("pf-frequency").value,
      anchorDate: document.getElementById("pf-anchor").value,
      active: document.getElementById("pf-active").checked,
    };
    if (!fields.name) return;
    try {
      let full;
      if (isEdit) {
        await Store.updateProject(project.id, fields);
        full = { ...project, ...fields };
      } else {
        full = await Store.addProject(fields);
      }
      await regenerateSchedule(full);
      closeModal();
      await afterMutate();
      showToast(isEdit ? "Project updated" : "Project added");
    } catch (err) {
      showToast(err.message || "Something went wrong", true);
    }
  });
}

/* ================= People ================= */

function renderPeople() {
  const cards = STATE.data.people
    .map((person) => {
      const s = summarize(STATE.data.schedule.filter((e) => e.personId === person.id));
      const rate = s.onTimeRate ?? 0;
      return `
        <div class="card person-card">
          <div class="person-header">
            <div style="display:flex; align-items:center; gap:10px;">
              <div class="avatar">${initials(person.name)}</div>
              <div>
                <div style="font-weight:600;">${escapeHtml(person.name)}</div>
                ${person.email ? `<div class="list-row-sub">${escapeHtml(person.email)}</div>` : ""}
              </div>
            </div>
            <div class="actions">
              <button class="btn btn-small" data-action="edit-person" data-id="${person.id}">Edit</button>
              <button class="btn btn-small btn-danger" data-action="delete-person" data-id="${person.id}">Delete</button>
            </div>
          </div>
          ${
            s.due
              ? `
              <div class="progress-track"><div class="progress-fill" style="width:${Math.round(rate * 100)}%; background:${s.missing > 0 ? "var(--amber-text)" : "var(--green-text)"};"></div></div>
              <div class="metric-row"><span>On time: <strong style="color:var(--text);">${formatPercent(s.onTimeRate)}</strong></span><span>Missing: <strong style="color:var(--text);">${formatPercent(s.missingRate)}</strong></span></div>
              <div class="metric-row"><span>${s["on-time"]} on time</span><span>${s.late} late</span><span>${s.missing} missing</span></div>`
              : `<div class="empty-state" style="padding:10px 0;">No captures logged yet</div>`
          }
        </div>`;
    })
    .join("");

  return `
    <div class="view-header">
      <div>
        <h1>People</h1>
        <p>Capture owners and their track record</p>
      </div>
      <div class="actions">
        <button class="btn btn-primary" data-action="add-person">+ Add person</button>
      </div>
    </div>
    <div class="card-grid">
      ${cards || `<div class="card card-pad empty-state">No people added yet.</div>`}
    </div>
  `;
}

function openPersonModal(person) {
  const isEdit = !!person;
  const html = `
    <div class="modal-title">${isEdit ? "Edit person" : "Add person"}</div>
    <form id="person-form">
      <div class="form-row">
        <label for="pe-name">Name</label>
        <input type="text" id="pe-name" required value="${escapeHtml(person?.name || "")}">
      </div>
      <div class="form-row">
        <label for="pe-email">Email <span class="hint">(optional)</span></label>
        <input type="email" id="pe-email" value="${escapeHtml(person?.email || "")}">
      </div>
      <div class="form-actions">
        <button type="button" class="btn" data-action="close-modal">Cancel</button>
        <button type="submit" class="btn btn-primary">${isEdit ? "Save changes" : "Add person"}</button>
      </div>
    </form>
  `;
  openModal(html);
  document.getElementById("person-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fields = {
      name: document.getElementById("pe-name").value.trim(),
      email: document.getElementById("pe-email").value.trim(),
      active: true,
    };
    if (!fields.name) return;
    try {
      if (isEdit) await Store.updatePerson(person.id, fields);
      else await Store.addPerson(fields);
      closeModal();
      await afterMutate();
      showToast(isEdit ? "Person updated" : "Person added");
    } catch (err) {
      showToast(err.message || "Something went wrong", true);
    }
  });
}

/* ================= Reports ================= */

function renderReports() {
  const { year, month, projectFilter } = STATE.reports;
  const monthEntries = filterByProject(entriesInMonth(STATE.data.schedule, year, month), projectFilter);
  const overall = summarize(monthEntries);

  const projects = projectFilter === "all" ? STATE.data.projects : STATE.data.projects.filter((p) => p.id === projectFilter);
  const projectRows = projects
    .map((p) => {
      const s = summarize(filterByProject(monthEntries, p.id));
      return `
        <tr>
          <td>${escapeHtml(p.name)}</td>
          <td class="num">${s.due + s.upcoming}</td>
          <td class="num">${s["on-time"]}</td>
          <td class="num">${s.late}</td>
          <td class="num">${s.missing}</td>
          <td class="num"><strong>${formatPercent(s.onTimeRate)}</strong></td>
        </tr>`;
    })
    .join("");

  const personRows = STATE.data.people
    .map((person) => {
      const s = summarize(monthEntries.filter((e) => e.personId === person.id));
      if (s.total === 0) return "";
      return `
        <tr>
          <td>${escapeHtml(person.name)}</td>
          <td class="num">${s.due}</td>
          <td class="num">${s["on-time"]}</td>
          <td class="num">${s.late}</td>
          <td class="num">${s.missing}</td>
          <td class="num"><strong>${formatPercent(s.onTimeRate)}</strong></td>
        </tr>`;
    })
    .join("");

  return `
    <div class="view-header">
      <div>
        <h1>Monthly report</h1>
        <p>Model capture integrity summary</p>
      </div>
      <div class="actions">
        <select id="report-project-filter">
          <option value="all">All projects</option>
          ${STATE.data.projects.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("")}
        </select>
        <button class="btn" data-action="print-report">Print / Save as PDF</button>
      </div>
    </div>

    <div class="calendar-toolbar">
      <div class="calendar-nav">
        <button class="btn btn-small" data-action="report-prev">&larr;</button>
        <div class="calendar-month-label">${monthLabel(year, month)}</div>
        <button class="btn btn-small" data-action="report-next">&rarr;</button>
      </div>
    </div>

    <div class="card card-pad" style="margin-bottom:16px;">
      <div class="report-summary">
        <div class="report-score">${formatPercent(overall.onTimeRate)}</div>
        <div class="list-row-sub">overall on-time capture rate</div>
      </div>
      <div class="list-row-sub">
        ${monthEntries.length} planned · ${overall["on-time"]} on time · ${overall.late} late ·
        ${overall.missing} missing · ${overall.upcoming} not yet due ·
        missing rate ${formatPercent(overall.missingRate)}
      </div>
    </div>

    <div class="card" style="margin-bottom:16px;">
      <div class="card-pad" style="padding-bottom:0;">
        <div class="section-title">By project</div>
      </div>
      <table>
        <thead><tr><th>Project</th><th class="num">Planned</th><th class="num">On time</th><th class="num">Late</th><th class="num">Missing</th><th class="num">Integrity</th></tr></thead>
        <tbody>${projectRows || `<tr><td colspan="6"><div class="empty-state">No planned captures this month.</div></td></tr>`}</tbody>
      </table>
    </div>

    <div class="card">
      <div class="card-pad" style="padding-bottom:0;">
        <div class="section-title">By person</div>
      </div>
      <table>
        <thead><tr><th>Person</th><th class="num">Due</th><th class="num">On time</th><th class="num">Late</th><th class="num">Missing</th><th class="num">On-time rate</th></tr></thead>
        <tbody>${personRows || `<tr><td colspan="6"><div class="empty-state">No activity logged this month.</div></td></tr>`}</tbody>
      </table>
    </div>
  `;
}

/* ================= boot ================= */

document.addEventListener("DOMContentLoaded", init);
