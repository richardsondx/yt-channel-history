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
    if (!existing || (w.watchedAt || 0) > (existing.watchedAt || 0)) byId.set(w.videoId, w);
  });
  return Array.from(byId.values());
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
    return '<div class="ytch-empty">No watched videos from this channel yet. Watch a video here and it will show up in this list.</div>';
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
    sortWatchesDesc: sortWatchesDesc,
    escapeHtml: escapeHtml,
    formatWatchedDate: formatWatchedDate,
    renderWatchListHtml: renderWatchListHtml
  };
}
