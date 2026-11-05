importScripts("shared.js");
// Background service worker: backfill from browser history, plus storage.
// No data is sent anywhere except the public YouTube oEmbed endpoint,
// used only to learn the channel name for a video id already in history.
// oEmbed needs no key and no sign-in.

const MAX_BACKFILL_OEMBED = 200;

async function getWatches() {
  const data = await chrome.storage.local.get(["watches"]);
  return Array.isArray(data.watches) ? data.watches : [];
}

async function saveWatches(watches) {
  await chrome.storage.local.set({ watches: watches });
}

async function backfill() {
  const existing = await getWatches();
  const knownIds = new Set(existing.map(function (w) { return w.videoId; }));
  const historyItems = await chrome.history.search({
    text: "youtube.com/watch",
    maxResults: 1000,
    startTime: 0
  });
  const candidates = [];
  const seen = new Set();
  historyItems.forEach(function (item) {
    if (!item || !item.url) return;
    const videoId = parseVideoId(item.url);
    if (!videoId || seen.has(videoId) || knownIds.has(videoId)) return;
    seen.add(videoId);
    candidates.push({ videoId: videoId, title: item.title || videoId, url: "https://www.youtube.com/watch?v=" + videoId, watchedAt: item.lastVisitTime || Date.now() });
  });

  const resolved = [];
  for (const candidate of candidates.slice(0, MAX_BACKFILL_OEMBED)) {
    try {
      const res = await fetch("https://www.youtube.com/oembed?url=" + encodeURIComponent(candidate.url) + "&format=json");
      if (!res.ok) continue;
      const info = await res.json();
      const channel = channelFromAuthorUrl(info.author_url || "");
      resolved.push(Object.assign({}, candidate, {
        title: info.title || candidate.title,
        thumbnail: info.thumbnail_url || candidate.thumbnail || null,
        channelName: info.author_name || null,
        channelHandle: channel && channel.handle ? channel.handle : null,
        channelId: channel && channel.channelId ? channel.channelId : null,
        channelUrl: channel ? channel.url : null,
        source: "history"
      }));
    } catch (e) {
      // Keep the video without channel info rather than dropping it.
      // It will not show on a channel page until its channel is known,
      // but a later forward watch of the same video will fill it in.
      resolved.push(Object.assign({}, candidate, { source: "history" }));
    }
  }
  const merged = dedupeWatches(existing.concat(resolved));
  await saveWatches(merged);
  await chrome.storage.local.set({ backfilledAt: Date.now() });
  return { added: resolved.length, total: merged.length };
}

chrome.runtime.onInstalled.addListener(function () {
  backfill().catch(function () {});
});

chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  if (!message || !message.type) return;
  if (message.type === "ytch-get-watches") {
    getWatches().then(function (watches) {
      sendResponse({ watches: filterByChannel(watches, message.channel || null) });
    });
    return true;
  }
  if (message.type === "ytch-record-watch") {
    const watch = message.watch;
    if (!watch || !watch.videoId) { sendResponse({ ok: false }); return; }
    getWatches().then(function (watches) {
      const merged = dedupeWatches(watches.concat([Object.assign({}, watch, { source: "watch" })]));
      return saveWatches(merged).then(function () { sendResponse({ ok: true }); });
    });
    return true;
  }
  if (message.type === "ytch-backfill") {
    backfill().then(function (result) { sendResponse({ ok: true, result: result }); })
      .catch(function (e) { sendResponse({ ok: false, error: String(e && e.message || e) }); });
    return true;
  }
  if (message.type === "ytch-clear") {
    chrome.storage.local.set({ watches: [] }).then(function () { sendResponse({ ok: true }); });
    return true;
  }
});
