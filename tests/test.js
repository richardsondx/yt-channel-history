const assert = require("assert");
const lib = require("../src/shared.js");

const demoChannel = { channelId: null, handle: "DemoChannel", url: "https://www.youtube.com/@DemoChannel" };
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
assert.ok(lib.renderWatchListHtml([]).includes("No watched videos"));

// Grid rendering: same layout as a channel grid, watched date as metadata
const grid = lib.renderWatchGridHtml(filtered);
assert.ok(grid.includes("ytch-grid") && grid.includes("Demo one") && grid.includes("Demo two"));
assert.ok(grid.includes("Watched") && !grid.includes("Other one"));
assert.ok(!lib.renderWatchGridHtml(filtered).includes("<script>alert"));
assert.ok(lib.renderWatchGridHtml([]).includes("No watched videos"));

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

console.log("All tests passed: parsing, channel match, filter, dedupe, sort, rendering, grid rendering, escaping.");
