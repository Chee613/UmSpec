# ⚡ UmSpec - SPeCTRUM Course Materials Exporter

> A browser extension for Universiti Malaya students to export selected SPeCTRUM course materials, keep them updated in Google Drive, and review dates for Google Calendar.

---

## ✨ Features

* **⚡ Zero-Touch 1-Click Export**: No checkboxes, no manual toggling, and no technical knowledge required. Click the button and the engine handles everything.
* **🎓 Automatic Academic Profile Detection**: Analyzes enrolled course codes to identify your Faculty, Bachelor Major (e.g., *Computer Science - Software Engineering*), and Academic Year/Semester.
* **🗂️ Adaptive Taxonomy Folders (Not Limited to Static Categories)**:
  Instead of forcing courses into fixed static folders, UmSpec dynamically creates folders only for material types that actually exist:
  * `1.Lecture Slide` — Lecture slides, notes, proforma, syllabus
  * `2.Tutorial` — Tutorials and problem sets
  * `3.Lab` — Lab exercises and practical worksheets
  * `4.Assignment` — Project specs, assignment briefs, rubrics, templates
  * `5.Past Year Questions (PYQ)` — Past exam papers and PYQs
  * `6.Source Code` — Code samples, starter projects (`.java`, `.py`, `.sql`)
  * `7.Datasets` — Datasets and data files (`.sav`, `.csv`, `.xlsx`)
  * `8.Video Lectures` — Recorded video/audio lectures or indexed YouTube video links
  * `9.Reference` — Textbooks, reference materials, reading guides
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


## Drive, Calendar and course updates

| Feature | Behaviour |
| --- | --- |
| ZIP | Existing one-click offline snapshot; no Google account required |
| Google Drive | Organised semester/course folders, changed-file updates, pause/resume and conflicts instead of overwriting student edits |
| Google Calendar | Dedicated calendar for official dates and reviewed announcements, stable event IDs and configurable reminders |
| Announcements | Local English/Malay date extraction, source evidence, meeting links and a review queue |
| Daily use | Remembered courses, a seven-day upcoming panel and recent changes |

The popup has Home and Settings tabs. The course dialog separates Courses, Dates and Settings, with paged lists that fit the window. Videos and recordings are saved as links by default. Enable **Settings → Files → Download videos** to include available video files in ZIP or Drive; hosted recordings remain links and Drive files over 50 MiB remain linked.

ZIP exports show the interactive Chrome Dino Runner with jump controls, cancellation/retry, and a completion screen. After exporting, use **Back to courses** to return to selection. The popup waits for Spectrum account verification before enabling settings; **Open courses** remains available during loading.

**Google setup is required before connection.** See [developer setup](docs/GOOGLE_SETUP.md), or use the bundled Google setup guide from the extension popup. No client secret is packaged.

1. Reload the extension and refresh Spectrum after updating.
2. Open Courses, select courses, then set the semester folder under Settings → Files.
3. Choose ZIP, or connect Drive from the popup and run a manual sync.
4. After a successful Drive pass, opt into checks on Spectrum visits.
5. Connect Calendar and enable announcements separately. Review ambiguous or changed announcement dates.

Checks run while Spectrum is open and signed in, with a 15-minute cooldown per feature. They do not run with the browser closed. Drive initially buffers one file up to 50 MiB; larger files and videos configured as links get an explicit linked-only result.

Google integration is Chrome-first and still needs an authenticated live pilot after OAuth setup. Keep ZIP available on other supported Chromium browsers until their Google sign-in paths are verified.

## Development checks

Run **node --test tests/*.test.cjs** for the dependency-free regression suite. Build the extension with **python scripts/build_release_zip.py**; this includes the background/shared/setup files and excludes backend secrets and test fixtures.

The suite includes actual bundled-JSZip export checks and simulated Google API recovery checks. It does not prove live OAuth or Spectrum deployment compatibility. See [implementation status](docs/IMPLEMENTATION_STATUS.md) for remaining release gates.

## 📄 License

Distributed under the [MIT License](LICENSE). Built for the Universiti Malaya student community.

UI icons use [Solar Bold Duotone](https://www.svgrepo.com/collection/solar-bold-duotone-icons/) by [480 Design](https://github.com/480-Design/Solar-Icon-Set), listed under the [CC Attribution license on SVG Repo](https://www.svgrepo.com/author/Solar%20Icons/). The bundled SVGs are adapted with theme colours and decorative accessibility attributes. Icons: Book, Square Academic Cap, Download, Restart, Danger Circle, Check Circle, Close Circle, Bolt, and Folder With Files.
