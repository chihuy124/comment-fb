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

// Tracks discover-mode tabs
const pendingDiscovers = new Map(); // tabId -> {resolve, timer}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'SCRAPE_URLS') {
    scrapeMany(msg.urls || []).then(sendResponse);
    return true;
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
  if (msg?.type === 'DISCOVER_REELS') {
    discoverFromFeed(msg.durationMs || 45000, msg.startUrl).then(sendResponse);
    return true;
  }
  if (msg?.type === 'DISCOVER_RESULT' && sender.tab?.id != null) {
    const p = pendingDiscovers.get(sender.tab.id);
    if (p) {
      clearTimeout(p.timer);
      pendingDiscovers.delete(sender.tab.id);
      p.resolve(msg.urls || []);
      chrome.tabs.remove(sender.tab.id).catch(() => {});
    }
    return false;
  }
  if (msg?.type === 'DISCOVER_PROGRESS') {
    // Just for logging in popup / devtools; safe to ignore
    return false;
  }
  if (msg?.type === 'PING') {
    sendResponse({ ok: true, version: chrome.runtime.getManifest().version });
    return false;
  }
});

async function discoverFromFeed(durationMs, startUrl) {
  // Default: FB desktop vertical Reel feed. User can also pass /watch/.
  const base = startUrl || 'https://www.facebook.com/reel/';
  const url = `${base}#seeding=discover&t=${durationMs}`;
  let tab;
  try {
    tab = await chrome.tabs.create({ url, active: false });
  } catch (e) {
    return { ok: false, error: 'tab_create_failed', urls: [] };
  }
  return new Promise((resolve) => {
    // Overall timeout = duration + 20s buffer for load/settle
    const timer = setTimeout(() => {
      pendingDiscovers.delete(tab.id);
      chrome.tabs.remove(tab.id).catch(() => {});
      resolve({ ok: false, error: 'timeout', urls: [] });
    }, durationMs + 20000);

    pendingDiscovers.set(tab.id, {
      resolve: (urls) => resolve({ ok: true, urls }),
      timer,
    });
  });
}

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
