// Shared pure functions. No browser APIs here, so Node tests can load this file.
// In the extension these functions live on the global scope.

function parseVideoId(url) {
  if (!url || typeof url !== "string") return null;
  try {
    const u = new URL(url, "https://www.youtube.com");
    if (u.searchParams.get("v")) return u.searchParams.get("v");
    const m = u.pathname.match(/^\/(shorts|embed|live|v)\/([^/?#]+)/);
    if (m) return m[2];
    return null;
  } catch (e) {
    return null;
  }
}

function isYouTubeWatchUrl(url) {
  if (!url || typeof url !== "string") return false;
  return url.indexOf("youtube.com/watch") !== -1 && !!parseVideoId(url);
}

function normalizeKey(value) {
  return String(value || "").trim().toLowerCase().replace(/^@/, "");
}

// Channel key from a canonical URL, a handle, or a channel id.
// Returns an object with the pieces we can match on, or null.
function channelFromUrl(url) {
  if (!url || typeof url !== "string") return null;
  try {
    const u = new URL(url, "https://www.youtube.com");
    const path = u.pathname.replace(/\/$/, "");
    let m = path.match(/^\/channel\/(UC[^/?#]+)/);
    if (m) return { channelId: m[1], handle: null, url: "https://www.youtube.com/channel/" + m[1] };
    m = path.match(/^\/@([^/?#]+)/);
    if (m) return { channelId: null, handle: m[1], url: "https://www.youtube.com/@" + m[1] };
    m = path.match(/^\/(c|user)\/([^/?#]+)/);
    if (m) return { channelId: null, handle: m[2], url: "https://www.youtube.com/@" + m[2] };
    return null;
  } catch (e) {
    return null;
  }
}

function channelFromAuthorUrl(authorUrl) {
  // oEmbed author_url looks like https://www.youtube.com/@Handle
  // or https://www.youtube.com/channel/UC...
  return channelFromUrl(authorUrl);
}

function watchMatchesChannel(watch, channel) {
  if (!watch || !channel) return false;
  if (channel.channelId && watch.channelId && watch.channelId === channel.channelId) return true;
  if (channel.handle && watch.channelHandle && normalizeKey(watch.channelHandle) === normalizeKey(channel.handle)) return true;
  // Cross match via channelUrl on either side: a stored record with
  // only a handle can match a page channel with only an id, if the
  // stored channelUrl carries the other piece, and vice versa.
  if (watch.channelUrl) {
    const fromUrl = channelFromUrl(watch.channelUrl);
    if (fromUrl) {
      if (channel.channelId && fromUrl.channelId && fromUrl.channelId === channel.channelId) return true;
      if (channel.handle && fromUrl.handle && normalizeKey(fromUrl.handle) === normalizeKey(channel.handle)) return true;
    }
  }
  if (channel.url) {
    const fromChannelUrl = channelFromUrl(channel.url);
    if (fromChannelUrl) {
      if (watch.channelId && fromChannelUrl.channelId && watch.channelId === fromChannelUrl.channelId) return true;
      if (watch.channelHandle && fromChannelUrl.handle && normalizeKey(watch.channelHandle) === normalizeKey(fromChannelUrl.handle)) return true;
    }
  }
  return false;
}

function combineChannel(a, b) {
  if (!a && !b) return null;
  if (!a) return b;
  if (!b) return a;
  return {
    channelId: a.channelId || b.channelId || null,
    handle: a.handle || b.handle || null,
    url: (a.channelId || b.channelId) ? ("https://www.youtube.com/channel/" + (a.channelId || b.channelId)) : (a.url || b.url || null)
  };
}

function parseTakeoutEntries(entries) {
  // Google Takeout watch-history.json is a JSON array. Each entry has
  // title, titleUrl with the video id, time with the watched date, and
  // subtitles, usually one entry, with the channel name and channel url.
  // Parsed locally, no network, no upload.
  if (!Array.isArray(entries)) return [];
  const out = [];
  entries.forEach(function (e) {
    if (!e || !e.titleUrl) return;
    const videoId = parseVideoId(e.titleUrl);
    if (!videoId) return;
    const watchedAt = e.time ? Date.parse(e.time) : null;
    const sub = Array.isArray(e.subtitles) && e.subtitles[0] ? e.subtitles[0] : null;
    const ch = sub && sub.url ? channelFromUrl(sub.url) : null;
    out.push({
      videoId: videoId,
      title: e.title ? String(e.title).replace(/^Watched\s+/, "") : videoId,
      url: "https://www.youtube.com/watch?v=" + videoId,
      thumbnail: "https://i.ytimg.com/vi/" + videoId + "/mqdefault.jpg",
      channelName: sub && sub.name ? sub.name : null,
      channelHandle: ch && ch.handle ? ch.handle : null,
      channelId: ch && ch.channelId ? ch.channelId : null,
      channelUrl: ch ? ch.url : (sub && sub.url ? sub.url : null),
      watchedAt: watchedAt && !isNaN(watchedAt) ? watchedAt : null,
      source: "takeout"
    });
  });
  return out;
}

function filterByChannel(watches, channel) {
  if (!Array.isArray(watches)) return [];
  if (!channel) return [];
  return watches.filter(function (w) { return watchMatchesChannel(w, channel); });
}

function dedupeWatches(watches) {
  const byId = new Map();
  (watches || []).forEach(function (w) {
    if (!w || !w.videoId) return;
    const existing = byId.get(w.videoId);
    if (!existing) { byId.set(w.videoId, w); return; }
    // Prefer a record that actually knows its channel, and a newer date,
    // so a repair lookup can fill in a channel that was missing before.
    const existingHasChannel = !!(existing.channelHandle || existing.channelId || existing.channelUrl);
    const nextHasChannel = !!(w.channelHandle || w.channelId || w.channelUrl);
    if (nextHasChannel && !existingHasChannel) { byId.set(w.videoId, w); return; }
    if (!nextHasChannel && existingHasChannel) return;
    if ((w.watchedAt || 0) > (existing.watchedAt || 0)) byId.set(w.videoId, w);
  });
  return Array.from(byId.values());
}

function mergeWatches(base, extra) {
  // Keep the stored record when both know the same video, unless the
  // extra record adds a channel or a newer watched date. Dedupe handles
  // the channel preference, but a stored watched date must win over a
  // progress scan that has no date at all.
  const merged = dedupeWatches((base || []).concat(extra || []));
  return merged.map(function (w) {
    const stored = (base || []).find(function (b) { return b && b.videoId === w.videoId; });
    if (stored && stored.watchedAt && !w.watchedAt) return Object.assign({}, w, { watchedAt: stored.watchedAt });
    if (stored && !stored.watchedAt && w.watchedAt) return Object.assign({}, stored, { watchedAt: w.watchedAt });
    return w;
  });
}

function sortWatchesDesc(watches) {
  return (watches || []).slice().sort(function (a, b) { return (b.watchedAt || 0) - (a.watchedAt || 0); });
}

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatWatchedDate(timestamp) {
  if (!timestamp) return "";
  try {
    return new Date(timestamp).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  } catch (e) {
    return "";
  }
}

function renderWatchListHtml(watches) {
  const list = sortWatchesDesc(dedupeWatches(watches));
  if (list.length === 0) {
    return '<div class="ytch-empty">No watched videos found for this channel in this browser or in the progress markers on this page. Import your YouTube watch history from Takeout in the popup to see all of them.</div>';
  }
  const items = list.map(function (w) {
    const thumb = w.thumbnail || ("https://i.ytimg.com/vi/" + w.videoId + "/mqdefault.jpg");
    return '<a class="ytch-item" href="' + escapeHtml(w.url || ("https://www.youtube.com/watch?v=" + w.videoId)) + '">' +
      '<img class="ytch-thumb" src="' + escapeHtml(thumb) + '" alt="" loading="lazy">' +
      '<span class="ytch-meta"><span class="ytch-title">' + escapeHtml(w.title || w.videoId) + '</span>' +
      '<span class="ytch-date">Watched ' + escapeHtml(formatWatchedDate(w.watchedAt)) + '</span></span></a>';
  }).join("");
  return '<div class="ytch-list">' + items + '</div>';
}

function renderWatchGridHtml(watches) {
  const list = sortWatchesDesc(dedupeWatches(watches));
  if (list.length === 0) {
    return '<div class="ytch-empty">No watched videos found for this channel in this browser or in the progress markers on this page. Import your YouTube watch history from Takeout in the popup to see all of them.</div>';
  }
  const items = list.map(function (w) {
    const thumb = w.thumbnail || ("https://i.ytimg.com/vi/" + w.videoId + "/mqdefault.jpg");
    const meta = w.watchedAt ? ("Watched " + formatWatchedDate(w.watchedAt)) : "Watched";
    return '<a class="ytch-grid-item" href="' + escapeHtml(w.url || ("https://www.youtube.com/watch?v=" + w.videoId)) + '">' +
      '<img class="ytch-grid-thumb" src="' + escapeHtml(thumb) + '" alt="" loading="lazy">' +
      '<span class="ytch-grid-title">' + escapeHtml(w.title || w.videoId) + '</span>' +
      '<span class="ytch-grid-meta">' + escapeHtml(meta) + '</span></a>';
  }).join("");
  return '<div class="ytch-grid">' + items + '</div>';
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    parseVideoId: parseVideoId,
    isYouTubeWatchUrl: isYouTubeWatchUrl,
    normalizeKey: normalizeKey,
    channelFromUrl: channelFromUrl,
    channelFromAuthorUrl: channelFromAuthorUrl,
    watchMatchesChannel: watchMatchesChannel,
    filterByChannel: filterByChannel,
    dedupeWatches: dedupeWatches,
    mergeWatches: mergeWatches,
    sortWatchesDesc: sortWatchesDesc,
    escapeHtml: escapeHtml,
    formatWatchedDate: formatWatchedDate,
    renderWatchListHtml: renderWatchListHtml,
    renderWatchGridHtml: renderWatchGridHtml,
    combineChannel: combineChannel,
    parseTakeoutEntries: parseTakeoutEntries
  };
}
