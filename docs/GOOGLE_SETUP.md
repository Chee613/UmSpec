# Google setup for UM Spec

ZIP and local announcement review work immediately. Google features stay disabled until a real public OAuth client ID is configured.

## Developer setup

1. Create/select a [Google Cloud project](https://console.cloud.google.com/). Enable Drive API and Calendar API.
2. Configure Google Auth branding, support contact, privacy-policy URL and an external test audience. Add consenting test users.
3. Load UM Spec through Chrome's Extensions page and copy its extension ID.
4. Create a **Chrome Extension** OAuth client registered to that exact ID. For store distribution use the production extension ID. A stable development ID requires the corresponding public extension key.
5. Run **node scripts/configure_google_oauth.cjs** followed by the actual public client ID. Optionally add **--extension-key** followed by the base64 public key. Reload and verify that the extension ID still matches.
6. Reload the extension, refresh Spectrum, select courses, name the semester archive, then connect Drive/Calendar from the popup.

Never package a client secret, password or Spectrum cookie. The script accepts public configuration only.

## Permissions

| When | Scope | Purpose |
| --- | --- | --- |
| Either connection | openid, email | Verify the Google account |
| Drive | drive.file | Manage files authorised to UM Spec |
| Calendar | calendar.app.created | Manage a dedicated UM Spec calendar |
| Calendar | calendar.calendarlist.readonly | Find that calendar after reconnect/reinstall |

Calendar-list access reveals calendar names/IDs, not events in unrelated calendars. Google API host access is optional and requested when connecting.

## Pilot before distribution

- Confirm current-user detection, authenticated worker file downloads, the monthly calendar API and announcement layout on live Spectrum.
- Sync twice; require zero duplicate files/events. Replace a source file at the same URL and reschedule an event.
- Edit/rename/trash destination files and edit/remove destination events; require review rather than silent overwrite.
- Restart the worker during upload and resume on Spectrum. Test two tabs, account switching, permission denial, quota failure and expired sessions.
- Install the actual release archive in a fresh profile and verify ZIP without Google.
- Complete Google's publishing/verification requirements before broad release. Test consent is not production approval.

Use consenting test accounts and redacted metadata; never collect student cookies or course exports for debugging. Native Node/API simulations do not substitute for this authenticated pilot.
