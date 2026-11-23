# Chrome Web Store release: 2.1.0

Upload `umspec-release.zip`, built with `python scripts/build_release_zip.py`. The build removes the development `key` field from `manifest.json`; the store keeps the published extension ID.

## What's new (for the "What's new" box)

- **Planner**: calendar, list, timetable and materials views, with a sync status panel and this week's numbers at the top.
- **Background Drive sync**: after your first sync, updates start when you open Spectrum and keep going after you leave the page.
- **Tidy Drive**: files sorted into type folders (Lecture Slides, Tutorials, Labs…) and named after their Spectrum title, such as `W04 Normalization.pptx`; older files are renamed in place.
- **Links Doc per course**: videos, online classes and websites in one clickable Google Doc, limited to your OCC.
- **Your class group (OCC)**: detected from your groups, attendance and locked items, or typed in once before you sync. Other OCCs' items are hidden on course pages, and their deadlines are marked "not your OCC" in Calendar.
- **Submission status in Calendar**: each deadline says whether Spectrum still expects a submission.
- **Read groups with AI** (optional): understands unusual labels such as "G1" or a lecturer's section; only the course structure is sent.
- **Drive clean-up**: finds duplicate copies UM Spec created and moves them to Drive's trash after you confirm.
- Fixes: Calendar "401" sync errors, Turnitin pages, broken lecturer links named in the sync message, "Join: https://…" links, expired sign-in detection.

## Permission justifications (Privacy practices tab)

| Permission | Justification |
| --- | --- |
| `storage` | Saves preferences, sync progress and planner data on the device. |
| `identity` | Connects the student's own Google account for Drive and Calendar (no passwords are handled). |
| `activeTab`, `scripting` | Opens the exporter panel on the Spectrum tab the student is using. |
| `alarms` | Schedules planner reminders and the toolbar badge, and resumes a background Drive update. |
| `sidePanel` | Shows the planner beside the Spectrum page. |
| `offscreen` | Reads the student's selected Spectrum courses in the background so a Drive update can continue after the tab is closed. |
| `notifications` (optional) | Deadline and class reminders, only after the student turns reminders on. |
| Host `https://spectrum.um.edu.my/*` | Reads the student's own courses, files, calendar and announcements through their signed-in session. |

**Single purpose:** Help Universiti Malaya students organise their own SPeCTRUM course materials and dates (ZIP, Google Drive, Google Calendar and a planner).

**Remote code:** No. All extension code is bundled.

**Data use disclosures:** course content and dates are sent only to the student's own Google Drive/Calendar after they connect. Optional AI features (proforma analysis, Read groups with AI) send course documents or course structure to the UM Spec proxy and Google Gemini after an in-product disclosure. No analytics, no advertising, no sale of data. Privacy policy: `PRIVACY.md` in the repository (link it as the store's privacy policy URL).

## Before you submit

1. **Google OAuth consent screen**: Calendar scopes (`calendar.app.created`, `calendar.calendarlist.readonly`) are sensitive. While the app is in *Testing*, only listed test users can connect Drive or Calendar. Publish the consent screen and complete Google's verification for general use. ZIP export and the planner work without it.
2. **OAuth client**: the Chrome extension client ID in `manifest.json` must name the published store ID.
3. **AI proxy**: the `umspec-ai` Cloudflare Worker (with `/api/v1/course/layout`) must be deployed and have its Gemini keys set.
4. Run `node --test tests/*.test.cjs` (all must pass), build the zip, and load the unpacked build once to confirm it starts.
5. Update the store screenshots: planner overview with the sync status panel, Spectrum course page with the OCC bar, and a Drive course folder.
