const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");
const core = require("../filter-core");

test("terms are trimmed, normalized, deduplicated, and capped", () => {
  assert.deepEqual(core.parseTerms(" AI, climate   tech\nai "), ["ai", "climate tech"]);
  assert.equal(core.parseTerms(Array.from({ length: 120 }, (_, i) => `term${i}`).join(",")).length, 100);
});

test("matching handles words, phrases, punctuation, and Unicode", () => {
  assert.equal(core.matches("Hiring AI engineers", ["ai"]), true);
  assert.equal(core.matches("Paid internship", ["ai"]), false);
  assert.equal(core.matches("Climate   tech", ["climate tech"]), true);
  assert.equal(core.matches("C++ roles", ["c++"]), true);
  assert.equal(core.matches("Machine-learning roles", ["machine learning"]), false);
  assert.equal(core.matches("A café opening", ["café"]), true);
  assert.equal(core.matches("A [research] role", ["[research]"]), true);
});

function fixture(url = "https://www.linkedin.com/feed/", markup = `<main>
    <div class="occludable-update" id="keep"><span class="update-components-text">AI research</span></div>
    <div class="occludable-update" id="hide"><span class="update-components-text">Coffee break</span></div>
  </main>`) {
  const dom = new JSDOM(`<!doctype html>${markup}`, { url, runScripts: "outside-only" });
  const { window } = dom;
  let values = { enabled: true, words: "AI" };
  let onChange;
  let onMessage;
  window.browser = {
    runtime: { onMessage: { addListener: (listener) => { onMessage = listener; } } },
    storage: {
      local: { get: async () => values },
      onChanged: { addListener: (listener) => { onChange = listener; } }
    }
  };
  window.eval(fs.readFileSync(path.join(__dirname, "../filter-core.js"), "utf8"));
  window.eval(fs.readFileSync(path.join(__dirname, "../content.js"), "utf8"));
  return {
    window,
    status: () => onMessage({ type: "status" }),
    change(next) {
      values = { ...values, ...next };
      onChange({ words: { newValue: values.words }, enabled: { newValue: values.enabled } }, "local");
    }
  };
}

function collapsed(window, id) {
  return window.document.getElementById(id).classList.contains("linkedin-word-filter-collapsed");
}

test("filters post body, updates dynamically, and restores posts when disabled", async () => {
  const app = fixture();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(collapsed(app.window, "keep"), false);
  assert.equal(collapsed(app.window, "hide"), true);
  assert.equal(app.window.document.querySelectorAll(".linkedin-word-filter-placeholder").length, 1);

  const show = app.window.document.querySelector("#hide .linkedin-word-filter-placeholder button");
  show.click();
  assert.equal(collapsed(app.window, "hide"), false);
  assert.equal(show.textContent, "Collapse again");
  app.change({ words: "AI, climate" });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(collapsed(app.window, "hide"), true);
  assert.equal(show.textContent, "Show post");
  show.click();
  assert.equal(collapsed(app.window, "hide"), false);
  show.click();
  assert.equal(collapsed(app.window, "hide"), true);

  const next = app.window.document.createElement("div");
  next.id = "new";
  next.className = "occludable-update";
  next.innerHTML = '<span class="update-components-text">AI hiring</span>';
  app.window.document.querySelector("main").append(next);
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(collapsed(app.window, "new"), false);

  app.change({ enabled: false });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(collapsed(app.window, "hide"), false);
  assert.equal(app.window.document.querySelectorAll(".linkedin-word-filter-placeholder").length, 0);

  app.change({ enabled: true, words: "Coffee" });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(collapsed(app.window, "keep"), true);
  assert.equal(collapsed(app.window, "hide"), false);

  app.change({ words: "" });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(collapsed(app.window, "keep"), false);
  app.window.close();
});

test("detects modern LinkedIn feed cards and ignores comment paragraphs", async () => {
  const app = fixture("https://www.linkedin.com/feed/", `<main data-testid="mainFeed">
    <div role="listitem" id="keep"><div data-view-name="feed-full-update"><p>AI research</p></div></div>
    <div role="listitem" id="hide"><div data-view-name="feed-full-update"><p>Coffee break</p>
      <div data-view-name="feed-comment"><p>AI</p></div></div></div>
  </main>`);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(collapsed(app.window, "keep"), false);
  assert.equal(collapsed(app.window, "hide"), true);
  assert.deepEqual(JSON.parse(JSON.stringify(await app.status())), {
    feed: true, enabled: true, terms: 1, detected: 2, collapsed: 1
  });
  app.window.close();
});

test("does not filter non-feed LinkedIn pages", async () => {
  const app = fixture("https://www.linkedin.com/in/example/");
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(collapsed(app.window, "hide"), false);
  app.window.close();
});

test("popup reports feed connection and saves settings", async () => {
  const html = fs.readFileSync(path.join(__dirname, "../popup.html"), "utf8");
  const dom = new JSDOM(html, { url: "https://example.test/", runScripts: "outside-only" });
  const { window } = dom;
  let saved;
  window.browser = {
    storage: { local: {
      get: async () => ({ enabled: true, words: "AI" }),
      set: async (values) => { saved = values; }
    } },
    tabs: {
      query: async () => [{ id: 7 }],
      sendMessage: async () => ({ feed: true, enabled: true, terms: 1, detected: 3, collapsed: 2 })
    }
  };
  window.eval(fs.readFileSync(path.join(__dirname, "../popup.js"), "utf8"));
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.match(window.document.getElementById("diagnostic").textContent, /3 posts detected; 2 collapsed/);
  window.document.getElementById("words").value = "climate tech";
  window.document.getElementById("save").click();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(JSON.parse(JSON.stringify(saved)), { enabled: true, words: "climate tech" });
  dom.window.close();
});
