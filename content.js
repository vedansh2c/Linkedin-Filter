(() => {
  "use strict";

  const HIDDEN = "linkedin-word-filter-hidden";
  const MODERN_CARD_SELECTOR = '[data-testid="mainFeed"] [role="listitem"]';
  const CARD_SELECTOR = [
    MODERN_CARD_SELECTOR,
    '[data-view-name="feed-full-update"]',
    ".occludable-update",
    ".feed-shared-update-v2",
    "article[data-urn*='activity']",
    "[data-id^='urn:li:activity:']",
    "[data-urn^='urn:li:activity:']"
  ].join(",");
  const TEXT_SELECTOR = [
    "[data-test-id='main-feed-activity-card__commentary']",
    ".update-components-text",
    ".feed-shared-update-v2__description",
    ".feed-shared-text"
  ].join(",");

  let enabled = true;
  let terms = [];
  let scanTimer;
  let settingsReady = false;
  let detected = 0;
  let hidden = 0;

  function isFeedPage() {
    return location.pathname === "/feed" || location.pathname.startsWith("/feed/");
  }

  function cards() {
    const found = new Set();
    for (const node of document.querySelectorAll(CARD_SELECTOR)) {
      const card = node.closest(MODERN_CARD_SELECTOR)
        || node.closest(".occludable-update, .feed-shared-update-v2")
        || node;
      found.add(card);
    }
    return [...found].filter((card) => !card.parentElement?.closest(CARD_SELECTOR));
  }

  function postText(card) {
    const known = [...card.querySelectorAll(TEXT_SELECTOR)]
      .filter((element) => !element.parentElement?.closest(TEXT_SELECTOR))
      .map((element) => element.textContent || "")
      .join(" ");
    if (known.trim()) return known;

    // LinkedIn's newer feed has no stable attribute on the post text itself.
    const paragraphs = [...card.querySelectorAll("p")]
      .filter((element) => !element.closest('button, [role="button"], [data-view-name*="comment"], [data-testid*="comment"]'))
      .map((element) => element.textContent || "")
      .join(" ");
    return paragraphs.trim() || card.textContent || "";
  }

  function scan() {
    if (!settingsReady) return;
    const filter = enabled && terms.length > 0 && isFeedPage();
    const currentCards = cards();
    detected = currentCards.length;
    hidden = 0;
    for (const card of currentCards) {
      card.classList.toggle(HIDDEN, filter && !LinkedInWordFilterCore.matches(postText(card), terms));
      if (card.classList.contains(HIDDEN)) hidden += 1;
    }
    if (!filter) {
      for (const card of document.querySelectorAll(`.${HIDDEN}`)) card.classList.remove(HIDDEN);
    }
  }

  function scheduleScan() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scan, 80);
  }

  async function loadSettings() {
    try {
      const values = await browser.storage.local.get({ enabled: true, words: "" });
      enabled = values.enabled !== false;
      terms = LinkedInWordFilterCore.parseTerms(values.words);
    } catch (error) {
      console.error("LinkedIn Word Filter: could not read settings", error);
      enabled = false;
    }
    settingsReady = true;
    scan();
  }

  browser.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && (changes.enabled || changes.words)) loadSettings();
  });
  browser.runtime.onMessage.addListener((message) => {
    if (message?.type === "status") {
      return Promise.resolve({ feed: isFeedPage(), enabled, terms: terms.length, detected, hidden });
    }
  });
  new MutationObserver(scheduleScan).observe(document.documentElement, {
    childList: true,
    characterData: true,
    subtree: true
  });
  loadSettings();
})();
