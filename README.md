# 📦 UmSpec - SPeCTRUM Course Materials Exporter

> A lightweight, privacy-friendly browser extension for **Universiti Malaya (UM)** students to download and package all enrolled course notes, slides, tutorials, labs, and assignments into a single, beautifully organized **ZIP archive** in just one click! 🎓

---

## ✨ Features

* **⚡ 1-Click Batch Export**: Automatically discovers all your registered courses on SPeCTRUM using Moodle's native APIs.
* **🎯 Granular Selection**: Choose exactly which **courses** and which **material categories** you want to export.
* **🗂️ Standardized Folder Structure**: Organizes every subject into a clean, intuitive directory hierarchy:
  ```text
  SPeCTRUM_Export/
  ├── WIA2007 MAD/
  │   ├── 1.Lecture Slide/     # Lecture slide decks, notes, and syllabus
  │   ├── 2.Tutorial/          # Problem sheets, tutorial questions
  │   ├── 3.Lab/               # Lab sheets, code exercises, manuals
  │   ├── 4.Assignment/        # Assignment briefings & project specifications
  │   └── 5.Reference/         # Textbooks, reading guides, reference docs
  ├── WIA2001 DB/
  └── ...
  ```
* **🔒 100% Client-Side & Private**: Runs entirely in your browser using [JSZip](https://stuk.github.io/jszip/). No credentials, cookies, or files are ever sent to external servers.
* **📊 Real-Time Progress Indicator**: Visual progress bar showing live download speed, current file, and completion percentage.

---

## 🚀 How to Install (Chrome, Edge, Brave)

Installing UmSpec takes less than 30 seconds:

1. **Download / Clone this repository**:
   ```bash
   git clone https://github.com/Chee613/UmSpec.git
   ```
   *(Or click **Code** $\rightarrow$ **Download ZIP** on GitHub and extract it to your computer).*

2. **Open Extensions in your browser**:
   * **Chrome / Brave**: Go to `chrome://extensions`
   * **Microsoft Edge**: Go to `edge://extensions`

3. **Enable Developer Mode**:
   * Toggle the **Developer mode** switch (top-right corner).

4. **Load the Extension**:
   * Click the **"Load unpacked"** button (top-left).
   * Select the `UmSpec` folder that contains `manifest.json`.

5. **Done!** You will see the **UmSpec** icon in your browser toolbar.

---

## 📖 How to Use

1. Log into **[SPeCTRUM UM](https://spectrum.um.edu.my)** as usual.
2. Look for the floating **`[ 📦 Export Courses (ZIP) ]`** button in the bottom-right corner (or click the UmSpec extension icon in your toolbar).
3. The export dialog will open:
   * Select which courses you want to download.
   * Choose which material categories to include (Slides, Tutorials, Labs, Assignments, References).
4. Click **"🚀 Start Export (ZIP)"**.
5. Once complete, your browser will automatically save your packaged `SPeCTRUM_Export_<Date>.zip`!

---

## 🛡️ Privacy & Security Guarantee

UmSpec was built with student security and data privacy as the top priority:
- **No external servers**: Operates 100% on `spectrum.um.edu.my`.
- **No password collection**: Relies strictly on your browser's existing active session.
- **Open source**: Fully open-source code for complete transparency.

---

## 📄 License

Distributed under the [MIT License](LICENSE). Built for the Universiti Malaya student community.