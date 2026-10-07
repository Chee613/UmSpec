# ⚡ UmSpec - SPeCTRUM Course Materials Exporter

> A zero-touch, privacy-friendly browser extension for **Universiti Malaya (UM)** students. In just **1 click**, it automatically detects your degree programme, discovers all enrolled courses, classifies materials adaptively, and packages everything into a structured **ZIP archive** with an executive **Academic Audit Report**! 🎓

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
* **🔒 100% Client-Side & Private**: All compression runs in browser memory using bundled [JSZip](https://stuk.github.io/jszip/). Zero data or credentials ever leave your machine.

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

* **No external servers**: Operates 100% on `spectrum.um.edu.my`.
* **Zero credential storage**: Relies strictly on your active browser session.
* **Open Source**: Full transparency for the UM student community.

---

## 📄 License

Distributed under the [MIT License](LICENSE). Built for the Universiti Malaya student community.

UI icons use [Solar Bold Duotone](https://www.svgrepo.com/collection/solar-bold-duotone-icons/) by [480 Design](https://github.com/480-Design/Solar-Icon-Set), listed under the [CC Attribution license on SVG Repo](https://www.svgrepo.com/author/Solar%20Icons/). The bundled SVGs are adapted with theme colours and decorative accessibility attributes. Icons: Book, Square Academic Cap, Download, Restart, Danger Circle, Check Circle, Close Circle, Bolt, and Folder With Files.
