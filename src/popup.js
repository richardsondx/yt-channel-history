async function refresh() {
  const data = await chrome.storage.local.get(["watches", "backfilledAt", "importedAt"]);
  const watches = Array.isArray(data.watches) ? data.watches : [];
  document.getElementById("count").textContent = watches.length + " watched videos stored locally.";
  let status = "";
  if (data.backfilledAt) status += "Last backfill: " + new Date(data.backfilledAt).toLocaleString() + ". ";
  if (data.importedAt) status += "Last Takeout import: " + new Date(data.importedAt).toLocaleString() + ".";
  if (status) document.getElementById("status").textContent = status;
}
document.getElementById("import-takeout").addEventListener("click", function () {
  document.getElementById("takeout-file").click();
});
document.getElementById("takeout-file").addEventListener("change", async function (event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  document.getElementById("status").textContent = "Importing Takeout file locally...";
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    const watches = parseTakeoutEntries(data);
    if (!watches.length) { document.getElementById("status").textContent = "No watched videos found in that file. Pick watch-history.json from Google Takeout."; return; }
    const res = await chrome.runtime.sendMessage({ type: "ytch-import-takeout", watches: watches });
    await refresh();
    if (res && res.ok) document.getElementById("status").textContent = "Takeout import done: " + res.imported + " in file, " + res.newCount + " new, " + res.total + " stored.";
    else document.getElementById("status").textContent = "Takeout import failed.";
  } catch (e) {
    document.getElementById("status").textContent = "Could not read that file. Pick watch-history.json from Google Takeout.";
  }
  event.target.value = "";
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
