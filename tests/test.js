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

console.log("All tests passed: parsing, channel match, filter, dedupe, sort, rendering, escaping.");
