const enabled = document.getElementById("enabled");
const words = document.getElementById("words");
const status = document.getElementById("status");

browser.storage.local.get({ enabled: true, words: "" }).then((values) => {
  enabled.checked = values.enabled !== false;
  words.value = values.words;
}).catch(() => { status.textContent = "Could not load settings."; });

document.getElementById("save").addEventListener("click", async () => {
  try {
    await browser.storage.local.set({ enabled: enabled.checked, words: words.value });
    status.textContent = "Saved. The feed updates automatically.";
  } catch {
    status.textContent = "Could not save settings.";
  }
});
