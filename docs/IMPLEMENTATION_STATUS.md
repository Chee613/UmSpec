# UM Spec implementation status

Implementation date: 24 October 2026. Branch: codex/student-sync.

UI update: 25 October 2026, version 2.0.1. Compact tabs separate daily actions from settings. Courses, materials, dates and reviews use pagination to fit the viewport. Videos default to links; Settings → Files offers optional video downloads for ZIP and Drive.

Follow-up version 2.0.2 restores the interactive Dino export panel, with cancellation/restart and completion states. It also fixes a popup startup race that could leave settings disabled before Spectrum context finished loading. Open courses works while verification is pending.

## Implemented

| Area | Included |
| --- | --- |
| Destination | ZIP/Drive choice, selected courses and explicit semester archive |
| Drive | Stable source IDs, metadata/hash comparison, managed folders, resumable chunks, checkpoints, conflict/trash handling and linked-only large-file results |
| Calendar | Strict dates, stable IDs, dedicated calendar, reminder settings, conditional updates and personal-edit protection |
| Announcements | Local English/Malay extraction, meeting links, evidence/revision review, edited-post detection and bounded pagination |
| Daily use | Independent feature controls/cooldowns, upcoming-seven-days panel, recent changes and pause/resume |
| Privacy | Feature-scoped Google consent, trusted state, fresh Spectrum-session identity checks, optional AI disclosure and sanitised ZIP links |
| Distribution | Public OAuth configuration utility, bundled setup guide and release packaging of shared/background modules |

The existing exporter/backend changes present before implementation were retained.

## Verification

Run **node --test tests/*.test.cjs**. The suite exercises actual pure rules, worker/account boundaries, simulated Google HTTP operations and the actual bundled JSZip exporter.

Final local run: **130 tests passed, zero failures**. JavaScript syntax and release archive/source consistency checks also passed.

Local Chrome checks additionally render the real modal/popup and process simulated Spectrum DOM pages. They check local announcement discovery/review, selected-course persistence, unavailable Google configuration, and browser script errors. These are simulated pages, not a live Spectrum session.

The compact interface was also measured in installed Chrome at 1366×768, 1024×600 and 390×700, with a 380×580 popup. Paged course/material/date/review lists, nested Settings tabs, video preference persistence, custom reminders and unsaved-setting safeguards passed with zero overflow.

The restored Dino passed 20 browser lifecycle/layout checks, including actual fixture ZIP generation, jump controls, cancellation/restart, delayed/failed sprite loading and completion. Another 21 resize/keyboard checks passed. The popup context handshake has producer/consumer regression checks. Live user Chrome was unavailable through computer use; these browser checks used isolated fixture profiles.

## Required external setup and pilot

Public Google OAuth configuration is installed for project `umspec-512615` and extension `jgmbmmehegapkmfghabafemghldhbjgf`. The supplied extension public key was checked against that ID. The downloaded client configuration was not copied into the extension.

Follow [Google setup](GOOGLE_SETUP.md) to confirm enabled APIs, consent scopes and test users, reload UM Spec, and complete the authenticated pilot before general distribution. Live Google consent and access remain unverified.

Still unverified against live services:

- Spectrum's current-user menu and authenticated worker file downloads.
- Deployed file revision metadata, monthly-calendar JSON and announcement pagination/layout.
- Google consent, UM-managed account restrictions, real uploads/checksums and conditional event writes.
- Recovery after actual Chrome worker termination and multi-tab account changes.
- Google authentication compatibility on Edge/Brave; existing ZIP support remains available.

## Deliberate initial limits

- One writer per browser profile; simultaneous first sync from several devices requires review if duplicate mappings are detected.
- One binary file buffered at a time, up to 50 MiB. Larger files receive source links and a linked-only result.
- Automatic checks require an open, signed-in Spectrum page and explicit feature opt-in.
- Ambiguous dates, unknown meeting duration, personal destination edits and source cancellations require review.
- The extension does not create meetings, send invitations, infer recurring schedules or delete backups on source disappearance.

The source checkout also contains the accepted architecture and detailed plans under docs/superpowers.
