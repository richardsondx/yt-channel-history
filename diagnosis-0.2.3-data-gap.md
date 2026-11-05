# Diagnosis, v0.2.3, MrMorj empty state

Date: 2026-11-05
Version tested: 0.2.3, popup confirmed, History in native chip row, Latest restores the original grid.
Logs on History click, MrMorj:
- History clicked, grid items on page: 180, scanned watched: 0
- stored for channel: 0, merged: 0
- DOM scan: 0 .ytThumbnailOverlayProgressBarHostWatchedProgressBarSegment across 180 loaded videos, after scrolling several batches.
- User confirms they have watched MrMorj videos.

## What is working
Chip placement and sort restore, from the 0.2.3 fix, are verified. History is in the native row, clicking it hides the original grid, Latest brings it back. The empty state is the correct output for the inputs it received: 0 scanned plus 0 stored equals 0 merged. Rendering is not the bug. The data sources are.

## Gap 1: channel identity mismatch, reproduced in code
`getChannelFromPage` in src/content.js returns the canonical link first. Codex confirmed the canonical for MrMorj is https://www.youtube.com/channel/UCvohL2eaDa7TAImOJaYl5dQ, so the page channel is { channelId: UCvohL2eaDa7TAImOJaYl5dQ, handle: null }.
Backfill in src/background.js resolves a video with oEmbed. oEmbed author_url is https://www.youtube.com/@MrMorj, so a stored watch is { channelHandle: MrMorj, channelId: null }.
`watchMatchesChannel` in src/shared.js only matches when both sides have the same id, or both have the same handle. It never matches an id-only page channel against a handle-only stored watch.
Reproduced in Node with shared.js: pageChannel id-only, stored handle-only, watchMatchesChannel returns false, filterByChannel returns 0.
This means stored MrMorj videos can exist in local storage, with a total count like the 309 seen earlier, and still filter to 0 for this channel. The same split affects any channel where one source gives an id and the other gives a handle.

## Gap 2: progress scan is not a complete source
README says the channel grid scan is the most complete source, because it uses YouTube's own watched markers. That claim does not hold for this account on MrMorj.
- 0 progress segments across 180 loaded videos, after scrolling, while the user confirms they watched videos from this channel.
- A progress marker is a visual rendering choice by YouTube, not a history record. It depends on signed-in state, watch history being on, the video being watched in a way YouTube marks, and the marker being rendered for the loaded batch. It is not guaranteed, it is not complete, and it only covers videos currently loaded in the DOM, not the full 774 videos on the channel.
- AI Explained (6 scanned) and Matthew Berman (2 scanned) prove the parser works when markers exist. MrMorj proves markers can be absent even when the user watched the videos.

## Gap 3: browser history backfill cannot be complete
Backfill in src/background.js reads chrome.history.search for youtube.com/watch, max 1000, startTime 0.
Constraints, stated plainly:
- Chrome history is about 90 days, this browser profile only, this device only. Videos watched on phone, TV, or another browser are not in it.
- It runs only on install, in chrome.runtime.onInstalled. Reloading an unpacked extension does not reliably re-run it, and re-loading unpacked can clear storage.
- oEmbed gives a handle, not an id, which feeds Gap 1.
- The popup has a Run backfill button, but there is no status shown for whether backfill ever ran, how many it found, or whether the stored total is 0 or 309. That total and the last backfill time are the first diagnostic to check.

## Best legitimate complete source: Google Takeout
YouTube watch history belongs to the user, and Google lets them download it.
- Path: takeout.google.com, or myaccount.google.com, Data and privacy, Download your data, select YouTube and YouTube Music, Watch history. Export format watch-history.json, or watch-history.html.
- watch-history.json entries have title, titleUrl with the video id, time with the watched date, and subtitles with the channel name and channel url, usually https://www.youtube.com/channel/UC..., which is the id. That gives the id that matches the canonical on the channel page, and the date, for every watched video, not only loaded grid items, not only this browser.
- Constraints: the user must request the export themselves, it can take minutes to hours for Google to prepare it, the file is downloaded to their machine, and the extension cannot fetch it automatically. There is no Takeout API to call, and no OAuth flow in the extension should be added for this. The import must be a local file read in the popup, with no upload and no server.
- This is the most efficient complete source: one file, complete, with dates and channel ids, no API key, no sign-in inside the extension.

## Other sources, ranked
- YouTube History feed, https://www.youtube.com/feed/history: live and signed in, but it is a paginated infinite scroll page, layout changes often, and it only covers what the user scrolls back through. Useful as a secondary supplement, not as the complete source.
- YouTube Data API v3: not recommended first. It needs a Google Cloud project, OAuth with youtube scope, quota, and access to the watch history playlist is restricted. Heavy, fragile, and it changes the no sign-in, no key promise in the README.
- Browser history, improved: useful as a supplement only. Run backfill on startup as well as on install, show its status, and keep the 1000 cap stated. It will never cover phone or TV watches.

## Minimal safe implementation plan, no push yet
1. Fix channel identity first. Change getChannelFromPage to return both handle from the page URL and id from the canonical, and store a handle to id mapping in chrome.storage.local built from canonical, URL, oEmbed, and Takeout. Change watchMatchesChannel to match on id, handle, or channel url, and add a console diagnostic that logs stored total, a sample stored record, and the page channel with both fields, so a future 0 can be told apart from a filter bug.
2. Add Takeout import in the popup only. A file picker for watch-history.json, parsed locally in the browser, no network call. Map titleUrl to videoId, time to watchedAt, subtitles[0].name to channelName, subtitles[0].url to channelId and channelUrl. Dedupe against stored watches, store locally, report imported, new, total, and per-channel counts. No data leaves the browser.
3. Make backfill visible and repeatable. Run it on startup as well as on install, keep the popup button, and show stored total, last backfill time, and last import time in the popup.
4. Change the empty state. When merged is 0, say why: no watched videos found in this browser or in the progress markers on this page, and offer Import from Takeout, with a link to takeout.google.com. Do not say watch a video here, that is not a fix for a historical list.
5. Keep the grid scan as a supplement. It already works when markers exist, and it can add new watches without a Takeout file. Do not present it as the complete source in the README.

## Real page test plan, before any push
Use real Chrome, signed in, with a test build, not a pushed version.
1. Diagnostic first, before code: open the popup, record stored total and last backfill time. In DevTools, run chrome.storage.local.get and record a sample stored record for a MrMorj video, if any, with its channelHandle and channelId fields. Record whether the MrMorj watches were on this Chrome profile, phone, or TV.
2. Test the identity fix alone: with stored handle-only records present, click History on MrMorj, record the new console lines, stored for channel should be greater than 0 if those records exist, and the grid should show them.
3. Test Takeout import with a small sample first: create a watch-history.json with 3 known MrMorj videos, import it, confirm popup total increases by 3, click History, confirm those 3 appear with the correct dates, and no duplicates appear after importing the same file again.
4. Test a full Takeout import: import the real file, click History on MrMorj, AI Explained, and Matthew Berman, record scanned, stored, merged for each, confirm MrMorj now shows videos, AI Explained and Matthew do not duplicate scan results, and Latest restores the original grid on each channel.
5. Test privacy: confirm no network request is made during import, except the existing oEmbed backfill path, and confirm the Takeout file is never uploaded.
Acceptance: MrMorj History shows videos with dates that match the Takeout file, no duplicates, Latest restores, and the same test passes on AI Explained and Matthew Berman. Do not push or claim success until those real page results are recorded.
