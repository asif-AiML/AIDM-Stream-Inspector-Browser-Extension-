// Isolated-world, top-level metadata reader. Never enter iframe documents.
(() => {
  const selector = 'title, meta[property="og:title"], meta[name="twitter:title"], h1, iframe[title]';
  let pendingRead = null;
  let lastSnapshot = "";
  let active = true;

  function collectTitleEvidence() {
    const evidence = [];
    function add(source, value) {
      if (typeof value !== "string" || value.length > 2048 || !value.trim()) return;
      evidence.push({ source, value: value.trim() });
    }
    for (const [query, source] of [
      ['meta[property="og:title"]', "og:title"],
      ['meta[name="twitter:title"]', "twitter:title"]
    ]) {
      for (const node of Array.from(document.querySelectorAll(query)).slice(0, 4)) {
        add(source, node.getAttribute("content"));
      }
    }
    add("document.title", document.title);
    const headings = document.querySelectorAll("h1");
    // Multiple headings do not establish a dominant playback title.
    if (headings.length <= 8) {
      const visible = Array.from(headings).filter((node) =>
        node.getClientRects().length && getComputedStyle(node).visibility !== "hidden"
      );
      if (visible.length === 1) add("h1", visible[0].innerText);
    }
    for (const frame of Array.from(document.querySelectorAll("iframe[title]")).slice(0, 4)) {
      add("iframe title attribute", frame.getAttribute("title"));
    }
    return { pageUrl: location.href, evidence };
  }

  function notifyChange() {
    pendingRead = null;
    const snapshot = JSON.stringify(collectTitleEvidence());
    if (snapshot === lastSnapshot) return;
    lastSnapshot = snapshot;
    try {
      chrome.runtime.sendMessage({ type: "AIDM_TITLE_CHANGED" }, () => {
        // Reloaded extensions can leave an old script without a receiver.
        if (chrome.runtime.lastError) lastSnapshot = "";
      });
    } catch (error) {
      active = false;
      observer.disconnect();
      console.warn("[AIDM Playback Title] Extension connection ended; reload this page to resume title observation.");
    }
  }

  function scheduleRead() {
    if (active && pendingRead === null) pendingRead = setTimeout(notifyChange, 250);
  }

  function involvesTitle(node) {
    const element = node.nodeType === 1 ? node : node.parentElement;
    return element && (element.matches(selector) || element.closest("title, h1"));
  }

  const observer = new MutationObserver((mutations) => {
    const relevant = mutations.some((mutation) => {
      if (involvesTitle(mutation.target)) return true;
      // Removing/changing a metadata key or iframe title must clear old evidence.
      if (mutation.type === "attributes" && mutation.target.matches("meta, iframe")) return true;
      if (mutation.type !== "childList") return false;
      return [...mutation.addedNodes, ...mutation.removedNodes].some((node) =>
        involvesTitle(node) || (node.nodeType === 1 && node.querySelector(selector))
      );
    });
    if (relevant) scheduleRead();
  });
  observer.observe(document.documentElement, {
    subtree: true, childList: true, characterData: true,
    attributes: true, attributeFilter: ["content", "property", "name", "title"]
  });
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id || message?.type !== "AIDM_READ_TITLE") return;
    sendResponse(collectTitleEvidence());
  });
  window.addEventListener("pageshow", scheduleRead);
  window.addEventListener("popstate", scheduleRead);
  window.addEventListener("hashchange", scheduleRead);
  scheduleRead();
})();
