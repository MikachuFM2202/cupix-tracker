/**
 * ============================================================
 *  Cupix Capture Tracker — configuration
 * ============================================================
 *
 * Leave API_URL empty ("") to run in DEMO MODE: the app stores
 * everything in your browser's local storage, seeded with three
 * example projects so you can click around immediately.
 *
 * Once you've deployed the Google Apps Script backend (see
 * README.md, "Step 2: Connect Google Sheets"), paste the Web App
 * URL below between the quotes and reload the site. From that
 * point on, everyone who opens the site reads and writes the same
 * Google Sheet, so the whole team sees the same tracker.
 *
 * Example:
 *   const API_URL = "https://script.google.com/macros/s/AKfycb.../exec";
 */
const API_URL = "https://script.google.com/macros/s/AKfycbxfumqI9geJCH1RCdfeG-TId6gMGHl3JxmbfjmzcOv77c7tjx4X62ikPy-UevnaVjni/exec";

// How many months of future planned-capture dates to auto-generate
// when a project's capture schedule is set to "recurring". You can
// always add/remove individual dates by hand afterwards.
const SCHEDULE_HORIZON_MONTHS = 3;

/**
 * The passcode that unlocks Admin mode (manage projects/people, and
 * view every project's calendar combined). This is a light UX gate,
 * not real security — the Google Sheet backend already accepts
 * writes from anyone with the site link, same as before. Change it
 * to something your team wouldn't guess, but don't treat it as a
 * secret: anyone who reads this file (or the page source) can see it.
 */
const ADMIN_PASSCODE = "dge2026";

/**
 * Singapore public holidays, used only to shade them on the calendar
 * so you can see at a glance which planned capture days fall on an
 * off day. The fixed-date ones (New Year, Labour Day, National Day,
 * Christmas) are certain; the lunar/Islamic-calendar ones (Chinese
 * New Year, Hari Raya Puasa/Haji, Vesak, Deepavali) are best-effort
 * and worth checking against the current official MOM gazette before
 * relying on them for real scheduling decisions — those move every
 * year and this list isn't fetched live. When a holiday falls on a
 * Sunday, the Monday after is added too, per Singapore's usual "day
 * in lieu" convention. Add more years here as they're confirmed.
 */
const SG_PUBLIC_HOLIDAYS = [
  { date: "2026-01-01", name: "New Year's Day" },
  { date: "2026-02-17", name: "Chinese New Year" },
  { date: "2026-02-18", name: "Chinese New Year" },
  { date: "2026-03-20", name: "Hari Raya Puasa" },
  { date: "2026-04-03", name: "Good Friday" },
  { date: "2026-05-01", name: "Labour Day" },
  { date: "2026-05-27", name: "Hari Raya Haji" },
  { date: "2026-05-31", name: "Vesak Day" },
  { date: "2026-08-09", name: "National Day" },
  { date: "2026-08-10", name: "National Day (in lieu)" },
  { date: "2026-11-08", name: "Deepavali" },
  { date: "2026-12-25", name: "Christmas Day" },
];
