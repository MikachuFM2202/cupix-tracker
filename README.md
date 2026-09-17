# Cupix Capture Tracker

A simple internal website for tracking whether the Cupix 360 capture has
been done for each project's design model — a monthly calendar of planned
capture dates, who's responsible, on-time/missing rates per person, and a
monthly integrity report.

It's a plain HTML/CSS/JS site (no build step), so it can be hosted for
free on **GitHub Pages** while you don't have a proper domain yet.

## Try it right now (no setup)

Open `index.html` in a browser (or push this repo to GitHub Pages — see
below). It starts in **demo mode**: three example projects, three example
people, and a few months of realistic sample data, all stored in your
browser's local storage. Click around freely — nothing here is shared with
anyone yet, so it's safe to experiment.

Demo mode has one limitation: the data only lives in *your* browser. For
a real team tool, everyone needs to read and write the same data — that's
what Step 2 below sets up, using a Google Sheet as the shared database.

## Step 1: Put it on GitHub Pages

1. Create a new GitHub repository (public or private — Pages works for
   both, private repos need GitHub Pro/Team/Enterprise for Pages, so use
   public unless you already have that).
2. Push everything in this folder to it:
   ```bash
   git remote add origin https://github.com/<your-username>/<repo-name>.git
   git branch -M main
   git push -u origin main
   ```
   (This folder is already a git repo with an initial commit — see
   "What's already done" below.)
3. In the repo on GitHub: **Settings → Pages → Source → Deploy from a
   branch → `main` / `/ (root)` → Save**.
4. After a minute, GitHub shows you the live URL (usually
   `https://<your-username>.github.io/<repo-name>/`). That's your site.

Anyone with that link can open the tracker. Once you have a real domain
you can point it at the same GitHub Pages site, or move it anywhere else
that serves static files — nothing here is tied to GitHub.

## Step 2: Connect Google Sheets (so the whole team shares one tracker)

This turns a Google Sheet into the shared database, using a small script
Google provides for free (Apps Script) as the go-between. No server to
pay for or maintain.

1. Go to [sheets.google.com](https://sheets.google.com) and create a new,
   blank spreadsheet. Name it something like "Cupix Capture Tracker Data".
2. In the sheet, go to **Extensions → Apps Script**. A new tab opens with
   a code editor.
3. Delete whatever is in the `Code.gs` file there, and paste in the full
   contents of **`apps-script/Code.gs`** from this project instead. Save
   (Ctrl/Cmd+S).
4. At the top of the Apps Script editor, find the function dropdown
   (near the Run/Debug buttons) and select **`oneTimeSetup`**, then click
   **Run**. The first time, Google will ask you to authorize the script —
   click through "Advanced → Go to project (unsafe)" (this warning shows
   because it's your own unpublished script, not because anything is
   actually wrong) and allow it.
   This creates three tabs in your spreadsheet — `Projects`, `People`,
   `Schedule` — and seeds them with the same three example projects as
   the demo, so the sheet and the site start out matching.
5. Click **Deploy → New deployment**. Next to "Select type," click the
   gear icon and choose **Web app**. Set:
   - **Execute as:** Me
   - **Who has access:** "Anyone" (simplest — anyone with the link can
     use the tracker) or, if you're on a Google Workspace account,
     "Anyone within [your organization]" to keep it to colleagues only.
   Click **Deploy**, authorize again if asked, and copy the **Web app
   URL** it gives you (ends in `/exec`).
6. Open **`config.js`** in this project and paste that URL in:
   ```js
   const API_URL = "https://script.google.com/macros/s/AKfycb.../exec";
   ```
7. Commit and push that change (`git add config.js && git commit -m
   "Connect Google Sheets backend" && git push`). GitHub Pages updates
   automatically within a minute or two.

From then on, the site reads and writes directly to that Google Sheet.
You can open the sheet yourself any time to eyeball or bulk-edit the raw
data — the site will pick up changes on the next reload.

**If you ever need to redeploy the script** (e.g. you paste in an updated
`Code.gs`), use **Deploy → Manage deployments → edit (pencil icon) →
New version → Deploy** rather than creating a brand-new deployment, so
the URL in `config.js` keeps working.

## How the tracker works

- **Dashboard** — this month's numbers at a glance, plus what's overdue
  and what's coming up in the next 7 days.
- **Calendar** — a full month view of every planned capture date. Click
  any day to see what's due, mark something as captured (with the actual
  date it happened), undo a mistaken entry, or add a one-off planned
  date.
- **Projects** — add projects, set who owns capture for each one, and
  how often it's expected: weekly, every 2 weeks, monthly, or "manual" if
  the dates don't follow a pattern. Recurring projects auto-generate the
  next 3 months of planned dates (tweak `SCHEDULE_HORIZON_MONTHS` in
  `config.js` to change that window); use **Refresh schedule** any time
  to top up further dates once you get close to running out.
- **People** — add the people responsible for captures. Each profile
  shows their on-time rate, missing rate, and a breakdown of on-time /
  late / missing counts, computed automatically from the calendar.
- **Reports** — pick any month and see the overall capture integrity
  score, broken down by project and by person. **Print / Save as PDF**
  uses your browser's print dialog to export it.

**Definitions used throughout:**
- **On time** — captured on or before its planned date.
- **Late** — captured, but after the planned date.
- **Missing** — planned date has passed and it still hasn't been
  captured.
- **Upcoming** — planned date hasn't arrived yet, so it can't be judged.
- Rates (on-time rate, missing rate) are calculated only against dates
  that are actually due (on time + late + missing) — an upcoming date
  isn't held against anyone yet.

## Project structure

```
index.html          the app shell (nav + containers)
styles.css           all styling (light, pastel, print-friendly)
config.js            ← put your Google Sheets Web App URL here
data.js               storage layer: local-storage demo mode, or the
                       Google Sheets backend, behind one interface
app.js                all the views and interactions
apps-script/Code.gs    paste into Google Apps Script (Step 2)
```

## What's already done

This folder is already an initialized git repository with the app
committed on the `main` branch — Step 1 above is just adding your GitHub
remote and pushing.
