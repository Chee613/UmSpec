# ⚡ UmSpec - SPeCTRUM Course Materials Exporter

> A browser extension for Universiti Malaya students to export selected SPeCTRUM course materials, keep them updated in Google Drive, and review dates for Google Calendar.

---

## ✨ Features

* **⚡ Zero-Touch 1-Click Export**: No checkboxes, no manual toggling, and no technical knowledge required. Click the button and the engine handles everything.
* **🎓 Automatic Academic Profile Detection**: Analyzes enrolled course codes to identify your Faculty, Bachelor Major (e.g., *Computer Science - Software Engineering*), and Academic Year/Semester.
* **🗂️ Adaptive Taxonomy Folders (Not Limited to Static Categories)**:
  Each course gets a folder per material type, created only when the course has that type. Words are matched whole ("example" is not "exam"), and the activity's title decides before its section:
  * `Course Info` — Proforma, course outline, syllabus, teaching plan
  * `Lecture Slides` — Lecture slides and notes (also the default)
  * `Tutorials` — Tutorials, exercises, worksheets
  * `Labs` — Lab sheets and practicals
  * `Assignments & Projects` — Briefs, rubrics, proposals, reports
  * `Past Year & Tests` — Past papers, mid-terms, tests, quizzes
  * `Source Code` — Code files (`.py`, `.java`, `.sql`, …)
  * `Recordings & Media` — Video and audio files

  In Google Drive, files are named after their Spectrum title with their place in the course in front: `W04` for Week 4 (or Minggu 4), `T03` Topic, `C02` Chapter, `B02` Bab, `L05` Lecture or Kuliah, `U`/`M`/`S` for unit, module and session (for example `W04 Normalization - Compact Notes.pptx`). Course folders keep three- and four-letter UM codes (`WIA2001`, `KXEX1110`), and each course folder has a **Links** Google Doc with its videos, online classes and websites, grouped by section. Submission, attendance and quiz pages are left out. Files from earlier versions are renamed and moved in place on the next sync; files you renamed or moved yourself are left alone.
* **📋 Auto-Generated Academic Audit Report**:
  Generates `SEMESTER_AUDIT_REPORT.md` at the root of the ZIP detailing:
  * Student Name, Faculty & Detected Programme
  * Enrolled course material health check (Active vs Empty/Missing content)
  * Discovered material taxonomy summary
* **Optional connections**: ZIP packaging and announcement extraction run locally. Google sync and proforma AI have separate connection/disclosure controls; see [Privacy](PRIVACY.md).

---

## 🚀 How to Install (Chrome, Edge, Brave)

1. **Clone or Download this repository**:
   ```bash
   git clone https://github.com/Chee613/UmSpec.git
   ```
   *(Or click **Code** $\rightarrow$ **Download ZIP** on GitHub and unzip it).*

2. **Open Extensions in your browser**:
   * **Chrome / Brave**: Go to `chrome://extensions`
   * **Microsoft Edge**: Go to `edge://extensions`

3. **Enable Developer Mode**:
   * Toggle **Developer mode** in the top-right corner.

4. **Load the Extension**:
   * Click **"Load unpacked"** (top-left).
   * Select the `UmSpec` folder containing `manifest.json`.

5. **Done!** The extension is installed and ready.

After updating the extension files, click **Reload** on UmSpec in the browser’s Extensions page, then refresh your SPeCTRUM tab. Existing tabs keep the previous injected UI until refreshed.

If `Extension context invalidated` appears during a reload, close **all** Spectrum tabs, reload UM Spec, clear its old error entries, and open Spectrum again. This retires older injected scripts in every tab. Version **2.0.4** includes the guarded runtime; its popup and dashboard show the same version.

---

## 📖 How to Use

1. Log into **[SPeCTRUM UM](https://spectrum.um.edu.my)**.
2. Click the floating **`[ ⚡ 1-Click Smart Export ]`** button in the bottom-right corner.
3. The engine will:
   * Display your detected **Bachelor's Major** and **Academic Year**.
   * Display all your enrolled subjects.
4. Click **"⚡ Start 1-Click Export (ZIP)"**.
5. Once complete, your browser will automatically save your packaged `SPeCTRUM_Smart_Export_<Date>.zip` containing all your structured course materials and your `SEMESTER_AUDIT_REPORT.md`!

---

## 🛡️ Privacy & Security Guarantee

* **Optional Google/AI services**: Drive and Calendar send selected content directly to Google after connection; optional proforma AI uses its configured proxy after disclosure.
* **No copied Spectrum cookies**: Uses the signed-in browser session. Google tokens stay in Chrome identity/worker memory.
* **Open Source**: Full transparency for the UM student community.

---


## Planner

Open it from the toolbar popup (**Open planner** or the side-panel button), with **Alt+Shift+P**, or from the OCC bar on a course page. It refreshes from Spectrum while a Spectrum tab is open, at most every 30 minutes, or when you choose **Refresh**.

| View | What it shows |
| --- | --- |
| Calendar | Month grid with assignment, quiz, attendance, notice and event tags (dots or counts) and the selected day's agenda |
| List | Timeline by date with a Today marker, newest/oldest order and a per-course sidebar |
| Timetable | Weekly class grid built from attendance sessions, a live "now" line, and CSV, calendar (.ics), PNG and print/PDF export |
| Materials | Every course's files by section with type filters, search, in-page PDF/image/video preview, "In Drive" badges and ZIP course packs |
| Settings | OCC per course (detected automatically from your groups or attended classes), reminders, English/Bahasa Melayu/中文 and light/dark theme |

Deadlines show **Overdue**, **To do** or **Submitted** from Spectrum's own outstanding-action list. Attendance shows **Check-in open**, **Present** or **Absent**; the check-in button opens Spectrum so you mark it yourself. UM Spec never submits attendance automatically.

The OCC bar on course pages hides activities labelled for other OCCs (use **Show items from every OCC** to dim them instead). Reminders are optional browser notifications before deadlines and classes, and the toolbar badge counts deadlines due within 48 hours or overdue.

The parsers follow standard Moodle attendance, calendar and forum layouts and are covered by synthetic tests; check them against a signed-in Spectrum account after any Spectrum upgrade.

## Drive, Calendar and course updates

| Feature | Behaviour |
| --- | --- |
| ZIP | Existing one-click offline snapshot; no Google account required |
| Google Drive | Organised semester/course folders, changed-file updates, pause/resume and conflicts instead of overwriting student edits |
| Google Calendar | Dedicated calendar for official dates and reviewed announcements, stable event IDs and configurable reminders |
| Announcements | Local English/Malay date extraction, source evidence, meeting links and a review queue |
| Daily use | Remembered courses, a seven-day upcoming panel and recent changes |

The popup has Home and Settings tabs. The course dialog separates Courses, Dates and Settings, with paged lists that fit the window. Download videos, automatic Drive updates, official date sync, announcement checks and proforma AI analysis default on for new preferences; saved choices are preserved. Turn off **Settings → Files → Download videos** to save video links; hosted recordings and Drive files over 50 MiB remain linked. Google features require connection, and proforma AI requires its first-use disclosure.

ZIP exports show the interactive Chrome Dino Runner with jump controls, cancellation/retry, and a completion screen. After exporting, use **Back to courses** to return to selection. The popup waits for Spectrum account verification before enabling settings; **Open courses** remains available during loading.

**Google setup is required before connection.** See [developer setup](docs/GOOGLE_SETUP.md), or use the bundled Google setup guide from the extension popup. No client secret is packaged.

1. Reload the extension and refresh Spectrum after updating.
2. Open Courses, select courses, then set the semester folder under Settings → Files.
3. Choose ZIP, or connect Drive from the popup and run a manual sync.
4. After a successful Drive pass, automatic updates check on Spectrum visits unless you turn them off.
5. Connect Calendar separately from Drive, then open Dates → Analyse dates. Official dates sync when enabled; announcement suggestions require review before saving.

Events appear in the separate **UM Spec** calendar under the connected Google account. UM Spec makes that calendar visible on first use or recovery. Dates reports the saved count, pending reviews and sync errors; Settings → Calendar reports Calendar's own connection status.

Checks run while Spectrum is open and signed in, with a 15-minute cooldown per feature. They do not run with the browser closed. Drive initially buffers one file up to 50 MiB; larger files and videos configured as links get an explicit linked-only result.

Google integration is Chrome-first and still needs an authenticated live pilot after OAuth setup. Keep ZIP available on other supported Chromium browsers until their Google sign-in paths are verified.

## Development checks

Run **node --test tests/*.test.cjs** for the dependency-free regression suite. Build the extension with **python scripts/build_release_zip.py**; this includes the background/shared/setup files and excludes backend secrets and test fixtures.

The suite includes actual bundled-JSZip export checks and simulated Google API recovery checks. It does not prove live OAuth or Spectrum deployment compatibility. See [implementation status](docs/IMPLEMENTATION_STATUS.md) for remaining release gates.

## 📄 License

Distributed under the [MIT License](LICENSE). Built for the Universiti Malaya student community.

UI icons use [Solar Bold Duotone](https://www.svgrepo.com/collection/solar-bold-duotone-icons/) by [480 Design](https://github.com/480-Design/Solar-Icon-Set), listed under the [CC Attribution license on SVG Repo](https://www.svgrepo.com/author/Solar%20Icons/). The bundled SVGs are adapted with theme colours and decorative accessibility attributes. Icons: Book, Square Academic Cap, Download, Restart, Danger Circle, Check Circle, Close Circle, Bolt, and Folder With Files.
