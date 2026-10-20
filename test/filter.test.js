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

function fixture(url = "https://www.linkedin.com/feed/") {
  const dom = new JSDOM(`<!doctype html><main>
    <div class="occludable-update" id="keep"><span class="update-components-text">AI research</span></div>
    <div class="occludable-update" id="hide"><span class="update-components-text">Coffee break</span></div>
  </main>`, { url, runScripts: "outside-only" });
  const { window } = dom;
  let values = { enabled: true, words: "AI" };
  let onChange;
  window.browser = {
    storage: {
      local: { get: async () => values },
      onChanged: { addListener: (listener) => { onChange = listener; } }
    }
  };
  window.eval(fs.readFileSync(path.join(__dirname, "../filter-core.js"), "utf8"));
  window.eval(fs.readFileSync(path.join(__dirname, "../content.js"), "utf8"));
  return {
    window,
    change(next) {
      values = { ...values, ...next };
      onChange({ words: { newValue: values.words }, enabled: { newValue: values.enabled } }, "local");
    }
  };
}

function hidden(window, id) {
  return window.document.getElementById(id).classList.contains("linkedin-word-filter-hidden");
}

test("filters post body, updates dynamically, and restores posts when disabled", async () => {
  const app = fixture();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(hidden(app.window, "keep"), false);
  assert.equal(hidden(app.window, "hide"), true);

  const next = app.window.document.createElement("div");
  next.id = "new";
  next.className = "occludable-update";
  next.innerHTML = '<span class="update-components-text">AI hiring</span>';
  app.window.document.querySelector("main").append(next);
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(hidden(app.window, "new"), false);

  app.change({ enabled: false });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(hidden(app.window, "hide"), false);

  app.change({ enabled: true, words: "Coffee" });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(hidden(app.window, "keep"), true);
  assert.equal(hidden(app.window, "hide"), false);

  app.change({ words: "" });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(hidden(app.window, "keep"), false);
  app.window.close();
});

test("does not filter non-feed LinkedIn pages", async () => {
  const app = fixture("https://www.linkedin.com/in/example/");
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(hidden(app.window, "hide"), false);
  app.window.close();
});
