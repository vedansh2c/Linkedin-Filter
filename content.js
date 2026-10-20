(() => {
  "use strict";

  const FILTERED = "linkedin-word-filter-filtered";
  const COLLAPSED = "linkedin-word-filter-collapsed";
  const PLACEHOLDER = "linkedin-word-filter-placeholder";
  const MODERN_CARD_SELECTOR = '[data-testid="mainFeed"] [role="listitem"]';
  const LEGACY_CARD_SELECTOR = ".occludable-update, .feed-shared-update-v2";
  const CARD_SELECTOR = [
    MODERN_CARD_SELECTOR,
    '[data-view-name="feed-full-update"]',
    LEGACY_CARD_SELECTOR,
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
  let settingsReady = false;
  let scheduled = false;
  let expanded = new WeakSet();
  const pending = new Set();

  function isFeedPage() {
    return location.pathname === "/feed" || location.pathname.startsWith("/feed/");
  }

  function canonicalCard(node) {
    return node.closest(MODERN_CARD_SELECTOR)
      || node.closest(LEGACY_CARD_SELECTOR)
      || node;
  }

  function cards() {
    const found = new Set();
    for (const node of document.querySelectorAll(CARD_SELECTOR)) found.add(canonicalCard(node));
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
      .filter((element) => !element.closest(`.${PLACEHOLDER}, button, [role="button"], [data-view-name*="comment"], [data-testid*="comment"]`))
      .map((element) => element.textContent || "")
      .join(" ");
    if (paragraphs.trim()) return paragraphs;

    const copy = card.cloneNode(true);
    for (const element of copy.querySelectorAll(`.${PLACEHOLDER}, button, [role="button"], [data-view-name*="comment"], [data-testid*="comment"]`)) {
      element.remove();
    }
    return copy.textContent || "";
  }

  function removePlaceholder(card) {
    card.classList.remove(FILTERED, COLLAPSED, "linkedin-word-filter-hidden");
    for (const child of card.children) {
      if (child.classList.contains(PLACEHOLDER)) child.remove();
    }
    expanded.delete(card);
  }

  function addPlaceholder(card) {
    const existing = [...card.children].find((child) => child.classList.contains(PLACEHOLDER));
    if (existing) {
      const button = existing.querySelector("button");
      button.textContent = expanded.has(card) ? "Collapse again" : "Show post";
      button.setAttribute("aria-expanded", String(expanded.has(card)));
      return;
    }

    const row = document.createElement("div");
    row.className = PLACEHOLDER;
    const label = document.createElement("span");
    label.textContent = "Post collapsed by LinkedIn Word Filter";
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Show post";
    button.setAttribute("aria-expanded", "false");
    button.addEventListener("click", () => {
      if (expanded.has(card)) {
        expanded.delete(card);
        card.classList.add(COLLAPSED);
        button.textContent = "Show post";
        button.setAttribute("aria-expanded", "false");
      } else {
        expanded.add(card);
        card.classList.remove(COLLAPSED);
        button.textContent = "Collapse again";
        button.setAttribute("aria-expanded", "true");
      }
    });
    row.append(label, button);
    card.prepend(row);
  }

  function filterCard(card) {
    if (!card.isConnected) return;
    if (!enabled || terms.length === 0 || !isFeedPage()
        || LinkedInWordFilterCore.matches(postText(card), terms)) {
      removePlaceholder(card);
      return;
    }
    addPlaceholder(card);
    card.classList.add(FILTERED);
    card.classList.toggle(COLLAPSED, !expanded.has(card));
    card.classList.remove("linkedin-word-filter-hidden");
  }

  function flush() {
    scheduled = false;
    if (!settingsReady) return;
    const batch = [...pending];
    pending.clear();
    for (const card of batch) {
      if (!card.parentElement?.closest(CARD_SELECTOR)) filterCard(card);
    }
  }

  function schedule() {
    if (!scheduled) {
      scheduled = true;
      queueMicrotask(flush);
    }
  }

  function queueNode(node) {
    const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    if (!element || element.closest(`.${PLACEHOLDER}`)) return;
    const ancestor = element.closest(CARD_SELECTOR);
    if (ancestor) pending.add(canonicalCard(ancestor));
    for (const found of element.querySelectorAll(CARD_SELECTOR)) pending.add(canonicalCard(found));
    if (pending.size) schedule();
  }

  async function loadSettings() {
    try {
      const values = await browser.storage.local.get({ enabled: true, words: "" });
      enabled = values.enabled !== false;
      terms = LinkedInWordFilterCore.parseTerms(values.words);
      expanded = new WeakSet();
    } catch (error) {
      console.error("LinkedIn Word Filter: could not read settings", error);
      enabled = false;
    }
    settingsReady = true;
    for (const card of cards()) pending.add(card);
    schedule();
  }

  browser.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && (changes.enabled || changes.words)) loadSettings();
  });
  browser.runtime.onMessage.addListener((message) => {
    if (message?.type === "status") {
      flush();
      const currentCards = cards();
      return Promise.resolve({
        feed: isFeedPage(),
        enabled,
        terms: terms.length,
        detected: currentCards.length,
        collapsed: currentCards.filter((card) => card.classList.contains(COLLAPSED)).length
      });
    }
  });
  new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === "characterData") {
        queueNode(mutation.target);
        continue;
      }
      if (mutation.target.nodeType === Node.ELEMENT_NODE
          && mutation.target.closest(`.${PLACEHOLDER}`)) continue;
      if ([...mutation.addedNodes, ...mutation.removedNodes].every((node) =>
        node.nodeType === Node.ELEMENT_NODE && node.classList.contains(PLACEHOLDER))) continue;
      const parent = mutation.target.closest?.(CARD_SELECTOR);
      if (parent) pending.add(canonicalCard(parent));
      for (const node of mutation.addedNodes) queueNode(node);
    }
    if (pending.size) schedule();
  }).observe(document, { childList: true, characterData: true, subtree: true });
  loadSettings();
})();
