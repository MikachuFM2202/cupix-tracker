/**
 * ============================================================
 *  Cupix Capture Tracker — application logic
 * ============================================================
 * Talks only to `Store` (see data.js). Three views render into
 * #view-root: "picker" (choose a project), "project" (that
 * project's calendar + stats — or, for admins, every project
 * combined), and "manage" (admin-only project/people setup).
 * A single modal (#modal-root) handles forms and the calendar
 * day-detail panel.
 * ============================================================
 */

const STATE = {
  view: "picker", // "picker" | "project" | "manage" | "person"
  selectedProjectId: null, // a real project id, or "all" (admin combined view)
  selectedPersonId: null, // set while STATE.view === "person"
  personProfileFrom: null, // { view, selectedProjectId } to return to when leaving a person's profile
  lastSingleProjectId: null, // remembered so the "This project" toggle has somewhere to go back to
  admin: false,
  unlockedProjects: new Set(), // project ids this browser has already entered the passcode for
  showHolidays: true, // whether the calendar shades Singapore public holidays
  busy: false, // true while a data-action click's Store request is in flight — blocks re-entrant clicks
  data: { projects: [], people: [], schedule: [] },
  calendar: (() => {
    const t = new Date();
    return { year: t.getFullYear(), month: t.getMonth() };
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

function activeProjects() {
  return STATE.data.projects.filter((p) => p.active !== false);
}

/**
 * Each project's entry passcode is its name plus "2026" (e.g. the
 * project "CR211" is entered with "CR2112026") — a light UX gate,
 * not real security, same spirit as ADMIN_PASSCODE. Admins skip it
 * entirely since Admin mode already implies full access.
 */
function projectPasscode(project) {
  return `${project.name}2026`;
}

function isProjectUnlocked(id) {
  return STATE.admin || STATE.unlockedProjects.has(id);
}

function loadUnlockedProjects() {
  try {
    const raw = localStorage.getItem("cupix_unlocked_projects");
    if (raw) return new Set(JSON.parse(raw));
  } catch (err) {
    /* ignore */
  }
  return new Set();
}

function saveUnlockedProjects() {
  try {
    localStorage.setItem("cupix_unlocked_projects", JSON.stringify([...STATE.unlockedProjects]));
  } catch (err) {
    /* ignore */
  }
}

function loadShowHolidays() {
  try {
    const raw = localStorage.getItem("cupix_show_holidays");
    if (raw !== null) return raw === "1";
  } catch (err) {
    /* ignore */
  }
  return true; // on by default — that's the point of the toggle
}

function saveShowHolidays() {
  try {
    localStorage.setItem("cupix_show_holidays", STATE.showHolidays ? "1" : "0");
  } catch (err) {
    /* ignore */
  }
}

/**
 * A <select> of active people (the admin-managed PIC list), used
 * wherever someone checks in a capture — they confirm who they are
 * from this list rather than typing a name.
 */
/**
 * <option> list of active people, each labeled with their track
 * record (on-time rate + capture count) so whoever is picking a
 * name can see that person's frequency and punctuality right there.
 */
/**
 * Person options for a check-in / assignment <select>. When projectId
 * is a real project (not "all"/omitted), the list — and each
 * person's shown track record — is scoped to just that project's
 * team and that project's captures, so one project's staff never
 * shows up while checking in on another.
 */
function personStatsOptionsHtml(selectedId, projectId) {
  const isScoped = projectId && projectId !== "all";
  const pool = STATE.data.people.filter((p) => {
    if (p.active === false) return false;
    if (!isScoped) return true;
    return parsePersonProjectIds(p.projectIds).includes(projectId);
  });
  // Always keep the currently-selected person visible even if they've
  // since been removed from this project's team or deactivated —
  // otherwise the select silently shows "Who captured this?" instead
  // of the person actually on record for this entry.
  if (selectedId && !pool.some((p) => p.id === selectedId)) {
    const selectedPerson = byId(STATE.data.people, selectedId);
    if (selectedPerson) pool.push(selectedPerson);
  }
  return pool
    .map((p) => {
      const relevantEntries = isScoped
        ? STATE.data.schedule.filter((e) => e.personId === p.id && e.projectId === projectId)
        : STATE.data.schedule.filter((e) => e.personId === p.id);
      const s = summarize(relevantEntries);
      const stats = s.due ? ` — ${formatPercent(s.onTimeRate)} on-time (${s.due} captures)` : " — no captures yet";
      return `<option value="${p.id}" ${p.id === selectedId ? "selected" : ""}>${escapeHtml(p.name + stats)}</option>`;
    })
    .join("");
}

function picSelectHtml(entryId, selectedId, projectId) {
  return `
    <select data-pic-for="${entryId}" style="min-width:220px; border:1px solid var(--border); border-radius:8px; padding:6px;">
      <option value="">Who captured this?</option>
      ${personStatsOptionsHtml(selectedId, projectId)}
    </select>`;
}

function initials(name) {
  return (name || "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
}

const AVATAR_PALETTE = ["avatar-1", "avatar-2", "avatar-3", "avatar-4", "avatar-5", "avatar-6"];

/** Deterministic avatar color per person, so the same person always
 * gets the same color and different people are visually distinct. */
function avatarColorClass(id) {
  let hash = 0;
  for (let i = 0; i < (id || "").length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}

function formatDateHuman(dateStr) {
  if (!dateStr) return "—";
  return parseDateStr(dateStr).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatPercent(x) {
  return x === null || x === undefined ? "—" : `${Math.round(x * 100)}%`;
}

function frequencyLabel(f) {
  return { weekly: "Weekly", biweekly: "Every 2 weeks", monthly: "Monthly", manual: "Manual" }[f] || f;
}

function frequencyDetailLabel(project) {
  const days = captureDaysLabel(project.captureDays);
  return days ? `${frequencyLabel(project.frequency)} (${days})` : frequencyLabel(project.frequency);
}

function entriesInMonth(entries, year, month) {
  const prefix = `${year}-${String(month + 1).padStart(2, "0")}`;
  return entries.filter((e) => e.plannedDate.startsWith(prefix));
}

function entriesInYear(entries, year) {
  const prefix = `${year}-`;
  return entries.filter((e) => e.plannedDate.startsWith(prefix));
}

/**
 * Turns an on-time rate into a plain-language capture health label,
 * used for both the monthly and yearly health readouts. Same
 * thresholds either way — "health" means the same thing regardless
 * of the time window.
 */
function healthLabel(rate) {
  if (rate === null || rate === undefined) return { text: "No data yet", cls: "health-none" };
  // Threshold against the same rounded percentage shown on screen, not
  // the raw fraction — otherwise a rate like 89.74% displays as "90%"
  // (rounds up) while still getting labeled "Good" instead of
  // "Excellent", which reads as a contradiction right next to the number.
  const pct = Math.round(rate * 100);
  if (pct >= 90) return { text: "Excellent", cls: "health-excellent" };
  if (pct >= 75) return { text: "Good", cls: "health-good" };
  if (pct >= 50) return { text: "Needs attention", cls: "health-warning" };
  return { text: "Critical", cls: "health-critical" };
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

/**
 * When an existing project's frequency/capture-days/anchor date changes,
 * removes not-yet-captured planned entries that the OLD pattern implied
 * but the NEW one no longer does — so switching e.g. weekly (Mon, Thu)
 * down to just Mon doesn't leave the old Thursdays sitting around to
 * eventually show up as "Missing". Already-captured entries are never
 * touched, and dates that were never part of the old auto-generated
 * pattern (added by hand) are left alone either way.
 */
async function pruneStaleSchedule(oldProject, newProject) {
  const horizon = addMonthsKeepDay(todayStr(), SCHEDULE_HORIZON_MONTHS);
  const oldWanted = new Set(generatePlannedDates(oldProject, horizon));
  const newWanted = new Set(generatePlannedDates(newProject, horizon));
  const fresh = await Store.getData();
  const stale = fresh.schedule.filter(
    (e) => e.projectId === newProject.id && !e.capturedDate && oldWanted.has(e.plannedDate) && !newWanted.has(e.plannedDate)
  );
  for (const e of stale) {
    await Store.deleteScheduleEntry(e.id);
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

/* ================= admin mode ================= */

function openAdminLoginModal() {
  const html = `
    <div class="modal-title">Admin access</div>
    <div class="modal-sub">Enter the admin passcode to manage projects, people, and view every project's calendar combined.</div>
    <form id="admin-login-form">
      <div class="form-row">
        <label for="admin-passcode">Passcode</label>
        <input type="password" id="admin-passcode" autocomplete="off">
      </div>
      <div class="form-actions">
        <button type="button" class="btn" data-action="close-modal">Cancel</button>
        <button type="submit" class="btn btn-primary">Unlock</button>
      </div>
    </form>
  `;
  openModal(html);
  const input = document.getElementById("admin-passcode");
  input.focus();
  document.getElementById("admin-login-form").addEventListener("submit", (e) => {
    e.preventDefault();
    if (input.value === ADMIN_PASSCODE) {
      STATE.admin = true;
      try {
        localStorage.setItem("cupix_admin", "1");
      } catch (err) {
        /* private browsing — admin mode just won't persist across reloads */
      }
      closeModal();
      render();
      showToast("Admin mode unlocked");
    } else {
      showToast("Wrong passcode", true);
    }
  });
}

function enterProject(id) {
  STATE.selectedProjectId = id;
  STATE.lastSingleProjectId = id;
  STATE.view = "project";
  const t = new Date();
  STATE.calendar.year = t.getFullYear();
  STATE.calendar.month = t.getMonth();
  render();
}

function openProjectPasscodeModal(projectId) {
  const project = byId(STATE.data.projects, projectId);
  if (!project) return;
  const html = `
    <div class="modal-title">${escapeHtml(project.name)}</div>
    <div class="modal-sub">Enter this project's passcode to continue.</div>
    <form id="project-passcode-form">
      <div class="form-row">
        <label for="project-passcode">Passcode</label>
        <input type="password" id="project-passcode" autocomplete="off">
      </div>
      <div class="form-actions">
        <button type="button" class="btn" data-action="close-modal">Cancel</button>
        <button type="submit" class="btn btn-primary">Enter</button>
      </div>
    </form>
  `;
  openModal(html);
  const input = document.getElementById("project-passcode");
  input.focus();
  document.getElementById("project-passcode-form").addEventListener("submit", (e) => {
    e.preventDefault();
    if (input.value === projectPasscode(project)) {
      STATE.unlockedProjects.add(project.id);
      saveUnlockedProjects();
      closeModal();
      enterProject(project.id);
    } else {
      showToast("Wrong passcode", true);
    }
  });
}

function exitAdmin() {
  STATE.admin = false;
  try {
    localStorage.removeItem("cupix_admin");
  } catch (err) {
    /* ignore */
  }
  if (STATE.view === "manage" || STATE.selectedProjectId === "all") {
    STATE.view = "picker";
    STATE.selectedProjectId = null;
  }
  render();
  showToast("Exited admin mode");
}

/* ================= init ================= */

function init() {
  try {
    STATE.admin = localStorage.getItem("cupix_admin") === "1";
  } catch (err) {
    /* ignore */
  }
  STATE.unlockedProjects = loadUnlockedProjects();
  STATE.showHolidays = loadShowHolidays();

  const banner = document.getElementById("mode-banner");
  banner.hidden = false;
  if (Store.mode === "remote") {
    banner.classList.add("remote");
    banner.textContent = "Connected to Google Sheets — everyone who opens this site shares the same data.";
  } else {
    banner.textContent =
      "Demo mode — data is saved only in this browser. Connect Google Sheets (see README.md) so your team shares one tracker.";
  }

  document.addEventListener("click", handleGlobalClick);

  refreshDataOnly().then(render);
}

/* ================= global click delegation ================= */

/**
 * Every data-action click funnels through here first. Most actions
 * that talk to Store go over the network to Google Apps Script,
 * which can take a few seconds — with no guard, a click that seems
 * to do nothing invites a repeat click (or three), silently creating
 * duplicate entries. STATE.busy ignores clicks while one is already
 * in flight, and disabling the clicked button gives immediate visual
 * feedback instead of the page looking unresponsive.
 */
async function handleGlobalClick(e) {
  const el = e.target.closest("[data-action]");
  if (!el) return;
  if (STATE.busy) return;
  STATE.busy = true;
  const wasButton = el.tagName === "BUTTON";
  if (wasButton) el.disabled = true;
  try {
    await dispatchAction(el, el.dataset.action);
  } finally {
    STATE.busy = false;
    if (wasButton && el.isConnected) el.disabled = false; // no-op once render() has already swapped it out
  }
}

async function dispatchAction(el, action) {
  if (action === "close-modal") {
    closeModal();
    return;
  }

  if (action === "open-admin-login") {
    openAdminLoginModal();
    return;
  }
  if (action === "exit-admin") {
    exitAdmin();
    return;
  }
  if (action === "open-manage") {
    if (!STATE.admin) return;
    STATE.view = "manage";
    render();
    return;
  }
  if (action === "back-to-picker") {
    STATE.view = "picker";
    STATE.selectedProjectId = null;
    render();
    return;
  }
  if (action === "select-project") {
    const id = el.dataset.id;
    if (isProjectUnlocked(id)) enterProject(id);
    else openProjectPasscodeModal(id);
    return;
  }
  if (action === "select-all-projects" || action === "scope-all") {
    if (!STATE.admin) return;
    STATE.selectedProjectId = "all";
    STATE.view = "project";
    if (action === "select-all-projects") {
      const t = new Date();
      STATE.calendar.year = t.getFullYear();
      STATE.calendar.month = t.getMonth();
    }
    render();
    return;
  }
  if (action === "scope-project") {
    if (!STATE.admin) return;
    if (STATE.lastSingleProjectId) {
      STATE.selectedProjectId = STATE.lastSingleProjectId;
      render();
    } else {
      STATE.view = "picker";
      STATE.selectedProjectId = null;
      render();
    }
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

  if (action === "open-day") {
    openDayModal(el.dataset.date);
    return;
  }

  if (action === "toggle-holidays") {
    STATE.showHolidays = !STATE.showHolidays;
    saveShowHolidays();
    render();
    return;
  }

  if (action === "add-project") {
    if (!STATE.admin) return;
    openProjectModal(null);
    return;
  }
  if (action === "edit-project") {
    if (!STATE.admin) return;
    openProjectModal(byId(STATE.data.projects, el.dataset.id));
    return;
  }
  if (action === "delete-project") {
    if (!STATE.admin) return;
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
    if (!STATE.admin) return;
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
    if (!STATE.admin) return;
    openPersonModal(null);
    return;
  }
  if (action === "edit-person") {
    if (!STATE.admin) return;
    openPersonModal(byId(STATE.data.people, el.dataset.id));
    return;
  }
  if (action === "delete-person") {
    if (!STATE.admin) return;
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
    const row = el.closest("[data-entry-row]");
    const picSelect = row.querySelector(`[data-pic-for="${el.dataset.id}"]`);
    if (!picSelect.value) {
      showToast("Choose who captured this first", true);
      return;
    }
    try {
      await Store.updateScheduleEntry(el.dataset.id, {
        capturedDate: todayStr(),
        personId: picSelect.value,
      });
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
    const picSelect = row.querySelector(`[data-pic-for="${el.dataset.id}"]`);
    if (!picSelect.value) {
      showToast("Choose who captured this first", true);
      return;
    }
    try {
      await Store.updateScheduleEntry(el.dataset.id, {
        capturedDate: dateInput.value || todayStr(),
        personId: picSelect.value,
      });
      await refreshDataOnly();
      render();
      openDayModal(el.dataset.reopenDate);
      showToast("Marked as captured");
    } catch (err) {
      showToast(err.message || "Could not update", true);
    }
    return;
  }

  if (action === "save-capture-edit") {
    if (!STATE.admin) return;
    const row = el.closest("[data-entry-row]");
    const dateInput = row.querySelector(`[data-captured-date-for="${el.dataset.id}"]`);
    const picSelect = row.querySelector(`[data-pic-for="${el.dataset.id}"]`);
    if (!picSelect.value) {
      showToast("Choose who captured this first", true);
      return;
    }
    if (!dateInput.value) {
      showToast("Choose a capture date", true);
      return;
    }
    try {
      await Store.updateScheduleEntry(el.dataset.id, {
        capturedDate: dateInput.value,
        personId: picSelect.value,
      });
      await refreshDataOnly();
      render();
      openDayModal(el.dataset.reopenDate);
      showToast("Capture updated");
    } catch (err) {
      showToast(err.message || "Could not update", true);
    }
    return;
  }

  if (action === "undo-capture") {
    if (!confirm("Clear this capture? Whoever logged it will lose credit for it.")) return;
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
    if (!STATE.admin) return;
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

  if (action === "view-person") {
    const id = el.dataset.id;
    if (!byId(STATE.data.people, id)) return;
    STATE.personProfileFrom = { view: STATE.view, selectedProjectId: STATE.selectedProjectId };
    STATE.selectedPersonId = id;
    STATE.view = "person";
    render();
    return;
  }
  if (action === "back-from-person") {
    const from = STATE.personProfileFrom;
    STATE.selectedPersonId = null;
    STATE.personProfileFrom = null;
    STATE.view = from ? from.view : "picker";
    STATE.selectedProjectId = from ? from.selectedProjectId : null;
    render();
    return;
  }
  if (action === "edit-entry-dates") {
    if (!STATE.admin) return;
    const entry = STATE.data.schedule.find((e) => e.id === el.dataset.id);
    if (entry) openEntryDateEditModal(entry);
    return;
  }

  if (action === "add-entry-for-day") {
    if (!STATE.admin) return;
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
  if (STATE.view === "project" && !STATE.selectedProjectId) STATE.view = "picker";
  if (STATE.view === "manage" && !STATE.admin) STATE.view = "picker";
  if (STATE.view === "person" && !byId(STATE.data.people, STATE.selectedPersonId)) {
    STATE.view = "picker";
    STATE.selectedPersonId = null;
    STATE.personProfileFrom = null;
  }

  const root = document.getElementById("view-root");
  if (STATE.view === "picker") root.innerHTML = renderPicker();
  else if (STATE.view === "project") root.innerHTML = renderProjectView();
  else if (STATE.view === "manage") root.innerHTML = renderManage();
  else if (STATE.view === "person") root.innerHTML = renderPersonProfile();

  renderTopbarActions();
  wireViewInputs();
}

function renderTopbarActions() {
  const root = document.getElementById("topbar-actions");
  if (!root) return;
  const parts = [];
  if (STATE.view === "person") {
    parts.push(`<button class="btn btn-small" data-action="back-from-person">&larr; Back</button>`);
  } else if (STATE.view !== "picker") {
    parts.push(`<button class="btn btn-small" data-action="back-to-picker">&larr; Choose project</button>`);
  }
  if (STATE.admin) {
    parts.push(`<button class="btn btn-small" data-action="open-manage">Manage</button>`);
    parts.push(`<button class="btn btn-small" data-action="exit-admin">Exit admin</button>`);
  } else {
    parts.push(`<button class="btn btn-small" data-action="open-admin-login">Admin</button>`);
  }
  root.innerHTML = parts.join("");
}

function wireViewInputs() {
  document.querySelectorAll("[data-toggle-active]").forEach((cb) => {
    cb.addEventListener("change", async () => {
      if (!STATE.admin) return;
      try {
        await Store.updateProject(cb.dataset.toggleActive, { active: cb.checked });
        await afterMutate();
      } catch (err) {
        showToast(err.message || "Could not update", true);
      }
    });
  });
}

/* ================= Picker (landing) ================= */

function renderPicker() {
  const cards = activeProjects()
    .map((p) => {
      const s = summarize(filterByProject(STATE.data.schedule, p.id));
      const locked = !isProjectUnlocked(p.id);
      const statusAccent = s.missing > 0 ? "accent-red" : "accent-green";
      return `
        <button type="button" class="project-card ${statusAccent}" data-action="select-project" data-id="${p.id}">
          <div class="project-card-name">${escapeHtml(p.name)}${locked ? ` <span class="lock-badge">Passcode required</span>` : ""}</div>
          <div class="project-card-meta">${frequencyDetailLabel(p)} · ${escapeHtml(personName(p.defaultAssigneeId))}</div>
          <div class="project-card-stats">
            <span class="chip chip-${s.missing > 0 ? "missing" : "on-time"}">${s.missing > 0 ? s.missing + " missing" : "up to date"}</span>
            <span class="project-card-rate">${formatPercent(s.onTimeRate)} on-time</span>
          </div>
        </button>`;
    })
    .join("");

  const allCard = STATE.admin
    ? `
      <button type="button" class="project-card project-card-all" data-action="select-all-projects">
        <div class="project-card-name">All projects</div>
        <div class="project-card-meta">Combined calendar across every active project</div>
      </button>`
    : "";

  return `
    <div class="view-header">
      <div>
        <h1>Choose a project</h1>
        <p>Pick a project to see its capture calendar and log an upload.</p>
      </div>
    </div>
    <div class="project-picker-grid">
      ${allCard}
      ${cards || `<div class="card card-pad empty-state">No active projects yet.${STATE.admin ? " Add one from Manage." : ""}</div>`}
    </div>
  `;
}

/* ================= Project view (calendar + stats, scoped) ================= */

function renderProjectView() {
  const scopeId = STATE.selectedProjectId;
  const isAll = scopeId === "all";
  const project = isAll ? null : byId(STATE.data.projects, scopeId);

  if (!isAll && !project) {
    STATE.view = "picker";
    STATE.selectedProjectId = null;
    return renderPicker();
  }

  const { year, month } = STATE.calendar;
  const scoped = filterByProject(STATE.data.schedule, scopeId);
  const monthEntries = entriesInMonth(scoped, year, month);
  const summary = summarize(monthEntries);
  const yearEntries = entriesInYear(scoped, year);
  const yearSummary = summarize(yearEntries);
  const monthHealth = healthLabel(summary.onTimeRate);
  const yearHealth = healthLabel(yearSummary.onTimeRate);
  const today = todayStr();

  const allMissing = sortedByPlannedDate(scoped.filter((e) => captureStatus(e) === "missing"));
  const missing = allMissing.slice(0, 10);
  const missingHiddenCount = allMissing.length - missing.length;
  const upcoming = sortedByPlannedDate(
    scoped.filter((e) => captureStatus(e) === "upcoming" && e.plannedDate <= addDays(today, 7))
  ).slice(0, 10);

  const scopeToggle = STATE.admin
    ? `
      <div class="scope-toggle">
        <button type="button" class="scope-toggle-btn ${!isAll ? "active" : ""}" data-action="scope-project">This project</button>
        <button type="button" class="scope-toggle-btn ${isAll ? "active" : ""}" data-action="scope-all">All projects</button>
      </div>`
    : "";

  const personRows = STATE.data.people
    .map((person) => {
      const s = summarize(scoped.filter((e) => e.personId === person.id));
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

  const team = isAll
    ? []
    : STATE.data.people.filter((p) => p.active !== false && parsePersonProjectIds(p.projectIds).includes(project.id));
  const teamStrip = !isAll
    ? `
    <div class="team-strip">
      <span class="team-strip-label">Team</span>
      ${
        team.length
          ? team
              .map(
                (p) => `
              <button type="button" class="team-chip" data-action="view-person" data-id="${p.id}">
                <span class="avatar avatar-small ${avatarColorClass(p.id)}">${initials(p.name)}</span>
                ${escapeHtml(p.name)}
              </button>`
              )
              .join("")
          : `<span class="team-strip-empty">No one assigned yet — add people to this project from Manage.</span>`
      }
    </div>`
    : "";

  return `
    <div class="view-header">
      <div>
        <h1>${isAll ? "All projects" : escapeHtml(project.name)}</h1>
        <p>${isAll ? "Combined view across every active project" : `${frequencyDetailLabel(project)} · ${escapeHtml(personName(project.defaultAssigneeId))}`}</p>
      </div>
      ${scopeToggle}
    </div>

    ${teamStrip}

    <div class="card-grid">
      <div class="card health-card ${monthHealth.cls}">
        <div class="health-card-label">Capture health — ${monthLabel(year, month)}</div>
        <div class="health-card-value">${formatPercent(summary.onTimeRate)}</div>
        <span class="health-badge">${monthHealth.text}</span>
        <div class="health-card-sub">${summary.due} due this month${summary.due ? ` · ${summary["on-time"]} on time, ${summary.missing} missing` : ""}</div>
      </div>
      <div class="card health-card ${yearHealth.cls}">
        <div class="health-card-label">Capture health — ${year}</div>
        <div class="health-card-value">${formatPercent(yearSummary.onTimeRate)}</div>
        <span class="health-badge">${yearHealth.text}</span>
        <div class="health-card-sub">${yearSummary.due} due in ${year}${yearSummary.due ? ` · ${yearSummary["on-time"]} on time, ${yearSummary.missing} missing` : ""}</div>
      </div>
    </div>

    <div class="card-grid">
      <div class="card stat-card accent-blue">
        <div class="stat-label">Planned this month</div>
        <div class="stat-value">${monthEntries.length}</div>
        <div class="stat-sub">${summary.upcoming} still upcoming</div>
      </div>
      <div class="card stat-card accent-green">
        <div class="stat-label">Captured on time</div>
        <div class="stat-value">${summary["on-time"]}</div>
        <div class="stat-sub">${summary.late} captured late</div>
      </div>
      <div class="card stat-card accent-red">
        <div class="stat-label">Missing</div>
        <div class="stat-value">${summary.missing}</div>
        <div class="stat-sub">out of ${summary.due} due so far</div>
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
              <div class="list-row" data-entry-row>
                <div class="list-row-main">
                  <div class="list-row-title">${isAll ? escapeHtml(projectName(e.projectId)) : formatDateHuman(e.plannedDate)}</div>
                  <div class="list-row-sub">${isAll ? `Planned ${formatDateHuman(e.plannedDate)} · ` : ""}${daysOverdue(e.plannedDate)}d overdue</div>
                </div>
                <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                  ${picSelectHtml(e.id, e.personId, e.projectId)}
                  <button class="btn btn-small btn-primary" data-action="mark-captured-today" data-id="${e.id}">Mark captured</button>
                </div>
              </div>`
                )
                .join("")
            : `<div class="empty-state">Nothing overdue. Clean sheet.</div>`
        }
        ${
          missingHiddenCount > 0
            ? `<div class="list-row-sub" style="padding-top:8px;">+${missingHiddenCount} more overdue, oldest shown first — see the calendar below for the rest.</div>`
            : ""
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
                  <div class="list-row-title">${isAll ? escapeHtml(projectName(e.projectId)) : formatDateHuman(e.plannedDate)}</div>
                  <div class="list-row-sub">${isAll ? `${formatDateHuman(e.plannedDate)} · ` : ""}${escapeHtml(personName(e.personId))}</div>
                </div>
                <span class="chip chip-upcoming">Upcoming</span>
              </div>`
                )
                .join("")
            : `<div class="empty-state">Nothing scheduled in the next week.</div>`
        }
      </div>
    </div>

    ${renderCalendarSection(scoped, year, month, isAll)}

    ${
      personRows
        ? `
    <div class="card" style="margin-top:16px;">
      <div class="card-pad" style="padding-bottom:0;">
        <div class="section-title">By person — ${monthLabel(year, month)}</div>
      </div>
      <table>
        <thead><tr><th>Person</th><th class="num">Due</th><th class="num">On time</th><th class="num">Late</th><th class="num">Missing</th><th class="num">On-time rate</th></tr></thead>
        <tbody>${personRows}</tbody>
      </table>
    </div>`
        : ""
    }
  `;
}

/* ================= Calendar (shared grid, scoped by caller) ================= */

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

function renderCalendarSection(scopedEntries, year, month, isAll) {
  const weeks = getMonthMatrix(year, month);
  const today = todayStr();
  const dows = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  return `
    <div class="card card-pad" style="margin-top:16px;">
      <div class="calendar-toolbar">
        <div class="calendar-nav">
          <button class="btn btn-small" data-action="cal-prev">&larr;</button>
          <div class="calendar-month-label">${monthLabel(year, month)}</div>
          <button class="btn btn-small" data-action="cal-next">&rarr;</button>
        </div>
        <div style="display:flex; align-items:center; gap:10px;">
          <label class="checkbox-row" style="font-size:13px;">
            <input type="checkbox" data-action="toggle-holidays" ${STATE.showHolidays ? "checked" : ""}>
            <span>Show SG public holidays</span>
          </label>
          <button class="btn btn-small" data-action="cal-today">Today</button>
        </div>
      </div>

      <div class="calendar-legend">
        <span><i class="legend-on-time"></i>On time</span>
        <span><i class="legend-late"></i>Late</span>
        <span><i class="legend-missing"></i>Missing</span>
        <span><i class="legend-upcoming"></i>Upcoming</span>
        <span><i class="legend-planned"></i>Capture day</span>
        ${STATE.showHolidays ? `<span><i class="legend-holiday"></i>Public holiday</span>` : ""}
      </div>

      <div class="calendar-grid">
        ${dows.map((d) => `<div class="calendar-dow">${d}</div>`).join("")}
        ${weeks
          .map((week) =>
            week
              .map((day) => {
                const dayEntries = scopedEntries.filter((e) => e.plannedDate === day.dateStr);
                const shown = dayEntries.slice(0, 3);
                const extra = dayEntries.length - shown.length;
                const capturedEntries = dayEntries.filter((e) => e.capturedDate);
                const upcomingEntries = dayEntries.filter((e) => captureStatus(e) === "upcoming");
                const holiday = STATE.showHolidays ? publicHoliday(day.dateStr) : null;

                // Priority: an actual logged outcome (on-time/late) always
                // wins — it's history, never hidden. Otherwise a public
                // holiday is called out. Otherwise, an upcoming (not yet
                // due) capture day gets a light "this is expected" shade.
                // Missing/overdue days keep just their small red chip, no
                // whole-day shade — that's their outcome color already.
                let dayShadeClass = "";
                if (capturedEntries.length) {
                  dayShadeClass = capturedEntries.some((e) => captureStatus(e) === "late")
                    ? "day-captured-late"
                    : "day-captured-on-time";
                } else if (holiday) {
                  dayShadeClass = "day-holiday";
                } else if (upcomingEntries.length) {
                  dayShadeClass = "day-planned";
                }

                return `
              <button type="button" class="calendar-day ${day.inMonth ? "" : "outside"} ${day.dateStr === today ? "today" : ""} ${dayShadeClass}" data-action="open-day" data-date="${day.dateStr}">
                <div class="calendar-day-num">${day.dayNum}</div>
                ${holiday ? `<div class="calendar-day-holiday-label">${escapeHtml(holiday.name)}</div>` : ""}
                <div style="display:flex; flex-direction:column; gap:3px;">
                  ${shown
                    .map((e) => {
                      const status = captureStatus(e);
                      const label = isAll ? projectName(e.projectId) : personName(e.personId);
                      return `<div class="calendar-day-item chip-${status}">${escapeHtml(label)}</div>`;
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
    </div>
  `;
}

function openDayModal(dateStr) {
  const isAll = STATE.selectedProjectId === "all";
  const scoped = filterByProject(STATE.data.schedule, STATE.selectedProjectId);
  const entries = sortedByPlannedDate(scoped.filter((e) => e.plannedDate === dateStr));

  const rows = entries
    .map((e) => {
      const status = captureStatus(e);
      const statusChip = `<span class="chip chip-${status}">${STATUS_LABEL[status]}</span>`;
      let actionHtml = "";
      if (e.capturedDate) {
        if (STATE.admin) {
          // Admins can correct a logged capture directly — backdate it,
          // or hand credit to the right person — rather than having to
          // undo and re-enter it. This edits the same schedule entry,
          // so it immediately affects that person's on-time stats.
          actionHtml = `
            ${picSelectHtml(e.id, e.personId, e.projectId)}
            <input type="date" data-captured-date-for="${e.id}" value="${e.capturedDate}" style="border:1px solid var(--border); border-radius:8px; padding:6px;">
            <button class="btn btn-small btn-primary" data-action="save-capture-edit" data-id="${e.id}" data-reopen-date="${dateStr}">Save</button>
            <button class="btn btn-small" data-action="undo-capture" data-id="${e.id}" data-reopen-date="${dateStr}">Undo</button>`;
        } else {
          actionHtml = `
            <span class="list-row-sub">Captured ${formatDateHuman(e.capturedDate)}</span>
            <button class="btn btn-small" data-action="undo-capture" data-id="${e.id}" data-reopen-date="${dateStr}">Undo</button>`;
        }
      } else {
        actionHtml = `
          ${picSelectHtml(e.id, e.personId, e.projectId)}
          <input type="date" value="${dateStr}" style="border:1px solid var(--border); border-radius:8px; padding:6px;">
          <button class="btn btn-small btn-primary" data-action="mark-captured-on" data-id="${e.id}" data-reopen-date="${dateStr}">Mark captured</button>`;
      }
      return `
        <div class="day-detail-item" data-entry-row>
          <div class="list-row-main">
            <div class="list-row-title">${isAll ? escapeHtml(projectName(e.projectId)) : escapeHtml(personName(e.personId))}</div>
            <div class="list-row-sub">${e.capturedDate && isAll ? escapeHtml(personName(e.personId)) + " · " : ""}${statusChip}</div>
          </div>
          <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
            ${actionHtml}
            ${STATE.admin ? `<button class="btn btn-small btn-danger" data-action="delete-entry" data-id="${e.id}" data-reopen-date="${dateStr}" title="Remove">&times;</button>` : ""}
          </div>
        </div>`;
    })
    .join("");

  const addEntryBlock = STATE.admin
    ? `
    <div class="form-row">
      <label>Add a planned capture</label>
      <div style="display:flex; gap:8px; flex-wrap:wrap;">
        ${
          isAll
            ? `<select id="add-entry-project" style="flex:1; min-width:160px; border:1px solid var(--border); border-radius:8px; padding:8px;">
                <option value="">Choose project…</option>
                ${activeProjects().map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("")}
              </select>`
            : `<input type="hidden" id="add-entry-project" value="${STATE.selectedProjectId}">`
        }
        <select id="add-entry-person" style="flex:1; min-width:220px; border:1px solid var(--border); border-radius:8px; padding:8px;">
          <option value="">Unassigned</option>
          ${personStatsOptionsHtml(null, isAll ? null : STATE.selectedProjectId)}
        </select>
        <button class="btn btn-primary" data-action="add-entry-for-day" data-date="${dateStr}">Add</button>
      </div>
    </div>`
    : "";

  const html = `
    <div class="modal-title">${formatDateHuman(dateStr)}${!isAll ? " · " + escapeHtml(projectName(STATE.selectedProjectId)) : ""}</div>
    <div class="modal-sub">Planned captures for this day</div>
    <div class="day-detail-list">
      ${rows || `<div class="empty-state">No captures planned for this day yet.</div>`}
    </div>
    ${addEntryBlock}
    <div class="form-actions">
      <button type="button" class="btn" data-action="close-modal">Close</button>
    </div>
  `;
  openModal(html);

  if (STATE.admin && isAll) {
    // In the combined view, the person list can't be scoped up front —
    // there's no project yet. Re-filter it to that project's team as
    // soon as one is picked, so staff still stay isolated per project.
    const projectSel = document.getElementById("add-entry-project");
    const personSel = document.getElementById("add-entry-person");
    if (projectSel && personSel) {
      projectSel.addEventListener("change", () => {
        personSel.innerHTML = `<option value="">Unassigned</option>${personStatsOptionsHtml(null, projectSel.value || null)}`;
      });
    }
  }
}

/* ================= Manage (admin-only: projects + people) ================= */

function projectsTableRows() {
  return STATE.data.projects
    .map((p) => {
      const s = summarize(filterByProject(STATE.data.schedule, p.id));
      return `
        <tr>
          <td>
            <div style="font-weight:600;">${escapeHtml(p.name)}</div>
            <div class="list-row-sub">${frequencyDetailLabel(p)}${p.frequency !== "manual" ? " · anchor " + formatDateHuman(p.anchorDate) : ""}</div>
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
}

function peopleCards() {
  return STATE.data.people
    .map((person) => {
      const s = summarize(STATE.data.schedule.filter((e) => e.personId === person.id));
      const rate = s.onTimeRate ?? 0;
      const personProjectNames = parsePersonProjectIds(person.projectIds)
        .map((id) => byId(STATE.data.projects, id)?.name)
        .filter(Boolean);
      return `
        <div class="card person-card">
          <div class="person-header">
            <button type="button" class="person-header-link" data-action="view-person" data-id="${person.id}" style="display:flex; align-items:center; gap:10px; background:none; border:none; padding:0; cursor:pointer; text-align:left;">
              <div class="avatar ${avatarColorClass(person.id)}">${initials(person.name)}</div>
              <div>
                <div style="font-weight:600; color:var(--text);">${escapeHtml(person.name)}</div>
                <div class="list-row-sub">${personProjectNames.length ? escapeHtml(personProjectNames.join(", ")) : "No project assigned"}${person.email ? " · " + escapeHtml(person.email) : ""}</div>
              </div>
            </button>
            <div class="actions">
              <button class="btn btn-small" data-action="view-person" data-id="${person.id}">Profile</button>
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
}

function renderPersonProfile() {
  const person = byId(STATE.data.people, STATE.selectedPersonId);
  if (!person) return renderPicker();

  const entries = sortedByPlannedDate(
    STATE.data.schedule.filter((e) => e.personId === person.id),
    -1
  );
  const s = summarize(entries);
  const projectNames = parsePersonProjectIds(person.projectIds)
    .map((id) => byId(STATE.data.projects, id)?.name)
    .filter(Boolean);

  const rows = entries.length
    ? entries
        .map((e) => {
          const status = captureStatus(e);
          return `
          <tr>
            <td>${escapeHtml(projectName(e.projectId))}</td>
            <td>${formatDateHuman(e.plannedDate)}</td>
            <td>${e.capturedDate ? formatDateHuman(e.capturedDate) : "—"}</td>
            <td><span class="chip chip-${status}">${STATUS_LABEL[status]}</span></td>
            ${STATE.admin ? `<td><button class="btn btn-small" data-action="edit-entry-dates" data-id="${e.id}">Edit</button></td>` : ""}
          </tr>`;
        })
        .join("")
    : `<tr><td colspan="${STATE.admin ? 5 : 4}"><div class="empty-state">No captures logged yet</div></td></tr>`;

  return `
    <div class="view-header">
      <div style="display:flex; align-items:center; gap:14px;">
        <div class="avatar ${avatarColorClass(person.id)}" style="width:48px; height:48px; font-size:18px;">${initials(person.name)}</div>
        <div>
          <h1>${escapeHtml(person.name)}</h1>
          <p>${projectNames.length ? escapeHtml(projectNames.join(", ")) : "No project assigned"}${person.email ? " · " + escapeHtml(person.email) : ""}</p>
        </div>
      </div>
    </div>

    <div class="card-grid">
      <div class="card stat-card accent-blue">
        <div class="stat-label">Captures due</div>
        <div class="stat-value">${s.due}</div>
        <div class="stat-sub">${s.upcoming} still upcoming</div>
      </div>
      <div class="card stat-card accent-green">
        <div class="stat-label">On time</div>
        <div class="stat-value">${s["on-time"]}</div>
        <div class="stat-sub">${formatPercent(s.onTimeRate)} on-time rate</div>
      </div>
      <div class="card stat-card accent-red">
        <div class="stat-label">Missed</div>
        <div class="stat-value">${s.missing}</div>
        <div class="stat-sub">${s.late} more captured late</div>
      </div>
    </div>

    <div class="card card-pad">
      <div class="section-title">Capture history</div>
      <table>
        <thead>
          <tr>
            <th>Project</th>
            <th>Planned date</th>
            <th>Captured date</th>
            <th>Status</th>
            ${STATE.admin ? "<th></th>" : ""}
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function openEntryDateEditModal(entry) {
  const html = `
    <div class="modal-title">Edit capture dates</div>
    <div class="modal-sub">${escapeHtml(projectName(entry.projectId))} — ${escapeHtml(personName(entry.personId))}</div>
    <form id="entry-date-form">
      <div class="form-row">
        <label for="ed-planned">Proper (planned) capture date</label>
        <input type="date" id="ed-planned" required value="${entry.plannedDate}">
      </div>
      <div class="form-row checkbox-row">
        <input type="checkbox" id="ed-captured-toggle" ${entry.capturedDate ? "checked" : ""}>
        <label for="ed-captured-toggle">Captured</label>
      </div>
      <div class="form-row" id="ed-captured-row" ${entry.capturedDate ? "" : "hidden"}>
        <label for="ed-captured">Actual capture date</label>
        <input type="date" id="ed-captured" value="${entry.capturedDate || ""}">
      </div>
      <span class="hint">Captured on or before the planned date counts as on time; after it counts as late.</span>
      <div class="form-actions">
        <button type="button" class="btn" data-action="close-modal">Cancel</button>
        <button type="submit" class="btn btn-primary">Save</button>
      </div>
    </form>
  `;
  openModal(html);

  const toggle = document.getElementById("ed-captured-toggle");
  const capturedRow = document.getElementById("ed-captured-row");
  toggle.addEventListener("change", () => {
    capturedRow.hidden = !toggle.checked;
  });

  document.getElementById("entry-date-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (STATE.busy) return;
    const planned = document.getElementById("ed-planned").value;
    if (!planned) return;
    const capturedOn = toggle.checked ? document.getElementById("ed-captured").value || todayStr() : null;
    STATE.busy = true;
    const submitBtn = e.target.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.disabled = true;
    try {
      await Store.updateScheduleEntry(entry.id, { plannedDate: planned, capturedDate: capturedOn });
      closeModal();
      await afterMutate();
      showToast("Capture updated");
    } catch (err) {
      showToast(err.message || "Could not update", true);
    } finally {
      STATE.busy = false;
      if (submitBtn && submitBtn.isConnected) submitBtn.disabled = false;
    }
  });
}

function renderManage() {
  return `
    <div class="view-header">
      <div>
        <h1>Manage</h1>
        <p>Admin-only — projects, people, and capture schedules.</p>
      </div>
    </div>

    <div class="manage-section">
      <div class="view-header" style="margin-bottom:12px;">
        <div>
          <h2>Projects</h2>
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
            ${projectsTableRows() || `<tr><td colspan="7"><div class="empty-state">No projects yet — add your first one.</div></td></tr>`}
          </tbody>
        </table>
      </div>
    </div>

    <div class="manage-section" style="margin-top:28px;">
      <div class="view-header" style="margin-bottom:12px;">
        <div>
          <h2>People</h2>
          <p>Capture owners and their track record</p>
        </div>
        <div class="actions">
          <button class="btn btn-primary" data-action="add-person">+ Add person</button>
        </div>
      </div>
      <div class="card-grid">
        ${peopleCards() || `<div class="card card-pad empty-state">No people added yet.</div>`}
      </div>
    </div>
  `;
}

function openProjectModal(project) {
  const isEdit = !!project;
  // Scope the default-owner picker to this project's own team, so it
  // can't be set to someone from a different project — that would
  // silently defeat the per-project staff isolation. A brand-new
  // project has no team yet, so it falls back to everyone; editing an
  // existing project always keeps the current owner visible even if
  // they've since been taken off the team.
  const people = isEdit
    ? STATE.data.people.filter(
        (p) => parsePersonProjectIds(p.projectIds).includes(project.id) || p.id === project.defaultAssigneeId
      )
    : STATE.data.people;
  const selectedDays = new Set(parseCaptureDays(project?.captureDays));
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
      <div class="form-row" id="pf-days-row">
        <label>Which day(s) of the week</label>
        <div class="weekday-block">
          ${WEEKDAY_NAMES.map(
            (name, i) => `
            <label class="weekday-box">
              <input type="checkbox" value="${i}" ${selectedDays.has(i) ? "checked" : ""}>
              <span>${name}</span>
            </label>`
          ).join("")}
        </div>
        <span class="hint">Pick any combination — capture will be planned on each of these days, at the frequency above.</span>
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

  const freqSelect = document.getElementById("pf-frequency");
  const daysRow = document.getElementById("pf-days-row");
  const syncDaysVisibility = () => {
    daysRow.hidden = !(freqSelect.value === "weekly" || freqSelect.value === "biweekly");
  };
  syncDaysVisibility();
  freqSelect.addEventListener("change", syncDaysVisibility);

  document.getElementById("project-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (STATE.busy) return;
    const frequency = freqSelect.value;
    const chosenDays = Array.from(daysRow.querySelectorAll("input[type=checkbox]:checked")).map((cb) => cb.value);
    const fields = {
      name: document.getElementById("pf-name").value.trim(),
      defaultAssigneeId: document.getElementById("pf-assignee").value || null,
      frequency,
      captureDays: frequency === "weekly" || frequency === "biweekly" ? chosenDays.join(",") : "",
      anchorDate: document.getElementById("pf-anchor").value,
      active: document.getElementById("pf-active").checked,
    };
    if (!fields.name) return;
    STATE.busy = true;
    const submitBtn = e.target.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.disabled = true;
    try {
      let full;
      if (isEdit) {
        await Store.updateProject(project.id, fields);
        full = { ...project, ...fields };
        await pruneStaleSchedule(project, full);
      } else {
        full = await Store.addProject(fields);
      }
      await regenerateSchedule(full);
      closeModal();
      await afterMutate();
      showToast(isEdit ? "Project updated" : "Project added");
    } catch (err) {
      showToast(err.message || "Something went wrong", true);
    } finally {
      STATE.busy = false;
      if (submitBtn && submitBtn.isConnected) submitBtn.disabled = false;
    }
  });
}

function openPersonModal(person) {
  const isEdit = !!person;
  const assignedIds = new Set(parsePersonProjectIds(person?.projectIds));
  const projects = activeProjects();
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
      <div class="form-row">
        <label>Projects</label>
        ${
          projects.length
            ? `<div class="project-assign-grid">
                ${projects
                  .map(
                    (p) => `
                  <label class="project-assign-box">
                    <input type="checkbox" value="${p.id}" ${assignedIds.has(p.id) ? "checked" : ""}>
                    <span>${escapeHtml(p.name)}</span>
                  </label>`
                  )
                  .join("")}
              </div>
              <span class="hint">Which project(s) this person checks in for — they'll only appear in that project's picker.</span>`
            : `<span class="hint">No projects yet — add one first, then come back to assign this person.</span>`
        }
      </div>
      <div class="form-actions">
        <button type="button" class="btn" data-action="close-modal">Cancel</button>
        <button type="submit" class="btn btn-primary">${isEdit ? "Save changes" : "Add person"}</button>
      </div>
    </form>
  `;
  openModal(html);
  const projectChecks = document.querySelectorAll("#person-form .project-assign-box input[type=checkbox]");
  document.getElementById("person-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (STATE.busy) return;
    const chosenProjectIds = Array.from(projectChecks)
      .filter((cb) => cb.checked)
      .map((cb) => cb.value);
    const fields = {
      name: document.getElementById("pe-name").value.trim(),
      email: document.getElementById("pe-email").value.trim(),
      projectIds: chosenProjectIds.join(","),
      active: true,
    };
    if (!fields.name) return;
    STATE.busy = true;
    const submitBtn = e.target.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.disabled = true;
    try {
      if (isEdit) await Store.updatePerson(person.id, fields);
      else await Store.addPerson(fields);
      closeModal();
      await afterMutate();
      showToast(isEdit ? "Person updated" : "Person added");
    } catch (err) {
      showToast(err.message || "Something went wrong", true);
    } finally {
      STATE.busy = false;
      if (submitBtn && submitBtn.isConnected) submitBtn.disabled = false;
    }
  });
}

/* ================= boot ================= */

document.addEventListener("DOMContentLoaded", init);
