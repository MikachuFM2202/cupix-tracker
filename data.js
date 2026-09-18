/**
 * ============================================================
 *  Cupix Capture Tracker — data layer
 * ============================================================
 * One small "Store" interface, two implementations:
 *   - LocalStore  → browser localStorage (demo mode, per-device)
 *   - RemoteStore → Google Apps Script + Google Sheets (shared)
 *
 * app.js only ever talks to `Store`, never to localStorage or
 * fetch() directly, so swapping backends never touches the UI code.
 * ============================================================
 */

/* ---------- date helpers (all dates are "YYYY-MM-DD" strings) ---------- */

function toDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseDateStr(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function todayStr() {
  return toDateStr(new Date());
}

function addDays(dateStr, n) {
  const d = parseDateStr(dateStr);
  d.setDate(d.getDate() + n);
  return toDateStr(d);
}

function addMonthsKeepDay(dateStr, n) {
  const d = parseDateStr(dateStr);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, lastDay));
  return toDateStr(d);
}

function monthLabel(year, monthIndex) {
  return new Date(year, monthIndex, 1).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

function uid(prefix) {
  const rand =
    (crypto.randomUUID && crypto.randomUUID()) ||
    `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}_${rand}`;
}

/* ---------- capture status ---------- */

/**
 * Returns one of: "on-time" | "late" | "missing" | "upcoming"
 */
function captureStatus(entry, today = todayStr()) {
  if (entry.capturedDate) {
    return entry.capturedDate <= entry.plannedDate ? "on-time" : "late";
  }
  return entry.plannedDate < today ? "missing" : "upcoming";
}

const STATUS_LABEL = {
  "on-time": "Captured on time",
  late: "Captured late",
  missing: "Missing",
  upcoming: "Upcoming",
};

/**
 * Aggregate on-time / late / missing / upcoming counts and rates
 * for an arbitrary list of schedule entries. Rates are computed
 * against "due" entries only (on-time + late + missing) — an
 * upcoming, not-yet-due entry can't be judged yet.
 */
function summarize(entries) {
  const counts = { "on-time": 0, late: 0, missing: 0, upcoming: 0 };
  for (const e of entries) counts[captureStatus(e)]++;
  const due = counts["on-time"] + counts.late + counts.missing;
  return {
    total: entries.length,
    due,
    ...counts,
    onTimeRate: due ? counts["on-time"] / due : null,
    lateRate: due ? counts.late / due : null,
    missingRate: due ? counts.missing / due : null,
  };
}

/* ---------- capture-day-of-week helpers (0 = Mon … 6 = Sun) ---------- */

const WEEKDAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function mondayOfWeek(dateStr) {
  const d = parseDateStr(dateStr);
  const offset = (d.getDay() + 6) % 7; // JS getDay(): 0=Sun..6=Sat -> 0=Mon..6=Sun
  d.setDate(d.getDate() - offset);
  return toDateStr(d);
}

/** captureDays is stored as a comma-separated string, e.g. "0,3" for Mon+Thu. */
function parseCaptureDays(captureDays) {
  if (!captureDays) return [];
  return String(captureDays)
    .split(",")
    .map((s) => parseInt(s, 10))
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
}

function captureDaysLabel(captureDays) {
  const days = parseCaptureDays(captureDays);
  if (!days.length) return "";
  return days
    .slice()
    .sort((a, b) => a - b)
    .map((i) => WEEKDAY_NAMES[i])
    .join(", ");
}

/**
 * A person's projectIds is stored as a comma-separated string of
 * project ids, e.g. "proj_abc,proj_def" — the projects that person
 * is on the team for. Empty/missing means "not assigned to any
 * project yet", not "assigned to all of them".
 */
function parsePersonProjectIds(projectIds) {
  if (!projectIds) return [];
  return String(projectIds)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Returns { date, name } if dateStr is a configured SG public holiday, else null. */
function publicHoliday(dateStr) {
  const list = typeof SG_PUBLIC_HOLIDAYS !== "undefined" ? SG_PUBLIC_HOLIDAYS : [];
  return list.find((h) => h.date === dateStr) || null;
}

/* ---------- recurring schedule generation ---------- */

/**
 * Generates planned-capture dates for a project from its anchor
 * date through `throughDate` (inclusive), based on its frequency.
 * "manual" projects generate nothing — dates are added by hand.
 *
 * For weekly/biweekly projects with specific capture days chosen
 * (project.captureDays, e.g. "0,3" for Mon+Thu), every one of those
 * weekdays is generated each cycle. Without captureDays set (older
 * projects, or monthly/manual), it falls back to stepping from the
 * single anchor date, same as before.
 */
function generatePlannedDates(project, throughDate) {
  if (!project.anchorDate || project.frequency === "manual") return [];

  const captureDays = parseCaptureDays(project.captureDays);
  if (captureDays.length && (project.frequency === "weekly" || project.frequency === "biweekly")) {
    const stepDays = project.frequency === "weekly" ? 7 : 14;
    const dates = [];
    let weekStart = mondayOfWeek(project.anchorDate);
    let guard = 0;
    while (weekStart <= throughDate && guard < 500) {
      for (const dow of captureDays) {
        const d = addDays(weekStart, dow);
        if (d >= project.anchorDate && d <= throughDate) dates.push(d);
      }
      weekStart = addDays(weekStart, stepDays);
      guard++;
    }
    return dates.sort();
  }

  const dates = [];
  let d = project.anchorDate;
  let guard = 0;
  const step = (date) => {
    if (project.frequency === "weekly") return addDays(date, 7);
    if (project.frequency === "biweekly") return addDays(date, 14);
    if (project.frequency === "monthly") return addMonthsKeepDay(date, 1);
    return null;
  };
  while (d && d <= throughDate && guard < 500) {
    dates.push(d);
    d = step(d);
    guard++;
  }
  return dates;
}

/* ============================================================
 *  Demo seed data (used only by LocalStore, first run)
 * ============================================================ */

function buildSeedData() {
  const today = todayStr();
  const horizon = addMonthsKeepDay(today, SCHEDULE_HORIZON_MONTHS);

  const people = [
    { id: "p_ahmad", name: "Ahmad Faiz", email: "", active: true },
    { id: "p_priya", name: "Priya Nair", email: "", active: true },
    { id: "p_weiling", name: "Wei Ling", email: "", active: true },
  ];

  const projects = [
    {
      id: "proj_marina",
      name: "Marina One Tower B",
      active: true,
      defaultAssigneeId: "p_ahmad",
      frequency: "weekly",
      anchorDate: addDays(today, -49), // 7 weeks back
      createdDate: addDays(today, -60),
    },
    {
      id: "proj_woodlands",
      name: "Woodlands Health Campus",
      active: true,
      defaultAssigneeId: "p_priya",
      frequency: "biweekly",
      anchorDate: addDays(today, -56), // 4 cycles back
      createdDate: addDays(today, -70),
    },
    {
      id: "proj_jurong",
      name: "Jurong Regional Library",
      active: true,
      defaultAssigneeId: "p_weiling",
      frequency: "monthly",
      anchorDate: addMonthsKeepDay(today, -3),
      createdDate: addMonthsKeepDay(today, -3),
    },
  ];

  const schedule = [];
  for (const project of projects) {
    const dates = generatePlannedDates(project, horizon);
    dates.forEach((plannedDate, i) => {
      const entry = {
        id: uid("sch"),
        projectId: project.id,
        personId: project.defaultAssigneeId,
        plannedDate,
        capturedDate: null,
        notes: "",
      };
      // Deterministic demo outcomes for past-due dates only:
      // most on time, a few late, a couple missing. Future dates
      // (including today) are left upcoming.
      if (plannedDate < today) {
        const bucket = i % 5;
        if (bucket === 4) {
          // leave missing
        } else if (bucket === 3) {
          entry.capturedDate = addDays(plannedDate, 2); // late
        } else {
          entry.capturedDate = plannedDate; // on time
        }
      }
      schedule.push(entry);
    });
  }

  return { projects, people, schedule };
}

/* ============================================================
 *  LocalStore — browser localStorage, demo / single-device mode
 * ============================================================ */

const LOCAL_KEY = "cupix_tracker_data_v1";

class LocalStore {
  constructor() {
    this.mode = "local";
    this._load();
  }

  _load() {
    let raw = null;
    try {
      raw = localStorage.getItem(LOCAL_KEY);
    } catch (e) {
      /* private browsing etc. — fall back to in-memory only */
    }
    if (raw) {
      try {
        this.data = JSON.parse(raw);
        return;
      } catch (e) {
        /* corrupt — reseed below */
      }
    }
    this.data = buildSeedData();
    this._save();
  }

  _save() {
    try {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(this.data));
    } catch (e) {
      /* ignore — in-memory state still works for this session */
    }
  }

  async getData() {
    return structuredClone(this.data);
  }

  async addProject(project) {
    const p = { active: true, ...project, id: uid("proj"), createdDate: todayStr() };
    this.data.projects.push(p);
    this._save();
    return structuredClone(p);
  }

  async updateProject(id, fields) {
    const p = this.data.projects.find((x) => x.id === id);
    if (p) Object.assign(p, fields);
    this._save();
  }

  async deleteProject(id) {
    this.data.projects = this.data.projects.filter((x) => x.id !== id);
    this.data.schedule = this.data.schedule.filter((x) => x.projectId !== id);
    this._save();
  }

  async addPerson(person) {
    const p = { active: true, ...person, id: uid("p") };
    this.data.people.push(p);
    this._save();
    return structuredClone(p);
  }

  async updatePerson(id, fields) {
    const p = this.data.people.find((x) => x.id === id);
    if (p) Object.assign(p, fields);
    this._save();
  }

  async deletePerson(id) {
    this.data.people = this.data.people.filter((x) => x.id !== id);
    this._save();
  }

  async addScheduleEntries(entries) {
    const created = entries.map((e) => ({
      id: uid("sch"),
      capturedDate: null,
      notes: "",
      ...e,
    }));
    this.data.schedule.push(...created);
    this._save();
    return structuredClone(created);
  }

  async updateScheduleEntry(id, fields) {
    const e = this.data.schedule.find((x) => x.id === id);
    if (e) Object.assign(e, fields);
    this._save();
  }

  async deleteScheduleEntry(id) {
    this.data.schedule = this.data.schedule.filter((x) => x.id !== id);
    this._save();
  }
}

/* ============================================================
 *  RemoteStore — Google Apps Script + Google Sheets backend
 * ============================================================ */

class RemoteStore {
  constructor(url) {
    this.mode = "remote";
    this.url = url;
  }

  async _post(action, payload) {
    const res = await fetch(this.url, {
      method: "POST",
      // text/plain avoids a CORS preflight; Apps Script reads the
      // raw body itself and parses the JSON on the server side.
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action, payload }),
    });
    if (!res.ok) throw new Error(`Request failed (${res.status})`);
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || "Request failed");
    return json; // { ok, data, created }
  }

  async getData() {
    const res = await fetch(this.url, { method: "GET" });
    if (!res.ok) throw new Error(`Request failed (${res.status})`);
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || "Request failed");
    return json.data;
  }

  async addProject(project) {
    const json = await this._post("addProject", project);
    return json.created;
  }
  async updateProject(id, fields) {
    await this._post("updateProject", { id, fields });
  }
  async deleteProject(id) {
    await this._post("deleteProject", { id });
  }
  async addPerson(person) {
    const json = await this._post("addPerson", person);
    return json.created;
  }
  async updatePerson(id, fields) {
    await this._post("updatePerson", { id, fields });
  }
  async deletePerson(id) {
    await this._post("deletePerson", { id });
  }
  async addScheduleEntries(entries) {
    const json = await this._post("addSchedule", { entries });
    return json.created;
  }
  async updateScheduleEntry(id, fields) {
    await this._post("updateSchedule", { id, fields });
  }
  async deleteScheduleEntry(id) {
    await this._post("deleteSchedule", { id });
  }
}

/* ---------- factory ---------- */

const Store = API_URL && API_URL.trim() ? new RemoteStore(API_URL.trim()) : new LocalStore();
