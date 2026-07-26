// Background service worker — orchestrates scraping FB Reel tabs.
// Web page (comment-fb.*) → page_bridge → chrome.runtime.sendMessage → here → open FB tab → content_script scrapes → back to page.

const DEFAULT_SETTINGS = {
  concurrent: 3,      // how many FB tabs open at once
  perTabTimeoutMs: 45000,
  delayBetweenBatchesMs: 1500,
};

async function getSettings() {
  const stored = await chrome.storage.local.get(['settings']);
  return { ...DEFAULT_SETTINGS, ...(stored.settings || {}) };
}

// Track ongoing tab scrapes so we can resolve when content script reports back
const pendingScrapes = new Map(); // tabId -> {resolve, timer}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'SCRAPE_URLS') {
    scrapeMany(msg.urls || []).then(sendResponse);
    return true; // keep channel open
  }
  if (msg?.type === 'SCRAPE_RESULT' && sender.tab?.id != null) {
    const p = pendingScrapes.get(sender.tab.id);
    if (p) {
      clearTimeout(p.timer);
      pendingScrapes.delete(sender.tab.id);
      p.resolve(msg.comments || []);
      chrome.tabs.remove(sender.tab.id).catch(() => {});
    }
    return false;
  }
  if (msg?.type === 'PING') {
    sendResponse({ ok: true, version: chrome.runtime.getManifest().version });
    return false;
  }
});

async function scrapeMany(urls) {
  const settings = await getSettings();
  const results = {};
  for (let i = 0; i < urls.length; i += settings.concurrent) {
    const batch = urls.slice(i, i + settings.concurrent);
    const batchResults = await Promise.all(
      batch.map((url) => scrapeOneUrl(url, settings.perTabTimeoutMs))
    );
    batch.forEach((url, idx) => {
      results[url] = batchResults[idx];
    });
    // small pause between batches to reduce FB rate-limit risk
    if (i + settings.concurrent < urls.length) {
      await sleep(settings.delayBetweenBatchesMs);
    }
  }
  return { ok: true, results };
}

function scrapeOneUrl(url, timeoutMs) {
  return new Promise(async (resolve) => {
    let tab;
    try {
      tab = await chrome.tabs.create({ url, active: false });
    } catch (e) {
      resolve({ error: 'tab_create_failed', comments: [] });
      return;
    }
    const timer = setTimeout(() => {
      pendingScrapes.delete(tab.id);
      chrome.tabs.remove(tab.id).catch(() => {});
      resolve({ error: 'timeout', comments: [] });
    }, timeoutMs);

    pendingScrapes.set(tab.id, {
      resolve: (comments) => resolve({ comments }),
      timer,
    });
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
