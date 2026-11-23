# Privacy Policy for UM Spec

Last updated: 23 November 2026 (version 2.1.0).

UM Spec helps Universiti Malaya students export and organise selected SPeCTRUM course content. Features are optional and process different data as described below.

## ZIP download

Selected course files are read through your signed-in Spectrum browser session and packaged in browser memory. You do not need to copy a cookie, share a password or connect Google.

## Google Drive

When connected, selected materials, folder names and source-mapping metadata are sent directly to your Google Drive. Files remain private unless you change sharing settings. UM Spec requests drive.file access rather than access to your entire Drive.

Source IDs, revisions and checksums allow updates to existing managed files. Missing Spectrum content does not automatically delete backups. Manual destination edits/deletions require review. Videos configured as links and files above the initial 50 MiB limit are saved as source links with an explicit status.

Files are sorted into type folders and named after their Spectrum title (for example `W04 Normalization.pptx`). Files UM Spec uploaded with an older name or folder are renamed or moved in place; files you renamed or moved yourself are left alone. Each course folder gets a **Links** Google Doc listing its videos, online classes and websites, limited to your class group (OCC) when it is known.

After your first successful sync, automatic Drive updates start when you open a signed-in Spectrum page and continue in the extension's background after you leave it. A hidden extension page (Chrome's offscreen document) reads your selected courses through your Spectrum session for this; it does not run while Chrome is closed.

**Drive clean-up** (Settings → More) lists extra copies and empty leftover folders that UM Spec itself created. Nothing is removed until you confirm the preview; confirmed items go to Drive's trash, where you can restore them for 30 days. Files you added yourself are never touched.

## Google Calendar

When enabled, official dates and reviewed announcement dates are copied to a dedicated UM Spec calendar. Details may include course names, descriptions, reminders, original Spectrum links and meeting links.

UM Spec only reads your calendar list. If its managed calendar is hidden, it tells you how to turn it on in Google Calendar instead of changing your list.

Each deadline includes its submission status from Spectrum's own to-do list ("Spectrum: not submitted yet" or "nothing left to submit"). Deadlines labelled for another class group (OCC) are marked "not your OCC" so they are not counted as yours.

Permissions manage UM Spec-created calendars and read calendar names/IDs to recover the existing calendar. They do not grant access to events on unrelated calendars. UM Spec does not send meeting invitations or create meeting rooms.

## Announcements and AI

Automatic announcement scanning defaults on for new preferences; saved choices are preserved. Opening Dates, choosing Analyse dates, or exporting selected courses starts a local check of official Spectrum dates and announcement forums. It runs alongside file exports and stores the results in extension storage. Each announcement pass reads up to 100 discussion opening posts; replies and attachment contents are not analysed. An incomplete pass can be continued with Analyse dates.

Date extraction runs locally and saves bounded excerpts/date suggestions for review. It does not send announcements to an AI service. Only approved announcement event details and joining links are copied to Google Calendar. Official dates sync when Calendar is connected and enabled. Stop cancels date analysis and pauses its Calendar writes without stopping a file export.

The separate proforma AI preference defaults on and can be turned off in Settings. Before its first analysis, you must accept the disclosure that selected proforma documents and prompts are sent to the configured UM Spec proxy and Google Gemini. Declining skips AI analysis for that export. The bundled default proxy may cache analysis output for up to 90 days. These requests exclude Spectrum cookies and Google access tokens. Automatic Drive/Calendar checks do not call this AI feature.

## AI course reading (optional)

Courses label class groups differently ("OCC 3", "G1", "Group 1M", lecturer sections). If you choose **Read groups with AI** on a course page's OCC bar and accept the notice, UM Spec sends that course's structure to the UM Spec proxy and Google Gemini: activity IDs, types, titles, section names and "Not available unless…" notes. It does not send your name, matric number, submissions, grades or your own OCC. The answer only says which OCC each activity is meant for. It is cached on the proxy for up to 90 days and reused for other students of the same course, and kept on this device for a week. An answer that disagrees with Spectrum's own locks or labels is not used. Turning it off from the OCC bar removes saved answers from this device.

## Class groups (OCC)

UM Spec works out your OCC in each course from Spectrum's own data: your groups, the attendance sessions you can see, and items locked to other groups. Before a manual sync it may ask you to confirm or type the OCC of courses it could not work out. Your OCC is stored only on this device and is never sent to Google, the AI proxy or anyone else.

## Planner

The planner reads your own Spectrum courses, calendar, submission status, attendance report, course announcements list and course file list, using your signed-in session. It runs while a Spectrum tab is open (at most every 30 minutes) or when you choose Refresh. The result stays in trusted extension storage on this device and is not sent to Google, the AI proxy or anyone else. Signing in as a different Spectrum account replaces the stored planner and clears its OCC choices. Settings → Clear planner data removes it.

File previews and course packs are downloaded from Spectrum directly into the planner page. Reminders are local browser notifications and need the optional Notifications permission, which is requested only when you turn reminders on. UM Spec never submits attendance or assignments for you; check-in buttons open the Spectrum page so you act yourself.

## Local storage

Trusted extension storage holds Spectrum user IDs, verified Google account ID/email, selected courses, preferences, managed resource IDs, revisions/checksums, resumable job metadata, pending review excerpts and recent changes. Google tokens remain in the Chrome identity cache and worker memory. The extension does not persist your Spectrum cookie or Google password.

Pending detailed reviews are limited to 500 per account binding. Recent changes retain at most 100 records for 30 days. Compact accepted source/event mappings remain while the archive is used to prevent duplicate imports. Upload session addresses are private job metadata. Some existing UI/AI preferences remain in Spectrum-origin local storage.

## Your controls

ZIP/Drive destination, courses, automatic updates, Calendar and announcement scanning are separate choices. Automatic checks start from an open, signed-in Spectrum page; a Drive update that has started continues in the background, and nothing runs while Chrome is closed. Disconnecting Google pauses writes and clears cached authorisation; remote files/calendars remain yours.

Revoke access through Google Account settings. Removing the extension clears local extension storage. ZIPs, Drive files and calendars remain under your control and can be deleted in their applications.

## Permissions and providers

Spectrum host access reads course content. Storage saves progress/preferences. Identity connects Google. Google API host access is optional and requested during connection. Existing active-tab/scripting access opens the exporter. Alarms schedule planner reminders, the badge count and resuming a background Drive update; Side panel shows the planner beside a page; Offscreen lets the background Drive update read your Spectrum courses after the tab is closed; Notifications is optional and only used for reminders.

No analytics or advertising is added. Google and the configured AI provider/proxy process requests under their respective service and operational policies. UM Spec does not sell student data. Executable extension code is bundled; no remotely hosted JavaScript is loaded.

Source code and questions: [UM Spec repository](https://github.com/Chee613/UmSpec).
