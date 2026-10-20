/* Shared, dependency-free matching logic. No page text leaves the browser. */
globalThis.LinkedInWordFilterCore = (() => {
  function parseTerms(input) {
    return [...new Set(String(input || "")
      .split(/[\n,]+/u)
      .map((part) => part.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase())
      .filter(Boolean))].slice(0, 100);
  }

  function matches(text, terms) {
    const normalized = String(text || "").normalize("NFKC").toLocaleLowerCase();
    return terms.some((term) => {
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&").replace(/\s+/gu, "\\s+");
      return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`, "u").test(normalized);
    });
  }

  return { parseTerms, matches };
})();

if (typeof module !== "undefined") module.exports = globalThis.LinkedInWordFilterCore;
