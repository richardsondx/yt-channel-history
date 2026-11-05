// Content script: injects a History button on channel Videos pages,
// and records a watch when a video page loads.
(function () {
  if (window.__ytchInstalled) return;
  window.__ytchInstalled = true;

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

  function findSortBar() {
    // YouTube shows Latest, Popular, Oldest as chips on a channel Videos page.
    // Find their container, so History sits beside them, as in the request.
    const chips = Array.from(document.querySelectorAll("*")).filter(function (el) {
      return el.children.length === 0 && /^(Latest|Popular|Oldest)$/.test((el.textContent || "").trim());
    });
    if (chips.length === 0) return null;
    let node = chips[0];
    for (let i = 0; i < 5 && node && node.parentElement; i++) {
      node = node.parentElement;
      if (node.querySelectorAll("*").length > 20) break;
    }
    return node;
  }

  function findGrid() {
    return document.querySelector("ytd-rich-grid-renderer, #contents, ytd-browse");
  }

  function closePanel() {
    const existing = document.getElementById("ytch-history-panel");
    if (existing) existing.remove();
    const btn = document.getElementById("ytch-history-button");
    if (btn) btn.classList.remove("ytch-active");
  }

  async function openPanel(channel) {
    closePanel();
    const grid = findGrid();
    if (!grid) return;
    const panel = document.createElement("div");
    panel.id = "ytch-history-panel";
    panel.innerHTML = '<div class="ytch-heading"><span>History on this channel</span><button class="ytch-close" type="button">Back to videos</button></div><div class="ytch-body">Loading watched videos...</div>';
    panel.querySelector(".ytch-close").addEventListener("click", closePanel);
    grid.parentElement.insertBefore(panel, grid);
    try {
      const res = await chrome.runtime.sendMessage({ type: "ytch-get-watches", channel: channel });
      const watches = (res && res.watches) || [];
      panel.querySelector(".ytch-body").innerHTML = renderWatchListHtml(watches);
    } catch (e) {
      panel.querySelector(".ytch-body").textContent = "Could not load watched videos. Reload the page and try again.";
    }
  }

  function inject() {
    if (!isChannelVideosPage()) return;
    if (document.getElementById("ytch-history-button")) return;
    const channel = getChannelFromPage();
    const sortBar = findSortBar();
    const button = document.createElement("button");
    button.id = "ytch-history-button";
    button.type = "button";
    button.textContent = "History";
    button.addEventListener("click", function () {
      if (document.getElementById("ytch-history-panel")) { closePanel(); return; }
      button.classList.add("ytch-active");
      openPanel(channel);
    });
    if (sortBar) {
      sortBar.appendChild(button);
    } else {
      const grid = findGrid();
      if (grid && grid.parentElement) grid.parentElement.insertBefore(button, grid);
    }
  }

  function recordWatchIfNeeded() {
    if (!isWatchPage()) return;
    const videoId = parseVideoId(window.location.href);
    if (!videoId) return;
    const titleEl = document.querySelector("h1 yt-formatted-string, h1");
    const channelLink = document.querySelector("ytd-channel-name a, #channel-name a");
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
    inject();
    recordWatchIfNeeded();
  }

  run();
  window.addEventListener("yt-navigate-finish", function () { setTimeout(run, 500); });
  // Fallback for navigation without the YouTube event.
  let lastUrl = window.location.href;
  setInterval(function () {
    if (window.location.href !== lastUrl) { lastUrl = window.location.href; setTimeout(run, 500); }
  }, 1000);
})();
