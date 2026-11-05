async function refresh() {
  const data = await chrome.storage.local.get(["watches", "backfilledAt"]);
  const watches = Array.isArray(data.watches) ? data.watches : [];
  document.getElementById("count").textContent = watches.length + " watched videos stored locally.";
  if (data.backfilledAt) {
    document.getElementById("status").textContent = "Last backfill: " + new Date(data.backfilledAt).toLocaleString();
  }
}
document.getElementById("backfill").addEventListener("click", async function () {
  document.getElementById("status").textContent = "Backfilling...";
  const res = await chrome.runtime.sendMessage({ type: "ytch-backfill" });
  document.getElementById("status").textContent = res && res.ok ? "Backfill done." : "Backfill failed.";
  refresh();
});
document.getElementById("clear").addEventListener("click", async function () {
  if (!confirm("Clear the local watched list stored by this extension?")) return;
  await chrome.runtime.sendMessage({ type: "ytch-clear" });
  refresh();
});
refresh();
