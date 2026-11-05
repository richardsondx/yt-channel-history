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

function parseTakeoutWatchHistory(entries) {
  if (!Array.isArray(entries)) throw new Error("The selected file must contain a Google Takeout YouTube history array.");
  const watches = [];
  entries.forEach(function (entry) {
    if (!entry || typeof entry !== "object") return;
    const videoId = parseVideoId(entry.titleUrl || "");
    if (!videoId) return;
    const subtitle = Array.isArray(entry.subtitles) ? entry.subtitles.find(function (item) {
      return item && typeof item.url === "string";
    }) : null;
    const channel = subtitle ? channelFromUrl(subtitle.url) : null;
    const title = String(entry.title || "").replace(/^Watched\s+/i, "").trim();
    const watchedAt = entry.time ? Date.parse(entry.time) : null;
    watches.push({
      videoId: videoId,
      title: title || videoId,
      url: "https://www.youtube.com/watch?v=" + videoId,
      thumbnail: "https://i.ytimg.com/vi/" + videoId + "/mqdefault.jpg",
      channelName: subtitle ? subtitle.name || null : null,
      channelHandle: channel && channel.handle ? channel.handle : null,
      channelId: channel && channel.channelId ? channel.channelId : null,
      channelUrl: channel ? channel.url : (subtitle ? subtitle.url : null),
      watchedAt: Number.isFinite(watchedAt) ? watchedAt : null,
      source: "takeout"
    });
  });
  return dedupeWatches(watches);
}

function watchMatchesChannel(watch, channel) {
  if (!watch || !channel) return false;
  if (channel.channelId && watch.channelId && watch.channelId === channel.channelId) return true;
  if (channel.handle && watch.channelHandle && normalizeKey(watch.channelHandle) === normalizeKey(channel.handle)) return true;
  if (channel.handle && watch.channelUrl) {
    const fromUrl = channelFromUrl(watch.channelUrl);
    if (fromUrl && fromUrl.handle && normalizeKey(fromUrl.handle) === normalizeKey(channel.handle)) return true;
  }
  return false;
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
    // Preserve useful identity fields from both sources (oEmbed often has
    // only a handle, while Takeout has a channel id) and keep the latest date.
    const combined = Object.assign({}, existing, w);
    ["channelName", "channelHandle", "channelId", "channelUrl", "thumbnail"].forEach(function (key) {
      if (!w[key]) combined[key] = existing[key] || null;
    });
    if (!w.title || w.title === w.videoId) combined.title = existing.title || w.title;
    if (!w.watchedAt || (existing.watchedAt && existing.watchedAt > w.watchedAt)) combined.watchedAt = existing.watchedAt || null;
    byId.set(w.videoId, combined);
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
    return '<div class="ytch-empty">No saved watched videos were found for this channel. If you watched on another device or cleared browser history, import your YouTube watch-history.json from Google Takeout in the extension popup.</div>';
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
    return '<div class="ytch-empty">No saved watched videos were found for this channel. If you watched on another device or cleared browser history, import your YouTube watch-history.json from Google Takeout in the extension popup.</div>';
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
    parseTakeoutWatchHistory: parseTakeoutWatchHistory,
    watchMatchesChannel: watchMatchesChannel,
    filterByChannel: filterByChannel,
    dedupeWatches: dedupeWatches,
    mergeWatches: mergeWatches,
    sortWatchesDesc: sortWatchesDesc,
    escapeHtml: escapeHtml,
    formatWatchedDate: formatWatchedDate,
    renderWatchListHtml: renderWatchListHtml,
    renderWatchGridHtml: renderWatchGridHtml
  };
}
