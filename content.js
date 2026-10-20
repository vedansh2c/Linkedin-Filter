(() => {
  "use strict";

  const HIDDEN = "linkedin-word-filter-hidden";
  const REVEAL = "linkedin-word-filter-reveal";
  const PROGRESS = "linkedin-word-filter-progress";
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
  const EXCLUDED_TEXT_SELECTOR = 'button, [role="button"], [data-view-name*="comment"], [data-testid*="comment"]';
  const FRAME_BUDGET_MS = 5;
  const LOOKAHEAD_POSTS = 24;
  const MAX_BATCH_SIZE = 48;

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
  const hidden = new Set();
  const intersecting = new Set();
  const ordered = [];
  let scheduled = false;
  const ready = new Set();
  const decisions = new Map();
  let progress = null;
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

  function updateProgress() {
    if (!progress) return;
    progress.hidden = !isFeedPage() || !enabled || patterns.length === 0
      || ready.size + decisions.size < 8;
  }

  function queueAhead(card) {
    const index = ordered.indexOf(card);
    if (index < 0) return;
    for (let i = index; i < Math.min(ordered.length, index + LOOKAHEAD_POSTS); i++) {
      const candidate = ordered[i];
      const state = cache.get(candidate);
      if (candidate.isConnected && state && (state.dirty || state.revision !== revision)) {
        ready.add(candidate);
      }
    }
    updateProgress();
    schedule();
  }

  function flushDecisions() {
    if (!decisions.size) return;
    // Keep a visible post in place if Firefox's native scroll anchoring did not.
    let anchor = null;
    let before = 0;
    for (const card of intersecting) {
      if (hidden.has(card) || decisions.get(card)?.keep === false) continue;
      const rect = card.getBoundingClientRect();
      if (rect.height && rect.top >= 0 && rect.top < window.innerHeight) {
        anchor = card;
        before = rect.top;
        break;
      }
    }
    for (const [card, decision] of decisions) {
      const state = cache.get(card);
      if (!state || !card.isConnected || decision.revision !== revision
          || decision.change !== state.change) continue;
      if (decision.keep) {
        card.classList.remove(HIDDEN);
        hidden.delete(card);
        if (state.revision < 0) card.classList.add(REVEAL);
      } else {
        card.classList.remove(REVEAL);
        card.classList.add(HIDDEN);
        hidden.add(card);
      }
      state.revision = revision;
      state.dirty = false;
    }
    decisions.clear();
    if (anchor?.isConnected && typeof window.scrollBy === "function") {
      const delta = anchor.getBoundingClientRect().top - before;
      if (Math.abs(delta) > 2) window.scrollBy(0, delta);
    }
    updateProgress();
  }

  function schedule() {
    if (!scheduled && settingsReady && enabled && patterns.length && isFeedPage()) {
      scheduled = true;
      requestFrame(runFrame);
    }
  }

  function runFrame() {
    scheduled = false;
    if (!settingsReady || !enabled || !patterns.length || !isFeedPage()) {
      updateProgress();
      return;
    }
    const start = performance.now();
    for (const card of ready) {
      if (!card.isConnected) {
        ready.delete(card);
        continue;
      }
      const state = cache.get(card);
      if (!state || (!state.dirty && state.revision === revision)) {
        ready.delete(card);
        continue;
      }
      ready.delete(card);
      decisions.set(card, {
        keep: LinkedInWordFilterCore.matchesCompiled(postText(card), patterns),
        revision,
        change: state.change
      });
      if (decisions.size >= MAX_BATCH_SIZE || performance.now() - start >= FRAME_BUDGET_MS) break;
    }
    if (!ready.size || decisions.size >= MAX_BATCH_SIZE) flushDecisions();
    updateProgress();
    if (ready.size) schedule();
  }

  const intersection = typeof IntersectionObserver === "function"
    ? new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const card = entry.target;
        if (entry.isIntersecting) {
          near.add(card);
          intersecting.add(card);
          queueAhead(card);
        } else {
          near.delete(card);
          intersecting.delete(card);
        }
      }
      schedule();
    }, { rootMargin: "0px 0px 400px 0px" })
    : null;

  function discoverCard(node) {
    const card = canonicalCard(node);
    if (!feedRoot?.contains(card) || card.parentElement?.closest(CARD_SELECTOR) || known.has(card)) return;
    known.add(card);
    const last = ordered.at(-1);
    if (!last || last.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING) {
      ordered.push(card);
    } else {
      const index = ordered.findIndex((candidate) =>
        card.compareDocumentPosition(candidate) & Node.DOCUMENT_POSITION_FOLLOWING);
      ordered.splice(index < 0 ? ordered.length : index, 0, card);
    }
    cache.set(card, { revision: -1, dirty: true, change: 0 });
    if (intersection) intersection.observe(card);
    else {
      near.add(card);
      queueAhead(card);
    }
  }

  function markChanged(node) {
    const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    if (!element) return;
    const found = element.closest(CARD_SELECTOR);
    if (!found) return;
    const card = canonicalCard(found);
    if (!known.has(card)) {
      discoverCard(card);
      return;
    }
    const state = cache.get(card);
    state.dirty = true;
    state.change += 1;
    decisions.delete(card);
    if (near.has(card) || hidden.has(card)) {
      queueAhead(card);
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
      intersecting.delete(card);
      hidden.delete(card);
      cache.delete(card);
      ready.delete(card);
      decisions.delete(card);
      const index = ordered.indexOf(card);
      if (index >= 0) ordered.splice(index, 1);
    }
  }

  function onFeedMutations(mutations) {
    for (const mutation of mutations) {
      if (mutation.type === "characterData") {
        markChanged(mutation.target);
        continue;
      }
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
    for (const card of hidden) card.classList.remove(HIDDEN);
    feedRoot = root;
    known = new WeakSet();
    near = new WeakSet();
    cache = new WeakMap();
    ready.clear();
    decisions.clear();
    ordered.length = 0;
    intersecting.clear();
    hidden.clear();
    progress?.remove();
    progress = document.createElement("div");
    progress.className = PROGRESS;
    progress.setAttribute("role", "status");
    progress.textContent = "Filtering posts…";
    progress.hidden = true;
    document.body?.append(progress);
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
      revision += 1;
      decisions.clear();
    } catch (error) {
      console.error("LinkedIn Word Filter: could not read settings", error);
      enabled = false;
    }
    settingsReady = true;
    if (!enabled || patterns.length === 0) {
      ready.clear();
      for (const card of document.querySelectorAll(`.${HIDDEN}`)) card.classList.remove(HIDDEN);
      for (const card of document.querySelectorAll(`.${REVEAL}`)) card.classList.remove(REVEAL);
      hidden.clear();
      updateProgress();
      return;
    }
    ready.clear();
    for (const card of ordered) {
      if (hidden.has(card)) ready.add(card);
      if (near.has(card)) queueAhead(card);
    }
    updateProgress();
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
      hidden: currentCards.filter((card) => card.classList.contains(HIDDEN)).length
    });
  });
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
