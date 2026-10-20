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
  const REMOVED_CARD_SELECTOR = `[role="listitem"], [data-view-name="feed-full-update"], ${LEGACY_CARD_SELECTOR}, article[data-urn*="activity"], [data-id^="urn:li:activity:"], [data-urn^="urn:li:activity:"]`;
  const EXCLUDED_TEXT_SELECTOR = `.${PLACEHOLDER}, button, [role="button"], [data-view-name*="comment"], [data-testid*="comment"]`;
  const MAX_NEW_PER_SCROLL = 32;
  const FRAME_BUDGET_MS = 5;

  let enabled = true;
  let terms = [];
  let patterns = [];
  let revision = 0;
  let settingsReady = false;
  let feedRoot = null;
  let feedObserver = null;
  let known = new WeakSet();
  let near = new WeakSet();
  let cache = new WeakMap();
  let expanded = new WeakSet();
  let remaining = MAX_NEW_PER_SCROLL;
  let lastScrollY = window.scrollY;
  let scheduled = false;
  const ready = new Set();
  const requestFrame = window.requestAnimationFrame?.bind(window)
    || ((callback) => setTimeout(callback, 16));

  function isFeedPage() {
    return location.pathname === "/feed" || location.pathname.startsWith("/feed/");
  }

  function canonicalCard(node) {
    return node.closest(MODERN_CARD_SELECTOR)
      || node.closest(LEGACY_CARD_SELECTOR)
      || node;
  }

  function cards(root = document) {
    const found = new Set();
    for (const node of root.querySelectorAll(CARD_SELECTOR)) found.add(canonicalCard(node));
    return [...found].filter((card) => !card.parentElement?.closest(CARD_SELECTOR));
  }

  function postText(card) {
    const knownText = [...card.querySelectorAll(TEXT_SELECTOR)]
      .filter((element) => !element.parentElement?.closest(TEXT_SELECTOR))
      .map((element) => element.textContent || "")
      .join(" ");
    if (knownText.trim()) return knownText;

    const paragraphs = [...card.querySelectorAll("p")]
      .filter((element) => !element.closest(EXCLUDED_TEXT_SELECTOR))
      .map((element) => element.textContent || "")
      .join(" ");
    if (paragraphs.trim()) return paragraphs;

    // Rare card layouts without paragraphs: read text nodes without cloning the post.
    const parts = [];
    const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!node.parentElement?.closest(EXCLUDED_TEXT_SELECTOR)) parts.push(node.nodeValue);
    }
    return parts.join(" ");
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
      const isExpanded = expanded.has(card);
      const label = isExpanded ? "Collapse again" : "Show post";
      if (button.textContent !== label) button.textContent = label;
      button.setAttribute("aria-expanded", String(isExpanded));
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

  function processCard(card) {
    const state = cache.get(card);
    if (!state || !card.isConnected) return;
    if (!enabled || patterns.length === 0 || !isFeedPage()
        || LinkedInWordFilterCore.matchesCompiled(postText(card), patterns)) {
      removePlaceholder(card);
    } else {
      addPlaceholder(card);
      card.classList.add(FILTERED);
      card.classList.toggle(COLLAPSED, !expanded.has(card));
      card.classList.remove("linkedin-word-filter-hidden");
    }
    state.revision = revision;
    state.dirty = false;
  }

  function schedule() {
    if (!scheduled && settingsReady && enabled && patterns.length && isFeedPage()) {
      scheduled = true;
      requestFrame(runFrame);
    }
  }

  function runFrame() {
    scheduled = false;
    if (!settingsReady || !enabled || !patterns.length || !isFeedPage()) return;
    const start = performance.now();
    let eligible = false;
    for (const card of ready) {
      if (!card.isConnected || !near.has(card)) {
        ready.delete(card);
        continue;
      }
      const state = cache.get(card);
      if (!state || (!state.dirty && state.revision === revision)) {
        ready.delete(card);
        continue;
      }
      const firstPass = state.revision < 0;
      if (firstPass && remaining === 0) continue;
      ready.delete(card);
      if (firstPass) remaining -= 1;
      processCard(card);
      if (performance.now() - start >= FRAME_BUDGET_MS) break;
    }
    for (const card of ready) {
      const state = cache.get(card);
      if (state && (state.revision >= 0 || remaining > 0)) {
        eligible = true;
        break;
      }
    }
    if (eligible) schedule();
  }

  const intersection = typeof IntersectionObserver === "function"
    ? new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const card = entry.target;
        if (entry.isIntersecting) {
          near.add(card);
          const state = cache.get(card);
          if (state && (state.dirty || state.revision !== revision)) ready.add(card);
        } else {
          near.delete(card);
          ready.delete(card);
        }
      }
      schedule();
    }, { rootMargin: "0px 0px 700px 0px" })
    : null;

  function discoverCard(node) {
    const card = canonicalCard(node);
    if (!feedRoot?.contains(card) || card.parentElement?.closest(CARD_SELECTOR) || known.has(card)) return;
    known.add(card);
    cache.set(card, { revision: -1, dirty: true });
    if (intersection) intersection.observe(card);
    else {
      near.add(card);
      ready.add(card);
      schedule();
    }
  }

  function markChanged(node) {
    const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    if (!element || element.closest(`.${PLACEHOLDER}`)) return;
    const found = element.closest(CARD_SELECTOR);
    if (!found) return;
    const card = canonicalCard(found);
    if (!known.has(card)) {
      discoverCard(card);
      return;
    }
    const state = cache.get(card);
    state.dirty = true;
    if (near.has(card)) {
      ready.add(card);
      schedule();
    }
  }

  function forgetRemoved(node) {
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const candidates = [];
    if (node.matches(REMOVED_CARD_SELECTOR)) candidates.push(node);
    candidates.push(...node.querySelectorAll(REMOVED_CARD_SELECTOR));
    for (const candidate of candidates) {
      const card = canonicalCard(candidate);
      if (card.isConnected || !known.has(card)) continue;
      intersection?.unobserve(card);
      known.delete(card);
      near.delete(card);
      cache.delete(card);
      ready.delete(card);
    }
  }

  function onFeedMutations(mutations) {
    for (const mutation of mutations) {
      if (mutation.type === "characterData") {
        markChanged(mutation.target);
        continue;
      }
      if (mutation.target.nodeType === Node.ELEMENT_NODE
          && mutation.target.closest(`.${PLACEHOLDER}`)) continue;
      if ([...mutation.addedNodes, ...mutation.removedNodes].every((node) =>
        node.nodeType === Node.ELEMENT_NODE && node.classList.contains(PLACEHOLDER))) continue;
      markChanged(mutation.target);
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        if (node.matches(CARD_SELECTOR)) discoverCard(node);
        for (const found of node.querySelectorAll(CARD_SELECTOR)) discoverCard(found);
      }
      for (const node of mutation.removedNodes) forgetRemoved(node);
    }
  }

  function bindFeed() {
    const root = document.querySelector('[data-testid="mainFeed"]')
      || document.querySelector("main, [role='main']");
    if (!root || root === feedRoot) return;
    feedObserver?.disconnect();
    intersection?.disconnect();
    feedRoot = root;
    known = new WeakSet();
    near = new WeakSet();
    cache = new WeakMap();
    ready.clear();
    remaining = MAX_NEW_PER_SCROLL;
    feedObserver = new MutationObserver(onFeedMutations);
    feedObserver.observe(root, { childList: true, characterData: true, subtree: true });
    for (const card of cards(root)) discoverCard(card);
  }

  async function loadSettings() {
    try {
      const values = await browser.storage.local.get({ enabled: true, words: "" });
      enabled = values.enabled !== false;
      terms = LinkedInWordFilterCore.parseTerms(values.words);
      patterns = LinkedInWordFilterCore.compileTerms(terms);
      expanded = new WeakSet();
      revision += 1;
    } catch (error) {
      console.error("LinkedIn Word Filter: could not read settings", error);
      enabled = false;
    }
    settingsReady = true;
    if (!enabled || patterns.length === 0) {
      ready.clear();
      for (const card of document.querySelectorAll(`.${FILTERED}`)) removePlaceholder(card);
      return;
    }
    remaining = MAX_NEW_PER_SCROLL;
    for (const card of cards(feedRoot || document)) {
      if (near.has(card)) ready.add(card);
    }
    schedule();
  }

  browser.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && (changes.enabled || changes.words)) loadSettings();
  });
  browser.runtime.onMessage.addListener((message) => {
    if (message?.type !== "status") return;
    const currentCards = cards(feedRoot || document);
    return Promise.resolve({
      feed: isFeedPage(), enabled, terms: terms.length,
      detected: currentCards.length,
      collapsed: currentCards.filter((card) => card.classList.contains(COLLAPSED)).length
    });
  });
  window.addEventListener("scroll", () => {
    if (Math.abs(window.scrollY - lastScrollY) < 160) return;
    lastScrollY = window.scrollY;
    remaining = MAX_NEW_PER_SCROLL;
    schedule();
  }, { passive: true });
  new MutationObserver((mutations) => {
    if (!feedRoot?.isConnected) {
      bindFeed();
      return;
    }
    if (feedRoot.matches('[data-testid="mainFeed"]')) return;
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        if (node.matches('[data-testid="mainFeed"]')
            || node.querySelector('[data-testid="mainFeed"]')) {
          bindFeed();
          return;
        }
      }
    }
  }).observe(document, { childList: true, subtree: true });
  bindFeed();
  loadSettings();
})();
