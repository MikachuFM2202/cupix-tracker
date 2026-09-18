/**
 * ============================================================
 *  Cupix Capture Tracker — Google Apps Script backend
 * ============================================================
 * This script turns a Google Sheet into a tiny JSON API that the
 * static website (index.html + app.js) reads and writes to, so
 * everyone on the team sees the same data.
 *
 * SETUP — see README.md in the project root for the full walk-
 * through with screenshots-in-words. Short version:
 *   1. Create a Google Sheet.
 *   2. Extensions → Apps Script, paste this whole file in,
 *      replacing whatever is there.
 *   3. Run "oneTimeSetup" once (see the function below) to create
 *      the three tabs with headers and three example projects.
 *   4. Deploy → New deployment → type "Web app" →
 *        Execute as: Me
 *        Who has access: Anyone with the link (or "Anyone within
 *        <your org>" if you're on Google Workspace and want it
 *        restricted to colleagues)
 *      Copy the Web App URL into config.js as API_URL.
 * ============================================================
 */

const SHEETS = {
  PROJECTS: "Projects",
  PEOPLE: "People",
  SCHEDULE: "Schedule",
};

const HEADERS = {
  Projects: ["id", "name", "active", "defaultAssigneeId", "frequency", "anchorDate", "createdDate", "captureDays"],
  People: ["id", "name", "email", "active", "projectIds"],
  Schedule: ["id", "projectId", "personId", "plannedDate", "capturedDate", "notes"],
};

/* ---------------------------------------------------------------
 * One-time setup: creates the three tabs (if missing) with headers
 * and, only if the sheet is brand new, three example projects and
 * people matching the site's demo data. Safe to re-run — it will
 * not duplicate headers or example rows on a sheet that already
 * has data.
 * ------------------------------------------------------------- */
function oneTimeSetup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  Object.keys(HEADERS).forEach((name) => {
    let sheet = ss.getSheetByName(name);
    if (!sheet) sheet = ss.insertSheet(name);
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(HEADERS[name]);
      sheet.setFrozenRows(1);
    }
  });

  const projectsSheet = ss.getSheetByName(SHEETS.PROJECTS);
  if (projectsSheet.getLastRow() === 1) {
    // Sheet has only the header row — seed three example projects.
    const today = todayStr_();
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
        anchorDate: addDays_(today, -49),
        createdDate: addDays_(today, -60),
      },
      {
        id: "proj_woodlands",
        name: "Woodlands Health Campus",
        active: true,
        defaultAssigneeId: "p_priya",
        frequency: "biweekly",
        anchorDate: addDays_(today, -56),
        createdDate: addDays_(today, -70),
      },
      {
        id: "proj_jurong",
        name: "Jurong Regional Library",
        active: true,
        defaultAssigneeId: "p_weiling",
        frequency: "monthly",
        anchorDate: addMonthsKeepDay_(today, -3),
        createdDate: addMonthsKeepDay_(today, -3),
      },
    ];
    people.forEach((p) => appendRow_(SHEETS.PEOPLE, p));
    projects.forEach((p) => appendRow_(SHEETS.PROJECTS, p));

    // Generate three months of planned dates per project, same
    // logic as the frontend demo seed, so a fresh sheet looks like
    // the demo the first time you open the site.
    const horizon = addMonthsKeepDay_(today, 3);
    projects.forEach((project) => {
      const dates = plannedDates_(project, horizon);
      dates.forEach((plannedDate, i) => {
        const entry = {
          id: Utilities.getUuid(),
          projectId: project.id,
          personId: project.defaultAssigneeId,
          plannedDate,
          capturedDate: "",
          notes: "",
        };
        if (plannedDate < today) {
          const bucket = i % 5;
          if (bucket === 3) entry.capturedDate = addDays_(plannedDate, 2);
          else if (bucket !== 4) entry.capturedDate = plannedDate;
        }
        appendRow_(SHEETS.SCHEDULE, entry);
      });
    });
  }

  Logger.log("Setup complete.");
}

/* ---------------------------------------------------------------
 * HTTP entry points
 * ------------------------------------------------------------- */

function doGet(e) {
  return jsonResponse_({ ok: true, data: getAllData_() });
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const { action, payload } = body;
    let created = null;
    const handlers = {
      addProject: () => {
        created = addRow_(SHEETS.PROJECTS, payload, "proj");
      },
      updateProject: () => updateRow_(SHEETS.PROJECTS, payload.id, payload.fields),
      deleteProject: () => {
        deleteRow_(SHEETS.PROJECTS, payload.id);
        deleteWhere_(SHEETS.SCHEDULE, "projectId", payload.id);
      },
      addPerson: () => {
        created = addRow_(SHEETS.PEOPLE, payload, "p");
      },
      updatePerson: () => updateRow_(SHEETS.PEOPLE, payload.id, payload.fields),
      deletePerson: () => deleteRow_(SHEETS.PEOPLE, payload.id),
      addSchedule: () => {
        created = payload.entries.map((entry) => addRow_(SHEETS.SCHEDULE, entry, "sch"));
      },
      updateSchedule: () => updateRow_(SHEETS.SCHEDULE, payload.id, payload.fields),
      deleteSchedule: () => deleteRow_(SHEETS.SCHEDULE, payload.id),
    };
    if (!handlers[action]) throw new Error("Unknown action: " + action);
    handlers[action]();
    return jsonResponse_({ ok: true, data: getAllData_(), created: created });
  } catch (err) {
    return jsonResponse_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}

/* ---------------------------------------------------------------
 * Sheet <-> object helpers
 * ------------------------------------------------------------- */

function sheet_(name) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sheet) throw new Error("Missing sheet: " + name + ". Run oneTimeSetup first.");
  return sheet;
}

function readAll_(name) {
  const sheet = sheet_(name);
  const values = sheet.getDataRange().getValues();
  const headers = values[0];
  return values.slice(1).map((row) => {
    const obj = {};
    headers.forEach((h, i) => {
      let v = row[i];
      if (v instanceof Date) v = toDateStr_(v);
      if (v === "") v = h === "capturedDate" || h === "notes" || h === "email" ? v : v;
      obj[h] = v;
    });
    // Normalize blanks to null for optional date fields.
    if ("capturedDate" in obj && obj.capturedDate === "") obj.capturedDate = null;
    if ("active" in obj) obj.active = obj.active === true || obj.active === "TRUE" || obj.active === "true";
    return obj;
  });
}

function getAllData_() {
  return {
    projects: readAll_(SHEETS.PROJECTS),
    people: readAll_(SHEETS.PEOPLE),
    schedule: readAll_(SHEETS.SCHEDULE),
  };
}

function appendRow_(name, obj) {
  const sheet = sheet_(name);
  const headers = HEADERS[name];
  sheet.appendRow(headers.map((h) => (obj[h] === undefined || obj[h] === null ? "" : obj[h])));
}

function addRow_(name, payload, prefix) {
  const obj = Object.assign({ id: prefix + "_" + Utilities.getUuid() }, payload);
  if (name === SHEETS.PROJECTS) obj.createdDate = obj.createdDate || todayStr_();
  appendRow_(name, obj);
  return obj;
}

function findRowIndex_(sheet, headers, id) {
  const idCol = headers.indexOf("id");
  const values = sheet.getDataRange().getValues();
  for (let r = 1; r < values.length; r++) {
    if (values[r][idCol] === id) return r + 1; // 1-based sheet row
  }
  return -1;
}

function updateRow_(name, id, fields) {
  const sheet = sheet_(name);
  const headers = HEADERS[name];
  const rowIndex = findRowIndex_(sheet, headers, id);
  if (rowIndex === -1) throw new Error("Row not found: " + id);
  Object.keys(fields || {}).forEach((key) => {
    const col = headers.indexOf(key);
    if (col === -1) return;
    let v = fields[key];
    if (v === null || v === undefined) v = "";
    sheet.getRange(rowIndex, col + 1).setValue(v);
  });
}

function deleteRow_(name, id) {
  const sheet = sheet_(name);
  const headers = HEADERS[name];
  const rowIndex = findRowIndex_(sheet, headers, id);
  if (rowIndex !== -1) sheet.deleteRow(rowIndex);
}

function deleteWhere_(name, field, value) {
  const sheet = sheet_(name);
  const headers = HEADERS[name];
  const col = headers.indexOf(field);
  const values = sheet.getDataRange().getValues();
  for (let r = values.length - 1; r >= 1; r--) {
    if (values[r][col] === value) sheet.deleteRow(r + 1);
  }
}

/* ---------------------------------------------------------------
 * Date helpers (mirrors data.js on the frontend)
 * ------------------------------------------------------------- */

function toDateStr_(d) {
  const tz = Session.getScriptTimeZone();
  return Utilities.formatDate(d, tz, "yyyy-MM-dd");
}

function todayStr_() {
  return toDateStr_(new Date());
}

function addDays_(dateStr, n) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + n);
  return toDateStr_(dt);
}

function addMonthsKeepDay_(dateStr, n) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, 1);
  dt.setMonth(dt.getMonth() + n);
  const lastDay = new Date(dt.getFullYear(), dt.getMonth() + 1, 0).getDate();
  dt.setDate(Math.min(d, lastDay));
  return toDateStr_(dt);
}

function plannedDates_(project, throughDate) {
  if (!project.anchorDate || project.frequency === "manual") return [];
  const dates = [];
  let d = project.anchorDate;
  let guard = 0;
  while (d && d <= throughDate && guard < 500) {
    dates.push(d);
    if (project.frequency === "weekly") d = addDays_(d, 7);
    else if (project.frequency === "biweekly") d = addDays_(d, 14);
    else if (project.frequency === "monthly") d = addMonthsKeepDay_(d, 1);
    else d = null;
    guard++;
  }
  return dates;
}
