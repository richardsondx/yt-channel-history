# YouTube Channel History

A Chrome extension that adds a History view to a YouTube channel, so you can see the videos you watched from that channel, in one place.

Open a channel Videos page. Next to Latest, Popular, and Oldest, you will see a History chip, in the same row and at the same size. Click it and it looks selected, and the grid below changes to that channel's watched videos, newest watched first, in the same video layout, with a link back to each video and the date you watched it. Click Latest, Popular, Oldest, or History again to bring the normal grid back.

![History grid, demo data](screenshots/history-panel.png)

![Popup](screenshots/popup.png)

![Empty state, demo data](screenshots/empty-state.png)

Screenshots use demo data, not real watch history. The History grid in the screenshots uses the same grid code and styles as the extension.

## Install, load unpacked

1. Download or clone this repo.
2. Open Chrome, go to `chrome://extensions`.
3. Turn on Developer mode, top right.
4. Click Load unpacked, and pick this folder.
5. Open a YouTube channel Videos page and click History.

No Chrome Web Store listing is included in this repo. Loading unpacked is the install path for now.

## How it works

Three sources, all stored in your browser with `chrome.storage.local`:

- Channel grid scan: when you click History, the extension scans currently loaded thumbnails for YouTube's visible watched progress markers. This is a supplement, not a complete account history; YouTube may omit markers and only loaded videos can be scanned.
- Track forward: when a YouTube video page loads, the extension records the video, its title, and the channel from that page.
- Backfill: the popup has a Run backfill button. It reads your browser history for `youtube.com/watch` pages, up to 1000 items, and looks up the channel for each video with the public YouTube oEmbed endpoint, which needs no key and no sign-in. Backfill runs in batches of 200, up to 1000 lookups per run, and it also re-checks videos already stored without a channel, so a failed lookup is not stuck forever.
- Google Takeout: import `watch-history.json` from the popup for broader account watch history. The file is parsed locally and is not uploaded or sent to a server.

A watch is recorded when a video page loads. It is not measured by how long you watched. That is a known limit, and a watch-time threshold is a possible next step, not part of this version.

If you click Latest, Popular, or Oldest, YouTube replaces the chip bar. The extension watches for that replacement and puts History back in the new chip bar. On channels with a Members only filter, Latest is a dropdown, so History is placed in the same row as Latest, Members only, and Public.

History hides the original video cards and renders the matching watched cards inside YouTube's `#contents` grid container. Clicking a sort restores the original cards and removes the History grid. History matches the page's handle as well as its canonical channel ID, since YouTube backfill lookups often return a handle while canonical links contain only the ID. When you click History, the console logs the grid item count, visible watched scan count, and stored and merged counts with the current `[YTCH 0.2.4]` tag.

## Privacy

Your watched list stays in your browser. There is no account, no server, and no analytics in this extension.

Backfill sends video URLs from local Chrome history to the public YouTube oEmbed endpoint to resolve channel names. Takeout import reads the selected JSON file locally and makes no network requests.

You can clear the stored list at any time from the popup.

Permissions, and why each is needed:

- `storage`: store the watched list in your browser.
- `history`: backfill from browser history, only when you run backfill, and on install.
- Host permission for `youtube.com`: inject the History button on channel pages, and read the channel from a video page you are already viewing.

## Limits, stated plainly

- Backfill is capped by Chrome's retained history and a 1000 item search limit, and covers this Chrome profile only. Grid scan covers loaded cards with visible markers only. For account-wide history, request and download a Google Takeout export yourself, then select its `watch-history.json` file in the popup.
- YouTube can change its page layout. The extension was verified in real Chrome on MrMorj, AI Explained, and Matthew Berman, including History rendering and sort restoration. The Takeout file picker still needs validation with an actual export file.
- Shorts, embeds, and live pages are parsed for a video id where possible, but the main path tested is a standard watch page and a channel Videos page.

## Development

Tests are plain Node, no build step:

```
node tests/test.js
```

The demo page at `demo/channel-mock.html` renders the same chip and grid styles and code with sample data, for screenshots without publishing real watch history.

## Files

- `manifest.json`: Manifest V3, permissions, content script, popup, background worker.
- `src/shared.js`: parsing, channel matching, dedupe, sorting, and rendering. Shared by the extension and the tests.
- `src/content.js`: History chip, grid replacement and restore, and forward watch recording on YouTube pages.
- `src/content.css`: History chip and grid styles.
- `src/background.js`: storage, backfill from browser history, and oEmbed channel lookup.
- `src/popup.html`, `src/popup.js`: Takeout import, count, backfill button, and clear button.
- `src/` icons in `icons/`: extension icons.
- `demo/`: demo channel page and placeholder thumbnails, sample data only.
- `tests/test.js`: parsing, channel match, filter, dedupe, sort, rendering, and escaping.

## License

MIT. See `LICENSE`.
