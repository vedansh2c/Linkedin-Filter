const enabled = document.getElementById("enabled");
const words = document.getElementById("words");
const status = document.getElementById("status");
const diagnostic = document.getElementById("diagnostic");

async function showDiagnostic() {
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    const result = await browser.tabs.sendMessage(tab.id, { type: "status" });
    if (!result.feed) {
      diagnostic.textContent = "Open the LinkedIn feed to filter posts.";
    } else if (result.detected === 0) {
      diagnostic.textContent = "No feed posts detected. Refresh LinkedIn, then check its extension permission.";
    } else if (!result.enabled || result.terms === 0) {
      diagnostic.textContent = `${result.detected} posts detected. Add a word and enable filtering.`;
    } else {
      diagnostic.textContent = `${result.detected} posts detected; ${result.collapsed} collapsed.`;
    }
  } catch {
    diagnostic.textContent = "Not connected to this tab. Open LinkedIn, allow extension access, and refresh it.";
  }
}

browser.storage.local.get({ enabled: true, words: "" }).then((values) => {
  enabled.checked = values.enabled !== false;
  words.value = values.words;
  showDiagnostic();
}).catch(() => { status.textContent = "Could not load settings."; });

document.getElementById("save").addEventListener("click", async () => {
  try {
    await browser.storage.local.set({ enabled: enabled.checked, words: words.value });
    status.textContent = "Saved. The feed updates automatically.";
    await new Promise((resolve) => setTimeout(resolve, 150));
    showDiagnostic();
  } catch {
    status.textContent = "Could not save settings.";
  }
});
