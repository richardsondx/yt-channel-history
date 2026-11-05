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
    lastUrl: window.location.href,
    lastWatches: [],
    lastChannel: null,
    loading: false
  };

  function getChannelFromPage() {
    const canonical = document.querySelector('link[rel="canonical"]');
    const fromCanonical = canonical ? channelFromUrl(canonical.getAttribute("href") || "") : null;
    const fromPageUrl = channelFromUrl(window.location.href);
    if (!fromCanonical) return fromPageUrl;
    if (!fromPageUrl) return fromCanonical;
    // YouTube's canonical URL is often /channel/UC..., while the current
    // page URL is /@handle. Keep both identities so backfilled records
    // resolved by oEmbed (handle only) still match the page (id only).
    return {
      channelId: fromCanonical.channelId || fromPageUrl.channelId || null,
      handle: fromPageUrl.handle || fromCanonical.handle || null,
      url: fromCanonical.url || fromPageUrl.url
    };
  }

  function isChannelVideosPage() {
    const path = window.location.pathname;
    return /\/@[^/]+\/videos$/.test(path) || /\/channel\/[^/]+\/videos$/.test(path);
  }

  function isWatchPage() {
    return window.location.pathname === "/watch" && !!parseVideoId(window.location.href);
  }

  function buttonByText(text) {
    // Only search buttons in or near the grid header, not the whole
    // document. A whole-document search returns the first "Latest" or
    // "Public" button anywhere, which is often a sidebar, menu, or
    // header button, not the chip bar.
    const scope = document.querySelector("ytd-rich-grid-renderer") || document.body;
    const buttons = Array.from(scope.querySelectorAll("button"));
    return buttons.find(function (b) {
      const t = (b.textContent || "").trim().replace(/\s+/g, " ");
      return t === text || t.indexOf(text + " ") === 0 || t === text + " ∨" || t === text + " ▾";
    }) || null;
  }

  function containerForChipButton(button) {
    if (!button) return null;
    const tablist = button.closest('[role="tablist"]');
    if (tablist) return tablist;
    const chipBar = button.closest("chip-bar-view-model");
    if (chipBar) return chipBar;
    // Walk up to the first ancestor that holds at least two chip-like
    // buttons, so a filter row like Latest, Members only, Public is
    // found even when it is not a tablist.
    let el = button.parentElement;
    for (let i = 0; i < 4 && el; i++) {
      const buttons = el.querySelectorAll("button");
      if (buttons.length >= 2) return el;
      el = el.parentElement;
    }
    return null;
  }

  function findChipBar() {
    // Real YouTube markup, from a channel Videos page: a button with
    // aria-label="Latest" inside a [role="tablist"] chip bar. The tablist,
    // not the first chip's wrapper, is the container to append to.
    // Appending to the wrapper is what put History on a second row.
    const latest = document.querySelector('button[aria-label="Latest"]');
    if (latest) {
      const tablist = latest.closest('[role="tablist"]');
      if (tablist) return tablist;
    }
    // Members only layout: Latest is a dropdown, not a tab, and the
    // chip row is Latest, Members only, Public. Find that row by text,
    // not by aria-label and not by tablist.
    const byText = buttonByText("Latest") || buttonByText("Members only") || buttonByText("Public") || buttonByText("Popular") || buttonByText("Oldest");
    const container = containerForChipButton(byText);
    if (container) return container;
    const anyTablist = document.querySelector('[role="tablist"]');
    if (anyTablist) return anyTablist;
    return null;
  }

  function findContents() {
    // #contents is the grid items container, inside the grid renderer
    // and below the chip bar header. Never replace the renderer itself,
    // or the chip bar would be replaced with the grid.
    // Do NOT fall back to the first #contents in the document: YouTube
    // has many #contents elements, and the first one is usually not
    // the video grid. Only return a #contents that actually holds
    // grid items, or a shadow-root #contents on a grid renderer.
    const renderers = Array.from(document.querySelectorAll("ytd-rich-grid-renderer"));
    for (let i = 0; i < renderers.length; i++) {
      const c = renderers[i].querySelector("#contents") || (renderers[i].shadowRoot ? renderers[i].shadowRoot.querySelector("#contents") : null);
      if (c && c.querySelector("ytd-rich-item-renderer, ytd-grid-video-renderer")) return c;
    }
    for (let i = 0; i < renderers.length; i++) {
      const c = renderers[i].querySelector("#contents") || (renderers[i].shadowRoot ? renderers[i].shadowRoot.querySelector("#contents") : null);
      if (c) return c;
    }
    const all = Array.from(document.querySelectorAll("#contents"));
    for (let i = 0; i < all.length; i++) {
      if (all[i].querySelector("ytd-rich-item-renderer, ytd-grid-video-renderer")) return all[i];
    }
    return null;
  }

  function sortChipButtons() {
    const byAria = Array.from(document.querySelectorAll('button[aria-label="Latest"], button[aria-label="Popular"], button[aria-label="Oldest"]'));
    const byText = ["Latest", "Members only", "Public", "Popular", "Oldest"].map(function (t) { return buttonByText(t); }).filter(Boolean);
    const all = byAria.concat(byText);
    return Array.from(new Set(all));
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
      // Old markup: ytd-thumbnail-overlay-resume-playback-renderer.
      // New markup, from a real channel page: a
      // yt-thumbnail-overlay-progress-bar-view-model with a
      // WatchedProgressBarSegment, width 100% for a fully watched
      // video and 10% for a partly watched one. A segment at 0% is
      // not a watch, so check its width when it is given.
      const segment = item.querySelector(".ytThumbnailOverlayProgressBarHostWatchedProgressBarSegment");
      let hasProgress = false;
      if (segment) {
        const widthText = segment.style && segment.style.width ? segment.style.width : "";
        const width = parseFloat(widthText);
        hasProgress = !widthText || isNaN(width) || width > 0;
      } else {
        const progress = item.querySelector("ytd-thumbnail-overlay-resume-playback-renderer, yt-thumbnail-overlay-progress-bar-view-model, #progress, [id='progress']");
        hasProgress = !!progress || /resume-playback|WatchedProgressBar|progress-bar/i.test(item.innerHTML || "");
      }
      if (!hasProgress) return;
      const links = Array.from(item.querySelectorAll('a#thumbnail, a.ytLockupViewModelContentImage, a[href*="/watch?v="]'));
      let link = null;
      let videoId = null;
      for (let i = 0; i < links.length; i++) {
        const id = parseVideoId(links[i].getAttribute("href") || "");
        if (id) { link = links[i]; videoId = id; break; }
      }
      if (!link || !videoId) return;
      const titleEl = item.querySelector("#video-title, h3 a, .ytLockupMetadataViewModelTitle, #video-title-link");
      const titleText = titleEl ? titleEl.textContent.trim() : (item.querySelector("h3") ? item.querySelector("h3").getAttribute("title") || "" : "");
      const img = item.querySelector("img");
      watched.push({
        videoId: videoId,
        title: titleText || videoId,
        url: "https://www.youtube.com/watch?v=" + videoId,
        thumbnail: img ? (img.getAttribute("src") || img.currentSrc || "") : ("https://i.ytimg.com/vi/" + videoId + "/mqdefault.jpg"),
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

  function historyGridEl() {
    return document.getElementById("ytch-history-grid");
  }

  function findRenderer() {
    return document.querySelector("ytd-rich-grid-renderer") || null;
  }

  function ensureHistoryGrid() {
    let grid = historyGridEl();
    if (grid) return grid;
    grid = document.createElement("div");
    grid.id = "ytch-history-grid";
    // History grid MUST live inside #contents, not outside the
    // renderer. YouTube's custom elements only render slotted
    // children, so a div inserted after ytd-rich-grid-renderer, into
    // its parent custom element, is invisible on a real page, even
    // though it renders in a plain mock. #contents children are
    // rendered, because the grid items live there.
    const contents = findContents();
    if (contents) contents.appendChild(grid);
    else document.body.appendChild(grid);
    return grid;
  }

  function hideOriginalGrid() {
    const contents = findContents();
    if (!contents) return;
    // Hide each original item, do not hide #contents itself, because
    // the History grid lives inside #contents and would be hidden too.
    Array.from(contents.querySelectorAll("ytd-rich-item-renderer, ytd-grid-video-renderer")).forEach(function (item) {
      item.dataset.ytchHidden = "1";
      item.style.display = "none";
    });
  }

  function showOriginalGrid() {
    const contents = findContents();
    if (!contents) return;
    Array.from(contents.querySelectorAll("ytd-rich-item-renderer, ytd-grid-video-renderer")).forEach(function (item) {
      if (item.dataset.ytchHidden) { delete item.dataset.ytchHidden; item.style.display = ""; }
    });
  }

  function closeHistory(restoreSelected) {
    if (!state.active && !historyGridEl()) return;
    const grid = historyGridEl();
    if (grid) grid.remove();
    showOriginalGrid();
    const btn = document.getElementById("ytch-history-button");
    setChip(btn, false);
    if (restoreSelected) setChip(state.savedChip, true);
    state.active = false;
    state.savedContents = null;
    state.savedChip = null;
    state.lastWatches = [];
    state.loading = false;
  }

  function watchdog() {
    // YouTube can re-render its grid renderer at any time, which
    // restores the original grid and drops the chip. If History is
    // supposed to be on, put it back: hide the new original grid,
    // re-create the History grid outside the renderer if it is gone,
    // and re-activate the chip. This is the fix for the screenshot
    // where the chip was black but the grid was the original grid.
    if (!state.active) return;
    hideOriginalGrid();
    let grid = historyGridEl();
    if (!grid) {
      grid = ensureHistoryGrid();
      grid.innerHTML = state.loading
        ? '<div class="ytch-grid-loading">Loading watched videos...</div>'
        : renderWatchGridHtml(state.lastWatches || []);
    }
    const btn = document.getElementById("ytch-history-button");
    if (btn) setChip(btn, true);
  }

  async function openHistory(channel) {
    const contents = findContents();
    if (!contents) return;
    // Scan first, while the original grid is still on screen.
    const scanned = scanWatchedFromGrid(channel);
    const gridItemsOnPage = contents.querySelectorAll("ytd-rich-item-renderer, ytd-grid-video-renderer").length;
    console.log("[YTCH 0.2.4] History clicked, channel:", channel, "grid items on page:", gridItemsOnPage, "scanned watched:", scanned.length);
    state.savedChip = sortChipButtons().find(function (b) { return b.getAttribute("aria-selected") === "true"; }) || null;
    state.active = true;
    state.loading = true;
    state.lastChannel = channel;
    const btn = document.getElementById("ytch-history-button");
    setChip(btn, true);
    sortChipButtons().forEach(function (b) { setChip(b, false); });
    // Keep the replacement grid under #contents so it uses YouTube's grid
    // layout. Hide only the original items so the History grid remains visible.
    hideOriginalGrid();
    let historyGrid = ensureHistoryGrid();
    historyGrid.innerHTML = '<div class="ytch-grid-loading">Loading watched videos...</div>';
    try {
      const res = await chrome.runtime.sendMessage({ type: "ytch-get-watches", channel: channel });
      const stored = filterByChannel((res && res.watches) || [], channel);
      const watches = mergeWatches(stored, scanned);
      state.lastWatches = watches;
      state.loading = false;
      console.log("[YTCH 0.2.4] stored for channel:", stored.length, "merged:", watches.length);
      if (scanned.length) {
        chrome.runtime.sendMessage({ type: "ytch-import-watches", watches: scanned }).catch(function () {});
      }
      if (state.active) {
        historyGrid = ensureHistoryGrid();
        historyGrid.innerHTML = renderWatchGridHtml(watches);
        hideOriginalGrid();
      }
    } catch (e) {
      console.log("[YTCH 0.2.4] stored load failed, showing scanned only:", e);
      state.lastWatches = scanned;
      state.loading = false;
      if (state.active) {
        historyGrid = ensureHistoryGrid();
        historyGrid.innerHTML = renderWatchGridHtml(scanned);
        hideOriginalGrid();
      }
    }
  }

  function bindSortChips() {
    // Capture listeners on the real sort chips: run before YouTube's own
    // handlers, so the original grid is restored first, then YouTube
    // loads its own sort in place. Bind on every inject, not just the
    // first, because the chip bar may appear later than the History
    // button, and a chip without a listener will not restore the grid.
    sortChipButtons().forEach(function (b) {
      if (b.dataset.ytchBound) return;
      b.dataset.ytchBound = "1";
      b.addEventListener("click", function () { closeHistory(false); }, true);
    });
  }

  function wrapHistoryButton(button) {
    const wrapper = document.createElement("div");
    wrapper.setAttribute("role", "presentation");
    wrapper.className = "ytChipBarViewModelChipWrapper";
    const viewModel = document.createElement("chip-view-model");
    viewModel.className = "ytChipViewModelHost";
    viewModel.setAttribute("role", "presentation");
    const shape = document.createElement("chip-shape");
    shape.className = "ytChipShapeHost";
    shape.setAttribute("role", "presentation");
    shape.appendChild(button);
    viewModel.appendChild(shape);
    wrapper.appendChild(viewModel);
    return wrapper;
  }

  function inject() {
    if (!isChannelVideosPage()) return;
    const channel = getChannelFromPage();
    const chipBar = findChipBar();
    const existing = document.getElementById("ytch-history-button");
    // Codex, real Chrome, 0.2.2: the History button was created in a
    // body fallback row, behind the masthead, because the chip bar was
    // not ready when the script first ran, and inject() then returned
    // early forever because the button existed. Never do that again:
    // if a native chip bar is now available and the button is not in
    // it, move the button into the chip bar. Always bind sort chips
    // on every run, so Latest restores the grid even if the chip bar
    // appeared after the History button.
    if (existing) {
      bindSortChips();
      if (chipBar && !chipBar.contains(existing)) {
        const oldParent = existing.parentElement;
        const wrapper = wrapHistoryButton(existing);
        chipBar.appendChild(wrapper);
        if (oldParent && oldParent.parentElement && oldParent.parentElement.className === "ytch-chip-row" && !oldParent.parentElement.querySelector("button")) oldParent.parentElement.remove();
        else if (oldParent && oldParent.className === "ytch-chip-row") oldParent.remove();
        const fallback = document.getElementById("ytch-fallback-row");
        if (fallback && !fallback.querySelector("button")) fallback.remove();
      }
      if (state.active) { setChip(existing, true); hideOriginalGrid(); }
      return;
    }
    // The chip is missing, which means YouTube re-rendered the chip
    // bar. If History is supposed to be on, keep it on: do NOT remove
    // the History grid, re-create the chip and re-activate it, and
    // hide the original grid again. Only reset when History is off.
    if (state.active && historyGridEl()) {
      // Fall through to re-create the chip below, then watchdog
      // will re-activate it and hide the original grid again.
    } else {
      const oldGrid = historyGridEl();
      if (oldGrid) oldGrid.remove();
      showOriginalGrid();
      state.active = false;
      state.savedContents = null;
      state.savedChip = null;
      state.lastWatches = [];
      state.loading = false;
    }
    bindSortChips();

    function makeHistoryButton() {
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
      button.addEventListener("click", function () {
        if (state.active) { closeHistory(true); return; }
        openHistory(channel);
      });
      return button;
    }

    if (chipBar) {
      const button = makeHistoryButton();
      chipBar.appendChild(wrapHistoryButton(button));
      if (state.active) { setChip(button, true); hideOriginalGrid(); }
      return;
    }

    // No chip bar yet: do NOT create a body fallback row. Codex found
    // that row at the top of the body, behind the masthead, and it was
    // never moved. Wait for the chip bar, the 1 second watchdog will
    // call inject() again. Only use a fallback row when the grid
    // itself exists, so the row sits above the grid, not on the body.
    const grid = findContents();
    if (!grid || !grid.parentElement) return;
    const row = document.createElement("div");
    row.id = "ytch-fallback-row";
    row.className = "ytch-chip-row";
    row.style.display = "flex";
    row.style.gap = "8px";
    row.style.alignItems = "center";
    row.style.margin = "12px 0";
    const wrapper = document.createElement("div");
    wrapper.setAttribute("role", "presentation");
    wrapper.appendChild(makeHistoryButton());
    row.appendChild(wrapper);
    grid.parentElement.insertBefore(row, grid);
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
      const oldGrid = historyGridEl();
      if (oldGrid) oldGrid.remove();
      showOriginalGrid();
      state.active = false;
      state.savedContents = null;
      state.savedChip = null;
      state.lastWatches = [];
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
        // Recover the visible History grid in the observer callback itself.
        // YouTube can replace #contents wholesale, which removes our grid and
        // briefly exposes the native cards. Rebuild it before yielding back
        // to rendering; our own insertion is harmless because the grid now
        // exists when the resulting mutation is observed.
        if (state.active && !historyGridEl()) watchdog();
        if (pending) return;
        pending = true;
        setTimeout(function () {
          pending = false;
          if (isChannelVideosPage()) run();
        }, 200);
      });
      window.__ytchObserver.observe(document.documentElement, { childList: true, subtree: true });
    }
    let lastUrl = window.location.href;
    setInterval(function () {
      if (window.location.href !== lastUrl) { lastUrl = window.location.href; setTimeout(run, 500); return; }
      if (state.active) watchdog();
      if (isChannelVideosPage()) run();
    }, 250);
  }

  run();
  startWatchers();
  window.addEventListener("yt-navigate-finish", function () { setTimeout(run, 500); });
})();
