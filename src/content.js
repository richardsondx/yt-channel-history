// Content script: injects a History chip on channel Videos pages, and
// records a watch when a video page loads.
//
// History works like Latest, Popular, and Oldest: the chip sits in the
// same chip row, it looks selected when it is on, and clicking it replaces
// the grid below with the watched videos, in the same grid layout.
// Clicking Latest, Popular, Oldest, or History again restores the grid.
(function () {
  if (window.__ytchInstalled) return;
  window.__ytchInstalled = true;

  var state = {
    active: false,
    savedContents: null,
    savedChip: null,
    lastUrl: window.location.href
  };

  function getChannelFromPage() {
    const canonical = document.querySelector('link[rel="canonical"]');
    const fromCanonical = canonical ? channelFromUrl(canonical.getAttribute("href") || "") : null;
    if (fromCanonical) return fromCanonical;
    return channelFromUrl(window.location.href);
  }

  function isChannelVideosPage() {
    const path = window.location.pathname;
    return /\/@[^/]+\/videos$/.test(path) || /\/channel\/[^/]+\/videos$/.test(path);
  }

  function isWatchPage() {
    return window.location.pathname === "/watch" && !!parseVideoId(window.location.href);
  }

  function findChipBar() {
    // Real YouTube markup, from a channel Videos page: a button with
    // aria-label="Latest" inside a [role="tablist"] chip bar. The tablist,
    // not the first chip's wrapper, is the container to append to.
    // Appending to the wrapper is what put History on a second row.
    const latest = document.querySelector('button[aria-label="Latest"]');
    if (latest) return latest.closest('[role="tablist"]');
    return null;
  }

  function findContents() {
    // #contents is the grid items container, inside the grid renderer
    // and below the chip bar header. Never replace the renderer itself,
    // or the chip bar would be replaced with the grid.
    return document.querySelector('ytd-rich-grid-renderer #contents') ||
      document.querySelector('#contents');
  }

  function sortChipButtons() {
    return Array.from(document.querySelectorAll('button[aria-label="Latest"], button[aria-label="Popular"], button[aria-label="Oldest"]'));
  }

  function setChip(button, active) {
    if (!button) return;
    button.setAttribute("aria-selected", active ? "true" : "false");
    const inner = button.querySelector(".ytChipShapeChip");
    if (inner) {
      inner.classList.toggle("ytChipShapeActive", active);
      inner.classList.toggle("ytChipShapeInactive", !active);
    }
    button.classList.toggle("ytch-active", active);
  }

  function scanWatchedFromGrid(channel) {
    // YouTube itself marks watched videos on the channel page, with a
    // red progress bar on the thumbnail. That is the most reliable
    // watched list for this channel: it is synced to the signed-in
    // account, so it includes videos watched on another device, and it
    // needs no browser history and no lookup. Scan the grid that is
    // currently on screen, before it is replaced by the History grid.
    const contents = findContents();
    if (!contents || !channel) return [];
    const items = contents.querySelectorAll("ytd-rich-item-renderer, ytd-grid-video-renderer");
    const watched = [];
    items.forEach(function (item) {
      const progress = item.querySelector("ytd-thumbnail-overlay-resume-playback-renderer, #progress, [id='progress']");
      const hasProgress = !!progress || /resume-playback/i.test(item.innerHTML || "");
      if (!hasProgress) return;
      const link = item.querySelector('a#thumbnail, a[href*="/watch?v="]');
      if (!link) return;
      const videoId = parseVideoId(link.getAttribute("href") || "");
      if (!videoId) return;
      const titleEl = item.querySelector("#video-title, h3 a, #video-title-link");
      const img = item.querySelector("img");
      watched.push({
        videoId: videoId,
        title: titleEl ? titleEl.textContent.trim() : videoId,
        url: "https://www.youtube.com/watch?v=" + videoId,
        thumbnail: img ? (img.getAttribute("src") || "") : ("https://i.ytimg.com/vi/" + videoId + "/mqdefault.jpg"),
        channelName: null,
        channelHandle: channel.handle || null,
        channelId: channel.channelId || null,
        channelUrl: channel.url || null,
        watchedAt: null,
        source: "channel-grid"
      });
    });
    return watched;
  }

  function closeHistory(restoreSelected) {
    if (!state.active) return;
    const contents = findContents();
    if (contents && state.savedContents !== null) contents.innerHTML = state.savedContents;
    const btn = document.getElementById("ytch-history-button");
    setChip(btn, false);
    if (restoreSelected) setChip(state.savedChip, true);
    state.active = false;
    state.savedContents = null;
    state.savedChip = null;
  }

  async function openHistory(channel) {
    const contents = findContents();
    if (!contents) return;
    // Scan first, while the original grid is still on screen.
    const scanned = scanWatchedFromGrid(channel);
    state.savedContents = contents.innerHTML;
    state.savedChip = sortChipButtons().find(function (b) { return b.getAttribute("aria-selected") === "true"; }) || null;
    state.active = true;
    const btn = document.getElementById("ytch-history-button");
    setChip(btn, true);
    sortChipButtons().forEach(function (b) { setChip(b, false); });
    contents.innerHTML = '<div class="ytch-grid-loading">Loading watched videos...</div>';
    try {
      const res = await chrome.runtime.sendMessage({ type: "ytch-get-watches", channel: channel });
      const stored = filterByChannel((res && res.watches) || [], channel);
      const watches = mergeWatches(stored, scanned);
      if (scanned.length) {
        // Save what the grid just proved was watched, so the next
        // History open finds it even if the grid has not loaded yet.
        chrome.runtime.sendMessage({ type: "ytch-import-watches", watches: scanned }).catch(function () {});
      }
      if (state.active) contents.innerHTML = renderWatchGridHtml(watches);
    } catch (e) {
      if (state.active) contents.innerHTML = renderWatchGridHtml(scanned);
    }
  }

  function inject() {
    if (!isChannelVideosPage()) return;
    if (document.getElementById("ytch-history-button")) return;
    // The chip is missing, which means YouTube re-rendered the chip
    // bar, for example after a Latest, Popular, or Oldest click. That
    // re-render also replaced the grid, so any saved History grid is
    // stale and must not be restored over the new sort. Reset first,
    // then re-create the chip in the new chip bar.
    state.active = false;
    state.savedContents = null;
    state.savedChip = null;
    const channel = getChannelFromPage();
    const chipBar = findChipBar();

    // Capture listeners on the real sort chips: run before YouTube's own
    // handlers, so the original grid is restored first, then YouTube
    // loads its own sort in place.
    sortChipButtons().forEach(function (b) {
      if (b.dataset.ytchBound) return;
      b.dataset.ytchBound = "1";
      b.addEventListener("click", function () { closeHistory(false); }, true);
    });

    if (chipBar) {
      const wrapper = document.createElement("div");
      wrapper.setAttribute("role", "presentation");
      wrapper.className = "ytChipBarViewModelChipWrapper";
      const viewModel = document.createElement("chip-view-model");
      viewModel.className = "ytChipViewModelHost";
      viewModel.setAttribute("role", "presentation");
      const shape = document.createElement("chip-shape");
      shape.className = "ytChipShapeHost";
      shape.setAttribute("role", "presentation");
      const button = document.createElement("button");
      button.id = "ytch-history-button";
      button.type = "button";
      button.className = "ytChipShapeButtonReset";
      button.setAttribute("role", "tab");
      button.setAttribute("aria-label", "History");
      button.setAttribute("aria-selected", "false");
      const chip = document.createElement("div");
      chip.className = "ytChipShapeChip ytChipShapeInactive ytChipShapeOnlyTextPadding";
      const text = document.createElement("div");
      text.className = "ytChipShapeText";
      text.textContent = "History";
      chip.appendChild(text);
      button.appendChild(chip);
      shape.appendChild(button);
      viewModel.appendChild(shape);
      wrapper.appendChild(viewModel);
      chipBar.appendChild(wrapper);
      button.addEventListener("click", function () {
        if (state.active) { closeHistory(true); return; }
        openHistory(channel);
      });
      return;
    }

    // Fallback, when no YouTube chip bar is found.
    const button = document.createElement("button");
    button.id = "ytch-history-button";
    button.type = "button";
    button.textContent = "History";
    button.addEventListener("click", function () {
      if (state.active) { closeHistory(true); return; }
      openHistory(channel);
    });
    const grid = findContents();
    if (grid && grid.parentElement) grid.parentElement.insertBefore(button, grid);
  }

  function recordWatchIfNeeded() {
    if (!isWatchPage()) return;
    const videoId = parseVideoId(window.location.href);
    if (!videoId) return;
    const titleEl = document.querySelector("h1 yt-formatted-string, h1");
    // YouTube's owner area markup changes often, so try several
    // selectors and take the first link that actually looks like a
    // channel link, not a subscribe button or other action.
    const channelLink = (function () {
      const links = document.querySelectorAll("ytd-video-owner-renderer a, ytd-channel-name a, #channel-name a, #owner a");
      for (let i = 0; i < links.length; i++) {
        const href = links[i].getAttribute("href") || "";
        if (/^\/@[^/]+/.test(href) || /^\/channel\/UC/.test(href) || /^\/(c|user)\//.test(href)) return links[i];
      }
      return null;
    })();
    const channel = channelLink ? channelFromUrl(channelLink.getAttribute("href") || "") : null;
    const watch = {
      videoId: videoId,
      title: titleEl ? titleEl.textContent.trim() : videoId,
      url: "https://www.youtube.com/watch?v=" + videoId,
      thumbnail: "https://i.ytimg.com/vi/" + videoId + "/mqdefault.jpg",
      channelName: channelLink ? channelLink.textContent.trim() : null,
      channelHandle: channel && channel.handle ? channel.handle : null,
      channelId: channel && channel.channelId ? channel.channelId : null,
      channelUrl: channel ? channel.url : null,
      watchedAt: Date.now()
    };
    chrome.runtime.sendMessage({ type: "ytch-record-watch", watch: watch }).catch(function () {});
  }

  function run() {
    // A new page means YouTube already replaced the grid, so stale
    // saved contents must not be restored over it.
    if (window.location.href !== state.lastUrl) {
      state.lastUrl = window.location.href;
      state.active = false;
      state.savedContents = null;
      state.savedChip = null;
    }
    inject();
    recordWatchIfNeeded();
  }

  function startWatchers() {
    // Clicking Latest, Popular, or Oldest does not change the URL and
    // does not fire yt-navigate-finish, but YouTube does replace the
    // chip bar, which deletes the History chip. Watch for that
    // replacement and put History back, without needing a refresh.
    if (typeof MutationObserver !== "undefined" && !window.__ytchObserver) {
      let pending = false;
      window.__ytchObserver = new MutationObserver(function () {
        if (pending) return;
        pending = true;
        setTimeout(function () {
          pending = false;
          if (isChannelVideosPage() && !document.getElementById("ytch-history-button")) run();
        }, 200);
      });
      window.__ytchObserver.observe(document.documentElement, { childList: true, subtree: true });
    }
    let lastUrl = window.location.href;
    setInterval(function () {
      if (window.location.href !== lastUrl) { lastUrl = window.location.href; setTimeout(run, 500); return; }
      if (isChannelVideosPage() && !document.getElementById("ytch-history-button")) run();
    }, 1000);
  }

  run();
  startWatchers();
  window.addEventListener("yt-navigate-finish", function () { setTimeout(run, 500); });
})();
