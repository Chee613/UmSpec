# Privacy Policy for UM Spec

Last updated: 30 October 2026.

UM Spec helps Universiti Malaya students export and organise selected SPeCTRUM course content. Features are optional and process different data as described below.

## ZIP download

Selected course files are read through your signed-in Spectrum browser session and packaged in browser memory. You do not need to copy a cookie, share a password or connect Google.

## Google Drive

When connected, selected materials, folder names and source-mapping metadata are sent directly to your Google Drive. Files remain private unless you change sharing settings. UM Spec requests drive.file access rather than access to your entire Drive.

Source IDs, revisions and checksums allow updates to existing managed files. Missing Spectrum content does not automatically delete backups. Manual destination edits/deletions require review. Videos configured as links and files above the initial 50 MiB limit are saved as source links with an explicit status.

## Google Calendar

When enabled, official dates and reviewed announcement dates are copied to a dedicated UM Spec calendar. Details may include course names, descriptions, reminders, original Spectrum links and meeting links.

On first use or recovery, UM Spec makes its managed calendar visible in Google Calendar. Later visibility choices are preserved.

Permissions manage UM Spec-created calendars and read calendar names/IDs to recover the existing calendar. They do not grant access to events on unrelated calendars. UM Spec does not send meeting invitations or create meeting rooms.

## Announcements and AI

Automatic announcement scanning defaults on for new preferences; saved choices are preserved. Opening Dates, choosing Analyse dates, or exporting selected courses starts a local check of official Spectrum dates and announcement forums. It runs alongside file exports and stores the results in extension storage. Each announcement pass reads up to 100 discussion opening posts; replies and attachment contents are not analysed. An incomplete pass can be continued with Analyse dates.

Date extraction runs locally and saves bounded excerpts/date suggestions for review. It does not send announcements to an AI service. Only approved announcement event details and joining links are copied to Google Calendar. Official dates sync when Calendar is connected and enabled. Stop cancels date analysis and pauses its Calendar writes without stopping a file export.

The separate proforma AI preference defaults on and can be turned off in Settings. Before its first analysis, you must accept the disclosure that selected proforma documents and prompts are sent to the configured UM Spec proxy and Google Gemini. Declining skips AI analysis for that export. The bundled default proxy may cache analysis output for up to 90 days. These requests exclude Spectrum cookies and Google access tokens. Automatic Drive/Calendar checks do not call this AI feature.

## Planner

The planner reads your own Spectrum courses, calendar, submission status, attendance report, course announcements list and course file list, using your signed-in session. It runs while a Spectrum tab is open (at most every 30 minutes) or when you choose Refresh. The result stays in trusted extension storage on this device and is not sent to Google, the AI proxy or anyone else. Signing in as a different Spectrum account replaces the stored planner and clears its OCC choices. Settings → Clear planner data removes it.

File previews and course packs are downloaded from Spectrum directly into the planner page. Reminders are local browser notifications and need the optional Notifications permission, which is requested only when you turn reminders on. UM Spec never submits attendance or assignments for you; check-in buttons open the Spectrum page so you act yourself.

## Local storage

Trusted extension storage holds Spectrum user IDs, verified Google account ID/email, selected courses, preferences, managed resource IDs, revisions/checksums, resumable job metadata, pending review excerpts and recent changes. Google tokens remain in the Chrome identity cache and worker memory. The extension does not persist your Spectrum cookie or Google password.

Pending detailed reviews are limited to 500 per account binding. Recent changes retain at most 100 records for 30 days. Compact accepted source/event mappings remain while the archive is used to prevent duplicate imports. Upload session addresses are private job metadata. Some existing UI/AI preferences remain in Spectrum-origin local storage.

## Your controls

ZIP/Drive destination, courses, automatic updates, Calendar and announcement scanning are separate choices. Automatic checks require an open, signed-in Spectrum page. Disconnecting Google pauses writes and clears cached authorisation; remote files/calendars remain yours.

Revoke access through Google Account settings. Removing the extension clears local extension storage. ZIPs, Drive files and calendars remain under your control and can be deleted in their applications.

## Permissions and providers

Spectrum host access reads course content. Storage saves progress/preferences. Identity connects Google. Google API host access is optional and requested during connection. Existing active-tab/scripting access opens the exporter. Alarms schedule planner reminders and the badge count; Side panel shows the planner beside a page; Notifications is optional and only used for reminders.

No analytics or advertising is added. Google and the configured AI provider/proxy process requests under their respective service and operational policies. UM Spec does not sell student data. Executable extension code is bundled; no remotely hosted JavaScript is loaded.

Source code and questions: [UM Spec repository](https://github.com/Chee613/UmSpec).
