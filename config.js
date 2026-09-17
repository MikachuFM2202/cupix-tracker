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
const ADMIN_PASSCODE = "cupix-admin";
