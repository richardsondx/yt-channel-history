const assert = require("assert");
const lib = require("../src/shared.js");

const demoChannel = { channelId: null, handle: "DemoChannel", url: "https://www.youtube.com/@DemoChannel" };
const demoChannelWithCanonicalId = { channelId: "UC123", handle: "DemoChannel", url: "https://www.youtube.com/channel/UC123" };
const otherChannel = { channelId: null, handle: "OtherChannel", url: "https://www.youtube.com/@OtherChannel" };
const watches = [
  { videoId: "aaa", title: "Demo one", url: "https://www.youtube.com/watch?v=aaa", channelHandle: "DemoChannel", watchedAt: 1000 },
  { videoId: "bbb", title: "Other one", url: "https://www.youtube.com/watch?v=bbb", channelHandle: "OtherChannel", watchedAt: 2000 },
  { videoId: "aaa", title: "Demo one old", url: "https://www.youtube.com/watch?v=aaa", channelHandle: "DemoChannel", watchedAt: 500 },
  { videoId: "ccc", title: "Demo two", url: "https://www.youtube.com/watch?v=ccc", channelHandle: "demochannel", watchedAt: 3000 },
];

// Parsing
assert.strictEqual(lib.parseVideoId("https://www.youtube.com/watch?v=aaa&x=1"), "aaa");
assert.strictEqual(lib.parseVideoId("https://www.youtube.com/shorts/xyz123"), "xyz123");
assert.strictEqual(lib.parseVideoId("https://www.youtube.com/embed/qqq"), "qqq");
assert.strictEqual(lib.parseVideoId("https://example.com/"), null);
assert.strictEqual(lib.isYouTubeWatchUrl("https://www.youtube.com/watch?v=aaa"), true);
assert.strictEqual(lib.isYouTubeWatchUrl("https://www.youtube.com/@DemoChannel"), false);

// Channel matching, case and @ handling
assert.deepStrictEqual(lib.channelFromUrl("https://www.youtube.com/@DemoChannel"), { channelId: null, handle: "DemoChannel", url: "https://www.youtube.com/@DemoChannel" });
assert.deepStrictEqual(lib.channelFromUrl("https://www.youtube.com/channel/UC123"), { channelId: "UC123", handle: null, url: "https://www.youtube.com/channel/UC123" });

// Filter: only demo channel, other channel excluded
const filtered = lib.filterByChannel(watches, demoChannel);
assert.strictEqual(filtered.length, 3, "filter should keep demo watches, including the duplicate id before dedupe");
assert.strictEqual(lib.filterByChannel([
  { videoId: "backfilled", channelHandle: "DemoChannel", channelId: null }
], demoChannelWithCanonicalId).length, 1, "page id plus handle must match handle-only backfill records");
const imported = lib.parseTakeoutWatchHistory([
  {
    title: "Watched Demo video",
    titleUrl: "https://www.youtube.com/watch?v=takeout123",
    subtitles: [{ name: "DemoChannel", url: "https://www.youtube.com/@DemoChannel" }],
    time: "2026-11-04T12:30:00Z"
  },
  {
    title: "Watched Demo video",
    titleUrl: "https://www.youtube.com/watch?v=takeout123&t=10s",
    subtitles: [{ name: "DemoChannel", url: "https://www.youtube.com/channel/UC123" }],
    time: "2026-11-05T12:30:00Z"
  },
  { title: "Watched page without a video id", titleUrl: "https://www.youtube.com/" }
]);
assert.strictEqual(imported.length, 1, "Takeout import deduplicates repeated watch events by video");
assert.strictEqual(imported[0].watchedAt, Date.parse("2026-11-05T12:30:00Z"), "Takeout keeps the newest watch date");
assert.strictEqual(imported[0].channelId, "UC123", "Takeout preserves channel ids");
assert.strictEqual(imported[0].channelHandle, "DemoChannel", "dedupe preserves handle when id is also present");
assert.strictEqual(lib.filterByChannel(imported, demoChannelWithCanonicalId).length, 1);
assert.throws(function () { lib.parseTakeoutWatchHistory({}); }, /array/);
assert.ok(!filtered.some(function (w) { return w.videoId === "bbb"; }), "other channel must not leak in");
assert.strictEqual(lib.filterByChannel(watches, otherChannel).length, 1);

// Dedupe keeps newest, sorting is newest first
const deduped = lib.dedupeWatches(filtered);
assert.strictEqual(deduped.length, 2);
assert.strictEqual(deduped.find(function (w) { return w.videoId === "aaa"; }).watchedAt, 1000);
const sorted = lib.sortWatchesDesc(deduped);
assert.strictEqual(sorted[0].videoId, "ccc");
assert.strictEqual(sorted[1].videoId, "aaa");

// Rendering: titles escaped, other channel title absent, empty state present
const html = lib.renderWatchListHtml(filtered);
assert.ok(html.includes("Demo one") && html.includes("Demo two"));
assert.ok(!html.includes("Other one"), "render must not include other channel");
const escaped = lib.renderWatchListHtml([{ videoId: "x", title: "<script>alert(1)</script>", channelHandle: "DemoChannel", watchedAt: 1 }]);
assert.ok(!escaped.includes("<script>alert"));
assert.ok(lib.renderWatchListHtml([]).includes("No saved watched videos"));

// Grid rendering: same layout as a channel grid, watched date as metadata
const grid = lib.renderWatchGridHtml(filtered);
assert.ok(grid.includes("ytch-grid") && grid.includes("Demo one") && grid.includes("Demo two"));
assert.ok(grid.includes("Watched") && !grid.includes("Other one"));
assert.ok(!lib.renderWatchGridHtml(filtered).includes("<script>alert"));
assert.ok(lib.renderWatchGridHtml([]).includes("No saved watched videos"));

// Repair: a later record with a channel fills in an earlier record without one,
// and a progress scan with no date does not overwrite a stored watched date.
const noChannel = { videoId: "zzz", title: "No channel yet", channelHandle: null, watchedAt: 1000 };
const withChannel = { videoId: "zzz", title: "No channel yet", channelHandle: "DemoChannel", watchedAt: 1000 };
assert.strictEqual(lib.dedupeWatches([noChannel, withChannel])[0].channelHandle, "DemoChannel");
const merged = lib.mergeWatches(
  [{ videoId: "scan1", title: "Scanned", channelHandle: "DemoChannel", watchedAt: 5000 }],
  [{ videoId: "scan1", title: "Scanned", channelHandle: "DemoChannel", watchedAt: null }]
);
assert.strictEqual(merged[0].watchedAt, 5000);
const gridNoDate = lib.renderWatchGridHtml([{ videoId: "scan1", title: "Scanned", channelHandle: "DemoChannel", watchedAt: null }]);
assert.ok(gridNoDate.includes("Watched") && !gridNoDate.includes("Watched Invalid"));

console.log("All tests passed: parsing, channel match, Takeout import, filter, dedupe, sort, rendering, grid rendering, escaping.");
