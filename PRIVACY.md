# Privacy Policy for UmSpec

**Last updated:** October 8, 2026

**UmSpec** ("we", "our", or "the extension") is an open-source productivity browser extension designed to help Universiti Malaya students export and archive their enrolled course materials from the SPeCTRUM portal.

We take your privacy seriously. This Privacy Policy explains our practices regarding user data.

---

### 1. Zero Data Collection

UmSpec **does NOT collect, store, transmit, or sell any personal information or user data**. 

* We do not collect names, student IDs, email addresses, passwords, or IP addresses.
* We do not log web browsing history, clicks, keystrokes, or user behavior.
* We do not operate external backend servers, tracking pixels, or third-party analytics services (such as Google Analytics or Mixpanel).

---

### 2. How the Extension Works (100% Client-Side)

All operations performed by UmSpec occur **strictly locally on your device**:

* **Course Material Downloads:** The extension communicates directly between your web browser and `spectrum.um.edu.my` using your existing, authenticated browser session. File downloads and ZIP archive packaging are executed entirely in-memory within your browser.
* **No Remote Code:** UmSpec contains zero remotely hosted scripts and executes all logic from bundled local extension code.

---

### 3. Permissions Explanation

UmSpec requests minimal permissions strictly necessary for its functionality:

* **Host Permission (`https://spectrum.um.edu.my/*`):** Required solely to read enrolled course information and fetch course lecture slides/notes directly from the Universiti Malaya SPeCTRUM portal.
* **Storage Permission (`chrome.storage.local`):** Used exclusively to save your selected degree programme preference and UI display settings locally on your machine. This data never leaves your browser.

---

### 4. Third-Party Sharing

We do not sell, rent, trade, or transfer any data to third parties. No data is collected to determine creditworthiness or for lending purposes.

---

### 5. Open Source & Transparency

UmSpec is an open-source project. You can inspect the source code, verify all network requests, or audit security directly on GitHub:
👉 [https://github.com/Chee613/UmSpec](https://github.com/Chee613/UmSpec)

---

### 6. Contact & Support

If you have any questions or feedback regarding this Privacy Policy, please contact us by opening an issue on GitHub:
👉 [https://github.com/Chee613/UmSpec/issues](https://github.com/Chee613/UmSpec/issues)
