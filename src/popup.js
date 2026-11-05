async function refresh() {
  const data = await chrome.storage.local.get(["watches", "backfilledAt", "lastImportAt"]);
  const watches = Array.isArray(data.watches) ? data.watches : [];
  document.getElementById("count").textContent = watches.length + " watched videos stored locally.";
  if (data.backfilledAt) {
    document.getElementById("status").textContent = "Last backfill: " + new Date(data.backfilledAt).toLocaleString();
  }
  if (data.lastImportAt) {
    document.getElementById("status").textContent += (data.backfilledAt ? " · " : "") + "Last Takeout import: " + new Date(data.lastImportAt).toLocaleString();
  }
}
document.getElementById("import").addEventListener("click", function () {
  document.getElementById("takeout-file").click();
});
document.getElementById("takeout-file").addEventListener("change", async function (event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  const status = document.getElementById("status");
  status.textContent = "Reading Takeout file locally...";
  try {
    const parsed = parseTakeoutWatchHistory(JSON.parse(await file.text()));
    if (!parsed.length) throw new Error("No YouTube watch entries with video URLs were found in this file.");
    let added = 0;
    let total = 0;
    const batchSize = 250;
    for (let i = 0; i < parsed.length; i += batchSize) {
      const response = await chrome.runtime.sendMessage({ type: "ytch-import-watches", watches: parsed.slice(i, i + batchSize) });
      if (!response || !response.ok) throw new Error((response && response.error) || "The extension could not save the imported records.");
      added += response.added || 0;
      total = response.total || total;
      status.textContent = "Importing locally... " + Math.min(i + batchSize, parsed.length) + " / " + parsed.length;
    }
    status.textContent = "Imported " + parsed.length + " unique videos (" + added + " new); " + total + " stored locally.";
    await refresh();
  } catch (error) {
    status.textContent = "Import failed: " + String(error && error.message || error);
  } finally {
    event.target.value = "";
  }
});
document.getElementById("backfill").addEventListener("click", async function () {
  document.getElementById("status").textContent = "Backfilling...";
  const res = await chrome.runtime.sendMessage({ type: "ytch-backfill" });
  if (res && res.ok && res.result) {
    document.getElementById("status").textContent = "Backfill done: " + res.result.added + " checked, " + res.result.total + " stored.";
  } else {
    document.getElementById("status").textContent = "Backfill failed.";
  }
  refresh();
});
document.getElementById("clear").addEventListener("click", async function () {
  if (!confirm("Clear the local watched list stored by this extension?")) return;
  await chrome.runtime.sendMessage({ type: "ytch-clear" });
  refresh();
});
refresh();
